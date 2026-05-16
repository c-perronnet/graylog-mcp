// PIPE-08 — create_pipeline_rule. ROADMAP SC1 + the C4 mitigation centerpiece.
// POST /api/system/pipelines/rule.
//
// Decisions honoured:
//   - D-04 client-side lint via validateRuleSource (MERGED catalogue per Pitfall 5)
//   - D-05 server-authoritative parse pre-flight at POST /api/system/pipelines/rule/parse
//   - D-10 mutual exclusion (structured XOR ruleSource) — enforced at the schema layer
//   - D-11 full DSL coverage via structured intent (RuleSpecSchema/ConditionSchema/ActionSchema)
//   - D-17 __SERVER_ASSIGNED__ sentinel for postApplyEstimate.id
//
// Pitfall handling:
//   - Pitfall 3 (rule variant): every URL uses the literal /rule/ segment
//   - Pitfall 4: tool description warns agents that side-effect functions
//     (from_input, route_to_stream, remove_from_stream) cannot be meaningfully
//     simulated by simulate_pipeline_rule (Plan 04-04). Runtime behaviour is
//     unaffected — the warning is for the agent's testing workflow only.
//   - Pitfall 5: validate.js consumes the MERGED catalogue so live-only
//     function names introduced by a newer Graylog version DO NOT false-fail
//   - Pitfall 6: ParseError.positionInLine (camelCase on wire) translates to
//     position_in_line (snake_case) in the emitted parseResult envelope
//
// Threat-model T-04-03-01 (DSL injection via structured literal) is mitigated
// by emit.js routing every embedded literal through escape.js (Plan 04-01
// T-04-01-05 backstop). The server parse pre-flight (D-05) is defense-in-
// depth — if the escape helper has a bug, parse catches it before apply.

import { defineMutatingHandler } from "../_shared/handler.js";
import { CreatePipelineRuleSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { GraylogValidationError } from "../../graylog/errors.js";
import { findExistingMatches } from "../_shared/conflict.js";
import { emitRule } from "../../pipeline-dsl/emit.js";
import { validateRuleSource } from "../../pipeline-dsl/validate.js";
import { getMergedCatalogue } from "../../pipeline-dsl/function-catalogue.js";
import { toIdBody } from "../../graylog/normalize.js";

// D-05 parse pre-flight: POST /api/system/pipelines/rule/parse.
// On 200 → { ok: true }. On 400 → throw GraylogValidationError with
// reason:"rule_parse_failed" and parseResult.error attached. The wrapper's
// wrapGraylogError emits the structured reason in the MCP envelope; the
// outer apply branch in handler.js NEVER runs (C4 gate).
//
// Pitfall 6 translation lives here: the wire body uses positionInLine
// (camelCase, verified against ParseException.toJson() in Graylog source).
// We READ it that way and EMIT position_in_line (snake_case) per project
// convention. Both keys live side-by-side in nothing — only the snake-
// cased projection leaves the wrapper.
//
// title:"preflight" supplied because the parse endpoint expects a RuleSource
// wrapper shape; the actual title is derived from the `rule "..."` text on
// successful parse.
export async function preflightParseRule(client, source) {
    try {
        await client.request(
            "POST",
            "/api/system/pipelines/rule/parse",   // Pitfall 3 (rule variant) literal segment
            { source, title: "preflight" },
        );
        return { ok: true };
    } catch (err) {
        if (err?.isGraylogError && err.status === 400) {
            const errs = Array.isArray(err.body) ? err.body : [err.body];
            const parseResult = {
                ok: false,
                error: errs.map((e) => ({
                    line: e?.line,
                    // Wire shape verified live on Graylog 7.0.6 (verify-work 02..06,
                    // 2026-05-16): snake_case `position_in_line` + `reason` field.
                    // Original Pitfall 6 research surmise of camelCase wire was wrong.
                    // Fallback chain accepts either form for defense-in-depth.
                    position_in_line: e?.position_in_line ?? e?.positionInLine,
                    type: e?.type,
                    message: e?.reason ?? e?.message ?? `${e?.type} at L${e?.line}:${e?.position_in_line ?? e?.positionInLine}`,
                })),
            };
            const wrapped = new GraylogValidationError(
                `Server rule parse failed: ${parseResult.error.map((e) =>
                    `[L${e.line}:${e.position_in_line}] ${e.type}`).join("; ")}`,
                { status: 400, method: "POST", path: "/api/system/pipelines/rule/parse" },
            );
            wrapped.reason = "rule_parse_failed";
            wrapped.parseResult = parseResult;
            throw wrapped;
        }
        throw err;
    }
}

// Best-effort title extraction for M5 conflict pre-check on the raw-DSL
// path. Matches `rule "..."` at the start of the source. If no match,
// returns null (existingMatches remains empty — informational, not blocking).
function extractTitleFromRawDSL(source) {
    const m = source.match(/^\s*rule\s+"([^"]+)"/);
    return m ? m[1] : null;
}

