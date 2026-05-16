// Widget Template 1 — error_rate_over_time (DASH-08).
//
// Time-bucket aggregation over `level >= 4` filtered messages. The widget
// renders as a bar chart so the agent can spot error spikes. Mirrors
// 06-RESEARCH.md §"Template 1".
//
// Wire-shape contract (per Plan 06-03 D-04):
//   - Returns Object.freeze({widget, position, searchType}); searchType is a
//     full PivotConfigDTO (non-null).
//   - Per-widget timerange is ABSENT by default (D-05 inherit-from-dashboard).
//   - streams is ALWAYS emitted as a JSON array (Pitfall 7); never bare string.
//   - widget.id + searchType.id default to randomUUID() but accept agent
//     overrides via options.widgetId / options.searchTypeId (BLUE-01 uses
//     overrides to pin IDs for the chain transcript).

import { randomUUID } from "node:crypto";

export function buildErrorRateOverTime(options = {}) {
    const widgetId = options.widgetId ?? randomUUID();
    const searchTypeId = options.searchTypeId ?? randomUUID();
    const streamIds = options.streamIds ?? [];
    const queryString = "level:>=4";

    const searchType = {
        type: "pivot",
        id: searchTypeId,
        name: null,
        row_groups: [{
            type: "time",
            fields: ["timestamp"],
            interval: { type: "auto" },
        }],
        column_groups: [],
        series: [{ type: "count", id: "count()", field: null }],
        sort: [],
        rollup: true,
        filter: null,
        filters: [],
        query: { type: "elasticsearch", query_string: queryString },
        // D-05: omit timerange unless agent overrode it. Spread-merge so the
        // key is structurally ABSENT (not present with `undefined`) — matches
        // Object.prototype.hasOwnProperty semantics tests assert against.
        ...(options.timerangeOverride ? { timerange: options.timerangeOverride } : {}),
        streams: streamIds,  // Pitfall 7: always Array
        stream_categories: [],
    };

    const widget = {
        id: widgetId,
        type: "aggregation",
        filter: null,
        filters: [],
        ...(options.timerangeOverride ? { timerange: options.timerangeOverride } : {}),
        query: { type: "elasticsearch", query_string: queryString },
        streams: streamIds,  // Pitfall 7: always Array
        stream_categories: [],
        config: {
            row_pivots: [{
                fields: ["timestamp"],
                type: "time",
                config: { interval: { type: "auto" } },
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

    const position = options.position ?? { col: { type: "infinity" }, row: 1, height: 4, width: 6 };

    return Object.freeze({ widget, position, searchType });
}
