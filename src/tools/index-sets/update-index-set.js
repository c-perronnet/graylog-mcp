// INDEX-04: update_index_set — PUT /api/system/indices/index_sets/{id}.
//
// U1 resolution (02-U1-SMOKE.md, UNREACHABLE_DEFAULT_MERGE):
// MERGE_FROM_CURRENT wire-build pattern. Pre-flight GET fetches the current
// IndexSetResponse; build() merges args.changes (minus immutable fields) over
// the top and emits the FULL merged DTO on the wire. This is safe because
// index-set configs carry NO encrypted fields (verified against
// IndexSetResponse — no `is_encrypted: true` field), so the C3 zero-out
// pitfall that drove update_input's strict-no-echo pattern is not reachable
// here. See RESEARCH.md §Pitfall U1 and the U1 smoke artifact for the full
// rationale.
//
// Three load-bearing details land here:
//
//   1. ND2 pre-flight (RESEARCH.md §Pitfall ND2): Graylog rejects
//      `writable: false` on the default index set with HTTP 409. The
//      wrapper pre-flights this invariant — when current.default === true
//      AND args.changes.writable === false, build() throws a
//      GraylogValidationError with reason `default_index_set_must_be_writable`
//      BEFORE the PUT fires. The error routes through wrapGraylogError into
//      the canonical MCP error envelope.
//
//   2. D-11 atomic strategy-replace is enforced at the schema layer
//      (UpdateIndexSetSchema superRefine). By the time build() runs, the
//      agent has either passed both strategy + strategy_config OR neither.
//      Build() simply detects the pair's presence and translates aliases
//      via strategies.js, mirroring create_index_set's translation path.
//
//   3. Immutable fields (index_prefix, creation_date) are stripped from any
//      agent-supplied changes at the schema layer (UpdateChangesShape omits
//      them — zod default `strip` mode drops unknown keys). The wire body
//      re-asserts current.index_prefix + current.creation_date as a
//      defense-in-depth second pass, so even if a future schema regression
//      lets these through, an attacker cannot rename a victim's index
//      prefix or rewrite the creation_date via update_index_set
//      (threat-model T-02-02-04).

import { defineMutatingHandler } from "../_shared/handler.js";
import { UpdateIndexSetSchema } from "./schemas.js";
import { aliasToConfigOrError } from "./strategies.js";
import { makeClient } from "../../graylog/client.js";
import { toIdBody } from "../../graylog/normalize.js";
import { GraylogValidationError } from "../../graylog/errors.js";

export const handleUpdateIndexSet = defineMutatingHandler({
    name: "update_index_set",
    schema: UpdateIndexSetSchema,
    async build(args) {
        const conn = args._conn;
        const client = makeClient(conn);
        const path = `/api/system/indices/index_sets/${args.indexSetId}`;

        // 1. Pre-flight GET — sources the immutable fields, the strategy
        //    blocks the agent didn't touch, and current.default for ND2.
        //    A 404/403 here surfaces via wrapGraylogError through the A4
        //    async-build amendment (Plan 01-01).
        const current = await client.request("GET", path, null);

        // 2. ND2 pre-flight (RESEARCH.md §Pitfall ND2): default index set
        //    cannot be made non-writable. Surface the would-be 409 in the
        //    wrapper layer so the agent sees a structured reason name
        //    rather than a server-side 409 body.
        if (current.default === true && args.changes.writable === false) {
            const err = new GraylogValidationError(
                "Default index set must remain writable; refusing to set writable: false on the default index set.",
                { status: 409, method: "PUT", path },
            );
            err.reason = "default_index_set_must_be_writable";
            throw err;
        }

        // 3. Strategy alias translation when the agent is replacing a
        //    strategy. D-11 atomic strategy-replace already guarantees that
        //    if either of (strategy, strategy_config) is in changes, the
        //    other is too — so this is a clean either-translate-or-keep
        //    branch.
        let rotationBlock = null;
        if (args.changes.rotation_strategy !== undefined) {
            const result = aliasToConfigOrError(
                "rotation",
                args.changes.rotation_strategy,
                args.changes.rotation_strategy_config,
            );
            if (result.isError) {
                const err = new GraylogValidationError(result.message, {
                    status: 400, method: "PUT", path,
                });
                err.reason = result.reason;
                throw err;
            }
            rotationBlock = result.block;
        }
        let retentionBlock = null;
        if (args.changes.retention_strategy !== undefined) {
            const result = aliasToConfigOrError(
                "retention",
                args.changes.retention_strategy,
                args.changes.retention_strategy_config,
            );
            if (result.isError) {
                const err = new GraylogValidationError(result.message, {
                    status: 400, method: "PUT", path,
                });
                err.reason = result.reason;
                throw err;
            }
            retentionBlock = result.block;
        }

        // 4. MERGE_FROM_CURRENT body build. The agent's `changes` win for
        //    every key they set; everything else comes from current. The
        //    strategy blocks land via spread so they overwrite the four
        //    rotation_/retention_ keys on current with the new pair.
        //    Immutable fields are re-asserted from current as defense-in-depth.
        //
        //    Implementation note: we destructure-and-rebuild rather than
        //    spreading current verbatim because current may carry server-side
        //    fields the PUT deserializer rejects (e.g. `id`, `default`,
        //    `can_be_default`). The explicit field list mirrors
        //    IndexSetUpdateRequest.java's known property set.
        const c = args.changes;
        const mergedBody = {
            title: c.title ?? current.title,
            description: c.description ?? current.description,
            // Immutable — always from current, never from changes.
            index_prefix: current.index_prefix,
            creation_date: current.creation_date,
            shards: c.shards ?? current.shards,
            replicas: c.replicas ?? current.replicas,
            // Strategy blocks: replace if agent supplied a pair; else keep current.
            ...(rotationBlock ?? {
                rotation_strategy_class: current.rotation_strategy_class,
                rotation_strategy: current.rotation_strategy,
            }),
            ...(retentionBlock ?? {
                retention_strategy_class: current.retention_strategy_class,
                retention_strategy: current.retention_strategy,
            }),
            index_analyzer: c.index_analyzer ?? current.index_analyzer,
            index_optimization_max_num_segments:
                c.index_optimization_max_num_segments
                    ?? current.index_optimization_max_num_segments,
            index_optimization_disabled:
                c.index_optimization_disabled
                    ?? current.index_optimization_disabled,
            field_type_refresh_interval:
                c.field_type_refresh_interval
                    ?? current.field_type_refresh_interval,
            writable: c.writable ?? current.writable,
            // use_legacy_rotation is on the current DTO; emit it unconditionally
            // so the PUT deserializer doesn't fall back to its own default and
            // potentially flip the rotation engine.
            use_legacy_rotation: current.use_legacy_rotation,
        };

        return {
            method: "PUT",
            path,
            body: mergedBody,
            postApplyEstimate: { id: args.indexSetId },
            normalize: (raw) => toIdBody(raw, { idFields: ["id"] }),
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        `Update index set ${args.indexSetId} (${Object.keys(args.changes).length} change(s))`,
});
