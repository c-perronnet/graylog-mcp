---
artifact: u1-smoke
phase: 05-events-notifications
plan: 01
decision_for: [enable_event_definition, disable_event_definition]
status: UNREACHABLE
chosen_default: body_undefined
date: 2026-05-15
---

# Phase 05 U1 Live-Smoke Decision Artifact

**Date:** 2026-05-15
**Plan:** 05-01 — Task 3
**Target Graylog instance:** `http://<graylog-host>:9000` (Graylog 7.0.6 per PROJECT.md; 7.2.0-SNAPSHOT source-of-truth reference)
**Smoke environment:** Plan-05-01 executor (sequential) in the project working tree.
**Scope:** Decision applies to BOTH `enable_event_definition` (Plan 05-03 / EVENT-06 schedule) AND `disable_event_definition` (Plan 05-03 / EVENT-06 unschedule).

## Result

**UNREACHABLE** — `body_undefined` chosen as the defensive default.

No API token is available to this executor (no `~/.graylog-mcp/config.json`,
no `GRAYLOG_CONFIG_PATH` override, no project-local `.graylog-mcp/config.json`),
so the WILDCARD-empty-body probes against `http://<graylog-host>:9000` cannot be
performed without firing unauthenticated requests. Per the precedent set by
both `02-U1-SMOKE.md` (UNREACHABLE_DEFAULT_MERGE) and `04-U1-SMOKE.md`
(UNREACHABLE_STRICT_NO_ECHO), the safe-default branch fires here:
`body: undefined` is locked for Plan 05-03 (`enable_event_definition` +
`disable_event_definition`).

## What was probed (specification — NOT executed)

`PUT /api/events/definitions/{nonexistent-id}/schedule` against
`http://<graylog-host>:9000` with two distinct empty-body shapes:

1. **`body: undefined`** — axios emits `data: undefined`, NO `Content-Length`
   header on the wire.
2. **`body: ""`** — axios emits `data: ""`, `Content-Length: 0` header on the
   wire.

Both are accepted by Graylog's `@Consumes(MediaType.WILDCARD)` server-side
[VERIFIED: EventDefinitionsResource.java:422 + 453]. The question this artifact
resolves is whether any reverse proxy in front of the live cluster (nginx,
Traefik, etc.) requires the explicit `Content-Length: 0` header on a no-body
PUT, which would force `body: ""` over `body: undefined`.

## How probed (would have been — UNREACHABLE)

```bash
# Probe 1 — body: undefined (axios native)
curl -sS -w "\nHTTP %{http_code}\n" \
  -u "$TOKEN:token" \
  -X PUT \
  -H "X-Requested-By: graylog-mcp" \
  "http://<graylog-host>:9000/api/events/definitions/000000000000000000000000/schedule"

# Probe 2 — body: "" (explicit empty + Content-Length: 0)
curl -sS -w "\nHTTP %{http_code}\n" \
  -u "$TOKEN:token" \
  -X PUT \
  -H "X-Requested-By: graylog-mcp" \
  -H "Content-Length: 0" \
  "http://<graylog-host>:9000/api/events/definitions/000000000000000000000000/schedule"
```

