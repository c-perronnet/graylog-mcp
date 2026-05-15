---
phase: 03-streams-stream-rules
plan: 01
subsystem: api
tags: [streams, list-streams, get-stream, list-stream-rules, mutable-projection, cascade-hash, d-02-keyed-buckets, d-14-strict-no-echo, v2.3-displacement, pitfall-s2, pitfall-s5]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: defineListHandler + defaultFields override, makeClient, listBase, GraylogNotFoundError, dispatch + assertAllToolsRegistered (Phase 0 — already shipped)
  - phase: 01-inputs-extractors
    provides: per-domain folder layout, plain async handler pattern for single-DTO reads (get-input.js mirror)
  - phase: 02-index-sets-retention/02-01
    provides: streams envelope branch in findExistingMatches conflict.js (already shipped for Plan 02 prep)
  - phase: 02-index-sets-retention/02-03
    provides: src/tools/index-sets/c1-hash.js + computeC1Hash + collectIndexNames (Plan 03-01 Task 2 promotes verbatim to src/tools/_shared/cascade-hash.js)
provides:
  - ".planning/phases/03-streams-stream-rules/03-U1-SMOKE.md — D-14 decision artifact (UNREACHABLE_STRICT_NO_ECHO) locking STRICT_NO_ECHO for Plan 02 update_stream and Plan 04 update_stream_rule"
  - "src/tools/_shared/cascade-hash.js — promoted helper exporting computeC1Hash + collectIndexNames (Phase 2 byte-identical) AND computeCascadeHash (Phase 3 D-02 keyed-buckets sha-256)"
  - "src/tools/index-sets/c1-hash.js — thin re-export from _shared/cascade-hash.js; Phase 2 importers and tests see no churn (same function identity)"
  - "src/tools/streams/schemas.js — Plan 01 SUBSET: ListStreamsSchema, GetStreamSchema, ListStreamRulesSchema (Plans 02/03/04 will extend)"
  - "src/tools/streams/list-streams.js — STREAM-01: defineListHandler + defaultFields [id,title,description,mutable,disabled,index_set_id]; wire is_editable -> agent mutable projection (Pitfall S2)"
  - "src/tools/streams/get-stream.js — STREAM-02: plain async handler returning full StreamResponse DTO with embedded rules"
  - "src/tools/streams/list-stream-rules.js — STREAM-07: defineListHandler + narrow [id,type,field,value,inverted] projection"
  - "src/tools/streams/index.js — side-effect register barrel (3 register calls)"
