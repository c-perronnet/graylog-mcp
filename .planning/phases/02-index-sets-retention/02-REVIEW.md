---
phase: 02-index-sets-retention
reviewed: 2026-05-15T15:56:26Z
depth: standard
files_reviewed: 22
files_reviewed_list:
  - src/tools.js
  - src/tools/_register.js
  - src/tools/_shared/conflict.js
  - src/tools/_shared/errors.js
  - src/tools/_shared/handler.js
  - src/tools/_shared/system-job.js
  - src/tools/index-sets/c1-hash.js
  - src/tools/index-sets/create-index-set.js
  - src/tools/index-sets/cycle-deflector.js
  - src/tools/index-sets/delete-index-set.js
  - src/tools/index-sets/get-index-set.js
  - src/tools/index-sets/index.js
  - src/tools/index-sets/list-index-sets.js
  - src/tools/index-sets/schemas.js
  - src/tools/index-sets/set-default-index-set.js
  - src/tools/index-sets/strategies.js
  - src/tools/index-sets/update-index-set.js
  - test/auth-redaction.test.js
  - test/conflict.test.js
  - test/handler.test.js
  - test/index-sets.test.js
  - test/schema-parity.test.js
  - test/system-job.test.js
findings:
  critical: 0
  warning: 3
  info: 5
  total: 8
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-05-15T15:56:26Z
**Depth:** standard
**Files Reviewed:** 22
**Status:** issues_found

## Summary

Phase 2 ships the 8 index-sets / retention tools plus the cross-domain `await_system_job` polling primitive. The implementation is structurally sound: every domain-specific concern from the spec is correctly handled.

- **C1 mitigation centerpiece** — `c1-hash.js` canonicalization is deterministic (object literal insertion order preserved, `indexNames` sorted internally), `deleteIndices !== true` is rejected per D-02 replay protection, and the apply path re-runs `build()` so a server-side state change between dry-run and apply produces a fresh token that mismatches `args.confirm` (the dry-run→apply binding survives process restarts).
- **D-15 updated envelope** — `delete-index-set.js` deliberately omits `job_id` in both `postApplyEstimate` and `apply` returns; the message embeds the indexSetId substring for discovery via `await_system_job(info_substring: …)`.
- **D-13 invariant** — `set-default-index-set.js` reads `current.can_be_default` (not `regular`), correctly aligning with the server's derived eligibility flag.
- **D-14 sync semantics** — `cycle-deflector.js` returns `{ rotated, message, side_effects.observable_at, side_effects.describes }` and explicitly NOT the D-15 async envelope; `async: false` is asserted in `postApplyEstimate`.
- **ND1/ND2/ND3 pre-flights** — all three are wrapper-side refusals BEFORE the destructive HTTP verb fires, with structured `reason` codes (`default_index_set_undeletable`, `default_index_set_must_be_writable`, `non_writable_index_set`).
- **`await_system_job` discovery** — info_substring path returns `job_not_found` / `ambiguous_info_substring` correctly; the `confirm` field is intentionally accepted for shape parity but unused; backoff schedule and 60s default timeout are pinned via module exports.
- **Foundation amendments** — `_confirmationToken` forwarding in `handler.js:154`; `requireConfirm` apply-gate at `handler.js:177`; `conflict.js` envelope chain at line 33 adds `?? response?.index_sets`; `errors.js:65-72` surfaces `err.reason` (additive, no existing thrower broken).
- **MERGE_FROM_CURRENT** — `update-index-set.js` correctly pre-flights GET, merges agent changes over current state, re-asserts immutable `index_prefix` + `creation_date` as defense-in-depth (T-02-02-04). The destructure-and-rebuild approach (rather than spread-current-then-override) avoids leaking server-only fields like `id`, `default`, `can_be_default` into the PUT body.
- **Auth-redaction FQCN allowance** — verified at `test/auth-redaction.test.js:83` — the structural marker is the literal `.` immediately preceding the match AND `org.graylog` anywhere in the 80-char lookbehind window. This is regex-level structural recognition, not a string-level allowlist. Real secrets can't be dotted FQCNs rooted in `org.graylog` without being either a true Graylog public-API class name or astronomically improbable.

