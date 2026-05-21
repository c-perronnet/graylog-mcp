# Phase 11: Role Management — Pattern Map

**Mapped:** 2026-05-21
**Files analyzed:** 18 new / 7 modified
**Analogs found:** 18/18 (100% — Phase 11 is a pure composition phase)

Every new file in Phase 11 has a direct line-for-line analog already shipped in Phase 8/9/10. Executors should copy the analog and adapt the tool-specific build-step variations rather than invent. No new factories, no new shared primitives — just a thin `computeRoleCascadeHash` wrapper, a `role-helpers.js` module, six handler files, one test file, one capture script, and four fixtures.

---

## File Classification

### New files (18)

| File | Role | Data Flow | Closest Analog | Match Quality |
|------|------|-----------|----------------|---------------|
| `src/tools/authz/role-helpers.js` | helper module | pure (no I/O) | `src/tools/authz/grn-helpers.js` | exact (domain helpers + constants + validators) |
| `src/tools/authz/list-roles.js` | handler (read/list) | request-response (GET) | `src/tools/authz/list-grantees.js` | exact (plain async, project from full DTO) |
| `src/tools/authz/get-role.js` | handler (read/get) | request-response (GET + GET) | `src/tools/authz/get-entity-shares.js` | exact (plain async, single-DTO + projected join) |
| `src/tools/authz/create-role.js` | handler (mutating) | request-response (POST) | `src/tools/authz/share-entity.js` | role-match (no read-merge-write, but same factory + token + tagError) |
| `src/tools/authz/update-role.js` | handler (mutating) | request-response (GET → PUT) | `src/tools/authz/share-entity.js` | **exact** (read-MERGE-write — PITFALL 1 verbatim) |
| `src/tools/authz/delete-role.js` | handler (mutating) | request-response (GET → DELETE) | `src/tools/authz/share-entity.js` | role-match (cascade preview shape mirrors `diff`) |
| `src/tools/authz/assign-role.js` | handler (mutating) | request-response (GET → PUT) | `src/tools/authz/share-entity.js` | role-match (one-action-per-call + token over current state) |
| `src/tools/authz/unassign-role.js` | handler (mutating) | request-response (GET → DELETE) | `src/tools/authz/share-entity.js` | role-match (same as assign, refuses on not-currently-assigned) |
| `test/authz-roles.test.js` | test | fixture-replay | `test/authz-share-entity.test.js` | exact (Wave 0 RED scaffold, `_setCaptureRequest` seam, `_testConnection: "fake"`) |
| `scripts/capture-roles-fixtures.js` | capture script | live HTTP (GET-only) | `scripts/capture-authz-prepare-fixture.js` | role-match (one-shot, gated, `_provenance` block, GET instead of POST) |
| `test/fixtures/authz/roles/list-roles-7.0.6.json` | fixture | static JSON | `test/fixtures/authz/prepare-response-7.0.6.json` | exact (live capture with `_provenance` envelope) |
| `test/fixtures/authz/roles/get-role-admin-7.0.6.json` | fixture | static JSON | (same) | exact |
| `test/fixtures/authz/roles/get-role-members-reader-7.0.6.json` | fixture | static JSON | (same) | exact |
| `test/fixtures/authz/roles/user-roles-admin-7.0.6.json` | fixture | static JSON | (same) | exact |

### Modified files (7)

| File | Modification | Analog Edit (Phase 10) |
|------|--------------|------------------------|
| `src/tools/authz/schemas.js` | append 7 zod schemas + `BUILT_IN_ROLES` export | Phase 10 added `Capability`, `ENTITY_TYPES`, `ShareEntitySchema` |
| `src/tools/authz/index.js` | add 7 `import` + 7 `register()` calls | Phase 10 added `import { handleShareEntity }` + `register("share_entity", ...)` |
| `src/tools/_shared/cascade-hash.js` | append `computeRoleCascadeHash` (forwarding wrapper) | Phase 5 added `computeNotificationCascadeHash` (forwarding); Phase 8 added `computeShareGrantHash` (standalone) |
| `src/tools.js` | append 7 `{name, description, inputSchema}` entries before `list_admin_tools` | Phase 10 appended `share_entity` at line 1942 |
| `src/tools/meta/list-admin-tools.js` | add 7 entries to `DOMAIN_OVERRIDES` map → `authz` | Phase 10 added `get_entity_shares`, `list_grantees`, `share_entity` (lines 66-68) |
| `test/list-admin-tools.test.js` | bump count assertions 94 → 101 (3 occurrences) | Phase 10 bumped 91 → 94 |
| `test/pipelines.test.js` | bump count assertion 94 → 101 (1 occurrence, line 429) | Phase 10 bumped 91 → 94 |
| `test/dashboards.test.js` | bump count assertion 94 → 101 (1 occurrence, line 1744) | Phase 10 bumped 91 → 94 |
| `test/cascade-hash.test.js` | append byte-pinned `computeRoleCascadeHash` tests (5 frozen fixtures) | Phase 5 added the equivalent `computeNotificationCascadeHash` block at lines 311-410 |

---

## Per-File Analog Map

### `src/tools/authz/role-helpers.js` (NEW)

**Closest analog:** `src/tools/authz/grn-helpers.js`

Both are pure (no I/O) domain-helper modules in `src/tools/authz/` that export domain-specific constants + validators + a `Set` of valid identifiers. `grn-helpers.js` is `GRN_TYPES` + `parseGrn` + `buildGrn` + `resolveEntityGrn`; `role-helpers.js` is `BUILT_IN_ROLES` + `assertRoleIsMutable` + `sortedPermissionsHash` + `sortedRolesHash` + `computePermissionsDiff` + `tagError`.

