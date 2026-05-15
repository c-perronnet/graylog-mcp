# Phase 2: Index Sets & Retention - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-15
**Phase:** 02-index-sets-retention
**Areas discussed:** Confirmation token, await_system_job polling, Strategy FQCN aliasing, Create defaults, cycle_deflector behavior, Update strategy partial-update, Stats failure handling

---

## Confirmation token (delete_index_set with deleteIndices=true)

| Option | Description | Selected |
|--------|-------------|----------|
| Hash of `{indexSetId, deleteIndices, indexCount, messageCount}` | Deterministic stateless hash; agent echoes back on apply; mismatch refuses | ✓ |
| Server-side ephemeral token with TTL | Random token in MCP memory with ~5min TTL; replay-resistant; breaks across process restarts | |
| Echo back index set title or "I UNDERSTAND" | Human-readable phrase; less protection against agent confusing index sets | |

**User's choice:** Hash of `{indexSetId, deleteIndices, indexCount, messageCount}`
**Notes:** Stateless, no MCP-side memory, survives process restarts. Re-validates server-side state implicitly — anything changes between dry-run and apply, apply refuses.

---

## await_system_job polling

| Option | Description | Selected |
|--------|-------------|----------|
| Blocking with exp backoff + timeout | 500ms→1s→2s→4s→5s cap; default 60s timeout; returns final status | ✓ |
| Single-poll, agent loops itself | Returns status once; agent owns retry | |
| Configurable: agent picks blocking or single-poll | `wait: boolean` (default true); most flexible | |

**User's choice:** Blocking with exp backoff + timeout
**Notes:** Cleanest agent API. Caveat: long jobs tie up the agent for the wait window — mitigated by the 60s default timeout.

---

## Strategy FQCN aliasing

| Option | Description | Selected |
|--------|-------------|----------|
| Friendly aliases only | `time-based`/`size-based`/`message-count` etc.; wrapper maps to FQCN | ✓ |
| FQCN only | Agent passes Java class names literally; matches input-type FQCN pattern from Phase 1 | |
| Both — accept alias or FQCN | Zod union; most permissive but ambiguous | |

**User's choice:** Friendly aliases only
**Notes:** Mirrors Graylog UI; cleaner tool descriptions. Closed enum so `z.enum(...)` strict validation. Input-type pattern (FQCN-first) doesn't carry forward here because the input-type set is open (plugins); the strategy set is closed.

---

## Create defaults (rotation/retention)

| Option | Description | Selected |
|--------|-------------|----------|
| Require explicit | Both strategy + config required fields; no defaults; agent makes an informed choice | ✓ |
| Conservative defaults: time-based 1d + delete 30 indices | Defaults for the common case | |
| Mirror Graylog UI defaults: size-based 1GB + delete 20 indices | Familiar to Graylog operators | |

**User's choice:** Require explicit
**Notes:** Destruction policies must never be defaulted. Aligns with the project's "explicit > implicit" safety stance.

---

## cycle_deflector behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Return job_id; agent calls await_system_job | Fire-and-decoupled; matches delete_index_set+deleteIndices=true pattern | ✓ |
| Auto-await with `wait: true` default | One-step ergonomics; ties up agent during rotation | |
| Configurable per-call | Doubles surface | |

**User's choice:** Return job_id; agent calls await_system_job
**Notes:** Uniform async envelope shape across all Phase 2 mutating tools that trigger system jobs.

---

## Update strategy partial-update

| Option | Description | Selected |
|--------|-------------|----------|
| Replace-only for strategies | If `rotation_strategy` in `changes`, require `rotation_strategy_config` too — atomic | ✓ |
| Field-level partial-update for strategy config | Maximum flexibility; risks mixing class A config into class B | |

**User's choice:** Replace-only for strategies
**Notes:** Top-level fields (title, description, default, regular) still field-level partial-update. Strategy + its config are atomic to prevent crashing Graylog with mixed-class configs.

---

## Stats failure handling

| Option | Description | Selected |
|--------|-------------|----------|
| Block dry-run with clear error | If stats fail, dry-run returns `isError: true, reason: stats_unreachable`; no token issued | ✓ |
| Issue token with `messageCount: 'unknown'` | Dry-run proceeds with warning; weaker safety | |
| Fall back to indexCount only (skip stats) | Operationally robust but message-count protection lost | |

**User's choice:** Block dry-run with clear error
**Notes:** Deliberate safety override of operational robustness. Don't soften later. Agent must investigate Elasticsearch health before destructive operations.

---

## Claude's Discretion

- Module layout under `src/tools/index_sets/`; alias-to-FQCN map location.
- Whether `list_rotation_strategies`/`list_retention_strategies` discovery tools ship (recommendation: no, tool descriptions suffice).
- Exact `await_system_job` input shape (recommendation: forgiving — accept either jobId or the full async-envelope from a prior tool's response).
- Snapshot fixture set design.
- Whether `await_system_job` lives in `src/tools/_shared/system-job.js` (recommended — cross-domain primitive) or under `src/tools/index_sets/`.

## Deferred Ideas

- Archive retention strategy (Graylog Enterprise; reject as "not yet supported")
- Strategy discovery tools (tool descriptions suffice for now)
- Per-index-set messageCount in `list_index_sets` (expensive N stats calls)
