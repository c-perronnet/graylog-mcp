// Side-effect register barrel for the authz domain (Phase 8).
// Imported once by src/tools/_register.js so the central registration
// barrel stays the single source of truth for tool→handler wiring.
//
// Plan 08-01 — Phase 8 shipped this barrel empty (foundation + reconnaissance:
// the GRN helper and Capability enum, ZERO agent-facing handlers).
//
// Plan 09-01 — Phase 9 entity-shares READ path: get_entity_shares (SHARE-02)
//   + list_grantees (SHARE-09), both built on POST .../entities/{grn}/prepare.
// Phase 10 will add the WRITE path (share_entity).
//
// Precedent: src/tools/pipelines/index.js — import handler then register().

import { register } from "../../dispatch.js";

import { handleGetEntityShares } from "./get-entity-shares.js";
import { handleListGrantees } from "./list-grantees.js";

register("get_entity_shares", handleGetEntityShares);
register("list_grantees", handleListGrantees);
