---
phase: 10-entity-sharing-write-path
plan: 01
subsystem: authz
tags: [authz, sharing, zod, schemas, drift-refusal, read-merge-write, tdd-red, wave-0]

# Dependency graph
requires:
  - phase: 08-authz-foundation-grn-helper-live-api-recon
    provides: "Capability enum (view/manage/own), computeShareGrantHash byte-pin, live 7.0.6 prepare fixture, GRN helpers + SHAREABLE_TYPES guard"
  - phase: 09-entity-shares-read-path
    provides: "ENTITY_TYPES private enum (now promoted to export), GetEntitySharesSchema + entity-XOR refine precedent, _setCaptureRequest fixture-replay seam pattern (test/authz-entity-shares.test.js)"
provides:
  - "test/authz-share-entity.test.js — Wave 0 RED test scaffold (16 named test blocks) encoding the full Phase 10 requirement -> test map, including the MANDATORY PITFALL 1 ACCEPTANCE GATE"
  - "ShareEntitySchema (src/tools/authz/schemas.js) — write-path zod contract: mutatingBase + entity-XOR + grantee-XOR + revoke<->capability refines + locked Capability/ENTITY_TYPES enums"
  - "ENTITY_TYPES exported from src/tools/authz/schemas.js (was file-private) — single source of truth for the shareable-type set across read and write paths"
affects: [10-02 (handler implementation will turn the RED tests GREEN against this frozen contract), 10-03 (catalogue + live smoke), 11 (role management may follow the same schema-first pattern)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wave 0 RED file pattern: ship test scaffold BEFORE handler so the test file is the executable specification Plan 10-02 must satisfy (file parses cleanly; module-not-found on the not-yet-shipped handler is the expected RED signal)"
    - "Schema-first input contract: ShareEntitySchema is frozen before the handler is written; the handler composes against the contract rather than inventing one"
    - "Three-refine XOR-XOR-revoke gate pattern — entity XOR (grn vs type+id), grantee XOR (grn vs username), revoke <-> capability cross-field invariant — composable with mutatingBase"

key-files:
  created:
    - test/authz-share-entity.test.js
  modified:
    - src/tools/authz/schemas.js

key-decisions:
  - "Promoted ENTITY_TYPES from file-private to exported per 10-PATTERNS.md recommendation — ShareEntitySchema reuses the same enum the read schemas already use; no duplicate definition"
  - "Wave 0 RED file is acceptable to fail with ERR_MODULE_NOT_FOUND on the not-yet-existing handler — this is the load-bearing TDD discipline that makes the test file the GREEN target for Plan 10-02"
  - "PITFALL 1 ACCEPTANCE GATE adapted verbatim from test/pipelines.test.js:2076-2099 (connect_pipelines_to_stream PITFALL 2 gate) — same notDeepStrictEqual inverse-assert technique, different merge primitive (Map<grantee, capability> vs Set<id>)"
  - "Three .refine clauses encode cross-field invariants instead of a JSON-schema required array — same pattern as Phase 9's GetEntitySharesSchema entity-XOR refine and pipelines/schemas.js CreatePipelineRuleSchema"

patterns-established:
  - "Wave-0 RED scaffold: the test file IS the specification; module-not-found on the import line is the desired RED state, NOT a blocker"
  - "PITFALL N ACCEPTANCE GATE comment marker pattern — verifier-greppable test that pins a regression-critical behavior with a positive AND inverse assertion in one block"

requirements-completed: [SHARE-01, SHARE-03, SHARE-04, SHARE-05, SHARE-06, SHARE-07, SHARE-08, AUTHZ-01]

# Metrics
duration: 6min
completed: 2026-05-20
---

# Phase 10 Plan 10-01: Entity Sharing Write Path — Wave 0 Scaffold Summary

**Wave 0 RED test scaffold (16 named tests including the MANDATORY PITFALL 1 ACCEPTANCE GATE) plus frozen ShareEntitySchema (mutatingBase + entity-XOR + grantee-XOR + revoke gate) — the executable specification Plan 10-02 must satisfy.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-20T15:21:40Z
- **Completed:** 2026-05-20T15:26:57Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 edited)

## Accomplishments

- Wave 0 offline RED test scaffold at `test/authz-share-entity.test.js` — 16 named test blocks covering the full Phase 10 requirement -> test map: PITFALL 1 ACCEPTANCE GATE (read-merge-write), dry-run-token = computeShareGrantHash, confirmation_mismatch on wrong token, TOCTOU drift refusal, per-entity-type matrix (stream/dashboard/search), granteeUsername -> user-GRN resolution, ambiguous-title rejection, revoke subtract, last-own client-side guard, HTTP 400 with body.validation_result.failed, HTTP 403 -> not_entity_owner, zod synonym rejection (read/edit/admin), zod refuses revoke:true + capability, zod refuses revoke:false + no capability, SHAREABLE_TYPES guard on entityGrn, writable:false short-circuit.
- `ShareEntitySchema` shipped in `src/tools/authz/schemas.js` — extends `mutatingBase` (dryRun:true default), composes three `.refine` clauses (entity-XOR, grantee-XOR, revoke<->capability), and reuses the existing `Capability` (view/manage/own) and `ENTITY_TYPES` (stream/dashboard/search) enums without redefinition.
- `ENTITY_TYPES` promoted from file-private const to exported z.enum — Phase 10 write path and Phase 9 read path now share one shareable-type source of truth.
- Zero regression: pre-existing tests stay green (only the new Wave 0 RED file fails — by design — until Plan 10-02 ships the handler).
- Zero new dependencies; v2.3 contracts unchanged; Phase 9 exports (Capability, GetEntitySharesSchema, ListGranteesSchema) untouched.

