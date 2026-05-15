# Phase 1: Inputs & Extractors - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 delivers the first domain of mutating admin tools: full lifecycle control of Graylog **inputs** and their **extractors**. An agent can discover input types, create/list/get/update/delete inputs, start and stop them, and create/list/update/delete extractors per input — all through `defineMutatingHandler` so dry-run, the writable-flag gate, and idempotency keys apply uniformly.

In scope: INPUT-01 through INPUT-11 (11 requirements) — the 12 tools `list_input_types`, `list_inputs`, `get_input`, `create_input`, `update_input`, `delete_input`, `start_input`, `stop_input`, `list_extractors`, `create_extractor`, `update_extractor`, `delete_extractor`.

Out of scope: streams, pipelines, index sets, dashboards, event definitions/notifications, blueprints — all later phases. No changes to the v2.3 read-tool surface beyond what Phase 0 already shipped.

</domain>

<decisions>
## Implementation Decisions

### Input type schemas (INPUT-04)

- **D-01:** Ship hand-written strict zod schemas for the 4 common input types — **GELF, Beats, Syslog, Raw/Plaintext**. All other Graylog input types accept a **generic validated key-value config object** so less-common inputs (AWS, CEF, etc.) remain reachable this phase without per-type schemas. Best agent ergonomics on the common path; full breadth still available.
- The planner decides per-type whether GELF/Syslog transport variants (UDP/TCP/HTTP) are separate schemas or a transport discriminant within one schema.

### Encrypted-field protection (INPUT-05, pitfall C3)

- **D-02:** `update_input` determines which fields are encrypted by reading the `is_encrypted` attribute flag from the **live type catalogue** (`GET /system/inputs/types/all`). Always accurate to the connected Graylog version — no static drift. (Catalogue is cached per D-06, so this is not an extra request per update in practice.)
- **D-03:** `update_input` is partial-update only: `{ inputId, changes: { ...fields... } }`. The wrapper fetches current config, merges only the non-encrypted changed fields, and emits a payload containing **only the changed fields** (locked by ROADMAP success criterion 2). Encrypted fields are **never echoed** into the emitted payload unless the agent explicitly passed a new non-placeholder value for them.

### create_input and secrets (INPUT-04)

- **D-04:** `create_input` **accepts encrypted fields at creation time** (e.g. TLS cert password, AWS credentials) so a secured input is creatable in one call. The dry-run preview shows encrypted values **redacted** (placeholder such as `••••`) — the real value never appears in MCP output.

### delete_input behavior (INPUT-06)

- **D-05:** `delete_input` deletes the input and lets Graylog remove its extractors automatically (no separate cascade flag). The dry-run preview **enumerates the affected extractors** (names + types) so the operator sees the blast radius before applying — satisfies ROADMAP success criterion 4.

### Type catalogue caching (INPUT-01)

- **D-06:** The input type catalogue (`GET /system/inputs/types/all`) is **cached per connection for the server process lifetime**. Input types effectively never change at runtime, so one fetch per connection serves `list_input_types`, `create_input` validation, and `update_input` `is_encrypted` detection without redundant round-trips. Cache invalidation on process restart only.

### Extractor schemas (INPUT-09)

- **D-07:** Hand-write strict zod schemas for **all 6 named extractor types** — grok, regex, JSON, key-value, split-and-index, lookup-table. The requirement enumerates a closed, stable set, so full typing is achievable with no generic escape hatch (unlike inputs).

### Input lifecycle (INPUT-07)

- **D-08:** `create_input` leaves the new input **stopped**; the agent calls `start_input` explicitly to begin ingestion. `start_input` and `stop_input` go through `defineMutatingHandler` like every other mutation, so `dryRun` + the writable-flag gate apply uniformly — no special-cased "runtime-only" mutation path.

### Extractor mutations (INPUT-10, INPUT-11)

- **D-09:** `update_extractor` reuses the same partial-update pattern as `update_input` (`{ extractorId, changes: {...} }`). `delete_extractor` is explicit and single-target — **no cascade** (locked by INPUT-11).

### Server-assigned IDs (pitfall C6)

- **D-10:** `create_input` and `create_extractor` dry-run previews use the Phase 0 `__SERVER_ASSIGNED__` sentinel for the not-yet-known ID. The apply path returns the real Graylog-assigned ID. Tool descriptions must warn the agent not to reuse a dry-run placeholder ID in a follow-up call.

### Claude's Discretion

- **Discretion-01:** Module layout under `src/tools/inputs/` (or `src/tools/input/`) and whether extractors get their own sub-module — follow the Phase 0 per-domain `schemas.js` precedent.
- **Discretion-02:** Whether GELF/Syslog UDP/TCP/HTTP transport variants are distinct zod schemas or one schema with a transport discriminant (D-01).
- **Discretion-03:** Exact redaction placeholder string for encrypted fields in previews (D-04) — `••••`, `<redacted>`, or similar.
- **Discretion-04:** Where the per-connection catalogue cache lives (module-level Map keyed by connection name vs. attached to the connection object) and its test seam (D-06).
- **Discretion-05:** How `delete_input`'s extractor enumeration is fetched for the dry-run (one extra `GET /system/inputs/{id}/extractors` call at preview time) and the exact shape of the warning block.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level

