// Tool-handler registration barrel. Importing this module for side-effects
// registers every v2.3 tool against src/dispatch.js's Map. src/index.js
// imports this file once at module-init, then calls assertAllToolsRegistered
// to fail-fast if any tool in src/tools.js lacks a registered handler.
//
// Plan 00-05 Task 3 applied the D-03 rename map: 12 of the 23 v2.3 tools
// were renamed to fit the `<verb>_<domain>_<noun>` convention. The internal
// handler function names retain the OLD camelCase (per RESEARCH.md Q9
// closing rationale — internal-name rename is out of scope for Phase 0).
// Old→new pairs are documented in CHANGELOG.md.

import { register } from "../dispatch.js";

import {
    listConnectionsHandler,
    useConnectionHandler,
    fetchGraylogMessagesHandler,
    getSurroundingMessagesHandler,
    // Phase 3 Plan 01 (Pitfall S5 displacement): the v2.3 listStreamsHandler
    // export in ../handlers.js is intentionally NOT imported here. The new
    // Phase 3 list_streams (registered via ./streams/index.js below) claims
    // the dispatch name; the v2.3 function in ../handlers.js stays exported
    // for HARD-03 audit reference (Phase 7) but is no longer wired into
    // dispatch.
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

// Phase 1 domain barrels — each module side-effect-registers its handlers.
// Import here so a single `import "./tools/_register.js"` wires everything.
import "./inputs/index.js";
// Phase 2 domain barrel — registers list_index_sets, get_index_set,
// and await_system_job (the cross-domain polling primitive).
import "./index-sets/index.js";
// Phase 3 domain barrel — registers list_streams (replaces v2.3), get_stream,
// and list_stream_rules. Plans 03-02 / 03-03 / 03-04 will extend this barrel
// with the 9 remaining mutating tools.
import "./streams/index.js";
// Phase 4 domain barrel — registers list_pipelines, get_pipeline,
// create_pipeline, update_pipeline, delete_pipeline (Plan 04-02 ships
// PIPE-01..PIPE-05). Plans 04-03/04/05 will extend with the 9 remaining
// pipeline-rule + connection tools.
import "./pipelines/index.js";

// Names that already fit `<verb>_<domain>_<noun>` (10 of 23 — list_streams
// displaced; the new Phase 3 handler is registered via ./streams/index.js
// above, before this section's register() calls fire).
register("list_connections", listConnectionsHandler);
register("list_field_values", listFieldValuesHandler);
register("list_saved_searches", listSavedSearchesHandler);
register("get_saved_search", getSavedSearchHandler);
register("delete_saved_search", deleteSavedSearchHandler);
register("cluster_log_messages", handleClusterLogMessages);
register("list_log_templates", handleListTemplates);
register("delete_log_template", handleDeleteTemplate);
register("export_log_templates", handleExportTemplates);
register("import_log_templates", handleImportTemplates);

// Renamed under D-03 (12 of 23) — see CHANGELOG.md for old→new pairs
register("set_active_connection", useConnectionHandler);
register("search_messages_graylog", fetchGraylogMessagesHandler);
register("get_context_messages", getSurroundingMessagesHandler);
register("get_histogram_messages", getLogHistogramHandler);
register("get_aggregation_field", getFieldAggregationHandler);
register("get_aggregation_field_over_time", getFieldTimeAggregationHandler);
register("debug_query_histogram", debugHistogramQueryHandler);
register("create_saved_search", saveSearchHandler);
register("search_events_graylog", searchEventsHandler);
register("list_event_definitions", getEventDefinitionsHandler);
register("list_event_notifications", getEventNotificationsHandler);
register("update_log_template", handleRenameTemplate);
