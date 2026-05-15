---
phase: 04-pipelines-pipeline-rules-connections
verified: 2026-05-15T22:33:31Z
status: human_needed
score: 4/4 roadmap success criteria verified + 14/14 PIPE requirements satisfied
overrides_applied: 0
re_verification: false
human_verification:
  - test: "End-to-end create_pipeline_rule round-trip against live Graylog"
    expected: "Live ParseException response shape matches the wrapper's parser; toUpperCase typo produces the agent-visible error envelope shape that fixture 6 pins"
    why_human: "Live ParseException response shape is the authoritative test; unit tests mock the response. Plan 01 U1 smoke could not authenticate against <graylog-host>:9000 (no API token in executor)."
  - test: "simulate_pipeline_rule end-to-end against live Graylog"
    expected: "JSON-string message encoding (Pitfall 1) deserializes correctly server-side; post-rule message reflects the set_field action"
    why_human: "Unit tests pin the wrapper's JSON.stringify but only a live run proves Graylog's deserializer accepts the JSON-string-encoded message field."
  - test: "connect_pipelines_to_stream non-replace semantics against live Graylog"
    expected: "After pre-creating a stream with pipelines A+B and calling connect_pipelines_to_stream(streamId, [C]), pipelines A+B remain connected"
    why_human: "The wrapper's GET-merge-PUT prevents silent disconnection. Only a live run with multiple pre-existing pipelines proves the Pitfall 2 semantics empirically."
  - test: "U1-style live smoke for partial-update (D-16)"
    expected: "Partial PUT body { title: 'X' } against /api/system/pipelines/pipeline/{id} returns 200 (STRICT_NO_ECHO) OR 400 missing-required (MERGE_FROM_CURRENT)"
    why_human: "Plan 01 produced 04-U1-SMOKE.md with UNREACHABLE_STRICT_NO_ECHO (no API token). Default branch is safe per Phase 3 precedent; live confirmation needed before production-ish use."
  - test: "Human-verify checkpoint sign-off in 04-06-PLAN.md Task 2"
    expected: "Reviewer reads 04-VALIDATION.md, runs npm test, verifies md5sum stability of pipelines.test.js.snapshot, spot-checks 14 fixtures, types 'approved'"
    why_human: "Plan 04-06 Task 2 is an explicit `checkpoint:human-verify` gate. The automated work is complete; the gate is the final phase-close handshake. Note: this checkpoint is listed in the VALIDATION 'Manual-Only Verifications' table and is the explicit blocker for ROADMAP.md Phase 4 parent-line flip."
---

# Phase 04: Pipelines, Pipeline Rules & Connections Verification Report

**Phase Goal:** An agent can author Graylog pipeline rules from structured intent or raw DSL, with both client-side validation and server-authoritative parse + simulate gating every apply.

