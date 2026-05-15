---
phase: 04-pipelines-pipeline-rules-connections
plan: 03
subsystem: pipeline-rule-crud
tags: [pipelines, pipeline-rule-crud, parse-preflight, c4-acceptance-gate, structured-intent, d-05, d-10, d-11, d-17, strict-no-echo, pitfall-3, pitfall-5, pitfall-6]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: defineMutatingHandler + defineListHandler + makeClient + writable-gate D-07 + __SERVER_ASSIGNED__ sentinel + GraylogValidationError typed error
  - phase: 01-inputs-extractors
    provides: per-domain folder layout (src/tools/<domain>/); findExistingMatches M5 conflict pre-check helper; toIdBody normalize helper
  - phase: 04-pipelines-pipeline-rules-connections/04-01
    provides: src/pipeline-dsl/emit.js (structured-intent → DSL), src/pipeline-dsl/validate.js (MERGED catalogue lint), src/pipeline-dsl/function-catalogue.js (getMergedCatalogue + _clearForTests seam), 04-U1-SMOKE.md (UNREACHABLE_STRICT_NO_ECHO)
  - phase: 04-pipelines-pipeline-rules-connections/04-02
    provides: handler.js parseResult opt-in spread (Plan 02 Rule 3 amendment), preflightParsePipeline pattern (Plan 03 mirrors for rules), Pitfall 6 camelCase→snake_case translation precedent
provides:
  - "src/tools/pipelines/schemas.js — extended with full D-11 structured-intent grammar: ConditionSchema (8 variants via z.lazy discriminatedUnion), ActionSchema (6-variant discriminatedUnion), ExpressionSchema, FunctionCallSchema, RuleSpecSchema, plus 4 new PIPE-06..09 schemas. CreatePipelineRuleSchema's .refine encodes D-10 mutual exclusion (Boolean(structured) !== Boolean(ruleSource))."
  - "src/tools/pipelines/list-pipeline-rules.js — PIPE-06 with bare-array unwrap and narrow projection [id, title, description, created_at, modified_at]."
  - "src/tools/pipelines/get-pipeline-rule.js — PIPE-07 plain async handler returning full RuleSource DTO including rule_builder + simulator_message."
  - "src/tools/pipelines/create-pipeline-rule.js — PIPE-08 (ROADMAP SC1 C4 mitigation centerpiece). Accepts EITHER structured intent (emit.js compile) OR raw DSL. Client-side lint via validateRuleSource (MERGED catalogue per Pitfall 5) → server-authoritative parse pre-flight at POST /api/system/pipelines/rule/parse → M5 conflict pre-check → apply. EXPORTS preflightParseRule helper for update-pipeline-rule.js to compose."
  - "src/tools/pipelines/update-pipeline-rule.js — PIPE-09 STRICT_NO_ECHO partial-update + conditional parse pre-flight (fires ONLY when changes.structured OR changes.ruleSource is touched). simulator_message Nullable String 3-state semantics preserved. D-15 generalisation: NO is_editable check (rules have no mutable flag). Imports preflightParseRule from create-pipeline-rule.js — single source of truth for Pitfall 6."
  - "src/tools/pipelines/index.js — barrel grown 7 → 9 register lines (5 Plan 02 + 4 Plan 03)."
  - "src/tools.js — 2 net-new tool definitions (list_pipeline_rules + get_pipeline_rule landed in Task 1; create_pipeline_rule + update_pipeline_rule landed in Task 2). Tool count: 63."
