---
phase: 11-role-management
plan: 01
subsystem: authz
tags: [authz, roles, zod, schemas, wave-0, red-scaffold, builtin-role-refusal, drift-refusal, sha256-token]

# Dependency graph
requires:
  - phase: 08-authz-foundation-grn-helper-live-api-recon
    provides: "src/tools/authz/ domain, _setCaptureRequest seam, fixture-replay discipline, _provenance block shape"
  - phase: 09-entity-shares-read-path
    provides: "defineListHandler precedent, plain-async handler pattern (get_entity_shares + list_grantees), schemas.js mutatingBase import"
  - phase: 10-entity-sharing-write-path
    provides: "defineMutatingHandler factory, _testConnection inline-object form, PITFALL 1 ACCEPTANCE GATE pattern, requireConfirm gate, ShareEntitySchema as the input-contract template, tagError pattern, drift-refusal via canonical-form hash"
provides:
  - "Wave 0 RED scaffold (test/authz-roles.test.js, 26 named tests) — the executable specification Plan 11-02 must turn GREEN"
  - "7 zod schemas + BUILT_IN_ROLES Set<string> (16 lowercased names) exported from src/tools/authz/schemas.js"
  - "7 tools.js catalogue entries (snake_case names, ≤200-char descriptions, JSON-Schema property shapes)"
  - "7 DOMAIN_OVERRIDES → authz entries in src/tools/meta/list-admin-tools.js"
  - "8 tool-count assertion bumps (94 → 101) across test/list-admin-tools.test.js + test/pipelines.test.js + test/dashboards.test.js"
  - "7 byte-pin tests in test/cascade-hash.test.js (5 frozen-fixture + 1 order-independence + 1 malformed-input) for computeRoleCascadeHash with PLACEHOLDER hashes"
  - "5 placeholder fixture files at test/fixtures/authz/roles/ with _provenance blocks (Plan 11-03 overwrites with live captures)"
affects:
  - "Plan 11-02 — ships the 7 handlers (list_roles, get_role, create_role, update_role, delete_role, assign_role, unassign_role) + role-helpers.js + computeRoleCascadeHash export + replaces the 4 PLACEHOLDER hashes in test/cascade-hash.test.js"
  - "Plan 11-03 — runs scripts/capture-roles-fixtures.js against live `test` to overwrite the 5 placeholder fixtures; runs the dryRun-only 7-tool live smoke probe"
  - "Phase 11 milestone close — throwaway-role HUMAN-UAT (bundled with deferred Phase 10 share_entity throwaway-entity UAT) at v3.1.0 close"

# Tech tracking
tech-stack:
  added: []  # Zero new dependencies — composes against existing zod/axios/node:test/node:crypto primitives
  patterns:
    - "Wave 0 RED scaffold: ship the failing-tests-first specification BEFORE the handlers (mirrors Plan 10-01 → 10-02 progression)"
    - "BUILT_IN_ROLES exported from schemas.js (not from a separate role-helpers.js) so the Wave 0 test file can import the parameterized refusal loop iterator before Plan 11-02 lands the helper module"
    - "_provenance block on every captured/scaffolded fixture file (captured_by, instance, connection, graylog_version, endpoint, captured_at, note) — extends Phase 8's discipline to scaffolded placeholder fixtures"
    - "PLACEHOLDER hash convention for byte-pin tests in RED scaffold (00...00<N> with trailing nibble per test) — Plan 11-02 replaces with real digests in a single fix-pin commit"

key-files:
  created:
    - "test/authz-roles.test.js (1003 lines — Wave 0 offline test scaffold for the 7 role tools)"
    - "test/fixtures/authz/roles/list-roles-7.0.6.json (16-role placeholder seed for BUILT_IN_ROLES)"
    - "test/fixtures/authz/roles/get-role-admin-7.0.6.json (single-role Admin placeholder)"
    - "test/fixtures/authz/roles/get-role-members-reader-7.0.6.json (3-user member placeholder)"
    - "test/fixtures/authz/roles/user-roles-admin-7.0.6.json (admin user roles placeholder)"
    - "test/fixtures/authz/roles/permissions-catalogue-7.0.6.json (5-resource catalogue placeholder)"
    - ".planning/phases/11-role-management/11-01-SUMMARY.md (this file)"
  modified:
    - "src/tools/authz/schemas.js (+127 lines: 7 zod schemas + BUILT_IN_ROLES Set; existing Phase 8/9/10 exports unchanged)"
    - "src/tools.js (+121 lines: 7 new tool catalogue entries between share_entity and list_admin_tools)"
    - "src/tools/meta/list-admin-tools.js (+8 lines: 7 new DOMAIN_OVERRIDES → authz entries)"
    - "test/list-admin-tools.test.js (3 assertion bumps 94 → 101)"
    - "test/pipelines.test.js (1 test rename + 1 comment + 1 assertion 94 → 101)"
    - "test/dashboards.test.js (1 comment + 1 test rename + 1 assertion 94 → 101)"
    - "test/cascade-hash.test.js (+141 lines: 7 new computeRoleCascadeHash tests + import-block extension)"

