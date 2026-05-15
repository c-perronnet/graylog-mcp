---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: milestone
status: Ready to execute
last_updated: "2026-05-15T07:01:27.347Z"
progress:
  total_phases: 8
  completed_phases: 0
  total_plans: 6
  completed_plans: 4
  percent: 67
---

# Project Memory: Graylog MCP — Full Admin Surface

**Last updated:** 2026-05-15

## Project Reference

- **Core value**: An AI agent can configure Graylog from intent alone, safely, without touching the web UI.
- **Source of truth**: `.planning/PROJECT.md`
- **Requirements**: `.planning/REQUIREMENTS.md` (71 v1 requirements across 9 categories)
- **Roadmap**: `.planning/ROADMAP.md` (8 phases, coarse granularity, sequential execution, phase-branching)
- **Research**: `.planning/research/SUMMARY.md` (synthesis), `STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md`
- **Codebase context**: `.planning/codebase/ARCHITECTURE.md`, `STRUCTURE.md`, `CONVENTIONS.md`, `CONCERNS.md`

## Current Position

Phase: 00 (foundation) — EXECUTING
Plan: 5 of 6

- **Phase**: 0 — Foundation
- **Plan**: 5 of 6 — Wave 3 handler primitives (00-04) shipped; next up is 00-05 (dispatch refactor)
- **Status**: Phase 0 in progress; `npm test` green via `node --test`, full unified suite running (124 tests / 18 suites)
- **Progress bar**: `[███████░░░] 67%` (4 of 6 Phase 0 plans complete)

## Performance Metrics

| Metric | Value |
|--------|-------|
| v1 requirements | 71 mapped / 71 total |
| Phases | 0 complete / 8 total |
| Plans complete | 4 |
| Net-new tools target | ~64 (58 CRUD primitives + 6 blueprints) |
| Total MCP surface at milestone end | ~91 tools |
| Phase 00-foundation P01 | 2min | 2 tasks | 13 files |
| Phase 00-foundation P02 | ~15 min | 2 tasks | 12 files |
| Phase 00-foundation P03 | ~3 min | 2 tasks | 6 files |
| Phase 00-foundation P04 | ~7min | 2 tasks | 13 files |

## Accumulated Context

### Decisions Locked

Drawn from `PROJECT.md` Key Decisions table — restated here for quick reference:

- **Single Graylog version target**: 7.2.0-SNAPSHOT (no multi-version branching)
- **Auth model**: Reuse existing connection registry + API token; insufficient permissions surface as Graylog 403
- **Dry-run safety**: Per-call `dryRun: true` default on every mutating tool — applying without explicit `dryRun: false` is a bug
- **Two tool layers**: CRUD primitives + blueprints
- **Pipeline-rule DSL**: Agent emits `when … then …` source; helpers validate client-side before round-trip
- **Dashboard widgets**: Curated templates only (no arbitrary widget construction this milestone)
- **Validation**: Adopt existing `zod ^3.25.76` (do not upgrade to v4)
- **Code organization**: Per-domain extraction under `src/tools/<domain>/`
- **Source of REST shape**: Java REST resource classes in `source-code/graylog2-server/` (not Swagger)
- **Read tools**: Verify-against-v7 only; no refactors

### Decisions Made During Execution

- **Plan 00-01 (test harness bootstrap)**:
  - `setResolveSnapshotPath` redirects snapshots to `test/__snapshots__/` instead of node:test's default sibling-file location (honors D-06; keeps test tree readable).
  - `scripts.test` glob is single-quoted (`node --test 'test/**/*.test.js'`) so Node — not bash — performs the expansion. Without quoting bash matches only one path and breaks the runner. Treated as a Rule 1 bug fix on top of Task 1's value.
  - `@types/node` bumped to `^22.0.0` so devDep types align with the new engine floor (`>= 22.3.0`).

- **Plan 00-02 (test-existing migration)**:
  - Per-suite `mkdtempSync(join(tmpdir(), <prefix>))` + after-hook cleanup (not a single shared temp dir) for every describe block that calls `_withStorePathOverride` — node:test runs suites concurrently and the override is process-global, so sharing the path would race.
  - Swallowed `try { ... } catch (error) { console.error(...) }` in `test-features.js` removed during migration — let node:test reporter fail red on broken assertions rather than log-and-zero-exit (RESEARCH.md Q8).
  - Synced `package-lock.json` to Plan 01's `package.json` bumps (Rule 3 blocking fix). Plan 01 bumped `@types/node ^22` + `engines.node >= 22.3.0` without running `npm install`; axios was missing from `node_modules` and the migrated tests couldn't import production code. Committed as a separate `chore(00-02): sync package-lock.json` so the lockfile churn didn't muddy the test-migration commits.
  - Deleted (not archived) the 4 root-level scripts — git history is the archive.

