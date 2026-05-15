---
phase: 02-index-sets-retention
plan: 02
subsystem: api
tags: [index-sets, create, update, strategies, fqcn, partial-update, d-08, d-09, d-10, d-11, d-12, u1-merge-from-current, nd2-pre-flight, m5-idempotency]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: defineMutatingHandler, makeClient, mutatingBase, __SERVER_ASSIGNED__ sentinel, GraylogValidationError (Phase 0)
  - phase: 01-inputs-extractors
    provides: per-domain folder layout, superRefine variant dispatch pattern (CreateInputSchema + CreateExtractorSchema precedents), MERGE_FROM_CURRENT pattern (update_extractor precedent)
  - phase: 02-index-sets-retention/02-01
    provides: index-sets domain barrel, ListIndexSetsSchema + GetIndexSetSchema, findExistingMatches index_sets-envelope unwrap (Plan 01 amendment), 02-U1-SMOKE.md decision artifact (UNREACHABLE_DEFAULT_MERGE)
provides:
  - "src/tools/index-sets/strategies.js — ROTATION_FQCN (3 aliases) + RETENTION_FQCN (2 aliases) + buildRotationBlock/buildRetentionBlock pure translators + aliasToConfigOrError (archive_not_supported + unknown_strategy_alias structured rejection)"
  - "5 strict strategy-config zod schemas + ISO_DURATION regex + ROTATION_CONFIG_BY_ALIAS + RETENTION_CONFIG_BY_ALIAS maps (D-09)"
  - "CreateIndexSetSchema (D-10 required strategies + D-08 closed-enum aliases + per-alias superRefine narrow)"
  - "UpdateIndexSetSchema (D-11 atomic strategy-replace pair-check + per-alias config narrow scoped to changes.*)"
  - "create_index_set (INDEX-03) — defineMutatingHandler composing strategies.js translators + findExistingMatches + __SERVER_ASSIGNED__ sentinel"
  - "update_index_set (INDEX-04) — U1 MERGE_FROM_CURRENT wire-build + ND2 default-must-be-writable pre-flight + immutable-field defense-in-depth"
