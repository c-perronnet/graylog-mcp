---
phase: 11-role-management
plan: 02
subsystem: authz
tags: [authz, roles, mutating-handler, drift-refusal, read-merge-write, builtin-role-refusal, last-admin-guard, write-path, wrapper-extension, opt-in-preview-cascades]

# Dependency graph
requires:
  - phase: 11-role-management
    plan: 01
    provides: "Wave 0 RED spec (test/authz-roles.test.js — 26 named tests + 4 MANDATORY safety gates), 7 zod schemas + BUILT_IN_ROLES Set (16 lowercased), tools.js catalogue + DOMAIN_OVERRIDES, 5 placeholder fixtures, 7 byte-pin cascade-hash tests with 4 PLACEHOLDER digests"
  - phase: 10-entity-sharing-write-path
    plan: 02
    provides: "defineMutatingHandler factory, _testConnection inline-object form, tagError pattern (factored out of share-entity.js:71-78 in this plan), requireConfirm gate, 400-with-body parser shape, read-merge-write discipline (PITFALL 1 acceptance gate carried forward verbatim for update_role permissions)"
  - phase: 09-entity-shares-read-path
    plan: 01
    provides: "Plain-async handler pattern (get-entity-shares.js / list-grantees.js — template for list-roles.js + get-role.js; NOT defineListHandler since responses aren't paginated lists)"
  - phase: 08-authz-foundation-grn-helper-live-api-recon
    plan: 01
    provides: "src/tools/authz/ domain, _setCaptureRequest seam, fixture-replay discipline, _provenance block convention, computeShareGrantHash standalone canonical-form precedent (template for computeRoleCascadeHash)"

provides:
  - "computeRoleCascadeHash (1 new export in src/tools/_shared/cascade-hash.js) — standalone canonical-form sha-256 keyed by `tool` discriminator; 5 byte-pinned tests pass with real digests"
  - "src/tools/authz/role-helpers.js (new module, 273 lines) — 7 exported helpers: assertRoleIsMutable, tagError, computePermissionsDiff, sortedPermissionsHash, sortedRolesHash, fetchPermissionCatalogue, validatePermissionsAgainstCatalogue + 1 test seam (_clearCatalogueCacheForTests)"
  - "7 role handlers in src/tools/authz/ — list-roles.js, get-role.js (plain-async); create-role.js, update-role.js, delete-role.js, assign-role.js, unassign-role.js (defineMutatingHandler). Wave 0's 26 RED tests now GREEN; tool count is 101; assertAllToolsRegistered passes."
  - "Opt-in `req.previewCascades` wrapper extension in defineMutatingHandler — surfaces cascades INSIDE preview when set; existing Phases 1-10 tools that snapshot the canonical {method,path,body} preview shape are unaffected (they don't set previewCascades). Phase 11 mutators set it so payload.preview.cascades.X reads work as the tests expect."
  - "Plan 11-01's RED → GREEN cycle completed: 4 PLACEHOLDER hashes replaced with real digests; 7 cascade-hash byte-pin tests GREEN; ≥26 authz-roles tests GREEN; npm test 1196/1196 GREEN (was 1170/RED with 26+ failures)."

affects:
  - "Plan 11-03 — Wave 4 fixture capture + dryRun-only live smoke probe. Plan 11-02 ships fully offline; Plan 11-03 runs scripts/capture-roles-fixtures.js against the live `test` connection to overwrite the 5 placeholder fixtures, then exercises each of the 7 tools at dryRun:true against live data."
  - "Phase 11 milestone close — throwaway-role HUMAN-UAT bundled with deferred Phase 10 share_entity throwaway-entity UAT at v3.1.0 close (per CONTEXT D-24)."
  - "Future role-management batch tools (deferred — v2-requirements): batch assign/unassign, list_role_members standalone tool, create_role_like blueprint."

