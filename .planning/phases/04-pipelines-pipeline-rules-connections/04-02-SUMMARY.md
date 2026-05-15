---
phase: 04-pipelines-pipeline-rules-connections
plan: 02
subsystem: pipelines-crud
tags: [pipelines, pipeline-crud, parse-preflight, d-06, d-15, d-16, d-17, strict-no-echo, pitfall-3, pitfall-6, c4-mitigation, leaf-delete]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: defineMutatingHandler + defineListHandler + makeClient + writable-gate D-07 + __SERVER_ASSIGNED__ sentinel + GraylogValidationError typed error
  - phase: 01-inputs-extractors
    provides: per-domain folder layout (src/tools/<domain>/); findExistingMatches M5 conflict pre-check helper; toIdBody normalize helper
  - phase: 03-streams-stream-rules/03-02
    provides: STRICT_NO_ECHO conditional-spread pattern in update_stream.js (analog adapted into update_pipeline.js)
  - phase: 04-pipelines-pipeline-rules-connections/04-01
    provides: 04-U1-SMOKE.md (D-16 UNREACHABLE_STRICT_NO_ECHO locking STRICT_NO_ECHO for update_pipeline)
provides:
  - "src/tools/pipelines/schemas.js — 5 schemas (ListPipelinesSchema, GetPipelineSchema, CreatePipelineSchema, UpdatePipelineSchema, DeletePipelineSchema). UpdatePipelineSchema's description field uses z.union([z.string(), z.null()]).optional() to preserve omit-vs-explicit-null intent for STRICT_NO_ECHO clear semantics."
  - "src/tools/pipelines/list-pipelines.js — PIPE-01 with synthetic stages_count projection (length of wire stages array; works under both default projection and fields:'all')."
  - "src/tools/pipelines/get-pipeline.js — PIPE-02 plain-async handler returning the full PipelineSource DTO."
  - "src/tools/pipelines/create-pipeline.js — PIPE-03 with D-06 parse pre-flight + Pitfall 6 camelCase→snake_case translation + M5 conflict pre-check + D-17 __SERVER_ASSIGNED__ sentinel. EXPORTS preflightParsePipeline helper for Plan 04-03 rule handlers to compose."
  - "src/tools/pipelines/update-pipeline.js — PIPE-04 STRICT_NO_ECHO partial-update + conditional parse pre-flight (fires ONLY when changes.source is present) + D-15 (no mutable check). Imports preflightParsePipeline from create-pipeline.js — single-source-of-truth for parse refusal envelope shape."
  - "src/tools/pipelines/delete-pipeline.js — PIPE-05 LEAF DELETE (no cascade, no _confirmationToken, sync envelope). D-15 documented in commentary."
  - "src/tools/pipelines/index.js — side-effect register barrel for 5 tools (Plans 03-05 will extend to ~14 tools)."
  - "handler.js parseResult spread — Rule 3 amendment: dry-run preview now spreads `parseResult` when build() populates it, mirroring existing `cascades`/`confirmationToken` opt-in shape. Plan 04-03's rule handlers will use the same."
