#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import {
    getConfigPath, getConnections, getActiveConnection,
    setActiveConnection, getActiveConnectionConfig, getDefaultFields
} from "./config.js";
import { buildQueryString, resolveFields, extractMessages, fetchMessageById, fetchStreams, searchGraylog, buildStreamFilter } from "./query.js";
import { buildTimeRange, normalizeTimeRangeArgs } from "./timerange.js";
import { buildTimeHistogram, buildFieldAggregation, buildFieldTimeAggregation, executeAggregation, buildTimeHistogramChart, buildSimpleTimeHistogram, buildSimpleFieldTimeAggregation, buildWorkingHistogram } from "./aggregations.js";
import { toolDefinitions } from "./tools.js";

const server = new Server({
    name: "graylog-mcp-server",
    version: "2.0.2",
}, {
    capabilities: {
        tools: {},
    },
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: toolDefinitions };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;

    if (name === "list_connections") {
        return listConnections();
    }
    if (name === "use_connection") {
        return useConnection(request);
    }
    if (name === "fetch_graylog_messages") {
        return fetchGraylogMessages(request);
    }
    if (name === "get_surrounding_messages") {
        return getSurroundingMessages(request);
    }
    if (name === "list_streams") {
        return listStreams();
    }
    if (name === "list_field_values") {
        return listFieldValues(request);
    }
    if (name === "get_log_histogram") {
        return getLogHistogram(request);
    }
    if (name === "get_field_aggregation") {
        return getFieldAggregation(request);
    }
    if (name === "get_field_time_aggregation") {
        return getFieldTimeAggregation(request);
    }
    if (name === "debug_histogram_query") {
        return debugHistogramQuery(request);
    }

    throw new Error(`Tool not found: ${name}`);
});

function listConnections() {
    const connections = getConnections();
    const names = Object.keys(connections);
    if (names.length === 0) {
        return {
            content: [{
                type: "text",
                text: `No connections found. Add connections to ${getConfigPath()}`,
            }],
        };
    }

    const active = getActiveConnection();
    const list = names.map(n => {
        return `${active === n ? "* " : "  "}${n} (${connections[n].baseUrl})`;
    }).join("\n");

    return {
        content: [{
            type: "text",
            text: `Available connections (* = active):\n${list}`,
        }],
    };
}

function useConnection(request) {
    const connectionName = request.params.arguments?.name;
    if (!connectionName) {
        return {
            isError: true,
            content: [{ type: "text", text: "Connection name is required" }],
        };
    }

    const connections = getConnections();
    if (!connections[connectionName]) {
        const available = Object.keys(connections).join(", ");
        return {
            content: [{
                type: "text",
                text: `Connection "${connectionName}" not found. Available: ${available || "none"}`,
            }],
        };
    }

    setActiveConnection(connectionName);
    return {
        content: [{
            type: "text",
            text: `Connected to "${connectionName}" (${connections[connectionName].baseUrl})`,
        }],
    };
}

function requireActiveConnection() {
    const conn = getActiveConnectionConfig();
    if (!conn) {
        const available = Object.keys(getConnections()).join(", ");
        return {
            error: {
                isError: true,
                content: [{
                    type: "text",
                    text: `No active connection. Use 'use_connection' first. Available: ${available || "none"}`,
                }],
            },
        };
    }
    return { conn };
}

