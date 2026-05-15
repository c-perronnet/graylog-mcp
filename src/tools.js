export const toolDefinitions = [
    {
        name: "list_connections",
        description: "List all available Graylog connections configured in ~/.graylog-mcp/config.json",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "set_active_connection",
        description: "Connect to a specific Graylog instance by name. Must be called before fetching messages.",
        inputSchema: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "The connection name as defined in ~/.graylog-mcp/config.json",
                },
            },
            required: ["name"],
        },
    },
    {
        name: "search_messages_graylog",
        description: "Fetch messages from the active Graylog connection. Use 'set_active_connection' first to select a connection.",
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "The query to search for, with the respective fields and values",
                },
                timeRange: {
                    type: "string",
                    description: "Time range (e.g., '1h', '2d', '30m') or use from/to for absolute range",
                },
                from: {
                    type: "string",
                    description: "Start time for absolute range (ISO string or timestamp)",
                },
                to: {
                    type: "string",
                    description: "End time for absolute range (ISO string or timestamp)",
                },
                searchTimeRangeInSeconds: {
                    type: "number",
                    description: "[DEPRECATED] Use timeRange instead. Time range in seconds",
                },
                pageSize: {
                    type: "number",
                    description: "Number of messages per page. Default: 50",
                },
                page: {
                    type: "number",
                    description: "Page number (starts at 1). Default: 1",
                },
                fields: {
                    type: "string",
                    description: "Comma-separated field names to return, or '*' for all fields. Default: returns key fields only (timestamp, gl2_message_id, source, env, level, message, logger_name, thread_name, PODNAME)",
                },
                filters: {
                    type: "object",
                    description: "Field filters (e.g. {\"env\": \"marketplace_loki\", \"level\": 7, \"source\": \"prefr-management\"})",
                },
                exactMatch: {
                    type: "boolean",
                    description: "If true (default), wraps the query in quotes for exact match. Set to false for fuzzy/wildcard search.",
                },
                streamIds: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional stream IDs to scope the search. Use 'list_streams' to get available stream IDs.",
                },
            },
        },
    },
    {
        name: "get_context_messages",
        description: "Get messages surrounding a specific message. Provide messageId (preferred) or messageTimestamp to identify the target message.",
        inputSchema: {
            type: "object",
            properties: {
                messageId: {
                    type: "string",
                    description: "gl2_message_id of the target message (preferred). The timestamp will be looked up automatically.",
                },
                messageTimestamp: {
                    type: "string",
                    description: "ISO timestamp of the target message (fallback if messageId is not available)",
                },
                surroundingSeconds: {
                    type: "number",
                    description: "Time window in seconds (± around the timestamp). Default: 5",
                },
                query: {
                    type: "string",
                    description: "Additional query filter to narrow context",
                },
                filters: {
                    type: "object",
                    description: "Field filters (e.g. {\"env\": \"marketplace_loki\", \"level\": 7})",
                },
                exactMatch: {
                    type: "boolean",
                    description: "If true (default), wraps the query in quotes for exact match. Set to false for fuzzy/wildcard search.",
                },
                limit: {
                    type: "number",
                    description: "Maximum number of messages to return. Default: 50",
                },
                fields: {
                    type: "string",
                    description: "Comma-separated field names to return, or '*' for all fields. Default: returns key fields only (timestamp, gl2_message_id, source, env, level, message, logger_name, thread_name, PODNAME)",
                },
                streamIds: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional stream IDs to scope the search. Use 'list_streams' to get available stream IDs.",
                },
            },
        },
    },
    {
        name: "list_streams",
        description: "List all available Graylog streams in the active connection.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "list_field_values",
        description: "List distinct values of a field with message counts. Useful for discovering available sources, environments, logger names, etc. Results are sorted by count descending.",
        inputSchema: {
            type: "object",
            properties: {
                field: {
                    type: "string",
                    description: "The field to get distinct values for (e.g. 'source', 'env', 'logger_name', 'level')",
                },
                query: {
                    type: "string",
                    description: "Query to scope the results (e.g. search within specific messages)",
                },
                filters: {
                    type: "object",
                    description: "Field filters to narrow scope (e.g. {\"env\": \"marketplace_loki\"})",
                },
                exactMatch: {
                    type: "boolean",
                    description: "If true (default), wraps the query in quotes for exact match. Set to false for fuzzy/wildcard search.",
                },
                timeRange: {
                    type: "string",
                    description: "Time range (e.g., '1h', '2d', '30m') or use from/to for absolute range",
                },
                from: {
                    type: "string",
                    description: "Start time for absolute range (ISO string or timestamp)",
                },
                to: {
                    type: "string",
                    description: "End time for absolute range (ISO string or timestamp)",
                },
                timeRangeInSeconds: {
                    type: "number",
                    description: "[DEPRECATED] Use timeRange instead. Time range in seconds. Default: 3600 (1 hour)",
                },
                limit: {
                    type: "number",
                    description: "Maximum number of distinct values to return. Default: 20",
                },
                streamIds: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional stream IDs to scope the search. Use 'list_streams' to get available stream IDs.",
                },
            },
            required: ["field"],
        },
    },
    {
        name: "get_histogram_messages",
        description: "Get a time-based histogram of log messages. Shows message counts over time intervals.",
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Query to filter messages",
                },
                filters: {
                    type: "object",
                    description: "Field filters (e.g. {\"env\": \"production\", \"level\": 3})",
                },
                exactMatch: {
                    type: "boolean",
                    description: "If true (default), wraps the query in quotes for exact match.",
                },
                timeRange: {
                    type: "string",
                    description: "Time range (e.g., '1h', '2d', '30m') or use from/to for absolute range",
                },
                from: {
                    type: "string",
                    description: "Start time for absolute range (ISO string or timestamp)",
                },
                to: {
                    type: "string",
                    description: "End time for absolute range (ISO string or timestamp)",
                },
                interval: {
                    type: "string",
                    description: "Time interval for buckets (e.g., '1m', '5m', '1h', 'auto'). Default: 'auto'",
                },
                metrics: {
                    type: "array",
                    items: { type: "string", enum: ["count", "sum", "avg", "min", "max"] },
                    description: "Metrics to calculate per time bucket. Default: ['count']. Use with valueField for numeric aggregations.",
                },
                valueField: {
                    type: "string",
                    description: "Numeric field for sum/avg/min/max calculations (e.g., 'latencies_request'). Required when metrics include non-count metrics.",
                },
                streamIds: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional stream IDs to scope the search. Use 'list_streams' to get available stream IDs.",
                },
            },
        },
    },
    {
        name: "get_aggregation_field",
        description: "Aggregate log messages by field values with statistics. Get counts, sums, averages, etc. for field values.",
        inputSchema: {
            type: "object",
            properties: {
                field: {
                    type: "string",
                    description: "Field to aggregate on (e.g., 'source', 'env', 'logger_name', 'level')",
                },
                query: {
                    type: "string",
                    description: "Query to filter messages",
                },
                filters: {
                    type: "object",
                    description: "Field filters (e.g. {\"env\": \"production\"})",
                },
                exactMatch: {
                    type: "boolean",
                    description: "If true (default), wraps the query in quotes for exact match.",
                },
                timeRange: {
                    type: "string",
                    description: "Time range (e.g., '1h', '2d', '30m') or use from/to for absolute range",
                },
                from: {
                    type: "string",
                    description: "Start time for absolute range (ISO string or timestamp)",
                },
                to: {
                    type: "string",
                    description: "End time for absolute range (ISO string or timestamp)",
                },
                limit: {
                    type: "number",
                    description: "Maximum number of field values to return. Default: 20",
                },
                metrics: {
                    type: "array",
                    items: { type: "string", enum: ["count", "sum", "avg", "min", "max"] },
                    description: "Metrics to calculate. Default: ['count']",
                },
                valueField: {
                    type: "string",
                    description: "Numeric field for sum/avg/min/max calculations (required for non-count metrics)",
                },
                streamIds: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional stream IDs to scope the search. Use 'list_streams' to get available stream IDs.",
                },
            },
            required: ["field"],
        },
    },
    {
        name: "get_aggregation_field_over_time",
        description: "Two-dimensional aggregation: field values over time. Shows how field values change over time intervals.",
        inputSchema: {
            type: "object",
            properties: {
                field: {
                    type: "string",
                    description: "Field to aggregate on (e.g., 'source', 'env', 'level')",
                },
                query: {
                    type: "string",
                    description: "Query to filter messages",
                },
                filters: {
                    type: "object",
                    description: "Field filters (e.g. {\"env\": \"production\"})",
                },
                exactMatch: {
                    type: "boolean",
                    description: "If true (default), wraps the query in quotes for exact match.",
                },
                timeRange: {
                    type: "string",
                    description: "Time range (e.g., '1h', '2d', '30m') or use from/to for absolute range",
                },
                from: {
                    type: "string",
                    description: "Start time for absolute range (ISO string or timestamp)",
                },
                to: {
                    type: "string",
                    description: "End time for absolute range (ISO string or timestamp)",
                },
                interval: {
                    type: "string",
                    description: "Time interval for buckets (e.g., '1m', '5m', '1h', 'auto'). Default: 'auto'",
                },
                limit: {
                    type: "number",
                    description: "Maximum number of field values to return. Default: 10",
                },
                streamIds: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional stream IDs to scope the search. Use 'list_streams' to get available stream IDs.",
                },
            },
            required: ["field"],
        },
    },
    {
        name: "debug_query_histogram",
        description: "Debug helper to test if the histogram query finds any messages at all. Use this if histogram returns empty buckets.",
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Query to test",
                },
                filters: {
                    type: "object",
                    description: "Field filters to test",
                },
                exactMatch: {
                    type: "boolean",
                    description: "If true (default), wraps the query in quotes for exact match.",
                },
                timeRange: {
                    type: "string",
                    description: "Time range (e.g., '1h', '30m', '2d')",
                },
                from: {
                    type: "string",
                    description: "Start time for absolute range",
                },
                to: {
                    type: "string",
                    description: "End time for absolute range",
                },
                streamIds: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional stream IDs to scope the search. Use 'list_streams' to get available stream IDs.",
                },
            },
        },
    },
    {
        name: "create_saved_search",
        description: "Save a named search query for later reuse. Saves query parameters so you don't have to re-type complex searches.",
        inputSchema: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "A unique name for this saved search",
                },
                query: {
                    type: "string",
                    description: "The query to save",
                },
                filters: {
                    type: "object",
                    description: "Field filters (e.g. {\"env\": \"production\", \"level\": 3})",
                },
                timeRange: {
                    type: "string",
                    description: "Time range (e.g., '1h', '2d', '30m')",
                },
                from: {
                    type: "string",
                    description: "Start time for absolute range (ISO string or timestamp)",
                },
                to: {
                    type: "string",
                    description: "End time for absolute range (ISO string or timestamp)",
                },
                fields: {
                    type: "string",
                    description: "Comma-separated field names to return, or '*' for all fields",
                },
                streamIds: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional stream IDs to scope the search",
                },
                exactMatch: {
                    type: "boolean",
                    description: "If true, wraps the query in quotes for exact match",
                },
                pageSize: {
                    type: "number",
                    description: "Number of messages per page",
                },
            },
            required: ["name"],
        },
    },
    {
        name: "list_saved_searches",
        description: "List all saved searches.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "get_saved_search",
        description: "Load and execute a saved search by name. Optional overrides can be provided to adjust the search at execution time.",
        inputSchema: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "The name of the saved search to execute",
                },
                page: {
                    type: "number",
                    description: "Page number (starts at 1). Default: 1",
                },
                pageSize: {
                    type: "number",
                    description: "Override the saved page size",
                },
                timeRange: {
                    type: "string",
                    description: "Override the saved time range (e.g., '1h', '2d')",
                },
                from: {
                    type: "string",
                    description: "Override the saved start time",
                },
                to: {
                    type: "string",
                    description: "Override the saved end time",
                },
            },
            required: ["name"],
        },
    },
    {
        name: "delete_saved_search",
        description: "Delete a saved search by name.",
        inputSchema: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "The name of the saved search to delete",
                },
            },
            required: ["name"],
        },
    },
    {
        name: "search_events_graylog",
        description: "Search Graylog events and alerts. Use 'set_active_connection' first to select a connection.",
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Search query for events",
                },
                timeRange: {
                    type: "string",
                    description: "Time range (e.g., '1h', '2d', '30m') or use from/to for absolute range",
                },
                from: {
                    type: "string",
                    description: "Start time for absolute range (ISO string or timestamp)",
                },
                to: {
                    type: "string",
                    description: "End time for absolute range (ISO string or timestamp)",
                },
                alerts: {
                    type: "string",
                    enum: ["only", "include", "exclude"],
                    description: "Filter by alert status. 'only' = only alerts, 'include' = alerts + events, 'exclude' = only non-alert events. Default: include",
                },
                eventDefinitionIds: {
                    type: "array",
                    items: { type: "string" },
                    description: "Filter by specific event definition IDs",
                },
                page: {
                    type: "number",
                    description: "Page number (starts at 1). Default: 1",
                },
                perPage: {
                    type: "number",
                    description: "Number of results per page. Default: 25",
                },
                sortBy: {
                    type: "string",
                    description: "Field to sort by. Default: timestamp",
                },
                sortDirection: {
                    type: "string",
                    enum: ["asc", "desc"],
                    description: "Sort direction. Default: desc",
                },
            },
        },
    },
    {
        name: "list_event_definitions",
        description: "Get Graylog event definitions. Use 'set_active_connection' first to select a connection.",
        inputSchema: {
            type: "object",
            properties: {
                page: {
                    type: "number",
                    description: "Page number (starts at 1). Default: 1",
                },
                perPage: {
                    type: "number",
                    description: "Number of results per page. Default: 25",
                },
                query: {
                    type: "string",
                    description: "Search query to filter event definitions",
                },
            },
        },
    },
    {
        name: "list_event_notifications",
        description: "Get Graylog event notifications. Use 'set_active_connection' first to select a connection.",
        inputSchema: {
            type: "object",
            properties: {
                page: {
                    type: "number",
                    description: "Page number (starts at 1). Default: 1",
                },
                perPage: {
                    type: "number",
                    description: "Number of results per page. Default: 25",
                },
            },
        },
    },
    {
        name: "cluster_log_messages",
        description: "Cluster similar log messages into Drain3-style templates. Fetches messages with the same args as search_messages_graylog, then groups them by structural similarity. Templates are persisted per connection and reused across calls.",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Query string (same as search_messages_graylog)" },
                filters: { type: "object", description: "Field filters" },
                timeRange: { type: "string", description: "Time range (e.g. '1h', '30m')" },
                from: { type: "string", description: "Absolute start time (ISO)" },
                to: { type: "string", description: "Absolute end time (ISO)" },
                streamIds: { type: "array", items: { type: "string" }, description: "Optional stream IDs" },
                exactMatch: { type: "boolean", description: "Wrap query in quotes (default true)" },
                sampleSize: { type: "number", description: "Max messages to fetch & cluster. Default 1000, max 10000." },
                field: { type: "string", description: "Field to cluster on. Default 'message'." },
                algorithm: { type: "string", description: "Clustering algorithm. Default 'drain3'." },
                minClusterSize: { type: "number", description: "Singletons collapsed under '_misc' cluster. Default 2." },
                readOnly: { type: "boolean", description: "If true, do not update template library. Default false." },
                includeSamples: { type: "number", description: "Sample messages per cluster (first/middle/last by time). Default 3." },
                similarityThreshold: { type: "number", description: "Drain3 similarity threshold 0-1. Default 0.6. Lower = more aggressive merging." },
                maxChildren: { type: "number", description: "Max templates per length bucket (LRU evict beyond this). Default 100." },
            },
        },
    },
    {
        name: "list_log_templates",
        description: "List learned log templates for the active connection.",
        inputSchema: {
            type: "object",
            properties: {
                limit: { type: "number", description: "Max templates to return. Default 50." },
                sortBy: { type: "string", enum: ["count", "last_seen", "first_seen"], description: "Sort key. Default 'count'." },
                filterLabel: { type: "string", description: "Only return templates with this label." },
            },
        },
    },
    {
        name: "delete_log_template",
        description: "Delete a learned log template by ID.",
        inputSchema: {
            type: "object",
            properties: {
                templateId: { type: "string", description: "Template ID (e.g. tpl_a3f1b2)" },
            },
            required: ["templateId"],
        },
    },
    {
        name: "update_log_template",
        description: "Set or update a human-readable label for a template.",
        inputSchema: {
            type: "object",
            properties: {
                templateId: { type: "string", description: "Template ID" },
                label: { type: "string", description: "Human-readable label (e.g. 'AuthFailure')" },
            },
            required: ["templateId", "label"],
        },
    },
    {
        name: "export_log_templates",
        description: "Export all learned templates for the active connection as JSON.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "import_log_templates",
        description: "Import templates into the active connection's library.",
        inputSchema: {
            type: "object",
            properties: {
                templates: { type: "object", description: "Map of templateId → template object" },
                mode: { type: "string", enum: ["merge", "replace"], description: "merge keeps existing; replace wipes first. Default 'merge'." },
            },
            required: ["templates"],
        },
    },
    // ----- Phase 1 inputs (INPUT-01, INPUT-02, INPUT-03) -----
    {
        name: "list_input_types",
        description: "List dynamically-discovered Graylog input types (e.g. GELF UDP, Beats2, Syslog TCP) — surfaces the type FQCN, display name, description, and requested_configuration. Cached per connection for the server process lifetime. Use this BEFORE create_input to discover available type FQCNs.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override; otherwise the active connection is used" },
                limit: { type: "number", description: "Max items to return. Default 25, max 200." },
                fields: { description: "Field projection: 'all' for full DTOs, array of field names for custom projection. Default narrow [id, title, description]." },
            },
        },
    },
    {
        name: "list_inputs",
        description: "List configured Graylog inputs on the connected cluster. Default narrow projection [id, title, type, global]; pass fields:\"all\" for full DTOs (configuration map included). Encrypted configuration fields in the full DTO are server-masked (<value hidden>, <password set>) — the MCP NEVER unmasks.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                limit: { type: "number", description: "Max items to return. Default 25, max 200." },
                fields: { description: "Field projection: 'all' for full DTOs, array of field names for custom projection. Default narrow [id, title, type, global]." },
            },
        },
    },
    {
        name: "get_input",
        description: "Fetch the full configuration of one Graylog input by ID. Returns the complete InputSummary (id, title, type, configuration map, global, node, created_at, ...). Encrypted fields surface as server-masked placeholders (<value hidden>, <password set>) — never the actual secret. Use list_inputs to discover IDs.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                inputId: { type: "string", description: "The Graylog input ID (e.g. from list_inputs)" },
            },
            required: ["inputId"],
        },
    },
    // ----- Phase 1 inputs CRUD (INPUT-04, INPUT-05, INPUT-06) -----
    {
        name: "create_input",
        description: "Create a Graylog input. Strict zod schemas ship for the common types: GELF UDP / TCP / HTTP, Beats2, Syslog UDP / TCP, Raw UDP / TCP. All other Graylog input types (AWS, CEF, Kafka, etc.) accept a generic validated configuration object. Encrypted fields in the dry-run preview show as <redacted>; the real secret is sent only on apply. NOTE: postApplyEstimate.id is __SERVER_ASSIGNED__ — DO NOT reuse it; use the real id from the apply response.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                type: { type: "string", description: "Input type FQCN (use list_input_types to discover)" },
                title: { type: "string", description: "Human-readable input title" },
                global: { type: "boolean", description: "Run on every node (default false)" },
                node: { type: "string", description: "Node ID for non-global inputs" },
                configuration: { type: "object", description: "Input-type-specific configuration map (validated per type FQCN)" },
            },
            required: ["type", "title", "configuration"],
        },
    },
    {
        name: "update_input",
        description: "Partial-update one Graylog input. The wire body's `configuration` object is built STRICTLY from your `changes.configuration` entries — unchanged fields are NEVER echoed (Graylog preserves them server-side). Encrypted fields (TLS cert password, AWS credentials) are NEVER echoed unless you explicitly pass a new value. Schema is { inputId, changes: { title?, global?, node?, configuration? } }. Pass `changes: { configuration: {} }` to no-op the configuration block (emits empty object).",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                inputId: { type: "string", description: "The Graylog input ID to update" },
                changes: { type: "object", description: "Partial-update subset: { title?, global?, node?, configuration? }" },
            },
            required: ["inputId", "changes"],
        },
    },
    {
        name: "delete_input",
        description: "Delete a Graylog input. Graylog cascades extractor removal server-side; the dry-run preview enumerates the affected extractors in cascades.extractors[] BEFORE message-handling impact lands. Use list_extractors first to inspect each cascade target if needed.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                inputId: { type: "string", description: "The Graylog input ID to delete" },
            },
            required: ["inputId"],
        },
    },
    // ----- Phase 1 input lifecycle (INPUT-07) -----
    {
        name: "start_input",
        description: "Start a Graylog input (set desired state to RUNNING). Maps to PUT /api/system/inputstates/{inputId} — no request body required. NOTE: This sets the DESIRED state; actual state may briefly remain STARTING until Graylog's input registry converges. Poll get_input if you need to wait for RUNNING.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                inputId: { type: "string", description: "The Graylog input ID to start" },
            },
            required: ["inputId"],
        },
    },
    {
        name: "stop_input",
        description: "Stop a Graylog input (set desired state to STOPPED). Maps to DELETE /api/system/inputstates/{inputId} — the verb is DELETE (not PUT) due to Graylog's REST semantics; the input itself is NOT deleted, only its running state. NOTE: This sets the DESIRED state; actual state may briefly remain STOPPING until Graylog's input registry converges. Poll get_input if you need to wait for STOPPED.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                inputId: { type: "string", description: "The Graylog input ID to stop" },
            },
            required: ["inputId"],
        },
    },
    // ----- Phase 1 extractor CRUD (INPUT-08, INPUT-09, INPUT-10, INPUT-11) -----
    {
        name: "list_extractors",
        description: "List extractors configured for one Graylog input. Default narrow projection [id, title, description]; pass fields:'all' for full extractor DTOs (extractor_type, source_field, target_field, extractor_config, condition_*, order, ...). Required arg: inputId.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                inputId: { type: "string", description: "The Graylog input ID whose extractors to list" },
                limit: { type: "number", description: "Max items to return. Default 25, max 200." },
                fields: { description: "Field projection: 'all' for full DTOs, array of field names for custom projection. Default narrow [id, title, description]." },
            },
            required: ["inputId"],
        },
    },
    {
        name: "create_extractor",
        description: "Create an extractor on a Graylog input. Supported extractor_type values (all 8 Graylog 7.0.6 primitives — D-07): grok, regex, regex_replace, split_and_index, substring, copy_input, json, lookup_table. Each type has a strict extractor_config shape (grok: {grok_pattern, named_captures_only?}; regex: {regex_value}; regex_replace: {regex, replacement, replace_all?}; split_and_index: {split_by, index}; substring: {begin_index, end_index}; copy_input: {}; json: {list_separator?, key_separator?, kv_separator?, key_prefix?, key_whitespace_replacement?, replace_key_whitespace?, flatten?}; lookup_table: {lookup_table_name}). IMPORTANT: there is NO 'key_value' extractor primitive in Graylog 7.0.6 — for key-value flattening, use extractor_type='json' with extractor_config={kv_separator: '=', key_separator: ',', flatten: true} (or your chosen separators). postApplyEstimate.id is __SERVER_ASSIGNED__ — DO NOT reuse it; use the real id from the apply response.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                inputId: { type: "string", description: "The Graylog input ID to attach the extractor to" },
                title: { type: "string", description: "Human-readable extractor title" },
                source_field: { type: "string", description: "Field to extract FROM (typically 'message')" },
                target_field: { type: "string", description: "Field to write the extracted value INTO" },
                extractor_type: {
                    type: "string",
                    enum: ["grok", "regex", "regex_replace", "split_and_index", "substring", "copy_input", "json", "lookup_table"],
                    description: "One of the 8 Graylog 7.0.6 extractor primitives (D-07). NO 'key_value' — use 'json' with kv_separator + flatten:true for key-value flattening",
                },
                extractor_config: { type: "object", description: "Type-specific configuration (validated per extractor_type)" },
                cursor_strategy: { type: "string", enum: ["copy", "cut"], description: "Whether to copy or cut the matched value from source_field. Default 'copy'." },
                converters: { type: "array", description: "Optional list of { type, config } converter pairs applied after extraction" },
                condition_type: { type: "string", enum: ["none", "string", "regex"], description: "Optional pre-extract condition. Default 'none'." },
                condition_value: { type: "string", description: "Condition value when condition_type is 'string' or 'regex'" },
                order: { type: "number", description: "Execution order among the input's extractors (default 0)" },
            },
            required: ["inputId", "title", "source_field", "target_field", "extractor_type", "extractor_config"],
        },
    },
    {
        name: "update_extractor",
        description: "Partial-update an extractor — the wrapper fetches the current extractor state and merges your `changes` onto it. extractor_type is IMMUTABLE on update (delete + recreate to switch types). Schema: { inputId, extractorId, changes: { title?, source_field?, target_field?, extractor_config?, cursor_strategy?, converters?, condition_type?, condition_value?, order? } }. Reuses the partial-update pattern from update_input (D-09); extractors carry no encrypted fields so the strict no-echo wire-build from update_input is not needed here.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                inputId: { type: "string", description: "The Graylog input ID owning the extractor" },
                extractorId: { type: "string", description: "The Graylog extractor ID to update" },
                changes: { type: "object", description: "Partial-update subset: { title?, source_field?, target_field?, extractor_config?, cursor_strategy?, converters?, condition_type?, condition_value?, order? }" },
            },
            required: ["inputId", "extractorId", "changes"],
        },
    },
    {
        name: "delete_extractor",
        description: "Delete one extractor from one input. Single-target — NO cascade enumeration (extractors carry no child resources, per D-09). To delete every extractor on an input, list them with list_extractors and delete each one. To delete an extractor AND the input that owns it, call delete_input instead — delete_input cascade-removes its extractors automatically.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                inputId: { type: "string", description: "The Graylog input ID owning the extractor" },
                extractorId: { type: "string", description: "The Graylog extractor ID to delete" },
            },
            required: ["inputId", "extractorId"],
        },
    },
    // ====================================================================
    // Phase 2 — Index sets & retention (Plan 02-01)
    // ====================================================================
    {
        name: "list_index_sets",
        description: "List Graylog index sets with narrow projection (id, title, description, default, writable, can_be_default, index_prefix). Use fields:'all' to fetch the full IndexSetResponse DTOs. NOTE: stats (messageCount, sizeBytes) are NOT included — use get_index_set or wait for delete_index_set's dry-run preview if you need per-index-set stats.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                limit: { type: "number", description: "Max results (default 25, max 200)" },
                fields: {
                    description: "Either 'all' for full DTOs OR an array of field names to project. Default is [id, title, description, default, writable, can_be_default, index_prefix].",
                },
            },
        },
    },
    {
        name: "get_index_set",
        description: "Fetch the full IndexSetResponse DTO for one index set: id, title, description, default, writable, can_be_default, index_prefix, shards, replicas, rotation_strategy_class, rotation_strategy{type,...}, retention_strategy_class, retention_strategy{type,...}, creation_date, field_type_refresh_interval, ...",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                indexSetId: { type: "string", description: "The Graylog index-set ID (e.g. from list_index_sets)" },
            },
            required: ["indexSetId"],
        },
    },
    {
        name: "await_system_job",
        description: "Poll GET /api/system/jobs/{jobId} with exponential backoff (500ms → 1s → 2s → 4s → 5s cap) until the job completes, errors, is cancelled, or timeoutMs elapses (default 60s, max 600s). Accepts EXACTLY ONE of: (a) `jobId: string` — the bare job ID; (b) `jobIdOrEnvelope` — bare string OR object with job_id/jobId/id from an upstream async envelope; (c) `info_substring: string` — discovery path: the wrapper GETs /api/system/jobs, matches the entry whose `info` field contains the substring, then polls that entry's id. Use info_substring when an upstream tool's async envelope deliberately omits job_id (e.g. delete_index_set per UPDATED D-15 — Graylog DELETE returns 204 with no body; the agent passes `info_substring: <indexSetId>` to discover the IndexSetCleanupJob). 0 matches → isError reason:'job_not_found'. 2+ matches → isError reason:'ambiguous_info_substring' with the list of candidate ids so the agent can re-call with a specific jobId. dryRun:true returns the polling plan WITHOUT issuing GETs. 404 from /system/jobs/{id} means the job has finished and been pruned from Graylog's running-jobs map — interpreted as completed:true with a synthetic finalStatus.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to actually poll." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                jobId: { type: "string", description: "The system-job ID to wait for (bare string form). Mutually exclusive with jobIdOrEnvelope and info_substring." },
                jobIdOrEnvelope: { description: "Alternative: the full async envelope returned by an earlier mutating tool (object with job_id / jobId / id). Mutually exclusive with jobId and info_substring." },
                info_substring: { type: "string", description: "Alternative discovery path (UPDATED D-15): substring to match against SystemJobSummary.info. The wrapper lists /system/jobs and resolves to the single matching job. Mutually exclusive with jobId and jobIdOrEnvelope. Use this when an upstream tool's async envelope deliberately omits job_id (e.g. delete_index_set with deleteIndices:true — pass info_substring:<indexSetId>)." },
                timeoutMs: { type: "number", description: "Wait ceiling in milliseconds (default 60000, max 600000)" },
                confirm: { type: "string", description: "Reserved — unused by await_system_job; kept for shape parity with confirmation-gated tools." },
            },
        },
    },
];
