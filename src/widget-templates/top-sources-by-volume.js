// Widget Template 2 — top_sources_by_volume (DASH-08).
//
// Values-bucket pivot on the `source` field showing the top N sources by
// message volume. Renders as a sortable table (count desc). No query filter
// — counts all messages. Mirrors 06-RESEARCH.md §"Template 2".
//
// Wire-shape contract — see error-rate-over-time.js for the D-04 / D-05 /
// Pitfall 7 cross-cutting invariants.

import { randomUUID } from "node:crypto";

export function buildTopSourcesByVolume(options = {}) {
    const widgetId = options.widgetId ?? randomUUID();
    const searchTypeId = options.searchTypeId ?? randomUUID();
    const streamIds = options.streamIds ?? [];
    const limit = options.limit ?? 15;
    const queryString = options.queryString ?? "";

    // Count desc sort is shared between widget and searchType so both the
    // UI rendering AND the server-side aggregation produce the same ordering.
    const sortByCountDesc = [{ type: "series", field: "count()", direction: "Descending" }];

    const searchType = {
        type: "pivot",
        id: searchTypeId,
        name: null,
        row_groups: [{
            type: "values",
            fields: ["source"],
            limit,
            skip_empty_values: true,
        }],
        column_groups: [],
        series: [{ type: "count", id: "count()", field: null }],
        sort: sortByCountDesc,
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
                fields: ["source"],
                type: "values",
                config: { limit, skip_empty_values: true },
            }],
            column_pivots: [],
            series: [{ config: {}, function: "count()" }],
            sort: sortByCountDesc,
            visualization: "table",
            rollup: true,
            event_annotation: false,
        },
        description: `Top ${limit} sources by message volume`,
    };

    const position = options.position ?? { col: 7, row: 1, height: 4, width: 6 };

    return Object.freeze({ widget, position, searchType });
}
