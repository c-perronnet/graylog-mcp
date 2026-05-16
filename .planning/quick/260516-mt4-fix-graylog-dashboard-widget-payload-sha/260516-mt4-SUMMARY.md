---
phase: quick-260516-mt4
plan: 01
subsystem: dashboards
tags: [bugfix, wire-shape, graylog-7.x, dashboards, widget-templates]
requires: []
provides:
  - "buildSearchDTO emits snake_case skip_no_streams_check"
  - "buildViewDTO omits the display_mode_settings view-state block"
  - "widget-payload-shapes.test.js regression suite pinning 5 corrected shapes"
affects:
  - src/services/dashboards.js
  - src/widget-templates/top-sources-by-volume.js
  - src/widget-templates/field-value-distribution.js
  - src/widget-templates/recent-events-table.js
  - src/widget-templates/error-rate-over-time.js
tech-stack:
  added: []
  patterns: ["node:test discrete-assertion regression tests", "node --test --test-update-snapshots fixture regeneration"]
key-files:
  created:
    - test/snapshots/widget-payload-shapes.test.js
  modified:
    - src/services/dashboards.js
    - src/widget-templates/top-sources-by-volume.js
    - src/widget-templates/field-value-distribution.js
    - src/widget-templates/recent-events-table.js
    - src/widget-templates/error-rate-over-time.js
    - test/snapshots/dashboards.test.js
    - test/services.test.js
    - test/widget-templates.test.js
    - test/snapshots/__snapshots__/widget-templates.test.js.snapshot
    - test/snapshots/__snapshots__/dashboards.test.js.snapshot
    - test/snapshots/__snapshots__/blueprints.test.js.snapshot
decisions:
  - "Updated two extra stale hand-written test expectations (services.test.js, widget-templates.test.js) not flagged in the plan — same stale-shape class, corrected to fixed wire form without weakening assertions (Rule 1)."
metrics:
  duration: ~6 min
  completed: 2026-05-16
  tasks: 2
  files: 11
---

# Quick Task 260516-mt4: Fix Graylog Dashboard Widget Payload Shapes Summary

Corrected 5 confirmed wire-shape bugs (MT4-BUG3..7) so POST /api/views/search then POST /api/views succeed against Graylog 7.x — restoring create_dashboard, create_app_health_dashboard, and add_widget_from_template.

## What Was Done

### Task 1 — Apply 5 payload-shape fixes (commit 332b777)

- **BUG4** — `src/services/dashboards.js` `buildSearchDTO`: key renamed `skipNoStreamsCheck` → `skip_no_streams_check` (value unchanged `false`).
- **BUG7** — `src/services/dashboards.js` `buildViewDTO`: deleted the entire `display_mode_settings` block from `state[queryId]`; updated the doc comment to note the block is intentionally omitted (Graylog 7.x rejects `positions_inferred`).
- **BUG3** — `top-sources-by-volume.js` and `field-value-distribution.js`: the `sortByCountDesc` const sort entry keyed `id` → `field` (`{ type: "series", field: "count()", direction: "Descending" }`). Series *definitions* (`series: [{ type:"count", id:"count()", field:null }]`) left untouched — `id` there is correct.
- **BUG5** — `recent-events-table.js`: widget `config.sort` (`widgetSort`) changed from `{ field, order: "DESC" }` to the SortConfigDTO discriminated shape `{ type: "pivot", field: "timestamp", direction: "Descending" }`. The messages `searchType.sort` (`searchTypeSort` = `{ field, order: "DESC" }`) left unchanged. Inline comment updated.
- **BUG6** — `error-rate-over-time.js` and `recent-events-table.js`: default `position.col` changed from `{ type: "infinity" }` to integer `1`.

### Task 2 — Regression tests + fixture refresh (commit 64800fa)

- Created `test/snapshots/widget-payload-shapes.test.js` — 5 discrete `node:test` regression tests covering behaviors (a)-(e): no `id` in any sort entry; `skip_no_streams_check` present / `skipNoStreamsCheck` absent; recent-events widget sort discriminated while search_type sort stays `{field,order}`; integer `position.col` for every builder; no `display_mode_settings` in the view-state.
- Updated stale hand-written expectations in `test/snapshots/dashboards.test.js` (removed `display_mode_settings` fixture block, `skipNoStreamsCheck` → `skip_no_streams_check` x2).
- Regenerated `widget-templates`, `dashboards`, `blueprints` snapshot fixtures via `node --test --test-update-snapshots`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated two additional stale hand-written test expectations**
- **Found during:** Task 2 (`npm test` run after snapshot regeneration)
- **Issue:** `test/services.test.js:203` (`buildViewDTO emits ... displayModeSettings`) and `test/widget-templates.test.js:109` (`recent_events_table ...`) hand-asserted the OLD `display_mode_settings` block and the OLD `{field,order}` widget sort shape — not listed in the plan's `<existing_test_shapes>` but the same stale-expectation class.
- **Fix:** Corrected both expected shapes to the fixed wire form (assert `display_mode_settings` absent; assert widget `config.sort` has `type`/`field`/`direction` and search_type sort keeps `field`/`order`). No assertion weakened — expectations only re-pinned to the corrected shape. Test names updated to reference MT4-BUG7 / MT4-BUG5.
- **Files modified:** test/services.test.js, test/widget-templates.test.js
- **Commit:** 64800fa

## Verification

- `npm test` — full suite green: 1092 pass, 0 fail.
- New `widget-payload-shapes.test.js` — 5/5 regression tests pass; re-introducing any bug fails a discrete test.
- `grep -rn 'skipNoStreamsCheck\|display_mode_settings' src/` — only the doc comment in `dashboards.js`; no live emission.
- `grep -rn 'type: *"infinity"' src/widget-templates/` — no matches.
- `recent-events-table.js` messages `searchType.sort` `{ field, order: "DESC" }` unchanged.
- Snapshot fixtures carry no `skipNoStreamsCheck`, `display_mode_settings`, or `infinity`-col remnants.

## Self-Check: PASSED

- FOUND: test/snapshots/widget-payload-shapes.test.js
- FOUND: commit 332b777
- FOUND: commit 64800fa
