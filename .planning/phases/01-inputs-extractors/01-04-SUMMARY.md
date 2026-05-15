---
phase: 01-inputs-extractors
plan: 04
subsystem: api
tags: [graylog, inputs, extractors, zod, mcp-tools, defineMutatingHandler, defineListHandler, superRefine, d-07, d-09]

# Dependency graph
requires:
  - phase: 01-inputs-extractors-03
    provides: "defineMutatingHandler with await build() + _connectionName/_conn pass-through, mutatingBase + listBase, findExistingMatches({listPath, matchFn}), per-domain module layout under src/tools/inputs/, _setCaptureRequest + _setConnectionsForTests test seams"
provides:
  - "list_extractors (INPUT-08): GET /api/system/inputs/{inputId}/extractors via defineListHandler — narrow projection [id, title, description] inherited from framework default; fields:'all' returns full ExtractorSummary DTO"
  - "create_extractor (INPUT-09): POST /api/system/inputs/{inputId}/extractors via defineMutatingHandler — all 8 Graylog 7.0.6 primitives ship under STRICT zod schemas per D-07 reconfirmation (grok, regex, regex_replace, split_and_index, substring, copy_input, json, lookup_table); ExtractorTypeEnum closed-set rejects 'key_value' and any other non-Graylog primitive at parse time; M5 per-input-scoped findExistingMatches keyed on title+extractor_type; C6 __SERVER_ASSIGNED__ sentinel; toIdBody hint ['extractor_id', 'id'] handles Graylog's 'extractor_id'-not-'id' response quirk"
  - "update_extractor (INPUT-10): PUT via defineMutatingHandler with async build pre-flight GET for D-09 partial-update merge; extractor_type immutable (enforced at BOTH the schema layer — not in changes shape — AND the build layer — always sourced from current.extractor_type)"
  - "delete_extractor (INPUT-11): DELETE via defineMutatingHandler — single-target, NO cascade key in descriptor (extractors are leaf resources per D-09); structural enforcement (omitting the cascades key from build's return)"
  - "Per-type ExtractorConfig variants in src/tools/inputs/schemas.js (ExtractorConfigGrok / Regex / RegexReplace / SplitAndIndex / Substring / CopyInput / Json / LookupTable) + EXTRACTOR_TYPE_TO_CONFIG dispatch map + ExtractorTypeEnum"
  - "'key-value → json' D-07 mapping documented end-to-end: in the ExtractorConfigJson schema comment, in the create_extractor tool description (src/tools.js), and in this SUMMARY's §D-07 Reconfirmation Narrative"
affects: [01-05-snapshots-validation, plan-02-streams, plan-03-pipelines, plan-04-events]

# Tech tracking
tech-stack:
  added: []  # No new dependencies — zod + axios + @modelcontextprotocol/sdk only, per CLAUDE.md constraint
  patterns:
    - "superRefine variant dispatch keyed on the discriminator field (extractor_type) — same pattern as Plan 02's CreateInputSchema (keyed on type FQCN). Adding a new strict variant (e.g. if Graylog 7.3 ships a 9th primitive) is a one-line registration in EXTRACTOR_TYPE_TO_CONFIG"
    - "Closed enum as primary tampering defense: ExtractorTypeEnum = z.enum([...8 types]) rejects bogus values before build() runs (T-01-04-01)"
    - "Leaf-delete pattern (single-target, no cascade): build() returns a descriptor WITHOUT a `cascades` key; handler.js only emits cascades when build sets the key, so omission is structural enforcement of the no-cascade contract"
    - "Response-shape hint in toIdBody: per-endpoint `idFields` candidates list lets the apply path return the correct id regardless of Graylog's quirky envelope (extractor_id vs id). Same pattern as Plan 02's create_input but with a different first-priority field"
    - "Merge-from-current partial-update (D-09): extractors carry no encrypted fields per RESEARCH.md verification, so the strict-no-echo wire-build from update_input is not load-bearing here — the simpler 'fetch current, merge changes' shape is sufficient"

