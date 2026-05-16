// Side-effect register barrel for the dashboards domain (Phase 6).
// Imported once by src/tools/_register.js so the central registration
// barrel stays the single source of truth for tool→handler wiring.
//
// Plan 06-02 ships 6 dashboard CRUD tools — registered incrementally
// across Tasks 1-4 of this plan:
//   - Task 1: DASH-01 list_dashboards, DASH-02 get_dashboard
//   - Task 2: DASH-03 create_dashboard (C7 ACCEPTANCE GATE)
//   - Task 3: DASH-04 update_dashboard, DASH-05 delete_dashboard
//   - Task 4: DASH-07 remove_widget (symmetric 2-step PUT chain)
//
// Plan 06-03 will extend this barrel with DASH-06 add_widget_from_template
// alongside the widget-template library.

import { register } from "../../dispatch.js";

// Plan 06-02 Task 1 — DASH-01 + DASH-02 read tools.
import { handleListDashboards } from "./list-dashboards.js";
import { handleGetDashboard } from "./get-dashboard.js";
// Plan 06-02 Task 2 — DASH-03 create_dashboard (C7 ACCEPTANCE GATE).
import { handleCreateDashboard } from "./create-dashboard.js";
// Plan 06-02 Task 3 — DASH-04 update + DASH-05 delete (leaf).
import { handleUpdateDashboard } from "./update-dashboard.js";
import { handleDeleteDashboard } from "./delete-dashboard.js";
// Plan 06-02 Task 4 — DASH-07 remove_widget (symmetric 2-step PUT chain).
import { handleRemoveWidget } from "./remove-widget.js";

register("list_dashboards", handleListDashboards);
register("get_dashboard", handleGetDashboard);
register("create_dashboard", handleCreateDashboard);
register("update_dashboard", handleUpdateDashboard);
register("delete_dashboard", handleDeleteDashboard);
register("remove_widget", handleRemoveWidget);
