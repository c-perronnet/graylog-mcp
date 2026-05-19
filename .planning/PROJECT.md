# Graylog MCP — Full Admin Surface

## What This Is

A Model Context Protocol server that gives an AI agent end-to-end control of a Graylog 7.0.6 deployment — read/analyze and configure. The server now exposes **91 tools across 9 admin domains** (inputs, extractors, index-sets, streams, stream-rules, pipelines, pipeline-rules, events/notifications, dashboards/widgets/blueprints) plus 6 cross-domain blueprints that compose a complete monitoring environment from a single natural-language intent. Every mutating tool defaults to `dryRun: true` and returns a cryptographic confirmation token over the dry-run state; applying without an explicit `dryRun: false` is structurally impossible.

## Core Value

**An AI agent can configure Graylog from intent alone, safely, without touching the web UI.** Shipped end-to-end in v3.0.0 — proven via 1076/1076 tests, 71/71 requirements covered, and the `setup_app_monitoring_stack` blueprint producing a working stream + pipeline + dashboard + alert chain from one call.

## Current State

**Shipped:** v3.0.0 Full Admin Surface (2026-05-16) — see [`MILESTONES.md`](MILESTONES.md) for the headline accomplishments and [`milestones/v3.0.0-ROADMAP.md`](milestones/v3.0.0-ROADMAP.md) for the phase-by-phase narrative.

**Codebase:** 17,903 src LOC + 24,881 test LOC across 353 files; `src/tools/<domain>/` per-domain extraction, `src/services/` for blueprint composition, `src/pipeline-dsl/` for rule emission. c8 coverage baseline 93.58% statements / 79.13% branches.

**Tech stack:** Node ≥22 ESM, `@modelcontextprotocol/sdk`, `axios`, `zod`. Only new runtime dep this milestone: none. Only new dev dep: `c8`.

**Known deferred items:** 11 (see `MILESTONES.md → Technical debt / deferred`) — all live-cluster-mutation or visual-UAT; none code-blocking.

## Current Milestone: v3.1.0 AuthZ & Sharing

**Goal:** Add the authorization layer to the Graylog MCP — let an agent grant users access to entities, starting with streams.

**Target features:**
- `share_entity` tool wrapping `PUT /api/authz/shares/{grn}` — grant a user view/manage/own access to a stream
- GRN abstraction that generalizes the sharing path to dashboards and saved searches
- A read path for an entity's current grants — sharing safely requires seeing current state
- Role management (`create_role` / `assign_role`) — scope confirmed during requirements

**Key context:** Reverses v3.0.0's "users/roles out of scope" exclusion. Same constraints — Node ESM, zod validation, `dryRun: true` default + confirmation token, new code under `src/tools/authz/`, v2.3 contracts unchanged. Entity-sharing is a higher-blast-radius surface (it changes who can read production logs), so the dry-run + drift-refusal discipline from v3.0.0 applies with extra weight.

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

### Validated (v3.0.0)

<!-- Shipped 2026-05-16. Every item below has a tool registered in src/dispatch.js, snapshot fixtures, and passes test/ assertions. -->

**Admin domains — raw CRUD primitives:**

- ✓ Input CRUD with C3 mitigation on `update_input` (encrypted-field STRICT_NO_ECHO) — v3.0.0
- ✓ Extractor CRUD across all 8 Graylog 7.0.6 primitive types — v3.0.0
- ✓ Index-set CRUD + rotation/retention strategy bundles + C1 mitigation on `delete_index_set` (inverted default + sha-256 confirmation) — v3.0.0
- ✓ Stream CRUD + stream-rule CRUD + C2 mitigation on `delete_stream` (3-endpoint cascade hash + drift refusal) + `test_stream_match` — v3.0.0
- ✓ Pipeline CRUD + pipeline-rule CRUD + pipeline↔stream connection management (GET-merge-POST + GET-subtract-POST) — v3.0.0
- ✓ Event-definition CRUD with M1 `schedule:false` default + C5 v6→v7 aggregation migration — v3.0.0
- ✓ Event-notification CRUD with D-09 cascade-hash drift refusal — v3.0.0
- ✓ Dashboard CRUD via internal Search+View 2-step chain (C7 mitigation) + 8-template widget library + `add_widget_from_template` / `remove_widget` symmetric chains — v3.0.0

**Higher-level blueprint tools:**

- ✓ 6 cross-domain blueprints (BLUE-01 through BLUE-06) composed from `src/services/*` per D-09 boundary — v3.0.0
- ✓ Headline blueprint `setup_app_monitoring_stack` ships a 6-step chain (stream + 2 rules + pipeline + 3 stages + dashboard + 4 widgets + alert) from one intent — v3.0.0

**Cross-cutting capabilities:**

- ✓ Pipeline-rule DSL subsystem (`src/pipeline-dsl/`) — frozen 133-entry function catalogue + live-overlay merge + structured-intent emitter + server-authoritative parse pre-flight (C4) — v3.0.0
- ✓ Dry-run safety — every mutating tool defaults to `dryRun: true`, returns sha-256 confirmation token, refuses apply on drift — v3.0.0
- ✓ Connection registry + API-token auth reused unchanged; insufficient permissions surface as `GraylogPermissionError` (403) or `GraylogUnauthorizedError` (401) — v3.0.0
- ✓ v2.3 read tools verified against Graylog 7.0.6 + 5 v7.2 response fixtures + 11 smoke tests (HARD-03) — v3.0.0
- ✓ Target Graylog 7.0.6 verified against live instance at `<graylog-host>` — v3.0.0

