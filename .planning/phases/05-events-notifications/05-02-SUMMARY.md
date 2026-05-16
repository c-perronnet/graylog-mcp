---
phase: 05-events-notifications
plan: 02
subsystem: event-definitions
tags: [event-definitions, m1-acceptance-gate, c5-acceptance-gate, schedule-inversion, strict-no-echo, v6-to-v7-migration, create-entity-request-envelope, paginated-envelope]

# Dependency graph
requires:
  - phase: 05-events-notifications
    provides: Plan 05-01 foundation primitives — schemas (CreateEventDefinitionSchema, UpdateEventDefinitionSchema, GetEventDefinitionSchema, ListEventDefinitionsSchema, EventDefinitionDtoSchema, EventDefinitionDtoChangesSchema), migrateV6ToV7AggregationConditions, conflict.js `elements` envelope amendment, empty events/index.js barrel ready for population
  - phase: 03-streams-stream-rules
    provides: CreateEntityRequest envelope pattern (Pitfall 3) precedent from create_stream.js; STRICT_NO_ECHO partial-update pattern from update_stream.js (D-14)
  - phase: 04-pipelines-pipeline-rules-connections
    provides: STRICT_NO_ECHO + conditional parseResult precedent from update_pipeline_rule.js — Plan 05-02 Task 3 follows the same conditional-migration pattern for `changes.config`
provides:
  - 4 wire tools registered against dispatch — list_event_definitions, get_event_definition, create_event_definition, update_event_definition (toolDefinitions.length 66 → 70)
  - M1 ACCEPTANCE GATE landed end-to-end (4 distinct proofs across create + update): wire path UNCONDITIONALLY `?schedule=false` + dry-run summary `wouldStartScheduling:false` + schema-strip of agent-injected `schedule:true` + D-02 mirror on update partial-PUT
  - C5 ACCEPTANCE GATE landed end-to-end (3 proofs): v6 input → visible migration:{migrated:true, warnings:[{migrated_from_v6_shape:true, original, emitted:"count_source"}]}; v7 input → migration key OMITTED from dry-run JSON; conditional migration on update fires only when changes.config touched
  - handler.js req.migration conditional spread (cross-cutting amendment ready for Plan 05-04 update_event_notification reuse)
  - STRICT_NO_ECHO partial-update extended to event-definitions (Phase 1/3/4 precedent landed here for the third time — Pitfall 5 scheduler READ_ONLY contamination structurally impossible)
  - findExistingMatches({listPath: "/api/events/definitions/paginated"}) operationalized — proves the Plan 05-01 envelope amendment end-to-end and clears the path for Plan 05-04 to use the same probe against /api/events/notifications/paginated
affects: [05-03, 05-04, 05-05, 06-blueprints, 07-finalization]

# Tech tracking
tech-stack:
  added: []  # No new npm deps — composes Plan 05-01 zod schemas + migrator + cascade-hash thin wrapper
  patterns:
    - "Pattern A: Schema-as-structural-enforcement — D-01/D-02 absent `schedule` field means zod strip drops agent-injected schedule:true BEFORE build() sees it (no runtime branch, pure structural enforcement)"
    - "Pattern B: Synthetic-DTO wrapping for migrator reuse — update path wraps args.changes.config in {config:...} so migrateV6ToV7AggregationConditions's recursive expression visitor works without modification"
    - "Pattern C: handler.js cross-cutting visibility surface — req.migration joins req.cascades / req.parseResult / req._confirmationToken in the conditional-spread chain; Plan 05-04 update_event_notification can adopt without further amendment"
    - "Pattern D: paginated-envelope list with limit→per_page mapping — list_event_definitions emits page=1&per_page=${limit} unconditionally (byte-stable URLs for snapshot pinning); query/sort/order appended only when set"
    - "Pattern E: Plain async read handler for full-DTO reads — get_event_definition mirrors get_stream / get_input pattern (no narrow projection); list_event_definitions uses defineListHandler with 6-key default projection"