key-decisions:
  - "BUILT_IN_ROLES Set<string> exported from src/tools/authz/schemas.js with 16 entries, lowercased — case-insensitive comparison via .toLowerCase() at handler-time (Plan 11-02). Plan 11-01 surfaces it from schemas.js (not role-helpers.js) so the Wave 0 test's parameterized refusal loop can import it before Plan 11-02 ships role-helpers.js."
  - "computeRoleCascadeHash output is PINNED with PLACEHOLDER hashes (00...00<N> with a distinct trailing nibble per test). Plan 11-02 replaces each placeholder with the real computed digest after implementing the function — same RED → fix-pin → GREEN cycle computeNotificationCascadeHash and computeShareGrantHash used."
  - "All 5 mutating schemas (Create/Update/Delete/Assign/Unassign) extend mutatingBase + add a confirm: z.string().optional() field — schema-level confirm makes the apply-time token echo a first-class input."
  - "No .refine clauses on the 7 new schemas — cross-field invariants (built-in refusal, last-admin guard, permission-catalogue validation) are runtime-enforced in Plan 11-02 handlers via tagError, NOT parse-time. This matches the Phase 10 ShareEntitySchema approach for invariants that need access to live API responses (e.g. the catalogue, the current role's read_only flag, the user's current roles)."
  - "5 placeholder fixtures committed with synthetic seed data (alice/bob/carol usernames) and _provenance blocks documenting the Plan 11-03 overwrite — gives test/authz-roles.test.js's readFileSync calls a target to load without crashing while keeping the live UNESCO data out of git until the gated capture script runs."

patterns-established:
  - "Wave 0 RED scaffold for a 7-tool composition phase: 1 test file (26 named tests covering 4 MANDATORY safety acceptance gates + 16-built-in parameterized refusal loop × 2 + 4 drift-refusal tests + 5 read/preview tests) + 7 zod schemas + 7 catalogue entries + 7 DOMAIN_OVERRIDES + 5 placeholder fixtures + 7 cascade-hash byte-pin tests — every artifact is the executable specification Plan 11-02 satisfies."
  - "Test count distribution across files for a 30-validation-row phase: rows 11-01-01..26 live in test/authz-roles.test.js (26 tests), rows 11-01-27..29 live in test/list-admin-tools.test.js + test/pipelines.test.js + test/dashboards.test.js (tool-count bumps), rows 11-01-27..30 live in test/cascade-hash.test.js (byte-pin tests). Total: 30 tests across 4 files."

requirements-completed: [ROLE-01, ROLE-02, ROLE-03, ROLE-04, ROLE-05, ROLE-06, ROLE-07]
# Note: AUTHZ-01 is the milestone-spanning safety-stack requirement, re-asserted by tests 25 + 26 (connection_read_only short-circuit + dryRun:true default) — listed in the test file but not in the plan's `requirements` frontmatter because it's owned by Phase 10's plan. The Wave 0 RED scaffold pins it; Plan 11-02 turns the assertion GREEN.

# Metrics
duration: ~45min
completed: 2026-05-21
---

# Phase 11 Plan 01: Wave 0 RED scaffold for role-management surface Summary

**Wave 0 RED scaffold for the 7-tool role-management surface: 26-test offline specification + 7 zod schemas + BUILT_IN_ROLES Set + 7 catalogue/DOMAIN_OVERRIDES entries + 8 tool-count bumps + 7 byte-pinned cascade-hash placeholders. Plan 11-02 turns it GREEN.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-05-21T09:13:00Z (approximate)
- **Completed:** 2026-05-21T09:58:07Z
- **Tasks:** 5/5
- **Files modified:** 13 (7 created + 6 modified)
- **Lines added:** ~1747 (test/authz-roles.test.js 1003 + schemas.js 127 + tools.js 121 + cascade-hash.test.js 141 + 5 fixtures ~88 + list-admin-tools.js 8 + tool-count bumps 16)

