# Project Research Summary

**Project:** Graylog MCP — v3.1.0 AuthZ & Sharing
**Domain:** Authorization & entity-sharing tool surface (additive on v3.0.0 admin surface)
**Researched:** 2026-05-19
**Confidence:** HIGH

## Executive Summary

The v3.1.0 milestone adds the authorization layer to the Graylog MCP: letting an agent grant users access to entities (streams, dashboards, saved searches) and manage roles. The research converged on one structural insight that must propagate everywhere in the plan: **the milestone brief's endpoint `PUT /api/authz/shares/{grn}` is wrong.** The real surface, confirmed by reading `EntitySharesResource.java` directly, is `POST /api/authz/shares/entities/{entityGRN}` (apply) and `POST /api/authz/shares/entities/{entityGRN}/prepare` (dry-run preview). Every route, test, and tool-description in the plan must use these corrected paths, and must verify them against the live 7.0.6 instance before any handler is written.

The headline design challenge is **grant-set replacement semantics**: the apply endpoint is a full replace, not an additive merge. Posting `{newUser: view}` silently deletes every other user's grant. `share_entity` is therefore mandatory read-merge-write — a precedent the codebase already ships for pipeline-to-stream connections (`connect_pipelines_to_stream`'s GET-merge-POST pattern). The natural dry-run vehicle is Graylog's own `/prepare` endpoint (`@NoAuditEvent`, returns `active_shares` + `validation_result` + `missing_permissions_on_dependencies` without mutating). The existing local sha-256 confirmation token (`cascade-hash.js`) is complementary, not replaced by `/prepare`: Graylog provides feasibility and current state; the local token provides TOCTOU drift refusal. Both are required and serve different jobs.

The stack needs zero new dependencies. `axios` + `zod` + `node:crypto` + `node:test`/`c8` cover everything. New code lands in `src/tools/authz/` following the identical per-domain pattern of `src/tools/pipelines/`. The recommended build order — GRN helper, `get_entity_shares` (read), `share_entity` (write, streams), generalize to dashboards/searches, role tools — reflects hard dependency ordering and blast-radius sequencing. The entity-sharing surface changes who can read production logs; the `test` connection is live production UNESCO infrastructure; no automated test may apply a grant to a real stream or real user.

## Key Findings

### Recommended Stack

Zero new dependencies for v3.1.0. All required capability is already installed. The existing `@modelcontextprotocol/sdk`, `axios`, `zod`, `node:crypto`, and `node:test`/`c8` stack fully covers GRN string work (a plain `split(":")`/`join(":")` with `zod` validation), the authz/shares and roles REST surface (plain JSON over HTTP Basic), test interception (the `_setCaptureRequest` seam in `src/graylog/client.js`), and confirmation-token hashing (reuse `computeCascadeHash` from `src/tools/_shared/cascade-hash.js`). If a PR adds a dependency, treat it as a red flag.

**Core technologies:**
- `axios` ^1.12.2: HTTP client for all authz/roles calls — covers JSON, HTTP Basic, error classification (403 to `GraylogPermissionError`). Route every call through `makeClient(conn).request()`.
- `zod` ^3.25.76: GRN string validation (`.regex()`/`.refine()`), `Capability` enum (`z.enum(["view","manage","own"])`), grantee-map and role-payload schemas, extending the existing `mutatingBase` in `src/tools/_shared/schemas.js`.
- `node:crypto` (built-in): sha-256 confirmation token over the dry-run grant set. Reuse `computeCascadeHash` / `computeC1Hash` from `src/tools/_shared/cascade-hash.js`; add a thin `computeShareGrantHash` wrapper following the `computeRuleCascadeHash` pattern.
- `node:test` + `_setCaptureRequest`: network-free request assertions over outbound `POST /api/authz/shares/entities/...` calls.

### Expected Features

