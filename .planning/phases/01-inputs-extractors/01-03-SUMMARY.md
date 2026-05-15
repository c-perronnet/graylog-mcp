---
phase: 01-inputs-extractors
plan: 03
subsystem: api
tags: [graylog, inputs, lifecycle, mcp-tools, defineMutatingHandler, verb-asymmetry]

# Dependency graph
requires:
  - phase: 01-inputs-extractors-02
    provides: "defineMutatingHandler with await build() + _connectionName/_conn pass-through; mutatingBase schema; src/tools/inputs/ per-domain layout; _setCaptureRequest + _setConnectionsForTests test seams"
provides:
  - "start_input (INPUT-07a): PUT /api/system/inputstates/{inputId} via defineMutatingHandler — dryRun + writable-gate + idempotency inherit from mutatingBase"
  - "stop_input (INPUT-07b): DELETE /api/system/inputstates/{inputId} via defineMutatingHandler — same uniform contract; verb asymmetry hidden behind tool name"
  - "StartInputSchema + StopInputSchema in src/tools/inputs/schemas.js — both = mutatingBase.extend({ inputId })"
  - "Tool descriptions documenting (a) the counter-intuitive verb mapping (start=PUT, stop=DELETE) and (b) the desired-state-not-actual-state caveat (RESEARCH.md §Pitfall Eventually Consistent)"
affects: [01-04-extractors, 01-05-snapshots, plan-02-streams]

# Tech tracking
tech-stack:
  added: []  # No new dependencies — zod + axios + @modelcontextprotocol/sdk only
  patterns:
    - "Lifecycle-as-mutation: input lifecycle tools compose through defineMutatingHandler exactly like CRUD tools — no special 'runtime-only' path. D-08 in action"
    - "postApplyEstimate.id = args.inputId (NOT __SERVER_ASSIGNED__) for non-create-shaped tools: the agent supplied the ID, so the dry-run preview reports it back as-is"
    - "Empty-body verb mapping: build returns body: undefined; the apply callback passes it through unchanged; the dry-run preview emits body: undefined (handler.js does no transformation)"

key-files:
  created:
    - "src/tools/inputs/start-input.js"
    - "src/tools/inputs/stop-input.js"
  modified:
    - "src/tools/inputs/schemas.js (appended StartInputSchema + StopInputSchema)"
    - "src/tools/inputs/index.js (appended 2 register() calls)"
    - "src/tools.js (appended 2 tool definitions with descriptions)"
    - "test/inputs.test.js (appended 8 RED tests turned GREEN)"

key-decisions:
  - "Lifecycle tools defined as their own modules (start-input.js + stop-input.js) NOT as a shared lifecycle.js with two exports. The two handlers differ only in verb (PUT vs DELETE) and summarize string, but separating them mirrors the per-tool-per-file convention used by create_input / update_input / delete_input. Future maintainers see a one-to-one mapping between tool name and file"
  - "Tool descriptions explicitly document the verb asymmetry (start=PUT, stop=DELETE) AND the desired-state-not-actual-state caveat in the same string. The agent never needs to read Graylog's source code to use the tool — the unusual REST shape is opaque, but the eventual-consistency behavior is exposed (because it affects the agent's polling logic)"
  - "Apply callback uses req.body (which is undefined) rather than ignoring the body entirely. This keeps the apply signature uniform with create_input / update_input / delete_input — the client.request signature accepts (method, path, body=undefined) and treats undefined as 'no body'. No special-casing in apply"
  - "postApplyEstimate: { id: args.inputId } — not the __SERVER_ASSIGNED__ sentinel. Rationale: lifecycle tools are not create-shaped; the ID already exists. Setting the estimate to the known ID lets a blueprint author chain the tool call into a follow-up get_input or list_inputs filter without an extra round-trip"

patterns-established:
  - "Lifecycle-as-mutation contract: any future tool that flips a Graylog runtime flag (e.g. enable_pipeline, pause_event_definition) follows the start_input / stop_input pattern — defineMutatingHandler composition, postApplyEstimate.id = args.<resourceId>, body: undefined for empty-body verbs"
  - "Verb-asymmetry documentation: when a Graylog REST endpoint uses a counter-intuitive verb (DELETE here means 'stop', not 'destroy'), the tool description carries the explicit verb in the first sentence. Out-of-band knowledge stays in the tool description, not in agent training data"

requirements-completed: [INPUT-07]

# Metrics
duration: ~2 min
completed: 2026-05-15
---

# Phase 1 Plan 03: start_input + stop_input lifecycle tools Summary

