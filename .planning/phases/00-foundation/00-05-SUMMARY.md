---
phase: 00-foundation
plan: 05
subsystem: dispatch
tags: [dispatch-map, tool-rename, breaking-change, regression-snapshot, verb-domain-noun]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: "node:test runner + regression test stub (Plan 01); test/existing/ unified suite (Plan 02); makeClient + typed errors (Plan 03); defineMutatingHandler / defineListHandler factories (Plan 04)"
provides:
  - "src/dispatch.js — Map-backed dispatch with register/dispatch/assertAllToolsRegistered/_clearForTests"
  - "src/handlers.js — 17 v2.3 read-tool handlers extracted as `export async function` declarations (top-level, no transport side-effect)"
  - "src/tools/_register.js — single side-effect-import barrel registering all 23 tools"
  - "src/index.js — trimmed from 904 lines (903-line dispatcher) to 32 lines (transport wiring + module-init assertAllToolsRegistered)"
  - "12 of 23 tools renamed per <verb>_<domain>_<noun> (D-03 hard rename, no aliases)"
  - "CHANGELOG.md — v3.0.0-unreleased entry with rename map + Phase 0 added/changed sections"
  - "Pitfall-1 regression net: 8 fixtures, byte-precise before/after dispatch flip, single-line diff after rename"
affects:
  - "Every Phase 1+ admin tool (each new tool registers through src/tools/_register.js against src/dispatch.js)"
  - "All future MCP clients (must use new tool names; old names dispatch as Tool not found)"
  - "Plan 00-06 (zod schema-parity check + auth-redaction lint operate on the new tool catalogue)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Map<string, handler> dispatch with module-init assertAllToolsRegistered fail-fast (Discretion-06)"
    - "Side-effect-import barrel (src/tools/_register.js) wires every handler at import time — Phase 1+ tools follow this pattern when registering themselves"
    - "Handler-extraction-to-separate-module (src/handlers.js) keeps tests importable without triggering StdioServerTransport top-level await"
    - "Byte-precise regression snapshot pattern (Pitfall 1): capture baseline before refactor, prove zero diff after refactor; only tool-name strings change after rename"
    - "Internal-name-vs-external-name decoupling: handler function names (useConnectionHandler) keep OLD camelCase; dispatch Map binds NEW external names (set_active_connection) to those handlers. Per RESEARCH.md Q9 closing rationale, internal-name churn deferred."

key-files:
  created:
    - "src/dispatch.js"
    - "src/handlers.js"
    - "src/tools/_register.js"
    - "CHANGELOG.md"
    - "test/regression/__snapshots__/read-tools.test.js.snapshot"
  modified:
    - "src/index.js (904-line dispatcher → 32-line transport wiring)"
    - "src/tools.js (12 name fields renamed; descriptions otherwise unchanged)"
    - "src/handlers.js (additional Rule 1 fix: 'Use use_connection first' → 'Use set_active_connection first')"
    - "src/tools/cluster-errors.js (same Rule 1 error-message rename)"
    - "src/tools/template-mgmt.js (same Rule 1 error-message rename)"
    - "README.md (tool-reference tables updated to new names)"
    - "test/dispatch.test.js (stub replaced with 12 real unit tests)"
    - "test/regression/read-tools.test.js (stub replaced with 8 snapshot fixtures routed through dispatch)"

