---
phase: 05-events-notifications
plan: 03
subsystem: event-definition-lifecycle
tags: [wildcard-empty-body, d-07, d-08-informational-cascade, lifecycle-as-mutation, leaf-delete, pitfall-4]

# Dependency graph
requires:
  - phase: 05-events-notifications
    provides: Plan 05-01 schemas (EnableEventDefinitionSchema, DisableEventDefinitionSchema, DeleteEventDefinitionSchema); Plan 05-02 get_event_definition handler shape (notifications[] array consumed by D-08 pre-flight); Plan 05-01 05-U1-SMOKE.md UNREACHABLE → body:undefined decision for enable/disable wire body
  - phase: 01-inputs-extractors
    provides: D-05 cascade enumeration precedent from delete_input.js (best-effort pre-flight try/catch; cascades object spread by handler.js); D-08 lifecycle-as-mutation precedent from start_input + stop_input (defineMutatingHandler composition)
provides:
  - 3 wire tools registered against dispatch — enable_event_definition + disable_event_definition + delete_event_definition (toolDefinitions.length 70 → 73)
  - Pitfall 4 WILDCARD empty-body pattern landed end-to-end via ENABLE_DISABLE_EMPTY_BODY = undefined constant in both enable/disable sibling handlers
  - D-08 INFORMATIONAL cascade pattern locked: notifications array in dry-run preview, NO confirmation token, NO cascade-hash computation, NO drift refusal at apply (mirror of Phase 1 delete_input D-05 pattern)
  - Tool count assertion bumped 70 → 72 (Task 1) → 73 (Task 2) with single-line edit in test/pipelines.test.js (assertion text + count literal in lockstep)
  - 21 net-new tests in test/events.test.js: 11 for Task 1 (enable + disable wire/empty-body/postApplyEstimate/writable-gate/idempotency/dryRun-default/dispatch), 10 for Task 2 (delete wire/cascade/no-token/best-effort-404/best-effort-403/static-grep/postApplyEstimate/writable-gate/apply-happy/dispatch); 3 net-new schema-parity tests
affects: [05-04, 05-05, 07-finalization]

# Tech tracking
tech-stack:
  added: []  # No new npm deps — composes Plan 05-01 zod schemas + Plan 0 defineMutatingHandler + Plan 0 toIdBody normalize
  patterns:
    - "Pattern A: Sibling module constant for empty-body shape decision — ENABLE_DISABLE_EMPTY_BODY = undefined duplicated in enable-event-definition.js + disable-event-definition.js; refactor to shared module only if a third consumer appears (Plan 05-04 does NOT add one — delete_event_notification uses JSON bodies)"
    - "Pattern B: D-08 informational-only cascade — pre-flight GET surfaces a list in cascades.* in dry-run preview, but no confirmationToken is set and no cascade-hash is computed. Mirrors Phase 1 delete_input's extractors enumeration; contrasts with Phase 2 delete_index_set + Phase 3 delete_stream which DO issue confirmation tokens"
    - "Pattern C: Static-grep guard test — assert source file does NOT contain forbidden symbols (computeCascadeHash, _confirmationToken, computeNotificationCascadeHash) to lock the informational-only invariant; comments rewritten to reference 'cascade hash' / 'confirmation token' generically rather than the JavaScript identifiers"
    - "Pattern D: Writable-gate-before-build precedent — writable=false short-circuits in handler.js step 3 BEFORE the build() callback fires, so the pre-flight GET in delete_event_definition never executes against a read-only connection. Defense-in-depth: src/graylog/client.js's per-request writable check is a secondary safety net"

