# Domain Pitfalls — Graylog Admin Surface for AI-Agent Consumers

**Project:** Graylog MCP — Full Admin Surface
**Domain:** Wrapping a mutating REST admin API for an LLM caller, against a live Graylog 7.2 cluster
**Researched:** 2026-05-13
**Overall confidence:** HIGH (source-code-backed claims), MEDIUM (cross-version drift — read from changelog TOMLs and code annotations rather than running a v6 server)

## Scope

This document focuses on pitfalls that are **specific to (a) Graylog 7.2's admin endpoints, or (b) an LLM being the caller**. It does not re-litigate generic distributed-system or REST-client pitfalls. Where a pitfall is generic but the evidence-of-occurrence is Graylog-specific, the Graylog-specific evidence is cited.

Each pitfall has:

- **Symptom** — how the agent or operator first notices it
- **Root cause** — why Graylog or the agent loop produces it
- **Prevention** — concrete code- or design-level countermeasure (no "be careful")
- **Phase mapping** — which roadmap phase should land the countermeasure

Phase names referenced here are placeholders the orchestrator will reconcile against the actual ROADMAP.md it builds: **Phase 0 — Foundation** (dispatch refactor, dry-run primitive, zod adoption, registry plumbing), **Phase N — Domain phases** (Streams, Pipelines, Inputs/Extractors, Index sets, Dashboards, Events), **Phase F — Final hardening** (snapshot tests, tool-description tightening, v7-vs-v6 audit).

---

## Critical Pitfalls

Mistakes that cause data loss, silent divergence, or rewrites.

### C1. `delete_indices=true` is the default on index-set deletion

**Symptom:** Agent removes a "temporary test index set" and the user loses **all** historical messages in that index set's Elasticsearch indices, including ones the agent never reasoned about.

**Root cause:** `IndexSetsResource.delete` at `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog2/rest/resources/system/indexer/IndexSetsResource.java:380-411`:

```java
public void delete(@PathParam("id") String id,
                   @QueryParam("delete_indices") @DefaultValue("true") boolean deleteIndices)
```

The `@DefaultValue("true")` means if the agent issues `DELETE /system/indices/index_sets/{id}` without explicitly setting `?delete_indices=false`, Graylog kicks off `IndexSetCleanupJob` against the live Elasticsearch/OpenSearch cluster. The deletion is asynchronous (a system job) — the HTTP 204 returns immediately, the destruction continues in the background, and the agent will see "success" with no preview of what is gone.

**Prevention:**
1. The MCP wrapper for `delete_index_set` MUST require an explicit `deleteIndices: boolean` argument (no default), and the dry-run output MUST list, by name, every ES index that would be cleaned (call `GET /system/indexer/indices/{indexSetId}/list` first and include the response in the dry-run payload).
2. Additionally enforce: if `deleteIndices=true` and the listed indices contain any messages (use the stats from `GET /system/indices/index_sets/{id}?stats=true`), the tool returns a confirmation token that must be echoed back as `confirm: "<token>"` for the apply call to proceed. This is a second guardrail above the standard `dryRun: false` flip.
3. Default the **MCP tool**'s `deleteIndices` to `false` even though Graylog defaults it to `true`. The wrapper inverts the dangerous default.

**Phase mapping:** Phase 0 (dry-run primitive design — this is the canonical "dryRun must show side-effects, not just request shape" example) + Phase N — Index sets.

---

### C2. Stream deletion cascades silently to rules; pipeline connections become orphaned

**Symptom:** Agent deletes a stream, then a `list_pipelines` shows the pipelines still exist but their `connected_streams` field is shorter; alerting rules that used the stream as a source stop firing with no error.

**Root cause:** `StreamResource.deleteInner` at `StreamResource.java:418-432` calls `streamService.destroy(stream)`. The stream's rules are dropped at the database level (cascading on the Mongo `StreamRule` collection keyed by `streamId`). Pipeline-to-stream connections live in a separate collection (`PipelineStreamConnectionsService`) and are pruned by a different code path — but there's no atomic transaction; the agent sees only the 204 from the stream delete.

The deletion can also throw `StreamGuardException` (line 426) which is mapped to a 400 — but the message is "stream has X dependent things" with no enumeration. The agent will retry or give up without learning what depended on it.

**Prevention:**
1. Before any stream-delete tool emits the request in dry-run, call `GET /streams/{streamId}/pipelines` and `GET /streams/{streamId}/rules`, and `GET /events/definitions` filtered by stream id (event definitions reference streams). Include the discovered dependents in the dry-run output under `cascades: { stream_rules: [...], pipeline_connections: [...], event_definitions: [...] }`.
2. When the agent calls apply, the wrapper re-fetches the cascade list and **fails** if it grew since dry-run — refuse to delete with a "the world changed since you previewed" message. This is the only way to make dryRun→apply a safe pattern given the cluster is live.
3. Map `StreamGuardException` 400s into a structured error with `kind: "stream_has_dependents"` and the dependents enumerated (parse the message string; lossy but better than the raw 400).

**Phase mapping:** Phase 0 (cascade-preview pattern; reusable in pipeline and event-def deletes) + Phase N — Streams.

---

### C3. Encrypted input config fields will silently zero out on update

**Symptom:** Agent reads an input via `get_input`, edits `bind_address`, and calls `update_input` echoing the full config back. Next start the input fails to bind because the TLS cert password (encrypted field) is now empty.

