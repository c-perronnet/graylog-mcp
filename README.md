# Graylog MCP Server

An MCP (Model Context Protocol) server for Graylog that enables AI assistants to search logs, filter by fields, view surrounding context, list streams, and discover field values.

## Features

- **Multi-connection support** — configure and switch between multiple Graylog instances
- **Advanced log search** — query logs with field-level filters (env, level, source, logger_name, etc.)
- **Advanced time ranges** — flexible time specifications (`1h`, `30m`, `2d`) and absolute ranges
- **Log aggregations** — histograms, field statistics, and time-series analysis
- **Exact match by default** — queries use exact matching unless explicitly set to fuzzy/wildcard
- **Surrounding messages** — view messages around a specific log entry by message ID or timestamp
- **Pagination** — page through large result sets
- **Stream listing** — list all available Graylog streams
- **Field value discovery** — find distinct values for any field (top N by count)
- **Default fields** — returns only key fields by default, reducing noise from internal Graylog fields

## Requirements

- Node.js 18+
- Graylog 6.x (tested on 6.2.10)

## Installation

```bash
git clone git@github.com:jagadeesh52423/graylog-mcp.git
cd graylog-mcp
npm install
```

## Configuration

Create a config file at `~/.graylog-mcp/config.json`:

```json
{
  "connections": {
    "nonprod": {
      "baseUrl": "http://your-graylog-server:9000",
      "apiToken": "your_graylog_api_token",
      "defaultFields": ["timestamp", "gl2_message_id", "source", "env", "level", "message", "logger_name"]
    },
    "prod": {
      "baseUrl": "http://prod-graylog:9000",
      "apiToken": "your_prod_api_token"
    }
  },
  "defaultFields": ["timestamp", "message", "level", "source", "PODNAME"]
}
```

**Configuration options:**

| Option | Level | Description |
|--------|-------|-------------|
| `connections` | Root | Named Graylog instances with `baseUrl` and `apiToken` |
| `defaultFields` | Root | Global default fields for all connections (optional) |
| `defaultFields` | Connection | Override default fields for a specific connection (optional) |

**Field resolution priority:**
1. Connection-specific `defaultFields` (highest)
2. Global `defaultFields`
3. All fields (`*`) if neither is set

## Use with an MCP Client

Add this server to your MCP client configuration. Common locations:

- **Claude Code**: `~/.claude/mcp.json`
- **Cursor**: `~/.cursor/mcp.json`
- **Claude Desktop (macOS)**: `~/Library/Application Support/Claude/claude_desktop_config.json`

Example config using npx (recommended):

```json
{
  "mcpServers": {
    "graylog": {
      "command": "npx",
      "args": ["graylog-mcp-server"],
      "env": {
        "GRAYLOG_CONFIG_PATH": "/path/to/your/config.json"
      }
    }
  }
}
```

The `GRAYLOG_CONFIG_PATH` environment variable is optional. If not set, it defaults to `~/.graylog-mcp/config.json`.

Or with a local clone:

```json
{
  "mcpServers": {
    "graylog": {
      "command": "node",
      "args": ["/path/to/graylog-mcp/src/index.js"]
    }
  }
}
```

## Time Range Specifications

The MCP server supports flexible time range specifications:

### Relative Time Ranges
Use simple time expressions for relative ranges:
- `1h` - 1 hour
- `30m` - 30 minutes
- `2d` - 2 days
- `1w` - 1 week
- `3M` - 3 months

**Supported units:** `s` (seconds), `m` (minutes), `h` (hours), `d` (days), `w` (weeks), `M` (months), `y` (years)

### Absolute Time Ranges
Specify exact time windows with `from` and `to` parameters:
- ISO timestamps: `2024-01-15T10:30:00.000Z`
- Date strings: `2024-01-15 10:30:00`
- Unix timestamps: `1705312200000`

### Examples
```
# Last 2 hours of error logs
timeRange: "2h", filters: {"level": 3}

# Specific time window
from: "2024-01-15T09:00:00Z", to: "2024-01-15T17:00:00Z"

# Last 30 minutes (default if no time specified)
timeRange: "30m"
```

## Available Tools

### list_connections

List all configured Graylog connections.

### use_connection

Connect to a specific Graylog instance by name. Must be called before using other tools.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Connection name from config |

### fetch_graylog_messages

