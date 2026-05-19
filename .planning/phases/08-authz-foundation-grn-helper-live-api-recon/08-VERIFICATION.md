---
phase: 08-authz-foundation-grn-helper-live-api-recon
verified: 2026-05-19T00:00:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification: false
---

# Phase 8: AuthZ Foundation — GRN Helper & Live API Recon Verification Report

**Phase Goal:** The GRN abstraction exists, is unit-tested, and the live Graylog 7.0.6 authz surface is captured as fixtures so every later phase builds on verified endpoint shapes — not on the milestone brief's wrong `PUT` path or the two-minors-ahead 7.2 source clone.
**Verified:** 2026-05-19
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `buildGrn`/`parseGrn`/`isGrn` round-trip a valid 6-token lowercased GRN; unknown type rejected client-side with the valid-type set listed | ✓ VERIFIED | `grn-helpers.js` L48-93; runtime check prints `true`; 10 passing tests in `test/authz-grn.test.js` |
| 2 | The `authz` domain is wired in — barrel exists, `_register.js` imports it, `Capability` enum pinned to `view`/`manage`/`own` | ✓ VERIFIED | `src/tools/authz/index.js` exists; `_register.js` line 95 `import "./authz/index.js";`; `schemas.js` L17 `z.enum(["view","manage","own"])`; barrel loads cleanly and registers zero handlers |
| 3 | A captured real 7.0.6 `prepare` response fixture exists; the corrected endpoint `POST /api/authz/shares/entities/{entityGRN}/prepare` verified against the live `test` instance | ✓ VERIFIED | `test/fixtures/authz/prepare-response-7.0.6.json` exists; `_provenance.graylog_version = "7.0.6+711d207"`; `_provenance.endpoint = "POST /api/authz/shares/entities/grn%3A%3A%3A%3Astream%3A6a0899bc670fc246e77ca54e/prepare"`; all 5 required `EntityShareResponse` keys present |
| 4 | `computeShareGrantHash` added to `src/tools/_shared/cascade-hash.js` with byte-identity pinned in `test/cascade-hash.test.js` | ✓ VERIFIED | Export found at `cascade-hash.js` L302; pinned literal `3a410b0a3f88d967b1586a6193248baa6652a2ab5beef16f6b785e125872ca41` at `cascade-hash.test.js` L475; 20 references in test file; `node --test test/cascade-hash.test.js` 25/25 pass |
| 5 | The live-production test strategy is documented | ✓ VERIFIED | `08-TEST-STRATEGY.md` exists and contains all required literals: `dryRun`, `/prepare`, `PUT /api/authz/shares` (recorded wrong), `POST /api/authz/shares/entities/{entityGRN}` (verified correct), `builtin-team:everyone` (forbidden in tests) |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/tools/authz/grn-helpers.js` | `buildGrn`/`parseGrn`/`isGrn`/`GRN_TYPES` pure functions | ✓ VERIFIED | 110 lines; exports all 4 symbols; provenance header; JSDoc per export; throw-on-malformed discipline |
| `src/tools/authz/schemas.js` | `Capability` zod enum | ✓ VERIFIED | 17 lines; `z.enum(["view","manage","own"])`; correctly imports only `z` (no mutatingBase — Phase 8 ships no handlers) |
| `src/tools/authz/index.js` | Empty side-effect register barrel | ✓ VERIFIED | 17 lines; imports `register` but calls it 0 times; loads without error |
| `src/tools/_register.js` | Imports `"./authz/index.js"` | ✓ VERIFIED | Line 95: `import "./authz/index.js";`; grep count = 1 |
| `test/authz-grn.test.js` | Unit tests for grn-helpers, schemas, and fixture shape | ✓ VERIFIED | 194 lines; 16 tests covering round-trip, lowercasing, unknown-type rejection, structural validation, `isGrn` predicate, `Capability` enum, and fixture shape; 16/16 pass |
| `src/tools/_shared/cascade-hash.js` | `computeShareGrantHash` export (appended) | ✓ VERIFIED | Section added at L254-318; standalone (does NOT forward into `computeCascadeHash`); calls `createHash("sha256")` directly |
| `test/cascade-hash.test.js` | Byte-identity + order-independence tests | ✓ VERIFIED | 20 references to `computeShareGrantHash`; frozen 64-hex literal present; 4 test groups (frozen-fixture, order-independence, entityGrn-sensitivity, malformed-input); 25/25 pass |
| `scripts/capture-authz-prepare-fixture.js` | One-shot read-only live `/prepare` probe | ✓ VERIFIED | 6441 bytes; imports `buildGrn` + `makeClient`; uses `encodeURIComponent`; asserts path ends in `/prepare`; no raw axios; no commit endpoint |
| `test/fixtures/authz/prepare-response-7.0.6.json` | Verbatim live 7.0.6 `EntityShareResponse` capture | ✓ VERIFIED | Captured from live instance `http://<graylog-host>` at `2026-05-19T14:27:50.892Z`; all expected DTO keys present; `synced_entities` present as empty array |
| `.planning/phases/08-authz-foundation-grn-helper-live-api-recon/08-TEST-STRATEGY.md` | Live-production authz test strategy doc | ✓ VERIFIED | Contains `dryRun`, `/prepare`, `PUT /api/authz/shares` (wrong), `builtin-team:everyone` (forbidden), corrected `POST` endpoint, GRN URL-encoding rule, throwaway-entity harness spec |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/tools/_register.js` | `src/tools/authz/index.js` | `import "./authz/index.js";` | ✓ WIRED | Exact pattern present at line 95 |
| `scripts/capture-authz-prepare-fixture.js` | `src/tools/authz/grn-helpers.js` | `import { buildGrn } from "../src/tools/authz/grn-helpers.js"` | ✓ WIRED | Line 31 of probe script |
| `scripts/capture-authz-prepare-fixture.js` | `src/graylog/client.js` | `import { makeClient } from "../src/graylog/client.js"` | ✓ WIRED | Line 32 of probe script; `makeClient(conn).request(...)` called at L67/L102 |
| `src/tools/_shared/cascade-hash.js` | `node:crypto createHash` | `createHash("sha256")` called directly (NOT forwarded) | ✓ WIRED | L317: `return createHash("sha256").update(canonical).digest("hex")`; reuses existing line-25 import |

---

### Data-Flow Trace (Level 4)

Not applicable — Phase 8 ships no agent-facing MCP tools that render dynamic data to an MCP client. All deliverables are pure helpers, a test fixture, and a one-shot probe script.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| GRN round-trip `buildGrn("stream","ABC")` → `entity="abc"` | `node -e` import check | `round-trip: true` | ✓ PASS |
| Unknown type throws with valid set listed | `node -e` import check | `error lists Valid types: true` | ✓ PASS |
| `GRN_TYPES.size === 6` | `node -e` import check | `GRN_TYPES size: 6` | ✓ PASS |
| `computeShareGrantHash` is order-independent and returns 64-hex | `node -e` import check | `order-independent: true` | ✓ PASS |
| `Capability.parse("view")` succeeds; `parse("read")` throws | `node -e` import check | `view: true`, `read rejected: true` | ✓ PASS |
| `authz/index.js` barrel loads without error | `node -e` import check | `barrel loads: ok` | ✓ PASS |
| Full test suite green | `npm test` | `1119 pass, 0 fail` | ✓ PASS |
| `test/authz-grn.test.js` 16/16 | `node --test` | `16 pass, 0 fail` | ✓ PASS |
| `test/cascade-hash.test.js` 25/25 | `node --test` | `25 pass, 0 fail` | ✓ PASS |

---

### Probe Execution

| Probe | Notes | Status |
|-------|-------|--------|
| `scripts/capture-authz-prepare-fixture.js` | This is the live-recon probe, not an automated test probe. It requires a live network call to the UNESCO production `test` instance. It was run during the human-verify checkpoint (Plan 08-03 Task 2) and produced the committed fixture `test/fixtures/authz/prepare-response-7.0.6.json`. The fixture's `_provenance` block records the HTTP 200 result, the 7.0.6 instance address, and the capture timestamp — this is the durable evidence of the probe run. Re-running it in the verifier's process is not required (it would mutate the fixture file). | PASS (evidence in fixture provenance) |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| AUTHZ-02 | 08-01, 08-02, 08-03 | Authz tool surface verified against live Graylog 7.0.6 — correct endpoint, GRN URL-encoding | ✓ SATISFIED | Live fixture captured with HTTP 200; corrected `POST .../prepare` endpoint verified; brief's `PUT` path recorded wrong in `08-TEST-STRATEGY.md`; GRN helper + Capability enum ready for Phases 9-11 |

No orphaned requirements. REQUIREMENTS.md traceability table maps exactly AUTHZ-02 to Phase 8 (verified complete). All other milestone requirements (SHARE-*, ROLE-*, AUTHZ-01) are assigned to Phases 9-11.

---

### Anti-Patterns Found

None. Scan of all 7 phase-8-modified files found:
- Zero `TBD`/`FIXME`/`XXX` debt markers
- Zero placeholder/stub strings
- Zero hardcoded empty returns in functional code (the empty `authz/index.js` barrel is an intentionally empty scaffolding artifact per the known context, not a stub)
- The 7-token GRN form (`grn:::::`) appears nowhere in `grn-helpers.js` (grep count = 0)
- `authz/index.js` registers zero handlers (grep of non-comment lines for `register(` = 0)

---

### Human Verification Required

None. All success criteria are programmatically verifiable:
- Pure helper functions verified via runtime invocation
- Test suite green at 1119/1119
- Fixture provenance records the live HTTP 200 result durably
- Test strategy document verified for required content

---

## Gaps Summary

No gaps. All 5 roadmap success criteria are satisfied with direct codebase evidence.

---

_Verified: 2026-05-19_
_Verifier: Claude (gsd-verifier)_
