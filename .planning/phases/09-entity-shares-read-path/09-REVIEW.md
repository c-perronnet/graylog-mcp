---
phase: 09-entity-shares-read-path
reviewed: 2026-05-19T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/tools/authz/get-entity-shares.js
  - src/tools/authz/list-grantees.js
  - src/tools/authz/prepare-share.js
  - src/tools/authz/schemas.js
  - src/tools/authz/index.js
  - src/tools/meta/list-admin-tools.js
  - test/authz-entity-shares.test.js
  - test/authz-entity-shares-live.smoke.js
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
status: issues_found
---

# Phase 9: Code Review Report

**Reviewed:** 2026-05-19T00:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 9 ships two read-only tools (`get_entity_shares`, `list_grantees`), a shared
`fetchEntitySharePreview()` helper, zod read schemas, the now-populated `authz`
register barrel, and a `list-admin-tools.js` domain-override edit. The read-only
contract is well-defended: the helper hard-codes the `/prepare` suffix with an
`endsWith` self-guard, sends a `{}` body, the GRN is always `encodeURIComponent`'d,
and the live smoke check adds a process-aborting path guard. All 11 offline tests
pass and the commit endpoint is never reachable from this phase's code paths.

No BLOCKER-tier defects were found — there is no path to mutation, no injection,
and no secret exposure. However, the `entityGrn` validation path is materially
weaker than the `entityType`/`entityId` path, allowing grantee-type GRNs (and
other non-shareable shapes) to reach the network as share *targets*, contradicting
the design intent stated in `schemas.js`. Three warnings and four info items below.

## Warnings

### WR-01: `entityGrn` path bypasses the shareable-type restriction

**File:** `src/tools/authz/schemas.js:40-53`, `src/tools/authz/get-entity-shares.js:54-56`, `src/tools/authz/list-grantees.js:43-45`
**Issue:** The schema validates `entityGrn` only as `z.string().optional()` — no
type constraint. The handler then validates it with `parseGrn()`, which accepts the
full 6-type `GRN_TYPES` set (`stream/dashboard/search/user/builtin-team/role`).
The `entityType` field, by contrast, is pinned to the 3-type `ENTITY_TYPES` enum
(`stream/dashboard/search`). The result is an asymmetric contract: an agent that
passes `entityGrn: "grn::::user:someuser"` or `grn::::role:x` passes validation and
fires `POST /api/authz/shares/entities/grn%3A%3A%3A%3Auser%3Asomeuser/prepare` — a
grantee-type GRN used as a share *target*. `schemas.js:26-28` explicitly states
"Grantee types (user, builtin-team, role) are never valid as a share TARGET, so
they are intentionally excluded here" — but they are only excluded on one of the
two input paths. This is a correctness/contract gap, not a security hole (the
endpoint is read-only `/prepare`); Graylog will likely reject with 400/404, but the
tool should reject locally per its own stated contract and avoid a confusing
upstream error.
**Fix:** After `parseGrn()` succeeds, assert the parsed `type` is in the shareable
set before issuing the request:
```javascript
const parsed = parseGrn(args.entityGrn);
const SHAREABLE = new Set(["stream", "dashboard", "search"]);
if (!SHAREABLE.has(parsed.type)) {
    throw new Error(
        `entityGrn type "${parsed.type}" is not a shareable entity ` +
        `(expected stream, dashboard, or search)`,
    );
}
entityGrn = args.entityGrn.toLowerCase();
```
This belongs in a shared spot since both handlers duplicate the normalization
block (see WR-02).

### WR-02: GRN-normalization block duplicated verbatim across both handlers

**File:** `src/tools/authz/get-entity-shares.js:52-59`, `src/tools/authz/list-grantees.js:41-48`
**Issue:** The "normalize entity reference to a canonical GRN" step (the
`parseGrn`/`buildGrn` try-block) is copy-pasted byte-for-byte between the two
handlers, as is the `_testConnection` re-merge and the validate-then-resolve
preamble. `prepare-share.js` was created specifically to "remove the divergence
risk of two hand-copied path strings" — the same divergence risk applies to the
GRN-resolution logic, which carries the comma-operator subtlety and the WR-01 fix.
Two hand-copied copies will drift; the WR-01 fix would have to be applied twice.
**Fix:** Extract the entity-reference normalization into a shared helper alongside
`fetchEntitySharePreview` in `prepare-share.js` (or a new `entity-ref.js`), e.g.
`resolveEntityGrn(args)` returning the canonical GRN or throwing. Both handlers
then call it once.