Three warnings concern UX/consistency issues that aren't outright bugs but could degrade agent trust: an `allIndices` fetch silently degrading the C1 dry-run preview; the first poll of `await_system_job` exceeding short user-supplied timeouts; and the cycle_deflector apply path re-derives the indexSetId from the request path via regex when it's already available from the args. Five info items cover commented-out cosmetics and minor style improvements.

## Warnings

### WR-01: Silent degradation when `allIndices` fetch fails masks the destruction blast radius

**File:** `src/tools/index-sets/delete-index-set.js:103-112`
**Issue:** When `deleteIndices: true`, the wrapper HARD-BLOCKS dry-run if the `/stats` endpoint throws (D-05 — `stats_unreachable`), but SILENTLY catches the `/indexer/indices/<id>/list` failure and proceeds with `allIndices = { closed: { indices: [] }, reopened: { indices: [] }, all: { indices: {} } }`. The resulting cascade preview shows `cascades.indices: []` and `cascades.indexCount: 0` even though `cascades.messageCount` may report a real (nonzero) value from the still-reachable `/stats` endpoint. An agent reading this preview would reasonably conclude "0 indices, but N messages — that's odd, maybe the messages are in an empty rotation slot" instead of "the index-list endpoint failed; I'm seeing a degraded preview." Worse: the C1 hash is computed over `indexNames: []`, locking the agent's confirm-token to the degraded state. On apply, if the `/list` endpoint recovers, build() re-runs, computes a fresh hash over the real index names, and the agent's confirm mismatches — a confusing failure mode where the dry-run looked clean but apply refuses.

D-05's rationale for HARD-BLOCKING stats was "the agent MUST see the blast radius." The same logic applies to `/indexer/indices/<id>/list`: the agent must see the actual indices being destroyed. The two endpoints typically fail together (both depend on Elasticsearch health), but they CAN fail independently.

**Fix:** Either (a) HARD-BLOCK the dry-run with `reason: 'index_list_unreachable'` when the `/list` endpoint fails, parallel to the `/stats` block; OR (b) surface a `degraded: true` flag on `cascades` so the agent can detect the partial view:
```javascript
let indexListReachable = true;
try {
    allIndices = await client.request("GET", `/api/system/indexer/indices/${args.indexSetId}/list`, null);
} catch (_err) {
    indexListReachable = false;
}
// Option A — HARD BLOCK (parallel to D-05):
if (!indexListReachable) {
    const err = new GraylogValidationError(
        "Index-list endpoint unreachable; cannot enumerate destruction targets...",
        { status: 503, method: "GET", path: `/api/system/indexer/indices/${args.indexSetId}/list` },
    );
    err.reason = "index_list_unreachable";
    throw err;
}
```
Option A is consistent with D-05's safety stance and recommended.

### WR-02: `await_system_job` first poll always waits `BACKOFF_SCHEDULE[0]` (500ms) before checking the deadline, overshooting short timeouts

