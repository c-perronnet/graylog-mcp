// INPUT-09: create_extractor — POST /api/system/inputs/{inputId}/extractors.
//
// D-07 reconfirmation: zod's superRefine on CreateExtractorSchema enforces
// the strict per-type extractor_config shape for all 8 Graylog 7.0.6
// primitives (grok, regex, regex_replace, split_and_index, substring,
// copy_input, json, lookup_table). The "key-value" name from the original
// 01-CONTEXT.md draft is NOT a Graylog primitive — agents use the json
// extractor with kv_separator + key_separator + flatten:true (documented in
// the tool description in src/tools.js).
//
// M5 mitigation: list-before-create idempotency. The pre-flight GET fires at
// build() time against /api/system/inputs/{inputId}/extractors (per-input
// scoped, not the global extractor list — Graylog enforces title uniqueness
// per input). The matchFn keys on title + extractor_type so a duplicate
// (same name, same primitive) surfaces in dry-run before applying.
//
// C6 sentinel: postApplyEstimate.id = "__SERVER_ASSIGNED__". Graylog assigns
// the extractor_id at POST time. The Graylog response shape is
// `{ extractor_id: "..." }` (NOT `{ id: "..." }` like POST /system/inputs) —
// toIdBody is given the explicit hint ["extractor_id", "id"] so the apply
// path returns the right id regardless of which Graylog version is on the
// other end. RESEARCH.md §"Notes on response shape inconsistencies" §Endpoint
// Catalogue row 10.

import { defineMutatingHandler } from "../_shared/handler.js";
import { CreateExtractorSchema } from "./schemas.js";
import { findExistingMatches } from "../_shared/conflict.js";
import { makeClient } from "../../graylog/client.js";
import { toIdBody } from "../../graylog/normalize.js";

export const handleCreateExtractor = defineMutatingHandler({
    name: "create_extractor",
    schema: CreateExtractorSchema,
    async build(args) {
        // handler.js threads the already-resolved connection through build
        // args under leading-underscore framework-internal keys (matches the
        // _connectionName / _conn pattern in defineListHandler / Plan 02's
        // update_input.build). No need to re-resolve here.
        const conn = args._conn;
        const client = makeClient(conn);

        // M5 pre-flight: per-input scoped existingMatches. Title + type
        // duplicates on the same input are the documented foot-gun (Graylog
        // does NOT enforce uniqueness server-side).
        const existing = await findExistingMatches(client, {
            listPath: `/api/system/inputs/${args.inputId}/extractors`,
            matchFn: (item) =>
                item.title === args.title
                && item.extractor_type === args.extractor_type,
            similarityReason: "exact title + extractor_type match",
        });

        return {
            method: "POST",
            path: `/api/system/inputs/${args.inputId}/extractors`,
            body: {
                title: args.title,
                cursor_strategy: args.cursor_strategy,
                source_field: args.source_field,
                target_field: args.target_field,
                extractor_type: args.extractor_type,
                extractor_config: args.extractor_config,
                ...(args.converters !== undefined ? { converters: args.converters } : {}),
                condition_type: args.condition_type,
                condition_value: args.condition_value,
                order: args.order,
            },
            postApplyEstimate: { id: "__SERVER_ASSIGNED__" },
            existingMatches: existing,
            // Graylog returns `{ extractor_id }` here, NOT `{ id }`. The
            // explicit hint ["extractor_id", "id"] makes toIdBody resilient
            // to either shape — useful if a future Graylog version switches.
            normalize: (raw) => toIdBody(raw, { idFields: ["extractor_id", "id"] }),
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        `Create ${args.extractor_type} extractor "${args.title}" on input ${args.inputId}`,
});
