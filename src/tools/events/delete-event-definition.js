// EVENT-05 — delete_event_definition. DELETE /api/events/definitions/{id}.
//
// D-08 INFORMATIONAL cascade (mirror Phase 1 delete_input D-05 pattern):
//   - Pre-flight GET /api/events/definitions/{id} reads current.notifications[]
//     and surfaces them in cascades.notifications in the dry-run preview JSON.
//     The agent sees WHICH notifications would lose the wiring BEFORE applying.
//
// CRITICAL — D-08 is INFORMATIONAL, NOT a refusal gate:
//   - Notifications SURVIVE the event-def delete. They are INDEPENDENT
//     resources managed by EVENT-07..EVENT-09 (Plan 05-04). Only the
//     def→notification WIRING vanishes when the def is deleted.
//   - Therefore NO cascade-hash is issued, NO confirmationToken is set in
//     the preview JSON, NO drift refusal fires at apply time.
//   - The dry-run cascades block is purely informational.
//
// CONTRAST with Plan 05-04 delete_event_notification (D-09):
//   - Notifications ARE load-bearing (delete severs def-side wiring across
//     ALL event definitions referencing this notification + ALL
//     event_procedure references).
//   - That handler ISSUES a 64-hex cascade hash (via the Plan 05-01 thin
//     wrapper from src/tools/_shared/cascade-hash.js) + REFUSES apply if
//     the cascade drifts between preview and apply.
//   - delete_event_definition is the LEAF delete; delete_event_notification
//     is the LOAD-BEARING delete. Both ship in Phase 5; their visibility
//     surfaces differ by design.
//
// Pitfall Q1 of 05-RESEARCH.md (Open Question 1): server-side EventResolver
//   throws 400 ValidationException if other event_defs reference this one
//   as a correlation parent. The wrapper does NOT pre-flight this because
//   Phase 5's aggregation-v1-only scope does NOT construct correlation refs.
//   If a future plan adds correlation types, an apply-time 400 surfaces
//   cleanly via wrapGraylogError.
//
// Best-effort pre-flight (mirror src/tools/inputs/delete-input.js:30-47):
//   - GET 404 → empty cascades.notifications array; the DELETE itself
//     surfaces the real error via wrapGraylogError on apply.
//   - GET 403 → empty cascades.notifications array; same fallback.
//   - Failure during pre-flight MUST NOT prevent the dry-run from rendering.

import { defineMutatingHandler } from "../_shared/handler.js";
import { DeleteEventDefinitionSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";

export const handleDeleteEventDefinition = defineMutatingHandler({
    name: "delete_event_definition",
    schema: DeleteEventDefinitionSchema,
    async build(args) {
        // Connection already resolved by handler.js — threaded via leading-
        // underscore framework-internal keys (same convention as delete_input).
        const conn = args._conn;
        const client = makeClient(conn);

        // D-08 best-effort informational pre-flight: enumerate notifications
        // the event def references. Failure here MUST NOT prevent the dry-run
        // from rendering; the DELETE itself surfaces any real error on apply.
        let notifications = [];
        try {
            const dto = await client.request(
                "GET",
                `/api/events/definitions/${args.definitionId}`,
                null,
            );
            notifications = Array.isArray(dto?.notifications)
                ? dto.notifications.map((n) => ({
                    notification_id: n.notification_id,
                    notification_parameters: n.notification_parameters ?? null,
                }))
                : [];
        } catch (_err) {
            // 404 / 403 / any other pre-flight failure → fall through to
            // empty cascade array. The wrapper layer will surface the real
            // error from the DELETE itself on apply.
            notifications = [];
        }

        return {
            method: "DELETE",
            path: `/api/events/definitions/${args.definitionId}`,
            body: undefined,
            postApplyEstimate: { id: args.definitionId, deleted: true },
            // D-08: INFORMATIONAL cascade — handler.js spreads this onto the
            // dry-run preview JSON conditionally. NO apply-time confirmation
            // token is set; no cascade hash is computed; no drift refusal
            // fires at apply time (informational visibility only).
            cascades: { notifications },
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        `Delete event definition ${args.definitionId} (any notifications referenced lose this def's wiring; notifications themselves survive)`,
});
