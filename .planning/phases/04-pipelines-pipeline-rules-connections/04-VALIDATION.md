---
phase: 04
slug: pipelines-pipeline-rules-connections
status: complete
nyquist_compliant: true
wave_0_complete: true
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
| PIPE-01 | `list_pipelines` narrow projection + envelope handling | unit | `node --test test/pipelines.test.js -t 'list_pipelines'` | ✅ | ✅ |
| PIPE-02 | `get_pipeline` full DTO | unit | `node --test test/pipelines.test.js -t 'get_pipeline'` | ✅ | ✅ |
| PIPE-03 | `create_pipeline` with `POST /system/pipelines/parse` pre-flight; refuses on ParseException (D-06) | unit + snapshot | `node --test test/pipelines.test.js -t 'create_pipeline'` | ✅ | ✅ |
| PIPE-04 | `update_pipeline` partial update + parse pre-flight (per Plan 01 U1 outcome) | unit + snapshot | `node --test test/pipelines.test.js -t 'update_pipeline'` | ✅ | ✅ |
| PIPE-05 | `delete_pipeline` sync envelope (Pitfall S11-equivalent — no async wrap) | unit + snapshot | `node --test test/pipelines.test.js -t 'delete_pipeline'` | ✅ | ✅ |
| PIPE-06 | `list_pipeline_rules` narrow projection | unit | `node --test test/pipelines.test.js -t 'list_pipeline_rules'` | ✅ | ✅ |
| PIPE-07 | `get_pipeline_rule` full DTO | unit | `node --test test/pipelines.test.js -t 'get_pipeline_rule'` | ✅ | ✅ |
| PIPE-08 | `create_pipeline_rule` accepts EITHER structured intent OR raw DSL (mutual exclusion); parse pre-flight; refuses on ParseException (D-05/D-10) — C4 acceptance gate | unit + snapshot | `node --test test/pipelines.test.js -t 'create_pipeline_rule'` | ✅ | ✅ |
| PIPE-09 | `update_pipeline_rule` partial update + parse pre-flight (per Plan 01 U1 outcome + D-16) | unit + snapshot | `node --test test/pipelines.test.js -t 'update_pipeline_rule'` | ✅ | ✅ |
| PIPE-10 | `delete_pipeline_rule` cascade pre-flight + keyed-buckets hash + apply-time drift refusal (D-14) | unit + snapshot | `node --test test/pipelines.test.js -t 'delete_pipeline_rule'` | ✅ | ✅ |
| PIPE-11 | `list_pipeline_functions` static + live overlay; live wins on collision (D-02/D-03) — ROADMAP SC3 | unit + snapshot | `node --test test/pipelines.test.js -t 'list_pipeline_functions'` | ✅ | ✅ |
| PIPE-12 | `simulate_pipeline_rule` POSTs JSON-STRING message body (Pitfall 1); returns post-rule message — M3 acceptance gate | unit + snapshot | `node --test test/pipelines.test.js -t 'simulate_pipeline_rule'` | ✅ | ✅ |
| PIPE-13 | `connect_pipelines_to_stream` GET-merge-PUT semantics; never silently disconnects (Pitfall 2) | unit + snapshot | `node --test test/pipelines.test.js -t 'connect_pipelines_to_stream'` | ✅ | ✅ |
| PIPE-14 | `disconnect_pipelines_from_stream` GET-subtract-PUT semantics | unit + snapshot | `node --test test/pipelines.test.js -t 'disconnect_pipelines_from_stream'` | ✅ | ✅ |
| D-02 (builtins.js) | Hand-curated 130-row catalogue exports correct shape; smoke-test pins names against accidental mutation | unit | `node --test test/pipeline-dsl.test.js -t 'builtins'` | ✅ | ✅ |
| D-03 (function-catalogue cache) | Per-connection process-lifetime cache; live overlay; `_clearForTests` seam | unit | `node --test test/pipeline-dsl.test.js -t 'function-catalogue'` | ✅ | ✅ |
| D-04 (validate.js) | Client-side validator over MERGED catalogue (live wins; live-only names accepted — Pitfall 5) | unit | `node --test test/pipeline-dsl.test.js -t 'validate'` | ✅ | ✅ |
| D-12/D-13 (escape.js) | Pure escape helper covers `"` → `\"`, `\` → `\\`, control chars; matches RuleLang.g4 spec | unit | `node --test test/pipeline-dsl.test.js -t 'escape'` | ✅ | ✅ |
| D-11 (structured intent → DSL) | All 7 Condition variants + 6 Action variants emit valid DSL; round-trip through parse pre-flight | unit + snapshot | `node --test test/pipeline-dsl.test.js -t 'emit'` | ✅ | ✅ |
| schema-parity | All 14 Phase 4 tools added to schema-parity suite | unit | `node --test test/schema-parity.test.js` | ✅ | ✅ |
| Snapshot determinism | 14 new Phase 4 fixtures byte-identical across two `npm test` runs | bash | `md5sum test/snapshots/__snapshots__/pipelines.test.js.snapshot × 2; diff empty` | ✅ | ✅ |
| Auth-redaction | No apiToken-shaped strings in any new Phase 4 snapshot | unit | `node --test test/auth-redaction.test.js` | ✅ | ✅ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `test/pipelines.test.js` — handler tests for PIPE-01..14 + cascade + parse + simulate acceptance gates
- [x] `test/pipeline-dsl.test.js` — DSL helper tests (escape, emit, validate, function-catalogue, builtins)
- [x] `test/snapshots/__snapshots__/pipelines.test.js.snapshot` — 14 fixtures per RESEARCH §Snapshot Fixture Design (file landed under test/snapshots/__snapshots__/ per the snapshot-config resolver — auth-redaction.test.js extended to scan the additional directory)
- [x] `src/pipeline-dsl/builtins.js` — hand-curated 133 entries from RESEARCH §Built-in Function Catalogue
- [x] `src/pipeline-dsl/escape.js` — pure escape helper
- [x] `src/pipeline-dsl/emit.js` — structured-intent → DSL emitter
- [x] `src/pipeline-dsl/validate.js` — client-side validator over merged catalogue
- [x] `src/pipeline-dsl/function-catalogue.js` — per-connection cache + live overlay
- [x] `src/tools/pipelines/` — 14 handler files + `schemas.js` + `index.js`
- [x] `test/schema-parity.test.js` — 14 new `assertSchemaParityForTool` calls
- [x] `src/tools/_shared/conflict.js` — verify `pipelines` envelope unwrap (already shipped — pipelines return BARE ARRAY per Pitfall A3; Array.isArray fast path handles)

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

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags in any test command
- [x] Feedback latency < 12 s (full suite ~7.6s on dev box; well under budget)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** complete — Plan 04-06 flipped `wave_0_complete: true` and `nyquist_compliant: true` after landing 14 snapshot fixtures + 14 schema-parity assertions + auth-redaction zero-violation confirmation + two-run byte-identical md5sum determinism proof.
