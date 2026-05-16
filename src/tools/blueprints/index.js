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

register("setup_long_term_archival_index", handleSetupLongTermArchivalIndex);

// Plan 06-04 Task 2 — BLUE-06 (setup_debug_log_dropping) registers here.
// Plan 06-04 Task 3 — BLUE-04 (setup_pipeline_for_stream) registers here.
// Plan 06-05 — BLUE-01/02/03 register here.
