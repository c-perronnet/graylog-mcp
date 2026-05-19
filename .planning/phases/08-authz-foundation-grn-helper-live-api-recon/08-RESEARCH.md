# Phase 8: AuthZ Foundation — GRN Helper & Live API Recon - Research

**Researched:** 2026-05-19
**Domain:** Graylog 7.0.6 authorization scaffolding — GRN abstraction, authz domain wiring, live-API reconnaissance
**Confidence:** HIGH

## Summary

Phase 8 is a **foundation + reconnaissance** phase. It writes no agent-facing mutating tool. It produces four things every later authz phase (9/10/11) consumes: (1) a pure, unit-tested GRN helper module; (2) the `authz` domain folder wired into the dispatch barrel with a `Capability` zod enum; (3) captured **live 7.0.6** `prepare`-response fixtures that pin the real wire shapes so Phases 9/10 build on verified DTOs, not the milestone brief's wrong `PUT` path or the two-minors-ahead 7.2 source clone; and (4) a `computeShareGrantHash` thin wrapper in the existing `cascade-hash.js` with byte-identity pinned in tests. It also documents the live-production test strategy before any apply handler exists.

The prior milestone research (SUMMARY/FEATURES/ARCHITECTURE/PITFALLS) already established the hard facts: the real endpoints are `POST /api/authz/shares/entities/{entityGRN}` (commit) and `.../prepare` (dry-run); a GRN is a 6-token colon-joined lowercased string; the `Capability` enum is exactly `view`/`manage`/`own`; `cascade-hash.js` is the precedent for the new hash wrapper. This research does **not** re-derive those — it converts them into the precise existing-codebase patterns the planner copies, and resolves the open question of how to capture a live fixture **read-only** against real UNESCO production infrastructure.

**Primary recommendation:** Plan Phase 8 as a sequence of pure/scaffolding tasks (GRN helper → schemas → barrel wiring → hash wrapper → unit tests) plus exactly one live-network task (a non-mutating `/prepare` probe against the `test` connection). Copy `src/tools/pipelines/` for the domain structure, `cascade-hash.js`'s `computeNotificationCascadeHash` for the new wrapper, and `test/cascade-hash.test.js` for the byte-identity test discipline. The only live network call permitted this phase is `POST .../prepare` with an empty body — it is `@NoAuditEvent`, mutates nothing, and is safe against production. The commit endpoint MUST NOT be exercised.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| GRN string build/parse/validate | MCP tool layer (`src/tools/authz/grn-helpers.js`) | — | Pure string transform; no I/O; no Graylog call. Authz-only concern — co-locate in `authz/`, not `_shared/`. |
| Capability enum definition | MCP tool layer (`src/tools/authz/schemas.js`) | — | zod schema, parse-time validation. Mirror of `pipelines/schemas.js`. |
| Domain registration | MCP dispatch layer (`_register.js` + `authz/index.js`) | — | Side-effect barrel; identical wiring to the 9 v3.0.0 domains. |
| Confirmation-token hashing | MCP shared layer (`src/tools/_shared/cascade-hash.js`) | — | Cross-domain primitive already in `_shared/`; add one thin wrapper. |
| Live endpoint-shape verification | Graylog API (`POST .../prepare`) → captured fixture file | MCP test layer | Recon only; the `/prepare` endpoint is `@NoAuditEvent` (non-mutating). Output is a static JSON fixture under `test/fixtures/`. |

