<!-- generated-by: gsd-doc-writer -->
# Architecture

`graylog-mcp-server` is a Model Context Protocol (MCP) server that exposes a Graylog 7.x admin
surface to an AI agent. The system is organized as a **stdio MCP server** with a **Map-backed tool
dispatcher**, **per-domain handler modules**, a set of **shared safety primitives** that gate every
mutating call, and two specialized subsystems for **pipeline-rule DSL emission** and **log
clustering**.

The architecture is shaped by one core constraint: every mutating tool must default to a safe,
explainable preview (`dryRun: true`), and every apply must be bound to the exact world state the
agent reviewed at preview time. The shared safety stack — described in the dedicated section below
— is the structural enforcement of that constraint.

## System Overview

Process layout:

- **One process per MCP session.** `src/index.js` (34 lines) constructs an `@modelcontextprotocol/sdk`
  `Server`, attaches a `StdioServerTransport`, and exits when stdio closes.
- **Tool catalogue** (`src/tools.js`, ~101 tools) is advertised on `ListToolsRequestSchema`. Every
  tool name is `<verb>_<domain>_<noun>` (snake_case); legacy v2.3 tools were renamed at Plan 00-05
  to fit the convention (CHANGELOG.md).
- **Dispatch** (`src/dispatch.js`) is a `Map<name, handler>`. Handlers register themselves at
  module-init via `src/tools/_register.js`, which imports every domain barrel for side effects.
  After registration, `assertAllToolsRegistered(toolDefinitions)` runs at startup; any tool listed
  in `tools.js` without a registered handler throws before stdio is connected
  (`src/index.js:29`).
- **All Graylog I/O** flows through a single HTTP client factory: `makeClient(conn).request(method,
  path, body)` in `src/graylog/client.js`. The client is responsible for HTTP Basic auth (api token
  as username, literal `"token"` as password — `src/graylog/auth.js`), the `X-Requested-By` header,
  60-second timeout, status-code → typed-error mapping (`src/graylog/errors.js`), and the
  **defense-in-depth refusal** of any non-`GET` against a `writable: false` connection.

## Component Diagram

```
                         ┌───────────────────────────┐
                         │   MCP client (Claude…)    │
                         └────────────┬──────────────┘
                                      │ stdio (JSON-RPC)
                                      ▼
                ┌────────────────────────────────────────┐
                │ src/index.js  — Server + transport     │
                │   • ListTools  → toolDefinitions       │
                │   • CallTool   → dispatch(request)     │
                └────────────────────┬───────────────────┘
                                     │
                                     ▼
                ┌────────────────────────────────────────┐
                │ src/dispatch.js — Map<name,handler>    │
                │ src/tools/_register.js (side-effect)   │
                └────────────────────┬───────────────────┘
                                     │
   ┌───────────────────┬─────────────┴────────────┬───────────────────┐
   ▼                   ▼                          ▼                   ▼
┌───────────────┐   ┌─────────────────────┐   ┌────────────────┐   ┌───────────┐
│ Per-domain    │   │ Legacy v2.3 handlers│   │ Clustering     │   │ Pipeline  │
│ tool handlers │   │ (src/handlers.js,   │   │ subsystem      │   │ DSL       │
│ src/tools/    │   │  src/tools/cluster- │   │ src/clustering/│   │ src/      │
│ <domain>/     │   │  errors.js, etc.)   │   │                │   │ pipeline- │
└──────┬────────┘   └──────────┬──────────┘   └────────┬───────┘   │ dsl/      │
       │                       │                       │           └─────┬─────┘
       │                       │                       │                 │
       │ defineMutatingHandler │ requireActiveConnection                 │ emit /
       │ defineListHandler     │ + searchGraylog       │ register/get    │ validate
       ▼                       ▼                       ▼                 │
┌─────────────────────────────────────────────┐                          │
│ src/tools/_shared/  (safety primitives)     │                          │
│  • handler.js     (mutating factory)        │                          │
│  • list.js        (list factory)            │                          │
│  • connection.js  (resolver + test seam)    │                          │
│  • cascade-hash.js (sha-256 confirm tokens) │                          │
│  • blueprint-chain.js (multi-step apply)    │                          │
│  • dry-run.js / idempotency.js / errors.js  │                          │
│  • conflict.js  (findExistingMatches)       │                          │
│  • system-job.js (await_system_job)         │                          │
│  • widget-position-integrity.js             │                          │
└──────────────────────┬──────────────────────┘                          │
                       │                                                 │
                       ▼                                                 │
              ┌────────────────────┐                                     │
              │ src/graylog/       │◀────────────────────────────────────┘
              │ client.js + auth + │
              │ errors + normalize │
              └──────────┬─────────┘
                         │ axios (HTTP)
                         ▼
                ┌───────────────────┐
                │   Graylog 7.x     │
                └───────────────────┘
```

