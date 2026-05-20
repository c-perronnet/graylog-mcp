# Phase 10: Entity Sharing Write Path — Research

**Researched:** 2026-05-20
**Domain:** Graylog 7.0.6 entity-share commit endpoint, integrated with the v3.0.0 mutating-handler safety stack (`defineMutatingHandler` + cascade-hash drift refusal) on top of the Phase 8/9 authz foundation.
**Confidence:** HIGH

## Summary

Phase 10 is the milestone's headline tool: `share_entity`. The work is structurally well-bounded because **every architectural decision is already made and source-verified** by Phases 8 and 9 — the corrected endpoint (`POST /api/authz/shares/entities/{entityGRN}`, no `/prepare` suffix), the read-merge-write requirement (Pitfall 1 / `EntitySharesService.updatePrimaryEntityShares` full-replace semantics), the standalone confirmation hash (`computeShareGrantHash` byte-pinned to `3a410b0a...ca41`), the `/prepare` round-trip for both grantee resolution and current-state read, and the live-7.0.6 `EntityShareResponse` wire shape (committed fixture). The remaining work is composition, not invention.

The cleanest implementation is a single `share_entity` tool (no sibling `revoke_entity_share`) built on `defineMutatingHandler` with an async `build()` that mirrors `connect_pipelines_to_stream.js` (the GET-merge-POST acceptance-gate precedent) — but reading current state via the Phase 9 `fetchEntitySharePreview` helper instead of a custom GET. Revoke is expressed as `revoke: true` on the same tool because the underlying handler is identical (re-POST the merged grant set minus one grantee), and a sibling tool would duplicate the entire build-merge-hash pipeline for no surface gain.

**Primary recommendation:** Use `defineMutatingHandler` with an async `build()` that calls `fetchEntitySharePreview` twice (dry-run: once for grantee resolution + merge + token; apply: once for re-prepare + re-hash + drift refusal), compute the confirmation token via the already-shipped `computeShareGrantHash`, and surface `validation_result` / `missing_permissions_on_dependencies` / `synced_entities` as structured output fields on the preview and apply envelopes. The `requireConfirm` gate (handler.js step 6b) and writable-flag short-circuit (step 3) are reused unchanged — no new wrapper machinery.

## User Constraints (from CONTEXT.md)

No CONTEXT.md exists for Phase 10 yet (only ROADMAP success criteria and REQUIREMENTS.md). This research is therefore unconstrained by user-locked decisions beyond the milestone-level constraints in CLAUDE.md and PROJECT.md.

### Project Constraints (from CLAUDE.md)

These directives constrain Phase 10 with the same authority as locked decisions:

- **Tech stack:** Node.js ≥18 ESM; existing dependencies only (`@modelcontextprotocol/sdk`, `axios`, `zod`); `zod` is the validation primitive — no new deps.
- **Graylog version:** 7.0.6 single target; no multi-version branching.
- **Auth model:** Existing connection registry + API token; no new auth concepts; 403 surfaces as upstream error.
- **Safety:** Every mutating tool MUST default to `dryRun: true`. Applying without an explicit `dryRun: false` is a bug.
- **Backward compat:** Existing v2.3 tool contracts unchanged; existing connection-config schema additive only.
- **No web UI:** MCP server only; output is JSON-stringified text in MCP responses.
- **Code organization:** New admin tools extract into `src/tools/<domain>/` per-domain modules — NOT inline in `src/index.js`. Use the established `src/tools/authz/` pattern.
- **GSD workflow enforcement:** Plan creation goes through `/gsd:plan-phase`; do not edit files outside a GSD workflow.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SHARE-01 | Agent can grant a user view/manage/own access to a stream via `share_entity` | `defineMutatingHandler` + Phase 9 `fetchEntitySharePreview` for current state + capability enum (Phase 8 `schemas.js`) |
| SHARE-03 | Agent can revoke a user's access to an entity | Same `share_entity` tool with `revoke: true` flag; merged set = current minus grantee (mirrors `disconnect_pipelines_from_stream.js` GET-subtract-POST) |
| SHARE-04 | `share_entity` accepts a username and resolves it to the user-GRN | Resolve from `available_grantees[].title` in the `/prepare` response — same call that reads `active_shares`; no extra round trip |
| SHARE-05 | `share_entity` is read-merge-write — adding never silently revokes | `connect_pipelines_to_stream.js` GET-merge-POST acceptance-gate precedent (lines 67-79); mandate the three-grantee test |
| SHARE-06 | Surface `validation_result` and `missing_permissions_on_dependencies` as structured output | Parse HTTP 400 body (Graylog returns full `EntityShareResponse` on validation failure); surface both as named fields in preview and apply envelopes |
| SHARE-07 | Agent can share a dashboard via `share_entity` | `entityType` zod enum already includes `dashboard` (Phase 9 schemas.js ENTITY_TYPES); only the GRN type token changes; no new code |
| SHARE-08 | Agent can share a saved search via `share_entity` | Same — `entityType` already includes `search` (Phase 9); covered by GRN-type-parameterized tests |
| AUTHZ-01 | Mutating authz tools default to dryRun, return sha-256 token, refuse on drift | `mutatingBase.dryRun: true` default + `_confirmationToken` + `requireConfirm` callback all reused from v3.0.0; recompute hash on apply and compare against re-prepared current state |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Share-entity tool surface (input parse, dry-run, apply, error envelope) | MCP server / `src/tools/authz/share-entity.js` | — | New per-domain tool file; mirrors `src/tools/pipelines/connect-pipelines-to-stream.js`. |
| Confirmation-token computation | Shared primitive / `src/tools/_shared/cascade-hash.js` (`computeShareGrantHash`) | — | Already shipped by Phase 8 Plan 02; byte-pinned. |
| GRN build/parse + shareable-type guard | Domain primitive / `src/tools/authz/grn-helpers.js` (`buildGrn`, `resolveEntityGrn`) | — | Already shipped by Phase 8 Plan 01 + Phase 9 post-fix shareable-type guard. |
| `/prepare` round-trip (read current grants + grantee resolution) | Domain primitive / `src/tools/authz/prepare-share.js` (`fetchEntitySharePreview`) | — | Already shipped by Phase 9; both read tools and Phase 10's `build()` use it. |
| Mutating-handler safety stack (dryRun default, writable gate, idempotency, requireConfirm) | Shared primitive / `src/tools/_shared/handler.js` (`defineMutatingHandler`) | — | v3.0.0 infrastructure; reused unchanged. |
| HTTP transport (POST with body, error classification) | `src/graylog/client.js` (`makeClient(conn).request`) | — | v2.3 client; supports POST-with-body and 400-with-body parsing. |
| Drift refusal (TOCTOU) | `build()` re-call on apply path → recompute token → handler.js `requireConfirm` gate (step 6b) | `src/graylog/client.js` 400-body parsing | The wrapper-level `requireConfirm` step at handler.js:211-225 is what enforces the equality check between agent-echoed `args.confirm` and the recomputed token. |
| Validation-result + dependency surfacing | `share-entity.js` build() (preview) + apply() (post-commit + 400 body) | `errors.js` `wrapGraylogError` | The 400-with-body case is the trickiest — see Pitfall 1. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | 1.18.0 [VERIFIED: package.json] | MCP server framework | Already in use; no upgrade. |
| `axios` | 1.12.2 [VERIFIED: package.json] | HTTP client (Basic auth, POST with JSON body, 400-body parsing via `validateStatus: () => true` in `src/graylog/client.js`) | Already in use. |
| `zod` | 3.25.76 [VERIFIED: package.json] | Schema validation, including `.refine()` for entityGrn-XOR-(entityType,entityId) and `revoke`+`capability` interaction | Already in use; Phase 9 `GetEntitySharesSchema` precedent. |
| `node:crypto` | built-in | sha-256 confirmation token via `computeShareGrantHash` | Already in use; `cascade-hash.js`. |
| `node:test` + `c8` | built-in / dev | Offline fixture-replay tests via `_setCaptureRequest` seam; `npm test` runs the offline suite only | Phase 9 `test/authz-entity-shares.test.js` precedent. |

