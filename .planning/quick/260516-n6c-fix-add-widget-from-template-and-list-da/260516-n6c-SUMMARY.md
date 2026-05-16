---
phase: quick-260516-n6c
plan: 01
subsystem: dashboards
tags: [bugfix, dashboards, widget-templates]
requires: []
provides:
  - "list_dashboards request path without query=type:DASHBOARD (BUG-9)"
  - "error-rate-over-time template honors options.queryString (BUG-8a)"
  - "add_widget_from_template auto-places widget below existing widgets (BUG-8b)"
affects:
  - src/tools/dashboards/list-dashboards.js
  - src/widget-templates/error-rate-over-time.js
  - src/tools/dashboards/add-widget-from-template.js
tech-stack:
  added: []
  patterns: ["TDD RED/GREEN for the two behavior-adding fixes"]
key-files:
  created: []
  modified:
    - src/tools/dashboards/list-dashboards.js
    - src/widget-templates/error-rate-over-time.js
    - src/tools/dashboards/add-widget-from-template.js
    - test/dashboards.test.js
    - test/widget-templates.test.js
    - test/snapshots/__snapshots__/dashboards.test.js.snapshot
decisions:
  - "Regenerated the add_widget snapshot — the row:1 → row:3 change is the intended auto-placement fix, not a weakened assertion"
metrics:
  duration: ~12m
  completed: 2026-05-16
requirements: [BUG-9, BUG-8a, BUG-8b]
---

# Phase quick-260516-n6c Plan 01: Fix add_widget_from_template and list_dashboards bugs Summary

Three confirmed live Graylog 7.x dashboard bugs fixed: list_dashboards now omits the
free-text `query=type:DASHBOARD` segment that always returned 0; the error-rate-over-time
widget template AND-combines a caller-supplied `options.queryString`; and
add_widget_from_template auto-places a new widget below existing ones instead of
overlapping at col:1,row:1.

## What Was Built

**BUG #9 — list_dashboards request path (Task 1)**
`src/tools/dashboards/list-dashboards.js` no longer sends `query=type:DASHBOARD`.
Graylog 7.x treats `/api/views`'s `query` parameter as free-text over the view
title/summary, so the literal `type:DASHBOARD` text matched nothing and returned
`total:0`. The wrapper-side `items.filter(v => v?.type === "DASHBOARD")` remains as the
real DASHBOARD-type filter. Path is now `/api/views?page=1&per_page=<limit>&sort=title&order=asc`.
Stale comments on the `?query=` clause were corrected. Test 3 in `test/dashboards.test.js`
was inverted to assert no `query=` segment.

**BUG #8a — error-rate-over-time honors options.queryString (Task 2, TDD)**
`src/widget-templates/error-rate-over-time.js` previously hardcoded
`const queryString = "level:>=4"` and never read `options.queryString`. It now reads
`options.queryString` and emits `(level:>=4) AND (<userQuery>)` when present, or exactly
`level:>=4` when absent/empty (no `() AND ()` wrapping). The computed string applies to
both `widget.query.query_string` and `searchType.query.query_string` via the shared
variable. Three regression tests added to `test/widget-templates.test.js`.

**BUG #8b — add_widget_from_template auto-placement (Task 3, TDD)**
`src/tools/dashboards/add-widget-from-template.js` now computes a `placedPosition`:
when `args.options?.position` is absent, the next free row is `max(row + height)` over
all existing positions (defaulting to 1 on an empty dashboard), and the widget is
anchored at col 1 with the builder's height/width preserved. `triplet` is
`Object.freeze`'d, so a local `placedPosition` is used at the `newPositions` assignment
rather than mutating `triplet.position`. When `options.position` IS supplied, the
builder's value passes through verbatim. Three regression tests added to
`test/dashboards.test.js` (DASH-06 section).

## Deviations from Plan

### Auto-fixed Issues

None requiring deviation rules. One planned-for action executed per the plan's
verification guidance:

**Snapshot regeneration (planned in verification block)**
- **Found during:** Task 3 — full `npm test` reported a snapshot mismatch in
  `test/snapshots/dashboards.test.js` F7.
- **Reason:** The F7 snapshot fixture has an existing widget at `{row:1,height:2}`, so
  the auto-placed widget correctly moved from the old overlapping `row:1` to `row:3`.
- **Action:** Regenerated via `node --test --test-update-snapshots`. Verified the diff
  is exactly `row:1 → row:3` (×2 occurrences); `col:1,height:4,width:6` unchanged. No
  assertion weakened. Committed as a `test(...)` commit alongside Task 3.

## Test Results

Full suite: `npm test` → 1098 tests / 18 suites, all pass, 0 fail, 0 skipped.

## TDD Gate Compliance

Tasks 2 and 3 followed RED/GREEN:
- BUG #8a: `e6286c7` (test, RED) → `3fd676c` (fix, GREEN)
- BUG #8b: `cc57576` (test, RED) → `c29134a` (fix, GREEN) → `bf08812` (snapshot regen)

For BUG #8b the RED commit had one genuinely failing test (auto-placement); the
options.position-verbatim and empty-positions tests passed pre-fix because the builder
default `{col:1,row:1}` happened to coincide with their expected values — they still
provide regression coverage post-fix.

## Self-Check: PASSED

- src/tools/dashboards/list-dashboards.js — FOUND
- src/widget-templates/error-rate-over-time.js — FOUND
- src/tools/dashboards/add-widget-from-template.js — FOUND
- Commit 83e7342 — FOUND
- Commit e6286c7 — FOUND
- Commit 3fd676c — FOUND
- Commit cc57576 — FOUND
- Commit c29134a — FOUND
- Commit bf08812 — FOUND
