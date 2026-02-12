#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import {
    getConfigPath, getConnections, getActiveConnection,
    setActiveConnection, getActiveConnectionConfig, DEFAULT_FIELDS
} from "./config.js";
import { buildQueryString, resolveFields, extractMessages, fetchMessageById, fetchStreams, searchGraylog } from "./query.js";
import { toolDefinitions } from "./tools.js";

const server = new Server({
    name: "simple-graylog-mcp",
    version: "1.0.0",
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
        throw new Error("Connection name is required");
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
    const queryString = buildQueryString(args.query, args.filters, args.exactMatch ?? true);
    const fieldList = resolveFields(args.fields, DEFAULT_FIELDS);
    const pageSize = args.pageSize ?? 50;
    const page = args.page ?? 1;
    const offset = (page - 1) * pageSize;

    const payload = {
        queries: [{
            id: "q1",
            query: { type: "elasticsearch", query_string: queryString },
            timerange: { type: "relative", range: args.searchTimeRangeInSeconds ?? 900 },
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
                    messages: extracted,
                }),
            }],
        };
    } catch (err) {
        return {
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
                content: [{
                    type: "text",
                    text: `Message not found: ${args.messageId}`,
                }],
            };
        }
        messageTimestamp = msg.timestamp;
    }

    if (!messageTimestamp) {
        throw new Error("Either messageId or messageTimestamp is required");
    }

    const targetTime = new Date(messageTimestamp);
    if (isNaN(targetTime.getTime())) {
        throw new Error(`Invalid timestamp: ${messageTimestamp}`);
    }

    const surroundingSeconds = args.surroundingSeconds ?? 5;
    const from = new Date(targetTime.getTime() - surroundingSeconds * 1000).toISOString();
    const to = new Date(targetTime.getTime() + surroundingSeconds * 1000).toISOString();
    const queryString = buildQueryString(args.query, args.filters, args.exactMatch ?? true);
    const fieldList = resolveFields(args.fields, DEFAULT_FIELDS);

    const payload = {
        queries: [{
            id: "q1",
            query: { type: "elasticsearch", query_string: queryString },
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
        throw new Error("field is required");
    }

    const limit = args.limit ?? 20;
    const queryString = buildQueryString(args.query, args.filters, args.exactMatch ?? true);

    const payload = {
        queries: [{
            id: "q1",
            query: { type: "elasticsearch", query_string: queryString },
            timerange: { type: "relative", range: args.timeRangeInSeconds ?? 3600 },
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
                text: JSON.stringify({ field, total: values.length, values }),
            }],
        };
    } catch (err) {
        return {
            content: [{
                type: "text",
                text: `Error fetching field values: ${err.message}`,
            }],
        };
    }
}

const transport = new StdioServerTransport();
await server.connect(transport);
