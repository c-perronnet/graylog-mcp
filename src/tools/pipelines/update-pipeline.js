// PIPE-04 — update_pipeline. PUT /api/system/pipelines/pipeline/{id}.
//
// U1 smoke RESULT (04-U1-SMOKE.md): UNREACHABLE_STRICT_NO_ECHO — defaults
// to STRICT_NO_ECHO per Phase 3 precedent. Pipelines carry no encrypted
// fields (verified PipelineSource.java) so STRICT_NO_ECHO has no
// zero-out risk; consistent with Phase 1+ partial-update pattern.
//
// STRICT_NO_ECHO contract: the wire body emits ONLY the fields present in
// args.changes. The wrapper does NOT echo `current.*` fields. The
// conditional-spread pattern preserves agent intent — `description: null`
// is emitted as `description: null` (intent to clear), whereas omitting
// description entirely emits nothing.
//
// D-06 parse pre-flight fires ONLY when args.changes.source is set —
// title/description changes do not require a parse round-trip. parseResult
// is OMITTED from the descriptor when source isn't touched (keeps the
// preview JSON lean).
//
// D-15: NO mutable defense-in-depth here (pipelines have no is_editable
// field on the wire). The Phase 0 writable-flag gate (D-07) is the sole
// safety gate at the connection level; per-pipeline immutability is
// not a wire concept. Even if a hypothetical future PipelineSource ships
// an is_editable annotation, this wrapper will NOT consult it without an
// explicit plan decision — additive only.

import { defineMutatingHandler } from "../_shared/handler.js";
import { UpdatePipelineSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { preflightParsePipeline } from "./create-pipeline.js";
import { toIdBody } from "../../graylog/normalize.js";

export const handleUpdatePipeline = defineMutatingHandler({
    name: "update_pipeline",
    schema: UpdatePipelineSchema,
    async build(args) {
        const client = makeClient(args._conn);
        const path = `/api/system/pipelines/pipeline/${args.pipelineId}`;   // Pitfall 3

        // Pre-flight GET current pipeline (404 surfaces as MCP error envelope
        // via wrapGraylogError; D-15: NO mutable check on the response).
        await client.request("GET", path, null);

        // STRICT_NO_ECHO wire body — emit ONLY the fields the agent touched.
        // The conditional spread preserves omit-vs-explicit-null intent:
        //   - undefined → omit from wire body (server-side no-op)
        //   - null → wire-emit { description: null } (explicit clear)
        const wireBody = {
            ...(args.changes.title !== undefined ? { title: args.changes.title } : {}),
            ...(args.changes.description !== undefined ? { description: args.changes.description } : {}),
            ...(args.changes.source !== undefined ? { source: args.changes.source } : {}),
        };

        // Parse pre-flight ONLY when source is touched. Reuses the helper
        // shipped in create-pipeline.js — both handlers share the exact
        // same wrapper contract (reason:"pipeline_parse_failed" on 400;
        // Pitfall 6 camelCase → snake_case translation). Plan 03's rule
        // handlers will compose against the same shape.
        let parseResult;
        if (args.changes.source !== undefined) {
            parseResult = await preflightParsePipeline(client, args.changes.source);
        }

        return {
            method: "PUT",
            path,
            body: wireBody,
            ...(parseResult ? { parseResult } : {}),    // OMIT key when source wasn't touched
            postApplyEstimate: { id: args.pipelineId },
            normalize: (raw) => toIdBody(raw, { idFields: ["id"] }),
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) => `Update pipeline ${args.pipelineId} (${Object.keys(args.changes).length} change(s))`,
});
