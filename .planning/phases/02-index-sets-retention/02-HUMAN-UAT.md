---
status: partial
phase: 02-index-sets-retention
source: [02-VERIFICATION.md]
started: 2026-05-15T16:00:00Z
updated: 2026-05-15T16:00:00Z
---

## Current Test

[awaiting human testing — three live-Graylog confirmations]

## Tests

### 1. End-to-end delete_index_set with deleteIndices:true against live Graylog
expected: Confirmation-token round-trip with real index list + stats. After applying with `confirm` echoed back, Graylog returns 204; an `IndexSetCleanupJob` (or equivalent) appears in `/system/jobs` with `info` containing the indexSetId; `await_system_job(info_substring: "<id>")` resolves it to completion.
result: [pending]

### 2. cycle_deflector side-effect observability
expected: After `cycle_deflector` applies (sync 204), an `IndexRangesUpdateJob` (or equivalent) appears in `/system/jobs` for the closed index with matching `info`.
result: [pending]

### 3. U1 + cycle live smokes against http://<graylog-host>
expected: Empirical confirmation of two safety-defaulted decisions: (a) Graylog 7.0.6 either accepts the merged-from-current full PUT body for `update_input` (the implemented MERGE_FROM_CURRENT path) or accepts a partial body (could tighten to STRICT_NO_ECHO later); (b) the cycle endpoint truly returns sync 204 (SYNC_OPTION_A) with no `job_id` in any response variant.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps

[None — items are pending live verification, not failures.]
