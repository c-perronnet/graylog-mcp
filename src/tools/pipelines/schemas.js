// Pipeline tools — Phase 4.
//
// CRITICAL — Pitfall 3 (RESEARCH §"Pitfall 3: Pipeline path is `/pipeline/`,
// not bare"): ALL pipeline paths use the literal `/api/system/pipelines/pipeline/{id}`
// segment (the singular noun `pipeline` is part of the path). Bare
// `/api/system/pipelines/{id}` returns 404.
//
// Rule paths use `/api/system/pipelines/rule/{id}` (also with the literal
// `rule` segment). The pipeline-rule schemas land in a future plan; this
// file scopes itself to pipeline CRUD (PIPE-01..PIPE-05).

import { z } from "zod";
import { mutatingBase, listBase } from "../_shared/schemas.js";

// PIPE-01 — list_pipelines. No per-tool args; narrows to listBase
// (connectionName / fields / limit). The synthetic `stages_count` projection
// happens inside list-pipelines.js's fetch callback.
export const ListPipelinesSchema = listBase;

// PIPE-02 — get_pipeline. Single-target read; takes a required pipelineId.
// Plain ZodObject (NOT extending mutatingBase) because this is a read tool
// and the framework's mutatingBase fields (dryRun, idempotencyKey) would be
// confusing on a GET. Schema-parity test catches drift against tools.js.
export const GetPipelineSchema = z.object({
    connectionName: z.string().optional(),
    pipelineId: z.string().min(1, "pipelineId is required"),
});

// PIPE-03 — create_pipeline. `source` REQUIRED; `title` REQUIRED.
// `description` optional. The wrapper calls POST /system/pipelines/pipeline/parse
// before issuing the create POST. If parse fails, GraylogValidationError with
// reason:"pipeline_parse_failed" is thrown; handler.js routes it through
// wrapGraylogError and apply NEVER runs (C4 mitigation gate).
//
// Pipelines accept raw DSL only — no structured-intent emission at this layer
// (deferred per 04-CONTEXT.md §"Deferred Ideas"). Use the structured-intent
// emitter in src/pipeline-dsl/emit.js for rule-level work in a later plan.
export const CreatePipelineSchema = mutatingBase.extend({
    title: z.string().min(1),
    description: z.string().optional(),
    source: z.string().min(1),
});

// PIPE-04 — update_pipeline. STRICT_NO_ECHO partial-update per
// 04-U1-SMOKE.md (D-16 UNREACHABLE_STRICT_NO_ECHO → STRICT_NO_ECHO chosen).
// The `changes` shape carries the 3 optional fields; the build() wires only
// what's present. When changes.source is set, the parse pre-flight fires.
// When only title/description change, the parse round-trip is skipped.
//
// `description` uses z.union([z.string(), z.null()]).optional() to preserve
// the omit-vs-explicit-null distinction. Omission → no-op (current value
// preserved server-side); explicit null → clear-intent (wire body emits
// `description: null`). z.string().nullish() collapses both, so we
// destructure explicitly.
const UpdatePipelineChangesShape = z.object({
    title: z.string().min(1).optional(),
    description: z.union([z.string(), z.null()]).optional(),
    source: z.string().min(1).optional(),
});
export const UpdatePipelineSchema = mutatingBase.extend({
    pipelineId: z.string().min(1),
    changes: UpdatePipelineChangesShape,
});

