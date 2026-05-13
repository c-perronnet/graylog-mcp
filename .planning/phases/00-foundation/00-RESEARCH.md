# Phase 0: Foundation - Research

**Researched:** 2026-05-13
**Domain:** Node MCP server foundation primitives — dispatch Map, single HTTP client, mutating-handler factory, zod adoption, snapshot test infra, response normalizer (Graylog 7.2 admin-surface milestone)
**Confidence:** HIGH on architectural shape and locked decisions; HIGH on version pins (verified against npm registry on 2026-05-13); HIGH on Graylog parse/simulate endpoints (verified against local Graylog 7.2 Java source at `source-code/graylog2-server/.../RuleResource.java`)

## Summary

Phase 0 is a brownfield refactor + scaffolding phase. No new MCP tools ship. Instead, six cross-cutting primitives are built — and proven against the existing v2.3 read-side tool surface — so that every subsequent admin domain can ship its first mutating tool without reinventing dry-run, validation, idempotency, list-projection, or response-normalisation infrastructure. The 13 FOUND requirements decompose cleanly: three are infrastructure (FOUND-01 dispatch, FOUND-02 client, FOUND-06 engines/`npm test`); five are mutating-tool primitives that ship as code-with-tests but are exercised only by fixture handlers in this phase (FOUND-03/04/08/09/10/11/12); two are policy-level (FOUND-05 zod adoption pattern, FOUND-13 naming convention); FOUND-07 is the snapshot test infrastructure itself (5–10 fixture tests proving the harness).

The brownfield risk is real: regression against v7.2 read-side behaviour is the most likely silent bug. Mitigation is a pre/post snapshot test for each existing read tool that captures the current emitted Graylog payload (the JSON the read handler POSTs to `/api/views/search/sync`) and reasserts the same payload after the refactor. This is cheaper than mocking response shapes and catches the only thing the refactor can actually break: payload drift.

**Primary recommendation:** Execute the dispatch Map refactor as a "build new alongside, flip atomically" migration (Approach A in Q1 below) — do not interleave per-tool migration with dispatch construction. Land the snapshot harness first (FOUND-07 framework) so the read-side regression net exists before FOUND-01 fires.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Runtime:**
- **D-01:** Bump `engines.node` to `>= 22.3.0`. The `node:test` `t.snapshot()` API is stable on Node 22, so no `--experimental-test-snapshots` flag is needed anywhere. This is the recommended floor — Node 20 fallback was offered and rejected.
- **D-02:** Fix the broken `npm test` script as part of Phase 0 so `node:test` actually runs the full unified suite (existing + new).

**Tool naming (existing v2.3 surface):**
- **D-03:** Apply the `<verb>_<domain>_<noun>` convention to **all** existing v2.3 tool names — hard rename, not aliases. Breaking change for any MCP client that hardcodes the old names. The planner enumerates the full rename map. Examples of likely renames:
  - `fetch_graylog_messages` → `search_messages_graylog` (or `list_messages_graylog`)
  - `get_log_histogram` → `get_histogram_messages` (or similar)
  - `save_search` → `create_saved_search`; `list_saved_searches` → `list_saved_searches` (already fits); `delete_saved_search` → `delete_saved_search` (fits)
  - `use_connection` → `set_active_connection`; `list_connections` → `list_connections` (fits)
  - `cluster_log_messages` → `cluster_messages_logs` (or keep — already fits the pattern reasonably)
  - The planner produces the authoritative list, including a deprecation/migration note in CHANGELOG.
- **D-04:** Bump the package's major version (3.0.0) on release of this milestone — the rename is breaking.

**Test migration:**
- **D-05:** Migrate all four existing test-*.js scripts to `node:test` in Phase 0:
  - `test-clustering.js` — most complex, uses `_setSearchOverride()` test seam
  - `test-features.js` — time-range + aggregation payload tests
  - `test-aggregation-fixes.js` — aggregation payload structural tests
  - `test-histogram-fixes.js` — histogram-specific payload shapes
  Result: `npm test` invokes one runner, runs everything. Two-runner footprint is rejected.
- **D-06:** Snapshot fixtures live under `test/__snapshots__/` (the `node:test` default location); checked into git; reviewed via diff on each PR.

**Connection safety model:**
- **D-07:** Add an optional `writable: boolean` field to each connection in `~/.graylog-mcp/config.json` (or override path):
  - Defaults to `true` when the field is absent (backward-compatible with all existing configs).
  - When `false`, `defineMutatingHandler` short-circuits **before** building the Graylog request and returns a structured `{ isError: true, content: [...], reason: "connection_read_only" }`.
  - The per-call `dryRun: true` default is the first safety layer; `writable: false` is the second, complementary, defence-in-depth layer.
- **D-08:** The active-connection global state stays as-is for now (process-global `let activeConnection`). The per-call `connectionName` argument (FOUND-09) plus the new `writable` flag are the explicit answers to the existing-codebase concern about singleton connection state.

### Claude's Discretion

- **Discretion-01:** Exact module layout for `src/dispatch.js` and how it integrates with the existing `src/index.js` dispatch chain (the requirement specifies a Map; mechanics are open).
- **Discretion-02:** Exact shape of the `defineMutatingHandler({build, apply})` factory contract (return signature, error wiring, idempotency-key generation seam). Should follow the existing `errorResponse(text)` helper precedent for error shapes.
- **Discretion-03:** Where `src/services/<domain>.js` modules live and whether Phase 0 includes any service stubs (research recommends "no service stubs in Phase 0" — defer to the planner).
- **Discretion-04:** Whether snapshot-test review uses a script-level allowlist for "auto-accept on first run" or strictly fails until a human accepts. Default to strict.
- **Discretion-05:** zod schema co-location: `src/tools/<domain>/schemas.js` vs inline per-tool. Research recommends per-domain `schemas.js`; planner confirms.
- **Discretion-06:** How the dispatch startup assertion ("every name in tools.js has a registered handler") logs / throws — assertion error vs structured startup-log entry.

### Deferred Ideas (OUT OF SCOPE)

