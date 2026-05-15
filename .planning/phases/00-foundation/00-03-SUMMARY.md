---
phase: 00-foundation
plan: 03
subsystem: graylog-http-client
tags: [axios, auth, typed-errors, response-normalizer, writable-flag, defense-in-depth, tdd]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: "node:test runner via npm test; graylog-client + normalize test stubs ready to fill in"
provides:
  - "src/graylog/client.js — single axios call site for every future Graylog admin tool, with auth/headers/timeout/typed-errors/writable-flag refusal"
  - "src/graylog/auth.js — buildAuth(apiToken) axios-compatible Basic-auth config builder"
  - "src/graylog/errors.js — GraylogError hierarchy (Validation/Permission/NotFound/Conflict/Unprocessable) + mapGraylogError(res, ctx) status classifier"
  - "src/graylog/normalize.js — toIdBody(response, hint) extracting { id, body } from 10 Graylog create-response shape variants"
  - "_setCaptureRequest / _clearCaptureRequest test seam so unit tests can exercise makeClient.request without network access"
  - "D-07 client-layer defense-in-depth (Pitfall 4): conn.writable === false refuses every non-GET before axios is touched"
affects:
  - "00-04 (defineMutatingHandler wrapper consumes mapGraylogError / GraylogError to render canonical MCP error responses)"
  - "00-05 (dispatch refactor — handlers may use makeClient when migrating read tools, but query.js stays untouched)"
  - "00-06 (zod schemas integrate with the wrapper's error path; client.js is unaffected)"
  - "All Phase 1+ admin tools (every mutating endpoint goes through makeClient.request — no per-tool axios)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single outbound HTTP call site: every admin tool goes through makeClient(conn).request(method, path, body) — header/auth/timeout/error-classification logic exists in exactly one file"
    - "Typed-error classifier as a pure function over a parsed response: mapGraylogError(res, ctx) maps status → class without touching axios internals, making it directly testable without HTTP mocks"
    - "Test seam by module-level mutable + _-prefix convention: _setCaptureRequest / _clearCaptureRequest are exported but conventionally test-only; afterEach in test suites resets the seam to null"
    - "Defense-in-depth across layers: D-07 writable check lives in BOTH the wrapper (Plan 04, future) AND the client (this plan). A blueprint that bypasses defineMutatingHandler still cannot mutate against a read-only connection."

key-files:
  created:
    - "src/graylog/auth.js"
    - "src/graylog/errors.js"
    - "src/graylog/normalize.js"
    - "src/graylog/client.js"
  modified:
    - "test/normalize.test.js (replaced 1 stub assertion with 8 real shape-coverage tests)"
    - "test/graylog-client.test.js (replaced 1 stub assertion with 15 tests covering writable refusal, seam wiring, status-code classification, message fallback)"

key-decisions:
  - "Test status-code mapping via direct mapGraylogError() calls, NOT via mock.module() — Node 22.x mock.module requires --experimental-test-module-mocks and is flaky across patch versions; the seam tests prove makeClient.request reaches the classifier, and the direct tests prove the classifier is correct"
  - "_setCaptureRequest is an exported function (not a module-internal toggle) so tests can import it cleanly; the `_` prefix and the comment block in client.js mark it test-only"
  - "No modifications to src/query.js — searchGraylog and fetchStreams stay as-is; the new client is purely additive. Migration of read tools to makeClient is deferred to per-domain phases."
  - "GraylogError constructor accepts a default empty object `({ status, method, path, body } = {})` so callers don't have to remember to pass the context object (defensive against future careless throws)"

patterns-established:
  - "Test header for new infrastructure modules: `import { test, afterEach } from 'node:test'; import assert from 'node:assert/strict'; import './snapshot-config.js'; import { ... } from '../src/graylog/<module>.js'`"
  - "afterEach(() => _clearCaptureRequest()) is the canonical seam reset for any test file that mutates module-level state in src/graylog/client.js"
  - "Status-code classifier as a pure function over (res, ctx) — every later domain wrapper can call mapGraylogError directly when it needs to test error paths without spinning up axios"

