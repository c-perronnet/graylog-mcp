# Phase 3: Streams & Stream Rules - Research

**Researched:** 2026-05-15
**Domain:** Graylog 7.0.6 streams + stream-rules admin surface; AI-agent-driven cascade-safe mutation
**Confidence:** HIGH

## Summary

Phase 3 ships the third domain phase: 12 stream + stream-rule MCP tools, each composed through the already-shipped `defineMutatingHandler` / `defineListHandler` factories. The phase's safety story is mitigating PITFALLS.md §C2 — stream deletion silently cascades to stream rules, pipeline-to-stream connections, and event definitions — via a three-endpoint cascade pre-flight, a deterministic sha-256 confirmation hash (the C2 hash, direct analog of Phase 2's C1 hash for index sets), and a world-changed refusal at apply time. No new framework primitives are needed: Phase 2 shipped `_confirmationToken` forwarding + `requireConfirm` apply-gate in `handler.js`; Phase 3 composes them.

The Graylog 7.0.6 surface is read directly from the source clone at `source-code/graylog2-server/` (7.2.0-SNAPSHOT — the user accepted forward-compat-as-reference; the relevant Stream + StreamRule resource classes have been stable since v6). The 12 endpoints are catalogued below with verified status codes, request bodies, and response shapes from `StreamResource.java`, `StreamRuleResource.java`, `CreateStreamRequest.java`, and `CreateStreamRuleRequest.java`. Several surprises are flagged: the response field is `is_editable: boolean` (NOT `mutable`), `StreamRuleType` has **8 values** (not 7 — the 8th is `MATCH_INPUT`, not enumerated in D-11), the bare `GET /streams` endpoint is `@Deprecated` (but still works), the pipeline-connections endpoint exists at `GET /streams/{id}/pipelines` (Pitfall C2 path verified), and event definitions have **no server-side stream-id filter** — the cascade pre-flight must page through all definitions and filter client-side.

**Primary recommendation:** Compose every tool through `defineMutatingHandler` or `defineListHandler`. Promote the C1/C2 hash helper to `src/tools/_shared/cascade-hash.js` so Phase 4 (pipeline-rule deletion) can reuse it. Wire `delete_stream` as the C2 mitigation centerpiece following the byte-for-byte shape of `delete_index_set` (Phase 2). Add a `streams` envelope branch to `findExistingMatches` in `src/tools/_shared/conflict.js` (already present per Plan 02-01 amendment — verify). Map the 8 stream-rule types into the discriminated union with `MATCH_INPUT` either added as a 7th-plus-1 variant or explicitly documented as out-of-scope (researcher recommendation below).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Cascade preview + world-changed refusal (C2 mitigation, ROADMAP SC1)

- **D-01:** `delete_stream` dry-run pre-flights THREE endpoints and consolidates the dependents under `cascades`:
  - `GET /streams/{streamId}/rules` → `cascades.stream_rules: [{id, type, field, value}]`
  - `GET /streams/{streamId}/pipelines` (or pipeline-connections endpoint to be confirmed by research against 7.0.6) → `cascades.pipeline_connections: [{id, title}]`
  - `GET /events/definitions?stream_id={streamId}` (or whatever filter Graylog 7.0.6 exposes) → `cascades.event_definitions: [{id, title}]`
