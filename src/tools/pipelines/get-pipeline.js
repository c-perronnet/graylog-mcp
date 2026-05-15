// PIPE-02 — get_pipeline. GET /api/system/pipelines/pipeline/{id}.
//
// Returns the full PipelineSource DTO including the raw `source` DSL text
// and the `stages` array. Pitfall 3 enforced: literal `pipeline` segment.
//
// Pattern: plain async handler (NOT defineListHandler) because this is not
// a list — the response is a single DTO; the framework's narrow-projection
// machinery would mangle the embedded stages array.
//
// Mirrors src/tools/streams/get-stream.js + src/tools/inputs/get-input.js.

import { GetPipelineSchema } from "./schemas.js";
import { resolveConnection } from "../_shared/connection.js";
import { makeClient } from "../../graylog/client.js";
import {
    errorResponse,
    formatZodError,
    wrapGraylogError,
} from "../_shared/errors.js";

export async function handleGetPipeline(request) {
    const rawArgs = request?.params?.arguments ?? {};

    // 1. Validate (FOUND-05). pipelineId is required.
    let args;
    try {
        args = GetPipelineSchema.parse(rawArgs);
    } catch (err) {
        return errorResponse(formatZodError(err));
    }

    // 2. Resolve connection — _testConnection seam re-merged from pre-zod
    //    args so production agents can never bypass the connection lookup
    //    (the seam is intentionally absent from GetPipelineSchema; zod's
    //    default `strip` mode drops it from real-agent payloads).
    const seamArgs = rawArgs._testConnection
        ? { ...args, _testConnection: rawArgs._testConnection }
        : args;
    const { conn, name: connectionName, error } = resolveConnection(seamArgs);
    if (error) return error;

    // 3. Fire the GET. Errors map through wrapGraylogError so 404 (pipeline not
    //    found) surfaces as a clean MCP error envelope with `get_pipeline`
    //    embedded in the rendered text for agent-debuggability.
    try {
        const client = makeClient(conn);
        const pipeline = await client.request(
            "GET",
            `/api/system/pipelines/pipeline/${args.pipelineId}`,   // Pitfall 3
            null,
        );
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    tool: "get_pipeline",
                    connection: connectionName,
                    pipeline,
                }),
            }],
        };
    } catch (err) {
        return wrapGraylogError(err, "get_pipeline");
    }
}