## Layers

### 1. Transport (`src/index.js`)

The entire transport layer is 34 lines:

- Instantiate `Server({ name: "graylog-mcp-server", version: "2.2.0" }, { capabilities: { tools: {} } })`.
- Register `ListToolsRequestSchema` → returns `{ tools: toolDefinitions }`.
- Import `./tools/_register.js` for side-effect registration of every domain barrel.
- Call `assertAllToolsRegistered(toolDefinitions)` — startup fail-fast (Discretion-06).
- Register `CallToolRequestSchema` → `dispatch` from `src/dispatch.js`.
- Connect a `StdioServerTransport`.

There is no HTTP server, no web UI, no admin console; every response is a JSON-stringified MCP text
content block.

### 2. Tool catalogue (`src/tools.js`)

Single source of truth for `{ name, description, inputSchema }`. ~101 tool definitions, all
snake_case, mostly following `<verb>_<domain>_<noun>`. `tools.js` does NOT contain handler logic;
it is consumed by:

- `ListToolsRequestSchema` to advertise capability.
- `assertAllToolsRegistered` at startup to detect a tool whose dispatch wiring is missing.
- `list_admin_tools` (`src/tools/meta/list-admin-tools.js`) to produce a domain-grouped inventory
  for the agent without paying the cost of every full description.

### 3. Dispatch (`src/dispatch.js`)

```javascript
register(name, handler)              // throws if name already registered or handler is not a function
dispatch(request)                    // throws if name not found; otherwise awaits handler(request)
assertAllToolsRegistered(toolDefs)   // throws listing all names in tools.js that lack a handler
_clearForTests()                     // test seam
```

The dispatcher does **no** input validation, **no** connection resolution, and **no** error
formatting — those concerns live in the per-handler factories under `src/tools/_shared/`.

### 4. Per-domain handler modules (`src/tools/<domain>/`)

Each domain ships:

- An `index.js` barrel that `import`s every handler in the domain and `register()`s it on
  `dispatch.js`. The barrel is `import`ed once by `src/tools/_register.js`.
- A `schemas.js` of zod schemas (per-domain shapes that extend `mutatingBase` or `listBase` from
  `_shared/schemas.js`).
- One file per tool, exporting a handler built via `defineMutatingHandler` or `defineListHandler`.

Domains shipped to date:

| Domain        | Location                       | Tools (selected)                                                                                                                 |
|---------------|--------------------------------|----------------------------------------------------------------------------------------------------------------------------------|
| `inputs`      | `src/tools/inputs/`            | list/get/create/update/delete input; start/stop input; list/create/update/delete extractor; list_input_types (catalogue-cached) |
| `index-sets`  | `src/tools/index-sets/`        | list/get/create/update/delete; cycle deflector; set default; strategies                                                          |
| `streams`     | `src/tools/streams/`           | list/get/create/update/delete; start/pause; rule CRUD; test_stream_match                                                         |
| `pipelines`   | `src/tools/pipelines/`         | pipeline + rule CRUD; connect/disconnect to streams; list_pipeline_functions; simulate_pipeline_rule                             |
| `events`      | `src/tools/events/`            | event-definition CRUD + enable/disable; notification CRUD; v6→v7 aggregation-condition migration                                 |
| `dashboards`  | `src/tools/dashboards/`        | list/get/create/update/delete dashboard; add_widget_from_template; remove_widget                                                 |
| `blueprints`  | `src/tools/blueprints/`        | `setup_app_monitoring_stack` (headline 6-step chain), `setup_error_alerting`, `setup_long_term_archival_index`, etc.             |
| `authz`       | `src/tools/authz/`             | v3.1.0 surface: `get_entity_shares`, `list_grantees`, `share_entity`; role CRUD + assign/unassign                                |
| `notifications` | (under `events/`)            | shipped under the `events` domain as event_notification CRUD                                                                     |
| `meta`        | `src/tools/meta/`              | `list_admin_tools` (pure-static, no connection needed)                                                                           |
| `_shared`     | `src/tools/_shared/`           | factories + cross-cutting primitives (no tools registered)                                                                       |

