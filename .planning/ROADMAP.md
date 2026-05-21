# Roadmap: Graylog MCP — Full Admin Surface

## Milestones

- ✅ **v3.0.0 Full Admin Surface** — Phases 0-7 (shipped 2026-05-16) — [archive](milestones/v3.0.0-ROADMAP.md)
- 🚧 **v3.1.0 AuthZ & Sharing** — Phases 8-11 (in progress)

## Phases

<details>
<summary>✅ v3.0.0 Full Admin Surface (Phases 0-7) — SHIPPED 2026-05-16</summary>

- [x] Phase 0: Foundation (6/6 plans) — completed 2026-05-13
- [x] Phase 1: Inputs & Extractors (5/5 plans) — completed 2026-05-13
- [x] Phase 2: Index Sets & Retention (5/5 plans) — completed 2026-05-14
- [x] Phase 3: Streams & Stream Rules (5/5 plans) — completed 2026-05-14
- [x] Phase 4: Pipelines, Pipeline Rules & Connections (6/6 plans) — completed 2026-05-15
- [x] Phase 5: Events & Notifications (5/5 plans) — completed 2026-05-15
- [x] Phase 6: Dashboards, Widget Templates & Blueprints (6/6 plans) — completed 2026-05-16
- [x] Phase 7: Final Hardening (3/3 plans) — completed 2026-05-16

Full phase-by-phase narrative archived to `.planning/milestones/v3.0.0-ROADMAP.md`.

</details>

### 🚧 v3.1.0 AuthZ & Sharing (In Progress)

**Milestone Goal:** Add the authorization layer to the Graylog MCP — let an AI agent grant users access to entities (streams, dashboards, saved searches) and manage roles, safely, without touching the web UI. Reverses v3.0.0's "users/roles out of scope" exclusion (narrowed, not lifted: entity-sharing + role assignment only, no user-account CRUD).

