# Phase 8: AuthZ Foundation — GRN Helper & Live API Recon - Pattern Map

**Mapped:** 2026-05-19
**Files analyzed:** 8 (5 new, 3 modified)
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/tools/authz/grn-helpers.js` | utility (pure) | transform | `src/tools/_shared/cascade-hash.js` | role-match (pure, no-I/O, JSDoc/throw discipline) |
| `src/tools/authz/schemas.js` | config (zod schemas) | transform | `src/tools/pipelines/schemas.js` | exact (per-domain `schemas.js`) |
| `src/tools/authz/index.js` | route (register barrel) | event-driven | `src/tools/events/index.js` (empty-barrel state) + `src/tools/pipelines/index.js` (structure) | exact |
| `src/tools/_register.js` *(MODIFIED)* | route (central barrel) | event-driven | self — existing `import "./pipelines/index.js";` lines 56-91 | exact |
| `src/tools/_shared/cascade-hash.js` *(MODIFIED)* | utility (pure) | transform | `computeNotificationCascadeHash` in same file (lines 211-252) | exact |
| `test/authz-grn.test.js` | test | request-response | `test/cascade-hash.test.js` | role-match (unit test, `node:test`) |
| `test/cascade-hash.test.js` *(MODIFIED)* | test | request-response | self — `computeNotificationCascadeHash` tests, lines 309-433 | exact |
| `test/fixtures/authz/prepare-response-7.0.6.json` | fixture (data) | file-I/O | `test/fixtures/type-catalogue-7.0.6.json` | exact (7.0.6 captured fixture) |
| `scripts/capture-authz-prepare-fixture.js` | script (one-shot CLI) | request-response | `scripts/audit-tool-descriptions.js` | role-match (CLI script, `import.meta.url` main-guard) |

## Pattern Assignments

### `src/tools/authz/grn-helpers.js` (utility, pure transform) — NEW

**Analog:** `src/tools/_shared/cascade-hash.js` — there is no direct GRN-helper precedent in the codebase; this is the one genuinely new pure module. Copy the *discipline* (module header documenting provenance, pure no-I/O functions, `throw new Error(...)` on malformed input, JSDoc per export) from `cascade-hash.js`.

**Header / provenance-comment pattern** (`cascade-hash.js` lines 1-25 — every shared pure module opens with a provenance + responsibility block):
```javascript
// Cascade-hash helpers — promoted from src/tools/index-sets/c1-hash.js ...
// Both functions are pure (no I/O) and deterministic. ...
import { createHash } from "node:crypto";
```
Mirror this: open `grn-helpers.js` with the GRN wire-format block and the source citation `org/graylog/grn/GRN.java`.

**Throw-on-malformed-input pattern** (`cascade-hash.js` lines 144-156, `computeCascadeHash`):
```javascript
if (typeof streamId !== "string" || streamId.length === 0) {
    throw new Error("computeCascadeHash: streamId is required");
}
if (!Array.isArray(ruleIds) || ...) {
    throw new Error("computeCascadeHash: ruleIds, pipelineConnIds, eventDefIds must each be string[]");
}
```
`buildGrn`/`parseGrn` copy this exactly: type-check input, `throw new Error("<fnName>: <reason>")`. RESEARCH.md Pitfall 3 mandates the unknown-type error message *list the valid set* — `Valid types: ${[...GRN_TYPES].join(", ")}`.

**JSDoc-per-export pattern** (`cascade-hash.js` lines 31-41): every exported function carries `@param`/`@returns`/`@throws`. Apply to `buildGrn`, `parseGrn`, `isGrn`.

**Concrete API surface** — RESEARCH.md §"Pattern 2" supplies the full implementation: `GRN_TYPES` frozen `Set` (6 types: `stream`/`dashboard`/`search`/`user`/`builtin-team`/`role`), `buildGrn(type,id)` → 6-token lowercased `grn::::<type>:<id>`, `parseGrn(grn)` → `{cluster,tenant,scope,type,entity}`, `isGrn(value)` non-throwing predicate. Do **not** use the 14-type registry from ARCHITECTURE.md line 119 (Pitfall 6 — 7.0.6 may reject types the 7.2 registry lists).

---

### `src/tools/authz/schemas.js` (config, zod) — NEW

**Analog:** `src/tools/pipelines/schemas.js`

**Imports pattern** (`pipelines/schemas.js` lines 12-13):
```javascript
import { z } from "zod";
import { mutatingBase, listBase } from "../_shared/schemas.js";
```
Phase 8 ships **no mutating tool**, so `schemas.js` likely imports only `z` (the `Capability` enum + base GRN string schema need neither `mutatingBase` nor `listBase`). Keep the import line ready — Phase 9/10 schemas will extend `mutatingBase`.

**Enum + read-schema pattern** — the `Capability` enum is the headline export (RESEARCH.md §"Code Examples"):
```javascript
import { z } from "zod";
// Source: org/graylog/security/Capability.java — exactly 3 lowercase values.
export const Capability = z.enum(["view", "manage", "own"]);
```
Mirror `pipelines/schemas.js`'s per-export doc-comment discipline (lines 15-27): each `export const` is preceded by a comment naming the requirement ID and the design decision. For Phase 8 reference AUTHZ-02.

**`_shared/schemas.js` contract** (lines 12-22) — `mutatingBase` = `{dryRun: z.boolean().default(true), connectionName, idempotencyKey}`. Phase 8 does not touch it; noted so the planner knows the base exists for Phase 9/10.

---

### `src/tools/authz/index.js` (route, register barrel) — NEW (ships EMPTY)

**Analog:** `src/tools/events/index.js` for the *empty-barrel* state (Plan 05-01 shipped it empty — direct precedent); `src/tools/pipelines/index.js` for the structure once populated.

**Empty-barrel header pattern** (`events/index.js` lines 1-13):
```javascript
// Side-effect register barrel for the events domain (Phase 5).
// Imported once by src/tools/_register.js so the central registration
// barrel stays the single source of truth for tool→handler wiring.
//
// Plan 05-01 — empty stub; ... ready for Plans 05-02/03/04.
...
import { register } from "../../dispatch.js";
```
Phase 8's `authz/index.js` copies this exactly: header naming the phase, an explanatory comment that Phase 8 ships zero handlers and Phase 9/10 populate it, and the lone `import { register } from "../../dispatch.js";` line with **no `register()` calls**. RESEARCH.md §"Pattern 1" gives the verbatim file body.

**Populated-barrel pattern (for planner awareness, NOT Phase 8)** — `pipelines/index.js` lines 11-41: `import { register }` then one `import { handleX } from "./x.js";` per tool, then one `register("tool_name", handleX);` per tool. Phase 9+ will follow this.

---

### `src/tools/_register.js` (route, central barrel) — MODIFIED (one line)

**Analog:** self — the existing domain-barrel import block, lines 54-91.

**Pattern to copy** (`_register.js` lines 68, 77, 83 — every domain barrel is one commented `import`):
```javascript
// Phase 4 domain barrel — registers list_pipelines, get_pipeline, ...
import "./pipelines/index.js";
...
// Phase 5 domain barrel — Plan 05-01 ships this as an empty side-effect barrel ...
import "./events/index.js";
```
Phase 8 adds exactly one analogous line in this block:
```javascript
// Phase 8 domain barrel — Plan 08 ships this EMPTY (no handlers; GRN helper
// + Capability enum scaffolding only). Phase 9/10 populate it with
// get_entity_shares / list_grantees / share_entity.
import "./authz/index.js";
```
No other edit. `assertAllToolsRegistered` (run at `src/index.js` startup, referenced `_register.js` lines 1-9) is a free safety net — no change needed.

---

### `src/tools/_shared/cascade-hash.js` (utility, pure) — MODIFIED (append `computeShareGrantHash`)

**Analog:** `computeNotificationCascadeHash` in the same file, lines 211-252 — the most recent thin-wrapper precedent (Phase 5 D-09).

**Section-header pattern** (lines 211-213):
```javascript
// =====================================================================
// Phase 5 D-09 — computeNotificationCascadeHash (thin semantic wrapper)
// =====================================================================
```
Append an identical banner: `Phase 8 — computeShareGrantHash (entity-share confirmation token)`.

**Validation + canonical-JSON + digest pattern** (`computeNotificationCascadeHash` lines 239-252):
```javascript
export function computeNotificationCascadeHash({ notificationId, eventDefIds }) {
    if (typeof notificationId !== "string" || notificationId.length === 0) {
        throw new Error("computeNotificationCascadeHash: notificationId is required");
    }
    if (!Array.isArray(eventDefIds)) {
        throw new Error("computeNotificationCascadeHash: eventDefIds must be string[]");
    }
    return computeCascadeHash({ streamId: notificationId, ruleIds: [], pipelineConnIds: [], eventDefIds });
}
```

**KEY DEVIATION (RESEARCH.md §"Pattern 3" + Open Q1):** `computeShareGrantHash` does **NOT** forward into `computeCascadeHash` — unlike `computeRuleCascadeHash`/`computeNotificationCascadeHash` which both forward. A grant set is a flat sorted `[{grantee,capability}]` list; the keyed-bucket shape does not fit. It builds its own canonical JSON and calls `createHash("sha256")` directly (the import already exists, line 25). The file comment must document this deviation so a future reader is not surprised. RESEARCH.md §"Pattern 3" gives the verbatim implementation — canonical shape `{ entityGrn, grants: [...sorted by grantee] }`.

---

### `test/authz-grn.test.js` (test, unit) — NEW

**Analog:** `test/cascade-hash.test.js`

**Test-file header + imports pattern** (`cascade-hash.test.js` lines 19-28):
```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    computeCascadeHash, computeC1Hash, collectIndexNames,
    computeRuleCascadeHash, computeNotificationCascadeHash,
} from "../src/tools/_shared/cascade-hash.js";
```
`authz-grn.test.js` imports `node:test` + `node:assert/strict`, then `buildGrn`/`parseGrn`/`isGrn`/`GRN_TYPES` from `../src/tools/authz/grn-helpers.js` and `Capability` from `../src/tools/authz/schemas.js`.

**Banner-comment-per-test-group pattern** (`cascade-hash.test.js` lines 38-41, 58-61): each test group gets a `// ===` banner naming what it covers. Apply: round-trip group, unknown-type-rejection group, lowercasing group, `isGrn` predicate group, `Capability` enum group.

