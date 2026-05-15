// STREAM-05 — delete_stream. THE C2 MITIGATION CENTERPIECE of Phase 3.
//
// Graylog stream deletion silently cascades to:
//   1. stream rules attached to the stream,
//   2. pipeline-to-stream connections that reference the stream,
//   3. event definitions whose config.streams array lists the stream.
//
// The server-side error on dependent existence is a lossy
// BadRequestException ("Stream has dependent things"; see
// StreamResource.java:424-428) — by the time the agent sees it, the
// damage is partially done OR the agent has no structured way to
// enumerate which dependents block the call.
//
// This wrapper mitigates C2 by enumerating the blast radius BEFORE the
// destructive verb, freezing it into a deterministic keyed-buckets
// sha-256 token, and refusing on any drift between dry-run and apply.
//
// Execution order (do NOT reorder — each step is a structural enforcement):
//
//   1. D-09 mutable pre-flight: GET /api/streams/{id} → if
//      current.is_editable === false, throw GraylogValidationError
//      reason:stream_immutable. Saves 3 cascade round-trips on doomed
//      calls against built-in streams (002 events / 003 system /
//      004 failures / 005 collector_system_logs).
//
//   2. D-01 cascade pre-flight (3 endpoints, ALL must succeed):
//        a. GET /api/streams/{id}/rules
//           → { total, stream_rules: [{ id, type, field, value }] }
//        b. GET /api/streams/{id}/pipelines
//           → BARE ARRAY of { id, title } (Pitfall A3 — JAX-RS
//             serializes List<T> bare)
//        c. fetchEventDefinitionsForStream(client, streamId)
//           → paginates GET /api/events/definitions/paginated?page=N&per_page=50;
//             client-side filter on def.config.streams.includes(streamId)
//             because Graylog 7.0.6 has NO server-side stream_id query
//             param (Pitfall S6).
//
//   3. D-04 cascade_preflight_failed: ANY of the 3 endpoints throwing →
//      GraylogValidationError(reason:cascade_preflight_failed) naming the
//      failing endpoint in the message. NO confirmation token issued.
//      Hard-block (matches Phase 2 D-05 stats_unreachable stance).
//
//   4. D-02 confirmationToken = computeCascadeHash({ streamId, ruleIds,
//      pipelineConnIds, eventDefIds }) — keyed-buckets sha-256 (helper
//      shipped Plan 03-01 in src/tools/_shared/cascade-hash.js). The
//      keyed shape disambiguates per-type so a rule ID that byte-collides
//      with a pipeline-connection ID does not collapse the hash.
//
//   5. handler.js emits `confirmationToken: <hex>` in the dry-run JSON
//      automatically when build() set _confirmationToken (Plan 02-01
//      amendment).
//
//   6. handler.js requireConfirm gate refuses apply with
//      reason:confirmation_mismatch when args.confirm !== expectedToken
//      (Plan 02-01).
//
//   7. apply() RE-FETCHES all three cascade endpoints, RE-COMPUTES the
//      hash, and refuses with isError reason:cascade_changed_since_preview
//      (D-03) when the hash drifted between dry-run and apply (any
//      addition OR removal of a dependent). If a re-fetch errors at
//      apply, the typed GraylogValidationError(reason:cascade_preflight_failed)
//      propagates via the wrapper's outer try/catch.
//
//   8. Apply envelope is SYNC { deleted: true, streamId } per Pitfall S11
//      (streams have no system-job spawn; Phase 2 D-15 async envelope
//      does NOT apply).
//
// Threat-model anchors (see 03-03-PLAN.md <threat_model>):
//   T-03-03-01: replay of stale hash → D-03 re-fetch + refusal.
//   T-03-03-02: cross-stream replay → streamId in canonical JSON.
//   T-03-03-03: large event-def cluster slow paging → accepted; safety
//               cap at 1000 pages * 50/page = 50k defs.
//   T-03-03-04: partial cascade view → D-04 hard-block (no token issued).
//   T-03-03-06: wrapper bypass → defense-in-depth via client-layer
//               writable gate + wrapper-layer writable+requireConfirm.
//   T-03-03-08: default/system stream deletion → D-09 stream_immutable
//               refusal BEFORE the 3 cascade GETs fire.

