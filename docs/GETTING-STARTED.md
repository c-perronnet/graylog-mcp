<!-- generated-by: gsd-doc-writer -->
# Getting Started

This guide walks a first-time user from zero to a working Graylog MCP server
wired into an MCP client (Claude Code, Cursor, Claude Desktop, etc.), with a
first successful read call against a live Graylog deployment.

If you only want the configuration reference, jump to
[`docs/CONFIGURATION.md`](CONFIGURATION.md). For the full system overview see
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md). For the full tool catalogue and
usage idioms, see the [project `README.md`](../README.md).

## Prerequisites

You need three things before installing the server.

- **Node.js `>= 22.3.0`** — enforced by the `engines.node` field in
  `package.json`. ES Modules and the built-in test runner are used directly;
  there is no build step and no transpilation.
- **A reachable Graylog `7.0.6` instance** — the single supported target
  version. The server speaks the Graylog REST API over HTTPS (or HTTP for
  local dev). You will need its base URL (for example
  `https://graylog.example.com`).
- **A Graylog API token** with at least the permissions you intend the agent
  to use. Tokens are created in Graylog under *Profile → API tokens*. The
  server sends the token as the HTTP Basic *username* with the literal string
  `token` as the password (the standard Graylog convention).

The server runs only as a short-lived stdio process spawned by your MCP
client. There is no HTTP listener to expose, no daemon to run, and no
container required.

## Installation

Clone the repository and install dependencies. There is no global install
flow — `package.json` does not declare a `bin` entry, so the server is run
either by path (`node src/index.js`) or via the `npm start` script.

```bash
git clone https://github.com/jagadeesh52423/graylog-mcp.git
cd graylog-mcp
npm install
```

That is the entire install. The `npm install` step pulls three runtime
dependencies (`@modelcontextprotocol/sdk`, `axios`, `zod`) plus dev tooling
(`c8`, `@types/node`, `typescript`). No native compilation is involved.

Note the absolute path to the cloned directory — you will need it when
wiring the server into your MCP client.

## First-Run Configuration

The server reads a single config file at `~/.graylog-mcp/config.json`. A
working starter ships in the repository at `example-config.json`.

1. Create the config directory and copy the example file:

   ```bash
   mkdir -p ~/.graylog-mcp
   cp example-config.json ~/.graylog-mcp/config.json
   chmod 600 ~/.graylog-mcp/config.json
   ```

   The `chmod 600` step matters: the file stores your API token in
   plaintext, and filesystem permissions are your only protection. (There is
   no secret-store integration and no token-refresh mechanism.)

2. Edit `~/.graylog-mcp/config.json` and replace the placeholder values with
   your real Graylog `baseUrl` and `apiToken`. The minimum viable shape is a
   single connection:

   ```json
   {
       "connections": {
           "test": {
               "baseUrl": "https://graylog.example.com",
               "apiToken": "YOUR_GRAYLOG_API_TOKEN"
           }
       }
   }
   ```

   The connection name (`"test"` above) is arbitrary — you will use it
   later with `set_active_connection`. You can define any number of named
   connections; switch between them at runtime from your MCP client.

