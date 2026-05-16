// DASH-01 — list_dashboards. Phase 6 narrow-projection read tool.
//
// Returns ONLY DASHBOARD-typed views. Saved searches (view.type === "SEARCH")
// are filtered out wrapper-side regardless of whether `?query=type:DASHBOARD`
// is honored upstream — Q1 default `WRAPPER_SIDE_TYPE_FILTER` per
// 06-U1-SMOKE.md. The defensive client-side filter is idempotent: if
// Graylog 7.2 ever tightens the unmapped-field handling so that
// `?query=type:DASHBOARD` truly filters server-side, this wrapper's
// behavior is unchanged.
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
// Path shape: /api/views?query=type:DASHBOARD&page=1&per_page=<limit>
//   &sort=title&order=asc — byte-stable URL (Plan 06-06 snapshots can pin).

import { defineListHandler } from "../_shared/list.js";
import { ListDashboardsSchema } from "./schemas.js";

const DASHBOARD_DEFAULT_FIELDS = ["id", "title", "summary", "description"];

export const handleListDashboards = defineListHandler({
    name: "list_dashboards",
    schema: ListDashboardsSchema,
    defaultFields: DASHBOARD_DEFAULT_FIELDS,
    fetch: async (client, args) => {
        const limit = args.limit ?? 25;
        // Wrapper-fixed `?query=type:DASHBOARD` — NOT agent-controllable.
        // Encoded for URL safety even though `:` is technically permitted in
        // a query string; matches the snapshot-stable convention used by
        // list_event_definitions.
        const path = `/api/views?query=${encodeURIComponent("type:DASHBOARD")}`
            + `&page=1&per_page=${limit}&sort=title&order=asc`;
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
