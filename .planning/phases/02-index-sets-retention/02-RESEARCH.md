# Phase 2: Index Sets & Retention — Research

**Researched:** 2026-05-15
**Domain:** Graylog 7.0.6 index-set + retention/rotation admin surface (8 mutating-or-list tools composed over Phase 0 primitives, with one new cross-domain async primitive `await_system_job`)
**Confidence:** HIGH on endpoint paths, request/response shapes, FQCNs, and the C1 + m2 mitigation algorithms (all confirmed directly against the 7.2.0-SNAPSHOT Java source — which is forward-compatible with 7.0.6 for every endpoint Phase 2 touches). MEDIUM on a small number of 7.0.6-vs-7.2 divergences flagged inline (e.g. `IndexSetUpdateRequest` field requiredness — see §Pitfall U1).

## Summary

Phase 2 ships **8 tools** — 1 list (`list_index_sets`) + 1 read (`get_index_set`) + 6 mutating (`create_index_set`, `update_index_set`, `delete_index_set`, `set_default_index_set`, `cycle_deflector`, `await_system_job`) — that give an agent end-to-end control of Graylog's storage-layer config: where messages live, how indices rotate, when they get cleaned, and which set is the default. The Graylog 7.0.6 endpoint surface for this domain is small and well-shaped (one `IndexSetsResource`, one `DeflectorResource`, one `IndicesResource`-for-list, one `SystemJobResource`). Phase 0 + Phase 1 have shipped every cross-cutting primitive — `defineMutatingHandler` (with async build + `req.cascades` forwarding from Plan 01-02), `defineListHandler`, `makeClient`, `mutatingBase`, `listBase`, the `__SERVER_ASSIGNED__` sentinel, the snapshot-determinism contract, the auth-redaction lint with regex-level `<...>` placeholder recognition, the `schema-parity.test.js` enrichment template, and the strict-no-echo partial-update pattern. Phase 2's work is **pure composition + per-domain strategy schemas + the C1 confirmation-token mechanic + the system-job poll primitive**, not new infrastructure.

The load-bearing safety story this phase delivers is **C1 mitigation**: Graylog server-side defaults `delete_indices=true` on `DELETE /system/indices/index_sets/{id}` ([VERIFIED: IndexSetsResource.java:380-411 — `@DefaultValue("true")`]), so a careless DELETE without an explicit query param launches an `IndexSetCleanupJob` against the live Elasticsearch cluster. The wrapper inverts the default to `false`, requires an explicit boolean from the agent, and gates the destructive path behind a deterministic confirmation hash that pins the dry-run state. The second load-bearing piece is **m5 mitigation**: every Graylog mutation that submits a `SystemJob` (today: index-set delete with cleanup, deflector cycle on some code paths) returns HTTP 204 immediately while the work continues in the background — the wrapper surfaces a uniform `{ async: true, job_id, job_id_observable_at }` envelope and ships `await_system_job` as the canonical completion-polling primitive.

**Primary recommendation:** Build the 8 tools as a single domain module under `src/tools/index-sets/` (kebab-case to mirror the existing `src/tools/inputs/` precedent). Co-locate one `schemas.js` covering index-set CRUD + the 6 strict `*_strategy_config` shapes (3 rotation + 2 retention + 1 future-proof slot per D-09). Hoist `await_system_job` into `src/tools/_shared/system-job.js` (Plan 02 hand-off note: it is a cross-domain primitive Phase 3+ will reuse). Place the alias→FQCN map in `src/tools/index-sets/strategies.js` so adding a 4th rotation strategy is a one-line edit. Ship 9 snapshot fixtures (§Snapshot Fixture Design). Extend `test/schema-parity.test.js` with `assertSchemaParityForTool()` calls for every new mutating tool. Pre-flight the C1 hash inputs in `delete_index_set.build()` and bind dry-run → apply with sha-256.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** When `delete_index_set` is called with `deleteIndices: true`, the wrapper computes a deterministic confirmation hash from the dry-run state: `sha256({indexSetId, deleteIndices: true, indexNames: [...sorted], messageCount})`. Dry-run emits the hash as `confirmationToken`. Apply (`dryRun: false`) requires the agent to echo it back as `confirm: "<hash>"` — mismatch refuses. Stateless, no MCP-side memory, survives process restarts.
- **D-02:** Hash inputs: `indexSetId` (target id) + `deleteIndices: true` (locked literal) + `indexNames` (sorted from `GET /system/indexer/indices/{indexSetId}/list`) + `messageCount` (total from `GET /system/indices/index_sets/{indexSetId}?stats=true`).
- **D-03:** `delete_index_set` with `deleteIndices: false` (the wrapper default — see D-04) does NOT require a confirmation token. Index-set metadata removed; Elasticsearch indices stay. Confirmation gate fires only when destruction is requested.
- **D-04:** `delete_index_set`'s `deleteIndices` parameter defaults to `false` — inverting Graylog's server-side `@DefaultValue("true")`. Dry-run preview EXPLICITLY emits `deleteIndices: false` (the wrapper-default is the safety-relevant choice).
- **D-05:** If `GET /system/indices/index_sets/{id}?stats=true` fails during dry-run, the dry-run returns `isError: true` with `reason: "stats_unreachable"`. No confirmation token issued. Agent cannot proceed to apply without knowing destruction blast radius.
- **D-06:** `await_system_job` implements blocking exponential backoff: `500ms → 1s → 2s → 4s → 5s → 5s …` (capped at 5s), configurable timeout (default 60s). Returns final job status when complete OR timeout error if not.
- **D-07:** `await_system_job` is `defineMutatingHandler`-shaped nominally (issues GETs only; no Graylog state change) so `dryRun` + writable-flag-gate inheritance is uniform. `dryRun: true` previews the polling plan and returns without polling.
- **D-08:** Strategies as **friendly aliases**: `rotation_strategy ∈ { "time-based" | "size-based" | "message-count" }`, `retention_strategy ∈ { "delete" | "close" }`. Wrapper maps aliases to Graylog FQCN before HTTP call. Closed set → `z.enum(...)`.
- **D-09:** Each alias has a strictly typed `*_strategy_config` zod schema. 6 strict configs total (3 rotation + 2 retention + 1 future-proof slot).
- **D-10:** `create_index_set` REQUIRES both `rotation_strategy` + `rotation_strategy_config` AND `retention_strategy` + `retention_strategy_config`. NO sensible defaults — destruction policies must never be defaulted.
- **D-11:** If `changes` includes `rotation_strategy`, the wrapper REQUIRES `rotation_strategy_config` in the same `changes` object — strategy class and config are atomic. Same rule for retention. Top-level fields (title, description, default, regular) use field-level partial-update per D-03 (Phase 1).
- **D-12:** When neither strategy is in `changes`, the wire body's strategy blocks are absent (Phase 1 D-03 strict no-echo). Agent can update a title without re-asserting the rotation strategy. **(See Pitfall U1 — this is the load-bearing 7.0.6 verification item.)**
- **D-13:** (UPDATED 2026-05-15 in CONTEXT.md) `set_default_index_set` pre-flights `GET /system/indices/index_sets/{id}` and reads `can_be_default: boolean`. If `can_be_default: false`, dry-run returns structured error with `reason: "default_eligibility_failed"`. Mitigates pitfall m2 and absorbs any future Graylog eligibility rules.
- **D-14:** (UPDATED 2026-05-15 in CONTEXT.md) `cycle_deflector` is SYNCHRONOUS in 7.0.6 (source-verified). Returns `{ rotated, message, side_effects.observable_at: "/system/jobs", side_effects.describes: "closed-index range rebuild" }`. No async envelope on the primary tool.
- **D-15:** (UPDATED 2026-05-15 in CONTEXT.md) Async envelope for tools that trigger Graylog system jobs (today: `delete_index_set` with `deleteIndices: true`) is `{ async: true, job_id_observable_at: "/system/jobs", message: "..." }`. `job_id` is DELIBERATELY ABSENT because Graylog's DELETE returns 204 with no body. `message` contains the target indexSetId so the agent can match the cleanup job's `info` field via `await_system_job(info_substring)`.
- **D-16:** Phase 0 D-07 (writable-flag short-circuit) applies uniformly. `delete_index_set` cannot execute against a `writable: false` connection regardless of the `deleteIndices` value — writable gate fires BEFORE destruction-confirmation gate.
- **D-17:** `create_index_set` dry-run uses the `__SERVER_ASSIGNED__` sentinel for the not-yet-known index-set ID. Established in Phase 0. Tool description warns against reusing the placeholder ID across a multi-step flow.

### Claude's Discretion

- **Discretion-01:** Exact module layout under `src/tools/index_sets/` (or `src/tools/index-sets/` — naming TBD by planner). Phase 1 per-domain folder precedent is the template.
- **Discretion-02:** Whether the alias-to-FQCN map lives in `src/tools/index_sets/strategies.js` (preferred) or inline in `schemas.js`.
- **Discretion-03:** Whether the FQCN map is also exposed via a `list_rotation_strategies` / `list_retention_strategies` tool for agent discovery, or whether tool descriptions are the discovery surface. Recommendation: tool descriptions only (closed and small set; a discovery tool would be wallpaper).
- **Discretion-04:** Exact `await_system_job` API surface — single `jobId` argument vs accepting either `jobId` or the full async-envelope object. Recommendation: the latter (forgiving input).
- **Discretion-05:** Snapshot fixture set design — refined in §Snapshot Fixture Design.

### Deferred Ideas (OUT OF SCOPE)

- **Archive retention strategy** — Graylog Enterprise feature; schema accepts `retention_strategy: "archive"` later if wired. Phase 2 ships `delete | close` only; archive rejects with "not yet supported in this milestone".
- **Strategy discovery tools** (`list_rotation_strategies`, `list_retention_strategies`) — not in scope; tool descriptions are the discovery surface.
- **Per-index-set messageCount projection in `list_index_sets`** — N stats calls; expensive. `list_index_sets` stays narrow-projected; `get_index_set` returns full DTO if the agent wants stats.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INDEX-01 | `list_index_sets` — narrow projection; flags default and writable status | §Endpoint Catalogue row 1; uses `defineListHandler` with `defaultFields: ["id","title","description","default","writable"]` |
| INDEX-02 | `get_index_set` — full DTO with retention/rotation strategies | §Endpoint Catalogue row 2 |
| INDEX-03 | `create_index_set` — supports time-based, size-based, and message-count rotation strategies; supports delete/close/archive retention strategies | §Strategy FQCN Map; §Strategy Config Schemas; §Endpoint Catalogue row 3; D-10 explicit-strategies; archive deferred |
| INDEX-04 | `update_index_set` — partial-update pattern | §Pitfall U1 (verify partial PUT against 7.0.6); D-11 atomic strategy-replace; D-12 strict no-echo |
| INDEX-05 | `delete_index_set` — `deleteIndices` defaults `false` (C1); when `true`, requires confirmation token; returns async system-job ID | §C1 Confirmation Hash Algorithm; §Endpoint Catalogue rows 4 + 7 + 8; D-01..D-05 |
| INDEX-06 | `set_default_index_set` — enforces `regular: true` invariant | §Set Default Pre-flight Algorithm; §Endpoint Catalogue row 5; D-13 |
| INDEX-07 | `cycle_deflector` — manual index rotation | §Cycle Deflector Behavior; §Endpoint Catalogue row 6 |
| INDEX-08 | `await_system_job` — poll `/system/jobs/{id}` for async-operation completion | §System Job Lifecycle; §await_system_job Polling Algorithm; D-06/D-07 |

## Project Constraints (from CLAUDE.md)

