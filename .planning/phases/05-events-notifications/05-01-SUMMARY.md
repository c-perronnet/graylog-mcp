---
phase: 05-events-notifications
plan: 01
subsystem: foundation-schemas
tags: [zod, discriminator, cascade-hash, v6-to-v7-migration, s5-displacement, paginated-envelope, event-definitions, event-notifications]

# Dependency graph
requires:
  - phase: 03-streams-stream-rules
    provides: computeCascadeHash keyed-buckets canonical (D-02); discriminator pattern from streams/schemas.js StreamRuleSchema; S5 displacement template
  - phase: 04-pipelines-pipeline-rules-connections
    provides: computeRuleCascadeHash thin-wrapper pattern (D-14) — mirrored verbatim for D-09 computeNotificationCascadeHash
provides:
  - elements envelope unwrap in conflict.js for /paginated PageListResponse shape (Pitfall 1)
  - computeNotificationCascadeHash({notificationId, eventDefIds}) thin wrapper (D-09)
  - 11 per-tool zod schemas covering all EVENT-XX wire surfaces
  - NotificationConfigSchema = z.discriminatedUnion("type", [...6 variants...]) — D-05 corrected
  - EventDefinitionDtoSchema + EventDefinitionDtoChangesSchema common shapes
  - migrateV6ToV7AggregationConditions closed-set 8-name migrator with visible warnings (D-03/D-04 / C5)
  - V6_FUNCTION_NAMES frozen Set (8 entries) for downstream Plan 05-02 re-use
  - events/index.js empty side-effect barrel ready for Plans 05-02/03/04
  - _register.js S5 displacement of v2.3 list_event_definitions + list_event_notifications
  - 05-U1-SMOKE.md decision artifact (body:undefined default — UNREACHABLE branch)
  - 2 frozen 64-hex Phase 5 cascade-hash literals locked in test/cascade-hash.test.js for Plan 05-04 drift detection
affects: [05-02, 05-03, 05-04, 05-05, 07-finalization]

# Tech tracking
tech-stack:
  added: []  # No new npm deps — zod 3.25.76 already present
  patterns:
    - "Cross-field refinement at the union level (NotificationConfigSchema.superRefine) because z.discriminatedUnion requires raw ZodObject variants"
    - "Frozen closed-set Set<string> for migration heuristic anchoring (V6_FUNCTION_NAMES = Object.freeze(new Set([...])))"
    - "Thin semantic wrapper around computeCascadeHash with byte-identical canonical JSON (Phase 4 D-14 precedent)"
    - "Empty side-effect barrel as a Wave-0 deliverable (handlers populate later)"
    - "Closed-set zod discriminator with strict rejection at parse before any HTTP (T-05-01-01 mitigation)"

key-files:
  created:
    - "src/tools/events/schemas.js — 11 schemas + 6-variant NotificationConfigSchema + EventDefinitionDtoSchema (~330 LOC)"
    - "src/tools/events/v6-to-v7-migration.js — closed-set 8-name v6→v7 aggregation migrator (~115 LOC)"
    - "src/tools/events/index.js — empty side-effect barrel for Plans 05-02/03/04 (~15 LOC)"
    - ".planning/phases/05-events-notifications/05-U1-SMOKE.md — body:undefined default (UNREACHABLE)"
    - "test/events.test.js — 35 tests covering all schemas + migrator + barrel (~460 LOC)"
  modified:
    - "src/tools/_shared/conflict.js — append response?.elements at position 5 of envelope-unwrap chain (BEFORE items)"
    - "src/tools/_shared/cascade-hash.js — append computeNotificationCascadeHash thin wrapper (~55 LOC)"
    - "src/tools/_register.js — remove v2.3 list_event_* imports + register lines; add events barrel side-effect import + S5 displacement comment block"
    - "src/tools.js — remove v2.3 list_event_definitions + list_event_notifications tool-definition entries"
    - "test/cascade-hash.test.js — add 7 new Phase 5 tests with 2 frozen 64-hex literal anchors (Plan 05-04 drift detection)"
    - "test/conflict.test.js — add 2 new tests for elements envelope normalization + chain position guard"
    - "test/pipelines.test.js — bump tool-count assertion from 68 → 66 (Plan 05-01 S5 displacement)"

