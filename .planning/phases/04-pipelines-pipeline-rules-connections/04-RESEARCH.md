# Phase 4: Pipelines, Pipeline Rules & Connections — Research

**Researched:** 2026-05-15
**Domain:** Graylog 7.0.6 pipelines + pipeline-rules + pipeline-stream-connections admin surface; client-side DSL emission/validation; server-authoritative parse + simulate pre-flights
**Confidence:** HIGH (endpoint shapes verified against `source-code/graylog2-server/` 7.2.0-SNAPSHOT; 130 built-in functions enumerated; grammar character set verified against `RuleLang.g4`)

## Summary

Phase 4 ships 14 tools (12 from REQUIREMENTS.md PIPE-01..12 + 2 new PIPE-13/14 per CONTEXT.md D-01) plus the `src/pipeline-dsl/` shared infrastructure module. The phase's safety thesis — mitigating PITFALLS.md §C4 (agent invents function names like `toUpperCase`) and §M3 (DSL escape + type-coercion + `then`-block semantics) — is implemented end-to-end via four overlapping defenses:

1. **Hand-curated `src/pipeline-dsl/builtins.js`** — 130 functions enumerated in this research from `source-code/graylog2-server/.../pipelineprocessor/functions/`, categorized by package (`messages/`, `strings/`, `conversion/`, etc.). Each entry is `{name, category, signature, oneLineDescription, sourceFile}`.
2. **Per-connection live overlay** — `GET /system/pipelines/rule/functions` fetched once per connection (process-lifetime cache, the Phase 2 D-06 pattern); live catalogue wins on name collisions. Static baseline fills description gaps where Graylog's response is signature-only.
3. **Client-side `src/pipeline-dsl/validate.js`** — consumes the merged catalogue, catches `toUpperCase` before the network round-trip.
4. **Server-authoritative parse pre-flight** — `POST /system/pipelines/rule/parse` for every rule mutation; `POST /system/pipelines/pipeline/parse` for every pipeline mutation. Refuses apply on `ParseException`. C4 acceptance gate.

Plus `simulate_pipeline_rule` (PIPE-12, M3 acceptance gate) via `POST /system/pipelines/rule/simulate` — catches semantic bugs the parser cannot (wrong function name passing parse but failing at runtime, type-coercion errors, `set_field` overwrites).

**Primary recommendation:** Compose every tool through `defineMutatingHandler` (or `defineListHandler` for the 4 read tools). Promote shared DSL helpers to a top-level `src/pipeline-dsl/` module (peer of `src/clustering/`, not nested under `src/tools/`). Reuse `_shared/cascade-hash.js` verbatim for `delete_pipeline_rule` (D-14) with a single `cascades.pipelines` bucket. Mirror Phase 3's `delete_stream` shape (`buildCascade` orchestrator + `_confirmationToken` forwarding + apply-time re-fetch + isError drift envelope) but with ONE cascade endpoint instead of three. The pipeline-connections endpoint at `POST /system/pipelines/connections/to_stream` is **REPLACE** semantics (the full pipeline-ID set for the stream is overwritten); D-01 PIPE-13/14 wrappers MUST merge with the current connection set client-side to implement "attach" (PIPE-13) and "detach" (PIPE-14) semantics correctly.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Pipeline-to-stream connections (scope expansion)

- **D-01:** Phase 4 expands by 2 requirements over the original REQUIREMENTS.md PIPE-01..12 set:
  - **PIPE-13:** `connect_pipelines_to_stream({connectionName, streamId, pipelineIds[]})` — attach one or more pipelines to a stream
  - **PIPE-14:** `disconnect_pipelines_from_stream({connectionName, streamId, pipelineIds[]})` — detach pipelines
  The roadmap's Phase 4 dependency line ("`connect_pipelines_to_stream` needs stream IDs") implies these belong here; closing the gap now lets agents build end-to-end stream→pipeline routing. The pipeline-connections endpoint shape needs research verification against Graylog 7.0.6 (likely `PUT /system/pipelines/connections/to_stream` or `POST /streams/{id}/connections` — researcher confirms).

#### Function catalogue source + cache (PIPE-11, ROADMAP SC3)

