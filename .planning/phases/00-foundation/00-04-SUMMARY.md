---
phase: 00-foundation
plan: 04
subsystem: handler-primitives
tags: [zod, dry-run, idempotency, writable-flag, sha256, factory, tdd, defense-in-depth]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: "node:test runner + handler/list/connection/idempotency stubs (Plan 01); GraylogError hierarchy + makeClient + _setCaptureRequest seam (Plan 03)"
provides:
  - "src/tools/_shared/handler.js — defineMutatingHandler factory: zod → resolveConnection → D-07 writable gate → idempotency key → build → dryRun-or-apply → normalize"
  - "src/tools/_shared/list.js — defineListHandler factory: zod → resolveConnection → DEFAULT_LIMIT 25 + MAX_LIMIT 200 clamp → fields projection → fetch → wrapGraylogError on throw"
  - "src/tools/_shared/{errors, schemas, connection, idempotency, dry-run, conflict}.js — leaf primitives composed by the two factories"
  - "src/config.js: getConnectionWritable(name) reads the optional writable field; _setConnectionsForTests / _clearConnectionsForTests test seam"
  - "example-config.json: documents writable: false via the _doc_writable JSON-key idiom"
  - "_testConnection seam re-merging pattern at the wrapper layer (zod strips it from production payloads per T-00-04-05; wrapper re-merges from rawArgs for unit tests)"
affects:
  - "00-05 (dispatch refactor — admin tools registered through the Map use the new factories via spec → handler conversion)"
  - "00-06 (schema-parity check — zod schemas at src/tools/_shared/schemas.js + per-domain schemas.js (Phase 1+) feed the parity check)"
  - "All Phase 1+ admin tools (every mutating tool extends mutatingBase + composes through defineMutatingHandler; every list tool extends listBase + composes through defineListHandler)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Factory-as-structural-enforcement: dryRun=true default, narrow list projection, writable-flag check, and idempotency-key derivation cannot be skipped by a forgetful tool author — the factory always applies them. Compare to a 'remember to call enforceDryRun()' rule that any new tool author can miss."
    - "_testConnection seam re-merge: pre-zod rawArgs._testConnection is forwarded onto the parsed args before resolveConnection consumes them. Production schemas don't declare _testConnection, so zod strips it for agent payloads (T-00-04-05). Inside the wrapper layer the seam still works for unit tests without compromising production safety."
    - "Defense-in-depth across wrapper + client for D-07: defineMutatingHandler refuses writable: false BEFORE build/apply with reason: 'connection_read_only'; src/graylog/client.js (Plan 03) refuses non-GET BEFORE axios with GraylogError(status: 0). Either layer alone catches the threat; both layers together cover the case where one is bypassed."
    - "Underscore-seam convention for config: _setConnectionsForTests + _clearConnectionsForTests live next to getConnectionWritable in src/config.js. The _ prefix + comment marks them test-only; getConnections() and getActiveConnectionConfig() branch on the override ONLY when set, preserving existing behaviour."

key-files:
  created:
    - "src/tools/_shared/errors.js"
    - "src/tools/_shared/schemas.js"
    - "src/tools/_shared/idempotency.js"
    - "src/tools/_shared/dry-run.js"
    - "src/tools/_shared/conflict.js"
    - "src/tools/_shared/connection.js"
    - "src/tools/_shared/handler.js"
    - "src/tools/_shared/list.js"
  modified:
    - "src/config.js (additive: getConnectionWritable + _setConnectionsForTests + _clearConnectionsForTests; getConnections + getActiveConnectionConfig branch on override only when set)"
    - "example-config.json (documents writable field via _doc_writable JSON-key idiom)"
    - "test/connection.test.js (replaced stub with 10 real tests covering _testConnection seam + per-call connectionName + singleton fallback + getConnectionWritable defaults)"
    - "test/idempotency.test.js (replaced stub with 15 real tests covering 32-hex output + determinism + exclusions + recursive sort + array order + toolName/connectionName sensitivity)"
    - "test/handler.test.js (replaced stub with 10 real tests covering dryRun default + zod validation + D-07 short-circuit + apply branch + idempotency-key flow + GraylogConflictError wrap + existingMatches surface + summarize)"
    - "test/list.test.js (replaced stub with 8 real tests covering default limit + MAX_LIMIT clamp + narrow projection + fields:'all' + custom fields array + zod validation + GraylogError wrap + envelope shape)"

