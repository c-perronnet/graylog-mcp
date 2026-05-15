---
phase: 03-streams-stream-rules
plan: 04
subsystem: api
tags: [streams, stream-rules, create-stream-rule, update-stream-rule, delete-stream-rule, test-stream-match, d-07-server-side, d-08-streamid-required, d-09-mutable, d-11-eight-variants, d-14-strict-no-echo, pitfall-s8-type-from-current, pitfall-s9-numeric-translation, pitfall-s10-empty-string-defaults, pitfall-s12-leaf-delete-still-owes-mutable, discretion-04-leaf-delete, match-input, intersection-with-discriminated-union]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: defineMutatingHandler (D-07 writable gate + dryRun default + __SERVER_ASSIGNED__ + idempotency + normalize + requireConfirm gate + isError pass-through), makeClient, GraylogValidationError, toIdBody, mutatingBase
  - phase: 01-inputs-extractors/01-04
    provides: per-variant strict typing precedent (CreateExtractorSchema's discriminated-union pattern adapted here for create_stream_rule's 8-variant union); leaf-delete pattern (delete_extractor.js shipped Plan 01-04 — build returns descriptor WITHOUT a `cascades` key; the structural template for delete_stream_rule)
  - phase: 03-streams-stream-rules/03-01
    provides: src/tools/streams/schemas.js Plan 01-02-03 superset (StreamRuleSchema 8-variant union + STREAM_RULE_TYPE_TO_NUMERIC frozen wire map + mutatingBase patterns); 03-U1-SMOKE.md UNREACHABLE_STRICT_NO_ECHO decision locking STRICT_NO_ECHO for update_stream_rule (with the CreateStreamRuleRequest.type non-nullable Java int caveat documented inline)
  - phase: 03-streams-stream-rules/03-02
    provides: STREAM_RULE_TYPE_TO_NUMERIC already in schemas.js (Plan 02 ship); StreamRuleSchema 8-variant discriminated union already available for composition via z.intersection; streamsMultiCapture test helper (consumed verbatim by Plan 04's 28 handler tests)
  - phase: 03-streams-stream-rules/03-03
    provides: D-09 parent-mutable pre-flight pattern (4 prior callsites — update_stream, start_stream, pause_stream, delete_stream); Plan 04 extends to 3 more callsites (create_stream_rule, update_stream_rule, delete_stream_rule) for 7 total
provides:
  - "src/tools/streams/schemas.js — appends CreateStreamRuleSchema (mutatingBase.extend({streamId}).and(StreamRuleSchema) — the discriminated-union compose pattern), UpdateStreamRuleSchema (mutatingBase.extend + changes envelope; type IS NOT in changes — immutability per Pitfall S8), DeleteStreamRuleSchema (leaf delete; just streamId + ruleId), TestStreamMatchSchema (streamId required + message field-map via z.record(z.unknown()))"
  - "src/tools/streams/create-stream-rule.js — STREAM-08: 8-variant rule creation with D-09 parent-mutable pre-flight + Pitfall S9 numeric wire translation + Pitfall S10 empty-string defaults; toIdBody idFields:[streamrule_id, id] (Pitfall S7); D-13 __SERVER_ASSIGNED__ sentinel"
  - "src/tools/streams/update-stream-rule.js — STREAM-09: STRICT_NO_ECHO partial-update with Pitfall S8 type-from-current echo (type is non-nullable Java int — ALWAYS on wire even when args.changes omits it; sourced from rule pre-flight GET unconditionally) + D-09 parent-mutable pre-flight"
  - "src/tools/streams/delete-stream-rule.js — STREAM-10: LEAF DELETE per Discretion-04 — NO cascades key, NO _confirmationToken, NO requireConfirm gate; only D-09 parent-mutable pre-flight (Pitfall S12 — leaf-delete still owes mutable). Build descriptor structurally omits `cascades` so handler.js's preview emitter skips the field"
  - "src/tools/streams/test-stream-match.js — STREAM-11: D-07 server-side wrapper; D-08 streamId required; wire body wraps agent's sample message in literal outer key `{ message: <field-map> }` per StreamResource.java:561-564; response forwarded verbatim under result.body"
  - "Empirical proof of D-11 8-variant enumeration (CreateStreamRuleSchema accepts all 8 — exact|regex|greater|less|present|contains|always_match|match_input — including the previously-uncertain match_input 8th variant). Runtime usability of match_input (Assumption A5) remains untested against a live Graylog instance — the smoke artifact for Plan 05 fixtures will surface any server-side rejection."
  - "Pitfall S8 implementation precedent: when a server DTO field is non-nullable AND immutable on update, the STRICT_NO_ECHO wire body MUST echo current.<field> unconditionally. Schema-layer enforces immutability by NOT declaring the field in the changes shape; build-layer sources the value from a pre-flight GET. update_stream_rule's `type` field is the canonical example."
  - "z.intersection() pattern for composing a parent base schema with a discriminated union: `CreateStreamRuleBase.and(StreamRuleSchema)` preserves the union's variant-narrowing behavior whereas `.merge()` would flatten it. Schema-parity helper requires custom handling for intersections — outer-shape lookup via `_def.left.shape`."
  - "Tool count 50 -> 54 (delta +4, completing the Phase 3 12-tool surface). All 4 ROADMAP SCs met: SC1 Plan 03 (delete_stream cascade preview + drift refusal), SC2 Plan 01 (list_streams mutable projection), SC3 Plan 04 (test_stream_match server-side), SC4 Plan 02 (create_stream existingMatches buckets)."
affects: ["03-05 (Phase 3 polish — snapshot fixtures pin Plan-04 dry-run preview shapes: create_stream_rule wire body for each of 8 variants; update_stream_rule STRICT_NO_ECHO + type-echo; delete_stream_rule leaf-delete preview JSON omitting cascades; test_stream_match literal-outer-key body. VALIDATION.md flip + phase close are Plan 05's job)", "phase 04 pipelines (Pitfall S8 + intersection composition + leaf-delete patterns transfer verbatim to any pipeline-rule equivalent)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "z.intersection() composition (`.and()`) for parent-base + discriminated-union: `CreateStreamRuleBase.and(StreamRuleSchema)` preserves the 8-variant union's narrowing behavior. .merge() would flatten — must use .and(). Schema-parity helper needs `_def.left.shape` lookup for intersections."
    - "Pitfall S8 type-echo-from-current pattern: STRICT_NO_ECHO wire body emits one structural exception — non-nullable + immutable server DTO fields are sourced from a pre-flight GET and echoed unconditionally. Defense-in-depth: zod schema strips immutable fields from agent args; build() sources from current.<field>. The canonical instance is update_stream_rule's `type` field (CreateStreamRuleRequest.type is non-nullable Java int)."
    - "Leaf-delete structural assertion via descriptor-shape (Discretion-04): build() returns a descriptor WITHOUT a `cascades` key AND WITHOUT a `_confirmationToken` key. handler.js's preview emitter spreads cascades only when truthy and emits confirmationToken only when _confirmationToken is set — so absence at the descriptor layer maps to absence at the dry-run-JSON layer. Tests assert both `payload.cascades === undefined` AND `res.content[0].text` does not contain the literal substring `\"cascades\"` (defense against accidental emission of explicit undefined values)."
    - "Literal-outer-key wire-body wrapping (StreamResource.java:561-564 pattern): when a Graylog resource method consumes Map<String, Map<String, Object>> with a constant outer key, the wrapper structurally emits `{ <constant>: <agent-payload> }` in build(). For test_stream_match the constant is the literal `\"message\"` — case-sensitive. Future phases may encounter similar shapes (e.g. dashboard widget probe endpoints) — the pattern generalizes."
    - "D-08 streamId-required enforcement at the schema layer (TestStreamMatchSchema): z.string().min(1) on streamId + the schema's missing-key zod error covers both 'agent omitted streamId' and 'agent passed empty string' cases. Pre-create config testing is permanently out of scope at the schema layer; the agent's only path to test_stream_match is via an existing streamId."
    - "Server-side wrapper through defineMutatingHandler (D-07): a tool that performs no Graylog state change still routes through defineMutatingHandler when its wire surface is POST/PUT/DELETE — preserves the cross-cutting 'dryRun:true shows the would-be POST body' invariant. test_stream_match is the structural template: build() emits a request descriptor with method/path/body; apply() forwards verbatim; the dry-run preview shows the agent the exact wire body the apply would fire."

key-files:
  created:
    - "src/tools/streams/create-stream-rule.js — STREAM-08 (78 lines)"
    - "src/tools/streams/delete-stream-rule.js — STREAM-10 (67 lines)"
    - "src/tools/streams/update-stream-rule.js — STREAM-09 (96 lines)"
    - "src/tools/streams/test-stream-match.js — STREAM-11 (54 lines)"
    - ".planning/phases/03-streams-stream-rules/03-04-SUMMARY.md (this file)"
  modified:
    - "src/tools/streams/schemas.js — appends 4 Plan-04 schemas (CreateStreamRuleSchema via z.intersection, UpdateStreamRuleSchema, DeleteStreamRuleSchema, TestStreamMatchSchema)"
    - "src/tools/streams/index.js — adds 4 new register lines; total grows from 8 to 12 (completing the Phase 3 12-tool surface)"
    - "src/tools.js — adds 4 new tool entries (create_stream_rule, update_stream_rule, delete_stream_rule, test_stream_match) with full inputSchema"
    - "test/streams.test.js — adds 26 net-new handler tests + schema tests (15 in Task 1; 11 in Task 2)"
    - "test/schema-parity.test.js — adds 4 net-new assertSchemaParityForTool calls (create_stream_rule uses custom outer-shape lookup for z.intersection; the other 3 use the standard helper)"

key-decisions:
  - "STRICT_NO_ECHO chosen for update_stream_rule per 03-U1-SMOKE.md UNREACHABLE_STRICT_NO_ECHO (precedent already locked by Plan 02's update_stream). Wire body emits ONLY the fields in args.changes, with the structural exception of Pitfall S8: `type` is ALWAYS on the wire, echoed from the rule's pre-flight GET unconditionally. CreateStreamRuleRequest.type is non-nullable Java int — the server requires it even on a value-only update."
  - "D-11 8-variant enumeration empirically verified at the schema layer (CreateStreamRuleSchema accepts all 8 string discriminators). Runtime usability of match_input (Assumption A5) remains unverified against a live Graylog instance — the 8 entries in STREAM_RULE_TYPE_TO_NUMERIC are byte-identical to StreamRuleType.java's enum, so the wire mapping is correct; whether the live 7.0.6 server actually accepts MATCH_INPUT on POST /api/streams/{id}/rules is a Plan-05 fixture concern. If a live smoke surfaces a server-side rejection, the schema can demote to 7 variants without back-compat break."
  - "Pitfall S10 implementation: variant-irrelevant fields default to empty string on the wire (always_match emits field=\"\" + value=\"\"; present emits value=\"\"; match_input emits field=\"\"). The wire shape is non-null-string for both fields per CreateStreamRuleRequest.java, so emitting null would 400. The default is applied at the build layer (`r.value === undefined || r.value === null ? \"\" : String(r.value)`); the schema layer rejects unrelated combinations (e.g., always_match with a `field` key is still parsed and stripped per zod's default strip mode)."
  - "Pitfall S9 implementation: numeric wire translation via the Object.frozen STREAM_RULE_TYPE_TO_NUMERIC map (shipped Plan 02). Defense-in-depth — zod's discriminated union rejects unknown discriminators at parse time; the frozen map raises a TypeError on accidental mutation; the build-layer `STREAM_RULE_TYPE_TO_NUMERIC[args.type]` would return undefined for an off-map type, which Graylog would then 400 on (but the schema rejection makes that path unreachable from agent inputs)."
  - "Discretion-04 LEAF DELETE for delete_stream_rule: NO cascades key, NO _confirmationToken, NO requireConfirm. The structural assertion is at the descriptor layer (build() returns no `cascades` and no `_confirmationToken`); handler.js's preview emitter spreads cascades only when truthy and emits confirmationToken only when _confirmationToken is set; the dry-run JSON omits both fields. Two test assertions per missing field — one against the parsed payload (`hasOwnProperty('cascades') === false`) and one against the raw text (`doesNotMatch(/\"cascades\"/)`) — catches both standard cases and the edge case where an explicit undefined assignment would JSON-serialize as the key existing on the object pre-serialization."
  - "D-08 test_stream_match REQUIRES streamId (pre-create config testing OUT OF SCOPE). Enforced at the schema layer via z.string().min(1) on streamId. The agent's only path to test rule matching is via an existing stream — for new configs the flow is create_stream(dryRun:true) → review preview → create for real → test_stream_match against the real id. The tool description in tools.js documents this contract explicitly."
  - "z.intersection composition for CreateStreamRuleSchema (`CreateStreamRuleBase.and(StreamRuleSchema)`) preserves the 8-variant union's narrowing behavior. .merge() would flatten the discriminated union into a single object shape — the schema would still accept all 8 variants' keys at the union level but lose the per-variant required-fields validation. The schema-parity helper required a special-case in test/schema-parity.test.js: pull the outer mutatingBase-extended shape from `CreateStreamRuleSchema._def.left.shape` rather than the top-level (which doesn't expose `.shape` directly for intersections)."
  - "D-09 parent-mutable pre-flight pattern now has 7 stable callsites (update_stream, start_stream, pause_stream, delete_stream, create_stream_rule, update_stream_rule, delete_stream_rule). The plan recommended extraction into a shared helper at this threshold; chose NOT to lift this in Plan 04 because (a) the per-tool error message text varies meaningfully (\"refusing rule creation\" vs \"refusing rule update\" vs \"refusing rule deletion\" vs \"refusing start\" vs \"refusing pause\" vs \"refusing delete\" vs no-verb on update_stream) and (b) the structured error's method+path context differs per tool. Extraction would still require a verb parameter + path parameter — at that point the savings are 6-8 lines per callsite at the cost of a new abstraction barrier. Recommend revisiting at Phase 4 if pipelines reuse the pattern."
  - "Tool count growth: 50 (Plan 03 end) -> 54 (Plan 04 end). Plan frontmatter targeted 51 -> 55 but inherits the +1 accounting drift from Plan 01 (documented in 03-01-SUMMARY.md §Issues Encountered through Plan 03's frontmatter and beyond). The delta is correct (+4); the absolute numbers are off by one. assertAllToolsRegistered(toolDefinitions) passes against 54. All 12 Phase 3 net-new tools are now registered and dispatch-tested."

patterns-established:
  - "Pitfall S8 echo-from-current STRICT_NO_ECHO exception: when a server DTO has a non-nullable + immutable field, the STRICT_NO_ECHO wire body MUST emit that field echoed from a pre-flight GET unconditionally. Schema layer prevents agent-driven changes (field not declared in changes shape — zod strips it); build layer sources from current.<field>. Defense-in-depth across both layers."
  - "z.intersection() (`.and()`) for composing a parent-base ZodObject with a discriminated union: preserves variant-narrowing whereas .merge() flattens. The intersection exposes outer shape via `_def.left.shape` — the schema-parity helper needs a custom code path."
  - "Leaf-delete via descriptor-shape (Discretion-04): build() omits cascades + _confirmationToken; handler.js's preview emitter conditionally spreads. Tests pin BOTH structural absence (parsed payload `hasOwnProperty('cascades') === false`) AND textual absence (`doesNotMatch(/\"cascades\"/)`) — catches the regression where a future refactor explicitly sets `cascades: undefined`."
  - "Literal-outer-key wire-body wrapping for Graylog resource methods that consume Map<String, Map<String, Object>> with a constant outer key: build() emits `{ <constant>: <agent-payload> }`. test_stream_match's `\"message\"` is the canonical example; the pattern is reusable for any future Graylog endpoint with the same shape."
  - "Server-side wrapper through defineMutatingHandler for read-shaped Graylog endpoints that fire POST/PUT/DELETE on the wire: even when there is no Graylog state change, route through the mutating factory to preserve dryRun + writable inheritance. test_stream_match's POST is the structural template — the wrapper has no business returning a side-effect-free response when the wire surface is POST."

requirements-completed: [STREAM-08, STREAM-09, STREAM-10, STREAM-11]

# Metrics
duration: ~11 min
completed: 2026-05-15
---

# Phase 3 Plan 4: stream-rule CRUD + test_stream_match (STREAM-08/09/10/11) Summary

**All 4 remaining Phase 3 tools shipped — `create_stream_rule` (STREAM-08: 8-variant discriminated union composed via z.intersection with the parent-mutable pre-flight; D-09 + D-11 + D-13 + Pitfall S9 numeric translation + Pitfall S10 empty-string defaults), `update_stream_rule` (STREAM-09: STRICT_NO_ECHO partial-update per 03-U1-SMOKE.md with the Pitfall S8 type-echo-from-current exception for the non-nullable Java int field; D-09 parent-mutable pre-flight), `delete_stream_rule` (STREAM-10: LEAF DELETE per Discretion-04 — NO cascades, NO confirmationToken, NO requireConfirm; D-09 parent-mutable pre-flight is the only safety gate; Pitfall S12 leaf-delete still owes mutable), and `test_stream_match` (STREAM-11: D-07 server-side wrapper with the literal-outer-key `{ message: <field-map> }` wire body per StreamResource.java:561-564; D-08 streamId required at schema layer; response forwarded verbatim). schemas.js extended with 4 new exports (CreateStreamRuleSchema, UpdateStreamRuleSchema, DeleteStreamRuleSchema, TestStreamMatchSchema); index.js grows from 8 to 12 register lines, COMPLETING the Phase 3 12-tool surface. 26 net-new handler/schema tests + 4 new schema-parity assertions land. ROADMAP SC3 ("test_stream_match accepts a stream config + a sample message and returns per-rule match outcomes") provably met by Tests 23 + 25. ALL FOUR ROADMAP SCs for Phase 3 now satisfied: SC1 (Plan 03 delete_stream cascade + drift refusal); SC2 (Plan 01 list_streams mutable projection); SC3 (Plan 04 test_stream_match server-side); SC4 (Plan 02 create_stream existingMatches buckets). Tool count 50 -> 54; full suite green at 447/447.**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-05-15T18:18:43Z
- **Completed:** 2026-05-15T18:29:31Z
- **Tasks:** 2 (both TDD: RED → GREEN per task; no REFACTOR needed)
- **Files modified:** 9 (4 created + 5 modified)
- **Tests added:** +30 (417 baseline → 447 total — 15 Task 1 streams + 11 Task 2 streams + 4 schema-parity)
- **Tool count:** 50 → 54 (delta: +4)

## Accomplishments

### Task 1 — create_stream_rule + delete_stream_rule (TDD RED → GREEN)

**RED — `4e29f73`:** Added 15 streams handler/schema tests + 2 schema-parity assertions covering the create + delete contracts. Tests fail at RED with ERR_MODULE_NOT_FOUND for the not-yet-created handlers and "Tool X missing from tools.js" for the not-yet-declared tool entries. (Initial RED also over-included Task 2 handler imports — corrected at GREEN time as a Rule-1 test-design fix.)

**GREEN — `84d7e0b`:**

- **`src/tools/streams/schemas.js`** (extension):
  - **`CreateStreamRuleSchema`** = `CreateStreamRuleBase.and(StreamRuleSchema)` where `CreateStreamRuleBase = mutatingBase.extend({ streamId })`. The z.intersection (`.and()`) composition preserves the 8-variant union's narrowing — `.merge()` would have flattened it. Accepts all 8 D-11 variants (exact, regex, greater, less, present, contains, always_match, match_input) with per-variant required-field validation.
  - **`UpdateStreamRuleSchema`** = `mutatingBase.extend({ streamId, ruleId, changes })` where `changes` is `UpdateStreamRuleChangesShape` — an all-optional zod object over the 4 MUTABLE wire fields (field, value, inverted, description). `type` is NOT in the shape — Pitfall S8 immutability enforced at the schema layer (zod strips unknown keys per default `strip` mode, so an agent-supplied `changes: { type: "regex" }` parses to `changes: {}` after type is stripped).
  - **`DeleteStreamRuleSchema`** = `mutatingBase.extend({ streamId, ruleId })`. Leaf delete; no confirm field per Discretion-04.
  - **`TestStreamMatchSchema`** = `mutatingBase.extend({ streamId, message })` where `message: z.record(z.unknown())` accepts any JSON-serializable field-map. D-08 streamId required via `z.string().min(1)`.

- **`src/tools/streams/create-stream-rule.js`** (78 lines): STREAM-08 handler.
  - **D-09 parent-mutable pre-flight** (FIRST). Wire field is `is_editable`; refusal sets `err.reason = "stream_immutable"`.
  - **Pitfall S9 numeric translation** via `STREAM_RULE_TYPE_TO_NUMERIC[args.type]`. The frozen map ships the 8 entries (exact=1, regex=2, greater=3, less=4, present=5, contains=6, always_match=7, match_input=8) byte-identical to `StreamRuleType.java`.
  - **Pitfall S10 non-null wire defaults**: `value: args.value === undefined || args.value === null ? "" : String(args.value)`, `field: args.field ?? ""`, `inverted: args.inverted ?? false`. Variants that semantically lack a field (always_match, match_input) emit `field: ""`; variants that lack a value (always_match, present) emit `value: ""`.
  - **D-13 `__SERVER_ASSIGNED__` sentinel** for `postApplyEstimate.id`.
  - **`toIdBody({ idFields: ["streamrule_id", "id"] })`** for response normalization (Pitfall S7).

- **`src/tools/streams/delete-stream-rule.js`** (67 lines): STREAM-10 LEAF DELETE.
  - **D-09 parent-mutable pre-flight** (Pitfall S12 — leaf delete still owes the parent-mutable check).
  - **Build() returns descriptor WITHOUT `cascades` key AND WITHOUT `_confirmationToken`**. handler.js's preview emitter (Plan 02-01 amendment) spreads cascades only when truthy and emits confirmationToken only when _confirmationToken is set; the dry-run JSON omits both fields.
  - **Test 13** asserts BOTH the parsed-payload absence (`Object.prototype.hasOwnProperty.call(payload, "cascades") === false`) AND the raw-text absence (`assert.doesNotMatch(res.content[0].text, /"cascades"/)`).
  - **Test 14** does the same for `confirmationToken`.

- **`src/tools/streams/index.js`**: 2 new register lines — `create_stream_rule`, `delete_stream_rule`. Total grows from 8 to 10.

- **`src/tools.js`**: 2 new tool entries with full inputSchema. `create_stream_rule.inputSchema.properties.type` declares the 8-string enum; `inputSchema.properties.value` declares `type: ["string", "number"]` for greater/less numeric values.

- **`test/streams.test.js`**: 15 new tests (Tests 1-15 per Plan 04 Task 1 behavior list — see test file for full enumeration).

- **`test/schema-parity.test.js`**: 2 new assertions:
  - `schema-parity: create_stream_rule` uses custom logic — `CreateStreamRuleSchema._def.left.shape` exposes the outer mutatingBase-extended shape (z.intersection doesn't expose `.shape` directly).
  - `schema-parity: delete_stream_rule` uses the standard `assertSchemaParityForTool` helper.

### Task 2 — update_stream_rule + test_stream_match (TDD RED → GREEN)

**RED — `7e00ad2`:** Added 11 streams handler/schema tests (Tests 16-26) + 2 schema-parity assertions covering the update + test_match contracts. Tests fail at RED with ERR_MODULE_NOT_FOUND for the not-yet-created handlers and "Tool X missing from tools.js" for the not-yet-declared entries.

**GREEN — `2cd33bc`:**

- **`src/tools/streams/update-stream-rule.js`** (96 lines): STREAM-09 STRICT_NO_ECHO.
  - **U1 smoke RESULT locked verbatim in docstring**: `UNREACHABLE_STRICT_NO_ECHO` → STRICT_NO_ECHO branch (no runtime read of 03-U1-SMOKE.md; the result is a CONSTANT in code).
  - **D-09 parent-mutable pre-flight** (FIRST — saves a rule-GET round-trip on doomed calls).
  - **Pitfall S8 type-echo-from-current**: pre-flight GET on the rule itself sources `current.type`; the wire body ALWAYS includes `type: current.type` regardless of whether `args.changes` touched it. CreateStreamRuleRequest.type is a non-nullable Java int — the server requires it even on a value-only update. This is the ONE structural exception to STRICT_NO_ECHO.
  - **STRICT_NO_ECHO body construction** via conditional spread: `...(args.changes.field !== undefined ? { field: args.changes.field } : {})` and analogs for value, inverted, description. Preserves agent intent — passing `description: null` emits `description: null` (clear intent); omitting `description` emits nothing (no change).
  - **`toIdBody({ idFields: ["streamrule_id", "id"] })`** for response normalization.

- **`src/tools/streams/test-stream-match.js`** (54 lines): STREAM-11 D-07 server-side wrapper.
  - **Synchronous build()** (no pre-flight needed — D-07 explicitly forbids JS re-implementation of rule semantics; Graylog is authoritative).
  - **Literal outer key `{ message: args.message }`** — case-sensitive per StreamResource.java:561-564. The agent's field-map sits one level deeper.
  - **D-08 streamId required** at the schema layer (TestStreamMatchSchema's `z.string().min(1)`).
  - **postApplyEstimate** = `{ matches: "__SERVER_ASSIGNED__", rules: "__SERVER_ASSIGNED__" }` — both keys are server-authoritative.
  - **Response forwarded verbatim** under `result.body` (default `toIdBody` fallback maps raw → { id: raw?.id, body: raw }).

- **`src/tools/streams/index.js`**: 2 more register lines — `update_stream_rule`, `test_stream_match`. **Total: 12 register lines — COMPLETING THE PHASE 3 12-TOOL SURFACE.**

- **`src/tools.js`**: 2 new tool entries. `update_stream_rule` description documents Pitfall S8 type immutability + STRICT_NO_ECHO contract; `test_stream_match` description documents the literal outer key + D-07/D-08 contracts.

- **`test/streams.test.js`**: 11 new tests (Tests 16-26).

- **`test/schema-parity.test.js`**: 2 new assertions for `update_stream_rule` and `test_stream_match` (standard helper; both schemas are plain `mutatingBase.extend()`).

### The literal preview body shape for test_stream_match (doubled-key pattern)

For a sample message that includes a Graylog message-field also named `message`:

```javascript
{
    // wire envelope (outer "message" — StreamResource.java:561-564 constant)
    message: {
        // agent's field-map (inner "message" — a canonical Graylog message field)
        message: "the log text",
        source: "host-1",
        level: 6,
    }
}
```

The two `message` keys are semantically distinct: the outer is the resource-method envelope constant; the inner is one of the canonical Graylog message-field names that happens to share the spelling. The wrapper does not flatten — it preserves both keys verbatim.

### Verified grep counts (acceptance criteria)

- `STREAM_RULE_TYPE_TO_NUMERIC` in `create-stream-rule.js`: 4 occurrences ✓ (≥1 required)
- `cascades` in `delete-stream-rule.js`: 5 occurrences — **all in comments** (the structural assertion is at the build descriptor + test 13; no `cascades:` key emission). See Deviations §1.
- `_confirmationToken` in `delete-stream-rule.js`: 3 occurrences — **all in comments** (same as above).
- `stream_immutable` in both create + delete + update stream-rule files: 3 each ✓ (D-09 conformance)
- `current.type` in `update-stream-rule.js`: 6 occurrences ✓ (Pitfall S8 type-from-current)
- `UNREACHABLE_STRICT_NO_ECHO|STRICT_NO_ECHO|MERGE_FROM_CURRENT` in `update-stream-rule.js`: 3+ occurrences ✓
- `testMatch` in `test-stream-match.js`: 2 occurrences ✓ (path + comment)
- `{ message:` in `test-stream-match.js`: 1 occurrence ✓ (literal outer key in build())
- Register lines in `streams/index.js`: 12 ✓ (Phase 3 12-tool surface complete)
- New tool entries in `tools.js`: 4 ✓ (create_stream_rule, update_stream_rule, delete_stream_rule, test_stream_match)
- `assertAllToolsRegistered(toolDefinitions)` passes against 54 tools ✓

### All 12 Phase 3 tools dispatch-verified

```javascript
const expected = ['list_streams','get_stream','list_stream_rules','create_stream','update_stream','delete_stream','start_stream','pause_stream','create_stream_rule','update_stream_rule','delete_stream_rule','test_stream_match'];
const missing = expected.filter(n => !toolDefinitions.some(td => td.name === n));
// missing: []
```

## Task Commits

Plan 04 ships as 4 atomic commits — two TDD task pairs (RED → GREEN per task):

1. **Task 1 RED:** `4e29f73` (test) — 15 streams tests + 2 schema-parity assertions for create_stream_rule + delete_stream_rule. Fails with ERR_MODULE_NOT_FOUND and "Tool X missing from tools.js".

2. **Task 1 GREEN:** `84d7e0b` (feat) — create-stream-rule.js + delete-stream-rule.js shipped; schemas.js extended with all 4 Plan-04 schemas (the 2 Task-2 schemas land alongside for cohesive zod-layer landing); index.js grows to 10 register lines; tools.js gets the 2 entries. Full suite green at 434/434.

3. **Task 2 RED:** `7e00ad2` (test) — 11 streams tests (Tests 16-26) + 2 schema-parity assertions for update_stream_rule + test_stream_match. Fails with ERR_MODULE_NOT_FOUND for update-stream-rule.js + test-stream-match.js and "Tool X missing from tools.js" for the 2 not-yet-declared entries.

4. **Task 2 GREEN:** `2cd33bc` (feat) — update-stream-rule.js + test-stream-match.js shipped; index.js grows to 12 register lines (COMPLETING PHASE 3); tools.js gets the 2 entries. Full suite green at 447/447.

**Plan metadata commit:** pending (this SUMMARY commit + STATE.md + ROADMAP.md updates ship next).

_TDD gates verified in git log: each task has a `test(03-04)` commit immediately followed by a `feat(03-04)` commit. No squashing across the RED → GREEN boundary._

## Files Created/Modified

### Created (5)

- `src/tools/streams/create-stream-rule.js` — STREAM-08 (78 lines)
- `src/tools/streams/delete-stream-rule.js` — STREAM-10 (67 lines; LEAF DELETE per Discretion-04)
- `src/tools/streams/update-stream-rule.js` — STREAM-09 (96 lines; STRICT_NO_ECHO + Pitfall S8 type-echo)
- `src/tools/streams/test-stream-match.js` — STREAM-11 (54 lines; D-07 server-side wrapper)
- `.planning/phases/03-streams-stream-rules/03-04-SUMMARY.md` — this file

### Modified (4)

- `src/tools/streams/schemas.js` — appends 4 Plan-04 schemas: `CreateStreamRuleSchema` (z.intersection with StreamRuleSchema), `UpdateStreamRuleSchema` (changes envelope without `type`), `DeleteStreamRuleSchema` (leaf-delete shape), `TestStreamMatchSchema` (streamId + message field-map).
- `src/tools/streams/index.js` — adds 4 new register lines; total grows from 8 to 12. COMPLETES the Phase 3 12-tool surface.
- `src/tools.js` — adds 4 new tool entries with full inputSchema declarations (verified via 4 new schema-parity assertions).
- `test/streams.test.js` — adds 26 net-new tests (Tests 1-15 for Task 1; Tests 16-26 for Task 2).
- `test/schema-parity.test.js` — adds 4 new `assertSchemaParityForTool` calls (create_stream_rule uses custom outer-shape lookup for z.intersection; the other 3 use the standard helper).

`src/graylog/errors.js` is NOT in files_modified — `GraylogValidationError` is imported and consumed in all 3 new D-09 callsites but the error class itself was already shipped in Phase 0 (per plan's explicit files_modified omission).

## Decisions Made

See `key-decisions:` frontmatter above. Highlights:

- **STRICT_NO_ECHO for update_stream_rule** per 03-U1-SMOKE.md UNREACHABLE_STRICT_NO_ECHO — with the Pitfall S8 type-echo-from-current structural exception.
- **D-11 8-variant union empirically verified at the schema layer** (CreateStreamRuleSchema accepts all 8 string discriminators). Runtime usability of `match_input` (Assumption A5) remains a Plan-05 fixture concern.
- **Pitfall S9 + S10** baked into create-stream-rule.js's wire-body construction (numeric type via STREAM_RULE_TYPE_TO_NUMERIC; empty-string defaults for variant-irrelevant fields).
- **Discretion-04 LEAF DELETE for delete_stream_rule** — structural conformance at the descriptor layer (no cascades, no _confirmationToken); pinned by Tests 13 + 14 (parsed-payload absence + raw-text absence).
- **D-08 test_stream_match REQUIRES streamId** at the schema layer.
- **z.intersection (`.and()`) for CreateStreamRuleSchema** — preserves the 8-variant union's narrowing; required custom schema-parity helper logic.
- **D-09 parent-mutable pre-flight pattern not yet extracted** — 7 callsites in tree (4 prior + 3 new in Plan 04). Decision documented in key-decisions field: the per-tool error-message + path context variance still favours inline duplication over premature abstraction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Initial Task 1 RED over-included Task 2 handler imports and 2 Task 2 schema-parity tests, blocking Task 1 GREEN landing**

- **Found during:** Task 1 GREEN test run (post-RED commit).
- **Issue:** The initial RED commit (`4e29f73`) imported `handleUpdateStreamRule` and `handleTestStreamMatch` at the top of `test/streams.test.js` AND added 2 Task-2 schema-parity tests (`schema-parity: update_stream_rule` + `schema-parity: test_stream_match`). Per the plan's Task-1/Task-2 split, Task 1 GREEN should ship ONLY create + delete; Task 2 GREEN ships update + test_match. With the initial RED over-included, Task 1 GREEN would have been forced to ship all 4 handlers — collapsing the planned 2-task TDD split into one task.
- **Fix:** At Task 1 GREEN time, pulled the over-included Task-2 imports and schema-parity tests OUT of the test files. They were re-added in Task 2 RED (`7e00ad2`) with the proper RED scope (2 schema-parity assertions + 11 new behavioral tests). Net effect on the TDD discipline: each task still has a clean RED → GREEN pair; the over-included tests were committed in Task 2 RED rather than Task 1 RED.
- **Files modified:** `test/streams.test.js` (removed 2 imports at GREEN time), `test/schema-parity.test.js` (removed 2 tests at GREEN time). Re-added at Task 2 RED (`7e00ad2`).
- **Verification:** Task 1 GREEN (`84d7e0b`) ships standalone with full suite at 434/434; Task 2 GREEN (`2cd33bc`) brings it to 447/447. Both TDD cycles have proper test → feat commit ordering.
- **Committed in:** `84d7e0b` (Task 1 GREEN — the fix-in-place) and `7e00ad2` (Task 2 RED — the re-add).

**2. [Rule 1 - Bug] Plan acceptance criterion `grep "cascades" delete-stream-rule.js returns 0 lines` is overly strict**

- **Found during:** Task 1 acceptance criterion check.
- **Issue:** The plan's Task-1 acceptance says `grep "cascades" src/tools/streams/delete-stream-rule.js returns 0 lines (leaf delete; no cascade key)`. The actual delete-stream-rule.js has 5 mentions of "cascades" — ALL IN COMMENTS explaining WHY there are no cascades. The cross-check against the Phase-1 analog (`delete-extractor.js`) shows 7 mentions of "cascade" — same pattern: docs explaining the leaf-delete invariant. The strict reading of the plan would require removing the comments, which would weaken the rationale documentation. The actual structural assertion is at the build-descriptor layer (the descriptor returned by build() has no `cascades` key) and is pinned by Test 13 (`Object.prototype.hasOwnProperty.call(payload, "cascades") === false` + `assert.doesNotMatch(res.content[0].text, /"cascades"/)`).
- **Fix:** No code change. Documented here as a Rule-1 acceptance-criterion drift. The plan author wrote `grep "cascades" returns 0 lines` thinking only of code references; the established pattern from Phase 1 delete-extractor.js shows comments referencing cascade are expected and load-bearing for documentation.
- **Files modified:** None (the acceptance criterion is too strict — Test 13 is the real assertion).
- **Verification:** `grep -E "cascades:\s|cascades\s*=\s" src/tools/streams/delete-stream-rule.js` returns 0 hits — no code-level cascade key set. Tests 13 + 14 pass.
- **Committed in:** N/A — documentation-accounting note.

**3. [Rule 1 - Bug] Plan acceptance criterion `grep "_confirmationToken" delete-stream-rule.js returns 0 lines` same issue**

- **Found during:** Task 1 acceptance criterion check.
- **Issue:** Same pattern as Deviation #2. The 3 occurrences of `_confirmationToken` in delete-stream-rule.js are all in comments documenting the no-token contract. No code-level `_confirmationToken:` key emission.
- **Fix:** No code change. Test 14 (`assert.doesNotMatch(res.content[0].text, /confirmationToken/)` + `Object.prototype.hasOwnProperty.call(payload, "confirmationToken") === false`) is the real structural assertion.
- **Files modified:** None.
- **Verification:** `grep -E "_confirmationToken:\s|_confirmationToken\s*=\s" src/tools/streams/delete-stream-rule.js` returns 0 hits. Test 14 passes.
- **Committed in:** N/A — documentation-accounting note.

**4. [Rule 1 - Bug] Tool count expected baseline 51 → 55; actual 50 → 54**

- **Found during:** Task 2 acceptance criterion check.
- **Issue:** Plan acceptance says "Tool count after Plan 04: 53 + 2 = 55" and "from 51 (Plan 03 end) to 55". Actual baseline at Plan 03 end was 50 (per 03-03-SUMMARY.md §Deviations #1 — inherited +1 accounting drift from Plan 01's frontmatter target of 46 vs actual 45, carried through Plans 02 and 03). So Plan 04 ships 50 → 54, not 51 → 55. The delta is correct (+4); the absolute numbers are off by one.
- **Fix:** No code change. Documented in this SUMMARY's key-decisions field as inherited from Plan 01.
- **Files modified:** None.
- **Verification:** `node -e "import('./src/tools.js').then(m => console.log(m.toolDefinitions.length))"` prints `54`; `assertAllToolsRegistered(toolDefinitions)` passes against 54 tools.
- **Committed in:** N/A — accounting-doc note.

---

**Total deviations:** 4 Rule-1 documentation / accounting fixes. **Zero production-code drift from the plan** — every `<action>` emission in Plan 04 matches the plan's intent verbatim (z.intersection compose; D-09 parent-mutable in all 3 rule mutations + create; Pitfall S9 numeric translation; Pitfall S10 empty-string defaults; D-13 __SERVER_ASSIGNED__; Pitfall S8 type-echo-from-current; STRICT_NO_ECHO conditional-spread; Discretion-04 leaf-delete descriptor shape; D-07/D-08 server-side wrapper with literal outer key).

**Impact on plan:** None on production code. The 4 deviations are: (1) a TDD-split rebalancing local to test files at GREEN time; (2-3) plan acceptance grep patterns that were overly strict and don't match the established codebase pattern (delete-extractor.js); (4) inherited tool-count accounting drift from Plan 01.

## Issues Encountered

- **None during execution.** Both TDD cycles (Task 1 + Task 2) were clean once the test-file rebalancing in Deviation #1 was applied. Every test's expected behavior matched the plan's `<behavior>` text byte-for-byte; every grep-pattern acceptance criterion verified on first GREEN run modulo the documented Rule-1 acceptance-criterion drifts.

- **Cross-task note on the `type` immutability double-defense:** UpdateStreamRuleSchema's `UpdateStreamRuleChangesShape` does not declare `type` as a key. zod's default `strip` mode silently removes unknown keys at parse time — Test 17 asserts that `parsed.changes.type` is undefined even when the agent passes `changes: { type: "regex" }`. Defense-in-depth: even if a future schema widening let `type` flow through, the build() layer sources `type` from `current.type` unconditionally (Pitfall S8 / Test 19). The schema-layer + build-layer defenses make "agent-driven type change" structurally unreachable from both angles.

## Hand-off to Plan 03-05 (snapshot fixtures + Phase 3 polish + VALIDATION.md flip)

All 12 Phase 3 net-new tools are registered, schema-parity-tested, and dispatch-verified. Plan 05 ships:

1. **Snapshot fixtures (per RESEARCH.md §"Snapshot Fixture Design", ~11 fixtures total):**
   - `create_stream_rule` dry-run for each of 8 D-11 variants — pin the numeric wire type + empty-string-defaults for variant-irrelevant fields (exact, regex, greater, less, present, contains, always_match, match_input).
   - `update_stream_rule` dry-run for each subset (value-only, field-only, inverted-flip, description-clear) showing STRICT_NO_ECHO body + Pitfall S8 type-echo from current.
   - `delete_stream_rule` dry-run preview JSON — pin the absence of `cascades` and `confirmationToken` (Discretion-04 structural conformance at the snapshot level).
   - `test_stream_match` dry-run preview — pin the literal outer key `{ message: { ... } }` body shape.
   - `test_stream_match` apply path response — pin the forwarded verbatim `{ matches, rules }` envelope.

2. **VALIDATION.md flip** — turn each VALIDATION row green where Plan 04's tests cover the row.

3. **Phase close** — final ROADMAP update + REQUIREMENTS check-offs for STREAM-08/09/10/11 + Phase 3 wrap-up.

The keyed-buckets hash is byte-stable across runs (verified by Plan 03's frozen-fixture hashes); the create_stream_rule + update_stream_rule wire bodies are deterministic; the test_stream_match wire body and forwarded response are byte-stable per run. All 11 fixtures will be deterministic across CI runs.

## Hand-off to Phase 4 (Pipelines) — early reach-forward

- **Pitfall S8 echo-from-current pattern** generalizes to any future Graylog endpoint where a server DTO field is non-nullable + immutable on update. Phase 4 may encounter pipeline-rule type fields with similar constraints — if so, the update_stream_rule template is the structural prototype (schema layer enforces immutability; build layer echoes from pre-flight GET).

- **z.intersection composition for parent-base + discriminated union** generalizes to any future Phase 4 tool that needs a parent reference (pipelineId, ruleId, etc.) layered onto a discriminated union schema (pipeline-rule types, pipeline-source kinds). The CreateStreamRuleSchema pattern is the structural template.

- **Literal-outer-key wire-body wrapping** generalizes to any Graylog resource method that consumes `Map<String, Map<String, Object>>` with a constant outer key. If Phase 4 pipelines exposes a similar test/probe endpoint, the test-stream-match.js template is reusable verbatim.

- **D-09 parent-mutable pre-flight pattern at 7 callsites** — Phase 4 will likely add more callsites (pipeline mutations may need a parent-pipeline-mutable check). At ~10 callsites the abstraction case becomes overwhelming; the per-tool verb/path variance can be threaded through a single function-parameter helper in `src/tools/streams/_internal/mutable-preflight.js` (or `_shared/mutable-preflight.js` if pipelines reuses).

## Self-Check: PASSED

All 5 expected created files exist on disk:
- `src/tools/streams/create-stream-rule.js` FOUND (78 lines)
- `src/tools/streams/delete-stream-rule.js` FOUND (67 lines)
- `src/tools/streams/update-stream-rule.js` FOUND (96 lines)
- `src/tools/streams/test-stream-match.js` FOUND (54 lines)
- `.planning/phases/03-streams-stream-rules/03-04-SUMMARY.md` FOUND (this file)

All 4 task-commit hashes resolve in git log:
- `4e29f73` (Task 1 RED) FOUND
- `84d7e0b` (Task 1 GREEN) FOUND
- `7e00ad2` (Task 2 RED) FOUND
- `2cd33bc` (Task 2 GREEN) FOUND

`npm test` reports 447/447 green (417 baseline + 30 net-new). `assertAllToolsRegistered(toolDefinitions)` passes against 54 tools. All 12 Phase 3 net-new tools verified registered via direct dispatch lookup. CLAUDE.md compliance: dryRun: true default preserved (all 4 new tools route through defineMutatingHandler); no new npm dependencies added (zod was already in package.json — Plan 04 uses `z.intersection` / `.and()` from the existing zod 3.25.76 install); existing v2.3 tool contracts unchanged; new admin tools landed under `src/tools/streams/` per the per-domain folder layout; mutating-tool envelope structurally enforced (defineMutatingHandler).

---
*Phase: 03-streams-stream-rules*
*Completed: 2026-05-15*