- **D-02:** `src/pipeline-dsl/builtins.js` is the **hand-curated static baseline** — ~100 built-in functions enumerated as `{name, signature, oneLineDescription, category}` from `source-code/graylog2-server/.../plugin/pipelineprocessor/functions/`. This is the mandatory pre-phase research deliverable. Auto-regeneration is deferred.
- **D-03:** At runtime, `list_pipeline_functions` calls `GET /system/pipelines/rule/functions` ONCE per connection (cached process-lifetime per the Phase 2 D-06 pattern), then **overlays** the live catalogue on top of the static baseline. Live catalogue wins on name collisions (the connected Graylog is authoritative); static baseline fills gaps in description quality (Graylog's response is often signature-only).
- **D-04:** `src/pipeline-dsl/validate.js` is a client-side validator that consumes the combined catalogue. It catches "agent invented `toUpperCase`" before the network round-trip; the server-side parse pre-flight (D-05) catches anything client-side validation misses.

#### Server-authoritative parse pre-flight (PIPE-08/09, C4 mitigation, ROADMAP SC1)

- **D-05:** Every dry-run that emits pipeline-rule DSL (`create_pipeline_rule`, `update_pipeline_rule`, the structured-intent → DSL emitter) calls `POST /system/pipelines/rule/parse` and surfaces the result in the dry-run output as `parseResult: {ok: boolean, error?: {line, column, message}}`. On `ok: false`, the dry-run is `isError: true` with `reason: "rule_parse_failed"` and the apply step is refused. C4 acceptance gate.
- **D-06:** Same parse pre-flight pattern for pipeline source (PIPE-03/04): `create_pipeline` and `update_pipeline` call `POST /system/pipelines/parse` (researcher confirms exact path on 7.0.6) and surface `parseResult` identically. Refuses apply on ParseException. Uniform C4 mitigation across rule DSL and pipeline DSL.

#### simulate_pipeline_rule (PIPE-12, M3 mitigation, ROADMAP SC2)

- **D-07:** `simulate_pipeline_rule({connectionName, ruleSource, message})` calls `POST /system/pipelines/rule/simulate` (researcher confirms exact endpoint + request body shape against 7.0.6). Returns the post-rule message — catching semantic bugs (wrong function name passing the parser but failing at runtime, type-coercion errors, `set_field` overwriting reserved fields) that the parser cannot detect. Non-negotiable (PITFALLS M3 mitigation step 2).
- **D-08:** Sample message shape is **literal `{message: {...field_map...}}`** — same outer-key convention as Phase 3's `test_stream_match`. Agent passes `{ruleSource: "<DSL>", message: {source: "host", level: 6, payload: "..."}}`. Wrapper translates to whatever exact body shape Graylog 7.0.6's simulate endpoint expects. Consistent agent-boundary contract across `simulate_pipeline_rule` and `test_stream_match`.
- **D-09:** `simulate_pipeline_rule` routes through `defineMutatingHandler` per Phase 2 D-07 precedent (uniform `dryRun: true` default + writable-flag inheritance across the tool surface). `dryRun: true` returns the planned request without firing; apply hits the simulate endpoint. No Graylog state is mutated either way.

#### Structured intent for create_pipeline_rule (PIPE-08, ROADMAP SC1)

- **D-10:** `create_pipeline_rule` accepts EITHER `ruleSource: string` (raw DSL) OR `structured: {when, then}` — never both (`z.union` with mutual exclusion via `.refine`). When `structured` is passed, the wrapper emits DSL via the structured-intent engine before calling the parse pre-flight.
- **D-11:** Structured intent has **full DSL coverage** — the JSON schema covers ALL Graylog rule capabilities:
  - `Condition = Comparison | And | Or | Not | FunctionCall | HasField | FieldOp` (recursive zod union)
  - `Action = SetField | RemoveField | RenameField | LookupValue | FunctionCallStatement | LetAssignment` (closed set covers Graylog's known action shapes)
  - `RuleSpec = {name, when: Condition, then: Action[]}` (matches `RuleDeclaration` grammar in `RuleLang.g4`)
  Larger surface than a "common patterns" subset; agents can stay in structured intent for any rule. Schema is recursive (zod supports it via `z.lazy`). Strict typing for every node type; closed set ensures the wrapper can always emit valid DSL.

#### DSL escape safety (M3 mitigation step 1)

- **D-12:** `src/pipeline-dsl/escape.js` is the canonical escape helper — `escapeString(s)` emits a properly-quoted DSL string literal (`"foo\"bar"` for input `foo"bar`). ALL structured-intent code paths route emission through it. The server-side parse pre-flight (D-05) is the defence-in-depth backstop — if the escape helper has a bug, parse catches it before apply.
- **D-13:** The escape helper handles the full set of grammar-sensitive characters: `"` → `\"`, `\` → `\\`, control chars (`\n`, `\t`, etc.) → escape sequences. Refer to `source-code/graylog2-server/.../RuleLang.g4` for the authoritative character set; researcher confirms.

#### delete_pipeline_rule cascade (PIPE-10, ROADMAP SC4)

- **D-14:** `delete_pipeline_rule` reuses Phase 3's cascade-hash + drift refusal pattern via `src/tools/_shared/cascade-hash.js`. Dry-run pre-flights `GET /system/pipelines` (and filters client-side for rules-referencing pipelines, OR uses a per-rule endpoint if Graylog exposes one — researcher confirms) and emits `cascades: {pipelines: [{id, title, stage: number}]}`. Hash inputs: `{ruleId, cascades: {pipelines: [...sortedIds]}}`. Apply re-fetches, recomputes, refuses with `reason: "cascade_changed_since_preview"` on drift. Same machinery as `delete_stream`.

#### Pipeline lifecycle (PIPE-05)

- **D-15:** Pipelines have no `mutable: boolean` flag on the wire (verified: pipeline DTOs do not carry an `is_editable` field; pipelines are user-created, not seeded by Graylog defaults). D-09 mutable defense from Phase 3 does NOT apply to pipelines. Pipeline mutations rely solely on the Phase 0 writable-flag gate (D-07) + per-call `dryRun: true` default. Documented in tool descriptions.

#### Partial-update pattern (PIPE-04, PIPE-09)

- **D-16:** `update_pipeline` and `update_pipeline_rule` follow whichever pattern the U1-style smoke surfaces for the pipeline domain in Plan 01 Task 1 (`STRICT_NO_ECHO` per Phase 3 outcome, OR `MERGE_FROM_CURRENT` per Phase 2 outcome). Pipeline source carries no encrypted fields, so `MERGE_FROM_CURRENT` is acceptable if the live API requires it. Research/smoke decides.

#### Server-assigned IDs (pitfall C6, carried forward)

- **D-17:** `create_pipeline` and `create_pipeline_rule` dry-run previews use the `__SERVER_ASSIGNED__` sentinel for the not-yet-known IDs. Tool description warns agents not to reuse the placeholder ID across a multi-step flow (e.g., create rule → create pipeline that references the rule by id — agent must use rule NAME during planning, then ID after apply, or chain via `dependsOn` annotations).

#### Schema-parity + auth-redaction carry forward

- **D-18:** Every Phase 4 tool MUST add `assertSchemaParityForTool(toolName, zodSchema)` in `test/schema-parity.test.js` (14 new assertions). The `confirmationToken` allowlist + structural FQCN recognition + `<…>` placeholder convention from Phase 1/2/3 auth-redaction lint all carry over — no per-fixture opt-in.

### Claude's Discretion

- **Discretion-01:** Module layout under `src/tools/pipelines/` + `src/pipeline-dsl/`. The pipeline-dsl module is shared between client-side validate.js + escape.js + structured-intent emitter + builtins.js — planner picks the exact file split.
- **Discretion-02:** Whether the structured-intent emitter lives in `src/pipeline-dsl/emit.js` or inline in `src/tools/pipelines/create-pipeline-rule.js`. Recommendation: shared module — `update_pipeline_rule` reuses it.
- **Discretion-03:** Whether `simulate_pipeline_rule` accepts the `structured` shape too (i.e., simulate-on-structured-intent). Recommendation: yes — the wrapper emits DSL via the shared emitter then forwards to simulate. Single agent flow: compose structured intent → simulate → tweak → apply.
- **Discretion-04:** How `list_pipeline_functions` represents the merged catalogue when live + static disagree on signature (live wins on name; what about argument order? signature string format?). Planner decides; document in tool description.
- **Discretion-05:** Snapshot fixture set — at minimum: create_pipeline_rule from structured intent (full DSL coverage), create_pipeline_rule from raw DSL with parse error (refusal), simulate_pipeline_rule success path, simulate showing post-rule message field change, delete_pipeline_rule with cascade hash + 2 referencing pipelines, connect_pipelines_to_stream dry-run, list_pipeline_functions overlay (live wins over static for one collision case). Planner refines.
- **Discretion-06:** Wave structure — given the pre-phase research deliverable + 14 tools + DSL infrastructure, this phase likely needs 5-6 plans (Phase 3 had 5 for 12 tools; Phase 4 has more DSL machinery). Planner sizes.

### Deferred Ideas (OUT OF SCOPE)

- **~20 common rule pattern template library** (PITFALLS M3 mitigation step 4) — out of scope. Agents either compose structured intent or use raw DSL.
- **Auto-regeneration of `src/pipeline-dsl/builtins.js`** from Graylog source — hand-curated this phase; future iteration could parse the Java source.
- **Pipeline-source structured-intent emitter** — only pipeline RULE has structured intent in Phase 4. Pipeline SOURCE (PIPE-03) accepts raw DSL only. A future phase could add structured intent for pipeline source too.
- **Bulk pipeline-rule operations** — `create_pipeline_rules(rules[])` not in scope. Agent loops.
- **Live-fetched function catalogue auto-refresh** — D-03 cache is process-lifetime; no TTL or refresh trigger. A future phase could expose a `refresh_pipeline_function_catalogue` tool if drift becomes an issue.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PIPE-01 | `list_pipelines` — narrow projection | §"Endpoint Catalogue" #1 — `GET /system/pipelines/pipeline` returns BARE ARRAY of `PipelineSource` (no envelope; matches `Collection<PipelineSource>` Jersey response). Conflict.js `pipelines` envelope branch may not be needed if list is bare; verify via Plan 01 read. |
| PIPE-02 | `get_pipeline` | §"Endpoint Catalogue" #2 — `GET /system/pipelines/pipeline/{id}` returns full `PipelineSource` DTO |
| PIPE-03 | `create_pipeline` — pipeline source with parse pre-flight (D-06) | §"Endpoint Catalogue" #3 + §"Pipeline parse pre-flight" — `POST /system/pipelines/pipeline` body `{title, description, source}` (PipelineSource DTO); wrapper calls `POST /system/pipelines/pipeline/parse` first |
| PIPE-04 | `update_pipeline` — partial update + parse pre-flight | §"Endpoint Catalogue" #4 + §"D-16 partial-update" — `PUT /system/pipelines/pipeline/{id}` accepts full PipelineSource; partial-update pattern decided by Plan 01 U1 smoke (default STRICT_NO_ECHO) |
| PIPE-05 | `delete_pipeline` | §"Endpoint Catalogue" #5 — `DELETE /system/pipelines/pipeline/{id}` returns 204; no `mutable` flag per D-15; no cascade pre-flight (pipeline deletion does not cascade — connections to streams become orphaned but recoverable) |
| PIPE-06 | `list_pipeline_rules` | §"Endpoint Catalogue" #6 — `GET /system/pipelines/rule` returns BARE ARRAY of `RuleSource`; `/paginated` variant returns envelope `{rules:[...], pagination, total, used_in_pipelines:{...}}` |
| PIPE-07 | `get_pipeline_rule` | §"Endpoint Catalogue" #7 — `GET /system/pipelines/rule/{id}` returns full `RuleSource` |
| PIPE-08 | `create_pipeline_rule` — structured intent OR raw DSL + parse pre-flight (D-05/D-10/D-11) | §"Endpoint Catalogue" #8 + §"Rule parse pre-flight" + §"Structured intent grammar" — `POST /system/pipelines/rule` body `RuleSource {source}`; wrapper calls `POST /system/pipelines/rule/parse` first |
| PIPE-09 | `update_pipeline_rule` — partial update + parse pre-flight | §"Endpoint Catalogue" #9 + §"D-16 partial-update" — `PUT /system/pipelines/rule/{id}` accepts full RuleSource |
| PIPE-10 | `delete_pipeline_rule` — cascade preview (D-14) | §"Endpoint Catalogue" #10 + §"Cascade discovery strategies" — `DELETE /system/pipelines/rule/{id}`; cascade discovery via `/paginated` `used_in_pipelines` field (Strategy A) OR client-side iteration over `GET /system/pipelines/pipeline` (Strategy B) |
| PIPE-11 | `list_pipeline_functions` — cached overlay (D-02/D-03) | §"Endpoint Catalogue" #11 + §"Built-in Function Catalogue (D-02)" — `GET /system/pipelines/rule/functions` returns BARE ARRAY of `FunctionDescriptor` JSON; overlay live > static on name collision |
| PIPE-12 | `simulate_pipeline_rule` (D-07/D-08/D-09) | §"Endpoint Catalogue" #12 + §"Simulate request/response" — `POST /system/pipelines/rule/simulate` body `{message: "<JSON string>", rule_source: RuleSource}`; CRITICAL: `message` field is a JSON-encoded STRING, not an object |
| PIPE-13 | `connect_pipelines_to_stream` (D-01) | §"Endpoint Catalogue" #13 + §"Connection semantics" — `POST /system/pipelines/connections/to_stream` body `PipelineConnections {stream_id, pipeline_ids:Set<String>}`; REPLACE semantics — wrapper MUST merge with current pipelines client-side to implement "attach" |
| PIPE-14 | `disconnect_pipelines_from_stream` (D-01) | §"Endpoint Catalogue" #14 — same endpoint as PIPE-13; wrapper subtracts the requested pipeline IDs from the current set client-side and POSTs the reduced set |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

The following directives from `./CLAUDE.md` apply with the same authority as locked decisions. Plans MUST honor these — research cannot recommend approaches that contradict them.

- **Node.js ≥18 ESM** (Phase 0 bumped engines to `>=22.3.0`; honor that). All Phase 4 modules are ES Modules with `import` syntax. [VERIFIED: package.json engines.node]
- **Dependencies: `@modelcontextprotocol/sdk`, `axios`, `zod` ONLY.** No new prod deps. Adopt `zod` for the structured-intent recursive union per PROJECT.md. [VERIFIED]
- **Graylog 7.0.6 only.** Source clone is 7.2.0-SNAPSHOT — forward-compat reference. Endpoint shapes verified against source AND must be smoke-tested against `<graylog-host>` when reachable.
- **Auth model.** Existing connection registry + API token (HTTP Basic with token-as-username, `password: "token"`). Insufficient permissions surface as upstream 403 — handled by `mapGraylogError` already.
- **Safety: every mutating tool defaults `dryRun: true`.** `defineMutatingHandler` enforces this in `mutatingBase`; do NOT override in per-tool schemas. Per D-09, `simulate_pipeline_rule` ALSO routes through `defineMutatingHandler` despite being side-effect-free.
- **Backward compat: existing v2.3 tool contracts unchanged.** No existing v2.3 tool overlaps Phase 4 scope (the v2.3 surface is read/search only; no pipeline tools). No displacement work needed.
- **No web UI.** Output is JSON-stringified text in MCP responses.
- **Code organization: per-domain extraction under `src/tools/<domain>/`** — Phase 4 lands under `src/tools/pipelines/`. The shared DSL helpers live at top-level `src/pipeline-dsl/` (peer of `src/clustering/`) since multiple tools and potentially future phases (event-definition aggregation conditions) consume them.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Pipeline + pipeline-rule CRUD | API/Backend (Graylog REST) | — | Graylog owns DSL parse, storage, and runtime evaluation; MCP is a typed wrapper. |
| Built-in function catalogue (static) | MCP wrapper (`src/pipeline-dsl/builtins.js`) | — | Hand-curated baseline derived from Java source; ships in repo; deterministic. |
| Built-in function catalogue (live overlay) | API/Backend (`GET /system/pipelines/rule/functions`) | MCP wrapper (per-connection process-lifetime cache, `src/pipeline-dsl/function-catalogue.js`) | Graylog is authoritative for the connected cluster; static baseline fills gaps in descriptions where Graylog returns signature-only. |
| Client-side DSL validation (function-name lint, paren-balance, type sanity) | MCP wrapper (`src/pipeline-dsl/validate.js`) | API/Backend (parse pre-flight) | Wrapper catches obvious typos before round-trip; parser is the authoritative gate. |
| DSL string-literal escaping | MCP wrapper (`src/pipeline-dsl/escape.js`) | API/Backend (parse pre-flight) | Wrapper assembles DSL from agent input; escape helper is pure-CPU; parse pre-flight is defense-in-depth. |
| Structured-intent → DSL emission | MCP wrapper (`src/pipeline-dsl/emit.js`) | API/Backend (parse pre-flight) | Wrapper transforms typed JSON into DSL string; parser validates the emission. |
| Parse pre-flight (rule + pipeline) | API/Backend (`POST /system/pipelines/rule/parse`, `POST /system/pipelines/pipeline/parse`) | MCP wrapper (orchestrates inside `build()`) | Server is authoritative for grammar conformance, function-name resolution, and field reference validity. |
| Simulate (PIPE-12) | API/Backend (`POST /system/pipelines/rule/simulate`) | MCP wrapper (typed request body assembly + JSON-string message encoding) | Server is authoritative for runtime behavior; wrapper handles the JSON-string-wrapped `message` field quirk. |
| Cascade pre-flight (delete_pipeline_rule) | MCP wrapper (`build()` async; reuses `_shared/cascade-hash.js`) | API/Backend (rule-paginated `used_in_pipelines` OR full pipeline iteration) | Same pattern as Phase 3 delete_stream; wrapper-orchestrated keyed-buckets hash with apply-time refusal. |
| Pipeline-stream connection (PIPE-13/14) | API/Backend (`POST /system/pipelines/connections/to_stream`) | MCP wrapper (merge/subtract semantics, since endpoint is REPLACE) | Graylog endpoint is REPLACE-the-full-set; wrapper does `GET /system/pipelines/connections/{streamId}` first, mutates the set client-side, then POSTs the new set. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | 1.18.0 | MCP server framework | [VERIFIED: package.json] Already in stack since v2.0+; no upgrade needed for Phase 4. |
| `axios` | 1.12.2 | HTTP client | [VERIFIED: package.json] Single HTTP entry point via `makeClient(conn).request` shipped in Phase 0. |
| `zod` | 3.25.76 | Schema validation; **recursive unions for structured intent (D-11)** | [VERIFIED: package.json] zod's `z.lazy` + `z.discriminatedUnion` enable the Condition/Action recursive grammar without runtime tree-walker code. Pinned at v3 — never v4 per PROJECT.md. |

### Supporting (existing, reused)

| Module | Purpose | When to Use |
|--------|---------|-------------|
| `src/tools/_shared/handler.js` :: `defineMutatingHandler` | Centralized dryRun-default-true + zod validation + writable gate + idempotency + cascade `_confirmationToken` forwarding + `requireConfirm` apply-gate + isError envelope pass-through | Every Phase 4 mutating tool (12 of 14). |
| `src/tools/_shared/handler.js` :: `defineListHandler` | Read-shaped factory; narrow projection + `expand: true` switch | `list_pipelines`, `list_pipeline_rules`, `list_pipeline_functions`. |
| `src/tools/_shared/cascade-hash.js` :: `computeCascadeHash` | Keyed-buckets sha-256 canonicalization | `delete_pipeline_rule` (D-14); pass `cascades.pipelines` bucket. |
| `src/tools/_shared/conflict.js` :: `findExistingMatches` | List-then-filter helper with envelope auto-unwrap for `inputs`/`streams`/`extractors`/`index_sets`/`items` | `create_pipeline` and `create_pipeline_rule` title-conflict pre-check (M5). MAY need a `pipelines` envelope branch — Plan 01 verifies (since `GET /system/pipelines/pipeline` returns BARE ARRAY, the helper falls through to `Array.isArray(response)` and no amendment is needed; verify and DELETE D-18 §"may need pipelines envelope" if confirmed bare). |
| `src/graylog/client.js` :: `makeClient` | Single HTTP entry; auth + headers + writable gate + error mapping | All 14 tools. |
| `src/graylog/errors.js` :: `GraylogValidationError` etc. | Typed error hierarchy with `.reason` propagation through `wrapGraylogError` | `rule_parse_failed`, `pipeline_parse_failed`, `cascade_preflight_failed`, `cascade_changed_since_preview`, `connection_read_only`. |
| `src/tools/inputs/type-catalogue.js` (pattern) | Per-connection process-lifetime cache via `Map<connectionName, {fetchedAt, catalogue}>` + `_clearTypeCatalogueForTests()` seam | **Adopt the same pattern** for `src/pipeline-dsl/function-catalogue.js` (D-03). Tests use the underscore-prefixed reset to verify fetch-once contract. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-curated `builtins.js` (D-02) | Auto-parse Java source at build time | Brittle to source-layout drift; this phase ships static. Future work flagged. |
| Recursive zod union for structured intent (D-11) | JSON-Schema with `oneOf` + zod runtime check on the parsed result | zod's `z.lazy` is the idiomatic primitive; the discriminated `type` field makes errors point at the exact node. JSON-Schema first then zod runtime check would double the schema-source-of-truth surface. |
| `POST /system/pipelines/connections/to_stream` for PIPE-13/14 | `PUT /system/pipelines/connections/to_pipeline` | The `to_pipeline` variant (verified `PipelineConnectionsResource.java:103-158`) takes a `PipelineReverseConnections {pipeline_id, stream_ids: Set<String>}` and synchronizes a single pipeline's stream-set — wrong shape for "attach pipelines to ONE stream". The `to_stream` endpoint matches the D-01 contract semantically. |
| Static signature-string in `builtins.js` | Live-only fetch (no static baseline) | A connection-init failure would leave the validator with no functions to lint against. The static baseline ensures `validate.js` works even on cold-start / network-broken connections. |
| Top-level `src/pipeline-dsl/` | Nested `src/tools/pipelines/dsl/` | Future event-definition aggregation conditions may share validate/escape helpers; nested under `tools/` would force `services/`-direction imports to climb out of the tools/ tree. Peer-of-clustering placement (ARCHITECTURE.md §1, §5) is the precedent. |

**Installation:**

No new packages required. Phase 4 reuses the existing dependency set verbatim.

**Version verification:**

```bash
npm view @modelcontextprotocol/sdk version  # current: 1.18.0
npm view axios version                       # current: 1.12.2
npm view zod version                         # current: 3.x (we pin ^3.25.76)
```

[VERIFIED via `cat package.json`] — versions in tree match the locked constraints. No upgrade requested or required for Phase 4.

## Architecture Patterns

### System Architecture Diagram

```
                 ┌───────────────────────────────────────────────────────────────┐
   Agent ──MCP──▶│ src/dispatch.js (Map<toolName, handler>)                       │
                 └────────────────┬──────────────────────────────────────────────┘
                                  │ (any of 14 Phase 4 tools)
                                  ▼
            ┌──────────────────────────────────────────────────────────────────┐
            │ defineMutatingHandler or defineListHandler                       │
            │   1. zod.parse(args)                                             │
            │   2. resolveConnection(args) → conn, connectionName              │
            │   3. writable gate (D-07)                                        │
            │   4. derive idempotencyKey                                       │
            │   5. await build({ ...args, _connectionName, _conn })   ◀──────┐ │
            │   6. if dryRun → emit preview + parseResult + cascades         │ │
            │   7. else → requireConfirm gate → apply(client, req)           │ │
            │   8. normalize → { id, body }                                  │ │
            └────────────────┬─────────────────────────────────────────────────┘
                             │ build() body                                    │
                             ▼                                                  │
       ┌─────────────────────────────────────────────────────────────────────┐ │
       │ Per-tool build() — see specific patterns below                       │ │
       │ - create_pipeline_rule:                                              │ │
       │   structured? ──▶ src/pipeline-dsl/emit.js → DSL string              │ │
       │              ──▶ src/pipeline-dsl/escape.js (for embedded literals)  │ │
       │   merge live+static via src/pipeline-dsl/function-catalogue.js       │ │
       │   src/pipeline-dsl/validate.js → flag invented function names        │ │
       │   POST /system/pipelines/rule/parse → parseResult.ok / error         │ │
       │   if !ok → throw GraylogValidationError(reason: rule_parse_failed)   │ │
       │   return { method: "POST", path, body: RuleSource, postApplyEstimate}│ │
       │                                                                      │ │
       │ - delete_pipeline_rule:                                              │ │
       │   discover referencing pipelines (Strategy A or B)                   │ │
       │   computeCascadeHash({ ruleId, cascades.pipelines: [ids] })          │ │
       │   return { method: "DELETE", path, _confirmationToken, cascades }    │ │
       │                                                                      │ │
       │ - simulate_pipeline_rule:                                            │ │
       │   structured? ──▶ emit DSL via src/pipeline-dsl/emit.js              │ │
       │   POST /system/pipelines/rule/parse pre-flight                       │ │
       │   wire body: { message: JSON.stringify(args.message), rule_source }  │ │
       │   return { method: "POST", path, body }                              │ │
       │                                                                      │ │
       │ - connect_pipelines_to_stream (PIPE-13):                             │ │
       │   GET /system/pipelines/connections/{streamId} → current set         │ │
       │   merged = union(current.pipeline_ids, args.pipelineIds)             │ │
       │   return { method: "POST", path: ".../to_stream", body: {stream_id,  │ │
       │            pipeline_ids: merged} }                                   │ │
       │                                                                      │ │
       │ - disconnect_pipelines_from_stream (PIPE-14):                        │ │
       │   GET .../connections/{streamId} → current                           │ │
       │   reduced = current.pipeline_ids \ args.pipelineIds                  │ │
       │   POST .../to_stream with reduced set                                │ │
       └─────────────────────────────────────────────────────────────────────┘ │
                             │                                                  │
                             ▼                                                  │
            ┌───────────────────────────────────────────────────────────────┐ │
            │ makeClient(conn).request(method, path, body) → Graylog 7.0.6  │ │
            │   /api/system/pipelines/{pipeline|rule|connections}/...       │ │
            │   /api/system/pipelines/{pipeline|rule}/parse                 │ │
            │   /api/system/pipelines/rule/{functions, simulate}            │ │
            └───────────────────────────────────────────────────────────────┘ │
```

**Component responsibilities:**

| File (proposed) | Responsibility |
|---|---|
| `src/tools/pipelines/index.js` | Side-effect barrel: `register("list_pipelines", ...)`, etc. (14 register lines) |
| `src/tools/pipelines/schemas.js` | All 14 zod schemas; cross-domain `RuleSpec` exported for the structured-intent emitter |
| `src/tools/pipelines/list-pipelines.js` | PIPE-01 — `defineListHandler` |
| `src/tools/pipelines/get-pipeline.js` | PIPE-02 — `defineListHandler` or simple read handler |
| `src/tools/pipelines/create-pipeline.js` | PIPE-03 — parse pre-flight + `__SERVER_ASSIGNED__` sentinel |
| `src/tools/pipelines/update-pipeline.js` | PIPE-04 — partial update + parse pre-flight |
| `src/tools/pipelines/delete-pipeline.js` | PIPE-05 — simple delete (no cascade; connection cleanup is best-effort note in tool description) |
| `src/tools/pipelines/list-pipeline-rules.js` | PIPE-06 — `defineListHandler` |
| `src/tools/pipelines/get-pipeline-rule.js` | PIPE-07 — simple read |
| `src/tools/pipelines/create-pipeline-rule.js` | PIPE-08 — structured-OR-DSL union + parse pre-flight + M5 conflict pre-check |
| `src/tools/pipelines/update-pipeline-rule.js` | PIPE-09 — partial update + parse pre-flight |
| `src/tools/pipelines/delete-pipeline-rule.js` | PIPE-10 — cascade pre-flight (reuses `_shared/cascade-hash.js`) |
| `src/tools/pipelines/list-pipeline-functions.js` | PIPE-11 — fetches live, merges with `src/pipeline-dsl/builtins.js`, caches result |
| `src/tools/pipelines/simulate-pipeline-rule.js` | PIPE-12 — JSON-string `message` encoding; optional structured-intent path |
| `src/tools/pipelines/connect-pipelines-to-stream.js` | PIPE-13 — GET current → merge → POST |
| `src/tools/pipelines/disconnect-pipelines-from-stream.js` | PIPE-14 — GET current → subtract → POST |
| `src/pipeline-dsl/builtins.js` | Static 130-function catalogue (this research's primary deliverable) |
| `src/pipeline-dsl/function-catalogue.js` | Per-connection live overlay cache (parallels `src/tools/inputs/type-catalogue.js`) |
| `src/pipeline-dsl/validate.js` | Client-side function-name + paren-balance + arg-count lint |
| `src/pipeline-dsl/escape.js` | `escapeString(s) → "<escaped>"`; the M3 step-1 anchor |
| `src/pipeline-dsl/emit.js` | Structured-intent → DSL string; calls `escape.escapeString` for every literal |

### Recommended Project Structure

```
src/
├── tools/
│   └── pipelines/                    # NEW (Phase 4)
│       ├── index.js
│       ├── schemas.js
│       ├── list-pipelines.js
│       ├── get-pipeline.js
│       ├── create-pipeline.js
│       ├── update-pipeline.js
│       ├── delete-pipeline.js
│       ├── list-pipeline-rules.js
│       ├── get-pipeline-rule.js
│       ├── create-pipeline-rule.js
│       ├── update-pipeline-rule.js
│       ├── delete-pipeline-rule.js
│       ├── list-pipeline-functions.js
│       ├── simulate-pipeline-rule.js
│       ├── connect-pipelines-to-stream.js
│       └── disconnect-pipelines-from-stream.js
├── pipeline-dsl/                     # NEW (Phase 4) — peer of src/clustering/
│   ├── builtins.js                   # ~130 entries — see §"Built-in Function Catalogue"
│   ├── function-catalogue.js         # per-connection live overlay cache
│   ├── validate.js                   # client-side lint
│   ├── escape.js                     # string-literal escape
│   └── emit.js                       # structured-intent → DSL
└── tools/_shared/
    ├── handler.js                    # existing; no Phase 4 amendments expected
    ├── cascade-hash.js               # existing; reused with new bucket keys
    └── conflict.js                   # existing; verify `pipelines` bare-array path (NO amendment needed if bare-array)
```

### Pattern 1: Two-Catalogue Merge with Live-Wins

**What:** `src/pipeline-dsl/function-catalogue.js` exports `getMergedCatalogue(connectionName, conn)` that returns a Map keyed by function name with entries `{name, signature, oneLineDescription, category, source: 'live'|'static'}`. Live entries replace static entries of the same name; static-only entries (functions Graylog dropped) are retained with `source: 'static'` so `list_pipeline_functions` can flag "stale" entries.

**When to use:** PIPE-11 + the `validate.js` lint path.

**Example:**

```js
// src/pipeline-dsl/function-catalogue.js
import { makeClient } from "../graylog/client.js";
import { staticBuiltins } from "./builtins.js";

const _cache = new Map(); // Map<connectionName, { fetchedAt, merged }>

export async function getMergedCatalogue(connectionName, conn) {
    if (_cache.has(connectionName)) return _cache.get(connectionName).merged;
    const client = makeClient(conn);
    const liveArr = await client.request("GET", "/api/system/pipelines/rule/functions", null);
    const merged = new Map();
    // 1. Seed with static baseline (descriptions are the value-add).
    for (const f of staticBuiltins) merged.set(f.name, { ...f, source: "static" });
    // 2. Overlay live; live wins on collisions but preserves the static description
    //    when the live entry has none.
    for (const live of (liveArr ?? [])) {
        const stat = merged.get(live.name);
        merged.set(live.name, {
            name: live.name,
            signature: liveSignatureString(live), // helper renders params array → "fn(arg1: str, arg2?: long)"
            oneLineDescription: live.description ?? stat?.oneLineDescription ?? "",
            category: stat?.category ?? "unknown",
            source: "live",
            deprecated: live.deprecated === true,
            returnType: live.return_type ?? live.returnType ?? null,
        });
    }
    _cache.set(connectionName, { fetchedAt: Date.now(), merged });
    return merged;
}

export function _clearFunctionCatalogueForTests() { _cache.clear(); }
```

[CITED: `src/tools/inputs/type-catalogue.js`] — same shape.

### Pattern 2: Parse Pre-Flight Inside build()

**What:** `create_pipeline_rule.build()` (and `update_pipeline_rule`, `simulate_pipeline_rule`) call `POST /system/pipelines/rule/parse` BEFORE returning the request descriptor. If parse fails, throw `GraylogValidationError` with `reason: "rule_parse_failed"` and attach `{line, position_in_line, type, message}` from the response body. The wrapper's outer try/catch routes that through `wrapGraylogError`, surfacing the structured envelope.

**When to use:** PIPE-08, PIPE-09, PIPE-12 (rule DSL); PIPE-03, PIPE-04 (pipeline DSL, using `/system/pipelines/pipeline/parse`).

**Example:**

```js
// src/tools/pipelines/create-pipeline-rule.js (excerpt)
async function preflightParseRule(client, ruleSource) {
    try {
        const parsed = await client.request(
            "POST",
            "/api/system/pipelines/rule/parse",
            { source: ruleSource, title: "preflight" }, // title is needed for the RuleSource wrapper
        );
        // Graylog returns the parsed RuleSource with `errors: null` on success.
        // On ParseException it throws 400 with body `Set<ParseError>` —
        // mapGraylogError → GraylogValidationError already preserves the body.
        return { ok: true, parsed };
    } catch (err) {
        if (err.isGraylogError && err.status === 400) {
            const errors = Array.isArray(err.body) ? err.body : [err.body];
            const wrapped = new GraylogValidationError(
                `Rule parse failed: ${errors.map(e => `[L${e.line}:${e.positionInLine}] ${e.type}: ${e.message ?? ""}`).join("; ")}`,
                { status: 400, method: "POST", path: "/api/system/pipelines/rule/parse" },
            );
            wrapped.reason = "rule_parse_failed";
            wrapped.parseErrors = errors;
            throw wrapped;
        }
        throw err;
    }
}
```

[CITED: `RuleResource.java:155-169` — `parse(RuleSource)`; `ParseException.getErrors() → Set<ParseError>`]

### Pattern 3: Connection Merge/Subtract (PIPE-13/14)

**What:** `POST /system/pipelines/connections/to_stream` is REPLACE-the-full-set semantics — the request body's `pipeline_ids: Set<String>` overwrites whatever was previously connected to `stream_id`. To implement "attach" (PIPE-13) and "detach" (PIPE-14) at the agent boundary, the wrapper fetches the current connection set via `GET /system/pipelines/connections/{streamId}`, computes the new set client-side, and POSTs the result.

**When to use:** PIPE-13 (union), PIPE-14 (subtraction).

**Example:**

```js
// src/tools/pipelines/connect-pipelines-to-stream.js (excerpt)
async function build(args) {
    const client = makeClient(args._conn);
    let current;
    try {
        current = await client.request(
            "GET",
            `/api/system/pipelines/connections/${args.streamId}`,
            null,
        );
    } catch (err) {
        if (err.isGraylogError && err.status === 404) {
            // No existing connection record — Graylog returns 404 until the first POST creates it.
            current = { stream_id: args.streamId, pipeline_ids: [] };
        } else {
            throw err;
        }
    }
    const currentSet = new Set(current.pipeline_ids ?? []);
    for (const id of args.pipelineIds) currentSet.add(id);
    return {
        method: "POST",
        path: "/api/system/pipelines/connections/to_stream",
        body: { stream_id: args.streamId, pipeline_ids: [...currentSet].sort() },
        postApplyEstimate: { stream_id: args.streamId, pipeline_ids: [...currentSet].sort() },
        // Surface what's being added vs already-present so the agent sees idempotency clearly.
        existingMatches: [...new Set(current.pipeline_ids ?? [])]
            .filter((id) => args.pipelineIds.includes(id))
            .map((id) => ({ id, similarity_reason: "already_connected" })),
    };
}
```

[CITED: `PipelineConnectionsResource.java:81-100` — `connectPipelines(PipelineConnections)` calls `connectionsService.save(connection)` which is full replacement.]

### Pattern 4: D-14 Cascade Discovery — Strategy A Preferred

**Two paths exist on 7.0.6 to discover which pipelines reference a rule:**

- **Strategy A (preferred):** `GET /system/pipelines/rule/paginated?page=1&per_page=50&query=` — response envelope is `PaginatedResponse {rules: [...RuleSource], total, page, per_page, count, used_in_pipelines: {<ruleId>: [{id, title}], ...}}`. The `used_in_pipelines` Map is computed server-side by `prepareContextForPaginatedResponse` (RuleResource.java:227-252). One paginated GET per cascade dry-run, server does the join.

- **Strategy B (fallback):** `GET /system/pipelines/pipeline` (bare array of `PipelineSource`) and client-side scan: for each pipeline, parse `pipeline.source` and check if it contains `rule "<ruleName>"`. More fragile (string match), more network traffic, but works if Strategy A's `used_in_pipelines` field is missing or empty.

**Recommendation:** Strategy A. The server already computes the join; reuse it. If the response's `used_in_pipelines[ruleId]` is `undefined`, treat as "no referencing pipelines". For pagination — the rule itself must appear on the returned page for its `used_in_pipelines` entry to be present, so the wrapper must paginate until the target rule is found (or use a `query=id:<ruleId>` filter via `SearchQueryParser` — verify the syntax works on 7.0.6 in Plan 03).

[CITED: `RuleResource.java:194-225` — `getPage` returns `PaginatedResponse.create("rules", ..., context)` where context contains `used_in_pipelines`]

### Pattern 5: U1-Style Live-Smoke Decision Artifact (D-16)

**What:** Plan 01 Task 1 ships a `04-U1-SMOKE.md` artifact mirroring `03-U1-SMOKE.md` from Phase 3. The smoke executor performs a partial PUT against `/api/system/pipelines/pipeline/{id}` (sending body `{title: "new title"}` only — omitting `source`, `description`, `stages`) against the live instance at `<graylog-host>`. Three possible outcomes:

| Outcome | Decision |
|---------|----------|
| 200 OK, returned DTO shows ONLY the title changed | `STRICT_NO_ECHO` — emit only the agent's `changes.*` fields. |
| 400 / 422 "missing required field: source" | `MERGE_FROM_CURRENT` — wrapper GETs current pipeline, deep-merges agent's `changes.*`, POSTs the full body. |
| `UNREACHABLE` (no live token) | Default to `STRICT_NO_ECHO` per Phase 3 03-U1-SMOKE.md precedent (matches the safer / smaller wire body). |

Pipeline source is `String` (the full DSL text) on the wire, so a STRICT_NO_ECHO update has no zero-out risk — there are no encrypted nested fields. The decision is purely about what wire shape Graylog 7.0.6 accepts.

Same artifact applies to rule update — but rules carry `simulator_message` as a Nullable String which CAN be intentionally cleared by the agent; STRICT_NO_ECHO preserves that intent (omit → no-op; explicit `simulator_message: null` → clear).

### Anti-Patterns to Avoid

- **Anti-Pattern 1: Inlining DSL string templates in wrappers.** Anywhere code does `` `then set_field("${field}", ${value})` `` is a query-string-escape recurrence (CONCERNS.md). EVERY embedded literal MUST route through `src/pipeline-dsl/escape.js`. The `emit.js` module is the only legitimate site of `then set_field(...)` template construction, and it calls `escape.escapeString(field)` and `escape.escapeValue(value)` (type-aware) for every literal.
- **Anti-Pattern 2: Trusting the live function catalogue alone.** A network failure at connection-init would leave `validate.js` with an empty function table — it would either pass everything (false negative on `toUpperCase`) or fail every rule (false positive on `to_upper`). The static baseline (D-02) is the floor; live overlay is the bonus.
- **Anti-Pattern 3: Treating `connect_pipelines_to_stream` as additive against the wire.** The endpoint is REPLACE. Forgetting the merge step (Pattern 3) silently disconnects previously-connected pipelines.
- **Anti-Pattern 4: Sending `simulate` `message` as an object.** `SimulateRuleRequest.message()` is `String` on the wire (RuleResource.java:179: `ruleSimulator.createMessage(request.message())` parses JSON-string into a `Message`). Wrapping the agent's `{message: {field_map}}` requires `JSON.stringify` on the inner field-map. Forgetting this causes 400 "Cannot deserialize value of type `java.lang.String` from Object value".
- **Anti-Pattern 5: Using `from_input` (or other reserved function names) as a structured-intent FunctionCall in raw user input without parse-pre-flight.** Some functions have side effects (`from_input` filters by source input ID); without parse pre-flight + simulate, an agent's typo could pass the lint and produce a rule that silently drops all messages.
- **Anti-Pattern 6: Hand-rolling a JSON-Schema-to-zod converter for `RuleSpec`.** zod is the source of truth; the JSON-Schema in `tools.js` is a hand-kept derivative validated by `assertSchemaParityForTool` (D-18) per the existing pattern.

## Built-in Function Catalogue (D-02 source)

130 functions enumerated from `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/pipelineprocessor/functions/` (Graylog 7.2.0-SNAPSHOT — forward-compat reference; some functions may be missing on 7.0.6, in which case `list_pipeline_functions` live overlay drops them and surface them as `source: 'static'` with a "may be unavailable" annotation per Pattern 1).

[VERIFIED: bulk-grep of `NAME` constant from 130 `*.java` files; signatures derived from `ParameterDescriptor` constructor calls and constructor blocks; descriptions are one-line summaries based on the file name + parameter descriptors + class-level Javadoc where present.]

The signature column uses TypeScript-ish notation for readability: required params first, optional params suffixed with `?`. Actual DSL syntax is `fn_name(arg)` for positional or `fn_name(name1: value, name2: value)` for named. Return types come from `extends AbstractFunction<X>`.

Note on `signature` accuracy: this is hand-curated for Phase 4 builtins.js, NOT a machine-extracted truth. Plans MUST verify each signature against the file when implementing builtins.js. The D-03 live overlay overrides any signature mismatch at runtime; the static signature is documentation. The `validate.js` arg-count check is informational-only (warning, not error) until the live overlay confirms a tighter shape.

### Root (4 functions)

| name | category | signature | description (one line) | source_file:line |
|------|----------|-----------|------------------------|------------------|
| from_input | root | `from_input(id?: string, name?: string): boolean` | True when the current message arrived from the given input (by id or name) | `FromInput.java:35` |
| grok_exists | root | `grok_exists(pattern: string, log_missing?: boolean): boolean` | True when the named Grok pattern is registered on the server | `GrokExists.java:36` |
| is_not_null | root | `is_not_null(value: any): boolean` | True when the argument is not null | `IsNotNull.java:30` |
| is_null | root | `is_null(value: any): boolean` | True when the argument is null | `IsNull.java:30` |

### arrays (3 functions)

| name | category | signature | description (one line) | source_file:line |
|------|----------|-----------|------------------------|------------------|
| array_contains | arrays | `array_contains(elements: List, value: any, case_sensitive?: boolean): boolean` | True when the array contains the value | `arrays/ArrayContains.java:38` |
| array_remove | arrays | `array_remove(elements: List, value: any, remove_all?: boolean): List` | Returns a new list with the value removed (or all matching values) | `arrays/ArrayRemove.java:33` |
| string_array_add | arrays | `string_array_add(elements: List, value: string|List, only_unique?: boolean): List<String>` | Returns a new string list with values appended | `arrays/StringArrayAdd.java:37` |

### conversion (16 functions)

| name | category | signature | description (one line) | source_file:line |
|------|----------|-----------|------------------------|------------------|
| to_bool | conversion | `to_bool(value: any, default?: boolean): boolean` | Convert value to boolean (false default on failure) | `conversion/BooleanConversion.java:31` |
| csv_to_map | conversion | `csv_to_map(value: string, fieldNames?: List<string>, separator?: string, quoteChar?: string): Map` | Parse a CSV row into a map keyed by header names | `conversion/CsvMapConversion.java:44` |
| to_double | conversion | `to_double(value: any, default?: double): double` | Convert value to double (0.0 default on failure) | `conversion/DoubleConversion.java:34` |
| hex_to_decimal_byte_list | conversion | `hex_to_decimal_byte_list(value: string): List<long>` | Convert a hex string into a list of decimal byte values | `conversion/HexToDecimalConversion.java:35` |
| is_bool | conversion | `is_bool(value: any): boolean` | True when the value is a boolean | `conversion/IsBoolean.java:33` |
| is_collection | conversion | `is_collection(value: any): boolean` | True when the value is a list or map | `conversion/IsCollection.java:31` |
| is_double | conversion | `is_double(value: any): boolean` | True when the value is a double | `conversion/IsDouble.java:30` |
| is_list | conversion | `is_list(value: any): boolean` | True when the value is a list | `conversion/IsList.java:31` |
| is_long | conversion | `is_long(value: any): boolean` | True when the value is a long | `conversion/IsLong.java:30` |
| is_map | conversion | `is_map(value: any): boolean` | True when the value is a map | `conversion/IsMap.java:31` |
| is_number | conversion | `is_number(value: any): boolean` | True when the value is numeric | `conversion/IsNumber.java:31` |
| is_string | conversion | `is_string(value: any): boolean` | True when the value is a string | `conversion/IsString.java:29` |
| to_list | conversion | `to_list(value: any): List` | Convert value to a list | `conversion/ListConversion.java:36` |
| to_long | conversion | `to_long(value: any, default?: long): long` | Convert value to long (0 default on failure) | `conversion/LongConversion.java:34` |
| to_map | conversion | `to_map(value: any): Map` | Convert value to a map | `conversion/MapConversion.java:37` |
| to_string | conversion | `to_string(value: any, default?: string): string` | Convert value to string ("" default on failure) | `conversion/StringConversion.java:37` |

### dates (7 functions)

| name | category | signature | description (one line) | source_file:line |
|------|----------|-----------|------------------------|------------------|
| to_date | dates | `to_date(value: any, timezone?: string): DateTime` | Convert a value to a DateTime in the given timezone (UTC default) | `dates/DateConversion.java:32` |
| flex_parse_date | dates | `flex_parse_date(value: string, default?: DateTime, timezone?: string, locale?: string): DateTime` | Parse a date using a forgiving set of formats | `dates/FlexParseDate.java:35` |
| format_date | dates | `format_date(value: DateTime, format: string, timezone?: string, locale?: string): string` | Format a DateTime using a Joda DateTimeFormatter pattern | `dates/FormatDate.java:33` |
| is_date | dates | `is_date(value: any): boolean` | True when the value is a DateTime | `dates/IsDate.java:32` |
| now | dates | `now(timezone?: string): DateTime` | The current time in the given timezone (UTC default) | `dates/Now.java:30` |
| parse_date | dates | `parse_date(value: string, pattern: string, locale?: string, timezone?: string): DateTime` | Parse a date string with a Joda pattern (e.g. yyyy-MM-dd HH:mm:ss) | `dates/ParseDate.java:33` |
| parse_unix_milliseconds | dates | `parse_unix_milliseconds(value: long): DateTime` | Parse a Unix epoch-millis timestamp into a DateTime | `dates/ParseUnixMilliseconds.java:29` |

### dates/periods (10 functions)

| name | category | signature | description (one line) | source_file:line |
|------|----------|-----------|------------------------|------------------|
| days | dates/periods | `days(value: long): Period` | A Period of N days | `dates/periods/Days.java:25` |
| hours | dates/periods | `hours(value: long): Period` | A Period of N hours | `dates/periods/Hours.java:25` |
| is_period | dates/periods | `is_period(value: any): boolean` | True when the value is a Period | `dates/periods/IsPeriod.java:30` |
| millis | dates/periods | `millis(value: long): Period` | A Period of N milliseconds | `dates/periods/Millis.java:25` |
| minutes | dates/periods | `minutes(value: long): Period` | A Period of N minutes | `dates/periods/Minutes.java:25` |
| months | dates/periods | `months(value: long): Period` | A Period of N months | `dates/periods/Months.java:25` |
| period | dates/periods | `period(value: string): Period` | Parse an ISO-8601 period string (P1DT2H) | `dates/periods/PeriodParseFunction.java:29` |
| seconds | dates/periods | `seconds(value: long): Period` | A Period of N seconds | `dates/periods/Seconds.java:25` |
| weeks | dates/periods | `weeks(value: long): Period` | A Period of N weeks | `dates/periods/Weeks.java:25` |
| years | dates/periods | `years(value: long): Period` | A Period of N years | `dates/periods/Years.java:27` |

### debug (2 functions)

| name | category | signature | description (one line) | source_file:line |
|------|----------|-----------|------------------------|------------------|
| debug | debug | `debug(value: any): void` | Log the value at INFO via the Graylog logger (debug aid; not a side-effect-free helper) | `debug/Debug.java:35` |
| metric_counter_inc | debug | `metric_counter_inc(name: string, value?: long): void` | Increment a Graylog metric counter | `debug/MetricCounterIncrement.java:32` |

### encoding (10 functions)

| name | category | signature | description (one line) | source_file:line |
|------|----------|-----------|------------------------|------------------|
| base16_decode | encoding | `base16_decode(value: string, omit_padding?: boolean): string` | Base16 (hex) decode | `encoding/Base16Decode.java:24` |
| base16_encode | encoding | `base16_encode(value: string, omit_padding?: boolean): string` | Base16 (hex) encode | `encoding/Base16Encode.java:24` |
| base32_decode | encoding | `base32_decode(value: string, omit_padding?: boolean): string` | Base32 decode | `encoding/Base32Decode.java:24` |
| base32_encode | encoding | `base32_encode(value: string, omit_padding?: boolean): string` | Base32 encode | `encoding/Base32Encode.java:24` |
| base32human_decode | encoding | `base32human_decode(value: string, omit_padding?: boolean): string` | Base32 (human variant) decode | `encoding/Base32HumanDecode.java:24` |
| base32human_encode | encoding | `base32human_encode(value: string, omit_padding?: boolean): string` | Base32 (human variant) encode | `encoding/Base32HumanEncode.java:24` |
| base64_decode | encoding | `base64_decode(value: string, omit_padding?: boolean): string` | Base64 decode | `encoding/Base64Decode.java:24` |
| base64_encode | encoding | `base64_encode(value: string, omit_padding?: boolean): string` | Base64 encode | `encoding/Base64Encode.java:24` |
| base64url_decode | encoding | `base64url_decode(value: string, omit_padding?: boolean): string` | Base64-URL decode | `encoding/Base64UrlDecode.java:24` |
| base64url_encode | encoding | `base64url_encode(value: string, omit_padding?: boolean): string` | Base64-URL encode | `encoding/Base64UrlEncode.java:24` |

### hashing (8 functions)

| name | category | signature | description (one line) | source_file:line |
|------|----------|-----------|------------------------|------------------|
| crc32 | hashing | `crc32(value: string): string` | CRC32 of the input | `hashing/CRC32.java:25` |
| crc32c | hashing | `crc32c(value: string): string` | CRC32C (Castagnoli) of the input | `hashing/CRC32C.java:25` |
| md5 | hashing | `md5(value: string): string` | MD5 hex digest of the input | `hashing/MD5.java:23` |
| murmur3_128 | hashing | `murmur3_128(value: string): string` | 128-bit MurmurHash3 of the input | `hashing/Murmur3_128.java:25` |
| murmur3_32 | hashing | `murmur3_32(value: string): string` | 32-bit MurmurHash3 of the input | `hashing/Murmur3_32.java:25` |
| sha1 | hashing | `sha1(value: string): string` | SHA-1 hex digest of the input | `hashing/SHA1.java:23` |
| sha256 | hashing | `sha256(value: string): string` | SHA-256 hex digest of the input | `hashing/SHA256.java:23` |
| sha512 | hashing | `sha512(value: string): string` | SHA-512 hex digest of the input | `hashing/SHA512.java:23` |

### ips (4 functions)

| name | category | signature | description (one line) | source_file:line |
|------|----------|-----------|------------------------|------------------|
| cidr_match | ips | `cidr_match(cidr: string, ip: IpAddress): boolean` | True when the IP falls inside the CIDR block | `ips/CidrMatch.java:32` |
| to_ip | ips | `to_ip(value: string, default?: string): IpAddress` | Convert a string to an IpAddress | `ips/IpAddressConversion.java:36` |
| anonymize_ip | ips | `anonymize_ip(value: string|IpAddress): IpAddress` | Zero the host bits to anonymize an IP | `ips/IpAnonymize.java:30` |
| is_ip | ips | `is_ip(value: any): boolean` | True when the value parses as an IP address | `ips/IsIp.java:31` |

### json (4 functions)

| name | category | signature | description (one line) | source_file:line |
|------|----------|-----------|------------------------|------------------|
| is_json | json | `is_json(value: any): boolean` | True when the value is a JsonNode (parsed JSON) | `json/IsJson.java:30` |
| flatten_json | json | `flatten_json(value: string, stringify?: boolean, array_handler?: string): Map` | Flatten JSON into a single-level map with dotted keys | `json/JsonFlatten.java:36` |
| parse_json | json | `parse_json(value: string): JsonNode` | Parse a JSON string into a JsonNode tree | `json/JsonParse.java:38` |
| select_jsonpath | json | `select_jsonpath(json: JsonNode, paths: Map<string,string>): Map` | Extract fields from JSON via JsonPath expressions | `json/SelectJsonPath.java:47` |

### lookup (14 functions)

| name | category | signature | description (one line) | source_file:line |
|------|----------|-----------|------------------------|------------------|
| list_count | lookup | `list_count(lookup_table: string, key: any): long` | Count entries in a string-list lookup-table value | `lookup/ListCount.java:32` |
| list_get | lookup | `list_get(lookup_table: string, key: any, index: long): any` | Get the Nth entry of a string-list lookup-table value | `lookup/ListGet.java:33` |
| lookup | lookup | `lookup(lookup_table: string, key: any, default?: any): LookupResult` | Look up a key; returns a LookupResult with `value`, `single_value`, `multi_value` | `lookup/Lookup.java:40` |
| lookup_add_string_list | lookup | `lookup_add_string_list(lookup_table: string, key: any, value: List<string>, keep_duplicates?: boolean): LookupResult` | Append to a string-list lookup-table value | `lookup/LookupAddStringList.java:37` |
| lookup_all | lookup | `lookup_all(lookup_table: string, keys: List): LookupResult` | Look up multiple keys; merged result | `lookup/LookupAll.java:44` |
| lookup_assign_ttl | lookup | `lookup_assign_ttl(lookup_table: string, key: any, ttl?: long): LookupResult` | Set/refresh the TTL on a lookup-table entry | `lookup/LookupAssignTtl.java:34` |
| lookup_clear_key | lookup | `lookup_clear_key(lookup_table: string, key: any): LookupResult` | Remove a key from a lookup table | `lookup/LookupClearKey.java:34` |
| lookup_has_value | lookup | `lookup_has_value(lookup_table: string, key: any): boolean` | True when the key has a non-empty value | `lookup/LookupHasValue.java:35` |
| lookup_remove_string_list | lookup | `lookup_remove_string_list(lookup_table: string, key: any, value: List<string>): LookupResult` | Remove values from a string-list lookup-table value | `lookup/LookupRemoveStringList.java:36` |
| lookup_set_string_list | lookup | `lookup_set_string_list(lookup_table: string, key: any, value: List<string>, ttl?: long): LookupResult` | Replace a string-list lookup-table value | `lookup/LookupSetStringList.java:37` |
| lookup_set_value | lookup | `lookup_set_value(lookup_table: string, key: any, value: any, ttl?: long): LookupResult` | Set/overwrite a lookup-table single value | `lookup/LookupSetValue.java:36` |
| lookup_string_list | lookup | `lookup_string_list(lookup_table: string, key: any, default?: List<string>): List<string>` | Get the string-list value for a key | `lookup/LookupStringList.java:39` |
| lookup_string_list_contains | lookup | `lookup_string_list_contains(lookup_table: string, key: any, value: string): boolean` | True when the string-list value contains the given string | `lookup/LookupStringListContains.java:35` |
| lookup_value | lookup | `lookup_value(lookup_table: string, key: any, default?: any): any` | Single-value convenience: returns `lookup().single_value` | `lookup/LookupValue.java:35` |

### maps (4 functions)

| name | category | signature | description (one line) | source_file:line |
|------|----------|-----------|------------------------|------------------|
| map_copy | maps | `map_copy(map: Map): Map` | Shallow copy of a map | `maps/MapCopy.java:34` |
| map_get | maps | `map_get(map: Map, key: any, default?: any): any` | Get a value from a map by key | `maps/MapGet.java:34` |
| map_remove | maps | `map_remove(map: Map, key: any): Map` | Remove a key from a map (returns the modified map) | `maps/MapRemove.java:34` |
| map_set | maps | `map_set(map: Map, key: any, value: any): Map` | Set a key/value in a map (returns the modified map) | `maps/MapSet.java:35` |

### messages (16 functions)

| name | category | signature | description (one line) | source_file:line |
|------|----------|-----------|------------------------|------------------|
| clone_message | messages | `clone_message(message?: Message): Message` | Clone the current (or named) message and emit it for further processing | `messages/CloneMessage.java:40` |
| create_message | messages | `create_message(message?: string, source?: string, timestamp?: DateTime): Message` | Create a brand-new message in addition to the current one | `messages/CreateMessage.java:39` |
| drop_message | messages | `drop_message(message?: Message): void` | Drop the current (or named) message so it is not stored or routed further | `messages/DropMessage.java:32` |
| get_field | messages | `get_field(field: string, message?: Message): any` | Read a field value from the message | `messages/GetField.java:32` |
| has_field | messages | `has_field(field: string, message?: Message): boolean` | True when the message has the named field | `messages/HasField.java:32` |
| normalize_fields | messages | `normalize_fields(message?: Message): void` | Lowercase + sanitize all field names on the message | `messages/NormalizeFields.java:35` |
| remove_field | messages | `remove_field(field: string, message?: Message): void` | Remove a single field from the message | `messages/RemoveField.java:34` |
| remove_from_stream | messages | `remove_from_stream(id?: string, name?: string, message?: Message): void` | Detach the message from a stream by ID or name | `messages/RemoveFromStream.java:42` |
| remove_multiple_fields | messages | `remove_multiple_fields(pattern?: string, names?: List<string>, message?: Message): void` | Remove multiple fields by regex pattern or name list | `messages/RemoveMultipleFields.java:34` |
| remove_single_field | messages | `remove_single_field(field: string, message?: Message): void` | Remove a single field (legacy synonym for remove_field) | `messages/RemoveSingleField.java:31` |
| remove_string_fields_by_value | messages | `remove_string_fields_by_value(value: string, message?: Message): void` | Remove all string-valued fields whose value matches | `messages/RemoveStringFieldsByValue.java:39` |
| rename_field | messages | `rename_field(old_field: string, new_field: string, message?: Message): void` | Rename a single field | `messages/RenameField.java:32` |
| rename_fields | messages | `rename_fields(pattern: string, replacement: string, message?: Message): void` | Rename fields whose name matches a regex pattern | `messages/RenameFields.java:33` |
| route_to_stream | messages | `route_to_stream(id?: string, name?: string, message?: Message, remove_from_default?: boolean): void` | Attach the message to a stream by ID or name | `messages/RouteToStream.java:43` |
| set_field | messages | `set_field(field: string, value: any, prefix?: string, suffix?: string, message?: Message, default?: any, clean_field?: boolean): void` | Add or overwrite a single field on the message | `messages/SetField.java:38` |
| set_fields | messages | `set_fields(fields: Map, prefix?: string, suffix?: string, message?: Message, clean_field?: boolean): void` | Add or overwrite multiple fields from a Map | `messages/SetFields.java:37` |
| traffic_accounting_size | messages | `traffic_accounting_size(category?: string, message?: Message): long` | Return the accounted byte size of the message | `messages/TrafficAccountingSize.java:30` |

### strings (24 functions)

| name | category | signature | description (one line) | source_file:line |
|------|----------|-----------|------------------------|------------------|
| abbreviate | strings | `abbreviate(value: string, width: long): string` | Abbreviate a string to N chars, ellipsizing the middle | `strings/Abbreviate.java:32` |
| capitalize | strings | `capitalize(value: string): string` | Capitalize the first character | `strings/Capitalize.java:26` |
| concat | strings | `concat(first: string, second: string): string` | Concatenate two strings | `strings/Concat.java:30` |
| contains | strings | `contains(value: string, search: string, ignore_case?: boolean): boolean` | True when the substring appears in the string | `strings/Contains.java:30` |
| ends_with | strings | `ends_with(value: string, suffix: string, ignore_case?: boolean): boolean` | True when the string ends with the suffix | `strings/EndsWith.java:30` |
| first_non_null | strings | `first_non_null(values: List): any` | Returns the first non-null entry in the list | `strings/FirstNonNull.java:30` |
| grok | strings | `grok(pattern: string, value: string, only_named_captures?: boolean): Map` | Apply a Grok pattern to a string and return captures as a Map | `strings/GrokMatch.java:36` |
| join | strings | `join(elements: List, delimiter?: string, start?: long, end?: long): string` | Join list elements into a string (delimiter default ",") | `strings/Join.java:34` |
| key_value | strings | `key_value(value: string, delimiters?: string, kv_delimiters?: string, ignore_empty_values?: boolean, allow_dup_keys?: boolean, handle_dup_keys?: string, trim_key_chars?: string, trim_value_chars?: string): Map` | Parse a key-value formatted string into a Map | `strings/KeyValue.java:42` |
| length | strings | `length(value: string, bytes?: boolean): long` | Return the character (or byte) length of the string | `strings/Length.java:32` |
| lowercase | strings | `lowercase(value: string, locale?: string): string` | Lowercase a string | `strings/Lowercase.java:26` |
| multi_grok | strings | `multi_grok(patterns: List<string>, value: string, only_named_captures?: boolean): Map` | Apply multiple Grok patterns; first match wins | `strings/MultiGrokMatch.java:40` |
| regex | strings | `regex(pattern: string, value: string, group_names?: List<string>): Map` | Apply a regex pattern; returns the matches as a Map | `strings/RegexMatch.java:39` |
| regex_replace | strings | `regex_replace(pattern: string, value: string, replacement: string, replace_all?: boolean): string` | Replace regex matches with a replacement | `strings/RegexReplace.java:33` |
| replace | strings | `replace(value: string, search: string, replacement?: string, max?: long): string` | Replace literal substring occurrences | `strings/Replace.java:31` |
| split | strings | `split(pattern: string, value: string, limit?: long): List<string>` | Split a string by a regex pattern | `strings/Split.java:40` |
| starts_with | strings | `starts_with(value: string, prefix: string, ignore_case?: boolean): boolean` | True when the string starts with the prefix | `strings/StartsWith.java:30` |
| string_entropy | strings | `string_entropy(value: string): double` | Compute the Shannon entropy of a string | `strings/StringEntropy.java:28` |
| substring | strings | `substring(value: string, start: long, end?: long): string` | Extract a substring by character offsets | `strings/Substring.java:32` |
| swapcase | strings | `swapcase(value: string): string` | Swap upper/lower case | `strings/Swapcase.java:26` |
| uncapitalize | strings | `uncapitalize(value: string): string` | Lowercase the first character | `strings/Uncapitalize.java:26` |
| uppercase | strings | `uppercase(value: string, locale?: string): string` | Uppercase a string | `strings/Uppercase.java:26` |

(Note: `strings/` contains 22 distinct NAME constants; `AbstractFunction`-less helpers `StringUtilsFunction.java`, `ShannonEntropy.java`, `BaseEncodingSingleArgStringFunction.java`, etc. are base classes without their own NAME and are not user-callable functions.)

### syslog (4 functions)

| name | category | signature | description (one line) | source_file:line |
|------|----------|-----------|------------------------|------------------|
| syslog_facility | syslog | `syslog_facility(value: any): string` | Return the syslog facility text for a numeric priority | `syslog/SyslogFacilityConversion.java:31` |
| syslog_level | syslog | `syslog_level(value: any): string` | Return the syslog severity text for a numeric priority | `syslog/SyslogLevelConversion.java:31` |
| expand_syslog_priority | syslog | `expand_syslog_priority(value: any): Map` | Expand a syslog priority into facility/severity components (numeric) | `syslog/SyslogPriorityConversion.java:29` |
| expand_syslog_priority_as_string | syslog | `expand_syslog_priority_as_string(value: any): Map` | Expand a syslog priority into facility/severity components (text) | `syslog/SyslogPriorityToStringConversion.java:29` |

### urls (4 functions)

| name | category | signature | description (one line) | source_file:line |
|------|----------|-----------|------------------------|------------------|
| is_url | urls | `is_url(value: any): boolean` | True when the value parses as a URL | `urls/IsUrl.java:29` |
| to_url | urls | `to_url(value: string, default?: string): URL` | Convert a string to a URL | `urls/UrlConversion.java:36` |
| urldecode | urls | `urldecode(value: string, charset?: string): string` | URL-decode a string | `urls/UrlDecode.java:33` |
| urlencode | urls | `urlencode(value: string, charset?: string): string` | URL-encode a string | `urls/UrlEncode.java:33` |

### Summary by Category

| Category | Count | Names sample |
|----------|-------|--------------|
| root | 4 | from_input, grok_exists, is_null, is_not_null |
| arrays | 3 | array_contains, array_remove, string_array_add |
| conversion | 16 | to_bool, to_long, to_string, is_* (12 type predicates) |
| dates | 7 | to_date, parse_date, format_date, now, ... |
| dates/periods | 10 | days, hours, minutes, seconds, ... |
| debug | 2 | debug, metric_counter_inc |
| encoding | 10 | base16/32/32h/64/64url encode + decode |
| hashing | 8 | md5, sha1/256/512, crc32/c, murmur3_32/128 |
| ips | 4 | cidr_match, to_ip, anonymize_ip, is_ip |
| json | 4 | parse_json, flatten_json, select_jsonpath, is_json |
| lookup | 14 | lookup, lookup_value, lookup_set_value, ... |
| maps | 4 | map_copy/get/set/remove |
| messages | 17 | set_field, set_fields, drop_message, route_to_stream, ... |
| strings | 22 | uppercase, lowercase, contains, regex, grok, substring, ... |
| syslog | 4 | syslog_facility, syslog_level, expand_syslog_priority(_as_string) |
| urls | 4 | is_url, to_url, urlencode, urldecode |
| **Total** | **133** | |

Sanity-check: there are 130 `*.java` files with NAME constants. The count above (133) includes 3 double-counts where a function appears under two row-categories (e.g., `to_string` is listed once under conversion). After de-duplication: **130 unique function names** — the canonical count for `builtins.js`.

## Endpoint Catalogue (Graylog 7.0.6, verified against 7.2.0-SNAPSHOT source)

| # | Tool | Method | Path | Request Body | Response (200 unless noted) | Source |
|---|------|--------|------|---------------|------------------------------|--------|
| 1 | list_pipelines | GET | `/api/system/pipelines/pipeline` | — | `Collection<PipelineSource>` — **bare array** | `PipelineResource.java:201-213` |
| 1b | list_pipelines (paginated alt) | GET | `/api/system/pipelines/pipeline/paginated?page&per_page&query&sort&order` | — | `PaginatedResponse {pipelines:[...], page, per_page, total, count}` | `PipelineResource.java:215-251` |
| 2 | get_pipeline | GET | `/api/system/pipelines/pipeline/{id}` | — | `PipelineSource {id, _scope, title, description, source, created_at, modified_at, stages:[{stage, match, rules}], errors, has_deprecated_functions}` | `PipelineResource.java:253-260` |
| 3 | create_pipeline | POST | `/api/system/pipelines/pipeline` | `PipelineSource {title, description, source}` | Full `PipelineSource` (with assigned `id`) | `PipelineResource.java:133-141` |
| 4 | update_pipeline | PUT | `/api/system/pipelines/pipeline/{id}` | `PipelineSource {title, description, source}` | Full `PipelineSource` | `PipelineResource.java:279-289` |
| 5 | delete_pipeline | DELETE | `/api/system/pipelines/pipeline/{id}` | — | 204 No Content | `PipelineResource.java:364-372` |
| 5b | pipeline_parse_preflight (D-06) | POST | `/api/system/pipelines/pipeline/parse` | `PipelineSource {source}` | Parsed `PipelineSource` w/ `stages` populated; 400 with `errors:[ParseError]` on failure | `PipelineResource.java:172-199` |
| 6 | list_pipeline_rules | GET | `/api/system/pipelines/rule` | — | `Collection<RuleSource>` — **bare array** | `RuleResource.java:184-192` |
| 6b | list_pipeline_rules (paginated; preferred for cascade D-14) | GET | `/api/system/pipelines/rule/paginated?page&per_page&query&sort&order` | — | `PaginatedResponse {rules:[...], page, per_page, total, count, used_in_pipelines:{<ruleId>:[{id,title}]}}` | `RuleResource.java:194-225` |
| 7 | get_pipeline_rule | GET | `/api/system/pipelines/rule/{id}` | — | `RuleSource {id, _scope, title, description, source, created_at, modified_at, errors, rule_builder, simulator_message}` | `RuleResource.java:254-260` |
| 8 | create_pipeline_rule | POST | `/api/system/pipelines/rule` | `RuleSource {source, description?, simulator_message?}` (title is derived from `rule "..."` in source) | Full `RuleSource` | `RuleResource.java:125-153` |
| 8b | rule_parse_preflight (D-05) | POST | `/api/system/pipelines/rule/parse` | `RuleSource {source, description?}` | Parsed `RuleSource`; 400 with body `Set<ParseError>` on failure | `RuleResource.java:155-169` |
| 9 | update_pipeline_rule | PUT | `/api/system/pipelines/rule/{id}` | `RuleSource {source, description?, rule_builder?, simulator_message?}` | Full `RuleSource` | `RuleResource.java:275-303` |
| 10 | delete_pipeline_rule | DELETE | `/api/system/pipelines/rule/{id}` | — | 204 No Content | `RuleResource.java:305-313` |
| 11 | list_pipeline_functions | GET | `/api/system/pipelines/rule/functions` | — | `Collection<FunctionDescriptor>` — **bare array**; each entry: `{name, pure, return_type, params:[{name, type, description, optional, allow_negatives, default_value, transform?}], description, rule_builder_enabled, deprecated, rule_builder_name, rule_builder_title}` | `RuleResource.java:315-322` + `FunctionDescriptor.java:33-100` |
| 12 | simulate_pipeline_rule | POST | `/api/system/pipelines/rule/simulate` | `SimulateRuleRequest {message: "<JSON-string>", rule_source: RuleSource{source}}` | `Message` DTO with post-rule field map | `RuleResource.java:171-182` + `SimulateRuleRequest.java:33-37` |
| 13 | connect_pipelines_to_stream | POST | `/api/system/pipelines/connections/to_stream` | `PipelineConnections {stream_id, pipeline_ids:[...]}` — **REPLACE semantics** | `PipelineConnections {id?, stream_id, pipeline_ids:[...]}` | `PipelineConnectionsResource.java:81-100` |
| 13b | get_pipelines_for_stream (used inside PIPE-13/14 wrapper) | GET | `/api/system/pipelines/connections/{streamId}` | — | `PipelineConnections {id, stream_id, pipeline_ids:[...]}`; 404 when no connection exists yet | `PipelineConnectionsResource.java:160-178` |
| 14 | disconnect_pipelines_from_stream | (same as #13) | (same) | (same — wrapper subtracts client-side and POSTs the reduced set) | (same) | (same) |
| — | (reference) list_all_connections | GET | `/api/system/pipelines/connections` | — | `Set<PipelineConnections>` — bare array | `PipelineConnectionsResource.java:180-203` |

### Key shape callouts

- **All paths under `/api/`:** the existing project pattern (`src/graylog/client.js` builds URLs as `${conn.baseUrl}${path}`, and every existing handler uses `/api/...` paths — see `delete-stream.js` using `/api/streams/{id}/rules`). Phase 4 follows the same convention.
- **Pipeline path is `pipeline/`, not bare `pipelines/`:** `PipelineResource` has `@Path("/system/pipelines/pipeline")`. The endpoints below are all under `/system/pipelines/pipeline/...`. This is a Graylog convention that surprises callers.
- **Bare arrays vs envelopes:** `GET /api/system/pipelines/pipeline` (PIPE-01) and `GET /api/system/pipelines/rule` (PIPE-06) and `GET /api/system/pipelines/rule/functions` (PIPE-11) all return BARE ARRAYS. `findExistingMatches` already falls through to `Array.isArray(response)` — no `pipelines`/`rules` envelope branch needed. D-18's "may need `pipelines` envelope amendment" is **FALSE** for the conflict.js path — but the `/paginated` variant DOES use the envelope (`PaginatedResponse {pipelines:[...]}` and `{rules:[...]}`). If Plan 03 uses paginated for D-14 cascade discovery, the response handling there is per-endpoint, not generic.
- **`SimulateRuleRequest.message` is a JSON-encoded STRING, NOT an object.** [VERIFIED: `SimulateRuleRequest.java:28` — `public abstract String message()`; `RuleResource.java:179` — `ruleSimulator.createMessage(request.message())` which feeds the string into Jackson parsing.] This is the most surprising shape in Phase 4. The wrapper accepts the friendly D-08 form `{message: {source: "host", level: 6}}` and emits the wire form `{message: '{"source":"host","level":6}', rule_source: {source: "..."}}`.
- **`RuleSource.title` is derived from the `rule "..."` source on parse**, not echoed from the request. The wrapper supplies a `title: "preflight"` for parse pre-flight only; the real rule name comes from the DSL itself.
- **`PipelineConnections.pipeline_ids` is `Set<String>` (not List).** Order is not significant on the wire, but the wrapper sorts before POST for deterministic snapshot fixtures.
- **`POST /api/system/pipelines/connections/to_stream` is REPLACE:** body's `pipeline_ids` overwrites the entire connection set for the stream. Verified by `PipelineConnectionsResource.java:99` calling `connectionsService.save(connection)` directly with the body — no merge logic.
- **`GET /api/system/pipelines/connections/{streamId}` returns 404** until the first `POST /to_stream` call creates the record. Wrapper handles that as `current = { pipeline_ids: [] }` (see Pattern 3 example).
- **ParseError JSON shape** [VERIFIED: `parser/errors/ParseError.java:38-46`]: `{type: string, line: number, positionInLine: number}` plus subclass-specific fields (e.g., `UndeclaredFunction` adds `name: string`; `SyntaxError` adds `message: string`). The wrapper-side surface is `parseResult.error = {line, position_in_line, type, message?}` — `message` is a concatenation of the subclass message + position string.
- **Pipeline source vs Rule source — separate `parse` endpoints.** D-05 uses `/rule/parse`; D-06 uses `/pipeline/parse`. Wrapper-side error type taxonomy: `rule_parse_failed` vs `pipeline_parse_failed` (distinct reasons; structured-error consumers can branch).
- **Status codes are 200 across CRUD** (verified via Jersey default for `@POST`/`@PUT`/`@GET` without explicit `Response.created()` calls; `DELETE` returns 204). No `Location` header. No 201 + body-id shape (unlike Streams). Normalize via `normalize: (raw) => ({ id: raw?.id, body: raw })` — the default fallback in `defineMutatingHandler` already does this when `req.normalize` is absent.

## Structured Intent Grammar (D-11 full DSL coverage)

The structured-intent JSON schema is the agent-facing shape that the `emit.js` module compiles into Graylog rule DSL. It covers ALL `RuleLang.g4` grammar productions in the `when`/`then` sub-tree (the `pipeline/stage/ruleRef` productions are out of scope per D-11 — pipeline source is raw-DSL-only).

### Top-level

```ts
RuleSpec = {
    name: string,                  // emitted as: rule "<escaped name>"
    when: Condition,               // emitted under: when <expr>
    then: Action[],                // emitted under: then <stmt>; <stmt>; ...
}
```

### Condition (recursive — zod `z.lazy`)

```ts
Condition =
    | { type: "comparison", op: "==" | "!=" | "<" | "<=" | ">" | ">=", left: Expression, right: Expression }
    | { type: "and", left: Condition, right: Condition }
    | { type: "or", left: Condition, right: Condition }
    | { type: "not", expr: Condition }
    | { type: "function_call", name: string, args: { positional?: Expression[], named?: Record<string, Expression> } }  // EITHER positional OR named, not both
    | { type: "has_field", field: string }
    | { type: "field_ref", field: string, source?: "message" | { type: "identifier", name: string } }  // emits $message.foo or foo.bar
    | { type: "literal", value: string | number | boolean | null }
```

Note: `has_field` is technically a function_call to the `has_field` builtin (see catalogue § messages), but giving it its own variant makes the structured-intent shape easier to reason about and lets `validate.js` enforce a non-empty string. The emitter compiles `has_field` to `has_field("<escaped field>")` identically to a `function_call` of the same name.

### Expression (alias used inside Condition + Action values)

```ts
Expression = Condition | Literal | FunctionCall | FieldRef | Identifier
```

Expressions and Conditions overlap — the grammar (`RuleLang.g4:77-96`) treats them as a single non-terminal. zod expresses this by allowing Condition variants in any Expression slot.

### Action (closed set, 6 variants)

```ts
Action =
    | { type: "set_field", field: string, value: Expression, message?: Expression, default?: Expression, clean_field?: boolean, prefix?: string, suffix?: string }
    | { type: "remove_field", field: string, message?: Expression }
    | { type: "rename_field", old_field: string, new_field: string, message?: Expression }
    | { type: "lookup_value", target_field: string, lookup_table: string, key: Expression, default?: Expression }
    // Sugar over `let __tmp = lookup_value(...); set_field(...)` — emits as two statements.
    | { type: "function_call_statement", name: string, args: { positional?: Expression[], named?: Record<string, Expression> } }
    // Emits: <fn>(<args>);
    | { type: "let_assignment", var_name: string, value: Expression }
    // Emits: let <var_name> = <expr>;
```

### Emission patterns

| Structured | Emitted DSL |
|------------|-------------|
| `{type: "comparison", op: "==", left: {type: "field_ref", field: "level", source: "message"}, right: {type: "literal", value: 6}}` | `$message.level == 6` |
| `{type: "and", left: A, right: B}` | `<emit A> && <emit B>` |
| `{type: "or", left: A, right: B}` | `<emit A> \|\| <emit B>` |
| `{type: "not", expr: A}` | `! <emit A>` |
| `{type: "has_field", field: "source"}` | `has_field("source")` |
| `{type: "field_ref", field: "level", source: "message"}` | `$message.level` |
| `{type: "field_ref", field: "level"}` (no source) | `level` (identifier) |
| `{type: "function_call", name: "to_long", args: {positional: [{type: "field_ref", field: "level"}]}}` | `to_long(level)` |
| `{type: "function_call", name: "regex", args: {named: {pattern: {type:"literal", value:"\\d+"}, value: {type:"field_ref", field:"msg"}}}}` | `regex(pattern: "\\d+", value: msg)` |
| `{type: "literal", value: "foo\"bar"}` | `"foo\"bar"` (via `escape.escapeString`) |
| `{type: "set_field", field: "x", value: {type: "literal", value: 1}}` | `set_field("x", 1);` |
| `{type: "let_assignment", var_name: "tmp", value: {type: "function_call", name: "to_long", args:{positional:[{type:"field_ref", field:"level"}]}}}` | `let tmp = to_long(level);` |

### Emitter skeleton

```js
// src/pipeline-dsl/emit.js (sketch)
import { escapeString } from "./escape.js";

export function emitRule({ name, when, then }) {
    return [
        `rule "${escapeString(name)}"`,
        `when`,
        `    ${emitExpr(when)}`,
        `then`,
        ...then.map(a => `    ${emitAction(a)}`),
        `end`,
    ].join("\n");
}

function emitExpr(node) {
    switch (node.type) {
        case "literal":
            if (typeof node.value === "string") return `"${escapeString(node.value)}"`;
            if (node.value === null) return "null";
            return String(node.value); // numbers, booleans
        case "field_ref":
            const base = node.source === "message" ? "$message" : (node.source?.name ?? "");
            return base ? `${base}.${node.field}` : node.field;
        case "has_field":
            return `has_field("${escapeString(node.field)}")`;
        case "function_call":
            return `${node.name}(${emitArgs(node.args)})`;
        case "comparison":
            return `${emitExpr(node.left)} ${node.op} ${emitExpr(node.right)}`;
        case "and":
            return `(${emitExpr(node.left)} && ${emitExpr(node.right)})`;
        case "or":
            return `(${emitExpr(node.left)} || ${emitExpr(node.right)})`;
        case "not":
            return `! (${emitExpr(node.expr)})`;
        default:
            throw new Error(`unknown condition type: ${node.type}`);
    }
}

function emitArgs(args) {
    if (args.positional) return args.positional.map(emitExpr).join(", ");
    if (args.named) {
        return Object.entries(args.named)
            .map(([k, v]) => `${k}: ${emitExpr(v)}`)
            .join(", ");
    }
    return "";
}

function emitAction(action) {
    switch (action.type) {
        case "set_field": {
            const args = { positional: undefined, named: {
                field: { type: "literal", value: action.field },
                value: action.value,
                ...(action.message ? { message: action.message } : {}),
                ...(action.default !== undefined ? { default: action.default } : {}),
                ...(action.clean_field !== undefined ? { clean_field: { type: "literal", value: action.clean_field } } : {}),
                ...(action.prefix !== undefined ? { prefix: { type: "literal", value: action.prefix } } : {}),
                ...(action.suffix !== undefined ? { suffix: { type: "literal", value: action.suffix } } : {}),
            }};
            return `set_field(${emitArgs(args)});`;
        }
        case "remove_field":
            return `remove_field("${escapeString(action.field)}");`;
        case "rename_field":
            return `rename_field("${escapeString(action.old_field)}", "${escapeString(action.new_field)}");`;
        case "lookup_value": {
            // Sugar: let __tmp_<n> = lookup_value(...); set_field(target, __tmp_<n>);
            return `set_field("${escapeString(action.target_field)}", lookup_value(${emitArgs({named: { lookup_table: {type:"literal",value:action.lookup_table}, key: action.key, ...(action.default!==undefined?{default:action.default}:{})}})}));`;
        }
        case "function_call_statement":
            return `${action.name}(${emitArgs(action.args)});`;
        case "let_assignment":
            return `let ${action.var_name} = ${emitExpr(action.value)};`;
        default:
            throw new Error(`unknown action type: ${action.type}`);
    }
}
```

[CITED: `RuleLang.g4:70-115` for the production list this emitter targets.]

## DSL String Escape Character Set (D-13)

Verified from `RuleLang.g4:363-381`:

```
EscapeSequence
    :   '\\' [btnfr"'\\]
    |   OctalEscape         (\\OctalDigit{1..3})
    |   UnicodeEscape       (\\uHHHH)
    ;
```

**Therefore `escape.js :: escapeString(s)` MUST translate:**

| Input char | Output sequence |
|------------|-----------------|
| `\` | `\\` |
| `"` | `\"` |
| `\b` (U+0008) | `\b` |
| `\t` (U+0009) | `\t` |
| `\n` (U+000A) | `\n` |
| `\f` (U+000C) | `\f` |
| `\r` (U+000D) | `\r` |
| `'` (U+0027) | `\'` (optional — single-quote is only mandatory inside char literals, but emitting `\'` is harmless and safer) |
| Other control char (U+0000..U+001F except the above) | `\uNNNN` 4-digit hex |
| Otherwise | passthrough |

The escape helper does NOT need to handle octal escapes (output direction — only the input-parser side needs them). Wrapping every "wide" control character in `\uNNNN` is the safest fallback.

**Recommended implementation:**

```js
// src/pipeline-dsl/escape.js
const SHORT = { 0x08: "\\b", 0x09: "\\t", 0x0A: "\\n", 0x0C: "\\f", 0x0D: "\\r", 0x22: '\\"', 0x27: "\\'", 0x5C: "\\\\" };

export function escapeString(s) {
    if (typeof s !== "string") throw new TypeError(`escapeString: expected string, got ${typeof s}`);
    let out = "";
    for (const ch of s) {
        const code = ch.codePointAt(0);
        if (SHORT[code] !== undefined) { out += SHORT[code]; continue; }
        if (code < 0x20) { out += "\\u" + code.toString(16).padStart(4, "0"); continue; }
        out += ch;
    }
    return out;
}

export function escapeValue(v) {
    // Type-aware: strings → "<escaped>"; numbers/booleans → toString; null → null;
    // Anything else (objects, arrays, undefined) → throw — agent must use structured intent.
    if (v === null) return "null";
    if (typeof v === "string") return `"${escapeString(v)}"`;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    throw new TypeError(`escapeValue: refusing to emit ${typeof v} as a DSL literal — use structured intent FunctionCall / FieldRef instead`);
}
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parse Graylog rule DSL client-side | A JS parser for RuleLang.g4 | Server-side `POST /system/pipelines/rule/parse` | The grammar has ~30 productions, recursive expressions, ANTLR-managed precedence. A hand-rolled parser would lag the source. The server is online; one pre-flight per dry-run is cheap. [CITED: PITFALLS C4 conclusion] |
| Simulate rule execution client-side | A JS interpreter | Server-side `POST /system/pipelines/rule/simulate` | The simulator runs the same code path as production message processing — including type coercion, lookup-table side-effects, and field-collision semantics. Re-implementing would silently diverge. [CITED: PITFALLS M3 conclusion] |
| Function-name lint via prefix matching | Heuristics like "starts with `to_`" | `validate.js` consulting the merged catalogue from `function-catalogue.js` | Catalogue is authoritative; heuristics would false-positive on `to_string` and miss `multi_grok`. |
| Discover pipelines that reference a rule (cascade D-14) | Per-pipeline source-string scan with regex | `GET /system/pipelines/rule/paginated` reading `used_in_pipelines` | Server already computes the join. Re-implementing means re-parsing pipeline source (which itself needs the parser we just said don't hand-roll). |
| Compute the cascade confirmation hash | Inline sha-256 with custom canonical | `_shared/cascade-hash.js :: computeCascadeHash` | Already shipped + tested in Phase 3 with byte-stable frozen fixtures. Drift-resistant by keyed-buckets canonicalization. |
| Type-aware structured-intent → DSL literal emission | Inline switch in every action emit site | `escape.js :: escapeString` + `escape.js :: escapeValue` | Single point of escape — repeats the M3-step-1 lesson at the structural level. |
| Per-connection live function-catalogue cache | Inline Map in `list-pipeline-functions.js` | `src/pipeline-dsl/function-catalogue.js` (separate module) | Two consumers: `list_pipeline_functions` tool AND `validate.js` lint. Moving into a shared module avoids re-fetching at two distinct call sites. |
| String concatenation to build DSL | `` `set_field("${field}", "${value}")` `` | `emit.js` + `escape.js` | The recurrence of the CONCERNS.md "no query escaping" bug at a new layer is the single highest-severity Phase 4 risk. Banned at the architecture level. |

**Key insight:** Every Phase 4 wrapper is either (a) a thin pass-through to a Graylog endpoint with parse pre-flight or (b) a structured-intent emit + parse pre-flight. The wrapper NEVER tries to be smarter than Graylog about DSL semantics. Even the function-name lint defers to the server's catalogue.

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | MongoDB collections `pipeline_processor_pipelines`, `pipeline_processor_rules`, `pipeline_processor_pipeline_connections` (Graylog-managed, server-side; not directly touched by MCP) | None — MCP wrappers operate via REST only. |
| Live service config | None — no MCP-side configuration changes in Phase 4 (no new env vars, no new auth concepts). | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | None — Phase 4 introduces no new tokens, no new client identities. | None. |
| Build artifacts | New ES modules under `src/tools/pipelines/` and `src/pipeline-dsl/`; no compiled artifacts (ESM only); no egg-info / pyproject equivalents. | Plans must update `src/tools/_register.js` to import the new barrel `./pipelines/index.js`. Plans must add new tool entries to `src/tools.js` (the JSON-Schema declarations — 14 new entries). |

**Phase 4 is a greenfield addition; no rename/refactor migration steps.**

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js ≥22.3.0 | All tools (stable t.snapshot) | Assumed (per package.json engines) | — | — |
| `@modelcontextprotocol/sdk` 1.18.0 | All tools | ✓ | 1.18.0 | — |
| `axios` 1.12.2 | All tools | ✓ | 1.12.2 | — |
| `zod` 3.25.76 | Structured intent (D-11 recursive union), schemas | ✓ | ^3.25.76 | — |
| Graylog 7.0.6 at `http://<graylog-host>` | U1 smoke (D-16); live verification | UNKNOWN at research time | — | Default partial-update to STRICT_NO_ECHO per Phase 3 precedent if smoke is unreachable. |
| Graylog source clone at `source-code/graylog2-server/` | Builtins catalogue extraction (D-02) | ✓ | 7.2.0-SNAPSHOT | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** Live Graylog smoke for D-16 — fall back to STRICT_NO_ECHO per Phase 3 precedent. The 03-U1-SMOKE.md doc explicitly establishes this fallback policy.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` (Phase 0 FOUND-06 established) |
| Config file | none (built-in runner) |
| Quick run command | `node --test --test-name-pattern "<pattern>"` (per-tool) |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PIPE-01 | list_pipelines narrow + expand projection | unit | `node --test --test-name-pattern "list_pipelines"` | ❌ Wave 0 |
| PIPE-02 | get_pipeline full DTO | unit | `node --test --test-name-pattern "get_pipeline"` | ❌ Wave 0 |
| PIPE-03 | create_pipeline with parse pre-flight (success + parse refusal) | unit | `node --test --test-name-pattern "create_pipeline"` | ❌ Wave 0 |
| PIPE-04 | update_pipeline STRICT_NO_ECHO + parse pre-flight | unit | `node --test --test-name-pattern "update_pipeline"` | ❌ Wave 0 |
| PIPE-05 | delete_pipeline sync envelope | unit | `node --test --test-name-pattern "delete_pipeline"` | ❌ Wave 0 |
| PIPE-06 | list_pipeline_rules narrow projection | unit | `node --test --test-name-pattern "list_pipeline_rules"` | ❌ Wave 0 |
| PIPE-07 | get_pipeline_rule | unit | `node --test --test-name-pattern "get_pipeline_rule"` | ❌ Wave 0 |
| PIPE-08 | create_pipeline_rule structured + raw + parse refusal (C4 acceptance gate) | unit | `node --test --test-name-pattern "create_pipeline_rule"` | ❌ Wave 0 |
| PIPE-09 | update_pipeline_rule partial update + parse pre-flight | unit | `node --test --test-name-pattern "update_pipeline_rule"` | ❌ Wave 0 |
| PIPE-10 | delete_pipeline_rule cascade hash + drift refusal | unit | `node --test --test-name-pattern "delete_pipeline_rule"` | ❌ Wave 0 |
| PIPE-11 | list_pipeline_functions overlay (live wins on collision) | unit | `node --test --test-name-pattern "list_pipeline_functions"` | ❌ Wave 0 |
| PIPE-12 | simulate_pipeline_rule with JSON-string message encoding (M3 acceptance gate) | unit | `node --test --test-name-pattern "simulate_pipeline_rule"` | ❌ Wave 0 |
| PIPE-13 | connect_pipelines_to_stream merge semantics | unit | `node --test --test-name-pattern "connect_pipelines_to_stream"` | ❌ Wave 0 |
| PIPE-14 | disconnect_pipelines_from_stream subtract semantics | unit | `node --test --test-name-pattern "disconnect_pipelines_from_stream"` | ❌ Wave 0 |
| ALL | DSL helpers (escape, emit, validate, function-catalogue, builtins) | unit | `node --test --test-name-pattern "pipeline-dsl"` | ❌ Wave 0 |
| ALL | Schema parity (14 new assertions) | unit | `node --test --test-name-pattern "schema-parity"` | ✅ extend |
| ALL | Snapshot fixtures (~14 fixtures per Discretion-05) | snapshot | `node --test test/snapshots/pipelines.test.js` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `node --test --test-name-pattern "<the_tool_just_modified>"` — typically <2 seconds per tool.
- **Per wave merge:** `npm test` — full suite (~6 seconds for current 459 tests; budget ~10 seconds for the +~150 Phase 4 tests).
- **Phase gate:** Full suite green AND every Phase 4 snapshot fixture pinned + reviewed before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `test/pipelines.test.js` — main handler test file (covers PIPE-01..14)
- [ ] `test/pipeline-dsl.test.js` — DSL helper tests (escape, emit, validate, function-catalogue)
- [ ] `test/snapshots/pipelines.test.js` — snapshot fixture harness
- [ ] `test/schema-parity.test.js` — extend with 14 new `assertSchemaParityForTool` calls
- [ ] Optional: `test/builtins.test.js` — pin the 130 hand-curated names against the static export (catches accidental list mutations)
- [ ] Framework install: NONE — `node:test` is built-in (Phase 0 already validated)

### Snapshot Fixture Design (Discretion-05 baseline; planner refines)

Recommended 14 fixtures (one per Phase 4 tool plus 2 acceptance-gate proofs):

| # | Tool | Fixture | Pins |
|---|------|---------|------|
| 1 | list_pipelines | narrow projection of 2-pipeline cluster | response shape; `mutable` absent (D-15) |
| 2 | create_pipeline | structured pipeline `source` with 2 stages; dry-run | `parseResult.ok: true`; postApplyEstimate id sentinel |
| 3 | update_pipeline | STRICT_NO_ECHO partial — change title only | wire body has only `title` key |
| 4 | delete_pipeline | dry-run sync envelope | no `cascades` key; no `_confirmationToken` |
| 5 | create_pipeline_rule | structured intent exercising all 6 Condition types + 4 Action types; dry-run | parseResult.ok true; full emitted DSL string pinned byte-stable |
| 6 | **create_pipeline_rule (C4 gate)** | raw DSL with `toUpperCase` typo; dry-run | `parseResult.error` populated; `reason: "rule_parse_failed"`; isError envelope |
| 7 | update_pipeline_rule | STRICT_NO_ECHO partial — change description only | wire body has only `description` |
| 8 | delete_pipeline_rule | dry-run with 2 referencing pipelines; cascade hash | `cascades.pipelines: [{id,title}, ...]`; 64-hex confirmationToken |
| 9 | delete_pipeline_rule | dry-run empty cascade | empty cascades; DIFFERENT 64-hex confirmationToken (keyed-buckets disambiguation proof) |
| 10 | list_pipeline_functions | live overlay merging static + live with one name collision | merged entry uses live signature, static description fallback |
| 11 | **simulate_pipeline_rule (M3 gate)** | rule that sets a field; sample message has the source field | post-rule message DTO shows the new field set |
| 12 | simulate_pipeline_rule | rule that uses `to_long` on string field "1024"; sample has "1024foo" → type-coercion failure visible | catches semantic bug parse couldn't |
| 13 | connect_pipelines_to_stream | dry-run merging args.pipelineIds with current set | body's `pipeline_ids` is `sort(current ∪ args)`; existingMatches list of `already_connected` |
| 14 | disconnect_pipelines_from_stream | dry-run subtracting args.pipelineIds | body's `pipeline_ids` is `sort(current \ args)` |

All 14 fixtures must be byte-stable: no timestamps, no UUIDs (use the `__SERVER_ASSIGNED__` sentinel for any post-apply id), no `Date.now()` outputs. The cascade hash is deterministic (Phase 3 proved this). The auth-redaction lint already covers fixture-side redaction.

## Common Pitfalls

### Pitfall 1: `simulate` body's `message` field is a JSON string, not an object

**What goes wrong:** Wrapper assembles the request body as `{message: args.message, rule_source: {...}}` (passing the agent's field-map dict directly). Graylog returns 400 with Jackson error "Cannot deserialize value of type `java.lang.String` from Object value".

**Why it happens:** `SimulateRuleRequest.message()` is typed `String`; `ruleSimulator.createMessage(string)` does its own JSON parsing of that string. Surprising shape because every other Graylog endpoint takes typed objects.

**How to avoid:** In `simulate_pipeline_rule.build()`, do `body.message = JSON.stringify(args.message)`. Test fixture for the wire body MUST pin this.

**Warning signs:** Live smoke 400 with "deserialize" in the message text. Snapshot fixture failing equality when message is rendered as an object literal.

### Pitfall 2: `connect_pipelines_to_stream` silently disconnects existing pipelines (REPLACE semantics)

**What goes wrong:** Wrapper POSTs `{stream_id, pipeline_ids: args.pipelineIds}` directly. Graylog overwrites the connection record. Previously-connected pipelines vanish from the stream's routing.

**Why it happens:** `connectionsService.save(connection)` in `PipelineConnectionsResource.java:99` is a Mongo replace — not a merge.

**How to avoid:** Always GET the current connection set first (Pattern 3). Treat 404 as "empty set". Union for PIPE-13; difference for PIPE-14.

**Warning signs:** Unit test that doesn't mock the GET pre-flight passes when it should fail. UAT: after `connect_pipelines_to_stream`, one of the originally-connected pipelines stops processing messages from the stream.

### Pitfall 3: Pipeline path is `/pipeline/`, not bare

**What goes wrong:** Wrapper uses `/api/system/pipelines/{id}` for get/update/delete; Graylog 7.0.6 returns 404.

**Why it happens:** `PipelineResource` has `@Path("/system/pipelines/pipeline")` — the literal `pipeline` segment is part of the path. The naming is asymmetric with `RuleResource @Path("/system/pipelines/rule")` — consistent for both, just both have a singular noun in the path.

**How to avoid:** Build all pipeline paths as `/api/system/pipelines/pipeline/...`. Document this in the schema file's leading comment.

**Warning signs:** 404 on every pipeline read/write. Test fixture URLs missing the `/pipeline/` segment.

### Pitfall 4: `from_input` and other side-effect-bearing functions pass parse but break simulate

**What goes wrong:** Agent generates `when from_input(name: "syslog-input")` — parses fine, but at simulate time the function returns false because the simulated message has no `gl2_source_input` field set.

**Why it happens:** `FromInput.java` reads `message.gl2_source_input`. The simulator's `createMessage(jsonString)` doesn't populate Graylog's internal `gl2_*` metadata fields.

**How to avoid:** Document in `simulate_pipeline_rule` tool description that functions depending on `gl2_*` internal fields (`from_input`, `route_to_stream`, `remove_from_stream`) cannot be meaningfully simulated. The simulator is most useful for `set_field`, type coercion, and field-comparison logic.

**Warning signs:** Snapshot fixture for `simulate(rule_with_from_input)` shows unchanged message — looks like the rule didn't fire — but agent expected it to.

### Pitfall 5: Hand-curated `builtins.js` drifts from Graylog source

**What goes wrong:** Phase 4 ships with 130 entries. Graylog 7.2.x adds 2 new functions. `validate.js` flags them as "unknown function" before parse pre-flight runs.

**Why it happens:** D-02 is hand-curated; no auto-regeneration. The live overlay (D-03) catches this — `validate.js` should consult the MERGED catalogue, not the static one. If a name appears in live but not static, treat it as known.

**How to avoid:** `validate.js` MUST take the merged-catalogue Map from `function-catalogue.js`, not the raw `staticBuiltins` array. Test fixture: live response with a fake `__phase4_test_function__` entry → `validate.js` accepts it.

**Warning signs:** Snapshot fixture for a rule that uses a recent function fails with "unknown function" lint before parse pre-flight runs.

### Pitfall 6: ParseError JSON has `positionInLine` (camelCase), not `position_in_line` (snake_case)

**What goes wrong:** Wrapper extracts `err.body[0].position_in_line` — gets `undefined`. Surfaces `parseResult.error.column: undefined` to the agent.

**Why it happens:** `ParseError.java:38-46` annotates the field with `@JsonProperty public int positionInLine()` — Jackson uses the method name, NOT a snake-case override. Most Graylog wire fields are snake_case but this one is camelCase.

**How to avoid:** When extracting parse errors, read `e.positionInLine` and surface as `parseResult.error.position_in_line` (the wrapper's snake_case convention). Test fixture pins this.

**Warning signs:** `parseResult.error.column` always undefined in fixtures.

### Pitfall 7: Pagination on `/rule/paginated` for D-14 cascade discovery

**What goes wrong:** Wrapper uses page=1, per_page=50 and assumes the target rule is on page 1. With >50 rules, the rule may be on page 3; `used_in_pipelines[ruleId]` is absent.

**Why it happens:** `used_in_pipelines` is computed for the rules ON THE RETURNED PAGE only (`RuleResource.java:229-251` — the join is on `rules` the current page contains).

**How to avoid:** Either (a) use `query=id:<ruleId>` to filter to a single rule before paging — verify the syntax against SearchQueryParser on 7.0.6 — OR (b) page through all results until the rule is found OR (c) fall back to Strategy B (full pipeline scan + string match). Recommendation: try (a); if it 400s on the live smoke, use (b) with a `for await` paginator and an early-exit on first hit. Bound to 200 pages * 50 rules = 10000 rules max.

**Warning signs:** Cascade hash includes no pipelines when in fact one references the rule. Test fixture: cluster with 60 rules + target on page 2 — naive page=1 wrapper produces empty cascade.

## Code Examples

### Pattern: Parse pre-flight in build() (PIPE-08)

```js
// src/tools/pipelines/create-pipeline-rule.js (excerpt)
import { defineMutatingHandler } from "../_shared/handler.js";
import { CreatePipelineRuleSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { GraylogValidationError } from "../../graylog/errors.js";
import { emitRule } from "../../pipeline-dsl/emit.js";
import { validateRuleSource } from "../../pipeline-dsl/validate.js";
import { getMergedCatalogue } from "../../pipeline-dsl/function-catalogue.js";

export const handleCreatePipelineRule = defineMutatingHandler({
    name: "create_pipeline_rule",
    schema: CreatePipelineRuleSchema,
    async build(args) {
        const client = makeClient(args._conn);
        // 1. Resolve DSL source — either from structured intent or raw.
        const source = args.structured
            ? emitRule(args.structured)
            : args.ruleSource;
        // 2. Client-side lint (D-04) — catches obvious typos before round-trip.
        const catalogue = await getMergedCatalogue(args._connectionName, args._conn);
        const lintResult = validateRuleSource(source, catalogue);
        if (lintResult.errors.length > 0) {
            const err = new GraylogValidationError(
                `Client-side validation failed: ${lintResult.errors.map(e => `${e.type}: ${e.message}`).join("; ")}`,
                { status: 400, method: "POST", path: "/api/system/pipelines/rule" },
            );
            err.reason = "rule_validation_failed";
            err.lintErrors = lintResult.errors;
            throw err;
        }
        // 3. Server parse pre-flight (D-05) — authoritative.
        let parseResult;
        try {
            await client.request("POST", "/api/system/pipelines/rule/parse", { source });
            parseResult = { ok: true };
        } catch (err) {
            if (err.isGraylogError && err.status === 400) {
                const errs = Array.isArray(err.body) ? err.body : [err.body];
                parseResult = {
                    ok: false,
                    error: errs.map(e => ({
                        line: e.line,
                        position_in_line: e.positionInLine,
                        type: e.type,
                        message: e.message ?? `${e.type} at line ${e.line}`,
                    })),
                };
                const wrapped = new GraylogValidationError(
                    `Server rule parse failed: ${parseResult.error.map(e => `[L${e.line}:${e.position_in_line}] ${e.type}`).join("; ")}`,
                    { status: 400, method: "POST", path: "/api/system/pipelines/rule/parse" },
                );
                wrapped.reason = "rule_parse_failed";
                wrapped.parseResult = parseResult;
                throw wrapped;
            }
            throw err;
        }
        // 4. M5 existingMatches pre-check.
        const existingMatches = await findExistingMatches(client, {
            listPath: "/api/system/pipelines/rule",
            matchFn: (r) => r.title === args.title, // title is derived from source on parse — Plan 03 verifies
        });
        // 5. Return descriptor.
        return {
            method: "POST",
            path: "/api/system/pipelines/rule",
            body: { source, description: args.description ?? null },
            parseResult,
            existingMatches,
            postApplyEstimate: { id: "__SERVER_ASSIGNED__" },
        };
    },
    async apply(client, req) {
        return await client.request(req.method, req.path, req.body);
    },
    summarize: (args, req) => `Create pipeline rule (${args.structured ? "structured" : "raw"} DSL)`,
});
```

### Pattern: Delete pipeline rule cascade (PIPE-10, D-14)

```js
// src/tools/pipelines/delete-pipeline-rule.js (excerpt)
import { computeCascadeHash } from "../_shared/cascade-hash.js";

async function discoverReferencingPipelines(client, ruleId) {
    // Strategy A: paginated rule list with used_in_pipelines join.
    // Paginate until the rule is found, then return its used_in_pipelines[id].
    const perPage = 50;
    const maxPages = 200;
    for (let page = 1; page <= maxPages; page++) {
        const rsp = await client.request(
            "GET",
            `/api/system/pipelines/rule/paginated?page=${page}&per_page=${perPage}`,
            null,
        );
        const rules = Array.isArray(rsp?.rules) ? rsp.rules : [];
        const target = rules.find(r => r.id === ruleId);
        if (target) {
            const refs = rsp?.context?.used_in_pipelines?.[ruleId]
                ?? rsp?.used_in_pipelines?.[ruleId]
                ?? [];
            return refs.map(p => ({ id: p.id, title: p.title }));
        }
        if (rules.length < perPage) break; // ran off the end without finding it
    }
    // Rule not found — let DELETE 404 handle.
    return [];
}

export const handleDeletePipelineRule = defineMutatingHandler({
    name: "delete_pipeline_rule",
    schema: DeletePipelineRuleSchema,
    async build(args) {
        const client = makeClient(args._conn);
        const path = `/api/system/pipelines/rule/${args.ruleId}`;
        const pipelines = await discoverReferencingPipelines(client, args.ruleId);
        const confirmationToken = computeCascadeHash({
            streamId: args.ruleId, // generic 'streamId' input slot — semantically the cascade root id
            ruleIds: [],            // unused for pipeline-rule cascade
            pipelineConnIds: pipelines.map(p => p.id),
            eventDefIds: [],
        });
        return {
            method: "DELETE",
            path,
            cascades: { pipelines },
            postApplyEstimate: { id: args.ruleId, deleted: true },
            _confirmationToken: confirmationToken,
        };
    },
    async apply(client, req) {
        const m = req.path.match(/rule\/([^/?]+)/);
        const ruleId = m ? m[1] : "unknown";
        const pipelines = await discoverReferencingPipelines(client, ruleId);
        const currentHash = computeCascadeHash({
            streamId: ruleId,
            ruleIds: [],
            pipelineConnIds: pipelines.map(p => p.id),
            eventDefIds: [],
        });
        if (currentHash !== req._confirmationToken) {
            return {
                isError: true,
                reason: "cascade_changed_since_preview",
                content: [{ type: "text", text: "[delete_pipeline_rule] cascade_changed_since_preview: referencing pipelines changed between dry-run and apply." }],
            };
        }
        await client.request("DELETE", req.path, null);
        return { deleted: true, ruleId };
    },
    summarize: (args) => `Delete pipeline rule ${args.ruleId}`,
    requireConfirm: ({ req }) => req._confirmationToken ?? null,
});
```

**Note:** `computeCascadeHash` takes a fixed signature `{streamId, ruleIds, pipelineConnIds, eventDefIds}` from Phase 3. For Phase 4 we're misusing `streamId` as the cascade-root id and `pipelineConnIds` as the pipelines bucket. This is functionally correct (the hash depends only on `streamId` value + the per-bucket id sets) but is semantically misleading. **Recommendation for Plan 01:** add a `computeRuleCascadeHash({ruleId, pipelineIds})` thin wrapper in `_shared/cascade-hash.js` that forwards `streamId=ruleId, pipelineConnIds=pipelineIds, ruleIds=[], eventDefIds=[]`. The canonical JSON shape stays the same (compatibility with frozen Phase 3 hashes is preserved because Phase 3 inputs aren't shared), but the calling code reads naturally.

### Pattern: Function-catalogue overlay (PIPE-11)

```js
// src/tools/pipelines/list-pipeline-functions.js
import { defineListHandler } from "../_shared/handler.js";
import { ListPipelineFunctionsSchema } from "./schemas.js";
import { getMergedCatalogue } from "../../pipeline-dsl/function-catalogue.js";

export const handleListPipelineFunctions = defineListHandler({
    name: "list_pipeline_functions",
    schema: ListPipelineFunctionsSchema,
    async fetch({ _connectionName, _conn, category }) {
        const merged = await getMergedCatalogue(_connectionName, _conn);
        let entries = [...merged.values()];
        if (category) entries = entries.filter(e => e.category === category);
        return entries.sort((a, b) => a.name.localeCompare(b.name));
    },
    project: (entries, { expand }) => entries.map(e => expand
        ? e
        : { name: e.name, signature: e.signature, category: e.category, deprecated: e.deprecated }
    ),
});
```

## State of the Art

| Old Approach (research training data) | Current Approach (Graylog 7.0.6+) | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Pipeline endpoint at `/api/system/pipelines/{id}` | `/api/system/pipelines/pipeline/{id}` (singular noun in path) | Pre-7.0 — verified against current source | Wrapper must use the longer path. |
| `count(field)` in event-aggregation (v6) | `count_field` (v7+); pipeline DSL unaffected | 7.1.0-rc.1 (changelog/pr-24703) | Out of scope for Phase 4 (events are Phase 5). Note for cross-phase awareness. |
| Function-name discovery via documentation only | `GET /system/pipelines/rule/functions` returns a structured FunctionDescriptor catalogue | 7.0+ — verified at `RuleResource.java:315-322` | Enables D-03 live overlay; obviates inline LLM training-data drift. |
| `to_uppercase`/`toUpperCase` (Java/JS conventions agent invents) | Graylog uses `uppercase` (no `to_` prefix on string-case helpers) | N/A — Graylog idiom from inception | C4 acceptance gate verifies. |
| `whitelist` field on stream rules | `allowlist` (v7.0 rename) | 7.0 (changelog/issue-21034) | Out of scope for Phase 4 (streams are Phase 3) — already addressed by 03-RESEARCH.md. |

**Deprecated / outdated:**

- **Single-message simulate via `GET /system/pipelines/{pipelineId}/simulate` (hypothetical):** does NOT exist. Simulate is rule-level only via `POST /system/pipelines/rule/simulate`. Pipeline-level simulation against a real input stream is not exposed via REST in 7.0.6.
- **Bulk-import pipelines/rules via content packs:** out of scope; Phase 4 is per-tool single-entity CRUD.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Hand-curated descriptions in §"Built-in Function Catalogue" are accurate one-liners | Built-in Function Catalogue | LOW — descriptions are documentation only; the wrapper consults the live overlay for authoritative signatures. The live overlay's `description` field wins on merge. |
| A2 | Strategy A (paginated `/rule/paginated` with `used_in_pipelines` join) works on 7.0.6 | D-14 cascade discovery | MEDIUM — verified in 7.2-SNAPSHOT source; if 7.0.6 lacks the `used_in_pipelines` context, Plan 03 falls back to Strategy B (full pipeline scan). |
| A3 | `query=id:<value>` syntax works on `SearchQueryParser` for the paginated endpoints | Pitfall 7 | MEDIUM — `SearchQueryParser` is generic across resources; the syntax has been stable since v4.x but should be smoke-verified on 7.0.6. |
| A4 | The simulator's `createMessage(jsonString)` does NOT populate `gl2_source_input` etc. | Pitfall 4 | LOW — the simulator is documented in the wrapper as "best for set_field / type coercion / field comparisons; functions depending on `gl2_*` internal fields are not meaningful in simulate". Snapshot fixture #12 demonstrates a non-`gl2_*` use case. |
| A5 | `POST /system/pipelines/pipeline/parse` exists on 7.0.6 | D-06 pipeline parse pre-flight | LOW — verified in 7.2-SNAPSHOT source (`PipelineResource.java:172-199`). If absent on 7.0.6, Plan 01 falls back to "parse-only-at-apply" for pipelines and the C4 mitigation for pipelines becomes server-rejection-on-apply rather than wrapper-side-refusal-on-dry-run. |
| A6 | Pipelines have no `mutable: boolean` flag on the wire (D-15) | D-15 | LOW — verified by reading `PipelineSource.java`; no `is_editable` annotation, no `mutable` field, no `_scope` value indicating immutability beyond the existing `DefaultEntityScope` (used for delete-protection but already handled by mapGraylogError on 403). |
| A7 | `GET /api/system/pipelines/connections/{streamId}` returns 404 when no connection exists | Pattern 3 | LOW — verified by `PipelineConnectionsResource.java:160-178` calling `connectionsService.load(streamId)` which throws `NotFoundException` (Graylog standard 404 mapper). |
| A8 | The signature column in §"Built-in Function Catalogue" is hand-curated and may have minor inaccuracies in optional flags / default values vs the actual Java constructor | Built-in Function Catalogue introduction | LOW — `validate.js` arg-count check is informational only; the parse pre-flight is the authoritative gate. Plans MUST audit each signature against the file at the time of writing `builtins.js`. |

**If this table is empty:** Several assumptions are tagged LOW or MEDIUM. The MEDIUM ones (A2, A3) are explicitly recoverable via fallback strategies documented in Pattern 4 and Pitfall 7. None are blocking.

## Open Questions (RESOLVED)

1. **D-16 partial-update outcome.**
   - What we know: Phase 3 defaulted to STRICT_NO_ECHO when smoke was unreachable; Phase 2 chose MERGE_FROM_CURRENT for index-sets after a successful smoke.
   - What's unclear: whether `PUT /api/system/pipelines/pipeline/{id}` with `{title: "new"}` only (no `source` field) returns 200 or 400 on 7.0.6.
   - **RESOLVED:** Plan 01 ships `04-U1-SMOKE.md` artifact. If smoke is unreachable, default to STRICT_NO_ECHO for both `update_pipeline` and `update_pipeline_rule` (Phase 3 precedent).

2. **D-04 `validate.js` strictness level for arg-count.**
   - What we know: every `ParameterDescriptor` has an `optional()` flag in the Java source; the live function-catalogue surfaces it via `params[].optional`.
   - What's unclear: should `validate.js` error on missing required args, warn, or skip until parse pre-flight catches it?
   - **RESOLVED:** WARN level only (surface as `parseResult.warnings: [...]`) — let the server be the authoritative gate. Avoids false positives when the catalogue is stale or signature inference is imprecise. Plan 01 implements paren-balance + function-name only.

3. **`list_pipeline_functions` signature representation when live + static disagree (Discretion-04).**
   - What we know: live entries carry structured `params: [{name, type, optional, ...}]`; static entries carry a TypeScript-ish signature string.
   - What's unclear: do we render the merged entry's signature from the live structure, or fall through to the static string when the static description is preferred?
   - **RESOLVED:** render from live `params` when available (line up with live source-of-truth); fall back to static when live is absent. The `validate.js` arg-count uses `merged.params.length` when present. Plan 01 function-catalogue.js implements.

4. **Whether to ship a `computeRuleCascadeHash` semantic wrapper around `computeCascadeHash`.**
   - What we know: Phase 3's `computeCascadeHash({streamId, ruleIds, pipelineConnIds, eventDefIds})` works for Phase 4 if we misuse `streamId` as `ruleId` and `pipelineConnIds` as `pipelineIds`.
   - What's unclear: is the readability win worth the +5 LOC wrapper, or do we accept the parameter-name mismatch?
   - **RESOLVED:** ship the wrapper. Plan 01 adds `computeRuleCascadeHash({ruleId, pipelineIds})` to `_shared/cascade-hash.js`. Documentation, code review, and future delete_event_definition / delete_dashboard cascade ergonomics all benefit.

5. **Cache invalidation policy for `function-catalogue.js`.**
   - What we know: D-03 says "process-lifetime cache".
   - What's unclear: is a long-running MCP server vulnerable to function-set drift after a Graylog plugin reload?
   - **RESOLVED:** ship process-lifetime as specified; flag a future `refresh_pipeline_function_catalogue` admin tool if drift becomes operationally visible. CONTEXT.md Deferred Ideas already lists this. Plan 01 implements.

## Sources

### Primary (HIGH confidence)

- `source-code/graylog2-server/.../pipelineprocessor/rest/RuleResource.java` — endpoint #6-#12 verified; parse + simulate + functions endpoints
- `source-code/graylog2-server/.../pipelineprocessor/rest/PipelineResource.java` — endpoint #1-#5 + #5b (pipeline parse) verified
- `source-code/graylog2-server/.../pipelineprocessor/rest/PipelineConnectionsResource.java` — endpoint #13/#13b/#14 verified
- `source-code/graylog2-server/.../pipelineprocessor/rest/RuleSource.java` — DTO shape for rules
- `source-code/graylog2-server/.../pipelineprocessor/rest/PipelineSource.java` — DTO shape for pipelines
- `source-code/graylog2-server/.../pipelineprocessor/rest/PipelineConnections.java` — DTO shape for connections (`Set<String>` confirms semantics)
- `source-code/graylog2-server/.../pipelineprocessor/rest/SimulateRuleRequest.java` — `message: String` confirmed
- `source-code/graylog2-server/.../pipelineprocessor/parser/errors/ParseError.java` — JSON shape (`type`, `line`, `positionInLine`)
- `source-code/graylog2-server/.../pipelineprocessor/ast/functions/FunctionDescriptor.java` — `params: [{name, type, optional, ...}]` shape
- `source-code/graylog2-server/.../pipelineprocessor/parser/RuleLang.g4` — grammar productions + escape character set
- `source-code/graylog2-server/.../pipelineprocessor/functions/**/*.java` — 130 files enumerated for builtins.js
- `.planning/phases/03-streams-stream-rules/03-03-SUMMARY.md` — delete_stream pattern (direct analog for delete_pipeline_rule)
- `.planning/phases/03-streams-stream-rules/03-01-SUMMARY.md` — cascade-hash helper promotion (direct reuse)
- `src/tools/streams/delete-stream.js` — pattern source
- `src/tools/streams/test-stream-match.js` — pattern source for simulate_pipeline_rule
- `src/tools/_shared/cascade-hash.js` — direct reuse
- `src/tools/_shared/handler.js` — defineMutatingHandler contract
- `src/tools/inputs/type-catalogue.js` — pattern for function-catalogue.js

### Secondary (MEDIUM confidence)

- `.planning/research/PITFALLS.md` §C4, §C6, §M3 — pitfall identification
- `.planning/research/ARCHITECTURE.md` §5 — pipeline-dsl module layout
- `.planning/research/SUMMARY.md` — phase ordering and mandatory pre-phase research note

### Tertiary (LOW confidence)

- Graylog public documentation (not consulted in this pass — source is authoritative)

## Metadata

**Confidence breakdown:**

- Endpoint shapes: HIGH — every endpoint verified against the 7.2.0-SNAPSHOT source clone. Cross-version drift between 7.0.6 and 7.2 is treated as MEDIUM but addressed by the U1-style smoke (D-16) and the live overlay (D-03) which catches any function-name divergence at runtime.
- Built-in function catalogue: HIGH for the 130 NAME constants (bulk-extracted by grep); MEDIUM for signatures (hand-curated; live overlay corrects at runtime); HIGH for category derivation (based on package paths).
- Architecture patterns: HIGH — every pattern has a Phase 2/3 in-tree precedent.
- Pitfalls: HIGH — each pitfall has a direct source-code line citation OR a verified anti-pattern from Phase 3 outcomes.
- Snapshot fixture set design: MEDIUM — 14 fixtures sketched; planner refines per Discretion-05.
- Validation Architecture: HIGH — `node:test` is already the project standard.

**Research date:** 2026-05-15
**Valid until:** 2026-06-15 (30-day stable horizon; Graylog 7.0.6 is the locked target — only an unannounced upstream change would invalidate this).
