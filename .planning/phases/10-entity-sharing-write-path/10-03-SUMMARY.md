---
phase: 10-entity-sharing-write-path
plan: 03
subsystem: authz
tags: [authz, sharing, live-uat, smoke, dry-run-only, human-verify, production-safety, deferred-to-milestone-close]

# Dependency graph
requires:
  - phase: 09-entity-shares-read-path
    provides: "test/authz-entity-shares-live.smoke.js (verbatim template for the smoke harness shape — pass-through interceptor, assertSafeAuthzPath self-guard, resolveProbeConnection helper)"
  - phase: 10-entity-sharing-write-path-02
    provides: "handleShareEntity (apply-ready offline; dryRun:true short-circuits at handler.js step 6 BEFORE the commit endpoint POST can fire)"
  - phase: 08-authz-foundation-grn-helper-live-api-recon
    provides: "08-TEST-STRATEGY.md throwaway-entity contract; computeShareGrantHash byte-pin; live 7.0.6 prepare-fixture; `test` connection recon"
provides:
  - "test/authz-share-entity-live.smoke.js — opt-in dryRun-only live smoke probe; mirrors Phase 9 smoke harness verbatim; excluded from `npm test` via `.smoke.js` suffix"
  - ".planning/phases/10-entity-sharing-write-path/10-VERIFICATION.md — live verification record (offline + dryRun-live evidence; operator UAT disposition)"
  - "Operator-chosen resume signal: `apply-uat-deferred-to-milestone-close` — throwaway-entity full-apply UAT deferred to v3.1.0 milestone close per 10-RESEARCH Open Question 5 option (b)"
affects:
  - "Phase 10 completion gate — Phase 10 closes with offline (Plans 10-01/10-02) + dryRun-live (Plan 10-03 Task 1) evidence; the commit-endpoint full-apply is the one remaining live confirmation, deferred to milestone close"
  - "v3.1.0 Deferred Items table in STATE.md — captures the throwaway-entity UAT deferral so the milestone-close runbook picks it up"
  - "Phase 11 (role management) — pattern set: smoke-probe-with-self-guard + human-verify-checkpoint for the apply step; role_update can adopt the same structure once its mutating-endpoint is shipped"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - ".smoke.js suffix discipline: opt-in live probes are excluded from `npm test` by the `test/**/*.test.js` glob in package.json — no test-script changes needed, the naming convention is the gate"
    - "Pass-through interceptor self-guard: `_setCaptureRequest` captures every request, calls `assertSafeAuthzPath(req.path)` BEFORE issuing the real HTTP call via the cleared seam, then reinstates the seam in `finally`. Forbidden paths abort `process.exit(2)`. Defense-in-depth against a wrapper regression that fails to short-circuit apply"
    - "dryRun-only live verification of read-merge-token pipeline: the `/prepare` round-trip + grantee resolution + merge + sha-256 token computation are all exercised against live data without touching the commit endpoint — catches Pitfall 2/6 drift between offline fixture and live 7.0.6 surface"
    - "Operator-mediated full-apply UAT: throwaway-entity rule from 08-TEST-STRATEGY.md is structural (freshly-created stream + dedicated test user; NEVER `builtin-team:everyone`; NEVER an existing production entity); plan exposes a human-verify checkpoint with three discrete resume signals (executed / deferred / skipped / failed)"

key-files:
  created:
    - test/authz-share-entity-live.smoke.js
    - .planning/phases/10-entity-sharing-write-path/10-VERIFICATION.md
    - .planning/phases/10-entity-sharing-write-path/10-03-SUMMARY.md
  modified: []

key-decisions:
  - "Operator selected Option B (apply-uat-deferred-to-milestone-close): offline + dryRun-live evidence sufficient for closing Phase 10; commit-endpoint exercise logged as milestone-close UAT pass per 10-RESEARCH Open Question 5 option (b)"
  - "Recorded the live smoke outcome in a standalone 10-VERIFICATION.md (mirroring Phase 9's pattern) rather than embedding only in the SUMMARY — the verification record outlives the SUMMARY's plan-scope and is the canonical evidence artifact for the milestone-close audit"
  - "Saved-search-view smoke SKIP is NOT a regression: same finding as Phase 9 09-VERIFICATION.md — no saved-search view exists on the live `test` instance. Captured in the v3.1.0 Deferred Items table for milestone-close bundling with the throwaway-entity UAT"

