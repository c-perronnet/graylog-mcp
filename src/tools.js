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
        description: "List Graylog streams in the active connection. Returns narrow projection [id, title, description, mutable, disabled, index_set_id]; pass `fields:[...]` to customize. Filter `mutable:true` for editable candidates.",
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
        description: "List the rules attached to one Graylog stream. Narrow projection [id, type, field, value, inverted]; type is the numeric StreamRuleType (1=EXACT, 2=REGEX, 3=GREATER, 4=SMALLER, 5=PRESENCE, 6=CONTAINS, 7=ALWAYS_MATCH, 8=MATCH_INPUT).",
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
        description: "Create a Graylog stream. Dry-run shows existingMatches when a similar title exists across 3 buckets (exact > case_insensitive > prefix; strictest bucket reported). REQUIRED: index_set_id — call list_index_sets first to discover available index sets (D-10, no defaulting). Inline rules: pass an array of StreamRule objects with one of 8 string discriminators (exact, regex, greater, less, present, contains, always_match, match_input); the wrapper translates each to Graylog's numeric wire format (1..8). postApplyEstimate.id is __SERVER_ASSIGNED__ — DO NOT reuse it; use the real stream_id from the apply response. Use create_stream_rule (Plan 04) to add rules after creation if you prefer.",
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
        description: "Partial-update a Graylog stream's mutable fields. STRICT_NO_ECHO wire-build: only the fields you pass in `changes` are sent on the wire — unchanged fields stay server-side (per 03-U1-SMOKE.md). Pre-flights GET /api/streams/{streamId} for the D-09 mutable check; refuses with reason `stream_immutable` if current.is_editable === false BEFORE the PUT fires. Schema: { streamId, changes: { title?, description?, matching_type?, remove_matches_from_default_stream?, index_set_id? } }. To edit rules attached to the stream, use update_stream_rule (Plan 04) instead.",
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
        description: "Resume a paused Graylog stream (set desired state to RUNNING). Maps to POST /api/streams/{streamId}/resume — no request body required. Pre-flights GET /api/streams/{streamId}; refuses with reason `stream_immutable` if current.is_editable === false BEFORE the POST fires. NOTE: This sets the DESIRED state; actual `disabled` flag may briefly remain true until Graylog's stream registry converges. Use list_streams to verify state.",
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
        description: "Pause a running Graylog stream (set desired state to STOPPED). Maps to POST /api/streams/{streamId}/pause — no request body required. Pre-flights GET /api/streams/{streamId}; refuses with reason `stream_immutable` if current.is_editable === false BEFORE the POST fires. NOTE: This sets the DESIRED state; actual `disabled` flag may briefly remain false until Graylog's stream registry converges. Use list_streams to verify state.",
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
        description: "Delete a Graylog stream with a frozen-cascade safety contract. Dry-run pre-flights 3 cascade endpoints — GET /api/streams/{streamId}/rules (attached stream rules), GET /api/streams/{streamId}/pipelines (pipeline-to-stream connections), and a paginated walk of /api/events/definitions/paginated client-side-filtered by def.config.streams (event definitions referencing this stream) — and emits cascades.{stream_rules, pipeline_connections, event_definitions} + a confirmationToken (keyed-buckets sha-256). Apply requires `confirm:<token>` echoed back; the wrapper re-fetches all 3 cascade endpoints, re-computes the hash, and refuses with reason `cascade_changed_since_preview` on ANY drift (additions OR removals). Refuses with reason `stream_immutable` if current.is_editable === false (built-in/system streams) BEFORE any cascade GET fires (saves 3 round-trips). Refuses with reason `cascade_preflight_failed` if any cascade endpoint errors (no token issued — hard-block). Apply envelope is SYNC `{deleted:true, streamId}` (no async/job_id).",
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
        description: "Create one rule on a Graylog stream. 8 variants: exact, regex, greater, less, present, contains, always_match, match_input — the wrapper translates each to Graylog's numeric wire format (1..8) via STREAM_RULE_TYPE_TO_NUMERIC. Variant rules: `present` requires `field` only; `always_match` takes no field/value; `match_input` takes a `value` (input id) and no `field`; the other 5 variants require both `field` and `value`. Pre-flights GET /api/streams/{streamId}; refuses with reason `stream_immutable` if the parent stream's current.is_editable === false BEFORE the POST fires. postApplyEstimate.id is __SERVER_ASSIGNED__ — DO NOT reuse it; the real rule id ships in the apply response.",
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
        description: "Delete one rule from a Graylog stream. LEAF DELETE (Discretion-04) — stream rules have no further dependents, so there is NO cascade enumeration, NO confirmation hash, and NO requireConfirm gate. Pre-flights GET /api/streams/{streamId}; refuses with reason `stream_immutable` if the parent stream's current.is_editable === false BEFORE the DELETE fires. Apply envelope is sync (no system-job).",
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
        description: "Update one rule on a Graylog stream. Partial-update via `changes` envelope (field, value, inverted, description). `type` is IMMUTABLE — to change a rule's type, delete + recreate (Pitfall S8: Graylog's CreateStreamRuleRequest.type is a non-nullable Java int that must be present on every PUT; the wrapper echoes it from the pre-flight GET unconditionally). STRICT_NO_ECHO wire-build (per 03-U1-SMOKE.md): only the fields you set in `changes` are sent on the wire, plus the immutable type echoed from current. Pre-flights GET /api/streams/{streamId} for the D-09 parent-mutable check; refuses with reason `stream_immutable` if current.is_editable === false BEFORE the rule GET fires.",
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
        description: "Test whether a sample message matches the rules on a Graylog stream. SERVER-SIDE evaluation (D-07) — Graylog's authoritative rule-evaluation pipeline is invoked; no JS re-implementation. The response forwards Graylog's per-rule outcome verbatim: { matches: boolean, rules: { <ruleId>: boolean } }. REQUIRES an existing streamId (D-08) — pre-create config testing is out of scope; for new configs use create_stream(dryRun:true) → create for real → test_stream_match against the real id. The wire body wraps the agent's sample message in `{ \"message\": { ... } }` — the literal outer key `message` is required by Graylog's resource method signature (StreamResource.java:561-564).",
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
        description: "List event definitions on the active Graylog connection. Returns a narrow projection [id, title, description, priority, state, alert] by default; pass fields:\"all\" for the full DTO including scheduler context. Filter via the query param (Graylog filter syntax). Backed by /api/events/definitions/paginated (unwraps PageListResponse.elements per Plan 05-01).",
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
        description: "Get the full EventDefinitionDto for one event definition by id. Includes scheduler context (READ-ONLY per Pitfall 5 — never echoed back on update) and notifications[] (consumed by delete_event_definition's D-08 cascade preview). The full DTO is the agent's canonical view; for an operational-state summary across many definitions, call list_event_definitions instead.",
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
        description: "Create an event definition on the active Graylog connection. M1 + C5 mitigation centerpiece: wire path is /api/events/definitions?schedule=false UNCONDITIONALLY (D-01 structural enforcement — the schema does NOT accept a `schedule` argument; agents must call enable_event_definition separately to activate). v6 aggregation shapes {type:\"function\", function:\"count\", parameter:\"source\"} are auto-migrated to v7 {type:\"number-ref\", ref:\"count_source\"} and the migration is VISIBLE in dry-run output via migration:{migrated, warnings:[{original, emitted}]} (C5 acceptance gate). Body wraps in CreateEntityRequest envelope {entity, share_request:null} (Pitfall 3). definition.id is stripped before POST (Pitfall 8 — server assigns). dryRun:true by default; existingMatches probes /api/events/definitions/paginated for exact-title duplicates.",
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
        description: "Update an event definition on the active Graylog connection. STRICT_NO_ECHO partial-update: wire body emits ONLY fields present in args.changes (no round-trip from a GET — scheduler READ_ONLY contamination is structurally impossible per Pitfall 5). body.id is always set to args.definitionId so the PUT body agrees with the URL segment (Pitfall 8). Defaults schedule:false (D-02 mirror of D-01 create — wire path UNCONDITIONALLY /api/events/definitions/{id}?schedule=false; partial updates NEVER silently re-enable scheduling). v6→v7 aggregation migration runs over args.changes.config when present and surfaces in dry-run via migration:{migrated, warnings} (C5; omitted otherwise). dryRun:true by default.",
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
        description: "Enable scheduling for an event definition (transitions state DISABLED→ENABLED). Sends an empty body to PUT /api/events/definitions/{id}/schedule per Graylog's @Consumes(WILDCARD) quirk — the agent does NOT construct a fake body (Pitfall 4 / D-07). Eventually consistent: poll get_event_definition for the post-apply scheduler.is_scheduled === true. Composes through defineMutatingHandler so dryRun:true default + writable-flag gate + idempotency-key dedupe inherit uniformly (lifecycle-as-mutation contract, mirror of start_input).",
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
        description: "Disable scheduling for an event definition (transitions state ENABLED→DISABLED). Sends an empty body to PUT /api/events/definitions/{id}/unschedule per Graylog's @Consumes(WILDCARD) quirk (Pitfall 4 / D-07). Eventually consistent: poll get_event_definition for scheduler.is_scheduled === false. Same defineMutatingHandler composition as enable_event_definition; symmetric except for the trailing path segment and postApplyEstimate.state.",
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
        description: "Delete an event definition on the active Graylog connection. Dry-run preview enumerates the notifications this def references via cascades.notifications (informational — the notifications themselves survive the delete; only the def→notification wiring vanishes). No confirmation token issued (D-08 leaf-delete pattern; cf. delete_event_notification which IS a load-bearing delete with cascade-hash gate). Pre-flight GET is best-effort: 404/403 fall through to an empty cascade array; the DELETE itself surfaces the real error on apply via wrapGraylogError. dryRun:true by default.",
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
        description: "List event notifications on the active Graylog connection. Returns a narrow projection [id, title, description, config] by default (each item's config carries the discriminator `type` plus per-variant fields); pass fields:\"all\" for the full DTO including notification_settings + plugin-specific extras. Filter via the query param (Graylog filter syntax). Backed by /api/events/notifications/paginated (unwraps PageListResponse.elements per Plan 05-01).",
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
        description: "Create an event notification on the active Graylog connection. config.type is one of 6 STRICT variants (D-05/D-06 corrected closed set): email-notification-v1, http-notification-v1, http-notification-v2, slack-notification-v1, pagerduty-notification-v2, teams-notification-v2. Invalid types (e.g. script-notification-v1, pagerduty-notification-v1, teams-notification-v1) reject at zod.parse BEFORE any HTTP call. Body wraps in CreateEntityRequest envelope {entity:{title, description, config}, share_request:null} (Pitfall 3). http-notification-v2's encrypted basic_auth and api_secret are wrapped as {set_value:<plaintext>} on the wire and shown as <redacted> in the dry-run preview (C3-class — T-05-04-03). existingMatches probes /api/events/notifications/paginated for exact-title duplicates. dryRun:true by default; postApplyEstimate.id is __SERVER_ASSIGNED__ — DO NOT reuse it.",
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
        description: "Update an event notification on the active Graylog connection. STRICT_NO_ECHO partial-update (D-10): wire body emits ONLY fields the agent passed in args.changes — unchanged fields are NEVER on the wire (Graylog preserves them server-side). For http-notification-v2's encrypted basic_auth and api_secret, omitting them from args.changes.config means they are NEVER round-tripped on the wire — C3-class encrypted-field protection (mirror Phase 1 update_input D-12; T-05-04-02). Encrypted fields the agent DOES pass wrap as {set_value:<new>} on the wire and surface as <redacted> in the dry-run preview. Variant change (changes.config.type ≠ current.config.type) replaces the variant entirely; the new variant's encrypted-field inventory drives the redaction. body.id always matches the URL segment (Pitfall 8). Pre-flight GET fetches current.config.type for the encrypted-field lookup. dryRun:true by default.",
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
        description: "Delete an event notification on the active Graylog connection. LOAD-BEARING delete (contrast delete_event_definition which is D-08 informational): notifications are referenced by event_defs via notification_id; deleting a notification breaks any alert that fires that def. D-09 cascade-hash + apply-time drift refusal (Phase 3 delete_stream analog): dry-run pre-flights /api/events/definitions/paginated to enumerate referencing event_defs (client-side filter on def.notifications[].notification_id; no server-side filter exists on 7.2 — mirror Pitfall S6); freezes them into a 64-hex sha-256 confirmationToken via computeNotificationCascadeHash. Apply requires args.confirm:<token>; the wrapper re-fetches + recomputes + refuses with isError reason:cascade_changed_since_preview on ANY drift. Refuses with reason:cascade_preflight_failed if the paginated GET errors (DELETE NEVER fires). Apply envelope is SYNC {deleted:true, notificationId}. Safety cap 1000 pages × 50/page (T-05-04-07). dryRun:true by default.",
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
    // ====================================================================
    // Phase 2 — Index sets create + update (Plan 02-02; INDEX-03, INDEX-04)
    // ====================================================================
    {
        name: "create_index_set",
        description: "Create a Graylog index set (storage configuration for messages). Rotation + retention strategies are REQUIRED (D-10 — destruction policies must never be defaulted). Friendly aliases (D-08): rotation_strategy ∈ ['time-based', 'size-based', 'message-count']; retention_strategy ∈ ['delete', 'close']. NOTE: 'archive' retention is reserved for a future milestone (requires Graylog Enterprise plugin) — passing it returns a structured error with reason 'archive_not_supported'. Per-alias config shapes (D-09): time-based → { rotation_period: 'P1D' (ISO-8601), max_rotation_period?, rotate_empty_index_set? }; size-based → { max_size: <bytes> }; message-count → { max_docs_per_index: <int> }; delete/close → { max_number_of_indices: <int> }. postApplyEstimate.id is __SERVER_ASSIGNED__ — DO NOT reuse it; use the real id from the apply response. Pre-flights a list call to surface existingMatches[] when an index set with the same title exists (M5 idempotency).",
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
        description: "Partial-update one Graylog index set. The wrapper pre-flights GET /api/system/indices/index_sets/{id} to source the immutable fields (index_prefix, creation_date) and the strategy blocks the agent didn't touch, then merges your `changes` over the current state and emits the FULL merged DTO on the wire (U1 MERGE_FROM_CURRENT per 02-U1-SMOKE.md — Graylog 7.0.6's PUT deserializer requires the full IndexSetSummary shape; merge-from-current is safe because index-set configs carry no encrypted fields). D-11 atomic strategy-replace: if `changes` includes `rotation_strategy`, it MUST include `rotation_strategy_config` (and vice versa) — strategy class + config are atomic. Same rule for retention. ND2 pre-flight: the wrapper refuses `writable: false` on the default index set BEFORE the PUT fires (Graylog returns 409; the wrapper surfaces a structured `default_index_set_must_be_writable` reason in dry-run). Immutable `index_prefix` and `creation_date` are NEVER on the wire as agent-supplied — the wrapper re-asserts the current values as defense-in-depth.",
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
        description: "Cycle the deflector — close the current active write index and open the next one. The cycle is SYNCHRONOUS in Graylog 7.0.6 — when the apply response returns, the rotation is complete. In-flight writes may briefly buffer until the new index is ready (m3). The closed index's message ranges are rebuilt asynchronously as a separate system job observable at /system/jobs; call await_system_job on that job ID if you need to wait for the rebuild before searching the just-closed index by time range. Refuses non-writable index sets (ND3) AND refuses writable: false connections (D-07/D-16). The apply envelope is { rotated: true, message: '...<indexSetId>...', side_effects: { observable_at: '/system/jobs', describes: '...range rebuild...' } } — NOT the D-15 async envelope (cycle itself is synchronous; only the side-effect range rebuild is async).",
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
        description: "Designate an index set as the default. The wrapper pre-flights the server's `can_be_default` eligibility flag on the target; if false (events-style or system index set, OR any future eligibility rule Graylog adds), the dry-run returns a structured error (reason: default_eligibility_failed) BEFORE any PUT is attempted — the would-be 409 surfaces in dry-run, not apply (UPDATED D-13 / pitfall m2). The wrapper reads `can_be_default` rather than the underlying `regular` boolean because `can_be_default` is the server's derived eligibility answer and naturally absorbs any future rules without a wrapper-side update. On apply, issues PUT /api/system/indices/index_sets/{id}/default with an empty body and returns the full IndexSetResponse DTO with `default: true`.",
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
        description: "Delete a Graylog index set. Graylog's server defaults `delete_indices` to TRUE — this wrapper INVERTS it to FALSE (D-04 safety inversion). With `deleteIndices: false` (the default) only the index-set metadata is removed; the Elasticsearch indices and their messages stay. To actually destroy the indices, pass `deleteIndices: true` AND echo back the `confirmationToken` from the dry-run output as `confirm` — the wrapper computes a deterministic sha-256 hash over {indexSetId, deleteIndices:true, sorted indexNames, messageCount} and refuses apply unless the agent echoes it. If anything changed server-side between dry-run and apply (new index opened, messages ingested), the hash mismatches and apply refuses with reason 'confirmation_mismatch'. PRE-FLIGHT REFUSALS: (a) The default index set CANNOT be deleted (Graylog refuses with BadRequestException) — surfaced with reason 'default_index_set_undeletable' BEFORE the DELETE fires, regardless of `deleteIndices` value. (b) When `deleteIndices: true`, stats-endpoint failure HARD-BLOCKS the dry-run with reason 'stats_unreachable' — the wrapper refuses to issue a confirmation token without knowing the destruction blast radius. AFTER APPLY with `deleteIndices: true`, the response is { async: true, job_id_observable_at: '/system/jobs', message: '...<indexSetId>...' } WITH NO job_id field — Graylog DELETE returns 204 with no body, so there is no server-supplied id to forward. To wait for the cleanup job to finish, call `await_system_job` with `info_substring: '<indexSetId>'` — the wrapper will GET /system/jobs, locate the IndexSetCleanupJob whose info field contains the indexSetId, then poll its id to completion.",
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
        description: "List Graylog pipelines (narrow projection [id, title, description, stages_count, created_at, modified_at]). `stages_count` is a synthetic projection (length of the wire `stages` array) — agents see card-stages-N without the byte cost of the raw `source` DSL. Use get_pipeline for the full DTO including source text and embedded stages.",
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
        description: "Get the full PipelineSource DTO for one Graylog pipeline (id, title, description, source DSL, stages, created_at, modified_at). Use list_pipelines first for narrow listing. Path uses the literal `pipeline` segment (Pitfall 3).",
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
        description: "Create a Graylog pipeline. Dry-run pre-flights POST /api/system/pipelines/pipeline/parse with the agent's `source` (D-06 server-authoritative parse gate); on parse error returns isError with reason `pipeline_parse_failed` and `parseResult.error` carrying `[{line, position_in_line, type, message}]` (Pitfall 6: wire `positionInLine` camelCase translates to `position_in_line` snake_case). Apply NEVER fires when parse fails (C4 mitigation). Dry-run also surfaces existingMatches when a pipeline with the same title already exists (informational). postApplyEstimate.id is __SERVER_ASSIGNED__ — DO NOT reuse it; use the real id from the apply response. Pipelines accept raw DSL source only; use the rule-level tools (Plan 04-03) for structured-intent emission.",
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
        description: "Partial-update a Graylog pipeline's mutable fields. STRICT_NO_ECHO wire-build (per 04-U1-SMOKE.md): only the fields you pass in `changes` are sent on the wire — unchanged fields stay server-side. Parse pre-flight (POST /api/system/pipelines/pipeline/parse) fires ONLY when changes.source is set; refuses apply with reason `pipeline_parse_failed` on parse error (Pitfall 6 camelCase→snake_case). Pre-flights GET on the current pipeline; 404 surfaces a clean MCP error envelope. NO mutable defense (D-15 — pipelines have no is_editable field on the wire). Schema: { pipelineId, changes: { title?, description?, source? } }.",
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
        description: "Delete a Graylog pipeline. LEAF DELETE (D-15) — pipelines have no mutable flag and no cascade pre-flight. NO confirmation token, NO requireConfirm gate. Stream connections referencing this pipeline become ORPHANED but RECOVERABLE — the orphan rows survive in the connection table, and the agent can re-connect any pipeline after recreating it via connect_pipelines_to_stream (Plan 04-05). Apply envelope is sync `{deleted: true, pipelineId}` (no async/job_id). Path uses the literal `pipeline` segment (Pitfall 3).",
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
        description: "List Graylog pipeline rules (narrow projection [id, title, description, created_at, modified_at]). The `source` DSL text is excluded from the default fields — use get_pipeline_rule for the full rule body. Path uses the literal `rule` segment (Pitfall 3 rule variant); bare /api/system/pipelines/{id} returns 404.",
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
        description: "Get the full RuleSource DTO for one Graylog pipeline rule (id, title, description, source DSL, rule_builder, simulator_message, created_at, modified_at). Use list_pipeline_rules first for narrow listing. Path uses the literal `rule` segment (Pitfall 3 rule variant).",
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
        description: "Create a Graylog pipeline rule from typed structured intent OR raw DSL source (mutually exclusive per D-10). Structured intent compiles via emit.js (every literal escape-routed); raw DSL forwards verbatim. Both modes run client-side lint (validate.js over the merged catalogue — Pitfall 5 — live-only function names accepted) THEN the server-authoritative parse pre-flight (POST /api/system/pipelines/rule/parse — C4 acceptance gate). On parse failure refuses apply with reason `rule_parse_failed` and parseResult.error carrying [{line, position_in_line, type, message}] (Pitfall 6 camelCase→snake_case). postApplyEstimate.id is __SERVER_ASSIGNED__. Use simulate_pipeline_rule (Plan 04-04) to verify semantics — this tool's parse pre-flight only validates grammar; side-effect functions (from_input, route_to_stream) cannot be meaningfully simulated.",
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
        description: "Partial-update a Graylog pipeline rule's mutable fields. STRICT_NO_ECHO wire-build (per 04-U1-SMOKE.md): only the fields you pass in `changes` are sent on the wire — unchanged fields stay server-side. Parse pre-flight (POST /api/system/pipelines/rule/parse) fires ONLY when changes.structured OR changes.ruleSource is set; refuses apply with reason `rule_parse_failed` on parse error (Pitfall 6 camelCase→snake_case). Pre-flights GET on the current rule; 404 surfaces a clean MCP error envelope. NO mutable check (rules have no is_editable). simulator_message preserves omit-vs-explicit-null clear-intent (Nullable String). Schema: { ruleId, changes: { structured?, ruleSource?, description?, simulator_message? } } — structured XOR ruleSource within changes.",
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
        description: "Attach pipelines to a stream. The wrapper preserves previously-connected pipelines (Pitfall 2 — Graylog's endpoint POST /api/system/pipelines/connections/to_stream is REPLACE-the-full-set; this wrapper does GET-merge-POST client-side). Pre-flights GET /api/system/pipelines/connections/{streamId} (404 treated as empty set); unions with args.pipelineIds; POSTs the merged set sorted alphabetically. Idempotent attaches surface in existingMatches with similarity_reason: 'already_connected'. Use list_pipelines + list_streams to discover ids. Schema: { streamId, pipelineIds[] } — both required, pipelineIds must contain at least one ID.",
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
        description: "Detach pipelines from a stream. The wrapper preserves remaining connections (Pitfall 2 mirror — Graylog's endpoint POST /api/system/pipelines/connections/to_stream is REPLACE-the-full-set; this wrapper does GET-subtract-POST client-side). Pre-flights GET /api/system/pipelines/connections/{streamId} (404 treated as empty set); subtracts args.pipelineIds; POSTs the reduced set sorted alphabetically. Not-currently-connected IDs surface in existingMatches with similarity_reason: 'not_currently_connected' (no-op). Schema: { streamId, pipelineIds[] } — both required, pipelineIds must contain at least one ID.",
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
        description: "Delete a pipeline rule. Dry-run paginates /api/system/pipelines/rule/paginated to discover referencing pipelines (Strategy A — server-computed used_in_pipelines join) and emits cascades.{pipelines} + a confirmationToken (64-hex sha-256 via computeRuleCascadeHash). Apply requires `confirm:<token>` echoed back; the wrapper re-fetches + recomputes the hash + refuses with reason `cascade_changed_since_preview` on ANY drift. Refuses with reason `cascade_preflight_failed` if the paginated GET errors. NO mutable check (rules have no is_editable on the wire). Apply envelope is SYNC `{deleted:true, ruleId}` (no async/job_id). Path uses the literal `rule` segment (Pitfall 3 rule variant); safety cap at 200 pages × 50/page (Pitfall 7 — 10000 rules max).",
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
        description: "Simulate a pipeline rule against a sample message. Returns the post-rule message DTO so the agent can verify semantic bugs the parser cannot catch (wrong function names, type-coercion errors, set_field reserved-field collisions). Accepts either typed structured intent (compiles via emit.js) OR raw DSL `ruleSource` (mutually exclusive). Pre-flights POST /api/system/pipelines/rule/parse (C4 gate carried forward) — refuses with reason `rule_parse_failed` on parse error before /simulate fires. CRITICAL Pitfall 1: the wire body's `message` field is JSON-STRINGIFIED — agent passes `{message:{source,level,...}}`, wrapper emits `{message:'{\"source\":\"host\",\"level\":6}',rule_source:{source:\"...\"}}`. Pitfall 4: functions depending on Graylog internal `gl2_*` metadata (from_input, route_to_stream, remove_from_stream) cannot be meaningfully simulated — use only for set_field / type-coercion / field-comparison cases. No Graylog state mutation; routes through defineMutatingHandler for uniform dryRun + writable inheritance (D-09).",
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
        description: "List Graylog pipeline-rule built-in functions (merged static catalogue + live overlay). The static baseline (133 hand-curated entries from RESEARCH §Built-in Function Catalogue) is overlaid with the live response from GET /api/system/pipelines/rule/functions — live wins on name collision (Graylog is authoritative); static fills description gaps; live-only names (newer Graylog versions) surface with source:'live' (Pitfall 5 fix). Cached per-connection per-process (1 GET per connection per server lifetime). Optional filters: `category` (e.g. 'strings', 'dates') and `deprecated_only` (boolean). Narrow projection [name, signature, category, source, deprecated]; use fields:'all' for the full entry including oneLineDescription + sourceRef.",
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
        description: "List Graylog dashboards (narrow projection: id, title, summary, description). DASHBOARD-typed views only — saved searches filtered out wrapper-side regardless of upstream filter behavior (Q1 default). Use fields:'all' for the full ViewDTO.",
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
        description: "Get a single Graylog dashboard's full ViewDTO including state.{queryId}.widgets, widget_positions, widget_mapping (widgetId → searchTypeId[]), and search_id. The full DTO is the agent-facing surface — no projection.",
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
        description: "Create a Graylog dashboard via an internal Search+View 2-step chain (POST /api/views/search → POST /api/views). C7 mitigation: agent never sees the intermediate Search ID; widget IDs are wrapper-generated UUIDs. Dry-run surfaces the full chain transcript. Schema rejects agent-supplied `searchId` (D-02 structural). Widget-position integrity validated before any HTTP (D-03 bidirectional).",
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
        description: "Update a Graylog dashboard's metadata (title/description/summary only) via STRICT_NO_ECHO partial update. Pre-flight GET fetches the full ViewDTO; agent's changes are overlaid; PUT carries the merged DTO. searchId is schema-rejected (D-02 — immutable post-creation). For widget composition changes use add_widget_from_template (DASH-06) or remove_widget (DASH-07).",
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
        description: "Delete a Graylog dashboard. Leaf delete (no cascade refusal): widgets vanish with the view; bound Search becomes orphan per Graylog model. Dry-run surfaces an informational cascades.widgets.count (best-effort GET pre-flight). NO confirmationToken; no drift refusal at apply time.",
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
        description: "Remove a widget from a Graylog dashboard. Symmetric two-step PUT chain (PUT /api/views/search + PUT /api/views) — strips the widget's search_types from the bound Search AND the widget + position + widget_mapping entry from the View. D-03 widget-position integrity validated on prospective post-remove sets before wire emission. Use add_widget_from_template (DASH-06) to add widgets.",
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
        description: "Add a widget from the curated 8-template library to a dashboard. Atomic two-step PUT chain (PUT /api/views/search + PUT /api/views); 1-step for top_error_clusters text-widget placeholder. Closed-set templateName enum (M7) rejects unknown names at parse before any HTTP. Use remove_widget (DASH-07) to remove widgets.",
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
        description: "Blueprint (BLUE-05): create an index set bundled for long-term archival — SizeBasedRotationStrategyConfig (1 GiB/index) + DeletionRetentionStrategyConfig (max_number_of_indices ≈ retentionDays, 1 index/day approximation). 1-step chain wrapping create_index_set. Dry-run preview surfaces `chain: [{step:1, tool:'create_index_set', request:{...}}]`; apply walks the chain via executeChain. Defaults: indexPrefix slugified from name; shards 4, replicas 1, writable true. Schema: { name, retentionDays:1..36500, description?, indexPrefix?, shards?, replicas? }.",
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
        description: "Blueprint (BLUE-06): drop messages with `level > minLevel` on a specific stream. 3-step chain: createRule (DSL via emitRule with `when level > minLevel then drop_message()`) → createPipeline (single-stage referencing the rule by title) → connectToStream. Syslog level inversion: HIGHER number = LESS severe (0=emerg, 7=debug); the predicate drops STRICTLY MORE VERBOSE messages than minLevel (e.g. minLevel:6 keeps emerg..info, drops debug-only). Apply walks executeChain — pipeline_ids substituted from step 2's pipeline id at apply-time. Schema: { streamId, minLevel:0..7, pipelineTitle?, ruleTitle? }.",
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
        description: "Blueprint (BLUE-04): create a pipeline (with N rules from structured-intent transforms) and connect it to a stream. Variable-length N+2-step chain: N createRule steps (one per transform, DSL compiled via Phase 4's pipeline-dsl/emit.js — every literal escape-routed) + 1 createPipeline (single-stage referencing all N rule titles in order) + 1 connectToStream. Apply walks executeChain — pipeline_ids substituted from step N+1's pipeline id at apply-time. transforms is bounded 1..20 (DoS cap); for >20 transforms partition across multiple invocations. Schema: { streamId, pipelineTitle, pipelineDescription?, transforms: RuleSpec[1..20] } where RuleSpec = {name, when:Condition, then:Action[]} (same shape as create_pipeline_rule's `structured`).",
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
        description: "Headline blueprint (BLUE-01): set up full app monitoring (stream + drop-debug pipeline + 4-widget health dashboard + error-rate alert) from one intent. 6-step chain composed from src/services/. Default widgets: error_rate_over_time, top_sources_by_volume, level_distribution, recent_events_table.",
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
        description: "Blueprint (BLUE-02): create an error-rate event definition (aggregation-v1 query 'level:>=4') on a stream, wired to an existing notification. 1-step chain. Schedule defaults to false (Phase 5 M1 carry-forward — flip via enable_event_definition). Agent supplies notificationId from list_event_notifications.",
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
];
