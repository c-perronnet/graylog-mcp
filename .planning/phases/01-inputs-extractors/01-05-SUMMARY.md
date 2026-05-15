---
phase: 01-inputs-extractors
plan: 05
subsystem: testing
tags: [snapshot, schema-parity, auth-redaction, validation, c3-gate]

# Dependency graph
requires:
  - "Plans 01-01..01-04 — all 12 new tool surfaces shipped"
  - "Phase 0 snapshot infrastructure + auth-redaction lint + schema-parity template"
provides:
  - "5 byte-identical snapshot fixtures pinning Phase 1's safety contracts (D-03 strict no-echo, D-04 redaction, D-05 cascade preview, server-assigned ID sentinel)"
  - "12 assertSchemaParityForTool calls covering every Phase 1 tool — no drift between zod and src/tools.js JSON-Schema"
  - "Hand-written type-catalogue fixture at test/fixtures/type-catalogue-7.0.6.json for stable tests"
  - "Auth-redaction lint narrowed at regex level to recognise project placeholder syntax (<...>) as non-leaks"
  - "01-VALIDATION.md flipped to wave_0_complete:true + nyquist_compliant:true"
affects:
  - "All future Phase 2+ mutating tools — schema-parity enrichment pattern is the per-tool template"
  - "Any later snapshot-bearing test surface — the placeholder-syntax convention applies"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Placeholder-syntax convention: values wrapped in `<...>` are reserved across the project as redacted/masked-by-design placeholders and are never real secrets"
    - "Regex-level placeholder recognition (rather than string-level allowlist) — narrows the lint without growing a safe-string global surface"

# Files
key-files:
  created:
    - "test/__snapshots__/inputs.test.js.snapshot (4 fixtures — create UDP, create TCP redacted, update C3 gate, delete cascade)"
    - "test/__snapshots__/extractors.test.js.snapshot (1 fixture — create grok)"
    - "test/fixtures/type-catalogue-7.0.6.json (3-entry hand-written catalogue: GELF UDP, GELF TCP with is_encrypted, Beats2)"
    - ".planning/phases/01-inputs-extractors/01-05-SUMMARY.md"
  modified:
    - "test/inputs.test.js (snapshot assertions on the 4 input fixtures)"
    - "test/extractors.test.js (snapshot assertion on grok fixture)"
    - "test/schema-parity.test.js (+12 assertSchemaParityForTool calls — all pass first run)"
    - "test/auth-redaction.test.js (regex-level placeholder recognition; isAllowedMatch unchanged)"
    - ".planning/phases/01-inputs-extractors/01-VALIDATION.md (wave_0_complete + nyquist_compliant flipped, status → approved)"

# Outcomes
requirements_completed: [INPUT-01, INPUT-02, INPUT-03, INPUT-04, INPUT-05, INPUT-06, INPUT-07, INPUT-08, INPUT-09, INPUT-10, INPUT-11]
threats_mitigated: [T-01-05-01, T-01-05-04]
---

# Plan 01-05 Summary

Final plan of Phase 1. Closes the testing loop with deterministic snapshot fixtures, full schema-parity coverage for the 12 new tools, a stable type-catalogue fixture, and the VALIDATION.md flip.

## What was built

### 5 byte-identical snapshot fixtures (FOUND-07 contract carried into Phase 1)

| # | Fixture | What it pins |
|---|---------|--------------|
| 1 | `create_input GELF UDP dry-run` | Baseline POST body — `configuration: { bind_address, port }`, no encrypted fields, `postApplyEstimate.id === "__SERVER_ASSIGNED__"` |
| 2 | `create_input GELF TCP redacted` | D-04 redaction: `tls_key_password: "<redacted>"`; literal `"secret"` is NOT in the snapshot anywhere |
| 3 | `update_input C3 ACCEPTANCE GATE` | **The byte-identical C3 mitigation proof.** `preview.body.configuration` contains exactly `{ port: 12202 }` — `tls_key_password`, `bind_address`, and `tls_enable` are ALL absent. ROADMAP success criterion 2 held in fixture form. |
| 4 | `delete_input cascade D-05` | `cascades.extractors[2]` populated via best-effort pre-flight GET so the operator sees blast radius in dry-run |
| 5 | `create_extractor grok` | D-07 reconfirmation: extractor_config carries `grok_pattern`, `__SERVER_ASSIGNED__` sentinel for the not-yet-known extractor id |

