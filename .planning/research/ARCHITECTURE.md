# Architecture Research

**Domain:** Authz / entity-sharing tool surface for the Graylog MCP server (v3.1.0 milestone)
**Researched:** 2026-05-19
**Confidence:** HIGH — endpoint shapes and replace-vs-merge semantics confirmed by reading the Graylog server Java source (`EntitySharesResource.java`, `EntitySharesService.java`); integration points confirmed against real files in `src/tools/`.

> Scope note: this is a SUBSEQUENT milestone — purely additive on top of v3.0.0's
> 91-tool admin surface. Everything below describes how the NEW authz tools slot
> into the EXISTING architecture (`defineMutatingHandler`, `src/dispatch.js`,
> `src/tools/<domain>/`, `src/tools/_shared/`). The existing architecture is not
> re-researched — the v3.0.0 architecture doc covered it.

## Standard Architecture

### System Overview — where the authz domain plugs in

```
┌─────────────────────────────────────────────────────────────────┐
│  src/index.js  — stdio MCP server, ListTools + CallTool wiring    │
├─────────────────────────────────────────────────────────────────┤
│  src/tools.js  — flat array of tool definitions (+authz entries)  │
│  src/dispatch.js — Map<name, handler>; register() / dispatch()    │
├─────────────────────────────────────────────────────────────────┤
│  src/tools/_register.js — side-effect barrel                      │
│     import "./authz/index.js";   ◄── NEW one-line addition        │
├─────────────────────────────────────────────────────────────────┤
│                  src/tools/authz/   ◄── NEW DOMAIN MODULE         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐              │
│  │ index.js     │ │ schemas.js   │ │ get-entity-  │              │
│  │ (register    │ │ (zod inputs) │ │  shares.js   │              │
│  │  barrel)     │ │              │ │ (read path)  │              │
│  └──────────────┘ └──────────────┘ └──────────────┘              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐              │
│  │ grn-helpers  │ │ share-entity │ │ create-role  │              │
│  │   .js (pure) │ │   .js        │ │ assign-role  │              │
│  └──────────────┘ └──────────────┘ └──────────────┘              │
├─────────────────────────────────────────────────────────────────┤
│  src/tools/_shared/   (reused unchanged; +1 thin wrapper only)    │
│  handler.js · dry-run.js · cascade-hash.js · connection.js ...    │
│     cascade-hash.js  ◄── +computeShareGrantHash thin wrapper      │
├─────────────────────────────────────────────────────────────────┤
│  src/graylog/client.js — makeClient(conn).request() — UNCHANGED   │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼  POST /api/authz/shares/entities/{grn}/prepare   (preview)
        ▼  POST /api/authz/shares/entities/{grn}           (apply)
        ▼  GET  /api/authz/shares/user/{userId}            (inverse read)
   Graylog 7.0.6  EntitySharesResource / RolesResource
```

### Component Responsibilities

| Component | Responsibility | Implementation pattern (file precedent) |
|-----------|----------------|------------------------------------------|
| `src/tools/authz/index.js` | Side-effect `register()` barrel for the domain | Mirrors `src/tools/pipelines/index.js` — one `import` + one `register()` per tool |
| `src/tools/authz/schemas.js` | zod input schemas for every authz tool | Mirrors `src/tools/pipelines/schemas.js`; mutating schemas extend `mutatingBase` (dryRun/idempotencyKey) |
| `src/tools/authz/grn-helpers.js` | Parse / build / validate Graylog Resource Names | Pure functions — no I/O, trivially unit-testable |
| `src/tools/authz/get-entity-shares.js` | Read path — current grants on an entity | Plain async handler — copy `src/tools/pipelines/get-pipeline.js` |
| `src/tools/authz/share-entity.js` | Grant/revoke a user's capability on an entity | `defineMutatingHandler` with async `build()` doing prepare-merge |
| `src/tools/authz/create-role.js` | Create a Graylog role | `defineMutatingHandler`, `POST /api/roles` |
| `src/tools/authz/assign-role.js` | Add a user to a role | `defineMutatingHandler`, `PUT /api/roles/{rolename}/members/{username}` |

## Recommended Project Structure