key-decisions:
  - "Extract handlers to src/handlers.js (not keep in src/index.js) because top-level `await server.connect(transport)` in src/index.js hangs node:test imports — Rule 3 blocker; plan anticipated this via the circular-import contingency note. src/index.js now imports handlers from src/handlers.js, then via _register.js wires them to the dispatch Map."
  - "dispatch() declared `async` so it returns a rejecting Promise on unknown-tool (matches the contract `Promise<MCPResponse>` and the `await dispatch(...)` call site). Synchronous throws would not satisfy `assert.rejects()`."
  - "Snapshot fixtures hosted at test/regression/__snapshots__/ (not test/__snapshots__/ as the plan predicted) because Plan 01's setResolveSnapshotPath uses dirname(testFilePath). Functionally identical — fixtures co-locate with their test file."
  - "fetch_graylog_messages-without-active-connection fixture pins connections via _setConnectionsForTests({}) so the 'Available: none' error message is reproducible across developer machines (not leaking developer-local ~/.graylog-mcp/config.json entries)."
  - "Internal handler function names retain OLD camelCase (useConnectionHandler, fetchGraylogMessagesHandler) per RESEARCH.md Q9 closing rationale. The dispatch Map maps NEW names → unchanged handlers. Phase 0 keeps blast radius small."
  - "Error-message text 'Use use_connection first' updated to 'Use set_active_connection first' as a Rule 1 fix — the old text would actively mislead agents (Tool not found if followed). This requires a one-line snapshot update (the plan called this out: 'only the embedded tool-name strings ... differ from the baseline')."
  - "Hard rename, no aliases per D-03. CHANGELOG.md is the single migration-pointer document. v3.0.0 marker is staged (CHANGELOG-only); package.json.version stays at 2.3.0 until milestone end per D-04."

patterns-established:
  - "Every Phase 1+ tool registers via `register(name, handler)` in src/tools/_register.js (or a per-domain barrel that the central barrel imports). assertAllToolsRegistered catches misconfiguration at module-init."
  - "Pitfall-1 regression net per refactor: capture baseline, verify byte-identical after change, allow controlled snapshot updates only when the change is intentional (e.g. rename) and the diff is bounded to the changed surface."
  - "Tool-name convention enforcement: every name in src/tools.js MUST match `<verb>_<domain>_<noun>`. Phase 0 brought existing tools into compliance; Phase 1+ checks new tools at the schema-parity layer (Plan 06)."

requirements-completed: [FOUND-01, FOUND-13]

# Metrics
duration: ~26 min
completed: 2026-05-15
---

# Phase 00 Plan 05: Dispatch Map + Tool Rename Summary

**The 903-line `if (name === ...)` dispatcher in `src/index.js` is replaced by a Map-backed dispatch with module-init `assertAllToolsRegistered`; 12 of 23 v2.3 tools are renamed to `<verb>_<domain>_<noun>` with no aliases; regression snapshots prove byte-identical behavior except for a single tool-name string change in one error message.**

## Performance

- **Duration:** ~26 min
- **Started:** 2026-05-15T07:05:24Z
- **Completed:** 2026-05-15T07:31:26Z
- **Tasks:** 3 (Task 1 baseline, Task 2 dispatch flip, Task 3 rename map)
- **Commits:** 3 task commits + 1 metadata commit (this SUMMARY + STATE + ROADMAP)
- **Files:** 5 created, 8 modified, 0 deleted
- **Test growth:** 124 → 142 tests / 18 suites (8 regression fixtures + 10 net-new dispatch unit tests; 1 stub stub-test removed from each of dispatch.test.js and regression/read-tools.test.js as the stubs were replaced with real assertions; net +18)

## Accomplishments

### Task 1 (commit `c3f847c`) — Extract handlers + baseline regression net

- 17 read-tool handlers extracted from inline `src/index.js` bodies into `src/handlers.js` as `export async function` declarations:
  `listConnectionsHandler`, `useConnectionHandler`, `fetchGraylogMessagesHandler`,
  `getSurroundingMessagesHandler`, `listStreamsHandler`, `listFieldValuesHandler`,
  `getLogHistogramHandler`, `getFieldAggregationHandler`,
  `getFieldTimeAggregationHandler`, `debugHistogramQueryHandler`,
  `saveSearchHandler`, `listSavedSearchesHandler`, `getSavedSearchHandler`,
  `deleteSavedSearchHandler`, `searchEventsHandler`,
  `getEventDefinitionsHandler`, `getEventNotificationsHandler`.
- `src/index.js` if-chain unchanged in this task — still routes to handlers,
  but via the imported names instead of inline function bodies.
- Built `test/regression/read-tools.test.js` with 8 snapshot fixtures
  covering `list_connections`, `set_active_connection` happy/missing/unknown
  paths, `list_saved_searches`, `get_saved_search` error path,
  `list_log_templates` via `_testConnection`, and `fetch_graylog_messages`
  no-active-connection error envelope.