requirements-completed: [FOUND-02, FOUND-08]

# Metrics
duration: ~3 min
completed: 2026-05-15
---

# Phase 00 Plan 03: Graylog HTTP Client Summary

**The single Graylog HTTP-client layer (`src/graylog/{client,auth,errors,normalize}.js`) lands under TDD with the D-07 client-layer writable-flag defense, typed error hierarchy, and response normalizer — `npm test` goes from 64 → 85 green tests, no src/query.js or src/index.js touched.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-15T06:44:45Z
- **Completed:** 2026-05-15T06:47:41Z
- **Tasks:** 2 (TDD: RED + GREEN per task)
- **Commits:** 4 task commits (2 × RED test, 2 × GREEN feat) + 1 metadata commit
- **Files:** 4 created (all under `src/graylog/`), 2 modified (test stubs replaced)
- **Test growth:** +21 tests (8 normalize + 13 net-new client) against baseline of 64 from Plan 02

## Accomplishments

- **`src/graylog/auth.js`** (10 lines): `buildAuth(apiToken)` returns the axios-compatible `{ username, password: "token" }` config — Graylog's literal-string `"token"` password convention extracted from `src/query.js:107-110` into one named export.
- **`src/graylog/errors.js`** (38 lines): full typed-error hierarchy (`GraylogError`, `GraylogValidationError`, `GraylogPermissionError`, `GraylogNotFoundError`, `GraylogConflictError`, `GraylogUnprocessableError`) plus `mapGraylogError(res, ctx)` classifier — 400/403/404/409/422 map to typed subclasses; other statuses fall through to base `GraylogError`. Message falls through `res.data?.message → res.statusText → "HTTP <status>"`.
- **`src/graylog/normalize.js`** (19 lines): `toIdBody(response, hint)` walks an ordered `idFields` candidate list and returns `{ id, body }` for any of the 10 Graylog create-response shapes documented in RESEARCH.md §Pattern 5. Default candidates `["id"]` cover most cases; per-endpoint hints handle `stream_id` / `streamrule_id` / `extractor_id`.
- **`src/graylog/client.js`** (75 lines): `makeClient(conn).request(method, path, body)` is the single outbound HTTP call site for every future admin tool — Accept/Content-Type/`X-Requested-By: graylog-mcp` headers, Basic auth via `buildAuth`, `validateStatus: () => true` + `mapGraylogError`, 60s timeout, network-failure wrapper preserving method+path context. D-07 client-layer refusal: `conn.writable === false` blocks every non-GET BEFORE axios is reached, throwing `GraylogError(status: 0)` with a `read-only` message. `_setCaptureRequest` / `_clearCaptureRequest` provide a test seam that bypasses axios entirely.
- **23 unit tests** across `test/graylog-client.test.js` (15) and `test/normalize.test.js` (8) — all green.
- **`npm test`** exits 0 with **85 tests / 18 suites** passing (was 64 at Plan 02 close).

## Task Commits

| # | Task | Commit | Type | Note |
|---|------|--------|------|------|
| 1a | Task 1 RED: failing tests for toIdBody (8 shape variants + null/miss/precedence) | `dc9f444` | test | RED gate |
| 1b | Task 1 GREEN: auth.js + errors.js + normalize.js | `7b97fb4` | feat | GREEN gate |
| 2a | Task 2 RED: failing tests for graylog-client (15 covering writable/seam/mapping) | `d29bf29` | test | RED gate |
| 2b | Task 2 GREEN: client.js with makeClient, D-07 defense, test seam | `8cddb7e` | feat | GREEN gate |

The plan-level TDD gate sequence (RED → GREEN per task) is satisfied. No REFACTOR commit needed — the GREEN files came in at the right shape and size on first pass.

## Files Created/Modified

**Created (4):**
- `src/graylog/auth.js` — 10 lines, single export `buildAuth(apiToken)`
- `src/graylog/errors.js` — 38 lines, 6 exported classes + 1 classifier
- `src/graylog/normalize.js` — 19 lines, single export `toIdBody(response, hint)`
- `src/graylog/client.js` — 75 lines, exports `makeClient`, `_setCaptureRequest`, `_clearCaptureRequest`

