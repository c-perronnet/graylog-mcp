// PIPE-14 — disconnect_pipelines_from_stream. DETACH semantics.
//
// Same wire endpoint as PIPE-13 (POST /api/system/pipelines/connections/to_stream
// — REPLACE-the-full-set server-side per PipelineConnectionsResource.java:81-100);
// the wrapper does GET-subtract-POST to preserve the remaining connections
// (Pitfall 2 mirror — detaching pipeline X should not silently disconnect Y
// and Z that were also attached to the stream).
//
// 404 on the GET means there's no connection record yet → currentSet is
// empty → reduced is empty → POST still fires with pipeline_ids: []
// (idempotent no-op; Graylog accepts an empty pipeline_ids set, just stores
// the record). The POST is issued for CONSISTENCY with the connect path —
// agents see the same wire-shape regardless of whether the connection record
// existed before.
//
// Idempotency: pipelines that were already NOT connected surface in
// existingMatches with similarity_reason: "not_currently_connected" — agent
// sees the no-op detaches without having to diff client-side.
//
// pipeline_ids are sorted alphabetically on the wire for deterministic
// snapshot fixtures (Plan 04-06).

import { defineMutatingHandler } from "../_shared/handler.js";
import { DisconnectPipelinesFromStreamSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";

export const handleDisconnectPipelinesFromStream = defineMutatingHandler({
    name: "disconnect_pipelines_from_stream",
    schema: DisconnectPipelinesFromStreamSchema,
    async build(args) {
        const client = makeClient(args._conn);
        const getPath = `/api/system/pipelines/connections/${args.streamId}`;

        // Pre-flight GET — fetch current pipeline_ids set. 404 = no record
        // (nothing to subtract from). Any other error propagates.
        let current;
        try {
            current = await client.request("GET", getPath, null);
        } catch (err) {
            if (err?.isGraylogError && err.status === 404) {
                current = { stream_id: args.streamId, pipeline_ids: [] };
            } else {
                throw err;
            }
        }

        const currentArray = Array.isArray(current?.pipeline_ids) ? current.pipeline_ids : [];
        const currentSet = new Set(currentArray);

        // GET-subtract-POST: remove each requested pipeline ID. IDs that
        // weren't in the current set surface as "not_currently_connected"
        // existing matches — informational, not an error.
        const existingMatches = [];
        for (const id of args.pipelineIds) {
            if (!currentSet.has(id)) {
                existingMatches.push({ id, similarity_reason: "not_currently_connected" });
            } else {
                currentSet.delete(id);
            }
        }
        const reduced = [...currentSet].sort();

        return {
            method: "POST",
            path: "/api/system/pipelines/connections/to_stream",
            body: { stream_id: args.streamId, pipeline_ids: reduced },
            existingMatches,
            postApplyEstimate: { stream_id: args.streamId, pipeline_ids: reduced },
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        `Disconnect ${args.pipelineIds.length} pipeline(s) from stream ${args.streamId}`,
});
