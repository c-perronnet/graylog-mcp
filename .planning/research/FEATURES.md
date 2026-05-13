# Feature Landscape — Graylog Admin Surface MCP

**Domain:** AI-driven Graylog 7.2 administration (streams, pipelines, dashboards, inputs, indices, events) via MCP
**Researched:** 2026-05-13
**Source authority:** Java REST resource classes in `source-code/graylog2-server/graylog2-server/src/main/java/.../rest/resources/` (HIGH confidence — direct source)

## Scope Recap (from PROJECT.md)

This milestone is **additive** on top of v2.3's ~25 read/analyze tools. It adds the **write/configure half**. Two layers per domain:

1. **CRUD primitives** — minimum surface needed for unanticipated workflows
2. **Blueprints** — curated multi-call bundles for common bootstrap intents

Decision locked from PROJECT.md:
- Agent generates pipeline-rule DSL (with client-side helpers/validators)
- Dashboard widgets via **curated templates only**, not arbitrary widget construction
- Every mutating tool defaults to `dryRun: true`
- All admin tools live under `src/tools/<domain>/` (extracted, not inline)

## Tool Count Budget

Total proposed: **~58 admin tools** across 6 domains + **6 blueprints** = ~64.

| Domain | Primitives | Helpers / Discovery | Sub-total |
|--------|------------|---------------------|-----------|
| Streams + rules | 10 | 1 | 11 |
| Pipelines + rules + connections | 9 | 3 | 12 |
| Dashboards + widget templates | 5 | 2 | 7 |
| Inputs + extractors | 9 | 2 | 11 |
| Indices + retention | 6 | 2 | 8 |
| Events + notifications | 8 | 1 | 9 |
| Blueprints | — | — | 6 |
| **Total** | **47** | **11** | **64** |

Each domain stays at or under the ~12-tool ceiling. Pipelines hits 12 exactly — flagged for re-scope review during requirements (the `validate_rule_dsl` helper could be folded into `parse` if needed).

---

## Domain 1 — Streams + Stream Rules

**Authoritative REST sources:**
- `graylog2-server/src/main/java/org/graylog2/rest/resources/streams/StreamResource.java` — `/streams` CRUD, pause/resume, testMatch, clone, indexSet move
- `graylog2-server/src/main/java/org/graylog2/rest/resources/streams/rules/StreamRuleResource.java` — `/streams/{id}/rules` CRUD + `/types` discovery
- `graylog2-server/src/main/java/org/graylog2/plugin/streams/StreamRuleType.java` — 8 rule types: EXACT, REGEX, GREATER, SMALLER, PRESENCE, CONTAINS, ALWAYS_MATCH, MATCH_INPUT

**Table stakes (10 tools):**

| Tool | Description | Maps to |
|------|-------------|---------|
| `create_stream` | Create stream with title, description, matching_type (AND/OR), index_set_id, remove_matches_from_default_stream | POST /streams |
| `get_stream` | Fetch single stream by ID (rules, output assignments, alert conditions) | GET /streams/{id} |
| `update_stream` | Update stream metadata (title, description, matching_type, remove_matches_from_default_stream) | PUT /streams/{id} |
| `delete_stream` | Delete a stream | DELETE /streams/{id} |
| `pause_stream` | Pause stream message routing | POST /streams/{id}/pause |
| `resume_stream` | Resume stream message routing | POST /streams/{id}/resume |
| `add_stream_rule` | Add rule (field, value, type, inverted, description) — type enum: EXACT/REGEX/GREATER/SMALLER/PRESENCE/CONTAINS/ALWAYS_MATCH/MATCH_INPUT | POST /streams/{id}/rules |
| `update_stream_rule` | Update a rule on a stream | PUT /streams/{id}/rules/{ruleId} |
| `delete_stream_rule` | Delete a rule from a stream | DELETE /streams/{id}/rules/{ruleId} |
| `test_stream_match` | Dry-test message against stream rules (returns matches: true/false, rules: per-rule outcome) | POST /streams/{id}/testMatch |

**Differentiator (1 tool):**

| Tool | Description | Maps to |
|------|-------------|---------|
| `move_stream_index_set` | Re-assign stream to different index set (operational migration helper) | PUT /streams/indexSet/{indexSetId} |

`list_streams` already exists (v2.3) — do not duplicate. `test_stream_match` is the agent's reliability anchor: lets the agent verify rule intent before applying.

**Anti-features in this domain:**
- `clone_stream` — convenience the agent can fake via get+create; skip in v1
- Bulk pause/resume/delete — agent can loop over the primitives
- Stream outputs management (POST /streams/{id}/outputs) — deprecated subsystem in Graylog 7, events/notifications replace it
- Stream alert conditions (legacy alerting V1) — superseded by Event Definitions

