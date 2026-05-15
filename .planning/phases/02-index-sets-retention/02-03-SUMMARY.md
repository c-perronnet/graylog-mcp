---
phase: 02-index-sets-retention
plan: 03
subsystem: api
tags: [index-sets, delete, c1-centerpiece, confirmation-token, sha256, async-envelope, nd1, d-01, d-02, d-03, d-04, d-05, d-15-updated, d-16]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: defineMutatingHandler, makeClient, mutatingBase, GraylogValidationError, wrapGraylogError, idempotency helper pattern (createHash)
  - phase: 01-inputs-extractors
    provides: per-domain folder layout, A4 async build pattern, GraylogValidationError + err.reason convention (used by Plan 02-02's ND2 refusal)
  - phase: 02-index-sets-retention/02-01
    provides: _confirmationToken forwarding from build() into dry-run preview JSON; requireConfirm({args, req}) → token|null apply-time gate (handler.js); GraylogValidationError + err.reason structural-error pattern; index-sets domain barrel + register
  - phase: 02-index-sets-retention/02-02
    provides: ND-pre-flight + structural-error shape (default_index_set_must_be_writable mirror; Plan 02-03's ND1 default_index_set_undeletable copies the pattern verbatim)
provides:
  - "src/tools/index-sets/c1-hash.js — computeC1Hash + collectIndexNames pure helpers (sha-256 over canonical JSON, AllIndices walk + dedupe)"
  - "src/tools/index-sets/schemas.js — DeleteIndexSetSchema extending mutatingBase with indexSetId + deleteIndices (default false, D-04 inverted) + optional confirm"
  - "src/tools/index-sets/delete-index-set.js — INDEX-05 handler composing defineMutatingHandler + C1 hash + ND1 pre-flight + D-05 stats hard-block + requireConfirm gate + UPDATED D-15 no-job_id envelope"
  - "wrapGraylogError enhancement: err.reason now surfaces as ' [reason: <name>]' suffix in rendered text AND as a top-level out.reason property on the MCP error envelope (Rule 2)"
affects: ["02-04 (set_default_index_set + cycle_deflector can reuse the ND-pre-flight + structural-error pattern this plan extends from Plan 02-02)", "02-05 (schema-parity now covers 6 of 8 phase-2 mutating tools; snapshot fixtures pending — confirmationToken context already allowlisted in the auth-redaction lint)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Deterministic sha-256 confirmation-token pattern: pure helper computes hash over canonical JSON of dry-run state; build() routes via _confirmationToken (preview forwarding) + requireConfirm (apply-time gate). Recomputation every dry-run is the binding mechanism — no MCP-side memory, survives process restarts."
    - "Frozen-fixture hash assertion: pin the first-run hash value as a literal in the test. Drift means the canonicalization shape changed — a dry-run → apply binding break for every agent."
    - "D-04 inverted-default pattern: when the upstream server has a destructive @DefaultValue(true), the MCP wrapper inverts to false in the zod schema. The dry-run preview EXPLICITLY emits the value (even when defaulted) so the agent sees the safety choice in writing."
    - "D-05 hard-block on pre-flight failure: a thrown GraylogValidationError with err.reason interrupts dry-run before any confirmation token is issued. Safety override — operational robustness must not override blast-radius visibility for destructive operations."
    - "ND1 pre-flight fires FIRST, regardless of destructive-flag value: the wrapper's ND-check runs before the deleteIndices branch split because Graylog's server-side default-check happens first too. Consistent error shape across the deleteIndices:true and deleteIndices:false paths."
    - "UPDATED D-15 no-job_id envelope: when the upstream HTTP response is 204 with no body, the wrapper deliberately omits job_id from the async envelope. The message field carries the target id so the agent can discover the running job via await_system_job's info_substring path."
    - "wrapGraylogError reason surface: err.reason — when set on a thrown GraylogValidationError — is now visible to the agent in BOTH the rendered text (suffix) and as a structured property on the MCP envelope (out.reason). Programmatic identification surface preserved."

key-files:
  created:
    - "src/tools/index-sets/c1-hash.js"
    - "src/tools/index-sets/delete-index-set.js"
    - ".planning/phases/02-index-sets-retention/02-03-SUMMARY.md"
  modified:
    - "src/tools/index-sets/schemas.js (DeleteIndexSetSchema added)"
    - "src/tools/index-sets/index.js (register delete_index_set)"
    - "src/tools.js (toolDefinitions entry — 40 → 41 tools)"
    - "src/tools/_shared/errors.js (Rule 2: wrapGraylogError surfaces err.reason)"
    - "test/index-sets.test.js (+20 tests)"
    - "test/schema-parity.test.js (+1 parity assertion)"

key-decisions:
  - "deleteIndices defaults to FALSE in DeleteIndexSetSchema (D-04 inverted from Graylog's @DefaultValue(true)). The dry-run preview emits the value explicitly via postApplyEstimate.deletedIndices: false even when the agent did not pass the field — the safety choice is in writing."
  - "computeC1Hash refuses deleteIndices !== true (D-02 locked literal). A hash issued for any other value can never validate against a true-mode apply call — replay protection layered on top of the dry-run/apply recomputation. Tested explicitly: false, undefined, and the string 'true' all throw."
  - "collectIndexNames walks closed.indices Set + reopened.indices Set + all.indices Map keys with Set-deduplication. Tolerant of empty/missing sub-collections (returns []) so a 404 on the /list endpoint can be best-effort (still computable, the hash incorporates messageCount as the second sensitivity axis)."
  - "ND1 pre-flight (GET /system/indices/index_sets/<id>; refuse if current.default === true) fires BEFORE the deleteIndices branch split. Graylog's BadRequestException 'Default index set cannot be deleted!' fires regardless of delete_indices value, so the wrapper-side check is also default-first — consistent error shape across both paths (Test 8 + Test 12 prove)."
  - "D-05 stats_unreachable is a HARD BLOCK, not a degraded path: GET /stats failure → GraylogValidationError(reason: 'stats_unreachable') → wrapGraylogError → MCP error envelope. NO confirmation token issued. The agent cannot reason about destruction blast radius without messageCount; the block is the deliberate safety choice."
  - "Index-list pre-flight (GET /indexer/indices/<id>/list) is BEST-EFFORT: 404/403 falls back to the empty AllIndices shape. The hash is still computable (messageCount may still be nonzero if /stats succeeds independently); the cascade preview shows an empty indices list. Distinct semantic from /stats — losing the list doesn't lose blast-radius visibility because messageCount is sourced separately."
  - "UPDATED D-15 envelope: { async: true, job_id_observable_at: '/system/jobs', message: 'Submitted cleanup for index set <id>; await via /system/jobs (call await_system_job with info_substring: \"<id>\")' }. job_id deliberately ABSENT. Graylog's DELETE returns 204 with no body — there is no server-supplied id to forward; the message field carries the indexSetId substring so the agent's await_system_job(info_substring) path resolves to the IndexSetCleanupJob."
  - "Writable gate (D-16) fires BEFORE the confirmation gate (D-01). handler.js order: zod.parse → resolveConnection → writable gate (step 3) → idempotency → build (step 5) → dry-run-or-confirm (step 6/6b) → apply. Test 11 proves a read-only connection refuses with reason connection_read_only and ZERO pre-flight GETs fire (defense in depth: no side effects against a connection that can never apply)."
  - "wrapGraylogError extended (Rule 2): err.reason now rendered as ' [reason: <name>]' suffix in the MCP error text AND propagated as out.reason on the envelope. Plan 02-02 set err.reason on update_index_set's ND2 refusal but the field was invisible to callers because wrapGraylogError ignored it. Plan 02-03's three structural reasons (default_index_set_undeletable, stats_unreachable, confirmation_mismatch) need the surface — additive, no existing thrower depends on field's absence."

patterns-established:
  - "C1 confirmation-hash pattern: pure helper (c1-hash.js) + dry-run forwarding (_confirmationToken on req) + apply-time gate (requireConfirm callback). Reusable for any future destructive tool — Phase 3+ blueprint actions that delete intermediate state, Phase 5 event-definition deletion that wipes alert history. Cost: one helper + one schema field + one returns-token-or-null callback."
  - "Pre-flight pair with mixed disposition (best-effort + hard-block): index-list is best-effort (404 → empty shape); stats is hard-block (any throw → structured error, no token). Both pre-flights live in build() because the request descriptor needs the data; the disposition difference is encoded in try/catch blocks per call."
  - "Frozen-fixture hash assertion: pin the actual hash output on FIRST run as a literal string in the test. Adapt the input vector to make the canonicalization shape easy to verify by inspection (small indexSetId, two known names, small messageCount). Drift in the canonical shape — key reorder, locked-literal swap, sort omission — fails the test loudly."

requirements-completed: [INDEX-05]

# Metrics
duration: ~10 min
completed: 2026-05-15
---

# Phase 2 Plan 3: delete_index_set Summary

**INDEX-05 — the C1 mitigation centerpiece — shipped end-to-end via a deterministic sha-256 confirmation token over { indexSetId, deleteIndices:true (locked literal), sorted indexNames, messageCount } plus ND1 default-index-set refusal, D-05 stats-unreachable hard-block, D-04 inverted default, D-16 writable-before-confirm ordering, and the UPDATED D-15 no-job_id apply envelope. ROADMAP success criterion 1 provably met.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-15T14:51:28Z
- **Completed:** 2026-05-15T14:59:09Z
- **Tasks:** 2 (both TDD: RED → GREEN per task)
- **Files modified:** 9 (3 created + 6 modified)
- **Tests added:** +21 (302 baseline → 323 total — 8 c1-hash/collectIndexNames + 12 delete_index_set handler + 1 schema-parity)
- **Tool count:** 40 → 41 (delete_index_set)

## Accomplishments

- **`src/tools/index-sets/c1-hash.js` ships two pure helpers**:
  - `computeC1Hash({ indexSetId, deleteIndices, indexNames, messageCount })` returns the 64-hex sha-256 over canonical JSON. `deleteIndices` MUST be the literal `true`; any other value throws (D-02 replay protection — a hash issued for any other input value can never validate against a true-mode apply). Sorts `indexNames` internally so the agent does not need to pre-sort.
  - `collectIndexNames(allIndices)` walks Graylog's AllIndices DTO shape (`closed.indices` Set + `reopened.indices` Set + `all.indices` Map keys) into a deduped string array. Tolerant of empty/missing sub-collections (returns `[]`). Verified against `source-code/.../AllIndices.java`.

- **Frozen-fixture hash assertion**: Test 1 pins the literal sha-256 hash for a known input vector — `{ indexSetId: "iset-1", deleteIndices: true, indexNames: ["graylog_0","graylog_1"], messageCount: 100 } → 3371c65813c7a3acce20d96371b8df8ba6b1ae5d672309962fbf236b065ba6a0`. Drift in canonicalization shape (key reorder, locked-literal swap, sort omission) fails the test loudly. Test 5 (empty index set hash) and Test 6 (populated index set hash) also pin their respective frozen-fixture values:
  - Empty (`indexNames: [], messageCount: 0`): `ed22c223ab80ce359fbb3d00b3ca46a76f99cbe07a658c1f3a3e644c5c337d1d`
  - Populated (`indexNames: ["graylog_0","graylog_1","graylog_2"], messageCount: 12345`): `d5f10faaada8fc8f558b1a53cc8777a83fd73fa9172aa65fb36728ff246583c0`

- **`DeleteIndexSetSchema` extends `mutatingBase`** with `indexSetId` (required), `deleteIndices` (default false — D-04 inversion), and `confirm` (optional string echoed back to the requireConfirm gate). Per-shape parity verified by `assertSchemaParityForTool("delete_index_set", ...)`.

- **`delete_index_set` handler** composes through `defineMutatingHandler`:
  - **ND1 pre-flight** (FIRST, regardless of `deleteIndices` value): `GET /api/system/indices/index_sets/<id>` and refuse if `current.default === true` with `GraylogValidationError(reason: "default_index_set_undeletable")`. Mirrors Plan 02-02's ND2 pattern.
  - **`deleteIndices:false` path (D-03 metadata-only)**: emit `DELETE /api/system/indices/index_sets/<id>?delete_indices=false` with `body: undefined`, `postApplyEstimate: { id, deletedIndices: false }`. NO confirmationToken, NO cascades, NO async envelope. `requireConfirm` returns `null` → the gate is a no-op.
  - **`deleteIndices:true` path (D-01/D-02 destruction)**: pre-flight `GET /indexer/indices/<id>/list` (best-effort: 404/403 → empty AllIndices shape) + `GET /index_sets/<id>/stats` (HARD-BLOCK per D-05: any throw → `GraylogValidationError(reason: "stats_unreachable")` → no token issued). Compute `computeC1Hash({ indexSetId, deleteIndices: true, indexNames, messageCount })`; surface as `confirmationToken` in dry-run + `cascades: { indices (sorted), messageCount, indexCount }`. Apply envelope per UPDATED D-15: `{ async: true, job_id_observable_at: "/system/jobs", message: "Submitted cleanup for index set <id>; await via /system/jobs (call await_system_job with info_substring: \"<id>\")" }` with NO `job_id` field.
  - **Apply-time gate** via `requireConfirm: ({ req }) => req._confirmationToken ?? null`. handler.js (Plan 02-01) refuses with `isError reason: 'confirmation_mismatch'` when `args.confirm !== expected`. Writable gate (D-16) still fires BEFORE — defense in depth.

- **Tool description** spells out the full discovery flow including the `await_system_job(info_substring: <indexSetId>)` path for the IndexSetCleanupJob (UPDATED D-15) plus the D-04 inversion warning + D-05 hard-block + ND1 default refusal.

- **`wrapGraylogError` enhancement (Rule 2 deviation)**: `err.reason` now renders as a `" [reason: <name>]"` suffix in the MCP error text AND propagates as a top-level `out.reason` property on the envelope. Plan 02-02 set `err.reason` on `update_index_set`'s ND2 refusal but the field was invisible to callers because `wrapGraylogError` ignored it. The structured-reason surface is what the agent uses to programmatically identify the error type. Additive — no existing thrower depends on the absence.

## Task Commits

Each task was committed atomically as a RED → GREEN TDD pair:

1. **Task 1: c1-hash + collectIndexNames helpers** (8 tests)
   - RED: `21d2b7d` (test)
   - GREEN: `37ce96e` (feat)
2. **Task 2: delete_index_set handler (INDEX-05)** (12 handler tests + 1 schema-parity)
   - RED: `a4e5fdb` (test)
   - GREEN: `6c57864` (feat — INCLUDES the Rule 2 wrapGraylogError enhancement)

**Plan metadata commit:** to be added after this SUMMARY + STATE.md update.

## Files Created/Modified

### Created (3)

- `src/tools/index-sets/c1-hash.js` — `computeC1Hash` (sha-256 over canonical JSON; locked-literal D-02; sorts indexNames before hashing) + `collectIndexNames` (walks AllIndices shape with Set-dedupe). Pure helpers; no I/O.
- `src/tools/index-sets/delete-index-set.js` — `handleDeleteIndexSet`: defineMutatingHandler composition with async build() doing ND1 pre-flight → branch on `deleteIndices` → metadata-only OR (best-effort /list + hard-block /stats + computeC1Hash + UPDATED D-15 envelope). apply() returns the same envelope shape with the indexSetId-bearing message extracted from req.path. requireConfirm callback returns `req._confirmationToken ?? null`.
- `.planning/phases/02-index-sets-retention/02-03-SUMMARY.md` — this file.

### Modified (6)

- `src/tools/index-sets/schemas.js` — DeleteIndexSetSchema added at the bottom: `mutatingBase.extend({ indexSetId, deleteIndices: z.boolean().optional().default(false), confirm: z.string().optional() })`. Plan 02-01's ListIndexSetsSchema/GetIndexSetSchema and Plan 02-02's CreateIndexSetSchema/UpdateIndexSetSchema preserved unchanged.
- `src/tools/index-sets/index.js` — One new import line + one new `register("delete_index_set", handleDeleteIndexSet)` line.
- `src/tools.js` — One new toolDefinitions entry for `delete_index_set`. Description spells out D-04 inversion + confirmationToken echo flow + ND1 + D-05 + UPDATED D-15 (no job_id) + await_system_job(info_substring) discovery. `required: ["indexSetId"]`. Tool count 40 → 41.
- `src/tools/_shared/errors.js` — `wrapGraylogError` now renders `err.reason` as a `[reason: <name>]` suffix AND assigns `out.reason` on the envelope. Rule 2 — see "Deviations from Plan".
- `test/index-sets.test.js` — +20 tests: 8 c1-hash/collectIndexNames + 12 delete_index_set handler tests. Each test uses `_setCaptureRequest(multiCapture([...]))` with path-keyed routing so order-independence holds (no test depends on call sequence).
- `test/schema-parity.test.js` — +1 `assertSchemaParityForTool("delete_index_set", DeleteIndexSetSchema)`.

## Decisions Made

See `key-decisions:` in the frontmatter for the full list. Highlights:

- **Frozen-fixture hash as drift detector**: Plan-mandated. Test 1 pins `3371c65813c7a3acce20d96371b8df8ba6b1ae5d672309962fbf236b065ba6a0` for a known input vector. Tests 5 + 6 pin two more hashes for the empty and populated index set fixtures. Any change to the canonical JSON shape — key reorder, locked-literal swap, sort omission — fails the test loudly.

- **ND1 fires regardless of deleteIndices**: Test 8 (deleteIndices:true) and Test 12 (deleteIndices:false) both prove the wrapper refuses the default index set up front. Mirrors Graylog's server-side check ordering: the BadRequestException "Default index set cannot be deleted!" fires before the delete_indices query param is inspected, so the wrapper-side check is also default-first. Single consistent error shape across both paths.

- **D-05 stats_unreachable is hard, not soft**: Test 7 proves a thrown error from the /stats GET produces an MCP error envelope with `stats_unreachable` in the rendered text + `res.reason === "stats_unreachable"`. NO confirmation token issued. The block is the deliberate safety choice — operational robustness must not override blast-radius visibility for a destructive operation.

- **UPDATED D-15 no-job_id envelope**: Test 5 proves dry-run's `postApplyEstimate.job_id === undefined`. Test 10 proves apply's `result.body.job_id === undefined`. The message field carries the indexSetId substring in both shapes so the agent's `await_system_job(info_substring: "<indexSetId>")` path resolves to the IndexSetCleanupJob.

- **wrapGraylogError reason surface (Rule 2)**: An additive enhancement to surface `err.reason` in BOTH the rendered text and as a structured envelope property. Plan 02-02 set `err.reason` on update_index_set's ND2 refusal but the field was invisible to callers. The structured-reason surface is the agent's programmatic identification handle; the field was being silently dropped at the rendering boundary.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Auto-add missing critical functionality] `wrapGraylogError` now surfaces `err.reason`**

- **Found during:** Task 2 GREEN — Tests 7, 8, and 12 were asserting `/stats_unreachable/`, `/default_index_set_undeletable/` regex matches against `res.content[0].text`, but the rendered text contained only `err.message` ("Stats endpoint unreachable; ..." and "Cannot delete the default index set ..."). The `err.reason` was set on the thrown GraylogValidationError but discarded at the `wrapGraylogError` rendering boundary.
- **Issue:** Plan 02-02 already established the err.reason convention on update_index_set's ND2 refusal (assigning `err.reason = "default_index_set_must_be_writable"` before throwing). But `wrapGraylogError` in `src/tools/_shared/errors.js` only consumed `err.status`, `err.method`, `err.path`, `err.message`, and `err.body` — `err.reason` was silently dropped. The Plan 02-02 ND2 test passed only because its regex included `/default_index_set_must_be_writable|writable/i` — the word "writable" was in `err.message`. Plan 02-03's reason strings (`default_index_set_undeletable`, `stats_unreachable`) don't appear in the err.message text, so the tests would have failed.
- **Fix:** `wrapGraylogError` extended to (a) append ` [reason: <name>]` to the rendered text when `err.reason` is a non-empty string, and (b) propagate `err.reason` as a top-level `out.reason` property on the MCP envelope (alongside `isError: true` + `content`). Both surfaces are additive — no existing thrower depends on the absence; Plan 02-01's `await_system_job` info_substring path constructs its own `out.reason` directly so the property name is already in use on the envelope shape.
- **Files modified:** `src/tools/_shared/errors.js` (`wrapGraylogError` body — 4 added lines).
- **Verification:** Tests 7, 8, 12 now pass. Plan 02-02's ND2 test (`update_index_set ND2 pre-flight blocks writable:false on the default index set`) still passes — the regex `/default_index_set_must_be_writable|writable/i` now matches the explicit reason tag instead of just the "writable" substring; broader match. Full `npm test` 323/323 green with zero regressions. The Rule 2 deviation is correctness work: the structured reason surface is what enables the agent to programmatically identify the error type.
- **Committed in:** `6c57864` (Task 2 GREEN — co-changed with delete-index-set.js because removing the wrapGraylogError change would re-introduce Tests 7/8/12 failures).

---

**Total deviations:** 1 auto-fixed (1 Rule 2 — auto-add missing critical functionality)
**Impact on plan:** Plan 02-03 explicitly says (frontmatter `files_modified` list): "src/graylog/errors.js NOT in files_modified" — that constraint holds (Phase 0's typed error hierarchy untouched). The `wrapGraylogError` modification is in `src/tools/_shared/errors.js` (the MCP error-rendering layer), NOT `src/graylog/errors.js`. The deviation completes the Plan 02-02 ND-reason pattern that was structurally incomplete (reason assigned but invisible); also enables Plan 02-04/02-05's downstream uses of structured reasons.

## Issues Encountered

- **Initial GREEN run failed Tests 7/8/12** — `err.reason` set but invisible to callers because `wrapGraylogError` ignored the field. Resolved by Rule 2 deviation above. Three RED → GREEN cycles for Task 2 (RED → first GREEN with failures → second GREEN after Rule 2 fix) collapsed into one Task 2 GREEN commit per the project's per-task commit convention; the Rule 2 enhancement is documented in the commit body.

## Frozen-Fixture Hashes (sanity checks for future regressions)

Three deterministic-output sanity tests pin specific sha-256 outputs against literal input vectors. Any drift in canonicalization (key reorder, locked-literal swap, sort omission, JSON.stringify drift) fails the test loudly:

| Test | Input | Frozen hash |
|------|-------|-------------|
| Task 1 Test 1 | `{ indexSetId: "iset-1", deleteIndices: true, indexNames: ["graylog_0","graylog_1"], messageCount: 100 }` | `3371c65813c7a3acce20d96371b8df8ba6b1ae5d672309962fbf236b065ba6a0` |
| Task 2 Test 5 (empty index set) | `{ indexSetId: "iset-1", deleteIndices: true, indexNames: [], messageCount: 0 }` | `ed22c223ab80ce359fbb3d00b3ca46a76f99cbe07a658c1f3a3e644c5c337d1d` |
| Task 2 Test 6 (populated index set) | `{ indexSetId: "iset-1", deleteIndices: true, indexNames: ["graylog_0","graylog_1","graylog_2"], messageCount: 12345 }` | `d5f10faaada8fc8f558b1a53cc8777a83fd73fa9172aa65fb36728ff246583c0` |

## UPDATED D-15 Async Envelope Shape on Apply

The apply path for `delete_index_set` with `deleteIndices: true` returns:

```json
{
  "async": true,
  "job_id_observable_at": "/system/jobs",
  "message": "Submitted cleanup for index set <indexSetId>; await via /system/jobs (call await_system_job with info_substring: \"<indexSetId>\")"
}
```

`job_id` is **deliberately absent** because Graylog's DELETE returns 204 with no body — there is no server-supplied id to forward. The agent's discovery path is `await_system_job` with `info_substring: <indexSetId>` (Plan 02-01 shipped this surface); the wrapper GETs `/system/jobs`, locates the `IndexSetCleanupJob` whose `info` field contains the indexSetId (the substring matches via `String.prototype.includes` — T-02-01-10 mitigation against catastrophic backtracking), then polls that job's id with the standard exponential-backoff schedule.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 02-04 hand-off:** `set_default_index_set` (INDEX-06) can reuse the ND-pre-flight + structural-error pattern shipped here (`current.can_be_default === false` → `default_eligibility_failed` mirrors `default_index_set_undeletable`). `cycle_deflector` (INDEX-07) per the U1 smoke artifact ships SYNC_OPTION_A — no system-job linkage needed for the primary action; ND3 pre-flight (writable: false on the index set itself, distinct from the connection-level writable gate) can use the same GraylogValidationError + reason pattern.
- **Plan 02-05 hand-off:** Schema-parity now covers 6 of the 8 phase-2 mutating tools (list_index_sets, get_index_set, await_system_job, create_index_set, update_index_set, delete_index_set). The remaining 2 (set_default, cycle) land in Plan 02-04. The auth-redaction lint's context-aware allowlist for confirmationToken context is unchanged from Plan 02-01 (already recognised via field-name context inheritance from the idempotencyKey pattern). Snapshot fixtures for the delete_index_set dry-run shapes (deleteIndices:false, deleteIndices:true with empty + populated cascades, ND1 refusal, stats_unreachable refusal, confirmation_mismatch on apply) are pending Plan 02-05.
- **Phase 3+ hand-off:** The C1 confirmation-hash pattern (computeC1Hash helper + `_confirmationToken` forwarding + `requireConfirm` callback) is now established and reusable. Any future destructive blueprint action (deleting an intermediate index set during a multi-step setup, wiping alert history when removing an event definition in Phase 5) can copy the structural pattern: pure hash helper + build() routes the token + requireConfirm gate. Cost: one helper + one schema field + one returns-token-or-null callback. The Rule 2 `wrapGraylogError` reason surface is also generally useful: any handler can now throw `new GraylogValidationError(msg, ctx)` + `err.reason = "<kebab_case_name>"` and the agent sees both human-readable text and a structured reason field.
- **No blockers.**

## Tests added (20)

- 8 c1-hash/collectIndexNames helper tests covering: 64-hex output + frozen fixture (Test 1); determinism (Test 2); sort-order independence (Test 3); messageCount sensitivity (Test 4); D-02 locked-literal replay protection — false, undefined, "true" string all throw (Test 5); AllIndices walk across closed + reopened + all (Test 6); empty/missing sub-collections (Test 7); dedupe across overlapping sub-collections (Test 8).
- 12 delete_index_set handler tests covering: schema parse (Test 1); D-04 default false (Test 2); optional confirm (Test 3); deleteIndices:false metadata-only path with NO token/cascades/envelope (Test 4); deleteIndices:true against empty index set with frozen-fixture hash + UPDATED D-15 envelope verification (Test 5); deleteIndices:true against populated index set with frozen-fixture hash + cascade sort (Test 6); D-05 stats_unreachable hard-block (Test 7); ND1 default refusal with deleteIndices:true (Test 8); confirmation_mismatch on apply with DELETE call count 0 (Test 9); correct confirm fires DELETE + NO job_id in envelope (Test 10); writable gate fires BEFORE confirmation gate with capture count 0 (Test 11); ND1 still refuses with deleteIndices:false (Test 12).
- 1 schema-parity test for delete_index_set.

## Self-Check: PASSED

All 3 claimed file paths exist on disk; all 4 task commits exist in `git log --oneline -8`. Full `npm test` returns 323/323 passing.

```
src/tools/index-sets/c1-hash.js                          — FOUND
src/tools/index-sets/delete-index-set.js                 — FOUND
.planning/phases/02-index-sets-retention/02-03-SUMMARY.md — FOUND (this file)
src/tools/index-sets/schemas.js                          — MODIFIED (DeleteIndexSetSchema)
src/tools/index-sets/index.js                            — MODIFIED (register)
src/tools.js                                             — MODIFIED (toolDefinitions; 40 → 41)
src/tools/_shared/errors.js                              — MODIFIED (Rule 2: wrapGraylogError surfaces err.reason)
test/index-sets.test.js                                  — MODIFIED (+20 tests)
test/schema-parity.test.js                               — MODIFIED (+1 assertion)

commits:
  21d2b7d test(02-03): RED — c1-hash + collectIndexNames helpers (Task 1)
  37ce96e feat(02-03): GREEN — c1-hash + collectIndexNames helpers (Task 1)
  a4e5fdb test(02-03): RED — delete_index_set handler + schema-parity (Task 2)
  6c57864 feat(02-03): GREEN — delete_index_set handler (Task 2, INDEX-05)
```

---
*Phase: 02-index-sets-retention*
*Completed: 2026-05-15*
