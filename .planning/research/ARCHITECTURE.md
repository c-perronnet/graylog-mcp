# Architecture Patterns

**Domain:** Node MCP server admin extension — Graylog 7.2 write/configure surface
**Researched:** 2026-05-13
**Scope:** ~50 new mutating tools across 6 admin domains (streams, pipelines, dashboards, inputs, indices, events) plus blueprints
**Overall confidence:** HIGH (architectural recommendations are derived from in-tree precedent and concrete file evidence; no speculative library claims)

---

## Recommended Architecture

```
src/
├── index.js                       # Entry + transport wiring only (target: shrink toward ~200 lines)
├── tools.js                       # Existing read-side definitions
│
├── dispatch.js                    # NEW: Map<toolName, handler> registry + dispatch
│
├── graylog/                       # NEW: HTTP client layer (one client, many endpoints)
│   ├── client.js                  #   graylogClient.request(method, path, body, { conn })
│   ├── auth.js                    #   Basic-auth header builder (token-as-username pattern)
│   └── errors.js                  #   Map 4xx/5xx → structured error objects
│
├── services/                      # NEW: Pure Graylog domain operations (no MCP coupling)
│   ├── streams.js                 #   createStream/listStreams/.../attachRule/...
│   ├── pipelines.js
│   ├── pipeline-rules.js
│   ├── dashboards.js
│   ├── inputs.js
│   ├── extractors.js
│   ├── indices.js
│   ├── event-definitions.js
│   └── event-notifications.js
│
├── tools/                         # MCP-facing handlers (1 file = 1 tool, grouped by domain)
│   ├── cluster-errors.js          # existing
│   ├── template-mgmt.js           # existing
│   ├── _shared/                   # NEW: cross-cutting handler helpers
│   │   ├── handler.js             #   defineHandler({ schema, dryRun, run })
│   │   ├── dry-run.js             #   withDryRun() wrapper
│   │   ├── connection.js          #   resolveConnection(args) — DRY across handlers
│   │   └── errors.js              #   errorResponse(text), wrapGraylogError(err)
│   ├── streams/
│   │   ├── index.js               #   re-exports for dispatch registration
│   │   ├── schemas.js             #   zod schemas for stream tools
│   │   ├── create.js              #   handleCreateStream
│   │   ├── list.js
│   │   ├── get.js
│   │   ├── update.js
│   │   ├── delete.js
│   │   ├── attach-rule.js
│   │   └── detach-rule.js
│   ├── pipelines/                 # same shape
│   ├── pipeline-rules/            # same shape
│   ├── dashboards/                # same shape
│   ├── inputs/                    # same shape
│   ├── extractors/                # same shape
│   ├── indices/                   # same shape
│   ├── event-definitions/         # same shape (CRUD upgrade from read-only)
│   ├── event-notifications/       # same shape
│   └── blueprints/
│       ├── index.js
│       ├── schemas.js
│       ├── setup-error-stream-for-app.js
│       ├── create-app-health-dashboard.js
│       └── ...
│
├── pipeline-dsl/                  # NEW: rule-language helpers (own subsystem, owned by pipeline-rules domain)
│   ├── index.js                   #   emit() — intent → DSL string
│   ├── grammar.js                 #   client-side parser/lexer for when…then…
│   ├── escape.js                  #   string-literal escaping (the missing-escape problem from buildQueryString)
│   ├── builtins.js                #   curated catalogue of known Graylog built-in functions
│   └── validate.js                #   parens, unknown-function lint, type checks
│
└── (existing modules unchanged: config.js, query.js, timerange.js,
   aggregations.js, saved-searches.js, events.js, clustering/)
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `src/index.js` | MCP transport, server lifecycle, single registration of dispatch | `dispatch.js` |
| `src/dispatch.js` | `Map<string, handler>` registration + lookup; throws unknown-tool | All `tools/**/*.js` |
| `src/tools/<domain>/*.js` | MCP-layer concerns: arg shape, dry-run, response formatting | `services/<domain>.js`, `_shared/*` |
| `src/tools/_shared/handler.js` | `defineHandler` factory: validation, conn resolve, dry-run, error wrap | All handler files |
| `src/services/<domain>.js` | Graylog domain operations as pure functions: `(client, payload) → result` | `graylog/client.js` |
| `src/graylog/client.js` | Single axios-based HTTP client; method/path/body in, parsed JSON out | `graylog/auth.js`, `graylog/errors.js` |
| `src/pipeline-dsl/*` | Generate + validate Graylog rule DSL client-side before round-trip | Used by `services/pipeline-rules.js` and `tools/pipeline-rules/*` |

### Data Flow

**Typical mutating tool flow:**

```
1. MCP Client → call_tool { name: "create_stream", arguments: {..., dryRun: true } }
2. index.js → dispatch.js → lookup handler in Map
3. handler (tools/streams/create.js)
   ├─ defineHandler wrapper runs:
   │   ├─ zod validation (schemas.js)        — invalid → isError, no Graylog call
   │   ├─ resolveConnection(args)            — no conn → isError
   │   ├─ build Graylog request via service  — services/streams.js::buildCreateStreamRequest()
   │   ├─ if dryRun: return preview payload + confirmation token (NO HTTP call)
   │   └─ else: services/streams.js::createStream(client, payload)
4. services/streams.js → graylog/client.js::request("POST", "/api/streams", body)
5. graylog/client.js → axios → Graylog
6. handler shapes response → { content: [{ type: "text", text: JSON.stringify(...) }] }
```

The split is: handlers handle **MCP-shape and safety**; services handle **Graylog-shape and HTTP**; the client handles **transport**. Each layer is unit-testable without the layer below.

---

## Answers to the Nine Architectural Questions

### 1. Per-Domain Module Layout — **Nested directory per domain, one file per tool**

**Recommendation:** `src/tools/<domain>/<verb>.js`, with `index.js` re-exporting and `schemas.js` co-located.

**Why over flat:**
- Flat (`src/tools/streams.js`) repeats the `src/index.js` problem at smaller scale: 6 files × 5–10 tools each = 30–60 handlers per file. At ~120 LOC per non-trivial mutating handler (validation + dry-run + service call + response shaping), a flat `streams.js` lands ~700–1000 LOC — exactly the bloat we're escaping.
- Existing precedent (`src/tools/cluster-errors.js` at 174 lines for one logical tool; `src/tools/template-mgmt.js` at 120 lines for five small CRUD tools) shows that **one tool per file is fine when tools are non-trivial**, and **grouping by domain in one file is fine when tools are tiny**. Mutating admin tools have dry-run preview + zod schema + apply branch — they will not stay tiny.
- Nested gives a stable navigation address (`tools/streams/create.js`) that maps 1:1 to a Graylog REST endpoint, which is how researchers will reason about coverage.

**Hybrid `index.js`** re-exports the named handlers so `dispatch.js` registers from one import per domain — keeps the registration site terse.

**Justification against precedent:** This is a **scaling extension** of the `src/tools/<feature>.js` precedent, not a departure. `cluster-errors.js` is one logical tool; admin domains are 5–10 tools each. The same "extract when it crosses ~80 lines or has private helpers" rule (STRUCTURE.md:94) applied per tool gives per-tool files.

---

### 2. Dispatch Chain — **`Map<toolName, handler>` table, populated from per-domain index re-exports. Preliminary refactor phase.**

**Recommendation:** Replace the `if (name === "...")` chain in `src/index.js:38-104` with:

```js
// src/dispatch.js
const handlers = new Map();
export function register(name, handler) { handlers.set(name, handler); }
export function dispatch(request) {
    const fn = handlers.get(request.params.name);
    if (!fn) throw new Error(`Tool not found: ${request.params.name}`);
    return fn(request);
}

// Domain modules self-register on import:
// src/tools/streams/index.js
import * as create from "./create.js";
import { register } from "../../dispatch.js";
register("create_stream", create.handleCreateStream);
register("list_streams", list.handleListStreams);
// ...
```

**Why over alternatives:**
- **Per-domain sub-tables that federate:** more layering, no real benefit — the Map *is* a flat dispatch and a Map of Maps just hides lookups behind a name resolution step.
- **Auto-derive from tool definitions in `src/tools.js`:** tempting, but it requires every tool definition to *also* export its handler reference, which forces the schema layer to know about handler identity. Cleaner separation is: tool definitions in `src/tools.js` describe the wire shape; dispatch registry names the handlers; they meet at the tool name string. The existing "no compile-time check that names match" hazard (CONCERNS.md:83) is **mitigated** by adding a startup assert in `index.js` that every name in `toolDefinitions` exists in the dispatch Map — a single 5-line check.

**Phase placement: preliminary refactor (Phase 0).** Reasons:
- Adding the first domain's ~7 tools to the existing if-chain stretches it to ~110+ branches and locks in the same pain.
- The refactor is mechanical and small (replace 60 lines in `index.js` with one call; extract a `dispatch.js`). Doing it before the first domain phase keeps every subsequent phase's diff focused on the domain, not on dispatcher housekeeping.
- The mismatch-check assert pays back immediately: it catches every "added to tools.js, forgot to register" mistake at server boot, which will happen often with 50 new tools.

**Files to register existing read-side tools too** — keeps a single registration mechanism. Phase 0 also moves the existing `if (name === ...)` branches to `register("fetch_graylog_messages", fetchGraylogMessages)` etc. Read tools stay in `index.js` (no behavior change — per PROJECT.md constraint "existing v2.3 tool contracts unchanged").

---

### 3. Dry-Run Primitive — **Shared `withDryRun(handler)` wrapper combined with a "request object first" service shape**

**Recommendation:** Two complementary mechanisms.

**(a) Services return a request descriptor; handlers decide what to do with it.**

```js
// src/services/streams.js
export function buildCreateStreamRequest(args) {
    return {
        method: "POST",
        path: "/api/streams",
        body: { title: args.title, description: args.description, /* ... */ },
        summary: `Create stream "${args.title}" with ${args.rules?.length ?? 0} rules`,
    };
}

