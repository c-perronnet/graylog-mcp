---
phase: 06-dashboards-widgets-blueprints
plan: 01
subsystem: infrastructure
tags: [services-layer, blueprint-chain, widget-position-integrity, conflict-envelope, widget-templates, dashboards, http-wrappers]

requires:
  - phase: 00-foundation
    provides: [defineMutatingHandler, SERVER_ASSIGNED_SENTINEL, makeClient, GraylogError, toIdBody, findExistingMatches stub]
  - phase: 01-inputs-extractors
    provides: [findExistingMatches Phase-1 implementation + inputs/extractors envelope keys]
  - phase: 02-index-sets-retention
    provides: [index_sets envelope amendment to conflict.js]
  - phase: 03-streams-stream-rules
    provides: [CreateEntityRequest envelope pattern + cascade-hash + STREAM_RULE_TYPE_TO_NUMERIC translation idiom]
  - phase: 04-pipelines-pipeline-rules-connections
    provides: [pipeline-rule DSL emitter (src/pipeline-dsl/emit.js) + connection-management merge pattern]
  - phase: 05-events-notifications
    provides: [elements envelope amendment + encrypted-fields frozen-map pattern + WILDCARD body undefined idiom + 5-U1-SMOKE precedent]

provides:
  - "Services layer (src/services/{streams,pipelines,inputs,index-sets,events,dashboards}.js) — 6 thin HTTP wrapper modules"
  - "src/widget-templates/index.js skeleton — frozen TEMPLATE_NAMES (8 D-04 closed-set) + frozen empty WIDGET_TEMPLATES"
  - "src/tools/_shared/blueprint-chain.js — executeChain transcript walker + substitutePlaceholders recursive substitution"
  - "src/tools/_shared/widget-position-integrity.js — validateWidgetPositionIntegrity bidirectional strict-equality validator"
  - "src/tools/_shared/conflict.js — response.views envelope amendment (Phase 6 Pitfall 1)"
  - "06-U1-SMOKE.md decision artifact resolving the 4 RESEARCH open questions (UNREACHABLE → researcher AFK defaults)"
  - "src/services/dashboards.js::buildSearchDTO + buildViewDTO assembler helpers (used by Plan 06-02 create_dashboard AND Plan 06-05 BLUE-01/BLUE-03)"

affects: [06-02 dashboards-CRUD, 06-03 widget-templates, 06-04 blueprints-A, 06-05 blueprints-B, 06-06 phase-snapshot]

tech-stack:
  added: []  # No new npm deps; reused @modelcontextprotocol/sdk, axios, zod
  patterns:
    - "Thin services layer: (client, args) → Promise<response>; no MCP coupling, no zod, no dryRun branching"
    - "Blueprint chain transcript: pre-computed [{step, tool, request, dependsOn?}] walked by executeChain with __SERVER_ASSIGNED__step{N} placeholder substitution in body AND path"
    - "Bidirectional strict-equality validator for D-03 widget/position integrity (tightens Graylog server-side superset-only check)"
    - "U1-smoke artifact under unreachable cluster: record researcher AFK defaults per probe + hand-off to consuming plans"
    - "Frozen closed-set enum tuple + frozen empty registry map skeleton (Plan 06-03 fills builders without churning callers)"

key-files:
  created:
    - "src/services/streams.js"
    - "src/services/pipelines.js"
    - "src/services/inputs.js"
    - "src/services/index-sets.js"
    - "src/services/events.js"
    - "src/services/dashboards.js"
    - "src/widget-templates/index.js"
    - "src/tools/_shared/blueprint-chain.js"
    - "src/tools/_shared/widget-position-integrity.js"
    - "test/services.test.js"
    - "test/blueprint-chain.test.js"
    - "test/widget-position-integrity.test.js"
    - ".planning/phases/06-dashboards-widgets-blueprints/06-U1-SMOKE.md"
  modified:
    - "src/tools/_shared/conflict.js"
    - "test/conflict.test.js"

