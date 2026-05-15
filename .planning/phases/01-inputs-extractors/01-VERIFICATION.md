---
phase: 01-inputs-extractors
verified: 2026-05-15T11:30:00Z
status: passed
score: 11/11 must-haves verified
overrides_applied: 0
re_verification: null
---

# Phase 1: Inputs & Extractors Verification Report

**Phase Goal:** An agent can create, configure, lifecycle, and tear down Graylog inputs and their extractors safely, without ever zeroing an encrypted password through a round-tripped config.
**Verified:** 2026-05-15T11:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria + Plan must_haves)

| #   | Truth (Success Criterion / Must-have)                                                                                                                                                                | Status     | Evidence                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | SC1 — Agent can create a GELF input with `dryRun: true`, inspect POST body, re-call with `dryRun: false` to apply, receive assigned ID, and start/stop the input from one tool surface             | VERIFIED   | `src/tools/inputs/create-input.js` (defineMutatingHandler with `__SERVER_ASSIGNED__` sentinel + `_applyBody` swap), `start-input.js` (PUT), `stop-input.js` (DELETE). Tests 19, 25 in inputs.test.js + snapshot fixture 1 pin contract.        |
| 2   | SC2 — `update_input` partial change emits **only** the changed field; encrypted fields (tls_key_password, AWS creds) ABSENT from emitted payload regardless of agent input (C3 acceptance gate)    | VERIFIED   | Byte-identical snapshot `update_input partial dry-run with no-op changes emits ONLY changed field (C3 ACCEPTANCE GATE)` in `test/__snapshots__/inputs.test.js.snapshot` — `configuration` contains ONLY `{port: 12202}`. Ad-hoc node -e re-run confirms `config_key_count:1, has_tls_key_password:false, has_bind_address:false`. |
| 3   | SC3 — Agent can discover input types dynamically via `list_input_types` (GET /system/inputs/types/all) and list extractors per input via `list_extractors`; update_extractor reuses partial-update | VERIFIED   | `list-input-types.js` consumes cached catalogue from `type-catalogue.js` (D-06). `list-extractors.js` uses defineListHandler. `update-extractor.js` async build pre-flights GET + merges changes (D-09). Tests in inputs.test.js + extractors.test.js. |
| 4   | SC4 — `delete_input` dry-run enumerates affected extractors and warns operator before message-handling impact                                                                                       | VERIFIED   | `delete-input.js` build() pre-flights `GET /api/system/inputs/{id}/extractors` and returns `cascades: { extractors }`. `handler.js` BLOCKER #1 amendment forwards `req.cascades` into preview JSON. Snapshot fixture 4 pins `cascades.extractors[2]`. |
| 5   | A4 amendment — defineMutatingHandler awaits async `build()`                                                                                                                                          | VERIFIED   | `src/tools/_shared/handler.js:121` reads `req = await build({ ...args, _connectionName, _conn })`. Used by update-input.js, delete-input.js, update-extractor.js, create-input.js, create-extractor.js to pre-flight GETs inside build.    |
| 6   | A2 amendment — real `findExistingMatches({listPath, matchFn})` fires GET and projects {id, title, similarity_reason}                                                                               | VERIFIED   | `src/tools/_shared/conflict.js:24` calls `client.request("GET", opts.listPath, null)`, filters via matchFn, normalizes envelope (inputs/streams/extractors/items/array), projects. Wired in create-input.js + create-extractor.js for M5 mitigation. |
| 7   | D-06 per-connection type catalogue cache — second call within process does NOT re-fetch                                                                                                              | VERIFIED   | `src/tools/inputs/type-catalogue.js` exports `getCachedTypeCatalogue`, `getEncryptedFieldNamesForType`, `_clearTypeCatalogueForTests`. Module-level `_cache = new Map()` keyed by connectionName. Tests 7-12 in type-catalogue.test.js verify single-fetch + per-connection isolation. |
| 8   | defineListHandler `defaultFields` per-tool override (additive, back-compat)                                                                                                                          | VERIFIED   | `src/tools/_shared/list.js` destructures `defaultFields` from spec; falls back to module DEFAULT_FIELDS when absent. `list-inputs.js` uses `["id","title","type","global"]`. Test 20 pins back-compat (existing list tools see DEFAULT_FIELDS).   |
| 9   | D-04 — `create_input` redacts encrypted fields in preview (`<redacted>`) but wraps as `{set_value}` for wire body on apply                                                                          | VERIFIED   | `src/tools/inputs/redact.js` exports `REDACTION_PLACEHOLDER="<redacted>"`, `redactForPreview`, `encodeEncryptedForWire` (set_value envelope). `create-input.js` uses preview-vs-apply body asymmetry via `_applyBody`. Snapshot fixture 2 pins redaction. |
| 10  | D-07 — all 8 Graylog 7.0.6 primitive extractor types under strict zod (grok/regex/regex_replace/split_and_index/substring/copy_input/json/lookup_table); ExtractorTypeEnum rejects bogus values  | VERIFIED   | `src/tools/inputs/schemas.js` defines 8 ExtractorConfig variants + `EXTRACTOR_TYPE_TO_CONFIG` map + `ExtractorTypeEnum`. `create_extractor` tool description documents key-value → json mapping. 20 tests in extractors.test.js cover all 8 types. |
| 11  | D-09 — `delete_extractor` single-target, NO cascade enumeration (leaf-delete pattern)                                                                                                                | VERIFIED   | `src/tools/inputs/delete-extractor.js` build() returns descriptor WITHOUT `cascades` key. handler.js spreads cascades only when present (opt-in). Test asserts `payload.cascades === undefined`.                                              |