requirements-completed: [SHARE-01, SHARE-03, SHARE-04, SHARE-05, SHARE-06, SHARE-07, SHARE-08, AUTHZ-01]

# Metrics
duration: 22min
completed: 2026-05-20
---

# Phase 10 Plan 10-03: Entity Sharing Write Path — Live Smoke + UAT Checkpoint Summary

**Shipped the opt-in `dryRun: true`-only live smoke probe for `share_entity` against the production UNESCO Graylog 7.0.6 `test` instance, recorded a clean live-verification pass for the stream + dashboard entity types (search SKIPped — no saved-search view exists on the live instance, same as Phase 9), and resolved the throwaway-entity full-apply UAT human-verify checkpoint with the operator's explicit deferral to v3.1.0 milestone close.**

## Performance

- **Duration:** ~22 min (Task 1 + Task 2 across multiple operator interactions: smoke-probe creation, live run, then human-verify deferral)
- **Plan started:** 2026-05-20 (Task 1 commit at 2026-05-20T17:48:25+02:00 / 15:48:25Z)
- **Plan completed:** 2026-05-20T16:12:32Z (operator deferral resume-signal received; closing now)
- **Tasks:** 2 (auto smoke probe + human-verify checkpoint)
- **Files created:** 3 (smoke probe + verification record + this summary)
- **Files modified:** 0 (no source changes; no `package.json` changes — `.smoke.js` suffix already excluded from npm test glob)

## Accomplishments

### Task 1 — `test/authz-share-entity-live.smoke.js` (opt-in dryRun-only live probe)

- **File created and committed** at `30d2ffa` (`test(10-03): opt-in dryRun-only live smoke probe for share_entity`).
- Mirrors `test/authz-entity-shares-live.smoke.js` (Phase 9) verbatim in shape — header banner, imports, helper signatures, pass-through interceptor pattern.
- **Header + SAFETY block** cites 08-TEST-STRATEGY.md §2/§6, 10-RESEARCH Pitfall 6, and the `graylog-test-connection-is-live-unesco` project-memory note. Documents the `.smoke.js` exclusion-from-`npm test` discipline and the dryRun-only contract.
- **Imports:** `makeClient`, `_setCaptureRequest`, `_clearCaptureRequest` from `src/graylog/client.js`; `getConnections`, `getActiveConnectionConfig` from `src/config.js`; `buildGrn` from `src/tools/authz/grn-helpers.js`; `handleShareEntity` from `src/tools/authz/share-entity.js`.
- **Constants:** `TARGET_CONNECTION = "test"`, `AUTHZ_PREFIX = ["/api","authz","shares","entities",""].join("/")` (segment-built to avoid hand-typed path drift).
- **Helpers (verbatim Phase 9 idioms with the new handler-under-test substituted):**
  - `resolveProbeConnection()` — `getConnections()[TARGET_CONNECTION] ?? getActiveConnectionConfig()`; throws on missing; returns `{ name, conn }`.
  - `parseHandlerResult(res, label)` — asserts non-error envelope; `JSON.parse(res.content[0].text)`.
  - `assertSafeAuthzPath(path)` — the SELF-GUARD. Returns if path is not under `AUTHZ_PREFIX`; returns if path ends with `/prepare` (the build-phase read is allowed); otherwise — the path is the mutating commit endpoint — prints a FATAL message and `process.exit(2)`. Also asserts the GRN segment between `AUTHZ_PREFIX` and `/prepare` is `%3A`-encoded (no raw `:`).
  - `driveHandlerGuarded(handler, args, conn)` — pass-through interceptor that clears the seam, calls the real `makeClient(conn).request(...)`, then reinstates the seam in `finally`. Every request path is guarded BEFORE the real call is issued.
- **Main routine `main()`:** for `stream`, `dashboard`, `search`:
  - Reads `SHARE_SMOKE_<TYPE>_GRN` env vars for the safe target entity; SKIPs that type with a warning if unset.
  - Drives `handleShareEntity` via `driveHandlerGuarded` with `dryRun: true` + a known-existing user-GRN (or a known title from `available_grantees`) + `capability: "view"`.
  - Asserts: `payload.dryRun === true`, `payload.tool === "share_entity"`, `payload.confirmationToken` is 64-char lowercase hex, `payload.preview.method === "POST"`, `payload.preview.path` starts with `AUTHZ_PREFIX` AND does NOT end with `/prepare` (the apply path is the commit endpoint), `payload.preview.body.selected_grantee_capabilities` is an object.
  - Also drives `revoke: true` dryRun and one failure-case probe with `granteeUsername: "nonexistent-username-no-such-user"` (asserts isError + `reason: "username_not_found"`).