- **Tech stack:** Node.js ≥22.3.0 ESM (engines pinned post-Phase 0). **No new dependencies** beyond `@modelcontextprotocol/sdk`, `axios`, `zod`. `[VERIFIED: package.json]`
- **Single Graylog target:** 7.0.6 (live test instance at `<graylog-host>`). The `source-code/graylog2-server/` clone is 7.2.0-SNAPSHOT — forward-compat reference only. Verify shapes against 7.0.6 before "done".
- **Dry-run safety:** Every mutating tool MUST default to `dryRun: true`. Applying without an explicit `dryRun: false` is a bug. *(Phase 0's `defineMutatingHandler` enforces this structurally — Phase 2 only composes.)*
- **No web UI:** JSON-stringified text in MCP responses. No browser surface.
- **Code organization:** New admin tools extract into `src/tools/<domain>/` per-domain modules. Follow `src/tools/inputs/` precedent.
- **Backward compat:** Existing v2.3 read tools unchanged. Existing connection-config schema additive only.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `list_index_sets` / `get_index_set` (read) | MCP handler layer (`src/tools/index-sets/`) | Phase 0 HTTP client + `projectItem` | Composes `defineListHandler` (list) and plain async handler over `makeClient` (get). |
| `create_index_set` / `update_index_set` / `delete_index_set` (mutate) | MCP handler layer (`defineMutatingHandler`) | Phase 0 client + alias→FQCN mapper | All non-GET — wrapper handles writable gate + dryRun. `build()` is **async** (pre-flight GETs for stats + index list on delete; current-state GET on update). |
| `set_default_index_set` (mutate with pre-flight invariant) | MCP handler layer (`defineMutatingHandler`) | Phase 0 client | `build()` async — fetches the target's `regular` flag and surfaces a structured 409-style error in dry-run if `regular: false`. |
| `cycle_deflector` (mutate) | MCP handler layer (`defineMutatingHandler`) | Phase 0 client | `POST /system/deflector/{indexSetId}/cycle`. **§Cycle Deflector Behavior** — endpoint is synchronous in 7.0.6 source; D-14's async envelope shape must be a wrapper-supplied affordance, not a server contract. |
| `await_system_job` (cross-domain polling primitive) | New module `src/tools/_shared/system-job.js` | `defineMutatingHandler` shape per D-07 | Lives in `_shared/` because Phase 3+ async tools (stream delete → events propagation, pipeline rule apply) will reuse it. Phase 2 is the first consumer. |
| Alias→FQCN translation | New module `src/tools/index-sets/strategies.js` | — | Pure static table. Tests cover every alias maps to a known FQCN. |
| C1 confirmation hash | Pure helper `src/tools/index-sets/c1-hash.js` (or inline in `delete-index-set.js`) | — | sha-256 via `node:crypto` (already in tree from `src/tools/_shared/idempotency.js`). Pure: same inputs always same hash. |

This is a **single-tier (server)** MCP project. No client/server split, no SSR, no CDN.

## Standard Stack

### Core (already in Phase 0 — compose, don't add)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | 1.18.0 | MCP server framework | Locked dep per PROJECT.md `[VERIFIED: package.json]` |
| `axios` | 1.12.2 | HTTP client wrapped in `src/graylog/client.js` | Never call axios directly `[VERIFIED: package.json]` |
| `zod` | ^3.25.76 | Schema validation; per-domain `schemas.js` | Phase 0 adopted; `mutatingBase` / `listBase` are the extension points `[VERIFIED: package.json]` |
| `node:crypto` (built-in) | — | sha-256 for D-01 confirmation token + Phase 0 idempotency keys | Already used by `src/tools/_shared/idempotency.js:deriveIdempotencyKey` `[VERIFIED: src/tools/_shared/idempotency.js]` |

**No new dependencies required.** `[VERIFIED: package.json 2026-05-15]`

### Version verification

`[VERIFIED: package.json]` — All three production deps pinned at the same versions Phase 0 closed at. The `node:crypto` standard library covers D-01 sha-256 without any external lib (the same pattern Phase 0 used for idempotency-key derivation).

### Phase 0 + Phase 1 Primitives — Compose, Don't Rebuild

| Primitive | Module | What Phase 2 Composes Over |
|-----------|--------|----------------------------|
| `defineMutatingHandler({ name, schema, build, apply, summarize? })` with **async build** + `req.cascades` forwarding | `src/tools/_shared/handler.js` | Every Phase 2 mutating tool = one factory call. Async build is shipped (Plan 01-02 amendment). Cascades forwarding is shipped (Plan 01-02 BLOCKER #1 fix). `[VERIFIED: src/tools/_shared/handler.js:104-156]` |
| `defineListHandler({ name, schema, fetch, defaultFields? })` | `src/tools/_shared/list.js` | `list_index_sets` overrides `defaultFields` to `["id","title","description","default","writable"]` (INDEX-01: "flags default and writable status"). `[VERIFIED: src/tools/_shared/list.js:39-44]` |
| `mutatingBase` / `listBase` | `src/tools/_shared/schemas.js` | Per-domain schemas extend one of these |
| `makeClient(conn).request(method, path, body)` | `src/graylog/client.js` | All index-set API calls through this. `[VERIFIED: src/graylog/client.js:29-75]` |
| `toIdBody(response, hint)` | `src/graylog/normalize.js` | `create_index_set` response is the full DTO (see §Pitfall M2 / Endpoint Catalogue row 3) so `toIdBody(raw, { idFields: ["id"] })` already handles it correctly. |
| `SERVER_ASSIGNED_SENTINEL = "__SERVER_ASSIGNED__"` | `src/tools/_shared/dry-run.js` | `create_index_set.postApplyEstimate.id` (D-17) |
| `findExistingMatches({ listPath, matchFn })` | `src/tools/_shared/conflict.js` | `create_index_set` uses it on `/api/system/indices/index_sets` matching on `title` (M5 mitigation — same pattern Phase 1 used for `create_input`). `[VERIFIED: src/tools/_shared/conflict.js]` |
| `_connectionName` + `_conn` threaded through build args | `src/tools/_shared/handler.js:121` | Every mutating tool reads `args._conn` to make pre-flight GETs without a duplicate `resolveConnection` call. `[VERIFIED: src/tools/_shared/handler.js:121]` |
| Snapshot infrastructure (`t.assert.snapshot`) + `auth-redaction.test.js` regex-level `<...>` recognition | `test/snapshot-config.js`, `test/auth-redaction.test.js` | New `.snapshot` files auto-scanned; `<async>`, `<confirmationToken:...>` placeholders survive the lint without allowlist growth. `[VERIFIED: Plan 01-05 SUMMARY §Auth-redaction lint narrowed]` |
| `schema-parity.test.js` enrichment template | `test/schema-parity.test.js` | **MUST** extend with `assertSchemaParityForTool(toolName, zodSchema)` for every new mutating + list tool. `[VERIFIED: Plan 01-05 SUMMARY §12 schema-parity assertions]` |
| Async-build error wrapping via `wrapGraylogError` | `src/tools/_shared/handler.js:122-124` | Pre-flight GET failures in `build()` are caught and rendered as MCP error envelopes. Critical for D-05 (`stats_unreachable`). `[VERIFIED: src/tools/_shared/handler.js:122-124]` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `await_system_job` in `src/tools/_shared/system-job.js` | `src/tools/index-sets/await-system-job.js` (Phase 2 ownership, refactor later) | Phase 2-locality is fine for one consumer; cross-domain placement is correct since Phase 3+ stream cascades + Phase 4 pipeline rule apply will also reuse the polling primitive. **Recommendation: ship in `_shared/` from day one.** Discretion-04 context. |
| Alias→FQCN map in `strategies.js` | Inline in `schemas.js` | `schemas.js` already gets dense with 6 strict configs + 3 main schemas. Separating the mapping leaves both files <250 lines and matches the Phase 1 split (`schemas.js` vs `type-catalogue.js` vs `redact.js`). Discretion-02. |
| Block dry-run on `stats_unreachable` (D-05) | Warn-and-proceed | Confirmed locked. The agent cannot reason about destruction blast radius without `messageCount`; degraded preview would defeat the C1 mitigation. Explicit in CONTEXT.md §"Stats endpoint failure handling". |

## Architecture Patterns

### System Architecture Diagram

```
Agent (MCP client)
    │
    ▼
dispatch.js Map<toolName, handler>
    │
    ▼
src/tools/index-sets/{list,get,create,update,delete,set-default,cycle-deflector,await-system-job}.js
    │            │
    │            ├──► src/tools/index-sets/schemas.js (zod for inputs + 6 strategy configs)
    │            ├──► src/tools/index-sets/strategies.js (alias → FQCN map)
    │            └──► src/tools/_shared/system-job.js (await_system_job; cross-domain primitive)
    │
    ▼
defineMutatingHandler / defineListHandler (src/tools/_shared/)
    │
    │   ├─► zod validation
    │   ├─► resolveConnection
    │   ├─► writable-flag gate (D-16: BEFORE confirmation gate)
    │   ├─► idempotency key
    │   ├─► build() — async, may issue GET pre-flights:
    │   │     • delete_index_set: GET /system/indexer/indices/{id}/list
    │   │     •                 + GET /system/indices/index_sets/{id}?stats=true (D-05 gate)
    │   │     •                 → sha256(...) → confirmationToken
    │   │     • update_index_set: GET /system/indices/index_sets/{id} (current state)
    │   │     • set_default_index_set: GET /system/indices/index_sets/{id} (regular flag)
    │   ├─► dry-run? → preview JSON (D-04 explicit deleteIndices; D-13 invariant error;
    │   │              cascades for delete; postApplyEstimate __SERVER_ASSIGNED__ for create)
    │   └─► else apply() → client.request(method, path, body)
    │
    ▼
makeClient(conn).request → axios → Graylog 7.0.6
    │
    │   POST /system/indices/index_sets             (create)
    │   GET  /system/indices/index_sets[?stats=…]   (list / get stats)
    │   GET  /system/indices/index_sets/{id}        (get)
    │   PUT  /system/indices/index_sets/{id}        (update)
    │   DELETE /system/indices/index_sets/{id}?delete_indices=… (delete; C1 footgun query)
    │   PUT  /system/indices/index_sets/{id}/default (set default)
    │   POST /system/deflector/{indexSetId}/cycle    (cycle — synchronous in 7.0.6)
    │   GET  /system/indexer/indices/{id}/list      (D-02 index name source)
    │   GET  /system/jobs/{jobId}                    (await_system_job)
    │
    ▼
Async response envelope (when applicable):
    { async: true, job_id, job_id_observable_at: "/system/jobs", message }
        │
        └──► agent invokes await_system_job({ jobId }) → returns final SystemJobSummary OR timeout
```

### Component Responsibilities

| File | Responsibility |
|------|----------------|
| `src/tools/index-sets/index.js` | Side-effect register all 8 handlers into dispatch Map (per-domain barrel, imported by `src/tools/_register.js`) |
| `src/tools/index-sets/schemas.js` | Zod for the 6 input schemas + 6 strict strategy configs + the C1 `confirm` field gate |
| `src/tools/index-sets/strategies.js` | Pure `ALIAS_TO_FQCN` map + `aliasToConfig(alias, agentConfig)` translator (produces `{type, ...config}` for the wire) |
| `src/tools/index-sets/list-index-sets.js` | `defineListHandler` — INDEX-01 |
| `src/tools/index-sets/get-index-set.js` | Plain async handler — INDEX-02 |
| `src/tools/index-sets/create-index-set.js` | `defineMutatingHandler` — INDEX-03 |
| `src/tools/index-sets/update-index-set.js` | `defineMutatingHandler` — INDEX-04 (the strict no-echo + atomic strategy-replace) |
| `src/tools/index-sets/delete-index-set.js` | `defineMutatingHandler` — INDEX-05 (C1 confirmation hash + D-04 inverted default) |
| `src/tools/index-sets/set-default-index-set.js` | `defineMutatingHandler` — INDEX-06 (m2 pre-flight) |
| `src/tools/index-sets/cycle-deflector.js` | `defineMutatingHandler` — INDEX-07 |
| `src/tools/_shared/system-job.js` | `await_system_job` handler + polling state machine. Cross-domain primitive — INDEX-08, reused Phase 3+. |

### Recommended Module Structure

```
src/tools/index-sets/
├── index.js                       # Side-effect register all 8 handlers
├── schemas.js                     # Zod for tool args + 6 strict strategy configs
├── strategies.js                  # alias → FQCN map; aliasToConfig() translator
├── list-index-sets.js             # INDEX-01
├── get-index-set.js               # INDEX-02
├── create-index-set.js            # INDEX-03
├── update-index-set.js            # INDEX-04
├── delete-index-set.js            # INDEX-05 (C1 confirmation)
├── set-default-index-set.js       # INDEX-06 (m2 pre-flight)
└── cycle-deflector.js             # INDEX-07

src/tools/_shared/
└── system-job.js                  # NEW: await_system_job — INDEX-08, cross-domain primitive

test/
├── index-sets.test.js             # Domain tests (mirror test/inputs.test.js shape)
├── system-job.test.js             # await_system_job poll-state tests + timeout path
└── __snapshots__/
    ├── index-sets.test.js.snapshot
    └── system-job.test.js.snapshot
```

### Pattern 1: `defineMutatingHandler` with async build + cascades (canonical Phase 2 tool)

Source: `[VERIFIED: src/tools/_shared/handler.js:104-156]` and Phase 1 Plan 01-02 SUMMARY.

```js
// src/tools/index-sets/delete-index-set.js (skeleton)
import { defineMutatingHandler } from "../_shared/handler.js";
import { DeleteIndexSetSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { computeC1Hash } from "./c1-hash.js"; // or inline

export const handleDeleteIndexSet = defineMutatingHandler({
    name: "delete_index_set",
    schema: DeleteIndexSetSchema, // deleteIndices defaults false (D-04); confirm optional
    async build(args) {
        const conn = args._conn;
        const client = makeClient(conn);

        // D-03 path: deleteIndices=false → no preflight, no hash, no cascade beyond metadata
        if (args.deleteIndices === false) {
            return {
                method: "DELETE",
                path: `/api/system/indices/index_sets/${args.indexSetId}?delete_indices=false`,
                body: undefined,
                postApplyEstimate: { id: args.indexSetId, deletedIndices: false },
                // No cascade; the wrapper emits deleteIndices: false in the preview body explicitly.
            };
        }

        // D-02 + D-05: pre-flight to gather hash inputs.
        let indexNames; let messageCount;
        try {
            const indexList = await client.request("GET",
                `/api/system/indexer/indices/${args.indexSetId}/list`, null);
            indexNames = collectIndexNames(indexList); // see §C1 Confirmation Hash Algorithm
        } catch (err) {
            // 404 on the index list — index set already gone, or no indices yet.
            // Treat as empty (messageCount: 0). The DELETE will still surface 404 on apply.
            indexNames = [];
        }
        try {
            const stats = await client.request("GET",
                `/api/system/indices/index_sets/${args.indexSetId}?stats=true`, null);
            messageCount = stats?.stats?.documents ?? 0;
        } catch (err) {
            // D-05: stats failure HARD BLOCKS dry-run.
            return {
                _isErrorBuild: true,
                isError: true,
                reason: "stats_unreachable",
                content: [{ type: "text", text: JSON.stringify({
                    isError: true, reason: "stats_unreachable",
                    message: `Could not fetch stats for index set ${args.indexSetId}. ` +
                             `Refusing destructive dry-run. Check Elasticsearch health.`,
                }) }],
            };
        }

        const confirmationToken = computeC1Hash({
            indexSetId: args.indexSetId,
            deleteIndices: true,
            indexNames: [...indexNames].sort(), // D-02 sorted
            messageCount,
        });

        // D-16: writable gate already fired in the wrapper before build() ran.
        // D-15: emit the async envelope as part of postApplyEstimate so the agent
        //       sees the system-job pattern in the preview.
        return {
            method: "DELETE",
            path: `/api/system/indices/index_sets/${args.indexSetId}?delete_indices=true`,
            body: undefined,
            cascades: {
                indices: indexNames,         // surfaces as cascades.indices (D-05 visibility)
                messageCount,
            },
            postApplyEstimate: {
                id: args.indexSetId,
                async: true,
                job_id: "__SERVER_ASSIGNED__",     // job-id known only on apply
                job_id_observable_at: "/system/jobs",
                message: "IndexSetCleanupJob submitted; call await_system_job to wait.",
            },
            // D-01: surface the token in the preview alongside the apply hint
            _confirmationToken: confirmationToken,
        };
    },
    async apply(client, req) {
        // wrapper has already enforced confirm === confirmationToken if deleteIndices=true.
        await client.request(req.method, req.path, req.body);
        // Graylog returns 204; we cannot read the system_job_id from the DELETE response.
        // The agent observes /system/jobs to find the running IndexSetCleanupJob.
        return {
            async: true,
            job_id_observable_at: "/system/jobs",
            message: "Index set deleted; cleanup job running.",
        };
    },
    summarize: (args) => `Delete index set ${args.indexSetId} ` +
                         `(deleteIndices: ${args.deleteIndices ?? false})`,
});
```

**Wrapper-handler interaction needed:** the handler-factory currently emits an opt-in `cascades` block (Plan 01-02 amendment) and `postApplyEstimate.id` defaulted to `__SERVER_ASSIGNED__`. For Phase 2 we also need the wrapper to:

1. **Surface `_confirmationToken`** from `build()` into the dry-run JSON as `confirmationToken: <hex>` when `args.deleteIndices === true`. **Recommendation: one-line additive amendment to `handler.js`** (`...(req._confirmationToken ? { confirmationToken: req._confirmationToken } : {})`), mirroring the cascades-forwarding amendment from Plan 01-02. Pinned by snapshot.
2. **Apply-time validation:** when `args.confirm` is present AND `args.deleteIndices === true`, the wrapper must recompute the hash (by calling `build()`-after-zod, which is already what happens) and compare against `args.confirm`. Mismatch → `{ isError: true, reason: "confirmation_mismatch" }`. **Two options:** (a) wrapper extension (one more line); (b) gate inside `apply()`. Cleaner is option (a) — wrapper-level so the test contract is uniform across any future tool that wants a confirm token. **Recommendation:** wrapper-level. The planner picks.

### Pattern 2: Async build with D-05 hard-block

The pattern shown above demonstrates the **D-05 stats_unreachable hard-block**: when the pre-flight GET fails, `build()` returns a synthetic error envelope rather than throwing. The wrapper's `try/catch` around `build()` (`[VERIFIED: src/tools/_shared/handler.js:122-124]`) wraps a thrown error via `wrapGraylogError`, but for D-05 we want a **structured** error with `reason: "stats_unreachable"`, not the default error shape. The cleanest path is to **throw a typed `StatsUnreachableError` and let the wrapper surface its message via `wrapGraylogError`**, OR have the handler return a sentinel envelope directly. **Recommendation:** throw a typed error and let the wrapper render it; the wrapper-side error rendering path is already exercised in Plan 01-02 handler tests.

Either way: the handler-factory wrapper does NOT need a new amendment for D-05 — the existing async-build error path covers it. The planner picks the error-rendering approach.

### Pattern 3: Strict no-echo for `update_index_set` (D-12 — verify against 7.0.6)

The Phase 1 partial-update pattern (`agentConfig` sentinel; no copy-from-current) carries forward, **subject to Pitfall U1**:

- **Server-side reality:** `IndexSetUpdateRequest` (`[CITED: source-code/.../requests/IndexSetUpdateRequest.java]`) implements `TitleAndDescriptionFields`, `ShardsAndReplicasField`, `RotationAndRetentionFields`, `WritableField`, etc. — these are interfaces whose getters Jackson may treat as required at deserialization time.
- **The locked-decision intent (D-12):** updating just a title should NOT require re-asserting the rotation strategy on the wire.
- **What the planner must verify before Plan 1 ships:** Hit the live 7.0.6 instance at `<graylog-host>` with `PUT /api/system/indices/index_sets/{id}` carrying a **partial** body (e.g. `{ title: "renamed", description: "...", shards: 4, replicas: 0, writable: true }` — no strategy keys). If Graylog accepts and preserves the existing strategy, D-12 strict no-echo is feasible. If Graylog returns 400 "strategy class required", the planner must either (a) merge from current state (Phase 1 made this choice for `update_input` configuration; we resisted it because of C3, but C3 does NOT apply here — index-set configs carry no encrypted fields) OR (b) require the agent to pass the full update body.

  **Recommended fallback:** if D-12 strict no-echo is rejected by 7.0.6, copy non-strategy fields from `current` (title, description, shards, replicas, writable, fieldTypeRefreshInterval, etc.) and apply agent-supplied `changes` over them. This is the Phase 1 update-extractor pattern (merge-from-current, since extractors carry no encrypted fields either — [VERIFIED: Plan 01-04 SUMMARY §D-09 partial-update reuse]). Document the fallback as "Pitfall U1 mitigation" in the plan. **The C3 reason for strict-no-echo (encrypted-field masking) does NOT exist in the index-set domain**, so the safety story does not regress.

- **D-11 atomic strategy-replace:** when `args.changes.rotation_strategy` is present, `args.changes.rotation_strategy_config` MUST also be present (zod `superRefine`). Same for retention. Reject with structured error at the schema layer before `build()` runs.

### Pattern 4: `await_system_job` polling state machine

```js
// src/tools/_shared/system-job.js (skeleton)
import { defineMutatingHandler } from "./handler.js";
import { AwaitSystemJobSchema } from "./system-job-schemas.js"; // or inline in index-sets/schemas.js
import { makeClient } from "../../graylog/client.js";

const BACKOFF_SCHEDULE = [500, 1000, 2000, 4000, 5000]; // ms; last value repeats per D-06
const DEFAULT_TIMEOUT_MS = 60_000;

export const handleAwaitSystemJob = defineMutatingHandler({
    name: "await_system_job",
    schema: AwaitSystemJobSchema, // { jobId | jobIdOrEnvelope, timeoutMs?, _conn }
    async build(args) {
        // D-07: dry-run returns the polling plan and no GETs are issued.
        const jobId = extractJobId(args); // Discretion-04: accept envelope OR bare id
        const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        return {
            method: "GET",  // polling shape — nominal
            path: `/api/system/jobs/${jobId}`,
            body: undefined,
            postApplyEstimate: {
                jobId,
                plan: BACKOFF_SCHEDULE,
                timeoutMs,
                note: "Apply (dryRun:false) blocks until job completes or timeout fires.",
            },
        };
    },
    async apply(client, req) {
        const { jobId, timeoutMs } = req.postApplyEstimate;
        const deadline = Date.now() + timeoutMs;
        let i = 0;
        while (Date.now() < deadline) {
            const delay = BACKOFF_SCHEDULE[Math.min(i, BACKOFF_SCHEDULE.length - 1)];
            await sleep(delay);
            i++;
            try {
                const summary = await client.request("GET", req.path, null);
                // SystemJobSummary.percent_complete + job_status; see §System Job Lifecycle.
                if (summary.job_status === "complete" || summary.percent_complete === 100) {
                    return { jobId, completed: true, finalStatus: summary };
                }
                if (summary.job_status === "error" || summary.job_status === "cancelled") {
                    return { jobId, completed: false, finalStatus: summary };
                }
            } catch (err) {
                // 404 — job has completed and been pruned from the running-jobs map.
                // SystemJobResource.get returns 404 when the job is no longer running.
                // For our purposes, "no longer running" === "completed successfully" most of
                // the time. We surface this as completed:true with a synthesized status.
                if (err.status === 404) {
                    return { jobId, completed: true, finalStatus: { synthetic: true, reason: "job_no_longer_in_running_jobs" } };
                }
                throw err; // other errors bubble through wrapGraylogError
            }
        }
        return {
            jobId, completed: false, timedOut: true,
            message: `await_system_job timed out after ${timeoutMs}ms`,
        };
    },
    summarize: (args) => `Wait for system job ${extractJobId(args)}`,
});
```

The `_setCaptureRequest` test seam (`[VERIFIED: src/graylog/client.js:20-27]`) is the canonical way to drive the polling loop in tests without a live Graylog: pre-program a sequence of responses keyed on call-count.

### Anti-Patterns to Avoid

- **Per-handler `args.dryRun ?? true`** — Phase 0 enforces it once in `defineMutatingHandler`. Never re-add.
- **Synchronous hash computation in `apply()`** — the confirmation token MUST be computed in `build()` so dry-run and apply see the same inputs. `apply()` only verifies.
- **Issuing `DELETE ?delete_indices=true` from inside `cycle_deflector` or any other handler** — DELETE+true is reachable from `delete_index_set` only. Every other path uses `?delete_indices=false`.
- **Auto-blocking inside `cycle_deflector` or `delete_index_set` apply()** — D-14 says async tools return the envelope; the agent calls `await_system_job` explicitly. Auto-blocking would couple apply-time to job-completion-time and erase the explicit-orchestration story.
- **Polling without a deadline** — `await_system_job` MUST have a hard timeout (D-06: 60s default). An infinite poll loop hangs the MCP server.
- **Hand-rolling sha-256** — use `crypto.createHash("sha256")` per the Phase 0 `deriveIdempotencyKey` precedent. `[VERIFIED: src/tools/_shared/idempotency.js]`
- **Returning the synchronous-204 from `cycle_deflector` without surfacing the async envelope** — even when the endpoint is synchronous server-side (see §Cycle Deflector Behavior), the wrapper must consistently shape the envelope so blueprint chaining is uniform.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Confirmation hashing | Custom hash function | `node:crypto.createHash("sha256")` (Phase 0 precedent) | Built-in, FIPS-compliant, identical to `deriveIdempotencyKey` `[VERIFIED: src/tools/_shared/idempotency.js]` |
| Async-job polling | Custom backoff timers | `await_system_job` (this phase) | Phase 3+ reuses; one impl, one contract |
| Sleep / setTimeout primitives | Naked `await new Promise(r => setTimeout(r, ms))` | A tiny `sleep(ms)` helper in `_shared/system-job.js` | One place to add jitter or test-shim if needed later |
| Strategy class FQCN normalization | Allow agent FQCN passthrough | Strict alias enum (D-08) + `aliasToConfig()` translator | Prevents agent typos / invented class names from reaching Graylog (echo of C4 pipeline-rule discipline) |
| Index-name extraction from `/indexer/indices/{id}/list` | Walk the raw response in each tool | Single helper `collectIndexNames(indexList)` in `c1-hash.js` | The shape is `{ closed: ClosedIndices, reopened: ClosedIndices, all: OpenIndicesInfo }` — non-trivial to navigate; centralize once `[VERIFIED: source-code/.../AllIndices.java]` |
| Job-status detection | Custom `complete` test | Use `job_status === "complete" || percent_complete === 100` AND special-case 404 (pruned from running map) | The Graylog SystemJobResource.get returns 404 once a job exits the running-jobs map; this is the canonical "done" signal in practice `[VERIFIED: source-code/.../SystemJobResource.java:166]` |

**Key insight:** the index-set domain is mostly about **gating destructive operations behind structured pre-flights**. Every hand-rolled gate (per-tool dryRun check, per-tool stats fetch, per-tool hash compute) is one more chance to silently drop the safety. The composition pattern (build() does the gating, wrapper enforces dryRun-vs-apply, applies-time validation lives in the wrapper for the confirm-token case) makes the safety story structural.

## Endpoint Catalogue (per tool — verified against 7.2-SNAPSHOT, used as a forward-compat reference for 7.0.6)

| # | Tool | Method | Path | Request Body | Response | Status | Notes |
|---|------|--------|------|--------------|----------|--------|-------|
| 1 | `list_index_sets` | GET | `/api/system/indices/index_sets?skip=0&limit=N&stats=false` | — | `IndexSetsResponse { total: int, index_sets: IndexSetResponse[], stats: Map }` | 200 | `[VERIFIED: IndexSetsResource.java:141-160]` Envelope wraps the array under `index_sets`; `findExistingMatches` already handles this normalization via the `?? response?.streams ?? response?.extractors ?? response?.items ?? []` fallback chain — **note `index_sets` is NOT in that chain today; the planner must add it**, or `list_index_sets` returns its envelope explicitly. **Recommendation: add `?? response?.index_sets` to `src/tools/_shared/conflict.js` as a one-line additive amendment** (matches the Phase 1 normalization pattern). |
| 2 | `get_index_set` | GET | `/api/system/indices/index_sets/{id}` | — | `IndexSetResponse` (full DTO; see §IndexSetResponse Shape) | 200 / 403 / 404 | `[VERIFIED: IndexSetsResource.java:233-244]` |
| 2b | (get with stats, used by delete_index_set pre-flight) | GET | `/api/system/indices/index_sets/{id}/stats` | — | `IndexSetStats { indices: long, documents: long, size: long }` | 200 / 403 / 404 | **Path correction:** the live stats endpoint is `/{id}/stats`, NOT `/{id}?stats=true`. `[VERIFIED: IndexSetsResource.java:247-261]` — CONTEXT.md mentions both shapes; the **separate `/stats` path is correct for 7.0.6/7.2**. The `?stats=true` query param exists on the LIST endpoint, not the GET endpoint. Plan must use `/api/system/indices/index_sets/{id}/stats` for D-02 messageCount. |
| 3 | `create_index_set` | POST | `/api/system/indices/index_sets` | `IndexSetCreationRequest` (see §IndexSetCreationRequest Shape) | `IndexSetResponse` (full DTO) | 200 / 400 | `[VERIFIED: IndexSetsResource.java:263-293]` **The response is the full IndexSetResponse, not just an id**, contrary to PITFALLS.md §M2 row "201 Full IndexSetResponse". The response is **200**, not 201 — confirmed at line 270 (`@ApiResponse(responseCode = "200")`). `toIdBody(raw, { idFields: ["id"] })` already handles full DTOs. |
| 4 | `update_index_set` | PUT | `/api/system/indices/index_sets/{id}` | `IndexSetUpdateRequest` (see §IndexSetUpdateRequest Shape — **VERIFY PARTIAL ACCEPTANCE AGAINST 7.0.6, see Pitfall U1**) | `IndexSetResponse` (full DTO) | 200 / 403 / 404 / 409 | `[VERIFIED: IndexSetsResource.java:295-334]` Returns 409 if you try to set `writable: false` on the default index set. |
| 5 | `set_default_index_set` | PUT | `/api/system/indices/index_sets/{id}/default` | — (empty body) | `IndexSetResponse` (full DTO) | 200 / 403 / 404 / 409 | `[VERIFIED: IndexSetsResource.java:343-368]` Server validates `isRegularIndex()` and returns 409 if not regular (m2). D-13 pre-flight surfaces this in dry-run BEFORE apply. |
| 6 | `cycle_deflector` | POST | `/api/system/deflector/{indexSetId}/cycle` | — (empty body) | **(void, no body returned)** | 204 / 400 (non-writable index set) | `[VERIFIED: DeflectorResource.java:109-126]` Returns `void` — no system_job_id on the wire. The cycle is synchronous (calls `indexSet.cycle()` directly, not `systemJobManager.submit(...)`). **See §Cycle Deflector Behavior.** Deprecated `/system/deflector/cycle` (without `{indexSetId}`) at line 89-107 cycles the **default** index set. |
| 7 | `delete_index_set` | DELETE | `/api/system/indices/index_sets/{id}?delete_indices=true|false` | — | (void, 204 No Content) | 204 / 400 (default index set) / 403 / 404 | `[VERIFIED: IndexSetsResource.java:370-411]` **The C1 footgun.** `@DefaultValue("true")` at line 383. Submits `IndexSetCleanupJob` async when `delete_indices=true` AND deletion succeeded. Returns 204 even though the job runs in background. **Deleting the default index set returns 400** with "Default index set cannot be deleted." |
| 8 | (D-02 hash input source) | GET | `/api/system/indexer/indices/{indexSetId}/list` | — | `AllIndices { closed: ClosedIndices, reopened: ClosedIndices, all: OpenIndicesInfo }` | 200 / 403 / 404 | `[VERIFIED: IndicesResource.java:262-269 + AllIndices.java]` See §Collecting Index Names for the extraction logic — index names come from each sub-collection's name field. |
| 9 | `await_system_job` (poll target) | GET | `/api/system/jobs/{jobId}` | — | `SystemJobSummary` (see §SystemJobSummary Shape) | 200 / 404 (job no longer in running map — treat as completed) | `[VERIFIED: SystemJobResource.java:132-167]` |

### Notes on response-shape inconsistencies (relative to PITFALLS.md §M2)

| Endpoint | PITFALLS.md M2 claim | Verified behavior in 7.2-SNAPSHOT |
|----------|----------------------|------------------------------------|
| `POST /system/indices/index_sets` | "200 Full IndexSetResponse" | **CONFIRMED.** Returns 200 + full `IndexSetResponse` DTO including the assigned `id`. `toIdBody` extracts `id` correctly. `[VERIFIED: IndexSetsResource.java:270 + 286]` |
| `DELETE /system/indices/index_sets/{id}` | Not in M2 table | 204 No Content, no body. **Job-id is NOT returned on the wire** — the agent observes `/system/jobs` to discover the running `IndexSetCleanupJob`. The wrapper's D-15 envelope MUST acknowledge this: `job_id` cannot be filled at apply-time; only `job_id_observable_at: "/system/jobs"` is provable. The agent then calls `await_system_job` with `jobIdOrEnvelope: { job_id_observable_at: "/system/jobs" }` and a discovery step is needed — OR `await_system_job` accepts a "list and pick the newest IndexSetCleanupJob" mode. **Recommendation:** ship `await_system_job` requiring an explicit `jobId`; the agent discovers via `GET /system/jobs` and picks the matching one. Add a tool description note to this effect. |
| `POST /system/deflector/{indexSetId}/cycle` | "Cycle is destructive of current write index" (m3) | **CONFIRMED + the source method is `void`.** Cycle is synchronous (no `systemJobManager.submit`). D-14's async envelope is a wrapper-supplied affordance — see §Cycle Deflector Behavior. |

## C1 Confirmation Hash Algorithm (D-01/D-02 — the centerpiece)

```js
// src/tools/index-sets/c1-hash.js  (recommended location)
import { createHash } from "node:crypto";

/**
 * Compute the deterministic confirmation hash for delete_index_set.
 * Inputs MUST be canonicalized in the order below; any drift invalidates
 * the dry-run → apply binding.
 *
 * @param {object} inputs
 * @param {string} inputs.indexSetId
 * @param {true} inputs.deleteIndices  // locked literal — replay protection
 * @param {string[]} inputs.indexNames // sorted array
 * @param {number} inputs.messageCount
 * @returns {string} 64-hex sha-256
 */
export function computeC1Hash({ indexSetId, deleteIndices, indexNames, messageCount }) {
    if (deleteIndices !== true) {
        throw new Error("computeC1Hash called with deleteIndices !== true — refusing");
    }
    const canonical = JSON.stringify({
        indexSetId,
        deleteIndices: true,
        indexNames: [...indexNames].sort(),
        messageCount,
    });
    return createHash("sha256").update(canonical).digest("hex");
}
```

**Wrapper integration (D-01 apply-time validation):** Two implementation options.

**Option A — wrapper-level confirm check (recommended):** Extend `defineMutatingHandler` with one more spec slot, e.g. `requireConfirm({ args, req }) → string | null`. If non-null, the wrapper checks `args.confirm === <token>` at apply-time and refuses with `{ isError: true, reason: "confirmation_mismatch" }` if mismatched. This puts the confirm-token contract in the same factory layer as the writable-flag gate (D-16), making the precedence ordering structural:

```
1. zod.parse
2. resolveConnection
3. writable gate (D-07, D-16)        ← BEFORE confirmation gate
4. idempotency key
5. build() (async; may compute confirmationToken)
6. dry-run? emit preview JSON (with confirmationToken)
7. else: confirmation gate (D-01)    ← if requireConfirm yields a token,
                                        check args.confirm matches; else refuse
8. apply()
9. normalize
```

**Option B — gate inside `delete_index_set.apply()`:** Keep the wrapper unchanged; the delete handler recomputes the hash inside `apply()` and compares against `args.confirm`. Simpler to ship (no wrapper amendment) but couples the confirmation pattern to `delete_index_set` and bumps the apply-call's pre-flight overhead (a second sequence of GETs because the build()-computed token is gone by apply() time).

**Recommendation:** Option A. The wrapper amendment is small (5-10 lines) and the confirmation pattern is reusable for any future destructive tool that needs a guardrail (e.g. blueprint `setup_long_term_archival_index` could reuse it for the final-step "delete temporary intermediate index set"). Test contract uniform across the surface.

### Collecting index names from `AllIndices`

```js
// src/tools/index-sets/c1-hash.js
export function collectIndexNames(allIndices) {
    // AllIndices.closed.indices is a Set<String>
    // AllIndices.reopened.indices is a Set<String>
    // AllIndices.all is OpenIndicesInfo with a `indices: Map<String, IndexInfo>` shape;
    //   the keys ARE the index names.
    const names = new Set();
    for (const name of allIndices?.closed?.indices ?? []) names.add(name);
    for (const name of allIndices?.reopened?.indices ?? []) names.add(name);
    for (const name of Object.keys(allIndices?.all?.indices ?? {})) names.add(name);
    return [...names]; // unsorted here; computeC1Hash sorts before hashing
}
```

`[VERIFIED: source-code/.../AllIndices.java]` — fields `closed`, `reopened`, `all`. Sub-shapes `ClosedIndices` (Set<String> + count) and `OpenIndicesInfo` (Map<String, IndexInfo>).

### Hash inputs for an empty index set

When the index set exists but contains no managed indices (e.g. brand-new, never rotated): `indexNames = []`, `messageCount = 0`. The hash is still computed and emitted in the preview. Apply still requires `confirm === <hash>`. This is **intentional** (D-03 only frees the confirm-token gate when `deleteIndices: false`).

## Strategy FQCN Map (D-08 — alias → wire payload)

`[VERIFIED: source-code/.../indexer/rotation/strategies/*.java + indexer/retention/strategies/*.java]`

| Alias | FQCN (used in `rotation_strategy_class` / `retention_strategy_class`) | Config FQCN (used in `*_strategy.type`) | Config shape (alias's `*_strategy_config`) |
|-------|-----|-----|-----|
| `"time-based"` | `org.graylog2.indexer.rotation.strategies.TimeBasedRotationStrategy` | `org.graylog2.indexer.rotation.strategies.TimeBasedRotationStrategyConfig` | `{ rotation_period: "P1D", max_rotation_period?: "P30D", rotate_empty_index_set?: boolean }` |
| `"size-based"` | `org.graylog2.indexer.rotation.strategies.SizeBasedRotationStrategy` | `org.graylog2.indexer.rotation.strategies.SizeBasedRotationStrategyConfig` | `{ max_size: number }` (bytes; `@Min(1)`) |
| `"message-count"` | `org.graylog2.indexer.rotation.strategies.MessageCountRotationStrategy` | `org.graylog2.indexer.rotation.strategies.MessageCountRotationStrategyConfig` | `{ max_docs_per_index: number }` (`@Min(1)`) |
| `"delete"` | `org.graylog2.indexer.retention.strategies.DeletionRetentionStrategy` | `org.graylog2.indexer.retention.strategies.DeletionRetentionStrategyConfig` | `{ max_number_of_indices: number }` (`@Min(1)`) |
| `"close"` | `org.graylog2.indexer.retention.strategies.ClosingRetentionStrategy` | `org.graylog2.indexer.retention.strategies.ClosingRetentionStrategyConfig` | `{ max_number_of_indices: number }` (`@Min(1)`) |
| `"archive"` (deferred — schema accepts but `aliasToConfig` rejects with structured error) | `org.graylog.plugins.archive.retention.ArchiveRetentionStrategy` (Enterprise, not in OSS source) | — | — — `aliasToConfig("archive")` returns `{ isError: true, reason: "archive_not_supported" }` |

**Time period shape note:** `TimeBasedRotationStrategyConfig.rotation_period` is a Joda `Period` deserialized from ISO-8601 duration syntax (`"P1D"`, `"PT1H"`, `"P30D"`). `[VERIFIED: TimeBasedRotationStrategyConfig.java:25 — `Period DEFAULT_DAYS = Period.days(1)`]`. The zod schema should validate the string with a regex (`^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$`) OR accept it as `z.string().min(2)` and let Graylog 400 on malformed values.

**TimeBasedSizeOptimizingStrategy:** also exists in the source tree (`"time-size-optimizing"` NAME), but is **not** in the D-08 alias set. Deferred — adding it would be a one-line entry in `strategies.js`.

**NoopRetentionStrategy:** has `NAME = "none"`. Also not in the D-08 alias set. The plan author may choose to add it explicitly as `retention_strategy: "noop"` if the agent needs an explicit "never delete or close" strategy, but D-08 locks the set to `{delete, close}` — and `delete` with `max_number_of_indices: 99999999` is a workable equivalent. **Recommendation:** ship `{delete, close}` only; document in tool description.

### `aliasToConfig` translator (D-08 shape)

```js
// src/tools/index-sets/strategies.js  (excerpt)
const ROTATION_FQCN = {
    "time-based": {
        cls: "org.graylog2.indexer.rotation.strategies.TimeBasedRotationStrategy",
        configType: "org.graylog2.indexer.rotation.strategies.TimeBasedRotationStrategyConfig",
    },
    "size-based": {
        cls: "org.graylog2.indexer.rotation.strategies.SizeBasedRotationStrategy",
        configType: "org.graylog2.indexer.rotation.strategies.SizeBasedRotationStrategyConfig",
    },
    "message-count": {
        cls: "org.graylog2.indexer.rotation.strategies.MessageCountRotationStrategy",
        configType: "org.graylog2.indexer.rotation.strategies.MessageCountRotationStrategyConfig",
    },
};
const RETENTION_FQCN = {
    "delete": {
        cls: "org.graylog2.indexer.retention.strategies.DeletionRetentionStrategy",
        configType: "org.graylog2.indexer.retention.strategies.DeletionRetentionStrategyConfig",
    },
    "close": {
        cls: "org.graylog2.indexer.retention.strategies.ClosingRetentionStrategy",
        configType: "org.graylog2.indexer.retention.strategies.ClosingRetentionStrategyConfig",
    },
};

export function buildRotationBlock(alias, agentConfig) {
    const map = ROTATION_FQCN[alias];
    if (!map) throw new Error(`Unknown rotation strategy alias: ${alias}`);
    return {
        rotation_strategy_class: map.cls,
        rotation_strategy: { type: map.configType, ...agentConfig },
    };
}
// Symmetric buildRetentionBlock(alias, agentConfig) — emits retention_strategy_class + retention_strategy.
```

The wire shape pairs `*_strategy_class: <FQCN>` at the index-set top level with `*_strategy: {type: <ConfigFQCN>, ...config}` (Jackson polymorphism: `@JsonTypeInfo(use=CLASS, property="type")` on `RotationStrategyConfig` and `RetentionStrategyConfig` interfaces — `[VERIFIED: plugin/indexer/rotation/RotationStrategyConfig.java:22-24 + plugin/indexer/retention/RetentionStrategyConfig.java:24-28]`).

## System Job Lifecycle (INDEX-08 — `await_system_job`)

`[VERIFIED: source-code/.../SystemJobResource.java + SystemJobSummary.java + JobTriggerStatus.java]`

### Polling endpoint

`GET /api/system/jobs/{jobId}` returns `SystemJobSummary`:

```json
{
  "id": "76137600-67c0-11ed-be4e-bb6a8b21bdb6",
  "description": "Cleanup of Index Set <…>",
  "name": "org.graylog2.indexer.indices.jobs.IndexSetCleanupJob",
  "info": "Deleted index <graylog_0>",
  "node_id": "01234567-89ab-cdef-0123-456789abcdef",
  "started_at": "2026-05-15T11:58:08.466Z",
  "execution_duration": 4520,
  "percent_complete": 47,
  "is_cancelable": false,
  "provides_progress": true,
  "job_status": "running"
}
```

`job_status` is `JobTriggerStatus` (`[VERIFIED: source-code/.../JobTriggerStatus.java]`):

| Value | Meaning | `await_system_job` action |
|-------|---------|---------------------------|
| `"runnable"` | Ready to be locked by a node | continue polling |
| `"running"` | Locked and executing | continue polling |
| `"complete"` | Finished successfully; one-off jobs sit here | **return success** |
| `"paused"` | Manually paused | **return error** (`paused`) |
| `"error"` | Failed; needs human intervention | **return error** (`failed`) |
| `"cancelled"` | Manually aborted | **return error** (`cancelled`) |

### 404 on the poll endpoint — "job has finished and was pruned"

`SystemJobResource.get` returns 404 when the jobId is no longer in the legacy running-jobs map nor in the new `SystemJobManager`'s running-jobs view. `[VERIFIED: SystemJobResource.java:166]` — `throw new NotFoundException("No system job with ID <" + jobId + "> found")`. For polling, this is **the canonical "completed and gone" signal**. The wrapper interprets the FIRST 404 after a non-404 success as `completed: true`. (If the very first poll is 404, treat as `completed: true` with `synthetic: true` flag — the job ran fast or the jobId was stale.)

### Backoff schedule (D-06)

```
poll  1: wait 500ms,  GET, parse status
poll  2: wait 1000ms, GET, parse status
poll  3: wait 2000ms, GET, parse status
poll  4: wait 4000ms, GET, parse status
poll 5+: wait 5000ms, GET, parse status (caps at 5s)
```

Default timeout 60s → up to **12 poll attempts** in the steady state. Cumulative wait at timeout: ~500ms + 1s + 2s + 4s + 5s×8 = 47.5s, plus the GET RTT × 12. Realistic for indexset-cleanup jobs (seconds to minutes per index).

### Configurable timeout

`timeoutMs` optional in args; default 60_000. Plan should document hard ceilings (e.g. 600_000ms / 10 minutes max) to prevent agents from hanging the server with `timeoutMs: 999999999`. **Recommendation:** zod `.max(600_000)` on the timeoutMs field.

### Test seam

Use `_setCaptureRequest((req) => …)` from `src/graylog/client.js` to feed scripted responses to the polling loop. Test contract: pre-program a sequence like `[ "running 25%", "running 50%", "running 90%", "complete 100%" ]` and assert the loop terminates with `completed: true` on the 4th poll.

For the timeout-path test: pre-program a sequence that NEVER returns `complete`/`error` and set `timeoutMs: 50` (the BACKOFF_SCHEDULE first wait is 500ms; the loop sleeps and re-checks deadline — must exit immediately). **Caveat:** the loop sleeps BEFORE polling, so a `timeoutMs: 0` shortcut exits before the first poll. Test the loop's deadline-check placement: deadline check should fire after each sleep, before the next GET, so the loop terminates as soon as the deadline passes regardless of how many polls have completed.

## Cycle Deflector Behavior (INDEX-07 — D-14 verification)

`[VERIFIED: source-code/.../DeflectorResource.java:109-126]`

```java
@POST
@Path("/{indexSetId}/cycle")
@RestrictToLeader
@AuditEvent(type = AuditEventTypes.ES_WRITE_INDEX_UPDATE_JOB_START)
public void cycle(@PathParam("indexSetId") String indexSetId) {
    final IndexSet indexSet = getIndexSet(indexSetRegistry, indexSetId);
    checkCycle(indexSet);
    // ... LOG + activityWriter.write(...) ...
    indexSet.cycle();
}
```

**Three load-bearing facts from the source:**

1. **Return type is `void`.** No body, no system_job_id. HTTP response is 204 No Content (or whatever JAX-RS defaults to for void-returning POST — typically 204).
2. **`indexSet.cycle()` is called directly** — NOT via `systemJobManager.submit(...)`. The cycle is **synchronous** on the JVM thread that handled the HTTP request. When the HTTP response returns, the cycle has happened. **D-14's async envelope is NOT backed by a server-side system job in 7.0.6/7.2.**
3. **`@RestrictToLeader`** — only the cluster leader node handles the cycle. If you hit a non-leader, the cluster routes internally; the agent sees a 200/204 from whichever node it called.

**What this means for D-14:** The CONTEXT.md decision says "cycle_deflector returns `{ async: true, job_id, job_id_observable_at: "/system/jobs", note: "Call await_system_job to wait for completion." }`". This is **wrong as written** — there is no server-side job to await. **Two ways to reconcile:**

**Option A — strip the async envelope from cycle_deflector** and return `{ async: false, completed: true, indexSetId, message: "Deflector cycled. New write index will be visible momentarily." }`. The cycle IS effectively complete by the time the HTTP response returns, modulo Elasticsearch's own index-aliasing latency (a few seconds in practice — that's the m3 brief gap pitfall). The agent does NOT need to call `await_system_job`. **(Recommended.)** The plan author updates D-14 to reflect this.

**Option B — keep the uniform async envelope** for blueprint chaining (D-14's intent) but mark the job_id as observational only: `{ async: true, job_id_observable_at: "/system/jobs" }` WITHOUT a `job_id`. The agent calling `await_system_job` against a missing jobId is a no-op-with-error. This preserves the uniform envelope shape across all mutating tools but lies about the actual mechanism. **(Not recommended — lies are debt.)**

**Decision needed from the plan author** (this is the load-bearing 7.0.6 verification point for INDEX-07 — recommend Option A and update CONTEXT.md D-14 in a follow-up). If the live `<graylog-host>` instance ever DOES return a job_id in some plugin-loaded path, the planner can flip to Option B. But the OSS source path is synchronous.

### Index-range rebuild after cycle (related m5)

When `indexSet.cycle()` closes the current write index, Graylog kicks off an **index-range rebuild** as a system job on the closed index (so search can find messages from it). `[CITED: PITFALLS.md §m5]`. This is a **side-effect** the agent should know about. Tool description for `cycle_deflector` MUST mention:

> "Cycling closes the current write index and creates the next one. In-flight writes may briefly buffer until the new index is ready. The closed index will then have its message-range index rebuilt asynchronously; the rebuild is observable via `GET /system/jobs` but is not strictly necessary for routing new messages — only for searching the just-closed index by time range."

## Set Default Pre-flight Algorithm (INDEX-06 — D-13 + m2 mitigation)

`[VERIFIED: source-code/.../IndexSetsResource.java:343-368]`

Server logic:
```java
if (!indexSet.isRegularIndex()) {
    throw new ClientErrorException("Index set not eligible as default", Response.Status.CONFLICT);
}
clusterConfigService.write(DefaultIndexSetConfig.create(indexSet.id()));
```

`isRegularIndex()` returns true when the index set is `isWritable() && (isRegular().orElse(true))` AND the index template type is the default (`MessageIndexTemplateProvider.MESSAGE_TEMPLATE_TYPE`) — `[VERIFIED: IndexSetConfig.java:262-276]`.

**The IndexSetResponse DTO exposes the result as `can_be_default: boolean`** (`[VERIFIED: IndexSetResponse.java:46 + 66]`). This is the pre-flight check field — NOT `regular: boolean` (which is the underlying setting; absent for system index sets that derive regularness from template type).

**Pre-flight algorithm:**

```js
// inside set-default-index-set.js build()
const current = await client.request("GET",
    `/api/system/indices/index_sets/${args.indexSetId}`, null);

if (current.can_be_default === false) {
    // Surface the 409 in dry-run BEFORE any PUT is attempted.
    // The wrapper renders this as { isError: true, reason: "default_eligibility_failed" } (UPDATED D-13).
    throw new NonRegularIndexSetError(
        `Index set "${current.title}" (${args.indexSetId}) is not eligible as the default index set ` +
        `(can_be_default: false). This typically means it's an events-style or system index set. ` +
        `Default index sets must be writable + regular + use the standard message template.`
    );
}

// Pre-flight passed — emit the PUT request.
return {
    method: "PUT",
    path: `/api/system/indices/index_sets/${args.indexSetId}/default`,
    body: undefined,
    postApplyEstimate: { id: args.indexSetId, isDefault: true },
};
```

`NonRegularIndexSetError` extends `GraylogError` with `status: 409` so `wrapGraylogError` renders it cleanly — or the planner ships a new sentinel reason via the typed-error hierarchy. Either path produces a structured dry-run error before any apply attempt (D-13's "surface the 409 in dry-run").

## IndexSetResponse Shape (full DTO; INDEX-02 returns this; create/update returns this)

`[VERIFIED: source-code/.../IndexSetResponse.java + IndexSetConfig.java]`

```json
{
  "id": "63b3e5f0a1d2c4e5f6789abc",
  "title": "Default index set",
  "description": "The Graylog default index set",
  "default": true,
  "writable": true,
  "can_be_default": true,
  "index_prefix": "graylog",
  "shards": 4,
  "replicas": 0,
  "rotation_strategy_class": "org.graylog2.indexer.rotation.strategies.TimeBasedRotationStrategy",
  "rotation_strategy": {
    "type": "org.graylog2.indexer.rotation.strategies.TimeBasedRotationStrategyConfig",
    "rotation_period": "P1D",
    "max_rotation_period": null,
    "rotate_empty_index_set": false
  },
  "retention_strategy_class": "org.graylog2.indexer.retention.strategies.DeletionRetentionStrategy",
  "retention_strategy": {
    "type": "org.graylog2.indexer.retention.strategies.DeletionRetentionStrategyConfig",
    "max_number_of_indices": 30
  },
  "creation_date": "2024-01-12T12:34:56.789Z",
  "index_analyzer": "standard",
  "index_optimization_max_num_segments": 1,
  "index_optimization_disabled": false,
  "field_type_refresh_interval": 5000,
  "index_template_type": null,
  "field_type_profile": null,
  "data_tiering_config": null,
  "data_tiering_status": null,
  "use_legacy_rotation": true,
  "field_restrictions": null
}
```

`list_index_sets` returns `IndexSetsResponse { total, index_sets: IndexSetResponse[], stats: Map<id, IndexSetStats> }`.

**Default narrow projection for `list_index_sets`** (INDEX-01 "flags default and writable status"):

```js
defaultFields: ["id", "title", "description", "default", "writable", "can_be_default", "index_prefix"]
```

## IndexSetCreationRequest Shape (INDEX-03 — request body)

`[VERIFIED: source-code/.../IndexSetCreationRequest.java + IndexSetConfig.java]`

Required fields the wrapper must emit:
```json
{
  "title": "App errors",
  "description": "Stream-routed errors index set",
  "index_prefix": "app_errors",
  "shards": 4,
  "replicas": 0,
  "rotation_strategy_class": "<rotation FQCN per alias>",
  "rotation_strategy": { "type": "<config FQCN>", ...rotation_strategy_config },
  "retention_strategy_class": "<retention FQCN per alias>",
  "retention_strategy": { "type": "<config FQCN>", ...retention_strategy_config },
  "index_analyzer": "standard",
  "index_optimization_max_num_segments": 1,
  "index_optimization_disabled": false,
  "field_type_refresh_interval": 5000,
  "writable": true,
  "use_legacy_rotation": true,
  "creation_date": "<ISO-8601>"
}
```

**Sensible defaults to ship in the zod schema** (so the agent doesn't have to specify every field):
- `description`: empty string (optional)
- `shards`: 4 (Graylog UI default)
- `replicas`: 0 (single-node default)
- `index_analyzer`: `"standard"`
- `index_optimization_max_num_segments`: 1
- `index_optimization_disabled`: false
- `field_type_refresh_interval`: 5000 (5s; the Java default `[VERIFIED: IndexSetConfig.java:96-99]`)
- `writable`: true
- `use_legacy_rotation`: true (we're not shipping data-tiering this phase — that's a Graylog 7+ feature with its own config block)
- `creation_date`: `new Date().toISOString()` (the wrapper fills this; the agent doesn't pass it)

**D-10 reminder:** Rotation strategy + retention strategy + their configs are **required** with NO defaults. The agent must pass them every time.

## IndexSetUpdateRequest Shape (INDEX-04 — request body)

`[VERIFIED: source-code/.../IndexSetUpdateRequest.java + IndexSetConfig.java]`

**Pitfall U1 (load-bearing — verify against 7.0.6 before Plan 1 GREEN):**

The `IndexSetUpdateRequest` AutoValue declares getters via `TitleAndDescriptionFields`, `ShardsAndReplicasField`, `RotationAndRetentionFields`, `UseLegacyRotationField`, `WritableField`, `FieldTypeProfileField`, `FieldRestrictionsField`. AutoValue + Jackson by default treats AutoValue-getter-derived fields as **required for deserialization** — meaning `PUT /system/indices/index_sets/{id}` with a partial body (e.g. just `{ title: "renamed", description: "...", shards: 4, replicas: 0, writable: true }` and no strategy keys) **MAY return 400 Bad Request** complaining about missing rotation/retention.

**Plan-1 verification step:** First action of the Phase 2 implementation plan is a smoke test against `<graylog-host>`:

```bash
# Smoke 1: partial update without strategy keys
curl -X PUT -u "$TOKEN:token" \
  -H "Content-Type: application/json" \
  -H "X-Requested-By: graylog-mcp" \
  "$BASE_URL/api/system/indices/index_sets/<existing-id>" \
  -d '{"title":"smoke-renamed","description":"...","shards":4,"replicas":0,"writable":true,"index_optimization_max_num_segments":1,"index_optimization_disabled":false,"field_type_refresh_interval":5000}'
```

- **If 200:** D-12 strict no-echo confirmed feasible. Wrapper emits ONLY the agent-supplied fields plus the minimum-required envelope. `update_index_set` mirrors Phase 1 `update_input` exactly.
- **If 400:** Pitfall U1 confirmed. **Fall back to merge-from-current**: the wrapper fetches the current IndexSetResponse, applies `args.changes` over the top, and emits the full PUT body. **This is acceptable** because index-set configs carry no encrypted fields (the C3 pitfall is not reachable here), so the round-trip is safe. Document the deviation explicitly: "D-12 strict no-echo NOT applicable to update_index_set due to Graylog server-side requiredness; merge-from-current used instead. Agent still sees only the changed fields in `summarize()`; the wire body is the full DTO."

**Either way:** the dry-run preview should highlight the **agent-requested changes** vs. the **full wire body** (e.g. `summarize: (args) => "Update index set X (3 changes: title, shards, replicas)"`). The agent can read what they asked for; the wrapper handles the protocol.

### D-11 atomic strategy-replace zod

```js
const UpdateIndexSetSchema = mutatingBase.extend({
    indexSetId: z.string().min(1),
    changes: z.object({
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        shards: z.number().int().positive().optional(),
        replicas: z.number().int().nonnegative().optional(),
        writable: z.boolean().optional(),
        rotation_strategy: z.enum(["time-based", "size-based", "message-count"]).optional(),
        rotation_strategy_config: z.unknown().optional(), // narrowed by superRefine
        retention_strategy: z.enum(["delete", "close"]).optional(),
        retention_strategy_config: z.unknown().optional(),
        index_optimization_max_num_segments: z.number().int().positive().optional(),
        index_optimization_disabled: z.boolean().optional(),
        field_type_refresh_interval: z.number().int().nonnegative().optional(),
        index_analyzer: z.string().optional(),
    }).refine((c) => Object.keys(c).length > 0,
              { message: "changes must be non-empty" })
      .superRefine((c, ctx) => {
          // D-11: atomic strategy-replace.
          if (c.rotation_strategy !== undefined && c.rotation_strategy_config === undefined) {
              ctx.addIssue({ code: "custom",
                  path: ["rotation_strategy_config"],
                  message: "rotation_strategy_config is required when rotation_strategy is provided (D-11 atomic strategy-replace)" });
          }
          if (c.rotation_strategy_config !== undefined && c.rotation_strategy === undefined) {
              ctx.addIssue({ code: "custom",
                  path: ["rotation_strategy"],
                  message: "rotation_strategy is required when rotation_strategy_config is provided (D-11 atomic strategy-replace)" });
          }
          // Same pair-check for retention.
          if (c.retention_strategy !== undefined && c.retention_strategy_config === undefined) {
              ctx.addIssue({ code: "custom", path: ["retention_strategy_config"],
                  message: "retention_strategy_config is required when retention_strategy is provided (D-11)" });
          }
          if (c.retention_strategy_config !== undefined && c.retention_strategy === undefined) {
              ctx.addIssue({ code: "custom", path: ["retention_strategy"],
                  message: "retention_strategy is required when retention_strategy_config is provided (D-11)" });
          }
          // Further: validate the strategy_config shape against its declared strategy.
          // (Mirrors the variantMap superRefine pattern from CreateInputSchema.)
      }),
});
```

## Strategy Config Schemas (D-09 — 6 strict configs)

```js
// src/tools/index-sets/schemas.js (excerpt)
const ISO_DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/;

const TimeBasedConfig = z.object({
    rotation_period: z.string().regex(ISO_DURATION, "ISO-8601 duration required (e.g. P1D, PT6H, P30D)"),
    max_rotation_period: z.string().regex(ISO_DURATION).optional(),
    rotate_empty_index_set: z.boolean().optional().default(false),
});

const SizeBasedConfig = z.object({
    max_size: z.number().int().positive(), // bytes
});

const MessageCountConfig = z.object({
    max_docs_per_index: z.number().int().positive(),
});

const DeleteRetentionConfig = z.object({
    max_number_of_indices: z.number().int().positive(),
});

const CloseRetentionConfig = z.object({
    max_number_of_indices: z.number().int().positive(),
});

// D-09 "1 future-proof slot" — placeholder for time-size-optimizing OR archive.
// Schema-only; aliasToConfig rejects with structured error until back-end ships.
const FutureProofConfig = z.unknown(); // sentinel — never reachable from CreateIndexSetSchema today

export const ROTATION_CONFIG_BY_ALIAS = {
    "time-based": TimeBasedConfig,
    "size-based": SizeBasedConfig,
    "message-count": MessageCountConfig,
};
export const RETENTION_CONFIG_BY_ALIAS = {
    "delete": DeleteRetentionConfig,
    "close": CloseRetentionConfig,
};
```

In `CreateIndexSetSchema.superRefine`, look up the config schema by alias and narrow validation:
```js
.superRefine((args, ctx) => {
    const rotSchema = ROTATION_CONFIG_BY_ALIAS[args.rotation_strategy];
    if (rotSchema) {
        const parsed = rotSchema.safeParse(args.rotation_strategy_config);
        if (!parsed.success) {
            for (const issue of parsed.error.issues) {
                ctx.addIssue({ ...issue, path: ["rotation_strategy_config", ...issue.path] });
            }
        }
    }
    // Same for retention.
})
```

This is **the same superRefine variant-dispatch pattern** Phase 1 used for `CreateInputSchema` and `CreateExtractorSchema` (`[VERIFIED: Plan 01-02 SUMMARY + Plan 01-04 SUMMARY]`).

## Runtime State Inventory

Phase 2 is **partly** rename/refactor-shaped (the cascades amendment to `handler.js`, the conflict.js index_sets normalization, the new `_shared/system-job.js` cross-domain primitive). The C1 confirmation hash is **not** a runtime-state introduction in the usual sense (it's computed in-memory, never persisted), but the audit log and Graylog system-job manager are.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None new on the MCP side.** The C1 hash is computed in-memory in `build()`, surfaced in the dry-run JSON, recomputed at apply for verification — never persisted. No `~/.graylog-mcp/...` file additions. On the **Graylog side**: index-set metadata lives in MongoDB (`index_sets` collection per `MongoIndexSetService`); `DefaultIndexSetConfig` lives in `cluster_config`. Both are server-side state the MCP only reads/writes through the REST API. | None — same model as Phase 1. |
| Live service config | **None.** Phase 2 adds no n8n/Datadog/Tailscale/Cloudflare/etc. external service config. The Graylog audit-log (every mutating tool issues an `@AuditEvent`) is a server-side side-effect — the agent should be told (already documented in PITFALLS.md "Backward-Compat Risks" table). | None — surface in tool descriptions: "Every admin mutation produces an audit-log entry on the Graylog server, even with dryRun: false single calls." |
| OS-registered state | **None.** No Windows Task Scheduler, no pm2, no systemd, no launchd. | None. |
| Secrets/env vars | **None new.** Existing API token under `~/.graylog-mcp/config.json` (Phase 0); index-set configs carry no secrets (no encrypted fields per type-catalogue inspection — index-set creation is structurally different from input creation in this respect). | None — verify-by-absence at plan time. |
| Build artifacts | **None** — `npm test` rebuilds nothing; ESM imports resolve at runtime. | None. |

**The canonical question:** *After every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?* — **Nothing.** Phase 2 introduces no rename. The only "registration" is the dispatch Map (`src/tools/_register.js` imports `src/tools/index-sets/index.js` once at server start; the Phase 0 `assertAllToolsRegistered` check fails fast if any tool name in `src/tools.js` lacks a handler in the Map).

## Common Pitfalls

### Pitfall C1 (CRITICAL — the centerpiece): `delete_indices=true` is the Graylog default

**What goes wrong:** Agent issues `DELETE /system/indices/index_sets/{id}` without explicitly setting `?delete_indices=false`. Graylog kicks off `IndexSetCleanupJob` against live Elasticsearch; messages destroyed asynchronously; HTTP 204 returns immediately so the agent thinks "success".

**Why it happens:** Java REST resource `@QueryParam("delete_indices") @DefaultValue("true") boolean deleteIndices` `[VERIFIED: IndexSetsResource.java:383]`.

**How to avoid:**
1. MCP wrapper defaults `deleteIndices: false` (D-04).
2. When agent explicitly passes `deleteIndices: true`, the wrapper computes a deterministic confirmation hash from the dry-run state and requires the agent to echo it as `confirm: "<hash>"` for apply.
3. Stats unreachable hard-blocks the dry-run (D-05) — agent cannot reason about blast radius without messageCount.
4. The writable gate fires BEFORE the confirmation gate (D-16) — `writable: false` connections refuse the call regardless of `deleteIndices` value.

**Warning signs:** Snapshot fixture for `delete_index_set deleteIndices:true` MUST include the `confirmationToken` in the dry-run JSON; auth-redaction lint MUST recognise the 64-hex confirmation token as non-secret (regex pattern matches; the surrounding key `"confirmationToken"` confirms it's a hash, not an apiToken — the existing Phase 0 idempotency-key allowlist applies the same context-aware filtering by virtue of the field-name context).

### Pitfall m2: `set_default_index_set` requires `isRegularIndex`

**What goes wrong:** Agent tries `set_default_index_set` against an events-style or system-template index set. Graylog returns 409 Conflict.

**Why it happens:** `IndexSetsResource.setDefault` checks `if (!indexSet.isRegularIndex()) throw 409` (`[VERIFIED: IndexSetsResource.java:359-361]`).

**How to avoid:** D-13 pre-flight inside `set-default-index-set.js build()` — GET the target's IndexSetResponse, inspect `can_be_default: boolean`, surface a structured error in dry-run if false.

**Warning signs:** Snapshot fixture for `set_default_index_set against ineligible index set` MUST show the dry-run error with `reason: "default_eligibility_failed"` (UPDATED D-13) and a helpful message naming `can_be_default: false`.

### Pitfall m3: Deflector cycle is destructive of the current write index

**What goes wrong:** Agent expects "rotate" to mean "open a new index alongside the current one". It doesn't — the current write index is closed; the next one is created; there's a brief gap during which in-flight writes buffer or fail.

**Why it happens:** `indexSet.cycle()` closes-then-opens. `[VERIFIED: DeflectorResource.java:116-126 + checkCycle:128-134]`.

**How to avoid:** Document in `cycle_deflector` tool description: "Cycling closes the current write index and creates the next one. In-flight writes may briefly buffer until the new index is ready. The closed index will then have its message-range index rebuilt asynchronously." Don't expose `cycle_deflector` as a default action in any future blueprint.

### Pitfall m5: Async system jobs return 204 immediately; work continues

**What goes wrong:** Agent deletes an index set with `deleteIndices: true`, gets 204 back, immediately tries to confirm the indices are gone via `GET /system/indexer/indices/...` — they're still there because the cleanup job is mid-flight.

**Why it happens:** `IndexSetsResource.delete` line 398: `systemJobManager.submit(indexSetCleanupJobFactory.create(indexSet))`.

**How to avoid:** D-15 uniform async envelope — the MCP wrapper surfaces `{ async: true, job_id_observable_at: "/system/jobs", message }` and tells the agent to call `await_system_job` to wait. Tool descriptions warn explicitly. (Caveat: the DELETE response itself is 204 with no body, so the wrapper cannot extract the job_id from the response — the agent must discover via `GET /system/jobs` and the message names the job class so the agent can grep. See §Endpoint Catalogue notes.)

### Pitfall M2 (verified-and-resolved): Inconsistent create-response shapes

**What goes wrong (per PITFALLS.md):** Different create endpoints return different shapes; assumptions made for one resource break for another.

**Why it happens / verified:** For Phase 2 specifically, `POST /system/indices/index_sets` returns **200 + full IndexSetResponse** (NOT 201, NOT just `{id}`) `[VERIFIED: IndexSetsResource.java:270 + 286]`. The Phase 0 `toIdBody(raw, { idFields: ["id"] })` normalizer handles full-DTO responses correctly — `raw.id` is present.

**How to avoid:** No mitigation needed — Phase 0's `toIdBody` already handles this shape. Snapshot fixture for `create_index_set apply path` MUST verify the response.result.id is the assigned id and response.result.body is the full DTO.

### Pitfall U1 (LOAD-BEARING, NEW — discovered during this research): `update_index_set` partial-body acceptance unverified

**What goes wrong:** D-12 (strict no-echo) assumes `PUT /system/indices/index_sets/{id}` accepts a partial body. The `IndexSetUpdateRequest` AutoValue+Jackson deserialization may treat strategy fields (via `RotationAndRetentionFields` interface) as required.

**Why it happens (hypothesized):** Jackson + AutoValue Builder pattern with `@JsonPOJOBuilder(withPrefix = "")` defaults to "every getter must be set or its default applied". Without `@Nullable` on the strategy getters, missing fields may 400.

**How to avoid:** Plan-1 first action — smoke test against 7.0.6 (`<graylog-host>`). If 400, fall back to merge-from-current (Phase 1 `update_extractor` pattern). Acceptable because index-set configs carry no encrypted fields → C3 is not reachable.

**Warning signs:** Smoke test results documented in Plan 1's first task RED commit OR in `01-VALIDATION.md` companion artifact. If smoke is impractical (live instance unreachable from build env), Plan 1 defaults to merge-from-current and documents it as the "Pitfall U1 mitigation".

### Pitfall ND1 (NEW): Default index set cannot be deleted

**What goes wrong:** Agent deletes what it thinks is "just another index set" but happens to be the default.

**Why it happens:** `IndexSetsResource.delete:389-391` — `if (indexSet.equals(defaultIndexSet)) throw new BadRequestException("Default index set cannot be deleted!")`.

**How to avoid:** `delete_index_set.build()` pre-flights the target's IndexSetResponse (we're already fetching it for `messageCount` via `/{id}/stats`; the `IsDefault` flag is on the GET response). If `current.default === true`, surface structured error in dry-run with `reason: "default_index_set_undeletable"` and a helpful message: "Cannot delete the default index set. Use `set_default_index_set` to designate a different index set as default first, then retry."

**Snapshot fixture:** `delete_index_set against the default index set` shows the dry-run error.

### Pitfall ND2 (NEW): `IndexSetUpdateRequest.isWritable=false` on the default index set returns 409

**What goes wrong:** Agent tries to update the default index set with `writable: false`.

**Why it happens:** `IndexSetsResource.update:317-319` — `if (isDefaultSet && !updateRequest.isWritable()) throw 409 "Default index set must be writable."`.

**How to avoid:** `update_index_set.build()` already pre-fetches `current` for U1 strict-no-echo OR merge-from-current. Check `current.default === true && args.changes.writable === false` and surface a structured pre-flight error with `reason: "default_index_set_must_be_writable"`.

### Pitfall ND3 (NEW): `cycle_deflector` against `writable: false` index set returns 400

**What goes wrong:** Agent cycles a non-writable index set.

**Why it happens:** `DeflectorResource.checkCycle:128-134` — `if (!indexSet.getConfig().isWritable()) throw 400`.

**How to avoid:** Phase 0 D-16 writable gate already protects the **connection** level. But the **index set** itself can be `writable: false` while the connection is writable. Pre-flight inside `cycle_deflector.build()` — GET the target IndexSetResponse, check `current.writable === false`, surface structured pre-flight error if so.

## Code Examples

### Composing `delete_index_set` end-to-end

```js
// src/tools/index-sets/delete-index-set.js
import { defineMutatingHandler } from "../_shared/handler.js";
import { DeleteIndexSetSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { computeC1Hash, collectIndexNames } from "./c1-hash.js";
// Source: this RESEARCH.md §C1 Confirmation Hash Algorithm

export const handleDeleteIndexSet = defineMutatingHandler({
    name: "delete_index_set",
    schema: DeleteIndexSetSchema,
    async build(args) {
        const client = makeClient(args._conn);

        // D-04: emit deleteIndices: false in preview explicitly even when default applied.
        const deleteIndices = args.deleteIndices ?? false;

        // ND1 pre-flight: refuse the default index set up-front.
        const current = await client.request("GET",
            `/api/system/indices/index_sets/${args.indexSetId}`, null);
        if (current.default === true) {
            throw new GraylogValidationError(
                "Cannot delete the default index set. Use set_default_index_set first.",
                { status: 400, method: "DELETE", path: `/api/system/indices/index_sets/${args.indexSetId}` }
            );
        }

        if (!deleteIndices) {
            return {
                method: "DELETE",
                path: `/api/system/indices/index_sets/${args.indexSetId}?delete_indices=false`,
                body: undefined,
                postApplyEstimate: { id: args.indexSetId, deletedIndices: false },
                _previewExtras: { deleteIndices: false }, // pinned in fixture
            };
        }

        // D-02 + D-05 pre-flight pair (parallel for latency).
        const [indexList, stats] = await Promise.all([
            client.request("GET", `/api/system/indexer/indices/${args.indexSetId}/list`, null)
                  .catch(() => ({ closed: { indices: [] }, reopened: { indices: [] }, all: { indices: {} } })),
            client.request("GET", `/api/system/indices/index_sets/${args.indexSetId}/stats`, null),
            //                ^---- D-05: throwing from this is a hard block; let it bubble
            //                      through wrapGraylogError as { isError, reason: "stats_unreachable" }.
            //                      The planner picks the typed-error class.
        ]);
        const indexNames = collectIndexNames(indexList);
        const messageCount = stats?.documents ?? 0;

        const confirmationToken = computeC1Hash({
            indexSetId: args.indexSetId,
            deleteIndices: true,
            indexNames,
            messageCount,
        });

        return {
            method: "DELETE",
            path: `/api/system/indices/index_sets/${args.indexSetId}?delete_indices=true`,
            body: undefined,
            cascades: {
                indices: indexNames,
                messageCount,
                indexCount: indexNames.length,
            },
            postApplyEstimate: {
                id: args.indexSetId,
                async: true,
                job_id_observable_at: "/system/jobs",
                message: "IndexSetCleanupJob submitted; call await_system_job (with discovered jobId) to wait.",
            },
            _confirmationToken: confirmationToken,
            _previewExtras: { deleteIndices: true },
        };
    },
    apply: async (client, req) => {
        // wrapper has enforced confirm === confirmationToken via the proposed
        // requireConfirm hook (Option A above).
        await client.request(req.method, req.path, req.body);
        return {
            async: true,
            job_id_observable_at: "/system/jobs",
            message: "Index set deleted. Cleanup job running; observe via /system/jobs.",
        };
    },
    summarize: (args) => `Delete index set ${args.indexSetId} (deleteIndices: ${args.deleteIndices ?? false})`,
});
```

### Composing `cycle_deflector` (Option A — strip the async envelope)

```js
// src/tools/index-sets/cycle-deflector.js
import { defineMutatingHandler } from "../_shared/handler.js";
import { CycleDeflectorSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";

export const handleCycleDeflector = defineMutatingHandler({
    name: "cycle_deflector",
    schema: CycleDeflectorSchema, // { indexSetId, ...mutatingBase }
    async build(args) {
        // ND3 pre-flight — refuse cycling a non-writable index set early.
        const client = makeClient(args._conn);
        const current = await client.request("GET",
            `/api/system/indices/index_sets/${args.indexSetId}`, null);
        if (current.writable === false) {
            throw new GraylogValidationError(
                `Index set "${current.title}" (${args.indexSetId}) is not writable; cannot cycle.`,
                { status: 400, method: "POST", path: `/api/system/deflector/${args.indexSetId}/cycle` }
            );
        }
        return {
            method: "POST",
            path: `/api/system/deflector/${args.indexSetId}/cycle`,
            body: undefined,
            postApplyEstimate: {
                id: args.indexSetId,
                async: false,            // OPTION A: cycle is synchronous on 7.0.6
                completed: true,
                message: "Deflector cycled. Closed previous write index; new one starting.",
                note: "Brief gap during alias switch; new messages may buffer until ready. " +
                      "The closed index's range will be rebuilt async (observable via /system/jobs).",
            },
        };
    },
    apply: async (client, req) => {
        await client.request(req.method, req.path, req.body);
        return {
            cycled: true,
            indexSetId: req.path.split("/")[3],
            message: "Deflector cycle complete on Graylog side.",
        };
    },
    summarize: (args) => `Cycle deflector for index set ${args.indexSetId}`,
});
```

## Snapshot Fixture Design (D-05 refinement of Discretion-05)

Phase 1 shipped 5 fixtures (Plan 01-05 §"5 byte-identical snapshot fixtures"). Phase 2 ships **9 fixtures** to cover all the safety-critical paths.

| # | Fixture | What it pins |
|---|---------|--------------|
| 1 | `create_index_set time-based+delete dry-run` | Baseline POST body — `rotation_strategy_class: "...TimeBasedRotationStrategy"`, `rotation_strategy.type: "...TimeBasedRotationStrategyConfig"`, `rotation_strategy.rotation_period: "P1D"`; `retention_strategy_class: "...DeletionRetentionStrategy"`, `retention_strategy.max_number_of_indices: 30`; `postApplyEstimate.id === "__SERVER_ASSIGNED__"` (D-17); `existingMatches: []` (no title collision in fixture) |
| 2 | `update_index_set partial — rename only (D-12 strict no-echo proof OR merge-from-current per U1)` | If U1 resolves to strict no-echo: `preview.body` carries exactly `{title:"renamed", description:"...", shards:4, replicas:0, writable:true, ...}` with **NO `rotation_strategy_class` and NO `retention_strategy_class`**. If U1 resolves to merge-from-current: `preview.body` carries the full merged shape but `summarize` claims "1 change: title". **The fixture pins whichever resolution wins**, with a comment in the test referencing this RESEARCH.md §Pitfall U1. |
| 3 | `update_index_set strategy-replace (atomic D-11)` | `preview.body.rotation_strategy_class` AND `preview.body.rotation_strategy.type` both set; D-11 superRefine accepted because both keys present in changes |
| 4 | `delete_index_set deleteIndices:false (no token)` | `preview.body === undefined`; `preview.path` ends `?delete_indices=false`; **no `confirmationToken` field in the preview JSON** (D-03); `applyHint: "Re-call with dryRun: false to apply"`; `cascades` ABSENT (no preflight needed) |
| 5 | `delete_index_set deleteIndices:true against empty index set (token + messageCount:0)` | `confirmationToken: <64 hex>` present; `cascades.indices: []`; `cascades.messageCount: 0`; `cascades.indexCount: 0`; `postApplyEstimate.async: true` |
| 6 | `delete_index_set deleteIndices:true against populated index set (token includes messageCount)` | `confirmationToken: <64 hex>` present; `cascades.indices: ["graylog_0","graylog_1","graylog_2"]` (sorted); `cascades.messageCount: 12345`; `cascades.indexCount: 3`; the token hash is DIFFERENT from fixture #5's by virtue of the messageCount and indexNames inputs |
| 7 | `set_default_index_set against ineligible index set (m2 + UPDATED D-13)` | Dry-run shows `{ isError: true, reason: "default_eligibility_failed", content: [...]: }` — surfaces 409 BEFORE apply (ROADMAP success criterion 3) |
| 8 | `cycle_deflector dry-run` | `preview.method: "POST"`; `preview.path: "/api/system/deflector/<id>/cycle"`; `postApplyEstimate.async: false` (Option A); `postApplyEstimate.message` mentions the brief gap (m3 visibility); `postApplyEstimate.note` mentions async index-range rebuild |
| 9 | `await_system_job dry-run shows polling plan` | `postApplyEstimate.jobId: <id>`; `postApplyEstimate.plan: [500,1000,2000,4000,5000]`; `postApplyEstimate.timeoutMs: 60000`; `postApplyEstimate.note` mentions the apply blocks |

**Plus two non-snapshot tests (Plan 2's required acceptance gates):**

- **`await_system_job success path`** — driven via `_setCaptureRequest` returning a sequence of `running 25% → running 60% → complete 100%`; assert the apply returns `{ jobId, completed: true, finalStatus: { percent_complete: 100, job_status: "complete" } }` and that the loop ran ≥3 polls.
- **`await_system_job timeout path`** — `_setCaptureRequest` returns `running` indefinitely; `timeoutMs: 100`; assert apply returns `{ jobId, completed: false, timedOut: true }` and the loop exits within ~150ms.

Snapshot determinism (FOUND-07 contract) carries forward — two consecutive `npm test` runs MUST produce byte-identical md5sums of the new `.snapshot` files. Idempotency-key allowlist in `auth-redaction.test.js` covers the 32-hex Phase 0 case; the 64-hex C1 confirmation token is NOT covered by the existing allowlist — **the planner must extend the allowlist regex to recognize the `"confirmationToken"` context (same pattern as `idempotencyKey`)**, OR rely on the regex-level `<...>` placeholder recognition by NOT emitting raw 64-hex strings in fixtures (e.g. replace the token value with `"<confirmationToken>"` in the fixture, the way encrypted fields use `"<redacted>"`). **Recommendation: surface the real 64-hex token in the snapshot (it's not a secret — it's a content-hash of public state) and extend the auth-redaction allowlist with the `"confirmationToken"` context check** (1-2 lines).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Deprecated `/system/deflector/cycle` (no indexSetId — cycles default) | `/system/deflector/{indexSetId}/cycle` (explicit target) | Available in 7.0+ | Plan 2 uses the explicit-target endpoint exclusively. Deprecated endpoint exists but is `@Deprecated` annotated `[VERIFIED: DeflectorResource.java:96]`. |
| Deprecated `GET /system/deflector` (no indexSetId) | `GET /system/deflector/{indexSetId}` (explicit target) | Available in 7.0+ | Same as above. Phase 2 doesn't expose a deflector-status read tool, so this is informational only. |
| Static rotation/retention strategy enum (4.x-era) | Pluggable strategy classes via `RotationStrategyConfig` interface + `@JsonTypeInfo(use=CLASS)` polymorphism | 5.x+ | The alias→FQCN translator handles this cleanly; no agent-side awareness of the polymorphism required. |
| Single `IndexSetCleanupJob` for delete | Same in 7.x (legacy system job manager) | — | Stable. The `LegacySystemJobManager` is the one Phase 2 observes via `await_system_job`. |
| Legacy `GET /api/streams` deprecated path | `/api/streams/paginated` (HARD-05 future migration) | 7.0 | Out of scope for Phase 2; flagged in PROJECT.md as a future milestone. |

**Deprecated/outdated:**
- `POST /system/deflector/cycle` (no indexSetId): `@Deprecated` — DO NOT USE; cycles default index set only.
- Legacy `?stats=true` query param on the LIST endpoint vs `/{id}/stats` path on the GET endpoint: both exist; the per-ID `/stats` path is the canonical one for `delete_index_set`'s pre-flight (`[VERIFIED: IndexSetsResource.java:247-261]`).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `IndexSetUpdateRequest` deserialization in 7.0.6 may reject partial bodies (no strategy keys) | Pitfall U1 | If partial IS accepted: extra work in fall-back-implementation; if rejected and we ship strict no-echo: every update_index_set 400s. **Mitigation: smoke-test plan-1 first action.** |
| A2 | `cycle_deflector` is synchronous in 7.0.6 (no system_job_id returned) | §Cycle Deflector Behavior; Option A | If 7.0.6 returns a job_id via some plugin path, D-14's original async envelope is correct; Phase 2 chooses Option B. **Mitigation: smoke-test the cycle endpoint and inspect the response.** |
| A3 | `GET /system/jobs/{id}` returns 404 when the job is no longer running (interpretation: "completed and pruned") | §System Job Lifecycle | If 404 means "never existed" instead, the await loop misinterprets timeout-mid-poll as success. **Mitigation: test seam programs both shapes; the 404-as-completed interpretation is the practical truth based on `SystemJobResource.get` source.** |
| A4 | The C1 confirmation hash format (sha256 of canonical JSON with sorted keys) is sufficient for the safety story | §C1 Confirmation Hash Algorithm | If the canonical JSON serialization differs between dry-run and apply (e.g. JSON.stringify key-order drift), hash mismatches block legitimate applies. **Mitigation: `JSON.stringify({indexSetId, deleteIndices, indexNames, messageCount})` is deterministic for ASCII keys; the same canonicalization pattern in `idempotency.js` is already shipped and tested.** |
| A5 | Adding `?? response?.index_sets` to `src/tools/_shared/conflict.js` is a safe additive amendment | §Endpoint Catalogue row 1 | If a future caller relies on the absence of this normalization, the change breaks them. **Mitigation: grep for `findExistingMatches` call sites; today there's exactly one (create_input). Adding `index_sets` does not affect that call site.** |
| A6 | `messageCount` per D-02 comes from `IndexSetStats.documents` (long) on `GET /{id}/stats` | §C1 + Endpoint Catalogue row 2b | If `documents` is sometimes null/missing in 7.0.6 (e.g. on a fresh index set with no managed indices), `messageCount` defaults to 0 — that's the correct semantic. **Mitigation: smoke test the stats endpoint on an empty index set and an empty stats-failure index set.** |
| A7 | Index-set configs carry NO encrypted fields (so C3 is not reachable on update_index_set) | §Pitfall U1 mitigation rationale | If a future Graylog plugin adds an encrypted field to an index-set config, merge-from-current would zero it out. **Mitigation: the wrapper inspects the IndexSetResponse for any field shaped `{ is_set, set_value, keep_value, ...}` — empty in practice for the OSS index-set DTO; Phase 2 ships the merge-from-current pattern without C3 protection, with a comment in the source noting the assumption.** |
| A8 | `await_system_job` blocking apply-time is acceptable for the MCP server's request loop | §Pattern 4 | If `apply()` blocks for 60s by default, the MCP request hangs the agent's tool-call. **Documented behavior** — the agent CHOSE to call `await_system_job`, knowing it blocks. The MCP server itself is request-per-call; nothing else queues behind this single invocation. |

## Open Questions (RESOLVED)

1. **U1: does Graylog 7.0.6 accept a partial `PUT /system/indices/index_sets/{id}` body?**
   - What we know: AutoValue + Jackson + `@JsonPOJOBuilder(withPrefix="")` on `IndexSetUpdateRequest.Builder`; getters declared via mixin interfaces; no `@Nullable` on the strategy getters.
   - What's unclear: Whether Jackson's default deserializer treats absent strategy keys as 400 vs. null-and-the-Builder-tolerates-it.
   - **RESOLVED:** Plan 01 Task 1 runs a live smoke test against `<graylog-host>` and writes the decision (STRICT_NO_ECHO / MERGE_FROM_CURRENT / UNREACHABLE_DEFAULT_MERGE) to `02-U1-SMOKE.md`. Plan 02 Task 3 branches on that artifact. If unreachable, the conservative default is merge-from-current (Phase 1 `update_extractor` pattern). Acceptable since index-set configs carry no encrypted fields (C3 not reachable).

2. **Cycle endpoint actually-async vs. nominally-sync.**
   - What we know: `DeflectorResource.cycle` is `void` and calls `indexSet.cycle()` directly. No `systemJobManager.submit`. Index-range rebuild on the closed index DOES happen via a separate system job.
   - What's unclear: Whether some Graylog plugin or 7.0.6-specific code path replaces the sync call with an async submit.
   - **RESOLVED:** D-14 updated 2026-05-15 — `cycle_deflector` ships synchronous semantics. Returns `{ rotated, message, side_effects.observable_at: "/system/jobs", side_effects.describes: "closed-index range rebuild" }`. Agent optionally awaits the side-effect job. If a future smoke surfaces an async path, flip via follow-up CONTEXT.md amendment.

3. **Default-index-set-discovery semantics for `set_default_index_set` (D-13) pre-flight.**
   - What we know: `GET /system/indices/index_sets/{id}` returns `default: boolean` and `can_be_default: boolean` (both on the same response).
   - What's unclear: None — the response shape is fully verified.
   - **RESOLVED:** D-13 updated 2026-05-15 — wrapper reads `can_be_default: boolean` (the server's derived eligibility answer; absorbs future Graylog invariants without wrapper update). ND1 (`delete_index_set` refuses default) uses `current.default === true` separately — that's a different gate.

4. **`await_system_job` jobId discovery for `delete_index_set`.**
   - What we know: The DELETE response is 204 with no body; the system job is observable via `GET /system/jobs` but the wrapper cannot extract the job_id from the DELETE response.
   - What's unclear: How the agent finds the right job_id to pass to `await_system_job`.
   - **RESOLVED:** D-15 updated 2026-05-15 — `job_id` is deliberately ABSENT from the async envelope (envelope shape is `{ async, job_id_observable_at, message }`). `message` includes the target index-set id so the agent can match the cleanup job's `info` field. `await_system_job` accepts either `job_id` OR an `info_substring` for discovery convenience. Plan 01 must implement the `info_substring` path; tool description for `delete_index_set` spells out the discovery flow.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >= 22.3.0 | Whole project | ✓ | 22.x (Phase 0 verified) | — |
| `@modelcontextprotocol/sdk` 1.18.0 | MCP server framework | ✓ | 1.18.0 | — |
| `axios` 1.12.2 | HTTP client | ✓ | 1.12.2 | — |
| `zod` ^3.25.76 | Schema validation | ✓ | ^3.25.76 | — |
| `node:crypto` (built-in) | sha-256 for C1 hash + Phase 0 idempotency | ✓ | built-in | — |
| Live Graylog 7.0.6 at `http://<graylog-host>` | U1 smoke test + cycle-endpoint smoke test | **Verify at plan time** | 7.0.6 (codename "Noir") | Hand-fixture; document Pitfall U1 fall-back as merge-from-current (the safe default) |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** If `<graylog-host>` is unreachable from the build environment, Plan 1 uses the merge-from-current fallback for `update_index_set` (Phase 1 `update_extractor` pattern) and Option A (synchronous cycle) for `cycle_deflector`. Both are conservative — they trade off a tiny amount of D-12 strictness for guaranteed correctness. The user can later re-run the U1 + cycle smoke tests if the live instance becomes reachable and tighten the wrapper.

## Validation Architecture

`workflow.nyquist_validation: true` per `.planning/config.json` — this section is required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in, Node 22.3+) |
| Config file | none (single-runner via `node --test 'test/**/*.test.js'`; snapshot path overridden by `test/snapshot-config.js`) |
| Quick run command | `node --test test/index-sets.test.js test/system-job.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INDEX-01 | `list_index_sets` returns narrow projection by default; flags default+writable | unit | `node --test test/index-sets.test.js -t 'list_index_sets default fields include default+writable'` | ❌ Wave 0 |
| INDEX-01 | `list_index_sets` envelope normalization handles `{ index_sets: [...] }` shape | unit | `node --test test/index-sets.test.js -t 'list_index_sets unwraps index_sets envelope'` | ❌ Wave 0 |
| INDEX-02 | `get_input` returns full IndexSetResponse DTO | unit | `node --test test/index-sets.test.js -t 'get_index_set returns full DTO'` | ❌ Wave 0 |
| INDEX-03 | `create_index_set` requires both rotation+retention with configs (D-10) | unit | `node --test test/index-sets.test.js -t 'create_index_set rejects missing strategies'` | ❌ Wave 0 |
| INDEX-03 | `create_index_set` time-based+delete dry-run emits correct FQCNs | unit + snapshot | `node --test test/index-sets.test.js -t 'create_index_set time-based+delete dry-run'` | ❌ Wave 0 |
| INDEX-03 | `create_index_set` strategy_config superRefine narrows per alias | unit | `node --test test/index-sets.test.js -t 'create_index_set rejects mismatched config for size-based'` | ❌ Wave 0 |
| INDEX-04 | `update_index_set` D-11 atomic strategy-replace rejects partial | unit | `node --test test/index-sets.test.js -t 'update_index_set rejects rotation_strategy without config'` | ❌ Wave 0 |
| INDEX-04 | `update_index_set` partial-or-merge body matches U1 resolution | unit + snapshot | `node --test test/index-sets.test.js -t 'update_index_set partial title-only'` | ❌ Wave 0 |
| INDEX-05 | `delete_index_set` defaults `deleteIndices: false` (D-04) | unit + snapshot | `node --test test/index-sets.test.js -t 'delete_index_set default is delete_indices=false'` | ❌ Wave 0 |
| INDEX-05 | `delete_index_set` with `deleteIndices: true` issues confirmationToken (D-01) | unit + snapshot | `node --test test/index-sets.test.js -t 'delete_index_set confirmationToken populated'` | ❌ Wave 0 |
| INDEX-05 | `delete_index_set` apply rejects mismatched `confirm` | unit | `node --test test/index-sets.test.js -t 'delete_index_set rejects bad confirm'` | ❌ Wave 0 |
| INDEX-05 | `delete_index_set` D-05 stats_unreachable hard-blocks dry-run | unit | `node --test test/index-sets.test.js -t 'delete_index_set blocks on stats_unreachable'` | ❌ Wave 0 |
| INDEX-05 | `delete_index_set` ND1 refuses default index set | unit | `node --test test/index-sets.test.js -t 'delete_index_set refuses default index set'` | ❌ Wave 0 |
| INDEX-06 | `set_default_index_set` D-13 surfaces non-regular as dry-run error | unit + snapshot | `node --test test/index-sets.test.js -t 'set_default_index_set non-regular preflight'` | ❌ Wave 0 |
| INDEX-07 | `cycle_deflector` ND3 refuses non-writable index set | unit | `node --test test/index-sets.test.js -t 'cycle_deflector refuses non-writable'` | ❌ Wave 0 |
| INDEX-07 | `cycle_deflector` issues POST to /system/deflector/{id}/cycle | unit + snapshot | `node --test test/index-sets.test.js -t 'cycle_deflector dry-run'` | ❌ Wave 0 |
| INDEX-08 | `await_system_job` exp-backoff polls until complete | unit | `node --test test/system-job.test.js -t 'await_system_job success path'` | ❌ Wave 0 |
| INDEX-08 | `await_system_job` exits at timeout | unit | `node --test test/system-job.test.js -t 'await_system_job timeout path'` | ❌ Wave 0 |
| INDEX-08 | `await_system_job` dry-run returns plan without polling | unit + snapshot | `node --test test/system-job.test.js -t 'await_system_job dry-run'` | ❌ Wave 0 |
| D-16 | Writable-flag gate fires BEFORE confirmation gate | unit | `node --test test/index-sets.test.js -t 'writable gate before confirm gate'` | ❌ Wave 0 |
| D-17 | `create_index_set` dry-run uses __SERVER_ASSIGNED__ for id | unit + snapshot | (covered by 'create_index_set time-based+delete dry-run' fixture) | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `node --test test/index-sets.test.js test/system-job.test.js` (<5s; ~20-25 tests)
- **Per wave merge:** `npm test` (~250+ tests; <10s)
- **Phase gate:** Full suite green before `/gsd-verify-work`; two consecutive `npm test` runs must produce byte-identical md5sums of all 9 new `.snapshot` files (FOUND-07 carry-over)

### Wave 0 Gaps

- [ ] `test/index-sets.test.js` — covers INDEX-01 .. INDEX-07 + D-04/D-13/D-16/D-17 + Pitfalls ND1/ND2/ND3/U1
- [ ] `test/system-job.test.js` — covers INDEX-08 + D-06/D-07 (success path, timeout path, dry-run)
- [ ] `test/__snapshots__/index-sets.test.js.snapshot` — 8 fixtures (1-8 in §Snapshot Fixture Design)
- [ ] `test/__snapshots__/system-job.test.js.snapshot` — 1 fixture (#9: await_system_job dry-run plan)
- [ ] `test/schema-parity.test.js` extension — 8 new `assertSchemaParityForTool(toolName, zodSchema)` calls (list / get / create / update / delete / set_default / cycle / await)
- [ ] `test/auth-redaction.test.js` allowlist extension — recognize `confirmationToken` context (1-2 lines, mirrors the existing idempotencyKey context check)
- [ ] `src/tools/_shared/conflict.js` additive amendment — `?? response?.index_sets` in the envelope fallback chain (1 line)
- [ ] `src/tools/_shared/handler.js` additive amendment — `_confirmationToken` forwarding + `requireConfirm` apply-time gate (Option A, ~10 lines)

Framework install: none — `node:test` is built-in. No new test deps.

## Sources

### Primary (HIGH confidence)

- `source-code/graylog2-server/.../IndexSetsResource.java` — CRUD + set-default + delete endpoints; `@DefaultValue("true")` on `delete_indices` (C1); regular-index invariant for set-default (m2)
- `source-code/graylog2-server/.../DeflectorResource.java` — cycle endpoints; void return; synchronous semantics
- `source-code/graylog2-server/.../SystemJobResource.java` — `/system/jobs/{jobId}` poll endpoint; 404 = pruned
- `source-code/graylog2-server/.../SystemJobSummary.java` — poll response shape; `percent_complete`, `job_status`, `info`
- `source-code/graylog2-server/.../JobTriggerStatus.java` — `runnable | running | complete | paused | error | cancelled`
- `source-code/graylog2-server/.../IndexSetConfig.java` — DTO shape; `isRegularIndex()` derivation
- `source-code/graylog2-server/.../IndexSetResponse.java` — full DTO returned by GET / POST / PUT; `default`, `writable`, `can_be_default`
- `source-code/graylog2-server/.../IndexSetCreationRequest.java` — POST body shape
- `source-code/graylog2-server/.../IndexSetUpdateRequest.java` — PUT body shape (Pitfall U1 source)
- `source-code/graylog2-server/.../IndexSetStats.java` — `{ indices, documents, size }` for `/{id}/stats`
- `source-code/graylog2-server/.../AllIndices.java` + `IndicesResource.java` — `/system/indexer/indices/{id}/list` shape
- `source-code/graylog2-server/.../indexer/rotation/strategies/*` + `retention/strategies/*` — FQCN map, config shapes, NAME constants
- `source-code/graylog2-server/.../plugin/indexer/rotation/RotationStrategyConfig.java` + `retention/RetentionStrategyConfig.java` — `TYPE_FIELD = "type"`, `@JsonTypeInfo(use=CLASS, property=TYPE_FIELD)`
- `src/tools/_shared/handler.js` — async build + cascades forwarding already shipped (Phase 0/Phase 1)
- `src/tools/_shared/conflict.js` — findExistingMatches envelope normalization (needs `index_sets` added)
- `src/tools/_shared/list.js` — defaultFields override (`list_index_sets` consumes)
- `src/tools/inputs/update-input.js` + `delete-input.js` — Phase 1 partial-update + cascade-enumeration precedent
- `src/tools/inputs/schemas.js` — superRefine variant-dispatch precedent
- `.planning/research/PITFALLS.md` §C1 + §m2 + §m3 + §m5 + §M2 — phase-level pitfalls
- `.planning/phases/00-foundation/00-04-SUMMARY.md` — defineMutatingHandler contract
- `.planning/phases/01-inputs-extractors/01-02-SUMMARY.md` — partial-update + redaction precedent

### Secondary (MEDIUM confidence — 7.0.6 vs 7.2 divergence flagged)

- 7.0.6 live instance at `<graylog-host>` (per PROJECT.md) — pending smoke verification of U1 (PUT partial body acceptance) and cycle response shape
- Graylog OSS release notes for 7.0 → 7.2 — no breaking changes documented in index-set REST surface; `delete_indices` default has been `true` since 4.x; `cycle_deflector` synchronous since 5.x

### Tertiary (LOW confidence — flag for validation)

- None tracked. Every claim in this RESEARCH.md is backed by either a verified file path or a `[CITED: ...]` from existing planning artifacts.

## Metadata

**Confidence breakdown:**
- Endpoint catalogue (paths, request/response shapes, status codes): HIGH — direct Java source read in this pass
- Strategy FQCN map (D-08, D-09): HIGH — verified against the strategy class files + NAME constants
- C1 confirmation hash algorithm: HIGH — straightforward sha-256, identical pattern to Phase 0 idempotency
- System job lifecycle: HIGH — `SystemJobSummary` and `JobTriggerStatus` source verified
- Cycle deflector synchronous semantics: HIGH — `DeflectorResource.java:109-126` is unambiguously synchronous
- Pitfall U1 (update PUT partial body): MEDIUM — requires live 7.0.6 verification at plan time
- Pitfall A3 (404 on pruned job = "completed"): MEDIUM — practical interpretation, not a documented contract
- Default narrow projection for list_index_sets (D-M6 equivalent): HIGH — INDEX-01 explicitly calls for default+writable flags, IndexSetResponse exposes both

**Research date:** 2026-05-15
**Valid until:** 2026-06-14 (30 days, stable surface; re-verify if Graylog upstream announces a 7.0.x patch release with index-set / deflector / system-job changes)
