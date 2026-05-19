---
phase: 09-entity-shares-read-path
plan: 01
subsystem: authz
tags: [authz, entity-shares, read-path, grn, mcp-tools]
requires:
  - "src/tools/authz/grn-helpers.js (Phase 8 — buildGrn/parseGrn)"
  - "src/tools/authz/schemas.js Capability enum (Phase 8)"
  - "test/fixtures/authz/prepare-response-7.0.6.json (Phase 8 live fixture)"
provides:
  - "get_entity_shares tool (SHARE-02) — full EntityShareResponse DTO"
  - "list_grantees tool (SHARE-09) — available_grantees projection"
  - "fetchEntitySharePreview helper — shared /prepare probe call"
  - "GetEntitySharesSchema / ListGranteesSchema zod read schemas"
  - "non-empty authz register barrel (first time authz ships handlers)"
affects:
  - "src/tools.js (93 tools total, +2)"
  - "list_admin_tools domain inventory (+authz domain)"
tech-stack:
  added: []
  patterns:
    - "plain async read handler (copy of get-pipeline.js), not the list/mutating factory"
    - "POST .../prepare with {} body — the @NoAuditEvent empty-body pure-read contract"
    - "entityGrn-XOR-(entityType,entityId) via zod .refine"
    - "_testConnection seam re-merged from pre-zod raw args"
key-files:
  created:
    - "test/authz-entity-shares.test.js"
    - "src/tools/authz/prepare-share.js"
    - "src/tools/authz/get-entity-shares.js"
    - "src/tools/authz/list-grantees.js"
  modified:
    - "src/tools/authz/schemas.js"
    - "src/tools/authz/index.js"
    - "src/tools.js"
    - "src/tools/meta/list-admin-tools.js"
    - "test/dashboards.test.js"
    - "test/pipelines.test.js"
    - "test/list-admin-tools.test.js"
decisions:
  - "Adopted the optional prepare-share.js fetch helper — both handlers make the identical /prepare call, so factoring removes path-string divergence risk"
  - "authz domain added to list_admin_tools DOMAIN_OVERRIDES (entity-share tool names have no domain-named segment)"
metrics:
  duration: ~6min
  completed: 2026-05-19
---

# Phase 9 Plan 01: Entity Shares Read Path Summary

Two non-mutating MCP tools — `get_entity_shares` (SHARE-02) and `list_grantees` (SHARE-09) — both built on `POST /api/authz/shares/entities/{encodeURIComponent(grn)}/prepare` called with an empty `{}` body, verified offline against the Phase 8 live-7.0.6 fixture.

## What Was Built

- **`test/authz-entity-shares.test.js`** — Wave 0 offline test file (11 tests): request-path encoding (`%3A`, no raw colon, `{}` body), full-DTO surfacing, GRN-type matrix (stream/dashboard/search), grantee projection, malformed-input no-HTTP guard, entityGrn-XOR-(type,id), and HTTP-error propagation. Fixture-replayed through `_setCaptureRequest`; `afterEach` clears the seam.
- **`src/tools/authz/schemas.js`** — added `GetEntitySharesSchema` + `ListGranteesSchema` (plain `z.object`, NOT mutatingBase — read tools have no `dryRun`), `ENTITY_TYPES` enum (stream/dashboard/search subset), entityGrn-XOR-(type,id) `.refine`. `Capability` export untouched.
- **`src/tools/authz/prepare-share.js`** — private `fetchEntitySharePreview(client, entityGrn)` helper: `encodeURIComponent` the GRN, `endsWith("/prepare")` self-guard, `POST` with `{}` body.
- **`src/tools/authz/get-entity-shares.js`** / **`list-grantees.js`** — plain async read handlers copying `get-pipeline.js`: zod-parse → seam re-merge → GRN normalization (before any HTTP call) → `/prepare` fetch → envelope. `get_entity_shares` surfaces the full unflattened `EntityShareResponse` under `entity_shares`; `list_grantees` projects `available_grantees`.
- **`src/tools/authz/index.js`** — barrel goes from empty (Phase 8) to two `register()` calls.
- **`src/tools.js`** — two `{name,description,inputSchema}` defs (no JSON `required[]` — XOR enforced by zod). Total tool surface 91 → 93.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Tool-count assertions stale after adding 2 tools**
- **Found during:** Task 4 (`npm test`)
- **Issue:** `test/dashboards.test.js`, `test/pipelines.test.js`, `test/list-admin-tools.test.js` hardcode the total tool count at 91; adding `get_entity_shares` + `list_grantees` makes 93.
- **Fix:** Updated all four count assertions (91 → 93) with Phase 9 explanatory comments.
- **Commit:** 2b2c194

**2. [Rule 1 - Bug] get_entity_shares description exceeded the 200-char audit budget**
- **Found during:** Task 4 (`tool-description-audit.test.js`)
- **Issue:** Initial description was 364 chars; `audit-tool-descriptions.js` enforces a 200-char `DESCRIPTION_BUDGET` (Pitfall M7).
- **Fix:** Trimmed to 197 chars while retaining the required `active_shares` substring and the "excludes your own grant" note.
- **Commit:** 2b2c194

**3. [Rule 2 - Missing critical functionality] authz domain absent from list_admin_tools categorization**
- **Found during:** Task 4
- **Issue:** `get_entity_shares` / `list_grantees` have no domain-named segment, so `inferDomain()` would route them to `uncategorized` — violating the `list_admin_tools` zero-uncategorized hard-guard invariant.
- **Fix:** Added both names to `DOMAIN_OVERRIDES` as `authz`; added `authz` to the test's `KNOWN_DOMAINS`.
- **Commit:** 2b2c194

## Comment-Token Adjustment

`get-entity-shares.js` / `list-grantees.js` comments originally spelled out the literal tokens `defineListHandler` / `defineMutatingHandler`; rephrased so the Task 3 acceptance grep (`grep -c` expecting 0) is satisfied by source content, not just imports.

## Authentication Gates

None.

## Verification

- `npm test` — 1131/1131 pass (full offline suite, including the new 11-test file).
- `node --test test/authz-entity-shares.test.js` — 11/11 pass: request path is `POST .../entities/{encoded-grn}/prepare`, body `{}`; full DTO unflattened; `list_grantees` projects `available_grantees`; malformed GRN → clean error, no HTTP call; XOR violations rejected; error propagation embeds the tool name.
- `assertAllToolsRegistered` passes at startup (93 tools, every def has a handler).
- No file in `src/tools/authz/` contains `PUT`, the commit endpoint path, or the list/mutating factory imports.

## Known Stubs

None.

## TDD Gate Compliance

Tasks 2 and 3 were `tdd="true"`. The RED gate is the Task 1 `test(09-01)` commit (5b9377d — the failing Wave 0 test file). The GREEN gates are the `feat(09-01)` commits d025b9c (schemas + helper) and 9e2a52c (handlers — turns the test file green). Gate sequence test → feat is present in git log.

## Self-Check: PASSED

- FOUND: test/authz-entity-shares.test.js
- FOUND: src/tools/authz/prepare-share.js
- FOUND: src/tools/authz/get-entity-shares.js
- FOUND: src/tools/authz/list-grantees.js
- FOUND: commit 5b9377d, d025b9c, 9e2a52c, 2b2c194
