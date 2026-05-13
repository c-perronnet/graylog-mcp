# Technology Stack — Admin Surface Milestone

**Project:** Graylog MCP — Full Admin Surface
**Researched:** 2026-05-13
**Mode:** Ecosystem (subsequent milestone — stack additions only)
**Overall confidence:** HIGH (existing stack), MEDIUM (version pins — registry lookups blocked in sandbox; pinning to currently-installed minor and the next conservative bump)

## Scope of This Document

This milestone **extends** the v2.3 codebase rather than rewriting it. Existing dependencies (`@modelcontextprotocol/sdk` ^1.18.0, `axios` ^1.12.2, `zod` ^3.25.76 — declared but unused, `typescript` ^5.9.2 devDep) are documented in `.planning/codebase/STACK.md` and are NOT re-litigated here.

This file answers a single question: **what additional libraries, validation tooling, DSL helpers, and patterns does the admin extension need on top of the existing stack?**

The bias is "add as little as possible." Each ADD must clear a bar: the existing stack genuinely cannot do this, and the cost of hand-rolling exceeds the cost of one more dependency.

## Recommended Stack Additions

### Core (Required)

| Technology | Version | Purpose | Why ADD |
|------------|---------|---------|---------|
| `zod` | already declared `^3.25.76` — **adopt, do not upgrade** | Schema validation for ~50 nested admin payloads | Already in `package.json`. Concerns doc flags it as dead-code-pending-adoption. Admin endpoints (stream rules, pipeline connections, index-set retention configs, event-definition filters) take deeply nested objects where ad-hoc `if (!args.x)` checks scale poorly. Adopting the existing dep is a no-cost win. |

### Dev / Test (Required)

| Technology | Version | Purpose | Why ADD |
|------------|---------|---------|---------|
| `node:test` | built-in (Node ≥18, stable since 20) | Test runner for admin tool handlers + dry-run snapshot tests | Zero new dep. Built-in. Has `--test-name-pattern`, `--test-only`, sub-tests, and crucially `t.snapshot()` (stable in Node 22, behind `--experimental-test-snapshots` in 20). Aligns with the codebase's `node:assert/strict` posture — same import surface, no Jest/Vitest globals to learn. |
| `c8` | `^10.1.3` | Coverage reporting via V8 inspector | Optional but recommended given the testing-gap risk surface in `CONCERNS.md`. Works with `node --test` out of the box (`c8 node --test`). No transformation, no source-map fragility. |

### Not Adopted (Explicitly Rejected — See Alternatives)

`form-data`, `node-fetch`, `vitest`, `typebox`, `ajv` (top-level), `yup`, `nearley`, `chevrotain`, `lodash.template`, `mustache`, `peggy`.

Rationale for each is documented in **Alternatives Considered** below — each was a live candidate that was investigated and rejected on a specific cost/benefit ground.

## Decisions Against the Five Question Areas

These are the prescriptive answers the roadmap will operationalize.

### 1. Dry-Run Pattern — **Hand-roll. No library.**

**Decision:** Hand-roll a single internal helper (`runOrPreview(operation, { dryRun })`). No library.

**Why no library:**

There is no Node ecosystem winner for "preview-then-apply" as a generic pattern. Cloud SDKs (`@aws-sdk/*`, Pulumi, Terraform CDK) model dry-run, but they pull in 50+ MB of infrastructure plumbing and presume CloudFormation/state-file semantics that don't apply to direct REST calls. `nock` and `msw` are *test* doubles, not production dry-run primitives. The closest in-spirit prior art (`got`'s hooks, `axios.interceptors`) helps shape requests but doesn't model the preview/confirm-token round trip.

**Shape (informs ARCHITECTURE.md):**

```js
async function runOrPreview({ method, url, body, headers }, { dryRun, confirmationToken }) {
    if (dryRun !== false) {
        // dryRun true (default) OR explicitly true
        return {
            content: [{ type: "text", text: JSON.stringify({
                preview: true,
                request: { method, url, body, headers: redactAuth(headers) },
                confirmationToken: hashRequest({ method, url, body }),
                hint: "Re-call with dryRun: false to apply"
            }, null, 2) }]
        };
    }
    // Apply path — every mutating axios call routes through here
    return await axios({ method, url, data: body, headers });
}
```