**Round-trip / negative-assertion patterns** (`cascade-hash.test.js` Test 8, lines 208-234) — `assert.throws(() => fn(...), /regex/)` for malformed input. Phase 8 RESEARCH.md §"Test Map" mandates: (1) `parseGrn(buildGrn(t,id))` round-trips for every type in `GRN_TYPES`; (2) unknown-type rejection — `assert.throws(..., /Valid types/)` and assert the message *contains the valid set*; (3) `Capability` rejects strings outside `view`/`manage`/`own`; (4) a fixture-shape test asserting `prepare-response-7.0.6.json` has the expected `EntityShareResponse` keys.

**Fixture-load pattern** (from `v7-read-tool-smoke.test.js` lines 39-43):
```javascript
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "v7-read-tool-smoke");
const loadFixture = (name) => JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8"));
```
The fixture-shape test in `authz-grn.test.js` copies this, pointing `FIXTURE_DIR` at `fixtures/authz`.

---

### `test/cascade-hash.test.js` (test, unit) — MODIFIED (append `computeShareGrantHash` tests)

**Analog:** self — the `computeNotificationCascadeHash` test block, lines 309-433.

**Byte-identity / frozen-fixture pattern** (lines 350-368) — the load-bearing discipline:
```javascript
test("computeNotificationCascadeHash returns the pinned hash for the empty-cascade frozen fixture ...", () => {
    // Recompute via:
    //   node -e 'import("./src/tools/_shared/cascade-hash.js").then(m =>
    //     console.log(m.computeNotificationCascadeHash({ notificationId:"...", eventDefIds:[] })))'
    const hash = computeNotificationCascadeHash({ notificationId: "66e8aaaa...", eventDefIds: [] });
    assert.equal(hash, "e2ba7147288dc6e9dbc0086881b87975c60b3925d8835bba2ffaf5db439f269c");
    assert.match(hash, /^[0-9a-f]{64}$/);
});
```
Append a `computeShareGrantHash` import to the line-22 import block, then add tests mirroring this block: a frozen 64-hex literal pinned after first run (with the `node -e` recompute comment), a 64-hex regex sanity check, a grant-order-independence test (`assert.equal(a, b)` for re-ordered grant arrays — analog of the "sort-order independent" test, lines 388-400), an `entityGrn`-affects-hash test (lines 402-412 analog), and a malformed-input rejection test (lines 414-433 analog). RESEARCH.md §"Code Examples" gives the verbatim two test functions.

