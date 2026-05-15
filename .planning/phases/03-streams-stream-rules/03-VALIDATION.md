---
phase: 03
slug: streams-stream-rules
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-15
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node 22+ builtin) |
| **Config file** | `test/snapshot-config.js` |
| **Quick run command** | `node --test test/streams.test.js test/cascade-hash.test.js test/schema-parity.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 s quick, ~12 s full (335 existing + ~35 new ≈ ~370 tests) |

---

## Sampling Rate

- **After every task commit:** `node --test test/streams.test.js test/cascade-hash.test.js test/schema-parity.test.js`
- **After every plan wave:** `npm test`
- **Before `/gsd-verify-work`:** Full suite green AND two consecutive runs produce byte-identical `.snapshot` md5sums
- **Max feedback latency:** 12 s

---

## Per-Task Verification Map

> Task IDs allocated by planner; this table maps each Phase 3 requirement + D-XX decision to its automated check.

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| STREAM-01 | `list_streams` narrow projection (incl. `mutable: boolean` projection from wire `is_editable`) | unit | `node --test test/streams.test.js -t 'list_streams'` | ❌ W0 | ⬜ pending |
| STREAM-02 | `get_stream` returns full DTO with embedded rules | unit | `node --test test/streams.test.js -t 'get_stream'` | ❌ W0 | ⬜ pending |
| STREAM-03 | `create_stream` emits CreateEntityRequest envelope `{entity, share_request}`; existingMatches populated across 3 buckets (D-05/D-06) | unit + snapshot | `node --test test/streams.test.js -t 'create_stream'` | ❌ W0 | ⬜ pending |
| STREAM-04 | `update_stream` STRICT_NO_ECHO (or MERGE_FROM_CURRENT per Plan 01 U1 outcome) wire body contains only changed fields | unit + snapshot | `node --test test/streams.test.js -t 'update_stream'` | ❌ W0 | ⬜ pending |
| STREAM-05 | `delete_stream` cascade pre-flight (3 endpoints) + hash + apply-time refusal on drift (D-01..D-04) — C2 acceptance gate | unit + snapshot | `node --test test/streams.test.js -t 'delete_stream'` | ❌ W0 | ⬜ pending |
| STREAM-06 | `start_stream` POST `/streams/{id}/resume`; `pause_stream` POST `/streams/{id}/pause` (D-12) | unit | `node --test test/streams.test.js -t 'lifecycle'` | ❌ W0 | ⬜ pending |
| STREAM-07 | `list_stream_rules` narrow projection per rule | unit | `node --test test/streams.test.js -t 'list_stream_rules'` | ❌ W0 | ⬜ pending |
| STREAM-08 | `create_stream_rule` translates string discriminator to numeric wire type; all 8 variants accepted (D-11 reconfirmed including `match_input`) | unit | `node --test test/streams.test.js -t 'create_stream_rule'` | ❌ W0 | ⬜ pending |
| STREAM-09 | `update_stream_rule` partial update per Plan 01 U1 outcome | unit | `node --test test/streams.test.js -t 'update_stream_rule'` | ❌ W0 | ⬜ pending |
| STREAM-10 | `delete_stream_rule` leaf-delete; no cascade; parent-stream mutable pre-flight (D-09) | unit | `node --test test/streams.test.js -t 'delete_stream_rule'` | ❌ W0 | ⬜ pending |
| STREAM-11 | `test_stream_match` POSTs `{ message: {...} }` to `/streams/{id}/testMatch`; returns per-rule outcomes (D-07/D-08); requires streamId | unit + snapshot | `node --test test/streams.test.js -t 'test_stream_match'` | ❌ W0 | ⬜ pending |
| D-02 (cascade hash) | `computeCascadeHash` produces frozen-fixture hash for known input; bucket-keyed canonicalization | unit | `node --test test/cascade-hash.test.js` | ❌ W0 | ⬜ pending |
| D-03 (apply refusal) | Apply re-fetches all 3 cascade endpoints + re-computes hash + refuses with `reason:"cascade_changed_since_preview"` on drift | unit | `node --test test/streams.test.js -t 'cascade_changed_since_preview'` | ❌ W0 | ⬜ pending |
| D-04 (preflight failure) | Any of the 3 cascade endpoints failing → `cascade_preflight_failed` hard-block; no token issued | unit | `node --test test/streams.test.js -t 'cascade_preflight_failed'` | ❌ W0 | ⬜ pending |
| D-09 (mutable defense) | Every mutating stream tool refuses `current.is_editable: false` (surfaced as `mutable: false`) BEFORE the destructive verb | unit | `node --test test/streams.test.js -t 'stream_immutable'` | ❌ W0 | ⬜ pending |
| D-10 (index_set_id required) | `create_stream` zod rejects missing `index_set_id` | unit | `node --test test/streams.test.js -t 'create_stream index_set_id required'` | ❌ W0 | ⬜ pending |
| D-11 (8 rule variants) | All 8 StreamRuleType variants accepted at zod parse; numeric wire translation verified | unit | `node --test test/streams.test.js -t 'rule type'` | ❌ W0 | ⬜ pending |
| schema-parity | All 12 new Phase 3 tools added to schema-parity suite | unit | `node --test test/schema-parity.test.js` | ⚠️ exists, must extend | ⬜ pending |
| Snapshot determinism | 11 new Phase 3 fixtures byte-identical across two `npm test` runs | bash | `md5sum test/__snapshots__/*.snapshot` × 2; diff empty | manual | ⬜ pending |
| Auth-redaction | No apiToken-shaped strings in any new Phase 3 snapshot | unit | `node --test test/auth-redaction.test.js` | ✅ exists; auto-scans | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/streams.test.js` — covers STREAM-01..11 + D-09 mutable + D-10 index_set_id + D-11 8 rule variants + D-02/D-03/D-04 cascade behavior
- [ ] `test/cascade-hash.test.js` — covers `computeCascadeHash` pure helper (frozen-fixture hashes; sort-order independence; bucket-keyed canonicalization)
- [ ] `src/tools/_shared/cascade-hash.js` — new helper (promoted from `src/tools/index-sets/c1-hash.js` so Phase 4 pipelines can reuse)
- [ ] `src/tools/streams/` — new directory + 12 handler files + `schemas.js` + `index.js`
- [ ] `test/__snapshots__/streams.test.js.snapshot` — 11 fixtures
- [ ] `src/tools/_register.js` updated — import `./streams/index.js`; remove the v2.3 `list_streams` registration line (pitfall S5)
- [ ] `test/schema-parity.test.js` — 12 new `assertSchemaParityForTool` calls
- [ ] `test/regression/__snapshots__/read-tools.test.js.snapshot` — re-recorded for the `list_streams` projection change

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end `delete_stream` cascade refusal against live Graylog | STREAM-05 + D-03 | Apply-time refusal requires real Graylog stream + dependents + a deliberate drift between dry-run and apply (e.g., another operator adds a stream rule while the agent is paused at the dry-run). Unit tests prove hash construction; only a live race proves the refusal fires in production semantics. | After unit fixtures land, create a test stream + rule on `<graylog-host>`, run delete_stream with `dryRun:true`, add another rule via the Graylog UI, then attempt apply with the original token — expect `cascade_changed_since_preview`. |
| `test_stream_match` against a real Graylog stream | STREAM-11 | The wrapper passes through to Graylog's `/streams/{id}/testMatch`; only a live run confirms the response shape matches the wrapper's parsing. | Create a test stream with rules covering all 8 variants; run test_stream_match with a sample message that hits a subset; verify per-rule outcomes. |
| U1-style live smoke (Plan 01) for STRICT_NO_ECHO vs MERGE_FROM_CURRENT | D-14 | Plan 01 Task 1 attempts a partial PUT against `<graylog-host>`. If the live instance is unreachable (no API token), Plan 01 records `UNREACHABLE_STRICT_NO_ECHO` and proceeds with STRICT_NO_ECHO (researcher's recommendation). | Plan 01 produces `03-U1-SMOKE.md`; Plan 02 + Plan 04 branch on its content. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags in any test command
- [ ] Feedback latency < 12 s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (planner attaches task IDs; final plan flips `wave_0_complete: true` and `nyquist_compliant: true`)
