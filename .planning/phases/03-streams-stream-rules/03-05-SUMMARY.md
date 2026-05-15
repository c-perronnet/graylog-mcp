---
phase: 03-streams-stream-rules
plan: 05
subsystem: testing
tags: [snapshot, schema-parity, validation, c2-gate, d11-updated, d02-updated]

# Dependency graph
requires:
  - "Plans 03-01..03-04 — all 12 net-new tool surfaces shipped"
  - "Phase 0 snapshot infrastructure + auth-redaction lint + schema-parity template"
  - "Phase 2 auth-redaction confirmationToken context allowlist (consumed automatically for the Phase 3 cascade-hash tokens)"
provides:
  - "12 byte-identical snapshot fixtures pinning Phase 3's safety contracts (C2 cascade hash with two frozen hashes, ROADMAP SC1/SC2/SC3/SC4 acceptance gates, D-09 mutable refusal, UPDATED D-11 8-variant rule coverage)"
  - "12 assertSchemaParityForTool calls covering every Phase 3 tool — no drift between zod and src/tools.js JSON-Schema"
  - "03-VALIDATION.md flipped to wave_0_complete:true + nyquist_compliant:true + status:complete"
affects:
  - "All future Phase 4+ mutating tools — schema-parity enrichment pattern is the per-tool template"
  - "Any later snapshot-bearing test surface — the keyed-buckets cascade-hash pattern in src/tools/_shared/cascade-hash.js applies"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Keyed-buckets cascade-hash canonicalization: `sha256(JSON.stringify({ <parentId>, cascades: { <bucket1>: sorted, <bucket2>: sorted, ... } }))` — preserves type information; rule IDs never collide with pipeline-connection IDs in the hash"
    - "Refusal-envelope snapshots: when a handler returns isError:true with content[0].text as a plain message (not JSON), snapshot the FULL envelope rather than JSON.parse(text). The two shapes are structurally distinct in fixture, which matches their semantic distinction"

# Files
key-files:
  created:
    - "test/__snapshots__/streams.test.js.snapshot (12 fixtures — 4 create_stream incl. 3 existingMatches buckets + 2 delete_stream cascade + 1 confirmation_mismatch refusal + 1 stream_immutable refusal + 2 test_stream_match + 1 update STRICT_NO_ECHO + 1 list_stream_rules narrow projection)"
    - ".planning/phases/03-streams-stream-rules/03-05-SUMMARY.md"
  modified:
    - "test/streams.test.js (12 new snapshot assertions in dedicated fixture blocks; 4 refusal-fixture corrections from JSON.parse to envelope-snapshot per Rule 1)"
    - ".planning/phases/03-streams-stream-rules/03-VALIDATION.md (frontmatter flipped via Task 2 — wave_0_complete:true + nyquist_compliant:true + status:complete + Phase 3 Final Tally appended)"

# Outcomes
requirements_completed: [STREAM-01, STREAM-02, STREAM-03, STREAM-04, STREAM-05, STREAM-06, STREAM-07, STREAM-08, STREAM-09, STREAM-10, STREAM-11]
threats_mitigated: [T-03-05-01, T-03-05-02, T-03-05-03, T-03-05-04]
---

# Plan 03-05 Summary

Final plan of Phase 3. Closes the testing loop with deterministic snapshot fixtures, full schema-parity coverage for the 12 new tools, the C2 byte-identical proof contract, and the VALIDATION.md flip.

## What was built

### 12 byte-identical snapshot fixtures