**Must have (table stakes):**
- `share_entity` — grant a user a capability on a stream (or dashboard/search). `dryRun:true` calls `/prepare`; `dryRun:false` calls `/entities/{grn}`. Body is the full merged `selected_grantee_capabilities` map, never just the new grant.
- GRN builder/parser util (`src/tools/authz/grn-helpers.js`) — 6-token colon-split, `grn` prefix, lowercase normalization, type validated against the registered set. Prerequisite for every other authz tool; build and unit-test first.
- Username to user-GRN resolution — agents speak usernames; the API needs `grn::::user:<mongoId>`. Resolve by matching `available_grantees[].title` from the `/prepare` response (preferred) or `GET /api/users/{username}`.
- `get_entity_shares` — read current grants for an entity. Call `POST .../prepare` with an empty body, return `active_shares`. Plain async handler, not `defineMutatingHandler` or `defineListHandler`.
- Capability enum validation — exactly `view` / `manage` / `own` (lowercase). `zod` enum at schema-definition time. Default to `view` (least privilege).
- `validation_result` + `missing_permissions_on_dependencies` surfacing — both visible in dry-run and apply output. HTTP 400 on apply carries the full `EntityShareResponse` body; parse it rather than throwing on non-2xx.
- Drift refusal — hash the full current grant set at dry-run; re-prepare and re-hash on apply; refuse with `grants_changed_since_preview` if they diverge.

**Should have (differentiators):**
- Generalize `share_entity` to dashboards and saved searches — only the GRN `type` token changes; the API path is identical. Near-free once the GRN helper is parameterized.
- `create_role` / `assign_role` / `unassign_role` — role CRUD (`POST /api/roles`, `PUT/DELETE /api/roles/{rolename}/members/{username}`). Independent of the entity-share path.
- `list_roles` / `get_role` — read side of role management.
- Revoke path — "unshare alice" = prepare current `active_shares`, drop alice, commit the remainder. Either a `revoke: true` flag on `share_entity` or a sibling `revoke_entity_share` tool.
- Explicit removed-grants diff in dry-run output — "grants that WOULD BE REMOVED" section required for safe human/agent review.

**Defer (v2+):**
- User account CRUD (`create_user`/`delete_user`) — out of scope; account lifecycle is a separate high-risk surface.
- API-token minting — explicitly out of scope; minting long-lived secrets from an agent is a security anti-pattern.
- Team-based grants — Enterprise feature; build the GRN path generically but do not depend on teams existing on the OSS test instance.
- Share-on-create blueprint chaining — chain `share_entity` after `create_stream` in a future blueprint update.
- Lookup tables / content packs / sidecars sharing — out of scope per PROJECT.md.

### Architecture Approach

The authz domain slots into the existing architecture as a new per-domain folder `src/tools/authz/`, identical in structure to `src/tools/pipelines/` and the other 7 admin domains shipped in v3.0.0. Wiring requires exactly four mechanical edits: append tool definitions to `src/tools.js`, add `import "./authz/index.js"` to `src/tools/_register.js`, create the domain barrel `src/tools/authz/index.js`, and add a thin `computeShareGrantHash` wrapper to `src/tools/_shared/cascade-hash.js`. No changes to `src/graylog/client.js`, `src/dispatch.js`, `handler.js`, or any v2.3 read tool.

**Major components:**
1. `src/tools/authz/grn-helpers.js` — pure `buildGrn(type, id)` / `parseGrn(grn)` / `isGrn(value)` functions; `GRN_TYPES` set. Zero I/O; hard prerequisite for all other authz files.
2. `src/tools/authz/get-entity-shares.js` — plain async handler; copy `get-pipeline.js` pattern; calls `POST .../prepare` with empty body, returns `EntityShareResponse`.
3. `src/tools/authz/share-entity.js` — `defineMutatingHandler` with async `build()`: prepare, read `active_shares`, merge, `computeShareGrantHash`, `_confirmationToken`; `requireConfirm` gate; apply with `validation_result` inspection. The `connect_pipelines_to_stream` GET-merge-POST precedent is the direct model.
4. `src/tools/authz/create-role.js` + `assign-role.js` — independent role management tools; `defineMutatingHandler`; `POST /api/roles` and `PUT /api/roles/{rolename}/members/{username}` (send `{}` body on PUT — server requires a non-empty body but ignores content).
5. `src/tools/_shared/cascade-hash.js` (modified) — add `computeShareGrantHash({ entityGrn, grants })` thin wrapper; sha-256 over sorted `[{grantee, capability}]` array; byte-identity pinned in `test/cascade-hash.test.js`.

### Critical Pitfalls

