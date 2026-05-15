# Graylog MCP — Full Admin Surface

## What This Is

A Model Context Protocol server that gives an AI agent end-to-end control of a Graylog deployment — not just searching and analyzing logs, but **bootstrapping the deployment itself**: streams, pipelines, dashboards, inputs, indices, event definitions. The agent should be able to take a natural-language instruction like *"set up an app monitoring environment for service X"* and produce a working Graylog configuration without a human clicking through the web UI.

The existing v2.3 codebase covers read/analyze (search, aggregations, histograms, log clustering); this milestone is the write/configure half that turns the MCP into a full admin surface.

## Core Value

**An AI agent can configure Graylog from intent alone, safely, without touching the web UI.** Everything else (parity with Graylog's UI, breadth of API coverage, blueprint quality) flows from that.

## Requirements

### Validated

<!-- Inherited from existing v2.3.0 codebase (see .planning/codebase/). These are shipped, tested in production use, and form the baseline this milestone extends. -->

- ✓ Multi-connection registry with `use_connection` switching — existing (v2.0+)
- ✓ Message search with filters, time ranges, exact/loose match, stream scoping — existing (v2.0+)
- ✓ Surrounding-message context retrieval — existing
- ✓ Log histograms (4-fallback strategy chain) — existing (v2.1+)
- ✓ Field aggregations + field-time aggregations — existing (v2.1+)
- ✓ Saved searches (named query persistence) — existing (v2.2+)
- ✓ Events / alerts read-only API wrappers — existing (v2.2+)
- ✓ Log clustering with Drain3 + template store + label management — existing (v2.3)
- ✓ Pluggable clustering strategy registry — existing (v2.3)
- ✓ Configurable connection config via `~/.graylog-mcp/config.json` or `GRAYLOG_CONFIG_PATH` — existing

### Active

<!-- Hypotheses for this milestone. Validated when shipped. -->

**Admin domains — raw CRUD primitives:**

- [ ] Stream CRUD + stream-rule CRUD (create/list/get/update/delete, attach/detach rules)
- [ ] Pipeline CRUD + pipeline-rule CRUD (with agent-generated rule DSL, see below)
- [ ] Pipeline-to-stream connection management
- [ ] Dashboard CRUD (create/list/get/update/delete dashboards as containers)
- [ ] Widget templates: curated library of pre-built widgets agent can drop into a dashboard
- [ ] Input CRUD (create, configure, start/stop)
- [ ] Extractor CRUD (per-input)
- [ ] Index-set CRUD + retention/rotation strategy configuration
- [ ] Event-definition CRUD (upgrade from existing read-only)
- [ ] Event-notification CRUD (upgrade from existing read-only)

**Higher-level blueprint tools:**

- [ ] Curated blueprint set that bundles multi-call setups into single tool invocations (e.g. `setup_error_stream_for_app` = stream + rule + pipeline connection; `create_app_health_dashboard` = dashboard + widget templates)
- [ ] Blueprint library is extensible (lives in source; not user-editable this milestone)

**Cross-cutting capabilities:**

- [ ] Pipeline-rule DSL: the agent emits Graylog `when … then …` rule source; tools provide rule-DSL generation helpers / validators (not just pass-through strings)
- [ ] **Dry-run safety:** every mutating tool takes `dryRun: boolean` defaulting to `true`. Dry-run returns the would-be HTTP request payload and a confirmation token; agent passes `dryRun: false` to apply.
- [ ] All mutating tools reuse the existing connection registry + API-token auth; insufficient permissions surface as Graylog's 403 response
- [ ] Verify existing v2.3 read tools still work against Graylog 7.0.6; fix any v7 breakage encountered, no new features on read side
- [ ] Target **Graylog 7.0.6** (live test instance at `<graylog-host>`); the local source at `source-code/graylog2-server/` is 7.2.0-SNAPSHOT and is kept as a forward-compatibility reference, but every endpoint shape this milestone ships MUST be verified against 7.0.6 before claiming "done". Single-version target.

### Out of Scope

<!-- Explicit boundaries with reasons. Future milestones, not this one. -->

- **Lookup tables, data adapters, caches** — user did not select; deferred to follow-up milestone if needed
- **Users / roles / API token management** — explicitly excluded as a high-risk surface; not in this milestone's threat model
- **Content packs** — bundling/distribution is its own subsystem; out of scope
- **Sidecar / collector management** — covers fleet-side agents, not server-side config; out of scope
- **Multi-version compatibility (anything other than 7.0.x)** — single target is Graylog 7.0.6 (the live test instance); 6.x and earlier are out, and divergence with the 7.2-source clone is treated as a known-future-issue not addressed this milestone
- **Full widget construction from arbitrary search specs** — only curated widget templates this milestone; arbitrary-widget construction deferred
- **Backward changes to existing v2.3 read tools** — only verify-against-v7; no refactors as part of this milestone
- **User-editable blueprint library** — blueprints ship in source; user-defined blueprints (similar to saved searches) are a possible follow-up

## Context

**Codebase state:** Node.js (ESM, `>=18`), MCP server using `@modelcontextprotocol/sdk` + axios. ~27 tools today, all read/analyze. Source is ~3k lines across `src/` (see `.planning/codebase/STRUCTURE.md`). Existing dispatch pattern: tool definitions in `src/tools.js`, dispatch chain in `src/index.js`, feature modules under `src/` and extracted handlers under `src/tools/`. Pluggable subsystem precedent exists for clustering (`src/clustering/`).

**Existing tools test framework:** Node built-in `assert/strict` via four standalone scripts at repo root. No runner, no CI. `npm test` is broken (references missing `test-server.js`). See `.planning/codebase/TESTING.md`.

**Existing concerns relevant to this milestone (from `.planning/codebase/CONCERNS.md`):**
- Connection state is process-global mutable — admin operations stack risk on the same singleton
- No input validation (zod declared but unused) — admin payloads need real validation
- No query-string escaping in `buildQueryString` — same risk shape returns when building rule DSL programmatically
- `src/index.js` already at 903 lines with a long `if (name === "...")` dispatch chain — adding ~50+ admin tools to that file is not viable; the natural pattern is to extract under `src/tools/<domain>/` (precedent: `src/tools/cluster-errors.js`)
- Histogram fallback chain (`getLogHistogram`) hides Graylog API drift — risk that admin tools across two major versions develop the same scar tissue; pinning to Graylog 7.0.x keeps this clean

**Graylog test environment:** Live instance at `http://<graylog-host>`, version `7.0.6` (codename "Noir"), credentials stored in `~/.graylog-mcp/config.json` (mode 0600, out of the repo). Every admin endpoint shipped this milestone is verified against this live instance before "done". Connection name: `test`.

**Graylog server source (reference, not authoritative):** Available locally at `source-code/graylog2-server/` — version `7.2.0-SNAPSHOT`. **Note:** the source clone is two minors ahead of the live test instance. The `api-specs/` directory is sparse (single YAML); the researcher will read Java REST resource classes directly under `graylog2-server/src/main/java/.../rest/resources/` for endpoint shapes. Any divergence between 7.0.6 (live) and 7.2-snapshot (source) is resolved in favour of the live behaviour — the source is a forward-compat sanity check, not the ship target.

**Pipeline rule DSL:** Graylog's pipeline-rule language has `when` / `then` blocks, a small set of built-in functions, and supports user-defined function references. The agent generating rule DSL is a leverage point: helpers can validate syntax client-side before round-tripping, catching errors before they reach Graylog. Reference rule grammar in source: `source-code/graylog2-server/graylog2-server/src/main/java/.../plugin/pipelineprocessor/`.

**Dashboard model:** Modern Graylog dashboards are "views" — composed of search queries + display configs. Full widget construction is the big-balloon scope; widget templates (this milestone's choice) keep it tractable.

## Constraints

- **Tech stack:** Node.js ≥18 ESM; existing dependencies (`@modelcontextprotocol/sdk`, `axios`, `zod`) — adopt `zod` for the long-deferred input validation rather than adding a new dep
- **Graylog version:** 7.0.6 only (the live test instance) — single target; no multi-version branching. The local 7.2-source clone is a reference, not a ship target.
- **Auth model:** Existing connection registry + API token (HTTP Basic with token-as-username, `password: "token"`). No new auth concepts. Insufficient permissions surface as upstream 403.
- **Safety:** Every mutating tool MUST default to `dryRun: true`. Applying without an explicit `dryRun: false` is a bug.
- **Backward compat:** Existing v2.3 tool contracts unchanged. Existing connection-config schema additive only.
- **No web UI:** This is an MCP server. No browser surface, no admin console, no rendered HTML. Output is JSON-stringified text in MCP responses.
- **Code organization:** New admin tools extract into `src/tools/<domain>/` (per-domain modules), not inline in `src/index.js`. Use the existing `src/tools/cluster-errors.js` and `src/tools/template-mgmt.js` pattern.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Target Graylog 7.0.6 only (no multi-version) | User runs 7.0.6 on the test instance (`<graylog-host>`); local 7.2-source clone is forward-compat reference but live behaviour wins on divergence. Retargeted from 7.2 on 2026-05-13 after live env was provisioned. | — Pending |
| Reuse existing connection registry + API token for admin auth | Existing UX is good; Graylog already returns 403 on insufficient role; introducing a "writable" flag is a per-call dryRun flag's job, not a connection concept | — Pending |
| Per-call `dryRun: true` default (not connection-level) | Lets the agent reason about each mutation independently; same connection can preview some calls and apply others; aligns with how agents iterate | — Pending |
| Two tool layers: CRUD primitives AND blueprints | CRUD is necessary for any unanticipated workflow; blueprints make common setups one-shot. Both needed for the "agent bootstraps from prompt" goal. | — Pending |
| Agent writes pipeline-rule DSL (not pass-through strings) | Higher leverage — the agent can compose rule logic without the user authoring DSL. Requires client-side DSL helpers/validators to be reliable. | — Pending |
| Dashboard widgets via curated templates (not arbitrary construction) | Full widget construction is its own subsystem (query composition + display config); curated templates cover ~80% of agent workflows | — Pending |
| Adopt the existing `zod` dependency for admin-tool input validation | `zod` already in package.json but unused; admin endpoints take complex nested payloads that need real validation; avoids a new dep | — Pending |
| Per-domain extraction under `src/tools/<domain>/` | Existing `src/index.js` is already strained at 903 lines + long dispatch chain. Adding ~50 admin tools requires extraction precedent already set by clustering and template-mgmt. | — Pending |
| Read Graylog REST resources from local source (not Swagger docs) | `api-specs/` is incomplete in the source tree; Java REST classes are the authoritative shape; reduces drift between docs and behavior | — Pending |
| Existing read tools: verify-against-v7 only, no changes | Keeps milestone purely additive; v7 breakage on read side becomes targeted fix work, not a refactor | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-15 — Phase 4 (Pipelines, Pipeline Rules & Connections) complete: 14 typed tools shipped (list/get/create/update/delete_pipeline, list/get/create/update/delete_pipeline_rule, list_pipeline_functions, simulate_pipeline_rule, connect/disconnect_pipelines_to_stream). C4 rule-DSL invention footgun mitigated end-to-end via server-authoritative parse pre-flight + structured-intent emitter + 133-entry hand-curated function catalogue overlaid with live `GET /system/pipelines/rule/functions`. M3 simulate gate proven via post-rule field change fixture (Pitfall 1 JSON-stringified body). D-14 cascade-hash drift refusal pinned with two byte-identical frozen hashes. Pitfall 2 GET-merge-PUT on connect/disconnect prevents silent stream-pipeline disconnections. Scope expanded mid-flight: PIPE-13/14 added per CONTEXT.md D-01 (roadmap dependency). 14/14 PIPE requirements complete; 701/701 tests green; 48 schema-parity assertions across Phases 0+1+2+3+4. 5 live-Graylog UAT items deferred. Phase 0..3 all closed; tool count 68 (23 v2.3 + 12 P1 + 8 P2 + 12 P3 + 14 P4 − 1 v2.3 list_streams displaced = 68).*