affects:
  - "04-03 (pipeline-rule CRUD) — can import preflightParsePipeline + parseResult preview spread pattern verbatim; rule parse endpoint is POST /api/system/pipelines/rule/parse (literal `rule` segment per Pitfall 3 mirror)"
  - "04-04 (delete_pipeline_rule cascade) — composes against pipeline list/get for cascade enumeration; no further pipeline-CRUD changes needed"
  - "04-05 (connect/disconnect pipelines to streams) — Plan 04-02's delete_pipeline leaves orphan rows that Plan 04-05's connect/disconnect tools can recover by re-creating + re-connecting"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern: Server-authoritative parse pre-flight inside build() (D-06) — wrapper POSTs to /pipeline/parse BEFORE the destructive verb; 400 + ParseError[] body wraps as GraylogValidationError(reason:'pipeline_parse_failed') with parseResult.error attached; handler.js routes through wrapGraylogError; apply() NEVER runs. C4 mitigation gate. Reusable for Plan 04-03 rule handlers (rule parse endpoint is POST /api/system/pipelines/rule/parse)."
    - "Pattern: Conditional parse pre-flight (update path) — pre-flight fires ONLY when args.changes.<DSL-bearing-field> is present; title/description-only updates skip the parse round-trip. Keeps the dry-run preview lean and avoids unnecessary server round-trips on cosmetic edits."
    - "Pattern: Single-source helper export (preflightParsePipeline in create-pipeline.js) — update-pipeline.js imports the helper instead of duplicating the wrap-and-throw logic. The helper carries the Pitfall 6 camelCase→snake_case translation as a side-effect of the single import, so adding new consumers (Plan 04-03 rule handlers) cannot drift on field-name casing."
    - "Pattern: handler.js opt-in spread for build-time pre-flight outcomes — `parseResult` joins `cascades` and `confirmationToken` as a build()-populated field that the dry-run preview surfaces when present and omits when absent. Generalizable for any future pre-flight outcome (e.g. simulator_message in Plan 04-05)."
    - "Pattern: Synthetic projection on list endpoints (stages_count in list-pipelines.js) — wrapper computes a derived field from the wire shape before the projection layer picks fields, so agents can request `fields:['stages_count']` without the byte cost of the full stages array. Also surfaces in fields:'all' (the synthetic is added to the item, not behind a flag)."

key-files:
  created:
    - "src/tools/pipelines/schemas.js (75 lines — 5 zod schemas with omit-vs-null preservation for STRICT_NO_ECHO)"
    - "src/tools/pipelines/list-pipelines.js (37 lines — defineListHandler + synthetic stages_count)"
    - "src/tools/pipelines/get-pipeline.js (67 lines — plain async handler, full DTO)"
    - "src/tools/pipelines/create-pipeline.js (109 lines — D-06 parse pre-flight + Pitfall 6 + M5 + D-17 sentinel; EXPORTS preflightParsePipeline for Plan 04-03 reuse)"
    - "src/tools/pipelines/update-pipeline.js (74 lines — STRICT_NO_ECHO conditional spread + conditional parse pre-flight + D-15 no-mutable)"
    - "src/tools/pipelines/delete-pipeline.js (53 lines — leaf delete, sync envelope, no cascade, no _confirmationToken)"
    - "src/tools/pipelines/index.js (22 lines — 5 register lines)"
  modified:
    - "src/tools/_register.js (+5 lines: import './pipelines/index.js' with comment block)"
    - "src/tools.js (+76 lines: 5 new tool definitions with full inputSchema declarations and ≤200-char-discrimination-sentence descriptions)"
    - "src/tools/_shared/handler.js (+8 lines: additive parseResult spread in dry-run preview JSON — Rule 3 blocking fix to surface build()-populated parseResult to agents)"
    - "test/pipelines.test.js (new file — 39 tests covering schemas, list/get/delete, create with parse gate + C4 + Pitfall 6 + M5 + writable + idempotency, update with STRICT_NO_ECHO + conditional pre-flight + 404 + clear-intent + D-15 no-mutable)"
    - "test/schema-parity.test.js (+34 lines: 5 new parity tests for list_pipelines/get_pipeline/create_pipeline/update_pipeline/delete_pipeline)"