**Dependencies:**
- `add_stream_rule` requires `stream_id` from `create_stream`
- `test_stream_match` requires `stream_id` and (logically) rules added first

---

## Domain 2 — Pipelines + Pipeline Rules + Connections

**Authoritative REST sources:**
- `graylog2-server/src/main/java/org/graylog/plugins/pipelineprocessor/rest/PipelineResource.java` — `/system/pipelines/pipeline` CRUD + `/parse`
- `graylog2-server/src/main/java/org/graylog/plugins/pipelineprocessor/rest/RuleResource.java` — `/system/pipelines/rule` CRUD + `/parse` + `/simulate` + `/functions`
- `graylog2-server/src/main/java/org/graylog/plugins/pipelineprocessor/rest/PipelineConnectionsResource.java` — `/system/pipelines/connections/to_stream` and `/to_pipeline`
- `graylog2-server/src/main/java/org/graylog/plugins/pipelineprocessor/rest/SimulatorResource.java` — `/system/pipelines/simulate` (run a sample message through all attached pipelines)

**Decision (PROJECT.md):** agent emits `when … then …` rule source. Helpers validate, parse, and surface available functions. We are NOT building a structured-rule-builder UI; we're making the agent's DSL output reliable.

**Table stakes — primitives (8 tools):**

| Tool | Description | Maps to |
|------|-------------|---------|
| `create_pipeline` | Create pipeline (title, description, source = full pipeline DSL with stages and rule refs) | POST /system/pipelines/pipeline |
| `get_pipeline` | Fetch pipeline (parsed structure + source) | GET /system/pipelines/pipeline/{id} |
| `update_pipeline` | Replace pipeline source | PUT /system/pipelines/pipeline/{id} |
| `delete_pipeline` | Delete pipeline | DELETE /system/pipelines/pipeline/{id} |
| `create_pipeline_rule` | Create a standalone rule (title, description, source = `rule "name" when ... then ... end`) | POST /system/pipelines/rule |
| `update_pipeline_rule` | Update rule source | PUT /system/pipelines/rule/{id} |
| `delete_pipeline_rule` | Delete pipeline rule | DELETE /system/pipelines/rule/{id} |
| `connect_pipelines_to_stream` | Attach a list of pipeline IDs to a stream | POST /system/pipelines/connections/to_stream |

**Table stakes — DSL helpers (3 tools — the leverage point):**

| Tool | Description | Maps to |
|------|-------------|---------|
| `parse_pipeline_rule` | Validate rule source against Graylog grammar — returns parse errors/AST. Agent calls this **before** create/update. | POST /system/pipelines/rule/parse |
| `simulate_pipeline_rule` | Run a sample message through a rule's `when` and `then` clauses, return resulting message. Catches "compiles but does the wrong thing" bugs. | POST /system/pipelines/rule/simulate |
| `list_pipeline_functions` | List all available pipeline functions (name, signature, description) so the agent knows what's callable. Cached; surfaces `lookup()`, `to_string()`, `regex()`, `grok()`, etc. | GET /system/pipelines/rule/functions |

**Differentiator (1 tool):**

| Tool | Description | Maps to |
|------|-------------|---------|
| `list_pipeline_connections` | Show which pipelines are attached to which streams (audit/debug) | GET /system/pipelines/connections (and per-stream variant) |

**Anti-features:**
- `parse_pipeline_source` (POST /pipeline/parse) — only useful if we expose pipeline-source preview separately from create; skip, fold into `create_pipeline` validation step
- RuleBuilder API (`/system/pipelines/rule/rulebuilder/...`) — Graylog's UI-driven structured rule builder. PROJECT.md locks: agent writes DSL. Skip.
- `connect_pipelines_to_pipeline` (POST /to_pipeline) — pipeline-to-pipeline chaining is a niche feature; not in MVP
- `/rule/multiple` bulk fetch — agent can map over `get_pipeline_rule`
- Deprecated-functions endpoint — diagnostic; defer

**Quality flag — this domain is at the 12-tool ceiling.** If we trim, fold `simulate_pipeline_rule` into a `dryRun` mode of create_pipeline_rule. Recommended: keep all three helpers — they're the spec'd differentiator from PROJECT.md ("rule-DSL generation helpers / validators (not just pass-through strings)").

**Dependencies:**
- `parse_pipeline_rule` must succeed before `create_pipeline_rule` / `update_pipeline_rule` (the tool should *call* parse as an internal precondition, not just expose it)
- `create_pipeline` references rule IDs in its source — needs rules created first OR the pipeline source declares them by name and Graylog resolves
- `connect_pipelines_to_stream` requires `pipeline_id` from `create_pipeline` and `stream_id` from `create_stream`