key-decisions:
  - "Cross-field refinements moved to outer NotificationConfigSchema.superRefine (zod v3 limitation: z.discriminatedUnion requires raw ZodObject variants)"
  - "EventProcessorConfig kept as permissive z.record(z.unknown()) — forward-compat for new variants without wrapper schema changes; v6→v7 migrator narrows config.conditions.expression"
  - "U1 SMOKE: UNREACHABLE branch → body:undefined default for enable/disable_event_definition (HTTP-layer hygiene; reversible to body:'' if proxy returns 411/415)"
  - "Tool-count assertion temporarily drops to 66 in Plan 05-01; trail documented (Plan 05-02 → 67; Plan 05-04 → 71; phase-end 77)"
  - "Test fixture frozen literals: empty-cascade hash = e2ba7147...269c; 2-cascade hash = d986f30b...02dd — Plan 05-04 reuses as snapshot anchors"

patterns-established:
  - "Pattern A: Discriminator with outer .superRefine for cross-field refinements (zod v3 discriminatedUnion + ZodEffects workaround)"
  - "Pattern B: Closed-set migration heuristic via Object.freeze(new Set([...])) — T-05-01-02 threat anchor against open-string mis-migration"
  - "Pattern C: Thin semantic wrapper around computeCascadeHash with frozen 64-hex literal pinning in test (T-05-01-07 byte-identity drift detection)"
  - "Pattern D: Empty side-effect barrel as Wave-0 hand-off — Plans N+1/N+2/N+3 populate without touching _register.js again"
  - "Pattern E: Cross-cutting envelope amendment via additive line in fallback chain (no breaking change; back-compat preserved by per-domain envelope tests)"

requirements-completed: []  # Plan 05-01 ships foundation primitives; no EVENT-XX requirements close here. Plans 05-02/03/04 close EVENT-01..EVENT-09.

# Metrics
duration: 11min
completed: 2026-05-15
---

# Phase 5 Plan 01: Foundation — schemas, migrator, cascade-hash wrapper, S5 displacement Summary

**11 zod schemas + 6-variant NotificationConfigSchema discriminator + closed-set 8-name v6→v7 aggregation migrator + computeNotificationCascadeHash thin wrapper + conflict.js elements envelope amendment + S5 displacement of v2.3 list_event_* — all foundation primitives Plans 05-02/03/04 will compose against.**

## Performance

- **Duration:** ~11 minutes
- **Started:** 2026-05-15T23:22:15Z
- **Completed:** 2026-05-15T23:33:05Z
- **Tasks:** 3 (2 TDD + 1 refactor)
- **Files modified:** 9 source + tests + planning artifacts

## Accomplishments

- Six-variant `NotificationConfigSchema` discriminator (D-05 corrected) rejects `script-notification-v1` and `pagerduty-notification-v1` at `zod.parse` BEFORE any HTTP call — T-05-01-01 mitigation in production.
- `migrateV6ToV7AggregationConditions` closed-set migrator with visible warnings — the C5 mitigation surface is in place for Plan 05-02's `create_event_definition` dry-run to consume.
- `computeNotificationCascadeHash` thin wrapper around `computeCascadeHash` with byte-identical canonical JSON; two frozen 64-hex literals locked in `test/cascade-hash.test.js` as Plan 05-04 drift-detection anchors.
- `conflict.js` envelope chain gains `response?.elements` at position 5 (BEFORE `items`) — Plan 05-02's `create_event_definition` existingMatches probe against `/api/events/definitions/paginated` works end-to-end.
- S5 displacement of v2.3 `list_event_definitions` + `list_event_notifications` complete; barrel ready for Plans 05-02/03/04 to populate.
- 35 new schema + migrator tests + 9 new cascade-hash + conflict tests; full suite **745 passing**, zero regressions.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: failing tests for elements envelope + computeNotificationCascadeHash** — `0c06163` (test)
2. **Task 1 GREEN: elements envelope + computeNotificationCascadeHash wrapper** — `f05fd66` (feat)
3. **Task 2 RED: failing tests for events schemas + v6→v7 migrator** — `ed23a40` (test)
4. **Task 2 GREEN: events schemas + v6→v7 migrator + empty side-effect barrel** — `3af06cf` (feat)
5. **Task 3: S5 displacement of v2.3 list_event_* + 05-U1-SMOKE artifact** — `9ba9ba8` (refactor)

**Plan metadata commit** (to follow this SUMMARY write): contains the SUMMARY, STATE, ROADMAP updates.

_TDD gate compliance: Tasks 1 and 2 each ship a `test(...)` commit BEFORE the corresponding `feat(...)` commit (RED → GREEN). Task 3 is plumbing/refactor with no behavior change beyond what was already covered by existing tests; assertion bump (68 → 66) is the only test-side delta._

