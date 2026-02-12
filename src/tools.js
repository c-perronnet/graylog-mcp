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
        name: "use_connection",
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
        name: "fetch_graylog_messages",
        description: "Fetch messages from the active Graylog connection. Use 'use_connection' first to select a connection.",
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "The query to search for, with the respective fields and values",
                },
                searchTimeRangeInSeconds: {
                    type: "number",
                    description: "The time range to search for, in seconds",
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
            },
        },
    },
    {
        name: "get_surrounding_messages",
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
                timeRangeInSeconds: {
                    type: "number",
                    description: "Time range in seconds. Default: 3600 (1 hour)",
                },
                limit: {
                    type: "number",
                    description: "Maximum number of distinct values to return. Default: 20",
                },
            },
            required: ["field"],
        },
    },
];
