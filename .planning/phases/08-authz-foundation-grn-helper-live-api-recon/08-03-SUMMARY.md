---
phase: 08-authz-foundation-grn-helper-live-api-recon
plan: 03
subsystem: auth
tags: [authz, entity-sharing, grn, live-recon, fixture, test-strategy, graylog-7.0.6]

# Dependency graph
requires:
  - phase: 08-authz-foundation-grn-helper-live-api-recon
    provides: buildGrn / parseGrn / GRN_TYPES from Plan 08-01
provides:
  - scripts/capture-authz-prepare-fixture.js — one-shot read-only live /prepare recon probe
  - test/fixtures/authz/prepare-response-7.0.6.json — verbatim live 7.0.6 EntityShareResponse capture with provenance
  - Offline fixture-shape test pinning the EntityShareResponse top-level keys
  - 08-TEST-STRATEGY.md — live-production authz test contract (dryRun default, /prepare-only, corrected endpoint)
  - Verified corrected endpoint POST /api/authz/shares/entities/{entityGRN}(/prepare); brief's PUT path recorded WRONG
affects: [phase-09-entity-share-dto-parse, phase-10-entity-sharing-write-path, share_entity]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Live recon as a non-mutating @NoAuditEvent /prepare probe with an empty {} body"
    - "Verbatim live capture committed as a fixture with a _provenance block (instance + version + capture date)"
    - "Offline fixture-shape test: load committed capture, assert DTO top-level keys, treat version-variable fields as optional"

key-files:
  created:
    - scripts/capture-authz-prepare-fixture.js
    - test/fixtures/authz/prepare-response-7.0.6.json
    - .planning/phases/08-authz-foundation-grn-helper-live-api-recon/08-TEST-STRATEGY.md
  modified:
    - test/authz-grn.test.js

key-decisions:
  - "synced_entities IS PRESENT in the live 7.0.6 EntityShareResponse (empty array) — Phase 9's open question resolved: present, not absent. The offline test still asserts it as optional so a future build dropping it does not break the suite."
  - "The brief's PUT /api/authz/shares/{grn} is WRONG; the verified surface is POST /api/authz/shares/entities/{entityGRN} (commit) and the same path + /prepare suffix (preview). Recorded in 08-TEST-STRATEGY.md."

patterns-established:
  - "Live-production recon via an @NoAuditEvent /prepare probe — empty body, asserts its own /prepare suffix, never the commit endpoint"
  - "Captured fixtures carry a _provenance block and an offline fixture-shape test pins the DTO contract"

requirements-completed: [AUTHZ-02]

# Metrics
duration: 1day
completed: 2026-05-19
---

# Phase 8 Plan 03: Live /prepare Recon + EntityShareResponse Fixture Summary

**Captured the verbatim live Graylog 7.0.6 `EntityShareResponse` wire shape as a committed fixture via a non-mutating `/prepare` recon probe, verified the corrected `POST .../entities/{entityGRN}/prepare` endpoint against the live `test` instance, and documented the live-production authz test strategy before any Phase 9/10 apply handler is written.**

## Performance

- **Duration:** spanned the human-verify checkpoint (Task 2)
- **Started:** 2026-05-18
- **Completed:** 2026-05-19
- **Tasks:** 3
- **Files created:** 3
- **Files modified:** 1

