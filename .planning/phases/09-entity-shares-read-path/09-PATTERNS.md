# Phase 9: Entity Shares Read Path - Pattern Map

**Mapped:** 2026-05-19
**Files analyzed:** 7 (4 new, 3 modified)
**Analogs found:** 7 / 7

## File Classification

| New/Modified File | New/Mod | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|---------|------|-----------|----------------|---------------|
| `src/tools/authz/get-entity-shares.js` | NEW | tool handler (read) | request-response | `src/tools/pipelines/get-pipeline.js` | exact (plain async single-DTO read) |
| `src/tools/authz/list-grantees.js` | NEW | tool handler (read) | request-response | `src/tools/pipelines/get-pipeline.js` | exact (plain async single-DTO read, projected) |
| `src/tools/authz/prepare-share.js` (optional) | NEW | utility (private fetch helper) | request-response | `scripts/capture-authz-prepare-fixture.js` (lines 83-103) | role-match (no in-`src` precedent; the encode+`/prepare` call pattern) |
| `src/tools/authz/index.js` | MOD | domain register barrel | — | `src/tools/pipelines/index.js` | exact |
| `src/tools/authz/schemas.js` | MOD | zod input schemas | — | `src/tools/pipelines/schemas.js` (`GetPipelineSchema`, lines 24-27) | exact (plain ZodObject read schema, NOT `mutatingBase`) |
| `src/tools.js` | MOD | tool definitions | — | `src/tools.js` `get_pipeline` def (lines 1374-1385) | exact |
| `test/authz-entity-shares.test.js` | NEW | test | request-response | `test/pipelines.test.js` get_pipeline group (lines 245-290) + `test/authz-grn.test.js` fixture group (lines 161-218) | exact |

**No analog gaps:** every Phase 9 file maps to a verified precedent. The only file with no `src/` precedent is the optional private fetch helper — but its load-bearing logic (GRN `encodeURIComponent` + `/prepare` path) is verified verbatim in `scripts/capture-authz-prepare-fixture.js`.

## Shared/Cross-Cutting Patterns

### Connection resolution + `_testConnection` seam re-merge
**Source:** `src/tools/pipelines/get-pipeline.js` lines 32-39
**Apply to:** both handler files (and the shared helper if it resolves the connection).
The `_testConnection` seam is deliberately ABSENT from the zod schema (zod `strip` mode drops it from real-agent payloads); it is re-merged from the *pre-zod* raw args inside the handler so production agents cannot bypass connection lookup.
```javascript
const seamArgs = rawArgs._testConnection
    ? { ...args, _testConnection: rawArgs._testConnection }
    : args;
const { conn, name: connectionName, error } = resolveConnection(seamArgs);
if (error) return error;
```

### Error handling — read-tool envelope
**Source:** `src/tools/pipelines/get-pipeline.js` lines 12-19, 28-30, 62-64
**Apply to:** both handler files.
- zod-parse failure → `return errorResponse(formatZodError(err));`
- HTTP error → `return wrapGraylogError(err, "<tool_name>");` — embeds the tool name in the rendered MCP error text for agent-debuggability.
All three exports come from `src/tools/_shared/errors.js` (`errorResponse` :17, `formatZodError` :27, `wrapGraylogError` :50).

### HTTP client — `makeClient(conn).request(method, path, body)`
**Source:** `src/graylog/client.js` lines 29-86
**Apply to:** both handlers / the shared helper.
- A `POST` with an explicit `{}` body sets `Content-Type: application/json` (`hasBody` true at lines 53-59). This is the correct read call — the empty-object body, not `null`.
- A `null`/`undefined` body sends NO body and NO `Content-Type` (lines 49-59). Phase 9 must pass `{}`, not `null`, to `/prepare`.
- The same file exposes the unit-test seam `_setCaptureRequest(fn)` / `_clearCaptureRequest()` (lines 20-27) — the offline test harness.

### GRN construction / validation — never inline string concatenation
**Source:** `src/tools/authz/grn-helpers.js` (Phase 8, unchanged)
**Apply to:** both handlers / the shared helper.
- `buildGrn(type, id)` (lines 49-68) → canonical `grn::::<type>:<id>`, lowercased; throws on unknown type / empty id.
- `parseGrn(grn)` (lines 85-110) → validates a raw GRN string; throws on malformed input.
- `GRN_TYPES` (lines 26-33) is the restricted 6-type set: `stream`, `dashboard`, `search`, `user`, `builtin-team`, `role`. The Phase 9 `entityType` enum (`stream`/`dashboard`/`search`) is a subset.

