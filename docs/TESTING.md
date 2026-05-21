<!-- generated-by: gsd-doc-writer -->
# Testing

## Test Framework and Setup

The project uses **Node.js's built-in test runner** (`node:test`) for all unit, integration, and snapshot tests. No third-party test runner (Jest, Vitest, Mocha) is configured or required.

- **Runner:** `node:test` (built into Node.js — no install step)
- **Assertions:** `node:assert/strict`
- **Snapshots:** native `node:test` snapshot API (Node 22.3+), wired through `test/snapshot-config.js` which redirects snapshot files into per-test-file `__snapshots__/` folders
- **Coverage:** [`c8`](https://github.com/bcoe/c8) `^10.1.3` (declared in `devDependencies` of `package.json`)

**Setup:** `npm install` is the only prerequisite — the runner and assertion library are part of Node itself. Node `>= 22.3.0` is required (per `package.json` `engines` field) because the snapshot API was stabilized in 22.3.

## Running Tests

All commands are run from the project root.

```bash
# Full suite (matches `test/**/*.test.js` — excludes `*.smoke.js`)
npm test

# Single test file
node --test test/authz-roles.test.js

# A directory of tests
node --test test/regression/

# Coverage report (text + lcov)
npm run coverage

# Tool-description static audit (not under node --test; run directly)
npm run audit:tool-descriptions
```

Current baseline: **1196/1196 GREEN** as of v3.1.0 (2026-05-21).

The `npm test` glob (`test/**/*.test.js`) intentionally excludes the `*.smoke.js` suffix used by live-cluster probes — see [Live Smoke Probes](#live-smoke-probes) below.

## Test Organization

```
test/
├── *.test.js                  # Offline unit/integration tests (run by `npm test`)
├── *-live.smoke.js            # Opt-in live-cluster probes (excluded from `npm test`)
├── existing/                  # Pre-v3 legacy tests (still GREEN; same node:test runner)
├── regression/                # Production-registry regression tests (separate process)
├── snapshots/                 # Snapshot test sources for blueprint/widget surfaces
│   └── __snapshots__/         # Recorded snapshot output
├── __snapshots__/             # Recorded snapshot output for top-level *.test.js files
├── fixtures/                  # Captured live-Graylog responses, replayed offline
│   ├── authz/
│   ├── v7-read-tool-smoke/
│   └── type-catalogue-7.0.6.json
└── snapshot-config.js         # Snapshot path resolver — imported by every snapshot test
```

**Conventions:**

- One `.test.js` file per logical surface (e.g., `test/streams.test.js`, `test/pipelines.test.js`, `test/authz-roles.test.js`).
- Test file names use kebab-case mirroring the domain under test.
- Fixture files: `test/fixtures/<domain>/<entity>-<graylog-version>.json` (e.g., `list-roles-7.0.6.json`).
- All offline tests replay fixtures — no test reaches a network during `npm test`.

## Test Seams

Two project-specific test seams keep tests hermetic without monkey-patching modules.

### `_testConnection` (magic argument)

Every tool handler accepts an `_testConnection` argument to swap in a synthetic connection without registering one in `~/.graylog-mcp/config.json`. Resolved in `src/tools/_shared/connection.js`.

Two accepted shapes:

```javascript
// 1. String form — synthesizes { baseUrl: "_test", apiToken: "_test", writable: true }
await handleListRoles({ _testConnection: "fake" });

// 2. Inline-object form — caller supplies the conn fields verbatim
//    (used to exercise the writable: false gate without a registered connection)
await handleCreateRole({
    _testConnection: { baseUrl: "https://x", apiToken: "y", writable: false },
    name: "x",
});
```

The seam is stripped by zod's default `strip` mode before reaching production schemas, so it is unreachable from a real MCP client.

### `_setCaptureRequest(fn)` (HTTP-replay seam)

Exported from `src/graylog/client.js`. Replaces the axios call in `makeClient(conn).request` with a test-supplied function. All offline tests install a replay stub that returns canned fixture responses based on `(method, path)`. Pair with `_clearCaptureRequest()` in `afterEach`.

```javascript
import { _setCaptureRequest, _clearCaptureRequest } from "../src/graylog/client.js";

beforeEach(() => {
    _setCaptureRequest((method, path) => {
        if (method === "GET" && path === "/api/roles") return { status: 200, data: LIST_ROLES_FIXTURE };
        throw new Error(`Unexpected request: ${method} ${path}`);
    });
});
afterEach(() => _clearCaptureRequest());
```

Production code MUST NEVER call `_setCaptureRequest` — leaving it set silently disables all HTTP.

Other test-only hooks present in the codebase:

- `_clearForTests()` — resets the dispatch registry (`src/dispatch.js`) and the clustering strategy registry (`src/clustering/index.js`).
- `_clearConnectionsForTests()` / `setActiveConnection()` — manage the connection registry singleton (`src/config.js`).
- `_withStorePathOverride()` — redirects the clustering template-store path (`src/clustering/template-store.js`).

## Fixtures

Offline tests are driven entirely by JSON fixtures captured from a live Graylog instance and replayed through the `_setCaptureRequest` seam.

- **Location:** `test/fixtures/<domain>/<entity>-<version>.json`
- **Capture scripts:** `scripts/capture-*-fixtures.js` (e.g., `scripts/capture-roles-fixtures.js`, `scripts/capture-authz-prepare-fixture.js`)
- **Safety:** Every capture script is **GET-only** and self-guards: any non-`GET` method aborts `process.exit(2)`. The live `test` connection is real production Graylog (UNESCO), not a sandbox — capture scripts must never mutate it.
- **Refreshing:** Run a capture script manually against the live cluster when an upstream API changes:

  ```bash
  node scripts/capture-roles-fixtures.js
  ```

The Phase 8 pattern is: write the handler to call upstream, capture the real response into a fixture, then replay that fixture in `*.test.js`.

## Snapshot Tests

Several test files use Node's built-in snapshot API. Every snapshot test must import the path resolver:

```javascript
import "./snapshot-config.js";
// ...
test("snapshot: dispatch unknown tool error message", async (t) => {
    t.assert.snapshot({ errorMessage: "..." });
});
```

`test/snapshot-config.js` redirects snapshot files into a sibling `__snapshots__/` folder named after the test file (e.g., `test/__snapshots__/dispatch.test.js.snapshot`). The Node test runner manages the file format; update via `node --test --test-update-snapshots <file>`.

Snapshot tests live in `test/__snapshots__/` (top-level) and `test/snapshots/__snapshots__/` (domain-specific blueprints/widgets).

## Live Smoke Probes

Files matching `test/*-live.smoke.js` are **opt-in, read-only / dryRun-only** probes that exercise tool handlers against a real Graylog connection (the `test` connection in the user's config). They are **excluded from `npm test`** because the suite glob is `test/**/*.test.js` (no `.smoke.js`).

Run a smoke probe manually:

```bash
node test/authz-roles-live.smoke.js
```

Current smoke files:

- `test/authz-roles-live.smoke.js`
- `test/authz-share-entity-live.smoke.js`
- `test/authz-entity-shares-live.smoke.js`

**Safety contract** (encoded inside each smoke file):

- All mutating tools are called with `dryRun: true` only. The wrapper short-circuits before the apply step fires.
- A self-guard `assertSafe*Path(method, path)` aborts `process.exit(2)` on any observed `POST`/`PUT`/`DELETE` against the mutating surface — defense-in-depth in case the dryRun short-circuit regresses.
- A `grep -cE 'dryRun *: *false'` gate over each smoke file must return `0`.

The `test` connection is live UNESCO production Graylog — never bypass these gates.

## Writing New Tests

**File naming:** `test/<surface>.test.js` for the offline suite. One file per logical surface.

**Imports:** Use direct per-file handler paths, not barrel exports, so test files are unaffected by the barrel's `register()` side-effects on the dispatch registry.

```javascript
// Good — direct
import { handleListRoles } from "../src/tools/authz/list-roles.js";

// Avoid in tests — pulls in dispatch registration side-effects
import { handleListRoles } from "../src/tools/authz/index.js";
```

**Test skeleton:**

```javascript
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { _setCaptureRequest, _clearCaptureRequest } from "../src/graylog/client.js";
import { handleMyTool } from "../src/tools/<domain>/my-tool.js";

beforeEach(() => {
    _setCaptureRequest((method, path) => {
        // return canned fixture based on (method, path)
    });
});
afterEach(() => _clearCaptureRequest());

test("my_tool returns expected shape", async () => {
    const res = await handleMyTool({ _testConnection: "fake", /* ...args */ });
    assert.equal(res.isError, undefined);
});
```

### TDD / Wave-0 Pattern

When adding a new tool family, ship the test file **first** as a Wave-0 RED scaffold. The failing test file becomes the executable specification for the handler. `node --check test/<file>.test.js` must exit `0` (well-formed ESM), even though `node --test test/<file>.test.js` will fail at module load with `ERR_MODULE_NOT_FOUND` until the handler is implemented.

Canonical example: [`test/authz-roles.test.js`](../test/authz-roles.test.js) — see its header comment for the RED-phase tolerance contract.

## Static Audits

Beyond the runtime suite, `scripts/audit-tool-descriptions.js` enforces two invariants on every entry in `src/tools.js`:

1. Description length `<= 200` characters.
2. Description is discriminating: multi-sentence OR contains a comparative keyword (`vs.`, `rather than`, `instead of`, `use this when`, ...).

Run via:

```bash
npm run audit:tool-descriptions
```

The audit is also wired into the runtime suite via `test/tool-description-audit.test.js`, so `npm test` fails if a new tool description is too long or non-discriminating.

## Tool-Count Assertions

Three test files assert the total registered tool count in lockstep:

- `test/list-admin-tools.test.js` — asserts `payload.count === 101`
- `test/pipelines.test.js` — asserts `toolDefinitions.length === 101`
- `test/dashboards.test.js` — asserts `toolDefinitions.length === 101`

The current value is **101** (as of v3.1.0). When adding or removing a tool, update all three assertions in the same commit — the failing test points the next reader at every place the count is encoded.

## Coverage

Coverage is collected with `c8`. Baseline at the v3.0.0 close (per `.planning/PROJECT.md`):

| Metric     | Threshold |
|------------|-----------|
| Statements | 93.58%    |
| Branches   | 79.13%    |
| Functions  | 89.93%    |
| Lines      | 93.58%    |

No `c8` config file is present in the repo; the `npm run coverage` script invokes `c8` with `--reporter=text --reporter=lcov --reporter=text-summary` and no enforced threshold. Coverage is reported as an informational baseline, not gated.

## CI Integration

<!-- VERIFY: CI workflow definition — no `.github/workflows/` directory is present in the repo at the time of writing. Tests are run locally and in pre-commit/pre-ship gates rather than via hosted CI. -->