## Files Created/Modified

### Created

- `src/tools/events/schemas.js` (~330 LOC) — 11 zod schemas: `ListEventDefinitionsSchema`, `GetEventDefinitionSchema`, `CreateEventDefinitionSchema`, `UpdateEventDefinitionSchema`, `DeleteEventDefinitionSchema`, `EnableEventDefinitionSchema`, `DisableEventDefinitionSchema`, `ListEventNotificationsSchema`, `CreateEventNotificationSchema`, `UpdateEventNotificationSchema`, `DeleteEventNotificationSchema`; plus `NotificationConfigSchema` (6-variant discriminator) and `EventDefinitionDtoSchema` (common create+update DTO) and `EventDefinitionDtoChangesSchema` (partial-update envelope).
- `src/tools/events/v6-to-v7-migration.js` (~115 LOC) — `migrateV6ToV7AggregationConditions(definitionDto)` closed-set 8-name detector + recursive Expr-tree visit (left/right/child) + visible warnings array + no-op safety on v7 input.
- `src/tools/events/index.js` (~15 LOC) — empty side-effect barrel ready for Plans 05-02/03/04 to populate. `void _register;` line silences unused-import lint until handlers land.
- `.planning/phases/05-events-notifications/05-U1-SMOKE.md` — UNREACHABLE decision artifact; `body: undefined` default for enable/disable_event_definition wire shape.
- `test/events.test.js` (~460 LOC, 35 tests) — full coverage of schemas + discriminator acceptance + rejection + variant refinements + migrator behaviors + barrel-loads-clean smoke.

### Modified

- `src/tools/_shared/conflict.js` — append `response?.elements` at position 5 of the envelope-unwrap fallback chain (BEFORE `response?.items`). Phase 5 `/paginated` PageListResponse shape now resolves end-to-end. Position-order matters: `elements` BEFORE `items` so the modern paginated envelope wins.
- `src/tools/_shared/cascade-hash.js` — append Phase 5 D-09 section with `computeNotificationCascadeHash({ notificationId, eventDefIds })` thin wrapper. Forwards to `computeCascadeHash` with `streamId=notificationId, ruleIds=[], pipelineConnIds=[], eventDefIds=eventDefIds`. Byte-identical canonical JSON.
- `src/tools/_register.js` — remove `getEventDefinitionsHandler` + `getEventNotificationsHandler` imports; remove their `register("list_event_definitions", ...)` and `register("list_event_notifications", ...)` lines; add `import "./events/index.js";` between the Phase 4 and existing register sections; append S5 displacement comment block in the import comment area citing the Phase 3 precedent.
- `src/tools.js` — remove the v2.3 `list_event_definitions` and `list_event_notifications` tool-definition entries. Comment block documents the count-bump trail (66 → 67 → 71 → 77 phase-end).
- `test/cascade-hash.test.js` — add 7 new tests under "Phase 5 D-09 — computeNotificationCascadeHash" header: byte-identity to computeCascadeHash forward, frozen empty + 2-cascade literals (Plan 05-04 anchors), sort-stability, notificationId-distinctness, malformed-input rejection.
- `test/conflict.test.js` — add 2 new tests: elements envelope normalization (paginated PageListResponse), chain position guard (`elements` MUST win over `items`).
- `test/pipelines.test.js` — bump tool-count assertion from 68 → 66 with a comment block documenting the count trail across Phase 5.

### Frozen literal anchors (Plan 05-04 reuses)

- `computeNotificationCascadeHash({notificationId: "66e8aaaaaaaaaaaaaaaaaaaa", eventDefIds: []})` → `e2ba7147288dc6e9dbc0086881b87975c60b3925d8835bba2ffaf5db439f269c`
- `computeNotificationCascadeHash({notificationId: "66e8aaaaaaaaaaaaaaaaaaaa", eventDefIds: ["66e8bbbbbbbbbbbbbbbbbbbb", "66e8cccccccccccccccccccc"]})` → `d986f30b3afe6d6ab54b8fdb667716837dbfcac395720390639d7198287b02dd`

## Decisions Made

