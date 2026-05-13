# Phase 0: Foundation - Context

**Gathered:** 2026-05-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 0 delivers the cross-cutting infrastructure that every subsequent domain phase will depend on: the dispatch Map, the single Graylog HTTP client, the `defineMutatingHandler` factory with dry-run primitive, the zod adoption pattern, the snapshot test harness, and the response-shape normalizer. By the end of Phase 0 the existing v2.3 read tools route through the new dispatch and HTTP client with no behavior change, the snapshot test infrastructure is proven against 5–10 fixture tests, and the safety primitives (dryRun, connectionName, idempotency-key, list-projection, writable-flag) are implemented end-to-end so the first domain phase can ship its first mutating tool without inventing any of these primitives.

In scope: FOUND-01 through FOUND-13 (13 requirements) plus the 4 user-resolved decisions below.

Out of scope: any admin/mutating tool implementation — those are Phase 1+. No new v2.3-side read features.

</domain>

<decisions>
## Implementation Decisions

### Runtime

- **D-01:** Bump `engines.node` to `>= 22.3.0`. The `node:test` `t.snapshot()` API is stable on Node 22, so no `--experimental-test-snapshots` flag is needed anywhere. This is the recommended floor — Node 20 fallback was offered and rejected.
- **D-02:** Fix the broken `npm test` script as part of Phase 0 so `node:test` actually runs the full unified suite (existing + new).

### Tool naming (existing v2.3 surface)

- **D-03:** Apply the `<verb>_<domain>_<noun>` convention to **all** existing v2.3 tool names — hard rename, not aliases. Breaking change for any MCP client that hardcodes the old names. The planner enumerates the full rename map. Examples of likely renames:
  - `fetch_graylog_messages` → `search_messages_graylog` (or `list_messages_graylog`)
  - `get_log_histogram` → `get_histogram_messages` (or similar)
  - `save_search` → `create_saved_search`; `list_saved_searches` → `list_saved_searches` (already fits); `delete_saved_search` → `delete_saved_search` (fits)
  - `use_connection` → `set_active_connection`; `list_connections` → `list_connections` (fits)
  - `cluster_log_messages` → `cluster_messages_logs` (or keep — already fits the pattern reasonably)
  - The planner produces the authoritative list, including a deprecation/migration note in CHANGELOG.
- **D-04:** Bump the package's major version (3.0.0) on release of this milestone — the rename is breaking.

### Test migration

- **D-05:** Migrate all four existing test-*.js scripts to `node:test` in Phase 0:
  - `test-clustering.js` — most complex, uses `_setSearchOverride()` test seam
  - `test-features.js` — time-range + aggregation payload tests
  - `test-aggregation-fixes.js` — aggregation payload structural tests
  - `test-histogram-fixes.js` — histogram-specific payload shapes
  Result: `npm test` invokes one runner, runs everything. Two-runner footprint is rejected.
- **D-06:** Snapshot fixtures live under `test/__snapshots__/` (the `node:test` default location); checked into git; reviewed via diff on each PR.

### Connection safety model

- **D-07:** Add an optional `writable: boolean` field to each connection in `~/.graylog-mcp/config.json` (or override path):
  - Defaults to `true` when the field is absent (backward-compatible with all existing configs).
  - When `false`, `defineMutatingHandler` short-circuits **before** building the Graylog request and returns a structured `{ isError: true, content: [...], reason: "connection_read_only" }`.
  - The per-call `dryRun: true` default is the first safety layer; `writable: false` is the second, complementary, defence-in-depth layer.
- **D-08:** The active-connection global state stays as-is for now (process-global `let activeConnection`). The per-call `connectionName` argument (FOUND-09) plus the new `writable` flag are the explicit answers to the existing-codebase concern about singleton connection state.

### Claude's Discretion

These were not explicitly decided in discussion; the planner has flexibility:

