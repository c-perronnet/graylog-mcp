---
phase: 01-inputs-extractors
plan: 02
subsystem: api
tags: [graylog, inputs, zod, mcp-tools, encrypted-fields, c3-mitigation, dry-run, redaction, partial-update]

# Dependency graph
requires:
  - phase: 01-inputs-extractors-01
    provides: "await build() in defineMutatingHandler, real findExistingMatches({listPath, matchFn}), getCachedTypeCatalogue + getEncryptedFieldNamesForType, per-domain module layout under src/tools/inputs/, defineListHandler defaultFields override"
provides:
  - "create_input (INPUT-04): D-04 encrypted-field redaction in preview; strict zod for GELF UDP/TCP/HTTP + Beats2 + Syslog UDP/TCP + Raw UDP/TCP; generic fallback for other types; M5 existingMatches via real findExistingMatches; { set_value } encoding on apply"
  - "update_input (INPUT-05): C3 mitigation centerpiece; D-03 STRICT NO-ECHO wire-build (configuration block built only from args.changes.configuration; no copy-from-current loop); encrypted fields never on wire unless explicitly passed; explicit values wrapped { set_value } on wire and <redacted> in preview"
  - "delete_input (INPUT-06): D-05 cascade enumeration via best-effort pre-flight GET /api/system/inputs/{id}/extractors; cascades.extractors[] surfaced in dry-run"
  - "redact.js: REDACTION_PLACEHOLDER ('<redacted>'), redactForPreview, encodeEncryptedForWire — pure helpers reusable by future encrypted-field domains (events, AWS auth, etc.)"
  - "handler.js cascades-forwarding amendment (one-line opt-in spread for req.cascades in dry-run preview emitter) — declared in this plan's files_modified per BLOCKER #1"
  - "handler.js threads _connectionName + _conn through build args (additive to existing _testConnection seam contract) — eliminates duplicate resolveConnection calls inside build()"
  - "CreateInputSchema + UpdateInputSchema + DeleteInputSchema in src/tools/inputs/schemas.js — superRefine variant dispatch on FQCN (8 strict variants + generic fallback)"
affects: [01-03-start-stop-input, 01-04-extractors, 01-05-snapshots, plan-02-streams, plan-03-pipelines, plan-04-events]

# Tech tracking
tech-stack:
  added: []  # No new dependencies — zod + axios + @modelcontextprotocol/sdk only
  patterns:
    - "Preview-vs-apply body asymmetry: redactForPreview produces the dry-run body; encodeEncryptedForWire produces the apply body; handlers carry _applyBody as a sibling on RequestDescriptor so apply() reads the wire body, never the redacted one"
    - "Strict no-echo wire-build for partial-update: build wire body ONLY from args.changes — never copy from current state. Graylog's PUT deserializer preserves unspecified fields server-side via EncryptedInputConfigs.merge"
    - "agentConfig sentinel: null = agent did not touch configuration; {} = agent passed empty configuration; {...} = agent passed specific changes. Sentinel distinguishes omit-key-entirely vs. emit-empty-object on the wire"
    - "superRefine for discriminated config validation: top-level schema accepts generic z.record(z.unknown()) for the configuration field, then superRefine dispatches to a strict per-FQCN variant when registered. Errors re-pathed under ['configuration', ...issue.path] for a clean error tree"
    - "_connectionName + _conn pass-through in defineMutatingHandler.build() — matches the equivalent pass-through already in defineListHandler.fetch() (Plan 01-01). Build callbacks no longer call resolveConnection a second time"

key-files:
  created:
    - "src/tools/inputs/redact.js"
    - "src/tools/inputs/create-input.js"
    - "src/tools/inputs/update-input.js"
    - "src/tools/inputs/delete-input.js"
  modified:
    - "src/tools/_shared/handler.js (one-line cascades forwarding + _connectionName/_conn pass-through into build args)"
    - "src/tools/inputs/schemas.js (CreateInputSchema + UpdateInputSchema + DeleteInputSchema + 8 strict variant configs)"
    - "src/tools/inputs/index.js (3 new register() calls)"
    - "src/tools.js (3 new tool definitions with full descriptions)"
    - "test/inputs.test.js (18 new tests — RED then GREEN)"