affects: ["03-02 (update_stream consumes STRICT_NO_ECHO decision; CreateStreamSchema/UpdateStreamSchema appended to streams/schemas.js)", "03-03 (delete_stream consumes computeCascadeHash with the keyed-buckets signature)", "03-04 (update_stream_rule consumes STRICT_NO_ECHO + the CreateStreamRuleRequest.type non-nullable Java int caveat documented in 03-U1-SMOKE.md)", "03-05 (Phase 3 polish — schema-parity already covers the 3 read tools; remaining 9 mutating tools added by Plans 02/03/04)", "phase 04 pipelines (computeCascadeHash reusable for delete_pipeline_rule)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "D-02 keyed-buckets canonicalization for cascade-hash: { streamId, cascades: { rules:[sorted], pipeline_connections:[sorted], event_definitions:[sorted] } }. Type information preserved so cross-bucket ID collisions produce distinct hashes — flat-sort canonicalization would have collapsed them. Phase 4 pipelines copies verbatim."
    - "Helper promotion via thin re-export: when a Phase 2 helper needs broader cross-phase reuse, promote to _shared/ and leave the original location as a back-compat re-export with the SAME function identity. Phase 2 importers and tests see zero churn; new callers import from _shared/ directly. Pattern reusable for any future cross-domain helper promotion."
    - "Wire-field rename projection (Pitfall S2): list_streams projects wire `is_editable` -> agent `mutable` and STRIPS the wire field; get_stream preserves the wire name (no double-naming on rich-shape reads). The list tool is where the ergonomic rename lives; the single-DTO read is verbatim."
    - "v2.3 displacement pattern (Pitfall S5): when a Phase X-Y read tool returns a strict superset of a v2.3 read tool with the same name, remove the v2.3 register() line from _register.js and reclaim the dispatch name without renaming. The v2.3 export stays in handlers.js for HARD-03 audit reference (Phase 7); existing agents reading only the v2.3 fields continue to work because the new projection is a strict superset."

key-files:
  created:
    - ".planning/phases/03-streams-stream-rules/03-U1-SMOKE.md"
    - "src/tools/_shared/cascade-hash.js"
    - "src/tools/streams/schemas.js"
    - "src/tools/streams/list-streams.js"
    - "src/tools/streams/get-stream.js"
    - "src/tools/streams/list-stream-rules.js"
    - "src/tools/streams/index.js"
    - "test/cascade-hash.test.js"
    - "test/streams.test.js"
  modified:
    - "src/tools/index-sets/c1-hash.js (rewritten to thin re-export from ../_shared/cascade-hash.js — function identity preserved)"
    - "src/tools/_register.js (listStreamsHandler removed from destructured import; v2.3 register('list_streams', ...) line removed; new streams/index.js barrel imported)"
    - "src/tools.js (v2.3 list_streams description replaced; get_stream + list_stream_rules entries added)"
    - "test/schema-parity.test.js (+3 assertSchemaParityForTool calls)"

key-decisions:
  - "D-14 UNREACHABLE_STRICT_NO_ECHO: no API token in ~/.graylog-mcp/config.json — partial-PUT smoke skipped per <u1_smoke_protocol> 'no matching connection' branch (same precedent as 02-U1-SMOKE.md). Locked STRICT_NO_ECHO for Plan 02 update_stream and Plan 04 update_stream_rule. Safe-default rationale: no encrypted fields on streams or stream rules (C3 not reachable); smaller wire bytes; consistent with Phase 1 D-12 update_input pattern."
  - "Plan 04 caveat documented in 03-U1-SMOKE.md: CreateStreamRuleRequest.type() is non-nullable Java int — strict-no-echo for update_stream_rule MUST emit `type: current.type` from the pre-flight GET unconditionally, even when args.changes omits it. The single load-bearing wire-required field; 4 of 5 fields remain strictly no-echo."
  - "Cascade-hash helper promoted with full back-compat: src/tools/_shared/cascade-hash.js exports computeC1Hash + collectIndexNames (verbatim lift from Phase 2 — same function objects via re-export so test/index-sets.test.js Phase 2 frozen-fixture hashes still validate). NEW computeCascadeHash with D-02 keyed-buckets canonicalization. Phase 2 path src/tools/index-sets/c1-hash.js becomes a 14-line back-compat re-export — every Phase 2 importer (delete-index-set.js + test/index-sets.test.js) sees zero churn."
  - "D-02 frozen-fixture hashes pinned in test/cascade-hash.test.js: populated case (streamId=5f9d3b1c7e8a4d2b1c3e5f9d, 2 rules + 1 pipeline + 2 event-defs) -> 888cfe478f5ef2d421d1cd4e9a00b7e439e07d5d0b03094891542bea8cbaf991; empty cascade case -> 541be7deb65006714cbde5270556b20d80e32e64197c4f5bd9493139f2cacbf6. These literals detect canonicalization drift across CI runs and across the inevitable future Phase 3 delete_stream landing."
  - "Pitfall S2 mutable projection: list_streams strips wire `is_editable` AND adds agent `mutable: boolean` in one map step. Two-name foot-gun avoided. get_stream is the rich-shape read and preserves the wire field name verbatim — the single-DTO read does not double-name. ROADMAP SC2 ('list_streams returns each stream's mutable: boolean') provably met by Test 4 + Test 12 in test/streams.test.js."
  - "Pitfall S5 v2.3 displacement: the v2.3 listStreamsHandler in src/handlers.js stays exported (HARD-03 audit reference in Phase 7) but is unregistered from dispatch. The new Phase 3 list_streams is a strict superset of the v2.3 projection (still emits id/title/description, plus mutable/disabled/index_set_id) so agents reading only the v2.3 fields continue to work. Test 12 explicitly pins the strict-superset invariant."
  - "list_stream_rules is a separate tool from get_stream (Discretion-02 resolution favoring 'both exist'). get_stream returns rules embedded in the full DTO (rich read); list_stream_rules returns a narrow per-rule projection [id, type, field, value, inverted] for token efficiency on streams with many rules. Either tool can satisfy STREAM-07 alone, but having both lets the agent pick the right shape for the task — narrow for filter/routing, rich for full inspection."
  - "Tool count: 43 -> 45 (delta: -1 v2.3 list_streams displaced + 3 net-new = +2). The plan frontmatter expected 46 but the math double-counted the 'reclaimed' list_streams (it's already one of the 3 net-new). Net effect is identical: dispatch covers list_streams + get_stream + list_stream_rules under the new handlers; no v2.3 list_streams orphan remains."

patterns-established:
  - "Cross-phase helper promotion via thin re-export: promote to _shared/, leave original path as a thin re-export with SAME function identity. Test for back-compat by importing the function from BOTH paths and asserting `assert.equal(legacy, shared)` — function identity check confirms zero churn. Frozen-fixture tests at the legacy path continue to validate end-to-end."
  - "Wire-field rename projection (Pitfall S2 generalization): when an agent-facing field name differs from the wire field name, project AT THE LIST TOOL (where the ergonomic matters most) and STRIP the wire field to avoid double-naming. Preserve the wire name on single-DTO reads. The list tool is the one most likely to be the basis of an agent's filter step; the single-DTO read is more often consumed for one-shot inspection."
  - "Strict-superset displacement pattern: a new tool that supersedes a v2.3 tool with the same name can be a strict superset (every old field preserved + new fields added) instead of a rename. Removes the v2.3 register() line from _register.js; the v2.3 export stays in handlers.js for audit. Existing agents reading only old fields work unchanged. Tested via the explicit Test 12 'list_streams strict-superset back-compat' pin."

requirements-completed: [STREAM-01, STREAM-02, STREAM-07]

# Metrics
duration: ~14 min
completed: 2026-05-15
---

# Phase 3 Plan 1: Streams foundation (read tools + cascade-hash promotion + D-14 U1 smoke) Summary

**Three Phase 3 read tools shipped (STREAM-01 `list_streams` with wire→agent `mutable` projection; STREAM-02 `get_stream` returning the full StreamResponse DTO with embedded rules; STREAM-07 `list_stream_rules` narrow projection), cascade-hash helper promoted from `index-sets/c1-hash.js` to `_shared/cascade-hash.js` with the NEW D-02 keyed-buckets `computeCascadeHash` signature + 2 frozen-fixture hashes pinned, v2.3 `listStreamsHandler` displaced cleanly from dispatch (handler retained in src/handlers.js for Phase-7 HARD-03 audit), and the U1-style live-smoke artifact `03-U1-SMOKE.md` records UNREACHABLE_STRICT_NO_ECHO (no API token available) locking STRICT_NO_ECHO for Plans 02 + 04. ROADMAP SC2 ("list_streams returns each stream's mutable: boolean") provably met.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-05-15T17:30:00Z (approx — record_start_time hook)
- **Completed:** 2026-05-15T17:44:00Z (approx)
- **Tasks:** 3 (Task 1 docs; Tasks 2 + 3 TDD: RED → GREEN per task)
- **Files modified:** 13 (9 created + 4 modified)
- **Tests added:** +23 (335 baseline → 358 total — 8 cascade-hash + 12 streams + 3 schema-parity)
- **Tool count:** 43 → 45 (delta: -1 v2.3 displaced + 3 net-new)

## Accomplishments

- **Task 1 (docs):** `03-U1-SMOKE.md` — D-14 decision artifact with `result: UNREACHABLE_STRICT_NO_ECHO`. Locks STRICT_NO_ECHO for `update_stream` (Plan 02) + `update_stream_rule` (Plan 04). Documents the `CreateStreamRuleRequest.type` non-nullable-int caveat: Plan 04's strict-no-echo wire-build MUST emit `type: current.type` from the pre-flight GET unconditionally, even when `args.changes.type` is absent. The remaining 4 of 5 fields (value, field, inverted, description) stay strictly no-echo.

- **Task 2 (cascade-hash helper promotion, RED → GREEN):**
  - `src/tools/_shared/cascade-hash.js` ships exporting **THREE** functions:
    - `computeC1Hash` (Phase 2 — verbatim lift; same canonical JSON shape; identical 64-hex output for identical inputs; Phase 2 D-02 locked-literal `deleteIndices === true` replay protection preserved).
    - `collectIndexNames` (Phase 2 — verbatim lift; same dedupe semantics across closed/reopened/all sub-collections).
    - `computeCascadeHash({ streamId, ruleIds, pipelineConnIds, eventDefIds })` (Phase 3 NEW). Implements D-02 keyed-buckets canonicalization. Canonical JSON shape (LOCKED): `{ streamId, cascades: { rules:[sorted], pipeline_connections:[sorted], event_definitions:[sorted] } }`. Each bucket sorts its own IDs internally; the agent does not pre-sort. Rejects malformed inputs (missing/empty streamId, non-array buckets) with a thrown Error.
  - `src/tools/index-sets/c1-hash.js` becomes a 14-line back-compat re-export from `../_shared/cascade-hash.js`. **Function identity preserved** — Phase 2's `delete-index-set.js` and `test/index-sets.test.js` import from the SAME function object via the legacy path. Verified via Test 6: `assert.equal(computeC1HashLegacy, computeC1Hash)`.
  - **Frozen-fixture hashes pinned** in `test/cascade-hash.test.js`:
    - Populated: `888cfe478f5ef2d421d1cd4e9a00b7e439e07d5d0b03094891542bea8cbaf991`
    - Empty cascade: `541be7deb65006714cbde5270556b20d80e32e64197c4f5bd9493139f2cacbf6`
  - **Keyed-buckets disambiguates type-collision (Test 2):** the same ID string "xyz" placed in three different buckets (rules / pipeline_connections / event_definitions) produces three distinct hashes. A flat-sorted canonicalization would have collapsed them — D-02 was tightened during planning to lock the keyed shape; this test pins the invariant.

- **Task 3 (read tools + v2.3 displacement, RED → GREEN):**
  - `src/tools/streams/schemas.js` ships three minimal schemas:
    - `ListStreamsSchema` = `listBase` (no per-tool args).
    - `GetStreamSchema` = plain `z.object({ connectionName?, streamId })` — single-target read; NOT extending `mutatingBase` because this is a read tool and the framework's mutating fields (dryRun, idempotencyKey) would be confusing on a GET.
    - `ListStreamRulesSchema` = `listBase.extend({ streamId })`.
  - `src/tools/streams/list-streams.js` (STREAM-01):
    - `defineListHandler` with `defaultFields: [id, title, description, mutable, disabled, index_set_id]`.
    - Wire `is_editable` projects to agent `mutable: boolean` in the fetch callback's map step; `is_editable` is STRIPPED from the projected item via destructuring (`const { is_editable, ...rest } = s; return { ...rest, mutable: is_editable === true }`).
    - Strict-superset of v2.3 — every old field (`id`, `title`, `description`) is preserved; new fields (`mutable`, `disabled`, `index_set_id`) are additive. Pinned via Test 12.
  - `src/tools/streams/get-stream.js` (STREAM-02):
    - Plain async handler (NOT `defineListHandler`) because the response is a single DTO; the framework's narrow-projection would mangle the embedded `rules: [...]` array.
    - Returns the FULL StreamResponse DTO including embedded rules.
    - Wire `is_editable` is preserved verbatim — get_stream is the rich-shape read; the projection-to-mutable is a list_streams-specific ergonomic.
    - 404 propagates via `wrapGraylogError` as a clean MCP error envelope with `get_stream` named in the text.
  - `src/tools/streams/list-stream-rules.js` (STREAM-07):
    - `defineListHandler` with `defaultFields: [id, type, field, value, inverted]`.
    - Path parameterised by `args.streamId`; unwraps the `{ total, stream_rules: [...] }` envelope.
    - Narrow projection saves significant token bytes on streams with many rules (vs. embedding rules in `get_stream`'s rich DTO).
  - `src/tools/streams/index.js` ships 3 `register()` calls — the side-effect barrel imported once by `_register.js`.
  - `src/tools/_register.js` displaces the v2.3 `listStreamsHandler` (Pitfall S5):
    - `listStreamsHandler` removed from the destructured `../handlers.js` import.
    - `register("list_streams", listStreamsHandler)` line removed.
    - `import "./streams/index.js"` added after the existing `./index-sets/index.js` import.
    - `src/handlers.js` STILL exports `listStreamsHandler` (NOT deleted — reserved for HARD-03 in Phase 7).
  - `src/tools.js` updated:
    - v2.3 `list_streams` description replaced with the Phase 3 description (mentions "narrow projection" + "mutable" per acceptance criteria).
    - `get_stream` + `list_stream_rules` entries added with explicit `required: ["streamId"]` JSON schemas.
  - `test/schema-parity.test.js` extended with 3 new `assertSchemaParityForTool` calls.
  - `test/streams.test.js` covers Tests 1-12 from the plan's behavior list:
    - Schemas (3 tests): listBase shape + required streamId rejection
    - list_streams (3 tests): default projection + custom fields + strict-superset back-compat
    - get_stream (2 tests): full DTO + 404 propagation
    - list_stream_rules (2 tests): envelope unwrap + missing-streamId error
    - dispatch (2 tests): list_streams resolves to Phase 3 handler; assertAllToolsRegistered passes

## Task Commits

Each task was committed atomically. Tasks 2 and 3 follow the strict TDD RED → GREEN cycle:

1. **Task 1: U1 smoke decision artifact** — `8b4b0e1` (docs)

2. **Task 2: cascade-hash helper promotion (TDD RED → GREEN)**
   - RED: `11f4524` (test) — 8 failing tests covering sort-order independence, type-collision disambiguation, frozen-fixture hashes, streamId sensitivity, Phase 2 back-compat, malformed-input rejection. ERR_MODULE_NOT_FOUND for the new path.
   - GREEN: `818adf6` (feat) — `_shared/cascade-hash.js` ships with `computeC1Hash` + `collectIndexNames` + `computeCascadeHash`. `c1-hash.js` rewritten as thin re-export. All 8 cascade-hash tests pass; full suite green at 343/343.

3. **Task 3: Phase 3 read tools + v2.3 displacement (TDD RED → GREEN)**
   - RED: `326edc8` (test) — 12 streams tests + 3 schema-parity tests fail with ERR_MODULE_NOT_FOUND for `src/tools/streams/*`.
   - GREEN: `bf6ac23` (feat) — 5 new files under `src/tools/streams/`, `_register.js` displaces v2.3 list_streams, `tools.js` replaces v2.3 description + adds 2 new entries. All 15 new tests pass; full suite green at 358/358.

**Plan metadata:** pending (this SUMMARY commit + STATE.md updates ship next).

_Note: TDD gates verified in git log — Task 2 has test→feat sequence; Task 3 has test→feat sequence._

## Files Created/Modified

### Created (9)

- `.planning/phases/03-streams-stream-rules/03-U1-SMOKE.md` — D-14 decision artifact (UNREACHABLE_STRICT_NO_ECHO)
- `src/tools/_shared/cascade-hash.js` — promoted helper + NEW computeCascadeHash
- `src/tools/streams/schemas.js` — ListStreamsSchema + GetStreamSchema + ListStreamRulesSchema (Plan 01 subset)
- `src/tools/streams/list-streams.js` — STREAM-01 (defineListHandler + mutable projection)
- `src/tools/streams/get-stream.js` — STREAM-02 (plain async handler, full DTO)
- `src/tools/streams/list-stream-rules.js` — STREAM-07 (defineListHandler + narrow projection)
- `src/tools/streams/index.js` — register barrel (3 calls)
- `test/cascade-hash.test.js` — 8 unit tests for cascade-hash promotion + D-02
- `test/streams.test.js` — 12 unit tests for STREAM-01/02/07 + displacement

### Modified (4)

- `src/tools/index-sets/c1-hash.js` — rewritten to 14-line thin re-export from `../_shared/cascade-hash.js`. Function identity preserved (verified via Test 6 + Test 7 strict-equality assertions).
- `src/tools/_register.js` — listStreamsHandler removed from `../handlers.js` destructure; `register("list_streams", listStreamsHandler)` removed; `import "./streams/index.js"` added.
- `src/tools.js` — v2.3 `list_streams` description replaced; `get_stream` + `list_stream_rules` entries added.
- `test/schema-parity.test.js` — 3 new `assertSchemaParityForTool` calls for the Phase 3 read schemas.

## Decisions Made

See `key-decisions:` frontmatter above. Highlights:

- **D-14 UNREACHABLE_STRICT_NO_ECHO** — same precedent as Phase 2's 02-U1-SMOKE.md UNREACHABLE_DEFAULT_MERGE branch; no API token available to the executor; safe-default applies.
- **Cascade-hash helper promoted with full Phase 2 back-compat** — thin re-export keeps Phase 2 imports + tests byte-identical. New `computeCascadeHash` shipped with D-02 keyed-buckets canonical form.
- **Pitfall S2 mutable projection lives in list-streams.js only** — get_stream preserves the wire field name (no double-naming on rich reads).
- **Pitfall S5 v2.3 displacement is a strict-superset replace** — no rename, no aliases, no CHANGELOG drift; the new list_streams keeps every old field and adds three.
- **Discretion-02 resolution: both get_stream (embedded rules) and list_stream_rules (narrow projection) exist** — agent picks the right shape for the task.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] assertAllToolsRegistered API mismatch in Test 11**

- **Found during:** Task 3 GREEN (initial test run after streams handlers landed)
- **Issue:** The plan's <behavior> Test 11 originally called `assert.equal(assertAllToolsRegistered(toolDefinitions), "OK")` based on the plan's narrative. The actual `assertAllToolsRegistered` function (src/dispatch.js:28) returns `undefined` on success and THROWS on missing handlers — it does not return "OK".
- **Fix:** Reshaped Test 11 to call `assertAllToolsRegistered(toolDefinitions)` without an equality check (the function throwing on failure is the test contract). Kept the `assert.equal(typeof dispatch, "function")` line as a smoke check that the module is loaded.
- **Files modified:** test/streams.test.js (Test 11 body)
- **Verification:** Test 11 passes; full suite green at 358/358.
- **Committed in:** `326edc8` (RED) was initial; `bf6ac23` (GREEN) shipped the reshaped test alongside the production files. Single commit pair — the deviation was caught + fixed during the GREEN-phase iteration before any commit landed with the bad assertion.

**2. [Rule 1 - Bug] Dispatch test cache-bust pattern broke module re-registration**

- **Found during:** Task 3 GREEN (initial test run after streams handlers landed)
- **Issue:** Tests 10 + 11 originally tried to `_clearForTests()` the dispatch Map and re-import `_register.js` via a query-string cache-bust. This failed because the nested side-effect imports inside `_register.js` (`./inputs/index.js`, `./index-sets/index.js`, `./streams/index.js`) are NOT cache-busted by the outer cache-bust query string — they continue to import from cache, so their `register()` side-effects do NOT re-fire against the cleared Map. Result: `assertAllToolsRegistered` reported 23 missing handlers (every domain barrel's contributions plus the new streams ones).
- **Fix:** Dropped the `_clearForTests` + cache-bust pattern in Tests 10 + 11. Just `import "../src/tools/_register.js"` once (the module-level cache ensures one registration per process). Both tests pass cleanly; assertAllToolsRegistered confirms all 45 tools are wired.
- **Files modified:** test/streams.test.js (Tests 10 + 11 bodies)
- **Verification:** Test 10 (dispatch resolves list_streams to Phase 3 handler) + Test 11 (assertAllToolsRegistered passes) both green.
- **Committed in:** `bf6ac23` (Task 3 GREEN — alongside the production files; single GREEN commit per the TDD rhythm).

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs in the plan's test design — `assertAllToolsRegistered` API contract + ES-module-cache + cache-bust interaction). The plan's `<behavior>` text was a sketch and required these adjustments to match the actual production primitives. Both fixes are local to test/streams.test.js — no production-code drift from the plan.

**Impact on plan:** None on production code. Test-design tweaks only; the test contracts shipped exactly match the plan's intent (Phase 3 handler resolves; module-init assertion holds).

## Issues Encountered

- **Tool-count math mismatch in plan frontmatter.** The plan declared "tool count = 46" via `43 - 1 + 3 + 1 = 46`. The "+ 1 re-claimed list_streams" is the SAME item as one of the "+ 3 net-new" — list_streams is part of the 3 net-new (list_streams + get_stream + list_stream_rules), not an additional reclamation. Correct math: `43 - 1 + 3 = 45`. The actual `toolDefinitions.length` is 45; `assertAllToolsRegistered(toolDefinitions)` passes. No production impact — the count is correct; the plan's accounting double-counted by one. Documented for Plan 02 onward (Plan 02 baseline is 45, not 46).

## User Setup Required

None — no external service configuration required. Phase 3 Plan 01 is greenfield code + a docs artifact.

## Next Phase Readiness

### Plan 03-02 (create_stream + update_stream)

- **STRICT_NO_ECHO locked** for `update_stream` per 03-U1-SMOKE.md.
- **`findExistingMatches` streams envelope** already shipped in `src/tools/_shared/conflict.js:31` (verified during planning) — Plan 02's `create_stream` can wire D-05 + D-06 three-bucket existingMatches without amending the helper.
- **streams/schemas.js** is ready for extension — add `CreateStreamSchema` (with `index_set_id` REQUIRED per D-10), `UpdateStreamSchema`, `StartStreamSchema`, `PauseStreamSchema`, and the 8-variant `StreamRuleSchema` discriminated union + `STREAM_RULE_TYPE_TO_NUMERIC` map.

### Plan 03-03 (delete_stream — C2 mitigation centerpiece)

- **`computeCascadeHash`** ready: keyed-buckets signature with two frozen-fixture hashes pinned. Plan 03 wires the THREE pre-flight GETs (rules + pipelines + event-defs paginated + client-side filter on `config.streams`), assembles the keyed buckets, and feeds them through the helper.
- **`_confirmationToken` forwarding + `requireConfirm` apply-time gate** ready in `handler.js` (Phase 2 Plan 02-01). Plan 03 sets `_confirmationToken` in `build()` and routes the check through `requireConfirm: ({req}) => req._confirmationToken ?? null` — same shape as `delete_index_set`.
- **D-09 mutable defense-in-depth** ready: pre-flight `GET /api/streams/{id}` and read `current.is_editable` (wire) → if false, throw `GraylogValidationError` with `err.reason = "stream_immutable"`. Two-layer defense (wrapper-side + Graylog's `checkNotEditableStream`).

### Plan 03-04 (stream-rule CRUD + test_stream_match)

- **STRICT_NO_ECHO for update_stream_rule** locked per 03-U1-SMOKE.md, with the documented caveat: `CreateStreamRuleRequest.type()` is non-nullable Java int — wire body MUST emit `type: current.type` from the pre-flight GET unconditionally, even when `args.changes.type` is absent.
- **`STREAM_RULE_TYPE_TO_NUMERIC` map** will live in streams/schemas.js (Plan 02 or Plan 04). Researcher-recommended single source of truth; consumed by `create_stream_rule.build()` and `update_stream_rule.build()`.

### Plan 03-05 (Phase 3 polish — schema-parity + snapshot fixtures)

- Schema-parity already covers all 3 Phase 3 read tools shipped here.
- Snapshot fixtures pending — Plans 02/03/04 will ship dry-run fixtures for create_stream + delete_stream + start_stream + pause_stream + the 3 rule mutations + test_stream_match.

### Phase 4 (Pipelines) — early reach-forward

- `computeCascadeHash` is reusable for `delete_pipeline_rule` (PIPE-10's cascade preview). The keyed-buckets shape generalises: rename the bucket keys per Phase 4's cascade taxonomy without changing the helper.

## Self-Check: PASSED

All 10 expected files exist on disk; all 5 task-commit hashes (8b4b0e1, 11f4524, 818adf6, 326edc8, bf6ac23) resolve in git log; `npm test` reports 358/358 green; two consecutive `npm test` runs produce byte-identical `.snapshot` md5sums (DETERMINISTIC).

---
*Phase: 03-streams-stream-rules*
*Completed: 2026-05-15*