- **Plan 00-03 (graylog-client extraction)**:
  - Status-code → typed-error mapping is tested via direct `mapGraylogError()` calls, NOT via `mock.module()`. Node 22's `mock.module()` requires `--experimental-test-module-mocks` and is brittle across 22.x patch versions. The `_setCaptureRequest` seam tests prove `makeClient.request` reaches the classifier; the direct `mapGraylogError` tests prove the classifier produces the right typed subclass. Plan `<action>` explicitly authorised this fallback.
  - `src/query.js` is NOT modified. `searchGraylog` and `fetchStreams` stay as-is; the new `makeClient` is purely additive. Migration of existing read tools to `makeClient` is deferred to per-domain phases (Phase 3+). Phase 0's job is to land the primitive, not retrofit.
  - D-07 / Pitfall 4 client-layer defense-in-depth: when `conn.writable === false`, every non-GET request is refused BEFORE axios is reached, throwing `GraylogError(status: 0)` with a "read-only" message. Complements (does not replace) the wrapper-layer check in Plan 04.
  - `_setCaptureRequest` / `_clearCaptureRequest` are exported (not module-internal toggles) so tests can import them cleanly; the `_` prefix plus an explicit test-only comment block in `client.js` flags production-misuse risk. `afterEach(() => _clearCaptureRequest())` is the canonical reset pattern for any test file mutating the seam.
  - `GraylogError` constructor accepts a default empty options object (`({ status, method, path, body } = {})`) so callers that throw the base class without remembering to pass ctx still get a well-formed instance rather than a destructuring TypeError.

- **Plan 00-04 (handler primitives + defineMutatingHandler / defineListHandler)**:
  - `_testConnection` seam re-merged from pre-zod `rawArgs` inside both factory wrappers — `mutatingBase` / `listBase` deliberately omit `_testConnection` so zod's default `strip` mode drops it from agent payloads (threat-model T-00-04-05 — agent cannot bypass connection lookup at runtime). Inside the wrapper we read it from `request.params.arguments` before validation and merge it onto the parsed args before `resolveConnection` consumes them. Net effect: production safe (no agent path puts `_testConnection` on the wire), tests work (seam still reachable from `node:test`). Discovered during Task 2 GREEN as a 14-test cascade failure; fixed in the same GREEN commit.
  - Added `_setConnectionsForTests` + `_clearConnectionsForTests` to `src/config.js` as an underscore-seam (test-only, project convention). `getConnections()` and `getActiveConnectionConfig()` branch on the override ONLY when set, preserving existing behaviour. Chose this over Node 22 `mock.module()` for the same reason Plan 03 did (experimental flag + flakiness).
  - D-07 two-layer defense confirmed: `handler.js` short-circuits `writable === false` BEFORE `build`/`apply` with `reason: "connection_read_only"`; `client.js` (Plan 03) refuses non-GET BEFORE axios with `GraylogError(status: 0)`. Either layer alone catches; both layers together cover bypass paths (e.g. a future service-layer call going directly through `makeClient` without `defineMutatingHandler`).
  - Tool-name-agnostic error wording in `resolveConnection` ("Use the active-connection setter first ..." rather than hardcoded `use_connection` / `set_active_connection`) — survives Plan 05's rename without churn.
  - `wrapGraylogError` truncates response body to 200 chars in the error message — Graylog 4xx bodies (full validation trees) would otherwise blow out the MCP response and the agent's context window.

### Foundation Primitives To Be Built In Phase 0

These are the cross-cutting concerns every later phase depends on. They live in `FOUND-01` through `FOUND-13`:

