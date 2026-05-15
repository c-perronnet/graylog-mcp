---
phase: 01
slug: inputs-extractors
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-15
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node 22+ builtin); `@types/node` ^22 for IDE support |
| **Config file** | `test/snapshot-config.js` (snapshot resolution path; established Phase 0) |
| **Quick run command** | `node --test 'test/inputs.test.js' 'test/extractors.test.js' 'test/type-catalogue.test.js' 'test/schema-parity.test.js'` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 s quick, ~15 s full (153 existing + ~80 new = ~233 tests) |

---

## Sampling Rate

- **After every task commit:** `node --test test/inputs.test.js test/extractors.test.js test/type-catalogue.test.js test/schema-parity.test.js`
- **After every plan wave:** `npm test` (full suite)
- **Before `/gsd-verify-work`:** Full suite green AND two consecutive `npm test` runs produce byte-identical snapshot md5sums for every `.snapshot` file (including new Phase 1 ones)
- **Max feedback latency:** 15 s

---

## Per-Task Verification Map

> Task IDs are not yet allocated; this table maps each Phase 1 requirement to its automated check and pin file. The planner will attach concrete task IDs once plans are generated.

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| INPUT-01 | `list_input_types` parses catalogue, surfaces `is_encrypted` per field | unit (capture-request seam) | `node --test test/inputs.test.js -- --test-name-pattern='list_input_types'` | ❌ W0 | ⬜ pending |
| INPUT-01 | Type catalogue cached per connection — second call doesn't re-fetch | unit | `node --test test/type-catalogue.test.js` | ❌ W0 | ⬜ pending |
| INPUT-02 | `list_inputs` narrow projection; `fields:"all"` returns full DTO | unit + snapshot | `node --test test/inputs.test.js` | ❌ W0 | ⬜ pending |
| INPUT-03 | `get_input` returns full DTO; server-masked encrypted fields surface | unit | `node --test test/inputs.test.js -- --test-name-pattern='get_input'` | ❌ W0 | ⬜ pending |
| INPUT-04 | `create_input` GELF UDP dry-run preview shape (fixture 1) | unit + snapshot | `node --test test/inputs.test.js` | ❌ W0 | ⬜ pending |
| INPUT-04 | `create_input` GELF TCP encrypted-field redaction in preview (fixture 2) | unit + snapshot + auth-redaction | `node --test test/inputs.test.js test/auth-redaction.test.js` | ❌ W0 | ⬜ pending |
| INPUT-04 | `create_input` zod rejects missing required fields | unit | `node --test test/inputs.test.js -- --test-name-pattern='zod'` | ❌ W0 | ⬜ pending |
| INPUT-05 | `update_input` partial-update preview emits ONLY changed fields; encrypted fields ABSENT (fixture 3 — C3 acceptance gate) | unit + snapshot | `node --test test/inputs.test.js` | ❌ W0 | ⬜ pending |
| INPUT-05 | `update_input` explicit encrypted-field re-pass emits `{set_value}` envelope on wire | unit (capture-request) | `node --test test/inputs.test.js -- --test-name-pattern='update_input encrypted explicit'` | ❌ W0 | ⬜ pending |
| INPUT-06 | `delete_input` dry-run enumerates affected extractors in `cascades.extractors` (fixture 4) | unit + snapshot | `node --test test/inputs.test.js` | ❌ W0 | ⬜ pending |
| INPUT-07 | `start_input` issues `PUT /api/system/inputstates/{id}`; `stop_input` issues `DELETE`; both honor `dryRun:true` default | unit (capture-request) | `node --test test/inputs.test.js -- --test-name-pattern='lifecycle'` | ❌ W0 | ⬜ pending |
| INPUT-08 | `list_extractors` per-input narrow projection | unit + snapshot | `node --test test/extractors.test.js` | ❌ W0 | ⬜ pending |
| INPUT-09 | `create_extractor` for each named extractor type parses + emits correct `extractor_config` shape | unit (one per type) | `node --test test/extractors.test.js -- --test-name-pattern='create_extractor'` | ❌ W0 | ⬜ pending |
| INPUT-09 | `create_extractor` grok dry-run snapshot (fixture 5) | snapshot | `node --test test/extractors.test.js` | ❌ W0 | ⬜ pending |
| INPUT-10 | `update_extractor` partial-update reuses pattern | unit | `node --test test/extractors.test.js -- --test-name-pattern='update_extractor'` | ❌ W0 | ⬜ pending |
| INPUT-11 | `delete_extractor` single-target; no cascade; second call 404s | unit | `node --test test/extractors.test.js -- --test-name-pattern='delete_extractor'` | ❌ W0 | ⬜ pending |
| Phase 0 D-07 | Writable-flag short-circuit for every new mutating tool | unit (one per tool) | `node --test test/inputs.test.js -- --test-name-pattern='writable'` | ❌ W0 | ⬜ pending |
| schema-parity | Every new tool's zod shape matches its `src/tools.js` JSON-Schema | unit | `node --test test/schema-parity.test.js` | ⚠️ exists, must extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/inputs.test.js` — covers INPUT-01..07 (handlers, snapshots, zod rejections, writable-flag, C3 mitigation)
- [ ] `test/extractors.test.js` — covers INPUT-08..11 (handlers, snapshots, every named extractor type)
- [ ] `test/type-catalogue.test.js` — covers D-06 cache contract (`_clearTypeCatalogueForTests` seam, single-fetch-then-cached, `getEncryptedFieldNamesForType` helper)
- [ ] `test/__snapshots__/inputs.test.js.snapshot` and `extractors.test.js.snapshot` — generated via `--test-update-snapshots` once handlers exist
- [ ] `test/schema-parity.test.js` — extend with `assertSchemaParityForTool` calls for all 12 new tools (uncomment template at lines 28–44)
- [ ] `test/fixtures/type-catalogue-7.0.6.json` — live-instance capture from `<graylog-host>`, committed as test fixture (one-shot Wave 0 task; not committed if the live instance is unreachable, in which case a hand-written fixture per Java source is the fallback)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 7.0.6 vs 7.2 endpoint shape divergence | INPUT-01..11 | Live API behavior cannot be unit-tested without a real Graylog instance; the capture-request seam validates wire format but not server response semantics. | Run the Wave 0 smoke script against `<graylog-host>`: create + start + stop + delete a GELF UDP input; verify response shapes match `src/graylog/normalize.js` expectations. |
| End-to-end `update_input` against a TLS input on live Graylog | INPUT-05 | The C3 mitigation's full proof requires creating a TLS-bearing input, updating a non-encrypted field, and confirming the input still starts (encrypted cert password preserved server-side). Unit tests prove the wire payload; only a live run proves the server-side merge actually happened. | After Wave 0 fixtures land, run `update_input` against a live TLS Beats input on `<graylog-host>`; restart and confirm input still binds. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags in any test command
- [ ] Feedback latency < 15 s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (planner attaches task IDs; final plan 5 flips `wave_0_complete: true` and `nyquist_compliant: true`)
