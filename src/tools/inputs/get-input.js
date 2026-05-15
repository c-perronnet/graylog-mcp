// INPUT-03: get_input — fetch a single InputSummary by ID.
//
// Plain async handler (NOT defineListHandler) because the response is a single
// DTO, not a projected list — the framework's narrow-projection / limit
// machinery would mangle it. Returns the full InputSummary including the
// configuration map; encrypted fields surface as their server-supplied
// placeholders (<value hidden>, <password set>) because Graylog masks them
// before they leave the API (AbstractInputsResource.maskPasswordsInConfiguration).
// The MCP NEVER unmasks.

import { GetInputSchema } from "./schemas.js";
import { resolveConnection } from "../_shared/connection.js";
import { makeClient } from "../../graylog/client.js";
import {
    errorResponse,
    formatZodError,
    wrapGraylogError,
} from "../_shared/errors.js";

export async function handleGetInput(request) {
    const rawArgs = request?.params?.arguments ?? {};

    // 1. Validate (FOUND-05). inputId is required.
    let args;
    try {
        args = GetInputSchema.parse(rawArgs);
    } catch (err) {
        return errorResponse(formatZodError(err));
    }

    // 2. Resolve connection — _testConnection seam re-merged from pre-zod args
    //    so production agents can never bypass the connection lookup (the seam
    //    is intentionally absent from GetInputSchema; zod's default `strip`
    //    mode drops it from real-agent payloads).
    const seamArgs = rawArgs._testConnection
        ? { ...args, _testConnection: rawArgs._testConnection }
        : args;
    const { conn, name: connectionName, error } = resolveConnection(seamArgs);
    if (error) return error;

    // 3. Fire the GET. Errors map through wrapGraylogError so 404 (input not
    //    found) surfaces as a clean MCP error envelope rather than a thrown
    //    GraylogError.
    try {
        const client = makeClient(conn);
        const dto = await client.request(
            "GET",
            `/api/system/inputs/${args.inputId}`,
            null,
        );
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    tool: "get_input",
                    connection: connectionName,
                    input: dto,
                }),
            }],
        };
    } catch (err) {
        return wrapGraylogError(err, "get_input");
    }
}