// PIPE-05 — delete_pipeline. LEAF DELETE per D-15 (pipelines have no
// `is_editable` field; no cascade pre-flight). Orphaned stream connections
// become recoverable garbage — see tool description in tools.js.
export const DeletePipelineSchema = mutatingBase.extend({
    pipelineId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Plan 04-03 — Pipeline-rule schemas (PIPE-06..PIPE-09).
//
// D-11 Structured Intent Grammar (RESEARCH §"Structured Intent Grammar" lines
// 773-825). Full DSL coverage — closed-set discriminated unions for Condition
// and Action. Recursive via z.lazy (zod 3.25.76 supports it).
//
// The structured form is the agent-facing typed shape; the emitter
// (src/pipeline-dsl/emit.js) compiles it to a DSL string. The server-side
// parse pre-flight (D-05) is the authoritative validation gate; this schema's
// job is shape-correctness, not semantic correctness.
//
// Pitfall 3 (rule variant): all rule paths use the literal
// `/api/system/pipelines/rule/{id}` segment — handled at the handler layer,
// not the schema, but cited here as the cross-cutting URL invariant.
// ---------------------------------------------------------------------------

// Forward declarations (zod requires z.lazy at the recursion site).
const LiteralSchema = z.object({
    type: z.literal("literal"),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
});

const FieldRefSchema = z.object({
    type: z.literal("field_ref"),
    field: z.string().min(1),
    source: z.union([
        z.literal("message"),
        z.object({ type: z.literal("identifier"), name: z.string().min(1) }),
    ]).optional(),
});

const HasFieldSchema = z.object({
    type: z.literal("has_field"),
    field: z.string().min(1),
});

// FunctionCall — args is EITHER positional OR named, never both (refine).
// z.lazy so ExpressionSchema (which recurses into ConditionSchema) is
// resolved at use site.
export const FunctionCallSchema = z.lazy(() =>
    z.object({
        type: z.literal("function_call"),
        name: z.string().min(1),
        args: z.object({
            positional: z.array(ExpressionSchema).optional(),
            named: z.record(ExpressionSchema).optional(),
        }).refine(
            (a) => !(a.positional && a.named),
            { message: "function_call.args: positional OR named, not both" },
        ),
    })
);

// ExpressionSchema = Condition variants treated as expressions
// (RuleLang.g4 line 77-96 treats them as a single non-terminal).
export const ExpressionSchema = z.lazy(() => z.union([
    LiteralSchema,
    FieldRefSchema,
    HasFieldSchema,
    FunctionCallSchema,
    ConditionSchema,
]));

export const ConditionSchema = z.lazy(() => z.discriminatedUnion("type", [
    z.object({
        type: z.literal("comparison"),
        op: z.enum(["==", "!=", "<", "<=", ">", ">="]),
        left: ExpressionSchema,
        right: ExpressionSchema,
    }),
    z.object({ type: z.literal("and"), left: ConditionSchema, right: ConditionSchema }),
    z.object({ type: z.literal("or"),  left: ConditionSchema, right: ConditionSchema }),
    z.object({ type: z.literal("not"), expr: ConditionSchema }),
    z.object({
        type: z.literal("function_call"),
        name: z.string().min(1),
        args: z.object({
            positional: z.array(ExpressionSchema).optional(),
            named: z.record(ExpressionSchema).optional(),
        }).refine(
            (a) => !(a.positional && a.named),
            { message: "function_call.args: positional OR named, not both" },
        ),
    }),
    HasFieldSchema,
    FieldRefSchema,
    LiteralSchema,
]));

export const ActionSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("set_field"),
        field: z.string().min(1),
        value: ExpressionSchema,
        message: ExpressionSchema.optional(),
        default: ExpressionSchema.optional(),
        clean_field: z.boolean().optional(),
        prefix: z.string().optional(),
        suffix: z.string().optional(),
    }),
    z.object({
        type: z.literal("remove_field"),
        field: z.string().min(1),
        message: ExpressionSchema.optional(),
    }),
    z.object({
        type: z.literal("rename_field"),
        old_field: z.string().min(1),
        new_field: z.string().min(1),
        message: ExpressionSchema.optional(),
    }),
    z.object({
        type: z.literal("lookup_value"),
        target_field: z.string().min(1),
        lookup_table: z.string().min(1),
        key: ExpressionSchema,
        default: ExpressionSchema.optional(),
    }),
    z.object({
        type: z.literal("function_call_statement"),
        name: z.string().min(1),
        args: z.object({
            positional: z.array(ExpressionSchema).optional(),
            named: z.record(ExpressionSchema).optional(),
        }),
    }),
    z.object({
        type: z.literal("let_assignment"),
        var_name: z.string().min(1),
        value: ExpressionSchema,
    }),
]);

export const RuleSpecSchema = z.object({
    name: z.string().min(1),
    when: ConditionSchema,
    then: z.array(ActionSchema).min(1, "RuleSpec.then must contain at least one Action"),
});

// PIPE-06 — list_pipeline_rules. Narrow projection
// [id, title, description, created_at, modified_at]. Source text is excluded
// from the default projection — agents call get_pipeline_rule when they need
// the full DSL. Token-budget-friendly for clusters with many rules.
export const ListPipelineRulesSchema = listBase;

// PIPE-07 — get_pipeline_rule. Plain ZodObject (NOT mutatingBase) because
// this is a read tool. Schema-parity test catches drift against tools.js.
export const GetPipelineRuleSchema = z.object({
    connectionName: z.string().optional(),
    ruleId: z.string().min(1, "ruleId is required"),
});