**Set-of-strings + validator pattern** (grn-helpers.js:30-38, 54-73):
```javascript
export const GRN_TYPES = new Set([
    "stream", "dashboard", "search",
    "user", "team", "builtin-team", "role",
]);

export function buildGrn(type, id) {
    if (typeof type !== "string" || type.length === 0) {
        throw new Error("buildGrn: type must be a non-empty string");
    }
    const t = type.toLowerCase();
    if (!GRN_TYPES.has(t)) {
        throw new Error(
            `Unknown GRN type "${type}". Valid types: ${[...GRN_TYPES].join(", ")}`,
        );
    }
    ...
}
```
Phase 11 mirrors this with `BUILT_IN_ROLES = new Set([...lowercase 16 names])` + `assertRoleIsMutable(roleName)` that lowercases and checks the set. **Lowercase storage + case-insensitive lookup** mirrors `grn-helpers.js`'s `t = type.toLowerCase()`.

**`tagError` helper** — copied verbatim from `share-entity.js:71-78`. Phase 11 factors it into `role-helpers.js` because all five mutators reuse it (vs share-entity.js which keeps it file-local):
```javascript
function tagError(err, reason, status = 422) {
    err.isGraylogError = true;
    err.status = status;
    err.method = "";
    err.path = "";
    err.reason = reason;
    return err;
}
```

---

### `src/tools/authz/list-roles.js` (NEW)

**Closest analog:** `src/tools/authz/list-grantees.js`

Both are plain async handlers (NOT `defineListHandler` — the response is a single nested envelope, not an items[] list that needs projection). Both validate via a plain `z.object`, resolve connection with the `_testConnection` seam re-merge, fire ONE GET, and emit a tool-name-tagged envelope.

**Handler skeleton to copy** (list-grantees.js:22-69 — adapt the schema name, endpoint, and envelope key):
```javascript
export async function handleListRoles(request) {
    const rawArgs = request?.params?.arguments ?? {};

    // 1. Validate
    let args;
    try {
        args = ListRolesSchema.parse(rawArgs);
    } catch (err) {
        return errorResponse(formatZodError(err));
    }

    // 2. Resolve connection — _testConnection seam re-merged from pre-zod args
    const seamArgs = rawArgs._testConnection
        ? { ...args, _testConnection: rawArgs._testConnection }
        : args;
    const { conn, name: connectionName, error } = resolveConnection(seamArgs);
    if (error) return error;

    // 3. Fire the GET and shape the envelope
    try {
        const client = makeClient(conn);
        const response = await client.request("GET", "/api/roles", null);
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    tool: "list_roles",
                    connection: connectionName,
                    roles: response?.roles ?? [],
                    count: (response?.roles ?? []).length,
                }),
            }],
        };
    } catch (err) {
        return wrapGraylogError(err, "list_roles");
    }
}
```

**Note:** No `defineListHandler` — list-grantees.js explicitly chose plain async because the response is a projected DTO, not a paginated items[] array. Same applies to `list_roles` (D-07 omits per-role member counts, so the response is just the role array).

---

### `src/tools/authz/get-role.js` (NEW)

**Closest analog:** `src/tools/authz/get-entity-shares.js`

Both fire one or two GETs and emit a nested envelope. `get-role.js` makes TWO GETs (the role + its members for the enriched envelope per D-08); `get-entity-shares.js` makes one POST `/prepare`. The handler skeleton is identical.

**Pattern from get-entity-shares.js:30-81** — copy the validate → resolve → encode → fetch → envelope chain. Phase 11 swaps the `/prepare` call for two GETs:
```javascript
const roleEncoded = encodeURIComponent(args.roleName);
const [role, members] = await Promise.all([
    client.request("GET", `/api/roles/${roleEncoded}`, null),
    client.request("GET", `/api/roles/${roleEncoded}/members`, null),
]);
const projectedMembers = (members?.users ?? []).map(u => ({
    username: u.username, full_name: u.full_name, email: u.email,
}));
return { content: [{ type: "text", text: JSON.stringify({
    tool: "get_role", connection: connectionName,
    role, members: projectedMembers,
})}]};
```
(D-08 projects members to `{username, full_name, email}` — NOT the full ~25-field `UserSummary`.)

---

### `src/tools/authz/create-role.js` (NEW)

**Closest analog:** `src/tools/authz/share-entity.js`

`defineMutatingHandler` composition. The build step is SIMPLER than `share-entity` because there is no pre-existing entity to read-merge: create has no current state. But everything else (dryRun envelope, token, tagError, apply error classification, `requireConfirm`) is verbatim from share-entity.js.

**Skeleton to copy** (share-entity.js:221-388, omit the read-merge-write block):
```javascript
export const handleCreateRole = defineMutatingHandler({
    name: "create_role",
    schema: CreateRoleSchema,

    async build(args) {
        // 1. assertRoleIsMutable (block agents from POSTing to e.g. "Admin")
        try { assertRoleIsMutable(args.name); }
        catch (err) { throw tagError(err, "builtin_role_immutable", 422); }

        // 2. (optional) permission catalogue validation per D-01/D-04
        //    if (!args.permitUnknownPermissions) await validatePermissions(client, args.permissions)
        //    on failure → throw tagError(err, "unknown_permission", 422)

        // 3. Confirmation token (TOCTOU preview-to-apply binding)
        const confirmationToken = computeRoleCascadeHash({
            tool: "create_role",
            name: args.name,
            permissions: args.permissions,
            description: args.description ?? "",
        });

        return {
            method: "POST",
            path: "/api/roles",
            body: {
                name: args.name,
                description: args.description ?? "",
                permissions: args.permissions,
                read_only: false,
            },
            _confirmationToken: confirmationToken,
            postApplyEstimate: { id: args.name, async: false },
            ...(args.permissions.includes("*") ? { cascades: { warnings: ["role includes wildcard super-permission"] } } : {}),
        };
    },

    apply: async (client, req) => {
        try {
            return await client.request(req.method, req.path, req.body);
        } catch (err) {
            // 400-with-body RequestError → role_validation_failed
            if (err?.isGraylogError && err.status === 400 && err.body?.type === "RequestError") {
                return { isError: true, reason: "role_validation_failed", content: [...] };
            }
            throw err;
        }
    },

    summarize: (args) => `Create role ${args.name} (${args.permissions.length} permissions)`,
    requireConfirm: ({ req }) => req._confirmationToken ?? null,
});
```

