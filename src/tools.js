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
];
