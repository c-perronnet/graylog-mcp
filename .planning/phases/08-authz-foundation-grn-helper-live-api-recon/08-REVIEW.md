---
phase: 08-authz-foundation-grn-helper-live-api-recon
reviewed: 2026-05-19T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - scripts/capture-authz-prepare-fixture.js
  - src/tools/_register.js
  - src/tools/_shared/cascade-hash.js
  - src/tools/authz/grn-helpers.js
  - src/tools/authz/index.js
  - src/tools/authz/schemas.js
  - test/authz-grn.test.js
  - test/cascade-hash.test.js
findings:
  critical: 0
  warning: 5
  info: 6
  total: 11
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-05-19T00:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 8 ships the AuthZ foundation: a pure GRN helper, a zod `Capability` enum, an
intentionally-empty authz register barrel, the `computeShareGrantHash` sha-256
primitive, and a read-only live `/prepare` recon probe script. The code is generally
careful and well-documented, with strong test coverage for the hash and GRN helpers.

No BLOCKER-class defects were found — there is no injection surface, no hardcoded
secret, and the probe script's safety guards are real. However, several WARNING-class
correctness gaps exist: `computeShareGrantHash` does not validate the shape of
individual grant entries (a malformed grant silently hashes `undefined`), the GRN
parser accepts an empty entity token and empty type-segment GRNs the live instance
would reject, `buildGrn` coerces non-string `type` via `String()` masking type
errors, and the probe script's `synced_entities` test assertion is weaker than the
captured fixture warrants. The empty `index.js` barrel imports `register` but never
uses it.

## Warnings

### WR-01: computeShareGrantHash does not validate individual grant entry shape

**File:** `src/tools/_shared/cascade-hash.js:302-318`
**Issue:** The function validates that `grants` is an array, but never validates the
shape of each element. `.map((g) => ({ grantee: g.grantee, capability: g.capability }))`
will read `undefined` from a `null`/non-object element (actually throwing only on
`null`/`undefined` element via property access on undefined — and silently producing
`{grantee: undefined, capability: undefined}` for `{}` or `{wrong: 1}`). The sort
comparator `a.grantee < b.grantee` then compares `undefined < undefined`, which is
`false` for both branches, leaving order unstable across calls. A grant set with a
missing/misspelled `grantee` key produces a hash over `{"grantee":undefined}` →
JSON.stringify drops the key entirely, so `{grantee:"x"}` and `{}` can collide or
silently misrepresent the grant. For a TOCTOU drift-refusal token this is a real
correctness hole: the Phase 10 gate could accept an apply whose grant set differs
from the previewed one because both hashed to the same digest after key-dropping.
**Fix:**
```javascript
const sorted = [...grants]
    .map((g, i) => {
        if (!g || typeof g !== "object" || Array.isArray(g)
            || typeof g.grantee !== "string" || g.grantee.length === 0
            || typeof g.capability !== "string" || g.capability.length === 0) {
            throw new Error(
                `computeShareGrantHash: grants[${i}] must be {grantee:string, capability:string}`,
            );
        }
        return { grantee: g.grantee, capability: g.capability };
    })
    .sort((a, b) => (a.grantee < b.grantee ? -1 : a.grantee > b.grantee ? 1 : 0));
```

### WR-02: parseGrn accepts an empty entity token, buildGrn rejects it — asymmetric contract

**File:** `src/tools/authz/grn-helpers.js:48-94`
**Issue:** `buildGrn` rejects an empty `id` (`id.length === 0` throw), but `parseGrn`
imposes no non-empty constraint on the parsed `entity` token. `parseGrn("grn::::stream:")`
succeeds and returns `{type:"stream", entity:""}`. The two functions therefore
disagree on what a valid GRN is: a string `buildGrn` would never emit is still
accepted by `parseGrn`/`isGrn`. Since `buildGrn`'s own doc says the result must
"round-trip through `parseGrn`", the inverse should hold too — an entity-less GRN is
not a real Graylog resource and downstream entity-share tools would interpolate it
into a `/prepare` path with a dangling colon. This also means `isGrn("grn::::stream:")`
returns `true`, masking a malformed agent input.
**Fix:** In `parseGrn`, after destructuring tokens, reject an empty `entity`:
```javascript
if (entity.length === 0) {
    throw new Error(`"${grn}" is not a valid GRN string (empty entity token)`);
}
```