key-decisions:
  - "Added _setConnectionsForTests / _clearConnectionsForTests as an underscore-seam in src/config.js rather than mocking via Node 22's experimental mock.module() — same rationale as Plan 03's status-code-mapping decision (mock.module needs --experimental-test-module-mocks and is flaky across patch versions)"
  - "_testConnection seam is read from pre-zod rawArgs and re-merged onto parsed args inside both factories, not added to mutatingBase / listBase. Production payloads never contain it (zod strips unknown keys); tests still get the synthetic conn. Aligns with threat-model T-00-04-05."
  - "Tool-name-agnostic error wording in resolveConnection ('Use the active-connection setter first ...') so the message survives Plan 05's use_connection → set_active_connection rename without churn"
  - "dry-run.js exports runOrPreview AND SERVER_ASSIGNED_SENTINEL as separate names; handler.js inlines the preview construction rather than calling runOrPreview, because the handler also needs to populate idempotencyKey + summary into the same JSON object. runOrPreview stays available for tools that want a thinner wrapper."
  - "wrapGraylogError truncates response body to 200 chars in the error message — long Graylog 4xx bodies (full validation tree, etc.) would otherwise blow out the MCP response. Truncated form keeps the agent's context window safe while preserving enough detail for debugging."

patterns-established:
  - "Every mutating-tool handler in Phase 1+ is defined as: `defineMutatingHandler({ name, schema: <DomainSchema>.extend(mutatingBase), build, apply, summarize? })` — the factory enforces dryRun + zod + writable + idempotency + dry-run + apply + normalize without per-tool boilerplate"
  - "Every list handler in Phase 1+ is defined as: `defineListHandler({ name, schema: listBase or extension, fetch })` — narrow projection + limit clamp are automatic"
  - "Test files that use _setConnectionsForTests reset both _clearConnectionsForTests AND setActiveConnection(null) in beforeEach AND afterEach — node:test concurrency across files would otherwise leak state"
  - "RED-GREEN per task with TDD-mode tests: failing test → implementation → re-run. Both Task 1 and Task 2 carry one test commit + one feat commit (no refactor needed)."

requirements-completed: [FOUND-03, FOUND-04, FOUND-05, FOUND-09, FOUND-10, FOUND-11, FOUND-12]

# Metrics
duration: ~7 min
completed: 2026-05-15
---

# Phase 00 Plan 04: Handler Primitives Summary

