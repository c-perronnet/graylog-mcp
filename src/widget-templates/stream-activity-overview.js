// Widget Template 8 — stream_activity_overview (DASH-08).
//
// Two-bucket pivot: time-bucket (5-minute fixed intervals) × values-bucket on
// the `streams` field. Renders as a stacked area chart so the agent can see
// per-stream activity over time. Mirrors 06-RESEARCH.md §"Template 8".
//
// Why fixed 5-minute interval (vs. Template 1's "auto"):
//   This is an overview widget — coarser-than-auto bucketing keeps the chart
//   readable at the typical 24h dashboard window. The agent can override via
//   options.intervalUnit / options.intervalValue if a finer resolution is
//   needed.

import { randomUUID } from "node:crypto";

export function buildStreamActivityOverview(options = {}) {
    const widgetId = options.widgetId ?? randomUUID();
    const searchTypeId = options.searchTypeId ?? randomUUID();
    const streamIds = options.streamIds ?? [];
    const queryString = options.queryString ?? "";
    const limit = options.limit ?? 10;
    const intervalUnit = options.intervalUnit ?? "minutes";
    const intervalValue = options.intervalValue ?? 5;

    const timeBucket = {
        type: "time",
        fields: ["timestamp"],
        interval: { type: "timeunit", value: intervalValue, unit: intervalUnit },
    };
    const streamsBucket = {
        type: "values",
        fields: ["streams"],
        limit,
        skip_empty_values: true,
    };

    const searchType = {
        type: "pivot",
        id: searchTypeId,
        name: null,
        row_groups: [timeBucket, streamsBucket],
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
            row_pivots: [
                {
                    fields: ["timestamp"],
                    type: "time",
                    config: { interval: { type: "timeunit", value: intervalValue, unit: intervalUnit } },
                },
                {
                    fields: ["streams"],
                    type: "values",
                    config: { limit, skip_empty_values: true },
                },
            ],
            column_pivots: [],
            series: [{ config: {}, function: "count()" }],
            sort: [],
            visualization: "area",
            rollup: true,
            event_annotation: false,
        },
        description: "Stream activity overview (stacked by stream)",
    };

    const position = options.position ?? { col: 1, row: 1, height: 4, width: 12 };

    return Object.freeze({ widget, position, searchType });
}
