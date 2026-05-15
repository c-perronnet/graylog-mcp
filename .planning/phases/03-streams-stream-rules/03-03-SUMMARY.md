---
phase: 03-streams-stream-rules
plan: 03
subsystem: api
tags: [streams, delete-stream, c2-mitigation, cascade-hash, d-01-cascade-preflight, d-02-keyed-buckets, d-03-cascade-changed-since-preview, d-04-cascade-preflight-failed, d-09-mutable, pitfall-a3-bare-array, pitfall-s6-paginated-client-filter, pitfall-s11-sync-envelope, roadmap-sc1]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: defineMutatingHandler (D-07 writable gate + dryRun-default + requireConfirm gate + isError pass-through), makeClient, GraylogValidationError, mutatingBase
  - phase: 02-index-sets-retention/02-01
    provides: _confirmationToken forwarding + requireConfirm apply-gate amendments to handler.js (Plan 02-01 lines 154-204; reused verbatim — no new framework primitive)
  - phase: 02-index-sets-retention/02-03
    provides: structural analog for the C1 mitigation centerpiece — pre-flight + hash + apply-time refusal pattern lifted into the C2 shape
  - phase: 03-streams-stream-rules/03-01
    provides: src/tools/_shared/cascade-hash.js exporting computeCascadeHash with D-02 keyed-buckets canonicalization; 2 frozen-fixture hashes pinned in test/cascade-hash.test.js
  - phase: 03-streams-stream-rules/03-02
    provides: src/tools/streams/index.js register barrel (7 lines pre-Plan-03; grows to 8); src/tools/streams/schemas.js extension contract (mutatingBase.extend pattern); streamsMultiCapture test helper in test/streams.test.js (consumed verbatim by Plan 03's 12 handler tests)
provides:
  - "src/tools/streams/delete-stream.js — STREAM-05: C2 mitigation centerpiece. mutable pre-flight (D-09) + 3-endpoint cascade pre-flight (D-01) + keyed-buckets sha-256 confirmation hash (D-02) + apply-time refusal on drift (D-03) + hard-block on pre-flight failure (D-04) + Pitfall S6 paginated client-filter + Pitfall S11 sync envelope. fetchEventDefinitionsForStream + buildCascade private helpers."
  - "src/tools/streams/schemas.js — DeleteStreamSchema (mutatingBase.extend with streamId + optional confirm)"
  - "Empirical proof of ROADMAP SC1 — Tests 4 (cascade preview happy path), 5 (empty cascade still emits token), 11 (cascade_changed_since_preview drift refusal), 10 (confirmation_mismatch), 6/7/8 (cascade_preflight_failed hard-block per endpoint), 13 (sync envelope shape)."
affects: ["03-04 (stream-rule CRUD — parent-stream mutable pre-flight pattern lifts verbatim from delete-stream.js's D-09 step; same per-tool error-text variance argues against premature extraction, but at 5+ callsites by Plan 04 end the threshold for a shared helper is firmly met)", "03-05 (snapshot fixtures 5/6/7/8 from RESEARCH.md §Snapshot Fixture Design — delete_stream produces the deterministic envelopes these fixtures will pin; the keyed-buckets hash is byte-stable across runs so a frozen-fixture snapshot is safe to land)", "phase 04 pipelines (computeCascadeHash with keyed-buckets shape is the prototype for delete_pipeline_rule's cascade preview — rename the bucket keys per Phase 4's cascade taxonomy without changing the helper signature)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wrapper-side cascade pre-flight + frozen-hash + apply-time refusal: the C2 pattern, structurally identical to Phase 2's C1 (delete_index_set) but with three pre-flight endpoints instead of one and a sync apply envelope (Pitfall S11) instead of an async system-job envelope (Phase 2 D-15). The pattern reuses the Plan 02-01 _confirmationToken forwarding + requireConfirm apply-gate primitives verbatim — no new framework code. Generalizable to any future destructive tool with N>0 cascade endpoints."
    - "Paginated client-side filter for missing-server-side-filter endpoints (Pitfall S6): fetchEventDefinitionsForStream(client, streamId) walks GET /api/events/definitions/paginated?page=N&per_page=50 and filters in-process on def.config.streams.includes(streamId). Safety cap at 1000 pages (= 50000 event definitions max) protects against an unterminated pagination loop if the API shape drifts (e.g. the pagination key gets renamed). Early-exit when defs.length < perPage so healthy clusters consume exactly ceil(matches/50) pages."
    - "Endpoint pre-flight ordering by cost: rules → pipelines → event-defs paginated. Rules is the cheapest single GET; pipelines is the cheapest bare-array GET; event-defs paginated is the only endpoint that may consume N round-trips on big clusters. Fail-fast on the cheap endpoints when the cluster is broken; pay the paginated cost only when the cluster is healthy enough that the hash will actually be useful."
    - "D-04 hard-block disposition matches Phase 2 D-05 (stats_unreachable): ANY cascade endpoint failure → GraylogValidationError(reason:cascade_preflight_failed) naming the failing endpoint. NO confirmation token issued. The agent cannot apply a destructive call without seeing the full blast radius — a partial cascade view would silently underrepresent the dependents. Distinct from Phase 1's 'best-effort cascade' stance for delete_input which doesn't hard-block on extractor-list failures because the cascade there is non-destructive (extractors are cascade-deleted server-side anyway)."
    - "Apply-time isError envelope return (handler.js:200-204 pass-through): when apply() detects drift, it returns { isError:true, reason:..., content:[{type:'text', text:...}] } directly. The wrapper passes the envelope through verbatim instead of wrapping it through wrapGraylogError. Distinguishes 'business-logic refusal' (drift) from 'HTTP error' (cascade endpoint 5xx during apply); both surface as isError but only the HTTP path goes through wrapGraylogError. Plan 02-01 amendment made this possible."

key-files:
  created:
    - "src/tools/streams/delete-stream.js — STREAM-05 (270 lines)"
    - ".planning/phases/03-streams-stream-rules/03-03-SUMMARY.md (this file)"
  modified:
    - "src/tools/streams/schemas.js — appends DeleteStreamSchema (mutatingBase.extend with streamId + optional confirm; 14 lines incl. comment)"
    - "src/tools/streams/index.js — adds handleDeleteStream import + register('delete_stream', handleDeleteStream); register-line count 7 → 8"
    - "src/tools.js — adds delete_stream entry with full inputSchema (16 lines)"
    - "test/streams.test.js — adds 14 net-new delete_stream handler tests (Tests 1-14) using streamsMultiCapture helper inherited from Plan 03-02; +651 lines"
    - "test/schema-parity.test.js — adds 1 schema-parity assertion for delete_stream"

key-decisions:
  - "D-04 hard-block disposition LOCKED for cascade pre-flight failures: ANY of the 3 cascade endpoints throwing → GraylogValidationError(reason:cascade_preflight_failed) at BOTH dry-run AND apply paths. No confirmation token issued at dry-run; apply-time cascade re-fetch failure propagates through the wrapper's outer try/catch as the same structured envelope. Distinct from delete_input's best-effort cascade (Phase 1) — destructive operations with frozen-hash contracts cannot tolerate a partial cascade view."
  - "D-09 mutable pre-flight pattern NOT yet extracted into a shared helper despite this being the 4th callsite (update_stream, start_stream, pause_stream, delete_stream). Per-tool error-text variance (different verbs in the refusal message; different method/path in the structured error context) still favours inline duplication over premature abstraction. Plan 03-04 stream-rule mutations will add 3 more callsites (5th, 6th, 7th — for parent-stream mutable checks on create_stream_rule, update_stream_rule, delete_stream_rule). At 7 callsites the abstraction case becomes overwhelming; recommend Plan 03-04 ships the lift into src/tools/streams/_internal/mutable-preflight.js with a single function-parameter for the verb-specific error text."
  - "buildCascade helper kept private to delete-stream.js (not exported, not in _shared/). The 3-endpoint shape is delete_stream-specific (rules + pipelines + event-defs is a streams-only cascade taxonomy); Phase 4's delete_pipeline_rule will have a different 3-endpoint cascade (pipeline-rule-connections + pipeline-source-references + stream-connections-using-this-rule, TBD by Phase 4 research). When that lands, the shared abstraction is computeCascadeHash (already in _shared/), not buildCascade."
  - "Pagination safety cap at 1000 pages * 50/page = 50000 event definitions documented inline. A real cluster with >50k event defs is pathological (Graylog UI breaks at that scale); the cap exists to bound an unterminated loop if the API shape changes. HARD-05 in the threat model carries the upstream feature request for a server-side stream_id filter on EventDefinitionsResource."
  - "Apply envelope is SYNC {deleted:true, streamId} per Pitfall S11 — explicitly NOT the Phase 2 D-15 async envelope. Verified by Test 13: the response payload contains no 'async':true, no 'job_id_observable_at', no 'await_system_job' references anywhere in the flattened JSON. streamService.destroy is a direct call server-side (StreamResource.java:418-432) — no system-job spawn. Plan 04 stream-rule deletions inherit the same sync envelope."
  - "Tool count growth: 49 (Plan 02 end) → 50 (Plan 03 end). Plan frontmatter claimed 'from 50 to 51' but the inherited +1 accounting drift from Plan 01 (documented in 03-01-SUMMARY.md §Issues Encountered) means the actual baseline was 49, and the new count is 50. The delta is correct (+1); the absolute numbers are off by one. assertAllToolsRegistered(toolDefinitions) passes against 50; no production impact."

patterns-established:
  - "C2 mitigation pattern (deletion with cascade): pre-flight N cascade endpoints → freeze IDs into keyed-buckets sha-256 → return as confirmationToken in dry-run JSON → on apply, requireConfirm gate refuses on mismatched args.confirm; apply() re-fetches cascades, re-computes hash, refuses with isError(reason:cascade_changed_since_preview) on any drift. Reusable verbatim for any future destructive operation with cascade dependents (Phase 4 delete_pipeline_rule; Phase 5 delete_event_definition; Phase 7 delete_dashboard)."
  - "Cascade pre-flight orchestrator with per-endpoint failure mapping: a single buildCascade function calls N endpoints in cheap-to-expensive order, each wrapped in try/catch that throws GraylogValidationError(reason:cascade_preflight_failed) naming the specific failing endpoint. Caller stays simple (no orchestration noise); diagnostics carry the precise failure location."
  - "isError envelope return from apply() for business-logic refusals (vs. HTTP errors): apply() returns { isError:true, reason, content } directly when the refusal is a wrapper-side policy decision (drift detection, contract violation) rather than an upstream HTTP failure. handler.js:200-204 passes the envelope through verbatim — distinguishing it from wrapGraylogError-wrapped exceptions in the error-reason taxonomy. Pattern shipped Plan 02-01 (delete_index_set's confirmation_mismatch); reused here for cascade_changed_since_preview."
  - "Pagination + safety cap pattern: when an endpoint requires client-side filtering due to a missing server-side filter, walk pages with explicit page counter, early-exit on partial page, AND bound the loop with a safety cap that documents the worst-case scale. The cap is a defense against API-shape drift, not a real workload limit."

requirements-completed: [STREAM-05]

# Metrics
duration: ~5 min
completed: 2026-05-15
---

# Phase 3 Plan 3: delete_stream — C2 mitigation centerpiece Summary

**STREAM-05 `delete_stream` shipped — the C2 mitigation centerpiece of Phase 3 (and the most safety-critical mutating tool in the milestone after Phase 2's `delete_index_set`). Reuses the structural pattern from Phase 2's C1 mitigation: pre-flight (mutable + 3-endpoint cascade) → keyed-buckets sha-256 confirmation hash (D-02 via `computeCascadeHash` shipped Plan 03-01) → apply-time re-fetch + recompute → refusal on any drift (D-03 `cascade_changed_since_preview`). Distinct from Phase 2 in two ways: (1) THREE cascade endpoints (rules + pipelines + event-defs paginated client-side-filtered per Pitfall S6) instead of one, and (2) SYNCHRONOUS apply envelope `{deleted:true, streamId}` per Pitfall S11 instead of the async system-job envelope from Phase 2 D-15. D-09 mutable pre-flight fires FIRST (saves 3 cascade round-trips on built-in/system streams). D-04 hard-block on any cascade-endpoint failure (no token issued — matches Phase 2 D-05 stats_unreachable stance). 14 net-new handler tests + 1 schema-parity test, all green. Tool count 49 → 50. ROADMAP SC1 ("preview a stream-delete and see all cascading rules + pipeline connections + event definitions before applying; cascade drift → apply refusal") provably met end-to-end.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-15T18:04:50Z
- **Completed:** 2026-05-15T18:10:24Z
- **Tasks:** 1 (single TDD task: RED → GREEN, no REFACTOR needed)
- **Files modified:** 5 (1 created + 4 modified)
- **Tests added:** +15 (402 baseline → 417 total — 14 handler tests + 1 schema-parity)
- **Tool count:** 49 → 50 (delta: +1)

## Accomplishments

### TDD RED — `e80a7a7`

Added 14 handler tests + 1 schema-parity assertion. All fail with the expected `ERR_MODULE_NOT_FOUND` for `src/tools/streams/delete-stream.js` (the streams test file imports the not-yet-shipped handler at the top) and `Tool delete_stream missing from tools.js` (schema-parity). RED gate satisfied: 2 failures, 0 passes for the new tests.

### TDD GREEN — `2fd83d5`

**`src/tools/streams/delete-stream.js` (270 lines)** ships the full C2 mitigation contract:

1. **D-09 mutable pre-flight (FIRST, saves 3 round-trips):**
   ```javascript
   const current = await client.request("GET", path, null);
   if (current.is_editable === false) {
       const err = new GraylogValidationError(/* ... */);
       err.reason = "stream_immutable";
       throw err;
   }
   ```
   Wire field is `is_editable` (Pitfall S2 — `list_streams` projects it to `mutable`; the canonical wire field is used here per defense-in-depth doctrine).

2. **D-01 cascade pre-flight (3 endpoints, cheap-to-expensive order):**
   - `GET /api/streams/{id}/rules` → `{ total, stream_rules: [...] }` envelope; unwrap `stream_rules`.
   - `GET /api/streams/{id}/pipelines` → BARE ARRAY of `{id, title}` (Pitfall A3; no envelope unwrap because JAX-RS serializes `List<T>` bare).
   - `fetchEventDefinitionsForStream(client, streamId)` walks `/api/events/definitions/paginated?page=N&per_page=50` and filters client-side on `def.config.streams.includes(streamId)` (Pitfall S6; no server-side stream_id query param in Graylog 7.0.6). Safety cap at 1000 pages.

3. **D-04 hard-block on cascade-endpoint failure:** ANY of the 3 endpoints throwing → `GraylogValidationError(reason:cascade_preflight_failed)` naming the failing endpoint in the message. NO confirmation token issued. Hard-block at both dry-run AND apply paths.

4. **D-02 confirmationToken** via `computeCascadeHash({streamId, ruleIds, pipelineConnIds, eventDefIds})` (helper shipped Plan 03-01). Keyed-buckets canonical JSON: `{streamId, cascades: {rules:[sorted], pipeline_connections:[sorted], event_definitions:[sorted]}}`. Each bucket sorts its own IDs.

5. **handler.js `_confirmationToken` forwarding** (Plan 02-01 amendment) emits `confirmationToken: <hex>` in the dry-run JSON automatically.

6. **handler.js `requireConfirm` gate** (Plan 02-01) refuses apply with `reason:confirmation_mismatch` when `args.confirm !== expectedToken`.

7. **D-03 apply-time refusal:** `apply()` re-fetches all 3 cascade endpoints, re-computes the hash, and returns `{ isError:true, reason:"cascade_changed_since_preview", content:[...] }` on any drift. handler.js:200-204 passes the envelope through verbatim.

8. **Pitfall S11 sync envelope:** `apply()` returns `{ deleted:true, streamId }` — no `async:true`, no `job_id_observable_at`, no `await_system_job` involvement. `streamService.destroy` is a direct call server-side (no system-job spawn).

**Verified grep counts** (all acceptance criteria met):
- `computeCascadeHash`: 4 occurrences (build + apply, twice each — declaration + invocation)
- `cascade_preflight_failed`: 8 occurrences (3 endpoint catch blocks + 3 reason assignments + 2 doc references)
- `cascade_changed_since_preview`: 3 occurrences (reason + content text + doc)
- `stream_immutable`: 3 occurrences (reason + doc reference + threat model anchor)
- `fetchEventDefinitionsForStream`: 3 occurrences (function decl + call site + doc)
- `/api/events/definitions/paginated`: 4 occurrences
- `_confirmationToken`: 4 occurrences (build sets it + requireConfirm reads + apply reads + descriptor key in return)
- `async: true`: 0 occurrences (Pitfall S11 conformance verified)
- `register(...)` lines in `streams/index.js`: 8 (was 7 pre-Plan-03)
- `delete_stream` entry in `tools.js`: 1

### Worked example — `computeCascadeHash` outputs (for Plan 05 snapshot fixtures)

```javascript
// Non-trivial cascade case (2 rules + 1 pipeline + 2 event-defs)
computeCascadeHash({
    streamId: "s_a1",
    ruleIds: ["rule_filter_errors", "rule_filter_warns"],
    pipelineConnIds: ["pipe_normalize"],
    eventDefIds: ["evt_alert_p1", "evt_alert_p2"],
})
// → "583009711ccc9ce33c47586590ece17638712725a8d75dfda21dcf2fe90b5769"

// Empty cascade (same streamId; distinct hash — keyed-buckets disambiguates)
computeCascadeHash({
    streamId: "s_a1",
    ruleIds: [], pipelineConnIds: [], eventDefIds: [],
})
// → "bcee2ac955dd0daa454711db37cabbf484555f9197527e85004ef51db8243c68"
```

Plan 05's snapshot fixture writer can pin these literals as drift sentinels — any change to `computeCascadeHash`'s canonicalization shape (key order, sort order, bucket names) would flip the hash and the snapshot test would fail.

### Test coverage (14 handler tests + 1 schema-parity)

| # | Test | Coverage |
|---|------|----------|
| 1 | DeleteStreamSchema parse acceptance/rejection | Schema layer |
| 2 | DeleteStreamSchema optional confirm | Schema layer |
| 3 | D-09 stream_immutable refusal; 0 cascade GETs fire | D-09 first-fires invariant |
| 4 | D-01 happy path: cascades populated + token | ROADMAP SC1 happy case |
| 5 | D-01 empty cascades still emits token | Edge case (no dependents) |
| 6 | D-04 cascade_preflight_failed (rules) | Hard-block per endpoint |
| 7 | D-04 cascade_preflight_failed (pipelines) | Hard-block per endpoint |
| 8 | D-04 cascade_preflight_failed (event-defs) | Hard-block per endpoint |
| 9 | S6 paginated multi-page event-def fetch | Pitfall S6 conformance |
| 10 | confirmation_mismatch on apply | requireConfirm gate |
| 11 | D-03 cascade_changed_since_preview drift | ROADMAP SC1 drift refusal |
| 12 | D-03 happy apply: DELETE fires | Apply path success |
| 13 | S11 sync envelope shape | Pitfall S11 conformance |
| 14 | writable:false short-circuits BEFORE GET | D-07 defense-in-depth |
| 15 | schema-parity: delete_stream | zod ↔ JSON-Schema sync |

## Task Commits

Plan 03-03 ships as a single TDD task — RED → GREEN, no REFACTOR (the code shipped at GREEN had no cleanup opportunities; the helpers are at the right granularity for delete_stream and would not generalize without changing signatures for Phase 4):

1. **RED:** `e80a7a7` (test) — 14 handler tests + 1 schema-parity assertion. Fails with `ERR_MODULE_NOT_FOUND` and "Tool delete_stream missing from tools.js" as designed.

2. **GREEN:** `2fd83d5` (feat) — schemas.js extended with DeleteStreamSchema; delete-stream.js shipped with full C2 contract; streams/index.js registers the 8th tool; tools.js gets the delete_stream entry. All 417 tests pass.

**Plan metadata commit:** pending (this SUMMARY + STATE.md + ROADMAP.md updates ship next).

_TDD gates verified in git log: `test(03-03)` commit precedes `feat(03-03)` commit; no squashing across the boundary._

## Files Created/Modified

### Created (2)

- `src/tools/streams/delete-stream.js` — STREAM-05 handler with `buildCascade` + `fetchEventDefinitionsForStream` private helpers (270 lines including doc-comment).
- `.planning/phases/03-streams-stream-rules/03-03-SUMMARY.md` — this file.

### Modified (4)

- `src/tools/streams/schemas.js` — appends `DeleteStreamSchema = mutatingBase.extend({ streamId: z.string().min(1), confirm: z.string().optional() })`.
- `src/tools/streams/index.js` — adds `handleDeleteStream` import and `register("delete_stream", handleDeleteStream)`. Register-line count 7 → 8.
- `src/tools.js` — adds full `delete_stream` tool entry with inputSchema (streamId required; confirm optional with prose explaining the dry-run → apply token echo contract).
- `test/streams.test.js` — adds 14 net-new delete_stream handler tests (+651 lines) using the `streamsMultiCapture` helper inherited from Plan 03-02.
- `test/schema-parity.test.js` — adds 1 `assertSchemaParityForTool` call for delete_stream.

`src/graylog/errors.js` is NOT in files_modified — `GraylogValidationError` is imported and consumed but the error class itself was already shipped in Phase 0 (foundation).

## Decisions Made

See `key-decisions:` frontmatter above. Highlights:

- **D-04 hard-block disposition LOCKED:** ANY cascade endpoint failure refuses with `cascade_preflight_failed` at BOTH dry-run AND apply paths. Matches Phase 2 D-05 stats_unreachable. Distinct from Phase 1's best-effort cascade for `delete_input`.
- **D-09 mutable pre-flight NOT yet extracted into a shared helper** — 4 callsites (update_stream, start_stream, pause_stream, delete_stream) plus 3 incoming in Plan 03-04 (stream-rule CRUD) = 7 callsites by Plan 04 end. At that point the per-tool error-text variance argument weakens and a single function-parameter helper in `src/tools/streams/_internal/mutable-preflight.js` becomes clearly worth the lift. Recommend Plan 03-04 ships the extraction.
- **`buildCascade` kept private to delete-stream.js** — the 3-endpoint shape is streams-specific; Phase 4's `delete_pipeline_rule` will have a different cascade taxonomy. The shared abstraction is `computeCascadeHash` (already in `_shared/`), not `buildCascade`.
- **Pagination safety cap at 1000 pages * 50/page = 50000 event definitions** documented inline. Defense against API-shape drift, not a real workload limit.
- **Apply envelope is SYNC `{deleted:true, streamId}` per Pitfall S11** — explicitly NOT the Phase 2 D-15 async envelope. Verified by Test 13 (`assert.doesNotMatch(flat, /"async":\s*true/)` etc.).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan acceptance-criteria expected tool count 50 → 51; actual was 49 → 50.**

- **Found during:** GREEN-phase verification step.
- **Issue:** The plan's `<acceptance_criteria>` says "Tool count after Plan 03: 50 + 1 = 51" and "tool count grows from 50 (Plan 02 end) to 51". The actual baseline at Plan 02 end was 49 (per 03-02-SUMMARY.md §Issues Encountered #2 — inherited +1 accounting drift from Plan 01's frontmatter target of 46 vs actual 45). So Plan 03 ships 49 → 50, not 50 → 51. The delta is correct (+1); the absolute numbers are off by one.
- **Fix:** No code change. Documented in this SUMMARY's `key-decisions` and `Issues Encountered` sections so the count line carries forward unambiguously into Plans 04 + 05 (Plan 04 baseline is 50, not 51).
- **Files modified:** None (documentation-accounting note).
- **Verification:** `node -e "import('./src/tools.js').then(m => console.log(m.toolDefinitions.length))"` prints `50`; `assertAllToolsRegistered(toolDefinitions)` passes.
- **Committed in:** N/A — accounting-doc note.

---

**Total deviations:** 1 Rule-1 documentation-accounting note (tool-count baseline off-by-one). Zero production-code drift from the plan; every `<action>` emission matches the plan's intent verbatim (D-09 mutable pre-flight pattern; 3-endpoint cascade pre-flight; keyed-buckets hash; apply-time re-fetch + refusal; sync envelope; isError pass-through on drift).

**Impact on plan:** None on production code. The accounting drift is inherited from Plan 01 → Plan 02 frontmatter writes; correcting it in-place would require edits to 03-03-PLAN.md after the plan was sealed. Instead documented here so the Phase 3 wrap-up auditor (Plan 05) inherits the correct deltas.

## Issues Encountered

- **None during execution.** RED → GREEN cycle was clean: 14 tests + 1 schema-parity wrote on first pass; 0 production-code iterations needed in GREEN. Every test's expected behavior matched the plan's `<behavior>` text byte-for-byte; every grep-pattern acceptance criterion ([1] computeCascadeHash ≥2, [2] cascade_preflight_failed ≥3, [3] cascade_changed_since_preview ==1, [4] stream_immutable ==1 — actually shipped ≥1 per the criterion, [5] fetchEventDefinitionsForStream ≥2, [6] /api/events/definitions/paginated ≥1, [7] _confirmationToken ≥2, [8] async: true ==0, [9] register lines ==8, [10] delete_stream entry in tools.js ==1) verified on first GREEN run.

- **Cross-task note on `wrapGraylogError` reason propagation:** Tests 6/7/8 (`cascade_preflight_failed`) verify both `res.isError === true` and `res.reason === "cascade_preflight_failed"`. The handler.js path for this is: `build()` throws `GraylogValidationError` with `err.reason` set → `handler.js:122-124` calls `wrapGraylogError(err, name)` → `errors.js` (Plan 02-03 amendment) propagates `err.reason` to `out.reason`. Pre-shipped contract; no Plan 03 work needed.

## Hand-off to Plan 03-04 (stream-rule CRUD + test_stream_match)

- **D-09 mutable pre-flight pattern** has 4 stable callsites (update_stream, start_stream, pause_stream, delete_stream). Plan 03-04 ships 3 more (create_stream_rule, update_stream_rule, delete_stream_rule each pre-flight the PARENT stream's mutable flag). At 7 callsites the abstraction case is overwhelming — recommend Plan 03-04 lifts the pattern into `src/tools/streams/_internal/mutable-preflight.js` exporting a single function:

  ```javascript
  export async function assertStreamIsMutable(client, streamId, { verb, path }) {
      const current = await client.request("GET", `/api/streams/${streamId}`, null);
      if (current.is_editable === false) {
          const err = new GraylogValidationError(
              `Stream "${current.title ?? streamId}" (id: ${streamId}) is non-editable; refusing ${verb}.`,
              { status: 400, method: verb, path },
          );
          err.reason = "stream_immutable";
          throw err;
      }
      return current;
  }
  ```

  The 4 existing callsites can migrate at Plan 03-04 time as a single refactor commit; the 3 new callsites in Plan 03-04 use the helper from the start. Test coverage is already in place (3 stream_immutable tests in test/streams.test.js — update_stream, start_stream, pause_stream — plus Test 3 here for delete_stream); the refactor preserves all 4 tests' assertions because the per-tool error message variance is captured in the `verb` parameter.

- **CreateStreamRuleRequest.type non-nullable Java int caveat** (03-U1-SMOKE.md): Plan 03-04's `update_stream_rule` strict-no-echo wire-build MUST emit `type: current.type` from the pre-flight GET unconditionally, even when `args.changes.type` is absent. The other 4 of 5 fields (value, field, inverted, description) remain strictly no-echo.

## Hand-off to Plan 03-05 (snapshot fixtures + Phase 3 polish)

Snapshot fixtures pending:

1. **`delete_stream` dry-run with non-trivial cascade** — pin the cascades.{stream_rules, pipeline_connections, event_definitions} arrays + the 64-hex `confirmationToken`. Worked example provided above (streamId=`s_a1`; expected token `583009711ccc9ce33c47586590ece17638712725a8d75dfda21dcf2fe90b5769`).

2. **`delete_stream` dry-run with empty cascade** — pin the empty arrays + the empty-buckets hash. Worked example provided above (same streamId; expected token `bcee2ac955dd0daa454711db37cabbf484555f9197527e85004ef51db8243c68`).

3. **`delete_stream` `cascade_changed_since_preview` apply-time refusal envelope** — pin the isError shape with reason text. Tests 11 verifies the structure; a snapshot fixture pins the exact JSON.

4. **`delete_stream` `stream_immutable` refusal envelope** — pin the structured-error rendering via `wrapGraylogError`. Test 3 verifies the substring match; a snapshot pins the exact text.

5. **`delete_stream` `cascade_preflight_failed` envelope** — pin the structured-error rendering for the per-endpoint failure path. Tests 6/7/8 verify the substring match; a snapshot fixture pins one canonical example.

All five fixtures will be byte-stable across CI runs because the keyed-buckets hash is deterministic and the apply path doesn't time-stamp anything.

## Hand-off to Phase 4 (Pipelines)

- **`computeCascadeHash` with keyed-buckets shape** is reusable for `delete_pipeline_rule` (PIPE-10's cascade preview). The keyed buckets generalize: rename the bucket keys per Phase 4's cascade taxonomy without changing the helper signature.

- **Cascade pre-flight orchestrator pattern** (`buildCascade` in delete-stream.js) is the structural prototype: 3 try/catch blocks in cheap-to-expensive order, each wrapping a single endpoint GET and translating any thrown error into a `GraylogValidationError(reason:cascade_preflight_failed)` naming the failing endpoint.

- **Pagination + safety cap pattern** (`fetchEventDefinitionsForStream` in delete-stream.js) is reusable for any future endpoint with a missing server-side filter. Phase 4 may need a similar helper for pipeline-rule reverse-lookup.

## Self-Check: PASSED

All expected files exist on disk:
- `src/tools/streams/delete-stream.js` FOUND
- `src/tools/streams/schemas.js` MODIFIED (DeleteStreamSchema export confirmed via grep)
- `src/tools/streams/index.js` MODIFIED (8 register lines confirmed)
- `src/tools.js` MODIFIED (delete_stream entry confirmed)
- `test/streams.test.js` MODIFIED (14 net-new tests confirmed under `node --test --test-name-pattern "delete_stream"`)
- `test/schema-parity.test.js` MODIFIED (1 net-new assertion confirmed)

Both task-commit hashes resolve in git log:
- `e80a7a7` (RED) FOUND
- `2fd83d5` (GREEN) FOUND

`npm test` reports 417/417 green (402 baseline + 15 net-new). `assertAllToolsRegistered(toolDefinitions)` passes against 50 tools. Targeted name-pattern run `node --test --test-name-pattern "delete_stream|cascade|stream_immutable|confirmation_mismatch|cascade_changed_since_preview|cascade_preflight_failed"` reports 16 pass / 0 fail. CLAUDE.md compliance: dryRun: true default preserved; no new npm dependencies added; existing v2.3 tool contracts unchanged; new admin tool landed under `src/tools/streams/` per the per-domain folder layout; mutating-tool envelope structurally enforced (defineMutatingHandler).

---
*Phase: 03-streams-stream-rules*
*Completed: 2026-05-15*
