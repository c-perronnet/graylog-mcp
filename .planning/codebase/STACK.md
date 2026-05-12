# Technology Stack

**Analysis Date:** 2026-05-12

## Languages

**Primary:**
- JavaScript (Node.js, ES Modules) - All source files in `src/`
- Used for: MCP server implementation, API client, tool handlers, clustering algorithms

**Secondary:**
- TypeScript - Development dependencies only (`@types/node`, `typescript` in devDependencies)
- Not used in runtime; included for type checking and IDE support

## Runtime

**Environment:**
- Node.js 18.0.0+ (requirement in `package.json` engines)
- Tested compatibility: Node 18, 20, 22+

**Package Manager:**
- npm (bundled with Node.js)
- Lockfile: `package-lock.json` present (v3, lockfileVersion 3)

## Frameworks

**Core:**
- `@modelcontextprotocol/sdk` 1.18.0 - MCP server framework
  - Provides: `Server`, `StdioServerTransport`, request/response handling
  - Used in: `src/index.js` for tool definition and request routing
  - Includes transitive dependencies: Express 5.0.1, AJV JSON validator, CORS, eventsource

**HTTP Client:**
- `axios` 1.12.2 - HTTP client for Graylog REST API calls
  - Used in: `src/query.js`, `src/events.js` for API requests with Basic auth

**Validation & Type Safety:**
- `zod` 3.25.76 - Schema validation library (though primarily used by MCP SDK)
  - Available for runtime validation if needed

## Key Dependencies

**Critical:**
- `@modelcontextprotocol/sdk` 1.18.0 - MCP protocol implementation
  - Why it matters: Entire server architecture depends on MCP spec compliance
  - Includes: Request/response schemas, stdio transport, tool registration

- `axios` 1.12.2 - HTTP communication
  - Why it matters: All Graylog REST API calls depend on it
  - Features used: Basic auth (username/password with 'token'), custom headers, error handling

**Infrastructure:**
- `express` 5.0.1 (transitive via MCP SDK) - Web framework for MCP HTTP server
- `cors` 2.8.5 (transitive) - CORS handling for MCP protocol
- `ajv` 6.12.6 (transitive) - JSON schema validation for MCP payloads

**Development Only:**
- `@types/node` 20.19.15 - TypeScript type definitions
- `typescript` 5.9.2 - Type checker and tooling support

## Configuration

**Environment Variables:**
- `GRAYLOG_CONFIG_PATH` - Override default config file location
  - Default: `~/.graylog-mcp/config.json`
  - Used in: `src/config.js` line 8

**Config File Format (JSON):**
```json
{
  "connections": {
    "nonprod": {
      "baseUrl": "http://graylog:9000",
      "apiToken": "your_token"
    }
  },
  "defaultFields": ["timestamp", "message", "level"]
}
```

**Build/Dev:**
- No build step required (native ES Modules)
- Dev mode with file watching: `npm run dev` uses `node --watch`

## Entry Points

**Server Bootstrap:**
- `src/index.js` - Main entry point (shebang: `#!/usr/bin/env node`)
  - Initializes MCP Server instance
  - Registers all 25 tool handlers via `CallToolRequestSchema` router
  - Establishes stdio transport for MCP communication

**Scripts:**
- `npm start` - Run server in production mode
- `npm dev` - Run with `--watch` flag for development
- `npm test` - Run test harness via `test-server.js`

## Platform Requirements

**Development:**
- Node.js 18+
- npm or compatible package manager
- Text editor or IDE with ES Module support

**Production:**
- Node.js 18+ runtime environment
- Graylog instance 6.x (tested on 6.2)
- Valid Graylog API token

**Deployment:**
- Recommended: Container (Docker) with `node:18-alpine` or newer
- Alternative: Direct Node.js installation on host
- MCP client config integration (Claude, Cursor, Claude Desktop)

## File Structure

**Core Implementation:**
- `src/index.js` - MCP server bootstrap (904 lines)
- `src/config.js` - Connection and field configuration loader
- `src/query.js` - Graylog API search client and message extraction
- `src/tools.js` - 25 tool schema definitions
- `src/timerange.js` - Time range parsing (relative/absolute)
- `src/aggregations.js` - Histogram and field aggregation builders
- `src/events.js` - Graylog events API integration
- `src/saved-searches.js` - Persistent search storage (`~/.graylog-mcp/saved-searches.json`)

**Clustering & Templates:**
- `src/clustering/index.js` - Strategy registry
- `src/clustering/preprocess.js` - Message normalization
- `src/clustering/formatter.js` - Cluster response formatting
- `src/clustering/template-store.js` - Per-connection template persistence
- `src/clustering/strategies/drain3.js` - Drain3 algorithm implementation
- `src/tools/cluster-errors.js` - `cluster_log_messages` handler
- `src/tools/template-mgmt.js` - Template CRUD handlers

**Data Storage:**
- Config: `~/.graylog-mcp/config.json` (user-managed)
- Saved searches: `~/.graylog-mcp/saved-searches.json` (auto-created)
- Templates: `~/.graylog-mcp/templates/<connection>.json` (per-connection, auto-created)

## No Build Step

This project uses native ES Modules with no transpilation, bundling, or compilation:
- `"type": "module"` in `package.json` enables ESM
- No babel, webpack, tsup, or esbuild configured
- Direct `node src/index.js` execution

---

*Stack analysis: 2026-05-12*
