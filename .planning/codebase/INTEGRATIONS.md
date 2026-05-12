# External Integrations

**Analysis Date:** 2026-05-12

## APIs & External Services

**Graylog REST API:**
- Service: Graylog (version 6.x+, tested on 6.2)
- What it's used for: Log search, aggregations, events, stream discovery, field extraction
- SDK/Client: `axios` (custom HTTP client wrapper)
- Auth: Basic auth with username=apiToken, password="token"
- Base URL: Configured per-connection in `~/.graylog-mcp/config.json`

## Graylog API Endpoints

All endpoints use Graylog's standard REST API format with two authentication methods supported:

**Endpoint Pattern:**
```
{baseUrl}/api/{endpoint}
```

**Authentication:**
- HTTP Basic Auth: `Authorization: Basic {base64(apiToken:token)}`
- Header: `X-Requested-By: graylog-mcp`
- Header: `Accept: application/json`

**Core Search Endpoints:**

1. **Search (Unified Query)** - `POST /api/views/search/sync`
   - Used in: `src/query.js:searchGraylog()` line 99
   - Purpose: Full-text search, field aggregations, histograms, pivots
   - Payload: Unified search query with timerange, filters, search_types
   - Request Types:
     - `messages` - Raw log entries with pagination
     - `pivot` - Field-value aggregations with metrics
     - `chart` - Time-series aggregations
   - Called by: 
     - `fetch_graylog_messages` (log search with pagination)
     - `get_surrounding_messages` (context lookup by timestamp)
     - `list_field_values` (distinct field value discovery)
     - `get_log_histogram` (time-bucketed counts/aggregations)
     - `get_field_aggregation` (group-by with metrics)
     - `get_field_time_aggregation` (2D: field × time)
     - `debug_histogram_query` (diagnostic helper)

2. **Streams Discovery** - `GET /api/streams`
   - Used in: `src/query.js:fetchStreams()` line 85
   - Purpose: List all available streams
   - Called by: `list_streams` tool
   - Returns: Array of stream objects with `id`, `title`, `description`

3. **Message by ID** - `POST /api/views/search/sync`
   - Used in: `src/query.js:fetchMessageById()` line 65
   - Purpose: Fetch single message by Graylog message ID
   - Query: `gl2_message_id:{messageId}`
   - Called by: `get_surrounding_messages` (when messageId provided)

4. **Events Search** - `POST /api/events/search`
   - Used in: `src/events.js:searchEvents()` line 3
   - Purpose: Search Graylog events with filters
   - Called by: `search_events` tool
   - Payload: Query string, event definition filters, pagination, timerange

5. **Event Definitions** - `GET /api/events/definitions`
   - Used in: `src/events.js:fetchEventDefinitions()` line 18
   - Purpose: List event definitions for filtering
   - Params: page, per_page, query
   - Called by: `get_event_definitions` tool

6. **Event Notifications** - `GET /api/events/notifications`
   - Used in: `src/events.js:fetchEventNotifications()` line 38
   - Purpose: List event notification methods
   - Params: page, per_page
   - Called by: `get_event_notifications` tool

## Authentication & Identity

**Auth Provider:**
- Type: Token-based (Graylog API Tokens)
- Implementation: HTTP Basic auth with fixed password "token"
- Token source: User-provided in config file `~/.graylog-mcp/config.json`
- Per-connection: Each Graylog connection has its own `apiToken`

**Configuration:**
```json
{
  "connections": {
    "prod": {
      "baseUrl": "http://graylog-prod:9000",
      "apiToken": "your_graylog_api_token_here"
    }
  }
}
```

**Token Creation:**
- User must generate token in Graylog UI or API
- Reference: https://go2docs.graylog.org/current/setting_up_graylog/rest_api_access_tokens.html
- No automatic token management in MCP server

## Data Storage

**Databases:**
- Type: Graylog internal (MongoDB/Elasticsearch backend)
- Connection: Via Graylog REST API only (no direct database access)
- Client: `axios` HTTP client

**File Storage (Local):**
- Saved searches: `~/.graylog-mcp/saved-searches.json` (user home directory)
  - Format: JSON with search metadata and query parameters
  - Persistence: `src/saved-searches.js` handles load/save
  - Created on first save

