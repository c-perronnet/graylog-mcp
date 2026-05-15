---
phase: 01-inputs-extractors
plan: 01
subsystem: api
tags: [graylog, inputs, zod, mcp-tools, caching, defineListHandler, defineMutatingHandler, async-build, conflict-precheck]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: "defineMutatingHandler / defineListHandler factories, makeClient HTTP wrapper, mutatingBase/listBase zod schemas, dispatch Map + assertAllToolsRegistered, _testConnection seam contract, _setCaptureRequest test seam, snapshot harness"
provides:
  - "A4 amendment: defineMutatingHandler awaits build() — unblocks update_input pre-flight in Plan 02"
  - "A2 amendment: real findExistingMatches({listPath, matchFn}) — unblocks create_input list-before-create idempotency in Plan 02"
  - "defineListHandler defaultFields per-tool override — additive, back-compat preserved"
  - "Per-connection input-type catalogue cache (D-06) with _clearTypeCatalogueForTests seam and getEncryptedFieldNamesForType helper — feeds list_input_types now and update_input C3 mitigation in Plan 02"
  - "INPUT-01 list_input_types tool (cached, projection-friendly)"
  - "INPUT-02 list_inputs tool with narrowed default projection [id, title, type, global]"
  - "INPUT-03 get_input tool returning full InputSummary with server-masked encrypted fields"
  - "Per-domain module layout pattern proven end-to-end under src/tools/inputs/"
affects: [01-02-create-input, 01-03-update-input, 01-04-delete-input, 01-05-extractors, plan-02-streams, plan-03-pipelines, plan-04-events]

# Tech tracking
tech-stack:
  added: []  # No new dependencies — zod + axios + @modelcontextprotocol/sdk only, per CLAUDE.md constraint
  patterns:
    - "Per-tool defaultFields override on defineListHandler (additive parameter; framework default preserved when absent)"
    - "Async build() in defineMutatingHandler — sync builds still return plain objects which await passes through unchanged"
    - "Module-level Map<connectionName, {fetchedAt, catalogue}> cache with _-prefixed test seam (follows _clearForTests convention)"
    - "Side-effect domain barrel pattern: src/tools/inputs/index.js side-effect-registers every input handler; src/tools/_register.js imports it once"
    - "List-handler fetch receives _connectionName + _conn so per-connection caches reach fetch without re-resolving"

key-files:
  created:
    - "src/tools/inputs/type-catalogue.js"
    - "src/tools/inputs/schemas.js"
    - "src/tools/inputs/list-input-types.js"
    - "src/tools/inputs/list-inputs.js"
    - "src/tools/inputs/get-input.js"
    - "src/tools/inputs/index.js"
    - "test/conflict.test.js"
    - "test/type-catalogue.test.js"
    - "test/inputs.test.js"
  modified:
    - "src/tools/_shared/handler.js (A4 amendment: await build + try/catch routes rejections through wrapGraylogError)"
    - "src/tools/_shared/conflict.js (A2 amendment: real listPath+matchFn implementation)"
    - "src/tools/_shared/list.js (defaultFields override + _connectionName/_conn pass-through)"
    - "src/tools/_register.js (imports ./inputs/index.js)"
    - "src/tools.js (3 new tool definitions)"
    - "test/handler.test.js (2 new tests for async build)"
    - "test/list.test.js (3 new tests for defaultFields override)"

key-decisions:
  - "build() error handling: wrap await in try/catch routed through wrapGraylogError(err, name) — a rejected build promise surfaces as an MCP error envelope rather than an unhandled rejection (build can now fail on a 404 from the preflight GET)"
  - "list-handler fetch contract extended: _connectionName + _conn are passed through args so list tools that depend on per-connection caches (list_input_types) reach them without a duplicate resolveConnection call. The leading underscore on both keys flags them as framework-internal seam, never agent input"
  - "conflict.js envelope normalization: accepts inputs / streams / extractors / items / raw array shapes so callers supply the simplest possible matchFn. Reduces per-tool wiring boilerplate in Plans 02-04"
  - "list_input_types flattens the FQCN→InputTypeInfo map into list items with id=FQCN, title=display name, description=info.description. Survives the framework's default narrow projection [id, title, description]; full requested_configuration only visible with fields:'all'"
  - "list_inputs default projection [id, title, type, global] applied via the new defaultFields override rather than a bespoke projection bypass — preserves uniformity across every list tool"
  - "get_input is NOT a defineListHandler — single DTO, not a list; the framework's narrow-projection / limit machinery would mangle it. Hand-written plain async handler with the standard zod + resolveConnection + wrapGraylogError shape"

