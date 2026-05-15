---
phase: 00-foundation
plan: 02
subsystem: testing
tags: [node-test, migration, legacy-tests, file-isolation, tmpdir]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: "node:test runner via `npm test`, snapshot-config harness, 10 scaffold stubs"
provides:
  - "7 node:test files under test/existing/ covering every assertion from the 4 deleted root-level test-*.js scripts"
  - "Repo root cleared of legacy ad-hoc test scripts — npm test is now the single entry point"
  - "Filesystem-isolation pattern (mkdtempSync + _withStorePathOverride + after-hook cleanup) for tests that touch persistent state"
  - "Pattern for converting swallowed try/catch assertions to surfacing assertions via node:test"
affects:
  - "00-03 (axios client tests now run inside the unified suite)"
  - "00-04 (handler-factory tests can rely on existing test seams already exercised here)"
  - "00-05 (dispatch refactor — every cluster/template assertion is a regression net)"
  - "00-06 (zod schema-parity tests can target existing tools that now have coverage)"
  - "All later phases (npm test is now the canonical regression net)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-suite filesystem isolation: mkdtempSync(join(tmpdir(), <prefix>)) + _withStorePathOverride() in beforeEach, after-hook rmSync cleanup. Avoids cross-test bleed when multiple suites share the same template-store seam."
    - "Swallowed-error removal: try/catch wrappers in the legacy scripts that converted assertion failures to console.error are dropped during migration — node:test surfaces failures correctly without them (RESEARCH.md Q8)."
    - "Test seam preservation: _clearForTests, _withStorePathOverride, _setSearchOverride, _testConnection survive verbatim — the migration changes wrapping syntax, not semantics."

key-files:
  created:
    - "test/existing/clustering-preprocess.test.js"
    - "test/existing/clustering-strategy.test.js"
    - "test/existing/template-store.test.js"
    - "test/existing/template-mgmt.test.js"
    - "test/existing/features.test.js"
    - "test/existing/aggregation-fixes.test.js"
    - "test/existing/histogram-fixes.test.js"
  modified:
    - "package-lock.json (synced to Plan 01's package.json bumps — Rule 3 auto-fix)"

key-decisions:
  - "Per-suite mkdtempSync + after-hook cleanup (not a single shared temp dir) so suites that re-call _withStorePathOverride don't leak paths across each other"
  - "Removed swallowed try/catch in test-features.js migration so node:test reporter actually fails red on broken assertions"
  - "Deleted (not archived) the 4 root-level scripts — git history is the archive"
  - "Synced package-lock.json as a Rule 3 fix: Plan 01 bumped @types/node and engines.node without re-running npm install, so axios was missing from node_modules and the new tests couldn't import production code"

patterns-established:
  - "Migration shape: each `console.log('=== X ===')` section -> `describe('X', () => { ... })`, each `console.log('✓ <thing>')` -> `test('<thing>', () => { ... })`, the surrounding assert.* calls land inside the new test() callback verbatim"
  - "State setup that previously sat at module top level moves into beforeEach; cleanup moves into after"

requirements-completed: [FOUND-06]

# Metrics
duration: ~15 min (split across two sessions: 4 files staged in a prior session, 3 files + deletions + lockfile sync today)
completed: 2026-05-15
---

# Phase 00 Plan 02: Existing-test Migration Summary

**7 node:test files under `test/existing/` replace the four root-level `test-*.js` scripts; `npm test` is now the single entry point for the full unified suite (64 tests / 18 suites, all green).**

## Performance

- **Duration:** ~15 min (across two sessions)
- **Started:** 2026-05-13 (Task 1 files staged in a prior interrupted session)
- **Resumed:** 2026-05-15T08:28:00Z (this session — Task 2 + deletions + lockfile sync + commits)
- **Completed:** 2026-05-15T08:28:38Z
- **Tasks:** 2 (Task 1 completed previously, Task 2 completed this session)
- **Files:** 7 created, 4 deleted, 1 modified (package-lock.json)
- **Commits:** 3 task commits + 1 metadata commit (this SUMMARY + STATE + ROADMAP)

## Accomplishments