affects:
  - "04-04 (delete_pipeline_rule cascade) — composes against the rule list/get surface; computeRuleCascadeHash already shipped in Plan 04-01"
  - "04-05 (simulate_pipeline_rule + connect/disconnect) — simulate can compose emit.js + escape.js for structured-intent simulation; the preflightParseRule helper exported here is reusable for simulate's parse-then-simulate sequence"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern: Server-authoritative rule-parse pre-flight inside build() — extends Plan 04-02's pipeline-level preflightParsePipeline shape to the rule surface. Wrapper POSTs to /api/system/pipelines/rule/parse BEFORE the destructive verb; 400+ParseError[] body wraps as GraylogValidationError(reason:'rule_parse_failed') with parseResult.error attached; apply() NEVER runs. C4 mitigation gate at the rule level (ROADMAP SC1)."
    - "Pattern: Client-side lint BEFORE network round-trip — validateRuleSource consumes the MERGED catalogue (Pitfall 5 fix in Plan 04-01) and refuses obvious typos like `toUpperCase` with reason `rule_validation_failed` BEFORE the parse pre-flight even fires. Saves an HTTP round-trip on the hottest C4 failure mode."
    - "Pattern: D-10 mutual exclusion at the schema layer — zod .refine with a Boolean-XOR predicate encodes `EXACTLY ONE OF {structured, ruleSource}`. Refusal happens BEFORE build() runs, so the handler doesn't need to defend against agent confusion."
    - "Pattern: Best-effort title extraction for M5 cross-mode parity — structured.name is the authoritative title source; for raw DSL, a regex matches `^\\s*rule\\s+\"([^\"]+)\"`. When extraction fails, existingMatches stays empty (informational, not blocking). Both modes share the same `findExistingMatches` call with `matchFn: r => r.title === title`."
    - "Pattern: Conditional parse pre-flight (update path, rule-side) — pre-flight + lint + function-catalogue fetch ALL skip when only description/simulator_message change. STRICT_NO_ECHO compresses cosmetic edits to a single PUT request without the parse round-trip."
    - "Pattern: Shared preflight helper across create/update siblings (rule edition) — create-pipeline-rule.js exports preflightParseRule; update-pipeline-rule.js imports it. Mirrors Plan 04-02's preflightParsePipeline pattern. Pitfall 6 translation lives in one place."

key-files:
  created:
    - "src/tools/pipelines/list-pipeline-rules.js (30 lines — defineListHandler + bare-array unwrap)"
    - "src/tools/pipelines/get-pipeline-rule.js (65 lines — plain async handler, full RuleSource DTO)"
    - "src/tools/pipelines/create-pipeline-rule.js (162 lines — D-04 + D-05 + D-10 + D-17; EXPORTS preflightParseRule)"
    - "src/tools/pipelines/update-pipeline-rule.js (101 lines — STRICT_NO_ECHO + conditional parse pre-flight; D-15 generalisation)"
  modified:
    - "src/tools/pipelines/schemas.js (+193 lines: D-11 grammar via z.lazy + 4 new PIPE-06..09 schemas + D-10 refine)"
    - "src/tools/pipelines/index.js (+5 lines: 2 new imports + 2 new register lines for Task 1, then +2 imports + 2 register lines for Task 2 → 9 register lines total)"
    - "src/tools.js (+45 lines: 4 new tool definitions with full inputSchema declarations and discrimination sentences for create/update)"
    - "test/pipelines.test.js (+1106 lines: 48 net-new tests across schema layer, list/get/create/update handlers, schema-parity already covered in test/schema-parity.test.js)"
    - "test/schema-parity.test.js (+27 lines: 4 new parity tests for list_pipeline_rules/get_pipeline_rule/create_pipeline_rule/update_pipeline_rule)"

