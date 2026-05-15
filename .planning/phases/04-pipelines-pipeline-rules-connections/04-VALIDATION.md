---
phase: 04
slug: pipelines-pipeline-rules-connections
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-15
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node 22+ builtin) |
| **Config file** | `test/snapshot-config.js` |
| **Quick run command** | `node --test test/pipelines.test.js test/pipeline-dsl.test.js test/schema-parity.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~6 s quick, ~12 s full (459 existing + ~150 new ≈ ~610 tests) |

---

## Sampling Rate

- **After every task commit:** `node --test test/pipelines.test.js test/pipeline-dsl.test.js test/schema-parity.test.js`
- **After every plan wave:** `npm test`
- **Before `/gsd-verify-work`:** Full suite green AND two consecutive runs produce byte-identical `.snapshot` md5sums
- **Max feedback latency:** 12 s

---

## Per-Task Verification Map

> Task IDs allocated by planner; this table maps each Phase 4 requirement + D-XX decision to its automated check.

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| PIPE-01 | `list_pipelines` narrow projection + envelope handling | unit | `node --test test/pipelines.test.js -t 'list_pipelines'` | ❌ W0 | ⬜ |
| PIPE-02 | `get_pipeline` full DTO | unit | `node --test test/pipelines.test.js -t 'get_pipeline'` | ❌ W0 | ⬜ |
| PIPE-03 | `create_pipeline` with `POST /system/pipelines/parse` pre-flight; refuses on ParseException (D-06) | unit + snapshot | `node --test test/pipelines.test.js -t 'create_pipeline'` | ❌ W0 | ⬜ |
| PIPE-04 | `update_pipeline` partial update + parse pre-flight (per Plan 01 U1 outcome) | unit + snapshot | `node --test test/pipelines.test.js -t 'update_pipeline'` | ❌ W0 | ⬜ |
| PIPE-05 | `delete_pipeline` sync envelope (Pitfall S11-equivalent — no async wrap) | unit + snapshot | `node --test test/pipelines.test.js -t 'delete_pipeline'` | ❌ W0 | ⬜ |
| PIPE-06 | `list_pipeline_rules` narrow projection | unit | `node --test test/pipelines.test.js -t 'list_pipeline_rules'` | ❌ W0 | ⬜ |
| PIPE-07 | `get_pipeline_rule` full DTO | unit | `node --test test/pipelines.test.js -t 'get_pipeline_rule'` | ❌ W0 | ⬜ |
| PIPE-08 | `create_pipeline_rule` accepts EITHER structured intent OR raw DSL (mutual exclusion); parse pre-flight; refuses on ParseException (D-05/D-10) — C4 acceptance gate | unit + snapshot | `node --test test/pipelines.test.js -t 'create_pipeline_rule'` | ❌ W0 | ⬜ |
| PIPE-09 | `update_pipeline_rule` partial update + parse pre-flight (per Plan 01 U1 outcome + D-16) | unit + snapshot | `node --test test/pipelines.test.js -t 'update_pipeline_rule'` | ❌ W0 | ⬜ |
| PIPE-10 | `delete_pipeline_rule` cascade pre-flight + keyed-buckets hash + apply-time drift refusal (D-14) | unit + snapshot | `node --test test/pipelines.test.js -t 'delete_pipeline_rule'` | ❌ W0 | ⬜ |
| PIPE-11 | `list_pipeline_functions` static + live overlay; live wins on collision (D-02/D-03) — ROADMAP SC3 | unit + snapshot | `node --test test/pipelines.test.js -t 'list_pipeline_functions'` | ❌ W0 | ⬜ |
| PIPE-12 | `simulate_pipeline_rule` POSTs JSON-STRING message body (Pitfall 1); returns post-rule message — M3 acceptance gate | unit + snapshot | `node --test test/pipelines.test.js -t 'simulate_pipeline_rule'` | ❌ W0 | ⬜ |
| PIPE-13 | `connect_pipelines_to_stream` GET-merge-PUT semantics; never silently disconnects (Pitfall 2) | unit + snapshot | `node --test test/pipelines.test.js -t 'connect_pipelines_to_stream'` | ❌ W0 | ⬜ |
| PIPE-14 | `disconnect_pipelines_from_stream` GET-subtract-PUT semantics | unit + snapshot | `node --test test/pipelines.test.js -t 'disconnect_pipelines_from_stream'` | ❌ W0 | ⬜ |
| D-02 (builtins.js) | Hand-curated 130-row catalogue exports correct shape; smoke-test pins names against accidental mutation | unit | `node --test test/pipeline-dsl.test.js -t 'builtins'` | ❌ W0 | ⬜ |
| D-03 (function-catalogue cache) | Per-connection process-lifetime cache; live overlay; `_clearForTests` seam | unit | `node --test test/pipeline-dsl.test.js -t 'function-catalogue'` | ❌ W0 | ⬜ |
| D-04 (validate.js) | Client-side validator over MERGED catalogue (live wins; live-only names accepted — Pitfall 5) | unit | `node --test test/pipeline-dsl.test.js -t 'validate'` | ❌ W0 | ⬜ |
| D-12/D-13 (escape.js) | Pure escape helper covers `"` → `\"`, `\` → `\\`, control chars; matches RuleLang.g4 spec | unit | `node --test test/pipeline-dsl.test.js -t 'escape'` | ❌ W0 | ⬜ |
| D-11 (structured intent → DSL) | All 7 Condition variants + 6 Action variants emit valid DSL; round-trip through parse pre-flight | unit + snapshot | `node --test test/pipeline-dsl.test.js -t 'emit'` | ❌ W0 | ⬜ |
| schema-parity | All 14 Phase 4 tools added to schema-parity suite | unit | `node --test test/schema-parity.test.js` | ⚠️ extend | ⬜ |
| Snapshot determinism | ~14 new Phase 4 fixtures byte-identical across two `npm test` runs | bash | `md5sum test/__snapshots__/*.snapshot × 2; diff empty` | manual | ⬜ |
| Auth-redaction | No apiToken-shaped strings in any new Phase 4 snapshot | unit | `node --test test/auth-redaction.test.js` | ✅ auto-scans | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/pipelines.test.js` — handler tests for PIPE-01..14 + cascade + parse + simulate acceptance gates
- [ ] `test/pipeline-dsl.test.js` — DSL helper tests (escape, emit, validate, function-catalogue, builtins)
- [ ] `test/__snapshots__/pipelines.test.js.snapshot` — 14 fixtures per RESEARCH §Snapshot Fixture Design
- [ ] `src/pipeline-dsl/builtins.js` — hand-curated 130 entries from RESEARCH §Built-in Function Catalogue
- [ ] `src/pipeline-dsl/escape.js` — pure escape helper
- [ ] `src/pipeline-dsl/emit.js` — structured-intent → DSL emitter
- [ ] `src/pipeline-dsl/validate.js` — client-side validator over merged catalogue
- [ ] `src/pipeline-dsl/function-catalogue.js` — per-connection cache + live overlay
- [ ] `src/tools/pipelines/` — 14 handler files + `schemas.js` + `index.js`
- [ ] `test/schema-parity.test.js` — 14 new `assertSchemaParityForTool` calls
- [ ] `src/tools/_shared/conflict.js` — verify `pipelines` envelope unwrap (likely needed per RESEARCH)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end `create_pipeline_rule` round-trip against live Graylog | PIPE-08 + D-05 | Live ParseException response shape is the authoritative test; unit tests mock the response. | After unit fixtures land, send a rule with `toUpperCase` typo to `<graylog-host>`'s `/system/pipelines/rule/parse`; verify the error envelope shape matches the wrapper's parser. |
| `simulate_pipeline_rule` end-to-end | PIPE-12 + D-08 | The JSON-string message encoding (Pitfall 1) must be confirmed against live Graylog — unit tests pin the wrapper's stringify but only a live run proves the deserialize works. | Compose a rule that sets a field; submit with a sample message; verify the response's post-rule message has the field set. |
| `connect_pipelines_to_stream` non-replace semantics | PIPE-13 + Pitfall 2 | The wrapper's GET-merge-PUT prevents silent disconnection. Only a live run with multiple pre-existing pipelines proves the semantics. | Pre-create stream with pipelines A+B; call `connect_pipelines_to_stream(streamId, [C])`; verify A+B are still connected. |
| U1-style live smoke for partial-update | D-16 (PIPE-04, PIPE-09) | Plan 01 Task 1 attempts a partial PUT against `<graylog-host>`. If unreachable, defaults to STRICT_NO_ECHO. | Plan 01 produces `04-U1-SMOKE.md`; subsequent plans branch on its content. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags in any test command
- [ ] Feedback latency < 12 s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (planner attaches task IDs; final plan flips `wave_0_complete: true` and `nyquist_compliant: true`)