```
src/tools/authz/                      # NEW domain module (mirror of pipelines/)
├── index.js                          # register barrel — imported by _register.js
├── schemas.js                        # zod schemas for all authz tools
├── grn-helpers.js                    # GRN parse/build/validate (see placement note)
├── get-entity-shares.js              # READ:  current grants for an entity
├── share-entity.js                   # WRITE: prepare-merge-apply a capability grant
├── create-role.js                    # WRITE: POST /api/roles
└── assign-role.js                    # WRITE: PUT  /api/roles/{rolename}/members/{username}

src/tools/_shared/
└── cascade-hash.js                   # MODIFIED — add computeShareGrantHash wrapper
```

### Structure Rationale

- **`src/tools/authz/`** — one new per-domain folder, identical pattern to the 9
  existing admin domains. The CLAUDE.md code-organization constraint ("new admin
  tools extract into `src/tools/<domain>/`, not inline in `src/index.js`") is
  satisfied by construction.
- **GRN helper placement — keep it in `src/tools/authz/grn-helpers.js`, NOT `_shared/`.**
  Decision and rationale: `_shared/` is reserved for primitives consumed across
  MULTIPLE domains (`cascade-hash.js` is used by index-sets/streams/pipelines/events;
  `handler.js` by all). For v3.1.0, GRN is an authz-only concern — `share_entity`
  and `get_entity_shares` are its only callers. Co-locating it in `authz/` keeps the
  shared surface minimal and the domain self-contained. **Promote to `_shared/grn.js`
  later if a future milestone needs it elsewhere** (e.g. content-pack tooling or
  blueprints) — that promotion has direct precedent: `cascade-hash.js` itself started
  life as `src/tools/index-sets/c1-hash.js` and was promoted to `_shared/` in Phase 2
  once a second domain needed it (the file's own header documents this). Premature
  promotion adds a cross-cutting file with one consumer; the move is cheap and
  mechanical when a second consumer actually appears.

## Architectural Patterns

### Pattern 1: GRN abstraction (the generalization seam)

**What:** A Graylog Resource Name uniquely identifies any shareable entity. The
authz API is keyed entirely on GRNs, so a single helper makes `share_entity` work
for streams today and dashboards/saved-searches tomorrow with zero new tool code.

**GRN wire format (confirmed from `org/graylog/grn/GRN.java`):**

```
grn:<cluster>:<tenant>:<scope>:<type>:<entity>
```

- Exactly six colon-separated tokens; the literal `grn` prefix is mandatory.
- `GRN.parse()` lower-cases the whole string and requires exactly 6 tokens, else
  `IllegalArgumentException` ("not a valid GRN string").
- `cluster`, `tenant`, `scope` are empty on single-cluster Graylog. A stream GRN is
  commonly `grn:::::stream:000000000001` (the source javadoc also shows the
  hand-written form `grn::::stream:000000000001` — both round-trip; emit the
  canonical 6-token form with empty middle tokens).
- Registered entity types relevant to this milestone (from `org/graylog/grn/GRNTypes.java`):
  `stream`, `dashboard`, `search` (saved searches), `event_definition`,
  `notification`, `user`, `role`, `output`, `report`.

**Helper API to build (`src/tools/authz/grn-helpers.js`):**

```javascript
const GRN_TYPES = new Set([
  "stream", "dashboard", "search", "event_definition",
  "notification", "user", "role", "output", "report",
]);

// ("stream","000000000001") -> "grn:::::stream:000000000001"
export function buildGrn(type, id) { /* validate type ∈ GRN_TYPES, id non-empty */ }

// "grn:::::stream:abc" -> { cluster, tenant, scope, type, entity }; throws on malformed
export function parseGrn(grn) { /* split ":", require 6 tokens + "grn" prefix */ }

// true if value is a syntactically valid GRN of an allowed type
export function isGrn(value) { /* ... */ }
```

**When to use:** `share_entity`'s zod schema should accept EITHER a raw `entityGrn`
string OR a `(entityType, entityId)` pair, and normalize to a GRN inside `build()`.
The `(type, id)` pair is friendlier to the agent (it already holds a stream id from
`create_stream`); the raw GRN keeps the door open for entity kinds the MCP has no
create tool for. The grantee (a user, for v3.1.0) is also a GRN — `buildGrn("user", userId)`.

**Trade-offs:** A raw-GRN input is fully general but easy to mis-form; the
`(type, id)` pair is safe but enumerated. Support both; validate the type token
against `GRN_TYPES` at zod-parse time so a typo fails as a clean MCP validation
error, not an opaque Graylog 400.

### Pattern 2: prepare/commit mapped onto dryRun + confirmation token

**What:** Graylog's entity-share API is genuinely two-step, and the two steps map
cleanly onto the existing `dryRun` split. Confirmed from `EntitySharesResource.java`:

| Graylog endpoint | Method | Purpose | MCP mapping |
|---|---|---|---|
| `/api/authz/shares/entities/{grn}/prepare` | **POST** | `@NoAuditEvent("This does not change any data")` — returns `available_grantees`, `available_capabilities`, **`active_shares` (current grants)**, the effective `selected_grantee_capabilities`, `missing_permissions_on_dependencies`, and a `validation_result` | Fired during **`dryRun: true`** AND inside `build()` on the apply path |
| `/api/authz/shares/entities/{grn}` | **POST** | Persists grants; **full replace** of the modifiable grant set; returns `EntityShareResponse` | Fired only on **`dryRun: false`** apply |

> **Endpoint correction vs. the milestone brief:** the brief says `PUT /api/authz/shares/{grn}`.
> The actual 7.x surface is **`POST /api/authz/shares/entities/{entityGRN}`** (apply)
> and **`POST /api/authz/shares/entities/{entityGRN}/prepare`** (preview). Both are
> POST, not PUT, and the path segment is `entities/`. The roadmap and tool
> implementations must use the corrected paths.

**Does Graylog's `/prepare` replace or COMPLEMENT the local sha-256 token? — They COMPLEMENT.**

- Graylog's `/prepare` response is a **feasibility / dependency / validation
  pre-flight**. It tells the agent: who can be granted, what capabilities exist,
  what the grant set looks like *now* (`active_shares`), and — critically —
  `missing_permissions_on_dependencies` (e.g. sharing a dashboard whose backing
  stream the grantee cannot read) plus a `validation_result`. It is server-side
  truth about *whether the share is valid*.
- It is **NOT a drift guard.** `/prepare` is `@NoAuditEvent`, issues no token, and
  carries no opaque handle that the subsequent apply must echo. Two `/prepare`
  calls and one apply are three independent HTTP requests; nothing server-side
  binds them. Another admin can mutate the grant set between preview and apply.
- The existing **local sha-256 confirmation token** (`cascade-hash.js` +
  `requireConfirm` gate in `handler.js`) is what supplies **drift refusal**.
  `share_entity` should compute a token over the *current grant set observed at
  dry-run time* so that if the entity's grants change between preview and apply,
  the apply refuses instead of silently overwriting.

**Conclusion:** use both. `/prepare` for `validation_result` +
`missing_permissions_on_dependencies` (richer feasibility than any local check
could produce); the local token for TOCTOU drift refusal (the `/prepare` response
cannot provide this).

**Recommended `share_entity` flow:**

```
dryRun: true  (preview)
  build() [async — already supported by defineMutatingHandler]:
    1. buildGrn(entityType, entityId) -> entityGrn ;  buildGrn("user", granteeId) -> granteeGrn
    2. POST .../entities/{entityGrn}/prepare   body = { selected_grantee_capabilities: {} }
    3. read active_shares  ->  current grant set { granteeGrn: capability }
    4. merge: current ∪ { granteeGrn: requestedCapability }    (Pattern 3)
    5. confirmationToken = computeShareGrantHash({ entityGrn, grants: merged })
    6. surface in preview (via req._confirmationToken so handler.js emits it):
       the prepare response's validation_result + missing_permissions_on_dependencies,
       the merged grant set (the exact apply body), and the token
  -> agent sees feasibility + exactly what will be written + a token to echo

dryRun: false  (apply)
  build():  (re-runs steps 1-5 against LIVE state — re-POST /prepare, re-merge,
            RE-COMPUTE token)
  requireConfirm gate (handler.js step 6b):
    args.confirm === recomputed token  ?  proceed  :  refuse (confirmation_mismatch)
  apply():
    POST .../entities/{entityGrn}   body = { selected_grantee_capabilities: merged }
    inspect response.validation_result.failed — Graylog returns HTTP 400 WITH the
    EntityShareResponse body when validation fails; surface it as an MCP error
```

This is the exact `delete_index_set` shape: async `build()` does pre-flight GETs and
sets `req._confirmationToken`; `handler.js` emits the token in the dry-run preview
and enforces it via the `requireConfirm` gate on apply. No new wrapper machinery.

**Token shape:** add a thin semantic wrapper to `src/tools/_shared/cascade-hash.js`:

```javascript
// computeShareGrantHash({ entityGrn, grants }) — grants is [{grantee, capability}]
// canonical: sha256(JSON.stringify({ entityGrn, grants: [...].sort(by grantee) }))
```

This is the established `computeRuleCascadeHash` / `computeNotificationCascadeHash`
precedent — thin wrappers over `computeCascadeHash`, single-sourced canonical form,
byte-identity pinned in `test/cascade-hash.test.js`. (`computeCascadeHash`'s
keyed-bucket shape is stream-cascade-specific; a grant set is a flat sorted list of
`{grantee,capability}` pairs, so a dedicated small wrapper is cleaner than forcing
it through the stream buckets.)

**Why drift refusal matters MORE here:** entity sharing changes *who can read
production logs*. Combined with Pattern 3's replace semantics, a TOCTOU race where
admin B edits grants mid-flight would, under a naive apply, silently revoke B's
change. The sha-256-over-current-grant-set token closes that window with the exact
mechanism already proven by `delete_index_set` (C1) and `delete_stream` (C2).

**Trade-offs:** the apply path costs an extra `/prepare` round-trip to re-read
current grants for the token recompute. `connect_pipelines_to_stream` and the
cascade-delete tools already pay this cost; it is the price of correctness.

### Pattern 3: prepare-merge-POST — `share_entity` MUST read-merge-write (CRITICAL)

**What:** The entity-share apply endpoint is a **full REPLACE of the modifiable
grant set**, exactly like `POST /api/system/pipelines/connections/to_stream`.

**This is confirmed — not assumed — from `EntitySharesService.updatePrimaryEntityShares()`:**

```java
// remove grants that are not present anymore
existingGrants.forEach(g -> {
    if (!selectedGranteeCapabilities.containsKey(g.grantee())) {
        grantService.delete(g.id());          // <-- REVOKES the grant
        updateEventBuilder.addDeletes(g.grantee(), g.capability());
    }
});
```

Any grantee present in the entity's current grants but **absent** from the
request's `selected_grantee_capabilities` map has its grant **deleted**. The Java
doc comment on `getSelectedGranteeCapabilities()` is explicit: *"we expect the
frontend to always submit the full selection not only added/removed grantees. If
the grantee selection is empty, that means all shares should be removed."*

**Verdict — DEFINITIVE: `share_entity` MUST read current grants, merge the new
grant in, then write the full merged set.** A naive `share_entity` that POSTs only
`{ newUserGrn: "view" }` will **revoke every other user's access to the entity** —
the precise foot-gun the v3.0.0 "Pitfall 2" acceptance gate was written to catch
for `connect_pipelines_to_stream`.

**The precedent to copy:** `src/tools/pipelines/connect-pipelines-to-stream.js`.
Its `build()` does GET-current → union → POST-merged, and its Pitfall-2
acceptance-gate test proves the merge fires (asserts the POST body contains BOTH
the pre-existing and the new ids, not just the new one). `share_entity` is the same
shape with two refinements:

1. **Read source.** Instead of `GET /connections/{streamId}`, use
   `POST .../entities/{grn}/prepare` (empty `selected_grantee_capabilities`) and
   read `active_shares` from the response. `active_shares` is the canonical current
   grant set, already filtered to grants the calling user may modify
   (`getActiveShares()` excludes the sharing user's own grant and non-modifiable
   grantees). Reading via `prepare` reuses Graylog's own modifiability rules instead
   of re-deriving them MCP-side. Note `active_shares` entries also carry a `grant`
   GRN id; the merge keys on the grantee GRN, not the grant id.
2. **Merge is a map, not a set.** Pipeline connections merge a `Set<pipelineId>`.
   Grants merge a `Map<granteeGrn, capability>`. Adding `userX:view` when `userX`
   already has `manage` is an UPDATE (overwrite the value), not an insert. Surface
   the prior capability in `existingMatches` with `similarity_reason:
   "capability_changed"` (when capability differs) or `"already_granted"` (when
   unchanged), so the agent sees no-ops and changes without diffing client-side —
   same UX as `connect_pipelines_to_stream`'s `already_connected`.

**Revoke path:** because the endpoint is replace-semantics, an explicit
revoke/unshare is "merged = current grants MINUS the named grantee, then POST" —
the `disconnect_pipelines_from_stream` GET-subtract-POST precedent. For v3.1.0 this
can be a `revoke: true` flag on `share_entity` or a sibling `revoke_entity_share`
tool — the roadmapper decides; either way the merge primitive is shared.

**Acceptance gate to mandate (mirror of Pitfall 2):** a test asserting
`current = {userA: view, userB: manage}`, then `share_entity(userC, view)` →
POST body `selected_grantee_capabilities` contains **all three** of A, B, C — NOT
just `{userC: view}`. This is the load-bearing regression test for the milestone.

### Pattern 4: read-path tool — plain async handler, not the mutating factory

**What:** `get_entity_shares` is read-only — it must NOT use `defineMutatingHandler`
(no dryRun/token) and must NOT use `defineListHandler`. The `prepare` response is a
single structured DTO (`EntityShareResponse`) with nested arrays (`active_shares`,
`available_grantees`, `available_capabilities`); `defineListHandler`'s
narrow-projection machinery would flatten those away — the exact reason the doc
comment in `get-pipeline.js` gives for not using `defineListHandler` for single-DTO
reads.

**Implementation:** copy `src/tools/pipelines/get-pipeline.js` exactly: zod-parse →
`resolveConnection` (with `_testConnection` seam re-merge) → single
`client.request()` → JSON envelope → `wrapGraylogError`.

**Endpoint nuance:** the per-entity grant read happens via **`POST
.../entities/{grn}/prepare` with an empty body** (`@NoAuditEvent` — changes
nothing). The `prepare` response *is* the read model; there is no
`GET .../entities/{grn}`. The separate `GET /api/authz/shares/user/{userId}`
endpoint answers the inverse question ("what is shared *with* this user"), is
paginated, and is a useful optional second read tool — keep it as its own tool if
scoped, do not conflate.

## Data Flow

### `share_entity` apply-path request flow

```
agent: share_entity(entityType:"stream", entityId:"S1",
                    granteeType:"user", granteeId:"U1",
                    capability:"view", dryRun:false, confirm:<token>)
   ↓
src/index.js CallTool → dispatch("share_entity") → handler (defineMutatingHandler)
   ↓  zod.parse → resolveConnection → writable gate (all existing handler.js steps)
   ↓  build() [async]:
       buildGrn("stream","S1")  → entityGrn
       buildGrn("user","U1")    → granteeGrn
       POST /api/authz/shares/entities/{entityGrn}/prepare  {selected_grantee_capabilities:{}}
         → active_shares = {userA: view}                    ← CURRENT GRANTS
       merged = {userA: view, U1: view}                     ← MERGE (Pattern 3)
       token  = computeShareGrantHash({entityGrn, grants: merged})
       returns req with _confirmationToken=token, body={selected_grantee_capabilities:merged}
   ↓  requireConfirm gate (handler.js 6b): args.confirm === token ? ok : refuse
   ↓  apply():
       POST /api/authz/shares/entities/{entityGrn}  {selected_grantee_capabilities:merged}
         → EntityShareResponse  (check validation_result.failed → HTTP 400 → MCP error)
   ↓  normalize → { id: entityGrn, body: response }
```

### State management

No new persistent state. Authz tools are stateless request/response, identical to
the other 8 admin domains. The sha-256 token is stateless-by-design (recomputed on
apply, never stored MCP-side — survives process restart, per the `cascade-hash.js`
header). No connection-config schema change.

## Scaling Considerations

| Scale | Architecture adjustment |
|-------|-------------------------|
| Single Graylog, tens of grants per entity | None — current design is correct |
| Entity with hundreds of grants | `prepare` returns the full `active_shares`; merge is O(n) — fine. Graylog's own UI loads the same set |
| Many entities / many share calls | Each `share_entity` call is independent; no MCP-side aggregation — no bottleneck |

This is an admin tool surface — request volume is human/agent-paced, not
throughput-bound. No scaling work is warranted.

## Anti-Patterns

### Anti-Pattern 1: POST only the new grant ("replace-blindness")

**What people do:** `share_entity` POSTs `{selected_grantee_capabilities: {newUser: view}}`.
**Why it's wrong:** the endpoint is full-replace (confirmed in `EntitySharesService`):
every other grantee's grant is **deleted**, silently revoking production-log access
for everyone else on the entity.
**Do this instead:** prepare → read `active_shares` → merge → POST the full set
(Pattern 3). Mandate the three-grantee acceptance-gate test.

### Anti-Pattern 2: Treating Graylog `/prepare` as the drift guard

**What people do:** skip the local sha-256 token because "Graylog already has a
prepare step".
**Why it's wrong:** `/prepare` is `@NoAuditEvent`, issues no token, and binds
nothing to the subsequent apply. It validates feasibility, not staleness — another
admin can mutate the grant set in the window between preview and apply.
**Do this instead:** `/prepare` and the local token are complementary — `/prepare`
for `validation_result` + `missing_permissions_on_dependencies`, the local token
(over the merged grant set, recomputed on apply) for drift refusal.

### Anti-Pattern 3: GRN string concatenation at each call site

**What people do:** inline `` `grn:::::stream:${id}` `` in `share_entity` and again
in `get_entity_shares`.
**Why it's wrong:** six-token format, mandatory `grn` prefix, lower-casing, and an
enumerated type set are easy to get subtly wrong; a malformed GRN fails as an opaque
Graylog 400. Duplication means the dashboards/saved-search generalization must touch
every call site.
**Do this instead:** one `buildGrn`/`parseGrn` helper, type validated against
`GRN_TYPES` at zod-parse time.

### Anti-Pattern 4: Running `get_entity_shares` through `defineListHandler`

**What people do:** treat the grant set as a list and run it through the list factory.
**Why it's wrong:** the `prepare` response is a single nested DTO; narrow-projection
flattens `active_shares` / `available_grantees` away. Same trap `get-pipeline.js`
documents in its header.
**Do this instead:** plain async handler, copy `get-pipeline.js`.

## Integration Points

### How a new authz tool gets wired in (dispatch / registration)

Four mechanical edits — identical to every Phase 1-6 domain in v3.0.0:

1. **`src/tools.js`** — append one tool-definition object per authz tool (`name`,
   `description` ≤200 chars, `inputSchema`). The `ListTools` handler advertises it.
2. **`src/tools/authz/index.js`** *(new file)* — for each tool: `import` the handler,
   call `register("<tool_name>", handler)`. Direct copy of `pipelines/index.js`.
3. **`src/tools/_register.js`** — add one line: `import "./authz/index.js";` in the
   Phase-barrel section (next to `import "./pipelines/index.js";`). This is the ONLY
   edit to an existing shared file required for wiring.
4. `assertAllToolsRegistered(toolDefinitions)` already runs at `src/index.js` startup
   and fail-fasts if any `tools.js` entry lacks a registered handler — free safety
   net, no edit needed.

Tool-name convention is `<verb>_<domain>_<noun>` snake_case. Proposed names:
`share_entity`, `get_entity_shares` (or `list_entity_shares`), `create_role`,
`assign_role`. (`share_entity` slightly bends strict `verb_domain_noun` but reads
naturally and matches the brief; the roadmapper may prefer `grant_entity_share` for
strict convention adherence.)

### External service — Graylog 7.0.6 authz endpoints

| Endpoint | Method | Used by | Notes / gotchas |
|---|---|---|---|
| `/api/authz/shares/entities/{grn}/prepare` | POST | `get_entity_shares` (read), `share_entity` (dry-run + apply pre-flight) | `@NoAuditEvent`. Body `{selected_grantee_capabilities:{...}}`; empty body = pure read. Returns `active_shares`, `available_grantees`, `available_capabilities`, `validation_result`, `missing_permissions_on_dependencies` |
| `/api/authz/shares/entities/{grn}` | POST | `share_entity` (apply) | **Full-replace** of modifiable grants. Returns HTTP **400 with the `EntityShareResponse` body** when `validation_result.failed()` — apply() must inspect the body, not just trust 2xx. Server runs `checkOwnership(grn)` |
| `/api/authz/shares/user/{userId}` | GET | optional inverse-read tool | Paginated; `capability` / `entity_type` query filters; requires `users:edit` permission |
| `/api/roles` | GET / POST | `list_roles` / `create_role` | Standard CRUD |
| `/api/roles/{rolename}` | GET / PUT / DELETE | role read/update/delete | Keyed by **role name**, not id |
| `/api/roles/{rolename}/members/{username}` | PUT / DELETE | `assign_role` / unassign | PUT adds a user to the role; keyed by name + username, no GRN |

Capability enum (from `Capability.java`): `view`, `manage`, `own` — lower-case on
the wire. `share_entity`'s zod schema should use `z.enum(["view","manage","own"])`.

Permission gotchas (surface as upstream 403 — no new handling needed, the existing
`GraylogPermissionError` mapping covers it): `prepare`/`updateEntityShares` call
`checkOwnership(grn)` — the API token's user must *own* the entity (or be admin) to
share it. `GET .../user/{userId}` requires `users:edit`. `create_role` requires
admin. All Graylog-side; the MCP just passes the 403 through.

### Internal boundaries

| Boundary | Communication | Notes |
|---|---|---|
| `authz/` handlers ↔ `_shared/handler.js` | `defineMutatingHandler({name,schema,build,apply,summarize,requireConfirm})` | `build()` is async — already supported (`update_input`, `connect_pipelines_to_stream`, `delete_index_set` all use async build) |
| `authz/` handlers ↔ `_shared/cascade-hash.js` | new thin wrapper `computeShareGrantHash` | Single-sourced canonical form; byte-identity pinned in `test/cascade-hash.test.js` |
| `authz/` handlers ↔ `graylog/client.js` | `makeClient(conn).request(method,path,body)` | Unchanged. POST-with-body and POST-empty-body both supported (client sets `Content-Type` only when a body is present) |
| `authz/grn-helpers.js` ↔ handlers | pure import | No I/O; trivially unit-testable |
| `authz/index.js` ↔ `dispatch.js` | `register()` side-effect | Via `_register.js` barrel import |

### New vs. modified files (explicit)

**NEW files (all under `src/tools/authz/`):**
- `index.js`, `schemas.js`, `grn-helpers.js`
- `get-entity-shares.js`, `share-entity.js`
- `create-role.js`, `assign-role.js` (and optionally `list-roles.js` / `get-role.js`)

**MODIFIED existing files (minimal, additive only):**
- `src/tools.js` — append the authz tool-definition objects
- `src/tools/_register.js` — add `import "./authz/index.js";`
- `src/tools/_shared/cascade-hash.js` — add the `computeShareGrantHash` thin wrapper
- `test/cascade-hash.test.js` — pin the new wrapper's byte-identity

**No changes** to `src/graylog/client.js`, `src/dispatch.js`,
`src/tools/_shared/handler.js`, `dry-run.js`, `connection.js`, or any v2.3 read
tool. The milestone is structurally additive — it satisfies the PROJECT.md
"existing v2.3 tool contracts unchanged / connection-config additive only" constraints.

## Suggested Build Order (dependency-ordered)

1. **GRN helper + domain scaffold** — `grn-helpers.js` (`buildGrn`/`parseGrn`/`isGrn`
   + `GRN_TYPES`), `schemas.js` skeleton, empty `index.js` barrel, the `_register.js`
   one-line import. Pure, fully unit-testable, zero Graylog calls. *Hard prerequisite
   for everything below.*

2. **`get_entity_shares` (read path)** — plain async handler over
   `POST .../entities/{grn}/prepare`. Ships the read model the write tool depends on,
   and — being non-mutating — can be smoke-tested end-to-end against the live `test`
   instance immediately, giving an early integration checkpoint that de-risks the
   `prepare`-response parsing. *Depends on: step 1.*

3. **`share_entity` (write path)** — `defineMutatingHandler` with async `build()`
   doing prepare → read `active_shares` → **merge** → `computeShareGrantHash` →
   `_confirmationToken`; `requireConfirm` gate; apply with `validation_result`
   inspection. Add `computeShareGrantHash` to `cascade-hash.js`. Mandate the
   three-grantee merge acceptance-gate test (Pattern 3). *Depends on: steps 1 + 2 —
   it literally calls the same `prepare` endpoint the read tool wraps.*

4. **Role management — `create_role`, `assign_role`** (+ optional `list_roles` /
   `get_role`). Independent of the share path (different endpoints, no GRN merge —
   `/api/roles` is keyed by plain role names). Can run as a parallel/trailing wave.
   *Depends on: step 1 for schema conventions only.*

**Phase-ordering rationale:** the GRN helper is a hard prerequisite for both share
tools, so it leads. The read tool precedes the write tool because (a) `share_entity`'s
`build()` calls the same `prepare` endpoint the read tool wraps — building the read
tool first de-risks `prepare`-response parsing — and (b) the read tool is
non-mutating and live-testable immediately. Roles trail because they share no code
with the entity-share path and carry less blast radius; the share path is the
milestone's headline value and stays on the critical path (1→2→3).

If the roadmap splits this into two phases, the natural seam is **Phase A = entity
sharing (steps 1-3)**, **Phase B = roles (step 4)**. Single-phase is also viable
given the small surface (~4-6 tools).

## Sources

- `source-code/graylog2-server/.../security/rest/EntitySharesResource.java` —
  endpoint paths and methods (`POST .../entities/{grn}` apply,
  `POST .../entities/{grn}/prepare` preview, `GET .../user/{userId}`),
  `@NoAuditEvent` on prepare, `checkOwnership`, 400-with-body on validation failure. **HIGH**
- `source-code/graylog2-server/.../security/shares/EntitySharesService.java` —
  `updatePrimaryEntityShares()` confirms **full-replace / revoke-on-absence**
  semantics; `getSelectedGranteeCapabilities()` doc comment ("frontend always
  submits the full selection"); `getActiveShares()` = current modifiable grant set. **HIGH**
- `source-code/graylog2-server/.../security/shares/EntityShareRequest.java` /
  `EntityShareResponse.java` — request body shape (`selected_grantee_capabilities`,
  `selected_collections`), response shape (`active_shares`, `available_grantees`,
  `available_capabilities`, `validation_result`, `missing_permissions_on_dependencies`). **HIGH**
- `source-code/graylog2-server/.../security/Capability.java` — `view`/`manage`/`own`
  enum, lower-case wire form. **HIGH**
- `source-code/graylog2-server/.../grn/GRN.java` + `GRNTypes.java` — 6-token GRN
  format, mandatory `grn` prefix, registered entity types. **HIGH**
- `source-code/graylog2-server/.../rest/resources/roles/RolesResource.java` — role
  endpoints (`/api/roles`, `/api/roles/{rolename}`, `/api/roles/{rolename}/members/{username}`). **HIGH**
- Existing codebase: `src/tools/pipelines/connect-pipelines-to-stream.js`
  (GET-merge-POST precedent + Pitfall-2 acceptance gate), `src/tools/_shared/handler.js`
  + `dry-run.js` + `cascade-hash.js` (mutating-handler factory, `requireConfirm`
  gate, token mechanism, thin-wrapper pattern), `src/tools/index-sets/delete-index-set.js`
  (async-build pre-flight + `_confirmationToken` precedent), `src/tools/_register.js`
  + `src/dispatch.js` (registration wiring), `src/tools/pipelines/get-pipeline.js`
  (read-handler shape), `src/tools/pipelines/index.js` (domain barrel pattern). **HIGH**

> Version caveat: the source clone is 7.2.0-SNAPSHOT; the ship target is live 7.0.6.
> The entity-share API (`EntitySharesResource`) has been stable since Graylog 4.x and
> the `prepare`/replace-semantics design is unchanged across 7.0→7.2. Verify the exact
> response field names against the live `test` instance during step 2 (the read tool)
> before relying on them in step 3.

---
*Architecture research for: Graylog MCP authz/sharing tool surface (v3.1.0)*
*Researched: 2026-05-19*