key-files:
  created:
    - "src/tools/events/enable-event-definition.js (~55 LOC) — EVENT-06 part A; PUT /api/events/definitions/{id}/schedule with empty body; defineMutatingHandler composition; ENABLE_DISABLE_EMPTY_BODY = undefined per 05-U1-SMOKE.md UNREACHABLE; postApplyEstimate.state ENABLED"
    - "src/tools/events/disable-event-definition.js (~43 LOC) — EVENT-06 part B; PUT /api/events/definitions/{id}/unschedule; symmetric mirror of enable; postApplyEstimate.state DISABLED"
    - "src/tools/events/delete-event-definition.js (~83 LOC) — EVENT-05; DELETE /api/events/definitions/{id}; D-08 informational cascade with best-effort pre-flight GET; mirrors delete_input.js try/catch shape"
  modified:
    - "src/tools/events/index.js — 3 new register() calls + 3 corresponding imports for the new handlers (Plan 05-03 Task 1: enable + disable; Task 2: delete)"
    - "src/tools.js — 3 net-new tool-definition entries inserted after update_event_definition (count trail comment block: Plan 05-02 → 70; Plan 05-03 Task 1 → 72; Plan 05-03 Task 2 → 73)"
    - "test/events.test.js — 21 net-new tests in 2 sections (Plan 05-03 Task 1: 11 tests; Plan 05-03 Task 2: 10 tests); imports widened to include _setConnectionsForTests + _clearConnectionsForTests for writable-gate tests"
    - "test/schema-parity.test.js — 3 net-new schema-parity tests under a new 'Plan 05-03' section header (enable_event_definition, disable_event_definition, delete_event_definition; all extend mutatingBase with {definitionId})"
    - "test/pipelines.test.js — tool-count assertion bumped 70 → 73 in a single edit at GREEN gate of Task 2; count-trail comment block updated to reflect the Phase 5 trajectory"

key-decisions:
  - "Pattern A inline-constant over shared module: ENABLE_DISABLE_EMPTY_BODY duplicated in enable + disable sibling files. Plan 05-04's delete_event_notification uses JSON bodies (not WILDCARD), so no third consumer materializes. Refactor cost (one extra file + one extra import in two callers) exceeds duplication cost (one line in two files) until a third consumer appears."
  - "Static-grep guard rewords contrast comments to avoid literal forbidden symbols: the test asserts ZERO matches for computeCascadeHash / _confirmationToken / computeNotificationCascadeHash in delete-event-definition.js. The narrative comments in the handler had to be rewritten to use 'cascade hash' / 'confirmation token' generically rather than the JavaScript identifiers; semantic content preserved verbatim."
  - "Writable-gate test for delete uses a poisoned capture function (throws on any HTTP call): proves the gate fires BEFORE the pre-flight GET, not just before the DELETE. This is a STRONGER test than the inputs.test.js writable test which only asserts the error envelope shape — it additionally proves no upstream traffic is generated for a read-only connection."
  - "Apply HAPPY test asserts captured.deepEqual ordering: GET (pre-flight) MUST fire before DELETE (apply) in delete_event_definition. Without ordering proof, an accidental refactor that moved the cascade pre-flight from build() to apply() would still pass a 'both fired' check but break the 'cascade visible in dry-run' invariant."

patterns-established:
  - "Pattern E: Single 05-U1-SMOKE.md decision artifact resolves wire-body shape for an entire phase of WILDCARD endpoints — Plan 05-01 produced the artifact, Plan 05-03 consumed it. Future phases with @Consumes(WILDCARD) endpoints should follow the same Wave-0 smoke + Wave-3 consumption pattern."
  - "Pattern F: D-08 informational cascade as the leaf-delete contract — when a downstream resource SURVIVES the delete (its identity vanishes only in the upstream's wiring view), the cascade preview is informational. When the downstream IS lost (Phase 2/3/4 destructive deletes), a confirmation token IS issued. Plan 05-04 will follow the LOAD-BEARING variant (D-09 cascade-hash drift refusal) for delete_event_notification."

requirements-completed: [EVENT-05, EVENT-06]

# Metrics
duration: 7min
completed: 2026-05-16
---

# Phase 5 Plan 03: Event-Definition Lifecycle Summary

**Three wire tools shipped (enable + disable + delete_event_definition) closing EVENT-05 + EVENT-06 — Pitfall 4 WILDCARD empty-body via ENABLE_DISABLE_EMPTY_BODY = undefined constant; D-08 informational cascade via best-effort pre-flight GET; static-grep guard test locks the no-cascade-hash invariant.**

## Performance