Two legacy handler bundles remain inline:

- `src/handlers.js` (~815 lines) — the v2.3 read/search handlers (`fetchGraylogMessages`,
  `getLogHistogram`, `getFieldAggregation`, saved-search CRUD, `searchEvents`, etc.). They are
  imported by name into `src/tools/_register.js`.
- `src/tools/cluster-errors.js` and `src/tools/template-mgmt.js` — the v2.3 clustering and
  template-CRUD handlers, kept as a stable surface and not migrated to `defineMutatingHandler`
  (they predate the factory).

### 5. Shared primitives (`src/tools/_shared/`)

Twelve modules, all small (~50–270 lines each). The key ones — `handler.js`, `list.js`,
`connection.js`, `cascade-hash.js`, `blueprint-chain.js` — are documented in the **Safety
architecture** section below.

### 6. Graylog HTTP layer (`src/graylog/`)

```
auth.js       buildAuth(apiToken) → { username: apiToken, password: "token" }
client.js     makeClient(conn).request(method, path, body)
              • refuses non-GET when conn.writable === false (defense in depth)
              • bodyless requests (null/undefined body) send NO Content-Type
                and NO data — Graylog 7.x rejects `null` payloads with 400
              • validateStatus: () => true; ≥400 → mapGraylogError → throw
              • 60-second timeout
              • test seam: _setCaptureRequest(fn) / _clearCaptureRequest()
errors.js     GraylogError + 6 typed subclasses (Validation, Unauthorized,
              Permission, NotFound, Conflict, Unprocessable) with .status,
              .method, .path, .body. mapGraylogError(res, ctx) → typed instance.
normalize.js  Response-shape helpers used by per-domain build() functions.
```

### 7. Service helpers (`src/services/`)

Per-domain Graylog API helpers (`dashboards.js`, `events.js`, `index-sets.js`, `inputs.js`,
`pipelines.js`, `streams.js`). These are thin wrappers that call `makeClient(conn).request(...)`
for common operations — used by handler `build()` functions for pre-flight GETs.

### 8. v2.3 search/aggregation layer

Pre-existing modules consumed by `src/handlers.js`:

- `src/query.js` — Elasticsearch query string + stream-filter composition, axios search client.
- `src/timerange.js` — relative/absolute time-range parsing.
- `src/aggregations.js` — histogram and field-aggregation payload builders (4 fallback strategies
  per histogram tool).
- `src/saved-searches.js` — named search persistence under `~/.graylog-mcp/saved-searches.json`.
- `src/events.js` — Graylog events/alerts API wrappers (used by the v2.3 `searchEvents` handler).

## Data Flow

### A. Read tool (e.g. `list_streams`)

```
1. MCP client → CallToolRequest { name: "list_streams", arguments: {...} }
2. dispatch(request) → handler from Map
3. defineListHandler wrapper:
   a. schema.parse(args)                   (zod; rejects with formatZodError)
   b. resolveConnection(args)              (test seam | connectionName | singleton)
   c. clamp limit ≤ MAX_LIMIT (200)
   d. resolve field projection (default | "all" | custom array)
   e. fetch(makeClient(conn), args)        (per-tool fetch callback)
   f. project each item → { id, title, description } (or per-tool defaultFields)
   g. wrap in { tool, connection, count, limit, fields, items }
4. Graylog ← axios GET ← makeClient
5. Return JSON-stringified text block.
```

### B. Mutating tool (e.g. `update_input`)

```
1. MCP client → CallToolRequest { name: "update_input", arguments: { dryRun: true, ... } }
2. dispatch(request) → handler from Map
3. defineMutatingHandler wrapper (8 strictly-ordered steps):
   1) schema.parse(args)                   strip _testConnection BEFORE parse
   2) resolveConnection(args)              error envelope on failure
   3) writable gate                        conn.writable === false → reason:connection_read_only
   4) deriveIdempotencyKey                 unless agent supplied idempotencyKey
   5) build(args)  [async]                 pure: returns { method, path, body, ... }
   6) dryRun branch ─→ emit preview {dryRun:true, tool, connection, idempotencyKey,
                                     summary, preview:{method,path,body},
                                     postApplyEstimate, existingMatches,
                                     [confirmationToken], [cascades], [parseResult],
                                     [migration], [chain], applyHint}
   7) requireConfirm gate                  args.confirm !== token → reason:confirmation_mismatch
   8) apply(client, req) [try]             plain isError envelope passed through verbatim
   9) normalize(raw) → { id, body }        envelope: {dryRun:false, applied:true, tool,
                                                      connection, idempotencyKey, result:{id,body}}
4. On any thrown error → wrapGraylogError(err, name) → isError envelope with reason tag.
```