### Supporting (already shipped — DO NOT reinstall)
| Symbol | Source | Phase | Purpose |
|--------|--------|-------|---------|
| `defineMutatingHandler` | `src/tools/_shared/handler.js` | v3.0.0 Phase 0 | dryRun default, writable gate, idempotency, build/apply split, `requireConfirm` gate |
| `mutatingBase` | `src/tools/_shared/schemas.js` | v3.0.0 Phase 0 | zod object with `dryRun: z.boolean().default(true)`, `connectionName`, `idempotencyKey` |
| `computeShareGrantHash` | `src/tools/_shared/cascade-hash.js:303` | Phase 8 Plan 02 | sha-256 over `{entityGrn, grants:[{grantee,capability}] sorted by grantee}`; byte-pinned to `3a410b0a3f88d967b1586a6193248baa6652a2ab5beef16f6b785e125872ca41` |
| `buildGrn` / `parseGrn` / `isGrn` / `GRN_TYPES` | `src/tools/authz/grn-helpers.js` | Phase 8 Plan 01 | Pure GRN string functions; restricted 6-type set |
| `resolveEntityGrn` | `src/tools/authz/grn-helpers.js:156` | Phase 9 post-fix | Normalize zod-validated args to canonical share-target GRN; rejects grantee-type GRNs |
| `Capability` enum | `src/tools/authz/schemas.js:17` | Phase 8 Plan 01 | `z.enum(["view", "manage", "own"])` |
| `ENTITY_TYPES` enum (private) | `src/tools/authz/schemas.js:29` | Phase 9 Plan 01 | `z.enum(["stream", "dashboard", "search"])` — SHARE-07/08 already covered structurally |
| `fetchEntitySharePreview(client, grn)` | `src/tools/authz/prepare-share.js:36` | Phase 9 Plan 01 | `POST .../entities/{encoded-grn}/prepare` with `{}` body; has self-guard asserting path ends in `/prepare` |
| `resolveConnection`, `makeClient`, `wrapGraylogError`, `errorResponse`, `formatZodError` | `src/tools/_shared/{connection,errors}.js`, `src/graylog/client.js` | v3.0.0 | Already used by Phase 9 handlers |
| Live 7.0.6 `EntityShareResponse` fixture | `test/fixtures/authz/prepare-response-7.0.6.json` | Phase 8 Plan 03 | Used by offline tests via `_setCaptureRequest` |

**Installation:**
```bash
# Zero new dependencies. All required primitives are already installed.
# Verification:
npm view @modelcontextprotocol/sdk version  # 1.18.0+
npm view axios version                      # 1.12.2+
npm view zod version                        # 3.25.76+ (3.x line; .refine + .extend used heavily)
```

**Version verification:** Performed in Phase 8/9 — confirmed against `package.json`. No upgrade required.

## Package Legitimacy Audit

Phase 10 installs **no new packages**. All primitives (`axios`, `zod`, `@modelcontextprotocol/sdk`, `node:crypto`, `node:test`) are already in `package.json` and were vetted in v3.0.0 and Phase 8/9. The slopcheck gate is therefore non-applicable for this phase. If a planner-time decision adds a new dependency, that addition is itself a deviation from CLAUDE.md ("Zero new dependencies; new code under `src/tools/authz/`") and must be escalated to the user.

## Architecture Patterns

### System Architecture — `share_entity` Apply Path

```
agent: share_entity({
    entityType:"stream", entityId:"6a08...",      // OR entityGrn
    granteeUsername:"alice",                      // resolved → grantee-GRN inside build()
    capability:"view",
    dryRun:false,
    confirm:<token from prior dry-run>
})
   │
   ▼
src/index.js  CallTool → dispatch("share_entity") → handleShareEntity  (defineMutatingHandler)
   │
   │  ┌──────────────────────────────────── handler.js steps ──────────────────────────────────┐
   │  │ 1. zod.parse(args)               schemas.js  ShareEntitySchema (mutatingBase + refine) │
   │  │ 2. resolveConnection             with _testConnection seam re-merge                     │
   │  │ 3. conn.writable === false?      → isError: connection_read_only (BEFORE build)        │
   │  │ 4. idempotencyKey                auto-derive or use args.idempotencyKey                 │
   │  │ 5. await build({...args,_conn})  ─── pre-flight                                         │
   │  │       │                                                                                  │
   │  │       ├─ resolveEntityGrn(args)             → entityGrn  (shareable-type guard)        │
   │  │       ├─ fetchEntitySharePreview(client, entityGrn)                                    │
   │  │       │   POST /api/authz/shares/entities/{encoded-grn}/prepare   body: {}             │
   │  │       │   → EntityShareResponse (active_shares, available_grantees, …)                 │
   │  │       ├─ granteeGrn = resolveGrantee(preview.available_grantees, args.granteeUsername  │
   │  │       │                              OR args.granteeGrn)                                │
   │  │       ├─ merged = mergeGrants(preview.active_shares, granteeGrn, capability, revoke)   │
   │  │       ├─ assertOwnPreserved(preview.active_shares, merged)   ← last-own guard          │
   │  │       ├─ token = computeShareGrantHash({entityGrn, grants: mergedAsArray})              │
   │  │       └─ return { method:"POST", path:".../entities/{encoded-grn}",                    │
   │  │                   body:{selected_grantee_capabilities:mergedAsObject},                   │
   │  │                   _confirmationToken: token,                                            │
   │  │                   _previewExtras:{validation_result, missing_permissions_…,            │
   │  │                                   synced_entities, diff:{added,unchanged,removed}}    │
   │  │                 }                                                                       │
   │  │ 6. dryRun? → emit preview envelope w/ confirmationToken + previewExtras + diff         │
   │  │ 6b. requireConfirm({req}) → args.confirm === req._confirmationToken ?                  │
   │  │                              proceed : isError "confirmation_mismatch"                  │
   │  │ 7. apply(client, req)            ─── single POST                                        │
   │  │       client.request("POST", req.path, req.body)                                        │
   │  │       → 200 EntityShareResponse  OR  400 EntityShareResponse w/ validation_result      │
   │  │ 8. normalize(raw) → { id: entityGrn, body: shareResponse }                              │
   │  └──────────────────────────────────────────────────────────────────────────────────────┘
   │
   ▼
   MCP client receives  { applied:true, tool:"share_entity", result:{id, body, synced_entities} }
```

**Critical:** Because `EntitySharesService.updatePrimaryEntityShares` is full-replace, build() MUST be called twice in a complete share lifecycle — once at dry-run (to compute the token over a live `active_shares`) and once at apply (to recompute the token over a freshly re-prepared `active_shares` and detect TOCTOU drift). The wrapper already does this — `build()` runs unconditionally at handler.js step 5 regardless of `dryRun` branch.

### Recommended Project Structure (additive — no existing file deleted)

```
src/tools/authz/
├── grn-helpers.js                 # UNCHANGED — Phase 8/9
├── schemas.js                     # MODIFIED — add ShareEntitySchema (mutatingBase + .refine)
├── index.js                       # MODIFIED — register("share_entity", handleShareEntity)
├── prepare-share.js               # UNCHANGED — fetchEntitySharePreview reused
├── get-entity-shares.js           # UNCHANGED — Phase 9
├── list-grantees.js               # UNCHANGED — Phase 9
└── share-entity.js                # NEW — defineMutatingHandler + async build()

src/tools/_shared/cascade-hash.js  # UNCHANGED — computeShareGrantHash already shipped (Phase 8 Plan 02)
src/tools/_shared/handler.js       # UNCHANGED — defineMutatingHandler reused

src/tools.js                       # MODIFIED — append { name:"share_entity", description, inputSchema }

test/
├── authz-share-entity.test.js     # NEW — Wave 0 offline tests (fixture replay)
└── authz-share-entity-live.smoke.js  # NEW — gated, opt-in live UAT (throwaway entity)
```

**Wiring edits (mechanical — identical to Phase 9 Plan 01):**
1. `src/tools.js` — append one `{ name, description, inputSchema }` object for `share_entity`.
2. `src/tools/authz/index.js` — add `import { handleShareEntity }`, `register("share_entity", handleShareEntity)`.
3. `src/tools/authz/schemas.js` — append `ShareEntitySchema = mutatingBase.extend({...})` with `.refine` for input combinations.
4. Tool-count assertions in `test/list-admin-tools.test.js` (line 48, 55), `test/pipelines.test.js` (line 396, 428), `test/dashboards.test.js` (line 1737, 1743) update 93 → 94.
5. `src/tools/meta/list-admin-tools.js` `DOMAIN_OVERRIDES` — add `share_entity` to the `authz` domain (mirrors the Phase 9 fix in 09-01-SUMMARY §"Auto-fixed Issues #3").

### Pattern 1: Async `build()` GET-merge-POST (the direct precedent)

**What:** `build()` does a pre-flight `/prepare` round-trip to read current grants, merges the requested change, and returns the descriptor for the apply POST. Handler.js calls `build()` unconditionally at step 5 — same call shape for both dry-run and apply.

**When to use:** Any time the server endpoint is full-replace and the safe primitive is read-merge-write.

