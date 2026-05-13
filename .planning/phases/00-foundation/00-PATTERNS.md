# Phase 0: Foundation - Pattern Map

**Mapped:** 2026-05-13
**Files analyzed:** 28 (12 new src/ files + 16 new test/ files + 4 modified files)
**Analogs found:** 23 / 28

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| `src/dispatch.js` | registry + router | request-response | `src/clustering/index.js` | role-match |
| `src/graylog/client.js` | HTTP client | request-response | `src/query.js:99-123` | exact |
| `src/graylog/auth.js` | utility | transform | `src/query.js:86-96` (fetchStreams auth) | partial |
| `src/graylog/errors.js` | utility | transform | `src/tools/cluster-errors.js:12-14` (errorResponse) | partial |
| `src/graylog/normalize.js` | utility | transform | none | none |
| `src/tools/_shared/handler.js` | handler factory | request-response | `src/tools/cluster-errors.js:16-174` | role-match |
| `src/tools/_shared/list.js` | handler factory | request-response | `src/tools/template-mgmt.js:18-44` | role-match |
| `src/tools/_shared/connection.js` | utility | request-response | `src/tools/template-mgmt.js:8-16` (resolveConnection) | exact |
| `src/tools/_shared/dry-run.js` | utility | transform | none (new primitive) | none |
| `src/tools/_shared/idempotency.js` | utility | transform | `src/clustering/strategies/drain3.js:7-8` (sha hash) | partial |
| `src/tools/_shared/conflict.js` | utility | transform | none | none |
| `src/tools/_shared/errors.js` | utility | transform | `src/tools/cluster-errors.js:12-14` | exact |
| `src/tools/_shared/schemas.js` | config | transform | none (first zod usage) | none |
| `src/config.js` (modified) | config | CRUD | `src/config.js` (self) | self |
| `src/index.js` (modified) | entrypoint | request-response | `src/index.js` (self) | self |
| `src/tools.js` (modified) | config | — | `src/tools.js` (self) | self |
| `package.json` (modified) | config | — | `package.json` (self) | self |
| `test/dispatch.test.js` | test | request-response | `test-clustering.js:36-60` (registry tests) | role-match |
| `test/handler.test.js` | test | request-response | `test-clustering.js` (assert style) | role-match |
| `test/list.test.js` | test | request-response | `test-clustering.js` (assert style) | role-match |
| `test/graylog-client.test.js` | test | request-response | `test-clustering.js` (assert style) | role-match |
| `test/normalize.test.js` | test | transform | `test-clustering.js` (assert style) | role-match |
| `test/idempotency.test.js` | test | transform | `test-clustering.js:1-34` (unit assertions) | role-match |
| `test/connection.test.js` | test | request-response | `test-clustering.js:37-60` (registry/seam) | role-match |
| `test/auth-redaction.test.js` | test | transform | `test-clustering.js` (assert style) | role-match |
| `test/schema-parity.test.js` | test | — | `test-clustering.js` (assert style) | role-match |
| `test/regression/read-tools.test.js` | test | request-response | `test-clustering.js:46-70` (_setSearchOverride) | partial |
| `test/__snapshots__/.gitkeep` | config | — | none | none |
| `test/snapshot-config.js` | config | — | none | none |
| `test/existing/clustering-preprocess.test.js` | test | transform | `test-clustering.js:1-34` | exact |
| `test/existing/clustering-strategy.test.js` | test | transform | `test-clustering.js:36-99` | exact |
| `test/existing/template-store.test.js` | test | file-I/O | `test-clustering.js:101-137` | exact |
| `test/existing/template-mgmt.test.js` | test | request-response | `test-clustering.js:139+` | exact |
| `test/existing/features.test.js` | test | transform | `test-features.js` | exact |
| `test/existing/aggregation-fixes.test.js` | test | transform | `test-aggregation-fixes.js` | exact |
| `test/existing/histogram-fixes.test.js` | test | transform | `test-histogram-fixes.js` | exact |

---

## Pattern Assignments

### `src/dispatch.js` (registry + router, request-response)

**Analog:** `src/clustering/index.js`