1. **Grant-set replacement silently revokes access** — `POST .../entities/{grn}` is full-replace confirmed by `EntitySharesService.updatePrimaryEntityShares()` source. Naive `{newUser: view}` deletes every other grantee's grant. Avoid by mandatory read-merge-write. Mandate the three-grantee acceptance-gate test (A + B pre-exist, add C, assert all three in POST body).

2. **GRN malformation — wrong type, username vs userId, grantee/target confusion** — Saved-search GRN type is `search` not `saved_search`; event-notification is `notification` not `event_notification`; "Everyone" is `grn::::builtin-team:everyone`. A user grantee GRN uses the Mongo `_id`, not the login name. Avoid by enforcing type set in `buildGrn`; resolve username to userId before building the GRN; keep entity target and grantee structurally distinct in the tool signature.

3. **Self-lockout and ownerless-entity trap** — `checkOwnership` requires `own` on the target (not just `manage`). A request that drops the last `own` grant is refused with HTTP 400 + `validation_result`. Pre-check in dry-run that at least one `own` grant survives. Map 403 to an ownership-specific message, not a generic permission error.

4. **Skipping prepare-response feasibility notices** — `missing_permissions_on_dependencies` and `synced_entities` are easy to drop. Grantee may see an entity but not its backing index set. Apply may mutate more entities than the URL target. Always surface both fields in dry-run and apply output.

5. **TOCTOU drift between prepare and apply** — replacement semantics turn a stale read into a destructive write. Re-call `prepare` on the apply path, recompute `computeShareGrantHash`, refuse with `grants_changed_since_preview` if the hash differs.

6. **Testing apply paths against live production Graylog** — the `test` connection is live UNESCO production. Default every test to `dryRun: true`. Live apply tests use only throwaway entities and a dedicated non-human test user. Never grant to `builtin-team:everyone` in any automated test. All real apply-against-production is gated HUMAN-UAT.

7. **7.0.6 vs 7.2 source divergence** — local source clone is two minors ahead. `synced_entities` field presence, GRN type set size, and `/authz/roles` vs `/roles` surface completeness are unverified on live 7.0.6. Capture a real `prepare` response as a fixture before writing any handler. Treat all `EntityShareResponse` fields as `zod` `.optional()`.

## Implications for Roadmap

### Phase 0: Foundation — Live API Reconnaissance + GRN Scaffold

**Rationale:** Two hard prerequisites must be satisfied before any handler exists: (1) the correct 7.0.6 endpoint shapes must be captured as fixtures — Pitfall 7 means the 7.2 source paths cannot be trusted without live confirmation; and (2) `grn-helpers.js` must be built and unit-tested because it is a hard prerequisite for every subsequent authz file.

**Delivers:**
- Captured 7.0.6 `prepare` + apply response fixtures
- `src/tools/authz/grn-helpers.js` with `buildGrn`, `parseGrn`, `isGrn`, `GRN_TYPES`
- `src/tools/authz/schemas.js` skeleton (zod `Capability` enum, base GRN schema)
- `src/tools/authz/index.js` register barrel + `_register.js` one-line import
- `computeShareGrantHash` wrapper in `src/tools/_shared/cascade-hash.js`
- Unit tests for all of the above (pure functions, zero network)

**Addresses:** GRN helper (table stakes), Capability enum (table stakes)
**Avoids:** Pitfall 2 (GRN malformation), Pitfall 6 (7.0.6 divergence), Pitfall 8 (live-production test strategy established before any apply handler)

### Phase 1: Entity Shares Read Path — `get_entity_shares`

**Rationale:** The read tool is non-mutating (`@NoAuditEvent`), can be smoke-tested against live 7.0.6 immediately, and de-risks `prepare`-response parsing before that same parsing is load-bearing inside `share_entity`'s write path.

**Delivers:**
- `get_entity_shares` tool (`src/tools/authz/get-entity-shares.js`)
- Tool definition in `src/tools.js`, registered in `src/tools/authz/index.js`
- Offline tests using the Phase 0 fixtures
- Live smoke test against the `test` connection (non-mutating)

**Addresses:** Read current grants for an entity (table stakes)
**Avoids:** Anti-pattern of running the grant set through `defineListHandler` (`get-pipeline.js` is the correct precedent)