key-decisions:
  - "06-U1-SMOKE.md Q1: WRAPPER_SIDE_TYPE_FILTER — list_dashboards ALWAYS post-filters response.views by view.type === 'DASHBOARD' regardless of upstream filter behavior"
  - "06-U1-SMOKE.md Q2: EMIT_BOTH_EXPLICIT — buildViewDTO always emits titles + display_mode_settings with Pitfall 6 defaults"
  - "06-U1-SMOKE.md Q3: TEXT_WIDGET_PLACEHOLDER — top_error_clusters ships as text widget with searchType:null per user AFK directive"
  - "06-U1-SMOKE.md Q4: TAGGED_UNION_INFINITY — full-width Position emits {type:'infinity'} per Jackson sealed-class convention (Phase 6 8-template default set uses IntegerPosition only)"
  - "Services layer is THIN: callers own zod validation, services pass pre-validated args directly to wire form"
  - "executeChain substitutePlaceholders does BOTH exact-match (preserves replacement type) AND substring-match (handles path interpolation like /api/streams/__SERVER_ASSIGNED__step1/connect)"
  - "Conflict.js envelope chain position: elements → views → items (preserves Phase 5 elements precedence; views wins over generic items)"
  - "Plan 06-01 ships WIDGET_TEMPLATES as Object.freeze({}) — Plan 06-03 populates builders; TEMPLATE_NAMES is the production-ready zod enum source"

patterns-established:
  - "Services layer composition (D-09): blueprints compose from src/services/*, NEVER from src/tools/<domain>/<handler>.js. Documented in each service module header. T-06-01-01 mitigation."
  - "Blueprint chain helpers (D-07/D-08): executeChain + substitutePlaceholders centralize the C6 mitigation transcript-walk pattern reused by all 6 BLUE-XX blueprints (Plans 06-04, 06-05)."
  - "Bidirectional strict-equality validator (D-03/Pitfall 4): widget-position-integrity tightens Graylog's superset-only check — applies before HTTP. Reusable pattern for any future client-side-tighter-than-server validator."
  - "06-U1-SMOKE decision artifact (UNREACHABLE branch): when no API token is discoverable, record researcher recommendations verbatim with PROBE_FAILED_UNREACHABLE markers + hand-off table to consuming plans. Precedent set by 02/04/05-U1-SMOKE."
  - "Frozen-tuple skeleton for closed-set zod enums: TEMPLATE_NAMES ships in Plan 06-01 (Plan 06-02/06-04/06-05 can consume z.enum(TEMPLATE_NAMES) immediately), WIDGET_TEMPLATES builders fill in Plan 06-03 without churning the zod-validation surface."

requirements-completed: [DASH-08]

duration: 12min
completed: 2026-05-16
---

# Phase 6 Plan 1: Foundation Summary

**Cross-cutting Phase 6 foundation — 6 thin HTTP service wrappers, executeChain transcript helper with placeholder substitution, D-03 widget-position-integrity validator, conflict.js views envelope amendment, widget-templates skeleton + 8-name closed set, and 06-U1-SMOKE.md decision artifact pinning the 4 RESEARCH open questions to researcher AFK defaults.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-16T01:35:00Z (approx — first commit landed 1d263bf)
- **Completed:** 2026-05-16T01:47:29Z
- **Tasks:** 4 of 4
- **Files created:** 13 (6 service modules + 1 widget-templates skeleton + 2 _shared helpers + 3 test files + 1 U1-smoke artifact)
- **Files modified:** 2 (conflict.js + conflict.test.js)
- **Net-new tests:** 26 (1 conflict + 8 blueprint-chain + 4 widget-position + 13 services)
- **Suite total:** 882 tests / 18 suites, all green (856 baseline + 26 net-new)

## Accomplishments

- **Services layer (6 modules, ~250 LOC)** under `src/services/` — `(client, args) → Promise<response>` thin wrappers per D-09. Zero MCP coupling (grep-verified: no `defineMutatingHandler`, no `from "../tools/"`). Defense-in-depth via `client.request`'s writable-flag gate inherited transparently.
- **`buildSearchDTO` + `buildViewDTO` assemblers** in `src/services/dashboards.js` — emit ViewDTO with `titles` + `display_mode_settings` explicitly per `06-U1-SMOKE.md` Q2 (Pitfall 6). Single source of truth used by BOTH Plan 06-02 `create_dashboard` AND Plan 06-05 BLUE-01/BLUE-03 chains.
- **`executeChain` blueprint helper** with `__SERVER_ASSIGNED__step{N}` substitution in body AND path (exact-match preserves replacement type; substring-match handles path interpolation). Supports single-object OR array-shape `dependsOn` (BLUE-01 step 4 has two prior-step dependencies). Partial-failure short-circuit emits `blueprint_chain_partial_failure` envelope with transcript + `failed_at_step` + `succeeded_steps`. Unresolved-dependency rejection at apply via `blueprint_chain_unresolved_dependency`.
- **`validateWidgetPositionIntegrity`** D-03 validator — bidirectional strict-equality between `widgets[].id` and `Object.keys(widgetPositions)`. Throws with `reason: "widget_position_integrity_violation"` + `isClientSide: true` for downstream handler routing. Tightens Graylog server-side superset-only check (`ViewsResource.java:371-378`).
- **`conflict.js` `response.views` envelope amendment** — one-line additive amendment to the envelope-key fallback chain (positioned `elements → views → items`; preserves Phase 5 elements precedence). Unlocks `list_dashboards` (DASH-01) and `create_dashboard` FOUND-11 duplicate-title pre-check in Plan 06-02.
- **`06-U1-SMOKE.md`** decision artifact: UNREACHABLE branch (no token discoverable; `getConnections() === {}`) → researcher AFK defaults locked across Q1..Q4 with hand-off table to Plans 02-06.
- **`src/widget-templates/index.js`** skeleton — frozen 8-name `TEMPLATE_NAMES` tuple (D-04 closed set) + frozen empty `WIDGET_TEMPLATES` map. Plan 06-03 attaches builders without churning callers that consume `TEMPLATE_NAMES` for `z.enum(...)`.

