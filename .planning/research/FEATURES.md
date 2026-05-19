# Feature Research

**Domain:** Graylog 7.0.6 authorization & entity-sharing — MCP tool surface for v3.1.0 "AuthZ & Sharing"
**Researched:** 2026-05-19
**Confidence:** HIGH (all endpoint/DTO shapes read directly from the Graylog source clone; the `7.0.6` git tag was diffed against `7.2.0-SNAPSHOT` to confirm parity)

> **This file was rewritten for the v3.1.0 milestone.** The previous content (the v3.0.0 admin-surface feature landscape) is preserved in git history and superseded — v3.0.0 is shipped. This document covers only the **new authz/sharing surface**.

> **Source-of-truth note.** Every claim below is cited to a Java REST resource or DTO under
> `source-code/graylog2-server/graylog2-server/src/main/java/`. The working tree is
> `7.2.0-SNAPSHOT`; the `7.0.6` git tag was checked out for `EntitySharesResource.java` and the
> endpoint paths/methods are byte-identical. The only divergence found is **cosmetic**: 7.0.6 uses
> Swagger v2 annotations (`@ApiParam`, `io.swagger.annotations`) while 7.2 uses Swagger v3
> (`@Parameter`, `io.swagger.v3.oas`). This does not affect HTTP shapes. Real behavioural
> divergence (none found in this surface) would be tagged **[7.0.6 vs 7.2]**.

---

## How Graylog AuthZ Works (the concrete model)

Graylog has **two parallel authorization systems** and v3.1.0 touches both:

1. **Entity grants / sharing** — a per-entity ACL. A *grantee* (a user, a team, or "everyone")
   is given a *capability* (`view` / `manage` / `own`) over one *entity* (a stream, dashboard,
   saved search…). Stored as `grant` documents; addressed by **GRN**. This is what the Graylog
   web UI's "Share" dialog drives. **This is the milestone's primary deliverable.**
2. **Roles** — named bundles of wildcard permission strings (`streams:read`, `dashboards:edit`,
   `*` …) assigned to users. Coarse-grained, global, not entity-scoped. Two built-in roles
   (`Admin`, `Reader`) plus user-defined roles.

The two interact: a user with the `Admin` role (permission `*`) implicitly owns every entity and
never needs a grant; a user with only `Reader` needs an explicit `view` grant on a stream to see
that stream's messages. **Grants are the fine-grained layer; roles are the coarse layer.**

### The prepare-vs-commit flow (critical design point)

Sharing is a **two-call protocol** by design — and it maps almost perfectly onto this project's
existing `dryRun` discipline:

- `POST /api/authz/shares/entities/{entityGRN}/prepare` — **dry run.** Changes nothing
  (`@NoAuditEvent("This does not change any data")`). Returns the full `EntityShareResponse`
  including `available_grantees`, `available_capabilities`, `active_shares` (current grants),
  and — if the request body included grantees — `missing_permissions_on_dependencies` and a
  `validation_result`.
- `POST /api/authz/shares/entities/{entityGRN}` — **commit.** Same `EntityShareRequest` body,
  actually writes the grants. Returns `200` with `EntityShareResponse` on success, or `400`
  with the same body (`validation_result.failed == true`) on validation failure.

Cite: `org/graylog/security/rest/EntitySharesResource.java:114-171`.

**Design implication for the MCP:** `share_entity` with `dryRun: true` → call `/prepare`;
`dryRun: false` → call the commit endpoint. The prepare response *is* the dry-run preview, and
hashing it produces the confirmation token. No separate "fetch current state" round-trip is
needed for the token — `/prepare` already returns `active_shares`. This is a near-exact fit for
the v3.0.0 pattern; **do not invent a custom diff layer.**

---

## Endpoint Reference (exact, cited)

All paths are under the server's API root (`/api`). Auth: existing HTTP-Basic token-as-username.

### Entity sharing — `org/graylog/security/rest/EntitySharesResource.java`

| Method | Path | Purpose | Audited? | Source line |
|--------|------|---------|----------|-------------|
| `POST` | `/api/authz/shares/entities/{entityGRN}/prepare` | **Dry-run** a share; returns current + proposed state | No (`@NoAuditEvent`) | `:114` |
| `POST` | `/api/authz/shares/entities/{entityGRN}` | **Commit** create/update grants for the entity | Yes (inside service) | `:156` |
| `POST` | `/api/authz/shares/entities/prepare` | Prepare *without* a specific entity (collection / dependency-only check) | No | `:139` |
| `GET`  | `/api/authz/shares/user/{userId}` | List entities shared *with* a given user (paginated) | n/a | `:92` |

