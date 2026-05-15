---
phase: 04-pipelines-pipeline-rules-connections
plan: 05
subsystem: pipeline-stream-connections
tags: [pipelines, pipeline-stream-connections, get-merge-put, get-subtract-put, replace-semantics, pitfall-2, d-01, pipe-13, pipe-14]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: defineMutatingHandler + makeClient + writable-gate D-07 + GraylogNotFoundError duck-type (err.isGraylogError + err.status === 404)
  - phase: 04-pipelines-pipeline-rules-connections/04-01
    provides: pipelines/ folder layout established; per-domain barrel pattern (handlers register via side-effect import in src/tools/_register.js)
provides:
  - "src/tools/pipelines/connect-pipelines-to-stream.js — PIPE-13. GET-merge-POST union semantics for attaching pipelines to a stream. Preserves previously-connected pipelines (Pitfall 2 acceptance gate). 404 on GET treated as empty current set."
  - "src/tools/pipelines/disconnect-pipelines-from-stream.js — PIPE-14. GET-subtract-POST difference semantics for detaching pipelines from a stream. Preserves remaining connections (Pitfall 2 mirror). 404 on GET treated as empty; POST still fires for consistency."
  - "ConnectPipelinesToStreamSchema + DisconnectPipelinesFromStreamSchema in src/tools/pipelines/schemas.js — both mutatingBase.extend with streamId.min(1) + pipelineIds.array(min:1)."
  - "2 new tools.js entries with Pitfall 2 discrimination sentence in the description (≤200 chars after the lead clause; total ~470 chars including the schema-shape sentence per project style)."
  - "Barrel grown 9 → 11 register lines (Plan 04-05 ships 2 of 5 remaining net-new Phase 4 tools; Plan 04-04 ships the other 3 in an independent wave)."
affects:
  - "04-06 (snapshot fixtures + VALIDATION.md flip + phase close) — 4 new fixtures needed: (a) connect dry-run merged set; (b) connect dry-run already_connected idempotency; (c) disconnect dry-run reduced set; (d) disconnect dry-run not_currently_connected idempotency. Plan 06 also captures the Pitfall 2 wire-body proof in a fixture."

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern: REPLACE-semantics endpoint wrapped with client-side set arithmetic (Pitfall 2 mitigation). Both connect and disconnect hit the same wire endpoint (POST /api/system/pipelines/connections/to_stream) — the wrapper's GET-merge / GET-subtract is the entire difference. Reusable for any future Graylog endpoint whose wire semantics differ from the agent-friendly intent (e.g. Lookup-table data adapters if/when they ship as REPLACE-semantics)."
    - "Pattern: 404-as-empty-set on read pre-flight. When the resource record doesn't exist yet (Graylog returns 404 from GET /connections/{streamId} until the first POST creates it), the wrapper treats current as { pipeline_ids: [] } and proceeds. Duck-typed via err.isGraylogError + err.status === 404 — no extra typed-error import needed."
    - "Pattern: deterministic-sort on the wire for Set<String> fields. Graylog's wire type is Set<String> (order not significant server-side); the wrapper sorts alphabetically on emission so Plan 06's snapshot fixtures stay byte-stable across runs. Same convention as Phase 1's stages_count synthetic projection ordering."
    - "Pattern: pre-mutation snapshot for idempotency surfacing. existingMatches is built by iterating args.pipelineIds and checking currentSet.has() BEFORE the add()/delete() mutation — otherwise every arg would look like a 'match' after the merge. Captures intent-vs-state diff for the agent without requiring client-side comparison."

key-files:
  created:
    - "src/tools/pipelines/connect-pipelines-to-stream.js (87 lines — PIPE-13 GET-merge-POST handler with 4 paragraphs of inline rationale on Pitfall 2 + 404 handling + sort determinism + existingMatches snapshot timing)"
    - "src/tools/pipelines/disconnect-pipelines-from-stream.js (67 lines — PIPE-14 GET-subtract-POST handler with Pitfall 2 mirror + POST-still-fires-on-404 consistency rationale)"
  modified:
    - "src/tools/pipelines/schemas.js (+33 lines: ConnectPipelinesToStreamSchema + DisconnectPipelinesFromStreamSchema with shared shape + Pitfall 2 commentary block)"
    - "src/tools/pipelines/index.js (+5 lines: 2 imports + 2 register lines; barrel grown 9 → 11)"
    - "src/tools.js (+42 lines: 2 new tool definitions with Pitfall 2 discrimination sentence in each description)"
    - "test/pipelines.test.js (+419 lines: 21 net-new tests + 1 line of import + 1 line of count-test fix)"
    - "test/schema-parity.test.js (+20 lines: 2 new parity tests with section header comment)"

