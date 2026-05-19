---
phase: 08-authz-foundation-grn-helper-live-api-recon
plan: 02
subsystem: auth
tags: [sha256, node-crypto, authz, confirmation-token, cascade-hash]

# Dependency graph
requires:
  - phase: 03-streams
    provides: computeCascadeHash keyed-bucket hash + byte-identity test discipline in test/cascade-hash.test.js
  - phase: 05-events-notifications
    provides: computeNotificationCascadeHash thin-wrapper precedent (the forwarding pattern this plan deviates from)
provides:
  - computeShareGrantHash standalone canonical-form sha-256 hash for the Phase 10 share_entity confirmation token
  - Frozen byte-identity pin (64-hex literal) locking the grant-hash canonical form against drift
  - Grant-order-independence, entityGrn-sensitivity, and malformed-input regression tests
affects: [phase-10-entity-sharing-write-path, share_entity, drift-refusal]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Standalone canonical-form hash: a confirmation-token helper that builds its own JSON and calls createHash directly, NOT forwarding into computeCascadeHash"

key-files:
  created: []
  modified:
    - src/tools/_shared/cascade-hash.js
    - test/cascade-hash.test.js

key-decisions:
  - "computeShareGrantHash is standalone — it does NOT forward into computeCascadeHash (unlike computeRuleCascadeHash/computeNotificationCascadeHash); a flat grant list does not fit the keyed-bucket shape, so it builds its own canonical JSON. Deviation documented in the cascade-hash.js section banner."
  - "Canonical JSON shape LOCKED to { entityGrn, grants: [...sorted by grantee] } and byte-pinned to a frozen 64-hex literal so any drift fails loudly."

patterns-established:
  - "Standalone canonical-form hash wrapper: validate inputs, normalize+sort, JSON.stringify, createHash(sha256).digest(hex) — no forwarding into the keyed-bucket helper"

requirements-completed: [AUTHZ-02]

# Metrics
duration: 9min
completed: 2026-05-19
---

# Phase 8 Plan 02: computeShareGrantHash — Entity-Share Confirmation Token Summary

**Standalone canonical-form sha-256 hash `computeShareGrantHash({entityGrn, grants})` added to `cascade-hash.js`, with its byte-identity pinned to a frozen 64-hex literal so Phase 10's drift-refusal token cannot be silently weakened.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-05-19
- **Completed:** 2026-05-19
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `computeShareGrantHash` exported from `src/tools/_shared/cascade-hash.js` — a standalone canonical-form sha-256 hash over the merged grant set, with the deviation from the forwarding wrappers (`computeRuleCascadeHash`/`computeNotificationCascadeHash`) documented in the section banner and JSDoc.
- Canonical JSON shape `{ entityGrn, grants: [...sorted by grantee] }` locked and byte-pinned to the frozen 64-hex literal `3a410b0a3f88d967b1586a6193248baa6652a2ab5beef16f6b785e125872ca41`.
- Four new tests: frozen-fixture byte-identity, grant-order independence (T-08-05), entityGrn-sensitivity, and malformed-input rejection.
- Full suite green: 1116/1116.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add computeShareGrantHash to cascade-hash.js** - `15ca3ca` (feat)
2. **Task 2: Pin computeShareGrantHash byte-identity in cascade-hash.test.js** - `81bb610` (test)

_Note: This is a `tdd="true"` plan; the plan ordered implementation (Task 1) before the byte-identity tests (Task 2), since Task 2 must recompute the frozen literal from the landed implementation. The 21 pre-existing cascade-hash tests acted as the regression net during Task 1._

## Files Created/Modified
- `src/tools/_shared/cascade-hash.js` - Appended the `Phase 8 — computeShareGrantHash` section: banner documenting the no-forward deviation, JSDoc, and the standalone hash (validate → normalize to `{grantee,capability}` → sort by grantee → `JSON.stringify` → `createHash("sha256").digest("hex")`). Reuses the existing line-25 `createHash` import; no new import.
- `test/cascade-hash.test.js` - Added `computeShareGrantHash` to the import block and appended a 4-test group (frozen-fixture, order-independence, entityGrn-sensitivity, malformed-input) with a `// Recompute via:` one-liner comment above the pinned literal.

## Decisions Made
- **Standalone vs forward:** `computeShareGrantHash` builds its own canonical JSON and calls `createHash` directly rather than forwarding into `computeCascadeHash`. A grant set is a flat `[{grantee,capability}]` list with no cross-type buckets to disambiguate; the keyed-bucket shape does not fit. This breaks the forwarding uniformity of the Phase 4/5 wrappers, so the deviation is documented in the file's section banner and JSDoc (08-RESEARCH Q1, ARCHITECTURE.md §"Token shape").

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `computeShareGrantHash` is ready for Phase 10's `share_entity` to compute the TOCTOU drift-refusal confirmation token.
- The canonical form is byte-pinned; if Phase 10 (the true consumer) needs a different grant representation, the frozen literal must be updated deliberately and the change will be caught loudly by the byte-identity test.

## Self-Check: PASSED
- `src/tools/_shared/cascade-hash.js` — FOUND, `computeShareGrantHash` exported (grep count 1)
- `test/cascade-hash.test.js` — FOUND, `computeShareGrantHash` referenced 20× (≥4 required)
- Commit `15ca3ca` — FOUND
- Commit `81bb610` — FOUND
- `node --test test/cascade-hash.test.js` — 25/25 pass; `npm test` — 1116/1116 pass

---
*Phase: 08-authz-foundation-grn-helper-live-api-recon*
*Completed: 2026-05-19*
