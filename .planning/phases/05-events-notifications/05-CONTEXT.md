# Phase 5: Events & Notifications - Context

**Gathered:** 2026-05-15 (auto-resolved by orchestrator under user "continue to milestone end without me" directive)
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 5 upgrades Graylog's read-only event surface to full CRUD: 9 tools (`list_event_definitions`, `get_event_definition`, `create_event_definition`, `update_event_definition`, `delete_event_definition`, `enable_event_definition`, `disable_event_definition`, `list_event_notifications`, `create_event_notification`, `update_event_notification`, `delete_event_notification`). The safety thesis mitigates **M1** (Graylog's `?schedule=true` server-side default starts processing immediately on create) and **C5** (v6→v7 aggregation syntax silently changed; old `count(source)` shape saves successfully but never fires on v7.1+) end-to-end.

In scope: EVENT-01..EVENT-09. EVENT-06 is two tools (`enable_*` + `disable_*`); EVENT-09 is two tools (`update_*` + `delete_event_notification`). Total wire tools: 11 (close to the original 9 IDs; EVENT-06 and EVENT-09 each cover a pair).

Out of scope: dashboards (Phase 6); blueprints (Phase 6); end-to-end E2E test of M1+C5 against live Graylog (deferred to /gsd-verify-work).

</domain>

<decisions>
## Implementation Decisions

### M1 mitigation — schedule defaults inverted (ROADMAP SC1)

