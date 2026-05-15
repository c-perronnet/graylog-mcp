# Phase 5: Events & Notifications - Research

**Researched:** 2026-05-15
**Domain:** Graylog 7.0.6 (target) / 7.2-SNAPSHOT (source clone) — event-definition + event-notification CRUD upgrade
**Confidence:** HIGH (endpoint shapes, type-name catalogue, v6→v7 aggregation truth, notification config shapes all verified against `source-code/graylog2-server/`); MEDIUM (Graylog 7.0.6 live-API edge cases — `_register.js` v2.3 displacement, `/paginated` envelope keys on 7.0.6 versus 7.2-snapshot)

## Summary

Phase 5 adds 11 CRUD tools across two endpoints — `/api/events/definitions` and `/api/events/notifications` — that complete the safety thesis around M1 (schedule defaults to TRUE on the wire) and C5 (aggregation condition syntax silently shifted v6→v7). Every D-XX decision in `05-CONTEXT.md` is implementable with existing Phase 0/1/2/3/4 primitives; the only NEW client-side machinery is the v6→v7 aggregation-condition migrator (a small zod refinement + visible warning in dry-run output).

**Key research confirmations:**
- M1 mitigation is a wrapper-side QueryParam inversion. Server's `EventDefinitionsResource.create(...)` has `@QueryParam("schedule") @DefaultValue("true")` at line 315; the wrapper sends `?schedule=false` by default and the agent calls `enable_event_definition` separately.
- M1 also applies to `update_event_definition` (line 344 same default-true); D-02 is correct — partial updates must NOT silently re-enable.
- C5 mitigation: the v6→v7 change documented at `changelog/7.1.0-rc.1/pr-24703.toml` is NOT a payload-shape change (the `SeriesSpec.id()` format `count(field)` is unchanged in 7.2-source). The change is **how the runtime emits aggregation_conditions keys** at event-fire time — old format was `series.literal()` (e.g. `count(source)`), new format is `function_field` (e.g. `count_source`). Implication for the wrapper: D-03/D-04's "detect v6 shape on input and migrate" still mitigates the agent's mental model, even though the input shape itself is invariant — the agent's intent (matching condition references to series labels) breaks if it references `count(source)` thinking the runtime emits that string.
- D-09 cascade-hash inputs for `delete_event_notification` are well-defined: notifications are referenced by event_definitions through `EventDefinitionDto.notifications[].notification_id`. A paginated walk of `/api/events/definitions/paginated` with client-side filter mirrors the `delete_stream` pattern Plan 03-03 already shipped — drop-in `computeCascadeHash` with a single bucket `event_definitions`.
- The notification catalogue confirmation rewrote D-05's variant list: **5 of the 6 named types in CONTEXT.md exist as-named, but PagerDuty's wire identifier is `pagerduty-notification-v2` (NOT `-v1`)**. There is NO `script-notification-v1` in the 7.2-snapshot tree. Researcher recommends replacing it with `legacy-alarm-callback-notification-v1` (universal Graylog plugin fallback) — see D-05 update below.

**Primary recommendation:** Phase 5 is a straight composition phase. 11 tools, every one a thin `defineMutatingHandler` or `defineListHandler` call. Land the v6→v7 migrator and notification discriminator variants first (Plan 01); follow with event-definition CRUD (Plan 02), enable/disable (Plan 03), notification CRUD (Plan 04), snapshot+schema-parity flip (Plan 05). The single new mechanic — the v6→v7 closed-enum refinement — is ~30 LOC of zod.

## User Constraints

> Copied verbatim from `.planning/phases/05-events-notifications/05-CONTEXT.md` for the planner's reference. The planner MUST honor every Decision below. Claude's Discretion items are research areas with researcher recommendations. Deferred Ideas are OUT OF SCOPE.

### Locked Decisions