key-files:
  created:
    - "src/tools/events/list-event-definitions.js (~67 LOC) — EVENT-01 paginated/elements unwrap + 6-key narrow projection"
    - "src/tools/events/get-event-definition.js (~74 LOC) — EVENT-02 plain async handler; full DTO with scheduler READ_ONLY + notifications[]"
    - "src/tools/events/create-event-definition.js (~95 LOC) — EVENT-03 M1+C5 centerpiece (D-01 path-level ?schedule=false + D-03/D-04 v6→v7 migration + Pitfall 3 entity wrap + Pitfall 8 id strip + FOUND-11 existingMatches)"
    - "src/tools/events/update-event-definition.js (~105 LOC) — EVENT-04 D-02 mirror of D-01 + D-10 STRICT_NO_ECHO + C5 conditional migration on changes.config + Pitfall 5/8 mitigations"
  modified:
    - "src/tools/events/index.js — register 4 handlers (list/get/create/update); replaces Plan 05-01 empty stub"
    - "src/tools.js — 4 net-new tool-definition entries (count 66 → 70); Plan 05-01 S5 displacement comment block updated"
    - "src/tools/_shared/handler.js — req.migration conditional spread added to dry-run preview emitter (parallel to existing req.cascades / req.parseResult slots)"
    - "test/events.test.js — 28 net-new tests covering 4 handlers + dispatch + M1/C5 acceptance gates"
    - "test/schema-parity.test.js — 4 new schema-parity tests (list/get/create/update event definitions)"
    - "test/pipelines.test.js — tool-count assertion bumped 66 → 70 (Plan 05-02 phase complete)"

key-decisions:
  - "D-01/D-02 STRUCTURAL — `schedule` is intentionally ABSENT from CreateEventDefinitionSchema + UpdateEventDefinitionSchema; zod strip drops any agent injection BEFORE build() sees it. No runtime if-branch; the wire path emits `?schedule=false` UNCONDITIONALLY. Verified by test 'M1 STRUCTURAL: agent CANNOT inject schedule:true'."
  - "C5 VISIBILITY — migration: {migrated, warnings} surfaces in dry-run JSON via handler.js's NEW req.migration conditional spread. Opt-in (omitted when migrated:false) keeps preview JSON lean on the v7 happy path. Update path wraps args.changes.config in a synthetic {config:...} DTO so the same migrator visit-tree works for both create and partial-update."
  - "STRICT_NO_ECHO on update — NO pre-flight GET; wire body built from args.changes alone. Mirrors update_stream (D-14) and update_pipeline_rule (D-16). Pitfall 5 (scheduler READ_ONLY contamination) is structurally impossible because nothing from current state ever flows to the wire. body.id is the ONLY non-changes field (Pitfall 8 URL/body match)."
  - "list_event_definitions URL emits page=1&per_page=${limit} UNCONDITIONALLY for byte-stable URLs (Plan 05-05 snapshot pinning); query/sort/order appended only when set. Backed by `/paginated` (Pitfall 1 — bare /definitions is @Deprecated)."
  - "existingMatches uses EXACT-title matchFn only (no fuzzy buckets). Phase 5 does not adopt the 3-bucket exact/case_insensitive/prefix classifier from create_stream / create_input — agents get exact-match or nothing. similarityReason is the literal 'exact'. Plan 05-04 will follow the same pattern against /api/events/notifications/paginated."

patterns-established:
  - "Pattern F: Structural schema enforcement of D-01/D-02 path-level params — absent-from-schema = impossible-to-inject; the agent layer cannot bypass at runtime. Lands here and is canonical for Plan 05-04's update_event_notification (which has no path-level params but inherits the strip-unknown-keys safety)."
  - "Pattern G: Synthetic DTO wrapping for partial-update migrator reuse — when an inner field (e.g. config) needs a path-recognition function written for a full DTO, wrap the partial in `{outerField: partialValue}` before invoking the function. Single migrator implementation serves create + update without code duplication."
  - "Pattern H: handler.js req.migration / req.cascades / req.parseResult / req._confirmationToken parallel slots — every D-xx visibility surface is an opt-in spread on the dry-run preview, populated by build() when relevant and omitted otherwise. Lean previews on the cosmetic-edit path; rich previews on the dangerous-edit path. Plan 05-04 will adopt req.migration without further handler.js changes."

