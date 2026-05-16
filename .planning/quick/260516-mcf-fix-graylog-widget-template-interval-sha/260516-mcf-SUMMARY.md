---
quick_id: 260516-mcf
description: Fix Graylog widget-template interval shape bug
status: complete
date: 2026-05-16
commits:
  - 849f5a5
  - 6d9a863
---

# Quick Task 260516-mcf — Fix Graylog widget-template interval shape bug

## Problem

The three time-series widget-template builders in `src/widget-templates/` emitted the
pivot/widget time-bucket `interval` object as `{type:"timeunit", value:N, unit:U}`.
Graylog's `Interval` model does not recognise `value`/`unit` keys and rejects the
request with `Unable to map property value. Known properties include: timeunit, type`.
This broke `create_app_health_dashboard` and every time-series widget
(`error_rate_over_time`, `request_rate_over_time`, `stream_activity_overview`) at the
`create_search` step.

Discovered while creating a monitoring dashboard against a live Graylog 7.0.6 instance.

## Fix

Graylog's `Interval` model has two valid shapes — `{type:"auto"}` (optional `scaling`)
and `{type:"timeunit", timeunit:"<keyword>"}` (keyword like `"5m"`, `"1h"`). Both
verified live.

- `error-rate-over-time.js`, `request-rate-over-time.js` — both interval sites (search
  pivot row_group + widget `config.interval`) now emit `{type:"auto"}`.
- `stream-activity-overview.js` — added a module-scoped `UNIT_LETTERS` map +
  `intervalKeyword()` helper (seconds→s, minutes→m, hours→h, days→d), emitting
  `{type:"timeunit", timeunit:"<N><letter>"}`. Unknown `intervalUnit` throws
  `Unknown interval unit: <unit>` rather than silently emitting a malformed keyword.
  The `options.intervalUnit` / `options.intervalValue` behaviour is preserved.

## Tests

- New `test/regression/widget-template-interval-shape.test.js` (7 tests) — asserts the
  emitted interval at both the pivot and the widget-config sites has no `value`/`unit`
  keys and a valid `type`; covers the `stream_activity_overview` unit mapping and the
  unknown-unit throw.
- Refreshed stale snapshot fixtures whose downstream output encoded the old interval
  shape: `widget-templates.test.js.snapshot`, `blueprints.test.js.snapshot`,
  `dashboards.test.js.snapshot` (interval-shape-only diffs; no test logic weakened).

**Full suite: `npm test` → 1087 pass, 0 fail, 18 suites.**

## Commits

- `849f5a5` fix(quick-260516-mcf-01): emit Graylog-valid interval shape in widget builders
- `6d9a863` test(quick-260516-mcf-01): add interval-shape regression test, refresh snapshots

## Note

The executor's original SUMMARY.md was lost when its worktree was force-removed before
the cleanup helper rescued it; this file was reconstructed from the executor's report.
The two fix commits were recovered onto `main` via fast-forward after the worktree
branch was deleted pre-merge.
