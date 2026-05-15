// Per-domain zod schemas for the index-sets domain.
//
// Plan 02-01 shipped the two read-only schemas: ListIndexSetsSchema (extends
// listBase) and GetIndexSetSchema (single-target read; takes a required
// indexSetId).
//
// Plan 02-02 (this file's current shape) extends with:
//   - ISO_DURATION regex
//   - 5 strict strategy-config zod schemas (D-09)
//   - ROTATION_CONFIG_BY_ALIAS + RETENTION_CONFIG_BY_ALIAS (alias → config schema)
//   - RotationAliasEnum + RetentionAliasEnum (closed enums for D-08)
//   - CreateIndexSetSchema (D-10 required strategies + per-alias variant narrowing via superRefine)
//   - UpdateIndexSetSchema (D-11 atomic strategy-replace via superRefine)
//
// Plans 02-03 / 02-04 will extend further with delete + set_default + cycle.

import { z } from "zod";
import { listBase, mutatingBase } from "../_shared/schemas.js";

// INDEX-01: list_index_sets — narrows to listBase. The defaultFields override
// is applied at the defineListHandler call site (list-index-sets.js), not at
// schema validation time, so the schema stays minimal.
export const ListIndexSetsSchema = listBase;

// INDEX-02: get_index_set — single-target read; takes a required indexSetId.
// Plain async handler (NOT defineListHandler) because the response is a single
// IndexSetResponse DTO, not a projected list.
export const GetIndexSetSchema = z.object({
    connectionName: z.string().optional(),
    indexSetId: z.string().min(1, "indexSetId is required"),
});

// =====================================================================
// Plan 02-02 — Strategy schemas + CreateIndexSetSchema + UpdateIndexSetSchema
// =====================================================================

// ISO-8601 duration regex (verified against TimeBasedRotationStrategyConfig.java
// — Joda Period deserializer accepts ISO-8601 duration syntax: P[n]Y[n]M[n]W[n]D
// + T[n]H[n]M[n]S, requires at least one component (the `(?!$)` lookahead).
// Examples: "P1D", "P7D", "PT6H", "P1M2DT3H", "P0.5S". Phase 2-02 RESEARCH.md
// §Time period shape note.
export const ISO_DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/;

// --- 5 strict strategy-config schemas (D-09) ---

// Rotation: time-based — Joda Period (ISO-8601 duration) required; the
// optional max_rotation_period caps how long Graylog waits before a forced
// rotation when the period itself elapses without rotation criteria firing.
const TimeBasedConfig = z.object({
    rotation_period: z.string().regex(ISO_DURATION, "ISO-8601 duration required (e.g. P1D, PT6H, P30D)"),
    max_rotation_period: z.string().regex(ISO_DURATION).optional(),
    rotate_empty_index_set: z.boolean().optional().default(false),
});

// Rotation: size-based — bytes; Graylog `@Min(1)` so positive int required.
const SizeBasedConfig = z.object({
    max_size: z.number().int().positive(),
});

// Rotation: message-count — docs per index; Graylog `@Min(1)`.
const MessageCountConfig = z.object({
    max_docs_per_index: z.number().int().positive(),
});

// Retention: delete — max_number_of_indices retained; Graylog `@Min(1)`.
const DeleteRetentionConfig = z.object({
    max_number_of_indices: z.number().int().positive(),
});

// Retention: close — same shape as delete (Graylog's ClosingRetentionStrategy
// uses the same config DTO field). The two are different strategy classes
// with different runtime behavior (delete drops the index vs. close keeps it
// on disk but stops indexing).
const CloseRetentionConfig = z.object({
    max_number_of_indices: z.number().int().positive(),
});

// Maps used by CreateIndexSetSchema / UpdateIndexSetSchema superRefine
// dispatch + by Plan 02-02 strategies.js translators (aliasToConfigOrError
// looks them up indirectly via ROTATION_FQCN / RETENTION_FQCN).
export const ROTATION_CONFIG_BY_ALIAS = {
    "time-based": TimeBasedConfig,
    "size-based": SizeBasedConfig,
    "message-count": MessageCountConfig,
};

export const RETENTION_CONFIG_BY_ALIAS = {
    "delete": DeleteRetentionConfig,
    "close": CloseRetentionConfig,
};

// Closed enums per D-08. Note "archive" appears in RetentionAliasEnum so the
// zod parse step accepts the alias and the structured wire-build rejection
// surfaces at aliasToConfigOrError time (with reason: archive_not_supported)
// rather than the generic z.enum "invalid_enum_value" — better agent UX.
const RotationAliasEnum = z.enum(["time-based", "size-based", "message-count"]);
const RetentionAliasEnum = z.enum(["delete", "close", "archive"]);