export async function createStream(client, args) {
    const req = buildCreateStreamRequest(args);
    return client.request(req.method, req.path, req.body);
}
```

**(b) `defineHandler` factory wraps every mutating handler.**

```js
// src/tools/_shared/handler.js
export function defineMutatingHandler({ name, schema, build, apply, summarize }) {
    return async function handler(request) {
        const args = schema.parse(request.params.arguments ?? {});
        const { conn, error } = resolveConnection(args);
        if (error) return error;

        const dryRun = args.dryRun ?? true;  // default-true is enforced here, once
        const req = build(args);

        if (dryRun) {
            return textResponse({
                dryRun: true,
                summary: summarize(args, req),
                preview: { method: req.method, path: req.path, body: req.body },
                applyHint: `Re-call with dryRun: false to apply`,
                confirmationToken: hashRequest(req),  // optional: stable hash for clients to bind preview→apply
            });
        }
        const result = await apply(conn, req);
        return textResponse({ dryRun: false, applied: true, result });
    };
}
```

**Why this combination over the alternatives:**
- **Manual `args.dryRun ?? true` per handler:** Default-true *must* be applied identically in 50+ handlers. One typo (`?? false` or omitted check) is a silent data-loss bug. Centralizing it in the wrapper makes "applying without explicit `dryRun: false`" structurally impossible — matches the PROJECT.md constraint as written ("Applying without an explicit `dryRun: false` is a bug").
- **Wrapper-only without request-object split:** Wrapper alone forces every handler to compose the Graylog request inline, then duplicate the call site (one branch builds + returns preview, the other branch builds + applies). Splitting into `build()` (pure) + `apply()` (effectful) means the dry-run path uses the same payload the apply path would, by construction — preview and apply cannot drift.
- **Request-object split without wrapper:** Possible, but every handler still has to remember to honour `dryRun: true` default. The wrapper is what enforces the default.

**Justification against precedent:** This is genuinely new — existing read-side tools have no dry-run. But it slots cleanly into the existing handler shape (CONVENTIONS.md:70-88): `defineMutatingHandler` produces the same `async (request) => { content: [...] }` signature, just constructed by a factory instead of written by hand. Existing read handlers don't change.

---

### 4. Validation Layer — **Per-domain `schemas.js`, applied inside `defineHandler` before any other handler logic**

**Recommendation:** `src/tools/<domain>/schemas.js` holds all zod schemas for that domain; handlers import named exports.

```js
// src/tools/streams/schemas.js
import { z } from "zod";