key-decisions:
  - "Rule 3 fix: pre-existing `assertAllToolsRegistered passes after Plan 04-03 Task 2 registers PIPE-06..PIPE-09 (count = 63)` test had to be retargeted to count=65 + renamed to reference Plan 04-05. This was a brittle absolute-count assertion landed by Plan 04-03; bumping it is mechanical and tracked in deviations. Comment in the updated test documents that Plan 04-04 (independent wave 3) will bump to 68 final."
  - "Tool count interpretation: Plan 04-05's frontmatter said '66 → 68' assuming Plan 04-04 ships first (Plan 04-04 adds 3 tools). Plan 04-05 is wave 2 with depends_on: [04-01] only; Plan 04-04 is wave 3. We executed in wave order — 04-05 runs against the 04-03 baseline of 63, growing to 65. Plan 04-04 will independently grow to 68 when it ships. This is the intended sequential consequence of the wave structure; no plan amendment needed."
  - "GraylogNotFoundError import elision: Plan's <read_first> listed src/graylog/errors.js as 'IMPORT GraylogValidationError if needed', but the handlers only need to detect 404 status. Used duck-typing (err?.isGraylogError && err.status === 404) which honors the success_criteria 'src/graylog/errors.js NOT in files_modified' AND avoids adding a typed-error import that's never thrown from these handlers (we only throw via the inherited handler.js wrapGraylogError path). 11 of 11 success criteria still met; one fewer import to maintain."
  - "Schema-level pipelineIds.min(1) enforces 'attach AT LEAST ONE pipeline' semantics at the validation gate — args.pipelineIds=[] is rejected before build() runs (matches plan's must-haves.truths)."
  - "existingMatches.snapshot-before-mutation idempotency: for connect, we check currentSet.has(id) BEFORE currentSet.add(id) so 'already_connected' reflects the pre-merge state. For disconnect, we check currentSet.has(id) BEFORE currentSet.delete(id) — same intent-vs-state semantics. Without the snapshot order, idempotency reporting would be broken (every id would falsely appear 'connected' after add() in connect; nothing would appear 'not_currently_connected' in disconnect)."

patterns-established:
  - "Pattern: REPLACE-semantics + client-side set arithmetic (Pitfall 2 mitigation). The wrapper is the agent-facing translator between Graylog's REPLACE wire and the agent's attach/detach intent. Reusable for any future endpoint that publishes REPLACE semantics where the agent boundary should be additive/subtractive."
  - "Pattern: 404-as-empty-set + duck-typed status check. Avoids the typed-error import for handlers that only need to recognize 'no record yet' as a non-error code path. Pattern: `try { current = await client.request(...); } catch (err) { if (err?.isGraylogError && err.status === 404) { current = { ... empty ... }; } else { throw err; } }`."
  - "Pattern: deterministic alphabetical sort on Set<String> wire fields for snapshot stability. `[...mergedSet].sort()` produces byte-stable output regardless of input ordering or hash-map iteration order. Plan 06's fixtures depend on this."
  - "Pattern: existingMatches pre-mutation snapshot. Iterate args INTO the set's pre-mutation has() check, THEN mutate — captures the diff for the agent without a separate snapshot Set allocation."

requirements-completed: [PIPE-13, PIPE-14]

# Metrics
duration: ~6 min
completed: 2026-05-15
---

# Phase 04 Plan 05: Pipeline↔Stream Connections Summary

