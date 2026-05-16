---
phase: 06-dashboards-widgets-blueprints
plan: 03
subsystem: dashboards
tags: [widget-templates, dash-06, dash-08, m7-acceptance-gate, search-view-chain, text-widget-placeholder, frozen-registry, d-04-closed-set, d-05-inherit-timerange]

requires:
  - phase: 06-01
    provides: [src/widget-templates/index.js skeleton (TEMPLATE_NAMES + empty WIDGET_TEMPLATES frozen map), src/tools/_shared/widget-position-integrity.js (validateWidgetPositionIntegrity), src/tools/_shared/blueprint-chain.js (executeChain)]
  - phase: 06-02
    provides: [src/services/dashboards.js (getDashboard + getSearch), src/tools/dashboards/schemas.js (mutatingBase-based per-domain schemas), src/tools/dashboards/index.js dispatch barrel, src/tools/_shared/handler.js req.chain spread amendment, src/tools/dashboards/remove-widget.js (symmetric inverse pattern reference)]

provides:
  - "DASH-08 (FINALIZED) — 8 widget-template builder files under src/widget-templates/: error_rate_over_time, top_sources_by_volume, level_distribution, top_error_clusters (TEXT_WIDGET_PLACEHOLDER per Q3 default), request_rate_over_time, field_value_distribution, recent_events_table, stream_activity_overview. Each is a pure (options) → Object.freeze({widget, position, searchType}) function. Plan 06-01 shipped the closed-set TEMPLATE_NAMES tuple + empty WIDGET_TEMPLATES skeleton; this plan populates the registry."
  - "WIDGET_TEMPLATES frozen map (T-06-03-08 mitigation) — Object.freeze prevents both key-addition and key-replacement at runtime; the closed-set z.enum at the schema layer + Object.freeze at the registry layer give the D-04 'structurally impossible to mismatch' guarantee."
  - "DASH-06 add_widget_from_template — symmetric INVERSE of remove_widget. Two-step atomic PUT chain (PUT /api/views/search APPENDS new SearchType, then PUT /api/views APPENDS widget + position + widget_mapping). Search update fires FIRST so the View never references a not-yet-existing SearchType (load-bearing ordering). For the Q3 TEXT_WIDGET_PLACEHOLDER (top_error_clusters, searchType:null), only the View PUT fires — 1-step chain with empty widget_mapping entry."
  - "M7 ACCEPTANCE GATE landing — AddWidgetFromTemplateSchema uses z.enum(TEMPLATE_NAMES) so invalid templateName values reject at zod.parse BEFORE any HTTP fires. Test 1 pins refusal-before-HTTP; schema parity test pins the contract assertion. Mirrors D-02 .strict() searchId rejection on create/update but for a different attack vector (template enumeration / typo amplification)."
  - "D-03 widget-position integrity enforcement on prospective post-add sets — validateWidgetPositionIntegrity runs BEFORE wire emission with leading-underscore _setWidgetPositionValidatorForTests seam (same pattern as create-dashboard.js and remove-widget.js). Refusal short-circuits the chain — NO PUT fires."
  - "dashboard_missing_search_binding + dashboard_empty_state isClientSide refusals — fire before any chain composition when view.search_id absent OR view.state map empty. Pre-flight GETs the View + Search; isError envelope surfaces via wrapGraylogError."

affects: [06-04 blueprints-A, 06-05 blueprints-B, 06-06 phase-snapshot]

tech-stack:
  added: []  # No new npm deps — uses node:crypto randomUUID + existing zod
  patterns:
    - "Pure-function widget builders with frozen-triplet output (D-04): each builder is a (options) → Object.freeze({widget, position, searchType}) function. Top-level Object.freeze prevents reassignment of the three fields — deep-freeze not required because the wrapper composes the triplet into a new ViewDTO via spread-merge (mutating the inner widget/position/searchType objects has no observable effect on the wire emission)."
    - "D-05 inherit-from-dashboard timerange default via conditional spread: `...(options.timerangeOverride ? { timerange: options.timerangeOverride } : {})`. The `timerange` key is structurally ABSENT (not present-with-undefined) by default — matches Object.prototype.hasOwnProperty semantics the tests assert against. Override propagates to BOTH widget and searchType."
    - "Pitfall 7 array-streams contract: widget.streams + searchType.streams ALWAYS emitted as JSON arrays (`options.streamIds ?? []`), never bare strings. Pinned by Test 10 (callAllBuilders helper iterates across all 8 templates)."
    - "Q3 TEXT_WIDGET_PLACEHOLDER for top_error_clusters: ships as widget.type='text' (Graylog's TextWidgetConfigDTO discriminator) with searchType:null. The Drain3 cluster computation is wrapper-side (src/clustering/), not a server-side Graylog SearchType — inventing a fake SearchType would either break ViewDTO validation or render an empty widget. Agent populates the body via cluster_log_messages + Graylog UI."
    - "Closed-set rejection at TWO layers (M7 defense in depth): (1) z.enum(TEMPLATE_NAMES) at the schema layer rejects invalid names at parse; (2) Object.freeze(WIDGET_TEMPLATES) at the registry layer prevents map mutation. Even if a future codepath bypassed the schema, the lookup would fail safely (undefined builder → typeof check at builder call site)."
    - "Symmetric INVERSE chain ordering (add_widget_from_template ↔ remove_widget): both walk a Search+View 2-step PUT chain, but add fires Search FIRST (so View never references a not-yet-existing SearchType) and remove fires Search FIRST too (so View never points at an existing SearchType we're about to strip). Order is load-bearing for partial-failure semantics (Pitfall 9 acceptance)."