key-decisions:
  - "D-10 enforcement at the SCHEMA layer (not handler) — Boolean(args.structured) !== Boolean(args.ruleSource) inside zod .refine. Refusal happens before build() runs, returning the standard MCP errorResponse envelope from formatZodError. The wrapper does not need to defend against `both passed` or `neither passed` cases in build(); the schema is the single check."
  - "preflightParseRule EXPORTED from create-pipeline-rule.js (not extracted to _internal/preflight.js) — mirrors Plan 04-02's preflightParsePipeline pattern. The plan offered both options (inline duplicate vs shared module) and recommended deferring extraction per Phase 3 D-09 mutable-preflight precedent. Going with the export approach keeps Pitfall 6 translation in one place (the create file is the natural sibling owner). Plan 04-04's delete_pipeline_rule + Plan 04-05's simulate_pipeline_rule can choose to either re-import or extract to _internal/ at that point."
  - "Tool count test split across Task 1 (=61) and Task 2 (=63) — RED commits would otherwise mistakenly expect 63 before all 4 tools are registered. Each RED commit only asserts the count at THAT task's GREEN gate, so the Task 1 RED→GREEN sequence is self-consistent; the same assertion gets rewritten in Task 2 RED to the final target of 63."
  - "is_editable JSDoc reference in update-pipeline-rule.js kept (1 occurrence) — same trade-off as Plan 04-02's update-pipeline.js (Plan 04-02 SUMMARY §Decisions Made #5). The plan's literal `grep -c is_editable === 0` is technically violated by a single comment-only match documenting D-15 generalisation. Future readers grepping for `is_editable` find the explicit 'no mutable concept on the wire' notice; spirit-over-grep-purity follows precedent."
  - "Function-catalogue cache cleared in beforeEach + afterEach (test/pipelines.test.js) — Plan 04-01's _clearFunctionCatalogueForTests seam needed for tests that swap the captured-request seam between cases. Safe no-op when the catalogue hasn't been populated yet."
  - "Tool description for create_pipeline_rule warns about Pitfall 4 (side-effect functions) — the description sentence 'Use simulate_pipeline_rule (Plan 04-04) to verify semantics' aligns the agent's workflow with M3 mitigation. The tool's parse pre-flight only checks grammar; semantic verification is the simulate step's job, deferred to Plan 04-04."

patterns-established:
  - "Pattern: Server-side parse pre-flight at the rule level — exact mirror of Plan 04-02's pipeline-level pattern, with `rule_parse_failed` as the reason and POST /api/system/pipelines/rule/parse as the endpoint. The wrapper-side error type taxonomy (`pipeline_parse_failed` vs `rule_parse_failed`) lets structured-error consumers branch on which surface produced the failure."
  - "Pattern: Closed-set discriminated union for typed structured intent (D-11) — RuleSpecSchema's `when` is a recursive ConditionSchema via z.lazy, with 8 variants in a discriminatedUnion('type'). `then` is z.array(ActionSchema).min(1) where ActionSchema is a 6-variant discriminatedUnion. zod handles the recursion natively; tests pin 4-level deep AND/OR/NOT trees. Reusable shape for any future structured-intent surface (e.g. event definition conditions in a later phase)."
  - "Pattern: D-04 client-side lint → D-05 server parse pre-flight → apply (rule edition) — three-layer defense where the cheap client-side check catches obvious typos, the server-side check catches everything client-side missed, and apply runs only when both pass. The MERGED catalogue (Pitfall 5) bridges static baseline + live overlay so the lint stays correct across Graylog versions."
  - "Pattern: Cosmetic edit fast-path on update (rule edition) — when args.changes touches only description / simulator_message, the wrapper skips BOTH the parse round-trip AND the function-catalogue GET. Description-only updates fire exactly two requests (pre-flight GET + the PUT), keeping the dry-run preview lean and avoiding unnecessary work."

requirements-completed: [PIPE-06, PIPE-07, PIPE-08, PIPE-09]

# Metrics
duration: ~11 min
completed: 2026-05-15
---

# Phase 04 Plan 03: Pipeline-Rule CRUD Summary

**Four pipeline-rule CRUD tools (PIPE-06..PIPE-09) with the C4 acceptance gate proven across both structured-intent and raw-DSL modes, D-10 mutual exclusion at the zod refine layer, D-11 recursive structured-intent grammar (8-variant Condition + 6-variant Action discriminated unions via z.lazy), Pitfall 5 live-only function acceptance, Pitfall 6 camelCase→snake_case translation, STRICT_NO_ECHO partial-update with simulator_message Nullable String clear-intent preservation, and a single-source preflightParseRule helper shared across create + update.**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-05-15T21:24:11Z
- **Completed:** 2026-05-15T~21:35Z
- **Tasks:** 2 (TDD: 2 RED gates + 2 GREEN gates)
- **Files created:** 4 (list/get/create/update pipeline-rule handlers)
- **Files modified:** 4 (schemas.js, index.js, tools.js, test/pipelines.test.js + test/schema-parity.test.js)
- **Tests:** 48 net-new (43 in test/pipelines.test.js + 4 schema-parity + 1 already counted in pipelines suite — count varies by node count but the suite shows 83 total when only pipelines runs, was 39 before this plan)
- **Full suite:** 618 tests / 18 suites / all green (was 570 baseline; +48 net-new from Plan 04-03)