export const StreamRuleSchema = z.object({
    field: z.string().min(1),
    type: z.enum(["EXACT", "REGEX", "GREATER", "SMALLER", "PRESENCE"]),
    value: z.union([z.string(), z.number()]),
    inverted: z.boolean().default(false),
});

export const CreateStreamSchema = z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    indexSetId: z.string().min(1),
    matchingType: z.enum(["AND", "OR"]).default("AND"),
    rules: z.array(StreamRuleSchema).default([]),
    dryRun: z.boolean().default(true),
});
```

**Why co-located `schemas.js` per domain (not per-file):**
- Schemas reference each other within a domain (e.g. `CreateStreamSchema` and `UpdateStreamSchema` both embed `StreamRuleSchema`). Co-locating prevents an explosion of cross-file imports.
- Cross-domain schema sharing is rare; when it happens (e.g. a `ConnectionRef` schema), promote to `src/tools/_shared/schemas.js`.
- Tool definitions in `src/tools.js` already declare JSON-Schema for MCP clients (CONVENTIONS.md:50). We **keep** those (the MCP SDK uses them client-side) and use zod server-side as the actual enforcement. They are derived from the same intent but live separately because the JSON-Schema is wire spec, zod is runtime validation. A long-term cleanup is `zod-to-json-schema`, but this milestone does **not** require it — start with hand-kept parity.

**Slot-in point:** `schema.parse(args)` is the first non-trivial line inside `defineMutatingHandler` (see Q3). Failure throws `ZodError`; an outer try/catch in the factory maps it to `errorResponse(formatZodError(err))`. This adopts the long-declared zod dependency (CONCERNS.md:17) at the natural moment.

**Justification against precedent:** Existing handlers do ad-hoc `if (!args.foo) return errorResponse(...)`. zod replaces those checks. Existing read tools are not changed (per PROJECT.md "no refactors as part of this milestone"). Only new mutating handlers use zod.

---

### 5. Pipeline Rule DSL Generation Module — **`src/pipeline-dsl/`, with a hand-curated builtins catalogue (auto-regen as a future improvement)**

**Recommendation:** Top-level `src/pipeline-dsl/` (not nested under `src/tools/`). Concrete file layout:

```
src/pipeline-dsl/
├── index.js          # public surface: emit(intent), validate(source), lint(source)
├── grammar.js        # tokenizer + parser for when…then… (does not need to be full PEG; recursive descent is enough)
├── escape.js         # string-literal escaping for emitted DSL — addresses CONCERNS.md "no query escaping" recurrence risk
├── builtins.js       # const FUNCTIONS = { has_field: { args: [...], returns: "bool" }, ... }
└── validate.js       # checks: balanced parens, known function names, arg-count match, unescaped quotes
```

**Why top-level (not under `src/tools/pipeline-rules/`):**
- DSL helpers are used **by services and tools**: services (when building rule-create payloads) and tools (when offering an "emit DSL from intent" tool the agent calls). Both layers need it; placing it under `tools/` would force `services/` to import from `tools/` (wrong direction).
- It's a peer subsystem like `src/clustering/`, which is the closest precedent — a self-contained algorithmic concern with multiple consumers.

**Builtins catalogue: hand-curated this milestone, with a generator as future work.**

- **Source of truth:** `source-code/graylog2-server/.../plugin/pipelineprocessor/functions/` Java classes. Each `Function<T>` subclass declares its name, parameter list, and return type.
- **Why hand-curated first:** Auto-generation from Java source needs either (a) running Graylog's own reflection-based function registration (heavy — requires Graylog runtime), or (b) parsing Java source files (brittle — annotation positions vary across versions). Hand-curation for ~80–120 built-ins (per the source tree's `functions/` directory size) is tractable as a one-time scrape; the result is a static `const FUNCTIONS = {...}` JS object with version-pinned-to-7.2 contents.
- **Maintenance path:** A `scripts/regenerate-builtins.js` that reads the local Java source and emits `builtins.js` is a future-work item — explicitly flagged as out of scope for this milestone but cheap to add later. The hand-curated table includes a header comment `// regenerate with scripts/regenerate-builtins.js when implemented`.
- **Confidence calibration:** Hand-curated lists drift. Mitigation: every PR that touches `builtins.js` should reference the Java class it mirrors; mismatches surface in code review. Drift risk is real but low-impact: an unknown function in user-emitted DSL becomes a Graylog 400 instead of a client-side lint — degrades gracefully.

