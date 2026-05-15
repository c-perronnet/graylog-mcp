# Changelog

## [3.0.0-unreleased] — Phase 0 Foundation

This is the Phase 0 foundation drop of the v3.0.0 admin-surface milestone.
`package.json` `version` remains at `2.3.0` until milestone completion;
v3.0.0 publication is gated on Phases 1-7 per D-04.

### Breaking — Tool renames per `<verb>_<domain>_<noun>` convention (FOUND-13, D-03)

Hardcoded MCP-client references to the old tool names will break. Replace as follows:

| Old | New |
|-----|-----|
| `use_connection` | `set_active_connection` |
| `fetch_graylog_messages` | `search_messages_graylog` |
| `get_surrounding_messages` | `get_context_messages` |
| `get_log_histogram` | `get_histogram_messages` |
| `get_field_aggregation` | `get_aggregation_field` |
| `get_field_time_aggregation` | `get_aggregation_field_over_time` |
| `debug_histogram_query` | `debug_query_histogram` |
| `save_search` | `create_saved_search` |
| `search_events` | `search_events_graylog` |
| `get_event_definitions` | `list_event_definitions` |
| `get_event_notifications` | `list_event_notifications` |
| `rename_log_template` | `update_log_template` |

Tools whose names already fit are unchanged: `list_connections`, `list_streams`,
`list_field_values`, `list_saved_searches`, `get_saved_search`,
`delete_saved_search`, `cluster_log_messages`, `list_log_templates`,
`delete_log_template`, `export_log_templates`, `import_log_templates`.

Old tool names now dispatch as `Tool not found: <old_name>` — there are no
aliases. Update any hardcoded MCP-client tool-name strings to the new names
above to remain compatible with `main`.

### Added

- `src/dispatch.js` — Map-backed tool dispatch replacing the 22-case `if (name === ...)` chain in `src/index.js`. Module-init `assertAllToolsRegistered(toolDefinitions)` fails loudly if any tool in `tools.js` lacks a registered handler (Discretion-06). Per FOUND-01.
- `src/handlers.js` — top-level named-export home for the 17 v2.3 read-tool handlers (extracted from `src/index.js` so tests can import them without triggering the `StdioServerTransport.connect` side-effect at module-init).
- `src/tools/_register.js` — single side-effect-import barrel that registers every existing handler against the dispatch Map.
- `src/graylog/{client,auth,errors,normalize}.js` — single HTTP-client layer with typed errors (GraylogError hierarchy) and response normalisation (`toIdBody`). Per FOUND-02, FOUND-08.
- `src/tools/_shared/{handler,list,connection,idempotency,dry-run,conflict,errors,schemas}.js` — cross-cutting handler primitives: `defineMutatingHandler` (dryRun=true default, zod validation, D-07 writable gate, sha-256 idempotency-key derivation, build/apply with `__SERVER_ASSIGNED__` sentinel), `defineListHandler` (narrow `[id, title, description]` projection, `MAX_LIMIT: 200` clamp). Per FOUND-03/04/05/09/10/11/12.
- Optional `writable: false` per-connection field in `~/.graylog-mcp/config.json` (defaults to `true` when absent). Per D-07. Two-layer defense: both the wrapper layer (`defineMutatingHandler`) and the HTTP client (`makeClient`) refuse non-GET against read-only connections.
- `test/` directory with `node:test` unified suite; 4 root-level `test-*.js` scripts migrated under `test/existing/`. Per D-05.
- `test/regression/read-tools.test.js` + co-located snapshot file under `test/regression/__snapshots__/` — Pitfall-1 regression net proving the dispatch refactor is byte-identical to the old if-chain.

### Changed

- `engines.node` bumped to `>= 22.3.0` (D-01). Required for stable `node:test` `t.snapshot()`.
- `scripts.test` fixed from `node test-server.js` (broken) to `node --test 'test/**/*.test.js'`. Per D-02.
- `@types/node` devDep bumped to `^22.0.0`.

### Migration notes

The renames are hard — there are no aliases. If you script against this server
from a programmatic MCP client, update the tool-name strings before pulling
this revision.