**Verified:** 2026-05-15T22:33:31Z
**Status:** human_needed (all automated truths VERIFIED; 5 manual checkpoints remain — 4 live-Graylog smokes + 1 explicit human-verify gate in 04-06-PLAN.md Task 2)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria + PLAN frontmatter must_haves)

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | `create_pipeline_rule` accepts structured intent OR raw DSL; parse pre-flight; refuses on ParseException (ROADMAP SC1) | ✓ VERIFIED | `src/tools/pipelines/create-pipeline-rule.js` ships D-10 mutual exclusion (zod `.refine`), structured→emitRule path, raw→verbatim path, `validateRuleSource` over MERGED catalogue (Pitfall 5), `preflightParseRule` → POST /api/system/pipelines/rule/parse → throws `reason: "rule_parse_failed"` or `"rule_validation_failed"` on 400; handler.js apply NEVER runs. Snapshot fixture 6 pins the C4 acceptance-gate envelope shape. |
| 2  | `simulate_pipeline_rule` returns post-rule message; catches semantic bugs parse misses (ROADMAP SC2 / M3 gate) | ✓ VERIFIED | `src/tools/pipelines/simulate-pipeline-rule.js` ships POST /api/system/pipelines/rule/simulate with body `{ message: JSON.stringify(args.message), rule_source: { source } }` (Pitfall 1) + parse pre-flight + Discretion-03 structured-OR-raw input. Snapshot fixtures 11+12 pin the dry-run JSON-string body shape AND the apply-time post-rule field change. |
| 3  | `list_pipeline_functions` exposes merged static + live catalogue; same catalogue powers client-side validate.js (ROADMAP SC3) | ✓ VERIFIED | `src/tools/pipelines/list-pipeline-functions.js` delegates to `getMergedCatalogue` from `src/pipeline-dsl/function-catalogue.js` — the SAME helper consumed by `validate.js` and `create-pipeline-rule.js`. Per-connection process-lifetime cache; live wins on collision; static-only retained; live-only accepted (Pitfall 5). Fixture 10 pins the merged-overlay shape. |
| 4  | `delete_pipeline_rule` dry-run lists referencing pipelines (ROADMAP SC4) | ✓ VERIFIED | `src/tools/pipelines/delete-pipeline-rule.js` discovers via Strategy A paginated `/api/system/pipelines/rule/paginated` + `used_in_pipelines` server-side join (Pitfall 7 safety cap 200 pages × 50 = 10000 rules); freezes via `computeRuleCascadeHash` (Plan 01 thin wrapper); apply re-fetches + recomputes + refuses on drift with `reason: "cascade_changed_since_preview"`. Fixtures 8+9 pin distinct 64-hex literals (D-14 keyed-buckets disambiguation). |
| 5  | PIPE-DSL infrastructure (5 modules under `src/pipeline-dsl/`) ships with byte-stable emit, single-chokepoint escape, merged-catalogue validate (Pitfall 5), per-connection cache | ✓ VERIFIED | All 5 files exist at expected paths; `staticBuiltins.length === 133` (auto-adjusted from plan's 130 per Rule-1 source-verified deviation in 04-01-SUMMARY); `Object.isFrozen(staticBuiltins) === true`; `emit.js` imports `escapeString/escapeValue` from `escape.js`; `validate.js` consumes the merged Map (search confirms `mergedCatalogue` parameter); function-catalogue mirrors `type-catalogue.js` cache shape. 61 tests in `test/pipeline-dsl.test.js` green. |
| 6  | `update_pipeline` + `update_pipeline_rule` use STRICT_NO_ECHO partial-update per D-16 U1 smoke | ✓ VERIFIED | Both handlers use the conditional-spread pattern emitting ONLY `args.changes.*` fields. `04-U1-SMOKE.md` records `UNREACHABLE_STRICT_NO_ECHO` (no token; safe-default per Phase 3 precedent); applies to BOTH `update_pipeline` (Plan 02 / PIPE-04) AND `update_pipeline_rule` (Plan 03 / PIPE-09). Parse pre-flight fires ONLY when source is touched. `simulator_message` Nullable String clear-intent preserved (omit → no-op; explicit null → clear). |
| 7  | Pitfall 3 enforced — every pipeline URL uses the literal `/pipeline/` segment; every rule URL uses the literal `/rule/` segment | ✓ VERIFIED | grep -c `/api/system/pipelines/pipeline` finds the literal segment in all 5 Plan 02 files; rule handlers consistently use `/api/system/pipelines/rule/` and `/api/system/pipelines/rule/parse`. No bare-path drift detected. |
| 8  | Pitfall 2 enforced — connect/disconnect do GET-merge-PUT / GET-subtract-PUT; never silently disconnect existing pipelines | ✓ VERIFIED | `connect-pipelines-to-stream.js` uses `currentSet.add()` loop + sorted merged array → `body.pipeline_ids` preserves previously-connected ids; `disconnect-pipelines-from-stream.js` uses `currentSet.delete()` + sorted reduced array; both treat GET 404 as empty current set (`status === 404` branch present in both). Idempotency surfaces `already_connected` / `not_currently_connected` in `existingMatches`. Fixtures 13+14 pin the wire-body merge/subtract output. |
| 9  | D-14 cascade-hash byte-identity preserved — F8 populated and F9 empty produce DIFFERENT 64-hex hashes | ✓ VERIFIED | Recomputed live: `computeRuleCascadeHash({ ruleId: "r1", pipelineIds: ["p1","p2"] }) → 66267019f60955ff99686f3dbf343f40580996e22d5ead79045743f1d075e3a1` (matches F8 snapshot literal); `computeRuleCascadeHash({ ruleId: "r1", pipelineIds: [] }) → 9541cfc2cf6b92acde474f487f3e824942c1e0df4ae4308a60fa645afe1155b1` (matches F9 snapshot literal). Distinct: true. Byte-identical to direct `computeCascadeHash` forward call: true. |
| 10 | All 14 net-new Phase 4 tools registered in dispatch and `src/tools.js` | ✓ VERIFIED | Tool count via `node -e "import('./src/tools.js')..."` prints `68` (54 baseline + 14 net-new). All 14 Phase 4 tool names found in `toolDefinitions`. `src/tools/pipelines/index.js` contains 14 `register(...)` lines. |
| 11 | 14 byte-stable snapshot fixtures pin every Phase 4 tool + 4 acceptance gates (C4/M3/Pitfall-2/D-14) | ✓ VERIFIED | `test/snapshots/__snapshots__/pipelines.test.js.snapshot` contains 14 `exports[\`snapshot: …\`]` entries; `test/snapshots/pipelines.test.js` contains 14 `test(...)` calls. All 14 fixtures pass under `node --test test/snapshots/pipelines.test.js`. md5sum = `18a8b9ecc078d466be3bb97fc626ea10` (stable per 04-06-SUMMARY two-run determinism proof). |
| 12 | 14 schema-parity assertions for Phase 4 tools | ✓ VERIFIED | grep finds 14 `schema-parity: (list_pipelines|…)` entries in `test/schema-parity.test.js`; total schema-parity test count = 48 (34 pre-Phase-4 + 14 Phase 4); all green. |
| 13 | auth-redaction lint passes against new snapshot file (no apiToken-shaped strings) | ✓ VERIFIED | `node --test test/auth-redaction.test.js` exits 0; per 04-06-SUMMARY the auth-redaction scan was extended to `test/snapshots/__snapshots__/` since pipelines.test.js.snapshot lives there per the snapshot-config resolver. |
| 14 | Full suite green; no regressions on Phase 0/1/2/3 baseline | ✓ VERIFIED | `npm test` → 701 tests / 18 suites / 0 failures (was 459 pre-Phase-4 baseline; +242 net-new across Plans 01-06). |
| 15 | 04-VALIDATION.md frontmatter flipped green | ✓ VERIFIED | `status: complete`, `nyquist_compliant: true`, `wave_0_complete: true`, all per-task table rows ✅, all 6 Validation Sign-Off checkboxes ticked. |

**Score:** 15/15 automated truths verified · 4/4 ROADMAP Success Criteria verified

### Required Artifacts (all 14 Phase 4 tool handlers + DSL infrastructure + tests)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/pipeline-dsl/builtins.js` | 133 frozen entries, 16 categories | ✓ VERIFIED | 133 entries, Object.isFrozen=true, 31611 bytes |
| `src/pipeline-dsl/escape.js` | escapeString + escapeValue per RuleLang.g4 | ✓ VERIFIED | exports both helpers |
| `src/pipeline-dsl/emit.js` | RuleSpec → DSL emitter; imports escape.js | ✓ VERIFIED | import line present |
| `src/pipeline-dsl/function-catalogue.js` | getMergedCatalogue + _clearForTests | ✓ VERIFIED | per-connection cache mirrors inputs/type-catalogue.js |
| `src/pipeline-dsl/validate.js` | consumes merged Map (Pitfall 5) | ✓ VERIFIED | mergedCatalogue parameter confirmed |
| `src/tools/_shared/cascade-hash.js :: computeRuleCascadeHash` | thin wrapper byte-identical to computeCascadeHash | ✓ VERIFIED | forwards streamId=ruleId, pipelineConnIds=pipelineIds, ruleIds=[], eventDefIds=[]; live byte-identity probe confirms |
| `src/tools/pipelines/list-pipelines.js` | PIPE-01 narrow projection + stages_count | ✓ VERIFIED | defineListHandler with synthetic stages_count |
| `src/tools/pipelines/get-pipeline.js` | PIPE-02 full DTO | ✓ VERIFIED | plain async handler |
| `src/tools/pipelines/create-pipeline.js` | PIPE-03 with D-06 parse pre-flight + Pitfall 6 | ✓ VERIFIED | preflightParsePipeline exported; positionInLine read + position_in_line emit (4 occurrences each) |
| `src/tools/pipelines/update-pipeline.js` | PIPE-04 STRICT_NO_ECHO + conditional parse | ✓ VERIFIED | imports preflightParsePipeline from create-pipeline.js for single-source-of-truth |
| `src/tools/pipelines/delete-pipeline.js` | PIPE-05 leaf delete, no cascades, no _confirmationToken | ✓ VERIFIED | descriptor lacks cascades + _confirmationToken (fixture 4 pins JSON shape) |
| `src/tools/pipelines/list-pipeline-rules.js` | PIPE-06 narrow projection | ✓ VERIFIED | bare-array fast path |
| `src/tools/pipelines/get-pipeline-rule.js` | PIPE-07 full RuleSource DTO | ✓ VERIFIED | plain async handler |
| `src/tools/pipelines/create-pipeline-rule.js` | PIPE-08 — structured OR raw + parse pre-flight + C4 gate (ROADMAP SC1) | ✓ VERIFIED | emitRule + validateRuleSource + getMergedCatalogue consumed (7 grep hits); rule_parse_failed (3) + rule_validation_failed (1) |
| `src/tools/pipelines/update-pipeline-rule.js` | PIPE-09 STRICT_NO_ECHO + conditional parse | ✓ VERIFIED | imports preflightParseRule from create-pipeline-rule.js |
| `src/tools/pipelines/delete-pipeline-rule.js` | PIPE-10 D-14 cascade-hash + drift refusal (ROADMAP SC4) | ✓ VERIFIED | computeRuleCascadeHash (5 grep hits) + cascade_changed_since_preview (3) + Strategy A paginated + 200-page safety cap |
| `src/tools/pipelines/list-pipeline-functions.js` | PIPE-11 merged catalogue (ROADMAP SC3) | ✓ VERIFIED | defineListHandler delegating to getMergedCatalogue |
| `src/tools/pipelines/simulate-pipeline-rule.js` | PIPE-12 M3 gate + Pitfall 1 (ROADMAP SC2) | ✓ VERIFIED | `JSON.stringify(args.message)` present (1 hit, load-bearing) + parse pre-flight + emitRule for structured-mode |
| `src/tools/pipelines/connect-pipelines-to-stream.js` | PIPE-13 Pitfall 2 GET-merge-PUT | ✓ VERIFIED | already_connected (2) + status === 404 branch + sorted merged array |
| `src/tools/pipelines/disconnect-pipelines-from-stream.js` | PIPE-14 Pitfall 2 GET-subtract-PUT | ✓ VERIFIED | not_currently_connected (3) + status === 404 branch + sorted reduced array |
| `src/tools/pipelines/index.js` | side-effect barrel with 14 register lines | ✓ VERIFIED | exactly 14 `register(...)` lines for all PIPE-01..14 tools |
| `src/tools/pipelines/schemas.js` | 14 schemas including D-11 recursive grammar (z.lazy) + D-10 .refine mutual exclusion | ✓ VERIFIED | 16242 bytes; CreatePipelineRuleSchema uses Boolean(args.structured) !== Boolean(args.ruleSource) refine; ConditionSchema is z.lazy(() => z.discriminatedUnion("type", [...])) |
| `test/snapshots/pipelines.test.js` | 14 fixture tests | ✓ VERIFIED | 14 test(...) calls; 14 assert.snapshot(...) calls |
| `test/snapshots/__snapshots__/pipelines.test.js.snapshot` | 14 byte-stable exports | ✓ VERIFIED | 14 `exports[\`snapshot: …\`]` entries; md5sum 18a8b9ecc078d466be3bb97fc626ea10 |
| `test/schema-parity.test.js` | 14 net-new Phase 4 schema-parity assertions | ✓ VERIFIED | 14 `schema-parity: <name>` test calls for all PIPE-01..14 tools |
| `.planning/phases/04-pipelines-pipeline-rules-connections/04-U1-SMOKE.md` | D-16 UNREACHABLE_STRICT_NO_ECHO decision | ✓ VERIFIED | result: UNREACHABLE_STRICT_NO_ECHO; scope covers both update_pipeline + update_pipeline_rule |
| `.planning/phases/04-pipelines-pipeline-rules-connections/04-VALIDATION.md` | status:complete, nyquist_compliant:true, wave_0_complete:true | ✓ VERIFIED | all flips present + all 6 sign-off boxes ticked |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `emit.js` | `escape.js` | `import { escapeString }` | WIRED | grep confirms import; emit.js routes every literal through escape.js (T-04-01-05 structural mitigation) |
| `validate.js` | `function-catalogue.js` | merged-catalogue Map parameter | WIRED | validateRuleSource(source, mergedCatalogue); Pitfall 5 acceptance proven by test for `__phase4_test_function__` |
| `cascade-hash.js :: computeRuleCascadeHash` | `cascade-hash.js :: computeCascadeHash` | thin wrapper forwards inputs | WIRED | byte-identity proven live: F8 and F9 hashes match snapshot literals exactly; forwarding semantics preserved |
| `create-pipeline.js` | `POST /api/system/pipelines/pipeline/parse` | pre-flight inside build() | WIRED | preflightParsePipeline helper; refuses on 400 with reason:"pipeline_parse_failed" |
| `update-pipeline.js` | `POST /api/system/pipelines/pipeline/parse` | conditional pre-flight | WIRED | fires only when args.changes.source is touched |
| `create-pipeline-rule.js` | `emit.js` | args.structured → emitRule | WIRED | emitRule + validateRuleSource + getMergedCatalogue all consumed |
| `create-pipeline-rule.js` | `validate.js` | validateRuleSource(source, mergedCatalogue) | WIRED | client-side lint runs BEFORE server parse pre-flight |
| `create-pipeline-rule.js` | `POST /api/system/pipelines/rule/parse` | preflightParseRule inside build() | WIRED | C4 acceptance gate: refuses on 400 with reason:"rule_parse_failed" |
| `create-pipeline-rule.js` | `function-catalogue.js` | getMergedCatalogue | WIRED | merged Map consumed for Pitfall 5 acceptance |
| `update-pipeline-rule.js` | `create-pipeline-rule.js :: preflightParseRule` | re-exported / imported | WIRED | single-source-of-truth for reason name + Pitfall 6 translation |
| `delete-pipeline-rule.js` | `computeRuleCascadeHash` | build hash; apply re-compute + drift refusal | WIRED | 5 grep hits; cascade_changed_since_preview on drift |
| `simulate-pipeline-rule.js` | `POST /api/system/pipelines/rule/simulate` | JSON-stringified message body | WIRED | JSON.stringify(args.message) present (Pitfall 1) |
| `list-pipeline-functions.js` | `getMergedCatalogue` | fetch path | WIRED | thin defineListHandler over the cached merged Map |
| `connect-pipelines-to-stream.js` | `GET /api/system/pipelines/connections/{streamId}` | pre-flight to get current set | WIRED | 404 → empty current set; GET fires before POST |
| `connect-pipelines-to-stream.js` | `POST /api/system/pipelines/connections/to_stream` | apply path with merged pipeline_ids | WIRED | sorted merged array; existingMatches surfaces already_connected |
| `disconnect-pipelines-from-stream.js` | `POST /api/system/pipelines/connections/to_stream` | apply with reduced pipeline_ids | WIRED | sorted reduced array; existingMatches surfaces not_currently_connected |
| `src/tools/_register.js` | `src/tools/pipelines/index.js` | side-effect import | WIRED | barrel imported once at registration time |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `list-pipelines.js` | `items` | GET /api/system/pipelines/pipeline (bare array) | Yes — Array.isArray fast path; synthetic stages_count from stages.length | ✓ FLOWING |
| `list-pipeline-functions.js` | `entries` | `getMergedCatalogue` Map → entries → optional category/deprecated_only filter → sort by name | Yes — merged static (133) + live overlay; filters preserve real data | ✓ FLOWING |
| `delete-pipeline-rule.js` (cascade) | `pipelines` | paginated walk `/api/system/pipelines/rule/paginated` → context.used_in_pipelines[ruleId] | Yes — server-side join; safety cap at 200 pages | ✓ FLOWING |
| `simulate-pipeline-rule.js` | `body.message` | `JSON.stringify(args.message)` | Yes — agent's field-map preserved as JSON-string wire form (Pitfall 1) | ✓ FLOWING |
| `connect-pipelines-to-stream.js` | `merged` | current.pipeline_ids ∪ args.pipelineIds | Yes — union preserves existing; sorted output | ✓ FLOWING |
| `disconnect-pipelines-from-stream.js` | `reduced` | current.pipeline_ids \ args.pipelineIds | Yes — difference preserves remaining; sorted output | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full suite green | `npm test` | 701 tests / 18 suites / 0 fail | ✓ PASS |
| Snapshot fixtures green | `node --test test/snapshots/pipelines.test.js` | 14 tests / 0 fail | ✓ PASS |
| Schema-parity green (14 Phase 4 + 34 baseline) | `node --test test/schema-parity.test.js` | 48 tests / 0 fail | ✓ PASS |
| Auth-redaction green | `node --test test/auth-redaction.test.js` | 1 test / 0 fail | ✓ PASS |
| Pipelines handler suite | `node --test test/pipelines.test.js` | 147 tests / 0 fail | ✓ PASS |
| Pipeline-DSL suite | `node --test test/pipeline-dsl.test.js` | 61 tests / 0 fail | ✓ PASS |
| Cascade-hash suite (Phase 3 + Phase 4 wrapper) | `node --test test/cascade-hash.test.js` | 14 tests / 0 fail | ✓ PASS |
| Tool count | `node -e "import('./src/tools.js').then(...)"` | 68 (54 baseline + 14 net-new) | ✓ PASS |
| Builtins frozen + sized | `node -e "...builtins..."` | length:133 frozen:true | ✓ PASS |
| F8 cascade hash (populated) | `computeRuleCascadeHash({ruleId:'r1', pipelineIds:['p1','p2']})` | `66267019…3a1` (matches snapshot literal) | ✓ PASS |
| F9 cascade hash (empty) | `computeRuleCascadeHash({ruleId:'r1', pipelineIds:[]})` | `9541cfc2…5b1` (matches snapshot literal) | ✓ PASS |
| F8 vs F9 distinct | live probe | true (different hashes — D-14 keyed-buckets disambiguation holds) | ✓ PASS |
| Byte-identity wrapper → underlying | `computeRuleCascadeHash(...) === computeCascadeHash({streamId, ruleIds:[], pipelineConnIds:[p1,p2], eventDefIds:[]})` | true | ✓ PASS |
| Snapshot md5sum stability | `md5sum test/snapshots/__snapshots__/pipelines.test.js.snapshot` | `18a8b9ecc078d466be3bb97fc626ea10` (matches 04-06-SUMMARY recorded value) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PIPE-01 | 04-02 | list_pipelines narrow projection | ✓ SATISFIED | `src/tools/pipelines/list-pipelines.js` + fixture 1 + REQUIREMENTS.md status flipped to Complete |
| PIPE-02 | 04-02 | get_pipeline full DTO | ✓ SATISFIED | `src/tools/pipelines/get-pipeline.js` + REQUIREMENTS.md Complete |
| PIPE-03 | 04-02 | create_pipeline with parse pre-flight | ✓ SATISFIED | `create-pipeline.js` ships D-06 + fixture 2 |
| PIPE-04 | 04-02 | update_pipeline STRICT_NO_ECHO + parse pre-flight | ✓ SATISFIED | `update-pipeline.js` + fixture 3 |
| PIPE-05 | 04-02 | delete_pipeline sync envelope, no cascade | ✓ SATISFIED | `delete-pipeline.js` (leaf delete) + fixture 4 |
| PIPE-06 | 04-03 | list_pipeline_rules narrow projection | ✓ SATISFIED | `list-pipeline-rules.js` |
| PIPE-07 | 04-03 | get_pipeline_rule full DTO | ✓ SATISFIED | `get-pipeline-rule.js` |
| PIPE-08 | 04-03 | create_pipeline_rule structured-OR-raw + parse pre-flight (ROADMAP SC1 C4 gate) | ✓ SATISFIED | `create-pipeline-rule.js` + fixtures 5+6 |
| PIPE-09 | 04-03 | update_pipeline_rule STRICT_NO_ECHO + conditional parse | ✓ SATISFIED | `update-pipeline-rule.js` + fixture 7 |
| PIPE-10 | 04-04 | delete_pipeline_rule cascade preview + drift refusal (ROADMAP SC4) | ✓ SATISFIED | `delete-pipeline-rule.js` + fixtures 8+9 (D-14 disambiguation) |
| PIPE-11 | 04-04 | list_pipeline_functions merged catalogue (ROADMAP SC3) | ✓ SATISFIED | `list-pipeline-functions.js` + fixture 10 |
| PIPE-12 | 04-04 | simulate_pipeline_rule (ROADMAP SC2 M3 gate) | ✓ SATISFIED | `simulate-pipeline-rule.js` + fixtures 11+12 |
| PIPE-13 | 04-05 | connect_pipelines_to_stream Pitfall 2 GET-merge-PUT | ✓ SATISFIED | `connect-pipelines-to-stream.js` + fixture 13 |
| PIPE-14 | 04-05 | disconnect_pipelines_from_stream Pitfall 2 GET-subtract-PUT | ✓ SATISFIED | `disconnect-pipelines-from-stream.js` + fixture 14 |

All 14 PIPE requirements satisfied; REQUIREMENTS.md traceability table updated for all 14 (line 251-264). No orphaned requirements: REQUIREMENTS.md maps exactly PIPE-01..14 to Phase 4 and all 14 plans claim them in frontmatter `requirements:` fields.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| All 14 Phase 4 tool descriptions in `src/tools.js` | varies | Descriptions exceed 200-char target (226-1029 chars) | ℹ️ Info | Plan 04-06 success criterion #10 specified ≤200 chars per Phase 4 description. Descriptions are informative but verbose. Deferred to **HARD-01** (Phase 7) which is the project-wide tool-description audit + automated merge-gate. Not a Phase 4 ROADMAP SC concern. |

No blockers. No stubs. No empty handlers. No TODO/FIXME/placeholder strings in shipped code. Every literal in DSL emission routes through `escape.js` (single chokepoint — T-04-01-05 structurally mitigated, no inline template interpolation anywhere).

### Human Verification Required

5 items need human testing (4 live-Graylog smokes + 1 explicit human-verify checkpoint):

#### 1. End-to-end `create_pipeline_rule` round-trip against live Graylog (PIPE-08 + D-05)

**Test:** Send a rule with `toUpperCase` typo to `http://<graylog-host>:9000/api/system/pipelines/rule/parse` using an actual API token. Capture the response shape.

**Expected:** Live ParseException response shape carries `positionInLine` (camelCase) on the wire; the wrapper translates to `position_in_line` (snake_case) in the emitted MCP error envelope (Pitfall 6). Fixture 6 already pins the wrapper's emitted shape; live confirmation validates that the wire-side assumption is correct.

**Why human:** Unit tests mock the response. Plan 01 U1 smoke could not authenticate (no API token in executor environment).

#### 2. `simulate_pipeline_rule` end-to-end against live Graylog (PIPE-12 + D-08)

**Test:** Compose a rule that sets a field; submit with a sample message via `POST /api/system/pipelines/rule/simulate`; verify the response's post-rule message has the field set.

**Expected:** JSON-string `body.message` encoding (Pitfall 1) deserializes correctly server-side; the wrapper's `body.message = JSON.stringify(args.message)` matches Graylog's expected wire shape. Without this, the call would 400 with "Cannot deserialize value of type java.lang.String from Object value".

**Why human:** Unit tests pin the wrapper's JSON.stringify but only a live run proves Graylog's deserializer accepts the JSON-string-encoded message field.

#### 3. `connect_pipelines_to_stream` non-replace semantics against live Graylog (PIPE-13 + Pitfall 2)

**Test:** Pre-create stream with pipelines A+B already connected; call `connect_pipelines_to_stream(streamId, [C])` with `dryRun: false`; verify A+B are still connected after the apply.

**Expected:** The wrapper's GET-merge-PUT correctly preserves A+B. A regression to naive replacement would silently disconnect them — the highest-severity Phase 4 connection bug.

**Why human:** Only a live run with multiple pre-existing pipelines proves the semantics empirically. Fixtures 13+14 pin the wrapper-side merge logic but the cross-network round-trip is the authoritative test.

#### 4. U1-style live smoke for partial-update (D-16 / PIPE-04 / PIPE-09)

**Test:** Run the probe commands documented in `04-U1-SMOKE.md` §Procedure once an API token is available. Minimal partial PUT: `{"title": "<current_title>"}` against `/api/system/pipelines/pipeline/{id}`.

**Expected:** 200/204 → STRICT_NO_ECHO confirmed; 400 missing-required → widen to MERGE_FROM_CURRENT (additive, no back-compat break).

**Why human:** Plan 01 produced `04-U1-SMOKE.md` with `UNREACHABLE_STRICT_NO_ECHO` (no API token). Default branch is safe per Phase 3 precedent; live confirmation needed before production-ish use. Reversible to merge-from-current with no agent-facing break.

#### 5. Human-verify checkpoint sign-off (04-06-PLAN.md Task 2)

**Test:**
1. Read `04-VALIDATION.md` and confirm `nyquist_compliant: true`, `wave_0_complete: true`, `status: complete`; every per-task table row shows ✅.
2. Run `npm test` and confirm tool count = 68.
3. Run `npm test` twice and confirm `md5sum test/snapshots/__snapshots__/pipelines.test.js.snapshot` is identical across runs.
4. Open `test/snapshots/__snapshots__/pipelines.test.js.snapshot` and spot-check the 14 fixtures match the acceptance-gate expectations enumerated in 04-06-PLAN.md Task 2 (`<how-to-verify>` step 4 — items per fixture).
5. Run `node -e "import('./src/tools.js')..."` to read Phase 4 tool descriptions; note HARD-01 (Phase 7) addresses ≤200-char audit project-wide.
6. Type "approved" to finalize Phase 4 + flip the parent ROADMAP.md Phase 4 entry to ✓ + create phase-close artifact.

**Expected:** Reviewer signs off; ROADMAP.md Phase 4 line (currently `[ ] **Phase 4: Pipelines, Pipeline Rules & Connections** — …`) flips to `[x]`; progress table row flips from "5/6 In Progress" to "6/6 Complete".

**Why human:** Plan 04-06 Task 2 is an explicit `checkpoint:human-verify` gate with `gate="blocking"`. The automated work is complete and 04-VALIDATION.md has already flipped to `status: complete`; the gate is the final phase-close handshake before the parent ROADMAP entry can move. This is the only non-automated blocker for the close ceremony.

### Gaps Summary

**No gaps blocking goal achievement.** All 4 ROADMAP Success Criteria, all 14 PIPE requirements, all 15 observable truths from PLAN frontmatter + ROADMAP are VERIFIED in code.

The phase ships:

- **DSL infrastructure** (5 modules, 61 tests): hand-curated 133-entry frozen builtins catalogue (Rule-1 auto-fix from plan's 130 — source-code-verified); RuleLang.g4-correct escape helpers; structured-intent emitter routing every literal through escape.js (T-04-01-05 single chokepoint); per-connection live-overlay function-catalogue cache; client-side validator over the MERGED Map (Pitfall 5 acceptance for live-only names).

- **14 net-new tools** (PIPE-01..14): pipeline CRUD with D-06 server-authoritative parse pre-flight + STRICT_NO_ECHO partial-update (D-16) + leaf-delete (D-15); pipeline-rule CRUD with D-10 mutual-exclusion + D-11 recursive structured-intent grammar (z.lazy) + D-04 client lint + D-05 server parse pre-flight + simulator_message 3-state preservation; D-14 cascade-hash + drift refusal via `computeRuleCascadeHash` thin wrapper (byte-identical to Phase 3's `computeCascadeHash` keyed-buckets canonicalization); M3 acceptance gate via `simulate_pipeline_rule` with Pitfall 1 JSON-string body encoding; merged live+static function catalogue surface; Pitfall 2 GET-merge-PUT / GET-subtract-PUT for stream connections.

- **Testing surface**: 14 byte-stable snapshot fixtures (md5sum `18a8b9ecc078d466be3bb97fc626ea10`) pinning every acceptance gate (C4 fixture 6, M3 fixtures 11+12, D-14 fixtures 8+9 with distinct frozen hashes, Pitfall 2 fixtures 13+14); 14 schema-parity assertions; auth-redaction lint extended to scan the new snapshot directory; 701/701 full-suite green.

The 5 human-verification items are the standard remaining "live Graylog round-trip" smokes + the explicit human-verify checkpoint that PLAN 04-06 Task 2 defines as the phase-close handshake. These are NOT automated-coverage gaps — every fixture-pinnable wrapper-side behavior is pinned. The checkpoint is structurally the gate that flips the parent ROADMAP entry from "5/6 In Progress" to "6/6 Complete" once a reviewer types "approved".

**Recommendation:** Status `human_needed` — automated checks all green; the verifier defers to the human-verify checkpoint that 04-06-PLAN.md explicitly defined as the close ceremony.

---

_Verified: 2026-05-15T22:33:31Z_
_Verifier: Claude (gsd-verifier)_