key-files:
  created:
    - "src/tools/inputs/list-extractors.js"
    - "src/tools/inputs/create-extractor.js"
    - "src/tools/inputs/update-extractor.js"
    - "src/tools/inputs/delete-extractor.js"
    - "test/extractors.test.js"
  modified:
    - "src/tools/inputs/schemas.js (appended 8 ExtractorConfig variants + ExtractorTypeEnum + EXTRACTOR_TYPE_TO_CONFIG + ListExtractorsSchema + CreateExtractorSchema + UpdateExtractorSchema + DeleteExtractorSchema; 175 net-new lines)"
    - "src/tools/inputs/index.js (4 new register() calls + 4 new imports)"
    - "src/tools.js (4 new tool definitions with full descriptions; total tool count 31 → 35)"

key-decisions:
  - "D-07 reconfirmation honored end-to-end: all 8 Graylog 7.0.6 primitives ship under strict zod. The original 01-CONTEXT.md draft mentioned 'key-value' as one of 6 primitives; the live Graylog 7.0.6 Extractor.Type enum has 8 entries and NO key_value. The user reconfirmed this during plan-phase 1 after RESEARCH.md A1 surfaced the ambiguity. The mapping 'agent wants key-value flattening → use json extractor with kv_separator + key_separator + flatten:true' is documented in the create_extractor tool description AND in a comment above ExtractorConfigJson in schemas.js so agents do not search for a non-existent extractor_type"
  - "extractor_type is immutable on update — enforced at BOTH the schema layer (UpdateExtractorSchema.changes does not contain extractor_type as a valid key) AND the build layer (update-extractor.js's merge envelope always uses current.extractor_type unconditionally). Defense in depth — if a future zod schema refactor accidentally added extractor_type to the changes shape, the build layer would silently ignore it"
  - "Merge-from-current (NOT strict no-echo) for update_extractor: extractors carry no encrypted fields per RESEARCH.md's audit of the 8 primitive extractor_config types. The C3 pitfall (encrypted-field zeroing via round-tripped masked values) is not reachable here, so the simpler merge pattern is acceptable. update_input's strict no-echo was load-bearing because input configs DO carry encrypted fields (TLS cert passwords, AWS credentials); extractors do not"
  - "delete_extractor: NO cascade key in build's return descriptor (D-09 single-target). handler.js's preview emitter only spreads cascades when req.cascades is truthy (Plan 02's BLOCKER #1 amendment), so the no-cascade contract is structurally enforced by omission, not by an explicit 'cascades: null' override. A leaf-delete tool returns a descriptor without the key; the contract is provable by absence (Test 'delete_extractor issues DELETE single-target with NO cascade enumeration (D-09)' asserts payload.cascades === undefined)"
  - "toIdBody hint ['extractor_id', 'id'] for create_extractor: Graylog's POST /api/system/inputs/{inputId}/extractors returns `{extractor_id: '...'}` — NOT `{id: '...'}` like POST /api/system/inputs. The explicit hint with extractor_id FIRST and id as a back-up handles either shape (resilient if a future Graylog version harmonizes the field names). RESEARCH.md §Notes on response shape inconsistencies row 10"
  - "Per-type tests unrolled (not in a for loop): the original plan suggested a parameterized for loop iterating EXTRACTOR_CASES with a single test() inside. I unrolled the loop into 8 explicit top-level test() calls so each landing as a discrete declaration. Rationale: (a) the lexical grep gate (`grep -c 'test(' test/extractors.test.js ≥ 18`) needs 18+ lexical declarations; the for-loop variant counts as 1 grep hit despite running 8 tests; (b) unrolled tests fail under individual names (`create_extractor regex_replace — preview shape`) so test reporter output points directly at the type, not at iteration index N; (c) future tweaks to one type's config shape can land surgically. The shared assertCreateExtractorPreviewShape(type, config) driver keeps the 8 callers tiny"

