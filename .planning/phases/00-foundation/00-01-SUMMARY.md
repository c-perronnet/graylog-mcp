---
phase: 00-foundation
plan: 01
subsystem: testing
tags: [node-test, snapshot, package-json, engines, scaffolding]

# Dependency graph
requires: []
provides:
  - "Working `npm test` invoking `node --test` against `test/**/*.test.js`"
  - "engines.node floor of >= 22.3.0 (D-01) so node:test snapshot APIs are stable"
  - "test/snapshot-config.js — setResolveSnapshotPath hook routing fixtures to test/__snapshots__/"
  - "10 stub test files (1 per future production module + cross-cutting checks) ready for later plans to fill in"
  - "test/__snapshots__/ directory tracked in git via .gitkeep"
affects:
  - "00-02 (delete legacy test-*.js root scripts; populate test/existing/)"
  - "00-03 (graylog-client tests land in test/graylog-client.test.js)"
  - "00-04 (shared handler factory tests in test/handler.test.js)"
  - "00-05 (dispatch refactor — uses test/regression/read-tools.test.js as before/after net)"
  - "00-06 (zod schemas + schema-parity drift detection in test/schema-parity.test.js)"
  - "All later phases (every plan from here forward has an `<automated>` verification hook)"

# Tech tracking
tech-stack:
  added:
    - "node:test (stdlib — no new dep)"
    - "node:test snapshot.setResolveSnapshotPath API (stable on Node 22.3+)"
  patterns:
    - "Co-located fixture pattern: snapshots resolve to `test/__snapshots__/<basename>.test.js.snapshot` rather than the node:test default sibling-file location (per D-06)"
    - "Stub-first scaffold: every future production module gets a passing-stub test file before code lands, guaranteeing `npm test` is green from Wave 1 onward"
    - "Snapshot-config side-effect import at the top of every test file (`import './snapshot-config.js'`)"

key-files:
  created:
    - "test/snapshot-config.js"
    - "test/__snapshots__/.gitkeep"
    - "test/dispatch.test.js"
    - "test/handler.test.js"
    - "test/list.test.js"
    - "test/graylog-client.test.js"
    - "test/normalize.test.js"
    - "test/idempotency.test.js"
    - "test/connection.test.js"
    - "test/schema-parity.test.js"
    - "test/auth-redaction.test.js"
    - "test/regression/read-tools.test.js"
  modified:
    - "package.json (engines.node, scripts.test, devDependencies.@types/node)"

key-decisions:
  - "Strict setResolveSnapshotPath to test/__snapshots__/ rather than node:test's default sibling location (D-06)"
  - "Quote the glob inside scripts.test (`'test/**/*.test.js'`) so Node — not bash — does the expansion; bash without globstar matches only one path and breaks the run"

patterns-established:
  - "node:test header (`import { test } from 'node:test'; import assert from 'node:assert/strict'; import './snapshot-config.js';`) is the canonical first-three-lines for every test file in this repo"
  - "Test files import only stdlib + sibling snapshot-config — never `../src/*` until the production module they cover actually exists"
  - "Each future production module owns exactly one stub test file in test/; cross-cutting concerns (schema-parity, auth-redaction, regression) get their own dedicated stubs"

requirements-completed: [FOUND-06]

# Metrics
duration: ~2min
completed: 2026-05-13
---

# Phase 0 Plan 1: Test Harness Bootstrap Summary

**Node 22+ engine floor, working `npm test` via `node --test`, and a 12-file test/ scaffold (snapshot-config + 10 stubs + .gitkeep) ready for every later Phase 0 plan to fill in.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-05-13T17:15:50Z
- **Completed:** 2026-05-13T17:18:00Z (approx)
- **Tasks:** 2
- **Files modified:** 13 (1 modified, 12 created)

## Accomplishments

- `package.json` updated atomically: `engines.node` → `>= 22.3.0` (D-01), `scripts.test` → `node --test 'test/**/*.test.js'` (D-02 fix), `@types/node` → `^22.0.0`.
- `test/snapshot-config.js` registers `setResolveSnapshotPath` so every snapshot lands in `test/__snapshots__/` (D-06 honored — no sibling `.snapshot` files cluttering the test tree).
- 10 stub test files (9 top-level + 1 under `test/regression/`) each pass a trivial assertion; collectively they cover every future production module and cross-cutting concern (Pitfalls 1, 3, 6).
- `npm test` exits 0 with 10 passing `ok` lines — Wave 1 unblock complete; every later Phase 0 plan now has a place to land its tests and a working test runner.

## Task Commits

1. **Task 1: Update package.json (engines, scripts.test, devDeps)** — `2639926` (chore)
2. **Task 2: Create snapshot-config + stub test scaffold (12 files)** — `10635a0` (test)

