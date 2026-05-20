---
phase: 10-entity-sharing-write-path
verified: 2026-05-20T18:00:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Throwaway-entity full-apply UAT: create a disposable stream, share it with a dedicated test user (dryRun:false + confirm token), verify grant appears in get_entity_shares, revoke it, delete the stream"
    expected: "The apply POST succeeds; grant appears in active_shares; revoke re-POST removes the grantee; 200 response from Graylog confirms the merged body was accepted"
    why_human: "The commit endpoint was never touched by the automated suite or the dryRun:true live probe — only a real dryRun:false apply proves the full write path against the live 7.0.6 API. The operator explicitly deferred this to milestone close (Option B resume signal)."
  - test: "Saved-search entity type live probe: supply a SHARE_SMOKE_SEARCH_GRN and run node test/authz-share-entity-live.smoke.js"
    expected: "The search entity type passes the same dryRun grant+revoke assertions as stream and dashboard"
    why_human: "No saved-search view exists on the live test instance; the SKIP was recorded in 10-VERIFICATION.md §2. Verifiable only when the live instance has a saved-search view."
---

# Phase 10: Entity Sharing Write Path — Verifier Report

**Phase Goal:** An agent can grant, change, and revoke a user's access to a stream, dashboard, or saved search through one `share_entity` tool — and the tool can never silently revoke another user's access, never apply on stale state, and never apply without an explicit confirmation token.
**Verified:** 2026-05-20T18:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                           | Status     | Evidence                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | `share_entity` grants view/manage/own on stream/dashboard/search, resolving granteeUsername to user-GRN | ✓ VERIFIED | Test 5 (per-entity-type matrix) + Test 6 (granteeUsername resolution) GREEN; handler imports `resolveGranteeGrn` + `fetchEntitySharePreview` |
| 2   | Adding a grantee never revokes existing grantees (read-merge-write, acceptance gate current=[A,B]+C → body=[A,B,C]) | ✓ VERIFIED | PITFALL 1 ACCEPTANCE GATE test GREEN; `mergeGrants` produces a NEW Map over full `active_shares`; `notDeepStrictEqual([C])` assertion passes |
| 3   | Agent can revoke; dry-run output diffs added/unchanged/would-be-removed | ✓ VERIFIED | Test 8 (revoke subtract) GREEN; `computeDiff` returns `{added, changed, unchanged, removed}`; diff spread into preview envelope |
| 4   | `share_entity` defaults `dryRun:true`, returns sha-256 token, refuses apply on drift, refuses on token mismatch | ✓ VERIFIED | Test 2 (token = computeShareGrantHash), Test 3 (token mismatch → confirmation_mismatch), Test 4 (TOCTOU drift → confirmation_mismatch) all GREEN; dryRun default in mutatingBase; `requireConfirm` wired |
| 5   | `validation_result` + `missing_permissions_on_dependencies` surfaced; non-owner → ownership-specific error; last-own refused | ✓ VERIFIED | Test 9 (last-own guard → would_leave_entity_ownerless), Test 10 (400-with-body → share_validation_failed), Test 11 (403 → not_entity_owner) all GREEN |

**Score:** 5/5 truths verified