> **There is no `PUT` and no `DELETE`.** The milestone brief and `PROJECT.md` say
> `PUT /api/authz/shares/{grn}` — that is **inaccurate**. The verb is `POST` and the path segment
> is `entities/`. Both `prepare` and commit are `POST`. **Revoking a grant is done by re-POSTing
> the full desired `selected_grantee_capabilities` map with the unwanted grantee omitted** — the
> commit endpoint replaces the grant set, it is not additive. There is no per-grant delete route.

> **GRN must be URL-path-encoded.** `entityGRN` is a `@PathParam` and a GRN contains literal
> `:` characters (`grn::::stream:000...`). Colons in a path segment must be percent-encoded
> (`%3A`) or the JAX-RS router can mis-split the path. This is a known footgun — flag for the
> planner.

### Reading current grants for an entity

There is **no dedicated GET-grants-for-entity endpoint.** The supported way to read an entity's
current ACL is `POST .../prepare` with an **empty body** (`{}` / `EntityShareRequest.EMPTY`) and
read `active_shares` from the response. Cite: `EntitySharesResource.java:114-128`, comment lines
`123-126` ("First request would be without 'grantees'…"). This is by design — the UI's Share
dialog opens by firing exactly this empty prepare call.

### Roles — `org/graylog2/rest/resources/roles/RolesResource.java`

| Method | Path | Purpose | Permission gate | Source line |
|--------|------|---------|-----------------|-------------|
| `GET`  | `/api/roles` | List all roles | `roles:read` (per-role filter) | `:93` |
| `GET`  | `/api/roles/{rolename}` | Read one role + its permissions | `roles:read` | `:107` |
| `POST` | `/api/roles` | Create a role | `roles:create` | `:117` |
| `PUT`  | `/api/roles/{rolename}` | Update a role (rejected if `read_only`) | `roles:edit` | `:148` |
| `DELETE` | `/api/roles/{rolename}` | Delete a role (rejected if `read_only`) | `roles:delete` | `:176` |
| `GET`  | `/api/roles/{rolename}/members` | List users in a role | `users:list` + `roles:read` | `:194` |
| `PUT`  | `/api/roles/{rolename}/members/{username}` | **Assign** user → role | `users:edit` + `roles:assign` | `:250` |
| `DELETE` | `/api/roles/{rolename}/members/{username}` | Unassign user → role | `users:edit` + `roles:assign` | `:281` |

> `PUT .../members/{username}` requires a non-empty body — the server explicitly documents
> *"Placeholder because PUT requests should have a body. Set to `{}`, the content will be
> ignored."* (`RolesResource.java:256`). Send `{}`. Returns `204 No Content`.

### Grantee resolution — `org/graylog2/rest/resources/users/UsersResource.java`

| Method | Path | Purpose | Notes |
|--------|------|---------|-------|
| `GET` | `/api/users` | List all users | `@Deprecated` in 7.x but still works (`:281`) |
| `GET` | `/api/users/paginated` | Paginated user list (`UserOverviewDTO`) | Preferred; supports `query=` search (`:318`) |
| `GET` | `/api/users/{username}` | One user by **username** — response carries `id` | `:200` |
| `GET` | `/api/users/id/{userId}` | One user by **id** | `:225` |

---

## Request / Response DTO Shapes (exact, cited)

### `EntityShareRequest` — the share request body
`org/graylog/security/shares/EntityShareRequest.java:40-72`

```json
{
  "selected_grantee_capabilities": {
    "grn::::user:54e3deadbeefdeadbeef0001": "view"
  },
  "selected_collections": []
}
```

- `selected_grantee_capabilities` — **object: GRN string → capability string.** This is the
  whole payload that matters. The map *replaces* the grant set (omit a grantee to revoke).
- `selected_collections` — optional, list of collection GRNs; leave `[]` for single-entity
  shares. Not needed for streams/dashboards/searches.
- Both fields are nullable; `EntityShareRequest.EMPTY` is `{}` and is what `/prepare` takes to
  *read* current state.

### `EntityShareResponse` — returned by both `/prepare` and commit
`org/graylog/security/shares/EntityShareResponse.java:38-147`

