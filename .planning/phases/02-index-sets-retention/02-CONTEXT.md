# Phase 2: Index Sets & Retention - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 delivers the index-set domain: 8 tools that let an agent configure where Graylog stores messages and how it rotates/retains them, plus the `await_system_job` polling primitive that every later async operation reuses. The phase's safety thesis is preventing C1 (`delete_indices=true` is Graylog's server-side default — a single careless DELETE wipes Elasticsearch indices and their messages) end-to-end through dry-run preview + inverted default + confirmation-token mechanic. Same composition model as Phase 1: every tool is one `defineMutatingHandler` or `defineListHandler` call.

In scope: INDEX-01 through INDEX-08 (8 requirements) — `list_index_sets`, `get_index_set`, `create_index_set`, `update_index_set`, `delete_index_set`, `set_default_index_set`, `cycle_deflector`, `await_system_job`. Plus the implementation details below.

Out of scope: streams (Phase 3), pipelines, dashboards, event definitions, blueprints. No new MCP framework primitives beyond `await_system_job`. No archive retention strategy back-end (Graylog Enterprise feature) unless the schema-only-with-clear-error pattern is cheap; archive support stays out by default and is captured in deferred ideas.

</domain>

<decisions>
## Implementation Decisions

### Confirmation token for delete_index_set (C1 mitigation)

- **D-01:** When `delete_index_set` is called with `deleteIndices: true`, the wrapper computes a deterministic confirmation hash from the dry-run state: `sha256({indexSetId, deleteIndices: true, indexNames: [...sorted], messageCount})`. Dry-run output includes the hash as `confirmationToken`. Apply (`dryRun: false`) requires the agent to echo it back as `confirm: "<hash>"` — if anything changed server-side (new indices, new messages) between dry-run and apply, the hash mismatches and apply refuses with a structured error. Stateless, no MCP-side memory, survives process restarts.
- **D-02:** The hash inputs are:
  - `indexSetId` — target id
  - `deleteIndices: true` — locked literal so a hash issued for `deleteIndices: false` can never be replayed as `true`
  - `indexNames` — sorted list of all Elasticsearch indices that would be cleaned, sourced from `GET /system/indexer/indices/{indexSetId}/list`
  - `messageCount` — total message count across those indices, sourced from `GET /system/indices/index_sets/{indexSetId}/stats` (per-ID sub-resource on 7.0.6; `?stats=true` exists only on the LIST endpoint — corrected 2026-05-15 after research)
- **D-03:** Calling `delete_index_set` with `deleteIndices: false` (the default — see D-04) does NOT require a confirmation token. The index-set metadata is removed; Elasticsearch indices stay. Confirmation gate fires only when destruction is requested.

### delete_index_set defaults (C1 inversion)

- **D-04:** `delete_index_set`'s `deleteIndices` parameter defaults to `false` in the MCP wrapper — inverting Graylog's server-side `@DefaultValue("true")`. The dry-run preview EXPLICITLY shows `deleteIndices: false` in the emitted payload (per D-03 strict-no-echo: only changed fields, but `deleteIndices` is always emitted because the wrapper-default is the safety-relevant choice). Tool description must warn: "Graylog's server defaults this to TRUE — this wrapper inverts it to FALSE. To actually clean Elasticsearch indices, pass `deleteIndices: true`."

### Stats endpoint failure handling

- **D-05:** If `GET /system/indices/index_sets/{id}/stats` fails during dry-run (Elasticsearch unreachable, 5xx, timeout), the dry-run returns `isError: true` with `reason: "stats_unreachable"` and a hint to check Elasticsearch health. No confirmation token is issued. Rationale: the agent cannot proceed to apply without knowing the destruction blast radius. A partial-cluster failure SHOULD block destructive tooling — operational robustness must not override safety here.

### await_system_job polling primitive (INDEX-08)

- **D-06:** `await_system_job` implements a blocking exponential backoff loop inside the handler. Default schedule: `500ms → 1s → 2s → 4s → 5s → 5s …` (capped at 5s per interval). Configurable timeout, default 60s. Returns the final job status when complete OR a timeout error if not finished. This is the canonical async-completion primitive that Phase 2+ async tools route through.
- **D-07:** `await_system_job` is `defineMutatingHandler`-shaped only nominally — it issues GETs against `/system/jobs/{id}`, no Graylog state change. But it still routes through `defineMutatingHandler` so `dryRun` + writable-flag-gate inheritance is uniform across the tool surface (a `dryRun: true` call previews the polling plan and returns immediately without polling).

