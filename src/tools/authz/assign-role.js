// ROLE-05 / AUTHZ-01 — assign_role.
//
// PUT /api/roles/{encoded(name)}/members/{encoded(username)} with body={}.
//
// THE LOAD-BEARING SAFETY PROPERTY (Plan 11-01 Test 14): the PUT body MUST
// be the LITERAL empty object `{}`, NEVER null. Per Graylog source
// (RolesResource.java:256): "Placeholder because PUT requests should have
// a body. Set to '{}', the content will be ignored." Passing `null` makes
// src/graylog/client.js:53-59 skip the Content-Type header, and Graylog
// 7.x responds with 415 Unsupported Media Type. The body=={} discipline is
// the same one src/tools/authz/prepare-share.js:44 uses for /prepare.
//
// IMPORTANT — D-18 / AP4 ASYMMETRY: this handler deliberately does NOT
// call assertRoleIsMutable. Assigning a user to a built-in role (e.g.
// Reader, MCP Server Access) is LEGITIMATE — only mutating the role
// itself is refused (update_role, delete_role). The grep gate in Plan
// 11-02 acceptance criteria verifies this absence.
//
// Build sequence:
//   1. Pre-flight GET /api/roles/{name} — confirms the role exists
//      (404 → reason=role_not_found) AND gives the apply-time read_only
//      flag (no client-side built-in refusal — built-ins ARE assignable)
//   2. Pre-flight GET /api/authz/roles/user/{username} — current user roles
//      (404 → reason=user_not_found). Extract list via response.roles[].name.
//   3. alreadyMember = userRoles.includes(roleName)
//   4. Confirmation token includes current_roles_hash for drift refusal (D-14)
//   5. Descriptor: PUT body={}, normalize() returns {result:"no_change"}
//      when alreadyMember was true at preview-time (D-10 idempotency)
//
// Encodes: D-09, D-10, D-12, D-14, D-23, Pitfall 3 / AP1.

import { defineMutatingHandler } from "../_shared/handler.js";
import { AssignRoleSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { tagError, sortedRolesHash } from "./role-helpers.js";
import { computeRoleCascadeHash } from "../_shared/cascade-hash.js";

export const handleAssignRole = defineMutatingHandler({
    name: "assign_role",
    schema: AssignRoleSchema,

    async build(args) {
        const client = makeClient(args._conn);

        const encodedRole = encodeURIComponent(args.roleName);
        const encodedUser = encodeURIComponent(args.username);

        // 1. Pre-flight role GET — confirms existence; 404 → role_not_found.
        try {
            await client.request("GET", `/api/roles/${encodedRole}`, null);
        } catch (err) {
            if (err?.isGraylogError && err.status === 404) {
                throw tagError(err, "role_not_found");
            }
            throw err;
        }

        // 2. Pre-flight user-roles GET — confirms existence + current roles.
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

        // 3. D-10 already-member idempotency check.
        const alreadyMember = userRoles.includes(args.roleName);

        // 4. D-14 confirmation token — current_roles_hash binds the token
        //    to the pre-apply user-role state. Drift (e.g. user picks up
        //    new role between dry-run and apply) trips confirmation_mismatch.
        const confirmationToken = computeRoleCascadeHash({
            tool: "assign_role",
            roleName: args.roleName,
            username: args.username,
            current_roles_hash: sortedRolesHash(userRoles),
        });

        // 5. D-10 preview shape: {current_roles, roles_after_apply, already_member}.
        const rolesAfterApply = alreadyMember
            ? [...userRoles]
            : [...userRoles, args.roleName].sort();

        const cascades = {
            current_roles: userRoles,
            roles_after_apply: rolesAfterApply,
            already_member: alreadyMember,
        };
        return {
            method: "PUT",
            path: `/api/roles/${encodedRole}/members/${encodedUser}`,
            // PITFALL 3 / AP1 — LITERAL EMPTY OBJECT, NEVER null. Plan
            // 11-01 Test 14 grep-asserts `body: {}` and `body !== null`.
            // Sending null skips Content-Type and Graylog 7.x 415s.
            body: {},
            _confirmationToken: confirmationToken,
            existingMatches: alreadyMember
                ? [{
                    username: args.username,
                    similarity_reason: "already_assigned",
                }]
                : [],
            cascades,
            // Plan 11-02 (D-10): also surface in preview.cascades so the
            // current_roles + roles_after_apply test (Plan 11-01 Test 15)
            // sees payload.preview.cascades.{current_roles, roles_after_apply,
            // already_member} alongside the PUT body=={} shape.
            previewCascades: cascades,
            postApplyEstimate: {
                id: `${args.roleName}/${args.username}`,
                async: false,
            },
            // D-10 — surface no_change in the apply envelope when the
            // pre-flight saw the user already as a member. The PUT still
            // fires (server is idempotent — returns 204) and `raw` is the
            // server response; we just relabel via normalize.
            normalize: (raw) => alreadyMember
                ? { id: `${args.roleName}/${args.username}`, body: { result: "no_change" } }
                : { id: `${args.roleName}/${args.username}`, body: raw },
        };
    },

    apply: async (client, req) => {
        try {
            return await client.request(req.method, req.path, req.body);
        } catch (err) {
            if (err?.isGraylogError && err.status === 404) {
                // 404 on apply most likely means the user disappeared
                // between pre-flight and apply (rare but possible). Tag
                // user_not_found — the role pre-flight already validated
                // the role's existence.
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
                            tool: "assign_role",
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

    summarize: (args) => `Assign role "${args.roleName}" to user "${args.username}"`,

    requireConfirm: ({ req }) => req._confirmationToken ?? null,
});
