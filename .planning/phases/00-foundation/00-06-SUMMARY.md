---
phase: 00-foundation
plan: 06
subsystem: testing-closure
tags: [snapshot, found-07, auth-redaction, schema-parity, determinism, phase-closure]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: "node:test runner + setResolveSnapshotPath (Plan 01); handler/list/normalize/dispatch tests (Plans 03/04/05); auth-redaction + schema-parity stubs (Plan 01)"
provides:
  - "10 deterministic snapshot fixtures across handler/list/normalize/dispatch domains"
  - "test/auth-redaction.test.js — Pitfall 6 enforcement scanning every snapshot file for credential leaks (Authorization headers, 32+ char apiToken-like strings, password literals) with context-aware allowlist for idempotency-key false positives"
  - "test/schema-parity.test.js — Pitfall 3 scaffold asserting mutatingBase + listBase shape keys; documents Phase 1+ enrichment pattern"
  - "Phase 0 closing handshake: wave_0_complete: true + nyquist_compliant: true in VALIDATION.md frontmatter"
affects:
  - "Every Phase 1+ snapshot — auth-redaction.test.js auto-includes new .snapshot files in scan (no per-fixture allowlist required)"
  - "Phase 1+ first mutating tool — must extend schema-parity.test.js with assertSchemaParityForTool calls per the commented enrichment template"
  - "Phase 0 ROADMAP success criterion 3 — provably met (10 deterministic fixture snapshot tests pass byte-identically across two runs)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Snapshot test pattern: t.assert.snapshot(JSON.parse(res.content[0].text)) snapshots the parsed payload, not the raw text — eliminates JSON.stringify key-order quirks while keeping output human-readable"
    - "Determinism enforcement via md5sum across two consecutive npm test runs — any non-deterministic input (Date.now, random IDs, unstable sort) would surface as a checksum diff"
    - "Context-aware allowlist for snapshot lint: isAllowedMatch inspects the ~40 chars preceding a regex match to distinguish idempotencyKey field values (32 hex chars) from genuine apiToken leaks (also 32+ alphanumeric chars but in a different context)"
    - "Dynamic file enumeration in security tests: readdirSync(SNAPSHOTS_DIR) + filter on .snapshot — future fixtures inherit the same scan automatically, no per-fixture allowlist"

key-files:
  created:
    - "test/__snapshots__/handler.test.js.snapshot"
    - "test/__snapshots__/list.test.js.snapshot"
    - "test/__snapshots__/normalize.test.js.snapshot"
    - "test/__snapshots__/dispatch.test.js.snapshot"
  modified:
    - "test/handler.test.js (+4 t.assert.snapshot() calls)"
    - "test/list.test.js (+3 t.assert.snapshot() calls)"
    - "test/normalize.test.js (+1 t.assert.snapshot() call covering 3 shapes)"
    - "test/dispatch.test.js (+2 t.assert.snapshot() calls)"
    - "test/auth-redaction.test.js (replaced stub with full Pitfall 6 lint)"
    - "test/schema-parity.test.js (replaced stub with mutatingBase + listBase baseline)"
    - ".planning/phases/00-foundation/00-VALIDATION.md (wave_0_complete + nyquist_compliant → true)"

key-decisions:
  - "Append (not replace) snapshot tests to the existing test files from Plans 03/04/05 — shape-only assertions remain alongside snapshot-based ones, so a tightening of the wrapper that breaks shape OR breaks byte-identity fails the right test for the right reason"
  - "Snapshot the JSON-parsed payload (t.assert.snapshot(JSON.parse(text))) rather than the raw text — eliminates JSON.stringify key-order dependence and keeps the .snapshot file readable"
  - "Static-only args in all 10 fixtures (no Date.now, no randomUUID, no current-machine state) — reproducibility across developer machines is the entire point of the FOUND-07 contract"
  - "Context-aware allowlist in auth-redaction.test.js: idempotency keys (32-hex sha-256 truncations) match the generic 32+ char alphanumeric regex but are explicitly allowed when the preceding context is `idempotencyKey\":` — false-positive otherwise turns the scanner into noise"
  - "Schema-parity Phase 0 baseline is just mutatingBase + listBase shape-key assertions; the commented enrichment template documents the Phase 1+ extension pattern but ships no live tool-coverage today (per the plan)"

