---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: milestone
status: Ready to execute
last_updated: "2026-05-15T10:28:09.080Z"
progress:
  total_phases: 8
  completed_phases: 1
  total_plans: 11
  completed_plans: 7
  percent: 64
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

Phase: 01 (inputs-extractors) — EXECUTING
Plan: 2 of 5

- **Phase**: 1 — Inputs & Extractors
- **Plan**: 1 of 5 complete (01-01-PLAN.md shipped: A4 + A2 amendments + D-06 type-catalogue cache + defineListHandler defaultFields override + INPUT-01/02/03 read tools)
- **Status**: 177 tests / 18 suites green (+24 net-new over Phase 0 baseline of 153); all Phase 0 contracts preserved (Test 20 specifically pins back-compat for defineListHandler callers without defaultFields)
- **Progress bar**: `[██████░░░░] 64%` (7 of 11 milestone plans complete: 6 Phase 0 + 1 Phase 1)

## Performance Metrics

| Metric | Value |
|--------|-------|
| v1 requirements | 71 mapped / 71 total |
| Phases | 0 complete / 8 total |
| Plans complete | 5 |
| Net-new tools target | ~64 (58 CRUD primitives + 6 blueprints) |
| Total MCP surface at milestone end | ~91 tools |
| Phase 00-foundation P01 | 2min | 2 tasks | 13 files |
| Phase 00-foundation P02 | ~15 min | 2 tasks | 12 files |
| Phase 00-foundation P03 | ~3 min | 2 tasks | 6 files |
| Phase 00-foundation P04 | ~7min | 2 tasks | 13 files |
| Phase 00-foundation P05 | ~26 min | 3 tasks | 13 files |
| Phase 00-foundation P06 | ~10 min | 3 tasks | 11 files |
| Phase 01-inputs-extractors P01 | ~6min | 2 tasks | 16 files |

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

- **Plan 00-05 (dispatch Map refactor + tool rename)**:
  - Extracted 17 v2.3 read-tool handlers from inline `src/index.js` bodies into `src/handlers.js` (Rule 3 blocker fix — top-level `await server.connect(transport)` in `src/index.js` hangs node:test imports). `src/index.js` re-imports handlers from there, both for the if-chain (Task 1) and via `src/tools/_register.js` (Task 2). Plan-anticipated via the circular-import contingency note; trigger turned out to be top-level await rather than TDZ.
  - `dispatch()` declared `async` so `Tool not found: <name>` throws become rejecting promises. Contract is `Promise<MCPResponse>`; sync throws don't satisfy `await dispatch(...)` at the SDK call site or `assert.rejects(() => dispatch(...))` in tests. Caught by 3 failing dispatch unit tests on first pass; one-character fix (`function` → `async function`).
  - Internal handler function names retain OLD camelCase per RESEARCH.md Q9 closing rationale. `useConnectionHandler` backs `set_active_connection`; `fetchGraylogMessagesHandler` backs `search_messages_graylog`. The dispatch Map decouples external names from internal symbols. Internal-name churn is a follow-up cleanup; Phase 0 keeps blast radius small.
  - Hard rename, no aliases per D-03. CHANGELOG.md is the single migration-pointer document; v3.0.0 marker is staged (CHANGELOG-only); `package.json.version` stays at `2.3.0` until milestone end per D-04. `dispatch({ name: "fetch_graylog_messages" })` rejects with `Tool not found: fetch_graylog_messages` — exact pattern match with the legacy if-chain's error.
  - Error-message text `Use 'use_connection' first` → `Use 'set_active_connection' first` (Rule 1 fix in `src/handlers.js`, `src/tools/cluster-errors.js`, `src/tools/template-mgmt.js`, plus 4 description texts in `src/tools.js`). The old text would mislead agents (Tool not found if followed). Single-line snapshot update captures the new text; every other regression-snapshot entry is byte-identical — plan-anticipated as "only the embedded tool-name strings ... differ from the baseline".
  - Snapshot fixtures live under `test/regression/__snapshots__/` (not `test/__snapshots__/` as the plan predicted) because Plan 01's `setResolveSnapshotPath` uses `dirname(testFilePath)`. Co-located with the test file; functionally identical to the plan's target location.
  - `src/index.js` shrunk from 904 lines (903-line dispatcher) to 32 lines (transport wiring + module-init `assertAllToolsRegistered`). Module-init assertion fails loudly if any tool in `tools.js` lacks a registered handler (Discretion-06).

