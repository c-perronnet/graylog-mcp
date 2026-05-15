---
phase: 03-streams-stream-rules
plan: 02
subsystem: api
tags: [streams, create-stream, update-stream, start-stream, pause-stream, stream-rules, create-entity-request, strict-no-echo, d-09-mutable, d-12-lifecycle-as-mutation, d-13-server-assigned, d-14-strict-no-echo, pitfall-s7, pitfall-s9, pitfall-s10, similarity-buckets, m5-mitigation]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: defineMutatingHandler (D-07 writable gate + dryRun-default + __SERVER_ASSIGNED__ + idempotency + normalize), makeClient, GraylogValidationError, toIdBody, mutatingBase
  - phase: 01-inputs-extractors/01-02
    provides: STRICT_NO_ECHO pattern (update_input precedent — D-12); 8-variant input-type variantMap pattern adapted for the 8-variant stream-rule discriminated union
  - phase: 01-inputs-extractors/01-03
    provides: lifecycle-as-mutation through defineMutatingHandler (start_input/stop_input precedent — D-08 → D-12 here)
  - phase: 02-index-sets-retention/02-01
    provides: streams envelope branch in findExistingMatches conflict.js (shipped Plan 02-01 for Phase 3 use)
  - phase: 03-streams-stream-rules/03-01
    provides: src/tools/streams/schemas.js Plan-01 SUBSET (ListStreamsSchema/GetStreamSchema/ListStreamRulesSchema), src/tools/streams/index.js register barrel, 03-U1-SMOKE.md UNREACHABLE_STRICT_NO_ECHO decision artifact locking STRICT_NO_ECHO for update_stream
provides:
  - "src/tools/streams/schemas.js — 8-variant StreamRuleSchema discriminated union (exact|regex|greater|less|present|contains|always_match|match_input), STREAM_RULE_TYPE_TO_NUMERIC Object.frozen wire map (1..8), SimilarityReasonEnum closed-set (exact|case_insensitive|prefix), CreateStreamSchema (D-10 index_set_id required), UpdateStreamSchema ({streamId, changes} STRICT_NO_ECHO envelope), StartStreamSchema, PauseStreamSchema"
  - "src/tools/streams/create-stream.js — STREAM-03 ships M5 mitigation: CreateEntityRequest envelope wrap + 3-bucket existingMatches via classifySimilarity helper (strictest-wins) + numeric rule translation via STREAM_RULE_TYPE_TO_NUMERIC + D-13 __SERVER_ASSIGNED__ sentinel + toIdBody with idFields:['stream_id','id']"
  - "src/tools/streams/update-stream.js — STREAM-04 ships D-14 STRICT_NO_ECHO wire-build (per 03-U1-SMOKE.md UNREACHABLE_STRICT_NO_ECHO) + D-09 mutable defense-in-depth pre-flight reading canonical wire is_editable; refuses with err.reason='stream_immutable' BEFORE PUT"
  - "src/tools/streams/start-stream.js — STREAM-06a POST /api/streams/{id}/resume with body undefined + D-09 mutable pre-flight; D-12 lifecycle-as-mutation through defineMutatingHandler"
  - "src/tools/streams/pause-stream.js — STREAM-06b POST /api/streams/{id}/pause mirror"