**Core Map-registry pattern** (`src/clustering/index.js:1-29`):
```js
const strategies = new Map();

export function register(name, strategy) {
    if (strategies.has(name)) {
        throw new Error(`Strategy "${name}" already registered`);
    }
    // ...optional contract validation...
    strategies.set(name, strategy);
}

export function get(name) {
    if (!strategies.has(name)) {
        throw new Error(
            `Unknown clustering algorithm "${name}". Registered: ${list().join(", ") || "none"}`
        );
    }
    return strategies.get(name);
}

// Test-only: reset registry between unit tests
export function _clearForTests() {
    strategies.clear();
}
```

**What is the same:** Map, duplicate-guard on `register`, explicit `.has()` check on lookup, `_clearForTests()` test seam.

**What is different:** The dispatch version adds an `assertAllToolsRegistered(toolDefinitions)` startup assertion that checks every entry in `toolDefinitions` has a registered handler (throws an `Error` per Discretion-06 — hard throw at startup, not a log). The `dispatch(request)` function extracts `request.params?.name`, looks it up, and calls it. There is no `list()` equivalent needed. The exported error message must match the existing `src/index.js:103` text `Tool not found: ${name}` exactly so no observable behavior changes.

**Test seam:** `_clearForTests()` follows the exact pattern from the analog — module-level `_` prefix, no apology.

**Cross-reference:** `src/index.js:38-104` (the dispatch chain being replaced); `src/tools.js` (tool catalogue used by `assertAllToolsRegistered`).

---

### `src/graylog/client.js` (HTTP client, request-response)

**Analog:** `src/query.js:99-123` (`searchGraylog`) and `src/query.js:85-96` (`fetchStreams`)

**Imports pattern** (`src/query.js:1`):
```js
import axios from "axios";
```

**Auth + headers pattern** (`src/query.js:99-112`):
```js
export async function searchGraylog(baseUrl, apiToken, payload) {
    try {
        const response = await axios.post(`${baseUrl}/api/views/search/sync`, payload, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Requested-By': 'graylog-mcp',
            },
            auth: {
                username: apiToken,
                password: 'token',
            },
        });
        return response.data;
    } catch (error) {
        console.error('Graylog API Error:', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            request_payload: JSON.stringify(payload, null, 2)
        });
        throw error;
    }
}
```

**What is the same:** `axios`, exact header set (`Accept`, `Content-Type`, `X-Requested-By: graylog-mcp`), Basic-auth shape `{ username: apiToken, password: 'token' }`, `response.data` return.

**What is different:** `client.js` generalises over method (`GET`/`POST`/`PUT`/`DELETE`) and path (not hardcoded), uses `validateStatus: () => true` to own error-status classification (delegating to `errors.js`), and wraps network failures in a plain `Error` with method+path context. The `auth` config object is delegated to `src/graylog/auth.js`. The existing `searchGraylog()` in `query.js` is NOT changed — it stays as-is; `client.js` is additive.

**Cross-reference:** `src/graylog/auth.js` (buildAuth), `src/graylog/errors.js` (mapGraylogError).

---

### `src/graylog/auth.js` (utility, transform)

**Analog:** `src/query.js:107-110` (inline auth config object inside `searchGraylog`) and `src/query.js:91-95` (inline auth in `fetchStreams`)

**Auth shape** (`src/query.js:107-110`):
```js
auth: {
    username: apiToken,
    password: 'token',
},
```

**What is the same:** The exact shape — Graylog Basic auth uses the API token as `username` and the literal string `'token'` as `password`.

**What is different:** `auth.js` extracts this into a named export `buildAuth(apiToken)` that returns the axios-compatible config key. Pure function, no imports needed.

---

### `src/graylog/errors.js` (utility, transform)

**Analog:** `src/tools/cluster-errors.js:12-14` (`errorResponse`)

**Error shape** (`src/tools/cluster-errors.js:12-14`):
```js
function errorResponse(text) {
    return { isError: true, content: [{ type: "text", text }] };
}
```

**What is the same:** The canonical MCP error shape `{ isError: true, content: [{ type: "text", text }] }` is the one this file's consumers must produce. The `wrapGraylogError(err, toolName)` export translates a thrown `GraylogError` (or unknown error) into this exact shape.

**What is different:** `errors.js` also defines the typed error class hierarchy (`GraylogError`, `GraylogValidationError`, etc.) and the `mapGraylogError(res, ctx)` HTTP-status classifier. These have no direct analog in the codebase — they are new. The class definitions use ESM `export class` with no inheritance boilerplate beyond `extends Error`.