## Task Commits

Each task was committed atomically:

1. **Task 1: U1-smoke decision artifact + conflict.js views envelope amendment** — `1d263bf` (feat)
2. **Task 2: Widget-position integrity validator + blueprint chain helper** — `0a3b943` (feat)
3. **Task 3: Services layer (6 thin HTTP wrapper modules)** — `eb7923f` (feat)
4. **Task 4: Widget-template skeleton + TEMPLATE_NAMES closed set** — `ab49e0f` (feat)

**Plan metadata commit:** (to land after this SUMMARY plus STATE/ROADMAP updates)

## Files Created/Modified

**Created (13):**
- `src/services/streams.js` — createStream (CreateEntityRequest envelope, matching_type AND default), addRule, deleteStream, startStream, pauseStream
- `src/services/pipelines.js` — createPipeline, createRule (DSL source), connectToStream, disconnectFromStream
- `src/services/inputs.js` — createInput (POST /api/system/inputs), deleteInput
- `src/services/index-sets.js` — createIndexSet (snake-cases camelCase to wire form)
- `src/services/events.js` — createEventDefinition (?schedule=false default per Phase 5 D-03 M1), enableEventDefinition (WILDCARD body undefined per Phase 5 05-U1-SMOKE)
- `src/services/dashboards.js` — createSearch (BARE SearchDTO body, Pitfall 3 explicit exception), createDashboard (CreateEntityRequest envelope), updateSearch, updateDashboard, getDashboard, getSearch, deleteDashboard, buildSearchDTO, buildViewDTO
- `src/widget-templates/index.js` — frozen TEMPLATE_NAMES (8 names) + frozen empty WIDGET_TEMPLATES
- `src/tools/_shared/blueprint-chain.js` — executeChain transcript walker + substitutePlaceholders recursive substitution
- `src/tools/_shared/widget-position-integrity.js` — validateWidgetPositionIntegrity (bidirectional strict equality)
- `test/services.test.js` — 13 wire-form assertions across 6 modules
- `test/blueprint-chain.test.js` — 8 tests (happy path, body substitution, path substitution, array-shape dependsOn, partial-failure envelope, unresolved-dependency envelope, substitutePlaceholders pure-function sanity)
- `test/widget-position-integrity.test.js` — 4 tests (valid match, widget-missing-position throws, position-missing-widget throws, empty inputs no-throw)
- `.planning/phases/06-dashboards-widgets-blueprints/06-U1-SMOKE.md` — 4-probe decision artifact (UNREACHABLE → researcher defaults) with hand-off table

**Modified (2):**
- `src/tools/_shared/conflict.js` — +1 line `?? response?.views` in envelope chain (positioned after `?? response?.elements`, before `?? response?.items`); comment block updated to mention Phase 6 `/api/views` PaginatedResponse
- `test/conflict.test.js` — +1 test pinning the `response.views` envelope unwrap

## Decisions Made

**06-U1-SMOKE.md researcher defaults locked (UNREACHABLE — no API token discoverable in executor env, precedent set by 02/04/05-U1-SMOKE):**