### C. Cascade-destructive tool (e.g. `delete_stream`)

```
1. Steps 1-4 above.
5. build():
   a. GET /api/streams/{id}                D-09: if is_editable === false → reason:stream_immutable
   b. GET /api/streams/{id}/rules                                                        \
   c. GET /api/streams/{id}/pipelines       Three-endpoint cascade pre-flight (D-04)      |  3 round-trips
   d. paginate /api/events/definitions/paginated filtered by config.streams.includes()   /
   e. computeCascadeHash({streamId, ruleIds, pipelineConnIds, eventDefIds})              D-02 sha-256
   f. return { method:DELETE, path, cascades, _confirmationToken, _streamId }
6. dryRun → preview surfaces cascades + confirmationToken to agent.
7. apply:
   a. RE-RUN steps 5b–5e (re-fetch cascades, re-compute hash)
   b. if hash !== req._confirmationToken → reason:cascade_changed_since_preview     ← TOCTOU gate
   c. DELETE /api/streams/{id}
   d. return { deleted: true, streamId }
```

### D. Blueprint chain (e.g. `setup_app_monitoring_stack`)

```
1. Steps 1-4 above.
5. build() produces req.chain: [{step, tool, request:{method,path,body}, dependsOn?}, ...]
6. dryRun → preview surfaces the FULL chain transcript up front; the agent sees every step
            and every cross-step dependency without composing intermediate IDs.
7. apply → executeChain(client, req.chain):
   • for each step: resolve dependsOn substitutions (e.g. step1.response.stream_id →
     __SERVER_ASSIGNED__step1) into both body and path; client.request(...); push transcript.
   • on any throw → return isError {reason:"blueprint_chain_partial_failure",
                                    transcript, failed_at_step, succeeded_steps}
   • on unresolved dependency → reason:"blueprint_chain_unresolved_dependency"
```

## Safety Architecture

This is the heart of the milestone. Every mutating tool — without exception — composes through
`defineMutatingHandler` and inherits the same eight-step gating stack. The stack exists to make
three classes of bug structurally impossible:

1. **An apply that silently bypasses the preview.** Solved by `dryRun: true` default + read-merge-write.
2. **An apply against a world state the agent never reviewed.** Solved by sha-256 confirmation tokens
   + drift refusal.
3. **A privilege boundary crossed without intent.** Solved by writable gates at two layers and a
   read-only connection refusing all non-GET traffic.

### Layer 1 — `dryRun: true` by default

`mutatingBase` (`src/tools/_shared/schemas.js`) declares:

```javascript
export const mutatingBase = z.object({
    dryRun: z.boolean().default(true),
    connectionName: z.string().optional(),
    idempotencyKey: z.string().optional(),
});
```

Every per-domain schema extends this base. The default is enforced ONCE in `defineMutatingHandler`
step 6 (`const dryRun = args.dryRun ?? true`). A handler that omits the wrapper would have to
re-declare the default; the factory-only contract ensures it cannot drift.

In dry-run mode, the wrapper emits a deterministic envelope:

```javascript
{
    dryRun: true,
    tool, connection, idempotencyKey,
    summary: <human-readable verb + path>,
    preview: { method, path, body, [cascades] },
    postApplyEstimate: { id: "__SERVER_ASSIGNED__" }, // SERVER_ASSIGNED_SENTINEL
    existingMatches: [],                              // populated by findExistingMatches
    [confirmationToken], [cascades], [parseResult], [migration], [chain],
    applyHint: "Re-call with dryRun: false to apply",
}
```

The `preview` field is the **exact** request that will go on the wire — `build()` is pure and runs
on both branches, so `preview ≡ apply payload` is a structural invariant, not a discipline.

### Layer 2 — `build()` is pure; `apply()` is the only side-effect

`build(args)` returns a `RequestDescriptor`:

```javascript
{ method, path, body?, postApplyEstimate?, existingMatches?, cascades?,
  normalize?, _confirmationToken?, parseResult?, migration?, chain?, previewCascades? }
```