- **Connection-level role discovery / 403 surfacing UX** — the existing model is "Graylog returns 403; we surface it." Better UX (auto-detect token's effective role on `use_connection`, warn proactively) was not discussed and is not in scope.
- **Auto-discovery / OpenAPI-style codegen of admin endpoints** — the research recommended hand-rolled per-endpoint shapes.
- **`activeConnection` singleton refactor to a context object** — concession captured in D-08; deeper refactor is deferred.
- **Snapshot-test auto-acceptance script** (Discretion-04) — if review friction proves real, a follow-up could add a `npm test -- --update-snapshots` flow. Default is strict for Phase 0.
- **Existing-tool naming aliases** — explicitly rejected (D-03).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FOUND-01 | Dispatch refactor — Map<toolName, handler> in `src/dispatch.js`; startup assertion every tools.js entry has a handler | Q1: "build alongside, flip atomically" migration; Anti-Pattern 2 in ARCHITECTURE.md; current dispatch shape verified at `src/index.js:38-103` |
| FOUND-02 | Single Graylog HTTP client at `src/graylog/client.js` with auth, X-Requested-By, typed error mapping for 400/403/404/409/422 | Q3: client signature; precedent at `src/query.js:99-123`; M2 response-shape inventory in PITFALLS.md |
| FOUND-03 | `defineMutatingHandler` factory enforcing `dryRun: true` default + build/apply split | Q2: contract spec; Q3 in ARCHITECTURE.md; Anti-Pattern 4 prevention |
| FOUND-04 | `runOrPreview` helper with `__SERVER_ASSIGNED__` ID sentinels in dry-run preview | Q2 contract; C6 in PITFALLS.md |
| FOUND-05 | Adopt `zod ^3.25.76`; establish per-domain `schemas.js` co-location pattern | Q4: dual-validation strategy; STACK.md decision; ARCHITECTURE.md Pattern 3 |
| FOUND-06 | Bump `engines.node` to `>= 22.3.0`; fix broken `npm test` | D-01 (locked); current package.json line 44 verified |
| FOUND-07 | Snapshot test infrastructure proven with 5–10 fixture tests | Q7: snapshot harness shape; D-06 location; Node 22 `t.snapshot` stability |
| FOUND-08 | Cross-cutting response normalizer returning `{ id, body }` regardless of create-response shape | Q3 client error mapping; PITFALLS.md M2 inventory of 10 create-response variants |
| FOUND-09 | Per-call `connectionName` arg with singleton fallback on every mutating tool's zod schema | Q8 in ARCHITECTURE.md (already settled); D-08 reinforces; existing read tools unchanged |
| FOUND-10 | Idempotency-key mechanism — auto-generated from hash(connectionName, toolName, args) | Q5: sha-256, normalised args, client-side only (Graylog 7.2 does not support `Idempotency-Key` header); M4 in PITFALLS.md |
| FOUND-11 | Create-conflict pre-check pattern — `existingMatches` field in every create tool's dry-run output | M5 in PITFALLS.md; Q6 list-projection helper enables the cheap pre-check |
| FOUND-12 | List-projection helper — default narrow `id, title, description` + default `limit: 25` | Q6: `defineListHandler` factory; M6 in PITFALLS.md |
| FOUND-13 | Tool-naming convention `<verb>_<domain>_<noun>` documented and enforced | Q9: enumerated rename map; D-03 (locked); M7 in PITFALLS.md |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

**No project-level `CLAUDE.md` exists in this repository.** Verified by directory listing — only `.planning/CLAUDE.md`-style instructions live inside the GSD planning tree, not at the project root. Project-wide directives therefore come entirely from `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/codebase/CONVENTIONS.md`, and the locked CONTEXT.md decisions above.

For convenience, the conventions the planner MUST honour are restated here (derived from `.planning/codebase/CONVENTIONS.md`):

- **ESM only.** No CJS, no default exports — every new module uses named exports with `.js` extensions on relative imports.
- **Naming.** Files kebab-case; functions camelCase; tool handlers prefixed `handle*`; payload builders prefixed `build*`; module constants SCREAMING_SNAKE_CASE; MCP tool names snake_case; test-only/private exports leading `_`.
- **Async style.** `async`/`await` everywhere; no callbacks; no `.then()` chaining. Every tool handler is `async` (even those that don't await).
- **Error shape.** Single canonical MCP error: `{ isError: true, content: [{ type: "text", text: "..." }] }`. New `defineMutatingHandler` MUST reuse this exact shape (Discretion-02 confirms).
- **Default args via `??` at call sites**, not via JSON-Schema defaults (schema defaults are documentation-only in this codebase).
- **`node:` prefix for built-ins** in new files (`node:crypto`, `node:test`, `node:assert/strict`). Existing files without the prefix are not retrofitted unless touched.
- **Test seams via underscore-prefixed exports** (`_clearForTests`, `_setSearchOverride`, `_testConnection`). New Phase 0 modules can introduce seams without apology — it is the project's standard.
- **No linter/formatter configured.** Indentation is 4 spaces. Maintain visual consistency with existing files.

## Architectural Responsibility Map

This phase is back-end / dispatch-layer infrastructure. No frontend, no browser, no rendered HTML — the MCP transport is stdio JSON-RPC. The "tier" mapping for Phase 0 is therefore process-internal:

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| MCP transport / lifecycle | Process entry (`src/index.js`) | — | Sole owner of stdio transport + `Server` instance; no change in Phase 0 |
| Tool name → handler resolution | Dispatch (`src/dispatch.js`, NEW) | Process entry | Map lookup replaces if-chain; index.js calls dispatch.dispatch(request) |
| Request shape validation | Handler wrapper (`src/tools/_shared/handler.js`, NEW) | Domain schemas (`src/tools/<domain>/schemas.js`) | zod.parse runs first inside wrapper; failure → errorResponse |
| Connection resolution + writable check | Handler wrapper | Connection registry (`src/config.js`, modified for D-07) | Resolver lives in `_shared/connection.js`; consumes config |
| HTTP request build (preview) | Service builder (deferred — Phase 1+) | — | Phase 0 ships the helper shape, no domain services yet |
| HTTP transport | HTTP client (`src/graylog/client.js`, NEW) | Auth (`src/graylog/auth.js`, NEW), error map (`src/graylog/errors.js`, NEW) | Single axios call site; existing `searchGraylog` keeps working unchanged |
| Response normalisation `{ id, body }` | Response normaliser (`src/graylog/normalize.js`, NEW) | HTTP client | Called by mutating-tool handlers after apply; pure function |
| Idempotency-key generation | Dispatch wrapper or handler wrapper | crypto (`node:crypto`) | sha-256 over canonical args; default-on when caller omits |
| List projection | List-handler factory (`src/tools/_shared/list.js`, NEW) | — | Wraps any list tool to enforce default fields + limit |
| Snapshot test harness | Test infrastructure (`test/__snapshots__/`, NEW) | `node:test` | Files live under repo `test/`; runner is `node --test` |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | `^1.18.0` (keep) | MCP server framework | Already in use; current latest is `1.29.0` per `npm view` (2026-05-13). Bumping is out of scope for Phase 0 — research-flagged for a future phase since `McpServer.registerTool` (newer API) would simplify dispatch further but conflicts with the locked "minimal-blast-radius refactor" goal. **[VERIFIED: npm registry 2026-05-13]** |
| `axios` | `^1.12.2` (keep) | HTTP client to Graylog | Existing dep; admin endpoints have no multipart needs; X-Requested-By auth pattern already baked in at `src/query.js:104`. **[CITED: STACK.md]** |
| `zod` | `^3.25.76` (already declared, adopt) | Schema validation | Already in `package.json:38`; current installed version verified against registry. **Do NOT upgrade to v4** — MCP SDK 1.18.0 uses zod v3 internally; dual-major in tree is the risk. **[VERIFIED: npm view zod@^3.25.76 returns 3.25.76; MCP SDK issue #1429 confirms v4 incompatibility with SDK <1.18.x]** |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:test` | built-in (Node ≥18.17.0; **stable `t.snapshot()` on Node 22**) | Test runner + snapshot assertions | All new tests + 4 migrated scripts (D-05). **[VERIFIED: Node 22 docs at nodejs.org/docs/latest-v22.x/api/test.html — `t.assert.snapshot()` is stable, no flag needed]** |
| `node:assert/strict` | built-in | Strict-equal assertions | Existing tests already use it; new tests keep the pattern. |
| `node:crypto` (`createHash`) | built-in | Idempotency-key sha-256 hash | FOUND-10. **[VERIFIED: import in src/clustering/preprocess.js uses node:crypto pattern]** |
| `c8` | `^11.0.0` (devDep, NEW — bump from STACK.md's 10.x recommendation) | Coverage report | Optional for Phase 0; Phase 7 audit consumer. **[VERIFIED: npm view c8 version → 11.0.0 on 2026-05-13]** — bump from `^10.1.3` recommendation in STACK.md since the major rev happened after that doc was written. Coverage adoption is not blocking for FOUND-07. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Map-based dispatch | Object literal `{ name: handler }` | Map preserves insertion order, allows runtime registration, has explicit `.has()` semantics. Object literal works but encourages all-at-once registration; less suitable for per-domain self-registration. STACK.md/ARCHITECTURE.md prefer Map. **[CITED: ARCHITECTURE.md Q2]** |
| zod v3 | zod v4 | v4 has better discriminated unions, native `z.toJSONSchema()`, faster. Rejected because MCP SDK 1.18.0 imports `zod/v4` internally only in SDK ≥1.20.x. With our pinned `^1.18.0`, dual-major risk is real. Re-evaluate when SDK bump lands. **[CITED: MCP SDK issue #1429]** |
| Hand-roll dispatch + handler factory | `McpServer.registerTool` from MCP SDK 1.18+ | The newer `McpServer` API takes a Zod schema directly. Would simplify the dispatch story significantly but requires migrating away from the current low-level `Server` + `setRequestHandler(CallToolRequestSchema)` pattern at `src/index.js:25-104`. **Out of scope for Phase 0** — too large a footprint for the milestone's first phase. Flag for Phase 7 hardening. **[CITED: typescript-sdk docs/server.md]** |
| `zod-to-json-schema` package | Hand-keep dual JSON-Schema in `tools.js` + zod in `schemas.js` | Maintainer announced sunset Nov 2025; v4 native `z.toJSONSchema()` is the replacement. Since we're on zod v3, neither is available. **Phase 0 keeps dual sources of truth**, accepts the drift risk, mitigates via Phase 7 audit. **[VERIFIED: WebSearch 2026-05-13 — zod-to-json-schema readme states v3 mode "no longer actively maintained"; npm version 3.25.2 still installable]** |
| `t.snapshot()` in `node:test` | `jest --snapshot` | Adds 9 MB of dep tree for a Node-CLI tool; module-mocking philosophy clashes with existing underscore-seam test pattern. **[CITED: STACK.md decision 5]** |

**Installation:**

```bash
# No production deps to install — zod already in package.json
# Dev dep is optional this phase:
npm install -D c8@^11.0.0
```

**Version verification (run by planner at install time):**

```bash
npm view zod@^3.25.76 version   # → 3.25.76 (verified 2026-05-13)
npm view @modelcontextprotocol/sdk version   # → 1.29.0 latest; we pin to ^1.18.0
npm view c8 version             # → 11.0.0 (verified 2026-05-13)
npm view axios version          # → 1.12.2+ (existing pin holds)
```

## Architecture Patterns

### System Architecture Diagram (Phase 0 dispatch + foundation primitives)

```
                    ┌──────────────────────────────┐
                    │ MCP Client (Claude/Agent)    │
                    └──────────────┬───────────────┘
                                   │ stdio JSON-RPC
                                   ▼
                    ┌──────────────────────────────┐
                    │ src/index.js                 │
                    │ Server + StdioTransport      │ ◄── no logic change in P0
                    │ setRequestHandler(CallTool)──┼──► dispatch.dispatch(req)
                    └──────────────┬───────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │ src/dispatch.js (NEW)        │
                    │ Map<name, handler>           │ ◄── FOUND-01
                    │ + startup assertion          │     FOUND-13 enforcement
                    └──────────────┬───────────────┘
                                   │ handlers.get(name)
                                   ▼
            ┌──────────────────────────────────────────────────┐
            │ Existing read handlers (UNCHANGED behaviour)     │
            │   - fetchGraylogMessages, getLogHistogram, ...   │ ◄── routed via Map
            │   - handleClusterLogMessages, ...                │     in Phase 0
            │   - handleListTemplates, ...                     │
            └──────────────────────────────────────────────────┘
                                                  ⋮
                  ▼ (used by domain phases starting Phase 1)
            ┌──────────────────────────────────────────────────┐
            │ src/tools/_shared/handler.js                     │  FOUND-03/04/09
            │ defineMutatingHandler({                          │
            │   name, schema, build, apply, summarize          │
            │ })                                               │
            │ ┌──────────────────────────────────────────────┐ │
            │ │ 1. schema.parse(args)        → zod (FOUND-05)│ │
            │ │ 2. resolveConnection(args)   → name + writable│ │
            │ │ 3. if (!conn.writable) → read_only error     │ │
            │ │ 4. idempotencyKey = hash(...) (FOUND-10)     │ │
            │ │ 5. req = build(args)                         │ │
            │ │ 6. if dryRun: return preview + token         │ │
            │ │ 7. apply(client, req) → response             │ │
            │ │ 8. normalize.toIdBody(response) (FOUND-08)   │ │
            │ └──────────────────────────────────────────────┘ │
            └──────────────────┬───────────────────────────────┘
                               │ uses
                               ▼
            ┌──────────────────────────────────────────────────┐
            │ src/graylog/client.js (NEW)                      │  FOUND-02
            │ makeClient(conn).request(method, path, body)     │
            │   ├── auth.js: Basic auth header                 │
            │   ├── errors.js: 400/403/404/409/422 → typed     │
            │   └── normalize.js: { id, body } from any 2xx    │
            └──────────────────────────────────────────────────┘

            ┌──────────────────────────────────────────────────┐
            │ src/tools/_shared/list.js (NEW)                  │  FOUND-12
            │ defineListHandler({ schema, fetch, projection }) │
            │   default fields: ['id','title','description']   │
            │   default limit:  25                             │
            └──────────────────────────────────────────────────┘

            ┌──────────────────────────────────────────────────┐
            │ test/                                            │  FOUND-07
            │ ├── __snapshots__/                               │  D-06
            │ ├── dispatch.test.js                             │
            │ ├── handler.test.js  (defineMutatingHandler)     │
            │ ├── list.test.js     (defineListHandler)         │
            │ ├── graylog-client.test.js                       │
            │ ├── normalize.test.js                            │
            │ ├── existing/  (4 migrated test-*.js → here)     │  D-05
            │ └── regression/  (read-tool payload snapshots)   │
            └──────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Owns | Calls |
|-----------|------|-------|
| `src/index.js` | Server + transport wiring; no dispatch logic after refactor | `dispatch.dispatch(request)` |
| `src/dispatch.js` | `register(name, handler)`, `dispatch(request)`, `assertAllToolsRegistered()` | Registered handler functions |
| `src/graylog/client.js` | `makeClient(conn).request(method, path, body)`; single axios call site | `graylog/auth.js`, `graylog/errors.js`, `axios` |
| `src/graylog/auth.js` | Basic-auth header builder (token-as-username) | nothing |
| `src/graylog/errors.js` | Map 400/403/404/409/422 → `GraylogValidationError`/`PermissionError`/`NotFoundError`/`ConflictError`/`UnprocessableError` | nothing |
| `src/graylog/normalize.js` | `toIdBody(response, { idLocations })` → `{ id, body }` from any of 10 known shapes | nothing |
| `src/tools/_shared/handler.js` | `defineMutatingHandler({ schema, build, apply, summarize })` factory | `connection.js`, `dry-run.js`, `errors.js`, `idempotency.js` |
| `src/tools/_shared/list.js` | `defineListHandler({ schema, fetch, projection })` — projection + limit defaults | `connection.js` |
| `src/tools/_shared/dry-run.js` | `runOrPreview(req, { dryRun })`; `__SERVER_ASSIGNED__` sentinel substitution | nothing |
| `src/tools/_shared/idempotency.js` | `deriveKey({ connectionName, toolName, args })` → sha-256 hex; canonical arg normalisation | `node:crypto` |
| `src/tools/_shared/connection.js` | `resolveConnection(args)` → `{ conn, name, writable } \| { error }` | `src/config.js` |
| `src/tools/_shared/errors.js` | `errorResponse(text)`, `wrapGraylogError(err)`, `formatZodError(err)` | nothing |
| `src/config.js` (modified) | Parse `writable: boolean` from connection config; expose `getConnectionWritable(name)` | `node:fs` |
| `test/__snapshots__/` | Checked-in snapshot fixture files | — |

### Recommended Project Structure

```
src/
├── index.js                    # MCP transport wiring (slimmed; ~150–200 LOC after P0)
├── tools.js                    # Tool catalogue (existing renames applied per D-03)
├── config.js                   # Connection registry + `writable` field parsing (D-07)
│
├── dispatch.js                 # NEW — Map<name, handler> + assertion (FOUND-01)
│
├── graylog/                    # NEW — single HTTP client layer (FOUND-02, FOUND-08)
│   ├── client.js
│   ├── auth.js
│   ├── errors.js
│   └── normalize.js
│
├── tools/
│   ├── _shared/                # NEW — cross-cutting handler helpers
│   │   ├── handler.js          # defineMutatingHandler (FOUND-03/04/09)
│   │   ├── list.js             # defineListHandler (FOUND-12)
│   │   ├── connection.js       # resolveConnection (D-07, D-08)
│   │   ├── dry-run.js          # runOrPreview + sentinel (FOUND-04)
│   │   ├── idempotency.js      # deriveKey (FOUND-10)
│   │   ├── conflict.js         # existingMatches helper (FOUND-11)
│   │   ├── errors.js           # errorResponse, wrapGraylogError, formatZodError
│   │   └── schemas.js          # cross-cutting shared zod schemas (connectionName, dryRun, idempotencyKey)
│   ├── cluster-errors.js       # existing — unchanged
│   └── template-mgmt.js        # existing — unchanged
│
├── (existing modules unchanged: query.js, timerange.js, aggregations.js,
│   saved-searches.js, events.js, clustering/)

test/                           # NEW directory — node:test home (D-05, D-06)
├── __snapshots__/              # D-06: checked-in fixtures
│   ├── dispatch.test.js.snapshot
│   ├── handler.test.js.snapshot
│   ├── normalize.test.js.snapshot
│   └── regression/             # read-tool payload snapshots (pre/post refactor)
├── dispatch.test.js
├── handler.test.js             # defineMutatingHandler (5–10 fixture tests, FOUND-07)
├── list.test.js                # defineListHandler
├── graylog-client.test.js      # axios mock; error mapping
├── normalize.test.js           # 10 create-response variants → { id, body }
├── idempotency.test.js         # hash stability + canonical args
├── connection.test.js          # writable=false short-circuit
├── existing/                   # D-05: migrated test-*.js scripts live here
│   ├── clustering.test.js      # from test-clustering.js (308 lines → ~6 tests)
│   ├── features.test.js        # from test-features.js (135 lines → ~4 tests)
│   ├── aggregation-fixes.test.js
│   └── histogram-fixes.test.js
└── regression/
    └── read-tools.test.js      # payload snapshots: pre-refactor capture, post-refactor diff
```

### Pattern 1: Dispatch Map with Self-Registration

**What:** Domain modules `import { register } from "../../dispatch.js"` and call `register(name, handler)` at module-top side-effect time. `dispatch.js` exposes `dispatch(request)` for `index.js` to call.

**When to use:** Every tool — read, mutating, blueprint — registers exactly once. Phase 0 migrates existing read tools to this pattern with no behaviour change.

**Example (Phase 0 shape, before any domain phase ships mutating tools):**

```js
// src/dispatch.js
const handlers = new Map();

export function register(name, handler) {
    if (handlers.has(name)) {
        throw new Error(`Tool already registered: ${name}`);
    }
    handlers.set(name, handler);
}

export function dispatch(request) {
    const name = request.params?.name;
    const fn = handlers.get(name);
    if (!fn) {
        // Match the existing src/index.js:103 throw exactly so observable
        // behaviour does not change.
        throw new Error(`Tool not found: ${name}`);
    }
    return fn(request);
}

// Called from src/index.js after all imports
export function assertAllToolsRegistered(toolDefinitions) {
    const missing = toolDefinitions
        .map(t => t.name)
        .filter(name => !handlers.has(name));
    if (missing.length > 0) {
        // Discretion-06: prefer hard throw at startup over silent log.
        // A misconfigured dispatch is a deploy-time bug, not a runtime quirk.
        throw new Error(
            `Dispatch assertion failed — tools in tools.js without registered handlers: ${missing.join(", ")}`
        );
    }
}

// src/index.js (after refactor)
import { dispatch, assertAllToolsRegistered } from "./dispatch.js";
import { toolDefinitions } from "./tools.js";
import "./tools/_register.js"; // single import that runs every register() side-effect

assertAllToolsRegistered(toolDefinitions);
server.setRequestHandler(CallToolRequestSchema, dispatch);
```

**Source:** ARCHITECTURE.md Q2 + verified against `src/index.js:38-104` current shape.

### Pattern 2: defineMutatingHandler Factory Contract (FOUND-03/04/09/10)

**What:** A factory wraps every mutating tool with: zod validation → connection resolution → writable check → idempotency-key derivation → build (pure) → dry-run-or-apply branch → response normalisation.

**When to use:** Every tool whose effective HTTP method is not GET. Phase 0 ships the factory + tests; domain phases (1+) consume it.

**Concrete signature (informs planner — not greenfield API design, derived from existing handler patterns):**

```js
// src/tools/_shared/handler.js
import { z } from "zod";
import { resolveConnection } from "./connection.js";
import { runOrPreview } from "./dry-run.js";
import { deriveIdempotencyKey } from "./idempotency.js";
import { errorResponse, wrapGraylogError, formatZodError } from "./errors.js";
import { makeClient } from "../../graylog/client.js";

/**
 * @param {object} spec
 * @param {string} spec.name                    Tool name (snake_case, for hash + error context)
 * @param {z.ZodObject} spec.schema             Zod schema for full args including dryRun, connectionName, idempotencyKey
 * @param {(args) => RequestDescriptor} spec.build       Pure function: args → { method, path, body, summary }
 * @param {(client, req) => Promise<any>} spec.apply     Effectful function: posts via client.request
 * @param {(args, req) => string} [spec.summarize]       One-line preview summary; defaults to `${req.method} ${req.path}`
 * @returns {(request) => Promise<MCPResponse>}
 */
export function defineMutatingHandler(spec) {
    const { name, schema, build, apply, summarize } = spec;

    return async function handler(request) {
        // 1. Validate input
        let args;
        try {
            args = schema.parse(request.params?.arguments ?? {});
        } catch (err) {
            return errorResponse(formatZodError(err));
        }

        // 2. Resolve connection (singleton OR per-call connectionName per FOUND-09)
        const { conn, name: connectionName, error } = resolveConnection(args);
        if (error) return error;

        // 3. Writable gate (D-07): short-circuit BEFORE building request
        if (conn.writable === false) {
            return {
                isError: true,
                reason: "connection_read_only",
                content: [{
                    type: "text",
                    text: `Connection "${connectionName}" is marked read-only (writable: false). Refusing ${name}.`,
                }],
            };
        }

        // 4. Idempotency key — auto-derive if absent (FOUND-10)
        const idempotencyKey = args.idempotencyKey
            ?? deriveIdempotencyKey({ connectionName, toolName: name, args });

        // 5. Build request descriptor (pure — guarantees preview ≡ apply payload)
        const req = build(args);

        // 6. Dry-run-or-apply branch (FOUND-03/04)
        const dryRun = args.dryRun ?? true; // default-true enforced ONCE, here
        if (dryRun) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        dryRun: true,
                        tool: name,
                        connection: connectionName,
                        idempotencyKey,
                        summary: summarize?.(args, req) ?? `${req.method} ${req.path}`,
                        preview: {
                            method: req.method,
                            path: req.path,
                            body: req.body,
                        },
                        // FOUND-04: tell agent which fields the server will fill
                        postApplyEstimate: req.postApplyEstimate
                            ?? { id: "__SERVER_ASSIGNED__" },
                        // FOUND-11: callable by build() if it does a list-pre-check
                        existingMatches: req.existingMatches ?? [],
                        applyHint: `Re-call with dryRun: false to apply`,
                    }),
                }],
            };
        }

        // 7. Apply
        try {
            const client = makeClient(conn);
            const raw = await apply(client, req);
            // FOUND-08: normalize to { id, body } regardless of Graylog's shape
            const { id, body } = req.normalize?.(raw) ?? { id: raw?.id, body: raw };
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        dryRun: false,
                        applied: true,
                        tool: name,
                        connection: connectionName,
                        idempotencyKey,
                        result: { id, body },
                    }),
                }],
            };
        } catch (err) {
            return wrapGraylogError(err, name);
        }
    };
}
```

**Schema convention (FOUND-05, FOUND-09):** Every mutating-tool schema MUST include:

```js
import { z } from "zod";
import { mutatingBase } from "../_shared/schemas.js";