## Accomplishments
- **Wave 0 RED specification shipped:** test/authz-roles.test.js (26 named tests) encodes ROLE-01..07 + AUTHZ-01 and pins all 4 MANDATORY safety acceptance gates — update_role PITFALL 1 full-replace body (D-15), delete_role users_dissociated cascade preview (D-16), assign_role body=={} literal NEVER null (Pitfall 3 / AP1), unassign_role would_leave_no_admin guard (D-17 / Pitfall 5).
- **Built-in refusal loop pinned:** Parameterized 16-built-in refusal tests for update_role + delete_role (D-18) — each runs through BUILT_IN_ROLES Set and asserts `reason: "builtin_role_immutable"` + zero HTTP calls (client-side fast-path). Case-insensitive variant pinned separately ('admin'/'ADMIN'/'Admin' all refuse).
- **Drift-refusal pattern pinned across all 4 mutator families:** update_role's current_permissions_hash, delete_role's members_hash, assign_role's current_user_roles_hash, unassign_role's current_user_roles_hash all gated via confirmation_mismatch on apply-time drift (D-14).
- **Input contract locked:** 7 zod schemas (Create/Update/Delete/Assign/Unassign extend mutatingBase + add confirm; ListRolesSchema + GetRoleSchema are plain z.object per D-06/D-08) + BUILT_IN_ROLES Set<string> of 16 lowercased names exported from src/tools/authz/schemas.js. Phase 8/9/10 exports byte-unchanged.
- **Catalogue + DOMAIN_OVERRIDES wired:** 7 new tool catalogue entries in src/tools.js (all descriptions ≤200 chars; `scripts/audit-tool-descriptions.js` reports `[audit] OK — 101 tool descriptions pass`). 7 DOMAIN_OVERRIDES → "authz" entries in src/tools/meta/list-admin-tools.js. Tool-count moves 94 → 101.
- **Tool-count assertions bumped:** 3 test files × 3 locations = 9 bumps total (test/list-admin-tools.test.js, test/pipelines.test.js, test/dashboards.test.js). All comments + test names updated to reference Plan 11-02.
- **computeRoleCascadeHash byte-pins shipped (RED):** 7 new tests in test/cascade-hash.test.js (4 frozen-fixture PLACEHOLDERs + 1 cross-tool replay protection + 1 order-independence + 1 malformed-input rejection). Plan 11-02 will replace the 4 PLACEHOLDER hashes with real digests after shipping the function.
- **5 placeholder fixtures with _provenance:** test/fixtures/authz/roles/{list-roles, get-role-admin, get-role-members-reader, user-roles-admin, permissions-catalogue}-7.0.6.json — each has the _provenance block Plan 11-03's capture script will replace verbatim. The list-roles fixture seeds the 16 BUILT_IN_ROLES names so the static set and the test's parameterized loop stay in sync.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wave 0 offline test scaffold + 5 placeholder fixtures** — `8f10af8` (test)
2. **Task 2: 7 zod schemas + BUILT_IN_ROLES Set appended to schemas.js** — `e0430f4` (feat)
3. **Task 3: 7 tools.js catalogue entries + 7 DOMAIN_OVERRIDES entries** — `f5e2b41` (feat)
4. **Task 4: Bump tool-count assertions 94 → 101 across 3 test files** — `be97e0b` (test)
5. **Task 5: Extend test/cascade-hash.test.js with 7 byte-pinned tests** — `83539ad` (test)

**Plan metadata commit** — pending (worktree mode: orchestrator will create the merge commit; this SUMMARY.md is committed as part of the per-plan tail commit).

## Files Created/Modified