- `src/dispatch.js` — `Map<toolName, handler>` replacing the `if (name === ...)` chain
- `src/graylog/client.js` — single axios HTTP client with auth, `X-Requested-By`, typed error mapping
- `defineMutatingHandler` factory in `src/tools/_shared/handler.js`
- `runOrPreview` helper with `__SERVER_ASSIGNED__` ID sentinels
- Per-domain zod `schemas.js` co-location pattern
- `engines.node >= 20.6.0` (preferred `>= 22.3.0`) + working `npm test` against `node:test`
- Snapshot test harness with 5–10 fixture tests proven
- Response normalizer returning `{ id, body }` regardless of Graylog's inconsistent create-response shapes
- Per-call `connectionName` arg with singleton fallback on every mutating tool
- Idempotency-key mechanism (auto-generated from `hash(connection, tool, args)`)
- Create-conflict `existingMatches` pre-check pattern
- List-projection helper (default narrow `id, title, description`; default `limit: 25`)
- Tool-naming convention `<verb>_<domain>_<noun>`

### Reusable Primitives Introduced In Later Phases

- **`await_system_job`** (INDEX-08, Phase 2) — polls `/system/jobs/{id}`; reused by any async-completing operation in later phases.
- **Partial-update pattern** (INPUT-05, Phase 1) — wrapper fetches current config and merges; reused for index sets and event definitions.
- **Cascade-preview pattern** (STREAM-05, Phase 3) — pre-delete `cascades: {…}` output; reused for pipeline-rule deletes (PIPE-10) and pattern reference for event-def deletes.
- **Parse pre-flight pattern** (PIPE-08, Phase 4) — server-authoritative validation before apply; reused by `validate_event_definition` (Phase 5).

### Critical Pitfalls Per Phase

Sourced from `research/PITFALLS.md`. Each phase plan MUST address these:

- **Phase 0**: M2 (response shape inconsistency), M4 (idempotency on retries), M5 (skipped list-before-create), M6 (list-response context bloat), C6 (server-assigned ID sentinels)
- **Phase 1**: C3 (encrypted-field zero-out on update)
- **Phase 2**: C1 (`delete_indices=true` server default — INVERT IT), m2 (`regular: true` for default), m3 (deflector cycle is destructive), m5 (async system-job)
- **Phase 3**: C2 (silent cascade on stream delete), m1 (built-in stream protection), m6 (clone creates independent copy)
- **Phase 4**: C4 (agent-invented function names — parse pre-flight required), M3 (DSL escaping/coercion/then-block semantics)
- **Phase 5**: C5 (v6→v7 aggregation syntax migration), M1 (`schedule: true` server default — INVERT IT), m4 (WILDCARD empty-body endpoints)
- **Phase 6**: C7 (dashboard Search+View two-step; widget-position integrity)
- **Phase 7**: M7 (tool-discovery degradation at ~91 tools), backward-compat audit against v7.2

### Todos

(Populated as work progresses)

### Blockers

None.

## Session Continuity

**Last action**: Completed `00-04-PLAN.md` — built the cross-cutting handler primitives under `src/tools/_shared/` (errors, schemas, idempotency, dry-run, conflict, connection, handler, list — 8 files) via strict TDD with RED + GREEN per task. `defineMutatingHandler` enforces dryRun=true default, zod validation, D-07 writable-flag short-circuit BEFORE build/apply, sha-256 idempotency-key auto-derivation, build/apply split with `__SERVER_ASSIGNED__` sentinel + `existingMatches: []` field in every preview. `defineListHandler` enforces narrow projection `[id, title, description]`, default `limit: 25`, `MAX_LIMIT: 200` clamp, `fields: "all"` opt-in. `src/config.js` gains `getConnectionWritable(name)` (D-07) + `_setConnectionsForTests` / `_clearConnectionsForTests` test seam (underscore convention). `example-config.json` documents the writable field. `npm test` exits 0 with 124 tests / 18 suites green (+39 net-new). Commits: `762e371` (Task 1 RED connection+idempotency), `f90ce72` (Task 1 GREEN 6 leaf utilities + config additive + example-config), `2c46814` (Task 2 RED handler+list), `2ec5c17` (Task 2 GREEN handler+list factories). FOUND-03, FOUND-04, FOUND-05, FOUND-09, FOUND-10, FOUND-11, FOUND-12 complete.

**Stopped at**: Completed 00-04-PLAN.md

**Next action**: Execute `00-05-PLAN.md` (dispatch refactor — `Map<toolName, handler>` replacing the `if (name === ...)` chain in `src/index.js`; consumes `defineMutatingHandler` / `defineListHandler` from this plan).

---
*State initialized: 2026-05-13*