---

## Domain 3 — Dashboards + Curated Widget Templates

**Authoritative REST sources:**
- `graylog2-server/src/main/java/org/graylog/plugins/views/search/rest/ViewsResource.java` — `/views` CRUD (the actual create/update path for dashboards in modern Graylog)
- `graylog2-server/src/main/java/org/graylog/plugins/views/search/rest/DashboardsResource.java` — `/dashboards` LIST-only (filtered view of `views` where `type=DASHBOARD`)
- `graylog2-server/src/main/java/org/graylog/plugins/views/search/views/WidgetDTO.java` — Widget shape: `id`, `type` (string discriminator), `config` (`WidgetConfigDTO`), `query`, `timerange`, `streams`
- Widget config types live under `graylog/plugins/views/search/views/widgets/`: `aggregation/`, `events/`, `messagelist/`, `text/`

**Decision (PROJECT.md):** "curated widget templates this milestone, only ~6-10 items". Agent picks a template + parameters; the template emits a fully-formed `WidgetDTO`.

**Table stakes — dashboard CRUD (4 tools):**

| Tool | Description | Maps to |
|------|-------------|---------|
| `create_dashboard` | Create dashboard (title, description, summary, optional initial widgets list) — produces a `ViewDTO` with `type=DASHBOARD` | POST /views |
| `get_dashboard` | Fetch dashboard incl. widgets, queries, time ranges | GET /views/{id} |
| `update_dashboard` | Update dashboard (title, description, layout, widgets list) | PUT /views/{id} |
| `delete_dashboard` | Delete dashboard | DELETE /views/{id} |

`list_dashboards` is read-side; v2.3 doesn't have it but adding it is small enough — call it a sub-table-stake of CRUD. Add as 5th tool:

| `list_dashboards` | List dashboards (paginated) | GET /dashboards |

**Table stakes — widget templates (2 tools, ONE curated library):**

| Tool | Description |
|------|-------------|
| `list_widget_templates` | Return the curated widget-template catalog (name, description, parameters schema). Agent reads this to know what's available. |
| `add_widget_from_template` | Materialize a template into a dashboard. Inputs: `dashboard_id`, `template_name`, `params` (depends on template — see below). Internally calls `update_dashboard` with the new widget appended to the widgets list. |

**Curated widget template library (~8 templates, the "80% coverage" set):**

Each template produces a `WidgetDTO` with the right `type` and `config`. Categorized by widget type from `views/widgets/`:

| Template ID | Output Widget Type | Params | What it shows |
|-------------|-------------------|--------|---------------|
| `message_list` | `messagelist` | query, time_range, streams, fields, sort | Raw message tail filtered by query/stream |
| `error_rate_over_time` | `aggregation` (timeseries) | streams, time_range, interval | Time-series count of messages with `level <= 3` (or query override) |
| `message_count_over_time` | `aggregation` (timeseries) | query, streams, time_range, interval | Generic time-series count (any query) |
| `top_sources_by_count` | `aggregation` (pivot, sorted) | streams, time_range, limit | Top N `source` values by message count |
| `top_field_values` | `aggregation` (pivot, sorted) | field, streams, time_range, limit | Top N values for any field (e.g. `top_field_values(field="status_code")`) |
| `level_distribution` | `aggregation` (pivot, pie/bar) | streams, time_range | Syslog level breakdown (0–7 buckets) |
| `event_list` | `events` | event_definition_ids, time_range | Recent alert events from chosen event definitions |
| `text_panel` | `text` | markdown | Static markdown caption / runbook link |

Eight items. Inside the 6–10 quality-gate band. Covers `aggregation` (5), `messagelist` (1), `events` (1), `text` (1) — every widget type Graylog ships.

**Anti-features:**
- Arbitrary `add_widget` taking a raw widget spec — explicitly locked out in PROJECT.md
- Widget layout / position editing — the dashboard layout (`positions`) is auto-flowed in v1; agent doesn't position widgets pixel-by-pixel
- Dashboard duplication / set-as-default — defer
- Saving widgets to a reusable catalog — that's an enhancement of saved_searches; not this milestone
- Multi-query dashboards (queries tab) — single-query dashboards only in v1
- `DashboardsResource` write endpoints — there are none; CRUD is via `/views`. (Verifies decision.)

**Dependencies:**
- `add_widget_from_template` requires `dashboard_id` from `create_dashboard`
- Some templates (`event_list`) require `event_definition_ids` — depends on Domain 6 (`create_event_definition`)
- Stream-scoped templates take optional `streams` — depend on Domain 1 if the agent wants to scope a widget

