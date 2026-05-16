// INDEX-05: delete_index_set — the C1 mitigation centerpiece of Phase 2.
//
// Graylog's REST surface has a server-side default of @DefaultValue("true") on
// the `delete_indices` query param — a single careless DELETE wipes the
// Elasticsearch indices AND every message in them. This wrapper inverts that
// default to false (D-04). To actually destroy data the agent must EXPLICITLY
// pass `deleteIndices: true` AND echo back a deterministic sha-256
// confirmation token from the dry-run preview (D-01/D-02).
//
// Token contract (computed inside build() per request):
//
//   sha256(JSON.stringify({
//     indexSetId,                     // target id
//     deleteIndices: true,            // locked literal — replay protection
//     indexNames: [...].sort(),       // ES index names that would be cleaned
//     messageCount,                   // documents across the index set
//   }))
//
// If anything changed server-side between dry-run and apply (new index opened,
// messages ingested), the hash mismatches and apply refuses — stateless
// binding, no MCP-side memory, survives process restarts.
//
// Three structural error paths land here:
//
//   ND1: default index set undeletable (Graylog 400 BadRequestException).
//        Wrapper-side pre-flight reads current.default; refuses with
//        reason: "default_index_set_undeletable" BEFORE the DELETE fires.
//        Fires regardless of deleteIndices value — the server's default
//        check happens first, so the wrapper surfaces this consistently.
//
//   D-05: stats_unreachable hard-blocks dry-run. If the /stats endpoint
//        throws (Elasticsearch unreachable, 5xx, timeout), the wrapper
//        refuses with reason: "stats_unreachable" — NO confirmation token
//        is issued because the agent cannot reason about the destruction
//        blast radius without knowing the messageCount.
//
//   confirmation_mismatch: handler.js's requireConfirm gate (Plan 02-01)
//        refuses apply when args.confirm !== req._confirmationToken.
//        Fires AFTER the writable gate (D-16) and AFTER build() — so
//        read-only connections refuse first (defense in depth).
//
// Apply envelope shape per UPDATED D-15 (CONTEXT.md 2026-05-15 revision):
//
//   { async: true, job_id_observable_at: "/system/jobs", message: "...<id>..." }
//
// job_id is DELIBERATELY ABSENT because Graylog's DELETE response is 204 with
// no body — there is no server-supplied id to forward. The message MUST
// include the target indexSetId so the agent can discover the cleanup job
// via `await_system_job` with `info_substring: <indexSetId>` (the
// IndexSetCleanupJob.info field carries the index-set id).

import { defineMutatingHandler } from "../_shared/handler.js";
import { DeleteIndexSetSchema } from "./schemas.js";
import { computeC1Hash, collectIndexNames } from "./c1-hash.js";
import { makeClient } from "../../graylog/client.js";
import { GraylogValidationError } from "../../graylog/errors.js";

