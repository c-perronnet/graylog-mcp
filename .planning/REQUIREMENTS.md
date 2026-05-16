# Requirements: Graylog MCP — Full Admin Surface

**Defined:** 2026-05-13
**Core Value:** An AI agent can configure Graylog from intent alone, safely, without touching the web UI.

## v1 Requirements

All requirements for the admin-surface milestone. Categories follow the 8-phase build order from `.planning/research/SUMMARY.md` (Phase 0 foundation, 6 domain phases, Phase 7 hardening). Existing v2.3 read tools are inherited as Validated (see PROJECT.md) and not re-listed here.

### Foundation (FOUND)

Cross-cutting infrastructure that every domain phase depends on. Cannot be folded into Phase 1.

- [x] **FOUND-01**: Dispatch refactor — replace the `if (name === "...")` chain in `src/index.js` with a `Map<toolName, handler>` in `src/dispatch.js`; add a startup assertion that every tool in `src/tools.js` has a registered handler.
- [x] **FOUND-02**: Single Graylog HTTP client at `src/graylog/client.js` with auth, `X-Requested-By` header, and typed error mapping for 400/403/404/409/422 responses.
- [x] **FOUND-03**: `defineMutatingHandler` factory that centralizes `dryRun: true` enforcement and the build/apply split for every mutating tool.
- [x] **FOUND-04**: `runOrPreview` helper that returns a structured preview payload (HTTP method, path, body) with `__SERVER_ASSIGNED__` ID sentinels in dry-run mode.
- [x] **FOUND-05**: Adopt `zod ^3.25.76` (already declared) for input validation; establish the per-domain `schemas.js` co-location pattern.
- [x] **FOUND-06**: Bump `engines.node` to `>= 22.3.0` (or `>= 20.6.0` minimum) so `node:test` `t.snapshot()` is stable; fix the broken `npm test` script.
- [x] **FOUND-07**: Snapshot test infrastructure proven with 5–10 fixture tests before any domain phase begins.
- [x] **FOUND-08**: Cross-cutting response normalizer that returns `{ id, body }` regardless of Graylog's inconsistent create-response shapes (200 DTO vs 201 partial vs 201+Location header).
- [x] **FOUND-09**: Per-call `connectionName` argument with singleton fallback on every mutating tool's zod schema; existing read tools unchanged.
- [x] **FOUND-10**: Idempotency-key mechanism for create tools — auto-generated from `hash(connectionName, toolName, args)`, agent can override.
- [x] **FOUND-11**: Create-conflict pre-check pattern — `existingMatches` field in every create tool's dry-run output.
- [x] **FOUND-12**: List-projection helper with default narrow projection (`id, title, description`) and default `limit: 25` for every list tool.
- [x] **FOUND-13**: Tool-naming convention `<verb>_<domain>_<noun>` documented and enforced from Phase 0 onward.

### Inputs & Extractors (INPUT)

- [x] **INPUT-01**: `list_input_types` — calls `GET /system/inputs/types/all`, returns the dynamic type catalogue
- [x] **INPUT-02**: `list_inputs` — narrow projection by default; full DTO with `expand: true`
- [x] **INPUT-03**: `get_input` — full configuration for a single input
- [x] **INPUT-04**: `create_input` — typed via zod schemas per input type; supports common types (GELF, Beats, Syslog, Raw/Plaintext)
- [x] **INPUT-05**: `update_input` — partial-update only; wrapper fetches current config and merges to avoid zeroing encrypted fields (C3)
- [x] **INPUT-06**: `delete_input` — dry-run preview shows affected extractors and message-handling impact
- [x] **INPUT-07**: `start_input` / `stop_input` — explicit lifecycle control
- [x] **INPUT-08**: `list_extractors` — per-input
- [x] **INPUT-09**: `create_extractor` — supports grok, regex, JSON, key-value, split-and-index, lookup-table extractor types
- [x] **INPUT-10**: `update_extractor` — same partial-update pattern
- [x] **INPUT-11**: `delete_extractor` — explicit, no cascade

### Index Sets & Retention (INDEX)