- **Plan 00-06 (snapshot fixtures + auth-redaction + schema-parity scaffold)**:
  - Snapshot fixtures store the JSON-parsed payload (`t.assert.snapshot(JSON.parse(res.content[0].text))`), not the raw text. The parse-then-snapshot pattern is robust to future refactors of `JSON.stringify` key-order in the wrapper; the resulting `.snapshot` file is also more human-readable because node:test's default serializer normalises indentation and key order.
  - 10 fixtures across 4 test files (handler 4, list 3, normalize 1 combined, dispatch 2) all use static-only args — no `Date.now()`, no `randomUUID()`, no machine-state. Idempotency key `c2563630c56b18bf5dfdb3bda76bea97` is the sha-256-truncated hash of canonicalised `{ connectionName: "fixture_conn", toolName: "create_stream", args: { title: "Snapshot fixture stream" } }`, deterministic across developer machines.
  - Two consecutive `npm test` runs produce byte-identical md5sums of all 4 snapshot files (`06914d2eec3ab4a9f095d6e0f60efe55  list`, `6be9b517c8d9393e2ec637e6afa71aa4  handler`, `e05deb67dad4b96957e4f3d8edd5946e  normalize`, `e45b695d78a41608861711b4db15227d  dispatch`). FOUND-07 determinism contract provably met.
  - `test/auth-redaction.test.js` uses a context-aware allowlist (`isAllowedMatch`) to distinguish idempotency-key field values (32-hex sha-256 truncations) from genuine apiToken leaks. Both are 32+ alphanumeric chars and match the same regex; the allowlist inspects the ~40 chars preceding each match and whitelists only matches whose context is `idempotencyKey":` (or escape-variant). Self-maintaining — new snapshots inherit the same guard automatically.
  - `test/schema-parity.test.js` Phase 0 baseline asserts only `mutatingBase.shape` keys = `["connectionName", "dryRun", "idempotencyKey"]` and `listBase.shape` keys = `["connectionName", "fields", "limit"]`. Commented enrichment template documents the `assertSchemaParityForTool(toolName, zodSchema)` pattern that Phase 1+ must extend when shipping per-domain mutating tools.
  - Synthetic-fixture sanity check: dropped `"Authorization": "Bearer xyz"` plus a 40-char alphanumeric into a tampered snapshot file under `/tmp/test_auth_check/__snapshots__/` and ran the auth-redaction test; confirmed it correctly fires with 2 violations listed. The allowlist does not over-allow.
  - Zero deviations from plan. RED→GREEN sequence clean: Task 1 RED at `422f942` (ERR_INVALID_STATE on missing snapshots); GREEN at `ab6c628` after `--test-update-snapshots`; Task 2 at `2f643e0` (stub-replace, not strict RED/GREEN — both stubs already trivially passed); Task 3 at `e6bfb72` (VALIDATION.md frontmatter flip).

