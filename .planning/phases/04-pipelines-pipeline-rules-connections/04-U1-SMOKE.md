---
phase: 04-pipelines-pipeline-rules-connections
plan: 01
decision: D-16
result: UNREACHABLE_STRICT_NO_ECHO
date: 2026-05-15
---

# Phase 04 U1-Style Live-Smoke: D-16 Partial-Update Decision

**Date:** 2026-05-15
**Plan:** 04-01 — Task 1
**Target Graylog instance:** `http://<graylog-host>:9000` (Graylog 7.0.6 per PROJECT.md; 7.2.0-SNAPSHOT source-of-truth reference)
**Smoke environment:** Plan-04-01 executor (sequential) in the project working tree.
**Scope:** Decision applies to BOTH `update_pipeline` (Plan 02 / PIPE-04) AND `update_pipeline_rule` (Plan 03 / PIPE-09).

## Result

**UNREACHABLE_STRICT_NO_ECHO** — no API token is available to this executor (no
`~/.graylog-mcp/config.json`, no `GRAYLOG_CONFIG_PATH` override, no project-local
config), so the partial-PUT smokes against `<graylog-host>:9000` cannot be
performed without firing unauthenticated probes. Per the precedent set by both
`02-U1-SMOKE.md` (UNREACHABLE_DEFAULT_MERGE for `update_index_set` —
encrypted-field shape forced the wider pattern there) and `03-U1-SMOKE.md`
(UNREACHABLE_STRICT_NO_ECHO for `update_stream` + `update_stream_rule` — no
encrypted fields), the safe-default branch fires here: STRICT_NO_ECHO is locked
for Plan 02 (`update_pipeline`) AND Plan 03 (`update_pipeline_rule`).

## Decision Matrix (from RESEARCH §"Pattern 5: U1-Style Live-Smoke Decision Artifact (D-16)" lines 462-474)

| Outcome | Wire response | Decision | Selected |
| ------- | ------------- | -------- | -------- |
| 200 OK, returned DTO shows ONLY the title changed | partial PUT accepted; server applies non-null overrides over current state | `STRICT_NO_ECHO` — emit only the agent's `changes.*` fields | — |
| 400 / 422 "missing required field: source" | server's DTO deserializer rejects partial body | `MERGE_FROM_CURRENT` — wrapper GETs current pipeline, deep-merges agent's `changes.*`, PUTs the full body | — |
| `UNREACHABLE` (no live token) | smoke cannot be empirically run | Default to `STRICT_NO_ECHO` per Phase 3 `03-U1-SMOKE.md` precedent — smaller wire body, no encrypted-field zero-out surface | **CHOSEN** |

## Procedure

The smoke executor MUST source an API token from `~/.graylog-mcp/config.json`
per `<u1_smoke_protocol>` step 1. Paths checked:

- `~/.graylog-mcp/config.json` — **NOT FOUND** (no such file in the executor's HOME)
- `/home/yolo/.graylog-mcp/config.json` — NOT FOUND
- `$GRAYLOG_CONFIG_PATH` env override — unset
- Project-local `.graylog-mcp/config.json` — does not exist

No API token is available. Per `<u1_smoke_protocol>` "no matching connection
exists" branch — also confirmed by both `02-U1-SMOKE.md` and `03-U1-SMOKE.md`
precedents — the executor skips the authenticated probe sequence rather than
fire 401s against the live instance. Smoke calls (a) `GET
/api/system/pipelines/pipeline` for an editable target, (b) partial PUT against
`/api/system/pipelines/pipeline/{id}` with a no-op rename body, and (c) status-
code inspection are all SKIPPED. Same for the rule-side smoke against
`/api/system/pipelines/rule/{id}`.

Probe commands NOT executed (documented for reproducibility once a token is
available):

```bash
# a) list pipelines, find an editable non-default candidate
curl -s -u "$TOKEN:token" http://<graylog-host>:9000/api/system/pipelines/pipeline

# b) minimal partial PUT — wire body = only the field the agent "changed"
curl -X PUT -u "$TOKEN:token" \
    -H "Content-Type: application/json" \
    -H "X-Requested-By: graylog-mcp" \
    -d '{"title": "<current_title>"}' \
    http://<graylog-host>:9000/api/system/pipelines/pipeline/<editable_id>

# c) inspect status: 200/204 → STRICT_NO_ECHO; 400 missing-required → MERGE_FROM_CURRENT

# Same shape for rule:
curl -X PUT -u "$TOKEN:token" \
    -H "Content-Type: application/json" \
    -H "X-Requested-By: graylog-mcp" \
    -d '{"description": "<new desc>"}' \
    http://<graylog-host>:9000/api/system/pipelines/rule/<editable_id>
```

The instance at `<graylog-host>:9000` is HTTP-reachable (Phase 2's `02-U1-SMOKE.md`
positively identified a live Graylog server via 401 response). The reachability
question is settled; only the credential question blocks the smoke.

## Implications for Plan 02 (update_pipeline / PIPE-04)

**Pattern:** **STRICT_NO_ECHO**.

Plan 02 Task 2 (`update_pipeline` handler) MUST build the wire body from
`args.changes` ONLY. The wrapper does NOT echo `current.*` fields on the wire.
The expectation, supported by source-code evidence in `PipelineResource.java`,
is that Graylog's `PipelineSource` deserializer accepts a wire body with only
the changed fields.

Rationale:

1. **No encrypted fields on a pipeline.** Verified against
   `source-code/.../PipelineSource.java` — the record fields are
   `id, _scope, title, description, source, created_at, modified_at, stages,
   errors, has_deprecated_functions`. None carry an `is_encrypted: true`
   annotation. C3 (encrypted-field zero-out on update) is NOT reachable.
2. **Smaller wire bytes** on the typical "rename a pipeline" / "edit pipeline
   source" path.
3. **Consistent with Phase 1 + Phase 3 D-12.** `update_input` (Plan 01-02) and
   `update_stream` (Plan 03-02) both ship STRICT_NO_ECHO. Matching it for
   `update_pipeline` keeps a single cross-phase mental model.
4. **Reversible if smoke later proves merge required.** STRICT_NO_ECHO → MERGE
   is a wire-additive change (the merged body is a strict superset of the
   strict-no-echo body); the dry-run JSON only gains `body` keys. No back-compat
   break for agents already round-tripping the dry-run preview.

## Implications for Plan 03 (update_pipeline_rule / PIPE-09)

**Pattern:** **STRICT_NO_ECHO**.

Plan 03 Task 2 (`update_pipeline_rule` handler) MUST build the wire body from
`args.changes` ONLY. The 4 mutable fields (`source`, `description`,
`rule_builder`, `simulator_message`) are all unencrypted; STRICT_NO_ECHO is
wire-safe.

**Special note on `simulator_message` (Nullable String):** Rules carry
`simulator_message` as a `Nullable String` field per `RuleSource.java`. This
field CAN be intentionally cleared by the agent. STRICT_NO_ECHO preserves that
intent precisely:

- Agent omits `simulator_message` from `changes` → wrapper omits from wire body
  → server-side: no-op for that field (current value preserved).
- Agent passes `simulator_message: null` in `changes` → wrapper emits
  `simulator_message: null` on the wire → server-side: explicit clear.

A MERGE_FROM_CURRENT approach would conflate these two semantics — a null in the
merged body could mean either "agent did not touch it" (echoed from current,
which is itself null) or "agent wants to clear it" (explicit). STRICT_NO_ECHO
disambiguates structurally: omission means no-op, explicit null means clear.

## Hand-off Line

> Plans 02 + 03 lock STRICT_NO_ECHO wire-build pattern (no merge-from-current).
> If the live instance later falsifies this via 400 "missing required field"
> responses, the wrapper widens toward merge-from-current — strict-no-echo body
> is a strict subset of merge body, no back-compat break.

## Branch Inputs for Downstream Plans

| Plan  | Field                                       | Value                                                                                               |
| ----- | ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 04-02 | update_pipeline wire-build approach         | **STRICT_NO_ECHO**                                                                                  |
| 04-03 | update_pipeline_rule wire-build approach    | **STRICT_NO_ECHO** (preserves explicit-null clear semantics for `simulator_message` Nullable String) |

Both decisions are safe defaults. If the live instance is later reached and
strict-no-echo is empirically falsified by HTTP 400 responses, the wrapper can
widen each toward merge-from-current additively without breaking back-compat.

## Auth Hygiene

No API token and no auth header appears in this artifact. Probe commands shown
in §Procedure are documented for reproducibility but were NOT executed by the
Plan-04-01 executor.