- [x] **INDEX-01**: `list_index_sets` — narrow projection; flags default and writable status
- [x] **INDEX-02**: `get_index_set` — full DTO with retention/rotation strategies
- [x] **INDEX-03**: `create_index_set` — supports time-based, size-based, and message-count rotation strategies; supports delete/close/archive retention strategies
- [x] **INDEX-04**: `update_index_set` — partial-update pattern
- [x] **INDEX-05**: `delete_index_set` — **`deleteIndices` defaults to `false`** (C1); when `true`, requires confirmation token if index set contains messages; returns async system-job ID
- [x] **INDEX-06**: `set_default_index_set` — enforces `regular: true` invariant
- [x] **INDEX-07**: `cycle_deflector` — manual index rotation
- [x] **INDEX-08**: `await_system_job` — poll `/system/jobs/{id}` for async-operation completion (introduced here, reused later)

### Streams & Stream Rules (STREAM)

- [x] **STREAM-01**: `list_streams` — narrow projection; includes `mutable: boolean` per stream
- [x] **STREAM-02**: `get_stream` — full DTO with rules
- [x] **STREAM-03**: `create_stream` — internal title-conflict check (M5); reports `existingMatches` in dry-run
- [x] **STREAM-04**: `update_stream` — partial-update
- [x] **STREAM-05**: `delete_stream` — pre-delete cascade preview showing rules, pipeline connections, and event definitions that reference this stream (C2)
- [x] **STREAM-06**: `start_stream` / `pause_stream`
- [x] **STREAM-07**: `list_stream_rules`
- [x] **STREAM-08**: `create_stream_rule` — covers all rule types (exact, regex, greater, less, present, contains, always-match)
- [x] **STREAM-09**: `update_stream_rule`
- [x] **STREAM-10**: `delete_stream_rule`
- [x] **STREAM-11**: `test_stream_match` — the agent's rule-validation anchor; given a stream config and a sample message, returns which rules matched

### Pipelines & Pipeline Rules (PIPE)

The DSL subsystem is the hardest part of this milestone.

- [x] **PIPE-01**: `list_pipelines`
- [x] **PIPE-02**: `get_pipeline`
- [x] **PIPE-03**: `create_pipeline` — pipeline source (stage definitions referencing rule names)
- [x] **PIPE-04**: `update_pipeline`
- [x] **PIPE-05**: `delete_pipeline`
- [x] **PIPE-06**: `list_pipeline_rules`
- [x] **PIPE-07**: `get_pipeline_rule`
- [x] **PIPE-08**: `create_pipeline_rule` — accepts structured intent (when/then specs) AND raw DSL source; generates DSL via `src/pipeline-dsl/`; **every dry-run calls `POST /system/pipelines/rule/parse` for server-authoritative validation** (C4)
- [x] **PIPE-09**: `update_pipeline_rule` — same parse pre-flight
- [x] **PIPE-10**: `delete_pipeline_rule` — pre-delete check for pipelines that reference this rule
- [x] **PIPE-11**: `list_pipeline_functions` — exposes the cached Graylog built-in function catalogue; cached at connection-init
- [x] **PIPE-12**: `simulate_pipeline_rule` — non-negotiable (M3); given a rule source and a sample message, returns the post-rule message; catches semantic bugs the parser misses
- [x] **PIPE-13**: `connect_pipelines_to_stream` — attach one or more pipelines to a stream; added 2026-05-15 per Phase 4 CONTEXT.md D-01 (roadmap dependency on Phase 3 stream IDs)
- [x] **PIPE-14**: `disconnect_pipelines_from_stream` — detach pipelines from a stream; added 2026-05-15 per Phase 4 CONTEXT.md D-01

**DSL subsystem requirements** (cross-cutting under PIPE-08):
- `src/pipeline-dsl/emit.js` — tagged-template helpers that compose `when…then…` rule source from structured intent
- `src/pipeline-dsl/escape.js` — string-literal escape for rule source
- `src/pipeline-dsl/builtins.js` — hand-curated catalogue of ~100 Graylog built-in functions with signature and one-line description, sourced from `pipelineprocessor/functions/`
- `src/pipeline-dsl/validate.js` — structural validation (paren balance, function-name existence in `builtins.js`, basic type-shape checks) before server round-trip

