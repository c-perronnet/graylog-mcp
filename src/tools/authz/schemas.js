// authz domain zod schemas — Phase 8 Plan 08-01 (AUTHZ-02 foundation).
//
// Phase 8 ships NO mutating tool, so this module imports only `z`. The shared
// `mutatingBase` / `listBase` schemas (../_shared/schemas.js) are NOT imported
// here — Phase 9/10 entity-share tool schemas will extend `mutatingBase` when
// they land. They are noted so a future reader knows the base already exists.

import { z } from "zod";

// AUTHZ-02 — Capability enum.
//
// Source: org/graylog/security/Capability.java — exactly 3 lowercase values.
// There are NO read/write/admin aliases; pinning the enum to exactly these
// three prevents capability privilege confusion (e.g. silently treating an
// "admin" string as "own"). Downstream entity-share tools default to the
// least-privilege capability, `view`.
export const Capability = z.enum(["view", "manage", "own"]);
