---
phase: 09-entity-shares-read-path
plan: 02
subsystem: authz
tags: [authz, entity-shares, read-path, live-smoke, grn]
requires:
  - "src/tools/authz/get-entity-shares.js (Plan 09-01 — handleGetEntityShares)"
  - "src/tools/authz/list-grantees.js (Plan 09-01 — handleListGrantees)"
  - "scripts/capture-authz-prepare-fixture.js (Phase 8 — verified live-call pattern)"
provides:
  - "test/authz-entity-shares-live.smoke.js — non-mutating live smoke check against the production test connection"
  - "Live verification (ROADMAP Phase 9 success criterion 4) — get_entity_shares + list_grantees confirmed working on Graylog 7.0.6"
affects: []
tech-stack:
  added: []
  patterns:
    - ".smoke.js suffix keeps the live check outside the npm test glob — deliberate human-run network probe only"
    - "path.endsWith('/prepare') self-guard + grep acceptance gate enforce read-only against live production"
key-files:
  created:
    - "test/authz-entity-shares-live.smoke.js"
  modified: []
decisions:
  - "saved-search probe SKIP is a known live-environment limitation — no SEARCH view exists on the test instance; the stream probe plus Plan 09-01's offline GRN-type matrix are the coverage floor"
metrics:
  duration: ~3min
  completed: 2026-05-19
---

# Phase 9 Plan 02: Entity Shares Read Path — Live Smoke Check Summary

A standalone, non-mutating live smoke check (`test/authz-entity-shares-live.smoke.js`) that drives `get_entity_shares` and `list_grantees` against the real UNESCO-production Graylog 7.0.6 `test` instance, calling only the `@NoAuditEvent` `POST .../prepare` endpoint with an empty `{}` body — closing ROADMAP Phase 9 success criterion 4.

## What Was Built

- **`test/authz-entity-shares-live.smoke.js`** — a `/prepare`-only live probe, deliberately excluded from `npm test` via the `.smoke.js` suffix (the test glob does not match it; confirmed 0 hits in `npm test` output). Using the named `test` connection (same connection-resolution path as `capture-authz-prepare-fixture.js`), it:
  1. Discovers a real stream id via `GET /api/streams`, builds the GRN with `buildGrn("stream", id)`, drives `handleGetEntityShares` and `handleListGrantees`, and asserts a well-formed `EntityShareResponse`-derived result (`available_grantees`, `available_capabilities`, `active_shares`, `validation_result`).
  2. Attempts dashboard and saved-search discovery via `GET /api/views` (filtering on the `type` field — `DASHBOARD` vs `SEARCH`) and runs the same probe per discovered entity type.
  3. Self-guards that every request path under `/api/authz/shares/entities/` ends with `/prepare`, exiting non-zero on violation; sends no `selected_grantee_capabilities` and never references the commit endpoint.
  4. Prints a PASS / SKIP / FAIL summary line per probed entity type.

## Live Verification Result

The orchestrator executed the smoke check against the production `test` instance (`http://<graylog-host>`, Graylog 7.0.6) — `node test/authz-entity-shares-live.smoke.js` exited 0:

```
PASS  stream    grn=grn::::stream:6a0899bc670fc246e77ca54e   available_grantees=5  active_shares=0  list_grantees=5
PASS  dashboard grn=grn::::dashboard:69f9a9f479a73e0661e0aafd available_grantees=5  active_shares=0  list_grantees=5
SKIP  search    no SEARCH view discoverable on the live instance
OK — entity-shares read path verified live, zero mutations.
```

`get_entity_shares` and `list_grantees` both work live against the **stream** and **dashboard** GRN types. Zero mutations — every authz call was `POST .../prepare`.

## Known Live-Environment Limitation

The **saved-search (`search`) probe SKIPped** because no `SEARCH`-type view is discoverable on the live `test` instance. This is the designed SKIP fallback behaving as specified in the plan (Task 1 step 4: dashboard/search discovery is best-effort, do NOT fail the smoke check on a missing entity) — it is a live-environment limitation, **not a failure**. The `search` GRN type remains covered by Plan 09-01's offline GRN-type-parameterized tests (`test/authz-entity-shares.test.js`), and the live stream + dashboard probes confirm two GRN types end-to-end against the running server.

## Deviations from Plan

None — plan executed exactly as written.

## Authentication Gates

None.

## Verification

- `node --check test/authz-entity-shares-live.smoke.js` — passes.
- `grep -c "selected_grantee_capabilities" test/authz-entity-shares-live.smoke.js` — returns 0 (no commit-body content).
- `npm test` — 1131/1131 pass; smoke file confirmed absent from the run (0 occurrences in output).
- Live run (orchestrator, production `test` instance): exit 0, stream PASS, dashboard PASS, search SKIP, zero mutations, `/prepare`-only.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: test/authz-entity-shares-live.smoke.js
- FOUND: commit fc74100 (test(09-02): add non-mutating live smoke check for entity-shares read path)
</content>
</invoke>
