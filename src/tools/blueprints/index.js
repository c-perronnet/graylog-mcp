// Side-effect register barrel for the blueprints domain (Phase 6).
// Imported once by src/tools/_register.js so the central registration
// barrel stays the single source of truth for tool→handler wiring.
//
// Phase 6 Plan 04 (this plan) ships 3 of the 6 BLUE-XX blueprints:
//   - BLUE-04 setup_pipeline_for_stream  (variable-length N+2-step chain)
//   - BLUE-05 setup_long_term_archival_index  (1-step chain)
//   - BLUE-06 setup_debug_log_dropping  (3-step chain)
//
// Phase 6 Plan 05 will extend this barrel with the headline 3:
//   - BLUE-01 setup_dashboard_for_stream  (6-step chain)
//   - BLUE-02 setup_event_alert  (3-step chain)
//   - BLUE-03 setup_app_monitoring  (cross-domain composition)

import { register } from "../../dispatch.js";

// Plan 06-04 Task 1 — BLUE-05.
import { handleSetupLongTermArchivalIndex } from "./setup-long-term-archival-index.js";
// Plan 06-04 Task 2 — BLUE-06.
import { handleSetupDebugLogDropping } from "./setup-debug-log-dropping.js";
// Plan 06-04 Task 3 — BLUE-04.
import { handleSetupPipelineForStream } from "./setup-pipeline-for-stream.js";

// Plan 06-05 Task 1 — BLUE-01 (HEADLINE 6-step chain).
import { handleSetupAppMonitoringStack } from "./setup-app-monitoring-stack.js";
// Plan 06-05 Task 2 — BLUE-02 (1-step error-alert).
import { handleSetupErrorAlerting } from "./setup-error-alerting.js";
// Plan 06-05 Task 3 — BLUE-03 (1-conceptual-step app-health dashboard).
import { handleCreateAppHealthDashboard } from "./create-app-health-dashboard.js";

register("setup_long_term_archival_index", handleSetupLongTermArchivalIndex);
register("setup_debug_log_dropping", handleSetupDebugLogDropping);
register("setup_pipeline_for_stream", handleSetupPipelineForStream);

register("setup_app_monitoring_stack", handleSetupAppMonitoringStack);
register("setup_error_alerting", handleSetupErrorAlerting);
register("create_app_health_dashboard", handleCreateAppHealthDashboard);