export const handleDeleteIndexSet = defineMutatingHandler({
    name: "delete_index_set",
    schema: DeleteIndexSetSchema,
    async build(args) {
        const conn = args._conn;
        const client = makeClient(conn);
        const indexSetPath = `/api/system/indices/index_sets/${args.indexSetId}`;

        // 1. ND1 pre-flight (FIRST — fires regardless of deleteIndices value).
        //    Graylog's BadRequestException("Default index set cannot be deleted!")
        //    fires on the default check before the delete_indices query param
        //    is inspected, so the wrapper-side check is also default-first.
        const current = await client.request("GET", indexSetPath, null);
        if (current.default === true) {
            const err = new GraylogValidationError(
                "Cannot delete the default index set. Use set_default_index_set to assign a different default first, then retry.",
                { status: 400, method: "DELETE", path: indexSetPath },
            );
            err.reason = "default_index_set_undeletable";
            throw err;
        }

        // 2. Metadata-only path (deleteIndices: false — D-03 / D-04 default).
        //    No confirmation token, no cascades, no async envelope. Graylog
        //    removes the index-set metadata but leaves the Elasticsearch
        //    indices in place.
        if (args.deleteIndices === false) {
            return {
                method: "DELETE",
                path: `${indexSetPath}?delete_indices=false`,
                body: undefined,
                postApplyEstimate: { id: args.indexSetId, deletedIndices: false },
            };
        }

        // 3. Destruction path (deleteIndices: true). Pre-flight pair:
        //    - GET /system/indexer/indices/<id>/list — Elasticsearch index names.
        //      Best-effort: 404/403 → treat as empty AllIndices shape so the
        //      hash is still computable (messageCount may still be nonzero
        //      if the stats endpoint is reachable on a different code path,
        //      but typically both fail or both succeed).
        //    - GET /system/indices/index_sets/<id>/stats — messageCount.
        //      HARD BLOCK (D-05): any throw here refuses dry-run with reason
        //      stats_unreachable. The agent MUST see the blast radius.

        let allIndices = { closed: { indices: [] }, reopened: { indices: [] }, all: { indices: {} } };
        let listPreflightError = null;
        try {
            allIndices = await client.request(
                "GET",
                `/api/system/indexer/indices/${args.indexSetId}/list`,
                null,
            );
        } catch (err) {
            // Best-effort: leave allIndices as the empty default, but capture
            // the failure so the dry-run cascade preview can honestly signal
            // that the blast radius enumeration is incomplete (F-10 / WR-01).
            // The C1 hash is still computed over the (possibly empty)
            // indexNames; the apply-time drift-refusal is the structural
            // backstop if /list later recovers.
            listPreflightError = err?.message ?? String(err);
            console.error(
                `[delete_index_set] /indexer/indices/${args.indexSetId}/list pre-flight failed: ${listPreflightError}`,
            );
        }

        let stats;
        try {
            stats = await client.request(
                "GET",
                `/api/system/indices/index_sets/${args.indexSetId}/stats`,
                null,
            );
        } catch (_err) {
            // D-05 HARD BLOCK — refuse without issuing a token.
            const err = new GraylogValidationError(
                "Stats endpoint unreachable; cannot compute confirmation token without knowing the destruction blast radius. Check Elasticsearch health and retry.",
                {
                    status: 503,
                    method: "GET",
                    path: `/api/system/indices/index_sets/${args.indexSetId}/stats`,
                },
            );
            err.reason = "stats_unreachable";
            throw err;
        }

        const indexNames = collectIndexNames(allIndices);
        const messageCount = stats?.documents ?? 0;
        const confirmationToken = computeC1Hash({
            indexSetId: args.indexSetId,
            deleteIndices: true,
            indexNames,
            messageCount,
        });

        // UPDATED D-15: the apply envelope MUST NOT carry job_id. The message
        // is the agent's discovery hook — pass it to await_system_job's
        // info_substring path with the indexSetId substring.
        const messageForAgent = `Submitted cleanup for index set ${args.indexSetId}; await via /system/jobs (call await_system_job with info_substring: "${args.indexSetId}")`;

        return {
            method: "DELETE",
            path: `${indexSetPath}?delete_indices=true`,
            body: undefined,
            cascades: {
                // Sorted for stable preview output (the hash sorts internally;
                // the cascade list is for the agent's reading, also sorted for
                // determinism).
                indices: [...indexNames].sort(),
                messageCount,
                indexCount: indexNames.length,
                // F-10 / WR-01: when /list pre-flight failed, signal that the
                // enumerated blast radius is incomplete. The happy-path shape
                // is unchanged (conditional spread). The C1 hash is still
                // computed over indexNames as-is; apply-time drift-refusal
                // remains the structural backstop if /list recovers.
                ...(listPreflightError !== null && {
                    degraded: true,
                    degraded_reason: listPreflightError,
                }),
            },
            postApplyEstimate: {
                id: args.indexSetId,
                async: true,
                job_id_observable_at: "/system/jobs",
                message: messageForAgent,
            },
            _confirmationToken: confirmationToken,
        };
    },
    apply: async (client, req) => {
        // The writable gate (D-16) and requireConfirm gate (D-01) both fired
        // upstream; if we are here the agent has echoed the correct token.
        await client.request(req.method, req.path, req.body);

        // UPDATED D-15: extract the indexSetId from the req.path so the
        // apply-time message stays consistent with the dry-run preview.
        // Graylog's 204-no-body response means we cannot forward a job_id;
        // the agent's discovery path is await_system_job(info_substring).
        const m = req.path.match(/index_sets\/([^?]+)/);
        const indexSetId = m ? m[1] : "unknown";
        return {
            async: true,
            job_id_observable_at: "/system/jobs",
            message: `Submitted cleanup for index set ${indexSetId}; await via /system/jobs (call await_system_job with info_substring: "${indexSetId}")`,
        };
    },
    summarize: (args) =>
        `Delete index set ${args.indexSetId} (deleteIndices: ${args.deleteIndices ?? false})`,
    // D-01 apply-time gate: only fires when build() set _confirmationToken
    // (the deleteIndices:true branch). Returning null is a no-op (handler.js
    // skips the gate), so the metadata-only path issues no challenge.
    requireConfirm: ({ req }) => req._confirmationToken ?? null,
});