**Score:** 11/11 truths verified

### Required Artifacts (Three-level + Data-flow check)

| Artifact                                            | Expected                                                        | Status      | Details                                                                                          |
| --------------------------------------------------- | --------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| `src/tools/_shared/handler.js`                      | A4 async build + req.cascades forwarding + _connectionName/_conn pass-through | ✓ VERIFIED | `await build(...)` at line 121; `req.cascades` forwarding present; pass-through wired.            |
| `src/tools/_shared/conflict.js`                     | Real findExistingMatches (no stub)                              | ✓ VERIFIED | `client.request("GET", opts.listPath, null)` + filter + project at line 24+. Wired into create handlers. |
| `src/tools/_shared/list.js`                         | defaultFields per-tool override                                  | ✓ VERIFIED | `defaultFields` destructured from spec; consulted before module DEFAULT_FIELDS fallback.          |
| `src/tools/inputs/type-catalogue.js`                | Cache + getEncryptedFieldNamesForType + test seam               | ✓ VERIFIED | Module-level Map cache, `is_encrypted === true` filter, `_clearTypeCatalogueForTests`.            |
| `src/tools/inputs/schemas.js`                       | 12 zod schemas + 8 input variants + 8 extractor variants        | ✓ VERIFIED | All 12 exports present; GelfHttpConfig in variantMap; EXTRACTOR_TYPE_TO_CONFIG dispatch map.      |
| `src/tools/inputs/redact.js`                        | REDACTION_PLACEHOLDER + redactForPreview + encodeEncryptedForWire | ✓ VERIFIED | Placeholder `"<redacted>"`; pure helpers; set_value wire envelope; keep_value/delete_value pass-through. |
| `src/tools/inputs/list-input-types.js`              | INPUT-01 handler with catalogue cache                            | ✓ VERIFIED | Wired through defineListHandler; reads cache via getCachedTypeCatalogue.                          |
| `src/tools/inputs/list-inputs.js`                   | INPUT-02 with [id,title,type,global] projection                  | ✓ VERIFIED | `defaultFields: INPUT_DEFAULT_FIELDS = ["id","title","type","global"]` wired.                     |
| `src/tools/inputs/get-input.js`                     | INPUT-03 plain async handler                                     | ✓ VERIFIED | Full InputSummary returned; encrypted fields server-masked.                                       |
| `src/tools/inputs/create-input.js`                  | INPUT-04 with redaction + M5 existingMatches + _applyBody       | ✓ VERIFIED | Catalogue lookup, findExistingMatches, redactForPreview, encodeEncryptedForWire wired.            |
| `src/tools/inputs/update-input.js`                  | INPUT-05 C3 strict no-echo wire build                            | ✓ VERIFIED | `agentConfig` sentinel; configuration built ONLY from args.changes.configuration; NO copy-from-current loop. |
| `src/tools/inputs/delete-input.js`                  | INPUT-06 D-05 cascade enumeration                                | ✓ VERIFIED | Best-effort GET /extractors pre-flight; cascades.extractors[] surfaced.                            |
| `src/tools/inputs/start-input.js`                   | INPUT-07a PUT /inputstates                                       | ✓ VERIFIED | method: "PUT", path: /api/system/inputstates/{id}, body: undefined.                                |
| `src/tools/inputs/stop-input.js`                    | INPUT-07b DELETE /inputstates                                    | ✓ VERIFIED | method: "DELETE", same path. Verb asymmetry documented in tool description.                        |
| `src/tools/inputs/list-extractors.js`               | INPUT-08 per-input list                                          | ✓ VERIFIED | GET /api/system/inputs/{inputId}/extractors via defineListHandler.                                 |
| `src/tools/inputs/create-extractor.js`              | INPUT-09 all 8 types + extractor_id toIdBody                     | ✓ VERIFIED | superRefine dispatch; toIdBody hint `["extractor_id", "id"]`.                                      |
| `src/tools/inputs/update-extractor.js`              | INPUT-10 partial update reuse                                    | ✓ VERIFIED | Async build pre-flight + merge; extractor_type immutable at both schema and build layer.           |
| `src/tools/inputs/delete-extractor.js`              | INPUT-11 leaf-delete, no cascade                                 | ✓ VERIFIED | Descriptor WITHOUT cascades key.                                                                   |
| `src/tools/inputs/index.js`                         | Side-effect barrel registering all 12 tools                       | ✓ VERIFIED | 12 register() calls confirmed.                                                                     |
| `src/tools/_register.js`                            | Imports inputs/index.js                                          | ✓ VERIFIED | `import "./inputs/index.js"` side-effect import present.                                           |
| `src/tools.js`                                      | 12 new tool definitions appended                                  | ✓ VERIFIED | All 12 names present (`name: "*"` count = 12 matches + 23 baseline = 35 total).                    |
| `test/__snapshots__/inputs.test.js.snapshot`        | 4 fixtures (C3 gate, D-04 redaction, D-05 cascade, GELF UDP)    | ✓ VERIFIED | C3 ACCEPTANCE GATE fixture confirmed byte-identical (port:12202 only); cascades fixture present.   |
| `test/__snapshots__/extractors.test.js.snapshot`    | 1 fixture (create_extractor grok)                                | ✓ VERIFIED | grok_pattern + extractor_type present.                                                             |
| `test/fixtures/type-catalogue-7.0.6.json`           | Hand-written 3-entry catalogue with is_encrypted on GELF TCP    | ✓ VERIFIED | `is_encrypted: true` for tls_key_password; GELF UDP, GELF TCP, Beats2 entries present.             |
| `test/schema-parity.test.js`                        | 12 assertSchemaParityForTool calls                                | ✓ VERIFIED | `grep -c assertSchemaParityForTool` = 14 (helper + 12 calls + 1 inline use). All 14 tests pass.    |
| `test/inputs.test.js`                               | Wave 1-3 tests for INPUT-01..07                                  | ✓ VERIFIED | Tests pass; suite count 235/235.                                                                   |
| `test/extractors.test.js`                           | 20 tests covering INPUT-08..11 (8 types + helpers)                | ✓ VERIFIED | Suite green.                                                                                       |
| `test/type-catalogue.test.js`                       | Cache contract tests (D-06)                                       | ✓ VERIFIED | 7 tests for cache single-fetch + per-connection isolation + helper functions.                      |
| `test/conflict.test.js`                             | A2 real findExistingMatches contract tests                        | ✓ VERIFIED | 6 tests for envelope normalization + back-compat + GET method.                                     |

