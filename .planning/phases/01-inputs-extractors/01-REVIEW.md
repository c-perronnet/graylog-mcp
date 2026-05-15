---
phase: 01-inputs-extractors
reviewed: 2026-05-15T11:51:04Z
depth: standard
files_reviewed: 29
files_reviewed_list:
  - src/tools.js
  - src/tools/_register.js
  - src/tools/_shared/conflict.js
  - src/tools/_shared/handler.js
  - src/tools/_shared/list.js
  - src/tools/inputs/create-extractor.js
  - src/tools/inputs/create-input.js
  - src/tools/inputs/delete-extractor.js
  - src/tools/inputs/delete-input.js
  - src/tools/inputs/get-input.js
  - src/tools/inputs/index.js
  - src/tools/inputs/list-extractors.js
  - src/tools/inputs/list-input-types.js
  - src/tools/inputs/list-inputs.js
  - src/tools/inputs/redact.js
  - src/tools/inputs/schemas.js
  - src/tools/inputs/start-input.js
  - src/tools/inputs/stop-input.js
  - src/tools/inputs/type-catalogue.js
  - src/tools/inputs/update-extractor.js
  - src/tools/inputs/update-input.js
  - test/auth-redaction.test.js
  - test/conflict.test.js
  - test/extractors.test.js
  - test/fixtures/type-catalogue-7.0.6.json
  - test/handler.test.js
  - test/inputs.test.js
  - test/list.test.js
  - test/schema-parity.test.js
  - test/type-catalogue.test.js
findings:
  critical: 0
  warning: 4
  info: 7
  total: 11
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-05-15T11:51:04Z
**Depth:** standard
**Files Reviewed:** 29 (note: `files_reviewed_list` enumerates 29 entries; one entry — `test/fixtures/type-catalogue-7.0.6.json` — is a JSON fixture, not a source file)
**Status:** issues_found

## Summary

Phase 1 lands 12 net-new tools for Graylog inputs and extractors. The domain-specific concerns called out in the review brief are all addressed:

- **C3 mitigation (`update-input.js`)**: strict no-echo on `configuration` is implemented correctly — only agent-supplied `changes.configuration` entries reach the wire body. Encrypted fields the agent did NOT pass are never on the wire. Verified by tests 27-29 (no-op, empty-config, title-only).
- **D-04 redaction (`redact.js`, `create-input.js`)**: encrypted-field values are replaced with `<redacted>` in dry-run previews; the real secret is wrapped as `{ set_value }` only on the apply body via `_applyBody`. Tests 20, 30, 31 enforce.
- **D-05 cascade preview (`delete-input.js`)**: dry-run pre-flights `GET /extractors` and surfaces `cascades.extractors[]` with `id` + `title` + `extractor_type`. Test 34 + snapshot 4 enforce.
- **D-06 type catalogue cache (`type-catalogue.js`)**: per-connection Map keyed by connectionName, `_clearTypeCatalogueForTests()` seam present. Tests 7-12 cover.
- **D-07 extractor schemas (`schemas.js`)**: all 8 Graylog 7.0.6 primitives covered via `EXTRACTOR_TYPE_TO_CONFIG`; closed `ExtractorTypeEnum` z.enum rejects `key_value` and `bogus_type` at parse time.
- **A2 conflict pre-check (`_shared/conflict.js`)**: `findExistingMatches({listPath, matchFn})` calls `client.request("GET", listPath, null)`, normalizes envelope shapes (`inputs`/`streams`/`extractors`/`items`), projects to `{id, title, similarity_reason}`.
- **A4 async build (`_shared/handler.js`)**: `await build(args)` wraps; build rejections flow through `wrapGraylogError`. Tested in `handler.test.js` async-build tests.
- **Defense-in-depth (`_shared/handler.js`)**: writable-flag short-circuit fires before build()/network; `src/graylog/client.js` keeps the carried-forward Phase 0 case-sensitive method check (WR-02 from Phase 0 review) as documented in the brief.