**Root cause:** `InputsResource.update` at `InputsResource.java:491-522`. The merge logic at lines 503-509 is explicit:

```java
mergedInput.put(MessageInput.FIELD_CONFIGURATION,
    EncryptedInputConfigs.merge(origConfig, updatedConfig));
```

`EncryptedInputConfigs.merge` keeps the *original* encrypted value when the update payload contains the sentinel "redacted" placeholder, otherwise replaces it. If the agent reads via `GET /system/inputs/{id}` and naïvely posts back the same JSON, it sends the redacted placeholder string as a *value* — which `merge` interprets as either "keep" (if the placeholder is exactly the expected one) or "replace with this placeholder string" (if the agent's serialization dropped or transformed it). The behavior is "best case the agent gets lucky, worst case credentials silently wipe."

**Prevention:**
1. The MCP `update_input` tool MUST NOT accept a full-config blob. It MUST take a partial-update shape: `{ inputId, changes: { ...fields to change... } }`. The wrapper internally:
   - Calls `GET /system/inputs/{inputId}` to fetch current config.
   - Applies the changes to the non-encrypted fields only.
   - For encrypted fields, only includes them in the PUT payload if the agent explicitly passed a non-placeholder value.
2. Document in the tool description (top of agent's view) which input types have encrypted fields (TCP/TLS inputs, AWS inputs with credentials, syslog over TLS). Tool description is the agent's documentation.
3. Snapshot test: dry-run `update_input` with a no-op changes object against a fixture input that has encrypted fields → assert encrypted fields are **absent** from the emitted payload.

**Phase mapping:** Phase N — Inputs/Extractors. The partial-update pattern is reusable; document the precedent here.

---

### C4. Pipeline-rule DSL generation: agent invents function names

**Symptom:** Agent writes a rule like `then set_field("x", uppercase(some_field));` and gets a 400 from `POST /system/pipelines/rule` with `Unable to resolve function uppercase`. Or worse: the rule saves but at runtime in the pipeline processor throws `FunctionResolutionException` against every message that hits the rule — the agent never sees it because the failure is in Graylog's logs, not the create response. The actual function is `to_upper`.

**Root cause:** Graylog has ~100+ built-in functions registered via `FunctionRegistry` (`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/pipelineprocessor/parser/FunctionRegistry.java`). The names follow snake_case (e.g. `to_string`, `to_long`, `regex`, `grok`, `set_field`, `lookup_value`), but the LLM's training data is full of Java-style `toUpperCase`, JS-style `toUpper`, etc. The agent **will** invent plausible function names.

`POST /system/pipelines/rule/parse` (RuleResource.java:155-169) is a server-side validator that catches this — but only if the wrapper actually calls it before save.

**Prevention:**
1. Every rule-DSL-emitting tool (`create_pipeline_rule`, `update_pipeline_rule`, blueprints that generate rules) MUST call `POST /system/pipelines/rule/parse` as a pre-flight, **inside the dry-run output**. If parse returns a ParseException, the dry-run output surfaces `parseError: { line, column, message }` and the tool refuses to apply.
2. Cache `GET /system/pipelines/rule/functions` (returns function descriptors) at connection-init time. Use it as the basis for a `list_pipeline_functions` MCP tool the agent can call before composing rules — and inject the function list into the description of `create_pipeline_rule` (truncated by category if context-bloat-sensitive).
3. The parser also catches typoed field references (`message.surce` vs `source`), so the parse pre-flight is doubly valuable.

**Phase mapping:** Phase N — Pipelines (highest-priority deliverable; the dry-run-pre-flights-with-server pattern starts here and propagates).

---

### C5. Event aggregation conditions: v6→v7.1 silently changed syntax

**Symptom:** Agent (whose training data is from a v6 era) creates an event definition with `conditions: { expression: { type: "comparison", left: { type: "function", function: "count", parameter: "source" } } }`. On v7.1+, the function reference shape changed: parameters fold into the function name. Old: `count(source)`. New: `count_source`.

**Root cause:** `changelog/7.1.0-rc.1/pr-24703.toml`:
> Changed format of event aggregation conditions to use underscores instead of parentheses, e.g. 'count(source)' is now 'count_source'

This is a payload-shape change with no version negotiation header. The endpoint still accepts the v6 shape on some 7.1 paths but the aggregation evaluator can't resolve the function, so the event definition saves successfully and then never fires.

**Prevention:**
1. Pin the project to Graylog 7.2 (already decided in PROJECT.md). Document this format explicitly in the `create_event_definition` tool description with a worked example.
2. Provide a `_convert_v6_event_aggregation` helper at the wrapper level: if the agent passes the old `count(field)` form, translate it to `count_field` and emit a warning in the dry-run output (`{ migrated_from_v6_shape: true, original: "...", emitted: "..." }`). Do NOT silently rewrite — surface the change.
3. Snapshot test: emit dry-run for an event definition with the new shape; pin the expected payload byte-for-byte.

**Phase mapping:** Phase N — Events (the migrate-from-v6 helper is event-specific; the general "pin the version, snapshot the payload" pattern belongs in Phase 0).

---

### C6. Dry-run lies because the server assigns the ID

**Symptom:** Agent dry-runs `create_extractor`, sees `{ extractor_id: "<dry-run-placeholder>" }`, then applies and gets `{ extractor_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479" }`. Later it tries to look up the extractor by the placeholder ID and 404s. Multiplied across blueprints (extractor → rule → pipeline connection), this cascades into broken multi-step flows.

**Root cause:** Server-assigned IDs are pervasive in Graylog:
- Stream IDs: `streamService.saveWithRulesAndOwnership(...)` returns the assigned ID (`StreamResource.java:241`).
- Stream-create response: `Response.created(streamUri).entity(new StreamCreatedResponse(id)).build()` — ID exists only after `save`.
- Extractor IDs: `final String id = new com.eaio.uuid.UUID().toString()` (`ExtractorsResource.java:128`) — **generated client-side in the resource handler**, but the agent's MCP wrapper has no way to know that ID before calling.
- Event-definition IDs: returned from `eventDefinitionHandler.create(dto, ...)` on a 200 response.
- View (dashboard) IDs: `dbService.saveWithOwner(dto.toBuilder().owner(...).build(), user)` returns the ID.

**Prevention:**
1. Distinguish two kinds of dry-run output:
   - **`emittedPayload`** — the exact JSON that *would* be POSTed (deterministic, snapshot-testable).
   - **`postApplyEstimate`** — the response shape with `<server-assigned>` placeholders for fields the server fills in (ids, timestamps, audit URIs). Mark these clearly with a sentinel like `{ id: "__SERVER_ASSIGNED__" }`.
2. For blueprint tools that chain calls (e.g. `setup_error_stream_for_app` = create stream → create rule → connect pipeline), dry-run returns the **sequence of payloads** with explicit `dependsOn: { from: "step1.response.id", as: "streamId" }` annotations so the agent (and the user reviewing the preview) sees the chaining.
3. On apply, the wrapper substitutes each server-assigned ID into subsequent payloads as it goes, and returns a transcript: `[{ step, request, response }, ...]`. If any step fails, the transcript shows where.

**Phase mapping:** Phase 0 (dry-run primitive shape — this is *the* primary design constraint), Phase N — Blueprints (chained-ID substitution).

---

### C7. Dashboard creation requires a pre-saved Search; widget IDs must match widget-position IDs

**Symptom:** Agent tries to `create_dashboard_with_widgets` in one call. Tool emits a `POST /views` and gets `400 BadRequest: Search <abc123> not available`. Agent retries, eventually figures out it needs to create a Search first, but the agent's two-step retry produces an orphan Search if step 2 fails.

**Root cause:** `ViewsResource.create → createView → validateIntegrity` (`ViewsResource.java:294-328`) requires:

```java
final Search search = searchDomain.getForUser(dto.searchId(), searchUser)
    .orElseThrow(() -> new BadRequestException("Search " + dto.searchId() + " not available"));
```

The dashboard (`ViewDTO`) carries `searchId` referencing a pre-existing `Search` entity. `validateSearchProperties` (lines 329-379) then asserts:
- `dto.state().keySet()` ⊆ `search.queries().map(Query::id)` (state query IDs must match search query IDs)
- widget search-types referenced in `widgetMapping` ⊆ the search's `searchTypes`
- `widgetPositions.keySet()` ⊇ `widgets.map(WidgetDTO::id)` (every widget needs a position, no orphans)

A handcrafted dashboard payload that fails any of those three constraints returns 400 with a useful-but-cryptic error like "Widget positions don't correspond to widgets, missing widget positions [w-123]; widget IDs: [w-123, w-456]; widget positions: [w-456]".

**Prevention:**
1. `create_dashboard` MUST be a two-step blueprint, even in single-tool form: internal step 1 creates the Search via `POST /views/search`, step 2 creates the View. Return the chained transcript per C6. Never expose a `create_dashboard` that takes a `searchId` parameter — let the wrapper own the linkage.
2. Widget-template library generates Search-query-fragments AND widget-position-fragments together. Each template is a `{ widget, position, searchType }` triplet so the dashboard composer cannot produce mismatched sets.
3. Client-side validator before emitting: check `widgetPositions.keys() == widgets.map(id)` and reject with a clear error before the request is sent. Saves a round-trip and gives the agent a better error to reason about.
4. Time-range desync: each widget has its own `timerange` field; the dashboard has a global time-range too. Widget time ranges override. Templates default widget time ranges to **inherit-from-dashboard** (omit the field) unless the user/agent explicitly opted into a per-widget override.

**Phase mapping:** Phase N — Dashboards. The "blueprint owns the chain, agent never sees IDs" pattern documented here is reusable for the blueprint layer.

---

## Moderate Pitfalls

### M1. Event-definition `?schedule=true` default starts processing immediately

**Symptom:** Agent creates an event definition with dry-run preview that looked harmless, applies it, and now Graylog is running it on every message — including across historical indices if the parameters specify a backfill timerange.

**Root cause:** `EventDefinitionsResource.create` (lines 314-333) takes `@QueryParam("schedule") @DefaultValue("true") boolean schedule`. The default-true is benign for a human in the web UI (you typically *want* the alert to start firing) but for an LLM iterating on configurations, it means every preview-then-apply cycle puts a new live event into rotation.

The same default is on `update` (line 344) — toggling any field also re-enables scheduling.

**Prevention:**
- The MCP `create_event_definition` tool defaults `schedule: false`. Agent must explicitly opt in. Update follows the same.
- The dry-run output explicitly states: `wouldStartScheduling: true|false`.
- Provide an `enable_event_definition` / `disable_event_definition` pair (wraps `PUT /events/definitions/{id}/schedule|unschedule` — note `@Consumes(WILDCARD)` on those endpoints, lines 422 and 453 — empty body OK).

**Phase mapping:** Phase N — Events.

---

### M2. Stream/event/view/index-set create returns inconsistent status codes & shapes

**Symptom:** Agent code that assumes `201 + Location + { id: ... }` works for streams, breaks for event definitions. Code that assumes a flat ID-only response works for streams, breaks for dashboards (full DTO back).

**Root cause:** Survey of the create endpoints:
| Endpoint | Status | Body |
|---|---|---|
| `POST /streams` | **201** | `{ stream_id }` + `Location` header (StreamResource.java:243) |
| `POST /events/definitions` | **200** | Full `EventDefinitionDto` (line 332) |
| `POST /views` | **200** | Full `ViewDTO` |
| `POST /system/inputs` | **201** | `{ id }` + `Location` (InputsResource.java:450) |
| `POST /system/indices/index_sets` | **200** | Full `IndexSetResponse` (line 284-286) |
| `POST /system/inputs/{inputId}/extractors` | **201** | `{ extractor_id }` + `Location` (ExtractorsResource.java:148) |
| `POST /streams/{streamId}/rules` | **201** | `{ streamrule_id }` |
| `POST /system/pipelines/rule` | **200** | `RuleSource` (full body) |
| `POST /events/definitions/{id}/duplicate` | **200** | Full `EventDefinitionDto` |
| `PUT /system/inputs/{id}` | **201** | (note: PUT returning 201 — confusing) `{ id }` + Location |

**Prevention:**
- Wrap response normalization in a single helper that returns `{ id, body }` regardless of where the ID lives (Location header, response body field, full DTO). The helper documents the per-endpoint inconsistency in one place.
- Snapshot test the create-response normalizer per resource type — fixture each variant.

**Phase mapping:** Phase 0 — Foundation (the response normalizer is cross-cutting).

---

### M3. Pipeline rule DSL: string escaping, type coercion, `then` block semantics

**Symptom:** A rule like `when has_field("user.name") then set_field("u_n", $message.user.name);` fails because `.` is parsed as field-traversal, not as part of an identifier. Or a rule sets `set_field("count", to_string($message.count))` and downstream pivot aggregations break because the field is now a string. Or the agent emits `when contains(to_string($message.size), "1024") then ...` thinking `contains` is a Boolean test of substring — it is, but the rule will fire on every message where `size` contains `1024` as a substring (incl. `10240`, `102400`).

**Root cause:** Three different agent-DSL traps stacked:

1. **Escaping.** The pipeline rule grammar is in `source-code/graylog2-server/graylog2-server/src/main/antlr4/org/graylog/plugins/pipelineprocessor/parser/RuleLang.g4`. String literals are double-quoted; embedded `"` must be `\"`, and `\` must be `\\`. The agent will produce raw user-provided strings inline. Same risk shape as the unescaped Lucene query bug already flagged in CONCERNS.md.

2. **Type coercion.** Graylog distinguishes `long`, `double`, `string`, `boolean`. Comparison operators (`==`, `<`, `>`) in the rule language don't auto-coerce in all directions; `"5" == 5` evaluates differently from `5 == 5`. Functions like `to_long`, `to_double`, `to_string` are explicit but easy to forget.

3. **`then` block semantics.** The grammar says: `ruleDeclaration: Rule name=String When condition=expression (Then actions=statement*)? End`. The `then` block runs **only if the `when` evaluates truthy**. The agent's mental model from imperative languages may be "the `then` is a continuation" — it is not. Crucially, a `when` condition like `has_field("x") && to_long($message.x) > 100` will short-circuit on missing field; an agent that splits this into `when has_field("x") then if to_long(...) > 100 then ...` will discover that pipeline rules have no `if` statement (only function calls and `let` assignments).

**Prevention:**
1. **Parse pre-flight** (already specified in C4) catches escaping errors and structural errors. This is the primary defense.
2. Provide a `simulate_pipeline_rule` MCP tool that wraps `POST /system/pipelines/rule/simulate` (RuleResource.java:171-182) — the agent can simulate against a sample message before saving. **This is uniquely valuable because the simulator catches semantics bugs the parser can't**: type-coercion errors at runtime, unintended field-collision in `set_field` overwriting an existing field, etc.
3. Provide a `generate_pipeline_rule_dsl` helper that takes structured input (`{ when: { type: "has_field", field: "x" }, then: [{ type: "set_field", target: "y", value: { source: "x" } }] }`) and emits the DSL string with correct escaping. Agent prefers structured input; the wrapper owns string assembly. Documented in tool description: "If you have a structured intent, use `generate_pipeline_rule_dsl`; only emit raw DSL if you need a function the structured form doesn't cover."
4. The agent's rule template library should include each of the ~20 common patterns (route to stream by field, drop noisy events, enrich from lookup table, normalize timestamp) as canned generator inputs so most rules never go through agent-authored DSL at all.

**Phase mapping:** Phase N — Pipelines.

---

### M4. Agent loop: idempotency — retried creates produce duplicates

**Symptom:** Agent calls `create_stream({ title: "App Errors" })`; transient network error mid-response; agent retries; two streams named "App Errors" now exist with different IDs. Subsequent `list_streams` returns both; agent picks one (the "first"), starts attaching rules. Half the rules go to the wrong stream.

**Root cause:** Graylog stream create has no application-level idempotency key. `StreamResource.create` (lines 218-253) assigns the ID server-side and Mongo's uniqueness constraint is on `_id`, not on `title`. Duplicate titles are explicitly allowed.

**Prevention:**
1. Every create-tool MUST take an optional `idempotencyKey: string` parameter. The wrapper, on apply:
   - List existing entities of that type, find any tagged with `{ "mcp_idempotency_key": "<key>" }` in their metadata or description.
   - If found, return that entity instead of creating a new one. Mark the response `{ idempotent: true, existing: true }`.
   - If not found, create and tag it.
2. Where Graylog has no metadata slot (most cases), encode the key in the description field with a fixed prefix `[mcp:idem:abc123]`. Ugly, but works without schema changes.
3. The MCP-level **dispatch layer** auto-generates an idempotency key from a hash of `(connection, tool name, normalized args)` when the agent omits one. The default-on idempotency catches retries the agent didn't realize were retries.
4. Document the tag-prefix in `list_*` tool descriptions: "Entities created by this MCP carry `[mcp:idem:...]` in their description; this is metadata, not user content."

**Phase mapping:** Phase 0 — Foundation (the idempotency primitive is cross-cutting; every domain phase inherits it).

---

### M5. Agent loop: listing-before-creating is skipped under context pressure

**Symptom:** Agent's context window is full, so it skips the `list_streams` call before `create_stream`. Now there are two "App Errors" streams (or, worse, an "App Errors" stream and an "App errors" stream — case-different).

**Root cause:** Pure LLM-loop behavior. The agent's heuristic is "create what was asked for"; the disciplined "list first" step is the kind of thing that gets dropped when the context window is under pressure or when the agent's plan compressed multiple actions.

**Prevention:**
1. The `create_*` tools internally call list-then-check **before emitting the dry-run output**. The dry-run output explicitly states: `existingMatches: [{ id, title, similarity_reason: "exact match" | "case-different" | "prefix" }]`. The agent now sees the conflict in its preview without having to have called list first.
2. Add a `conflict_policy` argument: `"fail" | "rename" | "reuse_existing"`. Default `"fail"` for creates; `"reuse_existing"` is the implicit semantic of idempotency-key path; `"rename"` auto-appends ` (2)`, ` (3)` etc.
3. The list-then-check is cheap (one extra GET per create) and prevents an entire class of agent error.

**Phase mapping:** Phase 0 — Foundation (uniform create-conflict policy primitive).

---

### M6. Token consumption: list responses balloon the agent's context

**Symptom:** A cluster with 200 streams and 100 pipelines is normal. `list_streams` returns ~500 tokens per stream (id, title, description, rules array, creator, timestamps, default index set, etc.). One call returns ~100KB of JSON — eats the context budget for the rest of the agent's work, and the agent has no way to skip fields it doesn't need.

**Root cause:** The default Graylog list responses are dense. `StreamListResponse` (StreamResource.java:299-305) returns the full `Stream` object including embedded rules. The MCP currently wraps responses with a single `JSON.stringify` (per CONCERNS.md, line 47).

**Prevention:**
1. Every list tool MUST default to a **projection**: `id, title, description` only. Add a `fields` argument: agent opts in to `"all"` or a specific list. Default-deny on everything else.
2. Every list tool MUST default to a small `limit` (25) and require explicit `limit` to go higher. Pagination is exposed (page/per_page parameters from Graylog).
3. For deep details, the agent uses `get_<entity>(id)` — single-entity reads with full body. Pattern: list-with-projection finds candidates, single-get loads detail.
4. Tool description includes a quantitative hint: "default returns ~50 tokens per stream; use `fields:'all'` for ~500 tokens per stream."

**Phase mapping:** Phase 0 — Foundation (projection helper) + every read-shaped tool.

---

### M7. Agent loop: tool discovery breaks down beyond ~30 tools

**Symptom:** With ~80 tools total (27 existing + ~50 new), the agent picks `update_stream` when it should have used `pause_stream`, or invokes `list_pipeline_rules` when it should have used `list_pipelines`. The mental model "find the right tool" gets noisier as the catalogue grows.

**Root cause:** LLM tool selection scales sublinearly with catalogue size; tool *descriptions* compete for the agent's attention. The MCP protocol passes the full tool list with every request — descriptions live in the context window.

**Prevention:**
1. **Naming convention:** every tool name is `<verb>_<domain>_<noun>` where verb ∈ `{list, get, create, update, delete, enable, disable, simulate, validate, connect, disconnect}` and domain ∈ `{stream, pipeline, rule, input, extractor, index_set, dashboard, widget, event_def, event_notification, blueprint}`. The agent learns the schema instead of 80 individual names.
2. **Descriptions are budgeted:** ≤2 sentences per tool, ≤200 chars. The first sentence is what it does; the second is "when to use this vs. the obvious alternative." Tools without a discrimination second-sentence are red flags.
3. **Provide a meta-tool** `list_admin_tools(domain?)` that returns a brief inventory grouped by domain. Agent calls this once at the start of a session if it needs to orient. Avoids the cost of fitting all 80 descriptions in every system prompt.
4. **Blueprint catalogue is separate** from CRUD primitives: `list_blueprints()` returns the curated set with a one-line "what it does" per blueprint. CRUD tools are not in that list; they're discovered via the naming convention.
5. Pre-merge gate: read the tools.js diff and confirm every new tool has a discrimination sentence. Trivial automated check, prevents description bloat.

**Phase mapping:** Phase F — Final hardening (tool-description audit at the end, when the full catalogue is known) + every phase enforces the naming convention.

---

## Backward-Compat Risks: v2.3 Read Tools on Graylog 7.2

The PROJECT.md requires verifying existing read tools still work on v7.2 (no refactors, just fix what's broken). Based on the changelog TOMLs and code annotations, these are the highest-risk endpoints to audit. Each entry lists the specific risk and a fast verification path.

| Endpoint / Behavior | v7 Risk | How to verify |
|---|---|---|
| `GET /api/streams` (used by `fetchStreams`, query.js:85) | Marked `@Deprecated` in StreamResource.java:297. The non-deprecated path is `/api/streams/paginated`. The bare endpoint still works in 7.2 but may go away. Response shape: `StreamListResponse { total, streams: [...] }`. | Smoke test: hit `/api/streams` against 7.2, assert shape unchanged. Plan a follow-up: migrate to `/paginated` next milestone. Not blocking. |
| `POST /api/views/search/sync` (search backbone) | OpenSearch client migration (changelog/7.1.0-rc.1/pr-25390) — internal storage layer changed. Aggregation result shapes are most at risk. The 4-fallback chain in `getLogHistogram` (CONCERNS.md) is precisely the kind of code that quietly accommodates such changes by accident. | Run all four histogram fallbacks individually against 7.2 (not the union). At least one is likely to have changed its trip points. |
| Stream rule POST/PUT payload | `changelog/7.1.0-rc.1/issue-25609.toml`: "Fix stream rule update request payload". Implies the payload shape was buggy and was fixed in 7.1. v2.3 doesn't currently mutate stream rules (read-only), but the milestone adds CRUD → use **only** the post-7.1 payload shape from the current source (`CreateStreamRuleRequest` in `streams/rules/requests/`). | Read `CreateStreamRuleRequest.java`; do not rely on any blog post or older Swagger doc for payload shape. |
| `whitelist` → `allowlist` rename (v7.0, changelog issue-21034) | Anywhere v2.3 reads a stream rule's `"whitelist"` field, or any URL allowlist field on outputs/notifications, will return `"allowlist"` on v7. v2.3 doesn't appear to consume these fields, but verify. | grep src/ for `whitelist` — none expected; document expected absence. |
| Event aggregation conditions (changelog 7.1 pr-24703) | `count(field)` → `count_field`. v2.3's `events.js` is read-only on event definitions (`fetchEventDefinitions`), so reading a v7 event def returns the new shape — agent reading the description string gets the new form. New writes (this milestone) must use the new form. | Existing read tools are fine. Document the shape change in `create_event_definition` description. |
| Audit-event side-effects | Most v2.3 endpoints are `@NoAuditEvent`. Most new admin endpoints are `@AuditEvent(type = ...)`. Audit events are a side-effect of writes even when the user didn't ask for them — agent should know that every admin call writes to the Graylog audit log. | Not a breakage. Worth noting in MCP top-level documentation: "every admin mutation produces an audit-log entry on the Graylog server, even dry-run=false single calls; this is by design and is the operator's primary visibility into agent actions." |
| `GET /api/events/definitions` pagination | Resource defines both `/paginated` (line 188) and a deprecated bare `GET` (line 247-250, `@Deprecated`). v2.3 uses the deprecated path. Same migration story as streams. | Smoke test: hit current path on 7.2. Migrate next milestone. |
| `GET /api/events/notifications` | Listed in INTEGRATIONS.md as v2.3's path. Verify against 7.2 EventNotificationsResource; format may have added fields (additive is fine, removed fields are not). | Smoke test, assert shape contains expected fields. |

**Confidence:** MEDIUM. Drawn from changelog TOMLs and code annotations in the 7.2.0-SNAPSHOT source. Not validated against a running v6 instance — that's the verification phase's job.

---

## Test-Coverage Pitfalls

The CONCERNS.md flags that `npm test` is broken (references nonexistent `test-server.js`), there's no runner, and four ad-hoc test scripts live at the repo root. Adding ~50 mutating tools to this surface is the highest test-debt-creation event in the project's history. The choices below are about *what is non-negotiable vs nice-to-have*.

### Non-negotiable

1. **Dry-run snapshot tests for every mutating tool.** Each tool's dry-run output for a fixed fixture argument set is byte-compared against a checked-in snapshot. This catches: agent-perceived payload drift, accidental field name changes, accidental side-effect-on-dry-run bugs. Node 22's stable `t.snapshot()` is the recommended primitive (per STACK.md). Without snapshot tests, dry-run as a safety primitive is unverifiable.

2. **Schema validation tests for every zod schema.** For each tool, a `valid_inputs.json` and `invalid_inputs.json` fixture set. The test asserts the schema accepts/rejects as expected. Catches schema drift when the tool description changes but the schema doesn't (or vice versa).

3. **Blueprint composition tests.** For each blueprint (e.g. `setup_error_stream_for_app`), the test runs dry-run, walks the chained step list, asserts each step references the previous step's `__SERVER_ASSIGNED__` IDs correctly, asserts the cumulative payload sequence is what the snapshot expects. Catches composition bugs that wouldn't show up in single-tool tests.

4. **Stream/pipeline/dashboard cascade-detection tests.** Mock `GET /streams/{id}/pipelines` returning N connected pipelines; assert `delete_stream` dry-run output includes them. Mock the empty case; assert the output says `cascades: { pipeline_connections: [] }` explicitly (no missing-field ambiguity).

### Nice-to-have

5. **Round-trip integration tests against a Docker-Compose Graylog.** Slow, fragile (Graylog container is heavy). Only run on demand, not in the dev loop. Value: catches the "Graylog rejected our payload" failures that snapshot tests can't.

6. **Property-based tests on rule-DSL generation.** Feed structured inputs to `generate_pipeline_rule_dsl`, assert `POST /system/pipelines/rule/parse` accepts the output. Requires a live Graylog connection; not worth the infra investment until M3 patterns prove they cause real bugs.

7. **Coverage report (c8).** Useful for finding untested branches but adds friction. Recommend post-MVP.

**Anti-pattern to avoid:** **do not write tests that mock the entire Graylog response.** The fallback-chain story (CONCERNS.md histogram section) is what happens when mocked tests pass while reality drifts. Test the payload **generation** end (snapshot tests) and the schema **validation** end thoroughly; trust Graylog's behavior to the integration test layer instead of recreating it in unit-test mocks.

**Phase mapping:** Phase 0 — Foundation lands the snapshot infrastructure and the first 5-10 snapshot tests (proves it works). Every domain phase MUST add snapshot tests for its new tools as part of the phase, not as cleanup at the end. Phase F runs the coverage audit.

---

## Minor Pitfalls

### m1. `checkNotEditableStream` — some streams reject mutations

**Symptom:** Agent tries to update or delete the built-in `All messages` stream. 400 BadRequest "The stream cannot be edited."

**Root cause:** `StreamResource.update` (line 395) and `delete` (line 420) both call `checkNotEditableStream(streamId, ...)`. Built-in streams (default stream, Illuminate streams, all-events) are protected.

**Prevention:** List tools surface a `mutable: boolean` field per stream so the agent can filter. Don't try to delete what you can't delete.

**Phase mapping:** Phase N — Streams.

---

### m2. `setDefault` index set requires `isRegularIndex`

**Symptom:** Agent tries to set an events-stream-style index set as default. 409 Conflict.

**Root cause:** `IndexSetsResource.setDefault` (line 359-361) — only "regular" index sets are eligible.

**Prevention:** List index sets exposes the `isRegularIndex` field; the tool description for `set_default_index_set` says "only regular index sets are eligible; check `regular: true` on the target."

**Phase mapping:** Phase N — Index sets.

---

### m3. Deflector cycle is destructive of the current write index

**Symptom:** Agent calls `POST /system/deflector/cycle` to "rotate" an index, expecting a no-op equivalent of "open a new index." Instead the current write index closes; in-flight writes can fail until the new index is ready.

**Root cause:** `DeflectorResource.cycle` (`source-code/.../resources/system/DeflectorResource.java:89-106`) calls `indexSet.cycle()` — closes the current write index, creates the next one. Brief gap.

**Prevention:** The MCP tool description for any "rotate index" wrapper must include: "this momentarily closes the current write index; in-flight messages buffer." Don't expose this as a default action in any blueprint.

**Phase mapping:** Phase N — Index sets.

---

### m4. `MediaType.WILDCARD` on enable/disable endpoints

**Symptom:** Agent's MCP client always sets `Content-Type: application/json`; on `PUT /events/definitions/{id}/schedule`, Graylog accepts. But the agent constructs a JSON body too, thinking it must — the body is ignored, but the agent wastes context.

**Root cause:** `EventDefinitionsResource.schedule|unschedule` etc. set `@Consumes(MediaType.WILDCARD)` (lines 422, 453) — they accept any content type and ignore the body.

**Prevention:** Wrapper for `enable_event_definition` / `disable_event_definition` sends an empty body, no Content-Type. Document the no-body convention so blueprint code doesn't drag a fake body through.

**Phase mapping:** Phase N — Events.

---

### m5. Async system jobs return 204 immediately but work continues

**Symptom:** Agent deletes an index set with `delete_indices=true`, gets 204 back, immediately tries to confirm the indices are gone via `GET /system/indexer/indices/...` — they're still there because the cleanup job is mid-flight.

**Root cause:** `IndexSetsResource.delete` (line 398): `systemJobManager.submit(indexSetCleanupJobFactory.create(indexSet))`. The HTTP response returns before the job finishes. Job progress is observable via `GET /system/jobs`.

**Prevention:**
- Where the MCP tool's effect is implemented as a system job (currently: index-set delete with index cleanup; index ranges rebuild on index reopen/close/delete), the tool returns `{ async: true, job_id_observable_at: "/system/jobs" }` and the response *does not* claim the work is complete.
- Provide an `await_system_job` tool that polls `GET /system/jobs/{jobId}` until completion. Document it as the canonical way to wait.

**Phase mapping:** Phase N — Index sets (the first encounter); Phase 0 documents the async-pattern primitive.

---

### m6. `cloneStream` and `duplicate` event-definition create NEW IDs

**Symptom:** Agent uses `cloneStream` as a shortcut for "set up another stream like this one." Then tries to update the source stream's rules and expects them to propagate to the clone. They don't — clone is a snapshot at clone-time.

**Root cause:** `StreamResource.cloneStream` (line 606) builds a fresh `StreamImpl` with `new ObjectId().toHexString()`. `EventDefinitionsResource.duplicate` (line 516) goes through `eventDefinitionHandler.duplicate(...)`.

**Prevention:** Tool descriptions for `clone_*` tools explicitly state "creates an independent copy at clone-time; does not maintain linkage to source." Cheap line of documentation, catches the agent's mental model error.

**Phase mapping:** Phase N — Streams, Events.

---

## Phase-Specific Warnings (Concise Roll-Up)

| Phase | Top pitfall to address before the phase ships | Reference |
|---|---|---|
| Phase 0 — Foundation | Dry-run primitive must include side-effect preview, not just emittedPayload. Establish server-assigned-ID sentinel. Build idempotency-key dispatch wrapper. Land snapshot-test infrastructure. | C1, C2, C6, M2, M4, M5, M6, M7 |
| Phase N — Streams | Cascade preview (rules, pipelines, event defs); built-in-stream protection; idempotency by title-hash. | C2, m1, m6 |
| Phase N — Pipelines | `POST /pipelines/rule/parse` pre-flight in every dry-run; `simulate_pipeline_rule` MCP tool; structured-input DSL generator; cached function-registry. | C4, M3 |
| Phase N — Inputs/Extractors | Partial-update for inputs that protects encrypted fields; server-assigned extractor ID surfaced clearly. | C3, C6 |
| Phase N — Index sets | Invert `deleteIndices` default; surface system-job async; reject delete of default index set explicitly. | C1, m2, m3, m5 |
| Phase N — Dashboards | Search-then-View two-step blueprint; widget-template triplet (widget+position+searchType); time-range default to inherit. | C7 |
| Phase N — Events | `schedule:false` default; v6→v7 aggregation syntax migrator with warning; `enable`/`disable` separate tools using WILDCARD body. | C5, M1, m4 |
| Phase F — Final hardening | Tool-description audit (≤200 char, discrimination sentence); v7-vs-v6 endpoint regression smoke tests on existing v2.3 tools; coverage report. | M7, "Backward-Compat Risks" section |

---

## Sources

- **Local Graylog 7.2.0-SNAPSHOT source** (`source-code/graylog2-server/`):
  - `StreamResource.java` — stream CRUD, cascading delete, clone, testMatch, pause/resume, bulk operations
  - `StreamRuleResource.java` — stream-rule CRUD nested under stream
  - `IndexSetsResource.java` — index-set CRUD; the `delete_indices=true` default; default-index protection
  - `IndicesResource.java` — physical-index reopen/close/delete; write-index protection
  - `DeflectorResource.java` — manual index rotation/cycle
  - `InputsResource.java` — input CRUD; encrypted-config merge; routing-rule listing
  - `ExtractorsResource.java` — server-assigned extractor UUIDs
  - `EventDefinitionsResource.java` — event-def CRUD; `schedule` query default; `/validate` and cron-validate endpoints; bulk-schedule/unschedule
  - `EventNotificationsResource.java` — referenced for v2.3 read-side compat audit
  - `ViewsResource.java` — dashboard (View) CRUD; Search-link validation; widget-position integrity
  - `RuleResource.java` (pipelineprocessor) — rule CRUD; **`/parse` and `/simulate` endpoints** that the wrapper should leverage; function-descriptor registry endpoint
  - `PipelineResource.java` — pipeline CRUD
  - `PipelineConnectionsResource.java` — pipeline-to-stream connection management
  - `RuleLang.g4` (ANTLR) — pipeline rule grammar canonical reference
- **Local changelog TOMLs:** `changelog/7.0.0-rc.1/` and `changelog/7.1.0-rc.1/` — `pr-24703` (event aggregation syntax), `issue-25609` (stream rule update payload), `issue-21034` (whitelist→allowlist), `pr-23872` (Swagger 2 → OpenAPI 3.1), `pr-25390` (OpenSearch client migration)
- **In-repo project context:** `.planning/PROJECT.md`, `.planning/codebase/CONCERNS.md`, `.planning/codebase/INTEGRATIONS.md`, `.planning/codebase/STRUCTURE.md`, `src/query.js`

**Confidence summary:**

| Claim category | Level | Reason |
|---|---|---|
| Endpoint shapes (status codes, payloads, defaults) | HIGH | Read directly from JAX-RS-annotated Java source at known file:line |
| Side-effect behaviors (cascades, async jobs, encrypted-field merge) | HIGH | Code paths traced from resource method to service implementation reference |
| v6→v7 specific changes | MEDIUM | Drawn from changelog TOMLs; not validated against a running v6 cluster (which the project doesn't have access to). Confidence is high *for changes mentioned in the changelog*; unknown for changes that weren't recorded there |
| Agent-loop pitfalls (M4, M5, M6, M7) | MEDIUM-HIGH | Based on known LLM behaviors; specifics (token counts, naming-convention impact) are well-supported by community evidence but not pinned to a single citation |
| Pipeline-rule DSL semantics (M3) | HIGH | Grammar file is authoritative; function names cross-referenced with FunctionRegistry endpoint |