- `.planning/PROJECT.md` — milestone scope, locked decisions, out-of-scope list
- `.planning/REQUIREMENTS.md` — INPUT-01 through INPUT-11 plus the traceability table
- `.planning/ROADMAP.md` §"Phase 1: Inputs & Extractors" — phase goal, 4 success criteria, dependency on Phase 0
- `.planning/STATE.md` — current state and phase pointer

### Phase 0 outputs (the foundation this phase builds on)

- `.planning/phases/00-foundation/00-CONTEXT.md` — Phase 0 decisions D-01..D-08; especially D-07 (writable flag) and the `defineMutatingHandler` discretion notes
- `.planning/phases/00-foundation/00-04-SUMMARY.md` — `defineMutatingHandler` / `defineListHandler` factory contract, `_shared/` primitives, `mutatingBase` / `listBase` zod schemas
- `.planning/phases/00-foundation/00-03-SUMMARY.md` — `src/graylog/client.js` HTTP client, typed errors, `is_encrypted`-relevant response normalizer
- `.planning/phases/00-foundation/00-05-SUMMARY.md` — dispatch Map + `_register.js` registration pattern every new tool must follow
- `.planning/phases/00-foundation/00-06-SUMMARY.md` — snapshot fixture pattern + `schema-parity.test.js` enrichment template (every new mutating tool MUST add `assertSchemaParityForTool` coverage)

### Research outputs

- `.planning/research/PITFALLS.md` §C3 (encrypted input config zeroing — drives D-02/D-03/D-04), §C6 (server-assigned IDs — drives D-10), and the Inputs/Extractors row of the phase-mitigation table
- `.planning/research/ARCHITECTURE.md` — module layout (`src/services/<domain>.js`), `defineMutatingHandler` design
- `.planning/research/FEATURES.md` §"Cross-domain dependency graph" — where inputs sit relative to streams/pipelines
- `.planning/research/SUMMARY.md` — phase order rationale

### Live Graylog API touchpoints (verify against 7.0.6 — see PROJECT.md)

- `GET /system/inputs/types/all` — dynamic type catalogue (INPUT-01); source of `is_encrypted` attribute flags (D-02)
- `GET/POST/PUT/DELETE /system/inputs` and `/system/inputs/{id}` — input CRUD
- `PUT /system/inputstates/{id}` (or equivalent) — input start/stop lifecycle (INPUT-07)
- `GET/POST/PUT/DELETE /system/inputs/{id}/extractors` — extractor CRUD (INPUT-08..11)
- `source-code/graylog2-server/` `InputsResource.java` — encrypted-config merge reference (`EncryptedInputConfigs.merge`); 7.2.0-SNAPSHOT, treat as forward-compat reference, verify shapes against 7.0.6

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`defineMutatingHandler` / `defineListHandler`** (`src/tools/_shared/handler.js`, `list.js`) — every Phase 1 tool is one of these two factory calls; they already enforce dryRun default, zod validation, connection resolution, writable gate, idempotency keys, `__SERVER_ASSIGNED__` sentinels.
- **`src/graylog/client.js`** — the single HTTP client (`makeClient`); all input/extractor API calls route through it. Typed errors (`GraylogError` + status-code classifier) already exist.
- **`src/tools/_shared/schemas.js`** — `mutatingBase` / `listBase` zod bases; each input/extractor schema is `<DomainSchema>.extend(mutatingBase)`.
- **`src/tools/_register.js`** — the side-effect registration barrel; new input/extractor handlers register here (or via a per-domain barrel the central one imports).
- **`src/graylog/normalize.js`** (`toIdBody`) — response-shape normalizer for create/apply responses.

### Established Patterns

- **Per-domain `schemas.js`** (Phase 0 Discretion-05, confirmed) — input schemas in `src/tools/inputs/schemas.js`, extractor schemas alongside.
- **`schema-parity.test.js` enrichment is mandatory** — every new mutating tool adds `assertSchemaParityForTool(toolName, zodSchema)` per the commented template in `test/schema-parity.test.js`.
- **Snapshot fixtures** — `test/__snapshots__/`; dry-run previews of `update_input` (no-op changes against an encrypted-field fixture) must snapshot-assert encrypted fields are absent (pitfall C3, mitigation step 3).
- **Tool descriptions are agent documentation** — the `update_input` description must call out which input types carry encrypted fields (TCP/TLS, AWS, syslog-over-TLS).

### Integration Points

- New tools register through `src/tools/_register.js` → dispatch Map; `assertAllToolsRegistered` fails server start if a tool in `src/tools.js` lacks a handler.
- The per-connection type-catalogue cache (D-06) is new on-disk-free state — module-level, with an underscore-prefixed test seam following the `_clearForTests` precedent.

</code_context>

<specifics>
## Specific Ideas

- The C3 mitigation snapshot test is a hard acceptance gate: dry-run `update_input` with a no-op `changes: {}` against a fixture input carrying encrypted fields → assert those fields are **absent** from the emitted payload.
- Encrypted values in `create_input` previews are redacted, not omitted — the operator should see the field is set without seeing the secret.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. Streams, pipelines, index sets, dashboards, event definitions, and blueprints are all explicitly later phases per ROADMAP.md.

</deferred>

---

*Phase: 01-inputs-extractors*
*Context gathered: 2026-05-15*