**Two pipeline↔stream connection tools (PIPE-13 connect + PIPE-14 disconnect) with GET-merge-POST and GET-subtract-POST client-side set arithmetic wrapping Graylog's REPLACE-the-full-set POST /api/system/pipelines/connections/to_stream endpoint. Pitfall 2 acceptance gate proven for both — attaching ["new"] to a stream with current=[a,b] produces wire body.pipeline_ids=["a","b","new"], NOT ["new"] (which would silently disconnect a and b).**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-15T21:44:15Z
- **Completed:** 2026-05-15T21:49:54Z
- **Tasks:** 1 (TDD: RED + GREEN gates)
- **Files created:** 2 (PIPE-13 + PIPE-14 handlers)
- **Files modified:** 5 (schemas.js, index.js, tools.js, test/pipelines.test.js, test/schema-parity.test.js)
- **Tests:** 24 net-new (21 in test/pipelines.test.js + 2 schema-parity + 1 retargeted count test)
- **Full suite:** 642 tests / 18 suites / all green (was 618 baseline at Plan 04-03 end)

## Accomplishments

- **PIPE-13 connect_pipelines_to_stream**: GET /api/system/pipelines/connections/{streamId} → union(current.pipeline_ids, args.pipelineIds) → POST /api/system/pipelines/connections/to_stream with merged set sorted alphabetically. 404 on GET treated as empty current set. Idempotent attaches surface in existingMatches[].similarity_reason: "already_connected". Pitfall 2 acceptance gate proven.
- **PIPE-14 disconnect_pipelines_from_stream**: same GET pre-flight → difference(current, args) → same POST endpoint with reduced set. 404 still issues a POST with pipeline_ids:[] for consistency. Already-not-connected IDs surface as existingMatches[].similarity_reason: "not_currently_connected". Pitfall 2 mirror proven (multi-detach preserves remaining IDs).
- **Schema layer enforcement**: pipelineIds.array(string.min(1)).min(1) for both — empty arrays rejected before build() runs; ensures the agent commits to at least one pipeline ID per call.
- **D-07 writable gate**: short-circuits BEFORE the GET pre-flight fires for both handlers (verified by tests asserting captured-request count === 0 on read-only connection).
- **5xx propagation**: GET pre-flight 500 → wrapGraylogError → MCP error envelope; POST NEVER fires (verified for both handlers).
- **Deterministic sort**: alphabetical wire ordering pinned by tests for both connect (z,a,m,b → a,b,m,z) and disconnect (z,a,m minus m → a,z).
- **src/graylog/errors.js NOT touched**: duck-typed 404 detection via err?.isGraylogError && err.status === 404 (no new typed-error import needed; honors success_criteria).
- **Tool count**: 63 (Plan 04-03 end) → 65 (Plan 04-05 end). Plan 04-04 (independent wave 3) will land 3 more tools → 68 final.

## Pitfall 2 Acceptance Gate Proof

| Test | Pre-state | Args | Expected wire body.pipeline_ids | Status |
|------|-----------|------|---------------------------------|--------|
| `connect_pipelines_to_stream PITFALL 2 ACCEPTANCE GATE: current=[a,b], args=[new] → body=[a,b,new] (NOT [new])` | current=[a,b] | pipelineIds=[new] | ["a","b","new"] | ✓ PASS |
| `disconnect_pipelines_from_stream PITFALL 2 mirror: multi-detach preserves remaining; current=[a,b,c], args=[b,c] → body=[a]` | current=[a,b,c] | pipelineIds=[b,c] | ["a"] | ✓ PASS |

Both tests prove the wrapper-side set arithmetic is firing AND the wire body reflects the correct union/difference output. A naive REPLACE-semantics handler would have produced ["new"] / [] respectively — silently disconnecting unrelated pipelines.

## Task Commits

1. **Task 1 RED gate: failing tests for connect/disconnect (PIPE-13/14)** — `d7bc858` (test)
2. **Task 1 GREEN gate: ship connect/disconnect with GET-merge-POST and GET-subtract-POST** — `f22b553` (feat)

_Plan executed as a single TDD task per the frontmatter `type: tdd`; RED + GREEN gates committed individually. No REFACTOR commit — GREEN went green on the first run after the brittle-count-test fix (deviation 1)._

## Files Created/Modified

### Created
- `src/tools/pipelines/connect-pipelines-to-stream.js` (87 lines) — PIPE-13 with inline rationale for Pitfall 2 / 404 handling / sort determinism / existingMatches snapshot timing
- `src/tools/pipelines/disconnect-pipelines-from-stream.js` (67 lines) — PIPE-14 with Pitfall 2 mirror rationale + POST-still-fires-on-404 consistency note

