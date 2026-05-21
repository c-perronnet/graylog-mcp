---
phase: 11
slug: role-management
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-21
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `11-RESEARCH.md` §Validation Architecture and `11-CONTEXT.md` D-21..D-24.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node.js built-in test runner) + `c8` for coverage |
| **Config file** | none — `npm test` glob is configured in `package.json` `scripts.test` |
| **Quick run command** | `node --test test/authz-roles.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~3s (quick) / ~30s (full — baseline 1156 tests, expected 1190-1210 after Phase 11) |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/authz-roles.test.js` (the new file)
- **After every plan wave:** Run `npm test` (full offline suite)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~3 seconds (quick) / ~30 seconds (full)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 0 | ROLE-01 | — | `list_roles` full DTO surfaced | unit (fixture-replay) | `node --test test/authz-roles.test.js` | ❌ W0 | ⬜ pending |
| 11-01-02 | 01 | 0 | ROLE-01 | — | `get_role` single-role + members response | unit | same | ❌ W0 | ⬜ pending |
| 11-01-03 | 01 | 0 | ROLE-02 | T-V5-perm-typo | `create_role` dryRun emits expected POST body | unit | same | ❌ W0 | ⬜ pending |
| 11-01-04 | 01 | 0 | ROLE-02 / AUTHZ-01 | — | `create_role` dry-run envelope contains `confirmationToken` | unit | same | ❌ W0 | ⬜ pending |
| 11-01-05 | 01 | 0 | ROLE-02 / V5 | T-V5-perm-typo | `create_role` refuses unknown permission with `reason: unknown_permission` | unit, mandatory | same | ❌ W0 | ⬜ pending |
| 11-01-06 | 01 | 0 | ROLE-02 / V5 | T-V5-wildcard | `create_role` accepts `*` with `warnings.includes_wildcard` in preview | unit | same | ❌ W0 | ⬜ pending |
| 11-01-07 | 01 | 0 | ROLE-02 | — | `create_role` `permitUnknownPermissions: true` opt-out skips catalogue check, surfaces `warnings.unknown_permissions[]` | unit | same | ❌ W0 | ⬜ pending |
| 11-01-08 | 01 | 0 | ROLE-03 | T-V4-toctou-update | `update_role` pre-flight GET happens BEFORE PUT in dry-run (read-merge-write) | unit, mandatory | same | ❌ W0 | ⬜ pending |
| 11-01-09 | 01 | 0 | ROLE-03 | — | `update_role` PUT body shape verified `{name, description, permissions, read_only: false}` | unit, mandatory | same | ❌ W0 | ⬜ pending |
| 11-01-10 | 01 | 0 | ROLE-03 | — | `update_role` dry-run diff in `cascades.diff.{added, removed, unchanged}` | unit | same | ❌ W0 | ⬜ pending |
| 11-01-11 | 01 | 0 | ROLE-03 / AUTHZ-01 | T-V4-toctou-update | `update_role` drift refusal: current permissions differ between dry-run and apply → `confirmation_mismatch` | unit, mandatory | same | ❌ W0 | ⬜ pending |
| 11-01-12 | 01 | 0 | ROLE-04 | T-V4-cascade-delete | `delete_role` cascade-preview lists members in `cascades.users_dissociated` | unit, mandatory | same | ❌ W0 | ⬜ pending |
| 11-01-13 | 01 | 0 | ROLE-04 / AUTHZ-01 | T-V4-toctou-delete | `delete_role` drift refusal: member list differs → `confirmation_mismatch` | unit, mandatory | same | ❌ W0 | ⬜ pending |
| 11-01-14 | 01 | 0 | ROLE-05 | T-V4-amqp-body | `assign_role` apply body equals `{}` (string), not null | unit, mandatory | same | ❌ W0 | ⬜ pending |
| 11-01-15 | 01 | 0 | ROLE-05 | — | `assign_role` preview includes `current_roles` + `roles_after_apply` | unit | same | ❌ W0 | ⬜ pending |
| 11-01-16 | 01 | 0 | ROLE-05 | — | `assign_role` to already-member surfaces `already_member: true`, apply returns `result: "no_change"` | unit | same | ❌ W0 | ⬜ pending |
| 11-01-17 | 01 | 0 | ROLE-05 / AUTHZ-01 | T-V4-toctou-assign | `assign_role` drift refusal: user's roles differ → `confirmation_mismatch` | unit, mandatory | same | ❌ W0 | ⬜ pending |
| 11-01-18 | 01 | 0 | ROLE-06 | — | `unassign_role` apply method=DELETE, no body | unit | same | ❌ W0 | ⬜ pending |
| 11-01-19 | 01 | 0 | ROLE-06 | — | `unassign_role` of non-member refuses with `reason: not_currently_assigned` | unit | same | ❌ W0 | ⬜ pending |
| 11-01-20 | 01 | 0 | ROLE-06 / V4 | T-V4-last-admin | `unassign_role` refuses with `reason: would_leave_no_admin` when removing the last Admin | unit, mandatory | same | ❌ W0 | ⬜ pending |
| 11-01-21 | 01 | 0 | ROLE-06 / AUTHZ-01 | T-V4-toctou-unassign | `unassign_role` drift refusal: user's roles differ → `confirmation_mismatch` | unit, mandatory | same | ❌ W0 | ⬜ pending |
| 11-01-22 | 01 | 0 | ROLE-07 | T-V4-builtin-mut | `update_role` refuses 16 built-ins client-side (parameterized loop) | unit, mandatory | same | ❌ W0 | ⬜ pending |
| 11-01-23 | 01 | 0 | ROLE-07 | T-V4-builtin-mut | `delete_role` refuses 16 built-ins client-side | unit, mandatory | same | ❌ W0 | ⬜ pending |
| 11-01-24 | 01 | 0 | ROLE-07 | T-V4-builtin-mut | Case-insensitive built-in refusal: `assertRoleIsMutable("admin")` and `("ADMIN")` both refuse | unit | same | ❌ W0 | ⬜ pending |
| 11-01-25 | 01 | 0 | AUTHZ-01 | T-V4-read-only-conn | 4× mutators short-circuit with `reason: connection_read_only` when `conn.writable === false` | unit | same | ❌ W0 | ⬜ pending |
| 11-01-26 | 01 | 0 | AUTHZ-01 | — | 4× mutators default `dryRun: true` (apply requires explicit `dryRun: false`) | unit | same | ❌ W0 | ⬜ pending |
| 11-01-27 | 01 | 0 | AUTHZ-01 | T-V6-crypto-pinned | `computeRoleCascadeHash` byte-pinned fixtures (one per mutator family) | unit | `node --test test/cascade-hash.test.js` | ✅ exists, extend | ⬜ pending |
| 11-01-28 | 01 | 0 | Wiring | — | `assertAllToolsRegistered` passes after Plan 11-02 (count = 101) | smoke | `node --test test/pipelines.test.js` | ✅ exists, bump | ⬜ pending |
| 11-01-29 | 01 | 0 | Wiring | — | All 7 tool descriptions ≤200 chars | lint | `node --test test/tool-description-audit.test.js` | ✅ auto-covers | ⬜ pending |
| 11-01-30 | 01 | 0 | Wiring | — | Listed in `list_admin_tools` under `authz` domain (count = 101) | unit | `node --test test/list-admin-tools.test.js` | ❌ W0 (bump 94→101) | ⬜ pending |
| 11-03-01 | 03 | 2 | Live | — | `scripts/capture-roles-fixtures.js` succeeds against live `test` (one-shot, read-only) | smoke | `node scripts/capture-roles-fixtures.js` | ❌ W0 | ⬜ pending |
| 11-03-02 | 03 | 2 | Live | — | 7-tool dryRun smoke probe passes against live `test` (no mutations) | smoke | dedicated dryRun script | ❌ W0 | ⬜ pending |
| MILESTONE | — | — | UAT | — | Throwaway-role full lifecycle UAT (create→update→assign test user→unassign→delete) | manual | gated UAT script at v3.1.0 close | ❌ W0 | ⬜ deferred |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Note: task IDs above are illustrative — final plan IDs are set by the planner. Test coverage map (req → assertion) is what's load-bearing; planner may regroup tasks.*