import { defineMutatingHandler } from "../_shared/handler.js";
import { DeleteStreamSchema } from "./schemas.js";
import { computeCascadeHash } from "../_shared/cascade-hash.js";
import { makeClient } from "../../graylog/client.js";
import { GraylogValidationError } from "../../graylog/errors.js";

// Pitfall S6 — paginated event-definition fetch with client-side filter.
// No server-side stream_id filter exists in Graylog 7.0.6 (verified at
// EventDefinitionsResource.java:188-267). Returns matches as { id, title }.
//
// Per-page cap is 50 (Graylog framework default). Early-exit when a
// partial page is returned (defs.length < perPage). Safety cap at 1000
// pages (= 50000 event definitions max) protects against an unterminated
// pagination loop if the API shape drifts.
async function fetchEventDefinitionsForStream(client, streamId) {
    const matches = [];
    const perPage = 50;
    const maxPages = 1000;
    let page = 1;
    while (page <= maxPages) {
        const rsp = await client.request(
            "GET",
            `/api/events/definitions/paginated?page=${page}&per_page=${perPage}`,
            null,
        );
        const defs = Array.isArray(rsp?.elements) ? rsp.elements : [];
        for (const def of defs) {
            const linkedStreams = Array.isArray(def?.config?.streams) ? def.config.streams : [];
            if (linkedStreams.includes(streamId)) {
                matches.push({ id: def.id, title: def.title });
            }
        }
        // Early exit on partial page (= last page).
        if (defs.length < perPage) break;
        page += 1;
    }
    return matches;
}

// Cascade pre-flight orchestrator. Throws GraylogValidationError with
// reason:cascade_preflight_failed on any per-endpoint failure (D-04).
// Endpoint order (matters for the test's "endpoint X consulted before
// Y fails" assertions): rules → pipelines → event-defs. This is also
// the cheap-to-expensive order — fail fast on the small endpoint when
// the cluster is broken, save the paginated walk for healthy clusters.
async function buildCascade(client, streamId) {
    let stream_rules;
    try {
        const rulesRsp = await client.request(
            "GET",
            `/api/streams/${streamId}/rules`,
            null,
        );
        stream_rules = (Array.isArray(rulesRsp?.stream_rules) ? rulesRsp.stream_rules : []).map((r) => ({
            id: r.id,
            type: r.type,
            field: r.field,
            value: r.value,
        }));
    } catch (err) {
        const e = new GraylogValidationError(
            `Cascade pre-flight failed: GET /api/streams/${streamId}/rules — ${err.message}`,
            { status: 503, method: "GET", path: `/api/streams/${streamId}/rules` },
        );
        e.reason = "cascade_preflight_failed";
        throw e;
    }

    let pipeline_connections;
    try {
        const pipelinesRsp = await client.request(
            "GET",
            `/api/streams/${streamId}/pipelines`,
            null,
        );
        // Pitfall A3 — BARE ARRAY of PipelineCompactSource. No envelope unwrap.
        pipeline_connections = (Array.isArray(pipelinesRsp) ? pipelinesRsp : []).map((p) => ({
            id: p.id,
            title: p.title,
        }));
    } catch (err) {
        const e = new GraylogValidationError(
            `Cascade pre-flight failed: GET /api/streams/${streamId}/pipelines — ${err.message}`,
            { status: 503, method: "GET", path: `/api/streams/${streamId}/pipelines` },
        );
        e.reason = "cascade_preflight_failed";
        throw e;
    }

    let event_definitions;
    try {
        event_definitions = await fetchEventDefinitionsForStream(client, streamId);
    } catch (err) {
        const e = new GraylogValidationError(
            `Cascade pre-flight failed: GET /api/events/definitions/paginated — ${err.message}`,
            { status: 503, method: "GET", path: `/api/events/definitions/paginated` },
        );
        e.reason = "cascade_preflight_failed";
        throw e;
    }

    return { stream_rules, pipeline_connections, event_definitions };
}