async function fetchGraylogMessages(request) {
    const { conn, error } = requireActiveConnection();
    if (error) return error;

    const args = request.params.arguments || {};
    const { timeRange } = normalizeTimeRangeArgs(args);
    const queryString = buildQueryString(args.query, args.filters, args.exactMatch ?? true);
    const fieldList = resolveFields(args.fields, getDefaultFields());
    const pageSize = args.pageSize ?? 50;
    const page = args.page ?? 1;
    const offset = (page - 1) * pageSize;

    const streamFilter = buildStreamFilter(args.streamId);
    const payload = {
        queries: [{
            id: "q1",
            query: { type: "elasticsearch", query_string: queryString },
            filter: streamFilter,
            timerange: timeRange,
            search_types: [{
                id: "st1",
                type: "messages",
                limit: pageSize,
                offset,
            }]
        }]
    };

    try {
        const data = await searchGraylog(conn.baseUrl, conn.apiToken, payload);
        const { totalResults, extracted } = extractMessages(data, fieldList);
        const totalPages = Math.ceil(totalResults / pageSize);

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    total_results: totalResults,
                    page,
                    page_size: pageSize,
                    total_pages: totalPages,
                    time_range: timeRange,
                    query: queryString,
                    messages: extracted,
                }),
            }],
        };
    } catch (err) {
        return {
            isError: true,
            content: [{
                type: "text",
                text: `Error fetching messages: ${err.message}`,
            }],
        };
    }
}

async function getSurroundingMessages(request) {
    const { conn, error } = requireActiveConnection();
    if (error) return error;

    const args = request.params.arguments || {};
    let messageTimestamp = args.messageTimestamp;

    // Resolve timestamp from messageId if provided
    if (args.messageId) {
        const msg = await fetchMessageById(conn.baseUrl, conn.apiToken, args.messageId);
        if (!msg) {
            return {
                isError: true,
                content: [{
                    type: "text",
                    text: `Message not found: ${args.messageId}`,
                }],
            };
        }
        messageTimestamp = msg.timestamp;
    }

    if (!messageTimestamp) {
        return {
            isError: true,
            content: [{ type: "text", text: "Either messageId or messageTimestamp is required" }],
        };
    }

    const targetTime = new Date(messageTimestamp);
    if (isNaN(targetTime.getTime())) {
        return {
            isError: true,
            content: [{ type: "text", text: `Invalid timestamp: ${messageTimestamp}` }],
        };
    }

    const surroundingSeconds = args.surroundingSeconds ?? 5;
    const from = new Date(targetTime.getTime() - surroundingSeconds * 1000).toISOString();
    const to = new Date(targetTime.getTime() + surroundingSeconds * 1000).toISOString();
    const queryString = buildQueryString(args.query, args.filters, args.exactMatch ?? true);
    const fieldList = resolveFields(args.fields, getDefaultFields());

    const streamFilter = buildStreamFilter(args.streamId);
    const payload = {
        queries: [{
            id: "q1",
            query: { type: "elasticsearch", query_string: queryString },
            filter: streamFilter,
            timerange: { type: "absolute", from, to },
            search_types: [{
                id: "st1",
                type: "messages",
                limit: args.limit ?? 50,
                sort: [{ field: "timestamp", order: "ASC" }],
            }]
        }]
    };

    try {
        const data = await searchGraylog(conn.baseUrl, conn.apiToken, payload);
        const { totalResults, extracted } = extractMessages(data, fieldList);

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    target_timestamp: messageTimestamp,
                    window: { from, to },
                    total_results: totalResults,
                    messages: extracted,
                }),
            }],
        };
    } catch (err) {
        return {
            isError: true,
            content: [{
                type: "text",
                text: `Error fetching surrounding messages: ${err.message}`,
            }],
        };
    }
}

async function listStreams() {
    const { conn, error } = requireActiveConnection();
    if (error) return error;

    try {
        const data = await fetchStreams(conn.baseUrl, conn.apiToken);
        const streams = (data.streams || []).map(s => ({
            id: s.id,
            title: s.title,
            description: s.description || "",
        }));

        return {
            content: [{
                type: "text",
                text: JSON.stringify({ total: data.total || streams.length, streams }),
            }],
        };
    } catch (err) {
        return {
            isError: true,
            content: [{
                type: "text",
                text: `Error fetching streams: ${err.message}`,
            }],
        };
    }
}

