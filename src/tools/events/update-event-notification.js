// EVENT-09 part A — update_event_notification. PUT /api/events/notifications/{id}.
//
// D-10 STRICT_NO_ECHO: wire body emits ONLY fields the agent touched.
//   - agent passes changes:{title:"new"} → wire body {id, title:"new"} ONLY.
//   - agent passes changes:{config:{type:"http-notification-v2", url:"new"}}
//     → wire config {type, url} ONLY (no current.config sub-fields echoed).
//   - Crucially: when agent does NOT pass basic_auth / api_secret on http-v2,
//     they are ABSENT from the wire — C3 wipe is impossible because we never
//     round-trip them from a GET. Mirror of Phase 1 update_input D-12.
//
// C3-class mitigation (T-05-04-02 / T-05-04-03):
//   - Pre-flight GET fetches current.config.type so we can look up which
//     fields are encrypted for THIS notification's variant.
//   - Encrypted fields the agent DID pass are wrapped as { set_value } on
//     the wire AND redacted to <redacted> in the dry-run preview.
//   - Encrypted fields the agent did NOT pass are NEVER on the wire.
//
// Pitfall 8: body.id is always set to args.notificationId so the PUT body
//   agrees with the URL segment (mirror of update_event_definition).
//
// Pitfall 2 / M2: PUT returns 200 + full DTO; normalize via toIdBody.
//
// Variant change on update: if changes.config.type differs from current
//   .config.type, we use the NEW type's encrypted-field inventory for
//   redaction. The agent is replacing the variant entirely; preserving the
//   old variant's encrypted-field semantics makes no sense.

import { defineMutatingHandler } from "../_shared/handler.js";
import { UpdateEventNotificationSchema } from "./schemas.js";
import { redactForPreview, encodeEncryptedForWire } from "../inputs/redact.js";
import { getEncryptedFieldsForType } from "./encrypted-fields.js";
import { makeClient } from "../../graylog/client.js";
import { toIdBody } from "../../graylog/normalize.js";

export const handleUpdateEventNotification = defineMutatingHandler({
    name: "update_event_notification",
    schema: UpdateEventNotificationSchema,
    async build(args) {
        const client = makeClient(args._conn);
        const path = `/api/events/notifications/${args.notificationId}`;

        // Pre-flight GET: source the current variant's `type` for the
        // encrypted-field lookup. Throws GraylogNotFoundError(404) cleanly
        // when the notification doesn't exist; surfaces via the wrapper's
        // outer try/catch as a typed MCP error envelope.
        const current = await client.request("GET", path, null);

        // Determine the effective type for encrypted-field lookup:
        //   - changes.config.type set → variant change; use the NEW type.
        //   - else → variant unchanged; use current.config.type.
        const effectiveType = args.changes.config?.type ?? current?.config?.type;
        const encryptedFields = getEncryptedFieldsForType(effectiveType);

        // STRICT_NO_ECHO partial-update build:
        //   - title: emit only if the agent touched it.
        //   - description: emit only if the agent touched it.
        //   - config: emit ONLY agent-touched sub-fields (the agent passes
        //             a full per-variant config block; we forward it verbatim
        //             except for the encrypted-field shape transforms).
        const agentConfig = args.changes.config;
        const wireConfig = agentConfig !== undefined
            ? encodeEncryptedForWire(agentConfig, encryptedFields)
            : undefined;
        const previewConfig = agentConfig !== undefined
            ? redactForPreview(agentConfig, encryptedFields)
            : undefined;

        // Pitfall 8: body.id matches URL — required by Graylog's PUT
        // deserializer on the events resource.
        const wireBody = {
            id: args.notificationId,
            ...(args.changes.title !== undefined ? { title: args.changes.title } : {}),
            ...(args.changes.description !== undefined ? { description: args.changes.description } : {}),
            ...(wireConfig !== undefined ? { config: wireConfig } : {}),
        };

        const previewBody = {
            id: args.notificationId,
            ...(args.changes.title !== undefined ? { title: args.changes.title } : {}),
            ...(args.changes.description !== undefined ? { description: args.changes.description } : {}),
            ...(previewConfig !== undefined ? { config: previewConfig } : {}),
        };

        return {
            method: "PUT",
            path,
            body: previewBody,
            postApplyEstimate: { id: args.notificationId },
            normalize: (raw) => toIdBody(raw, { idFields: ["id"] }),
            // _applyBody sibling so the redacted preview body never reaches
            // Graylog. handler.js is body-agnostic; this field is internal
            // to update_event_notification (mirror of update_input).
            _applyBody: wireBody,
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req._applyBody ?? req.body),
    summarize: (args) =>
        `Update event notification ${args.notificationId} (${Object.keys(args.changes).length} change(s))`,
});