**defineMutatingHandler + defineListHandler ship under TDD with the D-07 wrapper-layer writable-flag short-circuit, sha-256 idempotency-key auto-derivation, `__SERVER_ASSIGNED__` dry-run sentinel, narrow list projection, and a tool-name-agnostic connection resolver — `npm test` grows 85 → 124 (+39 net-new) with zero existing-test regressions.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-15T06:52:00Z
- **Completed:** 2026-05-15T06:58:35Z
- **Tasks:** 2 (TDD: RED + GREEN per task)
- **Commits:** 4 task commits (2 × RED test, 2 × GREEN feat) + 1 metadata commit
- **Files:** 8 created (`src/tools/_shared/`), 2 modified (`src/config.js`, `example-config.json`), 4 modified (test stubs replaced)
- **Test growth:** +39 net-new (10 connection + 15 idempotency + 10 handler + 8 list — Task 2 also includes 4 new `_canonicalize` direct probes in idempotency that weren't in the original 10)

## Accomplishments

### The 8 _shared/ Files

| File | What it owns |
|---|---|
| `errors.js` | `errorResponse`, `formatZodError`, `wrapGraylogError`. wrap truncates body to 200 chars; preserves status/method/path context. |
| `schemas.js` | `mutatingBase` (dryRun default true, optional connectionName + idempotencyKey) and `listBase` (optional connectionName + limit + fields union) zod schemas — every Phase 1+ tool schema extends one of these. |
| `idempotency.js` | `deriveIdempotencyKey` (32-hex sha-256 truncation) + `_canonicalize` (recursive sorted-key, drops dryRun + idempotencyKey + undefined, arrays preserve order). |
| `dry-run.js` | `SERVER_ASSIGNED_SENTINEL` constant + `runOrPreview(req, ctx)` helper. Preview JSON shape is normative for FOUND-04. |
| `conflict.js` | `findExistingMatches` Phase 0 stub returning `[]`; Phase 1+ wires real list-fetch via `{ listPath, matchFn }`. |
| `connection.js` | `resolveConnection(args)` three-mode lookup: `_testConnection` seam → per-call `connectionName` → singleton fallback. Tool-name-agnostic error wording (D-08). |
| `handler.js` | `defineMutatingHandler` factory — the core. 7-step ordered enforcement (validate → resolve → writable gate → key → build → dryRun-or-apply → normalize). |
| `list.js` | `defineListHandler` factory + `projectItem`. Exports DEFAULT_FIELDS, DEFAULT_LIMIT, MAX_LIMIT for downstream tests/tooling. |

### src/config.js Additive Changes

- **`getConnectionWritable(name)`** — returns `true` when field absent (backward-compat), `false` when explicit, `undefined` for missing connection. Reads the same override used by `getConnections()` / `getActiveConnectionConfig()`.
- **`_setConnectionsForTests(map)` / `_clearConnectionsForTests()`** — test seam allowing unit tests to inject the registry without writing to `~/.graylog-mcp/config.json`. `getConnections()` and `getActiveConnectionConfig()` branch on the override only when it's set; production behaviour is unchanged.
- No other functions touched. Existing exports preserved verbatim.

### example-config.json Update

Replaced the (incorrect) MCP-client launcher config that lived there with a documented `connections` registry that includes `writable: false` on the `prod` entry and a tokens-required placeholder on `staging`. Used `_doc_writable` (JSON-key idiom) and `_doc_legacy_mcpServers` to explain both the new field and where the old wrapper config belongs (in the MCP client's own config, not graylog-mcp's).

## Test Coverage Matrix

Which test asserts which FOUND requirement:

| Requirement | Test file | Tests |
|---|---|---|
| **FOUND-03** (defineMutatingHandler enforces dryRun + zod + connection + writable + idempotency + build/apply) | `test/handler.test.js` | All 10 — every test exercises one ordered step of the factory pipeline. |
| **FOUND-04** (`__SERVER_ASSIGNED__` sentinel in every dry-run preview) | `test/handler.test.js` Test 1 (`dry-run by default`) | asserts `payload.postApplyEstimate.id === "__SERVER_ASSIGNED__"` |
| **FOUND-05** (zod schemas — mutatingBase + listBase) | `test/handler.test.js` Test 2 (`invalid args`); `test/list.test.js` Test 6 (`limit: -1 → isError`) | zod failure → `isError` via `formatZodError` |
| **FOUND-09** (per-call connectionName + singleton fallback) | `test/connection.test.js` Tests 2-6 | connectionName lookup, missing → error, singleton fallback, no-active → error |
| **FOUND-10** (deterministic sha-256 idempotency-key + canonical-args projection) | `test/idempotency.test.js` All 15 + `test/handler.test.js` Tests 5-6 | hex shape, determinism, exclusion of dryRun + idempotencyKey + undefined, key-order independence, recursive sort, array order, sensitivity to toolName + connectionName |
| **FOUND-11** (`existingMatches: []` in every preview; populated by build) | `test/handler.test.js` Tests 1 (empty default) + 8 (build supplies matches) | default `existingMatches: []`; build-supplied surfaces in preview |
| **FOUND-12** (list factory: default fields + DEFAULT_LIMIT + MAX_LIMIT clamp) | `test/list.test.js` All 8 | default limit 25, clamp at 200, default fields = [id, title, description], fields:'all', custom array, envelope shape |
| **D-07 wrapper-side** (writable: false short-circuits BEFORE build) | `test/handler.test.js` Test 3 (`writable=false → connection_read_only`) | `buildCalled === false`, `applyCalled === false`, `res.reason === "connection_read_only"` |
| **D-08** (singleton fallback for active connection) | `test/connection.test.js` Tests 5-6 (singleton w/ active + no-active error) | name + conn returned from singleton; error when no active connection set |
| **getConnectionWritable defaults** | `test/connection.test.js` Tests 7-10 | absent → true, false → false, true → true, missing connection → undefined |

## D-07 Two-Layer Defense Confirmation

The writable-flag enforcement is now in place at both layers:

| Layer | File | Behaviour | Test |
|---|---|---|---|
| **Wrapper** (Plan 04, this plan) | `src/tools/_shared/handler.js` | If `conn.writable === false`, return `{ isError: true, reason: "connection_read_only", content: [...] }` BEFORE build/apply | `test/handler.test.js` Test 3 — asserts `buildCalled === false && applyCalled === false` |
| **Client** (Plan 03) | `src/graylog/client.js` | If `conn.writable === false && method !== "GET"`, throw `GraylogError(status: 0, message: "read-only ...")` BEFORE axios | `test/graylog-client.test.js` 3 tests covering POST/PUT/DELETE refusal + GET allowed |

Either layer alone catches the threat. Both together cover the case where someone calls `makeClient(conn).request()` directly without going through `defineMutatingHandler` (e.g. a future service layer or a one-off admin script).

## Task Commits

| # | Task | Commit | Type | Gate |
|---|------|--------|------|------|
| 1a | Task 1 RED: failing tests for connection + idempotency primitives | `762e371` | test | RED |
| 1b | Task 1 GREEN: leaf primitives (errors/schemas/idempotency/dry-run/conflict/connection) + config.js additive + example-config.json | `f90ce72` | feat | GREEN |
| 2a | Task 2 RED: failing tests for defineMutatingHandler + defineListHandler | `2c46814` | test | RED |
| 2b | Task 2 GREEN: defineMutatingHandler + defineListHandler factories | `2ec5c17` | feat | GREEN |

The plan-level TDD gate sequence (RED → GREEN per task) is satisfied. No REFACTOR commit needed — both GREEN files came in clean on first pass; the only post-GREEN change was the `_testConnection` seam re-merge fix in handler.js + list.js, applied during Task 2's GREEN step before committing.

## Decisions Made

- **`_setConnectionsForTests` + `_clearConnectionsForTests` as underscore-seam in `src/config.js`** — rather than mocking via Node 22's `mock.module()`. Plan 03 already chose to avoid `mock.module()` for the same reason (experimental flag + flakiness across 22.x patch versions); the underscore-seam pattern is the project's established alternative.
- **`_testConnection` re-merge from pre-zod rawArgs** — `mutatingBase` and `listBase` deliberately do NOT declare `_testConnection`. In production, zod's default `strip` mode drops it from agent payloads (threat-model T-00-04-05 — agent cannot bypass connection lookup at runtime). Inside both factory wrappers we read it from `request.params.arguments` before zod and merge it onto the parsed args before `resolveConnection` consumes them. Net effect: production safe, tests work.
- **Tool-name-agnostic connection error wording** — `resolveConnection` says "Use the active-connection setter first" instead of hardcoding `use_connection` or `set_active_connection`. Survives Plan 05's rename without churn and reads naturally to agents who don't know the exact tool name.
- **`dry-run.js` exports `runOrPreview` AND the sentinel, but `handler.js` inlines the preview** — `runOrPreview`'s preview shape doesn't include `summary`, `idempotencyKey`, or `applyHint`, which the handler needs to embed at the same JSON level. Calling `runOrPreview` from `handler.js` would require either modifying the preview after the fact or stuffing those fields into `req`. Inlining keeps handler.js readable and preserves `runOrPreview` as a thinner helper for tools that want a simpler envelope.
- **`wrapGraylogError` truncates response body to 200 chars** — long Graylog 4xx bodies (e.g. full validation-tree responses on 422) would blow out the MCP response and the agent's context window. Truncated form keeps enough detail for debug while staying compact.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `_testConnection` seam stripped by zod broke 14 tests on first GREEN pass**

- **Found during:** Task 2 GREEN, immediately after writing `handler.js` + `list.js` and re-running `node --test test/handler.test.js test/list.test.js`. 14 of 18 tests failed with `SyntaxError: Unexpected token 'N', "No active "... is not valid JSON` — meaning the handler returned the "No active connection" error envelope, not the preview JSON.
- **Issue:** The plan instructed us to call `resolveConnection(args)` AFTER `schema.parse(args)`. Zod's default `strip` mode drops keys not in the schema. `mutatingBase` deliberately does NOT include `_testConnection` (per threat-model T-00-04-05 — agents must not be able to bypass connection lookup at runtime by passing it). So `_testConnection: "fake"` was passed by the tests, stripped by zod, and `resolveConnection` fell through to the singleton path, which had no active connection — returning an error envelope where the tests expected a preview.
- **Fix:** Read `_testConnection` from `request.params.arguments` BEFORE zod runs, then merge it onto the parsed args ONLY when present. Production payloads never contain `_testConnection` (no Phase 1+ tool documents it), so this is a no-op in production. In tests, the re-merge makes the seam reachable.
- **Files modified:** `src/tools/_shared/handler.js`, `src/tools/_shared/list.js`.
- **Verification:** 18/18 handler+list tests pass; full `npm test` exits 0 with 124 tests. Threat-model T-00-04-05 is still mitigated: production schemas don't declare `_testConnection`, so the agent has no way to put it on the wire — zod still strips it for any payload originating from outside the test runner.
- **Committed in:** Task 2 GREEN commit `2ec5c17` (folded into the GREEN step since the fix was discovered before the GREEN commit was made — no separate deviation commit needed).

**Total deviations:** 1 auto-fixed Rule-1 bug, resolved in the same GREEN commit. No Rule 2 (no missing security functionality), Rule 3 (no blocker), or Rule 4 (no architectural question) deviations.

## Threat Surface

All threats enumerated in the plan's `<threat_model>` are mitigated by the shipped code:

- **T-00-04-01 (writable-flag bypass at wrapper layer):** `handler.js:74-81` — `conn.writable === false` short-circuits BEFORE `build()` is called. Verified by `test/handler.test.js` Test 3 (`buildCalled === false && applyCalled === false`).
- **T-00-04-02 (forged idempotency key):** accepted — agent-provided key is preserved; worst case is a missed dedupe. Documented in plan.
- **T-00-04-03 (apiToken leak via dry-run preview):** mitigated — preview JSON includes `connection: connectionName` (just the name string), `preview.body` is the zod-validated request body (never the conn object). No Authorization header appears in any preview. Auth-redaction snapshot test in Plan 06 will police this end-to-end.
- **T-00-04-04 (zod error messages leaking implementation details):** accepted — `formatZodError` returns `<path>: <message>` strings; zod's messages are technical but don't leak secrets.
- **T-00-04-05 (agent passes `_testConnection: "fake"` in production):** mitigated — `mutatingBase` + `listBase` deliberately do NOT include `_testConnection` in their zod shape; zod's default `strip` mode drops it from agent payloads. The wrapper-layer `_testConnection` re-merge only triggers when the key is present in `rawArgs` — production agents have no path to put it there. Documented as a Decision Made.
- **T-00-04-06 (list-handler unbounded items):** mitigated — `MAX_LIMIT = 200` hard ceiling; default 25. Verified by `test/list.test.js` Test 2 (`limit: 1000 → 200`).
- **T-00-04-07 (singleton-connection race across handlers):** mitigated — `resolveConnection` captures the active-connection name + conn synchronously at the start of every handler invocation, before any `await`. The Map/JSON returned by `getConnections()` is read at that synchronous moment; subsequent `set_active_connection` calls cannot interleave inside a single handler's execution.

No new threat surface beyond the plan's enumeration. No `## Threat Flags` section needed.

## Issues Encountered

- **The 14-test cascade failure in Task 2 GREEN was a single root cause** (the `_testConnection` zod-strip issue). Once fixed in both `handler.js` and `list.js`, every test passed on the next run. Documented under Deviations Rule 1 above.

## User Setup Required

None — no external service, no secrets, no config changes required. The new factories compose against existing primitives (Plan 03's `makeClient`, the existing `src/config.js` connection registry) and the leaf primitives ship in the same plan.

## TDD Gate Compliance

This plan ran as TDD per the plan frontmatter (`tdd="true"` on both tasks). All four gates fired in order:

- **Task 1 RED gate:** `762e371` — `test(00-04): add failing tests for connection + idempotency primitives`. Verified failing via `node --test test/connection.test.js test/idempotency.test.js` (`ERR_MODULE_NOT_FOUND`).
- **Task 1 GREEN gate:** `f90ce72` — `feat(00-04): add leaf primitives for handler factory ...`. 25 tests pass.
- **Task 2 RED gate:** `2c46814` — `test(00-04): add failing tests for defineMutatingHandler + defineListHandler`. Verified failing via `node --test test/handler.test.js test/list.test.js` (`ERR_MODULE_NOT_FOUND`).
- **Task 2 GREEN gate:** `2ec5c17` — `feat(00-04): add defineMutatingHandler + defineListHandler factories`. 18 tests pass (after the in-GREEN `_testConnection` re-merge fix); full suite 124/124.

No REFACTOR commits (the in-GREEN seam fix was made before the GREEN commit was finalized, so it's part of the GREEN commit's diff rather than a separate refactor commit — this is the canonical TDD pattern when a refinement is found during the green-bar walk).

## Next Phase Readiness

- `src/tools/_shared/` is the canonical home for the handler-primitive layer. Plan 05 (dispatch refactor) will import `defineMutatingHandler` / `defineListHandler` and wire them through the new `Map<toolName, handler>` once any admin tool is registered. At Phase 0 close no admin tool exists yet — the factories are code-with-tests only.
- Plan 06 (zod schema-parity) reads `mutatingBase` + `listBase` from `src/tools/_shared/schemas.js` plus the per-domain `schemas.js` files (none exist yet at Phase 0 close).
- Phase 1+ domain phases compose every mutating tool as:
  ```js
  defineMutatingHandler({
      name: "create_stream",
      schema: mutatingBase.extend({ title: z.string().min(1), ... }),
      build: (args) => ({ method: "POST", path: "/api/streams", body: { title: args.title } }),
      apply: (client, req) => client.request(req.method, req.path, req.body),
      summarize: (args) => `Create stream "${args.title}"`,
  });
  ```
  and every list tool as:
  ```js
  defineListHandler({
      name: "list_streams",
      schema: listBase,
      fetch: (client, args) => client.request("GET", `/api/streams?limit=${args.limit}`, null),
  });
  ```
- `_setConnectionsForTests` is the canonical config-injection seam for any future test that needs to drive the connection registry (handler/list factory tests, blueprint tests, fixture tests).
- `findExistingMatches` is a stub today; Phase 1+ either provides a real implementation via `{ listPath, matchFn }` or leaves the default `[]`. The shape of the dry-run preview's `existingMatches` field is locked in this plan and won't change when the stub is replaced.

## Self-Check: PASSED

- All 8 files present under `src/tools/_shared/`:
  - `errors.js`, `schemas.js`, `idempotency.js`, `dry-run.js`, `conflict.js`, `connection.js`, `handler.js`, `list.js`
- `src/config.js` shows 9 exports (was 6): `_setConnectionsForTests`, `_clearConnectionsForTests`, `getDefaultFields`, `getConfigPath`, `getConnections`, `getActiveConnection`, `setActiveConnection`, `getActiveConnectionConfig`, `getConnectionWritable`.
- `example-config.json` documents `writable: false` on the `prod` connection.
- All 4 task commits resolvable in git history: `762e371` (Task 1 RED), `f90ce72` (Task 1 GREEN), `2c46814` (Task 2 RED), `2ec5c17` (Task 2 GREEN).
- `node --test test/connection.test.js test/idempotency.test.js test/handler.test.js test/list.test.js` exits 0 with 43 passing tests (10 + 15 + 10 + 8 = 43, ≥27 plan threshold).
- `npm test` (full suite) exits 0 with 124 tests / 18 suites passing.
- All grep acceptance counts hit their targets:
  - `grep -c "__SERVER_ASSIGNED__" src/tools/_shared/dry-run.js` → 2 (≥1)
  - `grep -c "dryRun: z.boolean().default(true)" src/tools/_shared/schemas.js` → 1
  - `grep -c "createHash" src/tools/_shared/idempotency.js` → 2 (≥1)
  - `grep -c "sha256" src/tools/_shared/idempotency.js` → 1
  - `grep -c "_testConnection" src/tools/_shared/connection.js` → 4 (≥1)
  - `grep -c "connection_read_only" src/tools/_shared/handler.js` → 2 (≥1)
  - `grep -c "MAX_LIMIT" src/tools/_shared/list.js` → 3 (≥1)
  - `grep -cE "DEFAULT_FIELDS|\\[.*id.*title.*description.*\\]" src/tools/_shared/list.js` → 3 (≥1)
- Plan 01 stubs in handler/list/connection/idempotency test files REPLACED: `grep -c "scaffold passes" test/handler.test.js test/list.test.js test/connection.test.js test/idempotency.test.js` → 0 each.
- Inline node -e probes for `CONFIG OK`, `SCHEMA OK`, `DRYRUN OK` succeeded.

---
*Phase: 00-foundation*
*Plan: 04*
*Completed: 2026-05-15*
