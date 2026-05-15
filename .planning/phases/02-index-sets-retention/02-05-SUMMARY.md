---
phase: 02-index-sets-retention
plan: 05
subsystem: testing
tags: [snapshot, schema-parity, auth-redaction, validation, c1-gate, d13-updated, d14-updated, d15-updated]

# Dependency graph
requires:
  - "Plans 02-01..02-04 — all 8 new tool surfaces shipped"
  - "Phase 0 snapshot infrastructure + auth-redaction lint + schema-parity template"
  - "Phase 1 Plan 01-05 auth-redaction structural-recognition pattern"
provides:
  - "9 byte-identical snapshot fixtures pinning Phase 2's safety contracts (C1 hash with frozen 64-hex values, UPDATED D-13/D-14/D-15 envelope shapes, D-04 inverted default, D-05 stats hard-block)"
  - "8 assertSchemaParityForTool calls covering every Phase 2 tool — no drift between zod and src/tools.js JSON-Schema"
  - "Auth-redaction lint extended structurally to recognize Graylog Java FQCNs (Rule 1 corrective; same regex-level recognition principle as Phase 1's <…> placeholder convention — no string allowlist growth)"
  - "02-VALIDATION.md flipped to wave_0_complete:true + nyquist_compliant:true + status:approved"
affects:
  - "All future Phase 3+ mutating tools — schema-parity enrichment pattern is the per-tool template"
  - "Any later snapshot-bearing test surface — the FQCN structural recognition applies; the <…> placeholder convention applies"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Structural FQCN recognition in auth-redaction: a 32+ char alphanumeric match is allowed iff preceded by `.` AND `org.graylog` appears within the 80-char lookbehind window. Same regex-level principle as Phase 1's <…> placeholder recognition."
    - "Frozen 64-hex hash fixtures in snapshots — C1 confirmation tokens are byte-pinned so canonicalization drift surfaces as a snapshot diff"

# Files
key-files:
  created:
    - "test/__snapshots__/index-sets.test.js.snapshot (8 fixtures: create+update×2+delete×3+set_default+cycle)"
    - "test/__snapshots__/system-job.test.js.snapshot (1 fixture: await_system_job dry-run polling plan)"
    - ".planning/phases/02-index-sets-retention/02-05-SUMMARY.md"
  modified:
    - "test/index-sets.test.js (8 snapshot assertions)"
    - "test/system-job.test.js (1 snapshot assertion)"
    - "test/schema-parity.test.js (extensions confirmed at 22 total: 2 baseline + 12 Phase 1 + 8 Phase 2)"
    - "test/auth-redaction.test.js (structural FQCN recognition; confirmationToken context allowlist mirroring idempotencyKey pattern)"
    - ".planning/phases/02-index-sets-retention/02-VALIDATION.md (wave_0_complete + nyquist_compliant flipped; status → approved)"

# Outcomes
requirements_completed: [INDEX-01, INDEX-02, INDEX-03, INDEX-04, INDEX-05, INDEX-06, INDEX-07, INDEX-08]
threats_mitigated: [T-02-05-01, T-02-05-04]
---

# Plan 02-05 Summary

Final plan of Phase 2. Closes the testing loop with deterministic snapshot fixtures, full schema-parity coverage for the 8 new tools, the C1 byte-identical proof contract, and the VALIDATION.md flip.

## What was built

### 9 byte-identical snapshot fixtures

| # | Fixture | What it pins |
|---|---------|--------------|
| 1 | `create_index_set time-based+delete dry-run` | TimeBasedRotationStrategy + DeletionRetentionStrategy FQCN pairs; `postApplyEstimate.id === "__SERVER_ASSIGNED__"`; frozen `creation_date` via `_setClockForTests` for determinism |
| 2 | `update_index_set title-only (MERGE_FROM_CURRENT)` | U1 smoke outcome: full DTO merged from current; immutable fields preserved; agent-supplied `title` overrides |
| 3 | `update_index_set strategy-replace D-11 atomic` | Both `rotation_strategy_class` AND `rotation_strategy.type` swapped atomically; retention block preserved from current |
| 4 | `delete_index_set deleteIndices:false (no token)` | D-04 inverted default; path ends `?delete_indices=false`; NO confirmationToken; NO cascades |
| 5 | `delete_index_set deleteIndices:true empty index set` | **C1 acceptance gate (empty):** frozen 64-hex hash `ed22c223ab80ce359fbb3d00b3ca46a76f99cbe07a658c1f3a3e644c5c337d1d`; cascades.messageCount:0; cascades.indices:[]; UPDATED D-15 envelope (`async:true`, no `job_id`, `job_id_observable_at:"/system/jobs"`) |
| 6 | `delete_index_set deleteIndices:true populated index set` | **C1 acceptance gate (populated):** frozen 64-hex hash `d5f10faaada8fc8f558b1a53cc8777a83fd73fa9172aa65fb36728ff246583c0` — **different** from fixture #5; cascades.indices sorted; cascades.indexCount:3 — proves hash sensitivity to messageCount + indexNames |
| 7 | `set_default_index_set ineligible` | **UPDATED D-13 acceptance gate:** isError:true; reason `default_eligibility_failed`; text names `can_be_default: false`. ROADMAP success criterion 3 proven in fixture form |
| 8 | `cycle_deflector dry-run` | **UPDATED D-14 acceptance gate:** `postApplyEstimate.async: false` (sync); `side_effects.observable_at: "/system/jobs"`; `side_effects.describes` mentions the range-rebuild |
| 9 | `await_system_job dry-run` | D-06 + D-07: `postApplyEstimate.plan: [500, 1000, 2000, 4000, 5000]`; `timeoutMs: 60000`; note that apply blocks |