requirements-completed: [EVENT-01, EVENT-02, EVENT-03, EVENT-04]

# Metrics
duration: 10min
completed: 2026-05-15
---

# Phase 5 Plan 02: Event-Definition CRUD Summary

**Four wire tools shipped (list/get/create/update_event_definition) with M1 + C5 acceptance gates landed end-to-end via structural schema enforcement (D-01/D-02) + visible v6→v7 migration + STRICT_NO_ECHO partial-update + CreateEntityRequest envelope wrapping.**

## Performance

- **Duration:** ~10 minutes
- **Started:** 2026-05-15T23:42:38Z
- **Completed:** 2026-05-15T23:53:46Z
- **Tasks:** 3 (all TDD — RED → GREEN per task)
- **Files modified:** 9 source + tests (4 created + 5 modified)

## Accomplishments

- **M1 ACCEPTANCE GATE landed (4 distinct proofs across create + update):**
  1. `create_event_definition` wire path UNCONDITIONALLY `/api/events/definitions?schedule=false` (verified by test "M1 wire-path proof").
  2. `create_event_definition` dry-run `postApplyEstimate.wouldStartScheduling: false` + `state: "DISABLED"` (test "M1 summary proof").
  3. Both create + update schemas REJECT (via zod strip) agent-injected `schedule: true` — verified by tests "M1 STRUCTURAL" + "D-02 STRUCTURAL".
  4. `update_event_definition` wire path UNCONDITIONALLY `/api/events/definitions/{id}?schedule=false` (test "D-02 wire-path proof") — partial updates never silently re-enable scheduling.
- **C5 ACCEPTANCE GATE landed (3 proofs across create + update):**
  1. `create_event_definition`: v6 input `{type:"function", function:"count", parameter:"source"}` surfaces `migration.migrated === true` + `migration.warnings[0].emitted === "count_source"` + wire body's expression is the v7 number-ref (test "C5 GATE: v6 aggregation shape surfaces migration").
  2. `create_event_definition`: v7 input passes through with NO `migration` key in dry-run JSON (test "C5 NO-OP: v7 input passes through").
  3. `update_event_definition`: migration fires CONDITIONALLY — only when `args.changes.config` is touched; cosmetic edits (title-only) emit NO migration key (tests "C5 migration fires" + "C5 migration omitted when changes.config absent").
- **STRICT_NO_ECHO partial-update extended to event-definitions** — Pitfall 5 (scheduler READ_ONLY contamination) is now structurally impossible across 3 mutating tools in 3 phases (update_input C3, update_stream D-14, update_event_definition D-10).
- **`handler.js` req.migration conditional spread** lands as a cross-cutting visibility surface — Plan 05-04 `update_event_notification` will adopt without further amendment.
- **Plan 05-01 `elements` envelope amendment proven end-to-end** — both `list_event_definitions` and `create_event_definition`'s `findExistingMatches` probe unwrap `response.elements` correctly against the `/paginated` endpoint.
- **Full suite: 778 pass / 18 suites / 0 fail** (+33 net-new tests over Plan 05-01 baseline of 745; +11 from Task 1, +11 from Task 2, +11 from Task 3 incl. schema-parity).

## Task Commits

Each task was committed atomically with RED → GREEN TDD discipline:

1. **Task 1 RED:** failing tests for list_event_definitions + get_event_definition — `a6c2a64` (test)
2. **Task 1 GREEN:** EVENT-01 + EVENT-02 read tools shipped — `7cf9dc7` (feat)
3. **Task 2 RED:** failing tests for create_event_definition (M1 + C5 gates) — `5ae0ac2` (test)
4. **Task 2 GREEN:** EVENT-03 create shipped + handler.js req.migration spread — `e3748ec` (feat)
5. **Task 3 RED:** failing tests for update_event_definition (D-02 + STRICT_NO_ECHO + C5) — `d751b71` (test)
6. **Task 3 GREEN:** EVENT-04 update shipped — `39aa566` (feat)

