# Phase 10: Entity Sharing Write Path — Pattern Map

**Mapped:** 2026-05-20
**Files analyzed:** 9 (1 new handler, 5 modified, 2 new tests, 1 new fixture optional)
**Analogs found:** 9 / 9

Phase 10 is **composition over invention**: every primitive (`defineMutatingHandler`, `computeShareGrantHash`, `fetchEntitySharePreview`, `resolveEntityGrn`, `Capability` enum, `mutatingBase`, the read-handler envelope, the GET-merge-POST acceptance gate, the fixture-replay test seam) is already shipped by v3.0.0 / Phase 8 / Phase 9. The new code is the merge step, the diff, the last-own guard, the 400-with-body parser, and the file that composes them.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/tools/authz/share-entity.js` (NEW) | mutating tool handler | read-merge-write (POST + 400-body inspection) | `src/tools/pipelines/connect-pipelines-to-stream.js` + `src/tools/index-sets/delete-index-set.js` | exact (compose both) |
| `src/tools/authz/schemas.js` (MODIFIED — append ShareEntitySchema) | zod schema | input validation with XOR refines | `src/tools/index-sets/schemas.js` (`DeleteIndexSetSchema`) + `src/tools/authz/schemas.js` (`GetEntitySharesSchema` for the XOR `.refine`) | exact |
| `src/tools/authz/index.js` (MODIFIED — add 3rd `register()`) | dispatch barrel | side-effect import + register | `src/tools/authz/index.js` (current Phase 9 shape) | self-precedent |
| `src/tools.js` (MODIFIED — append `share_entity` definition) | tool catalogue | static JSON schema description | `src/tools.js` lines 1916-1940 (`get_entity_shares` / `list_grantees`) | exact |
| `src/tools/meta/list-admin-tools.js` (MODIFIED — `DOMAIN_OVERRIDES`) | domain inference table | static map | lines 63-66 (`get_entity_shares` / `list_grantees` → `authz`) | exact |
| `test/authz-share-entity.test.js` (NEW) | offline fixture-replay tests | unit test via `_setCaptureRequest` seam | `test/authz-entity-shares.test.js` (Phase 9 pattern) + `test/pipelines.test.js` Pitfall-2 acceptance gate (lines 2076-2099) | exact (compose both) |
| `test/authz-share-entity-live.smoke.js` (NEW) | opt-in live UAT (dryRun only) | network probe excluded from `npm test` | `test/authz-entity-shares-live.smoke.js` (Phase 9) | exact |
| `test/list-admin-tools.test.js`, `test/pipelines.test.js`, `test/dashboards.test.js` (MODIFIED) | tool-count assertion | constant bump 93 → 94 | existing assertions at those lines | self-precedent |
| `test/fixtures/authz/commit-response-7.0.6.json` (NEW, optional) | captured live response | static JSON fixture | `test/fixtures/authz/prepare-response-7.0.6.json` (Phase 8) | exact |

## Pattern Assignments

### `src/tools/authz/share-entity.js` (NEW — mutating handler)

**Primary analog:** `src/tools/pipelines/connect-pipelines-to-stream.js` (lines 40-92).
**Secondary analog:** `src/tools/index-sets/delete-index-set.js` (lines 58-220) for `_confirmationToken` + `requireConfirm` precedent.

**Imports pattern** (mirror of pipelines + authz precedents):
```javascript
// Compose: connect-pipelines-to-stream.js:36-38 + get-entity-shares.js:19-28
import { defineMutatingHandler } from "../_shared/handler.js";
import { ShareEntitySchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { resolveEntityGrn } from "./grn-helpers.js";
import { fetchEntitySharePreview } from "./prepare-share.js";
import { computeShareGrantHash } from "../_shared/cascade-hash.js";
```

**Handler skeleton pattern** (mirror of `connect-pipelines-to-stream.js:40-92` for read-merge-POST shape, `delete-index-set.js:58-220` for `requireConfirm` + `_confirmationToken`):
```javascript
export const handleShareEntity = defineMutatingHandler({
    name: "share_entity",
    schema: ShareEntitySchema,
    async build(args) {                                      // build is async — see handler.js:128
        const client = makeClient(args._conn);

        // 1. Normalize entity GRN — rejects grantee-type GRNs via SHAREABLE_TYPES guard
        //    Direct precedent: src/tools/authz/get-entity-shares.js:55-60
        const entityGrn = resolveEntityGrn(args);

        // 2. Pre-flight /prepare — Phase 9 helper (one round-trip, three jobs:
        //    active_shares, available_grantees, validation_result/dependencies)
        //    Direct precedent: src/tools/authz/get-entity-shares.js:67
        const preview = await fetchEntitySharePreview(client, entityGrn);

        // 3. Resolve grantee (username → user-GRN via available_grantees[].title; or pass-through granteeGrn)
        const granteeGrn = args.granteeGrn
            ?? resolveGranteeFromTitle(preview.available_grantees, args.granteeUsername);

        // 4. Merge — Map<granteeGrn, capability>; revoke = delete-the-key
        //    Direct precedent for the merge shape: connect-pipelines-to-stream.js:67-79
        //    Direct precedent for the subtract shape: disconnect-pipelines-from-stream.js:54-65
        const mergedMap = mergeGrants({
            current: preview.active_shares,
            granteeGrn,
            capability: args.capability,
            revoke: args.revoke ?? false,
        });

        // 5. Client-side last-own guard — refuses before commit if merged set would
        //    drop the last `own` grant (Pitfall 5; backstopped server-side at apply)
        assertOwnPreserved(preview.active_shares, mergedMap);

        // 6. Token over the merged set — byte-pinned canonical form (Phase 8)
        //    Direct precedent: delete-index-set.js:148-153 (build() computes hash, stashes on req)
        const mergedAsArray = [...mergedMap.entries()]
            .map(([grantee, capability]) => ({ grantee, capability }));
        const confirmationToken = computeShareGrantHash({ entityGrn, grants: mergedAsArray });

        // 7. Diff for the preview envelope (added/changed/unchanged/removed)
        const diff = computeDiff(preview.active_shares, mergedMap, args.revoke);

        return {
            method: "POST",
            path: `/api/authz/shares/entities/${encodeURIComponent(entityGrn)}`,
            body: {
                selected_grantee_capabilities: Object.fromEntries(mergedMap),
                selected_collections: [],
            },
            _confirmationToken: confirmationToken,           // handler.js:161 emits as confirmationToken
            existingMatches: diff.unchanged.concat(diff.changed),  // handler.js:155
            postApplyEstimate: { id: entityGrn, synced_entities: preview.synced_entities ?? [] },
            _previewExtras: {                                 // optional — surface in preview if planner approves
                diff,
                validation_result: preview.validation_result,
                missing_permissions_on_dependencies: preview.missing_permissions_on_dependencies,
                synced_entities: preview.synced_entities,
            },
        };
    },
    apply: async (client, req) => {
        // 400-with-body parser — Pitfall 1 above + delete-index-set.js error-classification precedent
        try {
            return await client.request(req.method, req.path, req.body);
        } catch (err) {
            if (err?.isGraylogError && err.status === 400
                && err.body?.validation_result?.failed === true) {
                return {
                    isError: true,
                    reason: "share_validation_failed",
                    content: [{ type: "text", text: JSON.stringify({
                        tool: "share_entity",
                        status: 400,
                        validation_result: err.body.validation_result,
                        missing_permissions_on_dependencies: err.body.missing_permissions_on_dependencies ?? {},
                        active_shares: err.body.active_shares ?? [],
                    })}],
                };
            }
            if (err?.isGraylogError && err.status === 403) {
                err.reason = "not_entity_owner";   // Pitfall 6 — surface ownership-specific hint
            }
            throw err;
        }
    },
    summarize: (args) =>
        args.revoke
            ? `Revoke ${args.granteeUsername ?? args.granteeGrn} from ${args.entityType ?? args.entityGrn}`
            : `Grant ${args.capability} to ${args.granteeUsername ?? args.granteeGrn} on ${args.entityType ?? args.entityGrn}`,
    requireConfirm: ({ req }) => req._confirmationToken ?? null,   // delete-index-set.js:219 verbatim
});
```

**Why the `connect-pipelines-to-stream.js` analog is the *exact* shape:**

From `src/tools/pipelines/connect-pipelines-to-stream.js:43-89` (the load-bearing GET-merge-POST):
```javascript
async build(args) {
    const client = makeClient(args._conn);
    const getPath = `/api/system/pipelines/connections/${args.streamId}`;

    let current;
    try {
        current = await client.request("GET", getPath, null);
    } catch (err) {
        if (err?.isGraylogError && err.status === 404) {
            current = { stream_id: args.streamId, pipeline_ids: [] };
        } else { throw err; }
    }

    const currentArray = Array.isArray(current?.pipeline_ids) ? current.pipeline_ids : [];
    const currentSet = new Set(currentArray);

    // Pitfall 2 ACCEPTANCE GATE — the load-bearing lines of this handler.
    const existingMatches = [];
    for (const id of args.pipelineIds) {
        if (currentSet.has(id)) {
            existingMatches.push({ id, similarity_reason: "already_connected" });
        }
        currentSet.add(id);
    }
    const merged = [...currentSet].sort();

    return {
        method: "POST",
        path: "/api/system/pipelines/connections/to_stream",
        body: { stream_id: args.streamId, pipeline_ids: merged },
        existingMatches,
        postApplyEstimate: { stream_id: args.streamId, pipeline_ids: merged },
    };
},
apply: (client, req) => client.request(req.method, req.path, req.body),
```

**Adaptation for Phase 10:** swap `GET /connections/{id}` → `fetchEntitySharePreview(client, entityGrn)`; swap `Set<pipelineId>` → `Map<granteeGrn, capability>`; add `revoke: true` branch (delete key) mirroring `src/tools/pipelines/disconnect-pipelines-from-stream.js:54-65`:
```javascript
const existingMatches = [];
for (const id of args.pipelineIds) {
    if (!currentSet.has(id)) {
        existingMatches.push({ id, similarity_reason: "not_currently_connected" });
    } else {
        currentSet.delete(id);
    }
}
```

**Why the `delete-index-set.js` analog supplies the confirmation pattern** (lines 146-189, 219):
```javascript
const confirmationToken = computeC1Hash({ indexSetId, deleteIndices: true, indexNames, messageCount });
return {
    method: "DELETE",
    path: `${indexSetPath}?delete_indices=true`,
    cascades: { indices: [...indexNames].sort(), messageCount, indexCount: indexNames.length },
    postApplyEstimate: { id: args.indexSetId, async: true, ... },
    _confirmationToken: confirmationToken,   // <-- handler.js step 6b reads this
    _indexSetId: args.indexSetId,
};
// ... and at the bottom of the spec:
requireConfirm: ({ req }) => req._confirmationToken ?? null,
```

`share-entity.js` uses the identical `_confirmationToken` + `requireConfirm` shape; the only deltas are the hash source (`computeShareGrantHash` vs `computeC1Hash`) and the method (`POST` vs `DELETE`).

---

### `src/tools/authz/schemas.js` (MODIFIED — append `ShareEntitySchema`)

**Primary analog (mutating-tool schema with `confirm` + extra-strict `.refine`):**
- `src/tools/index-sets/schemas.js:265-269` for the `mutatingBase.extend({...})` + `confirm` field pattern
- `src/tools/authz/schemas.js:40-53` (current `GetEntitySharesSchema`) for the entityGrn-XOR-(entityType,entityId) `.refine`

**The `mutatingBase` base** (`src/tools/_shared/schemas.js:12-16`):
```javascript
export const mutatingBase = z.object({
    dryRun: z.boolean().default(true),
    connectionName: z.string().optional(),
    idempotencyKey: z.string().optional(),
});
```

**Pattern for `ShareEntitySchema`** (compose `DeleteIndexSetSchema` + `GetEntitySharesSchema` shapes):
```javascript
// Capability enum already exists at schemas.js:17 — REUSE, do not redefine
// ENTITY_TYPES is the private z.enum at schemas.js:29 — REUSE

export const ShareEntitySchema = mutatingBase.extend({
    // Entity reference — exactly one of (entityGrn) XOR (entityType + entityId)
    entityGrn: z.string().optional(),
    entityType: ENTITY_TYPES.optional(),
    entityId: z.string().min(1).optional(),
    // Grantee — exactly one of (granteeGrn) XOR (granteeUsername) [also see Pitfall 2 open question]
    granteeGrn: z.string().optional(),
    granteeUsername: z.string().min(1).optional(),
    // The capability to grant; absent when revoke:true
    capability: Capability.optional(),                       // schemas.js:17
    // Revoke flag — when true, capability must be absent and merge = current MINUS grantee
    revoke: z.boolean().optional().default(false),
    // Echo-the-token field — same shape as DeleteIndexSetSchema:268
    confirm: z.string().optional(),
})
    .refine(
        (a) => Boolean(a.entityGrn) !== Boolean(a.entityType && a.entityId),
        { message: "Provide either entityGrn, or both entityType and entityId (not both, not neither)." },
    )
    .refine(
        (a) => Boolean(a.granteeGrn) !== Boolean(a.granteeUsername),
        { message: "Provide either granteeGrn or granteeUsername (not both, not neither)." },
    )
    .refine(
        (a) => (a.revoke === true) ? (a.capability === undefined) : (a.capability !== undefined),
        { message: "capability is required when revoke is false (default), and must be absent when revoke is true." },
    );
```

**`Capability` enum line-pinned reference** (`src/tools/authz/schemas.js:17`):
```javascript
export const Capability = z.enum(["view", "manage", "own"]);
```

**`ENTITY_TYPES` enum reference** (`src/tools/authz/schemas.js:29`):
```javascript
const ENTITY_TYPES = z.enum(["stream", "dashboard", "search"]);
```
*Note: `ENTITY_TYPES` is currently file-private. The planner should decide whether to export it for `ShareEntitySchema` reuse, or copy the literal `z.enum([...])`. Exporting is cleaner; copying preserves the existing internal API surface. Recommendation: export it.*

---

### `src/tools/authz/index.js` (MODIFIED — add `register("share_entity", handleShareEntity)`)

**Self-precedent** (the current Phase 9 file shape — `src/tools/authz/index.js:14-20`):
```javascript
import { register } from "../../dispatch.js";

import { handleGetEntityShares } from "./get-entity-shares.js";
import { handleListGrantees } from "./list-grantees.js";

register("get_entity_shares", handleGetEntityShares);
register("list_grantees", handleListGrantees);
```

**Phase 10 edit** (append one import + one register call, before the comment about Phase 11 if any):
```javascript
import { handleShareEntity } from "./share-entity.js";
register("share_entity", handleShareEntity);
```

---

### `src/tools.js` (MODIFIED — append `share_entity` tool definition)

**Direct precedent** (`src/tools.js:1916-1940` for `get_entity_shares` / `list_grantees`):
```javascript
{
    name: "get_entity_shares",
    description: "Read an entity's grants (active_shares) plus shareable grantees/capabilities. Non-mutating. Accepts entityGrn OR (entityType,entityId). Note: active_shares excludes your own grant; empty is normal.",
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
```

**Phase 10 entry** (append after `list_grantees`, before `list_admin_tools`):
```javascript
{
    name: "share_entity",
    description: "Share, change, or revoke a user's access to a stream/dashboard/search (view/manage/own). Defaults dryRun:true; agent must echo the confirmation token to apply. Use revoke:true to remove.",   // ~179 chars; verify ≤200 — Pitfall 7
    inputSchema: {
        type: "object",
        properties: {
            connectionName: { type: "string" },
            dryRun: { type: "boolean", description: "Defaults true. Set false to apply." },
            idempotencyKey: { type: "string" },
            entityGrn: { type: "string", description: "Full GRN. Either this OR entityType+entityId." },
            entityType: { type: "string", enum: ["stream", "dashboard", "search"] },
            entityId: { type: "string" },
            granteeGrn: { type: "string", description: "Full user-GRN. Either this OR granteeUsername." },
            granteeUsername: { type: "string", description: "Username/title resolved via available_grantees from /prepare." },
            capability: { type: "string", enum: ["view", "manage", "own"], description: "Required unless revoke:true." },
            revoke: { type: "boolean", description: "Defaults false. When true, removes the grantee's grant." },
            confirm: { type: "string", description: "Echo the dry-run confirmationToken to apply." },
        },
    },
},
```

*Description budget audit (Pitfall 7 / 09 precedent): the proposed string above is 179 chars — within the 200-char `DESCRIPTION_BUDGET` in `scripts/audit-tool-descriptions.js`. The planner must recount after any wording change.*

---

### `src/tools/meta/list-admin-tools.js` (MODIFIED — `DOMAIN_OVERRIDES` add)

**Direct precedent** (lines 63-66 — the Phase 9 authz entry):
```javascript
// ----- authz (Phase 9 entity-shares read path; the names have no
//       domain-named segment so segment inference cannot classify them) -----
get_entity_shares: "authz",
list_grantees: "authz",
```

**Phase 10 edit:** append one line under the `authz` block:
```javascript
share_entity: "authz",
```

---

### `test/authz-share-entity.test.js` (NEW — offline fixture-replay)

**Primary analog:** `test/authz-entity-shares.test.js` (Phase 9 fixture-replay test pattern).
**Critical secondary analog:** `test/pipelines.test.js` lines 2076-2099 (the Pitfall-2 acceptance gate — the mandatory test for read-merge-write correctness).

**Imports + setup pattern** (mirror of `test/authz-entity-shares.test.js:18-52`):
```javascript
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
    _setCaptureRequest,
    _clearCaptureRequest,
} from "../src/graylog/client.js";
import {
    _clearConnectionsForTests,
    setActiveConnection,
} from "../src/config.js";
import { GraylogValidationError } from "../src/graylog/errors.js";

import { handleShareEntity } from "../src/tools/authz/share-entity.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "authz");
const PREPARE_FIXTURE = JSON.parse(
    readFileSync(join(FIXTURE_DIR, "prepare-response-7.0.6.json"), "utf8"),
);

beforeEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
});