- **Zod discriminator + cross-field refinements:** zod v3's `z.discriminatedUnion` requires every variant to be a raw `ZodObject`, NOT a `ZodEffects` (i.e., NOT wrapped in `.superRefine()`). Moved variant-specific cross-field refinements (email recipient/body XOR, slack notify_channel/here XOR + include_title constraint) to an outer `.superRefine()` on the union itself, dispatching on `value.type`. Discriminator inference + closed-set rejection still works perfectly.
- **EventProcessorConfig kept permissive:** `EventDefinitionDtoSchema.config` is `z.record(z.unknown())` rather than another inner discriminated union. EventProcessorConfig is itself a discriminated type server-side (e.g., `aggregation-v1`, `system-notification-v1`); narrowing client-side would (a) duplicate the server-side schema, (b) require maintaining a parallel forward-compat catalogue as new EventProcessorConfig variants land. The v6→v7 migrator narrows the only branch the wrapper cares about (`config.conditions.expression`); everything else flows through verbatim.
- **U1 SMOKE outcome — UNREACHABLE → body:undefined:** No `~/.graylog-mcp/config.json` available to the executor (confirmed at three search paths). Default to `body: undefined` per Pitfall 4 of 05-RESEARCH.md — HTTP-layer hygiene (no spurious `Content-Length: 0` header), aligned with the Phase 0 `makeClient` default, and wire-additively reversible to `body: ""` if a proxy returns 411 / 415.
- **Tool count assertion bump:** 68 → 66 in `test/pipelines.test.js` (Plan 05-01 removes 2 entries from `tools.js` without adding any). Comment block traces the count-bump path through Plans 05-02 (+1 → 67), 05-04 (+1 → 71 alongside its 3 net-new), with phase-end count 77.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Variant-level `.superRefine()` incompatible with `z.discriminatedUnion`**

- **Found during:** Task 2 GREEN (initial schema implementation)
- **Issue:** First implementation placed cross-field refinements (`email_recipients`/`user_recipients`/`lookup_recipient_emails` XOR; slack `notify_channel`/`notify_here` XOR; etc.) on each variant via `.superRefine()` — exactly as the plan instructed. This wrapped each variant in `ZodEffects`, and zod v3's `z.discriminatedUnion` calls `type.shape[discriminator]` directly, which throws `TypeError: Cannot read properties of undefined (reading 'type')` on a `ZodEffects` because `.shape` lives on the inner ZodObject, not on the effects wrapper.
- **Fix:** Refactored to keep all variants as raw `ZodObject`s and moved cross-field refinements to an outer `.superRefine()` on the union itself. The outer refinement dispatches on `value.type` (which is type-narrowed to one of the 6 literals by the union) and applies the appropriate per-variant constraints. Discriminator inference and closed-set rejection remain unchanged; only the refinement layer relocated.
- **Files modified:** `src/tools/events/schemas.js`
- **Verification:** All 35 events tests pass; the 4 specific refinement-rejection tests (slack notify XOR, slack color regex, pagerduty routing_key length, teams adaptive_card JSON) all fire as expected.
- **Committed in:** `3af06cf` (part of Task 2 GREEN commit)

**2. [Rule 2 - Critical] `requirements: []` in plan frontmatter — no `requirements mark-complete` needed**

- **Found during:** State-update step
- **Issue:** Plan 05-01 ships foundation primitives only; no EVENT-XX requirements complete here (Plans 05-02/03/04 close them). The plan's frontmatter correctly has `requirements: []`, so the `requirements mark-complete` step was a no-op.
- **Fix:** No action — frontmatter accurately reflects scope. Documented here for clarity.
- **Impact:** None; this is expected behavior per the plan design.

---

**Total deviations:** 1 auto-fixed (1 bug: zod limitation discovery).
**Impact on plan:** No scope creep. The zod refactor preserves every refinement constraint specified in the plan; the only change is structural (refinement at union-level vs variant-level). All 6 discriminator variants still reject at parse before any HTTP call; the T-05-01-01 mitigation is intact.

## Issues Encountered

- The zod-discriminator-vs-ZodEffects limitation surfaced as an import-time crash, not a parse-time error. First TaskN GREEN test run produced `TypeError: Cannot read properties of undefined (reading 'type')` from the `z.discriminatedUnion` constructor itself, which means the schemas module wouldn't even load. Resolved in the same edit cycle (no separate commit) — the test crash → refactor → re-test cycle took ~3 minutes and is documented under Deviations Rule 1.

## User Setup Required

None — no external service configuration required. The U1-SMOKE decision artifact is a `body: undefined` lock; Plan 05-03 will wire this without further user input.

## Threat Flags

