// Widget Template 6 — field_value_distribution (DASH-08).
//
// Generic values-bucket pivot on an agent-supplied `field`. Renders as a
// sortable table. THROWS when `options.field` is absent — per-template
// validation owned by the builder (the schema accepts open shape via
// z.object({}).passthrough()).
//
// Why throw at the builder rather than at the zod schema:
//   add_widget_from_template's schema uses `options: z.object({}).passthrough()`
//   so per-template option shapes vary without a discriminated union. The
//   builder is the single source of truth for per-template required options.
//   The error propagates through defineMutatingHandler.build() → catch →
//   wrapGraylogError so the agent sees a structured isError envelope.

import { randomUUID } from "node:crypto";

export function buildFieldValueDistribution(options = {}) {
    if (!options.field || typeof options.field !== "string") {
        throw new Error("field option required for field_value_distribution");
    }

    const widgetId = options.widgetId ?? randomUUID();
    const searchTypeId = options.searchTypeId ?? randomUUID();
    const streamIds = options.streamIds ?? [];
    const limit = options.limit ?? 15;
    const queryString = options.queryString ?? "";

    const sortByCountDesc = [{ type: "series", id: "count()", direction: "Descending" }];

    const searchType = {
        type: "pivot",
        id: searchTypeId,
        name: null,
        row_groups: [{
            type: "values",
            fields: [options.field],
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
                fields: [options.field],
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
        description: `Distribution of values for field "${options.field}"`,
    };

    const position = options.position ?? { col: 1, row: 5, height: 4, width: 6 };

    return Object.freeze({ widget, position, searchType });
}
