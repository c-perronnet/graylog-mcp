// EVENT-07 — list_event_notifications. Phase 5 narrow-projection read tool.
//
// Replaces the v2.3 list_event_notifications (Pitfall S5 displacement —
// previous handler emitted the unbounded v2.3 shape; new handler returns
// a narrow projection by default and consumes the paginated envelope
// with response.elements unwrapping per Plan 05-01).
//
// Pitfall 1 (RESEARCH): the bare /api/events/notifications endpoint is
// @Deprecated; the /paginated variant is the supported wire shape.
// Response: PageListResponse<NotificationDto> with the array under
// `elements` (NOT `notifications`). The Plan 05-01 conflict.js envelope
// amendment added `elements` at position 5 of the fallback chain so the
// list/conflict tools share the same unwrap path.
//
// Default projection:
//   [id, title, description, config]
// — defineListHandler's projectItem helper is dot-notation-unaware
// (src/tools/_shared/list.js:108-114), so we ship the full `config`
// object in the narrow projection rather than dropping it to a
// dot-notation `config.type`. Agents looking for just the type read
// it from items[i].config.type; pass `fields: "all"` for the full DTO
// including notification_settings and other plugin-specific fields.
//
// limit: the agent's `limit` param maps to the server's `per_page` query
// param. Page-1 only — consistent with list_event_definitions / list_streams
// / list_inputs which all return page 1.

import { defineListHandler } from "../_shared/list.js";
import { ListEventNotificationsSchema } from "./schemas.js";

const EVENT_NOTIFICATION_DEFAULT_FIELDS = [
    "id",
    "title",
    "description",
    "config",
];

export const handleListEventNotifications = defineListHandler({
    name: "list_event_notifications",
    schema: ListEventNotificationsSchema,
    defaultFields: EVENT_NOTIFICATION_DEFAULT_FIELDS,
    fetch: async (client, args) => {
        const limit = args.limit ?? 25;
        // Build the paginated URL. Page=1 + per_page=<limit> are always emitted
        // for byte-stable URLs (Plan 05-05 snapshots pin these). query/sort/
        // order are appended ONLY when the agent set them — keeps URLs minimal
        // on the common "list everything" path. Mirrors list_event_definitions.
        let path = `/api/events/notifications/paginated?page=1&per_page=${limit}`;
        if (args.query !== undefined) {
            path += `&query=${encodeURIComponent(args.query)}`;
        }
        if (args.sort !== undefined) {
            path += `&sort=${args.sort}`;
        }
        if (args.order !== undefined) {
            path += `&order=${args.order}`;
        }
        const response = await client.request("GET", path, null);
        // Pitfall 1: unwrap `response.elements`. Bare /notifications is dropped.
        return Array.isArray(response) ? response : (response?.elements ?? []);
    },
});
