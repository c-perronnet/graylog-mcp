---
phase: 02
slug: index-sets-retention
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-15
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node 22+ builtin) |
| **Config file** | `test/snapshot-config.js` (snapshot path override; established Phase 0) |
| **Quick run command** | `node --test test/index-sets.test.js test/system-job.test.js test/schema-parity.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 s quick, ~12 s full (235 existing + ~25 new = ~260 tests) |

---

## Sampling Rate

- **After every task commit:** `node --test test/index-sets.test.js test/system-job.test.js test/schema-parity.test.js`
- **After every plan wave:** `npm test`
- **Before `/gsd-verify-work`:** Full suite green AND two consecutive `npm test` runs must produce byte-identical md5sums of all `.snapshot` files (FOUND-07 carry-over; 9 new fixtures added this phase)
- **Max feedback latency:** 12 s

---

## Per-Task Verification Map

> Task IDs are not yet allocated; this table maps each Phase 2 requirement (plus key user decisions and the new pitfalls ND1/ND2/ND3/U1 from RESEARCH.md) to its automated check and pin file. The planner attaches concrete task IDs once plans are generated.

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| INDEX-01 | `list_index_sets` narrow projection (default+writable flags) | unit | `node --test test/index-sets.test.js -t 'list_index_sets default fields include default+writable'` | ❌ W0 | ⬜ pending |
| INDEX-01 | `list_index_sets` envelope normalization handles `{ index_sets: [...] }` shape | unit | `node --test test/index-sets.test.js -t 'list_index_sets unwraps index_sets envelope'` | ❌ W0 | ⬜ pending |
| INDEX-02 | `get_index_set` returns full IndexSetResponse DTO | unit | `node --test test/index-sets.test.js -t 'get_index_set returns full DTO'` | ❌ W0 | ⬜ pending |
| INDEX-03 | `create_index_set` requires both rotation+retention with configs (D-10) | unit | `node --test test/index-sets.test.js -t 'create_index_set rejects missing strategies'` | ❌ W0 | ⬜ pending |
| INDEX-03 | `create_index_set` time-based+delete dry-run emits correct FQCNs | unit + snapshot | `node --test test/index-sets.test.js -t 'create_index_set time-based+delete dry-run'` | ❌ W0 | ⬜ pending |
| INDEX-03 | `create_index_set` strategy_config superRefine narrows per alias | unit | `node --test test/index-sets.test.js -t 'create_index_set rejects mismatched config for size-based'` | ❌ W0 | ⬜ pending |
| INDEX-04 | `update_index_set` D-11 atomic strategy-replace rejects partial-strategy | unit | `node --test test/index-sets.test.js -t 'update_index_set rejects rotation_strategy without config'` | ❌ W0 | ⬜ pending |
| INDEX-04 | `update_index_set` partial title-only matches U1 resolution (merge-from-current or strict no-echo per smoke-test outcome) | unit + snapshot | `node --test test/index-sets.test.js -t 'update_index_set partial title-only'` | ❌ W0 | ⬜ pending |
| INDEX-05 | `delete_index_set` defaults `deleteIndices: false` (D-04) | unit + snapshot | `node --test test/index-sets.test.js -t 'delete_index_set default is delete_indices=false'` | ❌ W0 | ⬜ pending |
| INDEX-05 | `delete_index_set` with `deleteIndices: true` issues confirmationToken (D-01) | unit + snapshot | `node --test test/index-sets.test.js -t 'delete_index_set confirmationToken populated'` | ❌ W0 | ⬜ pending |
| INDEX-05 | `delete_index_set` apply rejects mismatched `confirm` | unit | `node --test test/index-sets.test.js -t 'delete_index_set rejects bad confirm'` | ❌ W0 | ⬜ pending |
| INDEX-05 | `delete_index_set` D-05 stats_unreachable hard-blocks dry-run | unit | `node --test test/index-sets.test.js -t 'delete_index_set blocks on stats_unreachable'` | ❌ W0 | ⬜ pending |
| INDEX-05 | `delete_index_set` ND1 refuses default index set | unit | `node --test test/index-sets.test.js -t 'delete_index_set refuses default index set'` | ❌ W0 | ⬜ pending |
| INDEX-06 | `set_default_index_set` D-13 surfaces non-regular as dry-run error (pitfall m2) | unit + snapshot | `node --test test/index-sets.test.js -t 'set_default_index_set non-regular preflight'` | ❌ W0 | ⬜ pending |
| INDEX-07 | `cycle_deflector` ND3 refuses non-writable index set | unit | `node --test test/index-sets.test.js -t 'cycle_deflector refuses non-writable'` | ❌ W0 | ⬜ pending |
| INDEX-07 | `cycle_deflector` issues POST and returns sync response with `side_effects.observable_at` (D-14 updated) | unit + snapshot | `node --test test/index-sets.test.js -t 'cycle_deflector dry-run'` | ❌ W0 | ⬜ pending |
| INDEX-08 | `await_system_job` exp-backoff polls until complete (D-06) | unit | `node --test test/system-job.test.js -t 'await_system_job success path'` | ❌ W0 | ⬜ pending |
| INDEX-08 | `await_system_job` exits at timeout | unit | `node --test test/system-job.test.js -t 'await_system_job timeout path'` | ❌ W0 | ⬜ pending |
| INDEX-08 | `await_system_job` dry-run returns plan without polling (D-07) | unit + snapshot | `node --test test/system-job.test.js -t 'await_system_job dry-run'` | ❌ W0 | ⬜ pending |
| D-16 | Writable-flag gate fires BEFORE confirmation gate | unit | `node --test test/index-sets.test.js -t 'writable gate before confirm gate'` | ❌ W0 | ⬜ pending |
| D-17 | `create_index_set` dry-run uses `__SERVER_ASSIGNED__` for id | unit + snapshot | (covered by `create_index_set time-based+delete dry-run`) | ❌ W0 | ⬜ pending |
| schema-parity | Every new Phase 2 tool's zod shape matches its `src/tools.js` JSON-Schema (8 tools) | unit | `node --test test/schema-parity.test.js` | ⚠️ exists, must extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/index-sets.test.js` — covers INDEX-01..07 + D-04/D-13/D-16/D-17 + pitfalls ND1/ND2/ND3/U1
- [ ] `test/system-job.test.js` — covers INDEX-08 + D-06/D-07 (success path, timeout path, dry-run plan)
- [ ] `test/__snapshots__/index-sets.test.js.snapshot` — 8 fixtures
- [ ] `test/__snapshots__/system-job.test.js.snapshot` — 1 fixture (await_system_job dry-run plan)
- [ ] `test/schema-parity.test.js` — 8 new `assertSchemaParityForTool` calls (list/get/create/update/delete/set_default/cycle/await)
- [ ] `test/auth-redaction.test.js` — 1–2 line allowlist extension to recognize `confirmationToken` context (mirrors existing idempotencyKey context-aware allowlist)
- [ ] `src/tools/_shared/conflict.js` — additive amendment: `?? response?.index_sets` added to envelope fallback chain (1 line)
- [ ] `src/tools/_shared/handler.js` — additive amendment: `_confirmationToken` forwarding in dry-run preview + optional `requireConfirm` apply-time gate (~10 lines)
- [ ] Live-instance smoke (Plan 1 first task): verify U1 (`PUT /system/indices/index_sets/{id}` partial-body acceptance) and the `POST /system/deflector/{id}/cycle` response shape against `<graylog-host>`. If the live instance is unreachable, fall back to "merge-from-current" for update_index_set and trust the source for cycle.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end `delete_index_set` with `deleteIndices: true` against live Graylog | INDEX-05 | Confirmation-token mechanic against live state requires real index list + stats. Unit tests prove the hash construction; only a live run proves the round-trip with Graylog produces a final 204 + the cleanup job appears in `/system/jobs`. | After unit fixtures land, run against `<graylog-host>`: create test index set, ingest a few messages, run `delete_index_set` with `deleteIndices: true`, verify cleanup job ID appears in `/system/jobs`, then `await_system_job` to completion. |
| `cycle_deflector` side-effect observability | INDEX-07 | Range-rebuild job appears asynchronously; the rotation itself is sync but its observable consequence is a `/system/jobs` entry the agent can poll. Verifying the timing window is best done against a real cluster. | After cycle_deflector apply, immediately poll `/system/jobs` and confirm an `IndexRangesUpdateJob` (or equivalent) for the closed index appears with matching `info`. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags in any test command
- [ ] Feedback latency < 12 s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (planner attaches task IDs; final plan flips `wave_0_complete: true` and `nyquist_compliant: true`)