# Tech tracking
tech-stack:
  added: []  # Zero new dependencies — composes against existing node:crypto + axios + zod
  patterns:
    - "Standalone canonical-form sha-256 (computeRoleCascadeHash) — mirrors Phase 8's computeShareGrantHash:303-339 over Phase 4's computeNotificationCascadeHash forwarding pattern. Chosen because role inputs don't map onto computeCascadeHash's {streamId, ruleIds, pipelineConnIds, eventDefIds} keyed-bucket shape."
    - "Per-connection module-scope cache (fetchPermissionCatalogue) keyed by `${conn.baseUrl}::${conn.apiToken}` — no expiry within session per D-05. Test seam (_clearCatalogueCacheForTests) follows the _clearForTests convention from src/clustering/index.js:27."
    - "Opt-in wrapper extension via req.previewCascades — non-breaking pattern for adding NEW envelope fields to defineMutatingHandler without churning frozen-form snapshot tests in upstream phases. The new field is conditional, the existing top-level cascades spread is preserved verbatim, and the existing tests pass unchanged."
    - "Iterable warnings shape via Object.assign(array, byCategoryObject) — the warnings object is BOTH an array (for spread-based test iteration) and has named-key per-category accessors (.includes_wildcard / .unknown_permissions). Resolves the test/handler shape mismatch without changing either contract."

key-files:
  created:
    - "src/tools/authz/role-helpers.js (273 lines — 7 helpers + 1 test seam; the new role-management vocabulary)"
    - "src/tools/authz/list-roles.js (76 lines — plain-async GET /api/roles + nameFilter projection)"
    - "src/tools/authz/get-role.js (71 lines — plain-async parallel GETs; D-08 members projection)"
    - "src/tools/authz/create-role.js (146 lines — defineMutatingHandler + D-01/03/04 catalogue + D-13 token)"
    - "src/tools/authz/update-role.js (197 lines — pre-flight GET + D-15 PITFALL 1 full-replace + D-19 server backstop + D-14 drift)"
    - "src/tools/authz/delete-role.js (157 lines — pre-flight GET role + members + D-16 cascade projection + D-14 drift)"
    - "src/tools/authz/assign-role.js (170 lines — pre-flight role + user-roles + body={} + D-10 already_member idempotency + D-14 drift)"
    - "src/tools/authz/unassign-role.js (181 lines — pre-flight + D-11 not_currently_assigned + D-17 LAST-ADMIN GUARD + D-14 drift)"
    - ".planning/phases/11-role-management/11-02-SUMMARY.md (this file)"
  modified:
    - "src/tools/_shared/cascade-hash.js (+96 lines — appended computeRoleCascadeHash; existing 4 exports byte-unchanged)"
    - "src/tools/_shared/handler.js (+19 lines — opt-in previewCascades inside preview block; existing flow byte-unchanged for callers that don't set it)"
    - "src/tools/authz/index.js (+12 lines — 7 new register() calls + 7 new imports + Phase 11 banner update; existing 3 register lines unchanged)"
    - "test/cascade-hash.test.js (4 PLACEHOLDER all-zeros digests replaced with real computed values + banner update; no test logic changes)"

