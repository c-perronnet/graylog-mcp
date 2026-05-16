// EVENT-06 part B — disable_event_definition. PUT /api/events/definitions/{id}/unschedule.
//
// Symmetric to enable_event_definition: same defineMutatingHandler
// composition (lifecycle-as-mutation contract, D-08 / Phase 1 INPUT-07
// precedent); same WILDCARD empty-body quirk (Pitfall 4, D-07); same
// 05-U1-SMOKE.md decision artifact governs body shape (UNREACHABLE →
// body: undefined).
//
// The only deltas vs enable:
//   - Path segment: /unschedule (vs /schedule)
//   - postApplyEstimate.state: "DISABLED" (vs "ENABLED")
//
// Apply envelope: 200 + full EventDefinitionDto with `state: "DISABLED"`.
// normalize() extracts id from raw.id for the canonical {id, body} shape.
//
// See enable-event-definition.js for the full Pitfall 4 / D-07 / D-08 /
// lifecycle-as-mutation / Pitfall 2 narrative — both sibling files share
// the same constant and contract; no rationale duplicated here.

import { defineMutatingHandler } from "../_shared/handler.js";
import { DisableEventDefinitionSchema } from "./schemas.js";
import { toIdBody } from "../../graylog/normalize.js";

// 05-U1-SMOKE.md UNREACHABLE → body: undefined. Kept in sync with
// enable-event-definition.js's constant. Both flip together if a
// downstream smoke ever surfaces a 411/415 from a proxy.
const ENABLE_DISABLE_EMPTY_BODY = undefined;

export const handleDisableEventDefinition = defineMutatingHandler({
    name: "disable_event_definition",
    schema: DisableEventDefinitionSchema,
    build: (args) => ({
        method: "PUT",
        path: `/api/events/definitions/${args.definitionId}/unschedule`,
        body: ENABLE_DISABLE_EMPTY_BODY,
        postApplyEstimate: { id: args.definitionId, state: "DISABLED" },
        normalize: (raw) => toIdBody(raw, { idFields: ["id"] }),
    }),
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        `Disable scheduling for event definition ${args.definitionId} (eventually consistent — poll get_event_definition for state:"DISABLED")`,
});
