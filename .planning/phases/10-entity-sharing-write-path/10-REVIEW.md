---
phase: 10-entity-sharing-write-path
reviewed: 2026-05-20T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/tools/authz/share-entity.js
  - src/tools/authz/schemas.js
  - src/tools/authz/index.js
  - src/tools/_shared/connection.js
  - src/tools/meta/list-admin-tools.js
  - test/authz-share-entity.test.js
  - test/authz-share-entity-live.smoke.js
findings:
  critical: 2
  warning: 5
  info: 4
  total: 11
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-05-20T00:00:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Phase 10 ships `share_entity`, the highest-blast-radius mutating tool in the v3.1.0 milestone. The headline read-merge-write pattern is correctly implemented — the Pitfall 1 acceptance gate (Test 1) is structurally tied to the only code path `build()` exposes, so a regression would fail loudly. Drift-refusal (Test 4) is real: `defineMutatingHandler` unconditionally re-runs `build()` before the apply branch, and `build()` re-fetches `active_shares`, so the recomputed token diverges when state drifts. The last-`own` guard, ambiguity-on-title-collision behaviour, capability enum pin, 400-with-body parsing, and 403→`not_entity_owner` mapping are all correctly wired.

That said, the **`granteeGrn` input path has two real holes**: (1) the handler comment promises lowercasing that does not actually happen, so a mixed-case `granteeGrn` will mismatch the lowercased grantees in `active_shares` and silently produce a duplicate-cased grant in the POST body (BLOCKER); and (2) there is no GRANTEE_TYPES guard symmetric to `SHAREABLE_TYPES`, so a stream/dashboard/search GRN can be POSTed as a "grantee" with no client-side refusal (BLOCKER).

Several smaller defects are noted as warnings — the `_testConnection` inline-object branch accepts arrays (`typeof [] === "object"`), `resolveGranteeFromTitle` does not validate that `available_grantees[].id` is a string, an empty-string `granteeGrn` slips past zod, and the smoke probe's `assertSafeAuthzPath` will not catch a mutating POST whose path Graylog has aliased.

`meta/list-admin-tools.js` only changed to add the `share_entity` override; that addition is correct.

## Critical Issues

### CR-01: `granteeGrn` is used verbatim without lowercasing, breaking merge against server-lowercased `active_shares`

**File:** `src/tools/authz/share-entity.js:233-234`
**Severity:** BLOCKER

The handler accepts `args.granteeGrn` and passes it directly into `mergeGrants` / `buildCurrentGrantMap`:

```js
const granteeGrn = args.granteeGrn
    ?? resolveGranteeFromTitle(preview.available_grantees ?? [], args.granteeUsername);
```

`src/tools/authz/schemas.js:97` explicitly comments "granteeGrn is passed through verbatim (lowercased)" — but no lowercasing happens here. `active_shares[].grantee` arrives from Graylog already lowercased (GRN.parse lowercases the whole string — `grn-helpers.js:89`), so when the agent passes a mixed-case `granteeGrn` like `"grn::::user:ABC"`:

1. `buildCurrentGrantMap` populates the map with the server-lowercased key `"grn::::user:abc"`.
2. `mergeGrants({ revoke:false })` calls `merged.set("grn::::user:ABC", capability)` — a DIFFERENT key.
3. The merged map now contains **two entries** for the same logical user (`abc` and `ABC`), and the POST body's `selected_grantee_capabilities` carries the duplicate.
4. The server lowercases on parse and collapses them — but with **the mixed-case capability winning** (last write), which is the OPPOSITE of read-merge intent. A grant change can silently revert another grant.

For `revoke:true` the bug is worse: `current.has("grn::::user:ABC")` returns false (current only has `abc`), so the handler refuses with `not_currently_granted` — but the grantee IS granted. The agent sees a false-negative.

This also subverts drift-refusal: `computeShareGrantHash` sorts by grantee string, so `"...ABC"` vs `"...abc"` produce different hashes; a no-op re-share would issue a non-matching token.

**Fix:** Lowercase `args.granteeGrn` exactly once at the boundary, matching the schema-side documentation contract:

```js
const granteeGrn = args.granteeGrn
    ? args.granteeGrn.toLowerCase()
    : resolveGranteeFromTitle(preview.available_grantees ?? [], args.granteeUsername);
```

(`resolveGranteeFromTitle` returns `available_grantees[i].id` which the server has already lowercased — no extra normalization needed on that branch.) Add a regression test that passes `granteeGrn: "grn::::user:ABC"` against `active_shares: [{grantee:"grn::::user:abc", ...}]` and asserts the merged keys are a single lowercased entry.

### CR-02: No GRANTEE_TYPES guard — a stream/dashboard/search GRN can be POSTed as a "grantee"

**File:** `src/tools/authz/share-entity.js:233`, `src/tools/authz/schemas.js:98`
**Severity:** BLOCKER

