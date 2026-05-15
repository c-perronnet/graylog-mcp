// defineListHandler — the list-tool analog of defineMutatingHandler (FOUND-12 +
// Pitfall M6). Every list tool composes through this factory so the agent never
// receives a bloated, paginate-yourself response.
//
// Enforcement:
//   - Default narrow projection: [id, title, description] (Pitfall M6).
//   - Default limit: 25.
//   - Hard ceiling: MAX_LIMIT = 200. Anything higher silently clamps.
//   - fields: "all" opt-in returns the full item shape (for the rare debug case).
//   - fields: ["x", "y"] custom array projects to exactly those keys.
//
// Why a factory not a utility: same reason defineMutatingHandler is a factory —
// "remember to call projectList()" is a foot-gun. Factory is structural enforcement.
//
// fetch() callback is responsible for honouring `limit` server-side when the Graylog
// API supports it; the wrapper's clamping is a backstop, not a substitute for
// upstream paging.

import { resolveConnection } from "./connection.js";
import {
    errorResponse,
    wrapGraylogError,
    formatZodError,
} from "./errors.js";
import { makeClient } from "../../graylog/client.js";

export const DEFAULT_FIELDS = ["id", "title", "description"];
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 200;

/**
 * @param {object} spec
 * @param {string} spec.name
 * @param {import("zod").ZodObject} spec.schema  Zod schema extending listBase
 * @param {(client: object, args: object) => Promise<Array<object>>} spec.fetch
 * @returns {(request: { params?: { arguments?: object } }) => Promise<object>}
 */
export function defineListHandler(spec) {
    const { name, schema, fetch } = spec;

    return async function handler(request) {
        const rawArgs = request?.params?.arguments ?? {};

        // 1. Validate input
        let args;
        try {
            args = schema.parse(rawArgs);
        } catch (err) {
            return errorResponse(formatZodError(err));
        }

        // 2. Resolve connection (singleton OR per-call connectionName).
        //    _testConnection seam re-merged from pre-zod args — see handler.js
        //    for the full rationale (threat-model T-00-04-05).
        const seamArgs = rawArgs._testConnection
            ? { ...args, _testConnection: rawArgs._testConnection }
            : args;
        const { conn, name: connectionName, error } = resolveConnection(seamArgs);
        if (error) return error;

        // 3. Limit clamp (Pitfall M6 — agent context bloat protection)
        const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

        // 4. Field projection: "all" → no projection; array → custom; absent → default narrow.
        const fields = args.fields === "all"
            ? null
            : (Array.isArray(args.fields) ? args.fields : DEFAULT_FIELDS);

        // 5. Fetch + project
        try {
            const client = makeClient(conn);
            const items = await fetch(client, { ...args, limit });
            const projected = fields ? items.map((it) => projectItem(it, fields)) : items;
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        tool: name,
                        connection: connectionName,
                        count: projected.length,
                        limit,
                        fields: fields ?? "all",
                        items: projected,
                    }),
                }],
            };
        } catch (err) {
            return wrapGraylogError(err, name);
        }
    };
}

function projectItem(item, fields) {
    const out = {};
    for (const f of fields) {
        if (item[f] !== undefined) out[f] = item[f];
    }
    return out;
}
