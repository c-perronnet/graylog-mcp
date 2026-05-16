# Milestone Summary — Graylog MCP Full Admin Surface

**Milestone:** v2.3 → v3.0.0 (admin-surface)
**Started:** 2026-05-13 (roadmap creation)
**Closed:** 2026-05-16
**Branch convention:** `gsd/phase-{phase}-{slug}`
**Core value:** An AI agent can configure Graylog from intent alone, safely, without touching the web UI.

## Tool surface

- Pre-milestone (v2.3): 24 read-only tools
- Net-new this milestone: 67 (66 CRUD/blueprint primitives + 1 meta-tool)
- Milestone end: **91 tools**

Tool inventory by phase:

| Phase | Tools added | Cumulative |
|-------|-------------|-----------|
| 0 — Foundation | 0 (dispatch + primitives only) | 24 |
| 1 — Inputs & Extractors | 11 (INPUT-01..11) | 35 |
| 2 — Index Sets & Retention | 8 (INDEX-01..08; await_system_job introduced here, reused later) | 43 |
| 3 — Streams & Stream Rules | 11 (STREAM-01..11) | 54 |
| 4 — Pipelines & Pipeline Rules | 14 (PIPE-01..14; includes DSL subsystem + simulate_pipeline_rule + connect/disconnect_pipelines_to_stream) | 68 |
| 5 — Events & Notifications | 9 (EVENT-01..09; enable/disable counted as one tool pair) | 77 |
| 6 — Dashboards & Blueprints | 13 (DASH-01..08 with widget templates under DASH-08; BLUE-01..06) | 90 |
| 7 — Final Hardening | 1 (HARD-02 list_admin_tools — the only net-new tool this phase) | **91** |

## Requirements coverage

85 v1 requirements mapped at roadmap time; 85 closed at milestone end (**100%**).

| Category | Closed | Total |
|----------|--------|-------|
| FOUND | 13 | 13 |
| INPUT | 11 | 11 |
| INDEX | 8 | 8 |
| STREAM | 11 | 11 |
| PIPE | 14 | 14 |
| EVENT | 9 | 9 |
| DASH | 8 | 8 |
| BLUE | 6 | 6 |
| HARD | 5 | 5 |
| **Total** | **85** | **85** |

(REQUIREMENTS.md's "71 total" headline figure dates from roadmap creation
before mid-milestone requirement additions (PIPE-13, PIPE-14, DSL
subsystem entries, widget-template list under DASH-08, etc.). The
traceability table is the authoritative source: 85 entries.)

## Test surface

- **Test count at milestone close:** 1073 tests / 18 suites / 0 fail
- **Suite breakdown:**
  - Pre-Phase 7 baseline (Plans 00..06): 1045 tests
  - Phase 7 Plan 01 (audit): +10 tests (1055)
  - Phase 7 Plan 02 (list_admin_tools + schema-parity): +7 tests (1062)
  - Phase 7 Plan 03 (v7 read-tool smoke): +11 tests (1073)
- **Snapshot fixtures:** ~10 snapshot files under `test/__snapshots__/` plus 5 snapshot test suites under `test/snapshots/` (pipelines, dashboards, blueprints, events, widget-templates) — ~70 snapshots total across all 7 domain phases.
- **Coverage baseline (c8):**

  ```
  =============================== Coverage summary ===============================
  Statements   : 93.58% ( 16576/17713 )
  Branches     : 79.13% ( 1566/1979 )
  Functions    : 89.93% ( 402/447 )
  Lines        : 93.58% ( 16576/17713 )
  ================================================================================
  ```

  No coverage threshold gate set this milestone per CONTEXT D-08
  (informational baseline only). Captured verbatim from
  `npm run coverage` text-summary block at milestone close.

## Outstanding human-UAT items

Live-cluster confirmations deferred to a follow-up "live UAT" pass.
Aggregated from each phase's HUMAN-UAT documents:

### Phase 2 — index-sets-retention (`.planning/phases/02-index-sets-retention/02-HUMAN-UAT.md`, 3 pending)

