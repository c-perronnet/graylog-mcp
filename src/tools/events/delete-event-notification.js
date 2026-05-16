// EVENT-09 part B — delete_event_notification. THE D-09 CENTERPIECE of Plan 05-04.
//
// Notifications are LOAD-BEARING. Deleting a notification leaves any event_defs
// that reference it broken: the notification_id resolves to nothing → silent
// failure on alert fire. This is the analog of Phase 3 delete_stream (orphan
// stream_rules + pipeline_connections + event_defs) — same cascade-hash + drift-
// refusal machinery, leaner one-endpoint cascade.
//
// Execution order (do NOT reorder — each step is a structural enforcement):
//
//   1. D-09 cascade pre-flight (1 endpoint; hard-block on failure):
//        - fetchEventDefsReferencingNotification(client, notificationId)
//          paginates GET /api/events/definitions/paginated?page=N&per_page=50
//          and client-side filters on def.notifications[].notification_id ===
//          notificationId. No server-side notification_id query param exists
//          on Graylog 7.0.6 / 7.2 (mirror Pitfall S6 from delete_stream).
//
//   2. D-04 cascade_preflight_failed: any per-page GET throwing →
//        GraylogValidationError(reason:cascade_preflight_failed). NO
//        confirmationToken issued. Hard-block (matches Phase 3 stance).
//
//   3. D-09 confirmationToken = computeNotificationCascadeHash({
//        notificationId, eventDefIds: <sorted matched ids>
//      }) — Plan 05-01 thin wrapper; canonical JSON is byte-identical to
//      computeCascadeHash({ streamId: notificationId, ruleIds: [],
//      pipelineConnIds: [], eventDefIds }).
//
//   4. handler.js emits `confirmationToken: <hex>` in the dry-run JSON
//      automatically when build() set _confirmationToken (Plan 02-01
//      amendment).
//
//   5. handler.js requireConfirm gate refuses apply with
//      reason:confirmation_mismatch when args.confirm !== expectedToken.
//
//   6. apply() RE-FETCHES the cascade, RE-COMPUTES the hash, and refuses
//      with isError reason:cascade_changed_since_preview (D-03) when
//      the hash drifted between dry-run and apply. The wrapper's
//      handler.js:217-219 passes the isError envelope through verbatim.
//
//   7. Apply envelope is SYNC { deleted: true, notificationId } — no
//      system-job spawn (notification delete is in-process per Graylog
//      EventNotificationConfigEntityResource source).
//
// Threat-model anchors (see 05-04-PLAN.md <threat_model>):
//   T-05-04-05: replay of stale hash → D-03 re-fetch + refusal.
//   T-05-04-06: cross-tool replay → notificationId in canonical JSON streamId
//               slot; Phase 3/4 hashes carry different ids — no replay surface.
//   T-05-04-07: DoS on 50k+ event-def cluster → safety cap 1000 pages × 50/page.
//   T-05-04-09: wrapper-bypass via direct DELETE → defense-in-depth via the
//               client-layer writable gate.
//   T-05-04-10: apply-time pre-flight failure leaving partial DELETE state →
//               cascade_preflight_failed surfaces BEFORE DELETE fires; DELETE
//               is the LAST step in apply().

import { defineMutatingHandler } from "../_shared/handler.js";
import { DeleteEventNotificationSchema } from "./schemas.js";
import { computeNotificationCascadeHash } from "../_shared/cascade-hash.js";
import { makeClient } from "../../graylog/client.js";
import { GraylogValidationError } from "../../graylog/errors.js";