**Plan metadata commit** (to follow this SUMMARY write): contains the SUMMARY, STATE, ROADMAP updates.

_TDD gate compliance: every task ships a `test(...)` commit BEFORE the corresponding `feat(...)` commit (RED → GREEN). All 28 new test cases follow the RED gate; verified via the failing-test count snapshot before each GREEN commit._

## Files Created/Modified

### Created

- `src/tools/events/list-event-definitions.js` (~67 LOC) — EVENT-01. defineListHandler with 6-key narrow projection [id, title, description, priority, state, alert]. Backed by GET `/api/events/definitions/paginated?page=1&per_page=${limit}` with query/sort/order appended only when set. Unwraps `response.elements` (Plan 05-01 amendment).
- `src/tools/events/get-event-definition.js` (~74 LOC) — EVENT-02. Plain async handler; returns full EventDefinitionDto including scheduler READ_ONLY ctx + notifications[]. 404 → wrapGraylogError envelope with `get_event_definition` tool name embedded.
- `src/tools/events/create-event-definition.js` (~95 LOC) — EVENT-03 (M1 + C5 centerpiece). defineMutatingHandler with: D-01 path-level `?schedule=false` UNCONDITIONALLY + D-03/D-04 v6→v7 migration BEFORE existingMatches probe + Pitfall 3 CreateEntityRequest envelope wrap (`{entity, share_request: null}`) + Pitfall 8 definition.id strip via destructure-and-discard + FOUND-11 exact-title existingMatches probe against `/api/events/definitions/paginated` + Pitfall 2 normalize `(raw) => ({id: raw?.id, body: raw})` for the M2 200+full-DTO response shape.
- `src/tools/events/update-event-definition.js` (~105 LOC) — EVENT-04 (D-02 mirror of D-01 + STRICT_NO_ECHO + conditional C5). defineMutatingHandler with: D-02 path-level `?schedule=false` UNCONDITIONALLY + D-10 STRICT_NO_ECHO wire body (conditional spread of args.changes.* per-key — 13 allowed change keys) + Pitfall 5 (no GET round-trip, scheduler contamination impossible) + Pitfall 8 body.id = args.definitionId (URL/body match) + C5 conditional migration via synthetic-DTO wrapping `{config: args.changes.config}` when changes.config touched.

### Modified

- `src/tools/events/index.js` — replaces Plan 05-01 empty stub with 4 imports + 4 register() calls (list/get/create/update). The `void _register;` line dropped; register no longer aliased.
- `src/tools.js` — 4 new tool-definition entries inserted at the Plan 05-01 S5 displacement comment block. Comment block updated to reflect the trajectory: 66 (Plan 05-01) → 68 (Task 1: list + get) → 69 (Task 2: create) → 70 (Task 3: update). Phase 5 final count remains 77 (Plan 05-03 + 05-04 add the remaining 7).
- `src/tools/_shared/handler.js` — `req.migration` added to the conditional-spread chain inside the dry-run preview emitter. Parallel to existing `req.cascades` / `req.parseResult` / `req._confirmationToken` slots. Opt-in (omitted when migrated:false) keeps preview JSON lean on the v7 happy path. Plan 05-04 `update_event_notification` will use this slot without further handler.js changes.
- `test/events.test.js` — 28 net-new tests across 3 sections (Task 1: 9 tests; Task 2: 10 tests; Task 3: 9 tests). Test patterns mirror streams/pipelines test files: eventsMultiCapture_p2 helper for route-based response stubbing, _testConnection seam for synthetic connections, dispatch wiring tests for end-to-end resolution. Plan 05-01's "events/index.js empty barrel" test updated to reflect Plan 05-02 reality (registers handlers; no longer empty).
- `test/schema-parity.test.js` — 4 new schema-parity tests (list/get/create/update_event_definition) under a new "Plan 05-02" section header. All four pass; zod ↔ JSON-Schema keys match exactly.
- `test/pipelines.test.js` — tool-count assertion bumped 66 → 70 with comment block updated to trace the Plan 05-02 count trajectory.

