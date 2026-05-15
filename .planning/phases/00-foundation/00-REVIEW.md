---
phase: 00-foundation
reviewed: 2026-05-15T00:00:00Z
depth: standard
files_reviewed: 42
files_reviewed_list:
  - CHANGELOG.md
  - README.md
  - example-config.json
  - package.json
  - src/config.js
  - src/dispatch.js
  - src/graylog/auth.js
  - src/graylog/client.js
  - src/graylog/errors.js
  - src/graylog/normalize.js
  - src/handlers.js
  - src/index.js
  - src/tools.js
  - src/tools/_register.js
  - src/tools/_shared/conflict.js
  - src/tools/_shared/connection.js
  - src/tools/_shared/dry-run.js
  - src/tools/_shared/errors.js
  - src/tools/_shared/handler.js
  - src/tools/_shared/idempotency.js
  - src/tools/_shared/list.js
  - src/tools/_shared/schemas.js
  - src/tools/cluster-errors.js
  - src/tools/template-mgmt.js
  - test/auth-redaction.test.js
  - test/connection.test.js
  - test/dispatch.test.js
  - test/existing/aggregation-fixes.test.js
  - test/existing/clustering-preprocess.test.js
  - test/existing/clustering-strategy.test.js
  - test/existing/features.test.js
  - test/existing/histogram-fixes.test.js
  - test/existing/template-mgmt.test.js
  - test/existing/template-store.test.js
  - test/graylog-client.test.js
  - test/handler.test.js
  - test/idempotency.test.js
  - test/list.test.js
  - test/normalize.test.js
  - test/regression/read-tools.test.js
  - test/schema-parity.test.js
  - test/snapshot-config.js
findings:
  critical: 0
  warning: 5
  info: 6
  total: 11
status: issues_found
---

# Phase 0: Code Review Report

**Reviewed:** 2026-05-15T00:00:00Z
**Depth:** standard
**Files Reviewed:** 42
**Status:** issues_found

## Summary

Phase 0 lays down a clean, well-tested foundation: typed HTTP-client error
hierarchy, Map-based dispatch with fail-fast assertion, `defineMutatingHandler`
factory enforcing the dryRun-default invariant, idempotency-key derivation,
list-handler projection, and a snapshot-backed regression net proving the
dispatch refactor is byte-identical to the old if-chain. Defense-in-depth on
`writable: false` is implemented in both the wrapper and the HTTP client.
Unit-test coverage is thorough across all new primitives.

The findings below are all secondary to the production-relevant safety
invariants — every dryRun, writable, idempotency, and zod-validation gate is
correctly placed. The bulk of warnings are:
- A handful of documentation/version drift items that ship with the phase
- Two real correctness gaps in the v2.3-era handlers that survived the
  extraction (a missing `isError: true` and a behavioural inconsistency
  between the wrapper-side and client-side writable check). The CHANGELOG
  states these handlers are byte-identical to the old if-chain, so these are
  pre-existing issues that the regression snapshot confirms behaviour-wise —
  but the foundation phase is a reasonable point to surface them.
- Coverage gaps in the auth-redaction scanner and the conflict stub that
  could become silent vulnerabilities in Phase 1+.

No critical issues found.

## Warnings

### WR-01: `useConnectionHandler` not-found path missing `isError: true`

