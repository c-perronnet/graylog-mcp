// INPUT-10: update_extractor — PUT /api/system/inputs/{inputId}/extractors/{extractorId}.
//
// D-09 partial-update: schema is { inputId, extractorId, changes: {...} },
// same shape as update_input. The wrapper fetches current extractor state at
// build() time (the A4 amendment unblocks async build pre-flights — see
// 01-01-SUMMARY.md) and merges changes onto current — `changes` wins,
// everything else comes from current.
//
// Why a merge (not strict no-echo like update_input)? Extractors carry NO
// encrypted fields — RESEARCH.md verified this against the live 7.0.6 source
// (none of Grok/Regex/RegexReplace/SplitAndIndex/Substring/CopyInput/Json/
// LookupTable extractor_config types contain a field with is_encrypted:true
// in the requested_configuration). So the C3 pitfall (encrypted-field
// zero-out via round-tripping the masked value) is not reachable here, and
// the simpler merge-from-current pattern is acceptable. update_input's
// strict no-echo was load-bearing because input configs DO carry encrypted
// fields (TLS cert passwords, AWS credentials); extractors do not.
//
// extractor_type is immutable on update — Graylog rejects type changes
// server-side (see ExtractorsResource.update). The merge below sources it
// from `current.extractor_type ?? current.type`: Graylog's extractor READ
// DTO names the field `type`, while the WRITE body (CreateExtractorRequest)
// expects `extractor_type` — a read-vs-write key asymmetry. The `?? current.type`
// fallback handles the real read DTO today while staying correct if a future
// Graylog version exposes `extractor_type` on read. The schema does not allow
// extractor_type in `changes`, so immutability is enforced at the zod layer.

import { defineMutatingHandler } from "../_shared/handler.js";
import { UpdateExtractorSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { toIdBody } from "../../graylog/normalize.js";

export const handleUpdateExtractor = defineMutatingHandler({
    name: "update_extractor",
    schema: UpdateExtractorSchema,
    async build(args) {
        const conn = args._conn;
        const client = makeClient(conn);

        // Pre-flight: fetch current extractor for the merge. A 404 here
        // surfaces as an MCP error envelope via the A4 amendment's
        // try/catch in defineMutatingHandler (Plan 01-01 SUMMARY).
        const current = await client.request(
            "GET",
            `/api/system/inputs/${args.inputId}/extractors/${args.extractorId}`,
            null,
        );

        // Merge envelope: changes win, everything else from current. The
        // `converters` field is special — only emit if either side has a
        // value (Graylog rejects converters:null and an unset key is
        // semantically correct for "no converters").
        const hasConverters = args.changes.converters !== undefined
            || current.converters !== undefined;
        const mergedBody = {
            title: args.changes.title ?? current.title,
            cursor_strategy: args.changes.cursor_strategy ?? current.cursor_strategy,
            source_field: args.changes.source_field ?? current.source_field,
            target_field: args.changes.target_field ?? current.target_field,
            // Immutable — always from current. Read DTO names this `type`;
            // write body expects `extractor_type` (read-vs-write key asymmetry).
            extractor_type: current.extractor_type ?? current.type,
            extractor_config: args.changes.extractor_config ?? current.extractor_config,
            ...(hasConverters
                ? { converters: args.changes.converters ?? current.converters }
                : {}),
            condition_type: args.changes.condition_type ?? current.condition_type,
            condition_value: args.changes.condition_value ?? current.condition_value,
            order: args.changes.order ?? current.order,
        };

        return {
            method: "PUT",
            path: `/api/system/inputs/${args.inputId}/extractors/${args.extractorId}`,
            body: mergedBody,
            postApplyEstimate: { id: args.extractorId },
            // Update response is the full ExtractorSummary shape with `id`.
            normalize: (raw) => toIdBody(raw, { idFields: ["id", "extractor_id"] }),
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        `Update extractor ${args.extractorId} on input ${args.inputId} (${Object.keys(args.changes).length} change(s))`,
});
