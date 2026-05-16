---
phase: 05
slug: events-notifications
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-15
completed: 2026-05-16
---

# Phase 05 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | `node:test` (Node 22+ builtin) |
| Config file | `test/snapshot-config.js` |
| Quick run command | `node --test test/events.test.js test/schema-parity.test.js test/snapshots/events.test.js` |
| Full suite command | `npm test` |
| Final suite size | 856 tests / 18 suites, ~5.1 s runtime |

## Sampling Rate

- After every task commit: quick run
- After every plan wave: full suite
- Before /gsd-verify-work: full suite green + 13 fixtures byte-identical

## Per-Task Verification Map

| Requirement | Test Type | Status |
|-------------|-----------|--------|
| EVENT-01..09 (11 tools) | unit + snapshot per RESEARCH | ✅ |
| M1 acceptance gate (schedule=false default) | snapshot | ✅ |
| C5 acceptance gate (v6→v7 migrated_from_v6_shape) | snapshot | ✅ |
| D-09 cascade-hash byte-identity + drift refusal | unit + snapshot | ✅ |
| 6-variant discriminator union (5 valid + 1 invalid reject) | unit + snapshot | ✅ |
| enable/disable empty-body wire shape | unit + snapshot | ✅ |
| http-notification-v2 STRICT_NO_ECHO on encrypted fields | unit + snapshot (C3) | ✅ |
| schema-parity (11 tools) | unit | ✅ |

## Wave 0 Requirements

- [x] test/events.test.js
- [x] test/snapshots/events.test.js + test/snapshots/__snapshots__/events.test.js.snapshot (13 fixtures)
- [x] src/tools/events/ (11 handler files + schemas.js + index.js)
- [x] src/tools/_shared/conflict.js — `elements` envelope amendment
- [x] src/tools/_register.js — displace v2.3 list_event_definitions + list_event_notifications
- [x] test/schema-parity.test.js (+11 assertions)

## Manual-Only Verifications

| Behavior | Why Manual |
|----------|------------|
| Live `create_event_definition` against <graylog-host> | Confirms M1 wire shape |
| Live C5 migration round-trip | Confirms aggregation evaluator picks up v7 shape |
| Live discriminator rejection | RBAC + parse error envelope |
| WILDCARD body shape (undefined vs "") | Reverse-proxy Content-Length quirks |
| D-09 drift refusal against live race | Requires real notification + event_def + concurrent change |

## Approval

**Approval:** complete (Plan 05-05 Task 3 human-verify auto-approved 2026-05-16 per AFK directive; live-cluster E2E verifications above are deferred to `/gsd-verify-work 05`)