### Active

<!-- v3.1.0 AuthZ & Sharing — hypotheses to validate this milestone. -->

- ◻ Agent can grant a user view/manage/own access to a stream via `share_entity` (`PUT /api/authz/shares/{grn}`) — v3.1.0
- ◻ A GRN abstraction generalizes the sharing tool to dashboards and saved searches — v3.1.0
- ◻ Agent can read an entity's current grants before mutating them — v3.1.0
- ◻ Role management (`create_role` / `assign_role`) — scope confirmed during requirements — v3.1.0

### Out of Scope

<!-- Explicit boundaries with reasons. Future milestones, not this one. -->

- **Lookup tables, data adapters, caches** — user did not select; deferred to follow-up milestone if needed
- **API token minting & user account CRUD** — creating/deleting users and issuing API tokens stays out of scope; v3.1.0 adds entity-sharing and role assignment only (the v3.0.0 blanket "users/roles" exclusion is narrowed, not lifted)
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
| Target Graylog 7.0.6 only (no multi-version) | User runs 7.0.6 on the test instance (`<graylog-host>`); local 7.2-source clone is forward-compat reference but live behaviour wins on divergence. Retargeted from 7.2 on 2026-05-13 after live env was provisioned. | ✓ Validated (v3.0.0) |
| Reuse existing connection registry + API token for admin auth | Existing UX is good; Graylog already returns 403 on insufficient role; introducing a "writable" flag is a per-call dryRun flag's job, not a connection concept | ✓ Validated (v3.0.0) |
| Per-call `dryRun: true` default (not connection-level) | Lets the agent reason about each mutation independently; same connection can preview some calls and apply others; aligns with how agents iterate | ✓ Validated (v3.0.0) |
| Two tool layers: CRUD primitives AND blueprints | CRUD is necessary for any unanticipated workflow; blueprints make common setups one-shot. Both needed for the "agent bootstraps from prompt" goal. | ✓ Validated (v3.0.0) |
| Agent writes pipeline-rule DSL (not pass-through strings) | Higher leverage — the agent can compose rule logic without the user authoring DSL. Requires client-side DSL helpers/validators to be reliable. | ✓ Validated (v3.0.0) |
| Dashboard widgets via curated templates (not arbitrary construction) | Full widget construction is its own subsystem (query composition + display config); curated templates cover ~80% of agent workflows | ✓ Validated (v3.0.0) |
| Adopt the existing `zod` dependency for admin-tool input validation | `zod` already in package.json but unused; admin endpoints take complex nested payloads that need real validation; avoids a new dep | ✓ Validated (v3.0.0) |
| Per-domain extraction under `src/tools/<domain>/` | Existing `src/index.js` is already strained at 903 lines + long dispatch chain. Adding ~50 admin tools requires extraction precedent already set by clustering and template-mgmt. | ✓ Validated (v3.0.0) |
| Read Graylog REST resources from local source (not Swagger docs) | `api-specs/` is incomplete in the source tree; Java REST classes are the authoritative shape; reduces drift between docs and behavior | ✓ Validated (v3.0.0) |
| Existing read tools: verify-against-v7 only, no changes | Keeps milestone purely additive; v7 breakage on read side becomes targeted fix work, not a refactor | ✓ Validated (v3.0.0) |

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
*Last updated: 2026-05-19 — MILESTONE v3.1.0 AuthZ & Sharing started (planning). Previous: v3.0.0 ADMIN-SURFACE COMPLETE (2026-05-16) — all 8 phases (0-7) closed; all 85/85 requirements satisfied (13 FOUND + 11 INPUT + 8 INDEX + 11 STREAM + 14 PIPE + 9 EVENT + 14 DASH+BLUE + 5 HARD). Total tool surface: 91 tools. Test suite: 1073/1073 green. c8 coverage baseline: 93.58% statements / 79.13% branches / 89.93% functions / 93.58% lines. Major mitigations end-to-end: C1 (delete_indices default-true inverted + sha-256 confirmation), C2 (stream-cascade keyed-buckets hash + drift refusal), C3 (encrypted-field zeroing — partial-update wrapper), C4 (rule-DSL parse pre-flight + 133-entry function catalogue), C5 (v6→v7 aggregation visible migration), C7 (dashboard Search+View 2-step chain + widget-position integrity), M1 (event-def `schedule:false` default), M3 (simulate_pipeline_rule M3 gate), Pitfall 2 (connect/disconnect GET-merge-PUT). Headline blueprint BLUE-01 `setup_app_monitoring_stack` ships the 6-step chain. Outstanding HUMAN-UAT (deferred to `/gsd-verify-work`): 11 items across phases 2/3/4/5/6 — all live-Graylog smoke + checkpoint sign-offs auto-approved under "AFK to milestone end" directive. Phase rollup: Phase 0 (Foundation 13/13), Phase 1 (Inputs & Extractors 11/11), Phase 2 (Index Sets 8/8), Phase 3 (Streams 11/11), Phase 4 (Pipelines 14/14), Phase 5 (Events & Notifications 9/9), Phase 6 (Dashboards + Blueprints 14/14), Phase 7 (Final Hardening 5/5).*
