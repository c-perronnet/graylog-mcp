---
phase: 02-index-sets-retention
verified: 2026-05-15T16:00:00Z
status: human_needed
score: 17/17 must-haves verified
overrides_applied: 0
re_verification: null
human_verification:
  - test: "End-to-end delete_index_set with deleteIndices:true against live Graylog"
    expected: "Confirmation-token round-trip with real index list + stats; cleanup job appears in /system/jobs; await_system_job(info_substring:<id>) resolves it"
    why_human: "Confirmation-token mechanic against live state requires real index list + stats. Unit tests prove hash construction; live run proves Graylog produces 204 + cleanup job observable in /system/jobs."
  - test: "cycle_deflector side-effect observability"
    expected: "After cycle, IndexRangesUpdateJob (or equivalent) for the closed index appears in /system/jobs with matching info"
    why_human: "Range-rebuild job appears asynchronously; rotation itself is sync but observable consequence requires a real cluster to verify timing window."
  - test: "U1 + cycle live smokes against http://<graylog-host>"
    expected: "Empirical confirmation of MERGE_FROM_CURRENT vs strict-no-echo, and SYNC vs ASYNC cycle envelope"
    why_human: "Both decisions defaulted to safe paths (UNREACHABLE_DEFAULT_MERGE / SYNC_OPTION_A) per 02-U1-SMOKE.md when no API token was available. The unit tests + source-verified semantics provide high confidence, but only a live run can empirically confirm Graylog 7.0.6 accepts the partial PUT body shape AND returns sync 204 for cycle."
---

# Phase 2: Index Sets & Retention — Verification Report

