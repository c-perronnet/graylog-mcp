---
phase: 06
slug: dashboards-widgets-blueprints
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-16
last_updated: 2026-05-15
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
- Before /gsd-verify-work: full suite green + 24 fixtures byte-identical + BLUE-01 chain transcript pinned

## Per-Task Verification Map

| Requirement | Test Type | Status |
|-------------|-----------|--------|
| DASH-01..07 (7 dashboard CRUD + widget ops) | unit + snapshot | ✓ |
| DASH-08 (8 curated widget templates) | unit + snapshot per template | ✓ |
| BLUE-01 setup_app_monitoring_stack (headline) | unit + chain snapshot | ✓ |
| BLUE-02..06 | unit + chain snapshot per blueprint | ✓ |
| C7 acceptance gate (two-step Search+View chain) | snapshot | ✓ |
| C7 widget-position integrity (client-side) | unit | ✓ |
| dependsOn chain transcript shape | unit + snapshot | ✓ |
| Services layer compose contract (blueprints use services, not handlers) | grep | ✓ |
| schema-parity (14 tools) | unit | ✓ |

## Wave 0 Requirements

- [x] test/dashboards.test.js
- [x] test/blueprints.test.js
- [x] test/widget-templates.test.js
- [x] test/snapshots/dashboards.test.js (+widget templates + blueprints fixtures)
- [x] src/tools/dashboards/ (8 handler files + schemas.js + index.js)
- [x] src/tools/blueprints/ (6 handler files + schemas.js + index.js)
- [x] src/services/{streams,pipelines,inputs,index-sets,events,dashboards}.js
- [x] src/widget-templates/ (8 templates + index.js)
- [x] test/schema-parity.test.js (+14 assertions)

## Manual-Only Verifications

| Behavior | Why Manual |
|----------|------------|
| BLUE-01 end-to-end against live Graylog | Full chain composition; smoke check that all 6 steps apply cleanly |
| C7 widget-position integrity on live cluster | Confirms server-side validateSearchProperties matches wrapper's client-side check |
| Widget template visual rendering | Visual confirmation in Graylog UI; not unit-testable |

## Approval

**Approval:** auto-approved 2026-05-15 (AFK auto-resolution; user "keep going to end of milestone without me" directive).

The 24 byte-stable snapshot fixtures (9 dashboard + 8 widget-template + 7
blueprint) plus 15 net-new schema-parity assertions (13 tool parity + 2 D-02
structural) provide a structural correctness gate equivalent to a live-cluster
UAT for the test-pinnable surface. Live-cluster verification of BLUE-01's
apply path remains a recommended follow-up but is not blocking — the snapshot
fixtures pin every wire-shape contract (chain transcript shape, dependsOn
annotations, composite step 5 inner chain, ?schedule=false invariant
carry-forward, partial-failure transcript shape) and the schema-parity tests
pin every tool's input contract against the runtime zod validator.

HUMAN-UAT against a live Graylog cluster (Wave 1) is persisted separately by
the orchestrator after operator verification per the AFK protocol.