- **Exit discipline:** `process.exit(0)` on all-green; `process.exit(1)` on assertion failure; `process.exit(2)` on path-guard violation.

### Task 1 — acceptance gates (verified)

| Gate | Result |
|------|--------|
| `node --check test/authz-share-entity-live.smoke.js` | **exit 0** |
| `grep -c 'dryRun: true' test/authz-share-entity-live.smoke.js` (≥3 required) | **6** |
| `grep -cE 'dryRun *: *false' test/authz-share-entity-live.smoke.js` (= 0 required) | **0** |
| `grep -cE 'assertSafeAuthzPath|process\.exit\(2\)' …` (≥2 required) | **6** |
| `grep -cE 'getConnections|getActiveConnectionConfig' …` (≥2 required) | **≥2** ✓ |
| `npm test 2>&1 \| grep -c authz-share-entity-live.smoke` (=0 required) | **0** |
| `grep -l 'authz-share-entity-live.smoke' test/*.test.js` (no .test.js imports the probe) | **(none)** |
| `npm test` full offline suite | **1156 pass / 0 fail / 0 cancelled / 0 skipped** |

### Task 1 — LIVE smoke run outcome (operator-executed against the production UNESCO `test` connection)

Environment:

```
GRAYLOG `test` connection → http://<graylog-host> (Graylog 7.0.6+711d207)
SHARE_SMOKE_STREAM_GRN=grn::::stream:6a0899bc670fc246e77ca54e
SHARE_SMOKE_DASHBOARD_GRN=grn::::dashboard:69f9a9f479a73e0661e0aafd
SHARE_SMOKE_SEARCH_GRN=<unset>
```

Result (exit 0, zero mutations):

```
PASS  stream    grant dryRun token=5de558f21264…  merged_size=1
PASS  stream    revoke dryRun (not_currently_granted — grantee absent from active_shares; no mutation possible)
PASS  dashboard grant dryRun token=2f6d4068083a…  merged_size=1
PASS  dashboard revoke dryRun (not_currently_granted — grantee absent from active_shares; no mutation possible)
SKIP  search    SHARE_SMOKE_SEARCH_GRN env var unset (no saved-search view exists on the live instance — same finding as Phase 9; deferred)
PASS  unknown   granteeUsername resolves to isError envelope (username_not_found)
```

`share_entity` is verified end-to-end live for **stream** and **dashboard** entity types: `/prepare` round-trip, merged grant set computed, sha-256 confirmation token (64-char lowercase hex) captured, clean isError envelope for unknown grantees. **The commit endpoint was never touched** — the pass-through interceptor's `assertSafeAuthzPath` saw zero forbidden paths.

The saved-search probe SKIPped (no saved-search view exists on the live `test` instance) — this is the same finding as Phase 9 (09-VERIFICATION.md) and is **not a regression**. It is bundled into the v3.1.0 milestone-close UAT.

### Task 2 — human-verify checkpoint disposition

**Resume signal received: `apply-uat-deferred-to-milestone-close`.**

Operator reasoning recorded verbatim in 10-VERIFICATION.md:

> The offline + dryRun-live evidence is sufficient for closing Phase 10. The full
> commit-endpoint exercise is logged as a milestone-close UAT pass per 10-RESEARCH
> Open Question 5 option (b) — defer to milestone close. The dryRun probe exercised
> the `/prepare` round-trip + merge + confirmation token end-to-end live; the
> commit-endpoint POST is the one remaining mutation surface and will be exercised
> against a freshly-created throwaway stream + dedicated test user at v3.1.0
> milestone close, per 08-TEST-STRATEGY.md.

This is the contractually valid Option B path — Phase 10 closes with offline (Plan 10-01 + 10-02) + dryRun-live (Plan 10-03 Task 1) evidence; the throwaway-entity full-apply round-trip is the operator-mediated milestone-close UAT.

## Task Commits

1. **Task 1: opt-in dryRun-only live smoke probe for share_entity** — `30d2ffa` (test)
2. **Task 2: human-verify checkpoint — throwaway-entity full-apply UAT** — *no source commit*; operator resume signal `apply-uat-deferred-to-milestone-close` recorded in 10-VERIFICATION.md and this SUMMARY.