**Phase Goal:** An agent can configure where Graylog stores messages — including rotation/retention strategies — without ever silently destroying Elasticsearch data through a defaulted query parameter.
**Verified:** 2026-05-15T16:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| - | ----- | ------ | -------- |
| 1 | `delete_index_set` defaults `deleteIndices` to **false** (inverted from server default `true`) | VERIFIED | `schemas.js:267`: `deleteIndices: z.boolean().optional().default(false)`. Snapshot fixture `delete_index_set deleteIndices:false dry-run` shows `path: "/api/system/indices/index_sets/iset-1?delete_indices=false"`. D-04 contract met. |
| 2 | `delete_index_set` with `deleteIndices: true` issues deterministic `confirmationToken` from dry-run | VERIFIED | `delete-index-set.js:137-142` computes `computeC1Hash({indexSetId, deleteIndices:true, indexNames, messageCount})`; routed through `_confirmationToken` to handler.js:154 dry-run forwarding. Two distinct frozen-fixture hashes pinned (empty vs populated). |
| 3 | C1 hash byte-identity: distinct hashes for distinct inputs (proves hash incorporates messageCount + sortedIndexNames) | VERIFIED | Fixture 5 (empty, messageCount:0, indexNames:[]): `ed22c223ab80ce359fbb3d00b3ca46a76f99cbe07a658c1f3a3e644c5c337d1d`. Fixture 6 (populated, messageCount:12345, indexNames:[graylog_0,graylog_1,graylog_2]): `d5f10faaada8fc8f558b1a53cc8777a83fd73fa9172aa65fb36728ff246583c0`. Byte-distinct. |
| 4 | Apply requires `confirm` echo of dry-run hash (`confirmation_mismatch` reason on miss) | VERIFIED | `delete-index-set.js:192`: `requireConfirm: ({req}) => req._confirmationToken ?? null`. `handler.js:177-191` enforces gate before apply(). Test 9 in test/index-sets.test.js asserts DELETE call count 0 on mismatch. |
| 5 | `create_index_set` accepts time-based / size-based / message-count rotation × delete/close retention via friendly aliases | VERIFIED | `strategies.js:30-55`: ROTATION_FQCN has 3 entries (time-based, size-based, message-count); RETENTION_FQCN has 2 (delete, close). `schemas.js:96-97` closed enums. Snapshot fixture #1 shows TimeBased+Deletion FQCN pair. |
| 6 | Dry-run shows resolved rotation/retention strategy class + config (FQCNs on wire) | VERIFIED | Snapshot fixture `create_index_set time-based+delete dry-run` shows full FQCN pair: `rotation_strategy_class: "org.graylog2.indexer.rotation.strategies.TimeBasedRotationStrategy"`, `rotation_strategy.type: "...TimeBasedRotationStrategyConfig"`, `rotation_period: "P1D"`. |
| 7 | `set_default_index_set` enforces eligibility invariant (reads `can_be_default`, not `regular` — UPDATED D-13) | VERIFIED | `set-default-index-set.js:46`: `if (current.can_be_default === false) throw GraylogValidationError{reason:default_eligibility_failed}`. `grep -c "can_be_default" set-default-index-set.js` = 2; `grep "current\.regular"` = 0. |
| 8 | `set_default_index_set` surfaces 409-style error in dry-run BEFORE any apply | VERIFIED | Snapshot fixture #7 (`set_default_index_set against ineligible`) shows `{isError:true, reason:"default_eligibility_failed", text:"...409 PUT..."}` — fires in build() before dry-run preview rendered. |
| 9 | `await_system_job` polls `/system/jobs/{id}` to completion with exponential backoff (D-06) | VERIFIED | `system-job.js:28` `BACKOFF_SCHEDULE = [500, 1000, 2000, 4000, 5000]`; `system-job.js:170-196` poll loop with `Math.min(i, BACKOFF_SCHEDULE.length - 1)` cap. Default timeout 60_000ms (line 29). |
| 10 | `await_system_job` accepts `job_id` OR `info_substring` (UPDATED D-15 — exactly-one-of refine) | VERIFIED | `system-job.js:42-44` schema fields; `system-job.js:51-59` `.refine()` enforces exactly-one-of. `resolveJobIdFromInfo` at line 73 implements list+match. `String.prototype.includes` (line 77) for safe substring (no regex eval). |
| 11 | `delete_index_set` apply envelope OMITS job_id (UPDATED D-15) — message carries indexSetId for info_substring discovery | VERIFIED | `delete-index-set.js:181-185` returns `{async:true, job_id_observable_at:"/system/jobs", message:"...<indexSetId>...(call await_system_job with info_substring: \"<id>\")"}` — NO `job_id` field. Snapshot fixtures 5+6 confirm. |
| 12 | `cycle_deflector` is SYNCHRONOUS per UPDATED D-14 (NOT D-15 async envelope) | VERIFIED | `cycle-deflector.js:73-83` returns `postApplyEstimate.async: false`; apply (line 94-101) returns `{rotated:true, side_effects:{observable_at:"/system/jobs", describes:"...range rebuild..."}}` without `async:true` wrapping. Snapshot fixture #8 confirms. `! grep -E "async:\s*true" cycle-deflector.js` passes. |
| 13 | ND1 (default index set undeletable), ND2 (default must remain writable), ND3 (non-writable cannot cycle), D-05 (stats unreachable) — all pre-flight refusals BEFORE destructive HTTP verb | VERIFIED | ND1: `delete-index-set.js:71-78` (fires regardless of deleteIndices value). ND2: `update-index-set.js:63-70`. ND3: `cycle-deflector.js:57-64`. D-05: `delete-index-set.js:121-133` HARD-BLOCK on stats throw. All four use `GraylogValidationError + err.reason`. |
| 14 | Writable gate (D-16) fires BEFORE confirmation gate | VERIFIED | `handler.js:90-99` writable check at step 3; `handler.js:177-191` requireConfirm at step 6b — strict ordering. Test 11 of delete_index_set proves 0 pre-flight calls fire on read-only connection. |
| 15 | All 8 INDEX requirements have implementing tools registered through dispatch | VERIFIED | `src/tools/index-sets/index.js` registers 7 + `await_system_job` from `_shared/`. `src/tools.js` has 8 toolDefinitions. `src/tools/_register.js:48` side-effect imports the barrel. Tool count 35→43. |
| 16 | Schema-parity covers every Phase 2 tool (8/8 assertions) | VERIFIED | `test/schema-parity.test.js` has assertions for: list_index_sets, get_index_set, await_system_job, create_index_set, update_index_set, delete_index_set, set_default_index_set, cycle_deflector. Full suite 335/335 pass. |
| 17 | 9 deterministic snapshot fixtures pin Phase 2 safety contracts (C1 hash byte-identity, D-13/D-14/D-15 envelopes, D-04, D-05) | VERIFIED | `test/__snapshots__/index-sets.test.js.snapshot` has 8 fixtures; `test/__snapshots__/system-job.test.js.snapshot` has 1. Total 9. All assertions pass; byte-identical determinism contract per FOUND-07. |