`build()` may be `async` — some handlers (`update_input`, `create_input`) need to pre-flight a GET
on the current Graylog state or consult a cached type catalogue inside `build()`. This is
load-bearing for **read-merge-write semantics**: handlers that must preserve other fields on update
(`update_input`, `share_entity`, `update_role`) read the current state inside `build()` so the
preview surfaces the merged body the agent would actually POST.

`apply(client, req)` performs the actual HTTP. The wrapper:

- Wraps the call in `try/catch` and converts thrown `GraylogError` instances via
  `wrapGraylogError` (`src/tools/_shared/errors.js`) into a uniform MCP isError envelope, preserving
  `status`, `method`, `path`, a 200-char `body` snippet, and a structured `reason` tag.
- Passes through verbatim any `apply()` return that already has `isError: true` — used by tools
  that need to surface a structured drift refusal (e.g. `delete_stream` cascade drift, `share_entity`
  validation failure).
- Normalizes the response via `req.normalize(raw)` or the fallback `{ id: raw?.id, body: raw }`
  (FOUND-08).

### Layer 3 — sha-256 confirmation tokens (TOCTOU gate)

Every destructive cascade tool issues a deterministic sha-256 over the canonical pre-flight state
and surfaces it in the dry-run envelope as `confirmationToken`. The agent must echo the token in
`args.confirm` on apply. Two refusal paths:

1. **Token mismatch (replay or forgery):** `defineMutatingHandler` step 7 (`requireConfirm` gate)
   refuses with `reason: "confirmation_mismatch"` BEFORE `apply()` runs.
2. **State drifted between dry-run and apply (TOCTOU):** `apply()` RE-FETCHES the pre-flight inputs,
   RE-COMPUTES the hash, and refuses with `reason: "cascade_changed_since_preview"` (or domain
   variants like `grants_changed_since_preview`) when the hash differs.

The token shape is per-domain canonical, all in `src/tools/_shared/cascade-hash.js`:

| Helper                          | Used by                              | Canonical form                                                                            |
|---------------------------------|--------------------------------------|-------------------------------------------------------------------------------------------|
| `computeC1Hash`                 | `delete_index_set`                   | `{indexSetId, deleteIndices:true, indexNames(sorted), messageCount}`                      |
| `computeCascadeHash`            | `delete_stream`                      | `{streamId, cascades:{rules, pipeline_connections, event_definitions}}` (keyed buckets)   |
| `computeRuleCascadeHash`        | `delete_pipeline_rule`               | thin forward into `computeCascadeHash` (byte-identical)                                   |
| `computeNotificationCascadeHash`| `delete_event_notification`          | thin forward into `computeCascadeHash`                                                    |
| `computeShareGrantHash`         | `share_entity`                       | `{entityGrn, grants:[{grantee,capability}...sorted by grantee]}` (standalone)             |
| `computeRoleCascadeHash`        | `create_role`/`update_role`/`delete_role`/`assign_role`/`unassign_role` | standalone canonical per tool; `tool` field is the bucket discriminator (cross-tool replay protection, D-13) |

**Keyed-bucket design rationale:** a flat sorted-array canonical would collapse a rule ID that
byte-collides with a pipeline-connection ID. Keyed buckets disambiguate per-type, so any type drift
between dry-run and apply changes the hash. Byte-identity is pinned by frozen fixtures in
`test/cascade-hash.test.js`.

### Layer 4 — read-merge-write (the `share_entity` pattern)

Graylog's `POST /api/authz/shares/entities/{grn}` is full-replace: a naive POST of just the new
grant silently revokes every other grantee. `share_entity` (`src/tools/authz/share-entity.js`)
implements the canonical read-merge-write pattern that several other tools follow:

```
build():
  current = fetchEntitySharePreview(client, grn)        // POST .../prepare with empty body
  merged  = mergeGrant(current.active_shares, args)      // add / replace / remove
  token   = computeShareGrantHash({entityGrn, grants: merged})
  return { method: "POST", path, body: {selected_grantee_capabilities: merged},
           _confirmationToken: token, cascades: {merged, removed, added} }

apply():
  current  = fetchEntitySharePreview(client, grn)        // RE-READ
  current_token = computeShareGrantHash({entityGrn, grants: applyMerge(current, args)})
  // The wrapper's requireConfirm gate runs BEFORE apply, comparing args.confirm against
  // the freshly-computed build()-time token. The re-read above is for surfacing drift
  // in the structured isError envelope when args.confirm fails to match.
  POST path + body
```

