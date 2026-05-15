// STREAM-02 — get_stream. Returns the FULL StreamResponse DTO including the
// embedded `rules: [...]` list (Graylog's natural shape; verified at
// `03-RESEARCH.md §Endpoint Catalogue #2`). The wire field `is_editable` is
// preserved verbatim on the agent-facing response — get_stream is the rich
// read; the projection-to-`mutable` is a `list_streams`-specific ergonomic
// per Pitfall S2 (the wrapper does not double-up two names for the same
// field on a single DTO; agents using `get_stream` for a single-stream view
// see the wire field name and can decide whether to project locally).
//
// Pattern: plain async handler (NOT defineListHandler) because this is not
// a list — the response is a single DTO; the framework's narrow-projection
// machinery would mangle the embedded rules array (every rule's nested
// fields would be lost to a flat key-pick).
//
// Mirrors src/tools/inputs/get-input.js and the get-index-set.js pattern.

import { GetStreamSchema } from "./schemas.js";
import { resolveConnection } from "../_shared/connection.js";
import { makeClient } from "../../graylog/client.js";
import {
    errorResponse,
    formatZodError,
    wrapGraylogError,
} from "../_shared/errors.js";

export async function handleGetStream(request) {
    const rawArgs = request?.params?.arguments ?? {};

    // 1. Validate (FOUND-05). streamId is required.
    let args;
    try {
        args = GetStreamSchema.parse(rawArgs);
    } catch (err) {
        return errorResponse(formatZodError(err));
    }

    // 2. Resolve connection — _testConnection seam re-merged from pre-zod
    //    args so production agents can never bypass the connection lookup
    //    (the seam is intentionally absent from GetStreamSchema; zod's
    //    default `strip` mode drops it from real-agent payloads).
    const seamArgs = rawArgs._testConnection
        ? { ...args, _testConnection: rawArgs._testConnection }
        : args;
    const { conn, name: connectionName, error } = resolveConnection(seamArgs);
    if (error) return error;

    // 3. Fire the GET. Errors map through wrapGraylogError so 404 (stream not
    //    found) surfaces as a clean MCP error envelope with `get_stream`
    //    embedded in the rendered text for agent-debuggability.
    try {
        const client = makeClient(conn);
        const stream = await client.request(
            "GET",
            `/api/streams/${args.streamId}`,
            null,
        );
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    tool: "get_stream",
                    connection: connectionName,
                    stream,
                }),
            }],
        };
    } catch (err) {
        return wrapGraylogError(err, "get_stream");
    }
}