key-decisions:
  - "computeRoleCascadeHash uses the STANDALONE canonical-form pattern (mirroring computeShareGrantHash) — NOT the forwarding pattern D-13 wording specified. Divergence documented in commit message + Task 1 action notes. Reason: computeCascadeHash's {streamId, ruleIds, pipelineConnIds, eventDefIds} keyed-bucket shape doesn't map cleanly onto role inputs {tool, name, permissions} (create/update/delete) or {tool, roleName, username, current_roles_hash} (assign/unassign). The functional contract D-13 cares about (cross-tool replay protection, byte-pinned fixtures, cross-name + cross-user replay prevention) is preserved verbatim. The plan-checker had already reviewed and accepted this deviation; the byte-pin tests Plan 11-01 ships are the canonical lock."
  - "computeRoleCascadeHash lives in src/tools/_shared/cascade-hash.js alongside its 3 sibling cascade-hash exports, NOT in src/tools/authz/role-helpers.js (CONTEXT D-13 'Claude's Discretion' line 67 suggested role-helpers.js). PATTERNS.md §'Per-File Analog Map' line 38 documents this convention: all cascade-hash functions ship in _shared/cascade-hash.js to preserve cohesion. The Discretion clause permits the override — cohesion with siblings wins over per-domain colocation."
  - "Wrapper extension to surface preview.cascades is OPT-IN via req.previewCascades, not a unilateral wrapper change. The first attempt unilaterally added cascades inside preview, which broke 10 snapshot tests in Phases 2-10 that pin the canonical {method,path,body} preview shape (delete_index_set, delete_input, delete_dashboard, delete_event_definition, delete_event_notification, delete_pipeline_rule, delete_stream). Reverted; replaced with opt-in pattern so existing tools stay byte-stable while Phase 11 mutators get cascade previews co-located with the HTTP call shape (where the agent's 'what's about to happen' view lives)."
  - "Warnings shape uses Object.assign(array, byCategoryObject) — the warnings object is simultaneously an Array (iterable for the test's `...(payload.preview.cascades.warnings ?? [])` spread) AND has named-key accessors (.includes_wildcard / .unknown_permissions). Resolves test 4 + 5's shape ambiguity without changing the test or splitting the field."
  - "assign-role.js and unassign-role.js deliberately DO NOT call assertRoleIsMutable (D-18 / AP4). Assigning a user TO a built-in role (e.g. adding someone to Reader or MCP Server Access) is legitimate — only MUTATING the role itself is refused. Both files have prominent header comments documenting the absence so future regressions don't accidentally add the check."
  - "Update + delete role handlers do the server-side read_only:true backstop (D-19) AFTER the pre-flight GET — the static BUILT_IN_ROLES check (assertRoleIsMutable, D-18) is fast-path only. Belt-and-braces; if a future Graylog version adds a new built-in not in our static set, the server's authoritative flag still refuses."

patterns-established:
  - "Opt-in wrapper field for envelope additions: `req.previewCascades` in defineMutatingHandler. When future phases need to surface NEW dry-run preview data without breaking snapshot tests in older phases, follow this pattern (new opt-in field; old behavior preserved as default)."
  - "Iterable+keyed warnings via Object.assign(array, byCategoryObject): for envelope fields that need to be BOTH iterable (for flexible test spread) AND structured (for typed accessors), Object.assign onto an array gives both."
  - "Pre-flight GET-and-tag pattern for handler.js step 5: all 5 role mutators do GET → if 404, tagError(err, 'role_not_found') → throw. The defineMutatingHandler wrapper's wrapGraylogError surfaces the tagged reason on the envelope's top-level `reason` field. Same shape as share-entity.js's apply() catch block but in build()."
  - "Last-admin guard as client-side instance-lockout protection (D-17): for any operation where the server has no equivalent guard AND a successful operation would leave the instance unrecoverable, the client MUST refuse with a structured reason. unassign-role.js's would_leave_no_admin is the template; future destructive operations should follow."

requirements-completed: [ROLE-01, ROLE-02, ROLE-03, ROLE-04, ROLE-05, ROLE-06, ROLE-07]
# AUTHZ-01 (milestone-spanning safety stack) is re-asserted by tests 25 + 26
# (connection_read_only short-circuit + dryRun:true default) but owned by Phase 10's plan.

# Metrics
duration: ~17min
completed: 2026-05-21
---

# Phase 11 Plan 02: Role-management handler composition — Wave 0 RED→GREEN Summary

**The 7-tool role-management surface ships: 1 cascade-hash wrapper + 1 helpers module + 7 handlers + 1 wrapper opt-in extension. Plan 11-01's 26 failing tests turn GREEN; 32 cascade-hash tests GREEN; full npm test 1196/1196 GREEN. All 4 MANDATORY safety acceptance gates verified (update_role PITFALL 1, delete_role cascade preview, assign_role body=={}, unassign_role last-admin guard).**

## Performance

- **Duration:** ~17 min (started 2026-05-21T10:04:01Z, completed 2026-05-21T10:21:21Z)
- **Tasks:** 3/3 atomic commits
- **Files modified:** 4 (cascade-hash.js, handler.js, authz/index.js, cascade-hash.test.js)
- **Files created:** 8 (role-helpers.js, 7 handler files)
- **Lines added:** ~1482 across the 12 changed files
- **Test suite:** 1170 → 1196 (26 new passes, 0 regressions)

