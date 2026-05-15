---
phase: 02-index-sets-retention
plan: 04
subsystem: api
tags: [index-sets, set-default, cycle-deflector, m2-invariant, nd3, d-13-updated, d-14-updated, cycle-sync, sync-option-a]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: defineMutatingHandler, makeClient, mutatingBase, GraylogValidationError (Phase 0 — already shipped)
  - phase: 01-inputs-extractors
    provides: per-domain folder layout, async build() pre-flight pattern, err.reason convention (used by Plan 02-02's ND2 refusal)
  - phase: 02-index-sets-retention/02-01
    provides: index-sets domain barrel, 02-U1-SMOKE.md decision artifact (SYNC_OPTION_A for cycle_deflector)
  - phase: 02-index-sets-retention/02-02
    provides: ND pre-flight + structural-error pattern (update_index_set's default_index_set_must_be_writable mirror)
  - phase: 02-index-sets-retention/02-03
    provides: ND pre-flight + structural-error pattern (delete_index_set's default_index_set_undeletable mirror); wrapGraylogError reason surface (Rule 2 — err.reason renders as `[reason: <name>]` suffix AND propagates as out.reason on the MCP envelope)
provides:
  - "src/tools/index-sets/schemas.js — SetDefaultIndexSetSchema + CycleDeflectorSchema appended (both extend mutatingBase with only indexSetId; eligibility/writable are pre-flight wire concerns, not zod-layer concerns)"
  - "src/tools/index-sets/set-default-index-set.js — INDEX-06: defineMutatingHandler with UPDATED D-13 + m2 pre-flight reading can_be_default; refuses ineligible (events-style / system) index sets with reason default_eligibility_failed BEFORE any PUT"
  - "src/tools/index-sets/cycle-deflector.js — INDEX-07: defineMutatingHandler with ND3 writable pre-flight + UPDATED D-14 SYNCHRONOUS apply envelope { rotated:true, message, side_effects:{ observable_at:'/system/jobs', describes:'closed-index range rebuild...' } }"
affects: ["02-05 (schema-parity now covers 8 of 8 phase-2 mutating tools; snapshot fixtures pending — both new tools have minimal { indexSetId } shapes that are trivial to snapshot)", "phase 03+ (the ND pre-flight + GraylogValidationError + err.reason pattern is now established across 4 distinct invariants: ND1/ND2/ND3 + default_eligibility_failed — Phase 3+ blueprint tools can copy verbatim)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "UPDATED D-13 pattern: read the server's derived eligibility flag (can_be_default) rather than the underlying composition flag (regular). The derived flag is durable across future server-side eligibility-rule additions; the wrapper does not need to track per-rule logic."
    - "UPDATED D-14 sync envelope pattern: when the upstream operation is synchronous but has an async side-effect, surface the side-effect via `side_effects: { observable_at, describes }` instead of wrapping the whole envelope in D-15's async shape. The agent sees the rotation is complete on response AND has a hook for the secondary work."
    - "Multi-invariant ND-pre-flight pattern: 4 ND-style structural errors now ship — ND1 (default_index_set_undeletable, Plan 02-03), ND2 (default_index_set_must_be_writable, Plan 02-02), ND3 (non_writable_index_set, this plan), and m2 (default_eligibility_failed, this plan). All four are GraylogValidationError + err.reason throws in build() async, BEFORE the destructive call. Two-layer defense in every case (wrapper-side check + Graylog server-side check)."

key-files:
  created:
    - "src/tools/index-sets/set-default-index-set.js"
    - "src/tools/index-sets/cycle-deflector.js"
    - ".planning/phases/02-index-sets-retention/02-04-SUMMARY.md"
  modified:
    - "src/tools/index-sets/schemas.js (SetDefaultIndexSetSchema + CycleDeflectorSchema appended)"
    - "src/tools/index-sets/index.js (register set_default_index_set + cycle_deflector)"
    - "src/tools.js (2 new toolDefinitions; 41 -> 43)"
    - "test/index-sets.test.js (+10 tests)"
    - "test/schema-parity.test.js (+2 parity assertions)"

key-decisions:
  - "UPDATED D-13 + m2: set_default_index_set reads `current.can_be_default` (NOT `current.regular`) — the server's authoritative derived eligibility flag. The flag absorbs the `regular: true` invariant today AND any future server-side eligibility rules Graylog adds without a wrapper-side update. Ineligible index sets (events-style, system, or any future-rejected) surface reason `default_eligibility_failed` in dry-run BEFORE the PUT fires. The would-be 409 surfaces in dry-run, not apply."
  - "UPDATED D-14 (per 02-U1-SMOKE.md SYNC_OPTION_A): cycle_deflector ships the SYNCHRONOUS apply envelope `{ rotated: true, message, side_effects: { observable_at: '/system/jobs', describes: 'closed-index range rebuild...' } }` — NOT the D-15 async envelope. Source-verified against Graylog 7.0.6 DeflectorResource.cycle (calls indexSet.cycle() directly on the JVM thread; NOT via systemJobManager.submit). The closed-index range rebuild IS async and IS observable via /system/jobs — surfaced via side_effects.observable_at so an agent can call await_system_job with info_substring on the indexSetId if it cares about waiting for the rebuild."
  - "ND3 pre-flight (RESEARCH.md §Pitfall ND3): cycle_deflector reads current.writable in build() async; refuses with GraylogValidationError + reason `non_writable_index_set` BEFORE the POST. Two-layer defense — server-side DeflectorResource.checkCycle throws 400 if !indexSet.getConfig().isWritable(); wrapper-side check fires first and surfaces a structured error envelope."
  - "GraylogValidationError imported from src/graylog/errors.js (Phase 0 — already shipped). The file is NOT in this plan's files_modified. Both new tools throw the same Phase-0 type and assign `err.reason` on the instance before throwing — same pattern as Plan 02-02's ND2 refusal and Plan 02-03's ND1/D-05/confirmation_mismatch refusals."
  - "Schemas land together in one commit (Task 1 GREEN) rather than per-task. Both schemas are minimal `mutatingBase.extend({ indexSetId })` with no superRefine — a separate schema-only commit per task would add noise without value. The schema-parity tests are per-task to keep failure attribution clean."
  - "Tool count progression: 41 -> 42 (Task 1 set_default_index_set) -> 43 (Task 2 cycle_deflector). Both tools register via the standard index-sets domain barrel; assertAllToolsRegistered passes for the full 43-tool surface."

patterns-established:
  - "UPDATED D-14 sync envelope vs D-15 async envelope: when the primary operation is synchronous but has an asynchronous side-effect, use the sync envelope + side_effects.observable_at instead of the async envelope. The agent sees the primary action is complete AND has a structured hook for waiting on secondary work. Phase 3+ rotation/cycle-style operations can copy this template."
  - "Server's derived-eligibility-flag pattern: read the server's derived eligibility answer (e.g. can_be_default) rather than the underlying composition flag (e.g. regular). The derived flag absorbs future rule additions without requiring wrapper-side updates. The agent-facing error names the derived flag in the message so an MCP client can programmatically identify the structural problem."

requirements-completed: [INDEX-06, INDEX-07]

# Metrics
duration: ~6 min
completed: 2026-05-15
---

# Phase 2 Plan 4: set_default_index_set + cycle_deflector Summary

**Two mutating index-set tools (INDEX-06/07) shipped — set_default with the UPDATED D-13 + m2 `can_be_default` pre-flight (the would-be 409 surfaces in dry-run BEFORE any PUT), and cycle_deflector with the ND3 writable pre-flight + UPDATED D-14 SYNCHRONOUS apply envelope per 02-U1-SMOKE.md SYNC_OPTION_A. ROADMAP success criterion 3 ("set_default_index_set enforces the eligibility invariant — calling it against an ineligible / events-style / system index set surfaces a clear 409-style error in dry-run BEFORE any apply is attempted") provably met.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-15T15:08:01Z
- **Completed:** 2026-05-15T15:14:06Z
- **Tasks:** 2 (both TDD: RED → GREEN per task)
- **Files modified:** 6 (3 created + 3 modified, plus 2 test files)
- **Tests added:** +12 (323 baseline → 335 total — 5 set_default + 5 cycle + 2 schema-parity)
- **Tool count:** 41 → 43 (set_default_index_set + cycle_deflector — completes all 7 Phase-2 net-new mutating tools)

## Accomplishments

- **`SetDefaultIndexSetSchema`** added to `src/tools/index-sets/schemas.js` — minimal `mutatingBase.extend({ indexSetId })`. Eligibility is a pre-flight wire concern, not a zod-layer concern.
- **`CycleDeflectorSchema`** added alongside — same minimal shape. Both schemas land in Task 1's GREEN commit to avoid a separate schema-only commit; both schema-parity tests are per-task.
- **`set_default_index_set`** (INDEX-06):
  - **UPDATED D-13 + m2 pre-flight**: `build()` async reads `current.can_be_default` from the GET response. When false (events-style or system index set, OR any future server-rejected case), throws `GraylogValidationError` with `err.reason = "default_eligibility_failed"`. The would-be 409 surfaces in dry-run, NOT apply.
  - **Reads `can_be_default` (NOT `regular`)**: the wrapper deliberately reads the server's derived eligibility flag rather than the underlying composition flag. The derived flag absorbs the `regular: true` invariant today AND any future eligibility rules Graylog adds without a wrapper-side update.
  - **Apply envelope**: PUT `/api/system/indices/index_sets/{id}/default` with empty body returns the full IndexSetResponse DTO with `default: true`. The wrapper's normalize step maps to `{ id: indexSetId, body: <response> }`.
  - **postApplyEstimate**: `{ id: indexSetId, isDefault: true }`.
- **`cycle_deflector`** (INDEX-07):
  - **ND3 pre-flight**: `build()` async reads `current.writable` from the GET response. When false (archived/read-only), throws `GraylogValidationError` with `err.reason = "non_writable_index_set"`. POST never fires.
  - **UPDATED D-14 synchronous semantics**: per 02-U1-SMOKE.md SYNC_OPTION_A (source-verified against Graylog 7.0.6 DeflectorResource.cycle which calls `indexSet.cycle()` directly on the JVM thread, NOT via `systemJobManager.submit`). The POST returns 204 with no body once the rotation completes. NO `system_job_id` is returned.
  - **Apply envelope**: `{ rotated: true, message: "Cycled index set <id>; closed previous active index. Deflector cycle complete on Graylog side.", side_effects: { observable_at: "/system/jobs", describes: "closed-index range rebuild (IndexRangesUpdateJob fires asynchronously; the rotation itself is complete on response)" } }`. **This is NOT the D-15 async envelope** — `async: true` and `job_id` are deliberately absent; only the side-effect range rebuild is async and is surfaced via `side_effects.observable_at` so the agent can call `await_system_job` with `info_substring` if it cares about waiting for the rebuild before searching the just-closed index by time range.
  - **postApplyEstimate**: includes `async: false` to make the synchronous semantics visible in the dry-run preview AND `side_effects.observable_at: "/system/jobs"` so the agent can plan the secondary work.
- **`wrapGraylogError` reason surface (Plan 02-03 enhancement)**: both new tools throw `GraylogValidationError` with `err.reason` set. The Plan 02-03 enhancement to `src/tools/_shared/errors.js` renders the reason as a `[reason: <name>]` suffix in the MCP error text AND propagates it as `out.reason` on the envelope. Tests assert both surfaces (`assert.match(res.content[0].text, /default_eligibility_failed/)` AND `assert.equal(res.reason, "default_eligibility_failed")`).

## Task Commits

Each task was committed atomically as a RED → GREEN TDD pair:

1. **Task 1: set_default_index_set handler (INDEX-06)**
   - RED: `9b6764f` (test)
   - GREEN: `9c601bc` (feat)
2. **Task 2: cycle_deflector handler (INDEX-07)**
   - RED: `51ad5f2` (test)
   - GREEN: `552dfa1` (feat)

**Plan metadata commit:** to be added after this SUMMARY + STATE.md + ROADMAP.md update.

## Files Created/Modified

### Created (3)

- `src/tools/index-sets/set-default-index-set.js` — `handleSetDefaultIndexSet`: defineMutatingHandler composition with async `build()` pre-flighting `current.can_be_default` and throwing GraylogValidationError + reason `default_eligibility_failed` when false. Apply: `client.request("PUT", path, undefined)`. Summarize: "Set default index set to <id>".
- `src/tools/index-sets/cycle-deflector.js` — `handleCycleDeflector`: defineMutatingHandler composition with async `build()` pre-flighting `current.writable` and throwing GraylogValidationError + reason `non_writable_index_set` when false. Apply: POST + return UPDATED D-14 sync envelope with side_effects.observable_at. Summarize: "Cycle deflector for index set <id>".
- `.planning/phases/02-index-sets-retention/02-04-SUMMARY.md` — this file.

### Modified (5)

- `src/tools/index-sets/schemas.js` — appended `SetDefaultIndexSetSchema` + `CycleDeflectorSchema` (both `mutatingBase.extend({ indexSetId })`). Plan 02-01's ListIndexSetsSchema + GetIndexSetSchema, Plan 02-02's CreateIndexSetSchema + UpdateIndexSetSchema, and Plan 02-03's DeleteIndexSetSchema preserved unchanged.
- `src/tools/index-sets/index.js` — two new register lines + two new import lines (set_default_index_set + cycle_deflector).
- `src/tools.js` — two new toolDefinitions entries. set_default_index_set description names the `can_be_default` invariant + UPDATED D-13 + m2 mitigation path. cycle_deflector description warns about m3 (brief write-buffer gap), ND3 (writable refusal), D-07/D-16 (connection-level writable gate), and the side_effects.observable_at hook for the IndexRangesUpdateJob. Tool count 41 → 43.
- `test/index-sets.test.js` — +10 tests: 5 set_default_index_set handler tests (Task 1) + 5 cycle_deflector handler tests (Task 2). All tests use `_setCaptureRequest` with path-keyed routing so the GET pre-flight responses are independent from the PUT/POST apply responses; call-count assertions (e.g. `putCallCount === 0` on dry-run, `postCallCount === 0` on ND3 refusal) prove the pre-flight refusal path doesn't leak through to the destructive call.
- `test/schema-parity.test.js` — +2 assertSchemaParityForTool calls (set_default_index_set + cycle_deflector). Both schemas are plain mutatingBase.extend so `.shape` is direct; the getShape helper's ZodEffects fallback is not exercised here.

## Decisions Made

See `key-decisions:` in the frontmatter for the full list. Highlights:

- **UPDATED D-13 reads `can_be_default`, NOT `regular`**: The Plan 02-04 frontmatter spelled this out as a load-bearing decision. The wrapper deliberately reads the server's derived eligibility flag because it's durable across future server-side rule additions. If Graylog later adds (say) an "encrypted index sets cannot be default" rule, `can_be_default` automatically reflects it; `regular` would not. The agent-facing error names the `can_be_default` flag explicitly in the message so an MCP client can programmatically identify the structural problem.

- **UPDATED D-14 SYNC_OPTION_A honored exactly**: 02-U1-SMOKE.md recorded SYNC_OPTION_A for cycle_deflector (source-verified against Graylog 7.0.6 — no live smoke possible without API credentials). Plan 02-04 honored the smoke decision: `cycle_deflector` ships the synchronous envelope `{ rotated: true, message, side_effects: { observable_at, describes } }`, NOT the D-15 async envelope. The decision was deterministic before Plan 02-04 started.

- **side_effects envelope is a new pattern**: UPDATED D-14 introduces a new envelope key `side_effects` (with `observable_at` and `describes`). This is distinct from D-15's async envelope shape. The pattern is appropriate for any synchronous operation that triggers an asynchronous side-effect — the primary action is complete on response, but the secondary work is observable via /system/jobs and the agent can opt into waiting for it. Phase 3+ rotation-style operations can copy this template.

- **GraylogValidationError reused from Phase 0**: both new tools import `GraylogValidationError` from `src/graylog/errors.js` (Phase 0 — already shipped). `src/graylog/errors.js` is NOT in this plan's `files_modified` list, consistent with the plan's frontmatter. The Plan 02-03 `wrapGraylogError` enhancement (renders `err.reason` as `[reason: <name>]` suffix + propagates as `out.reason`) is already in place; Plan 02-04 consumes it for both new reason strings (`default_eligibility_failed` and `non_writable_index_set`) without additional plumbing.

## Deviations from Plan

None — plan executed exactly as written. Both tasks landed without auto-fix Rule 1/2/3 triggers. The plan's automated verify checks all passed on the first run:

- `node --test test/index-sets.test.js -t 'set_default_index_set'` → 6 tests pass (5 new + 1 schema parse already covered).
- `node --test test/index-sets.test.js -t 'cycle_deflector'` → 5 tests pass.
- `grep -q "can_be_default" src/tools/index-sets/set-default-index-set.js` → pass.
- `grep -q "default_eligibility_failed" src/tools/index-sets/set-default-index-set.js` → pass.
- `! grep -q "current\.regular" src/tools/index-sets/set-default-index-set.js` → pass (wrapper does NOT read the `regular` field).
- `! grep -q "non_regular_index_set" src/tools/index-sets/set-default-index-set.js` → pass (old reason string fully removed; never landed).
- `grep -q "non_writable_index_set" src/tools/index-sets/cycle-deflector.js` → pass.
- `! grep -E "async:\s*true" src/tools/index-sets/cycle-deflector.js` → pass (UPDATED D-14 sync semantics enforced; no leftover async envelope shape).
- `node --test test/dispatch.test.js` → 14/14 pass (assertAllToolsRegistered OK for 43 tools).
- Full `npm test` → 335/335 pass (was 323 before Plan 02-04; +12 = 5 set_default + 5 cycle + 2 schema-parity).

The SYNC_OPTION_A branch was deterministic (the U1 smoke artifact pinned it before Plan 02-04 started); had the cycle endpoint live-smoke proved ASYNC_OPTION_B (job_id returned), the apply response handling would have needed to extract a job_id and the postApplyEstimate would have carried `async: true`. The plan documents the contingency but the SYNC path is the source-verified default; no contingency activation needed.

## Issues Encountered

None. Each task's RED commit confirmed the failing import path (ERR_MODULE_NOT_FOUND for the new handler file), GREEN landed the smallest module that turned the tests green, and `npm test` reported zero regression after each commit.

## UPDATED D-13 Pre-Flight Contract

| Aspect | Value |
|--------|-------|
| Where it fires | `set_default_index_set` build() async, after pre-flight GET |
| Field read | `current.can_be_default` (NOT `current.regular`) |
| Refusal type | `GraylogValidationError` with `err.reason = "default_eligibility_failed"` |
| Refusal HTTP shape | `{ status: 409, method: "PUT", path: "/api/system/indices/index_sets/{id}/default" }` |
| Refusal message | Names the index set title + ID + `can_be_default: false` + the absorb-future-rules rationale |
| Visibility | `[reason: default_eligibility_failed]` suffix in rendered text AND `res.reason === "default_eligibility_failed"` on the MCP envelope (Plan 02-03 wrapGraylogError enhancement) |
| PUT call count on refusal | 0 (asserted by Task 1 Test 3) |

## UPDATED D-14 Synchronous Apply Envelope

cycle_deflector ships per 02-U1-SMOKE.md SYNC_OPTION_A:

```json
{
  "rotated": true,
  "message": "Cycled index set <indexSetId>; closed previous active index. Deflector cycle complete on Graylog side.",
  "side_effects": {
    "observable_at": "/system/jobs",
    "describes": "closed-index range rebuild (IndexRangesUpdateJob fires asynchronously; the rotation itself is complete on response)"
  }
}
```

Critical: NO `async: true` wrapping (asserted by Task 2 Test 4 — `body.async === undefined`). NO `job_id` field (asserted by Task 2 Test 4 — `body.job_id === undefined`). The rotation completes on response; only the closed-index range rebuild is async, and the agent can wait for it via `await_system_job` with `info_substring: <indexSetId>` (Plan 02-01 shipped the discovery path).

## ND3 Pre-Flight Contract

| Aspect | Value |
|--------|-------|
| Where it fires | `cycle_deflector` build() async, after pre-flight GET |
| Field read | `current.writable` |
| Refusal type | `GraylogValidationError` with `err.reason = "non_writable_index_set"` |
| Refusal HTTP shape | `{ status: 400, method: "POST", path: "/api/system/deflector/{id}/cycle" }` |
| Refusal message | Names the index set title + ID + remediation hint ("Set writable: true via update_index_set first.") |
| Visibility | `[reason: non_writable_index_set]` suffix in rendered text AND `res.reason === "non_writable_index_set"` on the MCP envelope |
| POST call count on refusal | 0 (asserted by Task 2 Test 3) |

## Tests Added (12)

- **5 set_default_index_set handler tests** covering: schema parse contract (Test 1); regular-index-set dry-run preview emits PUT method + correct path + body:undefined + postApplyEstimate.isDefault:true (Test 2); ineligible (can_be_default:false) refused with reason default_eligibility_failed + PUT call count 0 (Test 3 — covers UPDATED D-13 + m2); apply path fires PUT and returns the IndexSetResponse with default:true (Test 4); pre-flight GET 404 propagates as clean MCP error envelope (Test 5).
- **5 cycle_deflector handler tests** covering: schema parse contract (Test 1); writable-index-set dry-run preview emits POST method + correct path + body:undefined + postApplyEstimate.async:false + side_effects.observable_at:"/system/jobs" + side_effects.describes naming "range rebuild" (Test 2 — covers UPDATED D-14 sync envelope); non-writable refused with reason non_writable_index_set + POST call count 0 (Test 3 — covers ND3); apply path fires POST and returns sync envelope { rotated:true, message, side_effects } with NO async wrapping and NO job_id (Test 4); pre-flight GET 404 propagates as MCP error envelope (Test 5).
- **2 schema-parity tests** — `set_default_index_set` + `cycle_deflector`. Both schemas have direct `.shape` (no superRefine wrap); the getShape helper's ZodEffects fallback is not exercised.

## GraylogValidationError Import Audit

Both new handlers import `GraylogValidationError` from `src/graylog/errors.js`:

```js
import { GraylogValidationError } from "../../graylog/errors.js";
```

`src/graylog/errors.js` (Phase 0 line 18) defines the type as:

```js
export class GraylogValidationError extends GraylogError { kind = "validation"; }
```

The Phase 0 base constructor accepts `(message, { status, method, path, body } = {})`. Plan 02-04 assigns `err.reason = "<name>"` on the instance after construction, consistent with the convention established in Plan 02-02 (ND2) and Plan 02-03 (ND1 + stats_unreachable). `src/graylog/errors.js` is **NOT** in this plan's `files_modified` list — verified via the plan frontmatter.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 02-05 hand-off:** Schema-parity now covers all 8 Phase-2 mutating tools (list_index_sets, get_index_set, await_system_job, create_index_set, update_index_set, delete_index_set, set_default_index_set, cycle_deflector). Snapshot fixtures for the new dry-run shapes (set_default ineligible refusal, cycle non-writable refusal, both apply envelopes) are pending Plan 02-05. The minimal schema shapes (`{ indexSetId }`) and deterministic envelopes (no clock-driven fields) make them trivial to snapshot.
- **Phase 3+ hand-off:** The ND pre-flight pattern now covers 4 distinct invariants — ND1 (default_index_set_undeletable, Plan 02-03), ND2 (default_index_set_must_be_writable, Plan 02-02), ND3 (non_writable_index_set, this plan), and m2 (default_eligibility_failed, this plan). Phase 3+ blueprint actions that touch streams, pipelines, dashboards, event definitions can copy the structural pattern verbatim: pre-flight GET inside `build()` async → check the relevant invariant → throw `GraylogValidationError` with `err.reason = "<kebab-case-name>"` BEFORE the destructive call. The Plan 02-03 wrapGraylogError reason surface (rendered text suffix + envelope property) ensures every reason is visible to the agent.
- **UPDATED D-14 sync envelope template:** Phase 3+ rotation-style operations that have a synchronous primary action with an asynchronous side-effect can copy the cycle_deflector envelope: `{ <primary-result>: true, message, side_effects: { observable_at, describes } }`. The agent gets a clear "primary is done; secondary observable at X" contract without the wrapper having to promote the whole envelope to D-15's async shape.
- **No blockers.**

## ROADMAP Success Criterion 3

The Phase 2 ROADMAP listed three success criteria; criterion 3 reads (paraphrased):

> set_default_index_set enforces the eligibility invariant — calling it against an ineligible (events-style / system) index set surfaces a clear 409-style error in the dry-run output before any apply is attempted.

**Status: PROVABLY MET.** Task 1 Test 3 asserts the exact contract:

```js
const res = await handleSetDefaultIndexSet({ params: { arguments: {
    indexSetId: "iset-events",
    _testConnection: "fake",
} } });
assert.equal(res.isError, true);
assert.match(res.content[0].text, /default_eligibility_failed/);
assert.match(res.content[0].text, /can_be_default/);
assert.match(res.content[0].text, /Events Index/);
assert.equal(res.reason, "default_eligibility_failed");
assert.equal(putCallCount, 0, "PUT MUST NOT fire when wrapper-side eligibility check refuses");
```

The wrapper-side `can_be_default` check fires inside `build()` async BEFORE the dry-run preview is even rendered; the would-be 409 surfaces in dry-run, not apply; the PUT never fires. Two-layer defense: even if the wrapper check is bypassed in a future regression, the Graylog server-side check still throws 409.

## Self-Check: PASSED

All 3 created file paths exist on disk; all 4 task commits exist in `git log --oneline -6`. Full `npm test` returns 335/335 passing.

```
src/tools/index-sets/set-default-index-set.js            — FOUND
src/tools/index-sets/cycle-deflector.js                  — FOUND
.planning/phases/02-index-sets-retention/02-04-SUMMARY.md — FOUND (this file)
src/tools/index-sets/schemas.js                          — MODIFIED (SetDefaultIndexSetSchema + CycleDeflectorSchema)
src/tools/index-sets/index.js                            — MODIFIED (register 2 new tools)
src/tools.js                                             — MODIFIED (2 new toolDefinitions; 41 -> 43)
test/index-sets.test.js                                  — MODIFIED (+10 tests)
test/schema-parity.test.js                               — MODIFIED (+2 assertions)

commits:
  9b6764f test(02-04): RED — set_default_index_set handler tests (Task 1)
  9c601bc feat(02-04): GREEN — set_default_index_set handler (Task 1, INDEX-06)
  51ad5f2 test(02-04): RED — cycle_deflector handler tests (Task 2)
  552dfa1 feat(02-04): GREEN — cycle_deflector handler (Task 2, INDEX-07)
```

---
*Phase: 02-index-sets-retention*
*Completed: 2026-05-15*