- **Duration:** ~7 minutes
- **Started:** 2026-05-16T00:01:07Z
- **Completed:** 2026-05-16T00:09:06Z
- **Tasks:** 2 (both TDD — RED → GREEN per task)
- **Files modified:** 8 source + tests (3 created + 5 modified)

## Accomplishments

- **EVENT-06 (Pitfall 4) end-to-end:** `enable_event_definition` + `disable_event_definition` send empty body (per 05-U1-SMOKE.md UNREACHABLE → `body: undefined`) to symmetric wire paths `/api/events/definitions/{id}/schedule` and `/unschedule`. Both compose through `defineMutatingHandler` so dryRun:true default + writable-flag gate + idempotency-key dedupe + zod validation + structured error envelopes inherit uniformly (lifecycle-as-mutation contract, mirror of Phase 1 INPUT-07 start_input / stop_input).
- **EVENT-05 (D-08 informational cascade) end-to-end:** `delete_event_definition` pre-flights `GET /api/events/definitions/{id}` to project `notifications[]` into `cascades.notifications` in the dry-run preview. NO confirmation token issued, NO cascade hash computed, NO drift refusal at apply — notifications survive the delete (independent resources owned by EVENT-07..EVENT-09); only the def→notification wiring vanishes.
- **Static-grep invariant lock:** A dedicated test reads `src/tools/events/delete-event-definition.js` from disk and asserts ZERO matches for `computeCascadeHash` / `_confirmationToken` / `computeNotificationCascadeHash`. Any future refactor attempting to upgrade the informational cascade to a refusal gate will fail this test loudly.
- **Writable-gate proof:** The Task 2 writable-gate test uses a poisoned capture function that throws on any HTTP call — proves the gate fires BEFORE the pre-flight GET, not just before the DELETE.
- **Apply-ordering proof:** The Task 2 apply HAPPY test asserts `captured.deepEqual` ordering — GET (pre-flight from build) MUST fire before DELETE (apply) in the same handler invocation. Without this ordering check, an accidental refactor that moved the cascade pre-flight from build() to apply() would still pass a "both fired" check but break the "cascade visible in dry-run" invariant.
- **Full suite: 802 pass / 18 suites / 0 fail** (+24 net-new tests over Plan 05-02 baseline of 778; +11 from Task 1, +10 from Task 2, +3 from schema-parity).

## Task Commits

Each task was committed atomically with RED → GREEN TDD discipline:

1. **Task 1 RED:** failing tests for enable_event_definition + disable_event_definition — `db6f0a2` (test)
2. **Task 1 GREEN:** EVENT-06 enable + disable shipped — `e623339` (feat)
3. **Task 2 RED:** failing tests for delete_event_definition (D-08 informational cascade) — `8957d1b` (test)
4. **Task 2 GREEN:** EVENT-05 delete shipped — `539cd67` (feat)

**Plan metadata commit** (to follow this SUMMARY write): contains the SUMMARY, STATE, ROADMAP, REQUIREMENTS updates.

_TDD gate compliance: every task ships a `test(...)` commit BEFORE the corresponding `feat(...)` commit (RED → GREEN). Per the fail-fast rule, both RED commits' test output was inspected to confirm `not ok` markers (11 fails for Task 1 RED; 10 fails for Task 2 RED) BEFORE proceeding to GREEN._

## Files Created/Modified

### Created

- `src/tools/events/enable-event-definition.js` (~55 LOC) — EVENT-06 part A. `defineMutatingHandler` composition + module-level `ENABLE_DISABLE_EMPTY_BODY = undefined` per 05-U1-SMOKE.md UNREACHABLE. Wire path `/api/events/definitions/${args.definitionId}/schedule`. `postApplyEstimate: { id, state: "ENABLED" }` surfaces the eventually-consistent target. `normalize: (raw) => toIdBody(raw, { idFields: ["id"] })` extracts id from the M2 200+full-DTO response.
- `src/tools/events/disable-event-definition.js` (~43 LOC) — EVENT-06 part B. Symmetric mirror of enable; only deltas are path segment `/unschedule` and `state: "DISABLED"`. Same constant kept in sync (sibling-file duplication; refactor to shared module only if a third WILDCARD consumer appears).
- `src/tools/events/delete-event-definition.js` (~83 LOC) — EVENT-05. `defineMutatingHandler` composition. Best-effort pre-flight `GET /api/events/definitions/{id}` in build() — mirrors `src/tools/inputs/delete-input.js:30-47` try/catch shape line-for-line; only path + field projection differ. Returns `cascades: { notifications }` for the dry-run preview JSON. Apply is plain DELETE with `body: undefined`. `postApplyEstimate: { id, deleted: true }`.

