---
phase: 03-streams-stream-rules
reviewed: 2026-05-15T00:00:00Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - src/tools.js
  - src/tools/_register.js
  - src/tools/_shared/cascade-hash.js
  - src/tools/index-sets/c1-hash.js
  - src/tools/streams/create-stream-rule.js
  - src/tools/streams/create-stream.js
  - src/tools/streams/delete-stream-rule.js
  - src/tools/streams/delete-stream.js
  - src/tools/streams/get-stream.js
  - src/tools/streams/index.js
  - src/tools/streams/list-stream-rules.js
  - src/tools/streams/list-streams.js
  - src/tools/streams/pause-stream.js
  - src/tools/streams/schemas.js
  - src/tools/streams/start-stream.js
  - src/tools/streams/test-stream-match.js
  - src/tools/streams/update-stream-rule.js
  - src/tools/streams/update-stream.js
  - test/cascade-hash.test.js
  - test/schema-parity.test.js
  - test/streams.test.js
findings:
  critical: 0
  warning: 2
  info: 6
  total: 8
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-05-15
**Depth:** standard
**Files Reviewed:** 21
**Status:** issues_found

## Summary

Phase 3 ships the 12-tool streams + stream-rules surface plus the cascade-hash promotion from Phase 2. The implementation is high-quality and tightly matches the plan: D-09 mutable defense-in-depth is consistent across all 7 mutators; D-02 keyed-buckets cascade hash is correctly implemented with strong test coverage; D-10 `index_set_id` is genuinely required with no `.default(...)` escape hatch; the 8-variant rule discriminated union covers Graylog 7.0.6's full `StreamRuleType` enum and the numeric wire translation is correct; CreateEntityRequest envelope wrapping is correctly applied to `create_stream` and only to `create_stream`; `mutable` projection in `list_streams` correctly renames `is_editable` and strips the wire name; the `test_stream_match` literal outer-key `{message: ...}` envelope is correctly emitted; the sync delete envelope `{deleted:true, streamId}` correctly avoids the Phase 2 async pattern; STRICT_NO_ECHO partial-update is correctly implemented for both `update_stream` and `update_stream_rule` (the latter with Pitfall S8 type-echo from current); and the cascade-hash promotion preserves Phase 2 importers via a thin re-export from `index-sets/c1-hash.js`.

The findings below are all in the Warning/Info tier — no critical correctness or security defects were identified. The Warning items are real but localized: a regex fallback in `delete_stream` apply() can mis-extract the streamId on malformed paths, and the `delete_stream` flow re-fetches every cascade endpoint twice during a single apply call, which doubles the load on `/api/events/definitions/paginated`. The Info items are all design observations or minor doc-text divergences.

## Warnings

### WR-01: `delete_stream` apply() falls back to literal "unknown" on regex miss; can mis-hash

**File:** `src/tools/streams/delete-stream.js:230-231`
**Issue:** `apply()` extracts the streamId from `req.path` with `const m = req.path.match(/streams\/([^/?]+)/); const streamId = m ? m[1] : "unknown";`. If the regex misses (e.g. a future caller hands apply() a non-streams path, or a hypothetical descriptor with `path: undefined`), the streamId becomes the literal string `"unknown"`. `computeCascadeHash` then hashes against `"unknown"` and the re-fetch against `/api/streams/unknown/...` will 404 — the wrapper handles this via the `cascade_preflight_failed` branch, but the failure mode is misleading (the agent sees a 404 instead of a missing-streamId signal). In practice the regex matches every well-formed `/api/streams/{id}` path, so this is defensive over-engineering, but the silent fallback masks a contract violation if it ever fires.
**Fix:** Either propagate streamId through the build() descriptor explicitly (cleaner) or throw on regex miss:

