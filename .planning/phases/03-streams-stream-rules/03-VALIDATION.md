---
phase: 03
slug: streams-stream-rules
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-15
completed: 2026-05-15
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
| **Estimated runtime** | ~5 s quick, ~4 s full (459 tests across 18 suites — measured 2026-05-15) |

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
| STREAM-01 | `list_streams` narrow projection (incl. `mutable: boolean` projection from wire `is_editable`) | unit | `node --test test/streams.test.js -t 'list_streams'` | ✅ | ✅ |
| STREAM-02 | `get_stream` returns full DTO with embedded rules | unit | `node --test test/streams.test.js -t 'get_stream'` | ✅ | ✅ |
| STREAM-03 | `create_stream` emits CreateEntityRequest envelope `{entity, share_request}`; existingMatches populated across 3 buckets (D-05/D-06) | unit + snapshot | `node --test test/streams.test.js -t 'create_stream'` | ✅ | ✅ |
| STREAM-04 | `update_stream` STRICT_NO_ECHO (per Plan 01 U1 outcome UNREACHABLE_STRICT_NO_ECHO) wire body contains only changed fields | unit + snapshot | `node --test test/streams.test.js -t 'update_stream'` | ✅ | ✅ |
| STREAM-05 | `delete_stream` cascade pre-flight (3 endpoints) + hash + apply-time refusal on drift (D-01..D-04) — C2 acceptance gate | unit + snapshot | `node --test test/streams.test.js -t 'delete_stream'` | ✅ | ✅ |
| STREAM-06 | `start_stream` POST `/streams/{id}/resume`; `pause_stream` POST `/streams/{id}/pause` (D-12) | unit | `node --test test/streams.test.js -t 'lifecycle'` | ✅ | ✅ |
| STREAM-07 | `list_stream_rules` narrow projection per rule | unit + snapshot | `node --test test/streams.test.js -t 'list_stream_rules'` | ✅ | ✅ |
| STREAM-08 | `create_stream_rule` translates string discriminator to numeric wire type; all 8 variants accepted (D-11 reconfirmed including `match_input`) | unit | `node --test test/streams.test.js -t 'create_stream_rule'` | ✅ | ✅ |
| STREAM-09 | `update_stream_rule` partial update per Plan 01 U1 outcome (STRICT_NO_ECHO + Pitfall S8 type-echo) | unit | `node --test test/streams.test.js -t 'update_stream_rule'` | ✅ | ✅ |
| STREAM-10 | `delete_stream_rule` leaf-delete; no cascade; parent-stream mutable pre-flight (D-09) | unit | `node --test test/streams.test.js -t 'delete_stream_rule'` | ✅ | ✅ |
| STREAM-11 | `test_stream_match` POSTs `{ message: {...} }` to `/streams/{id}/testMatch`; returns per-rule outcomes (D-07/D-08); requires streamId | unit + snapshot | `node --test test/streams.test.js -t 'test_stream_match'` | ✅ | ✅ |
| D-02 (cascade hash) | `computeCascadeHash` produces frozen-fixture hash for known input; bucket-keyed canonicalization | unit + snapshot | `node --test test/cascade-hash.test.js` | ✅ | ✅ |
| D-03 (apply refusal) | Apply re-fetches all 3 cascade endpoints + re-computes hash + refuses with `reason:"cascade_changed_since_preview"` on drift | unit | `node --test test/streams.test.js -t 'cascade_changed_since_preview'` | ✅ | ✅ |
| D-04 (preflight failure) | Any of the 3 cascade endpoints failing → `cascade_preflight_failed` hard-block; no token issued | unit | `node --test test/streams.test.js -t 'cascade_preflight_failed'` | ✅ | ✅ |
| D-09 (mutable defense) | Every mutating stream tool refuses `current.is_editable: false` (surfaced as `mutable: false`) BEFORE the destructive verb | unit + snapshot | `node --test test/streams.test.js -t 'stream_immutable'` | ✅ | ✅ |
| D-10 (index_set_id required) | `create_stream` zod rejects missing `index_set_id` | unit | `node --test test/streams.test.js -t 'create_stream index_set_id required'` | ✅ | ✅ |
| D-11 (8 rule variants) | All 8 StreamRuleType variants accepted at zod parse; numeric wire translation verified | unit | `node --test test/streams.test.js -t 'rule type'` | ✅ | ✅ |
| schema-parity | All 12 new Phase 3 tools added to schema-parity suite | unit | `node --test test/schema-parity.test.js` | ✅ | ✅ |
| Snapshot determinism | 12 new Phase 3 fixtures byte-identical across two `npm test` runs | bash | `md5sum test/__snapshots__/*.snapshot` × 2; diff empty | ✅ | ✅ |
| Auth-redaction | No apiToken-shaped strings in any new Phase 3 snapshot | unit | `node --test test/auth-redaction.test.js` | ✅ exists; auto-scans | ✅ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `test/streams.test.js` — covers STREAM-01..11 + D-09 mutable + D-10 index_set_id + D-11 8 rule variants + D-02/D-03/D-04 cascade behavior (104 tests as of Plan 05)
- [x] `test/cascade-hash.test.js` — covers `computeCascadeHash` pure helper (frozen-fixture hashes; sort-order independence; bucket-keyed canonicalization)
- [x] `src/tools/_shared/cascade-hash.js` — new helper (promoted from `src/tools/index-sets/c1-hash.js` so Phase 4 pipelines can reuse)
- [x] `src/tools/streams/` — new directory + 12 handler files + `schemas.js` + `index.js`
- [x] `test/__snapshots__/streams.test.js.snapshot` — 12 fixtures (11 required + 1 bonus per Discretion-05)
- [x] `src/tools/_register.js` updated — import `./streams/index.js`; removed the v2.3 `list_streams` registration line (pitfall S5)
- [x] `test/schema-parity.test.js` — 12 new `assertSchemaParityForTool` calls (one per Phase 3 tool; `create_stream_rule` uses outer-shape lookup for z.intersection)
- [x] `test/regression/__snapshots__/read-tools.test.js.snapshot` — re-recorded for the `list_streams` projection change

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end `delete_stream` cascade refusal against live Graylog | STREAM-05 + D-03 | Apply-time refusal requires real Graylog stream + dependents + a deliberate drift between dry-run and apply (e.g., another operator adds a stream rule while the agent is paused at the dry-run). Unit tests prove hash construction; only a live race proves the refusal fires in production semantics. | After unit fixtures land, create a test stream + rule on `<graylog-host>`, run delete_stream with `dryRun:true`, add another rule via the Graylog UI, then attempt apply with the original token — expect `cascade_changed_since_preview`. |
| `test_stream_match` against a real Graylog stream | STREAM-11 | The wrapper passes through to Graylog's `/streams/{id}/testMatch`; only a live run confirms the response shape matches the wrapper's parsing. | Create a test stream with rules covering all 8 variants; run test_stream_match with a sample message that hits a subset; verify per-rule outcomes. |
| `match_input` (8th rule variant) runtime usability | STREAM-08 + D-11 + A5 | The schema accepts `match_input` and STREAM_RULE_TYPE_TO_NUMERIC maps it to wire int 8 (byte-identical to `StreamRuleType.java`). Whether the live 7.0.6 server actually accepts `MATCH_INPUT` on `POST /api/streams/{id}/rules` is verified only by live smoke. The 8th variant can be demoted to 7 without back-compat break if rejected. | Plan 05 fixtures pin the wire shape; live smoke required to verify acceptance. |
| U1-style live smoke (Plan 01) for STRICT_NO_ECHO vs MERGE_FROM_CURRENT | D-14 | Plan 01 Task 1 attempts a partial PUT against `<graylog-host>`. Plan 01 recorded `UNREACHABLE_STRICT_NO_ECHO` and proceeded with STRICT_NO_ECHO (researcher's recommendation). | 03-U1-SMOKE.md is the artifact; Plan 02 + Plan 04 branched on its content. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (Plan 01 Task 2 + Plan 01 Task 3 produced them)
- [x] No watch-mode flags in any test command
- [x] Feedback latency < 12 s (full suite ~4 s measured 2026-05-15 — well below threshold)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** Plan 03-05 final wave validates the strategy — `wave_0_complete: true` and `nyquist_compliant: true` set above; the final human-verify checkpoint in Plan 03-05 Task 3 confirms Phase 3 completion sign-off.

---

## Phase 3 Final Tally

> Captured 2026-05-15 at Plan 03-05 close-out, immediately before the human-verify checkpoint.

### Test counts

| Suite | Tests | Status |
|-------|-------|--------|
| Full suite (`npm test`) | **459** | ✅ green |
| `test/streams.test.js` | 104 | ✅ green |
| `test/schema-parity.test.js` | 34 | ✅ green |
| `test/cascade-hash.test.js` | (included in suite count) | ✅ green |
| `test/auth-redaction.test.js` | 1 | ✅ green |
| Phase 3 net-new (across all 5 plans) | +124 (335 Phase 2 end → 459 Phase 3 end) | ✅ |

### Tool surface

| Metric | Count |
|--------|-------|
| Total registered tools (`assertAllToolsRegistered`) | 54 |
| Phase 3 net-new tools | 12 (`list_streams`, `get_stream`, `list_stream_rules`, `create_stream`, `update_stream`, `delete_stream`, `start_stream`, `pause_stream`, `create_stream_rule`, `update_stream_rule`, `delete_stream_rule`, `test_stream_match`) |
| v2.3 displaced | 1 (`list_streams` displaced by new Phase 3 handler) |
| Phase 3 reclaimed names | 0 (no v2.3 names freed for reuse beyond list_streams' in-place replacement) |

> Note on the +1 accounting drift: the planner's target arithmetic (43 Phase 2 end - 1 displaced + 1 reclaimed + 12 net-new = 55) inherited a +1 drift from Plan 03-01's frontmatter target. Actual landed count is **54** — confirmed by `assertAllToolsRegistered(toolDefinitions)` passing against `toolDefinitions.length === 54`. The delta (+12 net-new) is correct; the absolute target was off by one (documented in 03-01-SUMMARY.md and propagated through Plans 02-04).

### Requirements coverage

All 11 STREAM-XX requirements complete:

| ID | Tool(s) | Snapshot Fixture | Status |
|----|---------|-------------------|--------|
| STREAM-01 | `list_streams` | (read-tool regression snapshot covers projection) | ✅ |
| STREAM-02 | `get_stream` | (regression snapshot covers full DTO shape) | ✅ |
| STREAM-03 | `create_stream` | Fixtures 1, 2, 3, 4 (empty + 3 existingMatches buckets) | ✅ |
| STREAM-04 | `update_stream` | Fixture 11 (STRICT_NO_ECHO partial) | ✅ |
| STREAM-05 | `delete_stream` | Fixtures 5, 6, 7, 8 (populated, empty, mismatch, immutable) | ✅ |
| STREAM-06 | `start_stream` + `pause_stream` | (handler tests; lifecycle snapshot bundled with existing stream_immutable fixture) | ✅ |
| STREAM-07 | `list_stream_rules` | Fixture 12 (narrow projection) | ✅ |
| STREAM-08 | `create_stream_rule` | (handler tests pin 8-variant wire bodies; per-variant snapshots are Plan-research recommended but not required for Phase 3 close) | ✅ |
| STREAM-09 | `update_stream_rule` | (handler tests pin STRICT_NO_ECHO + Pitfall S8 type-echo) | ✅ |
| STREAM-10 | `delete_stream_rule` | (handler tests pin leaf-delete descriptor shape) | ✅ |
| STREAM-11 | `test_stream_match` | Fixtures 9, 10 (literal outer key + minimal field-map) | ✅ |

### ROADMAP success criteria

All 4 Phase 3 SCs provably met:

| SC | Behavior | Plan | Evidence |
|----|----------|------|----------|
| SC1 | `delete_stream` produces a cascade preview + a confirmation token; apply refuses on drift | 03-03 | Fixture 5 (populated cascades + frozen hash); Fixture 7 (confirmation_mismatch on apply) |
| SC2 | `list_streams` projects `mutable: boolean` from wire `is_editable` | 03-01 | `src/tools/streams/list-streams.js` projection logic + handler tests |
| SC3 | `test_stream_match` accepts a stream config + sample message; returns per-rule outcomes (server-side) | 03-04 | Fixtures 9, 10 (literal `{ message: ... }` wire body); Test 25 (response forwarded verbatim) |
| SC4 | `create_stream` flags existing-title matches across 3 similarity buckets | 03-02 | Fixtures 2, 3, 4 (exact + case_insensitive + prefix); Test 7-9 (per-bucket handler tests) |

### Decision outcomes (D-01..D-14 + Pitfalls)

| ID | Decision | Outcome | Plan |
|----|----------|---------|------|
| D-01 | Cascade hash drift detector for delete_stream | Shipped — `computeCascadeHash` + apply-time re-fetch | 03-03 |
| D-02 | Keyed-buckets canonicalization (stream_id + 3 sorted bucket lists) | Shipped — frozen hashes in Fixtures 5, 6 prove empty ≠ populated | 03-03 / 03-05 |
| D-03 | Apply-time refusal on cascade drift via re-fetch + recompute | Shipped — Test 11 + verified in handler tests | 03-03 |
| D-04 | `cascade_preflight_failed` hard-block if any of 3 endpoints throws | Shipped — Tests 6, 7, 8 (one per endpoint) | 03-03 |
| D-05 | existingMatches across all 3 similarity buckets on create_stream | Shipped — Fixtures 2, 3, 4 | 03-02 |
| D-06 | Strictest-bucket-wins existingMatches projection | Shipped — fixture 2 (exact wins over case_insensitive when both apply) | 03-02 |
| D-07 | test_stream_match as server-side wrapper (no JS rule re-implementation) | Shipped — `test-stream-match.js` defines `build()` only; no client-side rule evaluation | 03-04 |
| D-08 | `streamId` required at schema layer for test_stream_match | Shipped — `TestStreamMatchSchema.streamId.min(1)`; Test 24 | 03-04 |
| D-09 | Mutable defense-in-depth on all 7 mutating stream/rule tools | Shipped — 7 pre-flight callsites; Fixture 8 pins refusal envelope | 03-01..03-04 |
| D-10 | `create_stream` zod-rejects missing `index_set_id` | Shipped — Test 9 | 03-02 |
| D-11 | All 8 StreamRuleType variants accepted (including `match_input`) | Shipped — schema accepts; STREAM_RULE_TYPE_TO_NUMERIC has 8 entries; Tests 1-8 cover each variant. `match_input` runtime usability remains a manual-only verification (live smoke required) | 03-02 / 03-04 |
| D-12 | `start_stream` / `pause_stream` POST resume/pause paths | Shipped — handler tests + dispatch round-trip | 03-02 |
| D-13 | `__SERVER_ASSIGNED__` sentinel for postApplyEstimate.id on create_*` | Shipped — Fixture 1 captures the literal sentinel | 03-02 / 03-04 |
| D-14 | STRICT_NO_ECHO partial update wire bodies (U1 smoke decided) | Shipped — `UNREACHABLE_STRICT_NO_ECHO` → STRICT_NO_ECHO branch; Fixture 11 pins | 03-02 / 03-04 |
| Pitfall S5 | v2.3 `list_streams` displaced in `_register.js` | Shipped — old registration line removed; new handler claims the name | 03-01 |
| Pitfall S7 | `toIdBody({ idFields: ["stream_id", "id"] })` normalization | Shipped — every create_/_rule handler uses appropriate `idFields` | 03-02 / 03-04 |
| Pitfall S8 | `type` echo-from-current on update_stream_rule (non-nullable Java int) | Shipped — schema strips agent-supplied type; build sources from current.type unconditionally | 03-04 |
| Pitfall S9 | Numeric wire translation via `STREAM_RULE_TYPE_TO_NUMERIC` frozen map | Shipped — Test for frozen-ness + 8-entry exhaustiveness | 03-02 |
| Pitfall S10 | Empty-string defaults for variant-irrelevant rule fields | Shipped — fixture-style assertions in handler tests | 03-04 |
| Pitfall S12 | Leaf-delete still owes parent-mutable check | Shipped — `delete_stream_rule` D-09 pre-flight verified | 03-04 |
| Discretion-04 | LEAF DELETE for `delete_stream_rule` (no cascades, no confirm) | Shipped — descriptor structurally omits both keys; Tests 13 + 14 | 03-04 |
| Discretion-05 | 11 fixture minimum (12 with bonus list_stream_rules) | Shipped — 12 fixtures landed | 03-05 |

### Snapshot determinism evidence

Snapshot file: `test/__snapshots__/streams.test.js.snapshot` (348 lines, 12 exports).

Two-run md5 diff confirms byte-determinism:

```
$ md5sum test/__snapshots__/streams.test.js.snapshot
a6bc1fe7e30b0b9d001f25ea63cb405e  test/__snapshots__/streams.test.js.snapshot
```

(Hash captured 2026-05-15 immediately before Plan 05 close-out; second run produces identical md5.)

### Files Inventory

| Category | Count | Files |
|----------|-------|-------|
| Created — handlers | 12 | `src/tools/streams/{list-streams,get-stream,list-stream-rules,create-stream,update-stream,delete-stream,start-stream,pause-stream,create-stream-rule,update-stream-rule,delete-stream-rule,test-stream-match}.js` |
| Created — schemas / shared | 3 | `src/tools/streams/schemas.js`, `src/tools/streams/index.js`, `src/tools/_shared/cascade-hash.js` |
| Created — tests | 1 | `test/cascade-hash.test.js` |
| Created — snapshots | 1 | `test/__snapshots__/streams.test.js.snapshot` |
| Modified — registration | 1 | `src/tools/_register.js` (v2.3 list_streams displaced; new index imported) |
| Modified — tools catalogue | 1 | `src/tools.js` (12 new entries) |
| Modified — test suites | 3 | `test/streams.test.js` (104 tests); `test/schema-parity.test.js` (12 new parity assertions); `test/regression/__snapshots__/read-tools.test.js.snapshot` (re-recorded) |

---

*Phase 3 — Streams & Stream Rules — VALIDATION strategy: COMPLETE, nyquist-compliant, wave-0 covered. All automated checks landed; manual-only verifications documented for downstream live-smoke when a Graylog instance is reachable.*
