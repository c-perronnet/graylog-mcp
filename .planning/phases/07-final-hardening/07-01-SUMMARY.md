---
phase: 07-final-hardening
plan: 01
subsystem: testing
tags: [audit, regression-gate, tool-descriptions, mcp, agent-context]

requires:
  - phase: 00-foundation
    provides: node:test infrastructure + npm test runner (FOUND-06/07)
  - phase: 01-inputs-extractors
    provides: per-domain tool definitions in src/tools.js (INPUT-01..11)
  - phase: 02-index-sets-retention
    provides: index-set tool definitions in src/tools.js (INDEX-01..07)
  - phase: 03-streams-stream-rules
    provides: stream tool definitions in src/tools.js (STREAM-01..10)
  - phase: 04-pipelines-pipeline-rules-connections
    provides: pipeline tool definitions in src/tools.js (PIPE-01..14)
  - phase: 05-events-notifications
    provides: event/notification tool definitions in src/tools.js (EVENT-01..09)
  - phase: 06-dashboards-widgets-blueprints
    provides: dashboard + blueprint tool definitions in src/tools.js (DASH-01..08, BLUE-01..06)
provides:
  - scripts/audit-tool-descriptions.js — static auditor over toolDefinitions, exports audit() pure function, CLI exits 0/1/2
  - npm run audit:tool-descriptions — one-liner PR check
  - test/tool-description-audit.test.js — 10 regression-gate tests on node:test
  - src/tools.js — every description <=200 chars with discrimination sentence (79 violations fixed wholesale)
affects: [HARD-02-list-admin-tools, future-tool-additions, PR-review-gate]

tech-stack:
  added: []
  patterns:
    - "Static auditor pattern — pure import of toolDefinitions, no Graylog connection, no network, deterministic exit code"
    - "Discrimination-sentence convention — every description either spans 2 sentences OR contains a comparative keyword (vs.|rather than|instead of|use this when|unlike|as opposed to|contrast with|distinct from|prefer this when)"
    - "Description budget pinned in code (DESCRIPTION_BUDGET = 200) with regression-gate test against the real src/tools.js"

key-files:
  created:
    - scripts/audit-tool-descriptions.js
    - test/tool-description-audit.test.js
  modified:
    - src/tools.js
    - package.json
    - .gitignore

key-decisions:
  - "DESCRIPTION_BUDGET = 200 chars hard-coded in scripts/audit-tool-descriptions.js (single source of truth for the budget; test imports it transitively via audit())"
  - "Comparative-phrase regex is a flat case-insensitive alternation with word-boundary anchors (no catastrophic backtracking risk); multi-sentence (>=2 sentence-terminators) is an alternative path so single-sentence comparative descriptions also pass"
  - "Wholesale-rewrite preserves only safety-critical primitives: dryRun default, confirmation token requirement, encrypted-field protection, inverted defaults — internal mitigation IDs (C1/C3/D-04/T-XX/M5/Pitfall etc.) stripped because they belong in PLAN.md not agent context"
  - ".gitignore narrowed: scripts/* + !scripts/audit-tool-descriptions.js (was scripts/ blanket-ignore) — minimal exposure for the one checked-in script without unmasking ad-hoc local scripts"

patterns-established:
  - "Audit-script + regression-gate pair: pure-static walker exports audit() for tests, CLI for one-liner PR checks, npm script binding for repo-root invocation"
  - "Compact tool description form: <verb-phrase>. <safety-clause>. <comparative-clause>. — average ~180 chars, never exceeds 200"

requirements-completed:
  - HARD-01

duration: ~19min
completed: 2026-05-16
---

# Phase 7 Plan 1: Tool-Description Audit + Wholesale Description-Fix Pass Summary

**Static audit script `scripts/audit-tool-descriptions.js` + node:test regression gate + wholesale rewrite of 79 over-budget tool descriptions in `src/tools.js` — every tool description now <=200 chars with a discrimination sentence, agent tool-selection accuracy preserved via Pitfall M7 compliance.**

## Performance

- **Duration:** ~19 min
- **Started:** 2026-05-16T03:49:57Z
- **Completed:** 2026-05-16T04:09:00Z (approx)
- **Tasks:** 2
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments

- `scripts/audit-tool-descriptions.js` — pure-static auditor with exported `audit(toolDefinitions)` returning a flat violations array (`{name, rule: "empty"|"length"|"discrimination", ...ctx}`); CLI exits 0 (clean), 1 (violations), 2 (load failure); SRC_TOOLS_PATH env var supports tmpdir-fixture testing.
- `test/tool-description-audit.test.js` — 10 node:test cases pin: (a) audit() classifies good/bad fixtures correctly, (b) the real `src/tools.js` returns zero violations (regression gate against any future PR adding an over-budget or non-discriminating description), (c) the CLI exit code matches violations on tampered + compliant fixtures.
- `package.json` — `audit:tool-descriptions` npm script wired as the one-liner PR check.
- `src/tools.js` — every one of the 90 tool descriptions now <=200 chars with a discrimination sentence (multi-sentence or comparative keyword). 79 descriptions rewritten; safety-critical primitives (dry-run default, confirmation tokens, encrypted-field protection, inverted defaults) preserved in compressed form.
- Test suite expanded from 1045 baseline to 1055 (10 new audit tests, all green); no regression in the prior 1045 tests.

## Task Commits

1. **Task 1: Audit script + node:test regression gate (TDD)** — `f7ac88c` (test)
2. **Task 2: Wholesale-rewrite all over-budget descriptions** — `4bb0323` (fix)

