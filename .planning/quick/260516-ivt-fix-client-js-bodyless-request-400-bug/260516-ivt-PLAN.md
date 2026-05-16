---
phase: quick-260516-ivt
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/graylog/client.js
  - test/regression/client-bodyless-request.test.js
autonomous: true
requirements: [BUGFIX-CLIENT-BODYLESS-400]

must_haves:
  truths:
    - "A bodyless GET routed through makeClient().request sends no request body and no Content-Type header"
    - "A POST/PUT/PATCH with a real object body still sends Content-Type: application/json and a JSON-serialized body"
    - "Accept and X-Requested-By headers are sent on every request regardless of body presence"
    - "The D-07 writable-flag guard, _setCaptureRequest test seam, mapGraylogError mapping, validateStatus, and 60s timeout are unchanged"
  artifacts:
    - path: "src/graylog/client.js"
      provides: "Conditional data/Content-Type attachment based on body presence"
      contains: "Content-Type"
    - path: "test/regression/client-bodyless-request.test.js"
      provides: "Regression test exercising the real axios path via a local HTTP server"
  key_links:
    - from: "src/graylog/client.js"
      to: "axios"
      via: "conditional request config (data + Content-Type only when body present)"
      pattern: "axios\\("
---

<objective>
Fix the client.js bodyless-request 400 bug: `makeClient().request` always sets
`Content-Type: application/json` and always passes `data: body` to axios, so a
bodyless GET (`body = null`) gets `JSON.stringify(null)` → a literal `null`
request body. Graylog 7.x returns 400 Bad Request for a GET carrying a body,
breaking every read/list/get admin tool routed through client.js.

Purpose: restore every GET-based admin tool against a real Graylog server.
Output: conditional body/header attachment in client.js + a regression test
that exercises the real axios path (the `_setCaptureRequest` seam cannot catch
this class of bug because it bypasses axios entirely).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

<interfaces>
From src/graylog/client.js — current axios call inside makeClient().request:
- `axios({ method, url, data: body, headers: { Accept, Content-Type, X-Requested-By }, auth, validateStatus, timeout })`
- `data: body` and `Content-Type: application/json` are unconditional — this is the bug.
- Must preserve: D-07 writable guard (lines 36-41), `_captureRequestFn` seam (lines 44-46),
  `mapGraylogError(res, { method, path })`, `validateStatus: () => true`, `timeout: 60_000`,
  `buildAuth(conn.apiToken)`.

From src/graylog/auth.js:
- `buildAuth(apiToken)` → `{ username: apiToken, password: "token" }`