---

## Domain 4 — Inputs + Extractors

**Authoritative REST sources:**
- `graylog2-server/src/main/java/org/graylog2/rest/resources/system/inputs/InputsResource.java` — `/system/inputs` CRUD
- `graylog2-server/src/main/java/org/graylog2/rest/resources/system/inputs/InputStatesResource.java` — `/system/inputstates` start/stop
- `graylog2-server/src/main/java/org/graylog2/rest/resources/system/inputs/ExtractorsResource.java` — `/system/inputs/{inputId}/extractors` CRUD
- Extractor types from `graylog2-server/src/main/java/org/graylog2/plugin/inputs/Extractor.java`: SUBSTRING, REGEX, REGEX_REPLACE, SPLIT_AND_INDEX, COPY_INPUT, GROK, JSON
- Concrete input types discovered under `org/graylog2/inputs/{gelf,syslog,beats,raw}/{tcp,udp,http,kafka,amqp}/`, plus `org/graylog/inputs/otel/`

**Table stakes — inputs (6 tools):**

| Tool | Description | Maps to |
|------|-------------|---------|
| `list_input_types` | List installed input types with required/optional config fields (e.g. `bind_address`, `port`, `tls_enable`) — agent reads this to know what to create | GET /system/inputs/types/all (canonical endpoint) |
| `create_input` | Create input (type, title, global, configuration map, node) | POST /system/inputs |
| `get_input` | Fetch input incl. config | GET /system/inputs/{inputId} |
| `update_input` | Update input config | PUT /system/inputs/{inputId} |
| `delete_input` | Delete input | DELETE /system/inputs/{inputId} |
| `set_input_state` | Start or stop input (`state`: STARTING/STOPPED) — combines /inputstates start + stop | PUT /system/inputstates/{inputId} |

**Input types — table stakes vs nice-to-have:**

The MCP doesn't enumerate "supported" input types — `list_input_types` is dynamic. But for blueprint targeting and documentation:

**Table stakes (the agent should reliably create these):**
- GELF UDP / TCP / HTTP — Graylog-native format, most common modern intake
- Syslog UDP / TCP — legacy/standard intake
- Beats — Elastic Beats agents (Filebeat, etc.)
- Raw/Plaintext UDP / TCP — fallback for unstructured

**Nice-to-have (works via generic CRUD, but no special blueprint coverage):**
- Kafka / AMQP variants — message-bus intake, niche
- OTel gRPC / HTTP — OpenTelemetry, newer, less ubiquitous
- AWS CloudTrail / IPFIX / NetFlow / Palo Alto — vendor-specific

**Anti-feature:**
- `FakeHttpMessageInput` — synthetic test input; agent should not create these in real deployments
- Diagnostics / references endpoints — read-only, not needed in admin write path
- Input routing-rules helper endpoints (`/routing_rules/pipeline/{inputId}`) — these *read* pipeline/stream linkage; addressable via the pipeline-connections tools

**Table stakes — extractors (3 tools):**

| Tool | Description | Maps to |
|------|-------------|---------|
| `create_extractor` | Create extractor on an input (type, source_field, target_field, extractor_config, condition_type, condition_value, order) — types: SUBSTRING, REGEX, REGEX_REPLACE, SPLIT_AND_INDEX, COPY_INPUT, GROK, JSON | POST /system/inputs/{inputId}/extractors |
| `update_extractor` | Update extractor | PUT /system/inputs/{inputId}/extractors/{extractorId} |
| `delete_extractor` | Delete extractor | DELETE /system/inputs/{inputId}/extractors/{extractorId} |

**Differentiator (2 tools — extractor ergonomics):**

| Tool | Description | Maps to |
|------|-------------|---------|
| `list_grok_patterns` | List installed Grok patterns by name. Agent uses these as building blocks in GROK extractors. | GET /system/grok |
| `test_extractor` | Optional helper — preview an extractor against a sample message string. (Not all extractor types have a server-side preview endpoint; for v1 we may implement client-side preview for REGEX/JSON only and skip for SUBSTRING/COPY_INPUT.) Flag as "see requirements phase for feasibility" | — |

If `test_extractor` is infeasible, drop it — the count is still fine. Recommend keeping it gated on Graylog endpoint availability.

**Dependencies:**
- All extractor tools require `input_id` from `create_input`
- `set_input_state` requires `input_id`
- `create_extractor` benefits from `list_grok_patterns` (for GROK type) and `list_input_types` (to know source-field names)

