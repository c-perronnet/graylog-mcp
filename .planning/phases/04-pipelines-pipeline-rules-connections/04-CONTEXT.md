# Phase 4: Pipelines, Pipeline Rules & Connections - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 delivers the pipelines + pipeline-rules + pipeline-to-stream-connections domain: 14 tools that let an agent author Graylog pipeline rules from structured intent or raw DSL, with both client-side validation and server-authoritative parse + simulate pre-flights gating every apply, AND wire pipelines to streams for end-to-end message routing. The phase's safety thesis is mitigating C4 (agent invents function names like `toUpperCase` instead of `to_upper`) and M3 (DSL escape, type-coercion, `then`-block semantics) end-to-end via the parse pre-flight + simulate primitive + cached function catalogue + structured-intent DSL emitter with a wrapper-side escape helper.

In scope: PIPE-01 through PIPE-12 (the 12 requirements as written in REQUIREMENTS.md) PLUS 2 new requirements added during planning per ROADMAP dependency line:
- **PIPE-13:** `connect_pipelines_to_stream` — attach pipelines to a stream
- **PIPE-14:** `disconnect_pipelines_from_stream` — detach pipelines from a stream

Total: 14 tools. Composition pattern: every tool is one `defineMutatingHandler` or `defineListHandler` call, reusing Phase 0/1/2/3 primitives (the cascade-hash helper from Phase 3 is reused for `delete_pipeline_rule` via the shared `_shared/cascade-hash.js` module).

Out of scope: dashboards, widgets, event definitions, event notifications, blueprints (Phases 5+). The ~20 "common rule patterns" template library (PITFALLS.md M3 mitigation step 4) is out — agents either compose structured intent themselves or use raw DSL. Auto-generation of `src/pipeline-dsl/builtins.js` from Graylog source is future work; Phase 4 hand-curates.

</domain>

<decisions>
## Implementation Decisions

### Pipeline-to-stream connections (scope expansion)

- **D-01:** Phase 4 expands by 2 requirements over the original REQUIREMENTS.md PIPE-01..12 set:
  - **PIPE-13:** `connect_pipelines_to_stream({connectionName, streamId, pipelineIds[]})` — attach one or more pipelines to a stream
  - **PIPE-14:** `disconnect_pipelines_from_stream({connectionName, streamId, pipelineIds[]})` — detach pipelines
  The roadmap's Phase 4 dependency line ("`connect_pipelines_to_stream` needs stream IDs") implies these belong here; closing the gap now lets agents build end-to-end stream→pipeline routing. The pipeline-connections endpoint shape needs research verification against Graylog 7.0.6 (likely `PUT /system/pipelines/connections/to_stream` or `POST /streams/{id}/connections` — researcher confirms).

### Function catalogue source + cache (PIPE-11, ROADMAP SC3)