`schemas.js` declares `granteeGrn: z.string().optional()` — no shape validation. The handler then trusts it verbatim. The symmetric `entityGrn` path has the `SHAREABLE_TYPES` guard in `resolveEntityGrn` (`grn-helpers.js:156-175`) which rejects grantee-type GRNs (`user`/`builtin-team`/`role`) as share targets — but there is no inverse guard rejecting share-target-type GRNs (`stream`/`dashboard`/`search`) used as a grantee.

Agent input `granteeGrn: "grn::::stream:foo"` is therefore accepted, merged into the `selected_grantee_capabilities` body, and POSTed. The server's response is undefined — best case a 400, worst case a successful share where a STREAM becomes a "user" of another stream, breaking authz model invariants. The threat-model defence ("client-side rejection so it never reaches the network as a share target") is broken on the grantee side.

The same hole admits any malformed string (`granteeGrn: "not-a-grn"`, empty string, etc. — see WR-04).

**Fix:** Promote a `GRANTEE_TYPES` constant in `grn-helpers.js` and add a `resolveGranteeGrn` helper that mirrors `resolveEntityGrn` — parse, check type ∈ `{user, builtin-team, role}`, return the lowercased canonical:

```js
// grn-helpers.js
export const GRANTEE_TYPES = new Set(["user", "builtin-team", "role"]);

export function resolveGranteeGrn(grn) {
    const { type } = parseGrn(grn); // throws on malformed
    if (!GRANTEE_TYPES.has(type)) {
        throw new Error(
            `granteeGrn type "${type}" is not a grantee type ` +
            `(expected user, builtin-team, or role)`,
        );
    }
    return grn.toLowerCase();
}
```

Then in share-entity.js `build()`:

```js
let granteeGrn;
if (args.granteeGrn) {
    try {
        granteeGrn = resolveGranteeGrn(args.granteeGrn);
    } catch (err) {
        throw tagError(err, "invalid_grantee_reference", 422);
    }
} else {
    granteeGrn = resolveGranteeFromTitle(preview.available_grantees ?? [], args.granteeUsername);
}
```

This also resolves CR-01 in the same change (lowercasing is now centralised).

## Warnings

### WR-01: `_testConnection` inline-object branch accepts arrays (`typeof [] === "object"`)

**File:** `src/tools/_shared/connection.js:41`

```js
if (typeof args._testConnection === "object" && args._testConnection !== null) {
```

Arrays satisfy this predicate (`typeof [] === "object"`, `[] !== null`). Spreading an array into the conn object yields numeric-string keys (`"0"`, `"1"`, …) and produces a malformed conn. Not exploitable from a production agent (the seam is stripped by the wrapper before zod parse, then re-merged from `rawArgs` — but `rawArgs._testConnection` would only ever be an array if a test passes one), so this is defence-in-depth rather than a live bug. Still, the comment block claims the object form is `{baseUrl, apiToken, writable?}` and the runtime predicate doesn't enforce that shape.

**Fix:** Tighten the predicate:

```js
if (
    typeof args._testConnection === "object"
    && args._testConnection !== null
    && !Array.isArray(args._testConnection)
) {
```

### WR-02: `resolveGranteeFromTitle` does not validate `matches[0].id` is a non-empty string

**File:** `src/tools/authz/share-entity.js:82-105`

```js
const matches = grantees.filter((g) => g && g.title === username);
...
return matches[0].id;
```

If a fixture (or a future Graylog DTO drift) produces an `available_grantees` entry with `id: null` / `id: undefined` / `id: 42`, the handler will set a non-string Map key and ultimately produce a malformed `selected_grantee_capabilities` body. The Phase 8 fixture is well-shaped today, so this is a robustness gap rather than a live bug, but the symmetric defence already exists in `buildCurrentGrantMap:115-116` (which type-checks `share.grantee`).

**Fix:** Type-check the resolved id before returning:

```js
const resolved = matches[0].id;
if (typeof resolved !== "string" || resolved.length === 0) {
    throw tagError(
        new Error(
            `username "${username}" resolved to a non-string id ` +
            `(available_grantees entry shape drift?)`,
        ),
        "grantee_resolution_invalid",
    );
}
return resolved;
```

### WR-03: Empty-string `granteeGrn` slips past zod and produces a degenerate POST

**File:** `src/tools/authz/schemas.js:98,118-123`

`granteeGrn: z.string().optional()` has no `.min(1)`. `granteeUsername: z.string().min(1).optional()` does. So an agent payload `{granteeGrn: "", granteeUsername: "alice"}` lets the XOR refine compute `Boolean("") !== Boolean("alice")` → `false !== true` → passes, and `args.granteeGrn ?? ...` keeps the empty string (it is not nullish), causing the handler to compute a token over an entry with key `""` and POST it. Server response undefined.

Likewise the `entityGrn` field (`schemas.js:92`) has no `.min(1)` and is also XOR'd via `Boolean(entityGrn)` — empty-string `entityGrn` similarly slips past XOR when `entityType + entityId` are absent (`Boolean("") !== Boolean(undefined && undefined)` → `false !== false` → fails refine, so this one is actually saved by the symmetric absence — but it's fragile).