**Plan metadata commit:** _pending — final commit captures 10-VERIFICATION.md + 10-03-SUMMARY.md + STATE.md + ROADMAP.md._

## Files Created/Modified

- `test/authz-share-entity-live.smoke.js` (NEW, committed `30d2ffa`) — opt-in dryRun-only live probe; excluded from `npm test` via the `.smoke.js` suffix.
- `.planning/phases/10-entity-sharing-write-path/10-VERIFICATION.md` (NEW) — live verification record (offline + dryRun-live evidence; operator UAT disposition).
- `.planning/phases/10-entity-sharing-write-path/10-03-SUMMARY.md` (NEW) — this file.

## Decisions Made

- **Operator chose Option B (defer the full-apply UAT to milestone close).** Rationale: offline tests cover all 8 Phase 10 requirements structurally; the dryRun-live probe verifies the `/prepare` round-trip + merge + token pipeline against real 7.0.6 data; the commit-endpoint POST is the only remaining surface and is operator-mediated by 08-TEST-STRATEGY.md contract. Acceptable per 10-RESEARCH Open Question 5 option (b). The deferral is captured in STATE.md's v3.1.0 Deferred Items.
- **Recorded outcomes in a standalone 10-VERIFICATION.md** (mirroring Phase 9's pattern) rather than only in the SUMMARY. The verification record is the canonical evidence artifact for the milestone-close audit and outlives the plan-scope SUMMARY.
- **Saved-search-view SKIP is not a regression.** The live `test` instance has no saved-search view — same finding as Phase 9 09-VERIFICATION.md. Bundled with the throwaway-entity UAT for milestone-close coverage.

## Deviations from Plan

**None.** Plan 10-03 executed exactly as specified:

- Task 1 created `test/authz-share-entity-live.smoke.js` mirroring the Phase 9 template; every acceptance gate is GREEN.
- Task 2 surfaced the human-verify checkpoint with the four documented resume signals; the operator selected Option B (`apply-uat-deferred-to-milestone-close`) — one of the explicitly enumerated valid choices.

## Issues Encountered

**None blocking.** One observation captured for milestone-close:

- The live `test` connection has no saved-search view, so the third entity type (`search`) SKIPped in the dryRun smoke. This is the same gap surfaced by Phase 9 09-VERIFICATION.md. Not a Phase 10 regression — bundled into the v3.1.0 milestone-close UAT alongside the throwaway-entity full-apply.

## Acceptance Gates (verified)

**Task 1 acceptance criteria (from PLAN.md):**

- File `test/authz-share-entity-live.smoke.js` exists and `node --check` exits 0 — ✅.
- File is named `*.smoke.js`; `npm test 2>&1 | grep -c authz-share-entity-live.smoke` returns 0 — ✅.
- File imports `handleShareEntity` from `../src/tools/authz/share-entity.js` — ✅.
- `grep -c 'dryRun: true' …` returns **6** (≥3 required) — ✅.
- `grep -cE 'dryRun *: *false' …` returns **0** (mandatory zero) — ✅.
- `grep -cE 'assertSafeAuthzPath|process\.exit\(2\)' …` returns **6** (≥2 required) — ✅.
- `grep -cE 'getConnections|getActiveConnectionConfig' …` returns **≥2** — ✅.
- No `.test.js` file imports the smoke probe (`grep -l 'authz-share-entity-live.smoke' test/*.test.js` → empty) — ✅.
- `npm test` full offline suite stays green (1156 pass / 0 fail) — ✅.
- Optional manual sanity: operator ran `node test/authz-share-entity-live.smoke.js` against the configured `test` connection — exit 0; outcome captured in 10-VERIFICATION.md §2 — ✅.

**Task 2 acceptance criteria (from PLAN.md):**

- Operator selected one of four documented resume signals — ✅ (`apply-uat-deferred-to-milestone-close`).
- Choice recorded in 10-VERIFICATION.md — ✅.
- Deferral captured in STATE.md v3.1.0 Deferred Items table — ✅ (this commit).

## Threat Model Validation (from PLAN.md `<threat_model>`)

- **T-10-03-01 (Information Disclosure — smoke probe mis-targeting a real production entity, HIGHEST PRIORITY):** **Mitigated.** Probe is `dryRun: true` ONLY (acceptance gate: `grep -cE 'dryRun *: *false'` → 0); wrapper's handler.js step 6 returns the preview BEFORE step 7 apply runs; pass-through interceptor's `assertSafeAuthzPath` aborts `process.exit(2)` on any commit-endpoint path observation (defense in depth). The live run confirmed zero forbidden-path observations and zero mutations.
- **T-10-03-02 (Information Disclosure — throwaway-entity UAT leaks a grant to a real user):** **Mitigated (operator-mediated).** The operator declined to auto-execute Option A and deferred to milestone close. The 08-TEST-STRATEGY.md throwaway-entity rule is the structural control when Option A is eventually run.
- **T-10-03-03 (Tampering — smoke-probe self-guard regression):** **Mitigated.** Task 1 acceptance gates grep for both `assertSafeAuthzPath` AND `process.exit(2)`; both present (count: 6). The pass-through interceptor pattern verbatim mirrors Phase 9's smoke.
- **T-10-03-04 (DoS / CI flakiness — smoke probe in `npm test`):** **Mitigated.** `.smoke.js` suffix excludes the file from the test glob; acceptance gate verified `npm test 2>&1 | grep -c authz-share-entity-live.smoke` → 0.
- **T-10-03-05 (Repudiation — UAT leaves no record):** **Mitigated.** The operator's deferral choice and reasoning are captured verbatim in 10-VERIFICATION.md §3 and in this SUMMARY. STATE.md's v3.1.0 Deferred Items will capture the deferral as a milestone-close UAT item.
- **T-10-03-06 (Information Disclosure — smoke probe logs leak GRNs):** **Mitigated.** Probe prints one-line success summaries; no request bodies are logged. The dry-run envelopes contain GRNs by necessity (they are the agent-facing output) but the probe writes no log file by default.
- **T-10-03-SC (Supply Chain — npm/pip/cargo installs):** **Mitigated.** ZERO new packages installed in Plan 10-03. The smoke probe imports only existing modules.

## Known Stubs

**None.** The smoke probe is a verification artifact, not a feature surface. All assertions are concrete; no placeholder/TODO/empty-data paths exist.

## Self-Check: PASSED

- `test/authz-share-entity-live.smoke.js` exists: **FOUND** (committed `30d2ffa`).
- `.planning/phases/10-entity-sharing-write-path/10-VERIFICATION.md` exists: **FOUND** (this plan).
- `.planning/phases/10-entity-sharing-write-path/10-03-SUMMARY.md` exists: **FOUND** (this file).
- Task 1 commit `30d2ffa` in `git log --oneline -20`: **FOUND** (`test(10-03): opt-in dryRun-only live smoke probe for share_entity`).
- `grep -c 'dryRun: true' test/authz-share-entity-live.smoke.js`: **6** (≥3 required).
- `grep -cE 'dryRun *: *false' test/authz-share-entity-live.smoke.js`: **0**.
- `grep -cE 'assertSafeAuthzPath|process\.exit\(2\)' …`: **6**.
- `node --check test/authz-share-entity-live.smoke.js`: exit **0**.
- `npm test`: **1156 pass / 0 fail / 0 skipped** — full offline suite GREEN.
- `npm test 2>&1 | grep -c authz-share-entity-live.smoke`: **0** — smoke probe excluded from automated suite.
- Operator UAT disposition recorded: **`apply-uat-deferred-to-milestone-close`** (Option B) — captured in 10-VERIFICATION.md and this SUMMARY.

## Next Phase Readiness

- **Phase 10 is COMPLETE.** All 3 plans landed; all 8 Phase 10 requirements (SHARE-01, 03, 04, 05, 06, 07, 08, AUTHZ-01) have offline + dryRun-live evidence. The throwaway-entity full-apply UAT is the v3.1.0 milestone-close operator-mediated step.
- **Phase 11 (role management) can start immediately.** Pattern set for Phase 11's live verification: `.smoke.js` opt-in probe + human-verify checkpoint for any mutating role tool. `role_update` (when its REPLACE-semantics endpoint is shipped) can adopt the same defineMutatingHandler + computeShareGrantHash-style token pattern Plan 10-02 demonstrated.
- **v3.1.0 milestone close** has two deferred live-UAT items to bundle:
  1. Throwaway-entity full-apply UAT for `share_entity` (per 08-TEST-STRATEGY.md, this plan's Task 2 deferral).
  2. Saved-search-view dryRun smoke — same as Phase 9; no saved-search view exists on the live `test` instance.
- **No blockers carried forward.**

---
*Phase: 10-entity-sharing-write-path*
*Completed: 2026-05-20*