export const CreateThingSchema = mutatingBase.extend({
    // domain-specific fields
    title: z.string().min(1),
    description: z.string().optional(),
});

// src/tools/_shared/schemas.js
export const mutatingBase = z.object({
    dryRun: z.boolean().default(true),
    connectionName: z.string().optional(),
    idempotencyKey: z.string().optional(),
});
```

**Source:** ARCHITECTURE.md Q3 + CONTEXT.md Discretion-02 + CONVENTIONS.md error shape at `src/tools/cluster-errors.js:12`.

### Pattern 3: List-Handler Factory (FOUND-12)

**What:** A second factory enforces narrow projection + default limit on every list tool.

```js
// src/tools/_shared/list.js
const DEFAULT_FIELDS = ["id", "title", "description"];
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

export function defineListHandler(spec) {
    const { name, schema, fetch } = spec;

    return async function handler(request) {
        let args;
        try { args = schema.parse(request.params?.arguments ?? {}); }
        catch (err) { return errorResponse(formatZodError(err)); }

        const { conn, name: connectionName, error } = resolveConnection(args);
        if (error) return error;

        const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
        const fields = args.fields === "all"
            ? null
            : (Array.isArray(args.fields) ? args.fields : DEFAULT_FIELDS);

        try {
            const client = makeClient(conn);
            const items = await fetch(client, { ...args, limit });
            const projected = fields ? items.map(it => projectItem(it, fields)) : items;
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        tool: name,
                        connection: connectionName,
                        count: projected.length,
                        limit,
                        fields: fields ?? "all",
                        items: projected,
                    }),
                }],
            };
        } catch (err) {
            return wrapGraylogError(err, name);
        }
    };
}

function projectItem(item, fields) {
    const out = {};
    for (const f of fields) {
        if (item[f] !== undefined) out[f] = item[f];
    }
    return out;
}
```

**Why a factory (over a `projectList()` utility called from each handler):** Same reason `defineMutatingHandler` is a factory and not a "remember to call `enforceDryRun()`" rule — the projection MUST be applied exactly once, and forgetting to call a helper in a new tool is the canonical foot-gun. The factory is the structural enforcement; a utility is a convention. FOUND-12 demands "every list tool respects this," which is a structural-enforcement requirement.

**Source:** PITFALLS.md M6 + ARCHITECTURE.md Pattern 2 generalised.

### Pattern 4: Graylog HTTP Client with Typed Errors (FOUND-02)

```js
// src/graylog/client.js
import axios from "axios";
import { buildAuth } from "./auth.js";
import { mapGraylogError } from "./errors.js";

export function makeClient(conn) {
    return {
        async request(method, path, body) {
            try {
                const res = await axios({
                    method,
                    url: `${conn.baseUrl}${path}`,
                    data: body,
                    headers: {
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                        "X-Requested-By": "graylog-mcp",
                        ...buildAuth(conn.apiToken),
                    },
                    validateStatus: () => true, // we map ourselves
                    timeout: 60_000, // 60s default per STACK.md Q4 guidance
                });
                if (res.status >= 400) throw mapGraylogError(res, { method, path });
                return res.data;
            } catch (err) {
                if (err.isGraylogError) throw err;
                // Network-level failure
                throw new Error(`Graylog ${method} ${path} failed: ${err.message}`);
            }
        },
    };
}
```

```js
// src/graylog/errors.js — typed-error mapping (FOUND-02 requires 400/403/404/409/422)
export class GraylogError extends Error {
    constructor(message, { status, method, path, body }) {
        super(message);
        this.isGraylogError = true;
        this.status = status;
        this.method = method;
        this.path = path;
        this.body = body;
    }
}
export class GraylogValidationError extends GraylogError { kind = "validation"; }
export class GraylogPermissionError extends GraylogError { kind = "permission"; }
export class GraylogNotFoundError extends GraylogError { kind = "not_found"; }
export class GraylogConflictError extends GraylogError { kind = "conflict"; }
export class GraylogUnprocessableError extends GraylogError { kind = "unprocessable"; }

export function mapGraylogError(res, ctx) {
    const Ctor =
        res.status === 400 ? GraylogValidationError :
        res.status === 403 ? GraylogPermissionError :
        res.status === 404 ? GraylogNotFoundError :
        res.status === 409 ? GraylogConflictError :
        res.status === 422 ? GraylogUnprocessableError :
        GraylogError;
    const msg = res.data?.message ?? res.statusText ?? `HTTP ${res.status}`;
    return new Ctor(msg, { ...ctx, status: res.status, body: res.data });
}
```

**Caching question (raised in objective Q3):** The research recommended caching `list_pipeline_functions` at connection-init for Phase 4 (PITFALLS.md C4). Phase 0 should NOT bake the cache layer into `makeClient()` — that conflates transport with domain caching. Recommendation: leave `makeClient()` cache-free; let Phase 4 introduce a `src/graylog/cache.js` or domain-level cache when the need is concrete. Premature caching has higher invalidation-bug risk than the latency it saves.

**Source:** STACK.md Q4 + ARCHITECTURE.md Q7 + PITFALLS.md M2 inventory.

### Pattern 5: Response Normaliser (FOUND-08)

Graylog 7.2's create-response shape inventory (from PITFALLS.md M2, verified against local source):

| Endpoint | Status | Body | Location header |
|----------|--------|------|-----------------|
| `POST /streams` | 201 | `{ stream_id }` | yes |
| `POST /streams/{streamId}/rules` | 201 | `{ streamrule_id }` | yes |
| `POST /system/inputs` | 201 | `{ id }` | yes |
| `POST /system/inputs/{inputId}/extractors` | 201 | `{ extractor_id }` | yes |
| `POST /system/indices/index_sets` | 200 | full `IndexSetResponse` (`id` inside) | no |
| `POST /events/definitions` | 200 | full `EventDefinitionDto` (`id` inside) | no |
| `POST /events/definitions/{id}/duplicate` | 200 | full DTO | no |
| `POST /views` | 200 | full `ViewDTO` (`id` inside) | no |
| `POST /system/pipelines/rule` | 200 | full `RuleSource` (`id` inside) | no |
| `PUT /system/inputs/{id}` | 201 | `{ id }` | yes |

Phase 0 ships `normalize.toIdBody(response, { idLocations })` accepting a list of where-to-look hints per endpoint and returning `{ id, body }` deterministically. The actual hint table per endpoint is filled in by each domain phase; Phase 0 provides the helper + tests for ≥3 of these shapes to prove correctness.

```js
// src/graylog/normalize.js
const ID_FIELDS_BY_ENDPOINT = {
    "POST /streams": ["stream_id"],
    "POST /streams/*/rules": ["streamrule_id"],
    "POST /system/inputs": ["id"],
    "POST /system/inputs/*/extractors": ["extractor_id"],
    "POST /system/indices/index_sets": ["id"],
    "POST /events/definitions": ["id"],
    "POST /views": ["id"],
    "POST /system/pipelines/rule": ["id"],
};

