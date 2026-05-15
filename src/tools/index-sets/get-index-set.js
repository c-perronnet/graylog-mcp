// INDEX-02 — get_index_set: plain async handler returning the full
// IndexSetResponse DTO for one index set.
//
// Plain async handler (NOT defineListHandler) because the response is a
// single DTO, not a projected list — the framework's narrow-projection /
// limit machinery would mangle it. Returns the full IndexSetResponse with
// every field from RESEARCH.md §IndexSetResponse Shape: id, title,
// description, default, writable, can_be_default, index_prefix, shards,
// replicas, rotation_strategy_class, rotation_strategy{type,...},
// retention_strategy_class, retention_strategy{type,...}, creation_date,
// field_type_refresh_interval, ...

import { GetIndexSetSchema } from "./schemas.js";
import { resolveConnection } from "../_shared/connection.js";
import { makeClient } from "../../graylog/client.js";
import {
    errorResponse,
    formatZodError,
    wrapGraylogError,
} from "../_shared/errors.js";

export async function handleGetIndexSet(request) {
    const rawArgs = request?.params?.arguments ?? {};

    // 1. Validate (FOUND-05). indexSetId is required.
    let args;
    try {
        args = GetIndexSetSchema.parse(rawArgs);
    } catch (err) {
        return errorResponse(formatZodError(err));
    }

    // 2. Resolve connection — _testConnection seam re-merged from pre-zod args
    //    so production agents can never bypass the connection lookup (the seam
    //    is intentionally absent from GetIndexSetSchema; zod's default `strip`
    //    mode drops it from real-agent payloads).
    const seamArgs = rawArgs._testConnection
        ? { ...args, _testConnection: rawArgs._testConnection }
        : args;
    const { conn, name: connectionName, error } = resolveConnection(seamArgs);
    if (error) return error;

    // 3. Fire the GET. Errors map through wrapGraylogError so 404 (index set
    //    not found) surfaces as a clean MCP error envelope rather than a
    //    thrown GraylogError.
    try {
        const client = makeClient(conn);
        const body = await client.request(
            "GET",
            `/api/system/indices/index_sets/${args.indexSetId}`,
            null,
        );
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    tool: "get_index_set",
                    connection: connectionName,
                    result: { id: args.indexSetId, body },
                }),
            }],
        };
    } catch (err) {
        return wrapGraylogError(err, "get_index_set");
    }
}