```json
{
  "entity": "grn::::stream:000000000001",
  "sharing_user": "grn::::user:adminUserId",
  "available_grantees": [
    { "id": "grn::::user:54e3...0001",       "type": "user",   "title": "alice" },
    { "id": "grn::::team:devops",            "type": "team",   "title": "DevOps" },
    { "id": "grn::::builtin-team:everyone",  "type": "global", "title": "Everyone" }
  ],
  "available_capabilities": [
    { "id": "view",   "title": "Viewer" },
    { "id": "manage", "title": "Manager" },
    { "id": "own",    "title": "Owner" }
  ],
  "active_shares": [
    { "grant": "grantId123", "grantee": "grn::::user:54e3...0001", "capability": "view" }
  ],
  "selected_grantee_capabilities": { "grn::::user:54e3...0001": "view" },
  "missing_permissions_on_dependencies": {},
  "synced_entities": [],
  "validation_result": { "errors": {}, "failed": false }
}
```

Field meaning:
- `available_grantees` — every user/team you may share with, each a `Grantee`
  (`{id: GRN, type, title}`). **This is the grantee-resolution table** — see GRN section.
- `available_capabilities` — the capability enum, with human titles.
- `active_shares` — **the current ACL.** Each `ActiveShare` = `{grant, grantee, capability}`.
  This is the "read current grants" answer.
- `missing_permissions_on_dependencies` — map of GRN → entities the grantee can't see (e.g.
  granting dashboard access but the grantee lacks the underlying stream). Surface to the agent;
  do not auto-resolve.
- `validation_result` — `{failed: bool, errors: {field: [msgs]}}` (`org/graylog2/plugin/rest/ValidationResult`).
  On a failed commit the endpoint returns HTTP `400` with this same body.

### `Grantee` — `org/graylog/security/shares/Grantee.java:24-52`

```json
{ "id": "grn::::user:54e3deadbeef0001", "type": "user", "title": "alice" }
```

`type` is one of `user`, `team`, `global` (constants `GRANTEE_TYPE_USER/TEAM/GLOBAL`,
lines `27-29`). The global "Everyone" grantee is the fixed GRN
`grn::::builtin-team:everyone` (`GRNRegistry.GLOBAL_USER_GRN`, `GRNRegistry.java:41`).

### `Capability` enum — `org/graylog/security/Capability.java:23-44`

| JSON value | Java | Priority | Grants |
|-----------|------|----------|--------|
| `view`   | `VIEW`   | 1 | Read the entity and its data (read stream messages / open dashboard / run saved search). No edits. |
| `manage` | `MANAGE` | 2 | `view` + edit the entity's configuration (stream rules, dashboard widgets…). Cannot delete or re-share. |
| `own`    | `OWN`    | 3 | `manage` + delete the entity and manage *its* shares (re-grant to others). The creator is implicitly `own`. |

Exactly three values. JSON is the lowercase form (`@JsonProperty("view"/"manage"/"own")`,
`Capability.toId()` = `name().toLowerCase()`). No `read`/`write`/`admin` aliases exist.

### `RoleResponse` — role create/read/update body
`org/graylog2/rest/models/roles/responses/RoleResponse.java:31-51`

```json
{
  "name": "stream-operators",
  "description": "Can manage app streams",
  "permissions": ["streams:read", "streams:edit", "dashboards:read"],
  "read_only": false
}
```

`GET /api/roles` returns `{ "roles": [ RoleResponse, ... ] }` (`RolesResponse`).
`POST /api/roles` echoes the created `RoleResponse` with `201` + `Location` header.

---

## GRN (Graylog Resource Name) — exact grammar

`org/graylog/grn/GRN.java:30-92`. A GRN is a **6-token, colon-joined** string:

```
grn:<cluster>:<tenant>:<scope>:<type>:<entity>
```

The parser (`GRN.parse`, line `56`) **lowercases the whole string**, splits on `:`, and requires
**exactly 6 tokens** with token 0 == `grn`. `cluster`, `tenant`, `scope` are normally empty for
self-hosted single-cluster Graylog — yielding the canonical **four-empty-colon** form. `type` and
`entity` are the parts that vary.

### Concrete GRN examples

| Entity | GRN | `entity` segment is… |
|--------|-----|----------------------|
| Stream | `grn::::stream:000000000001` | the stream's MongoDB `_id` (or fixed id for default streams) |
| Dashboard | `grn::::dashboard:5e2afc...id` | the dashboard's view `_id` |
| Saved search | `grn::::search:6a1b2c...id` | the search/view `_id` |
| User (grantee) | `grn::::user:54e3deadbeef0001` | the user's MongoDB `_id` — **not the username** |
| Team (grantee) | `grn::::team:devops` | the team id (Enterprise only) |
| "Everyone" (grantee) | `grn::::builtin-team:everyone` | fixed literal |
| Role | `grn::::role:roleId` | role id |

