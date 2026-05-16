---
phase: 07
slug: final-hardening
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-16
last_updated: "2026-05-16"
---

# Phase 07 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | `node:test` + `c8` (HARD-04) |
| Quick run | `node --test test/tool-description-audit.test.js test/list-admin-tools.test.js test/v7-read-tool-smoke.test.js` |
| Full suite | `npm test` |
| Coverage report | `npm run coverage` |
| Final test count | 1073 (1045 baseline + 10 audit + 6 list_admin_tools + 1 schema-parity + 11 v7 smoke) |
| Final coverage | 93.58% statements / 79.13% branches / 89.93% functions / 93.58% lines |

## HARD requirements

- [x] **HARD-01:** Tool-description audit script + wholesale-fix pass — 91 descriptions, 0 violations (all ≤200 chars with discrimination sentence). Closed by Plan 07-01 (`scripts/audit-tool-descriptions.js`, `test/tool-description-audit.test.js`).
- [x] **HARD-02:** `list_admin_tools` meta-tool registered — tool count 90 → 91. Pure-static, no Graylog connection required. Closed by Plan 07-02 Task 1 (`src/tools/meta/list-admin-tools.js`, `test/list-admin-tools.test.js`).
- [x] **HARD-03:** v7-vs-v6 read-tool smoke — 5 fixtures + 11 tests covering the 5 critical drift surfaces from PITFALLS.md backward-compat (GET /api/streams, POST /api/views/search/sync messages, POST /api/views/search/sync histogram × 4 fallback strategies + exhausted, POST /api/events/search, GET /api/events/definitions, GET /api/events/notifications). Closed by Plan 07-03 Task 1 (`test/v7-read-tool-smoke.test.js`, `test/fixtures/v7-read-tool-smoke/`).
- [x] **HARD-04:** c8 coverage integration — baseline 93.58% statements captured in `MILESTONE-SUMMARY.md`. Closed by Plan 07-02 Task 2 (`package.json` coverage script, c8@^10.1.3 devDep).
- [x] **HARD-05:** `/api/streams` deprecation migration plan published at `docs/STREAMS_DEPRECATION_MIGRATION.md` with v7.2 shape diff + effort estimate + sources. Closed by Plan 07-03 Task 2.

## Per-Task Verification Map

| Requirement | Test Type | Status |
|-------------|-----------|--------|
| HARD-01 audit script + merge-gate | unit + ci-gate | done |
| HARD-01 every existing tool ≤200 chars + discrimination | unit (audit-run) | done |
| HARD-02 list_admin_tools meta-tool | unit + snapshot | done |
| HARD-03 v7-vs-v6 smoke (priority targets) | unit (fixture-based per CONTEXT.md D-07) | done |
| HARD-04 c8 coverage baseline documented | manual + automated capture | done |
| HARD-05 migration doc exists | file-presence | done |
| schema-parity for list_admin_tools | unit | done |

## Gates passed

- [x] `node scripts/audit-tool-descriptions.js` exits 0 (91 descriptions, 0 violations)
- [x] `node --test test/tool-description-audit.test.js` 10/10 pass
- [x] `node --test test/list-admin-tools.test.js` 6/6 pass
- [x] `node --test test/schema-parity.test.js` includes the list_admin_tools zod-less parity test
- [x] `node --test test/v7-read-tool-smoke.test.js` 11/11 pass
- [x] `npm test` full suite green (1073/1073)
- [x] `npm run coverage` exits 0; baseline captured
- [x] `npm run audit:tool-descriptions` wired
- [x] `MILESTONE-SUMMARY.md` exists with aggregated numbers (tool count, coverage, requirements, outstanding HUMAN-UAT)
- [x] `docs/STREAMS_DEPRECATION_MIGRATION.md` exists with migration plan
- [x] `assertAllToolsRegistered` passes against 91 tool definitions

## Wave 0 Requirements

- [x] `scripts/audit-tool-descriptions.js`
- [x] `test/tool-description-audit.test.js`
- [x] `src/tools/meta/list-admin-tools.js`
- [x] `src/tools/meta/index.js`
- [x] `test/list-admin-tools.test.js`
- [x] `test/v7-read-tool-smoke.test.js`
- [x] `test/fixtures/v7-read-tool-smoke/` (5 JSON files)
- [x] `docs/STREAMS_DEPRECATION_MIGRATION.md`
- [x] `.planning/phases/07-final-hardening/MILESTONE-SUMMARY.md`
- [x] `package.json` (+c8 devDep, +coverage script, +audit:tool-descriptions script)
- [x] All 91 tool descriptions audited and compliant

## Manual-Only Verifications (Deferred)

Out of scope for this milestone per CONTEXT.md D-07; documented in
`MILESTONE-SUMMARY.md` under "Outstanding human-UAT items":

| Behavior | Why Manual |
|----------|------------|
| Live HARD-03 smoke against a live Graylog 7.2 cluster | Confirms v2.3 read tools still work on actual 7.0.6/7.2 cluster (default fixture-based; live optional) |
| Live histogram fallback chain (each of 4 strategies) | Bonus path — fixture-based smoke covers shape; live confirms trip points |

## Approval

**Approval:** complete (milestone close)