async function listFieldValues(request) {
    const { conn, error } = requireActiveConnection();
    if (error) return error;

    const args = request.params.arguments || {};
    const field = args.field;
    if (!field) {
        return {
            isError: true,
            content: [{ type: "text", text: "field is required" }],
        };
    }

    const { timeRange } = normalizeTimeRangeArgs(args);
    const limit = args.limit ?? 20;
    const queryString = buildQueryString(args.query, args.filters, args.exactMatch ?? true);

    const streamFilter = buildStreamFilter(args.streamId);
    const payload = {
        queries: [{
            id: "q1",
            query: { type: "elasticsearch", query_string: queryString },
            filter: streamFilter,
            timerange: timeRange,
            search_types: [{
                id: "st1",
                type: "pivot",
                row_groups: [{ type: "values", field, limit }],
                series: [{ type: "count", id: "count" }],
                rollup: false,
            }]
        }]
    };

    try {
        const data = await searchGraylog(conn.baseUrl, conn.apiToken, payload);
        const rows = data?.results?.q1?.search_types?.st1?.rows || [];
        const values = rows.map(r => ({
            value: r.key?.[0],
            count: r.values?.[0]?.value ?? 0,
        }));

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    field,
                    total: values.length,
                    time_range: timeRange,
                    query: queryString,
                    values
                }),
            }],
        };
    } catch (err) {
        return {
            isError: true,
            content: [{
                type: "text",
                text: `Error fetching field values: ${err.message}`,
            }],
        };
    }
}

async function getLogHistogram(request) {
    const { conn, error } = requireActiveConnection();
    if (error) return error;

    const args = request.params.arguments || {};
    const { timeRange } = normalizeTimeRangeArgs(args);
    const queryString = buildQueryString(args.query, args.filters, args.exactMatch ?? true);
    const interval = args.interval || 'auto';

    // Try multiple approaches - put the working pattern first
    const approaches = [
        { name: 'working-pattern', builder: buildWorkingHistogram },
        { name: 'chart', builder: buildTimeHistogramChart },
        { name: 'simple-pivot', builder: buildSimpleTimeHistogram },
        { name: 'complex-pivot', builder: buildTimeHistogram }
    ];

    for (const approach of approaches) {
        try {
            const payload = approach.builder(timeRange, interval, queryString, args.streamId);
            const result = await executeAggregation(conn.baseUrl, conn.apiToken, payload, 'histogram');

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        method: approach.name,
                        query: queryString,
                        time_range: timeRange,
                        interval: interval,
                        ...result,
                    }),
                }],
            };
        } catch (err) {
            console.error(`Histogram approach ${approach.name} failed: ${err.message}`);
        }
    }

    return {
        isError: true,
        content: [{
            type: "text",
            text: `Error getting log histogram: All approaches failed. Attempted: ${approaches.map(a => a.name).join(', ')}`,
        }],
    };
}

async function getFieldAggregation(request) {
    const { conn, error } = requireActiveConnection();
    if (error) return error;

    const args = request.params.arguments || {};
    const field = args.field;
    if (!field) {
        return {
            isError: true,
            content: [{ type: "text", text: "field is required" }],
        };
    }

    const { timeRange } = normalizeTimeRangeArgs(args);
    const queryString = buildQueryString(args.query, args.filters, args.exactMatch ?? true);
    const limit = args.limit ?? 20;
    const metrics = args.metrics || ['count'];
    const valueField = args.valueField;

    const needsValueField = metrics.some(m => ['sum', 'avg', 'min', 'max'].includes(m));
    if (needsValueField && !valueField) {
        return {
            isError: true,
            content: [{ type: "text", text: "valueField is required for sum, avg, min, max metrics" }],
        };
    }

    try {
        const payload = buildFieldAggregation(timeRange, field, queryString, limit, metrics, valueField, args.streamId);
        const result = await executeAggregation(conn.baseUrl, conn.apiToken, payload, 'field');

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    field: field,
                    metrics: metrics,
                    value_field: valueField,
                    query: queryString,
                    time_range: timeRange,
                    ...result,
                }),
            }],
        };
    } catch (err) {
        return {
            isError: true,
            content: [{
                type: "text",
                text: `Error getting field aggregation: ${err.message}`,
            }],
        };
    }
}