The journey is strictly dependency-ordered. A correct GRN and the *corrected* endpoint (`POST /api/authz/shares/entities/{entityGRN}`, not the brief's wrong `PUT`) underpin everything, so Phase 8 builds the GRN helper and verifies the live 7.0.6 surface before any handler exists. The non-mutating read path (Phase 9) ships next — it de-risks `prepare`-response parsing at zero blast radius before that parsing becomes load-bearing inside the write path. Phase 10 is the headline: `share_entity` as a mandatory read-merge-write with the full v3.0.0 safety stack (dry-run, confirmation token, drift refusal). Role management (Phase 11) trails as an independent track — roles share no code path with entity grants.

- [x] **Phase 8: AuthZ Foundation — GRN Helper & Live API Recon** - Build the GRN abstraction, capture live 7.0.6 endpoint/response fixtures, and scaffold the `authz` domain (completed 2026-05-19)
- [x] **Phase 9: Entity Shares Read Path** - `get_entity_shares` and `list_grantees` — see an entity's current grants and resolvable grantees at zero blast radius (completed 2026-05-19)
- [x] **Phase 10: Entity Sharing Write Path** - `share_entity` (streams, dashboards, saved searches) with read-merge-write, dry-run, confirmation token, drift refusal, and revoke (completed 2026-05-20)
- [ ] **Phase 11: Role Management** - `list_roles` / `create_role` / `update_role` / `delete_role` / `assign_role` / `unassign_role` with built-in-role protection

## Phase Details

### Phase 8: AuthZ Foundation — GRN Helper & Live API Recon

**Goal**: The GRN abstraction exists, is unit-tested, and the live Graylog 7.0.6 authz surface is captured as fixtures so every later phase builds on verified endpoint shapes — not on the milestone brief's wrong `PUT` path or the two-minors-ahead 7.2 source clone.
**Depends on**: Phase 7 (v3.0.0 — provides `defineMutatingHandler`, `cascade-hash.js`, `_register.js` barrel, per-domain `src/tools/<domain>/` pattern)
**Requirements**: AUTHZ-02
**Success Criteria** (what must be TRUE):

  1. `buildGrn(type, id)` produces a valid 6-token lowercased GRN and `parseGrn`/`isGrn` round-trip it; an unknown type (`saved_search`, `event_notification`, `team`) is rejected client-side with a message listing the valid type set
  2. The `authz` domain is wired in — `src/tools/authz/index.js` barrel exists, `src/tools/_register.js` imports it, and `src/tools/authz/schemas.js` exposes a `Capability` enum pinned to exactly `view`/`manage`/`own`
  3. A captured real 7.0.6 `prepare` response fixture exists, and the corrected endpoint `POST /api/authz/shares/entities/{entityGRN}` (apply) + `.../prepare` (dry-run) is verified against the live `test` instance — the brief's `PUT /api/authz/shares/{grn}` is confirmed wrong and recorded as such
  4. `computeShareGrantHash({ entityGrn, grants })` is added to `src/tools/_shared/cascade-hash.js` with its byte-identity pinned in `test/cascade-hash.test.js`
  5. The live-production test strategy is documented — `dryRun: true` default, throwaway-entity + dedicated test-user harness, never `builtin-team:everyone` — before any apply handler is written

**Plans**: 3 plans
Plans:

- [x] 08-01-PLAN.md — GRN helper + Capability enum + empty authz barrel wired into `_register.js`, unit-tested (Wave 1)
- [x] 08-02-PLAN.md — `computeShareGrantHash` standalone canonical-form hash added to `cascade-hash.js`, byte-identity pinned (Wave 1)
- [x] 08-03-PLAN.md — live 7.0.6 `/prepare` recon probe + captured fixture + `08-TEST-STRATEGY.md` (Wave 2)

### Phase 9: Entity Shares Read Path

**Goal**: An agent can read an entity's current grant set and discover who it can be shared with — a non-mutating, immediately live-testable capability that de-risks `prepare`-response parsing before that parsing becomes load-bearing in the write path.
**Depends on**: Phase 8
**Requirements**: SHARE-02, SHARE-09
**Success Criteria** (what must be TRUE):

  1. `get_entity_shares` returns an entity's current `active_shares` (grantee + capability) by calling `POST .../entities/{grn}/prepare` with an empty body — and works for stream, dashboard, and search entity types
  2. `list_grantees` returns the resolvable users/teams for an entity, derived from the `available_grantees` table in the `prepare` response, so an agent can map a username to the user-GRN the API requires
  3. The read handler surfaces the full nested `EntityShareResponse` DTO (active_shares, available_grantees, available_capabilities) without flattening — it uses a plain async handler, not the list-projection factory
  4. Both tools are smoke-tested non-mutatingly against the live `test` instance and verified against the Phase 8 fixtures offline

**Plans**: 2 plans
Plans:

- [x] 09-01-PLAN.md — Wave 0 offline tests + zod schemas + shared fetch helper + `get_entity_shares` & `list_grantees` handlers + barrel/`tools.js` wiring (Wave 1)
- [x] 09-02-PLAN.md — live non-mutating `/prepare`-only smoke check against the production `test` connection (Wave 2)

### Phase 10: Entity Sharing Write Path

**Goal**: An agent can grant, change, and revoke a user's access to a stream, dashboard, or saved search through one `share_entity` tool — and the tool can never silently revoke another user's access, never apply on stale state, and never apply without an explicit confirmation token.
**Depends on**: Phase 9
**Requirements**: SHARE-01, SHARE-03, SHARE-04, SHARE-05, SHARE-06, SHARE-07, SHARE-08, AUTHZ-01
**Success Criteria** (what must be TRUE):

  1. `share_entity` grants a named user a `view`/`manage`/`own` capability on a stream — accepting a username and resolving it to the required user-GRN — and the same tool works for dashboards and saved searches with only the GRN type token changing
  2. Adding a grantee never revokes existing grantees: an acceptance-gate test proves that sharing to user C, when users A and B already hold grants, produces an apply body containing all three (read-merge-write, not blind write)
  3. An agent can revoke a user's access (re-POST the merged grant set minus that grantee), and the dry-run output explicitly diffs grants added, unchanged, and would-be-removed
  4. `share_entity` defaults to `dryRun: true`, returns a sha-256 confirmation token over the merged grant set, refuses apply with `grants_changed_since_preview` when the live grant set drifted, and refuses apply on confirmation-token mismatch
  5. Graylog's `validation_result` and `missing_permissions_on_dependencies` are surfaced as structured output (including the HTTP 400-with-body case), a non-owner attempt yields an ownership-specific error, and a request that would drop the last `own` grant is refused

**Plans**: 3 plans
Plans:

- [x] 10-01-PLAN.md — Wave 0 offline test scaffold (16 tests incl. MANDATORY Pitfall-1 acceptance gate) + ShareEntitySchema with XOR/refine validators (Wave 1)
- [x] 10-02-PLAN.md — share-entity.js handler (defineMutatingHandler composition: read-merge-write via fetchEntitySharePreview, computeShareGrantHash token, last-own guard, 400-with-body parser, 403 → not_entity_owner) + authz barrel/tools.js/DOMAIN_OVERRIDES wiring + tool count 93→94 (Wave 2)
- [x] 10-03-PLAN.md — opt-in dryRun-only live smoke probe + human-verify checkpoint for throwaway-entity full-apply UAT (Wave 3)

### Phase 11: Role Management

**Goal**: An agent can inspect, create, modify, delete, and assign Graylog roles — the coarse-grained global permission layer — as an independent track from entity sharing, with built-in roles protected from mutation.
**Depends on**: Phase 8
**Requirements**: ROLE-01, ROLE-02, ROLE-03, ROLE-04, ROLE-05, ROLE-06, ROLE-07
**Success Criteria** (what must be TRUE):

  1. `list_roles` returns all roles with their permission sets, and an agent can read a single role's permissions
  2. An agent can create a custom role with a named permission set (`create_role`), update its permissions and description (`update_role`), and delete it (`delete_role`)
  3. An agent can assign a user to a role (`assign_role`) and unassign a user from a role (`unassign_role`), keyed by role name + username
  4. The built-in read-only roles (`Admin`, `Reader`) are refused for update/delete client-side with a clear error, before any request reaches Graylog
  5. Every mutating role tool defaults to `dryRun: true`, returns a sha-256 confirmation token, and refuses apply on drift between preview and apply

**Plans**: 3 plans
Plans:
**Wave 1**

- [x] 11-01-PLAN.md — Wave 0 RED scaffold: test/authz-roles.test.js (~30 tests incl. MANDATORY PITFALL 1 update_role full-replace + delete_role cascade preview + assign_role body=={} + unassign_role last-admin guard) + 7 zod schemas + BUILT_IN_ROLES Set + 7 tools.js entries + 7 DOMAIN_OVERRIDES entries + tool-count bumps 94→101 + 5 placeholder fixtures + 7 byte-pin tests for computeRoleCascadeHash (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 11-02-PLAN.md — Handler composition: computeRoleCascadeHash thin wrapper + role-helpers.js (assertRoleIsMutable + tagError + diff + hashing + catalogue validation) + 7 role handlers (list/get/create/update/delete/assign/unassign-role.js via defineMutatingHandler) + barrel registration; replaces 4 PLACEHOLDER cascade-hash digests; turns Wave 0 RED → GREEN; tool count = 101 (Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 11-03-PLAN.md — scripts/capture-roles-fixtures.js (one-shot read-only live capture of 5 fixtures) + test/authz-roles-live.smoke.js (opt-in dryRun-only live probe for the 7 tools) + human-verify checkpoint for throwaway-role full-lifecycle UAT (default per D-24: defer to v3.1.0 milestone close bundled with Phase 10's deferred share_entity UAT) (Wave 3)

## Progress

**Execution Order:**
Phases execute in numeric order: 8 → 9 → 10 → 11

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 0. Foundation | v3.0.0 | 6/6 | Complete | 2026-05-13 |
| 1. Inputs & Extractors | v3.0.0 | 5/5 | Complete | 2026-05-13 |
| 2. Index Sets & Retention | v3.0.0 | 5/5 | Complete | 2026-05-14 |
| 3. Streams & Stream Rules | v3.0.0 | 5/5 | Complete | 2026-05-14 |
| 4. Pipelines & Rules | v3.0.0 | 6/6 | Complete | 2026-05-15 |
| 5. Events & Notifications | v3.0.0 | 5/5 | Complete | 2026-05-15 |
| 6. Dashboards & Blueprints | v3.0.0 | 6/6 | Complete | 2026-05-16 |
| 7. Final Hardening | v3.0.0 | 3/3 | Complete | 2026-05-16 |
| 8. AuthZ Foundation | v3.1.0 | 3/3 | Complete   | 2026-05-19 |
| 9. Entity Shares Read Path | v3.1.0 | 2/2 | Complete   | 2026-05-19 |
| 10. Entity Sharing Write Path | v3.1.0 | 3/3 | Complete    | 2026-05-20 |
| 11. Role Management | v3.1.0 | 2/3 | In Progress|  |
</content>