// --- INDEX-03: CreateIndexSetSchema (D-10 + D-08 + D-09 + variant narrowing) ---
//
// D-10: rotation_strategy + rotation_strategy_config AND retention_strategy
// + retention_strategy_config are ALL required. No defaults on destruction
// policies — the agent must reason about retention every time.
//
// D-08: rotation/retention strategies are friendly aliases (closed enums).
//
// D-09: per-alias strategy_config is narrowed by superRefine — same variant
// dispatch pattern as Phase 1's CreateInputSchema (per-FQCN configuration
// narrow) and CreateExtractorSchema (per-type extractor_config narrow).
//
// Defaults shipped (so the agent doesn't have to spell out every infrastructure
// knob): description, shards, replicas, index_analyzer,
// index_optimization_max_num_segments, index_optimization_disabled,
// field_type_refresh_interval, writable, use_legacy_rotation. Verified
// against IndexSetConfig.java defaults.
export const CreateIndexSetSchema = mutatingBase.extend({
    title: z.string().min(1, "title is required"),
    description: z.string().optional().default(""),
    index_prefix: z.string()
        .min(1, "index_prefix is required")
        .regex(/^[a-z0-9_-]+$/, "index_prefix must match /^[a-z0-9_-]+$/ (lowercase alphanumerics + _ + -)"),
    shards: z.number().int().positive().optional().default(4),
    replicas: z.number().int().nonnegative().optional().default(0),
    rotation_strategy: RotationAliasEnum,
    rotation_strategy_config: z.record(z.unknown()),
    retention_strategy: RetentionAliasEnum,
    retention_strategy_config: z.record(z.unknown()),
    index_analyzer: z.string().optional().default("standard"),
    index_optimization_max_num_segments: z.number().int().positive().optional().default(1),
    index_optimization_disabled: z.boolean().optional().default(false),
    field_type_refresh_interval: z.number().int().nonnegative().optional().default(5000),
    writable: z.boolean().optional().default(true),
    use_legacy_rotation: z.boolean().optional().default(true),
}).superRefine((args, ctx) => {
    // Per-alias narrowing of rotation_strategy_config.
    const rotSchema = ROTATION_CONFIG_BY_ALIAS[args.rotation_strategy];
    if (rotSchema) {
        const parsed = rotSchema.safeParse(args.rotation_strategy_config);
        if (!parsed.success) {
            for (const issue of parsed.error.issues) {
                ctx.addIssue({ ...issue, path: ["rotation_strategy_config", ...issue.path] });
            }
        }
    }
    // Per-alias narrowing of retention_strategy_config. "archive" is in the
    // enum but has no entry in RETENTION_CONFIG_BY_ALIAS — the schema accepts
    // any shape for archive, and aliasToConfigOrError will surface the
    // archive_not_supported rejection at build() time.
    const retSchema = RETENTION_CONFIG_BY_ALIAS[args.retention_strategy];
    if (retSchema) {
        const parsed = retSchema.safeParse(args.retention_strategy_config);
        if (!parsed.success) {
            for (const issue of parsed.error.issues) {
                ctx.addIssue({ ...issue, path: ["retention_strategy_config", ...issue.path] });
            }
        }
    }
});

