---
phase: 07-final-hardening
plan: 02
subsystem: meta-tooling
tags: [meta-tool, discoverability, coverage, c8, pitfall-m7, agent-context]

requires:
  - phase: 00-foundation
    provides: src/dispatch.js Map-based dispatch + register() API (FOUND-01)
  - phase: 00-foundation
    provides: src/tools.js single-source-of-truth toolDefinitions (FOUND-02)
  - phase: 07-final-hardening
    plan: 01
    provides: every existing tool description ≤200 chars with discrimination sentence — Plan 02's summarize() truncation to 120 chars is now a strict subset of the audited input
provides:
  - src/tools/meta/list-admin-tools.js — pure-static meta-tool handler returning a domain-grouped inventory of all 91 tools (no Graylog connection required)
  - src/tools/meta/index.js — meta-domain barrel registering list_admin_tools against dispatch
  - test/list-admin-tools.test.js — 6 contract tests pinning the no-args/domain-filter/unknown-domain/coverage/summary-length/no-connection-required behaviors
  - npm run coverage — c8-driven coverage script with text + lcov + text-summary reporters (HARD-04 baseline)
  - 4 coverage baseline numbers (Statements/Branches/Functions/Lines) ready for MILESTONE-SUMMARY aggregation in Plan 07-03
affects: [07-03-milestone-summary, future-plan-meta-tool-extensions, future-coverage-tracking]

tech-stack:
  added:
    - c8@^10.1.3 (devDependency) — V8-based coverage, no source instrumentation, the ONLY new npm dep this milestone per CONTEXT D-09
  patterns:
    - "Meta-domain pattern — src/tools/meta/ houses pure-static tools that work BEFORE set_active_connection. New meta tools must preserve the no-connection-required property so the agent can call them at session start."
    - "Domain inference via DOMAIN_OVERRIDES (full-name) + DOMAIN_FROM_SEGMENT (segment-fallback, singular+plural both keyed) — the 'zero-uncategorized' invariant is enforced by a regression test."
    - "Coverage baseline pattern — text-summary reporter prints 4 numbers (Statements/Branches/Functions/Lines) for milestone aggregation; lcov.info gitignored to avoid binary-diff churn."

key-files:
  created:
    - src/tools/meta/list-admin-tools.js
    - src/tools/meta/index.js
    - test/list-admin-tools.test.js
  modified:
    - src/tools.js
    - src/tools/_register.js
    - test/pipelines.test.js
    - test/dashboards.test.js
    - test/schema-parity.test.js
    - package.json
    - package-lock.json

key-decisions:
  - "Plan-suggested DOMAIN_FROM_SEGMENT map had create_app_health_dashboard keyed as if it were a segment (it isn't — name splits to [create, app, health, dashboard]). Moved to DOMAIN_OVERRIDES; added cycle_deflector, setup_*, connect/disconnect_pipelines_*, and v2.3 search/notification names to the override map so the segment-fallback never reaches them."
  - "DOMAIN_FROM_SEGMENT keys are stored BOTH singular AND plural (stream/streams, pipeline/pipelines, input/inputs, etc.) because the project convention permits either form (list_streams vs list_stream_rules). Plan-suggested singular-only map left 5 tools as 'uncategorized'."
  - "summarize() takes the first sentence (regex `^[^.!?]+[.!?]`) or first 120 chars, whichever is shorter — 120-char cap is well under the audited 200-char description budget so summaries never lose discrimination phrases."
  - "Tests pin the count = 91 (90 baseline + list_admin_tools) directly via assert.equal — no soft '≥ 90' assertion. Future tool additions in a follow-up milestone require explicit bump in pipelines.test.js + dashboards.test.js (intentional friction)."
  - "schema-parity for the zod-less meta-tool: added a separate test pinning the JSON-Schema shape directly (properties = ['domain']; required absent). assertSchemaParityForTool helper not applicable because there's no zod schema to compare against."

patterns-established:
  - "Meta-tool inventory: pure-static walker over toolDefinitions returning {tool, count, domains:{...}, items:[...], domain_keys:[...]} — the agent gets one round-trip orientation vs paying for the full /tools list every session."
  - "Coverage script naming: `coverage` (not `test:coverage`) — short keystroke, aligns with the existing `audit:tool-descriptions` script pattern (one-line PR check)."

requirements-completed:
  - HARD-02
  - HARD-04

duration: 7.4min
completed: 2026-05-16
---

# Phase 7 Plan 2: list_admin_tools Meta-Tool + c8 Coverage Baseline Summary

