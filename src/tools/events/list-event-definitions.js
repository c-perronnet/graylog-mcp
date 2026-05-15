// EVENT-01 — list_event_definitions. Phase 5 narrow-projection read tool.
//
// Replaces the v2.3 list_event_definitions (Pitfall S5 displacement —
// previous handler emitted the unbounded v2.3 shape; new handler returns
// a 6-key narrow projection by default and consumes the paginated
// envelope with response.elements unwrapping per Plan 05-01).
//
// Pitfall 1 (RESEARCH): the bare /api/events/definitions endpoint is
// @Deprecated; the /paginated variant is the supported wire shape.
// Response: PageListResponse<EventDefinitionDto> with the array under
// `elements` (NOT `event_definitions` — that's the deprecated bare
// endpoint's wrapping). The Plan 05-01 conflict.js envelope amendment
// added `elements` at position 5 of the fallback chain so the same code
// path the list/conflict tools share now unwraps this cleanly.
//
// Default projection (BLOCKER-3 / FOUND-12 per-tool override pattern):
//   [id, title, description, priority, state, alert]
// — the agent's "operational state" view of an event definition. To see
// scheduler ctx, notifications[], config, or field_spec/key_spec, the
// agent must either pass `fields: "all"` or call get_event_definition
// for a single DTO (which always returns the full shape).
//
// Query/sort/order: forwarded verbatim to the upstream paginated endpoint.
// `sort` accepts {title, priority, updated_at}; `order` accepts {asc, desc}.
// Defaults match the EventDefinitionsResource server defaults (title/asc).
//
// limit: the agent's `limit` param maps to the server's `per_page` query
// param. Page-1 only — the Phase 5 wrapper does NOT walk pages (consistent
// with list_streams / list_pipelines / list_inputs which all return page 1).

import { defineListHandler } from "../_shared/list.js";
import { ListEventDefinitionsSchema } from "./schemas.js";

const EVENT_DEFINITION_DEFAULT_FIELDS = [
    "id",
    "title",
    "description",
    "priority",
    "state",
    "alert",
];

export const handleListEventDefinitions = defineListHandler({
    name: "list_event_definitions",
    schema: ListEventDefinitionsSchema,
    defaultFields: EVENT_DEFINITION_DEFAULT_FIELDS,
    fetch: async (client, args) => {
        const limit = args.limit ?? 25;
        // Build the paginated URL. Page=1 + per_page=<limit> are always emitted
        // for byte-stable URLs (Plan 05-05 snapshots can pin these). query/sort/
        // order are appended ONLY when the agent set them — keeps URLs minimal
        // on the common "list everything" path.
        let path = `/api/events/definitions/paginated?page=1&per_page=${limit}`;
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
        // Pitfall 1: unwrap `response.elements`. The bare /definitions path's
        // older `event_definitions` wrapping is NOT consumed here — Plan 05-01
        // dropped the v2.3 read entirely.
        return Array.isArray(response) ? response : (response?.elements ?? []);
    },
});