1. End-to-end `delete_index_set` with `deleteIndices:true` against live Graylog — confirm async system-job ID via `await_system_job` resolves to completion.
2. `cycle_deflector` side-effect observability — confirm `IndexRangesUpdateJob` (or equivalent) appears in `/system/jobs`.
3. U1 + cycle live smokes against `http://<graylog-host>` — empirically confirm `update_input` MERGE_FROM_CURRENT path and the `cycle_deflector` sync 204 response shape.

### Phase 4 — pipelines-pipeline-rules-connections (`.planning/phases/04-pipelines-pipeline-rules-connections/04-HUMAN-UAT.md`, 5 pending)

1. Live `create_pipeline_rule` round-trip — confirm Graylog 7.0.6's
   `POST /system/pipelines/rule/parse` carries `positionInLine` (camelCase
   on the wire); wrapper translates to `position_in_line` (snake_case).
2. Live `simulate_pipeline_rule` round-trip — confirm JSON-string body
   deserializes server-side; response carries post-rule field changes.
3. Live `connect_pipelines_to_stream` non-replace semantics — confirm
   wrapper GET-merge-PUT prevents silent disconnection of pre-existing
   pipeline connections.
4. U1 partial-update smoke — confirm Graylog 7.0.6 accepts
   `PUT /api/system/pipelines/pipeline/{id}` with `{title: "new"}` only
   (STRICT_NO_ECHO) or requires MERGE_FROM_CURRENT.
5. Plan 04-06 Task 2 sign-off — auto-approved 2026-05-15 under user "go to
   end of plan without me" directive; reviewer re-run of fixture content
   audit + tool-count + byte-stable snapshots is recommended but not
   blocking.

### Phase 6 — dashboards-widgets-blueprints (`.planning/phases/06-dashboards-widgets-blueprints/06-06-SUMMARY.md`, 3 recommended)

1. `setup_app_monitoring_stack` (BLUE-01) — confirm 6-step apply chain produces a working monitoring environment end-to-end (stream + pipeline + dashboard + alert all visible in the Graylog UI).
2. C7 widget-position integrity — confirm runtime match against Graylog's server-side `validateSearchProperties` check (bidirectional strict-equality).
3. Each of the 8 widget templates renders correctly in the Graylog dashboard UI.

### Phase 7 — final-hardening (this phase, 1 recommended)

1. Live HARD-03 smoke against a live Graylog 7.2 cluster — confirms v2.3 read tools still work on actual cluster. Default smoke is fixture-based per CONTEXT.md D-07; live is the optional bonus path.

### Total

- 11 outstanding human-UAT items across 4 phases.
- All items are **deferred verification**, not failures. Fixture-based snapshots already pin every WIRE-SHAPE contract; live UAT confirms WIRE-SHAPE matches Graylog's runtime expectations on a real cluster. The two are complementary.

## Key safety primitives shipped

- **Dry-run-by-default** on every mutating tool (FOUND-03 + per-phase enforcement)
- **Confirmation-token pattern** for destructive ops (`delete_index_set` C1, `delete_stream` C2, `delete_event_notification`, `delete_pipeline_rule`, all cascade-hash deletes)
- **Encrypted-field protection** on partial-update (`update_input` C3, `update_event_notification`) — wrapper fetches current config and merges to avoid zeroing encrypted fields
- **Server-authoritative parse pre-flight** (`create_pipeline_rule` C4, `update_pipeline_rule`, `create_pipeline`)
- **Inverted defaults:** `deleteIndices=false` (C1), `schedule=false` (M1+C5)
- **v6→v7 aggregation-syntax migration helper** (`create/update_event_definition` C5)
- **Cascade-hash drift refusal** across stream/notification/pipeline-rule delete paths
- **Per-connection X-Requested-By header + writable-flag gate** (defense-in-depth at `src/graylog/client.js`)
- **Idempotency-key auto-derivation** on every create (`hash(connectionName, toolName, args)`)
- **`existingMatches` probe** on every create tool (FOUND-11)
- **Internal Search+View chaining** for `create_dashboard` (C7) — agent never sees the intermediate Search ID
- **Symmetric two-step PUT chain** for `remove_widget` (Pitfall 9 acceptance)

