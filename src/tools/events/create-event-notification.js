// EVENT-08 — create_event_notification. POST /api/events/notifications.
//
// D-05 / D-06 (Pitfall 6 mitigation): the CreateEventNotificationSchema imports
//   NotificationConfigSchema (Plan 05-01) which is a 6-variant
//   z.discriminatedUnion("type", [...]) — ANY `type` value not in the closed
//   set rejects at zod.parse BEFORE any HTTP call. Three specific rejections
//   are pinned by tests:
//     - script-notification-v1   (does not exist on Graylog 7.0.6 / 7.2)
//     - pagerduty-notification-v1 (correct: -v2)
//     - teams-notification-v1     (correct: -v2)
//
// Pitfall 3 (RESEARCH): wire body wraps in CreateEntityRequest envelope:
//   { entity: { title, description, config }, share_request: null }.
//   Flat body returns 400 "missing entity".
//
// Pitfall 2 / M2: 200 + full NotificationDto on success; normalize reads
//   raw.id (not 201 + {notification_id}, not Location header).
//
// FOUND-11: existingMatches probes /api/events/notifications/paginated for
//   exact-title match. Plan 05-01's `elements` envelope amendment in conflict.js
//   (position 5 of the fallback chain) makes the list response unwrap correctly.
//
// C3 (T-05-04-03): http-notification-v2 carries encrypted basic_auth + api_secret.
//   On CREATE the agent's plaintext values flow through verbatim (no GET round-trip;
//   nothing to redact from current state because the agent typed them in). We still
//   route through redactForPreview / encodeEncryptedForWire so:
//     - dry-run preview body shows the encrypted fields as <redacted> (no plaintext
//       leak through MCP logs).
//     - apply wire body wraps each as { set_value: <plaintext> } per Graylog's
//       EncryptedValue deserialization. The _applyBody sibling pattern keeps the
//       redacted preview body away from Graylog on apply.
//   For the 5 variants with no encrypted fields, the Set is empty and both helpers
//   are effective no-ops (the redact / wire bodies converge to the same shape).

import { defineMutatingHandler } from "../_shared/handler.js";
import { CreateEventNotificationSchema } from "./schemas.js";
import { findExistingMatches } from "../_shared/conflict.js";
import { makeClient } from "../../graylog/client.js";
import { SERVER_ASSIGNED_SENTINEL } from "../_shared/dry-run.js";
import { redactForPreview, encodeEncryptedForWire } from "../inputs/redact.js";
import { getEncryptedFieldsForType } from "./encrypted-fields.js";

export const handleCreateEventNotification = defineMutatingHandler({
    name: "create_event_notification",
    schema: CreateEventNotificationSchema,
    async build(args) {
        const client = makeClient(args._conn);

        // FOUND-11: exact-title probe. similarityReason is the literal "exact"
        // — Phase 5 does not implement case_insensitive/prefix buckets that
        // create_stream / create_input use; agents get an exact-match flag or nothing.
        const existingMatches = await findExistingMatches(client, {
            listPath: "/api/events/notifications/paginated",
            matchFn: (notif) => notif.title === args.title,
            similarityReason: "exact",
        });

        const encryptedFields = getEncryptedFieldsForType(args.config.type);

        // Wire body — encrypted fields wrap as { set_value: <plaintext> } per
        // Graylog's EncryptedValue deserialization. Pitfall 3: CreateEntityRequest
        // envelope.
        const wireConfig = encodeEncryptedForWire(args.config, encryptedFields);
        // Preview body — encrypted fields shown as REDACTION_PLACEHOLDER.
        const previewConfig = redactForPreview(args.config, encryptedFields);

        return {
            method: "POST",
            path: "/api/events/notifications",
            body: {
                entity: {
                    title: args.title,
                    description: args.description ?? "",
                    config: previewConfig,
                },
                share_request: null,
            },
            existingMatches,
            // M2 / Pitfall 2: 200 + full DTO; normalize extracts id from raw.id.
            postApplyEstimate: { id: SERVER_ASSIGNED_SENTINEL },
            normalize: (raw) => ({ id: raw?.id, body: raw }),
            // Sibling consumed by apply() so the redacted preview body never
            // reaches Graylog. handler.js is body-agnostic; this field is
            // internal to create_event_notification (mirror of create_input).
            _applyBody: {
                entity: {
                    title: args.title,
                    description: args.description ?? "",
                    config: wireConfig,
                },
                share_request: null,
            },
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req._applyBody ?? req.body),
    summarize: (args) =>
        `Create event notification "${args.title}" (type: ${args.config.type})`,
});