- **Discretion-01:** Exact module layout for `src/dispatch.js` and how it integrates with the existing `src/index.js` dispatch chain (the requirement specifies a Map; mechanics are open).
- **Discretion-02:** Exact shape of the `defineMutatingHandler({build, apply})` factory contract (return signature, error wiring, idempotency-key generation seam). Should follow the existing `errorResponse(text)` helper precedent for error shapes.
- **Discretion-03:** Where `src/services/<domain>.js` modules live and whether Phase 0 includes any service stubs (research recommends "no service stubs in Phase 0" — defer to the planner).
- **Discretion-04:** Whether snapshot-test review uses a script-level allowlist for "auto-accept on first run" or strictly fails until a human accepts. Default to strict.
- **Discretion-05:** zod schema co-location: `src/tools/<domain>/schemas.js` vs inline per-tool. Research recommends per-domain `schemas.js`; planner confirms.
- **Discretion-06:** How the dispatch startup assertion ("every name in tools.js has a registered handler") logs / throws — assertion error vs structured startup-log entry.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level

- `.planning/PROJECT.md` — milestone scope, locked decisions, out-of-scope list
- `.planning/REQUIREMENTS.md` — FOUND-01 through FOUND-13 plus 71-row traceability table
- `.planning/ROADMAP.md` §"Phase 0: Foundation" — phase goal, success criteria, dependencies
- `.planning/STATE.md` — current state and phase pointer

### Research outputs (read in this order)

- `.planning/research/SUMMARY.md` — the synthesis; settles phase order and the cross-cutting Phase 0 list of 7 concerns
- `.planning/research/STACK.md` — Node version rationale, zod adoption, `node:test` adoption, `c8` for coverage
- `.planning/research/ARCHITECTURE.md` — 8-phase build order, module layout (`src/dispatch.js`, `src/graylog/client.js`, `src/services/<domain>.js`), `defineMutatingHandler` design, dispatch refactor scope
- `.planning/research/FEATURES.md` §"Cross-domain dependency graph" — informs which existing read tools the dispatch refactor must continue to route correctly
- `.planning/research/PITFALLS.md` §"Agent-loop pitfalls (M4-M7)" — informs idempotency-key mechanism (FOUND-10), list-projection helper (FOUND-12), conflict-check (FOUND-11), naming convention (FOUND-13)

### Existing-codebase context

- `.planning/codebase/STRUCTURE.md` — current layout, the 903-line `src/index.js`, the precedent for extracted handlers under `src/tools/`
- `.planning/codebase/CONVENTIONS.md` — error pattern (`{ isError: true, content: [{ type: "text", text }] }`), default-arg style (`??`), `handle*` / `build*` naming, ESM + node-built-in import style
- `.planning/codebase/ARCHITECTURE.md` (codebase map, not research) — current layering for `src/index.js` and `src/config.js` singleton-state context
- `.planning/codebase/CONCERNS.md` — the 903-line dispatcher, the unused-zod observation, the singleton-connection concern, broken `npm test`
- `.planning/codebase/TESTING.md` — current `node:assert/strict` test scripts to be migrated under D-05

### Live source touchpoints (read but do not modify in Phase 0)

- `src/index.js` — dispatcher to refactor (FOUND-01); existing read-tool handlers
- `src/tools.js` — tool catalogue; dispatch assertion source
- `src/config.js` — connection registry; D-07 adds `writable` field handling
- `src/query.js` (`searchGraylog`, headers, auth shape) — model for the new `src/graylog/client.js`
- `src/tools/cluster-errors.js`, `src/tools/template-mgmt.js` — extracted-handler precedent
- `src/clustering/index.js` — registry precedent for the pluggable-subsystem pattern
- All four `test-*.js` files at repo root — D-05 migration targets

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`errorResponse(text)` helper pattern** (`src/tools/cluster-errors.js:12`, `src/tools/template-mgmt.js:4`) — already used to return the canonical MCP error shape. The new `defineMutatingHandler` factory should reuse this exact shape so error contracts are consistent across read and admin tools.
- **`requireActiveConnection()`** (`src/index.js:160`) — the existing read-side connection-gate idiom; mirror it for mutating tools but include the `writable: false` short-circuit (D-07) before returning the conn.
- **`searchGraylog()` axios call** (`src/query.js:99`) — the canonical existing Graylog HTTP call. Auth (`{username: apiToken, password: 'token'}`), headers (`Accept`, `Content-Type`, `X-Requested-By`), error-logging shape. `src/graylog/client.js` (FOUND-02) generalises this.
- **`_clearForTests()`** (`src/clustering/index.js:27`) and the underscore-prefix test-hook pattern — model for any new registry's test seams.
- **Template-store atomic write pattern** (`src/clustering/template-store.js`) — tmp+rename + file-lock with stale break; reuse if Phase 0 introduces any new on-disk state (unlikely, but the pattern is well-tested).

