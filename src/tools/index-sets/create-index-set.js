// INDEX-03: create_index_set — POST /api/system/indices/index_sets.
//
// Composes through defineMutatingHandler so dryRun (defaults true), the
// writable-flag gate, idempotency, and the __SERVER_ASSIGNED__ sentinel are
// uniform with every other Phase 1/2 mutating tool.
//
// Three load-bearing details land here:
//
//   1. D-08 + D-09 alias-to-FQCN translation: the agent passes friendly
//      aliases (rotation_strategy ∈ {time-based, size-based, message-count};
//      retention_strategy ∈ {delete, close}); strategies.js translates them
//      to the FQCN pair Graylog needs on the wire. archive retention is
//      rejected with a structured `archive_not_supported` reason routed
//      through GraylogValidationError → wrapGraylogError (so the agent sees
//      a uniform MCP error envelope instead of a typed-error raw throw).
//
//   2. D-10 required strategies: CreateIndexSetSchema enforces that all four
//      of (rotation_strategy, rotation_strategy_config, retention_strategy,
//      retention_strategy_config) are required with NO defaults. The
//      per-alias config superRefine in schemas.js narrows the config shape
//      before this build() runs, so by the time we get here the configs are
//      structurally valid for their alias.
//
//   3. M5 idempotency: pre-flight a GET /api/system/indices/index_sets list
//      call and surface same-title matches in existingMatches[] so the agent
//      sees the collision in the dry-run BEFORE applying. Reuses Plan 01's
//      A2 findExistingMatches + Plan 02-01's amended conflict.js
//      index_sets-envelope unwrap.
//
// Determinism note: creation_date defaults to new Date().toISOString(). The
// _setClockForTests seam below lets unit tests pin a fixed timestamp so
// snapshot fixtures stay byte-identical across CI runs. Production code
// goes through the real clock (test seam is null-clear).

import { defineMutatingHandler } from "../_shared/handler.js";
import { CreateIndexSetSchema } from "./schemas.js";
import { aliasToConfigOrError } from "./strategies.js";
import { findExistingMatches } from "../_shared/conflict.js";
import { makeClient } from "../../graylog/client.js";
import { toIdBody } from "../../graylog/normalize.js";
import { GraylogValidationError } from "../../graylog/errors.js";

// Test seam — replaces new Date().toISOString() so snapshot fixtures stay
// deterministic. Production code MUST NOT call _setClockForTests (the leading
// underscore marks it as test-only per project convention).
let _clockFn = null;
export function _setClockForTests(fn) {
    _clockFn = fn;
}
function nowIso() {
    return _clockFn ? _clockFn() : new Date().toISOString();
}

export const handleCreateIndexSet = defineMutatingHandler({
    name: "create_index_set",
    schema: CreateIndexSetSchema,
    async build(args) {
        // Connection threaded by handler.js under leading-underscore framework-
        // internal keys (matches the create_input precedent).
        const conn = args._conn;
        const client = makeClient(conn);

        // D-08 alias → FQCN translation. aliasToConfigOrError returns a
        // structured rejection for "archive" retention and for any unknown
        // alias (defense-in-depth — closed enum already gates this in
        // CreateIndexSetSchema, but the translator returns a precise error
        // so wrapGraylogError can render the reason name).
        const rotation = aliasToConfigOrError("rotation", args.rotation_strategy, args.rotation_strategy_config);
        if (rotation.isError) {
            const err = new GraylogValidationError(rotation.message, {
                status: 400,
                method: "POST",
                path: "/api/system/indices/index_sets",
            });
            err.reason = rotation.reason;
            throw err;
        }
        const retention = aliasToConfigOrError("retention", args.retention_strategy, args.retention_strategy_config);
        if (retention.isError) {
            const err = new GraylogValidationError(retention.message, {
                status: 400,
                method: "POST",
                path: "/api/system/indices/index_sets",
            });
            err.reason = retention.reason;
            throw err;
        }

        // M5 list-before-create. Phase 01 conflict.js was amended in Plan 02-01
        // to unwrap the { total, index_sets, stats } envelope from this endpoint.
        const existingMatches = await findExistingMatches(client, {
            listPath: "/api/system/indices/index_sets",
            matchFn: (item) => item.title === args.title,
            similarityReason: "exact title match",
        });

        // IndexSetCreationRequest wire shape (verified against IndexSetCreationRequest.java
        // + IndexSetConfig.java — see 02-RESEARCH.md §IndexSetCreationRequest Shape).
        // The wrapper fills creation_date so the agent doesn't have to think
        // about it; the schema already supplies sensible defaults for every
        // infrastructure knob (shards, replicas, index_analyzer, ...).
        const wireBody = {
            title: args.title,
            description: args.description,
            index_prefix: args.index_prefix,
            shards: args.shards,
            replicas: args.replicas,
            ...rotation.block,
            ...retention.block,
            index_analyzer: args.index_analyzer,
            index_optimization_max_num_segments: args.index_optimization_max_num_segments,
            index_optimization_disabled: args.index_optimization_disabled,
            field_type_refresh_interval: args.field_type_refresh_interval,
            writable: args.writable,
            use_legacy_rotation: args.use_legacy_rotation,
            creation_date: nowIso(),
        };

        return {
            method: "POST",
            path: "/api/system/indices/index_sets",
            body: wireBody,
            // D-17: server assigns the id. Tool description warns the agent
            // never to reuse the placeholder across a multi-step flow.
            postApplyEstimate: { id: "__SERVER_ASSIGNED__" },
            existingMatches,
            normalize: (raw) => toIdBody(raw, { idFields: ["id"] }),
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        `Create index set "${args.title}" (${args.rotation_strategy} rotation, ${args.retention_strategy} retention)`,
});