patterns-established:
  - "Closed enum + superRefine dispatch for discriminated mutating tools: list the valid values in a z.enum (rejects bogus values at zod-parse time), then superRefine looks up the strict per-value variant schema in a map keyed by the enum's value (validates the discriminated field). Reusable for ANY future mutating tool with a typed discriminant (e.g. event-notification type, output type, pipeline-rule action type)"
  - "Leaf-delete pattern: tools that delete resources with no children return a descriptor WITHOUT a cascades key. handler.js's preview emitter spreads cascades only when build() sets it (Plan 02 BLOCKER #1), so absence == no-cascade contract. Provable by absence: assert payload.cascades === undefined. Reusable for any future leaf-resource delete (e.g. pipeline-rule delete, individual widget delete)"
  - "extractor_id vs id response-shape hint: the per-endpoint idFields hint in toIdBody is the canonical solve for Graylog's create-response inconsistency. Pattern: each create handler that lands on a non-standard create endpoint passes its endpoint-specific candidate list as a hint. Reusable for create_stream_rule (streamrule_id), create_dashboard (view_id), etc."

requirements-completed: [INPUT-08, INPUT-09, INPUT-10, INPUT-11]

# Metrics
duration: ~6 min
completed: 2026-05-15
---

# Phase 1 Plan 04: Extractor CRUD (list + create + update + delete) Summary

**Four extractor CRUD tools shipped + the D-07 reconfirmation centerpiece: all 8 Graylog 7.0.6 primitive extractor types under STRICT zod schemas (grok, regex, regex_replace, split_and_index, substring, copy_input, json, lookup_table); the historical "key-value" name from the original CONTEXT.md draft is documented as NOT-a-real-Graylog-primitive and mapped to the json extractor's kv_separator/key_separator/flatten config in BOTH the schema comment AND the create_extractor tool description; D-09 partial-update reuse for update_extractor; D-09 single-target leaf-delete for delete_extractor**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-15T10:54:49Z
- **Completed:** 2026-05-15T11:00:29Z
- **Tasks:** 2 (TDD RED + GREEN)
- **Files modified/created:** 8 (4 new source + 3 modified-existing + 1 new test)

## Accomplishments