---

### `test/fixtures/authz/prepare-response-7.0.6.json` (fixture, data) — NEW

**Analog:** `test/fixtures/type-catalogue-7.0.6.json` — the existing live-7.0.6 captured-fixture precedent (raw JSON keyed by the Graylog DTO shape, no wrapper).

**Pattern:** a verbatim JSON capture of the live `test` instance's `EntityShareResponse`. **Must NOT be hand-built from 7.2 source** (Pitfall 5 — `synced_entities` may be absent on 7.0.6). The capture comes from running `scripts/capture-authz-prepare-fixture.js`. RESEARCH.md §"Code Examples" shows the expected `EntityShareResponse` key set (`entity`, `sharing_user`, `available_grantees`, `available_capabilities`, `active_shares`, `selected_grantee_capabilities`, `missing_permissions_on_dependencies`, `synced_entities`?, `validation_result`). Record provenance (instance + capture date) — JSON cannot carry a comment, so add a sibling provenance note (a `_provenance` key in the JSON, or a short note in the phase TEST-STRATEGY doc).

---

### `scripts/capture-authz-prepare-fixture.js` (script, one-shot CLI) — NEW

**Analog:** `scripts/audit-tool-descriptions.js` — the only existing `scripts/` file; supplies the CLI conventions.

**Shebang + main-guard pattern** (`audit-tool-descriptions.js` line 1, lines 81-86):
```javascript
#!/usr/bin/env node
...
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
...
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) { ... process.exit(0|1|2); }
```
The probe script copies the shebang and the `isMain` guard, and uses `process.exit` codes (0 success, non-zero on failure) like the auditor.