Registered GRN types (`org/graylog/grn/GRNTypes.java:22-35`): `stream`, `dashboard`, `search`,
`event_definition`, `notification`, `output`, `user`, `role`, `builtin-team`, `grant`,
`search_filter`, `favorite`, `last_opened`, `report`. **Note the saved-search type is `search`,
the notification type is `notification` (not `event_notification`).**

> **Grantee GRN gotcha — table stakes.** A user grantee GRN uses the user's **id**, not the
> username (`GRNRegistry.ofUser` → `newGRN(GRNTypes.USER, user.getId())`, `GRNRegistry.java:126`).
> The MCP's `share_entity` will almost certainly be called with a *username* ("share to alice").
> The tool MUST resolve username → id first (via `GET /api/users/{username}` → read `id`, then
> build `grn::::user:<id>`), **or** read `available_grantees` from `/prepare` and match on
> `title`. The prepare-response approach is more robust (one fewer endpoint, exact match) and is
> recommended. This resolution step is non-optional table stakes.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Must-haves for "grant a user access to a stream". Missing any = the milestone goal is unmet.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `share_entity` — grant a user a capability on a stream | The literal milestone goal | MEDIUM | `dryRun:true` → `POST .../{grn}/prepare`; `dryRun:false` → `POST .../{grn}`. Body = `selected_grantee_capabilities` map. |
| GRN builder/parser util | Every sharing call needs a well-formed, lowercased, 6-token, path-encoded GRN | LOW | `grn::::<type>:<id>`. Centralize so dashboards/searches reuse it. Percent-encode the `:` chars in the URL path. |
| Username → user-GRN resolution | Agents pass usernames; the API needs `grn::::user:<id>` | MEDIUM | Prefer matching `available_grantees[].title` from the prepare response; fall back to `GET /api/users/{username}`. |
| Read current grants for an entity | Sharing safely needs the before-state; also feeds the confirmation token | LOW | `POST .../{grn}/prepare` with empty body → read `active_shares`. No dedicated GET. |
| Capability validation (`view`/`manage`/`own` only) | A wrong value = `400` from the server | LOW | zod enum of exactly these three lowercase strings. |
| Surface `validation_result` + `missing_permissions_on_dependencies` | A commit can return `400` with a body the agent must read; a grantee may lack dependency access | MEDIUM | Treat `400`-with-body as a structured result, not a raw error. Echo missing-deps to the agent. |
| Revoke = re-POST without the grantee | There is no DELETE-grant route | LOW | Commit replaces the grant map. "Unshare alice" = prepare current `active_shares`, drop alice, commit the remainder. Make this explicit in tool design. |
| Drift refusal on commit | Higher blast radius than v3.0.0 — changes who reads prod logs | MEDIUM | Hash the `/prepare` `active_shares`; refuse commit if the live state changed since the token was issued. Reuse the v3.0.0 cascade-hash pattern. |

### Differentiators (Competitive Advantage)