export function toIdBody(response, hint) {
    if (!response) return { id: null, body: null };
    const candidates = hint?.idFields ?? ["id"];
    for (const field of candidates) {
        if (response[field]) return { id: response[field], body: response };
    }
    return { id: null, body: response };
}
```

**Source:** PITFALLS.md M2; Java source files referenced in PITFALLS.md cross-checked for `StreamCreatedResponse(id)` etc.

### Anti-Patterns to Avoid

- **Per-handler `args.dryRun ?? true`** — one missed check is silent data loss. The factory enforces it once. (ARCHITECTURE.md Anti-Pattern 4)
- **Hand-encoded HTTP per endpoint** — duplicates auth + `X-Requested-By` 50× and recreates per-call bug surface. Use `client.request()`. (Anti-Pattern 3)
- **Cross-importing tool handlers** — handler-to-handler calls double-validate and double-dry-run. Use services in domain phases; in Phase 0 there are no domain services yet, so this is just a forward-looking guardrail. (Anti-Pattern 1)
- **Singleton-only connection state for mutating tools** — left in place via D-08 with `connectionName` arg as the answer; do NOT remove it, do NOT add a refactor.
- **Adding new branches to `src/index.js`'s if-chain** — the whole point of FOUND-01 is to delete that chain. (Anti-Pattern 2)
- **Snapshot tests that mock the entire Graylog response** — recreates the histogram-fallback scar tissue. Snapshot the **emitted payload** (what we POST), not Graylog's response. (PITFALLS.md "Anti-pattern to avoid")
- **Promoting any new module to `src/tools.js`/`src/index.js` flat layout** — every Phase 0 helper lives in `src/tools/_shared/` or `src/graylog/`. (CONVENTIONS.md scaling pattern)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Input validation | Ad-hoc `if (!args.foo) return errorResponse(...)` chains | `zod ^3.25.76` schemas (FOUND-05) | Discriminated unions, nested object validation, refinement; already a declared dep |
| JSON-Schema generation from zod | Hand-keep dual files | (Phase 0: hand-keep dual; flag for zod-v4 upgrade audit) | `zod-to-json-schema` is sunsetted; v4 native is the future. Accept duplication for one milestone. |
| Test runner | New `npm install -D vitest` | `node:test` (built-in) | Already on D-01 Node 22 floor; `t.snapshot()` stable; zero new dep |
| Snapshot diffing | Hand-rolled string compare | `t.assert.snapshot(value)` | Built into `node:test`; file format is `.snapshot` next to test; auto-generated on `--test-update-snapshots` |
| HTTP client | New `got` or `undici` adoption | `axios ^1.12.2` (keep) | Existing call site has auth + headers working; no admin endpoint needs streaming/SSE/multipart |
| Idempotency-key transport | Send `Idempotency-Key` header to Graylog | Client-side hash + list-then-match | Graylog 7.2 does NOT support an `Idempotency-Key` header (verified by repo search — no `IdempotencyKey` references in REST resources) — the entire mechanism is client-side per M4 in PITFALLS.md |
| DSL parsing/generation (Phase 4 territory; flagged here) | New `nearley`/`peggy`/`chevrotain` | Hand-written tagged-template helpers + `POST /system/pipelines/rule/parse` server pre-flight | STACK.md decision; parser generators need a build step the project doesn't have |
| Process supervisor / dispatch framework | New "tool dispatcher" library | Plain `Map<string, fn>` | 5 lines of code; ARCHITECTURE.md Q2 |
| Configuration parsing | New `convict`/`config` | Existing `JSON.parse(readFileSync(...))` in `src/config.js` | One additive optional field (`writable`) doesn't justify a config framework |

**Key insight:** This phase's stack is intentionally minimal — adopting one declared-but-unused dep (zod), adding one optional devDep (c8), and using the runtime's built-ins (`node:test`, `node:crypto`) for everything else. The single biggest risk is over-engineering the foundation; the locked decisions in CONTEXT.md (D-03 hard rename, D-05 unified runner, D-07 writable flag, D-08 singleton stays) all point the same direction: smallest blast radius that fixes the real problem.

## Runtime State Inventory

Phase 0 is partly a rename phase (D-03 hard rename of existing v2.3 tools), so a runtime-state audit is required.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | `~/.graylog-mcp/saved-searches.json` — saves named searches. Does it embed the OLD tool name (e.g. `fetch_graylog_messages`) anywhere? Inspecting `src/saved-searches.js` and how `get_saved_search` is implemented (referenced in `src/index.js` handlers): saved searches store query parameters, not tool names. Tool names are not stored. **Confirmed by reading `src/saved-searches.js` (62 lines) — store shape is `{ name, query, filters, timeRange, ... }`; tool name is implicit in which handler reads the store.** | None — verified |
| **Stored data** | `~/.graylog-mcp/templates/<connection>.json` — clustering templates persist per-connection. Connection NAMES (e.g. "prod") are file names, not connection types. Tool name is not stored. | None — verified |
| **Stored data** | `~/.graylog-mcp/config.json` — connection registry. Connection name strings persist; agent-saved connections will continue to work. The NEW `writable` field is purely additive (D-07). | None for existing connections; new `example-config.json` documents the new field |
| **Live service config** | No external services have admin-surface tool names embedded in their config — Graylog itself doesn't know our MCP tool names; the agent does. | None — verified |
| **OS-registered state** | No OS-level registration (no scheduled tasks, no systemd units, no pm2 processes) ships with this repo. The MCP server is invoked by an MCP client (Claude Desktop etc.) directly. | None — verified |
| **Secrets and env vars** | `GRAYLOG_CONFIG_PATH` is the only env var read (`src/config.js:8`). No `GRAYLOG_TOOL_*` style env var exists. No secrets reference tool names. | None — verified |
| **Build artifacts** | No build step (no TypeScript compile, no bundler — confirmed by `package.json` lacking a `build` script and the codebase being pure JS ESM). No `dist/`, no `*.egg-info`. The published npm package is `graylog-mcp-server@2.3.0` (per `package.json:3`). | The npm package on the registry, if ever published, would carry the old tool names. v3.0.0 publish (D-04) replaces it. Not Phase 0's problem — only at milestone-end publish time. |
| **Agent prompts / MCP clients** | The most important runtime state: **MCP client configurations on user machines reference tool names**. Claude Desktop's `claude_desktop_config.json` includes server `command`/`args` but not tool names; tool names enter the LLM's prompt at runtime when the agent lists tools. Hardcoded tool-name references in user prompts/agents WILL BREAK on rename. | CHANGELOG.md MUST enumerate every rename so users updating their agents can grep their conversation history. The migration note is part of FOUND-13 / D-03 deliverable. |
| **README / docs** | `README.md` mentions specific tools by name. `FUTURE_PLANS.md` does too. Both will go stale on rename. | Update README in same commit as the rename (planner schedules this; not a documentation-drift bug if done atomically). |
| **Existing test scripts** | The four `test-*.js` scripts reference handler function names (`handleClusterLogMessages`) but NOT tool names (`cluster_log_messages`) — they bypass dispatch by importing the handler directly. **Verified by `grep "cluster_log_messages" test-*.js` → no matches; only `handleClusterLogMessages` import.** Renames at the tool-name level therefore don't affect the migrated tests. | None for tool-name rename. Migration to `node:test` (D-05) is orthogonal. |

**Canonical question answered:** After every file in the repo is renamed and committed, what runtime systems still have the old string cached?
- **Locally:** only user-facing things — README, CHANGELOG, agent prompts, MCP client tool-references in chat history. No on-disk stored data is affected.
- **Externally:** any published npm version of the package; superseded by D-04 v3.0.0 bump.

## Common Pitfalls

### Pitfall 1: Read-Tool Regression on Dispatch Refactor (FOUND-01)
**What goes wrong:** After moving every read-tool branch from the `if (name === "...")` chain into the Map, one handler returns a slightly different payload (e.g. due to argument-passing order, or accidentally invoking through a new shim that re-stringifies). The agent observes a "shape changed" failure but the cause is subtle.
**Why it happens:** Mechanical refactors of large switch chains routinely introduce one bug per ~10 cases; the dispatch chain has ~22 cases.
**How to avoid:** **Pre/post regression snapshot tests for every read tool** (FOUND-07's first deliverable). Before touching `src/index.js`, run each existing read handler with a fixed fixture argument set and snapshot the result; after the refactor, re-run and diff. The diff MUST be empty.
**Warning signs:** Any non-empty snapshot diff is a hard failure; do not "update the snapshot." Investigate.

### Pitfall 2: Snapshot Indeterminism (FOUND-07)
**What goes wrong:** Snapshot contains a timestamp, `Date.now()`, a random idempotency key, or an object whose key order varies. Snapshots churn on every run; reviewers stop trusting them.
**Why it happens:** Dry-run preview includes `idempotencyKey` (FOUND-10) which is a hash — deterministic only if args are normalized identically. Time-derived fields leak in via fixtures.
**How to avoid:**
1. The `deriveIdempotencyKey` function MUST sort args by key before hashing and exclude any time-derived fields from the hash input (or accept them only via an explicit `_now` test-injection seam).
2. Snapshot serializer pins object-key order via `JSON.stringify(value, Object.keys(value).sort(), 2)` or equivalent.
3. Test files MUST inject deterministic clocks via `_now` or `Date.now` overrides — the underscore-seam pattern, just like the existing `_setSearchOverride`.

**Warning signs:** Snapshot files showing only key-order or whitespace diffs; idempotency keys differing run-to-run.

### Pitfall 3: zod / JSON-Schema Drift (FOUND-05)
**What goes wrong:** A new mutating tool adds a field in `tools.js` JSON-Schema but forgets it in the zod schema. The MCP SDK accepts the call; the zod parser rejects it; the agent sees a useless validation error.
**Why it happens:** Dual sources of truth for input schemas (see Q4 below).
**How to avoid:** A test (`test/schema-parity.test.js`) that for each tool name, asserts the set of declared JSON-Schema property keys equals the set of zod schema shape keys. Cheap to write, catches drift at commit time. Phase 0 doesn't ship any mutating tools so this test starts with a trivial allowlist; Phase 1 onward populates it.

### Pitfall 4: Writable-Flag Bypass via Service Layer (D-07)
**What goes wrong:** A future blueprint imports a service function directly (`createStream(client, args)`) bypassing `defineMutatingHandler` — the writable check never runs.
**Why it happens:** Services are designed to be called by handlers AND blueprints; the writable check lives in the wrapper.
**How to avoid:** Two-layer enforcement:
1. The wrapper checks `conn.writable === false` and short-circuits (Phase 0 implementation).
2. **`makeClient(conn)` ALSO inspects `conn.writable` and, if false, refuses non-GET requests with the same `connection_read_only` error.** This is defense-in-depth: even if a blueprint bypasses the wrapper, the client-layer refuses the write.

```js
// src/graylog/client.js (enhanced from Pattern 4 above)
export function makeClient(conn) {
    return {
        async request(method, path, body) {
            if (conn.writable === false && method !== "GET") {
                throw new GraylogError(
                    `Connection is read-only (writable: false). Refusing ${method} ${path}.`,
                    { status: 0, method, path, body: null }
                );
            }
            // ... existing axios call ...
        },
    };
}
```

**Warning signs:** A test that constructs a client with `writable: false` and asserts every non-GET method throws.

### Pitfall 5: Singleton Connection Race Across Dispatch Calls (D-08)
**What goes wrong:** Agent calls `use_connection prod`, then `create_stream` (Phase 1+) without `connectionName`. The mutating handler reads the singleton. Meanwhile the agent's next tool call switches to `staging` — but the in-flight `create_stream` is still bound to `prod`. With Node's single-threaded event loop this is mostly safe, BUT inside a single async handler, an `await` checkpoint can interleave with a `set_active_connection` from a parallel client request.
**Why it happens:** `let activeConnection` is module-scope mutable.
**How to avoid:** `resolveConnection(args)` MUST capture the active-connection NAME at the start of the handler (synchronously, before any `await`) and look up the config from `getConnections()[name]`, not from `getActiveConnectionConfig()` mid-handler. This pins the resolution to the moment the handler started.
**Warning signs:** Test that interleaves two handler invocations with a `set_active_connection` between them and asserts each call sees its captured connection.

### Pitfall 6: Existing 4 Test Scripts Aren't Independent of `console.log` Output
**What goes wrong:** Migrating `test-features.js` to `node:test`, the `console.log` "✓ ..." markers conflict with the test runner's reporter, producing noisy CI output.
**Why it happens:** The existing scripts use `console.log` as a poor man's reporter; `node:test` already prints test names + status.
**How to avoid:** Migration strips the `console.log` markers and uses `test("description", t => {...})` blocks. Each `✓` line in the script becomes one `test()` call. Net effect: same number of assertions, plus per-test isolation. See Q8 below for per-script breakdown.
**Warning signs:** Doubled output ("✓ time range tests passed" followed by node:test's own "ok 1 - ...").

## Code Examples

Verified patterns from official sources and the existing codebase:

### Example 1: node:test snapshot fixture for dry-run preview

```js
// test/handler.test.js
import { test } from "node:test";
import { defineMutatingHandler } from "../src/tools/_shared/handler.js";
import { z } from "zod";
import { mutatingBase } from "../src/tools/_shared/schemas.js";