### GRN URL-path encoding
**Source:** `scripts/capture-authz-prepare-fixture.js` lines 83-92 (verified live against 7.0.6)
**Apply to:** both handlers / the shared helper — every request path that embeds a GRN.
A GRN contains literal `:` characters; interpolated raw, JAX-RS mis-routes. Always `encodeURIComponent`. Optionally self-guard `path.endsWith("/prepare")` (the capture script does, line 92).

## Pattern Assignments

### `src/tools/authz/get-entity-shares.js` (NEW — tool handler, request-response)

**Analog:** `src/tools/pipelines/get-pipeline.js` (copy line-for-line; NOT `defineListHandler`, NOT `defineMutatingHandler`).

**Imports pattern** (`get-pipeline.js` lines 12-19) — adapt to authz module:
```javascript
import { GetEntitySharesSchema } from "./schemas.js";
import { resolveConnection } from "../_shared/connection.js";
import { makeClient } from "../../graylog/client.js";
import { buildGrn, parseGrn } from "./grn-helpers.js";
import {
    errorResponse,
    formatZodError,
    wrapGraylogError,
} from "../_shared/errors.js";
```

**Handler skeleton** (`get-pipeline.js` lines 21-30, 32-39) — read raw args → zod-parse → resolve connection with seam re-merge:
```javascript
export async function handleGetEntityShares(request) {
    const rawArgs = request?.params?.arguments ?? {};

    let args;
    try {
        args = GetEntitySharesSchema.parse(rawArgs);
    } catch (err) {
        return errorResponse(formatZodError(err));
    }

    const seamArgs = rawArgs._testConnection
        ? { ...args, _testConnection: rawArgs._testConnection }
        : args;
    const { conn, name: connectionName, error } = resolveConnection(seamArgs);
    if (error) return error;
```

**GRN normalization** (no direct line-precedent in `get-pipeline.js`, which takes a plain id; this is the authz-specific step — see RESEARCH Pattern 1, lines 181-188):
```javascript
    // entityGrn XOR (entityType,entityId) — schema .refine guarantees exactly one.
    let entityGrn;
    try {
        entityGrn = args.entityGrn
            ? (parseGrn(args.entityGrn), args.entityGrn.toLowerCase())
            : buildGrn(args.entityType, args.entityId);
    } catch (err) {
        return errorResponse(`Invalid entity reference: ${err.message}`);
    }
```

**Core request + envelope** (`get-pipeline.js` lines 45-64 — the try/`client.request`/JSON-envelope/`wrapGraylogError` shape):
```javascript
    try {
        const client = makeClient(conn);
        const path = `/api/authz/shares/entities/${encodeURIComponent(entityGrn)}/prepare`;
        const shares = await client.request("POST", path, {}); // {} body = pure read, @NoAuditEvent
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    tool: "get_entity_shares",
                    connection: connectionName,
                    entity_shares: shares,   // FULL nested EntityShareResponse, unflattened
                }),
            }],
        };
    } catch (err) {
        return wrapGraylogError(err, "get_entity_shares");
    }
}
```
Note: `get-pipeline.js` uses `GET` + `null` body; Phase 9 uses `POST` + `{}` body (the read-via-prepare contract). Everything else copies exactly.

---

### `src/tools/authz/list-grantees.js` (NEW — tool handler, request-response)

**Analog:** identical to `get-entity-shares.js` above. Same imports, same skeleton, same GRN normalization, same `POST .../prepare` call. **Diverges only at the envelope** (RESEARCH lines 134-136): project to `available_grantees` instead of surfacing the full DTO.
```javascript
        const preview = await client.request("POST", path, {});
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    tool: "list_grantees",
                    connection: connectionName,
                    grantees: preview?.available_grantees ?? [],
                }),
            }],
        };
    } catch (err) {
        return wrapGraylogError(err, "list_grantees");
    }
```
Each `available_grantees` entry is `{ id: <user/team GRN>, type: "user"|"team"|"global", title: <human name> }` (verified — fixture lines 15-41; note `Everyone` has `type: "global"`, not `team`).

