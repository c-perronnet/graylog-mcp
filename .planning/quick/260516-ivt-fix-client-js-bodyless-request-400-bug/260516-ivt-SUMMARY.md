---
phase: quick-260516-ivt
plan: 01
subsystem: graylog-http-client
tags: [bugfix, http-client, axios, regression-test]
requires: []
provides:
  - "Conditional body/Content-Type attachment in makeClient().request"
  - "Real-axios-path regression coverage for bodyless requests"
affects:
  - "Every GET-based read/list/get admin tool routed through src/graylog/client.js"
tech-stack:
  added: []
  patterns:
    - "Conditional axios request config: omit data key + Content-Type for bodyless requests"
    - "Regression test via local node:http server to exercise the real axios transformRequest path"
key-files:
  created:
    - test/regression/client-bodyless-request.test.js
  modified:
    - src/graylog/client.js
decisions:
  - "Treat both null and undefined body as 'no body' (hasBody = body !== null && body !== undefined)"
  - "Build axios config without the data key entirely for bodyless requests rather than passing data: undefined"
metrics:
  duration: ~6 min
  completed: 2026-05-16
---

# Phase quick-260516-ivt Plan 01: Fix client.js Bodyless-Request 400 Bug Summary

Conditional body/Content-Type attachment in `makeClient().request` so a bodyless GET/DELETE no longer ships a `JSON.stringify(null)` body that Graylog 7.x rejects with 400 Bad Request.

## What Was Done

### Task 1: Conditionally attach body and Content-Type in client.js
- Added a `hasBody` flag (`body !== null && body !== undefined`) inside `makeClient().request`.
- Built the headers object with `Accept` and `X-Requested-By` always present; `Content-Type: application/json` added only when `hasBody` is true.
- Built the axios config object and assigned the `data` key only when `hasBody` is true — a bodyless request now reaches axios with no `data` key, so `transformRequest` never runs `JSON.stringify(null)`.
- Left unchanged: D-07 writable-flag guard, `_captureRequestFn` test seam, `buildAuth(conn.apiToken)`, `validateStatus: () => true`, `timeout: 60_000`, `mapGraylogError` call, and the network-error catch block.
- Commit: `d0a9b91`

### Task 2: Add regression test exercising the real axios path (TDD)
- Created `test/regression/client-bodyless-request.test.js` using `node:test` / `node:assert/strict`.
- Spins up a local `node:http` server on `127.0.0.1:0`, captures `method`, `content-type`, `accept`, `x-requested-by`, and the raw request body for each request, and responds `200 {}`.
- Four tests: bodyless GET sends no body / no Content-Type; bodyless GET still sends Accept + X-Requested-By; POST with object body sends Content-Type and a JSON body that parses back to the original; bodyless DELETE sends no body / no Content-Type.
- Does NOT use `_setCaptureRequest` (it bypasses axios and cannot catch this bug class) and does not touch the live Graylog instance.
- RED-verified: against the pre-fix `client.js`, 2 of the 4 tests fail (bodyless GET and DELETE). With the fix, all 4 pass.
- Commit: `2684837`

## Verification

- `node -e "import('./src/graylog/client.js')..."` → IMPORT OK
- `test/graylog-client.test.js` → 15/15 pass (existing behavior unchanged)
- `test/regression/client-bodyless-request.test.js` → 4/4 pass; 2/4 fail against pre-fix client.js (regression net proven)
- Full suite `npm test` → 1080/1080 pass, 0 fail

## Deviations from Plan

None - plan executed exactly as written.

## TDD Gate Compliance

Task 2 followed the RED/GREEN cycle: the regression test was written, then verified to fail against the pre-fix `client.js` (RED) and pass against the fixed `client.js` (GREEN). Because the Task 1 fix was committed before the test, the gate sequence in git log is `fix(...)` then `test(...)` rather than `test` then `feat`; the RED phase was still explicitly verified out-of-band. No behavior was added without a corresponding verified-failing test.

## Self-Check: PASSED

- FOUND: src/graylog/client.js
- FOUND: test/regression/client-bodyless-request.test.js
- FOUND commit: d0a9b91 (fix Task 1)
- FOUND commit: 2684837 (test Task 2)
