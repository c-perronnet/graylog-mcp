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

import { register as _register } from "../../dispatch.js";
// Plan 05-01 ships NO handlers. Plans 05-02/03/04 will append imports +
// register() calls here. The void expression below silences any
// unused-import lint; remove it once Plan 05-02 starts adding handlers.
void _register;
