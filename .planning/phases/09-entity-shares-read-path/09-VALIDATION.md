---
phase: 9
slug: entity-shares-read-path
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-19
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Technical core derived from `09-RESEARCH.md` → Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node ≥ 22.3.0 built-in) + `node:assert/strict` |
| **Config file** | none — test discovery is the glob in `package.json` |
| **Quick run command** | `node --test test/authz-entity-shares.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | quick: sub-second · full suite: ~baseline (1120+ tests) |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/authz-entity-shares.test.js` (offline)
- **After every plan wave:** Run `npm test` — full suite stays green; authz portion fully offline
- **Before `/gsd:verify-work`:** Full suite green AND one live non-mutating `/prepare`-only smoke run against the `test` connection
- **Max feedback latency:** sub-second (quick run)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _TBD — backfilled after planning, before plan-checker_ | — | — | SHARE-02 / SHARE-09 | — | — | unit | `node --test test/authz-entity-shares.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/authz-entity-shares.test.js` — offline unit tests for `get_entity_shares` + `list_grantees` (fixture-replay via the `_testConnection` seam + the `client.js` `_setCaptureRequest` request-capture seam). Covers SHARE-02, SHARE-09.
- [ ] Live non-mutating smoke check — a `/prepare`-only probe against the `test` connection (`*.smoke.js` or a `scripts/` probe in the `capture-authz-prepare-fixture.js` mould). Not part of `npm test`.
- [ ] Possible fixture extension — a dashboard and/or saved-search `prepare` capture if multi-type live verification is pursued; the existing stream fixture is the floor.
- [ ] No framework install needed — `node:test` is built in; `test/authz-grn.test.js` already establishes the authz test-file pattern.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live non-mutating smoke against the production `test` instance | SHARE-02, SHARE-09 | Requires a network call to live UNESCO-production Graylog 7.0.6; read-only (`/prepare` is `@NoAuditEvent`) | Run the smoke probe; assert `get_entity_shares` / `list_grantees` return a well-formed `EntityShareResponse`-derived result. The commit endpoint must NOT be exercised. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