### Modified

- `src/tools/events/index.js` — 3 new register() calls + 3 corresponding imports under a new Plan 05-03 Task 1/Task 2 header block (preserves Plan 05-02's existing 4 register() calls verbatim).
- `src/tools.js` — 3 net-new tool-definition entries inserted in narrative order after `update_event_definition`. Each entry's `description` field documents the Pitfall 4 / D-07 / D-08 / lifecycle-as-mutation rationale so an agent reading just the description understands the wire shape. Count trail comment block updated.
- `test/events.test.js` — 21 net-new tests in 2 sections. Task 1 section pins both wire paths, both empty-body shapes (with a non-brittle check that accepts both `body: undefined` and `body: ""`), both postApplyEstimate.state values, the writable-gate inheritance for both, the 32-hex idempotency-key derivation, the dryRun:true default, and the dispatch resolution. Task 2 section pins the DELETE wire path, the informational cascade content, the NO-confirmation-token invariant, the best-effort 404 + 403 pre-flight failures, the static-grep guard, the postApplyEstimate, the writable-gate-before-build precedence, the apply HAPPY ordering, and the dispatch resolution. The events.test.js imports were widened to include `_setConnectionsForTests` + `_clearConnectionsForTests` for the writable-gate tests.
- `test/schema-parity.test.js` — 3 net-new schema-parity tests under a new "Plan 05-03" section header. All three extend `mutatingBase` (3 keys) with `{definitionId}` → 4 keys total. Plain `.extend()` without superRefine wrapping, so `getShape` returns `.shape` directly.
- `test/pipelines.test.js` — tool-count assertion bumped 70 → 72 (Task 1 GREEN) → 73 (Task 2 GREEN) in two single-line edits. Count-trail comment block updated.

## Decisions Made

- **Inline constant per file vs shared module:** `ENABLE_DISABLE_EMPTY_BODY = undefined` is duplicated in `enable-event-definition.js` and `disable-event-definition.js`. The plan explicitly authorized this (and the refactor-if-third-consumer trigger). Plan 05-04 confirms the trigger does NOT fire — `delete_event_notification` uses JSON bodies, not WILDCARD empty body. Refactor cost (one extra file + one extra import in two callers) exceeds duplication cost (one line in two files) until a third consumer appears.
- **Static-grep guard reworded comments rather than relaxed test:** The Task 2 static-grep test (`delete_event_definition: NO cascade-hash code path (static-grep proof)`) initially failed because the handler's contrast narrative referenced `computeNotificationCascadeHash` + `_confirmationToken` by their literal JavaScript identifiers. The plan's <verify> block explicitly says `→ ZERO matches`. Fix: rewrite the contrast comments to use generic English ("cascade hash" / "confirmation token") rather than the identifiers. Semantic content preserved; the test stays loud against any future code-level reintroduction of those symbols.
- **Writable-gate poisoned-capture test:** The Task 2 writable-gate test uses `_setCaptureRequest_p2(() => { throw new Error("Pre-flight GET fired despite writable=false; gate is broken"); })`. This is a STRONGER assertion than the inputs.test.js writable test (which only asserts the error envelope shape) — it additionally proves no upstream traffic is generated for a read-only connection. Worth the extra 3 lines for the structural enforcement.
- **Apply HAPPY ordering proof:** Asserting `captured.deepEqual([{method:"GET",path:"..."}, {method:"DELETE",path:"..."}])` (rather than just `captured.length === 2`) catches accidental refactors that swap the order or move the pre-flight GET from `build()` to `apply()`. The order matters: the cascade preview MUST be available before the dry-run preview emits.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Static-grep test failed because comments referenced forbidden JavaScript identifiers**

- **Found during:** Task 2 GREEN (initial run)
- **Issue:** The static-grep test (`delete_event_definition: NO cascade-hash code path (static-grep proof)`) asserted ZERO matches for `_confirmationToken` / `computeCascadeHash` / `computeNotificationCascadeHash` in the source file. The handler's contrast comments (explaining D-08 vs D-09) referenced both `computeNotificationCascadeHash` (line 21) and `_confirmationToken` (line 82) by their literal JavaScript identifiers, so the grep matched. The intent of the test is to catch CODE-level reintroduction of those symbols, not commentary about them.
- **Fix:** Reworded both comment occurrences to use generic English ("64-hex cascade hash via the Plan 05-01 thin wrapper from src/tools/_shared/cascade-hash.js" replaces the `computeNotificationCascadeHash` mention; "apply-time confirmation token" replaces the `_confirmationToken` mention). Semantic content preserved verbatim; the test now sees zero matches.
- **Files modified:** `src/tools/events/delete-event-definition.js`
- **Verification:** `grep -n '_confirmationToken\|computeCascadeHash\|computeNotificationCascadeHash' src/tools/events/delete-event-definition.js` → zero output; static-grep test passes; full suite stays at 802/802.
- **Committed in:** `539cd67` (Task 2 GREEN — both the handler ship and the comment rewrite are in the same commit since they're the same file).

---

**Total deviations:** 1 auto-fixed (1 bug: comment-vs-test-intent mismatch).
**Impact on plan:** No scope creep. The fix preserved every word of the contrast narrative; only the JavaScript identifier spellings changed. The test stays loud against future code-level reintroduction.

## Issues Encountered

- The static-grep test was a slightly more aggressive guard than the plan's text indicated (the plan's `<verify>` text was `grep -n '_confirmationToken|computeCascadeHash|computeNotificationCascadeHash' src/tools/events/delete-event-definition.js → ZERO matches` — which is exactly what the test does). The fix took ~1 minute (two comment rewrites + test re-run); no commit overhead.

## User Setup Required

None — no external service configuration required. The MCP server's 3 new tools are immediately usable against any Graylog 7.2 instance with a valid API token (via the existing connection registry).

## Threat Flags

None — every wire surface introduced by this plan is covered by the plan's `<threat_model>` block (T-05-03-01 through T-05-03-08). No new auth paths, no new file-access patterns. The 3 new endpoints (PUT /schedule, PUT /unschedule, DELETE /events/definitions/{id}) are all variants of existing /api/events/definitions/{id} surface already wired by Plan 05-02. `src/graylog/errors.js` NOT modified (success criterion preserved).

## TDD Gate Compliance

- Task 1: `test(05-03)` commit `db6f0a2` (RED — 11 failing tests) → `feat(05-03)` commit `e623339` (GREEN — all 11 pass + schema-parity tests for both new tools + tool-count bump 70→72). Gates satisfied.
- Task 2: `test(05-03)` commit `8957d1b` (RED — 10 failing tests) → `feat(05-03)` commit `539cd67` (GREEN — all 10 pass + schema-parity test + tool-count bump 72→73 + 1 in-commit comment rewrite for the static-grep guard). Gates satisfied.

Both tasks ship the `test(...)` commit BEFORE the corresponding `feat(...)` commit. The fail-fast rule (RED tests should fail before any implementation) was honoured at each gate — the RED commit's test output was inspected to confirm the expected `not ok` count BEFORE proceeding to GREEN.

## D-08 Informational-Cascade Test Fixture (Plan 05-05 anchor)

For Plan 05-05's snapshot fixture #6 (`delete_event_definition` dry-run with 2 notifications), use the byte-stable shape that the Task 2 test pins:

```json
{
  "dryRun": true,
  "tool": "delete_event_definition",
  "connection": "fake",
  "idempotencyKey": "<32-hex>",
  "summary": "Delete event definition abc (any notifications referenced lose this def's wiring; notifications themselves survive)",
  "preview": {
    "method": "DELETE",
    "path": "/api/events/definitions/abc"
  },
  "postApplyEstimate": { "id": "abc", "deleted": true },
  "existingMatches": [],
  "cascades": {
    "notifications": [
      { "notification_id": "notif-1", "notification_parameters": null },
      { "notification_id": "notif-2", "notification_parameters": { "threshold": 10 } }
    ]
  },
  "applyHint": "Re-call with dryRun: false to apply"
}
```

Key invariants Plan 05-05 should pin verbatim:
- `confirmationToken` key MUST be absent (D-08 informational only).
- `cascades.notifications` preserves the order returned by the pre-flight GET.
- `notification_parameters: null` for notifications without parameters (NOT undefined or missing).
- `existingMatches: []` (a delete tool doesn't probe for matches; the default handler.js empty-array applies).

## Next Plan Readiness

**Plan 05-04 (event-notification CRUD) is unblocked.** Every symbol it needs is shipped:

- `defineMutatingHandler` skeleton from Plan 05-03 is identical to what Plan 05-04 needs for `create_event_notification` + `update_event_notification` + `delete_event_notification`.
- `D-09 cascade-hash` for `delete_event_notification` flips the D-08 informational dial to a REFUSAL gate — `computeNotificationCascadeHash` (Plan 05-01) is the canonical thin wrapper; the two frozen 64-hex literals from Plan 05-01 are the snapshot anchors.
- `events/index.js` barrel is ready for 4 more register() calls (Plan 05-04 adds them).
- Tool count is at 73; Plan 05-04 adds 4 (list_event_notifications, create_event_notification, update_event_notification, delete_event_notification) → 77 (Phase 5 phase-end).

**Plan 05-05 (snapshot fixture freeze) is unblocked.** All M1 + C5 + WILDCARD + D-08 acceptance gates are pinned by Phase 5 tests; Plan 05-05 freezes them as byte-stable snapshot fixtures. The D-08 fixture #6 shape is documented above for Plan 05-05's snapshot anchor.

## Tool Count Trajectory (Phase 5)

| Plan       | Action                                                                         | toolDefinitions.length |
| ---------- | ------------------------------------------------------------------------------ | ---------------------- |
| 05-01      | Remove v2.3 list_event_definitions + list_event_notifications                  | 68 → 66                |
| 05-02      | Add list/get/create/update_event_definition                                    | 66 → 70                |
| **05-03**  | **Add enable + disable + delete_event_definition**                             | **70 → 73**            |
| 05-04      | Add list/create/update/delete_event_notification                               | 73 → **77** (phase-end) |

## Self-Check: PASSED

- **Files exist:**
  - `/home/c_perronnet/git/graylog-mcp/src/tools/events/enable-event-definition.js` — FOUND
  - `/home/c_perronnet/git/graylog-mcp/src/tools/events/disable-event-definition.js` — FOUND
  - `/home/c_perronnet/git/graylog-mcp/src/tools/events/delete-event-definition.js` — FOUND
  - `/home/c_perronnet/git/graylog-mcp/src/tools/events/index.js` — FOUND (modified)
  - `/home/c_perronnet/git/graylog-mcp/src/tools.js` — FOUND (modified)
  - `/home/c_perronnet/git/graylog-mcp/test/events.test.js` — FOUND (modified)
  - `/home/c_perronnet/git/graylog-mcp/test/schema-parity.test.js` — FOUND (modified)
  - `/home/c_perronnet/git/graylog-mcp/test/pipelines.test.js` — FOUND (modified)
- **Commits in git log:**
  - `db6f0a2` (Task 1 RED) — FOUND
  - `e623339` (Task 1 GREEN) — FOUND
  - `8957d1b` (Task 2 RED) — FOUND
  - `539cd67` (Task 2 GREEN) — FOUND
- **Full suite green:** `npm test` → 802 pass / 18 suites / 0 fail.
- **`src/graylog/errors.js` NOT modified** — success criterion preserved.
- **Static-grep guard:** `grep -n '_confirmationToken\|computeCascadeHash\|computeNotificationCascadeHash' src/tools/events/delete-event-definition.js` → zero matches.
- **No npm deps added** — `package.json` untouched.

---
*Phase: 05-events-notifications*
*Completed: 2026-05-16*
