---
phase: 02-index-sets-retention
plan: 01
subsystem: api
tags: [index-sets, handler-amendments, await-system-job, info-substring-discovery, u1-smoke, polling-primitive]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: defineMutatingHandler / defineListHandler factories, findExistingMatches stub, makeClient HTTP client, dispatch Map, mutatingBase / listBase zod schemas
  - phase: 01-inputs-extractors
    provides: cascades-forwarding amendment precedent (Plan 01-02), per-domain folder layout, defaultFields override (Plan 01-01), assertSchemaParityForTool helper
provides:
  - "_confirmationToken forwarding from build() into dry-run preview (additive; back-compat for tools that don't set it)"
  - "requireConfirm({ args, req }) → token|null apply-time gate; isError reason 'confirmation_mismatch' on missing/wrong confirm; returning null is a no-op"
  - "findExistingMatches normalizes the { index_sets: [...] } envelope shape"
  - "src/tools/_shared/system-job.js — cross-domain await_system_job primitive with exponential backoff, jobId / jobIdOrEnvelope / info_substring discovery, 404 synthetic completion, timeout clamp"
  - "list_index_sets (INDEX-01) — narrow projection [id, title, description, default, writable, can_be_default, index_prefix]"
  - "get_index_set (INDEX-02) — full IndexSetResponse DTO"
  - "02-U1-SMOKE.md branch artifact: U1 → MERGE_FROM_CURRENT, Cycle → SYNC_OPTION_A (both UNREACHABLE_DEFAULT_* per protocol)"