---

### `src/tools/authz/prepare-share.js` (NEW, OPTIONAL — private fetch helper)

**Analog:** `scripts/capture-authz-prepare-fixture.js` lines 83-103 (the verified encode + `/prepare` call). No in-`src/` precedent — this is the RESEARCH Pattern 3 factoring (lines 221-224): both handlers make the *identical* call, so a private `fetchEntitySharePreview(client, entityGrn)` removes divergence risk.
```javascript
// Verified pattern — scripts/capture-authz-prepare-fixture.js:88,103
export async function fetchEntitySharePreview(client, entityGrn) {
    const path = `/api/authz/shares/entities/${encodeURIComponent(entityGrn)}/prepare`;
    // optional self-guard, mirroring capture-authz-prepare-fixture.js:92
    return client.request("POST", path, {});
}
```
If adopted, both handlers import this and the GRN-normalization block; keep connection resolution + envelope shaping in each handler. Discretion (RESEARCH line 44): a separate helper file is recommended but a shared block inside one handler is acceptable.

---

### `src/tools/authz/index.js` (MODIFIED — empty barrel → 2 register calls)

**Analog:** `src/tools/pipelines/index.js` lines 11-13, 28-29 (import handler → `register("tool_name", handler)`).
Phase 8 shipped this file empty (current state: import of `register` only, no calls — lines 15-17). Phase 9 adds:
```javascript
import { register } from "../../dispatch.js";
import { handleGetEntityShares } from "./get-entity-shares.js";
import { handleListGrantees } from "./list-grantees.js";

register("get_entity_shares", handleGetEntityShares);
register("list_grantees", handleListGrantees);
```
`src/tools/_register.js` line 95 already has `import "./authz/index.js";` — **no edit needed there.** `assertAllToolsRegistered(toolDefinitions)` fail-fasts at startup if a `tools.js` entry lacks a handler, so the `tools.js` defs and these `register()` calls must land together.

---

### `src/tools/authz/schemas.js` (MODIFIED — add 2 read schemas)