### Events & Notifications (EVENT)

Currently read-only in v2.3; this milestone makes them full CRUD.

- [x] **EVENT-01**: `list_event_definitions` — narrow projection
- [x] **EVENT-02**: `get_event_definition`
- [x] **EVENT-03**: `create_event_definition` — **`schedule` defaults to `false`** (not Graylog's `true`); v7 aggregation syntax only; helper warns if input matches v6 syntax (C5)
- [x] **EVENT-04**: `update_event_definition`
- [ ] **EVENT-05**: `delete_event_definition`
- [ ] **EVENT-06**: `enable_event_definition` / `disable_event_definition` — wrapper handles the `WILDCARD` empty-body quirk
- [ ] **EVENT-07**: `list_event_notifications`
- [ ] **EVENT-08**: `create_event_notification` — discriminated-union zod schemas per notification type (email, HTTP, Slack, PagerDuty, etc.)
- [ ] **EVENT-09**: `update_event_notification` / `delete_event_notification`

### Dashboards & Widget Templates (DASH)

Dashboards + 6 blueprints land in the same phase per ARCHITECTURE.md.

- [ ] **DASH-01**: `list_dashboards`
- [ ] **DASH-02**: `get_dashboard` — includes widget layout
- [ ] **DASH-03**: `create_dashboard` — **internally chains `POST /views/search` then `POST /views`** so the agent never sees the intermediate Search ID (C7)
- [ ] **DASH-04**: `update_dashboard`
- [ ] **DASH-05**: `delete_dashboard`
- [ ] **DASH-06**: `add_widget_from_template` — drops a widget from the curated template library onto an existing dashboard; widget/position/searchType triplet generation is internal so mismatches are structurally impossible
- [ ] **DASH-07**: `remove_widget` — explicit widget removal
- [ ] **DASH-08**: Curated widget-template library (8 templates):
  - `error_rate_over_time` (histogram, level>=4)
  - `top_sources_by_volume` (field aggregation, count by source)
  - `level_distribution` (pie/donut, count by level)
  - `top_error_clusters` (data table from cluster_log_messages output)
  - `request_rate_over_time` (histogram, configurable filter)
  - `field_value_distribution` (configurable field aggregation)
  - `recent_events_table` (message table, configurable filter)
  - `stream_activity_overview` (per-stream count over time)

### Blueprints (BLUE)

Composed entirely from services layers built in earlier phases. Compose at the service level, never call other handlers directly.

- [ ] **BLUE-01**: `setup_app_monitoring_stack(app_name, source_pattern)` — creates input → stream (matching source_pattern) → pipeline + 1–2 starter rules → dashboard with 4 default widgets. **Headline use-case and the milestone's E2E integration test.**
- [ ] **BLUE-02**: `setup_error_alerting(stream_id, notification_target)` — creates event definition + connects to existing notification
- [ ] **BLUE-03**: `create_app_health_dashboard(stream_id)` — dashboard with the 4 most informative widgets pre-wired to a stream
- [ ] **BLUE-04**: `setup_pipeline_for_stream(stream_id, transforms)` — pipeline + rule(s) + connection in one call from structured intent
- [ ] **BLUE-05**: `setup_long_term_archival_index(name, retention_days)` — index set with rotation + delete-retention strategy bundled
- [ ] **BLUE-06**: `setup_debug_log_dropping(stream_id, min_level)` — pipeline rule that drops sub-threshold messages; connection wired automatically

### Final Hardening (HARD)

- [ ] **HARD-01**: Tool-description audit — every tool ≤200 chars with a clear discrimination sentence; automated check as merge gate
- [ ] **HARD-02**: `list_admin_tools(domain?)` meta-tool for agent discoverability across the ~91-tool surface (M7)
- [ ] **HARD-03**: v7-vs-v6 read-tool smoke-test pass — confirm existing v2.3 tools still work against Graylog 7.2 (`GET /api/streams` deprecation, histogram fallback chain, event-definition list path)
- [ ] **HARD-04**: c8 coverage report integrated; document baseline coverage % at milestone end
- [ ] **HARD-05**: Document `/api/streams` deprecation; plan migration to `/api/streams/paginated` for a follow-up milestone

## v2 Requirements

Deferred. Acknowledged but not in this milestone's roadmap.

### Lookup Tables (LOOKUP)

- **LOOKUP-01**: CRUD for lookup tables
- **LOOKUP-02**: CRUD for data adapters
- **LOOKUP-03**: CRUD for caches

### Identity & Access Management (IAM)

- **IAM-01**: User CRUD
- **IAM-02**: Role CRUD
- **IAM-03**: API token CRUD (per user)
- **IAM-04**: Permission inspection tools

### Content Packs (PACK)

- **PACK-01**: Content pack CRUD
- **PACK-02**: Content pack install/uninstall
- **PACK-03**: Export current config as a content pack

### Sidecar & Collector Management (SIDE)

- **SIDE-01**: Sidecar CRUD
- **SIDE-02**: Collector configuration CRUD
- **SIDE-03**: Sidecar-to-collector assignment

### Arbitrary Widget Construction (WIDGET)

- **WIDGET-01**: `create_widget` accepting an arbitrary search-type spec (not from the curated library)
- **WIDGET-02**: Custom widget templates (user-defined and persisted, mirror of saved searches pattern)

### Multi-version Compatibility (COMPAT)

- **COMPAT-01**: Support Graylog 6.x admin endpoints alongside 7.x
- **COMPAT-02**: Auto-detect connected Graylog version and switch endpoint shapes

## Out of Scope

Explicit exclusions for this milestone. Documented to prevent re-adding mid-milestone.

| Feature | Reason |
|---------|--------|
| Lookup tables / data adapters / caches | User did not select this domain; deferred to v2 (see LOOKUP) |
| User / role / API token management | High-risk surface explicitly excluded from this milestone's threat model; deferred to v2 (see IAM) |
| Content packs | Distinct bundling subsystem; deferred to v2 (see PACK) |
| Sidecar / collector management | Fleet-side, not server-side admin; deferred to v2 (see SIDE) |
| Multi-version compatibility (4.x / 5.x / 6.x) | Locked to Graylog 7.2 this milestone to keep the test surface bounded |
| Arbitrary widget construction (free-form search spec → widget) | Only curated widget templates this milestone; arbitrary construction is its own subsystem |
| Backward-compat refactors of existing v2.3 read tools | HARD-03 verifies-against-v7 only; any breakage becomes a targeted fix, not a refactor |
| User-editable blueprint library | Blueprints ship in source this milestone; user-defined blueprints (saved-search-style persistence) deferred |
| Adopting zod v4 | Pinned to v3 `^3.25.76` — MCP SDK uses v3; avoid dual-major-in-tree |
| Real-time pipeline-rule auto-completion in tool descriptions | `list_pipeline_functions` covers this — no inline completion UX |

## Traceability

Populated by the roadmapper on 2026-05-13. Every v1 requirement maps to exactly one phase.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 0 | Complete |
| FOUND-02 | Phase 0 | Complete |
| FOUND-03 | Phase 0 | Complete |
| FOUND-04 | Phase 0 | Complete |
| FOUND-05 | Phase 0 | Complete |
| FOUND-06 | Phase 0 | Complete |
| FOUND-07 | Phase 0 | Complete |
| FOUND-08 | Phase 0 | Complete |
| FOUND-09 | Phase 0 | Complete |
| FOUND-10 | Phase 0 | Complete |
| FOUND-11 | Phase 0 | Complete |
| FOUND-12 | Phase 0 | Complete |
| FOUND-13 | Phase 0 | Complete |
| INPUT-01 | Phase 1 | Complete |
| INPUT-02 | Phase 1 | Complete |
| INPUT-03 | Phase 1 | Complete |
| INPUT-04 | Phase 1 | Complete |
| INPUT-05 | Phase 1 | Complete |
| INPUT-06 | Phase 1 | Complete |
| INPUT-07 | Phase 1 | Complete |
| INPUT-08 | Phase 1 | Complete |
| INPUT-09 | Phase 1 | Complete |
| INPUT-10 | Phase 1 | Complete |
| INPUT-11 | Phase 1 | Complete |
| INDEX-01 | Phase 2 | Complete |
| INDEX-02 | Phase 2 | Complete |
| INDEX-03 | Phase 2 | Complete |
| INDEX-04 | Phase 2 | Complete |
| INDEX-05 | Phase 2 | Complete |
| INDEX-06 | Phase 2 | Complete |
| INDEX-07 | Phase 2 | Complete |
| INDEX-08 | Phase 2 | Complete |
| STREAM-01 | Phase 3 | Complete |
| STREAM-02 | Phase 3 | Complete |
| STREAM-03 | Phase 3 | Complete |
| STREAM-04 | Phase 3 | Complete |
| STREAM-05 | Phase 3 | Complete |
| STREAM-06 | Phase 3 | Complete |
| STREAM-07 | Phase 3 | Complete |
| STREAM-08 | Phase 3 | Complete |
| STREAM-09 | Phase 3 | Complete |
| STREAM-10 | Phase 3 | Complete |
| STREAM-11 | Phase 3 | Complete |
| PIPE-01 | Phase 4 | Complete |
| PIPE-02 | Phase 4 | Complete |
| PIPE-03 | Phase 4 | Complete |
| PIPE-04 | Phase 4 | Complete |
| PIPE-05 | Phase 4 | Complete |
| PIPE-06 | Phase 4 | Complete |
| PIPE-07 | Phase 4 | Complete |
| PIPE-08 | Phase 4 | Complete |
| PIPE-09 | Phase 4 | Complete |
| PIPE-10 | Phase 4 | Complete |
| PIPE-11 | Phase 4 | Complete |
| PIPE-12 | Phase 4 | Complete |
| PIPE-13 | Phase 4 | Complete |
| PIPE-14 | Phase 4 | Complete |
| EVENT-01 | Phase 5 | Complete |
| EVENT-02 | Phase 5 | Complete |
| EVENT-03 | Phase 5 | Complete |
| EVENT-04 | Phase 5 | Complete |
| EVENT-05 | Phase 5 | Pending |
| EVENT-06 | Phase 5 | Pending |
| EVENT-07 | Phase 5 | Pending |
| EVENT-08 | Phase 5 | Pending |
| EVENT-09 | Phase 5 | Pending |
| DASH-01 | Phase 6 | Pending |
| DASH-02 | Phase 6 | Pending |
| DASH-03 | Phase 6 | Pending |
| DASH-04 | Phase 6 | Pending |
| DASH-05 | Phase 6 | Pending |
| DASH-06 | Phase 6 | Pending |
| DASH-07 | Phase 6 | Pending |
| DASH-08 | Phase 6 | Pending |
| BLUE-01 | Phase 6 | Pending |
| BLUE-02 | Phase 6 | Pending |
| BLUE-03 | Phase 6 | Pending |
| BLUE-04 | Phase 6 | Pending |
| BLUE-05 | Phase 6 | Pending |
| BLUE-06 | Phase 6 | Pending |
| HARD-01 | Phase 7 | Pending |
| HARD-02 | Phase 7 | Pending |
| HARD-03 | Phase 7 | Pending |
| HARD-04 | Phase 7 | Pending |
| HARD-05 | Phase 7 | Pending |

**Coverage:**
- v1 requirements: 71 total (13 FOUND + 11 INPUT + 8 INDEX + 11 STREAM + 12 PIPE + 9 EVENT + 8 DASH + 6 BLUE + 5 HARD; widget-template list under DASH-08 counted as one)
- Mapped to phases: 71
- Unmapped: 0

---
*Requirements defined: 2026-05-13*
*Last updated: 2026-05-13 after roadmap creation (traceability populated)*
