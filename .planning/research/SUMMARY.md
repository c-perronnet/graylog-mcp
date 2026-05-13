# Research Summary — Graylog MCP Admin Surface (v3 milestone)

**Synthesized:** 2026-05-13
**Scope:** Adds ~64 tools (58 CRUD primitives + 6 blueprints) across 6 Graylog admin domains to the existing v2.3 codebase (~27 read/analyze tools). Total projected MCP surface: ~91 tools.
**Research files:** STACK.md · FEATURES.md · ARCHITECTURE.md · PITFALLS.md
**Confidence:** HIGH on phase order and critical design decisions; MEDIUM on exact version pins and some Graylog endpoint shapes.

> **⚠ Version retarget (2026-05-13, post-synthesis):** The research in this folder was conducted against the local `source-code/graylog2-server/` clone (Graylog 7.2.0-SNAPSHOT). The milestone has since been **retargeted to Graylog 7.0.6** — the live test instance the user provisioned at `<graylog-host>`. See PROJECT.md "Graylog test environment" and the relevant Key Decision. The phase order, architecture, features, and pitfalls below are still load-bearing — most are version-stable within v7 — but **endpoint shapes, payload schemas, and changelog citations (especially in PITFALLS.md backward-compat tables) must be re-verified against 7.0.6 during Phase 1+ planning**, with the live instance as authoritative. Treat any 7.0↔7.2 divergence as a known-future-issue, not in scope this milestone.

---

## Executive Summary

This milestone converts the Graylog MCP from a read/analyze tool into a full admin surface. The central design tension is safety: an LLM caller that can mutate a production Graylog cluster must be structurally prevented from doing so accidentally. All four research files converge on the same answer — **dry-run-by-default is the safety primitive, but it only works if the foundation is built first and built correctly**. The `defineMutatingHandler` factory, the `runOrPreview` helper, per-domain zod schemas, the dispatch Map refactor, and the idempotency-key mechanism are all cross-cutting concerns that every subsequent domain phase depends on. Attempting to ship the first domain (Streams) without that foundation produces a codebase where each of 50+ tools hand-rolls its own dry-run check — the single most expensive class of silent bug this milestone can produce.

The feature scope is well-defined and sourced directly from Graylog 7.2's Java REST resources. The dependency graph across domains is clear: Index Sets must exist before Streams; Streams before Pipelines and Events; all primitives before Blueprints. Dashboards are the most complex domain due to Graylog's two-entity (Search + View) creation model and widget-position integrity constraint — they belong in the penultimate phase, not earlier.

The total tool count (~91 after this milestone) triggers an agent-loop risk: at that scale, tool descriptions degrade the agent's ability to select the right tool. A tool-description hygiene pass is not optional cleanup — it must be the final gate before the milestone ships. This is Phase 7 (Final Hardening), not a post-milestone nicety.

---

## Key Findings

### From STACK.md

- **No new production dependencies.** `zod ^3.25.76` already declared but unused; adopt it. `axios ^1.12.2` covers all admin endpoints (no multipart upload in scope). No DSL parser library — hand-roll `src/pipeline-dsl/` with ~200 lines of structural validation.
- **One new devDependency: `c8 ^10.1.3`.** Node's built-in `node:test` replaces the broken standalone-script pattern.
- **Node version bump is a Phase 0 decision.** `t.snapshot()` stable in Node 22, experimental in Node 20.6+. Recommended: bump `engines.node` to `>= 20.6.0` (minimum) or `>= 22.3.0` (preferred) in Phase 0.
- **Do not upgrade zod to v4.** Pin stays at `^3.25.76`. MCP SDK uses zod internally; dual-major-in-tree risk is not worth it.

### From FEATURES.md

- **~64 net-new tools in 6 domains.** Total combined surface: ~91 tools.

| Domain | Tools | Key constraint |
|--------|-------|----------------|
| Streams + rules | 11 | `test_stream_match` is the agent's rule-validation anchor |
| Pipelines + rules + connections | 12 | At ceiling; `simulate_pipeline_rule` is non-negotiable |
| Dashboards + widget templates | 7 | Two-entity create (Search then View); 8 curated widget templates |
| Inputs + extractors | 11 | Encrypted-field partial-update; `list_input_types` is dynamic |
| Indices + retention | 8 | `deleteIndices` default must be **inverted** from Graylog's server default |
| Events + notifications | 9 | `schedule: false` default; aggregation syntax is v7-only |
| Blueprints | 6 | All compose from services layer, not other tool handlers |