3. (Recommended for production-shared connections.) Mark the connection
   read-only by setting `"writable": false`. The server then refuses every
   mutating tool against that connection, regardless of `dryRun`:

   ```json
   "prod": {
       "baseUrl": "https://graylog.example.com",
       "apiToken": "YOUR_GRAYLOG_API_TOKEN",
       "writable": false
   }
   ```

   Read tools and dry-run previews continue to work normally. See
   [`docs/CONFIGURATION.md`](CONFIGURATION.md#read-only-connections-writable-flag)
   for the full enforcement model.

If you want to store the config file somewhere other than
`~/.graylog-mcp/config.json`, point the `GRAYLOG_CONFIG_PATH` environment
variable at the alternate location before starting the server.

## Wire It Into Your MCP Client

The server speaks the Model Context Protocol over **stdio**. Configure your
MCP client to launch `node <absolute-path>/src/index.js` as the server
command.

The exact configuration file and key differ per client (Claude Desktop reads
`~/.config/Claude/claude_desktop_config.json` on Linux / equivalent paths on
macOS and Windows; Claude Code and Cursor have their own MCP-server
registries), but every MCP client accepts the same JSON shape:

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

Replace `/absolute/path/to/graylog-mcp` with the path where you cloned the
repository. The MCP client spawns a fresh server process per session — the
server itself does not need to be started manually.

If your client supports environment variables in the launcher config and you
want to point at a non-default config file, pass `GRAYLOG_CONFIG_PATH`:

```json
{
    "mcpServers": {
        "graylog": {
            "command": "node",
            "args": ["/absolute/path/to/graylog-mcp/src/index.js"],
            "env": {
                "GRAYLOG_CONFIG_PATH": "/etc/graylog-mcp/prod.json"
            }
        }
    }
}
```

Restart your MCP client (or its server-registry refresh action) so it
re-spawns the server with the new configuration.

<!-- VERIFY: exact MCP-server configuration file paths for Claude Code, Cursor, and Claude Desktop on each operating system. The JSON shape above is the canonical MCP shape, but each client documents its own config file location. -->

## First Call

From your MCP client (let the agent drive these, or invoke the tools
directly if your client offers a tool-call UI):

1. **Confirm the server can see your connection registry:**

   ```text
   list_connections
   ```

   You should get back the connection names you defined in
   `~/.graylog-mcp/config.json` (for example `["test"]`). If the list is
   empty, the server could not read the config file at the expected path —
   check `GRAYLOG_CONFIG_PATH` and the file permissions.

2. **Select an active connection:**

   ```text
   set_active_connection(name: "test")
   ```

   Subsequent tool calls operate against this connection until the next
   `set_active_connection` call (or until the server process restarts —
   active-connection state is not persisted).

3. **Run a small read call to verify auth and connectivity:**

   ```text
   search_messages_graylog(query: "*", timeRange: "5m", pageSize: 5)
   ```

   `query: "*"` matches everything; `timeRange: "5m"` restricts to the last
   five minutes; `pageSize: 5` keeps the response small. A successful
   response confirms the API token has at least search permissions and the
   `baseUrl` is reachable.

   If you get an HTTP `401` or `403`, the token is invalid or
   under-permissioned. If you get a network error, check `baseUrl` for typos
   and verify the Graylog instance is reachable from the machine running the
   MCP server.

## Safety Net for Mutating Calls

Every mutating tool defaults to `dryRun: true`. This is enforced once, at
the wrapper layer, and is structurally impossible to bypass by argument
omission. A dry-run call returns a preview of the exact HTTP method, path,
and body the tool *would* have sent — without touching the live Graylog
deployment.

The preview-then-apply round-trip for a destructive call looks like:

```text
1. delete_stream(stream_id: "abc123")
   → returns { dryRun: true, preview: {...}, confirmationToken: "<sha256-token>" }

2. delete_stream(stream_id: "abc123", dryRun: false, confirm: "<sha256-token>")
   → applies the change
```

The `confirmationToken` is a deterministic SHA-256 hash over the canonical
inputs of the operation. On apply, the server **re-derives** the hash
against live Graylog state and refuses if it differs (`confirmation_mismatch`)
— so a stream that changed between preview and apply is rejected, not
silently overwritten.

Combine this with `writable: false` on production-shared connections for
investigate-and-preview only by construction. See
[`docs/CONFIGURATION.md`](CONFIGURATION.md#mutation-safety-dryrun-default-and-confirmation-tokens)
for the full mutation-safety model.

## Common Setup Issues

- **`list_connections` returns an empty list.** The server could not read
  `~/.graylog-mcp/config.json`. Confirm the file exists at the expected
  path, that it is valid JSON (try `node -e "JSON.parse(require('fs').readFileSync(process.env.HOME + '/.graylog-mcp/config.json', 'utf8'))"`),
  and that the process running the MCP server can read it. If you set
  `GRAYLOG_CONFIG_PATH`, the path it points to must exist and be readable.
- **HTTP `401` / `403` on the first read call.** The API token is invalid,
  expired, or under-permissioned. Regenerate the token in Graylog under
  *Profile → API tokens* and confirm the user account has search
  permissions on the streams you want to query.
- **Network error / timeout on the first call.** Check `baseUrl` — it must
  be the bare base URL of the Graylog instance (for example
  `https://graylog.example.com`), with no trailing path. Verify the
  Graylog instance is reachable from the machine running the MCP server
  (which is wherever your MCP client runs the launcher).
- **`Connection "<name>" is marked read-only` on a mutating call.** The
  connection has `"writable": false` in its config block. This is the
  intended behaviour for production-shared connections. Either flip the
  flag to `true` (or remove it) for a non-production connection, or switch
  to a writable connection via `set_active_connection`.
- **`confirmation_mismatch` on apply.** The live Graylog state changed
  between your dry-run preview and the apply call (someone else modified
  the entity, or a previous step in your own workflow did). Re-issue the
  dry-run, inspect the new preview and `confirmationToken`, and re-apply
  with the fresh token.
- **Wrong Node.js version.** The server requires Node `>= 22.3.0`. On
  older Node versions you may see syntax errors or module-resolution
  failures at startup. Confirm with `node --version`.

## Next Steps

- **Full configuration reference:** [`docs/CONFIGURATION.md`](CONFIGURATION.md)
  — environment variables, all per-connection fields, mutation-safety
  model, read-only connections, persistent state files, and
  per-environment configuration patterns.
- **System overview:** [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — process
  layout, dispatch model, shared safety primitives, pipeline-rule DSL, and
  the log-clustering subsystem.
- **Tool catalogue and usage idioms:** [project `README.md`](../README.md)
  — the full list of 101 tools across search, clustering, inputs,
  streams, pipelines, index sets, events, dashboards, blueprints,
  AuthZ, and role management; plus end-to-end usage examples for the
  read, write, blueprint, and AuthZ workflows.
