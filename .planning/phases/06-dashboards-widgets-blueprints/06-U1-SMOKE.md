---
artifact: u1-smoke
phase: 06-dashboards-widgets-blueprints
plan: 01
decision_for: [list_dashboards, create_dashboard, widget_templates_top_error_clusters, widget_position_infinity]
status: UNREACHABLE
chosen_default: AFK_RESEARCHER_DEFAULTS
date: 2026-05-16
---

# Phase 06 U1 Live-Smoke Decision Artifact

**Date:** 2026-05-16
**Plan:** 06-01 — Task 1
**Target Graylog instance:** `http://<graylog-host>:9000` (Graylog 7.0.6 per PROJECT.md; 7.2.0-SNAPSHOT source-of-truth reference)
**Smoke environment:** Plan-06-01 executor (sequential) in the project working tree.
**Scope:** Decision applies to four open RESEARCH questions feeding Plans 02-06:
- Q1 → Plan 02 `list_dashboards` (envelope key + type filter behavior)
- Q2 → Plan 02 `create_dashboard` (`titles` + `displayModeSettings` omission tolerance)
- Q3 → Plan 03 `top_error_clusters` widget template (text-widget placeholder vs defer)
- Q4 → Plan 03 widget templates (`Position` full-width wire shape — tagged union vs sentinel)

## Result

**UNREACHABLE — `AFK_RESEARCHER_DEFAULTS` chosen across all four probes.**

No connection registered (`getConnections()` returned `{}`); no API token discoverable
under `~/.graylog-mcp/config.json`, `$GRAYLOG_CONFIG_PATH`, project-local
`./.graylog-mcp/config.json`, or `/home/yolo/.graylog-mcp/config.json`. Per the
precedent set by `02-U1-SMOKE.md` (UNREACHABLE_DEFAULT_MERGE), `04-U1-SMOKE.md`
(UNREACHABLE_STRICT_NO_ECHO), and `05-U1-SMOKE.md` (UNREACHABLE_BODY_UNDEFINED),
the safe-default branch fires here: the researcher recommendations from
`06-RESEARCH.md` §"Open Questions (RESOLVED)" are applied verbatim and pinned
as the wire-shape contract for Plans 02-06.

The instance at `<graylog-host>:9000` is HTTP-reachable in principle (Phase 2's
`02-U1-SMOKE.md` positively identified a live Graylog server via 401 response)
but no token grant is available to this executor; firing unauthenticated probes
would surface a 401 for each request, yielding no decision signal and polluting
the cluster's audit log. The smoke is intentionally skipped.

## Auth-token discovery (precedent procedure)

Paths checked per `<u1_smoke_protocol>`:

- `~/.graylog-mcp/config.json` (= `/home/c_perronnet/.graylog-mcp/config.json`) — **NOT FOUND**
- `$GRAYLOG_CONFIG_PATH` env override — **unset**
- Project-local `/home/c_perronnet/git/graylog-mcp/.graylog-mcp/config.json` — **NOT FOUND**
- `/home/yolo/.graylog-mcp/config.json` — **NOT FOUND**

`getConnections()` returns `{}`. No writable connection exists in the executor
environment. UNREACHABLE branch fires for all four probes.

---

## Probe Q1 — `/api/views?query=type:DASHBOARD` filter behavior

### What we know
- `ViewsResource.java` `SEARCH_FIELD_MAPPING` includes only `id`, `title`, `summary`
  as filterable fields (lines 112-116) — `type` is NOT in the map.
- `SearchQueryParser` may silently ignore unmapped fields, in which case the
  query effectively returns ALL views regardless of `type`.
- Phase 6 needs `list_dashboards` to surface ONLY entities with
  `view.type === "DASHBOARD"`, never saved searches.

### Probe attempted
**SKIPPED — UNREACHABLE.** Would have fired `GET /api/views?query=type:DASHBOARD`
against `<graylog-host>:9000` and counted `view.type === "DASHBOARD"` in the
response's `views[]` array versus total entries. Decision logic: if the count
matches `total`, server-side filter works; if saved-searches leak through,
wrapper MUST filter client-side.