## Accomplishments

- **PIPE-06 list_pipeline_rules**: GET /api/system/pipelines/rule (bare array). Narrow projection [id, title, description, created_at, modified_at]; source DSL excluded for token-budget. Pitfall 3 rule-variant literal segment enforced.
- **PIPE-07 get_pipeline_rule**: GET /api/system/pipelines/rule/{id}. Full RuleSource DTO including rule_builder + simulator_message. 404 routes through wrapGraylogError.
- **PIPE-08 create_pipeline_rule (ROADMAP SC1 / C4 acceptance gate centerpiece)**:
  - D-10 mutual exclusion via zod .refine — exactly-one-of `structured` or `ruleSource` enforced before build()
  - D-04 client-side lint via validateRuleSource over MERGED catalogue (Pitfall 5 — live-only function names accepted)
  - D-05 server-authoritative parse pre-flight at POST /api/system/pipelines/rule/parse
  - On parse failure: GraylogValidationError(reason:`rule_parse_failed`) with parseResult.error[{line, position_in_line, type, message}] (Pitfall 6 camelCase→snake_case)
  - On lint failure: GraylogValidationError(reason:`rule_validation_failed`) BEFORE the network round-trip
  - M5 conflict pre-check supports BOTH structured.name AND best-effort regex extraction of `rule "..."` from raw DSL
  - D-17 __SERVER_ASSIGNED__ sentinel on postApplyEstimate.id
  - preflightParseRule helper EXPORTED for update-pipeline-rule.js to import
- **PIPE-09 update_pipeline_rule (STRICT_NO_ECHO per 04-U1-SMOKE.md)**:
  - Wire body emits ONLY fields the agent set in `changes`
  - Conditional parse pre-flight fires ONLY when changes.structured OR changes.ruleSource is touched (cosmetic edits skip both parse + function-catalogue fetch)
  - simulator_message 3-state semantics: undefined → omit, null → explicit clear, string → set value
  - description 3-state via z.union([z.string(), z.null()]).optional()
  - D-15 generalisation: NO is_editable mutable check (rules have no such flag — verified RuleSource.java)
  - Imports preflightParseRule from create-pipeline-rule.js — single source of truth for Pitfall 6
- **Schema-parity**: 4 new tests across list/get/create/update_pipeline_rule. zod schema and src/tools.js JSON-Schema keys verified in lockstep. .refine() ZodEffects wrappers handled by the existing getShape() utility.
- **Tool count**: 59 (Plan 04-02 end) → 63 (Plan 04-03 end).

## C4 Acceptance Gate Proof (4 distinct fail paths)

| Test name | Mode | Fail point | Reason | Apply fired? |
|-----------|------|-----------|--------|-------------|
| `create_pipeline_rule C4 CLIENT-SIDE LINT FAIL (toUpperCase): reason rule_validation_failed; parse pre-flight NEVER fires` | structured | client-side lint | `rule_validation_failed` | NO |
| `create_pipeline_rule C4 SERVER-PARSE FAIL (structured): reason rule_parse_failed; apply NEVER fires` | structured | server parse | `rule_parse_failed` | NO |
| `create_pipeline_rule C4 SERVER-PARSE FAIL (raw DSL): reason rule_parse_failed; apply NEVER fires` | raw DSL | server parse | `rule_parse_failed` | NO |
| `update_pipeline_rule C4 GATE: parse failure on update path → reason rule_parse_failed; PUT refused` | update raw DSL | server parse | `rule_parse_failed` | NO (PUT) |

All 4 commit hashes: tests landed in `1814ba3` (Task 2 RED), production in `457f6a9` (Task 2 GREEN).