**Analog:** `src/tools/pipelines/schemas.js` `GetPipelineSchema` lines 24-27 — a plain `z.object`, explicitly NOT extending `mutatingBase` (the comment lines 22-23 state the rule: `mutatingBase` fields like `dryRun`/`idempotencyKey` "would be confusing on a GET"). Phase 9 read tools follow the same rule — no `dryRun`.
The current `authz/schemas.js` imports only `z` and exports `Capability` (lines 8-17); it deliberately has not imported `mutatingBase` yet (lines 4-6). Add:
```javascript
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
The `.refine` XOR pattern has direct precedent in `pipelines/schemas.js` `CreatePipelineRuleSchema` lines 242-245 (`Boolean(a) !== Boolean(b)`).

---

### `src/tools.js` (MODIFIED — append 2 tool definitions)

**Analog:** `src/tools.js` `get_pipeline` definition lines 1374-1385 — `{ name, description, inputSchema }`, `inputSchema.type: "object"`, `properties` with `connectionName`. Note `get_pipeline` lists `required: ["pipelineId"]`; Phase 9 tools omit `required` because the entityGrn-XOR-(type,id) constraint is enforced by the zod `.refine`, not by JSON-schema `required`.
```javascript
{
    name: "get_entity_shares",
    description: "Read an entity's current grants (active shares) plus the grantees/capabilities it can be shared with. Non-mutating. Accepts entityGrn OR (entityType,entityId). Note: active_shares excludes the requesting user's own grant.",
    inputSchema: {
        type: "object",
        properties: {
            connectionName: { type: "string" },
            entityGrn: { type: "string", description: "Full GRN, e.g. grn::::stream:<id>. Either this OR entityType+entityId." },
            entityType: { type: "string", enum: ["stream", "dashboard", "search"], description: "Entity type. Use with entityId." },
            entityId: { type: "string", description: "Entity id (from list_streams / list_dashboards). Use with entityType." },
        },
    },
},
{
    name: "list_grantees",
    description: "List the users/teams an entity can be shared with (resolves a username to the user-GRN share_entity needs). Non-mutating. Accepts entityGrn OR (entityType,entityId).",
    inputSchema: { /* identical properties block to get_entity_shares */ },
},
```
A schema-parity test elsewhere in the suite checks `tools.js` `inputSchema` against the zod schema — keep the property names aligned.

---

### `test/authz-entity-shares.test.js` (NEW — offline unit tests)

**Analog (handler behaviour):** `test/pipelines.test.js` get_pipeline group, lines 245-290 — three test shapes to copy:
1. **Request-path assertion** (lines 247-258): `_setCaptureRequest((req) => { captured = req; return FIXTURE; })`, call the handler, then `assert.equal(captured.method, "POST")` and `assert.match(captured.path, /\/prepare$/)` + assert the path contains the percent-encoded GRN (`%3A`, no raw `:` after `entities/`).
2. **Full-DTO surfacing** (lines 260-273): `_setCaptureRequest(() => FIXTURE)`, parse `res.content[0].text`, assert `payload.tool`, and that `payload.entity_shares.available_grantees` / `.active_shares` / `.available_capabilities` are all present and nested (NOT flattened).
3. **Error propagation** (lines 275-290): `_setCaptureRequest(() => { throw new GraylogNotFoundError(...) })`, assert `res.isError === true` and the rendered text matches `/get_entity_shares/`.

**Analog (test scaffold):** `test/pipelines.test.js` lines 22-67:
- imports: `test`, `beforeEach`, `afterEach` from `node:test`; `assert` from `node:assert/strict`; `_setCaptureRequest` / `_clearCaptureRequest` from `../src/graylog/client.js`; connection test hooks from `../src/config.js`; `GraylogNotFoundError` from `../src/graylog/errors.js`.
- `afterEach` calls `_clearCaptureRequest()` (line 63) — mandatory cleanup so a leftover seam does not silently disable HTTP in later tests.
- handlers are driven by `{ params: { arguments: { _testConnection: "fake", ... } } }` (line 254) — the `_testConnection` magic arg swaps in a fake connection without touching the registry.

**Analog (fixture replay):** `test/authz-grn.test.js` lines 14-28, 161-218 — load the committed fixture offline and pin its shape:
```javascript
const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "authz");
const PREPARE_FIXTURE = JSON.parse(
    readFileSync(join(FIXTURE_DIR, "prepare-response-7.0.6.json"), "utf8"),
);
```
Replay `PREPARE_FIXTURE` through `_setCaptureRequest(() => PREPARE_FIXTURE)` to drive the handlers offline. Also add a malformed-GRN test (bad type / 5-empty-colon string) asserting a clean `errorResponse` and **no** captured request (`captured` stays `null`) — mirrors `test/pipelines.test.js:296-304`'s "no request reached the seam" assertion.

## Reference DTO — the fixture Phase 9 surfaces

`test/fixtures/authz/prepare-response-7.0.6.json` (verified live 7.0.6+711d207). Top-level `EntityShareResponse` keys the handlers pass through: `entity`, `sharing_user`, `available_grantees` (array of `{id,type,title}`), `available_capabilities` (`view`/`manage`/`own`), `active_shares` (empty `[]` here — the probed stream has no other-grantee grants; an entry is `{grant,grantee,capability}`), `selected_grantee_capabilities`, `missing_permissions_on_dependencies`, `synced_entities`, `validation_result`. The `_provenance` block is fixture-only metadata — strip it or ignore it; do not surface it as part of `entity_shares`.

## No Analog Found

None. All 7 files map to a verified precedent.

## Metadata

**Analog search scope:** `src/tools/pipelines/`, `src/tools/authz/`, `src/tools/_shared/`, `src/graylog/`, `scripts/`, `test/`
**Files scanned:** `get-pipeline.js`, `pipelines/index.js`, `pipelines/schemas.js`, `pipelines.test.js`, `authz/index.js`, `authz/schemas.js`, `authz/grn-helpers.js`, `authz-grn.test.js`, `graylog/client.js`, `capture-authz-prepare-fixture.js`, `tools.js`, `_register.js`, `_shared/errors.js`, `prepare-response-7.0.6.json`
**Pattern extraction date:** 2026-05-19
</content>
</invoke>
