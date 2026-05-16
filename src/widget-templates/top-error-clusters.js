// Widget Template 4 — top_error_clusters (DASH-08; Q3 TEXT_WIDGET_PLACEHOLDER).
//
// Per 06-U1-SMOKE Q3 default `TEXT_WIDGET_PLACEHOLDER`: this template ships as
// a TextWidget placeholder, NOT a Graylog SearchType. The data source is
// agent-populated — the agent runs cluster_log_messages (existing v2.3 tool)
// separately and either renders the result text into the widget body via the
// Graylog UI OR ignores the placeholder.
//
// Why a text widget instead of a real pivot/aggregation:
//   Graylog has no built-in "cluster by template" SearchType. The wrapper's
//   Drain3-backed clustering is a wrapper-side computation (src/clustering/),
//   not a server-side aggregation. Inventing a fake SearchType would either
//   break ViewDTO validation or render an empty widget.
//
// Wire-shape contract:
//   - searchType: null — NO entry contributed to SearchDTO.queries[].search_types
//   - widget.type: "text" — Graylog's TextWidgetConfigDTO discriminator
//   - widget.config.text: hard-coded placeholder string (T-06-03-04 accept:
//     no PII / no credentials / no agent-controlled string)
//   - Position default and freezing contract identical to the other 7 builders
//     (D-04).

import { randomUUID } from "node:crypto";

export function buildTopErrorClusters(options = {}) {
    const widgetId = options.widgetId ?? randomUUID();
    const clusterCount = options.clusterCount ?? 10;
    const streamIds = options.streamIds ?? [];

    const widget = {
        id: widgetId,
        type: "text",  // Graylog's TextWidgetConfigDTO discriminator
        filter: null,
        filters: [],
        // D-05: per-widget timerange ABSENT by default (consistent with the
        // other 7 builders even though TextWidget itself doesn't render a
        // SearchType — keeps the contract uniform).
        ...(options.timerangeOverride ? { timerange: options.timerangeOverride } : {}),
        query: { type: "elasticsearch", query_string: "" },
        streams: streamIds,  // Pitfall 7: always Array
        stream_categories: [],
        config: {
            // T-06-03-04: hard-coded text; no PII / no agent input flows into
            // this string except the clusterCount integer. Agent populates the
            // body separately via cluster_log_messages + Graylog UI.
            text: `Top ${clusterCount} error clusters (placeholder — populate via cluster_log_messages tool).`,
        },
        description: `Top ${clusterCount} error clusters`,
    };

    const position = options.position ?? { col: 1, row: 9, height: 4, width: 6 };

    return Object.freeze({ widget, position, searchType: null });
}
