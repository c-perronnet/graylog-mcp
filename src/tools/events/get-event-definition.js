// EVENT-02 — get_event_definition. Returns the FULL EventDefinitionDto
// including:
//   - scheduler (READ_ONLY per Pitfall 5) — agent reads here, NEVER echoes
//     back through update_event_definition (STRICT_NO_ECHO prevents
//     contamination structurally; this read tool is the canonical surface
//     for inspecting scheduler state).
//   - notifications[] — Plan 05-03 delete_event_definition's informational
//     cascade (D-08) reads this list to surface which notifications WOULD
//     lose their link when the definition is deleted.
//   - config (EventProcessorConfig discriminated union, kept permissive at
//     the schema layer — see EventDefinitionDtoSchema for rationale).
//   - field_spec / key_spec — agent sees the aggregation key set for
//     dashboards / drill-down references.
//
// Pattern: plain async handler (NOT defineListHandler) — single-DTO read
// tool. Mirrors src/tools/streams/get-stream.js + src/tools/inputs/get-input.js.
// The framework's narrow-projection machinery is bypassed entirely; the
// full DTO is the agent-facing surface.
//
// 404 surfaces via wrapGraylogError so the error envelope embeds the tool
// name for agent-debuggability and the upstream Graylog status code is
// preserved on `err.status`.

import { GetEventDefinitionSchema } from "./schemas.js";
import { resolveConnection } from "../_shared/connection.js";
import { makeClient } from "../../graylog/client.js";
import {
    errorResponse,
    formatZodError,
    wrapGraylogError,
} from "../_shared/errors.js";

export async function handleGetEventDefinition(request) {
    const rawArgs = request?.params?.arguments ?? {};

    // 1. Validate (FOUND-05). definitionId is required (z.string().min(1)).
    let args;
    try {
        args = GetEventDefinitionSchema.parse(rawArgs);
    } catch (err) {
        return errorResponse(formatZodError(err));
    }

    // 2. Resolve connection — _testConnection seam re-merged from pre-zod
    //    args (handler.js convention; threat-model T-00-04-05 — seam absent
    //    from GetEventDefinitionSchema, so zod's default strip drops it
    //    from production-agent payloads).
    const seamArgs = rawArgs._testConnection
        ? { ...args, _testConnection: rawArgs._testConnection }
        : args;
    const { conn, name: connectionName, error } = resolveConnection(seamArgs);
    if (error) return error;

    // 3. Fire the GET. Wire path: /api/events/definitions/{id} — see
    //    05-RESEARCH.md §"Per-Tool Endpoint Map" line 558.
    try {
        const client = makeClient(conn);
        const definition = await client.request(
            "GET",
            `/api/events/definitions/${args.definitionId}`,
            null,
        );
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    tool: "get_event_definition",
                    connection: connectionName,
                    definition,
                }),
            }],
        };
    } catch (err) {
        return wrapGraylogError(err, "get_event_definition");
    }
}