- Baseline snapshot file created at `test/regression/__snapshots__/read-tools.test.js.snapshot`
  — 8 entries, deterministic across developer machines (no env-dependent
  leakage from `~/.graylog-mcp/config.json`).
- npm test: 124 → 131 tests, all green.

### Task 2 (commit `334b877`) — Build dispatch Map + flip src/index.js

- `src/dispatch.js`: 4 named exports (`register`, `dispatch`,
  `assertAllToolsRegistered`, `_clearForTests`). `dispatch` is `async` so
  it returns a rejecting Promise on `Tool not found`. Duplicate-register
  guard with offending-name error string. Non-function/null handler
  rejection.
- `src/tools/_register.js`: single side-effect-import barrel with 23
  `register()` calls (using OLD names; renamed in Task 3).
- `src/index.js` trimmed from 904 lines to 32 lines:
  - Removed the entire 65-line if-chain block.
  - Added `import "./tools/_register.js"` (side-effect).
  - Added `assertAllToolsRegistered(toolDefinitions)` at module-top
    (Discretion-06: fail-fast at startup).
  - `setRequestHandler(CallToolRequestSchema, dispatch)` — dispatch
    passed as the handler directly.
- `test/dispatch.test.js`: stub replaced with 12 unit tests
  (register/dispatch happy path, response forwarding, duplicate-guard,
  unknown-tool, empty-params, non-function/null rejection, all 3
  assertAllToolsRegistered branches, `_clearForTests` reset).
- `test/regression/read-tools.test.js` now routes through `dispatch()`
  instead of importing handlers directly. **Baseline snapshot
  byte-identical — proves Map dispatch produces the same responses.**
- npm test: 131 → 142 tests, all green.
- Module-init startup probe: `STARTUP OK`.
- Unknown-tool probe: `Tool not found: unknown_tool` (exact contract match).

### Task 3 (commit `1394362`) — D-03 rename map

12 renames in `src/tools.js`:
- `use_connection` → `set_active_connection`
- `fetch_graylog_messages` → `search_messages_graylog`
- `get_surrounding_messages` → `get_context_messages`
- `get_log_histogram` → `get_histogram_messages`
- `get_field_aggregation` → `get_aggregation_field`
- `get_field_time_aggregation` → `get_aggregation_field_over_time`
- `debug_histogram_query` → `debug_query_histogram`
- `save_search` → `create_saved_search`
- `search_events` → `search_events_graylog`
- `get_event_definitions` → `list_event_definitions`
- `get_event_notifications` → `list_event_notifications`
- `rename_log_template` → `update_log_template`

11 tools already fit and were left unchanged: `list_connections`,
`list_streams`, `list_field_values`, `list_saved_searches`,
`get_saved_search`, `delete_saved_search`, `cluster_log_messages`,
`list_log_templates`, `delete_log_template`, `export_log_templates`,
`import_log_templates`.

Files touched:
- `src/tools.js`: 12 `name:` fields swapped via Edit; 2 `description:`
  references to `fetch_graylog_messages` inside the
  `cluster_log_messages` description also swapped (Rule 1 — they were
  inviting agents to call a tool that no longer exists).
- `src/tools/_register.js`: 12 `register()` calls updated; reorganized
  into "already-fit (11)" and "renamed (12)" groups with comment
  pointing at CHANGELOG.md.
- `src/handlers.js`, `src/tools/cluster-errors.js`,
  `src/tools/template-mgmt.js`: error-message text "Use 'use_connection'
  first" → "Use 'set_active_connection' first" (Rule 1 — old text
  misleads agents).
- `README.md`: 6 Edit operations swapping table entries; no old names
  left after rewrite.
- `CHANGELOG.md` (new at repo root): v3.0.0-unreleased entry with
  rename map, Added/Changed sections summarizing Plans 00-01 through
  00-05, migration notes.
- `test/regression/read-tools.test.js`: 4 `dispatch()` call-site name
  arguments updated to new tool names.
- `test/regression/__snapshots__/read-tools.test.js.snapshot`:
  **single-line diff** — only the
  `fetch_graylog_messages-without-active-connection` fixture's error
  message text shifts from `Use 'use_connection' first` to
  `Use 'set_active_connection' first`. Every other entry is
  byte-identical. Confirms the rename touches only the tool-name
  string surface, not response shape.
