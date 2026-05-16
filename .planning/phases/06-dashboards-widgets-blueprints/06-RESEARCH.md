# Phase 6: Dashboards, Widget Templates & Blueprints - Research

**Researched:** 2026-05-15
**Domain:** Graylog 7.0.6 (live target) / 7.2.0-SNAPSHOT (source clone) — dashboard CRUD via internal Search+View two-step + 8 curated widget templates + 6 cross-domain blueprints composed through a NEW `src/services/` layer
**Confidence:** HIGH (all 18 D-XX decisions backed by direct source-walk of `ViewsResource.java`, `SearchResource.java`, `ViewDTO.java`, `SearchDTO.java`, `QueryDTO.java`, `ViewStateDTO.java`, `WidgetDTO.java`, `WidgetPositionDTO.java`, `AggregationConfigDTO.java`, `PivotDTO.java`, `SeriesDTO.java`, `MessageListConfigDTO.java`, and the 12 series-spec classes); MEDIUM (snapshot fixture byte-stability assumptions for IDs — wrapper-generated UUIDs must be deterministic in tests; live 7.0.6 envelope keys on `/api/views` are reasonably assumed identical to 7.2-snapshot but not yet live-confirmed)

## Summary

Phase 6 is the milestone-defining E2E surface: **14 new tools** (DASH-01..08 dashboard CRUD + 8 curated widget templates, BLUE-01..06 cross-domain blueprints) plus a NEW `src/services/` layer that blueprints compose from. The signature deliverable is **BLUE-01 `setup_app_monitoring_stack`** — a 6-step chain (input → stream → pipeline + 2 rules → pipeline-stream connect → dashboard with 4 widgets → error-rate event_definition) that produces a working monitoring environment from a single natural-language intent.

The single largest pitfall — **C7 Dashboard creation requires a pre-saved Search; widget IDs must match widget-position IDs** — is mitigated by D-01..D-03: `create_dashboard` is structurally a two-step internal blueprint (the agent NEVER sees the Search ID; widget/position/searchType triplets ship as frozen `{widget, position, searchType}` builders so mismatched sets are impossible). The 18 D-XX decisions cleanly compose Phases 0..5's primitives (`defineMutatingHandler`, `findExistingMatches`, `toIdBody`, `__SERVER_ASSIGNED__`, `computeCascadeHash`, the writable gate); the ONLY new client-side machinery is (a) the `src/services/*` thin HTTP wrappers (one file per domain, 6 files), (b) the chain-transcript helper for blueprints (~40 LOC), and (c) the 8 widget-template builders in `src/widget-templates/` (~30-60 LOC each).

**Key research confirmations:**
- C7 mitigation is **already source-confirmed**: `ViewsResource.createView` line 277 calls `validateIntegrity(dto, searchUser, true)` which throws `BadRequestException("Search " + dto.searchId() + " not available")` if the Search entity doesn't exist; then `validateSearchProperties` (line 329-379) asserts three invariants — (i) `dto.state().keySet()` ⊆ `search.queries().map(Query::id)`, (ii) widget search-types in `widgetMapping` values ⊆ `search.searchTypes`, (iii) `widgetPositions.keySet()` ⊇ `widgets.map(WidgetDTO::id)`. D-03's client-side validator is a direct mirror of (iii); D-04/D-05 widget-template triplets keep (ii) structurally true; the two-step internal chain (D-01) is the only way to satisfy (i).
- The Search creation endpoint is `POST /api/views/search` (SearchResource.java:111) — NOT `POST /api/views/search/sync`. The /sync endpoint *executes* a search; the bare POST *saves* a SearchDTO. Returns **201 + SearchDTO** + `Location` header (line 120). Read-side existing `src/query.js` hits `/sync` for query execution; we leave that untouched and add `/views/search` for persistence.
- The View (Dashboard) creation endpoint is `POST /api/views` (ViewsResource.java:243). Returns **200 + full ViewDTO** with the assigned id (M2 row, confirmed by reading `createView` — it returns `dbService.saveWithOwner(...)` whose return type is ViewDTO). Request body is `CreateEntityRequest<ViewDTO>` envelope `{entity: <ViewDTO>, share_request: null}` — SAME envelope Phase 3 `create_stream` and Phase 5 `create_event_definition` already use (Pitfall 3 generalizes).
- The Dashboard `type` discriminator is `ViewDTO.Type.DASHBOARD` enum (default in builder, line 252). Saved-searches use `ViewDTO.Type.SEARCH`. Phase 6 ALWAYS emits `type: "DASHBOARD"` — the existing Phase 0..5 surface doesn't touch saved searches via `/views`.
- Widget `type` field uses string discriminators: `"aggregation"` (AggregationConfigDTO.NAME line 41), `"messages"` (MessageList.NAME line 56), `"map"`, `"scatter"`, `"world-map"`, `"heatmap"`. Phase 6's 8 templates use ONLY `"aggregation"` and `"messages"` — the other visualizations are out-of-scope per CONTEXT.md.
- `WidgetPositionDTO` has 4 required fields: `col`, `row`, `height`, `width` (each is a `Position` — a tagged union of integer literal or `"Infinity"` for full-width). Widget grid is 12-column. Templates default to a 6-column-wide × 4-row-tall standard size; agent can override per template via `options.position`.
- `IntervalDTO` is a discriminated union with `"timeunit"` (TimeUnitIntervalDTO — `{type:"timeunit", value:N, unit:"seconds"|"minutes"|...|"auto"}`) or `"auto"` (AutoIntervalDTO). Time histograms default to `{type:"timeunit", value:1, unit:"auto"}` per Graylog UI convention — this matches `getLogHistogram`'s legacy auto-interval (verified in src/aggregations.js).
- `SeriesSpec` types match Phase 5's catalogue exactly: 12 classes in `searchtypes/pivot/series/` — `Count`, `Sum`, `Average`, `Min`, `Max`, `StdDev`, `Variance`, `SumOfSquares`, `Percentile`, `Percentage`, `Cardinality`, `Latest`. Each has a `literal()` method emitting `<type>(<field>)` (e.g. `count(source)` → SeriesSpec.id() default). **CRITICAL**: this is the SAME v6→v7 aggregation surface Phase 5 flagged (C5) — Series identifiers in widget configs follow the SAME `<type>_<field>` v7 form. Templates emit v7 form natively (no migration needed inside templates; if/when agents customize via `add_widget_from_template options`, the v7 form is what they pass).
- The `widgetMapping` field on `ViewStateDTO` (line 62-63) is `Map<String, Set<String>>` where keys are widget IDs and values are the set of `SearchType.id()` strings the widget renders. For a single-pivot widget this is `{"widget-1": ["search-type-1"]}`; for multi-series widgets it's `{"widget-1": ["search-type-1", "search-type-2"]}`. Templates emit ONE searchType per widget — the simple case.
- `findExistingMatches` (FOUND-11 / Phase 1) already supports a `response.views` envelope key path-less; for `/api/views?query=title:X` the envelope is `PaginatedResponse.create("views", ...)` (ViewsResource.java:187) — `result.views`. The `conflict.js` helper needs an additive amendment to look up `response.views` (consistent with the existing `streams`/`inputs`/`extractors`/`index_sets`/`elements`/`items` envelope-key catalogue).

**Primary recommendation:** Phase 6 ships in 5 plans following Phase 5's shape, plus one extra plan for the BLUE-01 E2E chain. **Plan 01: foundations** (`src/services/{streams,pipelines,inputs,index-sets,events,dashboards}.js` thin HTTP wrappers + `src/widget-templates/` infrastructure + `src/tools/_shared/blueprint-chain.js` chain-transcript helper + `findExistingMatches` `views` envelope amendment + Plan 06-01-U1-SMOKE.md decision artifact for response shape verification). **Plan 02: dashboard CRUD** (DASH-01..05 + DASH-07; the C7 acceptance gate centerpiece via internal Search+View chain + widget-position integrity validator). **Plan 03: widget-template library** (DASH-06 + DASH-08; 8 frozen triplet builders + the `add_widget_from_template` drop-onto-existing tool). **Plan 04: blueprints A** (BLUE-04, BLUE-05, BLUE-06 — the 3 "simpler" single-or-double-domain blueprints; BLUE-04 reuses Phase 4's `pipeline-dsl/emit.js`). **Plan 05: blueprints B** (BLUE-01 headline + BLUE-02, BLUE-03 — the multi-domain blueprints with dependsOn chain transcripts). **Plan 06: snapshot fixture freeze** (14 dry-run fixtures + 1 BLUE-01 mega-chain transcript fixture + schema-parity for 14 net-new tools + VALIDATION.md flip + human-verify checkpoint).

## User Constraints

> Copied verbatim from `.planning/phases/06-dashboards-widgets-blueprints/06-CONTEXT.md` for the planner's reference. The planner MUST honor every Decision below. Claude's Discretion items are research areas with researcher recommendations. Deferred Ideas are OUT OF SCOPE.

### Locked Decisions

**C7 mitigation — Dashboard two-step chain (ROADMAP SC1)**
- **D-01:** `create_dashboard` is a **two-step internal blueprint** even in single-tool form. The wrapper internally chains:
  1. `POST /api/views/search` — creates the Search entity with the widget-derived `searchTypes`
  2. `POST /api/views` — creates the View (Dashboard) with `searchId` set to step 1's response
  The agent never sees the intermediate Search ID. The wrapper returns the chained transcript with `dependsOn` annotations per C6 pattern.
- **D-02:** `create_dashboard` REJECTS an agent-supplied `searchId` parameter. The wrapper owns the linkage.
- **D-03:** Client-side validator before emitting: `widgetPositions.keys() === widgets.map(w => w.id)`. Rejection with clear error before round-trip.

**Widget templates (ROADMAP SC3, DASH-08)**
- **D-04:** Curated library ships 8 templates, each as a `{widget, position, searchType}` triplet — composer cannot produce mismatched sets:
  - `error_rate_over_time` (histogram, level>=4)
  - `top_sources_by_volume` (field aggregation, count by source)
  - `level_distribution` (pie/donut, count by level)
  - `top_error_clusters` (data table from cluster_log_messages output)
  - `request_rate_over_time` (histogram, configurable filter)
  - `field_value_distribution` (configurable field aggregation)
  - `recent_events_table` (message table, configurable filter)
  - `stream_activity_overview` (per-stream count over time)
- **D-05:** Templates default per-widget `timerange` to **inherit-from-dashboard** (omit the field). Agent opts into per-widget override explicitly. C7 mitigation step 4.
- **D-06:** `add_widget_from_template({connectionName, dashboardId, templateName, options})` (DASH-06) drops any template onto an existing dashboard from one call. Options carry template-specific knobs (stream binding, field, time range override).

**dependsOn chain transcript (ROADMAP SC4, C6 mitigation)**
- **D-07:** Every blueprint dry-run returns `chain: [{step: N, tool, request, dependsOn?: {from, as}}, ...]`. The agent sees:
  - The sequence of would-be requests
  - Explicit `dependsOn: {from: "step1.response.id", as: "streamId"}` annotations
  Reasoning per-step independently is supported.
- **D-08:** On apply, each step substitutes the previous step's `__SERVER_ASSIGNED__` IDs into subsequent requests. Partial failure surfaces `chain[N].error` + which steps succeeded.

**Services layer (ROADMAP SC4)**
- **D-09:** Blueprints compose from `src/services/*` modules, NEVER from `src/tools/<domain>/<handler>.js`. Each service exposes thin function wrappers around the Graylog HTTP client for one domain:
  - `src/services/streams.js` — `createStream({ connection, ... })`, `addRule({ ... })`, etc.
  - `src/services/pipelines.js` — `createPipeline`, `createRule`, `connectToStream`
  - `src/services/inputs.js`, `src/services/index-sets.js`, `src/services/events.js`, `src/services/dashboards.js`
  Services do NOT route through `defineMutatingHandler`; they're pure HTTP wrappers with typed return values. Plan 01 builds these.
- **D-10:** Existing single-domain tool handlers (Phases 1-5) are NOT refactored to use services this phase — the service layer is additive. Future milestones may refactor.

**Six blueprints (BLUE-01..06)**
- **D-11:** **BLUE-01 `setup_app_monitoring_stack(app_name, source_pattern)`** — the headline. Composes: stream creation (filter by source_pattern) → pipeline + 2 starter rules (drop debug, enrich timestamp) → pipeline-to-stream connect → dashboard with 4 widgets (error_rate_over_time, top_sources_by_volume, level_distribution, recent_events_table) → error-rate event_definition. ~6-8 step chain.
- **D-12:** BLUE-02 `setup_error_alerting(stream_id, notification_target)` — event_definition + connect to existing notification.
- **D-13:** BLUE-03 `create_app_health_dashboard(stream_id)` — dashboard + 4 widget templates wired to the stream.
- **D-14:** BLUE-04 `setup_pipeline_for_stream(stream_id, transforms)` — pipeline + rule(s) + connection from structured intent. Reuses Phase 4's structured-intent emitter.
- **D-15:** BLUE-05 `setup_long_term_archival_index(name, retention_days)` — index set with size-based rotation + delete-retention bundled.
- **D-16:** BLUE-06 `setup_debug_log_dropping(stream_id, min_level)` — pipeline rule drops sub-threshold messages; connection wired automatically.

**M2 response normalization (carried forward)**
- **D-17:** `POST /views` returns 200 with full ViewDTO; wrapper's response normalizer extracts the `id`. Per pitfall M2 table.

**Defense-in-depth + IDs**
- **D-18:** Phase 0 writable-flag gate applies. __SERVER_ASSIGNED__ sentinel for create_dashboard + create_widget_from_template dry-runs. Schema-parity for all 14 new tools.

### Claude's Discretion (auto-resolved)

- **Discretion-01:** Module layout: `src/tools/dashboards/` (DASH-XX), `src/tools/blueprints/` (BLUE-XX), `src/services/<domain>.js` (shared). **RESEARCHER CONFIRMATION:** mirror `src/tools/streams/` shape; per-tool file + co-located `schemas.js` + side-effect `index.js` barrel. Blueprints follow the SAME shape but live under `src/tools/blueprints/`. Services follow `src/clustering/` peer-subsystem precedent (top-level, not nested under tools/).
- **Discretion-02:** Widget-template module structure: `src/widget-templates/{name}.js` exporting a frozen `{widget, position, searchType}` triplet builder. **RESEARCHER CONFIRMATION:** Object.freeze pattern matches `src/tools/events/encrypted-fields.js` line 19. Each template exports a single `build(options) -> {widget, position, searchType}` function. The composer cannot synthesize a partial triplet — by signature.
- **Discretion-03:** Snapshot fixture set: 12-15 fixtures covering each tool's dry-run + the BLUE-01 full-chain transcript (1 mega-fixture). **RESEARCHER RESOLUTION:** 18 fixtures recommended — see §"Snapshot Fixture Design" below (14 per-tool + 4 acceptance-gate fixtures, including the BLUE-01 mega-chain).

### Deferred Ideas (OUT OF SCOPE)

