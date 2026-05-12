# Architecture

**Analysis Date:** 2026-05-12

## Pattern Overview

**Overall:** MCP (Model Context Protocol) Server with Tool-Based RPC Dispatch

**Key Characteristics:**
- Stdio-based MCP server exposing 27 tools for Graylog log search and analysis
- Stateless tool dispatch with optional state persistence (saved searches, clustering templates)
- Connection multiplexing: multi-tenant support via named Graylog connections
- Query builder abstraction for Graylog Unified Search API payloads
- Pluggable clustering algorithms (currently Drain3)

## Layers

**MCP Transport Layer:**
- Purpose: Handle Model Context Protocol stdio communication
- Location: `src/index.js` (server initialization, transport setup)
- Contains: Server instance, request routing, response formatting
- Depends on: @modelcontextprotocol/sdk
- Used by: Claude and other MCP clients

**Tool Handler Layer:**
- Purpose: Implement individual tool logic, argument validation, error handling
- Location: `src/index.js` (tool handlers like fetchGraylogMessages, getLogHistogram)
- Contains: 27 handler functions + tool definitions in `src/tools.js`
- Depends on: Query layer, Time range layer, Clustering layer, Config layer
- Used by: MCP request handler dispatch

**Domain Abstraction Layer:**
- Purpose: Common operations (query building, field resolution, message extraction)
- Location: `src/query.js`, `src/timerange.js`, `src/config.js`
- Contains:
  - Query string builder (filters, exact match logic) → `src/query.js`
  - Time range parser (relative/absolute, unit mapping) → `src/timerange.js`
  - Configuration loader (connections, defaults) → `src/config.js`
- Depends on: None (pure utilities)
- Used by: All tool handlers

**Feature-Specific Layers:**

*Search & Aggregation:*
- Location: `src/aggregations.js`
- Builds Graylog pivot/time-histogram payloads
- Multiple histogram strategies (working-pattern, chart, simple-pivot, complex-pivot)
- Auto-interval resolution based on time range duration

*Events & Alerts:*
- Location: `src/events.js`
- Wraps Graylog event search, definition, and notification APIs
- Direct axios HTTP calls to `/api/events/*` endpoints

*Saved Searches:*
- Location: `src/saved-searches.js`
- Persists named query parameters to `~/.graylog-mcp/saved-searches.json`
- Supports override-at-execution-time

*Log Clustering:*
- Location: `src/tools/cluster-errors.js` (handler), `src/clustering/*` (implementation)
- Fetches messages, normalizes, clusters by similarity
- Persists templates per connection in `~/.graylog-mcp/` (template-store.json per connection name)
- Supports Drain3 algorithm (auto-registered on import)
- Reuses learned templates across calls

*Template Management:*
- Location: `src/tools/template-mgmt.js`
- List/delete/rename/export/import templates
- CRUD operations on persistent template store

**External Integration Layer:**
- Purpose: HTTP communication with Graylog API
- Location: `src/query.js` (searchGraylog, fetchStreams, fetchMessageById)
- Uses: axios with Basic Auth (apiToken as username, "token" as password)
- Endpoints: `/api/search/universal/resolve`, `/api/events/*`, `/api/streams`

## Data Flow

**Typical Message Search Flow:**

```
1. MCP Client → fetch_graylog_messages request
2. index.js: fetchGraylogMessages() handler
   ├─ Validate active connection (config.js)
   ├─ Normalize time range args (timerange.js)
   ├─ Build query string (query.js)
   ├─ Resolve field list (query.js)
   └─ Build Graylog Search API payload
3. query.js: searchGraylog() → axios POST to Graylog
4. Graylog API → JSON response with messages
5. query.js: extractMessages() → extract fields
6. index.js: Format response → JSON response to client
```

**Log Clustering Flow:**

```
1. MCP Client → cluster_log_messages request
2. tools/cluster-errors.js: handleClusterLogMessages()
   ├─ Load template store from disk (template-store.js)
   ├─ Fetch messages (searchGraylog)
   ├─ Normalize messages (preprocess.js)
   ├─ Get clustering strategy (clustering/index.js)
   └─ Run strategy.cluster(instance, messages, options)
3. Drain3 Algorithm (strategies/drain3.js)
   ├─ Tokenize normalized messages
   ├─ Match against existing templates
   ├─ Merge/create templates as needed
   └─ Return assignments + template list
4. Update template store with new templates
5. Persist store to disk
6. Format + return response
```

**Histogram Generation Flow:**

```
1. MCP Client → get_log_histogram request
2. index.js: getLogHistogram() handler
   ├─ Try multiple strategies:
      a) buildWorkingHistogram (fastest)
      b) buildTimeHistogramChart (chart format)
      c) buildSimpleTimeHistogram (basic pivot)
      d) buildTimeHistogram (complex pivot)
   ├─ Stop on first success
   └─ Return method name + results
3. Each builder → aggregations.js payload factory
4. executeAggregation() → searchGraylog() → Graylog API
5. Parse response, format buckets + metrics
6. Return to client
```