**Direct precedent (study line-by-line):**
```javascript
// Source: src/tools/pipelines/connect-pipelines-to-stream.js:40-92
// (the GET-merge-POST acceptance-gate handler)
export const handleConnectPipelinesToStream = defineMutatingHandler({
    name: "connect_pipelines_to_stream",
    schema: ConnectPipelinesToStreamSchema,
    async build(args) {
        const client = makeClient(args._conn);
        // 1. Pre-flight GET — fetch current state
        let current;
        try {
            current = await client.request("GET", getPath, null);
        } catch (err) {
            if (err?.isGraylogError && err.status === 404) {
                current = { stream_id: args.streamId, pipeline_ids: [] };
            } else { throw err; }
        }
        // 2. Snapshot existing-overlap BEFORE mutating — for existingMatches
        const currentSet = new Set(currentArray);
        const existingMatches = [];
        for (const id of args.pipelineIds) {
            if (currentSet.has(id)) {
                existingMatches.push({ id, similarity_reason: "already_connected" });
            }
            currentSet.add(id);
        }
        // 3. Return descriptor with merged body
        return {
            method: "POST", path: "/api/system/pipelines/connections/to_stream",
            body: { stream_id: args.streamId, pipeline_ids: [...currentSet].sort() },
            existingMatches,
            postApplyEstimate: { stream_id: args.streamId, pipeline_ids: [...currentSet].sort() },
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
});
```

**Adaptation for `share_entity`:** instead of `GET /connections/{id}`, call Phase 9's `fetchEntitySharePreview(client, entityGrn)` and merge `selected_grantee_capabilities` as a **Map<granteeGrn, capability>** (not a Set). Adding `userX:view` when `userX` already has `manage` is an **UPDATE** (overwrite the value), not an insert — surface in `existingMatches` with `similarity_reason: "capability_changed"` when the capability differs, or `"already_granted"` when unchanged. [CITED: .planning/research/ARCHITECTURE.md §"Pattern 3"]

### Pattern 2: Confirmation token over the merged set (drift refusal)

**What:** `build()` computes `computeShareGrantHash({entityGrn, grants: mergedAsArray})` and stashes it on `req._confirmationToken`. Handler.js emits it in the dry-run preview; `requireConfirm` (step 6b) checks `args.confirm === token` before apply.