### Modified
- `src/tools/pipelines/schemas.js` — appended Connect/DisconnectPipelinesToStreamSchema with shared shape + Pitfall 2 commentary block (+33 lines)
- `src/tools/pipelines/index.js` — 2 new imports + 2 new register lines; barrel grown 9 → 11
- `src/tools.js` — 2 new tool definitions with Pitfall 2 discrimination sentence in each description; tool count 63 → 65
- `test/pipelines.test.js` — 21 net-new tests for connect/disconnect handlers + count-test retargeted to 65
- `test/schema-parity.test.js` — 2 new parity tests for connect_pipelines_to_stream + disconnect_pipelines_from_stream

## Decisions Made

1. **GraylogNotFoundError import elided in favor of duck-type detection** — handlers only need to recognize the 404 status; the wrapping (via `wrapGraylogError` on the path that re-throws non-404 errors) is handled by `defineMutatingHandler`'s outer try/catch. `err?.isGraylogError && err.status === 404` is sufficient. Honors success_criteria "src/graylog/errors.js NOT in files_modified".
2. **Tool count retargeted to 65** — Plan 04-05 is wave 2 with depends_on:[04-01]; Plan 04-04 is wave 3. Sequential execution ran 04-05 against the 04-03 baseline (count=63), growing to 65. The old `(count = 63)` test had to be bumped — see Deviations.
3. **existingMatches built BEFORE the mutation** — for connect: check `currentSet.has(id)` before `currentSet.add(id)` so "already_connected" reflects pre-merge state. For disconnect: check `has()` before `delete()` so "not_currently_connected" reflects pre-subtract state. Reversing the order would break idempotency surfacing on both paths.
4. **disconnect POST fires even on 404 GET** — Graylog accepts an empty pipeline_ids set (stores the empty record). The POST is issued for consistency with the connect path — agents see the same wire shape regardless of whether the connection record existed before. Tested explicitly (`disconnect_pipelines_from_stream 404 on GET → currentSet empty; ... POST fires with empty set`).
5. **Sort applied to mergedSet/reducedSet on the wire AND in postApplyEstimate** — both expose `pipeline_ids` as a sorted array. Same sort on both surfaces means dry-run preview ≡ apply body, preserving the FOUND-04 invariant.
6. **Inline tool descriptions cite Pitfall 2 explicitly** — agents reading the tools.js description see "the wrapper preserves previously-connected pipelines (Pitfall 2 — Graylog's endpoint POST /api/system/pipelines/connections/to_stream is REPLACE-the-full-set; this wrapper does GET-merge-POST client-side)". This is the discrimination sentence: an agent comparing connect_pipelines_to_stream vs raw POST /to_stream sees the semantic difference from the description alone.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Brittle absolute tool-count assertion left by Plan 04-03**
- **Found during:** GREEN gate run (full test suite)
- **Issue:** Plan 04-03's `test("assertAllToolsRegistered passes after Plan 04-03 Task 2 registers PIPE-06..PIPE-09 (count = 63)")` asserted `toolDefinitions.length === 63`. Plan 04-05 ships 2 new tools, bumping the count to 65, which broke the test. Plan 04-05's frontmatter listed test/pipelines.test.js as a file_modified, but the action sketches didn't anticipate this brittle assertion (the plan was written assuming Plan 04-04 already shipped, bumping to 66 first).
- **Fix:** Renamed the test to `assertAllToolsRegistered passes after Plan 04-05 registers PIPE-13/14 (count = 65)` and updated the assertion + the inline comment explaining the wave structure (04-05 wave 2 → 65; 04-04 wave 3 → 68 final). The test stays self-consistent and the comment documents the wave order for future readers.
- **Files modified:** test/pipelines.test.js (1 test renamed, 1 assertion bumped, 6 lines of comment updated)
- **Verification:** Full suite went from 1 failing test (`fail 1`) to all green (`fail 0`) after the retargeting. Tool count manually verified via `node -e "import('./src/tools.js').then(m => console.log(m.toolDefinitions.length))"` → 65.
- **Committed in:** `f22b553` (Task 1 GREEN commit, alongside the connect/disconnect implementation)

---

