# Roadmap: Graylog MCP — Full Admin Surface

**Created:** 2026-05-13
**Granularity:** coarse (8 phases)
**Strategy:** sequential execution, phase-branching (`gsd/phase-{phase}-{slug}`)
**Coverage:** 71/71 v1 requirements mapped

## Phases

- [ ] **Phase 0: Foundation** — Cross-cutting infrastructure (dispatch refactor, HTTP client, mutating-handler factory, dry-run primitive, zod adoption, snapshot test harness) so every subsequent domain phase composes the same safety primitives.
- [ ] **Phase 1: Inputs & Extractors** — CRUD for inputs (GELF/Beats/Syslog/Raw) + extractors, including the partial-update pattern that protects encrypted fields on `update_input`.
- [ ] **Phase 2: Index Sets & Retention** — Index-set CRUD with rotation/retention strategies, the inverted `deleteIndices` default, and the reusable `await_system_job` async-poll primitive.
- [ ] **Phase 3: Streams & Stream Rules** — Stream CRUD + stream-rule CRUD with `test_stream_match` validation and pre-delete cascade preview (rules + pipeline connections + event defs).
- [ ] **Phase 4: Pipelines, Pipeline Rules & Connections** — Pipeline CRUD + the `src/pipeline-dsl/` subsystem (emit/escape/validate/builtins), server-authoritative parse pre-flight, and `simulate_pipeline_rule`.
- [ ] **Phase 5: Events & Notifications** — Full CRUD upgrade for event definitions and notifications, with `schedule: false` default and v6→v7 aggregation-syntax migration helper.
- [ ] **Phase 6: Dashboards, Widget Templates & Blueprints** — Dashboard CRUD via internal Search+View chain, the 8-template curated widget library, and the 6 cross-domain blueprints composed from services.
- [ ] **Phase 7: Final Hardening** — Tool-description audit, `list_admin_tools` meta-tool, v7-vs-v6 read-tool smoke pass, c8 coverage baseline, and `/api/streams` deprecation plan.

## Phase Details

### Phase 0: Foundation
**Goal**: Every cross-cutting primitive that mutating tools need exists, tested, and proves the safety model before any domain handler ships.
**Depends on**: Nothing (entry phase for this milestone)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, FOUND-06, FOUND-07, FOUND-08, FOUND-09, FOUND-10, FOUND-11, FOUND-12, FOUND-13
**Success Criteria** (what must be TRUE):
  1. `src/index.js` no longer routes tools through the `if (name === "...")` chain — a `Map<toolName, handler>` in `src/dispatch.js` handles dispatch, and the server fails to start if any tool in `src/tools.js` lacks a registered handler.
  2. A developer can wrap any new mutating tool with `defineMutatingHandler({ schema, build, apply, summarize })` and the wrapper automatically enforces `dryRun: true` by default, runs zod validation, resolves `connectionName` (with singleton fallback), generates an idempotency key, and emits a `{ preview, request, confirmationToken }` payload with `__SERVER_ASSIGNED__` ID sentinels.
  3. `npm test` runs against `node:test`, the engines floor is `>= 20.6.0` (snapshot tests work), and 5–10 fixture snapshot tests pass locally — proving the dry-run-preview safety contract is byte-comparable in CI.
  4. The existing v2.3 read tools dispatch through the new Map unchanged (no behavior diffs against v7.2), and `list_admin_tools` naming convention `<verb>_<domain>_<noun>` is documented as enforced from this phase forward.
**Plans**: TBD

### Phase 1: Inputs & Extractors
**Goal**: An agent can create, configure, lifecycle, and tear down Graylog inputs and their extractors safely, without ever zeroing an encrypted password through a round-tripped config.
**Depends on**: Phase 0 (uses `defineMutatingHandler`, zod schemas, idempotency dispatch)
**Requirements**: INPUT-01, INPUT-02, INPUT-03, INPUT-04, INPUT-05, INPUT-06, INPUT-07, INPUT-08, INPUT-09, INPUT-10, INPUT-11
**Success Criteria** (what must be TRUE):
  1. An agent can create a GELF input with `dryRun: true`, inspect the would-be POST body, then re-call with `dryRun: false` to apply and receive the assigned input ID + start/stop the input lifecycle from a single tool surface.
  2. An agent can call `update_input` to change an input's port and receive a dry-run payload that contains **only** the changed field — encrypted config fields (TLS cert password, AWS credentials) are absent from the emitted payload regardless of what the agent passed in.
  3. An agent can list inputs filtered by type via `list_input_types` (dynamic discovery against `GET /system/inputs/types/all`) and list extractors per input with the partial-update pattern reused for extractor mutations.
  4. `delete_input` dry-run output enumerates the affected extractors and warns the operator before message-handling impact is applied.
**Plans**: TBD