---

### `src/graylog/normalize.js` (utility, transform)

**Analog:** None. No response-normalisation layer exists in the codebase.

**Design reference:** RESEARCH.md §"Pattern 5: Response Normaliser" (lines 643-683). The `toIdBody(response, hint)` function iterates an `idFields` candidate list and returns `{ id, body }`. It is a pure function with no imports.

**Conventions to observe:** Named export (`export function toIdBody`), `??` for fallback, short `//` comments only where non-obvious.

---

### `src/tools/_shared/handler.js` (handler factory, request-response)

**Analog:** `src/tools/cluster-errors.js:16-174` (the most complete existing extracted handler)

**Connection-gate pattern** (`src/tools/cluster-errors.js:20-31` / `src/index.js:160-175`):
```js
// From src/index.js:160-175
function requireActiveConnection() {
    const conn = getActiveConnectionConfig();
    if (!conn) {
        const available = Object.keys(getConnections()).join(", ");
        return {
            error: {
                isError: true,
                content: [{
                    type: "text",
                    text: `No active connection. Use 'use_connection' first. Available: ${available || "none"}`,
                }],
            },
        };
    }
    return { conn };
}
```

**Error response shape** (`src/tools/cluster-errors.js:12-14`):
```js
function errorResponse(text) {
    return { isError: true, content: [{ type: "text", text }] };
}
```

**Try/catch wrapping** (`src/tools/cluster-errors.js:50-71`):
```js
try {
    // ...
} catch (err) {
    return errorResponse(`Error fetching messages: ${err.message}`);
}
```

**What is the same:** Error shape `{ isError: true, content: [{ type: "text", text }] }` is unchanged. Connection-gate pattern is the same logic, elevated into `resolveConnection()` helper. `async function handler(request)` signature and `request.params.arguments || {}` argument extraction. `args.field ?? defaultValue` default-arg style.

**What is different:** The factory wraps all these concerns structurally, enforcing: (1) zod validation first, (2) connection resolution with `writable` check (new per D-07), (3) idempotency-key derivation, (4) `build()` → `dryRun` branch before any network call, (5) `apply()` + `normalize()` on execution. The `writable: false` short-circuit (step 2) is new — no analog in existing handlers. The `dryRun: true` default is enforced exactly once inside the factory, not inside individual handlers.

**Cross-reference:** `src/tools/_shared/connection.js` (resolveConnection), `src/tools/_shared/dry-run.js` (runOrPreview), `src/tools/_shared/idempotency.js` (deriveIdempotencyKey), `src/tools/_shared/errors.js` (errorResponse/wrapGraylogError/formatZodError), `src/graylog/client.js` (makeClient).

---

### `src/tools/_shared/list.js` (handler factory, request-response)

**Analog:** `src/tools/template-mgmt.js:18-44` (`handleListTemplates`)

**List handler pattern** (`src/tools/template-mgmt.js:18-44`):
```js
export async function handleListTemplates(request) {
    const args = request.params.arguments || {};
    const r = resolveConnection(args);
    if (r.error) return r.error;

    const limit = args.limit ?? 50;
    const sortBy = args.sortBy ?? "count";
    // ...
    let items = Object.values(store.templates);
    // filter, sort, slice...
    return {
        content: [{
            type: "text",
            text: JSON.stringify({ total: items.length, templates: items.slice(0, limit) }),
        }],
    };
}
```

**What is the same:** `request.params.arguments || {}` arg extraction, `args.limit ?? DEFAULT` default with `??`, connection-gate via `resolveConnection`, `JSON.stringify(...)` content text return shape.

**What is different:** The factory enforces `DEFAULT_LIMIT = 25` and `MAX_LIMIT = 200` (clamped via `Math.min`), a narrow field projection `['id', 'title', 'description']` applied unless caller passes `fields: 'all'`, and wraps the fetch call in a `try/catch` that routes to `wrapGraylogError`. The `handleListTemplates` analog uses local state (template store), not an HTTP client; the new factory's `fetch` callback calls `client.request`.

---

### `src/tools/_shared/connection.js` (utility, request-response)

**Analog:** `src/tools/template-mgmt.js:8-16` (`resolveConnection`)