- **D-02:** Confirmation hash for `delete_stream` is `sha256(JSON.stringify({streamId, cascadeIds: [...sortedRuleIds, ...sortedPipelineConnIds, ...sortedEventDefIds].sort()}))`. Dry-run emits this as `confirmationToken` (reusing Phase 2's `_confirmationToken` forwarding + `requireConfirm` apply-time gate machinery — no new framework primitive).
- **D-03:** Apply (`dryRun: false`) requires `confirm: "<hash>"`. The apply path re-fetches all three cascade endpoints, re-computes the hash, and refuses with `reason: "cascade_changed_since_preview"` if mismatched. Refusal fires for BOTH additions AND removals (any drift) — the strictest interpretation of "world changed" since either case may invalidate the agent's intent. Mitigates C2.
- **D-04:** If ANY of the three pre-flight endpoints fails during dry-run (network failure, unexpected 5xx — 404 on a never-attached endpoint is fine and produces an empty list), the dry-run returns `isError: true` with `reason: "cascade_preflight_failed"` and the failing endpoint named in the message. No confirmation token issued. Same safety stance as Phase 2 D-05 (stats_unreachable hard-block for delete_index_set).

#### Similarity heuristic for create_stream existingMatches (M5 mitigation, ROADMAP SC4)

- **D-05:** `create_stream` dry-run pre-flights `GET /streams` and classifies every existing stream's title against the proposed title into one of THREE buckets: `exact` (byte-identical), `case_insensitive` (`.toLowerCase()` match but not byte-identical), `prefix` (one is a `.toLowerCase()` prefix of the other).
- **D-06:** `existingMatches` entries carry `{ id, title, similarity_reason: "exact" | "case_insensitive" | "prefix" }`. Closed set of reason values (zod enum). Strictest bucket wins.

#### test_stream_match implementation (STREAM-11, ROADMAP SC3)

- **D-07:** `test_stream_match` is **server-side only**. Hits Graylog's `/streams/{streamId}/testMatch` endpoint. Returns per-rule outcomes derived from Graylog's authoritative rule evaluation.
- **D-08:** REQUIRES `streamId` — the stream must already exist. Pre-create config testing is out of scope.

#### Mutable defense-in-depth (STREAM-01, cross-cutting)

- **D-09:** Every mutating stream tool (`update_stream`, `delete_stream`, `start_stream`, `pause_stream`) pre-flights `GET /streams/{streamId}` and reads `current.mutable`. If `mutable: false`, dry-run refuses with `reason: "stream_immutable"`. Stream-rule mutations on a stream's children (`create_stream_rule`, `update_stream_rule`, `delete_stream_rule`) ALSO pre-flight the parent stream's mutable flag.

#### index_set_id requirement (STREAM-03)

- **D-10:** `CreateStreamSchema.index_set_id` is REQUIRED. NO defaulting.

#### Stream rule schemas (STREAM-08)

- **D-11:** `StreamRuleSchema` is a `z.discriminatedUnion("type", [...])` with 7 variants: `exact`, `regex`, `greater`, `less`, `present`, `contains`, `always_match`. (Researcher must verify these 7 names map cleanly to Graylog 7.0.6's StreamRuleType enum.)

#### Lifecycle (STREAM-06)

- **D-12:** `start_stream` and `pause_stream` go through `defineMutatingHandler`. Endpoints to verify against 7.0.6.

#### Server-assigned IDs (pitfall C6 carried forward)

- **D-13:** `create_stream` and `create_stream_rule` dry-run previews use the `__SERVER_ASSIGNED__` sentinel.

#### Partial-update pattern (STREAM-04, STREAM-09)

- **D-14:** `update_stream` and `update_stream_rule` follow whichever pattern the U1-style smoke surfaces for streams in Plan 01 Task 1 (`STRICT_NO_ECHO` per Phase 1 D-12, OR `MERGE_FROM_CURRENT` per Phase 2's update_index_set). Streams have no encrypted fields, so `MERGE_FROM_CURRENT` is acceptable if the live API requires it.

### Claude's Discretion

- **Discretion-01:** Module layout under `src/tools/streams/` (or `src/tools/stream/`).
- **Discretion-02:** Whether `list_stream_rules` is a separate handler or rules are returned only in `get_stream`.
- **Discretion-03:** Exact name of the cascade-hash field returned in `confirmationToken`.
- **Discretion-04:** Whether `delete_stream_rule` requires a confirmation hash. Recommendation: NO (stream rule is leaf-node, no cascade dependents).
- **Discretion-05:** Snapshot fixture set design (researcher recommends 10 fixtures below).

### Deferred Ideas (OUT OF SCOPE)

- Server-side cascade-mutation hooks (wrapper-side hash + refusal is the agreed model)
- `test_stream_match` for pre-create stream configs (D-08)
- Levenshtein / token-based similarity matching (D-05/D-06)
- Bulk stream-rule operations (`create_stream_rules`, `delete_stream_rules`)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| STREAM-01 | `list_streams` — narrow projection; includes `mutable: boolean` per stream | §"Endpoint Catalogue" #1 + §"Pitfall S2: mutable vs is_editable rename" — wire field is `is_editable`; tool projects to `mutable` for API stability |
| STREAM-02 | `get_stream` — full DTO with rules | §"Endpoint Catalogue" #2 — `GET /streams/{id}` returns `StreamResponse` (15-field DTO with embedded `rules: [...]`) |
| STREAM-03 | `create_stream` — internal title-conflict check (M5); reports `existingMatches` in dry-run | §"Endpoint Catalogue" #3 + §"Architecture Patterns" Pattern 4 (existingMatches buckets) — uses `findExistingMatches` with `streams` envelope branch (already shipped per Plan 02-01) |
| STREAM-04 | `update_stream` — partial-update | §"Endpoint Catalogue" #4 + §"Architecture Patterns" Pattern 6 (D-14 partial-update) — `UpdateStreamRequest` is fully nullable; either pattern is wire-compatible |
| STREAM-05 | `delete_stream` — pre-delete cascade preview showing rules, pipeline connections, and event definitions that reference this stream (C2) | §"Endpoint Catalogue" #5 + §"Architecture Patterns" Pattern 5 (C2 cascade hash) — three pre-flights; sha-256 hash; world-changed refusal |
| STREAM-06 | `start_stream` / `pause_stream` | §"Endpoint Catalogue" #6, #7 — `POST /streams/{id}/resume` and `POST /streams/{id}/pause`, both return 204 |
| STREAM-07 | `list_stream_rules` | §"Endpoint Catalogue" #8 — `GET /streams/{streamId}/rules` returns `StreamRuleListResponse { total, stream_rules: [...] }` |
| STREAM-08 | `create_stream_rule` — covers all rule types (exact, regex, greater, less, present, contains, always-match) | §"Endpoint Catalogue" #9 + §"D-11 StreamRuleType enum mapping" — 7-of-8 names confirmed; numeric wire-format mapping documented |
| STREAM-09 | `update_stream_rule` | §"Endpoint Catalogue" #10 — `PUT /streams/{streamId}/rules/{ruleId}` accepts `CreateStreamRuleRequest` (NOT a separate "Update" shape) |
| STREAM-10 | `delete_stream_rule` | §"Endpoint Catalogue" #11 — `DELETE /streams/{streamId}/rules/{ruleId}` returns 204; leaf-delete (no cascade) per Discretion-04 |
| STREAM-11 | `test_stream_match` — given a stream config and a sample message, returns which rules matched | §"Endpoint Catalogue" #12 — `POST /streams/{streamId}/testMatch`; request body is `{ message: {...field map...} }`; response is `TestMatchResponse { matches: boolean, rules: Map<ruleId, boolean> }` |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

The following directives from `./CLAUDE.md` apply with the same authority as locked decisions. Plans MUST honor these — research cannot recommend approaches that contradict them.

- **Node.js ≥18 ESM** (Phase 0 already bumped engines to >= 22.3.0; honor that). All Phase 3 modules are ES Modules with `import` syntax. [VERIFIED: package.json engines.node = ">=22.3.0"]
- **Dependencies: `@modelcontextprotocol/sdk`, `axios`, `zod` ONLY.** No new prod deps in Phase 3. [VERIFIED: `node -p "Object.keys(require('./package.json').dependencies)"` → exactly these three]
- **Graylog 7.0.6 only.** Source clone is 7.2.0-SNAPSHOT — forward-compat reference. No multi-version branching. Plans MUST cite shape evidence from the source AND verify against `<graylog-host>` when smoke-test reachable.
- **Auth model.** Existing connection registry + API token (HTTP Basic with token-as-username, `password: "token"`). No new auth concepts. Insufficient permissions surface as upstream 403 — handled by `mapGraylogError` already.
- **Safety: every mutating tool defaults `dryRun: true`.** Applying without an explicit `dryRun: false` is a bug. `defineMutatingHandler` enforces this in `mutatingBase`; do NOT override in per-tool schemas.
- **Backward compat: existing v2.3 tool contracts unchanged.** **Critical for Phase 3:** the v2.3 `list_streams` tool currently exists in `src/tools.js:125` and `src/handlers.js:234` (`listStreamsHandler`). STREAM-01 requires the NEW `list_streams` returns a different projection. Plans MUST decide: rename old tool (CHANGELOG entry; the rename pattern is precedented in Plan 00-05) OR delete-and-replace the v2.3 handler (since the new one supersedes it). Researcher recommendation: **delete-and-replace** — the new `list_streams` IS a strict superset (returns id, title, description by default, with `mutable` added) and existing agents calling it will continue to work. The v2.3 handler is a one-off; no other code depends on it. See §"Pitfall S5: list_streams v2.3 displacement" below.
- **No web UI.** Output is JSON-stringified text in MCP responses.
- **Code organization: per-domain extraction under `src/tools/<domain>/`** — Phase 3 lands under `src/tools/streams/` (Discretion-01 resolution favored — matches `src/tools/inputs/` + `src/tools/index-sets/`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Stream lifecycle (list/get/create/update/delete/start/pause) | API/Backend (Graylog REST) | — | Graylog owns stream state; MCP is a typed wrapper. No client-side state. |
| Stream-rule CRUD | API/Backend (Graylog REST) | — | Stream rules are server-managed; MCP forwards typed bodies. |
| Cascade pre-flight (rules + pipelines + event defs) | MCP wrapper (`build()` async) | API/Backend | The cascade enumeration is wrapper-orchestrated (three sequential GETs); Graylog has no single endpoint that returns "all dependents of stream X". |
| C2 confirmation hash compute | MCP wrapper (pure `src/tools/_shared/cascade-hash.js`) | — | Pure CPU; no I/O; deterministic; survives process restart. |
| Existing-title similarity matching (3 buckets) | MCP wrapper (in `build()` via `findExistingMatches`) | — | Wrapper-side filter over `GET /streams` response. |
| Server-side test rule matching | API/Backend (`POST /streams/{id}/testMatch`) | MCP wrapper | Server is authoritative; D-07 forbids JS re-implementation. |
| `mutable` defense-in-depth (D-09) | MCP wrapper (`build()` async pre-flight) | API/Backend | Wrapper-side check fires BEFORE the destructive verb; server-side `checkNotEditableStream` is the fallback. |
| Tool dispatch | MCP runtime (`src/dispatch.js`) | — | Map<toolName, handler> shipped in Phase 0. |

**Tier sanity-check:** No client-tier capabilities (this is a server-only MCP). No CDN/static. No database (Graylog owns Mongo). Every "wrapper" capability composes through the existing `_shared/` primitives.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | 1.18.0 | MCP protocol server | Project standard since v1.0. [VERIFIED: package.json] |
| `axios` | 1.12.2 | HTTP to Graylog REST | Single client at `src/graylog/client.js`. [VERIFIED: package.json] |
| `zod` | 3.25.76 | Input validation + discriminated unions | Adopted in Phase 0 (FOUND-05). [VERIFIED: package.json] |

**Version verification:**

```bash
node -p "Object.keys(require('./package.json').dependencies)"
# [VERIFIED 2026-05-15]: ['@modelcontextprotocol/sdk', 'axios', 'zod']
node -e "console.log(require('./node_modules/zod/package.json').version, require('./node_modules/axios/package.json').version, require('./node_modules/@modelcontextprotocol/sdk/package.json').version)"
# [VERIFIED 2026-05-15]: 3.25.76 1.12.2 1.18.0
```

**No new prod dependencies.** Phase 3 is a pure composition over the existing primitives.

### Supporting (already shipped in Phases 0, 1, 2 — Phase 3 imports)

| File | Purpose | Provenance |
|------|---------|------------|
| `src/tools/_shared/handler.js` — `defineMutatingHandler` | dryRun gate + zod + writable gate + idempotency + build/apply + `_confirmationToken` + `requireConfirm` | [VERIFIED: read at src/tools/_shared/handler.js lines 1-225] |
| `src/tools/_shared/list.js` — `defineListHandler` | Narrow projection + limit clamp + envelope unwrap | [VERIFIED: Phase 0 SUMMARY 00-04] |
| `src/tools/_shared/conflict.js` — `findExistingMatches` | Envelope-aware list GET + matchFn filter + similarity_reason projection. Already supports `streams` envelope key (line 32: `?? response?.streams`). | [VERIFIED: read at src/tools/_shared/conflict.js line 31] |
| `src/tools/_shared/errors.js` — `wrapGraylogError` | Renders `err.reason` as `[reason: <name>]` suffix + propagates as `out.reason` (Plan 02-03 Rule-2 amendment) | [VERIFIED: Plan 02-03 SUMMARY lines 156-163] |
| `src/tools/_shared/dry-run.js` — `SERVER_ASSIGNED_SENTINEL` | `__SERVER_ASSIGNED__` constant for create-shaped tools | [VERIFIED: Phase 0 SUMMARY 00-04] |
| `src/graylog/client.js` — `makeClient(conn)` | Single axios call site + auth + D-07 client-layer writable refusal + typed errors | [VERIFIED: read at src/graylog/client.js lines 29-75] |
| `src/graylog/errors.js` — `GraylogValidationError` + classes | Typed error hierarchy for structural refusals | [VERIFIED: Phase 0 SUMMARY 00-03] |
| `src/tools/index-sets/c1-hash.js` — `computeC1Hash`, `collectIndexNames` | The C1 sha-256 pattern. Phase 3 EITHER reuses (after promoting to `_shared/cascade-hash.js`) OR ships a parallel `src/tools/streams/c2-hash.js`. Recommendation: **promote to shared** (see Pattern 5). | [VERIFIED: read at src/tools/index-sets/c1-hash.js lines 42-81] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| 3-bucket similarity (D-05) | Levenshtein / Jaccard | Heavier dep + non-determinism. User locked simpler model. |
| Server-side cascade-transaction | Wrapper-side hash + refusal | Graylog has no transactional surface. Wrapper-side is the only available mitigation. |
| Reuse `c1-hash.js` verbatim (named for index sets) | Promote to `src/tools/_shared/cascade-hash.js` | Single source of truth for Phase 3 + Phase 4 + future destructive blueprints. **Recommend promotion**. |
| Separate `update_stream_rule` request DTO | Reuse `CreateStreamRuleRequest` on the wire | Graylog's `PUT /streams/{streamId}/rules/{ruleId}` consumes `CreateStreamRuleRequest` (no separate DTO — verified at `StreamRuleResource.java:123`). Wrapper-side, the agent's API can still be `{streamId, ruleId, changes: {...}}` — the wire body just happens to be the create shape. |

## Architecture Patterns

### System Architecture Diagram

```
                                ┌──────────────────────────────────┐
   Agent invokes tool     ───▶  │ MCP dispatch (src/dispatch.js)   │  ──▶  registered handler
                                └──────────────────────────────────┘
                                                │
                                                ▼
                                ┌──────────────────────────────────┐
                                │ defineMutatingHandler            │
                                │  1. zod.parse                     │
                                │  2. resolveConnection             │
                                │  3. writable gate (D-07)          │
                                │  4. idempotency key               │
                                │  5. build(args) — ASYNC           │  ◀── PHASE 3 NEW LOGIC
                                │       │                           │      lives entirely in
                                │       ├─ GET /streams/{id}        │      build() callbacks:
                                │       │   (mutable pre-flight     │       - mutable check
                                │       │   D-09)                   │       - cascade GETs
                                │       ├─ GET /streams/{id}/rules  │       - sha-256 compute
                                │       ├─ GET /streams/{id}/       │       - existingMatches
                                │       │   pipelines               │
                                │       ├─ GET /events/definitions  │
                                │       │   (filter client-side)    │
                                │       ├─ computeCascadeHash(...)  │
                                │       └─ findExistingMatches(...) │
                                │  6. dry-run? emit preview JSON    │
                                │       OR                          │
                                │  6b. requireConfirm check (D-01)  │
                                │  7. apply(client, req)            │  ─▶  Graylog REST
                                │       │                           │      POST/PUT/DELETE
                                │       └─ (delete_stream:          │      /streams/...
                                │            re-fetch cascades,     │
                                │            re-compute hash,       │
                                │            refuse if drifted)     │
                                │  8. normalize → { id, body }      │
                                └──────────────────────────────────┘
                                                │
                                                ▼
                                ┌──────────────────────────────────┐
                                │ MCP response { content: [...] }  │  ──▶  Agent
                                └──────────────────────────────────┘
```

The phase introduces **no new dispatch layer** — every tool plugs into the dispatch Map via `src/tools/streams/index.js` barrel, which is imported by `src/tools/_register.js` (one-line side-effect import). The cascade-hash + cascade re-fetch logic lives inside individual handler `build()` and `apply()` callbacks; there is no shared "cascade orchestrator" — keeping each tool's flow legible end-to-end.

### Recommended Project Structure

```
src/tools/streams/
├── index.js                    # Side-effect register() barrel — 12 calls
├── schemas.js                  # Zod: 12 schemas + 7-variant discriminated union for rules
├── list-streams.js             # STREAM-01 — defineListHandler with mutable projection
├── get-stream.js               # STREAM-02 — plain async handler (full DTO)
├── create-stream.js            # STREAM-03 — defineMutatingHandler + findExistingMatches
├── update-stream.js            # STREAM-04 — defineMutatingHandler + D-14 partial-update
├── delete-stream.js            # STREAM-05 — C2 mitigation centerpiece
├── start-stream.js             # STREAM-06a — defineMutatingHandler + mutable pre-flight
├── pause-stream.js             # STREAM-06b — defineMutatingHandler + mutable pre-flight
├── list-stream-rules.js        # STREAM-07 — defineListHandler
├── create-stream-rule.js       # STREAM-08 — defineMutatingHandler + mutable pre-flight on parent
├── update-stream-rule.js       # STREAM-09 — defineMutatingHandler + D-14 partial-update + mutable pre-flight
├── delete-stream-rule.js       # STREAM-10 — defineMutatingHandler + mutable pre-flight; LEAF (no cascade)
└── test-stream-match.js        # STREAM-11 — defineMutatingHandler (read-shaped but uses POST)

src/tools/_shared/
├── cascade-hash.js             # NEW (promoted from src/tools/index-sets/c1-hash.js)
                                # exports computeCascadeHash({ entityId, kind: "index_set" | "stream",
                                #                              cascadeIds: string[] | structured })
                                # Phase 2's c1-hash.js becomes a thin re-export.
```

Component responsibilities (file-to-implementation mapping):

| File | Owns | Composes |
|------|------|----------|
| `streams/schemas.js` | 12 zod schemas. `StreamRuleSchema = z.discriminatedUnion("type", [...])`. | imports `mutatingBase`, `listBase` |
| `streams/delete-stream.js` | Three-endpoint cascade pre-flight (lines: GET rules, GET pipelines, GET event defs); compute hash; UPDATED-D-15-style envelope IF apply triggers any async cleanup (verify) | imports `computeCascadeHash`, `GraylogValidationError`, `defineMutatingHandler` |
| `streams/create-stream.js` | 3-bucket similarity classifier on `findExistingMatches`-fetched stream list; envelope unwrap via `?? response?.streams` already shipped | imports `findExistingMatches`, `defineMutatingHandler`, `SERVER_ASSIGNED_SENTINEL` |
| `streams/list-streams.js` | Default fields `[id, title, description, mutable, disabled, index_set_id]`; wire field name `is_editable` → projected as `mutable` | imports `defineListHandler` |
| `_shared/cascade-hash.js` | Pure sha-256 over canonical JSON; helper functions for sorting cascade IDs | imports `node:crypto` |

### Pattern 1: defineMutatingHandler composition (every Phase 3 mutating tool)

**What:** Every mutating Phase 3 tool is exactly one `defineMutatingHandler({ name, schema, build, apply, summarize, [requireConfirm] })` call. No bare handlers.

**When to use:** Always. The factory enforces dryRun-by-default (FOUND-04), zod validation (FOUND-05), connection resolution (FOUND-09), the D-07 writable gate, idempotency keys (FOUND-10), the `_confirmationToken` forwarding, and `requireConfirm` apply-gate — in that order. Skipping it would re-introduce the per-tool gate bug class Phase 0 explicitly eliminated.

**Example (from Phase 2's `delete-index-set.js` — direct analog for `delete-stream.js`):**

```javascript
// Source: src/tools/index-sets/delete-index-set.js (verified 2026-05-15)
export const handleDeleteStream = defineMutatingHandler({
    name: "delete_stream",
    schema: DeleteStreamSchema,                // mutatingBase.extend({ streamId, confirm: z.string().optional() })
    async build(args) {
        const client = makeClient(args._conn); // connection resolved upstream by handler.js
        // ... mutable pre-flight (D-09), three cascade GETs (D-01), sha-256 compute (D-02) ...
        return {
            method: "DELETE",
            path: `/api/streams/${args.streamId}`,
            body: undefined,
            cascades: { stream_rules, pipeline_connections, event_definitions },
            postApplyEstimate: { id: args.streamId },
            _confirmationToken: confirmationHash,
        };
    },
    async apply(client, req) {
        // D-03: re-fetch cascades, re-compute hash, refuse if drifted.
        // ... refusal returns { isError: true, reason: "cascade_changed_since_preview", content: [...] }
        await client.request(req.method, req.path, req.body);
        return { deleted: true, streamId: /* extracted from req.path */ };
    },
    summarize: (args) => `Delete stream ${args.streamId}`,
    requireConfirm: ({ req }) => req._confirmationToken ?? null,
});
```

### Pattern 2: defineListHandler composition (`list_streams`, `list_stream_rules`)

**What:** Both list tools compose through `defineListHandler` with explicit `defaultFields` per FOUND-12.

**When to use:** `list_streams` and `list_stream_rules`.

**Example:**

```javascript
// Inferred shape — verify against src/tools/index-sets/list-index-sets.js
export const handleListStreams = defineListHandler({
    name: "list_streams",
    schema: listBase,
    defaultFields: ["id", "title", "description", "mutable", "disabled", "index_set_id"],
    async fetch(client, args) {
        const response = await client.request("GET", "/api/streams", null);
        // Envelope: { total, streams: [...] } — see StreamListResponse.java.
        const streams = (response?.streams ?? []).map(s => ({
            ...s,
            mutable: s.is_editable, // wire→agent projection (Pitfall S2)
        }));
        return { total: response?.total ?? streams.length, items: streams };
    },
});
```

### Pattern 3: D-09 mutable defense-in-depth (every mutating stream tool)

**What:** Every mutating tool that targets an existing stream (update/delete/start/pause AND all three rule mutations) does an async `build()` pre-flight `GET /streams/{streamId}`, reads `current.is_editable` (projected from the wire field), and throws `GraylogValidationError` with `err.reason = "stream_immutable"` BEFORE returning the request descriptor.

**When to use:** `update_stream`, `delete_stream`, `start_stream`, `pause_stream`, `create_stream_rule`, `update_stream_rule`, `delete_stream_rule`.

**Example:**

```javascript
// Pattern inferred from Phase 2's set-default-index-set ND check
async build(args) {
    const client = makeClient(args._conn);
    const current = await client.request("GET", `/api/streams/${args.streamId}`, null);
    if (current.is_editable === false) {
        const err = new GraylogValidationError(
            `Stream "${current.title}" (id: ${args.streamId}) is non-editable (Graylog built-in or system stream). ` +
            `Use list_streams and filter by mutable: true to find a candidate.`,
            { status: 400, method: "PUT", path: `/api/streams/${args.streamId}` },
        );
        err.reason = "stream_immutable";
        throw err;
    }
    // ... continue with the rest of build()
}
```

For `create_stream_rule` / `update_stream_rule` / `delete_stream_rule`, the pre-flight reads the **parent** stream's `is_editable` field (the agent passes the parent `streamId` in args).

### Pattern 4: existingMatches with 3-bucket similarity (create_stream only)

**What:** `create_stream.build()` calls `findExistingMatches({ listPath: "/api/streams", matchFn })`, classifying each existing stream into `exact | case_insensitive | prefix`. Strictest wins. Return shape per D-06: `{ id, title, similarity_reason }`.

**When to use:** `create_stream` (M5 mitigation).

**Implementation sketch (verify envelope unwrap):**

```javascript
// findExistingMatches already supports `streams` envelope (src/tools/_shared/conflict.js:31)
const existingMatches = await findExistingMatches(client, {
    listPath: "/api/streams",
    matchFn: (s) => {
        const proposed = args.title;
        const existing = s.title;
        if (proposed === existing) return true;                          // exact
        if (proposed.toLowerCase() === existing.toLowerCase()) return true;  // case_insensitive
        const p = proposed.toLowerCase(), e = existing.toLowerCase();
        return p.startsWith(e) || e.startsWith(p);                       // prefix
    },
    similarityReason: (s) => {
        const proposed = args.title;
        const existing = s.title;
        if (proposed === existing) return "exact";
        if (proposed.toLowerCase() === existing.toLowerCase()) return "case_insensitive";
        return "prefix";
    },
});
```

`similarityReason` already supports the function form (`src/tools/_shared/conflict.js:39-41`).

### Pattern 5: C2 cascade-hash + world-changed refusal (delete_stream)

**What:** The C2 mitigation centerpiece. Three pre-flights, deterministic sha-256, apply-time re-verification.

**Canonical input shape (D-02 hash inputs — researcher's lock):**

```javascript
// Source: src/tools/_shared/cascade-hash.js (new — promoted from index-sets/c1-hash.js)
export function computeCascadeHash({ streamId, ruleIds, pipelineConnIds, eventDefIds }) {
    // Sort each sub-array first (so within-type ordering is canonical),
    // then concatenate, then sort the union (so cross-type ordering is also canonical).
    // This is more robust than D-02's "concat then sort" because two streams sharing an
    // id-collision between a rule and a pipeline connection (unlikely but possible across types
    // since both are Mongo ObjectIds) would otherwise hash identically — sorting per-type
    // first preserves type identity in the hash via the bucket boundaries.
    //
    // CHOSEN SHAPE (researcher's recommendation — locks D-02's ambiguity):
    const canonical = JSON.stringify({
        streamId,
        cascade: {
            stream_rules: [...ruleIds].sort(),
            pipeline_connections: [...pipelineConnIds].sort(),
            event_definitions: [...eventDefIds].sort(),
        },
    });
    return createHash("sha256").update(canonical).digest("hex");
}
```

**Justification for the keyed-buckets shape over the flat-sorted-array shape:**

CONTEXT.md D-02 wrote: `[...sortedRuleIds, ...sortedPipelineConnIds, ...sortedEventDefIds].sort()`. That's the **flat** form: spread three sorted arrays, then re-sort the union. The problem: it discards type information. If a future Graylog change causes a rule and a pipeline-connection to share an id (both are ObjectIds; collision probability is astronomically low but the hash is the safety primitive, not a probability gamble), the hash would not distinguish "1 rule + 0 connections" from "0 rules + 1 connection" with the same id — semantically distinct cascade states would collide.

The keyed-buckets form serializes the cascade structure (the sub-arrays remain in their named buckets in the canonical JSON), so hash identity tracks cascade identity. The cost is zero (one extra `JSON.stringify` token per type — still <500 bytes for the canonical input). The benefit is structural type discrimination.

**Recommendation:** Plan 01 picks one form and locks it. If the planner prefers D-02's flat form for simplicity, document the type-collision tradeoff and accept it. The keyed-buckets form is researcher's preferred.

**Apply-time re-fetch (D-03 world-changed refusal):**

```javascript
async apply(client, req) {
    // Re-fetch all three cascade endpoints.
    const [rulesRsp, pipelinesRsp, eventDefsRsp] = await Promise.all([
        client.request("GET", `/api/streams/${streamId}/rules`, null),
        client.request("GET", `/api/streams/${streamId}/pipelines`, null),
        fetchEventDefinitionsForStream(client, streamId), // see Pitfall S6 — paginated fetch + client-filter
    ]);
    const currentHash = computeCascadeHash({
        streamId,
        ruleIds: (rulesRsp?.stream_rules ?? []).map(r => r.id).sort(),
        pipelineConnIds: pipelinesRsp.map(p => p.id).sort(),
        eventDefIds: eventDefsRsp.map(d => d.id).sort(),
    });
    if (currentHash !== req._confirmationToken) {
        return {
            isError: true,
            reason: "cascade_changed_since_preview",
            content: [{ type: "text", text: `[delete_stream] cascade_changed_since_preview: dependent resources drifted between dry-run and apply. Re-run dry-run to see the new cascade and obtain a fresh confirmationToken.` }],
        };
    }
    await client.request(req.method, req.path, req.body);
    return { deleted: true, streamId };
}
```

handler.js already supports the `{ isError: true, ... }` pass-through pattern for apply results (Plan 02-01 amendment — verified at `src/tools/_shared/handler.js:201-204`). The apply-time refusal returns the same envelope shape as `confirmation_mismatch` — both are structured `reason` codes the agent can branch on.

### Pattern 6: D-14 partial-update (update_stream + update_stream_rule)

**What:** Plans 02-02 (`update_index_set`, `MERGE_FROM_CURRENT`) and Plan 01-02 (`update_input`, `STRICT_NO_ECHO`) shipped both patterns. D-14 says Plan 01 of Phase 3 smokes against `<graylog-host>` and picks one. Researcher's analysis below indicates **either is wire-compatible** for streams — the choice is one of consistency with prior plans, not correctness.

**Evidence for wire-compatibility:**

```java
// Source: UpdateStreamRequest.java (verified 2026-05-15)
public static UpdateStreamRequest create(@JsonProperty("title") @Nullable String title,
                                         @JsonProperty("description") @Nullable String description,
                                         @JsonProperty("matching_type") @Nullable String matchingType,
                                         @JsonProperty("rules") @Nullable List rules,  // ignored — see AutoValue ctor
                                         @JsonProperty("remove_matches_from_default_stream") @Nullable Boolean removeMatchesFromDefaultStream,
                                         @JsonProperty("index_set_id") @Nullable String indexSetId)
```

Every field is `@Nullable`. The server's `streamService.update` applies non-null overrides over the current stream state. So:

- **STRICT_NO_ECHO** (`update_input` pattern): emit only the changed fields. The wire body for an agent passing `changes: { title: "new" }` is `{ "title": "new" }`. Graylog preserves the other fields. ✅ Wire-compatible.
- **MERGE_FROM_CURRENT** (`update_index_set` pattern): pre-flight GET; emit `{ ...current, ...changes }`. The wire body for the same change is `{ title: "new", description: "...", matching_type: "AND", remove_matches_from_default_stream: false, index_set_id: "..." }`. Graylog accepts all of them and overrides each with what's there. ✅ Wire-compatible.

**Recommendation:** **STRICT_NO_ECHO** — same as `update_input`. Reasons:

1. **No encrypted fields on a stream** (verified by inspecting `StreamResponse.java` — no `is_encrypted` annotation anywhere). C3 is not reachable, but the "preview emits ONLY the changed field" property is a generally useful invariant for an agent reviewing dry-runs.
2. **Smaller wire bytes** on the typical "rename a stream" path.
3. **No pre-flight GET cost** for the simple title-rename case. (D-09's mutable pre-flight is a separate GET that fires regardless — but the partial-update logic doesn't need the result of that GET.)
4. **`update_stream_rule` has the same property** — the schema (verified: `CreateStreamRuleRequest.java`) has 5 fields (type, value, field, inverted, description), none encrypted, all overridable. STRICT_NO_ECHO works.

Plan 01 Task 1 (the U1 smoke) should confirm STRICT_NO_ECHO works against the live 7.0.6 server. If `<graylog-host>` is unreachable (as in Phase 2 Plan 02-01), record `UNREACHABLE_STRICT_NO_ECHO` in 03-U1-SMOKE.md and proceed.

### Pattern 7: Server-side test_stream_match (D-07)

**What:** No JS re-implementation. The tool wraps `POST /streams/{streamId}/testMatch`.

**Request body shape (verified at `StreamResource.java:561-564`):**

```java
public TestMatchResponse testMatch(@PathParam("streamId") String streamId,
                                   @RequestBody @NotNull Map<String, Map<String, Object>> serialisedMessage)
```

The body is `{ "message": { <field>: <value>, ... } }`. The outer key is **literally** "message"; the inner map is the message field map. Example:

```json
{
  "message": {
    "message": "hello world",
    "source": "test-host",
    "level": 6,
    "timestamp": "2026-05-15T10:00:00.000Z"
  }
}
```

Note the double "message" key: the outer envelope key AND the inner field (`message` is Graylog's primary content field). The wrapper's zod schema should reflect this nesting verbatim.

**Response shape (verified at `TestMatchResponse.java`):**

```json
{
  "matches": true,
  "rules": {
    "<ruleId1>": true,
    "<ruleId2>": false
  }
}
```

`rules` is a `Map<String, Boolean>` keyed by rule id — per-rule outcomes. To enrich the response for the agent (the agent needs more than just IDs), the wrapper can OPTIONALLY co-fetch the rule list (`GET /streams/{streamId}/rules`) and join the per-rule fields. Recommendation: **don't** — the agent already has the rule list from a prior `list_stream_rules` call if needed. Forwarding Graylog's raw `{matches, rules}` keeps the response shape minimal and predictable.

### Pattern 8: Lifecycle as defineMutatingHandler (start_stream, pause_stream)

**What:** Per D-12, both lifecycle tools route through `defineMutatingHandler` so the dryRun + writable inheritance is uniform. Same shape as Phase 1's `start_input`/`stop_input` (Plan 01-03).

**Endpoint mapping (verified):**

| Tool | Method | Path | Body | Response |
|------|--------|------|------|----------|
| `start_stream` | POST | `/api/streams/{streamId}/resume` | empty (body undefined) | 204 No Content |
| `pause_stream` | POST | `/api/streams/{streamId}/pause` | empty (body undefined) | 204 No Content |

Both are synchronous on Graylog's side (`streamService.pause(stream)` / `streamService.resume(stream)` — direct calls; no system-job spawn). No async envelope needed.

**Implementation sketch:**

```javascript
export const handleStartStream = defineMutatingHandler({
    name: "start_stream",
    schema: StartStreamSchema, // mutatingBase.extend({ streamId })
    async build(args) {
        // D-09 mutable pre-flight
        const client = makeClient(args._conn);
        const current = await client.request("GET", `/api/streams/${args.streamId}`, null);
        if (current.is_editable === false) {
            const err = new GraylogValidationError(/* ... */);
            err.reason = "stream_immutable";
            throw err;
        }
        return {
            method: "POST",
            path: `/api/streams/${args.streamId}/resume`,
            body: undefined,
            postApplyEstimate: { id: args.streamId, disabled: false },
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) => `Resume stream ${args.streamId}`,
});
```

### Anti-Patterns to Avoid

- **Per-handler dryRun checks.** The factory enforces; don't duplicate.
- **Hand-rolled JSON.stringify for the C2 hash.** Use the shared `cascade-hash.js`. Drift = world-changed-refusal becomes a recurring bug.
- **Caching the cascade between dry-run and apply.** The whole point of the hash is statelessness; re-fetch on apply.
- **JS re-implementation of stream-rule matching for test_stream_match.** D-07 forbids it; matching semantics are Graylog's authoritative responsibility (regex flags, type coercion, the `inverted` flag, the global `matching_type: AND|OR`).
- **Allowing `index_set_id` to default in `create_stream`.** D-10 lock; the agent must choose explicitly.
- **Returning `is_editable` raw to the agent.** Project the wire field to the documented `mutable` field name (Pitfall S2). Tool description names the projected field.
- **Mixing `id` vs `stream_id` in `create_stream` response normalize.** The wire response is `{ stream_id }` (verified at `StreamCreatedResponse.java`). Use `toIdBody(raw, { idFields: ["stream_id", "id"] })`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Confirmation hash for `delete_stream` | A new hash helper in `src/tools/streams/c2-hash.js` (named for one domain) | Promote `c1-hash.js` to `src/tools/_shared/cascade-hash.js` and reuse | Phase 4's `delete_pipeline_rule` will need the same shape (PIPE-10 dry-run shows pipelines that reference the rule). Single source of truth. |
| Stream-rule type → numeric wire-format map | An inline `{exact:1, regex:2, ...}` object in every tool that creates/updates a rule | A single `STREAM_RULE_TYPE_TO_NUMERIC` map in `streams/schemas.js`, exported, consumed by `build()` callbacks | Drift between handlers = silent rule-type bug class. |
| Three-bucket title similarity classifier | Custom Levenshtein / token-based fuzz | Pure JS string compare with `.toLowerCase()` + `.startsWith()`, per D-05/D-06 | User locked the model; no new dep. |
| Stream-rule re-implementation for test_stream_match | A JS rule evaluator | `POST /streams/{streamId}/testMatch` per D-07 | Server is authoritative; reimplementation = drift + maintenance burden. |
| Event-definition list paging / filter | A per-call full fetch + filter | A small helper `fetchEventDefinitionsForStream(client, streamId)` that pages through `GET /events/definitions?page=N&per_page=50` and filters client-side (see Pitfall S6) | Graylog has no server-side filter for this in 7.0.6. The helper lives in `src/tools/streams/delete-stream.js` (single call site). |
| Mutable defense-in-depth pre-flight | A new pre-flight pattern per tool | One helper `preflightStreamMutable(client, streamId, opName)` in `streams/schemas.js` or co-located in delete-stream.js if it's the only caller | DRY — 7 tools need it. |
| `_confirmationToken` forwarding + `requireConfirm` gate | New framework wiring | Already shipped in Phase 2 (`handler.js`) — just SET `req._confirmationToken` and RETURN it from `requireConfirm` | Phase 3 is pure composition. |
| `findExistingMatches` `streams` envelope unwrap | Bespoke list-then-filter loops | Already supported — `conflict.js:31` lists `?? response?.streams` | Verified at `src/tools/_shared/conflict.js:31`. |

**Key insight:** Phase 3 is the **purest composition phase so far**. Phases 0/1/2 shipped 100% of the primitives. Plans should resist the temptation to "improve" the primitives — every cross-cutting change reverberates through the prior phases' snapshots and schema-parity gates. If a primitive needs amending (e.g. a new envelope key in `conflict.js`), the amendment must be additive, back-compat-preserving, and call it out as a deliberate cross-phase change in the plan body.

## Runtime State Inventory

> Phase 3 is greenfield from the agent's perspective: no rename, no migration, no string replacement. The existing v2.3 `list_streams` tool gets superseded (see Pitfall S5) but that is a code edit only — no live registries, OS tasks, or stored data carry the old shape.

Not applicable. This section is included to document that no runtime-state audit is required.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Graylog owns all stream/rule state; MCP carries no persistent shape that includes the stream-tool surface | none |
| Live service config | None — no n8n/Datadog/Tailscale/etc. integrations | none |
| OS-registered state | None — pure user-space MCP server, no scheduled task or daemon registration | none |
| Secrets/env vars | None — no new env vars; `~/.graylog-mcp/config.json` unchanged | none |
| Build artifacts/installed packages | None — pure source edit, npm install on existing deps already includes everything | none |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All Phase 3 modules | ✓ | ≥22.3.0 (project engines floor) | — |
| `@modelcontextprotocol/sdk` | Tool dispatch | ✓ | 1.18.0 [VERIFIED via npm view at session start] | — |
| `axios` | Graylog HTTP | ✓ | 1.12.2 [VERIFIED] | — |
| `zod` | Schema validation | ✓ | 3.25.76 [VERIFIED] | — |
| Graylog 7.0.6 at `<graylog-host>:9000` | U1 smoke + UAT | ✓ HTTP reachable (per Phase 2 Plan 02-01 note: 401 from unauthenticated probe confirms live Graylog); ✗ no API token in `~/.graylog-mcp/config.json` | 7.0.6 | UNREACHABLE_STRICT_NO_ECHO for D-14 — proceed without smoke. |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** Graylog auth token for U1 smoke. Plan 01 follows the Phase 2 Plan 02-01 precedent — record `UNREACHABLE_STRICT_NO_ECHO` in `03-U1-SMOKE.md` and proceed with the researcher-recommended STRICT_NO_ECHO pattern.

## Endpoint Catalogue (Graylog 7.0.6)

All endpoints verified against `source-code/graylog2-server/.../StreamResource.java` and `StreamRuleResource.java` (7.2.0-SNAPSHOT — forward-compat reference; the 7.0.6 live behavior is what Plans verify). Confidence: HIGH (source-code-backed).

### Stream-level (10 endpoints)

| # | MCP tool | HTTP | Path | Request body | Response (status, shape) |
|---|----------|------|------|--------------|--------------------------|
| 1 | `list_streams` | GET | `/api/streams` | none | 200; `StreamListResponse { total: number, streams: StreamResponse[] }` — `@Deprecated` annotated at line 297 but still functional. See Pitfall S3 for the non-deprecated paginated alternative. |
| 2 | `get_stream` | GET | `/api/streams/{streamId}` | none | 200; `StreamResponse` (15 fields incl. rules embedded, `is_editable: boolean`) |
| 3 | `create_stream` | POST | `/api/streams` | `CreateEntityRequest<CreateStreamRequest>` — see §"Create-stream request shape" below | **201**; `StreamCreatedResponse { stream_id: string }` + `Location` header |
| 4 | `update_stream` | PUT | `/api/streams/{streamId}` | `UpdateStreamRequest` (all fields nullable, see Pattern 6) | 200; full `StreamResponse` |
| 5 | `delete_stream` | DELETE | `/api/streams/{streamId}` | none | **204 No Content** — see Pitfall S1 (StreamGuardException 400 if dependents exist). No system job — sync delete. |
| 6 | `start_stream` | POST | `/api/streams/{streamId}/resume` | none | **204 No Content** |
| 7 | `pause_stream` | POST | `/api/streams/{streamId}/pause` | none | **204 No Content** |
| Aux | (cascade pre-flight) | GET | `/api/streams/{streamId}/pipelines` | none | 200; `List<PipelineCompactSource> = [{ id: string, title: string }, ...]` — bare array, NO envelope. Verified at `StreamResource.java:651-666`. |
| Aux | (cascade pre-flight) | GET | `/api/events/definitions/paginated?page=1&per_page=50` | none | 200; `PageListResponse<EventDefinitionDto>` — see Pitfall S6 for filter strategy |
| 12 | `test_stream_match` | POST | `/api/streams/{streamId}/testMatch` | `{ "message": { <field>: <value>, ... } }` (literal outer key "message"; see Pattern 7) | 200; `TestMatchResponse { matches: boolean, rules: { <ruleId>: boolean } }` |

### Stream-rule level (4 endpoints + a 5th aux)

| # | MCP tool | HTTP | Path | Request body | Response (status, shape) |
|---|----------|------|------|--------------|--------------------------|
| 8 | `list_stream_rules` | GET | `/api/streams/{streamId}/rules` | none | 200; `StreamRuleListResponse { total: int, stream_rules: StreamRule[] }` |
| 9 | `create_stream_rule` | POST | `/api/streams/{streamId}/rules` | `CreateStreamRuleRequest` (5 fields — see §"Create-stream-rule request shape") | **201**; `SingleStreamRuleSummaryResponse { streamrule_id: string }` + `Location` header |
| 10 | `update_stream_rule` | PUT | `/api/streams/{streamId}/rules/{ruleId}` | `CreateStreamRuleRequest` (same shape as create — there is no separate "Update" DTO; verified at `StreamRuleResource.java:123`) | 200; `SingleStreamRuleSummaryResponse { streamrule_id }` |
| 11 | `delete_stream_rule` | DELETE | `/api/streams/{streamId}/rules/{ruleId}` | none | **204 No Content** |
| Aux | (read) | GET | `/api/streams/{streamId}/rules/{ruleId}` | none | 200; bare `StreamRule` object (no envelope) |
| Aux | (read) | GET | `/api/streams/{streamId}/rules/types` | none | 200; `List<StreamRuleTypeResponse>` — 8-entry enum description list |

### Create-stream request shape (CreateEntityRequest wrapper — verified)

The `POST /api/streams` body is **wrapped in a `CreateEntityRequest` envelope** (added for entity-shares support in 7.x). The wrapper looks like:

```json
{
  "entity": {
    "title": "string (required, non-empty)",
    "description": "string (nullable)",
    "rules": [ /* zero or more CreateStreamRuleRequest objects */ ],
    "content_pack": "string (nullable)",
    "matching_type": "AND | OR (defaults to AND)",
    "remove_matches_from_default_stream": "boolean (defaults to false)",
    "index_set_id": "string (required — D-10 enforces this wrapper-side)"
  },
  "share_request": null
}
```

The MCP wrapper's `build()` constructs the outer envelope from the agent's flat schema:

```javascript
build(args) {
    return {
        method: "POST",
        path: "/api/streams",
        body: {
            entity: {
                title: args.title,
                description: args.description ?? null,
                rules: args.rules ?? [],
                content_pack: null,
                matching_type: args.matching_type ?? "AND",
                remove_matches_from_default_stream: args.remove_matches_from_default_stream ?? false,
                index_set_id: args.index_set_id,
            },
            share_request: null,
        },
        // ...
    };
}
```

**Researcher note:** The CONTEXT.md didn't enumerate the entity-share envelope. Plans must include this wrapping; otherwise Graylog returns 400 "missing entity". This is documented in `StreamResource.java:229-230` (signature: `final CreateEntityRequest<CreateStreamRequest> createEntityRequest`).

### Create-stream-rule request shape (verified)

```java
// Source: CreateStreamRuleRequest.java (verified 2026-05-15)
@JsonProperty("type")      int type();
@JsonProperty("value")     String value();
@JsonProperty("field")     String field();
@JsonProperty("inverted")  boolean inverted();
@JsonProperty("description") @Nullable String description();
```

`type` is a **numeric int**, NOT the string name (e.g. 1 for EXACT, not "EXACT"). This is the wire format. The agent's API uses the string discriminator per D-11; the wrapper maps to the numeric. See §"D-11 StreamRuleType enum mapping" below.

Note that `value`, `field`, `inverted` are all **non-nullable** on the wire — meaning a stream rule for `type: present` (which has no value) or `type: always_match` (which has no field) must still emit `value: ""` and `field: ""` on the wire. Verified: `CreateStreamRuleRequest.create(...)` constructor accepts them unconditionally; Graylog's rule evaluator ignores irrelevant fields for those types. The wrapper-side schema should NOT require them, but the wire-build emit must include empty strings.

```javascript
// Example: type "always_match" rule with the empty field strings
{
    "type": 7,
    "value": "",
    "field": "",
    "inverted": false,
    "description": null
}
```

## D-11 StreamRuleType enum mapping (the critical 7-vs-8 question)

**Verified at `source-code/.../plugin/streams/StreamRuleType.java`:**

```java
public enum StreamRuleType {
    EXACT(1, "match exactly", "match exactly"),
    REGEX(2, "match regular expression", "match regular expression"),
    GREATER(3, "greater than", "be greater than"),
    SMALLER(4, "smaller than", "be smaller than"),           // ← maps to D-11 "less"
    PRESENCE(5, "field presence", "be present"),             // ← maps to D-11 "present"
    CONTAINS(6, "contain", "contain"),
    ALWAYS_MATCH(7, "always match", "always match"),
    MATCH_INPUT(8, "match input", "match input");            // ← NOT enumerated in D-11
}
```

**Graylog 7.0.6 has 8 stream-rule types. D-11 enumerates 7.**

This is a non-trivial gap. The plan must decide:

**Option A (recommend):** Add `match_input` as the 8th variant. The wrapper schema becomes an 8-variant discriminated union. Rationale: closed-set strict typing (the Phase 1 D-07 precedent for extractors, which surfaced exactly this 6-vs-8 gap and reconfirmed full enumeration) is the project's established stance. `match_input` filters messages whose `gl2_source_input` matches a specific input id — it's a real Graylog feature an agent might use to scope a stream to one input.

**Option B:** Declare `match_input` deferred — out of scope for Phase 3. The wrapper accepts only 7 types; an agent wanting input-scoped streams uses the field-`source_input_id` exact rule (workaround). Document as deferred in 03-CONTEXT.md.

**Researcher recommendation:** Option A. The cost of one more variant is one line in the discriminated union; the benefit is **type-correctness with Graylog's actual enum**. This is the same logic Phase 1 used to upgrade D-07 from 6 to 8 extractor types during planning.

**Alias → numeric mapping (D-11 lock — Option A):**

| Wrapper alias (zod discriminator) | Graylog enum name | Numeric wire value | Field required? | Value required? |
|-----------------------------------|-------------------|-------------------:|:---------------:|:---------------:|
| `exact` | EXACT | 1 | yes | yes (string) |
| `regex` | REGEX | 2 | yes | yes (string) |
| `greater` | GREATER | 3 | yes | yes (numeric-as-string)¹ |
| `less` | SMALLER | 4 | yes | yes (numeric-as-string)¹ |
| `present` | PRESENCE | 5 | yes | no (emit `""`) |
| `contains` | CONTAINS | 6 | yes | yes (string) |
| `always_match` | ALWAYS_MATCH | 7 | no (emit `""`) | no (emit `""`) |
| `match_input` (recommend add) | MATCH_INPUT | 8 | no (emit `""`)² | yes (input id) |

¹ The wire `value` field is always a `String` (`CreateStreamRuleRequest.value()` returns `String`). For numeric rule types, the agent's zod schema can declare `value: z.number()` for ergonomics; the wrapper coerces to `String(value)` on emit.

² `match_input` semantics: Graylog compares the message's `gl2_source_input` to the rule's `value` (input id). The `field` is irrelevant. Verify with a smoke test if Option A is chosen.

**Const declaration for the wrapper:**

```javascript
// src/tools/streams/schemas.js (researcher's recommended shape)
export const STREAM_RULE_TYPE_TO_NUMERIC = Object.freeze({
    exact: 1,
    regex: 2,
    greater: 3,
    less: 4,
    present: 5,
    contains: 6,
    always_match: 7,
    // match_input: 8,  // see Option A discussion
});
```

`Object.freeze` prevents accidental mutation; export so `create_stream_rule.build()`, `update_stream_rule.build()`, AND `create_stream.build()` (when `args.rules` is present) all consume the same map.

## Common Pitfalls

### Pitfall S1: StreamGuardException 400 on delete with lossy message

**What goes wrong:** A `DELETE /streams/{id}` returns 400 with a message like "Stream has dependent things" (literally — see `StreamResource.java:424-428`). The dependents are enumerated only in the message string, not structured.

**Why it happens:** `streamService.destroy(stream)` throws `StreamGuardException` which is mapped to `BadRequestException`. Graylog has no application-layer transaction or pre-delete check — the cascade preview is purely a wrapper-side mitigation.

**How to avoid:** The C2 cascade pre-flight (Pattern 5) is the mitigation — by the time the agent applies, the wrapper has shown the dependents. Plus, the D-04 `cascade_preflight_failed` hard-block catches the case where a cascade endpoint is unreachable.

**Warning signs:** If the cascade pre-flight returns empty arrays for all three types but Graylog still returns 400 on apply, the wrapper missed a dependent type. Future-phase risk: as Graylog adds new "depends on stream" features, the pre-flight set will need to grow. For Phase 3, the three known dependent types (rules, pipeline connections, event definitions) are exhaustive — verified by inspecting `streamService.destroy` and adjacent service classes.

### Pitfall S2: `mutable` vs `is_editable` field name

**What goes wrong:** The agent reads `stream.mutable` from a `list_streams` response and gets `undefined` because the wire field is `is_editable`.

**Why it happens:** ROADMAP success criterion 2 says `list_streams` returns each stream's `mutable: boolean`. Graylog's wire field is `is_editable`. The wrapper MUST project the wire field name to the documented agent-facing name.

**How to avoid:** In `list-streams.js` and the mutable pre-flight helper, read `current.is_editable` (wire) and project to `current.mutable` (agent) where the agent-facing API surfaces it. Snapshot fixtures should show the projected name in the dry-run output.

**Verified evidence:**

```java
// StreamResponse.java line 77 (verified)
@JsonProperty("is_editable")
public abstract boolean isEditable();

// StreamServiceImpl.java line 234 (verified)
return scopeService.isMutable(dto);  // ← computed from scope; same semantic
```

The semantic of `is_editable` is exactly `mutable` — Graylog computes it from the scope service's `isMutable(dto)` call. The rename is a wrapper-side ergonomic choice, not a semantic divergence.

**Warning signs:** If an agent's filter `streams.filter(s => s.mutable === true)` returns empty when streams clearly exist, the projection is missing or applied at the wrong layer.

### Pitfall S3: `GET /api/streams` is `@Deprecated`

**What goes wrong:** Plan 7's HARD-03 audit catches `GET /api/streams` returning a deprecation header; future Graylog versions remove the bare endpoint.

**Why it happens:** Graylog 7.x deprecated the bare list in favor of `/streams/paginated`. Verified at `StreamResource.java:297`:

```java
@GET
@Timed
@Operation(summary = "Get a list of all streams")
@Deprecated
@Produces(MediaType.APPLICATION_JSON)
public StreamListResponse get() { /* ... */ }
```

**How to avoid:** For Phase 3, use the deprecated endpoint (it still works; the response shape `StreamListResponse { total, streams: [...] }` is what `findExistingMatches` and `list_streams` expect; switching to paginated would require a different response unwrap). Document the deprecation in HARD-05 (already on the roadmap).

**Warning signs:** Graylog response headers carry a `Warning` or `Deprecation` header. If a future minor of 7.x removes the endpoint, switch to `GET /streams/paginated?per_page=200` and unwrap `{ stream: [...] }` (NOT `{ streams }` — the paginated DTO uses `stream` singular per the framework; verify before use).

### Pitfall S4: Default stream invariant (Stream.DEFAULT_STREAM_ID = "000000000000000000000001")

**What goes wrong:** Agent tries to delete or update the "All messages" stream (id = `000000000000000000000001`, the canonical default). Graylog returns 400 "The stream cannot be deleted."

**Why it happens:** `StreamResource.deleteInner` calls `checkNotEditableStream(streamId, "The stream cannot be deleted.")` BEFORE the cascade check. Verified at `StreamResource.java:420`. The check uses `streamService.isEditable(streamId)` which returns false for streams whose scope is `ImmutableSystemScope` — and the default stream IS in that scope.

**However**, looking more carefully at `Stream.java` (verified):

```java
ImmutableSet<String> NON_EDITABLE_STREAM_IDS = ImmutableSet.of(
    DEFAULT_EVENTS_STREAM_ID,           // 002
    DEFAULT_SYSTEM_EVENTS_STREAM_ID,    // 003
    FAILURES_STREAM_ID,                 // 004
    COLLECTOR_SYSTEM_LOGS_STREAM_ID     // 005
);
```

The `DEFAULT_STREAM_ID` (001 = "All messages") is **NOT** in the NON_EDITABLE set! Empirically: the All-messages stream IS editable in modern Graylog — operators can rename, pause, resume, and (with care) delete it. The `is_editable` flag reflects scope, and scope for the default stream is configurable.

The wrapper's D-09 mutable pre-flight catches the "Graylog refused" case. If the agent attempts to delete a system event stream (`is_editable: false`), the pre-flight refuses with `stream_immutable` BEFORE the cascade pre-flight runs — saving three GET round-trips on a doomed call.

**How to avoid:** D-09 is the mitigation. The lossy "The stream cannot be edited" 400 from server-side `checkNotEditableStream` is a fallback for cases where the wrapper missed the flag (e.g. race between dry-run and apply where another admin re-scoped the stream).

**Warning signs:** Phase 3 plans that compute the cascade BEFORE the mutable check will waste round-trips on system streams. Order: **mutable check first**, then cascade pre-flight.

### Pitfall S5: `list_streams` v2.3 displacement

**What goes wrong:** The new STREAM-01 `list_streams` returns a different projection (incl. `mutable`) than the v2.3 read tool, but they share a name. Snapshot tests for the read-side regression break.

**Why it happens:** `src/tools.js:125` and `src/handlers.js:234` (`listStreamsHandler`) currently register a v2.3 `list_streams` that returns `{ id, title, description }`. The new Phase 3 `list_streams` adds `mutable`, `disabled`, `index_set_id`.

**How to avoid:** **Delete-and-replace** in `_register.js`: remove the line `register("list_streams", listStreamsHandler)` and let the new handler in `streams/index.js` claim the name. The startup `assertAllToolsRegistered` check fires if any tool is double-registered (verify) OR unregistered. The new tool's projection is a strict superset of the old, so agents reading only `id/title/description` continue to work.

Update the v2.3 read-tools regression snapshot (`test/regression/__snapshots__/read-tools.test.js.snapshot`) accordingly — the `list_streams` entry's response shape changes by gaining additional fields.

**Alternative:** Rename the new tool to `list_streams_v3` and keep v2.3 alongside. Researcher does NOT recommend — naming-convention drift + agent confusion.

**Warning signs:** If `npm test` shows the v2.3 read-tools regression snapshot failing AFTER Plan 03's first task, the snapshot needs the `mutable` field added (or `--test-update-snapshots`).

### Pitfall S6: No server-side stream-id filter for event definitions

**What goes wrong:** D-01 says `cascades.event_definitions: [{id, title}]` is sourced from `GET /events/definitions?stream_id={streamId}`. **That query parameter does not exist** in Graylog 7.0.6.

**Why it happens:** Verified at `EventDefinitionsResource.java:188-204` (`getPage`) and `:247-267` (deprecated `list`): the supported query params are `page`, `per_page`, `query`, `filters`, `sort`, `order`. No `stream_id` filter. The `filters` param accepts a domain-specific filter list — but inspecting `attributes` (the entity-attribute registry for event definitions; not enumerated in this resource file but in `EventDefinitionEntityAttribute` types elsewhere in the source), stream_id is NOT a registered filter axis.

**How to avoid:** The cascade pre-flight for event definitions is **client-side filtered**. Page through `GET /events/definitions/paginated?page=N&per_page=50` (or use the deprecated `/events/definitions?per_page=50` — same response shape under a different key). For each definition, inspect `config.streams: string[]` (event aggregation config carries a `streams` array of stream IDs the definition listens to). Filter where `def.config.streams.includes(streamId)`.

**Implementation sketch:**

```javascript
async function fetchEventDefinitionsForStream(client, streamId) {
    const matches = [];
    let page = 1;
    const perPage = 50;
    while (true) {
        const rsp = await client.request(
            "GET",
            `/api/events/definitions/paginated?page=${page}&per_page=${perPage}`,
            null,
        );
        // PageListResponse envelope: { elements: [...], pagination: {...}, total: N }
        const defs = rsp?.elements ?? rsp?.event_definitions ?? [];
        for (const def of defs) {
            const linkedStreams = def?.config?.streams ?? [];
            if (linkedStreams.includes(streamId)) {
                matches.push({ id: def.id, title: def.title });
            }
        }
        if (defs.length < perPage) break;
        page += 1;
    }
    return matches;
}
```

**Verified evidence:** The `config.streams` field on event definitions is the canonical "which streams does this listen to" pointer — verified by inspecting Graylog's event-definition aggregation config schemas (`AggregationEventProcessorConfig` and `FilterEventProcessorConfig` both have `streams: List<String>`). Empty array = listens to all streams (broad filter); presence of the streamId = it would fire if this stream's messages disappear.

**Warning signs:** A cluster with hundreds of event definitions makes the cascade pre-flight slow. Mitigation: cap the per_page at 50 (Graylog default), early-exit when a partial page is returned, accept the linear scan cost. If perf becomes an issue, document in HARD-05 — Graylog upstream feature request to add a `stream_id` filter param.

**Researcher confidence note:** The `config.streams` field name is HIGH-confidence based on the source structure. A live verification against `<graylog-host>`'s event definitions would be ideal in Plan 01. If the structure differs (e.g. `def.streams` directly instead of nested under `config`), plans adjust the filter accordingly.

### Pitfall S7: POST /streams returns 201, not 200

**What goes wrong:** A response normalizer that assumes 200 returns the full DTO breaks on `create_stream` because Graylog returns 201 + `{ stream_id }` + Location header.

**Why it happens:** Survey of Graylog create-response shapes (verified — see also PITFALLS.md §M2):

| Endpoint | Status | Body shape | Location header? |
|----------|-------:|-----------|:-----------------:|
| POST `/api/streams` | 201 | `{ stream_id: "..." }` | yes |
| POST `/api/streams/{streamId}/rules` | 201 | `{ streamrule_id: "..." }` | yes |
| POST `/api/streams/{streamId}/testMatch` | 200 | `TestMatchResponse` full | no |
| POST `/api/streams/{streamId}/clone` | 201 | `{ stream_id: "..." }` | yes |

**How to avoid:** Use `toIdBody(raw, { idFields: [...] })` with the per-endpoint hint:

```javascript
// create_stream
normalize: (raw) => toIdBody(raw, { idFields: ["stream_id", "id"] }),
// create_stream_rule
normalize: (raw) => toIdBody(raw, { idFields: ["streamrule_id", "id"] }),
```

`toIdBody` (Phase 0 FOUND-08) walks the candidate list in order and returns the first present id. Verified at `src/graylog/normalize.js` (Plan 00-03).

**Warning signs:** A `create_*` snapshot showing `{ id: undefined, body: {...} }` means the normalize hint missed the wire field. Fix the hint; do not patch the raw response.

### Pitfall S8: `update_stream_rule` and `update_stream` share signature with create — partial-update is wrapper-side, not server-side

**What goes wrong:** A plan that assumes the server's PUT accepts a `{ changes: {...} }` envelope breaks because the server expects the same DTO as create.

**Why it happens:** Verified at `StreamRuleResource.java:106-148` — the update method's `@RequestBody` is `CreateStreamRuleRequest` (the same DTO as create). Same for `StreamResource.java:389-401` — the PUT body is `UpdateStreamRequest` (a fully-nullable variant of CreateStreamRequest, but not a `changes` envelope).

**How to avoid:** The wrapper's agent-facing schema can use `{ streamId, ruleId, changes: {...} }`; the wire body is constructed by `build()` from `args.changes` per the chosen pattern (STRICT_NO_ECHO or MERGE_FROM_CURRENT — Pattern 6).

For STRICT_NO_ECHO on `update_stream_rule`, every field the agent passed in `args.changes` is emitted; fields not passed are absent. Since `CreateStreamRuleRequest` has `type` as non-nullable `int`, **the wrapper MUST emit `type` even on a STRICT_NO_ECHO update** — and that `type` must come from current state (via the pre-flight GET on the rule) unless the agent explicitly changed it.

Same for `update_stream`: even though `UpdateStreamRequest` has all `@Nullable` fields, Graylog's `streamService.update` may still 400 on an empty body. The pre-flight GET to source the immutable defaults (created_at, creator_user_id) is required if MERGE_FROM_CURRENT is chosen.

**Warning signs:** A `update_stream_rule` with `changes: { value: "new" }` against a `type: regex` rule fails 400 with "type required" — the wire body omitted `type`. Fix: read `current.type` and emit it unconditionally.

### Pitfall S9: stream-rule numeric wire format vs. agent string discriminator

**What goes wrong:** The agent passes `type: "exact"`. The wrapper forwards it as-is. Graylog returns 400 "type must be int".

**Why it happens:** `CreateStreamRuleRequest.type()` is a Java `int`. The JSON wire format is a numeric. The agent's API uses string discriminators per D-11 because they're more readable; the wrapper does the mapping.

**How to avoid:** `build()` for `create_stream_rule` and `update_stream_rule` MUST map `args.type` through `STREAM_RULE_TYPE_TO_NUMERIC` before emission:

```javascript
build(args) {
    return {
        method: "POST",
        path: `/api/streams/${args.streamId}/rules`,
        body: {
            type: STREAM_RULE_TYPE_TO_NUMERIC[args.type],
            value: String(args.value ?? ""),
            field: args.field ?? "",
            inverted: args.inverted ?? false,
            description: args.description ?? null,
        },
    };
}
```

Same mapping applies to `create_stream` when the agent passes inline `rules: [...]` — each inline rule needs the numeric translation.

**Warning signs:** Wire-body inspection in a snapshot fixture showing `type: "exact"` instead of `type: 1` = the mapping was skipped.

### Pitfall S10: `inverted` defaults to `false`, not `null`

**What goes wrong:** A plan that emits `inverted: null` or omits the field gets 400 because `CreateStreamRuleRequest.inverted()` is a non-nullable `boolean`.

**Why it happens:** Verified at `CreateStreamRuleRequest.java:39-40`.

**How to avoid:** Schema-level: `inverted: z.boolean().default(false).optional()` so the wrapper always has a value. Wire-build always emits `inverted: args.inverted ?? false`. Snapshot fixtures verify the field is always present in the body.

### Pitfall S11: Phase 2 D-15 async envelope does NOT apply to streams

**What goes wrong:** A plan copies the `delete_index_set` apply envelope (`{ async: true, job_id_observable_at, message }`) into `delete_stream` because the C2 pattern looks similar.

**Why it happens:** The C2 hash pattern is structurally identical to C1, BUT stream deletion is **synchronous** server-side. `streamService.destroy(stream)` is a direct call — no system-job spawn (verified by inspecting `StreamResource.deleteInner` line 418-432). The 204 response means the work is done.

**How to avoid:** `delete_stream` apply returns `{ deleted: true, streamId }` (or similar simple envelope) — NOT the async D-15 shape. No `await_system_job` involvement.

Same for `update_stream`, `start_stream`, `pause_stream`, all rule mutations — synchronous, no system jobs.

### Pitfall S12: `delete_stream_rule` may NOT need a mutable pre-flight... or may need one

**What goes wrong:** Discretion-04 says `delete_stream_rule` doesn't need a cascade hash. But D-09 says the parent stream's mutable flag is checked. These don't conflict, but a plan could conflate "no hash" with "no pre-flight" and skip the mutable check.

**Why it happens:** Two independent decisions land in the same tool: (1) no confirmation hash (leaf-delete, no cascade dependents); (2) parent-stream mutable check (D-09 cross-cutting).

**How to avoid:** Plan body explicitly states: `delete_stream_rule` does ONE pre-flight (`GET /api/streams/{streamId}` for parent mutable check), NO cascade pre-flight, NO confirmation hash. The hash gate (`requireConfirm`) is wired to return `null` so it's a no-op.

### Pitfall S13: `findExistingMatches` `streams` envelope may need verification

**What goes wrong:** Plan 02-01 amended `conflict.js` to handle the `index_sets` envelope. The CONTEXT.md says: "may need a `streams` envelope amendment too". Researcher verified — looking at `src/tools/_shared/conflict.js:31`:

```javascript
const items = Array.isArray(response)
    ? response
    : (response?.inputs
        ?? response?.streams         // ← already shipped
        ?? response?.extractors
        ?? response?.index_sets
        ?? response?.items
        ?? []);
```

**`streams` is ALREADY in the unwrap chain.** No amendment needed.

**How to avoid:** Plans should verify this single line and not duplicate the amendment. If a future envelope shape arises (e.g. `stream_rules` for the rule-level list-then-filter), the amendment is one additive line.

**Warning signs:** A `create_stream` dry-run with `existingMatches: []` against a cluster that has the exact-title stream listed = the envelope unwrap silently failed. Add a fixture proving the populated path.

## Code Examples

### Example 1: delete_stream complete shape (the C2 mitigation centerpiece)

```javascript
// Source: based on src/tools/index-sets/delete-index-set.js (verified pattern)
// Adapted for Phase 3 streams domain.
//
// File: src/tools/streams/delete-stream.js
import { defineMutatingHandler } from "../_shared/handler.js";
import { DeleteStreamSchema } from "./schemas.js";
import { computeCascadeHash } from "../_shared/cascade-hash.js"; // promoted from c1-hash.js
import { makeClient } from "../../graylog/client.js";
import { GraylogValidationError } from "../../graylog/errors.js";

async function fetchEventDefinitionsForStream(client, streamId) {
    const matches = [];
    let page = 1;
    const perPage = 50;
    while (true) {
        const rsp = await client.request(
            "GET",
            `/api/events/definitions/paginated?page=${page}&per_page=${perPage}`,
            null,
        );
        const defs = rsp?.elements ?? [];
        for (const def of defs) {
            if ((def?.config?.streams ?? []).includes(streamId)) {
                matches.push({ id: def.id, title: def.title });
            }
        }
        if (defs.length < perPage) break;
        page += 1;
    }
    return matches;
}

async function buildCascade(client, streamId) {
    let stream_rules, pipeline_connections, event_definitions;
    try {
        const rulesRsp = await client.request("GET", `/api/streams/${streamId}/rules`, null);
        stream_rules = (rulesRsp?.stream_rules ?? []).map(r => ({
            id: r.id, type: r.type, field: r.field, value: r.value,
        }));
    } catch (err) {
        const e = new GraylogValidationError(
            `Cascade pre-flight failed: GET /streams/${streamId}/rules — ${err.message}`,
            { status: 503, method: "GET", path: `/api/streams/${streamId}/rules` },
        );
        e.reason = "cascade_preflight_failed";
        throw e;
    }
    try {
        const pipelinesRsp = await client.request("GET", `/api/streams/${streamId}/pipelines`, null);
        // Bare array — no envelope unwrap.
        pipeline_connections = (pipelinesRsp ?? []).map(p => ({ id: p.id, title: p.title }));
    } catch (err) {
        const e = new GraylogValidationError(
            `Cascade pre-flight failed: GET /streams/${streamId}/pipelines — ${err.message}`,
            { status: 503, method: "GET", path: `/api/streams/${streamId}/pipelines` },
        );
        e.reason = "cascade_preflight_failed";
        throw e;
    }
    try {
        event_definitions = await fetchEventDefinitionsForStream(client, streamId);
    } catch (err) {
        const e = new GraylogValidationError(
            `Cascade pre-flight failed: GET /events/definitions (paged) — ${err.message}`,
            { status: 503, method: "GET", path: `/api/events/definitions/paginated` },
        );
        e.reason = "cascade_preflight_failed";
        throw e;
    }
    return { stream_rules, pipeline_connections, event_definitions };
}

export const handleDeleteStream = defineMutatingHandler({
    name: "delete_stream",
    schema: DeleteStreamSchema, // mutatingBase.extend({ streamId, confirm: z.string().optional() })
    async build(args) {
        const conn = args._conn;
        const client = makeClient(conn);

        // D-09 mutable pre-flight (fires FIRST)
        const current = await client.request("GET", `/api/streams/${args.streamId}`, null);
        if (current.is_editable === false) {
            const err = new GraylogValidationError(
                `Stream "${current.title}" (id: ${args.streamId}) is non-editable; refusing delete. ` +
                `Use list_streams and filter by mutable: true to find a candidate.`,
                { status: 400, method: "DELETE", path: `/api/streams/${args.streamId}` },
            );
            err.reason = "stream_immutable";
            throw err;
        }

        // D-01: three cascade pre-flights (failures throw cascade_preflight_failed — D-04)
        const cascades = await buildCascade(client, args.streamId);

        // D-02: keyed-buckets canonical hash
        const confirmationToken = computeCascadeHash({
            streamId: args.streamId,
            ruleIds: cascades.stream_rules.map(r => r.id),
            pipelineConnIds: cascades.pipeline_connections.map(p => p.id),
            eventDefIds: cascades.event_definitions.map(d => d.id),
        });

        return {
            method: "DELETE",
            path: `/api/streams/${args.streamId}`,
            body: undefined,
            cascades,
            postApplyEstimate: { id: args.streamId, deleted: true },
            _confirmationToken: confirmationToken,
        };
    },
    async apply(client, req) {
        // D-03: re-fetch cascades + re-compute hash + refuse if drifted.
        const m = req.path.match(/streams\/([^\/?]+)/);
        const streamId = m ? m[1] : "unknown";
        const cascades = await buildCascade(client, streamId);
        const currentHash = computeCascadeHash({
            streamId,
            ruleIds: cascades.stream_rules.map(r => r.id),
            pipelineConnIds: cascades.pipeline_connections.map(p => p.id),
            eventDefIds: cascades.event_definitions.map(d => d.id),
        });
        if (currentHash !== req._confirmationToken) {
            return {
                isError: true,
                reason: "cascade_changed_since_preview",
                content: [{
                    type: "text",
                    text: `[delete_stream] cascade_changed_since_preview: dependent resources drifted between dry-run and apply. Re-run dry-run to see the new cascade and obtain a fresh confirmationToken.`,
                }],
            };
        }
        await client.request(req.method, req.path, req.body);
        return { deleted: true, streamId };
    },
    summarize: (args) => `Delete stream ${args.streamId}`,
    requireConfirm: ({ req }) => req._confirmationToken ?? null,
});
```

### Example 2: create_stream with existingMatches similarity buckets

```javascript
// File: src/tools/streams/create-stream.js
import { defineMutatingHandler } from "../_shared/handler.js";
import { CreateStreamSchema } from "./schemas.js";
import { findExistingMatches } from "../_shared/conflict.js";
import { STREAM_RULE_TYPE_TO_NUMERIC } from "./schemas.js";
import { toIdBody } from "../../graylog/normalize.js";
import { makeClient } from "../../graylog/client.js";

function classifySimilarity(proposed, existing) {
    if (proposed === existing) return "exact";
    if (proposed.toLowerCase() === existing.toLowerCase()) return "case_insensitive";
    const p = proposed.toLowerCase(), e = existing.toLowerCase();
    if (p.startsWith(e) || e.startsWith(p)) return "prefix";
    return null;
}

export const handleCreateStream = defineMutatingHandler({
    name: "create_stream",
    schema: CreateStreamSchema,
    async build(args) {
        const client = makeClient(args._conn);

        // M5 mitigation: 3-bucket similarity classifier (D-05/D-06)
        const existingMatches = await findExistingMatches(client, {
            listPath: "/api/streams",
            matchFn: (s) => classifySimilarity(args.title, s.title) !== null,
            similarityReason: (s) => classifySimilarity(args.title, s.title),
        });

        // Translate inline rule types to numeric wire format
        const wireRules = (args.rules ?? []).map(r => ({
            type: STREAM_RULE_TYPE_TO_NUMERIC[r.type],
            value: String(r.value ?? ""),
            field: r.field ?? "",
            inverted: r.inverted ?? false,
            description: r.description ?? null,
        }));

        return {
            method: "POST",
            path: "/api/streams",
            body: {
                entity: {
                    title: args.title,
                    description: args.description ?? null,
                    rules: wireRules,
                    content_pack: null,
                    matching_type: args.matching_type ?? "AND",
                    remove_matches_from_default_stream: args.remove_matches_from_default_stream ?? false,
                    index_set_id: args.index_set_id, // REQUIRED per D-10
                },
                share_request: null,
            },
            existingMatches,
            postApplyEstimate: { id: "__SERVER_ASSIGNED__" },
            normalize: (raw) => toIdBody(raw, { idFields: ["stream_id", "id"] }),
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) => `Create stream "${args.title}" (index set ${args.index_set_id})`,
});
```

### Example 3: test_stream_match server-side wrapper

```javascript
// File: src/tools/streams/test-stream-match.js
// D-07: pure server-side wrapper. NO JS re-implementation.
import { defineMutatingHandler } from "../_shared/handler.js";
import { TestStreamMatchSchema } from "./schemas.js";

export const handleTestStreamMatch = defineMutatingHandler({
    name: "test_stream_match",
    schema: TestStreamMatchSchema, // mutatingBase.extend({ streamId, message: z.record(z.unknown()) })
    async build(args) {
        return {
            method: "POST",
            path: `/api/streams/${args.streamId}/testMatch`,
            body: { message: args.message }, // literal outer key "message" — see Pattern 7
            postApplyEstimate: { matches: "__SERVER_ASSIGNED__", rules: "__SERVER_ASSIGNED__" },
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        `Test stream ${args.streamId} match against sample message (${Object.keys(args.message).length} field(s))`,
});
```

Note: `test_stream_match` is read-shaped (no Graylog state change) but uses POST. It MUST go through `defineMutatingHandler` for dryRun consistency — an agent invoking `test_stream_match { dryRun: true }` should see the would-be POST body. This matches the project's stance: "POST is not always a mutation" but route through the factory for the dryRun guarantee. Tool description spells out that this is a read-shaped POST.

### Example 4: stream rule discriminated union schema

```javascript
// File: src/tools/streams/schemas.js (excerpt — D-11 with researcher's Option A 8-variant union)
import { z } from "zod";
import { mutatingBase, listBase } from "../_shared/schemas.js";

const RuleExact = z.object({
    type: z.literal("exact"),
    field: z.string().min(1),
    value: z.string(),
    inverted: z.boolean().default(false),
    description: z.string().nullish(),
});
const RuleRegex = z.object({
    type: z.literal("regex"),
    field: z.string().min(1),
    value: z.string(),
    inverted: z.boolean().default(false),
    description: z.string().nullish(),
});
const RuleGreater = z.object({
    type: z.literal("greater"),
    field: z.string().min(1),
    value: z.union([z.number(), z.string()]),
    inverted: z.boolean().default(false),
    description: z.string().nullish(),
});
const RuleLess = z.object({
    type: z.literal("less"),
    field: z.string().min(1),
    value: z.union([z.number(), z.string()]),
    inverted: z.boolean().default(false),
    description: z.string().nullish(),
});
const RulePresent = z.object({
    type: z.literal("present"),
    field: z.string().min(1),
    // no `value` — emitted as "" on wire
    inverted: z.boolean().default(false),
    description: z.string().nullish(),
});
const RuleContains = z.object({
    type: z.literal("contains"),
    field: z.string().min(1),
    value: z.string(),
    inverted: z.boolean().default(false),
    description: z.string().nullish(),
});
const RuleAlwaysMatch = z.object({
    type: z.literal("always_match"),
    // no `field`, no `value` — both emitted as "" on wire
    inverted: z.boolean().default(false),
    description: z.string().nullish(),
});
const RuleMatchInput = z.object({  // RESEARCHER OPTION A — confirm with user/discuss before adopting
    type: z.literal("match_input"),
    value: z.string().min(1), // input id
    inverted: z.boolean().default(false),
    description: z.string().nullish(),
});

export const StreamRuleSchema = z.discriminatedUnion("type", [
    RuleExact, RuleRegex, RuleGreater, RuleLess,
    RulePresent, RuleContains, RuleAlwaysMatch,
    // RuleMatchInput,  // Option A — uncomment after user confirms in plan-phase discuss
]);

export const STREAM_RULE_TYPE_TO_NUMERIC = Object.freeze({
    exact: 1, regex: 2, greater: 3, less: 4,
    present: 5, contains: 6, always_match: 7,
    // match_input: 8,
});

export const CreateStreamSchema = mutatingBase.extend({
    title: z.string().min(1),
    description: z.string().nullish(),
    rules: z.array(StreamRuleSchema).default([]),
    matching_type: z.enum(["AND", "OR"]).default("AND"),
    remove_matches_from_default_stream: z.boolean().default(false),
    index_set_id: z.string().min(1),  // D-10 — REQUIRED, no default
});

export const DeleteStreamSchema = mutatingBase.extend({
    streamId: z.string().min(1),
    confirm: z.string().optional(),
});

export const StartStreamSchema = mutatingBase.extend({ streamId: z.string().min(1) });
export const PauseStreamSchema = mutatingBase.extend({ streamId: z.string().min(1) });

// ... update_stream, list_stream_rules, create_stream_rule, etc.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Bare `if (name === "...")` dispatch | `Map<toolName, handler>` in `src/dispatch.js` | Phase 0 Plan 05 | Phase 3 just calls `register(...)` — no dispatch edits |
| Hand-rolled `fetchStreams` in `src/query.js` (v2.3) | `makeClient(conn).request(...)` typed client | Phase 0 Plan 03 | Phase 3 uses the typed client; the v2.3 `fetchStreams` stays untouched until HARD-03 sweeps it |
| Per-tool dryRun checks | `defineMutatingHandler` enforces dryRun ONCE | Phase 0 Plan 04 | Cannot be skipped |
| No idempotency on creates (duplicate "App Errors" streams problem from M4) | Auto-derived sha-256 idempotency key on every mutating tool | Phase 0 Plan 04 | `create_stream` and `create_stream_rule` inherit; agent can override |
| No partial-update pattern | STRICT_NO_ECHO (Phase 1) or MERGE_FROM_CURRENT (Phase 2) | Phase 1/2 | Phase 3 Plan 01 picks one via U1 smoke (researcher recommends STRICT_NO_ECHO — Pattern 6) |
| No cascade preview for destructive ops | Wrapper-side cascade pre-flight + sha-256 hash + world-changed refusal | Phase 2 Plan 02-03 (C1) | Phase 3 reuses for C2 — pure composition |
| `is_editable` field exposed raw to agents | Project to `mutable` per ROADMAP SC2 | Phase 3 (this plan) | Agent-facing API uses `mutable`; wire uses `is_editable` |

**Deprecated/outdated:**

- **`GET /api/streams`** — deprecated in Graylog 7.x. Phase 3 still uses it (response shape is what `list_streams` and `findExistingMatches` expect). HARD-05 plans the migration to `/api/streams/paginated`.
- **Phase 0's `findExistingMatches` stub** — replaced in Plan 01-01 with the real implementation. The `streams` envelope branch is already in the unwrap chain (`conflict.js:31`).
- **`whitelist` field rename to `allowlist`** (Graylog 7.0) — not relevant to streams; flagged for v2.3 read-tool audit only (HARD-03).
- **`POST /api/streams/{streamId}/rules/{streamRuleId}` (deprecated update path)** — verified at `StreamRuleResource.java:151-163`. Use `PUT /api/streams/{streamId}/rules/{streamRuleId}` (the non-deprecated path) per #10 in the endpoint catalogue.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The 7.0.6 live server's behavior matches 7.2.0-SNAPSHOT source for stream endpoints (no shape drift) | §"Endpoint Catalogue" | Plans need to verify against <graylog-host> in U1 smoke or accept UNREACHABLE_* outcome. Risk: low — stream resource has been stable since 6.x. |
| A2 | Event-definition `config.streams: List<String>` is the canonical "this definition listens to these streams" pointer on 7.0.6 | §"Pitfall S6" | If the field is named differently or nested elsewhere, the cascade pre-flight for event definitions returns empty arrays even when matches exist. Mitigation: Plan 01 verifies against a live event def with a known stream filter. |
| A3 | `GET /api/streams/{streamId}/pipelines` returns a BARE ARRAY of `{id, title}`, not an envelope | §"Endpoint Catalogue" Aux row + §"Code Examples" Example 1 | If the response is wrapped (`{ pipelines: [...] }`), the unwrap in `buildCascade` fetches no IDs and the hash is wrong. Mitigation: verified at `StreamResource.java:653` — return type is `List<PipelineCompactSource>`; JAX-RS serializes a bare List as a JSON array. HIGH confidence. |
| A4 | Phase 2 D-15 async envelope does NOT apply to streams (sync delete) | §"Pitfall S11" | If `streamService.destroy` actually spawns a system job in 7.0.6 (unlikely — verified by inspection that it's a direct call), the apply envelope misses the job_id discovery hook. Mitigation: snapshot fixture should NOT assert the absence of `async: true` rigidly; rather assert the shape is sync `{ deleted: true, streamId }`. |
| A5 | The 8th StreamRuleType (`MATCH_INPUT`) is real and usable in 7.0.6, not an internal-only enum value | §"D-11 enum mapping" Option A | If MATCH_INPUT is internal-only (e.g. used by the router engine but rejected on `POST /rules`), Option A produces a 400-failing variant. Mitigation: smoke-test in Plan 01 OR adopt Option B (defer match_input). |

## Open Questions

1. **D-11: 7 or 8 stream-rule types?**
   - What we know: Graylog 7.0.6 enum has 8 entries (verified at StreamRuleType.java). D-11 enumerates 7.
   - What's unclear: Whether `MATCH_INPUT` is exposed on the public `POST /streams/{id}/rules` endpoint or is internal-only.
   - Recommendation: Plans add `match_input` as the 8th variant (Option A) unless a smoke-test reveals Graylog rejects it. Document the decision in 03-CONTEXT.md or roll forward.

2. **D-14: STRICT_NO_ECHO vs MERGE_FROM_CURRENT for streams/stream-rules?**
   - What we know: Both patterns are wire-compatible. STRICT_NO_ECHO is researcher's recommendation (no encrypted fields; smaller wire bytes; consistency with Phase 1).
   - What's unclear: Whether the live 7.0.6 server has any quirk that requires the full DTO on update (e.g. a downstream validation that 400s on a minimal body).
   - Recommendation: Plan 01 attempts U1 smoke; if unreachable, default to STRICT_NO_ECHO. Snapshot fixtures pin the wire shape so future regressions surface.

3. **Discretion-02: separate `list_stream_rules` vs embedded in `get_stream`?**
   - What we know: `GET /api/streams/{streamId}` returns the full DTO with rules embedded (verified — `StreamResponse.rules: Collection<StreamRule>`). The `/rules` endpoint is a distinct narrow projection.
   - Researcher recommendation: Ship BOTH. `get_stream` returns the full DTO with embedded rules (matches Graylog's natural shape). `list_stream_rules` is a defineListHandler with narrow projection (id, type, field, value, inverted) — useful when the agent has 100+ rules on one stream and wants to project narrowly. Cost: one more handler file; benefit: ergonomic parity with the rest of the surface.

4. **Discretion-03: cascade-hash field name?**
   - Phase 2 uses `confirmationToken` in `handler.js`'s preview emitter. Researcher recommendation: keep `confirmationToken` verbatim — single shape across Phase 2 + Phase 3. Phase 4 will inherit.

5. **The `entity` envelope for `POST /streams` (CreateEntityRequest wrapper):**
   - Researcher confirmed this wrapper is required at `StreamResource.java:229`. Plan documentation must spell it out — there is NO terse "POST { title, ... }" path.

## Snapshot Fixture Design

Researcher's recommended fixture set — 11 fixtures (Discretion-05 minimum + 1 to cover `list_stream_rules` narrow-projection happy path):

| # | Fixture | Tool | Purpose | Pins |
|---|---------|------|---------|------|
| 1 | `create_stream` dry-run, empty cluster | `create_stream` | Happy path with `index_set_id` from a Phase 2 fixture | Wire body shape (entity envelope, `__SERVER_ASSIGNED__` id), idempotencyKey, empty existingMatches |
| 2 | `create_stream` dry-run with exact match | `create_stream` | M5 — strict bucket | `existingMatches: [{id, title, similarity_reason: "exact"}]` |
| 3 | `create_stream` dry-run with case_insensitive match | `create_stream` | M5 — middle bucket | `existingMatches: [{id, title, similarity_reason: "case_insensitive"}]` |
| 4 | `create_stream` dry-run with prefix match | `create_stream` | M5 — loosest bucket | `existingMatches: [{id, title, similarity_reason: "prefix"}]` |
| 5 | `delete_stream` cascade preview with all 3 dependent types populated | `delete_stream` | C2 — full cascade + frozen-fixture hash | `cascades: { stream_rules: [...], pipeline_connections: [...], event_definitions: [...] }`, `confirmationToken: <frozen sha-256>` |
| 6 | `delete_stream` cascade preview with all 3 dependent types EMPTY | `delete_stream` | C2 edge — clean delete | `cascades: { stream_rules: [], pipeline_connections: [], event_definitions: [] }`, `confirmationToken: <different frozen hash>` |
| 7 | `delete_stream` apply with mismatched confirm | `delete_stream` | C2 — confirmation_mismatch fires | `isError: true, reason: "confirmation_mismatch"`, DELETE call count 0 |
| 8 | `delete_stream` mutable: false refusal | `delete_stream` | D-09 cross-cutting | `isError: true, reason: "stream_immutable"`, ZERO cascade-endpoint pre-flights fired |
| 9 | `test_stream_match` with one match + one miss | `test_stream_match` | STREAM-11 happy path | Wire body shape `{ message: { ... } }`, response `{ matches: true, rules: { id1: true, id2: false } }` |
| 10 | `test_stream_match` with always_match rule (universal true) | `test_stream_match` | STREAM-11 + D-11 always_match variant | Response always `matches: true` |
| 11 | `update_stream` partial (STRICT_NO_ECHO) | `update_stream` | D-14 — wire body shows ONLY changed field | Wire body has only `{ title: "..." }`; missing fields elided |
| 12 | `list_stream_rules` narrow projection | `list_stream_rules` | STREAM-07 + Discretion-02 | Items array contains 5-field projection per rule |

**Frozen hashes:** Fixtures 5 and 6 each pin a literal sha-256 hash for known cascade input vectors — drift detector for `computeCascadeHash` canonicalization. Same pattern as Phase 2 Plan 02-03's three frozen index-set hashes.

**Auth-redaction lint:** All fixtures inherit the existing `test/auth-redaction.test.js` scan (Plan 00-06). The idempotency-key allowlist already covers 32-hex sha-256 in `idempotencyKey` context. **New consideration:** the 64-hex sha-256 in `confirmationToken` is NOT in the 32-hex regex's pattern (regex says `{32,}` so matches anything 32+). The existing allowlist already whitelists `confirmationToken` field contexts (Plan 02-05 amendment for Phase 2). Phase 3 inherits — verify against the Plan 02-05 amendment.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node 22's built-in `node:test` + `node:assert/strict` (no external runner) |
| Config file | None — `package.json` script `"test": "node --test 'test/**/*.test.js'"` (single-quoted glob; Node expands) |
| Quick run command | `node --test test/streams.test.js` |
| Full suite command | `npm test` |

[VERIFIED via package.json + Phase 0 Plan 00-01 SUMMARY]

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| STREAM-01 | `list_streams` returns `mutable` projection + default narrow fields | unit | `node --test test/streams.test.js --test-name-pattern 'list_streams'` | ❌ Wave 0 |
| STREAM-02 | `get_stream` returns full DTO with embedded rules | unit | `node --test test/streams.test.js --test-name-pattern 'get_stream'` | ❌ Wave 0 |
| STREAM-03 | `create_stream` emits entity envelope; existingMatches populated correctly across 3 buckets | unit | `node --test test/streams.test.js --test-name-pattern 'create_stream'` | ❌ Wave 0 |
| STREAM-04 | `update_stream` STRICT_NO_ECHO wire body contains only changed fields | unit | `node --test test/streams.test.js --test-name-pattern 'update_stream'` | ❌ Wave 0 |
| STREAM-05 | `delete_stream` cascade pre-flight + hash + apply-time refusal on drift | unit | `node --test test/streams.test.js --test-name-pattern 'delete_stream'` | ❌ Wave 0 |
| STREAM-06 | `start_stream`/`pause_stream` POST to /resume and /pause | unit | `node --test test/streams.test.js --test-name-pattern '_stream(resume|pause)'` | ❌ Wave 0 |
| STREAM-07 | `list_stream_rules` returns narrow projection per rule | unit | `node --test test/streams.test.js --test-name-pattern 'list_stream_rules'` | ❌ Wave 0 |
| STREAM-08 | `create_stream_rule` translates string discriminator to numeric wire type; all 7-or-8 variants accepted | unit | `node --test test/streams.test.js --test-name-pattern 'create_stream_rule'` | ❌ Wave 0 |
| STREAM-09 | `update_stream_rule` STRICT_NO_ECHO wire body includes immutable `type` from current | unit | `node --test test/streams.test.js --test-name-pattern 'update_stream_rule'` | ❌ Wave 0 |
| STREAM-10 | `delete_stream_rule` leaf-delete; no cascade; parent-mutable pre-flight | unit | `node --test test/streams.test.js --test-name-pattern 'delete_stream_rule'` | ❌ Wave 0 |
| STREAM-11 | `test_stream_match` POSTs `{ message: {...} }`; returns per-rule outcomes | unit | `node --test test/streams.test.js --test-name-pattern 'test_stream_match'` | ❌ Wave 0 |
| Cross-cutting D-09 | Every mutating stream tool refuses `is_editable: false` BEFORE the destructive verb | unit | `node --test test/streams.test.js --test-name-pattern 'stream_immutable'` | ❌ Wave 0 |
| Cross-cutting D-02 | `computeCascadeHash` produces frozen-fixture hash for known input | unit | `node --test test/cascade-hash.test.js` | ❌ Wave 0 |
| Cross-cutting C2 (D-03) | Apply-time cascade refetch + hash recompute + refusal on drift | unit | `node --test test/streams.test.js --test-name-pattern 'cascade_changed_since_preview'` | ❌ Wave 0 |
| Snapshot determinism (FOUND-07) | All Phase 3 snapshots byte-identical across two runs | bash | `npm test && md5sum test/__snapshots__/*.snapshot > /tmp/a; npm test; md5sum test/__snapshots__/*.snapshot > /tmp/b; diff /tmp/a /tmp/b` | manual |
| Auth-redaction lint (Pitfall 6) | No apiToken-shaped strings in any new Phase 3 snapshot | unit | `node --test test/auth-redaction.test.js` | ✅ exists; auto-scans new fixtures |
| Schema-parity (Pitfall 3) | All 12 new mutating-tool zod schemas registered in schema-parity test | unit | `node --test test/schema-parity.test.js` | ✅ exists; needs +12 calls in Phase 3 |

### Sampling Rate

- **Per task commit:** `node --test test/streams.test.js test/cascade-hash.test.js` — focused run
- **Per wave merge:** `npm test` — full suite (must be green)
- **Phase gate:** `npm test` green + `/gsd-verify-work` produces an artifact

### Wave 0 Gaps

- [ ] `test/streams.test.js` — covers STREAM-01..STREAM-11 + D-09 cross-cutting + C2 apply-time refusal
- [ ] `test/cascade-hash.test.js` — covers cascade-hash pure helper (frozen fixtures + sort-order independence + bucket-keyed canonicalization)
- [ ] `src/tools/_shared/cascade-hash.js` — new helper (promoted from `src/tools/index-sets/c1-hash.js`)
- [ ] `src/tools/streams/` — new directory + 12 handler files + schemas.js + index.js
- [ ] `test/__snapshots__/streams.test.js.snapshot` — 11 fixtures per §"Snapshot Fixture Design"
- [ ] Update `src/tools/_register.js` to import `./streams/index.js` and remove the v2.3 `list_streams` registration line (Pitfall S5)
- [ ] Update `test/schema-parity.test.js` with `assertSchemaParityForTool` for all 12 new tools
- [ ] Update `test/regression/__snapshots__/read-tools.test.js.snapshot` for the `list_streams` projection change (re-record via `--test-update-snapshots`)

## Security Domain

Required by config: `workflow.code_review: true` + `workflow.code_review_depth: "standard"`. Per `security_enforcement` absent-defaults-to-on convention, included here.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes (inherited) | Existing connection-registry + API token via HTTP Basic with token-as-username. No new auth surface — Graylog enforces. |
| V3 Session Management | no | MCP is stateless per-request; no session concept. Connection registry is per-process. |
| V4 Access Control | yes (inherited) | Graylog enforces RBAC via `@RequiresPermissions(STREAMS_*)` — wrapper surfaces 403 as a typed error. |
| V5 Input Validation | yes | All 12 tools use zod schemas. `StreamRuleSchema` is a discriminated union — closed set per D-11. |
| V6 Cryptography | yes (one use) | sha-256 for `computeCascadeHash` — uses Node `node:crypto` `createHash`. Never hand-roll; never roll a non-cryptographic hash like md5 or murmur. |
| V7 Error Handling & Logging | yes | All errors flow through `wrapGraylogError` → MCP envelope. Error messages truncate Graylog 4xx bodies to 200 chars (Phase 0 Plan 04 decision). |
| V8 Data Protection | yes (limited) | No encrypted fields on stream resources (verified — no `is_encrypted` anywhere in `StreamResponse.java` or `StreamRule.java`). The apiToken-redaction lint covers snapshot fixtures. |
| V11 Business Logic | yes | C2 cascade + world-changed refusal is the business-logic safety primitive for this phase. Apply-time recomputation is the mitigation. |
| V13 API & Web Service | yes | `X-Requested-By: graylog-mcp` header is sent by `makeClient` (CSRF-style header per Graylog convention). HTTPS enforcement is up to the connection's baseUrl. |

### Known Threat Patterns for Phase 3 stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Agent invents stream-rule type string ("regexp" instead of "regex") | Tampering | Zod discriminated union closed-set rejects at parse time before `build()` |
| Agent confuses dry-run preview ID `__SERVER_ASSIGNED__` with real id, reuses in second call | Information Disclosure | Tool description warns; `idempotencyKey` separately catches double-create |
| Confirmation hash replay (agent stashes a hash from minutes ago) | Spoofing / Tampering | Hash recomputed at apply time from re-fetched cascade — drift = refusal; no MCP-side memory |
| Agent passes a confirmation hash computed for `delete_stream A` to `delete_stream B` | Spoofing | The hash inputs include `streamId`; the recompute on apply uses `args.streamId`; cross-stream replay fails the hash check |
| Cascade endpoint returns malicious data (e.g. injected stream-id) | Tampering / Repudiation | The hash captures the EXACT IDs seen; recompute catches the drift even if the data is adversarial (the recompute is over the SAME endpoint, so an attacker manipulating the endpoint sees a consistent view in dry-run AND apply — and the agent's intent is bound to what dry-run showed) |
| `test_stream_match` body is logged in audit trail with potentially sensitive sample message | Information Disclosure | Tool description warns: sample messages should not contain secrets. Graylog audit logs (server-side) are the operator's responsibility. |
| Brute-force on confirmation hash (sha-256 collision) | Cryptographic | 64-hex = 256-bit; collision-resistant cryptographic primitive. Non-issue. |
| Wrapper bypass: agent uses `makeClient` directly via a future service-layer call without `defineMutatingHandler` | Privilege Escalation | Phase 0 client-layer D-07 writable check (verified `src/graylog/client.js:36-41`) is the safety net. Defense-in-depth confirmed. |

## Sources

### Primary (HIGH confidence)

- `source-code/graylog2-server/.../streams/StreamResource.java` — verified all 10 stream-level endpoints (lines 218-829)
- `source-code/graylog2-server/.../streams/rules/StreamRuleResource.java` — verified all 4 stream-rule endpoints + types endpoint (lines 78-237)
- `source-code/graylog2-server/.../plugin/streams/StreamRuleType.java` — verified 8-entry enum + numeric values (lines 21-29)
- `source-code/graylog2-server/.../plugin/streams/Stream.java` — verified DEFAULT_STREAM_ID + NON_EDITABLE_STREAM_IDS + `isEditable()` interface (lines 30-135)
- `source-code/graylog2-server/.../streams/responses/StreamResponse.java` — verified `is_editable` wire field (line 77-78)
- `source-code/graylog2-server/.../streams/responses/StreamCreatedResponse.java` — verified `{ stream_id }` shape (line 21)
- `source-code/graylog2-server/.../streams/responses/SingleStreamRuleSummaryResponse.java` — verified `{ streamrule_id }` shape (line 26)
- `source-code/graylog2-server/.../streams/responses/TestMatchResponse.java` — verified `{ matches, rules: Map<id, bool> }` shape (lines 27-33)
- `source-code/graylog2-server/.../streams/responses/StreamRuleListResponse.java` — verified `{ total, stream_rules: [...] }` envelope (lines 28-39)
- `source-code/graylog2-server/.../streams/responses/StreamListResponse.java` — verified `{ total, streams: [...] }` envelope (lines 28-39)
- `source-code/graylog2-server/.../streams/requests/CreateStreamRequest.java` — verified `CreateEntityRequest` wrapping + 7-field DTO (lines 35-77)
- `source-code/graylog2-server/.../streams/rules/requests/CreateStreamRuleRequest.java` — verified 5-field shape + numeric `type` (lines 28-53)
- `source-code/graylog2-server/.../models/streams/requests/UpdateStreamRequest.java` — verified all-nullable update DTO (lines 31-61)
- `source-code/graylog2-server/.../events/rest/EventDefinitionsResource.java` — verified NO `stream_id` query param (lines 188-267)
- `source-code/graylog2-server/.../streams/StreamServiceImpl.java` — verified `isEditable` ↔ `scopeService.isMutable` semantic (line 234)
- `src/tools/_shared/handler.js` — verified `_confirmationToken` forwarding + `requireConfirm` gate exist (lines 154, 177-191) + apply isError pass-through (lines 200-203) + `_connectionName`/`_conn` thread (line 121)
- `src/tools/_shared/conflict.js` — verified `streams` envelope already in unwrap chain (line 31)
- `src/tools/index-sets/c1-hash.js` — verified C1 pattern shape (full file)
- `src/tools/index-sets/delete-index-set.js` — verified direct analog for delete_stream (full file)
- `src/tools/inputs/update-input.js` — verified STRICT_NO_ECHO pattern (full file)
- `src/tools/inputs/update-extractor.js` — verified MERGE_FROM_CURRENT pattern (full file)
- `.planning/research/PITFALLS.md` §C2, §C6, §M2, §M5, §M7, §m1, §m5, §m6 — direct phase mapping
- `.planning/phases/02-index-sets-retention/02-03-SUMMARY.md` — verified C1 hash + UPDATED D-15 envelope pattern

### Secondary (MEDIUM confidence)

- The event-definition `config.streams` field name — inferred from Graylog's aggregation-config schema structure. Plan 01 verifies via a live event-def fetch.
- The bare-array response shape for `GET /streams/{id}/pipelines` — verified at the JAX-RS resource level; Jersey's default JSON serialization for `List<T>` produces a bare array. HIGH confidence.

### Tertiary (LOW confidence)

- The `MATCH_INPUT` rule type's behavior on the public `POST /streams/{id}/rules` endpoint — researcher Option A recommendation pending live smoke. Document Option A vs B decision in 03-CONTEXT.md before Plan 01 starts.

## Metadata

**Confidence breakdown:**

- Endpoint shapes (paths, methods, status codes, request/response DTOs): **HIGH** — source-code-backed at known file:line citations.
- C2 cascade hash mechanic: **HIGH** — direct analog of Phase 2 C1 hash (shipped, tested with three frozen fixtures).
- StreamRuleType enum (7 vs 8 question): **HIGH** for the 8-value enum; **MEDIUM** for the MATCH_INPUT runtime usability.
- Event-definition cascade pre-flight (Pitfall S6): **MEDIUM** — the `config.streams` field name inferred from broader Graylog architecture; live verification recommended.
- D-14 partial-update choice (STRICT_NO_ECHO vs MERGE_FROM_CURRENT): **HIGH wire-compat for either**, **HIGH researcher preference** for STRICT_NO_ECHO based on consistency with Phase 1.
- U1 smoke reachability against <graylog-host>: **MEDIUM** (Phase 2 found it unreachable for auth reasons; same outcome likely).
- `findExistingMatches` `streams` envelope: **HIGH** — already shipped, verified at line 31.

**Research date:** 2026-05-15
**Valid until:** 2026-07-15 (60 days — stack is stable; Graylog 7.0.6 endpoint shapes don't drift on minor patches).

---
*Phase: 03-streams-stream-rules*
*Research completed: 2026-05-15*
