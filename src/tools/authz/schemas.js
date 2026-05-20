// authz domain zod schemas — Phase 8 Plan 08-01 (AUTHZ-02 foundation),
// Phase 9 Plan 09-01 (entity-shares READ), Phase 10 Plan 10-01 (entity-shares
// WRITE input contract).
//
// Phase 10 adds the first mutating schema in this module — ShareEntitySchema
// — so `mutatingBase` is imported from ../_shared/schemas.js. The Phase 8/9
// exports (Capability, GetEntitySharesSchema, ListGranteesSchema) are
// unchanged; ENTITY_TYPES is promoted from file-private to exported so
// ShareEntitySchema can reuse the same z.enum the read schemas already pin.

import { z } from "zod";
import { mutatingBase } from "../_shared/schemas.js";

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
//
// Phase 10 Plan 10-01 promotes this from file-private to exported so the
// write-path schema (ShareEntitySchema) can reuse the same z.enum without
// re-declaring. Per 10-PATTERNS.md §"schemas.js" recommendation — single
// source of truth for the shareable-type set.
export const ENTITY_TYPES = z.enum(["stream", "dashboard", "search"]);

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

// =====================================================================
// Phase 10 Plan 10-01 — entity-shares WRITE schema
// =====================================================================
//
// SHARE-01,03,04,05,06,07,08 + AUTHZ-01 (drift refusal). Input contract for
// the share_entity tool — Plan 10-02 ships the handler. The schema extends
// `mutatingBase` (dryRun:true default + connectionName + idempotencyKey) and
// adds three .refine clauses that encode the cross-field invariants:
//
//   1. ENTITY XOR: entityGrn XOR (entityType + entityId).
//   2. GRANTEE XOR: granteeGrn XOR granteeUsername.
//   3. REVOKE <-> CAPABILITY: capability is required when revoke is false
//      (default), and must be absent when revoke is true.
//
// The Capability enum (view/manage/own) and the ENTITY_TYPES enum (stream/
// dashboard/search) are reused — NOT redefined — so a future enum change
// flows through both the read and the write paths.
//
// `confirm` mirrors DeleteIndexSetSchema:268 — the apply-time echo of the
// dry-run confirmationToken. The wrapper's requireConfirm gate refuses the
// apply when args.confirm != req._confirmationToken (TOCTOU drift refusal).
export const ShareEntitySchema = mutatingBase
    .extend({
        // Entity reference — exactly one of (entityGrn) XOR (entityType + entityId).
        entityGrn: z.string().optional(),
        entityType: ENTITY_TYPES.optional(),
        entityId: z.string().min(1).optional(),
        // Grantee — exactly one of (granteeGrn) XOR (granteeUsername).
        // granteeUsername is resolved against available_grantees[].title at
        // handler time; granteeGrn is passed through verbatim (lowercased).
        granteeGrn: z.string().optional(),
        granteeUsername: z.string().min(1).optional(),
        // The capability to grant; absent when revoke:true.
        capability: Capability.optional(),
        // Revoke flag — when true, capability must be absent and the merge
        // step subtracts the grantee from the current active_shares set.
        revoke: z.boolean().optional().default(false),
        // Echo-the-token field — same shape as DeleteIndexSetSchema:268.
        // Required at apply time (dryRun:false) by the wrapper's
        // requireConfirm gate, not by zod (so the dry-run preview path can
        // run without a token).
        confirm: z.string().optional(),
    })
    .refine(
        (a) => Boolean(a.entityGrn) !== Boolean(a.entityType && a.entityId),
        {
            message:
                "Provide either entityGrn, or both entityType and entityId (not both, not neither).",
        },
    )
    .refine(
        (a) => Boolean(a.granteeGrn) !== Boolean(a.granteeUsername),
        {
            message:
                "Provide either granteeGrn or granteeUsername (not both, not neither).",
        },
    )
    .refine(
        (a) => (a.revoke === true ? a.capability === undefined : a.capability !== undefined),
        {
            message:
                "capability is required when revoke is false (default), and must be absent when revoke is true.",
        },
    );
