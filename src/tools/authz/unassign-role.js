// ROLE-06 / AUTHZ-01 — unassign_role.
//
// DELETE /api/roles/{encoded(name)}/members/{encoded(username)}; 204 on success.
//
// THE LOAD-BEARING SAFETY PROPERTY (Plan 11-01 Test 20): the last-admin
// guard refuses with `reason: "would_leave_no_admin"` when removing the
// only Admin would lock the instance out. Graylog has NO server-side
// guard for this (D-17 / Pitfall 5) — this client-side check is the only
// thing standing between an agent and instance lockout. Belt-and-braces.
//
// IMPORTANT — D-18 / AP4 ASYMMETRY: this handler deliberately does NOT
// call assertRoleIsMutable. Unassigning a user FROM a built-in role
// (e.g. removing someone from Reader) is LEGITIMATE — only mutating the
// role itself is refused (update_role, delete_role). The grep gate in
// Plan 11-02 acceptance criteria verifies this absence.
//
// Build sequence:
//   1. Pre-flight GET /api/roles/{name} — confirms role exists
//   2. Pre-flight GET /api/authz/roles/user/{username} — current roles
//      (404 → user_not_found)
//   3. D-11 refusal: user is not currently a member → not_currently_assigned
//   4. D-17 last-admin guard: if roleName.toLowerCase() === "admin",
//      fetch /api/roles/Admin/members and refuse if removing this user
//      would leave zero admins
//   5. Confirmation token includes current_roles_hash for drift refusal (D-14)
//   6. Descriptor: DELETE with no body (server returns 204)
//
// Encodes: D-09, D-11, D-12, D-14, D-17, D-23, Pitfall 5.

import { defineMutatingHandler } from "../_shared/handler.js";
import { UnassignRoleSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { tagError, sortedRolesHash } from "./role-helpers.js";
import { computeRoleCascadeHash } from "../_shared/cascade-hash.js";

export const handleUnassignRole = defineMutatingHandler({
    name: "unassign_role",
    schema: UnassignRoleSchema,

    async build(args) {
        const client = makeClient(args._conn);

        const encodedRole = encodeURIComponent(args.roleName);
        const encodedUser = encodeURIComponent(args.username);

        // 1. Pre-flight role GET — confirms existence.
        try {
            await client.request("GET", `/api/roles/${encodedRole}`, null);
        } catch (err) {
            if (err?.isGraylogError && err.status === 404) {
                throw tagError(err, "role_not_found");
            }
            throw err;
        }

        // 2. Pre-flight user-roles GET.
        let userRolesResponse;
        try {
            userRolesResponse = await client.request(
                "GET",
                `/api/authz/roles/user/${encodedUser}`,
                null,
            );
        } catch (err) {
            if (err?.isGraylogError && err.status === 404) {
                throw tagError(err, "user_not_found");
            }
            throw err;
        }
        const userRoles = Array.isArray(userRolesResponse?.roles)
            ? userRolesResponse.roles
                .map((r) => r?.name)
                .filter((n) => typeof n === "string" && n.length > 0)
            : [];

        // 3. D-11 — refuse if user is not currently a member. The agent
        //    should call get_role or check current_roles first.
        if (!userRoles.includes(args.roleName)) {
            throw tagError(
                new Error(
                    `not_currently_assigned: user "${args.username}" is not a ` +
                    `member of role "${args.roleName}" — current roles: ` +
                    `[${userRoles.join(", ")}]`,
                ),
                "not_currently_assigned",
            );
        }

        // 4. D-17 / Pitfall 5 — LAST-ADMIN GUARD. If removing this user
        //    from Admin would leave zero admins, refuse with
        //    would_leave_no_admin. Belt-and-braces — Graylog has no
        //    server-side guard for this (a successful unassign of the
        //    last Admin would lock the instance out permanently).
        if (args.roleName.toLowerCase() === "admin") {
            const adminMembers = await client.request(
                "GET",
                "/api/roles/Admin/members",
                null,
            );
            const adminUsers = Array.isArray(adminMembers?.users) ? adminMembers.users : [];
            const remainingAdmins = adminUsers.filter(
                (u) => u?.username !== args.username,
            );
            if (remainingAdmins.length === 0) {
                throw tagError(
                    new Error(
                        `would_leave_no_admin: removing ${args.username} from Admin ` +
                        `leaves zero admins (instance lockout) — refuse client-side ` +
                        `(D-17, no server-side guard exists)`,
                    ),
                    "would_leave_no_admin",
                );
            }
        }

        // 5. D-14 confirmation token — drift refusal anchor.
        const confirmationToken = computeRoleCascadeHash({
            tool: "unassign_role",
            roleName: args.roleName,
            username: args.username,
            current_roles_hash: sortedRolesHash(userRoles),
        });

        // 6. Descriptor — DELETE with NO body (Graylog returns 204).
        const cascades = {
            current_roles: userRoles,
            roles_after_apply: userRoles.filter((r) => r !== args.roleName),
        };
        return {
            method: "DELETE",
            path: `/api/roles/${encodedRole}/members/${encodedUser}`,
            body: null,
            _confirmationToken: confirmationToken,
            cascades,
            // Plan 11-02 (D-14): also surface in preview.cascades for
            // symmetry with assign_role and to keep the dry-run preview's
            // safety-relevant payload co-located with the DELETE shape.
            previewCascades: cascades,
            postApplyEstimate: {
                id: `${args.roleName}/${args.username}`,
                async: false,
            },
        };
    },

    apply: async (client, req) => {
        try {
            return await client.request(req.method, req.path, req.body);
        } catch (err) {
            if (err?.isGraylogError && err.status === 404) {
                err.reason = "user_not_found";
                throw err;
            }
            if (
                err?.isGraylogError
                && err.status === 400
                && err.body?.type === "RequestError"
            ) {
                return {
                    isError: true,
                    reason: "role_validation_failed",
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            tool: "unassign_role",
                            status: 400,
                            path: err.body.path,
                            reference_path: err.body.reference_path,
                            message: err.body.message,
                        }),
                    }],
                };
            }
            throw err;
        }
    },

    summarize: (args) => `Unassign role "${args.roleName}" from user "${args.username}"`,

    requireConfirm: ({ req }) => req._confirmationToken ?? null,
});
