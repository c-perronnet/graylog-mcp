// Phase 11 Plan 11-01 — Wave 0 offline tests for the role-management surface.
//
// Covers ROLE-01..ROLE-07 + AUTHZ-01 (re-asserted safety stack). Fully offline:
//   - handlers driven via the `_testConnection` magic arg (no connection registry)
//   - the 5 placeholder fixtures replayed through the `_setCaptureRequest` seam
//   - Plan 11-03 will overwrite the placeholder fixtures with live captures
//
// THIS IS A WAVE 0 / RED-PHASE TEST FILE. The handlers under test
// (`../src/tools/authz/list-roles.js` etc.) do NOT yet exist — Plan 11-02 ships
// them. Running `node --test test/authz-roles.test.js` will FAIL at module
// load with ERR_MODULE_NOT_FOUND for those paths AND for the missing
// `computeRoleCascadeHash` export, which is the expected RED state.
// `node --check test/authz-roles.test.js` MUST exit 0 (this file is well-formed
// ESM that simply imports not-yet-existing peers). Same tolerance as Plan
// 10-01's test/authz-share-entity.test.js scaffold.
//
// Discipline mirrors test/authz-share-entity.test.js (Phase 10 Wave 0 fixture
// replay) and test/cascade-hash.test.js's frozen-fixture pattern.
//
// MANDATORY safety acceptance gates encoded in this file:
//   1. update_role PITFALL 1 (D-15 full-replace body: name + permissions +
//      read_only:false — agent's full target permission set echoed verbatim)
//   2. delete_role cascade-preview (D-16 users_dissociated projection)
//   3. assign_role body == {} (Pitfall 3 / AP1 — null skips Content-Type → 415)
//   4. unassign_role last-admin guard (D-17 / Pitfall 5 — refuses with
//      would_leave_no_admin)
// Plus parameterized built-in refusal loops for update_role + delete_role
// (D-18 — 16 built-ins each, client-side, no HTTP call fires).

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
    _setCaptureRequest,
    _clearCaptureRequest,
} from "../src/graylog/client.js";
import {
    _clearConnectionsForTests,
    setActiveConnection,
} from "../src/config.js";
import { computeRoleCascadeHash } from "../src/tools/_shared/cascade-hash.js";

import { BUILT_IN_ROLES } from "../src/tools/authz/schemas.js";

// Handler imports — direct per-file paths mirror test/authz-share-entity.test.js
// precedent (NOT the barrel). All seven are RED until Plan 11-02 ships them.
import { handleListRoles } from "../src/tools/authz/list-roles.js";
import { handleGetRole } from "../src/tools/authz/get-role.js";
import { handleCreateRole } from "../src/tools/authz/create-role.js";
import { handleUpdateRole } from "../src/tools/authz/update-role.js";
import { handleDeleteRole } from "../src/tools/authz/delete-role.js";
import { handleAssignRole } from "../src/tools/authz/assign-role.js";
import { handleUnassignRole } from "../src/tools/authz/unassign-role.js";

const FIXTURE_DIR = join(
    dirname(fileURLToPath(import.meta.url)),
    "fixtures",
    "authz",
    "roles",
);
const LIST_ROLES_FIXTURE = JSON.parse(
    readFileSync(join(FIXTURE_DIR, "list-roles-7.0.6.json"), "utf8"),
);
const ADMIN_FIXTURE = JSON.parse(
    readFileSync(join(FIXTURE_DIR, "get-role-admin-7.0.6.json"), "utf8"),
);
const READER_MEMBERS_FIXTURE = JSON.parse(
    readFileSync(join(FIXTURE_DIR, "get-role-members-reader-7.0.6.json"), "utf8"),
);
const ADMIN_USER_ROLES_FIXTURE = JSON.parse(
    readFileSync(join(FIXTURE_DIR, "user-roles-admin-7.0.6.json"), "utf8"),
);
const PERMS_CATALOGUE_FIXTURE = JSON.parse(
    readFileSync(join(FIXTURE_DIR, "permissions-catalogue-7.0.6.json"), "utf8"),
);

beforeEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
});

afterEach(() => {
    // MANDATORY: a leftover capture seam silently disables HTTP in later test
    // files. Same discipline as test/authz-share-entity.test.js.
    _clearCaptureRequest();
    _clearConnectionsForTests();
    setActiveConnection(null);
});

// =====================================================================
// ROLE-01 — list + get
// =====================================================================