- Auto-generation of widget templates from Graylog's built-in templates (none exist on the wire side; this is wrapper-only). Future milestone.
- Custom user-supplied widget templates (the 8 curated names are the closed set).
- E2E live-instance testing of BLUE-01 — deferred to `/gsd-verify-work 06`.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DASH-01 | `list_dashboards` — narrow projection | §"Endpoint Catalogue" §"List Path Selection" — `GET /api/views?query=type:DASHBOARD`; PaginatedResponse envelope `result.views[]` |
| DASH-02 | `get_dashboard` — full ViewDTO with widget layout | §"Endpoint Catalogue" §"ViewDTO Field Shape" — `GET /api/views/{id}` |
| DASH-03 | `create_dashboard` — internal Search+View chain (C7) | §"C7 Mitigation Anatomy" §"Two-Step Chain Wire Forms" §"Widget-Position Integrity Validator" |
| DASH-04 | `update_dashboard` | §"Update Semantics" §"STRICT_NO_ECHO precedent + searchId immutability" |
| DASH-05 | `delete_dashboard` | §"Delete Semantics" — single endpoint, no cascade, leaf delete |
| DASH-06 | `add_widget_from_template` — drops curated template onto dashboard | §"add_widget_from_template Wire Form" — GET current ViewDTO → mutate state.widgets/widgetPositions/widgetMapping + Search.searchTypes → PUT both |
| DASH-07 | `remove_widget` | §"remove_widget Wire Form" — GET → remove widget triplet → PUT both |
| DASH-08 | 8 curated widget templates | §"Widget Template Catalogue (8 templates)" — full triplet shape per template |
| BLUE-01 | `setup_app_monitoring_stack` — headline use-case | §"BLUE-01 Chain Anatomy" §"Chain Transcript Shape" — 6-step chain |
| BLUE-02 | `setup_error_alerting(stream_id, notification_target)` | §"BLUE-02 Chain Anatomy" — 2-step chain |
| BLUE-03 | `create_app_health_dashboard(stream_id)` | §"BLUE-03 Chain Anatomy" — 1-step (dashboard with 4 widgets) |
| BLUE-04 | `setup_pipeline_for_stream(stream_id, transforms)` | §"BLUE-04 Chain Anatomy" — reuses `pipeline-dsl/emit.js` (Phase 4) |
| BLUE-05 | `setup_long_term_archival_index(name, retention_days)` | §"BLUE-05 Chain Anatomy" — 1-step (single index_set create with bundled rotation+retention) |
| BLUE-06 | `setup_debug_log_dropping(stream_id, min_level)` | §"BLUE-06 Chain Anatomy" — 3-step (rule + pipeline + connect) |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Dashboard CRUD (7 tools: DASH-01..05, DASH-07) | API / Backend | Database (MongoDB `dashboards` collection — note: ViewDTO collection name = `views` per ViewDTO.java line 71; internal Mongo collection is `dashboards` per the `@DbEntity` annotation line 67) | All mutations resolve to Graylog REST → MongoDB; no client-tier compute beyond the wrapper |
| Internal Search+View chain (DASH-03) | API / Backend | API / Backend | The chain is two HTTP round-trips; the wrapper orchestrates the dependency chain but BOTH stages are server-side operations |
| `add_widget_from_template` (DASH-06) | API / Backend | API / Backend | Two-stage: PUT `/views/search/{searchId}` (Search update with new SearchType) + PUT `/views/{viewId}` (ViewDTO update with new widget + position + widgetMapping entry). See §"add_widget_from_template Wire Form" |
| Widget template generation | MCP wrapper (client-side) | — | `src/widget-templates/{name}.js` are pure builders — `(options) -> {widget, position, searchType}`. No HTTP, no state |
| Widget-position integrity validator (D-03) | MCP wrapper (client-side) | — | Pure structural check on widget IDs vs widgetPositions keys; mirrors `ViewsResource.validateSearchProperties` lines 371-378 |
| Blueprint composition (BLUE-01..06) | MCP wrapper (client-side) | API / Backend | Wrapper sequences N service calls; each service call resolves to Graylog REST. The chain-transcript helper lives wrapper-side; the orchestration is wrapper-driven |
| `src/services/*` thin HTTP wrappers | MCP wrapper (client-side) | API / Backend | Pure `(client, args) -> graylogResponse` functions; no MCP coupling, no idempotency-key, no dryRun branching |
| Discriminator validation (widget template name, blueprint args) | MCP wrapper (zod schema) | — | Closed-set rejection before any HTTP call (M7 + C7 mitigation) |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | `1.18.0` (locked) | MCP transport | Existing project dependency [VERIFIED: package.json:36] |
| `axios` | `1.12.2` (locked) | HTTP client (via `src/graylog/client.js`) | Existing project dependency [VERIFIED: package.json:37] |
| `zod` | `^3.25.76` (locked) | Schema validation + closed-set discriminator for template names + blueprint inputs | Existing project dependency, adopted in Phase 0 FOUND-05 [VERIFIED: package.json:38] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:crypto` (`randomUUID`) | builtin | Generate widget IDs + searchType IDs + query IDs that are wrapper-deterministic for snapshot tests | Required for ViewDTO construction — every widget needs an id; every SearchType needs an id; every Query needs an id. Tests mock the generator for byte-stable snapshots [VERIFIED: `Pivot.java:184-188`, `MessageList.java:191-194` — server-side UUID fallback if id is null; the wrapper supplies IDs so the ViewState's widgetMapping can reference them deterministically] |
| `node:test` (`t.snapshot`) | builtin (Node 22.3+) | Dry-run fixture pinning | Reused for the 18 Phase 6 fixtures [VERIFIED: Phase 0..5 precedent] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Widget-template triplet builders (D-04) | Open `create_widget` with arbitrary spec | Out of scope per CONTEXT.md Deferred + WIDGET-01/02 are v2; arbitrary widgets are an entirely different validation surface (free-form search composition + display config). Triplet builders cover ~80% of agent workflows with structural correctness guarantees. |
| Closed enum for blueprint names (D-11..D-16) | Open string match | Open match would silently accept `setup_app_monitoring_stack_v2` and route nowhere. Closed-set rejection in zod = M7 mitigation in action. |
| dependsOn annotations in chain transcripts (D-07) | Flat list of requests | Without dependsOn, the agent can't reason about each step independently — it has no marker telling it which step's `__SERVER_ASSIGNED__` feeds which downstream request. Pitfall C6 says explicit dependsOn is the answer. |
| Services layer as pure functions (D-09) | Blueprints call other tool handlers | Anti-pattern 1 from ARCHITECTURE.md — double-validation, double-dry-run, opaque error propagation. Services are the architecturally correct boundary. |
| In-flight ID substitution for blueprint apply (D-08) | Echo apply-time IDs in transcript only | Without substitution, downstream requests have stale `__SERVER_ASSIGNED__` placeholders and Graylog returns 400 "Search xxx not available". Substitution is non-negotiable. |
| Per-template-instance widget ID generation | Single fixed widget ID per template | `add_widget_from_template` is called repeatedly on the same dashboard — fixed IDs collide on the 2nd call. UUID-per-instance is the only correct choice; tests use a seeded RNG for byte-stable snapshots. |

**Installation:** No new dependencies. Phase 6 is pure composition against Phase 0..5 primitives + a small amount of new wrapper machinery (services layer + chain helper + widget-template builders).

**Version verification:**
```bash
npm view @modelcontextprotocol/sdk version   # → 1.18.0 (locked at ^1.18.0; current latest 1.29.0 — DO NOT upgrade per CLAUDE.md backward-compat)
npm view axios version                        # → 1.12.2 (locked at ^1.12.2; current latest 1.16.1 — DO NOT upgrade)
npm view zod version                          # → 3.25.76 (locked at ^3.25.76; v4 is out — DO NOT adopt per .planning/REQUIREMENTS.md "Out of Scope: Adopting zod v4")
```
[VERIFIED: package.json + `npm view <pkg> version` 2026-05-15]

## Project Constraints (from CLAUDE.md)

The project CLAUDE.md mandates these constraints — the planner MUST honor them:

- **Tech stack:** Node.js ≥22.3.0 ESM; existing `@modelcontextprotocol/sdk` + `axios` + `zod` — do NOT add new dependencies.
- **Graylog version:** 7.2.0-SNAPSHOT per CLAUDE.md (PROJECT.md refines to 7.0.6 as the live target). Live behavior wins on divergence.
- **Auth model:** Existing connection registry + API token (HTTP Basic, token-as-username, password `"token"`). No new auth concepts.
- **Safety:** Every mutating tool MUST default to `dryRun: true`. Applying without an explicit `dryRun: false` is a bug — enforced via `defineMutatingHandler`. **Blueprints inherit this** (they compose through `defineMutatingHandler` per D-07/D-08).
- **Backward compat:** Existing v2.3 tool contracts unchanged. **Phase 6 does NOT displace any v2.3 tools** — there's no v2.3 dashboard CRUD surface to displace.
- **No web UI:** This is an MCP server. JSON output via MCP text responses only. **Dashboards live in Graylog's web UI but are configured via the MCP — the agent never renders the UI**.
- **Code organization:** New admin tools under `src/tools/dashboards/`, `src/tools/blueprints/` per-domain modules. **Services layer** is a NEW top-level subsystem at `src/services/` (peer of `src/clustering/`, `src/pipeline-dsl/`, `src/graylog/`). **Widget templates** are a NEW top-level subsystem at `src/widget-templates/`.
- **GSD workflow enforcement:** All edits go through `/gsd-execute-phase` (or `/gsd-quick`, `/gsd-debug`).

## Architecture Patterns

### System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│ MCP Client (agent)                                                 │
│  send: {name: "setup_app_monitoring_stack", args:                  │
│    {app_name: "payment-svc", source_pattern: "payment-*"}}         │
└────────────────────────────────┬───────────────────────────────────┘
                                 ↓
┌────────────────────────────────────────────────────────────────────┐
│ src/dispatch.js (Phase 0 — unchanged)                              │
│  Map<toolName, handler>.get("setup_app_monitoring_stack")          │
└────────────────────────────────┬───────────────────────────────────┘
                                 ↓
┌────────────────────────────────────────────────────────────────────┐
│ src/tools/blueprints/setup-app-monitoring-stack.js                 │
│  defineMutatingHandler({                                           │
│    schema: SetupAppMonitoringStackSchema (zod)                     │
│    build: async (args) => {                                        │
│      // Builds chain of 6 service-call descriptors:                │
│      //   step 1: streams.create(...)                              │
│      //   step 2: pipelines.create(...)         dependsOn: step1   │
│      //   step 3: pipelines.createRule(...)     dependsOn: step2   │
│      //   step 4: pipelines.connectToStream(...) dependsOn: 1+2    │
│      //   step 5: dashboards.create(...)        dependsOn: step1   │
│      //   step 6: events.create(...)            dependsOn: step1   │
│      // Each step gets dependsOn annotations.                      │
│      return { chain: [...], postApplyEstimate: {...} }             │
│    },                                                              │
│    apply: async (client, req) => {                                 │
│      // For each step in chain:                                    │
│      //   substitute __SERVER_ASSIGNED__ from prior responses      │
│      //   call services.<domain>.<method>(client, substitutedArgs) │
│      //   accumulate transcript [{step, request, response}, ...]   │
│      //   on partial failure: return transcript + chain[N].error   │
│      return { applied: true, transcript: [...] }                   │
│    }                                                               │
│  })                                                                │
└────────────────────────────────┬───────────────────────────────────┘
                                 ↓
┌────────────────────────────────────────────────────────────────────┐
│ src/services/{streams,pipelines,dashboards,events}.js              │
│  pure HTTP wrappers — (client, args) -> graylogResponse            │
│  NO defineMutatingHandler, NO dryRun branching, NO MCP shaping     │
└────────────────────────────────┬───────────────────────────────────┘
                                 ↓
┌────────────────────────────────────────────────────────────────────┐
│ src/graylog/client.js (Phase 0 — unchanged)                        │
│  POST/PUT {baseUrl}/api/<endpoint>                                 │
│  Authorization: Basic <token-as-username>                          │
│  X-Requested-By: graylog-mcp                                       │
└────────────────────────────────┬───────────────────────────────────┘
                                 ↓
┌────────────────────────────────────────────────────────────────────┐
│ Graylog 7.0.6 → 6 sequential HTTP calls (streams, pipelines,       │
│   pipeline rules, pipeline-stream connection, dashboards via       │
│   internal Search+View chain, events)                              │
│   ⇒ Each step's response feeds the next via __SERVER_ASSIGNED__    │
└────────────────────────────────────────────────────────────────────┘

Dashboard creation internal chain (DASH-03; called once from BLUE-01 step 5
and also exposed as the standalone create_dashboard tool):

dashboards.create(client, {title, widgets[], dashboardTimerange, dashboardQuery,
                          dashboardStreamIds}):
  1. Build SearchDTO from widgets:
       - One Query (id: q-1) covering all widgets
       - searchTypes[]: union of all widget.searchType across widgets
       - Query.timerange = dashboardTimerange
  2. POST /api/views/search → returns SearchDTO with id (Search ID)
  3. Validate widget-position integrity client-side (D-03)
       - widgetPositions.keys() == widgets.map(w => w.id)
       - If mismatch: throw client-side error, NO ViewDTO POST issued
  4. Build ViewDTO from widgets + Search ID:
       - searchId: <from step 2 response>
       - state: { q-1: ViewStateDTO {
           widgets: [...widget DTOs], widgetPositions: {...},
           widgetMapping: {widgetId -> [searchTypeId, ...]} } }
       - type: DASHBOARD
  5. POST /api/views → returns full ViewDTO with id (Dashboard ID)
  6. Return { searchId, dashboardId, ... } — caller (handler or blueprint)
     decides how to expose to agent
```

### Recommended Project Structure

```
src/services/                                  # NEW Phase 6 — thin HTTP wrappers
├── streams.js                                 # createStream, addRule, deleteStream
├── pipelines.js                               # createPipeline, createRule, connectToStream
├── inputs.js                                  # createInput, deleteInput
├── index-sets.js                              # createIndexSet
├── events.js                                  # createEventDefinition, enableEventDefinition
└── dashboards.js                              # createSearch, createDashboard, updateDashboard

src/widget-templates/                          # NEW Phase 6 — 8 frozen triplet builders
├── index.js                                   # exports WIDGET_TEMPLATES = Object.freeze({...})
├── error-rate-over-time.js                    # histogram, level >= 4
├── top-sources-by-volume.js                   # field aggregation, count by source
├── level-distribution.js                      # pie/donut, count by level
├── top-error-clusters.js                      # data table (deferred-source until v2.4)
├── request-rate-over-time.js                  # histogram, configurable filter
├── field-value-distribution.js                # configurable field aggregation
├── recent-events-table.js                     # message table, configurable filter
└── stream-activity-overview.js                # per-stream count over time

src/tools/dashboards/                          # NEW Phase 6 — 7 dashboard tools + DASH-08
├── schemas.js                                 # All 7 tool schemas + WidgetTemplateName enum
├── list-dashboards.js                         # defineListHandler — narrow projection
├── get-dashboard.js                           # plain GET handler (read tool)
├── create-dashboard.js                        # defineMutatingHandler + internal Search+View chain (C7 centerpiece)
├── update-dashboard.js                        # STRICT_NO_ECHO partial update
├── delete-dashboard.js                        # defineMutatingHandler + informational cascade (lists widget count)
├── add-widget-from-template.js                # DASH-06: GET → mutate → PUT both
├── remove-widget.js                           # DASH-07: GET → strip widget → PUT both
└── index.js                                   # side-effect barrel; registers 7 tools

src/tools/blueprints/                          # NEW Phase 6 — 6 blueprint tools
├── schemas.js                                 # All 6 blueprint schemas
├── setup-app-monitoring-stack.js              # BLUE-01 headline — 6-step chain
├── setup-error-alerting.js                    # BLUE-02 — 2-step chain
├── create-app-health-dashboard.js             # BLUE-03 — 1-step
├── setup-pipeline-for-stream.js               # BLUE-04 — reuses pipeline-dsl/emit.js
├── setup-long-term-archival-index.js          # BLUE-05 — 1-step
├── setup-debug-log-dropping.js                # BLUE-06 — 3-step
└── index.js                                   # side-effect barrel; registers 6 tools

src/tools/_shared/blueprint-chain.js           # NEW Phase 6 — chain-transcript helper
src/tools/_shared/widget-position-integrity.js # NEW Phase 6 — D-03 validator (≈15 LOC)
src/tools/_shared/conflict.js                  # AMEND: add "views" envelope key
src/tools/_register.js                         # IMPORT 2 new domain barrels
src/tools.js                                   # ADD 14 new tool definitions
test/dashboards.test.js                        # NEW — 7 dashboard tool tests + 8 template fixture tests
test/blueprints.test.js                        # NEW — 6 blueprint tool tests + BLUE-01 mega-chain
test/widget-templates.test.js                  # NEW — 8 template builder unit tests
test/__snapshots__/dashboards.test.js.snapshot # auto-generated by --test-update-snapshots
test/__snapshots__/blueprints.test.js.snapshot # auto-generated
test/__snapshots__/widget-templates.test.js.snapshot # auto-generated
```

