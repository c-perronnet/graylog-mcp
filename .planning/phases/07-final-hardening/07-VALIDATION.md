---
phase: 07
slug: final-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-16
---

# Phase 07 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | `node:test` + `c8` (HARD-04) |
| Quick run | `node --test test/audit-tool-descriptions.test.js test/list-admin-tools.test.js` |
| Full suite | `npm test` |
| Coverage report | `c8 node --test 'test/**/*.test.js'` |
| Estimated runtime | ~6 s quick, ~15 s full (1045 existing + ~25 new ≈ ~1070 tests) |

## Per-Task Verification Map

| Requirement | Test Type | Status |
|-------------|-----------|--------|
| HARD-01 audit script + merge-gate | unit + ci-gate | ⬜ |
| HARD-01 every existing tool ≤200 chars + discrimination | unit (audit-run) | ⬜ |
| HARD-02 list_admin_tools meta-tool | unit + snapshot | ⬜ |
| HARD-03 v7-vs-v6 smoke (25 v2.3 tools) | unit (fixture-based default; live bonus) | ⬜ |
| HARD-04 c8 coverage baseline documented | manual | ⬜ |
| HARD-05 migration doc exists | file-presence | ⬜ |
| schema-parity for list_admin_tools | unit | ⬜ |

## Wave 0 Requirements

- [ ] scripts/audit-tool-descriptions.js
- [ ] test/audit-tool-descriptions.test.js
- [ ] src/tools/meta/list-admin-tools.js
- [ ] test/list-admin-tools.test.js
- [ ] test/snapshots/list-admin-tools.test.js
- [ ] .planning/MIGRATION-streams-paginated.md
- [ ] .planning/MILESTONE-SUMMARY.md
- [ ] package.json (+c8 devDep, +coverage script)
- [ ] All existing tool descriptions audited and fixed to comply

## Manual-Only Verifications

| Behavior | Why Manual |
|----------|------------|
| Live HARD-03 smoke against <graylog-host> | Confirms v2.3 read tools still work on Graylog 7.0.6 |
| Live histogram fallback chain | Each of 4 strategies must be exercised individually |

## Approval

**Approval:** pending