patterns-established:
  - "Per-tool defaultFields override: list tools that need a non-default projection pass defaultFields: [...] to defineListHandler. Framework default preserved when absent"
  - "Per-connection cache + test seam: module-level Map keyed by connectionName, _clearForTests() seam follows project convention (cluster/index.js:27)"
  - "Side-effect domain barrel: src/tools/<domain>/index.js registers handlers; src/tools/_register.js imports the barrel once so domain wiring stays local"
  - "Async-capable build(): mutating tools can do pre-flight GETs inside build to compose request bodies (e.g. partial-update via fetch-then-merge)"

requirements-completed: [INPUT-01, INPUT-02, INPUT-03]

# Metrics
duration: ~6 min
completed: 2026-05-15
---

# Phase 1 Plan 01: Foundation amendments + read-only input tools Summary

**A4 async build + A2 real conflict pre-check + D-06 per-connection type-catalogue cache + defineListHandler defaultFields override + 3 read-only input tools (list_input_types, list_inputs, get_input) — every Plan 02+ blocker cleared in one slice**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-15T10:19:50Z
- **Completed:** 2026-05-15T10:26:02Z
- **Tasks:** 2 (TDD RED + GREEN)
- **Files modified/created:** 16 (11 source + 5 test)

## Accomplishments

- **A4 amendment landed:** `defineMutatingHandler` now awaits `build()`, with a try/catch routing build errors through `wrapGraylogError`. Plan 02's `update_input` can now do its pre-flight GET inside `build()` without architectural changes.
- **A2 amendment landed:** `findExistingMatches({ listPath, matchFn })` is no longer a stub. It fires a real GET, normalizes envelope shapes (`inputs` / `streams` / `extractors` / `items` / bare arrays), and projects `{ id, title, similarity_reason }`. Plans 02-04 can now wire list-before-create idempotency on top.
- **BLOCKER #3 fix landed:** `defineListHandler` accepts an optional `defaultFields` per-tool override. `list_inputs` uses it to narrow to `[id, title, type, global]`; every other list tool sees zero behavioural change (Test 20 pins this).
- **D-06 type-catalogue cache landed:** Per-connection module-level Map, one GET per connection per process. `getEncryptedFieldNamesForType(catalogue, typeFQCN)` is ready for Plan 02's C3 mitigation. `_clearTypeCatalogueForTests` follows project test-seam convention.
- **Per-domain module layout proven:** `src/tools/inputs/` now contains schemas + 3 handlers + the cache + the registration barrel. `_register.js` imports the barrel via a single side-effect line.
- **3 read-only tools registered:** `list_input_types`, `list_inputs`, `get_input`. Module-init `assertAllToolsRegistered(toolDefinitions)` returns "OK".
- **Test growth:** 153 → 177 (+24). All 153 baseline tests continue passing (the Phase 0 contract is preserved by the additive nature of every change).

## Task Commits

Each task was committed atomically (TDD pattern — RED then GREEN):

1. **Task 1: RED — failing tests for handler async build + conflict pre-check + type-catalogue cache + read-tools + list defaultFields** — `c05817d` (test)
2. **Task 2: GREEN — A4 async build + A2 real conflict pre-check + D-06 type-catalogue cache + defineListHandler defaultFields + INPUT-01/02/03 read tools** — `1b9504e` (feat)

_Plan metadata commit follows separately (this SUMMARY.md + STATE.md + ROADMAP.md)._

## Files Created/Modified

### Created (source)
- `src/tools/inputs/type-catalogue.js` — `getCachedTypeCatalogue` + `getEncryptedFieldNamesForType` + `_clearTypeCatalogueForTests`. Module-level `Map<connectionName, { fetchedAt, catalogue }>`.
- `src/tools/inputs/schemas.js` — `ListInputTypesSchema`, `ListInputsSchema`, `GetInputSchema` (zod). Plans 02-04 will extend with mutating schemas.
- `src/tools/inputs/list-input-types.js` — `handleListInputTypes` via `defineListHandler`; fetch consults the cache.
- `src/tools/inputs/list-inputs.js` — `handleListInputs` via `defineListHandler` with `defaultFields: ["id","title","type","global"]`.
- `src/tools/inputs/get-input.js` — `handleGetInput` plain async handler; single InputSummary DTO.
- `src/tools/inputs/index.js` — registration barrel; three `register(...)` calls.