## Task Commits

1. **Task 1: Wave 0 offline test scaffold for share_entity** — `9f5960f` (test)
2. **Task 2: ShareEntitySchema — mutatingBase + XOR refines + revoke gate** — `dcb7f0c` (feat)

**Plan metadata:** _pending — final commit captures SUMMARY + STATE + ROADMAP._

## Files Created/Modified

- `test/authz-share-entity.test.js` (NEW, 728 lines) — Wave 0 offline RED scaffold. Imports `handleShareEntity` from a not-yet-existing module; module-load fails with clean `ERR_MODULE_NOT_FOUND` while `node --check` exits 0. Encodes every Phase 10 requirement-to-test row.
- `src/tools/authz/schemas.js` (MODIFIED, +80 / -6) — added `mutatingBase` import, promoted `ENTITY_TYPES` to exported z.enum, appended `ShareEntitySchema` with three `.refine` clauses.

## Decisions Made

- **Promoted `ENTITY_TYPES` to exported** (vs. duplicating the literal in ShareEntitySchema). Per 10-PATTERNS.md §"schemas.js" recommendation — single source of truth. Phase 9 read schemas continue to use the same const transparently.
- **Wave 0 RED file is the executable specification.** The handler import (`../src/tools/authz/share-entity.js`) intentionally does not yet resolve — `node --test` fails with `ERR_MODULE_NOT_FOUND`. This is the expected RED state. Plan 10-02's GREEN target is this exact test file.
- **PITFALL 1 ACCEPTANCE GATE is adapted verbatim** from `test/pipelines.test.js:2076-2099`. Same positive + inverse assertion structure (`deepEqual` to merged set, `notDeepStrictEqual` to args-only). Merge primitive swapped from `Set<id>` to `Map<grantee, capability>`.

## Deviations from Plan

None - plan executed exactly as written.

The plan's success-criterion line listed "1131 baseline tests stay green"; the live count is 1137 (1136 pass + 1 fail, where the failure is the new Wave 0 RED file as designed). The pre-existing 1131 count is a stale snapshot in STATE.md — no pre-existing test regressed.

## Issues Encountered

None.

## Acceptance Gates (verified)

- `node --check test/authz-share-entity.test.js` -> exit 0 (file parses cleanly).
- `grep -c '"share_entity PITFALL 1 ACCEPTANCE GATE'` -> **1** (mandatory gate present).
- `grep -cE 'notDeepStrictEqual|notDeepEqual'` -> **2** (inverse assertion + PITFALL 1 gate).
- `grep -c '_clearCaptureRequest'` -> **2** (afterEach cleanup + import).
- `grep -cE '^\s*test\('` -> **16** named test blocks (16 >= 15 requirement; for-loop iterations land additional sub-tests at runtime).
- All 5 reason tags asserted: `confirmation_mismatch`, `share_validation_failed`, `not_entity_owner`, `would_leave_entity_ownerless`, `connection_read_only`.
- `computeShareGrantHash` used in dry-run-token byte-pin assertion (4 references).
- `encodeURIComponent` used in the per-entity-type apply-path matrix.
- `node --check src/tools/authz/schemas.js` -> exit 0.
- Inline schemas verify command prints `schemas OK` — 3 valid parses succeed + 6 invalid parses throw + `Capability.options.length === 3` + `ENTITY_TYPES.options.length === 3` + `GetEntitySharesSchema.parse` round-trip succeeds.
- `npm test`: 1136 pass / 1 fail / 0 cancelled / 0 skipped — only `test/authz-share-entity.test.js` fails (expected RED).

## Threat Model Validation (from PLAN.md `<threat_model>`)

- **T-10-01-01 (Capability synonym coercion):** Mitigated. Capability enum pinned to view/manage/own; Test 12 (3 sub-tests for read/edit/admin) verifies rejection.
- **T-10-01-02 (Non-shareable entityType):** Mitigated. ENTITY_TYPES locked to stream/dashboard/search; SHAREABLE_TYPES backstop on the entityGrn path; Tests 12 and 15 verify both.
- **T-10-01-03 (revoke + capability ambiguity):** Mitigated. The 3rd `.refine` rejects both ambiguous combinations; Tests 13 and 14 verify both halves.
- **T-10-01-04 (Live-grantee titles in CI logs):** Accepted (no new exposure — Phase 8 fixture already in git).
- **T-10-01-SC (Supply chain):** Accepted — zero new package installs.

## Next Phase Readiness

- Plan 10-02 (handler implementation) can compose directly against `ShareEntitySchema` and the frozen test file. The GREEN target is `node --test test/authz-share-entity.test.js` -> all 16 named tests pass.
- The `_setCaptureRequest` seam is the offline transport for every test; the handler will run unmodified against the live `test` connection via Plan 10-03's `*.smoke.js`.
- No blockers carried forward.

## Self-Check: PASSED

- `test/authz-share-entity.test.js` exists: FOUND (728 lines).
- `src/tools/authz/schemas.js` modified: FOUND (`ShareEntitySchema`, `ENTITY_TYPES` exports present).
- Task 1 commit `9f5960f` in git log: FOUND.
- Task 2 commit `dcb7f0c` in git log: FOUND.
- `npm test`: only expected RED failure (`test/authz-share-entity.test.js`), no regression.

---
*Phase: 10-entity-sharing-write-path*
*Completed: 2026-05-20*