### WR-03: buildGrn coerces a non-string type via String(), masking caller bugs

**File:** `src/tools/authz/grn-helpers.js:49`
**Issue:** `const t = String(type).toLowerCase();` silently coerces any value. A
caller passing `null` produces `"null"`, `undefined` produces `"undefined"`, an
object produces `"[object object]"` — none are in `GRN_TYPES`, so the throw still
fires, but the error message becomes `Unknown GRN type "null"` rather than a clear
type-error. More importantly it is inconsistent with the sibling `id` check
(line 55) which explicitly rejects non-strings with a dedicated message, and with
`parseGrn` line 77 which rejects a non-string input outright. The asymmetry is a
quality defect — a future caller passing a number for `type` gets a confusing
"Unknown GRN type" instead of "type must be a string".
**Fix:**
```javascript
if (typeof type !== "string" || type.length === 0) {
    throw new Error("buildGrn: type must be a non-empty string");
}
const t = type.toLowerCase();
```

### WR-04: synced_entities fixture test is weaker than the captured fixture warrants

**File:** `test/authz-grn.test.js:184-193`
**Issue:** The test treats `synced_entities` as fully optional (`if ("synced_entities"
in PREPARE_FIXTURE)`). But the committed fixture (`prepare-response-7.0.6.json`) DOES
contain `synced_entities` — the test comment itself states "On the captured live 7.0.6
instance it IS present". As written, if a future fixture re-capture or hand-edit
silently drops `synced_entities`, the test still passes — the very Pitfall-5 wire-shape
drift the test exists to catch goes undetected. An optional-key test that never
exercises the present branch on the actual fixture is a coverage blind spot. The
fixture also contains `sharing_user`, `selected_grantee_capabilities`, and
`missing_permissions_on_dependencies` keys (verified) that the top-level-keys test
(lines 165-175) does not pin, so DTO drift in those fields is also unguarded.
**Fix:** Since the committed fixture is the verified live capture, assert the key is
present and an array unconditionally for THIS fixture, and keep the optional note as
a doc comment for cross-build tolerance:
```javascript
test("prepare-response-7.0.6 fixture carries synced_entities as an array", () => {
    assert.ok("synced_entities" in PREPARE_FIXTURE,
        "the committed 7.0.6 capture includes synced_entities");
    assert.ok(Array.isArray(PREPARE_FIXTURE.synced_entities));
});
```

### WR-05: probe script discovers version via /api/system but Graylog exposes it at /api/system root

**File:** `scripts/capture-authz-prepare-fixture.js:108`
**Issue:** The provenance version-discovery does `client.request("GET", "/api/system")`
and reads `root.version`. The script comment claims this is "best-effort" and any
failure is non-fatal — that part is fine. But the probe was created precisely to
record an accurate `graylog_version` provenance value (the entire purpose per the
file header is capturing the "REAL Graylog 7.0.6" shape). If `/api/system` does not
return a `version` field at the top level (Graylog 7.x nests cluster/system info
differently across endpoints), the provenance silently records `"unknown"` and the
fixture's authority — "verbatim live 7.0.6" — is unverifiable from the artifact
itself. A recon probe whose provenance can degrade to `"unknown"` without any signal
defeats its own goal. At minimum the script should `console.error` a warning when
the version stays `"unknown"` so the operator knows the provenance is incomplete.
**Fix:** After the try/catch, warn if unresolved:
```javascript
if (graylogVersion === "unknown") {
    console.error("[capture-authz-prepare] WARNING: could not resolve Graylog "
        + "version — provenance.graylog_version will be 'unknown'.");
}
```

## Info

### IN-01: authz/index.js imports `register` but never calls it

**File:** `src/tools/authz/index.js:15`
**Issue:** The barrel is intentionally empty for Phase 8 (no handlers), but it still
`import { register } from "../../dispatch.js"`. The import is unused — under most
lint configs this is a dead-import warning. The precedent cited (`events/index.js`
shipped empty in Plan 05-01) does not justify keeping an unused binding.
**Fix:** Remove the import line; re-add it in Phase 9 when the first `register()`
call lands. The comment on line 17 (`// (no register() calls — handlers land in
Phase 9+)`) is sufficient documentation on its own.

### IN-02: probe script ignores client.request body for GET but passes 3rd arg inconsistently

