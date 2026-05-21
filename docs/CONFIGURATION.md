<!-- generated-by: gsd-doc-writer -->
# Configuration

The Graylog MCP server has a small, file-driven configuration surface. There is
one config file (a registry of named Graylog connections), one environment
variable, and a handful of per-connection settings that gate write access and
default behaviour. There is no build step, no `.env` file, and no deploy-time
configuration.

This document covers every configurable surface a user or integrator touches.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GRAYLOG_CONFIG_PATH` | Optional | `~/.graylog-mcp/config.json` | Absolute or relative path to an alternate connection-registry JSON file. Resolved once at process start (`src/config.js:8`). |

That is the entire environment surface. No other variables are read by the
server.

## Config File Format

The config file is a single JSON document. Its only required top-level key is
`connections` — a map of human-friendly connection names to per-connection
settings.

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
    },
    "defaultFields": ["timestamp", "message", "level"]
}
```

A working example ships with the repository at `example-config.json` — copy it
to `~/.graylog-mcp/config.json` (or to the path you set in
`GRAYLOG_CONFIG_PATH`) and edit the values.

If the config file is missing or unreadable, the server starts with an empty
connections registry (`src/config.js:10-18`). No error is thrown at startup;
the first call to a tool that requires an active connection will surface a
missing-connection error to the MCP client.

### Per-connection fields

