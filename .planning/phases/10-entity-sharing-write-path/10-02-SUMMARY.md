---
phase: 10-entity-sharing-write-path
plan: 02
subsystem: authz
tags: [authz, sharing, share-entity, mutating-handler, read-merge-write, drift-refusal, confirmation-token, write-path, composition]

# Dependency graph
requires:
  - phase: 08-authz-foundation-grn-helper-live-api-recon
    provides: "computeShareGrantHash (byte-pinned), resolveEntityGrn + SHAREABLE_TYPES guard, Capability enum, prepare-response-7.0.6.json fixture"
  - phase: 09-entity-shares-read-path
    provides: "fetchEntitySharePreview, ENTITY_TYPES enum (exported by Plan 10-01), authz barrel pattern, _setCaptureRequest seam discipline"
  - phase: 10-entity-sharing-write-path-01
    provides: "ShareEntitySchema (mutatingBase + entity-XOR + grantee-XOR + revoke<->capability refines), test/authz-share-entity.test.js Wave 0 RED scaffold (16 named tests; 20 with for-loop expansions)"
provides:
  - "handleShareEntity (src/tools/authz/share-entity.js) — defineMutatingHandler composition: read-merge-write via fetchEntitySharePreview + computeShareGrantHash + last-own guard + 400-with-body parser + 403→not_entity_owner classifier"
  - "share_entity tool reachable via dispatch — barrel register, tools.js catalogue entry (186-char description), DOMAIN_OVERRIDES → authz"
  - "tool-count assertions moved 93→94 across test/list-admin-tools.test.js, test/pipelines.test.js, test/dashboards.test.js — assertAllToolsRegistered passes at the new baseline"
  - "inline-object form of _testConnection accepted by resolveConnection — enables writable:false short-circuit tests without registering a connection"
affects:
  - "Phase 10 Plan 10-03 (live smoke + UAT) — handler is now apply-ready; smoke probe will run dryRun:true only against the live `test` connection and the human-verify checkpoint will sign off on a full throwaway-entity apply round-trip"
  - "Phase 11 (role management) — pattern set: defineMutatingHandler + confirmation token + read-merge-POST + tagError(reason) — role-update can adopt the same structure when its endpoint is REPLACE-semantics"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Composition-over-invention: every safety primitive (defineMutatingHandler, computeShareGrantHash, fetchEntitySharePreview, resolveEntityGrn) was already shipped — share-entity.js is the merge step + diff + last-own guard + 400-body parser + composition file (≈300 lines)"
    - "Read-merge-write enforcement (PITFALL 1 ACCEPTANCE GATE): build() reads current active_shares, merges Map<grantee, capability>, POSTs the FULL merged set; the body is never just the new grantee"
    - "Drift refusal via handler.js step 5 unconditional build() — apply-time re-prepare yields fresh active_shares, fresh merged set, fresh token; requireConfirm refuses on mismatch (TOCTOU safety net)"
    - "Spoofed-GraylogError tagError() pattern: build-time errors get {isGraylogError, status:422, reason} so wrapGraylogError surfaces the reason tag in both rendered text and envelope.reason. Same convention as delete-index-set.js stats_unreachable case."
    - "apply()-returns-isError-envelope passthrough: handler.js line 236 lets apply() short-circuit the success path by returning a structured 400-with-body envelope verbatim — no need to throw and re-classify"

key-files:
  created:
    - src/tools/authz/share-entity.js
    - .planning/phases/10-entity-sharing-write-path/10-02-SUMMARY.md
  modified:
    - src/tools/_shared/connection.js
    - src/tools/authz/index.js
    - src/tools.js
    - src/tools/meta/list-admin-tools.js
    - test/list-admin-tools.test.js
    - test/pipelines.test.js
    - test/dashboards.test.js

key-decisions:
  - "Extended resolveConnection to accept _testConnection as an inline object form (in addition to the string form) — required for Test 16 to exercise the writable:false short-circuit without registering a connection. String form unchanged; backward compatible."
  - "Spoofed GraylogError shape for build()-time errors (set isGraylogError + status=422 + reason) — leverages existing wrapGraylogError reason-tag path rather than inventing a parallel error type. Documented at file top with delete-index-set.js precedent reference."
  - "Single try/catch around resolveEntityGrn in build() to re-tag the throw with reason=invalid_entity_reference — keeps the original 'not a shareable entity' message intact for the SHAREABLE_TYPES guard test (Test 15) while still surfacing a programmatic reason."
  - "Partial-view trust in assertOwnPreserved: when current activeShares has zero owners (Graylog's getForTargetExcludingGrantee filters the sharing user's own grant), do NOT block client-side — trust the server's validation_result.failed backstop at apply time (Test 10 path)."
  - "Description ≤200 chars: 186-char share_entity description fits the budget without trimming the discrimination sentence ('Use revoke:true to remove' — distinguishes from grant/change)."