**File:** `src/handlers.js:71-79`
**Issue:** When a caller passes an unknown connection name to
`set_active_connection`, the handler returns a text response WITHOUT
`isError: true`, so MCP clients (and the regression snapshot at
`test/regression/__snapshots__/read-tools.test.js.snapshot:62-65`)
classify the response as a success. The "name is required" branch above
(lines 65-68) correctly sets `isError: true`; the "not found" branch does
not. This is inconsistent with the project's documented error-handling
convention (CLAUDE.md: "Hard error to the MCP client → return the
isError: true object").

While the CHANGELOG asserts these handlers are byte-identical to the v2.3
if-chain, Phase 0 is reasonable point to surface this so Phase 1+ doesn't
inherit the inconsistency.

**Fix:**
```js
const connections = getConnections();
if (!connections[connectionName]) {
    const available = Object.keys(connections).join(", ");
    return {
        isError: true,
        content: [{
            type: "text",
            text: `Connection "${connectionName}" not found. Available: ${available || "none"}`,
        }],
    };
}
```
The regression snapshot must be regenerated after the fix (the read-tools
suite's `use_connection unknown name → not-found error response` fixture
currently records `"isError": false`).

### WR-02: HTTP-method writable check is case-sensitive

**File:** `src/graylog/client.js:36`
**Issue:** The defense-in-depth writable gate checks `method !== "GET"`. If
any caller (including a future service-layer call) passes the method as
`"get"`, `"Get"`, or any other case variant, the check silently allows the
non-GET-equivalent through against a read-only connection. axios itself
normalizes method case, so the request would still be sent.

Today only `defineMutatingHandler` calls this code path (always with
uppercase), but the comment on lines 24-27 explicitly motivates this layer
as a safety net for *future* paths that bypass the wrapper — exactly the
scenario where casing might drift.

**Fix:**
```js
if (conn.writable === false && method.toUpperCase() !== "GET") {
    throw new GraylogError(
        `Connection is read-only (writable: false). Refusing ${method} ${path}.`,
        { status: 0, method, path, body: null }
    );
}
```

### WR-03: Auth-redaction scanner only walks one `__snapshots__` directory

**File:** `test/auth-redaction.test.js:19,44`
**Issue:** The scanner globs `test/__snapshots__/*.snapshot` only. The
co-located `test/regression/__snapshots__/` directory (created by
`snapshot-config.js:6-8`, which derives the snapshot path from each test
file's own dirname) is silently skipped. Phase 1+ will land per-domain
snapshots under `test/streams/__snapshots__/`,
`test/pipelines/__snapshots__/`, etc. — none of which would be scanned.

The current `read-tools.test.js.snapshot` happens to contain only short
fixture tokens (`token_a`, `token_b`), but a future regression test that
captures a `wrapGraylogError` body snippet from a real Graylog 4xx response
could leak a 32+ char apiToken-like value with no test catching it.

**Fix:** Walk all `__snapshots__/` directories under `test/`:
```js
import { readdirSync } from "node:fs";

function findAllSnapshotDirs(root) {
    const dirs = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const child = join(root, entry.name);
        if (entry.name === "__snapshots__") dirs.push(child);
        else dirs.push(...findAllSnapshotDirs(child));
    }
    return dirs;
}

const TEST_DIR = join(__dirname);
const SNAPSHOT_DIRS = findAllSnapshotDirs(TEST_DIR);
// ... iterate every dir, not just SNAPSHOTS_DIR ...
```

### WR-04: `findExistingMatches` silently returns `[]` even when callers wire it correctly

**File:** `src/tools/_shared/conflict.js:16-26`
**Issue:** The stub guards on `!opts.listPath || typeof opts.matchFn !== "function"` on line 17,
which returns `[]` for the Phase 0 use case (no opts). However, the *next*
line (25) ALSO returns `[]`, dropping straight through past the commented
real-implementation example. If a Phase 1 author writes
`findExistingMatches(client, { listPath: "/api/streams", matchFn: (s) => s.title === t })`
and exercises the dry-run flow, the wrapper will report `existingMatches: []`
with no warning that no list-fetch ever happened — directly contradicting
agent expectations of the conflict-pre-check feature (FOUND-11).

**Fix:** Either implement the body now (per the comment block), or fail
loudly when both opts are supplied but the stub isn't yet wired:
```js
export async function findExistingMatches(client, opts = {}) {
    if (!opts.listPath || typeof opts.matchFn !== "function") return [];
    // Phase 1+: replace this throw with the documented implementation.
    throw new Error(
        "findExistingMatches is a Phase-0 stub. listPath + matchFn were " +
        "provided but the implementation is not wired yet. Either drop the " +
        "options or implement the body per the comment above."
    );
}
```
Alternative: implement now since the body is already documented and a 3-line `await client.request → filter → map` is straightforward.

### WR-05: Doc / version drift could mislead Phase 1+ contributors

**Files:** `README.md:9,22-23,213`, `src/index.js:15`
**Issue:** Four pieces of documentation no longer match the codebase:

1. **README.md:9** advertises "25 tools" — `src/tools.js` exports 26
   (CHANGELOG also says "27 tools" at line 9 — itself inaccurate; the
   exported array has 26 entries: 1 conn-list + 1 conn-set + 4 search/list
   + 4 aggregations + 4 saved-searches + 3 events + 6 templates +
   cluster_log_messages + debug_query_histogram + get_context_messages
   = 26).
2. **README.md:22** says "Node.js 18+" — `package.json` engines was bumped
   to `>= 22.3.0` (D-01, CHANGELOG line 50). A user on Node 18 will see
   `EBADENGINE` warnings, not a clear failure.
3. **README.md:23** says "Graylog 6.x (tested on 6.2)" — the milestone
   constraint is Graylog 7.2.0-SNAPSHOT (per the current CLAUDE.md target,
   recently retargeted to 7.0.6 per `9c9f775 docs: retarget milestone to
   Graylog 7.0.6 (live test instance)`).
4. **src/index.js:15** still hard-codes `version: "2.2.0"` for the MCP
   `Server` constructor, while `package.json` is `2.3.0`. The MCP client
   sees the wrong server version string at handshake.

**Fix:** Update README's prerequisites + tool-count sentence and bump
`src/index.js:15` to match `package.json`. Better still, read the version
from `package.json` at startup:
```js
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
    "utf-8"
));

const server = new Server({
    name: "graylog-mcp-server",
    version: pkg.version,
}, { capabilities: { tools: {} } });
```

## Info

### IN-01: Duplicate `errorResponse` helpers across modules

**Files:** `src/tools/cluster-errors.js:12-14`, `src/tools/template-mgmt.js:4-6`,
`src/tools/_shared/errors.js:17-19`
**Issue:** Three identical 3-line `errorResponse(text)` helpers exist. The
canonical one was added in this phase (`src/tools/_shared/errors.js`),
explicitly noting (lines 1-6) that it is "reused verbatim from
src/tools/cluster-errors.js:12-14 so existing handlers and the new wrapper
layer agree on shape." That intent isn't carried through — the old copies
weren't deleted.

**Fix:** Replace the local definitions in `src/tools/cluster-errors.js`
and `src/tools/template-mgmt.js` with `import { errorResponse } from "./_shared/errors.js";`. Low-risk refactor — `node --test` will catch any
behavioural drift via the existing snapshot fixtures.

### IN-02: Dead-code fallback in dryRun default

**File:** `src/tools/_shared/handler.js:107`
**Issue:** `const dryRun = args.dryRun ?? true;` — `args` has already been
parsed through `mutatingBase.extend(...)` which declares
`dryRun: z.boolean().default(true)` (`src/tools/_shared/schemas.js:13`),
so post-parse `args.dryRun` is guaranteed to be a boolean (never
`undefined`). The `?? true` fallback is unreachable. The comment "default-
true enforced ONCE, here" is actually a small lie: the default is enforced
*twice* — once in the schema and again here.

**Fix:** Drop the fallback:
```js
const dryRun = args.dryRun;
```
Or, if you'd rather have a single source of truth, drop the
`.default(true)` from the schema. The current setup masks any future
schema-base regression (e.g., a contributor removing the default) so I'd
keep the schema default and drop the wrapper fallback.

### IN-03: `args.dryRun` documented-but-unused `runOrPreview` helper

**File:** `src/tools/_shared/dry-run.js:31-57`
**Issue:** `runOrPreview` is exported but no production code calls it —
the inlined dry-run logic in `defineMutatingHandler` (`handler.js:108-133`)
duplicates it byte-for-byte. The `SERVER_ASSIGNED_SENTINEL` constant IS
imported and used from this file, so the file isn't dead, but the
function is.

**Fix:** Either:
1. Replace the inlined block in `handler.js:108-133` with a call to
   `runOrPreview(req, { dryRun, name, connectionName, idempotencyKey, summary: summarize?.(args, req), apply, client })` — preserves the
   factored-out helper.
2. Delete the unused `runOrPreview` function and keep only the constant.

Option 1 is cleaner because it surfaces the "preview vs apply" branch
shape as a named helper. Either way, "keep both" is the worst option
because it lets the two implementations drift.

### IN-04: `mapGraylogError` 401 returns base `GraylogError` (no `Unauthorized` subtype)

**File:** `src/graylog/errors.js:27-34`
**Issue:** The classifier maps 400/403/404/409/422 to typed subclasses
but leaves 401 (Unauthorized — expired/invalid token) falling through to
the base `GraylogError`. The agent-friendly error messages in
`wrapGraylogError` would benefit from a distinct `GraylogAuthError` so
the agent can tell "your token is bad" apart from "you don't have
permission" (403).

**Fix:** Add the subtype (zero behaviour change for current callers since
they all `instanceof GraylogError` first):
```js
export class GraylogAuthError extends GraylogError { kind = "auth"; }

// In mapGraylogError:
const Ctor =
    res.status === 400 ? GraylogValidationError :
    res.status === 401 ? GraylogAuthError :
    res.status === 403 ? GraylogPermissionError :
    // ...
```
Not blocking for Phase 0 but the audit surface is mentioned in the
milestone constraints ("Insufficient permissions surface as upstream
403") and 401 is a sibling concern.

### IN-05: `formatZodError` joins numeric path segments verbatim

**File:** `src/tools/_shared/errors.js:34-36`
**Issue:** `iss.path.join(".")` produces strings like `"rules.0.field"`
for an error inside an array, which is slightly off-style vs. typical
JSON-Schema-flavoured `rules[0].field`. Not a bug — just a readability
nit. The test suite (`test/handler.test.js:79-86`) asserts that the
output `match`es `/title/` which still works.

**Fix (optional):** Bracket numeric segments:
```js
const path = iss.path.length === 0 ? "(root)" :
    iss.path.reduce((acc, seg) => {
        if (typeof seg === "number") return `${acc}[${seg}]`;
        return acc === "" ? seg : `${acc}.${seg}`;
    }, "");
```

### IN-06: `handleImportTemplates` overwrites the imported template's `id` field unconditionally

**File:** `src/tools/template-mgmt.js:109-112`
**Issue:** Line 110 spreads then overrides `id`: `{ ...tpl, id }`. If
`args.templates` is `{ "tpl_a": { id: "tpl_b", template: "..." }, ... }`
(i.e., the map key and the embedded `id` disagree), the handler silently
takes the map key. The behaviour is reasonable (use the key as canonical)
but undocumented in the tool description (`src/tools.js:641-651`) and the
caller has no way to learn that their `tpl.id` was ignored.

**Fix:** Either warn in the response when the discrepancy is observed, or
document it in `src/tools.js`'s `import_log_templates` description:
```
"templates: Map of templateId → template object. NOTE: the map key is
authoritative; if a template object contains an `id` field that disagrees
with its map key, the map key wins."
```

---

_Reviewed: 2026-05-15T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
