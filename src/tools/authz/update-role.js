// ROLE-03 / AUTHZ-01 — update_role.
//
// PUT /api/roles/{encoded(name)} with FULL-REPLACE body (D-15 PITFALL 1).
//
// THE LOAD-BEARING SAFETY PROPERTY: the body MUST contain
//   { name, description, permissions, read_only:false }
// where `permissions` is the agent's full target set verbatim. A naive
// PATCH-style body (just permissions, missing name) returns 400 from
// RolesResource's @JsonCreator. A naive body that merges new perms into
// current would silently drop the agent's intent. Plan 11-01 Test 8
// (the PITFALL 1 ACCEPTANCE GATE) pins this contract.
//
// Build sequence:
//   1. assertRoleIsMutable(roleName) — D-18 client-side fast-path; refuses
//      built-ins BEFORE any HTTP call (parameterized loop in Plan 11-01
//      Test 22 asserts 0 HTTP calls fire for each of the 16 built-ins)
//   2. Pre-flight GET /api/roles/{name} — D-15 read-merge-write read step
//   3. Server-side read_only:true backstop — D-19 AUTHORITATIVE refusal
//      (the static set is fast-path; the server flag is the source of truth)
//   4. Permission catalogue validation (D-01 / D-04; same shape as create_role)
//   5. computePermissionsDiff for cascades.diff preview (D-15)
//   6. Confirmation token includes current_permissions_hash for drift refusal
//      (D-14 TOCTOU — Plan 11-01 Test 11 verifies)
//   7. Descriptor: PUT body echoes args.permissions verbatim (full-replace)
//
// Encodes: D-12, D-15, D-18, D-19, D-14, D-01, D-04, D-23.

import { defineMutatingHandler } from "../_shared/handler.js";
import { UpdateRoleSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import {
    assertRoleIsMutable,
    tagError,
    fetchPermissionCatalogue,
    validatePermissionsAgainstCatalogue,
    computePermissionsDiff,
    sortedPermissionsHash,
} from "./role-helpers.js";
import { computeRoleCascadeHash } from "../_shared/cascade-hash.js";

export const handleUpdateRole = defineMutatingHandler({
    name: "update_role",
    schema: UpdateRoleSchema,

    async build(args) {
        const client = makeClient(args._conn);

        // 1. D-18 client-side fast-path. Parameterized 16-built-in loop
        //    (Plan 11-01 Test 22) requires this fire BEFORE the GET.
        try {
            assertRoleIsMutable(args.roleName);
        } catch (err) {
            throw tagError(err, "builtin_role_immutable");
        }

        // 2. D-15 pre-flight GET — the read step of read-merge-write.
        const encodedName = encodeURIComponent(args.roleName);
        let current;
        try {
            current = await client.request("GET", `/api/roles/${encodedName}`, null);
        } catch (err) {
            if (err?.isGraylogError && err.status === 404) {
                throw tagError(err, "role_not_found");
            }
            throw err;
        }

        // 3. D-19 server-side read_only backstop — the AUTHORITATIVE refusal.
        //    If a built-in slips past Step 1 (e.g. name not in the static
        //    Set because a future Graylog version added one), the live
        //    `read_only:true` flag refuses here.
        if (current?.read_only === true) {
            throw tagError(
                new Error(
                    `role "${args.roleName}" is server-read-only (current.read_only:true) ` +
                    `— cannot mutate`,
                ),
                "builtin_role_immutable",
            );
        }

        const targetPermissions = Array.isArray(args.permissions) ? args.permissions : [];
        const currentPermissions = Array.isArray(current?.permissions) ? current.permissions : [];
        const description = args.description ?? current?.description ?? "";

        // 4. D-01 / D-04 catalogue validation (same shape as create_role).
        const warnings = {};
        if (args.permitUnknownPermissions === true) {
            warnings.unknown_permissions = [...targetPermissions];
        } else {
            const catalogue = await fetchPermissionCatalogue(client, args._conn);
            const { invalid } = validatePermissionsAgainstCatalogue(catalogue, targetPermissions);
            if (invalid.length > 0) {
                throw tagError(
                    new Error(
                        `unknown_permission: the following permission strings ` +
                        `are not in the live Graylog catalogue ` +
                        `(GET /api/system/permissions): ${invalid.join(", ")} ` +
                        `— pass permitUnknownPermissions:true to opt out (D-04)`,
                    ),
                    "unknown_permission",
                );
            }
        }
        if (targetPermissions.includes("*")) {
            warnings.includes_wildcard = [
                "role includes wildcard '*' — equivalent to Admin super-permission",
            ];
        }

        // 5. D-15 diff preview — shows the agent what's about to change.
        const diff = computePermissionsDiff(currentPermissions, targetPermissions);

        // 6. D-14 confirmation token — current_permissions_hash binds the
        //    token to the pre-apply state; any drift between dry-run and
        //    apply changes the hash → requireConfirm refuses.
        const confirmationToken = computeRoleCascadeHash({
            tool: "update_role",
            name: args.roleName,
            permissions: targetPermissions,
            description,
            current_permissions_hash: sortedPermissionsHash(currentPermissions),
        });

        // 7. PITFALL 1 — body MUST include name + description + full
        //    target permissions + read_only:false. Plan 11-01 Test 8
        //    grep-asserts every field.
        const cascades = { diff };
        if (Object.keys(warnings).length > 0) {
            cascades.warnings = warnings;
        }
        return {
            method: "PUT",
            path: `/api/roles/${encodedName}`,
            body: {
                name: args.roleName,
                description,
                permissions: targetPermissions,
                read_only: false,
            },
            _confirmationToken: confirmationToken,
            cascades,
            // Plan 11-02 (D-15): also surface in preview.cascades so the
            // dry-run preview test (Plan 11-01 Test 10) sees
            // payload.preview.cascades.diff alongside the body shape.
            previewCascades: cascades,
            postApplyEstimate: { id: args.roleName, async: false },
        };
    },

    apply: async (client, req) => {
        try {
            return await client.request(req.method, req.path, req.body);
        } catch (err) {
            // 400 ApiError with /read only/i → server-side built-in backstop.
            if (
                err?.isGraylogError
                && err.status === 400
                && err.body?.type === "ApiError"
                && /read only/i.test(err.body.message ?? "")
            ) {
                err.reason = "builtin_role_immutable";
                throw err;
            }
            // 400 RequestError → structured role_validation_failed envelope.
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
                            tool: "update_role",
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

    summarize: (args) => `Update role "${args.roleName}" — full-replace ${(args.permissions ?? []).length} permissions`,

    requireConfirm: ({ req }) => req._confirmationToken ?? null,
});