(Task 2's commit also carries the Rule 1 quote-the-glob fix to `scripts.test` — see Deviations.)

## Files Created/Modified

- `package.json` — engines.node bumped to `>= 22.3.0`; scripts.test rewritten to invoke `node --test` against a quoted glob; @types/node bumped to ^22.
- `test/snapshot-config.js` — single-purpose module that calls `snapshot.setResolveSnapshotPath` so fixtures land in `test/__snapshots__/` (mkdir-recursive on each resolve).
- `test/__snapshots__/.gitkeep` — empty placeholder so git tracks the fixture directory before any snapshots exist.
- `test/dispatch.test.js` — stub for FOUND-01 (dispatch Map refactor).
- `test/handler.test.js` — stub for FOUND-03/04/05/09/10/11 (defineMutatingHandler factory and friends).
- `test/list.test.js` — stub for FOUND-12 (list-projection helper).
- `test/graylog-client.test.js` — stub for FOUND-02 + D-07 client-side (axios HTTP client).
- `test/normalize.test.js` — stub for FOUND-08 (response normalizer `{ id, body }`).
- `test/idempotency.test.js` — stub for FOUND-10 deeper coverage (auto-generated idempotency keys).
- `test/connection.test.js` — stub for FOUND-09 + D-07 wrapper-side (per-call connectionName).
- `test/schema-parity.test.js` — stub for Pitfall 3 (zod ↔ JSON-Schema drift detection; starts as a passing empty allowlist).
- `test/auth-redaction.test.js` — stub for Pitfall 6 (no auth tokens leak into snapshots; passes when no snapshots exist).
- `test/regression/read-tools.test.js` — stub for Pitfall 1 (pre/post dispatch regression net; fixtures land in Plan 05).

## Decisions Made

- **Stayed strict on D-06** (snapshot directory under `test/__snapshots__/`): chose `setResolveSnapshotPath` with mkdir-recursive over node:test's default sibling-file `.snapshot` location, so the test tree stays readable.
- **Quote the glob in `scripts.test`** instead of leaving it bare (`node --test test/**/*.test.js` → `node --test 'test/**/*.test.js'`): bash 5 without `shopt -s globstar` matches only a single path and silently breaks the test runner. Quoting hands the literal pattern to Node 22, which expands it correctly. Functionally equivalent to the plan's stated value; mechanically necessary for the verification to pass.
- **`@types/node` bumped to ^22.0.0** rather than left at ^20 — keeps DTs aligned with the engine floor so IDE type-checking matches runtime.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Quote the test glob in `scripts.test`**
- **Found during:** Task 2 (npm test verification)
- **Issue:** The plan locked `scripts.test` to the bare string `node --test test/**/*.test.js`. Inside npm's shell invocation, bash expands `test/**/*.test.js` before Node sees it. With `globstar` off (the default in non-interactive shells), bash matches only the deepest single path — `test/regression/read-tools.test.js` — and only one stub test runs. `npm test` exits 0 but the plan's acceptance criterion ("npm test output contains [N] lines of the form `ok N - <NAME>: scaffold passes`") fails: only 1 line is produced.
- **Fix:** Wrapped the glob in single quotes: `"test": "node --test 'test/**/*.test.js'"`. Node 22 handles the glob itself and discovers all 10 stub files.
- **Files modified:** `package.json`
- **Verification:** `npm test` now exits 0 with 10 `ok` lines (one per stub). All other plan acceptance criteria for Task 1 still hold (`engines.node`, `@types/node`, no new top-level keys).
- **Committed in:** `10635a0` (folded into Task 2's commit because Task 1's commit had already shipped the unquoted form).

**2. [Plan typo, not a code deviation] Expected stub count is 10, not 11**
- **Found during:** Task 2 verification.
- **Issue:** The plan's acceptance criterion under Task 2 says "11 lines of the form `ok N - <NAME>: scaffold passes` (one per stub file)". The plan's own `<files>` enumeration lists 10 stub files (9 top-level + 1 regression). Counting the actual stubs created (`dispatch`, `handler`, `list`, `graylog-client`, `normalize`, `idempotency`, `connection`, `schema-parity`, `auth-redaction`, `regression/read-tools`) gives 10.
- **Fix:** No code change — `npm test` correctly produces 10 `ok` lines, matching the plan's file enumeration. The "11" in the acceptance criterion text is a plan typo. The plan's verification command (`npm test 2>&1 | tail -30`) and success criterion #2 ("`test/__snapshots__/.gitkeep`, `test/snapshot-config.js`, and 10 stub test files exist") both agree on 10.
- **Verification:** Confirmed via `npm test 2>&1 | grep -c 'ok [0-9]* - .*scaffold passes'` → 10.

---

**Total deviations:** 1 auto-fixed Rule-1 bug (broken glob) + 1 documented plan typo (11 vs 10).
**Impact on plan:** The Rule-1 fix is mandatory — without it `npm test` fails the plan's own verification. The plan typo required no code change. No scope creep; src/ untouched; the 4 root `test-*.js` scripts left in place for Plan 02.

## Issues Encountered

- None beyond the deviation above.

## User Setup Required

None — no external service or secret configuration required.

## TDD Gate Compliance

This plan was not a TDD plan (`type: execute`, `tdd="false"` on both tasks). The `test(...)` commit on Task 2 happens to use the `test` conventional-commit type because the work is test infrastructure, not because of TDD RED/GREEN sequencing.

## Next Phase Readiness

- `npm test` is green. Every subsequent Phase 0 plan (00-02 through 00-06) can now declare `<automated>` verifications.
- `test/__snapshots__/` is initialized; later plans can drop fixtures in via `t.assert.snapshot(...)` without further harness work.
- `test/regression/read-tools.test.js` is the designated landing pad for the pre/post dispatch regression net in Plan 05 (Pitfall 1).
- Root-level legacy scripts (`test-aggregation-fixes.js`, `test-clustering.js`, `test-features.js`, `test-histogram-fixes.js`) are deliberately untouched — Plan 02 owns their migration into `test/existing/` and their deletion.
- `src/` is untouched. No production behavior changes. No dependencies added or upgraded except `@types/node` devDep.

## Self-Check: PASSED

- All 12 created files present on disk (`test/snapshot-config.js`, `.gitkeep`, 10 stubs).
- `package.json` modified file present.
- Both task commits resolvable in git history (`2639926`, `10635a0`).
- `npm test` exits 0 with 10 passing scaffold `ok` lines.

---
*Phase: 00-foundation*
*Plan: 01*
*Completed: 2026-05-13*
