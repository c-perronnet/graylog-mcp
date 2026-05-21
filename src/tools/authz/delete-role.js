// ROLE-04 / AUTHZ-01 — delete_role.
//
// DELETE /api/roles/{encoded(name)}.
//
// Server-side, deleting a role cascade-dissociates ALL its members (no
// dry-run on the server). The agent must see who's about to lose the role
// BEFORE token-confirm. Plan 11-02 implements this client-side:
//
// Build sequence:
//   1. assertRoleIsMutable(roleName) — D-18 client-side fast-path; refuses
//      built-ins BEFORE any HTTP call (Plan 11-01 Test 23 — 16-built-in
//      parameterized loop with 0 HTTP calls)
//   2. Pre-flight GET /api/roles/{name} — D-19 server-side read_only backstop
//   3. Pre-flight GET /api/roles/{name}/members — D-16 cascade preview source
//   4. Project cascades.users_dissociated as {username, roles_before, roles_after}
//      per D-16 (NOT the full UserSummary; agent only needs the impact set)
//   5. Confirmation token includes members_hash for drift refusal (D-14 TOCTOU
//      — Plan 11-01 Test 13 verifies)
//   6. Descriptor: DELETE with no body (204 expected)
//
// Encodes: D-12, D-16, D-18, D-19, D-14, D-23.

import { defineMutatingHandler } from "../_shared/handler.js";
import { DeleteRoleSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import {
    assertRoleIsMutable,
    tagError,
    sortedRolesHash,
} from "./role-helpers.js";
import { computeRoleCascadeHash } from "../_shared/cascade-hash.js";

export const handleDeleteRole = defineMutatingHandler({
    name: "delete_role",
    schema: DeleteRoleSchema,

    async build(args) {
        const client = makeClient(args._conn);

        // 1. D-18 client-side fast-path — fires BEFORE any HTTP call so the
        //    16-built-in parameterized loop (Plan 11-01 Test 23) asserts
        //    0 GETs for every built-in.
        try {
            assertRoleIsMutable(args.roleName);
        } catch (err) {
            throw tagError(err, "builtin_role_immutable");
        }

        const encodedName = encodeURIComponent(args.roleName);

        // 2. D-19 server-side read_only backstop via pre-flight GET role.
        let current;
        try {
            current = await client.request("GET", `/api/roles/${encodedName}`, null);
        } catch (err) {
            if (err?.isGraylogError && err.status === 404) {
                throw tagError(err, "role_not_found");
            }
            throw err;
        }
        if (current?.read_only === true) {
            throw tagError(
                new Error(
                    `role "${args.roleName}" is server-read-only (current.read_only:true) ` +
                    `— cannot delete`,
                ),
                "builtin_role_immutable",
            );
        }

        // 3. D-16 cascade preview — fetch the full member list.
        const membersResponse = await client.request(
            "GET",
            `/api/roles/${encodedName}/members`,
            null,
        );
        const memberUsers = Array.isArray(membersResponse?.users) ? membersResponse.users : [];

        // 4. Project users_dissociated. D-16 SHAPE: {username, roles_before,
        //    roles_after} — roles_after omits the role being deleted
        //    (case-insensitive compare to mirror the server's RoleService
        //    delete semantics).
        const targetLower = args.roleName.toLowerCase();
        const users_dissociated = memberUsers.map((u) => {
            const rolesBefore = Array.isArray(u?.roles) ? u.roles : [];
            const rolesAfter = rolesBefore.filter(
                (r) => typeof r === "string" && r.toLowerCase() !== targetLower,
            );
            return {
                username: u?.username ?? null,
                roles_before: rolesBefore,
                roles_after: rolesAfter,
            };
        });

        // 5. D-14 drift-refusal anchor — members_hash binds the token to
        //    the pre-apply member set. Plan 11-01 Test 13 asserts that a
        //    new member appearing between dry-run and apply trips the
        //    confirmation_mismatch gate.
        const memberUsernames = memberUsers
            .map((u) => u?.username)
            .filter((u) => typeof u === "string" && u.length > 0);
        const confirmationToken = computeRoleCascadeHash({
            tool: "delete_role",
            name: args.roleName,
            members_hash: sortedRolesHash(memberUsernames),
        });

        const cascades = {
            users_dissociated,
            count: users_dissociated.length,
        };
        return {
            method: "DELETE",
            path: `/api/roles/${encodedName}`,
            body: null,
            _confirmationToken: confirmationToken,
            cascades,
            // Plan 11-02 (D-16): also surface in preview.cascades so the
            // cascade-preview test (Plan 11-01 Test 12) sees
            // payload.preview.cascades.users_dissociated alongside the
            // DELETE shape.
            previewCascades: cascades,
            postApplyEstimate: { id: args.roleName, async: false },
        };
    },

    apply: async (client, req) => {
        try {
            return await client.request(req.method, req.path, req.body);
        } catch (err) {
            if (
                err?.isGraylogError
                && err.status === 400
                && err.body?.type === "ApiError"
                && /read only/i.test(err.body.message ?? "")
            ) {
                err.reason = "builtin_role_immutable";
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
                            tool: "delete_role",
                            status: 400,
                            path: err.body.path,
                            reference_path: err.body.reference_path,
                            message: err.body.message,
                        }),
                    }],
                };
            }
            if (err?.isGraylogError && err.status === 404) {
                err.reason = "role_not_found";
                throw err;
            }
            throw err;
        }
    },

    summarize: (args) => `Delete role "${args.roleName}" (cascade-dissociates all members)`,

    requireConfirm: ({ req }) => req._confirmationToken ?? null,
});