The token is just a hash of `(method, url, canonical(body))`. The agent does not need to round-trip it — Graylog won't see it — but logging it gives the user a way to verify "the apply I just did matches the preview I just inspected." That's the only contract.

**Confidence:** HIGH that no library improves on hand-roll. Pattern is small (≤80 lines), domain-specific, and gets to live alongside the axios call site where redaction concerns are local.

### 2. Validation — **Zod ^3.25.76. Do not upgrade to v4. Do not switch tools.**

**Decision:** Adopt the existing `zod ^3.25.76` declared in `package.json`. Build a `src/schemas/<domain>.js` module per admin domain (streams, pipelines, dashboards, inputs, indices, events).

**Why zod, not the alternatives:**

| Candidate | Why rejected |
|-----------|--------------|
| `typebox` | Faster runtime (compiles to AJV). But it forces a JSON-Schema-first authoring style that diverges from how the rest of the project shapes data. The speed win does not matter for ~50 admin calls/session — these are bound by Graylog round-trip latency, not validation CPU. The cost is dragging a new dep and a different mental model into a codebase that already has zod sitting unused. |
| `yup` | Older API, weaker TypeScript story, no active advantage. |
| `ajv` (top-level) | Already a transitive dep via the MCP SDK. Pure JSON Schema. Works fine but the schemas-as-data approach is less ergonomic than zod's combinator style for the nested Graylog payloads (stream rules with discriminated `type` fields, pipeline-rule conditions, retention strategies with strategy-type-dependent config blobs). Discriminated unions are zod's strongest case. |
| `valibot` | Smaller bundle. Bundle size is irrelevant for a Node CLI MCP server. No win. |

**Why ^3.25.76 specifically, not zod v4:**

Zod v4 is released and is a meaningful rewrite (`zod/v4` import path, faster, better discriminated unions). However:
- The package is already declared at `^3.25.76`. Adopting (not upgrading) is the no-risk path.
- v4 introduces breaking changes to `.refine`, error formatting, and some object methods. With zero existing zod usage in `src/`, the migration cost is technically zero — but the **review-and-validation** cost of "did we shake any bugs out of `axios` or the MCP SDK that pin zod internally?" is non-zero.
- The MCP SDK itself depends on zod (transitively). Locking to the same major it ships with avoids dual-major-in-tree risk.

**Action:** If the MCP SDK's zod peer ever bumps to v4, re-evaluate. Until then, ^3.25.76 minor-floor.

**Pin guidance:** Keep the existing `^3.25.76`. Do NOT bump to v4. Do NOT remove and re-add.

**Confidence:** HIGH. Zod is the right tool, the dep is already there, and the pinning rationale is concrete.

### 3. Pipeline-Rule DSL — **Hand-build with tagged template literals + a hand-written validator. No parser library.**

**Decision:** Provide three layers in `src/pipeline-dsl/`:

1. **Builder helpers** — tagged-template wrappers like `whenClause`, `thenBlock`, `callFunction`, `setField` that produce raw DSL strings with correctly escaped string literals. (Addresses the same query-string-escaping concern called out in `CONCERNS.md` for `buildQueryString`.)
2. **Lexer + structural validator** — hand-written, ~200 lines. Tokenizes `when … then …`, validates balanced parens, validates that each `then` line is a function call or assignment, validates that referenced function names are in a known-good registry derived from reading Graylog's built-in `pipelineprocessor/functions/` Java sources.
3. **Round-trip check** — before applying (not in dry-run preview), the tool can optionally POST the DSL to Graylog's `/api/system/pipelines/rule/parse` endpoint, which returns the parsed AST or syntax errors without persisting. This is the same hook Graylog's own web UI uses.

**Why no library:**

| Candidate | Why rejected |
|-----------|--------------|
| `nearley` / `peggy` | Real parser generators. Would correctly model the Graylog DSL grammar. But: (a) the grammar is small and stable in v7.2 (single target), (b) we don't need to *consume* DSL — we need to *generate* it, where the agent already has the grammar in context, and (c) bringing in a parser generator means a build step (`.ne` → `.js`), which the codebase intentionally does not have. |
| `chevrotain` | Same family of objections, larger surface, even less appropriate for "validate-only" use. |
| `lodash.template` / `mustache` / `handlebars` | Wrong shape entirely. These solve "interpolate user data into a template string" — they don't help with grammar-aware composition or escaping for DSL contexts. |