afterEach(() => {
    // Mandatory: a leftover capture seam silently disables HTTP in later test files.
    _clearCaptureRequest();
    _clearConnectionsForTests();
    setActiveConnection(null);
});
```

**MANDATORY Pitfall-1 acceptance gate** (verbatim shape from `test/pipelines.test.js:2076-2099`, adapted):
```javascript
test("share_entity PITFALL 1 ACCEPTANCE GATE: current=[A,B], add C → body contains A,B,C (not just C)", async () => {
    // The load-bearing test of this phase. A naive REPLACE-semantics call would
    // produce selected_grantee_capabilities === {C: view} (silently revoking A and B).
    // Read-merge-POST MUST produce {A: view, B: manage, C: view}.
    const fixture = {
        ...PREPARE_FIXTURE,
        active_shares: [
            { grant: "g1", grantee: "grn::::user:a", capability: "view" },
            { grant: "g2", grantee: "grn::::user:b", capability: "manage" },
        ],
        available_grantees: [
            ...PREPARE_FIXTURE.available_grantees,
            { id: "grn::::user:c", type: "user", title: "userC" },
        ],
    };

    _setCaptureRequest(() => fixture);

    const dryRun = await handleShareEntity({ params: { arguments: {
        _testConnection: "fake",
        entityType: "stream", entityId: "s1",
        granteeUsername: "userC", capability: "view",
        dryRun: true,
    }}});

    const payload = JSON.parse(dryRun.content[0].text);
    const grantees = Object.keys(payload.preview.body.selected_grantee_capabilities).sort();
    // Pitfall 1 GATE — body MUST contain A + B + C, not just [C]
    assert.deepEqual(grantees, ["grn::::user:a","grn::::user:b","grn::::user:c"]);
    assert.notDeepStrictEqual(grantees, ["grn::::user:c"]);
});
```

**Per-entity-type matrix pattern** (verbatim from `test/authz-entity-shares.test.js:116-138`):
```javascript
for (const type of ["stream", "dashboard", "search"]) {
    test(`share_entity encodes a ${type} GRN into the request path`, async () => {
        let captured = null;
        _setCaptureRequest((req) => {
            captured = req;
            return PREPARE_FIXTURE;  // first call = /prepare; apply uses the same seam
        });
        // ... handler invocation ...
        const expectedGrn = encodeURIComponent(`grn::::${type}:abc123`);
        assert.ok(captured.path.includes(expectedGrn));
    });
}
```

**400-with-body apply-time test pattern** (raise `GraylogValidationError` from the seam):
```javascript
test("share_entity 400-with-body surfaces structured validation_result error", async () => {
    let callCount = 0;
    _setCaptureRequest((req) => {
        callCount += 1;
        if (callCount === 1) return PREPARE_FIXTURE;     // /prepare
        // 2nd call = apply — raise a GraylogValidationError with the validation body
        const err = new GraylogValidationError("...", { status: 400, method: "POST", path: req.path });
        err.body = { validation_result: { failed: true, errors: { owner: ["Removing owners..."] } } };
        throw err;
    });
    // dryRun:true first to get the token, then dryRun:false to trigger apply
    // ... assert res.isError === true && res.reason === "share_validation_failed" ...
});
```

**Drift refusal test pattern** (the key TOCTOU test — fixture returns A,B then A,B,D):
```javascript
test("share_entity refuses with confirmation_mismatch when active_shares drifted between dry-run and apply", async () => {
    let preCall = 0;
    _setCaptureRequest((req) => {
        preCall += 1;
        if (preCall === 1) {
            return { ...PREPARE_FIXTURE, active_shares: [
                { grant: "g1", grantee: "grn::::user:a", capability: "view" },
                { grant: "g2", grantee: "grn::::user:b", capability: "manage" },
            ]};
        }
        // apply-time re-prepare: now D appeared
        return { ...PREPARE_FIXTURE, active_shares: [
            { grant: "g1", grantee: "grn::::user:a", capability: "view" },
            { grant: "g2", grantee: "grn::::user:b", capability: "manage" },
            { grant: "g3", grantee: "grn::::user:d", capability: "view" },
        ]};
    });
    // 1) dryRun:true → token1
    // 2) dryRun:false with confirm:token1 → recompute over A,B,C,D → token2 ≠ token1 → confirmation_mismatch
    // (the wrapper enforces this at handler.js:211-225)
});
```

---

### `test/authz-share-entity-live.smoke.js` (NEW — opt-in live UAT)

**Direct precedent:** `test/authz-entity-shares-live.smoke.js` (Phase 9, lines 1-72 for the header + harness).

**Key shape elements** (verbatim from the Phase 9 file):
```javascript
#!/usr/bin/env node
// Phase 10 Plan 10-0X — LIVE, DRY-RUN-ONLY smoke check for share_entity
// against the real UNESCO-production Graylog 7.0.6 `test` instance.
//
// This file is DELIBERATELY named `*.smoke.js` (not `*.test.js`) so it is
// EXCLUDED from `npm test` — the suite glob is `test/**/*.test.js`.
//
// SAFETY (Pitfall 8 — live production):
//   - dryRun:true ONLY. The apply endpoint POST .../entities/{GRN} (no /prepare)
//     is exercised by build() inside the wrapper, but the wrapper's dryRun:true
//     branch returns at handler.js:135 BEFORE apply() runs.
//   - No grant is ever written. The probe verifies the read-merge-token pipeline
//     against a throwaway/test target entity.
//   - Throwaway entity setup: create a disposable stream → run share_entity
//     dryRun:true → delete the stream. Or document a manual setup step.
//
// HTTP discipline: discovery calls go through `makeClient(conn).request(...)`
// — no raw HTTP-client import.
```

The structural template stays identical; only the handler under test (`handleShareEntity`) and the assertion target (the preview envelope) change.

---

### Tool-count assertions (MODIFIED — 93 → 94 in 3 files)

**Locations to bump** (grep-verified):
- `test/list-admin-tools.test.js:48` — `"...returns all 93 tools..."` → `94`
- `test/list-admin-tools.test.js:55` — `payload.count, 93, "expected 93 tools..."` → `94`
- `test/list-admin-tools.test.js:143` — `payload.count, 93` → `94`
- `test/pipelines.test.js:396` — test name `"...count = 93..."` → `94`
- `test/pipelines.test.js:427-428` — comment + `toolDefinitions.length, 93,` → `94`
- `test/dashboards.test.js:1733` — comment → mention `share_entity`
- `test/dashboards.test.js:1737` — test name → `94`
- `test/dashboards.test.js:1743` — `toolDefinitions.length, 93,` → `94`

The message strings should be updated to mention `share_entity` (mirror of the Phase 9 update that added `get_entity_shares + list_grantees`).

---

## Shared Patterns

### Mutating-handler factory (the canonical safety stack)

**Source:** `src/tools/_shared/handler.js` lines 58-258
**Apply to:** `src/tools/authz/share-entity.js`

The factory enforces, in order — *do not reorder, do not bypass*:
1. zod parse (with `_testConnection` seam strip + re-merge — line 71)
2. `resolveConnection` (line 91)
3. `conn.writable === false` short-circuit → `reason: "connection_read_only"` (lines 97-106)
4. Idempotency key auto-derivation (lines 110-111)
5. `await build({...args, _connectionName, _conn})` — async build supported (lines 126-131)
6. Dry-run branch — emits `confirmationToken` from `req._confirmationToken` (line 161)
6b. `requireConfirm` gate — `args.confirm === req._confirmationToken` or refuse with `reason: "confirmation_mismatch"` (lines 211-225)
7. `apply(client, req)` — passes through `raw.isError === true` envelopes (line 236) so the 400-with-body parser can return a structured error from inside apply

**Critical line for Phase 10's drift refusal:** `build()` runs at step 5 *unconditionally*, BEFORE the `if (dryRun)` branch at step 6. This is what makes the apply path re-fetch `active_shares` and re-compute the token — Assumption A8 in the research, source-verified.

### sha-256 confirmation token (byte-pinned, single-sourced)

**Source:** `src/tools/_shared/cascade-hash.js:303-339` (`computeShareGrantHash`)
**Apply to:** `share-entity.js` build()

Verbatim function signature:
```javascript
export function computeShareGrantHash({ entityGrn, grants }) { ... }
//                                              ^^^^^^
//   grants: Array<{grantee: string, capability: string}>
//   sorted by grantee internally; extra keys dropped
//   canonical: JSON.stringify({ entityGrn, grants: [...sorted] })
//   returns: 64-char lowercase hex sha-256
```

Byte-pin verification (`test/cascade-hash.test.js:455-477`):
```javascript
// Frozen fixture — drift here breaks drift-refusal in Phase 10.
hash === "3a410b0a3f88d967b1586a6193248baa6652a2ab5beef16f6b785e125872ca41"
// for: entityGrn="grn::::stream:000000000001",
//      grants=[{grantee:"b",capability:"view"},{grantee:"a",capability:"own"}]
```

### GRN normalization (shareable-type guard)

**Source:** `src/tools/authz/grn-helpers.js:156-175` (`resolveEntityGrn`)
**Apply to:** all authz handlers including `share-entity.js`

```javascript
export function resolveEntityGrn(args) {
    if (args.entityGrn) {
        const { type } = parseGrn(args.entityGrn);          // throws on malformed
        if (!SHAREABLE_TYPES.has(type)) {                   // {stream, dashboard, search}
            throw new Error(`entityGrn type "${type}" is not a shareable entity ...`);
        }
        return args.entityGrn.toLowerCase();
    }
    return buildGrn(args.entityType, args.entityId);
}
```

This is the seam that prevents `share_entity(entityGrn="grn::::user:alice")` from reaching the network — a grantee-type GRN as a share target is rejected client-side, mirroring the `ENTITY_TYPES` zod enum on the `entityType` path.

### /prepare read-side helper (one call, three uses)

**Source:** `src/tools/authz/prepare-share.js:36-45` (`fetchEntitySharePreview`)
**Apply to:** `share-entity.js` build() (read current grants + available_grantees + validation_result, all from the single call)

```javascript
export async function fetchEntitySharePreview(client, entityGrn) {
    const path = `/api/authz/shares/entities/${encodeURIComponent(entityGrn)}/prepare`;
    if (!path.endsWith("/prepare")) {                       // self-guard
        throw new Error(`entity-share read path must end with /prepare, got: ${path}`);
    }
    return client.request("POST", path, {});                // {} body, NOT null — sets Content-Type
}
```

### Error classification (400-with-body is structured data)

**Source:** `src/graylog/errors.js:7-36` (`GraylogError`, `mapGraylogError`, `GraylogValidationError`)
**Apply to:** `share-entity.js` apply()

`mapGraylogError` populates `err.body` for all 4xx — the body is the parsed JSON response payload. For Phase 10, the apply must inspect `err.status === 400 && err.body?.validation_result?.failed === true` and return a structured envelope rather than letting `wrapGraylogError` truncate the body to 200 chars.

### Connection resolution with `_testConnection` seam

**Source:** `src/tools/_shared/handler.js:71-91` (the strip + re-merge dance)
**Apply to:** *automatic* for `share-entity.js` because `defineMutatingHandler` does it for free.

The seam is intentionally absent from `mutatingBase` so zod's default `strip` mode drops it from production-agent payloads. Inside the wrapper it is read from pre-zod args and re-merged before `resolveConnection`. This is why offline tests can pass `_testConnection: "fake"` to bypass the registry.

### HTTP client transport

**Source:** `src/graylog/client.js:29-86` (`makeClient(conn).request`)
**Apply to:** all handlers
- `POST` with body — sets `Content-Type: application/json` (line 58-60)
- `POST` with `{}` body — also sets the header (the body is truthy at the `body !== null && body !== undefined` check on line 53)
- `validateStatus: () => true` (line 66) — all 4xx flow through `mapGraylogError` to typed `GraylogError`
- D-07 defense-in-depth: client refuses non-GET against `conn.writable === false` (lines 36-41), backing up the wrapper's writable gate at handler.js:97-106

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `test/fixtures/authz/commit-response-7.0.6.json` | captured live response | static JSON | First-time live commit-endpoint exercise; the Phase 8 `prepare-response-7.0.6.json` is the closest STRUCTURAL analog (same JSON-fixture pattern, same provenance header), but the commit response body is structurally `EntityShareResponse` after a write rather than after a `/prepare`. The fixture is **optional** for the offline tests (the existing prepare fixture suffices for build()-side assertions; a separate commit fixture only matters if the planner wants to also pin the apply-response shape). |

The merge helper itself (`mergeGrants(current, granteeGrn, capability, revoke)`) and the diff helper (`computeDiff`) are new in-file utilities; their closest analogs are the inline `Set` add/delete loops in `connect-pipelines-to-stream.js:67-79` and `disconnect-pipelines-from-stream.js:54-65`. The planner should decide whether to extract these as exported helpers in `share-entity.js` (testable in isolation) or keep them in-file (simpler).

## Metadata

**Analog search scope:**
- `src/tools/authz/*` (all four files — schemas, grn-helpers, prepare-share, both read handlers, the index barrel)
- `src/tools/_shared/{handler,schemas,cascade-hash,connection,errors}.js`
- `src/tools/pipelines/{connect,disconnect}-pipelines-from-stream.js`
- `src/tools/index-sets/{delete-index-set,schemas}.js`
- `src/graylog/{client,errors}.js`
- `src/tools.js` (the catalogue)
- `src/tools/meta/list-admin-tools.js` (DOMAIN_OVERRIDES)
- `test/{authz-entity-shares,authz-entity-shares-live.smoke,cascade-hash,pipelines,list-admin-tools,dashboards}.{test,smoke}.js`
- `test/fixtures/authz/prepare-response-7.0.6.json`

**Files scanned:** ~18 source files + 7 test files + 1 fixture
**Pattern extraction date:** 2026-05-20