| # | Fixture | What it pins |
|---|---------|--------------|
| 1 | `create_stream dry-run on empty cluster` | CreateEntityRequest envelope `{entity, share_request:null}`; `postApplyEstimate.id === "__SERVER_ASSIGNED__"`; baseline shape |
| 2 | `create_stream existingMatches exact` | `similarity_reason: "exact"` (SC4 acceptance) |
| 3 | `create_stream existingMatches case_insensitive` | `similarity_reason: "case_insensitive"` (SC4 acceptance) |
| 4 | `create_stream existingMatches prefix` | `similarity_reason: "prefix"` (SC4 acceptance) |
| 5 | `delete_stream cascade preview POPULATED` | **C2 acceptance gate (populated):** frozen 64-hex `ba11f7642263fef9555f6bca0df59083ed013d6f2b572885108ea59e854714c7`; 2 rules + 1 pipeline-connection + 1 event-definition (filtered client-side); keyed-buckets canonicalization proven |
| 6 | `delete_stream cascade preview EMPTY` | **C2 acceptance gate (empty):** frozen 64-hex `dbaae7a7dea951d011756716492810fb038b4673c50db805dd95167cf84cdaab` — **different** from fixture #5; proves hash sensitivity to ID-bucket contents |
| 7 | `delete_stream apply with WRONG confirm` | C2 apply-time refusal: `isError:true`, `reason:"confirmation_mismatch"`; DELETE route throws on invocation in test (would fail RED if gate didn't fire) |
| 8 | `delete_stream on immutable stream` | D-09 acceptance: `reason:"stream_immutable"`; ZERO cascade GETs fire (cascade route mocks throw if invoked) |
| 9 | `test_stream_match dry-run literal-outer-key` | **ROADMAP SC3 acceptance:** body `{ message: { source, message, level } }`; pass-through to `/streams/{id}/testMatch` |
| 10 | `test_stream_match minimal sample` | D-11 always_match coverage; minimal field map |
| 11 | `update_stream STRICT_NO_ECHO partial` | D-14 acceptance: wire body contains ONLY the changed key (per UNREACHABLE_STRICT_NO_ECHO from 03-U1-SMOKE.md) |
| 12 | `list_stream_rules narrow projection` | STREAM-07 acceptance: items have exactly `[id, type, field, value, inverted]` |

Two consecutive `npm test` runs produce byte-identical md5 on the snapshot file: `a6bc1fe7e30b0b9d001f25ea63cb405e`. FOUND-07 determinism contract carries through cleanly.

### 12 schema-parity assertions

`test/schema-parity.test.js` total: 33 calls (2 Phase 0 + 12 Phase 1 + 8 Phase 2 + 12 Phase 3 − 1 outer-shape variant adjustment for the z.intersection-based `create_stream_rule` lookup). All 12 Phase 3 tools assertions pass on first run — no drift between zod schemas and `src/tools.js` JSON-Schema.

### VALIDATION.md flipped

Frontmatter (Task 2, commit `3898dc6`):
- `status: draft` → `status: complete`
- `wave_0_complete: false` → `wave_0_complete: true`
- `nyquist_compliant: false` → `nyquist_compliant: true`
- `completed: 2026-05-15` added

Per-task verification map updated with ✅ across the 20 rows; Wave 0 Requirements all checked. Phase 3 satisfies Nyquist Dimension 8 (every task has automated verify; sampling continuous; no watch-mode; feedback latency well under 12s).

## Test deltas

| Step | Tests | Suites |
|------|-------|--------|
| Wave 4 end (post-03-04) | 447 | 18 |
| 03-05 final | 459 | 18 |

Net new in 03-05: +12 (12 snapshot assertions in dedicated fixture blocks).

## Deviations from plan

**1. Refusal-envelope snapshot shape (Rule 1, auto-fixed during Task 1 GREEN).**
Fixtures 7 + 8 (delete_stream refusal envelopes) initially used `t.assert.snapshot(JSON.parse(res.content[0].text))` mirroring the success-path fixtures. The refusal path's `content[0].text` is a plain message string (e.g., `"[delete_stream] confirmation_mismatch: ..."`), not JSON — `JSON.parse` threw `SyntaxError`. Fix: switched both fixtures to `t.assert.snapshot(res)` to capture the full envelope verbatim. The snapshot shape is structurally distinct from success-path fixtures, which is correct — it matches the actual semantic distinction. No production code changed; only the test-side snapshot target. Committed in `074e454`.

**2. Tool-count math (Rule 1 documentation drift, inherited from Plan 01).**
Plan 05 acceptance criteria targeted 55 tools; actual is 54 (43 baseline + 12 net-new − 1 v2.3 list_streams displaced = 54). The +1 drift originated in Plan 01's frontmatter math (43 − 1 + 3 + 1 double-counted the reclaimed `list_streams`). The delta is correct (+12 net-new); only the absolute target was off by one. Documented in 03-01-SUMMARY.md and propagated forward.

**3. VALIDATION.md flipped in Task 2 rather than Task 3.**
Plans 01-05 and 02-05 reserved the VALIDATION.md flip for Task 3 (the human-verify checkpoint). Plan 03-05 Task 2 included the flip as part of the schema-parity audit. The user-facing checkpoint at Task 3 still ran (independently verified the test counts, fixture content, determinism, and 33 schema-parity assertions); the substantive review was equivalent. Acknowledged here for the audit trail.

## Self-Check: PASSED

- `npm test`: 459/459 pass, 18 suites, zero failures
- Two consecutive runs: byte-identical `.snapshot` md5sums for all `.snapshot` files
- `assertAllToolsRegistered`: OK (54 tools)
- All 11 STREAM-XX requirements covered
- C2 cascade-hash acceptance gates pin TWO distinct hashes proving hash sensitivity (keyed-buckets canonicalization)
- UPDATED D-02 (keyed-buckets), UPDATED D-11 (8 variants), D-04 (preflight failure), D-09 (mutable defense) acceptance gates all surfaced in fixtures
- VALIDATION.md `nyquist_compliant: true` + `wave_0_complete: true` + `status: complete`
- Auth-redaction lint passes with structural recognition (no string allowlist growth from Phase 3)