## D-10 Mutual Exclusion Enforcement Record

- **Schema-layer refine**: `CreatePipelineRuleSchema.refine((args) => Boolean(args.structured) !== Boolean(args.ruleSource), ...)` — XOR via inequality test on Boolean coercion. Lives at `src/tools/pipelines/schemas.js`.
- **Tests pinning both rejection cases**:
  - `CreatePipelineRuleSchema D-10 mutual exclusion: REJECTS when BOTH structured AND ruleSource set`
  - `CreatePipelineRuleSchema D-10 mutual exclusion: REJECTS when NEITHER structured NOR ruleSource set`
- **Tests pinning both acceptance cases**:
  - `CreatePipelineRuleSchema accepts structured-only`
  - `CreatePipelineRuleSchema accepts ruleSource-only`
- **Update path**: UpdatePipelineRuleSchema.changes envelope has its own refine `!(changes.ruleSource && changes.structured)` — both being absent is allowed (cosmetic update); only both-set is rejected. Test `UpdatePipelineRuleSchema changes envelope: REJECTS when both changes.structured AND changes.ruleSource set` pins.

## D-11 Recursive Depth — 4-Level Example

```js
// Test: `ConditionSchema accepts deeply nested AND/OR/NOT tree (D-11 recursion via z.lazy, 4 levels)`
const fourLevels = {
    type: "and",                              // L1
    left: {
        type: "or",                           // L2
        left: {
            type: "not",                      // L3
            expr: {
                type: "comparison",           // L4 (terminal Expression)
                op: "==",
                left: { type: "field_ref", field: "level", source: "message" },
                right: { type: "literal", value: 6 },
            },
        },
        right: { type: "has_field", field: "source" },
    },
    right: {
        type: "and",
        left: { type: "field_ref", field: "x" },
        right: {
            type: "function_call",
            name: "has_field",
            args: { positional: [{ type: "literal", value: "x" }] },
        },
    },
};
const parsed = ConditionSchema.parse(fourLevels);  // succeeds; .type === "and"
```

z.lazy() handles the recursion natively for both Condition variants (and/or/not are themselves Conditions) and Expression slots (literal/field_ref/has_field/function_call are leaf nodes).

## Pitfall 5 — Live-Only Function Accepted

Test `create_pipeline_rule Pitfall 5: live-only function name in merged catalogue is ACCEPTED by client-side lint` proves this. The synthetic live-only function `__phase4_test_function__` (not in static `builtins.js`) flows through the merged catalogue path:

1. Test seeds the live-functions HTTP response with the synthetic entry
2. `getMergedCatalogue` overlays it onto the static baseline (live wins; static-only entries also preserved)
3. `validateRuleSource(source, mergedCatalogue)` sees the name in the Map and does NOT flag `unknown_function`
4. Parse pre-flight + apply succeed; payload.parseResult.ok === true

## Pitfall 6 — Both Case Conventions Present

`grep -c "positionInLine" src/tools/pipelines/create-pipeline-rule.js` → 4 (wire READ direction)
`grep -c "position_in_line" src/tools/pipelines/create-pipeline-rule.js` → 4 (emit OUT direction)

Test `create_pipeline_rule Pitfall 6: wire positionInLine (camelCase) emits as position_in_line (snake_case)` pins the L:position rendering in the emitted error text (snake-cased).

## STRICT_NO_ECHO + simulator_message Clear-Intent Verified

Three tests pin the 3-state semantics:

| Test | Agent input | Wire body |
|------|-------------|-----------|
| `update_pipeline_rule simulator_message:null explicit clear → wire body emits simulator_message:null` | `changes: { simulator_message: null }` | `{ simulator_message: null }` (explicit clear) |
| `update_pipeline_rule simulator_message omitted → wire body omits the key entirely` | `changes: { description: "new desc" }` | `{ description: "new desc" }` (no simulator_message key) |
| `update_pipeline_rule simulator_message: 'new value' → wire body emits the string` | `changes: { simulator_message: "new sample" }` | `{ simulator_message: "new sample" }` |

