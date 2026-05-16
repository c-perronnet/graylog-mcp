---
phase: 06
slug: dashboards-widgets-blueprints
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-16
---

# Phase 06 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | `node:test` (Node 22+ builtin) |
| Config file | `test/snapshot-config.js` |
| Quick run command | `node --test test/dashboards.test.js test/blueprints.test.js test/widget-templates.test.js test/schema-parity.test.js` |
| Full suite command | `npm test` |
| Estimated runtime | ~7 s quick, ~15 s full (856 existing + ~120 new ≈ ~975 tests) |

## Sampling Rate

- After every task commit: quick run
- After every plan wave: full suite
- Before /gsd-verify-work: full suite green + 14 fixtures byte-identical + BLUE-01 chain transcript pinned

## Per-Task Verification Map

| Requirement | Test Type | Status |
|-------------|-----------|--------|
| DASH-01..07 (7 dashboard CRUD + widget ops) | unit + snapshot | ⬜ |
| DASH-08 (8 curated widget templates) | unit + snapshot per template | ⬜ |
| BLUE-01 setup_app_monitoring_stack (headline) | unit + chain snapshot | ⬜ |
| BLUE-02..06 | unit + chain snapshot per blueprint | ⬜ |
| C7 acceptance gate (two-step Search+View chain) | snapshot | ⬜ |
| C7 widget-position integrity (client-side) | unit | ⬜ |
| dependsOn chain transcript shape | unit + snapshot | ⬜ |
| Services layer compose contract (blueprints use services, not handlers) | grep | ⬜ |
| schema-parity (14 tools) | unit | ⬜ |

## Wave 0 Requirements

- [ ] test/dashboards.test.js
- [ ] test/blueprints.test.js
- [ ] test/widget-templates.test.js
- [ ] test/snapshots/dashboards.test.js (+widget templates + blueprints fixtures)
- [ ] src/tools/dashboards/ (8 handler files + schemas.js + index.js)
- [ ] src/tools/blueprints/ (6 handler files + schemas.js + index.js)
- [ ] src/services/{streams,pipelines,inputs,index-sets,events,dashboards}.js
- [ ] src/widget-templates/ (8 templates + index.js)
- [ ] test/schema-parity.test.js (+14 assertions)

## Manual-Only Verifications

| Behavior | Why Manual |
|----------|------------|
| BLUE-01 end-to-end against live Graylog | Full chain composition; smoke check that all 6 steps apply cleanly |
| C7 widget-position integrity on live cluster | Confirms server-side validateSearchProperties matches wrapper's client-side check |
| Widget template visual rendering | Visual confirmation in Graylog UI; not unit-testable |

## Approval

**Approval:** pending