### Rotation/retention strategy schemas (INDEX-03)

- **D-08:** Strategies are passed as **friendly aliases**, NOT FQCNs:
  - `rotation_strategy ∈ { "time-based" | "size-based" | "message-count" }`
  - `retention_strategy ∈ { "delete" | "close" }` (archive deferred — see Deferred Ideas)
  The wrapper maps aliases to Graylog FQCN before issuing the HTTP call. Closed set so zod uses `z.enum(...)`. Tool descriptions document the alias options.
- **D-09:** Each alias has a strictly typed `*_strategy_config` zod schema (e.g. `time-based` → `{ rotation_period: "P1D", max_rotation_period?: "P30D" }`; `size-based` → `{ max_size: number }`; `message-count` → `{ max_docs_per_index: number }`). 6 strict configs total (3 rotation + 2 retention + 1 future-proof slot). Pattern follows D-01 from Phase 1 (per-domain strict-typed schemas as a closed set).

### create_index_set defaults (INDEX-03)

- **D-10:** `create_index_set` requires BOTH `rotation_strategy` + `rotation_strategy_config` AND `retention_strategy` + `retention_strategy_config` as required schema fields. NO sensible defaults. Rationale: destruction policies must never be defaulted — the agent should make an informed choice every time. Tool description shows the alias options and links to retention policy semantics so the agent reasons before passing.

### update_index_set strategy replacement (INDEX-04)

- **D-11:** If `changes` includes `rotation_strategy`, the wrapper REQUIRES `rotation_strategy_config` in the same `changes` object — strategy class and config are atomic. Same rule for `retention_strategy` + `retention_strategy_config`. The wrapper rejects partial-strategy updates with a structured error before hitting Graylog. Top-level fields (title, description, default, regular) still use field-level partial-update per D-03 (Phase 1).
- **D-12:** When neither strategy is in `changes`, the wire body's strategy blocks are absent (D-03 strict no-echo from Phase 1). The agent can update a title without re-asserting the rotation strategy.

### set_default_index_set invariant (INDEX-06, pitfall m2)

- **D-13:** `set_default_index_set` pre-flights `GET /system/indices/index_sets/{id}` and reads the `regular: boolean` field. If `regular: false` (events-style index set), the dry-run returns a structured error with `reason: "non_regular_index_set"` and an explanatory message — the 409 surfaces in dry-run, before any apply. Mitigates pitfall m2.

### cycle_deflector behavior (INDEX-07)

- **D-14:** `cycle_deflector` applies the rotation immediately by hitting `POST /system/deflector/cycle` (subject to `dryRun`). The cycle itself is **synchronous in Graylog 7.0.6** (source-verified: `DeflectorResource.java` calls `indexSet.cycle()` directly and returns `void` — no `systemJobManager.submit`). The wrapper returns `{ rotated: true, message: "Cycled index set <id>; closed previous active index", side_effects: { observable_at: "/system/jobs", describes: "Graylog spawns an IndexRangesUpdateJob to rebuild the closed index's ranges; the rotation itself is complete on response." } }`. The agent can optionally call `await_system_job` on the range-rebuild side effect if it cares about the secondary work completing. (Updated 2026-05-15 after research surfaced the sync semantics — original draft assumed async like delete_index_set+deleteIndices=true. Range rebuild stays observable; the primary action does not.)

### Async response shape (m5 mitigation, cross-cutting)

