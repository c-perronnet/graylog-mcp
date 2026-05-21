// ROLE-01 — list_roles. Plain-async handler.
//
// Mirrors src/tools/authz/list-grantees.js:22-69 line-for-line — same
// plain-async shape (NOT defineListHandler; the response is a flat array of
// role DTOs, not a paginated list with the cross-cutting limit/fields
// projection machinery). Single GET /api/roles, no pre-flight, no cascade.
//
// Encodes:
//   - D-06  ships as one of the 7 role tools (catalogue/dispatch entries in
//           Plan 11-01)
//   - D-07  no per-role member counts at list time (no N+1 round-trips —
//           agents who need members call get_role per role)
//   - D-08  the nameFilter is a CLIENT-SIDE case-insensitive substring
//           match applied to response.roles after the GET; the legacy
//           /api/roles endpoint has no server-side filter parameter (the
//           paginated /api/authz/roles endpoint does, but Plan 11-01 D-06
//           pins the legacy path)

import { ListRolesSchema } from "./schemas.js";
import { resolveConnection } from "../_shared/connection.js";
import { makeClient } from "../../graylog/client.js";
import {
    errorResponse,
    formatZodError,
    wrapGraylogError,
} from "../_shared/errors.js";

export async function handleListRoles(request) {
    const rawArgs = request?.params?.arguments ?? {};

    // 1. Validate.
    let args;
    try {
        args = ListRolesSchema.parse(rawArgs);
    } catch (err) {
        return errorResponse(formatZodError(err));
    }

    // 2. Resolve connection — _testConnection seam re-merged from pre-zod args
    //    (handler.js:88-90 precedent for plain-async handlers).
    const seamArgs = rawArgs._testConnection
        ? { ...args, _testConnection: rawArgs._testConnection }
        : args;
    const { conn, name: connectionName, error } = resolveConnection(seamArgs);
    if (error) return error;

    // 3. GET /api/roles + project + optional nameFilter.
    try {
        const client = makeClient(conn);
        const response = await client.request("GET", "/api/roles", null);
        const allRoles = Array.isArray(response?.roles) ? response.roles : [];
        // D-08 client-side nameFilter — case-insensitive substring on .name.
        const filtered = (typeof args.nameFilter === "string" && args.nameFilter.length > 0)
            ? allRoles.filter((r) =>
                typeof r?.name === "string"
                && r.name.toLowerCase().includes(args.nameFilter.toLowerCase()),
            )
            : allRoles;
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    tool: "list_roles",
                    connection: connectionName,
                    roles: filtered,
                    count: filtered.length,
                }),
            }],
        };
    } catch (err) {
        return wrapGraylogError(err, "list_roles");
    }
}
