// PIPE-07 — get_pipeline_rule. GET /api/system/pipelines/rule/{id}.
//
// Returns the full RuleSource DTO including the raw `source` DSL text,
// rule_builder, and simulator_message. Pitfall 3 (rule variant) enforced:
// literal `rule` segment in the path.
//
// Pattern: plain async handler (NOT defineListHandler) because this is not
// a list — the response is a single DTO; the framework's narrow-projection
// machinery would mangle the embedded rule_builder structure.
//
// Mirrors src/tools/pipelines/get-pipeline.js (PIPE-02) — same shape, rule
// endpoint instead of pipeline.

import { GetPipelineRuleSchema } from "./schemas.js";
import { resolveConnection } from "../_shared/connection.js";
import { makeClient } from "../../graylog/client.js";
import {
    errorResponse,
    formatZodError,
    wrapGraylogError,
} from "../_shared/errors.js";

export async function handleGetPipelineRule(request) {
    const rawArgs = request?.params?.arguments ?? {};

    // 1. Validate (FOUND-05). ruleId is required.
    let args;
    try {
        args = GetPipelineRuleSchema.parse(rawArgs);
    } catch (err) {
        return errorResponse(formatZodError(err));
    }

    // 2. Resolve connection — _testConnection seam re-merged from pre-zod
    //    args so production agents can never bypass the connection lookup.
    //    The seam is intentionally absent from GetPipelineRuleSchema; zod's
    //    default `strip` mode drops it from real-agent payloads.
    const seamArgs = rawArgs._testConnection
        ? { ...args, _testConnection: rawArgs._testConnection }
        : args;
    const { conn, name: connectionName, error } = resolveConnection(seamArgs);
    if (error) return error;

    // 3. Fire the GET. Errors map through wrapGraylogError so 404 (rule not
    //    found) surfaces as a clean MCP error envelope with `get_pipeline_rule`
    //    embedded in the rendered text for agent-debuggability.
    try {
        const client = makeClient(conn);
        const rule = await client.request(
            "GET",
            `/api/system/pipelines/rule/${args.ruleId}`,   // Pitfall 3 (rule variant)
            null,
        );
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    tool: "get_pipeline_rule",
                    connection: connectionName,
                    rule,
                }),
            }],
        };
    } catch (err) {
        return wrapGraylogError(err, "get_pipeline_rule");
    }
}