**Modified (2):**
- `test/normalize.test.js` — replaced 1 stub assertion with 8 real `test()` blocks covering 4 distinct shape variants + null + undefined + miss + ordered-candidate precedence (FOUND-08 requires ≥3 shapes; delivered 4).
- `test/graylog-client.test.js` — replaced 1 stub assertion with 15 `test()` blocks: 5 writable/seam tests, 7 status-code/message-fallback tests via direct `mapGraylogError`, 2 seam-wiring tests, 1 buildAuth sanity test.

## Decisions Made

- **Status-code mapping tested via direct `mapGraylogError()` calls, not via mocked axios.** Node 22 ships `mock.module()` but it requires `--experimental-test-module-mocks` and behaves inconsistently across 22.x patch versions; making the suite depend on it would be brittle. The plan's `<action>` block explicitly authorises this fallback. The seam tests (`_setCaptureRequest`) prove that `makeClient.request` reaches the classifier and that the writable-flag check runs before any axios call; the direct `mapGraylogError` tests prove the classifier produces the right typed subclass. Together they cover the FOUND-02 contract end-to-end without ever opening a socket.
- **`_setCaptureRequest` is exported (not a module-private mutator).** Tests import it cleanly; the `_` prefix plus an explicit "test-only" comment block in `client.js` flags production-misuse risk. The `afterEach(() => _clearCaptureRequest())` reset is the canonical pattern future tests should follow.
- **`GraylogError`'s constructor accepts a default empty options object** (`({ status, method, path, body } = {})`). Callers that throw the base class without remembering to pass the ctx object still get a well-formed instance (with `status`/`method`/`path`/`body` all `undefined`) rather than a `TypeError: Cannot destructure of undefined`. The typed subclasses delegate to this constructor via prototype chain, so they inherit the same defensive default.
- **No modifications to `src/query.js`** — the existing `searchGraylog` and `fetchStreams` functions stay exactly as-is. The new client is purely additive. Migration of the existing read tools to `makeClient` is deferred to the per-domain phases (Phase 3 streams, Phase 4 pipelines, etc.); Phase 0's job is to land the primitive, not retrofit.

## Deviations from Plan

None. The plan executed exactly as written.