### Created (7)
- `test/authz-roles.test.js` — Wave 0 offline test scaffold (26 named tests; ROLE-01..07 + AUTHZ-01 + 4 MANDATORY safety gates + 2 parameterized 16-built-in refusal loops; uses `_setCaptureRequest` seam + `_testConnection` magic arg; RED until Plan 11-02 ships the 7 handlers + computeRoleCascadeHash export).
- `test/fixtures/authz/roles/list-roles-7.0.6.json` — placeholder with 16 built-in role entries (seeds BUILT_IN_ROLES).
- `test/fixtures/authz/roles/get-role-admin-7.0.6.json` — placeholder for single-role Admin response.
- `test/fixtures/authz/roles/get-role-members-reader-7.0.6.json` — placeholder with 3 synthetic users (alice/bob/carol).
- `test/fixtures/authz/roles/user-roles-admin-7.0.6.json` — placeholder for admin user-roles response.
- `test/fixtures/authz/roles/permissions-catalogue-7.0.6.json` — placeholder with 5 resource buckets (minimal viable for D-01 catalogue test).
- `.planning/phases/11-role-management/11-01-SUMMARY.md` — this file.

### Modified (6)
- `src/tools/authz/schemas.js` (+127 lines) — appends BUILT_IN_ROLES Set + 7 zod schemas after ShareEntitySchema. Phase 8/9/10 exports byte-unchanged.
- `src/tools.js` (+121 lines) — appends 7 tool catalogue entries between share_entity and list_admin_tools.
- `src/tools/meta/list-admin-tools.js` (+8 lines) — extends DOMAIN_OVERRIDES with 7 new tool-name → "authz" entries; updates banner comment to reference Phase 11.
- `test/list-admin-tools.test.js` (3 lines changed) — bumps 94 → 101 in test name (line 48), assertion + message (line 55), second count assertion (line 143).
- `test/pipelines.test.js` (3 lines changed) — renames test (line 396), extends lineage comment (line 428), bumps assertion + message (line 429).
- `test/dashboards.test.js` (3 lines changed) — extends lineage comment (line 1734), renames test (line 1738), bumps assertion + message (line 1744).
- `test/cascade-hash.test.js` (+141 lines) — extends import block with computeRoleCascadeHash, appends 7 new tests after the computeShareGrantHash block. Existing tests unchanged (21 computeShareGrantHash mentions preserved verbatim).

## Decisions Made

1. **BUILT_IN_ROLES lives in schemas.js, not role-helpers.js.** Plan 11-02 will ship `src/tools/authz/role-helpers.js` with the `assertRoleIsMutable(roleName)` function that consumes BUILT_IN_ROLES. But Plan 11-01's test/authz-roles.test.js needs to import the Set to drive the parameterized 16-built-in refusal loop (tests 22-24). Exporting the Set from schemas.js (which already exists and is imported elsewhere) means the test file can import it without forward-declaring a not-yet-existing helper module. Plan 11-02 re-exports it from role-helpers.js if it wants — schemas.js is the source of truth.

2. **PLACEHOLDER hashes use 00...00<N> with a distinct trailing nibble.** Tests 5a–5d each get a different last digit (...0, ...1, ...2, ...3) so a typo-induced collision (two tests accidentally asserting the same hash) is obvious on visual inspection. Plan 11-02 derives the real digests via the `node --input-type=module` one-liner documented in the banner comment and replaces each placeholder in a single fix-pin commit.

3. **Tool count moves to 101 in catalogue immediately (Task 3) but only registered when Plan 11-02 lands handlers.** This means `assertAllToolsRegistered` is RED in test/pipelines.test.js + test/dashboards.test.js for the duration of Plan 11-01, but the audit-tool-descriptions script reports `[audit] OK — 101 tool descriptions pass` because it only walks `toolDefinitions`. Plan 10-01 used the same pattern.

4. **5 mutating schemas extend mutatingBase + add `confirm: z.string().optional()`.** Mirrors ShareEntitySchema lines 115-119 verbatim. The wrapper's `requireConfirm` gate compares `args.confirm` against `req._confirmationToken` (handler.js:214) — schema-level `confirm` makes the apply-time echo a first-class input.