### Key Link Verification

| From                                              | To                                                                  | Via                                                                | Status   | Details                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------ |
| `defineMutatingHandler` build site                | async build callback                                                | `await build({ ...args, _connectionName, _conn })`                | ✓ WIRED  | handler.js:121.                                                                       |
| `conflict.js findExistingMatches`                  | `client.request("GET", listPath, null)`                            | Real HTTP GET                                                      | ✓ WIRED  | conflict.js:24 (replaces Phase 0 stub).                                               |
| `list.js defineListHandler`                        | `spec.defaultFields ?? DEFAULT_FIELDS`                              | Per-tool projection override                                       | ✓ WIRED  | Verified via grep + Test 20 back-compat.                                              |
| `update-input.js build()`                          | type-catalogue.js `getEncryptedFieldNamesForType`                  | Composes encrypted-field set per input type                        | ✓ WIRED  | C3 mitigation: encryptedFields drives encode + redact + omission logic.               |
| `update-input.js build()` configuration block      | ONLY `args.changes.configuration` (no copy-from-current loop)      | `agentConfig` sentinel + spread                                    | ✓ WIRED  | Test "C3 ACCEPTANCE GATE" snapshot pins this byte-identically.                        |
| `create-input.js build()`                          | `findExistingMatches`                                               | M5 mitigation per-cluster scoped                                   | ✓ WIRED  | listPath /api/system/inputs + matchFn(title+type).                                    |
| `create-extractor.js build()`                      | `findExistingMatches`                                               | M5 mitigation per-input scoped                                     | ✓ WIRED  | listPath /api/system/inputs/{inputId}/extractors + matchFn(title+extractor_type).      |
| `delete-input.js build()`                          | GET /api/system/inputs/{id}/extractors pre-flight                  | Best-effort cascade enumeration                                     | ✓ WIRED  | Returns `cascades: { extractors }`.                                                   |
| `handler.js` dry-run preview emitter               | `req.cascades`                                                      | One-line opt-in spread (BLOCKER #1 fix)                            | ✓ WIRED  | handler.js comment at line 149-151; spread visible in emitter; delete-input fixture confirms. |
| `_register.js`                                     | `./inputs/index.js`                                                  | Side-effect import                                                  | ✓ WIRED  | One-line `import "./inputs/index.js"` present.                                         |
| `inputs/index.js`                                  | dispatch.js `register()`                                             | 12 register() calls                                                  | ✓ WIRED  | All 12 confirmed via grep.                                                            |

### Data-Flow Trace (Level 4)

Phase 1 produces JSON MCP responses (not UI-rendered components). Data-flow tracing applies to: encrypted-field detection chain → wire body emission. Verified:

| Artifact            | Data Variable        | Source                                                          | Produces Real Data | Status    |
| ------------------- | -------------------- | --------------------------------------------------------------- | ------------------ | --------- |
| update-input.js     | `encryptedFields`    | `getEncryptedFieldNamesForType(catalogue, current.type)`        | Yes — Set from is_encrypted flags | ✓ FLOWING |
| update-input.js     | `wireBody.configuration` | `args.changes.configuration` (strict no-echo)                | Yes — only agent-passed fields | ✓ FLOWING |
| delete-input.js     | `cascades.extractors`| GET /api/system/inputs/{id}/extractors                         | Yes — populated from API + projected | ✓ FLOWING |
| list-input-types.js | catalogue entries    | `getCachedTypeCatalogue` → /api/system/inputs/types/all        | Yes — flattened to list items | ✓ FLOWING |
| create-input.js     | `existingMatches`    | `findExistingMatches({listPath, matchFn})`                     | Yes — GET-then-filter-then-project | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior                                                              | Command                                                                                                                                          | Result                                                                              | Status |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------ |
| Full test suite green                                                 | `npm test`                                                                                                                                       | 235/235 pass, 18 suites, 0 failures, duration ~2.7s                                  | ✓ PASS |
| C3 acceptance gate behavioral verification (ad-hoc, against the live handler) | node -e against update-input.js with TLS-encrypted fixture                                                                                       | `{port:12202, has_tls_key_password:false, has_bind_address:false, config_key_count:1}` | ✓ PASS |
| All 12 tools registered (dispatch contract)                            | `assertAllToolsRegistered(toolDefinitions)`                                                                                                       | "OK"                                                                                | ✓ PASS |
| Snapshot determinism (FOUND-07 carried forward)                       | two consecutive `npm test` runs + md5sum of *.snapshot                                                                                            | `diff` empty → byte-identical                                                       | ✓ PASS |
| Schema-parity gate (no drift between zod and JSON-Schema)             | `node --test test/schema-parity.test.js`                                                                                                          | 14/14 pass                                                                          | ✓ PASS |
| Auth-redaction lint passes on new snapshots                            | `node --test test/auth-redaction.test.js`                                                                                                         | pass                                                                                | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description                                                              | Status      | Evidence                                                                                                                       |
| ----------- | ----------- | ------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| INPUT-01    | 01-01       | list_input_types — dynamic catalogue discovery + cache                   | ✓ SATISFIED | list-input-types.js + type-catalogue.js + type-catalogue.test.js (7 tests).                                                     |
| INPUT-02    | 01-01       | list_inputs — narrow projection [id,title,type,global]; fields:'all' full DTO | ✓ SATISFIED | list-inputs.js with `defaultFields` override; Tests 14-15 + 19 (back-compat).                                                 |
| INPUT-03    | 01-01       | get_input — full configuration; encrypted fields server-masked            | ✓ SATISFIED | get-input.js plain async handler; Tests 16-17.                                                                                  |
| INPUT-04    | 01-02       | create_input — strict zod for GELF/Beats/Syslog/Raw; D-04 redaction        | ✓ SATISFIED | create-input.js + 8 strict variants + GELF HTTP fix; redaction snapshot fixture 2.                                              |
| INPUT-05    | 01-02       | update_input — partial-update; C3 + D-03 strict no-echo                   | ✓ SATISFIED | update-input.js with `agentConfig` sentinel; byte-identical C3 acceptance gate snapshot.                                         |
| INPUT-06    | 01-02       | delete_input — cascade preview                                            | ✓ SATISFIED | delete-input.js + cascades.extractors[] + D-05 snapshot fixture 4 + handler.js cascades forwarding.                              |
| INPUT-07    | 01-03       | start_input / stop_input — explicit lifecycle, verb asymmetry             | ✓ SATISFIED | start-input.js (PUT) + stop-input.js (DELETE) + 8 tests; descriptions document asymmetry.                                       |
| INPUT-08    | 01-04       | list_extractors — per-input                                               | ✓ SATISFIED | list-extractors.js via defineListHandler.                                                                                       |
| INPUT-09    | 01-04       | create_extractor — all 8 D-07 types under strict zod                      | ✓ SATISFIED | create-extractor.js + 8 ExtractorConfig variants + closed ExtractorTypeEnum; key-value→json mapping documented (BLOCKER #4).    |
| INPUT-10    | 01-04       | update_extractor — partial-update reuse                                   | ✓ SATISFIED | update-extractor.js async build pre-flight + merge; extractor_type immutable defense in depth.                                  |
| INPUT-11    | 01-04       | delete_extractor — single-target, no cascade                              | ✓ SATISFIED | delete-extractor.js leaf-delete pattern; absent cascades key.                                                                   |

**All 11 INPUT-XX requirements satisfied. No orphans, no unmapped IDs.**

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |

(none — no TODO/FIXME placeholder comments, no stub returns, no `return null`/`return []` empty implementations, no console.log-only handlers found in Phase 1 files.)

### Human Verification Required

(none — the phase's behaviors are fully observable through automated tests, snapshot fixtures, and ad-hoc node -e invocations. The two items in 01-VALIDATION.md's "Manual-Only Verifications" section — live 7.0.6-vs-7.2 endpoint shape divergence and end-to-end TLS update_input against live Graylog at <graylog-host> — are documented as non-blocking corrective smoke tests, not required gates for phase completion. They are listed as Phase 7 (final hardening) concerns or follow-up operational tasks, not Phase 1 blockers.)

### Gaps Summary

**No gaps.** All 11 must-haves verified; 4 ROADMAP success criteria satisfied; 11 requirements covered; full test suite (235/235) green with byte-identical snapshot determinism across consecutive runs; module-init contract holds (`assertAllToolsRegistered` → OK); the C3 mitigation centerpiece is captured byte-identically in `test/__snapshots__/inputs.test.js.snapshot` under the `C3 ACCEPTANCE GATE` fixture, and the live ad-hoc verification (node -e) reproduces the contract independently.

The phase exceeds Phase 0 contract carry-forward:
- Snapshot determinism preserved (6 .snapshot files, byte-identical across two `npm test` runs)
- Auth-redaction lint extended via regex narrowing (not allowlist growth) to recognise `<...>` placeholder syntax
- Schema-parity coverage extended from 2 baseline tests to 14 (2 + 12 Phase 1 tools)
- Tool count milestone: 23 v2.3 + 12 Phase 1 = 35 advertised tools, all with registered handlers.

Phase 1 is ready to close. Next: Phase 2 (Index Sets & Retention).

---

_Verified: 2026-05-15T11:30:00Z_
_Verifier: Claude (gsd-verifier)_