Specifically:
- No Rule 1 bugs found (no broken behavior caught during testing).
- No Rule 2 missing functionality added (the plan explicitly defines the contract and the contract is complete: auth + headers + timeout + typed errors + writable-flag refusal + test seam + network-failure wrapper).
- No Rule 3 blockers (`npm install` from Plan 02's lockfile sync already has axios in `node_modules`).
- No Rule 4 architectural questions (the design is fully prescribed in `<interfaces>` and `<action>`).

The plan's `<action>` block offered two test patterns for status-code mapping (mocked axios via `mock.module` OR direct `mapGraylogError` calls); we chose the latter and documented why under Decisions Made. Both validate the same contract — this is not a deviation, it's a plan-authorised choice.

## Threat Surface

All threats already enumerated in the plan's `<threat_model>` block (T-00-03-01..06) are mitigated by the shipped code:

- **T-00-03-02 (writable-flag bypass):** `client.js:37-42` — non-GET against `conn.writable === false` throws `GraylogError(status: 0)` before axios. Verified by 3 tests (POST, PUT, DELETE all refused; GET still allowed).
- **T-00-03-03 (apiToken leakage):** `GraylogError` carries `.body` (response data) but never the request `auth` config; the auth object lives only inside the axios call site. No new leak surface introduced.
- **T-00-03-04 (test seam in production):** `_setCaptureRequest` / `_clearCaptureRequest` carry the `_` prefix and explicit "test-only" comment block (`client.js:7-9, 17-25`).
- **T-00-03-05 (timeout):** `timeout: 60_000` (60s) per RESEARCH.md Q3.
- **T-00-03-06 (network failure):** wrapped in try/catch that re-throws plain `Error` with method+path context.

No new threat surface beyond what the plan covered. No `## Threat Flags` section needed.

## Issues Encountered

None.

## User Setup Required

None — the new files are pure JS, no new dependencies, no configuration. Existing `~/.graylog-mcp/config.json` still works; the new client reads `conn.baseUrl` / `conn.apiToken` (and optionally `conn.writable`) directly from a connection object, leaving config-file ingestion to Plan 04.

## TDD Gate Compliance

This plan ran as TDD per the plan frontmatter (`tdd="true"` on both tasks):

- **Task 1 RED gate:** `dc9f444` — `test(00-03): add failing tests for toIdBody response normalizer`. Verified failing via `node --test test/normalize.test.js` (ERR_MODULE_NOT_FOUND).
- **Task 1 GREEN gate:** `7b97fb4` — `feat(00-03): add graylog auth, typed errors, and response normalizer`. 8 tests pass.
- **Task 2 RED gate:** `d29bf29` — `test(00-03): add failing tests for graylog HTTP client`. Verified failing via `node --test test/graylog-client.test.js` (ERR_MODULE_NOT_FOUND).
- **Task 2 GREEN gate:** `8cddb7e` — `feat(00-03): add graylog HTTP client with typed errors and writable-flag defense`. 15 tests pass.

No REFACTOR gate (no cleanup needed; GREEN was clean on first pass).

## Next Phase Readiness

- `src/graylog/` is the canonical location for the HTTP-client primitive. Plan 04 (defineMutatingHandler wrapper) imports `GraylogError` and `mapGraylogError` from `src/graylog/errors.js` and consumes them in `wrapGraylogError(err, toolName)`.
- Plan 04 also reads `conn.writable` at the wrapper layer; this plan's client-layer check is the defense-in-depth complement (Pitfall 4). Plan 04 must NOT remove the client-layer check.
- Domain phases (1+) will migrate read tools to `makeClient` opportunistically; the wrapper is ready for both reads (`GET`) and writes (`POST` / `PUT` / `DELETE`).
- `_setCaptureRequest` / `_clearCaptureRequest` will be the test seam for every later domain test that needs to exercise mutating tools without a live Graylog.
- `mapGraylogError` is a pure function over `{ status, statusText, data }` + ctx, so future tests can construct it without axios.

## Self-Check: PASSED

- All 4 created files present on disk: `src/graylog/{auth,errors,normalize,client}.js` (verified via `ls -la src/graylog/`).
- All 4 task commits resolvable in git history: `dc9f444` (Task 1 RED), `7b97fb4` (Task 1 GREEN), `d29bf29` (Task 2 RED), `8cddb7e` (Task 2 GREEN).
- `node --test test/graylog-client.test.js test/normalize.test.js` exits 0 with 23 passing tests (15 client + 8 normalize) — ≥13 plan threshold met.
- `npm test` (full suite) exits 0 with 85 tests / 18 suites passing.
- All grep acceptance counts hit their targets:
  - `grep -c "export function buildAuth" src/graylog/auth.js` → 1
  - `grep -cE "export class Graylog(Validation|Permission|NotFound|Conflict|Unprocessable)Error" src/graylog/errors.js` → 5
  - `grep -c "export function mapGraylogError" src/graylog/errors.js` → 1
  - `grep -c "export function toIdBody" src/graylog/normalize.js` → 1
  - `grep -c "password: \"token\"" src/graylog/auth.js` → 1
  - `grep -c "X-Requested-By" src/graylog/client.js` → 1
  - `grep -c "graylog-mcp" src/graylog/client.js` → 1
  - `grep -c "timeout: 60_000" src/graylog/client.js` → 1
  - `grep -c "writable === false" src/graylog/client.js` → 1
  - `grep -cE "_setCaptureRequest|_clearCaptureRequest" src/graylog/client.js` → 4 (≥2 plan threshold met)
- Inline node -e probes for `AUTH OK` and `ERR OK` succeeded.
- No modifications to `src/query.js`, `src/index.js`, or `src/tools/*` — verified via `git log --oneline -- src/query.js src/index.js src/tools/` showing no commits since the baseline.

---
*Phase: 00-foundation*
*Plan: 03*
*Completed: 2026-05-15*
