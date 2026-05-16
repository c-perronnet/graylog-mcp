// Widget Template 7 — recent_events_table (DASH-08).
//
// MessageList widget (DIFFERENT shape from the aggregation widgets — uses
// MessageListConfigDTO instead of AggregationConfigDTO). Renders the most
// recent N messages as a sortable table. Mirrors 06-RESEARCH.md §"Template 7".
//
// Key shape differences vs. aggregation templates:
//   - widget.type: "messages" (NOT "aggregation")
//   - searchType.type: "messages" (NOT "pivot")
//   - widget.config: MessageListConfigDTO shape with `fields`,
//     `show_message_row`, `show_summary`, `decorators`, `sort`
//     (NOT row_pivots/column_pivots/series/visualization)
//   - searchType carries `limit` (page size); sort goes on BOTH the widget
//     config AND the searchType so server-side ordering matches UI ordering.

import { randomUUID } from "node:crypto";

export function buildRecentEventsTable(options = {}) {
    const widgetId = options.widgetId ?? randomUUID();
    const searchTypeId = options.searchTypeId ?? randomUUID();
    const streamIds = options.streamIds ?? [];
    const queryString = options.queryString ?? "";
    const limit = options.limit ?? 100;
    const fields = options.fields ?? ["timestamp", "source", "level", "message"];

    // Sort by timestamp descending (most-recent first). Shape differs between
    // widget config and searchType — both ride along so server-side query + UI
    // rendering agree:
    //   - widget config.sort uses the SortConfigDTO discriminated shape
    //     { type, field, direction } (MT4-BUG5).
    //   - searchType.sort uses the messages search_type shape { field, order }.
    const widgetSort = [{ type: "pivot", field: "timestamp", direction: "Descending" }];
    const searchTypeSort = [{ field: "timestamp", order: "DESC" }];

    const searchType = {
        type: "messages",
        id: searchTypeId,
        name: null,
        limit,
        offset: 0,
        sort: searchTypeSort,
        decorators: [],
        filter: null,
        filters: [],
        query: { type: "elasticsearch", query_string: queryString },
        ...(options.timerangeOverride ? { timerange: options.timerangeOverride } : {}),
        streams: streamIds,
        stream_categories: [],
        fields,
    };

    const widget = {
        id: widgetId,
        type: "messages",
        filter: null,
        filters: [],
        ...(options.timerangeOverride ? { timerange: options.timerangeOverride } : {}),
        query: { type: "elasticsearch", query_string: queryString },
        streams: streamIds,
        stream_categories: [],
        config: {
            // MessageListConfigDTO shape — NOT AggregationConfigDTO.
            fields,
            show_message_row: true,
            show_summary: false,
            decorators: [],
            sort: widgetSort,
        },
        description: "Recent messages (most-recent first)",
    };

    const position = options.position ?? { col: 1, row: 9, height: 6, width: 12 };

    return Object.freeze({ widget, position, searchType });
}