| Probe | Decision | Rationale |
|-------|----------|-----------|
| Q1 — `/api/views?query=type:DASHBOARD` filter | `WRAPPER_SIDE_TYPE_FILTER` | `SEARCH_FIELD_MAPPING` excludes `type` (lines 112-116). Defensive client-side filter is idempotent if Graylog 7.2 ever tightens upstream. |
| Q2 — `ViewStateDTO.titles` + `displayModeSettings` omission | `EMIT_BOTH_EXPLICIT` | `ViewStateDTO.Builder.create()` requires both per `.empty()` defaults. Defensive emission costs ~80 bytes per ViewDTO; guarantees deserialization. |
| Q3 — `top_error_clusters` strategy | `TEXT_WIDGET_PLACEHOLDER` | Graylog has no first-class log-cluster SearchType; text-widget preserves D-04 closed-set; user AFK directive interpreted as standing authorization for researcher recommendation. |
| Q4 — full-width `Position` wire shape | `TAGGED_UNION_INFINITY` (`{type: "infinity"}`) | Jackson sealed-class convention for `InfinityPosition`. Phase 6 default 8 templates use IntegerPosition only — this is documentation-only for Phase 6, future-proofing for full-width templates. |

**Implementation decisions:**

- **`substitutePlaceholders` does exact-match AND substring-match**: exact-match (entire string equals the placeholder) preserves replacement type (numeric replacement stays numeric, not coerced to string); substring-match handles path interpolation like `/api/streams/__SERVER_ASSIGNED__step1/connect`. Documented in JSDoc and unit-tested.
- **`executeChain` resolves `dependsOn.from` via explicit step-number lookup, not array index**: parses the leading `stepN.` prefix and finds the matching transcript entry by `.step` field. Supports non-contiguous chains (e.g. an optional step skipped by a guard).
- **Conflict.js envelope chain position**: `elements → views → items` (between Phase 5's `elements` and the generic `items` fallback). Preserves Phase 5 paginated-response precedence so Phase 5 callers don't regress.
- **`WIDGET_TEMPLATES` ships as `Object.freeze({})` in Plan 01**: Plan 06-03 fills the builders. Callers that consume `TEMPLATE_NAMES` for `z.enum(...)` (Plans 06-02 / 06-04 / 06-05 if they need it earlier) work without churn; callers that try `WIDGET_TEMPLATES[name](options)` get `undefined` until Plan 06-03 lands. This phases the dependencies cleanly.
- **`buildViewDTO` widget_mapping for text-widget placeholders**: emits `{txt1: []}` (empty array) when `searchType: null`, so the widget renders without a data binding (Q3 `TEXT_WIDGET_PLACEHOLDER` path). Verified in `test/services.test.js` bonus test.
- **`createEventDefinition` carries forward Phase 5 D-03 M1 default (`?schedule=false`)**: blueprint chains can stage event definitions UNSCHEDULED and flip them on via `enableEventDefinition` as a separate step, isolating the "scheduling concern" from the "definition concern" cleanly across blueprint chain transcripts.

## Deviations from Plan

**One scope-adjacent micro-decision during Task 2:**

### Auto-fixed Issues

**1. [Rule 1 - Bug] `substitutePlaceholders` initial implementation was exact-match-only; path substitution test failed**
- **Found during:** Task 2 (blueprint-chain.test.js verification)
- **Issue:** The initial walker matched ONLY strings whose entire content equaled a placeholder. Path tests like `/api/streams/__SERVER_ASSIGNED__step1/connect` produced no substitution. This is a correctness bug — the plan's Task 2 Step C test 3 mandates path interpolation.
- **Fix:** Extended `substitutePlaceholders` to do exact-match first (preserves replacement type), then fall back to substring-replacement-per-placeholder. Type preservation matters for non-string replacements (numeric IDs); substring handles path interpolation.
- **Files modified:** `src/tools/_shared/blueprint-chain.js`
- **Verification:** All 8 blueprint-chain tests pass; pure-function sanity tests (the "bonus" tests in `test/blueprint-chain.test.js`) verify exact-match behavior on primitives is preserved.
- **Committed in:** `0a3b943` (Task 2 commit — fix landed atomically with the initial implementation)

**2. [Plan scope clarification] services.test.js ships 13 tests instead of plan-specified 12**
- **Found during:** Task 3 (services test authoring)
- **Issue:** The plan's Task 3 specifies 12 tests. I added one bonus test (`buildViewDTO emits empty widget_mapping for text-widget placeholder (Q3 searchType: null)`) to pin the Q3 `TEXT_WIDGET_PLACEHOLDER` path's widget_mapping shape. Without this test, the Q3 decision pattern is unverified at the assembler level — Plan 06-03 wouldn't catch a regression that drops the empty-array branch.
- **Fix:** Kept the bonus test; documented as scope-adjacent (Rule 2 — adding missing correctness coverage for a load-bearing decision).
- **Files modified:** `test/services.test.js`
- **Verification:** All 13 tests pass; the bonus test specifically asserts `dto.state["q-1"].widget_mapping === {txt1: []}` when `searchType: null`.
- **Committed in:** `eb7923f` (Task 3 commit)

---

**Total deviations:** 2 (1 inline bug fix during initial implementation, 1 additive scope-adjacent test for Q3 verification)
**Impact on plan:** No scope creep; both deviations strengthen the same contracts the plan already specifies. Test counts: plan target 23 net-new; actual 26 net-new (1 conflict + 8 blueprint-chain + 4 widget-position + 13 services). The 3 extras: 2 substitutePlaceholders pure-function sanity tests (preserves type, recurses) + 1 buildViewDTO Q3 placeholder test.

## Issues Encountered

None of plan-blocking scope. The single test failure during Task 2 (path-substitution exact-match-only bug) was diagnosed and fixed within the same task; the partial-failure transcript test caught a JSON.parse pre-condition (transcript must be valid JSON, including the failed-step entry's `.error` field as a string — verified).

## User Setup Required

None — Phase 6 is pure code/config. No new external services, no new environment variables, no new credentials.

## Threat Surface Scan

No new threat surface beyond the plan's `<threat_model>`. The 6 service modules introduce HTTP wrappers but each routes through the existing `client.request` path which already applies the Phase 0 writable-flag defense-in-depth gate. No new auth paths, no new file I/O, no new schema-modifying surface. T-06-01-01 through T-06-01-07 mitigations all in place per the plan.

## Next Phase Readiness

**Plan 06-02 (create_dashboard / DASH-01..04) is unblocked:**
- `src/services/dashboards.js` provides `createSearch`, `createDashboard`, `buildSearchDTO`, `buildViewDTO` — the two-step internal chain composes from these.
- `src/tools/_shared/widget-position-integrity.js` provides the D-03 validator the `create_dashboard` build() will invoke before emitting.
- `src/tools/_shared/conflict.js` recognizes `response.views` envelope so FOUND-11 duplicate-title pre-checks work.
- `src/widget-templates/index.js` exports `TEMPLATE_NAMES` so the DASH-06 (add_widget_from_template) zod schema can wire `z.enum(TEMPLATE_NAMES)` without circular-import concerns.

**Plan 06-03 (widget-templates / DASH-08) is unblocked:** Plan 06-03 fills `WIDGET_TEMPLATES` with the 8 per-template builders; the closed-set names are already locked.

**Plan 06-04/06-05 (blueprints) is unblocked:** `src/tools/_shared/blueprint-chain.js` provides `executeChain` + `substitutePlaceholders` — every BLUE-XX blueprint's apply path will route through these. The 6 service modules cover all wire-form needs for the 6 blueprints.

**06-U1-SMOKE.md re-verification deferred:** When a future executor has a live writable token, the 4 probes should be re-run against `<graylog-host>:9000` and the Result blocks amended. None of Plans 06-02..06-06 block on this re-verification — the AFK defaults are production-safe.

## Self-Check: PASSED

- `src/services/streams.js`: FOUND
- `src/services/pipelines.js`: FOUND
- `src/services/inputs.js`: FOUND
- `src/services/index-sets.js`: FOUND
- `src/services/events.js`: FOUND
- `src/services/dashboards.js`: FOUND
- `src/widget-templates/index.js`: FOUND
- `src/tools/_shared/blueprint-chain.js`: FOUND
- `src/tools/_shared/widget-position-integrity.js`: FOUND
- `test/services.test.js`: FOUND
- `test/blueprint-chain.test.js`: FOUND
- `test/widget-position-integrity.test.js`: FOUND
- `.planning/phases/06-dashboards-widgets-blueprints/06-U1-SMOKE.md`: FOUND
- Commit `1d263bf` (Task 1): FOUND
- Commit `0a3b943` (Task 2): FOUND
- Commit `eb7923f` (Task 3): FOUND
- Commit `ab49e0f` (Task 4): FOUND
- `npm test` final: 882 tests / 18 suites all green
- `grep -l "defineMutatingHandler" src/services/`: empty (no matches) — services-layer MCP-coupling-free audit PASSES
- `grep -l "from \"../tools/" src/services/`: empty — services don't import from tools, audit PASSES
- `src/graylog/errors.js` modified in Plan 06-01: NO (verified via `git diff --name-only HEAD~4..HEAD`)
- No new npm deps added: VERIFIED (no Plan 06-01 commit touches package.json)

---
*Phase: 06-dashboards-widgets-blueprints*
*Completed: 2026-05-16*