### Phase 2: Entity Shares Write Path — `share_entity` (Streams)

**Rationale:** The headline tool. Must be built after the read tool because its `build()` calls the same `prepare` endpoint the read tool wraps. The full safety stack must ship with the first commit — read-merge-write, drift refusal, capability validation, dependency notices, removed-grants diff cannot be retrofitted.

**Delivers:**
- `share_entity` tool (`src/tools/authz/share-entity.js`) for entity type `stream`
- Mandatory three-grantee merge acceptance-gate test
- Dry-run output: added grants, unchanged grants, removed grants, `missing_permissions_on_dependencies` warning, `synced_entities` list
- `grants_changed_since_preview` drift-refusal path
- HTTP 400 + `validation_result` body parsing on apply failure
- 403 to ownership-specific error message
- Test that dropping the last `own` grant is refused
- Generalization to `dashboard` and `search` entity types (GRN type token parameterized)

**Addresses:** `share_entity` (table stakes), drift refusal (table stakes), revoke path (should-have), generalize to dashboards/searches (table stakes per PROJECT.md)
**Avoids:** Pitfall 1 (grant-set replacement), Pitfall 3 (self-lockout), Pitfall 4 (dependency notices), Pitfall 5 (capability enum), Pitfall 7 (TOCTOU drift), Pitfall 8 (throwaway-entity harness)
**Uses:** `defineMutatingHandler`, async `build()`, `computeShareGrantHash` — all established by v3.0.0. Direct precedent: `connect_pipelines_to_stream.js` and `delete_index_set.js`.

### Phase 3: Role Management — `create_role`, `assign_role`

**Rationale:** Independent of the entity-share path — roles share no code path with grants, use different endpoints (`/api/roles` vs `/api/authz/shares`), and are username-keyed rather than GRN-keyed. Lower blast radius than entity sharing. Two coexisting role surfaces on 7.0.6 (`/authz/roles` and legacy `/roles`) must be verified on the live instance before coding.

**Delivers:**
- `list_roles` + `get_role` (read path)
- `create_role` (`POST /api/roles`) with `read_only` pre-check (reject mutation of built-in `Admin`/`Reader` client-side)
- `assign_role` / `unassign_role` (`PUT/DELETE /api/roles/{rolename}/members/{username}`, send `{}` body on PUT)
- Tool descriptions distinguishing "grant = per-entity fine-grained" from "role = global coarse-grained"

**Addresses:** Role management (should-have per PROJECT.md)
**Avoids:** `/authz/roles` vs legacy `/roles` confusion (list/assign vs create); `PUT .../members/{username}` placeholder-body quirk

### Phase Ordering Rationale

- Foundation before everything: live fixture capture and the GRN helper are hard prerequisites for every other tool.
- Read before write: `get_entity_shares` de-risks `prepare`-response parsing at zero blast radius before that parsing is load-bearing in `share_entity`.
- Entity-sharing before roles: sharing is the milestone's headline value and higher blast radius; it stays on the critical path.
- Roles trail: fully independent, lower blast radius, two-surface ambiguity requires a targeted live probe.

### Research Flags