key-files:
  created:
    - "src/widget-templates/error-rate-over-time.js"
    - "src/widget-templates/top-sources-by-volume.js"
    - "src/widget-templates/level-distribution.js"
    - "src/widget-templates/top-error-clusters.js"
    - "src/widget-templates/request-rate-over-time.js"
    - "src/widget-templates/field-value-distribution.js"
    - "src/widget-templates/recent-events-table.js"
    - "src/widget-templates/stream-activity-overview.js"
    - "src/tools/dashboards/add-widget-from-template.js"
    - "test/widget-templates.test.js"
  modified:
    - "src/widget-templates/index.js"
    - "src/tools/dashboards/schemas.js"
    - "src/tools/dashboards/index.js"
    - "src/tools.js"
    - "test/dashboards.test.js"
    - "test/pipelines.test.js"

key-decisions:
  - "Q3 TEXT_WIDGET_PLACEHOLDER for top_error_clusters resolved AFK-default (researcher recommendation in 06-U1-SMOKE.md). Builder emits Object.freeze({widget:{type:'text',...}, position, searchType: null}); add_widget_from_template detects searchType:null and emits a 1-step chain (View PUT only) with an empty widget_mapping entry. Avoids inventing a non-existent Graylog SearchType while still honoring DASH-08's 8-template commitment."
  - "M7 ACCEPTANCE GATE landed at the schema layer via z.enum(TEMPLATE_NAMES) — mirrors D-02 .strict() pattern (CreateDashboardSchema/UpdateDashboardSchema) but for the template-name attack vector instead of the searchId attack vector. Defense in depth: schema-layer rejection + Object.freeze on WIDGET_TEMPLATES registry (T-06-03-08)."
  - "D-04 top-level freezing only (not deep-freeze). Object.freeze({widget, position, searchType}) prevents reassignment of the three keys; the wrapper consumes the triplet via spread-merge into a new ViewDTO so inner-object mutations have no observable effect on the wire. Avoids the cost + churn of recursive deepFreeze + bypass via `WeakMap.set(widget, ...)` patterns."
  - "Per-template option validation owned by the builder (e.g. buildFieldValueDistribution throws when options.field missing) — NOT by zod. Schema uses z.object({}).passthrough().default({}) because option shapes vary across the 8 templates; a discriminated union would be 8× the schema surface for negligible benefit. Builder errors propagate through defineMutatingHandler.build() → catch → wrapGraylogError so the agent sees a structured isError envelope."
  - "Symmetric INVERSE pattern (add ↔ remove) — both handlers share the Search+View 2-step PUT chain skeleton, the D-03 validator-with-seam, the dashboard_missing_search_binding refusal, and the executeChain apply path. add_widget_from_template fires Search BEFORE View (append semantics); remove_widget fires Search BEFORE View (strip semantics). Test fixtures parallel each other (VIEW_FOR_ADD/SEARCH_FOR_ADD ↔ VIEW_FOR_REMOVE/SEARCH_FOR_REMOVE) to make the contract symmetry visible in code."
  - "Tool count assertion bumped 83 → 84 in BOTH test/pipelines.test.js (where the Plan 06-02 baseline pin lives) AND test/dashboards.test.js (where the Plan 06-03 delta pin lives). Single source of truth would be cleaner but moving the assertion would have rippled across plan-boundary comments tied to the Plan 06-02 SUMMARY."

requirements-completed: [DASH-06, DASH-08]