### Established Patterns

- **ESM only**, no CJS, no default exports — every new module must follow.
- **Named exports**, snake_case for MCP tool names, camelCase for functions, `handle*` / `build*` prefixes.
- **Default args via `??`** at call sites, not via JSON-Schema defaults — schema defaults are documentation-only.
- **No JSDoc except for payload builders** (`src/aggregations.js`); short single-line `//` comments only where they explain a non-obvious constraint.
- **Test seams as deliberate `_underscore` exports** (e.g. `_clearForTests`, `_setSearchOverride`, `_testConnection`). New mutating-tool tests can introduce equivalent seams without apology — it's the project's standard.

### Integration Points

- **`src/index.js:38-130`** — the current `CallToolRequestSchema` dispatch chain. FOUND-01 replaces this with a Map lookup; the assertion (FOUND-13 + Discretion-06) fires at module init.
- **`src/tools.js`** — the central tool catalogue; new admin tools land here, hard renames of existing tools (D-03) happen here.
- **`src/config.js:5-18`** — the config-loader is where the `writable` field gets parsed and exposed via a `getConnectionWritable(name)` helper or equivalent.
- **`package.json` `engines.node`** (currently `>=18.0.0`) — bumped to `>=22.3.0` (D-01).
- **`package.json` scripts.test** — currently `node test-server.js` (broken). Phase 0 fixes it to the `node:test` invocation.

</code_context>

<specifics>
## Specific Ideas

- **Connection config schema** is currently inferred from `example-config.json`. The `writable` field is additive, optional, defaults to `true`. The planner updates `example-config.json` to show the field with a comment explaining when to use `false`.
- The breaking-change major-version bump (D-04 → v3.0.0) lands on the milestone-completion commit, not Phase 0 alone. Phase 0 may live on a `0.x` or feature-branch version internally.
- Snapshot test fixtures should follow the convention `test/__snapshots__/<filename>.test.js.snapshot` per `node:test` defaults. Initial 5–10 fixtures (FOUND-07) should exercise the dry-run primitive across realistic payload shapes — both success and validation-failure paths.

</specifics>

<deferred>
## Deferred Ideas

- **Connection-level role discovery / 403 surfacing UX** — the existing model is "Graylog returns 403; we surface it." Better UX (auto-detect token's effective role on `use_connection`, warn proactively) was not discussed and is not in scope. Note for a future hardening pass.
- **Auto-discovery / OpenAPI-style codegen of admin endpoints** — the research recommended hand-rolled per-endpoint shapes. If the upstream `api-specs/` ever fills out for v7.x, regenerating would be a viable refactor — not this milestone.
- **`activeConnection` singleton refactor to a context object** — concession captured in D-08: the per-call `connectionName` + the `writable` flag are this milestone's answer. A deeper refactor (request-scoped connection passed through every handler) is deferred and noted in `.planning/codebase/CONCERNS.md`.
- **Snapshot-test auto-acceptance script** (Discretion-04) — if review friction proves real, a follow-up could add a `npm test -- --update-snapshots` flow. Default is strict for Phase 0.
- **Existing-tool naming aliases** — explicitly rejected (D-03). Anyone arguing for alias support later should link this CONTEXT.md so the rationale is clear: the milestone is already breaking via v3.0.0; doubling the catalogue size for backward-compat is not worth it.

</deferred>

---

*Phase: 00-foundation*
*Context gathered: 2026-05-13*