**Anti-features for extractors:**
- Extractor order management (`POST /extractors/order`) — niche reordering UI; agent can include `order` field in create
- Extractor metrics endpoints — read-side only
- Static fields management (`StaticFieldsResource`) — adds a constant field to every message from an input; deprecated pattern, prefer pipelines for new setups

---

## Domain 5 — Indices + Retention

**Authoritative REST sources:**
- `graylog2-server/src/main/java/org/graylog2/rest/resources/system/indexer/IndexSetsResource.java` — `/system/indices/index_sets` CRUD + stats + set-default
- `graylog2-server/src/main/java/org/graylog2/rest/resources/system/indices/RotationStrategyResource.java` — `/system/indices/rotation/strategies` (discovery only — strategies are config-time, not CRUD)
- `graylog2-server/src/main/java/org/graylog2/rest/resources/system/indices/RetentionStrategyResource.java` — `/system/indices/retention/strategies` (discovery only)
- Rotation strategy configs: `TimeBasedRotationStrategyConfig`, `SizeBasedRotationStrategyConfig`, `MessageCountRotationStrategyConfig`
- Retention strategy configs: `DeletionRetentionStrategyConfig`, `ClosingRetentionStrategyConfig`, `NoopRetentionStrategyConfig` (and Archive — Enterprise-only, defer)

**Table stakes — index set CRUD (6 tools):**

| Tool | Description | Maps to |
|------|-------------|---------|
| `create_index_set` | Create index set with title, index_prefix, shards, replicas, rotation_strategy_class + config, retention_strategy_class + config, index_analyzer, field_type_refresh_interval | POST /system/indices/index_sets |
| `list_index_sets` | List all index sets (paginated; not present in v2.3) | GET /system/indices/index_sets |
| `get_index_set` | Fetch single index set incl. current rotation/retention config | GET /system/indices/index_sets/{id} |
| `update_index_set` | Update an index set's title, retention/rotation strategy, shards, replicas | PUT /system/indices/index_sets/{id} |
| `delete_index_set` | Delete index set (with `delete_indices` boolean) | DELETE /system/indices/index_sets/{id} |
| `set_default_index_set` | Mark an index set as the default | PUT /system/indices/index_sets/{id}/default |

**Table stakes — discovery (2 tools):**

| Tool | Description | Maps to |
|------|-------------|---------|
| `list_rotation_strategies` | Enumerate available rotation strategies (TimeBased, SizeBased, MessageCount) + their config schemas. Agent reads this to know parameter shapes. | GET /system/indices/rotation/strategies |
| `list_retention_strategies` | Enumerate available retention strategies (Deletion, Closing, Noop, optionally Archive) + their config schemas | GET /system/indices/retention/strategies |

**Table-stakes strategy combos:**

| Combo | When |
|-------|------|
| TimeBased rotation + Deletion retention | Most common; "rotate daily, keep 30 days" |
| SizeBased rotation + Deletion retention | Bounded disk; "rotate at 50GB, keep last 5" |
| MessageCount rotation + Deletion retention | Bounded count; useful for high-volume narrow streams |

**Anti-features:**
- Index-set search endpoint (`/index_sets/search`) — convenience over list+filter; defer
- Index-level operations (open/close/reopen single indices via `IndicesResource`) — operational, not configuration; not the agent's job in this milestone
- Index field-type mapping management (`IndexSetsMappingResource`, `IndexFieldTypeProfileResource`) — advanced, niche
- Index set templates (`IndexSetTemplateResource`, `IndexTemplatesResource`) — meta-config layer; defer to follow-up
- Index-set defaults inspector (`IndexSetDefaultsResource`) — read-only, niche
- Archive retention (`/system/indices/retention/strategies/...archive...`) — Graylog Enterprise feature; flag in requirements but don't include in v1

**Dependencies:**
- `create_index_set` is referenced by `create_stream`'s `index_set_id` — index set must exist first when bootstrapping a fresh stack
- `list_rotation_strategies` + `list_retention_strategies` must be callable before `create_index_set` so the agent picks valid `*_strategy_class` strings

---

## Domain 6 — Event Definitions + Notifications

**Authoritative REST sources:**
- `graylog2-server/src/main/java/org/graylog/events/rest/EventDefinitionsResource.java` — `/events/definitions` CRUD + validate + duplicate + schedule
- `graylog2-server/src/main/java/org/graylog/events/rest/EventNotificationsResource.java` — `/events/notifications` CRUD + test
- Notification types from `graylog/events/notifications/types/`: Email (`EmailEventNotificationConfig`), HTTP (`HTTPEventNotificationConfig`, `HTTPEventNotificationConfigV2`). Plugins (Slack, PagerDuty, MS Teams) live in `org.graylog.integrations.notifications` and are *plugin-conditional*.
- Event-processor types from `graylog/events/processor/`: `aggregation` (aggregation event definition), `systemnotification` (system events). Correlation is a Graylog Enterprise feature — flag as not-table-stakes.

