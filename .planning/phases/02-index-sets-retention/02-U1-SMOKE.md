# 02-U1-SMOKE — U1 (partial PUT) + Cycle Endpoint Live-Smoke Decision

**Date:** 2026-05-15
**Plan:** 02-01 — Task 1
**Target Graylog instance:** `http://<graylog-host>:9000` (Graylog 7.0.6 per PROJECT.md)
**Smoke environment:** Plan-02-01 executor (sequential) in the project working tree.

## Reachability Probe

The smoke executor performed an unauthenticated GET against the live instance to confirm
network reachability before attempting authenticated smoke calls:

```
curl -s --max-time 5 -o /dev/null -w "HTTP %{http_code}" \
    "http://<graylog-host>:9000/api/system"
# → HTTP 401
```

The instance is reachable at the TCP/HTTP layer but refuses unauthenticated requests
(expected — the 401 confirms a real Graylog server, not a stale DNS record).

## Credential Availability

The executor MUST source an API token from `~/.graylog-mcp/config.json`'s connection
registry per `<u1_smoke_protocol>` step 1. The actual paths checked:

- `~/.graylog-mcp/config.json` — **NOT FOUND** (no such file in the executor's HOME)
- `/home/yolo/.graylog-mcp/config.json` — NOT FOUND
- `$GRAYLOG_CONFIG_PATH` env override — unset
- Project-local `.graylog-mcp/config.json` — does not exist

No API token is available to this executor. Per `<u1_smoke_protocol>` final paragraph:

> If the instance is unreachable from the build environment **OR no matching connection
> exists**, document "unreachable" in 02-U1-SMOKE.md and adopt the merge-from-current
> fallback for Plan 02 and the synchronous-cycle assumption (Option A) for Plan 04 —
> both are safe defaults per RESEARCH.md §Pitfall U1 and §Cycle Deflector Behavior.

The "no matching connection exists" branch fires. Smoke 1 / 2 / 3 are SKIPPED to avoid
firing unauthenticated requests against the live instance (would only produce 401s
without test value).

## Smoke Results

### Smoke 1 — list non-default index sets

**Status:** SKIPPED (no credentials).

### Smoke 2 — U1 partial PUT (no strategy keys)

**Status:** SKIPPED (no credentials).

### Smoke 3 — cycle endpoint response shape

**Status:** SKIPPED (no credentials).

## Decisions

**U1 decision: UNREACHABLE_DEFAULT_MERGE**

Plan 02 (update_index_set) MUST adopt the merge-from-current wire-build pattern.
The agent's `changes` are merged onto the result of a pre-flight
`GET /api/system/indices/index_sets/{id}` so the PUT body always contains the full
IndexSetSummary shape Graylog's deserializer requires — even when the agent passes
only a partial `changes` (e.g. just `title`). This is the same pattern Phase 1's
`update_extractor` ships (D-09). It is safe because index-set configs carry NO
encrypted fields (confirmed by RESEARCH.md §IndexSetResponse Shape — no field marked
`is_encrypted: true`), so C3 (encrypted-field zero-out on update) is not reachable
through this surface.

Rationale: per RESEARCH.md §Pitfall U1, Graylog 7.0.6's `PUT
/api/system/indices/index_sets/{id}` body deserializer requires the full
IndexSetSummary shape (rotation + retention + index_analyzer + shards + replicas +
…). A partial-only body returns HTTP 400. Phase 1's `update_input` ships D-03
strict-no-echo because input configs carry encrypted fields — emitting them is the
C3 footgun. Index sets have no such constraint, so merge-from-current is the safe
default when U1 cannot be empirically falsified.

**Cycle decision: SYNC_OPTION_A**

Plan 04 (cycle_deflector) MUST adopt the synchronous-cycle envelope:
`{ rotated: true, message: "Cycled index set <id>; closed previous active index",
side_effects: { observable_at: "/system/jobs", describes: "Graylog spawns an
IndexRangesUpdateJob to rebuild the closed index's ranges; the rotation itself is
complete on response." } }`.

Rationale: per RESEARCH.md §Cycle Deflector Behavior (source-verified against
`DeflectorResource.java` in Graylog 7.0.6), `POST
/api/system/deflector/{indexSetId}/cycle` calls `indexSet.cycle()` directly and
returns `void` (HTTP 204 No Content). The rotation itself is synchronous on the
HTTP roundtrip. The IndexRangesUpdateJob that rebuilds the closed index's ranges
is the only async side-effect, and it is documented as observable at `/system/jobs`
in the wrapper's `side_effects` envelope. The agent can optionally call
`await_system_job` with `info_substring: <indexSetId>` if it cares about the
range-rebuild completing.

## Branch Inputs for Downstream Plans

| Plan | Field | Value |
|------|-------|-------|
| 02-02 | update_index_set wire-build approach | **merge-from-current** (D-09 reuse) |
| 02-04 | cycle_deflector envelope shape | **sync Option A** with `side_effects.observable_at: "/system/jobs"` |

Both decisions are safe defaults — if the live instance is later reached and the
strict-no-echo path / async-cycle path is empirically confirmed, the wrapper can
narrow merge-from-current toward strict-no-echo (or widen sync Option A toward
async Option B) without breaking back-compat (the apply payloads stay valid wire
shapes either way; the dry-run preview JSON gains/loses one optional key).

## Auth Hygiene

No API token and no auth header appears in this artifact. The probe command shown
above is unauthenticated by design.