Expected: **404 (id doesn't exist)** for both, **NOT 411 (Length Required)** or
**415 (Unsupported Media Type)**.

The instance at `<graylog-host>:9000` is HTTP-reachable (Phase 2's
`02-U1-SMOKE.md` positively identified a live Graylog server via 401 response).
The reachability question is settled; only the credential question blocks the
smoke.

## Procedure (auth-token discovery)

The smoke executor MUST source an API token from `~/.graylog-mcp/config.json`
per `<u1_smoke_protocol>` step 1. Paths checked:

- `~/.graylog-mcp/config.json` (= `/home/c_perronnet/.graylog-mcp/config.json`) — **NOT FOUND**
- `/home/yolo/.graylog-mcp/config.json` — NOT FOUND (directory does not exist)
- `$GRAYLOG_CONFIG_PATH` env override — **unset**
- Project-local `/home/c_perronnet/git/graylog-mcp/.graylog-mcp/config.json` — NOT FOUND

No API token is available. Per `<u1_smoke_protocol>` "no matching connection
exists" branch — also confirmed by `02-U1-SMOKE.md`, `03-U1-SMOKE.md`, and
`04-U1-SMOKE.md` precedents — the executor skips the probe sequence rather
than fire unauthenticated 401s against the live instance.

## Decision Matrix

| Outcome                                     | Wire behaviour                                                    | Decision           | Selected   |
| ------------------------------------------- | ----------------------------------------------------------------- | ------------------ | ---------- |
| Probe 1 returns 404, Probe 2 returns 404    | Either body shape works; no proxy interference                    | `body: undefined`  | —          |
| Probe 1 returns 411, Probe 2 returns 404    | Reverse proxy requires `Content-Length: 0`                        | `body: ""`         | —          |
| Probe 1 returns 415, Probe 2 returns 404    | Server requires explicit zero-length body declaration             | `body: ""`         | —          |
| UNREACHABLE (no auth token in executor env) | Smoke cannot be empirically run                                   | `body: undefined`  | **CHOSEN** |

**Rationale for the UNREACHABLE default:**

1. **HTTP-layer hygiene.** A `body: undefined` PUT emits no `Content-Length`
   header at all; the server-side handler reads zero bytes. A `body: ""` PUT
   adds a spurious `Content-Length: 0` header that adds no semantic value
   and increases wire bytes.
2. **Graylog `@Consumes(MediaType.WILDCARD)` accepts both** — neither is
   rejected at the resource layer.
3. **Aligned with the Phase 0 client default.** `src/graylog/client.js`'s
   `makeClient(...)` passes `body` through to axios; passing `undefined`
   produces axios's default behavior (no payload), which is the most
   conservative interpretation of "no body".
4. **Reversible if a proxy later objects.** Flipping from `body: undefined`
   to `body: ""` is a wire-additive change (the wrapper layer emits an
   identical no-payload PUT, just with a `Content-Length: 0` header). No
   back-compat break for agents already round-tripping the dry-run preview.

## Implications for Plan 05-03 (EVENT-06 enable/disable)

**Pattern:** **`body: undefined`** for both `enable_event_definition` and
`disable_event_definition`.

Plan 05-03's build() callbacks MUST emit a `RequestDescriptor` with
`body: undefined`. The wrapper's apply() forwards this to
`client.request("PUT", path, body)` which forwards to axios without a payload.

Wire form (locked):

```http
PUT /api/events/definitions/{id}/schedule HTTP/1.1
X-Requested-By: graylog-mcp
```

(No body. `@Consumes(WILDCARD)` accepts but doesn't read.)

Same for `/unschedule`. Returns 200 + full `EventDefinitionDto` with
`state: "ENABLED"` (or `DISABLED`).

[VERIFIED: EventDefinitionsResource.java:420-432 (schedule) + 451-463 (unschedule)]

## Hand-off Line

> Plan 05-03 locks `body: undefined` for enable/disable_event_definition wire
> form. If `/gsd-verify-work` later surfaces a 411 ("Length Required") or 415
> ("Unsupported Media Type") response against the live cluster, the wrapper
> widens to `body: ""` — wire-additive change, no back-compat break.

## Branch Inputs for Downstream Plans

| Plan   | Field                                           | Value                       |
| ------ | ----------------------------------------------- | --------------------------- |
| 05-03  | enable_event_definition wire body shape         | **`body: undefined`**       |
| 05-03  | disable_event_definition wire body shape        | **`body: undefined`**       |

Both decisions are safe defaults. If the live instance is later reached and
`body: undefined` is empirically falsified by HTTP 411 or 415 responses, the
wrapper can widen each toward `body: ""` additively without breaking
back-compat.

## Auth Hygiene

No API token and no auth header appears in this artifact. Probe commands
shown in §"How probed" are documented for reproducibility but were NOT
executed by the Plan-05-01 executor. The `$TOKEN` placeholder in the curl
examples is deliberately unresolved.