**Context:** v2.3 already has read-side `get_event_definitions` and `get_event_notifications` (per INTEGRATIONS.md). This milestone makes them full CRUD. The existing read tools are kept as-is per PROJECT.md anti-feature ("Backward-compat changes to existing read tools").

**Table stakes — event definitions (4 tools):**

| Tool | Description | Maps to |
|------|-------------|---------|
| `create_event_definition` | Create event definition (title, description, priority, config = aggregation processor config: query, streams, search_within_ms, execute_every_ms, group_by fields, series + conditions, notifications list, alert: bool) | POST /events/definitions |
| `get_event_definition` | Fetch single (v2.3 list-only, this fills the gap) | GET /events/definitions/{id} |
| `update_event_definition` | Update an event definition | PUT /events/definitions/{id} |
| `delete_event_definition` | Delete an event definition | DELETE /events/definitions/{id} |

**Table stakes — schedule/notification ops (2 tools):**

| Tool | Description | Maps to |
|------|-------------|---------|
| `schedule_event_definition` | Activate (schedule) or pause (unschedule) an event definition. Combines `/schedule` and `/unschedule` PUT endpoints behind one `enabled: boolean` param. | PUT /events/definitions/{id}/schedule, PUT .../unschedule |
| `validate_event_definition` | Validate config before create/update (catches bad cron, bad queries) | POST /events/definitions/validate |

**Table stakes — notifications (3 tools):**

| Tool | Description | Maps to |
|------|-------------|---------|
| `create_event_notification` | Create notification (title, config: `type` discriminator = `email-notification-v1` \| `http-notification-v1` \| `http-notification-v2` + type-specific fields). v1: skip if v2 available. | POST /events/notifications |
| `update_event_notification` | Update notification config | PUT /events/notifications/{id} |
| `delete_event_notification` | Delete notification | DELETE /events/notifications/{id} |

**Differentiator (1 tool):**

| Tool | Description | Maps to |
|------|-------------|---------|
| `test_event_notification` | Send a test notification to verify config (recipient receives a sample alert). Lets the agent self-verify before "shipping" the alert. | POST /events/notifications/{id}/test |

**Notification type table-stakes:**
- **Email** (`email-notification-v1`) — table stakes; SMTP config lives at the Graylog cluster level
- **HTTP v2** (`http-notification-v2`) — table stakes; covers webhooks (Slack/Teams/PagerDuty via webhook URLs)
- HTTP v1 — deprecated path; only if v2 unavailable in target
- Slack/PagerDuty/MS Teams native plugins — nice-to-have, plugin-conditional; agent can hit them via HTTP v2 webhooks instead

**Anti-features:**
- Correlation event definitions — Graylog Enterprise feature; aggregation-only this milestone
- Bulk schedule/unschedule/delete endpoints — agent can loop
- Duplicate endpoint — convenience; agent can `get` + `create`
- Notification "legacy types" endpoint — deprecated discovery
- Execute-event-definition-now endpoint (`POST /{id}/execute`) — manual trigger; ops feature, not bootstrap
- Cron-expression validator — fold into `validate_event_definition`
- Clear notification queue — operational, not configuration

**Dependencies:**
- `create_event_notification` is referenced by `create_event_definition`'s `notifications: [{notification_id, notification_parameters}]` — notifications must exist first when bootstrapping
- `validate_event_definition` should be called by `create_event_definition` internally as a precondition (similar to `parse_pipeline_rule` pattern)

---

## Blueprint Tools (Cross-Cutting)

Curated, not exhaustive. Six blueprints below; under the 8-blueprint ceiling.

Each blueprint composes domain primitives. All accept `dryRun` (defaulting `true`) and return both the planned operations and the resulting IDs. Each is **idempotent by name** — if `app_name=foo` already has a stream `foo errors`, the blueprint detects and updates rather than duplicates.

### Blueprint 1 — `setup_app_monitoring_stack(app_name, source_pattern)`

The headline blueprint from PROJECT.md ("set up an app monitoring environment for service X"). End-to-end stack for one application.

**Composition:**
1. `create_stream` (title = "`{app_name}` logs", matching_type = AND)
2. `add_stream_rule` (field = `source`, value = `source_pattern`, type = REGEX or EXACT)
3. `create_pipeline_rule` (parse + create a rule that enriches messages with `application: {app_name}`)
4. `create_pipeline` (single-stage, references the rule above)
5. `connect_pipelines_to_stream` (attach pipeline to the new stream)
6. `create_dashboard` ("`{app_name}` monitoring")
7. `add_widget_from_template` × 4: `message_count_over_time`, `error_rate_over_time`, `top_sources_by_count`, `level_distribution` — all scoped to the new stream
8. `create_event_definition` (high-error-rate alert: aggregation, count of `level <= 3` > threshold within 5 min, scoped to the new stream)