**Exact pattern to copy** (`src/tools/template-mgmt.js:8-16`):
```js
function resolveConnection(args) {
    if (args._testConnection) return { name: args._testConnection };
    const conn = getActiveConnectionConfig();
    if (!conn) {
        const available = Object.keys(getConnections()).join(", ");
        return { error: errorResponse(`No active connection. Use 'use_connection' first. Available: ${available || "none"}`) };
    }
    return { name: getActiveConnection() };
}
```

**What is the same:** `_testConnection` seam (`_` prefix, project standard), `getActiveConnectionConfig()` / `getConnections()` / `getActiveConnection()` call pattern, return `{ error }` on failure, return `{ name, conn }` on success.

**What is different:** The new `connection.js` export adds: (1) support for per-call `args.connectionName` (FOUND-09) — if present, look up `connections[args.connectionName]` instead of the singleton; (2) expose the `conn` object (needed by the HTTP client and the writable check); (3) check `conn.writable` and return it alongside `conn` and `name` so the handler factory can gate on `writable === false` (D-07). The `error` key in the return remains `{ error: errorResponse(...) }` for backward-compatible destructuring.

**Cross-reference:** `src/config.js` (getActiveConnection, getActiveConnectionConfig, getConnections); `src/tools/_shared/errors.js` (errorResponse).

---

### `src/tools/_shared/dry-run.js` (utility, transform)

**Analog:** None. First occurrence of this primitive.

**Design reference:** RESEARCH.md §"Pattern 2" lines 433-458. Key shape:
- Returns `{ content: [{ type: "text", text: JSON.stringify({ dryRun: true, ..., postApplyEstimate: { id: "__SERVER_ASSIGNED__" }, existingMatches: [] }) }] }` when `dryRun === true`.
- The `__SERVER_ASSIGNED__` sentinel (FOUND-04) must appear in every dry-run response.

**Conventions to observe:** Pure function, named export `runOrPreview`. No logging, no imports except from the project (`errorResponse` if needed). The `dryRun` default of `true` is resolved by the calling factory (`handler.js`), not inside `dry-run.js` itself.

---

### `src/tools/_shared/idempotency.js` (utility, transform)

**Analog:** `src/clustering/strategies/drain3.js:1-8` (only the hashing pattern)

**Hash pattern** (`src/clustering/strategies/drain3.js:1-8`):
```js
import { createHash } from "node:crypto";

function templateId(tokens) {
    return "tpl_" + createHash("sha1").update(tokens.join(" ")).digest("hex").slice(0, 12);
}
```

**What is the same:** `import { createHash } from "node:crypto"`, `createHash().update().digest("hex")` call chain.

**What is different:** Use `sha256` (not `sha1`) per RESEARCH.md FOUND-10. The canonical arg string is `JSON.stringify` of the sorted, de-`dryRun`/de-`idempotencyKey` arg object. Return the full hex string (no slicing). No prefix needed (the key is opaque to the caller).

---

### `src/tools/_shared/conflict.js` (utility, transform)

**Analog:** None. New primitive.

**Design reference:** RESEARCH.md FOUND-11 — `existingMatches` field in every create-tool dry-run output. Phase 0 ships the helper stub; domain phases (1+) inject the list-fetch call. The helper signature is `findExistingMatches(client, { listPath, matchFn })` returning an array (empty when none).

---

### `src/tools/_shared/errors.js` (utility, transform)

**Analog:** `src/tools/cluster-errors.js:12-14` and `src/tools/template-mgmt.js:4-6`

**Exact pattern to copy — errorResponse** (both files, identical):
```js
function errorResponse(text) {
    return { isError: true, content: [{ type: "text", text }] };
}
```

**What is the same:** The canonical MCP error shape. `errors.js` promotes this private function to a named export `errorResponse(text)` that every handler and factory can import.

**What is different:** Also exports `wrapGraylogError(err, toolName)` (formats a `GraylogError` into the same `{ isError, content }` shape, adding the typed error class name as context) and `formatZodError(err)` (flattens a `ZodError` into a human-readable string for `errorResponse`). These three functions are the only exports.

---

### `src/tools/_shared/schemas.js` (config, transform)

**Analog:** None. First zod usage in `src/`. Zod is already in `package.json` but unused.

