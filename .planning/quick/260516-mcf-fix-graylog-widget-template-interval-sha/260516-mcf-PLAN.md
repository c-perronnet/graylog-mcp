---
phase: quick-260516-mcf
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/widget-templates/error-rate-over-time.js
  - src/widget-templates/request-rate-over-time.js
  - src/widget-templates/stream-activity-overview.js
  - test/regression/widget-template-interval-shape.test.js
  - test/snapshots/__snapshots__/widget-templates.test.js.snapshot
autonomous: true
requirements: [quick-260516-mcf]

must_haves:
  truths:
    - "Every widget-template builder emits an interval object Graylog 7.x Interval model accepts (no value/unit keys)"
    - "error_rate_over_time and request_rate_over_time emit {type:\"auto\"} intervals"
    - "stream_activity_overview emits {type:\"timeunit\", timeunit:\"<N><letter>\"} with unit mapped seconds->s/minutes->m/hours->h/days->d"
    - "An unknown intervalUnit fails clearly instead of emitting a malformed keyword"
    - "npm test passes (regression test + refreshed snapshot suite both green)"
  artifacts:
    - path: "src/widget-templates/error-rate-over-time.js"
      provides: "error_rate builder with corrected auto interval"
      contains: "type: \"auto\""
    - path: "src/widget-templates/request-rate-over-time.js"
      provides: "request_rate builder with corrected auto interval"
      contains: "type: \"auto\""
    - path: "src/widget-templates/stream-activity-overview.js"
      provides: "stream_activity builder with corrected timeunit-keyword interval"
      contains: "timeunit"
    - path: "test/regression/widget-template-interval-shape.test.js"
      provides: "regression test asserting valid interval shape for all three builders"
      min_lines: 20
  key_links:
    - from: "src/widget-templates/stream-activity-overview.js"
      to: "intervalUnit option"
      via: "unit->letter mapping helper"
      pattern: "minutes.*m|seconds.*s"
---

<objective>
Fix the widget-template interval-shape bug: builders emit a Graylog pivot
time-bucket `interval` as `{type:"timeunit", value:N, unit:U}`, which Graylog
7.x's Interval model rejects ("Unable to map property value. Known properties
include: timeunit, type"). This breaks `create_app_health_dashboard` and every
time-series widget at the create_search step.

Purpose: restore the write path for all time-series widget templates and the
app-health dashboard blueprint.
Output: three corrected builders, a regression test, and a refreshed snapshot fixture.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

<interfaces>
<!-- Graylog 7.x Interval model — exactly two valid shapes (confirmed live): -->
<!--   AUTO:     { type: "auto" }                  (optional numeric `scaling`) -->
<!--   TIMEUNIT: { type: "timeunit", timeunit: "<N><letter>" }  letter ∈ s|m|h|d -->
<!-- The bad shape {type:"timeunit", value:N, unit:U} is rejected upstream. -->

Each builder appears in src/widget-templates/index.js WIDGET_TEMPLATES and
returns Object.freeze({ widget, position, searchType }). The interval object
appears TWICE per file: once in searchType.row_groups[].interval, once in
widget.config.row_pivots[].config.interval. BOTH are the same Interval model.