const FooSchema = mutatingBase.extend({
    title: z.string().min(1),
});

const handler = defineMutatingHandler({
    name: "create_stream",
    schema: FooSchema,
    build: (args) => ({
        method: "POST",
        path: "/api/streams",
        body: { title: args.title, description: args.description ?? null },
    }),
    apply: async (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args, req) => `Create stream "${args.title}"`,
});

test("create_stream dry-run produces deterministic preview", async (t) => {
    const result = await handler({
        params: {
            arguments: {
                title: "App errors",
                connectionName: "_test", // resolved via _testConnection seam (Phase 1 wires this)
            }
        },
    });
    t.assert.snapshot(JSON.parse(result.content[0].text));
});

test("create_stream rejects empty title via zod", async (t) => {
    const result = await handler({
        params: { arguments: { title: "", connectionName: "_test" } },
    });
    t.assert.strictEqual(result.isError, true);
    t.assert.match(result.content[0].text, /title/);
});
```

The snapshot file (`test/__snapshots__/handler.test.js.snapshot`) — auto-generated on first run with `node --test --test-update-snapshots` — contains the byte-canonical dry-run JSON for review.

**Source:** [Test runner | Node.js v22.21.1 Documentation](https://nodejs.org/docs/latest-v22.x/api/test.html) — `t.assert.snapshot()` API.

### Example 2: Idempotency-key derivation (FOUND-10)

```js
// src/tools/_shared/idempotency.js
import { createHash } from "node:crypto";

/**
 * Canonical args projection: sort keys, drop excluded fields, drop undefined.
 * MUST be deterministic across runs of the same args.
 */
function canonicalize(args, { exclude = ["dryRun", "idempotencyKey"] } = {}) {
    if (Array.isArray(args)) return args.map(a => canonicalize(a));
    if (args && typeof args === "object") {
        const out = {};
        for (const key of Object.keys(args).sort()) {
            if (exclude.includes(key)) continue;
            if (args[key] === undefined) continue;
            out[key] = canonicalize(args[key]);
        }
        return out;
    }
    return args;
}

export function deriveIdempotencyKey({ connectionName, toolName, args }) {
    const material = JSON.stringify({
        connectionName,
        toolName,
        args: canonicalize(args),
    });
    return createHash("sha256").update(material).digest("hex").slice(0, 32);
}
```

**Hash choice (sha-256, not sha1 / blake3):**
- sha1 has known collision concerns and is not in Node built-ins as a recommended hash anymore.
- blake3 is not in `node:crypto`; requires a new dep.
- sha-256 is in `node:crypto`, fast enough (microseconds), and 32 hex chars (128 bits truncated) is collision-safe for the agent-retry-window detection use case.

**Why client-side only (no `Idempotency-Key` HTTP header sent to Graylog):** Verified by repository search — `grep -ri "IdempotencyKey\|Idempotency-Key" source-code/graylog2-server/` returns no matches in REST resource classes. Graylog 7.2 does not honour an `Idempotency-Key` header; the entire mechanism is the MCP wrapper's responsibility per PITFALLS.md M4 (list-then-match on a description tag like `[mcp:idem:abc123]`).

### Example 3: writable-flag config parsing (D-07)

```js
// src/config.js (additive only — does not change existing function signatures)
// ... existing imports and parsing ...

export function getConnectionWritable(name) {
    const conn = connections[name];
    if (!conn) return undefined;
    // Default true when absent — backward-compatible with all existing configs
    return conn.writable !== false;
}

// Existing functions unchanged; new export added.
```

```jsonc
// example-config.json (additive comment for users)
{
    "connections": {
        "prod": {
            "baseUrl": "https://graylog.example.com",
            "apiToken": "abc123",
            "writable": false   // Optional. Default: true. When false, all mutating tools refuse.
        },
        "staging": {
            "baseUrl": "https://staging.graylog.example.com",
            "apiToken": "def456"
            // No writable field → defaults to true, full mutation allowed.
        }
    }
}
```

### Example 4: Pre/post read-tool regression snapshot

```js
// test/regression/read-tools.test.js
import { test } from "node:test";
import { dispatch } from "../../src/dispatch.js";
import "../../src/tools/_register.js"; // self-registration

// For each existing read tool with a deterministic input, snapshot the response.
// Run BEFORE the dispatch refactor (capture); run AFTER (assert equality).
const fixtures = [
    {
        name: "list_connections",
        args: {},
    },
    {
        name: "list_streams",
        args: {},
        // streams call hits axios — gate with _testConnection seam OR axios mock
    },
    // ... 5–10 more fixtures, one per read tool ...
];