export const handleCreatePipelineRule = defineMutatingHandler({
    name: "create_pipeline_rule",
    schema: CreatePipelineRuleSchema,
    async build(args) {
        const client = makeClient(args._conn);

        // 1. Resolve effective DSL source — either compile from structured
        //    intent (D-11 emit.js routes every literal through escape.js)
        //    or forward the raw string verbatim.
        const source = args.structured
            ? emitRule(args.structured)
            : args.ruleSource;

        // 2. Client-side lint (D-04). Consumes the MERGED catalogue (Pitfall 5
        //    fix in validate.js — live-only function names are accepted).
        const catalogue = await getMergedCatalogue(args._connectionName, args._conn);
        const lintResult = validateRuleSource(source, catalogue);
        if (lintResult.errors.length > 0) {
            const err = new GraylogValidationError(
                `Client-side rule validation failed: ${lintResult.errors.map(
                    (e) => `${e.type}: ${e.message}`,
                ).join("; ")}`,
                { status: 400, method: "POST", path: "/api/system/pipelines/rule" },
            );
            err.reason = "rule_validation_failed";
            err.lintErrors = lintResult.errors;
            throw err;
        }

        // 3. Server-authoritative parse pre-flight (D-05 / C4 acceptance gate).
        //    Throws GraylogValidationError(reason:"rule_parse_failed") on 400;
        //    handler.js routes through wrapGraylogError and apply NEVER runs.
        const parseResult = await preflightParseRule(client, source);

        // 4. M5 conflict pre-check — best-effort title comparison against the
        //    bare-array list at /api/system/pipelines/rule (Pitfall A3 +
        //    Pitfall 3 rule variant). For structured intent, the title is
        //    args.structured.name; for raw DSL, the wrapper regex-extracts
        //    `rule "..."`. No title → no match attempt; existingMatches stays
        //    empty (informational, not blocking).
        const title = args.structured?.name ?? extractTitleFromRawDSL(source);
        const existingMatches = title
            ? await findExistingMatches(client, {
                  listPath: "/api/system/pipelines/rule",   // Pitfall 3 rule variant
                  matchFn: (r) => r?.title === title,
                  similarityReason: "exact",
              })
            : [];

        // 5. Return descriptor. The body shape mirrors RuleSource — `source`
        //    is the only required field per RuleResource.java:125-153; title
        //    is server-derived from `rule "..."`. We DON'T echo title from
        //    args.structured.name (server reads it from the source itself).
        return {
            method: "POST",
            path: "/api/system/pipelines/rule",   // Pitfall 3 rule variant
            body: {
                source,
                ...(args.description !== undefined ? { description: args.description } : {}),
                ...(args.simulator_message !== undefined
                    ? { simulator_message: args.simulator_message }
                    : {}),
            },
            parseResult,
            existingMatches,
            postApplyEstimate: { id: "__SERVER_ASSIGNED__" },   // D-17
            normalize: (raw) => toIdBody(raw, { idFields: ["id"] }),
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        args.structured
            ? `Create pipeline rule "${args.structured.name}" (from structured intent)`
            : `Create pipeline rule (from raw DSL)`,
});