**Note on SC4 terminology:** ROADMAP success criterion 4 uses the phrase "refuses apply with `grants_changed_since_preview`". The implementation uses `confirmation_mismatch` as the reason tag for BOTH drift-refusal and wrong-token-refusal cases. This is functionally correct (Test 4 covers the drift scenario, the apply-time re-prepare re-computes the token, and the wrapper's `requireConfirm` refuses with `confirmation_mismatch`). The intent of the ROADMAP criterion is satisfied.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `test/authz-share-entity.test.js` | Wave 0 test scaffold, 16+ named tests, Pitfall-1 acceptance gate | ✓ VERIFIED | 728 lines; 26 tests pass (16 named + for-loop expansions); Pitfall-1 gate GREEN |
| `src/tools/authz/schemas.js` | ShareEntitySchema + exported ENTITY_TYPES + mutatingBase + 3 refines | ✓ VERIFIED | ShareEntitySchema exported; ENTITY_TYPES exported; 4 `.refine` calls; Capability, GetEntitySharesSchema, ListGranteesSchema unchanged |
| `src/tools/authz/share-entity.js` | handleShareEntity — defineMutatingHandler with build/apply/summarize/requireConfirm | ✓ VERIFIED | 389 lines; `defineMutatingHandler` + `fetchEntitySharePreview` + `computeShareGrantHash` + `resolveEntityGrn` + `resolveGranteeGrn`; `requireConfirm: ({ req }) => req._confirmationToken ?? null` |
| `src/tools/authz/index.js` | register("share_entity", handleShareEntity) — 3rd register call | ✓ VERIFIED | `register("share_entity", handleShareEntity)` present |
| `src/tools.js` | share_entity { name, description (≤200 chars), inputSchema } catalogue entry | ✓ VERIFIED | `name: "share_entity"` at line 1942; audit passes (186 chars) |
| `src/tools/meta/list-admin-tools.js` | DOMAIN_OVERRIDES['share_entity'] = 'authz' | ✓ VERIFIED | `share_entity: "authz"` present |
| `test/authz-share-entity-live.smoke.js` | Opt-in dryRun-only live probe; excluded from npm test | ✓ VERIFIED | dryRun:true ×6; dryRun:false ×0; assertSafeAuthzPath + process.exit(2) ×7; smoke excluded from npm test |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `share-entity.js` | `handler.js` | `defineMutatingHandler` | ✓ WIRED | Import at line 59; `export const handleShareEntity = defineMutatingHandler({...})` |
| `share-entity.js` | `prepare-share.js` | `fetchEntitySharePreview` | ✓ WIRED | Import at line 63; called in `build()` step 2 |
| `share-entity.js` | `cascade-hash.js` | `computeShareGrantHash` | ✓ WIRED | Import at line 64; called in `build()` step 6 |
| `share-entity.js` | `grn-helpers.js` | `resolveEntityGrn` + `resolveGranteeGrn` | ✓ WIRED | Import at line 62; both called in `build()` steps 1 and 3 (CR-01/CR-02 fix) |
| `authz/index.js` | `share-entity.js` | `register("share_entity", handleShareEntity)` | ✓ WIRED | Line 26 of index.js |
| `tools.js` | `authz/index.js` | assertAllToolsRegistered parity | ✓ WIRED | `name: "share_entity"` at line 1942 matches register call; all tool-count tests pass |
| `test/authz-share-entity.test.js` | `share-entity.js` | `handleShareEntity` import + _setCaptureRequest seam | ✓ WIRED | Handler imported; all 26 tests GREEN |
| `smoke.js` | `share-entity.js` | `handleShareEntity` via `driveHandlerGuarded` | ✓ WIRED | Import present; live probe ran with exit 0 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `share-entity.js build()` | `preview` (active_shares, available_grantees) | `fetchEntitySharePreview(client, entityGrn)` → POST .../prepare | Yes — POST to Graylog REST API; fixture-replay in tests | ✓ FLOWING |
| `share-entity.js build()` | `mergedMap` | `buildCurrentGrantMap(preview.active_shares)` + `mergeGrants(...)` | Yes — derived from live active_shares + new grantee | ✓ FLOWING |
| `share-entity.js build()` | `confirmationToken` | `computeShareGrantHash({entityGrn, grants: [...mergedMap]})` | Yes — sha-256 over merged set | ✓ FLOWING |
| `share-entity.js apply()` | POST body | `{selected_grantee_capabilities: Object.fromEntries(mergedMap), selected_collections:[]}` | Yes — derived from merged real data | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| All 26 offline tests pass | `node --test test/authz-share-entity.test.js` | 26 pass / 0 fail | ✓ PASS |
| Full test suite 1163/1163 | `npm test` | 1163 pass / 0 fail | ✓ PASS |
| Tool description audit | `node scripts/audit-tool-descriptions.js` | OK — 94 tool descriptions pass | ✓ PASS |
| Smoke file excluded from npm test | `npm test 2>&1 \| grep -c authz-share-entity-live.smoke` | 0 | ✓ PASS |
| Tool count 94 across 3 test files | assertAllToolsRegistered in pipelines.test.js + dashboards.test.js | PASS | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| SHARE-01 | 10-01, 10-02 | Agent can grant view/manage/own on a stream via share_entity | ✓ SATISFIED | Test 5 (stream GRN matrix), Test 6 (granteeUsername resolution) GREEN |
| SHARE-03 | 10-01, 10-02 | Agent can revoke a user's access | ✓ SATISFIED | Test 8 (revoke subtract) GREEN; revoke:true path in `mergeGrants` |
| SHARE-04 | 10-01, 10-02 | share_entity resolves granteeUsername to user-GRN | ✓ SATISFIED | Test 6 (resolution via available_grantees[].title), Test 7 (ambiguity refusal) GREEN |
| SHARE-05 | 10-01, 10-02 | share_entity is read-merge-write — never silently revokes | ✓ SATISFIED | PITFALL 1 ACCEPTANCE GATE GREEN; Test 9 (last-own guard) GREEN |
| SHARE-06 | 10-01, 10-02 | Surfaces validation_result + missing_permissions_on_dependencies | ✓ SATISFIED | Test 10 (400-with-body → share_validation_failed), Test 11 (403 → not_entity_owner) GREEN |
| SHARE-07 | 10-01, 10-02 | Agent can share a dashboard via share_entity | ✓ SATISFIED | Test 5 (dashboard GRN type) GREEN |
| SHARE-08 | 10-01, 10-02 | Agent can share a saved search via share_entity | ✓ SATISFIED | Test 5 (search GRN type) GREEN offline; live search probe SKIPPED (no saved-search view on live test instance — deferred) |
| AUTHZ-01 | 10-01, 10-02 | Defaults dryRun:true, sha-256 token, drift refusal | ✓ SATISFIED | Tests 2, 3, 4, 13, 14, 15, 16 GREEN; token = computeShareGrantHash; requireConfirm wired |

All 8 Phase 10 requirements are satisfied offline. SHARE-08 live evidence is deferred (same gap as Phase 9 — no saved-search view on the live test instance).

### Code Review Blockers Fixed

| Finding | Severity | Fix Commit | Status |
| ------- | -------- | ---------- | ------ |
| CR-01: granteeGrn not lowercased, merge mismatch | BLOCKER | `cff98b3` | ✓ FIXED — `resolveGranteeGrn` centralizes lowercasing; called in `build()` step 3 |
| CR-02: No GRANTEE_TYPES guard on granteeGrn | BLOCKER | `cff98b3` | ✓ FIXED — `GRANTEE_TYPES = Set(["user","team","builtin-team"])` exported from grn-helpers.js; `resolveGranteeGrn` checks type before returning |
| WR-01: _testConnection inline-object accepts arrays | WARNING | `42939fa` | ✓ FIXED — `!Array.isArray(args._testConnection)` predicate added |
| WR-02: resolveGranteeFromTitle does not validate id is string | WARNING | `dea092c` | ✓ FIXED — `typeof resolved !== "string" \|\| resolved.length === 0` guard with `grantee_resolution_invalid` reason |
| WR-03: Empty-string granteeGrn/entityGrn slip past XOR | WARNING | `4a1dc02` | ✓ FIXED — `.min(1)` added to both `entityGrn` and `granteeGrn` in schemas.js |
| WR-04: Network failures from apply() have no reason tag | WARNING | `e78aa99` | ✓ FIXED — plain errors (no isGraylogError) tagged with `reason: "apply_inconclusive"` |
| WR-05: assertSafeAuthzPath only checks exact AUTHZ_PREFIX | WARNING | `650e32d` | ✓ FIXED — broadened to `/authz\|shares/i` method check; commit 9f872c1 updates GRN_TYPES pin tests |

**CR-02 implementation note:** The REVIEW proposed `GRANTEE_TYPES = Set(["user","builtin-team","role"])`. The implementation chose `Set(["user","team","builtin-team"])` — adding `team` (observed in live 7.0.6 responses as `grn::::team:sidecar-system-user`) and excluding `role` (a Phase 11 concern). GRN_TYPES was promoted from 6 to 7 types to include `team`. This is an intentional and justified divergence from the review suggestion.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `share-entity.js` | 74-75 | `err.method = ""; err.path = ""` empty-string trick to suppress formatter output | ℹ️ Info | Noted in IN-04 of REVIEW.md; correct behavior, brittle formatter contract dependency |
| `share-entity.js` | 198 | `computeDiff` has unused `_revoke` parameter | ℹ️ Info | Noted in IN-02 of REVIEW.md; leading underscore acknowledges it |

No TBD/FIXME/XXX markers. No stub patterns in the production code paths.

### Human Verification Required

**Items carried forward from Plan 10-03 Task 2 operator deferral (Option B):**

#### 1. Throwaway-Entity Full-Apply UAT

**Test:** Create a disposable stream (e.g., `_phase10-uat-throwaway-<timestamp>`) using `create_stream`. Identify a dedicated test user. Call `share_entity` with `dryRun:true` to get the confirmationToken. Re-call with `dryRun:false` and `confirm:<token>`. Call `get_entity_shares` to verify the grant appears. Call `share_entity` with `revoke:true` and a new token. Call `delete_stream` to clean up.

**Expected:** The apply POST succeeds (200 from Graylog); grant appears in `active_shares` after apply; revoke re-POST removes the grantee from `active_shares`; deletion succeeds. No orphaned grants remain.

**Why human:** The commit endpoint (`POST /api/authz/shares/entities/{grn}` without `/prepare`) was never called with `dryRun:false` — only the dryRun:true path was live-verified. A real apply test requires a throwaway entity + dedicated test user to avoid mutating production grants. The operator selected Option B (defer to v3.1.0 milestone close) at the Plan 10-03 checkpoint.

#### 2. Saved-Search Entity Type Live Probe

**Test:** Set `SHARE_SMOKE_SEARCH_GRN` to a valid saved-search GRN on the live `test` instance and run `node test/authz-share-entity-live.smoke.js`.

**Expected:** The search entity type passes the same PASS assertions as stream and dashboard (dryRun grant envelope with 64-char hex token, preview.path without /prepare suffix, preview.body.selected_grantee_capabilities is an object).

**Why human:** No saved-search view exists on the current live `test` instance. This is the same gap found in Phase 9 (09-VERIFICATION.md). Requires either creating a saved search on the live instance or using a different instance with one.

---

## Gaps Summary

No blocking gaps. All 5 ROADMAP success criteria are verified offline and partially verified live (stream + dashboard live dryRun:true passes; search live deferred; commit-endpoint full-apply UAT deferred to milestone close).

The two human verification items are operational deferrals recorded by the operator — not implementation defects. The phase goal is functionally achieved in the codebase.

---

_Verified: 2026-05-20T18:00:00Z_
_Verifier: Claude (gsd-verifier)_
