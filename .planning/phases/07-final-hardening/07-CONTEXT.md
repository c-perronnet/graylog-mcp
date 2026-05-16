# Phase 7: Final Hardening - Context

**Gathered:** 2026-05-16 (auto-resolved under user "continue to milestone end without me" directive)
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 7 hardens the ~90-tool admin surface: tool-description audit (HARD-01), discoverability meta-tool (HARD-02), v7-vs-v6 smoke test (HARD-03), coverage baseline (HARD-04), `/api/streams` deprecation doc (HARD-05). 5 HARD-XX requirements.

This is the milestone-closing phase. No new domain logic; pure polish, audit, and merge-gate infrastructure.

</domain>

<decisions>
## Implementation Decisions

### HARD-01: Tool-description audit + merge-gate (ROADMAP SC1)

- **D-01:** Audit every tool description in `src/tools.js` — pass if ≤200 chars AND contains a discrimination sentence ("use this vs the obvious alternative"). The audit script lives at `scripts/audit-tool-descriptions.js`; CI / pre-commit hook fails any PR that adds a tool description over budget or missing the discrimination sentence.
- **D-02:** Discrimination sentences follow the form "Use this when X; not <alternative>." or contain "vs", "instead of", "rather than", "as opposed to". Detection: regex match on the description string.
- **D-03:** Where existing descriptions exceed 200 chars OR lack the discrimination sentence, Plan 02 trims/rewrites them. This is a wholesale audit-and-fix; no tool ships in Phase 7 with a non-compliant description.

### HARD-02: list_admin_tools meta-tool (ROADMAP SC2)

- **D-04:** `list_admin_tools({connectionName?, domain?})` is a meta-tool that returns the catalogue grouped by domain. Optional `domain` filters to one of `inputs | extractors | index-sets | streams | stream-rules | pipelines | pipeline-rules | events | notifications | dashboards | widgets | blueprints`. Output is the agent-facing brief: `[{name, description (≤200 chars), domain}]`.
- **D-05:** Implementation: read `src/tools.js` toolDefinitions at module init; group by name prefix or by an explicit `domain` field added to each tool. Per CLAUDE.md "no web UI", this is a pure JSON response tool. Routes through `defineListHandler`.

### HARD-03: v7-vs-v6 read-tool smoke (ROADMAP SC3)

- **D-06:** Smoke-test pass against Graylog 7.0.6 live instance covers the 25 v2.3 read tools (fetch_graylog_messages, get_log_histogram with all 4 fallback strategies, get_event_definitions, etc.). Each tool gets a smoke-fixture or live-call test. Any v7 breakage is documented as a targeted fix, not a refactor.
- **D-07:** If live instance unreachable, the smoke-test pass uses recorded HTTP fixtures from past phases (Plan 01-04 U1-SMOKE artifacts, etc.). Bonus path is live capture; default is fixture-based.

### HARD-04: c8 coverage baseline (ROADMAP SC4)

- **D-08:** `c8 node --test` produces a coverage report; baseline coverage % documented in `.planning/MILESTONE-SUMMARY.md` and committed. No coverage target set this milestone — purely baseline-establishment. CI does NOT fail on coverage drop (future milestone).
- **D-09:** Add `coverage` script to package.json: `c8 --reporter text --reporter lcov node --test 'test/**/*.test.js'`. Add `c8` as a devDependency (this is the ONE allowed new dependency this milestone — it's a dev-only tool, no runtime impact).

### HARD-05: /api/streams deprecation doc

- **D-10:** Write `.planning/MIGRATION-streams-paginated.md` documenting:
  - Current usage of bare `/api/streams` in `src/handlers.js` (v2.3 listStreamsHandler, now displaced by Phase 3 list_streams)
  - The deprecated bare path still works in 7.0.6 but emits a warning
  - Migration plan: replace `/api/streams` with `/api/streams/paginated` in the v2.3 handler chain in a follow-up milestone
  - Acceptance: this milestone ships the documentation only; no code change.

### Cross-cutting

- **D-11:** Final milestone artifact `.planning/MILESTONE-SUMMARY.md` documents: total tool count, requirements coverage (all FOUND/INPUT/INDEX/STREAM/PIPE/EVENT/DASH/BLUE/HARD), test count, coverage %, list of all HUMAN-UAT items still outstanding for `/gsd-verify-work`.
- **D-12:** Phase 7 ships exactly 1 new tool: `list_admin_tools` (HARD-02). Tool count: 90 → 91. The other 4 HARDs are infrastructure / docs / audit.

### Claude's Discretion (auto-resolved)

- **Discretion-01:** Where the audit script lives — `scripts/audit-tool-descriptions.js` (recommended; new directory).
- **Discretion-02:** Whether c8 is the only new dep — yes, recommended. No other dependencies added.
- **Discretion-03:** Snapshot fixtures for HARD-02 — 1-2 fixtures (full catalogue snapshot + domain-filtered).

</decisions>

<canonical_refs>
- .planning/PROJECT.md, .planning/REQUIREMENTS.md (HARD-01..05), .planning/ROADMAP.md §"Phase 7"
- .planning/research/PITFALLS.md §M7 (token bloat — drives D-04 meta-tool)
- src/tools.js (audit target)
- src/handlers.js (v2.3 read tools — HARD-03 smoke target)
- src/tools/_shared/list.js (defineListHandler — HARD-02 wrapper)
- package.json (add c8 + coverage script)
- All prior phase SUMMARYs for milestone artifact aggregation

</canonical_refs>

<code_context>
Phase 7 is mostly polish + audit + meta. No new domain modules; one new tool surface (list_admin_tools); one new dev-dep (c8).

</code_context>

<specifics>
- HARD-01 audit script must catch existing non-compliant descriptions (long ones from earlier phases) and surface a clear fix list.
- HARD-02 should output the catalogue at TOKEN-EFFICIENT scale — descriptions truncated to first 100 chars per entry if needed.
- HARD-04 baseline is informational; do NOT add a coverage threshold gate.

</specifics>

<deferred>
- /api/streams migration to /api/streams/paginated (documented, not executed; HARD-05 ships docs only)
- Coverage threshold gates in CI (future milestone)
- E2E live-cluster smoke for HARD-03 (default to fixture-based; live path is bonus)

</deferred>

---

*Phase: 07-final-hardening*
*Context auto-gathered: 2026-05-16*