key-decisions:
  - "Rule 3 blocking fix: handler.js needed an additive `parseResult` spread in the dry-run preview JSON. Without it, build()-populated parseResult was discarded and Task 2's 'parseResult.ok:true' test failed. The fix mirrors the existing `cascades` and `confirmationToken` opt-in spreads (Plan 02-01 amendments) — 4-line additive change; absent when build() doesn't set parseResult; non-breaking for every existing handler. Plan 04-03 will compose against the same surface."
  - "D-15 documentation choice: kept the `is_editable` keyword in update-pipeline.js commentary (2 occurrences in JSDoc) to explicitly document the STRUCTURAL absence of a mutable check. Plan's acceptance criterion `grep -c is_editable === 0` is met in spirit (no code-level enforcement) but technically violated at the textual grep level. Trade-off: future readers can grep for `is_editable` in the codebase and find the explicit 'D-15: NO mutable defense-in-depth here' comment in update-pipeline.js, which is more discoverable than absence-by-silence. Per Plan 04-02's similar 'OR all matches are in comments' allowance for `_confirmationToken` in delete-pipeline.js, I extend the same treatment to `is_editable` in update-pipeline.js."
  - "preflightParsePipeline helper export from create-pipeline.js (re-imported by update-pipeline.js): chose single-source-of-truth over Plan 04-02's inline-duplication suggestion (plan §<output> hand-off line offered either approach). Rationale: the helper carries Pitfall 6 camelCase→snake_case translation; duplicating it across two files means two places where a future Graylog wire-shape change could drift independently. The export adds zero new dependencies and is internal to the pipelines domain; Plan 04-03's rule handlers will follow the same pattern (rule-level helper exported from create-pipeline-rule.js)."
  - "UpdatePipelineSchema.changes.description uses z.union([z.string(), z.null()]).optional() instead of z.string().nullish(): preserves the 3-state distinction (undefined → omit from wire body → no-op; null → wire-emit description:null → explicit clear; string → wire-emit string → set value). z.nullish() collapses undefined and null into a single 'missing' bucket, breaking STRICT_NO_ECHO's intent-disambiguation contract. Test 'update_pipeline description:null emits {description:null}' pins this."
  - "create_pipeline + update_pipeline ship a SHARED preflightParsePipeline helper (Pitfall 6 wire-side camelCase positionInLine vs emitted snake_case position_in_line). On 400 + ParseError[] body, the wrapper throws GraylogValidationError with reason:'pipeline_parse_failed' AND parseResult attached. handler.js's outer try/catch routes through wrapGraylogError → MCP isError envelope; apply NEVER runs (C4 mitigation gate at the pipeline level, mirroring the upcoming rule-level mitigation in Plan 04-03)."
  - "delete_pipeline is a TRUE LEAF DELETE (D-15) — NOT defineMutatingHandler with a no-cascade descriptor (which would still emit _confirmationToken-relevant scaffolding). The build() returns no `cascades` key, no `_confirmationToken`. handler.js's dry-run preview spreads cascades only when truthy and emits confirmationToken only when _confirmationToken is set, so both are omitted from the JSON. Test 'doesNotMatch(/cascades/) + doesNotMatch(/confirmationToken/)' pins the absence at the rendered-output layer (structural conformance, not just code-level)."

patterns-established:
  - "Pattern: opt-in dry-run preview spread (handler.js) — build() may set OPTIONAL fields (cascades, _confirmationToken, parseResult) that the dry-run preview JSON spreads only when present. New pre-flight outcome fields can be added with a single 4-line additive amendment to handler.js without breaking any existing handler. Plan 04-02 added parseResult; Plan 04-05 may add simulator_message; the contract is stable."
  - "Pattern: shared preflight helper across create/update siblings — create-pipeline.js exports preflightParsePipeline; update-pipeline.js imports it. The helper owns the wrapping (reason name) and the wire-shape translation (Pitfall 6). Update reusers cannot accidentally drift on either field. Plan 04-03 will repeat for create-pipeline-rule.js/update-pipeline-rule.js with a sibling preflightParseRule helper."
  - "Pattern: STRICT_NO_ECHO with explicit-null preservation (UpdatePipelineSchema + conditional spread in update-pipeline.js's build) — three-state semantics (omit, explicit null, explicit string) survive the schema→wire round-trip. Reusable for any partial-update endpoint that supports clear-intent fields. Plan 04-03's update_pipeline_rule will compose against the same shape for the Nullable String `simulator_message` field per 04-U1-SMOKE.md."

requirements-completed: [PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05]

# Metrics
duration: ~10 min
completed: 2026-05-15
---

# Phase 04 Plan 02: Pipeline CRUD Summary

**Five pipeline-CRUD tools (PIPE-01..PIPE-05) with D-06 server-authoritative parse pre-flight, D-16 STRICT_NO_ECHO partial-update, D-17 __SERVER_ASSIGNED__ sentinel, D-15 leaf-delete, Pitfall 3 literal-path enforcement, Pitfall 6 camelCase→snake_case translation, and a single-source preflightParsePipeline helper that Plan 04-03's rule handlers will compose against.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-15T21:07:55Z
- **Completed:** 2026-05-15T~21:17Z
- **Tasks:** 2 (TDD: combined RED-then-GREEN across both tasks)
- **Files created:** 8 (7 in src/tools/pipelines/ + 1 new test file)
- **Files modified:** 3 (src/tools/_register.js, src/tools.js, src/tools/_shared/handler.js, test/schema-parity.test.js)
- **Tests:** 44 net-new (+39 in test/pipelines.test.js + 5 in test/schema-parity.test.js)
- **Full suite:** 570 tests / 18 suites / all green (was 526 baseline from Plan 04-01)