## Decisions Made

- **D-01/D-02 STRUCTURAL enforcement over runtime check:** The `schedule` field is intentionally ABSENT from `CreateEventDefinitionSchema` and `UpdateEventDefinitionSchema`. zod's default `strip` mode drops any agent-injected `schedule: true` BEFORE the build() callback sees the args. The wire path emits `?schedule=false` UNCONDITIONALLY — no `if (args.schedule)` branch exists. This is the strongest enforcement available: an attacker cannot bypass at runtime because the value never enters the wrapper's mental model. Verified by tests "M1 STRUCTURAL" + "D-02 STRUCTURAL" + schema-level test "CreateEventDefinitionSchema strips agent-injected schedule key".
- **req.migration as a handler.js cross-cutting slot:** Rather than embed migration visibility inside `postApplyEstimate` (wrong semantics — "estimate" is for fields the server fills) or inside `summary` (string-only — would lose structure), `migration` joins the existing `cascades` / `parseResult` / `_confirmationToken` opt-in spread chain. Each handler's build() decides whether to include it; handler.js spreads conditionally. Plan 05-04 inherits the same surface for `update_event_notification`.
- **Synthetic DTO wrapping for partial-update migrator reuse:** The migrator's path recognition operates on `definitionDto.config.conditions.expression`. On the create path, `args.definition` already has that shape. On the update path, `args.changes.config` is a partial — wrapping in `{config: args.changes.config}` produces a synthetic DTO the migrator processes identically. Single migrator implementation, two callers, byte-identical migration output. Mirrors the precedent in Plan 04-03 `update_pipeline_rule` (conditional parseResult on `args.changes.source` / `args.changes.structured`).
- **STRICT_NO_ECHO without pre-flight GET:** Unlike `update_stream` (which still does a pre-flight GET for the D-09 mutable defense-in-depth check), `update_event_definition` does NO pre-flight GET. Event definitions carry no `is_editable` field on the wire (verified at EventDefinitionDto.java — no @JsonProperty("is_editable") annotation). The wrapper-side D-07 writable-flag gate in handler.js is the sole safety gate; per-handler defense-in-depth is unnecessary here. This keeps the cosmetic-edit path (title-only changes) at exactly ONE wire request (the PUT itself).
- **Exact-title-only existingMatches (no fuzzy buckets):** `create_event_definition`'s `findExistingMatches` uses `matchFn: (def) => def.title === args.definition.title` and `similarityReason: "exact"`. No case_insensitive / prefix buckets like create_stream / create_input use. Rationale: event definitions don't have the "you probably meant" UX problem streams do — agents working with event definitions usually copy the exact title from a list_event_definitions call. The narrower probe also keeps the existingMatches array empty in the common case (more lean dry-run JSON). Plan 05-04 will adopt the same exact-only policy for notifications.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] handler.js lacked the `req.migration` cross-cutting slot for D-03/C5 visibility**

- **Found during:** Task 2 GREEN (initial run)
- **Issue:** The Task 2 test "C5 GATE: v6 aggregation shape surfaces migration" expected `payload.migration.migrated === true` in the dry-run JSON, but `payload.migration` was undefined. The handler.js dry-run emitter only spreads `req.cascades`, `req.parseResult`, and `req._confirmationToken` conditionally — there was no `req.migration` slot. The plan's Task 2 §A behavior block specifies `...(migration.migrated ? { migration } : {})` in the build descriptor, which is correct, but the wrapper layer needed an amendment to surface that key on the response.
- **Fix:** Added a conditional spread `...(req.migration ? { migration: req.migration } : {})` to the dry-run preview emitter in `src/tools/_shared/handler.js`, parallel to the existing `req.cascades` / `req.parseResult` / `req._confirmationToken` spreads. Comment block documents the C5 mitigation surface + Plan 05-02 amendment provenance.
- **Files modified:** `src/tools/_shared/handler.js`
- **Verification:** All 10 Task 2 tests pass after the handler.js amendment + full suite still green (768 pass; up from 745 baseline).
- **Committed in:** `e3748ec` (Task 2 GREEN — part of the same commit as create-event-definition.js since both files are required for the GREEN gate).