- **Dependency graph drives phase order unambiguously:** `create_index_set` → `create_stream` → `create_pipeline_rule/pipeline` → `connect_pipelines_to_stream` → `create_event_notification` → `create_event_definition`. Dashboards depend on all of the above.
- **Blueprint 1 (`setup_app_monitoring_stack`) is the headline use-case** and the integration proof-of-concept.

### From ARCHITECTURE.md

- **8-phase build order** (Phase 0 + 6 domain phases + Phase 7 hardening). ARCHITECTURE.md and FEATURES.md agree on all dependency edges.
- **Three new structural layers in Phase 0:** `src/dispatch.js` (Map-based dispatch replacing the `if` chain), `src/graylog/client.js` (single HTTP client), `src/services/<domain>.js` (pure domain operations).
- **`defineMutatingHandler` factory** is the single most important design decision in Phase 0. Centralizes `dryRun: true` enforcement; a missed per-handler check is the most dangerous class of bug.
- **Blueprints call `services/`, never other tool handlers.** Handler-to-handler cross-imports cause double-validation, double-dry-run, opaque errors.
- **`connectionName` per-call arg with singleton fallback.** All mutating tools include `connectionName: z.string().optional()` in their zod schema.

### From PITFALLS.md

**Critical pitfalls (data loss / silent divergence):**

| ID | Pitfall | Prevention |
|----|---------|-----------|
| C1 | `DELETE /index_sets/{id}` defaults `delete_indices=true` server-side, destroys ES data async | Invert default; second-guardrail confirmation token if data present |
| C2 | Stream delete cascades silently to rules; pipeline connections orphaned | Pre-delete cascade preview; stale-world check on apply |
| C3 | Input update zeroes encrypted config fields if caller echoes full config | Partial-update shape only; wrapper fetches current config and merges |
| C4 | Agent invents pipeline function names (`uppercase` instead of `to_upper`) | `POST /pipelines/rule/parse` pre-flight on every dry-run; cache function registry |
| C5 | Event aggregation v6 syntax (`count(source)`) saves but never fires on v7 | Pin to v7 shape; `_convert_v6_event_aggregation` helper with warning |
| C6 | Dry-run previews contain `__SERVER_ASSIGNED__` IDs; agent reuses them | Explicit sentinel; blueprint chaining transcript on apply |
| C7 | Dashboard create requires pre-saved Search; widget-position IDs must match widget IDs | `create_dashboard` chains Search creation then View creation internally |

**Agent-loop pitfalls:**
- **M4:** Retried creates produce duplicates — every create tool takes `idempotencyKey`; dispatch auto-generates from `hash(connection, toolName, args)`.
- **M5:** List-before-create skipped under context pressure — create tools internally report `existingMatches` in dry-run output.
- **M6:** List responses balloon context — all list tools default to narrow projection (`id, title, description`); default `limit: 25`.
- **M7:** Tool discovery degrades at 91 tools — `<verb>_<domain>_<noun>` naming convention; `list_admin_tools(domain?)` meta-tool; ≤200 char descriptions; Phase 7 audit.

---

## Implications for Roadmap

### Definitive Phase Order

All three ordering sources (FEATURES.md dependency graph, ARCHITECTURE.md §9, PITFALLS.md phase mapping) agree. One note: ARCHITECTURE.md puts Inputs/Extractors before Index sets because it is a simpler validation target for the new architecture — FEATURES.md confirms no dependency between them. **Keep this ordering: Inputs first, then Index sets.**

```
Phase 0 — Foundation
Phase 1 — Inputs + Extractors
Phase 2 — Index Sets
Phase 3 — Streams + Stream Rules
Phase 4 — Pipelines + Pipeline Rules + Connections
Phase 5 — Events + Notifications
Phase 6 — Dashboards + Widget Templates + Blueprints
Phase 7 — Final Hardening
```

### Phase 0 — Foundation (Cannot Be Folded Into Phase 1)

Seven cross-cutting concerns, all prerequisites for every domain phase:

1. **Dispatch Map refactor** — replace `src/index.js` `if (name === ...)` chain with `src/dispatch.js` Map. Add startup assertion. Migrate existing read tools (no behavior change).
2. **`src/graylog/client.js`** — single axios HTTP client with auth, `X-Requested-By`, typed error mapping (400/403/404).
3. **`defineMutatingHandler` factory** — enforces `dryRun: true` default once; calls `build()` for preview or `apply()` for mutation.
4. **Node version bump** — `engines.node` to `>= 20.6.0` (minimum) or `>= 22.3.0` (preferred); fix `npm test`.
5. **Snapshot test infrastructure** — prove `t.snapshot()` works with 5-10 fixture tests before Phase 1.
6. **Cross-cutting response normalizer** — returns `{ id, body }` regardless of Graylog's inconsistent create response shapes (200 full DTO, 201 `{ stream_id }`, 201 + Location header).
7. **Idempotency-key mechanism** (M4) + **create-conflict check** (M5) + **list-projection helper** (M6).

The `dryRun` helper establishes the `__SERVER_ASSIGNED__` ID sentinel pattern (C6) that Blueprint chaining in Phase 6 depends on.

### Phase 1 — Inputs + Extractors

- `update_input` MUST be partial-update only (C3).
- `list_input_types` calls `GET /system/inputs/types/all` (dynamic discovery, not static enum).
- `test_extractor` feasibility gated on Graylog endpoint availability — flag for requirements phase.
- Establishes the partial-update pattern reused by Index sets and Events.

### Phase 2 — Index Sets

- **Invert `deleteIndices` default** (C1 — highest-severity pitfall). MCP default: `false`; Graylog server default: `true`.
- `delete_index_set` with `deleteIndices: true` requires a second-guardrail confirmation token if the index set contains messages.
- Async system-job pattern established here: `{ async: true, job_id_observable_at: "/system/jobs" }` + `await_system_job` tool (m5).
- `set_default_index_set` documents `regular: true` constraint (m2).

### Phase 3 — Streams + Stream Rules

- Pre-delete cascade preview for rules, pipeline connections, event definitions (C2).
- `list_streams` returns `mutable: boolean` per stream (m1 — built-in stream protection).
- `test_stream_match` is the agent's rule-verification anchor.
- `create_stream` internally checks existing titles (M5) and reports `existingMatches` in dry-run.

### Phase 4 — Pipelines + Pipeline Rules + Connections

- **`src/pipeline-dsl/` subsystem** delivered in full: `emit()`, `validate()`, `escape.js`, `builtins.js` (~100 entries hand-curated from `pipelineprocessor/functions/`).
- `POST /system/pipelines/rule/parse` pre-flight on every dry-run (C4).
- `simulate_pipeline_rule` MCP tool is non-negotiable (M3 — catches semantic bugs the parser cannot).
- `list_pipeline_functions` cached at connection-init, injected into `create_pipeline_rule` description.

### Phase 5 — Events + Notifications

