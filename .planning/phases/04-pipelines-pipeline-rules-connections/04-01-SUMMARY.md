---
phase: 04-pipelines-pipeline-rules-connections
plan: 01
subsystem: dsl
tags: [pipelines, pipeline-dsl, builtins, escape, emit, validate, function-catalogue, cascade-hash, computeRuleCascadeHash, u1-smoke, d-02, d-03, d-04, d-11, d-12, d-13, d-14, d-16, pitfall-5, threat-t-04-01]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: makeClient + _setCaptureRequest seam (HTTP client primitive used by function-catalogue.js), defineMutatingHandler (Plans 02-05 will consume)
  - phase: 01-inputs-extractors
    provides: per-domain folder layout; src/tools/inputs/type-catalogue.js (verbatim shape for function-catalogue.js)
  - phase: 03-streams-stream-rules/03-01
    provides: src/tools/_shared/cascade-hash.js + computeCascadeHash D-02 keyed-buckets helper (Plan 04-01 appends computeRuleCascadeHash thin wrapper)
provides:
  - "src/pipeline-dsl/builtins.js — frozen 133-entry static catalogue of Graylog pipeline-rule builtins covering 16 categories (root, arrays, conversion, dates, dates/periods, debug, encoding, hashing, ips, json, lookup, maps, messages, strings, syslog, urls). Source-verified: zero mismatches against grep of 135 source files."
  - "src/pipeline-dsl/escape.js — escapeString + escapeValue helpers per RuleLang.g4:363-381 character set. Single chokepoint for all DSL literal emission (threat T-04-01-05). PII redaction in error messages (T-04-01-03)."
  - "src/pipeline-dsl/emit.js — structured-intent RuleSpec → DSL string emitter covering all 7 Condition variants + 6 Action variants (D-10/D-11). Byte-stable. Every literal routes through escape.js (no inline template interpolation)."
  - "src/pipeline-dsl/function-catalogue.js — per-connection process-lifetime cache (D-03). One GET per connectionName; live overlay over static baseline with live-wins-on-collision semantics. _clearFunctionCatalogueForTests seam."
  - "src/pipeline-dsl/validate.js — client-side DSL validator (D-04). Consumes the MERGED Map (Pitfall 5 fix: live-only function names accepted). Flags unknown_function + paren_imbalance."
  - "src/tools/_shared/cascade-hash.js :: computeRuleCascadeHash — thin semantic wrapper around computeCascadeHash. Byte-identical output (pinned by test). Phase 4 Plan 04's delete_pipeline_rule will consume."
  - ".planning/phases/04-pipelines-pipeline-rules-connections/04-U1-SMOKE.md — D-16 decision artifact (UNREACHABLE_STRICT_NO_ECHO) locking STRICT_NO_ECHO for update_pipeline (Plan 02) and update_pipeline_rule (Plan 03)."
affects:
  - "04-02 (create_pipeline / update_pipeline / delete_pipeline / list_pipelines / get_pipeline — STRICT_NO_ECHO for update; parse pre-flight pattern from emit.js + validate.js)"
  - "04-03 (create_pipeline_rule / update_pipeline_rule / list_pipeline_rules / get_pipeline_rule / list_pipeline_functions — emit.js for structured intent → DSL; validate.js + function-catalogue.js for client-side lint; STRICT_NO_ECHO for update with simulator_message clear-intent preserved)"
  - "04-04 (delete_pipeline_rule — computeRuleCascadeHash for the cascade confirmation gate)"
  - "04-05 (simulate_pipeline_rule + connect_pipelines_to_stream + disconnect_pipelines_from_stream — emit.js composition; escape.js for any literal in simulate payloads)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-connection process-lifetime catalogue cache (function-catalogue.js mirrors src/tools/inputs/type-catalogue.js): Map<connectionName, {fetchedAt, merged}>. One GET per connectionName; live overlay over static baseline; _clearForTests seam. Reusable for any future live-catalogue surface."
    - "Two-catalogue merge with live-wins: static baseline (hand-curated) provides description + category gap-fillers; live response (authoritative) overrides on name collision while preserving static category. Live-only names accepted with source: 'live' + category: 'unknown' (Pitfall 5)."
    - "Single-chokepoint DSL emission: every embedded literal routes through escape.js — no inline `${value}` template interpolation. emit.js is the sole legitimate site of DSL string construction. T-04-01-05 structural mitigation."
    - "Thin semantic wrappers for cross-phase hash helpers: computeRuleCascadeHash forwards into computeCascadeHash with parameter renaming so call-sites read naturally without breaking the underlying canonical-form contract. Test pins byte-identity (T-04-01-06)."