// Direct analog of delete_stream.js's fetchEventDefinitionsForStream (Pitfall
// S6) — same pagination shape, different filter predicate. Notifications have
// no server-side notification_id filter on the events-definitions paginated
// endpoint, so we walk pages and filter client-side on
// def.notifications[].notification_id.
//
// Per-page cap: 50 (Graylog framework default). Early-exit on partial page.
// Safety cap: 1000 pages (= 50000 event definitions max) — T-05-04-07.
async function fetchEventDefsReferencingNotification(client, notificationId) {
    const matches = [];
    const perPage = 50;
    const maxPages = 1000;
    let page = 1;
    while (page <= maxPages) {
        let rsp;
        try {
            rsp = await client.request(
                "GET",
                `/api/events/definitions/paginated?page=${page}&per_page=${perPage}`,
                null,
            );
        } catch (err) {
            const e = new GraylogValidationError(
                `Cascade pre-flight failed: GET /api/events/definitions/paginated — ${err.message}`,
                { status: 503, method: "GET", path: `/api/events/definitions/paginated` },
            );
            e.reason = "cascade_preflight_failed";
            throw e;
        }
        const defs = Array.isArray(rsp?.elements) ? rsp.elements : [];
        for (const def of defs) {
            const refs = Array.isArray(def?.notifications) ? def.notifications : [];
            if (refs.some((n) => n?.notification_id === notificationId)) {
                matches.push({ id: def.id, title: def.title });
            }
        }
        // Early-exit on partial page (last page).
        if (defs.length < perPage) break;
        page += 1;
    }
    return matches;
}

export const handleDeleteEventNotification = defineMutatingHandler({
    name: "delete_event_notification",
    schema: DeleteEventNotificationSchema,
    async build(args) {
        const client = makeClient(args._conn);
        const path = `/api/events/notifications/${args.notificationId}`;

        // D-09 cascade pre-flight (1 endpoint; cascade_preflight_failed hard-
        // blocks the dry-run on failure — mirror Phase 3 D-04 stance).
        const eventDefs = await fetchEventDefsReferencingNotification(
            client,
            args.notificationId,
        );

        // D-09 confirmation hash via Plan 05-01 thin wrapper. Canonical JSON
        // is byte-identical to computeCascadeHash with streamId=notificationId
        // and the other buckets empty.
        const confirmationToken = computeNotificationCascadeHash({
            notificationId: args.notificationId,
            eventDefIds: eventDefs.map((d) => d.id),
        });

        return {
            method: "DELETE",
            path,
            body: undefined,
            cascades: { event_definitions: eventDefs },
            postApplyEstimate: { id: args.notificationId, deleted: true },
            _confirmationToken: confirmationToken,
        };
    },
    async apply(client, req) {
        // D-03 re-fetch + drift refusal. notificationId is extracted from
        // req.path so apply() is fully driven by the build()-emitted descriptor.
        const m = req.path.match(/notifications\/([^/?]+)/);
        const notificationId = m ? m[1] : "unknown";

        // Re-fetch may throw GraylogValidationError(reason:cascade_preflight_failed);
        // the wrapper's outer try/catch routes that through wrapGraylogError.
        const eventDefs = await fetchEventDefsReferencingNotification(
            client,
            notificationId,
        );

        const currentHash = computeNotificationCascadeHash({
            notificationId,
            eventDefIds: eventDefs.map((d) => d.id),
        });

        if (currentHash !== req._confirmationToken) {
            // handler.js passes this isError envelope through verbatim
            // (handler.js:217-219 — Plan 02-01 amendment).
            return {
                isError: true,
                reason: "cascade_changed_since_preview",
                content: [{
                    type: "text",
                    text: `[delete_event_notification] cascade_changed_since_preview: referencing event_definitions drifted between dry-run and apply. Re-run dry-run to see the new cascade and obtain a fresh confirmationToken.`,
                }],
            };
        }

        await client.request(req.method, req.path, req.body);
        // SYNC envelope — no async/job_id (notification delete is in-process).
        return { deleted: true, notificationId };
    },
    summarize: (args) => `Delete event notification ${args.notificationId}`,
    requireConfirm: ({ req }) => req._confirmationToken ?? null,
});