```javascript
async apply(client, req) {
    const m = req.path.match(/streams\/([^/?]+)/);
    if (!m) {
        throw new GraylogValidationError(
            `delete_stream apply: malformed req.path (${req.path}) — cannot extract streamId`,
            { status: 500, method: req.method, path: req.path },
        );
    }
    const streamId = m[1];
    // ...
}
```

A simpler alternative: stash `streamId: args.streamId` on the build()-returned descriptor and read `req.streamId` in apply().

### WR-02: `delete_stream` apply duplicates the full 3-endpoint cascade pre-flight

**File:** `src/tools/streams/delete-stream.js:225-244`
**Issue:** On the apply path, `defineMutatingHandler` calls `build()` first (which fires the 3 cascade GETs and computes `_confirmationToken`), then `apply()` calls `buildCascade()` AGAIN (a second full round trip — including the potentially expensive paginated event-definitions walk) to compute a fresh hash and compare against `req._confirmationToken`. This doubles the cost of every successful delete apply: on a cluster with N pages of event-definitions, apply pays 2 × N round trips. `confirmation_mismatch` (handler.js requireConfirm gate, fired against the build()-computed token) already catches drift between the agent's dry-run-supplied confirm and the apply-time cascade — the second comparison only catches drift within the microsecond window between build() and apply() in the SAME handler invocation, which is not a realistic threat. Test 11 (`cascade_changed_since_preview`) deliberately constructs this scenario by stateful-mocking the second `/rules` call to return drifted data, but in production that gap is too small to exploit.
**Fix:** Option A (small, low-risk): document the redundancy explicitly so future maintainers don't accidentally drop the requireConfirm gate. Option B (preferred): make `apply()` rely solely on the requireConfirm gate firing against build()'s freshly-computed `_confirmationToken`, and drop the in-`apply()` re-fetch:

```javascript
async apply(client, req) {
    // requireConfirm has already validated args.confirm === build()-time hash.
    // Trust the build()-time cascade; no second re-fetch needed.
    const m = req.path.match(/streams\/([^/?]+)/);
    const streamId = m ? m[1] : "unknown";
    await client.request(req.method, req.path, req.body);
    return { deleted: true, streamId };
}
```

Either way, also remove or update Test 11 — it currently asserts `rulesCalls === 2` and would fail under Option B. Note that this is a behavioral simplification, not a correctness fix; the current implementation is over-cautious but not wrong.

## Info

### IN-01: `connectionName` in `list_stream_rules` JSON-Schema is documented but absent from `ListStreamRulesSchema`

**File:** `src/tools.js:153` vs `src/tools/streams/schemas.js:30-32`
**Issue:** The JSON-Schema for `list_stream_rules` declares `connectionName: { type: "string" }` in `properties`, and `ListStreamRulesSchema` extends `listBase` (which contains `connectionName`). This pairs correctly. However, the schema-parity test (`test/schema-parity.test.js:208-211`) compares against the zod outer-shape keys. `listBase.shape` includes `connectionName, fields, limit`; `ListStreamRulesSchema` adds `streamId`. JSON-Schema declares 4 keys. Match confirmed — no drift. Filed as Info for the record (this is a verification, not a defect).
**Fix:** None needed.

### IN-02: `get_stream` does NOT project `mutable` (intentional asymmetry with `list_streams`)

**File:** `src/tools/streams/get-stream.js:7-14`
**Issue:** `list_streams` projects wire `is_editable` → agent `mutable` and strips the wire name. `get_stream` returns the full DTO with the raw `is_editable` field preserved. The handler comment documents this intentionally: "the wrapper does not double-up two names for the same field on a single DTO". This is internally consistent but creates a small ergonomic surprise — an agent doing `list_streams` followed by `get_stream` sees two different field names for the same semantic. The tool description for `get_stream` (tools.js:138) correctly mentions `is_editable` (not `mutable`), so the contract is documented.
**Fix:** None needed; documented as a design decision (Pitfall S2). Consider adding `mutable: stream.is_editable === true` alongside `is_editable` in `get_stream` for ergonomic symmetry if agents request it later — but the current shape preserves the wire DTO truth.