patterns-established:
  - "Every Phase 1+ test that uses t.assert.snapshot() automatically participates in the auth-redaction scan — no per-test opt-in required"
  - "Every Phase 1+ plan that ships a mutating tool MUST extend test/schema-parity.test.js with `assertSchemaParityForTool(toolName, zodSchema)` calls per the commented template"
  - "Determinism check pattern: md5sum test/__snapshots__/*.snapshot before and after a second npm test run; any drift is a Rule 1 bug in the underlying handler"

requirements-completed: [FOUND-07]

# Metrics
duration: ~10 min
completed: 2026-05-15
---

# Phase 00 Plan 06: Snapshot Infrastructure Closure Summary

**10 byte-identical FOUND-07 snapshot fixtures pass deterministically across two consecutive `npm test` runs; auth-redaction lint actively scans every `.snapshot` file for credential leaks with idempotency-key allowlisting; schema-parity scaffold establishes Phase 0 baseline; `npm test` grows 142 → 153 / 18 suites; Phase 0 closes with all 13 FOUND requirements green and `wave_0_complete + nyquist_compliant` flipped to `true` in VALIDATION.md.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-15T09:35:00Z
- **Completed:** 2026-05-15T09:45:00Z
- **Tasks:** 3 (Task 1 TDD RED+GREEN, Task 2 stub-replace, Task 3 verification-only)
- **Commits:** 4 task commits + 1 metadata commit (this SUMMARY + STATE + ROADMAP + REQUIREMENTS)
- **Files created:** 4 (the four snapshot fixture files)
- **Files modified:** 6 (4 test files + auth-redaction.test.js + schema-parity.test.js) + 1 docs (VALIDATION.md)
- **Test growth:** 142 → 153 (+11 net-new; 10 snapshot fixtures + 3 schema-parity tests minus 2 stub replacements)

## Fixture-by-Fixture Map (FOUND-07)

The 10 fixtures from RESEARCH.md Q7 lines 1097-1107, by test file:

| # | Fixture | Test File | What It Snapshots |
|---|---------|-----------|---|
| 1 | defineMutatingHandler dry-run happy path | `test/handler.test.js` | Full parsed payload: dryRun + tool + connection + idempotencyKey + summary + preview + postApplyEstimate + existingMatches + applyHint |
| 2 | defineMutatingHandler zod-validation-failure | `test/handler.test.js` | { isError, contentType, text } envelope with the zod-formatted error string |
| 3 | defineMutatingHandler writable=false short-circuit | `test/handler.test.js` | { isError, reason: "connection_read_only", contentText } |
| 4 | defineMutatingHandler idempotency-key determinism | `test/handler.test.js` | { idempotencyKey, matched: true } — proves k1 === k2 across two invocations with identical args |
| 5 | defineListHandler default projection | `test/list.test.js` | Full parsed payload with default fields = [id, title, description], 2-item items array |
| 6 | defineListHandler fields: "all" | `test/list.test.js` | Full parsed payload with fields = "all" and unprojected item (extras present) |
| 7 | defineListHandler limit clamped to MAX_LIMIT | `test/list.test.js` | Full parsed payload with limit: 200 (clamped from 5000) |
| 8 | toIdBody across 3 shapes | `test/normalize.test.js` | Combined object with stream_response / input_response / extractor_response from toIdBody(...) |
| 9 | dispatch unknown-tool error | `test/dispatch.test.js` | { errorMessage: "Tool not found: snapshot_ghost" } |
| 10 | assertAllToolsRegistered missing-handler error | `test/dispatch.test.js` | { errorMessage: "Dispatch assertion failed — ... ghost_x, ghost_y" } |