## Files Created/Modified

- `scripts/audit-tool-descriptions.js` — 116-line static auditor: exports `audit()`, `DESCRIPTION_BUDGET`, `COMPARATIVE_PHRASES`, `SENTENCE_SPLIT`; CLI mode honors SRC_TOOLS_PATH for test isolation; emits per-violation error lines with `rule`-typed context.
- `test/tool-description-audit.test.js` — 10 tests covering the 8 behaviors listed in the plan plus 2 CLI smoke tests (tampered fixture → exit 1, compliant fixture → exit 0).
- `src/tools.js` — 78 description rewrites; 1 description left unchanged (`get_index_set` had both length and discrimination flags but the discrimination rewrite incidentally satisfied the length budget too). Tool name dispatch (src/tools/_register.js) untouched per plan.
- `package.json` — added `"audit:tool-descriptions": "node scripts/audit-tool-descriptions.js"` to `scripts`.
- `.gitignore` — narrowed `scripts/` blanket ignore to `scripts/* + !scripts/audit-tool-descriptions.js` so the checked-in audit script is committable while ad-hoc local scripts under `scripts/` remain ignored.

## Decisions Made

- **Comparative-keyword set:** `vs.`, `rather than`, `instead of`, `use this when`, `use this vs`, `use this rather`, `contrast with`/`contrasted with`, `unlike`, `as opposed to`, `prefers this when`/`prefer this when`, `distinct from`. Word-boundary-anchored and case-insensitive. A description with at least 2 sentence-terminators (.!?) also passes without requiring a comparative keyword. This dual path keeps short single-sentence "List X. Use this vs. Y." compliant.
- **Budget = 200 chars** is hard-coded in `DESCRIPTION_BUDGET` and surfaced via the regression test — changing it requires a code edit + a test update, which is the desired friction.
- **Description content preservation rubric:** keep dry-run default, confirmation token requirement, encrypted-field protection, inverted defaults; drop internal mitigation IDs (C1/C3/D-04/T-XX/M5/Pitfall N/ND2 etc.), HTTP-level wire minutiae, test-IDs (T-XX-YY-ZZ), plan numbers. Spot-checks confirmed: `delete_index_set` retains `deleteIndices:false` + `confirm`; `update_input` and `update_event_notification` retain encrypted-field language; `create_event_definition` retains `schedule:false` + `enable_event_definition` reference; all 3 cascade-hash deletes (`delete_stream`, `delete_event_notification`, `delete_pipeline_rule`) retain confirm-token language.
- **Audit script lives at `scripts/`** (per Discretion-01 in 07-CONTEXT.md). Did NOT relocate to `tools/` or `bin/` to keep the directory's purpose clear.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `.gitignore` blanket-ignored `scripts/`**
- **Found during:** Task 1 (first `git add scripts/audit-tool-descriptions.js`)
- **Issue:** `scripts/` was in `.gitignore` (likely for ad-hoc local scripts). The plan creates a checked-in `scripts/audit-tool-descriptions.js`, so `git add` failed with "paths are ignored".
- **Fix:** Narrowed the ignore to `scripts/*` with a `!scripts/audit-tool-descriptions.js` un-ignore exception. Preserves the original intent (local scratch scripts stay ignored) while allowing the one checked-in audit script.
- **Files modified:** `.gitignore`
- **Verification:** `git add scripts/audit-tool-descriptions.js` succeeds; `git status` shows the new file as Added; later `npm run audit:tool-descriptions` still resolves.
- **Committed in:** `f7ac88c` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Single-line .gitignore narrowing; no scope creep. The plan's success criteria are all met.

## Issues Encountered

- The first wholesale-rewrite pass left ~24 descriptions slightly over budget (200-260 chars). Each tool was iteratively trimmed in a second pass until the audit reported 0 violations. Time cost: ~5 extra min of trimming; no decisions changed. The iterative `node scripts/audit-tool-descriptions.js → re-read violations → trim batch → re-run` loop the plan describes worked exactly as intended.

## User Setup Required

None — no external service configuration required. This is a pure documentation/quality-gate change.

## Next Phase Readiness

- **Plan 07-02 (HARD-02 `list_admin_tools` meta-tool) is unblocked.** The meta-tool surfaces `[{name, description, domain}]` from `toolDefinitions`; every description is now <=200 chars and has a discrimination sentence, so the meta-tool's output budget is predictable (≤200 chars per entry × ~90 tools = ≤18 KB worst case).
- **`npm test` now includes the audit regression gate** — any future PR that adds an over-budget description or one missing a discrimination sentence will fail `npm test` immediately. This closes ROADMAP SC1 (audit-driven merge gate) for HARD-01.
- **No new dependencies** — the audit script uses node:url, node:path, node:fs (CLI test only); pure standard library.

## Self-Check: PASSED

- scripts/audit-tool-descriptions.js: FOUND
- test/tool-description-audit.test.js: FOUND
- src/tools.js (modified): FOUND
- package.json (modified): FOUND
- .gitignore (modified): FOUND
- Task 1 commit f7ac88c: FOUND
- Task 2 commit 4bb0323: FOUND
- audit CLI exit code: 0 (all 90 tool descriptions pass)
- node --test test/tool-description-audit.test.js: 10/10 pass
- npm test: 1055/1055 pass (no regression vs 1045 baseline + 10 new audit tests)

---
*Phase: 07-final-hardening*
*Completed: 2026-05-16*