key-files:
  created:
    - "src/pipeline-dsl/builtins.js (188 lines, 31611 bytes — 133 frozen entries across 16 categories)"
    - "src/pipeline-dsl/escape.js (83 lines)"
    - "src/pipeline-dsl/emit.js (119 lines)"
    - "src/pipeline-dsl/function-catalogue.js (93 lines)"
    - "src/pipeline-dsl/validate.js (88 lines)"
    - "test/pipeline-dsl.test.js (519 lines, 53 tests)"
    - ".planning/phases/04-pipelines-pipeline-rules-connections/04-U1-SMOKE.md"
  modified:
    - "src/tools/_shared/cascade-hash.js (append computeRuleCascadeHash + JSDoc)"
    - "test/cascade-hash.test.js (+6 tests for computeRuleCascadeHash; +1 import line; 14 total tests)"

key-decisions:
  - "D-16 UNREACHABLE_STRICT_NO_ECHO: no API token in executor environment — partial-PUT smoke skipped per Phase 3 precedent. STRICT_NO_ECHO locked for both update_pipeline (Plan 02) and update_pipeline_rule (Plan 03). Pipelines carry no encrypted fields (verified against PipelineSource.java); rules carry simulator_message as Nullable String where STRICT_NO_ECHO preserves explicit-null clear-intent precisely (omit → no-op; null → clear)."
  - "Plan inventory adjusted 130 → 133 (Rule 1 bug fix): the plan's claimed builtin count of 130 was a RESEARCH summary-table sanity-check artifact. Source-of-truth `grep public static final String NAME source-code/.../pipelineprocessor/functions/**/*.java | sort -u | wc -l` returns 133 unique NAME values across 135 files (2 base-class shells without NAME). My transcription diffs ZERO mismatches in either direction. The test gate was adjusted to 133 with an inline comment documenting the source verification."
  - "computeRuleCascadeHash byte-identity vs computeCascadeHash forwarding: thin semantic wrapper around the underlying helper with parameter renaming (ruleId → streamId slot, pipelineIds → pipelineConnIds slot, empty ruleIds + eventDefIds). Test 'computeRuleCascadeHash is BYTE-IDENTICAL to the equivalent computeCascadeHash call' pins this so a future regression in computeCascadeHash breaks Phase 4 hashes too — single source of truth, no parallel canonical-form drift."
  - "Validate.js consumes the MERGED Map, NOT raw staticBuiltins (Pitfall 5 fix): tests demonstrate a synthetic live-only function name `__phase4_test_function__` is accepted when present in the merged map. This is the structural fix for the 'hand-curated baseline drifts from Graylog source' failure mode — newer Graylog versions ship new functions and the live overlay catches them automatically."

patterns-established:
  - "Pattern: Two-catalogue merge with live-wins (function-catalogue.js) — extends the per-connection cache pattern from inputs/type-catalogue.js with static-baseline + live-overlay semantics. Static fills description gaps; live wins on collision; static-only and live-only entries both surface in the merged map."
  - "Pattern: Structured-intent emitter as a single chokepoint (emit.js) — agent passes JSON RuleSpec; wrapper emits DSL via switch/case over Condition + Action types; every literal goes through escape.js. Reusable for any future structured-language emitter (event definition NotificationConfig?)."
  - "Pattern: Thin semantic wrapper around shared canonicalization helpers (computeRuleCascadeHash) — when a downstream phase needs cleaner call-site naming around an already-existing Phase 3 helper, write a thin forward instead of duplicating the canonical-form code. Byte-identity test pins forwarding semantics."

requirements-completed: [PIPE-11]

# Metrics
duration: ~25 min
completed: 2026-05-15
---

# Phase 04 Plan 01: Pipeline-DSL Foundation Summary

**Five-module `src/pipeline-dsl/` infrastructure (frozen 133-entry builtins, RuleLang.g4-correct escape helpers, structured-intent DSL emitter, per-connection live-overlay function-catalogue cache, MERGED-map validator) plus computeRuleCascadeHash thin wrapper plus D-16 UNREACHABLE_STRICT_NO_ECHO smoke artifact — every downstream Phase 4 plan composes against this stable interface.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-15T20:49:37Z
- **Completed:** 2026-05-15T~21:15Z
- **Tasks:** 1 (TDD: RED + GREEN; no REFACTOR needed)
- **Files modified:** 9 (7 created + 2 amended)
- **Tests:** 67 net-new (+53 in pipeline-dsl.test.js + 6 in cascade-hash.test.js + 8 existing cascade-hash preserved)
- **Full suite:** 526 tests / 18 suites / all green (was 459 baseline; +67 net-new)