for (const fx of fixtures) {
    test(`regression: ${fx.name} payload unchanged after dispatch refactor`, async (t) => {
        const result = await dispatch({ params: { name: fx.name, arguments: fx.args } });
        t.assert.snapshot(result);
    });
}
```

The first run during the migration captures baseline snapshots from the OLD if-chain path (run before merging the dispatch.js change). The second run, against the new Map dispatch, MUST produce a byte-identical match. Diff = regression.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `if (name === "...")` long if-chain dispatch | `Map<name, handler>` with self-registration | Standard in MCP servers since 2024+; explicit in MCP SDK 1.20+ via `McpServer.registerTool` | We adopt the Map shape but not the SDK API (keeping `Server` + `setRequestHandler` due to scope) |
| `node:test` `--experimental-test-snapshots` flag on Node 20 | `t.assert.snapshot()` stable on Node 22 | Node 22.3+ marked stable | D-01 (Node ≥22.3.0) — no flag needed |
| zod v3 declared but unused | zod v3 adopted via `defineMutatingHandler` and per-domain `schemas.js` | This phase (FOUND-05) | One source of truth, two consumers (MCP SDK reads `tools.js` JSON-Schema; wrapper reads zod). Drift mitigated by parity test (Pitfall 3). |
| zod v3 with manual JSON-Schema co-export | zod v4 + `z.toJSONSchema()` native | Released 2025; SDK adoption pending | OUT OF SCOPE for this milestone; flag for follow-up. |
| `zod-to-json-schema` package | Native `z.toJSONSchema()` in zod v4 | Maintainer announced sunset Nov 2025 | Confirms "don't add `zod-to-json-schema` as a dep" — hand-keep parity in Phase 0. |
| `@modelcontextprotocol/sdk` v1.18 (existing) | v1.29 latest | Multiple minor releases through 2026-05 | Bump is its own audit; out of scope for Phase 0 |
| Standalone `test-*.js` scripts | `node --test` unified runner | Best practice since `node:test` stable | D-05 (migrate all 4) |

**Deprecated / outdated:**
- `--experimental-test-snapshots` flag — gone on Node 22 (stable).
- `zod-to-json-schema` package — sunsetted Nov 2025 per maintainer.
- Singleton-only connection state — kept (D-08) but documented as a transitional state; deeper refactor deferred.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Existing read-tool handlers produce byte-deterministic output when given fixed inputs (i.e., they don't include `Date.now()` or random IDs in their default responses) | Pitfall 1 / Example 4 | Pre/post regression snapshots are meaningless. **Mitigation:** Use the existing test seams (`_setSearchOverride`, `_testConnection`) and inject a frozen clock if any handler interpolates time. Investigate first reading of each handler before writing the regression test. |
| A2 | The MCP SDK at `@modelcontextprotocol/sdk@^1.18.0` peers on zod v3 internally and adopting zod v3 in user code is risk-free | Standard Stack / Discretion-05 | Dual-zod (SDK using v4 transitively while our `defineMutatingHandler` parses with v3) would cause object-identity issues if schemas are ever passed across the SDK boundary. **Mitigation:** Phase 0 zod schemas are not handed to the SDK — they are private to `defineMutatingHandler`. The SDK only sees the JSON-Schema in `tools.js`. Boundary is clean. **[VERIFIED: src/tools.js has no zod imports; SDK consumes JSON-Schema only]** |
| A3 | Snapshot output is stable across `node --test` patch versions on Node 22.x | FOUND-07 | Snapshot diffs on Node minor upgrade would mean every Node upgrade reviews all snapshots. **Mitigation:** Pin CI Node to a specific 22.x for first 90 days; document Node upgrade as a "snapshot review event." |
| A4 | The `existingMatches` field for FOUND-11 can be populated by an extra `list` call inside `build()` of each future create-tool, at acceptable latency cost (≤ one extra round-trip per create) | FOUND-11 | If list calls are slow at scale (e.g. 1000+ streams), every dry-run pays the cost. **Mitigation:** Phase 0 ships the helper; Phase 3 (Streams) measures actual latency and the planner adjusts. Not a Phase 0 problem to solve. |
| A5 | The four `test-*.js` scripts can be migrated as a 1:1 translation (each `console.log("✓ ...")` → one `test()` block) without restructuring | D-05 / Q8 | If the existing scripts have order dependencies (a later assertion depends on state set by an earlier one), per-test isolation in `node:test` breaks them. **Mitigation:** Reading the scripts confirmed `test-clustering.js` uses `_clearForTests()` between sections and `_withStorePathOverride` for filesystem isolation — both are already isolation-style seams. Migration is mechanical. **[VERIFIED: read test-clustering.js full content]** |
| A6 | Renaming tool names in `src/tools.js` + dispatch entries does NOT require any change to the MCP SDK's `ListToolsRequestSchema` handler — it just emits whatever is in `toolDefinitions` | D-03 | If the SDK caches tool names across `ListTools` calls, rename would partially propagate. **Mitigation:** MCP protocol requires the client to re-fetch tools on connect; new connections see the new names. Existing connections to long-running servers would need a reconnect. Document in CHANGELOG. **[CITED: typescript-sdk docs/server.md — ListTools is a fresh emit per request]** |
| A7 | `idempotencyKey` derivation is safe to include in dry-run preview without revealing sensitive data — args are sanitized first by zod | FOUND-10 / Pitfall 2 | If args include secrets (e.g. a connection apiToken accidentally passed as an arg), the hash is over them. **Mitigation:** zod schemas for mutating tools never accept `apiToken` as an arg field; the only secret in the system is `conn.apiToken` resolved from config, never from args. Risk is low but worth a dedicated test. |
| A8 | The "all existing tools route through new dispatch unchanged" success criterion accepts that error messages MAY change slightly (e.g. assertion-error wording on missing handler) as long as success-path outputs are byte-identical | FOUND-01 | A user with hardcoded error-message parsing breaks. **Mitigation:** Use the existing `throw new Error("Tool not found: ${name}")` message exactly as the dispatch.js default; never silently rewrite error strings. Verified in Pattern 1 example. |

## Open Questions

The "12 key research questions" in the objective input are answered below. Each is paired with the locked decision (when one exists) and a HIGH/MEDIUM/LOW confidence rating on the recommendation.

### Q1. Dispatch Map refactor: build-alongside-then-flip vs migrate-one-by-one?

**Recommendation:** **Approach A — build the Map alongside, populate it for every existing tool in one commit, then flip `setRequestHandler` to call `dispatch.dispatch` in a second commit.** Confidence: HIGH.

**Why not Approach B (incremental coexistence):**
- The if-chain at `src/index.js:38-103` has 22 branches. Splitting them across N commits doubles the dispatch logic for the duration of the migration — every test must exercise both paths, and any per-tool bug surfaces twice.
- Phase 0 has the test infrastructure available the moment FOUND-07 lands. Approach A's regression-snapshot strategy (Pitfall 1) is the same shape either way; coexistence adds nothing.
- The Phase 0 goal is "no behavior diffs" — atomic flip + regression test is the verification.

**Concrete steps:**
1. **Wave 0 (test infra):** Land `node:test` setup, `npm test` fix, snapshot harness with 5–10 fixtures for FOUND-07 (handler/list/normalize/idempotency/dispatch tests — all green at this point because they test new modules; no integration with existing code yet).
2. **Wave 1 (regression net):** Capture pre-refactor read-tool snapshots (Example 4 above) — must run against the unchanged `src/index.js` and pass. These are the safety net.
3. **Wave 2 (refactor):** Build `src/dispatch.js`; for each branch in the if-chain, `register(name, handler)` against the existing handler function (extract function from inline definition where needed). Add `assertAllToolsRegistered(toolDefinitions)`.
4. **Wave 3 (flip):** Replace the `setRequestHandler(CallToolRequestSchema, async (request) => { /* if-chain */ })` body with `dispatch.dispatch(request)`. Re-run the Wave 1 regression snapshots. Diffs = bugs = revert the flip, fix, retry.
5. **Wave 4 (rename):** Apply D-03 hard renames after Wave 3 is green. Rename is an `s/old/new/` in `tools.js` + dispatch.register call + any README references; regression snapshots get updated names but otherwise identical content.

### Q2. defineMutatingHandler factory contract — what does each callback do?

See Pattern 2 above for the full signature. The contract:

- **`schema`** (`z.ZodObject`): zod schema that includes `dryRun: z.boolean().default(true)`, `connectionName: z.string().optional()`, `idempotencyKey: z.string().optional()` (via the `mutatingBase` extension). Parsing is the first step; failure short-circuits with `formatZodError(err)`.
- **`build(args) → RequestDescriptor`**: PURE function. Takes validated, parsed args; returns `{ method, path, body, summary?, postApplyEstimate?, existingMatches?, normalize? }`. MUST NOT have side effects — Phase 0's test asserts the same args produce the same descriptor across runs. May internally call `list_pre_check(client, args)` if it needs FOUND-11 conflict info; that's an effectful step but it's gated to `dryRun`-or-`apply` time, not on every call.
- **`apply(client, req) → Promise<rawResponse>`**: Effectful. Calls `client.request(req.method, req.path, req.body)`. The factory wraps the call in try/catch and converts thrown `GraylogError` subclasses into MCP `isError` responses via `wrapGraylogError`. No retry logic in Phase 0 (idempotency is for retries the agent does, not retries the client does).
- **`summarize(args, req) → string`** (optional): Human-readable preview line. Defaults to `${req.method} ${req.path}`.

**Composition with the 5 sub-concerns:**
1. **zod validation** — first step in the returned `handler(request)` function.
2. **Connection resolution** — second step; uses `resolveConnection(args)` which captures activeConnection name synchronously.
3. **Writable flag check** — third step; short-circuits with `connection_read_only` error before `build`.
4. **Idempotency-key generation** — fourth step; `args.idempotencyKey ?? deriveIdempotencyKey(...)`. The key is included in BOTH the dry-run preview and the apply result so the agent can correlate.
5. **Request normalization** — happens AFTER apply, via `req.normalize?.(raw)` (per-endpoint hint) falling back to `{ id: raw?.id, body: raw }`.

Confidence: HIGH (matches ARCHITECTURE.md Q3, refined for D-07 writable layer).

### Q3. Graylog HTTP client design — error mapping, logging, retries, caching?

See Pattern 4 above. Specifically:

- **(a) Typed error mapping for 400/403/404/409/422**: Yes — `mapGraylogError` returns one of 5 `GraylogError` subclasses with `.kind`, `.status`, `.body`. `wrapGraylogError(err, toolName)` translates these to MCP `isError` responses with stable, parseable text. **Confidence: HIGH.**
- **(b) Request logging in dev mode**: Add an optional `debug: boolean` option to `makeClient(conn, { debug })`. When true, log `[graylog] METHOD path` to stderr (NOT stdout — stdout is the MCP transport). Phase 0 ships the option as `false` by default; only `--debug` CLI flag would enable. **Confidence: MEDIUM** — could defer to Phase 7 hardening; not blocking.
- **(c) Retries**: **None in Phase 0.** Agent-driven retries with idempotency keys (FOUND-10) are the safety net. Client-side retry on 5xx is tempting but: (i) Graylog admin endpoints are idempotent only for the subset that take an `Idempotency-Key` header — which is none; (ii) blind retry on `delete_index_set` is catastrophic. Phase 7 may revisit per-endpoint exponential backoff for read tools only. **Confidence: HIGH.**
- **(d) Response normalization `{ id, body }`**: Implemented as a separate `normalize.toIdBody(raw, hint)` helper, called from `defineMutatingHandler` (not from `makeClient.request`) — keeps the client transport-only, normalization domain-aware. **Confidence: HIGH.**
- **Caching `list_pipeline_functions` etc.**: **Do NOT lay the groundwork in Phase 0.** That is Phase 4's domain-specific concern. Premature cache abstraction is a known anti-pattern. **Confidence: HIGH.**

### Q4. zod adoption in MCP-SDK context — JSON-Schema vs zod, dual sources of truth?

**Recommendation: Option B (JSON-Schema in `tools.js` + separate zod in `schemas.js`), with a parity test for drift detection.** Confidence: HIGH.

**Why not Option A (zod-derived JSON-Schema via `zod-to-json-schema`):**
- `zod-to-json-schema` was sunsetted by its maintainer in Nov 2025 (verified via WebSearch).
- The zod v4 native `z.toJSONSchema()` is the future, but adopting zod v4 conflicts with our pinned `^1.18.0` MCP SDK.
- Codegen at build/runtime adds complexity for the value of avoiding hand-keeping a parallel schema. Phase 0's tool count is bounded (~22 existing read tools, no new mutating tools). Hand-keep is tractable.

**Why not Option C (`zod-to-json-schema` package):**
- Same as Option A's first bullet — sunsetted package.

**The strategy:**
1. `src/tools.js` keeps the existing JSON-Schema shape (the MCP SDK reads it).
2. `src/tools/<domain>/schemas.js` per Phase 1+ ships the zod schemas (the wrapper reads it).
3. A parity test (`test/schema-parity.test.js`) asserts that for each registered tool, every JSON-Schema property key has a corresponding zod shape key (and vice-versa). Catches drift at PR time.
4. Phase 0 ships the parity test scaffolding with the current read tools as a (trivially-passing) baseline — no zod schemas exist yet for existing read tools, so the test starts with an empty-allowlist mode and is enriched per-domain.

**MCP SDK consumes zod internally** — verified. The SDK transitively imports zod for its own RPC schema validation (e.g. `CallToolRequestSchema`). This is invisible to user code; we never hand SDK-side schemas to our own wrapper. Boundary is clean (A2 above).

### Q5. Idempotency-key auto-derivation — which hash, what args, sent to Graylog?

See Example 2 above. Specifics:

- **Hash:** sha-256 truncated to 32 hex chars. Confidence: HIGH.
- **Args normalization:** Canonicalize via sorted-key recursion; exclude `dryRun` and `idempotencyKey` themselves (and accept a per-tool override list, e.g. exclude `now` if a tool ever takes a deterministic clock injection arg). Confidence: HIGH.
- **Non-deterministic fields:** The wrapper does NOT special-case timestamps automatically — if a tool's args contain a timestamp meant as part of the identity (e.g. "create event-definition for window [from, to]"), the timestamp IS part of the key. If the timestamp is a freshness hint that varies per call (e.g. "as of now"), the tool MUST exclude it via its own per-call `excludeFromIdempotency` field in the schema. Documented in the wrapper's contract comment.
- **Header to Graylog:** **No.** Confirmed by Graylog source search (`grep -ri "Idempotency-Key\|IdempotencyKey" source-code/graylog2-server/.../rest/` — no matches). Graylog 7.2 does not honour an `Idempotency-Key` header. Use is purely client-side per PITFALLS.md M4: list-then-match against existing entities tagged with `[mcp:idem:abc123]` in their description field. The wrapper's `apply()` path is responsible for this list-then-match logic — Phase 0 ships the key derivation; Phase 3 (Streams, the first domain with a tag-encoding need) ships the list-then-match orchestration.

### Q6. List projection helper — factory or utility?

**Recommendation: `defineListHandler` factory (Pattern 3 above).** Confidence: HIGH.

**Why factory over `projectList(items, defaults)` utility:**
- A utility is a convention — "remember to call this." Forgetting it in one of N new list tools degrades the agent context budget silently (M6 in PITFALLS.md). A factory is structural enforcement.
- The factory also enforces `limit ≤ 200` (hard ceiling), `fields: "all"` opt-in, default limit 25. A utility would have to be invoked correctly at three call sites per handler; the factory invokes them once.

**Why not a zod-schema-level transform** (Option C from the question):
- zod transforms run on input args, not on output. We need to enforce projection on the **response items**, which arrive from Graylog after the schema has already done its job. Output transformation is the handler's responsibility, not the schema's.

### Q7. Snapshot test infrastructure — fixtures location, naming, fixture shape?

See Example 1 above. Specifics:

- **Location (D-06 locked):** `test/__snapshots__/`. `node:test` auto-locates per-test-file snapshots at `<test-file>.snapshot` next to the test by default, but supports overriding via `t.assert.snapshot(value, { config: { snapshot: { path: ... } } })`. **For Phase 0, follow the `node:test` default — put `.snapshot` files in `test/__snapshots__/` by passing the right config OR by accepting the default sibling-file location and gitignoring nothing.** Reading the Node 22 docs confirms the default is sibling-file (`test/handler.test.js.snapshot`). To centralize them under `test/__snapshots__/` per D-06 means either (a) using the `nodejs.org/api/test.html` `setResolveSnapshotPath` API (stable Node 22) to redirect all snapshots, or (b) accept the sibling-file default. **Recommendation: use `setResolveSnapshotPath` so D-06 is honored.** Confidence: HIGH on mechanism, MEDIUM on D-06 reading (the user said "test/__snapshots__/" explicitly — the planner should honor that by using the resolver hook).

```js
// test/snapshot-config.js (loaded once via test setup file or import-side-effect)
import { snapshot } from "node:test";
import { dirname, join, basename } from "node:path";
import { mkdirSync } from "node:fs";