- **D-15:** Every Phase 2 mutating tool that triggers a Graylog system job (today: `delete_index_set` with `deleteIndices: true`) returns a uniform async envelope: `{ async: true, job_id: "<id>", job_id_observable_at: "/system/jobs", message: "<one-line summary>" }`. The HTTP 204 from Graylog does NOT mean the work is done. Tool descriptions warn the agent and point at `await_system_job`. `cycle_deflector` does NOT use this envelope — see D-14 (it's synchronous; the range-rebuild side effect is documented under `side_effects.observable_at`).

### Defense-in-depth carried forward

- **D-16:** D-07 from Phase 0 (writable-flag short-circuit) applies uniformly to every Phase 2 mutating tool. `delete_index_set` cannot execute against a `writable: false` connection regardless of the `deleteIndices` value — the writable gate fires BEFORE the destruction-confirmation gate. Defense in depth.

### Server-assigned IDs (pitfall C6 carried forward)

- **D-17:** `create_index_set` dry-run uses the `__SERVER_ASSIGNED__` sentinel for the not-yet-known index-set ID. Established in Phase 0. Tool description warns against reusing the placeholder ID across a multi-step flow.

### Claude's Discretion

- **Discretion-01:** Exact module layout under `src/tools/index_sets/` (or `src/tools/index-sets/` — naming TBD by planner). The Phase 1 per-domain folder precedent is the template.
- **Discretion-02:** Whether the alias-to-FQCN map lives in `src/tools/index_sets/strategies.js` (preferred) or inline in `schemas.js`. Either is fine; the planner picks based on the resulting file sizes.
- **Discretion-03:** Whether the FQCN map is also exposed via a `list_rotation_strategies` / `list_retention_strategies` tool for agent discovery, or whether tool descriptions are the discovery surface. Recommendation: tool descriptions only (the alias set is closed and small; a discovery tool would be wallpaper).
- **Discretion-04:** Exact `await_system_job` API surface — single `jobId` argument vs accepting either `jobId` or the full async-envelope object from a previous tool's response. Recommendation: the latter (forgiving input), but plan-level decision.
- **Discretion-05:** Snapshot fixture set design — at minimum: create dry-run, update strategy-replace, delete with `deleteIndices: false` (token-free), delete with `deleteIndices: true` showing the confirmation token, cycle_deflector async envelope. Planner refines.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level

- `.planning/PROJECT.md` — milestone scope, locked decisions, out-of-scope list
- `.planning/REQUIREMENTS.md` — INDEX-01 through INDEX-08
- `.planning/ROADMAP.md` §"Phase 2: Index Sets & Retention" — goal + 4 success criteria + dependency on Phase 0
- `.planning/STATE.md`

### Prior phase outputs (the foundation this phase builds on)

- `.planning/phases/00-foundation/00-04-SUMMARY.md` — `defineMutatingHandler` / `defineListHandler` factory contract
- `.planning/phases/00-foundation/00-03-SUMMARY.md` — `src/graylog/client.js` HTTP client
- `.planning/phases/00-foundation/00-06-SUMMARY.md` — snapshot fixtures, schema-parity enrichment template
- `.planning/phases/01-inputs-extractors/01-CONTEXT.md` — Phase 1 decisions D-01..D-10 (precedent for strict-typed schemas, partial-update pattern, redaction approach for sensitive fields)
- `.planning/phases/01-inputs-extractors/01-02-SUMMARY.md` — C3 mitigation via D-03 strict no-echo + `agentConfig` sentinel (the partial-update pattern this phase reuses)
- `.planning/phases/01-inputs-extractors/01-05-SUMMARY.md` — auth-redaction regex narrowing pattern (`<...>` placeholder convention applies here too)

### Research outputs

- `.planning/research/PITFALLS.md` §C1 (delete_indices default-true — drives D-01..D-05), §m2 (set_default regular invariant — drives D-13), §m5 (async system jobs — drives D-06/D-14/D-15), §M2 (inconsistent create response shapes)
- `.planning/research/ARCHITECTURE.md` — module layout precedent
- `.planning/research/FEATURES.md`

### Live Graylog API touchpoints (verify against 7.0.6)

- `GET /system/indices/index_sets` — list (INDEX-01)
- `GET /system/indices/index_sets/{id}` — get full DTO; `?stats=true` for messageCount (INDEX-02, D-02, D-13)
- `POST /system/indices/index_sets` — create (INDEX-03); response shape per pitfall M2 is the full IndexSetResponse
- `PUT /system/indices/index_sets/{id}` — update (INDEX-04)
- `DELETE /system/indices/index_sets/{id}?delete_indices=...` — delete (INDEX-05); the `@DefaultValue("true")` query param is the C1 footgun
- `PUT /system/indices/index_sets/{id}/default` — set default (INDEX-06)
- `POST /system/deflector/cycle` — manual rotation (INDEX-07)
- `GET /system/indexer/indices/{indexSetId}/list` — list ES indices in an index set (D-02 hash input)
- `GET /system/jobs/{id}` — job polling (INDEX-08)
- `source-code/graylog2-server/.../IndexSetsResource.java` — server-side reference; verify the `@DefaultValue("true")` is still there in 7.0.6

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`defineMutatingHandler` / `defineListHandler`** (`src/tools/_shared/handler.js`, `list.js`) — every Phase 2 tool is one of these two factory calls; A4 async build is shipped; `req.cascades` forwarding is shipped.
- **`makeClient(connection).request(method, path, body, opts?)`** (`src/graylog/client.js`) — single HTTP entry point.
- **`findExistingMatches({listPath, matchFn})`** (`src/tools/_shared/conflict.js`) — A2 real implementation from Phase 1. `create_index_set` reuses it to surface `existingMatches` when an index set with the same title exists.
- **`getOrFetchTypeCatalogue(connection)` pattern** (`src/tools/inputs/type-catalogue.js`) — per-connection process-lifetime cache pattern. Phase 2 will likely add a parallel `src/tools/index_sets/strategies.js` if any catalogue lookup is needed (e.g. strategy class discovery), but most Phase 2 strategy mapping is static.
- **Partial-update pattern from Phase 1** (`src/tools/inputs/update-input.js`) — `agentConfig` sentinel + D-03 strict no-echo. `update_index_set` mirrors it exactly, modulo the strategy-replace-only rule (D-11).
- **`<verb>_<domain>_<noun>` naming convention** — `list_index_sets`, `get_index_set`, `create_index_set`, `update_index_set`, `delete_index_set`, `set_default_index_set`, `cycle_deflector`, `await_system_job`. All tool names already declared in REQUIREMENTS.md.

### Established Patterns

- **Per-domain folder layout** — `src/tools/index_sets/` mirrors `src/tools/inputs/`.
- **Per-domain `schemas.js`** — strategies + index-set schemas co-located.
- **`__SERVER_ASSIGNED__` sentinel** — for `create_index_set` dry-run preview (D-17).
- **D-03 strict no-echo** — update tools emit ONLY changed fields; ROADMAP success criterion 1 from Phase 1 carries forward.
- **Auth-redaction lint regex-level placeholder recognition** — angle-bracketed placeholders auto-recognized; the `<encrypted>` and `<redacted>` convention applies if Phase 2 needs to redact anything (currently it doesn't — index-set configs don't carry secrets, but the regex is in place).
- **Schema-parity enrichment** — every new Phase 2 tool MUST add `assertSchemaParityForTool(toolName, zodSchema)` in `test/schema-parity.test.js`.

### Integration Points

- New tools register through `src/tools/index_sets/index.js` → `src/tools/_register.js` → dispatch Map.
- `await_system_job` is a NEW reusable primitive — it lives in `src/tools/index_sets/` for Phase 2 ownership, but Phase 3+ will import it as a public surface. Planner decides whether it co-locates under `src/tools/_shared/system-job.js` (more correct long-term) or `src/tools/index_sets/await-system-job.js` (Phase 2 ownership, refactored later). Recommendation: co-locate in `_shared/` from the start since it's intended as cross-domain.

</code_context>

<specifics>
## Specific Ideas

- The C1 confirmation hash is the centerpiece of this phase's safety story. The plan must include a fixture proving: (a) dry-run with `deleteIndices: false` emits NO `confirmationToken`; (b) dry-run with `deleteIndices: true` against an empty index set emits a hash; (c) dry-run with `deleteIndices: true` against a non-empty index set emits a hash that incorporates the messageCount; (d) apply with mismatched `confirm` is rejected with a structured error.
- `await_system_job` is the canonical async-completion primitive — its behavior is a contract every later phase depends on. Snapshot-test the timeout path AND the success path with a fake job-poll seam.
- Block dry-run on `stats_unreachable`: this is a deliberate user-confirmed safety choice (D-05). Don't soften it to "warn and proceed" later.

</specifics>

<deferred>
## Deferred Ideas

- **Archive retention strategy** — Graylog Enterprise feature; the wrapper schema can accept `retention_strategy: "archive"` later if/when the back-end is wired. Phase 2 ships `delete | close` only and rejects `archive` with a structured "not yet supported in this milestone" error.
- **Strategy discovery tools** (`list_rotation_strategies`, `list_retention_strategies`) — not in scope; tool descriptions are the discovery surface. Add if agent friction is observed in field testing.
- **Per-index-set messageCount projection in `list_index_sets`** — would require N stats calls; expensive. `list_index_sets` stays narrow-projected; `get_index_set` returns full DTO if the agent wants stats.

</deferred>

---

*Phase: 02-index-sets-retention*
*Context gathered: 2026-05-15*