**HTTP-call pattern** — RESEARCH.md §"Don't Hand-Roll" mandates `makeClient(conn).request(...)`, NOT raw axios. From `src/graylog/client.js` lines 29-31 / `get-pipeline.js` lines 46-51:
```javascript
import { makeClient } from "../src/graylog/client.js";
const client = makeClient(conn);
const response = await client.request("POST", path, {});  // empty body = pure read
```
`client.request` with a `{}` body sends `Content-Type: application/json` (client.js lines 53-59); `@NoAuditEvent` `/prepare` mutates nothing.

**Connection-resolution pattern** — the probe is a script (no MCP request envelope), so it cannot use `resolveConnection`. Use the config module directly: `getConnections()` / `getActiveConnectionConfig()` from `src/config.js` (exports at lines 52, 65). Target the `test` connection (RESEARCH.md A3 — live UNESCO production; read-only probe is safe).

**Path-encoding (CRITICAL — Pitfall 4)** — RESEARCH.md §"Pattern 4":
```javascript
const entityGrn = buildGrn("stream", "<existing test-instance stream id>");
const path = `/api/authz/shares/entities/${encodeURIComponent(entityGrn)}/prepare`;
```
The GRN's literal colons MUST be percent-encoded (`%3A`). The script's own verification must assert the path ends in `/prepare` (Pitfall 1 — the commit endpoint is forbidden this phase). Writes the response verbatim to `test/fixtures/authz/prepare-response-7.0.6.json`.

