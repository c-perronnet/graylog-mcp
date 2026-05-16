// Widget template registry (Phase 6 D-04 — closed set, ROADMAP DASH-08).
//
// Plan 06-01 ships the SKELETON: the closed-set TEMPLATE_NAMES tuple + a
// frozen empty WIDGET_TEMPLATES map. Plan 06-03 populates WIDGET_TEMPLATES
// with the 8 per-template builder functions.
//
// D-04: closed-set widget template names. The zod schema in
// src/tools/dashboards/schemas.js (Plan 06-02) consumes TEMPLATE_NAMES via
// z.enum(...) so add_widget_from_template rejects invalid template names at
// parse BEFORE any HTTP call (no Graylog audit-log entry, no side effect).
//
// Each entry in WIDGET_TEMPLATES is a frozen builder function:
//   build(options) -> { widget: WidgetDTO, position: PositionDTO,
//                       searchType: SearchTypeDTO | null }
// (searchType is null for the text-widget placeholder — Q3 default
// `TEXT_WIDGET_PLACEHOLDER`, see 06-U1-SMOKE.md.)
//
// Pattern mirrors src/tools/events/encrypted-fields.js (Object.freeze for
// closed-set guarantees). Threat-model T-06-01-02 (Tampering): the frozen
// enum is the ONLY gate between agent template-name input and the wire —
// there is no bypass.

export const TEMPLATE_NAMES = Object.freeze([
    "error_rate_over_time",
    "top_sources_by_volume",
    "level_distribution",
    "top_error_clusters",
    "request_rate_over_time",
    "field_value_distribution",
    "recent_events_table",
    "stream_activity_overview",
]);

// Plan 06-03 amends this to import each builder and register it as
// `Object.freeze({ error_rate_over_time: errorRateOverTime, ... })`.
// Current shape: frozen empty object — the closed-set names are live but
// the builders are not yet attached. Callers in Plans 06-02/06-04/06-05
// that consume TEMPLATE_NAMES for zod.enum() work without churn; callers
// that try to BUILD a template via WIDGET_TEMPLATES[name] will get
// undefined until Plan 06-03 lands.
export const WIDGET_TEMPLATES = Object.freeze({});