duration: ~8 min
completed: 2026-05-16
---

# Phase 6 Plan 3: Widget Templates + add_widget_from_template Summary

**Shipped the 8-template widget library (DASH-08 finalized — Plan 01 had the closed-set skeleton; this plan populates the builders) + add_widget_from_template (DASH-06) — the symmetric INVERSE of remove_widget. The M7 ACCEPTANCE GATE landed via z.enum(TEMPLATE_NAMES) closed-set rejection at zod.parse, and the Q3 TEXT_WIDGET_PLACEHOLDER for top_error_clusters resolved with a 1-step chain (searchType:null + text-widget body).**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-16T02:19:47Z (first commit `51cb893`)
- **Completed:** 2026-05-16T02:28:00Z (last commit `e3f8bf7`)
- **Tasks:** 2 of 2
- **Files created:** 10 (8 widget builders + 1 handler + 1 test file)
- **Files modified:** 6 (registry index, schemas, barrel, tools.js, dashboards.test.js, pipelines.test.js)

## Accomplishments

- **DASH-08 finalized — 8 widget-template builders shipped.** Each is a pure `(options) → Object.freeze({widget, position, searchType})` function under `src/widget-templates/{name}.js`. The WIDGET_TEMPLATES registry (frozen map) is populated; lookups by name return the builder. Pin: every builder defaults per-widget `timerange` to ABSENT (D-05) and always emits `streams` as a JSON array (Pitfall 7).
- **Q3 TEXT_WIDGET_PLACEHOLDER for top_error_clusters.** Builder returns `{widget:{type:'text',...}, position, searchType: null}` — no Graylog SearchType is invented. The data source is agent-populated via the existing `cluster_log_messages` tool + Graylog UI.
- **DASH-06 add_widget_from_template — symmetric INVERSE of remove_widget.** Two-step atomic PUT chain (Search update + View update) for SearchType-bearing templates; 1-step for the text-widget placeholder. D-03 widget-position integrity validator runs on the prospective post-add sets before wire emission.
- **M7 ACCEPTANCE GATE landed.** `AddWidgetFromTemplateSchema` uses `z.enum(TEMPLATE_NAMES)` so invalid template names reject at zod.parse BEFORE any HTTP fires. Defense in depth: `Object.freeze(WIDGET_TEMPLATES)` at the registry layer (T-06-03-08).
- **Tool count 83 → 84.** Phase 6 dashboard surface is now complete pending blueprint composition (Plans 06-04 / 06-05 will compose dashboards into blueprints).

## Task Commits

Each task was committed atomically with the TDD RED → GREEN sequence:

1. **Task 1 RED: failing widget-template tests** — `51cb893` (test)
2. **Task 1 GREEN: 8 builders + populated registry** — `a58e1cf` (feat)
3. **Task 2 RED: failing DASH-06 tests** — `4afc457` (test)
4. **Task 2 GREEN: add_widget_from_template handler + schema + barrel + tools.js** — `e3f8bf7` (feat)

## Files Created/Modified

### Created

- `src/widget-templates/error-rate-over-time.js` — Template 1: time-bucket aggregation, `level:>=4` filter, bar chart
- `src/widget-templates/top-sources-by-volume.js` — Template 2: values-bucket on `source`, table, count desc sort
- `src/widget-templates/level-distribution.js` — Template 3: values-bucket on `level`, pie, includes empty
- `src/widget-templates/top-error-clusters.js` — Template 4: TEXT_WIDGET_PLACEHOLDER (searchType:null)
- `src/widget-templates/request-rate-over-time.js` — Template 5: time-bucket, line chart, agent queryString
- `src/widget-templates/field-value-distribution.js` — Template 6: generic values-bucket; throws when field absent
- `src/widget-templates/recent-events-table.js` — Template 7: MessageList widget (NOT aggregation); timestamp DESC
- `src/widget-templates/stream-activity-overview.js` — Template 8: two-bucket pivot (time + streams), stacked area
- `src/tools/dashboards/add-widget-from-template.js` — DASH-06 handler (M7 + D-03 + symmetric chain)
- `test/widget-templates.test.js` — 18 tests covering per-template shapes + D-04/D-05/Pitfall-7/T-06-03-08 contracts

### Modified

