// EVENT-06 part A — enable_event_definition. PUT /api/events/definitions/{id}/schedule.
//
// D-07 (Pitfall 4 — WILDCARD empty body): Graylog's
// `@Consumes(MediaType.WILDCARD)` accepts but IGNORES the body on
// /schedule + /unschedule. The agent does NOT construct a fake body; the
// wrapper sends the empty-body shape decided in 05-U1-SMOKE.md.
//
// Lifecycle-as-mutation contract (D-08 / Phase 1 INPUT-07 precedent —
// start_input + stop_input): composes through defineMutatingHandler so
// dryRun:true default + writable-flag gate + idempotency-key dedupe +
// zod validation + structured error envelopes inherit uniformly. No
// special-cased "runtime-only" path; lifecycle transitions are mutations.
//
// Pitfall 4 body shape — locked per 05-U1-SMOKE.md decision artifact:
//   UNREACHABLE branch (current) → body: undefined.
//     axios emits NO Content-Length header; preview JSON omits the key.
//   REACHABLE-WITH-DIVERGENCE branch → body: "".
//     axios emits Content-Length: 0; preview JSON shows preview.body === "".
//
// If a proxy in front of the live cluster ever returns 411/415, flip the
// module-level ENABLE_DISABLE_EMPTY_BODY constant to "" — wire-additive
// change, no back-compat break for round-tripped dry-run previews.
//
// Pitfall 2 / M2 — apply envelope: Graylog returns 200 + full EventDefinitionDto
// (with `state: "ENABLED"`). normalize() extracts id from raw.id so the agent
// sees the canonical {id, body} shape (FOUND-08).
//
// postApplyEstimate.id is args.definitionId (NOT __SERVER_ASSIGNED__) — the
// definition already exists; this is a state transition, not a create.
// state: "ENABLED" surfaces the eventually-consistent target so the agent
// can compare against get_event_definition's post-apply scheduler.is_scheduled.

import { defineMutatingHandler } from "../_shared/handler.js";
import { EnableEventDefinitionSchema } from "./schemas.js";
import { toIdBody } from "../../graylog/normalize.js";

// 05-U1-SMOKE.md UNREACHABLE → body: undefined. Sibling disable-event-
// definition.js mirrors this constant. If a third consumer ever shows up
// (Plan 05-04 currently does NOT — delete_event_notification uses JSON
// bodies), refactor into a shared module under src/tools/events/.
const ENABLE_DISABLE_EMPTY_BODY = undefined;

export const handleEnableEventDefinition = defineMutatingHandler({
    name: "enable_event_definition",
    schema: EnableEventDefinitionSchema,
    build: (args) => ({
        method: "PUT",
        path: `/api/events/definitions/${args.definitionId}/schedule`,
        body: ENABLE_DISABLE_EMPTY_BODY,
        postApplyEstimate: { id: args.definitionId, state: "ENABLED" },
        normalize: (raw) => toIdBody(raw, { idFields: ["id"] }),
    }),
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        `Enable scheduling for event definition ${args.definitionId} (eventually consistent — poll get_event_definition for state:"ENABLED")`,
});