## Accomplishments

- **Wave 0 RED → GREEN:** All 26 named tests in `test/authz-roles.test.js` pass. The 4 MANDATORY safety acceptance gates verified:
  - **update_role PITFALL 1** (D-15 full-replace): body contains `{name, description, permissions:[full target set], read_only:false}` — Test 8 grep-asserts every field
  - **delete_role cascade-preview** (D-16): `cascades.users_dissociated` is `[{username, roles_before, roles_after}]` — Test 12 verifies projection shape for 2 members
  - **assign_role body=={}** (Pitfall 3 / AP1): PUT body is `{}` literal empty object, NEVER `null` — Test 14 deep-equals `{}` AND asserts `!== null`
  - **unassign_role last-admin guard** (D-17 / Pitfall 5): refuses with `reason: "would_leave_no_admin"` when removing the only Admin would lock the instance out — Test 20 verifies the refusal message mentions "instance lockout"

- **Parameterized refusal loops GREEN:** 16 BUILT_IN_ROLES refused client-side on update + delete (Tests 22-23), case-insensitive variants pinned (Test 24).

- **Drift-refusal across all 4 mutator families GREEN:** update_role's current_permissions_hash (Test 11), delete_role's members_hash (Test 13), assign_role's current_roles_hash (Test 17), unassign_role's current_roles_hash (Test 21) — all 4 trip the wrapper's `confirmation_mismatch` gate when state changes between dry-run and apply.

- **Cross-cutting AUTHZ-01 safety GREEN:** all 5 mutators short-circuit with `connection_read_only` when `conn.writable === false` (Test 25); all 5 default `dryRun:true` (Test 26).

- **Permission catalogue validation wired:** create_role + update_role validate against `GET /api/system/permissions` (D-01 default-on). Wildcard `*` accepted with `cascades.warnings.includes_wildcard` surfacing the blast radius (D-03). `permitUnknownPermissions:true` opts out + surfaces `cascades.warnings.unknown_permissions[]` for enterprise-plugin permissions (D-04). Catalogue cached module-scope per `(baseUrl, apiToken)` per D-05.

- **computeRoleCascadeHash byte-pins GREEN:** 5 frozen-fixture tests in `test/cascade-hash.test.js` pass with real digests (the 4 PLACEHOLDER all-zeros were replaced; the 5th test cross-tool replay protection always passed). Cross-tool replay protection invariant verified by Test 5e (create_role X token ≠ update_role X token ≠ assign_role token ≠ unassign_role token, all on the same name).

- **Tool count = 101 + assertAllToolsRegistered GREEN:** The 7 new toolDefinitions entries from Plan 11-01 Task 3 now have matching dispatch registrations via the authz barrel. Tool-count assertions in test/list-admin-tools.test.js + test/pipelines.test.js + test/dashboards.test.js (bumped 94→101 in Plan 11-01 Task 4) now match reality.

- **Zero new dependencies:** Plan 11-02 ships with `node:crypto` (built-in) + `axios` (existing) + `zod` (existing). RESEARCH §"Package Legitimacy Audit" prediction validated.

## Task Commits

Each task committed atomically:

1. **Task 1: computeRoleCascadeHash + 4 PLACEHOLDER pins replaced** — `e798467` (feat)
   - Appended ~96 lines to `src/tools/_shared/cascade-hash.js` (standalone canonical-form, sibling to computeShareGrantHash)
   - Replaced 4 all-zeros placeholders in test/cascade-hash.test.js with real digests
   - 32/32 cascade-hash tests GREEN

2. **Task 2: role-helpers.js — 7 helpers + per-conn catalogue cache** — `9daa01d` (feat)
   - Created `src/tools/authz/role-helpers.js` (273 lines)
   - assertRoleIsMutable + tagError + computePermissionsDiff + sortedPermissionsHash + sortedRolesHash + fetchPermissionCatalogue + validatePermissionsAgainstCatalogue + _clearCatalogueCacheForTests (test seam)
   - 12-assertion inline verification passes