- `src/widget-templates/index.js` — Populated WIDGET_TEMPLATES frozen map with 8 builders
- `src/tools/dashboards/schemas.js` — Added AddWidgetFromTemplateSchema with z.enum(TEMPLATE_NAMES)
- `src/tools/dashboards/index.js` — Registered handleAddWidgetFromTemplate
- `src/tools.js` — Added add_widget_from_template tool definition (description ≤200 chars; closed-set enum on templateName)
- `test/dashboards.test.js` — Added 14 tests covering DASH-06 (M7 GATE, pre-flight order, 2-step + 1-step chains, append semantics, D-03 seam, dashboard_empty_state, builder-error surface, count assertion 84)
- `test/pipelines.test.js` — Bumped tool-count assertion 83 → 84 to reflect Plan 06-03 close

## Decisions Made

- **Q3 TEXT_WIDGET_PLACEHOLDER landed as AFK-default.** top_error_clusters ships as a text widget — searchType:null, widget.type:"text", config.text contains a hard-coded placeholder string. The agent populates the body via separate calls. This avoided inventing a Graylog SearchType that doesn't exist while still honoring the DASH-08 8-template commitment.
- **M7 ACCEPTANCE GATE at the schema layer via z.enum(TEMPLATE_NAMES).** Mirrors D-02 .strict() searchId rejection (different attack vector — template enumeration / typo amplification). Defense in depth: schema rejection + frozen registry map.
- **D-04 top-level freezing only (not deep-freeze).** `Object.freeze({widget, position, searchType})` prevents reassignment of the three keys; wrapper consumes the triplet via spread-merge so inner mutations have no observable effect. Avoids deepFreeze cost and WeakMap-bypass attacks.
- **Per-template option validation owned by builders (not by zod).** Schema uses `z.object({}).passthrough().default({})`; per-template required options enforced in the builder (e.g. field_value_distribution throws when `field` absent). Builder errors propagate through wrapGraylogError as structured isError envelopes.
- **Symmetric INVERSE chain ordering (add ↔ remove).** Both fire Search BEFORE View — add appends so the View never references a not-yet-existing SearchType; remove strips so the View never points at an already-stripped SearchType. Order is load-bearing for Pitfall 9 partial-failure semantics.
- **Tool-count assertion bumped in BOTH test files** (pipelines.test.js where the Plan 06-02 baseline lives, dashboards.test.js where the Plan 06-03 delta lives). Single source of truth would be cleaner but the existing comment-block-tied-to-plan-boundary pattern is the established convention.

## Deviations from Plan

None — plan executed exactly as written.

Two implementation details worth documenting (NOT deviations — both anticipated by the plan):

1. The plan's Task 2 Step A drafted `AddWidgetFromTemplateSchema = mutatingBase.extend({...})` literally; the shipped schema matches verbatim. The `.passthrough()` + `.default({})` combo on `options` is exactly the open-shape pattern the plan called for.
2. The plan's Task 2 Step B drafted the handler with `query.findIndex(q => q.id === stateKey)` — the shipped handler uses the same pattern with defensive `Array.isArray(search?.queries) ? search.queries : []` guarding (mirroring remove-widget.js's existing pattern).

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **DASH-06 + DASH-08 complete.** Phase 6 dashboard CRUD surface fully shipped (7 of 8 dashboard tools registered; the 8th DASH-09 share-permissions is deferred per 06-CONTEXT.md).
- **Blueprint hand-off ready.** Plans 06-04 (BLUE-01..03) and 06-05 (BLUE-04..06) will consume `WIDGET_TEMPLATES` and `handleAddWidgetFromTemplate` to compose multi-step "set up app monitoring for service X" blueprints. The frozen-registry contract + M7 closed-set rejection give the blueprint composer a stable, structurally-safe surface.
- **Tool count 84.** Next plan (06-04) ships BLUE-01..03; the count assertion will bump to 87 (3 new blueprint tools).

## Self-Check: PASSED

All claimed files exist on disk:
- 8 widget-template builder files present
- src/tools/dashboards/add-widget-from-template.js present
- test/widget-templates.test.js present
- .planning/phases/06-dashboards-widgets-blueprints/06-03-SUMMARY.md present

All claimed commits present in git log:
- `51cb893` — test(06-03): failing widget-template tests (RED)
- `a58e1cf` — feat(06-03): 8 builders + populated registry (GREEN)
- `4afc457` — test(06-03): failing DASH-06 tests (RED)
- `e3f8bf7` — feat(06-03): add_widget_from_template handler (GREEN)

Full suite green: 956 tests passing (was 924 at Plan 06-02 end; +18 widget-template + +14 dashboards = +32 net, then a few snapshot/dispatch tests joined automatically as the count-assertion edge moved 83 → 84).

---
*Phase: 06-dashboards-widgets-blueprints*
*Completed: 2026-05-16*