## Accomplishments

- Hand-curated baseline of 133 Graylog pipeline-rule functions transcribed from `source-code/.../pipelineprocessor/functions/` covering 16 categories; source-verified by grep diff (zero mismatches)
- RuleLang.g4-correct DSL escape helpers covering the 8 short-form escapes + \uNNNN fallback for U+0000..U+001F control chars; type-aware escapeValue refuses objects/arrays/undefined at the boundary
- Structured-intent DSL emitter covering all 7 Condition variants (comparison, and, or, not, function_call, has_field, field_ref + literal) and all 6 Action variants (set_field, remove_field, rename_field, lookup_value, function_call_statement, let_assignment) with byte-stable output
- Per-connection live-overlay function-catalogue cache (1 GET per connectionName per process lifetime) with live-wins-on-collision semantics + static-only + live-only entry handling; `_clearFunctionCatalogueForTests` seam mirrors `_clearTypeCatalogueForTests`
- Client-side DSL validator consumes the MERGED Map (Pitfall 5 fix) — live-only function names introduced by newer Graylog versions DO NOT false-fail before parse pre-flight
- computeRuleCascadeHash thin semantic wrapper around Phase 3's computeCascadeHash; byte-identity pinned by test for delete_pipeline_rule (Plan 04-04) consumption
- D-16 partial-update decision: UNREACHABLE_STRICT_NO_ECHO locked for both update_pipeline (Plan 02) and update_pipeline_rule (Plan 03) with simulator_message clear-intent preservation rationale documented

## Task Commits

1. **Task 1 RED gate: failing tests for pipeline-dsl + computeRuleCascadeHash** — `9f0b519` (test)
2. **Task 1 GREEN gate: ship pipeline-dsl infrastructure + cascade wrapper + U1 smoke** — `877bec1` (feat)

_Plan was a single TDD task per the frontmatter `type: tdd`; RED + GREEN gates both committed. No REFACTOR commit needed — the GREEN implementation is the final shape._

## Files Created/Modified

### Created
- `src/pipeline-dsl/builtins.js` (188 lines / 31,611 bytes) — Object.freeze'd 133-entry static catalogue
- `src/pipeline-dsl/escape.js` (83 lines) — escapeString + escapeValue per RuleLang.g4
- `src/pipeline-dsl/emit.js` (119 lines) — RuleSpec → DSL emitter; imports escape.js
- `src/pipeline-dsl/function-catalogue.js` (93 lines) — per-connection cache + live overlay
- `src/pipeline-dsl/validate.js` (88 lines) — paren-balance + unknown_function over MERGED map
- `test/pipeline-dsl.test.js` — 53 tests covering A/B/C/D/E behavior categories
- `.planning/phases/04-pipelines-pipeline-rules-connections/04-U1-SMOKE.md` — D-16 decision record

### Modified
- `src/tools/_shared/cascade-hash.js` — appended computeRuleCascadeHash (Phase 4 D-14)
- `test/cascade-hash.test.js` — +6 tests for computeRuleCascadeHash byte-identity / sort independence / malformed-input rejection

## Decisions Made