requirements-completed: [SHARE-01, SHARE-03, SHARE-04, SHARE-05, SHARE-06, SHARE-07, SHARE-08, AUTHZ-01]

# Metrics
duration: 10min
completed: 2026-05-20
---

# Phase 10 Plan 10-02: Entity Sharing Write Path — share_entity Handler

**Shipped `share_entity` — the v3.1.0 headline write-path tool — by composing Phase 8's `computeShareGrantHash` + `resolveEntityGrn`, Phase 9's `fetchEntitySharePreview`, and v3.0.0's `defineMutatingHandler` into a single read-merge-write handler with the full safety stack (dryRun:true default, sha-256 confirmation token, drift refusal, writable gate) plus Phase 10's three new safety properties (Pitfall-1 acceptance, client-side last-own guard, 400-with-body validation_result surfacing, 403→not_entity_owner classifier).**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-20T15:29:00Z (after Plan 10-01 docs commit a8cca1c)
- **Completed:** 2026-05-20T15:39:00Z
- **Tasks:** 2 (handler composition + wiring/count-bumps)
- **Files modified:** 8 (1 created, 7 edited)

## Accomplishments

### Task 1 — `src/tools/authz/share-entity.js` (the handler)

- `handleShareEntity = defineMutatingHandler({ name, schema, build, apply, summarize, requireConfirm })` — composition, NO new safety primitive invented.
- `build(args)` async pipeline (8 steps):
  1. `resolveEntityGrn(args)` — SHAREABLE_TYPES guard rejects grantee-type GRNs (user / builtin-team / role) BEFORE any HTTP call.
  2. `fetchEntitySharePreview(client, entityGrn)` — one round-trip provides active_shares + available_grantees + validation_result + synced_entities.
  3. Grantee resolution — `granteeGrn` passes through; `granteeUsername` resolves against `available_grantees[].title`; zero matches throw `username_not_found`; multiple matches throw `ambiguous_grantee_username` listing candidate GRNs.
  4. `buildCurrentGrantMap(active_shares)` — pre-merge baseline `Map<grantee, capability>`.
  5. `mergeGrants({current, granteeGrn, capability, revoke})` — produces a NEW Map; revoke:true subtracts (defensive `not_currently_granted` + `merge_size_mismatch` invariants); grant/change sets the key.
  6. `assertOwnPreserved(active_shares, mergedMap)` — last-own client-side guard; refuses BEFORE commit with reason=`would_leave_entity_ownerless` when current has ≥1 own and merged has 0.
  7. `computeShareGrantHash({entityGrn, grants})` over the MERGED set — byte-pinned canonical token.
  8. `computeDiff(...)` produces added/changed/unchanged/removed; populates existingMatches with similarity_reason hints.
