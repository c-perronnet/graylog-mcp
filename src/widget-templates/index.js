// Widget template registry (Phase 6 D-04 — closed set, ROADMAP DASH-08).
//
// Plan 06-01 shipped the SKELETON: the closed-set TEMPLATE_NAMES tuple + a
// frozen empty WIDGET_TEMPLATES map. Plan 06-03 (this amendment) populates
// WIDGET_TEMPLATES with the 8 per-template builder functions.
//
// D-04: closed-set widget template names. The zod schema in
// src/tools/dashboards/schemas.js (Plan 06-02 / 06-03) consumes TEMPLATE_NAMES
// via z.enum(...) so add_widget_from_template rejects invalid template names
// at parse BEFORE any HTTP call (no Graylog audit-log entry, no side effect).
//
// Each entry in WIDGET_TEMPLATES is a builder function:
//   build(options) -> Object.freeze({ widget: WidgetDTO, position: PositionDTO,
//                                     searchType: SearchTypeDTO | null })
// (searchType is null for the text-widget placeholder — Q3 default
// `TEXT_WIDGET_PLACEHOLDER`, see 06-U1-SMOKE.md.)
//
// Pattern mirrors src/tools/events/encrypted-fields.js (Object.freeze for
// closed-set guarantees). Threat-model T-06-03-08 (Tampering via prototype
// pollution): `Object.freeze(WIDGET_TEMPLATES)` prevents both key-addition
// and key-replacement at runtime — the agent cannot inject a malicious
// builder by mutating the map.

import { buildErrorRateOverTime } from "./error-rate-over-time.js";
import { buildTopSourcesByVolume } from "./top-sources-by-volume.js";
import { buildLevelDistribution } from "./level-distribution.js";
import { buildTopErrorClusters } from "./top-error-clusters.js";
import { buildRequestRateOverTime } from "./request-rate-over-time.js";
import { buildFieldValueDistribution } from "./field-value-distribution.js";
import { buildRecentEventsTable } from "./recent-events-table.js";
import { buildStreamActivityOverview } from "./stream-activity-overview.js";

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

// T-06-03-08 mitigation: Object.freeze prevents both key-addition and
// key-replacement on the registry. Combined with each builder's individual
// Object.freeze({widget,position,searchType}) outer wrapper, this gives the
// "structurally impossible to mismatch" guarantee D-04 calls for: there is
// NO path from agent input to a mutated registry entry or a partial triplet.
export const WIDGET_TEMPLATES = Object.freeze({
    error_rate_over_time: buildErrorRateOverTime,
    top_sources_by_volume: buildTopSourcesByVolume,
    level_distribution: buildLevelDistribution,
    top_error_clusters: buildTopErrorClusters,
    request_rate_over_time: buildRequestRateOverTime,
    field_value_distribution: buildFieldValueDistribution,
    recent_events_table: buildRecentEventsTable,
    stream_activity_overview: buildStreamActivityOverview,
});
