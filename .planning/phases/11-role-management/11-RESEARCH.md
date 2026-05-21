# Phase 11: Role Management — Research

**Researched:** 2026-05-21
**Domain:** Graylog 7.0.6 role-management surface (CRUD + assign/unassign), integrated with the v3.0.0 mutating-handler safety stack on top of the Phase 8 authz foundation.
**Confidence:** HIGH for endpoints/DTOs/built-ins (all verified live against `http://<graylog-host>` Graylog 7.0.6+711d207); MEDIUM-HIGH for tool composition (every primitive is already shipped); MEDIUM for two scope decisions that the planner should lock with the user (see Open Questions).

## Summary

Phase 11 ships six MCP tools (`list_roles`, `get_role`, `create_role`, `update_role`, `delete_role`, `assign_role`, `unassign_role` — seven tools if `get_role` is split from `list_roles`, see Open Question 3) for the **coarse-grained global permission layer**. Roles are independent from entity sharing (no shared code path, no GRN involvement on the role's identity — though there IS a GRN type `role` already in `GRN_TYPES`, it's only ever a grantee identity, not a role-management identifier).

The central recon discovery is that **Graylog 7.0.6 exposes TWO parallel role surfaces** that the planner must pick between:

1. **Legacy `/api/roles` (RolesResource)** — keyed by **role NAME** (URL-encoded with spaces), supports full CRUD (`POST/GET/PUT/DELETE /api/roles[/{name}]`) + per-role member management (`PUT/DELETE /api/roles/{rolename}/members/{username}`). Returns `RoleResponse` with `name`/`description`/`permissions`/`read_only` (no `id`). Server-side `read_only` guard returns **HTTP 400** with a human-readable message.

2. **New `/api/authz/roles` (AuthzRolesResource)** — keyed by role **ID** (MongoDB ObjectId), supports list + get + delete only (NO create, NO update). Adds paginated assignee management: `PUT /api/authz/roles/{roleId}/assignees` (body: `Set<String>` of usernames) and `DELETE /api/authz/roles/{roleId}/assignee/{username}` (note SINGULAR `assignee` on DELETE, PLURAL `assignees` on PUT — a documented Graylog quirk verified live). Plus `GET /api/authz/roles/user/{username}` returns the user's role list. Returns `AuthzRoleDTO` with `id`/`name`/`description`/`permissions`/`read_only`. Server-side `read_only` guard returns **HTTP 405** with a generic `Method Not Allowed`.

**Recommended approach:** Use the **legacy `/api/roles`** surface for create/update/delete + assign/unassign. It is keyed by name (matches the success-criterion wording "keyed by role name + username"), supports the full lifecycle in one resource, and its 400-with-text error shape is more actionable than the authz endpoint's bare 405. Use the **new `/api/authz/roles` paginated endpoints** for `list_roles` ONLY when pagination is needed (16 roles on the live instance — well under one page). For Phase 11 v3.1.0, defer pagination; use legacy `GET /api/roles` for `list_roles` to keep one resource surface.

This is a textbook composition phase: every safety primitive (`defineMutatingHandler`, `cascade-hash` `computeCascadeHash`, `defineListHandler` from v3.0.0, `tagError` reason convention from Phase 10) is shipped. The only new primitives are:

1. A new `cascade-hash.js` wrapper `computeRoleCascadeHash` (for `update_role` / `delete_role` / `assign_role` / `unassign_role` confirmation tokens — one wrapper, four consumers).
2. A new `src/tools/authz/role-helpers.js` with the `BUILT_IN_ROLES` set and a `assertRoleIsMutable(roleName)` helper that refuses Admin/Reader/the 14 other shipped read-only roles client-side BEFORE any HTTP call.
3. Six handler files in `src/tools/authz/` (one per tool) plus schema entries in `src/tools/authz/schemas.js`.

**Primary recommendation:** Wire all 6/7 role tools into the existing `src/tools/authz/` domain (no new domain). Use `defineListHandler` for `list_roles` (and `get_role` if split). Use `defineMutatingHandler` for the four mutators. Reuse Phase 10's `tagError` / `requireConfirm` patterns verbatim. Build the `BUILT_IN_ROLES` set from the live captured fixture (16 names — `Admin`, `Reader`, plus 14 others) rather than hardcoding only `Admin`/`Reader`, because the success-criterion #4 names `Admin`/`Reader` but the live instance returns 14 more `read_only:true` roles that all behave identically (server returns 400 on update/delete).

## User Constraints (from CONTEXT.md)

> **No CONTEXT.md exists for Phase 11.** This research is therefore unconstrained by user-locked decisions beyond the milestone-level constraints in CLAUDE.md and PROJECT.md. The discuss-phase step should resolve the Open Questions below before planning starts.

### Project Constraints (from CLAUDE.md)

These directives constrain Phase 11 with the same authority as locked decisions:

- **Tech stack:** Node.js ≥18 ESM; existing dependencies only (`@modelcontextprotocol/sdk`, `axios`, `zod`); `zod` is the validation primitive — no new deps.
- **Graylog version:** 7.0.6 single target (verified live `7.0.6+711d207`); no multi-version branching.
- **Auth model:** Existing connection registry + API token; no new auth concepts; 403 surfaces as upstream error.
- **Safety:** Every mutating tool MUST default to `dryRun: true`. Applying without an explicit `dryRun: false` is a bug.
- **Backward compat:** Existing v2.3 tool contracts unchanged; existing connection-config schema additive only.
- **No web UI:** MCP server only; output is JSON-stringified text.
- **Code organization:** New admin tools extract into `src/tools/<domain>/` — for Phase 11, that's `src/tools/authz/` (the same domain as share-entity). NOT inline in `src/index.js`.
- **GSD workflow enforcement:** Plan creation goes through `/gsd:plan-phase`.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ROLE-01 | Agent can list all roles and read a role's permissions via `list_roles` | `GET /api/roles` returns `{roles:[{name,description,permissions,read_only}]}` (legacy resource). For single-role read, either: (a) bundle into `list_roles` by name-filter, or (b) ship a separate `get_role` tool (`GET /api/roles/{rolename}`). See Open Question 3. |
| ROLE-02 | Agent can create a custom role with a permission set via `create_role` | `POST /api/roles` with body `{name, description, permissions, read_only:false}` — verified 400-with-structured-body on missing `name`. |
| ROLE-03 | Agent can update a custom role's permissions and description via `update_role` | `PUT /api/roles/{rolename}` — replaces `name`+`description`+`permissions` from the body. **Full-replace semantics** on permissions (must read-merge-write for partial updates, see Pitfall 1). Server-side `read_only` guard returns HTTP 400 with text. |
| ROLE-04 | Agent can delete a custom role via `delete_role` | `DELETE /api/roles/{rolename}` — server-side `read_only` guard returns HTTP 400 with text. Cascading: `userService.dissociateAllUsersFromRole(role)` runs server-side BEFORE delete — Phase 11 should surface this in the dry-run preview so the agent sees the user-impact list. |
| ROLE-05 | Agent can assign a user to a role via `assign_role` | `PUT /api/roles/{rolename}/members/{username}` with body `"{}"` (per source: "Placeholder because PUT requests should have a body. Set to '{}', the content will be ignored."). Verified PUT body is mandatory. |
| ROLE-06 | Agent can unassign a user from a role via `unassign_role` | `DELETE /api/roles/{rolename}/members/{username}` (no body). Returns 204 No Content. |
| ROLE-07 | Role mutation tools refuse to modify the read-only built-in roles client-side | Build `BUILT_IN_ROLES` set from live captured fixture (16 names — see Built-in Roles section). `assertRoleIsMutable(roleName)` throws with `reason: "builtin_role_immutable"` BEFORE any HTTP call. The server-side guard is the backstop (400-with-text). |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Role CRUD (create/read/update/delete) | MCP tool layer (`src/tools/authz/{create,update,delete}-role.js`) + legacy `/api/roles[/{name}]` | — | Defer to v3.0.0 mutating-handler factory + a per-tool file in the existing `authz` domain. |
| List roles | MCP tool layer (`src/tools/authz/list-roles.js`) + `/api/roles` (legacy) | optional fallback to `/api/authz/roles` for pagination | One resource keeps the agent surface coherent; legacy returns the full set in one call for the 16-role test instance. |
| User-role assignment | MCP tool layer (`src/tools/authz/{assign,unassign}-role.js`) + `PUT/DELETE /api/roles/{rolename}/members/{username}` | — | Member management lives on the legacy role resource; mirrors the assign/unassign tool naming. |
| Built-in role refusal | MCP shared layer (`src/tools/authz/role-helpers.js` — `BUILT_IN_ROLES` set + `assertRoleIsMutable`) | Graylog 400 guard as backstop | Client-side refusal is success-criterion #4 — server-side guard is correct behaviour, but the milestone requirement is to refuse BEFORE the request reaches Graylog. |
| Confirmation-token hashing | MCP shared layer (`src/tools/_shared/cascade-hash.js` — new `computeRoleCascadeHash` wrapper) | — | Cross-tool primitive (4 consumers). Mirror the `computeNotificationCascadeHash` thin-wrapper pattern, not the standalone `computeShareGrantHash` pattern. |
| Drift refusal (TOCTOU) | `build()` re-call on apply path → recompute token → handler.js `requireConfirm` gate | — | Reuse Phase 10 mechanic verbatim. |
| HTTP transport | `src/graylog/client.js` (`makeClient(conn).request`) | — | Already supports PUT/DELETE with/without body. |

**Tier ownership check:** Every Phase 11 capability lives in the MCP tool layer or shared primitives. There are zero browser/CDN/frontend-server tiers — this is a server-only MCP project. If a plan task proposes any UI surface, that contradicts CLAUDE.md ("No web UI").

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | 1.18.0 [VERIFIED: package.json] | MCP server framework | Already in use; no upgrade. |
| `axios` | 1.12.2 [VERIFIED: package.json] | HTTP client (Basic auth, PUT/POST/DELETE with/without body, 4xx-body parsing via `validateStatus: () => true`) | Already in use. |
| `zod` | 3.25.76 [VERIFIED: package.json] | Schema validation; `mutatingBase.extend()` for the 4 mutating-tool schemas, plain `z.object` for the read schemas | Already in use; Phase 9 / Phase 10 precedent. |
| `node:crypto` | built-in | sha-256 confirmation tokens via the existing `cascade-hash.js` `computeCascadeHash` primitive | Already in use; the new `computeRoleCascadeHash` wrapper FORWARDS into `computeCascadeHash` (unlike `computeShareGrantHash`). |
| `node:test` + `c8` | built-in / dev | Offline fixture-replay tests via `_setCaptureRequest` seam; `npm test` runs the offline suite only | Phase 9 / 10 precedent. |

### Supporting (already shipped — DO NOT reinstall)

| Symbol | Source | Phase | Purpose |
|--------|--------|-------|---------|
| `defineMutatingHandler` | `src/tools/_shared/handler.js` | v3.0.0 Phase 0 | dryRun default, writable gate, idempotency, build/apply split, `requireConfirm` gate |
| `defineListHandler` | `src/tools/_shared/list.js` | v3.0.0 | List-projection factory (`list_roles`); see Open Question 4 for projection shape |
| `mutatingBase` | `src/tools/_shared/schemas.js` | v3.0.0 | zod object with `dryRun: z.boolean().default(true)`, `connectionName`, `idempotencyKey`, `confirm` |
| `computeCascadeHash` | `src/tools/_shared/cascade-hash.js` | v3.0.0 Phase 3 | Keyed-bucket sha-256 primitive — forwarding target for `computeRoleCascadeHash` |
| `resolveConnection` | `src/tools/_shared/connection.js` | v3.0.0 | `_testConnection` seam (string + Phase 10 inline-object form) |
| `makeClient` | `src/graylog/client.js` | v3.0.0 | HTTP client w/ writable-gate defense-in-depth |
| `wrapGraylogError`, `errorResponse`, `formatZodError` | `src/tools/_shared/errors.js` | v3.0.0 | Reason-tagged error surfacing |
| `tagError(err, reason, status)` helper pattern | `src/tools/authz/share-entity.js:71-78` | Phase 10 | Spoofed GraylogError shape for build-time errors |
| `DOMAIN_OVERRIDES` map | `src/tools/meta/list-admin-tools.js` | Phase 9 | Add role-tool names → `authz` to keep `list_admin_tools` zero-uncategorized invariant |
| Live 7.0.6 role fixtures (this phase) | `test/fixtures/authz/roles/*.json` | Phase 11 (NEW) | Captured via a one-shot probe script analogous to `scripts/capture-authz-prepare-fixture.js` |