- **D-01:** `create_event_definition` defaults `?schedule=false` on the wire (inverted from Graylog's `@DefaultValue("true")`). Dry-run preview explicitly states `wouldStartScheduling: false`. The agent must call `enable_event_definition` separately to activate the alert.
- **D-02:** `update_event_definition` defaults `?schedule=false` too — partial updates do NOT silently re-enable scheduling. If the agent wants to update and keep enabled, the explicit flow is `update_event_definition` → `enable_event_definition`.

### C5 mitigation — v6→v7 aggregation migration (ROADMAP SC2)

- **D-03:** When the agent passes an aggregation condition with a v6 shape (`{type:"function", function:"count", parameter:"source"}`), the wrapper detects the shape, migrates to v7 (`count_source`), and surfaces `{migrated_from_v6_shape: true, original: <v6>, emitted: <v7>}` in the dry-run output. **Migration is visible, never silent.**
- **D-04:** The detection heuristic is a closed-set zod refinement: any `function` value in `{count, sum, avg, min, max, stddev, percentile, card}` paired with a `parameter` field triggers migration. The migration table is documented in the tool description.

### Notification types (ROADMAP SC3)

- **D-05:** (UPDATED 2026-05-15 after research source-walk) `create_event_notification` uses a `z.discriminatedUnion("type", [...])` covering 6 source-verified variants: `email-notification-v1`, `http-notification-v1`, `http-notification-v2`, `slack-notification-v1`, `pagerduty-notification-v2`, `teams-notification-v2`. Original draft incorrectly named `script-notification-v1` (does not exist on 7.0.6) and `pagerduty-notification-v1` (correct is `-v2`); researcher corrected.
- **D-06:** Discriminator string is the literal Graylog notification-type identifier (with `-v1` / `-v2` suffix). Closed enum; invalid types reject at zod parse before any HTTP call.

### Enable/disable (ROADMAP SC4)

- **D-07:** `enable_event_definition` and `disable_event_definition` send an empty body to `PUT /api/events/definitions/{id}/schedule` and `PUT /api/events/definitions/{id}/unschedule` respectively. Graylog's `@Consumes(WILDCARD)` accepts the empty body. The agent doesn't construct a fake body.

### Cascade preview — delete_event_definition

- **D-08:** `delete_event_definition` pre-flights notification references. Event definitions can have `notifications: [...]` pointing at notification IDs; deleting the event_def leaves those notification rows alive (notifications are independent resources) but the wiring vanishes. Dry-run lists the notifications that would lose this event_def reference. **NO cascade-hash** — notifications survive the delete (just lose the link); this is informational, not a refusal gate. Mirrors the "leaf delete with warning" pattern from Phase 1 `delete_extractor`.
- **D-09:** `delete_event_notification` pre-flights event-definition references. Event_defs reference notifications by ID; deleting a notification leaves the event_defs broken (notification ID resolves to nothing → silent failure on alert fire). Dry-run lists the affected event_defs as a **cascade-hash + drift refusal** (like Phase 3 `delete_stream`) — refuses apply if any event_def still references the notification. Different from D-08 because the notification IS load-bearing.

### Partial-update pattern

- **D-10:** `update_event_definition` and `update_event_notification` follow STRICT_NO_ECHO per Phase 3/4 precedent (Plan 01 U1 smoke may flip if live shows otherwise; safe default).

### Defense-in-depth + IDs (carried forward)

- **D-11:** Phase 0 writable-flag gate (`writable: false` → refuse) applies uniformly. Event definitions have no `mutable` flag on the wire (verified by researcher).
- **D-12:** `__SERVER_ASSIGNED__` sentinel for create_event_definition + create_event_notification dry-runs (C6).
- **D-13:** Schema-parity assertions for all 11 new tools (~11 assertSchemaParityForTool calls).

### Pitfall M2 — inconsistent create response shapes

- **D-14:** `POST /events/definitions` returns 200 with full `EventDefinitionDto` (verified in PITFALLS.md M2 row). Wrapper's response normalizer extracts the `id` field; agent sees the consistent `{id, body}` envelope.

### Claude's Discretion (auto-resolved)

- **Discretion-01:** Module layout under `src/tools/events/`. Pattern matches `src/tools/streams/`.
- **Discretion-02:** Notification type variants beyond the 4 named — Plan 01 researcher provides the exhaustive list from Graylog 7.0.6; planner picks the 6 most common.
- **Discretion-03:** Cascade-hash module — reuse `_shared/cascade-hash.js` `computeCascadeHash` (keyed-buckets) for `delete_event_notification`'s `{notificationId, cascades: {event_definitions: [...]}}` shape. Drop-in.
- **Discretion-04:** Snapshot fixture set — minimum 10 fixtures (one per tool + M1 acceptance gate + C5 acceptance gate).

</decisions>

<canonical_refs>
## Canonical References

- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md` — EVENT-01..EVENT-09
- `.planning/ROADMAP.md` §"Phase 5"
- `.planning/research/PITFALLS.md` §M1 (drives D-01/D-02), §C5 (drives D-03/D-04), §M2 (drives D-14)
- `.planning/phases/03-streams-stream-rules/03-CONTEXT.md` — cascade-hash precedent (drives D-09)
- `.planning/phases/04-pipelines-pipeline-rules-connections/04-CONTEXT.md` — discriminated union precedent (drives D-05)
- `src/tools/_shared/handler.js`, `src/tools/_shared/cascade-hash.js`, `src/tools/_shared/conflict.js`
- `src/tools/streams/delete-stream.js` — analog for D-09
- `src/tools/inputs/delete-input.js` — analog for D-08 (informational cascade, no refusal)
- `source-code/graylog2-server/.../events/rest/EventDefinitionsResource.java` (M1 @DefaultValue source; enable/disable @Consumes(WILDCARD))
- `source-code/graylog2-server/.../events/rest/EventNotificationsResource.java`

</canonical_refs>

<code_context>
## Existing Code Insights

- **`defineMutatingHandler` + `defineListHandler`** — every tool composes through these.
- **`computeCascadeHash`** — `_shared/cascade-hash.js`; reuse for D-09.
- **`findExistingMatches({listPath, matchFn})`** — likely needs `event_definitions` and `event_notifications` envelope amendments (researcher verifies; if `{ event_definitions: [...] }`, add to fallback chain).
- **`GraylogValidationError`** — exists; import.
- **Phase 1 `delete_input` informational cascade pattern** — direct analog for D-08.
- **Phase 3 `delete_stream` cascade-hash + drift refusal** — direct analog for D-09.
- **Per-domain `src/tools/events/`** with `schemas.js` + per-tool handler files + `index.js` barrel.

</code_context>

<specifics>
## Specific Ideas

- The M1 acceptance gate fixture: dry-run preview shows `wouldStartScheduling: false` AND wire path includes `?schedule=false`. Two distinct proofs.
- The C5 acceptance gate fixture: pass v6 `count(source)` aggregation → dry-run output carries `migrated_from_v6_shape: true` + the v7 emitted `count_source` literal.
- Notification discriminator rejection fixture: pass `type: "invalid-notification-v1"` → zod refines before any HTTP call.

</specifics>

<deferred>
## Deferred Ideas

- Auto-migration for OTHER v6→v7 aggregation shapes beyond the 8 named functions (count, sum, avg, min, max, stddev, percentile, card).
- Notification-type variants beyond the 6 strict types (e.g., custom-script). Generic fallback could be added later.
- E2E test against live Graylog for both M1 and C5 — deferred to /gsd-verify-work.

</deferred>

---

*Phase: 05-events-notifications*
*Context auto-gathered: 2026-05-15*