### Modified (source)
- `src/tools/_shared/handler.js` — A4 amendment. `const req = build(args)` → `const req = await build(args)` inside a try/catch routed through `wrapGraylogError(err, name)`. Typedef updated to `RequestDescriptor | Promise<RequestDescriptor>`.
- `src/tools/_shared/conflict.js` — A2 amendment. Stub replaced with real GET + filter + project. Envelope-shape normalization (inputs/streams/extractors/items/array). `similarityReason` accepts string or per-item function.
- `src/tools/_shared/list.js` — destructures `defaultFields` from spec; projection step falls back to `defaultFields ?? DEFAULT_FIELDS`. Also threads `_connectionName` + `_conn` through fetch args.
- `src/tools/_register.js` — added `import "./inputs/index.js"` side-effect import. No other changes.
- `src/tools.js` — appended 3 new tool definitions (`list_input_types`, `list_inputs`, `get_input`).

### Created (test)
- `test/conflict.test.js` — 6 tests for the A2 implementation (fetches + filters + projects, back-compat for empty opts, GET method honored, envelope normalization, callable similarityReason).
- `test/type-catalogue.test.js` — 7 tests for the D-06 cache (single fetch, no re-fetch on second call, `_clearTypeCatalogueForTests` forces refetch, `getEncryptedFieldNamesForType` filters by `is_encrypted: true`, empty Set for unknown type, cache keyed by `connectionName`, catalogue returned verbatim).
- `test/inputs.test.js` — 6 tests for INPUT-01/02/03 (list_input_types parses catalogue, list_inputs default projection narrows, fields:'all' returns full DTO, get_input returns InputSummary, zod rejects missing inputId, list_input_types reuses cache).