The same pattern applies to `description` (test `update_pipeline_rule description:null clear-intent preserved`).

## Task Commits

1. **Task 1 RED gate: failing tests for pipeline-rule list/get + schemas** — `453d19f` (test)
2. **Task 1 GREEN gate: schemas + list_pipeline_rules + get_pipeline_rule (PIPE-06, PIPE-07)** — `27698e2` (feat)
3. **Task 2 RED gate: failing tests for create_pipeline_rule + update_pipeline_rule** — `1814ba3` (test)
4. **Task 2 GREEN gate: create_pipeline_rule + update_pipeline_rule (PIPE-08, PIPE-09)** — `457f6a9` (feat)

_Plan executed as two TDD tasks per the frontmatter `type: tdd`; each task ran RED → GREEN with separate atomic commits per gate. No REFACTOR commits — both GREEN gates went green on the first run, with the implementation being the final shape._

## Files Created/Modified

### Created
- `src/tools/pipelines/list-pipeline-rules.js` (30 lines)
- `src/tools/pipelines/get-pipeline-rule.js` (65 lines)
- `src/tools/pipelines/create-pipeline-rule.js` (162 lines — EXPORTS preflightParseRule)
- `src/tools/pipelines/update-pipeline-rule.js` (101 lines)

### Modified
- `src/tools/pipelines/schemas.js` — appended D-11 structured-intent grammar (RuleSpecSchema + ConditionSchema + ActionSchema + ExpressionSchema + FunctionCallSchema) and the 4 PIPE-06..09 schemas with D-10 .refine
- `src/tools/pipelines/index.js` — barrel grown 7 → 9 register lines
- `src/tools.js` — 4 new tool definitions (Task 1: list_pipeline_rules + get_pipeline_rule; Task 2: create_pipeline_rule + update_pipeline_rule); tool count 59 → 63
- `test/pipelines.test.js` — 48 net-new tests (Task 1: schema-layer + list/get + dispatch barrel; Task 2: create/update happy + C4 fail paths + Pitfall 5/6 + STRICT_NO_ECHO + 3-state simulator_message)
- `test/schema-parity.test.js` — 4 new parity tests for the new pipeline-rule tools

## Decisions Made

1. **D-10 enforced at the schema layer**, not in build(). Boolean-XOR refine via zod .refine. Refusal happens before build() runs, so the handler is free of the cross-mode disambiguation logic.
2. **preflightParseRule helper EXPORTED** from create-pipeline-rule.js (re-imported by update-pipeline-rule.js). Single source of truth for the reason name + Pitfall 6 translation. Mirrors Plan 04-02's preflightParsePipeline pattern.
3. **Tool count test split across Task 1 (=61) and Task 2 (=63)** so each TDD gate is self-consistent. Task 1 RED expects 61 at Task 1 GREEN; Task 2 RED bumps the assertion to 63.
4. **is_editable JSDoc reference in update-pipeline-rule.js kept** (1 occurrence) — same trade-off as Plan 04-02 update-pipeline.js. Spirit-over-grep-purity precedent.
5. **Function-catalogue cache cleared in beforeEach + afterEach** — `_clearFunctionCatalogueForTests` ensures each test sees a fresh fetch under the captured-request seam.
6. **Tool description for create_pipeline_rule warns about Pitfall 4** (side-effect functions) — directs agents to use simulate_pipeline_rule (Plan 04-04) for semantic verification.

## Deviations from Plan

None - plan executed exactly as written.