In-scope-but-secondary. Valuable, not strictly required for the headline use case.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Generalize `share_entity` to dashboards & saved searches | One tool covers 3 entity types via the GRN abstraction; the API path is identical | LOW | Only the GRN `type` token changes (`stream`/`dashboard`/`search`). Already a `PROJECT.md` Active requirement. |
| `create_role` / `update_role` / `delete_role` | Lets an agent build a reusable permission bundle, not just per-entity grants | MEDIUM | `POST/PUT/DELETE /api/roles`. `read_only` roles reject mutation — guard client-side. |
| `assign_role` / `unassign_role` | "Make alice a stream operator" in one call | LOW | `PUT/DELETE /api/roles/{role}/members/{username}`. Send `{}` body on PUT. Username-keyed (no GRN needed here). |
| `list_grantees` helper | Resolves and lists shareable users/teams for the agent | LOW | Derive from `available_grantees` in a prepare response, or `GET /api/users/paginated`. |
| Team-based grants | Share to a whole team at once | LOW (if Enterprise) / N/A | `grn::::team:<id>`. Teams are an **Enterprise** feature — the 7.0.6 OSS test instance likely has none. Build the GRN path generically but do not depend on teams existing. |
| Bulk / multi-grantee share | Grant several users in one call | LOW | `selected_grantee_capabilities` is already a *map* — multi-grantee is free. Expose it as an array input. |
| Share-on-create | Set initial grants when a blueprint creates a stream | MEDIUM | The commit endpoint works on any existing entity GRN; chain it after create. (`POST entities/{grn}` also referenced by issue #22281 "Add entity share on create".) |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| User account CRUD (`create_user`/`delete_user`) | "Share with alice" tempts auto-creating alice | `PROJECT.md` Out-of-Scope is explicit; account lifecycle is a separate high-risk surface (passwords, auth backends) | Require the user to pre-exist; a `404` from grantee resolution is a clean, honest error. |
| API-token minting (`POST /api/users/{id}/tokens`) | Agents want to provision automation creds | Explicitly out of scope; minting long-lived secrets from an agent is a security anti-pattern | None — out of scope, full stop. |
| Direct per-user wildcard-permission editing (`PUT /api/users/{username}/permissions`) | Looks like a quick "give alice streams:read" | Bypasses both the grant model *and* roles; produces un-auditable, un-discoverable permission sprawl | Use entity grants (fine-grained) or roles (coarse) — both are first-class and discoverable. |
| A custom grant-diff / patch layer | Commit "replaces" the map, which feels unsafe | Re-invents what `/prepare` already gives you (`active_shares` + `validation_result`) | Use `/prepare` as the dry-run; hash its `active_shares` for the token; reuse v3.0.0 drift refusal. |
| Per-grant `DELETE` tool | REST instinct says "delete the grant by id" | No such endpoint exists; the `grant` id in `active_shares` is not addressable for deletion | Revoke = re-POST the commit body without the grantee. |
| Multi-version GRN handling | The source clone is 7.2 | `PROJECT.md` pins 7.0.6 single-target; GRN grammar + share endpoints are identical 7.0.6↔7.2 (verified by git-tag diff) | Target 7.0.6 behaviour; no version branching. |
| Lookup tables / content packs / sidecars sharing | They also have GRNs/grants | Out of scope per `PROJECT.md`; widens the GRN type matrix unnecessarily | Restrict the GRN-type enum to `stream`, `dashboard`, `search` this milestone. |

## Feature Dependencies

```
share_entity (stream)
    └──requires──> GRN builder/parser util
    │                  └──requires──> registered GRN type set {stream,dashboard,search,user}
    └──requires──> username → user-GRN resolution
    │                  └──requires──> GET /api/users/{username}  OR  available_grantees from /prepare
    └──requires──> capability enum validation {view,manage,own}
    └──requires──> read-current-grants  (POST .../{grn}/prepare, empty body)
                       └──enables──> drift refusal + confirmation token

share_entity (dashboard) ──reuses──> share_entity (stream)   [only GRN type token differs]
share_entity (search)    ──reuses──> share_entity (stream)

assign_role (user↔role) ──independent of──> share_entity     [roles ≠ grants]
    └──requires──> role exists (GET /api/roles/{name})
    └──requires──> user exists (GET /api/users/{username})

create_role ──enhances──> assign_role     [supplies a custom role to assign]
list_grantees ──enhances──> share_entity  [resolves the GRN the agent needs]
```

### Dependency Notes

- **`share_entity` requires the GRN util:** the commit endpoint is `POST .../entities/{entityGRN}`
  — a malformed / non-lowercased / non-6-token / non-encoded GRN fails parse server-side. The
  util is the single riskiest shared primitive; build and unit-test it first.
- **`share_entity` requires grantee resolution:** the API takes a *user-id* GRN, agents speak
  *usernames*. Recommended path: call `/prepare` once with an empty body, match the username
  against `available_grantees[].title`, reuse that exact GRN. This avoids a username→id endpoint
  round-trip and guarantees the GRN is one the server already accepts.
- **Reading grants enables the safety story:** `/prepare` is simultaneously the dry-run preview,
  the current-state read, and the input to the confirmation hash. One endpoint, three jobs — this
  is why the prepare/commit split is a near-perfect fit for the existing `dryRun` discipline.
- **Roles are independent of grants:** `assign_role` and `share_entity` share no code path.
  Roles are username-keyed and global; grants are GRN-keyed and per-entity. Treat them as two
  separate tool families under `src/tools/authz/`.
- **`create_role` enhances `assign_role`:** assignment can target built-in roles (`Admin`,
  `Reader`) with no `create_role` at all; `create_role` only matters when the agent needs a
  custom permission bundle.

## Built-in Roles & Editability

`org/graylog2/users/RoleServiceImpl.java:63-110`:

- Two built-in roles: **`Admin`** (permissions `["*"]` — everything) and **`Reader`**
  (`permissions.readerBasePermissions()` — read-only baseline).
- Both are created/repaired at startup with `read_only = true` and `setReadOnly(true)`.
- **Read-only roles cannot be updated or deleted** — `RolesResource.update` (`:158`) and
  `delete` (`:184`) both throw `400 BadRequest` ("Cannot update/delete read only role"). The MCP
  should pre-check `read_only` and refuse client-side with a clear message rather than relaying a
  raw `400`.
- User-defined roles are fully editable (`PUT`/`DELETE`).

**Roles vs grants relationship:** a role is a set of *wildcard permission strings*
(`streams:read`, `dashboards:edit`, `*`). A grant is a *capability on a single GRN*. A user's
effective access = (permissions from all their roles) ∪ (capabilities from all grants targeting
them, their teams, or "everyone"). The `Admin` role's `*` permission subsumes every grant; a
`Reader` user sees only what explicit `view` grants allow. The MCP should describe this in tool
docs so the agent picks the right layer: **role for "this person does job X across the system",
grant for "this person can see this one stream".**

## 7.0.6 vs 7.2 Divergence (verified)

| Area | 7.0.6 | 7.2-SNAPSHOT | Impact on MCP |
|------|-------|--------------|---------------|
| `EntitySharesResource` paths/methods | identical | identical | none |
| Swagger annotations | `@ApiParam`, `io.swagger.annotations` | `@Parameter`, `io.swagger.v3.oas` | none — annotations, not wire format |
| `EntityShareRequest` / `EntityShareResponse` / `Capability` / `Grantee` | unchanged | unchanged | none |
| `RolesResource` paths/methods | identical | identical | none |
| GRN grammar (`GRN.java`) | unchanged | unchanged | none |
| `entities/prepare` generic-prepare endpoint | present | present (refined by issue #22520) | not needed this milestone; ignore |

**Conclusion:** the authz/sharing surface is stable across the 7.0.6↔7.2 gap. No version
branching is required. Build against 7.0.6 wire shapes with full confidence.

## MVP Recommendation

Ship in dependency order:

1. **GRN util** — builder + parser + URL-path encoder, with the `{stream,dashboard,search,user}`
   type set. Unit-tested first; everything depends on it.
2. **`get_entity_shares`** (read current grants) — `POST .../{grn}/prepare` empty-body. Smallest,
   safest, no mutation, and produces the data every other tool's dry-run needs.
3. **`share_entity`** for streams — the headline tool. `dryRun:true`→prepare, `dryRun:false`→commit,
   confirmation token over `active_shares`, drift refusal. Grantee resolution via `available_grantees`.
4. **Generalize `share_entity`** to dashboards + saved searches — near-free once the GRN type
   token is parameterized.
5. **Role tools** — `list_roles`, `create_role`, `assign_role` / `unassign_role`. Independent
   track; can be built in parallel with 2–4.

Defer: team-only convenience tooling (Enterprise-dependent), share-on-create blueprint chaining.

## Sources

All HIGH confidence — read directly from the Graylog server source clone:

- `source-code/graylog2-server/.../org/graylog/security/rest/EntitySharesResource.java` (7.2 working tree + `git show 7.0.6:` diff)
- `source-code/graylog2-server/.../org/graylog/security/shares/EntityShareRequest.java`
- `source-code/graylog2-server/.../org/graylog/security/shares/EntityShareResponse.java`
- `source-code/graylog2-server/.../org/graylog/security/shares/Grantee.java`
- `source-code/graylog2-server/.../org/graylog/security/Capability.java`
- `source-code/graylog2-server/.../org/graylog/grn/GRN.java`
- `source-code/graylog2-server/.../org/graylog/grn/GRNTypes.java`
- `source-code/graylog2-server/.../org/graylog/grn/GRNRegistry.java`
- `source-code/graylog2-server/.../org/graylog2/rest/resources/roles/RolesResource.java`
- `source-code/graylog2-server/.../org/graylog2/rest/models/roles/responses/RoleResponse.java`
- `source-code/graylog2-server/.../org/graylog2/rest/resources/users/UsersResource.java`
- `source-code/graylog2-server/.../org/graylog2/users/RoleServiceImpl.java`
- `source-code/graylog2-server/.../org/graylog/security/shares/DefaultGranteeService.java`
- Git history of `EntitySharesResource.java` (confirms endpoint paths predate 7.0.6; recent commits are Swagger/jakarta cosmetic only)
- `.planning/PROJECT.md` (scope boundaries — Out of Scope section)