Test conventions:
- `node --test`, files matched by `test/**/*.test.js`, run via `npm test`.
- Regression tests live in `test/regression/`.
- `import { test } from "node:test"; import assert from "node:assert/strict";`
- Test seam present: `_setCaptureRequest` / `_clearCaptureRequest` (do NOT use for the
  axios-path test — they bypass axios).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Conditionally attach body and Content-Type in client.js</name>
  <files>src/graylog/client.js</files>
  <action>
  In `makeClient().request`, before the `axios(...)` call, compute a body-presence
  flag: treat `null` and `undefined` body as "no body" (e.g. `const hasBody = body !== null && body !== undefined;`).

  Build the headers object as a base of `{ Accept: "application/json", "X-Requested-By": "graylog-mcp" }`
  that is ALWAYS sent, and add `"Content-Type": "application/json"` ONLY when `hasBody` is true.

  Pass `data` to the axios config ONLY when `hasBody` is true — when there is no body,
  omit the `data` key entirely (do not pass `data: undefined` and rely on axios; explicitly
  build the config object without the key, e.g. via a conditional spread or by assigning
  `data` after construction). The goal: a bodyless GET sends neither a request body nor a
  `Content-Type` header, so axios's `transformRequest` never runs `JSON.stringify(null)`.

  Leave UNCHANGED: the D-07 writable-flag guard, the `_captureRequestFn` test seam, the
  `auth: buildAuth(conn.apiToken)`, `validateStatus: () => true`, `timeout: 60_000`, the
  `mapGraylogError` call, and the network-error catch block. A POST/PUT/PATCH with a real
  object body must produce a byte-for-byte identical request to today (Content-Type set,
  JSON body serialized).
  </action>
  <verify>
    <automated>cd /home/c_perronnet/git/graylog-mcp && node -e "import('./src/graylog/client.js').then(()=>console.log('OK'))" && npm test -- 'test/graylog-client.test.js' 2>&1 | tail -5</automated>
  </verify>
  <done>client.js attaches `data` and `Content-Type` only when a non-null/non-undefined body is present; Accept and X-Requested-By always sent; existing graylog-client.test.js still passes; D-07 guard, test seam, error mapping, validateStatus, and timeout unchanged.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add regression test exercising the real axios path</name>
  <files>test/regression/client-bodyless-request.test.js</files>
  <behavior>
    - Test 1: a bodyless GET (`client.request("GET", path)`) sends NO request body and NO `Content-Type` header.
    - Test 2: a bodyless GET still sends `Accept: application/json` and `X-Requested-By: graylog-mcp`.
    - Test 3: a POST with a real object body sends `Content-Type: application/json` and a body that JSON-parses back to the original object.
    - Test 4: `client.request("DELETE", path, null)` (bodyless DELETE) sends no body and no Content-Type.
  </behavior>
  <action>
  Create `test/regression/client-bodyless-request.test.js` using `node:test` and
  `node:assert/strict`. Do NOT use `_setCaptureRequest` — it bypasses axios and cannot
  catch this bug. Do NOT touch the live Graylog instance.

  Start a tiny local HTTP server with `node:http` `http.createServer` in a `before`/`after`
  pair (or per-test). The handler must capture, for each incoming request: `req.method`,
  `req.headers["content-type"]`, `req.headers["accept"]`, `req.headers["x-requested-by"]`,
  and the raw request body (accumulate `data` chunks). Respond `200` with
  `Content-Type: application/json` and a JSON body (e.g. `{}` or `[]`) so `mapGraylogError`
  is never triggered. Listen on `127.0.0.1` port `0` and read the assigned port from
  `server.address().port`.

  Build the connection as `{ baseUrl: "http://127.0.0.1:" + port, apiToken: "T1" }` and call
  `makeClient(conn).request(...)`. Assert against the captured request:
  - bodyless GET: captured body string is empty AND `content-type` header is undefined.
  - bodyless GET: `accept` is `application/json` AND `x-requested-by` is `graylog-mcp`.
  - POST `{ title: "T" }`: `content-type` is `application/json` AND `JSON.parse(capturedBody)` deep-equals `{ title: "T" }`.
  - bodyless DELETE: captured body string is empty AND `content-type` header is undefined.

  Close the server in `after` so the test process exits cleanly.
  </action>
  <verify>
    <automated>cd /home/c_perronnet/git/graylog-mcp && npm test -- 'test/regression/client-bodyless-request.test.js' 2>&1 | tail -8</automated>
  </verify>
  <done>New regression test passes against the real axios path; it fails if client.js reverts to unconditional data/Content-Type; whole suite (`npm test`) stays green.</done>
</task>

</tasks>

<verification>
- `npm test` passes (full suite green, including existing `test/graylog-client.test.js`).
- New `test/regression/client-bodyless-request.test.js` proves a bodyless GET sends no body and no Content-Type via the real axios path.
- POST with an object body is byte-for-byte unchanged from prior behavior.
</verification>

<success_criteria>
- Bodyless GET/DELETE through `makeClient().request` sends neither a request body nor a `Content-Type` header.
- POST/PUT/PATCH with a real body still sends `Content-Type: application/json` and a JSON-serialized body.
- `Accept` and `X-Requested-By` headers sent on every request.
- D-07 writable guard, `_setCaptureRequest` seam, `mapGraylogError`, `validateStatus`, 60s timeout all unchanged.
- Regression test exercises the real axios path and would fail if the bug regressed.
- No new dependencies; ESM; matches project test conventions.
</success_criteria>

<output>
Create `.planning/quick/260516-ivt-fix-client-js-bodyless-request-400-bug/260516-ivt-SUMMARY.md` when done
</output>