affects: ["03-03 (delete_stream — same _testConnection + streamsMultiCapture test pattern; CreateStreamSchema's existingMatches contract is the reference shape for cascade-preview JSON; D-09 pattern lifted verbatim)", "03-04 (stream-rule CRUD — STREAM_RULE_TYPE_TO_NUMERIC already shipped, consumed by create_stream_rule + update_stream_rule build callbacks; StreamRuleSchema 8-variant union already validated)", "03-05 (Phase 3 polish — snapshot fixtures for the 4 dry-run preview shapes; create_stream's existingMatches shape is the most snapshot-worthy)", "phase 04 (lifecycle pattern: any future POST /{resource}/{id}/{action} tool reuses the start/pause shape)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CreateEntityRequest envelope wrapping: when Graylog wraps a create request in `{ entity: {...}, share_request: null }` (verified at StreamResource.java:229-230), build() emits the envelope structurally while keeping the agent-facing flat schema. share_request:null is the explicit wire-shape constant — the wrapper does not derive it from agent input."
    - "Strictest-bucket-wins similarity classifier (D-05/D-06): classifySimilarity(proposed, existing) returns 'exact' > 'case_insensitive' > 'prefix' > null. Closed-set zod enum (SimilarityReasonEnum) enforces the 3-bucket contract at the schema layer; findExistingMatches' similarityReason callback consumes the classifier output and drops null matches."
    - "STRICT_NO_ECHO wire-build with conditional-spread: `wireBody = { ...(args.changes.field !== undefined ? { field: args.changes.field } : {}) }` preserves agent intent — passing `description: null` emits `description: null` (clear intent) while omitting `description` emits nothing (no change)."
    - "Object.frozen alias-to-int wire map (Pitfall S9): STREAM_RULE_TYPE_TO_NUMERIC is `Object.freeze({exact:1, regex:2, ...})` so accidental runtime mutation is caught loudly. Schema-layer zod discriminator + frozen map = two independent layers preventing an off-map type from reaching the wire."
    - "Lifecycle-as-mutation through defineMutatingHandler (D-12): start_stream + pause_stream are NOT special-cased runtime tools. They compose through the same factory as create/update/delete so dryRun + writable gate + idempotency inherit uniformly. The only deltas vs. a CRUD tool are (1) body: undefined and (2) the verb (POST to a sub-resource path)."
    - "D-09 mutable defense-in-depth pre-flight: GET /api/streams/{id} → read canonical wire is_editable (NOT the list_streams-projected `mutable` field). Throw GraylogValidationError with err.reason='stream_immutable' BEFORE the destructive verb. Lives in all 3 mutating stream tools (update, start, pause) with byte-identical structure — Plan 03 will lift verbatim into delete_stream."

key-files:
  created:
    - "src/tools/streams/create-stream.js"
    - "src/tools/streams/update-stream.js"
    - "src/tools/streams/start-stream.js"
    - "src/tools/streams/pause-stream.js"
  modified:
    - "src/tools/streams/schemas.js (Plan 01 SUBSET extended: 7 new exports — StreamRuleSchema 8-variant discriminated union + STREAM_RULE_TYPE_TO_NUMERIC frozen map + SimilarityReasonEnum closed-set + 4 mutating schemas)"
    - "src/tools/streams/index.js (4 new register lines; total grows from 3 to 7)"
    - "src/tools.js (4 new tool entries: create_stream, update_stream, start_stream, pause_stream)"
    - "test/streams.test.js (28 net-new tests: 21 schema + 7 handler for Tasks 1-2; tests added for Task 3 directly to streams.test.js end)"
    - "test/schema-parity.test.js (+4 assertSchemaParityForTool calls — create_stream, update_stream, start_stream, pause_stream)"

key-decisions:
  - "STRICT_NO_ECHO chosen for update_stream per 03-U1-SMOKE.md UNREACHABLE_STRICT_NO_ECHO outcome. Wire body emits ONLY fields present in args.changes — no echoed current.* fields. Branch A from update-stream.js's docstring; Branch B (MERGE_FROM_CURRENT) NOT implemented. Streams carry no encrypted fields (verified against StreamResponse.java — no `is_encrypted: true` annotation) so C3 zero-out is structurally unreachable on this surface; STRICT_NO_ECHO chosen for consistency with Phase 1's update_input + smaller wire bytes on the typical 'rename a stream' path."
  - "CreateEntityRequest envelope wrap shape literally locked in create-stream.js's build(): { entity: { title, description, rules:[wire], content_pack:null, matching_type, remove_matches_from_default_stream, index_set_id }, share_request:null }. Plan 05 snapshot fixtures will pin this byte-for-byte; the wire shape is the single most-easy-to-miss surface on this phase (a flat body gets HTTP 400 'missing entity' per Pitfall S3)."
  - "classifySimilarity strictest-wins logic implemented as a 3-step short-circuit: byte-equal → 'exact'; lowercased-equal → 'case_insensitive'; either-prefix-of-the-other (lowercased) → 'prefix'; else null. The function is internal to create-stream.js but exported as a side-effect via the SimilarityReasonEnum schema (the zod enum guarantees no other reason can flow downstream)."
  - "Inline rule translation isolated in `translateInlineRule(r)` private function inside create-stream.js. Emits { type: STREAM_RULE_TYPE_TO_NUMERIC[r.type], value: String(r.value ?? ''), field: r.field ?? '', inverted: r.inverted ?? false, description: r.description ?? null }. Pitfall S10 fix: empty-string defaults for `field` and `value` on rule types where the field is semantically irrelevant (always_match emits both as ''; present + match_input emit field as '')."
  - "D-09 mutable pre-flight implemented identically in 3 places (update, start, pause). Plan considered (and rejected) extracting it into a shared helper because (a) the error message text differs per verb ('refusing start' vs 'refusing pause' vs no verb mention in update) and (b) the structured error's method+path context differs. Plan 03 will likely extract the helper when delete_stream adds the 4th caller — the lift threshold per CLAUDE.md is when a structural pattern has at least 3 stable callsites; we're already AT that threshold but the per-tool error text variance argues against a premature abstraction. Re-evaluate in Plan 03."
  - "Tool count growth: 45 (Plan 01 end) → 49 (Plan 02 end). Plan frontmatter's expected target of 50 was a +1 accounting error inherited from Plan 01's frontmatter (documented in 03-01-SUMMARY.md §Issues Encountered: 'plan's accounting double-counted by one. Documented for Plan 02 onward (Plan 02 baseline is 45, not 46)'). Actual delta: +4 from Plan 02 (create_stream, update_stream, start_stream, pause_stream). assertAllToolsRegistered(toolDefinitions) passes against 49."

patterns-established:
  - "CreateEntityRequest envelope: any future Graylog surface where the create endpoint wraps the agent's intent in `{ entity:..., share_request:null }` (suspect candidates: dashboards/views, content packs, event definitions in their write form) reuses the same build() emission pattern — flat agent schema → enveloped wire body inside build()."
  - "Strictest-bucket similarity classifier with closed-set zod enum: the (exact|case_insensitive|prefix) trio with strictest-wins short-circuit and zod enum to enforce the bucket-name closed set is generalizable to any future similarity-bucket dry-run preview (e.g. dashboard title conflicts in Phase 6, content pack name conflicts)."
  - "STRICT_NO_ECHO conditional-spread: every Phase 3+ update_* tool that ships STRICT_NO_ECHO (per its phase's U1 smoke outcome) builds the wire body with `...(args.changes.field !== undefined ? { field: args.changes.field } : {})` so the difference between 'agent omitted field' (no change) vs 'agent set field to null' (intent to clear) is preserved on the wire."
  - "Lifecycle-as-mutation factoring: any future POST /{resource}/{id}/{verb} tool (e.g. cycle_index, activate_role) follows start-stream.js's template — defineMutatingHandler + path interpolation + body: undefined + postApplyEstimate.{stateField} flipped + same per-domain pre-flight gate (D-09 here; analogues elsewhere)."

requirements-completed: [STREAM-03, STREAM-04, STREAM-06]

# Metrics
duration: ~8 min
completed: 2026-05-15
---

# Phase 3 Plan 2: Streams CRUD + lifecycle (create_stream, update_stream, start_stream, pause_stream) Summary

**Four Phase 3 mutating stream tools shipped — `create_stream` (STREAM-03, the M5 mitigation with CreateEntityRequest envelope wrap + 3-bucket strictest-wins existingMatches classifier + inline-rule numeric translation through the now-frozen STREAM_RULE_TYPE_TO_NUMERIC map), `update_stream` (STREAM-04, STRICT_NO_ECHO partial-update per 03-U1-SMOKE.md's UNREACHABLE_STRICT_NO_ECHO outcome + D-09 mutable defense-in-depth pre-flight), and the lifecycle pair `start_stream` + `pause_stream` (STREAM-06, both POST to /resume + /pause respectively, both gated by D-09 mutable, both composing through `defineMutatingHandler` for uniform dryRun + writable inheritance per D-12). schemas.js extended with the 8-variant StreamRuleSchema discriminated union + 4 new mutating schemas; 4 new schema-parity assertions land. ROADMAP SC4 ("create_stream dry-run output includes existingMatches: [{ id, title, similarity_reason }] across 3 buckets") provably met. Tool count 45 → 49; full suite green at 402/402.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-15T17:47:50Z
- **Completed:** 2026-05-15T17:56:07Z
- **Tasks:** 3 (all TDD: RED → GREEN per task; no REFACTOR needed)
- **Files modified:** 7 (4 created + 3 modified)
- **Tests added:** +44 (358 baseline → 402 total — 21 Task 1 schema + 12 Task 2 handler + 7 Task 3 handler + 4 schema-parity)
- **Tool count:** 45 → 49 (delta: +4)

## Accomplishments

- **Task 1 (schemas — TDD RED → GREEN):**
  - `src/tools/streams/schemas.js` extended by 141 lines:
    - **`StreamRuleSchema`** — `z.discriminatedUnion("type", [...])` with 8 variants covering Graylog 7.0.6's full `StreamRuleType` enum: `exact`/`regex`/`greater`/`less` (require `field` + `value`), `contains` (same), `present` (require `field` only — no `value`), `always_match` (no `field`, no `value`), `match_input` (require `value` — input id — no `field`). `inverted` defaults to false on every variant; `description` is `nullish` on every variant. Numeric `greater`/`less` accept `z.union([z.number(), z.string()])` so the wrapper can coerce in `translateInlineRule()`.
    - **`STREAM_RULE_TYPE_TO_NUMERIC`** — `Object.freeze({ exact:1, regex:2, greater:3, less:4, present:5, contains:6, always_match:7, match_input:8 })`. Pitfall S9 fix; the 8 entries are byte-identical to Graylog's `StreamRuleType.java` enum.
    - **`SimilarityReasonEnum`** — `z.enum(["exact", "case_insensitive", "prefix"])`. Closed-set per D-06; rejects every other value at parse time. The runtime cost is zero; the value is that downstream tools can pattern-match on the closed-set type without runtime validation.
    - **`CreateStreamSchema`** — `mutatingBase.extend({ title, description?, rules:[]default, matching_type:AND|OR-default-AND, remove_matches_from_default_stream:bool-default-false, index_set_id })`. D-10 enforces `index_set_id: z.string().min(1)` — explicit, no defaulting.
    - **`UpdateStreamSchema`** — `mutatingBase.extend({ streamId, changes: UpdateStreamChangesShape })` where the changes shape is an all-optional zod object over the 5 mutable wire fields. Accepts empty `changes: {}` (STRICT_NO_ECHO emits empty body).
    - **`StartStreamSchema` + `PauseStreamSchema`** — both `mutatingBase.extend({ streamId })`. Same minimal shape as Phase 1's `StartInputSchema` precedent.
  - 21 new schema-rejection/acceptance tests added to `test/streams.test.js`:
    - 8 acceptance tests for each StreamRule variant + 2 rejection tests (unknown discriminator `regexp` rejected; `exact` without `field` rejected).
    - 2 tests on `STREAM_RULE_TYPE_TO_NUMERIC` (Object.frozen strict-mode assignment throws; exactly 8 entries with correct int values).
    - 4 tests on `CreateStreamSchema` (default-filling; D-10 missing/empty rejection; inline-rule rejection cascading).
    - 2 tests on `UpdateStreamSchema` (non-empty + empty changes both accepted).
    - 2 tests on `StartStreamSchema` + `PauseStreamSchema` (streamId required).
    - 1 test on `SimilarityReasonEnum` closed-set.

- **Task 2 (create_stream + update_stream handlers — TDD RED → GREEN):**
  - `src/tools/streams/create-stream.js` (102 lines):
    - **`classifySimilarity(proposed, existing)` helper** — 3-step short-circuit: byte-equal → `"exact"`; lowercased-equal → `"case_insensitive"`; either-prefix-of-the-other (lowercased) → `"prefix"`; else `null`. Strictest bucket wins because the function returns at the first matching branch.
    - **`translateInlineRule(r)` helper** — maps `{type:"regex", field:"msg", value:".*"}` → wire `{type:2, value:".*", field:"msg", inverted:false, description:null}`. Pitfall S10 fix: empty-string defaults for irrelevant fields. `String(value ?? "")` coerces numeric `greater`/`less` values to strings on the wire.
    - **`handleCreateStream`** — `defineMutatingHandler({ name, schema:CreateStreamSchema, build, apply, summarize })`. build() returns:
      ```js
      { method:"POST", path:"/api/streams",
        body: { entity: { title, description:?? null, rules:wireRules, content_pack:null,
                          matching_type:?? "AND", remove_matches_from_default_stream:?? false,
                          index_set_id }, share_request:null },
        existingMatches,
        postApplyEstimate: { id: "__SERVER_ASSIGNED__" },
        normalize: (raw) => toIdBody(raw, { idFields:["stream_id","id"] }) }
      ```
      Pre-flight `findExistingMatches(client, { listPath:"/api/streams", matchFn: classifyNonNull, similarityReason: classifyValue })` — strictest-wins bucket flows through the `similarityReason` function pointer.
  - `src/tools/streams/update-stream.js` (87 lines):
    - **U1 smoke RESULT locked at the top of the file's docstring**: `UNREACHABLE_STRICT_NO_ECHO` → STRICT_NO_ECHO branch (Branch A). Verbatim wire-build pattern as a CONSTANT — no runtime read of 03-U1-SMOKE.md.
    - **D-09 mutable defense-in-depth FIRST**: `await client.request("GET", `/api/streams/${args.streamId}`, null)` → read canonical wire `is_editable`. If false: `throw new GraylogValidationError(...)` with `err.reason = "stream_immutable"`. The PUT does NOT fire; the wrapper surfaces the structured error envelope.
    - **STRICT_NO_ECHO wire body**: conditional-spread emits ONLY the fields the agent passed in `args.changes`. Plan-04 `description:null` → wire `description:null` (clear intent); plan-04 `description` omitted → wire omits description. The difference is preserved.
    - **`postApplyEstimate.id = args.streamId`** — not `__SERVER_ASSIGNED__`; this is not a create-shaped tool.
  - `src/tools/streams/index.js` — 2 new register lines (`create_stream`, `update_stream`).
  - `src/tools.js` — 2 new tool entries with explicit `required:["title","index_set_id"]` / `required:["streamId","changes"]`. Tool descriptions document the existingMatches bucketing + D-10 index_set_id requirement + D-09 stream_immutable refusal.
  - `test/schema-parity.test.js` — 2 new `assertSchemaParityForTool` calls.
  - 12 new handler tests:
    - 8 for `create_stream`: dry-run envelope shape (CreateEntityRequest); inline regex → numeric translation; inline always_match → empty value+field; 3 existingMatches buckets (exact, case_insensitive, prefix); apply path normalizes `stream_id` → `result.id`; missing-`index_set_id` zod rejection.
    - 4 for `update_stream`: D-09 refusal (PUT does NOT fire); STRICT_NO_ECHO emits ONLY the changed field; apply captures strict-no-echo wire body; writable:false short-circuits BEFORE pre-flight GET.

- **Task 3 (start_stream + pause_stream lifecycle handlers — TDD RED → GREEN):**
  - `src/tools/streams/start-stream.js` (52 lines): D-09 mutable pre-flight → `return { method:"POST", path:"/api/streams/{streamId}/resume", body:undefined, postApplyEstimate:{ id, disabled:false } }`. Composes through `defineMutatingHandler`.
  - `src/tools/streams/pause-stream.js` (51 lines): mirror of start-stream pointing at `/pause`; `postApplyEstimate.disabled:true`.
  - `src/tools/streams/index.js` — 2 more register lines; total now 7.
  - `src/tools.js` — 2 new tool entries documenting the eventually-consistent state semantics + D-09 refusal.
  - `test/schema-parity.test.js` — 2 more `assertSchemaParityForTool` calls.
  - 7 new handler tests: 4 for `start_stream` (dry-run preview shape; D-09 refusal; apply path; writable:false short-circuit) + 3 for `pause_stream` (dry-run preview shape; D-09 refusal; apply path).

## Task Commits

Each task was committed atomically. All three tasks follow the strict TDD RED → GREEN cycle:

1. **Task 1: extend schemas.js (TDD RED → GREEN)**
   - RED: `3358488` (test) — 21 failing tests; ERR_MODULE imports for the not-yet-exported symbols.
   - GREEN: `37b1af5` (feat) — schemas.js extended by 141 lines; all 21 schema tests pass; full suite green at 379/379.

2. **Task 2: create_stream + update_stream (TDD RED → GREEN)**
   - RED: `79ce0b3` (test) — 12 handler tests + 2 schema-parity tests fail (3 fail with ERR_MODULE_NOT_FOUND for create-stream.js + update-stream.js, the rest pass on schema imports that already exist).
   - GREEN: `84e3433` (feat) — create-stream.js + update-stream.js created; index.js + tools.js updated; all 14 tests pass; full suite green at 393/393.

3. **Task 3: start_stream + pause_stream (TDD RED → GREEN)**
   - RED: `9d30fbb` (test) — 7 handler tests + 2 schema-parity tests fail (ERR_MODULE_NOT_FOUND on streams test file; missing tool entries on schema-parity tests).
   - GREEN: `1795e5d` (feat) — start-stream.js + pause-stream.js created; index.js + tools.js updated; all 9 tests pass; full suite green at 402/402.

**Plan metadata:** pending (this SUMMARY commit + STATE.md updates ship next).

_Note: TDD gates verified in git log — Task 1 has test→feat sequence; Task 2 has test→feat; Task 3 has test→feat. Every plan-level commit pair is RED followed by GREEN with no merging or commit-squashing across the boundary._

## Files Created/Modified

### Created (4)

- `src/tools/streams/create-stream.js` — STREAM-03; M5 mitigation with envelope wrap + 3-bucket classifier + inline-rule numeric translation
- `src/tools/streams/update-stream.js` — STREAM-04; STRICT_NO_ECHO per U1 smoke + D-09 mutable pre-flight
- `src/tools/streams/start-stream.js` — STREAM-06a; POST /resume + D-09 mutable pre-flight
- `src/tools/streams/pause-stream.js` — STREAM-06b; POST /pause + D-09 mutable pre-flight (mirror of start-stream)

### Modified (3)

- `src/tools/streams/schemas.js` — extended with 7 new exports: `StreamRuleSchema` (8-variant union), `STREAM_RULE_TYPE_TO_NUMERIC` (frozen wire map), `SimilarityReasonEnum` (closed-set), `CreateStreamSchema`, `UpdateStreamSchema`, `StartStreamSchema`, `PauseStreamSchema`.
- `src/tools/streams/index.js` — 4 new register lines; total grows from 3 to 7.
- `src/tools.js` — 4 new tool entries with full inputSchema declarations matching the zod schemas (verified by 4 new schema-parity assertions).
- `test/streams.test.js` — 40 net-new tests (21 Task 1 schema + 12 Task 2 handler + 7 Task 3 handler).
- `test/schema-parity.test.js` — 4 new `assertSchemaParityForTool` calls.

## Decisions Made

See `key-decisions:` frontmatter above. Highlights:

- **STRICT_NO_ECHO chosen for update_stream** per 03-U1-SMOKE.md UNREACHABLE_STRICT_NO_ECHO. Reversible if a future live-smoke proves MERGE_FROM_CURRENT is required.
- **CreateEntityRequest envelope wrap shape locked in build()**: `{ entity: {...}, share_request: null }`. Plan 05 will snapshot the literal preview JSON.
- **`classifySimilarity` strictest-wins** via 3-step short-circuit (exact → case_insensitive → prefix). Closed-set `SimilarityReasonEnum` enforces the bucket-name invariant at the schema layer.
- **`translateInlineRule(r)` empty-string defaults** for irrelevant fields per Pitfall S10 — `always_match` emits `value:""` + `field:""` on the wire; `present` emits `value:""`; `match_input` emits `field:""`.
- **D-09 mutable pre-flight repeated in 3 places (not extracted)** — the per-tool error-message + path context variance argues against premature abstraction. Plan 03 will likely lift to a shared helper when `delete_stream` adds the 4th caller.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan task-3 test count off-by-one (7 vs 8 handler tests)**
- **Found during:** Task 3 GREEN test count verification.
- **Issue:** The plan's `<behavior>` list for Task 3 said "Tests 1-8" but Test 7 was specifically "start_stream connection-read-only refusal" — there was no separate pause_stream writable-gate test (Test 8 was the combined schema-parity for both tools). My implementation shipped 7 handler tests (4 start + 3 pause) + 2 schema-parity tests = 9 total under the start_stream|pause_stream name-pattern filter, matching the plan's intent. The "8" in the acceptance criteria's "≥(prior+8) pass" line was a miscount; the actual shipped count is 7 handler + 2 schema-parity = 9.
- **Fix:** No code change. Documented in this SUMMARY so a later auditor reading the plan's `≥(prior+8)` line vs. the test file's 7 handler tests does not flag it as a regression.
- **Files modified:** None (test count is the documentation issue, not a missing test).
- **Verification:** `node --test --test-name-pattern "start_stream|pause_stream" test/streams.test.js test/schema-parity.test.js` reports 9 pass / 0 fail. `npm test` reports 402/402.
- **Committed in:** N/A — this is a documentation note, not a code fix.

**2. [Rule 1 - Bug] Tool-count expected target (50) off by one in plan frontmatter**
- **Found during:** Task 3 GREEN verification.
- **Issue:** Plan frontmatter targeted "Tool count: 46 → 50" (delta +4); actual outcome was 45 → 49 (also delta +4 — the deltas match, the bases differ). The "+1" inherited from Plan 01's frontmatter target of 46 which was already documented as off-by-one in 03-01-SUMMARY.md §Issues Encountered. So the math is right; the base was already off.
- **Fix:** No code change. Documented in this SUMMARY's key-decisions field so the count line carries forward unambiguously into Plan 03 onward (Plan 03 baseline is 49, not 50).
- **Files modified:** None.
- **Verification:** `assertAllToolsRegistered(toolDefinitions)` passes against 49 tools; `node -e "import('./src/tools.js').then(m => console.log(m.toolDefinitions.length))"` prints 49.
- **Committed in:** N/A — accounting-doc note.

---

**Total deviations:** 2 Rule-1 documentation bugs in the plan's accounting (test count off-by-one, tool count baseline off-by-one). Both inherited from Plan 01 frontmatter math errors. Zero production-code drift from the plan; every <action> emission matches the plan's intent verbatim.

**Impact on plan:** None on production code. Both deviations are documentation-arithmetic drift carried forward across Plan 01 → Plan 02 frontmatter writes; correcting them in-place would have required edits to 03-02-PLAN.md after the plan was sealed. Instead documented here so the Phase 3 wrap-up auditor (Plan 05) inherits the correct deltas without having to recompute.

## Issues Encountered

None during execution. Two cross-task notes:

- **U1 smoke RESULT was a CONSTANT, not a runtime read.** Per the plan's threat-model T-03-02-07 mitigation, the U1 smoke `result: UNREACHABLE_STRICT_NO_ECHO` was hard-coded into the docstring of `update-stream.js` at implementation time. No runtime read of `03-U1-SMOKE.md` happens in production. The chosen branch's wire shape is locked at build time; if a future live smoke produces a different result, the wrapper widens additively without back-compat break (STRICT_NO_ECHO body is a strict subset of MERGE_FROM_CURRENT body).

- **`findExistingMatches` already had the streams envelope branch.** Phase 2 Plan 02-01 added `streams` to the unwrap chain in `src/tools/_shared/conflict.js:31` ahead of Phase 3 needs (per the cross-phase planning of Plan 03-01). No amendment to `conflict.js` was needed; the helper consumed the streams envelope verbatim.

## User Setup Required

None — no external service configuration required. Plan 03-02 is greenfield code wiring through already-shipped framework primitives.

## Next Phase Readiness

### Plan 03-03 (delete_stream — C2 mitigation centerpiece)

- **`computeCascadeHash`** already shipped (Plan 03-01) with the D-02 keyed-buckets signature. Plan 03 wires the THREE pre-flight GETs (stream rules + pipeline connections + event definitions) and feeds the assembled buckets through the helper.
- **`_confirmationToken` forwarding + `requireConfirm` apply-gate** already shipped in `handler.js` (Phase 2 Plan 02-01). Plan 03 sets `_confirmationToken` in `build()` and routes the check through `requireConfirm: ({req}) => req._confirmationToken ?? null` — same shape as `delete_index_set`.
- **D-09 mutable pre-flight** lifted verbatim from `update-stream.js` / `start-stream.js` / `pause-stream.js`. With 3 stable callsites already in tree and `delete_stream` being the 4th, Plan 03's first task can extract the pattern into `src/tools/streams/_shared/mutable-preflight.js` (or similar) without violating CLAUDE.md's "premature abstraction" guidance — 3+ callsites is the lift threshold and the per-tool error-message variance can be threaded through a single function parameter.
- **Test mocking patterns** — Plan 03-03's test file inherits `streamsMultiCapture` helper from `test/streams.test.js` (Task 2 introduced it); the same `_setCaptureRequest` + `_testConnection` seam covers the 3-endpoint pre-flight + DELETE.

### Plan 03-04 (stream-rule CRUD + test_stream_match)

- **`STREAM_RULE_TYPE_TO_NUMERIC` already shipped** in `streams/schemas.js`. Plan 04's `create_stream_rule` build() consumes the map for the single-rule wire shape (vs. Plan 02's `create_stream` consuming it for the inline-rules array).
- **`StreamRuleSchema` 8-variant union already shipped**. Plan 04's `CreateStreamRuleSchema` likely wraps `StreamRuleSchema` with the `streamId` parent reference + `mutatingBase` fields. Plan 04 `update_stream_rule` consumes the 03-U1-SMOKE.md non-nullable `type` caveat — wire body MUST emit `type: current.type` from pre-flight GET unconditionally per the caveat documented in 03-U1-SMOKE.md.
- **STRICT_NO_ECHO pattern locked** per 03-U1-SMOKE.md (Plan 02 + Plan 04 both inherit the same UNREACHABLE_STRICT_NO_ECHO outcome).

### Plan 03-05 (Phase 3 polish — schema-parity + snapshot fixtures)

- **Schema-parity** already covers the 4 Phase 3 mutating tools shipped here (in addition to the 3 read tools from Plan 01). Plan 05 needs to add parity for the remaining Plan 03 + Plan 04 tools.
- **Snapshot fixtures** pending — Plan 05 will snapshot:
  - `create_stream` dry-run with no existingMatches + populated rules (CreateEntityRequest envelope shape)
  - `create_stream` dry-run with each of the 3 existingMatches buckets (single fixture per bucket)
  - `update_stream` dry-run with each subset of `changes` (title-only, matching_type-flip, multi-field) showing STRICT_NO_ECHO body
  - `start_stream` + `pause_stream` dry-run previews (very small fixtures)
  - `update_stream` D-09 refusal envelope (error path snapshot)

### Phase 4 (Pipelines) — early reach-forward

- **Lifecycle-as-mutation pattern** generalizes to any future POST /{resource}/{id}/{verb} tool. Phase 4's `activate_pipeline_connection` (if added) can lift the start_stream.js template verbatim.
- **STRICT_NO_ECHO pattern** generalizes: any Phase 4 update_pipeline / update_pipeline_rule that does NOT carry encrypted fields can adopt the same conditional-spread wire-build.

## Self-Check: PASSED

All 4 expected created files exist on disk:
- `src/tools/streams/create-stream.js` FOUND
- `src/tools/streams/update-stream.js` FOUND
- `src/tools/streams/start-stream.js` FOUND
- `src/tools/streams/pause-stream.js` FOUND

All 6 task-commit hashes resolve in git log:
- `3358488` (Task 1 RED) FOUND
- `37b1af5` (Task 1 GREEN) FOUND
- `79ce0b3` (Task 2 RED) FOUND
- `84e3433` (Task 2 GREEN) FOUND
- `9d30fbb` (Task 3 RED) FOUND
- `1795e5d` (Task 3 GREEN) FOUND

`npm test` reports 402/402 green (358 baseline + 44 net-new). `assertAllToolsRegistered(toolDefinitions)` passes against 49 tools. CLAUDE.md compliance: every mutating tool defaults to `dryRun: true` (FOUND-04); no new npm dependencies added; existing v2.3 tool contracts unchanged; new admin tools landed under `src/tools/streams/` per the per-domain folder layout.

---
*Phase: 03-streams-stream-rules*
*Completed: 2026-05-15*
