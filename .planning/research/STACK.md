# Stack Research — v3.1.0 AuthZ & Sharing Milestone

**Project:** Graylog MCP — AuthZ & Sharing
**Domain:** AuthZ & entity-sharing tool surface for an existing Node.js MCP server
**Researched:** 2026-05-19
**Confidence:** HIGH

> Supersedes the v3.0.0 Admin-Surface stack research. The v3.0.0 STACK content is
> preserved in `.planning/milestones/` archival; this file now scopes the v3.1.0
> milestone only.

## Verdict

**ZERO new dependencies.** The hypothesis is confirmed. The v3.1.0 AuthZ & Sharing
milestone — `share_entity`, a GRN abstraction, a grants read path, and role
management (`create_role` / `assign_role`) — is fully buildable on the existing
runtime (`@modelcontextprotocol/sdk`, `axios`, `zod`) and dev (`c8`,
`node:test`/`node:assert`) stack. Nothing about the authz/shares or roles REST
surface requires a capability the current stack lacks.

Three specific questions, all answered:

1. **Is GRN parsing/formatting pure-string work doable with no library?**
   **YES.** A GRN is a fixed 6-segment colon-delimited string
   (`grn:<cluster>:<tenant>:<scope>:<type>:<entity>`). Graylog's own parser
   (`org.graylog.grn.GRN`) is `Splitter.on(":")` + a 6-token count check +
   lowercase normalization. `toString()` is a `StringJoiner` on `":"`. This is
   `String.split(":")` and `[...].join(":")` in JS — no library, no parser
   generator. Validation is a small `zod` `.refine()` or `.regex()`.

2. **Does the authz/shares API need anything axios+zod can't do?**
   **NO.** The endpoints (`POST /api/authz/shares/entities/{entityGRN}`,
   `.../prepare`, `GET .../user/{userId}`) consume and produce
   `application/json` with flat object/map/list payloads. The existing
   `src/graylog/client.js` already does JSON requests, HTTP Basic
   token-as-username auth, error classification (403 → `GraylogPermissionError`),
   and the `writable:false` refusal. The share request body is a plain object
   (`{ selected_grantee_capabilities: { "<grn>": "view" } }`) — exactly the
   payload shape `axios` + `zod` handle for all 91 existing tools.

3. **Test-tooling needs beyond `c8` + `node:test`/`node:assert`?**
   **NO.** Sharing tools are pure request/response wrappers over the existing
   client. The established test seam — `_setCaptureRequest(fn)` in
   `src/graylog/client.js` — intercepts the outbound call with zero network. GRN
   parse/format helpers are pure functions, ideal for plain `node:assert` unit
   tests. No HTTP mock library, no fixture framework, no new runner.

## Recommended Stack

### Core Technologies (all already installed — no change)

| Technology | Version (installed) | Purpose | Why it covers AuthZ |
|------------|---------------------|---------|---------------------|
| `@modelcontextprotocol/sdk` | ^1.18.0 | MCP server / tool registration | New `share_entity`, `create_role`, `assign_role` tools register through the existing dispatch + `src/tools/_register.js`; identical to all 91 shipped tools. |
| `axios` | ^1.12.2 | HTTP client to Graylog REST | authz/shares + roles endpoints are plain JSON over HTTP Basic — the exact request profile of every existing admin tool. Routed through `src/graylog/client.js`. |
| `zod` | ^3.25.76 | Input validation | GRN string validation (`.regex()`/`.refine()`), `Capability` enum (`z.enum(["view","manage","own"])`), grantee-map and role-payload schemas. Extends the existing `mutatingBase` in `src/tools/_shared/schemas.js`. |
| Node.js | >= 22.3.0 (engines) | Runtime | `node:crypto` `createHash("sha256")` already powers the dry-run confirmation token (`src/tools/_shared/cascade-hash.js`); the same primitive hashes the share/grant preview state. ESM, no build step. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:crypto` (built-in) | — | sha-256 confirmation token over the dry-run grant set | Reuse `computeCascadeHash` / `computeC1Hash` from `src/tools/_shared/cascade-hash.js`. Sharing is a multi-grantee mutation — a keyed-bucket hash over `{grn → capability}` plus prior grants gives the same drift-refusal guarantee as `delete_stream`. |
| `src/graylog/client.js` (internal) | — | The single HTTP layer | All authz/roles calls go through `makeClient(conn).request(...)`. Do NOT add a parallel client. |
| `src/tools/_shared/*` (internal) | — | Wrapper, schemas, dry-run, cascade-hash, errors, idempotency | New `src/tools/authz/` modules compose these. `handler.js` (`defineMutatingHandler`) supplies `dryRun:true` default + token + drift check for free. |

### Development Tools (no change)

| Tool | Purpose | Notes |
|------|---------|-------|
| `node:test` + `node:assert` (built-in) | Unit/integration tests | `npm test` runs `node --test 'test/**/*.test.js'`. GRN helpers are pure → trivial assertions. |
| `c8` (^10.1.3) | Coverage | `npm run coverage`. Hold the existing 93.58% statements / 79.13% branches baseline for new `src/tools/authz/` files. |
| `_setCaptureRequest` seam (internal) | Network-free request assertion | Intercepts outbound axios calls in tests; verify `share_entity` emits `POST /api/authz/shares/entities/grn:::stream:<id>` with the expected body. |