## Accomplishments
- `scripts/capture-authz-prepare-fixture.js` — a one-shot read-only CLI probe that discovers a live stream id via `GET /api/streams`, builds its GRN with `buildGrn`, percent-encodes it into a `.../prepare` path, asserts the `/prepare` suffix, and POSTs an empty `{}` body via `makeClient`. Never touches the commit endpoint, never uses raw axios.
- `test/fixtures/authz/prepare-response-7.0.6.json` — a verbatim live 7.0.6 `EntityShareResponse` (HTTP 200) with a `_provenance` block recording instance `http://<graylog-host>`, version `7.0.6+711d207`, source entity `grn::::stream:6a0899bc670fc246e77ca54e`, and capture date.
- Offline fixture-shape test appended to `test/authz-grn.test.js` — asserts the EntityShareResponse top-level keys (`entity`, `available_grantees`, `available_capabilities`, `active_shares`, `validation_result`), the `_provenance` block, and treats `synced_entities` as optional. No network call.
- `08-TEST-STRATEGY.md` — the live-production authz test contract: dryRun default, `/prepare`-only Phase 8 live call, corrected endpoint, GRN URL-encoding rule, throwaway-disposable-entity harness for Phase 10+, human-UAT gating.
- Full suite green: 1119/1119.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write the one-shot read-only /prepare probe script** - `c353464` (feat)
2. **Task 2: Run the probe against the live test instance and capture the fixture** - `6316226` (chore) — the verbatim live capture, committed after the human-verify checkpoint cleared
3. **Task 3: Add the offline fixture-shape test and document the test strategy** - `f787af6` (test)

## Files Created/Modified
- `scripts/capture-authz-prepare-fixture.js` (created) — read-only live recon probe; shebang + `isMain` guard + `process.exit` codes.
- `test/fixtures/authz/prepare-response-7.0.6.json` (created) — verbatim live 7.0.6 capture with `_provenance`.
- `.planning/phases/08-authz-foundation-grn-helper-live-api-recon/08-TEST-STRATEGY.md` (created) — live-production authz test contract.
- `test/authz-grn.test.js` (modified) — added `node:fs`/`node:path`/`node:url` imports, `FIXTURE_DIR`, and a 3-test fixture-shape group.

## Decisions Made
- **`synced_entities` is PRESENT in 7.0.6.** The live capture resolves Phase 9's open question — the field is present (an empty array), not absent. The offline test still asserts it as optional (Pitfall 5) so a future 7.x build that drops it does not break `npm test`. Phase 9 is instructed to model version-variable fields with zod `.optional()`.
- **Corrected endpoint verified, brief recorded WRONG.** `POST /api/authz/shares/entities/{entityGRN}/prepare` returned HTTP 200 live. The milestone brief's `PUT /api/authz/shares/{grn}` is confirmed wrong and recorded as such in `08-TEST-STRATEGY.md`. The commit endpoint `POST .../entities/{GRN}` (no `/prepare`) appears nowhere in Phase 8.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Issues Encountered

The captured fixture from the Task 2 checkpoint run was left untracked after the checkpoint cleared; it was staged and committed as Task 2's deliverable (`6316226`) during continuation, before the Task 3 commit. No content change — the verbatim capture was committed as-is.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The verified `EntityShareResponse` wire shape is committed; Phase 9 can build its DTO parser against the real 7.0.6 fields rather than the 7.2 source clone.
- The corrected `POST .../entities/{entityGRN}(/prepare)` endpoint is the verified surface for Phase 10's `share_entity` write path.
- `08-TEST-STRATEGY.md` is in place for Phases 9/10/11 to link — the dryRun-default, throwaway-entity harness, and GRN URL-encoding rule are fixed before any apply handler is written.

## Self-Check: PASSED
- `scripts/capture-authz-prepare-fixture.js` — FOUND
- `test/fixtures/authz/prepare-response-7.0.6.json` — FOUND
- `test/authz-grn.test.js` — FOUND (fixture-shape group appended)
- `.planning/phases/08-authz-foundation-grn-helper-live-api-recon/08-TEST-STRATEGY.md` — FOUND
- Commit `c353464` — FOUND
- Commit `6316226` — FOUND
- Commit `f787af6` — FOUND
- `node --test test/authz-grn.test.js` — 16/16 pass; `npm test` — 1119/1119 pass

---
*Phase: 08-authz-foundation-grn-helper-live-api-recon*
*Completed: 2026-05-19*