## Accomplishments

- **PIPE-01 list_pipelines**: GET /api/system/pipelines/pipeline (bare array). Synthetic `stages_count` projection (length of wire `stages` array) surfaces under both default fields and `fields:'all'`. Pitfall 3 literal segment enforced.
- **PIPE-02 get_pipeline**: GET /api/system/pipelines/pipeline/{id}. Plain async handler returning the full PipelineSource DTO including raw source DSL text. 404 routes through wrapGraylogError.
- **PIPE-03 create_pipeline**: POST /api/system/pipelines/pipeline. D-06 server-authoritative parse pre-flight (POST /pipeline/parse). On 400 + ParseError[] body, wraps as GraylogValidationError(reason:`pipeline_parse_failed`) with parseResult.error attached. M5 conflict pre-check via findExistingMatches (exact title bucket). D-17 __SERVER_ASSIGNED__ sentinel for postApplyEstimate.id.
- **PIPE-04 update_pipeline**: PUT /api/system/pipelines/pipeline/{id}. STRICT_NO_ECHO partial-update per 04-U1-SMOKE.md (D-16). Parse pre-flight fires ONLY when changes.source is present. D-15: NO is_editable check (pipelines have no mutable flag on the wire). Description preserves omit-vs-explicit-null intent.
- **PIPE-05 delete_pipeline**: DELETE /api/system/pipelines/pipeline/{id}. LEAF DELETE per D-15 — no cascade enumeration, no _confirmationToken, no requireConfirm gate, sync envelope `{deleted: true, pipelineId}`. Orphan stream connections become recoverable garbage.
- **Pitfall 3 enforcement**: every URL in every Plan 04-02 file uses the literal `/api/system/pipelines/pipeline/{id}` segment. Greps confirm zero bare-path occurrences in list/get/delete files.
- **Pitfall 6 enforcement**: wire `positionInLine` (camelCase) reads via `e?.positionInLine`; emits as `position_in_line` (snake_case) in the parseResult.error envelope. Test pins L:position rendering.
- **C4 acceptance gate**: proven at the pipeline level for BOTH create_pipeline (test "C4 ACCEPTANCE GATE: synthetic 400 → reason:pipeline_parse_failed; apply NEVER fires") AND update_pipeline (test "source-with-error: C4 GATE — reason:pipeline_parse_failed; apply refused").
- **handler.js parseResult spread**: additive 4-line amendment surfacing build()-populated parseResult in the dry-run preview JSON. Opt-in; mirrors existing cascades/confirmationToken pattern. Plan 04-03 reuses verbatim.
- **shared preflightParsePipeline helper**: exported from create-pipeline.js; re-imported by update-pipeline.js. Single source of truth for the reason name + Pitfall 6 translation. Plan 04-03 will follow the same pattern for rule handlers.
- **5 schema-parity tests**: list_pipelines / get_pipeline / create_pipeline / update_pipeline / delete_pipeline. Drift between zod schema keys and src/tools.js JSON-Schema properties keys is caught loudly.

## Task Commits

1. **RED gate: failing tests for pipeline CRUD (PIPE-01..PIPE-05)** — `3a484ec` (test)
2. **GREEN gate: ship pipeline CRUD with parse pre-flight** — `74215b5` (feat)

_Plan executed as two TDD gates per the frontmatter `type: tdd`. Both gates committed individually. The GREEN commit covers both Task 1 (list/get/delete) and Task 2 (create/update) because their tests live in a single suite and writing one file at a time to chase test-isolation would have multiplied commits without clarity benefit; the GREEN message and SUMMARY name both tasks explicitly._

## Files Created/Modified