## Determinism Proof

Two consecutive `npm test` runs produced byte-identical snapshot files. md5sum hashes across both runs:

```
06914d2eec3ab4a9f095d6e0f60efe55  test/__snapshots__/list.test.js.snapshot
6be9b517c8d9393e2ec637e6afa71aa4  test/__snapshots__/handler.test.js.snapshot
e05deb67dad4b96957e4f3d8edd5946e  test/__snapshots__/normalize.test.js.snapshot
e45b695d78a41608861711b4db15227d  test/__snapshots__/dispatch.test.js.snapshot
```

The exit-code-zero second run (no `--test-update-snapshots`) is the canonical determinism proof — node:test re-reads each `.snapshot` file and compares its parsed content byte-for-byte against the current run's emitted payload.

## Final Per-Requirement Verification Matrix (Phase 0)

| Req | Command | Result |
|-----|---------|--------|
| FOUND-01 | `node --test test/dispatch.test.js test/regression/read-tools.test.js` | 22 / 22 green |
| FOUND-02 | `node --test test/graylog-client.test.js` | 15 / 15 green |
| FOUND-03 | `node --test test/handler.test.js` | 14 / 14 green |
| FOUND-04 | `grep -c "__SERVER_ASSIGNED__" src/tools/_shared/dry-run.js src/tools/_shared/handler.js` | 2 + 2 = 4 (≥1) |
| FOUND-05 | `node -e "import('./src/tools/_shared/schemas.js').then(m => { m.mutatingBase.parse({}); console.log('OK'); })"` | prints `OK` |
| FOUND-06 | `npm test && node -e "console.log(process.versions.node)"` | exit 0; node 22.22.2 (≥ 22.3.0) |
| FOUND-07 | Two `npm test` runs → identical md5sum of snapshot files | identical (4 hashes match) |
| FOUND-08 | `node --test test/normalize.test.js` | 9 / 9 green |
| FOUND-09 | `node --test test/connection.test.js` | 10 / 10 green |
| FOUND-10 | `node --test test/idempotency.test.js` | 15 / 15 green |
| FOUND-11 | `grep -c "existingMatches" src/tools/_shared/handler.js src/tools/_shared/dry-run.js` | 4 + 3 = 7 (≥1) |
| FOUND-12 | `node --test test/list.test.js` | 11 / 11 green |
| FOUND-13 | `grep -cE 'name: "(use_connection\|fetch_graylog_messages\|...)"' src/tools.js` | 0 (all 12 old names absent) |
| D-07 | `node --test test/connection.test.js test/graylog-client.test.js test/handler.test.js` | 39 / 39 green |
| D-05 | `ls test-clustering.js test-features.js test-aggregation-fixes.js test-histogram-fixes.js 2>/dev/null` | empty (all 4 deleted) |

All 13 FOUND requirements + D-05 + D-07 are green. `npm test` exits 0 with 153 tests / 18 suites.

## Auth-Redaction Scan Strategy

`test/auth-redaction.test.js` reads every `.snapshot` file under `test/__snapshots__/` dynamically (via `readdirSync`) and runs three deny-pattern regexes against each file's content:

| Pattern | Regex | Why |
|---------|-------|-----|
| Authorization header | `/Authorization/i` | Catches any header-style leak (`"Authorization": "Bearer ..."`) |
| 32+ char alphanumeric | `/[A-Za-z0-9]{32,}/` | Catches apiToken-like strings (Graylog tokens are 40+ chars typically) |
| Password literal | `/password['"]?\s*[:=]\s*['"][^'"]+['"]/i` | Catches inline password values (`"password": "xyz"`) |