**HARD-02 ships `list_admin_tools` as a pure-static meta-tool returning a 91-tool inventory grouped across 9 domains (Pitfall M7 mitigation #3 — agent orients without dumping all descriptions). HARD-04 lands c8 as the only new npm dep this milestone with `npm run coverage` producing a 92.53% lines / 79.74% branches baseline for MILESTONE-SUMMARY aggregation.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-16T04:14:36Z
- **Completed:** 2026-05-16T04:22:02Z
- **Tasks:** 2 (Task 1 = TDD with separate RED/GREEN commits)
- **Files modified:** 10 (3 created, 7 modified)

## Accomplishments

- `src/tools/meta/list-admin-tools.js` — pure-static meta-tool: walks `toolDefinitions` once, classifies each tool into one of 9 domains via DOMAIN_OVERRIDES (full-name) + DOMAIN_FROM_SEGMENT (segment-fallback with singular AND plural keys). Returns `{tool, count, domains:{...}, items:[...], domain_keys:[...]}` for no-args calls; returns `{domain, items, count}` for filtered calls; returns `{warning:"domain_not_found", available_domains:[...]}` for unknown domains. No Graylog connection required — the agent can call this BEFORE `set_active_connection`.
- `src/tools/meta/index.js` — barrel that side-effect-registers `list_admin_tools` against `src/dispatch.js`.
- `src/tools/_register.js` — wires the meta barrel after the blueprints barrel.
- `src/tools.js` — `list_admin_tools` JSON-Schema entry. Description is 197 chars (≤200 budget) with the discrimination phrase "Use this vs. dumping the full /tools list", satisfying the HARD-01 audit. Tool count 90 → 91 — the +1 net-new tool for Phase 7 per CONTEXT D-12.
- `test/list-admin-tools.test.js` — 6 contract tests (RED then GREEN): no-args returns 91 tools across the 9 known domains with no "uncategorized" fallthrough; domain="streams" returns exactly 12 streams-domain tools; unknown domain returns a sorted `available_domains` + warning; inventory covers `src/tools.js` bidirectionally; each `item.summary` is non-empty and ≤120 chars; works with NO active connection.
- `test/schema-parity.test.js` — new parity test pins the JSON-Schema shape for the zod-less meta-tool (properties = `["domain"]`, no `required`).
- `test/pipelines.test.js` + `test/dashboards.test.js` — count assertions bumped 90 → 91.
- `package.json` — c8@^10.1.3 added as devDep; `coverage` script added.
- `package-lock.json` — lockfile sync after c8 install.
- Test suite: 1055 → 1062 (6 new list_admin_tools tests + 1 new schema-parity test); all green.
- Audit: `node scripts/audit-tool-descriptions.js` exits 0 against all 91 descriptions.

### Coverage Baseline (HARD-04)

Captured verbatim from `npm run coverage` text-summary block (run against 1062 tests, post-list_admin_tools):

```
=============================== Coverage summary ===============================
Statements   : 92.53% ( 16354/17674 )
Branches     : 79.74% ( 1524/1911 )
Functions    : 86.9% ( 385/443 )
Lines        : 92.53% ( 16354/17674 )
================================================================================
```

These four numbers go into `.planning/MILESTONE-SUMMARY.md` (Plan 07-03 aggregation). No coverage threshold gate is being set this milestone — the baseline is informational per CONTEXT D-08.

`coverage/lcov.info` produced at 213,297 bytes (gitignored — `coverage/` and `*.lcov` were already in `.gitignore` from a prior phase, so no `.gitignore` churn).

## Task Commits

1. **Task 1 (RED): list_admin_tools failing tests** — `6ce18e5` (test)
2. **Task 1 (GREEN): list_admin_tools meta-tool + register + count bumps** — `d87a9f9` (feat)
3. **Task 2: c8 coverage tooling** — `223c3bc` (build)

## Files Created/Modified

- `src/tools/meta/list-admin-tools.js` — 145-line handler exporting `listAdminToolsHandler`. Two static lookup tables (DOMAIN_OVERRIDES, DOMAIN_FROM_SEGMENT) drive `inferDomain(name)`; `summarize(description)` truncates to ≤120 chars via first-sentence-or-byte-slice. No network I/O.
- `src/tools/meta/index.js` — 12-line barrel side-effect-registering `list_admin_tools` against dispatch.
- `src/tools/_register.js` — added 4-line import of `./meta/index.js` after the blueprints barrel.
- `src/tools.js` — appended one toolDefinitions entry (12 lines including schema).
- `test/list-admin-tools.test.js` — 143-line contract suite with 6 tests, full setup/teardown of the connections module to assert pure-static behavior.
- `test/schema-parity.test.js` — appended 1 new test for the zod-less meta-tool.
- `test/pipelines.test.js` — count assertion (1 line) bumped 90 → 91 + comment update.
- `test/dashboards.test.js` — count assertion (1 line) bumped 90 → 91 + comment update.
- `package.json` — added c8 to devDependencies + `coverage` script.
- `package-lock.json` — c8 + transitive deps (1014-line diff; expected lockfile churn after npm install).

## Decisions Made

- **DOMAIN_OVERRIDES expanded from plan-suggested 22 entries to ~25**: added `cycle_deflector`, the 5 `setup_*` blueprints, `create_app_health_dashboard`, and `connect_pipelines_to_stream`/`disconnect_pipelines_from_stream`. Plan-suggested map mis-keyed `create_app_health_dashboard` as a segment (it's a full tool name) and would have routed `cycle_deflector` to "uncategorized" and the connect/disconnect pair to "streams" (less accurate — their primary domain is pipeline-stream wiring, which lives in pipelines).
- **DOMAIN_FROM_SEGMENT contains BOTH singular and plural keys**: `stream`/`streams`, `pipeline`/`pipelines`, `input`/`inputs`, `extractor`/`extractors`, `notification`/`notifications`, `dashboard`/`dashboards`, `widget`/`widgets`. Plan-suggested map was singular-only and would have routed `list_streams`, `list_inputs`, `list_pipelines`, `list_dashboards`, `list_extractors` to "uncategorized" (5 tools).
- **Test pins count = 91 directly**: future tool additions require an explicit count bump in pipelines.test.js + dashboards.test.js (and add a new entry to DOMAIN_OVERRIDES / DOMAIN_FROM_SEGMENT). This is intentional friction — a silent count drift would silently regress tool selection in agent contexts.
- **Coverage script name = `coverage` (not `test:coverage`)**: aligns with the project's existing `audit:tool-descriptions` short-keystroke pattern.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] DOMAIN_FROM_SEGMENT map had `create_app_health_dashboard` as a segment key**
- **Found during:** Task 1 GREEN (initial implementation pass)
- **Issue:** Plan-suggested `DOMAIN_FROM_SEGMENT = { ..., create_app_health_dashboard: "blueprints", ... }` — but segment-matching splits on `_` so `create_app_health_dashboard.split("_")` is `["create","app","health","dashboard"]`. No segment equals the full tool name, so the override was unreachable. `dashboard` segment would route to "dashboards" instead of the intended "blueprints".
- **Fix:** Moved `create_app_health_dashboard: "blueprints"` to `DOMAIN_OVERRIDES` (full-name match takes precedence over segment fallback). Also added the 5 `setup_*` tools to the same map for the same routing-precedence reason.
- **Files modified:** src/tools/meta/list-admin-tools.js
- **Verification:** Re-ran `node --test test/list-admin-tools.test.js` — "no uncategorized fallthrough" assertion passes.
- **Committed in:** d87a9f9 (Task 1 GREEN commit)

**2. [Rule 3 - Blocking] `cycle_deflector` had no domain-named segment**
- **Found during:** Task 1 GREEN (running tests after first pass)
- **Issue:** `cycle_deflector.split("_") = ["cycle","deflector"]`. Neither segment is in DOMAIN_FROM_SEGMENT, so it routed to "uncategorized", failing the "no uncategorized fallthrough" assertion.
- **Fix:** Added `cycle_deflector: "index_sets"` to DOMAIN_OVERRIDES (deflector cycling is an index-set operation).
- **Files modified:** src/tools/meta/list-admin-tools.js
- **Verification:** Same test run as above; uncategorized count went from 5 → 0.
- **Committed in:** d87a9f9 (Task 1 GREEN commit)

**3. [Rule 1 - Bug] DOMAIN_FROM_SEGMENT missed plural segment forms**
- **Found during:** Task 1 GREEN (first test run after Fix 1 + Fix 2)
- **Issue:** With singular-only segment keys, `list_streams`, `list_inputs`, `list_pipelines`, `list_dashboards`, `list_extractors` all routed to "uncategorized" because their segments are `["list","streams"]` etc. (no exact match for the plural).
- **Fix:** Added plural keys to DOMAIN_FROM_SEGMENT for every domain (inputs, extractors, streams, pipelines, notifications, dashboards, widgets). Index_sets and events did not need plurals because the singular key was already plural enough (`index`, `event`).
- **Files modified:** src/tools/meta/list-admin-tools.js
- **Verification:** "no uncategorized fallthrough" assertion AND "domain=streams returns exactly 12 tools" assertion both pass after this fix.
- **Committed in:** d87a9f9 (Task 1 GREEN commit)

**4. [Rule 2 - Critical] connect/disconnect_pipelines_to_stream classified as "streams"**
- **Found during:** Task 1 GREEN (streams-domain count was 13 instead of 12 after Fix 3)
- **Issue:** Plurals fix routed `connect_pipelines_to_stream` and `disconnect_pipelines_from_stream` to "streams" via the `stream` segment (last match). Their primary domain is pipeline-stream wiring — they live in src/tools/pipelines/, not src/tools/streams/. Misclassification would mislead agent tool selection ("I need to wire a pipeline to a stream → look in streams?" wrong; the operation belongs under pipelines).
- **Fix:** Added explicit overrides: `connect_pipelines_to_stream: "pipelines"` and `disconnect_pipelines_from_stream: "pipelines"` in DOMAIN_OVERRIDES.
- **Files modified:** src/tools/meta/list-admin-tools.js
- **Verification:** "domain=streams returns exactly 12 tools" assertion passes; streams roster matches the plan's expected list verbatim.
- **Committed in:** d87a9f9 (Task 1 GREEN commit)

---

**Total deviations:** 4 auto-fixed (3 blocking, 1 critical-classification)
**Impact on plan:** All 4 fixes target the same artifact (the domain-inference maps) and the same regression-test assertion ("no uncategorized fallthrough"). The plan's <action> code was directionally correct but the map contents needed adjustment to actually cover all 90 tools. Net scope is unchanged.

## Issues Encountered

- None beyond the deviations above. The TDD cycle worked exactly as intended: RED commit (6 fails: "Tool not found: list_admin_tools") → first GREEN attempt failed 2 of 6 tests (streams count = 13, uncategorized fallthrough = 5 tools) → iterative DOMAIN map fixes → all 6 GREEN.
- `npm audit` reports 7 vulnerabilities (4 moderate, 3 high) after c8 install — these are transitive deps of c8's coverage tooling chain and are devDependencies only (no runtime impact). Not addressed this plan per scope discipline; can be revisited in a future milestone if c8 v11+ resolves them.

## User Setup Required

None — no external service configuration required. The c8 install + coverage script are dev-only; the meta-tool is pure-static.

## Next Phase Readiness

- **Plan 07-03 (HARD-03 read-tool smoke + MILESTONE-SUMMARY.md aggregation) is unblocked.** The 4 coverage numbers above go verbatim into MILESTONE-SUMMARY.md. The list_admin_tools meta-tool surfaces the final 91-tool count for the milestone summary.
- **`npm run coverage` is a permanent project capability** — future PRs can spot-check coverage on changed files via the lcov report. No CI gate added per CONTEXT D-08 (informational baseline only).
- **DOMAIN_OVERRIDES + DOMAIN_FROM_SEGMENT are the canonical classification source** for any future meta-tool extensions (e.g. `list_tools_by_safety` would walk the same toolDefinitions array and could re-use the inferDomain logic).
- **No new runtime dependencies were added** — the only new dep is c8 (devDependency). Production package remains at @modelcontextprotocol/sdk + axios + zod.

## Threat Flags

None — the meta-tool surface is read-only over an in-process static array, no new network endpoint, no new auth path, no new schema at a trust boundary. c8 wraps the test process only and has no effect on runtime behavior.

## Self-Check: PASSED

- src/tools/meta/list-admin-tools.js: FOUND
- src/tools/meta/index.js: FOUND
- test/list-admin-tools.test.js: FOUND
- coverage/lcov.info: FOUND (213,297 bytes)
- Task 1 RED commit 6ce18e5: FOUND
- Task 1 GREEN commit d87a9f9: FOUND
- Task 2 commit 223c3bc: FOUND
- Tool count in src/tools.js: 91 (90 → 91)
- Audit script exit: 0 (all 91 descriptions pass)
- src/graylog/errors.js NOT in modified files: PASS
- npm test: 1062/1062 pass (1055 baseline + 6 list_admin_tools + 1 schema-parity)
- npm run coverage: exits 0 with text-summary block printed

---
*Phase: 07-final-hardening*
*Completed: 2026-05-16*
