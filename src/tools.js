export const toolDefinitions = [
    {
        name: "list_connections",
        description: "List Graylog connections configured in ~/.graylog-mcp/config.json. Use this rather than set_active_connection when you want to discover available names before selecting one.",
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
        description: "List Graylog streams (narrow projection [id, title, description, mutable, disabled, index_set_id]). Use this rather than get_stream when scanning many streams; pass fields:[...] to customize.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string" },
                fields: { type: "array", items: { type: "string" } },
                limit: { type: "number" },
            },
        },
    },
    {
        name: "get_stream",
        description: "Get the full StreamResponse DTO for one Graylog stream (id, title, rules embedded, matching_type, index_set_id, is_editable, disabled, ...). Use list_streams first for narrow listing.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string" },
                streamId: { type: "string", description: "Stream ID (from list_streams)" },
            },
            required: ["streamId"],
        },
    },
    {
        name: "list_stream_rules",
        description: "List rules attached to one stream (narrow [id, type, field, value, inverted]; type is numeric 1..8). Use this rather than get_stream when you need rules only, not the parent DTO.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string" },
                streamId: { type: "string" },
                fields: { type: "array", items: { type: "string" } },
                limit: { type: "number" },
            },
            required: ["streamId"],
        },
    },
    // ----- Phase 3 Plan 02 streams CRUD (STREAM-03, STREAM-04) -----
    {
        name: "create_stream",
        description: "Create a stream. Dry-run default. Requires index_set_id (list_index_sets). Inline rules use 8 string types. Use this vs. create_stream_rule when bootstrapping a stream with rules in one call.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                title: { type: "string", description: "Human-readable stream title" },
                description: { type: "string", description: "Optional stream description" },
                rules: { type: "array", description: "Optional inline StreamRule objects: { type: one of exact|regex|greater|less|present|contains|always_match|match_input, field?, value?, inverted?, description? }. type is translated to numeric on the wire." },
                matching_type: { type: "string", enum: ["AND", "OR"], description: "How rules combine: AND (all rules must match) or OR (any rule). Default AND." },
                remove_matches_from_default_stream: { type: "boolean", description: "If true, messages routed to this stream are removed from the default stream. Default false." },
                index_set_id: { type: "string", description: "REQUIRED — the index set this stream writes to (D-10). Call list_index_sets first." },
            },
            required: ["title", "index_set_id"],
        },
    },
    {
        name: "update_stream",
        description: "Partial-update one stream's metadata (strict no-echo). Dry-run default; refuses immutable streams. Use this vs. update_stream_rule when editing the stream itself, not its rules.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                streamId: { type: "string", description: "Stream ID (from list_streams)" },
                changes: { type: "object", description: "Partial-update subset: { title?, description?, matching_type?, remove_matches_from_default_stream?, index_set_id? }" },
            },
            required: ["streamId", "changes"],
        },
    },
    // ----- Phase 3 Plan 02 stream lifecycle (STREAM-06) -----
    {
        name: "start_stream",
        description: "Resume a paused stream (desired state RUNNING). Dry-run default; refuses immutable streams. Use this vs. pause_stream when re-enabling a stopped stream.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                streamId: { type: "string", description: "Stream ID (from list_streams)" },
            },
            required: ["streamId"],
        },
    },
    {
        name: "pause_stream",
        description: "Pause a running stream (desired state STOPPED). Dry-run default; refuses immutable streams. Use this vs. start_stream when temporarily halting ingest without deletion.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                streamId: { type: "string", description: "Stream ID (from list_streams)" },
            },
            required: ["streamId"],
        },
    },
    // ----- Phase 3 Plan 03 stream deletion (STREAM-05; C2 mitigation centerpiece) -----
    {
        name: "delete_stream",
        description: "Destructive: delete a stream. Dry-run surfaces rules+pipelines+event_defs cascade + confirmationToken; apply requires `confirm` from dry-run. Use this vs. pause_stream when retiring permanently.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                streamId: { type: "string", description: "Stream ID to delete (from list_streams)" },
                confirm: { type: "string", description: "On apply (dryRun:false): the 64-hex confirmationToken from the immediately-prior dry-run. Required when dryRun:false; the wrapper refuses with reason `confirmation_mismatch` if absent or stale, and with `cascade_changed_since_preview` if the cascade drifted between dry-run and apply." },
            },
            required: ["streamId"],
        },
    },
    // ----- Phase 3 Plan 04 stream-rule CRUD (STREAM-08, STREAM-10) -----
    {
        name: "create_stream_rule",
        description: "Add one rule to an existing stream (8 variants: exact|regex|greater|less|present|contains|always_match|match_input). Dry-run default. Use this vs. create_stream when the stream already exists.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                streamId: { type: "string", description: "Parent stream ID (from list_streams)" },
                type: {
                    type: "string",
                    enum: ["exact", "regex", "greater", "less", "present", "contains", "always_match", "match_input"],
                    description: "Rule discriminator. Translates to numeric wire type (1=exact .. 8=match_input).",
                },
                field: { type: "string", description: "Message field to match. Required for exact|regex|greater|less|present|contains. Omitted for always_match|match_input." },
                value: { type: ["string", "number"], description: "Match value. Required for exact|regex|greater|less|contains|match_input. Omitted for present|always_match. For greater|less, numeric." },
                inverted: { type: "boolean", description: "Negate the match. Default false." },
                description: { type: ["string", "null"], description: "Optional human-readable rule description." },
            },
            required: ["streamId", "type"],
        },
    },
    {
        name: "delete_stream_rule",
        description: "Delete one rule from a stream (leaf delete — no cascade). Dry-run default; refuses immutable parent. Use this vs. delete_stream when narrowing a stream's matching scope.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                streamId: { type: "string", description: "Parent stream ID (from list_streams)" },
                ruleId: { type: "string", description: "Rule ID to delete (from list_stream_rules)" },
            },
            required: ["streamId", "ruleId"],
        },
    },
    {
        name: "update_stream_rule",
        description: "Partial-update one stream rule (`type` is immutable — delete+recreate to change). Dry-run default; refuses immutable parent. Use this vs. create_stream_rule when adjusting an existing rule.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                streamId: { type: "string", description: "Parent stream ID (from list_streams)" },
                ruleId: { type: "string", description: "Rule ID to update (from list_stream_rules)" },
                changes: { type: "object", description: "Partial-update subset: { field?, value?, inverted?, description? }. `type` is rejected — rule type is immutable." },
            },
            required: ["streamId", "ruleId", "changes"],
        },
    },
    {
        name: "test_stream_match",
        description: "Test whether a sample message matches a stream's rules (server-side). Requires an existing streamId. Use this vs. simulate_pipeline_rule when validating stream routing, not pipeline DSL.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                streamId: { type: "string", description: "Stream ID to test against (from list_streams)" },
                message: { type: "object", description: "Sample message as a field-map (e.g. { source: \"host1\", level: 6, message: \"text\" }). The wrapper wraps this in the literal outer key `message` on the wire." },
            },
            required: ["streamId", "message"],
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
        description: "List saved-search names. Use this rather than get_saved_search when you need to discover available names without executing one.",
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
        description: "Delete a saved search by name. Use this rather than create_saved_search when retiring an obsolete query; no Graylog server state is touched (local file only).",
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
    // Plan 05-01 S5 displacement: the v2.3 `list_event_definitions` and
    // `list_event_notifications` tool-definition entries were removed here.
    // Plan 05-02 Task 1 re-adds list_event_definitions with a narrow-projection
    // /paginated-backed shape and adds get_event_definition (count → 68);
    // Task 2 adds create_event_definition (→ 69); Task 3 adds
    // update_event_definition (→ 70). Plan 05-04 re-adds list_event_notifications
    // + 3 more (→ 77 phase-end). The v2.3 handlers stay exported in
    // src/handlers.js for HARD-03 audit reference (Phase 7) but are no longer
    // wired into dispatch — see src/tools/_register.js for the Phase 3 S5
    // precedent narrative.
    {
        name: "list_event_definitions",
        description: "List event/alert definitions (narrow [id,title,description,priority,state,alert]). Use this vs. get_event_definition when scanning many definitions for state or priority.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional connection name; defaults to active" },
                fields: { type: "string", description: "\"all\" for the full DTO, or an array of field names to project. Default narrow projection: id,title,description,priority,state,alert" },
                limit: { type: "number", description: "Max results per page (maps to upstream per_page). Default: 25; ceiling: 200" },
                query: { type: "string", description: "Filter expression (Graylog query syntax)" },
                sort: { type: "string", enum: ["title", "priority", "updated_at"], description: "Sort field. Default: title" },
                order: { type: "string", enum: ["asc", "desc"], description: "Sort direction. Default: asc" },
            },
        },
    },
    {
        name: "get_event_definition",
        description: "Get the full EventDefinitionDto including scheduler (read-only) and bound notifications[]. Use this vs. list_event_definitions when you need one definition's full config.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional connection name; defaults to active" },
                definitionId: { type: "string", description: "Event definition id from list_event_definitions" },
            },
            required: ["definitionId"],
        },
    },
    {
        name: "create_event_definition",
        description: "Create an event/alert definition. Dry-run; schedule forced false — call enable_event_definition to activate. v6 aggs auto-migrated. Use this vs. create_event_notification (defs detect).",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional connection name; defaults to active" },
                dryRun: { type: "boolean", description: "Preview without applying. Default: true" },
                idempotencyKey: { type: "string", description: "Optional retry-window dedupe key" },
                definition: {
                    type: "object",
                    description: "EventDefinitionDto: { title (required, non-empty), description, priority (1-3; default 2), alert (default true), config (EventProcessorConfig discriminated union — e.g. aggregation-v1; v6 aggregation shapes auto-migrated), field_spec, key_spec (must ⊆ field_spec keys), notification_settings, notifications, storage, state (default DISABLED), remediation_steps, event_procedure, event_summary_template }. id is @Nullable on input (stripped server-side). scheduler is READ_ONLY and excluded from the schema.",
                },
            },
            required: ["definition"],
        },
    },
    {
        name: "update_event_definition",
        description: "Partial-update one event definition (strict no-echo). Dry-run default; schedule forced false (never re-enables silently). Use this vs. enable_event_definition when editing config, not toggling state.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional connection name; defaults to active" },
                dryRun: { type: "boolean", description: "Preview without applying. Default: true" },
                idempotencyKey: { type: "string", description: "Optional retry-window dedupe key" },
                definitionId: { type: "string", description: "Event definition id from list_event_definitions" },
                changes: {
                    type: "object",
                    description: "Partial EventDefinitionDto fields to update. Omitted fields are server-side no-ops. Allowed keys: title, description, priority, alert, config, field_spec, key_spec, notification_settings, notifications, storage, remediation_steps, event_procedure, event_summary_template. Touching `config` triggers v6→v7 migration. `scheduler` is NOT accepted (READ_ONLY per Pitfall 5).",
                },
            },
            required: ["definitionId", "changes"],
        },
    },
    // Plan 05-03 Task 1 — EVENT-06 enable + disable (count 70 → 72).
    // D-07 / Pitfall 4 WILDCARD empty-body quirk. Both wire paths take an
    // empty body (chosen_default per 05-U1-SMOKE.md UNREACHABLE → body:undefined).
    // Both compose through defineMutatingHandler — dryRun:true default +
    // writable-gate + idempotency-key dedupe inherited (lifecycle-as-mutation
    // contract, mirror of Phase 1 INPUT-07 start_input / stop_input).
    {
        name: "enable_event_definition",
        description: "Activate an event definition (DISABLED → ENABLED). Dry-run default; eventually consistent. Use this vs. disable_event_definition when turning an alert back on.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional connection name; defaults to active" },
                dryRun: { type: "boolean", description: "Preview without applying. Default: true" },
                idempotencyKey: { type: "string", description: "Optional retry-window dedupe key" },
                definitionId: { type: "string", description: "Event definition id from list_event_definitions" },
            },
            required: ["definitionId"],
        },
    },
    {
        name: "disable_event_definition",
        description: "Deactivate an event definition (ENABLED → DISABLED). Dry-run default; eventually consistent. Use this vs. delete_event_definition when temporarily silencing an alert.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional connection name; defaults to active" },
                dryRun: { type: "boolean", description: "Preview without applying. Default: true" },
                idempotencyKey: { type: "string", description: "Optional retry-window dedupe key" },
                definitionId: { type: "string", description: "Event definition id from list_event_definitions" },
            },
            required: ["definitionId"],
        },
    },
    // Plan 05-03 Task 2 — EVENT-05 delete_event_definition (count 72 → 73).
    // D-08 INFORMATIONAL cascade: pre-flight GET surfaces the notifications
    // the def references in cascades.notifications, but no confirmationToken
    // is issued — notifications survive the delete (they are independent
    // resources). Contrast Plan 05-04 delete_event_notification which IS
    // load-bearing and issues a 64-hex cascade-hash via D-09.
    {
        name: "delete_event_definition",
        description: "Delete one event definition (leaf delete — informational notifications cascade, no confirm token). Dry-run default. Use this vs. disable_event_definition when permanently removing the alert.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional connection name; defaults to active" },
                dryRun: { type: "boolean", description: "Preview without applying. Default: true" },
                idempotencyKey: { type: "string", description: "Optional retry-window dedupe key" },
                definitionId: { type: "string", description: "Event definition id from list_event_definitions" },
            },
            required: ["definitionId"],
        },
    },
    // Plan 05-04 — event-notification CRUD (EVENT-07/08/09; count 73 → 77).
    // EVENT-07: list_event_notifications reclaims the v2.3 dispatch name
    //   (Pitfall S5 displacement) with a narrow-projection paginated reader.
    // EVENT-08: create_event_notification carries the D-05/D-06 6-variant
    //   discriminator (closed-set rejection at zod.parse) + CreateEntityRequest
    //   envelope (Pitfall 3) + http-notification-v2 C3 redaction on encrypted
    //   basic_auth / api_secret.
    {
        name: "list_event_notifications",
        description: "List event notifications (narrow [id,title,description,config]; config carries variant `type`). Use this vs. list_event_definitions when you need recipient channels, not detectors.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional connection name; defaults to active" },
                fields: { type: "string", description: "\"all\" for the full DTO, or an array of field names to project. Default narrow projection: id,title,description,config" },
                limit: { type: "number", description: "Max results per page (maps to upstream per_page). Default: 25; ceiling: 200" },
                query: { type: "string", description: "Filter expression (Graylog query syntax)" },
                sort: { type: "string", enum: ["title", "type"], description: "Sort field. Default: title" },
                order: { type: "string", enum: ["asc", "desc"], description: "Sort direction. Default: asc" },
            },
        },
    },
    {
        name: "create_event_notification",
        description: "Create an event notification (6 variants: email/http-v1/http-v2/slack/pagerduty-v2/teams-v2). Dry-run; encrypted fields <redacted>. Use this vs. create_event_definition (notifications deliver).",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional connection name; defaults to active" },
                dryRun: { type: "boolean", description: "Preview without applying. Default: true" },
                idempotencyKey: { type: "string", description: "Optional retry-window dedupe key" },
                title: { type: "string", description: "Notification title (required, non-empty)" },
                description: { type: "string", description: "Optional free-form description" },
                config: {
                    type: "object",
                    description: "Discriminated by `type`; one of the 6 STRICT variants. Per-variant field shapes documented per RESEARCH.md §Per-Type Config Shapes. http-notification-v2 carries encrypted basic_auth + api_secret (handled with C3-class redaction).",
                },
            },
            required: ["title", "config"],
        },
    },
    {
        name: "update_event_notification",
        description: "Partial-update one notification (strict no-echo). Dry-run default; encrypted fields preserved across updates — never on wire unless explicitly set. Use this vs. create_event_notification when editing.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional connection name; defaults to active" },
                dryRun: { type: "boolean", description: "Preview without applying. Default: true" },
                idempotencyKey: { type: "string", description: "Optional retry-window dedupe key" },
                notificationId: { type: "string", description: "Notification id from list_event_notifications" },
                changes: {
                    type: "object",
                    description: "Partial update fields: {title?, description?, config?}. Omitting a key is a server-side no-op. For http-notification-v2, encrypted fields (basic_auth, api_secret) are NEVER on the wire unless explicitly set in changes.config.",
                },
            },
            required: ["notificationId", "changes"],
        },
    },
    {
        name: "delete_event_notification",
        description: "Destructive: delete a notification (load-bearing — breaks alerts using it). Dry-run surfaces referencing event_defs + confirmationToken; apply requires `confirm`. Use this vs. delete_event_definition.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional connection name; defaults to active" },
                dryRun: { type: "boolean", description: "Preview without applying. Default: true" },
                idempotencyKey: { type: "string", description: "Optional retry-window dedupe key" },
                notificationId: { type: "string", description: "Notification id from list_event_notifications" },
                confirm: { type: "string", description: "On apply (dryRun:false): the 64-hex confirmationToken from the immediately-prior dry-run. Required when dryRun:false; refuses with reason `confirmation_mismatch` if absent or stale, `cascade_changed_since_preview` if drift detected." },
            },
            required: ["notificationId"],
        },
    },
    {
        name: "cluster_log_messages",
        description: "Cluster similar log messages into Drain3 templates. Use this rather than search_messages_graylog when summarizing structural patterns in noisy log volume; templates persist per connection.",
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
        description: "List learned log templates for the active connection. Use this rather than cluster_log_messages when you want the existing library without re-clustering.",
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
        description: "Delete one learned log template by ID. Use this instead of import_log_templates(mode:'replace') when removing a single bad template; the rest of the library is preserved.",
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
        description: "Set or update a human-readable label for a template. Use this instead of delete_log_template when you want to keep the template but rename it.",
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
        description: "Export all learned templates for the active connection as JSON. Use this rather than list_log_templates when you want a backup payload suitable for import_log_templates.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "import_log_templates",
        description: "Import templates into the active connection's library. Use this rather than cluster_log_messages when restoring from a prior export_log_templates dump.",
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
        description: "List dynamically-discovered input types (FQCN, display name, requested_configuration). Use this rather than create_input when you need to discover available type FQCNs first; cached per connection.",
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
        description: "List configured inputs (narrow [id,title,type,global]). Encrypted fields server-masked. Use this vs. list_input_types when you need running inputs, not the type catalogue.",
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
        description: "Fetch the full InputSummary DTO. Encrypted fields are server-masked (never the secret). Use this vs. list_inputs when you need one input's full configuration map.",
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
        description: "Create a Graylog input. Dry-run default; strict schemas for GELF/Beats2/Syslog/Raw, generic config for others. Encrypted fields <redacted>. Use this vs. start_input when registering a new input.",
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
        description: "Partial-update one input (strict no-echo). Dry-run; encrypted fields preserved across updates — TLS pw/AWS creds never on wire unless set. Use this vs. create_input when editing.",
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
        description: "Delete an input. Dry-run default surfaces cascades.extractors[] (Graylog cascades extractor removal). Use this vs. stop_input when permanently removing the input rather than pausing ingest.",
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
        description: "Start an input (desired state RUNNING). Dry-run default; pass dryRun:false to apply. Eventually consistent — poll get_input for actual state. Use this vs. stop_input when bringing an input online.",
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
        description: "Stop an input (desired state STOPPED; config stays). Dry-run default; eventually consistent. Use this vs. delete_input when pausing without removing config.",
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
        description: "List extractors on one input (narrow [id, title, description]). Pass fields:'all' for the full DTOs. Use this rather than get_input when you need extractor configs without the parent input DTO.",
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
        description: "Create an extractor (8 types: grok|regex|regex_replace|split_and_index|substring|copy_input|json|lookup_table). Dry-run. Use this vs. create_pipeline_rule when parsing at ingest.",
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
        description: "Partial-update one extractor (merge-from-current). Dry-run default; extractor_type is immutable (delete+recreate to switch). Use this vs. create_extractor when editing an existing extractor.",
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
        description: "Delete one extractor (no cascade). Dry-run default. Use this vs. delete_input when retiring one parsing rule, not the parent input.",
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
        description: "List index sets (narrow [id,title,description,default,writable,can_be_default,index_prefix]). Use this vs. get_index_set when scanning many sets; stats not included.",
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
        description: "Fetch the full IndexSetResponse DTO including rotation/retention strategies. Use this rather than list_index_sets when you need one set's full configuration including strategy blocks.",
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
        description: "Poll /system/jobs/{id} until an async Graylog job completes (default 60s, max 600s). Accepts jobId, envelope, or info_substring. Use this after any async-envelope apply (e.g. delete_index_set).",
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
    // ====================================================================
    // Phase 2 — Index sets create + update (Plan 02-02; INDEX-03, INDEX-04)
    // ====================================================================
    {
        name: "create_index_set",
        description: "Create an index set. Dry-run; rotation+retention REQUIRED (never defaulted). rotation: time-based|size-based|message-count; retention: delete|close. Use this vs. set_default_index_set.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                title: { type: "string", description: "Human-readable index-set title (also matched by M5 idempotency pre-flight)" },
                description: { type: "string", description: "Optional free-form description (default empty string)" },
                index_prefix: { type: "string", description: "Elasticsearch index prefix — lowercase alphanumerics + _ + - (e.g. 'app_errors')" },
                shards: { type: "number", description: "Elasticsearch shards per index (default 4)" },
                replicas: { type: "number", description: "Elasticsearch replicas per shard (default 0; single-node default)" },
                rotation_strategy: {
                    type: "string",
                    enum: ["time-based", "size-based", "message-count"],
                    description: "Required (D-10). Friendly alias (D-08); wrapper translates to Graylog FQCN at wire-build time.",
                },
                rotation_strategy_config: {
                    type: "object",
                    description: "Required (D-10). Per-alias shape: time-based requires rotation_period (ISO-8601); size-based requires max_size (bytes); message-count requires max_docs_per_index.",
                },
                retention_strategy: {
                    type: "string",
                    enum: ["delete", "close", "archive"],
                    description: "Required (D-10). 'archive' returns a structured error with reason archive_not_supported.",
                },
                retention_strategy_config: {
                    type: "object",
                    description: "Required (D-10). delete/close shape: { max_number_of_indices: <int> }.",
                },
                index_analyzer: { type: "string", description: "Elasticsearch analyzer (default 'standard')" },
                index_optimization_max_num_segments: { type: "number", description: "Force-merge target segment count (default 1)" },
                index_optimization_disabled: { type: "boolean", description: "Disable force-merge after rotation (default false)" },
                field_type_refresh_interval: { type: "number", description: "Field-type refresh interval in ms (default 5000)" },
                writable: { type: "boolean", description: "Whether the index set is writable (default true; setting false means new messages won't route here)" },
                use_legacy_rotation: { type: "boolean", description: "Use the legacy rotation engine (default true; Graylog 7+ data-tiering is out of scope for this milestone)" },
            },
            required: [
                "title",
                "index_prefix",
                "rotation_strategy",
                "rotation_strategy_config",
                "retention_strategy",
                "retention_strategy_config",
            ],
        },
    },
    {
        name: "update_index_set",
        description: "Partial-update one index set (merge-from-current). Dry-run default; rotation/retention pairs atomic. Refuses writable:false on default. Use this vs. create_index_set when editing an existing set.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                indexSetId: { type: "string", description: "The Graylog index-set ID to update" },
                changes: {
                    type: "object",
                    description: "Partial-update subset. Allowed fields: title, description, shards, replicas, writable, rotation_strategy + rotation_strategy_config (atomic pair per D-11), retention_strategy + retention_strategy_config (atomic pair), index_optimization_max_num_segments, index_optimization_disabled, field_type_refresh_interval, index_analyzer. Immutable fields (index_prefix, creation_date) are NOT in this list — they're sourced from current state.",
                },
            },
            required: ["indexSetId", "changes"],
        },
    },
    // ====================================================================
    // Phase 2 — cycle_deflector (Plan 02-04; INDEX-07)
    // ====================================================================
    {
        name: "cycle_deflector",
        description: "Cycle the deflector — close current active write index, open the next (synchronous). Dry-run default. Use this vs. delete_index_set when rotating storage, not retiring it.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                indexSetId: { type: "string", description: "The Graylog index-set ID whose deflector to cycle" },
            },
            required: ["indexSetId"],
        },
    },
    // ====================================================================
    // Phase 2 — set_default_index_set (Plan 02-04; INDEX-06)
    // ====================================================================
    {
        name: "set_default_index_set",
        description: "Designate one index set as the default for new streams. Dry-run default; refuses targets with can_be_default:false. Use this vs. update_index_set when redirecting new-stream storage.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                indexSetId: { type: "string", description: "The Graylog index-set ID to designate as the default" },
            },
            required: ["indexSetId"],
        },
    },
    // ====================================================================
    // Phase 2 — delete_index_set (Plan 02-03; INDEX-05 — C1 mitigation centerpiece)
    // ====================================================================
    {
        name: "delete_index_set",
        description: "Destructive: delete an index set. `deleteIndices` defaults false (metadata-only; inverted from Graylog). With true, requires `confirm` from dry-run. Use this vs. cycle_deflector when retiring storage.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                indexSetId: { type: "string", description: "The Graylog index-set ID to delete" },
                deleteIndices: {
                    type: "boolean",
                    description: "Default FALSE (D-04 inverted from Graylog's server default of true). When false, only the index-set metadata is removed; the Elasticsearch indices stay. When true, the wrapper computes a confirmation token and refuses apply unless the agent echoes it back via `confirm`.",
                },
                confirm: {
                    type: "string",
                    description: "Required when applying with deleteIndices: true — must equal the 64-hex `confirmationToken` from a prior dry-run preview. Mismatch returns isError reason 'confirmation_mismatch' and the DELETE never fires.",
                },
            },
            required: ["indexSetId"],
        },
    },
    // ====================================================================
    // Phase 4 Plan 02 — pipeline CRUD (PIPE-01..PIPE-05). All paths use the
    // literal `/api/system/pipelines/pipeline/{id}` segment (Pitfall 3 —
    // bare /api/system/pipelines/{id} returns 404).
    // ====================================================================
    {
        name: "list_pipelines",
        description: "List pipelines (narrow [id,title,description,stages_count,created_at,modified_at]). stages_count avoids the raw DSL byte cost. Use this vs. get_pipeline when scanning many pipelines.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string" },
                fields: { type: "array", items: { type: "string" } },
                limit: { type: "number" },
            },
        },
    },
    {
        name: "get_pipeline",
        description: "Get one pipeline's full PipelineSource DTO including source DSL and stages. Use this vs. list_pipelines when you need the full source for one pipeline rather than a scan.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string" },
                pipelineId: { type: "string", description: "Pipeline ID (from list_pipelines)" },
            },
            required: ["pipelineId"],
        },
    },
    {
        name: "create_pipeline",
        description: "Create a pipeline (raw DSL source only). Dry-run; parses source first and refuses apply on parse error. Use this vs. create_pipeline_rule when you need a stage container (rules live inside).",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                title: { type: "string", description: "Human-readable pipeline title (REQUIRED)" },
                description: { type: "string", description: "Optional pipeline description" },
                source: { type: "string", description: "REQUIRED — full pipeline DSL text. The wrapper POSTs it to /api/system/pipelines/pipeline/parse BEFORE the create POST; parse failures refuse apply with reason `pipeline_parse_failed`." },
            },
            required: ["title", "source"],
        },
    },
    {
        name: "update_pipeline",
        description: "Partial-update one pipeline (strict no-echo). Dry-run default; parses source when changes.source is set and refuses on parse error. Use this vs. create_pipeline when editing an existing pipeline.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                pipelineId: { type: "string", description: "Pipeline ID (from list_pipelines)" },
                changes: { type: "object", description: "Partial-update subset: { title?, description?, source? }. Pass `description: null` to explicitly clear; omit to leave unchanged." },
            },
            required: ["pipelineId", "changes"],
        },
    },
    {
        name: "delete_pipeline",
        description: "Delete a pipeline (leaf delete — no cascade, no confirm token). Dry-run. Stream connections orphan but are recoverable via connect_pipelines_to_stream. Use this vs. delete_pipeline_rule.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                pipelineId: { type: "string", description: "Pipeline ID to delete (from list_pipelines)" },
            },
            required: ["pipelineId"],
        },
    },
    // ====================================================================
    // Phase 4 Plan 03 — pipeline-rule CRUD (PIPE-06..PIPE-09). All paths use
    // the literal `/api/system/pipelines/rule/{id}` segment (Pitfall 3 rule
    // variant — bare /api/system/pipelines/{id} returns 404; the rule sub-
    // resource is namespaced under /rule/ exactly).
    // ====================================================================
    {
        name: "list_pipeline_rules",
        description: "List pipeline rules (narrow [id,title,description,created_at,modified_at]; source DSL excluded). Use this vs. get_pipeline_rule when scanning many rules without paying the DSL byte cost.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string" },
                fields: { type: "array", items: { type: "string" } },
                limit: { type: "number" },
            },
        },
    },
    {
        name: "get_pipeline_rule",
        description: "Get one pipeline rule's full RuleSource DTO including source DSL and rule_builder. Use this vs. list_pipeline_rules when you need the rule body, not just metadata.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string" },
                ruleId: { type: "string", description: "Pipeline-rule ID (from list_pipeline_rules)" },
            },
            required: ["ruleId"],
        },
    },
    {
        name: "create_pipeline_rule",
        description: "Create a pipeline rule from structured intent OR raw DSL. Dry-run; lint+parse refuse apply on errors. Use this vs. simulate_pipeline_rule when persisting (simulate only validates).",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                structured: { type: "object", description: "Typed structured intent: { name, when: Condition, then: Action[] }. RuleSpec compiles to DSL via emit.js. Provide EXACTLY ONE of `structured` or `ruleSource`." },
                ruleSource: { type: "string", description: "Raw rule DSL string (alternative to `structured`). Title is derived from the leading `rule \"...\"` clause." },
                description: { type: "string", description: "Optional rule description" },
                simulator_message: { type: ["string", "null"], description: "Optional Nullable String — sample message for the rule simulator (pass null to leave unset)." },
            },
        },
    },
    {
        name: "update_pipeline_rule",
        description: "Partial-update one pipeline rule (strict no-echo; structured XOR ruleSource). Dry-run; parses source when touched. Use this vs. create_pipeline_rule when editing an existing rule.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                ruleId: { type: "string", description: "Pipeline-rule ID (from list_pipeline_rules)" },
                changes: { type: "object", description: "Partial-update subset: { structured?, ruleSource?, description?, simulator_message? }. Pass simulator_message:null to explicitly clear; omit to leave unchanged. structured and ruleSource are mutually exclusive." },
            },
            required: ["ruleId", "changes"],
        },
    },
    // ====================================================================
    // Phase 4 Plan 05 — pipeline↔stream connection tools (PIPE-13/14).
    //
    // CRITICAL — Pitfall 2: Graylog's POST /api/system/pipelines/connections/to_stream
    // is REPLACE-the-full-set semantics. Both wrappers do GET-merge-POST
    // (connect, union) / GET-subtract-POST (disconnect, difference) client-
    // side to preserve previously-connected pipelines. Naive REPLACE would
    // silently disconnect the rest of the set — the wrapper's correctness
    // is the only line between agent intent ("attach pipeline X") and
    // accidental "replace-all".
    // ====================================================================
    {
        name: "connect_pipelines_to_stream",
        description: "Attach pipelines to a stream (wrapper preserves existing connections via GET-merge-POST). Dry-run default. Use this vs. disconnect_pipelines_from_stream when adding pipeline-to-stream wiring.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                streamId: { type: "string", description: "Stream ID to attach pipelines to (from list_streams)" },
                pipelineIds: { type: "array", items: { type: "string" }, description: "Pipeline IDs to attach (from list_pipelines). At least one ID required. Already-connected IDs are no-ops and surface in existingMatches." },
            },
            required: ["streamId", "pipelineIds"],
        },
    },
    {
        name: "disconnect_pipelines_from_stream",
        description: "Detach pipelines from a stream (wrapper preserves remaining connections via GET-subtract-POST). Dry-run default. Use this vs. connect_pipelines_to_stream when removing pipeline-to-stream wiring.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                streamId: { type: "string", description: "Stream ID to detach pipelines from (from list_streams)" },
                pipelineIds: { type: "array", items: { type: "string" }, description: "Pipeline IDs to detach. At least one ID required. Already-not-connected IDs are no-ops and surface in existingMatches." },
            },
            required: ["streamId", "pipelineIds"],
        },
    },
    // ====================================================================
    // Phase 4 Plan 04 — delete_pipeline_rule (PIPE-10; D-14 cascade-hash +
    // drift refusal centerpiece). Direct analog of Phase 3 delete_stream
    // (3-endpoint cascade → 1-endpoint cascade); same machinery, leaner code.
    // ====================================================================
    {
        name: "delete_pipeline_rule",
        description: "Destructive: delete a pipeline rule. Dry-run surfaces referencing pipelines + confirmationToken; apply requires `confirm`. Use this vs. delete_pipeline when removing one rule, not the parent.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                ruleId: { type: "string", description: "Pipeline-rule ID to delete (from list_pipeline_rules)" },
                confirm: { type: "string", description: "On apply (dryRun:false): the 64-hex confirmationToken from the immediately-prior dry-run. Required when dryRun:false; refuses with reason `confirmation_mismatch` if absent or stale, `cascade_changed_since_preview` if drift detected." },
            },
            required: ["ruleId"],
        },
    },
    // ====================================================================
    // Phase 4 Plan 04 — simulate_pipeline_rule (PIPE-12; M3 acceptance gate).
    //
    // POST /api/system/pipelines/rule/simulate. The returned Message DTO
    // shows the post-rule field map — agent can verify semantic bugs the
    // parser cannot (wrong function name passing parse but failing at
    // runtime; type-coercion errors; set_field overwriting reserved fields).
    //
    // CRITICAL — Pitfall 1: body.message is JSON-STRINGIFIED on the wire.
    // The wrapper accepts the friendly `{message: {field_map}}` form and
    // emits the wire form `{message: '{"...":"..."}', rule_source: {source}}`.
    //
    // Pitfall 4: functions depending on Graylog internal `gl2_*` metadata
    // (from_input, route_to_stream, remove_from_stream) cannot be
    // meaningfully simulated — the simulator's createMessage(json) does
    // NOT populate gl2_* fields.
    // ====================================================================
    {
        name: "simulate_pipeline_rule",
        description: "Simulate a rule against a sample message (returns post-rule DTO). No state mutation. Structured intent OR ruleSource. Use this vs. create_pipeline_rule when verifying semantics first.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to actually call /simulate (no Graylog state mutation either way)." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                structured: { type: "object", description: "Typed structured intent (RuleSpec: {name, when, then}). Compiles to DSL via emit.js BEFORE /simulate. Mutually exclusive with ruleSource." },
                ruleSource: { type: "string", description: "Raw rule DSL string. Mutually exclusive with structured." },
                message: { type: "object", description: "Sample message field-map (e.g. {source:'host', level:6, payload:'test'}). Wrapper JSON.stringifies this before sending — see Pitfall 1." },
            },
            required: ["message"],
        },
    },
    // ====================================================================
    // Phase 4 Plan 04 — list_pipeline_functions (PIPE-11; ROADMAP SC3).
    //
    // Surfaces the merged static + live catalogue via Plan 04-01's
    // getMergedCatalogue (1 GET per connection per process; live wins on
    // collision; Pitfall 5 live-only names accepted).
    // ====================================================================
    {
        name: "list_pipeline_functions",
        description: "List built-in pipeline functions (static catalogue + live overlay; live wins on collision). Cached per connection. Use this vs. create_pipeline_rule when discovering function signatures.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string" },
                fields: { type: ["array", "string"], description: "Projection: array of field names, or the literal string 'all' for the full entry." },
                limit: { type: "number" },
                category: { type: "string", description: "Optional filter by category (e.g. 'strings', 'dates', 'conversion')." },
                deprecated_only: { type: "boolean", description: "If true, return only entries with deprecated:true." },
            },
        },
    },
    // ====================================================================
    // Phase 6 Plan 02 — Dashboard CRUD (DASH-01..05 + DASH-07).
    //
    // create_dashboard ships the C7 mitigation centerpiece (internal
    // Search+View 2-step chain; agent never sees the intermediate Search
    // ID). update_dashboard applies STRICT_NO_ECHO partial-update with
    // searchId schema-rejected (D-02). delete_dashboard is a leaf delete
    // (informational widget-count cascade only). remove_widget orchestrates
    // the symmetric two-step PUT chain (PUT /api/views/search + PUT
    // /api/views). DASH-06 add_widget_from_template ships in Plan 06-03
    // alongside the widget-template library.
    // ====================================================================
    {
        name: "list_dashboards",
        description: "List dashboards (narrow [id,title,summary,description]; saved searches filtered out wrapper-side). Use this vs. get_dashboard when scanning many dashboards.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string" },
                fields: { type: ["array", "string"], description: "Projection: array of field names, or the literal string 'all' for the full ViewDTO." },
                limit: { type: "number", description: "Page size. Default 25." },
            },
        },
    },
    {
        name: "get_dashboard",
        description: "Get one dashboard's full ViewDTO including widgets, widget_positions, widget_mapping, and search_id. Use this vs. list_dashboards when you need the full DTO for one dashboard.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string" },
                dashboardId: { type: "string", description: "The dashboard's ViewDTO id." },
            },
            required: ["dashboardId"],
        },
    },
    {
        name: "create_dashboard",
        description: "Create a dashboard via internal Search+View 2-step chain. Dry-run; widget IDs are wrapper-generated UUIDs; searchId is schema-rejected. Use this vs. add_widget_from_template for a new dashboard.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string" },
                dryRun: { type: "boolean", description: "Default true. Set false to apply the 2-step Search+View chain." },
                idempotencyKey: { type: "string" },
                title: { type: "string", description: "Dashboard title (required, min 1 char)." },
                description: { type: "string" },
                summary: { type: "string" },
                timerange: { type: "object", description: "Dashboard-level timerange (Graylog wire shape; default {type:'relative', from:300})." },
                query: { type: "string", description: "Dashboard-level Lucene query (default empty)." },
                streamIds: { type: "array", items: { type: "string" } },
                widgets: { type: "array", description: "Widget triplets [{widget, position, searchType|null}]. Wrapper supplies widget.id + searchType.id as UUIDs when absent.", items: { type: "object" } },
            },
            required: ["title", "widgets"],
        },
    },
    {
        name: "update_dashboard",
        description: "Update one dashboard's metadata (title/description/summary only). Dry-run; searchId schema-rejected (immutable). Use this vs. add_widget_from_template when editing metadata not widgets.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string" },
                dryRun: { type: "boolean", description: "Default true." },
                idempotencyKey: { type: "string" },
                dashboardId: { type: "string", description: "The dashboard's ViewDTO id." },
                changes: {
                    type: "object",
                    description: "Partial update — title/description/summary only. searchId is REJECTED at zod parse (D-02).",
                    properties: {
                        title: { type: "string" },
                        description: { type: "string" },
                        summary: { type: "string" },
                    },
                },
            },
            required: ["dashboardId", "changes"],
        },
    },
    {
        name: "delete_dashboard",
        description: "Delete a dashboard (leaf delete — no cascade refusal, no confirm token). Dry-run surfaces informational widget count. Use this vs. remove_widget when retiring the whole dashboard.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string" },
                dryRun: { type: "boolean", description: "Default true." },
                idempotencyKey: { type: "string" },
                dashboardId: { type: "string" },
            },
            required: ["dashboardId"],
        },
    },
    {
        name: "remove_widget",
        description: "Remove one widget from a dashboard via symmetric two-step PUT chain. Dry-run; widget-position integrity validated pre-wire. Use this vs. delete_dashboard when removing one widget, not the view.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string" },
                dryRun: { type: "boolean", description: "Default true." },
                idempotencyKey: { type: "string" },
                dashboardId: { type: "string" },
                widgetId: { type: "string", description: "The widget's id (from get_dashboard's state.{queryId}.widgets[].id)." },
            },
            required: ["dashboardId", "widgetId"],
        },
    },
    {
        name: "add_widget_from_template",
        description: "Add a widget from the curated 8-template library. Atomic two-step PUT chain. Dry-run default; closed-set template names. Use this vs. create_dashboard when augmenting an existing dashboard.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string" },
                dryRun: { type: "boolean", description: "Default true." },
                idempotencyKey: { type: "string" },
                dashboardId: { type: "string", description: "The dashboard's ViewDTO id." },
                templateName: {
                    type: "string",
                    enum: [
                        "error_rate_over_time",
                        "top_sources_by_volume",
                        "level_distribution",
                        "top_error_clusters",
                        "request_rate_over_time",
                        "field_value_distribution",
                        "recent_events_table",
                        "stream_activity_overview",
                    ],
                    description: "Curated template (M7 closed set). top_error_clusters ships as a text-widget placeholder (no SearchType); field_value_distribution requires options.field.",
                },
                options: {
                    type: "object",
                    description: "Per-template options: streamIds[], queryString, timerangeOverride, position, widgetId, searchTypeId. field_value_distribution REQUIRES `field`; templates with limits accept `limit`; clusterCount for top_error_clusters; intervalUnit/intervalValue for stream_activity_overview.",
                    additionalProperties: true,
                },
            },
            required: ["dashboardId", "templateName"],
        },
    },
    // ====================================================================
    // Phase 6 Plan 04 — Blueprints A (BLUE-04/05/06).
    //
    // 3 of the 6 BLUE-XX blueprints (the simpler chains; Plan 05 ships
    // BLUE-01/02/03 with longer chains). All 3 compose from src/services/*
    // ONLY (D-09 architectural boundary, grep-pinned in test/blueprints.test.js).
    // Each routes through defineMutatingHandler so dryRun:true default,
    // idempotency key derivation, and the writable-flag connection gate are
    // inherited uniformly. Each apply path walks executeChain (Plan 06-01)
    // so __SERVER_ASSIGNED__step{N} placeholders are substituted into
    // downstream step bodies at apply-time.
    // ====================================================================
    {
        name: "setup_long_term_archival_index",
        description: "Blueprint: index set tuned for archival (size rotation 1GiB + N-day deletion). 1-step chain wrapping create_index_set. Dry-run. Use this vs. create_index_set when you want archival defaults.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                name: { type: "string", description: "Human-readable index-set title; slugified into the default indexPrefix when indexPrefix is not supplied." },
                retentionDays: { type: "number", description: "Retention window in days (1..36500). Maps to max_number_of_indices on DeletionRetentionStrategyConfig (1 index per day approximation)." },
                description: { type: "string", description: "Optional free-form description (default: 'Long-term archival index for <name>')" },
                indexPrefix: { type: "string", description: "Optional Elasticsearch index prefix. When omitted, slugified from `name` (lowercase + underscores)." },
                shards: { type: "number", description: "Elasticsearch shards per index (default 4)" },
                replicas: { type: "number", description: "Elasticsearch replicas per shard (default 1)" },
            },
            required: ["name", "retentionDays"],
        },
    },
    {
        name: "setup_debug_log_dropping",
        description: "Blueprint: drop messages with level > minLevel on one stream (syslog: 0=emerg, 7=debug). 3-step chain (rule → pipeline → connect). Dry-run. Use this vs. create_pipeline_rule for pre-wired connection.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                streamId: { type: "string", description: "Target stream ID (from list_streams) to attach the dropping pipeline to." },
                minLevel: { type: "number", description: "Syslog severity threshold (0..7). Messages with level > minLevel are dropped. Higher number = less severe (0=emerg, 7=debug)." },
                pipelineTitle: { type: "string", description: "Optional pipeline title (default: 'Drop sub-<minLevel> for stream <streamId>')." },
                ruleTitle: { type: "string", description: "Optional pipeline-rule title (default: 'drop_sub_<minLevel>'). The pipeline source references the rule by this title." },
            },
            required: ["streamId", "minLevel"],
        },
    },
    {
        name: "setup_pipeline_for_stream",
        description: "Blueprint: pipeline with N structured-intent rules + stream connection. N+2-step chain (1..20 transforms). Dry-run. Use this vs. create_pipeline when wiring rules+pipeline+connection in one call.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set to false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                streamId: { type: "string", description: "Target stream ID (from list_streams) to attach the new pipeline to." },
                pipelineTitle: { type: "string", description: "Title for the new pipeline (REQUIRED)." },
                pipelineDescription: { type: "string", description: "Optional pipeline description." },
                transforms: {
                    type: "array",
                    description: "Array of 1..20 RuleSpec structured-intent transforms. Each RuleSpec = {name, when: Condition, then: Action[]} — same shape as create_pipeline_rule's `structured` arg. Each transform becomes one pipeline rule + a stage entry in the new pipeline (in array order).",
                    items: { type: "object" },
                    minItems: 1,
                    maxItems: 20,
                },
            },
            required: ["streamId", "pipelineTitle", "transforms"],
        },
    },
    // ====================================================================
    // Phase 6 Plan 05 — Blueprints B (BLUE-01/02/03).
    //
    // BLUE-01 (setup_app_monitoring_stack) is the HEADLINE blueprint —
    // a 6-step multi-domain chain producing a complete monitoring
    // environment (stream + pipeline + dashboard + error alert) from a
    // single agent intent. BLUE-02 (setup_error_alerting) is a 1-step
    // event-definition wiring. BLUE-03 (create_app_health_dashboard) is
    // a 1-conceptual-step (2 HTTP via Search+View internal) 4-widget
    // dashboard pre-wired to a stream. All 3 compose from src/services/*
    // (D-09 architectural boundary, grep-pinned in test/blueprints.test.js).
    // ====================================================================
    {
        name: "setup_app_monitoring_stack",
        description: "Headline blueprint: stream + drop-debug pipeline + 4-widget dashboard + error-rate alert. 6-step chain. Dry-run. Use this vs. individual create_* tools when bootstrapping full monitoring.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set false to apply the 6-step chain." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                app_name: { type: "string", description: "Service name (alphanumeric + underscore/hyphen only). Used as the prefix for the stream/pipeline/dashboard titles." },
                source_pattern: { type: "string", description: "Regex matched against the `source` field to scope the stream (e.g. 'payment-*')." },
                indexSetId: { type: "string", description: "Existing index_set id (obtain from list_index_sets). The new stream binds to this index set." },
                errorRateThreshold: { type: "number", description: "Error events per 5-minute window before the alert fires. Default 50." },
                defaultDashboardWidgets: {
                    type: "array",
                    description: "Optional override of the 4 default widget templates. Closed-set enum from the curated 8-template library.",
                    items: {
                        type: "string",
                        enum: [
                            "error_rate_over_time",
                            "top_sources_by_volume",
                            "level_distribution",
                            "top_error_clusters",
                            "request_rate_over_time",
                            "field_value_distribution",
                            "recent_events_table",
                            "stream_activity_overview",
                        ],
                    },
                },
            },
            required: ["app_name", "source_pattern", "indexSetId"],
        },
    },
    {
        name: "setup_error_alerting",
        description: "Blueprint: error-rate event def (level:>=4) on a stream wired to an existing notification. Schedule false — flip via enable_event_definition. Use this vs. create_event_definition for pre-wired alerts.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set false to apply." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                streamId: { type: "string", description: "Target stream id (from list_streams)." },
                notificationId: { type: "string", description: "Existing notification id (from list_event_notifications)." },
                title: { type: "string", description: "Optional event-definition title (default: 'Error alert for stream {streamId}')." },
                errorRateThreshold: { type: "number", description: "Threshold count of error events per window. Default 50." },
                searchWithinMinutes: { type: "number", description: "Aggregation window in minutes (search_within_ms = N*60_000; execute_every_ms identical). Default 5." },
            },
            required: ["streamId", "notificationId"],
        },
    },
    {
        name: "create_app_health_dashboard",
        description: "Blueprint: 4-widget health dashboard pre-wired to a stream. 1 conceptual step (internal Search+View). Dry-run. Use this vs. create_dashboard when you want curated health-widget defaults.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string", description: "Optional per-call connection override" },
                dryRun: { type: "boolean", description: "Default true. Set false to apply the 2-step chain." },
                idempotencyKey: { type: "string", description: "Optional agent-supplied idempotency key" },
                streamId: { type: "string", description: "Stream id to bind all widgets to." },
                title: { type: "string", description: "Optional dashboard title (default: 'Health dashboard (stream {streamId})')." },
                defaultWidgets: {
                    type: "array",
                    description: "Optional override of the 4 default widget templates. Closed-set enum from the curated 8-template library.",
                    items: {
                        type: "string",
                        enum: [
                            "error_rate_over_time",
                            "top_sources_by_volume",
                            "level_distribution",
                            "top_error_clusters",
                            "request_rate_over_time",
                            "field_value_distribution",
                            "recent_events_table",
                            "stream_activity_overview",
                        ],
                    },
                },
            },
            required: ["streamId"],
        },
    },
    {
        name: "get_entity_shares",
        description: "Read an entity's grants (active_shares) plus shareable grantees/capabilities. Non-mutating. Accepts entityGrn OR (entityType,entityId). Note: active_shares excludes your own grant; empty is normal.",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string" },
                entityGrn: { type: "string", description: "Full GRN, e.g. grn::::stream:<id>. Either this OR entityType+entityId." },
                entityType: { type: "string", enum: ["stream", "dashboard", "search"], description: "Entity type. Use with entityId." },
                entityId: { type: "string", description: "Entity id (from list_streams / list_dashboards). Use with entityType." },
            },
        },
    },
    {
        name: "list_grantees",
        description: "List the users/teams an entity can be shared with (resolves a username to the user-GRN that share_entity needs). Non-mutating. Accepts entityGrn OR (entityType,entityId).",
        inputSchema: {
            type: "object",
            properties: {
                connectionName: { type: "string" },
                entityGrn: { type: "string", description: "Full GRN, e.g. grn::::stream:<id>. Either this OR entityType+entityId." },
                entityType: { type: "string", enum: ["stream", "dashboard", "search"], description: "Entity type. Use with entityId." },
                entityId: { type: "string", description: "Entity id (from list_streams / list_dashboards). Use with entityType." },
            },
        },
    },
    {
        name: "list_admin_tools",
        description: "List every MCP tool grouped by domain (inputs/streams/pipelines/etc.) with a one-line summary. Use this vs. dumping the full /tools list when you need to orient at session start.",
        inputSchema: {
            type: "object",
            properties: {
                domain: {
                    type: "string",
                    description: "Optional domain filter (inputs, index_sets, streams, pipelines, events, dashboards, blueprints, meta, search). Omit for the full inventory grouped by domain.",
                },
            },
        },
    },
];
