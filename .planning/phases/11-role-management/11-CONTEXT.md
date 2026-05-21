# Phase 11: Role Management - Context

**Gathered:** 2026-05-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship the role-management half of the v3.1.0 AuthZ & Sharing milestone: seven MCP tools that let an AI agent inspect, create, modify, delete, and assign Graylog roles — the coarse-grained global permission layer — as an independent track from entity sharing (Phases 9–10), with built-in roles protected from mutation and the full Phase-10 safety stack (dryRun-default, sha-256 confirmation token, drift refusal, read-merge-write).

**In scope:** `list_roles`, `get_role`, `create_role`, `update_role`, `delete_role`, `assign_role`, `unassign_role` against legacy `/api/roles` on Graylog 7.0.6+. ROLE-01..07 + AUTHZ-01 (safety-stack re-assertion).

**Out of scope:** Pagination on `list_roles` (16 roles on live `test`, well under a page); batch assign/unassign (deferred to v2); role-creation-from-permission-template UX (planner can suggest later); permission-catalogue authoring or extension; `/api/authz/roles` paginated endpoints (legacy `/api/roles` only); the throwaway-role full-mutation HUMAN-UAT (bundled into v3.1.0 milestone close, not the phase gate).

</domain>

<decisions>
## Implementation Decisions