3. **Task 3: 7 role handlers + barrel + opt-in preview.cascades wrapper extension** — `3d8fdea` (feat)
   - Created 7 handler files in `src/tools/authz/` (list-roles, get-role, create-role, update-role, delete-role, assign-role, unassign-role)
   - Extended `src/tools/authz/index.js` barrel with 7 new register() calls + 7 imports
   - Extended `src/tools/_shared/handler.js` with opt-in `req.previewCascades` field (3 lines of net behavior change; preserves byte-shape for all 30+ existing tools)
   - 26/26 Wave 0 tests GREEN; full npm test 1196/1196 GREEN

**Plan metadata commit:** pending (worktree mode — orchestrator creates the merge commit; this SUMMARY.md is committed as the final per-plan commit below).

## Files Created/Modified

### Created (8)
- `src/tools/authz/role-helpers.js` — 273 lines; new role-management vocabulary module (7 exported helpers + 1 test seam)
- `src/tools/authz/list-roles.js` — 76 lines; plain-async handler mirroring list-grantees.js shape
- `src/tools/authz/get-role.js` — 71 lines; plain-async parallel GETs with D-08 member projection
- `src/tools/authz/create-role.js` — 146 lines; defineMutatingHandler with D-01/03/04 catalogue validation
- `src/tools/authz/update-role.js` — 197 lines; defineMutatingHandler with PITFALL 1 full-replace + D-19 backstop
- `src/tools/authz/delete-role.js` — 157 lines; defineMutatingHandler with D-16 cascade projection
- `src/tools/authz/assign-role.js` — 170 lines; defineMutatingHandler with body={} + D-10 idempotency
- `src/tools/authz/unassign-role.js` — 181 lines; defineMutatingHandler with D-11 + D-17 LAST-ADMIN GUARD
- `.planning/phases/11-role-management/11-02-SUMMARY.md` — this file

### Modified (4)
- `src/tools/_shared/cascade-hash.js` (+96 lines) — appended computeRoleCascadeHash export; existing 4 exports byte-unchanged
- `src/tools/_shared/handler.js` (+19 lines) — added opt-in `req.previewCascades` inside preview block (one line + 18 lines of doc comment explaining why)
- `src/tools/authz/index.js` (+12 lines) — 7 new register() calls + 7 imports + Phase 11 banner update
- `test/cascade-hash.test.js` (4 hashes changed + banner update) — 4 all-zeros PLACEHOLDERs replaced with real digests; banner updated to reflect post-pin state

## Decisions Made

1. **computeRoleCascadeHash is STANDALONE, not a forwarding wrapper (divergence from CONTEXT D-13 wording).** D-13 specifies "a thin forwarding wrapper around computeCascadeHash". The actual implementation is standalone canonical-form (mirroring computeShareGrantHash:303-339). Reason: computeCascadeHash's input shape `{streamId, ruleIds, pipelineConnIds, eventDefIds}` doesn't map cleanly onto role inputs `{tool, name, permissions}` (create/update/delete) or `{tool, roleName, username, current_roles_hash}` (assign/unassign). The functional contract D-13 cares about (cross-tool replay protection, byte-pinned fixtures, cross-name + cross-user replay prevention) is preserved verbatim. Plan 11-02 documented this divergence in Task 1's action notes; the plan-checker had reviewed and accepted it. The byte-pin tests Plan 11-01 ships are the canonical lock.

2. **computeRoleCascadeHash lives in src/tools/_shared/cascade-hash.js, not role-helpers.js (divergence from CONTEXT 'Discretion' line 67).** PATTERNS.md §"Per-File Analog Map" line 38 documents the convention: all cascade-hash functions ship in _shared/cascade-hash.js to preserve cohesion. The Discretion clause in CONTEXT.md permits this override.

3. **Opt-in wrapper extension for preview.cascades, not unilateral change.** The first attempt unilaterally added cascades inside preview, which broke 10 snapshot tests in Phases 2-10 (delete_index_set, delete_input, delete_dashboard, delete_event_definition, delete_event_notification, delete_pipeline_rule, delete_stream — each pins the canonical `preview: {method, path, body}` shape exactly). Reverted; replaced with opt-in pattern via `req.previewCascades`. Existing tools that don't set the field are byte-unchanged; Phase 11 mutators set it so the new `payload.preview.cascades.X` reads (D-15 diff, D-16 users_dissociated, D-10 current_roles + roles_after_apply, D-03 warnings) work as the tests expect.