key-decisions:
  - "Strict no-echo wire-build (D-03 acceptance): the prior plan iteration's copy-from-current loop is gone. Wire configuration is built ONLY from args.changes.configuration. Graylog's PUT deserializer preserves unspecified fields server-side via EncryptedInputConfigs.merge — verified by Test 27 (C3 acceptance gate: config_key_count === 1 with only the agent-requested port key)"
  - "agentConfig sentinel: when changes.configuration is undefined (agent did not pass it), the configuration key is OMITTED from the wire body entirely (strictest 'only the changed field'). When agent passes {} explicitly, configuration is emitted as an empty object. Both paths satisfy ROADMAP success criterion 2"
  - "_connectionName + _conn pass-through into defineMutatingHandler.build() — additive change to handler.js owned by this plan. Matches the pass-through pattern already in defineListHandler.fetch() from Plan 01-01. Build callbacks reach the resolved connection without a duplicate resolveConnection call; the project-standard _testConnection seam still flows through (handler.js's pre-zod merge is unchanged)"
  - "REDACTION_PLACEHOLDER = '<redacted>' chosen over '••••' (Unicode bullet) for ASCII-safety in snapshot fixtures and grep tooling. Discretion-03 resolved. Single constant in redact.js consumed by every redaction call site"
  - "_applyBody sibling on RequestDescriptor: handler.js is body-agnostic — apply(client, req) receives the descriptor as-is. create_input and update_input set _applyBody to the wire body so apply() reads it instead of req.body (the redacted preview). The handler.js contract is unchanged; per-tool internals carry the asymmetry"
  - "GELF HTTP gets a strict variant (WARNING #9 fix): NettyBase + TlsConfigExt + HTTP-codec fields (idle_writer_timeout, max_chunk_size, enable_cors, additional_headers, decompress_size_limit). Without it, GELF HTTP would have fallen through to the generic z.record(z.unknown()) and lost port-required validation"
  - "Best-effort extractor pre-flight in delete_input: a 404 / 403 on GET /api/system/inputs/{id}/extractors does NOT fail the dry-run; we surface an empty cascade list and let the real DELETE error bubble through on apply via wrapGraylogError. The dry-run is informational, not authoritative — degraded preview > no preview"

patterns-established:
  - "Encrypted-field protection composition: getEncryptedFieldNamesForType(catalogue, type) → encodeEncryptedForWire(config, encryptedFields) for wire body + redactForPreview(config, encryptedFields) for preview. Both functions are pure and shallow-copy-only; reusable by any future tool with encrypted fields (event-notification credentials, AWS S3 keys, etc.)"
  - "Strict no-echo for partial-update: never iterate current state to copy unchanged fields. Build wire body ONLY from agent-passed changes; rely on the server's merge to preserve unspecified entries. Reusable for any Graylog PUT endpoint that accepts a partial body (event definitions, index sets, etc.)"
  - "Cascade enumeration via build-time pre-flight + handler.js cascades-forwarding: delete-shaped tools pre-flight the cascade list inside build() and return { cascades: { ... } }; handler.js spreads it into the dry-run JSON when present. Stream-delete (Phase 3) and pipeline-rule delete (Phase 4) reuse this pattern"
  - "Variant-map dispatch via superRefine: register a strict zod schema per FQCN in a variantMap object; superRefine looks up the variant and re-paths its issues. Adding a new strict variant is a one-line addition to variantMap. Plan 01-04 (create_extractor) and later create_* tools use the same pattern keyed on their respective discriminator field"

requirements-completed: [INPUT-04, INPUT-05, INPUT-06]

# Metrics
duration: ~8 min
completed: 2026-05-15
---

# Phase 1 Plan 02: Input CRUD (create_input + update_input + delete_input) Summary

**Three input-CRUD mutating tools shipped + the C3 + D-03 mitigation centerpiece: update_input emits ONLY agent-requested fields on the wire (no copy-from-current loop), encrypted fields never echoed, explicit values wrapped as { set_value } on wire and <redacted> in preview; plus D-04 encrypted-field redaction in create_input previews and D-05 cascade enumeration in delete_input dry-runs**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-15T10:31:31Z
- **Completed:** 2026-05-15T10:39:11Z
- **Tasks:** 2 (TDD RED + GREEN)
- **Files modified/created:** 8 (5 source + 3 modified-existing + 1 test)

## Accomplishments