The findings below are 4 Warnings around subtle correctness gaps and 7 Info items for documentation / convention deviations. No Critical issues. The C3 mitigation centerpiece is solid.

## Warnings

### WR-01: `update_input.build()` echoes `current.node` back to wire body — violates D-03 strict no-echo at the top-level envelope

**File:** `src/tools/inputs/update-input.js:83-85`
**Issue:**
The D-03 strict no-echo contract states the wire body must emit ONLY the agent-requested changes. The implementation enforces this for `configuration` (lines 86-94) but NOT for `node`: when the agent did not pass `changes.node` and `current.node !== undefined`, the wire body still emits `node: current.node`.

```js
...(args.changes.node !== undefined || current.node !== undefined
    ? { node: args.changes.node ?? current.node }
    : {}),
```

Per Graylog's `InputCreateRequest` deserializer, only `type` + `title` + `global` are REQUIRED on PUT — `node` is optional. The comment on line 77 ("Graylog's PUT requires `type` + `title` + `global` on every call") confirms `node` is not required, yet `node` is echoed back. This is the same class of bug the C3 mitigation guards against for `configuration`: round-tripping a non-agent-supplied field can have unintended effects (e.g., re-pinning a node assignment the operator changed via the web UI between blueprint steps, or echoing a node-id the connection's API token can't see).

**Fix:**
Mirror the `configuration` strict-no-echo for `node`. Only emit `node` when the agent explicitly provided it in `changes`:
```js
const wireBody = {
    type: current.type,
    title: args.changes.title ?? current.title,
    global: args.changes.global ?? current.global,
    ...(args.changes.node !== undefined ? { node: args.changes.node } : {}),
    ...(agentConfig !== null
        ? { configuration: encodeEncryptedForWire(agentConfig, encryptedFields) }
        : {}),
};
```
Also add a regression test mirroring tests 27-29: when `current.node === "node-abc"` and `changes = { title: "renamed" }`, the wire body MUST NOT contain a `node` key.

If the team intentionally wants to preserve the node binding across partial updates, this should be documented explicitly in the file header alongside the `configuration` no-echo rationale.

---

### WR-02: `encodeEncryptedForWire` preview/apply mismatch when agent passes a non-string encrypted value

**File:** `src/tools/inputs/redact.js:51-67` (and indirectly `src/tools/inputs/create-input.js:64-73`, `src/tools/inputs/update-input.js:91-102`)
**Issue:**
`redactForPreview` replaces ANY value at an encrypted-field key with `<redacted>` (line 33-34: `if (field in out) out[field] = REDACTION_PLACEHOLDER;` — no type check). `encodeEncryptedForWire` only wraps `typeof v === "string"` values as `{ set_value }` (line 62); other types fall through unchanged with the comment "Other types: leave as-is" (line 65).

The consequence: if the agent passes `tls_key_password: 12345` (number) for an input type that falls through to generic `z.record(z.unknown())` (any non-strict-schema input type), the dry-run preview shows `tls_key_password: "<redacted>"` but the apply wire body emits `tls_key_password: 12345`. The D-04 contract ("agent sees the field is set without seeing the secret") is broken: the preview hides the value, but the apply leaks the literal value to Graylog (which may accept it as a 5-digit string post-coercion, then re-encrypt the digits as the actual password).

For strict-schema inputs (GELF UDP/TCP/HTTP, Beats2, Syslog UDP/TCP, Raw UDP/TCP) the per-type schema's `TlsConfigExt` rejects non-string `tls_key_password` at zod parse time. For everything else — AWS plugin, CEF, Kafka, Office365, custom plugins — there is no zod gate, so the type-catalogue-driven runtime encryption detection is the only barrier and it is currently inconsistent between preview and apply.

**Fix:**
Either (a) align preview and apply by having both functions reject non-string non-placeholder values (throw or skip the field), or (b) widen `encodeEncryptedForWire` to also wrap numbers/booleans as `{ set_value: String(v) }`. (a) is safer — preview-apply parity is the D-04 invariant. Suggested:

```js
export function encodeEncryptedForWire(configuration, encryptedFields) {
    if (!configuration || typeof configuration !== "object") return configuration;
    const out = { ...configuration };
    for (const field of encryptedFields) {
        if (!(field in out)) continue;
        const v = out[field];
        if (v && typeof v === "object"
            && ("keep_value" in v || "delete_value" in v || "set_value" in v)) {
            continue;
        }
        if (typeof v === "string") {
            out[field] = { set_value: v };
            continue;
        }
        // Refuse non-string non-placeholder values for encrypted fields.
        // The preview-apply parity invariant requires a single contract; if zod
        // can't catch this (generic z.record(z.unknown()) input types), reject
        // here so the agent gets a clear error rather than a silent leak.
        throw new Error(
            `Encrypted field "${field}" must be a string or a Graylog placeholder; got ${typeof v}.`
        );
    }
    return out;
}
```

Add a unit test in `test/inputs.test.js` that passes `tls_key_password: 12345` against a generic-fallback input type and asserts the handler returns `isError: true` rather than emitting a number on the wire.

---

### WR-03: `delete_input` extractor pre-flight silently swallows all errors — masks programmer bugs

**File:** `src/tools/inputs/delete-input.js:45-47`
**Issue:**
The pre-flight catch is too broad. The comment ("best-effort: if it 404s or 403s, proceed with an empty cascade list") describes intent, but the implementation catches every `Error` including network failures, programming errors (e.g., a future refactor that breaks `e.id`), and zod issues — all silently mapped to `extractors = []`. The dry-run then proudly shows `cascades: { extractors: [] }`, leading the agent to conclude there are no extractors to cascade-delete.

The threat-model risk: an operator runs `delete_input` against an input that DOES have extractors, but the GET fails for some non-404 reason (e.g., a transient 5xx, a TLS handshake error, a JSON-parse bug). The agent sees `cascades.extractors: []` and applies — Graylog cascade-deletes 17 extractors in the background, and the agent's blueprint state is corrupt.

Also: per the project's own CLAUDE.md convention ("Soft fallback / log-and-continue → `console.error(\"[subsystem] message\")` and move on"), the swallow should at minimum log to stderr so an operator can correlate.

**Fix:**
Narrow the catch to error types the comment promises to tolerate (404 and 403), and stderr-log everything else. Concrete:
```js
try {
    const extractorList = await client.request(
        "GET",
        `/api/system/inputs/${args.inputId}/extractors`,
        null,
    );
    extractors = Array.isArray(extractorList?.extractors)
        ? extractorList.extractors.map((e) => ({
            id: e.id,
            title: e.title,
            extractor_type: e.extractor_type,
        }))
        : [];
} catch (err) {
    if (err?.status === 404 || err?.status === 403) {
        extractors = [];
    } else {
        console.error(
            `[delete_input] extractor pre-flight failed for input ${args.inputId}: ${err?.message ?? err}`
        );
        extractors = [];
        // Optional: surface this to the agent via cascades.extractors_preflight_error
        // so the dry-run is honest about the unknown blast radius.
    }
}
```

Alternative stronger form: when the pre-flight fails with a non-404/403, populate `cascades.extractors_preflight_error: "<message>"` on the descriptor so the agent gets a structural signal that the blast radius is unknown.

---

### WR-04: `update_input` accepts empty-string `title` then silently substitutes `current.title`

**File:** `src/tools/inputs/update-input.js:81` (and `src/tools/inputs/schemas.js:161`)
**Issue:**
The UpdateInputSchema accepts `changes.title: z.string().optional()` with no `.min(1)`. An agent passing `changes: { title: "" }` passes zod validation, and `args.changes.title ?? current.title` evaluates `"" ?? current.title` → `""` (empty string is not nullish). Wait — re-reading: `??` only short-circuits on `null`/`undefined`, so `"" ?? current.title === ""`. The empty title would land in the wire body, and Graylog would reject it with a 400.