**Validation discipline:** Mirrors CONCERNS.md "no query escaping for Graylog query string" lesson — `escape.js` is the **first** module written, with tests for every Lucene/DSL reserved character, *before* any rule-emit code uses it. Don't recreate the `buildQueryString` mistake at a new layer.

---

### 6. Blueprint Composition — **Blueprints call `services/`, not other tool handlers**

**Recommendation:** Blueprints depend on the **services layer**, not on the tool handlers.

```js
// src/tools/blueprints/setup-error-stream-for-app.js
import { createStream, createStreamRule, attachStreamToPipeline } from "../../services/streams.js";
import { createPipeline } from "../../services/pipelines.js";

export const handleSetupErrorStreamForApp = defineMutatingHandler({
    name: "setup_error_stream_for_app",
    schema: SetupErrorStreamForAppSchema,
    build(args) {
        // Returns a *plan*: list of {method, path, body, summary} for preview
        return planSetupErrorStreamForApp(args);
    },
    async apply(conn, plan) {
        const client = makeClient(conn);
        const stream = await createStream(client, plan.stream);
        const rule = await createStreamRule(client, stream.id, plan.rule);
        const pipeline = await createPipeline(client, plan.pipeline);
        return { stream, rule, pipeline };
    },
});
```

**Why services and not handlers:**
- **Handler-to-handler cross-imports re-couple modules** at the MCP layer. A handler is "MCP-shaped" (takes `request`, returns `{content}`); calling one from another means parsing args twice and re-checking dry-run twice, both error-prone.
- **Services are pure domain operations** with no MCP coupling. They take `(client, args)` and return Graylog responses. Blueprints compose them in apply()-phase, and the dry-run path returns the *plan* (list of would-be requests) without executing anything.
- **Existing precedent:** the closest analogue is `src/aggregations.js` exposing `buildTimeHistogram` / `executeAggregation` / etc., which `index.js` orchestrates by composition. Services are that pattern applied per Graylog domain.