affects: ["02-03 (delete_index_set will reuse the alias-to-FQCN translation paths only indirectly — its own work is around the C1 confirmation hash; the strategy translation is a create/update concern)", "02-04 (cycle_deflector / set_default_index_set may share the pre-flight GET + ND2-style invariant pattern)", "02-05 (schema-parity now covers create_index_set + update_index_set; snapshot fixtures pending)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Test seam for non-deterministic build inputs via _setClockForTests(fn|null) — generalizable to any handler that needs to pin Date.now/uuid/etc. for snapshot fixtures"
    - "aliasToConfigOrError safe-wrapper pattern returning { ok: true, block } OR { isError, reason, message } so handlers can route structural failures through GraylogValidationError + wrapGraylogError uniformly"
    - "Closed z.enum + alias-to-FQCN translator pair as the wire-side defense against agent-supplied class FQCN injection (T-02-02-01 mitigation)"
    - "MERGE_FROM_CURRENT wire-build with explicit field allowlist (vs. spread-current) — drops server-only fields the PUT deserializer rejects (id, default, can_be_default) while re-asserting immutable fields from current as defense-in-depth"

key-files:
  created:
    - "src/tools/index-sets/strategies.js"
    - "src/tools/index-sets/create-index-set.js"
    - "src/tools/index-sets/update-index-set.js"
  modified:
    - "src/tools/index-sets/schemas.js (extended with strategy configs + CreateIndexSetSchema + UpdateIndexSetSchema)"
    - "src/tools/index-sets/index.js (registered create_index_set + update_index_set)"
    - "src/tools.js (2 new toolDefinitions)"
    - "test/index-sets.test.js (+29 tests)"
    - "test/schema-parity.test.js (+2 parity assertions)"

key-decisions:
  - "U1 decision honored per 02-U1-SMOKE.md (UNREACHABLE_DEFAULT_MERGE): update_index_set ships the MERGE_FROM_CURRENT wire-build pattern. Pre-flight GET sources the immutable fields + strategy blocks the agent didn't touch; agent changes are merged over current and the full DTO is emitted on the wire. Safe because index-set configs carry no encrypted fields (verified against IndexSetResponse — no is_encrypted: true field), so the C3 zero-out pitfall that drove update_input's strict-no-echo pattern is not reachable here."
  - "D-11 atomic strategy-replace enforced at the zod schema layer (UpdateIndexSetSchema superRefine) — strategy + strategy_config are validated as a pair before build() runs. The wire-build path simply detects pair presence and translates aliases, mirroring create_index_set."
  - "ND2 pre-flight (RESEARCH.md §Pitfall ND2) implemented in build() — when current.default === true AND args.changes.writable === false, build() throws GraylogValidationError with reason default_index_set_must_be_writable BEFORE the PUT fires. Tested explicitly: PUT call count tracked, asserted 0."
  - "Immutable field strip is double-defended: UpdateChangesShape omits index_prefix + creation_date from the allowed `changes` set (zod default strip mode drops unknown keys), AND the wire body re-asserts current.index_prefix + current.creation_date. T-02-02-04 mitigation defense in depth — even if a future schema regression let these through, an attacker can't rename a victim's index prefix via update_index_set."
  - "RetentionAliasEnum includes 'archive' (not 'delete' + 'close' only) so the agent-facing error wording reads as a structural rejection (reason: archive_not_supported) rather than a generic invalid_enum_value. The wire-build translator (aliasToConfigOrError) is the gate that produces the structured error."
  - "Determinism seam (_setClockForTests) lives in create-index-set.js as a leading-underscore framework-internal export — production must NEVER call it. The seam lets snapshot fixtures (Plan 02-05) freeze creation_date without baking the regex-substitution dance into test scaffolding."
  - "MERGE_FROM_CURRENT body builder uses an explicit field allowlist rather than {...current, ...changes}. Two reasons: (1) drops server-only fields like id/default/can_be_default that IndexSetUpdateRequest.java rejects; (2) explicit is auditable — every field on the wire is visible in a single source-of-truth location."

patterns-established:
  - "alias-to-FQCN translator pattern: closed z.enum at the schema layer + buildXBlock function in a strategies.js module + aliasToConfigOrError safe wrapper that returns { ok, block } or { isError, reason, message }. Mirrors the type-catalogue + variantMap pattern from Phase 1 but for static FQCN strings (no per-connection state)."
  - "Determinism test seam pattern: _setClockForTests(fn|null) on a per-module basis for any non-deterministic build() input. Pins snapshot fixtures across CI runs without poisoning production behavior."
  - "MERGE_FROM_CURRENT explicit-allowlist body builder — used when the upstream PUT deserializer rejects partial bodies AND the underlying DTO carries server-only fields the agent shouldn't echo. Phase 3+ updates against AutoValue-shaped Java DTOs can copy this template."

requirements-completed: [INDEX-03, INDEX-04]

# Metrics
duration: ~10 min
completed: 2026-05-15
---

# Phase 2 Plan 2: create_index_set + update_index_set Summary

**Two mutating index-set tools (INDEX-03/04) shipped — create with friendly-alias FQCN translation + per-alias strategy_config narrowing + M5 list-before-create idempotency, update with U1 MERGE_FROM_CURRENT wire-build + D-11 atomic strategy-replace + ND2 default-must-be-writable pre-flight + immutable-field defense-in-depth.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-15T14:33:49Z
- **Completed:** 2026-05-15T14:44:06Z
- **Tasks:** 3 (all TDD: RED → GREEN per task)
- **Files modified:** 8 (3 created + 5 modified)
- **Tests added:** +29 (271 baseline → 302 total — 14 schema/strategy + 6 create + 9 update; exceeded plan's ~16 estimate)
- **Tool count:** 38 → 40 (create_index_set + update_index_set)

## Accomplishments

- `src/tools/index-sets/strategies.js` ships the alias-to-FQCN map for 3 rotation strategies + 2 retention strategies (archive intentionally absent from RETENTION_FQCN — its rejection lives in aliasToConfigOrError as the structured `archive_not_supported` reason).
- `src/tools/index-sets/schemas.js` extended with the ISO_DURATION regex, 5 strict strategy-config zod schemas (D-09), the ROTATION_CONFIG_BY_ALIAS + RETENTION_CONFIG_BY_ALIAS lookup maps, the closed RotationAliasEnum + RetentionAliasEnum (D-08), CreateIndexSetSchema (D-10 required strategies + per-alias superRefine narrow), and UpdateIndexSetSchema (D-11 atomic strategy-replace pair-check + per-alias config narrow scoped to changes.*).
- `create_index_set` (INDEX-03) — defineMutatingHandler composing strategies.js translators with findExistingMatches (using Plan 02-01's index_sets-envelope unwrap) for M5 list-before-create idempotency. Defaults populated for every infrastructure knob (shards, replicas, index_analyzer, ...). __SERVER_ASSIGNED__ sentinel for the not-yet-known id (D-17). Deterministic creation_date via the _setClockForTests seam.
- `update_index_set` (INDEX-04) — defineMutatingHandler with async build() that pre-flights GET, applies ND2 default-must-be-writable refusal (GraylogValidationError + reason `default_index_set_must_be_writable`, PUT never fires), translates strategy aliases via aliasToConfigOrError when changes carry a strategy pair, then merges agent changes over current via an explicit-field-allowlist body builder. Immutable index_prefix + creation_date are re-asserted from current as defense-in-depth.
- `test/schema-parity.test.js` now covers create_index_set + update_index_set (the parity helper's ZodEffects fallback via `_def.schema.shape` handles the superRefine wrap transparently).

## Task Commits

Each task was committed atomically as a RED → GREEN TDD pair:

1. **Task 1: Strategies module + CreateIndexSetSchema**
   - RED: `39d7f42` (test)
   - GREEN: `e4e62e6` (feat)
2. **Task 2: create_index_set handler (INDEX-03)**
   - RED: `aee031d` (test)
   - GREEN: `138dac0` (feat)
3. **Task 3: update_index_set handler (INDEX-04) per U1 MERGE_FROM_CURRENT**
   - RED: `88affee` (test)
   - GREEN: `22ab2d2` (feat)

**Plan metadata commit:** to be added after this SUMMARY + STATE.md update.

## Files Created/Modified

### Created (3)

- `src/tools/index-sets/strategies.js` — ROTATION_FQCN (3 entries) + RETENTION_FQCN (2 entries) + buildRotationBlock/buildRetentionBlock pure translators + aliasToConfigOrError safe wrapper that handles the archive_not_supported + unknown_strategy_alias structured rejection paths.
- `src/tools/index-sets/create-index-set.js` — INDEX-03 handler: async build() composing aliasToConfigOrError (rotation + retention) → findExistingMatches → wire-body composition with defaults + deterministic creation_date. apply() = client.request; summarize() names the rotation + retention aliases.
- `src/tools/index-sets/update-index-set.js` — INDEX-04 handler: async build() composing pre-flight GET → ND2 default-must-be-writable refusal → aliasToConfigOrError when changes carry a strategy pair → MERGE_FROM_CURRENT explicit-allowlist body builder. apply() = client.request; summarize() reports the change count.

### Modified (5)

- `src/tools/index-sets/schemas.js` — Extended with ISO_DURATION, 5 strict strategy-config schemas, ROTATION_CONFIG_BY_ALIAS + RETENTION_CONFIG_BY_ALIAS maps, RotationAliasEnum + RetentionAliasEnum, CreateIndexSetSchema (D-10 required + superRefine narrow), UpdateIndexSetSchema (D-11 atomic pair-check + superRefine narrow). Plan 02-01's ListIndexSetsSchema + GetIndexSetSchema preserved unchanged.
- `src/tools/index-sets/index.js` — Two new `register("...")` lines for create_index_set + update_index_set.
- `src/tools.js` — Two new toolDefinitions entries (description spells out D-08 friendly aliases, D-09 per-alias config shapes, D-10 required-strategies contract for create; D-11 atomic strategy-replace, U1 MERGE_FROM_CURRENT, ND2 pre-flight, immutable-field policy for update).
- `test/index-sets.test.js` — +29 tests: 14 schema/strategy tests (Task 1), 6 create_index_set tests (Task 2), 9 update_index_set tests (Task 3).
- `test/schema-parity.test.js` — +2 assertSchemaParityForTool calls (create_index_set + update_index_set).

## Decisions Made

See `key-decisions:` in the frontmatter for the full list. Highlights:

- **U1 → MERGE_FROM_CURRENT:** 02-U1-SMOKE.md recorded UNREACHABLE_DEFAULT_MERGE (no Graylog API token in the executor environment; live smoke skipped). Plan 02-02 honored the smoke decision exactly — update_index_set ships the merge-from-current wire-build, NOT the strict-no-echo variant. This is the safe default per RESEARCH.md §Pitfall U1.
- **archive in the enum, rejected at translate-time:** `RetentionAliasEnum` includes "archive" so a friendly error reads as a structural rejection (reason: archive_not_supported), not a generic enum invalid_value. The actual rejection happens in `aliasToConfigOrError` and routes through GraylogValidationError → wrapGraylogError, giving the agent a single uniform error envelope.
- **Explicit-allowlist body builder for MERGE_FROM_CURRENT:** Rather than `{ ...current, ...args.changes }`, the merge spells out every field that goes on the wire. Drops server-only fields like `id` / `default` / `can_be_default` that the PUT deserializer rejects, AND makes the wire shape auditable in a single source-of-truth location. Plan 03+ tools that update AutoValue-shaped DTOs can copy this template.
- **Immutable-field defense-in-depth:** `UpdateChangesShape` omits `index_prefix` + `creation_date` (zod's default `strip` mode drops them at the schema layer), AND the wire-build re-asserts `current.index_prefix` + `current.creation_date`. Two independent layers — if a future schema regression let an agent-supplied `index_prefix` through, the wire body would still emit the current value.

## Deviations from Plan

None — plan executed exactly as written. The U1 branch was deterministic (the smoke artifact pinned MERGE_FROM_CURRENT before Plan 02-02 started), and all three tasks landed without auto-fix Rule 1/2/3 triggers. The plan's automated verify checks all passed on the first run.

## Issues Encountered

None. Each task's RED commit confirmed the failing import path / schema absence, GREEN landed the smallest module that turned the tests green, and `npm test` reported zero regression after each commit.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 02-03 hand-off:** `delete_index_set` (INDEX-05) needs to consume `_confirmationToken` forwarding + `requireConfirm` apply-time gate (both already shipped in Plan 02-01's handler.js amendments). The strategy module is not load-bearing for delete; the C1 confirmation hash + stats-unreachable hard-block are the new work. ND1 pre-flight (default index set undeletable) mirrors the ND2 pre-flight pattern shipped here — Plan 03 can copy the structural error shape.
- **Plan 02-04 hand-off:** `set_default_index_set` reuses the pre-flight-GET + structural-error pattern from update_index_set's ND2 path (different invariant — `can_be_default: false` rather than `default + !writable`). `cycle_deflector` per the U1 smoke ships SYNC_OPTION_A — no system-job linkage needed for the primary action.
- **Plan 02-05 hand-off:** schema-parity now covers 5 of the 8 phase-2 mutating tools (list_index_sets, get_index_set, await_system_job, create_index_set, update_index_set). The remaining 3 (delete, set_default, cycle) land in Plans 03 + 04. Snapshot fixtures for create + update dry-run/apply paths are pending; the determinism seam (`_setClockForTests`) is in place so creation_date won't bake real timestamps into committed snapshots.
- **No blockers.**

## Self-Check: PASSED

All 3 created file paths exist on disk; all 6 task commits exist in `git log --oneline -8`. Full `npm test` returns 302/302 passing.

```
src/tools/index-sets/strategies.js          — FOUND
src/tools/index-sets/create-index-set.js    — FOUND
src/tools/index-sets/update-index-set.js    — FOUND
test/index-sets.test.js                      — MODIFIED (+29 tests)
test/schema-parity.test.js                   — MODIFIED (+2 assertions)
src/tools/index-sets/schemas.js              — MODIFIED (CreateIndexSetSchema + UpdateIndexSetSchema)
src/tools/index-sets/index.js                — MODIFIED (register 2 new tools)
src/tools.js                                  — MODIFIED (2 new toolDefinitions)

commits:
  39d7f42 test(02-02): RED — strategies module + CreateIndexSetSchema (Task 1)
  e4e62e6 feat(02-02): GREEN — strategies module + CreateIndexSetSchema (Task 1)
  aee031d test(02-02): RED — create_index_set handler (Task 2)
  138dac0 feat(02-02): GREEN — create_index_set handler (Task 2, INDEX-03)
  88affee test(02-02): RED — update_index_set handler (Task 3)
  22ab2d2 feat(02-02): GREEN — update_index_set handler (Task 3, INDEX-04)
```

---
*Phase: 02-index-sets-retention*
*Completed: 2026-05-15*