- npm test: 142 tests, all green.
- Old-name dispatch probe: `dispatch({ name: "fetch_graylog_messages" })`
  → `Tool not found: fetch_graylog_messages` (exact pattern match).

## Task Commits

| # | Task | Commit | Type |
|---|------|--------|------|
| 1 | Extract handlers to src/handlers.js + capture regression baseline | `c3f847c` | refactor |
| 2 | src/dispatch.js Map + flip src/index.js + dispatch.test.js | `334b877` | feat |
| 3 | D-03 rename map (12 tools) + CHANGELOG + README | `1394362` | feat! |

Plan metadata commit follows under `docs(00-05): complete dispatch + rename plan`.

The `feat!` marker on Task 3 follows Conventional Commits to flag the
breaking change (downstream MCP clients must update hardcoded tool names).

## Files Created/Modified

**Created (5):**
- `src/dispatch.js` (43 lines) — Map dispatch with 4 exports
- `src/handlers.js` (608 lines) — 17 extracted v2.3 handlers + private `requireActiveConnection` helper
- `src/tools/_register.js` (64 lines) — registration barrel for 23 tools
- `CHANGELOG.md` (49 lines) — v3.0.0-unreleased entry
- `test/regression/__snapshots__/read-tools.test.js.snapshot` — 8 baseline entries

**Modified (8):**
- `src/index.js` — trimmed from 904 → 32 lines; no inline dispatch logic
- `src/tools.js` — 12 `name:` fields renamed; 2 description-text updates
- `src/tools/cluster-errors.js` — error-message rename (1 line)
- `src/tools/template-mgmt.js` — error-message rename (1 line)
- `README.md` — 6 tool-table renames; no old names remain
- `test/dispatch.test.js` — stub replaced with 12 real unit tests
- `test/regression/read-tools.test.js` — stub replaced with 8 snapshot fixtures (routed through dispatch in Task 2; new names in Task 3)
- `package.json` — unchanged (kept at 2.3.0 per D-04)

## Decisions Made

- **Extract handlers to `src/handlers.js`** (not keep in `src/index.js`) because top-level `await server.connect(transport)` in `src/index.js` causes node:test imports to hang. The plan anticipated this in its circular-import contingency note. Tests now `import` from `src/handlers.js` cleanly; `src/index.js` re-imports them and wires them via `_register.js`. This is a Rule 3 blocker fix (see Deviations).
- **`dispatch()` declared `async`** so it returns a rejecting Promise on `Tool not found`. The contract spec says `Promise<MCPResponse>`. A synchronous throw would not satisfy `await dispatch(...)` at the SDK call site or `assert.rejects(() => dispatch(...))` in tests.
- **Snapshot fixtures under `test/regression/__snapshots__/`** (not `test/__snapshots__/` as the plan predicted). Plan 01's `setResolveSnapshotPath` uses `dirname(testFilePath)` — for files under `test/regression/`, that resolves to `test/regression/__snapshots__/`. Functionally identical; just co-located with the test file.
- **`fetch_graylog_messages` regression fixture uses `_setConnectionsForTests({})`** so the "No active connection ... Available: none" error message is reproducible across developer machines. Without this, the test snapshots whatever connections live in `~/.graylog-mcp/config.json` on the dev's machine.
- **Internal handler function names retain OLD camelCase.** `useConnectionHandler` still backs `set_active_connection`; `fetchGraylogMessagesHandler` still backs `search_messages_graylog`. Per RESEARCH.md Q9 closing rationale, internal-name churn is out of scope for Phase 0. The dispatch Map decouples external names from internal symbols.
- **Error-message text 'Use use_connection first' → 'Use set_active_connection first'** (Rule 1 fix). The old text would actively mislead agents — they'd follow the instruction, get `Tool not found`. The fix requires a one-line snapshot update; this is the kind of controlled rename diff the plan explicitly authorized.
- **`description:` references to `fetch_graylog_messages` inside `cluster_log_messages`** updated to `search_messages_graylog` (Rule 1) — same reasoning. The plan said "leave description text as-is unless directly user-confusing"; these descriptions were directly user-confusing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Top-level await hang forced handler extraction to a separate file**
- **Found during:** Task 1, immediately after attempting to extract handlers as `export async function` in `src/index.js`.
- **Issue:** `src/index.js` ends with `await server.connect(transport)` at module top level. When node:test tries to `import` exported handlers from that file (so the regression suite can call them directly to capture the baseline), the import never resolves — `StdioServerTransport.connect` holds the event loop open waiting on stdin. The test process hangs until `timeout` kills it.
- **Fix:** Created `src/handlers.js` as the home for the 17 extracted handlers. `src/index.js` imports them from there, both for the if-chain (Task 1) and for `src/tools/_register.js` (Task 2). Tests `import "../../src/handlers.js"` cleanly with no transport side-effect.
- **Files affected:** `src/handlers.js` (new), `src/index.js` (imports from handlers.js instead of defining inline).
- **Verification:** `timeout 10 node --test /tmp/test-import.js` with an `import` from `src/handlers.js` exits 0 in <1s; same import from `src/index.js` previously hung.
- **Committed in:** `c3f847c` (Task 1 commit — the fix is the foundation Task 1 stands on).
- **Plan anticipation:** Plan's `<interfaces>` block explicitly authorised this: *"Handlers MUST be `export async function` declarations (hoisted via static ESM analysis); arrow consts will hit TDZ. If TDZ occurs, the executor moves handler declarations to a new `src/handlers.js` file and updates both `src/index.js` and `_register.js` to import from there."* The trigger turned out to be top-level await, not TDZ, but the resolution is identical and within plan-authorized scope.