**Fix:** Pin both string fields with `.min(1)` so empty-string isn't a valid value at all:

```js
entityGrn: z.string().min(1).optional(),
granteeGrn: z.string().min(1).optional(),
```

### WR-04: Apply-path `apply()` cannot surface the `confirmation_mismatch` reason set by the wrapper for caller-visible drift logging

**File:** `src/tools/authz/share-entity.js:285-327`

Not a correctness bug — this is a behavioural observation. The handler's apply function rethrows untyped errors (anything that is not 400-with-validation-result or 403). In particular, a network-layer failure during the apply POST (ECONNRESET, ETIMEDOUT) becomes a plain `Error` from `client.js:82`, which `wrapGraylogError` falls through with no `reason` tag. The agent then sees a generic envelope and cannot programmatically distinguish "the apply may or may not have hit the server" from "it definitely didn't".

This matters for share_entity more than for other mutating tools because partial-apply on this endpoint changes authz — a retry without observing the actual state risks compounding the change.

**Fix:** Tag network failures from the apply branch with `reason: "apply_inconclusive"` so the agent knows a `get_entity_shares` re-read is required before retry. Or document the contract: "after a non-tagged apply error, agent MUST re-read before retrying."

### WR-05: Smoke probe's `assertSafeAuthzPath` matches only the exact `/api/authz/shares/entities/` prefix — Graylog path aliases would silently bypass the guard

**File:** `test/authz-share-entity-live.smoke.js:68,129-150`

```js
const AUTHZ_PREFIX = ["/api", "authz", "shares", "entities", ""].join("/");
...
if (typeof path !== "string" || !path.startsWith(AUTHZ_PREFIX)) {
    return; // not an authz-shares path — nothing to guard
}
```

Any path that does NOT start with this exact prefix is treated as "not an authz path". Graylog frequently registers JAX-RS aliases (e.g., `/api/system/authz/...`, `/api/legacy/authz/...`). If a future Graylog upgrade adds an alias, the smoke probe would let a mutating POST through silently. Defence-in-depth is the entire point of this file.

**Fix:** Invert the check — refuse any non-GET method that contains `"authz"` or `"shares"` anywhere in the path:

```js
function assertSafeAuthzPath(method, path) {
    if (typeof path !== "string") return;
    const isAuthzAdjacent = /authz|shares/i.test(path);
    if (!isAuthzAdjacent) return;
    if (method && method.toUpperCase() !== "POST") return; // GET probes OK
    if (!path.endsWith("/prepare")) {
        console.error(`[smoke] FATAL: non-/prepare authz-adjacent path "${path}" ...`);
        process.exit(2);
    }
    ...
}
```

…and thread the method through `interceptor` (it already has `req?.method`).

## Info

### IN-01: `mergeGrants` accepts and silently no-ops "set capability to the value already in current" — no client-side noop refusal

**File:** `src/tools/authz/share-entity.js:124-154`

When grant-mode (`revoke:false`) is called with `granteeGrn` already in `current` AT THE SAME `capability`, `merged.set(granteeGrn, capability)` is a no-op. The handler then computes a token over the unchanged grant set, returns a dry-run preview, and on apply POSTs the unchanged body. No user harm but the agent sees `existingMatches: [{...similarity_reason:"already_granted"}]` and may infer the change was made. Consider returning a structured "already_in_desired_state" hint so the agent skips the apply altogether.

### IN-02: `computeDiff` parameter `_revoke` is unused

**File:** `src/tools/authz/share-entity.js:182`

The leading underscore acknowledges this, but the function signature still accepts the argument. Drop the parameter and update the single call site (`share-entity.js:262`) for clarity.

### IN-03: Commented-out planning artefacts at the top of `share-entity.js` (SHARE-01/03/04/...)

**File:** `src/tools/authz/share-entity.js:1-57`

The 57-line preamble of plan-tag references is invaluable while the plan is fresh but will rot as future phases ship. The "DELIBERATE NON-FEATURES" section in particular will be load-bearing for whoever revisits this in Phase 11. Consider extracting the plan-tag history to a `docs/` artefact (or the phase summary) and keeping only the load-bearing invariants in the source-file header.

### IN-04: `tagError` sets `err.method = ""` and `err.path = ""` purely to participate in `wrapGraylogError`'s `.filter(Boolean)` formatter

**File:** `src/tools/authz/share-entity.js:71-78`

These empty-string assignments are a couple of indirect filter-tricks — they rely on `parts.filter(Boolean)` dropping falsy values to suppress the otherwise-printed `<METHOD> <PATH>` chunks of the rendered text. The behaviour is correct but brittle: a future formatter change in `errors.js` that uses `?? ""` would suddenly emit `[share_entity] 422 :` (note the trailing colon). Either omit these fields entirely (the formatter already handles undefined) or assert/document the dependency.

---

_Reviewed: 2026-05-20T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