- **Per-source migration counts:**
  - `test-clustering.js` (8 `console.log("✓ ...")` lines, ~308 lines) → 4 files, **19 test() blocks**
    - `clustering-preprocess.test.js`: 7 test blocks (Preprocessor + Tokenize)
    - `clustering-strategy.test.js`: 2 test blocks (Registry + Drain3 with serialize roundtrip)
    - `template-store.test.js`: 3 test blocks (empty load + roundtrip + corrupt-recovery)
    - `template-mgmt.test.js`: 7 test blocks (Formatter ×2 + handler + list/rename/delete + export + import-merge + import-replace)
  - `test-features.js` (~135 lines, 4 sections) → `features.test.js`, **13 test blocks** (Time-range parsing ×6 + Aggregation payloads ×3 + Error handling ×3 + Argument normalization ×3 — note: 6 + 3 + 3 + 3 = 15 declared; 13 distinct test() blocks after merging the two ISO-related assertions and consolidating the absolute-range setup)
  - `test-aggregation-fixes.js` (~84 lines) → `aggregation-fixes.test.js`, **8 test blocks** (3 histogram approaches + 2 field-time approaches + 3 structure comparisons including the explicit `row_groups[0].type === "time"` check that exercises the buildSimpleTimeHistogram pivot shape)
  - `test-histogram-fixes.js` (~74 lines) → `histogram-fixes.test.js`, **14 test blocks** across 3 describes (Working field-time baseline, buildWorkingHistogram structure, pattern-match cross-checks including `assert.deepEqual` on the time-interval shape)
