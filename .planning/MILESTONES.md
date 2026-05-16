# Milestones

## v3.0.0 Full Admin Surface (Shipped: 2026-05-16)

**Phases completed:** 8 phases (00→07), 41 plans, 85 tasks
**Tests:** 1076/1076 green / 18 suites / c8 baseline 93.58% statements / 79.13% branches / 89.93% functions
**Tool surface:** 27 → 91 MCP tools across 9 admin domains
**Code churn:** 286 commits on `gsd/phase-*` branches; +97,038 / −4,289 lines across 353 files; +17,903 src LOC + +24,881 test LOC
**Timeline:** 2026-05-13 → 2026-05-16 (4 calendar days)
**Requirements:** 71/71 v1 requirements covered (zero gaps per `v3.0.0-MILESTONE-AUDIT.md`)
**Known deferred items at close:** 11 (8 live-cluster-mutation, 2 visual-only, 1 doc-drift — none blocking; see `STATE.md → Deferred Items` and `VERIFY-WORK-02-06-REPORT.md`)

### Key accomplishments

1. **91-tool MCP admin surface across 9 domains** — inputs, extractors, index-sets, streams, stream-rules, pipelines, pipeline-rules, events/notifications, dashboards/widgets/blueprints. Every mutating tool defaults to `dryRun: true`, returns a cryptographic confirmation token over the dry-run state, and refuses apply on drift between preview and execution.

2. **The C-mitigation library** — six structural defenses for the highest-blast-radius operations: **C1** `delete_indices` destruction-hash + stats-unreachable hard-block; **C2** stream-delete cascade-hash (rules + pipeline connections + event defs); **C3** encrypted-field zero-prevention on partial-update via STRICT_NO_ECHO; **C4** rule-DSL parse pre-flight via `POST /api/system/pipelines/rule/parse`; **C5** v6→v7 aggregation-syntax migration visible in dry-run; **C7** dashboard internal-Search-binding immutability via `.strict()` schema rejection.

3. **Single-source cascade-hash primitive** (`src/tools/_shared/cascade-hash.js`) reused across Phase 2/3/5 delete paths with apply-time re-fetch + recompute + `cascade_changed_since_preview` refusal — preventing TOCTOU corruption when the cascade changes between dry-run and apply.

4. **Six cross-domain blueprints**, headlined by `setup_app_monitoring_stack` — a single tool call producing a full monitoring environment (stream + 2 rules + pipeline + 3 stages + dashboard + 4 widgets + alert) via a 6-step Search-aware chain with `dependsOn` placeholder substitution at apply time. C7 mitigation preserved through the composite Search+View step.

5. **Pipeline-rule DSL subsystem** (`src/pipeline-dsl/`) — frozen 133-entry function catalogue + live-overlay merge + `RuleLang.g4`-correct escape helpers + structured-intent emitter (8-variant conditions × 6-variant actions via recursive `z.lazy` discriminated unions). Server-authoritative parse pre-flight is the M3 acceptance gate; `simulate_pipeline_rule` surfaces post-rule message state.

6. **Hardening pass + audit-fix discipline** — `list_admin_tools` meta-tool for agent orientation, 79 tool descriptions rewritten to ≤200 chars under an automated audit-script gate, c8 coverage baseline locked, v7.2-vs-v6 read-tool smoke tests, and **25 audit-fix follow-up commits** closing every code-review warning across phases 0-6 plus 8 info-level findings (`F-15..F-22`).

### Technical debt / deferred

- 8 live-cluster mutation tests blocked on UAT consent (BLUE-01 e2e apply, Phase 5 v6→v7 alert firing, Phase 5 D-09 race condition, etc.) — listed in HUMAN-UAT.md files per phase.
- 2 visual-only verifications (widget template rendering, dashboard UX) — out of scope for an MCP server.
- 1 doc drift: research's "IndexRangesUpdateJob" is conceptual; actual class on 7.0.6 is `SetIndexReadOnlyAndCalculateRangeJob` (wrapper documents it correctly).
- Phase 4 IN-02 (duplicate `preflightParseRule` shape) and Phase 4 IN-06 (regex hardening) deferred — manual judgment calls flagged for next milestone.
- `src/query.js` + `src/events.js` (v2.3 read tools) bypass `src/graylog/client.js`. HARD-05 migration plan written; deferred deletion in favor of the v7.2 read surface that now uses `/api/views/search/sync`.

### Archived artifacts

- `.planning/milestones/v3.0.0-ROADMAP.md` — full phase-by-phase narrative
- `.planning/milestones/v3.0.0-REQUIREMENTS.md` — 71-row traceability table with final status
- `.planning/milestones/v3.0.0-MILESTONE-AUDIT.md` — read-only audit (verdict: passed)
- `.planning/VERIFY-WORK-02-06-REPORT.md` — live cluster UAT against Graylog 7.0.6
- `.planning/phases/0X-*/0X-SUMMARY.md` × 41 — per-plan summaries (still in place; not yet archived to `milestones/v3.0.0-phases/`)

---
