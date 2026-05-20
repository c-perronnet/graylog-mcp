---
phase: 10
slug: entity-sharing-write-path
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-20
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Technical core derived from `10-RESEARCH.md` → Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node ≥ 22.3.0 built-in) + `node:assert/strict` |
| **Config file** | none — test discovery is the glob in `package.json` |
| **Quick run command** | `node --test test/authz-share-entity.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | quick: ~1s · full suite: baseline 1136 + ~15 new Phase 10 tests |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/authz-share-entity.test.js`
- **After every plan wave:** Run `npm test` — full offline suite stays green
- **Before `/gsd:verify-work`:** Full suite green AND an opt-in `dryRun: true` live probe against the `test` instance (apply against a throwaway entity is human-UAT-gated)
- **Max feedback latency:** ~1 second (quick run)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 10-01 | 1 | SHARE-01..08, AUTHZ-01 | T-10-02-01 (silent grant revocation, **high**) | Wave 0 offline test scaffold incl. the MANDATORY Pitfall-1 acceptance gate (three-grantee read-merge-write) | unit | `node --test test/authz-share-entity.test.js` | ❌ W0 | ⬜ pending |
| 10-01-02 | 10-01 | 1 | SHARE-01..08, AUTHZ-01 | see 10-01 `<threat_model>` | `ShareEntitySchema` (mutatingBase + entity XOR + grantee XOR + revoke↔capability refine + `Capability` / `ENTITY_TYPES` enums) — malformed input rejected client-side, no HTTP call | unit (tdd) | `node --test test/authz-share-entity.test.js` | ❌ W0 | ⬜ pending |
| 10-02-01 | 10-02 | 2 | SHARE-01..08, AUTHZ-01 | see 10-02 `<threat_model>` | `share-entity.js` handler — `defineMutatingHandler` + read-merge-write via `fetchEntitySharePreview` + `computeShareGrantHash` token + last-`own` guard + 400-with-body parser + 403→`not_entity_owner` | unit (tdd) | `node --test test/authz-share-entity.test.js` | ❌ W0 | ⬜ pending |
| 10-02-02 | 10-02 | 2 | SHARE-01..08, AUTHZ-01 | see 10-02 `<threat_model>` | `share_entity` registered in authz barrel + `tools.js` + `DOMAIN_OVERRIDES`; tool count 93 → 94; full suite stays green | integration | `npm test` | ✅ existing | ⬜ pending |
| 10-03-01 | 10-03 | 3 | SHARE-01..08, AUTHZ-01 | see 10-03 `<threat_model>` | Opt-in `dryRun: true`-only live smoke probe; commit endpoint grep-absent; never `builtin-team:everyone` | smoke (live-gated) | `node test/authz-share-entity-live.smoke.js` | ❌ W0 | ⬜ pending |
| 10-03-02 | 10-03 | 3 | SHARE-01..08, AUTHZ-01 | see 10-03 `<threat_model>` | Human-verify throwaway-entity full-apply UAT against live `test` instance (per 08-TEST-STRATEGY.md) | manual / human-verify | checkpoint:human-verify (N/A) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Backfilled 2026-05-20 after planning (3 plans, 6 tasks). Per-task threat detail lives in each PLAN.md `<threat_model>` block (17 STRIDE entries across 3 plans; T-10-02-01 silent grant revocation is high-severity).*

---

## Wave 0 Requirements

- [ ] `test/authz-share-entity.test.js` — offline Wave 0 file covering the full requirement → test map (read-merge-write **PITFALL-1 acceptance gate** is mandatory; drift refusal; capability enum rejection; revoke; last-`own` guard; HTTP 400-with-`validation_result` round-trip; ownership-403; confirmation-token mismatch; GRN-type matrix stream/dashboard/search)
- [ ] `test/authz-share-entity-live.smoke.js` — opt-in `dryRun: true` live probe against the `test` instance (mirrors `test/authz-entity-shares-live.smoke.js`). Excluded from `npm test` via `.smoke.js` suffix
- [ ] Tool-count assertions in `test/list-admin-tools.test.js`, `test/pipelines.test.js`, `test/dashboards.test.js` updated 93 → 94
- [ ] `src/tools/meta/list-admin-tools.js` `DOMAIN_OVERRIDES` updated — add `share_entity` → `authz`
- [ ] No framework install needed — `node:test` is built in

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `dryRun: true` live probe against the production `test` instance | AUTHZ-01 | Requires a network call to live UNESCO-production Graylog 7.0.6; safe (only `/prepare`, `@NoAuditEvent`) | Run the smoke probe; assert `share_entity --dryRun true` returns a well-formed dry-run envelope with the confirmation token and merged grant set. The commit endpoint must NOT be exercised. |
| Apply against a throwaway entity | SHARE-01..08 | Hits the live commit endpoint — a real mutation. Must use a freshly-created throwaway stream + a dedicated test user; NEVER `builtin-team:everyone`; NEVER an existing production entity | Per `08-TEST-STRATEGY.md`: create throwaway entity, share-to-test-user, observe, revoke, delete entity. Captured commit-response fixture is the deliverable for next phase's offline tests. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] **PITFALL-1 acceptance gate present and mandatory** (read-merge-write — three-grantee test)
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-20
