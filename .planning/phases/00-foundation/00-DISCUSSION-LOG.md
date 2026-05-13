# Phase 0: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-13
**Phase:** 0-foundation
**Areas discussed:** Node version floor, Existing tool naming, Existing test migration, Connection write-toggle

---

## Gray-Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Node version floor | FOUND-06: bump engines.node to >= 22.3.0 (stable t.snapshot) vs >= 20.6.0 (minimum, snapshot experimental) | ✓ |
| Existing tool naming | Apply `<verb>_<domain>_<noun>` to existing v2.3 tool names? Rename / alias / status quo | ✓ |
| Existing test migration | Migrate 4 existing test-*.js to node:test in Phase 0 or only use node:test for new admin tests | ✓ |
| Connection write-toggle | Add optional `writable: false` flag per connection on top of per-call dryRun | ✓ |

**User selected:** All four

---

## Node version floor

| Option | Description | Selected |
|--------|-------------|----------|
| Node 22.x (Recommended) | Bump engines.node to >= 22.3.0. t.snapshot() is stable; no flags needed. Current LTS line. | ✓ |
| Node 20.x only | Bump engines.node to >= 20.6.0. Pass --experimental-test-snapshots in test scripts. Slight maintenance friction but supports older infra. | |
| Whatever — you decide | Default to 22.3.0; if a deploy blocker shows up later we drop to 20.6.0. (Claude's Discretion.) | |

**User's choice:** Node 22.x — `engines.node >= 22.3.0`, no experimental flags
**Notes:** Cleanest path; no flag maintenance.

---

## Existing tool naming

| Option | Description | Selected |
|--------|-------------|----------|
| Aliases (Recommended) | Both names route to the same handler. No client breakage; old names get a deprecation note. ~30 lines of alias registration. | |
| Hard rename | Rename existing tools to fit the convention. Breaking change for existing MCP clients/configs. Cleanest, riskiest. | ✓ |
| Status quo | Apply convention only to new admin tools; leave existing names inconsistent. No breakage, mixed catalogue. | |
| You decide | Claude's Discretion. | |

**User's choice:** Hard rename — all existing tools get renamed; major version bump to v3.0.0 on milestone completion
**Notes:** User explicitly chose the breaking-change path over the recommended alias option. Cleanliness over backward compat for this milestone.

---

## Existing test migration

| Option | Description | Selected |
|--------|-------------|----------|
| Migrate all to node:test (Recommended) | Convert the 4 scripts to node:test format; npm test runs the full suite. ~half a day. One runner, consistent. | ✓ |
| Co-existence | Keep the 4 standalone scripts as-is; add node:test for new admin tests. Fix npm test to run both. Two-runner footprint. | |
| Migrate selectively | Migrate test-clustering.js (most complex, uses test seams) now; leave the 3 simpler scripts for later cleanup. | |

**User's choice:** Migrate all to node:test
**Notes:** Phase 0 absorbs the migration cost so there's one runner going forward.

---

## Connection write-toggle

| Option | Description | Selected |
|--------|-------------|----------|
| Add it (Recommended) | Connection config gets `writable: true|false` (defaults to true). If false, every mutating tool errors before request build. ~30 lines in defineMutatingHandler. | ✓ |
| Defer it | Stay with per-call dryRun only this milestone. Add the toggle in a follow-up. | |
| Make it explicit and required | Connection MUST declare `writable: true` to support mutations. No backward-compat default. Strictest. | |

**User's choice:** Add it (optional, default true)
**Notes:** Second safety layer alongside the per-call dryRun default. Optional + default-true preserves backward compat with existing configs.

---

## Wrap-up

| Option | Description | Selected |
|--------|-------------|----------|
| I'm ready for context (Recommended) | Write CONTEXT.md with what we have and move to planning. | ✓ |
| Explore more gray areas | More decisions to dig into before locking in. | |

**User's choice:** Ready for context — proceed to write CONTEXT.md.

---

## Claude's Discretion

The following Phase 0 implementation details were not surfaced as discussion items; the planner has flexibility (see Discretion-01..06 in CONTEXT.md):

- Exact module layout for `src/dispatch.js` integration with existing `src/index.js`
- Exact shape of the `defineMutatingHandler({build, apply})` factory contract
- Whether Phase 0 includes any `src/services/<domain>.js` stubs
- Snapshot-test "auto-accept on first run" vs strict failure default
- zod schema co-location pattern (per-domain `schemas.js` recommended by research)
- Dispatch startup-assertion failure mode (throw vs log)

## Deferred Ideas

Captured in CONTEXT.md `<deferred>` section:

- Connection-level role discovery / proactive 403 surfacing UX
- OpenAPI-style codegen if `api-specs/` ever fills out upstream
- Deeper request-scoped connection refactor (singleton replacement)
- Snapshot-test auto-acceptance script
- Existing-tool naming aliases — explicitly rejected; documented so future arguments link the rationale