Search and fetch log messages from Graylog.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | No | `*` | Search query |
| `filters` | object | No | | Field filters (e.g. `{"env": "marketplace_loki", "level": 7}`) |
| `exactMatch` | boolean | No | `true` | Wrap query in quotes for exact match. Set `false` for fuzzy/wildcard |
| `timeRange` | string | No | `15m` | Time range (e.g., `1h`, `30m`, `2d`) |
| `from` | string | No | | Start time for absolute range |
| `to` | string | No | | End time for absolute range |
| `pageSize` | number | No | `50` | Messages per page |
| `page` | number | No | `1` | Page number |
| `fields` | string | No | default set | Comma-separated fields, or `*` for all |

**Default fields returned:** `timestamp`, `gl2_message_id`, `source`, `env`, `level`, `message`, `logger_name`, `thread_name`, `PODNAME`

### get_surrounding_messages

View messages around a specific log entry. Useful for understanding context.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `messageId` | string | No* | | `gl2_message_id` of the target message (preferred) |
| `messageTimestamp` | string | No* | | ISO timestamp (fallback) |
| `surroundingSeconds` | number | No | `5` | Time window (± seconds) |
| `query` | string | No | `*` | Additional query filter |
| `filters` | object | No | | Field filters |
| `exactMatch` | boolean | No | `true` | Exact match for query |
| `limit` | number | No | `50` | Max messages to return |
| `fields` | string | No | default set | Comma-separated fields, or `*` for all |

*Either `messageId` or `messageTimestamp` must be provided.

### list_streams

List all available Graylog streams in the active connection. No parameters required.

### list_field_values

Discover distinct values for a field, sorted by message count (descending).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `field` | string | Yes | | Field name (e.g. `source`, `env`, `logger_name`) |
| `query` | string | No | `*` | Scope the results |
| `filters` | object | No | | Field filters to narrow scope |
| `exactMatch` | boolean | No | `true` | Exact match for query |
| `timeRange` | string | No | `1h` | Time range (e.g., `1h`, `30m`, `2d`) |
| `from` | string | No | | Start time for absolute range |
| `to` | string | No | | End time for absolute range |
| `limit` | number | No | `20` | Max distinct values |

### get_log_histogram

Get a time-based histogram of log messages. Shows message counts over time intervals.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | No | `*` | Query to filter messages |
| `filters` | object | No | | Field filters (e.g. `{"env": "production", "level": 3}`) |
| `exactMatch` | boolean | No | `true` | Exact match for query |
| `timeRange` | string | No | `15m` | Time range (e.g., `1h`, `30m`, `2d`) |
| `from` | string | No | | Start time for absolute range |
| `to` | string | No | | End time for absolute range |
| `interval` | string | No | `auto` | Time interval for buckets (e.g., `1m`, `5m`, `1h`) |

### get_field_aggregation

Aggregate log messages by field values with statistics. Get counts, sums, averages, etc. for field values.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `field` | string | Yes | | Field to aggregate on (e.g., `source`, `env`, `logger_name`) |
| `query` | string | No | `*` | Query to filter messages |
| `filters` | object | No | | Field filters (e.g. `{"env": "production"}`) |
| `exactMatch` | boolean | No | `true` | Exact match for query |
| `timeRange` | string | No | `15m` | Time range (e.g., `1h`, `30m`, `2d`) |
| `from` | string | No | | Start time for absolute range |
| `to` | string | No | | End time for absolute range |
| `limit` | number | No | `20` | Maximum number of field values |
| `metrics` | array | No | `["count"]` | Metrics to calculate (`count`, `sum`, `avg`, `min`, `max`) |
| `valueField` | string | No | | Numeric field for sum/avg/min/max calculations |

### get_field_time_aggregation

Two-dimensional aggregation: field values over time. Shows how field values change over time intervals.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `field` | string | Yes | | Field to aggregate on (e.g., `source`, `env`, `level`) |
| `query` | string | No | `*` | Query to filter messages |
| `filters` | object | No | | Field filters (e.g. `{"env": "production"}`) |
| `exactMatch` | boolean | No | `true` | Exact match for query |
| `timeRange` | string | No | `15m` | Time range (e.g., `1h`, `30m`, `2d`) |
| `from` | string | No | | Start time for absolute range |
| `to` | string | No | | End time for absolute range |
| `interval` | string | No | `auto` | Time interval for buckets (e.g., `1m`, `5m`, `1h`) |
| `limit` | number | No | `10` | Maximum number of field values |