**2. [Rule 1 — Bug] `dispatch()` was synchronous; `assert.rejects` requires Promise rejection**
- **Found during:** Task 2, running `node --test test/dispatch.test.js` after the initial dispatch.js was committed. 3 of 12 tests failed with `Function did not throw, or threw synchronously` — the `assert.rejects(() => dispatch(...))` cases.
- **Issue:** `dispatch` was declared as a plain `function`. When the handler isn't found, the `throw` happens synchronously — outside the resulting promise. `assert.rejects` expects a function whose returned promise rejects; a synchronous throw doesn't satisfy that. More importantly, the contract spec says `dispatch(request): Promise<MCPResponse>` — every consumer expects a Promise.
- **Fix:** Changed `export function dispatch(request)` → `export async function dispatch(request)`. Synchronous throws inside an `async` function become Promise rejections automatically. All 12 unit tests now pass; the SDK call site (`setRequestHandler(CallToolRequestSchema, dispatch)`) behavior is unchanged since the SDK already awaits the handler's return value.
- **Files modified:** `src/dispatch.js`.
- **Verification:** 12/12 dispatch tests pass; `await dispatch({ name: 'ghost' })` rejects with `Tool not found: ghost`.
- **Committed in:** `334b877` (Task 2 commit, post-fix).

**3. [Rule 1 — Bug] Stale `use_connection` references in user-facing error messages and tool descriptions**
- **Found during:** Task 3, after applying the rename map to `src/tools.js` and `src/tools/_register.js`. The error-text `No active connection. Use 'use_connection' first.` and the descriptions of `search_messages_graylog`, `search_events_graylog`, `list_event_definitions`, `list_event_notifications` still said `use_connection`.
- **Issue:** Agents reading the error message or description would call `use_connection`, get `Tool not found`, and lose trust. The text was no longer just stylistic — it was actively misleading. Plus, the `cluster_log_messages` description references `fetch_graylog_messages` as a "same args as" pointer; if an agent follows that pointer it hits a dead name.
- **Fix:** Edit-tool replacements in `src/handlers.js`, `src/tools/cluster-errors.js`, `src/tools/template-mgmt.js` (all 3 instances of the error message), plus 4 description-text instances in `src/tools.js` (`use_connection` → `set_active_connection`) and 2 description-text instances of `fetch_graylog_messages` → `search_messages_graylog`.
- **Files modified:** `src/handlers.js`, `src/tools/cluster-errors.js`, `src/tools/template-mgmt.js`, `src/tools.js`.
- **Verification:** Final grep of `src/` (excluding `_shared/connection.js` which contains a Plan 05 rename comment) returns zero old names. `npm test` 142/18 green. One-line snapshot update in `test/regression/__snapshots__/read-tools.test.js.snapshot` captures the new error text.
- **Committed in:** `1394362` (Task 3 commit).
- **Plan note:** The plan said *"leave description text as-is for this phase unless it's directly user-confusing"* — these were directly user-confusing. The plan also authorised the one-line snapshot update: *"The body content of each snapshot is unchanged — only the embedded `tool` field shifts."*