## Shared Patterns

### Pure-module discipline (JSDoc + throw-on-malformed + provenance header)
**Source:** `src/tools/_shared/cascade-hash.js` lines 1-25 (header), 31-41 (JSDoc), 144-156 (throw guards)
**Apply to:** `src/tools/authz/grn-helpers.js`, the `computeShareGrantHash` addition to `cascade-hash.js`
Every pure helper opens with a provenance/responsibility block, carries JSDoc per export, and validates inputs with `throw new Error("<fnName>: <reason>")`.

### Per-domain folder structure
**Source:** `src/tools/pipelines/` (`index.js` + `schemas.js`), `src/tools/events/index.js` (empty-barrel state)
**Apply to:** the new `src/tools/authz/` folder
A domain folder = `index.js` (side-effect `register` barrel) + `schemas.js` (zod) + per-tool handler files. Phase 8 ships only `index.js` (empty), `schemas.js`, and the non-handler `grn-helpers.js`. CLAUDE.md mandates this structure (`src/tools/<domain>/`, not inline in `src/index.js`).

### Side-effect barrel wiring
**Source:** `src/tools/_register.js` lines 54-91 — one commented `import "./<domain>/index.js";` per domain
**Apply to:** the one-line `_register.js` edit
Each domain barrel is registered by a single import line; `assertAllToolsRegistered` fail-fasts at startup if a `tools.js` entry lacks a handler.

### Byte-identity hash pinning
**Source:** `test/cascade-hash.test.js` lines 350-386 (frozen 64-hex literals + `node -e` recompute comment)
**Apply to:** the `computeShareGrantHash` tests appended to `cascade-hash.test.js`
Pin the hash output as a frozen 64-hex literal; include the `node -e` recompute one-liner as a comment; assert `/^[0-9a-f]{64}$/`; add an order-independence test. Canonical-form drift then fails loudly (drift-refusal false-fire defense for Phase 10).

### Fixture-driven offline test
**Source:** `test/v7-read-tool-smoke.test.js` lines 39-43 (`FIXTURE_DIR` + `loadFixture` via `fileURLToPath`); `test/fixtures/type-catalogue-7.0.6.json` (7.0.6 capture)
**Apply to:** `test/fixtures/authz/prepare-response-7.0.6.json` + the fixture-shape test in `authz-grn.test.js`
Live capture is a separate one-shot script; the committed fixture is asserted by a normal offline test. `npm test` stays offline.

### CLI script conventions
**Source:** `scripts/audit-tool-descriptions.js` lines 1, 21-23, 81-86 (shebang, `node:url`/`node:path` imports, `isMain` main-guard, `process.exit` codes)
**Apply to:** `scripts/capture-authz-prepare-fixture.js`
One-shot scripts are `#!/usr/bin/env node`, guard execution with the `import.meta.url === resolve(process.argv[1])` idiom, and exit with status codes.

## No Analog Found

None. Every Phase 8 file has a verified codebase precedent. The single "new pure module" (`grn-helpers.js`) has no *direct* GRN precedent but mirrors the established pure-helper discipline of `cascade-hash.js` — classified as a role-match above, not a no-analog gap.

## Metadata

**Analog search scope:** `src/tools/` (all domain folders), `src/tools/_shared/`, `src/graylog/`, `src/config.js`, `scripts/`, `test/`, `test/fixtures/`
**Files scanned:** `src/tools/pipelines/index.js`, `src/tools/pipelines/schemas.js`, `src/tools/pipelines/get-pipeline.js`, `src/tools/events/index.js`, `src/tools/_register.js`, `src/tools/_shared/cascade-hash.js`, `src/tools/_shared/schemas.js`, `src/tools/_shared/connection.js`, `src/graylog/client.js`, `src/config.js`, `test/cascade-hash.test.js`, `test/v7-read-tool-smoke.test.js`, `test/fixtures/type-catalogue-7.0.6.json`, `scripts/audit-tool-descriptions.js`
**Pattern extraction date:** 2026-05-19
