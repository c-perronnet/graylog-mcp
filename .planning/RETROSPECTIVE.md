# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v3.0.0 — Full Admin Surface

**Shipped:** 2026-05-16
**Phases:** 8 (00→07) | **Plans:** 41 | **Tasks:** 85 | **Calendar days:** 4 | **Commits:** 286 (across 8 `gsd/phase-*` branches)

### What Was Built

- **91-tool MCP admin surface across 9 domains.** Inputs / extractors / index-sets / streams / stream-rules / pipelines / pipeline-rules / events+notifications / dashboards+widgets+blueprints. Every mutating tool defaults to `dryRun: true` and emits a sha-256 confirmation token over canonical state.
- **The C-mitigation library.** Six structural defenses for the highest-blast-radius operations: C1 (`delete_indices` destruction-hash + stats hard-block), C2 (stream-cascade keyed-buckets hash + drift refusal), C3 (encrypted-field STRICT_NO_ECHO on partial-update), C4 (rule-DSL server parse pre-flight), C5 (v6→v7 aggregation visible migration), C7 (dashboard Search+View binding immutability via `.strict()` schema).
- **Single-source cascade-hash primitive** (`src/tools/_shared/cascade-hash.js`) reused across Phase 2/3/5 delete paths with apply-time re-fetch and `cascade_changed_since_preview` refusal.
- **Six cross-domain blueprints** including the headline `setup_app_monitoring_stack` 6-step chain (stream + 2 rules + pipeline + 3 stages + dashboard + 4 widgets + alert) with `dependsOn` placeholder substitution at apply time.
- **Pipeline-rule DSL subsystem** (`src/pipeline-dsl/`) — frozen 133-entry function catalogue + live-overlay merge + RuleLang.g4-correct escape helpers + structured-intent emitter with 8-variant conditions × 6-variant actions via recursive `z.lazy` discriminated unions.
- **Hardening pass + 25 audit-fix follow-up commits** closing every code-review warning across phases 0-6 plus 8 info-level findings (F-15..F-22). c8 coverage baseline 93.58% statements / 79.13% branches / 89.93% functions.

### What Worked

- **Structural-not-procedural safety.** Defaults baked into `defineMutatingHandler` mean `dryRun: true` and writable-gate enforcement happen at the wrapper layer; per-tool authors never have to remember. Same for `idempotencyKey` derivation and `__SERVER_ASSIGNED__` sentinel — once the primitives existed, every later phase composed cleanly against them.
- **Cascade-hash promotion at Phase 3 entry.** The C1 hash lived in `src/tools/index-sets/c1-hash.js` for Phase 2. Promoting it to `src/tools/_shared/cascade-hash.js` with the keyed-buckets `computeCascadeHash` signature BEFORE Phase 3 implementation started meant Phase 3/4/5 delete handlers all shared the same primitive with byte-identical canonicalization. Zero re-fits.
- **STRICT_NO_ECHO partial-update pattern.** Once landed for `update_input` (C3 mitigation, Phase 1), the pattern composed verbatim into `update_index_set`, `update_stream`, `update_pipeline_rule`, `update_event_definition`. Encrypted-field round-trip vulnerabilities became structurally impossible.
- **Multi-cycle audit-fix runs.** /gsd-audit-fix processed 18 findings across 3 runs (5 + 5 + 8), each with isolated executor agents producing minimal-scope fixes with atomic commits. The pipeline halted on no test failures; every fix was reverted-safe.
- **Live-cluster UAT against Graylog 7.0.6** caught the P1 parse-error wire-shape bug (camelCase `positionInLine` + `message` vs actual `position_in_line` + `reason`) that no fixture-based test would have caught. Defensive fallback chains across three pipeline tools fixed it without test regressions.
- **AFK-to-end directive.** Once the user said "go to the end of milestone without me", phases 5/6/7 + close-out executed autonomously with auto-approved checkpoints. The /gsd-execute-phase + /gsd-audit-fix + /gsd-complete-milestone chain produced a shippable milestone with zero human-in-the-loop steps after the directive.

### What Was Inefficient

