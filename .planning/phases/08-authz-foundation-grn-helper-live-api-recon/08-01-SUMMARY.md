---
phase: 08-authz-foundation-grn-helper-live-api-recon
plan: 01
subsystem: auth
tags: [grn, zod, authz, capability, scaffolding]

# Dependency graph
requires:
  - phase: 07-final-hardening
    provides: per-domain src/tools/<domain>/ extraction pattern, _register.js domain-barrel block
provides:
  - "src/tools/authz/grn-helpers.js — buildGrn / parseGrn / isGrn pure functions + GRN_TYPES set"
  - "src/tools/authz/schemas.js — Capability zod enum (view/manage/own)"
  - "src/tools/authz/index.js — empty side-effect register barrel for the authz domain"
  - "authz domain wired into src/tools/_register.js"
affects: [Phase 9 entity-shares read path, Phase 10 entity-sharing write path, Phase 11 role management]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure GRN helper module — JSDoc-per-export + throw-on-malformed discipline mirroring _shared/cascade-hash.js"
    - "Restricted 6-type GRN_TYPES set (not the 14-type 7.2 registry) to avoid accepting a type 7.0.6 rejects"
    - "Empty register barrel for a not-yet-populated domain (events/index.js precedent)"

key-files:
  created:
    - src/tools/authz/grn-helpers.js
    - src/tools/authz/schemas.js
    - src/tools/authz/index.js
    - test/authz-grn.test.js
  modified:
    - src/tools/_register.js

key-decisions:
  - "GRN canonical form locked to the 6-token grn::::<type>:<id> (4 colons after grn); the 7-token form appears nowhere in source"
  - "GRN_TYPES pinned to the 6-type milestone set: stream/dashboard/search/user/builtin-team/role"
  - "Capability enum pinned to exactly view/manage/own — no read/write/admin aliases (least-privilege default)"
  - "authz/index.js ships empty (zero register() calls) — Phase 8 has no agent-facing handler"

patterns-established:
  - "Pure GRN helper: provenance header citing org/graylog/grn/GRN.java, JSDoc per export, throw new Error on malformed input"
  - "Empty domain barrel: header naming the phase + bare `import { register }` line, no register() calls"

requirements-completed: [AUTHZ-02]

# Metrics
duration: 14min
completed: 2026-05-19
---

# Phase 8 Plan 01: AuthZ Foundation — GRN Helper & Capability Enum Summary

**Pure GRN build/parse/validate helper (6-token `grn::::<type>:<id>` form, restricted 6-type set), a `Capability` zod enum pinned to view/manage/own, and an empty `authz` domain barrel wired into `_register.js` — all unit-tested.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-05-19T14:20:00Z
- **Completed:** 2026-05-19T14:34:00Z
- **Tasks:** 3
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments
- `grn-helpers.js` — `buildGrn`/`parseGrn`/`isGrn` round-trip every type in the restricted 6-member `GRN_TYPES` set; unknown types are rejected client-side with the valid-type set listed in the error message
- `schemas.js` — `Capability` zod enum pinned to exactly `view`/`manage`/`own`, rejecting `read`/`write`/`admin` and case variants
- `authz/index.js` — empty side-effect register barrel (zero handlers), wired into `src/tools/_register.js`
- 13 new unit tests in `test/authz-grn.test.js`; full suite green at 1112/1112

## Task Commits

Each task was committed atomically (TDD: test → feat per task):

1. **Task 1 (RED): failing GRN helper tests** - `f43bd94` (test)
2. **Task 1 (GREEN): GRN build/parse/validate helper** - `a309444` (feat)
3. **Task 2 (RED): failing Capability enum tests** - `da491f2` (test)
4. **Task 2 (GREEN): Capability enum + empty authz barrel** - `d832cdc` (feat)
5. **Task 3: wire authz barrel into _register.js** - `938a941` (feat)

## Files Created/Modified
- `src/tools/authz/grn-helpers.js` - Pure GRN build/parse/validate functions + frozen `GRN_TYPES` set (no I/O)
- `src/tools/authz/schemas.js` - `Capability` zod enum (view/manage/own)
- `src/tools/authz/index.js` - Empty side-effect register barrel for the authz domain
- `test/authz-grn.test.js` - 13 unit tests: round-trip, lowercasing, unknown-type rejection, structural validation, isGrn predicate, Capability enum
- `src/tools/_register.js` - One added line: `import "./authz/index.js";` in the domain-barrel block

## Decisions Made
- None beyond what the plan specified — GRN canonical form, the 6-type `GRN_TYPES` set, and the `Capability` enum values were all locked by the plan and 08-RESEARCH.md.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- The acceptance criterion `grep -c "grn:::::" src/tools/authz/grn-helpers.js` returns 0 initially matched a JSDoc comment that *documented* the rejected 7-token form (`grn:::::type:id`) as a literal example. The comment was reworded to describe the rejected shape without the literal 5-colon sequence, so the criterion now passes cleanly. The 6-token canonical form is the only GRN literal that appears in source. This is a wording adjustment to a comment, not a behavior change — not tracked as a deviation.

## Plan/Frontmatter Note (non-blocking)
- The plan's `must_haves.artifacts` entry for `test/authz-grn.test.js` lists `contains: "computeShareGrantHash"`. `computeShareGrantHash` is a **Plan 08-02** deliverable (a `cascade-hash.js` addition — see 08-RESEARCH "Open Questions RESOLVED" Q1 → plan 08-02). Plan 08-01's three tasks neither create nor test it, so it is intentionally absent from this plan's test file. The `contains` hint appears to be a frontmatter copy-forward error; flagged here for the verifier. No 08-01 task instructs adding it.

## Next Phase Readiness
- Plan 08-02 (`computeShareGrantHash` in `cascade-hash.js`) and Plan 08-03 (live `/prepare` recon + fixture + `08-TEST-STRATEGY.md`) are ready to proceed.
- `buildGrn`/`parseGrn`/`isGrn` and the `Capability` enum are available for import by Phase 9/10/11 handlers.
- No blockers.

## Self-Check: PASSED

- FOUND: src/tools/authz/grn-helpers.js
- FOUND: src/tools/authz/schemas.js
- FOUND: src/tools/authz/index.js
- FOUND: test/authz-grn.test.js
- FOUND: src/tools/_register.js (modified — `import "./authz/index.js";` present)
- Commits verified: f43bd94, a309444, da491f2, d832cdc, 938a941 (all confirmed via git log)

---
*Phase: 08-authz-foundation-grn-helper-live-api-recon*
*Completed: 2026-05-19*
