# Phase 3: Streams & Stream Rules - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 3 delivers the streams + stream-rules domain: 11 tools that let an agent route messages into streams, manage the rules that scope each stream, and validate rule intent before round-tripping a real message through Graylog. The phase's safety thesis is mitigating C2 (stream deletion cascades silently to rules, pipeline connections, event definitions) end-to-end via dry-run preview + cascade-hash confirmation + world-changed refusal. Composition pattern: every tool is one `defineMutatingHandler` or `defineListHandler` call, reusing Phase 0/1/2 primitives.

In scope: STREAM-01 through STREAM-11 (11 requirements) — `list_streams`, `get_stream`, `create_stream`, `update_stream`, `delete_stream`, `start_stream`, `pause_stream`, `list_stream_rules`, `create_stream_rule`, `update_stream_rule`, `delete_stream_rule`, `test_stream_match`.

Out of scope: pipelines, pipeline rules, pipeline-to-stream connections (Phase 4 — Pipelines); dashboards; event definitions/notifications (read-only since v2.3, write-side later phase); blueprints. No new framework primitives expected (the cascade-hash mechanic reuses Phase 2's `_confirmationToken` / `requireConfirm` infrastructure).

</domain>

<decisions>
## Implementation Decisions

### Cascade preview + world-changed refusal (C2 mitigation, ROADMAP SC1)

- **D-01:** `delete_stream` dry-run pre-flights THREE endpoints and consolidates the dependents under `cascades`:
  - `GET /streams/{streamId}/rules` → `cascades.stream_rules: [{id, type, field, value}]`
  - `GET /streams/{streamId}/pipelines` (or pipeline-connections endpoint to be confirmed by research against 7.0.6) → `cascades.pipeline_connections: [{id, title}]`
  - `GET /events/definitions?stream_id={streamId}` (or whatever filter Graylog 7.0.6 exposes) → `cascades.event_definitions: [{id, title}]`
- **D-02:** Confirmation hash for `delete_stream` is `sha256(JSON.stringify({streamId, cascadeIds: [...sortedRuleIds, ...sortedPipelineConnIds, ...sortedEventDefIds].sort()}))`. Dry-run emits this as `confirmationToken` (reusing Phase 2's `_confirmationToken` forwarding + `requireConfirm` apply-time gate machinery — no new framework primitive).
- **D-03:** Apply (`dryRun: false`) requires `confirm: "<hash>"`. The apply path re-fetches all three cascade endpoints, re-computes the hash, and refuses with `reason: "cascade_changed_since_preview"` if mismatched. Refusal fires for BOTH additions AND removals (any drift) — the strictest interpretation of "world changed" since either case may invalidate the agent's intent. Mitigates C2.
- **D-04:** If ANY of the three pre-flight endpoints fails during dry-run (network failure, unexpected 5xx — 404 on a never-attached endpoint is fine and produces an empty list), the dry-run returns `isError: true` with `reason: "cascade_preflight_failed"` and the failing endpoint named in the message. No confirmation token issued. Same safety stance as Phase 2 D-05 (stats_unreachable hard-block for delete_index_set).

### Similarity heuristic for create_stream existingMatches (M5 mitigation, ROADMAP SC4)

- **D-05:** `create_stream` dry-run pre-flights `GET /streams` and classifies every existing stream's title against the proposed title into one of THREE buckets:
  - `exact` — byte-identical match
  - `case_insensitive` — `.toLowerCase()` match but not byte-identical
  - `prefix` — one is a `.toLowerCase()` prefix of the other (proposed.startsWith(existing.toLowerCase()) OR existing.toLowerCase().startsWith(proposed.toLowerCase()))
- **D-06:** `existingMatches` entries carry `{ id, title, similarity_reason: "exact" | "case_insensitive" | "prefix" }`. Closed set of reason values (zod enum). No fuzzy scoring (no Levenshtein, no Jaccard). Tool description spells out the buckets so the agent knows what's flagged.

### test_stream_match implementation (STREAM-11, ROADMAP SC3)

- **D-07:** `test_stream_match` is **server-side only**. Hits Graylog's existing `/streams/{streamId}/testMatch` endpoint (path verified by research against 7.0.6). Returns per-rule match outcomes derived from Graylog's authoritative rule-evaluation. No JS re-implementation.
- **D-08:** `test_stream_match` REQUIRES `streamId` — the stream must already exist. Pre-create config testing is out of scope; the agent uses the flow: `create_stream` with `dryRun:true` (sees preview) → create for real → `test_stream_match` against the real id. Tool description spells out this contract.

### Mutable defense-in-depth (STREAM-01, cross-cutting)

- **D-09:** Every mutating stream tool (`update_stream`, `delete_stream`, `start_stream`, `pause_stream`) pre-flights `GET /streams/{streamId}` and reads `current.mutable`. If `mutable: false`, dry-run refuses with `reason: "stream_immutable"`. Same defense-in-depth model as Phase 0's `writable` flag (D-07 from Phase 0): wrapper-side gate fires BEFORE the destructive verb. Protects built-in streams (e.g. "All messages") regardless of how Graylog's API responds. Tool descriptions document this. Stream-rule mutations on a stream's children (`create_stream_rule`, `update_stream_rule`, `delete_stream_rule`) also pre-flight the parent stream's mutable flag — modifying rules of an immutable stream is also refused.

### index_set_id requirement (STREAM-03)

- **D-10:** `CreateStreamSchema.index_set_id` is a REQUIRED field. NO defaulting to the cluster's default index set. Forces the agent to make an explicit storage-routing choice (matches Phase 2 D-10 "explicit > implicit" stance for destruction policies; same principle applies to routing decisions). Tool description suggests calling `list_index_sets` first and highlights the `default: true` flag in the output.

### Stream rule schemas (STREAM-08)

- **D-11:** `StreamRuleSchema` is a `z.discriminatedUnion("type", [...])` with 7 variants — one per named rule type:
  - `exact` → `{ type: "exact", field: string, value: string, inverted?: boolean }`
  - `regex` → `{ type: "regex", field: string, value: string, inverted?: boolean }`
  - `greater` → `{ type: "greater", field: string, value: number, inverted?: boolean }`
  - `less` → `{ type: "less", field: string, value: number, inverted?: boolean }`
  - `present` → `{ type: "present", field: string, inverted?: boolean }` (no `value`)
  - `contains` → `{ type: "contains", field: string, value: string, inverted?: boolean }`
  - `always_match` → `{ type: "always_match", inverted?: boolean }` (no `field`, no `value`)
  Each variant types `value` correctly. Strong type guarantees at the agent's boundary. Pattern mirrors Phase 1's input-type discriminated union and Phase 1's all-6-types extractor strategy (closed-set strict typing — researcher should verify the 7 named types map cleanly to Graylog 7.0.6's StreamRuleType enum and adjust if a Graylog primitive is missing or renamed).

### Lifecycle (STREAM-06)

- **D-12:** `start_stream` and `pause_stream` go through `defineMutatingHandler` (uniform dryRun + writable-flag inheritance, per Phase 1 D-08 precedent). Endpoints to verify against 7.0.6 (likely `POST /streams/{id}/resume` and `POST /streams/{id}/pause` — researcher confirms).

### Server-assigned IDs (pitfall C6 carried forward)

- **D-13:** `create_stream` and `create_stream_rule` dry-run previews use the `__SERVER_ASSIGNED__` sentinel for the not-yet-known IDs. Tool description warns against reusing the placeholder ID across a multi-step flow.

### Partial-update pattern (STREAM-04, STREAM-09)

- **D-14:** `update_stream` and `update_stream_rule` follow whichever pattern the U1-style smoke surfaces for streams in Plan 01 Task 1 (`STRICT_NO_ECHO` per D-12 from Phase 1's update_input, OR `MERGE_FROM_CURRENT` per Phase 2's UNREACHABLE_DEFAULT_MERGE outcome for update_index_set). Streams have no encrypted fields, so MERGE_FROM_CURRENT is acceptable if the live API requires it. Research/smoke is the deciding artifact.

### Claude's Discretion

- **Discretion-01:** Module layout under `src/tools/streams/` (or `src/tools/stream/` — naming TBD by planner).
- **Discretion-02:** Whether `list_stream_rules` is a separate handler or whether rules are returned in `get_stream` only. STREAM-02 ("get_stream — full DTO with rules") and STREAM-07 ("list_stream_rules — per-stream") suggest both exist; planner picks the relationship (most natural: `get_stream` returns rules embedded, `list_stream_rules` is a narrow-projected list-only call for token efficiency on streams with many rules).
- **Discretion-03:** Exact name of the cascade-hash field returned in `confirmationToken` (reuse the Phase 2 name verbatim for cross-tool consistency, or rename if Plan 03 surfaces a clearer label).
- **Discretion-04:** Whether `delete_stream_rule` requires a confirmation hash like `delete_stream` does. Recommendation: NO — a stream rule is a leaf node with no cascade dependents; standard `dryRun:true` preview + plain apply is sufficient.
- **Discretion-05:** Snapshot fixture set design — minimally: create_stream dry-run (with `index_set_id` from a Phase 2 fixture), create_stream with existingMatches (one of each similarity bucket), delete_stream cascade preview with token, delete_stream apply with mismatched confirm refusal, test_stream_match with one match + one miss + one always_match, mutable:false refusal. Planner refines.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level

- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md` — STREAM-01..STREAM-11
- `.planning/ROADMAP.md` §"Phase 3: Streams & Stream Rules" — goal + 4 success criteria + dependency on Phase 0 and Phase 2
- `.planning/STATE.md`

### Prior phase outputs (the foundation this phase builds on)

- `.planning/phases/00-foundation/00-04-SUMMARY.md` — `defineMutatingHandler` / `defineListHandler` factory contract
- `.planning/phases/00-foundation/00-03-SUMMARY.md` — `src/graylog/client.js` HTTP client
- `.planning/phases/01-inputs-extractors/01-CONTEXT.md` — Phase 1 D-07 (closed-set strict typing for extractor types) is the precedent for D-11 here
- `.planning/phases/01-inputs-extractors/01-02-SUMMARY.md` — `update_input` strict no-echo pattern (one of the two paths D-14 might take after smoke)
- `.planning/phases/02-index-sets-retention/02-CONTEXT.md` — Phase 2 D-01 (sha-256 confirmation hash) is the direct precedent for D-02 here; Phase 2 D-15 (no-job_id envelope pattern) doesn't apply (streams aren't async); Phase 2 D-07 (mutable defense-in-depth) is the precedent for D-09
- `.planning/phases/02-index-sets-retention/02-03-SUMMARY.md` — `delete_index_set` C1 mitigation centerpiece is the direct analog for `delete_stream` C2 mitigation here
- `.planning/phases/02-index-sets-retention/02-01-SUMMARY.md` — `_confirmationToken` forwarding + `requireConfirm` apply-gate amendments to `handler.js` (Phase 3 reuses these verbatim — no new framework primitive)

### Research outputs

- `.planning/research/PITFALLS.md` §C2 (drives D-01..D-04), §C6 (drives D-13), §M2 (POST /streams returns 201 + `{stream_id}` — drives normalize), §M5 (drives D-05/D-06), §M6 (stream-rule DSL — applicable to Phase 4 pipelines, NOT here), §M7 (drives narrow projection in list_streams), §m5 (server-side test endpoint for `/streams/{id}/testMatch` — confirm path against 7.0.6)
- `.planning/research/ARCHITECTURE.md` — module layout
- `.planning/research/FEATURES.md`

### Live Graylog API touchpoints (verify against 7.0.6)

- `GET /streams` — list (STREAM-01)
- `GET /streams/{id}` — get full DTO (STREAM-02)
- `POST /streams` — create (STREAM-03); response per pitfall M2 is `201 + {stream_id} + Location` header
- `PUT /streams/{id}` — update (STREAM-04)
- `DELETE /streams/{id}` — delete (STREAM-05); throws `StreamGuardException` 400 if dependents exist (lossy error per pitfall C2)
- `POST /streams/{id}/resume` — start (STREAM-06; verify path)
- `POST /streams/{id}/pause` — pause (STREAM-06; verify path)
- `GET /streams/{id}/rules` — list rules (STREAM-07); also drives cascade preview
- `POST /streams/{id}/rules` — create rule (STREAM-08); response per pitfall M2 is `201 + {streamrule_id}`
- `PUT /streams/{id}/rules/{ruleId}` — update rule (STREAM-09)
- `DELETE /streams/{id}/rules/{ruleId}` — delete rule (STREAM-10)
- `POST /streams/{id}/testMatch` — test rule matches against a sample message (STREAM-11, D-07; confirm path + request body shape against 7.0.6)
- `GET /streams/{id}/pipelines` — pipeline connections list (drives cascade preview for D-01)
- `GET /events/definitions?stream_id=...` (or whatever filter exists) — event definitions referencing a stream (drives cascade preview for D-01)
- `source-code/graylog2-server/.../StreamResource.java` — canonical reference (lines 218-253 create; 418-432 delete + cascade behavior; 299-305 list response)
- `source-code/graylog2-server/.../StreamRuleResource.java` — canonical reference

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`defineMutatingHandler` / `defineListHandler`** — every Phase 3 tool is one of these two factory calls. A4 async build + `req.cascades` + `_confirmationToken` + `requireConfirm` are all shipped (Phases 0/1/2).
- **`computeC1Hash` / sha-256 confirmation infrastructure** (Phase 2 — `src/tools/index-sets/c1-hash.js`) — drop the function name into a more domain-neutral module (`src/tools/_shared/cascade-hash.js`?) and reuse for D-02. OR leave Phase 2's named for index sets and add a parallel `src/tools/streams/c2-hash.js` — planner decides.
- **`findExistingMatches({listPath, matchFn})`** (`src/tools/_shared/conflict.js`) — with the Phase 2 `index_sets` envelope amendment, may need a `streams` envelope amendment too. Planner verifies.
- **`makeClient(connection).request(method, path, body, opts?)`** — single HTTP entry point.
- **Phase 2 `delete-index-set.js`** — the closest analog for the C2 mitigation flow (pre-flight + hash + apply-time refusal). Phase 3's `delete-stream.js` mirrors its shape.
- **Phase 1 `update-input.js` or `update-extractor.js`** — analog for D-14 partial-update (one of the two patterns).

### Established Patterns

- **Per-domain folder layout** — `src/tools/streams/` mirrors `src/tools/inputs/` and `src/tools/index-sets/`.
- **Per-domain `schemas.js`** — discriminated unions + leaf schemas co-located.
- **`<verb>_<domain>_<noun>` naming** — `list_streams`, `get_stream`, `create_stream`, `update_stream`, `delete_stream`, `start_stream`, `pause_stream`, `list_stream_rules`, `create_stream_rule`, `update_stream_rule`, `delete_stream_rule`, `test_stream_match`. All declared in REQUIREMENTS.md.
- **D-15 async envelope from Phase 2** — DOES NOT apply here. Streams are not async (no system-job spawning). All applies are sync 204 or 201.
- **Auth-redaction lint regex-level placeholder + structural FQCN recognition** — apply automatically to any new snapshots.
- **Schema-parity enrichment** — every new Phase 3 tool MUST add `assertSchemaParityForTool(toolName, zodSchema)` (expected: 12 new tools).

### Integration Points

- New tools register through `src/tools/streams/index.js` → `src/tools/_register.js` → dispatch Map.
- `create_stream` consumes Phase 2's `list_index_sets` indirectly (the agent's flow: list index sets → pick an id → pass to create_stream). No code-level cross-domain dependency; just doc flow.
- The cascade-hash helper potentially promotes to `src/tools/_shared/` for cross-domain reuse if Phase 4 (pipelines) also needs cascade-preview-with-confirmation.

</code_context>

<specifics>
## Specific Ideas

- The C2 cascade-hash is the centerpiece of this phase's safety story. The plan must include fixtures proving: (a) dry-run with empty cascades emits a hash but no entries; (b) dry-run with populated cascades emits a hash that incorporates all three dependent types; (c) apply with a stale hash refuses with `reason: "cascade_changed_since_preview"`; (d) `cascade_preflight_failed` hard-blocks when any of the three pre-flight endpoints errors.
- The `existingMatches` similarity bucketing must be unambiguous — `exact` wins over `case_insensitive` wins over `prefix` (in priority order). If a stream's title matches multiple buckets, the strictest bucket is reported.
- The 7 stream-rule discriminator names should match the user-facing aliases (`exact`, `regex`, `greater`, `less`, `present`, `contains`, `always_match`). Researcher verifies Graylog 7.0.6 actually exposes all 7 under the StreamRuleType enum (legacy versions may have folded `always_match` into a default-true `inverted` field).

</specifics>

<deferred>
## Deferred Ideas

- **Server-side cascade-mutation hooks** — wrapper-side hash + refusal is the agreed model. A future phase could explore Graylog application-layer transactions if available.
- **`test_stream_match` for pre-create stream configs** — explicitly out per D-08. Agent uses create-then-test flow.
- **Levenshtein / token-based similarity matching** — out per D-05/D-06. The three-bucket exact/case-insensitive/prefix model is the agreed surface.
- **Bulk stream-rule operations** — `create_stream_rules` (bulk), `delete_stream_rules` (bulk) not in REQUIREMENTS. Agent loops if it needs bulk.

</deferred>

---

*Phase: 03-streams-stream-rules*
*Context gathered: 2026-05-15*