- **The `audit-open` bin script crashed** with `ReferenceError: output is not defined` during the milestone-close pre-flight audit step. Manual fallback worked, but the workflow assumed a working CLI. (Worth filing upstream against the `get-shit-done` toolchain.)
- **The `milestone complete` CLI emitted ALL phase-summary one-liners verbatim into MILESTONES.md** — including labels like `"Created (7):"` and `"1. Auth-redaction allowlist initially extended..."` that are clearly intermediate notes, not headline accomplishments. Had to rewrite MILESTONES.md by hand to produce a curated 6-headline shape.
- **STATE.md update warnings** about missing `Last Activity` fields suggest the CLI's STATE.md format expectations have drifted from the actual file shape. Non-blocking but noisy.
- **Live cluster mutation tests deferred to UAT.** 8 items across phases (BLUE-01 e2e, Phase 5 v6→v7 alert firing, D-09 race condition, widget visual rendering) blocked on user pre-approval for cluster artifact creation. Not blocking close — but visible work that could ship next milestone given UAT consent.
- **REQUIREMENTS.md drift counting.** PROJECT.md last-updated footer said "85/85 requirements satisfied"; REQUIREMENTS.md canonical traceability table has 71 rows. The discrepancy was reconciled in the audit (the 85 figure includes mid-milestone scope additions like PIPE-13/14 + DSL infra entries). Worth a single source of truth for headcount.

### Patterns Established

- **`_<entityId>` stash on request descriptors.** Started as a Phase 5 WR-02 fix for `delete_event_notification` (stash `_notificationId` instead of regex-extracting from `req.path`); replicated to Phase 3 (`_streamId`) and Phase 2 (`_indexSetId`) via /gsd-audit-fix. Now the canonical pattern for any apply() that needs the entity ID from build().
- **D-09 services-layer boundary.** Blueprints in `src/tools/blueprints/` import ONLY from `src/services/*` — never from other tool handlers. Pinned via grep regression test. Lets blueprint composition stay flat (no recursion through wrapper handlers) and keeps each tool's `defineMutatingHandler` clean.
- **Conditional-spread `omit-vs-spread`** for dry-run preview JSON (`...(condition ? { key: value } : {})`). Preserves agent intent: omit means server-side no-op; explicit value means set. Used throughout STRICT_NO_ECHO partial-updates and informational cascades.
- **Two-layer writable gate.** Wrapper short-circuits non-GET in `defineMutatingHandler`; HTTP client also short-circuits non-GET in `client.request`. Defense in depth — even if a future code path bypasses the wrapper, the client layer catches it.
- **Snapshot-as-API-contract.** Every plan's closing artifact is a frozen snapshot fixture (`test/snapshots/<phase>.test.js.snapshot`) plus a schema-parity assertion. Drift between dry-run JSON and the canonical wire body fails the test immediately.

### Key Lessons

1. **Promote shared primitives early.** The cascade-hash primitive paid off across 4 phases; promoting it at Phase 3 entry meant zero rework. A primitive that lives in one phase's directory becomes harder to extract as more code depends on its in-place shape.
2. **Server-authoritative gates beat client-side validators every time.** `validate.js` (client-side DSL lint) was useful for fast-path rejection on obvious typos, but the M3 acceptance gate (server `POST /system/pipelines/rule/parse`) caught real grammar errors that no static lint would catch. Mirror this for any DSL or schema where the server has a parser.
3. **Live UAT finds bugs fixture tests can't.** The Phase 4 P1 parse-error wire-shape bug (snake_case vs camelCase) was invisible to mocked tests because the mock matched the bug. One live cluster GET against Graylog 7.0.6 caught it.
4. **Structural enforcement > documented convention.** `.strict()` schemas that reject `searchId` from `update_dashboard.changes` make C7 immutability structurally impossible to bypass — no comment is required, no reviewer can miss it, and the test pins it. Same for `dryRun: true` default and idempotency-key derivation.
5. **Cap delays against deadlines, not against constants.** F-11 (await_system_job first-poll cap) was a one-line fix but exposed a real correctness gap: `timeoutMs: 100` was structurally unreachable because the first sleep was 500ms. Any polling loop should compute `Math.min(scheduled, deadline - now())` before sleeping.

### Cost Observations

- Model mix: 100% Opus 4.7 (1M context) — single-model session driven primarily through /gsd-execute-phase and /gsd-audit-fix orchestration.
- Sessions: ~1 session per phase + 3 audit-fix runs + 1 verify-work run + close-out. Roughly 12 logical sessions; the final session ran multi-cycle from /gsd-progress → /gsd-audit-fix × 3 → /gsd-complete-milestone in one continuous context.
- Notable: phase branching (`gsd/phase-{N}-{slug}`) per `.planning/config.json` accumulated 286 commits across 8 branches; the milestone close did NOT merge them back to `main` (deferred at the user's "commit clean and I will push later" instruction).

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v3.0.0    | ~12      | 8      | First milestone with /gsd-audit-fix multi-cycle runs and AFK-to-end autonomous drive |

### Cumulative Quality

| Milestone | Tests     | Coverage (lines)        | Zero-Dep Additions     |
|-----------|-----------|--------------------------|------------------------|
| v3.0.0    | 1076/1076 | 93.58% (c8 baseline)     | 1 dev dep added (c8); 0 new runtime deps |

### Top Lessons (Verified Across Milestones)

_(none yet — verifies across 2+ milestones)_
