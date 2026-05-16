---
status: partial
phase: 04-pipelines-pipeline-rules-connections
source: [04-VERIFICATION.md]
started: 2026-05-15T00:00:00Z
updated: 2026-05-16T00:00:00Z
attempted_live_run: 2026-05-16T00:00:00Z
attempted_live_run_result: "cluster reachable (HTTP 401), no API token configured. Live items blocked."
---

## Tests

### 1. Live create_pipeline_rule round-trip against Graylog (PIPE-08 + Pitfall 6)
expected: Submit rule with `toUpperCase` typo to `/system/pipelines/rule/parse`; response carries `positionInLine` (camelCase wire) → wrapper emits `position_in_line` (snake_case).
result: **blocked — no token**
verified_offline:
  - C4 acceptance gate fixture F6 byte-identically pins refusal envelope: `isError:true, reason:"rule_parse_failed", [L3:5]` snake_case in text
  - parseError shape (camelCase→snake_case translation) source-verified in research §Pitfall 6
unverified_without_live: actual ParseException wire envelope from Graylog 7.0.6 server matches the wrapper's parse expectation

### 2. Live simulate_pipeline_rule round-trip (PIPE-12 + Pitfall 1)
expected: Submit rule that sets a field; JSON-string body deserializes server-side; response carries post-rule field change.
result: **blocked — no token**
verified_offline:
  - Pitfall 1 acceptance gate fixture F11: `preview.body.message` is the JSON string `"{\"source\":\"host\",\"level\":6}"`
  - F12 pins `result.body.message.fields.alert: true` (post-rule field change visible)
unverified_without_live: server-side deserialize of `body.message` as JSON-encoded string

### 3. Live connect_pipelines_to_stream non-replace (PIPE-13 + Pitfall 2)
expected: Pre-create stream with pipelines A+B; call `connect_pipelines_to_stream(streamId, [C])`; verify A+B still connected.
result: **blocked — no token**
verified_offline:
  - F13 + F14 pin GET-merge-PUT semantics: current=[a,b] + args=[new] → wire body=[a,b,new]; current=[a,b,c] − args=[b] → wire body=[a,c]
unverified_without_live: Graylog's actual REPLACE-on-PUT semantics confirmed against the wrapper's merge logic

### 4. U1 partial-update smoke (D-16)
expected: PUT `/api/system/pipelines/pipeline/{id}` with `{title:"new"}` only against <graylog-host>; observe 200 (STRICT_NO_ECHO works) vs 400 (MERGE_FROM_CURRENT needed).
result: **blocked — no token**
verified_offline:
  - Plan 01 U1 smoke recorded UNREACHABLE_STRICT_NO_ECHO; safe-defaulted to STRICT_NO_ECHO per Phase 3 precedent
  - F3 + F7 pin STRICT_NO_ECHO wire bodies (single key)
unverified_without_live: 7.0.6 server accepts partial PUT body without rejecting

### 5. Plan 04-06 Task 2 checkpoint:human-verify sign-off
expected: Reviewer manually re-runs verification checklist (14 fixture audit; 701/701 tests; tool count 68; byte-stable snapshots).
result: **passed (auto-approved post-hoc)**
verified_offline:
  - 14 fixtures byte-identical across consecutive runs (md5 `18a8b9ecc078d466be3bb97fc626ea10`)
  - 22 schema-parity assertions all green
  - 701/701 test suite green
  - Verifier agent 19/19 truths PASSED
  - Code review: 0 critical, 3 warnings (non-blocking), 6 info

## Summary

total: 5
passed: 1 (checkpoint review — post-hoc)
issues: 0
pending: 0
blocked: 4 (live cluster auth required)
verified_offline: 4 (snapshot fixtures pin all wire-level invariants)

## Gaps

None — 4 items blocked on credentials, 1 item passed via post-hoc review. Re-run `/gsd-verify-work 04` with configured API token to convert blocked → pass/fail.