So this is not a silent data-loss bug like WR-01 — it's a slightly confusing error path: the agent passes `title: ""`, gets through zod, sees the preview body show `title: ""`, applies, and gets a Graylog 400 error wrapped via `wrapGraylogError`. The agent could be misled into thinking Graylog has a transient issue when in fact it's a client-side validation gap.

The companion: `CreateInputSchema.title` uses `z.string().min(1, "title is required")` (schemas.js:136). UpdateInputSchema does not mirror this guard.

**Fix:**
Add `.min(1)` to `UpdateInputSchema.changes.title`:
```js
changes: z.object({
    title: z.string().min(1, "title cannot be empty").optional(),
    global: z.boolean().optional(),
    node: z.string().optional(),
    configuration: z.record(z.unknown()).optional(),
}).refine(...)
```
Similarly for `UpdateExtractorSchema.changes.title`, `source_field`, `target_field` (schemas.js:340-342) — currently all three accept empty strings.

## Info

### IN-01: `_applyBody` sibling field on RequestDescriptor is undocumented in JSDoc

**File:** `src/tools/_shared/handler.js:40-45` (RequestDescriptor typedef); used in `src/tools/inputs/create-input.js:85`, `src/tools/inputs/update-input.js:114`
**Issue:**
`create_input` and `update_input` extend the RequestDescriptor with an undocumented `_applyBody` field (per-tool, not framework). The apply callback reads `req._applyBody ?? req.body` to ensure the redacted preview body never reaches Graylog. The pattern is correct and the in-file comments explain it well, but the cross-cutting RequestDescriptor JSDoc typedef (handler.js line 40-45) does not mention `_applyBody` as an optional field — making it look like rogue state to anyone reading `handler.js` first.

**Fix:**
Add `_applyBody?: unknown` to the typedef with a one-line "per-tool override read by apply()" comment, OR move the read-this-instead-of-body logic into a normalize-style framework helper (`wireBody?: unknown` keyed at the descriptor level) so the convention is single-sourced.

---

### IN-02: `toIdBody` uses truthy check — falsy IDs (0, empty string) silently become null

**File:** `src/graylog/normalize.js:15`
**Issue:**
```js
for (const field of candidates) {
    if (response[field]) return { id: response[field], body: response };
}
```
`if (response[field])` skips falsy values including `0`, `""`, and `false`. For Graylog IDs in 7.x this is unreachable in practice (all IDs are 24-hex-char ObjectIDs or UUIDs), but if a future endpoint returns a numeric/integer id (e.g., a sequence counter) the check would misclassify `id: 0` as "not present" and return `{ id: null }`.

**Fix:**
Use `if (response[field] !== undefined && response[field] !== null)` for hardening. Carried forward from Phase 0; not a regression.

---

### IN-03: `findExistingMatches` returns `id: null` when no candidate field matches

**File:** `src/tools/_shared/conflict.js:36`
**Issue:**
```js
id: item.id ?? item.input_id ?? item.extractor_id ?? null,
```
If a Graylog list endpoint returns items keyed by some other id field (e.g., `stream_id`, `notification_id`, `pipeline_id`), `findExistingMatches` projects `id: null` for those matches. The agent sees `{ id: null, title: "...", similarity_reason: "..." }` and cannot meaningfully reference the existing match.

**Fix:**
Either (a) widen the fallback chain to include other known Graylog id field names (`stream_id`, `notification_id`, `pipeline_id`, `lookup_id`) as Phase 2+ domains land, or (b) accept an optional `idField` opt in `findExistingMatches` so callers can override per-domain. (b) is more extensible.

---

### IN-04: `getCachedTypeCatalogue` has a benign concurrent-fetch race

**File:** `src/tools/inputs/type-catalogue.js:29-39`
**Issue:**
Two concurrent invocations on the same `connectionName` that both miss the cache will both fire `GET /api/system/inputs/types/all` and both `_cache.set()`. The second `set()` clobbers the first. The data is the same (same catalogue), so the result is correct — but in extreme cases (e.g., a workflow that fires 10 create_input calls in parallel against a cold cache) you get 10 catalogue fetches instead of 1.