- **C3 mitigation centerpiece landed:** `update_input` ships the D-03 STRICT NO-ECHO wire-build. The `configuration` object on the wire is built ONLY from `args.changes.configuration`. There is no copy-from-current loop. When the agent passes `changes: { configuration: { port: 12202 } }` against a TLS-encrypted input, the wire body contains exactly `{ configuration: { port: 12202 } }` — no `tls_key_password`, no `bind_address`, no `tls_enable`. Verified by Test 27 (`config_key_count === 1`). The C3 pitfall (encrypted-field zeroing via round-tripped masked values) is impossible to reproduce because nothing from current state flows back to Graylog.
- **D-03 ROADMAP success criterion 2 satisfied:** When the agent passes `changes: { configuration: {} }`, the wire body's `configuration` is the empty object `{}` (one key in changes; configuration key emitted as empty). When the agent passes only `changes: { title: "..." }` (no `configuration` key), the wire body OMITS the configuration block entirely. Both paths satisfy "preview emits ONLY the changed field". Tests 28 + 29 pin both shapes.
- **D-04 redaction landed:** `create_input` and `update_input` dry-run previews show encrypted fields (e.g. `tls_key_password`) as `<redacted>` — never the literal secret. The apply body wraps the same value as `{ set_value: "<plaintext>" }` so Graylog's `EncryptedInputConfigs.merge` treats it as a fresh encryption target. Test 20 + Test 31 verify the literal value never appears in the dry-run JSON.
- **D-05 cascade enumeration landed:** `delete_input` pre-flights `GET /api/system/inputs/{id}/extractors` inside `build()` and surfaces `cascades.extractors[{id, title, extractor_type}]` in the dry-run preview. Test 34 verifies the agent sees the blast radius before applying. Best-effort: a 404/403 on the pre-flight yields an empty cascade list, not a failure.
- **BLOCKER #1 fix landed:** `src/tools/_shared/handler.js` got the one-line additive amendment to forward `req.cascades` into the dry-run preview JSON. Opt-in only — handlers that don't set `req.cascades` see no behavior change.
- **GELF HTTP strict variant landed (WARNING #9 fix):** `GelfHttpConfig` extends `NettyBase + TlsConfigExt` with HTTP-codec fields (`idle_writer_timeout`, `max_chunk_size`, `enable_cors`, `additional_headers`, `decompress_size_limit`). Wired into `variantMap` so GELF HTTP no longer falls through to the generic `z.record(z.unknown())`. Test 21 verifies the strict schema accepts; Test 22 verifies port-required rejection.
- **8 strict input variants total:** GELF UDP / TCP / HTTP + Beats2 + Syslog UDP / TCP + Raw UDP / TCP. Generic fallback for everything else (AWS, CEF, Kafka, OpenTelemetry, etc.) preserved via top-level `z.record(z.unknown())`.
- **M5 mitigation wired:** `create_input.build()` calls real `findExistingMatches({ listPath: "/api/system/inputs", matchFn: (i) => i.title === args.title && i.type === args.type })` and surfaces `existingMatches: [{id, title, similarity_reason}]` in the dry-run. Test 25 pins the contract.
- **Test growth:** 177 → 195 (+18). All 177 baseline tests continue passing — zero regressions on Plan 01-01.

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1: RED — 18 failing tests for create_input + update_input + delete_input** — `d1ba1f1` (test)
2. **Task 2: GREEN — handlers + redact.js + schemas extension + handler.js cascades amendment + tools.js + index.js** — `1e7520b` (feat)

_Plan metadata commit follows separately (this SUMMARY.md + STATE.md + ROADMAP.md)._

## Files Created/Modified

### Created (source)
- `src/tools/inputs/redact.js` — `REDACTION_PLACEHOLDER = "<redacted>"`, `redactForPreview(config, encryptedFields)`, `encodeEncryptedForWire(config, encryptedFields)`. Pure helpers; no I/O.
- `src/tools/inputs/create-input.js` — `handleCreateInput` via `defineMutatingHandler`. Catalogue lookup, `findExistingMatches`, redact-for-preview + encode-for-wire, `_applyBody` sibling for apply path.
- `src/tools/inputs/update-input.js` — `handleUpdateInput` via `defineMutatingHandler`. C3 mitigation centerpiece. Pre-flight GET on current input + catalogue lookup. STRICT NO-ECHO wire-build (`agentConfig` sentinel; no copy-from-current loop). `_applyBody` sibling.
- `src/tools/inputs/delete-input.js` — `handleDeleteInput` via `defineMutatingHandler`. Best-effort pre-flight GET on extractors; `cascades: { extractors }` returned to handler.js's preview emitter.

### Modified (source)
- `src/tools/_shared/handler.js` — Two additive amendments owned by this plan:
  1. One-line spread `...(req.cascades ? { cascades: req.cascades } : {})` in the dry-run preview JSON, placed between `existingMatches` and `applyHint`. Opt-in only.
  2. `_connectionName` + `_conn` threaded through `build({ ...args, _connectionName, _conn })` so handlers reach the already-resolved connection without re-resolving (matches the equivalent pattern in `defineListHandler.fetch()`).
  Both are typedef-documented.
- `src/tools/inputs/schemas.js` — Added `NettyBaseConfig`, `TlsConfigExt`, 8 strict variant configs (`GelfUdpConfig`, `GelfTcpConfig`, `GelfHttpConfig`, `Beats2Config`, `SyslogUdpConfig`, `SyslogTcpConfig`, `RawUdpConfig`, `RawTcpConfig`), `variantMap`, `CreateInputSchema` (with `superRefine` dispatch), `UpdateInputSchema` (with non-empty refine), `DeleteInputSchema`.
- `src/tools/inputs/index.js` — 3 new `register(...)` calls (`create_input`, `update_input`, `delete_input`).
- `src/tools.js` — 3 new tool definitions with descriptions reflecting D-04 redaction, D-03 strict no-echo contract, D-05 cascade enumeration, and the `__SERVER_ASSIGNED__` warning.

### Modified (test)
- `test/inputs.test.js` — 18 new tests (Plan 02 wave). Imports `_setConnectionsForTests` for the writable=false test. Shared `REDACTION_PLACEHOLDER` constant + `multiCapture(routes)` helper for per-test multi-route mocking.

## Decisions Made

### BLOCKER #2 fix narrative — strict no-echo

The prior plan iteration of 01-02 specified that `update_input.build()` should iterate `current.configuration` and copy each non-encrypted entry into the wire body. That approach has two problems:

1. **D-03 / ROADMAP success criterion 2 violation.** A no-op `update_input` (e.g. `changes: { title: "renamed" }`) would emit the entire `current.configuration` on the wire, not "only the changed field". The agent's promise is that the preview body shows exactly what changed.
2. **Masked-value leak.** `current.configuration[tls_key_password]` arrives from Graylog's GET response as the literal string `<value hidden>` (server-side `maskPasswordsInConfiguration`). Copying that into the wire body would round-trip the masked placeholder back to Graylog, which would re-encrypt it as the literal string — silently wiping the real credential.

The strict no-echo rebuild eliminates both. The wire `configuration` is built ONLY from `args.changes.configuration`. The agentConfig sentinel distinguishes:

| `args.changes.configuration` | Wire body |
|---|---|
| `undefined` (agent did not touch config) | `configuration` key omitted entirely |
| `{}` (agent passed empty) | `configuration: {}` |
| `{port: 12202}` (agent passed specific) | `configuration: {port: 12202}` |

Graylog's `EncryptedInputConfigs.merge` preserves unspecified fields server-side, so no data is lost. Tests 27, 28, 29 pin all three shapes.

### BLOCKER #1 fix narrative — handler.js cascades forwarding

The handler.js dry-run preview emitter had no awareness of `req.cascades` after Plan 01-01. `delete_input.build()` returns `cascades: { extractors }` but the emitter would silently drop it without this amendment. The one-line spread (`...(req.cascades ? { cascades: req.cascades } : {})`) is opt-in: tools that don't set the field see no behavior change. The typedef updated to reflect the new optional field.

The amendment was declared in this plan's `files_modified` per BLOCKER #1 in the plan body — it is the load-bearing wire that makes D-05 cascade enumeration visible end-to-end.

### WARNING #9 fix narrative — GELF HTTP in variantMap

GELF HTTP (`org.graylog2.inputs.gelf.http.GELFHttpInput`) was missing from the prior plan iteration's variantMap. Without an entry, GELF HTTP would have fallen through to the top-level `z.record(z.unknown())` and lost the port-required validation. `GelfHttpConfig` extends `NettyBaseConfig` (bind_address + port + recv_buffer_size + worker_threads) with `TlsConfigExt` (the same TLS extension GELF TCP uses) and the HTTP-codec fields:
- `idle_writer_timeout` — Netty idle-handler timeout
- `max_chunk_size` — HTTP request chunk size
- `enable_cors` — CORS header emission
- `additional_headers` — extra HTTP response headers
- `decompress_size_limit` — GELF-codec decompress cap

Test 21 verifies the strict schema accepts a valid GELF HTTP payload; Test 22 verifies port-required rejection. D-01's GELF-family commitment now honored end-to-end with all three transport variants strict.

### Redaction placeholder choice

`REDACTION_PLACEHOLDER = "<redacted>"` chosen over `"••••"` for two reasons:
1. ASCII-safe — no Unicode normalization concerns in snapshot fixtures or grep tooling.
2. Self-documenting — `<redacted>` is immediately readable in JSON output, whereas `••••` could be confused for a real placeholder value.

Single constant in `redact.js` consumed by every redaction call site. Tests reference the same constant by literal so a future change to the placeholder would be detected as a multi-file edit.

### `_connectionName` + `_conn` pass-through into build args

The original plan said create_input / update_input / delete_input would call `resolveConnection(seamArgs)` a second time inside `build()`. That worked in test isolation but added duplicate work for every production call AND was sensitive to `_testConnection` propagation (zod's `strip` mode removes the seam from `args` after `schema.parse`, so build had to read it from `args._testConnection` which is normally absent).

Cleaner: thread `_connectionName` + `_conn` through build args under leading-underscore framework-internal keys. This matches the equivalent pattern already in `defineListHandler.fetch()` from Plan 01-01. handler.js calls `build({ ...args, _connectionName: connectionName, _conn: conn })`. The build callbacks read `args._connectionName` and `args._conn` directly — no duplicate resolveConnection, no test-seam plumbing.

This is an additive change to handler.js — existing callers (whose builds don't read those keys) see no behavior change. It's the minimal one-line internalization that eliminates the duplicate-resolution boilerplate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] handler.js threads _connectionName + _conn into build args**
- **Found during:** Task 2 GREEN — first test run after writing the three handlers
- **Issue:** The plan specified that build() callbacks would call `resolveConnection(seamArgs)` themselves (with `seamArgs` rebuilt from `args._testConnection`). But `args` inside build() is the zod-validated args, and `_testConnection` is intentionally absent from `mutatingBase` (zod's `strip` mode drops it). With no `_testConnection` and no `connectionName` reaching build(), `resolveConnection` falls back to the singleton path, which is null in test isolation — every test failed with `Cannot read properties of undefined (reading 'writable')`.
- **Fix:** Two-part:
  1. handler.js calls `build({ ...args, _connectionName: connectionName, _conn: conn })` — threads the already-resolved connection through build args under leading-underscore framework-internal keys. Matches the equivalent pattern in `defineListHandler.fetch()` from Plan 01-01.
  2. create_input.js / update-input.js / delete-input.js read `args._connectionName` and `args._conn` directly inside build(). No `resolveConnection` import needed (removed).
- **Files modified:** src/tools/_shared/handler.js, src/tools/inputs/create-input.js, src/tools/inputs/update-input.js, src/tools/inputs/delete-input.js
- **Verification:** All 24 tests in inputs.test.js pass. The 9 handler.test.js tests continue passing — back-compat for existing mutating handlers preserved (they just ignore the extra keys).
- **Committed in:** `1e7520b` (Task 2 GREEN commit)

This is in the spirit of Plan 01-01's `_connectionName` / `_conn` pass-through into `defineListHandler.fetch()` — the plan's `<interfaces>` block explicitly anticipated build callbacks would need the resolved connection. Plan 01-01 added the pattern for list handlers; this plan generalizes it to mutating handlers. Additive, back-compat-preserving, minimal blast radius.

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The fix is structural — it replaces the plan's `resolveConnection-inside-build` pattern with handler.js's `_connectionName/_conn` pass-through. Net result is identical (build reaches the resolved connection) but with less boilerplate per handler and consistent with the existing list-handler pattern. Strictly an improvement; no scope creep.

## Issues Encountered

None beyond the one deviation above. TDD RED → GREEN cycle clean: 18 tests RED at `d1ba1f1` (initially via `ERR_MODULE_NOT_FOUND` because the handler files didn't exist yet), GREEN at `1e7520b` (all 18 tests pass + 177 baseline preserved).

## User Setup Required

None — no external service configuration required. All changes are internal to the MCP server.

## Hand-Off to Plan 03 / 04 / 05

**Plan 03 (start_input + stop_input) inherits:**
- `_connectionName` + `_conn` pass-through in build args — `start_input.build()` and `stop_input.build()` reach the resolved connection without re-resolving.
- handler.js cascades-forwarding amendment (irrelevant for start/stop but available).

**Plan 04 (extractors CRUD) inherits:**
- `_applyBody` sibling pattern from create_input / update_input — `create_extractor.build()` and `update_extractor.build()` can use the same preview-vs-apply asymmetry for any future encrypted extractor config fields.
- Strict-no-echo wire-build pattern for `update_extractor` (D-09 says it reuses the `update_input` pattern).
- `findExistingMatches` per-input scoped variant — `create_extractor.build()` calls `findExistingMatches(client, { listPath: '/api/system/inputs/{inputId}/extractors', matchFn: ... })`.

**Plan 05 (snapshot fixtures + schema-parity + 01-VALIDATION.md flip) inherits:**
- The C3 + D-03 acceptance gate as a snapshot target. The plan's `<output>` flags this as the byte-identical snapshot that Plan 05 must ship — fixture inputs that prove the no-op `update_input` against a TLS input emits `configuration: {}` (or absent) and no encrypted field name appears anywhere in the body.
- The D-04 redaction acceptance gate as a snapshot target — `create_input` with `tls_key_password: "secret"` must show `tls_key_password: "<redacted>"` in the dry-run; the literal `"secret"` must not appear in the snapshot file (auth-redaction lint will also enforce this for 32+ char alphanumeric, but the shorter `"secret"` literal is covered by an explicit content scan).
- The D-05 cascade enumeration acceptance gate as a snapshot target — `delete_input` against a fixture input with 2 extractors must show `cascades.extractors: [{id, title, extractor_type}, ...]` in the dry-run.
- `assertSchemaParityForTool(toolName, zodSchema)` enrichment of `test/schema-parity.test.js` — Plan 05 must add the calls for `create_input` / `update_input` / `delete_input` (the schemas now exist in `src/tools/inputs/schemas.js`).

## Self-Check: PASSED

**Files exist:**
- `src/tools/inputs/redact.js` ✓
- `src/tools/inputs/create-input.js` ✓
- `src/tools/inputs/update-input.js` ✓
- `src/tools/inputs/delete-input.js` ✓

**Commits exist:**
- `d1ba1f1` ✓ (Task 1 RED)
- `1e7520b` ✓ (Task 2 GREEN)

**Done-criteria greps:**
- `ls src/tools/inputs/{redact,create-input,update-input,delete-input}.js` → 4 files ✓
- `grep -c "REDACTION_PLACEHOLDER" src/tools/inputs/redact.js` = 3 ✓
- `grep -c "set_value" src/tools/inputs/redact.js` = 7 ✓
- `grep -cE "GelfHttpConfig|GELFHttpInput" src/tools/inputs/schemas.js` = 2 ✓
- `grep -c "for (const \[key, value\] of Object.entries(current.configuration" src/tools/inputs/update-input.js` = 0 ✓ (BLOCKER #2: no copy-from-current loop)
- `grep -c "args.changes.configuration" src/tools/inputs/update-input.js` = 2 ✓
- `grep -c "req.cascades" src/tools/_shared/handler.js` = 1 ✓ (BLOCKER #1: cascades forwarding)
- `grep -cE 'register\("create_input"|register\("update_input"|register\("delete_input"' src/tools/inputs/index.js` = 3 ✓
- `grep -cE 'name: "create_input"|name: "update_input"|name: "delete_input"' src/tools.js` = 3 ✓

**Test results:**
- Focused run (`node --test test/inputs.test.js`): 24/24 pass, exit 0 ✓
- Full run (`npm test`): 195/195 pass, exit 0 ✓ (177 baseline + 18 net-new)

**Module-init verification:**
- `node -e "import('./src/tools/_register.js').then(() => assertAllToolsRegistered(toolDefinitions))"` → "OK" ✓

**C3 + D-03 ad hoc verification (per plan's `<verification>` section 3):**
- `update_input` no-op against a TLS GELF TCP input with `changes: { configuration: { port: 12202 } }` → `{"port":12202,"has_tls_key_password":false,"has_bind_address":false,"config_key_count":1}` ✓ (exact match with plan's expected output)

---

*Phase: 01-inputs-extractors*
*Plan: 02*
*Completed: 2026-05-15*
