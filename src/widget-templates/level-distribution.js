// Widget Template 3 — level_distribution (DASH-08).
//
// Pie-chart distribution of messages by syslog `level`. Includes empty values
// (skip_empty_values:false) so messages with no level field still surface as a
// distinct slice. Mirrors 06-RESEARCH.md §"Template 3".
//
// Wire-shape contract — see error-rate-over-time.js for the D-04 / D-05 /
// Pitfall 7 cross-cutting invariants.

import { randomUUID } from "node:crypto";

export function buildLevelDistribution(options = {}) {
    const widgetId = options.widgetId ?? randomUUID();
    const searchTypeId = options.searchTypeId ?? randomUUID();
    const streamIds = options.streamIds ?? [];
    const queryString = options.queryString ?? "";
    const limit = options.limit ?? 10;

    const searchType = {
        type: "pivot",
        id: searchTypeId,
        name: null,
        row_groups: [{
            type: "values",
            fields: ["level"],
            limit,
            // false: empty-level messages render as their own "(empty)" slice
            // so the pie chart is exhaustive (no hidden long-tail).
            skip_empty_values: false,
        }],
        column_groups: [],
        series: [{ type: "count", id: "count()", field: null }],
        sort: [],
        rollup: true,
        filter: null,
        filters: [],
        query: { type: "elasticsearch", query_string: queryString },
        ...(options.timerangeOverride ? { timerange: options.timerangeOverride } : {}),
        streams: streamIds,
        stream_categories: [],
    };

    const widget = {
        id: widgetId,
        type: "aggregation",
        filter: null,
        filters: [],
        ...(options.timerangeOverride ? { timerange: options.timerangeOverride } : {}),
        query: { type: "elasticsearch", query_string: queryString },
        streams: streamIds,
        stream_categories: [],
        config: {
            row_pivots: [{
                fields: ["level"],
                type: "values",
                config: { limit, skip_empty_values: false },
            }],
            column_pivots: [],
            series: [{ config: {}, function: "count()" }],
            sort: [],
            visualization: "pie",
            rollup: true,
            event_annotation: false,
        },
        description: "Message distribution by level",
    };

    const position = options.position ?? { col: 1, row: 5, height: 4, width: 4 };

    return Object.freeze({ widget, position, searchType });
}
