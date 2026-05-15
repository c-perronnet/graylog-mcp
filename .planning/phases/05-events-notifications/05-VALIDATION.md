---
phase: 05
slug: events-notifications
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-15
---

# Phase 05 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | `node:test` (Node 22+ builtin) |
| Config file | `test/snapshot-config.js` |
| Quick run command | `node --test test/events.test.js test/schema-parity.test.js` |
| Full suite command | `npm test` |
| Estimated runtime | ~5 s quick, ~14 s full (701 existing + ~80 new ≈ ~780 tests) |

## Sampling Rate

- After every task commit: quick run
- After every plan wave: full suite
- Before /gsd-verify-work: full suite green + 12 fixtures byte-identical

## Per-Task Verification Map

| Requirement | Test Type | Status |
|-------------|-----------|--------|
| EVENT-01..09 (11 tools) | unit + snapshot per RESEARCH | ⬜ pending |
| M1 acceptance gate (schedule=false default) | snapshot | ⬜ |
| C5 acceptance gate (v6→v7 migrated_from_v6_shape) | snapshot | ⬜ |
| D-09 cascade-hash byte-identity + drift refusal | unit | ⬜ |
| 6-variant discriminator union (5 valid + 1 invalid reject) | unit | ⬜ |
| enable/disable empty-body wire shape | unit | ⬜ |
| http-notification-v2 STRICT_NO_ECHO on encrypted fields | unit | ⬜ |
| schema-parity (11 tools) | unit | ⬜ |

## Wave 0 Requirements

- [ ] test/events.test.js
- [ ] test/__snapshots__/events.test.js.snapshot (12 fixtures)
- [ ] src/tools/events/ (11 handler files + schemas.js + index.js)
- [ ] src/tools/_shared/conflict.js — `elements` envelope amendment
- [ ] src/tools/_register.js — displace v2.3 list_event_definitions + list_event_notifications
- [ ] test/schema-parity.test.js (+11 assertions)

## Manual-Only Verifications

| Behavior | Why Manual |
|----------|------------|
| Live `create_event_definition` against <graylog-host> | Confirms M1 wire shape |
| Live C5 migration round-trip | Confirms aggregation evaluator picks up v7 shape |
| Live discriminator rejection | RBAC + parse error envelope |
| WILDCARD body shape (undefined vs "") | Reverse-proxy Content-Length quirks |
| D-09 drift refusal against live race | Requires real notification + event_def + concurrent change |

## Approval

**Approval:** pending
