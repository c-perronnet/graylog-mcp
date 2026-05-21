<!-- generated-by: gsd-doc-writer -->
# Development

Audience: developers extending the Graylog MCP server — adding a new tool, fixing a
bug in an existing handler, or modifying a domain (inputs, streams, pipelines,
dashboards, events, index-sets, authz, blueprints).

This document covers the day-to-day dev loop, code organization, the canonical
"add a new tool" walkthrough, the mutating-tool safety checklist, and project
conventions. For the full system architecture see [ARCHITECTURE.md](./ARCHITECTURE.md).
For runtime configuration see [CONFIGURATION.md](./CONFIGURATION.md).

## Local setup

```bash
git clone https://github.com/c-perronnet/graylog-mcp.git
cd graylog-mcp
npm install
```

The server reads connections from `~/.graylog-mcp/config.json` (or the path in
`GRAYLOG_CONFIG_PATH`). For local development against a real Graylog instance
see [CONFIGURATION.md](./CONFIGURATION.md). For offline test runs you don't need
a config file — tests drive handlers through the `_testConnection` magic arg and
the `_setCaptureRequest` HTTP seam (see [Testing](#testing) below).

There is no build step. ESM is enabled via `"type": "module"` in `package.json`;
TypeScript is a devDependency only (used for type checks, not runtime).

## Dev loop

| Command | What it does |
|---|---|
| `npm start` | Run the MCP server (`node src/index.js`) — production mode. |
| `npm run dev` | Run with `node --watch src/index.js` — restarts on source edits. |
| `npm test` | Run the full test suite (`node --test 'test/**/*.test.js'`). |
| `npm run coverage` | Run tests with `c8` coverage (text + lcov + text-summary reporters). |
| `npm run audit:tool-descriptions` | Static check on `src/tools.js` descriptions — enforces ≤200 chars and discrimination phrasing (`scripts/audit-tool-descriptions.js`). |

`npm test` MUST be green before opening a PR. The audit:tool-descriptions check
also runs in the test harness via `test/tool-description-audit.test.js`.

## Code organization

For a system-level view of how MCP requests flow through the layers and how
domains compose, read [ARCHITECTURE.md](./ARCHITECTURE.md). This section is a
file-map for contributors.

```
src/
├── index.js            MCP server bootstrap + stdio transport
├── tools.js            Tool catalogue (JSON Schema input shapes)
│                       Single source of truth for the MCP `tools/list` advertisement
├── dispatch.js         Name → handler Map; assertAllToolsRegistered fail-fast
├── handlers.js         v2.3 legacy handlers (search, histograms, saved-searches)
├── config.js           Connection registry; getActiveConnectionConfig
├── query.js            Graylog Universal Search client + buildQueryString
├── timerange.js        Relative / absolute time-range parsing
├── aggregations.js     Histogram + pivot payload builders
├── events.js           Graylog events API wrapper
├── saved-searches.js   ~/.graylog-mcp/saved-searches.json CRUD
├── graylog/            HTTP client + typed-error classes
│   ├── client.js       makeClient(conn) — axios wrapper; _setCaptureRequest seam
│   └── errors.js       GraylogError, GraylogValidationError, GraylogPermissionError, ...
├── tools/
│   ├── _register.js    Side-effect barrel — wires every handler into dispatch
│   ├── _shared/        Cross-cutting factories + helpers (see below)
│   ├── <domain>/       Per-domain handlers (authz, blueprints, dashboards,
│   │                   events, index-sets, inputs, meta, pipelines, streams)
│   ├── cluster-errors.js  Drain3 log-clustering tool
│   └── template-mgmt.js   Template CRUD tools
├── services/           Higher-level Graylog API service wrappers
├── clustering/         Drain3 strategy + template store
├── pipeline-dsl/       Pipeline-rule DSL parser
└── widget-templates/   Dashboard widget template library
```

New admin tools go under `src/tools/<domain>/` — NOT inline in `src/index.js`.
The `cluster-errors.js` and `template-mgmt.js` files are the legacy precedent
for the per-domain pattern.

### src/tools/_shared/ — composition primitives

Read these before adding a new tool. Every mutating tool composes through
`handler.js`; every list tool composes through `list.js`.

| File | Exports | Purpose |
|---|---|---|
| `handler.js` | `defineMutatingHandler({ name, schema, build, apply, summarize?, requireConfirm? })` | Canonical factory for mutating tools. Owns `dryRun:true` default, zod validation, connection resolution, writable-flag short-circuit, idempotency-key derivation, build/apply split, `__SERVER_ASSIGNED__` sentinel, typed-error wrapping. |
| `list.js` | `defineListHandler({ name, schema, fetch, defaultFields? })` | Factory for list tools. Default projection `[id, title, description]`, default limit 25, hard cap 200, `fields: "all"` opt-in. |
| `connection.js` | `resolveConnection(args)` | Resolves singleton OR per-call `connectionName`; reads `_testConnection` seam in tests. |
| `cascade-hash.js` | `computeC1Hash`, `computeCascadeHash`, `computeShareGrantHash`, `computeRoleCascadeHash`, ... | Pure sha-256 confirmation-token helpers. Each destructive-cascade tool pins its own canonicalization shape. |
| `idempotency.js` | `deriveIdempotencyKey` | Auto-derived idempotency key (FOUND-10). Agent-supplied `idempotencyKey` wins. |
| `errors.js` | `errorResponse`, `wrapGraylogError`, `formatZodError` | MCP error envelope constructors. |
| `dry-run.js` | `SERVER_ASSIGNED_SENTINEL` | Sentinel for `postApplyEstimate.id` when Graylog assigns the id server-side. |
| `schemas.js` | `mutatingBase`, `listBase` | Zod base schemas every per-domain schema extends. |
| `blueprint-chain.js` | `executeChain` | Multi-step blueprint apply driver. |
| `system-job.js` | helpers for the `await_system_job` polling primitive. |
| `conflict.js`, `widget-position-integrity.js` | Per-feature helpers consumed by specific handlers. |

### Tests

- `test/<domain>.test.js` — one file per logical surface (e.g. `test/streams.test.js`,
  `test/authz-share-entity.test.js`).
- `test/fixtures/` — JSON fixtures captured from a live Graylog 7.0.6 (e.g.
  `test/fixtures/authz/prepare-response-7.0.6.json`).
- `test/*-live.smoke.js` — live-smoke tests that hit a real Graylog instance;
  named `*.smoke.js` so the default `'**/*.test.js'` glob does NOT pick them up.
- `test/snapshot-config.js` — shared snapshot harness configuration.
- `test/snapshots/`, `test/__snapshots__/` — committed snapshot outputs.

All test code uses `node:test` (the built-in test runner) and `node:assert/strict`.
No Jest, Mocha, Vitest, or other framework is in use.

## Adding a new tool

Follow this order. The dispatch-assertion test will fail loudly if any step is
skipped.

### 1. Define the zod schema

Add to `src/tools/<domain>/schemas.js` (or create the file if this is a new
domain). Extend `mutatingBase` for mutating tools, `listBase` for list tools.

```javascript
// src/tools/widgets/schemas.js
import { z } from "zod";
import { mutatingBase } from "../_shared/schemas.js";

export const CreateWidgetSchema = mutatingBase.extend({
    dashboardId: z.string().min(1),
    title: z.string().min(1).max(200),
    // ...
}).strict();
```

`.strict()` is recommended for new schemas — it rejects unknown keys at parse
time. The framework strips `_testConnection` before parsing so `.strict()` does
not break the test seam (see `handler.js` step 1 comment).

### 2. Write the handler file

Compose `defineMutatingHandler` (mutating) or `defineListHandler` (read). The
canonical mutating example is `src/tools/authz/share-entity.js`; the canonical
list example is `src/tools/authz/list-roles.js` (plain-async variant) or any
factory-based list tool in `src/tools/streams/`.

```javascript
// src/tools/widgets/create-widget.js
import { defineMutatingHandler } from "../_shared/handler.js";
import { CreateWidgetSchema } from "./schemas.js";

export const handleCreateWidget = defineMutatingHandler({
    name: "create_widget",
    schema: CreateWidgetSchema,
    async build(args) {
        // pure: return { method, path, body, postApplyEstimate?, normalize?, ... }
        return {
            method: "POST",
            path: `/api/dashboards/${args.dashboardId}/widgets`,
            body: { title: args.title /* ... */ },
        };
    },
    apply: async (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) => `Add widget "${args.title}" to dashboard ${args.dashboardId}`,
});
```

`build()` MUST be pure and may be async (e.g. to pre-flight a GET inside build
for drift detection). The wrapper guarantees the dry-run preview body is byte-
identical to the apply body.

### 3. Wire it in the domain barrel

```javascript
// src/tools/widgets/index.js
import { register } from "../../dispatch.js";
import { handleCreateWidget } from "./create-widget.js";

register("create_widget", handleCreateWidget);
```

If the domain barrel does not exist yet, add an `import "./widgets/index.js";`
line to `src/tools/_register.js`.

### 4. Register the catalogue entry in src/tools.js

```javascript
{
    name: "create_widget",
    description: "Create a dashboard widget. Use this rather than update_dashboard when adding a single widget.",
    inputSchema: { /* JSON Schema mirroring the zod schema */ },
}
```

Description rules (enforced by `npm run audit:tool-descriptions`):
- ≤200 characters
- Either two sentences OR a comparative phrase (`vs.`, `rather than`, `instead of`,
  `use this when`, …) so the agent can discriminate between sibling tools

### 5. Update the dispatch-count assertions

The tool inventory count is pinned in three places. Bump them together:

- `test/list-admin-tools.test.js` — `expected 101 tools` → `102`
- `test/pipelines.test.js` — `count = 101` → `102`
- `test/dashboards.test.js` — `count = 101` → `102`

`assertAllToolsRegistered(toolDefinitions)` runs at server startup
(`src/index.js`) and in the dispatch tests. Any tool listed in `src/tools.js`
without a matching `register()` call throws a hard error.

### 6. Add tests

Create or extend `test/<domain>.test.js`. The standard offline shape:

```javascript
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { _setCaptureRequest, _clearCaptureRequest } from "../src/graylog/client.js";
import { _clearConnectionsForTests, setActiveConnection } from "../src/config.js";
import { handleCreateWidget } from "../src/tools/widgets/create-widget.js";

beforeEach(() => { _clearConnectionsForTests(); setActiveConnection(null); });
afterEach(() => { _clearCaptureRequest(); _clearConnectionsForTests(); setActiveConnection(null); });

test("create_widget dry-run emits the expected POST body", async () => {
    _setCaptureRequest(() => ({ /* canned Graylog response */ }));
    const res = await handleCreateWidget({
        params: {
            arguments: {
                _testConnection: "fake",
                dashboardId: "d1",
                title: "CPU",
                // dryRun defaults to true
            },
        },
    });
    assert.ok(!res.isError);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.preview.method, "POST");
});
```

Two test seams are project-standard:

- `_testConnection: "fake"` — magic arg consumed by `resolveConnection`. Bypasses
  the on-disk connection registry. Stripped before zod parse so `.strict()`
  schemas don't reject it.
- `_setCaptureRequest(fn)` — intercepts every `graylog/client.js` HTTP call
  before axios. Return the canned response to drive `build()`/`apply()` offline.
  ALWAYS call `_clearCaptureRequest()` in `afterEach` — a leftover seam silently
  disables HTTP in later test files.

For live integration coverage, add a `*-live.smoke.js` file (see
`test/authz-share-entity-live.smoke.js` for the pattern). The default test glob
excludes `.smoke.js` files; run them explicitly when verifying against a real
Graylog.

## Mutating-tool checklist

Every mutating tool MUST honour these invariants. `defineMutatingHandler`
enforces them by construction — do NOT bypass the factory.

- [ ] `dryRun: true` is the default. Applying requires the caller to pass
      `dryRun: false` explicitly. (Enforced in `handler.js` step 6:
      `const dryRun = args.dryRun ?? true;`.)
- [ ] Destructive cascades emit a sha-256 `confirmationToken` from `build()`
      via the appropriate `compute*Hash` helper in
      `src/tools/_shared/cascade-hash.js`. Set `req._confirmationToken` and
      a `requireConfirm: ({ req }) => req._confirmationToken ?? null` callback.
- [ ] Drift refusal: `build()` runs UNCONDITIONALLY on both dry-run and apply.
      The apply-time re-prepare must recompute the token from fresh server
      state; if it differs from the agent's echoed `confirm`, the wrapper
      returns `reason: "confirmation_mismatch"`.
- [ ] Read-only connections short-circuit BEFORE `build()` runs. The wrapper
      handles this automatically when `conn.writable === false`, returning
      `reason: "connection_read_only"`. (Defense-in-depth: `src/graylog/client.js`
      also refuses non-GET against read-only connections.)
- [ ] Errors raised inside `build()` or `apply()` are tagged with a
      programmatic `reason` via `tagError(err, "reason_name", status)`. The
      vocabulary is per-domain (see `share-entity.js` for examples:
      `not_currently_granted`, `would_leave_entity_ownerless`,
      `username_not_found`, `apply_inconclusive`, …). Untyped exceptions from
      apply-time HTTP (e.g. ECONNRESET) should be tagged `apply_inconclusive`
      so the agent knows to re-read before retrying.
- [ ] `build()` is pure (apart from optional read-only pre-flight GETs for
      drift detection). The same descriptor that produced the dry-run preview
      MUST be the descriptor passed to `apply()`.

## Conventions

From `CLAUDE.md`:

- ESM only. Node.js `>= 22.3.0` (see `package.json` `engines`). TypeScript is
  type-check / IDE-support only; no runtime TS.
- File names: kebab-case (`cluster-errors.js`, `template-store.js`,
  `share-entity.js`).
- Function names: camelCase (`buildQueryString`, `normalizeMessage`).
- MCP tool handler functions: `handle*` prefix (`handleClusterLogMessages`,
  `handleShareEntity`).
- Payload / request builders: `build*` prefix (`buildTimeHistogram`,
  `buildStreamFilter`).
- Module constants: SCREAMING_SNAKE_CASE (`STORE_VERSION`, `MAX_SAMPLE`,
  `DEFAULT_LIMIT`, `MAX_LIMIT`).
- MCP tool names (registered in `src/tools.js` and `dispatch`): snake_case
  (`fetch_graylog_messages`, `share_entity`, `list_roles`). Follows the
  `<verb>_<domain>_<noun>` convention introduced in Plan 00-05.
- Test-only / private helpers: leading underscore (`_clearForTests`,
  `_testConnection`, `_storePathForTests`, `_setCaptureRequest`).
- Error handling: a hard error to the MCP client returns
  `{ isError: true, content: [...] }`; soft fallbacks use `console.error("[subsystem] message")`
  and continue.

### Linter / formatter

No ESLint, Prettier, or Biome config is committed. Match the existing style of
neighbouring files (4-space indent, double-quoted strings, trailing commas in
multi-line literals).

### Dependencies

The runtime dep list is intentionally minimal: `@modelcontextprotocol/sdk`,
`axios`, `zod`. Do NOT add new runtime dependencies without explicit need —
adopt `zod` (already present) for any new input-validation work rather than
pulling in an alternative.

## Pre-commit checklist

Before opening a PR:

1. `npm test` — full suite green.
2. `npm run audit:tool-descriptions` — only relevant if you touched
   `src/tools.js`. Also re-checked by `test/tool-description-audit.test.js`.
3. No new runtime `dependencies` entries in `package.json` unless explicitly
   justified in the PR description.
4. New mutating tools: verify the [Mutating-tool checklist](#mutating-tool-checklist)
   point-by-point.
5. New tools: confirm the three count-bump assertions
   (`list-admin-tools.test.js`, `pipelines.test.js`, `dashboards.test.js`)
   are updated.

## PR / branch flow

This repository does not have a committed `CONTRIBUTING.md` or
`.github/PULL_REQUEST_TEMPLATE.md`. Until one is added, follow the project
conventions documented in `CLAUDE.md`:

- Use the GSD workflow entry points (`/gsd-quick`, `/gsd-debug`,
  `/gsd-execute-phase`) for any non-trivial change so planning artefacts stay
  in sync with the codebase.
- Open PRs against the `main` branch.
- Reference the relevant Plan / Phase number in commit messages when the work
  is part of a planned phase (existing commit history is the pattern).
