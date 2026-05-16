# Phase 6: Dashboards, Widget Templates & Blueprints - Context

**Gathered:** 2026-05-16 (auto-resolved under user "continue to milestone end without me" directive)
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 6 ships the **milestone-defining E2E surface**: 8 dashboard tools (DASH-01..08), 6 blueprint tools (BLUE-01..06). The 14-tool surface lets an agent produce a working monitoring environment (input + stream + pipeline + dashboard + alert) from a single natural-language intent. The phase's signature deliverable is **BLUE-01 `setup_app_monitoring_stack(app_name, source_pattern)`** — the milestone's headline use-case and E2E integration test.

In scope: DASH-01..08, BLUE-01..06. Phase 6 introduces a `src/services/` layer for cross-domain composition (blueprints MUST compose from services, NEVER from other tool handlers, per ROADMAP SC4).

Out of scope: editing widget DSL by hand (blueprints + curated templates only); custom widget templates beyond the 8 named (DASH-08); E2E integration testing against live Graylog (deferred to `/gsd-verify-work`).

</domain>

<decisions>
## Implementation Decisions

### C7 mitigation — Dashboard two-step chain (ROADMAP SC1)

- **D-01:** `create_dashboard` is a **two-step internal blueprint** even in single-tool form. The wrapper internally chains:
  1. `POST /views/search` — creates the Search entity with the widget-derived `searchTypes`
  2. `POST /views` — creates the View (Dashboard) with `searchId` set to step 1's response
  The agent never sees the intermediate Search ID. The wrapper returns the chained transcript with `dependsOn` annotations per C6 pattern.
- **D-02:** `create_dashboard` REJECTS an agent-supplied `searchId` parameter. The wrapper owns the linkage.
- **D-03:** Client-side validator before emitting: `widgetPositions.keys() === widgets.map(w => w.id)`. Rejection with clear error before round-trip.

### Widget templates (ROADMAP SC3, DASH-08)

- **D-04:** Curated library ships 8 templates, each as a `{widget, position, searchType}` triplet — composer cannot produce mismatched sets:
  - `error_rate_over_time`
  - `top_sources_by_volume`
  - `level_distribution`
  - `top_error_clusters`
  - `request_rate_over_time`
  - `field_value_distribution`
  - `recent_events_table`
  - `stream_activity_overview`
- **D-05:** Templates default per-widget `timerange` to **inherit-from-dashboard** (omit the field). Agent opts into per-widget override explicitly. C7 mitigation step 4.
- **D-06:** `add_widget_from_template({connectionName, dashboardId, templateName, options})` (DASH-06) drops any template onto an existing dashboard from one call. Options carry template-specific knobs (stream binding, field, time range override).

### dependsOn chain transcript (ROADMAP SC4, C6 mitigation)

- **D-07:** Every blueprint dry-run returns `chain: [{step: N, tool, request, dependsOn?: {from, as}}, ...]`. The agent sees:
  - The sequence of would-be requests
  - Explicit `dependsOn: {from: "step1.response.id", as: "streamId"}` annotations
  Reasoning per-step independently is supported.
- **D-08:** On apply, each step substitutes the previous step's `__SERVER_ASSIGNED__` IDs into subsequent requests. Partial failure surfaces `chain[N].error` + which steps succeeded.

### Services layer (ROADMAP SC4)

- **D-09:** Blueprints compose from `src/services/*` modules, NEVER from `src/tools/<domain>/<handler>.js`. Each service exposes thin function wrappers around the Graylog HTTP client for one domain:
  - `src/services/streams.js` — `createStream({ connection, ... })`, `addRule({ ... })`, etc.
  - `src/services/pipelines.js` — `createPipeline`, `createRule`, `connectToStream`
  - `src/services/inputs.js`, `src/services/index-sets.js`, `src/services/events.js`, `src/services/dashboards.js`
  Services do NOT route through `defineMutatingHandler`; they're pure HTTP wrappers with typed return values. Plan 01 builds these.
- **D-10:** Existing single-domain tool handlers (Phases 1-5) are NOT refactored to use services this phase — the service layer is additive. Future milestones may refactor.

### Six blueprints (BLUE-01..06)