---

## Wave 0 Requirements

- [ ] `test/authz-roles.test.js` — Wave 0 offline test file covering all rows above (~30 tests)
- [ ] `test/fixtures/authz/roles/list-roles-7.0.6.json` — full `GET /api/roles` fixture (16 roles)
- [ ] `test/fixtures/authz/roles/get-role-admin-7.0.6.json` — single Admin role fixture
- [ ] `test/fixtures/authz/roles/get-role-members-reader-7.0.6.json` — Reader members fixture
- [ ] `test/fixtures/authz/roles/user-roles-admin-7.0.6.json` — admin user roles fixture
- [ ] `test/fixtures/authz/roles/permissions-catalogue-7.0.6.json` — `GET /api/system/permissions` fixture (for permission-string validation tests)
- [ ] `scripts/capture-roles-fixtures.js` — one-shot live read-only probe script
- [ ] Tool-count assertions in `test/list-admin-tools.test.js`, `test/pipelines.test.js`, `test/dashboards.test.js` bumped 94 → 101
- [ ] `src/tools/meta/list-admin-tools.js` `DOMAIN_OVERRIDES` updated — add 7 new tool names → `authz`
- [ ] `test/cascade-hash.test.js` — extend with byte-pinned fixtures for the 4 `computeRoleCascadeHash` token shapes

*Framework install:* not needed — `node:test` is built-in and `npm test` is already configured.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Throwaway-role full lifecycle on live `test` (create custom role → update permissions → assign dedicated test user → unassign → delete → verify cleanup) | All ROLE-* + AUTHZ-01 | Requires live writes to production-shared UNESCO Graylog; must run under operator supervision with a dedicated test user account and gated checkpoint | Bundled into v3.1.0 milestone-close HUMAN-UAT script alongside the deferred Phase 10 `share_entity` throwaway-entity UAT (per CONTEXT.md D-24). Specific steps in dedicated UAT script created at milestone close. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter once Wave 0 is shipped and the full task list converges

**Approval:** pending