1. **builtins.js inventory: 133 entries (not 130)** — see Deviations below. Source-code grep is authoritative.
2. **U1 smoke result: UNREACHABLE_STRICT_NO_ECHO** — no API token available; safe default per Phase 3 precedent. Applies to both update_pipeline and update_pipeline_rule. Rationale: pipelines carry no encrypted fields, rules' simulator_message Nullable String benefits from STRICT_NO_ECHO's omit-vs-explicit-null disambiguation.
3. **validate.js consumes MERGED Map, not raw static** — Pitfall 5 structural fix. Test demonstrates live-only function names are accepted.
4. **emit.js byte-stability invariant** — no Date.now, no random; identical input produces identical output (test pinned). Required for downstream snapshot fixtures.
5. **emit.js single-chokepoint escape routing** — every literal goes through escape.escapeString or escape.escapeValue; no `${value}` template interpolation anywhere. T-04-01-05 structural mitigation.
6. **computeRuleCascadeHash byte-identity** — thin forward into computeCascadeHash with parameter renaming (no parallel canonical-form code); test pins byte-identity so a future regression in computeCascadeHash breaks Phase 4 hashes too.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan's builtin inventory count was off by 3 (claimed 130, actual 133)**
- **Found during:** Task 1 GREEN gate, after transcribing per-section RESEARCH tables
- **Issue:** The plan's `staticBuiltins.length === 130` test gate and "the canonical count for builtins.js" claim was a RESEARCH summary-table sanity-check artifact. The RESEARCH summary table claimed 133 entries dedupe to 130 because of alleged "double-counts" across categories — but the per-section row tables themselves listed 133 UNIQUE names with zero cross-category duplicates (verified by `awk` extraction + `sort | uniq -c`). The actual source-code count (`grep "public static final String NAME" source-code/.../pipelineprocessor/functions/**/*.java | grep -oP 'NAME\\s*=\\s*"\\K[^"]+' | sort -u | wc -l`) returns 133. My transcription diffs ZERO mismatches in either direction against the live source NAMEs.
- **Fix:** Adjusted the test gate from `staticBuiltins.length === 130` to `staticBuiltins.length === 133` with an inline comment documenting the source-verification methodology. Adjusted the builtins.js header comment to say "133 entries" and document the source-grep verification. No silent dropping of source-attested functions to hit the plan's wrong number.
- **Files modified:** test/pipeline-dsl.test.js, src/pipeline-dsl/builtins.js
- **Verification:** `node -e "import('./src/pipeline-dsl/builtins.js').then(m => { const s = new Set(m.staticBuiltins.map(b=>b.name)); console.log('length:', m.staticBuiltins.length, 'unique:', s.size) })"` prints `length: 133 unique: 133`. `diff <(grep "public static final String NAME" source-code/.../functions/ | grep -oP 'NAME\s*=\s*"\K[^"]+' | sort -u) <(node -e "..." | sort -u)` is empty in both directions.
- **Committed in:** `877bec1` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug — plan inventory count off-by-three)
**Impact on plan:** Inventory correctness preserved; the spirit of the plan ("hand-curated baseline matching Graylog source") strictly met. Downstream Plans 02-05 see 3 MORE valid function names than the planner anticipated — strictly additive; no functionality lost. The plan's anchor-coverage test still passes (all 38+ anchors present). Plan acceptance criterion `grep -c "name:" src/pipeline-dsl/builtins.js → 130` is replaced by `→ 133` for the same purpose.

## Issues Encountered

None. Tests went green on the first GREEN-gate run after RED commit; no debugging required beyond the inventory-count audit (resolved via source-code grep diff in ~3 minutes).

## Self-Check: PASSED

- All 7 created files exist (verified via `ls`/Read)
- All 2 modified files committed (verified via `git log --oneline`)
- All 67 net-new tests pass (verified via `node --test test/pipeline-dsl.test.js test/cascade-hash.test.js` → 75 tests passing)
- Full suite green: `npm test` → 526 tests / 18 suites / 0 failures
- Byte-identity probe: `node -e "...computeRuleCascadeHash vs computeCascadeHash..."` prints `BYTE_IDENTICAL`
- Uniqueness probe: 133 entries / 133 unique names → `UNIQUE`
- All acceptance criteria grep checks pass (Object.freeze ≥ 1, escapeString/escapeValue ≥ 2, escape import in emit.js ≥ 1, getMergedCatalogue + _clearForTests ≥ 2, validateRuleSource ≥ 1, mergedCatalogue in validate.js ≥ 1, computeRuleCascadeHash ≥ 2, computeCascadeHash ≥ 3, UNREACHABLE_STRICT_NO_ECHO ≥ 1, update_pipeline/update_pipeline_rule ≥ 2)

## Next Phase Readiness

- **Plan 04-02 (pipelines CRUD)** can import `getMergedCatalogue` for client-side lint, `parse pre-flight` for D-06 pipeline parser, and apply STRICT_NO_ECHO for update_pipeline per the U1 smoke decision.
- **Plan 04-03 (pipeline rules CRUD + simulate)** can import `emitRule` for structured-intent → DSL, `validateRuleSource` for client-side lint, `getMergedCatalogue` for the function catalogue surface, and apply STRICT_NO_ECHO for update_pipeline_rule with simulator_message clear-intent preserved.
- **Plan 04-04 (delete_pipeline_rule cascade)** can import `computeRuleCascadeHash` directly — byte-identical to Phase 3's keyed-buckets canonicalization, no parallel hash code to maintain.
- **Plan 04-05 (simulate + connect/disconnect)** can compose `emitRule` + `escape.escapeString` for any literal in simulate payloads (Pitfall 1: `message` is JSON-stringified, so the field-map can contain DSL-unsafe characters — escape is the wrapper-side guard).

No blockers. No deferred items.

---
*Phase: 04-pipelines-pipeline-rules-connections*
*Plan: 01*
*Completed: 2026-05-15*
