// ROLE-02 / AUTHZ-01 — create_role.
//
// POST /api/roles with `{name, description, permissions, read_only:false}`.
// Five-step build():
//   1. assertRoleIsMutable(name) — D-18 fast-path; refuses any built-in name
//      (e.g. an agent trying to "create" Admin), case-insensitive
//   2. Permission catalogue validation (D-01 default-on; D-04 opt-out via
//      permitUnknownPermissions:true; D-03 wildcard surfaces a warning but
//      is always valid)
//   3. Compute warnings (cascades.warnings.includes_wildcard / .unknown_permissions)
//   4. Compute confirmationToken — computeRoleCascadeHash over
//      {tool, name, permissions, description}
//   5. Return descriptor — body echoes the agent's permission set verbatim
//
// Mirrors src/tools/authz/share-entity.js for structure: imports, build/apply
// shape, requireConfirm callback. The catalogue helpers live in role-helpers.js.
//
// Encodes:
//   - D-12  defaults dryRun:true (wrapper enforces; AUTHZ-01)
//   - D-18  assertRoleIsMutable client-side built-in refusal
//   - D-01  default-on permission-catalogue validation
//   - D-03  wildcard `*` accepted + warning emitted
//   - D-04  permitUnknownPermissions:true skips catalogue + surfaces warnings
//   - D-23  apply returns when HTTP 200 returns — no system-job poll
//           (RoleService.save is synchronous)

import { defineMutatingHandler } from "../_shared/handler.js";
import { CreateRoleSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import {
    assertRoleIsMutable,
    tagError,
    fetchPermissionCatalogue,
    validatePermissionsAgainstCatalogue,
} from "./role-helpers.js";
import { computeRoleCascadeHash } from "../_shared/cascade-hash.js";

export const handleCreateRole = defineMutatingHandler({
    name: "create_role",
    schema: CreateRoleSchema,

    async build(args) {
        const client = makeClient(args._conn);

        // 1. D-18 client-side built-in refusal (fast-path; no HTTP).
        try {
            assertRoleIsMutable(args.name);
        } catch (err) {
            throw tagError(err, "builtin_role_immutable");
        }

        const description = args.description ?? "";
        const permissions = Array.isArray(args.permissions) ? args.permissions : [];

        // 2. D-04 opt-out: permitUnknownPermissions:true SKIPS catalogue fetch.
        //    Otherwise (D-01 default): fetch catalogue + validate; any invalid
        //    prefix → tagError + throw with reason="unknown_permission".
        //
        // Warnings shape: an array of human-readable strings (so the test's
        //   `...(payload.preview?.cascades?.warnings ?? [])` spread works).
        // Structured per-category accessors live ALONGSIDE as named keys
        // (`includes_wildcard` / `unknown_permissions`) on the SAME warnings
        // object — that gives the test BOTH the flat-array iteration and the
        // typed `.includes_wildcard` / `.unknown_permissions` keys per
        // tests 4 + 5. The object inherits Array iterability because it IS
        // an Array; the named keys are extra own-properties.
        const warningsArray = [];
        const warningsByCategory = {};
        if (args.permitUnknownPermissions === true) {
            // D-04 — surface the unknown set in the dry-run preview so the
            // reviewer sees what's being committed.
            warningsByCategory.unknown_permissions = [...permissions];
            for (const p of permissions) {
                warningsArray.push(`unknown_permission (permitUnknownPermissions opt-out): ${p}`);
            }
        } else {
            const catalogue = await fetchPermissionCatalogue(client, args._conn);
            const { invalid } = validatePermissionsAgainstCatalogue(catalogue, permissions);
            // D-03 the wildcard `*` is always valid — never appears in
            // `invalid`. Non-wildcard invalid perms refuse before write.
            if (invalid.length > 0) {
                throw tagError(
                    new Error(
                        `unknown_permission: the following permission strings ` +
                        `are not in the live Graylog catalogue ` +
                        `(GET /api/system/permissions): ${invalid.join(", ")} ` +
                        `— pass permitUnknownPermissions:true to opt out ` +
                        `(D-04, enterprise-plugin edge case)`,
                    ),
                    "unknown_permission",
                );
            }
        }

        // 3. D-03 — wildcard warning. The agent and reviewer see the blast
        //    radius BEFORE token-confirm.
        if (permissions.includes("*")) {
            warningsByCategory.includes_wildcard = [
                "role includes wildcard '*' — equivalent to Admin super-permission",
            ];
            warningsArray.push(
                "role includes wildcard '*' — equivalent to Admin super-permission",
            );
        }

        // 4. Confirmation token over the canonical input (D-13).
        const confirmationToken = computeRoleCascadeHash({
            tool: "create_role",
            name: args.name,
            permissions,
            description,
        });

        // 5. Descriptor. Body echoes the agent's permission set VERBATIM
        //    so dry-run preview === apply payload byte-for-byte (FOUND-03).
        const descriptor = {
            method: "POST",
            path: "/api/roles",
            body: {
                name: args.name,
                description,
                permissions,
                read_only: false,
            },
            _confirmationToken: confirmationToken,
            postApplyEstimate: { id: args.name, async: false },
        };
        if (warningsArray.length > 0) {
            // Surface under cascades.warnings.
            //
            // `warnings` is an Array (iterable for the test's
            // `...(payload.preview.cascades.warnings ?? [])` spread) with
            // named-key properties (`includes_wildcard` / `unknown_permissions`)
            // hung off via Object.assign so per-category accessors keep
            // working. Both shapes coexist on the same object — Array
            // iteration walks the elements; named-key access (`.includes_wildcard`)
            // returns the category array.
            const cascades = {
                warnings: Object.assign([...warningsArray], warningsByCategory),
            };
            descriptor.cascades = cascades;
            // Plan 11-02: also surface in preview.cascades (opt-in, see
            // handler.js — required for the D-03 wildcard warning + D-04
            // unknown_permissions tests that read payload.preview.cascades.warnings).
            descriptor.previewCascades = cascades;
        }
        return descriptor;
    },

    apply: async (client, req) => {
        try {
            return await client.request(req.method, req.path, req.body);
        } catch (err) {
            // 400 with body.type==="RequestError" → structured envelope.
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
                            tool: "create_role",
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

    summarize: (args) => `Create role "${args.name}" with ${(args.permissions ?? []).length} permissions`,

    requireConfirm: ({ req }) => req._confirmationToken ?? null,
});