snapshot.setResolveSnapshotPath((testFilePath) => {
    const snapDir = join(dirname(testFilePath), "__snapshots__");
    mkdirSync(snapDir, { recursive: true });
    return join(snapDir, basename(testFilePath) + ".snapshot");
});
```

- **Naming:** Per-test-file. Each `.snapshot` file groups all snapshots from a single test file, keyed by full test name + counter. This is the `node:test` default.
- **Dry-run preview snapshot shape:** JSON of the `{ method, path, body, summary, idempotencyKey, postApplyEstimate, existingMatches }` preview — see Example 1. Idempotency key is deterministic per args (Pitfall 2), so snapshots are stable.
- **Happy + validation-failure paths in fixtures:** Yes — each handler test file MUST have at least one `test()` calling with valid args (snapshot the preview), at least one calling with invalid args (assert `isError: true` + message match). See Example 1.
- **5–10 fixtures for FOUND-07:** Concrete list:
  1. `defineMutatingHandler` — fixture create-stream-style mutating tool, happy dry-run path
  2. `defineMutatingHandler` — same tool, validation-failure path
  3. `defineMutatingHandler` — same tool, writable=false short-circuit
  4. `defineMutatingHandler` — idempotency-key auto-derivation deterministic
  5. `defineListHandler` — list of fixture items, default projection
  6. `defineListHandler` — list with `fields: "all"`
  7. `defineListHandler` — list with custom `limit` (clamped to MAX_LIMIT)
  8. `normalize.toIdBody` — 3 create-response shape variants (Location header, `{ stream_id }`, full DTO)
  9. `dispatch.dispatch` — unknown tool throws `Tool not found: ${name}`
  10. `dispatch.assertAllToolsRegistered` — fails when a tool is missing a handler

### Q8. Test migration plan — per-script effort and tricky parts (D-05)

**`test-clustering.js` (308 lines, uses `_setSearchOverride()` seam)**: 6 distinct test sections (Preprocessor, Registry, Drain3, Template store, Formatter, cluster_log_messages handler, Template management list/delete/rename, Template export/import). **Migration:** split into 4 files for clarity:
- `test/existing/clustering-preprocess.test.js` (preprocessor + tokenize)
- `test/existing/clustering-strategy.test.js` (registry + drain3 + serialize roundtrip)
- `test/existing/template-store.test.js` (load + save + corrupt recovery)
- `test/existing/template-mgmt.test.js` (formatter + cluster_log_messages handler + management ops)
Per-file effort: ~1 hour each. Tricky: the `_clearForTests()` calls between sections become `t.beforeEach`/`t.afterEach` hooks. The `_withStorePathOverride((conn) => join(dir, ...))` pattern stays as-is in a setup hook. Confidence: HIGH.

**`test-features.js` (135 lines, time-range + aggregation payload tests)**: 4 sections (time-range parsing, aggregation payloads, error handling, arg normalization). **Migration:** single file `test/existing/features.test.js` with 4 `test.describe()` blocks or 4 top-level tests. ~1.5 hours. Tricky: this script uses `console.log` for every "✓" — strip them all. No state to isolate. Confidence: HIGH.

**`test-aggregation-fixes.js` (84 lines, aggregation payload structural)**: Pure assertion tests on builder output shapes. **Migration:** `test/existing/aggregation-fixes.test.js`. ~30 minutes. Tricky: none. Confidence: HIGH.

**`test-histogram-fixes.js` (74 lines, histogram-specific shapes)**: Same shape as above. **Migration:** `test/existing/histogram-fixes.test.js`. ~30 minutes. Tricky: this file has print-friendly diffing logic for structure comparison — convert to direct `t.assert.deepEqual` calls. Confidence: HIGH.

**Total effort estimate:** ~5–6 hours of mechanical migration + ~2 hours of running, fixing, snapshot review. Net: one full developer-day.

**Cross-cutting concerns:**
- `npm test` script (D-02): change `"test": "node test-server.js"` to `"test": "node --test test/**/*.test.js"` — single line in package.json. The shell glob expansion may need quoting depending on the shell; `node --test` itself accepts a directory.
- The four migrated files all import from `src/` — paths become `../../src/...` from `test/existing/`. Mechanical.
- `_setSearchOverride()` / `_clearForTests()` calls remain underscore-seams; no API change needed.

### Q9. Hard-rename strategy — enumerate every existing tool + new name

The full v2.3 surface from `src/tools.js`:

| Old Name | Proposed New Name (planner confirms) | Pattern Fit |
|----------|--------------------------------------|-------------|
| `list_connections` | `list_connections` | Already fits |
| `use_connection` | `set_active_connection` | `<verb>_<domain>_<noun>` ✓ |
| `fetch_graylog_messages` | `search_messages_graylog` | Verb=search, domain=messages, noun=graylog (questionable noun) — **prefer `search_logs_messages`** with domain=logs, noun=messages |
| `get_surrounding_messages` | `get_context_messages` | Verb=get, domain=context, noun=messages |
| `list_streams` | `list_streams` | Already fits |
| `list_field_values` | `list_values_field` | Verb=list, domain=values, noun=field — awkward; **alternate: `list_field_values`** keep (semantic "field's values" is one noun) |
| `get_log_histogram` | `get_histogram_logs` | Verb=get, domain=histogram, noun=logs — **alternate: `get_histogram_messages`** consistent with the "messages" domain |
| `get_field_aggregation` | `get_aggregation_field` | Verb=get, domain=aggregation, noun=field |
| `get_field_time_aggregation` | `get_aggregation_field_time` | Cumbersome; **alternate: `get_aggregation_field_over_time`** |
| `debug_histogram_query` | `debug_query_histogram` | Verb=debug, domain=query, noun=histogram |
| `save_search` | `create_saved_search` | Verb=create, domain=saved, noun=search |
| `list_saved_searches` | `list_saved_searches` | Already fits |
| `get_saved_search` | `get_saved_search` | Already fits |
| `delete_saved_search` | `delete_saved_search` | Already fits |
| `search_events` | `search_events_graylog` or `list_events_graylog` | Verb=search, noun=events — actually the existing name has verb+noun and missing domain. **alternate: `search_alerts_events`** |
| `get_event_definitions` | `list_event_definitions` (verb should be list when plural) | Verb=list, domain=event, noun=definitions |
| `get_event_notifications` | `list_event_notifications` | Same as above |
| `cluster_log_messages` | `cluster_messages_logs` | Verb=cluster, domain=messages, noun=logs — or **keep `cluster_log_messages`** as the agent has been trained on it and it reads naturally |
| `list_log_templates` | `list_log_templates` | Already fits |
| `delete_log_template` | `delete_log_template` | Already fits |
| `rename_log_template` | `update_log_template` (verb=update aligns with the verb taxonomy) | Verb=update; old "rename" is a special case of update |
| `export_log_templates` | `export_log_templates` | Already fits |
| `import_log_templates` | `import_log_templates` | Already fits |

**Recommendation:** Planner finalises with the user reviewing this table. **The verb taxonomy** that the rename enforces (per FOUND-13 / M7): `list, get, create, update, delete, set, search, cluster, debug, export, import`. Other verbs ARE allowed but call them out — `fetch` becomes `search` or `list`; `rename` becomes `update`; `save` becomes `create` (for create) or `update` (for upsert).

**Internal handler function names** (`fetchGraylogMessages` etc.): **recommend renaming for consistency**, but the planner may choose to keep handler-function names if the rename's scope is purely external. The Phase 0 risk-minimal answer is to rename ONLY `tools.js` + the dispatch.register names + README/CHANGELOG. Internal `handle*` / `fetch*` function names can stay; they're not in the agent's path. Trade-off: future grep-ability suffers if external name is `search_logs_messages` but internal function is `fetchGraylogMessages`. **Verdict: rename internals too as a cleanup pass, but only after the external rename is green.** Confidence: MEDIUM.

### Q10. Verifying "no behavior diffs" for existing read tools

See Example 4 above and Pitfall 1. The mechanism:

1. **Pre-refactor capture** (before any `src/index.js` change): Run `node --test test/regression/read-tools.test.js --test-update-snapshots`. This generates the baseline snapshots from the OLD if-chain path. **Commit the snapshots to git as part of the Wave 1 deliverable.**
2. **Post-refactor verification** (after the flip in Wave 3): Run `node --test test/regression/read-tools.test.js` (no `--test-update-snapshots`). Diff = bug.

**What the fixtures cover:** Tools that DON'T require a live Graylog connection (use `_testConnection` seam) get full-payload snapshots. Tools that DO require a live Graylog (most read tools) get **payload-emission snapshots** — i.e., capture the JSON that would be POSTed to Graylog, not Graylog's response. This is feasible by introducing a `_captureRequest` test seam in the new `makeClient.request()` that, when set, returns the would-be request descriptor instead of calling axios.

```js
// src/graylog/client.js (test-seam addition)
let _captureRequestFn = null;
export function _setCaptureRequest(fn) { _captureRequestFn = fn; }
export function makeClient(conn) {
    return {
        async request(method, path, body) {
            if (_captureRequestFn) return _captureRequestFn({ method, path, body, conn });
            // ... real axios call ...
        },
    };
}
```

Read tools currently call `axios` directly via `src/query.js:searchGraylog`. **For Phase 0, the read tools don't migrate to `makeClient` yet** (that's a domain-phase concern — they're read tools, the new client is for admin tools). Instead, the regression net is at the dispatch level — capture the full MCP response (with axios mocked via existing seams) and compare. Confidence: MEDIUM — depends on whether each read handler is dry-run-able with a test seam. **Alternative if a read tool can't be cleanly seamed:** snapshot only the early-return paths (e.g. "no connection" errors) which are deterministic without axios.

### Q11. Schemas co-location pattern for Phase 0 (no domain)

**Recommendation:** Cross-cutting schemas live in `src/tools/_shared/schemas.js`. Phase 0 has no domain schemas because no mutating tool ships in this phase. Confidence: HIGH.

What goes in `_shared/schemas.js`:
- `mutatingBase` — the common base for every mutating tool's schema (`dryRun`, `connectionName`, `idempotencyKey`)
- `listBase` — the common base for every list tool's schema (`connectionName`, `limit`, `fields`)
- `connectionRef` — when a mutating tool's body references a connection by name in deeper structures

What stays in per-domain `<domain>/schemas.js`: every domain-specific schema starting in Phase 1.

**No `src/dispatch/schemas.js`** — the dispatch layer is shape-agnostic, takes any handler function. Schemas belong with handlers, not with dispatch.

### Q12. Pipeline DSL pre-phase research flag for Phase 0?

**Recommendation:** **No.** Phase 0 does NOT seed any Phase 4 pipeline-DSL infrastructure. Confidence: HIGH.

The SUMMARY.md flagged Phase 4 as needing pre-phase research to enumerate ~100 Graylog built-in functions (the `pipelineprocessor/functions/` catalogue). That enumeration is a Phase 4 deliverable — even the data-fetching utility for the function catalogue is Phase 4 because:
- The fetch is via `GET /system/pipelines/rule/functions` against Graylog, which requires the `src/graylog/client.js` from FOUND-02 (Phase 0 ships it, Phase 4 uses it).
- Caching of the function list is a per-domain cache, not a transport-layer cache (Q3 above).
- Phase 0 has no use for the catalogue — no DSL emission, no rule creation.

Putting the function-catalogue cache pattern in Phase 0 would be premature optimization for a feature 4 phases out.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Everything | ✓ | v22.22.2 (verified via `node --version`) | — — meets D-01 `>= 22.3.0` |
| npm | Install workflow | ✓ (assumed; comes with Node) | — | — |
| `axios` (existing) | `src/query.js`, future `src/graylog/client.js` | ✓ (declared in package.json) | `^1.12.2` | — |
| `zod` (existing) | New `defineMutatingHandler` + per-domain schemas | ✓ (declared in package.json, currently unused) | `^3.25.76` (registry-verified) | — |
| `@modelcontextprotocol/sdk` | `src/index.js` | ✓ (declared in package.json) | `^1.18.0` (current latest is 1.29.0; no bump planned for Phase 0) | — |
| `c8` (optional devDep) | Coverage report (Phase 7 consumer, not Phase 0 blocker) | ✗ | — | Defer install to Phase 7 if Phase 0 doesn't need it; FOUND-07 doesn't require coverage |
| Local Graylog 7.2 source | Cross-referencing endpoint shapes in research/PITFALLS | ✓ | `source-code/graylog2-server/` snapshot | — |
| Live Graylog server | NOT required for Phase 0 — all tests use seams/mocks | n/a | n/a | n/a |
| `git` | Commits, branching | ✓ (current branch is `main`) | — | — |

**Missing dependencies with no fallback:** None. Phase 0 is purely code/config in this repository.

**Missing dependencies with fallback:** `c8` — defer to Phase 7 / HARD-04.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in to Node 22.3+); `t.assert.snapshot()` stable |
| Config file | None required for `node:test`; `package.json` `scripts.test` is the entry point |
| Quick run command | `node --test test/**/*.test.js` (single file: `node --test test/handler.test.js`) |
| Full suite command | `npm test` (after D-02 fix → routes to `node --test test/**/*.test.js`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| FOUND-01 | Map dispatch routes every read tool unchanged | unit + regression-snapshot | `node --test test/dispatch.test.js test/regression/read-tools.test.js` | ❌ Wave 0/1 |
| FOUND-01 | `assertAllToolsRegistered` fails when a tools.js entry has no handler | unit | `node --test test/dispatch.test.js` | ❌ Wave 0 |
| FOUND-02 | `makeClient(conn).request` builds auth header + X-Requested-By | unit (axios mock) | `node --test test/graylog-client.test.js` | ❌ Wave 0 |
| FOUND-02 | 400/403/404/409/422 map to typed errors | unit | `node --test test/graylog-client.test.js` | ❌ Wave 0 |
| FOUND-03 | `defineMutatingHandler` enforces `dryRun: true` default | unit + snapshot | `node --test test/handler.test.js` | ❌ Wave 0 |
| FOUND-03 | Build/apply split — preview ≡ apply payload | snapshot | `node --test test/handler.test.js` | ❌ Wave 0 |
| FOUND-04 | `__SERVER_ASSIGNED__` sentinel in dry-run preview | snapshot | `node --test test/handler.test.js` | ❌ Wave 0 |
| FOUND-05 | zod schemas reject invalid args; error response is canonical | unit | `node --test test/handler.test.js` | ❌ Wave 0 |
| FOUND-06 | `engines.node` is `>= 22.3.0`; `npm test` runs end-to-end | smoke | `npm test && node -e "console.log(process.versions.node)"` | manual (run once at Wave 0 close) |
| FOUND-07 | 5–10 snapshot fixtures pass deterministically | snapshot | `node --test test/handler.test.js test/list.test.js test/normalize.test.js test/idempotency.test.js test/dispatch.test.js` | ❌ Wave 0 |
| FOUND-08 | `normalize.toIdBody` extracts ID from 3+ create-response shapes | unit | `node --test test/normalize.test.js` | ❌ Wave 0 |
| FOUND-09 | `connectionName` arg resolves; absent falls back to singleton | unit | `node --test test/connection.test.js` | ❌ Wave 0 |
| FOUND-10 | `deriveIdempotencyKey` is deterministic; canonicalizes args; excludes `dryRun`/`idempotencyKey` | unit | `node --test test/idempotency.test.js` | ❌ Wave 0 |
| FOUND-11 | `existingMatches` field present in dry-run output (empty list when none) | unit | `node --test test/handler.test.js` | ❌ Wave 0 |
| FOUND-12 | `defineListHandler` enforces default fields + limit; clamps to MAX_LIMIT | unit | `node --test test/list.test.js` | ❌ Wave 0 |
| FOUND-13 | Renamed tool names match `<verb>_<domain>_<noun>` pattern; CHANGELOG documents migration | static lint | manual review + grep | manual |
| **D-07** | `writable: false` connection short-circuits in wrapper AND client | unit | `node --test test/connection.test.js test/graylog-client.test.js` | ❌ Wave 0 |
| **D-05** | All 4 existing test-*.js scripts run via `npm test` and pass | regression | `npm test` | ❌ Wave 0/1 (migration) |

### Sampling Rate

- **Per task commit:** `node --test test/<specific-area>.test.js` (≤ 30 s)
- **Per wave merge:** `npm test` (full suite, ≤ 2 min when 5–10 snapshot fixtures + 4 migrated scripts complete)
- **Phase gate:** Full suite green + regression-snapshot diff is empty + `node --version >= 22.3.0` on CI before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `test/__snapshots__/` directory created (gitkeep until first snapshot)
- [ ] `test/snapshot-config.js` — `setResolveSnapshotPath` configuration (Q7)
- [ ] `test/dispatch.test.js` — covers FOUND-01
- [ ] `test/handler.test.js` — covers FOUND-03, FOUND-04, FOUND-05, FOUND-09, FOUND-10, FOUND-11
- [ ] `test/list.test.js` — covers FOUND-12
- [ ] `test/graylog-client.test.js` — covers FOUND-02
- [ ] `test/normalize.test.js` — covers FOUND-08
- [ ] `test/idempotency.test.js` — covers FOUND-10 deeper
- [ ] `test/connection.test.js` — covers FOUND-09, D-07
- [ ] `test/regression/read-tools.test.js` — pre/post FOUND-01 regression net (Pitfall 1)
- [ ] `test/schema-parity.test.js` — Pitfall 3 drift detection (starts empty; Phase 1+ enriches)
- [ ] `test/existing/clustering-preprocess.test.js` — from `test-clustering.js`
- [ ] `test/existing/clustering-strategy.test.js` — from `test-clustering.js`
- [ ] `test/existing/template-store.test.js` — from `test-clustering.js`
- [ ] `test/existing/template-mgmt.test.js` — from `test-clustering.js`
- [ ] `test/existing/features.test.js` — from `test-features.js`
- [ ] `test/existing/aggregation-fixes.test.js` — from `test-aggregation-fixes.js`
- [ ] `test/existing/histogram-fixes.test.js` — from `test-histogram-fixes.js`
- [ ] `package.json` script `test` updated from `node test-server.js` to `node --test test/**/*.test.js` (D-02)
- [ ] `package.json` `engines.node` bumped to `>= 22.3.0` (D-01)
- [ ] `package.json` devDeps `@types/node` bumped to `^22.x` (consistency with engine floor)
- [ ] Original 4 `test-*.js` scripts at repo root deleted after migration (or moved to `legacy/` for one milestone — planner choice; CONTEXT.md doesn't say)

Framework install: not needed — `node:test` is built-in. `c8` install deferred to Phase 7.

## Security Domain

Phase 0 is infrastructure; the security posture is shaped by what the foundation primitives MAKE POSSIBLE for downstream phases, not by direct exposure in Phase 0 itself. `security_enforcement` is not explicitly disabled in `.planning/config.json`, so this section is included.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing `axios.auth: { username: apiToken, password: 'token' }` Basic-auth pattern in `src/query.js:107`; reused in `src/graylog/client.js`. No new credential storage in Phase 0. |
| V3 Session Management | no | MCP server is stdio per-process; no sessions. |
| V4 Access Control | yes (foundational) | The `writable: false` flag (D-07) is a defense-in-depth access control at the connection layer. The wrapper short-circuit + client-layer refusal (Pitfall 4) is two-layer enforcement. Graylog's own role-based access (token's effective permissions) is the upstream layer; we surface 403s via `GraylogPermissionError`. |
| V5 Input Validation | yes | **Primary Phase 0 deliverable.** zod schemas adopted via `defineMutatingHandler` (FOUND-05). Replaces ad-hoc `if (!args.foo)` checks. |
| V6 Cryptography | yes (light) | sha-256 via `node:crypto.createHash("sha256")` for idempotency-key derivation (FOUND-10). Standard, no hand-roll. |
| V7 Error Handling and Logging | yes | Canonical MCP error shape (`{ isError: true, content: [...] }`) maintained; typed Graylog errors don't leak server stack traces (`GraylogError` only carries `status, body, kind`, never the raw axios response). Debug-mode logging to stderr (Q3 b) is opt-in. |
| V8 Data Protection | partial | Connection apiToken is read from `~/.graylog-mcp/config.json` in plaintext (existing concern per CONCERNS.md, NOT a Phase 0 deliverable per locked scope). Phase 0 does NOT introduce new credential storage. |
| V10 Configuration | yes | `engines.node >= 22.3.0` pinned; dev/prod parity (no build step); `npm test` script fixed. |
| V13 API Validation | yes | All Graylog responses pass through `mapGraylogError` for 4xx/5xx; status code → typed error class. Prevents implicit-cast bugs. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Agent passes malicious arg values that bypass JSON-Schema | Tampering | zod validation in `defineMutatingHandler` runs AFTER the SDK's JSON-Schema check, providing redundant defense. Zod schemas use `.min(1)` / `.url()` / `.enum([...])` constraints where appropriate. |
| Agent retries a mutating call that already succeeded (network glitch mid-response) | DoS / data corruption | Idempotency-key auto-derived (FOUND-10) + list-then-match on apply (Phase 3+) ensures duplicate creates collapse to the first success. |
| Mutating call against a misconfigured "prod" connection | Tampering / sabotage | `writable: false` flag in connection config (D-07); two-layer enforcement (wrapper + client); dry-run-by-default is the third layer. |
| Agent invents arguments referencing non-existent server-assigned IDs | Information disclosure (sometimes) | `__SERVER_ASSIGNED__` sentinel in dry-run preview (FOUND-04) makes it impossible to copy-paste a fake ID; Phase 6 blueprint chaining handles the real substitution. |
| Stale/forged `idempotencyKey` from caller | Tampering | Key is opaque from the agent's perspective; if forged, the worst case is a missed dedupe (creates a duplicate) — not a privilege escalation. Hashing scheme is sha-256, not used for auth. |
| Connection apiToken leaks via debug logs | Information disclosure | `redactAuth` (mentioned in STACK.md decision 1) — `defineMutatingHandler` MUST never include `headers.Authorization` in dry-run preview. Phase 0 ships the redaction helper; tests assert no auth header in any snapshot. |
| Read-tool regression introduces query-shape change exposing new fields | Information disclosure | Regression snapshot tests (Pitfall 1 / Example 4) gate the dispatch refactor. |

**Auth-redaction test (recommended):** A snapshot test that asserts no Phase 0 snapshot fixture file in `test/__snapshots__/` contains the substring `Authorization` or any apiToken pattern (`/[A-Za-z0-9]{32,}/`). Cheap to write, catches future leakage.

## Sources

### Primary (HIGH confidence)

- `src/index.js:1-250` (read) — current dispatch shape; `requireActiveConnection` idiom; existing handler patterns
- `src/tools.js` (read full file) — current tool catalogue; 22 read tools enumerated; JSON-Schema shape
- `src/config.js` (read full file) — connection registry; singleton activeConnection; config parsing
- `src/query.js` (read full file) — `searchGraylog`, `buildQueryString`, `fetchStreams`; auth pattern at line 107
- `src/tools/cluster-errors.js` (read full file) — extracted-handler precedent; `errorResponse` helper at line 12
- `src/clustering/index.js` (read full file) — registry pattern (Map + register/get/list/_clearForTests)
- All 4 `test-*.js` scripts (read in full) — D-05 migration sources
- `package.json` (read full file) — version pins, engines, scripts
- `.planning/PROJECT.md` (read full file) — scope boundaries, key decisions
- `.planning/REQUIREMENTS.md` (read full file) — FOUND-01 through FOUND-13 verbatim
- `.planning/STATE.md` (read full file) — milestone state
- `.planning/phases/00-foundation/00-CONTEXT.md` (read full file) — locked decisions D-01 through D-08 + 6 discretion items
- `.planning/research/SUMMARY.md` (read full file) — synthesis; phase order; cross-cutting concerns
- `.planning/research/STACK.md` (read full file) — Node version, zod adoption, axios retention, node:test, c8
- `.planning/research/ARCHITECTURE.md` (read full file) — 8-phase build order; module layout; defineMutatingHandler design
- `.planning/research/PITFALLS.md` (read full file) — agent-loop pitfalls M4–M7; create-response inventory M2; rule parse/simulate endpoints
- `.planning/codebase/STRUCTURE.md` (read full file) — current layout; 903-line src/index.js; extraction precedent
- `.planning/codebase/CONVENTIONS.md` (read full file) — error shape, naming, ESM, async style, test seams
- `.planning/codebase/TESTING.md` (read full file) — test framework; broken `npm test`; 4 standalone scripts
- `.planning/codebase/CONCERNS.md` (read full file) — singleton risk; dispatch chain size; zod-unused; query escaping
- `source-code/graylog2-server/.../pipelineprocessor/rest/RuleResource.java` (grepped lines 86–284) — verified `/parse` (line 157) and `/simulate` (line 174) endpoints exist; verified no Idempotency-Key header support
- `npm view zod@^3.25.76 version` → `3.25.76` (2026-05-13 registry lookup)
- `npm view c8 version` → `11.0.0` (2026-05-13)
- `npm view @modelcontextprotocol/sdk version` → `1.29.0` latest (2026-05-13)
- `npm view zod-to-json-schema version` → `3.25.2` (sunsetted package; verified)

### Secondary (MEDIUM confidence)

- [Test runner | Node.js v22.21.1 Documentation](https://nodejs.org/docs/latest-v22.x/api/test.html) — `t.assert.snapshot()` API; `setResolveSnapshotPath`; stable in Node 22
- [typescript-sdk/docs/server.md (GitHub)](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) — `registerTool` pattern; zod v3 backward compat in SDK
- [MCP SDK v1.17.5 Incompatible with Zod v4 — Issue #1429 (modelcontextprotocol/modelcontextprotocol)](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1429) — dual-major zod risk rationale
- [zod-to-json-schema npm page](https://www.npmjs.com/package/zod-to-json-schema) — maintenance status / sunset notice (Nov 2025)
- [JSON Schema | Zod (zod.dev)](https://zod.dev/json-schema) — v4 native `z.toJSONSchema()`
- [Graylog REST API documentation](https://go2docs.graylog.org/current/setting_up_graylog/rest_api.html) — X-Requested-By CSRF requirement (no Idempotency-Key mention)

### Tertiary (LOW confidence — used cautiously)

- WebSearch results on Idempotency-Key for Graylog: confirmed absence (no documentation of the header; cross-referenced with local source grep)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version registry-verified on 2026-05-13; existing usage of axios/zod/SDK confirmed by reading package.json + source
- Architecture: HIGH — pattern derived from existing in-tree precedent (`src/clustering/`, `src/tools/cluster-errors.js`); decisions echo SUMMARY.md/ARCHITECTURE.md unanimous recommendations
- Pitfalls: HIGH — sourced from PITFALLS.md's source-code-traced findings (Graylog Java REST classes with file:line citations); reinforced by reading code locally
- Test migration plan (Q8): HIGH — all 4 scripts read in full; per-file effort estimated from observed structure
- Tool rename map (Q9): MEDIUM — pattern compliance straightforward, but several edge cases (`fetch_graylog_messages`, `get_field_time_aggregation`) need user/planner sign-off on exact final names
- Snapshot config (Q7, D-06): MEDIUM-HIGH — `setResolveSnapshotPath` confirmed in Node 22 docs; D-06's exact location preference satisfied by the resolver hook
- Q10 regression net feasibility: MEDIUM — depends on per-read-tool seam availability; documented as Pitfall 1 mitigation but may require minor seam additions to a few existing handlers

**Research date:** 2026-05-13
**Valid until:** 2026-06-13 (30 days; stack is stable, version pins verified)