### Pattern 1: Internal Search+View Two-Step (C7 Mitigation Centerpiece — D-01..D-03)

**What:** `create_dashboard.build()` constructs both a SearchDTO and a ViewDTO; `create_dashboard.apply()` POSTs the Search first, captures its id, then POSTs the View. The dry-run preview surfaces BOTH planned requests in a `chain: [...]` shape with `dependsOn: {from: "step1.response.id", as: "searchId"}` annotation. The agent NEVER sees the intermediate Search ID — `__SERVER_ASSIGNED__` sentinels appear in the dry-run.

**When to use:** ONLY `create_dashboard`. Other dashboard operations (`update_dashboard`, `add_widget_from_template`, `remove_widget`) do NOT create new Search entities — they update the existing pair via PUT.

**Example:**
```javascript
// src/tools/dashboards/create-dashboard.js
import { defineMutatingHandler } from "../_shared/handler.js";
import { CreateDashboardSchema } from "./schemas.js";
import { buildSearchDTO, buildViewDTO } from "../../services/dashboards.js";
import { validateWidgetPositionIntegrity } from "../_shared/widget-position-integrity.js";
import { makeClient } from "../../graylog/client.js";
import { toIdBody } from "../../graylog/normalize.js";

export const handleCreateDashboard = defineMutatingHandler({
    name: "create_dashboard",
    schema: CreateDashboardSchema,
    async build(args) {
        // D-03: client-side validator BEFORE any wire emission.
        validateWidgetPositionIntegrity(args.widgets);

        // The build phase produces TWO request descriptors as a chain.
        // The agent sees both via dry-run; apply() sequences them.
        const searchDTO = buildSearchDTO({
            queryId: "q-1", // wrapper-deterministic; tests pin via seeded UUID gen
            widgets: args.widgets,
            timerange: args.timerange,
            query: args.query ?? "",
            streamIds: args.streamIds ?? [],
        });

        const viewDTO = buildViewDTO({
            title: args.title,
            description: args.description,
            summary: args.summary,
            searchId: "__SERVER_ASSIGNED__step1", // placeholder; apply() substitutes
            queryId: "q-1",
            widgets: args.widgets,
        });

        return {
            // Chain shape — apply() understands the {step, tool, request, dependsOn} list.
            chain: [
                {
                    step: 1,
                    tool: "create_search",
                    request: {
                        method: "POST",
                        path: "/api/views/search",
                        body: searchDTO,
                    },
                    postApplyEstimate: { id: "__SERVER_ASSIGNED__" },
                },
                {
                    step: 2,
                    tool: "create_view",
                    request: {
                        method: "POST",
                        path: "/api/views",
                        body: { entity: viewDTO, share_request: null },
                    },
                    dependsOn: { from: "step1.response.id", as: "searchId" },
                    postApplyEstimate: { id: "__SERVER_ASSIGNED__" },
                },
            ],
            // For agent display, the "primary" preview is the View creation
            // (the Search is an implementation detail of D-01).
            method: "POST",
            path: "/api/views",
            body: { entity: viewDTO, share_request: null },
            postApplyEstimate: { id: "__SERVER_ASSIGNED__" },
        };
    },
    async apply(client, req) {
        // Execute the chain. On step N failure, return transcript with chain[N].error.
        const transcript = [];
        let lastResponse = null;
        for (const step of req.chain) {
            let body = step.request.body;
            // D-08: substitute previous step's __SERVER_ASSIGNED__ placeholders.
            if (step.dependsOn && transcript[step.dependsOn.from.split(".")[0].replace("step", "") - 1]) {
                // ...substitute search id...
                body = substituteServerAssigned(body, transcript);
            }
            try {
                const response = await client.request(step.request.method, step.request.path, body);
                transcript.push({ step: step.step, request: { ...step.request, body }, response });
                lastResponse = response;
            } catch (err) {
                transcript.push({ step: step.step, request: { ...step.request, body }, error: err.message });
                return {
                    isError: true,
                    reason: "blueprint_chain_partial_failure",
                    content: [{ type: "text", text: JSON.stringify({ transcript, failed_at_step: step.step }) }],
                };
            }
        }
        // Final response is the Dashboard ViewDTO from step 2.
        return toIdBody(lastResponse, { idFields: ["id"] });
    },
    summarize: (args) => `Create dashboard "${args.title}" with ${args.widgets?.length ?? 0} widgets (internal Search+View chain)`,
});
```
[CITED: `ViewsResource.java:243-285` (POST /views), `SearchResource.java:102-121` (POST /views/search returns 201+SearchDTO+Location), `ViewDTO.java:243-260` (ViewStateDTO state field), `src/tools/streams/create-stream.js:54-93` (CreateEntityRequest envelope precedent)]

### Pattern 2: Widget Template Frozen Triplet Builder (D-04)

**What:** Each of the 8 named templates lives in `src/widget-templates/{name}.js` and exports a single pure builder function. The builder takes per-template `options` (stream binding, field, time range override, etc.) and returns a Object-frozen `{widget, position, searchType}` triplet. Mismatched widget/position/searchType combinations are STRUCTURALLY IMPOSSIBLE — the composer cannot synthesize a partial triplet.

**When to use:** All 8 templates use this pattern. Also used by `add_widget_from_template` (DASH-06) and by every blueprint that produces a dashboard (BLUE-01, BLUE-03).

**Example (error_rate_over_time):**
```javascript
// src/widget-templates/error-rate-over-time.js
import { randomUUID } from "node:crypto";

/**
 * Error rate over time — pivot aggregation with time histogram + count series,
 * filtered to level >= 4 (warn/error/fatal). One of the 4 widgets baked into
 * BLUE-01's setup_app_monitoring_stack dashboard.
 *
 * @param {object} options
 * @param {string[]} options.streamIds - Streams to scope the widget to
 * @param {object|null} [options.timerangeOverride] - D-05 default null (inherit-from-dashboard)
 * @returns {{widget: object, position: object, searchType: object}}
 */
export function buildErrorRateOverTime(options = {}) {
    const widgetId = options.widgetId ?? randomUUID();
    const searchTypeId = options.searchTypeId ?? randomUUID();
    const streamIds = options.streamIds ?? [];

    const searchType = {
        type: "pivot",
        id: searchTypeId,
        name: null,
        row_groups: [{
            type: "time",
            fields: ["timestamp"],
            interval: { type: "timeunit", value: 1, unit: "auto" },
        }],
        column_groups: [],
        series: [{
            type: "count",
            id: "count()",  // SeriesSpec default literal (Count.java:90)
            field: null,    // count() with no field → count all matching messages
        }],
        sort: [],
        rollup: true,
        filter: null,
        filters: [],
        query: { type: "elasticsearch", query_string: "level:>=4" },
        // D-05: per-widget timerange ABSENT → inherits from Query.timerange
        ...(options.timerangeOverride ? { timerange: options.timerangeOverride } : {}),
        streams: streamIds,
        stream_categories: [],
    };

    const widget = {
        id: widgetId,
        type: "aggregation",
        filter: null,
        filters: [],
        // D-05: per-widget timerange ABSENT
        ...(options.timerangeOverride ? { timerange: options.timerangeOverride } : {}),
        query: { type: "elasticsearch", query_string: "level:>=4" },
        streams: streamIds,
        stream_categories: [],
        config: {
            row_pivots: [{
                fields: ["timestamp"],
                type: "time",
                config: { interval: { type: "timeunit", value: 1, unit: "auto" } },
            }],
            column_pivots: [],
            series: [{ config: {}, function: "count()" }],
            sort: [],
            visualization: "bar",
            rollup: true,
            event_annotation: false,
        },
        description: "Error rate over time (level >= 4)",
    };

    const position = options.position ?? {
        col: { type: "infinity" },   // full width (Position tagged union)
        row: 1,
        height: 4,
        width: 6,
    };

    return Object.freeze({ widget, position, searchType });
}
```
[CITED: `WidgetDTO.java:48-96` (FIELD_TYPE + FIELD_CONFIG + FIELD_STREAMS), `AggregationConfigDTO.java:41-50` (NAME="aggregation"), `Pivot.java:51-77` (row_groups + series), `Count.java:44-49` (field is Optional<String>; literal = "count(<field>)"), `Time.java:34-50` (bucket type="time"), `TimeUnitIntervalDTO.java:31-69` (interval shape), `ValueConfigDTO.java:33-55` (values bucket — used by top_sources_by_volume etc.)]

### Pattern 3: Blueprint Chain-Transcript Composition (D-07, D-08)

**What:** Every blueprint's `build()` returns `{chain: [{step, tool, request, dependsOn?, postApplyEstimate?}, ...]}`. Every blueprint's `apply()` walks the chain, substitutes `__SERVER_ASSIGNED__` placeholders using prior steps' responses, accumulates a transcript `[{step, request, response | error}, ...]`. On partial failure: returns isError envelope with the transcript so far + which step failed.