## Installation

```bash
# Core — nothing to install. Confirm the lockfile is intact:
npm ci

# Supporting — none.

# Dev dependencies — none.
```

No `package.json` change is expected for v3.1.0. If a PR adds a dependency,
treat it as a red flag and require explicit justification against this document.

## REST surface notes (version-specific — for the planner)

Read from the 7.2-SNAPSHOT source clone; **verify against live 7.0.6** before "done"
(per PROJECT.md the live instance wins on divergence).

| Endpoint | Method | Notes |
|----------|--------|-------|
| `/api/authz/shares/entities/{entityGRN}` | POST | Create/update shares. **Not `PUT`, not `/shares/{grn}`** — the milestone brief's `PUT /api/authz/shares/{grn}` is inaccurate; the resource is `EntitySharesResource` `@Path("/authz/shares")` + `@Path("entities/{entityGRN}")`. Body: `EntityShareRequest`. |
| `/api/authz/shares/entities/{entityGRN}/prepare` | POST | Dry-run-friendly: returns `EntityShareResponse` with `missing_dependencies` / `validation_result` **without mutating** (`@NoAuditEvent("This does not change any data")`). This is the natural backing call for `share_entity`'s `dryRun:true` path — Graylog itself provides a preview endpoint, so the dry-run does not have to be MCP-simulated. |
| `/api/authz/shares/user/{userId}` | GET | Paginated shares granted *to* a user. The "read current grants" path. |
| `/api/roles` | GET / POST | List / create roles. `RoleResponse` = `{ name, description, permissions[], read_only }`. |
| `/api/roles/{rolename}` | GET / PUT / DELETE | Read / update / delete a single role. |
| `/api/roles/{rolename}/members` | GET | Role membership. |
| `/api/roles/{rolename}/members/{username}` | PUT / DELETE | `assign_role` / unassign. **The PUT body is a placeholder** — Graylog's own annotation says "Set to `{}`, the content will be ignored." `src/graylog/client.js` strips `Content-Type` and sends no body for bodyless requests; Graylog wants a non-empty PUT, so pass `{}` explicitly. Confirm against live 7.0.6. |