### Blueprint 2 — `setup_error_stream_for_app(app_name, severity_field, error_values)`

Smaller variant — just the error-routing piece. Useful when a stream/dashboard already exists and the user wants a dedicated error sub-stream.

**Composition:**
1. `create_stream` (title = "`{app_name}` errors", matching_type = AND, remove_matches_from_default_stream = true)
2. `add_stream_rule` × N (one per `error_values` entry, each `field=severity_field`, `type=EXACT` or `CONTAINS`)
3. `add_stream_rule` (field = `application`, value = `app_name`, type = EXACT — bind to the application)
4. `connect_pipelines_to_stream` (optional: attach existing app pipeline)

### Blueprint 3 — `create_app_health_dashboard(app_name, stream_id?)`

Dashboard-only blueprint for an existing stream.

**Composition:**
1. `create_dashboard` ("`{app_name}` health")
2. `add_widget_from_template` × 4–5: a curated set from the widget-template library, all scoped to `stream_id` (or unscoped if not provided)

Templates used: `message_count_over_time`, `error_rate_over_time`, `top_sources_by_count`, `top_field_values(field=status_code)`, `event_list` (if an event def for this app exists)

### Blueprint 4 — `setup_syslog_ingest(name, port, protocol, bind_address?)`

Common bootstrap step — start receiving syslog from somewhere.

**Composition:**
1. `create_input` (type = `org.graylog2.inputs.syslog.{udp|tcp}.SyslogUDPInput`, config = {port, bind_address})
2. `set_input_state` (start)
3. *(Optional, if `attach_to_stream_id` given)* `create_extractor` to normalize syslog facility/severity

### Blueprint 5 — `setup_gelf_ingest(name, port, protocol)`

Mirror of Blueprint 4 for GELF. Inputs differ; pattern is identical. Kept separate because GELF needs no extractor (already structured) — letting the agent reason about "syslog needs extractors, GELF doesn't".

**Composition:**
1. `create_input` (type = `org.graylog2.inputs.gelf.{udp|tcp|http}.GELF...Input`, config = {port, bind_address})
2. `set_input_state` (start)

### Blueprint 6 — `create_alert_with_notification(name, query, threshold, notification_target)`

End-to-end alerting in one call. `notification_target` accepts either `{type: "email", emails: [...]}` or `{type: "webhook", url: "..."}` and the blueprint picks the right notification config shape.

**Composition:**
1. `create_event_notification` (Email or HTTP-v2 based on `notification_target.type`)
2. `create_event_definition` (aggregation, condition = count of messages matching `query` > `threshold` within 5 min, references notification from step 1)
3. `schedule_event_definition` (enabled = true)
4. *(Optional)* `test_event_notification` if `dryRun=false` and `test_after_apply=true`

### Blueprints — deliberately NOT included

- `setup_index_set_for_app(app_name)` — index-set creation is a one-time cluster-level concern; not per-app. Provide via primitives.
- `setup_kubernetes_logging`, `setup_aws_cloudtrail`, etc. — vendor-specific bootstrap recipes; defer to follow-up milestone. Six blueprints is the curated set; expanding to vendor recipes is a different scope.
- `setup_pipeline_chain` — pipeline-to-pipeline chaining; deferred (see Domain 2 anti-features).

---

## Anti-Features (Milestone-Level Reconfirmation)

All from PROJECT.md "Out of Scope" — restated here as a checklist for the requirements phase:

| Anti-feature | Confirmed |
|--------------|-----------|
| Lookup tables / data adapters / caches | YES — no `create_lookup_table`, no `LookupTableResource` wrappers (Graylog source has them; we skip) |
| Users / roles / API tokens | YES — `roles/`, `users/` resources in source; not exposed |
| Content packs | YES — `contentpacks/` exists; not exposed (would conflict with the "agent bootstraps" model anyway) |
| Sidecar / collector management | YES — Graylog Sidecar API is server-side; not exposed |
| Arbitrary widget construction | YES — only curated templates from the 8-template library |
| Backward-compat changes to v2.3 read tools | YES — `list_streams`, `get_event_definitions`, etc. unchanged |
| Multi-version (4.x / 5.x / 6.x) | YES — Graylog 7.2 target only |
| User-editable blueprint library | YES — blueprints ship in source |
| Bulk-operation endpoints (bulk_delete, bulk_schedule, etc.) | NEW — agent can loop; primitives stay clean |
| Operational endpoints (input diagnostics, execute-now, clear queues) | NEW — config, not ops |
| Deprecated subsystems (stream outputs, legacy alerts V1) | NEW — superseded; skip |