**M1 mitigation — schedule defaults inverted (ROADMAP SC1)**
- **D-01:** `create_event_definition` defaults `?schedule=false` on the wire (inverted from Graylog's `@DefaultValue("true")`). Dry-run preview explicitly states `wouldStartScheduling: false`. The agent must call `enable_event_definition` separately to activate the alert.
- **D-02:** `update_event_definition` defaults `?schedule=false` too — partial updates do NOT silently re-enable scheduling. If the agent wants to update and keep enabled, the explicit flow is `update_event_definition` → `enable_event_definition`.

**C5 mitigation — v6→v7 aggregation migration (ROADMAP SC2)**
- **D-03:** When the agent passes an aggregation condition with a v6 shape (`{type:"function", function:"count", parameter:"source"}`), the wrapper detects the shape, migrates to v7 (`count_source`), and surfaces `{migrated_from_v6_shape: true, original: <v6>, emitted: <v7>}` in the dry-run output. **Migration is visible, never silent.**
- **D-04:** The detection heuristic is a closed-set zod refinement: any `function` value in `{count, sum, avg, min, max, stddev, percentile, card}` paired with a `parameter` field triggers migration. The migration table is documented in the tool description.

**Notification types (ROADMAP SC3)**
- **D-05:** `create_event_notification` uses a `z.discriminatedUnion("type", [...])` covering the 4 named types in REQUIREMENTS.md: `email-notification-v1`, `http-notification-v2`, `slack-notification-v1`, `pagerduty-notification-v1`. Plus 2 broader common types from Graylog's actual catalogue (researcher verifies): `script-notification-v1`, `teams-notification-v1`. Total: 6 strict variants.
- **D-06:** Discriminator string is the literal Graylog notification-type identifier (with `-v1` / `-v2` suffix). Closed enum; invalid types reject at zod parse before any HTTP call.

**Enable/disable (ROADMAP SC4)**
- **D-07:** `enable_event_definition` and `disable_event_definition` send an empty body to `PUT /api/events/definitions/{id}/schedule` and `PUT /api/events/definitions/{id}/unschedule` respectively. Graylog's `@Consumes(WILDCARD)` accepts the empty body. The agent doesn't construct a fake body.

**Cascade preview — delete_event_definition**
- **D-08:** `delete_event_definition` pre-flights notification references. Event definitions can have `notifications: [...]` pointing at notification IDs; deleting the event_def leaves those notification rows alive (notifications are independent resources) but the wiring vanishes. Dry-run lists the notifications that would lose this event_def reference. **NO cascade-hash** — notifications survive the delete (just lose the link); this is informational, not a refusal gate. Mirrors the "leaf delete with warning" pattern from Phase 1 `delete_extractor`.
- **D-09:** `delete_event_notification` pre-flights event-definition references. Event_defs reference notifications by ID; deleting a notification leaves the event_defs broken (notification ID resolves to nothing → silent failure on alert fire). Dry-run lists the affected event_defs as a **cascade-hash + drift refusal** (like Phase 3 `delete_stream`) — refuses apply if any event_def still references the notification. Different from D-08 because the notification IS load-bearing.

**Partial-update pattern**
- **D-10:** `update_event_definition` and `update_event_notification` follow STRICT_NO_ECHO per Phase 3/4 precedent (Plan 01 U1 smoke may flip if live shows otherwise; safe default).

**Defense-in-depth + IDs (carried forward)**
- **D-11:** Phase 0 writable-flag gate (`writable: false` → refuse) applies uniformly. Event definitions have no `mutable` flag on the wire (verified by researcher).
- **D-12:** `__SERVER_ASSIGNED__` sentinel for create_event_definition + create_event_notification dry-runs (C6).
- **D-13:** Schema-parity assertions for all 11 new tools (~11 assertSchemaParityForTool calls).

**Pitfall M2 — inconsistent create response shapes**
- **D-14:** `POST /events/definitions` returns 200 with full `EventDefinitionDto` (verified in PITFALLS.md M2 row). Wrapper's response normalizer extracts the `id` field; agent sees the consistent `{id, body}` envelope.

### Claude's Discretion (auto-resolved)

- **Discretion-01:** Module layout under `src/tools/events/`. Pattern matches `src/tools/streams/`.
- **Discretion-02:** Notification type variants beyond the 4 named — Plan 01 researcher provides the exhaustive list from Graylog 7.0.6; planner picks the 6 most common. **RESEARCHER RESOLUTION:** see §"Notification Type Catalogue" below — only **5** of the original 6 names exist on 7.0.6 / 7.2-source as-stated. PagerDuty is `-v2` not `-v1`; `script-notification-v1` does NOT exist in the source. Recommended 6 variants: `email-notification-v1`, `http-notification-v1`, `http-notification-v2`, `slack-notification-v1`, `pagerduty-notification-v2`, `teams-notification-v2`. (Plus optional 7th `legacy-alarm-callback-notification-v1` if Discretion-02 widens.)
- **Discretion-03:** Cascade-hash module — reuse `_shared/cascade-hash.js` `computeCascadeHash` (keyed-buckets) for `delete_event_notification`'s `{notificationId, cascades: {event_definitions: [...]}}` shape. Drop-in.
- **Discretion-04:** Snapshot fixture set — minimum 10 fixtures (one per tool + M1 acceptance gate + C5 acceptance gate). **RESEARCHER RESOLUTION:** 12 fixtures recommended — see §"Snapshot Fixture Design" below.

### Deferred Ideas (OUT OF SCOPE)

- Auto-migration for OTHER v6→v7 aggregation shapes beyond the 8 named functions (count, sum, avg, min, max, stddev, percentile, card).
- Notification-type variants beyond the 6 strict types (e.g., custom-script). Generic fallback could be added later.
- E2E test against live Graylog for both M1 and C5 — deferred to `/gsd-verify-work`.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EVENT-01 | `list_event_definitions` — narrow projection | §"Endpoint Catalogue" §"List Path Selection" — use `/api/events/definitions/paginated`, displaces v2.3 |
| EVENT-02 | `get_event_definition` | §"Endpoint Catalogue" §"EventDefinitionDto Field Shape" |
| EVENT-03 | `create_event_definition` — schedule defaults false; v6→v7 helper | §"M1 Mitigation Anatomy" §"v6→v7 Aggregation Migration" §"D-12 envelope (CreateEntityRequest wrapper)" |
| EVENT-04 | `update_event_definition` | §"M1 Mitigation Anatomy (update)" §"STRICT_NO_ECHO precedent" |
| EVENT-05 | `delete_event_definition` | §"D-08 informational cascade" — pre-flight notifications referenced by the def |
| EVENT-06 | `enable_event_definition` / `disable_event_definition` — WILDCARD empty-body | §"WILDCARD Quirk Confirmation" — endpoint paths verified |
| EVENT-07 | `list_event_notifications` | §"Endpoint Catalogue" §"List Path Selection" — use `/api/events/notifications/paginated`, displaces v2.3 |
| EVENT-08 | `create_event_notification` — discriminated-union schemas | §"Notification Type Catalogue" §"Per-Type Config Shapes" |
| EVENT-09 | `update_event_notification` / `delete_event_notification` — cascade-hash on delete | §"D-09 cascade-hash mechanics" §"Per-Notification Validation" |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Event-definition CRUD (8 tools) | API / Backend | Database | All mutations resolve to Graylog REST → MongoDB; no client tier; no compute beyond the wrapper |
| Event-notification CRUD (3 tools) | API / Backend | Database | Same — REST-only surface; storage is MongoDB |
| Schedule (enable/disable) | API / Backend | Database | One-shot PUT to `/{id}/schedule|unschedule`; persisted as `EventDefinition.State.ENABLED|DISABLED` |
| v6→v7 aggregation migration | MCP wrapper (client-side) | — | Pure transformation on input shape; surfaced in dry-run output |
| Cascade detection (D-08, D-09) | MCP wrapper (client-side) | API / Backend | Paginated walk + client-side filter (no server-side stream/notification-ID filter on `events/definitions/paginated`); cascade-hash computed in wrapper |
| Discriminator validation | MCP wrapper (zod schema) | — | Closed-set rejection before any HTTP call |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | `1.18.0` (locked) | MCP transport | Existing project dependency [VERIFIED: package.json] |
| `axios` | `1.12.2` (locked) | HTTP client (via `src/graylog/client.js`) | Existing project dependency [VERIFIED: package.json] |
| `zod` | `^3.25.76` (locked) | Schema validation + closed-set discriminator | Existing project dependency, adopted in Phase 0 FOUND-05 [VERIFIED: package.json] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:crypto` (`createHash`) | builtin | sha-256 cascade-hash | Reused via `src/tools/_shared/cascade-hash.js` for D-09 [VERIFIED: existing import] |
| `node:test` (`t.snapshot`) | builtin (Node 20.6+) | Dry-run fixture pinning | Reused for the 12 Phase 5 fixtures [VERIFIED: Phase 0..4 precedent] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Closed-set zod enum for migration trigger (D-04) | Open string match | Open match would silently migrate `counter`, `summary`, `averaged` — false positives. Closed-set is the safer default. |
| Single discriminator schema (D-05) | Generic `z.object({type: z.string(), config: z.unknown()})` | Generic shape forfeits all client-side rejection — agent gets to find out the type doesn't exist when Graylog returns 400. Closed-set is the M7 mitigation in action. |
| Separate `delete_event_definition` cascade-hash | Drop-in `computeCascadeHash` (D-09 only) | D-08 is informational (notifications survive); applying a refusal gate to a non-load-bearing reference is overhead for the agent. Asymmetry between D-08 and D-09 is intentional and documented in CONTEXT.md. |

**Installation:** No new dependencies. Phase 5 is pure composition against Phase 0..4 primitives.

**Version verification:**
```bash
npm view @modelcontextprotocol/sdk version   # → 1.18.0 (locked)
npm view axios version                       # → 1.12.2 (locked)
npm view zod version                         # → 3.25.76 (locked at ^3.25.76)
```
[VERIFIED: package.json]

## Project Constraints (from CLAUDE.md)

The project CLAUDE.md mandates these constraints — the planner MUST honor them:

- **Tech stack:** Node.js ≥18 ESM; existing `@modelcontextprotocol/sdk` + `axios` + `zod` — do NOT add new dependencies.
- **Graylog version:** 7.2.0-SNAPSHOT (per CLAUDE.md; PROJECT.md refines to 7.0.6 as the live target). Live behavior wins on divergence.
- **Auth model:** Existing connection registry + API token (HTTP Basic, token-as-username, password `"token"`). No new auth concepts.
- **Safety:** Every mutating tool MUST default to `dryRun: true`. Applying without an explicit `dryRun: false` is a bug — enforced via `defineMutatingHandler`.
- **Backward compat:** Existing v2.3 tool contracts unchanged where they survive. Phase 5 DISPLACES the v2.3 `list_event_definitions` and `list_event_notifications` names (S5-pattern displacement like Phase 3's `list_streams`).
- **No web UI:** This is an MCP server. JSON output via MCP text responses only.
- **Code organization:** New admin tools under `src/tools/events/` per-domain modules. Mirrors `src/tools/streams/` precedent.
- **GSD workflow enforcement:** All edits go through `/gsd-execute-phase` (or `/gsd-quick`, `/gsd-debug`).

## Architecture Patterns

### System Architecture Diagram

```
┌───────────────────────────────────────────────────────────────┐
│ MCP Client (agent)                                            │
│  send: {name: "create_event_definition", args: {...}}         │
└───────────────────────────────┬───────────────────────────────┘
                                ↓
┌───────────────────────────────────────────────────────────────┐
│ src/index.js + src/dispatch.js (Phase 0 — unchanged)          │
│  Map<toolName, handler>.get("create_event_definition")        │
└───────────────────────────────┬───────────────────────────────┘
                                ↓
┌───────────────────────────────────────────────────────────────┐
│ src/tools/events/create-event-definition.js                   │
│  defineMutatingHandler({                                      │
│    schema: CreateEventDefinitionSchema  (zod, see §Schemas)   │
│    build: async (args) => {                                   │
│      1. v6→v7 migration: detect+rewrite aggregation conditions│
│         → set req.migrationWarnings array                     │
│      2. existingMatches via findExistingMatches({listPath:    │
│         "/api/events/definitions/paginated"})                 │
│      3. emit POST /api/events/definitions?schedule=false      │
│         body = CreateEntityRequest<EventDefinitionDto>        │
│      4. postApplyEstimate = {id: __SERVER_ASSIGNED__, ...}    │
│    },                                                         │
│    apply: (client, req) => client.request(...),               │
│    summarize: ...                                             │
│  })                                                           │
└───────────────────────────────┬───────────────────────────────┘
                                ↓
┌───────────────────────────────────────────────────────────────┐
│ src/graylog/client.js (Phase 0 — unchanged)                   │
│  POST {baseUrl}/api/events/definitions?schedule=false         │
│  X-Requested-By: graylog-mcp                                  │
│  Authorization: Basic <token-as-username>                     │
└───────────────────────────────┬───────────────────────────────┘
                                ↓
┌───────────────────────────────────────────────────────────────┐
│ Graylog 7.0.6 → EventDefinitionsResource.create(...)          │
│  @DefaultValue("true") schedule  → wrapper sent FALSE         │
│  EventDefinitionHandler.createWithoutSchedule(...)            │
│  ⇒ 200 OK + full EventDefinitionDto (M2: not 201)             │
└───────────────────────────────────────────────────────────────┘

Cascade path (delete_event_notification, D-09 ONLY):

build() pre-flights:
  ┌── paginated walk /api/events/definitions/paginated
  │     for each def: scan def.notifications[].notification_id
  │     collect those matching the target notificationId
  ├── computeCascadeHash({streamId: notificationId, ruleIds: [],
  │     pipelineConnIds: [...sortedEventDefIds], eventDefIds: []})
  │     (semantic wrapper recommended — see §"Cascade-Hash Reuse")
  └── set req._confirmationToken, req.cascades.event_definitions

apply() re-fetches, re-computes, refuses on drift:
  Same paginated walk → if hash drifts: isError(cascade_changed_since_preview)
  Else: DELETE /api/events/notifications/{id}
```

### Recommended Project Structure

```
src/tools/events/
├── schemas.js                    # All 11 tools' zod schemas + 6 notification discriminator variants
├── v6-to-v7-migration.js         # ~30 LOC closed-enum refinement + migration emitter
├── list-event-definitions.js     # defineListHandler — narrow projection
├── get-event-definition.js       # plain GET handler (read tool — no mutatingBase)
├── create-event-definition.js    # defineMutatingHandler + M1 schedule inversion + migration
├── update-event-definition.js    # STRICT_NO_ECHO + M1 schedule inversion on update
├── delete-event-definition.js    # defineMutatingHandler + D-08 informational cascade
├── enable-event-definition.js    # PUT /schedule  (empty body, @Consumes(WILDCARD))
├── disable-event-definition.js   # PUT /unschedule (empty body, @Consumes(WILDCARD))
├── list-event-notifications.js   # defineListHandler — narrow projection
├── create-event-notification.js  # defineMutatingHandler + discriminator (6 variants)
├── update-event-notification.js  # STRICT_NO_ECHO + discriminator
├── delete-event-notification.js  # defineMutatingHandler + D-09 cascade-hash + drift refusal
└── index.js                      # side-effect barrel, registers 11 tools

src/tools/_shared/conflict.js   # AMEND: envelope keys for "event_definitions" + "notifications"
src/tools/_shared/cascade-hash.js  # AMEND: optional thin wrapper computeNotificationCascadeHash
src/tools.js                       # ADD 11 new tool definitions; UPDATE existing list_event_*
src/tools/_register.js             # DISPLACE v2.3 list_event_definitions/notifications (S5 pattern)
```

### Pattern 1: M1 Schedule Inversion (D-01/D-02)

**What:** Wrapper sends `?schedule=false` on POST/PUT regardless of agent input; agent must explicitly call `enable_event_definition` to start scheduling.

**When to use:** Both `create_event_definition` and `update_event_definition`.

**Example (mirrored from delete-stream.js + Plan 4's parse pre-flight pattern):**
```javascript
// src/tools/events/create-event-definition.js
import { defineMutatingHandler } from "../_shared/handler.js";
import { CreateEventDefinitionSchema } from "./schemas.js";
import { migrateV6ToV7AggregationConditions } from "./v6-to-v7-migration.js";
import { findExistingMatches } from "../_shared/conflict.js";
import { makeClient } from "../../graylog/client.js";

export const handleCreateEventDefinition = defineMutatingHandler({
    name: "create_event_definition",
    schema: CreateEventDefinitionSchema,
    async build(args) {
        // D-03/D-04: visible migration. Returns
        //   { migrated: boolean, dto: EventDefinitionDto, warnings: [...] }
        const migration = migrateV6ToV7AggregationConditions(args.definition);
        const client = makeClient(args._conn);
        const existingMatches = await findExistingMatches(client, {
            listPath: "/api/events/definitions/paginated",
            matchFn: (def) => def.title === args.definition.title,
            similarityReason: "exact",
        });
        return {
            method: "POST",
            // D-01: wire path includes ?schedule=false UNCONDITIONALLY.
            path: "/api/events/definitions?schedule=false",
            // D-14: server wraps EventDefinitionDto in CreateEntityRequest.
            body: { entity: migration.dto, share_request: null },
            existingMatches,
            // D-03 surface: dry-run JSON shows migrated_from_v6_shape + original + emitted.
            ...(migration.migrated ? { migration } : {}),
            postApplyEstimate: { id: "__SERVER_ASSIGNED__", state: "DISABLED" },
            // D-14: response normalizer for the 200 + full DTO inconsistency.
            normalize: (raw) => ({ id: raw?.id, body: raw }),
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        `Create event definition "${args.definition.title}" with schedule:false`,
});
```
[CITED: source-code/.../EventDefinitionsResource.java:306-333; src/tools/streams/create-stream.js pattern]

### Pattern 2: v6→v7 Aggregation Migration (D-03/D-04)

**What:** Closed-set zod refinement detects v6 shape on input, surfaces a structured warning, emits v7 shape.

**The truth about pr-24703:** the **payload shape on POST is the same** in 7.0.6 and 7.2-source (`SeriesSpec` JSON is unchanged). What changed is the **runtime emit key** for aggregation_conditions on event-fire. Old: `series.literal()` → `count(source)`. New: `function_field` → `count_source`. An agent constructing aggregation **condition references** (e.g. a comparison `count_source > 100` in `conditions.expression`) using the v6 form will create an event_def that saves but never fires on 7.0.6+ because the emitted key shape doesn't match. [VERIFIED: `git show 502cd61f87 -- AggregationSearchUtils.java`]

**The 8 named functions (per D-04 + verified against `src/main/java/org/graylog/plugins/views/search/searchtypes/pivot/series/`):**

| v6 form (literal) | v7 form (underscored) | SeriesSpec class | TYPE name |
|-------------------|----------------------|------------------|-----------|
| `count(<field>)` or `count()` | `count_<field>` or `count` | Count.java | `count` |
| `sum(<field>)` | `sum_<field>` | Sum.java | `sum` |
| `avg(<field>)` | `avg_<field>` | Average.java | `avg` |
| `min(<field>)` | `min_<field>` | Min.java | `min` |
| `max(<field>)` | `max_<field>` | Max.java | `max` |
| `stddev(<field>)` | `stddev_<field>` | StdDev.java | `stddev` |
| `percentile(<field>,<p>)` | `percentile_<field>_<p>` | Percentile.java | `percentile` |
| `card(<field>)` | `card_<field>` | Cardinality.java | `card` |

[VERIFIED: source-code/.../pivot/series/{Count,Sum,Average,Min,Max,StdDev,Percentile,Cardinality}.java — TYPE_NAME constants]

**Example:**
```javascript
// src/tools/events/v6-to-v7-migration.js
const V6_FUNCTION_NAMES = new Set([
    "count", "sum", "avg", "min", "max", "stddev", "percentile", "card",
]);

export function migrateV6ToV7AggregationConditions(definitionDto) {
    const warnings = [];
    let migrated = false;
    const visit = (node) => {
        // Detect a v6 shape: {type:"function", function:"count", parameter:"source"}
        if (
            node?.type === "function"
            && typeof node.function === "string"
            && V6_FUNCTION_NAMES.has(node.function)
            && typeof node.parameter === "string"
        ) {
            const v7Key = node.parameter
                ? `${node.function}_${node.parameter}`
                : node.function;
            warnings.push({
                migrated_from_v6_shape: true,
                original: { ...node },
                emitted: v7Key,
            });
            migrated = true;
            return { type: "number-ref", ref: v7Key };
        }
        // Recurse into Expr.And/Or/Not/Comparison left+right operands.
        if (node?.left || node?.right || node?.child) {
            return {
                ...node,
                ...(node.left ? { left: visit(node.left) } : {}),
                ...(node.right ? { right: visit(node.right) } : {}),
                ...(node.child ? { child: visit(node.child) } : {}),
            };
        }
        return node;
    };
    const expr = definitionDto?.config?.conditions?.expression;
    const migratedExpr = expr ? visit(expr) : expr;
    const dto = expr
        ? {
            ...definitionDto,
            config: {
                ...definitionDto.config,
                conditions: { ...definitionDto.config.conditions, expression: migratedExpr },
            },
        }
        : definitionDto;
    return { migrated, dto, warnings };
}
```
[CITED: pr-24703 commit 502cd61f87 + Expr.java NumberReference shape]

### Pattern 3: Discriminator-based Notification Schemas (D-05/D-06)

**What:** `z.discriminatedUnion("type", [...])` with 6 strict variants.

**When to use:** `create_event_notification` and `update_event_notification` (the latter inside a `changes.config` envelope for partial updates).

**Example (skeleton — full per-type schemas in §"Per-Type Config Shapes" below):**
```javascript
// src/tools/events/schemas.js
import { z } from "zod";

const EmailNotificationConfigSchema = z.object({
    type: z.literal("email-notification-v1"),
    sender: z.string().min(1).optional(),
    reply_to: z.string().optional(),
    subject: z.string().min(1),
    body_template: z.string().optional(),
    html_body_template: z.string().optional(),
    email_recipients: z.array(z.string()).default([]),
    user_recipients: z.array(z.string()).default([]),
    // ...23 more fields per EmailEventNotificationConfig.java
});

const SlackNotificationConfigSchema = z.object({
    type: z.literal("slack-notification-v1"),
    webhook_url: z.string().url(),
    channel: z.string().min(1),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ff0500"),
    custom_message: z.string().optional(),
    backlog_size: z.number().int().nonnegative().default(0),
    notify_channel: z.boolean().default(false),
    notify_here: z.boolean().default(false),
    // ...
}).refine((v) => !(v.notify_channel && v.notify_here),
    { message: "notify_channel and notify_here are mutually exclusive" });

// ...HTTPNotificationV2, HTTPNotificationV1, TeamsV2, PagerDutyV2

export const NotificationConfigSchema = z.discriminatedUnion("type", [
    EmailNotificationConfigSchema,
    HttpV1NotificationConfigSchema,
    HttpV2NotificationConfigSchema,
    SlackNotificationConfigSchema,
    PagerDutyV2NotificationConfigSchema,
    TeamsV2NotificationConfigSchema,
]);
```
[CITED: source-code/.../notifications/types/*.java]

### Pattern 4: D-09 Cascade-Hash for delete_event_notification

**What:** Reuse `_shared/cascade-hash.js`'s `computeCascadeHash` (keyed-buckets) — feed it the notification ID as the `streamId` slot and the referencing event-definition IDs as the `eventDefIds` slot. Per `delete_stream.js` precedent: planner may add a thin semantic wrapper `computeNotificationCascadeHash({notificationId, eventDefIds})` for call-site clarity.

**The pre-flight scan:** Graylog 7.0.6 does NOT expose a `?notification_id=` filter on `/api/events/definitions/paginated`. Mirror the `delete_stream.js` pattern at lines 93-116 — paginated walk + client-side filter on `def.notifications[].notification_id`.

**Example:**
```javascript
// src/tools/events/delete-event-notification.js (excerpt)
async function fetchEventDefsReferencingNotification(client, notificationId) {
    const matches = [];
    const perPage = 50;
    const maxPages = 1000;
    let page = 1;
    while (page <= maxPages) {
        const rsp = await client.request(
            "GET",
            `/api/events/definitions/paginated?page=${page}&per_page=${perPage}`,
            null,
        );
        const defs = Array.isArray(rsp?.elements) ? rsp.elements : [];
        for (const def of defs) {
            const refs = Array.isArray(def?.notifications) ? def.notifications : [];
            if (refs.some((n) => n?.notification_id === notificationId)) {
                matches.push({ id: def.id, title: def.title });
            }
        }
        if (defs.length < perPage) break;
        page += 1;
    }
    return matches;
}
```
[CITED: src/tools/streams/delete-stream.js:93-116 + EventDefinitionDto.notifications field]

### Anti-Patterns to Avoid

- **Silent v6→v7 migration.** The whole point of D-03/D-04 is **visible**. Never rewrite the agent's input without surfacing `migration` in dry-run output.
- **Constructing a JSON body for enable/disable.** `@Consumes(MediaType.WILDCARD)` accepts but ignores any body. Sending one wastes context (M7-aligned) and risks future-Graylog tightening rejecting non-empty bodies.
- **Symmetric cascade-hash on D-08.** Notifications survive after `delete_event_definition`; the agent doesn't need a hash + apply-time re-fetch to consume that knowledge. D-08 is purely informational.
- **Open-string discriminator validation.** Allowing `type: "anything-notification-v1"` defeats the M7 closed-set guarantee. Rejection happens at zod parse, before any HTTP.
- **Per-handler `args.dryRun ?? true`.** Enforced once in `defineMutatingHandler`. Never re-check in build() or apply().

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cascade-hash canonical form | Custom sha-256 + JSON.stringify | `computeCascadeHash` from `_shared/cascade-hash.js` | Keyed-buckets canonicalization is solved; D-09 byte-identity requires the existing helper (T-03-03-* threat model anchors) |
| Pagination loop | Hand-rolled `while(true)` | The `fetchEventDefinitionsForStream` pattern from `delete-stream.js:93-116` | Safety cap (1000 pages × 50 per page = 50k defs max) + early-exit on partial page already proven |
| Discriminator-based validation | Manual `switch` on `type` | `z.discriminatedUnion("type", [...])` | Closed-set rejection, automatic type-narrowing in TS-style usage, zod-emitted error messages name the missing field |
| Connection resolution | New `args._conn ?? getActive()` per handler | `defineMutatingHandler` does it once via `resolveConnection` | Threat-model T-00-04-05: agent cannot bypass connection lookup |
| Idempotency key | Hand-derived hash per tool | `deriveIdempotencyKey({connectionName, toolName, args})` from `_shared/idempotency.js` | FOUND-10 ships this; create_event_definition gets retry-window dedupe for free |
| Encrypted-field handling on `http-notification-v2` | Custom redaction | Mirror `update_input` D-12 STRICT_NO_ECHO from Phase 1 | `basicAuth` and `apiSecret` are `EncryptedValue`; same threat profile as `update_input` C3 |
| Response normalization | Per-handler shape munging | `req.normalize: (raw) => ({id, body})` | FOUND-08; M2 says `POST /events/definitions` returns 200 + full DTO (asymmetric with `POST /streams` → 201 + `{stream_id}`) |
| ID sentinel in dry-run | Custom placeholders | `__SERVER_ASSIGNED__` from `_shared/dry-run.js` | C6 pitfall; FOUND-04 ships this — visible to the agent in the `postApplyEstimate` slot |

**Key insight:** Every Phase 5 piece composes through Phase 0..4 primitives. The ONLY new client-side mechanic is the v6→v7 migrator (≈30 LOC). Don't reinvent any existing wheel — the cascade-hash, response normalizer, idempotency key, writable gate, schema-parity scaffold, snapshot harness are all shipped.

## Common Pitfalls

### Pitfall 1: `/paginated` envelope key vs deprecated bare path
**What goes wrong:** Existing v2.3 read tools hit `/api/events/definitions` (the bare, `@Deprecated` path) and consume `result.event_definitions: [...]`. The new Phase 5 list tools target `/paginated` which returns a `PageListResponse<EventDefinitionDto>` with `elements: [...]` (NOT `event_definitions`). Same story on notifications: bare path → `result.notifications`, paginated → `result.elements`.

**Why it happens:** `EventDefinitionsResource.list()` (line 247) is `@Deprecated` and uses `PaginatedResponse.create("event_definitions", ...)`; `EventDefinitionsResource.getPage()` (line 188) uses `PageListResponse.create(...)` which serializes as `{elements, pagination, attributes, defaults, total}`.

**How to avoid:** Use `/paginated` everywhere on Phase 5; consume `response.elements`. Update `_shared/conflict.js`'s envelope amendment to look for `elements` (not `event_definitions` or `notifications`).

**Warning signs:** Empty list returns when the cluster has dozens of event definitions — the wrapper is reading the wrong field name.

[VERIFIED: EventDefinitionsResource.java:188-245 (getPage) + 247-267 (list, @Deprecated); EventNotificationsResource.java:136-163 (getPage) + 165-176 (listNotifications, @Deprecated)]

### Pitfall 2: M2 — POST /events/definitions returns 200 with full DTO (not 201)
**What goes wrong:** Agent code that assumes "create returns 201 + `{id}`" parses the response wrong; the wrapper's response normalizer (FOUND-08) must extract `id` from the full DTO body.

**Why it happens:** `EventDefinitionsResource.create(...)` returns `Response.ok().entity(entity).build()` (line 332) — HTTP 200 with `EventDefinitionDto` as the body. Same for `EventNotificationsResource.create(...)` (line 205).

**How to avoid:** Set `req.normalize = (raw) => ({ id: raw?.id, body: raw })` on every Phase 5 create handler. Don't read from a `Location` header. Snapshot-test the apply-mode output for both tools to pin the `{id, body}` envelope.

**Warning signs:** Apply-mode result's `id` field is `undefined` — the wrapper is looking at the wrong response field.

[VERIFIED: EventDefinitionsResource.java:332; EventNotificationsResource.java:205]

### Pitfall 3: `create_event_definition` accepts an HTTP body wrapped in `CreateEntityRequest`
**What goes wrong:** Agent (or wrapper code) emits `body: { ...EventDefinitionDto fields }` directly; Graylog rejects with 400 because `create()` parameter type is `CreateEntityRequest<EventDefinitionDto>` (line 316), which is `{entity: <dto>, share_request: <ShareRequest|null>}`. The wrapper must wrap.

**Why it happens:** Same `CreateEntityRequest` wrapper Phase 3 hit for `create_stream` (per 03-CONTEXT.md mention).

**How to avoid:** `req.body = { entity: <dto>, share_request: null }`. Update precedent already exists in `src/tools/streams/create-stream.js` — copy the shape.

**Warning signs:** Live cluster returns 400 "Missing required field `entity`" when applying.

[VERIFIED: EventDefinitionsResource.java:316 + EventNotificationsResource.java:191 — both `CreateEntityRequest<T>` parameter]

### Pitfall 4: WILDCARD enable/disable + content-type still emitted by `src/graylog/client.js`
**What goes wrong:** The Phase 0 `makeClient(...)` sets `Content-Type: application/json` on every request. The schedule/unschedule endpoints accept any content type (`@Consumes(WILDCARD)`) so JSON header is harmless, but a `body: undefined` produces `data: undefined` in axios, which axios drops. **Verify:** does axios send `Content-Length: 0` with `data: undefined`? If not, the PUT lands with no Content-Length header at all — Graylog/Jetty has historically tolerated this, but some reverse proxies (nginx) strip such requests.

**Why it happens:** No body needed for these endpoints per `@Consumes(WILDCARD)`. The wrapper does NOT need to invent a body, but the absence of one matters for HTTP-layer hygiene.

**How to avoid:** Pass `body: undefined` (not `body: {}` — `{}` would serialize to `"{}"` 2 bytes which the agent might confuse for meaningful payload in dry-run). If a reverse proxy in front of Graylog rejects, the safer choice is `body: ""` which gives Content-Length: 0. Confirm against the live 7.0.6 cluster in U1-style smoke (Plan 01).

**Warning signs:** Apply returns 200 in test but 411 in prod ("Length Required").

[VERIFIED: EventDefinitionsResource.java:422 + 453 — `@Consumes(MediaType.WILDCARD)`; src/graylog/client.js default headers]

### Pitfall 5: `EventDefinitionContextService.SchedulerCtx` field on read responses
**What goes wrong:** `GET /api/events/definitions/{id}` returns the DTO with a populated `scheduler` field (`EventDefinitionDto.schedulerCtx()`); this field is `access = JsonProperty.Access.READ_ONLY` — agents that POST it back on update get a 400 because READ_ONLY can't be deserialized.

**Why it happens:** `EventDefinitionDto.java:148` — `@JsonProperty(value = FIELD_SCHEDULERCTX, access = JsonProperty.Access.READ_ONLY)`.

**How to avoid:** STRICT_NO_ECHO partial-update (D-10) — never round-trip the DTO. Build the PUT body from `changes: {field: value}` only.

**Warning signs:** Update returns 400 on a field-only change.

[VERIFIED: EventDefinitionDto.java:148-150]

### Pitfall 6: Discretion-02 resolution — only 5 of the 6 names are real on 7.2-source
**What goes wrong:** D-05 names `script-notification-v1` and `pagerduty-notification-v1`. **Neither exists.** PagerDuty's wire identifier is `pagerduty-notification-v2`. There is NO `script-notification-v1` anywhere in the 7.2-snapshot tree.

**Why it happens:** Researcher draft of CONTEXT.md guessed at notification types without source-walking the catalogue.

**How to avoid:** Researcher resolution — replace `script-notification-v1` and `pagerduty-notification-v1` with **`pagerduty-notification-v2`, `teams-notification-v2`, `http-notification-v1`**. See §"Notification Type Catalogue" for the verified 7-name catalogue and the 6 picked for the discriminator.

**Warning signs:** Live cluster returns 400 "Unknown notification type" when applying `pagerduty-notification-v1`.

[VERIFIED: `grep -rh 'String TYPE_NAME' .../notifications/types/ .../integrations/notifications/ .../integrations/pagerduty/` — see §"Notification Type Catalogue"]

### Pitfall 7: `_register.js` v2.3 displacement (S5 pattern)
**What goes wrong:** Forgetting to remove the existing `register("list_event_definitions", getEventDefinitionsHandler)` and `register("list_event_notifications", getEventNotificationsHandler)` lines from `src/tools/_register.js` causes the v2.3 hit-the-deprecated-bare-path implementation to win, since registration is order-dependent.

**Why it happens:** The new domain barrel `src/tools/events/index.js` imports first (top of `_register.js`), but the bottom of `_register.js` still has `register("list_event_definitions", getEventDefinitionsHandler)` lines that **overwrite** the new registrations.

**How to avoid:** Mirror the Phase 3 S5 displacement exactly: remove the old `getEventDefinitionsHandler` + `getEventNotificationsHandler` import + register lines from `_register.js`. Keep their function exports in `src/handlers.js` for HARD-03 audit reference. Add a comment block citing the Phase 3 precedent.

**Warning signs:** New `list_event_definitions` dry-run output doesn't include `narrow projection` — agent gets the v2.3 raw `axios.get` shape.

[VERIFIED: src/tools/_register.js:88-89 (current v2.3 registrations); src/tools/_register.js:54-57 (Phase 3 S5 comment block as template)]

### Pitfall 8: `EventDefinitionDto.id()` is `@Nullable` on input, server-assigned on output
**What goes wrong:** Agent's `definition.id` field on input has unclear semantics. The server-side `@Id @ObjectId @Nullable` annotation means the field is optional on POST (server assigns) but required on PUT (URL path + body must agree per `EventDefinitionsResource.update():354-356`).

**How to avoid:** On `create_event_definition`, zod schema makes `definition.id` `.optional()`; the wrapper strips it before POST. On `update_event_definition`, the wrapper FETCHES the current DTO and overlays only the agent's `changes` (STRICT_NO_ECHO), populating `dto.id` from the URL.

**Warning signs:** Update returns 400 "Event definition IDs don't match" — the agent's body has a stale id.

[VERIFIED: EventDefinitionDto.java:85-88; EventDefinitionsResource.java:354-356]

## Endpoint Catalogue

### Per-Tool Endpoint Map (11 tools)

| Tool | HTTP | Path | Response | Notes |
|------|------|------|----------|-------|
| `list_event_definitions` | GET | `/api/events/definitions/paginated?page=N&per_page=M&query=Q&sort=title&order=asc` | `PageListResponse<EventDefinitionDto>` → `{elements, pagination, attributes, defaults, total}` | Displaces v2.3; supports filter pre-check via narrow projection. NO `?stream_id=` filter on 7.0.6. |
| `get_event_definition` | GET | `/api/events/definitions/{id}` | full `EventDefinitionDto` (with `scheduler` ctx) | `get-event-definition.js`; plain ZodObject (not mutatingBase). |
| `create_event_definition` | POST | `/api/events/definitions?schedule=false` | **200** + full `EventDefinitionDto` (M2) | D-01; CreateEntityRequest wrapper; v6→v7 migration; existingMatches |
| `update_event_definition` | PUT | `/api/events/definitions/{id}?schedule=false` | **200** + full `EventDefinitionDto` | D-02 + D-10 STRICT_NO_ECHO; id must match URL |
| `delete_event_definition` | DELETE | `/api/events/definitions/{id}` | full `EventDefinitionDto` (the deleted body) | D-08 informational cascade; server throws 400 if other event_defs reference this via `EventResolver.dependentEvents()` |
| `enable_event_definition` | PUT | `/api/events/definitions/{id}/schedule` | full `EventDefinitionDto` (state=ENABLED) | D-07; empty body; @Consumes(WILDCARD) |
| `disable_event_definition` | PUT | `/api/events/definitions/{id}/unschedule` | full `EventDefinitionDto` (state=DISABLED) | D-07; empty body; @Consumes(WILDCARD) |
| `list_event_notifications` | GET | `/api/events/notifications/paginated?page=N&per_page=M&query=Q&sort=title&order=asc` | `PageListResponse<NotificationDto>` → `{elements, pagination, attributes, defaults, total}` | Displaces v2.3; narrow projection |
| `create_event_notification` | POST | `/api/events/notifications` | **200** + full `NotificationDto` | D-05 discriminator; CreateEntityRequest wrapper |
| `update_event_notification` | PUT | `/api/events/notifications/{id}` | **200** + full `NotificationDto` | D-10 STRICT_NO_ECHO |
| `delete_event_notification` | DELETE | `/api/events/notifications/{id}` | 204 No Content | D-09 cascade-hash + drift refusal |

### List Path Selection — `/paginated` vs Bare GET

Both `/api/events/definitions` and `/api/events/notifications` have a deprecated bare GET AND a non-deprecated `/paginated` variant.

| Variant | Envelope | Status | Use for Phase 5? |
|---------|----------|--------|------------------|
| `GET /api/events/definitions` (bare) | `{event_definitions: [...], total, ...}` | `@Deprecated` (line 247) | NO |
| `GET /api/events/definitions/paginated` | `{elements: [...], pagination, total, ...}` | current | **YES** |
| `GET /api/events/notifications` (bare) | `{notifications: [...], total, ...}` | `@Deprecated` (line 165) | NO |
| `GET /api/events/notifications/paginated` | `{elements: [...], pagination, total, ...}` | current | **YES** |

**Consequence for `_shared/conflict.js`:** the envelope amendment must look for `response.elements` (the `/paginated` shape) — NOT `response.event_definitions` or `response.notifications` (the bare-path shapes).

[VERIFIED: EventDefinitionsResource.java:188-245 (`getPage` returns `PageListResponse.create(...)`); 247-267 (`list()` `@Deprecated`, `PaginatedResponse.create("event_definitions",...)`); EventNotificationsResource.java:136-163 + 165-176; PageListResponse vs PaginatedResponse Jackson serialization conventions]

## Notification Type Catalogue (Discretion-02 Resolution)

### Source-Verified Catalogue (7.2-snapshot)

`grep -rh 'String TYPE_NAME' source-code/.../events/notifications/types/ source-code/.../integrations/notifications/ source-code/.../integrations/pagerduty/` returned the following sorted-uniqued set:

| Wire Type Name | Config Class | File | Notes |
|----------------|--------------|------|-------|
| `email-notification-v1` | `EmailEventNotificationConfig` | `events/notifications/types/EmailEventNotificationConfig.java:46` | Core (not plugin) |
| `http-notification-v1` | `HTTPEventNotificationConfig` | `events/notifications/types/HTTPEventNotificationConfig.java` | Core; legacy single-URL |
| `http-notification-v2` | `HTTPEventNotificationConfigV2` | `events/notifications/types/HTTPEventNotificationConfigV2.java:47` | Core; superset of v1 + headers + basicAuth + apiKey |
| `slack-notification-v1` | `SlackEventNotificationConfig` | `integrations/notifications/types/SlackEventNotificationConfig.java:46` | Plugin (graylog-integrations) |
| `pagerduty-notification-v2` | `PagerDutyNotificationConfig` | `integrations/pagerduty/PagerDutyNotificationConfig.java:49` | Plugin; **NOTE: -v2, not -v1 (D-05 draft was wrong)** |
| `teams-notification-v1` | `TeamsEventNotificationConfig` | `integrations/notifications/types/microsoftteams/TeamsEventNotificationConfig.java` | Plugin; legacy connector card |
| `teams-notification-v2` | `TeamsEventNotificationConfigV2` | `integrations/notifications/types/microsoftteams/TeamsEventNotificationConfigV2.java:42` | Plugin; adaptive card |
| `legacy-alarm-callback-notification-v1` | `LegacyAlarmCallbackEventNotificationConfig` | `events/legacy/LegacyAlarmCallbackEventNotificationConfig.java` | Core; generic fallback for any legacy alarm callback |
| `system-notifications-v1` | `SystemNotificationEventProcessorConfig` | `events/processor/systemnotification/SystemNotificationEventProcessorConfig.java` | **Not a notification — a system event processor config**; out of scope |
| `notification-execution-v1` | `EventNotificationExecutionJob` | `events/notifications/EventNotificationExecutionJob.java` | **Job trigger data — not a config type**; out of scope |

[VERIFIED: full grep output included above]

**There is NO `script-notification-v1` in the 7.2-snapshot source tree.** [VERIFIED]

### Recommended Discriminator (6 variants — D-05 update)

Replace the original D-05 list with:

1. `email-notification-v1` — core, universal
2. `http-notification-v1` — core, simple webhook (covers Discord too via custom URL)
3. `http-notification-v2` — core, **encrypted basicAuth + apiSecret** (C3-class encrypted-field handling)
4. `slack-notification-v1` — plugin, dominant chat notification
5. `pagerduty-notification-v2` — plugin (NOT `-v1`); incident routing
6. `teams-notification-v2` — plugin (NOT `-v1`); modern adaptive-card flow

**Rationale:** All six are in active use on 7.0.6+. `http-notification-v2` is the only one with encrypted fields, which gives the planner one path to exercise the C3 STRICT_NO_ECHO pattern on the notifications domain too. `teams-notification-v1` is excluded because v2's adaptive cards are the recommended migration target. `legacy-alarm-callback-notification-v1` is excluded by default (covers an arbitrary nested `type` discriminator inside `notification_parameters` — a recursive shape that doesn't fit a closed-set zod discriminated union without sub-discriminators).

### Per-Type Config Shapes (zod schema field map)

Drawn directly from the `@JsonProperty(FIELD_*)` declarations in each config class. Defaults shown match the Java Builder defaults.

#### `email-notification-v1` (EmailEventNotificationConfig)
[VERIFIED: EmailEventNotificationConfig.java:46-219]

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `sender` | string | optional | `"graylog@example.org"` | Falls back to graylog.conf default if absent |
| `reply_to` | string | optional | `""` | |
| `subject` | string | **required** (NotBlank) | `"${product_name} event notification: ${event_definition_title}"` | |
| `body_template` | string | optional* | (long default template) | *one of body_template OR html_body_template required |
| `html_body_template` | string | optional* | `""` | |
| `email_recipients` | string[] | optional | `[]` | Either this OR `user_recipients` OR `lookup_recipient_emails=true` |
| `user_recipients` | string[] | optional | `[]` | |
| `time_zone` | string (timezone) | optional | `"UTC"` | Joda DateTimeZone |
| `lookup_recipient_emails` | boolean | optional | `false` | If true, `recipients_lut_name` + `recipients_lut_key` required |
| `recipients_lut_name` | string\|null | conditional | null | |
| `recipients_lut_key` | string\|null | conditional | null | |
| `lookup_sender_email` | boolean | optional | `false` | + `sender_lut_*` if true |
| `sender_lut_name` | string\|null | conditional | null | |
| `sender_lut_key` | string\|null | conditional | null | |
| `lookup_reply_to_email` | boolean | optional | `false` | + `reply_to_lut_*` if true |
| `reply_to_lut_name` | string\|null | conditional | null | |
| `reply_to_lut_key` | string\|null | conditional | null | |
| `single_email` | boolean | optional | `false` | Send one mail with all recipients in TO |
| `cc_users` | string[] | optional | `[]` | |
| `cc_emails` | string[] | optional | `[]` | |
| `lookup_cc_emails` | boolean | optional | `false` | + `cc_emails_lut_*` if true |
| `cc_emails_lut_name` | string\|null | conditional | null | |
| `cc_emails_lut_key` | string\|null | conditional | null | |
| `bcc_users` | string[] | optional | `[]` | |
| `bcc_emails` | string[] | optional | `[]` | |
| `lookup_bcc_emails` | boolean | optional | `false` | + `bcc_emails_lut_*` if true |
| `bcc_emails_lut_name` | string\|null | conditional | null | |
| `bcc_emails_lut_key` | string\|null | conditional | null | |
| `include_event_procedure` | boolean | optional | `false` | |

#### `http-notification-v1` (HTTPEventNotificationConfig)
[VERIFIED: HTTPEventNotificationConfig.java]

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `url` | string (URI) | required | — | |

(Yes — v1 is genuinely that minimal. Use v2 for anything with headers/auth.)

#### `http-notification-v2` (HTTPEventNotificationConfigV2)
[VERIFIED: HTTPEventNotificationConfigV2.java:47-110]

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `url` | string (URI) | required | — | |
| `method` | enum: `POST`/`PUT`/`GET` | required | `POST` | |
| `time_zone` | string | optional | `"UTC"` | |
| `content_type` | enum: `JSON`/`FORM_DATA`/`PLAIN_TEXT` | optional | `JSON` | Nullable |
| `headers` | string | optional | null | Raw header string (multi-line) |
| `body_template` | string | optional | null | Mustache-style template |
| `skip_tls_verification` | boolean | optional | `false` | |
| `basic_auth` | EncryptedValue (string) | optional | null | **C3-class encrypted field** — STRICT_NO_ECHO |
| `api_key_as_header` | boolean | optional | `false` | If true: header; else query string |
| `api_key` | string | optional | null | |
| `api_secret` | EncryptedValue (string) | optional | null | **C3-class encrypted field** — STRICT_NO_ECHO |

#### `slack-notification-v1` (SlackEventNotificationConfig)
[VERIFIED: SlackEventNotificationConfig.java:46-178]

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `color` | string (hex) | required (NotBlank) | `"#ff0500"` | `^#[0-9a-fA-F]{6}$` |
| `webhook_url` | string (URI) | required (NotBlank) | `"https://hooks.slack.com/services/xxx/xxxx/xxx..."` | Validates against Slack or Discord URL patterns |
| `channel` | string | required (NotBlank) | `"#general"` | |
| `custom_message` | string | optional | `"${product_name} Slack Notification"` | If empty + `include_title=false`, validation error |
| `user_name` | string\|null | optional | null | |
| `notify_channel` | boolean | optional | `false` | XOR with `notify_here` |
| `notify_here` | boolean | optional | `false` | XOR with `notify_channel` |
| `link_names` | boolean | optional | `false` | |
| `icon_url` | string\|null | optional | null | |
| `icon_emoji` | string\|null | optional | null | |
| `backlog_size` | long | optional | `0` | Must be ≥0 |
| `time_zone` | string | optional | `"UTC"` | |
| `include_title` | boolean | required | `true` | If false, `custom_message` MUST be non-empty |
| `include_event_procedure` | boolean | optional | `false` | |

#### `pagerduty-notification-v2` (PagerDutyNotificationConfig)
[VERIFIED: PagerDutyNotificationConfig.java:49-120]

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `routing_key` | string | required | — | **Must be exactly 32 chars** |
| `custom_incident` | boolean | required | `false` | If true: `key_prefix` OR `incident_key` required |
| `key_prefix` | string | conditional | `""` | |
| `client_name` | string | required | — | Non-empty |
| `client_url` | string (HTTP/HTTPS URI) | required | — | Validated http/https scheme |
| `pager_duty_title` | string (optional) | optional | (none) | Java Optional, serialized as nullable |
| `incident_key` | string (optional) | optional | (none) | Java Optional, serialized as nullable |

#### `teams-notification-v2` (TeamsEventNotificationConfigV2)
[VERIFIED: TeamsEventNotificationConfigV2.java:42-110]

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `webhook_url` | string (URI) | required (NotBlank) | `"https://server.region.logic.azure.com:443/workflows/xxxx"` | |
| `adaptive_card` | string (JSON) | required | (long default adaptive-card JSON string) | Body of the MS Teams card; must parse as JSON |
| `backlog_size` | long | optional | `0` | Must be ≥0 |
| `time_zone` | (deprecated) | optional | UTC | `@Deprecated` — for back-compat deserialization only; do NOT emit in new configs |

### Per-Type Field Counts and Encrypted-Field Inventory

| Variant | Field count | Encrypted fields | Refinement needed |
|---------|-------------|------------------|-------------------|
| `email-notification-v1` | ~28 | none | recipients-or-lookup XOR |
| `http-notification-v1` | 1 | none | URL validation |
| `http-notification-v2` | 11 | `basic_auth`, `api_secret` | C3 STRICT_NO_ECHO redaction |
| `slack-notification-v1` | 14 | none | notify_channel XOR notify_here, channel-non-empty, color regex |
| `pagerduty-notification-v2` | 7 | none | routing_key length=32, http/https URL |
| `teams-notification-v2` | 4 | none | URL validation, adaptive_card JSON-parses |

## M1 Mitigation Anatomy

### `create_event_definition` Wire Form (D-01)

```http
POST /api/events/definitions?schedule=false HTTP/1.1
Content-Type: application/json
X-Requested-By: graylog-mcp

{
  "entity": {
    "title": "App Error Spike",
    "description": "Alert when error rate exceeds 100/min",
    "priority": 2,
    "alert": true,
    "config": {
      "type": "aggregation-v1",
      "query": "level:>=4",
      "streams": ["66e8...stream-id..."],
      "group_by": ["source"],
      "series": [
        {"type": "count", "id": "count_source", "field": "source"}
      ],
      "conditions": {
        "expression": {
          "expr": ">",
          "left":  {"expr": "number-ref", "ref": "count_source"},
          "right": {"expr": "number",     "value": 100}
        }
      },
      "search_within_ms": 60000,
      "execute_every_ms": 60000,
      "use_cron_scheduling": false,
      "event_limit": 100
    },
    "field_spec": {},
    "key_spec": [],
    "notification_settings": {
      "grace_period_ms": 0,
      "backlog_size": 0
    },
    "notifications": [],
    "storage": [
      {"type": "persist-to-streams-v1", "streams": ["000000000000000000000002"]}
    ],
    "state": "DISABLED"
  },
  "share_request": null
}
```

**Crucial:** `?schedule=false` is on the WIRE PATH, regardless of agent input. The wrapper does NOT accept a `schedule` arg from the agent; the agent uses `enable_event_definition` to turn scheduling on after create.

### `update_event_definition` (D-02) — STRICT_NO_ECHO

Update follows the Phase 1 `update_input` D-12 STRICT_NO_ECHO pattern: agent passes `changes: {...subset of fields...}`; wrapper fetches the current DTO, merges only the changes, sends `PUT /api/events/definitions/{id}?schedule=false`. The schedule param is FALSE — partial updates do not re-enable.

Encrypted fields (the `http-notification-v2` `basic_auth` and `api_secret`) are handled the same way as Phase 1 inputs — never round-tripped from a GET, only emitted when the agent explicitly passed a new value. **EventDefinitionDto has NO encrypted fields** — encrypted-field handling matters only for `update_event_notification` on `http-notification-v2` shapes.

### enable/disable Wire Form (D-07)

```http
PUT /api/events/definitions/{id}/schedule HTTP/1.1
X-Requested-By: graylog-mcp
Content-Length: 0
```

(No body. `@Consumes(WILDCARD)` accepts but doesn't read.)

Returns 200 + full `EventDefinitionDto` with `state: "ENABLED"`. `disable` is symmetric: `PUT /api/events/definitions/{id}/unschedule` → 200 + DTO with `state: "DISABLED"`.

[VERIFIED: EventDefinitionsResource.java:420-432 (schedule) + 451-463 (unschedule)]

## EventDefinitionDto Field Shape (for snapshot fixtures)

Full DTO surface as serialized by Graylog 7.2-snapshot:

```json
{
  "id": "66e8a4bce8f3a4001b88c123",
  "title": "App Error Spike",
  "description": "Alert when error rate exceeds 100/min",
  "remediation_steps": null,
  "updated_at": "2026-05-15T12:34:56.789Z",
  "matched_at": null,
  "priority": 2,
  "alert": true,
  "config": { ...EventProcessorConfig (discriminated by type)... },
  "field_spec": {},
  "key_spec": [],
  "notification_settings": {"grace_period_ms": 0, "backlog_size": 0},
  "notifications": [
    {"notification_id": "66e8...notif-id...", "notification_parameters": null}
  ],
  "storage": [
    {"type": "persist-to-streams-v1", "streams": ["000000000000000000000002"]}
  ],
  "scheduler": {  // READ_ONLY — do not round-trip
    "is_scheduled": true,
    "concurrency": 0,
    "data": null,
    "next_time": "2026-05-15T12:35:00.000Z",
    "queued_notifications": 0,
    "triggered_at": null,
    "trigger_status": null,
    "trigger_status_describe": null
  },
  "state": "ENABLED",
  "event_procedure": null,
  "event_summary_template": null
}
```

[VERIFIED: EventDefinitionDto.java:65-170; EventNotificationHandler.Config nested type for the `notifications[]` entries]

### Notifications nested type

`EventNotificationHandler.Config` carries `{notification_id: string, notification_parameters: object|null}`. The `notification_id` field is the FK Phase 5 D-08 reads to enumerate dependents.

[VERIFIED: EventNotificationHandler.java]

## Cascade-Hash Reuse (D-09)

### Inputs

```javascript
// Recommended thin wrapper for call-site clarity (mirrors Phase 4's
// computeRuleCascadeHash pattern in src/tools/_shared/cascade-hash.js:147-184).
export function computeNotificationCascadeHash({ notificationId, eventDefIds }) {
    if (typeof notificationId !== "string" || notificationId.length === 0) {
        throw new Error("computeNotificationCascadeHash: notificationId is required");
    }
    if (!Array.isArray(eventDefIds)) {
        throw new Error("computeNotificationCascadeHash: eventDefIds must be string[]");
    }
    return computeCascadeHash({
        streamId: notificationId,   // slot reuse
        ruleIds: [],
        pipelineConnIds: [],
        eventDefIds,
    });
}
```

**Canonical JSON shape (LOCKED for snapshot byte-identity):**
```json
{
  "streamId": "<notificationId>",
  "cascades": {
    "rules": [],
    "pipeline_connections": [],
    "event_definitions": ["<sortedEventDefId1>", "<sortedEventDefId2>"]
  }
}
```

The `event_definitions` bucket sorts its entries before sha-256-hashing. The hash differs from any equivalent `delete_stream` hash because the empty `rules` + `pipeline_connections` buckets distinguish the canonical shape per the keyed-buckets D-02 design. Phase 3 hashes and Phase 5 hashes are not byte-collision-prone — the `streamId` slot carries a notification ID here, which is type-distinct from a stream ID at the consumer site (the apply-time re-fetch path).

[CITED: src/tools/_shared/cascade-hash.js:119-141 (computeCascadeHash) + 147-184 (computeRuleCascadeHash thin-wrapper pattern)]

### Drift Refusal Path

Mirror `delete-stream.js:225-257` exactly. apply() re-fetches the paginated event-definition list, re-runs the client-side filter on `def.notifications[].notification_id`, recomputes hash, returns `{isError: true, reason: "cascade_changed_since_preview"}` on mismatch. handler.js passes the envelope through verbatim (handler.js:209-211).

## Snapshot Fixture Design (Discretion-04 — 12 fixtures)

| # | Fixture | Proves |
|---|---------|--------|
| 1 | `list_event_definitions` dry-run (read tool — apply only, since list is GET) | Narrow projection + `/paginated` envelope unwrap |
| 2 | `get_event_definition` apply | Full DTO shape including `scheduler` ctx + `notifications[]` (informational cascade input) |
| 3 | `create_event_definition` dry-run (no v6 shape) | M1 ACCEPTANCE GATE: `wouldStartScheduling: false` AND wire path includes `?schedule=false` + `__SERVER_ASSIGNED__` id in postApplyEstimate |
| 4 | `create_event_definition` dry-run (v6 shape input) | C5 ACCEPTANCE GATE: `migration: {migrated: true, warnings: [{original:..., emitted: "count_source"}]}` + emitted body uses v7 form `count_source` |
| 5 | `update_event_definition` dry-run | STRICT_NO_ECHO partial-update; wire path includes `?schedule=false`; encrypted-field absent (n/a but worth pinning for consistency) |
| 6 | `delete_event_definition` dry-run (D-08, 2 notifications referenced) | Informational cascade: `cascades.notifications: [{id, title}, {id, title}]`; NO confirmationToken issued |
| 7 | `enable_event_definition` dry-run | Wire shape: `PUT /api/events/definitions/{id}/schedule`, `body: undefined`, no Content-Type fakery |
| 8 | `disable_event_definition` dry-run | Wire shape: `PUT /api/events/definitions/{id}/unschedule`, `body: undefined` |
| 9 | `list_event_notifications` apply | Narrow projection + `/paginated` envelope unwrap |
| 10 | `create_event_notification` dry-run (slack-notification-v1) | D-05 discriminator: type=slack accepted; notify_channel/notify_here XOR refined |
| 11 | `create_event_notification` dry-run (invalid type rejected at zod) | Discretion-02 / D-06: `type: "script-notification-v1"` → ZodError BEFORE any HTTP |
| 12 | `delete_event_notification` dry-run (3 event_defs referencing) + apply with stale hash | D-09 ACCEPTANCE GATE: cascade-hash byte-identity + `cascade_changed_since_preview` on drift |

Optional 13th fixture (recommend for Plan 05): `create_event_notification` with `http-notification-v2` + encrypted fields → STRICT_NO_ECHO byte-comparison of dry-run body (`basic_auth` + `api_secret` ABSENT when agent passed a no-op).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Aggregation runtime key = `series.literal()` (e.g. `count(source)`) | Aggregation runtime key = `function_field` (e.g. `count_source`) | Graylog 7.1 (pr-24703, commit 502cd61f87) | C5 — agent's v6 mental model breaks because the EMITTED keys at event-fire are different shape than the agent expects to match in `conditions.expression` references |
| `POST /events/definitions` accepting bare DTO body | `POST /events/definitions` requiring `CreateEntityRequest<EventDefinitionDto>` | Pre-7.0 → 7.0+ (entity-share refactor) | The wrapper MUST wrap (D-12 carry-forward) |
| Email Java mail Address validation | Email **+ Discord URL** validation in Slack notification config | 7.0-7.2 | `slack-notification-v1` accepts Discord webhook URLs too — surface this in tool description |
| `/api/events/definitions` bare list endpoint | `/api/events/definitions/paginated` | Pre-7.0 → 7.0+ | Bare path `@Deprecated`; v2.3 hits the deprecated path (HARD-03 audit item) |

**Deprecated/outdated:**
- `script-notification-v1` notification type — **does not exist** in 7.2-source. Replace in D-05 with `pagerduty-notification-v2` / `teams-notification-v2` / `http-notification-v1`.
- `teams-notification-v1` — still defined but superseded by v2's adaptive cards.
- `time_zone` field on `teams-notification-v2` — `@Deprecated` annotation, retained for back-compat deserialization.

## Assumptions Log

> Every claim below has been verified by either source-walk or git-pickaxe. No assumptions remain — all formerly `[ASSUMED]` claims in the D-05 draft notification type list have been resolved by source-walk and updated above.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | (none) | — | — |

**Result:** All claims tagged either `[VERIFIED: ...]` or `[CITED: ...]`. The Discretion-02 D-05 draft list contained two unverified type names (`script-notification-v1`, `pagerduty-notification-v1`); both have been **corrected** via source-walk and the corrected catalogue is in §"Notification Type Catalogue".

## Open Questions (RESOLVED)

> **RESOLVED 2026-05-15:** All three questions below have inline recommendations consumed by the plans — Q1 → Plan 03 documents aggregation-v1 scope (dependent-events out of scope); Q2 → Plan 01 ships `05-U1-SMOKE.md` artifact; Q3 → Plan 01 schemas.js includes the superRefine for field_spec ⊇ key_spec.

1. **Should `delete_event_definition` (D-08) ALSO pre-flight for dependent events via `eventResolver.dependentEvents(definitionId)`?**
   - What we know: Graylog's server-side `delete()` (EventDefinitionsResource.java:373-400) throws `ValidationFailureException` if other event_defs reference this one as a correlation parent.
   - What's unclear: D-08 currently only enumerates notifications-the-def-references. It does NOT enumerate event_defs-that-reference-this-def. A delete that triggers a server-side ValidationFailureException leaves the agent with a 400 it has to parse.
   - Recommendation: planner adds a SECOND pre-flight in `delete_event_definition.build()` — paginated walk + client-side filter on whether any `def.config.events[]` (if the type is a correlation type — not currently in Phase 5 scope) references the target. For Phase 5's `aggregation-v1`-only scope, this is likely a no-op (aggregation defs don't reference other defs). Document explicitly that D-08's informational cascade covers only notifications, and a server-side 400 from `dependentEvents` would manifest as a `wrapGraylogError` 400 surfaced via the standard error envelope.

2. **Does U1-style live-smoke on `enable_event_definition` confirm `body: undefined` is accepted vs needing `body: ""`?**
   - What we know: `@Consumes(WILDCARD)` accepts any content type. axios with `data: undefined` does not emit a Content-Length: 0 header; with `data: ""` it does.
   - What's unclear: whether the live 7.0.6 cluster's Jetty (or any reverse proxy in front of it) requires Content-Length: 0.
   - Recommendation: Plan 01 includes a U1-style decision artifact (`05-U1-SMOKE.md`) that probes `PUT /api/events/definitions/{nonexistent-id}/schedule` with both `body: undefined` and `body: ""` and records which the live cluster accepts. Default to `body: undefined` (more defensive). If smoke fails, flip to `body: ""`.

3. **Does the `field_spec` map require ALL fields referenced in `key_spec` to be present?**
   - What we know: `EventDefinitionDto.validate()` (line 200+) asserts `keySpec().stream().anyMatch(key -> !fieldSpec().containsKey(key))` — server-side validation.
   - What's unclear: Whether the zod schema should mirror this constraint client-side, or let the server 400 it.
   - Recommendation: zod-side `.refine()` on the DTO shape that asserts `Object.keys(field_spec)` ⊇ `key_spec`. Catches the agent's error before HTTP. Snapshot fixture #11-adjacent could pin the rejection.

## Environment Availability

> Phase 5 is purely code/config — no new external dependencies beyond what Phase 0..4 already require.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All tools | ✓ (engine: >=20.6.0 per Phase 0) | (per package.json) | — |
| Live Graylog at `http://<graylog-host>` | U1-style smoke + verify-work | (assumed available per PROJECT.md "Graylog test environment" section) | 7.0.6 (Noir) | Skip live smoke; planner falls back to RESEARCH.md endpoint shapes. Phase 5 acceptance still passes via mocked tests; deferred E2E goes to `/gsd-verify-work`. |
| `node:test` snapshot harness | Plan 05 fixture suite | ✓ (Phase 0 FOUND-07) | builtin | — |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:** Live Graylog connectivity for U1-style smoke is the only soft-dep. If unavailable, Plan 01 produces an explicit `body: undefined` default with a CHANGELOG note that this is unverified against live 7.0.6.

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (Node.js builtin) |
| Config file | none — direct `node --test test/*.test.js` |
| Quick run command | `node --test test/events.test.js` (Phase 5 file once Plan 01 lands) |
| Full suite command | `node --test` (runs every `test/*.test.js`) |
| Snapshot mode | `node --test --test-update-snapshots test/events.test.js` (regenerate); `node --test test/events.test.js` (compare) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EVENT-01 | `list_event_definitions` narrow projection + `/paginated` unwrap | unit (snapshot) | `node --test test/events.test.js` | ❌ Wave 0 — `test/events.test.js` does not yet exist |
| EVENT-02 | `get_event_definition` full DTO | unit | `node --test test/events.test.js` | ❌ Wave 0 |
| EVENT-03 | M1: `wouldStartScheduling: false` + `?schedule=false` | unit (M1 ACCEPTANCE GATE snapshot) | `node --test test/events.test.js` | ❌ Wave 0 |
| EVENT-03 | C5: v6→v7 visible migration | unit (C5 ACCEPTANCE GATE snapshot) | `node --test test/events.test.js` | ❌ Wave 0 |
| EVENT-04 | STRICT_NO_ECHO update + `?schedule=false` | unit | `node --test test/events.test.js` | ❌ Wave 0 |
| EVENT-05 | D-08 informational cascade (no token) | unit | `node --test test/events.test.js` | ❌ Wave 0 |
| EVENT-06 | enable/disable empty-body wire shape | unit | `node --test test/events.test.js` | ❌ Wave 0 |
| EVENT-07 | `list_event_notifications` narrow projection | unit | `node --test test/events.test.js` | ❌ Wave 0 |
| EVENT-08 | discriminator: 5 valid variants accepted + 1 invalid rejected | unit | `node --test test/events.test.js` | ❌ Wave 0 |
| EVENT-08 | http-notification-v2 STRICT_NO_ECHO on encrypted fields | unit (C3-class) | `node --test test/events.test.js` | ❌ Wave 0 |
| EVENT-09 | D-09 cascade-hash byte-identity + drift refusal | unit (D-09 ACCEPTANCE GATE snapshot) | `node --test test/events.test.js` | ❌ Wave 0 |
| EVENT-09 | `update_event_notification` STRICT_NO_ECHO | unit | `node --test test/events.test.js` | ❌ Wave 0 |
| FOUND-13 | Schema-parity assertions for all 11 tools | unit (extension of `test/schema-parity.test.js`) | `node --test test/schema-parity.test.js` | ✓ exists; extend in Plan 05 |

### Sampling Rate

- **Per task commit:** `node --test test/events.test.js test/schema-parity.test.js` (~3–5 sec when fixtures are populated)
- **Per wave merge:** `node --test` (full suite — ~30–60 sec for Phase 5 + all prior phases)
- **Phase gate:** Full suite green + auth-redaction lint clean + 12 snapshot fixtures byte-identical before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `test/events.test.js` — covers EVENT-01..EVENT-09 (12 fixtures per Discretion-04 + 1 optional encrypted-field fixture for `http-notification-v2`)
- [ ] `test/__snapshots__/events.test.js.snapshot` — auto-generated on first `--test-update-snapshots` pass
- [ ] No new framework install needed — `node:test` is builtin (Phase 0 FOUND-06)
- [ ] `test/schema-parity.test.js` extension — 11 new `assertSchemaParityForTool(...)` calls (Plan 05)
- [ ] `test/cascade-hash.test.js` extension — 2 new byte-identity assertions for `computeNotificationCascadeHash` (Plan 04 or Plan 05; mirrors Phase 4's pattern)

## Security Domain

> `workflow.security_enforcement` is not set in config.json — treating as ENABLED (default).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing Phase 0 connection registry + API token; no Phase 5 changes |
| V3 Session Management | no | Stateless MCP; per-call connection resolution |
| V4 Access Control | yes | Graylog server-side `@RequiresPermissions(EVENT_DEFINITIONS_CREATE/EDIT/DELETE)` enforces RBAC; insufficient perms surface as 403 per CLAUDE.md auth model |
| V5 Input Validation | yes | zod schemas per tool; closed-set discriminator on notification type; v6→v7 migration's closed-enum refinement (D-04) |
| V6 Cryptography | yes | `http-notification-v2` has encrypted fields (`basic_auth`, `api_secret` are Graylog `EncryptedValue`); STRICT_NO_ECHO (D-10) prevents zeroing them on partial update — same C3 mitigation Phase 1 ships for `update_input` |
| V7 Error Handling | yes | Existing `wrapGraylogError` + structured `isError` envelopes from Phase 0; reused for all 11 tools |
| V9 Communication | yes | TLS to Graylog (existing); no new endpoints |
| V12 Files & Resources | no | No file I/O in Phase 5 |
| V14 Configuration | yes | `confirmationToken` allowlist + structural FQCN recognition in auth-redaction lint (Phase 2/3/4 carry-forward) |

### Known Threat Patterns for Phase 5

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Agent inverts M1 by passing explicit `schedule: true` arg | Tampering | **Schema-level rejection**: the wrapper schema for `create/update_event_definition` does NOT accept a `schedule` field. There is no way for the agent to flip the wire path. D-01 is structurally enforced. |
| Agent constructs v6 aggregation hoping for silent migration | Repudiation (audit log doesn't capture the migration) | D-03/D-04 **visible** migration: the dry-run output contains `{migrated_from_v6_shape: true, original, emitted}`; the agent acknowledges the rewrite by applying the dry-run output. No silent path. |
| Agent provides arbitrary `type: "custom-notification"` to bypass closed-set validation | Tampering | D-06 zod `discriminatedUnion("type", [...])` rejects at parse — no HTTP call, no Graylog audit-log entry, no side effect. |
| Agent retries `delete_event_notification` after a network blip and creates orphan event_defs | Repudiation | D-09 cascade-hash + drift refusal + Phase 0 idempotency-key dedupe; replay of stale hash → `cascade_changed_since_preview` refusal. |
| Agent reads `http-notification-v2` and POSTs back zeroing encrypted fields | Information Disclosure / Tampering | D-10 STRICT_NO_ECHO + C3-pattern: encrypted fields never round-tripped through the wrapper. Snapshot fixture (optional #13) pins byte-identity for no-op updates. |
| Wrapper-bypass via direct `axios.post(...)` from a future service-layer | Tampering | Defense-in-depth: `src/graylog/client.js`'s writable-flag gate refuses non-GET against `conn.writable === false` (Phase 0 Plan 03 / Pitfall 4) — even if a future caller bypasses the wrapper. |
| Agent forges `confirm: <hash>` for an unauthorized `delete_event_notification` | Tampering | `confirmationToken` is sha-256 of canonical cascade JSON — agent cannot compute it without knowing the live cluster state; D-09 re-fetch at apply-time prevents stale hashes. |
| Sensitive notification config fields (slack `webhook_url`, pagerduty `routing_key`) appearing in snapshot fixtures | Information Disclosure | auth-redaction lint regex-level placeholder + structural FQCN recognition (Phase 2/3/4 carry-forward) inherits automatically; no per-fixture opt-in. Plan 05 extends the allowlist with the new tool's `confirmationToken` if needed. |

## Sources

### Primary (HIGH confidence)

- **`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/events/rest/EventDefinitionsResource.java`** — endpoint catalogue, schedule defaults, WILDCARD enable/disable, response shapes (200 + DTO), `CreateEntityRequest` wrapper, dependentEvents() server-side check
- **`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/events/rest/EventNotificationsResource.java`** — notification CRUD endpoints, paginated vs deprecated bare path, email config validation
- **`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog/events/processor/EventDefinitionDto.java`** — DTO field shape, scheduler READ_ONLY, id @Nullable on input
- **`source-code/.../events/notifications/types/EmailEventNotificationConfig.java`** + **`HTTPEventNotificationConfigV2.java`** — per-type config schemas
- **`source-code/.../integrations/notifications/types/SlackEventNotificationConfig.java`** + **`microsoftteams/TeamsEventNotificationConfigV2.java`** + **`integrations/pagerduty/PagerDutyNotificationConfig.java`** — plugin notification configs (Slack, Teams v2, PagerDuty v2)
- **`source-code/graylog2-server/changelog/7.1.0-rc.1/pr-24703.toml`** + **`git show 502cd61f87 -- AggregationSearchUtils.java`** — v6→v7 aggregation-key change source-truth
- **`source-code/.../plugins/views/search/searchtypes/pivot/series/{Count,Sum,Average,Min,Max,StdDev,Percentile,Cardinality}.java`** — the 8 named function TYPE_NAME constants for D-04
- **`source-code/.../events/conditions/Expr.java`** — aggregation condition expression node types (And, Or, Not, Greater, Equal, NumberReference, etc.) for the v6→v7 migrator
- **`src/tools/streams/delete-stream.js`** — direct analog for D-09 (cascade-hash + drift refusal + paginated walk)
- **`src/tools/inputs/delete-input.js`** — direct analog for D-08 (informational cascade)
- **`src/tools/_shared/cascade-hash.js`** — `computeCascadeHash` keyed-buckets + Phase 4 `computeRuleCascadeHash` thin-wrapper pattern
- **`src/tools/_shared/handler.js`** — `defineMutatingHandler` factory invariants

### Secondary (MEDIUM confidence)

- **`.planning/research/PITFALLS.md` §M1, §M2, §C5, §C6** — pitfall-anchored decision drivers
- **`.planning/phases/03-streams-stream-rules/03-CONTEXT.md` D-02/D-03/D-04** — cascade-hash + drift refusal precedent
- **`.planning/phases/04-pipelines-pipeline-rules-connections/04-CONTEXT.md` D-10/D-11** — discriminated union precedent
- **`.planning/phases/01-inputs-extractors/01-CONTEXT.md` D-12** — STRICT_NO_ECHO partial-update precedent

### Tertiary (LOW confidence — needs U1-smoke confirmation)

- **`body: undefined` vs `body: ""` for empty WILDCARD enable/disable** — needs live-cluster smoke (Open Question 2)
- **Server-side enforcement of `field_spec` ⊇ `key_spec`** — needs live 400-response inspection (Open Question 3)
- **Whether `dependentEvents()` returns non-empty for `aggregation-v1` definitions on 7.0.6** — needs live cluster test (Open Question 1)

## Metadata

**Confidence breakdown:**
- Endpoint catalogue: HIGH — source-walked every `@Path` annotation
- Notification type catalogue: HIGH — grep+source-walk verified; corrected D-05 draft
- v6→v7 migration: HIGH — git show + pr-24703 + AggregationSearchUtils diff (commit 502cd61f87)
- EventDefinitionDto field shape: HIGH — direct DTO source walk
- Cascade-hash mechanics: HIGH — direct reuse of shipped Phase 3/4 helper; byte-identity covered by existing tests
- Snapshot fixture design: HIGH — Phase 1..4 pattern + acceptance-gate criteria from ROADMAP SC1..SC4
- WILDCARD body shape: MEDIUM — needs U1-smoke
- `_paginated` envelope keys on live 7.0.6: MEDIUM — verified against 7.2-snapshot source; should be identical on 7.0.6 but live confirmation recommended

**Research date:** 2026-05-15
**Valid until:** 2026-06-15 (30 days — Graylog 7.0.6 is stable; v6→v7 migration claim is anchored to a specific commit so it doesn't expire)

---

*Phase: 05-events-notifications*
*Research complete: 2026-05-15*