**Score:** 17/17 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/tools/index-sets/list-index-sets.js` | INDEX-01 list with narrow projection [id,title,description,default,writable,can_be_default,index_prefix] | VERIFIED | Lines 25-33 declare the 7-field default; `?stats=false` query (line 41); `index_sets` envelope unwrap (line 43). Imported in barrel. |
| `src/tools/index-sets/get-index-set.js` | INDEX-02 full IndexSetResponse DTO | VERIFIED | Plain async handler; GET path at line 48; wrapGraylogError on 404 (line 64). |
| `src/tools/index-sets/create-index-set.js` | INDEX-03 with D-08 alias→FQCN + D-10 required strategies + M5 existingMatches | VERIFIED | aliasToConfigOrError composition (lines 68, 78); GraylogValidationError on archive/unknown (lines 70-77); findExistingMatches reuse via Plan 02-01's envelope amendment. |
| `src/tools/index-sets/update-index-set.js` | INDEX-04 MERGE_FROM_CURRENT (per U1 smoke) + D-11 atomic strategy-replace + ND2 + immutable-field defense | VERIFIED | Pre-flight GET (line 57); ND2 throw (lines 63-70); strategy alias translation; explicit-allowlist body builder per 02-U1-SMOKE.md UNREACHABLE_DEFAULT_MERGE. |
| `src/tools/index-sets/delete-index-set.js` | INDEX-05 with C1 hash + D-04 inversion + ND1 + D-05 + UPDATED D-15 envelope | VERIFIED | All five mechanisms confirmed in file (see truth #2, #4, #11, #13). 193 lines. |
| `src/tools/index-sets/set-default-index-set.js` | INDEX-06 with UPDATED D-13 can_be_default read | VERIFIED | Reads `current.can_be_default` (line 46), NOT `regular`. Reason `default_eligibility_failed` (line 51). |
| `src/tools/index-sets/cycle-deflector.js` | INDEX-07 with ND3 writable pre-flight + UPDATED D-14 sync envelope | VERIFIED | ND3 throw (lines 57-64); `async: false` in postApplyEstimate (line 75); `side_effects.observable_at` (line 79). |
| `src/tools/_shared/system-job.js` | INDEX-08 cross-domain primitive: exp backoff [500,1000,2000,4000,5000] cap 5s, default 60s timeout (max 600s), job_id OR info_substring | VERIFIED | BACKOFF_SCHEDULE + DEFAULT_TIMEOUT_MS + MAX_TIMEOUT_MS at lines 28-30; AwaitSystemJobSchema exactly-one-of refine at lines 41-59; resolveJobIdFromInfo at lines 73-95; poll loop at lines 170-196. |
| `src/tools/index-sets/c1-hash.js` | computeC1Hash + collectIndexNames pure helpers (D-01/D-02) | VERIFIED | computeC1Hash throws on deleteIndices !== true (lines 47-51, D-02 replay protection); sorts indexNames internally (line 55); collectIndexNames walks closed/reopened/all DTO shape (lines 75-81). |
| `src/tools/index-sets/strategies.js` | ROTATION_FQCN (3 aliases) + RETENTION_FQCN (2 aliases) + aliasToConfigOrError | VERIFIED | Three rotation entries (lines 30-43); two retention entries (lines 45-55); aliasToConfigOrError safe wrapper (lines 108-130) with archive_not_supported + unknown_strategy_alias structured rejection. |
| `src/tools/index-sets/schemas.js` | All 8 schemas (List, Get, Create, Update, Delete, SetDefault, Cycle) + 5 strategy-config schemas | VERIFIED | All 7 index-set schemas present (the 8th — Await — lives in system-job.js per Plan 02-01 design). 5 strict configs (TimeBased, SizeBased, MessageCount, Delete, Close); D-09 contract met. |
| `src/tools/index-sets/index.js` | Side-effect barrel registering all 8 tools | VERIFIED | 8 register() calls at lines 21-28. |
| `src/tools/_shared/handler.js` | _confirmationToken forwarding + requireConfirm gate + apply isError pass-through | VERIFIED | _confirmationToken spread at line 154; requireConfirm gate at lines 177-191; apply isError pass-through at lines 202-204. |
| `src/tools/_shared/conflict.js` | `index_sets` envelope unwrap (additive) | VERIFIED | Line 33: `?? response?.index_sets ?? response?.items`. |
| `src/tools.js` | 8 new toolDefinitions entries | VERIFIED | All 8 entries present (lines 844, 858, 870, 890, 939, 960, 977, 994). |
| `src/tools/_register.js` | Side-effect import of `./index-sets/index.js` | VERIFIED | Line 48. |
| `test/__snapshots__/index-sets.test.js.snapshot` | 8 deterministic fixtures including C1 byte-identity proof | VERIFIED | 8 exports[] entries; fixtures 5 & 6 carry DIFFERENT 64-hex confirmationToken values (`ed22...d1d` vs `d5f1...3c0`) proving hash incorporates messageCount + sortedIndexNames. |
| `test/__snapshots__/system-job.test.js.snapshot` | await_system_job dry-run plan fixture | VERIFIED | 1 export; shows `plan:[500,1000,2000,4000,5000]`, `timeoutMs:60000`, GET path, no GETs issued during dry-run. |
| `test/index-sets.test.js` | Phase 2 unit test coverage | VERIFIED | File exists; npm test runs all phase 2 cases green. |
| `test/system-job.test.js` | INDEX-08 unit test coverage | VERIFIED | File exists; 18 tests per Plan 02-01 SUMMARY. |
| `.planning/phases/02-index-sets-retention/02-U1-SMOKE.md` | Live-smoke decision artifact (UNREACHABLE_DEFAULT_MERGE / SYNC_OPTION_A) | VERIFIED | File exists; documents the unreachable-default decisions; rationale tied to RESEARCH.md. |
| `.planning/phases/02-index-sets-retention/02-VALIDATION.md` | Validation strategy with status:approved + wave_0_complete:true + nyquist_compliant:true | VERIFIED | Frontmatter confirms all three flags. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `delete-index-set.js` build() | `c1-hash.js:computeC1Hash` | named import | WIRED | Line 54 imports `computeC1Hash, collectIndexNames`; lines 135-142 invoke both. |
| `delete-index-set.js` build() | dry-run preview | `_confirmationToken` request descriptor field | WIRED | Line 167 sets `_confirmationToken: confirmationToken`; handler.js:154 spreads when present. |
| `delete-index-set.js` | apply-time gate | `requireConfirm` callback returning token or null | WIRED | Line 192: `requireConfirm: ({req}) => req._confirmationToken ?? null`. handler.js:177-191 enforces. |
| `set-default-index-set.js` | server eligibility | reads `current.can_be_default` (NOT `regular`) | WIRED | Line 46. Grep confirms zero `current.regular` references in the file. |
| `cycle-deflector.js` | sync envelope shape | postApplyEstimate carries `async:false` + `side_effects` | WIRED | Lines 73-83 in build(); lines 94-101 in apply. NOT the D-15 async envelope. |
| `system-job.js:resolveJobIdFromInfo` | `await_system_job` info_substring path | called from apply() (line 148) | WIRED | Returns `{isError, reason, message}` for 0/2+ matches; apply() passes the isError envelope through handler.js's apply pass-through (lines 202-204). |
| `system-job.js` | exactly-one-of validation | `.refine()` on AwaitSystemJobSchema | WIRED | Lines 51-59 enforce exactly-one-of (jobId | jobIdOrEnvelope | info_substring). |
| `_register.js` | `index-sets` domain | side-effect import `./index-sets/index.js` | WIRED | Line 48. |
| `index-sets/index.js` | dispatch Map | 8 `register()` calls | WIRED | Lines 21-28; assertAllToolsRegistered passes for 43 tools. |
| `conflict.js` findExistingMatches | `index_sets` envelope unwrap | additive chain entry | WIRED | Line 33: chain includes `?? response?.index_sets`. |
| `create-index-set.js` | `findExistingMatches` (M5 idempotency) | consumes the index_sets envelope unwrap | WIRED | Plan 02-02 SUMMARY confirms; uses Plan 02-01's amendment. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Full test suite green | `npm test` | 335 tests / 18 suites / 335 pass / 0 fail | PASS |
| Phase 2 tools count = 43 (35 baseline + 8) | grep tool count | All 8 tools have toolDefinitions in src/tools.js | PASS |
| C1 hash byte-identity (Fixture 5 vs 6) | inspect snapshot | `ed22...d1d` ≠ `d5f1...3c0` — distinct 64-hex hashes | PASS |
| Phase 2 schema-parity (8 assertions) | grep schema-parity.test.js | 8 assertSchemaParityForTool calls for Phase 2 tools | PASS |
| `current.regular` not referenced in set-default | grep | 0 matches in `set-default-index-set.js` | PASS |
| `async: true` not present in cycle-deflector | grep | No `async: true` literal in cycle-deflector.js | PASS |
| ND1/ND2/ND3 + D-05 + default_eligibility_failed reasons present | grep across files | All 5 reason codes found in respective handlers | PASS |
| Snapshot determinism (FOUND-07 carryover) | (per Plan 02-05 self-check) | Two consecutive runs byte-identical per Plan 02-05 SUMMARY | PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
| ----------- | -------------- | ----------- | ------ | -------- |
| INDEX-01 | 02-01, 02-05 | list_index_sets narrow projection + default/writable flags | SATISFIED | list-index-sets.js + ListIndexSetsSchema + snapshot/parity tests |
| INDEX-02 | 02-01, 02-05 | get_index_set full DTO | SATISFIED | get-index-set.js + GetIndexSetSchema + parity test |
| INDEX-03 | 02-02, 02-05 | create_index_set time/size/count rotation × delete/close retention | SATISFIED | create-index-set.js + strategies.js + 5 strict configs + snapshot fixture #1 |
| INDEX-04 | 02-02, 02-05 | update_index_set partial-update (MERGE_FROM_CURRENT per U1 smoke) | SATISFIED | update-index-set.js + UpdateIndexSetSchema (D-11 atomic) + snapshots #2 + #3 |
| INDEX-05 | 02-03, 02-05 | delete_index_set deleteIndices:false default + C1 confirmation + async system-job | SATISFIED | delete-index-set.js + c1-hash.js + DeleteIndexSetSchema + snapshots #4-6 + handler.js requireConfirm wiring |
| INDEX-06 | 02-04, 02-05 | set_default_index_set eligibility invariant (UPDATED D-13 reads can_be_default) | SATISFIED | set-default-index-set.js + snapshot #7 |
| INDEX-07 | 02-04, 02-05 | cycle_deflector manual rotation (UPDATED D-14 SYNCHRONOUS) | SATISFIED | cycle-deflector.js + snapshot #8 |
| INDEX-08 | 02-01, 02-05 | await_system_job poll primitive (UPDATED D-15 supports job_id OR info_substring) | SATISFIED | _shared/system-job.js + AwaitSystemJobSchema + system-job snapshot |

REQUIREMENTS.md traceability section confirms all 8 INDEX-XX marked `Complete` at Phase 2.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `delete-index-set.js` | 179 | `req.path.match(/index_sets\/([^?]+)/)` regex-extracts indexSetId from path; "unknown" fallback | INFO | Per REVIEW.md IN-01: indexSetId is already in `req.postApplyEstimate.id`; regex re-derivation is fragile if path format changes. Not a bug — current code is functional and consistent across mutating handlers. |
| `cycle-deflector.js` | 92 | Same regex pattern for indexSetId extraction | INFO | Same as above. |
| `delete-index-set.js` | 103-112 | Silent catch on `/indexer/indices/{id}/list` failure, allIndices defaults to empty shape | WARNING (REVIEW.md WR-01) | When `/list` endpoint fails but `/stats` succeeds, cascades preview shows `indices:[]` + `indexCount:0` while `messageCount` may report a real nonzero value. Hash computed over empty indexNames may then mismatch on apply if `/list` recovers. REVIEW recommends parallel HARD-BLOCK or `degraded: true` flag. NOT a current bug — degraded path is recognizable; REVIEW flags as UX/consistency concern. |
| `system-job.js` | 170-173 | Poll loop sleeps BEFORE checking job status; first poll always waits ≥500ms | WARNING (REVIEW.md WR-02) | Short timeouts (e.g. 100ms) overshoot. No `Math.min(delay, deadline - Date.now())` cap. NOT a current bug — test allows 700ms cushion; fast-path completion incurs unnecessary latency. |
| `c1-hash.js` | 75-81 | `collectIndexNames` assumes `Set<String>` deserializes as JSON array; no `Array.isArray` defensive check | WARNING (REVIEW.md WR-03) | If response shape drifts (e.g. Set serialized as object), `for...of` either throws or iterates string chars producing garbage names. Forward-compatibility / silent-corruption risk. Current AllIndices contract is stable on 7.0.6. |

All 3 REVIEW warnings + 5 info items are advisory only — phase code is correct as shipped. No blockers.

### Human Verification Required

#### 1. End-to-end `delete_index_set` with `deleteIndices: true` against live Graylog (INDEX-05)

**Test:** Against `<graylog-host>`: create test index set, ingest a few messages, run `delete_index_set` with `dryRun:true` (capture confirmationToken), then re-call with `dryRun:false, deleteIndices:true, confirm:<token>`. Verify cleanup job appears in `/system/jobs` matching `info_substring:<indexSetId>`, then `await_system_job` to completion.
**Expected:** 204 No Content from DELETE, IndexSetCleanupJob visible in `/system/jobs`, await_system_job resolves and reports completed:true.
**Why human:** The confirmation-token mechanic round-trip against live state requires real ES indices + stats. Unit tests prove hash construction; only a live run proves the full Graylog 7.0.6 contract holds (204-no-body, info-field contains indexSetId, etc.).

#### 2. `cycle_deflector` side-effect observability (INDEX-07)

**Test:** After `cycle_deflector` apply against a writable index set, immediately poll `/system/jobs` and confirm an `IndexRangesUpdateJob` (or equivalent) for the closed index appears with matching info.
**Expected:** Range-rebuild job observable; agent can call `await_system_job(info_substring:<indexSetId>)` to wait for it.
**Why human:** Range-rebuild job appears asynchronously; the rotation itself is sync but its observable consequence requires a real cluster to verify the timing window.

#### 3. U1 + cycle live smokes against http://<graylog-host>

**Test:** Re-run the U1 smoke (`PUT /system/indices/index_sets/{id}` with partial body) and cycle-endpoint shape verification with a valid API token.
**Expected:** Confirm whether Graylog 7.0.6 accepts a strict-no-echo partial PUT (validating an empirical narrowing from MERGE_FROM_CURRENT) AND confirm cycle is sync 204 (not async with job_id).
**Why human:** Both decisions defaulted to safe defaults (UNREACHABLE_DEFAULT_MERGE / SYNC_OPTION_A) per 02-U1-SMOKE.md because no API token was available in the executor environment. Source-verified semantics + unit tests give high confidence, but only empirical live capture can falsify the alternatives. Note: both decisions are reversible — apply payloads stay valid under either branch.

### Gaps Summary

**No automated gaps.** All 17 must-haves verified by code inspection, snapshot fixtures, schema parity, and the full 335/335 test suite. Phase code achieves the ROADMAP goal: an agent can configure index sets, rotation/retention strategies, and the default-set assignment, with the C1 destruction footgun mitigated end-to-end through (a) inverted `deleteIndices` default, (b) deterministic sha-256 confirmation token over canonical dry-run state, (c) stats-unreachable hard-block, (d) ND-style pre-flight refusals for the four structural invariants, and (e) the uniform `await_system_job` polling primitive (with `info_substring` discovery for the 204-no-body case).

**Status:** human_needed (not gaps_found) because three live-instance behaviors cannot be programmatically verified in the executor environment:
1. Live confirmation-token round-trip
2. Live cycle side-effect observability
3. U1 partial-PUT + cycle envelope empirical confirmation

All three are explicitly listed as Manual-Only Verifications in 02-VALIDATION.md and as defaulted decisions in 02-U1-SMOKE.md. The automated coverage is complete; the live tests are bonus empirical confirmation, not phase-blocking work.

---

_Verified: 2026-05-15T16:00:00Z_
_Verifier: Claude (gsd-verifier)_