**Installation:**
```bash
# Zero new dependencies. All required primitives are already installed.
# Verification:
npm view @modelcontextprotocol/sdk version  # 1.18.0+
npm view axios version                      # 1.12.2+
npm view zod version                        # 3.25.76+
```

**Version verification:** Already performed in Phase 8/9/10. No upgrade required.

## Package Legitimacy Audit

Phase 11 installs **no new packages**. All primitives (`axios`, `zod`, `@modelcontextprotocol/sdk`, `node:crypto`, `node:test`) are already in `package.json` and were vetted in v3.0.0 and Phase 8/9/10. The slopcheck gate is therefore **non-applicable** for this phase. If a planner-time decision adds a new dependency, that addition is itself a deviation from CLAUDE.md ("Zero new dependencies; new code under `src/tools/authz/`") and must be escalated to the user.

## Live API Recon (verified 2026-05-21 against `http://<graylog-host>` Graylog 7.0.6+711d207)

All probes used the existing `makeClient(conn).request` infrastructure — no raw curl, no bypass of the MCP project's HTTP layer (per user memory: "validate via the MCP, don't bypass with custom scripts"). The probes were GET-only against role CRUD endpoints, and intentionally-misformed PUT/POST/DELETE against bogus role/user identifiers to capture 4xx error shapes WITHOUT mutating any real role on the live instance.

### 1. List roles — TWO surfaces exist

**Legacy `/api/roles` (`RolesResource.listAll`):**
```
GET /api/roles  →  200
{
  "roles": [
    {
      "name": "Admin",
      "description": "Grants all permissions for administrators (built-in)",
      "permissions": ["*"],
      "read_only": true
    },
    ...
  ]
}
```
- No `id` field on the legacy resource.
- No pagination — returns all 16 roles in one call.
- No `total`/`page`/`count`/`query` envelope keys.

**New `/api/authz/roles` (`AuthzRolesResource.getList`):**
```
GET /api/authz/roles  →  200
{
  "total": 16,
  "page": 1,
  "per_page": 50,
  "count": 16,
  "roles": [
    {
      "id": "6a03288a1a8adce4f63263df",
      "name": "API Browser Reader",
      "description": "Allows viewing the API browser page",
      "permissions": ["api_browser:read"],
      "read_only": true
    },
    ...
  ]
}
```
- INCLUDES `id` field (MongoDB ObjectId).
- Paginated by default — `per_page=50`, easy to grow as the instance accumulates roles.
- Default sort is alphabetical by `name` ascending (verified live).

### 2. Get a single role

**Legacy: `GET /api/roles/{rolename}`** — `{rolename}` is URL-encoded (spaces → `%20`):
```
GET /api/roles/Cluster%20Configuration%20Reader  →  200
{ "name": "Cluster Configuration Reader",
  "description": "Allows viewing the Cluster Configuration page",
  "permissions": ["clusterconfiguration:read"],
  "read_only": true }
```
- Same `RoleResponse` shape as the list entries.
- 404 on unknown name: `{"type":"ApiError","message":"No role found with name {name}"}`.

**Authz: `GET /api/authz/roles/{roleId}`** — `{roleId}` is the MongoDB ObjectId:
```
GET /api/authz/roles/6a03288a1a8adce4f63263df  →  200
{ "id": "6a03288a1a8adce4f63263df",
  "name": "API Browser Reader",
  ... }
```
- 404 on unknown id: `{"type":"ApiError","message":"Could not find role with id: {id}"}`.

### 3. Per-role members / assignees

**Legacy: `GET /api/roles/{rolename}/members`** — rich response with full `UserSummary` per user:
```
GET /api/roles/Cluster%20Configuration%20Reader/members  →  200
{
  "role": "Cluster Configuration Reader",
  "users": [
    {
      "id": "6a02ebea4076fbb743b4848e",
      "username": "<user-a>",
      "full_name": "User A",
      "read_only": false,
      "email": "<user-a>@example.com",
      "first_name": "Herve",
      "last_name": "Tubaldo",
      "permissions": [...],              // FULL flattened permission set
      "grn_permissions": [],
      "preferences": {...},
      "timezone": "Europe/Paris",
      "session_timeout_ms": 28800000,
      "external": false,
      "startpage": null,
      "roles": ["Reader", "Cluster Configuration Reader"],
      "session_active": false,
      "last_activity": null,
      "client_address": null,
      "account_status": "enabled",
      "auth_service_enabled": true,
      "service_account": false
    },
    ...
  ]
}
```

**Authz: `GET /api/authz/roles/{roleId}/assignees`** — paginated minimal `UserOverviewDTO`:
```
GET /api/authz/roles/6a03288a1a8adce4f63263df/assignees  →  200
{
  "total": 0, "page": 1, "per_page": 50, "count": 0,
  "users": [], "query": ""
}
```

**Implication:** If `list_roles` should optionally surface the role's current members (deferred to Open Question 5), use the legacy `/members` endpoint — its response shape is what existing v2.3 tools already expect for user data.

### 4. User → roles lookup