5. **5 placeholder fixtures over 1 mega-fixture.** Splitting into 5 files mirrors what Plan 11-03's scripts/capture-roles-fixtures.js will produce (one fixture per endpoint), so the Wave 0 fixture-load pattern matches the post-capture state exactly. The list-roles fixture explicitly seeds 16 entries (vs the simpler "Plan 11-03 fills it in" approach) so BUILT_IN_ROLES + the parameterized test loop stay in sync from day one.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Two tool descriptions exceeded 200-char budget**
- **Found during:** Task 3 (running `node scripts/audit-tool-descriptions.js`).
- **Issue:** `get_role` description was 206 chars (6 over); `create_role` description was 211 chars (11 over). The plan recommended descriptions verbatim, but copying them yielded:
  - `get_role`: "Get a single role by name with its members ({username, full_name, email}). Non-mutating. Members projected from /api/roles/{name}/members. Use to preview impact before update_role/delete_role/unassign_role." → 206 chars
  - `create_role`: "Create a custom role with a permission set. Defaults dryRun:true; agent must echo confirmationToken to apply. Validates permissions against /api/system/permissions (set permitUnknownPermissions:true to opt out)." → 211 chars
- **Fix:** Trimmed redundant phrases without losing discriminating substance:
  - `get_role` → "Get a single role by name with its members ({username, full_name, email}). Non-mutating. Use to preview impact before update_role/delete_role/unassign_role." (156 chars) — removed "Members projected from /api/roles/{name}/members." (covered by the function description already).
  - `create_role` → "Create a custom role with a permission set. Defaults dryRun:true; echo confirmationToken to apply. Validates permissions against /api/system/permissions (set permitUnknownPermissions:true to opt out)." (200 chars) — removed redundant "agent must".
- **Files modified:** src/tools.js (within the same commit f5e2b41).
- **Verification:** `node scripts/audit-tool-descriptions.js` exits 0; per-tool length probe confirms all 7 ≤200.
- **Committed in:** f5e2b41 (Task 3 commit).

---

**Total deviations:** 1 auto-fixed (1 bug — Rule 1).
**Impact on plan:** Auto-fix necessary for `audit-tool-descriptions.js` to pass. No scope creep; trimmed adjective phrases only, no discriminating content lost. The plan's `<acceptance_criteria>` explicitly anticipated this ("Trim adjective phrases if any exceed; never add unrelated synonyms").

## Issues Encountered
None — the plan's deviation rules anticipated the description-length overshoot and the worktree-cwd-drift / HEAD-namespace guards passed cleanly on every commit. All 5 task commits succeeded on first attempt with the documented safety assertions firing as designed.

## TDD Gate Compliance
Plan 11-01 is type=`execute` (Wave 0 RED scaffold), not type=`tdd`. The RED scaffold pattern is documented by D-21 and Plan 10-01 precedent: Task 2 (schemas) ships as `feat` because it provides a structural primitive (the input contract) consumed by the test file from Task 1; the tests are RED at module-load (ERR_MODULE_NOT_FOUND on missing handlers), not red-on-assertion. Plan 11-02 satisfies the RED→GREEN gate at the plan level by shipping the handlers + computeRoleCascadeHash + replacing the placeholder hashes.

## RED States Plan 11-02 Will Turn GREEN

These are the documented expected RED states this plan ships. Plan 11-02 turns them GREEN:

1. **test/authz-roles.test.js** — RED with `ERR_MODULE_NOT_FOUND` for `../src/tools/authz/list-roles.js` (and the 6 sibling handlers + computeRoleCascadeHash). `node --check` exits 0; `node --test` fails at module load. Plan 11-02 ships the handlers.
2. **test/cascade-hash.test.js** — RED with `ERR_MODULE_NOT_FOUND` for `computeRoleCascadeHash`. The existing computeCascadeHash / computeRuleCascadeHash / computeNotificationCascadeHash / computeShareGrantHash tests are still pinned but the whole file fails at module load. Plan 11-02 adds the export AND replaces the 4 PLACEHOLDER hashes in the same commit.
3. **test/pipelines.test.js + test/dashboards.test.js** — `assertAllToolsRegistered passes after Plan 11-02 end (count = 101; +role management)` test is RED because the 7 new toolDefinitions entries lack matching dispatch registrations. Plan 11-02's `src/tools/authz/index.js` register() calls turn it GREEN.

These RED states are the executable specification — when Plan 11-02 turns all three GREEN, every D-NN encoded by this plan is verified end-to-end.

## Verifications Performed