4. **Warnings shape uses Object.assign(array, byCategoryObject).** The warnings object is BOTH iterable (Array.prototype methods + spread) AND has named-key accessors (.includes_wildcard / .unknown_permissions). Resolves the ambiguity in tests 4 + 5 without changing either the tests or splitting warnings into two separate fields. The Object.assign pattern preserves Array's iterable nature while attaching named properties.

5. **assign-role.js + unassign-role.js deliberately omit assertRoleIsMutable.** Both have prominent header comments (assign-role.js:14, unassign-role.js:12) documenting the absence per D-18 / AP4. Assigning a user TO a built-in role (e.g. adding someone to Reader or MCP Server Access) is legitimate — only MUTATING the role itself is refused (which is what update_role + delete_role check). The grep gates in the plan's acceptance criteria verify this asymmetry.

6. **Catalogue cache reset on each fetch when conn.baseUrl/apiToken are absent.** The fetchPermissionCatalogue function derives the cache key as `${baseUrl}::${apiToken}` — for the test-seam synthetic conn `{baseUrl:"_test", apiToken:"_test"}`, this IS a derivable key, so caching works in tests. Production conns always have both fields.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Wrapper extension required to surface preview.cascades**

- **Found during:** Task 3, after first test run (3 tests failed: test 10 update_role diff, test 12 delete_role cascade, test 15 assign_role current_roles).
- **Issue:** Plan 11-01's tests assert `payload.preview.cascades.{diff, users_dissociated, current_roles, warnings}`. The existing `defineMutatingHandler` (handler.js:148-149) places `cascades` at the TOP LEVEL of the payload, not inside `preview`. So `payload.preview.cascades` was undefined, causing "Cannot read properties of undefined" failures in 3 tests.
- **Fix attempt 1 (REVERTED):** Unilaterally added `...(req.cascades ? { cascades: req.cascades } : {})` inside the preview block. This made the 3 Wave 0 tests pass BUT broke 10 snapshot tests in Phases 2-10 that pin the canonical `preview: {method,path,body}` shape (delete_index_set, delete_input, delete_dashboard, delete_event_definition, delete_event_notification, delete_pipeline_rule × 2, delete_stream × 2).
- **Fix attempt 2 (FINAL):** Reverted; replaced with OPT-IN `req.previewCascades` field. Handlers that set `previewCascades = cascades` get the cascade preview co-located inside the preview block; handlers that don't set it are byte-unchanged. All 5 Phase 11 mutators set both `cascades` AND `previewCascades` to the same object so both `payload.cascades.X` (existing contract) and `payload.preview.cascades.X` (new Phase 11 contract) reads work.
- **Files modified:** `src/tools/_shared/handler.js` (+19 lines: +1 line of opt-in spread, +18 lines of doc comment explaining the pattern), all 5 mutator files (added `previewCascades: cascades` to each descriptor).
- **Verification:** `npm test` 1196/1196 GREEN (10 previously-passing snapshot tests stay passing; 3 previously-failing Wave 0 tests now pass).
- **Committed in:** 3d8fdea (Task 3 commit).

**2. [Rule 1 - Bug] Warnings shape mismatch caused test 6 spread to fail**

- **Found during:** Task 3 (after Rule 2 fix above; 25/26 passing with test 6 failing).
- **Issue:** Test 6 (`create_role accepts wildcard '*'`) does `...(payload.preview?.cascades?.warnings ?? [])`. My initial implementation made `warnings` a plain object `{includes_wildcard: [...]}`. The spread operator on a non-iterable object throws `TypeError: ((intermediate value) ?? []) is not iterable`. (`?? []` only fires for null/undefined, not for objects.)
- **Fix:** Made `warnings` BOTH an Array (iterable) AND a named-key object via `Object.assign([...warningsArray], warningsByCategory)`. The array elements are the flat human-readable strings; the named keys (.includes_wildcard / .unknown_permissions) provide per-category structured access.
- **Files modified:** `src/tools/authz/create-role.js` (warnings construction).
- **Verification:** Test 6 GREEN; tests 4 + 7 (which use both shapes) also GREEN.
- **Committed in:** 3d8fdea (Task 3 commit).