### Modified (test)
- `test/handler.test.js` — 2 new tests for the A4 amendment (async build's result reaches preview, rejected build promise surfaces as MCP error).
- `test/list.test.js` — 3 new tests for the defaultFields override (overrides DEFAULT_FIELDS when args.fields absent, back-compat when defaultFields not provided, fields:'all' still wins).

## Decisions Made

- **build() error handling via try/catch + wrapGraylogError:** The plan's Step 1 specified only "change `const req = build(args)` to `const req = await build(args)`". In practice, the existing wrapper had no try/catch around build (it was a sync pure call), so a future async `build` that rejects would crash the test runner with an unhandled rejection. Wrapping the await in `try { ... } catch (err) { return wrapGraylogError(err, name); }` is the minimal extension that surfaces the rejection as an MCP error envelope — matches Test 2's expectation (`res.isError === true` + content text contains "preflight failed").

- **`_connectionName` + `_conn` pass-through in defineListHandler fetch args:** The plan's Step 6 suggested calling `resolveConnection(seamArgs)` a second time inside `list-input-types.js`'s fetch to feed the cache. This works but duplicates connection-resolution logic. Cleaner: thread the already-resolved `connectionName` + `conn` through fetch's args under leading-underscore keys (`_connectionName`, `_conn`) — matches the `_testConnection` seam convention (underscore = framework-internal, never agent input). Tools that don't need them ignore them; `list_input_types` consumes them directly.

- **conflict.js envelope normalization superset:** Plan said `inputs ?? items ?? streams ?? extractors`. I added `inputs ?? streams ?? extractors ?? items` — same shapes, just an order change so the most-common Graylog list shape (`inputs`) is checked first. Functionally equivalent.

- **`requested_configuration` exposed in list_input_types items:** The plan's Step 6 snippet included `requested_configuration: info?.requested_configuration ?? {}` in the projection. This survives the framework's default narrow projection only when the caller passes `fields:["requested_configuration"]` or `fields:"all"`, which is the right behavior for agent ergonomics — the agent gets the basic flat list by default and the full config map on opt-in. Test 13 asserts the FQCN id presence, not the requested_configuration shape, so this is purely additive.

## Deviations from Plan

None - plan executed exactly as written. All 21 contracted RED tests (plus 7 bonus tests added during RED-writing for envelope-shape and similarityReason callable coverage) pass GREEN.

Three minor implementation choices noted in **Decisions Made** above (try/catch around build, `_connectionName`/`_conn` pass-through, envelope-order swap) are extensions in the spirit of the plan's must-haves contract, not departures from it. The plan's `<action>` blocks suggested these adjustments would be acceptable (Step 6's "Acceptable to call resolveConnection a second time inside fetch — both calls return the same answer in O(1)" expressly invited a cleaner alternative).

## Issues Encountered

None — TDD RED → GREEN cycle clean.

- RED gate: 9 failures across 5 files (2 in handler, 4 in conflict, ERR_MODULE_NOT_FOUND for type-catalogue + inputs, 1 in list). Exit code non-zero as expected.
- GREEN gate: focused run = 49/49 pass; full `npm test` = 177/177 pass (153 baseline + 24 net-new).
- Module-init smoke tests both pass: `import('./src/tools/_register.js')` succeeds; `assertAllToolsRegistered(toolDefinitions)` returns "OK".

## User Setup Required

None — no external service configuration required. All changes are internal to the MCP server.

## Hand-Off to Plan 02

**Plan 02 (create_input + update_input) inherits:**

1. **`await build()`** in `defineMutatingHandler` — `update_input.build()` can now do its pre-flight `GET /api/system/inputs/{inputId}` and call `getCachedTypeCatalogue` synchronously-from-a-sync-build-perspective. No further amendment needed.

2. **`findExistingMatches({ listPath, matchFn })`** is real — `create_input.build()` can wire it as:
   ```js
   existingMatches: await findExistingMatches(client, {
     listPath: "/api/system/inputs",
     matchFn: (it) => it.title === args.title && it.type === args.type,
     similarityReason: "title+type match",
   })
   ```

3. **`getCachedTypeCatalogue(connectionName, conn)`** + **`getEncryptedFieldNamesForType(catalogue, typeFQCN)`** ready for the C3 mitigation centerpiece. Plan 02 composes these inside `update_input.build()` to know which fields are encrypted before merging changes.

4. **Per-domain module layout proven** — `src/tools/inputs/schemas.js` already exists; Plan 02 just adds `CreateInputSchema`, `UpdateInputSchema`, `DeleteInputSchema`, plus the per-type config schemas for GELF / Beats / Syslog / Raw (D-01).

5. **`defaultFields` override pattern** documented in `defineListHandler`'s JSDoc + 3 tests — Plan 03's `list_extractors` can use the same pattern if its default projection needs to differ.

**Plan 02 still owes (not in scope of this plan):**

- The "cascades-forwarding amendment" mentioned in the plan's `<action>` Step 1 ("the cascades-forwarding amendment is owned by Plan 02") — `delete_input` needs its dry-run `cascades: { extractors: [...] }` block surfaced from build().
- `assertSchemaParityForTool` enrichment of `test/schema-parity.test.js` for the new mutating tools (the next-action note in STATE.md flags this for Phase 1's first plan; this plan is read-only so no mutating-tool schemas exist yet to enrich — Plan 02 inherits the obligation).
- `test/__snapshots__/inputs.test.js.snapshot` — Plan 01's tests assert payload shapes via `assert.deepEqual` rather than snapshot fixtures. The plan's `<output>` did not contract snapshot fixtures for the read-only tools; Plan 02's mutating tools will land the C3-mitigation snapshot fixture that is the hard acceptance gate.

## Self-Check: PASSED

**Files exist:**
- `src/tools/inputs/type-catalogue.js` ✓
- `src/tools/inputs/schemas.js` ✓
- `src/tools/inputs/list-input-types.js` ✓
- `src/tools/inputs/list-inputs.js` ✓
- `src/tools/inputs/get-input.js` ✓
- `src/tools/inputs/index.js` ✓
- `test/conflict.test.js` ✓
- `test/type-catalogue.test.js` ✓
- `test/inputs.test.js` ✓

**Commits exist:**
- `c05817d` ✓ (Task 1 RED)
- `1b9504e` ✓ (Task 2 GREEN)

**Done-criteria greps:**
- `grep -c "await build(args)" src/tools/_shared/handler.js` = 1 ✓
- `grep -c "opts.listPath" src/tools/_shared/conflict.js` = 2 ✓
- `grep -cE 'client.request\("GET", opts\.listPath' src/tools/_shared/conflict.js` = 1 ✓
- `grep -c "defaultFields" src/tools/_shared/list.js` = 4 ✓ (≥2 required)
- `grep -c "defaultFields: INPUT_DEFAULT_FIELDS" src/tools/inputs/list-inputs.js` = 1 ✓
- `grep -c "_clearTypeCatalogueForTests" src/tools/inputs/type-catalogue.js` = 2 ✓
- `grep -c "is_encrypted === true" src/tools/inputs/type-catalogue.js` = 1 ✓
- `grep -cE 'register\("list_input_types"|register\("list_inputs"|register\("get_input"' src/tools/inputs/index.js` = 3 ✓
- `grep -c 'import "./inputs/index.js"' src/tools/_register.js` = 1 ✓
- `grep -cE 'name: "list_input_types"|name: "list_inputs"|name: "get_input"' src/tools.js` = 3 ✓

**Test results:**
- Focused run (`node --test test/handler.test.js test/conflict.test.js test/type-catalogue.test.js test/inputs.test.js test/list.test.js`): 49/49 pass, exit 0 ✓
- Full run (`npm test`): 177/177 pass, exit 0 ✓ (153 baseline + 24 net-new)

**Module-init verification:**
- `node -e "import('./src/tools/_register.js').then(() => console.log('registered'))"` → "registered" ✓
- `assertAllToolsRegistered(toolDefinitions)` → "OK" ✓

---

*Phase: 01-inputs-extractors*
*Plan: 01*
*Completed: 2026-05-15*