**Dry-run for blueprints:** The plan returned by `build()` is **a list of requests**, not a single request. The dry-run preview shows the agent every Graylog call the blueprint would make. This is more honest than showing a single combined payload and matches the "agent can reason about each mutation" decision in PROJECT.md.

---

### 7. Graylog API Client — **One generic `graylogClient.request(method, path, body)` with thin per-endpoint service functions on top**

**Recommendation:** Single axios-backed HTTP client; services wrap it with endpoint-specific knowledge.

```js
// src/graylog/client.js
import axios from "axios";
import { buildAuth } from "./auth.js";
import { mapGraylogError } from "./errors.js";

export function makeClient(conn) {
    return {
        async request(method, path, body) {
            try {
                const res = await axios({
                    method,
                    url: `${conn.baseUrl}${path}`,
                    data: body,
                    headers: {
                        "Content-Type": "application/json",
                        "X-Requested-By": "graylog-mcp",
                        ...buildAuth(conn.apiToken),
                    },
                    validateStatus: () => true,
                });
                if (res.status >= 400) throw mapGraylogError(res);
                return res.data;
            } catch (err) {
                if (err.isGraylogError) throw err;
                throw new Error(`Graylog request failed: ${err.message}`);
            }
        },
    };
}
```

**Why one generic client over alternatives:**
- **Hand-roll per-endpoint clients:** 50+ endpoints × ~30 LOC of axios boilerplate each = ~1500 LOC of identical-shaped HTTP code. Services already provide the "this endpoint takes X, returns Y" specialization layer — adding a per-endpoint client just doubles that.
- **OpenAPI-generated client:** The PROJECT.md explicitly notes `api-specs/` is sparse / single YAML. Generating a client from incomplete specs would mean either filling in the spec by hand (large unrelated effort) or generating partial coverage. Reading Java REST resources directly (decided in PROJECT.md Key Decisions) is incompatible with a spec-generated client.
- **Generic `request()`:** Smallest surface, easiest to test (one mock point), and matches the existing `searchGraylog()` shape (`src/query.js`) generalized one level up. Migration path is clear: `searchGraylog` becomes a thin wrapper over `client.request("POST", "/api/views/search/sync", payload)` in a future cleanup, but this milestone doesn't touch it (read tools unchanged).