---

**Total deviations:** 2 auto-fixed (1 missing-feature Rule 2, 1 bug Rule 1).
**Impact on plan:** Both fixes were necessary to satisfy the Wave 0 specification. Neither introduces new dependencies or expands scope; both are minimal, surgical changes (one to the wrapper opt-in, one to the warnings construction). The wrapper change is documented as a new established pattern in the SUMMARY frontmatter so future phases can leverage opt-in envelope fields without breaking older snapshot tests.

## Authentication Gates

None — Plan 11-02 ships fully offline. All test paths use `_testConnection` magic arg or the inline-object form; no live HTTP. Plan 11-03 introduces the live `test` connection probe for fixture capture + dryRun smoke probes.

## Issues Encountered

None unrecoverable. The two deviations above were anticipated to be possible (the plan's <interfaces> note explicitly flagged that cascades is at top-level in handler.js:165, and the warnings shape ambiguity surfaced because tests 4-6 accept multiple valid shapes). Auto-fix attempt count: 3/3 used for Task 3 (Rule 2 wrapper extension attempt 1 reverted, attempt 2 finalized as opt-in; Rule 1 warnings shape fix). All within the 3-attempt limit.

## TDD Gate Compliance

Plan 11-02 is type=`execute` (handler composition, not type=`tdd`). The RED→GREEN gate is enforced at the plan level: Plan 11-01 shipped the failing tests (test/authz-roles.test.js + test/cascade-hash.test.js byte-pin additions); Plan 11-02's 3 commits turn them GREEN.

Per-task TDD-style RED → GREEN sequence:
1. Task 1 commit `e798467` is `feat` because it ships the function AND replaces the placeholders in a single commit (the plan instructed this — fix-pin commits in computeNotificationCascadeHash + computeShareGrantHash use the same pattern). The RED state was Plan 11-01's PLACEHOLDER all-zeros assertions; the GREEN state is the real-digest assertions in the same commit.
2. Task 2 commit `9daa01d` is `feat` because it ships a new module (role-helpers.js) as a foundational primitive — the handlers in Task 3 depend on it. No tests target role-helpers.js directly (it's exercised indirectly via the handler tests in Task 3).
3. Task 3 commit `3d8fdea` is `feat` because it ships 7 new handler files + the wrapper opt-in extension. The Wave 0 tests in test/authz-roles.test.js (Plan 11-01 product) turn from 0/RED (ERR_MODULE_NOT_FOUND at module load) to 26/GREEN.

## Verifications Performed

- `node --check src/tools/_shared/cascade-hash.js` → exits 0 (parse OK)
- `node --check src/tools/authz/role-helpers.js` → exits 0
- `node --check` on each of the 7 handler files + the authz barrel + the wrapper → all exit 0
- `node --test test/cascade-hash.test.js` → 32/32 pass (was 0/RED)
- `node --test test/authz-roles.test.js` → 26/26 pass (was 0/RED at module load)
- `node --test test/list-admin-tools.test.js` → 6/6 pass
- `node --test test/pipelines.test.js` → `assertAllToolsRegistered passes after Plan 11-02 end (count = 101)` GREEN
- `node --test test/dashboards.test.js` → assertAllToolsRegistered GREEN
- `npm test` → 1196/1196 GREEN (was 1170/RED)
- Grep gates (Task 3 acceptance):
  - `assign-role.js` has `body: {}` (2 occurrences) AND `body: null` returns 0 ✓
  - `update-role.js` body includes `name + description + permissions + read_only:false` (8 matches) ✓
  - `delete-role.js` has `cascades.users_dissociated + roles_before + roles_after` (9 matches) ✓
  - All 5 mutators import computeRoleCascadeHash (5/5 files) ✓
  - assertRoleIsMutable call-sites: 0 in assign/unassign (only documentation comments mentioning the absence), ≥1 each in create/update/delete ✓
  - Server `read_only` backstop in update + delete (2 matches each) ✓
  - `would_leave_no_admin` only in unassign-role.js + schemas.js (JSDoc) — only handler that contains it ✓
  - No `/prepare` endpoint hits in handler code (only 1 comment reference in assign-role.js explaining the body={} discipline lineage) ✓
  - No `await_system_job` / `awaitSystemJob` / `pollJob` in any handler ✓
  - No fenced code blocks in handler files ✓
- All 4 MANDATORY safety acceptance gates from Plan 11-01 verified GREEN by test names:
  - "update_role PITFALL 1 ACCEPTANCE GATE" — Test 8 ✓
  - "delete_role cascade-preview lists members in cascades.users_dissociated" — Test 12 ✓
  - "assign_role apply body equals {} (literal empty object) NEVER null" — Test 14 ✓
  - "unassign_role refuses with reason=would_leave_no_admin when removing the last Admin" — Test 20 ✓

## User Setup Required

None — Plan 11-02 ships fully offline with zero new dependencies + zero environment variables + zero external-service configuration. Plan 11-03 will introduce the live-fixture-capture script and the dryRun-only smoke probe.

## Next Phase Readiness

- **Plan 11-03 is unblocked.** The 7 handlers are wired and exercise correctly against the placeholder fixtures. Plan 11-03's `scripts/capture-roles-fixtures.js` overwrites the placeholder fixtures with live captures; the 7-tool dryRun smoke probe exercises each handler against the live `test` connection (read or dryRun=true; no mutations).
- **Throwaway-role HUMAN-UAT is unblocked.** Per CONTEXT D-24, the throwaway-role full-lifecycle UAT (create custom role → update permissions → assign dedicated test user → unassign → delete) ships at v3.1.0 milestone close bundled with Phase 10's deferred share_entity throwaway-entity UAT. Plan 11-02's defineMutatingHandler composition + opt-in dryRun + drift-refusal + last-admin guard surface IS the substrate the UAT exercises.
- **Concerns:** Zero. All 3 task commits applied cleanly; all 26 Wave 0 tests GREEN; full npm test 1196/1196 GREEN. The 2 deviations (Rule 1 + Rule 2) were anticipated, minimal, and documented.

## Known Stubs

None. Every handler ships fully wired to Graylog's API:
- `list-roles.js` → real `GET /api/roles`
- `get-role.js` → real parallel `GET /api/roles/{n}` + `.../members`
- `create-role.js` → real `POST /api/roles` (with catalogue pre-flight)
- `update-role.js` → real pre-flight `GET /api/roles/{n}` + `PUT` with full-replace body
- `delete-role.js` → real pre-flight `GET /api/roles/{n}` + `.../members` + `DELETE`
- `assign-role.js` → real pre-flight `GET /api/roles/{n}` + `.../user/{u}` + `PUT .../members/{u}` body={}
- `unassign-role.js` → real pre-flight + `GET /api/roles/Admin/members` (last-admin guard) + `DELETE .../members/{u}`

No mocked data flows to UI/agent; the 5 placeholder fixtures used by the offline tests are documented as Plan 11-03's overwrite target via `_provenance` blocks.

## Self-Check: PASSED

Verified all files exist and all commits are reachable:

- `src/tools/_shared/cascade-hash.js` → FOUND
- `src/tools/authz/role-helpers.js` → FOUND
- `src/tools/authz/list-roles.js` → FOUND
- `src/tools/authz/get-role.js` → FOUND
- `src/tools/authz/create-role.js` → FOUND
- `src/tools/authz/update-role.js` → FOUND
- `src/tools/authz/delete-role.js` → FOUND
- `src/tools/authz/assign-role.js` → FOUND
- `src/tools/authz/unassign-role.js` → FOUND
- `src/tools/_shared/handler.js` → FOUND (modified)
- `test/cascade-hash.test.js` → FOUND (4 PLACEHOLDERs replaced)
- Commit e798467 (Task 1) → FOUND
- Commit 9daa01d (Task 2) → FOUND
- Commit 3d8fdea (Task 3) → FOUND

---
*Phase: 11-role-management*
*Completed: 2026-05-21*
