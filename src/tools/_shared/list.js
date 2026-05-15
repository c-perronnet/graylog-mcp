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
 * @param {string[]} [spec.defaultFields]  Optional per-tool projection when args.fields is absent. Falls back to DEFAULT_FIELDS.
 * @returns {(request: { params?: { arguments?: object } }) => Promise<object>}
 */
export function defineListHandler(spec) {
    const { name, schema, fetch, defaultFields } = spec;

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

        // 4. Field projection: "all" → no projection; array → custom; absent → per-tool
        //    default (spec.defaultFields) when provided, else module DEFAULT_FIELDS.
        //    Plan 01-01 BLOCKER #3 fix: list_inputs needs [id, title, type, global]
        //    instead of [id, title, description] — per-tool override avoids a bespoke
        //    projection bypass at the handler site.
        const fields = args.fields === "all"
            ? null
            : (Array.isArray(args.fields)
                ? args.fields
                : (defaultFields ?? DEFAULT_FIELDS));

        // 5. Fetch + project
        try {
            const client = makeClient(conn);
            // Pass connectionName + conn through to fetch — tools that depend on
            // per-connection caches (e.g. list_input_types → type-catalogue cache)
            // need a stable identifier without re-resolving the connection.
            const items = await fetch(client, {
                ...args,
                limit,
                _connectionName: connectionName,
                _conn: conn,
            });
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