**Idempotency-key allowlist:** Snapshot fixture 1 includes the literal idempotencyKey `"c2563630c56b18bf5dfdb3bda76bea97"` (32 hex chars — matches the apiToken regex). The `isAllowedMatch` helper inspects the ~40 chars preceding each match: if the surrounding text identifies the value as an `idempotencyKey` field (regex `/idempotencyKey['"]?\s*[:=]\s*['"]?$/`), the match is whitelisted. All other 32+ char alphanumeric matches still trigger a violation.

**Synthetic-fixture sanity check:** Verified the scanner correctly fires against a tampered fixture file containing `"Authorization": "Bearer xyz"` and a freshly-generated 40-char alphanumeric — the test exits non-zero with both violations listed. The allowlist does not over-allow.

## Schema-Parity Scaffold Rationale

Phase 0 ships NO mutating tools — `src/tools.js` contains only the 23 v2.3 read tools (12 renamed in Plan 05), none of which have per-domain zod schemas. The shared bases `mutatingBase` and `listBase` exist in `src/tools/_shared/schemas.js` but have no corresponding `inputSchema` JSON-Schema entry in `src/tools.js` to drift-check against.

The Phase 0 baseline therefore asserts only the contract of the shared bases:
- `mutatingBase.shape` keys = `["connectionName", "dryRun", "idempotencyKey"]`
- `listBase.shape` keys = `["connectionName", "fields", "limit"]`

Any later edit to these bases that drops a key (or adds an undocumented one) immediately breaks the baseline test. Phase 1+ enriches via the commented `assertSchemaParityForTool(toolName, zodSchema)` template — when the first mutating tool ships, its per-domain zod schema gets registered and the JSON-Schema keys in `src/tools.js` get compared against the zod shape keys. Drift = test failure.

## Task Commits

| # | Task | Commit | Type | Note |
|---|------|--------|------|------|
| 1a | Task 1 RED: add 10 FOUND-07 snapshot fixtures | `422f942` | test | RED gate — tests fail with ERR_INVALID_STATE (no snapshot file) |
| 1b | Task 1 GREEN: generate 4 snapshot fixture files | `ab6c628` | test | GREEN gate — node --test --test-update-snapshots writes files; second run exits 0 |
| 2 | Task 2: auth-redaction + schema-parity implementations | `2f643e0` | test | Both stubs replaced; full suite 152 → 153 |
| 3 | Task 3: flip VALIDATION.md frontmatter | `e6bfb72` | docs | wave_0_complete + nyquist_compliant → true |

## Decisions Made

- **Snapshot the JSON-parsed payload, not the raw text.** `t.assert.snapshot(JSON.parse(res.content[0].text))` produces a `.snapshot` file with the object formatted by node:test's default serializer (sorted keys, 2-space indent, deterministic). Snapshotting the raw text would expose the JSON.stringify call-site key order, which is technically implementation-defined for `Object.keys()` order. The parse-then-snapshot pattern is robust to future refactors of the wrapper.
- **Append, don't replace.** The Plan 04 shape-only assertions in handler.test.js / list.test.js stay alongside the new snapshot assertions. They check complementary things: shape assertions verify "the right keys with the right types are present"; snapshot assertions verify "the exact byte content matches what we approved." A wrapper change that breaks shape (e.g. drops `idempotencyKey`) fails the shape test with a specific assertion; a wrapper change that subtly drifts the body content (e.g. changes the dry-run preview indentation) fails the snapshot test. Both signals are useful.
- **Static-only fixture args.** No `Date.now()`, no `randomUUID()`, no machine-dependent strings (apiToken samples, hostnames). The idempotency key in fixture 1 is `c2563630c56b18bf5dfdb3bda76bea97` — that's the sha-256 of the canonicalized `{ connectionName: "fixture_conn", toolName: "create_stream", args: { title: "Snapshot fixture stream" } }`, deterministic by construction. Two devs on two machines see the same key; any drift is a Rule 1 bug in `_canonicalize` or `deriveIdempotencyKey`.
- **Context-aware allowlist over per-fixture exemption.** The naive approach to the idempotency-key false-positive would be to maintain a list of known-safe 32-char hashes in the auth-redaction test. That list would need maintenance every time a fixture changes. Instead, `isAllowedMatch` inspects the ~40 chars preceding the match and allows the value when the JSON-shape context (`"idempotencyKey": "...`) is present. Self-maintaining; no per-fixture overhead.
- **Schema-parity stays minimal in Phase 0.** The plan called for a baseline that "passes trivially and is enriched in Phase 1+". The shipped scaffold goes one small step beyond trivial: it asserts the shared-base shapes. This catches accidental edits to `mutatingBase` / `listBase` (e.g. dropping `idempotencyKey` from the base) which would otherwise silently propagate to every Phase 1+ tool.

