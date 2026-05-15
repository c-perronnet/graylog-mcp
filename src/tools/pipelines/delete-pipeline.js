// PIPE-05 — delete_pipeline. LEAF DELETE per D-15.
//
// Why leaf: pipelines have no `is_editable` field on the wire (verified
// against PipelineSource.java — Assumption A6 in 04-RESEARCH.md). Unlike
// streams (Phase 3 STREAM-05), deleting a pipeline does NOT trigger a
// server-side cascade-blocking BadRequestException; stream-to-pipeline
// connections referencing this pipeline become orphaned rows that survive
// in the connection table and become recoverable garbage. The agent can
// re-connect any pipeline after recreating it (PIPE-13, Plan 05).
//
// Wrapper contract per D-15:
//   - NO mutable defense-in-depth (pipelines have no is_editable).
//   - NO cascade enumeration (no GET on dependents — orphan rows are
//     handled at the agent level via list_stream_pipeline_connections in
//     Plan 05).
//   - NO confirmation hash (no computeCascadeHash; no _confirmationToken).
//   - NO requireConfirm gate.
//   - build() returns a descriptor WITHOUT a `cascades` key.
//     handler.js's preview emitter spreads `cascades` only when truthy
//     (Plan 02-01 amendment), so the dry-run JSON omits the field
//     entirely — the structural assertion of leaf-delete.
//
// Wire path: DELETE /api/system/pipelines/pipeline/{id} → 204 No Content
// (Pitfall 3: literal `pipeline` segment).
// Sync envelope (no system-job; no Phase 2 D-15 async envelope).

import { defineMutatingHandler } from "../_shared/handler.js";
import { DeletePipelineSchema } from "./schemas.js";

export const handleDeletePipeline = defineMutatingHandler({
    name: "delete_pipeline",
    schema: DeletePipelineSchema,
    build(args) {
        // Leaf delete — NO `cascades` key, NO `_confirmationToken`.
        // handler.js spreads cascades only when truthy and emits
        // confirmationToken only when _confirmationToken is set, so the
        // dry-run JSON omits both. D-15 structural conformance.
        return {
            method: "DELETE",
            path: `/api/system/pipelines/pipeline/${args.pipelineId}`,   // Pitfall 3
            body: undefined,
            postApplyEstimate: { id: args.pipelineId, deleted: true },
        };
    },
    async apply(client, req) {
        await client.request(req.method, req.path, req.body);
        // Sync envelope. Pipelines have no system-job spawn on delete.
        const m = req.path.match(/pipeline\/([^/?]+)$/);
        const pipelineId = m ? m[1] : "unknown";
        return { deleted: true, pipelineId };
    },
    summarize: (args) => `Delete pipeline ${args.pipelineId}`,
});
