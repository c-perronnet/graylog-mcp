<!-- generated-by: gsd-doc-writer -->
# Graylog MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server that gives AI agents end-to-end control of a Graylog 7.0.6 deployment — not just searching logs, but **bootstrapping the deployment itself**: streams, pipelines, dashboards, inputs, indices, event definitions, entity sharing, and role management.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.3.0-brightgreen.svg)](package.json)

## What It Does

Tell an AI agent something like *"set up an app monitoring environment for service X"* and it produces a working Graylog configuration — stream + routing rules + pipeline + dashboard + alert chain — without anyone clicking through the web UI.

**101 tools** spanning read/analyze and full admin write surfaces:

- **Search & analysis** — full-text and field-filtered queries, surrounding-message context, histograms (4-fallback strategy), field statistics, two-dimensional field-over-time breakdowns
- **Log clustering** — group similar messages into structural templates via Drain3, persisted per connection
- **Inputs & extractors** — CRUD over all 8 Graylog 7.0.6 extractor primitives, encrypted-field-safe input updates
- **Streams & rules** — CRUD + stream-rule CRUD + `test_stream_match` + cascade-aware deletes
- **Pipelines** — pipeline CRUD, pipeline-rule CRUD with a 133-entry DSL function catalogue, server-authoritative parse pre-flight, pipeline↔stream connection management
- **Index sets** — rotation/retention strategy bundles, deflector cycling, inverted-default deletes with sha-256 confirmation
- **Events & notifications** — event definition + notification CRUD with v6→v7 aggregation migration
- **Dashboards** — view/search 2-step creation chain, 8-template widget library, `add_widget_from_template` / `remove_widget` symmetric chains
- **Blueprints** — 6 cross-domain composition tools (`setup_app_monitoring_stack`, `setup_error_alerting`, `create_app_health_dashboard`, `setup_long_term_archival_index`, `setup_debug_log_dropping`, `setup_pipeline_for_stream`)
- **AuthZ** — `share_entity` (grant view/manage/own on streams, dashboards, saved searches), `get_entity_shares`, `list_grantees`
- **Role management** — `list_roles`, `get_role`, `create_role`, `update_role`, `delete_role`, `assign_role`, `unassign_role`
- **Multi-connection** — switch between Graylog instances within one session via `set_active_connection`
- **Saved searches** — named query persistence across sessions

### Safety model

Every mutating tool defaults to `dryRun: true` and returns an sha-256 confirmation token over the dry-run state. Applying without an explicit `dryRun: false` plus the matching `confirm` token is structurally impossible. The same handler re-derives the token at apply-time against live state and refuses on drift — so a stream/index/share that changed between preview and apply is rejected, not silently overwritten.

A per-connection `writable: false` flag in `~/.graylog-mcp/config.json` blocks every mutating tool on that connection regardless of `dryRun`.

## Prerequisites

