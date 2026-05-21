---
phase: 11-role-management
verified: 2026-05-21T13:30:00Z
status: passed
score: 12/12 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 11: Role Management — Verification Report

**Phase Goal:** An agent can inspect, create, modify, delete, and assign Graylog roles — the coarse-grained global permission layer — as an independent track from entity sharing, with built-in roles protected from mutation.

**Verified:** 2026-05-21T13:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + AUTHZ-01 Re-assertion)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | `list_roles` returns all roles with permission sets; `get_role` reads a single role's permissions + members | VERIFIED | `src/tools/authz/list-roles.js` (76 lines, plain-async GET `/api/roles`); `src/tools/authz/get-role.js` (71 lines, parallel GETs + D-08 projection `{username, full_name, email}`); both registered in `src/tools/authz/index.js:47-48`; tests 1+2 in `test/authz-roles.test.js` GREEN. Task 3 live-UAT confirmed end-to-end against UNESCO 7.0.6+711d207. |
| SC2 | Agent can `create_role` / `update_role` / `delete_role` for custom roles | VERIFIED | `src/tools/authz/{create,update,delete}-role.js` (146/197/157 lines) all use `defineMutatingHandler`; tests 3-13 GREEN; live-UAT Task 3 steps 1, 3, 8 confirmed apply paths against live cluster (tokens `0e5e271a…`, `71d3874b…`, `27e2f174…`). |
| SC3 | Agent can `assign_role` / `unassign_role` keyed by role name + username | VERIFIED | `src/tools/authz/{assign,unassign}-role.js` (170/181 lines); both registered (`index.js:52-53`); tests 14-21 GREEN; live-UAT Task 3 steps 5, 7 confirmed apply against UNESCO with user `<user-a>` (User A). |
| SC4 | Built-in read-only roles (Admin, Reader, +14) refused for update/delete client-side with clear error before any HTTP call | VERIFIED | `assertRoleIsMutable()` in `src/tools/authz/role-helpers.js` called from `create/update/delete-role.js`; tests 22, 23, 24 (parameterized over 16 BUILT_IN_ROLES + case-insensitive variants) GREEN; live-UAT verified `update_role(Admin)` refused with `reason: builtin_role_immutable` and zero HTTP calls. |
| SC5 | Every mutating role tool defaults `dryRun:true`, returns sha-256 confirmationToken, refuses apply on drift | VERIFIED | All 5 mutators use `defineMutatingHandler` which enforces dryRun default; `computeRoleCascadeHash` imported by all 5 (grep returns 5/5); tests 25 (`connection_read_only` short-circuit) + 26 (dryRun default) + drift refusal tests 11, 13, 17, 21 all GREEN; AUTHZ-01 re-assertion satisfied. |
| MS-1 | update_role PITFALL 1 acceptance gate (full-replace PUT body with name + permissions + read_only:false) | VERIFIED | Test 8 GREEN: `update_role PITFALL 1 ACCEPTANCE GATE: agent's full target permission set is echoed in body.permissions (no PATCH semantics); body MUST include name + read_only:false (RolesResource @JsonCreator)`. `grep -nE "read_only" src/tools/authz/update-role.js` returns the literal `read_only: false` at line 139. Pre-flight GET at line 60. Live-UAT step 3 confirmed live. |
| MS-2 | delete_role cascade-preview surfaces `users_dissociated` projection | VERIFIED | Test 12 GREEN. `grep -c "users_dissociated" src/tools/authz/delete-role.js` returns 6. Live-UAT step 8 confirmed empty cascade (since user was already unassigned in step 7). |
| MS-3 | assign_role PUT body is literal `{}` (empty object), NEVER null | VERIFIED | Test 14 GREEN. `grep -nE "body:\s*\{\}" src/tools/authz/assign-role.js` returns line 107: `body: {}`. `grep -E "body:\s*null" src/tools/authz/assign-role.js` returns 0 matches. Live-UAT step 5 confirmed `preview.body === {}` literally. |
| MS-4 | unassign_role last-admin guard refuses with reason=would_leave_no_admin | VERIFIED | Test 20 GREEN. `grep -nE "would_leave_no_admin" src/tools/authz/unassign-role.js` returns 4 matches (comment + tagError call + error message + reason tag). Only file in src/tools/authz/ containing this string. |
| WIR-1 | All 7 handlers registered via barrel; tool count = 101; `assertAllToolsRegistered` passes | VERIFIED | `src/tools/authz/index.js:47-53` has 7 new register() calls. `node -e "import('./src/tools.js')..."` prints `count=101`. Inline `assertAllToolsRegistered(toolDefinitions)` returns `PASS: All 101 tools registered`. Tests in `test/list-admin-tools.test.js` + `test/pipelines.test.js` + `test/dashboards.test.js` all GREEN with 101 count. |
| WIR-2 | computeRoleCascadeHash exported + byte-pinned in cascade-hash.test.js | VERIFIED | `src/tools/_shared/cascade-hash.js:400` declares `export function computeRoleCascadeHash(input)`. `test/cascade-hash.test.js` has 5+ named tests for it (lines 567+). `node --test test/cascade-hash.test.js` reports 32/32 pass. No PLACEHOLDER strings remain in test file. |
| WIR-3 | Permission catalogue validation + warnings + last-admin guard wired | VERIFIED | `role-helpers.js` exports `fetchPermissionCatalogue`, `validatePermissionsAgainstCatalogue` (per-conn cache keyed by `${baseUrl}::${apiToken}`); tests 5, 6, 7 GREEN (unknown_permission refusal + wildcard warning + permitUnknownPermissions opt-out). Tests 20 confirms last-admin guard. |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/tools/authz/list-roles.js` | plain-async GET /api/roles handler | VERIFIED | 76 lines, exports `handleListRoles`; registered in barrel |
| `src/tools/authz/get-role.js` | plain-async parallel GETs with D-08 member projection | VERIFIED | 71 lines, exports `handleGetRole`; registered |
| `src/tools/authz/create-role.js` | defineMutatingHandler + catalogue validation + wildcard warning | VERIFIED | 146 lines, exports `handleCreateRole`; uses `assertRoleIsMutable` + `computeRoleCascadeHash` |
| `src/tools/authz/update-role.js` | defineMutatingHandler + pre-flight GET + PITFALL 1 full-replace body | VERIFIED | 197 lines; line 60: pre-flight GET; line 139: `read_only: false`; PITFALL 1 documented |
| `src/tools/authz/delete-role.js` | defineMutatingHandler + cascade preview + drift refusal | VERIFIED | 157 lines; uses members projection + `users_dissociated` cascades |
| `src/tools/authz/assign-role.js` | defineMutatingHandler + body=={} + already_member idempotency | VERIFIED | 170 lines; line 107: `body: {}` literal; no `body: null` matches; deliberately omits `assertRoleIsMutable` per D-18 / AP4 |
| `src/tools/authz/unassign-role.js` | defineMutatingHandler + last-admin guard + not_currently_assigned refusal | VERIFIED | 181 lines; lines 107-111 have `would_leave_no_admin` guard; D-11 `not_currently_assigned` |
| `src/tools/authz/role-helpers.js` | 7 helpers + test seam | VERIFIED | 273 lines; exports `assertRoleIsMutable`, `tagError`, `computePermissionsDiff`, `sortedPermissionsHash`, `sortedRolesHash`, `fetchPermissionCatalogue`, `validatePermissionsAgainstCatalogue`, `_clearCatalogueCacheForTests` |
| `src/tools/_shared/cascade-hash.js` | adds computeRoleCascadeHash export | VERIFIED | Phase 11 block starts line 342; function declared at line 400; existing 3 cascade-hash exports byte-unchanged |
| `src/tools/authz/index.js` | 7 new register() calls | VERIFIED | Lines 47-53; 3 existing entries (lines 42-44) unchanged |
| `src/tools.js` | 7 new tool catalogue entries | VERIFIED | Lines 1962-2060 have all 7 entries; descriptions ≤200 chars |
| `src/tools/meta/list-admin-tools.js` | 7 new DOMAIN_OVERRIDES → authz entries | VERIFIED | Lines 69-75 |
| `test/authz-roles.test.js` | ≥26 named tests + 4 mandatory safety gates | VERIFIED | 26 `test(...)` declarations; all 4 mandatory gates GREEN |
| `test/cascade-hash.test.js` | 5+ byte-pinned tests for computeRoleCascadeHash | VERIFIED | 26 mentions; tests at lines 567+; 32/32 tests pass; no PLACEHOLDER remains |
| `test/fixtures/authz/roles/*.json` | 5 fixtures present (scaffold or live) | VERIFIED (scaffold) | All 5 present with `_provenance` blocks; captured_by is `PLACEHOLDER` (operator-mediated capture deferred — see note below) |
| `scripts/capture-roles-fixtures.js` | one-shot read-only capture script | VERIFIED | 264 lines; `grep -c '"GET"'`=17; `grep -cE '"(POST\|PUT\|DELETE\|PATCH)"'`=0; `process.exit(2)`=3; `assertGetOnly`=9 |
| `test/authz-roles-live.smoke.js` | opt-in dryRun-only smoke probe | VERIFIED | 541 lines; *.smoke.js suffix excludes from npm test; `grep -c 'dryRun: true'`=11; `grep -cE 'dryRun *: *false'`=0; `assertSafeRolesPath`/`process.exit(2)`=7 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/tools/authz/update-role.js` | `src/tools/authz/role-helpers.js` | imports `assertRoleIsMutable, tagError, computePermissionsDiff, sortedPermissionsHash` | WIRED | grep confirms all imports + usage |
| `src/tools/authz/update-role.js` | `src/tools/_shared/cascade-hash.js` | `computeRoleCascadeHash` | WIRED | line 39 import + line 117 usage |
| `src/tools/authz/delete-role.js` | `src/graylog/client.js` | `makeClient(conn).request` for pre-flight GET role + members + DELETE | WIRED | uses standard client; tests 12, 13 verify multi-call sequence |
| `src/tools/authz/assign-role.js` | `src/tools/_shared/handler.js` | `defineMutatingHandler` with `body: {}` | WIRED | line 38 + line 107 |
| `src/tools/authz/unassign-role.js` | `src/tools/authz/role-helpers.js` | last-admin guard composition | WIRED | grep confirms `would_leave_no_admin` only in unassign-role.js |
| `src/tools/authz/index.js` | individual handler files | 7 new `register(...)` calls | WIRED | lines 47-53 all present + correct |
| `src/index.js` | dispatch (via _register.js) | `assertAllToolsRegistered(toolDefinitions)` at line 29 | WIRED | Inline test prints `PASS: All 101 tools registered` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|----|--------|
| `handleListRoles` envelope | `payload.roles` | Live GET `/api/roles` | Yes (live UAT step 1 confirmed) | FLOWING |
| `handleGetRole` envelope | `payload.role` + `payload.members` | Parallel GETs `/api/roles/{n}` + `.../members` | Yes (live UAT steps 2, 6) | FLOWING |
| `handleCreateRole` preview | `payload.preview.body` + `confirmationToken` | `computeRoleCascadeHash` over canonical input | Yes (live UAT step 1: token `0e5e271a…`) | FLOWING |
| `handleUpdateRole` preview | `payload.preview.body` + `cascades.diff` | Pre-flight GET + `computePermissionsDiff` | Yes (live UAT step 3: diff with added/removed/unchanged arrays) | FLOWING |
| `handleDeleteRole` preview | `cascades.users_dissociated` | Pre-flight GET .../members + projection | Yes (live UAT step 8: empty cascade since user already unassigned) | FLOWING |
| `handleAssignRole` preview | `cascades.current_roles` + `roles_after_apply` | GET /api/authz/roles/user/{username} | Yes (live UAT step 5) | FLOWING |
| `handleUnassignRole` preview | `cascades.current_roles` | GET user-roles + (Admin guard) GET /api/roles/Admin/members | Yes (live UAT step 7) | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Module imports succeed | `node -e "import('./src/tools.js')..."` | `count=101` | PASS |
| assertAllToolsRegistered passes | Inline script importing _register + dispatch | `PASS: All 101 tools registered` | PASS |
| All 7 schemas + BUILT_IN_ROLES Set exported | `node -e "import('./src/tools/authz/schemas.js')..."` | BUILT_IN_ROLES size: 16; all 7 schemas present | PASS |
| Full npm test suite | `npm test` | `# tests 1196 / pass 1196 / fail 0` | PASS |
| Wave 0 RED → GREEN | `node --test test/authz-roles.test.js` | `1..26 / tests 26 / pass 26 / fail 0` | PASS |
| Cascade-hash tests | `node --test test/cascade-hash.test.js` | `1..32 / tests 32 / pass 32 / fail 0` | PASS |
| Phase 9/10 regression | `node --test test/authz-entity-shares.test.js test/authz-share-entity.test.js` | `1..42 / tests 42 / pass 42 / fail 0` | PASS |
| 4 mandatory safety gates GREEN (named test grep) | `node --test test/authz-roles.test.js \| grep "PITFALL 1\|cascade-preview\|body equals\|would_leave_no_admin"` | 4 `ok` lines confirmed | PASS |
| AUTHZ-01 re-assertion (tests 25 + 26) | `node --test test/authz-roles.test.js \| grep "^ok (25\|26)"` | Both GREEN | PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| (no probes defined for this phase) | n/a | n/a | n/a |

The phase declares operator-mediated probes (`scripts/capture-roles-fixtures.js`, `test/authz-roles-live.smoke.js`) but per project memory `graylog-test-connection-is-live-unesco` these target real UNESCO production infrastructure — the verifier must NOT execute them. The Task 3 live-UAT recorded in `11-03-SUMMARY.md` is the operator-mediated equivalent (already executed with `uat-complete` disposition).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ROLE-01 | 11-01, 11-02, 11-03 | Agent can list all roles + read a role's permissions via `list_roles` | SATISFIED | `handleListRoles` + `handleGetRole` + tests 1+2 GREEN + live-UAT steps 1, 2 |
| ROLE-02 | 11-01, 11-02, 11-03 | Agent can create a custom role via `create_role` | SATISFIED | `handleCreateRole` + tests 3-7 GREEN + live-UAT step 1 (applied) |
| ROLE-03 | 11-01, 11-02, 11-03 | Agent can update a custom role's permissions and description | SATISFIED | `handleUpdateRole` + tests 8-11 GREEN (incl. PITFALL 1) + live-UAT step 3 |
| ROLE-04 | 11-01, 11-02, 11-03 | Agent can delete a custom role | SATISFIED | `handleDeleteRole` + tests 12-13 GREEN + live-UAT step 8 |
| ROLE-05 | 11-01, 11-02, 11-03 | Agent can assign a user to a role | SATISFIED | `handleAssignRole` + tests 14-17 GREEN (incl. body=={}) + live-UAT step 5 |
| ROLE-06 | 11-01, 11-02, 11-03 | Agent can unassign a user from a role | SATISFIED | `handleUnassignRole` + tests 18-21 GREEN (incl. last-admin guard) + live-UAT step 7 |
| ROLE-07 | 11-01, 11-02, 11-03 | Built-in roles refused for update/delete client-side | SATISFIED | `assertRoleIsMutable` + tests 22-24 GREEN (parameterized 16 BUILT_IN_ROLES × 2 mutators + case-insensitive) + live-UAT verified `update_role(Admin)` refused with 0 HTTP calls |
| AUTHZ-01 | (re-asserted, owned by Phase 10) | All 5 mutating role tools default dryRun:true + sha-256 token + drift refusal | SATISFIED | All 5 mutators use `defineMutatingHandler`; all 5 import `computeRoleCascadeHash`; tests 25+26 + drift tests 11, 13, 17, 21 GREEN |

No orphaned requirements: All 7 ROLE-* IDs from REQUIREMENTS.md are claimed by Phase 11 plans (11-01, 11-02, 11-03). AUTHZ-01 is the cross-cutting re-assertion — owned by Phase 10 but verified here as a verification gate.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | No `TBD`/`FIXME`/`XXX` debt markers in any of the 11 Phase 11 source/test/script files | — | — |
| `test/fixtures/authz/roles/*.json` | _provenance.captured_by | `PLACEHOLDER — Plan 11-03 scripts/capture-roles-fixtures.js will overwrite` | INFO | Per prompt's explicit note: fixtures are scaffolded placeholders; live capture is operator-mediated and remains optional. Task 3 live-UAT outcome already proves the live-API contract. Not a gap. |

### Human Verification Required

None. The Task 3 human-verify checkpoint was completed (Option A: `uat-complete`) on 2026-05-21 by Operator against the live UNESCO Graylog 7.0.6+711d207 `test` connection. Throwaway role `_phase11_uat_20260521` was created, modified, assigned to dedicated test user `<user-a>` (User A), unassigned, and deleted; cluster state verified clean. Full 9-step lifecycle table + audit-trail tokens recorded in `11-03-SUMMARY.md` §"Task 3 Outcome".

### Gaps Summary

No gaps. All 5 ROADMAP success criteria + 4 mandatory safety acceptance gates + 7 ROLE-* requirements + AUTHZ-01 re-assertion verified end-to-end through:
- Offline tests (1196/1196 green, including 26-test authz-roles + 32-test cascade-hash)
- Code-level grep gates (all expected patterns present; no anti-patterns)
- Live UAT (9-step throwaway-role full lifecycle on UNESCO production, with documented confirmation tokens for audit trail)

**Note on fixtures (informational, not a gap):** The 5 fixture files in `test/fixtures/authz/roles/` retain Plan 11-01's scaffold/placeholder content. The operator-mediated `scripts/capture-roles-fixtures.js` was not run to overwrite them. Per the prompt's explicit instruction: "fixture population is operationally optional. Flag this in VERIFICATION.md as a note, not a gap." The Task 3 live-UAT outcome already proves the live-API contract is met; the offline tests work correctly against the scaffolded fixtures because their structural shape matches what the handlers/tests expect.

---

_Verified: 2026-05-21T13:30:00Z_
_Verifier: Claude (gsd-verifier)_