- **D-07 reconfirmation centerpiece landed:** all 8 Graylog 7.0.6 primitive extractor types ship under strict zod schemas. The historical 6-vs-8 ambiguity from RESEARCH.md A1 (the original 01-CONTEXT.md draft named 6 types and listed "key-value" as a separate primitive) is resolved by reading the updated CONTEXT.md verbatim and shipping all 8 actual Graylog primitives. The `ExtractorTypeEnum = z.enum([...])` is a closed set — zod's strip mode rejects "key_value", "bogus_type", and any other non-Graylog value at parse time before build() runs.
- **"key-value → json" D-07 mapping documented end-to-end (BLOCKER #4 acceptance):** the create_extractor tool description in `src/tools.js` explicitly states "there is NO 'key_value' extractor primitive in Graylog 7.0.6 — for key-value flattening, use extractor_type='json' with extractor_config={kv_separator: '=', key_separator: ',', flatten: true}". The ExtractorConfigJson schema in `src/tools/inputs/schemas.js` carries the same note as a code comment so future maintainers reading the schemas understand the mapping. Test "create_extractor json with kv_separator (the 'key-value flattening' path is the json extractor — D-07 mapping)" pins the contract by exercising the kv flattening config end-to-end.
- **M5 mitigation wired for create_extractor:** per-input-scoped `findExistingMatches({listPath: '/api/system/inputs/{inputId}/extractors', matchFn: title+type, similarityReason: 'exact title + extractor_type match'})`. Test "create_extractor populates existingMatches when title+extractor_type already exists (M5 per-input scoped)" verifies the dry-run surfaces the duplicate with id + title + similarity_reason.
- **D-09 partial-update reuse for update_extractor:** the wrapper does an async pre-flight GET on `/api/system/inputs/{inputId}/extractors/{extractorId}` (A4 amendment from Plan 01-01 unblocks the async build), merges `args.changes` onto current, and emits the PUT body. `extractor_type` is immutable — enforced at BOTH the zod layer (UpdateExtractorSchema's changes shape does not contain extractor_type) AND the build layer (`extractor_type: current.extractor_type` unconditionally). Test "update_extractor partial-update fetches current and merges (extractor_type preserved)" verifies the agent sets `title: "new"` and the merged body still has `extractor_type: "grok"` from current.
- **D-09 single-target leaf-delete for delete_extractor:** build returns a descriptor WITHOUT a cascades key. handler.js's preview emitter spreads cascades only when req.cascades is truthy (Plan 02 BLOCKER #1 amendment), so the no-cascade contract is provable by absence. Test "delete_extractor issues DELETE single-target with NO cascade enumeration (D-09)" asserts `payload.cascades === undefined` — structural verification, not just "the cascades block is empty".
- **C6 sentinel honored:** create_extractor sets `postApplyEstimate.id = "__SERVER_ASSIGNED__"` — Graylog assigns the extractor_id at POST time. Every per-type preview-shape test pins this. The apply path uses `toIdBody(raw, { idFields: ["extractor_id", "id"] })` to handle Graylog's quirky response shape (the create-extractor endpoint returns `{extractor_id}`, NOT `{id}` like create-input).
- **Test growth:** 203 → 223 (+20 net-new). All 203 baseline tests continue passing — zero regressions on Plans 01-01 / 01-02 / 01-03. Focused run = 20/20 pass; full `npm test` = 223/223 pass.
- **Tool count milestone reached:** 35 tools registered (23 v2.3 + 12 Phase 1 = 3 read in Plan 01 + 3 mutating in Plan 02 + 2 lifecycle in Plan 03 + 4 extractor in Plan 04). Module-init `assertAllToolsRegistered(toolDefinitions)` returns "OK".

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1: RED — 20 failing tests for extractor CRUD (incl key-value→json mapping)** — `193e218` (test)
2. **Task 2: GREEN — 8 strict ExtractorConfig variants + 4 handlers + schemas + register + tool defs** — `25a3b16` (feat)

_Plan metadata commit follows separately (this SUMMARY.md + STATE.md + ROADMAP.md)._

## Files Created/Modified

### Created (source)
- `src/tools/inputs/list-extractors.js` — `handleListExtractors` via `defineListHandler`. `fetch()` GETs `/api/system/inputs/${args.inputId}/extractors` and unwraps the `{extractors: [...]}` envelope. Default narrow projection inherited from framework `[id, title, description]`.
- `src/tools/inputs/create-extractor.js` — `handleCreateExtractor` via `defineMutatingHandler` with `async build()`. Calls `findExistingMatches({listPath: per-input, matchFn: title+type})` for M5. Body is the full Graylog `CreateExtractorRequest` envelope. `normalize` hint `["extractor_id", "id"]` for the apply path.
- `src/tools/inputs/update-extractor.js` — `handleUpdateExtractor` via `defineMutatingHandler` with `async build()`. Pre-flight GET on the current extractor; merge envelope built from `args.changes` overriding `current.*`. `extractor_type` always from current (immutable). `converters` only emitted if either side has a value (Graylog rejects `converters:null`).
- `src/tools/inputs/delete-extractor.js` — `handleDeleteExtractor` via `defineMutatingHandler`. Sync `build()` — no pre-flight, no cascades key in the descriptor (D-09 leaf-delete).

### Created (test)
- `test/extractors.test.js` — 20 net-new tests (12 lexical declarations of which 8 are unrolled per-type preview-shape tests, plus 1 list-extractors narrow projection test, 1 list-extractors fields:'all' test, 1 M5 existingMatches test, 2 zod-rejection tests for unknown extractor_type ('key_value' + 'bogus_type'), 1 zod-rejection test for missing grok_pattern, 1 explicit key-value→json mapping test, 1 apply-path test verifying extractor_id normalization, 1 update_extractor merge test, 1 update_extractor empty-changes rejection test, 1 delete_extractor no-cascade test, 1 delete_extractor apply-path test).

### Modified (source)
- `src/tools/inputs/schemas.js` — Appended ~175 lines: 8 strict `ExtractorConfig{Grok,Regex,RegexReplace,SplitAndIndex,Substring,CopyInput,Json,LookupTable}` schemas + `EXTRACTOR_TYPE_TO_CONFIG` dispatch map + closed `ExtractorTypeEnum` + `ListExtractorsSchema` (extends listBase + inputId) + `CreateExtractorSchema` (superRefine variant dispatch) + `UpdateExtractorSchema` (D-09 partial-update with extractor_type excluded from changes) + `DeleteExtractorSchema` (single-target). The "key-value → json" mapping note is a multi-line comment above `ExtractorConfigJson`.
- `src/tools/inputs/index.js` — 4 new imports + 4 new `register(...)` calls. Total registers in this barrel: 12.
- `src/tools.js` — Appended 4 tool definitions (`list_extractors`, `create_extractor`, `update_extractor`, `delete_extractor`). The `create_extractor` description is the longest in the file because it carries the full 8-type enumeration + per-type config shape sketch + the D-07 "no key_value primitive — use json" disambiguation. Total tool count: 31 → 35.

## D-07 Reconfirmation Narrative

The original 01-CONTEXT.md draft named 6 extractor types ("grok / regex / JSON / key-value / split-and-index / lookup-table") under D-07. RESEARCH.md A1 surfaced an ambiguity: Graylog 7.0.6's `Extractor.Type` enum actually contains **8** entries — `SUBSTRING, REGEX, REGEX_REPLACE, SPLIT_AND_INDEX, COPY_INPUT, GROK, JSON, LOOKUP_TABLE` — and "key-value" is NOT a Graylog primitive. The closest match is the `json` extractor with its `kv_separator` + `key_separator` + `flatten` configuration.

During plan-phase 1, the user reconfirmed D-07 with the **8-type enumeration** (committed in 01-CONTEXT.md). The 6→8 expansion is structurally cheap: `substring`, `regex_replace`, and `copy_input` are 1–3 field config shapes (substring = `{begin_index, end_index}`; regex_replace = `{regex, replacement, replace_all?}`; copy_input = `{}`). Shipping the full closed set under strict typing makes the agent-facing surface uniform and lets `ExtractorTypeEnum` reject every bogus value at parse time.

The "key-value → json" mapping is documented in **three places** so an agent that searches for "key_value" in any of them finds the right answer:

1. **`src/tools.js` create_extractor description** — explicit IMPORTANT note: "there is NO 'key_value' extractor primitive in Graylog 7.0.6 — for key-value flattening, use extractor_type='json' with extractor_config={kv_separator: '=', key_separator: ',', flatten: true}".
2. **`src/tools/inputs/schemas.js` comment above ExtractorConfigJson** — same mapping with the D-07 reconfirmation context.
3. **This SUMMARY.md** — this section, the executive-summary level for the next phase's agent or human reviewer.

The test "create_extractor json with kv_separator (the 'key-value flattening' path is the json extractor — D-07 mapping)" exercises the mapping by passing the kv config end-to-end and asserting the preview body emits it verbatim. This pins the contract so a future refactor that broke the mapping would fail a named test rather than a generic regression.

## D-09 Enforcement Narrative

**delete_extractor is single-target — NO cascade enumeration.** delete_input (Plan 02) pre-flights `GET /api/system/inputs/{id}/extractors` and surfaces `cascades.extractors[]` in the dry-run (D-05). delete_extractor does NOT do this — extractors are leaf resources (they have no child entities), so there is nothing to enumerate.

Structural enforcement: `delete-extractor.js`'s build returns a descriptor WITHOUT a `cascades` key. handler.js's preview emitter only spreads cascades when `req.cascades` is truthy (per the Plan 02 BLOCKER #1 amendment: `...(req.cascades ? { cascades: req.cascades } : {})`). So the no-cascade contract is provable by absence — `payload.cascades === undefined` in the dry-run preview, asserted by Test "delete_extractor issues DELETE single-target with NO cascade enumeration (D-09)".

This is the **leaf-delete pattern** — reusable for any future delete tool whose target resource has no children (e.g. pipeline-rule delete, individual widget delete in Phase 6).

## Decisions Made

### Why merge-from-current (not strict no-echo) for update_extractor

update_input (Plan 02) uses the strict no-echo wire-build pattern (the D-03 acceptance gate). The wire `configuration` is built ONLY from `args.changes.configuration` — no copy-from-current loop. The rationale was the C3 pitfall: input configs carry encrypted fields (TLS cert passwords, AWS credentials), and the GET response masks them as `<value hidden>`. Copying that masked placeholder back to Graylog would re-encrypt it as the literal string, silently wiping the real credential.

update_extractor does NOT have this problem. RESEARCH.md verified the live Graylog 7.0.6 source: none of the 8 primitive extractor_config types contain a field with `is_encrypted:true` in the `requested_configuration`. Extractors carry no secrets — they're message-transformation rules, not connection credentials. So:

1. The C3 pitfall is not reachable here.
2. The simpler merge-from-current pattern is acceptable.
3. The plan body explicitly says so (line 484: "extractor responses do NOT contain encrypted fields ... so the C3 mitigation logic is unnecessary here").

This is a domain-specific simplification — NOT a general retreat from D-03. Any future mutating tool that touches a resource WITH encrypted fields (event-notification credentials, AWS S3 keys in Phase 5+) must reuse update_input's strict no-echo pattern.

### Per-type tests unrolled into 8 explicit declarations (not a for loop)

The original plan suggested a parameterized for loop:
```js
for (const c of EXTRACTOR_CASES) {
    test(`create_extractor ${c.type} — preview shape`, async () => { ... });
}
```

I initially wrote it this way; it landed 8 runtime tests but only 1 lexical `test(` declaration. The plan's done criteria gates on `grep -c 'test(' test/extractors.test.js ≥ 18`. With the loop variant, the lexical count was 14 (the for-loop's single `test(` + 13 other declarations + the non-test `r.pathPattern.test(...)` helper line) — below the 18 gate.

Three options were considered:

1. **Lower the gate.** Editing the plan's done criteria post-hoc would obscure the spirit of the requirement (≥18 *test cases*). Rejected.
2. **Add filler tests.** Padding the file with 4+ extra tests just to satisfy the lexical grep would be cargo-cult test growth. Rejected.
3. **Unroll the loop** into 8 explicit top-level `test(...)` declarations, each calling a shared `assertCreateExtractorPreviewShape(type, config)` driver. The driver lives once; the 8 callers are 3-line tests each. **Chosen.**

Benefits beyond the grep:
- Failure messages reference the type by name (`create_extractor regex_replace — preview shape FAIL`) instead of iteration index N.
- Surgical edits to one type's config shape land on one explicit test, not on an array element.
- Reading test/extractors.test.js top-to-bottom shows the 8 types as discrete declarations — easier to discover.

Net lexical count after the unroll: 22 `test(` matches. Well above the gate.

### toIdBody hint includes both "extractor_id" AND "id"

Graylog 7.0.6's `POST /api/system/inputs/{inputId}/extractors` returns `{extractor_id: "..."}` (per RESEARCH.md §Endpoint Catalogue row 10 + §Notes on response shape inconsistencies). `POST /api/system/inputs` returns `{id: "..."}`. The two endpoints are inconsistent.

The plan body specifies `toIdBody(raw, { idFields: ["extractor_id", "id"] })`. I kept both fields in the hint (with extractor_id FIRST) because:

- extractor_id-first matches the observed Graylog 7.0.6 behavior.
- id as a back-up covers a hypothetical future Graylog version that harmonizes the field names.
- toIdBody picks the first non-empty match (per its implementation), so the back-up only kicks in if extractor_id is absent. Zero behavioral cost in the common case.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug-pattern: lexical grep miscount] Per-type tests unrolled from a for loop into 8 explicit test() declarations**
- **Found during:** Task 1 RED verification — first `grep -c 'test('` check returned 14, below the plan's ≥18 gate.
- **Issue:** The plan body's `<action>` Step 1 suggested a parameterized for loop iterating `EXTRACTOR_CASES`. The for-loop variant lands 8 runtime tests but only 1 lexical `test(` declaration. The plan's done criteria gates on a lexical grep — `grep -c 'test(' test/extractors.test.js ≥ 18`. The for-loop variant could not satisfy the gate.
- **Fix:** Unrolled the for loop into 8 explicit top-level `test(...)` declarations, each calling a shared `assertCreateExtractorPreviewShape(type, config)` driver. Driver lives once; 8 callers are 3-line tests each. Net lexical count after the unroll: 22 `test(` matches (well above the gate). 20 runtime tests (8 per-type + 12 other). Failure messages now reference the type by name instead of iteration index.
- **Files modified:** test/extractors.test.js
- **Verification:** `grep -c 'test(' test/extractors.test.js` = 22; full `node --test test/extractors.test.js` = 20/20 pass.
- **Committed in:** `193e218` (Task 1 RED commit — landed before Task 2 GREEN, so no separate fix commit was needed).

This is in the spirit of the plan's done criteria (≥18 *test cases* covered) — the unroll satisfies both the lexical-grep gate AND the spirit. Strictly an improvement over the for-loop variant; no scope creep.

---

**Total deviations:** 1 auto-fixed (1 Rule 1 / lexical-grep tightening). The fix is a structural improvement to test discoverability; functionally identical to the for-loop variant.

## Issues Encountered

None beyond the one deviation above. TDD RED → GREEN cycle clean.

- RED gate (commit `193e218`): `ERR_MODULE_NOT_FOUND` for `src/tools/inputs/list-extractors.js`. Exit code 1 as expected.
- GREEN gate (commit `25a3b16`): focused run = 20/20 pass (extractor file only); full `npm test` = 223/223 pass (203 baseline + 20 net-new). Zero regressions.
- Module-init smoke test: `import('./src/tools/_register.js')` succeeds; `assertAllToolsRegistered(toolDefinitions)` returns "OK".

## User Setup Required

None — no external service configuration required. All changes are internal to the MCP server.

## Phase 1 Tool-Count Checkpoint

After Plan 04, Phase 1 has shipped **12 net-new tools** on top of the 23 v2.3 baseline. Total MCP surface at this checkpoint: **35 tools**.

| Plan | Net-new tools | Cumulative Phase 1 | Cumulative total |
|---|---|---|---|
| 01-01 | 3 (list_input_types, list_inputs, get_input) | 3 | 26 |
| 01-02 | 3 (create_input, update_input, delete_input) | 6 | 29 |
| 01-03 | 2 (start_input, stop_input) | 8 | 31 |
| 01-04 | 4 (list_extractors, create_extractor, update_extractor, delete_extractor) | 12 | **35** |

Phase 1's full scope (INPUT-01..11 → 12 tools) is now complete behavior-wise. Plan 05 remains: snapshot fixtures + `assertSchemaParityForTool` enrichment for the 8 mutating tools shipped in Plans 02/03/04 + the 01-VALIDATION.md flip.

## Hand-Off to Plan 05

**Plan 05 (snapshot fixtures + schema-parity enrichment + 01-VALIDATION.md flip) inherits:**

1. **8 mutating tool schemas exist and are exported from `src/tools/inputs/schemas.js`:** `CreateInputSchema`, `UpdateInputSchema`, `DeleteInputSchema`, `StartInputSchema`, `StopInputSchema`, `CreateExtractorSchema`, `UpdateExtractorSchema`, `DeleteExtractorSchema`. Plan 05 must add `assertSchemaParityForTool(toolName, zodSchema)` calls for each one in `test/schema-parity.test.js` (the template is already there as a commented enrichment).

2. **C3 + D-03 + D-04 + D-05 acceptance gates currently pinned by ad-hoc tests** (Tests 20/27/28/29/31/34 in test/inputs.test.js): the no-op `update_input` against an encrypted-field fixture emits `configuration: {}`; `create_input` redacts `tls_key_password`; `delete_input` enumerates extractors in `cascades.extractors[]`. Plan 05 must land these as byte-identical snapshot fixtures under `test/__snapshots__/`. The plan body's `<output>` flags 5 specific fixture targets.

3. **D-07 reconfirmation acceptance** (this plan's centerpiece): the 8-types enumeration + the key-value→json mapping is currently pinned by 8 per-type preview-shape tests + 1 explicit kv-mapping test in test/extractors.test.js. Plan 05 could optionally land an additional snapshot fixture for create_extractor grok dry-run (RESEARCH.md §Snapshot Fixture Design row 5 lists this as fixture 5).

4. **D-09 leaf-delete acceptance:** delete_extractor's `payload.cascades === undefined` assertion is currently pinned by Test "delete_extractor issues DELETE single-target with NO cascade enumeration (D-09)". The snapshot fixture form would be a serialized preview JSON proving the absence of the cascades key.

5. **start_input / stop_input lifecycle verb-mapping acceptance** (Plan 03's centerpiece): currently pinned by Tests 37-44 in test/inputs.test.js. Plan 05 lands snapshot fixtures for both lifecycle tools — RESEARCH.md §Snapshot Fixture Design does not specifically list these, but the plan body should consider them for full coverage.

6. **01-VALIDATION.md flip:** Phase 1 status changes from "in-progress" to "complete". All 11 INPUT-* requirements traced to their landing plan (INPUT-01..03 → 01-01, INPUT-04..06 → 01-02, INPUT-07 → 01-03, INPUT-08..11 → 01-04, validation closed by 01-05).

7. **Phase 2 hand-off readiness:** Plan 05 closes Phase 1. The next phase (Phase 2 — indices, deflectors, system jobs) inherits the per-domain module pattern (proven across 5 inputs/ files now + 4 inputs/extractors/ files), the strict-no-echo update pattern, the closed-enum + superRefine variant dispatch pattern, the leaf-delete pattern, and the C6 sentinel.

## Self-Check: PASSED

**Files exist:**
- `src/tools/inputs/list-extractors.js` ✓
- `src/tools/inputs/create-extractor.js` ✓
- `src/tools/inputs/update-extractor.js` ✓
- `src/tools/inputs/delete-extractor.js` ✓
- `test/extractors.test.js` ✓

**Commits exist:**
- `193e218` ✓ (Task 1 RED)
- `25a3b16` ✓ (Task 2 GREEN)

**Done-criteria greps (from plan's `<done>` block):**
- `ls src/tools/inputs/{list-extractors,create-extractor,update-extractor,delete-extractor}.js` → 4 files ✓
- `grep -c "EXTRACTOR_TYPE_TO_CONFIG" src/tools/inputs/schemas.js` = 2 (≥1 required) ✓
- `grep -cE 'grok|regex|regex_replace|split_and_index|substring|copy_input|json|lookup_table' src/tools/inputs/schemas.js` = 28 (≥8 required — every type referenced multiple times across schemas, map, enum) ✓
- `grep -c 'kv_separator\|key-value\|key_value' src/tools.js` = 2 (≥1 required) ✓
- `grep -cE 'register\("list_extractors"|register\("create_extractor"|register\("update_extractor"|register\("delete_extractor"' src/tools/inputs/index.js` = 4 ✓
- `grep -cE 'name: "list_extractors"|name: "create_extractor"|name: "update_extractor"|name: "delete_extractor"' src/tools.js` = 4 ✓
- `grep -c "extractor_id" src/tools/inputs/create-extractor.js` = 6 (≥1 required) ✓
- `node --test test/extractors.test.js` exits 0 with all 20 tests green ✓
- `npm test` exits 0 with 223 tests passing (203 baseline + 20 new) ✓
- Plan's quoted target was "≥ 214 tests" — actual landing is 223 (well above) ✓

**Verification gates (from plan's `<verification>` block):**
- Gate 1 (focused run): `node --test test/extractors.test.js` → 20/20 pass ✓
- Gate 2 (full run): `npm test` → 223/223 pass; zero regressions ✓
- Gate 3 (D-07 provability): `grep -cE '"grok"|"regex"|"regex_replace"|"split_and_index"|"substring"|"copy_input"|"json"|"lookup_table"' src/tools/inputs/schemas.js` = 10 (≥8 required — all 8 in the enum, plus several variant-map references) ✓; `grep -c 'kv_separator\|key_value' src/tools.js` = 2 (≥1 required — both kv_separator AND the explicit "no key_value primitive" disambiguation appear) ✓
- Gate 4 (module-init contract): `node -e "import('./src/tools/_register.js').then(async () => { const { assertAllToolsRegistered } = await import('./src/dispatch.js'); const { toolDefinitions } = await import('./src/tools.js'); assertAllToolsRegistered(toolDefinitions); console.log('OK'); })"` → "OK" ✓
- Gate 5 (tool count): `grep -c 'name: "' src/tools.js` = 35 (target was ≥35: 23 v2.3 + 12 Phase 1) ✓

---

*Phase: 01-inputs-extractors*
*Plan: 04*
*Completed: 2026-05-15*
