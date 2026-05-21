# Phase 11: Role Management - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-21
**Phase:** 11-role-management
**Areas discussed:** Permission-string validation, Tool surface — split or bundled, assign/unassign — single user or batch, Live UAT gate scope at milestone close

---

## Permission-string validation

### Q1 — Validate against catalogue or pass-through?

| Option | Description | Selected |
|--------|-------------|----------|
| Catalogue-aware + opt-out | Default: fetch /api/system/permissions, validate each permission string. Refuse with `unknown_permission` on typos. Accept `permitUnknownPermissions: true` opt-out for enterprise plugins. Catches `stream:read` vs `streams:read` typos before they persist. | ✓ |
| Pass-through (no validation) | Send any string. Graylog accepts any string server-side. Simpler but lets typos silently produce broken roles. | |
| Catalogue-aware, no opt-out | Always validate. No escape hatch. Cleanest but may false-reject enterprise/plugin permissions. | |

**User's choice:** Catalogue-aware + opt-out (Recommended)
**Notes:** Locked. The opt-out flag (`permitUnknownPermissions: false` default) handles the rare enterprise case without weakening the default safety posture.

### Q2 — How should validation parse the permission structure?

| Option | Description | Selected |
|--------|-------------|----------|
| Validate `{type}:{action}` prefix, accept trailing `:id` | Split on `:`. Validate `{type}:{action}` exists in catalogue. Treat trailing `:id` as opaque data. Matches how Graylog actually parses permissions. | ✓ |
| Exact full-string match | Permission must appear verbatim in catalogue. Refuses `streams:read:abc123` because only `streams:read` is in catalogue. Too strict. | |
| Type-only validation | Validate only `{type}` prefix. Lenient — catches `stremas:read` but lets `streams:write` through. | |

**User's choice:** Validate `{type}:{action}` prefix, accept trailing `:id` (Recommended)
**Notes:** Locked. Avoids per-permission entity-existence lookups while still catching action typos.

### Q3 — Should the wildcard `*` super-permission be accepted in custom-role permission sets?

| Option | Description | Selected |
|--------|-------------|----------|
| Accept with prominent warning in dry-run | Allow `*` but surface `WARNING: includes wildcard super-permission` in the dry-run preview so reviewers see the blast radius before token-confirm. | ✓ |
| Refuse `*` client-side | Refuse with `wildcard_permission_refused`. Forces explicit per-type permissions even for admin-equivalent roles. Breaks the legitimate "admin custom-role" case. | |
| Accept silently, no warning | Treat `*` like any other permission. Easy to miss the blast radius in review. | |

**User's choice:** Accept with prominent warning in dry-run (Recommended)
**Notes:** Locked. Custom admin tiers are legitimate; the warning surfaces blast radius without blocking the use case.

---

## Tool surface — split or bundled

### Q4 — Should `list_roles` cover single-role read, or do we ship a separate `get_role`?

| Option | Description | Selected |
|--------|-------------|----------|
| Two tools: `list_roles` + `get_role` | `list_roles` returns the array; `get_role(name)` returns one role enriched with current members array. Matches Phase 9 pattern (`get_entity_shares` + `list_grantees`). Tool count: 96. | ✓ |
| One tool: `list_roles` with optional name filter | `list_roles(name?: string)` — omitted returns all, provided returns the one matching. No members in either response. Tool count: 95. Leaner but less discoverable. | |
| Two tools, no members in `get_role` | Split, but `get_role` returns only the role DTO. Members come from a future `list_role_members` tool. Most conservative split. | |

**User's choice:** Two tools: list_roles + get_role (Recommended)
**Notes:** Locked. `get_role` is the natural pre-flight call for `update_role` / `delete_role` / `assign_role` / `unassign_role` — surfacing members in its response saves the agent a separate round-trip. Tool count bumps 94 → 101 (7 new tools total, since `assign_role` and `unassign_role` are also new).

---

## assign/unassign — single user or batch

### Q5 — Single user per call or batch?