**Why this matters:** Phase 8 touches no agent-facing mutation. Every capability above lands in the MCP tool/test layers; the single Graylog-tier interaction is a read-only probe. If any task in the plan proposes calling the commit endpoint `POST .../entities/{grn}` (no `/prepare` suffix), that is a tier/scope error — flag it.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTHZ-02 | The authz tool surface is verified against the live Graylog 7.0.6 instance before milestone close — correct `POST /api/authz/shares/entities/{entityGRN}` endpoint, GRN URL-encoding, and role endpoints. | Phase 8 owns the **establishing** verification: capture a live 7.0.6 `prepare`-response fixture, confirm the corrected `POST .../entities/{entityGRN}` + `/prepare` path against the live `test` instance, and record that the brief's `PUT /api/authz/shares/{grn}` is wrong. Endpoint/DTO shapes are in `## Code Examples` and `## Standard Stack`. GRN URL-encoding (`%3A` for colons) is covered in `## Common Pitfalls` Pitfall 4. Role-endpoint verification is **deferred to Phase 11** per REQUIREMENTS.md cross-cutting note ("AUTHZ-02 ... re-asserted ... at milestone close"); Phase 8 verifies only the entity-shares surface and the GRN format. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zod` | 3.25.76 (installed) | `Capability` enum, GRN-token validation, base schemas | `[VERIFIED: package.json]` Already a dependency; CLAUDE.md mandates adopting `zod` for validation rather than adding a new dep. |
| `node:crypto` | built-in | `computeShareGrantHash` sha-256 over the grant set | `[VERIFIED: codebase]` `cascade-hash.js` already uses `createHash("sha256")`. |
| `node:test` + `node:assert/strict` | built-in (Node ≥ 22.3.0) | Unit tests for GRN helpers, hash wrapper, fixture-shape assertions | `[VERIFIED: package.json]` `"test": "node --test 'test/**/*.test.js'"`. No Jest/Mocha. |
| `axios` | 1.12.2 (installed) | The one live `/prepare` recon call, routed through `makeClient(conn).request()` | `[VERIFIED: package.json]` Existing HTTP client; no direct axios use in tool code. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `c8` | dev dependency | Coverage report (`npm run coverage`) | Optional; only if the plan wants a coverage gate on the new files. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Co-locating `grn-helpers.js` in `src/tools/authz/` | Placing it in `src/tools/_shared/grn.js` | `[CITED: .planning/research/ARCHITECTURE.md §"Structure Rationale"]` ARCHITECTURE.md explicitly decided **authz/** placement — `_shared/` is reserved for primitives with multiple-domain consumers; GRN has only authz consumers in v3.1.0. Promote later if a second domain needs it (the `c1-hash.js → cascade-hash.js` promotion is the documented precedent). **Do not pre-promote.** |
| New `cascade-hash.js` standalone helper for grants | Thin wrapper `computeShareGrantHash` over `computeCascadeHash` | `[CITED: .planning/research/ARCHITECTURE.md §"Token shape"]` ARCHITECTURE.md notes `computeCascadeHash`'s keyed-bucket shape is stream-cascade-specific; a flat sorted `[{grantee,capability}]` list is cleaner as a **dedicated small wrapper** that does NOT forward into `computeCascadeHash`. This differs from `computeRuleCascadeHash`/`computeNotificationCascadeHash` (which DO forward). See `## Open Questions` Q1 — the planner must decide forwarding vs standalone. |

**Installation:** No installation. Zero new dependencies — confirmed by CLAUDE.md constraint ("adopt `zod` ... rather than adding a new dep") and SUMMARY.md ("If a PR adds a dependency, treat it as a red flag").

## Package Legitimacy Audit

> Phase 8 installs **no external packages**. All capability is covered by already-installed dependencies (`zod`, `axios`) and Node built-ins (`node:crypto`, `node:test`). The Package Legitimacy Gate is **not applicable** — there is nothing to audit. If any plan task proposes `npm install`, that contradicts the CLAUDE.md zero-new-dependency constraint and must be rejected.

## Architecture Patterns

### System Architecture Diagram

```
                       Phase 8 deliverables (no agent-facing mutating tool)
                                         │
   ┌─────────────────────────────────────┼──────────────────────────────────────┐
   │                                     │                                       │
   ▼                                     ▼                                       ▼
PURE / SCAFFOLD                    SHARED-LAYER EDIT                       LIVE RECON (read-only)
─────────────                     ─────────────────                      ──────────────────────
src/tools/authz/grn-helpers.js     src/tools/_shared/cascade-hash.js       node probe script OR
  buildGrn / parseGrn / isGrn        + computeShareGrantHash               test against `test` conn
  + GRN_TYPES set                                                            │
        │                                  │                                  │ axios via
        ▼                                  ▼                                  ▼ makeClient(conn).request()
src/tools/authz/schemas.js         test/cascade-hash.test.js                POST /api/authz/shares/
  Capability enum (view/manage/own)   + byte-identity pin for                 entities/{GRN}/prepare
  + base GRN schema                   computeShareGrantHash                   body: {}  (empty = pure read)
        │                                                                     │ @NoAuditEvent — mutates nothing
        ▼                                                                     ▼
src/tools/authz/index.js  ◄── empty register barrel (no register() calls)  EntityShareResponse JSON
        │                                                                     │
        ▼                                                                     ▼
src/tools/_register.js  ◄── + import "./authz/index.js";              test/fixtures/authz/
                                                                        prepare-response-7.0.6.json
   ┌──────────────────────────────────────────────────────────────────────────┘
   ▼
test/authz-grn.test.js (or test/authz.test.js) — unit tests for all of the above
```

File-to-implementation mapping is in the Component Responsibilities table below; the diagram shows what each deliverable depends on.

### Recommended Project Structure

```
src/tools/authz/                  # NEW domain folder — mirror of src/tools/pipelines/
├── index.js                      # register barrel — Phase 8 ships it EMPTY (no register() calls yet)
├── schemas.js                    # zod: Capability enum + base GRN schema
└── grn-helpers.js                # pure buildGrn / parseGrn / isGrn + GRN_TYPES (NO I/O)

src/tools/_register.js            # MODIFIED — add one line: import "./authz/index.js";
src/tools/_shared/cascade-hash.js # MODIFIED — add computeShareGrantHash wrapper

test/
├── authz-grn.test.js             # NEW — unit tests for grn-helpers + schemas
├── cascade-hash.test.js          # MODIFIED — pin computeShareGrantHash byte-identity
└── fixtures/authz/
    └── prepare-response-7.0.6.json   # NEW — captured live 7.0.6 prepare response
```

### Component Responsibilities

| File | Responsibility | Copy this precedent |
|------|----------------|---------------------|
| `src/tools/authz/grn-helpers.js` | `buildGrn(type,id)`, `parseGrn(grn)`, `isGrn(value)`, `GRN_TYPES` set. Pure functions, zero I/O. | No direct file precedent (new pure module) — mirror the JSDoc/throw discipline of `cascade-hash.js`. |
| `src/tools/authz/schemas.js` | `Capability` zod enum (`z.enum(["view","manage","own"])`); a base GRN string schema. | `src/tools/pipelines/schemas.js` — imports `z`, imports `mutatingBase`/`listBase` from `../_shared/schemas.js`. |
| `src/tools/authz/index.js` | Side-effect register barrel — **empty in Phase 8** (`import { register }` line + a comment; no `register()` calls until Phase 9). | `src/tools/pipelines/index.js`. The `events/index.js` barrel shipped empty in Plan 05-01 — direct precedent for an empty barrel. |
| `src/tools/_register.js` | One added line: `import "./authz/index.js";` in the domain-barrel section. | Existing lines `import "./pipelines/index.js";` etc. (lines 56-91). |
| `src/tools/_shared/cascade-hash.js` | Add `computeShareGrantHash({ entityGrn, grants })`. | `computeNotificationCascadeHash` (Phase 5) — the most recent thin-wrapper precedent. |
| `test/fixtures/authz/prepare-response-7.0.6.json` | Frozen real 7.0.6 `EntityShareResponse` from a live `/prepare` probe. | `test/fixtures/type-catalogue-7.0.6.json`, `test/fixtures/v7-read-tool-smoke/*.json` — existing 7.0.6 fixture precedent. |

### Pattern 1: Empty register barrel for a not-yet-populated domain
**What:** `src/tools/authz/index.js` is created and imported by `_register.js` in Phase 8, but registers **zero** handlers — Phase 8 ships no agent-facing tool.
**When to use:** A foundation phase that scaffolds a domain before any tool exists.
**Example:**
```javascript
// src/tools/authz/index.js — Phase 8 scaffold.
// Side-effect register barrel for the authz domain. Phase 8 ships this EMPTY:
// no handlers exist yet. Phase 9 (get_entity_shares, list_grantees) and
// Phase 10 (share_entity) populate this barrel.
// Precedent: src/tools/events/index.js shipped empty in Plan 05-01.
import { register } from "../../dispatch.js";
// (no register() calls — handlers land in Phase 9+)
```
`[VERIFIED: codebase]` `src/tools/_register.js` lines 69-71 document `events/index.js` shipping empty in Plan 05-01.

### Pattern 2: GRN helper API surface
**What:** Three pure functions + one frozen `Set`, all in `grn-helpers.js`.
**When to use:** Every authz tool in Phases 9-11 imports `buildGrn`/`parseGrn`/`isGrn`.
**Example:**
```javascript
// src/tools/authz/grn-helpers.js
// GRN wire format (source: org/graylog/grn/GRN.java): 6 colon-joined tokens
//   grn:<cluster>:<tenant>:<scope>:<type>:<entity>
// GRN.parse() lowercases the whole string, splits on ":", requires exactly
// 6 tokens, token[0] === "grn". cluster/tenant/scope are empty on a
// single-cluster self-hosted Graylog.

// Phase 8 scope: restrict to the milestone's shareable + grantee types.
// FEATURES.md GRN-type registry has 14 types; v3.1.0 needs only these.
export const GRN_TYPES = new Set([
  "stream", "dashboard", "search",   // shareable entity targets
  "user",                            // grantee
  "builtin-team",                    // "everyone" grantee
  "role",                            // Phase 11
]);

// buildGrn("stream","000000000001") -> "grn::::stream:000000000001"
export function buildGrn(type, id) {
  const t = String(type).toLowerCase();
  if (!GRN_TYPES.has(t)) {
    throw new Error(
      `Unknown GRN type "${type}". Valid types: ${[...GRN_TYPES].join(", ")}`,
    );
  }
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("buildGrn: id must be a non-empty string");
  }
  // 6-token form: grn : cluster : tenant : scope : type : entity
  return `grn::::${t}:${id.toLowerCase()}`;
}

// parseGrn("grn::::stream:abc") -> {cluster,tenant,scope,type,entity}; throws on malformed
export function parseGrn(grn) {
  if (typeof grn !== "string") throw new Error("parseGrn: input must be a string");
  const lowered = grn.toLowerCase();          // GRN.parse lowercases
  const tokens = lowered.split(":");
  if (tokens.length !== 6 || tokens[0] !== "grn") {
    throw new Error(`"${grn}" is not a valid GRN string (expected 6 colon-tokens with "grn" prefix)`);
  }
  const [, cluster, tenant, scope, type, entity] = tokens;
  if (!GRN_TYPES.has(type)) {
    throw new Error(`GRN type "${type}" not in valid set: ${[...GRN_TYPES].join(", ")}`);
  }
  return { cluster, tenant, scope, type, entity };
}

// isGrn — non-throwing predicate
export function isGrn(value) {
  try { parseGrn(value); return true; } catch { return false; }
}
```
`[CITED: source-code/.../org/graylog/grn/GRN.java]` via FEATURES.md §"GRN — exact grammar" and ARCHITECTURE.md §"Pattern 1".

**Two GRN-canonical-form decisions the planner must lock (see Open Questions Q2):**
1. **4-empty vs 5-empty middle tokens.** FEATURES.md uses `grn::::stream:<id>` (4 colons after `grn`, = exactly 6 tokens). ARCHITECTURE.md text also mentions `grn:::::stream:...` (5 colons = 7 tokens — that is a typo; `GRN.parse` requires *exactly 6*). **Lock the 6-token form `grn::::stream:<id>`** — it is the only form that round-trips through a 6-token parser. The success-criterion wording "6-token lowercased GRN" confirms this.
2. **Lowercasing entity ids.** `GRN.parse` lowercases the *entire* string. Mongo ObjectIds are already lowercase hex, so this is safe — but `buildGrn` must lowercase to guarantee round-trip stability (`parseGrn(buildGrn(t, "ABC")).entity === "abc"`).

### Pattern 3: Thin hash wrapper in cascade-hash.js
**What:** `computeShareGrantHash({ entityGrn, grants })` — sha-256 over a canonical, sorted representation of the grant set.
**When to use:** Phase 10's `share_entity` calls it; Phase 8 only adds it + pins byte-identity.
**Example:**
```javascript
// src/tools/_shared/cascade-hash.js — append after computeNotificationCascadeHash
//
// Phase 8 — computeShareGrantHash (entity-share confirmation token).
//
// UNLIKE computeRuleCascadeHash / computeNotificationCascadeHash (which forward
// into computeCascadeHash's keyed-bucket shape), a grant set is a flat sorted
// list of {grantee, capability} pairs. computeCascadeHash's stream-cascade
// bucket shape does not fit, so this wrapper builds its own canonical JSON.
// (ARCHITECTURE.md §"Token shape" — confirm forwarding decision with planner.)
//
// Canonical JSON shape (LOCK THIS — drift = drift-refusal false-fire in Ph10):
//   { "entityGrn": "<grn>", "grants": [ {grantee,capability}, ... sorted by grantee ] }
export function computeShareGrantHash({ entityGrn, grants }) {
  if (typeof entityGrn !== "string" || entityGrn.length === 0) {
    throw new Error("computeShareGrantHash: entityGrn is required");
  }
  if (!Array.isArray(grants)) {
    throw new Error("computeShareGrantHash: grants must be an array of {grantee,capability}");
  }
  const sorted = [...grants]
    .map((g) => ({ grantee: g.grantee, capability: g.capability }))
    .sort((a, b) => (a.grantee < b.grantee ? -1 : a.grantee > b.grantee ? 1 : 0));
  const canonical = JSON.stringify({ entityGrn, grants: sorted });
  return createHash("sha256").update(canonical).digest("hex");
}
```
`[CITED: .planning/research/ARCHITECTURE.md §"Token shape"]`. The byte-identity discipline (frozen 64-hex literals + a `node -e` recompute comment) is `[VERIFIED: codebase]` from `test/cascade-hash.test.js` Tests 3/4 and the `computeNotificationCascadeHash` pinned-fixture tests.

### Pattern 4: Live recon as a non-mutating /prepare probe
**What:** The single live network interaction. Capture a real 7.0.6 `EntityShareResponse` by POSTing an **empty body** to `/prepare`.
**When to use:** Once, to produce the fixture file. Re-runnable safely (it is `@NoAuditEvent`).
**Example (probe script — see Open Questions Q3 for script-vs-test placement):**
```javascript
// POST /api/authz/shares/entities/{URL-ENCODED-GRN}/prepare  body: {}
// @NoAuditEvent — changes nothing. SAFE against live production.
// entityGrn MUST be URL-path-encoded: colons -> %3A  (Pitfall 4).
const entityGrn = buildGrn("stream", "<an existing test-instance stream id>");
const path = `/api/authz/shares/entities/${encodeURIComponent(entityGrn)}/prepare`;
const response = await makeClient(conn).request("POST", path, {});
// -> write response verbatim to test/fixtures/authz/prepare-response-7.0.6.json
```
`[CITED: .planning/research/FEATURES.md §"Endpoint Reference"]` and `[CITED: .planning/research/PITFALLS.md Pitfall 8]` (mutation-free recon discipline).

### Anti-Patterns to Avoid
- **GRN string concatenation at call sites:** Never inline `` `grn::::stream:${id}` `` — always `buildGrn`. `[CITED: ARCHITECTURE.md Anti-Pattern 3]`
- **Registering a tool in Phase 8:** Phase 8 ships no agent-facing handler. `authz/index.js` is empty. If a plan task adds a `register("share_entity", ...)` call, that is Phase 9/10 scope leaking in — reject it.
- **Exercising the commit endpoint:** `POST .../entities/{grn}` (no `/prepare`) mutates production grants. It MUST NOT appear anywhere in Phase 8. Only `/prepare` is touched.
- **Pinning the GRN type enum to the full 14-type 7.2 registry:** `[CITED: PITFALLS.md Pitfall 6]` 7.0.6 may have a smaller set; pinning the 7.2 list could *accept* a type the live server rejects. Restrict `GRN_TYPES` to the 6 the milestone actually uses (`stream`/`dashboard`/`search`/`user`/`builtin-team`/`role`).
- **Forwarding `computeShareGrantHash` into `computeCascadeHash`:** the keyed-bucket shape does not fit a flat grant list — build a dedicated canonical form (Open Questions Q1).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| sha-256 confirmation token | A new hashing module | Add a wrapper to `src/tools/_shared/cascade-hash.js` | `[VERIFIED: codebase]` Established pattern; single-sourced canonical-form discipline; byte-identity test harness already exists. |
| HTTP call for the recon probe | Raw `axios.post(...)` | `makeClient(conn).request("POST", path, {})` | `[VERIFIED: codebase]` `src/graylog/client.js` handles auth (token-as-username), bodyless vs body requests, and the writable gate. No tool code uses axios directly. |
| Capability enum validation | `if (cap !== "view" && ...)` chains | `z.enum(["view","manage","own"])` in `schemas.js` | `[CITED: CLAUDE.md]` Project mandates `zod` for input validation. |
| Test runner / assertions | Jest / Mocha / chai | `node:test` + `node:assert/strict` | `[VERIFIED: package.json]` `"test": "node --test ..."` — no third-party test framework. |
| Connection resolution in the probe | New config reader | `resolveConnection` / `_testConnection` seam | `[VERIFIED: codebase]` `get-pipeline.js` shows the canonical resolve pattern. |

**Key insight:** Phase 8 builds **one** genuinely new pure module (`grn-helpers.js`). Everything else is copy-the-precedent. The risk in this phase is not missing complexity — it is scope creep (registering tools, calling the commit endpoint) and getting the GRN canonical form subtly wrong.

## Runtime State Inventory

> Phase 8 is **not** a rename/refactor/migration phase — it is greenfield scaffolding (new files) plus two additive edits to existing files (`_register.js`, `cascade-hash.js`). No stored data, live service config, OS-registered state, secrets, or build artifacts carry a string that Phase 8 changes.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 8 creates no persistent state; authz tools are stateless (ARCHITECTURE.md §"State management"). | None |
| Live service config | None — the live `/prepare` probe reads Graylog state but writes nothing (`@NoAuditEvent`). No Graylog config is mutated. | None |
| OS-registered state | None — no schedulers, daemons, or services. | None |
| Secrets/env vars | None new. The probe reuses the existing connection registry's API token; no new secret. | None |
| Build artifacts | None — no build step (`"type": "module"`, direct `node` execution per CLAUDE.md). | None |

## Common Pitfalls

### Pitfall 1: Capturing the fixture against live UNESCO production unsafely
**What goes wrong:** A recon task accidentally calls the commit endpoint, or shares a real stream with a real user, changing who can read production logs.
**Why it happens:** "Live API recon" sounds like it needs mutation; the commit and prepare paths differ only by a `/prepare` suffix.
**How to avoid:** `[CITED: PITFALLS.md Pitfall 8]` Phase 8 touches **only** `POST .../prepare` with an **empty body** (`{}`). That endpoint is `@NoAuditEvent` — it mutates nothing and is safe against production. The plan must state this explicitly and the probe task's verification must assert the path ends in `/prepare`. The commit endpoint is Phase 10-only.
**Warning signs:** A probe path without `/prepare`; a probe body containing `selected_grantee_capabilities` with a real grantee; any `dryRun: false` anywhere in Phase 8.

### Pitfall 2: GRN canonical-form drift (token count, casing)
**What goes wrong:** `buildGrn` emits a form `parseGrn` cannot round-trip — e.g. 7 tokens (`grn:::::type:id`), or a non-lowercased type.
**Why it happens:** `[CITED: PITFALLS.md Pitfall 2]` ARCHITECTURE.md text shows both `grn::::stream:` and `grn:::::stream:`; only the **6-token** form (`grn::::stream:<id>`, 4 colons after `grn`) round-trips a 6-token parser. `GRN.parse` requires *exactly* 6.
**How to avoid:** Lock the 6-token form. Unit-test `parseGrn(buildGrn(t, id))` round-trips for every type in `GRN_TYPES`, and that `buildGrn` lowercases. Success criterion #1 ("round-trip a valid 6-token lowercased GRN") is the gate.
**Warning signs:** A test that builds a GRN literal by hand instead of via `buildGrn`; `split(":").length` checks for anything other than 6.

### Pitfall 3: Unknown-type rejection that does not list valid types
**What goes wrong:** `buildGrn("saved_search", id)` throws an opaque error; the agent (in Phase 10) cannot recover.
**Why it happens:** `[CITED: PITFALLS.md Pitfall 2]` Graylog naming is inconsistent — saved searches are type `search` (not `saved_search`), event notifications are `notification` (not `event_notification`).
**How to avoid:** Success criterion #1 mandates the error message **list the valid type set**. The `buildGrn` example above does this (`Valid types: ${[...GRN_TYPES].join(", ")}`). Unit-test that the rejection message contains the valid set.
**Warning signs:** An error message that names only the bad type, not the allowed alternatives.

### Pitfall 4: Forgetting GRN URL-path encoding
**What goes wrong:** The probe builds `/api/authz/shares/entities/grn::::stream:abc/prepare` with literal colons; the JAX-RS router mis-splits the path → 404 or wrong route.
**Why it happens:** `[CITED: FEATURES.md §"Endpoint Reference"]` `entityGRN` is a `@PathParam`; a GRN's literal `:` chars must be percent-encoded (`%3A`).
**How to avoid:** The probe must `encodeURIComponent(entityGrn)` before interpolation. Document this in the live-recon strategy so Phases 9/10 inherit it. AUTHZ-02 explicitly calls out "GRN URL-encoding" as a verification target.
**Warning signs:** A raw GRN string interpolated directly into a request path.

### Pitfall 5: 7.0.6-vs-7.2 wire-shape divergence baked into the fixture
**What goes wrong:** The fixture is hand-built from 7.2 source (e.g. includes `synced_entities`) but live 7.0.6 omits the field; Phase 9's parser then assumes a field that is not there.
**Why it happens:** `[CITED: PITFALLS.md Pitfall 6 / SUMMARY.md "Gaps to Address"]` The source clone is two minors ahead; `synced_entities` looks like a recent addition.
**How to avoid:** The fixture MUST be a **verbatim capture of the live `test` instance response**, not a hand-built 7.2-derived JSON. The plan's recon task verification asserts the fixture came from a real HTTP response. Record in the strategy doc which `EntityShareResponse` fields are actually present in 7.0.6 (especially `synced_entities`) so Phase 9 treats absent fields as `.optional()`.
**Warning signs:** A fixture file authored by editing 7.2 source DTOs; a fixture with no provenance note recording the instance + date.

## Code Examples

### Verified endpoint shapes (the recon targets)
```
# Dry-run / read — @NoAuditEvent, mutates nothing. THE ONLY Phase 8 live call.
POST /api/authz/shares/entities/{URL-encoded-GRN}/prepare
  body (empty = pure read of current grants): {}
  -> 200  EntityShareResponse

# Commit — full-replace mutation. NOT touched in Phase 8 (Phase 10 only).
POST /api/authz/shares/entities/{URL-encoded-GRN}
```
`[CITED: source-code/.../EntitySharesResource.java]` via FEATURES.md §"Endpoint Reference". The brief's `PUT /api/authz/shares/{grn}` is **confirmed wrong** — record this in the strategy doc.

### EntityShareResponse — the DTO the fixture pins
```json
// Source: org/graylog/security/shares/EntityShareResponse.java (7.2 clone).
// Phase 8 captures the LIVE 7.0.6 equivalent; treat synced_entities as
// possibly-absent on 7.0.6 (Pitfall 5).
{
  "entity": "grn::::stream:000000000001",
  "sharing_user": "grn::::user:adminUserId",
  "available_grantees": [
    { "id": "grn::::user:54e3...0001", "type": "user", "title": "alice" },
    { "id": "grn::::builtin-team:everyone", "type": "global", "title": "Everyone" }
  ],
  "available_capabilities": [
    { "id": "view", "title": "Viewer" },
    { "id": "manage", "title": "Manager" },
    { "id": "own", "title": "Owner" }
  ],
  "active_shares": [
    { "grant": "grantId123", "grantee": "grn::::user:54e3...0001", "capability": "view" }
  ],
  "selected_grantee_capabilities": { "grn::::user:54e3...0001": "view" },
  "missing_permissions_on_dependencies": {},
  "synced_entities": [],
  "validation_result": { "errors": {}, "failed": false }
}
```
`[CITED: .planning/research/FEATURES.md §"EntityShareResponse"]`.

### Capability enum (schemas.js)
```javascript
// src/tools/authz/schemas.js
import { z } from "zod";
// Source: org/graylog/security/Capability.java — exactly 3 lowercase values.
// No read/write/admin aliases. Default to least privilege.
export const Capability = z.enum(["view", "manage", "own"]);
```
`[CITED: source-code/.../Capability.java]` via FEATURES.md §"Capability enum".

### Byte-identity test for the hash wrapper (cascade-hash.test.js)
```javascript
// Append to test/cascade-hash.test.js — mirror the computeNotificationCascadeHash
// frozen-fixture tests (lines 350-386).
test("computeShareGrantHash returns the pinned hash for a frozen fixture", () => {
  // Recompute via:
  //   node -e 'import("./src/tools/_shared/cascade-hash.js").then(m =>
  //     console.log(m.computeShareGrantHash({
  //       entityGrn:"grn::::stream:000000000001",
  //       grants:[{grantee:"grn::::user:b",capability:"view"},
  //               {grantee:"grn::::user:a",capability:"own"}]
  //     })))'
  const hash = computeShareGrantHash({
    entityGrn: "grn::::stream:000000000001",
    grants: [
      { grantee: "grn::::user:b", capability: "view" },
      { grantee: "grn::::user:a", capability: "own" },
    ],
  });
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, "<PIN THE 64-HEX LITERAL AFTER FIRST RUN>");
});
test("computeShareGrantHash is grant-order independent", () => {
  const a = computeShareGrantHash({ entityGrn: "grn::::stream:s1",
    grants: [{ grantee: "g2", capability: "view" }, { grantee: "g1", capability: "own" }] });
  const b = computeShareGrantHash({ entityGrn: "grn::::stream:s1",
    grants: [{ grantee: "g1", capability: "own" }, { grantee: "g2", capability: "view" }] });
  assert.equal(a, b);
});
```
`[VERIFIED: codebase]` test discipline from `test/cascade-hash.test.js`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Milestone brief: `PUT /api/authz/shares/{grn}` | `POST /api/authz/shares/entities/{entityGRN}` (+ `/prepare`) | Confirmed by 7.2 source diff vs 7.0.6 tag | Phase 8 verifies the corrected path live and records the brief's path as wrong. `[CITED: SUMMARY.md]` |
| Inline GRN string building | Centralized `buildGrn`/`parseGrn` helper | This milestone | One helper; dashboards/searches generalize for free in Phase 10. |

**Deprecated/outdated:**
- The brief's `PUT` path — superseded by `POST .../entities/{grn}`. Phase 8 records the correction.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The 6-token form `grn::::stream:<id>` (4 colons after `grn`) is the canonical GRN, not the 7-token `grn:::::...` form. | Pattern 2 / Pitfall 2 | LOW — `GRN.parse` requires *exactly 6* tokens (source-cited); the 7-token form in ARCHITECTURE.md is a typo. Confirmed by success-criterion wording "6-token". |
| A2 | `GRN_TYPES` restricted to 6 types (`stream`/`dashboard`/`search`/`user`/`builtin-team`/`role`) is sufficient for the whole milestone. | Pattern 2 | LOW — REQUIREMENTS.md "Out of Scope" pins the GRN-type enum to `stream`/`dashboard`/`search`/`user`; `builtin-team` and `role` are needed for grantee/Phase 11. A wider set risks accepting a type 7.0.6 rejects (Pitfall 6). |
| A3 | The live `test` instance has at least one existing stream whose id can seed the `/prepare` probe. | Pattern 4 | LOW — the `test` connection is real production Graylog with existing streams; the probe reads, never creates. The plan should let the recon task discover a stream id via the existing `list_streams` tool rather than hardcoding. |
| A4 | `computeShareGrantHash` is a standalone canonical form, NOT a forward into `computeCascadeHash`. | Pattern 3 / Open Q1 | MEDIUM — ARCHITECTURE.md recommends standalone; but Phase 10 (the consumer) is what truly locks the canonical shape. If Phase 10 needs a different grant representation, the pinned byte-identity must change. Flag for plan-time confirmation. |
| A5 | Role-endpoint live verification is deferred to Phase 11; Phase 8's AUTHZ-02 scope is the entity-shares surface + GRN format only. | Phase Requirements | LOW — REQUIREMENTS.md cross-cutting note explicitly splits AUTHZ-02 verification across phases; Phase 8 success criteria mention only the `prepare`/entity endpoint. |

## Open Questions

1. **`computeShareGrantHash` — standalone canonical form vs forward into `computeCascadeHash`?**
   - What we know: ARCHITECTURE.md §"Token shape" recommends a dedicated canonical form because the keyed-bucket shape is stream-cascade-specific. Phases 4/5 wrappers (`computeRuleCascadeHash`, `computeNotificationCascadeHash`) all *forward* — this one would break that uniformity.
   - What's unclear: whether breaking the forwarding uniformity is acceptable, or whether the planner prefers shoehorning grants into a bucket.
   - Recommendation: Build it standalone per ARCHITECTURE.md (the example in Pattern 3). Document the deviation from the forwarding wrappers in the file comment so a future reader is not surprised.

2. **GRN canonical form — confirm 6-token `grn::::<type>:<id>`.**
   - What we know: `GRN.parse` requires exactly 6 tokens; FEATURES.md uses the 4-empty-colon form; ARCHITECTURE.md text contradicts itself with a 5-empty-colon mention.
   - What's unclear: nothing material — A1 resolves it — but the plan should make "6-token, lowercased" an explicit task acceptance assertion so the contradiction cannot resurface.
   - Recommendation: Lock 6-token. Make round-trip + lowercasing unit-tested gates.

3. **Live recon: a throwaway `scripts/` probe script, or a fixture-generating test?**
   - What we know: `test/fixtures/` already holds 7.0.6 fixtures (`type-catalogue-7.0.6.json`). The recon needs a real network call against the `test` connection — `npm test` runs offline by default.
   - What's unclear: whether the planner wants the capture as a one-shot script (run once, commit the JSON) or a network-gated test (skipped unless a live-cluster env flag is set).
   - Recommendation: One-shot probe script under `scripts/` (e.g. `scripts/capture-authz-prepare-fixture.js`), run manually, output committed to `test/fixtures/authz/`. Then a normal offline test asserts the committed fixture's shape. This matches the v3.0.0 precedent where live-mutation tests were deferred to manual UAT and the bulk of the suite runs offline against fixtures (`v7-read-tool-smoke.test.js` D-06/D-07).

4. **Where does the "live-production test strategy" document live?**
   - What we know: Success criterion #5 requires it documented "before any apply handler is written" — i.e. in Phase 8.
   - What's unclear: file location — a section in this RESEARCH.md, a standalone `.planning/phases/08-.../TEST-STRATEGY.md`, or a doc-comment block.
   - Recommendation: A dedicated short markdown doc in the phase folder (committed — `commit_docs: true`), so Phases 9/10/11 can link to it. The Validation Architecture section below is its technical core.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All tasks | ✓ (assumed — project runtime) | ≥ 22.3.0 (`package.json` engines) | — |
| `zod` | `schemas.js` | ✓ | 3.25.76 | — |
| `axios` | live `/prepare` probe | ✓ | 1.12.2 | — |
| Live Graylog `test` connection | the one recon task (fixture capture) | ✓ (live UNESCO production, `http://<graylog-host>`, Graylog 7.0.6) | 7.0.6 | If unreachable at plan-execution time: hand-build the fixture from 7.2 source as a **provisional** fixture, mark it clearly, and gate Phase 9 on a real capture. The probe is read-only so reachability is the only risk. |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** The live `test` instance — fallback is a provisional source-derived fixture, but this re-opens Pitfall 5, so the real capture is strongly preferred and AUTHZ-02 effectively requires it.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (Node ≥ 22.3.0 built-in) + `node:assert/strict` |
| Config file | none — test discovery is the glob in `package.json` |
| Quick run command | `node --test test/authz-grn.test.js test/cascade-hash.test.js` |
| Full suite command | `npm test` (`node --test 'test/**/*.test.js'`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTHZ-02 (GRN format) | `buildGrn`/`parseGrn`/`isGrn` round-trip a valid 6-token lowercased GRN | unit | `node --test test/authz-grn.test.js` | ❌ Wave 0 |
| AUTHZ-02 (GRN format) | Unknown type rejected client-side with the valid-type set in the message | unit | `node --test test/authz-grn.test.js` | ❌ Wave 0 |
| AUTHZ-02 (scaffold) | `Capability` enum is exactly `view`/`manage`/`own`; rejects other strings | unit | `node --test test/authz-grn.test.js` | ❌ Wave 0 |
| AUTHZ-02 (scaffold) | `import "./authz/index.js"` is wired in `_register.js`; barrel loads without error | integration | `node --test test/dispatch.test.js` (existing `assertAllToolsRegistered`) | ✅ (existing) |
| AUTHZ-02 (hash) | `computeShareGrantHash` byte-identity pinned + grant-order independence | unit | `node --test test/cascade-hash.test.js` | ✅ (extend) |
| AUTHZ-02 (live recon) | Captured 7.0.6 `prepare` fixture exists and has the expected `EntityShareResponse` keys | unit (offline, fixture-shape) | `node --test test/authz-grn.test.js` (or a fixture test) | ❌ Wave 0 |
| AUTHZ-02 (live recon) | The corrected `POST .../entities/{GRN}/prepare` path verified against the live `test` instance | manual / live-gated | one-shot `scripts/capture-authz-prepare-fixture.js` run | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test test/authz-grn.test.js test/cascade-hash.test.js` (the two files this phase touches).
- **Per wave merge:** `npm test` — full suite green; confirms `_register.js` edit broke nothing.
- **Phase gate:** Full suite green + the live fixture captured and committed, before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `test/authz-grn.test.js` — unit tests for `grn-helpers.js` (round-trip, unknown-type rejection, lowercasing, `isGrn` predicate) and `schemas.js` (`Capability` enum). Covers AUTHZ-02 GRN-format criteria.
- [ ] `test/cascade-hash.test.js` — **extend** with `computeShareGrantHash` byte-identity + order-independence tests (file exists; add tests).
- [ ] `test/fixtures/authz/prepare-response-7.0.6.json` — the captured live fixture (a data file, not a test, but a Wave 0 deliverable).
- [ ] `scripts/capture-authz-prepare-fixture.js` — the one-shot live probe script (see Open Questions Q3).
- [ ] No framework install needed — `node:test` is built in.

## Security Domain

> `security_enforcement` is not explicitly `false` in `.planning/config.json` — treat as enabled. Phase 8 is scaffolding (no agent-facing mutation, no auth decision made by MCP code), so the applicable surface is narrow.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No new auth concept — the recon probe reuses the existing connection-registry API token (CLAUDE.md: "No new auth concepts"). |
| V3 Session Management | no | Stateless tool surface; no sessions. |
| V4 Access Control | indirect | Phase 8 builds *no* access-control decision into code, but lays the GRN foundation for it. Graylog enforces all authz server-side; insufficient permissions surface as upstream 403 (CLAUDE.md). |
| V5 Input Validation | yes | `zod` `Capability` enum + `buildGrn` type validation reject malformed input client-side before it reaches Graylog. |
| V6 Cryptography | yes | sha-256 confirmation hash via `node:crypto` — never hand-rolled; reuses the `cascade-hash.js` primitive. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Recon probe accidentally mutates production grants | Tampering | Only `POST .../prepare` (`@NoAuditEvent`) is called; empty body; verification asserts the `/prepare` suffix. The commit endpoint is forbidden this phase. |
| Malformed GRN injected into a request path | Tampering / injection | `buildGrn` validates the type against `GRN_TYPES`; `encodeURIComponent` neutralizes path-segment colon abuse. |
| Confirmation-token canonical-form drift weakening drift refusal (downstream Phase 10) | Tampering (TOCTOU) | Byte-identity of `computeShareGrantHash` pinned in `test/cascade-hash.test.js` so any canonical-form change fails loudly. |
| Capability privilege confusion (`own` vs `view`) | Elevation of Privilege | Enum pinned to exactly `view`/`manage`/`own`; downstream tools default to least privilege (`view`). |
| Fixture captured from a 7.2-derived source instead of live 7.0.6 → wrong wire shape trusted | Spoofing (of API contract) | Fixture must be a verbatim live capture with a provenance note (instance + date); Pitfall 5. |

## Sources

### Primary (HIGH confidence)
- `.planning/research/FEATURES.md` — endpoint reference, GRN grammar, `EntityShareResponse`/`Capability` DTO shapes (all source-cited to the Graylog clone).
- `.planning/research/ARCHITECTURE.md` — GRN helper placement decision, `computeShareGrantHash` token shape, domain-wiring (four mechanical edits), build order.
- `.planning/research/PITFALLS.md` — Pitfalls 2 (GRN malformation), 6 (7.0.6-vs-7.2 divergence), 8 (live-production test discipline).
- `.planning/research/SUMMARY.md` — milestone synthesis; the `PUT`→`POST` endpoint correction; Phase 0 (= Phase 8) deliverables list.
- Codebase (`[VERIFIED]`): `src/tools/_shared/cascade-hash.js`, `test/cascade-hash.test.js`, `src/tools/pipelines/index.js` + `schemas.js` + `get-pipeline.js` + `connect-pipelines-to-stream.js`, `src/tools/_register.js`, `src/tools/_shared/schemas.js`, `src/graylog/client.js`, `test/v7-read-tool-smoke.test.js`, `package.json`.
- `CLAUDE.md` — zero-new-dependency / `zod` / per-domain `src/tools/<domain>/` constraints.
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md` — Phase 8 scope, success criteria, AUTHZ-02 mapping.

### Secondary (MEDIUM confidence)
- The 7.2.0-SNAPSHOT source clone (`source-code/graylog2-server/`) — forward-compat reference for DTO shapes; the live 7.0.6 capture is the authority that supersedes it for the fixture (Pitfall 5).

### Tertiary (LOW confidence / needs live verification)
- `synced_entities` field presence in the 7.0.6 `EntityShareResponse` — unverified until the Phase 8 live `/prepare` capture; treat as `.optional()` downstream regardless.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps, all reused, confirmed against `package.json` and codebase.
- Architecture / patterns: HIGH — every pattern maps to a verified existing file precedent; the milestone research already source-cited the authz surface.
- Pitfalls: HIGH — drawn directly from source-verified PITFALLS.md; the one live gap (`synced_entities` on 7.0.6) is explicitly the thing Phase 8's recon task closes.
- One MEDIUM assumption (A4 — the `computeShareGrantHash` canonical form is truly locked only when Phase 10 consumes it).

**Research date:** 2026-05-19
**Valid until:** 2026-06-18 (stable — internal codebase patterns + a pinned single-target Graylog version; 30-day window).