**File:** `src/tools/_shared/system-job.js:170-196`
**Issue:** The poll loop sleeps BEFORE checking job status:
```javascript
while (Date.now() < deadline) {
    const delay = BACKOFF_SCHEDULE[Math.min(i, BACKOFF_SCHEDULE.length - 1)];
    await _sleepImpl(delay);   // ← unconditional 500ms+ sleep before any GET
    i++;
    try {
        const summary = await client.request("GET", pollPath, null);
        ...
```
For `timeoutMs: 100` (which is valid per the schema's `z.number().int().positive().max(600_000)`), the actual wall-clock elapsed is at least 500ms — a 5x overshoot of the agent-requested ceiling. The test at `test/system-job.test.js:180-205` allows a 700ms cushion specifically because of this. More importantly, if a job is already complete when the agent calls `await_system_job`, the agent waits 500ms before checking — an unnecessary latency for the fast-path case.

Two related concerns: (1) the loop checks `Date.now() < deadline` BEFORE sleeping, but sleeps regardless of how long the sleep takes, so a short timeout never short-circuits the first sleep; (2) there's no `Math.min(delay, deadline - Date.now())` capping, so a near-expiry deadline still incurs the full backoff delay.

**Fix:** Either (a) check the job status FIRST, then sleep before the next iteration; OR (b) cap the sleep at the remaining deadline:
```javascript
while (Date.now() < deadline) {
    try {
        const summary = await client.request("GET", pollPath, null);
        if (summary?.job_status === "complete" || summary?.percent_complete === 100) {
            return { jobId, completed: true, finalStatus: summary };
        }
        if (summary?.job_status === "paused" || summary?.job_status === "error" || summary?.job_status === "cancelled") {
            return { jobId, completed: false, finalStatus: summary };
        }
    } catch (err) {
        if (err?.status === 404) { /* synthetic complete */ }
        throw err;
    }
    const delay = Math.min(
        BACKOFF_SCHEDULE[Math.min(i, BACKOFF_SCHEDULE.length - 1)],
        Math.max(0, deadline - Date.now()),
    );
    if (delay <= 0) break;
    await _sleepImpl(delay);
    i++;
}
```
This both removes the dead initial 500ms latency AND respects short timeouts. If keeping the current first-sleep-then-poll order is intentional (e.g., to give the job time to start), at minimum cap the sleep against the remaining deadline.

### WR-03: `collectIndexNames` assumes Java `Set<String>` deserializes as a JSON array but never validates the runtime shape

**File:** `src/tools/index-sets/c1-hash.js:75-81`
**Issue:** The function comment states "verified against AllIndices.java — three sub-collections: allIndices.closed.indices Set<String> of index names". The code iterates with `for (const name of allIndices?.closed?.indices ?? [])`. This relies on Jackson serializing `Set<String>` to a JSON array (the default behavior). If the response is malformed (e.g., a future Graylog version changes the wire shape, or a proxy munges the response) and `closed.indices` arrives as an object `{ "idx1": true, "idx2": true }` or a string, the `for...of` either throws TypeError (object, no Symbol.iterator) or iterates string chars one at a time — silently producing garbage index names that get hashed into the C1 token. A subsequent apply would compute a different garbage hash and refuse with `confirmation_mismatch`, but the dry-run cascade preview would show single-character "index names" that confuse the agent.

There's no defensive `Array.isArray()` check. The current AllIndices contract is stable on Graylog 7.0.6 (verified per the spec), but this is a forward-compatibility risk and a silent-corruption risk.

**Fix:** Defensive type-check before iteration:
```javascript
export function collectIndexNames(allIndices) {
    const names = new Set();
    const closed = allIndices?.closed?.indices;
    const reopened = allIndices?.reopened?.indices;
    const all = allIndices?.all?.indices;
    if (Array.isArray(closed)) for (const n of closed) names.add(n);
    if (Array.isArray(reopened)) for (const n of reopened) names.add(n);
    if (all && typeof all === "object" && !Array.isArray(all)) {
        for (const n of Object.keys(all)) names.add(n);
    }
    return [...names];
}
```
This silently absorbs shape drift (no throw), which is consistent with the file's stated "best-effort" stance on the index-list endpoint (delete-index-set.js:110-112). If you'd prefer to escalate shape drift to a hard error, throw a `GraylogValidationError` with a `malformed_index_list` reason instead.

## Info

### IN-01: `delete_index_set` apply-path indexSetId extraction via regex when the value is already known

**File:** `src/tools/index-sets/delete-index-set.js:179-180` and `src/tools/index-sets/cycle-deflector.js:92-93`
**Issue:** Both apply functions re-derive the indexSetId from `req.path` via regex match:
```javascript
const m = req.path.match(/index_sets\/([^?]+)/);
const indexSetId = m ? m[1] : "unknown";
```
The original `args.indexSetId` is available in the build descriptor — it's already in `req.postApplyEstimate.id`. Re-deriving via regex is a load-bearing parse that could break if the path format ever changes (it shouldn't, but minor robustness concern), and the `"unknown"` fallback paths over a real failure mode. Cleaner alternative: forward the id in the request descriptor:
```javascript
// in build():
return {
    method: "DELETE",
    path: `${indexSetPath}?delete_indices=true`,
    body: undefined,
    indexSetId: args.indexSetId,  // explicit, not derived
    ...
};
// in apply():
return {
    async: true,
    job_id_observable_at: "/system/jobs",
    message: `Submitted cleanup for index set ${req.indexSetId}; await via /system/jobs (call await_system_job with info_substring: "${req.indexSetId}")`,
};
```
**Fix:** Add a non-wire field (e.g., `indexSetId` or `_indexSetId`) on the request descriptor and read it in apply() instead of regex-parsing the path.

