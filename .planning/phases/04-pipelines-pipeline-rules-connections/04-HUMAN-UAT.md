---
status: partial
phase: 04-pipelines-pipeline-rules-connections
source: [04-VERIFICATION.md]
started: 2026-05-15T00:00:00Z
updated: 2026-05-15T00:00:00Z
---

## Current Test

[awaiting human testing — live-Graylog confirmations]

## Tests

### 1. Live create_pipeline_rule round-trip against Graylog (PIPE-08 + Pitfall 6)
expected: Submit a rule with `toUpperCase` typo to `<graylog-host>`'s `POST /system/pipelines/rule/parse`; the response carries `positionInLine` (camelCase) on the wire; the wrapper's emitted `parseResult.error` correctly translates to `position_in_line` (snake_case). isError envelope matches Fixture F6 shape.
result: [pending]

### 2. Live simulate_pipeline_rule round-trip (PIPE-12 + Pitfall 1)
expected: Compose a rule that sets a field; submit with a sample message; the JSON-string body deserializes server-side; response carries post-rule field changes.
result: [pending]

### 3. Live connect_pipelines_to_stream non-replace semantics (PIPE-13 + Pitfall 2)
expected: Pre-create stream with pipelines A+B; call `connect_pipelines_to_stream(streamId, [C])`; verify A+B are still connected (wrapper GET-merge-PUT prevents silent disconnection).
result: [pending]

### 4. U1 partial-update smoke (D-16)
expected: Attempt `PUT /api/system/pipelines/pipeline/{id}` with `{title: "new"}` only (no `source` field) against <graylog-host>; observe whether Graylog 7.0.6 returns 200 (STRICT_NO_ECHO works) or 400 (MERGE_FROM_CURRENT needed). Currently safe-defaulted to STRICT_NO_ECHO per Phase 3 precedent.
result: [pending]

### 5. Plan 04-06 Task 2 checkpoint:human-verify sign-off
expected: Reviewer manually re-runs Plan 04-06 Task 2's verification checklist (14 fixture content audit; 701/701 tests green; tool count 68; byte-stable snapshots) and types "approved" as the explicit blocking gate.
result: [pending — auto-approved 2026-05-15 by orchestrator under user "go to end of plan without me" directive]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps

[None — items are pending live verification, not failures.]
