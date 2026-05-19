---
phase: 8
slug: authz-foundation-grn-helper-live-api-recon
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-19
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Technical core derived from `08-RESEARCH.md` → Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node ≥ 22.3.0 built-in) + `node:assert/strict` |
| **Config file** | none — test discovery is the glob in `package.json` |
| **Quick run command** | `node --test test/authz-grn.test.js test/cascade-hash.test.js` |
| **Full suite command** | `npm test` (`node --test 'test/**/*.test.js'`) |
| **Estimated runtime** | ~quick: <5s · full suite: ~baseline (1076+ tests) |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/authz-grn.test.js test/cascade-hash.test.js`
- **After every plan wave:** Run `npm test` — confirms the `_register.js` edit broke nothing
- **Before `/gsd:verify-work`:** Full suite green AND the live 7.0.6 `prepare` fixture captured + committed
- **Max feedback latency:** ~5 seconds (quick run)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 08-01 | 1 | AUTHZ-02 | see 08-01 `<threat_model>` | Malformed GRN rejected client-side before any request reaches Graylog | unit (tdd) | `node --test test/authz-grn.test.js` | ❌ W0 | ⬜ pending |
| 08-01-02 | 08-01 | 1 | AUTHZ-02 | see 08-01 `<threat_model>` | `Capability` enum pinned to exactly `view`/`manage`/`own`; other strings rejected | unit (tdd) | `node --test test/authz-grn.test.js` | ❌ W0 | ⬜ pending |
| 08-01-03 | 08-01 | 1 | AUTHZ-02 | see 08-01 `<threat_model>` | `authz` barrel wired with zero handlers registered; full suite stays green | integration | `npm test` | ✅ existing | ⬜ pending |
| 08-02-01 | 08-02 | 1 | AUTHZ-02 | see 08-02 `<threat_model>` | `computeShareGrantHash` standalone canonical-form sha-256 (not forwarded) | unit (tdd) | `node --test test/cascade-hash.test.js` | ✅ extend | ⬜ pending |
| 08-02-02 | 08-02 | 1 | AUTHZ-02 | see 08-02 `<threat_model>` | Byte-identity pinned — canonical-form drift fails loudly | unit (tdd) | `node --test test/cascade-hash.test.js` | ✅ extend | ⬜ pending |
| 08-03-01 | 08-03 | 2 | AUTHZ-02 | see 08-03 `<threat_model>` | Probe calls only `@NoAuditEvent .../prepare`; commit endpoint grep-absent | unit (syntax + content) | `node -c scripts/capture-authz-prepare-fixture.js` | ❌ W0 | ⬜ pending |
| 08-03-02 | 08-03 | 2 | AUTHZ-02 | see 08-03 `<threat_model>` | Read-only live `/prepare` against the `test` instance — human-verified | manual / live-gated | checkpoint:human-verify (N/A) | ❌ W0 | ⬜ pending |
| 08-03-03 | 08-03 | 2 | AUTHZ-02 | see 08-03 `<threat_model>` | Captured fixture has the expected `EntityShareResponse` keys | unit (fixture-shape) | `node --test test/authz-grn.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Backfilled 2026-05-19 after planning (3 plans, 8 tasks). Per-task threat detail lives in each PLAN.md `<threat_model>` block (threats T-08-01..09 + T-08-SC).*

---

## Wave 0 Requirements

- [ ] `test/authz-grn.test.js` — unit tests for `grn-helpers.js` (round-trip, unknown-type rejection, lowercasing, `isGrn` predicate) and `schemas.js` (`Capability` enum). Covers the AUTHZ-02 GRN-format criteria.
- [ ] `test/cascade-hash.test.js` — **extend** (file exists) with `computeShareGrantHash` byte-identity + grant-order-independence tests.
- [ ] `test/fixtures/authz/prepare-response-7.0.6.json` — captured verbatim live 7.0.6 `prepare` response (data file, Wave 0 deliverable).
- [ ] `scripts/capture-authz-prepare-fixture.js` — one-shot read-only live `/prepare` probe script.
- [ ] No framework install needed — `node:test` is built in.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Corrected endpoint `POST /api/authz/shares/entities/{entityGRN}/prepare` verified against the live `test` instance | AUTHZ-02 | Requires a network call to the live UNESCO production Graylog 7.0.6; must be read-only (`/prepare` is `@NoAuditEvent`) | Run `node scripts/capture-authz-prepare-fixture.js`; assert HTTP 200, an `EntityShareResponse` body, and commit the response under `test/fixtures/authz/`. The commit endpoint must NOT be exercised. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-19