None — this plan ships only foundation primitives. No new network endpoints, no new auth paths, no new file-access patterns. Trust boundaries unchanged. The new `computeNotificationCascadeHash` is a pure function (no I/O); the discriminator and migrator are validation-time only.

## TDD Gate Compliance

- Task 1: `test(05-01)` commit `0c06163` (RED) → `feat(05-01)` commit `f05fd66` (GREEN) — gates satisfied.
- Task 2: `test(05-01)` commit `ed23a40` (RED) → `feat(05-01)` commit `3af06cf` (GREEN) — gates satisfied.
- Task 3 (`type="auto"`, no `tdd="true"`): pure plumbing/refactor; verified by existing dispatch + regression tests + the pipelines tool-count assertion bump. No RED/GREEN cycle required.

## Next Phase Readiness

**Plans 05-02 / 05-03 / 05-04 are unblocked.** Every symbol they need is shipped:

- `src/tools/events/schemas.js` — import `ListEventDefinitionsSchema`, `CreateEventDefinitionSchema`, `UpdateEventDefinitionSchema`, `DeleteEventDefinitionSchema`, `GetEventDefinitionSchema` for Plan 05-02; `EnableEventDefinitionSchema`, `DisableEventDefinitionSchema` for Plan 05-03; `ListEventNotificationsSchema`, `CreateEventNotificationSchema`, `UpdateEventNotificationSchema`, `DeleteEventNotificationSchema`, `NotificationConfigSchema` for Plan 05-04.
- `src/tools/events/v6-to-v7-migration.js` — import `migrateV6ToV7AggregationConditions` for Plan 05-02 `create_event_definition` build() callback (D-03 / D-04 / C5).
- `src/tools/_shared/cascade-hash.js` — import `computeNotificationCascadeHash` for Plan 05-04 `delete_event_notification` build() + apply() callbacks (D-09).
- `src/tools/_shared/conflict.js` — the `elements` envelope amendment makes `findExistingMatches({listPath: "/api/events/definitions/paginated"})` work; Plan 05-02 `create_event_definition` consumes for existingMatches surfacing.
- `src/tools/events/index.js` — Plans 05-02/03/04 each append `import { handle... } from "./..." ;` lines + `register(...)` calls; no further edits to `_register.js` needed.
- `.planning/phases/05-events-notifications/05-U1-SMOKE.md` — Plan 05-03 wires `body: undefined` per the locked decision.
- `test/cascade-hash.test.js` — two frozen 64-hex literals (`e2ba7147...`, `d986f30b...`) are anchored; Plan 05-04 snapshot fixtures reference them.

**Plan tool-count trajectory locked:**

| Plan       | Action                                                                                                | toolDefinitions.length |
| ---------- | ----------------------------------------------------------------------------------------------------- | ---------------------- |
| 05-01      | Remove v2.3 list_event_definitions + list_event_notifications                                         | 68 → **66**            |
| 05-02      | Add list_event_definitions, get_event_definition, create_event_definition, update_event_definition    | 66 → 70                |
| 05-03      | Add delete_event_definition, enable_event_definition, disable_event_definition                        | 70 → 73                |
| 05-04      | Add list_event_notifications, create_event_notification, update_event_notification, delete_event_notification | 73 → **77** (phase-end) |

## Self-Check: PASSED

- **Files exist:**
  - `/home/c_perronnet/git/graylog-mcp/src/tools/_shared/conflict.js` — FOUND
  - `/home/c_perronnet/git/graylog-mcp/src/tools/_shared/cascade-hash.js` — FOUND
  - `/home/c_perronnet/git/graylog-mcp/src/tools/events/schemas.js` — FOUND
  - `/home/c_perronnet/git/graylog-mcp/src/tools/events/v6-to-v7-migration.js` — FOUND
  - `/home/c_perronnet/git/graylog-mcp/src/tools/events/index.js` — FOUND
  - `/home/c_perronnet/git/graylog-mcp/.planning/phases/05-events-notifications/05-U1-SMOKE.md` — FOUND
- **Commits in git log:**
  - `0c06163` (Task 1 RED) — FOUND
  - `f05fd66` (Task 1 GREEN) — FOUND
  - `ed23a40` (Task 2 RED) — FOUND
  - `3af06cf` (Task 2 GREEN) — FOUND
  - `9ba9ba8` (Task 3) — FOUND
- **Full suite green:** `npm test` → 745 pass / 0 fail.

---
*Phase: 05-events-notifications*
*Completed: 2026-05-15*