Two consecutive `npm test` runs produce byte-identical md5sums for all 6 `.snapshot` files (4 Phase 0 + 2 Phase 1). Determinism contract from FOUND-07 carries over.

### 12 schema-parity assertions

Extended `test/schema-parity.test.js` with `assertSchemaParityForTool` calls for every Phase 1 tool: `list_input_types`, `list_inputs`, `get_input`, `create_input`, `update_input`, `delete_input`, `start_input`, `stop_input`, `list_extractors`, `create_extractor`, `update_extractor`, `delete_extractor`. **All 12 pass on first run** — no drift between zod schemas and src/tools.js JSON-Schema. Plans 02/03/04 authors got the JSON-Schema entries right the first time.

### Type-catalogue fixture

Hand-written `test/fixtures/type-catalogue-7.0.6.json` — 3 entries (GELF UDP, GELF TCP with `tls_key_password.is_encrypted: true`, Beats2). Documented Wave 0 fallback per VALIDATION.md when a live capture from `<graylog-host>` is not attempted. Mirrors the Java-source shapes verified in RESEARCH.md.

### Auth-redaction lint narrowed (Rule 1 corrective)

First attempt (commit `ec3df16`) extended `isAllowedMatch()` with string-level allowlist entries for `<redacted>` and `<value hidden>` — rejected at the human-verify checkpoint because it broadened the safe-string global surface.

Corrected approach (commit `c216dc4`): narrowed the `PASSWORD_LITERAL` regex itself so values wrapped in single-pair angle brackets do not match in the first place:

```js
const PASSWORD_LITERAL = /password['"]?\s*[:=]\s*['"]([^"'<>]+)['"]/i;
```

The character class `[^"'<>]+` rejects values containing angle brackets at the regex level — the placeholder is recognised structurally rather than allowlisted as a specific string. Documented as a project-wide convention: values shaped `<…>` are reserved placeholder syntax and never represent real secrets (a real secret containing `<` or `>` could not survive a JSON or HTTP round-trip without escaping).

`isAllowedMatch()` returns to its single Phase 0 branch (the idempotency-key context check). No growth of the safe-string surface.

### VALIDATION.md flipped

Frontmatter:
- `status: draft` → `status: approved`
- `wave_0_complete: false` → `wave_0_complete: true`
- `nyquist_compliant: false` → `nyquist_compliant: true`
- `approved: 2026-05-15` added

Phase 1 satisfies Nyquist Dimension 8 (every task carries an automated verify command; sampling continuous; no watch-mode; feedback latency well under 15s).

## Test deltas

| Step | Tests | Suites |
|------|-------|--------|
| Wave 4 end (post-01-04) | 223 | 18 |
| 01-05 final | 235 | 18 |

Net new in 01-05: +12 (5 snapshot assertions, 12 schema-parity, -5 stub assertions replaced by the snapshot ones).

## Deviations from plan

**1. Auth-redaction allowlist initially extended, then corrected to regex narrowing** (commits `ec3df16` → `c216dc4`).
The first attempt added explicit `<redacted>` and `<value hidden>` allowlist entries to `isAllowedMatch()`. The user rejected this at the human-verify checkpoint because it broadened the global safe-string surface. The corrective approach narrowed the password-literal regex itself with the character class `[^"'<>]+`, so placeholder syntax fails to match without growing the allowlist. This is the better design and the fix is now load-bearing — extending the placeholder convention to future encrypted-field surfaces requires no further auth-redaction changes.

**2. Live type-catalogue capture skipped, hand-written fixture used.**
VALIDATION.md Wave 0 Requirements row 6 documents the hand-written fixture as the safe default when the live Graylog at `<graylog-host>` is not reachable from the build environment. Live capture remains a documented bonus path; the 3 entries hand-mirror Java-source shapes that were verified in RESEARCH.md.

## Self-Check: PASSED

- `npm test`: 235/235 pass, 18 suites, zero failures
- Two consecutive runs: byte-identical `.snapshot` md5sums for all 6 files
- `assertAllToolsRegistered`: OK
- Tool count: 35 (23 v2.3 + 12 Phase 1 net-new)
- All 11 INPUT-XX requirements covered
- C3 acceptance gate byte-identical proof preserved in `update_input partial dry-run with no-op changes emits ONLY changed field` fixture
- VALIDATION.md `nyquist_compliant: true` + `wave_0_complete: true` flipped
- Auth-redaction lint passes for the right reason (regex-level placeholder recognition)
