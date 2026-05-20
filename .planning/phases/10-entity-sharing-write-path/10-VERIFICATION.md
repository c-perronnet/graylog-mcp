---
phase: 10-entity-sharing-write-path
plan: 03
artifact: live-verification-record
status: complete
nyquist_compliant: true
created: 2026-05-20
---

# Phase 10 — Live Verification Record

> Live-instance evidence for the Phase 10 entity-sharing write path. Mirrors the
> Phase 9 read-path live verification pattern; records the dryRun-only live
> smoke probe outcome and the operator's disposition on the throwaway-entity
> full-apply UAT (10-03 Task 2 human-verify checkpoint).

---

## 1. Offline Evidence (Plans 10-01 + 10-02)

| Check | Command | Result |
|-------|---------|--------|
| Wave 0 offline tests (16 named + 4 for-loop expansions = 20 subtests) | `node --test test/authz-share-entity.test.js` | **PASS** (20/0) |
| MANDATORY Pitfall-1 acceptance gate (read-merge-write three-grantee) | (subtest of above) | **GREEN** |
| Full offline suite green at 94 tools | `npm test` | **1156 pass / 0 fail / 0 skipped** |
| Tool count moved 93 → 94 (3 files) | `assertAllToolsRegistered(toolDefinitions)` | **GREEN** in all 3 files |
| Tool catalogue audit (94 descriptions ≤200 chars, discrimination sentence) | `node scripts/audit-tool-descriptions.js` | **OK — 94 tool descriptions pass** |

All 8 Phase 10 requirements (SHARE-01, SHARE-03, SHARE-04, SHARE-05, SHARE-06,
SHARE-07, SHARE-08, AUTHZ-01) are evidenced offline.

---

## 2. dryRun-only Live Smoke Probe (10-03 Task 1)

**Probe file:** `test/authz-share-entity-live.smoke.js` (committed `30d2ffa`).

**Target connection:** `test` — live UNESCO-production Graylog at
`http://<graylog-host>`, version `7.0.6+711d207` (per project memory:
`graylog-test-connection-is-live-unesco` — this is NOT a sandbox).

**Discipline (all enforced by acceptance gates):**

- `grep -c 'dryRun: true' test/authz-share-entity-live.smoke.js` → **6** (≥3
  required).
- `grep -cE 'dryRun *: *false' test/authz-share-entity-live.smoke.js` → **0**
  (mandatory zero).
- `grep -cE 'assertSafeAuthzPath|process\.exit\(2\)'` → **6** (≥2 required) —
  the pass-through interceptor self-guard.
- `node --check test/authz-share-entity-live.smoke.js` → exit 0.
- `npm test 2>&1 | grep -c authz-share-entity-live.smoke` → **0** — the
  `.smoke.js` suffix excludes the file from the automated suite.

**Run environment (operator-supplied):**

```
GRAYLOG `test` connection (active)
SHARE_SMOKE_STREAM_GRN=grn::::stream:6a0899bc670fc246e77ca54e
SHARE_SMOKE_DASHBOARD_GRN=grn::::dashboard:69f9a9f479a73e0661e0aafd
SHARE_SMOKE_SEARCH_GRN=<unset>  (no saved-search view exists on the live `test` instance)
```

**Probe outcome (exit 0, zero mutations):**

| Entity Type | Operation       | Result                                                                                                   |
|-------------|-----------------|----------------------------------------------------------------------------------------------------------|
| stream      | grant dryRun    | **PASS** — confirmation token `5de558f21264…` (64-char lowercase hex); `merged_size=1`                   |
| stream      | revoke dryRun   | **PASS** — `not_currently_granted` (grantee absent from active_shares; no mutation possible)             |
| dashboard   | grant dryRun    | **PASS** — confirmation token `2f6d4068083a…` (64-char lowercase hex); `merged_size=1`                   |
| dashboard   | revoke dryRun   | **PASS** — `not_currently_granted` (grantee absent from active_shares; no mutation possible)             |
| search      | grant dryRun    | **SKIP** — `SHARE_SMOKE_SEARCH_GRN` unset (no saved-search view exists on the live `test` instance —     |
|             |                 |          same finding as Phase 9 09-VERIFICATION.md; deferred, not a regression)                         |
| unknown     | username probe  | **PASS** — `granteeUsername: "nonexistent-username-no-such-user"` resolves to isError envelope with      |
|             |                 |          `reason: "username_not_found"` (correctness check on the resolveGranteeFromTitle branch)        |

