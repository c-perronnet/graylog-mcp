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
import { TEMPLATE_NAMES } from "../../widget-templates/index.js";

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

// =====================================================================
// Plan 06-05 — BLUE-01/02/03 schemas (HEADLINE 6-step chain + 1-step
// error-alert + 1-conceptual-step app-health dashboard).
// =====================================================================

// =====================================================================
// BLUE-01 — setup_app_monitoring_stack (HEADLINE 6-step chain).
// Composes streams + pipeline rule + pipeline + connect + dashboard
// (internal Search+View 2-step) + event definition. T-06-05-01:
// app_name is regex-clamped to alphanumeric + hyphen/underscore at
// parse time — defense against shell-injection-like chars BEFORE any
// path concatenation or DSL emission.
// =====================================================================
const TEMPLATE_NAME_TUPLE = /** @type {[string, ...string[]]} */ (TEMPLATE_NAMES);

export const SetupAppMonitoringStackSchema = mutatingBase.extend({
    app_name: z.string().min(1).regex(
        /^[a-zA-Z0-9_-]+$/,
        "app_name must be alphanumeric + underscore/hyphen",
    ),
    source_pattern: z.string().min(1),  // e.g. "payment-*"
    indexSetId: z.string().min(
        1,
        "indexSetId required — agent must pass an existing index_set id (get from list_index_sets)",
    ),
    errorRateThreshold: z.number().int().positive().default(50),  // events per 5 minutes
    defaultDashboardWidgets: z.array(z.enum(TEMPLATE_NAME_TUPLE)).default([
        "error_rate_over_time",
        "top_sources_by_volume",
        "level_distribution",
        "recent_events_table",
    ]),
});

// =====================================================================
// BLUE-02 — setup_error_alerting (1-step chain wrapping
// createEventDefinition with an agent-supplied notification reference).
// =====================================================================
export const SetupErrorAlertingSchema = mutatingBase.extend({
    streamId: z.string().min(1),
    notificationId: z.string().min(
        1,
        "notificationId required — agent must obtain from list_event_notifications",
    ),
    title: z.string().optional(),
    errorRateThreshold: z.number().int().positive().default(50),
    searchWithinMinutes: z.number().int().positive().default(5),
});

// =====================================================================
// BLUE-03 — create_app_health_dashboard (1-conceptual-step blueprint;
// internally a 2-step Search+View chain like create_dashboard but with
// 4 default widgets pre-wired to the agent-supplied stream).
// =====================================================================
export const CreateAppHealthDashboardSchema = mutatingBase.extend({
    streamId: z.string().min(1),
    title: z.string().optional(),
    defaultWidgets: z.array(z.enum(TEMPLATE_NAME_TUPLE)).default([
        "error_rate_over_time",
        "top_sources_by_volume",
        "level_distribution",
        "recent_events_table",
    ]),
});