- `create_event_definition` defaults `schedule: false` (M1 — not Graylog's `true` default).
- v7 aggregation syntax only (`count_source`); `_convert_v6_event_aggregation` helper with migration warning in dry-run output (C5).
- `validate_event_definition` called internally as a precondition (parallel to `parse_pipeline_rule` pattern from Phase 4).
- Enable/disable endpoints use `WILDCARD` body — wrapper sends empty body (m4).

### Phase 6 — Dashboards + Widget Templates + Blueprints

Dashboards (C7):
- `create_dashboard` internally chains: `POST /views/search` then `POST /views`. Agent never sees the intermediate Search ID.
- Widget templates are `{widget, position, searchType}` triplets — mismatched sets are structurally impossible.
- Client-side pre-validation before emitting: `widgetPositions.keys() == widgets.map(id)`.

Blueprints in the same phase:
- Entirely composed from services layers built in Phases 1–6.
- Blueprint 1 (`setup_app_monitoring_stack`) implemented first — it is the end-to-end integration test.
- Blueprint dry-run returns a list of planned requests with explicit `dependsOn` annotations (C6).

### Phase 7 — Final Hardening

- Tool-description audit (M7): every tool ≤200 chars, discrimination sentence, `<verb>_<domain>_<noun>` naming. Automated diff check as merge gate.
- `list_admin_tools(domain?)` meta-tool if not already landed.
- v7-vs-v6 read-tool smoke tests: deprecated `GET /api/streams` path, histogram fallback chain, event definition list path.
- Coverage report via c8.
- Document `/api/streams` deprecation; plan migration to `/api/streams/paginated` for next milestone.

---

## Engine / Runtime Decision

**Node version bump: Phase 0, not optional.**

Without `t.snapshot()` there is no way to verify dry-run previews are deterministic — the entire safety model for 50+ mutating tools. Keeping `>= 18` defers snapshot tests or requires the experimental flag in perpetuity.

**Recommended:** bump `engines.node` to `>= 22.3.0` in Phase 0. If deployment environment is constrained to Node 20, bump to `>= 20.6.0` and pass `--experimental-test-snapshots`.

---

## High-Risk Endpoints Requiring Explicit Requirements-Phase Planning

| Endpoint | Risk | Design requirement |
|----------|------|--------------------|
| `DELETE /system/indices/index_sets/{id}?delete_indices=true` | Data destruction, async, no undo | Inverted default; second-guardrail confirmation token; async job transcript |
| `DELETE /streams/{id}` | Silent cascade to rules + orphaned pipeline connections | Pre-delete cascade preview; stale-world check on apply |
| `PUT /system/inputs/{inputId}` | Encrypted field zero-out on full-config echo-back | Partial-update shape only; wrapper merges non-encrypted fields |
| `POST /system/pipelines/rule` (apply) | Agent-invented function names cause silent runtime failures | `parse` pre-flight on every dry-run; `simulate` before apply |
| `POST /views` (dashboard create) | Search-link + widget-position integrity failures | Two-step internal chain; widget-template triplet generator |
| `POST /events/definitions?schedule=true` | Live event fires immediately on create | Default `schedule=false`; explicit enable tool |

---

## Tooling Budget Reality

No separate "tool catalog phase" needed. Mitigations are development constraints enforced per-phase:
1. Naming convention `<verb>_<domain>_<noun>` from Phase 0 onward.
2. Description budget: ≤200 chars, discrimination sentence required.
3. `list_admin_tools(domain?)` meta-tool in Phase 6 or 7.
4. Blueprint catalogue separate from CRUD primitives.
5. Phase 7 description audit as the pre-ship gate.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Phase order | HIGH | Three research files independently derive the same dependency graph |
| Foundation design | HIGH | Grounded in concrete in-tree precedent |
| Feature scope per domain | HIGH | Java REST resource classes in local Graylog 7.2 source tree |
| Critical pitfall identification (C1–C7) | HIGH | Each traced to specific Java file:line citation |
| Exact Graylog endpoint paths | MEDIUM | Some inferred from class naming; verify during implementation |
| Node version pin (`>= 22.3.0`) | MEDIUM | Verify actual deployment environment |
| Pipeline DSL builtins count (~100) | MEDIUM | Order-of-magnitude; verify by reading `pipelineprocessor/functions/` |
| `list_input_types` endpoint path | MEDIUM | Inferred from `AbstractInputsResource.java`; confirm in requirements phase |

**Gaps to address in requirements/planning:**
- Confirm `POST /system/pipelines/rule/parse` is the exact server-side validation path.
- Confirm `GET /system/inputs/types/all` is the canonical `list_input_types` endpoint.
- Confirm `create_event_notification` wire-format discriminator strings by reading `@JsonTypeName` annotations.
- Determine whether `test_extractor` has a server-side endpoint in v7.2.
- Decide on exact `engines.node` floor based on actual deployment environment.

---

## Research Flags

| Phase | Research needed? | Reason |
|-------|-----------------|--------|
| Phase 0 — Foundation | No | All decisions settled from in-tree precedent |
| Phase 1 — Inputs/Extractors | Maybe | `test_extractor` endpoint existence unconfirmed |
| Phase 2 — Index Sets | No | C1 prevention clear; retention/rotation shapes are direct-source |
| Phase 3 — Streams | No | Cascade prevention pattern fully specified |
| Phase 4 — Pipelines | Yes | `pipeline-dsl/` builtins catalogue requires a focused pass over ~100 Java function classes |
| Phase 5 — Events | No | v7 shape documented; v6-to-v7 migration helper specified |
| Phase 6 — Dashboards + Blueprints | Maybe | Dashboard DTO shape complexity may benefit from focused `ViewsResource.java` + `WidgetDTO` read |
| Phase 7 — Final Hardening | No | Audit + smoke tests; no new unknowns |