## State Management

**Connection State:**
- Active connection name stored in module variable (config.js)
- Set by `use_connection` tool
- Persisted across tool calls within same server process

**Saved Searches:**
- Persisted to `~/.graylog-mcp/saved-searches.json`
- Loaded on demand (no in-memory cache)
- Supports creation, retrieval, listing, deletion

**Clustering Templates:**
- Persisted to `~/.graylog-mcp/{connectionName}-templates.json`
- Loaded before each clustering call
- Algorithm state (Drain3 internal tree) preserved in store
- Reused across multiple clustering calls for incremental learning

**Session Ephemeral:**
- No cross-server persistence (each process restart clears connection selection)
- Time-based queries: no result caching

## Key Abstractions

**Connection Abstraction:**
- Purpose: Multi-tenant Graylog support
- Location: `src/config.js`
- Exports: getActiveConnectionConfig(), setActiveConnection(), getConnections()
- Pattern: Module singleton tracks active connection name; resolved on demand

**Query Builder Abstraction:**
- Purpose: Unify Elasticsearch query string and Graylog filter construction
- Location: `src/query.js`
- Exports: buildQueryString(), buildStreamFilter()
- Pattern: Composes query + filters into single Elasticsearch query string; OR/AND stream filters

**Time Range Abstraction:**
- Purpose: Accept user-friendly time input (1h, 2d, ISO strings) → Graylog timerange objects
- Location: `src/timerange.js`
- Exports: buildTimeRange(), normalizeTimeRangeArgs(), parseRelativeTime(), parseAbsoluteTime()
- Pattern: Validates, converts, defaults to 15-minute relative range

**Template Store Abstraction:**
- Purpose: Persist + hydrate clustering algorithm state per connection
- Location: `src/clustering/template-store.js`
- Exports: loadTemplateStore(), saveTemplateStore()
- Pattern: JSON file with templates (count, label, first_seen, last_seen, sources_seen) + algorithm_state

**Clustering Strategy Abstraction:**
- Purpose: Pluggable algorithm interface
- Location: `src/clustering/index.js` (registry), `src/clustering/strategies/drain3.js` (implementation)
- Pattern: register/get strategy by name; each implements cluster(instance, messages, options)
- Interface: hydrate() → state object, cluster() → {assignments, templates}, serialize() → JSON

**Message Normalizer:**
- Purpose: Convert log messages to canonical form for clustering (numbers, IPs, UUIDs → <*>)
- Location: `src/clustering/preprocess.js`
- Exports: normalizeMessage(), tokenize()
- Pattern: Regex substitution for common variables; whitespace tokenization

## Entry Points

**Process Entry:**
- Location: `src/index.js` (shebang #!/usr/bin/env node)
- Invoked by: `npm start` or `node src/index.js`
- Responsibilities: Import all handlers, initialize Server, set up request handlers, connect stdio transport

**Tool Dispatch:**
- Location: `src/index.js`, CallToolRequestSchema handler (lines 38-104)
- Router: if/else chain on request.params.name
- Routes to 27 named handlers
- Returns {content} or {isError, content}

**Tool Definitions:**
- Location: `src/tools.js`
- List: Array of 27 tool objects with name, description, inputSchema
- Used by: ListToolsRequestSchema handler to advertise capabilities

## Error Handling

**Strategy:** Try-catch with error response formatting

**Patterns:**
- Connection validation: requireActiveConnection() helper returns {error} or {conn}
- Search errors: Try/catch searchGraylog(), return isError: true response
- Histogram fallback: Try multiple strategies until one succeeds
- Parsing errors: buildTimeRange() throws Error on invalid input; caught by tool handler
- Clustering failures: Return errorResponse(text) with isError: true

**Error Response Format:**
```javascript
{
  isError: true,
  content: [{ type: "text", text: "Error message" }]
}
```

## Cross-Cutting Concerns

**Logging:**
- Minimal console.error() for histogram strategy failures
- No structured logging framework
- Debug hook: _getSearchOverride() in clustering for test interception

**Validation:**
- Tool handlers validate required arguments (e.g., field, name)
- Time range validation in timerange.js (no past-1-year, no negative, from < to)
- Field exists check: resolveFields() returns undefined fields silently (picked at extraction)

**Authentication:**
- Graylog basic auth: username = apiToken, password = "token"
- No token refresh; long-lived tokens expected
- Config file stores baseUrl + apiToken plaintext in ~/.graylog-mcp/config.json

**Backward Compatibility:**
- DEPRECATED params supported: searchTimeRangeInSeconds, timeRangeInSeconds (prefer timeRange)
- Tool accepts both absolute (from/to) and relative (timeRange) time
- normalizeTimeRangeArgs() unifies all time input formats

---

*Architecture analysis: 2026-05-12*