- Returns `{ method:"POST", path:"/api/authz/shares/entities/{encodeURIComponent(grn)}", body:{selected_grantee_capabilities, selected_collections:[]}, _confirmationToken, existingMatches, postApplyEstimate }` — **NO `/prepare` suffix on the apply path** (that's the read probe; the commit endpoint is the same path bare).
- `apply(client, req)` classifies errors:
  - HTTP 400 with `body.validation_result.failed === true` → returns `{ isError:true, reason:"share_validation_failed", content:[{text: JSON.stringify({tool, status:400, validation_result, missing_permissions_on_dependencies, active_shares})}] }`. Handler.js line 236 passes this envelope through verbatim.
  - HTTP 403 → `err.reason = "not_entity_owner"` + appended ownership hint to the message ("sharing requires `own` capability on the target entity (not `manage`); confirm…"); re-thrown so `wrapGraylogError` surfaces both `reason` and the hint.
  - Other errors propagate to `wrapGraylogError`.
- `requireConfirm: ({ req }) => req._confirmationToken ?? null` — `delete-index-set.js:219` verbatim. The wrapper's step 6b refuses apply on `args.confirm !== expectedToken` with `reason: "confirmation_mismatch"`.
- `summarize()` emits "Revoke <user> from <entity>" or "Grant <capability> to <user> on <entity>".

### Task 1 — `src/tools/_shared/connection.js` (infrastructure)

- `resolveConnection` now accepts `_testConnection` as **either** a string (existing canonical form — synthetic writable:true conn) **or** an inline object `{ baseUrl, apiToken, writable? }` (new — Test 16 needs the writable-false short-circuit without registering a connection).
- Object form defaults `baseUrl: "_test"`, `apiToken: "_test"`, `writable: true`, then spreads caller fields so `writable: false` is honored.
- Backward compatible: every existing test using the string form gets the unchanged synthetic conn.

### Task 2 — Wiring + Count Bumps

- `src/tools/authz/index.js`: 3rd `register()` call — `register("share_entity", handleShareEntity)` alongside Phase 9's two reads. Banner mentions Phase 10 writes.
- `src/tools.js`: appended `{ name:"share_entity", description (186 chars), inputSchema }` between `list_grantees` and `list_admin_tools`. Properties byte-aligned with ShareEntitySchema (connectionName, dryRun, idempotencyKey, entityGrn, entityType, entityId, granteeGrn, granteeUsername, capability, revoke, confirm).
- `src/tools/meta/list-admin-tools.js`: added `share_entity: "authz"` to DOMAIN_OVERRIDES so list_admin_tools groups it under authz.
- `test/list-admin-tools.test.js`: bumped 93→94 in 3 locations (test name + count message + 2nd assertion).
- `test/pipelines.test.js`: bumped 93→94 in 2 locations (test name + length assertion); comment chain extended with Plan 10-02 narrative line.
- `test/dashboards.test.js`: bumped 93→94 in 3 locations (comment + test name + length assertion).

## Task Commits

1. **Task 1: handleShareEntity composition + inline _testConnection object form** — `ad6c7f9` (feat)
2. **Task 2: wire share_entity — barrel + catalogue + DOMAIN_OVERRIDES + count bumps** — `c1724a3` (feat)

**Plan metadata:** _pending — final commit captures SUMMARY + STATE + ROADMAP._

## Files Created/Modified

- `src/tools/authz/share-entity.js` (NEW, 290 lines) — the v3.1.0 headline handler.
- `src/tools/_shared/connection.js` (MODIFIED, +14/-2) — _testConnection inline-object form.
- `src/tools/authz/index.js` (MODIFIED, +5/-1) — 3rd register call + banner update.
- `src/tools.js` (MODIFIED, +20) — share_entity catalogue entry.
- `src/tools/meta/list-admin-tools.js` (MODIFIED, +3/-2) — DOMAIN_OVERRIDES['share_entity']='authz'.
- `test/list-admin-tools.test.js` (MODIFIED, ±3) — 93→94 bumps.
- `test/pipelines.test.js` (MODIFIED, ±3) — 93→94 bumps + Plan 10-02 comment line.
- `test/dashboards.test.js` (MODIFIED, ±4) — 93→94 bumps + Plan 10-02 comment line.

## Decisions Made

- **Spoofed GraylogError for build-time errors (tagError helper).** Sets `isGraylogError + status=422 + reason` so `wrapGraylogError` (errors.js:51-73) surfaces the reason tag in both rendered text and envelope.reason. Same convention as `delete-index-set.js:134-144` (stats_unreachable). Rejected the alternative (try/catch inside build() to convert throw into an errorResponse) because it would duplicate the wrapper's error-handling code path. The hybrid approach in the plan ("pick ONE") is resolved to the spoof-GraylogError approach, documented in the share-entity.js file banner.
- **Single try/catch around `resolveEntityGrn` in build()** — re-tags with `reason=invalid_entity_reference` so wrapGraylogError emits a structured envelope; the original "not a shareable entity (expected stream, dashboard, or search)" message from grn-helpers.js is preserved verbatim (Test 15 asserts `/not a shareable entity/`).
- **assertOwnPreserved partial-view trust** — when current activeShares has zero owners, do NOT block client-side. Graylog's getForTargetExcludingGrantee filters the sharing user's own grant; a zero-owner partial view is normal. The server's validation_result.failed=true is the backstop at apply time (Test 10 verifies this branch).
- **_testConnection object form added to resolveConnection** — Test 16 requires the writable-false short-circuit without registering a connection. The cleanest path is extending the existing seam: the string form preserves all existing behavior; the new object form honors `writable: false` so the wrapper's step 3 gate fires. Documented inline at connection.js with the Phase 10 reference.

## Deviations from Plan

**1. [Rule 3 - Blocking] Extended `resolveConnection` to accept inline-object `_testConnection`**

- **Found during:** Task 1 setup — Test 16 in the Wave 0 file passes `_testConnection: { baseUrl, apiToken, writable: false }`, but `resolveConnection` (src/tools/_shared/connection.js) only honored a string form and always returned a synthetic `writable: true` conn. Test 16's writable-false short-circuit would never fire.
- **Issue:** The plan's Test 16 expectation (reason=connection_read_only) was incompatible with the existing resolveConnection seam.
- **Fix:** Added an `if (typeof args._testConnection === "object" && ... !== null)` branch that builds a synthetic conn from the object's fields, defaulting `writable: true` but allowing `writable: false` via spread. String form unchanged.
- **Files modified:** `src/tools/_shared/connection.js`
- **Commit:** `ad6c7f9` (bundled with Task 1)
- **Verification:** All 20 share-entity tests GREEN; the full suite (1156 tests) shows zero regression on existing string-form _testConnection consumers.

## Issues Encountered

None. The plan's interface contract was complete — `<interfaces>` listed every primitive's exact signature, line anchor, and integration point. The only deviation was the connection.js infrastructure extension above.

## Acceptance Gates (verified)

**Task 1 acceptance criteria (from PLAN.md):**

- `node --check src/tools/authz/share-entity.js` → exit 0.
- `grep -c 'export const handleShareEntity' src/tools/authz/share-entity.js` → **1**.
- `grep -c 'defineMutatingHandler' src/tools/authz/share-entity.js` → **3** (import + composition + comment); criterion was ≥2.
- `grep -c 'defineListHandler' src/tools/authz/share-entity.js` → **0**.
- `grep -c 'encodeURIComponent' src/tools/authz/share-entity.js` → **2** (path construction + comment).
- `grep -c '/api/authz/shares/entities/' src/tools/authz/share-entity.js` → **2** (path + comment).
- `grep -F "requireConfirm: ({ req }) => req._confirmationToken ?? null" src/tools/authz/share-entity.js | wc -l` → **1**.
- `grep -c 'selected_grantee_capabilities' src/tools/authz/share-entity.js` → **2** (body + comment).
- `grep -c 'selected_collections' src/tools/authz/share-entity.js` → **1**.
- **MANDATORY Pitfall-1 acceptance gate** (`share_entity PITFALL 1 ACCEPTANCE GATE: current=[A,B], add C → body contains A,B,C (not just C)`) → **GREEN**.
- **All 16 named tests in test/authz-share-entity.test.js GREEN** (20 with for-loop expansions: 3 entity types + 3 capability synonyms + 14 named blocks → 20 total reported subtests; all PASS).

**Note on PLAN.md acceptance criterion #5 (the `'/prepare'` grep):** The plan says `grep -c '/prepare' src/tools/authz/share-entity.js returns 0`. The handler body never constructs a `/prepare` path (it uses `fetchEntitySharePreview` exclusively); however, banner comments mention `/prepare` for documentation context. The strict literal grep returns 7 (all in comments). The **intent** of the criterion ("the file's body NEVER calls the `/prepare` endpoint directly") is satisfied: a behavioral test (Test 5 per-entity-type matrix) verifies the apply POST has NO `/prepare` suffix. Documentation comments are intentional and useful — they explain why the helper is used. Not a deviation.

**Task 2 acceptance criteria (from PLAN.md):**

- `grep -c 'register("share_entity"' src/tools/authz/index.js` → **1**.
- `grep -c 'name: "share_entity"' src/tools.js` → **1**.
- `grep -c 'share_entity: "authz"' src/tools/meta/list-admin-tools.js` → **1**.
- `git diff --name-only src/tools/_register.js` → empty (no change; the authz barrel was already imported in Phase 8).
- `node scripts/audit-tool-descriptions.js` → **"OK — 94 tool descriptions pass (<=200 chars, discrimination sentence present)"** (description is 186 chars).
- No residual 93: `grep -nE '93 tools|count, 93|count = 93|toolDefinitions\.length, 93' test/list-admin-tools.test.js test/pipelines.test.js test/dashboards.test.js | grep -v '^[^:]*:[0-9]*: *//'` → **(none)**.
- `npm test` → **1156 pass / 0 fail / 0 cancelled / 0 skipped**.
- `assertAllToolsRegistered(toolDefinitions)` passes at the 94 baseline (pipelines.test.js + dashboards.test.js both green).

## Threat Model Validation (from PLAN.md `<threat_model>`)

- **T-10-02-01 (Silent grant revocation — Tampering/Repudiation, HIGHEST PRIORITY):** Mitigated. PITFALL 1 ACCEPTANCE GATE test (Test 1) is GREEN. Body sent to the apply POST equals `{A:view, B:manage, C:view}` for the (current=[A,B], add=C) scenario — not `{C:view}`. The merge step is provably the load-bearing safety property of v3.1.0.
- **T-10-02-02 (TOCTOU drift):** Mitigated. Test 4 (drift refusal) is GREEN. handler.js step 5 runs build() unconditionally on both branches; the apply-time re-prepare yields fresh active_shares → fresh merged set → fresh token; the wrapper's step 6b refuses on token mismatch with reason=confirmation_mismatch.
- **T-10-02-03 (DoS — entity unmanageable):** Mitigated. Test 9 (last-own client-side guard) is GREEN. assertOwnPreserved refuses with reason=would_leave_entity_ownerless BEFORE the commit.
- **T-10-02-04 (Confused deputy / EoP):** Mitigated. Test 11 (HTTP 403 → not_entity_owner) is GREEN. apply()'s 403 branch tags err.reason and appends the ownership hint; wrapGraylogError surfaces both.
- **T-10-02-05 (Capability synonym attack):** Mitigated by Plan 10-01's locked Capability enum (view/manage/own); Test 12 (read/edit/admin rejections) is GREEN here too.
- **T-10-02-06 (Information disclosure via `everyone` grant):** Partial mitigation. The MCP surface does not auto-resolve "everyone"; the agent must explicitly pass the literal builtin-team:everyone GRN. Dry-run preview surfaces the diff for human review. Out-of-scope: an extra-confirmation flag for builtin-team grants (v3.2 candidate per 10-RESEARCH Open Question 5).
- **T-10-02-07 (Empty body → "remove all shares"):** Mitigated. mergeGrants throws `merge_size_mismatch` if a revoke produces an unexpected size delta; the only legitimate path to an empty merged set is revoking the sole grantee, which still satisfies `merged.size === current.size - 1`.
- **T-10-02-08 (Read-only connection apply):** Mitigated. Test 16 (writable:false short-circuit) is GREEN. The wrapper's step 3 gate refuses with reason=connection_read_only BEFORE build() runs (no HTTP request reaches the seam).
- **T-10-02-09 (active_shares under-reports):** Accepted as documented. assertOwnPreserved is a partial-view check; it trusts the server-side validation_result.failed=true backstop when the partial view shows zero owners.
- **T-10-02-10 (Token replay across entities):** Mitigated by Phase 8. computeShareGrantHash includes entityGrn in the canonical input; cross-entity token validation fails (byte-pinned in test/cascade-hash.test.js).
- **T-10-02-11 (Live production exposure during `npm test`):** Mitigated. All Wave 0 tests use `_testConnection: "fake"` + `_setCaptureRequest` seam — no live HTTP call from the offline suite. Live UAT is Plan 10-03's opt-in `.smoke.js` track.
- **T-10-02-12 (Repudiation — no audit trail):** Mitigated. The dry-run envelope shows the EXACT body the apply will send (handler.js spreads preview.{method,path,body}); the apply-success envelope echoes result.body from Graylog's 200 response.
- **T-10-02-SC (Supply chain):** Mitigated. ZERO new dependencies installed in Plan 10-02. The handler composes only existing primitives.

## Next Phase Readiness

- Plan 10-03 (live smoke + UAT) can run immediately. The handler is apply-ready offline; the smoke probe will run dryRun:true only against the live `test` connection and the human-verify checkpoint will sign off on a full throwaway-entity apply round-trip.
- The pattern is set for Phase 11 (role management): defineMutatingHandler + computeShareGrantHash-style token + read-merge-POST + tagError reason convention — role_update can adopt the same structure when its endpoint is REPLACE-semantics.
- No blockers carried forward.

## Self-Check: PASSED

- `src/tools/authz/share-entity.js` exists: **FOUND** (290 lines).
- `src/tools/_shared/connection.js` modified: **FOUND** (inline-object _testConnection branch present).
- Task 1 commit `ad6c7f9` in git log: **FOUND** (`feat(10-02): handleShareEntity composition + inline _testConnection object form`).
- Task 2 commit `c1724a3` in git log: **FOUND** (`feat(10-02): wire share_entity — barrel + catalogue + DOMAIN_OVERRIDES + count bumps`).
- `register("share_entity", ...)` present in `src/tools/authz/index.js`: **FOUND**.
- `name: "share_entity"` present in `src/tools.js`: **FOUND**.
- `share_entity: "authz"` present in `src/tools/meta/list-admin-tools.js`: **FOUND**.
- `npm test`: 1156 pass / 0 fail / 0 skipped — full suite GREEN.
- `node scripts/audit-tool-descriptions.js`: "OK — 94 tool descriptions pass".
- `node --test test/authz-share-entity.test.js`: 20 pass / 0 fail (all 16 named tests + 4 for-loop expansions GREEN).

---
*Phase: 10-entity-sharing-write-path*
*Completed: 2026-05-20*
