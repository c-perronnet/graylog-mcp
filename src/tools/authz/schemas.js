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
        // REVIEW WR-03 (symmetric with ShareEntitySchema): `.min(1)` rejects
        // empty-string entityGrn at parse time so it never slips past the
        // XOR refine via `Boolean("") !== Boolean(undefined && undefined)`.
        entityGrn: z.string().min(1).optional(),
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
        // REVIEW WR-03: `.min(1)` pins both string fields so an empty-string
        // input is a parse-time rejection rather than a value that slips past
        // the XOR refine. Without it, `Boolean("") !== Boolean(undefined)` is
        // false-false → an empty string could partially satisfy the XOR
        // depending on the other field.
        entityGrn: z.string().min(1).optional(),
        entityType: ENTITY_TYPES.optional(),
        entityId: z.string().min(1).optional(),
        // Grantee — exactly one of (granteeGrn) XOR (granteeUsername).
        // granteeUsername is resolved against available_grantees[].title at
        // handler time; granteeGrn is lowercased + type-validated by
        // resolveGranteeGrn (REVIEW CR-01 + CR-02). REVIEW WR-03: `.min(1)`
        // here similarly rejects an empty-string granteeGrn at parse time.
        granteeGrn: z.string().min(1).optional(),
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

// =====================================================================
// Phase 11 Plan 11-01 — role management input schemas + BUILT_IN_ROLES
// =====================================================================
//
// ROLE-01..ROLE-07 + AUTHZ-01 (re-asserted). 5 mutating schemas extend
// mutatingBase (dryRun:true default + connectionName + idempotencyKey +
// explicit confirm field — mirroring ShareEntitySchema:115-119). 2 read
// schemas (ListRolesSchema, GetRoleSchema) are plain z.object — they
// don't mutate, so mutatingBase fields would be meaningless (Phase 9
// GetEntitySharesSchema precedent).
//
// BUILT_IN_ROLES — captured from live 7.0.6 GET /api/roles
// (test/fixtures/authz/roles/list-roles-7.0.6.json). 16 lowercased
// entries — compared case-insensitively in assertRoleIsMutable
// (D-18 / Pitfall 7). The server's RoleService.delete JavaDoc says
// "Deletes the (case insensitively) named role" — a defensive lowercase
// comparison avoids "admin"/"Admin" mismatches. Source: 11-RESEARCH.md
// §"Built-in Roles" lines 321-343.
//
// Plan 11-02 will register the 7 handlers in src/tools/authz/index.js
// and ship the role-helpers.js module that consumes BUILT_IN_ROLES via
// assertRoleIsMutable(roleName). The Set is exported HERE (not in
// role-helpers.js) so the Wave 0 test file can import the parameterized
// refusal loop iterator before Plan 11-02 lands the helper module.
export const BUILT_IN_ROLES = new Set([
    "admin",
    "reader",
    "alerts manager",
    "api browser reader",
    "cluster configuration reader",
    "dashboard creator",
    "data node manager",
    "event definition creator",
    "event notification creator",
    "mcp server access",
    "pipelines manager",
    "sidecar manager",
    "sidecar reader",
    "sidecar system (internal)",
    "user inspector",
    "views manager",
]);

// ListRolesSchema — input for list_roles (D-06, D-07).
//
// Plain z.object — not a mutating tool, so no dryRun/idempotencyKey. The
// optional nameFilter is a case-insensitive substring match applied
// client-side in Plan 11-02 (D-07: no per-role member counts, no N+1).
export const ListRolesSchema = z.object({
    connectionName: z.string().optional(),
    nameFilter: z.string().optional(),
});

// GetRoleSchema — input for get_role (D-06, D-08).
//
// Plain z.object. roleName is required + min(1) so Plan 11-02's
// encodeURIComponent never operates on an empty string. Plan 11-02
// projects /members response to {username, full_name, email} only — the
// schema does NOT carry a member-fields flag; projection is fixed.
export const GetRoleSchema = z.object({
    connectionName: z.string().optional(),
    roleName: z.string().min(1),
});

// CreateRoleSchema — input for create_role (D-02, D-04, D-12).
//
// Permission strings are parsed at handler time as `{type}:{action}[:{id}]`
// (D-02); only the `{type}:{action}` prefix is validated against the live
// catalogue (D-01). permitUnknownPermissions:true opts out per D-04.
// `permissions: z.array(z.string()).min(0)` defensively allows empty —
// Graylog may reject it, surfacing via the apply 400-with-body parser.
export const CreateRoleSchema = mutatingBase.extend({
    name: z.string().min(1),
    description: z.string().optional(),
    permissions: z.array(z.string()).min(0),
    permitUnknownPermissions: z.boolean().optional().default(false),
    confirm: z.string().optional(),
});

// UpdateRoleSchema — input for update_role (D-15).
//
// `permissions` is the FULL target set (D-15 full-replace semantics; Plan
// 11-02 does a pre-flight GET to compute the diff for the dry-run
// preview, but the body shipped to /api/roles/{name} echoes the agent's
// full set verbatim). PITFALL 1 ACCEPTANCE GATE in test/authz-roles.test.js
// pins this contract.
export const UpdateRoleSchema = mutatingBase.extend({
    roleName: z.string().min(1),
    description: z.string().optional(),
    permissions: z.array(z.string()).min(0),
    permitUnknownPermissions: z.boolean().optional().default(false),
    confirm: z.string().optional(),
});

// DeleteRoleSchema — input for delete_role (D-16).
//
// Cascade preview computed at handler time from GET /api/roles/{name}/members
// — schema does not carry cascade flags. Drift refusal on member-list
// change is via the confirmation-token mechanism (D-14).
export const DeleteRoleSchema = mutatingBase.extend({
    roleName: z.string().min(1),
    confirm: z.string().optional(),
});

// AssignRoleSchema — input for assign_role (D-09).
//
// Exactly one user per call (D-09 — no batch). Plan 11-02's apply ships
// body={} (literal empty object, NEVER null — Pitfall 3 / AP1; null skips
// Content-Type and Graylog 415s).
export const AssignRoleSchema = mutatingBase.extend({
    roleName: z.string().min(1),
    username: z.string().min(1),
    confirm: z.string().optional(),
});

// UnassignRoleSchema — input for unassign_role (D-11).
//
// Mirrors AssignRoleSchema. Plan 11-02's handler refuses with
// not_currently_assigned (D-11) if the user is not currently a member,
// and with would_leave_no_admin (D-17 / Pitfall 5) if unassigning the
// last Admin would lock the instance out.
export const UnassignRoleSchema = mutatingBase.extend({
    roleName: z.string().min(1),
    username: z.string().min(1),
    confirm: z.string().optional(),
});