**Why the round-trip-to-Graylog parse endpoint is the safety net:**

Graylog 7.2 exposes `POST /api/system/pipelines/rule/parse` and `POST /api/system/pipelines/rule/parse_expression` (verify in `source-code/graylog2-server/.../rest/resources/PipelineConnectionsResource.java` and adjacent `RuleResource.java`). These are designed for the web UI's syntax-check feature. Reusing them gives us free, server-authoritative validation that *cannot drift from* the Graylog version we're targeting — which is exactly the brittleness the existing histogram-fallback-chain demonstrates the codebase wants to avoid.

The hand-written validator is the **first** pass (fast, offline, runs in `dryRun`). The server parse endpoint is the **second** pass (gates apply, runs only on `dryRun: false`).

**Confidence:** HIGH on the no-parser-library decision. MEDIUM on the parse-endpoint path until the researcher reading the Java REST resources confirms the route name; the resource file location is established (`pipelineprocessor/rest/`).

### 4. HTTP Client — **Stay on axios ^1.12.2. No additions.**

**Decision:** Keep axios. Do not add `got`, `undici`, `node-fetch`, or `form-data`.

**Why axios is still fine for admin endpoints:**

- **Multipart upload for inputs:** Graylog's input creation is `POST /api/system/inputs` with a JSON body (`type`, `title`, `configuration` object, `global`, `node`). There is no multipart upload anywhere in the input creation path in v7.2. Content packs import (which IS multipart) is explicitly **out of scope** for this milestone per `PROJECT.md`. So the multipart concern is moot.
- **Long-running operations (index rotation, reindex):** Graylog's `/api/system/indices/index_sets/{id}/rotate_index` and `/api/system/indexer/cluster/health` are synchronous-return endpoints that kick off async server-side work and return immediately (typically 200 with an op-id or 204). They do not require streaming, SSE, or long-poll on the client. Axios's default 0-timeout (none) covers them; we'll set a generous per-call timeout (60s) and surface Graylog's progress through follow-up read calls, not through HTTP keep-alive.
- **Connection pooling:** Axios uses Node's built-in `http.Agent`. For ~50 admin calls/session this is irrelevant; even at 500 calls/session a default agent is fine.
- **The `X-Requested-By` header pattern is already baked in** at `src/query.js:104`. Reusing the existing axios setup means the CSRF header story stays consistent.

**Why not switch:**