- **D-02:** `src/pipeline-dsl/builtins.js` is the **hand-curated static baseline** — ~100 built-in functions enumerated as `{name, signature, oneLineDescription, category}` from `source-code/graylog2-server/.../plugin/pipelineprocessor/functions/`. This is the mandatory pre-phase research deliverable. Auto-regeneration is deferred.
- **D-03:** At runtime, `list_pipeline_functions` calls `GET /system/pipelines/rule/functions` ONCE per connection (cached process-lifetime per the Phase 2 D-06 pattern), then **overlays** the live catalogue on top of the static baseline. Live catalogue wins on name collisions (the connected Graylog is authoritative); static baseline fills gaps in description quality (Graylog's response is often signature-only).
- **D-04:** `src/pipeline-dsl/validate.js` is a client-side validator that consumes the combined catalogue. It catches "agent invented `toUpperCase`" before the network round-trip; the server-side parse pre-flight (D-05) catches anything client-side validation misses.

### Server-authoritative parse pre-flight (PIPE-08/09, C4 mitigation, ROADMAP SC1)

- **D-05:** Every dry-run that emits pipeline-rule DSL (`create_pipeline_rule`, `update_pipeline_rule`, the structured-intent → DSL emitter) calls `POST /system/pipelines/rule/parse` and surfaces the result in the dry-run output as `parseResult: {ok: boolean, error?: {line, column, message}}`. On `ok: false`, the dry-run is `isError: true` with `reason: "rule_parse_failed"` and the apply step is refused. C4 acceptance gate.
- **D-06:** Same parse pre-flight pattern for pipeline source (PIPE-03/04): `create_pipeline` and `update_pipeline` call `POST /system/pipelines/parse` (researcher confirms exact path on 7.0.6) and surface `parseResult` identically. Refuses apply on ParseException. Uniform C4 mitigation across rule DSL and pipeline DSL.

### simulate_pipeline_rule (PIPE-12, M3 mitigation, ROADMAP SC2)

- **D-07:** `simulate_pipeline_rule({connectionName, ruleSource, message})` calls `POST /system/pipelines/rule/simulate` (researcher confirms exact endpoint + request body shape against 7.0.6). Returns the post-rule message — catching semantic bugs (wrong function name passing the parser but failing at runtime, type-coercion errors, `set_field` overwriting reserved fields) that the parser cannot detect. Non-negotiable (PITFALLS M3 mitigation step 2).
- **D-08:** Sample message shape is **literal `{message: {...field_map...}}`** — same outer-key convention as Phase 3's `test_stream_match`. Agent passes `{ruleSource: "<DSL>", message: {source: "host", level: 6, payload: "..."}}`. Wrapper translates to whatever exact body shape Graylog 7.0.6's simulate endpoint expects. Consistent agent-boundary contract across `simulate_pipeline_rule` and `test_stream_match`.
- **D-09:** `simulate_pipeline_rule` routes through `defineMutatingHandler` per Phase 2 D-07 precedent (uniform `dryRun: true` default + writable-flag inheritance across the tool surface). `dryRun: true` returns the planned request without firing; apply hits the simulate endpoint. No Graylog state is mutated either way.

### Structured intent for create_pipeline_rule (PIPE-08, ROADMAP SC1)

- **D-10:** `create_pipeline_rule` accepts EITHER `ruleSource: string` (raw DSL) OR `structured: {when, then}` — never both (`z.union` with mutual exclusion via `.refine`). When `structured` is passed, the wrapper emits DSL via the structured-intent engine before calling the parse pre-flight.
- **D-11:** Structured intent has **full DSL coverage** — the JSON schema covers ALL Graylog rule capabilities:
  - `Condition = Comparison | And | Or | Not | FunctionCall | HasField | FieldOp` (recursive zod union)
  - `Action = SetField | RemoveField | RenameField | LookupValue | FunctionCallStatement | LetAssignment` (closed set covers Graylog's known action shapes)
  - `RuleSpec = {name, when: Condition, then: Action[]}` (matches `RuleDeclaration` grammar in `RuleLang.g4`)
  Larger surface than a "common patterns" subset; agents can stay in structured intent for any rule. Schema is recursive (zod supports it via `z.lazy`). Strict typing for every node type; closed set ensures the wrapper can always emit valid DSL.

### DSL escape safety (M3 mitigation step 1)

- **D-12:** `src/pipeline-dsl/escape.js` is the canonical escape helper — `escapeString(s)` emits a properly-quoted DSL string literal (`"foo\"bar"` for input `foo"bar`). ALL structured-intent code paths route emission through it. The server-side parse pre-flight (D-05) is the defence-in-depth backstop — if the escape helper has a bug, parse catches it before apply.
- **D-13:** The escape helper handles the full set of grammar-sensitive characters: `"` → `\"`, `\` → `\\`, control chars (`\n`, `\t`, etc.) → escape sequences. Refer to `source-code/graylog2-server/.../RuleLang.g4` for the authoritative character set; researcher confirms.

### delete_pipeline_rule cascade (PIPE-10, ROADMAP SC4)

- **D-14:** `delete_pipeline_rule` reuses Phase 3's cascade-hash + drift refusal pattern via `src/tools/_shared/cascade-hash.js`. Dry-run pre-flights `GET /system/pipelines` (and filters client-side for rules-referencing pipelines, OR uses a per-rule endpoint if Graylog exposes one — researcher confirms) and emits `cascades: {pipelines: [{id, title, stage: number}]}`. Hash inputs: `{ruleId, cascades: {pipelines: [...sortedIds]}}`. Apply re-fetches, recomputes, refuses with `reason: "cascade_changed_since_preview"` on drift. Same machinery as `delete_stream`.

### Pipeline lifecycle (PIPE-05)

- **D-15:** Pipelines have no `mutable: boolean` flag on the wire (verified: pipeline DTOs do not carry an `is_editable` field; pipelines are user-created, not seeded by Graylog defaults). D-09 mutable defense from Phase 3 does NOT apply to pipelines. Pipeline mutations rely solely on the Phase 0 writable-flag gate (D-07) + per-call `dryRun: true` default. Documented in tool descriptions.

### Partial-update pattern (PIPE-04, PIPE-09)

- **D-16:** `update_pipeline` and `update_pipeline_rule` follow whichever pattern the U1-style smoke surfaces for the pipeline domain in Plan 01 Task 1 (`STRICT_NO_ECHO` per Phase 3 outcome, OR `MERGE_FROM_CURRENT` per Phase 2 outcome). Pipeline source carries no encrypted fields, so `MERGE_FROM_CURRENT` is acceptable if the live API requires it. Research/smoke decides.

### Server-assigned IDs (pitfall C6, carried forward)

- **D-17:** `create_pipeline` and `create_pipeline_rule` dry-run previews use the `__SERVER_ASSIGNED__` sentinel for the not-yet-known IDs. Tool description warns agents not to reuse the placeholder ID across a multi-step flow (e.g., create rule → create pipeline that references the rule by id — agent must use rule NAME during planning, then ID after apply, or chain via `dependsOn` annotations).

### Schema-parity + auth-redaction carry forward

- **D-18:** Every Phase 4 tool MUST add `assertSchemaParityForTool(toolName, zodSchema)` in `test/schema-parity.test.js` (14 new assertions). The `confirmationToken` allowlist + structural FQCN recognition + `<…>` placeholder convention from Phase 1/2/3 auth-redaction lint all carry over — no per-fixture opt-in.

### Claude's Discretion

- **Discretion-01:** Module layout under `src/tools/pipelines/` + `src/pipeline-dsl/`. The pipeline-dsl module is shared between client-side validate.js + escape.js + structured-intent emitter + builtins.js — planner picks the exact file split.
- **Discretion-02:** Whether the structured-intent emitter lives in `src/pipeline-dsl/emit.js` or inline in `src/tools/pipelines/create-pipeline-rule.js`. Recommendation: shared module — `update_pipeline_rule` reuses it.
- **Discretion-03:** Whether `simulate_pipeline_rule` accepts the `structured` shape too (i.e., simulate-on-structured-intent). Recommendation: yes — the wrapper emits DSL via the shared emitter then forwards to simulate. Single agent flow: compose structured intent → simulate → tweak → apply.
- **Discretion-04:** How `list_pipeline_functions` represents the merged catalogue when live + static disagree on signature (live wins on name; what about argument order? signature string format?). Planner decides; document in tool description.
- **Discretion-05:** Snapshot fixture set — at minimum: create_pipeline_rule from structured intent (full DSL coverage), create_pipeline_rule from raw DSL with parse error (refusal), simulate_pipeline_rule success path, simulate showing post-rule message field change, delete_pipeline_rule with cascade hash + 2 referencing pipelines, connect_pipelines_to_stream dry-run, list_pipeline_functions overlay (live wins over static for one collision case). Planner refines.
- **Discretion-06:** Wave structure — given the pre-phase research deliverable + 14 tools + DSL infrastructure, this phase likely needs 5-6 plans (Phase 3 had 5 for 12 tools; Phase 4 has more DSL machinery). Planner sizes.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level

- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md` — PIPE-01..PIPE-12 (Phase 4 adds PIPE-13/14 via D-01)
- `.planning/ROADMAP.md` §"Phase 4" — goal + 4 success criteria + dependency on Phase 0 + Phase 3 + mandatory pre-phase research note
- `.planning/STATE.md`

### Prior phase outputs (the foundation this phase builds on)

- `.planning/phases/00-foundation/00-04-SUMMARY.md` — `defineMutatingHandler` / `defineListHandler` factory
- `.planning/phases/02-index-sets-retention/02-CONTEXT.md` — D-06 catalogue cache pattern (parallel to D-03 here)
- `.planning/phases/03-streams-stream-rules/03-CONTEXT.md` — D-02 keyed-buckets cascade hash (DIRECT precedent for D-14 here), D-05/D-06 3-bucket similarity (precedent for create_pipeline_rule duplicate detection if planner chooses), D-09 mutable defense (NOT applicable per D-15)
- `.planning/phases/03-streams-stream-rules/03-03-SUMMARY.md` — `delete_stream` C2 mitigation centerpiece (analog for delete_pipeline_rule D-14)
- `.planning/phases/03-streams-stream-rules/03-04-SUMMARY.md` — `test_stream_match` server-side pattern (analog for `simulate_pipeline_rule` D-07/D-08)
- `.planning/phases/03-streams-stream-rules/03-01-SUMMARY.md` — `src/tools/_shared/cascade-hash.js` (DIRECT reuse for D-14)

### Research outputs

- `.planning/research/PITFALLS.md` §C4 (drives D-02..D-06, D-10..D-13), §C6 (drives D-17), §M3 (drives D-07/D-08, D-11/D-12)
- `.planning/research/SUMMARY.md` (notes the mandatory pre-phase function-enumeration research)
- `.planning/research/ARCHITECTURE.md` — module layout for `src/pipeline-dsl/`
- `.planning/research/FEATURES.md`

### Live Graylog API touchpoints (verify against 7.0.6)

- `GET /system/pipelines` — list pipelines (PIPE-01)
- `GET /system/pipelines/{id}` — get pipeline (PIPE-02)
- `POST /system/pipelines` — create pipeline (PIPE-03)
- `PUT /system/pipelines/{id}` — update pipeline (PIPE-04)
- `DELETE /system/pipelines/{id}` — delete pipeline (PIPE-05)
- `GET /system/pipelines/rule` — list pipeline rules (PIPE-06)
- `GET /system/pipelines/rule/{id}` — get pipeline rule (PIPE-07)
- `POST /system/pipelines/rule` — create pipeline rule (PIPE-08); 200 response with full `RuleSource`
- `PUT /system/pipelines/rule/{id}` — update pipeline rule (PIPE-09)
- `DELETE /system/pipelines/rule/{id}` — delete pipeline rule (PIPE-10)
- `POST /system/pipelines/rule/parse` — pre-flight rule parser (D-05; PITFALLS C4)
- `POST /system/pipelines/parse` — pre-flight pipeline parser (D-06; researcher confirms path exists on 7.0.6)
- `POST /system/pipelines/rule/simulate` — simulate (PIPE-12, D-07/D-08; PITFALLS M3 mitigation step 2)
- `GET /system/pipelines/rule/functions` — function catalogue (PIPE-11, D-03)
- `PUT /system/pipelines/connections/to_stream` (or `POST /streams/{id}/connections`) — pipeline-stream connection (PIPE-13/14, D-01; researcher confirms exact path on 7.0.6)
- `source-code/graylog2-server/.../pipelineprocessor/RuleResource.java` (lines 155-182 for parse + simulate)
- `source-code/graylog2-server/.../pipelineprocessor/PipelineResource.java` (CRUD + parse)
- `source-code/graylog2-server/.../pipelineprocessor/PipelineStreamConnectionsResource.java` (for PIPE-13/14)
- `source-code/graylog2-server/.../pipelineprocessor/functions/` (~100 built-in classes; mandatory pre-phase enumeration)
- `source-code/graylog2-server/.../pipelineprocessor/parser/RuleLang.g4` (DSL grammar — drives D-12/D-13 escape character set)
- `source-code/graylog2-server/.../pipelineprocessor/parser/FunctionRegistry.java` (live registration mechanism — informs D-02/D-03 overlay strategy)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`defineMutatingHandler` / `defineListHandler`** — every Phase 4 tool is one of these two factory calls. All amendments (async build, `req.cascades`, `_confirmationToken` + `requireConfirm`) shipped across Phases 0/1/2/3.
- **`computeCascadeHash`** (`src/tools/_shared/cascade-hash.js`) — keyed-buckets canonicalization from Phase 3. Direct reuse for `delete_pipeline_rule` D-14 with `cascades: {pipelines: [...]}` bucket.
- **`findExistingMatches({listPath, matchFn})`** — Phase 0/1/2/3 helper with envelope unwraps for `index_sets`, `streams`. Likely needs `pipelines` envelope amendment in Plan 01 (researcher verifies).
- **`makeClient(connection).request(method, path, body, opts?)`** — single HTTP entry point.
- **Phase 3 `delete-stream.js`** — analog for delete_pipeline_rule cascade pre-flight (3 → 1 cascade endpoint, but the same hash + apply-time refusal pattern).
- **Phase 3 `test-stream-match.js`** — analog for simulate_pipeline_rule server-side delegation.
- **Phase 1 `update-input.js`** OR **Phase 1 `update-extractor.js`** — analog for D-16 partial-update (STRICT_NO_ECHO vs MERGE_FROM_CURRENT).
- **Phase 2's per-connection catalogue cache** (`src/tools/inputs/type-catalogue.js`) — pattern reused for `src/pipeline-dsl/function-catalogue.js` (D-03 cache).

### Established Patterns

- **Per-domain folder layout** — `src/tools/pipelines/` mirrors `src/tools/streams/`. `src/pipeline-dsl/` is shared infrastructure (builtins, validate, escape, emit).
- **`<verb>_<domain>_<noun>` naming** — `list_pipelines`, `get_pipeline`, `create_pipeline`, `update_pipeline`, `delete_pipeline`, `list_pipeline_rules`, `get_pipeline_rule`, `create_pipeline_rule`, `update_pipeline_rule`, `delete_pipeline_rule`, `list_pipeline_functions`, `simulate_pipeline_rule`, `connect_pipelines_to_stream`, `disconnect_pipelines_from_stream`. 14 tools total (12 from REQUIREMENTS.md + 2 from D-01).
- **STRICT_NO_ECHO partial-update** — pending U1-style smoke outcome.
- **Auth-redaction lint regex-level placeholder + structural FQCN recognition** — apply automatically to any new snapshots.
- **Schema-parity enrichment** — 14 new `assertSchemaParityForTool` calls.

### Integration Points

- New tools register through `src/tools/pipelines/index.js` → `src/tools/_register.js` → dispatch Map.
- `src/pipeline-dsl/` is the FIRST cross-tool-shared client-side validation module in the project. Future phases (event definitions with aggregation conditions?) may consume the same patterns.
- `connect_pipelines_to_stream` / `disconnect_pipelines_from_stream` consume Phase 3's stream IDs indirectly (the agent's flow: `list_streams` → `list_pipelines` → `connect_pipelines_to_stream`). No code-level cross-domain dependency.

</code_context>

<specifics>
## Specific Ideas

- **C4 acceptance gate fixture (mandatory in Plan 05):** create_pipeline_rule structured intent with one valid `to_upper` reference AND one invalid `toUpperCase` reference; first dry-run succeeds with valid `parseResult`, second dry-run surfaces `parseResult.error` with line/column. Two fixtures pin both paths.
- **M3 acceptance gate fixture:** simulate_pipeline_rule with a rule that sets a field; the post-rule message in the response shows the field change. Demonstrates the simulate-catches-semantic-bugs value proposition.
- **D-11 full DSL coverage proof:** structured intent fixture exercising all 6 condition node types (Comparison, And, Or, Not, FunctionCall, HasField) and at least 4 action types in one rule.
- **D-14 cascade-hash byte-identity:** two delete_pipeline_rule fixtures with different referenced-pipeline sets; hashes must differ. Same proof pattern as Phase 3 `delete_stream` Fixtures 5+6.
- **`src/pipeline-dsl/builtins.js`** is the mandatory pre-phase research deliverable — Plan 01 Task 1 likely. ~100 function entries hand-curated from `source-code/.../pipelineprocessor/functions/`. Each entry: `{name, signature, oneLineDescription, category}`.

</specifics>

<deferred>
## Deferred Ideas

- **~20 common rule pattern template library** (PITFALLS M3 mitigation step 4) — out of scope. Agents either compose structured intent or use raw DSL.
- **Auto-regeneration of `src/pipeline-dsl/builtins.js`** from Graylog source — hand-curated this phase; future iteration could parse the Java source.
- **Pipeline-source structured-intent emitter** — only pipeline RULE has structured intent in Phase 4. Pipeline SOURCE (PIPE-03) accepts raw DSL only. A future phase could add structured intent for pipeline source too.
- **Bulk pipeline-rule operations** — `create_pipeline_rules(rules[])` not in scope. Agent loops.
- **Live-fetched function catalogue auto-refresh** — D-03 cache is process-lifetime; no TTL or refresh trigger. A future phase could expose a `refresh_pipeline_function_catalogue` tool if drift becomes an issue.

</deferred>

---

*Phase: 04-pipelines-pipeline-rules-connections*
*Context gathered: 2026-05-15*