---

### `src/tools/authz/update-role.js` (NEW)

**Closest analog:** `src/tools/authz/share-entity.js` — **the load-bearing PITFALL 1 acceptance gate copies verbatim**.

This is the closest structural twin to `share-entity` in Phase 11. Both perform a pre-flight `GET` against the target, compute a current-state hash for TOCTOU drift, and PUT/POST the full-replace body.

**Read-merge-write skeleton** (share-entity.js:225-315 + research §"Pattern 1" sketch at RESEARCH.md:610-707):
```javascript
async build(args) {
    const client = makeClient(args._conn);

    // 1. Client-side built-in refusal (ROLE-07)
    try { assertRoleIsMutable(args.roleName); }
    catch (err) { throw tagError(err, "builtin_role_immutable", 422); }

    // 2. Pre-flight GET — current state (THE READ in read-merge-write)
    let current;
    try {
        current = await client.request(
            "GET",
            `/api/roles/${encodeURIComponent(args.roleName)}`,
            null,
        );
    } catch (err) {
        if (err?.isGraylogError && err.status === 404) {
            throw tagError(err, "role_not_found", 404);
        }
        throw err;
    }

    // 3. Server-side read_only backstop (D-19 belt+braces)
    if (current.read_only === true) {
        throw tagError(
            new Error(`role "${args.roleName}" is server-marked read_only — cannot update`),
            "builtin_role_immutable", 422,
        );
    }

    // 4. Permission catalogue validation (D-01/D-04 conditional)
    //    ...

    // 5. Diff for preview
    const diff = computePermissionsDiff(current.permissions, args.permissions);

    // 6. Token with current_permissions_hash — TOCTOU drift refusal
    const confirmationToken = computeRoleCascadeHash({
        tool: "update_role",
        name: args.roleName,
        permissions: args.permissions,
        description: args.description ?? current.description,
        current_permissions_hash: sortedPermissionsHash(current.permissions),
    });

    return {
        method: "PUT",
        path: `/api/roles/${encodeURIComponent(args.roleName)}`,
        body: {
            name: args.roleName,
            description: args.description ?? current.description,
            permissions: args.permissions,
            read_only: false,
        },
        _confirmationToken: confirmationToken,
        cascades: { diff },
        postApplyEstimate: { id: args.roleName, async: false },
    };
}
```

**PITFALL 1 ACCEPTANCE GATE (mandatory test in `test/authz-roles.test.js`)** — see §"PITFALL 1 Acceptance Pattern" below for the exact assertion shape.

---

### `src/tools/authz/delete-role.js` (NEW)

**Closest analog:** `src/tools/authz/share-entity.js`

Pre-flight `GET /api/roles/{name}/members` for the cascade preview (D-16). Token covers `{tool, name, members_hash}`. Apply does `DELETE /api/roles/{name}`.