## Discoverability + agent-context primitives

- **`list_admin_tools(domain?)` meta-tool** (HARD-02) — pure-static, no Graylog connection required; returns a 91-tool inventory grouped across 9 domains for agent orientation at session start (Pitfall M7 mitigation #3)
- **Tool-description audit + merge-gate** (HARD-01) — every tool description ≤200 chars with a discrimination sentence; `npm run audit:tool-descriptions` and the regression-gate test in `test/tool-description-audit.test.js` block any PR adding non-compliant descriptions
- **Tool-naming convention** `<verb>_<domain>_<noun>` (FOUND-13) — every new tool follows the convention; the agent learns the schema instead of 80 individual names

## Migration notes for next milestone

- **`GET /api/streams` → `GET /api/streams/paginated`:** documented at
  `docs/STREAMS_DEPRECATION_MIGRATION.md` (HARD-05). Migration step-by-step
  + effort estimate + alternative (delete dead code path) included.
  Recommended path is "delete dead code" (~20 min) since the only
  consumer is the v2.3 `fetchStreams` whose dispatch-wired handler was
  displaced by Phase 3's `list_streams`.
- **`GET /api/events/definitions` deprecated bare path:** same migration
  story as streams, smaller blast radius. Phase 5's `list_event_definitions`
  already hits `/paginated`. Only `fetchEventDefinitions` in
  `src/events.js` is on the deprecated path, and its dispatch-wired
  handler is also displaced.
- **Internal handler camelCase → snake_case rename:** cosmetic; agent-visible
  names already follow `<verb>_<domain>_<noun>`. Out of scope per Phase 0
  RESEARCH.md Q9 closing rationale.

## Decisions still pinned

See STATE.md "Decisions Locked" for the full list. Headline pins:

- Single Graylog version target: 7.2.0-SNAPSHOT (no multi-version branching)
- zod `^3.25.76` (no v4 upgrade this milestone)
- Curated widget templates only (no arbitrary widget construction; deferred to v2 WIDGET-01/02)
- Read tools verify-against-v7 only (no refactors); HARD-03 confirms 5 critical drift surfaces
- Per-domain extraction under `src/tools/<domain>/`
- c8 is the **only** new npm dependency this milestone (devDependency only; no runtime dep additions)

## Phase performance metrics

Aggregated from STATE.md "Performance Metrics" table. All phases shipped under their planned plan-count budget; total milestone wall-clock for execution time ≈ 5.5 hours across 41 plans (Phase 7: 19+7+~10 = ~36 min for 3 plans).

| Phase | Plans | Tools added |
|-------|-------|-------------|
| 00-foundation | 6 | 0 (infrastructure) |
| 01-inputs-extractors | 4 | 11 |
| 02-index-sets-retention | 4 | 8 |
| 03-streams-stream-rules | 4 | 11 |
| 04-pipelines-pipeline-rules-connections | 5 | 14 |
| 05-events-notifications | 5 | 9 |
| 06-dashboards-widgets-blueprints | 6 | 13 |
| 07-final-hardening | 3 | 1 (list_admin_tools) |
| **Total** | **41 plans** | **67 net-new tools** |

## Closure

Phase 7 complete. **Milestone v3.0.0 admin-surface CLOSED.**

The agent can now configure Graylog from intent alone, safely, without
touching the web UI — across all 9 domains (inputs, extractors, index-sets,
streams, stream-rules, pipelines, pipeline-rules, events, notifications,
dashboards, widgets, blueprints). 11 outstanding live-cluster UAT items
are recommended for a follow-up verification pass but are NOT blocking
the milestone close — the fixture-based snapshot suite pins every WIRE-SHAPE
contract.

---
*Phase: 07-final-hardening*
*Milestone closed: 2026-05-16*