**Design reference:** RESEARCH.md §"Pattern 2" lines 488-504. Base mutating schema:
```js
import { z } from "zod";

export const mutatingBase = z.object({
    dryRun: z.boolean().default(true),
    connectionName: z.string().optional(),
    idempotencyKey: z.string().optional(),
});
```

**Conventions to observe:** `import { z } from "zod"` (named import, not default). No `.default()` unless the default is expressly documentation-only (but `dryRun: true` is the safety default and must be `z.boolean().default(true)` so zod enforces it when the field is absent).

---

### `src/config.js` (modified — self analog)

**Current pattern to preserve** (`src/config.js:52-55`):
```js
export function getActiveConnectionConfig() {
    if (!activeConnection) return null;
    return connections[activeConnection];
}
```

**Addition:** Parse optional `writable` field from each connection object at config-load time (lines 10-17). Add `export function getConnectionWritable(name)` that returns `connections[name]?.writable ?? true` — defaults to `true` when absent (backward-compatible per D-07). This is the only change to `config.js`.

---

### `src/index.js` (modified — self analog)

**Current dispatch chain** (`src/index.js:38-104`): 25 chained `if (name === ...)` blocks.

**After refactor:** Replace the entire chain body with a single `return dispatch(request)` call. Retain the `server.setRequestHandler(CallToolRequestSchema, ...)` wrapper. The `assertAllToolsRegistered(toolDefinitions)` call fires at module-init time (top-level, after all imports).

**What must not change:** `server.setRequestHandler(ListToolsRequestSchema, ...)` handler (line 34-36) is unchanged. The `Server` construction block (lines 25-32) is unchanged. The function definitions for `listConnections`, `useConnection`, `requireActiveConnection`, and all read-handler functions move out of `index.js` into their own registered handler files, or are registered inline from `dispatch.js`'s self-registration side-effects.

---

### `src/tools.js` (modified — self analog)

**Current pattern** (`src/tools.js:1-652`): Array of `{ name, description, inputSchema }` objects.

**After D-03 rename:** Only the `name` fields change. All `description` and `inputSchema` bodies are unchanged. The rename map (planner produces the authoritative list) applies the `<verb>_<domain>_<noun>` convention. Example entries:
- `"fetch_graylog_messages"` → `"search_messages_graylog"` (or similar — planner decides exact name)
- `"use_connection"` → `"set_active_connection"`

**What must not change:** File shape, export name `toolDefinitions`, JSON-Schema structure per tool.

---

## Test Pattern Assignments

### `test/existing/clustering-preprocess.test.js`, `test/existing/clustering-strategy.test.js`, `test/existing/template-store.test.js`, `test/existing/template-mgmt.test.js` (migration targets from `test-clustering.js`)

**Analog:** `test-clustering.js` — read every line before writing the migrated file.

**Current pattern** (`test-clustering.js:1-8`):
```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import { normalizeMessage, tokenize } from "./src/clustering/preprocess.js";

console.log("=== Preprocessor ===");
assert.equal(normalizeMessage("user 42 failed"), "user <*> failed");
```

**node:test replacement pattern:** Each `console.log("=== X ===")` block becomes a `test("X", (t) => { ... })` or `describe("X", () => { it(...) })`. Each `assert.equal` becomes `t.assert.strictEqual` (or keep `assert.strictEqual` from `node:assert/strict` — both work). The `_clearForTests()` call must happen inside `beforeEach` or at the top of the relevant `test()` callback.

**File header for every migrated test:**
```js
import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
```

**Import paths:** Change `"./src/..."` → `"../src/..."` (files move from repo root to `test/existing/`).

**Snapshot-config hook** (`test/snapshot-config.js` — consumed by test files that use `t.assert.snapshot()`):
```js
// test/snapshot-config.js
import { setResolveSnapshotPath } from "node:test";
// Resolve snapshot path to test/__snapshots__/<testfile>.snapshot
// regardless of CWD — ensures OS-stable paths.
setResolveSnapshotPath((testFilePath, snapshotExtension) => {
    // ...
});
```

---

### `test/existing/features.test.js` (migration from `test-features.js`)

**Analog:** `test-features.js` — uses `try/catch` blocks and `console.log` to assert. Convert to `node:test` `describe`/`test` blocks with `assert.strictEqual` / `assert.deepEqual`. Each `try { ... } catch (error) { console.error(...) }` section becomes a `test(...)` with proper assertions (not swallowed errors).