**File:** `scripts/capture-authz-prepare-fixture.js:71,103,108`
**Issue:** `client.request` is called as `("GET", "/api/streams")` and
`("GET", "/api/system")` with two args, but `("POST", path, {})` with three. This is
correct per the client contract (bodyless GET), but passing an empty object `{}` for
the POST is subtly load-bearing: the client treats `body !== null && body !== undefined`
as "has body", so `{}` sends `Content-Type: application/json` with a literal `{}`.
That is the intended behavior for `/prepare`, but a brief inline note that `{}` (not
`undefined`) is required would prevent a future maintainer from "cleaning up" the
empty-object argument and accidentally sending a bodyless POST.
**Fix:** Add a one-line comment at line 103 noting `{}` must be a real empty object
(not omitted) so the client sends a JSON body the `/prepare` endpoint expects.

### IN-03: resolveProbeConnection silently falls back to the active connection

**File:** `scripts/capture-authz-prepare-fixture.js:49`
**Issue:** `connections[TARGET_CONNECTION] ?? getActiveConnectionConfig()` — if the
`test` connection is absent, the probe silently targets whatever the active
connection happens to be. The script header and `TARGET_CONNECTION = "test"` make
clear the probe is meant for the specific live `test` instance. A silent fallback to
an arbitrary active connection could point the probe at the wrong Graylog. The
`name` recorded in `_provenance.connection` would still say `"test"` (line 56 hard-codes
`name: TARGET_CONNECTION`) even though a different instance was probed — making the
provenance block actively misleading.
**Fix:** Either drop the `?? getActiveConnectionConfig()` fallback so a missing
`test` connection throws cleanly, or set `name` to the actually-resolved connection
name rather than the constant.

### IN-04: GRN_TYPES Set membership check is case-sensitive but only lowercase is stored

**File:** `src/tools/authz/grn-helpers.js:26-33,50,88`
**Issue:** `GRN_TYPES` contains only lowercase strings and both `buildGrn`/`parseGrn`
lowercase before `.has()`. This is correct, but `GRN_TYPES` is exported as a mutable
`Set` — any importer can `GRN_TYPES.add("Team")` or `.delete("stream")` and corrupt
the validation contract process-wide. For a security-relevant allowlist (it gates
which entity types can be shared) an immutable export is safer.
**Fix:** Freeze membership by exporting a frozen array and deriving a private Set, or
document that the Set must not be mutated. Minimal: `Object.freeze` won't lock a Set;
expose `GRN_TYPES` as a frozen array and keep an internal Set for lookups.

### IN-05: Capability enum has no explicit default despite the comment claiming one

**File:** `src/tools/authz/schemas.js:17`
**Issue:** The comment (lines 15-16) states "Downstream entity-share tools default to
the least-privilege capability, `view`." But `Capability` is a bare `z.enum([...])`
with no `.default("view")`. The default is therefore not encoded here — it must be
re-implemented in each Phase 9/10 tool schema, risking divergence (one tool defaults
to `view`, another forgets). If the least-privilege default is a real invariant, the
schema module is the place to pin it.
**Fix:** Either export `CapabilityWithDefault = Capability.default("view")` for tool
schemas to reuse, or soften the comment to "tool schemas SHOULD apply `.default("view")`"
so it does not read as an already-implemented guarantee.

### IN-06: parseGrn cluster/tenant/scope tokens returned unvalidated

**File:** `src/tools/authz/grn-helpers.js:87-93`
**Issue:** `parseGrn` returns `cluster`, `tenant`, `scope` verbatim from the split.
On a single-cluster self-hosted Graylog these are always empty (the module header
documents this). `parseGrn` accepts and returns a GRN with non-empty cluster/tenant/
scope (e.g. `grn:c1::s:stream:abc`) even though the v3.1.0 milestone explicitly
targets only single-cluster deployments. This is not a bug today (no caller inspects
those tokens), but a GRN with populated cluster/tenant tokens would be a
multi-tenant artifact the milestone does not support — accepting it silently could
let a wrong-tenant GRN flow into a Phase 9 share path.
**Fix:** Consider rejecting non-empty cluster/tenant/scope in `parseGrn` (or document
explicitly that they are intentionally tolerated for forward-compat). A comment
clarifying the intent is the minimum.

---

_Reviewed: 2026-05-19T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