### WR-03: `parseGrn` result discarded via comma operator — fragile and opaque

**File:** `src/tools/authz/get-entity-shares.js:55`, `src/tools/authz/list-grantees.js:44`
**Issue:** `entityGrn = args.entityGrn ? (parseGrn(args.entityGrn), args.entityGrn.toLowerCase()) : buildGrn(...)`
uses the comma operator to run `parseGrn` purely for its throw-side-effect, then
discards the parsed token object and re-derives the value with
`args.entityGrn.toLowerCase()`. This is non-obvious (the comma operator inside a
ternary is easy to misread as a typo), and it throws away the already-parsed
`{type, entity, ...}` that WR-01's fix needs. It also means `parseGrn` is doing
work twice conceptually — once to validate, and `toLowerCase()` re-does the
lowercasing `parseGrn` already performed internally.
**Fix:** Capture the result and use it:
```javascript
const { type } = parseGrn(args.entityGrn); // throws on malformed
// (apply WR-01 shareable-type check on `type` here)
entityGrn = args.entityGrn.toLowerCase();
```
Eliminates the comma operator and makes the parsed type available for WR-01.

## Info

### IN-01: `schemas.js` header comment is stale (claims "Phase 8 ships NO mutating tool")

**File:** `src/tools/authz/schemas.js:3-6`
**Issue:** The module header still reads "Phase 8 ships NO mutating tool, so this
module imports only `z`. The shared `mutatingBase` / `listBase` schemas ... are
NOT imported here — Phase 9/10 entity-share tool schemas will extend `mutatingBase`
when they land." Phase 9 has now landed and deliberately did *not* extend
`mutatingBase` (the read schemas are plain `z.object`, correctly — they are
`@NoAuditEvent` reads). The header now mis-describes the file and a future reader
would expect a `mutatingBase` import that the code intentionally omits.
**Fix:** Update the header to describe the Phase 9 read schemas and note that
`mutatingBase` arrives only with Phase 10's `share_entity` write tool.

### IN-02: `index.js` header still says "Phase 8 shipped this barrel empty"

**File:** `src/tools/authz/index.js:1-12`
**Issue:** The barrel comment describes both the empty Phase 8 state and the Phase
9 additions, which is fine as history, but line 1 labels the file as a Phase 8
artifact ("Side-effect register barrel for the authz domain (Phase 8)"). Minor;
the body comment already explains Phase 9. Low-priority doc consistency.
**Fix:** Either drop the parenthetical `(Phase 8)` from line 1 or change it to
reflect the current contents.

### IN-03: `entityType` supplied without `entityId` alongside `entityGrn` is silently ignored

**File:** `src/tools/authz/schemas.js:47-53`
**Issue:** The `.refine` XOR is `Boolean(entityGrn) !== Boolean(entityType && entityId)`.
If a caller passes `entityGrn` plus a stray `entityType` (but no `entityId`), the
right side is `false`, the XOR passes, and the handler silently takes the
`entityGrn` branch and ignores `entityType`. This is not a correctness bug — the
result is well-defined — but a confused agent that passed both gets no feedback
that half its input was dropped. The stricter "exactly one identification method,
no stray fields" intent stated in the comment is not fully enforced.
**Fix:** Optional — tighten the refine to also reject a partial `entityType`/
`entityId` pair when `entityGrn` is present, or accept the current lenient
behavior as adequate. Documented as info, not a required change.

### IN-04: No offline test covers the `entityGrn` input path

**File:** `test/authz-entity-shares.test.js`
**Issue:** Every offline test drives the handlers via `entityType`+`entityId`
(Tests 1-4, 7) or via a deliberately malformed `entityGrn` (Test 5) / the XOR
constraint (Test 6). No test exercises a *valid* `entityGrn` string flowing
through to a correctly-encoded request path. The `entityGrn` branch of the
ternary at `get-entity-shares.js:55` — including the comma-operator behavior and
the `toLowerCase()` — is therefore only covered for its rejection case. If WR-01/
WR-03 are addressed, this path needs a positive test anyway.
**Fix:** Add a test that passes `entityGrn: "grn::::stream:ABC123"` and asserts
the captured path contains `encodeURIComponent("grn::::stream:abc123")` (verifying
both the encoding and the lowercasing).

---

_Reviewed: 2026-05-19T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