**GRN format** (`grn:<cluster>:<tenant>:<scope>:<type>:<entity>`, all lowercased):
- Server tolerates empty cluster/tenant/scope — e.g. `grn::::stream:000000000001` parses (Graylog's `GRN.builder()` defaults cluster/tenant/scope to `""`).
- Builtin entity types relevant to sharing: `stream`, `dashboard`, `search` (saved searches), `event_definition`, `notification`, `output`, `report`. Grantee types: `user`, `role`, `builtin-team`.
- `Capability` enum: `view`, `manage`, `own` (lowercase JSON values; priority 1/2/3).
- The share request body key is `selected_grantee_capabilities`, a map of grantee-GRN → capability string; optional `selected_collections` (list of GRNs).

**Implementation guidance:** build a tiny internal `src/tools/authz/grn.js` (parse →
`{cluster,tenant,scope,type,entity}`, format ← same, plus convenience constructors
like `streamGRN(id)` → `grn::::stream:<id>` and `userGRN(name)`). Pure functions,
no dependency. A `zod` schema (`z.string().regex(/^grn:[^:]*:[^:]*:[^:]*:[^:]+:[^:]+$/)`)
guards tool inputs.

## Alternatives Considered

| Recommended | Alternative | When the alternative would make sense |
|-------------|-------------|----------------------------------------|
| Hand-rolled `grn.js` string helpers | A URN/IRI parsing library (`uri-js`, `urns`) | Never for this case — GRN is a fixed 6-field colon split, not RFC-3986 URN syntax (no `q-component`, percent-encoding, or NSS rules). A library adds a dependency, a supply-chain surface, and *more* edge cases than the format has. |
| Graylog's `/prepare` endpoint for the dry-run preview | MCP-side simulation of the resulting grant set | The server endpoint is authoritative (it computes `missing_dependencies` and validation the MCP cannot replicate). Prefer the round-trip; only simulate if `/prepare` proves unreliable on live 7.0.6. |
| `node:test` + `_setCaptureRequest` seam | `nock` / `msw` / `undici` MockAgent | Only if a future milestone needs full HTTP-stack fidelity (interceptors, redirects, retries). Sharing wrappers don't — the existing seam already gives network-free, deterministic assertions and is used by all 18 current suites. |
| Reuse `cascade-hash.js` for the confirmation token | A new bespoke hash module for grant sets | The keyed-bucket canonicalization in `computeCascadeHash` already handles "map of typed IDs" — a grant set is exactly that shape. No new module. |

## What NOT to Use / NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Any new npm dependency | The milestone is a thin REST wrapper over JSON; the stack is complete. A new dep violates the PROJECT.md constraint ("existing dependencies … rather than adding a new dep"). | `axios` + `zod` + `node:crypto`, all installed. |
| A URN/URI/IRI parser library | GRN is not RFC-3986; a 6-segment `split(":")` is simpler and has fewer failure modes than any general parser. | `src/tools/authz/grn.js` pure helpers. |
| An HTTP mock library (`nock`, `msw`, `undici` MockAgent) | Adds a dev dep for zero gain — sharing tools have no exotic HTTP behavior. | `_setCaptureRequest` seam in `src/graylog/client.js`. |
| A second/parallel HTTP client | `src/query.js` + `src/events.js` already bypass `client.js` and are flagged tech debt (HARD-05). Do not add a third path. | Route every authz/roles call through `makeClient(conn).request`. |
| `PUT /api/authz/shares/{grn}` as written in the brief | That path/method does not exist in the 7.2 source; the real resource is `POST /api/authz/shares/entities/{entityGRN}`. Building to the brief verbatim would 404. | The endpoint table above; verify on live 7.0.6. |
| A JWT / OAuth / new-auth library for role work | Roles are server-side RBAC objects; the MCP only needs the existing API-token Basic auth to call `/api/roles`. No new auth concept (PROJECT.md constraint). | Existing connection registry + `buildAuth`. |
| Inline tool handlers in `src/index.js` | 903-line dispatch is already strained; CONVENTIONS mandate per-domain extraction. | New `src/tools/authz/` module (schemas.js, grn.js, handlers, register). |

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `zod@^3.25.76` | `@modelcontextprotocol/sdk@^1.18.0` | Already paired across all 91 shipped tools. Stay on zod 3.x — do NOT bump to zod 4.x as part of this milestone; a major bump is a separate, out-of-scope migration. |
| `axios@^1.12.2` | Node >= 22.3.0 | No change; current. |
| `c8@^10.1.3` | `node:test` on Node 22 | Current; coverage harness unchanged. |
| Graylog REST (live) | 7.0.6 "Noir" | Ship target. The 7.2-SNAPSHOT source clone is a forward-compat reference only — verify every authz/roles endpoint shape against the live `test` connection before marking done. The `/roles/{rolename}/members/{username}` placeholder-body quirk in particular should be confirmed live. |

## Sources

- `source-code/graylog2-server/.../org/graylog/grn/GRN.java` — GRN format, 6-token parse, `Splitter.on(":")`, `toString()` via `StringJoiner`. HIGH (authoritative source).
- `source-code/graylog2-server/.../org/graylog/grn/GRNTypes.java` — builtin GRN type set (`stream`, `dashboard`, `search`, `user`, `role`, `builtin-team`, …). HIGH.
- `source-code/graylog2-server/.../org/graylog/security/rest/EntitySharesResource.java` — `@Path("/authz/shares")`, `POST entities/{entityGRN}`, `.../prepare`, `GET user/{userId}`. HIGH (corrects the brief's path/method).
- `source-code/graylog2-server/.../org/graylog/security/shares/EntityShareRequest.java` — `selected_grantee_capabilities` map, `selected_collections`. HIGH.
- `source-code/graylog2-server/.../org/graylog/security/Capability.java` — `view`/`manage`/`own` enum. HIGH.
- `source-code/graylog2-server/.../org/graylog2/rest/resources/roles/RolesResource.java` — `/roles` CRUD + `/roles/{rolename}/members/{username}` PUT/DELETE; placeholder-body annotation. HIGH.
- `package.json` — installed deps/devDeps, Node engines. HIGH.
- `src/graylog/client.js`, `src/tools/_shared/schemas.js`, `src/tools/_shared/cascade-hash.js` — existing client, zod base, hash primitives confirmed reusable. HIGH.
- `.planning/PROJECT.md`, `.planning/MILESTONES.md` — v3.0.0 shipped stack, constraints, "no new dep" directive. HIGH.

**Caveat:** the source clone is 7.2-SNAPSHOT, two minors ahead of the live 7.0.6
target. The authz/shares and roles resources have been stable across 6.x→7.x, so
divergence risk is LOW — but the planner should flag a live-7.0.6 endpoint-shape
verification task (especially the members-PUT placeholder body) before "done".

---
*Stack research for: AuthZ & entity-sharing tool surface (Graylog MCP v3.1.0)*
*Researched: 2026-05-19*
