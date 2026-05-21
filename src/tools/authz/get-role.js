// ROLE-01 — get_role. Plain-async handler with parallel GETs.
//
// Mirrors src/tools/authz/get-entity-shares.js — plain-async, NOT
// defineListHandler (the response is a nested {role, members} DTO, not a
// paginated list, and a dryRun flag is meaningless on the GET probe).
//
// Encodes:
//   - D-06  one of the 7 role tools (catalogue + dispatch from Plan 11-01)
//   - D-08  members projected to {username, full_name, email} ONLY — NOT
//           the full ~25-field UserSummary. Lets agents preview impact
//           cheaply before update_role/delete_role/unassign_role without
//           paying for the full user DTO.
//
// Parallel GETs: GET /api/roles/{encoded(name)} + GET .../members issued
// via Promise.all. The legacy /api/roles endpoint family returns 404 on
// missing role at either path — wrapGraylogError surfaces both as the
// canonical MCP error envelope.

import { GetRoleSchema } from "./schemas.js";
import { resolveConnection } from "../_shared/connection.js";
import { makeClient } from "../../graylog/client.js";
import {
    errorResponse,
    formatZodError,
    wrapGraylogError,
} from "../_shared/errors.js";

export async function handleGetRole(request) {
    const rawArgs = request?.params?.arguments ?? {};

    // 1. Validate.
    let args;
    try {
        args = GetRoleSchema.parse(rawArgs);
    } catch (err) {
        return errorResponse(formatZodError(err));
    }

    // 2. Resolve connection — _testConnection seam re-merged from raw args.
    const seamArgs = rawArgs._testConnection
        ? { ...args, _testConnection: rawArgs._testConnection }
        : args;
    const { conn, name: connectionName, error } = resolveConnection(seamArgs);
    if (error) return error;

    // 3. Parallel GETs + project members per D-08.
    try {
        const client = makeClient(conn);
        const encodedName = encodeURIComponent(args.roleName);
        const [role, membersResponse] = await Promise.all([
            client.request("GET", `/api/roles/${encodedName}`, null),
            client.request("GET", `/api/roles/${encodedName}/members`, null),
        ]);
        // D-08 projection — strip everything except {username, full_name, email}.
        const rawUsers = Array.isArray(membersResponse?.users) ? membersResponse.users : [];
        const members = rawUsers.map((u) => ({
            username: u?.username ?? null,
            full_name: u?.full_name ?? null,
            email: u?.email ?? null,
        }));
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    tool: "get_role",
                    connection: connectionName,
                    role,
                    members,
                }),
            }],
        };
    } catch (err) {
        return wrapGraylogError(err, "get_role");
    }
}