- **Plan 01-01 (foundation amendments + read-only input tools)**:
  - **A4 amendment (await build)**: `defineMutatingHandler` now wraps `const req = await build(args)` in a try/catch routed through `wrapGraylogError(err, name)`. The plan contracted only the `await` widening, but the existing wrapper had no protection against a build rejection — once `build()` can do async pre-flight reads (Plan 02's update_input GETs current input + cached type catalogue inside build), a 404 from the preflight would crash the test runner with an unhandled rejection. The minimal extension surfaces it as an MCP error envelope instead. Test 2 ("rejected promise") asserts `res.isError === true`; the try/catch is what makes that test green.
  - **A2 amendment (real findExistingMatches)**: Phase 0 stub replaced. Accepts `{ listPath, matchFn, similarityReason? }`; fires `client.request("GET", listPath, null)`; normalizes envelope shapes (`inputs ?? streams ?? extractors ?? items ?? bare array`); projects `{ id, title, similarity_reason }`. `similarityReason` is either a literal string (defaults to `"exact"`) or a per-item function. Back-compat preserved: empty opts OR missing matchFn return `[]` without firing the GET.
  - **BLOCKER #3 fix (defaultFields override)**: `defineListHandler` accepts optional `spec.defaultFields`. When provided AND `args.fields` is absent, the override wins over the framework `DEFAULT_FIELDS`. Existing list tools (Phase 0) that don't pass `defaultFields` see no change — Test 20 specifically pins the back-compat. `list_inputs` uses it to narrow to `[id, title, type, global]` (D-M6 rationale: description is rarely set on inputs; type and global are the most filterable fields for an agent).
  - **D-06 type-catalogue cache**: `src/tools/inputs/type-catalogue.js` exports `getCachedTypeCatalogue(connectionName, conn)` backed by a module-level `Map<connectionName, { fetchedAt, catalogue }>`. One GET per connection per process. `_clearTypeCatalogueForTests()` resets for test isolation. `getEncryptedFieldNamesForType(catalogue, typeFQCN)` returns a Set of fields with `is_encrypted: true` — ready for Plan 02's C3 mitigation. Threat-model T-01-01-03 honored: cache keyed by connectionName, so connection A's catalogue can never reach connection B.
  - **`_connectionName` + `_conn` pass-through in defineListHandler fetch**: Plan suggested calling `resolveConnection(seamArgs)` a second time inside `list-input-types.js`'s fetch to feed the cache. Cleaner: thread the already-resolved `connectionName` + `conn` through fetch's args under leading-underscore framework-internal keys. Matches the `_testConnection` seam convention (underscore = framework internal, never agent input).
  - **Per-domain module layout proven end-to-end**: `src/tools/inputs/` now contains `schemas.js` + 3 handlers + the cache + `index.js` registration barrel. `_register.js` imports the barrel via a single side-effect line (`import "./inputs/index.js"`). Plans 02-04 (create / update / delete + extractors) extend `schemas.js` and add new handlers under the same module.
  - **3 read-only tools** (INPUT-01 list_input_types, INPUT-02 list_inputs, INPUT-03 get_input) registered. `assertAllToolsRegistered(toolDefinitions)` returns OK. `list_input_types` is the first list tool to consume the per-tool cache pattern; `list_inputs` is the first to use `defaultFields`; `get_input` is a plain async handler (single DTO, not a list — wouldn't survive the framework's narrow projection).
  - **Test growth**: 153 → 177 (+24). Focused run = 49/49 pass; full `npm test` = 177/177 pass; zero regressions on the Phase 0 baseline. Commits: `c05817d` (Task 1 RED, 9 failures across 5 files), `1b9504e` (Task 2 GREEN, all 24 new tests pass + 153 baseline preserved).
  - **Plan 02 hand-off**: `update_input` can now compose `getCachedTypeCatalogue` + `getEncryptedFieldNamesForType` inside its `build()` for C3 mitigation. `create_input` can wire `findExistingMatches({ listPath: "/api/system/inputs", matchFn })` for list-before-create idempotency. The `cascades-forwarding amendment` on `delete_input` and the `assertSchemaParityForTool` enrichment of `test/schema-parity.test.js` are owed by Plan 02 (no mutating-tool schemas yet exist to enrich; this plan was read-only).

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

**Last action**: Completed `01-01-PLAN.md` — Phase 1's foundation-amendments plan. Shipped the A4 (`await build()` in `defineMutatingHandler` + try/catch routing build rejections through `wrapGraylogError`), A2 (real `findExistingMatches({ listPath, matchFn })` with envelope-shape normalization and callable similarityReason), and BLOCKER #3 fix (`defineListHandler` per-tool `defaultFields` override). Created `src/tools/inputs/type-catalogue.js` with the D-06 per-connection cache + `getEncryptedFieldNamesForType` helper for Plan 02's C3 mitigation. Wired 3 read-only tools (INPUT-01 list_input_types, INPUT-02 list_inputs default projection [id,title,type,global], INPUT-03 get_input). Per-domain module layout proven end-to-end under `src/tools/inputs/`. Test growth 153 → 177 (+24); focused run 49/49; full `npm test` 177/177 pass; zero regressions. Commits: `c05817d` (Task 1 RED), `1b9504e` (Task 2 GREEN).

**Stopped at**: Completed 01-01-PLAN.md — every Plan 02 blocker cleared; ready for Plan 02 (create_input + update_input with C3 mitigation).

**Next action**: Execute `01-02-PLAN.md` (create_input + delete_input — the two simpler CRUD endpoints) OR `01-02/03-PLAN.md` per the phase planning sequence. Plan 02 inherits: (1) `await build()` so update_input can pre-flight inside build; (2) real `findExistingMatches` for create-before-list idempotency; (3) `getCachedTypeCatalogue` + `getEncryptedFieldNamesForType` for update_input's C3 mitigation. Plan 02 still owes: cascade-forwarding amendment in handler.js for delete_input's dry-run; `assertSchemaParityForTool` enrichment of `test/schema-parity.test.js` for the first set of mutating-tool schemas; the C3-mitigation snapshot fixture (encrypted field absent from update_input dry-run body).

---
*State initialized: 2026-05-13*