The same pattern is used by `update_input`, `update_role`, `assign_role`/`unassign_role`, and the
event-definition / dashboard update handlers — anywhere Graylog's API is full-replace and the agent
provided only a partial intent.

### Layer 5 — writable-flag refusal (defense in depth)

A connection in `~/.graylog-mcp/config.json` may declare `writable: false` (defaults to true).
Two layers refuse mutations:

1. **Wrapper layer** (`src/tools/_shared/handler.js` step 3): short-circuits BEFORE `build()` runs,
   so no Graylog GETs are spent and the agent sees a clear `reason: "connection_read_only"`
   envelope.
2. **HTTP-client layer** (`src/graylog/client.js`): refuses any non-GET method even if a future
   service-layer caller bypasses the wrapper. This is the structural safety net.

### Layer 6 — idempotency keys

Every mutating handler auto-derives a 32-hex-char sha-256-truncated `idempotencyKey` from
`{connectionName, toolName, canonical(args)}`. Canonicalization sorts object keys recursively,
drops `dryRun` and `idempotencyKey` from the projection (so previewing vs. applying is the same
key), drops `undefined`, and preserves array order. The key:

- Is surfaced in both the dry-run preview and the apply envelope so the agent can trace and
  dedupe across retries.
- Is reused by `findExistingMatches` (`src/tools/_shared/conflict.js`) to flag near-duplicates
  before `apply()`.
- Is **client-side only** — Graylog 7.x does not honour an `Idempotency-Key` HTTP header (verified
  against the Graylog source).

### Layer 7 — `findExistingMatches` (conflict pre-check)

`findExistingMatches(client, { listPath, matchFn, similarityReason })` issues a GET against
`listPath`, unwraps the response (handling the `inputs` / `streams` / `extractors` / `index_sets`
/ `elements` / `views` / `items` envelopes Graylog uses across resource families), filters with the
build-time `matchFn`, and projects `{id, title, similarity_reason}`. The result populates
`preview.existingMatches` so the agent sees would-be duplicates before applying.

### Layer 8 — `executeChain` (blueprint apply walker)

`src/tools/_shared/blueprint-chain.js` walks a multi-step chain produced by a blueprint's `build()`:

- For each step, resolve `dependsOn` clauses by walking dotted paths (`step1.response.stream_id`)
  against the running transcript.
- Substitute `__SERVER_ASSIGNED__step{N}` placeholders inside the step's `body` AND `path` (the
  exact-match string branch preserves type so a numeric replacement stays numeric).
- On any apply throw: short-circuit with `reason: "blueprint_chain_partial_failure"` and surface
  the transcript so the agent can manually clean up orphaned resources. No rollback — idempotency
  keys ensure retries converge.

### Cross-cutting: list tools (`defineListHandler`)

Symmetric to `defineMutatingHandler` but for read tools. Defaults:

- `DEFAULT_LIMIT = 25`, `MAX_LIMIT = 200` (clamps silently — agent context-bloat protection,
  Pitfall M6).
- `DEFAULT_FIELDS = ["id", "title", "description"]` projection unless `fields: "all"` or a custom
  array is passed. Per-tool overrides via `defaultFields` in the factory spec
  (e.g. `list_inputs` uses `["id", "title", "type", "global"]`).

## State Management

**Process-local (cleared on restart):**

- Active connection name — `src/config.js` module variable. Set via `set_active_connection`.
- Per-connection pipeline-function catalogue — `src/pipeline-dsl/function-catalogue.js`. One GET per
  connection per process; merges live `/api/system/pipelines/rule/functions` over the static
  `builtins.js` baseline (live wins on collision).
- Per-connection input type catalogue — `src/tools/inputs/type-catalogue.js`. Same pattern.
- Drain3 clustering state — held in the strategy instance during a call, persisted via
  `template-store.js` (next bullet).

**Filesystem-persisted (under `~/.graylog-mcp/`):**

- `config.json` — connection registry (overridable via `GRAYLOG_CONFIG_PATH`).
- `saved-searches.json` — named search persistence.
- `templates/<connection>.json` — clustering templates per connection (atomic write via
  `tmp+rename` with a 30-second stale-break file lock).

**Not persisted:**

- Idempotency keys (agent-side concern; the wrapper just surfaces them).
- Confirmation tokens (deterministic — recomputed at apply time, no MCP-side memory needed).
- Search results / time-series queries (no caching).

## Key Abstractions