### IN-02: Unused parameter `args` in `delete_index_set`'s `requireConfirm` callback

**File:** `src/tools/index-sets/delete-index-set.js:192`
**Issue:** `requireConfirm: ({ req }) => req._confirmationToken ?? null` — the destructure ignores `args`. Not a bug (idiomatic destructuring) but worth a brief note that other callers reading this might think the signature only takes `req`. The handler.js wrapper passes `{ args, req }` and the test fixtures at `test/handler.test.js:452,484,517,551` destructure the same way. Consistent.

**Fix:** None required. Drop this if you want — it's a stylistic note. If preferred, add an underscore prefix: `({ args: _args, req })` to signal "intentionally unused." But the current form is the project convention (see also `delete_input` if/when it lands).

### IN-03: Dead/unreachable line in `delete-index-set.js` apply — `body` parameter passed to a DELETE

**File:** `src/tools/index-sets/delete-index-set.js:173`
**Issue:** `await client.request(req.method, req.path, req.body);` — `req.body` is unconditionally `undefined` for the DELETE path (set on line 152). Passing `undefined` as a body to an HTTP client is benign but reads as if there might be a body to send. Same for `cycle-deflector.js:91` and `set-default-index-set.js:68`. The wrapper signature requires a third arg, so this is unavoidable without an overload, but a brief comment would clarify intent.

**Fix:** Drop a one-line clarifying comment (or accept as-is — current code is consistent across mutating handlers).

### IN-04: `IndexSetCleanupJob` info-field substring matching is case-sensitive and uses `String.includes`

**File:** `src/tools/_shared/system-job.js:73-78`
**Issue:** `resolveJobIdFromInfo` filters with `j.info.includes(info_substring)` — case-sensitive, position-agnostic. If Graylog's IndexSetCleanupJob info string casing differs from the agent's indexSetId casing (e.g., Graylog renders the id in uppercase hex but the agent passes lowercase, or vice versa), the match returns 0 results and surfaces `job_not_found`. MongoDB ObjectIDs are always lowercase hex, so in practice this is fine, but if Graylog ever changes the info format to "Cleanup for IndexSet[id=ABCD...]" or similar, the match breaks silently.

Also: if two index sets share a substring (e.g., `iset-1` and `iset-10`), the substring `iset-1` would match both, triggering `ambiguous_info_substring`. The agent would need to know to pass the full id. The tool description warns about this implicitly via "ambiguous_info_substring with the list of candidate ids so the agent can re-call with a specific jobId" — well-handled.

**Fix:** None required for v1 — the indexSetId is always a full ObjectID so the prefix-collision risk is theoretical. Optionally, document the case-sensitivity behavior in the tool description.

### IN-05: Schema-parity test relies on `_def.schema.shape` private API for ZodEffects unwrapping

**File:** `test/schema-parity.test.js:42-46`
**Issue:** `getShape` accesses `zodSchema._def?.schema?.shape` — the `_def` prefix is zod's private API and is not stable across major versions. zod v3 keeps it; zod v4 (if/when adopted) may rename or restructure. The current pin (`zod 3.25.76` in package.json) means this is fine today, but a future zod upgrade could silently break parity testing.

**Fix:** None required for v1 — the dependency is pinned. If/when zod is upgraded, validate this helper still works. Alternative: extend the schemas with an exported `.innerShape` symbol that the test consumes instead of poking at `_def`.

---

_Reviewed: 2026-05-15T15:56:26Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