export const handleDeleteStream = defineMutatingHandler({
    name: "delete_stream",
    schema: DeleteStreamSchema,
    async build(args) {
        const client = makeClient(args._conn);
        const path = `/api/streams/${args.streamId}`;

        // 1. D-09 mutable pre-flight (FIRST — saves 3 round-trips on doomed
        //    calls against built-in / system streams). Wire field is
        //    is_editable (Pitfall S2; list_streams projects it to mutable).
        const current = await client.request("GET", path, null);
        if (current.is_editable === false) {
            const err = new GraylogValidationError(
                `Stream "${current.title ?? args.streamId}" (id: ${args.streamId}) ` +
                `is non-editable (Graylog built-in or system stream); refusing delete. ` +
                `Call list_streams and filter by mutable: true to find a deletable candidate.`,
                { status: 400, method: "DELETE", path },
            );
            err.reason = "stream_immutable";
            throw err;
        }

        // 2. D-01 cascade pre-flight (3 endpoints; D-04 hard-block on any failure).
        const cascades = await buildCascade(client, args.streamId);

        // 3. D-02 confirmation hash (keyed-buckets canonicalization).
        const confirmationToken = computeCascadeHash({
            streamId: args.streamId,
            ruleIds: cascades.stream_rules.map((r) => r.id),
            pipelineConnIds: cascades.pipeline_connections.map((p) => p.id),
            eventDefIds: cascades.event_definitions.map((d) => d.id),
        });

        return {
            method: "DELETE",
            path,
            body: undefined,
            cascades,
            postApplyEstimate: { id: args.streamId, deleted: true },
            _confirmationToken: confirmationToken,
        };
    },
    async apply(client, req) {
        // D-03: re-fetch cascades, re-compute hash, refuse on drift. The
        // streamId is extracted from req.path so apply() is fully driven
        // by the build()-emitted descriptor — no closure capture of
        // build()'s args.
        const m = req.path.match(/streams\/([^/?]+)/);
        const streamId = m ? m[1] : "unknown";

        // Re-fetch may throw GraylogValidationError(cascade_preflight_failed);
        // the wrapper's outer try/catch routes that through wrapGraylogError
        // verbatim — apply-time cascade pre-flight failure surfaces the same
        // structured error envelope as a dry-run failure.
        const cascades = await buildCascade(client, streamId);

        const currentHash = computeCascadeHash({
            streamId,
            ruleIds: cascades.stream_rules.map((r) => r.id),
            pipelineConnIds: cascades.pipeline_connections.map((p) => p.id),
            eventDefIds: cascades.event_definitions.map((d) => d.id),
        });

        if (currentHash !== req._confirmationToken) {
            // handler.js passes this isError envelope through verbatim
            // (handler.js:200-204 — Plan 02-01 amendment).
            return {
                isError: true,
                reason: "cascade_changed_since_preview",
                content: [{
                    type: "text",
                    text: `[delete_stream] cascade_changed_since_preview: dependent resources drifted between dry-run and apply. Re-run dry-run to see the new cascade and obtain a fresh confirmationToken.`,
                }],
            };
        }

        await client.request(req.method, req.path, req.body);
        // Pitfall S11: SYNC envelope. No async:true, no job_id_observable_at,
        // no await_system_job involvement. defineMutatingHandler's normalize
        // step (handler.js:206) lifts this into the standard { id, body }
        // shape — by default id falls back to raw?.id (undefined here, since
        // the apply envelope intentionally has no id key — the streamId
        // travels under `streamId`).
        return { deleted: true, streamId };
    },
    summarize: (args) => `Delete stream ${args.streamId}`,
    requireConfirm: ({ req }) => req._confirmationToken ?? null,
});