- `node --check test/authz-roles.test.js` → exits 0 (parse OK).
- `node --check src/tools/authz/schemas.js` → exits 0 (parse OK).
- `node --check test/cascade-hash.test.js` → exits 0 (parse OK).
- `node --check test/list-admin-tools.test.js test/pipelines.test.js test/dashboards.test.js` → all 3 exit 0.
- `node --input-type=module -e "<schema verify command>"` from Task 2 → prints `schemas OK` (14 valid parses, 3 invalid throws, BUILT_IN_ROLES size=16 + lowercase-only + Phase 8/9/10 exports unchanged).
- `node scripts/audit-tool-descriptions.js` → `[audit] OK — 101 tool descriptions pass (<=200 chars, discrimination sentence present)`.
- `grep` acceptance gates (4 MANDATORY safety gates, 2 16-built-in refusal loops, 16 BUILT_IN_ROLES entries, ≥26 named tests, ≥6 reason tags, ≥10 computeRoleCascadeHash mentions, ≥4 PLACEHOLDER mentions, 7 tools.js + 7 DOMAIN_OVERRIDES entries) all met or exceeded.
- `node --test test/authz-entity-shares.test.js` → 16/16 pass (Phase 9 regression check).
- `node --test test/authz-share-entity.test.js` → 26/26 pass (Phase 10 regression check).
- `node --test test/list-admin-tools.test.js` → 6/6 pass (inventory walks toolDefinitions which IS 101 now).
- Expected RED states confirmed: test/authz-roles.test.js + test/cascade-hash.test.js fail at module-load with ERR_MODULE_NOT_FOUND; `assertAllToolsRegistered` tests in test/pipelines.test.js + test/dashboards.test.js fail because 7 new toolDefinitions lack dispatch registrations.

## User Setup Required

None — this is a Wave 0 RED scaffold with zero new dependencies, zero environment variables, and zero external-service configuration. The 5 placeholder fixtures are committed with synthetic seed data; Plan 11-03's `scripts/capture-roles-fixtures.js` (gated, read-only) will overwrite them with live captures against the `test` connection.

## Next Phase Readiness

- **Plan 11-02 is unblocked:** all 7 zod schemas + BUILT_IN_ROLES Set + tools.js catalogue + DOMAIN_OVERRIDES are in place. Plan 11-02 ships `src/tools/authz/role-helpers.js` (assertRoleIsMutable, sortedPermissionsHash, sortedRolesHash, computePermissionsDiff, last-admin guard) + 7 handler files + `computeRoleCascadeHash` export in cascade-hash.js + register() calls in src/tools/authz/index.js. The test file (Task 1 product) IS the executable acceptance specification — handlers MUST produce assertions matching the 26 named tests.
- **Plan 11-03 is unblocked:** `scripts/capture-roles-fixtures.js` will overwrite the 5 placeholder fixtures with live captures from the `test` connection. The _provenance block shape is pinned (verbatim from scripts/capture-authz-prepare-fixture.js).
- **Concerns:** Zero. All 5 task commits applied cleanly; no scope creep; one auto-fix (description length trim) handled per Rule 1 inside the same task commit.

## Self-Check: PASSED

Verified all files exist and all commits are reachable:

- `test/authz-roles.test.js` → FOUND
- `test/fixtures/authz/roles/list-roles-7.0.6.json` → FOUND
- `test/fixtures/authz/roles/get-role-admin-7.0.6.json` → FOUND
- `test/fixtures/authz/roles/get-role-members-reader-7.0.6.json` → FOUND
- `test/fixtures/authz/roles/user-roles-admin-7.0.6.json` → FOUND
- `test/fixtures/authz/roles/permissions-catalogue-7.0.6.json` → FOUND
- `src/tools/authz/schemas.js` (BUILT_IN_ROLES + 7 schemas) → FOUND
- `src/tools.js` (7 entries) → FOUND
- `src/tools/meta/list-admin-tools.js` (7 DOMAIN_OVERRIDES) → FOUND
- `test/list-admin-tools.test.js` (3 bumps) → FOUND
- `test/pipelines.test.js` (3 bumps) → FOUND
- `test/dashboards.test.js` (3 bumps) → FOUND
- `test/cascade-hash.test.js` (+141 lines, 7 new tests) → FOUND
- Commit 8f10af8 (Task 1) → FOUND
- Commit e0430f4 (Task 2) → FOUND
- Commit f5e2b41 (Task 3) → FOUND
- Commit be97e0b (Task 4) → FOUND
- Commit 83539ad (Task 5) → FOUND

---
*Phase: 11-role-management*
*Completed: 2026-05-21*