**Fix:**
Cache the in-flight promise, not just the resolved value:
```js
const _cache = new Map(); // Map<connectionName, Promise<catalogue> | { catalogue }>

export async function getCachedTypeCatalogue(connectionName, conn) {
    const cached = _cache.get(connectionName);
    if (cached) {
        return cached.catalogue ?? cached; // resolved or in-flight promise
    }
    const client = makeClient(conn);
    const promise = client.request("GET", "/api/system/inputs/types/all", null);
    _cache.set(connectionName, promise);
    try {
        const catalogue = await promise;
        _cache.set(connectionName, { fetchedAt: Date.now(), catalogue });
        return catalogue;
    } catch (err) {
        _cache.delete(connectionName); // don't poison the cache on failure
        throw err;
    }
}
```
The race is genuinely benign today (single-shot blueprint workflows don't fire concurrent create_inputs), so this is Info-level — flag for later.

---

### IN-05: `delete_input` pre-flight bypasses the shared `findExistingMatches` envelope normalization

**File:** `src/tools/inputs/delete-input.js:32-44`
**Issue:**
The pre-flight directly accesses `extractorList?.extractors` rather than going through the `findExistingMatches` envelope-normalization helper (which already handles `response?.extractors ?? response?.inputs ?? ...`). The direct access is correct for the current Graylog 7.0.6 shape, but inconsistent with the abstraction layer the project established in `_shared/conflict.js`. If Graylog ever changes the envelope key (e.g., to `data` or `items`), `findExistingMatches` would adapt automatically while `delete-input.js` would silently return empty.

**Fix:**
Consider extracting an `enumerateChildren({ client, listPath, project, envelopeKey })` helper that delete-input.js can compose through, sharing the same normalization logic as findExistingMatches. Low priority — Graylog's input envelope is stable.

---

### IN-06: `update_extractor.summarize` reports change count via `Object.keys(args.changes).length` — same pattern as `update_input` (minor consistency)

**File:** `src/tools/inputs/update-extractor.js:79`, `src/tools/inputs/update-input.js:118`
**Issue:**
Both summarize callbacks count keys directly. Today there is no risk because the per-domain schemas don't apply defaults to optional fields. If a future maintainer adds `.default()` to any field inside `changes`, the count will overcount (zod's parsed args include the defaulted values). This is a "preserved knowledge" risk — easy to violate without realizing.

**Fix:**
Either (a) snapshot the agent-supplied change keys before zod parse (since zod's default `strip` doesn't drop them but `.default()` adds them), or (b) add a one-line comment in both files noting "do not add `.default()` to fields inside `changes` — it would skew the change count." (b) is cheap.

---

### IN-07: `update_input.build()` exempts `current.global === false` from being echoed if agent doesn't pass it; OK, but worth a comment

**File:** `src/tools/inputs/update-input.js:82`
**Issue:**
`global: args.changes.global ?? current.global` — when `current.global === false` and agent doesn't pass `changes.global`, the wire body emits `global: false`. This is correct per the Graylog requirement that `global` must be on every PUT. No bug.

The reason this is Info-worthy: the analogous WR-01 logic for `node` IS wrong (Graylog does not require `node` on PUT), and the file's current comment ("Top-level envelope fields ... are merged") describes both correctly-merged and incorrectly-merged fields uniformly. Adding a one-line distinction would prevent future maintainers from generalizing the wrong pattern across other top-level fields.

**Fix:**
Pair with WR-01: when `node` is fixed, update the file header comment to distinguish Graylog-REQUIRED top-level fields (`type`, `title`, `global` — merged from current as a fallback to satisfy the API contract) from Graylog-OPTIONAL top-level fields (`node` — echoed ONLY when agent provides it, mirroring D-03 for the envelope).

---

_Reviewed: 2026-05-15T11:51:04Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