async function getFieldTimeAggregation(request) {
    const { conn, error } = requireActiveConnection();
    if (error) return error;

    const args = request.params.arguments || {};
    const field = args.field;
    if (!field) {
        return {
            isError: true,
            content: [{ type: "text", text: "field is required" }],
        };
    }

    const { timeRange } = normalizeTimeRangeArgs(args);
    const queryString = buildQueryString(args.query, args.filters, args.exactMatch ?? true);
    const interval = args.interval || 'auto';
    const limit = args.limit ?? 10;

    // Try multiple approaches
    const approaches = [
        { name: 'simple-pivot', builder: buildSimpleFieldTimeAggregation },
        { name: 'complex-pivot', builder: buildFieldTimeAggregation }
    ];

    for (const approach of approaches) {
        try {
            const payload = approach.builder(timeRange, field, interval, queryString, limit, args.streamId);
            const result = await executeAggregation(conn.baseUrl, conn.apiToken, payload, 'field-time');

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        method: approach.name,
                        field: field,
                        query: queryString,
                        time_range: timeRange,
                        interval: interval,
                        ...result,
                    }),
                }],
            };
        } catch (err) {
            console.error(`Field-time approach ${approach.name} failed: ${err.message}`);
        }
    }

    return {
        isError: true,
        content: [{
            type: "text",
            text: `Error getting field-time aggregation: All approaches failed. Attempted: ${approaches.map(a => a.name).join(', ')}`,
        }],
    };
}

async function debugHistogramQuery(request) {
    const { conn, error } = requireActiveConnection();
    if (error) return error;

    const args = request.params.arguments || {};
    const { timeRange } = normalizeTimeRangeArgs(args);
    const queryString = buildQueryString(args.query, args.filters, args.exactMatch ?? true);

    try {
        const streamFilter = buildStreamFilter(args.streamId);

        // First test: Basic message search to see if query finds anything
        const basicPayload = {
            queries: [{
                id: "q1",
                query: { type: "elasticsearch", query_string: queryString },
                filter: streamFilter,
                timerange: timeRange,
                search_types: [{
                    id: "st1",
                    type: "messages",
                    limit: 10,
                }]
            }]
        };

        const basicResult = await searchGraylog(conn.baseUrl, conn.apiToken, basicPayload);
        const basicMessages = basicResult?.results?.q1?.search_types?.st1?.messages || [];
        const totalMessages = basicResult?.results?.q1?.search_types?.st1?.total_results || 0;

        // Second test: Simple count aggregation
        const countPayload = {
            queries: [{
                id: "q1",
                query: { type: "elasticsearch", query_string: queryString },
                filter: streamFilter,
                timerange: timeRange,
                search_types: [{
                    id: "st1",
                    type: "pivot",
                    series: [{ type: "count" }],
                    rollup: false
                }]
            }]
        };

        const countResult = await searchGraylog(conn.baseUrl, conn.apiToken, countPayload);
        const countRows = countResult?.results?.q1?.search_types?.st1?.rows || [];

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    debug_type: "histogram_query_debug",
                    query: queryString,
                    time_range: timeRange,
                    basic_search: {
                        total_messages: totalMessages,
                        sample_messages_count: basicMessages.length,
                        first_message_timestamp: basicMessages[0]?.message?.timestamp || null
                    },
                    count_aggregation: {
                        row_count: countRows.length,
                        total_count: countRows[0]?.values?.[0]?.value || 0
                    },
                    diagnosis: {
                        has_data: totalMessages > 0,
                        query_works: totalMessages > 0 ? "YES" : "NO - Query finds no messages",
                        aggregation_works: countRows.length > 0 ? "YES" : "NO - Count aggregation fails",
                        likely_issue: totalMessages === 0 ? "Query or time range too restrictive" :
                                    countRows.length === 0 ? "Aggregation compatibility issue" :
                                    "Histogram-specific formatting issue"
                    }
                }),
            }],
        };
    } catch (err) {
        return {
            isError: true,
            content: [{
                type: "text",
                text: `Debug query failed: ${err.message}`,
            }],
        };
    }
}

const transport = new StdioServerTransport();
await server.connect(transport);