**2. [Rule 1 - Bug] Plan 05-01's "empty barrel" test premise no longer held in Plan 05-02 state**

- **Found during:** Task 1 GREEN (initial dispatch test failure)
- **Issue:** `test/events.test.js` line 440 "events/index.js loads as a no-op side-effect barrel (Plan 05-01 stub)" called `_clearForTests()` which wiped the dispatch registry. ESM module caching prevented a subsequent `import("../src/tools/_register.js")` from re-firing registration. Plan 05-02's dispatch test (further down the file) then saw an empty registry and failed with "Tool not found: list_event_definitions". The test's premise was also obsolete: events/index.js now registers handlers (not an empty stub).
- **Fix:** Updated the empty-barrel test to reflect Plan 05-02 reality — it now asserts the barrel loads cleanly (without `_clearForTests`); removed the obsolete "no event_* names" check. The test comment block was updated to document the deliberate omission of `_clearForTests` per the streams test 10 ES-module-cache pattern (test/streams.test.js:310). My own dispatch test was updated to NOT call `_clearForTests` either.
- **Files modified:** `test/events.test.js`
- **Verification:** All 44 (now 73) events tests pass; dispatch test resolves all 4 new tools end-to-end.
- **Committed in:** `7cf9dc7` (Task 1 GREEN — part of the same commit since the test fix and the GREEN implementation are coupled).

---

**Total deviations:** 2 auto-fixed (1 blocking infrastructure gap, 1 obsolete test premise).
**Impact on plan:** Both fixes were necessary for the GREEN gates to pass. handler.js's req.migration slot is now a cross-cutting visibility surface Plan 05-04 inherits for free (no scope creep — the same amendment would have been needed anyway by Plan 05-04). The empty-barrel test fix repairs Plan 05-01's stub assumption now that handlers are wired; no scope expansion.

## Issues Encountered

- The handler.js cross-cutting visibility gap surfaced only at Task 2 GREEN's `assert.equal(payload.migration.migrated, true)` — the schema, migrator, and build() descriptor were all correct; the wrapper layer was the missing piece. ~2 minutes to diagnose (the existing `req.cascades` / `req.parseResult` slots were the obvious template). Resolved within the same GREEN cycle without an extra commit (Task 2 GREEN ships the handler.js amendment alongside create-event-definition.js).
- The empty-barrel test's `_clearForTests()` call was a Plan 05-01 artifact that became actively problematic in Plan 05-02 once the barrel registered handlers. The streams test 10 precedent (which explicitly documents "do NOT call _clearForTests here") was already in the codebase; the fix was a 5-line refactor.

## User Setup Required

None — no external service configuration required. The MCP server's 4 new tools are immediately usable against any Graylog 7.2 instance with a valid API token (via the existing connection registry).

## Threat Flags

None — every wire surface introduced by this plan is covered by the plan's `<threat_model>` block (T-05-02-01 through T-05-02-10). No new auth paths, no new file-access patterns, no new network endpoints beyond the 4 declared `/api/events/definitions*` routes. The handler.js req.migration amendment is a pure additive spread (no new control flow, no new error path). `src/graylog/errors.js` NOT modified (success criterion preserved).

## TDD Gate Compliance

- Task 1: `test(05-02)` commit `a6c2a64` (RED — 9 failing tests) → `feat(05-02)` commit `7cf9dc7` (GREEN — all 9 pass + empty-barrel test fix). Gates satisfied.
- Task 2: `test(05-02)` commit `5ae0ac2` (RED — 10 failing tests) → `feat(05-02)` commit `e3748ec` (GREEN — all 10 pass + handler.js req.migration amendment + 1 schema-parity test). Gates satisfied.
- Task 3: `test(05-02)` commit `d751b71` (RED — 9 failing tests) → `feat(05-02)` commit `39aa566` (GREEN — all 9 pass + 1 schema-parity test). Gates satisfied.