### Permission-string validation
- **D-01:** `create_role` and `update_role` validate every permission string against the live Graylog permission catalogue (`GET /api/system/permissions`). On validation failure refuse with `reason: "unknown_permission"` before any write. Default behavior, not opt-in.
- **D-02:** Validation parses `permission` as `{type}:{action}` or `{type}:{action}:{id}`. The `{type}:{action}` prefix MUST exist in the catalogue. The trailing `:{id}` (if present) is treated as opaque entity data — do NOT validate the entity exists. (Matches how Graylog's permission resolver actually parses them.)
- **D-03:** The wildcard `*` super-permission is accepted in custom-role permission sets, but the dry-run preview MUST surface a prominent `WARNING: role includes wildcard super-permission` line in the response envelope so the agent and reviewer see the blast radius before token-confirm.
- **D-04:** Accept a `permitUnknownPermissions: false` opt-out flag on `create_role` and `update_role` for the rare enterprise-plugin case. Default is `false` (validation enabled). When `true`, skip catalogue validation but still surface the unknown permissions in the dry-run preview under `warnings.unknown_permissions[]` so the agent sees what's being committed.
- **D-05:** Catalogue is fetched on first use per server process and cached in module-scope (no expiry within a session). Connection-scoped — cache is keyed by `(baseUrl, apiToken)` so multi-connection setups don't cross-contaminate. The cache is small (~hundreds of entries) and rarely changes within a session.

### Tool surface
- **D-06:** Ship **seven** tools: `list_roles`, `get_role`, `create_role`, `update_role`, `delete_role`, `assign_role`, `unassign_role`. Bumps total tool count from 94 → 101. `list_admin_tools` DOMAIN_OVERRIDES gets seven new `authz` entries.
- **D-07:** `list_roles` returns the array of role DTOs (`{name, description, permissions, read_only}`) but does NOT include per-role member counts (no N+1 round-trips at list time).
- **D-08:** `get_role(name)` returns one role enriched with its current members array — `{role: {...}, members: [{username, full_name, email}]}`. Member fields are projected, not full `UserSummary` pass-through. This makes `get_role` the natural pre-flight call for `update_role` / `delete_role` / `assign_role` / `unassign_role`.

### assign/unassign API shape
- **D-09:** `assign_role` and `unassign_role` accept exactly one user per call — `{roleName: string, username: string}`. No batch input. Matches success-criterion #3 wording ("a user"), the legacy `/api/roles/{name}/members/{username}` endpoint shape, and Phase 10's one-action-per-call pattern.
- **D-10:** Dry-run preview for `assign_role` shows `{username, current_roles: [...], roles_after_apply: [...], already_member: bool}`. If `already_member: true`, the apply is a no-op but does not refuse — surface `result: "no_change"` in the apply response.
- **D-11:** Dry-run preview for `unassign_role` shows `{username, current_roles: [...], roles_after_apply: [...]}`. If user is not currently a member of the role, refuse with `reason: "not_currently_assigned"` — the agent should call `get_role` or check `current_roles` first.

### Safety stack (carrying forward from Phase 10)
- **D-12:** All four mutating tools (`create_role`, `update_role`, `delete_role`, `assign_role`, `unassign_role`) default to `dryRun: true`. Applying without an explicit `dryRun: false` is a bug. Re-asserts AUTHZ-01.
- **D-13:** Confirmation token via new `computeRoleCascadeHash` wrapper around the v3.0.0 `computeCascadeHash` primitive. Token input includes `tool` so cross-tool replay is impossible (`create_role` token cannot validate against `update_role` apply). Token input includes role identity (`name` for create/update/delete, `roleName + username` for assign/unassign) so cross-role replay fails. Test/cascade-hash.test.js extended with role-specific byte-pinned fixtures.
- **D-14:** Drift refusal on apply for all four mutators. `update_role` token covers `{tool, name, permissions, current_permissions_hash}`; `delete_role` token covers `{tool, name, members_hash}`; `assign_role` / `unassign_role` token covers `{tool, roleName, username, current_user_roles_hash}`. Any change in the live state between dry-run and apply → `confirmation_mismatch`.
- **D-15:** `update_role` is full-replace per Graylog API. Tool MUST do a pre-flight `GET /api/roles/{name}` and read-merge-write the body — agent sends `permissions: [...]` (the new full set), tool sends `{name, description, permissions, read_only: false}` to Graylog. PITFALL 1 acceptance gate from Phase 10 applies verbatim: current=[A,B] add C → body=[A,B,C] (not [C]).
- **D-16:** `delete_role` dry-run preview MUST surface `cascades.users_dissociated: [{username, roles_before, roles_after}]` (projected — not full `UserSummary`). Server cascade-dissociates all members before deleting; agent must see what's about to happen. Drift refusal on member-list change.
- **D-17:** **Last-admin guard** in `unassign_role.build()` — refuse with `reason: "would_leave_no_admin"` if removing this user from this role would leave zero users in the `Admin` built-in role (prevents instance lockout). Pre-flight `GET /api/roles/Admin/members` to count. Belt-and-braces — server has no equivalent guard.
- **D-18:** `assertRoleIsMutable(roleName)` client-side refusal layer using a static `BUILT_IN_ROLES` set built from the live captured fixture (16 names — `Admin`, `Reader`, `Manager`, `Dashboard Reader`, `MCP Server Access`, plus 11 others — see RESEARCH.md §Built-in Roles). Case-insensitive comparison (matches Graylog's `RoleService.delete` JavaDoc). Reason tag: `builtin_role_immutable`. Applied to `update_role` and `delete_role` only — assign/unassign of users TO built-in roles is legitimate.
- **D-19:** Server-side `read_only` flag from the pre-flight GET response is the AUTHORITATIVE refusal — the static `BUILT_IN_ROLES` set is a fast-path so the GET happens only when the static check passes. Belt + braces.
- **D-20:** Writable-flag short-circuit at handler step 3 (before `build()` runs): if `conn.writable === false`, refuse with `reason: "connection_read_only"`. Same pattern as Phase 10. `_testConnection` accepts inline-object form (extended in Phase 10) for Wave 0 tests that exercise this branch without registering a connection.

### Test strategy (carrying forward from Phase 10)
- **D-21:** Wave 0 RED scaffold pattern: ship `test/authz-roles.test.js` BEFORE handlers, so failing tests are the executable specification the handlers must satisfy. Mirrors Plan 10-01 → 10-02 progression. Estimated ~35 tests.
- **D-22:** Live fixtures captured by `scripts/capture-roles-fixtures.js` (one-shot, gated, read-only): `test/fixtures/authz/roles/list-roles-7.0.6.json`, `get-role-admin-7.0.6.json`, `get-role-members-reader-7.0.6.json`, `user-roles-admin-7.0.6.json`. Fixture-replay used for all offline tests via the `_setCaptureRequest` seam from Phase 10.
- **D-23:** No `await_system_job` integration — Graylog's `RoleService.save` and `delete` are synchronous. Apply returns when the HTTP 200/204 returns.

### Phase verification gate (D-24)
- **D-24:** Phase 11 closes when:
  1. Offline test suite green (`npm test`)
  2. `scripts/capture-roles-fixtures.js` runs successfully against the live `test` connection (one-shot read-only fixture capture)
  3. A dryRun-only smoke probe exercises each of the seven tools against the live `test` connection (read or dryRun=true; no actual mutations)
  4. `share_entity` throwaway-entity full-apply UAT (Phase 10 deferred) AND a Phase 11 throwaway-role full-lifecycle UAT (create custom role → update permissions → assign dedicated test user → unassign → delete) are bundled into a single HUMAN-UAT checkpoint at v3.1.0 milestone close. NOT a Phase 11 gate.

### Claude's Discretion
The researcher's recommendations on these open questions are adopted as defaults; the planner can refine without checking back:
- Q4 (member count in list_roles): omit, per D-07.
- Q5 (cascade preview shape): projected `{username, roles_before, roles_after}`, per D-16. Matches Phase 10's `diff` projection convention rather than full-DTO pass-through.
- Q6 (BUILT_IN_ROLES source): hybrid — static fast-path + server `read_only` authority via pre-flight GET, per D-18 + D-19.
- Q7 (system-job wait): none, per D-23.
- Module organization: `src/tools/authz/` (existing domain). New files: `role-helpers.js` (BUILT_IN_ROLES, assertRoleIsMutable, permission-catalogue validation, last-admin guard, permission diff), `list-roles.js`, `get-role.js`, `create-role.js`, `update-role.js`, `delete-role.js`, `assign-role.js`, `unassign-role.js`. Update `src/tools/authz/schemas.js` with seven new zod schemas + add `BUILT_IN_ROLES` export. Update `src/tools/authz/index.js` barrel.
- `computeRoleCascadeHash` wrapper lives in `src/tools/authz/role-helpers.js` (not a separate `cascade-hash.js`) — it's a thin forwarding wrapper around the v3.0.0 `computeCascadeHash` primitive, no need for its own file.
- Error-tagging vocabulary aligns with Phase 10 conventions: `connection_read_only`, `confirmation_mismatch`, `unknown_permission`, `builtin_role_immutable`, `role_not_found`, `user_not_found`, `not_currently_assigned`, `would_leave_no_admin`, `role_validation_failed`.
- Permission catalogue cache lives in `role-helpers.js` (or a `permission-catalogue.js` sibling — planner choice).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### This phase (Phase 11)
- `.planning/phases/11-role-management/11-RESEARCH.md` — Live API recon (legacy `/api/roles` vs `/api/authz/roles` decision, 16 built-in roles captured live, full-replace `update_role` body shape, cascade-dissociate behavior, 7 open questions with recommendations). Read first.
- `.planning/REQUIREMENTS.md` §ROLE-01..ROLE-07, §AUTHZ-01 — phase requirement IDs and milestone-spanning safety requirement.
- `.planning/ROADMAP.md` §Phase 11 — goal, success criteria, requirement mapping.

### Phase 10 (mutating-tool template — single biggest source for Phase 11 implementation)
- `.planning/phases/10-entity-sharing-write-path/10-02-PLAN.md` — handler composition pattern (`defineMutatingHandler`, dry-run envelope shape, `tagError` reason convention, `_testConnection` inline-object form, `requireConfirm` gate, 400-body parser, 403 classifier).
- `.planning/phases/10-entity-sharing-write-path/10-02-SUMMARY.md` — PITFALL 1 ACCEPTANCE GATE (read-merge-write is the load-bearing safety property — `update_role` MUST mirror this for permissions). Phase 10's `share_entity` is the closest analog to Phase 11's `update_role`.
- `.planning/phases/10-entity-sharing-write-path/10-01-PLAN.md` — Wave 0 RED scaffold pattern (test file before handler).
- `.planning/phases/10-entity-sharing-write-path/10-03-PLAN.md` — dryRun-only live smoke probe pattern + UAT deferral (Option B). Phase 11 verification gate (D-24) mirrors this exactly.

### Phase 9 (read-path pattern)
- `.planning/phases/09-entity-shares-read-path/09-01-SUMMARY.md` — `defineListHandler` usage, `get_entity_shares` + `list_grantees` split (proof of two-tool pattern; `list_roles` + `get_role` follows the same shape).

### Phase 8 (foundation — live-recon discipline)
- `.planning/phases/08-authz-foundation-grn-helper-live-api-recon/08-RESEARCH.md` — live-fixture capture methodology (`scripts/capture-*-fixtures.js`), `_setCaptureRequest` seam, fixture-replay pattern. Phase 11 reuses verbatim for `scripts/capture-roles-fixtures.js`.
- `.planning/phases/08-authz-foundation-grn-helper-live-api-recon/08-TEST-STRATEGY.md` — throwaway-entity UAT discipline (dedicated test user, gated checkpoint). Phase 11 throwaway-role UAT follows this template at milestone close.

### Project-level
- `CLAUDE.md` §Constraints + §Code organization — ESM Node ≥18, zod for validation, `axios` HTTP Basic with token-as-username, dryRun-default on every mutating tool, no new deps, `src/tools/<domain>/` extraction, `_testConnection` magic arg.
- `.planning/PROJECT.md` §Key Decisions — connection writability flag, sha-256 confirmation-token contract, `dryRun: true` default invariant.
- `.planning/STATE.md` §Accumulated Decisions — Phase 8/9/10 design pivots that Phase 11 inherits.

### Existing code (read before writing)
- `src/tools/authz/share-entity.js` — direct template for the five mutators (handler shape, dry-run envelope, drift refusal). Copy + adapt; do not invent.
- `src/tools/authz/get-entity-shares.js` + `src/tools/authz/list-grantees.js` — direct template for `list_roles` and `get_role`.
- `src/tools/authz/schemas.js` — extend with seven new schemas + `BUILT_IN_ROLES` export.
- `src/tools/authz/index.js` — barrel — extend with seven new exports.
- `src/handler.js` (or wherever `defineMutatingHandler` / `defineListHandler` live) — re-read to confirm the writable-flag short-circuit is at step 3.
- `src/cascade-hash.js` — `computeCascadeHash` primitive; `computeRoleCascadeHash` is a thin wrapper.
- `src/tools/meta/list-admin-tools.js` `DOMAIN_OVERRIDES` — add seven new tool names → `authz`.
- `test/cascade-hash.test.js` — extend with role-tool byte-pinned fixtures.
- `test/list-admin-tools.test.js`, `test/pipelines.test.js`, `test/dashboards.test.js` — tool-count assertions bump 94 → 101.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`defineMutatingHandler` factory** (from v3.0.0, used by `share-entity.js`): wraps a `build()` function with the dryRun envelope, `computeCascadeHash` token, `requireConfirm` gate, writable-flag short-circuit, and error tagging. The five Phase 11 mutators consume it directly — no new factory needed.
- **`defineListHandler` factory** (from v3.0.0, used by Phase 9 read tools): wraps a list/get handler with connection resolution and error envelope. `list_roles` and `get_role` consume it.
- **`computeCascadeHash` primitive** (from v3.0.0, `src/cascade-hash.js`): canonical-form JSON byte-pinned by `test/cascade-hash.test.js`. `computeRoleCascadeHash` is a thin forwarding wrapper that prepends `tool` to the input object.
- **`tagError` helper** (from Phase 10): structured reason-tagged errors. Phase 11 adds vocabulary: `unknown_permission`, `builtin_role_immutable`, `role_not_found`, `user_not_found`, `not_currently_assigned`, `would_leave_no_admin`, `role_validation_failed`, `connection_read_only`, `confirmation_mismatch`.
- **`_testConnection` inline-object form** (extended in Plan 10-02): accepts `{baseUrl, apiToken, writable: false}` directly without registering. Phase 11 Wave 0 tests exercising the writable-flag short-circuit reuse this.
- **`_setCaptureRequest` seam** (from Phase 8): fixture-replay seam so offline tests run without live HTTP. Reuse for all `test/authz-roles.test.js` cases.
- **`src/tools/authz/` domain** — existing four tools (`get_entity_shares`, `list_grantees`, `prepare_share`, `share_entity`) + `grn-helpers.js` + `schemas.js` + barrel `index.js`. Phase 11 extends this domain; no new directory.

### Established Patterns
- **dryRun-default invariant** — every mutating tool defaults `dryRun: true`. The factory enforces this; Phase 11 inherits.
- **sha-256 confirmation token + drift refusal** — token computed from canonical state hash; recomputed on apply; mismatch → `confirmation_mismatch`. Identical to Phase 10.
- **Read-merge-write for partial updates** — PITFALL 1 from Phase 10. `update_role` MUST do a pre-flight GET to assemble the full-replace body. Failing to do this silently truncates the user's intended permission set.
- **Wave 0 RED scaffold** — failing test file before handler. Plan 11-01 ships the test file; Plan 11-02 turns it green.
- **Domain-extracted handlers (`src/tools/<domain>/`)** — never inline in `src/index.js`. CLAUDE.md constraint.
- **`tools.js` registration** — every new tool needs a `tools.js` entry (snake_case name, zod schema → JSON Schema, description ≤200 chars) AND a dispatch branch in `src/index.js`. `test/tool-description-audit.test.js` enforces the length cap; `test/list-admin-tools.test.js` enforces count + DOMAIN_OVERRIDES coverage.
- **Live-fixture capture script** — `scripts/capture-*-fixtures.js` is one-shot, gated, read-only, commits the captured JSON to `test/fixtures/authz/`. Phase 11 ships `scripts/capture-roles-fixtures.js`.

### Integration Points
- **`src/tools.js`** — add seven new tool definitions (snake_case name, zod-derived JSON Schema, description, dryRun-default note where applicable).
- **`src/index.js`** — add seven new dispatch branches (one `if (name === "list_roles")` / etc per tool).
- **`src/tools/authz/index.js`** — barrel — re-export seven new handlers + `BUILT_IN_ROLES` + `assertRoleIsMutable`.
- **`src/tools/authz/schemas.js`** — add `ListRolesSchema`, `GetRoleSchema`, `CreateRoleSchema`, `UpdateRoleSchema`, `DeleteRoleSchema`, `AssignRoleSchema`, `UnassignRoleSchema`. Export `BUILT_IN_ROLES` (Set<string>).
- **`src/tools/meta/list-admin-tools.js`** — `DOMAIN_OVERRIDES` map — add seven new entries → `authz`.
- **`test/list-admin-tools.test.js`** — tool-count expectation bumps 94 → 101.
- **`test/pipelines.test.js`, `test/dashboards.test.js`** — tool-count assertions bump 94 → 101.
- **`test/cascade-hash.test.js`** — add byte-pinned fixtures for each of the four `computeRoleCascadeHash` token shapes (one per mutator family — though create_role does not need a state hash, just `{tool, name, permissions}`).

</code_context>

<specifics>
## Specific Ideas

- The `Admin`-role name comparison is case-insensitive on the server side. Phase 11 client-side `assertRoleIsMutable` MUST be case-insensitive too (test: `assertRoleIsMutable("admin")` and `("ADMIN")` both refuse).
- `assign_role` PUT body MUST be `"{}"` (a literal empty JSON object), NOT `null`. Per Graylog source: "Placeholder because PUT requests should have a body. Set to '{}', the content will be ignored." Sending `null` skips the Content-Type header (`client.js:53-66`) and Graylog returns 415/400. Phase 11 test must pin this exact body string.
- `delete_role` server-side path is `DELETE /api/roles/{rolename}` (URL-encode role names with spaces — Graylog accepts both `+` and `%20`). The `cascades.users_dissociated` preview field is information the agent has NO other way to surface — no `/prepare` endpoint exists for role deletion (unlike entity sharing which has `/api/authz/shares/entities/{grn}/prepare`). The dry-run preview is Phase 11's `/prepare` equivalent, fully client-side computed.
- Built-in roles from the live `test` instance (16 total — `BUILT_IN_ROLES` set populated from the fixture, not hardcoded): `Admin`, `Reader`, `Manager`, `Dashboard Reader`, `MCP Server Access`, plus 11 others. The exact 16 are captured by `scripts/capture-roles-fixtures.js` into `test/fixtures/authz/roles/list-roles-7.0.6.json`; the test loads them dynamically rather than literal-encoding the list.

</specifics>

<deferred>
## Deferred Ideas

- **Batch assign/unassign** (multiple users in one tool call) — deferred to v2-requirements. v3.1.0 ships single-user-per-call (D-09). Use case: bulk onboarding/offboarding scripts. Implementation path is the `/api/authz/roles/{id}/assignees` PUT batch endpoint; would need batch dry-run preview + per-user diff table + batch token covering the full user set.
- **Pagination on `list_roles`** — deferred. 16 roles on live `test` (well under one page). If a future instance crosses ~50 roles, switch to `/api/authz/roles` paginated endpoint and add `page`/`perPage` to the schema.
- **Per-role assignee counts in `list_roles`** — explicitly NOT done (Q4 / D-07). Reconsider if agents repeatedly need to filter by "roles with >0 members". Would require either N+1 round-trips at list time or a server-side aggregation that Graylog doesn't expose.
- **`list_role_members(roleName)` standalone tool** — Phase 11 surfaces members inside `get_role` (D-08). A dedicated `list_role_members` tool with pagination + filtering could come later if the use case emerges.
- **Role-creation-from-permission-template UX** — e.g., `create_role_like({sourceRoleName, newName})`. A nice-to-have wrapper that fetches the source role's permissions and creates a new role with the same set. Deferred — not in v3.1.0 scope.
- **Permission-catalogue extension/authoring tools** — Graylog plugins can register new permissions; no MCP tooling for that. Out of scope for v3.1.0.
- **`/api/authz/roles` paginated endpoints** — id-keyed surface. Phase 11 uses legacy `/api/roles` exclusively (name-keyed, matches success-criterion #3). Reconsider only if a future instance exceeds the legacy endpoint's response size limit.

</deferred>

---

*Phase: 11-role-management*
*Context gathered: 2026-05-21*
