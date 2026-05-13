<!-- GSD:project-start source:PROJECT.md -->
## Project

**Graylog MCP — Full Admin Surface**

A Model Context Protocol server that gives an AI agent end-to-end control of a Graylog deployment — not just searching and analyzing logs, but **bootstrapping the deployment itself**: streams, pipelines, dashboards, inputs, indices, event definitions. The agent should be able to take a natural-language instruction like *"set up an app monitoring environment for service X"* and produce a working Graylog configuration without a human clicking through the web UI.

The existing v2.3 codebase covers read/analyze (search, aggregations, histograms, log clustering); this milestone is the write/configure half that turns the MCP into a full admin surface.

**Core Value:** **An AI agent can configure Graylog from intent alone, safely, without touching the web UI.** Everything else (parity with Graylog's UI, breadth of API coverage, blueprint quality) flows from that.

### Constraints

- **Tech stack:** Node.js ≥18 ESM; existing dependencies (`@modelcontextprotocol/sdk`, `axios`, `zod`) — adopt `zod` for the long-deferred input validation rather than adding a new dep
- **Graylog version:** 7.2.0-SNAPSHOT only — single target; no multi-version branching
- **Auth model:** Existing connection registry + API token (HTTP Basic with token-as-username, `password: "token"`). No new auth concepts. Insufficient permissions surface as upstream 403.
- **Safety:** Every mutating tool MUST default to `dryRun: true`. Applying without an explicit `dryRun: false` is a bug.
- **Backward compat:** Existing v2.3 tool contracts unchanged. Existing connection-config schema additive only.
- **No web UI:** This is an MCP server. No browser surface, no admin console, no rendered HTML. Output is JSON-stringified text in MCP responses.
- **Code organization:** New admin tools extract into `src/tools/<domain>/` (per-domain modules), not inline in `src/index.js`. Use the existing `src/tools/cluster-errors.js` and `src/tools/template-mgmt.js` pattern.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- JavaScript (Node.js, ES Modules) - All source files in `src/`
- Used for: MCP server implementation, API client, tool handlers, clustering algorithms
- TypeScript - Development dependencies only (`@types/node`, `typescript` in devDependencies)
- Not used in runtime; included for type checking and IDE support
## Runtime
- Node.js 18.0.0+ (requirement in `package.json` engines)
- Tested compatibility: Node 18, 20, 22+
- npm (bundled with Node.js)
- Lockfile: `package-lock.json` present (v3, lockfileVersion 3)
## Frameworks
- `@modelcontextprotocol/sdk` 1.18.0 - MCP server framework
- `axios` 1.12.2 - HTTP client for Graylog REST API calls
- `zod` 3.25.76 - Schema validation library (though primarily used by MCP SDK)
## Key Dependencies
- `@modelcontextprotocol/sdk` 1.18.0 - MCP protocol implementation
- `axios` 1.12.2 - HTTP communication
- `express` 5.0.1 (transitive via MCP SDK) - Web framework for MCP HTTP server
- `cors` 2.8.5 (transitive) - CORS handling for MCP protocol
- `ajv` 6.12.6 (transitive) - JSON schema validation for MCP payloads
- `@types/node` 20.19.15 - TypeScript type definitions
- `typescript` 5.9.2 - Type checker and tooling support
## Configuration
- `GRAYLOG_CONFIG_PATH` - Override default config file location
- No build step required (native ES Modules)
- Dev mode with file watching: `npm run dev` uses `node --watch`
## Entry Points
- `src/index.js` - Main entry point (shebang: `#!/usr/bin/env node`)
- `npm start` - Run server in production mode
- `npm dev` - Run with `--watch` flag for development
- `npm test` - Run test harness via `test-server.js`
## Platform Requirements
- Node.js 18+
- npm or compatible package manager
- Text editor or IDE with ES Module support
- Node.js 18+ runtime environment
- Graylog instance 6.x (tested on 6.2)
- Valid Graylog API token
- Recommended: Container (Docker) with `node:18-alpine` or newer
- Alternative: Direct Node.js installation on host
- MCP client config integration (Claude, Cursor, Claude Desktop)
## File Structure
- `src/index.js` - MCP server bootstrap (904 lines)
- `src/config.js` - Connection and field configuration loader
- `src/query.js` - Graylog API search client and message extraction
- `src/tools.js` - 25 tool schema definitions
- `src/timerange.js` - Time range parsing (relative/absolute)
- `src/aggregations.js` - Histogram and field aggregation builders
- `src/events.js` - Graylog events API integration
- `src/saved-searches.js` - Persistent search storage (`~/.graylog-mcp/saved-searches.json`)
- `src/clustering/index.js` - Strategy registry
- `src/clustering/preprocess.js` - Message normalization
- `src/clustering/formatter.js` - Cluster response formatting
- `src/clustering/template-store.js` - Per-connection template persistence
- `src/clustering/strategies/drain3.js` - Drain3 algorithm implementation
- `src/tools/cluster-errors.js` - `cluster_log_messages` handler
- `src/tools/template-mgmt.js` - Template CRUD handlers
- Config: `~/.graylog-mcp/config.json` (user-managed)
- Saved searches: `~/.graylog-mcp/saved-searches.json` (auto-created)
- Templates: `~/.graylog-mcp/templates/<connection>.json` (per-connection, auto-created)
## No Build Step
- `"type": "module"` in `package.json` enables ESM
- No babel, webpack, tsup, or esbuild configured
- Direct `node src/index.js` execution
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Module System
## Naming
| What | Convention | Examples |
|---|---|---|
| Files (multi-word) | kebab-case | `cluster-errors.js`, `template-store.js` |
| Functions | camelCase | `buildQueryString`, `normalizeMessage` |
| Tool handlers | `handle*` prefix | `handleClusterLogMessages`, `handleSaveSearch` |
| Builders | `build*` prefix | `buildTimeHistogram`, `buildStreamFilter` |
| Module constants | SCREAMING_SNAKE_CASE | `STORE_VERSION`, `LOCK_STALE_MS`, `MAX_SAMPLE` |
| Test-only / private | leading `_` | `_clearForTests`, `_testConnection`, `_storePathForTests` |
| MCP tool names | snake_case | `fetch_graylog_messages`, `cluster_log_messages` |
## Async Style
## Error Handling Pattern
- **Hard error to the MCP client** → return the `isError: true` object above. Used for missing-connection, invalid-input, all caught exceptions.
- **Soft fallback / log-and-continue** → `console.error("[subsystem] message")` and move on. Used for histogram approach failures (`src/index.js:463`), template-store write failures (`src/tools/cluster-errors.js:152`), stale-lock breaking (`src/clustering/template-store.js:58`), corrupt store version mismatch (`src/clustering/template-store.js:35`).
## Validation
## Connection Resolution Pattern
## Tool Handler Shape
## Default Arguments
## Comments
- `src/clustering/strategies/drain3.js:4` — "implement the strategy contract to add a new clustering algorithm; register in src/clustering/index.js"
- `src/clustering/strategies/drain3.js:27` — multi-line comment explaining state shape and the rationale for linear scan vs prefix-tree
- `src/query.js:28` — "MCP clients may pass arrays as JSON strings"
## Linter / Formatter
## Imports Layout
## Persistent-state Idioms
- Version field at the top of the JSON document (`STORE_VERSION = 1`)
- Per-connection file under `~/.graylog-mcp/` (path derived from `getConfigPath()`)
- Atomic write via `writeFileSync(tmp)` + `renameSync(tmp, final)`
- The clustering store additionally takes a file lock (`.lock`) with a 30-second stale break
## Test Hooks
- `_clearForTests()` resets the clustering strategy registry (`src/clustering/index.js:27`)
- `_getSearchOverride()` / `_setSearchOverride()` let tests bypass axios (`src/clustering/_test_hooks.js`)
- `_withStorePathOverride()` redirects the template-store path (`src/clustering/template-store.js:12`)
- `_testConnection` is a magic arg name (`src/tools/cluster-errors.js:20`, `src/tools/template-mgmt.js:9`) that swaps in a fake connection
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Stdio-based MCP server exposing 27 tools for Graylog log search and analysis
- Stateless tool dispatch with optional state persistence (saved searches, clustering templates)
- Connection multiplexing: multi-tenant support via named Graylog connections
- Query builder abstraction for Graylog Unified Search API payloads
- Pluggable clustering algorithms (currently Drain3)
## Layers
- Purpose: Handle Model Context Protocol stdio communication
- Location: `src/index.js` (server initialization, transport setup)
- Contains: Server instance, request routing, response formatting
- Depends on: @modelcontextprotocol/sdk
- Used by: Claude and other MCP clients
- Purpose: Implement individual tool logic, argument validation, error handling
- Location: `src/index.js` (tool handlers like fetchGraylogMessages, getLogHistogram)
- Contains: 27 handler functions + tool definitions in `src/tools.js`
- Depends on: Query layer, Time range layer, Clustering layer, Config layer
- Used by: MCP request handler dispatch
- Purpose: Common operations (query building, field resolution, message extraction)
- Location: `src/query.js`, `src/timerange.js`, `src/config.js`
- Contains:
- Depends on: None (pure utilities)
- Used by: All tool handlers
- Location: `src/aggregations.js`
- Builds Graylog pivot/time-histogram payloads
- Multiple histogram strategies (working-pattern, chart, simple-pivot, complex-pivot)
- Auto-interval resolution based on time range duration
- Location: `src/events.js`
- Wraps Graylog event search, definition, and notification APIs
- Direct axios HTTP calls to `/api/events/*` endpoints
- Location: `src/saved-searches.js`
- Persists named query parameters to `~/.graylog-mcp/saved-searches.json`
- Supports override-at-execution-time
- Location: `src/tools/cluster-errors.js` (handler), `src/clustering/*` (implementation)
- Fetches messages, normalizes, clusters by similarity
- Persists templates per connection in `~/.graylog-mcp/` (template-store.json per connection name)
- Supports Drain3 algorithm (auto-registered on import)
- Reuses learned templates across calls
- Location: `src/tools/template-mgmt.js`
- List/delete/rename/export/import templates
- CRUD operations on persistent template store
- Purpose: HTTP communication with Graylog API
- Location: `src/query.js` (searchGraylog, fetchStreams, fetchMessageById)
- Uses: axios with Basic Auth (apiToken as username, "token" as password)
- Endpoints: `/api/search/universal/resolve`, `/api/events/*`, `/api/streams`
## Data Flow
```
```
```
```
```
```
## State Management
- Active connection name stored in module variable (config.js)
- Set by `use_connection` tool
- Persisted across tool calls within same server process
- Persisted to `~/.graylog-mcp/saved-searches.json`
- Loaded on demand (no in-memory cache)
- Supports creation, retrieval, listing, deletion
- Persisted to `~/.graylog-mcp/{connectionName}-templates.json`
- Loaded before each clustering call
- Algorithm state (Drain3 internal tree) preserved in store
- Reused across multiple clustering calls for incremental learning
- No cross-server persistence (each process restart clears connection selection)
- Time-based queries: no result caching
## Key Abstractions
- Purpose: Multi-tenant Graylog support
- Location: `src/config.js`
- Exports: getActiveConnectionConfig(), setActiveConnection(), getConnections()
- Pattern: Module singleton tracks active connection name; resolved on demand
- Purpose: Unify Elasticsearch query string and Graylog filter construction
- Location: `src/query.js`
- Exports: buildQueryString(), buildStreamFilter()
- Pattern: Composes query + filters into single Elasticsearch query string; OR/AND stream filters
- Purpose: Accept user-friendly time input (1h, 2d, ISO strings) → Graylog timerange objects
- Location: `src/timerange.js`
- Exports: buildTimeRange(), normalizeTimeRangeArgs(), parseRelativeTime(), parseAbsoluteTime()
- Pattern: Validates, converts, defaults to 15-minute relative range
- Purpose: Persist + hydrate clustering algorithm state per connection
- Location: `src/clustering/template-store.js`
- Exports: loadTemplateStore(), saveTemplateStore()
- Pattern: JSON file with templates (count, label, first_seen, last_seen, sources_seen) + algorithm_state
- Purpose: Pluggable algorithm interface
- Location: `src/clustering/index.js` (registry), `src/clustering/strategies/drain3.js` (implementation)
- Pattern: register/get strategy by name; each implements cluster(instance, messages, options)
- Interface: hydrate() → state object, cluster() → {assignments, templates}, serialize() → JSON
- Purpose: Convert log messages to canonical form for clustering (numbers, IPs, UUIDs → <*>)
- Location: `src/clustering/preprocess.js`
- Exports: normalizeMessage(), tokenize()
- Pattern: Regex substitution for common variables; whitespace tokenization
## Entry Points
- Location: `src/index.js` (shebang #!/usr/bin/env node)
- Invoked by: `npm start` or `node src/index.js`
- Responsibilities: Import all handlers, initialize Server, set up request handlers, connect stdio transport
- Location: `src/index.js`, CallToolRequestSchema handler (lines 38-104)
- Router: if/else chain on request.params.name
- Routes to 27 named handlers
- Returns {content} or {isError, content}
- Location: `src/tools.js`
- List: Array of 27 tool objects with name, description, inputSchema
- Used by: ListToolsRequestSchema handler to advertise capabilities
## Error Handling
- Connection validation: requireActiveConnection() helper returns {error} or {conn}
- Search errors: Try/catch searchGraylog(), return isError: true response
- Histogram fallback: Try multiple strategies until one succeeds
- Parsing errors: buildTimeRange() throws Error on invalid input; caught by tool handler
- Clustering failures: Return errorResponse(text) with isError: true
```javascript
```
## Cross-Cutting Concerns
- Minimal console.error() for histogram strategy failures
- No structured logging framework
- Debug hook: _getSearchOverride() in clustering for test interception
- Tool handlers validate required arguments (e.g., field, name)
- Time range validation in timerange.js (no past-1-year, no negative, from < to)
- Field exists check: resolveFields() returns undefined fields silently (picked at extraction)
- Graylog basic auth: username = apiToken, password = "token"
- No token refresh; long-lived tokens expected
- Config file stores baseUrl + apiToken plaintext in ~/.graylog-mcp/config.json
- DEPRECATED params supported: searchTimeRangeInSeconds, timeRangeInSeconds (prefer timeRange)
- Tool accepts both absolute (from/to) and relative (timeRange) time
- normalizeTimeRangeArgs() unifies all time input formats
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
