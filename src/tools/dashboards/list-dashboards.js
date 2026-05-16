// DASH-01 — list_dashboards. Phase 6 narrow-projection read tool.
//
// Returns ONLY DASHBOARD-typed views. Graylog 7.x treats `/api/views`'s
// `query` parameter as FREE-TEXT over a view's title/summary — passing
// `query=type:DASHBOARD` matches the literal text and returns total:0, so
// no `query` segment is sent. Saved searches (view.type === "SEARCH") are
// filtered out wrapper-side via `items.filter(v => v?.type === "DASHBOARD")`
// — that wrapper-side filter is the REAL type filter (Q1 default
// `WRAPPER_SIDE_TYPE_FILTER` per 06-U1-SMOKE.md).
//
// Envelope unwrap (Pitfall 1): /api/views returns PaginatedResponse with
// the array under `response.views`. Plan 06-01 amended
// src/tools/_shared/conflict.js to recognize this key for findExistingMatches;
// list_dashboards repeats the unwrap inline because defineListHandler's
// envelope unwrap is per-handler.
//
// Default projection: [id, title, summary, description] — the agent's
// "dashboard catalogue" view. To see the full ViewDTO (state, search_id,
// widget_positions, widget_mapping, etc.), the agent must either pass
// `fields: "all"` or call get_dashboard.
//
// Path shape: /api/views?page=1&per_page=<limit>&sort=title&order=asc
//   — byte-stable URL (Plan 06-06 snapshots can pin).

import { defineListHandler } from "../_shared/list.js";
import { ListDashboardsSchema } from "./schemas.js";

const DASHBOARD_DEFAULT_FIELDS = ["id", "title", "summary", "description"];

export const handleListDashboards = defineListHandler({
    name: "list_dashboards",
    schema: ListDashboardsSchema,
    defaultFields: DASHBOARD_DEFAULT_FIELDS,
    fetch: async (client, args) => {
        const limit = args.limit ?? 25;
        // No `query=` segment: Graylog 7.x treats `/api/views`'s `query`
        // parameter as free-text over the view title/summary, so
        // `query=type:DASHBOARD` would match literal text and return 0.
        // Structured DASHBOARD-type filtering happens wrapper-side below.
        const path = `/api/views?page=1&per_page=${limit}&sort=title&order=asc`;
        const response = await client.request("GET", path, null);
        // Pitfall 1 envelope unwrap: response.views | items | array.
        const items = Array.isArray(response)
            ? response
            : (response?.views ?? response?.items ?? []);
        // Q1 default WRAPPER_SIDE_TYPE_FILTER — drop anything not a Dashboard.
        // Defensive against `SEARCH_FIELD_MAPPING` excluding `type` on the
        // server side (06-U1-SMOKE Q1 rationale).
        return items.filter((v) => v?.type === "DASHBOARD");
    },
});