// --- INDEX-04: UpdateIndexSetSchema (D-11 atomic strategy-replace + per-alias narrow) ---
//
// D-11: if changes.rotation_strategy is set, changes.rotation_strategy_config
// MUST also be set (and vice versa). Same rule for retention. Top-level
// non-strategy fields (title, description, shards, replicas, writable, ...)
// use field-level partial-update — each is independently optional.
//
// Note (U1 resolution per 02-U1-SMOKE.md = UNREACHABLE_DEFAULT_MERGE): the
// wire-build implementation in update-index-set.js uses the merge-from-current
// pattern. The schema is U1-agnostic — only the build() implementation differs
// between the strict-no-echo and merge-from-current paths. Both paths share
// the same { indexSetId, changes: {...} } argument shape.
const UpdateChangesShape = z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    shards: z.number().int().positive().optional(),
    replicas: z.number().int().nonnegative().optional(),
    writable: z.boolean().optional(),
    rotation_strategy: RotationAliasEnum.optional(),
    rotation_strategy_config: z.record(z.unknown()).optional(),
    retention_strategy: RetentionAliasEnum.optional(),
    retention_strategy_config: z.record(z.unknown()).optional(),
    index_optimization_max_num_segments: z.number().int().positive().optional(),
    index_optimization_disabled: z.boolean().optional(),
    field_type_refresh_interval: z.number().int().nonnegative().optional(),
    index_analyzer: z.string().optional(),
}).refine((c) => Object.keys(c).length > 0, {
    message: "changes must be non-empty",
}).superRefine((c, ctx) => {
    // D-11 atomic strategy-replace: strategy + strategy_config are a pair.
    if (c.rotation_strategy !== undefined && c.rotation_strategy_config === undefined) {
        ctx.addIssue({
            code: "custom",
            path: ["rotation_strategy_config"],
            message: "rotation_strategy_config is required when rotation_strategy is provided (D-11 atomic strategy-replace)",
        });
    }
    if (c.rotation_strategy_config !== undefined && c.rotation_strategy === undefined) {
        ctx.addIssue({
            code: "custom",
            path: ["rotation_strategy"],
            message: "rotation_strategy is required when rotation_strategy_config is provided (D-11 atomic strategy-replace)",
        });
    }
    if (c.retention_strategy !== undefined && c.retention_strategy_config === undefined) {
        ctx.addIssue({
            code: "custom",
            path: ["retention_strategy_config"],
            message: "retention_strategy_config is required when retention_strategy is provided (D-11)",
        });
    }
    if (c.retention_strategy_config !== undefined && c.retention_strategy === undefined) {
        ctx.addIssue({
            code: "custom",
            path: ["retention_strategy"],
            message: "retention_strategy is required when retention_strategy_config is provided (D-11)",
        });
    }
    // Per-alias narrowing of the strategy_config shapes (mirrors CreateIndexSetSchema's
    // superRefine but scoped to `changes`).
    if (c.rotation_strategy !== undefined) {
        const rotSchema = ROTATION_CONFIG_BY_ALIAS[c.rotation_strategy];
        if (rotSchema && c.rotation_strategy_config !== undefined) {
            const parsed = rotSchema.safeParse(c.rotation_strategy_config);
            if (!parsed.success) {
                for (const issue of parsed.error.issues) {
                    ctx.addIssue({ ...issue, path: ["rotation_strategy_config", ...issue.path] });
                }
            }
        }
    }
    if (c.retention_strategy !== undefined) {
        const retSchema = RETENTION_CONFIG_BY_ALIAS[c.retention_strategy];
        if (retSchema && c.retention_strategy_config !== undefined) {
            const parsed = retSchema.safeParse(c.retention_strategy_config);
            if (!parsed.success) {
                for (const issue of parsed.error.issues) {
                    ctx.addIssue({ ...issue, path: ["retention_strategy_config", ...issue.path] });
                }
            }
        }
    }
});

export const UpdateIndexSetSchema = mutatingBase.extend({
    indexSetId: z.string().min(1, "indexSetId is required"),
    changes: UpdateChangesShape,
});

// =====================================================================
// Plan 02-03 — DeleteIndexSetSchema (INDEX-05; C1 mitigation centerpiece)
// =====================================================================
//
// D-04 inverted default: deleteIndices defaults to false in the MCP wrapper,
// inverting Graylog's server-side @DefaultValue(true). To actually destroy
// the Elasticsearch indices, the agent must EXPLICITLY pass
// `deleteIndices: true` AND echo the dry-run confirmationToken back as
// `confirm` (D-01 — apply-time gate enforced by handler.js's requireConfirm
// hook).
//
// confirm is optional at the schema layer — the requireConfirm gate fires at
// apply time when build() set _confirmationToken (the deleteIndices:true
// branch). The metadata-only path (deleteIndices:false) issues no token and
// the gate is a no-op.

export const DeleteIndexSetSchema = mutatingBase.extend({
    indexSetId: z.string().min(1, "indexSetId is required"),
    deleteIndices: z.boolean().optional().default(false), // D-04 INVERTED DEFAULT
    confirm: z.string().optional(),                       // D-01 echo-the-token
});

// =====================================================================
// Plan 02-04 — SetDefaultIndexSetSchema (INDEX-06) + CycleDeflectorSchema (INDEX-07)
// =====================================================================
//
// SetDefaultIndexSetSchema (UPDATED D-13 + m2): the handler pre-flights
// GET /api/system/indices/index_sets/{id} and reads `can_be_default: boolean` —
// the server's derived eligibility flag. When can_be_default === false
// (events-style, system, or any future-rejected index set), build() throws
// GraylogValidationError with reason `default_eligibility_failed` BEFORE the
// PUT fires. The schema itself is minimal — just indexSetId; eligibility is a
// pre-flight wire concern, not a zod-layer concern.
//
// CycleDeflectorSchema (UPDATED D-14 SYNCHRONOUS + ND3): the handler
// pre-flights GET on the index set and refuses if current.writable === false
// (ND3 — DeflectorResource.checkCycle throws 400 if !indexSet.getConfig()
// .isWritable()). On apply, the rotation is synchronous (verified against
// Graylog 7.0.6 DeflectorResource.cycle — calls indexSet.cycle() directly,
// NOT via systemJobManager.submit). The closed-index range rebuild kicks
// off as a separate system job observable via /system/jobs.

export const SetDefaultIndexSetSchema = mutatingBase.extend({
    indexSetId: z.string().min(1, "indexSetId is required"),
});

export const CycleDeflectorSchema = mutatingBase.extend({
    indexSetId: z.string().min(1, "indexSetId is required"),
});
