// Side-effect register barrel for the authz domain (Phase 8).
// Imported once by src/tools/_register.js so the central registration
// barrel stays the single source of truth for tool→handler wiring.
//
// Plan 08-01 — empty stub. Phase 8 is foundation + reconnaissance: it ships
// the GRN helper (grn-helpers.js) and the Capability enum (schemas.js) but
// ZERO agent-facing handlers. This barrel therefore registers nothing.
//
// Phase 9 populates it with the entity-shares READ path
//   (get_entity_shares, list_grantees);
// Phase 10 adds the WRITE path (share_entity).
//
// Precedent: src/tools/events/index.js shipped empty in Plan 05-01.

import { register } from "../../dispatch.js";

// (no register() calls — handlers land in Phase 9+)