### debug_histogram_query

Debug helper to test if the histogram query finds any messages at all. Use this if histogram returns empty buckets.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | No | `*` | Query to test |
| `filters` | object | No | | Field filters to test |
| `exactMatch` | boolean | No | `true` | Exact match for query |
| `timeRange` | string | No | `15m` | Time range to test |
| `from` | string | No | | Start time for absolute range |
| `to` | string | No | | End time for absolute range |

## Example Prompts

### Basic Search
```
Connect to nonprod and show me the latest error logs from prefr-management in marketplace_loki
```

```
Show me logs from the last 2 hours with level 3 errors
```

### Field Discovery
```
List all available sources in the last hour
```

```
What environments are available?
```

### Log Aggregations
```
Show me a histogram of error logs over the past day with 1-hour intervals
```

```
Get aggregated error counts by service for the last 6 hours
```

```
Show me how error levels have changed over time in the last 4 hours
```

### Advanced Time Ranges
```
Show me logs from January 15th 9 AM to 5 PM
```

```
Get field statistics for the production environment over the past week
```

### Context Analysis
```
Show me the surrounding messages for this log entry: 01KH5PDR893AZJQBYJJ87AQTW5
```

```
Find error patterns in the marketplace_loki environment over the last day
```

## Project Structure

```
src/
├── index.js        — Server bootstrap, routing, and handlers
├── config.js       — Connection config and default fields
├── query.js        — Query building, Graylog API client, message extraction
├── tools.js        — Tool schema definitions
├── timerange.js    — Advanced time range parsing and utilities
└── aggregations.js — Log aggregation and statistical analysis
```

## Troubleshooting

### Basic Setup
- Ensure `~/.graylog-mcp/config.json` exists with valid connections
- Verify Node.js version is 18+ (`node --version`)
- Run `npm install` if dependencies are missing
- Use `list_connections` to verify your config is loaded
- Use `use_connection` before any search tools

### Aggregation Issues

**Empty Histogram Buckets:**
1. Use `debug_histogram_query` with same parameters to test if query finds any data
2. Try shorter time ranges (e.g., `"30m"` instead of `"2d"`)
3. Simplify query (try `"*"` to search all messages)
4. Check if your time range has any log activity

**400 Bad Request Errors:**
- The server now tries multiple fallback approaches automatically
- Check server console logs for detailed error information
- Ensure your Graylog version supports pivot aggregations (6.x+)

**Field Aggregation Working but Histogram Failing:**
- Use the `debug_histogram_query` tool to isolate the issue
- The server will automatically try: `working-pattern` → `chart` → `simple-pivot` → `complex-pivot`
- Enhanced logging shows which approach succeeds

### Feature Status
- ✅ **Field Aggregation**: Fully working
- ✅ **Advanced Time Ranges**: Fully working
- ✅ **Field-Time Aggregation**: Fully working
- 🔧 **Log Histogram**: Fixed with multiple fallback approaches

## Log Clustering (Drain3)

Group similar log messages into structural templates. Templates are learned per
connection and persisted at `~/.graylog-mcp/templates/<connection>.json`.

### Tools

- `cluster_log_messages` — fetch and cluster a sample of messages
- `list_log_templates` — list learned templates
- `delete_log_template` — remove a template
- `rename_log_template` — give a template a human-readable label
- `export_log_templates` — dump library as JSON
- `import_log_templates` — bulk load templates (merge or replace)

### Example

After selecting a connection with `use_connection`:

```json
{
    "tool": "cluster_log_messages",
    "arguments": {
        "query": "level:ERROR",
        "timeRange": "1h",
        "sampleSize": 500,
        "minClusterSize": 2,
        "includeSamples": 3
    }
}
```

The response groups the 500 sampled messages into a small number of templates,
each with a count, sample messages, and the set of sources where it appeared.
Subsequent calls reuse and reinforce the same templates.

### Adding a new clustering algorithm

1. Create `src/clustering/strategies/<name>.js` implementing the strategy
   contract (`hydrate`, `serialize`, `cluster`) — see `drain3.js` for reference.
2. Import and `register("<name>", strategy)` in `src/clustering/index.js`.
3. Pass `algorithm: "<name>"` to `cluster_log_messages`.

No other code changes required.

## License

MIT