affects: ["02-02 (create/update_index_set consumes the U1 decision)", "02-03 (delete_index_set consumes _confirmationToken + requireConfirm)", "02-04 (cycle_deflector consumes the SYNC_OPTION_A branch)", "phase 03+ (await_system_job is the canonical polling primitive)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-domain primitive lives in _shared/ when intended for reuse across phases (system-job.js precedent)"
    - "Apply-time confirmation gate via requireConfirm callback returning a token-or-null sentinel"
    - "Wrapper passes apply()'s isError envelope through verbatim (additive amendment supporting structured-error apply paths)"
    - "Discovery-path zod refinement: exactly-one-of pattern for mutually exclusive identifier inputs"
    - "Test-time deterministic sleep replacement via _setSleepForTests(null|fn) seam"

key-files:
  created:
    - "src/tools/_shared/system-job.js"
    - "src/tools/index-sets/index.js"
    - "src/tools/index-sets/schemas.js"
    - "src/tools/index-sets/list-index-sets.js"
    - "src/tools/index-sets/get-index-set.js"
    - "test/system-job.test.js"
    - "test/index-sets.test.js"
    - ".planning/phases/02-index-sets-retention/02-U1-SMOKE.md"
  modified:
    - "src/tools/_shared/handler.js"
    - "src/tools/_shared/conflict.js"
    - "src/tools/_register.js"
    - "src/tools.js"
    - "test/handler.test.js"
    - "test/conflict.test.js"
    - "test/schema-parity.test.js"

key-decisions:
  - "U1 smoke unreachable (no Graylog API token in executor environment) → UNREACHABLE_DEFAULT_MERGE for Plan 02-02 (update_index_set uses merge-from-current) and SYNC_OPTION_A for Plan 02-04 (cycle_deflector synchronous envelope with side_effects.observable_at)"
  - "_confirmationToken lives on the build() request descriptor as a leading-underscore framework-internal key; forwarded into preview JSON ONLY when present (back-compat for every Phase 0/1 tool)"
  - "requireConfirm callback returns null when no token is required (delete_index_set with deleteIndices:false) so the gate is a no-op — uniform shape, opt-in semantics"
  - "Handler.js additive amendment (Rule 3 blocking): pass through apply()'s isError envelope verbatim. Required by await_system_job's info_substring path to surface job_not_found / ambiguous_info_substring reasons without throwing a typed GraylogError"
  - "await_system_job composes through defineMutatingHandler even though it issues only GETs (D-07 — uniform writable-flag inheritance; dryRun:true returns the polling plan without any GETs)"
  - "AwaitSystemJobSchema's exactly-one-of refinement (jobId | jobIdOrEnvelope | info_substring) wraps mutatingBase in a ZodEffects — schema-parity's getShape helper handles this via _def.schema.shape fallback"
  - "info_substring matches via String.prototype.includes (literal substring, no regex eval) — T-02-01-10 mitigation against catastrophic-backtracking DoS"
  - "list_index_sets queries /api/system/indices/index_sets?stats=false to keep the list response cheap; stats are fetched per-id when needed by delete_index_set's dry-run preview (Plan 02-03)"
  - "Tool count 35 → 38: list_index_sets + get_index_set + await_system_job"

patterns-established:
  - "Cross-domain polling primitive pattern: defineMutatingHandler with a postApplyEstimate-only build() and an apply() that runs the polling loop"
  - "Discovery-via-substring pattern: list endpoint + .includes() match + 0/1/2+ disposition with structured error envelope listing candidate ids"
  - "Forgiving-input zod union for identifier args (bare string OR envelope object with multiple possible key shapes) backed by an extractJobId helper"

requirements-completed: [INDEX-01, INDEX-02, INDEX-08]

# Metrics
duration: ~10 min
completed: 2026-05-15
---

# Phase 2 Plan 1: Foundation amendments + await_system_job + read tools Summary

**Two additive handler amendments (`_confirmationToken` forwarding + `requireConfirm` apply-time gate), the cross-domain `await_system_job` polling primitive with `info_substring` discovery (UPDATED D-15), `list_index_sets` (INDEX-01) + `get_index_set` (INDEX-02) read tools, and the U1+cycle live-smoke decision artifact that branches Plans 02 and 04.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-15T14:15:18Z
- **Completed:** 2026-05-15T14:25:34Z
- **Tasks:** 4
- **Files modified:** 15 (8 created + 7 modified)
- **Tests added:** +36 (235 baseline → 271 total — exceeded plan's ~20 estimate)
- **Tool count:** 35 → 38 (list_index_sets, get_index_set, await_system_job)

## Accomplishments

- Two additive wrapper hooks landed in `defineMutatingHandler`:
  - `build()` may return `_confirmationToken: <hex>` → dry-run preview surfaces `confirmationToken: <hex>` only when present (Plan 03 will consume this for delete_index_set's C1 confirmation hash).
  - `spec.requireConfirm({ args, req }) → token|null` apply-time gate: mismatched/missing `args.confirm` → isError with `reason: 'confirmation_mismatch'` and `apply()` not called. Returning null is a no-op (delete_index_set with `deleteIndices:false` issues no token).
- `findExistingMatches` envelope chain now unwraps `{ index_sets: [...] }` returned by `/api/system/indices/index_sets`. Plan 02-02's `create_index_set` consumes this for M5 list-before-create idempotency.
- `await_system_job` (INDEX-08) shipped under `src/tools/_shared/system-job.js` as the cross-domain polling primitive. Composes through `defineMutatingHandler` so dryRun + writable-flag inheritance is uniform (D-07).
  - Exponential backoff `[500, 1000, 2000, 4000, 5000]` ms, capped at 5s; default 60s timeout, hard zod-bounded 600s max.
  - Accepts EXACTLY ONE of `jobId`, `jobIdOrEnvelope` (forgiving input — bare string OR `{job_id|jobId|id}` envelope object), or `info_substring` (UPDATED D-15 discovery path); enforced via zod `.refine()`.
  - `info_substring` resolution: 0 matches → `isError` reason `job_not_found`; 1 match → poll that job's id; 2+ matches → `isError` reason `ambiguous_info_substring` with the list of candidate ids so the agent can disambiguate.
  - 404 on the poll endpoint interpreted as `completed:true` with `synthetic:true` finalStatus (job pruned from running-jobs map per Graylog's lifecycle).
- `list_index_sets` (INDEX-01): defineListHandler with `defaultFields: [id, title, description, default, writable, can_be_default, index_prefix]` per RESEARCH.md's narrow-projection rationale. Unwraps the `{ total, index_sets: [...], stats: {} }` envelope; queries with `?stats=false` to keep the list response cheap.
- `get_index_set` (INDEX-02): plain async handler returning the full IndexSetResponse DTO. Errors map through `wrapGraylogError` so 404 (index set not found) surfaces as a clean MCP error envelope.
- `02-U1-SMOKE.md` decision artifact records the live-smoke outcome (no API token in this environment → `UNREACHABLE_DEFAULT_*` paths) so Plans 02-02 and 02-04 have a deterministic input.

## Task Commits

Each task was committed atomically:

1. **Task 1: U1 + cycle live-smoke decision artifact** — `bf5a274` (docs)
2. **Task 2: handler.js `_confirmationToken` + `requireConfirm` + conflict.js index_sets envelope (TDD)**
   - RED: `df887b2` (test)
   - GREEN: `9b982ea` (feat)
3. **Task 3: await_system_job polling primitive (TDD)**
   - RED: `b6cfd8a` (test)
   - GREEN: `403fdfb` (feat)
4. **Task 4: list_index_sets + get_index_set + register all 3 tools (TDD)**
   - RED: `7a95858` (test)
   - GREEN: `a322a67` (feat)

**Plan metadata commit:** to be added after this SUMMARY + STATE.md update.

## Files Created/Modified

### Created (8)

- `src/tools/_shared/system-job.js` — Cross-domain await_system_job primitive: BACKOFF_SCHEDULE, DEFAULT_TIMEOUT_MS, AwaitSystemJobSchema (exactly-one-of refine), extractJobId helper, resolveJobIdFromInfo discovery helper, handleAwaitSystemJob, _setSleepForTests test seam.
- `src/tools/index-sets/index.js` — Side-effect barrel registering list_index_sets, get_index_set, await_system_job.
- `src/tools/index-sets/schemas.js` — ListIndexSetsSchema (= listBase) and GetIndexSetSchema (indexSetId required).
- `src/tools/index-sets/list-index-sets.js` — defineListHandler with the 7-field default projection and `?stats=false` envelope unwrap.
- `src/tools/index-sets/get-index-set.js` — Plain async handler returning the full IndexSetResponse DTO.
- `test/system-job.test.js` — 18 tests covering jobId path (dry-run, success, 404, timeout, error, zod cap), exactly-one-of refine, info_substring discovery (1/0/2+ matches + dry-run plan), and module-export sanity checks.
- `test/index-sets.test.js` — 7 tests covering list projection / envelope unwrap / fields:'all' / limit clamp + get_index_set DTO/404/zod.
- `.planning/phases/02-index-sets-retention/02-U1-SMOKE.md` — Decision artifact recording the U1 + cycle live-smoke outcome (UNREACHABLE_DEFAULT_MERGE / SYNC_OPTION_A) so Plans 02 + 04 have a deterministic branch input.

### Modified (7)

- `src/tools/_shared/handler.js` — Three additive amendments:
  1. Destructure `requireConfirm` from spec alongside name/schema/build/apply/summarize.
  2. Spread `...(req._confirmationToken ? { confirmationToken: req._confirmationToken } : {})` into the dry-run preview JSON (between existingMatches and cascades).
  3. New step 6b: apply-time confirmation gate.
  4. apply() return guard: pass `{ isError: true }` envelopes through verbatim (Rule 3 blocking).
- `src/tools/_shared/conflict.js` — One additive line: `?? response?.index_sets` in the envelope chain.
- `src/tools/_register.js` — Side-effect import of `./index-sets/index.js`.
- `src/tools.js` — 3 new toolDefinitions entries (list_index_sets, get_index_set, await_system_job).
- `test/handler.test.js` — +6 tests covering the two new hooks.
- `test/conflict.test.js` — +2 tests (index_sets envelope + inputs back-compat regression guard).
- `test/schema-parity.test.js` — +3 schema-parity assertions for the 3 new tools.

## Decisions Made

See `key-decisions:` in the frontmatter for the full list. Highlights:

- **U1 smoke environment had no Graylog API token** (no `~/.graylog-mcp/config.json`), so the protocol's "no matching connection exists" branch fired. The artifact records `UNREACHABLE_DEFAULT_MERGE` for Plan 02-02's update_index_set wire-build (merge-from-current — safe because index-set configs carry NO encrypted fields, C3 not reachable) and `SYNC_OPTION_A` for Plan 02-04's cycle_deflector (synchronous envelope with `side_effects.observable_at: "/system/jobs"` for the IndexRangesUpdateJob — source-verified in RESEARCH.md against DeflectorResource.java).
- **`_confirmationToken` as a leading-underscore framework-internal key on the request descriptor** keeps the apply()-side discoverable surface for `requireConfirm` clean — Plan 03's delete_index_set will compute the hash inside `build()` and route it through both the dry-run preview (via the underscore-key forwarding) AND the apply-time gate (via `requireConfirm: ({ req }) => req._confirmationToken ?? null`).
- **`info_substring` discovery surface** lives entirely inside `await_system_job` apply path — the list call fires only when `dryRun:false` (dry-run returns the resolution plan WITHOUT firing the list). Plan 03's delete_index_set apply envelope can therefore include text like "agent should call `await_system_job` with `info_substring: <indexSetId>`" without any wrapper-side circular dependency.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Handler.js apply() return guard for isError envelopes**

- **Found during:** Task 3 (await_system_job GREEN implementation)
- **Issue:** The plan's `apply()` callback for `info_substring` discovery returns a structured `{ isError: true, reason, content: [...] }` envelope on 0-match / 2+-match outcomes. The existing wrapper's apply branch (handler.js line ~163 before amendment) unconditionally normalized apply()'s return via `req.normalize?.(raw) ?? { id: raw?.id, body: raw }` and wrapped it as `{ applied: true, result: { id, body } }`. Tests 12 and 13 (info_substring 0/2+ matches) failed because the isError envelope was getting buried inside `applied: true, result: { body: <isError envelope> }` instead of being returned verbatim. Per the plan's skeleton: "The wrapper's apply() return is rendered verbatim if it carries isError:true" — the wrapper did not yet implement this.
- **Fix:** Added an additive 4-line guard in handler.js BEFORE the normalize step: `if (raw && raw.isError === true) { return raw; }`. Pass-through is opt-in via the explicit `isError: true` tag on the apply() return; no existing tool's behavior changes (existing apply() callbacks return plain DTOs, never an isError envelope).
- **Files modified:** `src/tools/_shared/handler.js`
- **Verification:** Tests 12 + 13 pass; all 18 system-job tests green; full suite 271/271 with zero regressions.
- **Committed in:** `403fdfb` (part of Task 3 GREEN commit — co-changed with system-job.js creation since the two changes are inseparable: shipping system-job.js without the guard fails the discovery-path tests).

---

**Total deviations:** 1 auto-fixed (1 Rule 3 blocking)
**Impact on plan:** The amendment is structurally consistent with handler.js's other opt-in hooks (`_confirmationToken`, `cascades`, `existingMatches`): each is detected by a sentinel-key presence and emitted/handled additively. No scope creep — Plan 02-01's threat model T-02-01-01 / T-02-01-04 stay fully covered. The pattern is reusable by any future tool whose apply() needs to surface a structured-error reason without throwing a typed GraylogError.

## Issues Encountered

- **U1 smoke could not be empirically executed** — no Graylog API token in the executor environment (`~/.graylog-mcp/config.json` does not exist). The instance at `http://<graylog-host>:9000` is reachable (HTTP 401 from an unauthenticated probe — confirms a live Graylog), but smoke calls require auth. Resolution: followed `<u1_smoke_protocol>`'s "no matching connection exists" branch and recorded `UNREACHABLE_DEFAULT_*` decisions. Both decisions are documented as safe defaults in RESEARCH.md §Pitfall U1 and §Cycle Deflector Behavior. Plans 02 and 04 can re-run the smoke later if/when credentials become available; the decisions are reversible (the apply payloads stay valid wire shapes under either branch, the dry-run preview JSON gains/loses one optional key).

## User Setup Required

None — no external service configuration required beyond the existing connection registry shape (which Phase 0 + 1 already established).

## Next Phase Readiness

- **Plan 02-02 hand-off:** `findExistingMatches` envelope chain ready for `create_index_set`'s M5 list-before-create. U1 decision recorded as `UNREACHABLE_DEFAULT_MERGE` — `update_index_set` ships merge-from-current (Phase 1's `update_extractor` pattern; safe because index-set configs carry no encrypted fields).
- **Plan 02-03 hand-off:** `_confirmationToken` forwarding + `requireConfirm` apply-time gate ready for `delete_index_set`'s C1 confirmation hash. Tool description should reference `await_system_job` with `info_substring: <indexSetId>` for the async cleanup-job discovery (the apply envelope deliberately omits `job_id` per UPDATED D-15).
- **Plan 02-04 hand-off:** Cycle decision recorded as `SYNC_OPTION_A`. `cycle_deflector` ships the synchronous envelope `{ rotated: true, message, side_effects: { observable_at: "/system/jobs", describes: ... } }`. Agents that care about the IndexRangesUpdateJob can call `await_system_job` with `info_substring: <indexSetId>` to wait for the rebuild.
- **Plan 02-05 hand-off:** 3 new schema-parity assertions already shipped (list_index_sets, get_index_set, await_system_job). Plan 02-05's schema-parity enrichment will add the remaining 5 mutating-tool schemas (create / update / delete / set_default / cycle_deflector) once Plans 02-02 / 02-03 / 02-04 land. Snapshot fixtures for the cross-cutting amendments (confirmationToken + cascades together, await_system_job dry-run plan, info_substring discovery envelope) are not yet captured — Plan 02-05 can bake them as deterministic snapshot fixtures alongside the per-tool fixtures.
- **No blockers.**

## Self-Check: PASSED

All 15 claimed file paths exist on disk; all 7 claimed commit hashes exist in
`git log --oneline --all`. Full `npm test` returns 271 / 271 passing.

---
*Phase: 02-index-sets-retention*
*Completed: 2026-05-15*