```
GET /api/authz/roles/user/admin  →  200
{
  "total": 1, "page": 1, "per_page": 50, "count": 1,
  "roles": [
    { "id": "69f9a9ec14cd72728f83ef7b",
      "name": "Admin",
      "description": "...",
      "permissions": ["*"],
      "read_only": true }
  ],
  "query": "", "grand_total": 16
}
GET /api/authz/roles/user/__nonexistent__  →  404
{"type":"ApiError","message":"Couldn't find user: __nonexistent__"}
```
- This endpoint is **read-only** and useful for the dry-run preview of `assign_role`/`unassign_role` (show the user's current roles before mutation).
- Phase 11 v3.1.0 does NOT need to expose a `list_user_roles` tool (out-of-scope per REQUIREMENTS — only assign/unassign), but the dry-run preview of `assign_role` SHOULD call this to surface "before" state.

### 5. Create / update / delete error shapes

**POST /api/roles with empty body:**
```
POST /api/roles  body: {}  →  400
{"type":"RequestError",
 "message":"Error at \"name\" [1, 2]: Must be of type String",
 "line": 1, "column": 2,
 "path": "name",
 "reference_path": "org.graylog2.rest.models.roles.responses.RoleResponse[\"name\"]"}
```
- Note `type: "RequestError"` (not `ApiError`) — this is Graylog's structured-validation error type. Phase 11 should pass `RequestError.path`/`reference_path` through the MCP envelope so the agent can detect which field failed.

**PUT /api/roles/Admin update attempt:**
```
PUT /api/roles/Admin  body: {name:"Admin", permissions:["*"], description:"", read_only:true}  →  400
{"type":"ApiError","message":"Cannot update read only role Admin"}
```
- Server-side guard fires AFTER successful name-lookup. The 400-with-text is the structured signal. Phase 11's client-side `assertRoleIsMutable` is the fast-path; this is the backstop.

**DELETE /api/roles/Reader (legacy):**
```
DELETE /api/roles/Reader  →  400
{"type":"ApiError","message":"Cannot delete read only system role Reader"}
```

**DELETE /api/authz/roles/{readerId} (authz):**
```
DELETE /api/authz/roles/69f9a9ec14cd72728f83ef7e  →  405
{"type":"ApiError","message":"HTTP 405 Method Not Allowed"}
```
- **Surprise finding:** the authz endpoint returns a generic 405 on the read-only delete, NOT the informative legacy 400-with-text. This is a strong reason to prefer the legacy endpoint for delete.

**POST/PUT for unknown identifiers:**
```
PUT /api/authz/roles/000000000000000000000000/assignees  body: ["__nope__"]  →  404
{"type":"ApiError","message":"Cannot find user with name: __nope__"}
```
- Note: the user check fires BEFORE the role-id check in `updateUserRole` (source: `AuthzRolesResource.java:266-272`). So a bogus role + bogus user returns "user not found" rather than "role not found." Phase 11's `assign_role`/`unassign_role` dry-run preview should pre-validate BOTH (one read of `GET /api/roles/{name}` + one read of `GET /api/users/{username}` — or use the existing user→roles endpoint, see below) to surface the more specific failure before the mutation.

### 6. Endpoint discovery — `/api/api-docs` confirms both surfaces exist

```
GET /api/api-docs → 200
... apis array includes:
  { "path": "/authz/roles", "name": "Authorization/Roles", "description": "Manage roles" }
... and (from legacy registration, in the full doc):
  { "path": "/roles", "name": "Roles", "description": "User roles" }
```
- Both surfaces are documented; the planner can choose freely. The recommendation is to standardize on legacy `/api/roles` for the reasons above.

## Identifier Semantics

| Concept | Identifier | Format | URL encoding | Case sensitivity |
|---------|-----------|--------|--------------|-----------------|
| Role on `/api/roles[/{rolename}]` | NAME (string) | "Admin", "Cluster Configuration Reader", "MCP Server Access" | YES — `encodeURIComponent` (spaces → `%20`) | **Case-INSENSITIVE for delete only** per `RoleService.delete(roleName)` JavaDoc: "Deletes the (case insensitively) named role." `loadAllLowercaseNameMap` exists, so the service supports case-insensitive lookup. For GET/PUT, the Resource uses `roleService.load(name)` — UNCONFIRMED if case-insensitive; safest assumption is "match exactly as listed by `GET /api/roles`." |
| Role on `/api/authz/roles[/{roleId}]` | ID (MongoDB ObjectId) | "69f9a9ec14cd72728f83ef7b" (24-char hex) | NO — ObjectIds are URL-safe | Case-sensitive (hex is lowercase) |
| User on assign/unassign | USERNAME (string) | "admin", "<user-a>", "graylog-sidecar" | YES — `encodeURIComponent` for safety (usernames may contain `.` or `-`; verified live: `<user-b>`, `<user-c>`) | Case-sensitive — verified via "Couldn't find user: __nope__" |
| Permission strings | `{resource}:{action}` or `{resource}:{action}:{scope-id}` or `*` | `clusterconfiguration:read`, `users:edit:graylog-sidecar`, `*` (admin) | N/A (in JSON body) | Case-sensitive (lowercase per Graylog convention) |

**The `_id` field on `local:admin`:** The bootstrap admin user has id `"local:admin"` (verified live). This is a Graylog-specific marker for the locally-defined admin — it is NOT a MongoDB ObjectId. Any tool that accepts a user id (none in Phase 11 v3.1.0 — we use usernames throughout) must accept this format.

**Recommended tool surface — always keyed by NAME + USERNAME, never by ID:**
- Success-criterion #3 says "keyed by role name + username" — this aligns with the legacy `/api/roles/{rolename}/members/{username}` surface, no name→id round-trip needed.
- Internally, `update_role`/`delete_role` should accept `roleName` only (not `roleId`).
- `assign_role`/`unassign_role` should accept `roleName` + `username` only.

## Built-in Roles

The live 7.0.6 instance returns **16 built-in roles** (all `read_only: true`). Source `RoleServiceImpl.java:63-64` shows only `Admin` + `Reader` are bootstrapped by the legacy `RoleServiceImpl` constructor; the other 14 are seeded by plugin modules at startup. Success criterion #4 names only `Admin` and `Reader`, but the server treats all 16 identically (400-with-text on update/delete). Recommendation: build `BUILT_IN_ROLES` from the live capture, not from the source constants — the agent benefits from a richer client-side refusal.

### Full BUILT_IN_ROLES set (verified live 2026-05-21)

```javascript
// Source: GET /api/roles on Graylog 7.0.6+711d207 — captured fixture
// test/fixtures/authz/roles/list-roles-7.0.6.json
export const BUILT_IN_ROLES = new Set([
    "Admin",                            // ← success-criterion #4 names this
    "Reader",                           // ← success-criterion #4 names this
    "Alerts Manager",
    "API Browser Reader",
    "Cluster Configuration Reader",
    "Dashboard Creator",
    "Data Node Manager",
    "Event Definition Creator",
    "Event Notification Creator",
    "MCP Server Access",                // (probably an internal mcp-server plugin role on UNESCO instance)
    "Pipelines Manager",
    "Sidecar Manager",
    "Sidecar Reader",
    "Sidecar System (Internal)",
    "User Inspector",
    "Views Manager",
]);
```

**Edge cases for `assertRoleIsMutable`:**

1. Name case-insensitivity — `assertRoleIsMutable("admin")` should refuse (lowercase `admin` is what the server collapses to in `roleService.loadAllLowercaseNameMap`). Implementation: compare both sides lowercased.
2. The list MAY drift between Graylog deployments (e.g. enterprise builds add `Manager`, `Dashboard Reader`, `Stream Manager`). The captured list represents the OSS 7.0.6 baseline; the planner should decide whether to ALSO query the live `read_only` flag at the start of every mutating call (one extra GET → safer but slower) or to TRUST the static set + the server's 400-backstop (faster, slightly weaker client-side guard). Recommendation: **trust the static set + server backstop**. Rationale: success-criterion #4 is satisfied as long as the named roles (`Admin`, `Reader`) are refused; the 14 extras are bonus coverage; any role with `read_only: true` that ISN'T in the static set will still be refused by the server with 400-with-text — the client just won't pre-empt it. This trade-off matches Phase 10's "trust-the-server-backstop" pattern for the partial-view ownerless case.

**Open Question:** Should the recon also discover and PIN the built-in role count + name set as a baseline-shape test? (Like Phase 8's `prepare-response-7.0.6.json` is shape-pinned.) See Open Question 6.

## Mutating-Tool Shape — Concrete plan for the 4 mutating tools

Each follows the Phase 10 `share_entity` composition pattern: `defineMutatingHandler` + schema-derived inputs + `build()` that does pre-flight checks (and the client-side built-in refusal) + `apply()` that handles error classification + `requireConfirm` callback that returns the sha-256 token. The PRINCIPAL difference from `share_entity` is that role mutations do NOT need a read-merge-write — Graylog's `PUT /api/roles/{rolename}` does a full replace of `name`/`description`/`permissions`, but unlike entity-share's `selected_grantee_capabilities`, the agent ALWAYS supplies the full target permission set (the tool's input IS the desired state). The merge step is therefore omitted — but for `update_role` the dry-run preview must show the diff between current and desired state so the agent can see what's changing.

### `create_role`

**Endpoint:** `POST /api/roles`
**Body:** `{name: string, description?: string, permissions: string[], read_only: false}`
**Pre-flight:** `assertRoleIsMutable(args.name)` — refuse if `args.name` is a built-in name (client-side, prevents accidentally trying to overwrite via 400-roundtrip).
**Token canonical input:** `{tool: "create_role", name, permissions: [...sorted], description}`. Use the new `computeRoleCascadeHash` wrapper. The hash exists for **TOCTOU drift detection** — but for create there is no current state to drift from. Token's value is to bind preview-to-apply: if the agent sees `description: "X"` in preview and the apply body is `description: "Y"`, the token mismatches. Same TOCTOU pattern as `create_input` / `create_pipeline`.

### `update_role`

**Endpoint:** `PUT /api/roles/{rolename}`
**Body:** `{name, description?, permissions, read_only: <current value>}`
**Pre-flight:**
1. `assertRoleIsMutable(args.roleName)` — client-side refusal.
2. `GET /api/roles/{rolename}` — fetch current role (THIS IS THE READ in read-merge-write — for `update_role` it's read-PREVIEW-write, not read-merge-write, because the agent specifies the FULL new permissions set in the input).
3. If current `read_only:true` → refuse (defense-in-depth backstop).
4. Compute diff: permissions added/removed/unchanged + description-changed flag.
5. Token canonical input: `{tool:"update_role", name, permissions:[...sorted], description, current_permissions_hash}` — the `current_permissions_hash` is what gives TOCTOU refusal: another admin changing the role's permissions between dry-run and apply produces a different `current_permissions_hash` and the token mismatches.

**Diff shape in dry-run envelope:**
```json
"diff": {
  "permissions_added": ["streams:read:abc"],
  "permissions_removed": ["dashboards:read"],
  "permissions_unchanged": ["messages:read"],
  "description_changed": false
}
```

### `delete_role`

**Endpoint:** `DELETE /api/roles/{rolename}`
**Pre-flight:**
1. `assertRoleIsMutable(args.roleName)` — client-side refusal.
2. `GET /api/roles/{rolename}/members` — fetch the current member list (this is a cascade-impact preview; `userService.dissociateAllUsersFromRole(role)` runs server-side BEFORE delete per `RolesResource.java:187`, but the agent should SEE which users are about to lose this role).
3. Token canonical input: `{tool:"delete_role", name, members_hash: hash(sorted member usernames)}` — drift refusal fires if another admin assigned a new user to the role between dry-run and apply.

**Cascade in dry-run envelope:**
```json
"cascades": {
  "users_dissociated": [
    {"username": "<user-a>", "roles_before": ["Reader","Cluster Configuration Reader"],
                          "roles_after":  ["Reader"]},
    ...
  ],
  "count": 3
}
```

This matches the v3.0.0 `delete_stream` / `delete_index_set` cascade-preview pattern.

### `assign_role`

**Endpoint:** `PUT /api/roles/{rolename}/members/{username}`
**Body:** `"{}"` — see Pitfall 3.
**Pre-flight:**
1. `assertRoleIsMutable(args.roleName)` — **DO NOT** refuse on built-in roles for assign. Assigning to Reader/Admin is legitimate and common (the success-criterion #4 says "refused for update/delete client-side" — assign/unassign are NOT on the refusal list). The check is `assign_role` does NOT call `assertRoleIsMutable`.
2. `GET /api/roles/{rolename}` — verify the role exists (avoid the server-side 404 surprise where the user-check fires before the role-check on PUT `.../assignees`).
3. `GET /api/authz/roles/user/{username}` — fetch user's current roles list. Surface in preview.
4. Idempotency check: if `username` is ALREADY in the role's member list (user.roles contains roleName) → surface `existingMatches: [{username, similarity_reason: "already_assigned"}]` in preview; the PUT call is still issued (Graylog's `Sets.newHashSet(user.getRoleIds()).add(role.getId())` is a no-op for duplicate adds — verified via source `RolesResource.java:268-270`).
5. Token canonical input: `{tool:"assign_role", roleName, username, currentRolesHash: hash(sorted user.roles)}`.

### `unassign_role`

**Endpoint:** `DELETE /api/roles/{rolename}/members/{username}`
**Pre-flight:**
1. NO `assertRoleIsMutable` — same reasoning as `assign_role`.
2. `GET /api/roles/{rolename}` — verify role exists.
3. `GET /api/authz/roles/user/{username}` — fetch user's current roles.
4. Idempotency: if user is NOT currently assigned → either refuse with `reason:"not_currently_assigned"` (like Phase 10's `not_currently_granted`) OR surface as a no-op with `existingMatches: [{username, similarity_reason: "not_assigned"}]`. Recommendation: **refuse** — matches Phase 10's revoke semantics (`mergeGrants` throws `not_currently_granted` when revoking a non-grantee).
5. Token canonical input: `{tool:"unassign_role", roleName, username, currentRolesHash: hash(sorted user.roles)}`.

**Important corner case (`unassign Reader` from any user):** Graylog auto-assigns every user the `Reader` role at user creation. Unassigning Reader leaves the user with reduced privileges but is allowed by the server (verified live: source has no guard). Document this in the tool description so the agent doesn't accidentally strip basic permissions. Consider surfacing a `warning: "removing Reader strips default view permissions"` in the dry-run envelope.

## Permission Set Semantics

### Server-side validation surface

**There is NONE.** `RolesResource.create` and `update` pass `roleResponse.permissions()` (a `Set<String>`) straight through to `roleService.save(role)`. No permission-string validation, no enum check, no scope-id verification. An invalid permission string is silently accepted at create/update and only fails at the moment a user tries to exercise it (e.g. an unknown action returns a permission-denied at the consuming endpoint).

**Source verification:** `RolesResource.java:117-146` (create) and `:148-174` (update) — both call `role.setPermissions(roleResponse.permissions())` directly. No try/catch around `roleService.save` that surfaces validation errors specific to permissions.

### Wildcard support

The `Admin` built-in role has `permissions: ["*"]` (verified live). The wildcard IS accepted as a permission string — but the agent SHOULD be discouraged from creating custom roles with `["*"]` because that bypasses the role's reason-to-exist (granular permissions). Recommendation: emit a `warning: "permissions contains wildcard '*' — equivalent to Admin"` in the dry-run envelope if `permissions` includes `*`. Do NOT refuse — it's legitimate to create a "super-admin" role with a different name for audit purposes.

### Permission catalogue

The live instance exposes a permission catalogue at `GET /api/system/permissions`:
```
GET /api/system/permissions  →  200
{ "permissions": {
    "outputs": ["create","edit","terminate","read"],
    "sidecars": ["update","create","read","delete"],
    "datanode": ["opensearchproxy","read","remove","migration","stop","restproxy","reset","start"],
    "inputs": ["terminate","read","create","changestate","edit"],
    ...
}}
```
This is a `Map<resource, action[]>` of legal `{resource}:{action}` combinations. Phase 11 has TWO design choices (Open Question 1):

**(a) Pass-through** — accept arbitrary `permissions: string[]` and let the server silently accept anything.
**(b) Catalogue-aware** — `create_role`/`update_role` call `GET /api/system/permissions` in `build()`, validate each `{resource}:{action}` permission token against the catalogue, refuse unknown tokens client-side with `reason: "unknown_permission"`. This is the inverse of "trust-the-server-backstop": the server WON'T backstop, so the client MUST validate or unknown tokens silently exist forever.

Recommendation: **(b) catalogue-aware**, but with a `permitUnknownPermissions: false` opt-out flag for the rare case where the agent legitimately needs to encode an enterprise-plugin permission that the OSS catalogue doesn't list. This is a planner-time decision; flag for discuss-phase.

Note on scoped permissions (`{resource}:{action}:{scope-id}`): the catalogue lists only the `{resource}:{action}` pairs. A scoped permission like `users:edit:graylog-sidecar` is allowed (verified — it appears in built-in role permission sets). Validation needs to be smart: strip the optional `:{scope-id}` suffix and validate the `{resource}:{action}` prefix. Or, more conservatively, validate only that the permission has the `{resource}:{action}` shape and the `{resource}` exists in the catalogue.

### Edge case: empty permission set

`POST /api/roles  body: {name:"x", permissions: [], description:"y", read_only:false}` — is an empty set accepted? **Not verified live** (would have created a real role on the production test instance). Phase 11 should defensively allow empty permissions in zod (`z.array(z.string()).min(0)`) and rely on server validation. If the server rejects, the 400-with-RequestError surfaces it cleanly.

## assign/unassign Endpoint Mechanics

**There are TWO ways to manage role-user assignments on Graylog 7.0.6 — pick one for Phase 11:**

### Option A: Legacy `/api/roles/{rolename}/members/{username}` (RECOMMENDED)

- `PUT  /api/roles/{rolename}/members/{username}` body `"{}"` → assign
- `DELETE /api/roles/{rolename}/members/{username}` → unassign
- Both keyed by name + username — matches success-criterion #3 wording.
- Source: `RolesResource.java:250-309`.
- 204 No Content on success (both PUT and DELETE).
- Duplicate assign is idempotent (no error — verified via source `Sets.newHashSet().add()` returns false on duplicate but `userService.save()` is still called).
- Unassign of not-currently-assigned is idempotent server-side (`HashSet.remove()` returns false, `save()` still called) — but Phase 11 should refuse client-side for the better agent UX.

### Option B: Authz `/api/authz/roles/{roleId}/assignees`

- `PUT /api/authz/roles/{roleId}/assignees` body `["user1", "user2"]` (JSON array) → assign multiple users in one call
- `DELETE /api/authz/roles/{roleId}/assignee/{username}` → unassign (NOTE the singular `assignee` on DELETE — Graylog quirk)
- Keyed by role ID (requires a name→id round-trip).
- Source: `AuthzRolesResource.java:239-260`.
- Custom audit events (`ROLE_AUTHZ_UPDATE` / `ROLE_AUTHZ_DELETE`) — different from the legacy audit type `ROLE_MEMBERSHIP_UPDATE` / `ROLE_MEMBERSHIP_DELETE`.

**Comparison:**

| Feature | Legacy `/api/roles` | Authz `/api/authz/roles` |
|---------|--------------------|--------------------------|
| Keyed by | name | id |
| Assign one user | `PUT .../members/{username}` body `{}` | `PUT .../assignees` body `["username"]` |
| Assign N users in one call | No — need N PUTs | Yes — body is a `Set<String>` |
| Unassign | `DELETE .../members/{username}` | `DELETE .../assignee/{username}` (singular) |
| URL encoding gotchas | spaces in role name → `%20` | none (id is hex) |
| Audit event type | `ROLE_MEMBERSHIP_UPDATE/DELETE` | `ROLE_AUTHZ_UPDATE/DELETE` |
| Built-in delete error | (n/a — no role delete from this resource) | n/a |
| Built-in update error | (n/a — assignments aren't a "role update") | n/a |

**Recommendation: Option A (legacy)** for Phase 11 v3.1.0. Reasons:

1. Matches success-criterion #3 ("keyed by role name + username").
2. No name→id round-trip — simpler tool surface, fewer failure modes.
3. URL encoding is a solved problem (Phase 8/9/10 use `encodeURIComponent`).
4. The "multiple users in one call" feature of Option B is YAGNI for the Phase 11 tool surface — `assign_role` accepts one username; if the agent needs to assign 3 users they call 3 times. (Open Question 2 — should `assign_role` accept multiple users? Defer to discuss-phase.)
5. The legacy endpoint's audit event type is the older, more-established `ROLE_MEMBERSHIP_*` — better cross-tool grep in audit logs.

## Architecture Patterns

### System Architecture Diagram

```
agent: create_role / update_role / delete_role / assign_role / unassign_role / list_roles
   │
   ▼
src/index.js  CallTool → dispatch(<tool>) → handleX  (defineMutatingHandler or defineListHandler)
   │
   │  Read tools (list_roles, optional get_role):
   │     │
   │     ├─ zod parse  (plain z.object — NO mutatingBase, NO dryRun)
   │     ├─ resolveConnection + _testConnection seam re-merge
   │     ├─ GET /api/roles  (or /api/roles/{name} for get_role)
   │     └─ envelope {tool, connection, roles: [...]}
   │
   │  Mutating tools (create / update / delete / assign / unassign):
   │     │
   │     ├─ 1. zod.parse(args)
   │     ├─ 2. resolveConnection (+ seam)
   │     ├─ 3. writable gate
   │     ├─ 4. idempotencyKey
   │     ├─ 5. async build({...args, _conn})
   │     │       │
   │     │       ├─ assertRoleIsMutable(roleName)        ← update_role / delete_role only
   │     │       │     (refuse if BUILT_IN_ROLES.has(name.toLowerCase()))
   │     │       ├─ GET /api/roles/{name}                ← pre-flight current state
   │     │       │     (also fetches read_only flag as backstop)
   │     │       ├─ (delete_role only) GET .../members  ← cascade preview
   │     │       ├─ (assign/unassign)   GET /api/authz/roles/user/{username}
   │     │       │     ← surface user's current roles in preview
   │     │       ├─ (create/update) GET /api/system/permissions  ← catalogue validation (Open Q1)
   │     │       ├─ Compute diff (update_role)  /  cascade (delete_role)
   │     │       ├─ token = computeRoleCascadeHash({tool, name, ...})
   │     │       └─ return {method, path, body, _confirmationToken, cascades?, existingMatches?,
   │     │                  postApplyEstimate, _previewExtras:{diff?, cascade?, warnings?}}
   │     ├─ 6. dryRun? emit preview w/ confirmationToken + diff + cascade + warnings
   │     ├─ 6b. requireConfirm gate (args.confirm === token? proceed : refuse)
   │     ├─ 7. apply(client, req)  ← POST/PUT/DELETE
   │     │       │
   │     │       ├─ 400 with body.type === "RequestError" or "ApiError"
   │     │       │   → return {isError, reason:"role_validation_failed", content:{...}}
   │     │       ├─ 405 (only on authz endpoint — not used in Phase 11) → reason:"method_not_allowed"
   │     │       └─ 404 → reason:"role_not_found" or "user_not_found" (parse the message)
   │     └─ 8. normalize(raw) → {id, body}
   │
   ▼
   MCP client receives  {applied:true, tool, result:{id, body}}
```

### Recommended Project Structure (additive — no existing file deleted)

```
src/tools/authz/
├── grn-helpers.js                # UNCHANGED — Phase 8/9
├── schemas.js                    # MODIFIED — add 6 role schemas
├── index.js                      # MODIFIED — 6 register() calls
├── prepare-share.js              # UNCHANGED — Phase 9
├── get-entity-shares.js          # UNCHANGED — Phase 9
├── list-grantees.js              # UNCHANGED — Phase 9
├── share-entity.js               # UNCHANGED — Phase 10
├── role-helpers.js               # NEW — BUILT_IN_ROLES + assertRoleIsMutable + sortedRolesHash
├── list-roles.js                 # NEW — GET /api/roles
├── get-role.js                   # NEW (optional — see Open Q3) — GET /api/roles/{name}
├── create-role.js                # NEW — POST /api/roles
├── update-role.js                # NEW — read-PREVIEW-write via GET + PUT
├── delete-role.js                # NEW — read-CASCADE-write via GET .../members + DELETE
├── assign-role.js                # NEW — read-state + PUT .../members/{username}
└── unassign-role.js              # NEW — read-state + DELETE .../members/{username}

src/tools/_shared/cascade-hash.js # MODIFIED — add computeRoleCascadeHash thin wrapper

src/tools.js                      # MODIFIED — append 6 (or 7) tool definitions
src/tools/meta/list-admin-tools.js # MODIFIED — add 6 (or 7) tool names to DOMAIN_OVERRIDES → authz

scripts/
└── capture-roles-fixtures.js     # NEW — one-shot live read-only probe; commits 4 fixtures

test/
├── authz-roles.test.js           # NEW — Wave 0 offline tests for the 6 (or 7) tools
└── fixtures/authz/roles/
    ├── list-roles-7.0.6.json     # NEW — captured live (16 roles, full DTO)
    ├── get-role-admin-7.0.6.json # NEW — Admin role single response
    ├── get-role-members-7.0.6.json # NEW — Reader members or similar
    └── user-roles-admin-7.0.6.json # NEW — admin user's role list
```

**Wiring edits (mechanical):**

1. `src/tools.js` — append 6 (or 7) `{name, description, inputSchema}` objects between `share_entity` (line 1942) and `list_admin_tools`.
2. `src/tools/authz/index.js` — add 6 `import` + 6 `register()` calls.
3. `src/tools/authz/schemas.js` — append 6 schemas: `ListRolesSchema` (plain, optional `nameFilter`), `GetRoleSchema` (plain, required `roleName`), `CreateRoleSchema` (mutatingBase + name+permissions+description), `UpdateRoleSchema` (mutatingBase + roleName + same payload shape as create), `DeleteRoleSchema` (mutatingBase + roleName), `AssignRoleSchema` (mutatingBase + roleName + username), `UnassignRoleSchema` (mutatingBase + roleName + username).
4. Tool-count assertions in `test/list-admin-tools.test.js`, `test/pipelines.test.js`, `test/dashboards.test.js` → update 94 → 100 (or 101 with `get_role`).
5. `src/tools/meta/list-admin-tools.js` `DOMAIN_OVERRIDES` — add 6 (or 7) entries → `authz`.

### Pattern 1: defineMutatingHandler with async build() — direct precedent

**Direct line-by-line precedent:** `src/tools/authz/share-entity.js:221-388`. Phase 11's `update_role` is the closest analog because it does pre-flight GET + diff computation + confirmation token over a canonical input.

```javascript
// src/tools/authz/update-role.js — sketch
import { defineMutatingHandler } from "../_shared/handler.js";
import { UpdateRoleSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { assertRoleIsMutable, sortedPermissionsHash } from "./role-helpers.js";
import { computeRoleCascadeHash } from "../_shared/cascade-hash.js";
import { tagError } from "./role-helpers.js";  // factored helper, shared across all mutators

export const handleUpdateRole = defineMutatingHandler({
    name: "update_role",
    schema: UpdateRoleSchema,
    async build(args) {
        const client = makeClient(args._conn);

        // 1. Client-side built-in refusal (success-criterion #4)
        try { assertRoleIsMutable(args.roleName); }
        catch (err) { throw tagError(err, "builtin_role_immutable", 422); }

        // 2. Pre-flight GET — current state
        let current;
        try {
            current = await client.request("GET", `/api/roles/${encodeURIComponent(args.roleName)}`, null);
        } catch (err) {
            if (err?.isGraylogError && err.status === 404) {
                throw tagError(err, "role_not_found", 404);
            }
            throw err;
        }

        // 3. Server-side read_only backstop (defense in depth — the static set
        //    may not contain a plugin-added role, but the server's flag will)
        if (current.read_only === true) {
            throw tagError(
                new Error(`role "${args.roleName}" is server-marked read_only — cannot update`),
                "builtin_role_immutable",
                422,
            );
        }

        // 4. Diff computation for preview
        const diff = computePermissionsDiff(current.permissions, args.permissions);

        // 5. Token canonical input — includes a hash of CURRENT permissions for TOCTOU
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
                name: args.roleName,                        // RolesResource sets this from request, not path
                description: args.description ?? current.description,
                permissions: args.permissions,
                read_only: false,
            },
            _confirmationToken: confirmationToken,
            existingMatches: diff.unchanged.map((p) => ({ permission: p, similarity_reason: "already_granted" })),
            postApplyEstimate: { id: args.roleName, async: false },
            // surface via handler.js ...(req.cascades ? { cascades: req.cascades } : {})
            cascades: { diff },
        };
    },
    apply: async (client, req) => {
        try {
            return await client.request(req.method, req.path, req.body);
        } catch (err) {
            if (err?.isGraylogError && err.status === 400 && err.body?.type === "ApiError"
                && /read only/i.test(err.body.message ?? "")) {
                err.reason = "builtin_role_immutable";
                throw err;
            }
            if (err?.isGraylogError && err.status === 400 && err.body?.type === "RequestError") {
                return {
                    isError: true,
                    reason: "role_validation_failed",
                    content: [{ type: "text", text: JSON.stringify({
                        tool: "update_role",
                        status: 400,
                        path: err.body.path,                     // e.g. "name"
                        reference_path: err.body.reference_path, // e.g. "...RoleResponse[\"name\"]"
                        message: err.body.message,
                    })}],
                };
            }
            throw err;
        }
    },
    summarize: (args) => `Update role ${args.roleName} permissions (${args.permissions.length})`,
    requireConfirm: ({ req }) => req._confirmationToken ?? null,
});
```

### Pattern 2: defineListHandler for list_roles

```javascript
// src/tools/authz/list-roles.js — sketch
// Use defineListHandler (precedent: src/tools/pipelines/list-pipelines.js)
// Returns the FULL DTO without projection — the agent benefits from seeing
// permissions + read_only flag inline.
export const handleListRoles = defineListHandler({
    name: "list_roles",
    schema: ListRolesSchema,
    async fetch(client, args) {
        const response = await client.request("GET", "/api/roles", null);
        let roles = response?.roles ?? [];
        if (args.nameFilter) {
            const needle = args.nameFilter.toLowerCase();
            roles = roles.filter((r) => r.name.toLowerCase().includes(needle));
        }
        return { roles, count: roles.length };
    },
});
```

### Pattern 3: Thin cascade-hash wrapper — FORWARDING, not standalone

Unlike `computeShareGrantHash` (which is standalone because grants are a flat list, not keyed buckets), `computeRoleCascadeHash` SHOULD forward into `computeCascadeHash` because the inputs naturally bucket by `tool` + per-tool field set.

```javascript
// src/tools/_shared/cascade-hash.js — append
// Phase 11 — computeRoleCascadeHash (role-tool confirmation token).
//
// FORWARDS into computeCascadeHash. Unlike computeShareGrantHash (which is
// standalone because grants are a flat list), role tools all have a fixed
// per-tool field set that maps cleanly onto computeCascadeHash's keyed-bucket
// shape:
//   - create_role:   {tool, name, permissions(sorted), description}
//   - update_role:   {tool, name, permissions(sorted), description, current_permissions_hash}
//   - delete_role:   {tool, name, members_hash}
//   - assign_role:   {tool, roleName, username, current_roles_hash}
//   - unassign_role: {tool, roleName, username, current_roles_hash}
//
// The `tool` field is the bucket discriminator so a token from create_role X
// cannot validate an apply on update_role X (cross-tool replay protection).
export function computeRoleCascadeHash(input) {
    if (!input || typeof input !== "object" || typeof input.tool !== "string") {
        throw new Error("computeRoleCascadeHash: input.tool is required");
    }
    return computeCascadeHash([
        { kind: input.tool, items: [input] },   // single-item bucket per call
    ]);
}
```

Byte-identity pin tests follow the `computeNotificationCascadeHash` precedent — `test/cascade-hash.test.js`. Pin 5 frozen-fixture tokens (one per tool), plus a cross-tool drift test (`create_role X` token ≠ `update_role X` token), plus order-independence on the permissions array.

### Anti-Patterns to Avoid

- **AP1: Hand-construct PUT body for assign — `body: null` or `body: undefined`.** The Graylog 7.0.6 source explicitly says `"Placeholder because PUT requests should have a body. Set to '{}', the content will be ignored."` (`RolesResource.java:256`). Pass `{}`, NOT `null` — `null` body in `client.js:53-66` skips Content-Type entirely → Graylog responds 415 Unsupported Media Type or 400.
- **AP2: Use `/api/authz/roles` for delete.** Returns generic HTTP 405 on read-only (`{"message":"HTTP 405 Method Not Allowed"}`), versus legacy `/api/roles`'s clear `{"message":"Cannot delete read only system role Reader"}`. The legacy endpoint's error is actionable; the authz endpoint's is not.
- **AP3: Hardcode only `Admin` + `Reader` in BUILT_IN_ROLES.** The live instance has 16 read-only roles; pinning only 2 means agents waste a round-trip discovering the other 14 are also blocked. Build the static set from the live capture.
- **AP4: Skip client-side `assertRoleIsMutable` on `assign_role` / `unassign_role`.** These tools DO operate on built-in roles legitimately (assigning a user to `Reader` or `Admin` is normal). The success-criterion #4 wording "refused for update/delete" excludes assign/unassign — do NOT extend the guard to them.
- **AP5: Skip the pre-flight `GET /api/roles/{name}` on `update_role`.** Without it, the server's `read_only:true` backstop doesn't fire until the PUT; the dry-run preview would show "would PUT to /api/roles/Admin" without warning the agent that the apply will fail. The pre-flight also enables the diff computation.
- **AP6: Combine `create_role` + `update_role` into a single `upsert_role` tool.** Different audit events server-side (`ROLE_CREATE` vs `ROLE_UPDATE`); different default semantics (create asserts not-exists, update asserts exists); different success-criterion mappings. Keep them separate.
- **AP7: Validate permission strings client-side via regex without consulting `GET /api/system/permissions`.** Permission strings have arbitrary scope-id suffixes (`users:edit:graylog-sidecar`) — regex-only validation will either over-reject legitimate scoped permissions or under-validate. Either consult the catalogue (Option Q1-b) or trust the server (Option Q1-a) — DO NOT half-validate.
- **AP8: Forward a `roleId` (24-char hex) to the legacy endpoint.** `GET /api/roles/{24-char-hex}` returns 404 — the legacy endpoint matches on name, not id. If the agent (or a misled future tool) passes an id, the error message says "No role found with name {hex}" which is confusing. Phase 11's schemas should validate `roleName` shape (non-empty string, not a 24-char hex) and reject hex-like inputs with `reason: "use_role_name_not_id"`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| sha-256 confirmation token | Custom canonicalizer + crypto call | `computeRoleCascadeHash` (new thin wrapper) → `computeCascadeHash` | Existing primitive; byte-pinned discipline already in `test/cascade-hash.test.js`. |
| dryRun-default + writable-gate + idempotency | Per-tool plumbing | `defineMutatingHandler({...})` | All four invariants enforced in one place. |
| List endpoint pagination + envelope | Per-tool envelope | `defineListHandler({...})` | Existing primitive — used by every list_* tool in v3.0.0. |
| Connection resolution | Per-tool `getConnection(...)` | `resolveConnection(args)` | Centralizes `_testConnection` seam (string + Phase 10 inline-object form). |
| URL encoding | Inline `replace(/:/g, "%3A")` | `encodeURIComponent(roleName)` | Phase 9 precedent; safe for all path segments including spaces. |
| Error tagging for build-time refusals | New error class | `tagError(err, reason, 422)` helper | Phase 10 precedent (`share-entity.js:71-78`); spoofed GraylogError shape so `wrapGraylogError` surfaces the reason in both rendered text and envelope. |
| Confirmation gate enforcement | Per-tool `if (args.confirm !== token) refuse` | `requireConfirm: ({req}) => req._confirmationToken` callback | Wrapper-level gate at `handler.js:211-225`. |
| Built-in role refusal | Hardcoded `if (name === "Admin" || name === "Reader")` | `assertRoleIsMutable(roleName)` calling `BUILT_IN_ROLES.has(name.toLowerCase())` | Captured-from-live discipline; future-proof when Graylog adds more built-ins. |
| HTTP layer | Raw `axios.post(...)` | `makeClient(conn).request("POST", path, body)` | Handles auth, writable-gate, error classification. |
| Permission catalogue fetch | Per-tool fetch + cache | A single shared `fetchPermissionCatalogue(client)` helper if Open Q1-b is chosen | Avoid duplicating the GET across create_role and update_role. |

**Key insight:** Phase 11 is — like Phase 10 — a **composition phase**. The only genuinely new code is:
1. `role-helpers.js` (BUILT_IN_ROLES + assertRoleIsMutable + tagError + sortedPermissionsHash + computePermissionsDiff)
2. `computeRoleCascadeHash` wrapper in `cascade-hash.js`
3. Six handler files (each ≈150-250 lines following the share-entity.js shape)
4. One offline test file
5. One live-capture script + four fixture files

Total new src LOC estimate: ~1,200-1,500 (consistent with Phase 10's ~290 LOC handler × 6 tools, scaled for the slightly-thinner per-tool surface).

## Runtime State Inventory

> Phase 11 is **not** a rename/refactor/migration phase — it is greenfield scaffolding (new files + schema additions + register() calls).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — role tools are stateless; no MCP-side persistence (the Graylog server holds the role records). | None |
| Live service config | The live `test` Graylog instance has 16 built-in roles + 0 custom roles (verified). Tests should NOT pre-create any custom roles on the live instance — fixtures replay offline. | None during research; UAT phase may create a throwaway custom role (per Phase 8 test strategy). |
| OS-registered state | None — no schedulers, daemons. | None |
| Secrets/env vars | None new — reuses the existing connection-registry API token. | None |
| Build artifacts | None — no build step (`"type": "module"`, direct `node` execution). | None |

## Common Pitfalls

### Pitfall 1: `update_role` body MUST include `name` and `read_only`, not just changed fields

**What goes wrong:** The agent thinks of `update_role` as a PATCH — sends just `{permissions: [...]}`. The server's `RoleResponse` is `@JsonCreator` with `required = true` on `name` → 400 `RequestError`: "Error at \"name\" ... Must be of type String".
**Why it happens:** REST PUT-as-PATCH intuition; Graylog uses PUT-as-full-replace.
**How to avoid:** `build()` ALWAYS sends `{name: args.roleName, description: args.description ?? current.description, permissions: args.permissions, read_only: false}`. The `name` field in the body MUST equal the `{rolename}` in the path; Graylog accepts a body-rename (changes the role's name) but Phase 11 should refuse that explicitly via zod — `args.roleName` is the identifier, the body's `name` always echoes it.
**Warning signs:** Tests show `update_role` working when called with `{roleName: "X", permissions: [...]}` but failing on the live instance with 400 RequestError.

### Pitfall 2: Role name URL encoding — spaces, parens, slashes

**What goes wrong:** Path is `/api/roles/${args.roleName}` without encoding; spaces break it.
**Why it happens:** The live built-in role list includes names like `"Cluster Configuration Reader"`, `"Sidecar System (Internal)"`, `"Sidecar Reader"`. Spaces, parentheses, and the literal `/` (in custom role names) all need URL-encoding.
**How to avoid:** ALWAYS `encodeURIComponent(args.roleName)`. Phase 8 already established this discipline for GRNs; extend it to role names. Add a path-encoding test: `encodeURIComponent("Sidecar System (Internal)") === "Sidecar%20System%20(Internal)"`.
**Warning signs:** GET works for `"Admin"` but 404 for `"Sidecar System (Internal)"`.

### Pitfall 3: `assign_role` PUT body MUST be `{}`, not `null`

**What goes wrong:** `client.request("PUT", path, null)` — `client.js:53-66` sees `null` body, skips `Content-Type: application/json`, sends no body. Graylog responds 415 or 400.
**Why it happens:** Intuition that an empty body should be `null`. The Graylog source explicitly says `"Set to '{}', the content will be ignored."` (`RolesResource.java:256`).
**How to avoid:** Hard-code `body: {}` in `assign-role.js`'s `build()` return value. Mirror Phase 9's `prepare-share.js:44` discipline (which also passes `{}`).
**Warning signs:** `assign_role` tests pass with the `_setCaptureRequest` mock (which echoes `body: null`) but fail against the live instance.

### Pitfall 4: Permission-string validation tradeoff — silent acceptance of invalid strings

**What goes wrong:** Agent passes `permissions: ["streams:READ"]` (uppercase action) or `["stream:read"]` (singular resource). Server silently accepts; the permission never matches any code path; the role is permanently broken in a way that only surfaces when a user assigned the role tries to perform the action.
**Why it happens:** `RolesResource.create` and `update` do not validate permission strings (see Permission Set Semantics section above).
**How to avoid:** Either (a) document loudly that the tool is pass-through and the agent is responsible for valid permissions, OR (b) validate against `GET /api/system/permissions` in build(). Open Question 1 — defer to discuss-phase.
**Warning signs:** A role with permissions `["foo:bar"]` succeeds at create+update but no user with the role can do anything related to `foo`.

### Pitfall 5: `unassign_role` for the only `Admin` member would lock the instance

**What goes wrong:** Agent unassigns the last `Admin` user, then no human can administer Graylog. No client-side guard exists.
**Why it happens:** Graylog has no server-side "last-admin" guard (unlike Phase 10's `last-own` for entity ownership).
**How to avoid:** In `unassign_role`'s `build()`: when `args.roleName.toLowerCase() === "admin"`, call `GET /api/roles/Admin/members` and compute the post-apply admin count. If it would be 0, refuse with `reason: "would_leave_no_admin"`. This is a Phase 11 invariant not in the source — analogous to Phase 10's `would_leave_entity_ownerless`.
**Warning signs:** A dry-run preview of `unassign_role admin Admin` shows `applyHint: "Re-call with dryRun: false to apply"` without warning the agent.

### Pitfall 6: `delete_role` cascade-dissociates ALL users — must surface in preview

**What goes wrong:** Agent deletes a role assigned to 50 users; the role is gone and all 50 users lose those permissions silently. The agent thought it was deleting an unused role.
**Why it happens:** `RolesResource.delete:187` calls `userService.dissociateAllUsersFromRole(role)` before `roleService.delete` — server-side cascade with no preview.
**How to avoid:** `delete_role.build()` MUST call `GET /api/roles/{name}/members` first; preview the user-list as `cascades.users_dissociated`. The token covers a hash of the member list so concurrent assignment changes between dry-run and apply trigger drift refusal.
**Warning signs:** Dry-run preview lacks a `cascades` field for `delete_role`.

### Pitfall 7: Role-name case behavior is asymmetric

**What goes wrong:** Agent calls `assign_role admin reader` — passes lowercase `reader` thinking case doesn't matter. Server returns 404 because GET/PUT on `/api/roles/reader` doesn't find `"Reader"`.
**Why it happens:** `RoleService.delete` is case-insensitive (per JavaDoc), but `RoleService.load` behavior on case is UNVERIFIED. The safe assumption is "match exactly as listed."
**How to avoid:** `build()`'s pre-flight GET reveals the canonical case. If a 404 is encountered, the apply() error message should include "(role names are case-sensitive — verify with list_roles)". Better: do a `list_roles` fallback in build() — if `GET /api/roles/{args.roleName}` 404s, lowercase-match against the full `GET /api/roles` list and refuse with a candidate-list error.
**Warning signs:** Tests pass with the exact case from a fixture but the agent fails in practice with mis-cased role names.

### Pitfall 8: The `/api/authz/roles/{id}/assignees` PUT requires usernames, NOT user IDs

**What goes wrong:** If someone chooses Option B (the authz endpoint for assign) — body is a `Set<String>` of usernames. Confusion possible because the role is keyed by ID but users are keyed by username in the same call.
**Why it happens:** Inconsistency in the Graylog API surface — half name-based, half id-based.
**How to avoid:** Recommend Option A (legacy `/api/roles/{name}/members/{username}`) where both identifiers are names — no inconsistency. If Option B is chosen for any reason, doc-comment loudly.
**Warning signs:** Off by the recommendation — should not arise in Phase 11.

## Code Examples

### Live-capture probe script — `scripts/capture-roles-fixtures.js` (sketch)

Mirrors the structure of `scripts/capture-authz-prepare-fixture.js`. Read-only. Captures four fixtures.

```javascript
#!/usr/bin/env node
// Phase 11 — one-shot read-only live recon probe for the role-management surface.
//
// SAFETY: Every call is a GET. Never PUT/POST/DELETE. The live `test` connection
// is production UNESCO infra (user memory: "graylog test connection is live UNESCO").
//
// Captures four committed fixtures:
//   - list-roles-7.0.6.json          — full GET /api/roles response (16 roles)
//   - get-role-admin-7.0.6.json      — single Admin role
//   - get-role-members-reader.json   — Reader role's members (multi-user)
//   - user-roles-admin-7.0.6.json    — admin user's role list
//
// Each fixture has an _provenance block (instance, connection, version, captured_at).

import { makeClient } from "../src/graylog/client.js";
import { getConnections } from "../src/config.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TARGET = "test";
const conn = getConnections()[TARGET];
const client = makeClient(conn);

const sys = await client.request("GET", "/api/system");
const provenance = (endpoint) => ({
    captured_by: "scripts/capture-roles-fixtures.js",
    instance: conn.baseUrl, connection: TARGET,
    graylog_version: sys.version,
    endpoint, captured_at: new Date().toISOString(),
});

// 1. List all roles
const listRoles = await client.request("GET", "/api/roles");
writeFixture("list-roles-7.0.6.json", {
    _provenance: provenance("GET /api/roles"), ...listRoles,
});

// 2. Get the Admin role single
const admin = await client.request("GET", "/api/roles/Admin");
writeFixture("get-role-admin-7.0.6.json", {
    _provenance: provenance("GET /api/roles/Admin"), ...admin,
});

// 3. Get Reader members (a built-in role with multiple users)
const members = await client.request("GET", "/api/roles/Reader/members");
writeFixture("get-role-members-reader-7.0.6.json", {
    _provenance: provenance("GET /api/roles/Reader/members"), ...members,
});

// 4. Get admin user's roles
const userRoles = await client.request("GET", "/api/authz/roles/user/admin");
writeFixture("user-roles-admin-7.0.6.json", {
    _provenance: provenance("GET /api/authz/roles/user/admin"), ...userRoles,
});

function writeFixture(name, content) {
    const dir = join("test", "fixtures", "authz", "roles");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), JSON.stringify(content, null, 2) + "\n", "utf8");
    console.error(`wrote ${join(dir, name)}`);
}
```

### `role-helpers.js` — BUILT_IN_ROLES + assertRoleIsMutable + tagError

```javascript
// src/tools/authz/role-helpers.js — Phase 11.
// Centralizes the built-in-role refusal logic and the cross-tool tagError helper.

import { createHash } from "node:crypto";

// Captured from live 7.0.6 GET /api/roles (16 read_only:true roles). Maintained
// by re-running scripts/capture-roles-fixtures.js when Graylog adds new
// built-ins (e.g. an enterprise build). The server's 400 backstop catches any
// gap. Compared LOWERCASED — Graylog's RoleService treats role names
// case-insensitively for delete (RoleService.delete JavaDoc) so a defensive
// lowercase comparison avoids "admin"/"Admin" mismatches.
export const BUILT_IN_ROLES = new Set([
    "admin",
    "reader",
    "alerts manager",
    "api browser reader",
    "cluster configuration reader",
    "dashboard creator",
    "data node manager",
    "event definition creator",
    "event notification creator",
    "mcp server access",
    "pipelines manager",
    "sidecar manager",
    "sidecar reader",
    "sidecar system (internal)",
    "user inspector",
    "views manager",
]);

// Refuse client-side when args.roleName is in the built-in set (ROLE-07). The
// caller wraps the thrown error with tagError(_, "builtin_role_immutable").
export function assertRoleIsMutable(roleName) {
    if (typeof roleName !== "string" || roleName.length === 0) {
        throw new Error("assertRoleIsMutable: roleName must be a non-empty string");
    }
    if (BUILT_IN_ROLES.has(roleName.toLowerCase())) {
        throw new Error(
            `role "${roleName}" is a built-in (read-only) role — cannot mutate ` +
            `(use list_roles to see the full set; custom roles are mutable)`,
        );
    }
}

// Phase 10 share-entity.js:71-78 verbatim — kept as a shared helper because
// every Phase 11 mutating tool uses it for build-time errors.
export function tagError(err, reason, status = 422) {
    err.isGraylogError = true;
    err.status = status;
    err.method = "";
    err.path = "";
    err.reason = reason;
    return err;
}

// Token canonical form for permission sets — sorted + hashed.
export function sortedPermissionsHash(permissions) {
    const sorted = [...(Array.isArray(permissions) ? permissions : [])].sort();
    return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

// Sorted role-names hash for assign/unassign drift detection.
export function sortedRolesHash(roles) {
    const sorted = [...(Array.isArray(roles) ? roles : [])].sort();
    return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

// Permission diff for update_role preview.
export function computePermissionsDiff(currentPerms, targetPerms) {
    const current = new Set(currentPerms ?? []);
    const target = new Set(targetPerms ?? []);
    return {
        added:     [...target].filter((p) => !current.has(p)).sort(),
        removed:   [...current].filter((p) => !target.has(p)).sort(),
        unchanged: [...target].filter((p) => current.has(p)).sort(),
    };
}
```

### Test scaffolding — `test/authz-roles.test.js` (skeleton, expected ~30-40 tests)

Mirrors `test/authz-share-entity.test.js`:

- 1× list_roles request-path + envelope test (fixture replay).
- 4× per-tool dryRun-default test (`list_roles` is non-mutating, skip).
- 5× per-tool confirmation-token test (returned in dry-run, matched at apply, mismatch refused).
- 5× per-tool TOCTOU drift refusal test (build() runs twice, current state changes, token mismatches).
- 1× **MANDATORY** built-in-refusal acceptance gate: `update_role` on `Admin` → refuse client-side with `reason:"builtin_role_immutable"` BEFORE any HTTP call (no captured request).
- 1× same for `delete_role` on `Reader`.
- 1× same for each of the other 14 built-ins (parameterized loop).
- 1× **OPTIONAL** "last-admin guard" test for `unassign_role Admin` when only one admin remains (Pitfall 5).
- 1× **MANDATORY** `delete_role` cascade-preview test: dry-run for a role with N members surfaces `cascades.users_dissociated` array of length N.
- 1× `assign_role` body-is-`{}` assertion (not `null`).
- 1× `assign_role` `assertRoleIsMutable` is NOT called (allows assigning to built-ins).
- 5× per-tool zod-error tests (missing fields, wrong types, capability synonyms not allowed in permissions, etc.).
- 1× 400-with-`RequestError`-body test for `create_role` — surfaces `path`/`reference_path`/`message` in the structured envelope.
- 1× 404-on-unknown-role test for `update_role` / `delete_role` / `assign_role` / `unassign_role`.

Total ≈ 30-40 tests. Follow the Phase 10 pattern: every test uses `_setCaptureRequest`-replayed fixtures + the `_testConnection: "fake"` seam — no live HTTP from `npm test`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single `/api/roles` surface | Dual `/api/roles` (legacy) + `/api/authz/roles` (paginated, id-keyed) | Graylog 5.x → 6.x → 7.0 (gradual addition; both still present) | Phase 11 chooses legacy as the primary surface. |
| Inline `if (name === "Admin") refuse` | `assertRoleIsMutable(name)` + `BUILT_IN_ROLES` set + server-side backstop | This phase | Future-proof for new built-ins; matches success-criterion #4 exactly. |
| Standalone hashing per mutating tool | `computeCascadeHash`-forwarding wrappers (v3.0.0 pattern) | v3.0.0 Phase 3+ | One token discipline across all admin tools; byte-pinned. |

**Deprecated/outdated:**
- The `/api/authz/roles` endpoint's role-delete (returns 405 instead of structured 400 on read-only refusal) — Phase 11 explicitly does NOT use this surface.
- The `read_only` field in the `update_role` body — Graylog ignores it on update (the server preserves the existing value); the body still requires the field per `RoleResponse` jackson contract, but it's effectively a placeholder.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The 16-role built-in list captured on the live 7.0.6 UNESCO instance is representative; other Graylog 7.0.6 deployments may have a different set (especially enterprise builds). | Built-in Roles | LOW — Phase 11's static set is enhanced by the server-side 400 backstop for any role with `read_only:true` not in the static set. Refusal works correctly even with a drifted set. |
| A2 | The legacy `RoleService.load(name)` is case-sensitive (only `delete` is case-insensitive per JavaDoc). | Pitfall 7 | MEDIUM — if `load` is also case-insensitive, the failure mode disappears and the candidate-list error is dead code. Worst case is over-engineering, not incorrectness. |
| A3 | `assertRoleIsMutable` should NOT be called on `assign_role` / `unassign_role`. Assigning to built-in roles is normal. | Anti-Pattern AP4 | LOW — success-criterion #4 wording explicitly says "update/delete" — assign/unassign are not in scope for the client-side refusal. If a user disagrees in discuss-phase, the change is trivial (add the call to two more files). |
| A4 | `delete_role` should preview the cascade-dissociation via `GET /api/roles/{name}/members`. | Pitfall 6 / Mutating-Tool Shape | LOW — adds one round-trip per delete dry-run; saves the agent from accidentally dispossessing N users silently. Matches Phase 10's `cascades` precedent. |
| A5 | `update_role` should refuse a body-rename (the body's `name` must equal the path's `{rolename}`). | Pitfall 1 | MEDIUM — Graylog ACCEPTS a body-rename (it changes the role's name and all FKs); but the success-criterion wording doesn't mention rename semantics. Defer to discuss-phase. If allowed, a separate `rename_role` would be cleaner than overloading `update_role`. |
| A6 | The `last-admin` guard (Pitfall 5) is a Phase 11 invariant despite not appearing in REQUIREMENTS.md. | Pitfall 5 | LOW — defensive; the symmetric Phase 10 invariant is `last-own`. If discuss-phase decides to skip it, the change is a one-test removal. |
| A7 | Permission catalogue validation (Open Q1-b) is preferable to pass-through (Q1-a). | Permission Set Semantics | MEDIUM — false rejections could block legitimate enterprise-plugin permissions; an opt-out flag mitigates this. Defer to discuss-phase. |
| A8 | The `RoleResponse.name` field on the legacy surface lowercases internally for storage but returns mixed-case for display. | (not explicit, but underlies A2) | LOW — the source uses `roleService.loadAllLowercaseNameMap` for lookups but stores/returns the as-supplied case. Verified live (`"Admin"`, `"Cluster Configuration Reader"` returned with mixed case). |
| A9 | The Graylog 7.0.6 source's `MCP Server Access` built-in role on the live UNESCO instance is a Phase-7-via-plugin addition specific to this deployment, NOT a stock Graylog 7.0.6 built-in. | Built-in Roles | LOW — irrelevant for refusal logic; the static set captures whatever is live. Worth a footnote in the captured fixture. |
| A10 | `confirm` field re-uses `mutatingBase`'s existing field (not a new schema field per tool). | Schemas | LOW — Phase 10's `ShareEntitySchema:115-119` adds `confirm` explicitly. Verify whether `mutatingBase` already declares it or each schema redeclares; the answer is: each mutating schema redeclares (because Phase 10 added it explicitly). Phase 11 follows suit. |

**Confidence assessment for the LOW/MEDIUM items:** A1, A3, A4, A6, A9, A10 are LOW because they're defensive choices with low impact if wrong. A2, A5, A7 are MEDIUM and should be raised in discuss-phase before plan-time locking.

## Open Questions (for discuss-phase)

These are the decisions a user should lock before planning starts. Each has a recommended default — the planner can adopt them as Claude's-discretion outcomes unless the user disagrees.

### Q1: Permission-string validation strategy

- **What we know:** `RolesResource.create`/`update` accept any string as a permission; no server-side validation. `GET /api/system/permissions` returns the catalogue of legitimate `{resource}:{action}` pairs.
- **What's unclear:** Whether Phase 11's `create_role`/`update_role` should validate permissions against the catalogue (Q1-b) or pass through (Q1-a).
- **Tradeoff:** Q1-b protects against silent typos but may false-reject legitimate enterprise-plugin permissions; Q1-a is permissive but lets bad role definitions persist forever.
- **Recommendation:** **Q1-b with a `permitUnknownPermissions: false` opt-out flag.** Validates by default, accepts an explicit opt-out for the rare enterprise case.

### Q2: `assign_role` / `unassign_role` — single user or batch?

- **What we know:** The success-criterion #3 says "assign a user" (singular). The Graylog `/api/authz/roles/{id}/assignees` PUT accepts a `Set<String>` of usernames (batch); the `/api/roles/{name}/members/{username}` PUT accepts one user per call.
- **What's unclear:** Whether the tool should accept `username: string` (one) or `usernames: string[]` (batch).
- **Tradeoff:** Batch is more efficient for large assignments but complicates the dry-run preview (per-user diffs) and the cascade-impact preview. Single is simpler and matches the legacy endpoint shape.
- **Recommendation:** **Single user per call.** If the agent needs to assign 5 users, it calls 5 times. Matches the success-criterion wording. Defer "batch assign" to a v2-requirements item if needed.

### Q3: One `list_roles` tool, or split into `list_roles` + `get_role`?

- **What we know:** Success-criterion #1 says "list_roles returns all roles with their permission sets, AND an agent can read a single role's permissions." This could be one tool (with optional `roleName` filter projecting to a single role) or two tools.
- **What's unclear:** Tool-surface-budget preference.
- **Tradeoff:** Two tools is more discoverable (`get_role` is the natural name for "fetch one"). One tool is leaner. Phase 9 chose two tools (`get_entity_shares` + `list_grantees`).
- **Recommendation:** **Two tools — `list_roles` + `get_role`.** Tool count: 95 (single tool) vs 96 (two tools). Trivial difference; discoverability wins. `get_role` is also a natural place to surface members in the response (e.g., `{role, members}`) which differentiates it from `list_roles`.

### Q4: Should `list_roles` include the assignee count per role (one-extra-call-per-role)?

- **What we know:** `GET /api/roles` returns role metadata but no per-role member count. Each role's member count would require N additional `GET /api/roles/{name}/members` calls (or one paginated `GET /api/authz/roles` per-role drilldown).
- **What's unclear:** Whether the assignee count is valuable enough to justify N+1 round-trips at list time.
- **Tradeoff:** N+1 is bad; the agent rarely needs the count up-front; if they want it, they can call `get_role` per role.
- **Recommendation:** **Do NOT include member count in `list_roles`.** Add it to `get_role` (with the `members` array).

### Q5: `delete_role` cascade preview — full user records or just usernames?

- **What we know:** `GET /api/roles/{name}/members` returns full `UserSummary` per user (~25 fields including permissions, GRN permissions, preferences). The cascade-impact preview only needs `username` + `roles before/after`.
- **What's unclear:** Whether to project (cleaner) or pass-through (consistent with Phase 10's full-DTO surfacing).
- **Tradeoff:** Projection is cleaner UX; pass-through is information-rich but verbose for the agent.
- **Recommendation:** **Project to `[{username, roles_before, roles_after}]`** in the `cascades.users_dissociated` field. Phase 10 also projected (it surfaces `diff: {added, changed, unchanged, removed}` rather than the full `EntityShareResponse` re-emission).

### Q6: Static `BUILT_IN_ROLES` set vs query-on-every-call

- **What we know:** Live instance has 16 built-ins; the source has 2; enterprise instances may have more.
- **What's unclear:** Whether the client-side guard should be the static set (fast, 1-deploy out of date) or a per-call lookup (always current, 1 round-trip extra).
- **Tradeoff:** Static-set + server-backstop is the recommendation in this research. Per-call lookup is slower but always-current. If the planner picks per-call: in `build()`, call `GET /api/roles/{name}` first, check `read_only`. If `true`, refuse client-side. Cost: every mutating call has the pre-flight GET anyway (for `update_role`/`delete_role`), so the "per-call lookup" is FREE for those tools — only `create_role` would need an extra GET (against `/api/roles/{newName}` expecting 404). Recommendation: **use the server's `read_only` flag from the pre-flight GET response as the AUTHORITATIVE refusal**; use the static `BUILT_IN_ROLES` set as a FAST-PATH so the GET happens only when the static check passes. Belt + braces.

### Q7: Should role tools wait on system-job completion?

- **What we know:** Per the source, `roleService.save` and `roleService.delete` are synchronous (return after MongoDB write). No async system-job is queued.
- **What's unclear:** Nothing — this is a non-question. Mentioned here so the planner doesn't accidentally add `await_system_job` integration where it isn't needed.
- **Recommendation:** No system-job wait. Apply returns when the HTTP 200/204 returns.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All | ✓ | 22+ (package.json `engines: ">=18"`, actual runtime is 22+) | — |
| `@modelcontextprotocol/sdk` | MCP layer | ✓ | 1.18.0 (package.json) | — |
| `axios` | HTTP | ✓ | 1.12.2 | — |
| `zod` | Schemas | ✓ | 3.25.76 | — |
| `node:crypto` | sha-256 | ✓ | built-in | — |
| Live Graylog `test` connection (UNESCO) | live recon + opt-in smoke test only | ✓ | 7.0.6+711d207 (verified live 2026-05-21) | Skip live UAT — Phase 11 ships when offline tests are green |
| Phase 8 GRN helpers | `role-helpers.js` does not import GRN code (roles are not GRN-keyed for mutation) | ✓ | already shipped | — |
| Phase 8/9/10 mutating-handler stack | All 4 mutating tools | ✓ | already shipped | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None — all primitives shipped by prior phases.

## Validation Architecture

Per `.planning/config.json` `workflow.nyquist_validation: true`, this section is required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (Node.js built-in test runner) + `c8` for coverage |
| Config file | None — `npm test` glob is configured in `package.json` `scripts.test` |
| Quick run command | `node --test test/authz-roles.test.js` |
| Full suite command | `npm test` (currently 1156/1156 after Phase 10; expected ~1190-1210 after Phase 11) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ROLE-01 | `list_roles` returns all roles with permission sets | unit (fixture-replay) | `node --test test/authz-roles.test.js` → `list_roles full DTO surfaced` | ❌ Wave 0 |
| ROLE-01 | `get_role` returns one role's permissions (if split) | unit | same file → `get_role single-role response` | ❌ Wave 0 |
| ROLE-02 | `create_role` POSTs the canonical body | unit | same file → `create_role dryRun emits expected POST body` | ❌ Wave 0 |
| ROLE-02 | `create_role` returns confirmation token | unit | same file → `create_role dry-run envelope contains confirmationToken` | ❌ Wave 0 |
| ROLE-03 | `update_role` reads current state before PUT (PITFALL 1 ACCEPTANCE) | unit, mandatory | same file → `update_role pre-flight GET happens BEFORE PUT in dry-run` | ❌ Wave 0 |
| ROLE-03 | `update_role` body includes name+description+permissions+read_only | unit | same file → `update_role PUT body shape verified` | ❌ Wave 0 |
| ROLE-03 | `update_role` diff surfaced (added/removed/unchanged) | unit | same file → `update_role dry-run diff in cascades.diff` | ❌ Wave 0 |
| ROLE-04 | `delete_role` cascade-preview shows dissociated users | unit, mandatory | same file → `delete_role cascade-preview lists members` | ❌ Wave 0 |
| ROLE-05 | `assign_role` PUT body is `{}` not null | unit, mandatory | same file → `assign_role apply body equals {}` | ❌ Wave 0 |
| ROLE-05 | `assign_role` shows user's current roles in preview | unit | same file → `assign_role preview includes current_roles` | ❌ Wave 0 |
| ROLE-05 | `assign_role` idempotent on duplicate assignment | unit | same file → `assign_role to already-member surfaces existingMatches` | ❌ Wave 0 |
| ROLE-06 | `unassign_role` DELETE is issued | unit | same file → `unassign_role apply method=DELETE no body` | ❌ Wave 0 |
| ROLE-06 | `unassign_role` refuses on not-currently-assigned | unit | same file → `unassign_role of non-member refuses with reason=not_currently_assigned` | ❌ Wave 0 |
| ROLE-07 | Built-in roles refused for update | unit, mandatory | same file → `update_role refuses 16 built-ins client-side (parameterized loop)` | ❌ Wave 0 |
| ROLE-07 | Built-in roles refused for delete | unit, mandatory | same file → `delete_role refuses 16 built-ins client-side` | ❌ Wave 0 |
| ROLE-07 | Case-insensitive built-in refusal | unit | same file → `assertRoleIsMutable("admin") and ("ADMIN") both refuse` | ❌ Wave 0 |
| AUTHZ-01 | dryRun:true default on all 4 mutators | unit | same file → 4× `defaults dryRun:true` | ❌ Wave 0 |
| AUTHZ-01 | sha-256 confirmation token returned | unit | same file → 4× `dry-run emits confirmationToken matching computeRoleCascadeHash` | ❌ Wave 0 |
| AUTHZ-01 | Drift refusal (TOCTOU) for update_role | unit | same file → `update_role: current permissions differ between dry-run and apply → confirmation_mismatch` | ❌ Wave 0 |
| AUTHZ-01 | Drift refusal for delete_role | unit | same file → `delete_role: member list differs → confirmation_mismatch` | ❌ Wave 0 |
| AUTHZ-01 | Drift refusal for assign_role | unit | same file → `assign_role: user's roles differ → confirmation_mismatch` | ❌ Wave 0 |
| AUTHZ-01 | Drift refusal for unassign_role | unit | same file → `unassign_role: user's roles differ → confirmation_mismatch` | ❌ Wave 0 |
| Wiring | Tools registered | smoke (in `pipelines.test.js`) | `npm test` → `assertAllToolsRegistered passes after Plan 11-X (count=100 or 101)` | ❌ Wave 0 |
| Wiring | Tool descriptions ≤200 chars | lint | `node --test test/tool-description-audit.test.js` | ✓ exists, will auto-cover new tools |
| Wiring | Listed in `list_admin_tools` under authz | unit | `test/list-admin-tools.test.js` → `count=100 or 101` | ❌ Wave 0 (update 94 → N) |
| Live | dryRun:true probe + GET-only recon | smoke | `node scripts/capture-roles-fixtures.js` (one-shot, gated) | ❌ Wave 0 |
| Live | Full mutate-against-throwaway-role UAT | manual | gated UAT script | ❌ Wave 0 — deferred to manual UAT |

### Sampling Rate
- **Per task commit:** `node --test test/authz-roles.test.js` (the new file)
- **Per wave merge:** `npm test` (full offline suite)
- **Phase gate:** `npm test` green + a successful manual run of `scripts/capture-roles-fixtures.js` (one-shot live read-only) + a UAT script that creates a throwaway custom role, assigns a dedicated test user, updates+deletes the role, and verifies the lifecycle end-to-end against the live `test` connection. The UAT is deferred to a `/gsd:verify-work` HUMAN-UAT step (matching Phase 10's deferral).

### Wave 0 Gaps
- [ ] `test/authz-roles.test.js` — Wave 0 offline test file covering all rows above
- [ ] `test/fixtures/authz/roles/list-roles-7.0.6.json` — full GET /api/roles fixture
- [ ] `test/fixtures/authz/roles/get-role-admin-7.0.6.json` — single Admin role fixture
- [ ] `test/fixtures/authz/roles/get-role-members-reader-7.0.6.json` — Reader members fixture
- [ ] `test/fixtures/authz/roles/user-roles-admin-7.0.6.json` — admin user roles fixture
- [ ] `scripts/capture-roles-fixtures.js` — one-shot live read-only probe script
- [ ] Tool-count assertions in `test/list-admin-tools.test.js`, `test/pipelines.test.js`, `test/dashboards.test.js` updated 94 → 100 (or 101)
- [ ] `src/tools/meta/list-admin-tools.js` `DOMAIN_OVERRIDES` updated — add 6 (or 7) tool names → `authz`

Framework install: no install needed — `node:test` is built-in and `npm test` is already configured.

## Security Domain

> `security_enforcement` is not explicitly disabled in `.planning/config.json` — treat as enabled. Role management is a higher-blast-radius surface than entity sharing (it changes what users CAN DO across the entire instance, not just on one entity), so the security domain analysis is mandatory.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing connection-registry API token (HTTP Basic, token-as-username); no new auth. Surface upstream 403. |
| V3 Session Management | no | Stateless MCP — no sessions. |
| V4 Access Control | YES — critical | `dryRun: true` default + sha-256 confirmation token + drift refusal + client-side `BUILT_IN_ROLES` refusal + server-side `read_only` backstop. Writable-flag short-circuit on `conn.writable === false`. Last-admin guard (Pitfall 5) prevents instance lockout. |
| V5 Input Validation | YES — critical | `zod` schemas; permission catalogue validation (Open Q1-b) prevents silent permission-string typos; explicit zod refusals for built-in role names on mutate; `assertRoleIsMutable` is a defense-in-depth layer. |
| V6 Cryptography | yes | sha-256 via `computeRoleCascadeHash` forwarding into `node:crypto` `createHash`; canonical-form JSON byte-pinned (test/cascade-hash.test.js). Never hand-roll. |
| V7 Error Handling | yes | Structured `reason:` tags: `builtin_role_immutable`, `role_not_found`, `user_not_found`, `not_currently_assigned`, `would_leave_no_admin`, `role_validation_failed`, `confirmation_mismatch`, `connection_read_only`, `unknown_permission` (if Q1-b chosen). |
| V14 Configuration | yes | No new env vars or config-file entries. `_testConnection` magic arg is test-only — dropped by zod `.strict()` mode for production agents. |

### Known Threat Patterns for role-management tools

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Built-in role mutation (Admin/Reader/etc) | Tampering / Elevation of Privilege | Client-side `assertRoleIsMutable` refusal + server-side `read_only` backstop |
| TOCTOU drift on `update_role` permissions | Tampering | sha-256 token over `{tool, name, permissions, current_permissions_hash}`; recompute on apply; `requireConfirm` gate refuses mismatch |
| TOCTOU drift on `delete_role` cascade | Tampering | sha-256 token over `{tool, name, members_hash}`; concurrent assignment between dry-run and apply → token mismatch |
| TOCTOU drift on `assign_role` / `unassign_role` | Tampering | sha-256 token over `{tool, roleName, username, current_roles_hash}`; concurrent role change → token mismatch |
| **Instance lockout via removing the last Admin** | Denial of Service | Client-side `last-admin` guard in `unassign_role.build()` (Pitfall 5); refuses with `reason: "would_leave_no_admin"` |
| Silent permission typo accepted server-side | Tampering / Repudiation | Optional permission-catalogue validation (Open Q1-b); pinned to `GET /api/system/permissions` shape |
| Wildcard permission privilege escalation | Elevation of Privilege | Warning (not refusal) when `permissions.includes("*")` — legitimate but high-blast-radius; surface in preview |
| Cascade-dissociate surprise (deleting a role removes it from N users) | Tampering / DoS | `delete_role.build()` MUST surface `cascades.users_dissociated` with the full per-user before/after; agent must see what's about to happen |
| Apply against read-only connection | Tampering (attempted) | `conn.writable === false` short-circuit at `handler.js` step 3 — before `build()` runs |
| Production-instance role mutation via npm test | Tampering | All Wave 0 tests use `_testConnection: "fake"` + `_setCaptureRequest` seam — no live HTTP from offline suite. UAT confined to throwaway-role + dedicated test-user (per `08-TEST-STRATEGY.md`). |
| Token replay across role tools (create token used on update) | Tampering | `computeRoleCascadeHash` includes `tool` in canonical input — `create_role X` token cannot validate against `update_role X` apply |
| Token replay across role names (X token used on Y) | Tampering | Token includes `name` / `roleName` — cross-role replay fails |
| Token replay across users (assign user A token used for user B) | Tampering | Token includes `username` (assign/unassign) — cross-user replay fails |
| Role-name URL injection (`../` in role name) | Tampering / SSRF | `encodeURIComponent` neutralizes any path-segment abuse; zod schema rejects role names containing `/` |
| 405 from authz endpoint masking the real refusal | Repudiation (loss of auditability) | Phase 11 doesn't use the authz endpoint for delete — legacy `/api/roles` returns clear 400-with-text |

## Sources

### Primary (HIGH confidence)
- **Live Graylog 7.0.6+711d207 instance** (`http://<graylog-host>`, UNESCO production, queried 2026-05-21) — every endpoint shape and error-body shape in this document is verified live via read-only probes.
- `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog2/rest/resources/roles/RolesResource.java` — legacy role resource (310 lines; full source-cited)
- `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/security/authzroles/AuthzRolesResource.java` — new authz role resource (329 lines; full source-cited)
- `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog2/users/RoleServiceImpl.java` — `ADMIN_ROLENAME = "Admin"`, `READER_ROLENAME = "Reader"` constants; bootstrap behaviour
- `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog2/users/RoleService.java` — `RoleService.delete` JavaDoc: "Deletes the (case insensitively) named role"
- `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog2/rest/models/roles/responses/RoleResponse.java` — `name` / `description` / `permissions` / `read_only` DTO (Optional<String> on description; @NotBlank on name)
- `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/security/authzroles/AuthzRoleDTO.java` — authz role DTO (adds `id`)
- **Phase 8 RESEARCH.md / TEST-STRATEGY.md** — live-recon discipline, throwaway-entity pattern, `_provenance` block convention
- **Phase 9 PATTERNS.md / 09-01-SUMMARY** — `defineListHandler` vs plain-async-read pattern; `_testConnection` seam discipline; `DOMAIN_OVERRIDES` map convention
- **Phase 10 RESEARCH.md / 10-02-SUMMARY / share-entity.js** — `defineMutatingHandler` composition; `tagError` reason convention; 400-with-body parser; `requireConfirm` gate; PITFALL-1 acceptance gate pattern
- Codebase (`[VERIFIED]`): `src/tools/_shared/handler.js`, `src/tools/_shared/cascade-hash.js`, `src/tools/authz/*`, `src/tools/_shared/connection.js`, `src/graylog/client.js`, `src/tools.js`, `src/tools/meta/list-admin-tools.js`, `package.json`, `test/cascade-hash.test.js`, `test/authz-*.test.js`
- `CLAUDE.md` — project constraints (zero new deps, zod, dryRun default, per-domain extraction)

### Secondary (MEDIUM confidence)
- 7.2.0-SNAPSHOT source clone (`source-code/graylog2-server/`) — forward-compat reference; the role surface is identical 7.0.6 ↔ 7.2 (verified — `RolesResource.java` and `AuthzRolesResource.java` are git-stable across the minor span).
- The `MCP Server Access` built-in role observed on the live instance (not in stock Graylog 7.0.6 source) — assumed to be a UNESCO-deployment-specific plugin role; Phase 11 includes it in `BUILT_IN_ROLES` defensively.

### Tertiary (needs live verification before relying on)
- `RoleService.load` case-sensitivity for GET / PUT (verified case-INSENSITIVE only for `delete` per JavaDoc; A2 / Pitfall 7).
- Empty-permission-set acceptance (`POST /api/roles` body `{name:"x", permissions:[], ...}`) — not exercised live (would have created a real role).
- Exact server response on `PUT /api/roles/{name}/members/{username}` with body `"{}"` literal string vs `{}` object (verified source comment says "the content will be ignored" so both should work — body shape matters less than presence).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every primitive is already shipped and verified by Phase 8/9/10 unit tests; zero new dependencies
- Live API surface: HIGH — all endpoints, response shapes, and 4xx error bodies verified live against Graylog 7.0.6+711d207 (the milestone target)
- Built-in roles: HIGH — captured live (16 roles, not the source's 2)
- Mutating-tool composition: HIGH — direct precedent in `share-entity.js`; the 4 mutators are structural copies with tool-specific build-step variations
- Open Questions: MEDIUM — three decisions (Q1 permission validation, Q2 batch assign, Q3 list+get split) genuinely need user input; the other four have low-risk defaults

**Research date:** 2026-05-21
**Valid until:** 2026-06-21 (30 days — the v3.1.0 stack is stable; only enterprise-plugin built-in role additions could change underneath, and a Graylog upgrade in 30 days is not anticipated)
