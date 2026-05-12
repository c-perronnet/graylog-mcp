# Testing

**Analysis Date:** 2026-05-12

## Framework

**Node's built-in `assert/strict`** — no Jest, Vitest, Mocha, or any other test runner. Each test file is a standalone script that imports the module under test, asserts inline with `assert.equal` / `assert.deepEqual` / `assert.throws`, and logs `✓` / `✗` markers on success/failure.

## Test Files

All tests live at the repo root, not under `tests/` or `__tests__/`. Four files, all executable Node scripts:

| File | Lines | Scope |
|---|---|---|
| `test-clustering.js` | 366 | Preprocessor, registry, Drain3 strategy, template store, full `handleClusterLogMessages` flow with mocked search |
| `test-features.js` | 136 | Time-range parsing, aggregation payload shapes, error-path coverage, arg normalization (including legacy `searchTimeRangeInSeconds`) |
| `test-aggregation-fixes.js` | ~100 | Structural validation of the 4 histogram/field-time payload variants |
| `test-histogram-fixes.js` | ~100 | Histogram-specific payload shapes |

## How They Run

`node test-<name>.js` directly. No common runner, no parallel mode, no reporter.

The `npm test` script in `package.json` points to `test-server.js` — **a file that does not exist in the repo**. So `npm test` will fail; tests must be invoked file-by-file.

There's no `npm test:all`, no CI config, no `Makefile`. The expected workflow is: run the specific file relevant to the change.

## What's Covered

**Strong coverage — pure logic with no I/O:**
- Tokenizer + wildcard normalization (numbers, UUIDs, IPv4, IPv6, ISO timestamps, hex blobs) — `test-clustering.js:5-34`
- Drain3 similarity, template merging, length bucketing, LRU eviction — `test-clustering.js:63+`
- Strategy registry: register/get/list/_clearForTests, duplicate-registration error, unknown-name error — `test-clustering.js:36-61`
- Time-range parsing: `1h`, `30m`, `2d`, absolute ISO ranges, invalid format rejection, negative rejection, `to < from` rejection — `test-features.js:14-101`
- Aggregation payload structure (search type, row group counts, intervals) — `test-features.js`, `test-aggregation-fixes.js`

**Medium coverage — uses test seams:**
- Template store roundtrip (load → save → reload) — `test-clustering.js` uses `_withStorePathOverride()` to redirect writes to a `mkdtemp` directory
- `handleClusterLogMessages` end-to-end — uses `_setSearchOverride()` from `src/clustering/_test_hooks.js` to bypass axios; passes `_testConnection` to skip connection registry

**No coverage:**
- The MCP server transport / dispatch (no test exercises `setRequestHandler`)
- Live Graylog API calls or HTTP error responses
- The histogram fallback chain in `getLogHistogram` (which tries 4 builder approaches sequentially)
- `src/events.js` (events/alerts API wrappers)
- `src/saved-searches.js` (only the persistence module — no integration test)
- The `src/tools/template-mgmt.js` handlers (list/delete/rename/export/import — only the store layer below them is tested)
- Concurrency on the template store's file lock (the stale-break path)
- Query escaping for special characters in `buildQueryString`
- The `extractMessages` Graylog-response unwrapper

## Test Seams (how production code is made testable)

The code exposes a deliberate set of underscore-prefixed seams instead of mocking with a library:

| Seam | Location | Purpose |
|---|---|---|
| `_clearForTests()` | `src/clustering/index.js:27` | Reset strategy registry between tests |
| `_setSearchOverride(fn)` | `src/clustering/_test_hooks.js` | Replace axios search with a fake — used by clustering integration tests |
| `_getSearchOverride()` | same | Read the override in production code path (`src/tools/cluster-errors.js:52`) |
| `_withStorePathOverride(fn)` | `src/clustering/template-store.js:12` | Redirect template-store file path to a temp directory |
| `_storePathForTests` | same module | Re-export of internal `storePath` for assertion |
| `_testConnection` arg | `src/tools/cluster-errors.js:20`, `src/tools/template-mgmt.js:9` | Magic arg that swaps in a fake connection without touching `src/config.js` state |

This is a "production code carries its own test hooks" approach — no mocking library, no monkey-patching, no DI container.

## Test-data Style

Inline. Each test constructs its own messages array, time-range object, or store fixture in the test body. No shared fixtures directory, no factory helpers. `test-clustering.js` uses `mkdtempSync` for filesystem isolation but builds the store contents inline.

Tests pass via assertion + `console.log("✓ ...")` and a final summary line. Failures throw via `assert` and exit non-zero.

## Linting / Type Checking in Tests

None. `typescript` is a devDependency but there's no `tsconfig.json` and no `.ts` files. `@types/node` is installed but unused at build time.

## Gaps Worth Knowing

1. **`npm test` is broken** — points to a non-existent file. Anyone running CI scripts that call `npm test` will see a hard failure (which may itself be why no CI is wired up).
2. **No HTTP integration test.** Every code path that calls Graylog is exercised either through the test seams (clustering) or not at all (most of `src/index.js`). A breaking change to the Graylog API payload shape would not be caught by the test suite.
3. **No regression test for recent fixes.** Commits `dc0a731` (sources_seen population), `a4a0f29`, and several "fix" commits in history don't have corresponding test entries. Risk of regression is real.
4. **No tests for the template-management tool handlers.** The data layer (`template-store.js`) is tested; the handlers in `src/tools/template-mgmt.js` (list/delete/rename/export/import) are not.
5. **No fuzz / property-based testing.** All assertions are example-based. Clustering similarity threshold tuning (recently changed 0.4 → 0.6 per commit history) has no quantitative regression guard.