All 3 tasks ship the `test(...)` commit BEFORE the corresponding `feat(...)` commit. The fail-fast rule (RED tests should fail before any implementation) was honoured at each gate — the RED commit's test output was inspected to confirm `not ok` markers BEFORE proceeding to GREEN.

## Next Plan Readiness

**Plan 05-03 (delete + enable + disable_event_definition) is unblocked.** Every symbol it needs is shipped:

- `get_event_definition` returns the full DTO including `notifications[]` — Plan 05-03 `delete_event_definition`'s D-08 informational cascade reads this list to surface which notifications would lose their link.
- `list_event_definitions` consumes `/api/events/definitions/paginated` with `?page=1&per_page=${limit}` — Plan 05-03 `delete_event_definition`'s id-resolution probe can re-use the same path.
- `handler.js` `req.migration` slot is ready (no Plan 05-03 changes needed; Plan 05-03 has no migration surface anyway).
- The 4 byte-stable response shapes (`{tool, connection, definition}` for get; `{tool, connection, count, limit, fields, items}` for list; dry-run preview JSON for create + update) are locked — Plan 05-05 can freeze them as snapshot fixtures.

**Plan 05-04 (event-notification CRUD) is unblocked.** Plans 05-03 and 05-04 are independent (no inter-dependencies); they can execute in any order. The `findExistingMatches({listPath: "/api/events/notifications/paginated"})` probe will work for `create_event_notification` thanks to the Plan 05-01 envelope amendment proven by Plan 05-02's Task 2.

**Tool count trajectory:**

| Plan       | Action                                                                         | toolDefinitions.length |
| ---------- | ------------------------------------------------------------------------------ | ---------------------- |
| 05-01      | Remove v2.3 list_event_definitions + list_event_notifications                  | 68 → 66                |
| 05-02      | Add list/get/create/update_event_definition                                    | 66 → **70**            |
| 05-03      | Add delete_event_definition + enable + disable                                 | 70 → 73                |
| 05-04      | Add list/create/update/delete_event_notification                               | 73 → **77** (phase-end) |

## Self-Check: PASSED

- **Files exist:**
  - `/home/c_perronnet/git/graylog-mcp/src/tools/events/list-event-definitions.js` — FOUND
  - `/home/c_perronnet/git/graylog-mcp/src/tools/events/get-event-definition.js` — FOUND
  - `/home/c_perronnet/git/graylog-mcp/src/tools/events/create-event-definition.js` — FOUND
  - `/home/c_perronnet/git/graylog-mcp/src/tools/events/update-event-definition.js` — FOUND
  - `/home/c_perronnet/git/graylog-mcp/src/tools/events/index.js` — FOUND (modified)
  - `/home/c_perronnet/git/graylog-mcp/src/tools.js` — FOUND (modified)
  - `/home/c_perronnet/git/graylog-mcp/src/tools/_shared/handler.js` — FOUND (modified)
  - `/home/c_perronnet/git/graylog-mcp/test/events.test.js` — FOUND (modified)
  - `/home/c_perronnet/git/graylog-mcp/test/schema-parity.test.js` — FOUND (modified)
  - `/home/c_perronnet/git/graylog-mcp/test/pipelines.test.js` — FOUND (modified)
- **Commits in git log:**
  - `a6c2a64` (Task 1 RED) — FOUND
  - `7cf9dc7` (Task 1 GREEN) — FOUND
  - `5ae0ac2` (Task 2 RED) — FOUND
  - `e3748ec` (Task 2 GREEN) — FOUND
  - `d751b71` (Task 3 RED) — FOUND
  - `39aa566` (Task 3 GREEN) — FOUND
- **Full suite green:** `npm test` → 778 pass / 18 suites / 0 fail.
- **`src/graylog/errors.js` NOT modified** — success criterion preserved.

---
*Phase: 05-events-notifications*
*Completed: 2026-05-15*