**Error mapping (`graylog/errors.js`):** Graylog returns 400 with structured JSON body for validation failures, 403 for permission denied, 404 for missing resources. Map these to typed errors (`GraylogValidationError`, `GraylogPermissionError`, `GraylogNotFoundError`) so handlers can produce useful messages without re-parsing axios responses. The PROJECT.md "insufficient permissions surface as Graylog's 403 response" constraint becomes a one-liner in this mapper.

---

### 8. Connection State for Mutating Ops — **Add `connectionName` arg to mutating tools (per-call resolution); keep singleton for read tools**

**Definitive answer:** Per-call resolution for mutating tools. Singleton remains the **default fallback** when the arg is omitted, preserving the existing UX.

```js
// src/tools/_shared/connection.js
export function resolveConnection(args) {
    if (args._testConnection) return { conn: TEST_CONN, name: args._testConnection };
    const connections = getConnections();
    if (args.connectionName) {
        const conn = connections[args.connectionName];
        if (!conn) return { error: errorResponse(`Connection "${args.connectionName}" not found`) };
        return { conn, name: args.connectionName };
    }
    const activeName = getActiveConnection();
    const conn = getActiveConnectionConfig();
    if (!conn) return { error: errorResponse(`No active connection. Pass connectionName or call use_connection.`) };
    return { conn, name: activeName };
}
```

**Why this option (smallest blast radius that fixes the real risk):**
- **Singleton-only (option A):** Leaves the documented concurrency bug (CONCERNS.md:33) in place for the exact tools where it matters most — mutating tools run against potentially the wrong Graylog cluster if the agent has been switching connections mid-conversation. With 50+ admin tools and an agent that may do `use_connection prod` then `create_stream` then `use_connection staging` then `create_stream` in rapid succession, the race is real.
- **Request-scoped connection refactor (option C):** Deep change. Threading a connection context through every handler, service, and the dispatch layer is the right long-term answer but is a milestone-sized refactor on its own, and PROJECT.md's "Backward compat: existing v2.3 tool contracts unchanged" closes the door on changing read-tool signatures.
- **Per-call arg with singleton fallback (option B, recommended):** Additive on every signature. Old behavior (`use_connection prod`, then mutate) still works unchanged. New, safer behavior (explicit `connectionName` per mutation) is available and **encouraged in tool descriptions**. Blueprints capture `connectionName` once at the top and pass it down through services. The singleton becomes a convenience for interactive single-target workflows, not a correctness assumption.

**Smallest-blast-radius marker:** This is **the** smallest-blast-radius option that materially improves the situation. Documentation of the limitation (option A) does not satisfy the project's safety posture; deep refactor (option C) blows past scope.

**Migration note for tool definitions:** Every mutating tool's zod schema includes `connectionName: z.string().optional()`. The tool definition's JSON-Schema in `src/tools.js` documents that omitting it falls back to active connection. The tool *description* (the LLM-facing text) explicitly says "pass `connectionName` to bind this mutation to a specific Graylog" — agents read this and use it.

---

### 9. Build Order for the Six Domains

**Dependency-driven phase ordering:**