Two consecutive `npm test` runs produce byte-identical md5sums for all 8 `.snapshot` files (4 Phase 0 + 2 Phase 1 + 2 Phase 2). Determinism contract from FOUND-07 carries through cleanly.

### 8 schema-parity assertions

`test/schema-parity.test.js` carries 22 `assertSchemaParityForTool` calls total: 2 Phase 0 baseline + 12 Phase 1 + 8 Phase 2 (`list_index_sets`, `get_index_set`, `await_system_job`, `create_index_set`, `update_index_set`, `delete_index_set`, `set_default_index_set`, `cycle_deflector`). All 8 Phase 2 assertions pass on first run — no drift between the zod schemas and the `src/tools.js` JSON-Schema entries.

### Auth-redaction lint extension (Rule 1 corrective)

Plan 01-05's regex-level placeholder recognition principle applied again — no string-level allowlist growth.

`MessageCountRotationStrategyConfig` (34 chars, Graylog Java FQCN) tripped the 32+ alphanumeric token regex. The corrective adds a structural rule: a 32+ char alphanumeric match is allowed iff **(a)** preceded by `.` **AND (b)** the substring `org.graylog` appears within the 80-char lookbehind window. This is regex-level structural recognition — it admits the closed family of "FQCN segment with project-namespaced ancestor" without admitting arbitrary 32+ char alphanumeric strings.

Synthetic sanity-checked: a tampered fixture with both an FQCN AND a real `Authorization: Bearer <40-char-secret>` correctly flags ONLY the Bearer token.

The `confirmationToken` context allowlist (mirroring the existing `idempotencyKey` pattern) was the planned extension; it lets the C1 hash fixture's 64-hex value snapshot stably without triggering the apiToken-like regex on a public deterministic hash.

### VALIDATION.md flipped

Frontmatter:
- `status: draft` → `status: approved`
- `wave_0_complete: false` → `wave_0_complete: true`
- `nyquist_compliant: false` → `nyquist_compliant: true`
- `approved: 2026-05-15` added

Phase 2 satisfies Nyquist Dimension 8 (every task has an automated verify; sampling continuous; no watch-mode; feedback latency under 12s).

## Test deltas

| Step | Tests | Suites |
|------|-------|--------|
| Wave 4 end (post-02-04) | 335 | 18 |
| 02-05 final | 335 | 18 |

Net new in 02-05: 0 net test count (the 9 snapshot assertions replaced existing inline tests in the same `t.assert.snapshot()` block).

## Deviations from plan

**1. Auth-redaction structural FQCN recognition (Rule 1 corrective).** Anticipated as a small `confirmationToken` allowlist; surfaced an additional FQCN-recognition need when `MessageCountRotationStrategyConfig` tripped the lint. Followed Phase 1's regex-level principle: narrow the regex/structural recognition, never grow the string allowlist. Documented inline.

**2. Live-instance smoke not run.** The U1 + cycle smokes were already resolved by Plan 02-01 (UNREACHABLE_DEFAULT_MERGE / SYNC_OPTION_A). Plan 02-05 didn't re-attempt live capture; the unit fixtures + ad-hoc tests are sufficient. Live smoke is documented as an optional bonus path in VALIDATION.md.

## Self-Check: PASSED

- `npm test`: 335/335 pass, 18 suites, zero failures
- Two consecutive runs: byte-identical `.snapshot` md5sums for all 8 files
- `assertAllToolsRegistered`: OK
- Tool count: 43 (23 v2.3 + 12 Phase 1 + 8 Phase 2)
- All 8 INDEX-XX requirements covered
- C1 acceptance gate fixtures pin TWO distinct hashes proving hash sensitivity
- UPDATED D-13, D-14, D-15 acceptance gates all surfaced in fixtures
- VALIDATION.md `nyquist_compliant: true` + `wave_0_complete: true` + `status: approved`
- Auth-redaction lint passes with structural recognition (no string allowlist growth)
