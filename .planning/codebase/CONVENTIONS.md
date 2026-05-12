# Conventions

**Analysis Date:** 2026-05-12

## Module System

**ESM everywhere.** `package.json` declares `"type": "module"`, every source file uses `import` / `export`, no `require`. Relative imports always include the `.js` extension (`import { ... } from "./query.js"`) — required by Node ESM resolution.

Node built-ins use the `node:` prefix where used (`import { createHash } from "node:crypto"`, `import assert from "node:assert/strict"`). This is consistent in newer files (`src/clustering/*`, tests) but not strictly enforced (`src/config.js` imports `"fs"`, `"path"`, `"os"` without the prefix).

Named exports only — no default exports anywhere in the codebase.

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

`async`/`await` throughout. No callback APIs, no manual `.then()` chaining. Every tool handler is declared `async` (even ones that don't actually await — keeps the dispatcher uniform). External calls (axios) are wrapped in `try`/`catch`; the catch path always returns a `{ isError: true, content: [...] }` MCP response rather than rethrowing past the handler boundary.

## Error Handling Pattern

The codebase uses a single canonical MCP error shape:

```js
return {
    isError: true,
    content: [{ type: "text", text: `Error <doing X>: ${err.message}` }],
};
```

Several modules define a local `errorResponse(text)` helper for this shape (`src/tools/cluster-errors.js:12`, `src/tools/template-mgmt.js:4`).

**Two distinct error styles:**
- **Hard error to the MCP client** → return the `isError: true` object above. Used for missing-connection, invalid-input, all caught exceptions.
- **Soft fallback / log-and-continue** → `console.error("[subsystem] message")` and move on. Used for histogram approach failures (`src/index.js:463`), template-store write failures (`src/tools/cluster-errors.js:152`), stale-lock breaking (`src/clustering/template-store.js:58`), corrupt store version mismatch (`src/clustering/template-store.js:35`).

Throwing only happens deep in helpers (`searchGraylog` re-throws axios errors after logging context — `src/query.js:121`). Handlers always catch.

## Validation

`zod` is a declared dependency but **not used** in the source — the `import` doesn't appear in any `src/` file. Validation is ad-hoc inline checks (`if (!args.templateId) return errorResponse("templateId is required")`), or driven by the JSON-Schema declared in `src/tools.js` (which the MCP SDK validates client-side).

Time-range parsing is the one place with strict validation: `parseRelativeTime` throws on invalid format or negative values, `buildTimeRange` throws if `to < from` (covered by tests in `test-features.js`).

## Connection Resolution Pattern

Every tool that needs to call Graylog uses the same idiom:

```js
const { conn, error } = requireActiveConnection();
if (error) return error;
// ...use conn.baseUrl / conn.apiToken...
```

`requireActiveConnection` is defined in `src/index.js:160` and returns either `{ conn }` or `{ error: <isError-shaped object> }`. Extracted-handler files (`src/tools/cluster-errors.js`, `src/tools/template-mgmt.js`) inline an equivalent check via `getActiveConnectionConfig()` since they can't import `requireActiveConnection` from `index.js` without a cycle.

## Tool Handler Shape

The recurring shape across `src/index.js`:

```js
async function someTool(request) {
    const { conn, error } = requireActiveConnection();
    if (error) return error;

    const args = request.params.arguments || {};
    const { timeRange } = normalizeTimeRangeArgs(args);
    const queryString = buildQueryString(args.query, args.filters, args.exactMatch ?? true);
    // ... build Graylog payload ...

    try {
        const data = await searchGraylog(conn.baseUrl, conn.apiToken, payload);
        // shape result
        return { content: [{ type: "text", text: JSON.stringify({ ... }) }] };
    } catch (err) {
        return { isError: true, content: [{ type: "text", text: `Error ...: ${err.message}` }] };
    }
}
```

Response bodies are JSON-stringified text — never structured MCP content blocks beyond `{type:"text"}`.

## Default Arguments

Defaults are applied at call sites with `??`, not via JSON-Schema defaults:

```js
const pageSize = args.pageSize ?? 50;
const sampleSize = args.sampleSize ?? 1000;
const exactMatch = args.exactMatch ?? true;
```

This means schema-level defaults in `src/tools.js` are documentation only.

## Comments

Sparse and intentional. JSDoc blocks appear only in `src/aggregations.js` (the four payload-builder functions document their args). The rest of the codebase favors short one-line `//` comments that explain a constraint or invariant, not what the code does:

- `src/clustering/strategies/drain3.js:4` — "implement the strategy contract to add a new clustering algorithm; register in src/clustering/index.js"
- `src/clustering/strategies/drain3.js:27` — multi-line comment explaining state shape and the rationale for linear scan vs prefix-tree
- `src/query.js:28` — "MCP clients may pass arrays as JSON strings"

There are zero TODO/FIXME/HACK/XXX markers in `src/`. Surprising for a project at v2.3 — interpret as "the code is the spec" rather than as completeness.

## Linter / Formatter

**None configured.** No `.eslintrc`, no `prettier` config, no `tsconfig.json` even though `typescript` is a devDependency. Indentation is 4 spaces, single statements per line, semicolons present. Style is consistent by habit, not enforcement.

## Imports Layout

Imports cluster at the top of each file, sorted loosely by:
1. Node built-ins
2. Third-party packages
3. Local modules (relative paths)

No alphabetization, no blank-line separation between groups in most files. `src/index.js:1-23` is the largest import block — a single contiguous wall of locals.

## Persistent-state Idioms

Both stateful modules (`src/saved-searches.js`, `src/clustering/template-store.js`) follow the same shape:
- Version field at the top of the JSON document (`STORE_VERSION = 1`)
- Per-connection file under `~/.graylog-mcp/` (path derived from `getConfigPath()`)
- Atomic write via `writeFileSync(tmp)` + `renameSync(tmp, final)`
- The clustering store additionally takes a file lock (`.lock`) with a 30-second stale break

Version mismatches log and return an empty store rather than throwing — bias toward keep-running.

## Test Hooks

Production modules expose explicit underscore-prefixed seams when tests need to inject state:
- `_clearForTests()` resets the clustering strategy registry (`src/clustering/index.js:27`)
- `_getSearchOverride()` / `_setSearchOverride()` let tests bypass axios (`src/clustering/_test_hooks.js`)
- `_withStorePathOverride()` redirects the template-store path (`src/clustering/template-store.js:12`)
- `_testConnection` is a magic arg name (`src/tools/cluster-errors.js:20`, `src/tools/template-mgmt.js:9`) that swaps in a fake connection

These are deliberate, not accidental, and are the only "private" surface in the project.
