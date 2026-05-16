// Per-blueprint zod schemas for Phase 6 Plan 04 (BLUE-04/05/06).
//
// All schemas extend `mutatingBase` so the cross-cutting fields (dryRun,
// connectionName, idempotencyKey) appear via the standard wrapper. Plan 05
// will add the remaining 3 schemas (BLUE-01/02/03) to this same file.
//
// Architectural note (D-09): Blueprints compose from src/services/* ONLY.
// These schemas validate agent input shape; the per-blueprint handlers
// route the validated args through service-layer wrappers + executeChain.

import { z } from "zod";
import { mutatingBase } from "../_shared/schemas.js";
import { RuleSpecSchema } from "../pipelines/schemas.js";

// =====================================================================
// BLUE-05 — setup_long_term_archival_index
// 1-step chain wrapping create_index_set with bundled SizeBasedRotation +
// DeletionRetention configs. retentionDays approximates 1 index per day via
// max_number_of_indices (Graylog's deletion strategy is index-count based,
// not time-based — the approximation is documented in the tool description).
// =====================================================================

export const SetupLongTermArchivalIndexSchema = mutatingBase.extend({
    name: z.string().min(1, "name required"),
    retentionDays: z.number().int().positive().max(36500, "retentionDays must be 1..36500"),
    description: z.string().optional(),
    indexPrefix: z.string().optional(),         // defaults to slugified name
    shards: z.number().int().positive().optional(),
    replicas: z.number().int().nonnegative().optional(),
});

// =====================================================================
// BLUE-06 — setup_debug_log_dropping (Plan 06-04 Task 2)
// 3-step chain: createRule (drop on level > minLevel) + createPipeline
// (single-stage referencing the rule by title) + connectToStream.
// Syslog level inversion: HIGHER number = LESS severe; the predicate
// `level > minLevel` drops sub-threshold (less severe) messages.
// =====================================================================

export const SetupDebugLogDroppingSchema = mutatingBase.extend({
    streamId: z.string().min(1),
    minLevel: z.number().int().min(0).max(7),  // syslog 0..7; drops messages with level > minLevel
    pipelineTitle: z.string().optional(),       // default: "Drop sub-${minLevel} for stream ${streamId}"
    ruleTitle: z.string().optional(),           // default: "drop_sub_${minLevel}"
});

// =====================================================================
// BLUE-04 — setup_pipeline_for_stream (Plan 06-04 Task 3)
// Variable-length chain: N createRule steps (one per transform) +
// 1 createPipeline + 1 connectToStream → N+2 total.
// Reuses Phase 4's RuleSpecSchema for each transform; emitRule compiles
// structured intent → DSL source string at build() time.
// =====================================================================

export const SetupPipelineForStreamSchema = mutatingBase.extend({
    streamId: z.string().min(1),
    pipelineTitle: z.string().min(1),
    pipelineDescription: z.string().optional(),
    transforms: z.array(RuleSpecSchema)
        .min(1, "at least one transform")
        .max(20, "max 20 transforms"),
});

// Plan 06-05 adds the remaining 3 schemas (BLUE-01/02/03).