| Abstraction                | Location                                          | Purpose                                                                                                          |
|----------------------------|---------------------------------------------------|------------------------------------------------------------------------------------------------------------------|
| `defineMutatingHandler`    | `src/tools/_shared/handler.js`                    | The mutating-handler factory; owns the 8-step safety stack (validate → resolve → writable → idempotency → build → dryRun-or-apply → confirm → normalize). |
| `defineListHandler`        | `src/tools/_shared/list.js`                       | The list-handler factory; owns limit clamping + projection.                                                       |
| `resolveConnection`        | `src/tools/_shared/connection.js`                 | Three-mode lookup: `_testConnection` seam → per-call `connectionName` → singleton fallback.                       |
| `computeCascadeHash` (+ siblings) | `src/tools/_shared/cascade-hash.js`        | Deterministic sha-256 over canonical pre-flight state. Six variants for different destructive-cascade shapes.     |
| `findExistingMatches`      | `src/tools/_shared/conflict.js`                   | Conflict pre-check; populates `preview.existingMatches`.                                                          |
| `executeChain`             | `src/tools/_shared/blueprint-chain.js`            | Walks a multi-step blueprint apply with cross-step ID substitution and partial-failure transcripts.               |
| `makeClient`               | `src/graylog/client.js`                           | Single HTTP-client factory; writable-flag defense, header discipline, typed errors.                                |
| `mutatingBase` / `listBase`| `src/tools/_shared/schemas.js`                    | Cross-cutting zod base schemas every per-domain schema extends.                                                   |
| `wrapGraylogError`         | `src/tools/_shared/errors.js`                     | Translates thrown `GraylogError` to canonical MCP isError envelope with structured `reason` tag.                  |
| `validateWidgetPositionIntegrity` | `src/tools/_shared/widget-position-integrity.js` | Client-side bidirectional widget↔position equality (tightens Graylog's superset-only server check).        |
| `register` / `dispatch`    | `src/dispatch.js`                                 | Map-backed tool registry + dispatch with startup completeness assertion.                                          |
| Clustering strategy registry | `src/clustering/index.js`                       | Pluggable algorithm interface: `{ name, version, hydrate, serialize, cluster }`. Drain3 auto-registered.          |
| `emitRule` (pipeline DSL)  | `src/pipeline-dsl/emit.js`                        | Structured-intent → Graylog rule-source string, byte-stable, every literal escape-routed.                         |
| `validateRuleSource`       | `src/pipeline-dsl/validate.js`                    | Client-side rule-source lint over the MERGED function catalogue (live wins for new functions).                    |
| `WIDGET_TEMPLATES`         | `src/widget-templates/index.js`                   | `Object.freeze`d closed-set of 8 dashboard widget-template builders consumed by `add_widget_from_template`.       |

## Subsystem: Pipeline-rule DSL (`src/pipeline-dsl/`)

Five modules that together let a tool emit a Graylog pipeline rule from a structured intent without
hand-concatenating strings:

- **`builtins.js`** (188 lines) — hand-curated static baseline of Graylog stream function
  signatures. Filled when the live `/api/system/pipelines/rule/functions` response carries
  signature-only metadata without descriptions.
- **`function-catalogue.js`** (93 lines) — per-connection cache. One GET per connection per
  process; merges the live response over the static baseline (live wins on collision). Consumed by
  `list_pipeline_functions` and by `validate.js` so a newer Graylog version's functions do not
  false-fail the client-side lint.
- **`escape.js`** (83 lines) — string-escape routine used by the emitter. Every embedded literal
  goes through this — there is no inline `${value}` interpolation anywhere in `emit.js` (threat
  T-04-01-05).
- **`emit.js`** (119 lines) — structured `RuleSpec` JSON tree → DSL source string. Covers 7
  Condition variants and 6 Action variants. Output is byte-stable for byte-stable input (snapshot
  tests depend on this).
- **`validate.js`** (113 lines) — function-name + paren-balance lint. String-aware (parens inside
  DSL double-quoted strings do not count). Fast-path rejection on obvious typos before the
  server-authoritative parse pre-flight.

Used by `create_pipeline_rule`, `update_pipeline_rule`, and `simulate_pipeline_rule`.

## Subsystem: Log clustering (`src/clustering/`)

Pluggable log-clustering subsystem:

- **`index.js`** — strategy registry. `register(name, strategy)` rejects duplicates; `get(name)`
  throws with a list of registered names on miss. Built-in `drain3` auto-registers on first import.
- **`preprocess.js`** — `normalizeMessage` + `tokenize`. Regex substitution rewrites numbers, IPs,
  UUIDs, and hex blobs to a `<*>` wildcard token (`WILDCARD_TOKEN`).
- **`formatter.js`** — cluster → MCP response shaping.
- **`template-store.js`** — per-connection JSON file under `~/.graylog-mcp/templates/<connection>.json`
  with a `STORE_VERSION` field, atomic write via `tmp+rename`, and a 30-second stale-break file
  lock.
- **`strategies/drain3.js`** — length-bucketed Drain-style strategy. Templates are bucketed by
  token count; within each bucket, a linear best-match similarity scan is used (the classic Drain3
  prefix-tree is a perf optimization unneeded at this scale: ≤10k messages, low-hundreds of
  templates per bucket). `maxChildren` caps templates per bucket with LRU eviction.
- **`_test_hooks.js`** — `_setSearchOverride` / `_getSearchOverride` lets tests bypass axios.

Consumed by `cluster_log_messages` (`src/tools/cluster-errors.js`) and the template-CRUD tools
(`src/tools/template-mgmt.js`).

## Directory Structure Rationale

```
src/
├── index.js                # MCP server bootstrap (34 lines — kept thin on purpose)
├── tools.js                # Tool catalogue (~101 entries; single source of truth)
├── dispatch.js             # Map<name, handler> registry + assertAllToolsRegistered
├── handlers.js             # v2.3 read/search handlers (inline, not yet factory-wrapped)
├── config.js               # Connection registry + active-connection state
├── tools/
│   ├── _register.js        # Side-effect barrel: imports every domain index.js
│   ├── _shared/            # Cross-cutting factories + primitives (no tools registered)
│   ├── authz/              # v3.1.0 surface: entity-shares + role management
│   ├── blueprints/         # Multi-step composed tools (setup_*) using executeChain
│   ├── dashboards/         # Dashboard CRUD + widget-from-template
│   ├── events/             # Event-definition + event-notification CRUD
│   ├── index-sets/         # Index-set CRUD + cycle-deflector + await_system_job
│   ├── inputs/             # Input + extractor CRUD; start/stop; type catalogue
│   ├── meta/               # list_admin_tools (pure-static)
│   ├── pipelines/          # Pipeline + rule CRUD; simulate; functions catalogue
│   ├── streams/            # Stream + rule CRUD; start/pause; test_stream_match
│   ├── cluster-errors.js   # v2.3: cluster_log_messages
│   └── template-mgmt.js    # v2.3: list/delete/rename/export/import templates
├── graylog/                # Single HTTP-client layer (auth, errors, normalize)
├── services/               # Per-domain Graylog API helpers used by build()s
├── pipeline-dsl/           # Structured-intent → rule-source compiler + lint
├── clustering/             # Pluggable clustering subsystem (Drain3 built in)
├── widget-templates/       # Object.freeze'd 8-builder registry for dashboards
├── query.js                # v2.3: Elasticsearch query string + search client
├── timerange.js            # v2.3: relative/absolute time-range parsing
├── aggregations.js         # v2.3: 4 histogram strategies + field aggregations
├── saved-searches.js       # v2.3: ~/.graylog-mcp/saved-searches.json
└── events.js               # v2.3: Graylog events/alerts wrappers
```

Why this layout:

- **`tools.js` separate from handlers.** A startup `assertAllToolsRegistered` walks `tools.js`
  against the dispatch Map so a mismatch fails the process before stdio connects. Catalogue
  drift becomes impossible.
- **Per-domain subdirectories under `src/tools/<domain>/`.** Adding the 9th input tool or the 4th
  role tool doesn't grow `src/index.js`. Each domain owns its schemas and barrel; the central
  `_register.js` stays the single source of wiring.
- **`_shared/` is factory-only.** No tools register here. Every cross-cutting concern
  (dryRun default, writable gate, confirmation hash, error wrapping) is in one place so the
  invariants apply uniformly — a new domain author cannot accidentally bypass them.
- **`graylog/` isolates the wire.** All axios goes through `makeClient(conn).request(...)`. The
  writable-flag defense and the bodyless-request discipline (Graylog 7.x rejects literal `null`
  bodies) live at one site, not many.
- **`pipeline-dsl/`, `clustering/`, `widget-templates/` are first-class subsystems.** Each has its
  own internal contract (DSL emit grammar, strategy interface, frozen builder registry) and is
  composed by the handlers that need them — but their internal complexity is isolated from the
  rest of the tree.