**Path-guard observations:** zero `assertSafeAuthzPath` violations. Every authz
request the handler issued under `dryRun: true` was a `POST .../prepare` (the
build-phase read). The commit endpoint (path without `/prepare`) was never
observed — confirming `handler.js` step 6 short-circuits apply before the
mutating POST under `dryRun: true`.

**Verdict:** `share_entity` is verified end-to-end live for the **stream** and
**dashboard** entity types. The `/prepare` round-trip works, the merged grant
set is computed, a 64-char sha-256 confirmation token is captured, and the
unknown-grantee path returns a clean isError envelope. The commit endpoint was
never touched. The **search** entity-type probe SKIPped because no saved-search
view exists on the live `test` instance (same finding as Phase 9; deferred to
the milestone-close UAT).

---

## 3. Throwaway-Entity Full-Apply UAT (10-03 Task 2 — Human-Verify Checkpoint)

**Operator decision:** **Option B — apply-uat-deferred-to-milestone-close.**

**Reasoning recorded by the operator:**

> The offline + dryRun-live evidence is sufficient for closing Phase 10. The
> full commit-endpoint exercise is logged as a milestone-close UAT pass per
> 10-RESEARCH Open Question 5 option (b) — defer to milestone close. The
> dryRun probe exercised the `/prepare` round-trip + merge + confirmation
> token end-to-end live; the commit-endpoint POST is the one remaining
> mutation surface and will be exercised against a freshly-created throwaway
> stream + dedicated test user at v3.1.0 milestone close, per 08-TEST-STRATEGY.md.

**Per the resume-signal contract** (`apply-uat-deferred-to-milestone-close`),
this deferral is logged for milestone-close UAT. STATE.md captures the choice
under the v3.1.0 Deferred Items table; the milestone-close runbook will pick
this entry up alongside the Phase 9 saved-search-view smoke gap.

---

## 4. Success-Criterion Roll-Up

| ROADMAP Phase 10 Success Criterion | Evidence |
|------------------------------------|----------|
| 1. `share_entity` grants `view`/`manage`/`own` to a named user across stream/dashboard/search | Plan 10-02 offline tests (per-entity-type matrix Test 5); dryRun live probe for stream + dashboard (search deferred — no live target) |
| 2. Adding a grantee never revokes existing grantees (read-merge-write) | **PITFALL 1 ACCEPTANCE GATE** GREEN in Plan 10-02; dryRun live probe confirms merge against real `active_shares` |
| 3. Revoke + dry-run diff (added / unchanged / removed) | Plan 10-02 offline tests; revoke dryRun against live stream + dashboard returns the expected envelope |
| 4. `dryRun:true` default + sha-256 token + drift refusal + token-mismatch refusal | Plan 10-02 offline tests (Tests 4 + 13); dryRun live probe captures real 64-char hex tokens from the live `/prepare` round-trip |
| 5. `validation_result`, `missing_permissions_on_dependencies`, ownership-403, last-`own` refused | Plan 10-02 offline tests (Tests 9, 10, 11) — verified via fixture replay against the captured 7.0.6 prepare response |

---

## 5. Deferred to Milestone Close

| Item | Reason | Captured For |
|------|--------|--------------|
| Throwaway-entity full-apply UAT (Option A from 10-03 Task 2 checkpoint) | Operator-mediated by contract; deferred per 10-RESEARCH Open Question 5 option (b) | v3.1.0 milestone close |
| Saved-search-view dryRun smoke (third entity type) | No saved-search view exists on the live `test` instance — same gap as Phase 9 | v3.1.0 milestone close — bundle with throwaway-entity UAT |

---

*Phase: 10-entity-sharing-write-path*
*Verification recorded: 2026-05-20*