**Cascade preview shape** (parallels share-entity.js's `diff` shape at line 198-219):
```javascript
return {
    method: "DELETE",
    path: `/api/roles/${encodeURIComponent(args.roleName)}`,
    body: null,
    _confirmationToken: computeRoleCascadeHash({
        tool: "delete_role",
        name: args.roleName,
        members_hash: sortedRolesHash(members.users.map(u => u.username)),
    }),
    cascades: {
        users_dissociated: members.users.map(u => ({
            username: u.username,
            roles_before: u.roles,
            roles_after: u.roles.filter(r => r.toLowerCase() !== args.roleName.toLowerCase()),
        })),
        count: members.users.length,
    },
    postApplyEstimate: { id: args.roleName, async: false },
};
```

---

### `src/tools/authz/assign-role.js` (NEW)

**Closest analog:** `src/tools/authz/share-entity.js`

**CRITICAL — body MUST be `{}` literal, not `null`** (RESEARCH §Pitfall 3 + Anti-Pattern AP1). The Graylog source explicitly says `"Placeholder because PUT requests should have a body. Set to '{}', the content will be ignored."` Use the `prepare-share.js:44` discipline:
```javascript
// from prepare-share.js — Phase 9
return client.request("POST", path, {});  // {} not null
```

Phase 11's assign-role.js apply:
```javascript
apply: async (client, req) => {
    try {
        // body is {} per Graylog 7.0.6 source — see RESEARCH Pitfall 3
        return await client.request(req.method, req.path, req.body);
    } catch (err) { ... }
}
```

In build():
```javascript
return {
    method: "PUT",
    path: `/api/roles/${encodeURIComponent(args.roleName)}/members/${encodeURIComponent(args.username)}`,
    body: {},  // ← MUST be {} not null
    _confirmationToken: computeRoleCascadeHash({
        tool: "assign_role",
        roleName: args.roleName,
        username: args.username,
        current_roles_hash: sortedRolesHash(currentUserRoles),
    }),
    existingMatches: alreadyMember
        ? [{ username: args.username, similarity_reason: "already_assigned" }]
        : [],
    cascades: { current_roles: currentUserRoles, roles_after_apply: alreadyMember ? currentUserRoles : [...currentUserRoles, args.roleName] },
    postApplyEstimate: { id: `${args.roleName}/${args.username}`, async: false },
};
```

**NO `assertRoleIsMutable` call** (RESEARCH §Anti-Pattern AP4, D-18). Assigning a user to `Reader` or `Admin` is legitimate.

---

### `src/tools/authz/unassign-role.js` (NEW)

**Closest analog:** `src/tools/authz/share-entity.js` (revoke branch)

The closest analog within share-entity.js is the `revoke: true` branch of `mergeGrants` (line 140-165) which throws `not_currently_granted` when revoking a non-grantee. Phase 11's unassign-role does the equivalent: refuse with `reason: "not_currently_assigned"` when the user isn't currently a member (D-11).

**Last-admin guard** (D-17, RESEARCH §Pitfall 5) — Phase 11 invariant not in Graylog source. Mirrors share-entity's `assertOwnPreserved` (line 178-194):
```javascript
// from share-entity.js — the structural template
function assertOwnPreserved(activeShares, mergedMap) {
    const currentOwners = (Array.isArray(activeShares) ? activeShares : [])
        .filter((s) => s && s.capability === "own")
        .map((s) => s.grantee);
    if (currentOwners.length === 0) return; // partial view — trust server
    const mergedHasOwn = [...mergedMap.values()].some((c) => c === "own");
    if (!mergedHasOwn) {
        throw tagError(
            new Error(`would_leave_entity_ownerless: ...`),
            "would_leave_entity_ownerless",
        );
    }
}
```
Phase 11 adapt for unassign-role:
```javascript
// Last-admin guard — refuse if removing this user from Admin leaves zero admins
if (args.roleName.toLowerCase() === "admin") {
    const adminMembers = await client.request("GET", "/api/roles/Admin/members", null);
    const remainingAdmins = adminMembers.users.filter(u => u.username !== args.username);
    if (remainingAdmins.length === 0) {
        throw tagError(
            new Error(`would_leave_no_admin: removing ${args.username} from Admin leaves zero admins (instance lockout)`),
            "would_leave_no_admin", 422,
        );
    }
}
```

---

### `test/authz-roles.test.js` (NEW)

**Closest analog:** `test/authz-share-entity.test.js`

Header pattern, imports, beforeEach/afterEach, `_setCaptureRequest` seam, `_testConnection: "fake"` magic-arg — all copy verbatim.

**Header to copy verbatim** (authz-share-entity.test.js:20-58):
```javascript
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

import {
    handleListRoles, handleGetRole,
    handleCreateRole, handleUpdateRole, handleDeleteRole,
    handleAssignRole, handleUnassignRole,
} from "../src/tools/authz/index.js"; // or per-file import paths

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "authz", "roles");
const LIST_ROLES_FIXTURE = JSON.parse(readFileSync(join(FIXTURE_DIR, "list-roles-7.0.6.json"), "utf8"));
const ADMIN_FIXTURE = JSON.parse(readFileSync(join(FIXTURE_DIR, "get-role-admin-7.0.6.json"), "utf8"));
const READER_MEMBERS_FIXTURE = JSON.parse(readFileSync(join(FIXTURE_DIR, "get-role-members-reader-7.0.6.json"), "utf8"));
const ADMIN_USER_ROLES_FIXTURE = JSON.parse(readFileSync(join(FIXTURE_DIR, "user-roles-admin-7.0.6.json"), "utf8"));

beforeEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
});

afterEach(() => {
    _clearCaptureRequest();  // MANDATORY — leftover seam silently disables HTTP in later tests
    _clearConnectionsForTests();
    setActiveConnection(null);
});
```

**Confirmation-mismatch pattern** (authz-share-entity.test.js:162-189):
```javascript
test("update_role refuses apply with confirmation_mismatch when args.confirm is wrong", async () => {
    _setCaptureRequest(() => ADMIN_FIXTURE);  // or a custom role fixture
    const res = await handleUpdateRole({
        params: {
            arguments: {
                _testConnection: "fake",
                roleName: "myRole",
                permissions: ["streams:read"],
                dryRun: false,
                confirm: "deadbeef", // not the real token
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "confirmation_mismatch");
});
```

**Writable: false test** (authz-share-entity.test.js:949-972) — uses the inline-object `_testConnection` form added in Plan 10-02:
```javascript
test("create_role refuses dryRun:false on writable:false with reason=connection_read_only", async () => {
    let applyHit = false;
    _setCaptureRequest(() => { applyHit = true; return {}; });
    const res = await handleCreateRole({
        params: {
            arguments: {
                _testConnection: { baseUrl: "http://fake", apiToken: "t", writable: false },
                name: "newRole",
                permissions: ["streams:read"],
                dryRun: false,
                confirm: "irrelevant-token",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "connection_read_only");
    assert.equal(applyHit, false, "apply must NOT fire on read-only connection");
});
```

---

### `scripts/capture-roles-fixtures.js` (NEW)

**Closest analog:** `scripts/capture-authz-prepare-fixture.js`

Verbatim structure: shebang → imports → `isMain` guard → `captureFixture()` async function → `_provenance` block on every fixture → `console.error("[capture-roles] ...")` discipline → `process.exit(0|1|2)`.

**Provenance block pattern** (capture-authz-prepare-fixture.js:127-140):
```javascript
const fixture = {
    _provenance: {
        captured_by: "scripts/capture-roles-fixtures.js",
        instance: conn.baseUrl,
        connection: name,
        graylog_version: graylogVersion,  // from GET /api/system
        endpoint: `GET ${path}`,
        captured_at: new Date().toISOString(),
        note: "Verbatim live 7.0.6 GET /api/roles response.",
    },
    ...response,
};
```

**Path-encoding discipline** — `encodeURIComponent` on role names with spaces (`Cluster Configuration Reader` → `Cluster%20Configuration%20Reader`). Mirrors the capture-authz-prepare-fixture.js GRN encoding at line 88.

**Safety guard** — all GETs. Mirrors the `/prepare` self-assert at line 91-97 of the analog:
```javascript
// Phase 11 version — assert every method is GET
if (method !== "GET") {
    console.error(`[capture-roles] FATAL: non-GET method "${method}" — refusing.`);
    process.exit(2);
}
```

---

## Factory Contracts (Public Surfaces the Executor Must Honor)

### `defineMutatingHandler(spec)` — `src/tools/_shared/handler.js`

**Signature** (handler.js:58):
```javascript
export function defineMutatingHandler(spec) {
    const { name, schema, build, apply, summarize, requireConfirm } = spec;
    return async function handler(request) { ... };
}
```

**Spec fields** (handler.js:39-57 JSDoc):
- `name: string` — snake_case tool name (used in hash + error context)
- `schema: ZodObject` — extends `mutatingBase` from `_shared/schemas.js`
- `build(args): RequestDescriptor | Promise<RequestDescriptor>` — may be async; receives `args + _connectionName + _conn`. Returns `{ method, path, body?, postApplyEstimate?, existingMatches?, cascades?, _confirmationToken?, normalize? }`
- `apply(client, req): Promise<unknown>` — fires the HTTP call; may return `{isError: true, ...}` envelope directly to short-circuit `wrapGraylogError`
- `summarize(args, req): string` — one-line preview summary
- `requireConfirm({ args, req }): string | null` — return the token to gate apply; return `null` for no gate

**Order of operations enforced by the wrapper** (handler.js:8-22):
1. `zod.parse(args)` (strips `_testConnection` before parse to support `.strict()`)
2. `resolveConnection(args)` (re-merges `_testConnection` from raw)
3. `conn.writable === false` → `{ isError: true, reason: "connection_read_only" }` BEFORE build
4. Derive idempotencyKey
5. `await build({ ...args, _connectionName, _conn })`
6. dryRun-or-apply branch — dryRun emits preview with `confirmationToken`/`cascades`/`existingMatches`/etc.
6b. `requireConfirm` gate — `args.confirm !== expectedToken` → `{ isError: true, reason: "confirmation_mismatch" }`
7. `apply(client, req)`
8. Normalize raw → `{ id, body }`

**Canonical usage** (share-entity.js:221-388):
```javascript
export const handleShareEntity = defineMutatingHandler({
    name: "share_entity",
    schema: ShareEntitySchema,
    async build(args) { ... return { method, path, body, _confirmationToken, ... }; },
    apply: async (client, req) => { ... },
    summarize: (args) => `...`,
    requireConfirm: ({ req }) => req._confirmationToken ?? null,
});
```

---

### `defineListHandler(spec)` — `src/tools/_shared/list.js`

**Signature** (list.js:39):
```javascript
export function defineListHandler(spec) {
    const { name, schema, fetch, defaultFields } = spec;
}
```

**Phase 11 does NOT use `defineListHandler`** for `list_roles` — list-grantees.js precedent: when the response is a single nested DTO (not a paginated items[]) the plain-async handler is preferred. The `defineListHandler` factory projects items via `DEFAULT_FIELDS = ["id", "title", "description"]` which would mangle the role DTO. See `get_entity_shares` design note (get-entity-shares.js:7-13):

> Pattern: a plain async handler, NOT either of the shared factory handlers (the list-projection one or the mutating one). This is neither a list nor a mutation — the response is a single nested DTO the projection machinery would mangle.

---

### `computeCascadeHash(inputs)` — `src/tools/_shared/cascade-hash.js:144`

**Signature**:
```javascript
export function computeCascadeHash({ streamId, ruleIds, pipelineConnIds, eventDefIds }) {
    if (typeof streamId !== "string" || streamId.length === 0) {
        throw new Error("computeCascadeHash: streamId is required");
    }
    ...
}
```

**`computeRoleCascadeHash` forwarding pattern** (mirrors `computeNotificationCascadeHash` at cascade-hash.js:239-252):
```javascript
export function computeRoleCascadeHash(input) {
    if (!input || typeof input !== "object" || typeof input.tool !== "string") {
        throw new Error("computeRoleCascadeHash: input.tool is required");
    }
    // Bucket by tool name so token from create_role cannot replay on update_role
    return computeCascadeHash({
        streamId: `${input.tool}:${input.name ?? input.roleName ?? ""}`,
        ruleIds: [],
        pipelineConnIds: [],
        eventDefIds: [],
        // ... or follow research §"Pattern 3" exact recipe (RESEARCH.md:751-758)
    });
}
```

**Decision point for executor:** The research at lines 751-758 sketches `computeCascadeHash([{kind: input.tool, items: [input]}])` — but that signature does NOT match the actual `computeCascadeHash({streamId, ruleIds, ...})` signature. The executor must pick: either (a) follow the `computeNotificationCascadeHash` precedent (forwarding into `computeCascadeHash` with the existing 4-bucket signature, putting tool+name in `streamId` and serializing the rest into a synthetic bucket) OR (b) build a standalone canonical-form like `computeShareGrantHash` (cascade-hash.js:303-339). The CONTEXT.md says "thin forwarding wrapper around the v3.0.0 `computeCascadeHash` primitive" — preference is (a), but the existing 4-bucket shape is awkward. Plan-time decision; safest is to build a STANDALONE wrapper for `computeRoleCascadeHash` mirroring `computeShareGrantHash:303-339`, then byte-pin each tool's frozen output in `test/cascade-hash.test.js`.

---

### `tagError(err, reason, status)` — Phase 10 precedent

**Signature** (share-entity.js:71-78):
```javascript
function tagError(err, reason, status = 422) {
    err.isGraylogError = true;
    err.status = status;
    err.method = "";
    err.path = "";
    err.reason = reason;
    return err;
}
```

**Canonical usage** (share-entity.js:236-237):
```javascript
try {
    entityGrn = resolveEntityGrn(args);
} catch (err) {
    throw tagError(err, "invalid_entity_reference", 422);
}
```

**Phase 11 vocabulary** (Claude's-discretion list in CONTEXT.md:68):
- `connection_read_only` (wrapper-emitted at handler.js:100)
- `confirmation_mismatch` (wrapper-emitted at handler.js:217)
- `unknown_permission`
- `builtin_role_immutable`
- `role_not_found`
- `user_not_found`
- `not_currently_assigned`
- `would_leave_no_admin`
- `role_validation_failed`

---

### `_setCaptureRequest(fn)` / `_clearCaptureRequest()` — `src/graylog/client.js:20, 25`

**Signatures**:
```javascript
export function _setCaptureRequest(fn) {
    _captureRequestFn = fn;  // fn: ({method, path, body, conn}) => responseObject
}
export function _clearCaptureRequest() {
    _captureRequestFn = null;
}
```

**Canonical usage** (authz-share-entity.test.js:82, 234, 285-293):
```javascript
// Single fixture for one call
_setCaptureRequest(() => fixture);

// Multi-call seam with branching by path
let callCount = 0;
_setCaptureRequest((req) => {
    callCount += 1;
    if (req.path.endsWith("/members")) return MEMBERS_FIXTURE;
    if (req.method === "PUT") return {};  // apply
    return ROLE_FIXTURE;
});

// MANDATORY in afterEach to prevent leakage
afterEach(() => {
    _clearCaptureRequest();
    _clearConnectionsForTests();
    setActiveConnection(null);
});
```

---

### `requireConfirm({ args, req })` — gate callback at `handler.js:211-225`

**Wrapper-side behavior**:
```javascript
// handler.js:211-225
if (typeof requireConfirm === "function") {
    const expectedToken = requireConfirm({ args, req });
    if (expectedToken !== null && expectedToken !== undefined) {
        if (args.confirm !== expectedToken) {
            return {
                isError: true,
                reason: "confirmation_mismatch",
                content: [{ type: "text", text: `[${name}] confirmation_mismatch: ...` }],
            };
        }
    }
}
```

**Canonical usage** (share-entity.js:387):
```javascript
requireConfirm: ({ req }) => req._confirmationToken ?? null,
```

Phase 11 reuses this verbatim — `build()` writes `_confirmationToken` into the req descriptor, and `requireConfirm` reads it.

---

### `resolveConnection(args)` — `src/tools/_shared/connection.js:28`

**Signature & three-mode lookup**:
```javascript
export function resolveConnection(args) {
    // Mode 1: _testConnection magic arg — TWO shapes (string OR inline object)
    if (args._testConnection) {
        if (typeof args._testConnection === "object" && args._testConnection !== null && !Array.isArray(args._testConnection)) {
            // INLINE OBJECT (Plan 10-02 extension) — used for writable:false tests
            return {
                name: "_testConnection",
                conn: { baseUrl: "_test", apiToken: "_test", writable: true, ...args._testConnection },
            };
        }
        // STRING (canonical form) — used for normal test injection
        return {
            name: args._testConnection,
            conn: { baseUrl: "_test", apiToken: "_test", writable: true },
        };
    }
    // Mode 2: args.connectionName ...
    // Mode 3: singleton fallback ...
}
```

**Critical quirks for Phase 11 test authors:**
1. The seam arg is **stripped before zod.parse** (handler.js:71) and **re-merged from raw args** after parse (handler.js:88-90). Test schemas must NOT declare `_testConnection` — zod's `.strip()` would otherwise drop it before resolveConnection sees it.
2. **Inline-object form** (`{baseUrl, apiToken, writable}`) is the only way to test the `connection_read_only` short-circuit without registering a real connection. Used at authz-share-entity.test.js:959.
3. **Array rejection** (REVIEW WR-01, connection.js:49-53) — `_testConnection: ["bogus"]` is NOT accepted as the inline-object form.

---

## PITFALL 1 Acceptance Pattern (MANDATORY for `update_role`)

Phase 10 established this as the load-bearing safety regression guard. Phase 11's `update_role` MUST repeat the exact assertion shape.

**Phase 10 exemplar** (authz-share-entity.test.js:70-107):
```javascript
test("share_entity PITFALL 1 ACCEPTANCE GATE: current=[A,B], add C → body contains A,B,C (not just C)", async () => {
    const fixture = {
        ...PREPARE_FIXTURE,
        active_shares: [
            { grant: "g1", grantee: "grn::::user:a", capability: "view" },
            { grant: "g2", grantee: "grn::::user:b", capability: "manage" },
        ],
        ...
    };
    _setCaptureRequest(() => fixture);

    const res = await handleShareEntity({ params: { arguments: {
        _testConnection: "fake",
        entityType: "stream", entityId: "s1",
        granteeUsername: "userC", capability: "view",
        dryRun: true,
    }}});

    const payload = JSON.parse(res.content[0].text);
    const grantees = Object.keys(payload.preview.body.selected_grantee_capabilities).sort();
    // PITFALL 1 GATE — body MUST contain A + B + C, not just [C]
    assert.deepEqual(grantees, ["grn::::user:a", "grn::::user:b", "grn::::user:c"]);
    assert.notDeepStrictEqual(grantees, ["grn::::user:c"]);
});
```

**Phase 11 verbatim adaptation for `update_role`** — copy the structure, swap entities for permissions:
```javascript
test("update_role PITFALL 1 ACCEPTANCE GATE: agent supplies full target set [P1,P2,P3] → body permissions=[P1,P2,P3] (echoes input, NOT merged with current)", async () => {
    // For update_role the semantics are different from share_entity:
    // - share_entity: agent supplies ONE grantee; tool MERGES with current grant set
    // - update_role:  agent supplies FULL target permissions; tool passes through
    //
    // The PITFALL guard for update_role is therefore: the body MUST include the
    // FULL agent-supplied permissions array (no partial-update PATCH semantics),
    // AND MUST include name + read_only:false (RolesResource @JsonCreator on name).
    const currentRole = { name: "myRole", description: "x", permissions: ["streams:read", "dashboards:read"], read_only: false };
    _setCaptureRequest(() => currentRole);

    const res = await handleUpdateRole({ params: { arguments: {
        _testConnection: "fake",
        roleName: "myRole",
        permissions: ["streams:read", "dashboards:read", "messages:read"],  // full target set
        dryRun: true,
    }}});

    const payload = JSON.parse(res.content[0].text);
    // PITFALL 1 GATE — body MUST contain name + permissions + read_only:false
    assert.equal(payload.preview.body.name, "myRole");
    assert.deepEqual([...payload.preview.body.permissions].sort(), ["dashboards:read", "messages:read", "streams:read"]);
    assert.equal(payload.preview.body.read_only, false);
    // Inverse: body MUST NOT be a PATCH-style { permissions: [...] } only
    assert.ok("name" in payload.preview.body, "PUT body must include name (RolesResource @JsonCreator required field)");
});
```

**Alternative read-merge interpretation** (if the planner adopts a read-merge-add semantic where agent supplies a delta — UNLIKELY given D-15 says "agent sends `permissions: [...]` (the new full set)"): the assertion shape mirrors share-entity exactly — `current=[A,B] + add=[C] → body.permissions = [A,B,C]`. But CONTEXT.md D-15 locks the full-replace semantics, so the assertion above is canonical.

---

## Tool-Count Update Locations (94 → 101)

Every line below needs `94` → `101` (or `93` → `100` if planner adopts the discuss-phase Q3 "one tool" option, but D-06 ships 7 tools so 101 is the count).

### `test/list-admin-tools.test.js`
**Line 48** — test name string:
```javascript
test("list_admin_tools with no args returns all 94 tools grouped by domain", async () => {
```
**Line 55** — assertion message:
```javascript
assert.equal(payload.count, 94, `expected 94 tools (91 v3.0.0 + get_entity_shares + list_grantees + share_entity), got ${payload.count}`);
```
**Line 143** — second assertion:
```javascript
assert.equal(payload.count, 94);
```

### `test/pipelines.test.js`
**Line 396** — test name:
```javascript
test("assertAllToolsRegistered passes after Plan 10-02 end (count = 94; +authz write path)", async () => {
```
**Line 428** — comment:
```javascript
// Plan 10-02 adds the authz WRITE path: share_entity → 94 (v3.1.0 headline tool).
```
**Line 429** — assertion:
```javascript
assert.equal(toolDefinitions.length, 94, `Expected 94 tools after Plan 10-02 end (Phase 10 Plan 02 complete: share_entity shipped); got ${toolDefinitions.length}`);
```

### `test/dashboards.test.js`
**Line 1734** — comment:
```javascript
// Plan 10-02 adds the authz WRITE path (share_entity) → 94.
```
**Line 1738** — test name:
```javascript
test("assertAllToolsRegistered passes after Plan 10-02 end (count = 94; +authz write path)", async () => {
```
**Line 1744** — assertion:
```javascript
assert.equal(toolDefinitions.length, 94, `Expected 94 tools after Plan 10-02 end (share_entity shipped); got ${toolDefinitions.length}`);
```

**Recommendation:** Update test names and comments to reference Phase 11 / Plan 11-02 in the same comment style — e.g. "Plan 11-02 adds the role management surface: list_roles + get_role + create_role + update_role + delete_role + assign_role + unassign_role → 101 (v3.1.0 milestone count)".

---

## `_testConnection` Seam Quirks (handler.js + connection.js)

### Magic-arg behavior
- The seam is intentionally **absent from every production schema** (mutatingBase, ShareEntitySchema, etc.) so zod's default `.strip()` drops it from production agent payloads. This is threat-model T-00-04-05 enforcement.
- The wrapper at `handler.js:71` reads `_testConnection` from **raw args** (pre-zod), strips it before `schema.parse`, then **re-merges** it onto parsed args at `handler.js:88-90` before `resolveConnection`.

**Strip-before-parse pattern** (handler.js:71):
```javascript
const { _testConnection, ...rawArgsForParse } = rawArgs;
let args;
try {
    args = schema.parse(rawArgsForParse);
} catch (err) {
    return errorResponse(formatZodError(err));
}
```

**Re-merge pattern** (handler.js:88-90):
```javascript
const seamArgs = rawArgs._testConnection
    ? { ...args, _testConnection: rawArgs._testConnection }
    : args;
const { conn, name: connectionName, error } = resolveConnection(seamArgs);
```

The same pattern repeats in list.js:56-58 and the plain-async handlers (get-entity-shares.js:44-46, list-grantees.js:34-36). **Every Phase 11 handler — both `defineMutatingHandler` and plain-async — must repeat this re-merge for list-roles.js and get-role.js.**

### Plan 10-02 inline-object extension

**connection.js:49-67** — the inline-object branch:
```javascript
if (args._testConnection) {
    // Tightened predicate (REVIEW WR-01): the plain-object check must
    // exclude arrays (typeof [] === "object" && [] !== null).
    if (
        typeof args._testConnection === "object"
        && args._testConnection !== null
        && !Array.isArray(args._testConnection)
    ) {
        return {
            name: "_testConnection",
            conn: {
                baseUrl: "_test",
                apiToken: "_test",
                writable: true, // defaults true; overridden by spread when caller sets it
                ...args._testConnection,
            },
        };
    }
    return {
        name: args._testConnection,  // string form
        conn: { baseUrl: "_test", apiToken: "_test", writable: true },
    };
}
```

**Phase 11 test usage** for the writable-gate short-circuit (D-20):
```javascript
_testConnection: { baseUrl: "http://fake", apiToken: "t", writable: false }
```

The `writable: true` default in the spread means: an inline-object that omits `writable` defaults to `true`, NOT `false`. To exercise the read-only short-circuit, tests MUST set `writable: false` explicitly.

---

## Shared Patterns (Apply Across All Phase 11 Handlers)

### `_testConnection` seam re-merge (ALL handlers)
**Source:** `handler.js:88-90` + `list.js:56-58` + `get-entity-shares.js:44-46` + `list-grantees.js:34-36`
**Apply to:** `list_roles`, `get_role` (plain-async), `create_role`, `update_role`, `delete_role`, `assign_role`, `unassign_role` (via `defineMutatingHandler` factory — automatic)

### URL encoding of role names
**Source:** `share-entity.js:302` (`encodeURIComponent(entityGrn)`)
**Apply to:** every Phase 11 handler that interpolates a role name into a path. Role names include `Cluster Configuration Reader`, `Sidecar System (Internal)` — spaces and parens MUST be encoded.
```javascript
const rolePath = `/api/roles/${encodeURIComponent(args.roleName)}`;
const memberPath = `/api/roles/${encodeURIComponent(args.roleName)}/members/${encodeURIComponent(args.username)}`;
```

### `tagError` for build-time refusals
**Source:** `share-entity.js:71-78` (factor into `role-helpers.js` for Phase 11)
**Apply to:** every mutating handler's build() catch-and-tag site (assertRoleIsMutable failures, 404 from pre-flight GET, last-admin guard, permission-catalogue validation failures)

### 400-with-body parser for `create_role` / `update_role`
**Source:** `share-entity.js:324-345` (apply 400 handler)
**Apply to:** `create_role` and `update_role` apply() — Graylog returns `{type: "RequestError", path, reference_path, message}` on bad permission strings and missing name:
```javascript
if (err?.isGraylogError && err.status === 400 && err.body?.type === "RequestError") {
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
```

### Read-only backstop on apply (defense-in-depth)
**Source:** RESEARCH.md sketch at lines 683-687 (extracted from anti-pattern guidance)
**Apply to:** `update_role`, `delete_role` — the legacy `/api/roles` endpoint returns 400 with `{type: "ApiError", message: "Cannot update read only role X"}` even if the client-side `assertRoleIsMutable` somehow lets it through:
```javascript
if (err?.isGraylogError && err.status === 400 && err.body?.type === "ApiError"
    && /read only/i.test(err.body.message ?? "")) {
    err.reason = "builtin_role_immutable";
    throw err;
}
```

### Confirmation-token + drift refusal (AUTHZ-01)
**Source:** `share-entity.js:289` (`computeShareGrantHash`) + handler.js:211-225 (wrapper gate) + share-entity.js:387 (`requireConfirm`)
**Apply to:** all 5 mutating handlers — `_confirmationToken` set in `build()` return, `requireConfirm` callback reads it, wrapper compares against `args.confirm`. The byte-pin tests live in `test/cascade-hash.test.js` (mirror `computeNotificationCascadeHash` block at lines 311-410).

---

## No Analog Found

None. Every Phase 11 file has a strong analog. Phase 11 is a pure composition phase.

---

## Metadata

**Analog search scope:**
- `src/tools/authz/` (Phase 8/9/10 handlers + helpers + schemas + barrel)
- `src/tools/_shared/` (factories: handler.js, list.js, connection.js, cascade-hash.js, schemas.js, errors.js)
- `src/tools/meta/list-admin-tools.js` (DOMAIN_OVERRIDES)
- `src/tools.js` (tool registration + JSON-Schema descriptions)
- `src/dispatch.js` + `src/tools/_register.js` (handler registration mechanism — Phase 11 wires via `src/tools/authz/index.js` register() calls)
- `src/graylog/client.js` (`_setCaptureRequest` seam)
- `test/authz-share-entity.test.js` + `test/authz-entity-shares.test.js` + `test/cascade-hash.test.js` + `test/list-admin-tools.test.js` + `test/pipelines.test.js` + `test/dashboards.test.js`
- `scripts/capture-authz-prepare-fixture.js`
- `test/fixtures/authz/prepare-response-7.0.6.json`

**Files scanned:** 22

**Pattern extraction date:** 2026-05-21