## Deviations from Plan

None. The plan executed exactly as written.

Specifically:
- No Rule 1 bugs found (no broken behavior caught during testing — every assertion passed on first try after generating snapshots).
- No Rule 2 missing functionality added (the plan fully specifies the scan strategy, the allowlist mechanism, and the schema-parity scaffold).
- No Rule 3 blockers (the test infrastructure from Plans 01/03/04/05 is already in place; idempotency keys deterministic by construction, no flakiness).
- No Rule 4 architectural questions (the design is fully prescribed in the plan's `<action>` block).

The plan offered a `require_or_import_safely` helper for schema-parity which the plan itself also marked as "thought-experiment artifact" to remove — we shipped the clean version with only the 2 baseline tests and the commented enrichment template, as the plan directed in its "Final clean version" block.

## Threat Surface

All threats in the plan's `<threat_model>` are mitigated by the shipped code:

- **T-00-06-01 (apiToken in snapshot fixture):** Mitigated. `test/auth-redaction.test.js` scans every `.snapshot` file for the three deny patterns; the test fails the build on match. Synthetically verified the scanner fires correctly against a tampered fixture (see "Auth-Redaction Scan Strategy" above).
- **T-00-06-02 (idempotency-key non-determinism):** Mitigated. Two consecutive `npm test` runs produce identical md5sums of all 4 snapshot files. `_canonicalize` in `src/tools/_shared/idempotency.js` sorts keys recursively and excludes `dryRun` + `idempotencyKey` from the projection, so the same logical args always hash to the same key.
- **T-00-06-03 (stack traces in snapshots leaking paths):** Accepted. The snapshot fixtures store `t.assert.snapshot(JSON.parse(res.content[0].text))` — parsed JSON payloads, not error stack strings. The zod-validation-failure fixture captures only `res.content[0].text` which is the formatted zod error message (`"title: String must contain at least 1 character(s)"`), no stack trace included.
- **T-00-06-04 (schema-parity scaffold trivial in Phase 0):** Mitigated by documentation. The commented enrichment template in `test/schema-parity.test.js` explicitly calls out the Phase 1+ responsibility, and this SUMMARY's "Schema-Parity Scaffold Rationale" section makes it discoverable when planning Phase 1.
- **T-00-06-05 (Phase 1+ forgets to extend schema-parity):** Mitigated by the explicit pattern documented in `patterns-established` above: "Every Phase 1+ plan that ships a mutating tool MUST extend test/schema-parity.test.js with assertSchemaParityForTool calls". Captured here as a Phase 1 dependency.

No new threat surface beyond what the plan covered. No `## Threat Flags` section needed.

## Issues Encountered

None. Plan executed cleanly end-to-end; all 10 fixtures green on first generate, deterministic on the second run, auth-redaction lint green on first execution against the freshly-generated fixtures.

## User Setup Required

None — pure test additions; no new dependencies, no configuration, no external services.

## TDD Gate Compliance

This plan ran as TDD per the plan frontmatter (`tdd="true"` on Tasks 1 and 2):

- **Task 1 RED gate:** `422f942` — `test(00-06): add 10 FOUND-07 snapshot fixtures (RED)`. Verified failing: `node --test test/handler.test.js test/list.test.js test/normalize.test.js test/dispatch.test.js` exits non-zero with 10 tests failing on `ERR_INVALID_STATE — Missing snapshots can be generated by rerunning the command with the --test-update-snapshots flag`.
- **Task 1 GREEN gate:** `ab6c628` — `test(00-06): generate 10 FOUND-07 snapshot fixture files (GREEN)`. 48 / 48 tests pass on the second run (no `--test-update-snapshots`); md5sum verified deterministic across two consecutive runs.
- **Task 2 (atomic):** `2f643e0` — `test(00-06): implement auth-redaction lint + schema-parity scaffold`. Both stubs replaced with real implementations in a single commit because the prior Plan 01 stubs already trivially passed; this is a stub-replacement, not a RED→GREEN cycle. All 3 tests (1 auth-redaction + 2 schema-parity) pass on first execution.

No REFACTOR gate fired (no cleanup needed; GREEN was clean).

## Next Phase Readiness

- `npm test` exits 0 with 153 / 18 suites.
- Snapshot infrastructure is fully proven: any Phase 1+ test that calls `t.assert.snapshot()` automatically resolves to `test/__snapshots__/<basename>.test.js.snapshot` (via `setResolveSnapshotPath` from Plan 01) and is auto-scanned by `test/auth-redaction.test.js` for credential leaks.
- Schema-parity scaffold ready for enrichment: Phase 1's first plan shipping a mutating tool MUST extend `test/schema-parity.test.js` with one `assertSchemaParityForTool(toolName, zodSchema)` call per the commented template.
- Phase 0 is closed: `wave_0_complete: true` and `nyquist_compliant: true` in `00-VALIDATION.md` frontmatter. All 13 FOUND requirements green.
- Phase 1 (Inputs & Extractors) is unblocked — `INPUT-01` through `INPUT-11` can begin composing through `defineMutatingHandler` / `defineListHandler`.

## Self-Check: PASSED

- All 4 snapshot fixture files present on disk:
  - `test/__snapshots__/handler.test.js.snapshot` (4 fixtures)
  - `test/__snapshots__/list.test.js.snapshot` (3 fixtures)
  - `test/__snapshots__/normalize.test.js.snapshot` (1 fixture covering 3 shapes)
  - `test/__snapshots__/dispatch.test.js.snapshot` (2 fixtures)
- 4 task commits resolvable in git history: `422f942` (Task 1 RED), `ab6c628` (Task 1 GREEN), `2f643e0` (Task 2), `e6bfb72` (Task 3).
- All grep acceptance counts hit:
  - `grep -c "t.assert.snapshot" test/handler.test.js` → 4 (≥4)
  - `grep -c "t.assert.snapshot" test/list.test.js` → 3 (≥3)
  - `grep -c "t.assert.snapshot" test/normalize.test.js` → 1 (≥1)
  - `grep -c "t.assert.snapshot" test/dispatch.test.js` → 2 (≥2)
  - `grep -c "Authorization" test/auth-redaction.test.js` → 3 (≥1)
  - `grep -c "isAllowedMatch" test/auth-redaction.test.js` → 2 (≥1)
  - `grep -c "schema-parity" test/schema-parity.test.js` → 2 (≥1)
- Two consecutive `npm test` runs produce byte-identical md5sums (4 hashes match exactly).
- `test/auth-redaction.test.js` synthetically verified: a tampered fixture with `"Authorization": "Bearer xyz"` + a 40-char alphanumeric correctly triggers 2 violations.
- VALIDATION.md frontmatter has `wave_0_complete: true` + `nyquist_compliant: true`.

---
*Phase: 00-foundation*
*Plan: 06*
*Completed: 2026-05-15*
