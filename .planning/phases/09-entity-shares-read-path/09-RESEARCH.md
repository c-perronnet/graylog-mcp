# Phase 9: Entity Shares Read Path - Research

**Researched:** 2026-05-19
**Domain:** Graylog authz/entity-sharing READ tools (`get_entity_shares`, `list_grantees`) — non-mutating tool surface for v3.1.0
**Confidence:** HIGH

## Summary

Phase 9 adds the first two real handlers to the `authz` domain: `get_entity_shares` and `list_grantees`. Both are **non-mutating reads** built on a single Graylog endpoint — `POST /api/authz/shares/entities/{entityGRN}/prepare` called with an empty `{}` body. That endpoint is `@NoAuditEvent` on the Graylog side (mutates nothing) and was verified live against the UNESCO production 7.0.6 `test` instance in Phase 8; its verbatim response is committed as `test/fixtures/authz/prepare-response-7.0.6.json`. Phase 9 is deliberately a zero-blast-radius phase: it de-risks `EntityShareResponse` DTO parsing before that parsing becomes load-bearing in Phase 10's `share_entity` write path. [CITED: .planning/phases/08.../08-TEST-STRATEGY.md] [VERIFIED: test/fixtures/authz/prepare-response-7.0.6.json]

The structural shape is settled by precedent. `get_entity_shares` is a **plain async handler** copying `src/tools/pipelines/get-pipeline.js` / `src/tools/streams/get-stream.js` — NOT `defineMutatingHandler` (no `dryRun`/token on a read) and NOT `defineListHandler` (the `prepare` response is a single nested DTO with three sibling arrays; the list factory's narrow-projection would flatten them). `list_grantees` is a sibling read over the *same* `/prepare` call, projecting only `available_grantees`. Both register into `src/tools/authz/index.js`, which Phase 8 shipped **empty** — Phase 9 takes it from empty to non-empty, the first `register()` calls in the authz barrel. Wiring is the standard four-edit pattern: append two tool defs to `src/tools.js`, add two `register()` lines to `authz/index.js` (the barrel is already imported by `_register.js`), create the two handler files, add zod schemas to `src/tools/authz/schemas.js`. [VERIFIED: src/tools/pipelines/get-pipeline.js] [VERIFIED: src/tools/authz/index.js]

The one non-obvious gotcha already solved by Phase 8: a GRN contains literal colons and must be `encodeURIComponent`-encoded into the URL path (`grn::::stream:abc` → `grn%3A%3A%3A%3Astream%3A...`). `buildGrn` from `grn-helpers.js` produces the GRN; the handler percent-encodes it into the path exactly as `scripts/capture-authz-prepare-fixture.js` does. There are no new dependencies, no `src/graylog/client.js` changes, and no v2.3 contract changes. [VERIFIED: scripts/capture-authz-prepare-fixture.js]

**Primary recommendation:** Build `get_entity_shares` and `list_grantees` as two plain async handlers in `src/tools/authz/`, both calling `POST .../entities/{encodeURIComponent(grn)}/prepare` with body `{}`; copy `get-pipeline.js` line-for-line for handler structure; surface the full `EntityShareResponse` DTO unflattened; test offline against `prepare-response-7.0.6.json` plus one non-mutating live smoke test against the `test` connection.

## User Constraints

> No CONTEXT.md exists for Phase 9 yet (STATE.md: "stopped_at: Phase 08 complete — ready to discuss Phase 9"). The constraints below are extracted from CLAUDE.md, PROJECT.md decisions in STATE.md, ROADMAP.md Phase 9 success criteria, and the Phase 8 `08-TEST-STRATEGY.md` contract. If `/gsd:discuss-phase` runs and produces a CONTEXT.md, those decisions supersede and must be copied here verbatim.

### Locked Decisions (from ROADMAP.md Phase 9 + Phase 8 outputs)

- `get_entity_shares` returns an entity's `active_shares` (grantee + capability) via `POST .../entities/{grn}/prepare` with an empty body — must work for `stream`, `dashboard`, and `search` entity types.
- `list_grantees` returns resolvable users/teams for an entity, derived from `available_grantees` in the same `prepare` response, so an agent can map a username to the user-GRN the API requires.
- The read handler surfaces the **full nested `EntityShareResponse` DTO** (`active_shares`, `available_grantees`, `available_capabilities`) **without flattening** — plain async handler, NOT the list-projection factory.
- Both tools are smoke-tested non-mutatingly against the live `test` instance AND verified against the Phase 8 fixtures offline.
- Endpoint is the **corrected** `POST /api/authz/shares/entities/{entityGRN}/prepare` — the brief's `PUT /api/authz/shares/{grn}` is recorded WRONG. [CITED: 08-TEST-STRATEGY.md §3]
- The commit endpoint `POST .../entities/{GRN}` (no `/prepare` suffix) is **forbidden in Phase 9** — this is still a read-only phase. [CITED: 08-TEST-STRATEGY.md §2]

### Project Constraints (from CLAUDE.md)

- **Tech stack:** Node.js ≥18 ESM; existing deps only (`@modelcontextprotocol/sdk`, `axios`, `zod`) — **zero new dependencies**.
- **Graylog version:** 7.0.6 only — single target, no multi-version branching (note: CLAUDE.md header says `7.2.0-SNAPSHOT`; the live `test` instance and Phase 8 fixture are `7.0.6+711d207` — 7.0.6 is the verified ship target).
- **Code organization:** new admin tools extract into `src/tools/<domain>/` — here `src/tools/authz/`, never inline in `src/index.js`.
- **Backward compat:** existing v2.3 tool contracts unchanged; connection-config schema additive only.
- **No web UI:** output is JSON-stringified text in MCP responses.
- **Safety:** every *mutating* tool defaults to `dryRun: true`. Phase 9 tools are non-mutating reads — they carry no `dryRun` at all (a `dryRun` on a read tool is a smell; `get-pipeline.js` precedent omits it).
- **Tests:** `node:test` / `node:assert/strict`; `npm test` stays fully offline for authz (fixture-replay; no network call). [CITED: 08-TEST-STRATEGY.md §6]

### Claude's Discretion

- Exact tool naming — `get_entity_shares` and `list_grantees` are the ROADMAP/SUMMARY names; `list_grantees` slightly bends strict `verb_domain_noun` but reads naturally and matches the success criteria. Keep them.
- Input-shape choice: accept a raw `entityGrn` string OR a `(entityType, entityId)` pair. Recommendation below: support **both**, normalized via `buildGrn` — the `(type, id)` pair is the safer agent-facing default.
- Whether `list_grantees` is a separate handler file or shares code with `get_entity_shares` (both call the same endpoint). Recommendation: separate handler file, shared private fetch helper.
- How much of the `EntityShareResponse` DTO each tool surfaces (full vs. projected). Success criterion 3 mandates `get_entity_shares` surfaces the full DTO; `list_grantees` may project to `available_grantees` only.

### Deferred Ideas (OUT OF SCOPE for Phase 9)

- `share_entity` and any apply/commit path — Phase 10.
- Read-merge-write, drift refusal, `computeShareGrantHash` use, confirmation tokens — Phase 10 (`computeShareGrantHash` already exists in `cascade-hash.js` from Phase 8 but Phase 9 does not call it).
- The inverse-read endpoint `GET /api/authz/shares/user/{userId}` ("what is shared *with* this user") — a valid future tool, not in Phase 9 success criteria; do not conflate with `get_entity_shares`.
- Role tools (`list_roles`, `create_role`, …) — Phase 11.
- Team grantees as a tested path — Teams are a Graylog Enterprise feature; the OSS 7.0.6 `test` instance has none. The GRN path stays generic but no test depends on a team existing. [CITED: REQUIREMENTS.md SHARE-V2-01]

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SHARE-02 | Agent can read an entity's current grants (active shares) via `get_entity_shares` | `POST .../entities/{grn}/prepare` empty body returns `active_shares: [{grant, grantee, capability}]`. Plain async handler precedent: `get-pipeline.js`. DTO shape verified in `prepare-response-7.0.6.json`. |
| SHARE-09 | Agent can list the grantees available for sharing an entity via `list_grantees` | Same `prepare` response carries `available_grantees: [{id, type, title}]`. `id` is the user/team GRN; `title` is the human name — the username→GRN map an agent needs. |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Read an entity's current grants (`get_entity_shares`) | API / Backend (Graylog `EntitySharesResource`) | — | Graylog owns the grant store; the MCP handler is a thin pass-through. No client-side state. |
| List shareable grantees (`list_grantees`) | API / Backend (Graylog) | — | `available_grantees` is computed server-side by `DefaultGranteeService`; the MCP only projects the response. |
| GRN construction / validation | MCP tool layer (`authz/grn-helpers.js`) | — | Pure client-side string work; turns a malformed GRN into a clean MCP error before any HTTP call. Phase 8 deliverable, reused. |
| GRN URL-path encoding | MCP tool layer (handler) | — | `encodeURIComponent` the GRN into the request path; a JAX-RS routing concern the handler owns. |
| Connection resolution / auth | MCP `_shared/connection.js` + `graylog/client.js` | — | Existing v2.3 infrastructure, unchanged. HTTP Basic token-as-username. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | 1.18.0 | MCP server / tool dispatch | Already the project's MCP framework; tool defs in `src/tools.js`. [VERIFIED: package.json via CLAUDE.md] |
| `axios` | 1.12.2 | HTTP client (via `makeClient(conn).request()`) | Existing client; supports POST-with-empty-body — when `body` is null/undefined no `Content-Type` is sent; an explicit `{}` body sets `Content-Type: application/json`. [VERIFIED: src/graylog/client.js:49-59] |
| `zod` | 3.25.76 | Input schema validation for the two tools | CLAUDE.md mandates zod for input validation; `Capability` enum already in `authz/schemas.js`. [VERIFIED: src/tools/authz/schemas.js] |
| `node:test` / `node:assert/strict` | built-in | Offline fixture-replay + live smoke tests | Project test harness; `test/authz-grn.test.js` already loads the fixture. [VERIFIED: test/authz-grn.test.js] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `src/tools/authz/grn-helpers.js` | Phase 8 | `buildGrn` / `parseGrn` / `isGrn` / `GRN_TYPES` | Build/validate the entity GRN before the request; never inline GRN string concatenation. [VERIFIED: src/tools/authz/grn-helpers.js] |
| `src/tools/_shared/connection.js` | v2.3 | `resolveConnection(args)` — `_testConnection` seam + per-call `connectionName` + singleton fallback | Every authz handler resolves the connection through this; re-merge the `_testConnection` seam from raw args as `get-pipeline.js` does. [VERIFIED: src/tools/_shared/connection.js] |
| `src/tools/_shared/errors.js` | v2.3 | `errorResponse`, `formatZodError`, `wrapGraylogError` | zod-parse failure → `errorResponse(formatZodError(err))`; HTTP error → `wrapGraylogError(err, "get_entity_shares")`. [VERIFIED: src/tools/pipelines/get-pipeline.js imports] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Plain async handler | `defineListHandler` | REJECTED — `defineListHandler` narrows to a flat field-pick; it would flatten `active_shares` / `available_grantees` / `available_capabilities` and destroy the nested DTO. This is the exact trap documented in `get-pipeline.js` and `get-stream.js` headers. Success criterion 3 explicitly forbids it. |
| Plain async handler | `defineMutatingHandler` | REJECTED — adds `dryRun` / `idempotencyKey` / confirmation-token machinery that is meaningless on a non-mutating read. `/prepare` is `@NoAuditEvent`; nothing is dry-run-able. |
| Two separate handler files | One handler with a `mode` arg | REJECTED — two distinct tool names (`get_entity_shares`, `list_grantees`) need two `register()` entries and two `tools.js` defs anyway; a shared private fetch helper is cleaner than a polymorphic handler. |

**Installation:**
```bash
# No installation. Zero new dependencies — CLAUDE.md constraint.
```

**Version verification:** No new packages. The four core libraries are already in `package.json` (`@modelcontextprotocol/sdk` 1.18.0, `axios` 1.12.2, `zod` 3.25.76) per CLAUDE.md's Technology Stack section. `node:test` is a Node ≥18 builtin.

## Package Legitimacy Audit

> Not applicable — Phase 9 installs **zero** external packages (CLAUDE.md hard constraint: "zero new dependencies"). All code uses already-installed dependencies and Node builtins. slopcheck not run because no package is added.

## Architecture Patterns

### System Architecture Diagram

```
agent: get_entity_shares({ entityType:"stream", entityId:"6a08..." })
        OR  get_entity_shares({ entityGrn:"grn::::stream:6a08..." })
   │
   ▼
src/index.js  CallTool  →  dispatch("get_entity_shares")  →  handleGetEntityShares
   │
   ▼  1. zod-parse args (GetEntitySharesSchema)         → on fail: errorResponse(formatZodError)
   ▼  2. resolveConnection(seamArgs)                    → on fail: { error }
   ▼  3. normalize input to a GRN:
   │       entityGrn supplied?  → parseGrn() to validate
   │       (entityType,entityId)? → buildGrn(type,id)
   ▼  4. encode: path = `/api/authz/shares/entities/${encodeURIComponent(grn)}/prepare`
   ▼  5. client.request("POST", path, {})   ◄── empty body = pure read, @NoAuditEvent
   │
   ▼  Graylog 7.0.6  EntitySharesResource.prepareShare
   │       returns EntityShareResponse (single nested DTO)
   ▼
   ▼  6. envelope: { tool, connection, entity_shares: <full EntityShareResponse> }
   │       get_entity_shares → surface the FULL DTO
   │       list_grantees     → project to { grantees: response.available_grantees }
   ▼
   JSON-stringified text MCP response
```

The two tools share steps 1-5; they diverge only at step 6 (full DTO vs. `available_grantees` projection). A shared private `fetchEntitySharePreview(client, grn)` helper is the natural factoring.

### Recommended Project Structure
```
src/tools/authz/
├── index.js                  # MODIFIED — empty → 2 register() calls
├── schemas.js                # MODIFIED — add GetEntitySharesSchema, ListGranteesSchema
├── grn-helpers.js            # UNCHANGED (Phase 8) — buildGrn/parseGrn/isGrn/GRN_TYPES
├── get-entity-shares.js      # NEW — plain async handler, SHARE-02
├── list-grantees.js          # NEW — plain async handler, SHARE-09
└── (optionally) prepare-share.js  # NEW — shared private fetchEntitySharePreview() helper
```

### Pattern 1: Plain async read handler (the `get-pipeline.js` shape)
**What:** A non-list, non-mutating single-DTO read. Five steps: read raw args → zod-parse → resolve connection (re-merge `_testConnection` seam) → single `client.request()` → JSON envelope, with `wrapGraylogError` on the catch.
**When to use:** `get_entity_shares` and `list_grantees` — both.
**Example:**
```javascript
// Source: src/tools/pipelines/get-pipeline.js (verified precedent — copy this structure)
import { GetEntitySharesSchema } from "./schemas.js";
import { resolveConnection } from "../_shared/connection.js";
import { makeClient } from "../../graylog/client.js";
import { buildGrn, parseGrn } from "./grn-helpers.js";
import { errorResponse, formatZodError, wrapGraylogError } from "../_shared/errors.js";

export async function handleGetEntityShares(request) {
    const rawArgs = request?.params?.arguments ?? {};

    let args;
    try {
        args = GetEntitySharesSchema.parse(rawArgs);
    } catch (err) {
        return errorResponse(formatZodError(err));
    }

    // _testConnection seam re-merged from pre-zod args (seam is absent from the
    // zod schema; zod's strip mode drops it from real-agent payloads).
    const seamArgs = rawArgs._testConnection
        ? { ...args, _testConnection: rawArgs._testConnection }
        : args;
    const { conn, name: connectionName, error } = resolveConnection(seamArgs);
    if (error) return error;

    // Normalize input → a validated GRN. buildGrn / parseGrn throw on malformed
    // input; catch and surface as a clean MCP error, not a server 400.
    let entityGrn;
    try {
        entityGrn = args.entityGrn
            ? (parseGrn(args.entityGrn), args.entityGrn.toLowerCase())
            : buildGrn(args.entityType, args.entityId);
    } catch (err) {
        return errorResponse(`Invalid entity reference: ${err.message}`);
    }

    try {
        const client = makeClient(conn);
        // GRN contains literal colons — MUST encodeURIComponent into the path.
        const path = `/api/authz/shares/entities/${encodeURIComponent(entityGrn)}/prepare`;
        const shares = await client.request("POST", path, {}); // empty body = pure read
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    tool: "get_entity_shares",
                    connection: connectionName,
                    entity_shares: shares,            // FULL nested EntityShareResponse
                }),
            }],
        };
    } catch (err) {
        return wrapGraylogError(err, "get_entity_shares");
    }
}
```

### Pattern 2: GRN URL-path encoding
**What:** A GRN (`grn::::stream:6a08...`) contains literal `:` characters. Interpolated unencoded into a JAX-RS path parameter, the router can mis-split the path. `encodeURIComponent` turns each `:` into `%3A`.
**When to use:** Every authz request path that embeds a GRN.
**Example:**
```javascript
// Source: scripts/capture-authz-prepare-fixture.js:88 (verified live against 7.0.6)
const path = `/api/authz/shares/entities/${encodeURIComponent(entityGrn)}/prepare`;
// → /api/authz/shares/entities/grn%3A%3A%3A%3Astream%3A6a08.../prepare
```

### Pattern 3: Shared private fetch helper for two tools on one endpoint
**What:** `get_entity_shares` and `list_grantees` make the *identical* `POST .../prepare` call. Factor the connection-resolve + GRN-normalize + request into one private function; each handler calls it and shapes its own envelope.
**When to use:** Recommended — avoids divergence between the two handlers' GRN handling and endpoint path.

### Anti-Patterns to Avoid
- **Running `get_entity_shares` through `defineListHandler`:** the `prepare` response is a single DTO with three sibling arrays; the list factory's flat field-pick destroys the nesting. Documented trap in `get-pipeline.js` / `get-stream.js`. Success criterion 3 forbids it.
- **`defineMutatingHandler` on a read:** adds `dryRun`/token machinery meaningless on a `@NoAuditEvent` endpoint.
- **Inline GRN string concatenation:** `` `grn::::stream:${id}` `` at the call site bypasses `GRN_TYPES` validation and the lowercasing contract. Use `buildGrn`. Anti-Pattern 3 in ARCHITECTURE.md.
- **Forgetting to `encodeURIComponent` the GRN:** unencoded colons mis-route the request. Phase 8 `08-TEST-STRATEGY.md §4` made this a mandatory rule.
- **Calling the commit endpoint (`POST .../entities/{GRN}` without `/prepare`):** forbidden in Phase 9 — this is a read-only phase.
- **Hardcoding the `available_capabilities` enum from source:** `available_capabilities` is computed server-side and present in the live response (`view`/`manage`/`own`); surface what the live `prepare` response returns rather than re-deriving it client-side.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| GRN construction / validation | A regex or template-literal at the call site | `buildGrn` / `parseGrn` / `isGrn` from `grn-helpers.js` | Phase 8 already built and unit-tested this; 6-token format, mandatory `grn` prefix, lowercasing, type-set check are all easy to get subtly wrong. [VERIFIED: src/tools/authz/grn-helpers.js] |
| "Read current grants" endpoint | A speculative `GET .../entities/{grn}` | `POST .../entities/{grn}/prepare` with `{}` body | There is **no** dedicated GET-grants endpoint in Graylog 7.0.6. `/prepare` with an empty body IS the read model — the web UI's Share dialog opens with exactly this call. [CITED: FEATURES.md §"Reading current grants for an entity"] |
| Connection resolution | New connection lookup logic | `resolveConnection(seamArgs)` | v2.3 shared infrastructure; handles `_testConnection`, per-call `connectionName`, singleton fallback uniformly. [VERIFIED: src/tools/_shared/connection.js] |
| HTTP client / auth | A raw `axios` import | `makeClient(conn).request(method, path, body)` | Existing client handles HTTP Basic token-as-username, error classification, and bodyless-vs-bodied requests. [VERIFIED: src/graylog/client.js] |
| Graylog error → MCP envelope | A bespoke try/catch envelope | `wrapGraylogError(err, toolName)` | Maps 403/404/etc. into the standard MCP `isError` envelope with the tool name embedded for agent-debuggability. |
| Username → user-GRN resolution | A `GET /api/users/{username}` round-trip + GRN build | `available_grantees[].title` → `available_grantees[].id` from the same `prepare` response | One fewer endpoint; `id` is already the exact GRN the server accepts. This is precisely why `list_grantees` exists. [CITED: FEATURES.md §"Grantee GRN gotcha"] |

**Key insight:** Phase 9 writes almost no new logic — it is two thin handlers wiring an already-verified endpoint to an already-built GRN helper. The risk is structural (wrong handler factory, missing URL-encoding), not algorithmic. Copy `get-pipeline.js`.

## Runtime State Inventory

> Not applicable — Phase 9 is a greenfield additive phase (two new read tools). No rename, refactor, or migration. No stored data, live service config, OS-registered state, secrets, or build artifacts are touched. The authz tools are stateless request/response, identical to the other 9 admin domains. **None — verified by reading ARCHITECTURE.md §"State management" ("No new persistent state").**

## Common Pitfalls

### Pitfall 1: Using `defineListHandler` and flattening the DTO
**What goes wrong:** `active_shares`, `available_grantees`, `available_capabilities` are sibling arrays inside one `EntityShareResponse`. `defineListHandler` does a narrow flat field-pick designed for arrays-of-records; it mangles a single nested DTO.
**Why it happens:** The response *contains* arrays, so "it's a list" is a tempting misread.
**How to avoid:** Plain async handler. Copy `get-pipeline.js`. Success criterion 3 makes "full nested DTO, not flattened" an explicit acceptance gate.
**Warning signs:** The handler imports `defineListHandler`; the output has lost `available_grantees`'s nested `{id,type,title}` shape.

### Pitfall 2: GRN not URL-path-encoded
**What goes wrong:** `grn::::stream:abc` interpolated raw into the path; JAX-RS mis-routes on the literal colons → 404 or wrong-route error.
**Why it happens:** The GRN looks like an opaque id; colons in a path segment are an easy oversight.
**How to avoid:** `encodeURIComponent(entityGrn)` always. `08-TEST-STRATEGY.md §4` made this a mandatory rule; `capture-authz-prepare-fixture.js:88` is the verified precedent.
**Warning signs:** A test asserts the request path and the path contains a raw `:` after `entities/`.

### Pitfall 3: Wrong endpoint — regressing to the brief's `PUT` or hitting the commit path
**What goes wrong:** The milestone brief says `PUT /api/authz/shares/{grn}` — confirmed WRONG. Or a handler drops the `/prepare` suffix and hits the mutating commit endpoint.
**Why it happens:** The brief is authoritative-looking; the commit path differs from the read path only by a missing suffix.
**How to avoid:** Hardcode `POST .../entities/{grn}/prepare`. Consider asserting `path.endsWith("/prepare")` in the handler or its test, mirroring the capture script's self-guard. [CITED: capture-authz-prepare-fixture.js:92]
**Warning signs:** `PUT` appears anywhere in an authz handler; a request path under `/authz/shares/entities/` lacks `/prepare`.

### Pitfall 4: Treating 7.2-source DTO fields as guaranteed-present
**What goes wrong:** A parser that requires `synced_entities` (or any field) throws on a build that omits it.
**Why it happens:** Research read the 7.2 source clone; the ship target is 7.0.6.
**How to avoid:** Phase 8 resolved this — `synced_entities` IS present in the live 7.0.6 capture (empty array). But Phase 9 should still treat version-variable fields defensively: if it adds a zod schema for `EntityShareResponse`, model optional fields with `.optional()` and use `.passthrough()` so unexpected fields survive. Simplest safe choice: surface the response verbatim and do not validate it with a strict zod schema at all — pass the DTO through untouched. [CITED: 08-TEST-STRATEGY.md §7]
**Warning signs:** A `.strict()` zod schema over `EntityShareResponse`; `response.synced_entities.map(...)` with no guard.

### Pitfall 5: `active_shares` under-reports — the sharing user's own grant is excluded
**What goes wrong:** An agent reads `active_shares` as "the complete ACL" and concludes nobody-but-X has access, missing that the calling token's own grant is filtered out by Graylog's `getForTargetExcludingGrantee`.
**Why it happens:** `active_shares` is named like a full grant list but is "grants held by *other* grantees".
**How to avoid:** Document in the `get_entity_shares` tool description and output that `active_shares` excludes the requesting user's own grant. The live fixture shows `active_shares: []` on a stream with no other grantees — the empty array is correct, not a bug. [CITED: PITFALLS.md Pitfall 3 point 3]
**Warning signs:** Tool description claims `active_shares` is "all grants"; a test asserts it must be non-empty.

### Pitfall 6: Live smoke test mutating production
**What goes wrong:** The `test` connection is live UNESCO production Graylog. A careless smoke test sends a non-empty body or hits the commit path.
**Why it happens:** Temptation to "test against the real instance properly".
**How to avoid:** The smoke test calls only `POST .../prepare` with an empty `{}` body — `@NoAuditEvent`, mutates nothing. No `dryRun: false` exists in Phase 9 (no mutating tool). `npm test` stays fully offline (fixture-replay); the live smoke test is a separate, explicitly-scoped, non-mutating check. [CITED: 08-TEST-STRATEGY.md §2, §6; PITFALLS.md Pitfall 8]
**Warning signs:** A Phase 9 test sends `selected_grantee_capabilities` content; a request path lacks `/prepare`.

## Code Examples

### Reading the live 7.0.6 EntityShareResponse shape (the DTO Phase 9 surfaces)
```json
// Source: test/fixtures/authz/prepare-response-7.0.6.json (verified live capture, 7.0.6+711d207)
{
  "entity": "grn::::stream:6a0899bc670fc246e77ca54e",
  "sharing_user": "grn::::user:6a04acef670fc246e77a5091",
  "available_grantees": [
    { "id": "grn::::user:6a02ebea4076fbb743b4848e", "type": "user",   "title": "User A" },
    { "id": "grn::::builtin-team:everyone",          "type": "global", "title": "Everyone" }
  ],
  "available_capabilities": [
    { "id": "view",   "title": "Viewer" },
    { "id": "manage", "title": "Manager" },
    { "id": "own",    "title": "Owner" }
  ],
  "active_shares": [],
  "selected_grantee_capabilities": {},
  "missing_permissions_on_dependencies": {},
  "synced_entities": [],
  "validation_result": { "errors": {}, "error_context": {}, "failed": false }
}
```
- `get_entity_shares` surfaces this whole object (minus `_provenance`, which is fixture-only metadata) under an `entity_shares` envelope key.
- `list_grantees` projects `available_grantees` only. Note `type` is `user` / `team` / `global` — the `Everyone` grantee has `type: "global"` (not `team`), and its GRN is `grn::::builtin-team:everyone`. An `active_shares` entry is `{grant, grantee, capability}` (empty here — the probed stream has no other-grantee grants).

### Tool definition shape for `src/tools.js`
```javascript
// Source: src/tools.js get_pipeline def (verified precedent — copy this shape)
{
    name: "get_entity_shares",
    description: "Read an entity's current grants (active shares) and the grantees/capabilities it can be shared with. Non-mutating. Accepts entityGrn OR (entityType,entityId). Use this before share_entity to see existing grants.",
    inputSchema: {
        type: "object",
        properties: {
            connectionName: { type: "string" },
            entityGrn: { type: "string", description: "Full GRN, e.g. grn::::stream:<id>. Either this OR entityType+entityId." },
            entityType: { type: "string", enum: ["stream", "dashboard", "search"], description: "Entity type. Use with entityId." },
            entityId: { type: "string", description: "Entity id (from list_streams / list_dashboards). Use with entityType." },
        },
    },
}
```

### zod schema for `src/tools/authz/schemas.js`
```javascript
// Add to src/tools/authz/schemas.js — plain ZodObject, NOT mutatingBase (read tool).
// .refine enforces "entityGrn XOR (entityType + entityId)" so the agent gets a
// clean validation error instead of an ambiguous request.
import { z } from "zod";

const ENTITY_TYPES = z.enum(["stream", "dashboard", "search"]);

export const GetEntitySharesSchema = z.object({
    connectionName: z.string().optional(),
    entityGrn: z.string().optional(),
    entityType: ENTITY_TYPES.optional(),
    entityId: z.string().min(1).optional(),
}).refine(
    (a) => Boolean(a.entityGrn) !== Boolean(a.entityType && a.entityId),
    { message: "Provide either entityGrn, or both entityType and entityId (not both, not neither)." },
);

export const ListGranteesSchema = GetEntitySharesSchema; // same input surface
```

### Registering into the authz barrel (empty → non-empty)
```javascript
// src/tools/authz/index.js — Phase 9 makes this the FIRST non-empty authz barrel.
import { register } from "../../dispatch.js";
import { handleGetEntityShares } from "./get-entity-shares.js";
import { handleListGrantees } from "./list-grantees.js";

register("get_entity_shares", handleGetEntityShares);
register("list_grantees", handleListGrantees);
```
`src/tools/_register.js` already has `import "./authz/index.js";` — no change needed there. `assertAllToolsRegistered(toolDefinitions)` at startup fail-fasts if a `tools.js` entry lacks a handler, so adding the `tools.js` defs and the `register()` calls must happen together.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Brief's `PUT /api/authz/shares/{grn}` | `POST /api/authz/shares/entities/{entityGRN}/prepare` (read) | Verified live in Phase 8, 2026-05-19 | Phase 9 must use the corrected `POST .../prepare` path; the brief is recorded WRONG. |
| Open question: does 7.0.6 omit `synced_entities`? | Resolved — `synced_entities` IS present (empty array) in live 7.0.6 | Phase 8 Plan 03 live capture | Phase 9 still models version-variable fields defensively but the field exists. |

**Deprecated/outdated:**
- The CLAUDE.md header says Graylog `7.2.0-SNAPSHOT` and "tested on 6.2" in places — superseded. The verified live target is `7.0.6+711d207` per the Phase 8 fixture `_provenance`. Build against 7.0.6 wire shapes.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `list_grantees` should project to `available_grantees` only (vs. surfacing the full DTO like `get_entity_shares`) | User Constraints / Pattern 1 | LOW — success criterion 2 says `list_grantees` returns "resolvable users/teams … derived from `available_grantees`"; a fuller surface would still satisfy it. A discuss-phase may prefer full DTO for consistency. |
| A2 | `get_entity_shares` works unchanged for `dashboard` and `search` GRN types (only the type token differs) | User Constraints | LOW — `GRN_TYPES` includes all three; the `/prepare` endpoint is GRN-type-agnostic per FEATURES.md. Live-verified only for `stream` (the Phase 8 fixture). The Phase 9 live smoke test should probe a dashboard and a search GRN to confirm. |
| A3 | No CONTEXT.md exists; constraints are derived from ROADMAP + Phase 8 outputs | User Constraints | MEDIUM — if `/gsd:discuss-phase` runs, its CONTEXT.md decisions supersede this section and must be copied verbatim. |
| A4 | Surfacing the `EntityShareResponse` verbatim (no strict zod validation of the *response*) is acceptable | Pitfall 4 | LOW — passing the DTO through untouched is the most defensive choice against 7.0.6/7.2 field drift; a strict response schema would be the riskier option. |
| A5 | `list_grantees` and `get_entity_shares` are two separate tool names/handlers | Pattern 3 | LOW — both ROADMAP and Phase 8 SUMMARY name them as two distinct tools. |

## Open Questions (RESOLVED)

**Both resolved during Phase 9 planning:** OQ1 → `list_grantees` is scoped to the same entity-keyed `/prepare` call as `get_entity_shares` (success criterion 2 says "available grantees *for an entity*"); a connection-wide grantee list is deferred as a separate future tool. OQ2 → plan 09-02's live smoke task probes dashboard and saved-search entity types with a SKIP fallback when none exist on the live instance.

1. **Does `list_grantees` need its own entity target, or can it list grantees connection-wide?**
   - What we know: `available_grantees` comes from a *per-entity* `prepare` response in the live fixture. The set is "grantees you may share *this entity* with".
   - What's unclear: whether an agent wants a global "who exists" list independent of an entity. `GET /api/users/paginated` would answer that, but it is a different endpoint.
   - Recommendation: scope `list_grantees` to the same entity-keyed `prepare` call as `get_entity_shares` (success criterion 2 says "available grantees *for an entity*"). A connection-wide grantee list is a separate future tool if needed.

2. **Should the live smoke test probe a dashboard and a saved-search, or only a stream?**
   - What we know: Phase 8 captured only a `stream` fixture. Success criterion 1 requires all three types work.
   - What's unclear: whether the live `test` instance has a dashboard and a saved search to probe non-mutatingly.
   - Recommendation: the smoke test discovers one of each via `GET /api/views` (dashboards + searches share the views API) and runs `/prepare` against each; if none exists, the offline fixture test plus the stream smoke test is the floor, and the dashboard/search path is asserted by GRN-type-parameterization unit tests.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js ≥18 | ESM runtime, `node:test` | ✓ (project requirement) | — | — |
| Graylog `test` connection | Live non-mutating smoke test | ✓ | 7.0.6+711d207 | Offline fixture-replay (`prepare-response-7.0.6.json`) covers all parsing logic if the live instance is unreachable |
| `test/fixtures/authz/prepare-response-7.0.6.json` | Offline DTO-parse tests | ✓ | Phase 8 deliverable | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** The live `test` instance — if unreachable at test time, the offline fixture covers DTO parsing; the live smoke test is the only network-dependent check and is intentionally separate from `npm test`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` (Node ≥18 builtin) |
| Config file | none — tests run via `node --test` / `npm test` (`test-server.js` harness + per-file `test/*.test.js`) |
| Quick run command | `node --test test/authz-entity-shares.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SHARE-02 | `get_entity_shares` returns `active_shares` from a `/prepare` response | unit (fixture-replay via `_testConnection` + captured-request seam) | `node --test test/authz-entity-shares.test.js` | ❌ Wave 0 |
| SHARE-02 | `get_entity_shares` surfaces the full nested `EntityShareResponse` unflattened | unit | `node --test test/authz-entity-shares.test.js` | ❌ Wave 0 |
| SHARE-02 | `get_entity_shares` works for `stream`, `dashboard`, `search` GRN types | unit (GRN-type-parameterized; asserts request path) | `node --test test/authz-entity-shares.test.js` | ❌ Wave 0 |
| SHARE-02 | request path is `POST .../entities/{encodeURIComponent(grn)}/prepare` (encoded, `/prepare` suffix) | unit (captured-request assertion) | `node --test test/authz-entity-shares.test.js` | ❌ Wave 0 |
| SHARE-09 | `list_grantees` returns `available_grantees` ({id GRN, type, title}) | unit (fixture-replay) | `node --test test/authz-entity-shares.test.js` | ❌ Wave 0 |
| SHARE-02/09 | malformed GRN / bad entity type → clean MCP error, no HTTP call | unit | `node --test test/authz-entity-shares.test.js` | ❌ Wave 0 |
| SHARE-02/09 | offline parse against the verified `prepare-response-7.0.6.json` | unit (fixture-shape) | `node --test test/authz-entity-shares.test.js` | ❌ Wave 0 (fixture itself ✓ from Phase 8) |
| SHARE-02/09 | live non-mutating smoke test against the `test` connection | smoke (network; separate from `npm test`) | `node --test test/authz-entity-shares-live.smoke.js` (or a `scripts/` probe) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test test/authz-entity-shares.test.js` (offline; sub-second).
- **Per wave merge:** `npm test` — full suite (1119+ tests as of Phase 8) must stay green; authz portion stays fully offline.
- **Phase gate:** Full suite green + one live non-mutating smoke run against the `test` connection before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `test/authz-entity-shares.test.js` — offline unit tests for `get_entity_shares` + `list_grantees` (fixture-replay via the `_testConnection` seam and the `client.js` `_setCaptureRequest` request-capture seam). Covers SHARE-02, SHARE-09.
- [ ] Live smoke check — a non-mutating `/prepare`-only probe against the `test` connection (a `*.smoke.js` test or a `scripts/` probe in the `capture-authz-prepare-fixture.js` mould). Not part of `npm test`.
- [ ] Possible fixture extension — a dashboard and/or saved-search `prepare` capture, if Open Question 2 resolves toward live multi-type verification. The existing stream fixture is the floor.
- No framework install needed — `node:test` is a builtin and `test/authz-grn.test.js` already establishes the authz test file pattern.

## Security Domain

> `security_enforcement` is not set to `false` in `.planning/config.json` — treated as enabled. Phase 9 is a non-mutating read surface, so the applicable controls are narrow.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing HTTP Basic token-as-username via `makeClient(conn)` — no new auth concept (CLAUDE.md constraint). Token stored plaintext in `~/.graylog-mcp/config.json` (pre-existing). |
| V3 Session Management | no | Stateless request/response; no sessions. |
| V4 Access Control | yes | Graylog enforces authz server-side. Insufficient permission on `/prepare` surfaces as an upstream 403 → `wrapGraylogError` (CLAUDE.md: "Insufficient permissions surface as upstream 403"). The MCP does not re-implement access control. |
| V5 Input Validation | yes | `zod` on tool inputs; `buildGrn`/`parseGrn` reject malformed GRNs client-side (`GRN_TYPES` enum) before any HTTP call. `entityType` constrained to `stream`/`dashboard`/`search`. |
| V6 Cryptography | no | No crypto in Phase 9 — `computeShareGrantHash` is Phase 10 only. |

### Known Threat Patterns for {Node ESM MCP server / Graylog REST}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path injection via crafted GRN/id into the request path | Tampering | `parseGrn`/`buildGrn` validate structure + type; `encodeURIComponent` encodes the GRN into the path so injected `:` or `/` cannot mis-route or path-traverse. |
| Information disclosure — logging full grant maps / GRNs at info level | Information Disclosure | Keep grant detail to the tool's JSON response only; use minimal `console.error` for failures (project error-handling convention). [CITED: PITFALLS.md "Security Mistakes"] |
| Over-trusting the brief's wrong endpoint → hitting the mutating commit path | Tampering / Elevation | Hardcode the `/prepare` path; assert the `/prepare` suffix in handler/test. Phase 9 never touches the commit endpoint. |
| `_testConnection` seam reachable from a production agent | Spoofing | The seam is deliberately absent from the zod schema; zod `strip` mode drops it from real-agent payloads; it is re-merged only from raw args inside the handler. [VERIFIED: get-pipeline.js seam pattern] |

## Sources

### Primary (HIGH confidence)
- `test/fixtures/authz/prepare-response-7.0.6.json` — verbatim live 7.0.6 `EntityShareResponse` capture; the exact DTO Phase 9 parses.
- `.planning/phases/08-.../08-TEST-STRATEGY.md` — corrected endpoint, GRN URL-encoding rule, `synced_entities` resolution, dryRun/offline test contract.
- `.planning/phases/08-.../08-01-SUMMARY.md`, `08-03-SUMMARY.md` — Phase 8 deliverables: `grn-helpers.js`, `Capability` enum, empty `authz/index.js`, fixture capture.
- `src/tools/pipelines/get-pipeline.js`, `src/tools/streams/get-stream.js` — verified plain-async single-DTO read-handler precedent (the structure to copy).
- `src/tools/authz/grn-helpers.js`, `src/tools/authz/schemas.js`, `src/tools/authz/index.js` — Phase 8 authz scaffolding to build on.
- `src/tools/_shared/connection.js`, `src/graylog/client.js` — connection resolution + HTTP client (POST-empty-body support verified).
- `scripts/capture-authz-prepare-fixture.js` — verified GRN URL-encoding + `/prepare`-suffix-guard precedent.
- `src/tools/_register.js`, `src/tools.js` — wiring: `authz/index.js` already imported; tool-def array shape.
- `.planning/research/FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md`, `SUMMARY.md` — milestone research, all source-cited to the Graylog Java codebase.

### Secondary (MEDIUM confidence)
- Milestone research's 7.2-source DTO field claims — confirmed byte-identical to 7.0.6 on the authz/shares surface by git-tag diff; the live fixture supersedes them for `EntityShareResponse`.

### Tertiary (LOW confidence)
- Live behavior of `/prepare` for `dashboard` and `search` GRN types — inferred from GRN-type-agnostic endpoint design; only `stream` is live-captured. Open Question 2; Phase 9 smoke test should confirm.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; all four libraries already in `package.json`; client/connection infra verified by reading source.
- Architecture: HIGH — handler shape, registration, and endpoint all have verified file precedents (`get-pipeline.js`, `pipelines/index.js`, `capture-authz-prepare-fixture.js`); `EntityShareResponse` shape live-verified.
- Pitfalls: HIGH — every pitfall is sourced to Phase 8 outputs, the live fixture, or source-cited milestone research.

**Research date:** 2026-05-19
**Valid until:** 2026-06-18 (stable — additive read tools on a verified 7.0.6 endpoint; re-verify if the `test` instance is upgraded past 7.0.6 or if CONTEXT.md changes scope)