// PIPE-08 — create_pipeline_rule. D-10 mutual exclusion via zod .refine —
// agent supplies EXACTLY ONE of `structured` or `ruleSource`. Boolean XOR
// across the two: Boolean(undefined) === false; Boolean(non-empty) === true;
// the inequality test is the XOR — exactly-one-of check.
//
// When `structured` is set, the wrapper compiles via emit.js BEFORE the
// parse pre-flight; when `ruleSource` is set, the raw string forwards
// verbatim. Both modes pass through validate.js (D-04) and then the
// server-side parse pre-flight (D-05 / C4 gate).
//
// `simulator_message` is Nullable String per RuleSource.java — STRICT_NO_ECHO
// preserves explicit-null clear-intent on the wire.
export const CreatePipelineRuleSchema = mutatingBase.extend({
    structured: RuleSpecSchema.optional(),
    ruleSource: z.string().min(1).optional(),
    description: z.string().optional(),
    simulator_message: z.string().nullable().optional(),
}).refine(
    (args) => Boolean(args.structured) !== Boolean(args.ruleSource),
    { message: "create_pipeline_rule: provide EXACTLY ONE of `structured` or `ruleSource` (D-10 mutual exclusion)" },
);

// PIPE-09 — update_pipeline_rule. STRICT_NO_ECHO partial-update per
// 04-U1-SMOKE.md (D-16). The `changes` envelope carries the 4 optional
// mutable fields. simulator_message uses z.string().nullable().optional()
// to preserve omit-vs-explicit-null intent precisely:
//   - omitted → wrapper omits from wire → server no-op
//   - null    → wrapper emits `simulator_message: null` → explicit clear
//   - string  → wrapper emits the string → set value
//
// description follows the same 3-state pattern via z.union([string, null]).
//
// .refine rejects when BOTH ruleSource AND structured are set in changes —
// same XOR-style mutual-exclusion as CreatePipelineRuleSchema (but on the
// inner changes envelope; both being absent is allowed and represents a
// title/description-only update).
const UpdatePipelineRuleChangesShape = z.object({
    ruleSource: z.string().min(1).optional(),
    structured: RuleSpecSchema.optional(),
    description: z.union([z.string(), z.null()]).optional(),
    simulator_message: z.string().nullable().optional(),
}).refine(
    (changes) => !(changes.ruleSource && changes.structured),
    { message: "update_pipeline_rule.changes: ruleSource OR structured, not both" },
);
export const UpdatePipelineRuleSchema = mutatingBase.extend({
    ruleId: z.string().min(1),
    changes: UpdatePipelineRuleChangesShape,
});

// ---------------------------------------------------------------------------
// Plan 04-05 — Pipeline-stream connection schemas (PIPE-13/14).
//
// CRITICAL — Pitfall 2 (RESEARCH lines 1112-1120): POST
// /api/system/pipelines/connections/to_stream is REPLACE-the-full-set
// semantics (PipelineConnectionsResource.java:81-100 — connectionsService.save
// is full replacement, NOT merge). To implement "attach pipelines" (PIPE-13)
// and "detach pipelines" (PIPE-14) at the agent boundary, the WRAPPER does
// the merge/subtract client-side. Schema-layer enforcement: pipelineIds is
// REQUIRED and non-empty (`.min(1)`) for BOTH — the agent must commit to
// at least one pipeline ID to either attach or detach.
//
// Both share the same wire endpoint shape (PipelineConnections{stream_id,
// pipeline_ids}) but the handler-side build() differs:
//   - PIPE-13: GET-merge-POST (union with current set, sorted)
//   - PIPE-14: GET-subtract-POST (difference from current set, sorted)
// ---------------------------------------------------------------------------

// PIPE-13 — connect_pipelines_to_stream. ATTACH pipelines to a stream;
// Graylog endpoint is REPLACE-the-full-set, the wrapper does GET-merge-POST
// client-side to preserve previously-connected pipelines (Pitfall 2).
export const ConnectPipelinesToStreamSchema = mutatingBase.extend({
    streamId: z.string().min(1),
    pipelineIds: z.array(z.string().min(1)).min(1, "pipelineIds must contain at least one pipeline ID"),
});

// PIPE-14 — disconnect_pipelines_from_stream. DETACH pipelines from a
// stream; same wire endpoint as PIPE-13, wrapper does GET-subtract-POST to
// preserve remaining connections (Pitfall 2 mirror).
export const DisconnectPipelinesFromStreamSchema = mutatingBase.extend({
    streamId: z.string().min(1),
    pipelineIds: z.array(z.string().min(1)).min(1, "pipelineIds must contain at least one pipeline ID"),
});
