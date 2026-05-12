# Structure

**Analysis Date:** 2026-05-12

## Top-Level Layout

```
graylog-mcp/
├── src/                       # All production code
│   ├── index.js               # MCP server entry + tool dispatch (903 lines)
│   ├── tools.js               # Tool definitions / JSON schemas (652 lines)
│   ├── config.js              # Connection registry + active-connection state (55)
│   ├── query.js               # Query builder + axios search client (123)
│   ├── timerange.js           # Relative/absolute time-range parsing (187)
│   ├── aggregations.js        # Histogram + field-aggregation payload builders (411)
│   ├── saved-searches.js      # Named search persistence (62)
│   ├── events.js              # Graylog events/alerts API wrappers (55)
│   ├── tools/                 # Feature-extracted tool handlers
│   │   ├── cluster-errors.js  # cluster_log_messages handler (174)
│   │   └── template-mgmt.js   # list/delete/rename/export/import templates (120)
│   └── clustering/            # Pluggable log-clustering subsystem
│       ├── index.js           # Strategy registry (drain3 auto-registered)
│       ├── preprocess.js      # Tokenizer + numeric/UUID/IP/hex wildcarding
│       ├── formatter.js       # Cluster → MCP response shaping
│       ├── template-store.js  # Per-connection JSON persistence + file lock
│       ├── _test_hooks.js     # Search override for tests
│       └── strategies/
│           └── drain3.js      # Length-bucketed Drain-style strategy
├── docs/                      # Project documentation
├── test-aggregation-fixes.js  # Aggregation payload structural tests
├── test-clustering.js         # Clustering algorithm + template store tests
├── test-features.js           # Time range + aggregation feature tests
├── test-histogram-fixes.js    # Histogram fallback tests
├── example-config.json        # Example multi-connection config
├── FUTURE_PLANS.md            # Roadmap of planned tools/features
├── README.md                  # User-facing docs
├── package.json               # ESM, Node ≥18, axios + MCP SDK + zod
└── LICENSE                    # MIT
```

## Key Locations

**Entry point:** `src/index.js` — declares the `Server`, attaches the stdio transport at the bottom, and routes every `CallToolRequestSchema` to one of ~27 handler functions in the same file.

**Tool catalogue:** `src/tools.js` — single source of truth for tool names, JSON-Schema inputs, and descriptions. The dispatcher in `index.js` must contain a matching `if (name === "...")` branch for every entry here. Mismatch means the tool is visible but un-callable.

**Per-tool handler location:**
- Most handlers live inline in `src/index.js` (e.g. `fetchGraylogMessages`, `getLogHistogram`, `getFieldAggregation`).
- Clustering and template-management handlers were extracted to `src/tools/` to keep `index.js` from growing without bound. New non-trivial tools should follow this extraction pattern.

**Domain helpers:**
- Query string + filters + auth call → `src/query.js`
- Time-range parsing/normalization → `src/timerange.js`
- Aggregation payload shapes (4 variants per chart type) → `src/aggregations.js`
- Connection / active-connection state → `src/config.js`

**Persistent state:**
- Saved searches → `~/.graylog-mcp/saved-searches.json` (handled in `src/saved-searches.js`)
- Clustering templates → `~/.graylog-mcp/templates/<connection>.json` (handled in `src/clustering/template-store.js`)
- Config → `~/.graylog-mcp/config.json` (overridable via `GRAYLOG_CONFIG_PATH`)

## Naming Conventions

**Files:** kebab-case for multi-word filenames (`cluster-errors.js`, `template-mgmt.js`, `saved-searches.js`, `template-store.js`, `_test_hooks.js`). Single-word modules are bare (`query.js`, `events.js`).

**Functions:** camelCase. Two strong prefixes in active use:
- `handle*` for MCP tool handlers (`handleClusterLogMessages`, `handleListTemplates`, `handleSaveSearch`)
- `build*` for payload/struct builders (`buildQueryString`, `buildTimeHistogram`, `buildStreamFilter`, `buildFieldAggregation`)

**Tool names (MCP-visible):** snake_case (`fetch_graylog_messages`, `cluster_log_messages`, `get_log_histogram`, `list_templates`). The handler dispatched is camelCase; the tool is snake.

**Constants:** SCREAMING_SNAKE_CASE for module-scoped constants (`STORE_VERSION`, `LOCK_STALE_MS`, `MAX_SAMPLE`, `WILDCARD_TOKEN`).

**Test hooks / private exports:** leading underscore (`_clearForTests`, `_getSearchOverride`, `_withStorePathOverride`, `_storePathForTests`, `_testConnection`).

## Where Features Live

| Feature | Tool definition | Handler | Helpers |
|---|---|---|---|
| Message search | `src/tools.js` | `src/index.js` (`fetchGraylogMessages`) | `src/query.js`, `src/timerange.js` |
| Histograms (4 fallback strategies) | `src/tools.js` | `src/index.js` (`getLogHistogram`) | `src/aggregations.js` |
| Field aggregations | `src/tools.js` | `src/index.js` (`getFieldAggregation`) | `src/aggregations.js` |
| Events / alerts | `src/tools.js` | `src/index.js` (handlers around line 700+) | `src/events.js` |
| Saved searches | `src/tools.js` | `src/index.js` (`handleSaveSearch` etc.) | `src/saved-searches.js` |
| Connections | `src/tools.js` | `src/index.js` (`listConnections`, `useConnection`) | `src/config.js` |
| Log clustering | `src/tools.js` | `src/tools/cluster-errors.js` | `src/clustering/*` |
| Template CRUD | `src/tools.js` | `src/tools/template-mgmt.js` | `src/clustering/template-store.js` |

## Patterns for Adding New Code

**New tool that wraps a Graylog search call:**
1. Add a definition to `toolDefinitions` in `src/tools.js` (snake_case name, JSON-Schema input).
2. Add a dispatch branch to the `CallToolRequestSchema` handler in `src/index.js`.
3. Implement the handler inline in `src/index.js` if it's a few lines; extract to `src/tools/<feature>.js` if it crosses ~80 lines or has private helpers.
4. Use `requireActiveConnection()` from `src/index.js` for connection-gated tools.

**New aggregation payload shape:** add a `build*` function to `src/aggregations.js`. Don't forget to also add it to the `approaches` array inside `getLogHistogram` / `getFieldTimeAggregation` if it's a fallback for an existing tool.

**New clustering algorithm:**
1. Create `src/clustering/strategies/<name>.js` that exports a strategy object implementing the `{ name, version, hydrate, serialize, cluster }` contract (see `src/clustering/strategies/drain3.js:38`).
2. Import and `register("<name>", strategy)` it inside `src/clustering/index.js`.
3. Users select via the `algorithm` argument on `cluster_log_messages`; default is `"drain3"`.

**New persistent state:** follow the `template-store.js` pattern — version field, atomic write via `tmp+rename`, file lock with stale-break, per-connection file under `~/.graylog-mcp/`.

## Testing Entry Points

All four test scripts live at the repo root and are invoked directly with `node test-<name>.js`. They are not wired into `npm test` (the script there references a non-existent `test-server.js`). See `TESTING.md` for details.