**Critical question — what goes in the canonical input?** Per the byte-pinned shape (cascade-hash.js:337):
```javascript
canonical = JSON.stringify({
    entityGrn,
    grants: [{grantee, capability}, ...sortedByGrantee]
})
```
The token covers **the merged grant set (the apply body's `selected_grantee_capabilities` flattened to a sorted array)**, NOT the prior `active_shares`. Rationale:

1. The merged set IS what will be written. A hash over it ensures the apply body is byte-identical to what the dry-run promised.
2. Drift refusal works because the apply path re-runs `build()` → re-fetches `active_shares` → re-merges → recomputes the token. If `active_shares` drifted (another admin added/removed grants), the recomputed merged set differs, the token differs, and the requireConfirm gate refuses with `confirmation_mismatch`. [CITED: .planning/research/ARCHITECTURE.md §"Pattern 2"]

**Direct precedent (study byte-by-byte for the canonical form):**
```javascript
// Source: src/tools/_shared/cascade-hash.js:303-339 (already shipped, Phase 8 Plan 02)
export function computeShareGrantHash({ entityGrn, grants }) {
    // entityGrn must be non-empty string; grants must be array
    // Each grant entry must be {grantee:string, capability:string} — validated
    const sorted = [...grants]
        .map((g, i) => { /* per-entry validation */ return { grantee: g.grantee, capability: g.capability }; })
        .sort((a, b) => (a.grantee < b.grantee ? -1 : a.grantee > b.grantee ? 1 : 0));
    const canonical = JSON.stringify({ entityGrn, grants: sorted });
    return createHash("sha256").update(canonical).digest("hex");
}
```

### Pattern 3: Apply-time HTTP 400 with body — parse, don't throw

**What:** Graylog returns HTTP 400 with the full `EntityShareResponse` body (including `validation_result.failed === true`) when the apply violates a server-side invariant (ownerless, dependency block, etc.). The naive flow throws on non-2xx; the correct flow inspects the body.

**Confirmed in source:** `EntitySharesResource.java:166-170` — on `validationResult().failed()` the server still returns the full response body, just with status 400. [CITED: .planning/research/PITFALLS.md "Pitfall 3"]

**Where to handle:** Inside `share-entity.js`'s `apply()`, NOT inside `client.js`. The transport-level `client.request()` already throws a `GraylogError` with `body` populated on 4xx (see `mapGraylogError` in `src/graylog/errors.js`). The handler catches the GraylogError, inspects `err.status === 400 && err.body?.validation_result?.failed`, and emits a structured MCP error envelope with the parsed validation result — instead of the generic `wrapGraylogError` body-snippet truncation. The default 200-char truncation in `wrapGraylogError` is enough for debug visibility but not enough for structured agent consumption of `validation_result.errors`.

**Recommended structured-error shape (proposal, requires planner confirmation):**
```javascript
{
    isError: true,
    reason: "share_validation_failed",        // structured tag for agent regex
    content: [{ type: "text", text: JSON.stringify({
        tool: "share_entity",
        connection: connectionName,
        status: 400,
        validation_result: parsed.validation_result,
        missing_permissions_on_dependencies: parsed.missing_permissions_on_dependencies,
        active_shares: parsed.active_shares,   // helps agent reconstruct
    })}],
}
```

### Pattern 4: Grantee resolution via `available_grantees[].title` (no extra round-trip)

**What:** Agents speak usernames ("share to alice"); Graylog needs the user-GRN (`grn::::user:<userId>`). The `/prepare` response already returns the resolution table in `available_grantees: [{id, type, title}]`. Match `args.granteeUsername` against `title`, use the returned `id` as the grantee-GRN.

**Why this is preferred:** [CITED: .planning/research/ARCHITECTURE.md §"Pattern 4"; FEATURES.md "Username → user-GRN resolution"]
1. No second round-trip — the `/prepare` call build() already makes for `active_shares` carries `available_grantees` too.
2. Exact-match on a server-supplied list — no string-shaping mistake.
3. If the username doesn't exist, the failure mode is "username not found in available_grantees" with a clear MCP error; no spurious 404 from a separate `/api/users/{username}` call. [Citation: live fixture shows `available_grantees[].title` populated with the display name; see `test/fixtures/authz/prepare-response-7.0.6.json` lines 17-40.]

**Fallback — accept a raw `granteeGrn` instead of `granteeUsername`:** for the rare case where the agent already holds the user-GRN (e.g. echoing it from `list_grantees`). The zod `.refine` enforces XOR: exactly one of `granteeUsername` or `granteeGrn`.

**Tie-breaking on title collision:** Graylog usernames are unique per server, but display titles (the `title` field) MAY collide if non-username display names are used. If two `available_grantees[].title` entries match the input, the tool MUST refuse with a clear error rather than picking one. The Phase 9 fixture shows titles like `"User A"`, `"User C"` — these are display names, not usernames; verification against the live 7.0.6 endpoint to confirm whether `title` is always the username or sometimes the display name is **an open question for the planner** (see §"Open Questions"). [ASSUMED]: the recommendation above (refuse on collision) is conservative; alternative is documenting that title-matching is best-effort.

### Pattern 5: Revoke as a flag, not a sibling tool

**What:** Express revocation as `share_entity({entityType, entityId, granteeUsername, revoke: true})` instead of a separate `revoke_entity_share` tool. The underlying handler is identical — both call the same commit endpoint with a merged grant set; only the merge operation differs (add-or-overwrite vs delete).

**Why one tool, not two:**

1. **Same wire endpoint, same build pipeline.** Revoke = "merge current minus the named grantee, then POST". The merge primitive is shared. A sibling tool would duplicate the entire `build()` (prepare → resolve → merge → token → preview) for what is structurally a single-line variant on the merge step.
2. **Same safety stack.** Drift refusal, ownerless guard, validation_result surfacing all apply identically. A second tool would need to re-import or re-implement them.
3. **Same agent UX.** From the agent's perspective, the intent is "modify alice's access to this stream"; whether that modifies a capability or removes the grantee is a parameter, not a tool choice.
4. **Precedent split:** `connect_pipelines_to_stream` / `disconnect_pipelines_from_stream` ARE two tools, but the analogous case is closer to `update_X` than to attach/detach: attach is `ALL OF [args]`, detach is `NONE OF [args]`, the intermediate state is rare. For shares, the natural action is "set alice's access to {capability X}" and the natural revoke is the degenerate case "set alice's access to nothing." A `revoke: true` flag captures that cleanly.

**Schema implication:** zod `.refine` enforces the interaction — `revoke: true` requires `granteeUsername` (or `granteeGrn`), forbids `capability` (revoke has no capability semantics). `revoke: false` (default) requires `capability`.

**Trade-off:** A `revoke_entity_share` sibling reads more naturally in tool-list browsing ("how do I revoke?"). Mitigation: the `share_entity` tool description explicitly mentions the `revoke: true` flag ("share, change, or revoke a user's access...") so a tool-list search for "revoke" surfaces it. The 200-char description budget is tight but reachable; see Pitfall M7 (description-budget audit).

**Alternative considered but rejected:** A `mode: "grant" | "revoke"` field. Slightly more explicit but adds a second axis of complexity (mode + capability), and the JSON-schema `enum` makes the tool surface noisier. A boolean `revoke` is cleaner.

### Pattern 6: Dry-run output — explicit added/unchanged/would-be-removed diff

**What:** ROADMAP success criterion 3 mandates the dry-run "explicitly diffs grants added, unchanged, and would-be-removed." Compute this in `build()` from the comparison of `preview.active_shares` to the merged set; expose as a `diff` field on the preview envelope.

**Proposed shape:**
```javascript
diff: {
    added:    [{ grantee:"grn::::user:alice", capability:"view" }],
    changed:  [{ grantee:"grn::::user:bob",   from:"view", to:"manage" }],
    unchanged:[{ grantee:"grn::::user:carol", capability:"own" }],
    removed:  [],                                  // populated on revoke
}
```

**Important:** under the project's *additive* semantics (no `selected_grantee_capabilities` array input), the `removed` set is always empty UNLESS `revoke: true`. The agent cannot accidentally compose a request that drops a grantee — the tool's input surface doesn't expose that path. This is a structural mitigation for Pitfall 1's "silent revocation": the tool cannot syntactically express a multi-grantee delete except via single `revoke: true` operations. [Recommendation: surface a console.error or refuse-with-reason if the merged set would drop a grantee that's not the named `granteeUsername` — a should-never-happen invariant that, if it ever fires, indicates a build() bug.]

**Also surface in preview:**
- `validation_result` — pass through from `/prepare` response
- `missing_permissions_on_dependencies` — pass through from `/prepare`
- `synced_entities` — pass through (the apply will mutate these too; agent must see)

### Anti-Patterns to Avoid

- **Anti-pattern 1: POST `{selected_grantee_capabilities: {newUser: view}}` directly.** Silently revokes every other grantee. Mandate the three-grantee acceptance-gate test (see Validation Architecture below). [CITED: PITFALLS.md "Pitfall 1"]
- **Anti-pattern 2: Skip the apply-time `/prepare` re-call.** A dry-run-only token does not provide drift refusal — another admin can mutate the grant set between preview and apply. The wrapper's `build()` runs unconditionally; do not optimize it out.
- **Anti-pattern 3: Treat HTTP 400 on apply as a generic error.** Graylog returns the full `EntityShareResponse` body with structured `validation_result`. Parse it; surface `validation_result.errors` to the agent.
- **Anti-pattern 4: Resolve username via `GET /api/users/{username}`.** A separate round-trip the `/prepare` response already provides. [CITED: ARCHITECTURE.md §"Pattern 4"]
- **Anti-pattern 5: Hand-construct GRNs in `share-entity.js`.** Always go through `buildGrn` / `resolveEntityGrn`. The shareable-type guard in `resolveEntityGrn` is specifically there to prevent `share_entity(entityGrn="grn::::user:...")` from reaching the network. [CITED: 09-01-SUMMARY auto-fixed issues + grn-helpers.js:156]
- **Anti-pattern 6: Pass `null` body to `POST .../entities/{grn}` apply call.** `axios` + `src/graylog/client.js` will then send no `Content-Type: application/json` header (see client.js:55-66 — body is checked truthy). Always pass a populated `{selected_grantee_capabilities: {...}}` body, even on revoke (the merged-minus-grantee map may legitimately be `{}`, which is allowed by Graylog — "empty = remove all shares").

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| sha-256 confirmation token | Custom JSON canonicalizer + crypto call | `computeShareGrantHash` (cascade-hash.js:303) | Byte-pinned to `3a410b0a…ca41`; any drift fires a loud test failure. Forward into a different hash would also break Phase 10's drift refusal — the recomputed apply-time hash must match the dry-run hash. |
| GRN string assembly | Template-literal `` `grn::::${type}:${id}` `` | `buildGrn(type, id)` (grn-helpers.js:49) | Validates type ∈ GRN_TYPES; lowercases both args; produces exactly 6 tokens. |
| Read current grants | Bespoke axios call | `fetchEntitySharePreview(client, grn)` (prepare-share.js:36) | Has `endsWith("/prepare")` self-guard, percent-encodes GRN, sends `{}` body (correct Content-Type). |
| dryRun-default + writable-gate + idempotency | Per-tool plumbing | `defineMutatingHandler({...})` (handler.js:58) | All four invariants enforced in one place; FOUND-04 / FOUND-09 / FOUND-10. |
| Confirmation gate enforcement | Per-tool `if (args.confirm !== token) refuse` | `requireConfirm: ({req}) => req._confirmationToken` callback | Wrapper-level gate at handler.js:211-225; emits the canonical `confirmation_mismatch` reason. |
| Username → grantee-GRN resolution | `GET /api/users/{username}` round-trip | Match `available_grantees[].title` from the `/prepare` response | One fewer endpoint, exact match, no spurious 404 path. |
| 400-with-body error parsing | Custom axios interceptor | `client.request` already throws GraylogError with `err.body` populated on 4xx | `mapGraylogError` in `src/graylog/errors.js` preserves the body; handler inspects `err.body?.validation_result`. |
| Connection resolution | Per-tool `getConnection(...)` | `resolveConnection(args)` (already used by Phase 9 handlers) | Centralizes `_testConnection` seam, active-connection fallback, and the writable-flag short-circuit. |
| Tool-domain registration | Edit `src/index.js` | `src/tools/authz/index.js` barrel + `_register.js` one-line | Phase 9 already established the pattern; Phase 10 adds one `register()` call. |

**Key insight:** Phase 10 is the most-prepared-for phase in the milestone — Phases 8 and 9 deliberately shipped everything except the apply-time POST and the merge logic. The only genuinely new code is: (1) the merge step, (2) the diff computation, (3) the last-own guard, (4) the 400-with-body parser, and (5) the `share-entity.js` file that composes them. Everything else is import-and-compose.

## Common Pitfalls

### Pitfall 1: Apply-time 400 with body is a structured result, not an error

**What goes wrong:** The naive flow assumes 200 = success, ≥400 = throw. Graylog returns 400 with the full `EntityShareResponse` body when `validation_result.failed === true` (ownerless violation, dependency-permission gap, etc.). A handler that just throws loses the validation context.
**Why it happens:** REST intuition says 4xx is an error. The body-with-error idiom is Graylog-specific. `src/graylog/client.js` is configured `validateStatus: () => true` precisely so the wrapper can inspect the body, but the typed `GraylogError` thrown by `mapGraylogError` carries the body — it does NOT swallow it.
**How to avoid:**
- In `apply()`, catch `GraylogError` with `err.status === 400 && err.body?.validation_result?.failed === true`.
- Build a structured MCP error envelope (Pattern 3 above) — do NOT just let `wrapGraylogError` truncate the body to 200 chars.
- Set a `reason: "share_validation_failed"` tag so the agent can programmatically detect it.
**Warning signs:** Tool reports an opaque `[share_entity] 400 POST ...` without echoing `validation_result.errors`; agent has no way to recover.
**Verification:** Phase 10 test that simulates 400-with-body via `_setCaptureRequest` returning a `GraylogError` instance — and asserts the envelope contains `validation_result.errors` verbatim.

### Pitfall 2: The "title" in `available_grantees` may be a display name, not a username

**What goes wrong:** Code matches `args.granteeUsername === g.title` and silently picks the wrong user (or misses), because `title` is the user's display name in some Graylog configurations.
**Why it happens:** The live fixture (`prepare-response-7.0.6.json` lines 17-40) shows titles like `"User A"`, `"User C"` — these are clearly display names, not usernames. The Graylog UI labels this field "Title" not "Username." The 7.2-SNAPSHOT source `Grantee.title` is whatever the entity's "display name" is.
**How to avoid:**
- **Primary:** Accept a raw `granteeGrn` as the preferred input (skip resolution entirely). Document that `granteeUsername` is a convenience for the common case.
- **Secondary:** When `granteeUsername` is used, match `title` case-insensitively AND match against the `id`'s suffix-after-`grn::::user:` (the user's MongoDB id, which is a fallback for tools that pass it as the "username").
- **Tertiary:** On title collision (two grantees match), refuse with a clear error listing the colliding GRNs and recommending the agent pass `granteeGrn` explicitly.
- **Open question:** Confirm live 7.0.6 behaviour with a one-off probe — is there a `username` field on the grantee DTO that the Phase 9 fixture truncated? See `EntityShareResponse.java:38-147` source citation. [VERIFICATION NEEDED]
**Warning signs:** Agent passes a Graylog username (e.g., "admin") and gets "username not found in available_grantees" because Graylog's `title` is "Admin User" (titlecased). [ASSUMED]

### Pitfall 3: TOCTOU on `synced_entities`

**What goes wrong:** `EntitySharesService.resolveImplicitGrants` propagates grant changes to entities listed in `synced_entities`. The drift-refusal hash covers only the primary entity's grants; a concurrent change to a synced entity's grants slips past unnoticed.
**Why it happens:** `computeShareGrantHash` takes a single `entityGrn`. Synced entities are best-effort.
**How to avoid:**
- The Phase 8 fixture shows `synced_entities: []` (empty) for streams on the live UNESCO instance. For Phase 10, the **scope decision** is: drift refusal covers only the primary entity. If `synced_entities` is non-empty, the dry-run preview surfaces them explicitly and the apply success message lists them — but the token does not hash their grant sets.
- This is acceptable because: (a) synced entities are dashboards/searches that mirror a parent stream's grants — the parent IS the token-protected primary; (b) hashing N entities means N+1 round-trips per dry-run; (c) Graylog's `getActiveShares` excluding sharing-user's own grant means even server-side state is not strictly comparable.
- Mitigate by documenting that synced-entity drift is best-effort in the tool description.
**Warning signs:** Tests pass even though a synced entity was mutated between dry-run and apply.
**Trade-off note:** A stricter design hashes `[primary] + [synced_entities (full grants of each)]` and N+1 round-trips on every call. For v3.1.0 this is over-engineering; revisit if v2 brings cross-entity blueprints.

### Pitfall 4: `selected_grantee_capabilities: {}` IS a meaningful body (means "remove all shares")

**What goes wrong:** A naive merge that, on `revoke: true` of the only grantee, produces `{selected_grantee_capabilities: {}}` — and Graylog's `getSelectedGranteeCapabilities` doc says: *"If the grantee selection is empty, that means all shares should be removed."* This is a destructive outcome; the agent likely didn't intend to nuke all other shares.
**Why it happens:** The replace-semantics + empty-map shortcut means an apparently-narrow operation has wide blast radius if the merge logic isn't careful.
**How to avoid:**
- The build() merge logic for `revoke: true` MUST verify the merged map is non-empty unless the agent explicitly opts in.
- Even better: when the merged map is empty (after revocation), AND there were grants in `active_shares`, AND those grants are not the just-revoked grantee, fail the build with a clear `would_remove_all_shares` error. This is a structural belt-and-braces.
- Wait — the typical case is revoke leaves SOME shares behind, so the merged map is `current.size - 1` not `0`. The empty case only arises when revoking the sole grantee on an entity with only one grant. That's a valid revoke; the safeguard above must distinguish "intentional last-grant revoke" from "I think I'm revoking one but my merge logic is broken."
- **Recommendation:** for v3.1.0, require the merged map to contain the revoked grantee in `preview.active_shares` AND assert that `mergedMap.size === active_shares.length - 1` when `revoke: true`. Any size mismatch fails build with a `merge_size_mismatch` invariant error.
**Warning signs:** Body `{selected_grantee_capabilities: {}}` reaches the apply call.

### Pitfall 5: Last-`own` grant guard requires client-side detection

**What goes wrong:** ROADMAP success criterion 5 says "a request that would drop the last `own` grant is refused." Graylog DOES enforce this server-side (`EntitySharesService.validateRequest` lines 397-446 — refuses with `validation_result.failed=true` and "Removing the following owners ... will leave the entity ownerless"). BUT the Phase 10 dry-run preview must show this refusal BEFORE the apply, not just on apply failure.
**Why it happens:** Server-side guard fires at commit; without a client-side pre-check, the dry-run preview reports "success" and only the apply fails.
**How to avoid:**
- Client-side check in `build()`: if `preview.active_shares` contains any `capability === "own"` grants, verify the merged set ALSO contains at least one `own` grant. If not, fail build with `reason: "would_leave_entity_ownerless"`.
- Bypass note: `getForTargetExcludingGrantee` excludes the sharing user's own grant from `active_shares` (see PITFALLS.md "Pitfall 3" — "the sharing user's own grant is excluded by design"). So the client-side check sees a *partial* view of owners. If `active_shares` shows 0 owners, the sharing user themselves is presumed to be an owner (otherwise the share call would 403). The check is: `mergedSet.someCapEquals("own") || (active_shares.length === 0 && active_shares had 0 owners before merge)`. Concretely: if active_shares is `[]` we cannot reason about owner count, so we trust the server's guard.
- Surface `validation_result` on apply failure as a backstop (Pitfall 1).
**Warning signs:** Dry-run shows `applyHint: "Re-call with dryRun: false to apply"` for a revoke that would leave the entity ownerless; the agent applies and gets a confusing 400.
**Confidence:** [CITED: PITFALLS.md Pitfall 3, EntitySharesService.java:397-446 quoted; the bypass / partial-view caveat is HIGH from source reading]

### Pitfall 6: `checkOwnership` 403 surfaces as a generic auth failure

**What goes wrong:** `EntitySharesResource.updateEntityShares` calls `checkOwnership(grn)` — requires the API token's user to hold `own` on the entity (not just `manage`). A non-owner share attempt produces HTTP 403, which `wrapGraylogError` formats as a generic permission error.
**Why it happens:** The MCP doesn't distinguish "no token permission" from "token user not an owner" — both are 403.
**How to avoid:**
- In `apply()`, catch `GraylogError` with `err.status === 403` and add a hint: "sharing requires `own` on the target entity, distinct from `manage` — confirm the connection's API-token user is an owner of {entityGrn} via `get_entity_shares`."
- Set `reason: "not_entity_owner"` for programmatic detection.
- Document in the tool description.
**Warning signs:** Agent sees "403 Forbidden" and assumes its API token is broken, when actually the token's user just isn't an owner.

### Pitfall 7: Tool-description budget (200 chars) is tight for a tool with `share / revoke / dryRun / token` semantics

**What goes wrong:** The description must convey: (a) what `share_entity` does, (b) entityType matrix (stream/dashboard/search), (c) the dryRun default, (d) the confirmation-token requirement, (e) the revoke flag. Without compression this overshoots 200 chars and `audit-tool-descriptions.js` fails (see Phase 9 Plan 01 §"Auto-fixed Issues #2").
**Why it happens:** The 200-char budget is enforced at lint time (`scripts/audit-tool-descriptions.js` `DESCRIPTION_BUDGET = 200`).
**How to avoid:**
- Draft, count, trim. Aim for ~180 chars to leave runway.
- Proposed draft (179 chars, [VERIFY: count after planner finalization]):
  > "Share, change, or revoke a user's access to a stream/dashboard/search (view/manage/own). Defaults dryRun:true; agent must echo the confirmation token to apply. Use revoke:true to remove."

## Runtime State Inventory

This is an additive phase — no rename, no refactor, no migration. The Runtime State Inventory pattern (stored data, OS-registered state, build artifacts) does not apply. No section needed.

## Code Examples

Verified patterns from the existing codebase. Cite-with-file-path for the planner to copy.

### Compose `defineMutatingHandler` with async `build()` (the foundational shape)

```javascript
// Source pattern: src/tools/pipelines/connect-pipelines-to-stream.js:40-92
// + src/tools/index-sets/delete-index-set.js:58-220 (requireConfirm precedent)

import { defineMutatingHandler } from "../_shared/handler.js";
import { ShareEntitySchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { resolveEntityGrn } from "./grn-helpers.js";
import { fetchEntitySharePreview } from "./prepare-share.js";
import { computeShareGrantHash } from "../_shared/cascade-hash.js";

export const handleShareEntity = defineMutatingHandler({
    name: "share_entity",
    schema: ShareEntitySchema,
    async build(args) {
        // 1. Normalize entity GRN (rejects grantee-type GRNs via SHAREABLE_TYPES guard)
        const entityGrn = resolveEntityGrn(args);

        // 2. Pre-flight /prepare — fetches active_shares + available_grantees + synced + validation
        const client = makeClient(args._conn);
        const preview = await fetchEntitySharePreview(client, entityGrn);

        // 3. Resolve grantee
        const granteeGrn = args.granteeGrn
            ?? resolveGranteeFromTitle(preview.available_grantees, args.granteeUsername);

        // 4. Merge — active_shares → Map<granteeGrn, capability> + change request
        const mergedMap = mergeGrants({
            current: preview.active_shares,           // [{grant, grantee, capability}]
            granteeGrn,
            capability: args.capability,
            revoke: args.revoke ?? false,
        });

        // 5. Client-side last-own guard
        assertOwnPreserved(preview.active_shares, mergedMap);  // throws on violation

        // 6. Compute the token over the merged set (byte-pinned canonical form)
        const mergedAsArray = [...mergedMap.entries()]
            .map(([grantee, capability]) => ({ grantee, capability }));
        const confirmationToken = computeShareGrantHash({ entityGrn, grants: mergedAsArray });

        // 7. Compute the diff for the preview envelope
        const diff = computeDiff(preview.active_shares, mergedMap, args.revoke);

        return {
            method: "POST",
            path: `/api/authz/shares/entities/${encodeURIComponent(entityGrn)}`,
            body: { selected_grantee_capabilities: Object.fromEntries(mergedMap),
                    selected_collections: [] },
            _confirmationToken: confirmationToken,
            postApplyEstimate: {
                id: entityGrn,
                async: false,
                synced_entities: preview.synced_entities ?? [],
            },
            // Surface in dry-run preview — handler.js step 6 includes these
            existingMatches: diff.unchanged.concat(diff.changed),  // similarity_reason set per entry
            // The non-standard preview extras — see Pattern 6
            _previewExtras: {
                diff,
                validation_result: preview.validation_result,
                missing_permissions_on_dependencies: preview.missing_permissions_on_dependencies,
                synced_entities: preview.synced_entities,
            },
        };
    },
    apply: async (client, req) => {
        // 400-with-body handling — see Pitfall 1
        try {
            return await client.request(req.method, req.path, req.body);
        } catch (err) {
            if (err?.isGraylogError
                && err.status === 400
                && err.body?.validation_result?.failed === true) {
                return {
                    isError: true,
                    reason: "share_validation_failed",
                    content: [{ type: "text", text: JSON.stringify({
                        tool: "share_entity",
                        status: 400,
                        validation_result: err.body.validation_result,
                        missing_permissions_on_dependencies:
                            err.body.missing_permissions_on_dependencies ?? {},
                        active_shares: err.body.active_shares ?? [],
                    })}],
                };
            }
            if (err?.isGraylogError && err.status === 403) {
                err.reason = "not_entity_owner";
            }
            throw err;
        }
    },
    summarize: (args, req) => {
        if (args.revoke) {
            return `Revoke ${args.granteeUsername ?? args.granteeGrn} from ${args.entityType ?? args.entityGrn}`;
        }
        return `Grant ${args.capability} to ${args.granteeUsername ?? args.granteeGrn} on ${args.entityType ?? args.entityGrn}`;
    },
    requireConfirm: ({ req }) => req._confirmationToken ?? null,
});
```

### Pitfall-1 acceptance-gate test (mandatory, mirrors `connect_pipelines_to_stream`)

```javascript
// Pattern source: test/pipelines.test.js "connect_pipelines_to_stream PITFALL 2 ACCEPTANCE GATE"
// Mandate for Phase 10: this test MUST exist and pass before merge.

test("share_entity PITFALL 1 ACCEPTANCE GATE: current=[A,B], add C → body contains A,B,C (not just C)", async () => {
    const fixture = {
        ...PREPARE_FIXTURE,
        active_shares: [
            { grant: "g1", grantee: "grn::::user:A", capability: "view" },
            { grant: "g2", grantee: "grn::::user:B", capability: "manage" },
        ],
        available_grantees: [
            ...PREPARE_FIXTURE.available_grantees,
            { id: "grn::::user:C", type: "user", title: "userC" },
        ],
    };

    let captured = null;
    _setCaptureRequest((req) => {
        // First call = /prepare; second call = apply
        captured = req;
        return fixture;
    });

    // dry-run first
    const dryRun = await handleShareEntity({ params: { arguments: {
        _testConnection: "fake",
        entityType: "stream", entityId: "S1",
        granteeUsername: "userC", capability: "view",
        dryRun: true,
    }}});

    const preview = JSON.parse(dryRun.content[0].text);
    const grantees = Object.keys(preview.preview.body.selected_grantee_capabilities);
    assert.deepEqual(grantees.sort(), ["grn::::user:A","grn::::user:B","grn::::user:C"]);
    // Pitfall-1 inverse — must NOT be [C] alone
    assert.notDeepEqual(grantees, ["grn::::user:C"]);
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `PUT /api/authz/shares/{grn}` (the milestone brief) | `POST /api/authz/shares/entities/{entityGRN}` (apply) + `.../prepare` (preview) | Phase 8 Plan 03 — verified live | Verb is POST, path includes `/entities/`; brief is recorded wrong in 08-TEST-STRATEGY.md |
| Custom GET to read current grants | `POST .../prepare` with `{}` body via `fetchEntitySharePreview` | Phase 9 Plan 01 | One endpoint = three jobs (preview + current state + grantee resolution) |
| Per-tool confirmation logic | `requireConfirm` callback on `defineMutatingHandler` | v3.0.0 Phase 2 (delete_index_set) | Wrapper-level enforcement; per-tool only declares the token source |
| Forward into `computeCascadeHash` for share-grant hashes | Standalone `computeShareGrantHash` (no forward) | Phase 8 Plan 02 | Grant set is a flat list, not keyed buckets; banner-documented deviation in cascade-hash.js |

**Deprecated/outdated:**
- The `PUT /api/authz/shares/{grn}` endpoint cited in the milestone brief — never existed; verified live on 7.0.6 to return 405 or 404.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `available_grantees[].title` is the grantee's username on live 7.0.6 (the fixture shows display names — need to confirm titles are also usernames or whether a separate `username` field exists) | Pitfall 2, Pattern 4 | Username-resolution path silently picks the wrong grantee or always fails; mitigation = primary input is `granteeGrn`, `granteeUsername` is a convenience that may need verification |
| A2 | The HTTP 400 on `validation_result.failed === true` carries the FULL `EntityShareResponse` body (not a stripped subset) on live 7.0.6 | Pitfall 1, Pattern 3 | If body is stripped on 400, the structured-error pattern still works but with empty `validation_result.errors` — the agent loses guidance. [SOURCE-CITED 7.2; UNVERIFIED on 7.0.6 live — Phase 8/9 only exercised `/prepare`, never the commit endpoint.] |
| A3 | Description budget of 200 chars accommodates the share/revoke/dryRun/token description | Pitfall 7 | If overshoots, audit-tool-descriptions.js test fails; mitigated by Phase 9 precedent of trimming on the fly |
| A4 | A single `share_entity` tool is preferable to `share_entity` + `revoke_entity_share` siblings | Pattern 5 | Tool-list browsing UX is slightly worse; mitigated by description mentioning revoke explicitly |
| A5 | Drift refusal covering only the primary entity (not `synced_entities`) is acceptable for v3.1.0 | Pitfall 3 | A concurrent change to a synced entity's grants slips through; mitigated by documentation; deferred to a possible v3.2 |
| A6 | `selected_collections: []` is always the correct field value for stream/dashboard/search shares (no collection semantics for these types) | Code example, FEATURES.md citation | Live 7.0.6 may reject `[]` for some entity type — verified empty in the live fixture but not exercised as a commit body parameter. [SOURCE-CITED 7.2 EntityShareRequest.java] |
| A7 | The merged-map empty case (`{selected_grantee_capabilities: {}}`) means "remove all shares" per Graylog source comment — agent should never reach this via the tool's input surface | Pitfall 4 | If reachable, the destructive outcome happens silently; mitigated by build()-side `merge_size_mismatch` invariant |
| A8 | Recompute-token-on-apply via re-running `build()` is what `defineMutatingHandler` does (handler.js step 5 runs unconditionally before the dryRun branch) | Pattern 2 | If `build()` ran only on the dryRun branch, drift refusal wouldn't work. **VERIFIED by reading handler.js:126-131 — `build()` runs at step 5 before the `if (dryRun)` branch at step 6.** |

**Confidence on A1, A2, A6 is LOW** (live-7.0.6 commit endpoint never exercised); these become open questions for Phase 10 — the planner may want to defer until a `dryRun: false` UAT against a throwaway entity confirms them. **A8 is VERIFIED** by source reading.

## Open Questions (RESOLVED)

**All five resolved during Phase 10 planning** — decisions embedded in the plan actions:
- **Q1 (title vs username):** match-by-`available_grantees[].title` is best-effort; `granteeGrn` is the primary input; on title collision, refuse with a candidate list. The fixture suggests `title` is a display name — Plan 10-03 adds a HUMAN-UAT note to verify against live 7.0.6 (Plan 10-02 `resolveGranteeFromTitle`).
- **Q2 (empty-body apply behavior):** never reached — Plan 10-02's `build()` enforces a `merge_size_mismatch` invariant before any commit.
- **Q3 (revoke confirmation):** same `requireConfirm` token covers grant AND revoke via `computeShareGrantHash` over the merged set — no separate gate.
- **Q4 (`synced_entities` in drift refusal):** out of scope for v3.1.0. Drift refusal covers the primary entity only; documented in the tool description.
- **Q5 (live UAT harness):** Plan 10-03 Task 2 — `checkpoint:human-verify` with throwaway-entity Options A/B/C per `08-TEST-STRATEGY.md`. Offline tests cover all 8 requirements structurally.

1. **Is `available_grantees[].title` the username or the display name on live 7.0.6?**
   - What we know: The Phase 8 fixture (lines 17-40) shows titles like `"User A"` (clearly a display name with space).
   - What's unclear: Whether matching by `title` ever resolves correctly for an agent-supplied username, or whether `title` is ALWAYS a display name. If so, `granteeUsername` is the wrong input parameter name.
   - Recommendation: Treat `granteeGrn` as the primary input. Make `granteeUsername` accept either the literal username string (which may or may not match `title`) or — better — rename it `granteeTitle` to match what the API field actually carries. A live UAT probe (read-only — just `GET /api/users` and compare to a `/prepare` response) resolves this in one call. Defer the final decision to plan-discuss.

2. **What does live 7.0.6 do on `selected_grantee_capabilities: {}` apply?**
   - What we know: Source says "empty = remove all shares." Server still returns 2xx? Or 400? Status not verified live.
   - What's unclear: The exact server response for this corner case.
   - Recommendation: The build() invariant in Pitfall 4 means the tool never reaches this state via supported inputs. Don't probe live; document as an unsupported state.

3. **Does `revoke: true` need a separate confirmation gate or is the same `requireConfirm` token sufficient?**
   - What we know: ROADMAP success criterion 4 mandates the token covers the merged grant set, which for revoke is `current - grantee`. So the existing `computeShareGrantHash` over the merged set already covers it.
   - What's unclear: Whether the planner wants an additional `revoke_confirm` field — extra friction for revocations specifically.
   - Recommendation: One token covers both add and revoke; the canonical hash input is the merged set regardless of operation. Add a UX nicety: the dry-run summary for revoke includes the word "REVOKE" prominently so the agent re-reads before applying.

4. **Should `synced_entities` participate in drift refusal?**
   - What we know: Pitfall 3 above — for v3.1.0 the answer is "no, document as best-effort."
   - What's unclear: Whether the planner agrees with the scope decision.
   - Recommendation: Defer to plan-discuss; default is "no" with a documented caveat.

5. **Live UAT for the commit endpoint — what's the throwaway harness?**
   - What we know: Phase 8 test-strategy mandates throwaway-entity + dedicated test user; never `builtin-team:everyone`; never a real production stream.
   - What's unclear: The UNESCO `test` connection doesn't have a pre-existing test stream named for this purpose. The Phase 10 plan needs to either: (a) create a throwaway stream as part of the UAT script, share to it, then delete the stream; (b) document a manual setup step ("create test-stream-phase10 and test-user-phase10 before running"); (c) skip live-apply UAT entirely and rely on offline fixture-replay.
   - Recommendation: For automated tests — option (c), `npm test` stays fully offline. For human UAT — option (a) via a `scripts/share-entity-live-uat.js` that creates+deletes a throwaway stream + a dedicated test user; the script is hand-run, not part of CI. Defer to plan-discuss.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All | ✓ | 18+ (verified in package.json `engines`) | — |
| Graylog 7.0.6 | Live UAT only | ✓ | 7.0.6+711d207 (Phase 8 fixture metadata) | Skip live UAT; offline fixture-replay covers structural invariants |
| `@modelcontextprotocol/sdk` | MCP layer | ✓ | 1.18.0 (package.json) | — |
| `axios` | HTTP | ✓ | 1.12.2 | — |
| `zod` | Schemas | ✓ | 3.25.76 | — |
| `node:crypto` | sha-256 | ✓ | built-in | — |
| Live `test` connection (UNESCO) | HUMAN-UAT only | ✓ | (production; treat with care per project memory) | Skip live UAT — Phase 10 ships when offline tests are green |
| Phase 8 captured fixture | Offline tests | ✓ | committed at `test/fixtures/authz/prepare-response-7.0.6.json` | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None — all primitives shipped by prior phases.

## Validation Architecture

Per `.planning/config.json` `workflow.nyquist_validation: true`, this section is required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (Node.js built-in test runner) + `c8` for coverage |
| Config file | None — `npm test` glob is configured in `package.json` `scripts.test` |
| Quick run command | `node --test test/authz-share-entity.test.js` |
| Full suite command | `npm test` (currently 1131/1131 after Phase 9 — Phase 10 adds tests; expected ~1145-1160) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SHARE-01 | Grant a user view/manage/own on a stream | unit (fixture-replay) | `node --test test/authz-share-entity.test.js` → `share_entity stream grant view` | ❌ Wave 0 |
| SHARE-01 | Same on dashboard | unit | same file → `share_entity dashboard grant manage` | ❌ Wave 0 |
| SHARE-01 | Same on saved search | unit | same file → `share_entity search grant own` | ❌ Wave 0 |
| SHARE-03 | Revoke a user's access | unit | same file → `share_entity revoke:true` test | ❌ Wave 0 |
| SHARE-04 | Username → user-GRN resolution | unit | same file → `share_entity resolves granteeUsername from /prepare available_grantees` | ❌ Wave 0 |
| SHARE-05 | Read-merge-write (PITFALL 1 ACCEPTANCE GATE) | unit, mandatory | same file → `current=[A,B], add C, body contains [A,B,C] not [C]` | ❌ Wave 0 |
| SHARE-06 | Surface `validation_result` + `missing_permissions_on_dependencies` (HTTP 400-with-body) | unit (fixture-replay GraylogError) | same file → `apply receives 400 w/ validation_result.failed → structured MCP error w/ reason=share_validation_failed` | ❌ Wave 0 |
| SHARE-07/08 | Dashboard / search GRN-type matrix (parameterized) | unit | same file → `share_entity entityType matrix` | ❌ Wave 0 |
| AUTHZ-01 | dryRun default | unit | same file → `share_entity defaults dryRun:true` | ❌ Wave 0 |
| AUTHZ-01 | sha-256 confirmation token returned | unit | same file → `dry-run envelope contains confirmationToken matching computeShareGrantHash` | ❌ Wave 0 |
| AUTHZ-01 | Drift refusal (TOCTOU) | unit (fixture-replay double-capture) | same file → `prepare returns A,B first call; A,B,D second call; apply refuses with grants_changed_since_preview` | ❌ Wave 0 |
| AUTHZ-01 | Confirmation-token mismatch | unit | same file → `args.confirm="wrong" → isError reason=confirmation_mismatch` | ❌ Wave 0 |
| SHARE-05 (extra) | Empty merge invariant (Pitfall 4) | unit | same file → `revoke leaves entity ownerless → build refuses with reason=would_leave_entity_ownerless` | ❌ Wave 0 |
| SHARE-05 (extra) | Last-`own` guard | unit | same file → `revoke last own grant → client-side refuse before commit` | ❌ Wave 0 |
| SHARE-06 (extra) | 403 → ownership-specific reason | unit | same file → `apply 403 → reason=not_entity_owner with hint` | ❌ Wave 0 |
| AUTHZ-01 (extra) | Capability enum rejection | unit | same file → `capability:"read" / "edit" / "admin" rejected by zod` | ❌ Wave 0 |
| Wiring | Tool registered | smoke (in `pipelines.test.js`) | `npm test` → `assertAllToolsRegistered passes after Plan 10-01 (count=94)` | ❌ Wave 0 |
| Wiring | Description budget (≤200 chars) | lint | `node --test test/tool-description-audit.test.js` | ✓ exists, will auto-cover new tool |
| Wiring | Listed in `list_admin_tools` | unit | `test/list-admin-tools.test.js` → `count=94` | ❌ Wave 0 (update line 48, 55) |
| Live | dryRun:true probe (the offline contract repeated end-to-end) | smoke | `node test/authz-share-entity-live.smoke.js` (excluded from `npm test` via `.smoke.js` suffix) | ❌ Wave 0 — opt-in human UAT |
| Live | Apply against throwaway entity (HUMAN-UAT only) | manual | gated UAT script | ❌ Wave 0 — deferred to manual UAT |

### Sampling Rate
- **Per task commit:** `node --test test/authz-share-entity.test.js` (the new file)
- **Per wave merge:** `npm test` (full offline suite)
- **Phase gate:** `npm test` green + a successful manual run of `scripts/share-entity-live-uat.js` against a freshly-created throwaway stream (or explicit decision to defer that to a milestone-close UAT pass)

### Wave 0 Gaps
- [ ] `test/authz-share-entity.test.js` — Wave 0 offline test file covering all rows above
- [ ] `test/authz-share-entity-live.smoke.js` — opt-in dryRun:true live probe (mirrors `test/authz-entity-shares-live.smoke.js` from Phase 9 Plan 02)
- [ ] Tool-count assertions in `test/list-admin-tools.test.js`, `test/pipelines.test.js`, `test/dashboards.test.js` updated 93→94
- [ ] `src/tools/meta/list-admin-tools.js` `DOMAIN_OVERRIDES` updated — add `share_entity` → `authz`

Framework install: no install needed — `node:test` is built-in and `npm test` is already configured.

## Security Domain

> Per project default (`security_enforcement` not explicitly disabled), this section is required.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing connection-registry API token (HTTP Basic, token-as-username); no new auth. Surface 403 as `not_entity_owner` with hint. |
| V3 Session Management | no | Stateless MCP — no sessions. |
| V4 Access Control | yes | `dryRun: true` default + sha-256 confirmation token + drift refusal. Writable-flag short-circuit on `conn.writable === false`. |
| V5 Input Validation | yes | `zod` schemas: `Capability` enum locked to view/manage/own; GRN type set restricted to `SHAREABLE_TYPES` (stream/dashboard/search) via `resolveEntityGrn`; `.refine` enforces entityGrn-XOR-(entityType,entityId) and revoke-XOR-capability interactions. |
| V6 Cryptography | yes | sha-256 via `node:crypto` `createHash`; canonical-form JSON byte-pinned (test/cascade-hash.test.js). Never hand-roll. |
| V7 Error Handling | yes | Structured `reason:` tags (`confirmation_mismatch`, `share_validation_failed`, `not_entity_owner`, `would_leave_entity_ownerless`, `connection_read_only`) — no opaque errors. Body-snippet truncation (200 chars) prevents auth leakage. |
| V14 Configuration | yes | No new env vars or config-file entries. `_testConnection` magic arg is test-only — dropped by zod `.strict()` mode for production agents. |

### Known Threat Patterns for `share_entity`

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Silent grant revocation (full-replace semantics) | Tampering, Repudiation | Mandatory read-merge-write via Phase 9 `fetchEntitySharePreview` + three-grantee acceptance-gate test (Pitfall 1) |
| TOCTOU drift between preview and apply | Tampering | sha-256 token over merged grant set; recompute on apply; `requireConfirm` gate refuses mismatch |
| Confused deputy — agent operates on a non-owned entity | Elevation of Privilege | `checkOwnership` server-side; client-side surfaces 403 as `not_entity_owner` with corrective hint |
| Ownerless entity — last `own` grant dropped | Denial of Service (entity becomes unmanageable) | Client-side last-own guard in build(); server-side `validation_result.failed` as backstop |
| Over-granting (`read`/`edit` typo coerced to `manage`/`own`) | Elevation of Privilege | `Capability` zod enum rejects synonyms; tool defaults to least-privilege `view` (when default semantics apply); description spells out what each capability allows |
| Granting to `builtin-team:everyone` accidentally | Information Disclosure | The `granteeUsername`/`granteeGrn` interface does not surface "everyone" by default. To grant to everyone the agent must explicitly pass the literal GRN `grn::::builtin-team:everyone` AND echo a confirmation token AND see "Everyone" in the dry-run summary. Document as a high-blast-radius operation; consider an extra-confirmation flag in v2. |
| Empty `selected_grantee_capabilities` → "remove all shares" | Tampering / DoS | build()-side `merge_size_mismatch` invariant refuses the apply unless explicitly verifiable from the inputs |
| Apply against a read-only connection | Tampering (attempted) | `conn.writable === false` short-circuit at handler.js step 3 — before build() runs |
| Sharing user's own grant disclosure (under-reporting `active_shares`) | Information Disclosure | `active_shares` excludes the sharing user's grant by design — documented; the tool description warns "active_shares excludes your own grant" |
| Production-log exposure via mis-targeted share | Information Disclosure | Live UAT confined to throwaway-disposable entities + dedicated test users per 08-TEST-STRATEGY.md; `npm test` fully offline |
| Token replay across distinct entities | Tampering | `computeShareGrantHash` includes `entityGrn` in the canonical input — a token for stream-X cannot validate against an apply on stream-Y (proven by test/cascade-hash.test.js:507-514 "differs when entityGrn differs") |

## Sources

### Primary (HIGH confidence)
- `.planning/research/SUMMARY.md` — milestone overview, headline pitfalls, dependency-ordered build plan
- `.planning/research/FEATURES.md` — full endpoint reference, EntityShareRequest/Response DTOs (Java source-cited), Capability enum, Grantee shape, 7.0.6↔7.2 divergence table
- `.planning/research/ARCHITECTURE.md` — Pattern 1 (GRN abstraction), Pattern 2 (prepare-vs-commit, dryRun mapping, complementary local token), Pattern 3 (read-merge-write — replace-semantics confirmed from Graylog source), Pattern 4 (read-path is plain async handler)
- `.planning/research/PITFALLS.md` — 8 pitfalls with source-line citations to `EntitySharesResource.java`, `EntitySharesService.java`, `GRNTypes.java`; the security mistakes table
- `.planning/phases/08-authz-foundation-grn-helper-live-api-recon/08-TEST-STRATEGY.md` — live-production authz test contract (mandatory link target for Phase 10)
- `.planning/phases/08-authz-foundation-grn-helper-live-api-recon/08-0{1,2,3}-SUMMARY.md` — Phase 8 deliverables: GRN helpers, computeShareGrantHash, live fixture
- `.planning/phases/09-entity-shares-read-path/09-0{1,2}-SUMMARY.md` — Phase 9 deliverables: `fetchEntitySharePreview`, `resolveEntityGrn`, read handlers, live smoke
- `src/tools/_shared/handler.js` — `defineMutatingHandler` (lines 58-258); writable gate (94-106); idempotency (109-111); async build() at step 5 (126-131); requireConfirm gate at step 6b (211-225)
- `src/tools/_shared/cascade-hash.js:303-339` — `computeShareGrantHash` (Phase 8 Plan 02 byte-pinned)
- `src/tools/authz/grn-helpers.js` — `buildGrn`, `parseGrn`, `isGrn`, `SHAREABLE_TYPES`, `resolveEntityGrn`
- `src/tools/authz/prepare-share.js:36` — `fetchEntitySharePreview` with `/prepare` self-guard
- `src/tools/authz/schemas.js` — `Capability`, `GetEntitySharesSchema` (pattern for `ShareEntitySchema`)
- `src/tools/pipelines/connect-pipelines-to-stream.js:40-92` — GET-merge-POST acceptance-gate precedent
- `src/tools/pipelines/disconnect-pipelines-from-stream.js:29-94` — GET-subtract-POST precedent for revoke logic
- `src/tools/index-sets/delete-index-set.js:58-220` — `requireConfirm` precedent + 400-body parsing pattern
- `src/graylog/client.js:29-90` — POST-with-body, `validateStatus: () => true`, body forwarded in `GraylogError.body`
- `test/fixtures/authz/prepare-response-7.0.6.json` — live EntityShareResponse (verbatim)
- `test/cascade-hash.test.js:455-535` — `computeShareGrantHash` byte-pin tests; 4 cases (frozen, order-independence, entityGrn-sensitivity, malformed)
- `test/authz-entity-shares.test.js` — Phase 9 offline fixture-replay test pattern (model for Phase 10's test file)
- `CLAUDE.md` — project-instructions constraints

### Secondary (MEDIUM confidence)
- 7.2-SNAPSHOT source as forward-compat reference for endpoints not exercised live — HIGH for paths, MEDIUM for nuanced field semantics (e.g., does `title` carry username or display name?)
- `EntitySharesResource.java:166-170` — HTTP 400 with body on `validation_result.failed()`; cited in SUMMARY.md and PITFALLS.md but the live 7.0.6 commit endpoint has not been exercised, so the exact body shape on 400 is source-only

### Tertiary (needs live verification before relying on)
- `available_grantees[].title` semantic on live 7.0.6 (username vs display name) — Pitfall 2 / A1
- `selected_grantee_capabilities: {}` body server response on live 7.0.6 — A2 / Pitfall 4 (mitigated by build()-side invariant; should not reach live)
- `selected_collections: []` body field acceptance on live 7.0.6 for stream/dashboard/search — A6

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every primitive is already shipped and verified by Phase 8/9 unit tests
- Architecture: HIGH — patterns are direct precedents (`connect_pipelines_to_stream`, `delete_index_set`); no new wrapper machinery needed
- Pitfalls: HIGH-MEDIUM — Pitfalls 1, 3, 5, 6, 7 are HIGH (source-cited or test-cited); Pitfall 2 (title vs username) is MEDIUM (fixture suggests display name, needs live confirm); Pitfall 4 (empty-map case) is HIGH from source

**Research date:** 2026-05-20
**Valid until:** 2026-06-20 (30 days — the v3.1.0 stack is stable; only live-7.0.6 commit-endpoint corner cases — A1, A2, A6 — could change underneath, and a Graylog upgrade in 30 days is not anticipated)