stream-activity-overview.js options: intervalUnit (default "minutes"),
intervalValue (default 5) — both must keep working.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix interval shape in all three widget-template builders</name>
  <files>src/widget-templates/error-rate-over-time.js, src/widget-templates/request-rate-over-time.js, src/widget-templates/stream-activity-overview.js</files>
  <action>
    In error-rate-over-time.js (lines ~31 and ~61) replace BOTH occurrences of
    `{ type: "timeunit", value: 1, unit: "auto" }` with `{ type: "auto" }`. The
    `unit:"auto"` confirms this is conceptually an AUTO interval.

    In request-rate-over-time.js (lines ~22 and ~49) replace BOTH occurrences of
    `{ type: "timeunit", value: 1, unit: "auto" }` with `{ type: "auto" }`.

    In stream-activity-overview.js this is a FIXED interval. Add a module-scoped
    unit->letter mapping helper (e.g. a const map plus a `intervalKeyword` helper
    function) that maps seconds->s, minutes->m, hours->h, days->d, building the
    keyword as `<intervalValue><letter>` (intervalValue=5, intervalUnit="minutes"
    -> "5m"). If intervalUnit is not a known key, throw a clear Error (e.g.
    `Unknown interval unit: <unit>`) rather than emitting a malformed keyword —
    do NOT silently default. Replace BOTH occurrences (lines ~27 and ~67) of
    `{ type: "timeunit", value: intervalValue, unit: intervalUnit }` with
    `{ type: "timeunit", timeunit: intervalKeyword(intervalValue, intervalUnit) }`.
    Compute the keyword once before timeBucket so both occurrences reuse it.

    Backward compat: the ONLY behavioral change is the interval object shape.
    Widget structure, positions, series, visualization, query strings,
    descriptions, and all other fields must be byte-identical. Keep
    options.intervalUnit / options.intervalValue defaults and override behavior intact.
  </action>
  <verify>
    <automated>node -e "import('./src/widget-templates/error-rate-over-time.js').then(m=>{const i=m.buildErrorRateOverTime({}).searchType.row_groups[0].interval;if(i.value!==undefined||i.unit!==undefined||i.type!=='auto')process.exit(1)});import('./src/widget-templates/stream-activity-overview.js').then(m=>{const i=m.buildStreamActivityOverview({intervalUnit:'hours',intervalValue:2}).searchType.row_groups[0].interval;if(i.type!=='timeunit'||i.timeunit!=='2h'||i.value!==undefined)process.exit(1)})"</automated>
  </verify>
  <done>All three builders emit valid intervals: error_rate + request_rate emit {type:"auto"}; stream_activity emits {type:"timeunit", timeunit:"<N><letter>"}; unknown unit throws; no value/unit keys remain.</done>
</task>

<task type="auto">
  <name>Task 2: Add regression test and refresh snapshot fixtures</name>
  <files>test/regression/widget-template-interval-shape.test.js, test/snapshots/__snapshots__/widget-templates.test.js.snapshot</files>
  <action>
    Create test/regression/widget-template-interval-shape.test.js using
    `node:test` + `node:assert/strict` (ESM, matches existing test/regression/
    files). Import buildErrorRateOverTime, buildRequestRateOverTime,
    buildStreamActivityOverview from ../../src/widget-templates/.

    For each of the three builders, build the triplet and assert on BOTH the
    searchType pivot interval (searchType.row_groups[0].interval) AND the widget
    config interval (widget.config.row_pivots[0].config.interval): the interval
    object has NO `value` key and NO `unit` key (use
    Object.prototype.hasOwnProperty.call), and `type` is either "auto", OR
    "timeunit" with a non-empty `timeunit` string keyword present.

    For stream_activity_overview cover the unit mapping: default call (no
    intervalUnit/intervalValue) -> timeunit "5m"; and a non-default call with
    options.intervalUnit:"hours" (e.g. intervalValue:3) -> "3h". Also assert an
    unknown intervalUnit throws (assert.throws).

    Then refresh the stale snapshot fixtures. The existing snapshot file
    test/snapshots/__snapshots__/widget-templates.test.js.snapshot encodes the
    OLD shape ({type:"timeunit",value:N,unit:U}) at six locations (error_rate,
    request_rate, stream_activity — pivot + config each). Regenerate it by
    running the snapshot suite with the update flag:
    `node --test --test-update-snapshots 'test/snapshots/widget-templates.test.js'`.
    Do NOT weaken test/snapshots/widget-templates.test.js itself — only the
    fixture file is refreshed by the update run.
  </action>
  <verify>
    <automated>npm test</automated>
  </verify>
  <done>Regression test passes; snapshot suite passes with refreshed interval shape; full `npm test` is green.</done>
</task>

</tasks>

<verification>
- All three builders emit Graylog-valid interval objects (no value/unit keys).
- stream_activity unit mapping covers seconds/minutes/hours/days; unknown unit throws.
- Snapshot fixture refreshed to corrected shape; snapshot test not weakened.
- `npm test` passes (full suite).
</verification>

<success_criteria>
- error_rate_over_time and request_rate_over_time emit `{type:"auto"}` at both interval sites.
- stream_activity_overview emits `{type:"timeunit", timeunit:"<N><letter>"}` at both sites.
- Regression test asserts valid shape for all three builders incl. unit-mapping cases.
- `npm test` green.
</success_criteria>

<output>
Create `.planning/quick/260516-mcf-fix-graylog-widget-template-interval-sha/260516-mcf-SUMMARY.md` when done
</output>
