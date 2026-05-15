// Tool-handler registration barrel. Importing this module for side-effects
// registers every v2.3 tool against src/dispatch.js's Map. src/index.js
// imports this file once at module-init, then calls assertAllToolsRegistered
// to fail-fast if any tool in src/tools.js lacks a registered handler.
//
// Plan 00-05 Task 2: initial registration uses OLD v2.3 tool names. Task 3
// applies the D-03 rename map (12 tools renamed); both this file and
// src/tools.js shift to the new names atomically in that task.

import { register } from "../dispatch.js";

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
} from "../handlers.js";

import { handleClusterLogMessages } from "./cluster-errors.js";
import {
    handleListTemplates,
    handleDeleteTemplate,
    handleRenameTemplate,
    handleExportTemplates,
    handleImportTemplates,
} from "./template-mgmt.js";

register("list_connections", listConnectionsHandler);
register("use_connection", useConnectionHandler);
register("fetch_graylog_messages", fetchGraylogMessagesHandler);
register("get_surrounding_messages", getSurroundingMessagesHandler);
register("list_streams", listStreamsHandler);
register("list_field_values", listFieldValuesHandler);
register("get_log_histogram", getLogHistogramHandler);
register("get_field_aggregation", getFieldAggregationHandler);
register("get_field_time_aggregation", getFieldTimeAggregationHandler);
register("debug_histogram_query", debugHistogramQueryHandler);
register("save_search", saveSearchHandler);
register("list_saved_searches", listSavedSearchesHandler);
register("get_saved_search", getSavedSearchHandler);
register("delete_saved_search", deleteSavedSearchHandler);
register("search_events", searchEventsHandler);
register("get_event_definitions", getEventDefinitionsHandler);
register("get_event_notifications", getEventNotificationsHandler);
register("cluster_log_messages", handleClusterLogMessages);
register("list_log_templates", handleListTemplates);
register("delete_log_template", handleDeleteTemplate);
register("rename_log_template", handleRenameTemplate);
register("export_log_templates", handleExportTemplates);
register("import_log_templates", handleImportTemplates);