```
Phase 0:  Preliminary refactor — dispatch.js, graylog/client.js, services/ scaffold,
          tools/_shared/* (handler factory, dry-run, validation glue), pipeline-dsl/ scaffold
          → No new tools shipped; existing read tools migrated to dispatch Map; singleton verified

Phase 1:  Inputs + Extractors            (no upstream Graylog dependencies; produce data that feeds streams)
Phase 2:  Index Sets                      (streams MUST reference an indexSetId; build before streams)
Phase 3:  Streams + Stream Rules          (depends on Phase 2 for indexSetId)
Phase 4:  Pipeline Rules + Pipelines      (uses pipeline-dsl from Phase 0; attaches to streams from Phase 3)
Phase 5:  Event Definitions + Notifications  (event-defs reference streams; upgrade from existing read-only)
Phase 6:  Dashboards + Widget Templates   (references everything: streams, pipelines, events)
Phase 7:  Blueprints                      (composes services from all prior phases)
```

**Rationale per dependency edge:**

| Phase | Depends on | Why |
|-------|-----------|-----|
| 1 (Inputs/Extractors) | Phase 0 only | Inputs are root-level resources; extractors attach to inputs. Both are self-contained Graylog concepts. No downstream tool needs them to *exist* yet at construction time. |
| 2 (Index Sets) | Phase 0 | Standalone; but streams require `indexSetId`, so this must precede Phase 3. Could swap with Phase 1 (no dependency between them) — listed in this order because Inputs is a simpler validation target for the new architecture. |
| 3 (Streams) | Phase 2 | `POST /api/streams` requires `index_set_id` (Java source: `StreamResource.create`). Without Phase 2, every stream creation would have to look up index sets by name through read-side tools — workable but fragile. |
| 4 (Pipelines) | Phase 3 + DSL from Phase 0 | Pipelines connect to streams (`POST /api/system/pipelines/connections`). Pipeline rules emit DSL — the validator and builtins catalogue must exist. |
| 5 (Events) | Phase 3 | Event definitions filter on streams (`stream_ids: [...]`). Read-side wrappers already exist (`src/events.js`); this phase upgrades them to CRUD using the new architecture. |
| 6 (Dashboards) | Phases 1–5 | Widget templates query streams, reference pipelines, surface events. Building dashboards before the upstream resources exist means the templates have to be tested against externally-managed data — possible, but it's the only phase where every prior domain is referenced. |
| 7 (Blueprints) | All | Cross-domain composition — `setup_error_stream_for_app` touches streams, pipeline rules, pipeline connections, and (optionally) a dashboard. By definition the last phase. |

**Where the build order minimizes "build this before that breaks":**
- Phase 2 before Phase 3 eliminates "how do I get an indexSetId?" hand-waving in stream tests.
- Phase 4 after Phase 3 means pipeline-to-stream connection tools can use stream IDs created by Phase 3 tools in integration tests.
- Phase 5 after Phase 3 means event-definition tests can reference real streams.
- Phase 7 last means blueprints have a fully populated services/ layer to compose from — no half-built primitives.

**Independent pairs (could be parallelized if multiple contributors):**
- Phase 1 (Inputs/Extractors) ↔ Phase 2 (Index Sets): no shared dependency.
- After Phase 4 lands: Phase 5 (Events) and Phase 6 (Dashboards) are mostly independent; events references streams, dashboards references everything, but they don't reference each other.

---

## Patterns to Follow

### Pattern 1: Mutating Tool Skeleton
**What:** Every mutating tool is constructed via `defineMutatingHandler`, not hand-written.
**When:** Any tool that calls `client.request()` with method ≠ GET.
**Why:** Centralizes dry-run default-to-true, validation, error wrapping, connection resolution.
**Example:** see Q3 above.

### Pattern 2: Service Layer Returns Plans, Not Results, in `build()`
**What:** `services/<domain>.js` exposes both `buildXRequest(args)` (pure) and `xWithRequest(client, req)` (effectful).
**When:** Any mutation that must support dry-run.
**Why:** Guarantees preview ≡ apply payload.

### Pattern 3: Domain-Local Schemas, Cross-Domain Schemas in `_shared/`
**What:** zod schemas live in `tools/<domain>/schemas.js`; promote to `tools/_shared/schemas.js` when consumed by ≥2 domains.
**Why:** Locality by default; avoid premature global schema modules.

