---
phase: 03-streams-stream-rules
plan: 01
decision: D-14
result: UNREACHABLE_STRICT_NO_ECHO
date: 2026-05-15
---

# 03-U1-SMOKE — U1 (partial PUT) Live-Smoke Decision for `update_stream` + `update_stream_rule`

**Date:** 2026-05-15
**Plan:** 03-01 — Task 1
**Target Graylog instance:** `http://<graylog-host>:9000` (Graylog 7.0.6 per PROJECT.md)
**Smoke environment:** Plan-03-01 executor (sequential) in the project working tree.

## Result

**UNREACHABLE_STRICT_NO_ECHO** — no API token is available to this executor (no
`~/.graylog-mcp/config.json` and no `GRAYLOG_CONFIG_PATH` override), so the
partial-PUT smoke against `<graylog-host>:9000` cannot be performed without firing
unauthenticated probes. Per the precedent set by `02-U1-SMOKE.md`
(UNREACHABLE_DEFAULT_MERGE for Phase 2's `update_index_set`), the safe-default
branch fires: STRICT_NO_ECHO is locked for Plan 02 (`update_stream`) and Plan 04
(`update_stream_rule`).

## Procedure

The smoke executor MUST source an API token from `~/.graylog-mcp/config.json` per
`<u1_smoke_protocol>` step 1. Paths checked:

- `~/.graylog-mcp/config.json` — **NOT FOUND** (no such file in the executor's HOME)
- `/home/yolo/.graylog-mcp/config.json` — NOT FOUND
- `$GRAYLOG_CONFIG_PATH` env override — unset
- Project-local `.graylog-mcp/config.json` — does not exist

No API token is available. Per `<u1_smoke_protocol>` "no matching connection
exists" branch — also confirmed by `02-U1-SMOKE.md` precedent — the executor
skips the authenticated probe sequence rather than fire 401s against the live
instance. Smoke calls (a) `GET /api/streams` for an editable target, (b) `PUT
/api/streams/{id}` with a no-op rename body, and (c) status-code inspection are
all SKIPPED.

Probe commands NOT executed (documented for reproducibility once a token is
available):

```bash
# a) list streams, find an editable non-default candidate
curl -s -u "$TOKEN:token" http://<graylog-host>:9000/api/streams

# b) minimal partial PUT — wire body = only the field the agent "changed"
curl -X PUT -u "$TOKEN:token" \
    -H "Content-Type: application/json" \
    -H "X-Requested-By: graylog-mcp" \
    -d '{"title": "<current_title>"}' \
    http://<graylog-host>:9000/api/streams/<editable_id>

# c) inspect status: 200/204 → STRICT_NO_ECHO; 400 missing-required → MERGE_FROM_CURRENT
```

The instance at `<graylog-host>:9000` is HTTP-reachable (confirmed by Phase 2's
`02-U1-SMOKE.md` — unauthenticated probe returned HTTP 401, which positively
identifies a live Graylog server). The reachability question is settled; only
the credential question blocks the smoke.

## Implications for Plan 02 (update_stream)

**Pattern:** **STRICT_NO_ECHO** (same as Phase 1's `update_input` per D-12).

Plan 02 Task 2 (`update_stream` handler) MUST build the wire body from
`args.changes` ONLY. The wrapper does NOT echo `current.*` fields on the wire.
The expectation, supported by source-code evidence in
`03-RESEARCH.md §Pattern 6`, is that Graylog's `UpdateStreamRequest`
deserializer accepts a wire body with only the changed fields (every property is
`@Nullable`; the server applies non-null overrides over the current stream state
via `streamService.update`).

Rationale for the safe-default choice (per `03-RESEARCH.md §Pattern 6`
recommendation):

1. **No encrypted fields on a stream.** Verified by `03-RESEARCH.md §"StreamResponse Shape"`
   — no `is_encrypted: true` annotation anywhere. C3 (encrypted-field zero-out
   on update) is NOT reachable through this surface, but the strict-no-echo
   invariant ("preview emits ONLY the changed field") is generally useful for an
   agent reviewing dry-runs.
2. **Smaller wire bytes** on the typical "rename a stream" / "flip
   matching_type" path.
3. **No pre-flight GET cost** is added by the partial-update logic itself.
   D-09's mutable pre-flight still fires regardless, but the partial-update
   construction does not consume the result.
4. **Consistent with Phase 1.** `update_input` ships STRICT_NO_ECHO; matching it
   for `update_stream` reduces the cross-phase mental model for the agent.

If the live instance is later reachable and the wire empirically rejects the
strict-no-echo path with HTTP 400 "missing required field", the wrapper can
widen toward merge-from-current without a back-compat break (the strict-no-echo
wire body is a subset of merge-from-current; the agent's dry-run JSON gains
optional `body` keys but the dry-run preview JSON shape — `{ method, path, body }`
— stays valid).

## Implications for Plan 04 (update_stream_rule)

**Pattern:** **STRICT_NO_ECHO**.

Plan 04 Task 2 (`update_stream_rule` handler) MUST build the wire body from
`args.changes` only. Per `03-RESEARCH.md §"Endpoint Catalogue"` row 10,
Graylog's `PUT /api/streams/{streamId}/rules/{ruleId}` consumes the
`CreateStreamRuleRequest` DTO — the SAME shape as create — with no separate
"Update" DTO. The 5 fields (`type`, `value`, `field`, `inverted`, `description`)
are unencrypted; STRICT_NO_ECHO is wire-safe.

**Caveat (CreateStreamRuleRequest.type is non-nullable Java `int`):**
`CreateStreamRuleRequest.type()` is a primitive int in the Java DTO — meaning
the deserializer requires the `type` field on every PUT, even if the agent did
not "change" it. The wrapper MUST therefore emit `type: current.type` from the
pre-flight `GET /api/streams/{streamId}/rules/{ruleId}` result on every update,
even when `args.changes` omits it. This is the ONLY field where strict-no-echo
"echoes back current" out of structural necessity. Plan 04 Task 2's build()
should:

```javascript
const current = await client.request("GET", `/api/streams/${args.streamId}/rules/${args.ruleId}`, null);
const wireBody = {
    type: current.type, // non-nullable Java int — echo from current unconditionally
    ...args.changes,    // strict no-echo for the remaining 4 fields
};
```

Note: this is structurally the same trick Plan 02-02's `update_index_set` uses
for `index_prefix` + `creation_date` (immutable server-required fields) — except
here it's a single non-nullable field (`type`) and the agent CAN change it in
principle (`type` is logically mutable from a string discriminator standpoint,
but Graylog rarely rewrites rule types in place; agents typically delete + create
when changing rule type).

## Fallback rationale

Why STRICT_NO_ECHO is the safe default when U1 cannot be empirically falsified:

1. **No encrypted fields on streams or stream rules.** The C3 pitfall (encrypted
   field zero-out on update) is not reachable through either surface — verified
   against `StreamResponse.java` and `CreateStreamRuleRequest.java` in
   `03-RESEARCH.md §"Endpoint Catalogue"`.
2. **Smaller wire bytes.** A `update_stream(title: "X")` call emits 1 field on
   the wire under STRICT_NO_ECHO vs. 5+ fields under MERGE_FROM_CURRENT.
3. **Consistent with Phase 1 D-12.** `update_input` (Plan 01-02) shipped
   STRICT_NO_ECHO. Matching it for streams + stream rules avoids two patterns
   for "partial update" in adjacent phases — the agent's mental model gets
   simpler.
4. **Reversible if smoke later proves merge required.** STRICT_NO_ECHO → MERGE
   is a wire-additive change (the merged body is a strict superset of the
   strict-no-echo body); the dry-run JSON only gains `body` keys. No
   back-compat break for agents already round-tripping the dry-run preview.

## Branch Inputs for Downstream Plans

| Plan  | Field                                       | Value                                                       |
| ----- | ------------------------------------------- | ----------------------------------------------------------- |
| 03-02 | update_stream wire-build approach           | **STRICT_NO_ECHO**                                          |
| 03-04 | update_stream_rule wire-build approach      | **STRICT_NO_ECHO** (with `type` echo per CreateStreamRuleRequest.type non-nullable caveat) |

Both decisions are safe defaults. If the live instance is later reached and
strict-no-echo is empirically falsified by HTTP 400 responses, the wrapper can
widen each toward merge-from-current additively without breaking back-compat.

## Auth Hygiene

No API token and no auth header appears in this artifact. Probe commands shown
in §Procedure are documented for reproducibility but were NOT executed by the
Plan-03-01 executor.
