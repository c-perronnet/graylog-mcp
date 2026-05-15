# Phase 1: Inputs & Extractors — Research

**Researched:** 2026-05-15
**Domain:** Graylog 7.0.6 inputs + extractors admin surface (12 mutating tools composed over Phase 0 primitives)
**Confidence:** HIGH on REST endpoint shapes, encrypted-field merge mechanics, lifecycle, type-catalogue shape. MEDIUM on a few 7.0.6-vs-7.2 divergences flagged below.

## Summary

Phase 1 ships **12 tools** — 1 list-tool (`list_input_types`) plus 11 mutating tools through `defineMutatingHandler` — that give the agent full lifecycle control of Graylog inputs and their extractors. The Graylog 7.0.6 endpoint surface for this domain is small (one `InputsResource`, one `InputStatesResource`, one `ExtractorsResource`, one `InputTypesResource`) and the contract is well-defined in `source-code/graylog2-server/`. Phase 0 has already shipped every cross-cutting primitive — `defineMutatingHandler`, `defineListHandler`, `makeClient`, `mutatingBase`, `listBase`, the `__SERVER_ASSIGNED__` sentinel, the `_testConnection` seam, the snapshot-determinism contract, and the `schema-parity.test.js` enrichment template — so Phase 1's work is **pure composition + per-domain schemas + the encrypted-field protection wrapper**, not new infrastructure.

The critical pitfall this phase prevents is **C3: encrypted-field zeroing on update_input** when an agent round-trips the full config. The mechanism is `EncryptedInputConfigs.merge` in Graylog's `InputsResource.update` — it interprets `EncryptedValue` placeholders specifically (`{is_set: true}`, `{keep_value: true}`, `{set_value: "new"}`, `{delete_value: true}`), and the wrapper's defense is the **partial-update shape** (`{ inputId, changes: {...} }`) combined with the live type-catalogue's `is_encrypted` attribute to decide which fields are even allowed in the emitted body.

**Primary recommendation:** Build the 12 tools as a single domain module under `src/tools/inputs/` (per Phase 0 Discretion-05). Co-locate **one** `schemas.js` covering both inputs and extractors (they share the input-id reference). Cache the type catalogue per-connection in a module-level `Map<connectionName, TypeCatalogue>` with a `_clearTypeCatalogueForTests()` underscore-seam. Ship 5 snapshot fixtures (listed in §Snapshot Fixture Design). Extend `test/schema-parity.test.js` with `assertSchemaParityForTool()` calls for every new mutating tool.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Hand-written strict zod schemas for **GELF, Beats, Syslog, Raw/Plaintext**. All other input types accept a **generic validated key-value config object**. Best agent ergonomics on common path; full breadth still reachable.
- **D-02:** `update_input` reads `is_encrypted` flags from the **live type catalogue** (`GET /system/inputs/types/all`) to decide which config fields are encrypted. No static drift.
- **D-03:** `update_input` is partial-update only — `{ inputId, changes: { ...fields... } }`. Wrapper fetches current config, merges only non-encrypted changed fields, emits payload containing **only the changed fields**. Encrypted fields **never echoed** unless the agent explicitly passed a new non-placeholder value.
- **D-04:** `create_input` **accepts encrypted fields at creation time** (TLS cert password, AWS credentials). Dry-run preview shows them redacted (placeholder string). Real value never appears in MCP output.
- **D-05:** `delete_input` deletes with Graylog's auto-cascade (no separate cascade flag). Dry-run preview **enumerates affected extractors** (names + types).
- **D-06:** Type catalogue cached **per connection for server process lifetime**. One fetch per connection serves `list_input_types`, `create_input` validation, and `update_input` `is_encrypted` detection.
- **D-07:** Hand-written strict zod schemas for **all 6 named extractor types** — grok, regex, JSON, key-value (split-and-index), split-and-index, lookup-table. (The requirement enumerates a closed set.)
- **D-08:** `create_input` leaves the new input **stopped**. `start_input` / `stop_input` go through `defineMutatingHandler` like every mutation.
- **D-09:** `update_extractor` reuses partial-update pattern. `delete_extractor` is single-target — **no cascade**.
- **D-10:** `create_input` / `create_extractor` dry-run previews use the Phase 0 `__SERVER_ASSIGNED__` sentinel. Tool descriptions must warn the agent not to reuse a dry-run placeholder ID.

### Claude's Discretion

- **Discretion-01:** Module layout under `src/tools/inputs/` and whether extractors get their own sub-module — follow Phase 0 per-domain `schemas.js` precedent.
- **Discretion-02:** Whether GELF/Syslog UDP/TCP/HTTP transport variants are distinct zod schemas or one schema with a transport discriminant (D-01).
- **Discretion-03:** Exact redaction placeholder string for encrypted fields in previews (D-04) — e.g. `••••`, `<redacted>`, `<value hidden>`.
- **Discretion-04:** Where the per-connection catalogue cache lives (module-level Map keyed by connection name vs. attached to the connection object) and its test seam (D-06).
- **Discretion-05:** How `delete_input`'s extractor enumeration is fetched for the dry-run (one extra `GET /system/inputs/{id}/extractors` call at preview time) and the exact shape of the warning block.

### Deferred Ideas (OUT OF SCOPE)

None. Discussion stayed within phase scope. Streams, pipelines, index sets, dashboards, event definitions, and blueprints are all explicitly later phases per ROADMAP.md.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INPUT-01 | `list_input_types` — dynamic catalogue via `GET /system/inputs/types/all` | §Endpoint Catalogue row 1; §Type Catalogue Response Shape |
| INPUT-02 | `list_inputs` — narrow projection by default; full DTO with `expand: true` (or `fields: "all"`) | §Endpoint Catalogue row 2; §Standard Stack uses `defineListHandler` |
| INPUT-03 | `get_input` — full single-input configuration | §Endpoint Catalogue row 3 |
| INPUT-04 | `create_input` — typed via zod per input type (GELF, Beats, Syslog, Raw/Plaintext) + generic for the rest | §GELF/Beats/Syslog/Raw Schemas; §Encrypted-Field Mechanics |
| INPUT-05 | `update_input` — partial-update only; wrapper merges; encrypted fields protected | §Pitfall C3 Mitigation Algorithm; §Encrypted-Field Mechanics |
| INPUT-06 | `delete_input` — dry-run enumerates affected extractors | §Delete Cascade Behavior; §Snapshot Fixture Design |
| INPUT-07 | `start_input` / `stop_input` — explicit lifecycle | §Lifecycle Endpoint |
| INPUT-08 | `list_extractors` — per-input | §Endpoint Catalogue row 9 |
| INPUT-09 | `create_extractor` — supports grok, regex, JSON, key-value, split-and-index, lookup-table | §Extractor JSON Shapes |
| INPUT-10 | `update_extractor` — same partial-update pattern | §Partial-Update Reuse for Extractors |
| INPUT-11 | `delete_extractor` — explicit, no cascade | §Endpoint Catalogue row 12 |

## Project Constraints (from CLAUDE.md)