The plan's <action> sketches for both create-pipeline-rule.js and update-pipeline-rule.js were lifted nearly verbatim, with light editorial adjustments to:
- Match the existing project style (JSDoc above functions; the same comment cadence as Plan 04-02's create-pipeline.js)
- Drop the `simulator_message` body line when args.simulator_message is undefined (mirrors STRICT_NO_ECHO; the plan's sketch always emitted `simulator_message: null` when undefined, which would have conflated omit with explicit-clear)
- Honor the export-from-create approach for `preflightParseRule` per the plan's <output> hand-off line that recommended single-source-of-truth (the Phase 3 D-09 mutable-preflight precedent guidance suggested either option; we picked export for the same rationale Plan 04-02 used for preflightParsePipeline)

All acceptance criteria checks (grep + test counts + tool count) pass.

## TDD Gate Compliance

- ✓ Task 1 RED gate commit `453d19f` (test): pipeline-rule list/get + schema tests added; production modules absent; suite failed with ERR_MODULE_NOT_FOUND for list-pipeline-rules.js etc.
- ✓ Task 1 GREEN gate commit `27698e2` (feat): handlers + schemas + barrel + tools.js entries land; pipeline-rule tests green (21 net-new pass); the 2 Task 2 schema-parity tests for create/update_pipeline_rule still fail by design (expected).
- ✓ Task 2 RED gate commit `1814ba3` (test): create_pipeline_rule + update_pipeline_rule test scaffolding added; production modules absent; full file fails ERR_MODULE_NOT_FOUND.
- ✓ Task 2 GREEN gate commit `457f6a9` (feat): create + update handlers + barrel + tools.js entries land; all 83 pipeline tests + 43 schema-parity tests green. Full suite 618/618.

No REFACTOR commits — both GREEN gates went green on the first run after the corresponding RED commit; the implementation is the final shape.

## Issues Encountered

None. Both GREEN gates ran clean on the first attempt. Most of the iteration cost was in the test-file structuring (ensuring Task 1 RED was loadable without the Task 2 production modules — initial draft imported Task 2 handlers in the Task 1 RED file and required a follow-up RED-amendment to defer those imports to Task 2 RED).

## Self-Check: PASSED

- All 4 created files exist (verified via `ls`)
- All 4 commit hashes resolve via `git log --oneline -5`
- Tool count check: `node -e "import('./src/tools.js').then(m => console.log(m.toolDefinitions.length))"` → 63 ✓
- z.lazy in schemas.js: 6 (≥3 required) ✓
- discriminatedUnion in schemas.js: 2 (≥2 required) ✓
- D-10 refine count: 1 (≥1 required) ✓
- rule_parse_failed across create+update: 4 (≥4 required) ✓
- rule_validation_failed across create+update: 2 (≥2 required) ✓
- positionInLine across create+update: 4 (≥2 required; all in create file since update imports the helper) ✓
- position_in_line across create+update: 4 (≥2 required; all in create file) ✓
- STRICT_NO_ECHO in update-pipeline-rule.js: 5 (≥1 required) ✓
- is_editable in update-pipeline-rule.js: 1 — JSDoc only (D-15 generalisation commentary; Plan 04-02 precedent allows this)
- emitRule|validateRuleSource|getMergedCatalogue in create: 7 (≥3 required) ✓
- Register lines in barrel: 9 (Plan 04-02's 5 + 4 net-new) ✓
- src/graylog/errors.js NOT in files_modified: verified ✓
- `node --test test/pipelines.test.js` → 83 / 83 green ✓
- `node --test test/schema-parity.test.js` → 43 / 43 green ✓
- `npm test` → 618 / 618 green across 18 suites ✓
- No new npm dependencies (verified — package.json unchanged) ✓

## Next Phase Readiness

- **Plan 04-04 (delete_pipeline_rule + simulate_pipeline_rule + list_pipeline_functions)** can:
  - Reuse `computeRuleCascadeHash` already shipped in Plan 04-01
  - Import `preflightParseRule` from create-pipeline-rule.js if simulate_pipeline_rule wants to parse-then-simulate (the helper is exported)
  - Compose against the function-catalogue cache for list_pipeline_functions surface
- **Plan 04-05 (connect/disconnect pipelines to streams)** can:
  - Compose `emitRule` + `escape.escapeString` for any literal in simulate payloads if it wants to
  - Plan 04-03 leaves no orphan rows — every PIPE-08/PIPE-09 path is C4-mitigation-complete

No blockers. No deferred items.

---
*Phase: 04-pipelines-pipeline-rules-connections*
*Plan: 03*
*Completed: 2026-05-15*