**Needs live-instance probe before coding:**
- Phase 0: verify `POST /api/authz/shares/entities/{entityGRN}` path against 7.0.6 (the brief's `PUT` is confirmed wrong by source); capture `prepare` + apply response fixtures; verify `synced_entities` field presence.
- Phase 3: `/authz/roles` vs legacy `/roles` surface completeness on 7.0.6; `PUT .../members/{username}` placeholder-body behaviour.

**Standard patterns — no research phase needed:**
- Phase 1: plain read handler, `get-pipeline.js` precedent, no unknowns.
- Phase 2: `defineMutatingHandler` + async `build()` + `computeCascadeHash` — all v3.0.0-established patterns with direct file precedents.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All source verified: `package.json`, existing client, schemas, hash primitives. Zero new deps confirmed. |
| Features | HIGH | Endpoint shapes and DTO fields read directly from Graylog Java source; `7.0.6` git tag diff confirms parity with 7.2 on all authz/shares/roles paths. |
| Architecture | HIGH | Integration points confirmed against real files in `src/tools/`. Precedents (`connect_pipelines_to_stream`, `get-pipeline.js`, `cascade-hash.js`) all exist and are verified. |
| Pitfalls | HIGH | Grant-set replacement semantics confirmed from `EntitySharesService.updatePrimaryEntityShares()` source code, not inferred. `@NoAuditEvent` on prepare confirmed. `checkOwnership` gate confirmed. |

**Overall confidence:** HIGH — with one bounded gap (7.0.6 vs 7.2 wire shapes) that Phase 0 closes before any handler is written.

### Gaps to Address

- **7.0.6 live endpoint shape verification:** The brief's endpoint is wrong; even the corrected 7.2-source path must be confirmed against the live `test` instance (`http://<graylog-host>`) before Phase 1 coding begins. Specifically: exact path of the apply endpoint, `synced_entities` field presence, the two-role-surface disambiguation (`/authz/roles` vs `/roles`), and the `PUT .../members/{username}` placeholder-body behaviour. Mitigation: Phase 0 makes this an explicit acceptance criterion.

- **GRN path-encoding for URL path segments:** GRNs contain literal `:` characters; JAX-RS path parameter handling of unencoded colons varies by server version and config. The `grn-helpers.js` should percent-encode `:` as `%3A` in URL path segments. Verify against the live instance in Phase 1.

- **`synced_entities` on apply:** If absent in 7.0.6, the tool must not crash on undefined access. Treat as `zod` `.optional().default([])` in the response parser.

- **`/authz/roles` vs `/roles` disambiguation:** Two coexisting role resource paths exist in 7.2 source; which paths 7.0.6 exposes for each operation is unverified. Phase 3 deferred start allows the Phase 0 live probe to resolve this.

## Sources

### Primary (HIGH confidence)
- `source-code/graylog2-server/.../security/rest/EntitySharesResource.java` (7.2 working tree + `git show 7.0.6:` diff) — endpoint paths/methods corrected, `@NoAuditEvent`, `checkOwnership`, 400-with-body behaviour
- `source-code/graylog2-server/.../security/shares/EntitySharesService.java` — full-replace semantics confirmed (`updatePrimaryEntityShares`), ownerless guard, synced-entity propagation
- `source-code/graylog2-server/.../security/shares/EntityShareRequest.java` / `EntityShareResponse.java` — request/response DTO shapes
- `source-code/graylog2-server/.../security/Capability.java` — `view`/`manage`/`own` enum, priority
- `source-code/graylog2-server/.../grn/GRN.java`, `GRNTypes.java`, `GRNRegistry.java` — 6-token GRN format, registered type set, `GLOBAL_USER_GRN`
- `source-code/graylog2-server/.../rest/resources/roles/RolesResource.java` — role CRUD + placeholder-body annotation on members PUT
- `source-code/graylog2-server/.../rest/resources/users/UsersResource.java` — user lookup endpoints
- `source-code/graylog2-server/.../users/RoleServiceImpl.java` — `Admin`/`Reader` built-in roles, `read_only` flag
- `src/tools/pipelines/connect-pipelines-to-stream.js` — GET-merge-POST precedent and Pitfall-2 acceptance gate
- `src/tools/_shared/cascade-hash.js`, `handler.js`, `dry-run.js` — existing safety primitives confirmed reusable
- `src/tools/pipelines/get-pipeline.js` — read-handler pattern for non-list single-DTO responses
- `.planning/PROJECT.md` — constraints, out-of-scope boundaries, live-7.0.6-wins-on-divergence key decision

### Secondary (MEDIUM confidence)
- 7.2-SNAPSHOT source as forward-compat reference — confirmed byte-identical on authz/shares/roles endpoints against the 7.0.6 git tag; LOW risk of divergence on core paths but unverified on `synced_entities` and role-surface completeness

### Tertiary (needs live verification before use)
- Brief's `PUT /api/authz/shares/{grn}` — confirmed WRONG by source; corrected to `POST /api/authz/shares/entities/{entityGRN}`. Must be verified against live 7.0.6 before any handler is written.
- `synced_entities` field in `EntityShareResponse` — present in 7.2 source, unverified in 7.0.6 response shape
- `/authz/roles` vs legacy `/roles` surface completeness on 7.0.6 — unverified; Phase 3 probe required

---
*Research completed: 2026-05-19*
*Ready for roadmap: yes*