- Template library: `~/.graylog-mcp/templates/{connectionName}.json` (per-connection)
  - Format: Template store with algorithm state and learned templates
  - Persistence: `src/clustering/template-store.js` with file locking
  - Versioning: STORE_VERSION = 1
  - Lock mechanism: 30-second stale lock detection

**Caching:**
- None. All requests are live against Graylog API.

## MCP Protocol Integration

**Model Context Protocol:**
- Version: Implemented via `@modelcontextprotocol/sdk` 1.18.0
- Transport: STDIO (stdin/stdout)
- Initialization: `src/index.js` lines 25-32 create Server and handlers
- Request handling: `CallToolRequestSchema` router dispatches 25 tools

**Tool Definitions:**
- Schema file: `src/tools.js`
- 25 tools provided covering log search, aggregations, clustering, events, saved searches
- Request format: Tool name + arguments (JSON)
- Response format: Content array with type="text" and JSON payload

**Server Capabilities:**
- Tools: Enabled with `capabilities: { tools: {} }`
- Prompts: Not implemented
- Resources: Not implemented

## Multi-Connection Architecture

**Connection Management:**
- Config source: `~/.graylog-mcp/config.json` (user-managed)
- Active connection: Tracked in memory (set via `use_connection` tool)
- Default: First connection alphabetically (if not explicitly set)
- Per-connection config includes:
  - `baseUrl` - Graylog instance URL
  - `apiToken` - API token for that instance
  - `defaultFields` - Optional per-connection field overrides

**Tools:**
- `list_connections` - List all configured connections
- `use_connection` - Switch active connection (connection name required)

**State Management:**
- Connection state: In-memory in `src/config.js`
- Search context: Per-connection (API token, baseUrl, fields)
- Template library: Per-connection (separate JSON file per connection)

## Error Handling & Debugging

**Graylog API Error Logging:**
- Location: `src/query.js:searchGraylog()` lines 113-121
- Logs: HTTP status, statusText, response data, request payload
- Output: `console.error()` (visible in parent MCP client logs)

**Histogram Debugging:**
- Tool: `debug_histogram_query`
- Purpose: Diagnose empty histogram results
- Tests:
  1. Basic message search to verify query matches data
  2. Simple count aggregation to test pivot support
  3. Diagnosis output: Has data? Query works? Aggregation works?

## Webhooks & Callbacks

**Incoming:**
- None. MCP server does not expose HTTP endpoints or webhooks.

**Outgoing:**
- None. No callbacks or notifications sent to external services.
- One-way communication: Graylog → MCP (query only)

## Authentication Diagram

```
MCP Client (Claude, Cursor)
    ↓
STDIO Transport
    ↓
MCP Server (graylog-mcp)
    ↓
Tool Handler (e.g., fetch_graylog_messages)
    ↓
axios HTTP Client
    ↓
Graylog REST API
    (with Basic Auth: token:token)
```

## Environment Configuration

**Required Environment Variables:**
- None required at runtime (all config via `~/.graylog-mcp/config.json`)

**Optional Environment Variables:**
- `GRAYLOG_CONFIG_PATH` - Override default config file location
  - Default: `~/.graylog-mcp/config.json`
  - Used in: `src/config.js` line 8
  - Example: `export GRAYLOG_CONFIG_PATH=/etc/graylog-mcp/config.json`

**Config File Location Priority:**
1. `$GRAYLOG_CONFIG_PATH` (if set)
2. `~/.graylog-mcp/config.json` (default)

## Example Integration Flow

**User Query:** "Show me error logs from the last hour"

1. MCP client calls `use_connection` to select Graylog instance
2. MCP client calls `fetch_graylog_messages` with:
   - `query`: "error"
   - `timeRange`: "1h" (relative)
3. Server resolves `1h` → `{ type: "relative", range: 3600 }`
4. Server builds Graylog search payload with elasticsearch query_string
5. Server calls `axios.post(/api/views/search/sync)` with Basic auth
6. Graylog returns matching messages
7. Server extracts fields per `defaultFields` config
8. MCP server returns JSON with messages, total_results, time_range

---

*Integration audit: 2026-05-12*