**Total deviations:** 1 auto-fixed (1 Rule 3 blocking — brittle count assertion)
**Impact on plan:** Strictly mechanical. The plan's success_criteria do not specify a tool count (they cite "66 + 2 = 68" in the title block but the body uses `66 + 2` as informal arithmetic, not a literal assertion). The fix is a one-line value update + a 6-line comment freshening for future readers; no functionality affected.

## TDD Gate Compliance

- ✓ RED gate commit `d7bc858` (test): 21 net-new pipelines tests + 2 schema-parity tests added. Production modules absent (`src/tools/pipelines/connect-pipelines-to-stream.js` + `disconnect-pipelines-from-stream.js` didn't exist) → `ERR_MODULE_NOT_FOUND` aborts the full pipelines.test.js suite; schema-parity reports "Tool ... missing from tools.js" for both. Total: `# fail 3`.
- ✓ GREEN gate commit `f22b553` (feat): handlers + schemas + barrel + tools.js entries + count-test retarget → all 642 tests pass.

No REFACTOR commit — GREEN went green on the first run after the count-test fix. The implementation is the final shape.

## Issues Encountered

**1 Rule 3 blocking issue at GREEN gate (count-test retarget):** documented in §Deviations. Resolved in 1 minute (1 test rename + 1 assertion bump + 6 comment lines refreshed). No follow-up work needed.

## Self-Check: PASSED

- All 2 created files exist (verified via `ls -la`)
- All 2 commit hashes resolve via `git log --oneline -5`
- Tool count check: `node -e "import('./src/tools.js').then(m => console.log(m.toolDefinitions.length))"` → 65 ✓
- All acceptance grep checks pass:
  - GET in connect: 6 (≥1 required) ✓
  - POST in connect: 8 (≥1 required) ✓
  - currentSet/currentArray/merged in connect: 10 (≥3 required) ✓
  - currentSet/currentArray/reduced in disconnect: 9 (≥3 required) ✓
  - already_connected in connect: 2 (≥1 required) ✓
  - not_currently_connected in disconnect: 3 (≥1 required) ✓
  - /to_stream in both handlers: 5 (≥2 required) ✓
  - /connections/ in both: 9 (≥4 required) ✓
  - status === 404 in both: 2 (≥2 required) ✓
  - Pitfall 2 acceptance gate test names present: 2 (≥2 required) ✓
- Barrel register lines: 11 (Plan 04-03 = 9; +2 net-new) ✓
- src/graylog/errors.js NOT in files_modified: verified via `git diff --stat HEAD~2` shows only schemas.js + index.js + tools.js + 2 new handlers + 2 test files ✓
- `node --test test/pipelines.test.js test/schema-parity.test.js` → 150/150 green ✓
- `npm test` → 642/642 green across 18 suites ✓
- No new npm dependencies (package.json unchanged) ✓

## Next Phase Readiness

- **Plan 04-04 (independent wave 3 — delete_pipeline_rule + simulate_pipeline_rule + list_pipeline_functions)** is unblocked and untouched by this plan. It bumps tool count 65 → 68 when it ships. The brittle count test renamed by deviation 1 will need a third update when 04-04 lands; recommend converting it to a `>=` lower-bound assertion when 04-06 closes the phase if the project wants to avoid further mechanical bumps.
- **Plan 04-06 (snapshot fixtures + VALIDATION.md flip + phase close)** can now author 4 new fixtures for Plan 04-05 alongside the ~10 from earlier plans:
  - `pipelines.connect-merged-set` — dry-run preview showing currentSet=[a,b] + args=[new] → body=[a,b,new]
  - `pipelines.connect-already-connected-idempotency` — dry-run preview showing existingMatches surfacing already_connected
  - `pipelines.disconnect-reduced-set` — dry-run preview showing currentSet=[a,b,c] + args=[b] → body=[a,c]
  - `pipelines.disconnect-not-currently-connected-idempotency` — dry-run preview showing existingMatches surfacing not_currently_connected
  - Plus optional 5th: `pipelines.connect-pitfall-2-gate` — pinning the body.pipeline_ids === [a,b,new] proof at snapshot level (the test already asserts this, but a snapshot makes the wire contract visible in the fixture for future code review)

No blockers. No deferred items.

---
*Phase: 04-pipelines-pipeline-rules-connections*
*Plan: 05*
*Completed: 2026-05-15*