| Option | Description | Selected |
|--------|-------------|----------|
| Single user per call | `assign_role({roleName, username})` and `unassign_role({roleName, username})`. Matches success-criterion #3 wording, the legacy endpoint shape, and Phase 10's one-action-per-call pattern. | ✓ |
| Batch: `usernames[]` array | Use `/api/authz/roles/{id}/assignees` PUT (batch endpoint). One call assigns/unassigns N users. More efficient for bulk ops but per-user diff preview gets complex; partial-drift refuses the whole batch. | |
| Single by default, optional batch via flag | Default `username: string`. Accept `usernames: string[]` only when `batch: true`. Two code paths in one tool — more surface to test. | |

**User's choice:** Single user per call (Recommended)
**Notes:** Locked. Batch deferred to v2-requirements. Use case (bulk onboarding) is real but rare enough to defer; single-user-per-call keeps the dry-run preview / token / drift refusal symmetric across all role tools.

---

## Live UAT gate scope at milestone close

### Q6 — Phase 11 verification gate?

| Option | Description | Selected |
|--------|-------------|----------|
| dryRun-only smoke at phase close; full UAT bundled into v3.1.0 milestone close | Matches Phase 10 (Option B). Phase 11 ships when offline tests green + fixture capture passes + dryRun:true smoke probes each tool. Full lifecycle (create → update → assign test user → unassign → delete) bundled into milestone-close UAT alongside the deferred share_entity throwaway-entity UAT. | ✓ |
| Full throwaway-role UAT at phase close (not deferred) | Block phase completion until HUMAN-UAT script creates a throwaway role on live test, runs the full lifecycle. Tighter feedback loop but defers v3.1.0 ship. | |
| Offline tests only — no live probe | Skip even the dryRun smoke probe. Fastest phase ship, weakest live-correctness signal. | |

**User's choice:** dryRun-only smoke at phase close; full UAT bundled into v3.1.0 milestone close (Recommended)
**Notes:** Locked. Same pattern as Phase 10 (Plan 10-03). Single gated HUMAN-UAT checkpoint at milestone close covers both deferred Phase 10 share_entity and new Phase 11 role-mutation lifecycles, against a throwaway role + dedicated test user.

---

## Claude's Discretion

Researcher's recommendations adopted as defaults (no user input requested — low-risk, well-precedented):

- **Q4 from RESEARCH.md** — `list_roles` does NOT include per-role assignee counts (no N+1 round-trips at list time). Members available via `get_role`.
- **Q5 from RESEARCH.md** — `delete_role` cascade preview projects to `{username, roles_before, roles_after}` (matches Phase 10's diff projection, not full `UserSummary` pass-through).
- **Q6 from RESEARCH.md** — `BUILT_IN_ROLES` is a hybrid: static set as fast-path + server `read_only` flag from pre-flight GET as authority. Belt + braces.
- **Q7 from RESEARCH.md** — No `await_system_job` integration. Graylog's `RoleService.save`/`delete` are synchronous.
- Module organization: `src/tools/authz/` (existing domain). Seven new handler files + extend `schemas.js` + extend barrel `index.js`. `computeRoleCascadeHash` wrapper lives in `role-helpers.js`, not a separate file.
- Permission catalogue caching: module-scope, keyed by `(baseUrl, apiToken)`, no expiry within session.
- Error-tagging vocabulary aligned with Phase 10 conventions.
- **Last-admin guard** (researcher Pitfall 5) — non-negotiable safety default. `unassign_role` refuses with `would_leave_no_admin` if removal would leave zero Admins.

## Deferred Ideas

(Captured in CONTEXT.md `<deferred>` section.)

- Batch assign/unassign — v2-requirements
- Pagination on `list_roles` — only if instances cross ~50 roles
- Per-role assignee counts in `list_roles` — explicitly out
- `list_role_members` standalone tool — only if use case emerges
- `create_role_like` template wrapper — out of v3.1.0
- Permission-catalogue extension tools — out of v3.1.0
- `/api/authz/roles` paginated endpoints — only if legacy response-size limit hit