| Field | Required | Default | Description |
|---|---|---|---|
| `baseUrl` | Required | — | Base URL of the Graylog REST API (e.g. `https://graylog.example.com`). All HTTP calls are issued as `${baseUrl}${path}` by `makeClient(conn)` in `src/graylog/client.js`. |
| `apiToken` | Required | — | Graylog API token. Sent as the HTTP Basic username; the password is the literal string `token` (see `src/graylog/auth.js`). |
| `writable` | Optional | `true` | When set to `false`, every mutating tool short-circuits with `reason: connection_read_only` before its request descriptor is built. Recommended for production-shared connections to enforce dry-run-only operation. See [Read-only connections](#read-only-connections-writable-flag). |
| `defaultFields` | Optional | — | Per-connection override of the message-field projection used by read tools. Wins over the top-level `defaultFields`. |

### Top-level optional fields

| Field | Required | Default | Description |
|---|---|---|---|
| `defaultFields` | Optional | All fields (`*`) | Array of field names returned by read tools when no per-call `fields` argument is given. Used as a fallback when the active connection has no per-connection `defaultFields` (`src/config.js:34-46`). |

## Multi-Connection Support

The server is multi-tenant by design: any number of named connections can live
side-by-side in the registry, and the MCP client switches between them at
runtime.

Two MCP tools manage connection selection:

- `list_connections` — lists every connection name defined in the config file.
- `set_active_connection` — selects one of those names as the active
  connection. Subsequent tool calls operate against that connection until the
  next `set_active_connection` call (or until the server process restarts).

The active connection is held in a module-level variable inside `src/config.js`
and is **not** persisted across server restarts — each new server process
starts with no active connection.

Most mutating tools also accept a per-call `connectionName` override so a
single MCP session can fan out across connections without having to flip the
global active-connection state.

## Authentication

Authentication is handled per-connection. The server has no global credentials
and no separate auth configuration.

- Mechanism: HTTP Basic.
- Username: the connection's `apiToken` value.
- Password: the literal string `token`.

This is the long-form documented Graylog convention for API-token auth and is
implemented in `src/graylog/auth.js`. The token is never refreshed; long-lived
tokens are expected. Token strings live in plaintext inside the config file —
file-system permissions on `~/.graylog-mcp/config.json` are your only
protection. Insufficient Graylog-side permissions on a token surface as
upstream `403` errors.

## Mutation Safety: `dryRun` Default and Confirmation Tokens

Every mutating tool defaults to `dryRun: true`. This is enforced once, at the
wrapper layer (`src/tools/_shared/handler.js:134`):

```js
const dryRun = args.dryRun ?? true; // default-true enforced ONCE, here
```

A `dryRun: true` call returns a preview payload — the exact HTTP method, path,
and body that *would* have been sent — without ever touching the live Graylog
deployment. To actually apply the change, the client must re-invoke the tool
with `dryRun: false`.

### Destructive operations: `confirmationToken` round-trip

Destructive mutations layer a second gate on top of `dryRun: false`. A
destructive tool (for example `delete_index_set` with `deleteIndices: true`)
returns a `confirmationToken` field in its dry-run preview. To apply, the
client must echo that token back as the `confirm` argument
(`src/tools/_shared/handler.js:213-239`):

- `confirm` matches → the tool applies.
- `confirm` missing or mismatched → the tool returns `isError: true` with
  `reason: "confirmation_mismatch"` and the apply step never runs.

The token is a deterministic SHA-256 hash of the canonical inputs of the
operation (cascade IDs, index names, role members, etc. — see
`src/tools/_shared/cascade-hash.js`). Because the same inputs always hash to
the same token, a stable preview-then-apply round-trip just works.

### Drift refusal

The hash is recomputed on apply against the live Graylog state. If the world
has changed between the dry-run preview and the apply call — a new index was
added to the index set, a member was added to a role, a permission grant
shifted — the recomputed hash differs from the token the client supplies, and
the apply is refused. This is the same `confirmation_mismatch` error path; the
agent must re-issue the dry-run, inspect the new preview, and re-apply with
the fresh token.

## Read-Only Connections (`writable` Flag)

A per-connection `writable: false` flag turns a connection into a read-only
target with two layers of enforcement:

1. **Wrapper-layer short-circuit** (`src/tools/_shared/handler.js:97-106`):
   every mutating tool refuses the call **before** building its request
   descriptor, returning:
   ```json
   {
       "isError": true,
       "reason": "connection_read_only",
       "content": [{
           "type": "text",
           "text": "Connection \"prod\" is marked read-only (writable: false). Refusing <tool_name>."
       }]
   }
   ```
2. **HTTP-client defense in depth** (`src/graylog/client.js:36-41`): even if a
   future code path bypasses the wrapper, the HTTP client itself refuses any
   non-`GET` request against a connection marked `writable: false`.

Read tools and dry-run previews continue to work normally against a read-only
connection. Use this flag for production-shared connections where you want the
agent to be able to investigate and produce previews but never apply.

When `writable` is absent, it defaults to `true` (backward compatible with all
existing configs).

## Persistent State Files

The server writes a small number of state files under the same directory as
the config file (`dirname(configPath)`, which defaults to `~/.graylog-mcp/`):

| Path | Purpose | Lifecycle |
|---|---|---|
| `~/.graylog-mcp/config.json` | Connection registry. User-managed. | Read once at startup. Never written by the server. |
| `~/.graylog-mcp/saved-searches.json` | Named query parameters saved via the `save_search` MCP tool. | Auto-created on first save (`src/saved-searches.js`). Atomic write via JSON serialization. |
| `~/.graylog-mcp/templates/<connection>.json` | Per-connection log-clustering templates and Drain3 algorithm state. | Auto-created on first `cluster_log_messages` call (`src/clustering/template-store.js`). Atomic write via `writeFile(tmp)` + `rename(tmp, final)` and a `.lock` file with a 30-second stale-break window. |

All three honour `GRAYLOG_CONFIG_PATH` — change that variable and every state
file moves with it. No state is shared across server processes beyond what is
persisted to these files.

## Required vs Optional Settings

The only hard requirement is a config file containing at least one connection
with both `baseUrl` and `apiToken`. Everything else has a working default:

- **Hard required (per connection):** `baseUrl`, `apiToken`. Without these the
  HTTP client cannot reach Graylog or authenticate. There is no startup
  validation — the failure surfaces as an HTTP error on the first tool call.
- **Optional with defaults:**
  - `writable` → `true`
  - `defaultFields` (per-connection or top-level) → `*` (all fields)
  - `GRAYLOG_CONFIG_PATH` → `~/.graylog-mcp/config.json`
- **No active connection at startup:** the server starts with no active
  connection. The first mutating or read tool call requires either a prior
  `set_active_connection` call or a per-call `connectionName` argument.

## Per-Environment Configuration

The recommended pattern for distinguishing environments (development, staging,
production) is to define them as **separate named connections in a single
config file** and switch with `set_active_connection`:

```json
{
    "connections": {
        "dev":        { "baseUrl": "http://localhost:9000",                "apiToken": "..." },
        "staging":    { "baseUrl": "https://staging.graylog.example.com",  "apiToken": "..." },
        "production": { "baseUrl": "https://graylog.example.com",          "apiToken": "...", "writable": false }
    }
}
```

This avoids juggling multiple config files and lets a single MCP session
investigate across environments. Combine `writable: false` on production
connections with the dry-run default to make the production surface
investigate-and-preview only by construction.

If you do need fully separate config files (for example to isolate credential
files per machine), point `GRAYLOG_CONFIG_PATH` at the file you want to load
before starting the server:

```bash
GRAYLOG_CONFIG_PATH=/etc/graylog-mcp/prod.json npm start
```

## Runtime

- Node.js `>= 22.3.0` (`package.json` `engines.node`).
- ES Modules (`"type": "module"`). No build step, no transpilation.
- MCP client integration: the server speaks the Model Context Protocol over
  **stdio**. Connect it from your MCP client (Claude Desktop, Cursor, Claude
  Code, etc.) by configuring the launcher to run `node src/index.js` from the
  project root.

There is no deploy-time configuration, no HTTP listener to expose, no
`.env` file to manage, and no secret-store integration. The server is a
short-lived stdio process spawned by the MCP client; configuration is
re-read every time the client spawns a new server process.

## See Also

- `example-config.json` — copy-and-edit starter config.
- `src/config.js` — config loader and active-connection state.
- `src/graylog/auth.js`, `src/graylog/client.js` — auth model and HTTP layer.
- `src/tools/_shared/handler.js` — `dryRun` default, writable gate, and
  confirmation-token enforcement.
- `src/tools/_shared/cascade-hash.js` — confirmation-token hashing and the
  drift-refusal canonical-input shape.