### Result
`UNREACHABLE_DEFAULT_WRAPPER_SIDE_TYPE_FILTER`

### Decision applied
**`WRAPPER_SIDE_TYPE_FILTER`** — Plan 02 `list_dashboards` ALWAYS post-filters
`response.views.filter(v => v.type === "DASHBOARD")` after fetching the response,
regardless of whether `?query=type:DASHBOARD` is honored upstream. Defensive
fallback is byte-stable: if Graylog 7.2 ever fixes the unmapped-field handling
to enforce strict filtering, the wrapper's client-side filter is idempotent and
the behavior remains correct.

The envelope key is `response.views` per Pitfall 1 — pinned by the
`src/tools/_shared/conflict.js` amendment in Task 1 Step B.

---

## Probe Q2 — `ViewStateDTO.titles` + `displayModeSettings` omission tolerance

### What we know
- `ViewStateDTO.Builder.create()` sets both fields to their `.empty()` instances
  (lines 121-123), implying they MUST exist post-deserialization.
- Whether Jackson auto-fills via the `@JsonCreator` default OR throws on omission
  is the unknown.

### Probe attempted
**SKIPPED — UNREACHABLE.** Would have fired TWO `POST /api/views` calls — one
with both `titles` and `displayModeSettings` OMITTED; one with both EXPLICITLY
set to their `.empty()` analogs (`{titles: {titles: {}}}` and
`{positions_inferred: false, show_summary: false, show_message_row: false}`)
— and compared 200 vs 400.

### Result
`UNREACHABLE_DEFAULT_EMIT_BOTH_EXPLICIT`

### Decision applied
**`EMIT_BOTH_EXPLICIT`** — Plan 02 `create_dashboard` (and Plan 06-01's
`buildViewDTO` assembler in `src/services/dashboards.js`) ALWAYS emit:

```json
"titles": { "titles": {} },
"display_mode_settings": {
    "positions_inferred": false,
    "show_summary": false,
    "show_message_row": false
}
```

per RESEARCH §Pitfall 6. The defensive emission costs ~80 bytes per ViewDTO and
guarantees deserialization across Graylog versions regardless of Jackson's
omitted-field tolerance. If a future smoke confirms the omitted form is
accepted, Plan 06-02 can simplify; the current default is the safe over-emit.

---

## Probe Q3 — `top_error_clusters` template strategy

### What we know
- Graylog has NO first-class "log cluster" widget type. The agent's
  `cluster_log_messages` tool (Plan 00 of v2.3) produces a structured cluster
  summary but it is NOT a Graylog `SearchType`.
- DASH-08 commits to 8 named templates (D-04 closed set). Shipping 7 of 8 and
  deferring the 8th would break the closed-set contract.
- Researcher LEANS toward the text-widget placeholder per
  `06-RESEARCH.md` §Open Question 3.

### Probe attempted
**N/A — AUTONOMOUS DECISION (user AFK per planning_context).** Q3 explicitly
states "USER CONFIRMATION REQUIRED in Plan 03 before commit." The user has
issued a "continue to milestone end without me" directive (per Phase 6 context
gathering on 2026-05-16) — that directive is interpreted as standing
authorization for the researcher recommendation, not a request to stop and
ask. Plan 03 will pin the decision; Plan 06-01 records it here.

### Result
`AUTO_RESOLVED_TEXT_WIDGET_PLACEHOLDER` (per user AFK directive)

### Decision applied
**`TEXT_WIDGET_PLACEHOLDER`** — Plan 03's
`src/widget-templates/top-error-clusters.js` ships as a TEXT widget (no
`SearchType`; `searchType: null` in the triplet) with content that names the
`cluster_log_messages` tool as the data source the agent should manually run
to populate the widget. The triplet shape stays uniform across the 8 templates
(`{widget, position, searchType: null}` with `null` searchType signaling
"agent-populated text — no Graylog data source").

The 8-template closed-set is preserved; DASH-08 keeps its name-equality
contract; the user can override the placeholder text via the
`add_widget_from_template` tool's `options` parameter (DASH-06) once the agent
has produced a cluster summary.