**Import path change:** `"./src/timerange.js"` → `"../src/timerange.js"`, etc.

---

### `test/existing/aggregation-fixes.test.js` (migration from `test-aggregation-fixes.js`)

**Analog:** `test-aggregation-fixes.js:1-50`. Same migration: `console.log + try/catch` → `test()/assert.*`. Structural assertions on the payload shapes (`histogram.queries[0].search_types[0].type === "pivot"`, etc.) become explicit `assert.equal` calls.

---

### `test/existing/histogram-fixes.test.js` (migration from `test-histogram-fixes.js`)

**Analog:** `test-histogram-fixes.js:1-50`. Same migration pattern.

---

### `test/dispatch.test.js` (unit, request-response)

**Analog:** `test-clustering.js:36-60` (registry tests — register, get, duplicate guard, error message)

**Core test pattern to follow** (`test-clustering.js:36-60`):
```js
import { register, get, list, _clearForTests } from "./src/clustering/index.js";

_clearForTests();

const fakeStrategy = { ... };
register("fake", fakeStrategy);
assert.equal(get("fake"), fakeStrategy);
assert.throws(() => register("fake", fakeStrategy), /already registered/);
assert.throws(() => get("missing"), /Unknown clustering algorithm "missing"\. Registered: fake/);
```

**node:test shape:**
```js
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register, dispatch, assertAllToolsRegistered, _clearForTests } from "../src/dispatch.js";

beforeEach(() => _clearForTests());

test("register + dispatch routes handler", (t) => { ... });
test("dispatch throws Tool not found for unregistered name", (t) => { ... });
test("assertAllToolsRegistered throws when handler missing", (t) => { ... });
```

---

### `test/handler.test.js` (unit + snapshot, request-response)

**Analog:** `test-clustering.js` style for assertions; RESEARCH.md §"Pattern 2" for the fixture handler shape.

**Key node:test snapshot usage:**
```js
test("defineMutatingHandler dry-run response shape", async (t) => {
    const handler = defineMutatingHandler({ name: "test_tool", schema, build, apply });
    const response = await handler({ params: { name: "test_tool", arguments: {} } });
    t.assert.snapshot(response);
});
```

The `t.assert.snapshot()` call writes to `test/__snapshots__/handler.test.js.snapshot` on first run; subsequent runs assert equality.

---

### `test/graylog-client.test.js` (unit, request-response)

**Analog:** `test-clustering.js` (assert style) + the `axios` mock idiom.

**Axios mock pattern:** Use `node:test`'s `mock.module()` (Node 22 stable) or a simple module-level override to replace `axios` with a function that returns a controlled response. No external mocking library needed.

```js
import { mock } from "node:test";
// mock axios before importing client
mock.module("axios", { ... });
```

---

### `test/regression/read-tools.test.js` (regression snapshot)

**Analog:** `test-clustering.js:46-70` (`_setSearchOverride` pattern — inject a fake search function, capture what the handler produces)

**Override pattern** (`test-clustering.js:53-55`):
```js
const override = _getSearchOverride();
if (override) {
    fetched = await override({ queryString, timeRange, sampleSize, streamFilter });
}
```

**Migration:** The regression test uses `_setSearchOverride` from `src/clustering/_test_hooks.js` or an equivalent seam on `searchGraylog` to capture the Graylog payload that each read handler builds, then snapshots it. Pre-refactor run captures baseline; post-refactor run must produce identical snapshots.

---

### `test/connection.test.js` (unit, request-response)

**Analog:** `test-clustering.js:37-57` (registry `_clearForTests` seam pattern)

**writable=false test:** Uses `_testConnection` seam already present in `src/tools/cluster-errors.js:20` and `src/tools/template-mgmt.js:9` to inject a connection object with `writable: false` without touching the config file.

---

### `test/auth-redaction.test.js` (static scan)

**Analog:** None directly. Uses `node:fs` `readFileSync` to load each file in `test/__snapshots__/` and asserts no match against `/Authorization|[A-Za-z0-9]{32,}/`. Simple `test()` loop.

---

### `test/snapshot-config.js` (config, test infrastructure)