---

## MVP Recommendation

If the milestone has to ship in two passes:

**Pass 1 — "Agent can boostrap one app monitoring stack" (the headline use case):**
1. Domain 1 streams (full) + Domain 2 pipelines (minus simulator) + Blueprint 1 (`setup_app_monitoring_stack`)
2. Domain 3 dashboards CRUD + the 8-template library + `add_widget_from_template`
3. Domain 6 event definitions + notifications (Email + HTTP-v2 only)

**Pass 2 — "Agent can configure ingestion and storage":**
4. Domain 4 inputs + extractors (GELF/Syslog/Beats table-stakes)
5. Domain 5 index sets + retention/rotation
6. Blueprints 2–6

Pass 1 delivers ~80% of the "natural language → working Graylog" value because the test fixture (a stream with rules + a pipeline + a dashboard + an alert) is the most-rehearsed agent demo. Pass 2 makes it production-deployable.

---

## Feature Dependency Graph (Cross-Domain)

```
create_index_set ──────────────────► create_stream.index_set_id (optional, default-default)
                                          │
                                          ▼
create_input ─► set_input_state           add_stream_rule
       │                                  │
       └──► create_extractor              ▼
                                  create_pipeline_rule
                                          │
                                          ▼  (parse_pipeline_rule precondition)
                                  create_pipeline
                                          │
                                          ▼
                              connect_pipelines_to_stream
                                          │
                                          ▼
                          create_event_notification
                                          │
                                          ▼  (validate_event_definition precondition)
                          create_event_definition
                                          │
                                          ▼
                          schedule_event_definition

create_dashboard ──► add_widget_from_template (some templates take event_definition_ids)
```

This graph drives roadmap phase ordering: streams + index sets first, then pipelines, then events/notifications, then dashboards last (since some widget templates depend on event defs).

---

## Sources

All HIGH confidence — direct Java source:

- StreamResource: `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog2/rest/resources/streams/StreamResource.java`
- StreamRuleResource: `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog2/rest/resources/streams/rules/StreamRuleResource.java`
- StreamRuleType enum: `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog2/plugin/streams/StreamRuleType.java`
- PipelineResource: `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/pipelineprocessor/rest/PipelineResource.java`
- RuleResource: `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/pipelineprocessor/rest/RuleResource.java`
- PipelineConnectionsResource: `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/pipelineprocessor/rest/PipelineConnectionsResource.java`
- SimulatorResource: `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/pipelineprocessor/rest/SimulatorResource.java`
- ViewsResource (dashboards CRUD): `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/views/search/rest/ViewsResource.java`
- DashboardsResource (list only): `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/views/search/rest/DashboardsResource.java`
- WidgetDTO + widget config types: `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/views/search/views/`
- InputsResource: `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog2/rest/resources/system/inputs/InputsResource.java`
- InputStatesResource: `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog2/rest/resources/system/inputs/InputStatesResource.java`
- ExtractorsResource: `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog2/rest/resources/system/inputs/ExtractorsResource.java`
- Extractor.Type enum: `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog2/plugin/inputs/Extractor.java`
- IndexSetsResource: `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog2/rest/resources/system/indexer/IndexSetsResource.java`
- RotationStrategyResource + RetentionStrategyResource: `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog2/rest/resources/system/indices/`
- Rotation strategy configs: `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog2/indexer/rotation/strategies/`
- Retention strategy configs: `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog2/indexer/retention/strategies/`
- EventDefinitionsResource: `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/events/rest/EventDefinitionsResource.java`
- EventNotificationsResource: `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/events/rest/EventNotificationsResource.java`
- Event notification types: `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/events/notifications/types/`
- Existing v2.3 tool naming pattern: `src/tools.js`

INFERRED (MEDIUM confidence):
- The `list_input_types` endpoint canonical path (`/system/inputs/types/all`) is inferred from Graylog's standard API shape and verified by the presence of `AbstractInputsResource.java`; confirm exact path during requirements phase.
- The presence of "Archive" retention strategy in Graylog Enterprise (excluded as anti-feature) — inferred from public Graylog docs, not verified in this OSS source tree.
- Notification type discriminator strings (`email-notification-v1`, `http-notification-v2`) — confirmed by class file naming but the exact wire-format discriminator should be re-verified by reading one `@JsonTypeName` annotation during the build-out.
