# Graylog MCP Server

An MCP (Model Context Protocol) server for Graylog that enables AI assistants to search logs, filter by fields, view surrounding context, list streams, and discover field values.

## Features

- **Multi-connection support** — configure and switch between multiple Graylog instances
- **Log search with filters** — query logs with field-level filters (env, level, source, logger_name, etc.)
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
      "apiToken": "your_graylog_api_token"
    },
    "prod": {
      "baseUrl": "http://prod-graylog:9000",
      "apiToken": "your_prod_api_token"
    }
  }
}
```

You can add multiple named connections and switch between them at runtime.

## Use with an MCP Client

Add this server to your MCP client configuration. Common locations:

- **Claude Code**: `~/.claude/mcp.json`
- **Cursor**: `~/.cursor/mcp.json`
- **Claude Desktop (macOS)**: `~/Library/Application Support/Claude/claude_desktop_config.json`

Example config:

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
| `searchTimeRangeInSeconds` | number | No | `900` | Relative time range in seconds |
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
| `timeRangeInSeconds` | number | No | `3600` | Time range |
| `limit` | number | No | `20` | Max distinct values |

## Example Prompts

```
Connect to nonprod and show me the latest error logs from prefr-management in marketplace_loki
```

```
List all available sources in the last hour
```

```
Show me the surrounding messages for this log entry: 01KH5PDR893AZJQBYJJ87AQTW5
```

```
What environments are available?
```

## Project Structure

```
src/
├── index.js    — Server bootstrap, routing, and handlers
├── config.js   — Connection config and default fields
├── query.js    — Query building, Graylog API client, message extraction
└── tools.js    — Tool schema definitions
```

## Troubleshooting

- Ensure `~/.graylog-mcp/config.json` exists with valid connections
- Verify Node.js version is 18+ (`node --version`)
- Run `npm install` if dependencies are missing
- Use `list_connections` to verify your config is loaded
- Use `use_connection` before any search tools

## License

MIT