**Analog:** None — Node 22 `setResolveSnapshotPath` has no prior usage in the codebase. Pure infrastructure file imported at the top of every test file that uses snapshots.

---

## Shared Patterns

### Error Response Shape
**Source:** `src/tools/cluster-errors.js:12-14` and `src/tools/template-mgmt.js:4-6` (identical in both)
**Apply to:** All new handler files, `src/tools/_shared/errors.js`, `src/tools/_shared/handler.js`, `src/tools/_shared/list.js`
```js
function errorResponse(text) {
    return { isError: true, content: [{ type: "text", text }] };
}
```

### Default-arg Style
**Source:** `src/tools/cluster-errors.js:37` and `src/tools/template-mgmt.js:24`
**Apply to:** All new src/ files
```js
const limit = args.limit ?? 50;
const sortBy = args.sortBy ?? "count";
```
Never use `||` for defaults on boolean/numeric args; `??` only.

### Connection Resolution Return Shape
**Source:** `src/tools/template-mgmt.js:8-16`
**Apply to:** `src/tools/_shared/connection.js`, all handler factories
```js
function resolveConnection(args) {
    if (args._testConnection) return { name: args._testConnection };
    // ...
    return { error: errorResponse("...") };  // on failure
    return { name: getActiveConnection() };  // on success
}
```
The `error` key (not `err` or `isError`) is the return-value convention for the failure branch.

### Test Seam Pattern
**Source:** `src/clustering/index.js:27-29` and `src/clustering/template-store.js:12` (`_withStorePathOverride`)
**Apply to:** All new modules that hold module-level state (`src/dispatch.js`, `src/graylog/client.js` if it ever grows state)
```js
// Test-only: reset registry between unit tests
export function _clearForTests() {
    strategies.clear();
}
```
Leading underscore, no JSDoc, one-line comment, placed at end of public API but before auto-registration side effects.

### ESM Import Style
**Source:** Every existing file — `src/clustering/index.js:33`, `src/query.js:1`
**Apply to:** All new files
```js
import { createHash } from "node:crypto";   // node: prefix on built-ins
import axios from "axios";                   // third-party: no prefix
import { getActiveConnectionConfig } from "../config.js";  // relative: .js extension always
```

### Content Response Shape
**Source:** `src/tools/cluster-errors.js:172-174`, `src/tools/template-mgmt.js:38-43`
**Apply to:** All handler files
```js
return {
    content: [{ type: "text", text: JSON.stringify(body) }],
};
```

### node:test File Header (all new test files)
**Source:** None in codebase (all existing tests predate node:test migration). Pattern from D-05 requirement.
```js
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
```
`describe`/`before`/`beforeEach`/`after`/`afterEach` are optional per file; import only what is used.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/graylog/normalize.js` | utility | transform | No response-normalisation layer exists; new primitive |
| `src/tools/_shared/dry-run.js` | utility | transform | No dry-run concept exists; new primitive |
| `src/tools/_shared/conflict.js` | utility | transform | No conflict-check concept exists; stub for Phase 1+ |
| `src/tools/_shared/schemas.js` | config | transform | First zod usage in `src/`; no existing schema module |
| `test/snapshot-config.js` | config | — | `setResolveSnapshotPath` is new to codebase |
| `test/auth-redaction.test.js` | test | — | Static-scan test type has no precedent |
| `test/schema-parity.test.js` | test | — | Schema-drift detection has no precedent; starts empty |
| `test/__snapshots__/.gitkeep` | placeholder | — | Directory marker only |

---

## Metadata

**Analog search scope:** `/home/c_perronnet/git/graylog-mcp/src/`, `/home/c_perronnet/git/graylog-mcp/test-*.js`
**Files scanned:** `src/index.js` (903 lines), `src/tools.js` (652 lines), `src/config.js` (56 lines), `src/query.js` (123 lines), `src/tools/cluster-errors.js` (174 lines), `src/tools/template-mgmt.js` (120 lines), `src/clustering/index.js` (37 lines), `src/clustering/strategies/drain3.js` (30 lines read), `src/clustering/template-store.js` (40 lines read), `test-clustering.js` (160 lines read), `test-features.js` (80 lines), `test-aggregation-fixes.js` (50 lines), `test-histogram-fixes.js` (50 lines)
**Pattern extraction date:** 2026-05-13