- **Total migrated:** 7 files, 54 test() blocks (35 net-new this session + 19 from Task 1's prior staging).
- **All 4 root-level `test-*.js` scripts deleted** — git history preserves them.
- **`npm test` is now the canonical regression net** for everything the legacy scripts used to cover: 64 tests across 18 suites pass green.
- **Filesystem isolation:** every suite that touches the template-store mints its own `mkdtempSync(join(tmpdir(), <prefix>))` in `beforeEach` and cleans up with an `after` hook — no cross-suite bleed, no `~/.graylog-mcp/` contamination during test runs.

## Task Commits

| # | Task | Commit | Type |
|---|------|--------|------|
| 1 | Task 1: Migrate `test-clustering.js` → 4 files (clustering-preprocess, clustering-strategy, template-store, template-mgmt) | `688480f` | test |
| 2 | Task 2: Migrate remaining 3 scripts (features, aggregation-fixes, histogram-fixes) + delete 4 root originals | `19133ed` | test |
| 3 | Rule 3 deviation: sync `package-lock.json` to Plan 01's `package.json` bumps so axios actually installs | `acf12c4` | chore |

Plan metadata commit follows separately under `docs(00-02): complete test-existing migration plan`.

## Files Created/Modified

**Created (7):**
- `test/existing/clustering-preprocess.test.js` — normalizeMessage + tokenize assertions
- `test/existing/clustering-strategy.test.js` — register/get/list + drain3Strategy hydrate/cluster/serialize roundtrip; `_clearForTests` in beforeEach
- `test/existing/template-store.test.js` — loadTemplateStore + saveTemplateStore + corrupt-recovery; mkdtempSync + `_withStorePathOverride` isolation
- `test/existing/template-mgmt.test.js` — formatClusterResponse + handleClusterLogMessages (via `_setSearchOverride` + `_testConnection`) + list/delete/rename/export/import handlers
- `test/existing/features.test.js` — parseRelativeTime / parseAbsoluteTime / buildTimeRange / normalizeTimeRangeArgs + the three histogram/field/field-time payload builders
- `test/existing/aggregation-fixes.test.js` — three histogram payload builders + two field-time payload builders + a structural comparison block
- `test/existing/histogram-fixes.test.js` — buildWorkingHistogram structure mirrors buildSimpleFieldTimeAggregation pattern

**Deleted (4) at repo root:**
- `test-clustering.js` (308 lines)
- `test-features.js` (135 lines)
- `test-aggregation-fixes.js` (84 lines)
- `test-histogram-fixes.js` (74 lines)

**Modified (1):**
- `package-lock.json` — synced to Plan 01's `@types/node ^22.0.0` and `engines.node >= 22.3.0`; dropped a stray top-level `"npm": "^11.6.0"` dep entry (no matching package.json declaration; accidental artefact of a prior `npm install npm` run upstream).

## Decisions Made

- **Per-suite filesystem isolation (not shared)** — every describe block that calls `_withStorePathOverride` mints its own `mkdtempSync` directory in `beforeEach` and cleans up in `after`. The original scripts shared `dir` / `dir2` / `dir3` / `dir4` at module scope; node:test runs suites concurrently by default and the override is process-global, so sharing the path would race. Isolating per-suite keeps the migration safe under the runner's concurrency model.
- **Swallowed-error try/catch removed** — `test-features.js` wrapped every assertion in `try { ... } catch (error) { console.error(...) }`, which converted assertion failures into log noise that the legacy runner's exit code couldn't detect. The migration drops those wrappers entirely so node:test fails red on broken assertions (RESEARCH.md Q8).
- **Delete, don't archive** — the 4 root scripts go away outright; git history is the only archive. Matches D-05's "Migrate all four ... delete the originals" wording and avoids confusion about which set of tests is authoritative.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Synced `package-lock.json` to Plan 01's `package.json` bumps**
- **Found during:** Task 1 verification (running `node --test` against the staged 4 files revealed `ERR_MODULE_NOT_FOUND: Cannot find package 'axios'`).
- **Issue:** Plan 01 bumped `engines.node` to `>= 22.3.0` and `@types/node` to `^22.0.0` in `package.json` but never re-ran `npm install`. The lockfile (and on-disk `node_modules/`) stayed pinned to the old `@types/node ^20.19.15` and contained no `axios/` entry at all. `template-mgmt.test.js` imports `handleClusterLogMessages`, which transitively imports `src/query.js`, which `import`s axios — failing the entire suite. Without this fix every later Phase 0 plan that imports production code would have hit the same wall.
- **Fix:** Ran `npm install`, which reconciled the lockfile and populated `node_modules/`. Also dropped a stray top-level `"npm": "^11.6.0"` entry from the lockfile root (no corresponding `package.json` declaration — accidental from a prior `npm install npm`).
- **Files modified:** `package-lock.json`.
- **Verification:** `npm test` exits 0 with 64 tests passing across 18 suites (was: 13 tests / 4 suites with 1 failure pre-fix).
- **Committed in:** `acf12c4` (separate commit so the lockfile churn doesn't muddy the test-migration commits).

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking).
**Impact on plan:** The lockfile sync was a precondition for any verification — without it the migrated tests couldn't import production modules. No scope creep; no `src/` touched; no new dependencies added.

## Issues Encountered

- **Test count nuance vs the plan's `≥ 18 test groups` acceptance criterion**: the plan's expected lower bound was "11 Plan-01 stubs + 7 migrated files ≥ 18". The actual count after migration is **64 tests across 18 suites**, comfortably above the bound. (Plan 01's actual stub count is 10, not 11 — see Plan 01's documented typo deviation; the 18-suite figure here counts each `describe` block plus each top-level `test` as its own suite, which is how node:test reports it.)
- **Previous-session interruption**: a prior execution staged the first 4 migrated files (clustering-preprocess, clustering-strategy, template-store, template-mgmt) as untracked but never committed them. This session committed them under `688480f` as Task 1's atomic commit, then proceeded with Task 2.

## User Setup Required

None — no external service or secret configuration required.

## TDD Gate Compliance

This plan was not a TDD plan (`type: execute`, `tdd="false"` on both tasks). The `test(...)` commit type on Tasks 1 and 2 reflects the conventional-commit category of the work (test infrastructure) rather than a RED/GREEN/REFACTOR sequence.

## Next Phase Readiness

- `npm test` is now the canonical regression net: 64 tests, 18 suites, all green.
- Repo root is free of ad-hoc legacy scripts — every test lives under `test/`.
- Plans 00-03 through 00-06 can now `<automated>`-verify against the unified suite without risk of legacy/new drift.
- `_withStorePathOverride`, `_setSearchOverride`, `_clearForTests`, `_testConnection` seams are exercised under the new runner, so Plan 05's dispatch refactor has a confirmed regression net for the cluster-errors and template-mgmt handlers.
- `axios` and the rest of the dependency tree are correctly installed against the bumped engines/types floors, unblocking Plan 00-03's graylog-client work.

## Self-Check: PASSED

- All 7 created files present on disk (verified via filesystem checks during commits).
- All 4 root-level scripts deleted (`ls test-*.js` returns "No such file or directory").
- All 3 task commits resolvable in git history: `688480f` (Task 1), `19133ed` (Task 2 + deletions), `acf12c4` (Rule 3 lockfile sync).
- `npm test` exits 0 with 64 passing tests across 18 suites — comfortably above the plan's `≥ 18 test groups` acceptance threshold.
- `grep -rE 'console\.log\(' test/existing/` returns 0 lines.
- `grep -rE 'from "\./src' test/existing/` returns 0 lines (all imports use `../../src/`).
- `_clearForTests()` appears in `beforeEach` (not at file top) in `clustering-strategy.test.js`.

---
*Phase: 00-foundation*
*Plan: 02*
*Completed: 2026-05-15*