### IN-03: `match_input` rule discriminator could lose value when `match_input` is later updated

**File:** `src/tools/streams/update-stream-rule.js:79`
**Issue:** `update_stream_rule` allows `changes.value` to be `string | number` (per `UpdateStreamRuleChangesShape`). For a `match_input` rule (where `value` is the input UUID), a future agent that passes `changes: { value: 42 }` would wire `String(42)` = `"42"` as a new input UUID, which Graylog would reject at the application layer. The schema does not narrow `value` per current rule type (the agent's `current.type` is only known post-pre-flight). This is a contract-shape issue, not a defect — Graylog will refuse the bad value at the application layer.
**Fix:** Optional hardening: if the type-echoed `current.type === STREAM_RULE_TYPE_TO_NUMERIC.match_input` and `typeof args.changes.value === "number"`, refuse with a structured `invalid_match_input_value` reason before the PUT fires. Out of scope unless the live smoke surfaces this as a real failure mode.

### IN-04: `String(null)` coercion in update-stream-rule.js is unreachable but worth a comment

**File:** `src/tools/streams/update-stream-rule.js:79`
**Issue:** `args.changes.value !== undefined ? { value: String(args.changes.value) } : {}` would emit `String(null) === "null"` if `args.changes.value` were ever `null`. The schema (`UpdateStreamRuleChangesShape.value = z.union([z.string(), z.number()]).optional()`) rejects null, so this is structurally unreachable. A passing agent test of `parse({ ..., changes: { value: null } })` would throw at zod. No bug; just worth a one-line code comment to deter a future schema widener from accidentally enabling the bad path.
**Fix:** Add a comment near line 79:

```javascript
// value is z.union([string, number]).optional() — null is rejected at the
// schema layer, so String(args.changes.value) cannot produce "null" here.
```

### IN-05: `current.is_editable === false` defaults; missing field == treated as editable

**File:** `src/tools/streams/{update,start,pause,delete,create-stream-rule,delete-stream-rule,update-stream-rule}-stream.js`
**Issue:** All 7 D-09 mutable checks compare `current.is_editable === false` (strict equality). If Graylog ever returns a stream DTO that omits the `is_editable` field entirely (e.g. an older version or a corrupt response), the check passes — the wrapper would proceed with the destructive verb. The plan documents this as defense-in-depth, but the safer default for a destructive check is "if unknown, refuse." For Graylog 7.0.6 the field is always present, so this is not a current bug. Filing as Info for the audit trail.
**Fix:** Consider tightening to `current.is_editable !== true` for the 4 destructive verbs (update_stream, delete_stream, delete_stream_rule, update_stream_rule). Start/pause are lower-stakes lifecycle ops and may keep the current strict-`false` check. Defer until a multi-version Graylog target appears.

### IN-06: Tool description for `update_stream` lists `index_set_id` in `changes`; HARD-04 may flag

**File:** `src/tools.js:184, 192`
**Issue:** `update_stream`'s description says agents can pass `index_set_id` in `changes`, and `UpdateStreamSchema.changes` allows it. Changing a stream's index_set_id mid-flight is destructive (in-flight messages already routed to the old index set; messages with the same stream_id assignment now hit a different ES index). Graylog allows it server-side, and the wrapper correctly forwards it. The risk is agent confusion: an agent expecting an "rename a stream" workflow might accidentally pass a stale `index_set_id` and re-route the stream's writes. No correctness issue — just a documentation gap.
**Fix:** Consider adding a one-sentence warning to the `update_stream` description: "Changing `index_set_id` re-routes future writes to a different Elasticsearch index set — existing messages are not migrated. Call `cycle_deflector` on the new index set if you need to force a fresh open index." Out of scope unless HARD-04 raises it explicitly.

---

_Reviewed: 2026-05-15_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