### Phase 2: Index Sets & Retention
**Goal**: An agent can configure where Graylog stores messages — including rotation/retention strategies — without ever silently destroying Elasticsearch data through a defaulted query parameter.
**Depends on**: Phase 0
**Requirements**: INDEX-01, INDEX-02, INDEX-03, INDEX-04, INDEX-05, INDEX-06, INDEX-07, INDEX-08
**Success Criteria** (what must be TRUE):
  1. `delete_index_set` defaults `deleteIndices` to **false** (inverted from Graylog's server default of true); calling it with `deleteIndices: true` on an index set that contains messages requires a confirmation token echoed back from the dry-run output.
  2. An agent can create a time-based, size-based, or message-count rotated index set bundled with delete/close retention by calling `create_index_set` once, and the dry-run output shows the resolved rotation/retention strategy class + config.
  3. `set_default_index_set` enforces the `regular: true` invariant — calling it against an events-style index set surfaces a clear 409-style error in the dry-run output before any apply is attempted.
  4. `await_system_job` (introduced here as a reusable primitive) lets the agent poll `/system/jobs/{id}` to completion after an async operation like `cycle_deflector` or `delete_index_set?deleteIndices=true` — and the same primitive is available for later phases.
**Plans**: TBD

### Phase 3: Streams & Stream Rules
**Goal**: An agent can route messages into streams and manage the rules that scope them, with the cascade impact of every mutation made visible before the world changes.
**Depends on**: Phase 0, Phase 2 (`create_stream` needs an `index_set_id` to bind to)
**Requirements**: STREAM-01, STREAM-02, STREAM-03, STREAM-04, STREAM-05, STREAM-06, STREAM-07, STREAM-08, STREAM-09, STREAM-10, STREAM-11
**Success Criteria** (what must be TRUE):
  1. An agent can preview a stream-delete and see all cascading rules + pipeline connections + event definitions that reference the stream before applying; if the cascade list grows between dry-run and apply, the apply step refuses with a "world changed since preview" error.
  2. `list_streams` returns each stream's `mutable: boolean` field, so an agent can filter built-in/protected streams out of any candidate-for-deletion set before composing a mutation.
  3. `test_stream_match` accepts a stream config + a sample message and returns per-rule match outcomes — letting the agent verify rule intent without round-tripping a real message through Graylog.
  4. `create_stream` dry-run output includes `existingMatches: [{ id, title, similarity_reason }]` when a stream with a similar title already exists (case-different, prefix match, or exact), eliminating the "list-before-create skipped under context pressure" duplication failure.
**Plans**: TBD

### Phase 4: Pipelines, Pipeline Rules & Connections
**Goal**: An agent can author Graylog pipeline rules from structured intent or raw DSL, with both client-side validation and server-authoritative parse + simulate gating every apply.
**Depends on**: Phase 0, Phase 3 (`connect_pipelines_to_stream` needs stream IDs)
**Requirements**: PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05, PIPE-06, PIPE-07, PIPE-08, PIPE-09, PIPE-10, PIPE-11, PIPE-12
**Success Criteria** (what must be TRUE):
  1. `create_pipeline_rule` accepts either a structured `{when, then}` intent OR a raw DSL source string; in both modes the dry-run output includes the result of a `POST /system/pipelines/rule/parse` server pre-flight, refusing to apply on any ParseException.
  2. `simulate_pipeline_rule` takes a rule source plus a sample message and returns the post-rule message — catching semantic bugs (wrong function name, type-coercion errors, set_field overwrites) that the parser cannot detect.
  3. `list_pipeline_functions` exposes Graylog's built-in function catalogue (cached at connection-init, sourced from `GET /system/pipelines/rule/functions`); the same catalogue powers the client-side `src/pipeline-dsl/validate.js` so emit→validate→parse→simulate is a single composable chain.
  4. `delete_pipeline_rule` dry-run output lists the pipelines that reference the rule, preventing orphaned pipeline-stage references after delete.

**Research notes**: This phase has a **mandatory pre-phase research pass** flagged by `research/SUMMARY.md` — the ~100 Java built-in function classes under `source-code/graylog2-server/.../plugin/pipelineprocessor/functions/` must be enumerated into `src/pipeline-dsl/builtins.js` (name, signature, one-line description) before implementation of PIPE-08 begins. Hand-curated; auto-regeneration is future work.

**Plans**: TBD

### Phase 5: Events & Notifications
**Goal**: An agent can upgrade Graylog's read-only event surface to full CRUD — defining alerts and notifications without accidentally firing them at create-time or saving v6-syntax aggregations that never trigger on v7.
**Depends on**: Phase 0, Phase 3 (event definitions filter on `stream_ids: [...]`)
**Requirements**: EVENT-01, EVENT-02, EVENT-03, EVENT-04, EVENT-05, EVENT-06, EVENT-07, EVENT-08, EVENT-09
**Success Criteria** (what must be TRUE):
  1. `create_event_definition` defaults the `?schedule` query parameter to **false** (inverted from Graylog's server default of true); the dry-run output states `wouldStartScheduling: false` explicitly, and the agent must call `enable_event_definition` separately to activate the alert.
  2. If an agent passes a v6-shape aggregation expression like `count(source)`, the wrapper migrates it to v7's `count_source` and surfaces `{ migrated_from_v6_shape: true, original, emitted }` in the dry-run output — translation is visible, never silent.
  3. `create_event_notification` validates the discriminator string (`email-notification-v1`, `http-notification-v2`, etc.) against a zod discriminated union — invalid notification types fail validation before any HTTP call.
  4. `enable_event_definition` / `disable_event_definition` send an empty body to `PUT /events/definitions/{id}/schedule|unschedule` — handling the `@Consumes(WILDCARD)` quirk so the agent can't waste context constructing a fake body.
**Plans**: TBD
**UI hint**: yes

### Phase 6: Dashboards, Widget Templates & Blueprints
**Goal**: An agent can produce a working monitoring environment — input + stream + pipeline + dashboard + alert — from a single natural-language intent, with every cross-domain composition flowing through the services layer it built up in Phases 1–5.
**Depends on**: Phase 1 (inputs), Phase 2 (index sets), Phase 3 (streams), Phase 4 (pipelines), Phase 5 (events)
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07, DASH-08, BLUE-01, BLUE-02, BLUE-03, BLUE-04, BLUE-05, BLUE-06
**Success Criteria** (what must be TRUE):
  1. `create_dashboard` internally chains `POST /views/search` then `POST /views` — the agent never sees the intermediate Search ID, and widget/position/searchType triplets are generated by `add_widget_from_template` so mismatched sets are structurally impossible.
  2. The blueprint `setup_app_monitoring_stack(app_name, source_pattern)` produces a working stream + pipeline (with starter rules) + dashboard (with 4 starter widgets from the curated library) + error-rate event definition, all reachable in the Graylog UI on apply, with the dry-run output showing the full ordered chain of would-be requests annotated with `dependsOn` references.
  3. The curated widget-template library (DASH-08) ships 8 templates — `error_rate_over_time`, `top_sources_by_volume`, `level_distribution`, `top_error_clusters`, `request_rate_over_time`, `field_value_distribution`, `recent_events_table`, `stream_activity_overview` — and `add_widget_from_template` drops any of them onto an existing dashboard from a single tool call.
  4. All 6 blueprints (BLUE-01 through BLUE-06) compose from `src/services/*` (never from other tool handlers), and their dry-run output is a list of planned requests with explicit `dependsOn` annotations so the agent can reason about each step independently.
**Plans**: TBD
**UI hint**: yes

### Phase 7: Final Hardening
**Goal**: The full ~91-tool admin surface is discoverable, the descriptions don't collapse the agent's tool-selection accuracy, the existing v2.3 read tools still work on Graylog 7.2, and the codebase has a documented coverage baseline.
**Depends on**: Phase 6 (full tool catalogue must exist to audit)
**Requirements**: HARD-01, HARD-02, HARD-03, HARD-04, HARD-05
**Success Criteria** (what must be TRUE):
  1. Every tool in `src/tools.js` has a description ≤200 chars containing a discrimination sentence ("use this vs. the obvious alternative"), and an automated merge-gate check fails any PR that adds a tool description over budget or without a discrimination sentence.
  2. An agent can call `list_admin_tools(domain?)` to receive a brief inventory grouped by domain, avoiding the cost of fitting all ~91 tool descriptions in every system prompt.
  3. All v2.3 read tools (`fetch_graylog_messages`, `get_log_histogram` with each of its 4 fallback strategies individually, `get_event_definitions`, etc.) pass a smoke-test pass against Graylog 7.2 — any v7 breakage encountered is a documented targeted fix, not a refactor.
  4. `c8 node --test` produces a coverage report; the baseline coverage percentage is documented in the milestone-complete artifact, and a follow-up migration plan exists for the deprecated `GET /api/streams` → `GET /api/streams/paginated` path.
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Foundation | 0/? | Not started | - |
| 1. Inputs & Extractors | 0/? | Not started | - |
| 2. Index Sets & Retention | 0/? | Not started | - |
| 3. Streams & Stream Rules | 0/? | Not started | - |
| 4. Pipelines, Pipeline Rules & Connections | 0/? | Not started | - |
| 5. Events & Notifications | 0/? | Not started | - |
| 6. Dashboards, Widget Templates & Blueprints | 0/? | Not started | - |
| 7. Final Hardening | 0/? | Not started | - |

---
*Roadmap created: 2026-05-13*