**When to use:** All 6 blueprints (BLUE-01..BLUE-06). DASH-03 ALSO uses this internally (it's a 2-step blueprint that happens to be exposed as a single tool).

**Example:**
```javascript
// src/tools/_shared/blueprint-chain.js
import { SERVER_ASSIGNED_SENTINEL } from "./dry-run.js";

/**
 * Walk a blueprint chain at apply-time, substituting __SERVER_ASSIGNED__
 * placeholders from prior steps' responses. Returns either:
 *   - { applied: true, transcript: [{step, request, response}, ...] }
 *   - { isError: true, reason: "blueprint_chain_partial_failure", ... }
 */
export async function executeChain(client, chain, services) {
    const transcript = [];
    for (const step of chain) {
        let body = step.request.body;
        let path = step.request.path;

        // D-08: substitute placeholder ids from prior responses.
        if (step.dependsOn) {
            const prior = transcript.find((t) => t.step === parseInt(step.dependsOn.from.match(/step(\d+)/)[1], 10));
            if (!prior || !prior.response?.id) {
                return {
                    isError: true,
                    reason: "blueprint_chain_unresolved_dependency",
                    content: [{ type: "text", text: JSON.stringify({ transcript, missing_dependency: step.dependsOn }) }],
                };
            }
            const replacement = prior.response.id;
            // Recursive search/replace on body + path for the SENTINEL.
            body = substitutePlaceholders(body, step.dependsOn, replacement);
            path = path.replace(`{${step.dependsOn.as}}`, replacement);
        }

        try {
            const response = await client.request(step.request.method, path, body);
            transcript.push({ step: step.step, tool: step.tool, request: { method: step.request.method, path, body }, response });
        } catch (err) {
            transcript.push({ step: step.step, tool: step.tool, request: { method: step.request.method, path, body }, error: err.message ?? String(err) });
            return {
                isError: true,
                reason: "blueprint_chain_partial_failure",
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        transcript,
                        failed_at_step: step.step,
                        succeeded_steps: transcript.filter((t) => !t.error).map((t) => t.step),
                    }),
                }],
            };
        }
    }
    return { applied: true, transcript };
}

function substitutePlaceholders(obj, dependsOn, replacement) {
    // Walk obj recursively, replacing SERVER_ASSIGNED_SENTINEL + step marker with `replacement`.
    if (typeof obj !== "object" || obj === null) {
        if (typeof obj === "string" && obj === `${SERVER_ASSIGNED_SENTINEL}${dependsOn.from.split(".")[0]}`) {
            return replacement;
        }
        return obj;
    }
    if (Array.isArray(obj)) return obj.map((v) => substitutePlaceholders(v, dependsOn, replacement));
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = substitutePlaceholders(v, dependsOn, replacement);
    return out;
}
```
[CITED: PITFALLS.md §C6 "dependsOn: {from: \"step1.response.id\", as: \"streamId\"} annotations"]

### Pattern 4: Services-Layer Composition (D-09, D-10)

**What:** Blueprints import functions from `src/services/*.js`, NEVER from `src/tools/<domain>/*.js`. Services are pure HTTP wrappers `(client, args) -> Promise<graylogResponse>`. No MCP coupling, no dryRun branching, no idempotency-key. The dryRun branching lives at the blueprint's handler layer (via `defineMutatingHandler`); the apply path calls into services sequentially.

**When to use:** All 6 blueprints. DASH-03's internal Search+View chain ALSO uses `src/services/dashboards.js` (the `createSearch` + `createDashboard` functions).

**Example:**
```javascript
// src/services/streams.js
/**
 * Pure HTTP wrapper: create a stream. Returns the full response shape from
 * Graylog (POST /api/streams returns 201 + {stream_id: "<uuid>"} + Location).
 * Caller is responsible for any dry-run, idempotency-key, or response
 * normalization — services are intentionally thin.
 */
export async function createStream(client, { title, description, indexSetId, matchingType, rules }) {
    const body = {
        entity: {
            title,
            description: description ?? null,
            rules: (rules ?? []).map(translateRule),  // numeric-type translation
            content_pack: null,
            matching_type: matchingType ?? "AND",
            remove_matches_from_default_stream: false,
            index_set_id: indexSetId,
        },
        share_request: null,
    };
    return client.request("POST", "/api/streams", body);
}

// (similar pure wrappers for: addRule, deleteStream, startStream, pauseStream)

// src/services/dashboards.js
export async function createSearch(client, searchDTO) {
    return client.request("POST", "/api/views/search", searchDTO);
}

export async function createDashboard(client, viewDTO) {
    return client.request("POST", "/api/views", { entity: viewDTO, share_request: null });
}

export async function updateDashboard(client, dashboardId, viewDTO) {
    return client.request("PUT", `/api/views/${dashboardId}`, { entity: viewDTO, share_request: null });
}

// (similar for: updateSearch, deleteDashboard, getDashboard)
```
[CITED: ARCHITECTURE.md §6 "Blueprints compose from services/, not other handlers"; Phase 4 SUMMARY notes the same boundary]

### Pattern 5: Update Semantics (DASH-04)

**What:** `update_dashboard` follows STRICT_NO_ECHO partial-update (Phase 5 D-10 precedent). The wrapper does NOT round-trip the full ViewDTO — it sends ONLY agent-touched fields. The `searchId` field is **IMMUTABLE** post-create: agents that pass a different `searchId` are rejected at zod (the schema excludes it). To change widget composition, agents use `add_widget_from_template` (DASH-06) and `remove_widget` (DASH-07) which orchestrate the Search+View pair correctly.

**When to use:** ONLY `update_dashboard` (DASH-04). For widget modifications, use DASH-06 / DASH-07.

**Example:**
```javascript
// src/tools/dashboards/update-dashboard.js
export const handleUpdateDashboard = defineMutatingHandler({
    name: "update_dashboard",
    schema: UpdateDashboardSchema,  // {dashboardId, changes: {title?, description?, summary?}}
    async build(args) {
        // STRICT_NO_ECHO: agent passes ONLY the fields to change.
        // searchId is INTENTIONALLY ABSENT from the schema — D-02 immutability.
        // Pre-flight GET fetches current.searchId so the PUT body carries it
        // (Graylog 7.0.6 server-side requires the full ViewDTO on PUT per
        // validateIntegrity which dereferences dto.searchId).
        const client = makeClient(args._conn);
        const current = await client.request("GET", `/api/views/${args.dashboardId}`, null);

        const body = {
            entity: {
                ...current,           // round-trip the immutable parts (id, searchId, state, type)
                id: args.dashboardId, // Pitfall 8 (Phase 5 EVENT) — id must match URL
                ...args.changes,      // overlay agent's changes
            },
            share_request: null,
        };
        return {
            method: "PUT",
            path: `/api/views/${args.dashboardId}`,
            body,
            postApplyEstimate: { id: args.dashboardId },
            normalize: (raw) => ({ id: raw?.id, body: raw }),
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) => `Update dashboard ${args.dashboardId} (${Object.keys(args.changes ?? {}).join(", ")})`,
});
```
[CITED: `ViewsResource.java:389-405` (PUT /views/{id} via CreateEntityRequest wrapper, runs validateIntegrity); Phase 5 update_event_definition STRICT_NO_ECHO precedent (`src/tools/events/update-event-definition.js`)]

### Anti-Patterns to Avoid

- **Agent-supplied `searchId` to `create_dashboard`.** D-02 STRUCTURALLY forbids this — the zod schema MUST NOT include a `searchId` field. The wrapper is the SOLE authority for Search-to-View linkage. (See PITFALLS.md §C7 line 167: "Never expose a `create_dashboard` that takes a `searchId` parameter".)
- **Calling another tool handler from a blueprint.** Anti-pattern 1 from ARCHITECTURE.md. Double-validation, double-dry-run, opaque error propagation. Blueprints call into `src/services/*` instead.
- **Hand-rolling the Search+View chain inside each blueprint.** Use the `dashboards.createDashboard` service (which itself orchestrates the Search+View pair internally) so the C7 mitigation lives in EXACTLY ONE place. BLUE-01, BLUE-03, and DASH-03's underlying chain all flow through the same service function.
- **Echoing widget IDs from a GET on update.** `update_dashboard` does NOT mutate widget composition — it touches title/description/summary only. Widget changes go through DASH-06/DASH-07 which orchestrate the Search+View pair atomically.
- **Letting `add_widget_from_template` skip the Search update.** Adding a widget REQUIRES a new SearchType (the widget's data source). The wrapper MUST PUT the updated Search AND the updated View — failing to update the Search leaves the View referencing a non-existent SearchType (validateSearchProperties line 355-361 throws BadRequestException).
- **Storing user-supplied widget IDs as the canonical key.** Widget IDs are wrapper-generated UUIDs (Pivot.java:184-188 and MessageList.java:191-194 confirm server-side fallback). Snapshot tests use a seeded RNG mock for byte-stable output.
- **Treating BLUE-01 partial failure as success.** Phase 5's D-09 set the precedent: any apply that returns `isError: true` from a step in the chain MUST surface which steps succeeded so the agent can decide whether to clean up. The transcript shape is non-negotiable.
- **Bypassing the writable gate on blueprints.** `defineMutatingHandler` short-circuits ALL handlers — including blueprint handlers — when the connection is read-only. Plan 01 must verify blueprint handlers compose through the factory (the wrapper short-circuit covers all 6 BLUE-XX tools).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP client for /views + /views/search | Direct `axios.post` per service | `makeClient(conn).request(method, path, body)` | Phase 0 ships auth, X-Requested-By, error mapping, writable-gate. Duplicating here = 6× the same bug surface |
| Widget UUIDs | Random UUIDs per call without seed | `randomUUID()` from `node:crypto` + seeded mock in tests | Phase 0..5 precedent: snapshot byte-identity requires deterministic UUIDs in tests; production uses real `randomUUID()` |
| Response normalization | Custom field extraction per dashboard tool | `toIdBody(raw, { idFields: ["id"] })` | FOUND-08 ships this; M2/D-17 says POST /views returns 200 + full ViewDTO — `idFields: ["id"]` is correct |
| Title-duplicate pre-check | Hand-rolled list-and-filter | `findExistingMatches(client, { listPath: "/api/views?query=title:..." })` + amend `_shared/conflict.js` to recognize `response.views` envelope | FOUND-11 ships the pattern; the only missing piece is the new `views` envelope key |
| __SERVER_ASSIGNED__ placeholders | Custom marker strings | `SERVER_ASSIGNED_SENTINEL` from `_shared/dry-run.js` | C6 pitfall mitigation; FOUND-04 ships this. For chains, append the step marker: `${SENTINEL}step1` |
| Idempotency key | Per-handler hash derivation | `deriveIdempotencyKey({connectionName, toolName, args})` from `_shared/idempotency.js` | FOUND-10; create_dashboard + every blueprint gets retry-window dedupe for free |
| Connection resolution | New `getActiveConnection()` per blueprint step | `defineMutatingHandler` resolves once via `resolveConnection`; pass `conn` through services | Threat-model T-00-04-05; ARCHITECTURE.md Anti-Pattern 5 |
| Discriminator validation | `switch` on `templateName` | `z.enum([...8 names])` in DASH-06's schema | M7 mitigation; invalid names reject at zod parse BEFORE any HTTP |
| Cascade-hash for delete_dashboard | None — no cascade-hash | Plain `defineMutatingHandler` informational delete | Dashboards are LEAF resources — no other entity references a dashboard. `delete_dashboard` is a pure leaf-delete (cf. Phase 5 `delete_event_definition` D-08); no token, no drift refusal |
| Pipeline rule DSL generation in BLUE-04 | Custom string concatenation | `emitRule({ name, when, then })` from `src/pipeline-dsl/emit.js` (Phase 4) | Threat T-04-01-05: no inline `${value}` template interpolation. Phase 4 ships the structured-intent emitter |
| Blueprint dry-run shape | Custom `{steps: [...]}` per blueprint | The shared `chain: [...]` shape from `_shared/blueprint-chain.js` | Consistency across all 6 blueprints + DASH-03 reuses it; agent learns one shape |

**Key insight:** Every Phase 6 piece composes through Phase 0..5 primitives PLUS three NEW small modules: `src/services/*` (thin HTTP wrappers, ~50-80 LOC per file × 6 files), `src/widget-templates/*` (~30-60 LOC per template × 8 templates + ~20 LOC index), and `src/tools/_shared/blueprint-chain.js` (~40 LOC). The C7 mitigation centerpiece — the internal Search+View chain — lives in EXACTLY ONE place: `src/services/dashboards.js`'s `createDashboard` orchestrator function. Every blueprint that needs a dashboard calls into that one function.

## Common Pitfalls

### Pitfall 1: PaginatedResponse envelope for /views is `views`, not `dashboards`
**What goes wrong:** Agent code (or `_shared/conflict.js`) expects `result.dashboards: [...]` since the MongoDB collection is named `dashboards`. The list response wraps in `views`.

**Why it happens:** ViewsResource.java:187 calls `PaginatedResponse.create("views", result, query)`. The Mongo collection is `dashboards` per ViewDTO.java line 67's `@DbEntity(collection = "dashboards", ...)` annotation, but the wire envelope keys off `"views"`.

**How to avoid:** Amend `_shared/conflict.js`'s envelope-key search to look for `response.views` (BEFORE the generic `items` fallback). Use `?query=type:DASHBOARD` query parameter to filter dashboards-only (vs saved searches); narrow projection emits `[id, title, summary, description]` per default.

**Warning signs:** Empty list returns when the cluster has dozens of dashboards — the wrapper is consuming `result.dashboards` and getting `undefined`.

[VERIFIED: `ViewsResource.java:159-191` (`views()` method) — line 187: `return PaginatedResponse.create("views", result, query);`]

### Pitfall 2: M2 — POST /views returns 200 with full ViewDTO (NOT 201 + {id})
**What goes wrong:** Agent code that assumes "create returns 201 + `{id}`" parses the response wrong; the wrapper's response normalizer (FOUND-08) must extract `id` from the full DTO body.

**Why it happens:** ViewsResource.java:243-285 `create()` returns `ViewDTO` (the post-save DTO with id populated) without an explicit `Response.created(...)` wrapper — JAX-RS auto-wraps as 200 OK. **POST /views/search**, by contrast, returns 201 + Location header per SearchResource.java:120 (`Response.created(URI.create(result.id())).entity(result).build()`). Both responses carry the full DTO body with `id` populated.

**How to avoid:** Set `req.normalize = (raw) => toIdBody(raw, { idFields: ["id"] })` on every Phase 6 create handler. The Search response shape and View response shape both have `id` at the top level — `idFields: ["id"]` is correct for both.

**Warning signs:** Apply-mode result's `id` field is `undefined` — the wrapper is looking at the wrong response field.

[VERIFIED: `ViewsResource.java:243-285` (no explicit Response.status); `SearchResource.java:120` (Response.created URI)]

### Pitfall 3: CreateEntityRequest envelope wrapper required on POST /views (same as Phase 3+5)
**What goes wrong:** Agent (or wrapper code) emits `body: { ...ViewDTO fields }` directly; Graylog rejects with 400 because `create()` parameter type is `CreateEntityRequest<ViewDTO>` (ViewsResource.java:246), which is `{entity: <dto>, share_request: <ShareRequest|null>}`. The wrapper must wrap.

**Why it happens:** Same `CreateEntityRequest` wrapper Phase 3 `create_stream` and Phase 5 `create_event_definition` already hit.

**How to avoid:** `req.body = { entity: <viewDTO>, share_request: null }`. **NOTE:** POST `/views/search` does NOT use this envelope — it accepts the bare SearchDTO body per SearchResource.java:111. Only `/views` (and PUT `/views/{id}`) wraps.

**Warning signs:** Live cluster returns 400 "Missing required field `entity`" when applying.

[VERIFIED: `ViewsResource.java:246` (`@RequestBody ... CreateEntityRequest<ViewDTO> createEntityRequest`); `SearchResource.java:111` (`@RequestBody SearchDTO searchRequest` — bare DTO, NO envelope)]

### Pitfall 4: Widget-position integrity is BIDIRECTIONAL in Graylog source (wrapper validator must be too)
**What goes wrong:** A handcrafted dashboard payload that has a widget without a corresponding widgetPosition entry returns 400 with a useful-but-cryptic error like "Widget positions don't correspond to widgets, missing widget positions [w-123]; widget IDs: [w-123, w-456]; widget positions: [w-456]". Reverse problem (widgetPosition without a matching widget) is NOT checked by Graylog 7.2-source but is poor hygiene.

**Why it happens:** `ViewsResource.validateSearchProperties` at lines 363-378 asserts `widgetPositions.keySet()` ⊇ `widgets.map(WidgetDTO::id)` — every widget needs a position; orphan positions are SILENTLY ACCEPTED by the server. The wrapper's D-03 validator should reject BOTH directions for hygiene (`widgetPositions.keys() === widgets.map(w => w.id)` as a strict-equality check, not a superset check).

**How to avoid:** Implement D-03 as a strict set-equality check in `_shared/widget-position-integrity.js`. Reject with a structured error naming the offending widget IDs in BOTH directions.

**Warning signs:** Live Graylog renders the dashboard but with phantom empty grid cells where orphan widgetPositions reference non-existent widgets.

[VERIFIED: `ViewsResource.java:371-378` — `if (!widgetPositions.containsAll(widgetIds))` — server only checks ⊇, not ==]

### Pitfall 5: `widgetMapping` is `Map<String, Set<String>>` (widget_id -> SearchType_id[])
**What goes wrong:** Agent code that builds `widgetMapping` as `Map<widget_id, search_type_id>` (singular value) gets a 400 because the wire type is a Set. Even single-source widgets need their searchType_id wrapped in an array.

**Why it happens:** `ViewStateDTO.widgetMapping()` returns `Map<String, Set<String>>` (line 62-63). Jackson serializes Java Set as JSON array. The Set semantics matter for multi-series widgets (one widget driving N SearchTypes), but even simple widgets need the array wrapper.

**How to avoid:** Templates emit `widgetMapping[widget.id] = [searchType.id]` (always an array, even for single-source). The shared template-to-ViewDTO assembler in `src/services/dashboards.js::buildViewDTO` enforces this — templates don't construct widgetMapping themselves; the assembler does.

**Warning signs:** Live cluster returns 400 "Search types do not correspond to view/search types" — the wrapper sent a string where an array was expected.

[VERIFIED: `ViewStateDTO.java:62-63` (`Map<String, Set<String>> widgetMapping()`)]

### Pitfall 6: ViewStateDTO requires Titles + DisplayModeSettings — not Optional
**What goes wrong:** Minimum ViewStateDTO emission omits `titles` and `displayModeSettings`; Graylog 400s because the @JsonCreator builder defaults THESE specific fields (line 122-124 of ViewStateDTO.java) but doesn't auto-fill them if completely absent.

**Why it happens:** `ViewStateDTO.Builder.create()` sets `titles(Titles.empty()).displayModeSettings(DisplayModeSettings.empty())` (lines 121-123). These are required-but-defaulted. Agent payloads that omit them entirely (not setting them to `{}`) MAY pass on 7.2-snapshot but should be tested on 7.0.6.

**How to avoid:** Emit `titles: {titles: {}}` and `displayModeSettings: {positions_inferred: false, show_summary: false, show_message_row: false}` explicitly on every ViewStateDTO. The shared `buildViewDTO` assembler does this; templates don't touch it.

**Warning signs:** Live 7.0.6 returns 400 on `create_dashboard` for the minimum payload but the dry-run snapshot passes. Plan 06-01-U1-SMOKE.md should probe this against live cluster.

[VERIFIED: `ViewStateDTO.java:122-124` (defaults); not yet live-confirmed on 7.0.6 — flagged as Open Question 1]

### Pitfall 7: Stream IDs in widget config — singular or list?
**What goes wrong:** Agent payloads that emit `widget.streams: "<single-id>"` (string) instead of `widget.streams: ["<id>"]` (Set<String>) cause Jackson deserialization to fail with a cryptic 400.

**Why it happens:** WidgetDTO.streams() returns `Set<String>` (WidgetDTO.java:80-81); Pivot.streams() likewise (line 176). Even for a single-stream widget, the wire type is a JSON array.

**How to avoid:** Widget templates always emit `streams: streamIds[]` (array). Schema-side: `z.array(z.string()).default([])` on every template's `options.streamIds` field. The Pivot.streams() and MessageList.streams() server-side fallback is empty-set, NOT a default-stream catch-all — the agent must pass at least one stream id for a meaningful widget.

**Warning signs:** Widget renders zero data on the live dashboard — the wrapper sent `"streamId-uuid"` instead of `["streamId-uuid"]`.

[VERIFIED: `WidgetDTO.java:80-81`, `Pivot.java:176`, `MessageList.java:167` — all `Set<String> streams`]

### Pitfall 8: Search saves with 60-second default timeout; long-running widgets may not render
**What goes wrong:** A dashboard with 12+ widgets querying years of data times out on the Search execution side (`POST /api/views/search/sync?timeout=60000` default) — but `/api/views/search` (the persist endpoint Phase 6 uses) does NOT execute the search, it just saves the SearchDTO. The dashboard renders lazily via the web UI, which calls /sync per widget on view.

**Why it happens:** Phase 6's `create_dashboard` only PERSISTS the Search entity — the widgets render lazily in the Graylog web UI. There is no eager validation that the search returns results in a reasonable time.

**How to avoid:** Phase 6's surface produces a DASHBOARD; performance of the rendered dashboard is the Graylog UI's responsibility (out of scope per CLAUDE.md "no web UI"). Document in `create_dashboard` description: "this creates the dashboard structure; widget data is fetched on view by the Graylog UI — slow queries become slow widget renders, not slow create_dashboard calls."

**Warning signs:** None at create-time; only the agent-as-user later viewing the dashboard sees the slow widget renders.

[VERIFIED: `SearchResource.java:111-121` (POST /views/search does NOT execute), `SearchResource.java:206-222` (POST /views/search/sync DOES execute with @QueryParam timeout default 60000)]

### Pitfall 9: Blueprint partial failure leaves orphaned resources
**What goes wrong:** BLUE-01's 6-step chain succeeds on steps 1-3 (stream + pipeline + rule created) then fails on step 4 (pipeline-stream connect). The agent now has 3 unreferenced resources in Graylog that will never be cleaned up automatically.

**Why it happens:** Graylog has no transaction semantics across REST endpoints. Phase 6's chain-transcript helper (D-08) surfaces partial failure but does NOT auto-rollback.

**How to avoid:** Two-prong: (a) the partial-failure transcript names every succeeded step so the agent can manually clean up via subsequent `delete_*` calls; (b) **idempotency-key auto-derivation** (FOUND-10) means a retried blueprint sees the existing matches from step 1 (via `findExistingMatches` in each service's create) and surfaces `existingMatches: [{id, title, similarity_reason}]` — the agent can choose to reuse the partially-applied state. Document the cleanup pattern in the BLUE-01 tool description.

**Warning signs:** A second BLUE-01 call with the same arguments produces a different transcript (some steps "would create" vs "already exists"). The idempotency key should make this convergent.

[CITED: Phase 1 `findExistingMatches` precedent; Phase 5 `create_event_notification` retry semantics]

### Pitfall 10: `/api/views?query=type:DASHBOARD` filter syntax — Graylog SearchQuery is NOT Lucene
**What goes wrong:** Agent or wrapper code constructs a Lucene-style query string `type:DASHBOARD AND title:App*` for the `?query=` param on `list_dashboards`; Graylog's SearchQuery parser (lines 177-186 of ViewsResource.java) uses a small custom syntax (not full Lucene).

**Why it happens:** ViewsResource builds a `SearchQueryParser(ViewDTO.FIELD_TITLE, SEARCH_FIELD_MAPPING)` with only `id`, `title`, `summary` mapped to fields. Other fields aren't filterable via the `query` param.

**How to avoid:** Use the `?query=type:DASHBOARD` form — the SearchQueryParser supports `field:value`. For type filtering specifically, prefer the **`/api/dashboards`** convenience path if it exists in 7.0.6 (not verified — flagged as Open Question 2). Alternative: always pass `?query=type:DASHBOARD` and accept any saved-searches mixed-in result by filtering wrapper-side on `view.type === "DASHBOARD"`.

**Warning signs:** `list_dashboards` returns saved searches mixed in with dashboards.

[VERIFIED: `ViewsResource.java:112-116` (SEARCH_FIELD_MAPPING only id/title/summary), `ViewsResource.java:177` (`searchQueryParser.parse(query)`); flagged Open Question 2]

## Endpoint Catalogue

### Per-Tool Endpoint Map (14 net-new tools)

| Tool | HTTP | Path | Response | Notes |
|------|------|------|----------|-------|
| `list_dashboards` | GET | `/api/views?query=type:DASHBOARD&page=N&per_page=M&sort=title&order=asc` | `PaginatedResponse<ViewDTO>` → `{views, total, page, per_page, count, ...}` | DASH-01; narrow projection [id, title, summary, description]; wrapper-filter to view.type==="DASHBOARD" if query syntax mixes results (Pitfall 10) |
| `get_dashboard` | GET | `/api/views/{id}` | full ViewDTO | DASH-02; plain GET handler (read tool, not mutatingBase) |
| `create_dashboard` | POST | `/api/views/search` THEN `/api/views` | step1: 201+SearchDTO+Location; step2: 200+ViewDTO | DASH-03 / C7 acceptance gate — internal chain; CreateEntityRequest envelope on /views; bare SearchDTO body on /views/search |
| `update_dashboard` | PUT | `/api/views/{id}` | 200+ViewDTO (M2) | DASH-04; STRICT_NO_ECHO partial-update (title/description/summary only); searchId IMMUTABLE post-create |
| `delete_dashboard` | DELETE | `/api/views/{id}` | 200+ViewDTO (the deleted body) | DASH-05; leaf delete (no cascade — dashboards are not referenced by other entities) |
| `add_widget_from_template` | PUT × 2 | `/api/views/search/{searchId}` THEN `/api/views/{viewId}` | each: 200+DTO | DASH-06; two-step PUT chain (Search update + View update); GET both pre-flight to merge new widget+searchType into existing structure |
| `remove_widget` | PUT × 2 | `/api/views/search/{searchId}` THEN `/api/views/{viewId}` | each: 200+DTO | DASH-07; same two-step PUT chain (strip widget+position+widgetMapping entry AND strip the searchType from Search) |
| `setup_app_monitoring_stack` | n/a (blueprint chain) | 6 endpoints | chain transcript | BLUE-01 headline; chain of [createStream, createPipeline, createRule, connectPipelinesToStream, createDashboard (Search+View internal), createEventDefinition] |
| `setup_error_alerting` | n/a (blueprint chain) | 1-2 endpoints | chain transcript | BLUE-02; chain of [createEventDefinition (already-existing notification reference)] — 1 step if notification exists; 2 steps if it must be created |
| `create_app_health_dashboard` | n/a (blueprint chain) | Search+View (2 endpoints) | chain transcript | BLUE-03; one logical step that orchestrates DASH-03's internal Search+View — effectively `create_dashboard` with 4 pre-wired template widgets |
| `setup_pipeline_for_stream` | n/a (blueprint chain) | 3-N endpoints | chain transcript | BLUE-04; chain of [createPipeline, createRule×N (from structured intent via pipeline-dsl/emit), connectPipelinesToStream] |
| `setup_long_term_archival_index` | n/a (blueprint chain) | 1 endpoint | chain transcript | BLUE-05; one-step chain that wraps create_index_set with bundled size-rotation + delete-retention |
| `setup_debug_log_dropping` | n/a (blueprint chain) | 3 endpoints | chain transcript | BLUE-06; chain of [createRule (drop-on-level-threshold), createPipeline (stage referencing the rule), connectPipelinesToStream] |

### List Path Selection — `/views` query syntax

| Variant | Envelope | Status | Use for Phase 6? |
|---------|----------|--------|------------------|
| `GET /api/views` (paginated) | `{views: [...], total, page, per_page, count, ...}` | current | **YES** for list_dashboards; pair with `?query=type:DASHBOARD` per Pitfall 10 |
| `GET /api/views/{id}` | full ViewDTO | current | **YES** for get_dashboard |
| `GET /api/views/default` | full ViewDTO or 404 | current | Out of scope (per CONTEXT.md Deferred); no `set_default_dashboard` analog in Phase 6 |

**Consequence for `_shared/conflict.js`:** the envelope amendment must look for `response.views` (the PaginatedResponse "views"-keyed shape). Position: AFTER the modern `elements` PageListResponse shape (Phase 5 amendment) since `/api/views` uses the older PaginatedResponse shape.

[VERIFIED: `ViewsResource.java:159-191` (paginated bare GET; PaginatedResponse.create("views", ...)); `PaginatedResponse.java` line ~50 (envelope key is the constructor arg, in this case "views")]

## C7 Mitigation Anatomy

### `create_dashboard` Wire Form (D-01 — internal two-step chain)

**Step 1: Persist the Search entity** (the data source for all widgets):

```http
POST /api/views/search HTTP/1.1
Content-Type: application/json
Accept: application/json
X-Requested-By: graylog-mcp

{
  "queries": [
    {
      "id": "q-1",
      "timerange": {"type": "relative", "from": 300},
      "filter": null,
      "filters": [],
      "query": {"type": "elasticsearch", "query_string": ""},
      "search_types": [
        {"type": "pivot", "id": "st-1", "name": null, "row_groups": [{"type":"time","fields":["timestamp"],"interval":{"type":"timeunit","value":1,"unit":"auto"}}], "column_groups": [], "series": [{"type":"count","id":"count()","field":null}], "sort": [], "rollup": true, "filter": null, "filters": [], "query": {"type":"elasticsearch","query_string":"level:>=4"}, "streams":["66e8...stream-id..."], "stream_categories":[]},
      ]
    }
  ],
  "parameters": [],
  "skipNoStreamsCheck": false
}
```
→ Returns **201 + SearchDTO** with `id: "<search-id-uuid>"` + `Location: /<search-id>`. Wrapper captures the id.

**Step 2: Persist the View (Dashboard)** with `searchId` set to step 1's id:

```http
POST /api/views HTTP/1.1
Content-Type: application/json
Accept: application/json
X-Requested-By: graylog-mcp

{
  "entity": {
    "type": "DASHBOARD",
    "title": "Payment Service Health",
    "summary": "Error rate, top sources, level distribution, recent events",
    "description": "",
    "search_id": "<search-id-uuid>",
    "properties": [],
    "requires": {},
    "state": {
      "q-1": {
        "selected_fields": null,
        "static_message_list_id": null,
        "titles": {"titles": {}},
        "widgets": [
          {"id": "w-1", "type": "aggregation", "filter": null, "filters": [], "query": {"type":"elasticsearch","query_string":"level:>=4"}, "streams": ["66e8...stream-id..."], "stream_categories": [], "config": {"row_pivots": [...], "column_pivots": [], "series": [...], "sort": [], "visualization": "bar", "rollup": true, "event_annotation": false}, "description": "Error rate over time (level >= 4)"}
        ],
        "widget_mapping": {"w-1": ["st-1"]},
        "positions": {
          "w-1": {"col": {"type":"infinity"}, "row": 1, "height": 4, "width": 6}
        },
        "formatting": null,
        "display_mode_settings": {"positions_inferred": false, "show_summary": false, "show_message_row": false}
      }
    },
    "favorite": false
  },
  "share_request": null
}
```
→ Returns **200 + full ViewDTO** with `id: "<dashboard-id-uuid>"`. Wrapper extracts the id; the agent sees the dashboard id in the final result transcript step.

**Crucial:**
- The wrapper assembles BOTH bodies inside `build()`. The dry-run preview is the **chain** of both planned requests with `dependsOn: {from: "step1.response.id", as: "searchId"}` annotating step 2.
- The agent NEVER sees the intermediate Search ID in its tool call — the apply transcript surfaces both step responses but the agent's mental model is "create_dashboard returned a dashboard id".
- D-02 STRUCTURAL ENFORCEMENT: the zod schema has NO `searchId` field. The agent CANNOT supply one.
- D-03 client-side validator runs BEFORE step 1 is even emitted — if widgets and widgetPositions don't match exactly, the call refuses with `widget_position_integrity_violation` and zero HTTP round-trips.

### Widget-Position Integrity Validator (D-03 — client-side)

```javascript
// src/tools/_shared/widget-position-integrity.js

/**
 * Verify that every widget has a matching widgetPosition AND every
 * widgetPosition has a matching widget. Bidirectional strict-equality
 * check (Pitfall 4 — server only validates ⊇, not ==).
 *
 * @param {{id: string}[]} widgets - Widget DTOs with id
 * @param {Record<string, object>} widgetPositions - Map keyed by widget id
 * @throws WidgetPositionIntegrityError on any mismatch
 */
export function validateWidgetPositionIntegrity(widgets, widgetPositions) {
    const widgetIds = new Set(widgets.map((w) => w.id));
    const positionIds = new Set(Object.keys(widgetPositions));

    const widgetsWithoutPositions = [...widgetIds].filter((id) => !positionIds.has(id));
    const positionsWithoutWidgets = [...positionIds].filter((id) => !widgetIds.has(id));

    if (widgetsWithoutPositions.length || positionsWithoutWidgets.length) {
        const err = new Error(
            `Widget/position integrity violation: ` +
            `widgets missing positions [${widgetsWithoutPositions.join(", ")}]; ` +
            `positions missing widgets [${positionsWithoutWidgets.join(", ")}]`,
        );
        err.reason = "widget_position_integrity_violation";
        err.isClientSide = true;
        throw err;
    }
}
```

The validator is called from `create_dashboard.build()` BEFORE the Search emission. It is ALSO called from `add_widget_from_template.build()` and `remove_widget.build()` AFTER the wrapper has computed the would-be new widgets+positions sets — catching any composition bug before the wire.

### `add_widget_from_template` Wire Form (DASH-06)

Two-step PUT chain (mirror of create's two-step POST). The wrapper:

1. GETs the current ViewDTO (to learn `searchId`, current `widgets`, current `widgetPositions`, current `widgetMapping`, current `state` key — typically the single query id `q-1`).
2. GETs the current SearchDTO via `GET /api/views/search/{searchId}` (to learn current `searchTypes` in the relevant Query).
3. Builds the new triplet from the template name + options (frozen builder from `src/widget-templates/{name}.js`).
4. Computes new sets: `widgets ∪ {newWidget}`, `widgetPositions[newWidget.id] = newPosition`, `widgetMapping[newWidget.id] = [newSearchType.id]`, Search query[0].searchTypes `∪ {newSearchType}`.
5. Runs D-03 validator on the prospective new sets.
6. PUTs both: `PUT /api/views/search/{searchId}` (with new SearchDTO) then `PUT /api/views/{viewId}` (with new ViewDTO via CreateEntityRequest envelope).

**Atomicity:** Phase 6 does NOT attempt transactional rollback if PUT 1 succeeds and PUT 2 fails. The transcript surfaces the partial state; the agent can call `remove_widget` on the new widget id to recover. (Same pattern as BLUE-01 partial failure — Pitfall 9.)

### `remove_widget` Wire Form (DASH-07)

Symmetric to `add_widget_from_template`. GET both → compute difference (strip widget triplet + searchType) → run D-03 validator on prospective new sets → PUT both.

### Update Semantics — `update_dashboard` (DASH-04)

STRICT_NO_ECHO partial update. Agent passes `changes: {title?, description?, summary?}`. The wrapper:
1. GETs current ViewDTO (for searchId + state + immutable parts that the PUT body must round-trip).
2. Overlays `changes` on the GET response, leaving `searchId`, `state`, `type`, `id` IMMUTABLE.
3. PUTs the merged ViewDTO via `/api/views/{id}` with CreateEntityRequest envelope.

**searchId is REJECTED at schema-validation** if the agent tries to pass it (D-02 structural enforcement). Widget composition changes MUST go through DASH-06/DASH-07.

## Widget Template Catalogue (8 Templates)

Each template is a frozen `{widget, position, searchType}` triplet builder taking per-template `options`. All eight share the same shape; only the SearchType internals differ. Default sizes assume a 12-column Graylog grid; agents can override via `options.position`.

### Template 1: `error_rate_over_time` (histogram, level >= 4)

| Field | Value |
|-------|-------|
| Widget type | `aggregation` |
| SearchType type | `pivot` |
| row_groups | Single time bucket: `{type:"time", fields:["timestamp"], interval:{type:"timeunit",value:1,unit:"auto"}}` |
| column_groups | `[]` |
| series | `[{type:"count", id:"count()", field:null}]` (count all messages matching the query) |
| visualization | `"bar"` |
| query | `{type:"elasticsearch", query_string:"level:>=4"}` |
| Default position | `{col:{type:"infinity"}, row:1, height:4, width:6}` |
| Options | `{streamIds, timerangeOverride?, widgetId?, searchTypeId?, position?}` |

### Template 2: `top_sources_by_volume` (field aggregation, count by source)

| Field | Value |
|-------|-------|
| Widget type | `aggregation` |
| SearchType type | `pivot` |
| row_groups | Single values bucket: `{type:"values", fields:["source"], limit:15, skip_empty_values:true}` |
| column_groups | `[]` |
| series | `[{type:"count", id:"count()", field:null}]` |
| visualization | `"table"` (with sort by count desc) |
| sort | `[{type:"series", id:"count()", direction:"Descending"}]` |
| query | `{type:"elasticsearch", query_string:""}` (no filter — show ALL sources) |
| Default position | `{col:7, row:1, height:4, width:6}` |
| Options | `{streamIds, limit?:15, timerangeOverride?, position?}` |

### Template 3: `level_distribution` (pie/donut, count by level)

| Field | Value |
|-------|-------|
| Widget type | `aggregation` |
| SearchType type | `pivot` |
| row_groups | Single values bucket: `{type:"values", fields:["level"], limit:10, skip_empty_values:false}` |
| series | `[{type:"count", id:"count()", field:null}]` |
| visualization | `"pie"` |
| Default position | `{col:1, row:5, height:4, width:4}` |
| Options | `{streamIds, timerangeOverride?, position?}` |

### Template 4: `top_error_clusters` (data table from cluster_log_messages output)

**Special:** This template's data source is NOT a Graylog SearchType — it's the agent's `cluster_log_messages` tool output (which Phase 0..5 already ships). Rendering this in a dashboard requires either:
- **Option A**: Persist the clustering output as a text-widget (Phase 6 ships a `text` widget config via TextWidgetConfigDTO — VERIFIED at line 32 of the widgets/ enumeration earlier).
- **Option B**: Defer this template to v2.4 — Graylog has no first-class "log cluster" widget type.

**RESEARCHER RESOLUTION:** Plan 03 ships `top_error_clusters` as a TEXT widget (`type: "text"`) whose `text` field is a markdown-rendered summary of the top N clusters from a separate `cluster_log_messages` call. Template options carry `{streamIds, clusterCount?:10}` and the builder produces a placeholder text widget that the agent populates via a separate `update_widget_text` call (NOT in Phase 6 scope) OR via the manual UI. **Trade-off:** the template ships as a static structural placeholder; populating it dynamically is deferred. This keeps Phase 6's surface DASH-08 commitment (8 templates) while being honest that one of them is a structural-only template.

[Flagged Open Question 3 — should `top_error_clusters` ship as a text-widget placeholder, or be deferred entirely?]

### Template 5: `request_rate_over_time` (histogram, configurable filter)

| Field | Value |
|-------|-------|
| Widget type | `aggregation` |
| SearchType type | `pivot` |
| row_groups | Same time bucket as Template 1 |
| series | `[{type:"count", id:"count()", field:null}]` |
| visualization | `"line"` |
| query | `{type:"elasticsearch", query_string: options.queryString ?? ""}` — agent supplies filter |
| Default position | `{col:1, row:1, height:4, width:6}` |
| Options | `{streamIds, queryString?, timerangeOverride?, position?}` |

### Template 6: `field_value_distribution` (configurable field aggregation)

| Field | Value |
|-------|-------|
| Widget type | `aggregation` |
| SearchType type | `pivot` |
| row_groups | Single values bucket: `{type:"values", fields:[options.field], limit:options.limit??15, skip_empty_values:true}` |
| series | `[{type:"count", id:"count()", field:null}]` |
| visualization | `"table"` |
| Default position | `{col:1, row:1, height:4, width:6}` |
| Options | `{streamIds, field (REQUIRED), limit?:15, queryString?, timerangeOverride?, position?}` |

### Template 7: `recent_events_table` (message table, configurable filter)

| Field | Value |
|-------|-------|
| Widget type | `messages` (MessageList — different from aggregation!) |
| SearchType type | `messages` (MessageList.NAME line 56) |
| limit | 100 (MessageList default per Java line 105) |
| sort | `[{field:"timestamp", order:"DESC"}]` |
| fields | `["timestamp", "source", "level", "message"]` |
| visualization | none (MessageList widgets don't have a visualization config) |
| widget config | `{type:"messages", fields:["timestamp","source","level","message"], show_message_row:true, show_summary:false, decorators:[], sort:[{field:"timestamp", order:"DESC"}]}` (MessageListConfigDTO) |
| query | `{type:"elasticsearch", query_string: options.queryString ?? ""}` |
| Default position | `{col:{type:"infinity"}, row:9, height:6, width:12}` (full-width, full-height bottom row) |
| Options | `{streamIds, queryString?, fields?, limit?, timerangeOverride?, position?}` |

### Template 8: `stream_activity_overview` (per-stream count over time)

| Field | Value |
|-------|-------|
| Widget type | `aggregation` |
| SearchType type | `pivot` |
| row_groups | Time bucket + values bucket on `streams` field: `[{type:"time", fields:["timestamp"], interval:{type:"timeunit",value:5,unit:"minutes"}}, {type:"values", fields:["streams"], limit:10}]` |
| series | `[{type:"count", id:"count()", field:null}]` |
| visualization | `"area"` (stacked) |
| Default position | `{col:1, row:1, height:4, width:12}` (full-width) |
| Options | `{streamIds?, timerangeOverride?, position?}` — if streamIds omitted, queries across ALL streams |

[CITED: All templates source-walk against `Pivot.java`, `Count.java`, `Values.java`, `Time.java`, `MessageList.java`, `MessageListConfigDTO.java`, `AggregationConfigDTO.java`. Wire shapes verified against the JsonProperty annotations + Builder defaults.]

## ViewDTO Field Shape (for snapshot fixtures)

Full DTO surface as serialized by Graylog 7.2-snapshot for a DASHBOARD type:

```json
{
  "id": "66e8a4bce8f3a4001b88c123",
  "type": "DASHBOARD",
  "title": "Payment Service Health",
  "summary": "Error rate, top sources, level distribution, recent events",
  "description": "",
  "search_id": "66e8a4bce8f3a4001b88c456",
  "properties": [],
  "requires": {},
  "state": {
    "q-1": {
      "selected_fields": null,
      "static_message_list_id": null,
      "titles": {"titles": {}},
      "widgets": [
        { /* 4 widget DTOs per BLUE-01 */ }
      ],
      "widget_mapping": {
        "w-1": ["st-1"],
        "w-2": ["st-2"],
        "w-3": ["st-3"],
        "w-4": ["st-4"]
      },
      "positions": {
        "w-1": {"col": {"type":"infinity"}, "row": 1, "height": 4, "width": 6},
        "w-2": {"col": 7, "row": 1, "height": 4, "width": 6},
        "w-3": {"col": 1, "row": 5, "height": 4, "width": 4},
        "w-4": {"col": {"type":"infinity"}, "row": 9, "height": 6, "width": 12}
      },
      "formatting": null,
      "display_mode_settings": {"positions_inferred": false, "show_summary": false, "show_message_row": false}
    }
  },
  "owner": "admin",
  "created_at": "2026-05-16T12:00:00.000Z",
  "last_updated_at": "2026-05-16T12:00:00.000Z",
  "favorite": false
}
```

[VERIFIED: `ViewDTO.java:73-92` (FIELD_TITLE/SUMMARY/DESCRIPTION/SEARCH_ID/PROPERTIES/REQUIRES/STATE/etc.); `ViewStateDTO.java:39-46` (FIELD_TITLES/WIDGETS/WIDGET_MAPPING/WIDGET_POSITIONS/etc.); `WidgetPositionDTO.java:27-37` (col/row/height/width)]

## BLUE-01 Chain Anatomy (The Headline)

`setup_app_monitoring_stack({app_name, source_pattern})` chains 6 steps. Each step's `dependsOn` shows which prior step's response feeds it:

| # | Step | Service Call | dependsOn | Wire summary |
|---|------|--------------|-----------|---------------|
| 1 | Create stream | `services.streams.createStream({title: "${app_name} stream", indexSetId, matchingType:"AND", rules: [{type:"match_input"/"regex_match" on field:"source", value:source_pattern}]})` | — | POST /api/streams → 201 + {stream_id} |
| 2 | Create pipeline rule (drop debug) | `services.pipelines.createRule({source: emitRule({name:"${app_name} drop debug", when:{type:"comparison",left:{type:"field_ref",source:"message",field:"level"}, op:">", right:{type:"literal",value:7}}, then:[{type:"function_call_statement",name:"drop_message",args:{positional:[]}}]})})` | — | POST /api/system/pipelines/rule → 200 + RuleSource |
| 3 | Create pipeline | `services.pipelines.createPipeline({title:"${app_name} pipeline", source: pipelineSource(stage: step2.rule_id)})` | step2.response.id → ruleId in pipeline source | POST /api/system/pipelines → 200 + PipelineSource |
| 4 | Connect pipeline to stream | `services.pipelines.connectToStream({streamId, pipelineIds:[step3.id]})` | step1.response.stream_id → streamId; step3.response.id → pipelineIds[0] | POST /api/system/pipelines/connections/to_stream → 200 + body |
| 5 | Create dashboard (4 widgets) | `services.dashboards.createDashboard({title:"${app_name} health", widgets: [error_rate_over_time, top_sources_by_volume, level_distribution, recent_events_table].map(t => t.build({streamIds:[step1.stream_id]}))})` — this is itself the internal Search+View 2-step from DASH-03 | step1.response.stream_id → widgets[].streamIds | POST /api/views/search (step 5a) + POST /api/views (step 5b) |
| 6 | Create error-rate event definition | `services.events.createEventDefinition({title:"${app_name} error rate", config:{type:"aggregation-v1", query:"level:>=4", streams:[step1.stream_id], series:[...], conditions:{...}, ...}})` | step1.response.stream_id → config.streams[0] | POST /api/events/definitions?schedule=false (Phase 5 M1 default carried forward) → 200 + EventDefinitionDto |

**Total chain length:** 6 conceptual steps, 7 HTTP round-trips (step 5 is itself a 2-step internal chain).

**Partial failure surface:** if step 4 fails after steps 1-3 succeed, the transcript shows `failed_at_step: 4` + `succeeded_steps: [1, 2, 3]`. Agent retries with the same idempotency key — step 1 returns existingMatches, step 2/3 are idempotent (Phase 4 PIPE-08/PIPE-13 already ship existingMatches surfaces).

**Chain transcript shape (dry-run):**

```json
{
  "dryRun": true,
  "tool": "setup_app_monitoring_stack",
  "connection": "test",
  "idempotencyKey": "<sha-256 of normalized args>",
  "summary": "Set up app monitoring stack for payment-svc (stream + pipeline + 2 rules + connection + dashboard with 4 widgets + error event)",
  "chain": [
    {"step": 1, "tool": "create_stream", "request": {"method": "POST", "path": "/api/streams", "body": {...}}, "postApplyEstimate": {"id": "__SERVER_ASSIGNED__"}},
    {"step": 2, "tool": "create_pipeline_rule", "request": {"method": "POST", "path": "/api/system/pipelines/rule", "body": {...}}, "postApplyEstimate": {"id": "__SERVER_ASSIGNED__"}},
    {"step": 3, "tool": "create_pipeline", "request": {"method": "POST", "path": "/api/system/pipelines", "body": {...}}, "dependsOn": {"from": "step2.response.id", "as": "ruleId"}, "postApplyEstimate": {"id": "__SERVER_ASSIGNED__"}},
    {"step": 4, "tool": "connect_pipelines_to_stream", "request": {"method": "POST", "path": "/api/system/pipelines/connections/to_stream", "body": {...}}, "dependsOn": [{"from": "step1.response.stream_id", "as": "streamId"}, {"from": "step3.response.id", "as": "pipelineIds[0]"}]},
    {"step": 5, "tool": "create_dashboard", "request": {"method": "POST", "path": "/api/views (internal Search+View chain)", "body": {...}}, "dependsOn": {"from": "step1.response.stream_id", "as": "widget.streamIds[0]"}, "postApplyEstimate": {"id": "__SERVER_ASSIGNED__"}},
    {"step": 6, "tool": "create_event_definition", "request": {"method": "POST", "path": "/api/events/definitions?schedule=false", "body": {...}}, "dependsOn": {"from": "step1.response.stream_id", "as": "definition.config.streams[0]"}, "postApplyEstimate": {"id": "__SERVER_ASSIGNED__"}}
  ],
  "applyHint": "Re-call with dryRun: false to apply"
}
```

## BLUE-02..BLUE-06 Chain Anatomies (Brief)

### BLUE-02 `setup_error_alerting(stream_id, notification_target)`

| # | Step | Service Call |
|---|------|--------------|
| 1 | Create event definition with notifications array pointing to the supplied notification ID | `services.events.createEventDefinition({...notifications: [{notification_id, notification_parameters: null}]})` |

1-step chain. The notification target is assumed to exist; agent obtains its ID from a prior `list_event_notifications` call.

### BLUE-03 `create_app_health_dashboard(stream_id)`

| # | Step | Service Call |
|---|------|--------------|
| 1 | Create dashboard with 4 widgets pre-wired to the stream | `services.dashboards.createDashboard({...widgets: [error_rate_over_time, top_sources_by_volume, level_distribution, recent_events_table].map(t => t.build({streamIds:[stream_id]}))})` — internal Search+View 2-step |

1 logical step (2 HTTP round-trips internally via DASH-03 reuse).

### BLUE-04 `setup_pipeline_for_stream(stream_id, transforms)`

| # | Step | Service Call |
|---|------|--------------|
| 1..N | Create pipeline rule from structured intent | `services.pipelines.createRule({source: emitRule(transforms[i])})` (uses Phase 4's `pipeline-dsl/emit.js`) — one call per transform |
| N+1 | Create pipeline referencing all rules | `services.pipelines.createPipeline({title, source: pipelineSource({stages: rules.map(r => r.id)})})` |
| N+2 | Connect pipeline to stream | `services.pipelines.connectToStream({streamId: stream_id, pipelineIds: [step (N+1).id]})` |

`transforms` is a `z.array(RuleSpecSchema).min(1)` — same RuleSpec shape Phase 4's `create_pipeline_rule` already accepts. The blueprint composes per-transform calls; each step's dry-run body is the structured-intent → DSL emit + Graylog rule API.

### BLUE-05 `setup_long_term_archival_index(name, retention_days)`

| # | Step | Service Call |
|---|------|--------------|
| 1 | Create index set with bundled size-rotation + delete-retention | `services.indexSets.createIndexSet({title:name, rotation_strategy:{type:"org.graylog2.indexer.rotation.strategies.SizeBasedRotationStrategyConfig", max_size:1_073_741_824}, retention_strategy:{type:"org.graylog2.indexer.retention.strategies.DeletionRetentionStrategyConfig", max_number_of_indices: retention_days /*expressed as N×daily-rotation-indices*/}})` |

1-step chain. Bundled rotation+retention strategy is Phase 2's standard create_index_set surface — the blueprint just supplies sensible defaults.

### BLUE-06 `setup_debug_log_dropping(stream_id, min_level)`

| # | Step | Service Call |
|---|------|--------------|
| 1 | Create pipeline rule (drop-on-level-threshold) | `services.pipelines.createRule({source: emitRule({name:"drop sub-${min_level}", when:{type:"comparison",left:{type:"field_ref",source:"message",field:"level"},op:">",right:{type:"literal",value:min_level}}, then:[{type:"function_call_statement",name:"drop_message",args:{positional:[]}}]})})` |
| 2 | Create pipeline referencing the rule | `services.pipelines.createPipeline({title, source: pipelineSource({stages:[step1.id]})})` |
| 3 | Connect pipeline to stream | `services.pipelines.connectToStream({streamId: stream_id, pipelineIds:[step2.id]})` |

3-step chain. NOTE: Graylog's pipeline-rule grammar — `when level > min_level then drop_message();` — drops messages where `level > min_level`. To drop "sub-threshold" (i.e. less-severe-than-min_level), the comparison is `>` because in syslog, HIGHER level numbers = LESS severe. Document this in the tool description to avoid the off-by-one direction error.

## Snapshot Fixture Design (Discretion-03 Resolution — 18 fixtures)

| # | Fixture | Proves |
|---|---------|--------|
| 1 | `list_dashboards` apply (read tool — apply only) | Narrow projection + `?query=type:DASHBOARD` envelope unwrap from `result.views` |
| 2 | `get_dashboard` apply | Full ViewDTO shape including `state[].widgets/widgetPositions/widgetMapping` |
| 3 | `create_dashboard` dry-run (4 widgets, no time-range override) | **C7 ACCEPTANCE GATE**: `chain: [{step:1, POST /api/views/search}, {step:2, POST /api/views, dependsOn:{from:"step1.response.id", as:"searchId"}}]`; both bodies pinned byte-stable; widget IDs are wrapper-generated UUIDs (seeded RNG mock) |
| 4 | `create_dashboard` dry-run with widget-position integrity violation | **D-03 ACCEPTANCE GATE**: returns `widget_position_integrity_violation` error BEFORE step 1 emission |
| 5 | `update_dashboard` dry-run (title-only change) | STRICT_NO_ECHO; PUT body round-trips searchId/state/type immutables; searchId NOT in changes-schema |
| 6 | `delete_dashboard` dry-run | Leaf delete; no cascade-hash; informational cascades.widgets[] count |
| 7 | `add_widget_from_template` dry-run (template: error_rate_over_time) | **D-06 ACCEPTANCE GATE**: triplet generated by template; two-step PUT chain; new searchType appended to Search.queries[0].searchTypes; new widget appended to ViewState.widgets; widgetMapping + widgetPositions updated |
| 8 | `add_widget_from_template` dry-run (invalid templateName rejected at zod) | M7 mitigation: `template_name_invalid` ZodError BEFORE any HTTP |
| 9 | `remove_widget` dry-run | Symmetric two-step PUT chain; widget triplet stripped from Search + View atomically |
| 10 | Widget template — error_rate_over_time builder output | Frozen triplet shape; pivot config with time bucket + count series + level:>=4 query |
| 11 | Widget template — top_sources_by_volume builder output | Values bucket with limit:15; visualization:"table"; sort desc |
| 12 | Widget template — level_distribution builder output | Pie/donut visualization; values bucket on `level` |
| 13 | Widget template — recent_events_table builder output | MessageList widget type (not pivot); MessageListConfigDTO shape; sort by timestamp DESC |
| 14 | Widget template — request_rate_over_time builder output | Histogram pivot; configurable queryString option |
| 15 | Widget template — field_value_distribution builder output | Values bucket on configurable field; default limit:15 |
| 16 | Widget template — stream_activity_overview builder output | Two-bucket pivot (time + streams); stacked area visualization |
| 17 | `setup_app_monitoring_stack` dry-run (BLUE-01 mega-chain) | **BLUE-01 ACCEPTANCE GATE**: 6-step chain transcript with full body of each step + dependsOn annotations; widget IDs deterministic; stream_id sentinel `__SERVER_ASSIGNED__step1` substituted in step 4/5/6 |
| 18 | `setup_app_monitoring_stack` apply with simulated partial failure at step 4 | Partial-failure transcript: `succeeded_steps: [1, 2, 3]`, `failed_at_step: 4`, retry guidance |

Per-blueprint fixtures (additional, lighter):

| # | Fixture | Proves |
|---|---------|--------|
| 19 | `setup_error_alerting` dry-run | 1-step chain — pure event_definition with notifications array |
| 20 | `create_app_health_dashboard` dry-run | 1-step chain (the internal Search+View 2-step under the hood); 4 default templates wired to the stream |
| 21 | `setup_pipeline_for_stream` dry-run (3 transforms) | Multi-step chain with N rule creates + 1 pipeline + 1 connection; structured-intent → DSL emit visible in step bodies |
| 22 | `setup_long_term_archival_index` dry-run | 1-step chain; bundled size-rotation + delete-retention bodies |
| 23 | `setup_debug_log_dropping` dry-run (min_level: 6) | 3-step chain; rule body uses `level > 6` predicate; pipeline references rule id; connection wires to stream |

**Top-7 acceptance gates** (the byte-identical fixtures required to PASS Phase 6):

1. Fixture 3 — `create_dashboard` C7 two-step chain dry-run
2. Fixture 4 — `create_dashboard` D-03 widget-position integrity refusal
3. Fixture 7 — `add_widget_from_template` D-06 triplet composition
4. Fixture 8 — `add_widget_from_template` M7 closed-set rejection
5. Fixture 17 — BLUE-01 mega-chain dry-run
6. Fixture 18 — BLUE-01 apply-time partial-failure transcript
7. Fixture 4 vs Fixture 3 byte-diff confirms widget-position integrity violation refusal happens BEFORE any HTTP (no preview.method/path emitted)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Dashboard CRUD via `/dashboards` REST resource | Dashboards are a sub-type of `View` (with `ViewDTO.Type.DASHBOARD`); CRUD via `/views` | Graylog 3.x → 4.x | Phase 6 targets the `/views` surface exclusively; v2.3 read tools don't touch `/views` at all (they only do search/aggregation/events) |
| Saved-searches and dashboards in separate Mongo collections | Both stored in the `dashboards` collection with `type` discriminator | Graylog 4.x | `list_dashboards` filters via `?query=type:DASHBOARD`; agent never sees saved searches via Phase 6 |
| Widget IDs assigned by Graylog | Widget IDs assigned by client (default fallback to server UUID if null) | Graylog 4.x+ | Wrapper supplies IDs deterministically (seeded RNG in tests) so widgetMapping references work atomically in the POST body |
| Per-widget `searchTypeId` reference | `widgetMapping: Map<widgetId, Set<searchTypeId>>` allowing N:M widget-to-searchType linkage | Graylog 4.x | Phase 6's 8 templates are all 1:1 (single widget, single searchType) — keeps the surface simple |
| `POST /api/views` accepting bare ViewDTO body | `POST /api/views` requiring `CreateEntityRequest<ViewDTO>` envelope | Pre-7.0 → 7.0+ entity-share refactor | Wrapper wraps automatically (Pitfall 3) |
| Series identifier shape `count(source)` | Series identifier shape `count(source)` AND aggregation runtime emits `count_source` | Graylog 7.1 (pr-24703) | Phase 5 C5 mitigation handles the v6→v7 migration for EVENT-03; Phase 6 widgets emit v7-form natively (`series.id` = `count(source)` literal still works on the wire; the C5 migration matters at event-firing not widget-rendering) |

**Deprecated/outdated:**
- Bare `GET /api/views` query syntax mixed with type filtering: Phase 6 always emits `?query=type:DASHBOARD` to filter dashboards-only (avoids Pitfall 10 saved-searches contamination).
- `GET /api/views/default` — out of scope for Phase 6 per CONTEXT.md (no `set_default_dashboard` analog).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `top_error_clusters` template ships as a text-widget placeholder (the cluster_log_messages output is NOT a Graylog SearchType) | §Widget Template Catalogue / Template 4 | If wrong: DASH-08 ships only 7 of 8 named templates; the 8th is deferred to v2.4. Researcher recommendation: still ship as a structural placeholder, document the limitation. **NEEDS USER CONFIRMATION** before Plan 03 commits. |
| A2 | Wrapper-generated UUIDs are deterministic in tests via a seeded RNG mock | §Standard Stack / Supporting | If wrong: snapshot byte-stability breaks; tests must use random UUIDs and assert structural shape instead of byte-identity. Mitigation: standard `node:test` mock pattern; Phase 4's `simulate_pipeline_rule` already uses a similar mock pattern. |
| A3 | `ViewStateDTO.titles` and `displayModeSettings` MUST be present (non-null) on POST /views | §Pitfall 6 | If wrong: omitting them silently fails on Graylog 7.0.6 (live cluster). Mitigation: U1-smoke artifact in Plan 01 probes this. Researcher LEANS toward "MUST be present" per the Builder default-set semantics. |
| A4 | `series.id` literal `count()` (empty field) is accepted by Graylog 7.0.6 for whole-message count widgets | §Widget Template / Template 1 | If wrong: count-all widgets need `series.id = "count"` without parens. Researcher: Count.java line 90 hardcodes `id(NAME + "(" + field().orElse("") + ")");` — empty parens IS the serialized form. Confidence HIGH. |
| A5 | The Position type `{type: "infinity"}` for full-width col is the correct wire form | §ViewDTO Field Shape | If wrong: full-width widgets render as 1-col-wide. Researcher couldn't read the `Position` Java source directly (it's a sealed class with `IntegerPosition` and `InfinityPosition` subclasses); flagged as Open Question 4. Mitigation: U1-smoke probe. |

**Result:** Five `[ASSUMED]` claims remain — all flagged for U1-smoke verification in Plan 01. A1 needs USER CONFIRMATION on the `top_error_clusters` resolution (text-widget placeholder vs defer entirely). A2-A5 are wrapper-implementation choices testable against the live 7.0.6 cluster.

## Open Questions (RESOLVED)

> **RESOLVED 2026-05-15:** All 4 questions have inline researcher recommendations consumed by the plans — Q1 documented in §Widget Template Catalogue Template 4 (Plan 03 ships text-widget placeholder pending USER CONFIRMATION); Q2 Plan 01 U1-smoke probe; Q3 USER CONFIRMATION request via Plan 03 RESEARCH ahead of commit; Q4 Plan 01 U1-smoke probe.

1. **Does `/api/views?query=type:DASHBOARD` actually filter cleanly or do saved-searches leak through?**
   - What we know: ViewsResource SEARCH_FIELD_MAPPING only includes `id`, `title`, `summary` as filterable (lines 112-116). The `type` field is not in the map.
   - What's unclear: Whether Graylog 7.0.6 still honors `?query=type:DASHBOARD` despite `type` not being in SEARCH_FIELD_MAPPING — the SearchQueryParser may silently ignore unmapped fields.
   - Recommendation: Plan 01 U1-smoke artifact probes this. Defensive fallback: wrapper-side filter on `view.type === "DASHBOARD"` after fetching to ensure only dashboards are returned regardless of upstream behavior.

2. **Does U1-style live-smoke on `create_dashboard` accept omitted `displayModeSettings`/`titles` or require explicit defaults?**
   - What we know: `ViewStateDTO.Builder.create()` sets both fields to their `.empty()` instances (lines 121-123), implying they MUST exist.
   - What's unclear: Whether Jackson deserialization of a payload that OMITS these fields fails OR auto-fills via the @JsonCreator default.
   - Recommendation: Plan 01 includes a U1-style smoke artifact (`06-U1-SMOKE.md`) that probes `POST /api/views` with both shapes. Default: emit BOTH fields explicitly with their `.empty()` analogs. If smoke passes the omitted form, plan 06-02 can simplify the wrapper emit.

3. **Should `top_error_clusters` ship as a text-widget placeholder, or defer entirely?**
   - What we know: Graylog has no first-class "log cluster" widget type. The agent's `cluster_log_messages` tool produces a structured cluster summary but it's not a Graylog SearchType.
   - What's unclear: Whether shipping a static text-widget placeholder (with the agent expected to manually populate it via the UI) is more honest than shipping 7 of 8 templates and deferring the 8th.
   - Recommendation: **USER CONFIRMATION REQUIRED** in Plan 03 before commit. Researcher LEANS toward the text-widget placeholder because (a) DASH-08 commits to 8 named templates, (b) the placeholder structurally fits the same `{widget, position, searchType?: null}` triplet pattern (with `searchType: null` signaling "no Graylog data source — agent-populated text"), (c) Phase 6's surface is consistent.

4. **Is the `Position` wire shape `{type:"infinity"}` for full-width or is it bare `Infinity` (JSON Infinity, which isn't strictly valid JSON)?**
   - What we know: `WidgetPositionDTO` has 4 `Position` fields (col/row/height/width); Position is a Java sealed interface with `IntegerPosition` and `InfinityPosition` subclasses.
   - What's unclear: Whether the JSON wire form is `{type:"infinity"}` (a tagged union) or `"Infinity"` (a string sentinel) or some other shape.
   - Recommendation: Plan 01 U1-smoke probes a single full-width widget against the live cluster. Researcher LEANS toward `{type:"infinity"}` per Jackson's standard tagged-union serialization for sealed Java types; will defer to live-cluster behavior if it differs.

## Environment Availability

> Phase 6 is purely code/config — no new external dependencies beyond what Phase 0..5 already require.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All tools | ✓ (engine: >=22.3.0 per package.json) | 22.3.0+ | — |
| Live Graylog at `http://<graylog-host>` | U1-style smoke + verify-work | (assumed available per PROJECT.md) | 7.0.6 (Noir) | Skip live smoke; planner falls back to RESEARCH.md endpoint shapes. Phase 6 acceptance still passes via mocked tests; deferred E2E goes to `/gsd-verify-work`. |
| `node:test` snapshot harness | Plans 02..06 fixture suites | ✓ (Phase 0 FOUND-07) | builtin | — |
| `node:crypto` (`randomUUID`) | Widget ID generation | ✓ | builtin | — |
| Mocking infrastructure for seeded UUID | Tests | ✓ (Phase 4 `simulate_pipeline_rule` precedent) | builtin | — |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:** Live Graylog connectivity for U1-style smoke is the only soft-dep. If unavailable, Plan 01 produces `06-U1-SMOKE.md` with explicit defaults (per the Open Questions 2/4 researcher recommendations) and a CHANGELOG note that this is unverified against live 7.0.6.

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (Node.js builtin, Node 22.3+) |
| Config file | `test/snapshot-config.js` (redirects snapshots to `test/__snapshots__/`) |
| Quick run command | `node --test test/dashboards.test.js test/blueprints.test.js test/widget-templates.test.js test/schema-parity.test.js` |
| Full suite command | `npm test` (≡ `node --test 'test/**/*.test.js'`) |
| Snapshot mode | `node --test --test-update-snapshots test/dashboards.test.js test/blueprints.test.js test/widget-templates.test.js` (regenerate); `node --test ...` (compare) |
| Estimated runtime | ~7s quick, ~15s full (843 baseline at end of Phase 5 + ~120 new ≈ ~963 total tests) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DASH-01 | `list_dashboards` narrow projection + `result.views` envelope unwrap + type:DASHBOARD filter | unit (snapshot) | `node --test test/dashboards.test.js` | ❌ Wave 0 — `test/dashboards.test.js` does not yet exist |
| DASH-02 | `get_dashboard` full ViewDTO | unit | `node --test test/dashboards.test.js` | ❌ Wave 0 |
| DASH-03 | **C7 ACCEPTANCE GATE**: internal Search+View 2-step chain | unit (chain snapshot) | `node --test test/dashboards.test.js` | ❌ Wave 0 |
| DASH-03 | D-02 schema rejects agent-supplied searchId | unit (zod error) | `node --test test/dashboards.test.js` | ❌ Wave 0 |
| DASH-03 | **D-03 ACCEPTANCE GATE**: widget-position integrity validator refuses before HTTP | unit | `node --test test/dashboards.test.js` | ❌ Wave 0 |
| DASH-04 | STRICT_NO_ECHO partial update; searchId IMMUTABLE | unit | `node --test test/dashboards.test.js` | ❌ Wave 0 |
| DASH-05 | Leaf delete; informational cascade only | unit | `node --test test/dashboards.test.js` | ❌ Wave 0 |
| DASH-06 | Two-step PUT chain (Search update + View update) | unit (chain snapshot) | `node --test test/dashboards.test.js` | ❌ Wave 0 |
| DASH-06 | M7 closed-set rejection for invalid templateName | unit (zod error) | `node --test test/dashboards.test.js` | ❌ Wave 0 |
| DASH-07 | Symmetric two-step PUT chain (remove widget) | unit (chain snapshot) | `node --test test/dashboards.test.js` | ❌ Wave 0 |
| DASH-08 | 8 widget templates emit frozen triplet shapes | unit (snapshot per template) | `node --test test/widget-templates.test.js` | ❌ Wave 0 |
| BLUE-01 | **BLUE-01 ACCEPTANCE GATE**: 6-step chain transcript dry-run + apply substitution + partial-failure transcript | unit (mega snapshot) | `node --test test/blueprints.test.js` | ❌ Wave 0 |
| BLUE-02..BLUE-06 | Per-blueprint chain dry-run snapshots | unit (snapshot per blueprint) | `node --test test/blueprints.test.js` | ❌ Wave 0 |
| Services layer compose contract | Blueprints import from `src/services/*`, never from `src/tools/<domain>/*` | grep | `! grep -r "from \"../tools/" src/tools/blueprints/` | n/a (text assertion) |
| FOUND-13 | Schema-parity assertions for all 14 new tools | unit (extension of `test/schema-parity.test.js`) | `node --test test/schema-parity.test.js` | ✓ exists; extend in Plan 06 |

### Sampling Rate

- **Per task commit:** `node --test test/dashboards.test.js test/blueprints.test.js test/widget-templates.test.js test/schema-parity.test.js` (~3–5 sec when fixtures are populated)
- **Per wave merge:** `node --test` (full suite — ~30–60 sec for Phase 6 + all prior phases)
- **Phase gate:** Full suite green + auth-redaction lint clean + 18 snapshot fixtures byte-identical + BLUE-01 mega-chain transcript pinned before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `test/dashboards.test.js` — covers DASH-01..07 (~10 fixtures + ~15 unit tests)
- [ ] `test/blueprints.test.js` — covers BLUE-01..06 (~6 chain fixtures + BLUE-01 partial-failure fixture + ~10 unit tests)
- [ ] `test/widget-templates.test.js` — covers DASH-08 (8 template builder snapshot tests + 8 frozen-object assertions)
- [ ] `test/__snapshots__/dashboards.test.js.snapshot` — auto-generated on first `--test-update-snapshots` pass
- [ ] `test/__snapshots__/blueprints.test.js.snapshot` — auto-generated
- [ ] `test/__snapshots__/widget-templates.test.js.snapshot` — auto-generated
- [ ] No new framework install needed — `node:test` is builtin (Phase 0 FOUND-06)
- [ ] `test/schema-parity.test.js` extension — 14 new `assertSchemaParityForTool(...)` calls (Plan 06)
- [ ] `src/tools/dashboards/` (10 handler files + schemas.js + index.js)
- [ ] `src/tools/blueprints/` (6 handler files + schemas.js + index.js)
- [ ] `src/services/{streams,pipelines,inputs,index-sets,events,dashboards}.js` (6 thin HTTP wrapper modules)
- [ ] `src/widget-templates/` (8 templates + index.js)
- [ ] `src/tools/_shared/blueprint-chain.js` (chain-transcript helper, ~40 LOC)
- [ ] `src/tools/_shared/widget-position-integrity.js` (D-03 validator, ~20 LOC)
- [ ] `src/tools/_shared/conflict.js` — AMEND: add `response.views` envelope key recognition

## Security Domain

> `workflow.security_enforcement` is not set in config.json — treating as ENABLED (default).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing Phase 0 connection registry + API token; no Phase 6 changes |
| V3 Session Management | no | Stateless MCP; per-call connection resolution |
| V4 Access Control | yes | Graylog server-side `@RequiresPermissions(DASHBOARDS_CREATE/EDIT/DELETE)` (ViewsResource.java enforces RBAC via SearchUser); insufficient perms surface as 403 per CLAUDE.md auth model |
| V5 Input Validation | yes | zod schemas per tool; closed-set discriminator for widget template names (D-04) + blueprint names; widget-position integrity validator (D-03 — client-side) |
| V6 Cryptography | no | No encrypted fields in dashboard/widget/blueprint surface. (Phase 5 carries the only encrypted-field surface in this milestone — http-notification-v2's basic_auth/api_secret. Phase 6 doesn't add to it.) |
| V7 Error Handling | yes | Existing `wrapGraylogError` + structured `isError` envelopes from Phase 0; reused for all 14 tools. Blueprint partial-failure surface is a structured `reason: "blueprint_chain_partial_failure"` envelope with transcript. |
| V9 Communication | yes | TLS to Graylog (existing); no new endpoints |
| V12 Files & Resources | no | No file I/O in Phase 6 |
| V14 Configuration | yes | No new confirmation-token surface (no cascade-hash in Phase 6 — dashboards are leaf resources). Auth-redaction lint inheritance covers any widget template that names a stream id (which is non-sensitive but worth pinning); template snapshots are byte-identity-tested |

### Known Threat Patterns for Phase 6

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Agent attempts to inject a pre-existing Search ID via `create_dashboard.searchId` arg (C7 bypass attempt) | Tampering | **Schema-level rejection** (D-02): the wrapper schema for `create_dashboard` does NOT accept a `searchId` field. There is no way for the agent to flip the Search-to-View linkage. C7 mitigation is STRUCTURAL. |
| Agent supplies handcrafted widgets without matching widgetPositions (orphan widget DoS — render-blocking failure on the dashboard) | Tampering / DoS | **Client-side D-03 validator** rejects at build() BEFORE any HTTP. The Graylog server-side check is ⊇ only (Pitfall 4); the wrapper enforces strict-equality `==`. |
| Agent invokes invalid widget templateName hoping for silent fallback | Tampering | **Closed-set zod enum** (D-06) — invalid names reject at zod parse BEFORE any HTTP call, no Graylog audit-log entry, no side effect. |
| Agent uses BLUE-01 to set up monitoring on a stream they shouldn't have access to (privilege confusion) | Elevation of privilege | Graylog server-side @RequiresPermissions on each /streams + /views + /pipelines + /events endpoint enforces RBAC; the wrapper does NOT bypass — Graylog 403 surfaces via wrapGraylogError. Note: a BLUE-01 chain that 403s on step 5 still leaves steps 1-4 applied — the user has CREATE on streams/pipelines but not on dashboards. Mitigation: U1-smoke (Plan 01) probes this and the dry-run transcript ALWAYS lists every endpoint that will be touched so the agent can preview which operations the user lacks permission for. |
| Wrapper-bypass via direct service-layer call from a future caller | Tampering | Defense-in-depth: `src/graylog/client.js`'s writable-flag gate refuses non-GET against `conn.writable === false` (Phase 0 Plan 03 / Pitfall 4) — even if a future caller bypasses the wrapper. Services use `makeClient(conn)` which inherits the gate. |
| Agent retries `setup_app_monitoring_stack` after a partial failure and creates duplicate resources | Repudiation | **Idempotency key auto-derived** (FOUND-10) — same args + same key + step 1 ran findExistingMatches against `/api/streams` → if the stream exists, returns existingMatches and the agent sees the partial state. Phase 6 inherits this surface for free. |
| Snapshot fixture leakage of stream IDs / connection metadata | Information Disclosure | auth-redaction lint regex-level placeholder + structural FQCN recognition (Phase 2/3/4/5 carry-forward) inherits automatically; no per-fixture opt-in. Plan 06 extends the allowlist for any Phase 6 token surfaces (none currently — Phase 6 has no cascade-hash). |
| Blueprint chain transcript surfaces leaked internal Search IDs (C7 contradiction) | Information Disclosure | D-01 STRUCTURAL: dry-run preview shows `__SERVER_ASSIGNED__step1` placeholders; apply transcript includes the real Search ID in step 1's response but the agent's PRIMARY result is the Dashboard ID — Search ID is incidental in the transcript, not load-bearing. |

## Sources

### Primary (HIGH confidence)

- **`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/views/search/rest/ViewsResource.java`** — endpoint catalogue (POST/PUT/GET/DELETE /views), validateIntegrity, validateSearchProperties (the C7 mitigation source-truth at lines 329-379), PaginatedResponse envelope key
- **`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/views/search/rest/SearchResource.java`** — POST /views/search (the persist endpoint Phase 6 uses for the C7 chain step 1), 201 + Location response
- **`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/views/search/rest/SearchDTO.java`** — SearchDTO wire shape (queries + parameters + skipNoStreamsCheck)
- **`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/views/search/rest/QueryDTO.java`** — QueryDTO wire shape (id + timerange + filter + filters + query + search_types)
- **`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/views/search/views/ViewDTO.java`** — ViewDTO field shape; Type enum (DASHBOARD vs SEARCH); @DbEntity collection name "dashboards"
- **`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/views/search/views/ViewStateDTO.java`** — ViewStateDTO wire shape (widgets + widgetMapping + widgetPositions + titles + displayModeSettings); Builder defaults
- **`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/views/search/views/WidgetDTO.java`** — WidgetDTO field shape (type discriminator + filter + filters + timerange + query + streams + stream_categories + config); JsonTypeInfo property "type"
- **`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/views/search/views/WidgetPositionDTO.java`** — Position 4-field shape (col, row, height, width)
- **`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/views/search/views/widgets/aggregation/AggregationConfigDTO.java`** — pivot widget config (row_pivots, column_pivots, series, sort, visualization, visualization_config, rollup, event_annotation)
- **`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/views/search/views/widgets/aggregation/PivotDTO.java`** — PivotDTO wire shape (fields, type, config); JsonTypeInfo for config polymorphism
- **`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/views/search/views/widgets/aggregation/SeriesDTO.java`** — SeriesDTO wire shape (config, function)
- **`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/views/search/views/widgets/aggregation/TimeHistogramConfigDTO.java`** — time bucket pivot config (interval)
- **`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/views/search/views/widgets/aggregation/ValueConfigDTO.java`** — values bucket pivot config (limit, skip_empty_values)
- **`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/views/search/views/widgets/aggregation/IntervalDTO.java`** + **`TimeUnitIntervalDTO.java`** — interval discriminator (timeunit vs auto)
- **`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/views/search/views/widgets/messagelist/MessageListConfigDTO.java`** — message-list widget config (fields, show_message_row, show_summary, decorators, sort)
- **`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/views/search/searchtypes/MessageList.java`** + **`searchtypes/pivot/Pivot.java`** — SearchType wire shapes (the wire SearchType is DIFFERENT from the widget config — both must be emitted)
- **`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/views/search/searchtypes/pivot/series/{Count,Sum,Average,Min,Max,StdDev,Percentile,Cardinality,Latest,Percentage,SumOfSquares,Variance}.java`** — 12 SeriesSpec classes; field is Optional<String>; literal = `<type>(<field>)`
- **`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/views/search/searchtypes/pivot/buckets/{Values,Time}.java`** — bucket specs
- **`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/security/shares/CreateEntityRequest.java`** — envelope wrapper (entity + share_request)
- **`src/tools/streams/create-stream.js`** — direct analog for Pitfall 3 (CreateEntityRequest envelope) + FOUND-11 existingMatches usage
- **`src/tools/streams/delete-stream.js`** — Pitfall 9 (partial-failure transcript surface) + cascade-pre-flight precedent that BLUE-01's chain transcript MIRRORS structurally
- **`src/tools/events/create-event-definition.js`** + **`src/tools/events/update-event-notification.js`** — STRICT_NO_ECHO precedent (carried into DASH-04)
- **`src/pipeline-dsl/emit.js`** — Phase 4's structured-intent emitter, REUSED in BLUE-04
- **`src/tools/_shared/handler.js`** — `defineMutatingHandler` factory invariants; chain support already absent — Phase 6 adds it
- **`src/tools/_shared/cascade-hash.js`** — keyed-buckets pattern; Phase 6 does NOT add a new cascade-hash variant (dashboards are leaf resources)
- **`src/tools/_shared/conflict.js`** — findExistingMatches; Phase 6 amends with `response.views` envelope key
- **`src/graylog/normalize.js`** — toIdBody; reused for Search and View response normalization
- **`src/graylog/client.js`** — makeClient; reused via services

### Secondary (MEDIUM confidence)

- **`.planning/research/PITFALLS.md` §C7, §C6, §M2, §M7** — pitfall-anchored decision drivers
- **`.planning/research/ARCHITECTURE.md` §6 Blueprint Composition + Anti-Pattern 1** — services-layer composition pattern
- **`.planning/phases/05-events-notifications/05-RESEARCH.md`** — direct template for this RESEARCH.md structure and the M2/M7 patterns carried forward
- **`.planning/phases/03-streams-stream-rules/03-RESEARCH.md` (via Phase 3 cascade-hash precedent)** — keyed-buckets canonicalization pattern (not used in Phase 6 but informs the chain transcript shape)
- **`.planning/phases/04-pipelines-pipeline-rules-connections/04-05-SUMMARY.md`** — PIPE-13 connect_pipelines_to_stream wire shape REUSED in BLUE-01 step 4

### Tertiary (LOW confidence — needs U1-smoke confirmation)

- **`displayModeSettings` and `titles` omission tolerance on live 7.0.6** — needs live cluster smoke (Open Question 2)
- **`?query=type:DASHBOARD` filter behavior on Graylog 7.0.6** — needs live cluster smoke (Open Question 1)
- **`Position` wire shape `{type:"infinity"}` for full-width** — needs live cluster smoke (Open Question 4)
- **`top_error_clusters` template ship-or-defer decision** — needs USER CONFIRMATION before Plan 03 commit (Open Question 3)

## Metadata

**Confidence breakdown:**
- Endpoint catalogue: HIGH — source-walked every `@Path` annotation in ViewsResource + SearchResource
- ViewDTO + nested DTO shapes: HIGH — direct field-by-field source walk against the 12 DTO classes
- Widget template catalogue: HIGH — 8 templates' wire shapes verified against the corresponding aggregation/messagelist Java DTOs
- C7 mitigation chain: HIGH — directly mirrors `validateSearchProperties` lines 329-379
- D-03 widget-position integrity: HIGH — direct port of server-side check (`widgetPositions.containsAll(widgetIds)`) tightened to `==`
- Services-layer composition: HIGH — ARCHITECTURE.md §6 explicit recommendation + Anti-Pattern 1
- Blueprint chain transcript shape: HIGH — Pitfall C6 lines 138-143 explicit prescription + Phase 3 D-02 transcript pattern as structural sibling
- BLUE-01 step composition: HIGH — every step traces to a shipped Phase 0..5 service (streams, pipelines, events, dashboards via this phase)
- Snapshot fixture design: HIGH — Phase 5 pattern + acceptance-gate criteria from ROADMAP SC1..SC4 of Phase 6
- `displayModeSettings`/`titles`/`?query=type:DASHBOARD` live behavior: MEDIUM — needs U1-smoke
- `Position` wire shape: MEDIUM — needs U1-smoke; researcher's leaning is documented

**Research date:** 2026-05-15
**Valid until:** 2026-06-15 (30 days — Graylog 7.2-snapshot is stable; 7.0.6 (live) is stable in the same major)
