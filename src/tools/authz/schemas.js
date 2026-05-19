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

// Phase 9 Plan 09-01 — entity-shares READ schemas (SHARE-02 / SHARE-09).
//
// These are READ tools: a plain `z.object`, explicitly NOT extending
// `mutatingBase`. A `dryRun` / `idempotencyKey` field would be meaningless on
// a non-mutating @NoAuditEvent /prepare probe (mirrors pipelines/schemas.js
// GetPipelineSchema, which deliberately skips mutatingBase).
//
// The `entityType` enum is the SHAREABLE subset of GRN_TYPES — stream /
// dashboard / search. Grantee types (user, builtin-team, role) are never
// valid as a share TARGET, so they are intentionally excluded here.
const ENTITY_TYPES = z.enum(["stream", "dashboard", "search"]);

// GetEntitySharesSchema — input for get_entity_shares.
//
// The caller must identify the entity exactly one of two ways:
//   - `entityGrn`: a full GRN string, OR
//   - `entityType` + `entityId`: the pieces buildGrn assembles.
// The `.refine` enforces an exclusive-or: `Boolean(entityGrn)` must differ
// from `Boolean(entityType && entityId)`. Supplying both, or neither, throws.
// The XOR `.refine` has direct precedent in pipelines/schemas.js
// CreatePipelineRuleSchema (`Boolean(a) !== Boolean(b)`).
export const GetEntitySharesSchema = z
    .object({
        connectionName: z.string().optional(),
        entityGrn: z.string().optional(),
        entityType: ENTITY_TYPES.optional(),
        entityId: z.string().min(1).optional(),
    })
    .refine(
        (a) => Boolean(a.entityGrn) !== Boolean(a.entityType && a.entityId),
        {
            message:
                "Provide either entityGrn, or both entityType and entityId (not both, not neither).",
        },
    );

// ListGranteesSchema — list_grantees takes the identical input surface; it is
// the same /prepare probe, only the response projection differs.
export const ListGranteesSchema = GetEntitySharesSchema;
