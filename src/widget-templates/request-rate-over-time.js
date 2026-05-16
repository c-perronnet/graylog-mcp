// Widget Template 5 — request_rate_over_time (DASH-08).
//
// Time-bucket aggregation rendering as a line chart. Agent-supplied
// queryString (e.g. "http_method:GET") narrows the bucket — defaults to ""
// (count ALL messages over time). Mirrors 06-RESEARCH.md §"Template 5".

import { randomUUID } from "node:crypto";

export function buildRequestRateOverTime(options = {}) {
    const widgetId = options.widgetId ?? randomUUID();
    const searchTypeId = options.searchTypeId ?? randomUUID();
    const streamIds = options.streamIds ?? [];
    const queryString = options.queryString ?? "";

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
                fields: ["timestamp"],
                type: "time",
                config: { interval: { type: "auto" } },
            }],
            column_pivots: [],
            series: [{ config: {}, function: "count()" }],
            sort: [],
            // Line viz (vs Template 1's bar) — request rate is typically read
            // as a continuous trend, not a discrete bucket count.
            visualization: "line",
            rollup: true,
            event_annotation: false,
        },
        description: queryString
            ? `Request rate over time (filter: ${queryString})`
            : "Request rate over time",
    };

    const position = options.position ?? { col: 1, row: 1, height: 4, width: 6 };

    return Object.freeze({ widget, position, searchType });
}