test("list_roles full DTO surfaced (16 roles from fixture, each with name/description/permissions/read_only)", async () => {
    // D-06, D-07 — list_roles never round-trips per-role for members (no N+1).
    _setCaptureRequest(() => LIST_ROLES_FIXTURE);

    const res = await handleListRoles({
        params: { arguments: { _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);

    assert.equal(payload.tool, "list_roles");
    assert.equal(payload.roles.length, 16);
    assert.equal(payload.count, 16);
    for (const r of payload.roles) {
        assert.ok("name" in r, `role ${JSON.stringify(r)} missing name`);
        assert.ok("description" in r, `role ${r.name} missing description`);
        assert.ok("permissions" in r, `role ${r.name} missing permissions`);
        assert.ok("read_only" in r, `role ${r.name} missing read_only`);
    }
});

test("get_role single-role + members response (D-08 projection: members are {username,full_name,email}, not full UserSummary)", async () => {
    // D-06, D-08 — projected fields only; no id/permissions/grn_permissions/etc.
    _setCaptureRequest(({ path }) => {
        if (path.endsWith("/members")) return READER_MEMBERS_FIXTURE;
        return {
            name: "Reader",
            description: "x",
            permissions: [],
            read_only: true,
        };
    });

    const res = await handleGetRole({
        params: {
            arguments: { _testConnection: "fake", roleName: "Reader" },
        },
    });
    const payload = JSON.parse(res.content[0].text);

    assert.equal(payload.tool, "get_role");
    assert.equal(payload.role.name, "Reader");
    assert.equal(payload.members.length, 3);
    assert.deepEqual(
        Object.keys(payload.members[0]).sort(),
        ["email", "full_name", "username"],
    );
});

// =====================================================================
// ROLE-02 — create_role
// =====================================================================

test("create_role dryRun emits expected POST body (name + description + permissions + read_only:false)", async () => {
    // D-12 — default dryRun:true re-asserts AUTHZ-01.
    _setCaptureRequest(({ path }) => {
        if (path === "/api/system/permissions") return PERMS_CATALOGUE_FIXTURE;
        return null;
    });

    const res = await handleCreateRole({
        params: {
            arguments: {
                _testConnection: "fake",
                name: "myCustomRole",
                description: "my desc",
                permissions: ["streams:read"],
                dryRun: true,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);

    assert.equal(payload.preview.method, "POST");
    assert.equal(payload.preview.path, "/api/roles");
    assert.deepEqual(payload.preview.body, {
        name: "myCustomRole",
        description: "my desc",
        permissions: ["streams:read"],
        read_only: false,
    });
});

test("create_role dry-run envelope contains confirmationToken (64-char lowercase hex; matches computeRoleCascadeHash over {tool:create_role,name,permissions,description})", async () => {
    // D-13, AUTHZ-01.
    _setCaptureRequest(({ path }) => {
        if (path === "/api/system/permissions") return PERMS_CATALOGUE_FIXTURE;
        return null;
    });

    const res = await handleCreateRole({
        params: {
            arguments: {
                _testConnection: "fake",
                name: "myCustomRole",
                description: "my desc",
                permissions: ["streams:read"],
                dryRun: true,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);

    assert.match(payload.confirmationToken, /^[0-9a-f]{64}$/);
    const expected = computeRoleCascadeHash({
        tool: "create_role",
        name: "myCustomRole",
        permissions: ["streams:read"],
        description: "my desc",
    });
    assert.equal(payload.confirmationToken, expected);
});

test("create_role refuses unknown permission with reason=unknown_permission BEFORE write (D-01 catalogue validation)", async () => {
    // D-01, D-02, D-04 — catalogue prefix mismatch.
    let postFired = false;
    _setCaptureRequest(({ method, path }) => {
        if (path === "/api/system/permissions") return PERMS_CATALOGUE_FIXTURE;
        if (method === "POST") postFired = true;
        return null;
    });

    const res = await handleCreateRole({
        params: {
            arguments: {
                _testConnection: "fake",
                name: "myCustomRole",
                description: "",
                permissions: ["definitelynotaresource:nope"],
                dryRun: true,
            },
        },
    });

    assert.equal(res.isError, true);
    assert.equal(res.reason, "unknown_permission");
    const text = res.content[0].text;
    assert.ok(
        text.includes("definitelynotaresource:nope"),
        `expected error text to include the offending permission; got ${text}`,
    );
    assert.equal(postFired, false, "POST must NOT fire on catalogue refusal");
});

test("create_role accepts wildcard '*' but surfaces warnings.includes_wildcard in dry-run preview (D-03)", async () => {
    // D-03 — wildcard accepted in custom roles; preview MUST surface a WARNING.
    _setCaptureRequest(({ path }) => {
        if (path === "/api/system/permissions") return PERMS_CATALOGUE_FIXTURE;
        return null;
    });

    const res = await handleCreateRole({
        params: {
            arguments: {
                _testConnection: "fake",
                name: "mySuperRole",
                permissions: ["*"],
                dryRun: true,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);

    assert.equal(payload.dryRun, true);
    // Warnings may surface on either payload.warnings or payload.preview.cascades.warnings —
    // accept either spot but the substring "wildcard" / "super" must appear somewhere.
    const warningsArr = [
        ...(Array.isArray(payload.warnings?.includes_wildcard) ? payload.warnings.includes_wildcard : []),
        ...(payload.warnings?.includes_wildcard ? [String(payload.warnings.includes_wildcard)] : []),
        ...(Array.isArray(payload.warnings) ? payload.warnings : []),
        ...(payload.preview?.cascades?.warnings ?? []),
        ...(payload.preview?.warnings ?? []),
    ];
    const joined = JSON.stringify({ p: payload }).toLowerCase();
    assert.ok(
        warningsArr.some((w) => /wildcard|super/i.test(String(w))) ||
            /wildcard|super-permission/i.test(joined),
        `expected wildcard warning in preview; got ${JSON.stringify(payload)}`,
    );
});

test("create_role permitUnknownPermissions:true opt-out skips catalogue check and surfaces warnings.unknown_permissions[] in preview (D-04)", async () => {
    // D-04 — opt-out skips catalogue validation, surfaces the unknown perms.
    let catalogueHit = false;
    _setCaptureRequest(({ path }) => {
        if (path === "/api/system/permissions") {
            catalogueHit = true;
            return PERMS_CATALOGUE_FIXTURE;
        }
        return null;
    });

    const res = await handleCreateRole({
        params: {
            arguments: {
                _testConnection: "fake",
                name: "myEnterpriseRole",
                permissions: ["unknownenterprise:special"],
                permitUnknownPermissions: true,
                dryRun: true,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);

    assert.equal(catalogueHit, false, "catalogue endpoint must NOT be called when permitUnknownPermissions:true");
    assert.equal(payload.dryRun, true);
    assert.ok(
        payload.preview.body.permissions.includes("unknownenterprise:special"),
        "preview body must contain the unknown permission verbatim",
    );
    const surfaced = [
        ...(payload.warnings?.unknown_permissions ?? []),
        ...(payload.preview?.warnings?.unknown_permissions ?? []),
        ...(payload.preview?.cascades?.warnings?.unknown_permissions ?? []),
    ];
    assert.ok(
        surfaced.includes("unknownenterprise:special") ||
            JSON.stringify(payload).includes("unknownenterprise:special"),
        `expected unknown_permissions to list unknownenterprise:special; got ${JSON.stringify(payload)}`,
    );
});

// =====================================================================
// ROLE-03 — update_role (MANDATORY PITFALL 1 ACCEPTANCE GATE)
// =====================================================================

test("update_role PITFALL 1 ACCEPTANCE GATE: agent's full target permission set is echoed in body.permissions (no PATCH semantics); body MUST include name + read_only:false (RolesResource @JsonCreator)", async () => {
    // D-15 — full-replace; pre-flight GET; read-merge-write.
    // THE load-bearing test. If this regresses, agents can silently truncate
    // permission sets on update.
    const currentRole = {
        name: "myRole",
        description: "x",
        permissions: ["streams:read", "dashboards:read"],
        read_only: false,
    };
    _setCaptureRequest(() => currentRole);

    const res = await handleUpdateRole({
        params: {
            arguments: {
                _testConnection: "fake",
                roleName: "myRole",
                permissions: ["streams:read", "dashboards:read", "messages:read"],
                dryRun: true,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);

    // PITFALL 1 GATE — body MUST contain full target [P1,P2,P3] + name + read_only:false.
    assert.equal(payload.preview.method, "PUT");
    assert.equal(payload.preview.path, "/api/roles/myRole");
    assert.equal(payload.preview.body.name, "myRole");
    assert.equal(payload.preview.body.read_only, false);
    assert.deepEqual(
        [...payload.preview.body.permissions].sort(),
        ["dashboards:read", "messages:read", "streams:read"],
    );
    // Inverse: body MUST NOT be a PATCH-style partial.
    assert.ok("name" in payload.preview.body, "PUT body must include name (RolesResource @JsonCreator required field)");
    assert.ok("read_only" in payload.preview.body, "PUT body must include read_only:false (full-replace contract)");
});

test("update_role pre-flight GET happens BEFORE PUT in dry-run (read-PREVIEW-write — D-15)", async () => {
    // D-15 — pre-flight GET is part of the read-merge-write contract.
    let getCount = 0;
    let putCount = 0;
    _setCaptureRequest(({ method, path }) => {
        if (method === "GET" && path === "/api/roles/myRole") {
            getCount += 1;
            return {
                name: "myRole",
                description: "x",
                permissions: ["streams:read"],
                read_only: false,
            };
        }
        if (method === "PUT") {
            putCount += 1;
            return {};
        }
        return null;
    });

    await handleUpdateRole({
        params: {
            arguments: {
                _testConnection: "fake",
                roleName: "myRole",
                permissions: ["streams:read", "messages:read"],
                dryRun: true,
            },
        },
    });

    assert.equal(getCount, 1, "pre-flight GET /api/roles/myRole must fire exactly once in dryRun");
    assert.equal(putCount, 0, "PUT must NOT fire in dryRun");
});

test("update_role dry-run diff in cascades.diff: added/removed/unchanged arrays (D-15 diff shape)", async () => {
    // D-15 — diff shape exposed to agent.
    _setCaptureRequest(() => ({
        name: "myRole",
        description: "x",
        permissions: ["streams:read", "dashboards:read"],
        read_only: false,
    }));

    const res = await handleUpdateRole({
        params: {
            arguments: {
                _testConnection: "fake",
                roleName: "myRole",
                permissions: ["streams:read", "messages:read"],
                dryRun: true,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);

    assert.deepEqual(payload.preview.cascades.diff.added, ["messages:read"]);
    assert.deepEqual(payload.preview.cascades.diff.removed, ["dashboards:read"]);
    assert.deepEqual(payload.preview.cascades.diff.unchanged, ["streams:read"]);
});

test("update_role drift refusal: current permissions differ between dry-run and apply → reason=confirmation_mismatch (D-14 TOCTOU)", async () => {
    // D-14 — drift refusal on apply; update_role token covers
    // current_permissions_hash. The pre-flight GET returns DIFFERENT permissions
    // on the second call (apply-time), so the recomputed token mismatches the
    // dry-run token the agent echoes.
    let getCall = 0;
    _setCaptureRequest(({ method }) => {
        if (method === "GET") {
            getCall += 1;
            if (getCall === 1) {
                return {
                    name: "myRole",
                    description: "x",
                    permissions: ["streams:read", "dashboards:read"],
                    read_only: false,
                };
            }
            return {
                name: "myRole",
                description: "x",
                permissions: ["streams:read", "dashboards:read", "messages:write"],
                read_only: false,
            };
        }
        return {};
    });

    const dry = await handleUpdateRole({
        params: {
            arguments: {
                _testConnection: "fake",
                roleName: "myRole",
                permissions: ["streams:read", "dashboards:read", "messages:read"],
                dryRun: true,
            },
        },
    });
    const dryPayload = JSON.parse(dry.content[0].text);
    const token1 = dryPayload.confirmationToken;

    const apply = await handleUpdateRole({
        params: {
            arguments: {
                _testConnection: "fake",
                roleName: "myRole",
                permissions: ["streams:read", "dashboards:read", "messages:read"],
                dryRun: false,
                confirm: token1,
            },
        },
    });
    assert.equal(apply.isError, true);
    assert.equal(apply.reason, "confirmation_mismatch");
});

// =====================================================================
// ROLE-04 — delete_role (MANDATORY cascade-preview)
// =====================================================================

test("delete_role cascade-preview lists members in cascades.users_dissociated with {username, roles_before, roles_after} projection (D-16)", async () => {
    // D-16 — cascade preview projection. THE load-bearing test for delete.
    _setCaptureRequest(({ path }) => {
        if (path.endsWith("/members")) {
            return {
                role: "myRole",
                users: [
                    { username: "alice", roles: ["Reader", "myRole"] },
                    { username: "bob",   roles: ["Reader", "Manager", "myRole"] },
                ],
            };
        }
        return {
            name: "myRole",
            description: "",
            permissions: [],
            read_only: false,
        };
    });

    const res = await handleDeleteRole({
        params: {
            arguments: {
                _testConnection: "fake",
                roleName: "myRole",
                dryRun: true,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);

    assert.equal(payload.preview.cascades.users_dissociated.length, 2);
    assert.deepEqual(payload.preview.cascades.users_dissociated[0], {
        username: "alice",
        roles_before: ["Reader", "myRole"],
        roles_after: ["Reader"],
    });
    assert.deepEqual(payload.preview.cascades.users_dissociated[1], {
        username: "bob",
        roles_before: ["Reader", "Manager", "myRole"],
        roles_after: ["Reader", "Manager"],
    });
    assert.equal(payload.preview.cascades.count, 2);
});

test("delete_role drift refusal: member list differs between dry-run and apply → reason=confirmation_mismatch (D-14)", async () => {
    // D-14, D-16 — delete_role token covers members_hash.
    let membersCall = 0;
    _setCaptureRequest(({ path }) => {
        if (path.endsWith("/members")) {
            membersCall += 1;
            if (membersCall === 1) {
                return {
                    role: "myRole",
                    users: [
                        { username: "alice", roles: ["Reader", "myRole"] },
                        { username: "bob",   roles: ["Reader", "myRole"] },
                        { username: "carol", roles: ["Reader", "myRole"] },
                    ],
                };
            }
            // Apply-time: a new user appeared.
            return {
                role: "myRole",
                users: [
                    { username: "alice", roles: ["Reader", "myRole"] },
                    { username: "bob",   roles: ["Reader", "myRole"] },
                    { username: "carol", roles: ["Reader", "myRole"] },
                    { username: "dave",  roles: ["Reader", "myRole"] },
                ],
            };
        }
        return {
            name: "myRole",
            description: "",
            permissions: [],
            read_only: false,
        };
    });

    const dry = await handleDeleteRole({
        params: {
            arguments: {
                _testConnection: "fake",
                roleName: "myRole",
                dryRun: true,
            },
        },
    });
    const dryPayload = JSON.parse(dry.content[0].text);
    const token1 = dryPayload.confirmationToken;

    const apply = await handleDeleteRole({
        params: {
            arguments: {
                _testConnection: "fake",
                roleName: "myRole",
                dryRun: false,
                confirm: token1,
            },
        },
    });
    assert.equal(apply.isError, true);
    assert.equal(apply.reason, "confirmation_mismatch");
});

// =====================================================================
// ROLE-05 — assign_role (MANDATORY body=={})
// =====================================================================

test("assign_role apply body equals {} (literal empty object) NEVER null — Pitfall 3 / AP1", async () => {
    // D-09, Pitfall 3, AP1 — null skips Content-Type → Graylog 415s.
    _setCaptureRequest(({ path }) => {
        if (path === "/api/roles/Reader") {
            return {
                name: "Reader",
                description: "x",
                permissions: [],
                read_only: true,
            };
        }
        if (path === "/api/authz/roles/user/alice") {
            return { total: 1, roles: [{ name: "Manager" }] };
        }
        return null;
    });

    const res = await handleAssignRole({
        params: {
            arguments: {
                _testConnection: "fake",
                roleName: "Reader",
                username: "alice",
                dryRun: true,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);

    // Pitfall 3 GATE — body MUST be {} literal, NEVER null/undefined.
    assert.deepEqual(payload.preview.body, {});
    assert.notEqual(payload.preview.body, null);
    assert.notEqual(payload.preview.body, undefined);
});

test("assign_role preview includes current_roles + roles_after_apply derived from GET /api/authz/roles/user/{username} (D-10)", async () => {
    // D-10 — preview shape {username, current_roles, roles_after_apply, already_member}.
    _setCaptureRequest(({ path }) => {
        if (path === "/api/roles/Reader") {
            return {
                name: "Reader",
                description: "x",
                permissions: [],
                read_only: true,
            };
        }
        if (path === "/api/authz/roles/user/alice") {
            return { total: 1, roles: [{ name: "Manager" }] };
        }
        return null;
    });

    const res = await handleAssignRole({
        params: {
            arguments: {
                _testConnection: "fake",
                roleName: "Reader",
                username: "alice",
                dryRun: true,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);

    assert.deepEqual(payload.preview.cascades.current_roles, ["Manager"]);
    assert.deepEqual(
        [...payload.preview.cascades.roles_after_apply].sort(),
        ["Manager", "Reader"],
    );
});

test("assign_role to already-member surfaces already_member:true in preview; apply returns result:no_change (D-10)", async () => {
    // D-10 — idempotent for already-member; preview shows already_member:true.
    _setCaptureRequest(({ path }) => {
        if (path === "/api/roles/Reader") {
            return {
                name: "Reader",
                description: "x",
                permissions: [],
                read_only: true,
            };
        }
        if (path === "/api/authz/roles/user/alice") {
            return {
                total: 2,
                roles: [{ name: "Reader" }, { name: "Manager" }],
            };
        }
        return {};
    });

    const dry = await handleAssignRole({
        params: {
            arguments: {
                _testConnection: "fake",
                roleName: "Reader",
                username: "alice",
                dryRun: true,
            },
        },
    });
    const dryPayload = JSON.parse(dry.content[0].text);
    const alreadyFlag =
        dryPayload.preview?.cascades?.already_member === true ||
        (Array.isArray(dryPayload.existingMatches) &&
            dryPayload.existingMatches.some(
                (m) => m?.similarity_reason === "already_assigned",
            ));
    assert.ok(
        alreadyFlag,
        `expected already_member:true OR existingMatches[].similarity_reason=already_assigned; got ${JSON.stringify(dryPayload)}`,
    );

    const apply = await handleAssignRole({
        params: {
            arguments: {
                _testConnection: "fake",
                roleName: "Reader",
                username: "alice",
                dryRun: false,
                confirm: dryPayload.confirmationToken,
            },
        },
    });
    const applyPayload = JSON.parse(apply.content[0].text);
    // D-10 — apply still fires (server idempotent) AND envelope surfaces no_change.
    const resultMarker =
        applyPayload?.result?.body?.result === "no_change" ||
        applyPayload?.result === "no_change" ||
        applyPayload?.result?.id === "no_change" ||
        JSON.stringify(applyPayload).includes("no_change");
    assert.ok(
        resultMarker,
        `expected apply envelope to mark result:"no_change"; got ${JSON.stringify(applyPayload)}`,
    );
});

test("assign_role drift refusal: user's roles differ between dry-run and apply → reason=confirmation_mismatch (D-14)", async () => {
    // D-14 — assign_role token covers current_user_roles_hash.
    let userRolesCall = 0;
    _setCaptureRequest(({ path }) => {
        if (path === "/api/roles/Reader") {
            return {
                name: "Reader",
                description: "x",
                permissions: [],
                read_only: true,
            };
        }
        if (path === "/api/authz/roles/user/alice") {
            userRolesCall += 1;
            if (userRolesCall === 1) {
                return { total: 1, roles: [{ name: "Manager" }] };
            }
            return {
                total: 2,
                roles: [{ name: "Manager" }, { name: "Reader" }],
            };
        }
        return {};
    });

    const dry = await handleAssignRole({
        params: {
            arguments: {
                _testConnection: "fake",
                roleName: "Reader",
                username: "alice",
                dryRun: true,
            },
        },
    });
    const dryPayload = JSON.parse(dry.content[0].text);

    const apply = await handleAssignRole({
        params: {
            arguments: {
                _testConnection: "fake",
                roleName: "Reader",
                username: "alice",
                dryRun: false,
                confirm: dryPayload.confirmationToken,
            },
        },
    });
    assert.equal(apply.isError, true);
    assert.equal(apply.reason, "confirmation_mismatch");
});

// =====================================================================
// ROLE-06 — unassign_role (MANDATORY last-admin guard)
// =====================================================================

test("unassign_role apply method=DELETE, no body (Graylog 7.0.6 DELETE /api/roles/{name}/members/{username} returns 204)", async () => {
    // D-09 — same API shape for unassign; DELETE has no body.
    _setCaptureRequest(({ path }) => {
        if (path === "/api/roles/Manager") {
            return {
                name: "Manager",
                description: "x",
                permissions: [],
                read_only: false,
            };
        }
        if (path === "/api/authz/roles/user/alice") {
            return {
                total: 2,
                roles: [{ name: "Reader" }, { name: "Manager" }],
            };
        }
        return null;
    });

    const res = await handleUnassignRole({
        params: {
            arguments: {
                _testConnection: "fake",
                roleName: "Manager",
                username: "alice",
                dryRun: true,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);

    assert.equal(payload.preview.method, "DELETE");
    assert.equal(payload.preview.path, "/api/roles/Manager/members/alice");
    // body must be null (or absent) — DELETE has no body.
    assert.ok(
        payload.preview.body === null || payload.preview.body === undefined,
        `expected DELETE body to be null/absent; got ${JSON.stringify(payload.preview.body)}`,
    );
});

test("unassign_role of non-member refuses with reason=not_currently_assigned (D-11)", async () => {
    // D-11 — refuse client-side when user is not currently a member.
    _setCaptureRequest(({ path }) => {
        if (path === "/api/roles/Manager") {
            return {
                name: "Manager",
                description: "x",
                permissions: [],
                read_only: false,
            };
        }
        if (path === "/api/authz/roles/user/alice") {
            // alice has Reader only — NOT Manager.
            return { total: 1, roles: [{ name: "Reader" }] };
        }
        return null;
    });

    const res = await handleUnassignRole({
        params: {
            arguments: {
                _testConnection: "fake",
                roleName: "Manager",
                username: "alice",
                dryRun: true,
            },
        },
    });

    assert.equal(res.isError, true);
    assert.equal(res.reason, "not_currently_assigned");
});

test("unassign_role refuses with reason=would_leave_no_admin when removing the last Admin (D-17 / Pitfall 5)", async () => {
    // D-17 / Pitfall 5 — instance-lockout guard. THE load-bearing test for unassign.
    _setCaptureRequest(({ path }) => {
        if (path === "/api/roles/Admin") {
            return {
                name: "Admin",
                description: "Grants all permissions for administrators (built-in)",
                permissions: ["*"],
                read_only: true,
            };
        }
        if (path === "/api/authz/roles/user/admin") {
            return { total: 1, roles: [{ name: "Admin" }] };
        }
        if (path === "/api/roles/Admin/members") {
            return {
                role: "Admin",
                users: [{ username: "admin", roles: ["Admin"] }],
            };
        }
        return null;
    });

    const res = await handleUnassignRole({
        params: {
            arguments: {
                _testConnection: "fake",
                roleName: "Admin",
                username: "admin",
                dryRun: true,
            },
        },
    });

    assert.equal(res.isError, true);
    assert.equal(res.reason, "would_leave_no_admin");
    const text = res.content[0].text;
    assert.ok(
        /instance lockout|zero admins|no admin/i.test(text),
        `expected error text to mention instance lockout / zero admins; got ${text}`,
    );
});

test("unassign_role drift refusal: user's roles differ between dry-run and apply → reason=confirmation_mismatch (D-14)", async () => {
    // D-14 — same drift mechanism as assign.
    let userRolesCall = 0;
    _setCaptureRequest(({ path }) => {
        if (path === "/api/roles/Manager") {
            return {
                name: "Manager",
                description: "x",
                permissions: [],
                read_only: false,
            };
        }
        if (path === "/api/authz/roles/user/alice") {
            userRolesCall += 1;
            if (userRolesCall === 1) {
                return {
                    total: 2,
                    roles: [{ name: "Reader" }, { name: "Manager" }],
                };
            }
            // Apply-time: alice picked up an extra role.
            return {
                total: 3,
                roles: [{ name: "Reader" }, { name: "Manager" }, { name: "Views Manager" }],
            };
        }
        return {};
    });

    const dry = await handleUnassignRole({
        params: {
            arguments: {
                _testConnection: "fake",
                roleName: "Manager",
                username: "alice",
                dryRun: true,
            },
        },
    });
    const dryPayload = JSON.parse(dry.content[0].text);

    const apply = await handleUnassignRole({
        params: {
            arguments: {
                _testConnection: "fake",
                roleName: "Manager",
                username: "alice",
                dryRun: false,
                confirm: dryPayload.confirmationToken,
            },
        },
    });
    assert.equal(apply.isError, true);
    assert.equal(apply.reason, "confirmation_mismatch");
});

// =====================================================================
// ROLE-07 — built-in refusal (MANDATORY parameterized loops)
// =====================================================================

test("update_role refuses 16 built-ins client-side with reason=builtin_role_immutable (parameterized loop — D-18 / ROLE-07)", async () => {
    // D-18, D-19 — assertRoleIsMutable client-side refusal; applied to update + delete ONLY.
    assert.equal(BUILT_IN_ROLES.size, 16, "BUILT_IN_ROLES must have exactly 16 entries (lowercased)");

    for (const name of BUILT_IN_ROLES) {
        let httpCalls = 0;
        _setCaptureRequest(() => {
            httpCalls += 1;
            return null;
        });

        const res = await handleUpdateRole({
            params: {
                arguments: {
                    _testConnection: "fake",
                    roleName: name,
                    permissions: ["streams:read"],
                    dryRun: true,
                },
            },
        });

        assert.equal(
            res.isError,
            true,
            `update_role on built-in "${name}" must refuse`,
        );
        assert.equal(
            res.reason,
            "builtin_role_immutable",
            `update_role on built-in "${name}" must tag reason=builtin_role_immutable; got ${res.reason}`,
        );
        assert.equal(
            httpCalls,
            0,
            `update_role on built-in "${name}" must NOT fire any HTTP call (client-side refusal); got ${httpCalls}`,
        );

        _clearCaptureRequest();
    }
});

test("delete_role refuses 16 built-ins client-side with reason=builtin_role_immutable (parameterized loop)", async () => {
    // D-18 — same client-side refusal applies to delete_role per D-18.
    assert.equal(BUILT_IN_ROLES.size, 16, "BUILT_IN_ROLES must have exactly 16 entries");

    for (const name of BUILT_IN_ROLES) {
        let httpCalls = 0;
        _setCaptureRequest(() => {
            httpCalls += 1;
            return null;
        });

        const res = await handleDeleteRole({
            params: {
                arguments: {
                    _testConnection: "fake",
                    roleName: name,
                    dryRun: true,
                },
            },
        });

        assert.equal(
            res.isError,
            true,
            `delete_role on built-in "${name}" must refuse`,
        );
        assert.equal(
            res.reason,
            "builtin_role_immutable",
            `delete_role on built-in "${name}" must tag reason=builtin_role_immutable; got ${res.reason}`,
        );
        assert.equal(
            httpCalls,
            0,
            `delete_role on built-in "${name}" must NOT fire any HTTP call; got ${httpCalls}`,
        );

        _clearCaptureRequest();
    }
});

test("assertRoleIsMutable is case-insensitive: 'admin' AND 'ADMIN' AND 'Admin' all refuse (D-18 — server's RoleService.delete is case-insensitive)", async () => {
    // D-18 / Pitfall 7 — case-insensitive comparison.
    for (const casing of ["admin", "ADMIN", "Admin"]) {
        _setCaptureRequest(() => null);
        const res = await handleUpdateRole({
            params: {
                arguments: {
                    _testConnection: "fake",
                    roleName: casing,
                    permissions: ["streams:read"],
                    dryRun: true,
                },
            },
        });
        assert.equal(
            res.isError,
            true,
            `update_role on "${casing}" must refuse`,
        );
        assert.equal(
            res.reason,
            "builtin_role_immutable",
            `update_role on "${casing}" must refuse with builtin_role_immutable; got ${res.reason}`,
        );
        _clearCaptureRequest();
    }
});

// =====================================================================
// AUTHZ-01 — cross-cutting safety stack (writable + dryRun default)
// =====================================================================

test("5 mutators short-circuit with reason=connection_read_only when conn.writable === false (D-20; uses _testConnection inline-object form)", async () => {
    // D-20 — connection_read_only short-circuit at handler step 3, BEFORE build().
    const mutators = [
        ["create_role", handleCreateRole, {
            name: "newRole",
            permissions: ["streams:read"],
        }],
        ["update_role", handleUpdateRole, {
            roleName: "myCustomRole",
            permissions: ["streams:read"],
        }],
        ["delete_role", handleDeleteRole, { roleName: "myCustomRole" }],
        ["assign_role", handleAssignRole, {
            roleName: "Reader",
            username: "alice",
        }],
        ["unassign_role", handleUnassignRole, {
            roleName: "Reader",
            username: "alice",
        }],
    ];

    for (const [label, handler, rest] of mutators) {
        let applyFired = false;
        _setCaptureRequest(() => {
            applyFired = true;
            return null;
        });

        const res = await handler({
            params: {
                arguments: {
                    _testConnection: {
                        baseUrl: "http://fake",
                        apiToken: "t",
                        writable: false,
                    },
                    ...rest,
                    dryRun: false,
                    confirm: "irrelevant-token",
                },
            },
        });

        assert.equal(
            res.isError,
            true,
            `${label} on writable:false connection must refuse`,
        );
        assert.equal(
            res.reason,
            "connection_read_only",
            `${label} must tag reason=connection_read_only; got ${res.reason}`,
        );
        assert.equal(
            applyFired,
            false,
            `${label}: apply must NOT fire on read-only connection`,
        );

        _clearCaptureRequest();
    }
});

test("5 mutators default dryRun:true (apply requires explicit dryRun:false) — AUTHZ-01 / D-12", async () => {
    // D-12 — all 5 mutating tools default dryRun:true. Re-asserts AUTHZ-01.
    const mutators = [
        ["create_role", handleCreateRole, {
            name: "myCustomRole",
            permissions: [],
        }],
        ["update_role", handleUpdateRole, {
            roleName: "myCustomRole",
            permissions: ["streams:read"],
        }],
        ["delete_role", handleDeleteRole, { roleName: "myCustomRole" }],
        ["assign_role", handleAssignRole, {
            roleName: "Reader",
            username: "alice",
        }],
        ["unassign_role", handleUnassignRole, {
            roleName: "Reader",
            username: "alice",
        }],
    ];

    for (const [label, handler, rest] of mutators) {
        let applyMethodSeen = null;
        _setCaptureRequest(({ method, path }) => {
            if (method === "POST" || method === "PUT" || method === "DELETE") {
                // record only the FIRST apply-like call (pre-flight GETs are fine).
                if (applyMethodSeen === null) applyMethodSeen = `${method} ${path}`;
            }
            // Provide plausible pre-flight responses so build() can compute a preview.
            if (path === "/api/system/permissions") return PERMS_CATALOGUE_FIXTURE;
            if (path === "/api/roles/myCustomRole") {
                return {
                    name: "myCustomRole",
                    description: "x",
                    permissions: ["streams:read"],
                    read_only: false,
                };
            }
            if (path === "/api/roles/Reader") {
                return {
                    name: "Reader",
                    description: "x",
                    permissions: [],
                    read_only: true,
                };
            }
            if (path === "/api/roles/myCustomRole/members") {
                return { role: "myCustomRole", users: [] };
            }
            if (path === "/api/authz/roles/user/alice") {
                return {
                    total: 2,
                    roles: [{ name: "Reader" }, { name: "Manager" }],
                };
            }
            return {};
        });

        const res = await handler({
            params: {
                arguments: {
                    _testConnection: "fake",
                    ...rest,
                    // NOTE: dryRun deliberately OMITTED — default must be true.
                },
            },
        });
        const payload = JSON.parse(res.content[0].text);

        assert.equal(
            payload.dryRun,
            true,
            `${label}: dryRun must default to true when omitted; got ${payload.dryRun}`,
        );
        assert.equal(
            applyMethodSeen,
            null,
            `${label}: no apply-method HTTP call (POST/PUT/DELETE) may fire on default dryRun; got ${applyMethodSeen}`,
        );

        _clearCaptureRequest();
    }
});