---

**Total deviations:** 3 auto-fixed (1 Rule 3 blocker, 2 Rule 1 bugs). No Rule 2 (no missing security functionality), no Rule 4 (no architectural decisions needed).
**Impact on plan:** All 3 fixes are within scope. The Rule 3 fix is the foundation Task 1 and Task 2 stand on — without it node:test can't import the handlers. The two Rule 1 fixes are corrections that the plan explicitly authorised under its "user-confusing" exception. No scope creep, no out-of-scope src/ changes.

## Threat Surface

All threats enumerated in the plan's `<threat_model>` block are mitigated by the shipped code:

- **T-00-05-01 (per-tool payload-shape regression):** Mitigated. Task 1 captured byte-precise baseline snapshots for 8 representative read paths. Task 2's flip to Map dispatch produced byte-identical snapshots — proven by `node --test test/regression/read-tools.test.js` exiting 0 without `--test-update-snapshots`. Task 3 produced exactly one one-line diff in the snapshot file, and only in the embedded tool-name string of a single error-message body — the rest of the snapshot is byte-identical.
- **T-00-05-02 (module-init throw on missing handler):** Accepted per Discretion-06. `assertAllToolsRegistered(toolDefinitions)` runs at module-top in `src/index.js`. A misconfigured deployment fails at startup, not at first call.
- **T-00-05-03 (duplicate registration silently overwriting):** Mitigated. `register()` throws `Tool already registered: <name>` on duplicate; verified by `test/dispatch.test.js` Test 4.
- **T-00-05-04 (old tool name accidentally re-introduced):** Mitigated. CHANGELOG.md is the authoritative rename map; grep guards in this plan's Task 3 verification confirmed zero old names in `src/tools.js`, `src/tools/_register.js`, or `README.md` (a few stale references in error messages and descriptions were caught and fixed as Rule 1 deviations). Plan 06's snapshot-lint will scan for old-name leakage going forward.
- **T-00-05-05 (regression-snapshot files leaking real connection data):** Mitigated. All 8 regression fixtures use `_setConnectionsForTests({...})` to inject synthetic `test_a` / `test_b` connections, never touching `~/.graylog-mcp/config.json`. The `_testConnection` seam (template-mgmt path) uses a synthetic connection name. The `apiToken` field of the fixture connections is `"token_a"` / `"token_b"` (plain strings, not real tokens). Plan 06's auth-redaction lint enforces this going forward.
- **T-00-05-06 (internal/external name mismatch):** Accepted per RESEARCH.md Q9 closing rationale. `useConnectionHandler` backs `set_active_connection`; `fetchGraylogMessagesHandler` backs `search_messages_graylog`. Documented as a Decision Made above. Minor grep-ability inconvenience accepted; internal rename deferred to a follow-up cleanup phase.
- **T-00-05-07 (CHANGELOG inaccurately documenting renames):** Mitigated. CHANGELOG.md's rename table was hand-verified against the authoritative map in the plan. The verification grep loop ran across both `src/tools.js` and `README.md` and returned zero old names. Each old→new pair appears exactly once in the CHANGELOG.

No new threat surface beyond what the plan covered. No `## Threat Flags` section needed.

## Issues Encountered

None beyond the deviations above. Each was discovered during the task's own
verification step, fixed in the same task's commit window (Rule 3 fix folded
into Task 1 commit, Rule 1 dispatch-async fix into Task 2 commit, Rule 1
error-text fixes into Task 3 commit), and verified before moving forward.

## User Setup Required

None — pure code refactor + tool-name rename. MCP clients that hardcoded
old tool-name strings need to update them (CHANGELOG.md is the migration
pointer), but that's not a graylog-mcp setup concern.

## TDD Gate Compliance