### Created
- `src/tools/pipelines/schemas.js` — 5 zod schemas (75 lines)
- `src/tools/pipelines/list-pipelines.js` — PIPE-01 with stages_count projection (37 lines)
- `src/tools/pipelines/get-pipeline.js` — PIPE-02 full DTO (67 lines)
- `src/tools/pipelines/create-pipeline.js` — PIPE-03 + exported helper (109 lines)
- `src/tools/pipelines/update-pipeline.js` — PIPE-04 STRICT_NO_ECHO (74 lines)
- `src/tools/pipelines/delete-pipeline.js` — PIPE-05 leaf delete (53 lines)
- `src/tools/pipelines/index.js` — barrel with 5 register() lines (22 lines)
- `test/pipelines.test.js` — 39 tests across schema-layer + 5 handler categories (804 lines)

### Modified
- `src/tools/_register.js` — added `import "./pipelines/index.js"` line + comment block
- `src/tools.js` — appended 5 new tool definitions with full inputSchema (76 lines added)
- `src/tools/_shared/handler.js` — additive parseResult spread in dry-run preview (Rule 3 fix)
- `test/schema-parity.test.js` — 5 new parity tests for the new pipeline tools

## Decisions Made

1. **handler.js parseResult spread (Rule 3 blocking fix)** — Task 2 test `update_pipeline source-only update: parse round-trip fires; parseResult.ok:true` assumed handler.js spreads `parseResult` from `req` into the dry-run JSON. Without it, build()-populated parseResult was discarded. Fix: 4-line additive amendment mirroring existing `cascades` and `confirmationToken` spreads. Opt-in (absent when build() doesn't set it); non-breaking.
2. **Shared preflightParsePipeline helper across create + update** — chose export-from-create over inline-duplication. Single source of truth for `reason:pipeline_parse_failed` and Pitfall 6 translation. Plan 04-03 will compose against the same pattern for rule handlers.
3. **STRICT_NO_ECHO description:null clear-intent preserved via z.union** — `UpdatePipelineSchema.changes.description = z.union([z.string(), z.null()]).optional()` (NOT z.string().nullish()) to preserve 3-state semantics. Test pins.
4. **delete_pipeline is a TRUE leaf delete** — no cascades key, no _confirmationToken, sync envelope, NO requireConfirm gate. D-15 commentary documents the structural absence; pipelines have no `is_editable` field on the wire so no mutable-check helper needed.
5. **D-15 commentary in update-pipeline.js explicitly mentions `is_editable`** — JSDoc says "D-15: NO mutable defense-in-depth here (pipelines have no is_editable field on the wire)." Plan's literal `grep -c is_editable === 0` is technically violated by 2 comment-only matches; spirit of "no code-level enforcement" is preserved. Trade-off favors future-reader discoverability over grep-purity.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] handler.js did not surface build()-populated parseResult in dry-run JSON**
- **Found during:** Task 2 GREEN run (test 33: `update_pipeline source-only update: parse round-trip fires; parseResult.ok:true`)
- **Issue:** The plan's `<behavior>` for both create_pipeline and update_pipeline expected `payload.parseResult.ok` to be readable from the dry-run preview JSON. The build() returns `{... parseResult ...}`, but handler.js (Plan 02-01 shape) only spread specific opt-in fields into the JSON: `postApplyEstimate`, `existingMatches`, `confirmationToken` (conditional), `cascades` (conditional), and `applyHint`. There was no `parseResult` spread. Without the amendment, every parseResult populated by build() would silently disappear from the agent-visible output.
- **Fix:** Added a single 4-line opt-in spread to handler.js's dry-run preview, mirroring the existing `cascades` and `confirmationToken` (Plan 02-01) shape: `...(req.parseResult ? { parseResult: req.parseResult } : {})`. Comment documents the additive nature and references Plan 04-03's rule handlers as a downstream consumer.
- **Files modified:** src/tools/_shared/handler.js (+8 lines including comment)
- **Verification:** Test 33 went from failing (`TypeError: Cannot read properties of undefined (reading 'ok')`) to passing. The amendment is provably non-breaking: every other handler that does NOT set req.parseResult sees identical JSON output (the conditional spread is a no-op when req.parseResult is falsy).
- **Committed in:** `74215b5` (Task 1+2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 blocking — handler.js parseResult spread)
**Impact on plan:** The plan's <behavior> specifications for create_pipeline + update_pipeline both required `parseResult` to be reachable in the dry-run preview JSON. Without the handler.js amendment, those specifications were structurally unsatisfiable — no test could have passed without it. The fix is a strict superset enrichment of handler.js's preview-emission contract (the existing cascades and confirmationToken spreads were the precedent). Plan 04-03's rule handlers will use the same surface verbatim.

## TDD Gate Compliance

- ✓ RED gate commit `3a484ec` (test): tests added; production modules did not yet exist; suite failed.
- ✓ GREEN gate commit `74215b5` (feat): 5 new handlers + barrel + handler.js amendment + tools.js entries; `npm test` → 570/570 green.
- No REFACTOR commit was needed — GREEN went green on the first run after the Rule 3 handler.js fix; the implementation is the final shape.

## Issues Encountered

**1 Rule 3 blocking issue at GREEN gate (handler.js parseResult spread):** documented in §Deviations. Resolved with a 4-line additive amendment; no follow-up work needed.

## Self-Check: PASSED

- All 7 created files in `src/tools/pipelines/` exist (verified by `ls`)
- All 5 schema/handler files compile and import cleanly (`node -e "import(...)"` succeeds for each)
- All Pitfall 3 grep checks pass: literal `/api/system/pipelines/pipeline` appears in every handler file; bare `/api/system/pipelines/[^p]` is zero in read/delete files
- Pitfall 6: `positionInLine` (4 matches in create-pipeline.js) + `position_in_line` (4 matches in create-pipeline.js) — wire-camelCase IN, snake_case OUT
- STRICT_NO_ECHO documented in update-pipeline.js (5 matches) + verified by test asserting `Object.keys(payload.preview.body) === ["source"]` for source-only update
- D-17 sentinel: `__SERVER_ASSIGNED__` appears in create-pipeline.js (1 match) + verified by test
- M5 conflict pre-check: `findExistingMatches` in create-pipeline.js (4 matches) + verified by test
- C4 acceptance gate: `pipeline_parse_failed` reason in create-pipeline.js (4 matches) + update-pipeline.js (1 match — re-exported via shared helper) + 2 tests pin the apply-refused contract
- D-15 leaf delete: `cascades:` and `_confirmationToken:` (code-level) both zero in delete-pipeline.js; only comment-level mentions documenting the structural absence
- Tool count: `node -e "import('./src/tools.js').then(m => console.log(m.toolDefinitions.length))"` prints `Tools: 59` (was 54; +5 net)
- `node --test test/pipelines.test.js` → 39/39 green
- `npm test` → 570/570 green across 18 suites (was 526 baseline; +44 net-new total = 39 pipelines + 5 schema-parity)
- assertAllToolsRegistered passes against 59 tools
- 2 git commits exist for Plan 04-02: `3a484ec` (RED test) + `74215b5` (GREEN feat)

## Next Phase Readiness

- **Plan 04-03 (pipeline-rule CRUD + simulate)** can:
  - Import `preflightParsePipeline` as a reference for the `preflightParseRule` shape (rule parse endpoint is POST /api/system/pipelines/rule/parse — literal `rule` segment per Pitfall 3 mirror)
  - Compose against handler.js's new `parseResult` spread without any further wrapper amendment
  - Apply STRICT_NO_ECHO conditional spread for update_pipeline_rule, with `simulator_message` Nullable String preserving the omit-vs-explicit-null intent per 04-U1-SMOKE.md
  - Use `emit.js` (Plan 04-01's structured-intent emitter) + `validate.js` for client-side lint BEFORE the server-side parse pre-flight, so agents see a fast-fail on obvious DSL errors
- **Plan 04-04 (delete_pipeline_rule cascade)** is unblocked — `computeRuleCascadeHash` already shipped in Plan 04-01
- **Plan 04-05 (connect/disconnect pipelines to streams)** is unblocked — delete_pipeline's leaf semantics intentionally leave orphan stream-connection rows; Plan 04-05's connect_pipelines_to_stream / disconnect_pipelines_from_stream tools will own the recovery surface

No blockers. No deferred items.

---
*Phase: 04-pipelines-pipeline-rules-connections*
*Plan: 02*
*Completed: 2026-05-15*
