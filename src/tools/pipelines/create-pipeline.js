// PIPE-03 — create_pipeline. POST /api/system/pipelines/pipeline.
//
// D-06 server-authoritative parse pre-flight:
//   build() calls POST /api/system/pipelines/pipeline/parse first;
//   any ParseException (400 + Set<ParseError> body) is wrapped as
//   GraylogValidationError(reason:"pipeline_parse_failed") with the
//   error array attached. handler.js catches via wrapGraylogError;
//   apply NEVER runs on parse failure (C4 mitigation gate).
//
// Pitfall 3: every URL uses the literal `pipeline` segment.
// Pitfall 6: ParseError.positionInLine is camelCase on the wire;
//   the wrapper reads it that way but EMITS `position_in_line`
//   (snake_case) per project convention.
//
// M5 conflict pre-check: findExistingMatches against the bare-array
// list_pipelines surface; `existingMatches` populated with [{id, title}]
// when a pipeline with the same title already exists. Informational,
// not blocking (Phase 1 precedent).

import { defineMutatingHandler } from "../_shared/handler.js";
import { CreatePipelineSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { GraylogValidationError } from "../../graylog/errors.js";
import { findExistingMatches } from "../_shared/conflict.js";
import { toIdBody } from "../../graylog/normalize.js";

// D-06 parse pre-flight: POST /api/system/pipelines/pipeline/parse.
// On 200 → { ok: true }. On 400 → throw GraylogValidationError with
// reason:"pipeline_parse_failed" and parseResult.error attached. The
// wrapper's wrapGraylogError emits the structured reason in the MCP
// envelope; handler.js's apply branch NEVER runs (C4 gate).
//
// Pitfall 6 translation lives here: the wire body uses positionInLine
// (camelCase, verified against ParseException.toJson() in Graylog
// source). We READ it that way and EMIT position_in_line (snake_case)
// per project convention. Both keys live side-by-side in nothing —
// only the snake-cased projection leaves the wrapper.
export async function preflightParsePipeline(client, source) {
    try {
        await client.request(
            "POST",
            "/api/system/pipelines/pipeline/parse",   // Pitfall 3 literal segment
            { source },
        );
        return { ok: true };
    } catch (err) {
        if (err?.isGraylogError && err.status === 400) {
            const errs = Array.isArray(err.body) ? err.body : [err.body];
            const parseResult = {
                ok: false,
                error: errs.map((e) => ({
                    line: e?.line,
                    position_in_line: e?.positionInLine,    // Pitfall 6 — camelCase IN, snake_case OUT
                    type: e?.type,
                    message: e?.message ?? `${e?.type} at L${e?.line}:${e?.positionInLine}`,
                })),
            };
            const wrapped = new GraylogValidationError(
                `Pipeline parse failed: ${parseResult.error.map((e) =>
                    `[L${e.line}:${e.position_in_line}] ${e.type}`).join("; ")}`,
                { status: 400, method: "POST", path: "/api/system/pipelines/pipeline/parse" },
            );
            wrapped.reason = "pipeline_parse_failed";
            wrapped.parseResult = parseResult;
            throw wrapped;
        }
        throw err;
    }
}

export const handleCreatePipeline = defineMutatingHandler({
    name: "create_pipeline",
    schema: CreatePipelineSchema,
    async build(args) {
        const client = makeClient(args._conn);

        // 1. D-06 server-authoritative parse pre-flight (C4 mitigation).
        //    Throws GraylogValidationError(reason:"pipeline_parse_failed")
        //    on 400; handler.js routes through wrapGraylogError and apply
        //    NEVER runs.
        const parseResult = await preflightParsePipeline(client, args.source);

        // 2. M5 conflict pre-check. Pipelines return a BARE ARRAY from
        //    /api/system/pipelines/pipeline (Pitfall A3 + RESEARCH §"Key
        //    shape callouts"). findExistingMatches's Array.isArray fast
        //    path handles bare arrays without an envelope unwrap.
        const existingMatches = await findExistingMatches(client, {
            listPath: "/api/system/pipelines/pipeline",   // Pitfall 3
            matchFn: (p) => p?.title === args.title,
            similarityReason: "exact",
        });

        // 3. Return descriptor.
        return {
            method: "POST",
            path: "/api/system/pipelines/pipeline",   // Pitfall 3
            body: {
                title: args.title,
                description: args.description ?? null,
                source: args.source,
            },
            parseResult,
            existingMatches,
            postApplyEstimate: { id: "__SERVER_ASSIGNED__" },   // D-17
            normalize: (raw) => toIdBody(raw, { idFields: ["id"] }),
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) => `Create pipeline "${args.title}"`,
});