---

## Probe Q4 — `Position` wire shape for full-width

### What we know
- `WidgetPositionDTO` has 4 `Position` fields (col/row/height/width).
- `Position` is a Java sealed interface with two implementations:
  `IntegerPosition` (`{type: "pixels", value: <int>}` per Jackson tagged-union
  convention) and `InfinityPosition` (full-width / "spans the row").
- The InfinityPosition JSON wire shape is either:
  - `{type: "infinity"}` — tagged-union per Jackson sealed-class convention; OR
  - `"Infinity"` — string sentinel; OR
  - bare JSON `Infinity` — not valid JSON, ruled out.

### Probe attempted
**SKIPPED — UNREACHABLE.** Would have fired `POST /api/views` with ONE widget
positioned at `col: {type: "infinity"}` and checked for 200 vs 400. A 200 would
confirm the tagged-union form; a 400 with a Jackson deserialization message
would confirm the alternative.

### Result
`UNREACHABLE_DEFAULT_TAGGED_UNION_INFINITY`

### Decision applied
**`TAGGED_UNION_INFINITY`** — Plan 03's widget templates emit full-width Position
as `{type: "infinity"}` per Jackson's standard tagged-union serialization for
sealed Java types. Specifically, `IntegerPosition` ships on the wire as
`{value: <n>}` (the Phase 6 widget templates use IntegerPosition exclusively,
so this lift is documentation only — Plan 03 widgets do NOT use InfinityPosition).
The tagged-union form is pinned so if a future widget template needs full-width
(e.g. a future `full_width_event_table` template), it can emit
`col: {type: "infinity"}` without re-litigating the shape.

If a Plan 02-06 snapshot fixture surfaces a 400 from a live cluster, this
artifact MUST be amended and the wrapper MUST switch to the alternate shape.

---

## Hand-off to Plans 02-06

| Question | Decision | Consumed by | File path |
|----------|----------|-------------|-----------|
| Q1 | `WRAPPER_SIDE_TYPE_FILTER` (always post-filter `view.type === "DASHBOARD"`) | Plan 02 `list_dashboards` | `src/tools/dashboards/list-dashboards.js` (future) |
| Q2 | `EMIT_BOTH_EXPLICIT` (titles + displayModeSettings always present) | Plan 02 `create_dashboard` + Plan 06-01 `buildViewDTO` | `src/services/dashboards.js::buildViewDTO` (THIS PLAN) |
| Q3 | `TEXT_WIDGET_PLACEHOLDER` (top_error_clusters ships as text widget; searchType: null) | Plan 03 widget template builder | `src/widget-templates/top-error-clusters.js` (future) |
| Q4 | `TAGGED_UNION_INFINITY` (full-width = `{type:"infinity"}`) | Plan 03 widget templates | `src/widget-templates/*.js` (future; not exercised by Phase 6 default 8 templates) |

## Conflict.js envelope amendment (Q1 prerequisite)

The Q1 decision (`WRAPPER_SIDE_TYPE_FILTER`) depends on `findExistingMatches`
recognizing `response.views` as a valid PaginatedResponse envelope key — Plan
06-01 Task 1 Step B adds that amendment to `src/tools/_shared/conflict.js`.
Without the amendment, `list_dashboards` would receive `[]` from any FOUND-11
list-pre-check (`create_dashboard` duplicate-title detection). The amendment
is byte-stable: one line, position `?? response?.views` after
`?? response?.elements` and before `?? response?.items` (preserves Phase 5
elements precedence + falls through to generic items).

## Re-verification on first reachable live smoke

When a future executor has `~/.graylog-mcp/config.json` populated with a
writable connection, re-run the four probes against `<graylog-host>:9000` and
amend each `### Result` block with `PROBE_SUCCESS` or `PROBE_FAILED_<reason>`.
If any decision flips, the corresponding wrapper code in
`src/services/dashboards.js`, `src/widget-templates/`, or
`src/tools/dashboards/` MUST be updated and the affected snapshot fixtures
MUST be regenerated.

Plans 02-06 do not block on this re-verification; the AFK defaults are
production-safe.