- **Node.js** `>= 22.3.0` (ESM)
- **Graylog** `7.0.6` (the single supported target — see [`CLAUDE.md`](CLAUDE.md))
- A Graylog API token ([how to create one](https://go2docs.graylog.org/current/setting_up_graylog/rest_api_access_tokens.html))

## Installation

### From source

```bash
git clone https://github.com/c-perronnet/graylog-mcp.git
cd graylog-mcp
npm install
```

### Via npx

```json
{
  "mcpServers": {
    "graylog": {
      "command": "npx",
      "args": ["graylog-mcp-server"]
    }
  }
}
```

## Quick Start

1. Create `~/.graylog-mcp/config.json` with at least one connection (see [Configuration](#configuration)).
2. Wire the server into your MCP client:

   ```json
   {
     "mcpServers": {
       "graylog": {
         "command": "node",
         "args": ["/absolute/path/to/graylog-mcp/src/index.js"]
       }
     }
   }
   ```

3. From the client, ask the agent to `set_active_connection` and run a tool — e.g. `list_streams` to confirm reachability, then `search_messages_graylog` with a `query` and `timeRange`.
4. For write workflows, every mutating call previews by default. Inspect the returned `confirm` token, then re-issue the same call with `dryRun: false` and `confirm: "<token>"` to apply.

## Configuration

`~/.graylog-mcp/config.json`:

```json
{
  "connections": {
    "prod": {
      "baseUrl": "https://graylog.example.com",
      "apiToken": "REPLACE_WITH_YOUR_API_TOKEN",
      "writable": false
    },
    "staging": {
      "baseUrl": "https://staging.graylog.example.com",
      "apiToken": "REPLACE_WITH_YOUR_API_TOKEN"
    }
  }
}
```

| Field | Required | Description |
|---|---|---|
| `connections.<name>.baseUrl` | yes | Base URL of the Graylog instance (no trailing path) |
| `connections.<name>.apiToken` | yes | API token used as HTTP Basic username; password is the literal string `token` |
| `connections.<name>.writable` | no | Defaults to `true` when absent. Set to `false` to refuse every mutating tool on this connection |
| `connections.<name>.defaultFields` | no | Per-connection default field list returned by `search_messages_graylog` |
| `defaultFields` | no | Global default field list (per-connection overrides take priority) |

Override the config path with the `GRAYLOG_CONFIG_PATH` environment variable. The file should be mode `0600` — it stores credentials.

A starter file lives at [`example-config.json`](example-config.json).

## Usage Examples

### Read: search and cluster errors from the last hour

```text
1. set_active_connection(name: "prod")
2. search_messages_graylog(query: "level:ERROR", timeRange: "1h", pageSize: 100)
3. cluster_log_messages(query: "level:ERROR", timeRange: "1h")
```

### Write: preview then apply a new stream

```text
1. create_stream(title: "service-x errors", description: "...", index_set_id: "...")
   → returns { dryRun: true, preview: {...}, confirm: "<sha256-token>" }
2. create_stream(title: "service-x errors", ..., dryRun: false, confirm: "<sha256-token>")
   → returns the created stream id
```

### Blueprint: end-to-end app monitoring from one call

```text
setup_app_monitoring_stack(service_name: "service-x", ...)
  → previews a 6-step chain: stream + 2 routing rules + pipeline + 3 stages
    + dashboard + 4 widgets + alert. Apply with dryRun: false + confirm.
```

### AuthZ: grant a user view access to a stream

```text
1. get_entity_shares(entity_grn: "grn::::stream:<id>")
2. share_entity(entity_grn: "grn::::stream:<id>",
                grantee_username: "alice", capability: "view")
   → previews the merged grant set; apply with dryRun: false + confirm.
```

## Repository Layout

- `src/index.js` — MCP server entry + stdio transport
- `src/tools.js` — single source of truth for all 101 tool definitions (input schemas)
- `src/dispatch.js` — name → handler routing
- `src/tools/<domain>/` — per-domain admin tool handlers (authz, blueprints, dashboards, events, index-sets, inputs, pipelines, streams, meta, plus standalone `cluster-errors.js` and `template-mgmt.js`)
- `src/services/` — blueprint composition layer
- `src/pipeline-dsl/` — pipeline-rule DSL: function catalogue + structured-intent emitter + parse pre-flight
- `src/clustering/` — pluggable log-clustering subsystem (Drain3 strategy + per-connection template store)
- `src/graylog/` — Graylog REST client and error classes
- `src/widget-templates/` — curated dashboard widget templates
- `test/` — Node built-in test runner suite (`npm test`)
- `.planning/` — planning artifacts ([`PROJECT.md`](.planning/PROJECT.md), milestone roadmaps, codebase notes)

## Scripts

| Command | Description |
|---|---|
| `npm start` | Run the MCP server (stdio transport) |
| `npm run dev` | Run with `node --watch` for development |
| `npm test` | Run the full test suite via Node's built-in runner |
| `npm run coverage` | Run tests with `c8` coverage (text + lcov reporters) |
| `npm run audit:tool-descriptions` | Verify every entry in `src/tools.js` has a non-trivial description |

## License

MIT — see [LICENSE](LICENSE).