This plan was not a TDD plan (`type: execute`, `tdd="false"` on all three
tasks). The `test(...)`/`refactor(...)`/`feat(...)` commit types reflect
the conventional-commit category of each task's work, not a RED/GREEN
sequence. Task 1's commit is `refactor` because it extracts code without
changing behavior; Task 2 and Task 3 are `feat` because they add new
dispatch primitives and rename external surface. The exclamation in
`feat(00-05)!` on Task 3 flags the breaking-change marker per Conventional
Commits.

## Next Phase Readiness

- `npm test` is green: 142 tests / 18 suites.
- The dispatch Map is the single registration point for every Phase 1+
  admin tool. New tools register through `src/tools/_register.js` (or via
  per-domain barrels that the central one imports for side-effect).
- `assertAllToolsRegistered` will catch every future tool whose name lands
  in `src/tools.js` but whose handler isn't registered — at module-init,
  not at first call.
- The `<verb>_<domain>_<noun>` convention is now consistent across all 23
  existing tools. Phase 1+ tools MUST follow it; the schema-parity check
  in Plan 00-06 will police drift between the tool catalogue and the
  per-domain zod schemas.
- CHANGELOG.md is established as the migration-pointer document; future
  breaking changes append entries above the v3.0.0-unreleased block.
- v3.0.0 release marker is staged (CHANGELOG-only); package.json.version
  stays at 2.3.0 until milestone end per D-04.
- Plan 06 (final Phase 0 plan: zod schema-parity check + auth-redaction
  lint + writable-flag enforcement test) is ready to start.

## Self-Check: PASSED

- All 5 created files present on disk:
  - `src/dispatch.js`, `src/handlers.js`, `src/tools/_register.js`,
    `CHANGELOG.md`, `test/regression/__snapshots__/read-tools.test.js.snapshot`.
- All 8 modified files have their changes in place:
  - `src/index.js` (32 lines, dispatch wiring only),
  - `src/tools.js` (23 names, 12 renamed),
  - `src/tools/cluster-errors.js`, `src/tools/template-mgmt.js`,
    `src/handlers.js` (error-message text updated),
  - `README.md` (no old names; new names in tables),
  - `test/dispatch.test.js` (12 real tests),
  - `test/regression/read-tools.test.js` (8 dispatch-routed fixtures).
- All 3 task commits resolvable in git history:
  - `c3f847c` (Task 1 — extract handlers + baseline),
  - `334b877` (Task 2 — dispatch Map flip),
  - `1394362` (Task 3 — rename + CHANGELOG + README).
- All grep acceptance counts hit their targets:
  - `grep -c '^export ' src/dispatch.js` → 4 (≥4 plan threshold)
  - `grep -cE '^register\(' src/tools/_register.js` → 23
  - `grep -c 'request.params.name === ' src/index.js` → 0 (if-chain gone)
  - `grep -c 'assertAllToolsRegistered' src/index.js` → 2 (import + call site)
  - `grep -c 'setRequestHandler(CallToolRequestSchema, dispatch)' src/index.js` → 1
  - `grep -cE 'name: "(set_active_connection|...|update_log_template)"' src/tools.js` → 12 (all 12 new names present)
  - `grep -cE 'name: "(use_connection|...|get_field_time_aggregation)"' src/tools.js` → 0 (no old names)
  - `grep -cE 'register\("(set_active_connection|...|update_log_template)"' src/tools/_register.js` → 12
  - `grep -cE 'register\("(use_connection|...|get_field_time_aggregation)"' src/tools/_register.js` → 0
  - `test -f CHANGELOG.md && grep -c "set_active_connection" CHANGELOG.md` → ≥1 ✓
- `npm test` exits 0 with 142 tests / 18 suites green.
- Inline node -e probes:
  - `STARTUP OK` — module-init assertAllToolsRegistered passes.
  - `OLD NAME REJECTED OK` — `dispatch({ name: "fetch_graylog_messages" })` rejects with `Tool not found: fetch_graylog_messages` (exact message match).
- Regression snapshot diff from Task 2 → Task 3: single line (only the embedded `'use_connection'` → `'set_active_connection'` in the no-active-connection error text). Every other entry byte-identical.

---
*Phase: 00-foundation*
*Plan: 05*
*Completed: 2026-05-15*
