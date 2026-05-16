// PIPE-12 — simulate_pipeline_rule. Plan 04-04 / ROADMAP SC2. M3 ACCEPTANCE GATE.
//
// POST /api/system/pipelines/rule/simulate. The returned Message DTO carries
// the post-rule field map, letting the agent verify semantic bugs (wrong
// function name passing parse but failing runtime; type coercion errors;
// set_field overwriting reserved fields) BEFORE applying a rule to production
// traffic. This is the value proposition the C4 acceptance gate (parse pre-
// flight) cannot deliver — parse only checks grammar.
//
// CRITICAL — Pitfall 1: SimulateRuleRequest.message() is typed `String` on
// the wire (RuleResource.java:179 — `ruleSimulator.createMessage(request.message())`
// parses a JSON-string into a `Message` object). The wrapper accepts the
// friendly agent-facing form `{ message: {source, level, ...} }` and emits
// the wire form:
//
//   { message: '{"source":"host","level":6}', rule_source: { source: "rule \"...\" ..." } }
//
// Forgetting JSON.stringify causes Jackson 400 "Cannot deserialize value of
// type `java.lang.String` from Object value". This is the single most
// surprising shape in Phase 4; the load-bearing JSON.stringify line is
// covered by Pitfall 1 acceptance tests.
//
// Pitfall 4 surface: functions depending on Graylog internal `gl2_*` metadata
// fields (from_input, route_to_stream, remove_from_stream) cannot be
// meaningfully simulated — the simulator's createMessage(jsonString) does
// NOT populate `gl2_source_input` etc. The tool description in tools.js
// warns the agent. Runtime behaviour is unaffected; the warning is for
// the agent's testing workflow only.
//
// D-09: routes through defineMutatingHandler per Phase 2 D-07 precedent.
// Uniform dryRun + writable inheritance across the tool surface. The
// endpoint has NO Graylog state change but the dryRun guarantee is
// project-wide for POST/PUT/DELETE — agents should never be surprised by
// "this POST didn't preview" semantics.
//
// D-07 + Discretion-03: accepts structured intent OR raw ruleSource (mutual
// exclusion via .refine on the schema). When `structured` is set, the
// wrapper compiles via emit.js BEFORE forwarding to /simulate — single
// agent flow: compose structured intent → simulate → tweak → apply.
//
// C4 GATE CARRIED FORWARD: parse pre-flight at /api/system/pipelines/rule/parse
// before /simulate. On parse failure (400 + ParseError[]), refuses with
// reason:rule_parse_failed; /simulate NEVER fires. Reuses the same
// preflightParseRule shape Plan 04-03 ships in create-pipeline-rule.js but
// inlined here so simulate stays self-contained (the create-pipeline-rule
// export is also available; we duplicate the shape so simulate doesn't
// depend on create's export contract).

import { defineMutatingHandler } from "../_shared/handler.js";
import { SimulatePipelineRuleSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { GraylogValidationError } from "../../graylog/errors.js";
import { emitRule } from "../../pipeline-dsl/emit.js";

/**
 * Parse pre-flight against POST /api/system/pipelines/rule/parse.
 *
 * Mirror of create-pipeline-rule.js's preflightParseRule. Inlined here so
 * simulate is self-contained (no cross-module export dependency). Both
 * functions emit the same `rule_parse_failed` reason and Pitfall 6
 * camelCase→snake_case translation.
 *
 * @param {object} client
 * @param {string} source
 * @returns {Promise<{ ok: true }>}
 * @throws GraylogValidationError(reason:"rule_parse_failed") on 400
 */
async function preflightParseRule(client, source) {
    try {
        await client.request(
            "POST",
            "/api/system/pipelines/rule/parse",
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

export const handleSimulatePipelineRule = defineMutatingHandler({
    name: "simulate_pipeline_rule",
    schema: SimulatePipelineRuleSchema,
    async build(args) {
        const client = makeClient(args._conn);

        // 1. Resolve effective DSL source — either compile from structured
        //    intent (D-11 emit.js routes every literal through escape.js)
        //    or forward the raw string verbatim. The schema's .refine has
        //    already enforced mutual exclusion.
        const source = args.structured ? emitRule(args.structured) : args.ruleSource;

        // 2. Server-authoritative parse pre-flight (C4 GATE carried forward).
        //    Throws GraylogValidationError(reason:"rule_parse_failed") on 400;
        //    handler.js routes through wrapGraylogError and apply NEVER runs.
        const parseResult = await preflightParseRule(client, source);

        // 3. CRITICAL — Pitfall 1: body.message is JSON-STRINGIFIED.
        //    The agent's friendly `args.message` is a JS object; the wire
        //    field is typed `String`. JSON.stringify is the single load-
        //    bearing line that makes this tool work.
        const body = {
            message: JSON.stringify(args.message),
            rule_source: { source },
        };

        return {
            method: "POST",
            path: "/api/system/pipelines/rule/simulate",
            body,
            parseResult,
            postApplyEstimate: { message: "__SERVER_ASSIGNED__" },
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        args.structured
            ? `Simulate pipeline rule "${args.structured.name}" against ${Object.keys(args.message).length} field(s)`
            : `Simulate pipeline rule against ${Object.keys(args.message).length} field(s)`,
});
