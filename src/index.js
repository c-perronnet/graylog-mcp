#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { toolDefinitions } from "./tools.js";
import {
    listConnectionsHandler,
    useConnectionHandler,
    fetchGraylogMessagesHandler,
    getSurroundingMessagesHandler,
    listStreamsHandler,
    listFieldValuesHandler,
    getLogHistogramHandler,
    getFieldAggregationHandler,
    getFieldTimeAggregationHandler,
    debugHistogramQueryHandler,
    saveSearchHandler,
    listSavedSearchesHandler,
    getSavedSearchHandler,
    deleteSavedSearchHandler,
    searchEventsHandler,
    getEventDefinitionsHandler,
    getEventNotificationsHandler,
} from "./handlers.js";
import { handleClusterLogMessages } from "./tools/cluster-errors.js";
import {
    handleListTemplates, handleDeleteTemplate, handleRenameTemplate,
    handleExportTemplates, handleImportTemplates
} from "./tools/template-mgmt.js";

const server = new Server({
    name: "graylog-mcp-server",
    version: "2.2.0",
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
        return listConnectionsHandler(request);
    }
    if (name === "use_connection") {
        return useConnectionHandler(request);
    }
    if (name === "fetch_graylog_messages") {
        return fetchGraylogMessagesHandler(request);
    }
    if (name === "get_surrounding_messages") {
        return getSurroundingMessagesHandler(request);
    }
    if (name === "list_streams") {
        return listStreamsHandler(request);
    }
    if (name === "list_field_values") {
        return listFieldValuesHandler(request);
    }
    if (name === "get_log_histogram") {
        return getLogHistogramHandler(request);
    }
    if (name === "get_field_aggregation") {
        return getFieldAggregationHandler(request);
    }
    if (name === "get_field_time_aggregation") {
        return getFieldTimeAggregationHandler(request);
    }
    if (name === "debug_histogram_query") {
        return debugHistogramQueryHandler(request);
    }
    if (name === "save_search") {
        return saveSearchHandler(request);
    }
    if (name === "list_saved_searches") {
        return listSavedSearchesHandler(request);
    }
    if (name === "get_saved_search") {
        return getSavedSearchHandler(request);
    }
    if (name === "delete_saved_search") {
        return deleteSavedSearchHandler(request);
    }
    if (name === "search_events") {
        return searchEventsHandler(request);
    }
    if (name === "get_event_definitions") {
        return getEventDefinitionsHandler(request);
    }
    if (name === "get_event_notifications") {
        return getEventNotificationsHandler(request);
    }

    if (name === "cluster_log_messages") {
        return handleClusterLogMessages(request);
    }

    if (name === "list_log_templates") return handleListTemplates(request);
    if (name === "delete_log_template") return handleDeleteTemplate(request);
    if (name === "rename_log_template") return handleRenameTemplate(request);
    if (name === "export_log_templates") return handleExportTemplates(request);
    if (name === "import_log_templates") return handleImportTemplates(request);

    throw new Error(`Tool not found: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