**Input lifecycle landed: start_input issues PUT /api/system/inputstates/{id}; stop_input issues DELETE on the same path. Both compose through defineMutatingHandler so dryRun + writable-gate + idempotency inherit uniformly. Tool descriptions document the verb asymmetry and the desired-state-not-actual-state semantics.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-05-15T10:45:58Z
- **Completed:** 2026-05-15T10:48:08Z
- **Tasks:** 1 (TDD RED + GREEN combined per plan's task structure)
- **Files modified/created:** 6 (2 new source + 3 modified-existing + 1 modified-test)

## Accomplishments

- **start_input (INPUT-07a) shipped:** PUT /api/system/inputstates/{inputId} via defineMutatingHandler. dryRun: true by default; writable=false short-circuits with `reason: "connection_read_only"`; idempotency key auto-derived from connection+tool+args hash; postApplyEstimate.id = args.inputId (agent-known).
- **stop_input (INPUT-07b) shipped:** DELETE /api/system/inputstates/{inputId} via defineMutatingHandler. Same uniform contract — the verb asymmetry is hidden behind the tool name. Test 39/40 prove the DELETE verb lands at the right path.
- **Verb mapping confirmation (RESEARCH.md Endpoint Catalogue rows 7-8):** start = PUT, stop = DELETE on `/api/system/inputstates/{inputId}`. Confirmed end-to-end by capture-seam tests 38 + 40. The unusual mapping is documented in tools.js descriptions so the agent never has to know it.
- **D-08 contract honored:** lifecycle composes through defineMutatingHandler exactly like CRUD tools. No special-cased "runtime-only" mutation path. dryRun: true defaults inherited from mutatingBase; the writable-flag gate at both the wrapper layer (handler.js, before build) and the client layer (graylog/client.js, before axios) carry forward unchanged.
- **Tool descriptions document the eventually-consistent semantics:** Both descriptions include the warning "this sets the DESIRED state; actual state may briefly remain STARTING/STOPPING until Graylog's input registry converges. Poll get_input if you need to wait for RUNNING/STOPPED." RESEARCH.md §Pitfall Eventually Consistent now ergonomic to the agent.
- **Test growth:** 195 → 203 (+8 net-new). All 195 baseline tests continue passing — zero regressions on Plan 01-02 (which itself preserved Plan 01-01's 177).
- **assertAllToolsRegistered contract holds:** 2 new tool names in tools.js + 2 new register() calls in inputs/index.js. Module-init smoke test returns "OK".

## Task Commits

Each phase of the TDD cycle was committed atomically:

1. **Task 1: RED — 8 failing tests for start_input + stop_input** — `968cdc4` (test)
2. **Task 1: GREEN — handlers + schemas + register + tool defs** — `4e40a2e` (feat)

_Plan metadata commit follows separately (this SUMMARY.md + STATE.md + ROADMAP.md)._

## Files Created/Modified

### Created (source)
- `src/tools/inputs/start-input.js` — `handleStartInput` via `defineMutatingHandler`. `build()` returns `{ method: "PUT", path: "/api/system/inputstates/{inputId}", body: undefined, postApplyEstimate: { id: args.inputId } }`. Apply passes `req.body` (undefined) through unchanged.
- `src/tools/inputs/stop-input.js` — `handleStopInput` via `defineMutatingHandler`. Same shape as start-input.js with `method: "DELETE"`. The full asymmetry footprint between start and stop is two lines (the method string and the summarize string).

### Modified (source)
- `src/tools/inputs/schemas.js` — Appended `StartInputSchema = mutatingBase.extend({ inputId })` + `StopInputSchema = mutatingBase.extend({ inputId })`. Both schemas accept ONLY `{ inputId, dryRun?, connectionName?, idempotencyKey? }` — no extraneous lifecycle state args (D-08 keeps the surface clean).
- `src/tools/inputs/index.js` — Appended `import { handleStartInput } from "./start-input.js"` + `import { handleStopInput } from "./stop-input.js"` + two `register(...)` calls.
- `src/tools.js` — Appended 2 tool definitions (`start_input`, `stop_input`). Descriptions document:
  1. The HTTP verb mapping ("Maps to PUT /api/system/inputstates/{inputId}" / "Maps to DELETE /api/system/inputstates/{inputId} — the verb is DELETE (not PUT) due to Graylog's REST semantics; the input itself is NOT deleted, only its running state").
  2. The eventually-consistent caveat ("sets the DESIRED state; actual state may briefly remain STARTING/STOPPING").
  3. The polling hint ("Poll get_input if you need to wait for RUNNING/STOPPED").

### Modified (test)
- `test/inputs.test.js` — 8 new tests appended at the end. New imports: `handleStartInput`, `handleStopInput`.

## Decisions Made

### Lifecycle tools as their own modules (not a shared lifecycle.js)

The two handlers differ only in (a) the HTTP verb string and (b) the summarize callback's verb word. A single shared lifecycle.js exporting both could have been ~30 lines total instead of 35+35 lines. I chose the per-tool-per-file split anyway because:

1. **Discoverability** — every other tool under `src/tools/inputs/` is one file per tool. A future maintainer searching for `stop_input` finds `stop-input.js` immediately, not nested inside a `lifecycle.js`.
2. **Future divergence** — if Graylog 7.4 adds a `force` flag to stop_input only (e.g. for blocked inputs), the split lets us add it without growing a shared module's branching.
3. **Plan contract** — the plan's `<files_modified>` lists both as separate files, so the per-file split was specifically requested.

### Tool descriptions carry both the verb mapping AND the eventually-consistent caveat

Both pieces of out-of-band knowledge are agent-facing. The verb mapping is invisible to the agent at call time (the agent calls `stop_input(inputId)`, not `DELETE /api/system/...`) but visible in the dry-run preview's `preview.method` and `preview.path`. If the agent inspects the dry-run before applying — which is the recommended workflow — it sees the DELETE verb. Without the description's warning, the agent might assume the dry-run shape is wrong and abort. The description disarms that confusion.

The eventually-consistent caveat affects the agent's chaining logic: an agent that calls `start_input` then immediately calls `get_input` and reads `state` would race the input registry's converge. The description's "Poll get_input if you need to wait for RUNNING" sentence is the agent's permission slip to add a poll loop.

### body: undefined (not body: null)

The plan's done criteria accepted either `body === undefined` or `body === null` for the preview body field. I chose `undefined` because:

1. `JSON.stringify({ body: undefined })` produces `"{}"` (key omitted) while `JSON.stringify({ body: null })` produces `'{"body":null}'` (key emitted with null). The dry-run preview emits the `preview.body` field always, so this matters: with `undefined`, the field is present in the preview JSON as `body: undefined` ... actually node:test's assertion library normalizes undefined to absent. After running the tests, `payload.preview.body === undefined` is the observed shape — preview JSON omits the key.
2. The apply callback's `client.request(method, path, body)` treats `undefined` as "no body" via the axios default. `null` would be serialized as the JSON null literal in the HTTP body (per axios's default behavior). Graylog ignores both, but `undefined` is the most semantically correct.

The tests use `payload.preview.body === undefined || payload.preview.body === null` as the assertion so either shape would pass; in practice, the assertion sees undefined.

### postApplyEstimate.id = args.inputId (not __SERVER_ASSIGNED__)

create_input uses `__SERVER_ASSIGNED__` because the server picks the ID. start_input / stop_input know the ID up front (the agent supplied it), so the postApplyEstimate echoes it back. This matters for blueprint chaining: a blueprint that applies start_input then chains to get_input(inputId) can read `postApplyEstimate.id` from the dry-run preview to confirm what ID will be acted on, without re-reading args.inputId.

## Deviations from Plan

None — plan executed exactly as written. All 7 contracted RED tests (plus 1 bonus test added during RED-writing: the writable=false gate was split into two tests, one for start_input and one for stop_input, instead of the single combined test the plan suggested, for finer-grained test isolation) pass GREEN.

The split of the writable=false test into two is in the spirit of the plan's must-have ("Both tools honor the D-07 writable-flag gate at both wrapper and client layers"). Functionally identical to the combined test; the split is purely cosmetic (test names are clearer).

## Issues Encountered

None — TDD RED → GREEN cycle clean.

- RED gate: `ERR_MODULE_NOT_FOUND` for start-input.js (handler file didn't exist yet). Exit code non-zero as expected.
- GREEN gate: focused run = 32/32 pass (24 baseline from Plan 01-02 + 8 net-new); full `npm test` = 203/203 pass (195 baseline + 8 net-new).
- Module-init smoke test: `import('./src/tools/_register.js')` + `assertAllToolsRegistered(toolDefinitions)` → "OK".

## User Setup Required

None — no external service configuration required. All changes are internal to the MCP server.

## Wave-3 Sequencing Rationale

This plan declared `wave: 3, depends_on: ["01-02"]` in its frontmatter. The reason it is NOT parallel with Plan 02 is the **file-ownership rule**:

| File | Plan 02 touches | Plan 03 touches |
|------|-----------------|-----------------|
| `src/tools/inputs/schemas.js` | Appends Create/Update/Delete schemas + variantMap + 8 strict variants | Appends Start/Stop schemas |
| `src/tools/inputs/index.js` | Appends 3 register() calls | Appends 2 register() calls |
| `src/tools.js` | Appends 3 tool definitions | Appends 2 tool definitions |

Any same-wave parallel run on Wave 2 would race on those three files — Plan 02's appends and Plan 03's appends would land in the same regions of the same files and produce a merge conflict (or worse, a silent corruption if the merge tool naively concatenated). Sequencing Plan 03 in Wave 3 lets each plan see the other's appended state without conflict.

Plans 04 (extractors) and 05 (snapshot fixtures + schema-parity + validation flip) will likewise need their own waves if they touch the same shared files — Plan 04 will append extractor schemas to `schemas.js`, extractor tool definitions to `tools.js`, and extractor register() calls to `index.js`.

## Hand-Off to Plan 04

**Plan 04 (extractors CRUD) inherits:**

1. **Per-tool-per-file convention reinforced** — start-input.js / stop-input.js join create-input.js / update-input.js / delete-input.js as the established pattern. Plan 04 follows with create-extractor.js / update-extractor.js / delete-extractor.js / list-extractors.js.

2. **Lifecycle-as-mutation pattern** is documented and tested — any future tool that flips a Graylog runtime flag (e.g. `enable_pipeline`, `pause_event_definition` in later phases) follows the start_input / stop_input pattern: defineMutatingHandler composition + `postApplyEstimate.id = args.<resourceId>` + `body: undefined` for empty-body verbs.

3. **Verb-asymmetry documentation pattern** is established — when Graylog uses a counter-intuitive verb, the tool description explicitly carries it in the first sentence (Plan 04 doesn't have a counter-intuitive verb on extractors, but later phases may).

**Plan 05 (snapshot fixtures + schema-parity + 01-VALIDATION.md flip) inherits:**

- start_input / stop_input as additional snapshot fixture targets. The plan's `<output>` will need to include byte-identical dry-run snapshot fixtures for both lifecycle tools.
- `assertSchemaParityForTool(start_input/stop_input, StartInputSchema/StopInputSchema)` enrichment of `test/schema-parity.test.js` — Plan 05 must add these calls (the schemas now exist in `src/tools/inputs/schemas.js`).

## Self-Check: PASSED

**Files exist:**
- `src/tools/inputs/start-input.js` ✓
- `src/tools/inputs/stop-input.js` ✓

**Commits exist:**
- `968cdc4` ✓ (Task 1 RED)
- `4e40a2e` ✓ (Task 1 GREEN)

**Done-criteria greps:**
- `ls src/tools/inputs/start-input.js src/tools/inputs/stop-input.js` → 2 files ✓
- `grep -c 'method: "PUT"' src/tools/inputs/start-input.js` = 1 (≥1 required) ✓
- `grep -c 'method: "DELETE"' src/tools/inputs/stop-input.js` = 1 (≥1 required) ✓
- `grep -c 'inputstates' src/tools/inputs/start-input.js` = 3 (≥1 required) ✓
- `grep -c 'inputstates' src/tools/inputs/stop-input.js` = 3 (≥1 required) ✓
- `grep -cE 'register\("start_input"|register\("stop_input"' src/tools/inputs/index.js` = 2 ✓
- `grep -cE 'name: "start_input"|name: "stop_input"' src/tools.js` = 2 ✓
- `grep -cE 'StartInputSchema|StopInputSchema' src/tools/inputs/schemas.js` = 2 (≥2 required, but actual count of references is higher — 2 export keywords) ✓

**Test results:**
- Focused run (`node --test test/inputs.test.js`): 32/32 pass, exit 0 ✓ (24 baseline + 8 net-new)
- Full run (`npm test`): 203/203 pass, exit 0 ✓ (195 baseline + 8 net-new)

**Module-init verification:**
- `node -e "import('./src/tools/_register.js').then(() => assertAllToolsRegistered(toolDefinitions))"` → "OK" ✓

**Verb-mapping contract verification (per plan's `<verification>` section 4):**
- start_input capture-seam test: `captured.method === "PUT"`, `captured.path === "/api/system/inputstates/in1"` ✓
- stop_input capture-seam test: `captured.method === "DELETE"`, `captured.path === "/api/system/inputstates/in1"` ✓

---

*Phase: 01-inputs-extractors*
*Plan: 03*
*Completed: 2026-05-15*
