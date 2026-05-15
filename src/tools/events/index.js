// Side-effect register barrel for the events domain (Phase 5).
// Imported once by src/tools/_register.js so the central registration
// barrel stays the single source of truth for tool→handler wiring.
//
// Plan 05-01 — empty stub; cascade-hash + discriminator + migrator
//              + envelope amendments shipped, ready for Plans 05-02/03/04.
// Plan 05-02 — event-definition CRUD (4 tools): list/get/create/update.
// Plan 05-03 — enable/disable + delete (3 tools).
// Plan 05-04 — event-notification CRUD (4 tools): list/create/update/delete.
//
// Pitfall S5 — the v2.3 list_event_definitions + list_event_notifications
// registrations were removed from src/tools/_register.js in Plan 05-01.
// This barrel claims those names once the read tools land in Plan 05-02 / 05-04.

import { register } from "../../dispatch.js";

// Plan 05-02 Task 1 — EVENT-01 + EVENT-02 read tools.
import { handleListEventDefinitions } from "./list-event-definitions.js";
import { handleGetEventDefinition } from "./get-event-definition.js";
// Plan 05-02 Task 2 — EVENT-03 create (M1 + C5 mitigation centerpiece).
import { handleCreateEventDefinition } from "./create-event-definition.js";
// Plan 05-02 Task 3 — EVENT-04 update (D-02 mirror of D-01 + STRICT_NO_ECHO + C5 on changes.config).
import { handleUpdateEventDefinition } from "./update-event-definition.js";

register("list_event_definitions", handleListEventDefinitions);
register("get_event_definition", handleGetEventDefinition);
register("create_event_definition", handleCreateEventDefinition);
register("update_event_definition", handleUpdateEventDefinition);
