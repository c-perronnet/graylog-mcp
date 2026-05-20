// Side-effect register barrel for the authz domain (Phase 8).
// Imported once by src/tools/_register.js so the central registration
// barrel stays the single source of truth for tool→handler wiring.
//
// Plan 08-01 — Phase 8 shipped this barrel empty (foundation + reconnaissance:
// the GRN helper and Capability enum, ZERO agent-facing handlers).
//
// Plan 09-01 — Phase 9 entity-shares READ path: get_entity_shares (SHARE-02)
//   + list_grantees (SHARE-09), both built on POST .../entities/{grn}/prepare.
// Plan 10-02 — Phase 10 entity-shares WRITE path: share_entity (the v3.1.0
//   headline tool — SHARE-01,03,04,05,06,07,08 + AUTHZ-01). Composes the
//   Phase 8 GRN helper + Phase 9 /prepare helper + Phase 8 share-grant hash
//   into a defineMutatingHandler with read-merge-POST safety and the full
//   dryRun:true + confirmationToken + drift-refusal stack.
//
// Precedent: src/tools/pipelines/index.js — import handler then register().

import { register } from "../../dispatch.js";

import { handleGetEntityShares } from "./get-entity-shares.js";
import { handleListGrantees } from "./list-grantees.js";
import { handleShareEntity } from "./share-entity.js";

register("get_entity_shares", handleGetEntityShares);
register("list_grantees", handleListGrantees);
register("share_entity", handleShareEntity);