### Pattern 4: DSL Emission via Builders, Not String Templates
**What:** Rule DSL is built up via `pipeline-dsl/index.js` helpers, not by template-string interpolation.
**Why:** Repeats the CONCERNS.md "no query escaping" lesson at a new level — never let user-controlled values into a DSL via string concatenation.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Cross-Importing Tool Handlers
**What:** `tools/blueprints/*.js` calling `handleCreateStream(fakeRequest)`.
**Why bad:** Double-validation, double-dry-run, parsing args twice, opaque error propagation.
**Instead:** Call services. Blueprints orchestrate plans + applies, not MCP requests.

### Anti-Pattern 2: Adding to `src/index.js`'s if-chain
**What:** Adding `if (name === "create_stream") return handleCreateStream(request);` to `index.js`.
**Why bad:** Re-creates the 903-line file problem at 50× scale.
**Instead:** Phase 0 dispatch refactor; every new domain self-registers.

### Anti-Pattern 3: Hand-Encoded HTTP per Endpoint
**What:** `services/streams.js` doing its own `axios.post(...)`.
**Why bad:** Auth headers, error mapping, X-Requested-By repeated 50× — same bug surface 50×.
**Instead:** `client.request(method, path, body)`. Services only know endpoint shape, not transport.

### Anti-Pattern 4: Per-Handler `args.dryRun ?? true`
**What:** Each new mutating handler manually checking the dryRun flag.
**Why bad:** One missed check = silent destructive operation. The single most expensive class of bug this milestone can produce.
**Instead:** `defineMutatingHandler` enforces it once.

### Anti-Pattern 5: Singleton Connection for Blueprints
**What:** Blueprint composes 5 service calls but reads `getActiveConnection()` separately at each one.
**Why bad:** Agent could `use_connection X` between service calls (in theory) — race condition.
**Instead:** Blueprint resolves the connection once at handler entry, passes it down explicitly.

---

## Scalability Considerations

| Concern | At 50 tools (this milestone) | At 100+ tools (future) |
|---------|------------------------------|------------------------|
| Dispatch lookup | O(1) Map — already constant | unchanged |
| `tools.js` size | ~1500 LOC of JSON-Schema | Generate from zod with `zod-to-json-schema` |
| Service file count | 9 service modules | Sub-organize by Graylog subsystem if needed |
| Pipeline DSL builtins | ~80–120 entries, hand-curated | Regenerator script from Java source |
| Connection concurrency | Per-call arg patches singleton risk | Request-scoped connection context (deeper refactor) |
| Test surface | Per-tool unit + per-service integration | Contract tests against a Graylog 7.2 container |

---

## Sources

| Source | Confidence | Notes |
|--------|------------|-------|
| `.planning/codebase/STRUCTURE.md` | HIGH | Existing layout, naming, extraction precedent |
| `.planning/codebase/CONVENTIONS.md` | HIGH | Handler shape, error response shape, zod-declared-but-unused, async style |
| `.planning/codebase/CONCERNS.md` | HIGH | Singleton-connection risk, dispatch chain size, query escaping precedent |
| `.planning/codebase/ARCHITECTURE.md` | HIGH | Tool dispatch layer, clustering subsystem as registry precedent |
| `src/index.js:38-104` (read) | HIGH | Actual current dispatch shape |
| `src/tools/cluster-errors.js` (read) | HIGH | Extracted-handler precedent + errorResponse pattern |
| `src/tools/template-mgmt.js` (read) | HIGH | Multi-tool-per-file precedent + resolveConnection helper pattern |
| `src/clustering/index.js` (read) | HIGH | Registry pattern (Map + register/get/list/_clearForTests) |
| `.planning/PROJECT.md` | HIGH | Scope boundaries, key decisions, dry-run default-true requirement |
| Graylog 7.2 Java source (`source-code/graylog2-server/.../rest/resources/`) | MEDIUM | Referenced by PROJECT.md as authoritative — not directly read during this research pass; endpoint paths (`/api/streams`, `/api/system/pipelines/connections`) cited from PROJECT.md context and standard Graylog REST conventions, verify in implementation phase |
| Graylog pipeline-processor functions (`source-code/graylog2-server/.../plugin/pipelineprocessor/`) | MEDIUM | Source of builtins catalogue; count estimate (~80–120) is order-of-magnitude, verify when building `pipeline-dsl/builtins.js` |
