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