- **D-11:** **BLUE-01 `setup_app_monitoring_stack(app_name, source_pattern)`** — the headline. Composes: stream creation (filter by source_pattern) → pipeline + 2 starter rules (drop debug, enrich timestamp) → pipeline-to-stream connect → dashboard with 4 widgets (error_rate_over_time, top_sources_by_volume, level_distribution, recent_events_table) → error-rate event_definition. ~6-8 step chain.
- **D-12:** BLUE-02 `setup_error_alerting(stream_id, notification_target)` — event_definition + connect to existing notification.
- **D-13:** BLUE-03 `create_app_health_dashboard(stream_id)` — dashboard + 4 widget templates wired to the stream.
- **D-14:** BLUE-04 `setup_pipeline_for_stream(stream_id, transforms)` — pipeline + rule(s) + connection from structured intent. Reuses Phase 4's structured-intent emitter.
- **D-15:** BLUE-05 `setup_long_term_archival_index(name, retention_days)` — index set with size-based rotation + delete-retention bundled.
- **D-16:** BLUE-06 `setup_debug_log_dropping(stream_id, min_level)` — pipeline rule drops sub-threshold messages; connection wired automatically.

### M2 response normalization (carried forward)

- **D-17:** `POST /views` returns 200 with full ViewDTO; wrapper's response normalizer extracts the `id`. Per pitfall M2 table.

### Defense-in-depth + IDs

- **D-18:** Phase 0 writable-flag gate applies. __SERVER_ASSIGNED__ sentinel for create_dashboard + create_widget_from_template dry-runs. Schema-parity for all 14 new tools.

### Claude's Discretion (auto-resolved)

- **Discretion-01:** Module layout: `src/tools/dashboards/` (DASH-XX), `src/tools/blueprints/` (BLUE-XX), `src/services/<domain>.js` (shared).
- **Discretion-02:** Widget-template module structure: `src/widget-templates/{name}.js` exporting a frozen `{widget, position, searchType}` triplet builder.
- **Discretion-03:** Snapshot fixture set: 12-15 fixtures covering each tool's dry-run + the BLUE-01 full-chain transcript (1 mega-fixture).

</decisions>

<canonical_refs>
## Canonical References

- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md` — DASH-01..08, BLUE-01..06
- `.planning/ROADMAP.md` §"Phase 6"
- `.planning/research/PITFALLS.md` §C7 (drives D-01..D-05), §C6 (drives D-07/D-08), §M2 (drives D-17)
- `src/tools/_shared/handler.js`, `cascade-hash.js`, `conflict.js`
- `src/tools/events/encrypted-fields.js` (analog pattern for `src/widget-templates/`)
- `src/pipeline-dsl/emit.js` (structured-intent emitter — reused in BLUE-04)
- `source-code/graylog2-server/.../views/ViewsResource.java` (Dashboard CRUD; Search-link validation; widget-position integrity at lines 329-379)
- `source-code/graylog2-server/.../views/SearchResource.java` (POST /views/search; Search entity creation)
- `source-code/graylog2-server/.../views/ViewDTO.java` (DTO shape)

</canonical_refs>

<code_context>
- Phase 0-5 primitives all reused: defineMutatingHandler, defineListHandler, conflict.js (with elements envelope), cascade-hash.js, the structured-intent emit module
- Services layer is NEW in this phase under `src/services/` — thin HTTP wrappers per domain
- Blueprint chain semantics are NEW — Plan 01 ships the chain-transcript helper

</code_context>

<specifics>
## Specific Ideas

- BLUE-01 acceptance gate fixture: full ~6-step chain transcript with `dependsOn` annotations; pin the transcript byte-stable.
- C7 widget-position integrity fixture: client-side validator rejects mismatched widget/position before any wire emission.
- 8 widget-template fixtures pinning each triplet's emitted JSON shape.

</specifics>

<deferred>
- Auto-generation of widget templates from Graylog's built-in templates (none exist on the wire side; this is wrapper-only). Future milestone.
- Custom user-supplied widget templates (the 8 curated names are the closed set).
- E2E live-instance testing of BLUE-01 — deferred to `/gsd-verify-work 06`.

</deferred>

---

*Phase: 06-dashboards-widgets-blueprints*
*Context auto-gathered: 2026-05-16*