- **Tech stack:** Node.js ≥18 ESM (Phase 0 bumped to `>=22.3.0`). **No new dependencies** beyond `@modelcontextprotocol/sdk`, `axios`, `zod`.
- **Single Graylog target:** 7.0.6 (live test instance at `<graylog-host>`). The `source-code/graylog2-server/` clone is 7.2.0-SNAPSHOT — forward-compat reference only. Verify every endpoint shape against 7.0.6 before claiming "done".
- **Dry-run safety:** Every mutating tool MUST default to `dryRun: true`. Applying without an explicit `dryRun: false` is a bug. *(Phase 0's `defineMutatingHandler` enforces this structurally — Phase 1 only has to compose, not re-enforce.)*
- **No web UI:** Output is JSON-stringified text in MCP responses. No browser surface.
- **Code organization:** New admin tools extract into `src/tools/<domain>/` per-domain modules. Follow the `src/tools/cluster-errors.js` and `src/tools/template-mgmt.js` extraction precedent and the Phase 0 `_shared/` layer.
- **Backward compat:** Existing v2.3 read tools unchanged. Existing connection-config schema additive only.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `list_input_types` (dynamic catalogue read) | MCP handler layer (`src/tools/inputs/`) | Phase 0 HTTP client | A `GET` — uses `defineListHandler`-or-direct `makeClient.get`. Cached at the catalogue cache layer (D-06). |
| `list_inputs` / `get_input` (read) | MCP handler layer | Phase 0 HTTP client + `projectItem` | Composes `defineListHandler` (list) and direct handler (get). |
| `create_input` / `update_input` / `delete_input` (mutate) | MCP handler layer (`defineMutatingHandler`) | Phase 0 client + type-catalogue cache | All non-GET — goes through wrapper. `update_input` reads catalogue to gate encrypted fields. |
| `start_input` / `stop_input` (lifecycle mutate) | MCP handler layer (`defineMutatingHandler`) | Phase 0 client | `PUT /system/inputstates/{id}` for start, `DELETE /system/inputstates/{id}` for stop. NOT a "runtime-only" special case (D-08). |
| Extractor CRUD (4 mutating + 1 list) | MCP handler layer | Phase 0 client | Nested under input — path includes `{inputId}`. Same factory pattern as inputs. |
| Per-connection type-catalogue cache | New module-level state in `src/tools/inputs/type-catalogue.js` | — | New on-disk-free state; underscore-seam for tests (Phase 0 precedent: `_clearForTests` in `src/clustering/index.js`, `_setConnectionsForTests` in `src/config.js`). |
| Encrypted-field redaction in previews | `build()` callback inside each mutating handler | Type-catalogue cache | `build()` reads the cached catalogue and decides which fields to emit / redact. The wrapper has no knowledge of encrypted fields. |

This is a **single-tier (server)** MCP project. There is no client/server split, no SSR, no CDN. Everything is server-side Node and the agent talks to it via MCP stdio.

## Standard Stack

### Core (already in Phase 0)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | 1.18.0 | MCP server framework — registered tool definitions | Already in tree; locked dependency per PROJECT.md |
| `axios` | 1.12.2 | HTTP client to Graylog REST | Already wrapped in `src/graylog/client.js` (Phase 0); never call axios directly |
| `zod` | ^3.25.76 | Schema validation; per-domain `schemas.js` | Phase 0 adopted; `mutatingBase` / `listBase` are the extension points |

`[VERIFIED: package.json]` — All three pinned. No new runtime deps required.

`[VERIFIED: package.json:38-40]` — `"engines": { "node": ">=22.3.0" }` after Phase 0 bump.

### Phase 0 Primitives — Compose, Don't Rebuild

| Primitive | Module | What Phase 1 Composes Over |
|-----------|--------|----------------------------|
| `defineMutatingHandler({ name, schema, build, apply, summarize? })` | `src/tools/_shared/handler.js` | Every Phase 1 mutating tool = one factory call |
| `defineListHandler({ name, schema, fetch })` | `src/tools/_shared/list.js` | `list_input_types`, `list_inputs`, `list_extractors` |
| `mutatingBase` / `listBase` | `src/tools/_shared/schemas.js` | Per-domain schemas extend one of these |
| `makeClient(conn)` → `{request, get, post, put, delete}` (note: only `request` exists today — methods below) | `src/graylog/client.js` | All input/extractor API calls through this |
| `toIdBody(response, hint)` | `src/graylog/normalize.js` | `create_input` response (201 + Location + `{id}`) normalizes here |
| `SERVER_ASSIGNED_SENTINEL = "__SERVER_ASSIGNED__"` | `src/tools/_shared/dry-run.js` | `create_input` / `create_extractor` `postApplyEstimate.id` |
| `_setCaptureRequest` / `_clearCaptureRequest` | `src/graylog/client.js` | Test seam — every Phase 1 test uses this in place of axios mocking |
| `_testConnection` seam (re-merged from rawArgs pre-zod) | `src/tools/_shared/{handler,list}.js` | Unit tests inject a synthetic conn without `_setConnectionsForTests` |
| Snapshot infrastructure (`t.assert.snapshot`) + `auth-redaction.test.js` auto-scan | `test/snapshot-config.js` | New `.snapshot` files auto-scanned for apiToken leaks |
| `schema-parity.test.js` enrichment template | `test/schema-parity.test.js` | **MUST** extend with `assertSchemaParityForTool(toolName, zodSchema)` per new tool |

`[VERIFIED: src/tools/_shared/handler.js]`, `[VERIFIED: src/tools/_shared/list.js]`, `[VERIFIED: src/tools/_shared/schemas.js]`, `[VERIFIED: src/graylog/client.js]` — All read directly.

⚠️ **Client API caveat:** Phase 0 shipped `makeClient(conn).request(method, path, body)` — a single `request` method, not `{get, post, put, delete}`. The brief's "request/get/post/put/delete" wording in the `<additional_context>` overstates today's surface. Phase 1 plans should compose `client.request("POST", path, body)` directly, OR optionally add the verb wrappers in `src/graylog/client.js` (small additive change, snapshot-fixed at 75 lines). **Recommendation:** keep `request(method, path, body)` as the canonical surface — adding verb sugar tempts handlers to bypass the typed-error path. `[VERIFIED: src/graylog/client.js:29-75]`

### Version verification

`[VERIFIED: package.json]` 2026-05-15 — Pinned versions are already current as of Phase 0 close (verified by Phase 0 plan 00-02 lockfile sync).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Single domain `src/tools/inputs/` module | Split into `src/tools/inputs/` + `src/tools/extractors/` | More files, but extractors are nested under input IDs (path-coupled). PROJECT.md picks "per-domain extraction" — extractors are properly a sub-domain of inputs, but the per-file plan is light either way. **Decision:** single module, one `schemas.js`. Phase 1 plans MAY revisit if the file count grows past ~10. |
| Hand-written per-type schemas (D-01) | Auto-generate zod from `requested_configuration` in the type catalogue | The catalogue gives field names, types, encrypted flags — enough to build a generic validator. Hand-written is more readable for the 4 common types; auto-generation handles the 50+ less-common types automatically. **D-01 locks both** — hand-written for 4, generic for the rest. |
| Module-level `Map<connectionName, catalogue>` cache | Cache attached to the connection object in `src/config.js` | Same lifetime, different test seam. Module-level lets us isolate the cache import in tests via the existing underscore-seam pattern. **Recommendation:** module-level in `src/tools/inputs/type-catalogue.js`. |

## Architecture Patterns

### Recommended Module Structure (under `src/tools/inputs/`)

```
src/tools/inputs/
├── index.js                      # Side-effect registers all 12 handlers into the dispatch Map
├── schemas.js                    # All zod schemas (inputs + extractors + transport variants)
├── type-catalogue.js             # Per-connection cache (D-06) with _clearTypeCatalogueForTests seam
├── list-input-types.js           # defineListHandler — INPUT-01
├── list-inputs.js                # defineListHandler — INPUT-02
├── get-input.js                  # Plain async handler over makeClient — INPUT-03
├── create-input.js               # defineMutatingHandler — INPUT-04
├── update-input.js               # defineMutatingHandler — INPUT-05 (the partial-update + encrypted-field wrapper)
├── delete-input.js               # defineMutatingHandler — INPUT-06
├── start-input.js                # defineMutatingHandler — INPUT-07a
├── stop-input.js                 # defineMutatingHandler — INPUT-07b
├── list-extractors.js            # defineListHandler — INPUT-08
├── create-extractor.js           # defineMutatingHandler — INPUT-09
├── update-extractor.js           # defineMutatingHandler — INPUT-10
└── delete-extractor.js           # defineMutatingHandler — INPUT-11
```

`index.js` is the side-effect barrel:

```js
// src/tools/inputs/index.js
import { register } from "../../dispatch.js";
import { handleListInputTypes } from "./list-input-types.js";
import { handleListInputs } from "./list-inputs.js";
// ...12 imports total
register("list_input_types", handleListInputTypes);
register("list_inputs", handleListInputs);
// ...12 register calls total
```

`src/tools/_register.js` imports `./tools/inputs/index.js` once. `assertAllToolsRegistered()` (Phase 0) fires at server start if `src/tools.js` advertises a tool name that didn't make it into the dispatch Map.

### Pattern: `defineMutatingHandler` composition (canonical Phase 1 tool)

`[VERIFIED: src/tools/_shared/handler.js:55-158]` — Every mutating tool follows this shape:

```js
import { z } from "zod";
import { defineMutatingHandler } from "../_shared/handler.js";
import { mutatingBase } from "../_shared/schemas.js";

const CreateInputSchema = mutatingBase.extend({
    type: z.string().min(1),
    title: z.string().min(1),
    global: z.boolean().default(false),
    configuration: z.record(z.unknown()), // generic; specialized for GELF/Beats/Syslog/Raw via discriminated union
    node: z.string().optional(),
});

export const handleCreateInput = defineMutatingHandler({
    name: "create_input",
    schema: CreateInputSchema,
    build(args) {
        return {
            method: "POST",
            path: "/api/system/inputs",
            body: redactEncryptedFields(args, getCachedCatalogueOrFetch(args.connectionName)),
            postApplyEstimate: { id: "__SERVER_ASSIGNED__" },
            normalize: (raw) => toIdBody(raw, ["id"]),
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) => `Create ${args.type} input "${args.title}"`,
});
```

The `build()` callback is **pure** — same args always produces same descriptor. The encrypted-field redaction in the preview is part of `build()` and feeds both the dry-run preview and the apply body. `apply()` only runs on `dryRun: false`.

### Pattern: Partial-update for `update_input` (the C3 mitigation centerpiece)

This is the load-bearing pattern of Phase 1. The shape is:

```js
const UpdateInputSchema = mutatingBase.extend({
    inputId: z.string().min(1),
    changes: z.record(z.unknown()).refine(
        (c) => Object.keys(c).length > 0,
        { message: "changes must be non-empty for update_input" }
    ),
});

export const handleUpdateInput = defineMutatingHandler({
    name: "update_input",
    schema: UpdateInputSchema,
    async build(args) {
        // 1. Fetch current input (the ONE extra GET — happens at preview time too,
        //    so the agent can see what's being merged).
        const client = makeClient(getConn(args.connectionName));
        const current = await client.request("GET", `/api/system/inputs/${args.inputId}`, null);

        // 2. Fetch (or hit cache for) the type catalogue to learn encrypted fields.
        const catalogue = await getCachedCatalogueOrFetch(args.connectionName, client);
        const encryptedFields = getEncryptedFieldNamesForType(catalogue, current.type);

        // 3. Compute the merged configuration — emit ONLY changed non-encrypted fields,
        //    OR explicitly-passed encrypted fields (with a fresh placeholder for redaction
        //    in the preview).
        const mergedConfig = mergeNonEncryptedChanges(
            current.configuration,
            args.changes.configuration ?? {},
            encryptedFields
        );

        return {
            method: "PUT",
            path: `/api/system/inputs/${args.inputId}`,
            body: {
                type: current.type, // required by InputCreateRequest
                title: args.changes.title ?? current.title,
                global: args.changes.global ?? current.global,
                node: args.changes.node ?? current.node,
                configuration: mergedConfig,
            },
            postApplyEstimate: { id: args.inputId },
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) => `Update input ${args.inputId} (${Object.keys(args.changes).length} change(s))`,
});
```

Note `build()` is **async** — `defineMutatingHandler` already awaits the return value. `[VERIFIED: src/tools/_shared/handler.js:104]` shows `const req = build(args)` is awaited downstream (`apply(...)` is `await`-ed; `build` is not yet — **plan must update `handler.js` to `const req = await build(args)` if any handler needs an async build, OR ensure all `build()` callbacks are sync**).

⚠️ **Phase 0 contract gap:** `handler.js:104` calls `build(args)` synchronously and uses the return value immediately. For `update_input` (and any tool that needs a pre-flight GET) this means either:
1. Phase 1 plan adds `await` to the `build` call in `handler.js` (1-line change, but it widens the wrapper contract); OR
2. The pre-flight GET happens in a **prepare step** before the handler invokes `defineMutatingHandler`, and the synchronous `build()` receives the already-fetched current state in its args.

**Recommendation:** Option 1. Wrap with `await build(args)` and document the now-async `build` contract. This is a Phase 0 amendment, not a deviation — Phase 0's handler.js was written assuming pure-sync builds because no tool needed pre-flight at that point. **The plan-checker should flag this if Plan 1's first task does not address it.**

### Pattern: Catalogue cache (D-06) with test seam

```js
// src/tools/inputs/type-catalogue.js
import { makeClient } from "../../graylog/client.js";

const _cache = new Map(); // Map<connectionName, { fetchedAt, catalogue }>

export async function getCachedTypeCatalogue(connectionName, conn) {
    if (_cache.has(connectionName)) return _cache.get(connectionName).catalogue;
    const client = makeClient(conn);
    const catalogue = await client.request("GET", "/api/system/inputs/types/all", null);
    _cache.set(connectionName, { fetchedAt: Date.now(), catalogue });
    return catalogue;
}

export function _clearTypeCatalogueForTests() {
    _cache.clear();
}

// Helper: given catalogue + input type, return Set of encrypted field names.
export function getEncryptedFieldNamesForType(catalogue, inputType) {
    const typeInfo = catalogue[inputType];
    if (!typeInfo?.requested_configuration) return new Set();
    return new Set(
        Object.entries(typeInfo.requested_configuration)
            .filter(([, field]) => field.is_encrypted === true)
            .map(([name]) => name)
    );
}
```

`[VERIFIED: src/clustering/index.js:27]` — `_clearForTests()` is the established project pattern.

### Anti-Patterns to Avoid

- **Per-handler `args.dryRun ?? true`** — Phase 0 enforces it once in `defineMutatingHandler`; never re-add it in `build()` or `apply()`.
- **Hand-encoded axios.post(...)** — Always go through `makeClient(conn).request(...)`. Auth, headers, error mapping, writable-flag refusal all live there.
- **Echoing back a full input config in `update_input`** — The whole point of partial-update is to prevent this. The schema literally rejects a `full_config` field; only `changes` exists.
- **Storing the type catalogue on disk** — D-06 says process-lifetime only. No `~/.graylog-mcp/type-catalogue.json` file.
- **Using `__SERVER_ASSIGNED__` as a real ID in a follow-up call** — Tool descriptions must warn the agent. Blueprint composition is deferred to Phase 6, so Phase 1 tools just return the real ID after apply.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dry-run / apply gating | Per-handler `if (args.dryRun)` branches | `defineMutatingHandler` (Phase 0) | One missed check = silent destructive op. The single most expensive class of bug this milestone can produce. |
| Connection resolution | Per-tool `getActiveConnection()` calls | `defineMutatingHandler` + `resolveConnection` | Per-call `connectionName` arg + singleton fallback already encoded once. |
| Zod validation | Manual `if (!args.foo) return errorResponse(...)` chains | `mutatingBase.extend({...})` | Per-domain schemas + factory-level `schema.parse` runs before any other handler logic. |
| Idempotency keys | Custom hash in each tool | `deriveIdempotencyKey` (Phase 0, sha-256 of canonicalized args) | 32-hex deterministic; auth-redaction lint already knows to allowlist them in snapshots. |
| HTTP client / auth / error mapping | New axios calls per tool | `makeClient(conn).request(method, path, body)` | One outbound call site; typed errors, X-Requested-By header, 60s timeout, D-07 writable refusal all live there. |
| Response shape normalization | `if (response.stream_id) ... else if (response.id) ...` ad-hoc | `toIdBody(response, ["id"])` from `src/graylog/normalize.js` | FOUND-08 covers 10 Graylog create-response variants; input creates return `{id}` + Location header — covered. |
| List-projection / limit clamping | Manual `.slice(0, 25)` and field-picks | `defineListHandler` with `DEFAULT_FIELDS`, `DEFAULT_LIMIT`, `MAX_LIMIT` | M6 context-bloat protection enforced once. |
| Snapshot determinism | Manual JSON.stringify with sorted keys | `t.assert.snapshot(JSON.parse(text))` + Phase 0 config | Already deterministic across two runs; new `.snapshot` files auto-scan for apiToken leaks. |
| Encrypted-field round-trip | "Just let the agent re-send the placeholder" | Partial-update wrapper that gates by `is_encrypted` attribute from live catalogue (D-02/D-03) | C3. The Java merge logic interprets specific placeholder shapes; passing a string-encoded placeholder back is undefined behavior. |
| Type-catalogue per-request fetch | `GET /system/inputs/types/all` on every `create_input` | Per-connection process-lifetime cache (D-06) | Input types effectively never change at runtime; one fetch serves 3 consumers (list_input_types, create validation, update is_encrypted detection). |

**Key insight:** Phase 0 already paid the foundation tax. Phase 1 is a thin per-domain composition layer on top — most plans here will be "wire up the factory with the right schema + build()/apply()". The only **new** infrastructure Phase 1 introduces is the type-catalogue cache and the encrypted-field merge logic.

## Runtime State Inventory

> Phase 1 is greenfield-additive (new modules; no rename, no refactor of existing surface). State to track is **new on-disk-free state**:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Graylog itself stores inputs/extractors in MongoDB; the MCP holds no per-input state. | None |
| Live service config | The type-catalogue cache holds Graylog 7.0.6 `requested_configuration` for every known input type. If a Graylog plugin is added at runtime that registers a new input type, the cache won't see it until process restart. | Document in `list_input_types` tool description. Restart-MCP is the unblock. |
| OS-registered state | None | None |
| Secrets / env vars | The `apiToken` in `~/.graylog-mcp/config.json` already exists and is unchanged by Phase 1. Encrypted-input-config values (TLS cert password, etc.) are never persisted by the MCP — they flow agent → MCP → Graylog and the MCP holds them only for the duration of one tool call. | Ensure no encrypted value lands in a snapshot fixture or log line. The auth-redaction lint already polices apiToken-shaped strings in snapshots; verify it also fires on `"password"` literals in fixtures (it does — see `test/auth-redaction.test.js`). |
| Build artifacts | None — Node ESM, no build step. | None |

## Common Pitfalls

### Pitfall C3 (Critical): Encrypted-Field Zeroing on `update_input`

**What goes wrong:** Agent reads an input via `get_input`, edits `bind_address`, calls `update_input` echoing the full config back. The TLS cert password (encrypted field) is now zeroed out — next start of the input fails to bind.

**Why it happens:** `InputsResource.update` calls `EncryptedInputConfigs.merge(origConfig, updatedConfig)`. The merge logic only **keeps the original encrypted value** when the new value is an `EncryptedValue` instance with `isKeepValue() == true` (i.e., the JSON shape `{"keep_value": true}`). If the agent serializes the response of `get_input` (which shows `{"is_set": true}` — the serialized-without-DB-attribute shape) and passes it back, Graylog's deserializer creates a **fresh `EncryptedValue` with that string as the literal value**, which encrypts → "is_set: true" as the password, not the original. Worse: if the field type expects a `String` and the input is the placeholder `<value hidden>` (the `maskPasswordsInConfiguration` output for IS_SENSITIVE TextFields), the password becomes the literal string `<value hidden>` after re-encryption. The behavior is **best case the agent gets lucky, worst case credentials silently wipe.**

`[CITED: source-code/graylog2-server/.../EncryptedInputConfigs.java:44-77]` — `merge` and `mergeEncryptedValues` source.
`[CITED: source-code/graylog2-server/.../EncryptedValue.java:32-79]` — Placeholder shape semantics (`keep_value`, `delete_value`, `set_value`).
`[CITED: source-code/graylog2-server/.../AbstractInputsResource.java:66-90]` — `maskPasswordsInConfiguration` replaces values with `<password set>` (IS_PASSWORD attribute) or `<value hidden>` (IS_SENSITIVE attribute) on the way out.

**How to avoid (the Phase 1 mitigation algorithm):**

1. **Schema:** `update_input` accepts ONLY `{ inputId, changes: { ...subset of input fields... } }`. No `full_config` mode.
2. **Pre-flight:** `build()` calls `GET /api/system/inputs/{inputId}` to fetch current state.
3. **Catalogue lookup:** `build()` calls (cached) `GET /system/inputs/types/all`, reads `requested_configuration[fieldName].is_encrypted` to identify encrypted fields for the input's type.
4. **Merge rule for `configuration` sub-object:**
   - For **non-encrypted fields**, take the new value from `args.changes.configuration` if present; else preserve the current value.
   - For **encrypted fields**:
     - If `args.changes.configuration[encField]` is **absent** → omit from emitted body (Graylog's merge keeps the old value).
     - If `args.changes.configuration[encField]` is a **plain string** → emit `{ set_value: "<the string>" }` so Graylog's deserializer encrypts it as a new value.
     - If `args.changes.configuration[encField]` is `{ keep_value: true }` → pass through.
     - If `args.changes.configuration[encField]` is `{ delete_value: true }` → pass through.
     - **Never echo back `{ is_set: true }`** — that's the GET response shape; in a PUT payload it would be interpreted as a new value.
5. **Preview redaction:** In the dry-run output, the emitted `body.configuration[encField]` is replaced with `<redacted>` (or similar — Discretion-03) so the secret never appears in MCP output. The actual apply path emits the real placeholder.
6. **Snapshot test (hard gate):** Dry-run `update_input` with `changes: { title: "newTitle" }` against a fixture input that has encrypted fields → assert encrypted fields are **absent** from the emitted body. The pitfall's exact reproducer becomes a test.

**Warning signs:** A test that passes `changes: { configuration: { tls_key_password: "secret123" } }` and expects the literal string in the snapshot is wrong — the snapshot should show the redacted placeholder, and the wire body should be `{ tls_key_password: { set_value: "secret123" } }`. Phase 1 plan-checker should verify this distinction explicitly.

### Pitfall C6: Server-Assigned IDs

**What goes wrong:** Agent dry-runs `create_input`, sees `postApplyEstimate.id: "__SERVER_ASSIGNED__"`, then in a later step (a follow-up `create_extractor` against the new input) the agent passes `"__SERVER_ASSIGNED__"` as the `inputId`. Graylog 404s.

**Why it happens:** Server-side ID assignment is pervasive. `InputsResource.create:444` does `inputService.create(...)` then `inputService.save(input)` — ID generated server-side. `ExtractorsResource.create:128` does `new com.eaio.uuid.UUID().toString()` — ID generated client-side **in the resource handler**, but the wrapper has no visibility into it.

`[CITED: source-code/graylog2-server/.../InputsResource.java:444-448]`
`[CITED: source-code/graylog2-server/.../ExtractorsResource.java:128, 143]`

**How to avoid:** Already mitigated by Phase 0's `SERVER_ASSIGNED_SENTINEL` (D-10). Phase 1 tool descriptions for `create_input` and `create_extractor` MUST contain the warning: *"The `id` in the dry-run `postApplyEstimate` is a placeholder. Apply the call first, then use the returned real ID in any follow-up step. Blueprint chaining is Phase 6's responsibility, not yours."*

**Warning signs:** A test fixture that uses `"__SERVER_ASSIGNED__"` as an input ID in a `create_extractor` invocation.

### Pitfall: Update PUT Returns 201 Not 200

**What goes wrong:** Agent code that assumes "PUT returns 200, POST returns 201" breaks on Graylog's `PUT /system/inputs/{id}` which returns **201 with a Location header**.

`[CITED: source-code/graylog2-server/.../InputsResource.java:485-521]` — `update()` returns `Response.created(inputUri).entity(InputCreated.create(input.getId())).build()` (201).

**How to avoid:** Don't gate on status code. The Phase 0 client uses `validateStatus: () => true` and maps everything ≥400 to typed errors — successful responses (2xx) all flow through to `toIdBody`. The `InputCreated.create(id)` body shape is `{id: "..."}` for both create and update, so `toIdBody(raw, ["id"])` works for both.

### Pitfall: `create_input` 400 on Cloud / Global-Only Mode

**What goes wrong:** Against a Graylog cluster configured with `is_cloud` or `is_global_inputs_only`, a non-global input creation returns 400 "Only global inputs are allowed!".

`[CITED: source-code/graylog2-server/.../InputsResource.java:524-528]`

**How to avoid:** Surface the 400 as the typed `GraylogValidationError` (Phase 0 typed-error hierarchy). The MCP doesn't need to know about cloud mode — agent gets a clear error and can retry with `global: true`. Document in `create_input` description: *"Set `global: true` if your Graylog cluster runs in cloud or global-inputs-only mode."*

### Pitfall: Lifecycle `stop_input` Maps to a DELETE Verb

**What goes wrong:** Intuition says "stop" is a PUT with `state: "stopped"`. Reality on 7.0.6 / 7.2: `start_input` is `PUT /system/inputstates/{inputId}` and `stop_input` is `DELETE /system/inputstates/{inputId}`. (Setting state to RUNNING vs STOPPED is the path/verb distinction.)

`[CITED: source-code/graylog2-server/.../InputStatesResource.java:124-197]` — `start` is `@PUT` to `/{inputId}`; `stop` is `@DELETE` to `/{inputId}`.

**How to avoid:** Schema-wise, `start_input` and `stop_input` are separate tools (D-08), so each owns its own verb internally. Tool descriptions should make this opaque — the agent sees `start_input(inputId)` and `stop_input(inputId)`, not the underlying verb.

### Pitfall: Input Type Catalogue Returns Empty When Permissions Restrict

**What goes wrong:** Agent calls `list_input_types`, gets a small set, doesn't realize the rest are filtered by permission, tries `create_input` with a type from documentation that isn't in the catalogue → 404 "There is no such input type registered."

`[CITED: source-code/graylog2-server/.../InputTypesResource.java:85-99]` — `/types/all` filters by `RestPermissions.INPUT_TYPES_CREATE`.
`[CITED: source-code/graylog2-server/.../InputsResource.java:451-453]` — Throws `NotFoundException` on unknown type.

**How to avoid:** This is a Graylog-side permission concern, not an MCP bug. Document in `list_input_types` description: *"This list reflects the input types your API token has permission to create. If a type is missing, your role lacks `INPUT_TYPES_CREATE` for it."*

### Pitfall: Start/Stop Are Eventually Consistent

**What goes wrong:** Agent calls `start_input`, gets 200 back with `InputCreated.create(inputId)`, immediately calls `get_input` and expects `state: "RUNNING"`. But the input is still in `STARTING` because the actual boot is asynchronous.

`[CITED: source-code/graylog2-server/.../InputStatesResource.java:137-138]` — `inputService.persistDesiredState(input, IOState.Type.RUNNING)` persists the **desired** state; actual state convergence happens elsewhere.

**How to avoid:** Tool description for `start_input` / `stop_input`: *"This call sets the **desired** state — actual state may briefly remain `STARTING` or `STOPPING` until Graylog's input registry converges. Poll `get_input` if you need to wait for `RUNNING`."* No `await_input_state` tool in this phase (would be a 13th tool; defer to Phase 7 if needed).

## Code Examples

Verified patterns from official sources.

### Example 1: Type Catalogue Response Shape (INPUT-01)

`[CITED: source-code/graylog2-server/.../InputTypesResource.java:81-100]` + `[CITED: source-code/graylog2-server/.../InputTypeInfo.java]` + `[CITED: source-code/graylog2-server/.../AbstractConfigurationField.java:91-93]`

`GET /api/system/inputs/types/all` returns `Map<String, InputTypeInfo>`:

```json
{
  "org.graylog2.inputs.gelf.udp.GELFUDPInput": {
    "type": "org.graylog2.inputs.gelf.udp.GELFUDPInput",
    "name": "GELF UDP",
    "description": null,
    "is_exclusive": false,
    "requested_configuration": {
      "bind_address": {
        "field_type": "text",
        "name": "bind_address",
        "human_name": "Bind address",
        "description": "Address to listen on. For example 0.0.0.0 or 127.0.0.1.",
        "default_value": "0.0.0.0",
        "is_optional": false,
        "is_encrypted": false,
        "attributes": [],
        "additional_information": {},
        "position": 100
      },
      "port": {
        "field_type": "number",
        "name": "port",
        "human_name": "Port",
        "default_value": 12201,
        "is_optional": false,
        "is_encrypted": false,
        ...
      }
      // ... more fields
    },
    "link_to_docs": ""
  },
  "org.graylog2.inputs.gelf.tcp.GELFTCPInput": { ... },
  "org.graylog2.inputs.syslog.udp.SyslogUDPInput": { ... },
  ...
}
```

**Key fact:** `is_encrypted` is `true` for fields like `tls_key_password` (TextField constructed with `isEncrypted=true` in `AbstractTcpTransport.Config.getRequestedConfiguration()`). The MCP reads this flag to know what to protect on update. `[VERIFIED: source-code/.../AbstractTcpTransport.java:427-437]` — `CK_TLS_KEY_PASSWORD` constructed with `isEncrypted=true`.

### Example 2: GELF UDP Input — Required and Optional Config (INPUT-04, D-01)

`[VERIFIED: source-code/.../UdpTransport.java]` (line 197+) + `[VERIFIED: source-code/.../NettyTransport.java:51-54, 191-200]`

| Field | Type | Required | Encrypted | Default | Notes |
|-------|------|----------|-----------|---------|-------|
| `bind_address` | text | yes | no | `"0.0.0.0"` | Inherited from `NettyTransport.Config` |
| `port` | number | yes | no | `12201` (GELF default; transport sets 5555 generic, but each input overrides) | |
| `recv_buffer_size` | number | no | no | `1048576` | |
| `number_worker_threads` | number | no | no | `DEFAULT_NUMBER_WORKER_THREADS` | |
| `override_source` | text | no | no | — | GELF codec setting |
| `decompress_size_limit` | number | no | no | `8388608` | GELF codec |

**Zod schema for GELF UDP (D-01 strict variant):**

```js
const GelfUdpConfig = z.object({
    bind_address: z.string().default("0.0.0.0"),
    port: z.number().int().min(1).max(65535).default(12201),
    recv_buffer_size: z.number().int().positive().optional(),
    number_worker_threads: z.number().int().positive().optional(),
    override_source: z.string().optional(),
    decompress_size_limit: z.number().int().positive().optional(),
});
```

### Example 3: GELF TCP — Adds TLS Fields (Encrypted!)

`[VERIFIED: source-code/.../AbstractTcpTransport.java:101-107, 395-466]`

GELF TCP inherits everything from GELF UDP **plus** the TCP transport's TLS fields:

| Field | Type | Required | Encrypted | Notes |
|-------|------|----------|-----------|-------|
| `tls_cert_file` | text | no | no | Path to TLS cert |
| `tls_key_file` | text | no | no | Path to TLS private key |
| `tls_enable` | bool | no | no | Default `false` |
| **`tls_key_password`** | text | no | **yes** | `IS_PASSWORD` + `isEncrypted=true` — **this is the C3 trap** |
| `tls_client_auth` | dropdown | no | no | `disabled` / `optional` / `required` |
| `tls_client_auth_cert_file` | text | no | no | |
| `tcp_keepalive` | bool | no | no | Default `false` |

**Zod schema (D-01 strict variant, GELF TCP):** Compose the UDP base with the TCP-TLS extension. `tls_key_password` in **create** mode accepts a plain string (Graylog deserializes as `set_value`); in **update** mode it accepts either a plain string OR `{ keep_value: true }` / `{ delete_value: true }`. The `set_value` envelope is built by the wrapper, not the agent.

### Example 4: Syslog Variants — Are They One Type or Many?

`[VERIFIED: source-code/.../inputs/syslog/]` — Graylog 7.0/7.2 has **5 separate Syslog input classes**:

- `org.graylog2.inputs.syslog.udp.SyslogUDPInput`
- `org.graylog2.inputs.syslog.tcp.SyslogTCPInput`
- `org.graylog2.inputs.syslog.kafka.SyslogKafkaInput`
- `org.graylog2.inputs.syslog.amqp.SyslogAMQPInput`
- (no HTTP Syslog input in 7.2)

**Each is a distinct `type` string** in `InputCreateRequest.type`. There is no "Syslog" type with a transport discriminant — UDP / TCP / Kafka / AMQP are separate types and the type catalogue lists them separately.

Same pattern for GELF (5 types: UDP, TCP, HTTP, Kafka, AMQP) and Raw (5 types: UDP, TCP, HTTP, Kafka, AMQP). **Beats has 2 types**: `org.graylog.plugins.beats.Beats2Input` (modern; netty-based) and `org.graylog.plugins.beats.kafka.BeatsKafkaInput`. The pre-Beats2 `BeatsInput` exists but is deprecated.

**Discretion-02 resolution:** Use a **zod discriminated union per family**. One union per family (`gelfUnion`, `syslogUnion`, `beatsUnion`, `rawUnion`) discriminated on the full `type` FQCN string. The base shared shape (NettyTransport's bind_address/port/recv_buffer_size/worker_threads) is a common refinement applied to every variant. The TCP variants compose in the TLS extension; the UDP variants don't.

### Example 5: Extractor JSON Shapes (INPUT-09, D-07)

`[VERIFIED: source-code/.../CreateExtractorRequest.java]` + `[VERIFIED: source-code/.../Extractor.java:64-72]` + `[VERIFIED: source-code/.../inputs/extractors/{Grok,Regex,Json,SplitAndIndex,LookupTable,Substring,RegexReplace,CopyInput}Extractor.java]`

**Common envelope (all extractor types):**

```json
{
    "title": "Extract username from log message",
    "cursor_strategy": "copy",           // or "cut"
    "source_field": "message",
    "target_field": "username",
    "extractor_type": "grok",            // lowercase; one of: substring, regex, regex_replace, split_and_index, copy_input, grok, json, lookup_table
    "extractor_config": { ... },         // type-specific — see below
    "converters": [ ... ],               // optional; list of { type, config } pairs
    "condition_type": "none",            // or "string" or "regex"
    "condition_value": "",
    "order": 0
}
```

**Per-type `extractor_config` shapes:**

| Extractor Type | `extractor_config` Schema | Source |
|----------------|---------------------------|--------|
| `grok` | `{ grok_pattern: string, named_captures_only?: bool }` | `GrokExtractor.java` |
| `regex` | `{ regex_value: string }` | `RegexExtractor.java` |
| `regex_replace` | `{ regex: string, replacement: string, replace_all?: bool }` | `RegexReplaceExtractor.java` |
| `split_and_index` | `{ split_by: string, index: int }` | `SplitAndIndexExtractor.java` |
| `substring` | `{ begin_index: int, end_index: int }` | `SubstringExtractor.java` |
| `copy_input` | `{}` (empty) | `CopyInputExtractor.java` |
| `json` | `{ list_separator?: string, key_separator?: string, kv_separator?: string, key_prefix?: string, key_whitespace_replacement?: string, replace_key_whitespace?: bool, flatten?: bool }` | `JsonExtractor.java` |
| `lookup_table` | `{ lookup_table_name: string }` | `LookupTableExtractor.java` |

⚠️ **Brief vs. Reality:** The CONTEXT.md `<additional_context>` lists "**6** named extractor types" (D-07), but Graylog 7.0.6 supports **8** types in `Extractor.Type` enum (`SUBSTRING, REGEX, REGEX_REPLACE, SPLIT_AND_INDEX, COPY_INPUT, GROK, JSON, LOOKUP_TABLE`). The requirement INPUT-09 enumerates "grok, regex, JSON, key-value, split-and-index, lookup-table" (6) — but "key-value" is not a Graylog extractor type; the closest match is `json` (with key-value flattening config) or the `regex` extractor with a key-value pattern. **Recommendation:** Plan 1's first task should clarify with the user — either expand D-07 to the full 8 Graylog types (recommended; cheap to add `substring` + `regex_replace` + `copy_input` since they're 1–3 field config shapes), OR keep 6 and explicitly mark `substring`, `regex_replace`, `copy_input` as out-of-scope. **Default:** ship all 8 with strict schemas — the marginal cost is ~30 LOC and the broader coverage makes the surface uniform.

`[ASSUMED]` — The "key-value" name in INPUT-09 most plausibly maps to the JSON extractor's key-value-flattening config. If the user intends a literal `key=value` parser (not a Graylog primitive), Phase 1 plan must surface this ambiguity. **A1 in Assumptions Log.**

### Example 6: Encrypted-Field Merge (the C3 algorithm)

`[CITED: source-code/.../EncryptedInputConfigs.java:44-53]`

```java
public static Map<String, Object> merge(Map<String, Object> orig, Map<String, Object> update) {
    final Map<String, Object> merged = new HashMap<>(orig);
    update.forEach((k, v) -> {
        if (orig.get(k) instanceof EncryptedValue origValue && v instanceof EncryptedValue newValue) {
            merged.put(k, mergeEncryptedValues(origValue, newValue));
        } else {
            merged.put(k, v);
        }
    });
    return merged;
}
```

**The contract on the wire:**
- Send `{"<encField>": {"keep_value": true}}` → Graylog keeps the original encrypted value.
- Send `{"<encField>": {"delete_value": true}}` → Graylog clears the value.
- Send `{"<encField>": "newSecret"}` (plain string) → Graylog deserializes as `{set_value: "newSecret"}` and encrypts it as the new value.
- Send `{"<encField>": {"is_set": true}}` (the GET response shape echoed back) → **trap** — Graylog's deserializer creates a fresh `EncryptedValue` and the merged result is non-deterministic. **Never do this.**
- Omit `<encField>` entirely from the PUT body's `configuration` → Graylog's merge logic preserves the original.

`[CITED: source-code/.../EncryptedValue.java:31-68]` — Documents the four serialization shapes.

## State of the Art

| Old Approach | Current Approach (this phase) | Why Changed |
|--------------|-------------------------------|-------------|
| v2.3 inline `if (name === "...")` dispatch in `src/index.js` | Dispatch Map + `register(name, handler)` (Phase 0) | Adding 12 more tools to the if-chain would push it past 130 branches |
| Hand-rolled `args.dryRun ?? true` per tool | `defineMutatingHandler` factory (Phase 0) | One missed check = silent destructive op |
| Full-config round-trip on `update_input` (CONCERNS-era v2.3 pattern) | Partial-update only with encrypted-field gate (this phase, D-03) | C3 pitfall — encrypted-field zeroing |
| Static input-type allowlist in code | Dynamic catalogue via `GET /system/inputs/types/all` cached per connection (D-06) | Plugin-added types unknowable at build time |

**Deprecated / outdated:**
- The `static` input-types map that some integrations use — Graylog 7.0+ exposes the dynamic catalogue, and any installed plugin adds to it.
- The bare `GET /api/streams` (not relevant to this phase, but flagged for Phase 7 HARD-05) is marked `@Deprecated` — `/paginated` is the new path. The same pattern exists for `GET /api/system/inputs` vs `/api/system/inputs/paginated`. **Phase 1 should use `/api/system/inputs` (non-paginated)** because we already have the `defineListHandler` projection + limit clamping — calling `/paginated` would require translating `page` / `per_page` semantics on top of our existing `limit`. **Defer paginated migration to a follow-up.** `[VERIFIED: source-code/.../InputsResource.java:358-368, 370-415]`

## Endpoint Catalogue (Graylog 7.0.6, verified against 7.2-source paths)

All paths confirmed via `@Path` annotation reading. Endpoint shapes are stable across the 7.x series for this domain — no breaking change between 7.0.6 and 7.2 that affects inputs/extractors (per `PITFALLS.md` and changelog audit, the input/extractor surface is one of the most stable). `[VERIFIED: source-code/.../InputsResource.java, InputStatesResource.java, ExtractorsResource.java, InputTypesResource.java]`

| # | Tool | Method | Path | Request Body | Response | Status |
|---|------|--------|------|--------------|----------|--------|
| 1 | `list_input_types` | GET | `/api/system/inputs/types/all` | none | `Map<typeFQCN, InputTypeInfo>` (see Example 1) | 200 |
| 2 | `list_inputs` | GET | `/api/system/inputs` | none | `InputsList { inputs: Set<InputSummary> }` — `InputSummary { id, title, name (display), type, configuration, global, node, created_at, creator_user_id, content_pack, static_fields }`. Note: `configuration` is **masked** for the caller via `maskPasswordsInConfiguration` — encrypted fields show as `<value hidden>`, password fields as `<password set>`. | 200 |
| 3 | `get_input` | GET | `/api/system/inputs/{inputId}` | none | `InputSummary` (same shape; same masking) | 200 / 404 |
| 4 | `create_input` | POST | `/api/system/inputs` | `InputCreateRequest { title, type, global: bool, configuration: Map, node?: string }`. Optional `?setup_wizard=false` query param. | `Response.created(uri).entity(InputCreated.create(newId))` → **201 + Location header + `{id: "..."}` body** | 201 / 400 / 404 |
| 5 | `update_input` | PUT | `/api/system/inputs/{inputId}` | Same `InputCreateRequest` shape | `Response.created(uri).entity(InputCreated.create(id))` → **201 + Location + `{id: "..."}`** (note: PUT returning 201 — Graylog's contract) | 201 / 400 / 404 |
| 6 | `delete_input` | DELETE | `/api/system/inputs/{inputId}` | none | 204 No Content; **server-side cascade**: removes extractors automatically via `inputService.destroy(input)` which cascades on the Mongo collection. **No response body to enumerate what was cascaded** — that's why Discretion-05 requires a pre-flight `GET /api/system/inputs/{inputId}/extractors` to enumerate for the dry-run. | 204 / 404 |
| 7 | `start_input` | PUT | `/api/system/inputstates/{inputId}` | none (request body ignored) | `InputCreated.create(inputId)` → `{id: "..."}` | 200 / 400 / 404 |
| 8 | `stop_input` | DELETE | `/api/system/inputstates/{inputId}` | none | `InputStopped.create(inputId)` → `{id: "..."}` | 200 / 400 / 404 |
| 9 | `list_extractors` | GET | `/api/system/inputs/{inputId}/extractors` | none | `ExtractorSummaryList { extractors: List<ExtractorSummary> }` | 200 / 404 |
| 10 | `create_extractor` | POST | `/api/system/inputs/{inputId}/extractors` | `CreateExtractorRequest` (see Example 5 envelope) | `Response.created(uri).entity(ExtractorCreated.create(id))` → **201 + Location + `{extractor_id: "..."}`** | 201 / 400 / 404 |
| 11 | `update_extractor` | PUT | `/api/system/inputs/{inputId}/extractors/{extractorId}` | Same `CreateExtractorRequest` shape | `ExtractorSummary` (full DTO; 200) | 200 / 400 / 404 |
| 12 | `delete_extractor` | DELETE | `/api/system/inputs/{inputId}/extractors/{extractorId}` | none | 204 No Content; **single-target, no cascade** (D-09) | 204 / 400 / 404 |

**Notes on idempotency (M4):**
- `POST /system/inputs`: Graylog allows duplicate titles. Two `create_input` calls with the same payload produce two distinct inputs with different IDs. The Phase 0 `findExistingMatches` stub returns `[]`; Phase 1 plans can wire a real implementation that queries `list_inputs` and matches on title + type. **Recommendation:** wire it in `create_input.build()` — one extra GET per dry-run.
- `POST /system/inputs/{id}/extractors`: Graylog allows duplicate extractor titles on the same input. Same `findExistingMatches` strategy applies. Wire on `list_extractors` (already a per-input list).
- `PUT /system/inputstates/{id}` (start): Idempotent at the **persisted desired state** layer — calling twice doesn't double-start. Phase 1 doesn't need to dedupe.
- `DELETE /system/inputs/{id}`: 404 on second delete. The wrapper's `GraylogNotFoundError` is the right surface.

**Notes on response shape inconsistencies (M2):**
- `create_input`: 201 + Location + `{id}` — handled by `toIdBody(raw, ["id"])`
- `update_input`: 201 + Location + `{id}` — same normalizer; same hint
- `create_extractor`: 201 + Location + `{extractor_id}` — `toIdBody(raw, ["extractor_id"])`
- `update_extractor`: **200** + full `ExtractorSummary` body — `toIdBody(raw, ["id"])` reads the `id` field
- `start_input` / `stop_input`: 200 + `{id}` — same normalizer
- `delete_input` / `delete_extractor`: 204 No Content — `apply()` callback returns the raw 204 (empty); the wrapper's normalize falls back to `{ id: undefined, body: undefined }` which is correct — the agent already knows the ID from the input arg.

## Snapshot Fixture Design (FOUND-07 extension)

Phase 0 shipped 10 fixtures; Phase 1 adds **5 input-specific fixtures** that prove the C3 mitigation and the lifecycle/cascade contracts. All use static-only args (no `Date.now`, no `randomUUID`, deterministic across machines).

| # | Fixture | What It Proves | Test File |
|---|---------|----------------|-----------|
| 1 | `create_input` GELF UDP dry-run (port 12201, default config, no encrypted fields) | C6 sentinel + happy path; idempotency key deterministic | `test/inputs.test.js` |
| 2 | `create_input` GELF TCP dry-run with `tls_enable: true` + `tls_key_password: "secret"` | **D-04: encrypted field redacted in preview** but present in the apply body (separately snapshotted via the capture-request seam, scrubbed of the literal secret string) | `test/inputs.test.js` |
| 3 | `update_input` partial dry-run, `changes: { configuration: { port: 12202 } }` against a fixture input carrying `tls_key_password` | **C3: encrypted field is ABSENT from the emitted body** even when the agent's diff doesn't mention it; only `port` is in the merged body | `test/inputs.test.js` |
| 4 | `delete_input` dry-run with 2 affected extractors enumerated in `cascades.extractors: [...]` | D-05: extractor enumeration in the warning block; pre-flight GET happens at preview time | `test/inputs.test.js` |
| 5 | `create_extractor` grok dry-run against a fixture input | D-07: extractor schema validation; C6 sentinel for `extractor_id` | `test/extractors.test.js` |

**Auth-redaction lint (Phase 0)** auto-scans any new `.snapshot` files for 32+ char alphanumeric strings and the `Authorization` header. Fixture 2's `tls_key_password` value MUST be a **short, non-token-like string** (`"secret"` not a 40-char random string) so it doesn't trigger the false-positive scanner, AND the snapshot MUST show the redacted form (`<redacted>` or `••••`), not the literal. **This is a hard acceptance gate.**

**Schema-parity enrichment** (per Phase 0 commented template — must uncomment in this phase):

```js
// In test/schema-parity.test.js, replace the commented template with:
import {
    CreateInputSchema, UpdateInputSchema, DeleteInputSchema, StartInputSchema,
    StopInputSchema, CreateExtractorSchema, UpdateExtractorSchema, DeleteExtractorSchema,
    ListInputsSchema, GetInputSchema, ListExtractorsSchema, ListInputTypesSchema,
} from "../src/tools/inputs/schemas.js";

async function assertSchemaParityForTool(toolName, zodSchema) { ... }

await assertSchemaParityForTool("create_input", CreateInputSchema);
await assertSchemaParityForTool("update_input", UpdateInputSchema);
// ... 12 total
```

Each `assertSchemaParityForTool` call confirms that the JSON-Schema entry in `src/tools.js` for that tool name has the same property keys as the zod schema's shape. Drift = test failure.

## Idempotency on Retries (FOUND-11 + M4)

`[VERIFIED: source-code/.../InputsResource.java:418-459]` + `[VERIFIED: source-code/.../ExtractorsResource.java:106-149]` — Neither create endpoint returns a clear duplicate error. Both happily create a second entity.

**Phase 1 mitigation:**
- `create_input.build()` runs a `findExistingMatches({ listPath: "/api/system/inputs", matchFn: (inp) => inp.title === args.title && inp.type === args.type })` and surfaces `existingMatches: [{id, title, similarity: "exact"}]` in the dry-run preview. The Phase 0 wrapper already supports `req.existingMatches` — `build()` just has to populate it.
- `create_extractor.build()` similarly checks per-input: `findExistingMatches({ listPath: "/api/system/inputs/{inputId}/extractors", matchFn: (e) => e.title === args.title && e.type === args.extractor_type })`.
- Idempotency key (Phase 0 deterministic sha-256) is `hash(connectionName, "create_input", canonicalArgs)`. If the agent retries with identical args, the key matches; the dry-run output's `idempotencyKey` is stable across retries — **but Graylog itself has no idempotency key**. The defense is the `existingMatches` array; the key is for agent-side dedupe.

`[ASSUMED]` — The `findExistingMatches` stub in `src/tools/_shared/conflict.js` returns `[]` today. Phase 1's first plan must replace it with a real implementation that takes `{ listPath, matchFn }` and runs a `client.request("GET", listPath, null)` lookup. **A2 in Assumptions Log.**

## 7.0.6-vs-7.2 Divergence Audit

| Concern | 7.2-source (clone) | 7.0.6 (live) — verify before "done" |
|---------|-------------------|--------------------------------------|
| `/system/inputs/types/all` response shape | `Map<String, InputTypeInfo>` with `is_encrypted` per field | **Should be identical** — the `AbstractConfigurationField.isEncrypted` field existed long before 7.0. Verify by running `GET /api/system/inputs/types/all` against `<graylog-host>` and asserting `is_encrypted` appears on `tls_key_password` for `org.graylog2.inputs.gelf.tcp.GELFTCPInput`. |
| `EncryptedInputConfigs.merge` semantics | `keep_value` / `delete_value` / `set_value` / `is_set` shapes | **Should be identical** — present since Graylog 5.x encrypted-config introduction. Smoke-verify with a `create_input` (TCP/TLS) + `update_input` (no-op `changes: {}`) round-trip; assert the input still starts. |
| `PUT /system/inputs/{id}` returns 201 | Confirmed | **Likely identical** but PUT-returns-201 is unusual; smoke-test. |
| `start_input` is PUT, `stop_input` is DELETE | Confirmed in 7.2-source | **Should be identical**; verify via `curl -X PUT` / `curl -X DELETE` against live. |
| `delete_input` cascades extractors | Confirmed via `inputService.destroy(input)` | **Identical** — Mongo-level cascade on the embedded document. |
| Input names in catalogue (e.g. `org.graylog2.inputs.gelf.udp.GELFUDPInput` FQCN) | These FQCNs are baked into class names | **Identical** across 7.x; Beats2Input vs deprecated Beats1Input may differ. Verify by listing all type keys against live and confirming GELF/Syslog/Beats2/Raw are present. |
| New input types added in 7.2 not in 7.0.6 | Unknown — possibly OpenTelemetry inputs added post-7.0 | **Live catalogue is authoritative.** D-06 cache handles this — whatever the live cluster reports is what `list_input_types` returns. |

**Plan recommendation:** First task of Plan 1 (or a "Wave 0" of Plan 1) runs a 5-call smoke script against `<graylog-host>` capturing:
1. `GET /api/system/inputs/types/all` → save the JSON, snapshot it.
2. `GET /api/system/inputs` → confirm `InputsList` shape.
3. `POST /api/system/inputs` GELF UDP create → confirm 201 + `{id}` body.
4. `PUT /api/system/inputstates/{id}` → confirm start.
5. `DELETE /api/system/inputs/{id}` → confirm 204 + extractors gone.

The captured catalogue JSON becomes a test fixture. The smoke script is one-shot, not committed; the **fixture** is committed.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` 22.22.2 (Node-builtin); `@types/node` ^22 for IDE support |
| Config file | `test/snapshot-config.js` (sets snapshot resolution path) |
| Quick run command | `node --test 'test/inputs.test.js' 'test/extractors.test.js' 'test/type-catalogue.test.js'` |
| Full suite command | `npm test` (runs `node --test 'test/**/*.test.js'`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| INPUT-01 | `list_input_types` returns parsed catalogue with `is_encrypted` per field | unit (capture-request seam) | `node --test test/inputs.test.js -- --test-name-pattern='list_input_types'` | ❌ Wave 0 |
| INPUT-01 | Type catalogue cached per connection — second call doesn't re-fetch | unit | `node --test test/type-catalogue.test.js` | ❌ Wave 0 |
| INPUT-02 | `list_inputs` narrow projection (id/title/description); `fields: "all"` returns full DTO | unit + snapshot | `node --test test/inputs.test.js` (fixtures 6-7) | ❌ Wave 0 |
| INPUT-03 | `get_input` returns full DTO with `<value hidden>` on encrypted fields (server masks) | unit | `node --test test/inputs.test.js -- --test-name-pattern='get_input'` | ❌ Wave 0 |
| INPUT-04 | `create_input` GELF UDP dry-run preview shape (fixture 1) | unit + snapshot | `node --test test/inputs.test.js` | ❌ Wave 0 |
| INPUT-04 | `create_input` GELF TCP encrypted-field redaction in preview (fixture 2) | unit + snapshot + auth-redaction | `node --test test/inputs.test.js test/auth-redaction.test.js` | ❌ Wave 0 |
| INPUT-04 | `create_input` zod rejection on missing `type` / `title` | unit | `node --test test/inputs.test.js -- --test-name-pattern='zod'` | ❌ Wave 0 |
| INPUT-05 | `update_input` partial-update preview emits ONLY changed fields, encrypted fields ABSENT (fixture 3) | unit + snapshot + C3 acceptance gate | `node --test test/inputs.test.js` | ❌ Wave 0 |
| INPUT-05 | `update_input` agent passes encrypted field explicitly → emits `{set_value: "..."}` envelope in apply body | unit (capture-request asserting wire shape) | `node --test test/inputs.test.js -- --test-name-pattern='update_input encrypted explicit'` | ❌ Wave 0 |
| INPUT-06 | `delete_input` dry-run enumerates affected extractors in `cascades.extractors` (fixture 4) | unit + snapshot | `node --test test/inputs.test.js` | ❌ Wave 0 |
| INPUT-07 | `start_input` issues `PUT /api/system/inputstates/{id}`; `stop_input` issues `DELETE /...`; both honor `dryRun: true` by default | unit (capture-request) | `node --test test/inputs.test.js -- --test-name-pattern='lifecycle'` | ❌ Wave 0 |
| INPUT-08 | `list_extractors` per-input narrow projection | unit + snapshot | `node --test test/extractors.test.js` | ❌ Wave 0 |
| INPUT-09 | `create_extractor` for each of 6 (or 8 — see §Example 5) types parses + emits correct `extractor_config` shape | unit (one test per type) | `node --test test/extractors.test.js -- --test-name-pattern='create_extractor'` | ❌ Wave 0 |
| INPUT-09 | `create_extractor` grok dry-run snapshot (fixture 5) | snapshot | `node --test test/extractors.test.js` | ❌ Wave 0 |
| INPUT-10 | `update_extractor` partial-update reuses pattern | unit | `node --test test/extractors.test.js -- --test-name-pattern='update_extractor'` | ❌ Wave 0 |
| INPUT-11 | `delete_extractor` single-target, no cascade — second call to a deleted extractor 404s | unit | `node --test test/extractors.test.js -- --test-name-pattern='delete_extractor'` | ❌ Wave 0 |
| D-07 (Phase 0) | Writable-flag short-circuit for every new mutating tool | unit (one per tool) | `node --test test/inputs.test.js -- --test-name-pattern='writable'` | ❌ Wave 0 |
| schema-parity | Every new tool's zod shape matches its `src/tools.js` JSON-Schema | unit | `node --test test/schema-parity.test.js` | ⚠️ exists, must be extended |

### Sampling Rate

- **Per task commit:** `node --test test/inputs.test.js test/extractors.test.js test/type-catalogue.test.js test/schema-parity.test.js` (≤5 s expected)
- **Per wave merge:** `npm test` (full suite — 153 + ~80 new tests = ~233; should still be ≤15 s)
- **Phase gate:** Full suite green before `/gsd-verify-work` runs; two consecutive `npm test` runs produce byte-identical snapshot md5sums for **all** `.snapshot` files including the new Phase 1 ones.

### Wave 0 Gaps

- [ ] `test/inputs.test.js` — covers INPUT-01..07 (handlers, snapshots, zod rejections, writable-flag, C3 mitigation)
- [ ] `test/extractors.test.js` — covers INPUT-08..11 (handlers, snapshots, all 6 or 8 extractor types)
- [ ] `test/type-catalogue.test.js` — covers D-06 cache contract (`_clearTypeCatalogueForTests` seam, single-fetch-then-cached, `getEncryptedFieldNamesForType` helper)
- [ ] `test/__snapshots__/inputs.test.js.snapshot` and `extractors.test.js.snapshot` — generated via `--test-update-snapshots` once handlers exist
- [ ] `test/schema-parity.test.js` enrichment — uncomment the template and add 12 `assertSchemaParityForTool` calls
- [ ] **Live-instance fixture capture (Wave 0):** One-shot script (not committed) that hits `<graylog-host>` and captures the type-catalogue JSON to `test/fixtures/type-catalogue-7.0.6.json`. The committed fixture file becomes the source of truth for type-catalogue tests.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All tooling | ✓ | 22.22.2 (≥ 22.3.0 required by Phase 0) | — |
| npm | Dep install | ✓ | 10.9.7 | — |
| `@modelcontextprotocol/sdk` | MCP framework | ✓ | 1.18.0 | — |
| `axios` | HTTP client | ✓ | 1.12.2 | — |
| `zod` | Validation | ✓ | ^3.25.76 | — |
| Live Graylog 7.0.6 at `<graylog-host>` | Smoke-verification of endpoints; live-fixture capture | **Unverified in this session** | (assumed 7.0.6 per PROJECT.md) | If unreachable: rely on 7.2-source for shapes; flag for plan-checker; Wave 0 smoke script becomes optional but documented |
| `~/.graylog-mcp/config.json` with `test` connection | Test the wrapper against the live instance | **Unverified in this session** | — | Use `_setConnectionsForTests` test seam + `_setCaptureRequest` to run all unit tests without network |

**Missing dependencies with fallback:** Live Graylog instance is **nice-to-have** for Wave 0 fixture capture, but every Phase 1 unit test can run without it via the Phase 0 capture-request seam. The seam was specifically designed for this (`[VERIFIED: src/graylog/client.js:20-27, 44-46]`).

**Missing dependencies with no fallback:** None.

## Sources

### Primary (HIGH confidence)

- `[VERIFIED]` `source-code/graylog2-server/.../rest/resources/system/inputs/InputsResource.java` — input CRUD endpoints, encrypted-config merge call site
- `[VERIFIED]` `source-code/graylog2-server/.../rest/resources/system/inputs/InputStatesResource.java` — `start_input` (PUT) / `stop_input` (DELETE) lifecycle
- `[VERIFIED]` `source-code/graylog2-server/.../rest/resources/system/inputs/ExtractorsResource.java` — extractor CRUD nested under input
- `[VERIFIED]` `source-code/graylog2-server/.../shared/rest/resources/system/inputs/InputTypesResource.java` — `/types/all` dynamic catalogue
- `[VERIFIED]` `source-code/graylog2-server/.../inputs/encryption/EncryptedInputConfigs.java` — the C3 merge logic
- `[VERIFIED]` `source-code/graylog2-server/.../security/encryption/EncryptedValue.java` — placeholder shape semantics
- `[VERIFIED]` `source-code/graylog2-server/.../plugin/inputs/Extractor.java` — 8 extractor types enum
- `[VERIFIED]` `source-code/graylog2-server/.../plugin/configuration/fields/AbstractConfigurationField.java` — `isEncrypted` attribute serialization
- `[VERIFIED]` `source-code/graylog2-server/.../plugin/inputs/transports/AbstractTcpTransport.java` — TLS field set + encrypted attributes
- `[VERIFIED]` `source-code/graylog2-server/.../plugin/inputs/transports/NettyTransport.java` — base transport fields
- `[VERIFIED]` `source-code/graylog2-server/.../inputs/gelf/udp/GELFUDPInput.java`, `Beats2Input.java`, syslog variants — input type FQCN inventory
- `[VERIFIED]` `src/tools/_shared/{handler,list,schemas,connection,idempotency,dry-run,conflict,errors}.js` — Phase 0 primitives, read directly
- `[VERIFIED]` `src/graylog/client.js` — `makeClient(conn).request(...)` surface and writable-flag refusal
- `[VERIFIED]` `test/schema-parity.test.js` — Phase 0 enrichment template to uncomment
- `[VERIFIED]` `.planning/phases/00-foundation/00-04-SUMMARY.md, 00-03-SUMMARY.md, 00-06-SUMMARY.md` — Phase 0 contracts and seam patterns
- `[VERIFIED]` `package.json` — version pins, Node engine, no new deps allowed

### Secondary (MEDIUM confidence)

- `[CITED]` `.planning/research/PITFALLS.md` §C3, §C6, §M2, §M4, §M5, §M6 — pitfall analysis from milestone research
- `[CITED]` `.planning/research/ARCHITECTURE.md` — module layout precedent, `defineMutatingHandler` design rationale
- `[CITED]` `.planning/research/FEATURES.md` — domain inventory, anti-features
- `[CITED]` `.planning/research/SUMMARY.md` — phase-order rationale, 7.0.6 retarget note

### Tertiary (LOW confidence — needs validation)

- `[ASSUMED]` 7.0.6 endpoint shapes are identical to 7.2-source for inputs/extractors. **Validation:** Wave 0 smoke script against `<graylog-host>` (5 calls listed in §7.0.6-vs-7.2 Divergence Audit).
- `[ASSUMED]` INPUT-09's "key-value" extractor name maps to Graylog's JSON extractor (the closest Graylog primitive). **Validation:** confirm with user during Plan 1 framing, or default to shipping all 8 of Graylog's extractor types (A1).
- `[ASSUMED]` `findExistingMatches` will be wired with a real `{ listPath, matchFn }` implementation in Phase 1's first plan (Phase 0 left it as a stub returning `[]`). **Validation:** Plan 1 plan-checker (A2).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | "key-value" in INPUT-09 maps to Graylog's `json` extractor (or is shorthand for an undocumented Graylog primitive). Defaulting to shipping all 8 of Graylog's actual extractor types. | §Extractor JSON Shapes | If user intended a Graylog primitive that doesn't exist (no literal "key-value" type), agent will see a confusingly-named tool. Surface during Plan 1 framing — cheap to rename. |
| A2 | Phase 1's first plan replaces the `findExistingMatches` Phase 0 stub with a real `{listPath, matchFn}` implementation. | §Idempotency on Retries | If left as stub, `existingMatches` is always `[]` and M4 / M5 mitigations don't fire. Plan-checker should require explicit handling. |
| A3 | The 7.0.6 type catalogue contains the FQCN keys we expect (`org.graylog2.inputs.gelf.udp.GELFUDPInput`, etc.). | §State of the Art / §Endpoint Catalogue | If a Graylog plugin renamed an input class, the GELF/Beats/Syslog/Raw strict schemas (D-01) won't match. Wave 0 smoke script catches this. |
| A4 | Async `build()` callbacks are acceptable in `defineMutatingHandler` — `update_input` needs `await client.request("GET", ...)` inside `build()` to read current state. Phase 0's `handler.js:104` is sync today; either it becomes async (1-line change) or pre-flight moves outside `build()`. | §Pattern: Partial-update for update_input | If neither option lands, `update_input` cannot be a single `defineMutatingHandler` call. Plan 1's first task must address. |
| A5 | The discretionary redaction placeholder (Discretion-03) of `<redacted>` (or similar short literal) won't be flagged as a leak by `auth-redaction.test.js`. Auth-redaction regex is for 32+ char alphanumeric and `Authorization` header — `<redacted>` doesn't match. | §Snapshot Fixture Design | Low risk; if it does match, change placeholder or add a context-aware allowlist. |
| A6 | Graylog 7.0.6 supports the same `EncryptedValue` placeholder shapes (`set_value`, `keep_value`, `delete_value`) as 7.2. | §Encrypted-Field Merge | If 7.0.6 only supports a subset, the update mitigation needs version-specific branching. Smoke test in Wave 0 catches this (PUT with `{keep_value: true}` and confirm next start works). |

## Open Questions

1. **GELF Beats variant: Beats2 vs original Beats — which target class FQCN?**
   - What we know: `Beats2Input` is the modern netty-based class; `BeatsInput` is the deprecated pre-netty class.
   - What's unclear: Whether Graylog 7.0.6 still registers the deprecated `BeatsInput` (it does in 7.2-source).
   - Recommendation: Default GELF Beats schema to `org.graylog.plugins.beats.Beats2Input` FQCN. If the live catalogue surfaces both, expose both via the generic schema and let the agent pick.

2. **Discretion-02: Discriminated union vs. per-family-schema approach?**
   - What we know: Each of GELF/Syslog/Raw has 4–5 transport variants (UDP/TCP/HTTP/Kafka/AMQP), and each is a distinct Graylog `type` FQCN.
   - What's unclear: Whether one big discriminated union per family is cleaner than four separate schemas (`CreateGelfUdpSchema`, `CreateGelfTcpSchema`, etc.).
   - Recommendation: Per-variant schema (4 variants × 4 families = 16 explicit schemas), all wrapped in a single `CreateInputSchema = z.union([...16, GenericConfigSchema])`. Zod's `z.discriminatedUnion("type", [...])` is the right primitive — discriminates on the FQCN string, and the agent's MCP tool sees one schema with clear options.

3. **Should `list_inputs` default to narrow projection (id, title, description) or include `type` + `global` by default?**
   - What we know: Phase 0's `DEFAULT_FIELDS = ["id", "title", "description"]` is the universal default.
   - What's unclear: For inputs, `type` is more useful than `description` (description often empty). Override with a domain-local default?
   - Recommendation: Override. `list_inputs` default projection = `["id", "title", "type", "global"]`. Document the override in the tool description. The `fields: "all"` opt-in still works.

4. **Does Graylog 7.0.6 include the `node` field as required on a non-global input?**
   - What we know: 7.2-source `InputCreateRequest.node()` is `@Nullable`. For global inputs (`global: true`), `node` is irrelevant.
   - What's unclear: For non-global inputs on a single-node Graylog (the test instance is one node), does Graylog auto-fill or 400?
   - Recommendation: Default `global: true` in the zod schema (single-node test environments and most agent use-cases want this). For multi-node clusters, the agent can pass `global: false, node: "<node-id>"` explicitly. Document.

## Metadata

**Confidence breakdown:**
- Endpoint catalogue: HIGH — every path/verb/body shape read directly from Java `@Path`/`@POST`/etc. annotations
- Encrypted-field merge mechanics: HIGH — source-traced from `InputsResource.update` through `EncryptedInputConfigs.merge` to `EncryptedValue` placeholder shapes
- GELF/Beats/Syslog/Raw schemas (D-01): MEDIUM — field names and `is_encrypted` flags verified via the relevant Java config classes, but exact catalogue JSON shape against 7.0.6 not yet captured (deferred to Wave 0 smoke)
- Extractor JSON shapes (D-07): HIGH for the 8 actual Graylog extractor types; MEDIUM on the INPUT-09 "key-value" naming ambiguity (A1)
- Type catalogue cache (D-06): HIGH — established Phase 0 underscore-seam pattern
- Snapshot fixture design: HIGH — Phase 0 contract proves the pattern; the 5 fixtures listed are the minimal acceptance set
- 7.0.6 vs 7.2 divergence: MEDIUM — based on changelog audit (PITFALLS.md), no breaking changes flagged for inputs/extractors between 7.0 and 7.2, but Wave 0 smoke test is the authoritative verification

**Research date:** 2026-05-15
**Valid until:** 2026-06-15 (30 days for stable Graylog API surface; the 7.0.6 live instance is the bound — if it upgrades to 7.x.y, re-verify against the new version)

---

*Phase: 01-inputs-extractors*
*Researched: 2026-05-15*