- `undici` (Node's bundled fetch backend) is faster and tree-shakes better, but the existing codebase has a working axios call site with auth, headers, and error handling already battle-tested. Migrating is pure cost.
- `got` has nicer hooks but no admin-specific feature that axios lacks.
- `node-fetch` is redundant in Node 18+ (built-in `fetch` exists) and offers nothing axios doesn't.

**What to ADD on the axios usage layer (not a new dep):** a thin `mutateGraylog(conn, { method, path, body })` helper alongside the existing `searchGraylog`, with:
- Centralized `runOrPreview` integration (see #1)
- Centralized auth header construction (the existing `X-Requested-By` + Basic auth)
- Centralized error-shape conversion (Graylog 403 → MCP isError with hint about API token role)

**Confidence:** HIGH that axios is correct here, MEDIUM on the in-scope endpoint shapes pending the researcher reading the Java resources to verify no multipart endpoints sneak into "Input CRUD".

### 5. Testing Posture — **Adopt `node:test` runner. Drop the standalone-scripts pattern for new admin tools. Use snapshot testing for dry-run previews.**

**Decision:** This is the testing-posture decision the quality gate flagged as outsized. The recommendation is:

- **Stop** writing `test-*.js` standalone scripts at repo root for new admin handlers.
- **Adopt** `node --test test/**/*.test.js` as the canonical command.
- **Fix** `npm test` (currently broken — references non-existent `test-server.js`) to invoke `node --test`.
- **Use** `t.snapshot()` (stable in Node 22, available behind `--experimental-test-snapshots` in Node 20) for dry-run preview tests. The preview output is **the test surface** for mutating tools — a snapshot per tool × payload-shape locks in the contract.
- **Migrate** the four existing root-level test scripts to `test/legacy/*.test.js` only opportunistically (not as part of this milestone — out of scope).

**Why this is defensible against "just keep the standalone-script pattern":**

The standalone-script pattern works at 4 scripts. At 50+ admin tools, each needing:
- Happy-path test
- Dry-run preview snapshot test
- Validation-failure test (zod rejection)
- Auth-failure test (Graylog 403 mock)

...that's 200+ tests. A runner gives:
- Test isolation (one failure doesn't halt the run)
- Sub-test grouping (`t.test("dry-run", ...)`)
- Filter + watch flags
- Reporter pluggability (TAP, spec, dot)
- Built-in snapshot diffing

The standalone scripts have none of these. The migration cost is one-time. The ongoing maintenance cost of writing 50+ admin tests in the legacy style — without isolation, without filtering, without snapshots — exceeds the migration cost by week two.

**Why `node:test`, not `vitest`:**

| Vitest pro | Counter |
|------------|---------|
| Faster watch mode | `node --test --watch` is now in Node 22 (verify exact flag in current docs). Functionally equivalent for this project's scale. |
| Built-in coverage UI | `c8` produces lcov + text reports; HTML is fine for local browsing. No need for the UI. |
| Vi globals (`vi.mock`) | The codebase already uses explicit `_*ForTests` injection hooks (see `CONVENTIONS.md`). Mocking via dep-injection seams is *better* than module-mocking magic. Vitest's mocking story is a feature the project doesn't want. |
| Snapshot testing | `node:test` has `t.snapshot()`. Comparable for our needs (JSON-stringify of dry-run payloads). |
| TypeScript support | Codebase is JS-only at runtime; this is a non-feature. |

The decisive factor: **vitest is a 9 MB dep tree.** `node:test` is 0 bytes. Given the codebase's no-build-step + minimal-deps discipline, `node:test` is on-brand.

**Snapshot testing for dry-run previews — the concrete pattern:**

```js
// test/streams/create-stream.test.js
import { test } from "node:test";
import { handleCreateStream } from "../../src/tools/streams/create.js";

test("create_stream dry-run produces expected request", async (t) => {
    const result = await handleCreateStream({
        params: { arguments: {
            title: "App errors", description: "errors only",
            rules: [{ field: "level", type: "less", value: 4 }]
        }},
        _testConnection: { baseUrl: "http://test", apiToken: "x" }
    });
    t.assert.snapshot(JSON.parse(result.content[0].text));
});
```

The snapshot file (`test/streams/create-stream.test.js.snapshot`) becomes the human-reviewable record of "this is exactly what we POST to Graylog." Diffs in PRs are immediately legible.

**Confidence:** HIGH. The decision is unambiguous: runner-based, snapshot-driven, no new test framework.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Validation | `zod` ^3.25.76 (adopt existing) | `typebox` | Faster but forces JSON-Schema-first; zod already declared; speed irrelevant for ~50 calls bounded by network latency |
| Validation | `zod` ^3.25.76 | `zod` v4 | Real major bump; risk vs reward favors v3 until MCP SDK bumps its peer; near-zero migration value when usage starts at zero |
| Validation | `zod` ^3.25.76 | `yup` | Older, weaker TS, no advantage |
| Validation | `zod` ^3.25.76 | `valibot` | Bundle-size win doesn't apply to Node CLI |
| Validation | `zod` ^3.25.76 | `ajv` top-level | Less ergonomic for discriminated unions; already transitive |
| HTTP | `axios` ^1.12.2 (keep) | `got` | Nicer hooks, no admin-specific advantage |
| HTTP | `axios` ^1.12.2 | `undici` / built-in `fetch` | Faster, but migration cost vs working axios setup is pure cost |
| HTTP | `axios` ^1.12.2 | `node-fetch` | Redundant in Node 18+ |
| DSL gen | Hand-roll | `nearley` / `peggy` | Parser generators require a build step; we generate not consume |
| DSL gen | Hand-roll | `chevrotain` | Same; bigger surface area |
| DSL gen | Hand-roll | `lodash.template` / `mustache` | Wrong shape — interpolation, not grammar-aware composition |
| Test runner | `node:test` | `vitest` | 9 MB dep tree vs 0; module-mocking philosophy clashes with existing `_*ForTests` seams |
| Test runner | `node:test` | `jest` | Bigger, slower, ESM story has historically been rough |
| Test runner | `node:test` | continue standalone scripts | Does not scale to 50 admin tools × 4 test shapes each |
| Coverage | `c8` ^10.1.3 | `nyc` | Older, slower, Babel-transform story not needed |
| Dry-run | Hand-roll `runOrPreview` | Cloud SDK dry-run patterns | Vastly over-scoped |
| Dry-run | Hand-roll | `nock`/`msw` | Wrong layer — these are test doubles, not production preview primitives |

## Installation

```bash
# No production dep additions — zod is already in package.json
# Just adopt the existing dep in src/

# Dev additions
npm install -D c8@^10.1.3

# Fix the broken test script in package.json:
# "test": "node --test --test-reporter=spec test/**/*.test.js"
# (replace the current "node test-server.js" which references a missing file)
```

**Node version implication:** `t.snapshot()` is stable in Node 22. The current `engines.node >= 18` should be revisited — `>= 20.6.0` is needed for `--experimental-test-snapshots`; `>= 22.3.0` for stable snapshots. **Recommendation:** bump `engines.node` to `>= 20.6.0` and either pass `--experimental-test-snapshots` or wait to ship snapshot tests until users on Node 22 are the floor.

A conservative middle-ground that keeps `>= 18` is to defer snapshot tests to a Node-22-only optional test layer; but for a CLI MCP server with one author and known users, bumping to `>= 20.6.0` is the simpler call.

## Versions Pin Summary

| Package | Version | Status | Action |
|---------|---------|--------|--------|
| `@modelcontextprotocol/sdk` | `^1.18.0` | existing | keep |
| `axios` | `^1.12.2` | existing | keep |
| `zod` | `^3.25.76` | existing, **unused** | **adopt** — do not upgrade to v4 |
| `@types/node` | `^20.19.15` | existing devDep | bump to `^22.x` if engines.node bumps |
| `typescript` | `^5.9.2` | existing devDep, unused for runtime | keep (or remove — orthogonal to this milestone) |
| `c8` | `^10.1.3` | **NEW** devDep | add |
| `node:test` | built-in | **NEW** runtime | adopt |

**Confidence on version numbers:** MEDIUM. The npm registry lookup tools were unavailable in this sandbox. Pins reflect (a) the versions already declared in `package.json` (HIGH confidence — read from disk) and (b) for `c8`, the current major's recent release line per training data (MEDIUM — verify via `npm view c8 version` at install time and adjust to whatever current ^10.x exists).

## Sources

- `package.json` (verified by reading on 2026-05-13) — current pinned versions
- `.planning/codebase/STACK.md` — existing stack baseline
- `.planning/codebase/CONCERNS.md` — "zod declared but unused" debt, `npm test` broken script, no-input-validation risk surface
- `.planning/codebase/CONVENTIONS.md` — `_*ForTests` dependency-injection seam pattern; `node:assert/strict` precedent; named-exports-only; ESM with `.js` extensions
- `.planning/codebase/ARCHITECTURE.md` — `requireActiveConnection` idiom; per-domain handler extraction precedent (`src/tools/cluster-errors.js`, `src/tools/template-mgmt.js`)
- `.planning/PROJECT.md` — dry-run-default invariant, single Graylog 7.2 target, blueprints vs CRUD split, pipeline-DSL "agent emits, helpers validate" decision
- Graylog server source (referenced for downstream verification): `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/plugins/pipelineprocessor/rest/RuleResource.java` and adjacent — to verify the `/api/system/pipelines/rule/parse` endpoint exists in v7.2 before adoption

Confidence levels:
- HIGH: existing dep facts, decision rationale (dry-run, zod adoption, no DSL parser, axios retention, runner-vs-scripts)
- MEDIUM: exact version pins for new deps, snapshot-API stability flag in Node 20 vs 22, exact Graylog parse-endpoint route name
- LOW: none in this document
