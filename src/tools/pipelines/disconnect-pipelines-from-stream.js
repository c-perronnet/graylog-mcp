// PIPE-14 — disconnect_pipelines_from_stream. DETACH semantics.
//
// Same wire endpoint as PIPE-13 (POST /api/system/pipelines/connections/to_stream
// — REPLACE-the-full-set server-side per PipelineConnectionsResource.java:81-100);
// the wrapper does GET-subtract-POST to preserve the remaining connections
// (Pitfall 2 mirror — detaching pipeline X should not silently disconnect Y
// and Z that were also attached to the stream).
//
// 404 on the GET means there's no connection record yet → currentSet is
// empty. The wrapper does NOT issue the POST in this case (WR-03 fix
// 2026-05-16): firing POST {pipeline_ids: []} would CREATE a connection row
// where none existed, producing a server-side state change for what was
// otherwise a no-op disconnect. Instead we surface `noop: true` in
// postApplyEstimate so the agent sees the operation was structurally
// performed without a wire write. The connect path (PIPE-13) does NOT have
// this concern because it always grows the set.
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
        let hadExistingRecord = true;
        try {
            current = await client.request("GET", getPath, null);
        } catch (err) {
            if (err?.isGraylogError && err.status === 404) {
                current = { stream_id: args.streamId, pipeline_ids: [] };
                hadExistingRecord = false;
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

        // WR-03 (verify-work 02..06): if NO existing connection record and
        // the reduction yielded an empty set, the POST would CREATE a row
        // where none existed — that's the silent server-side state change we
        // want to avoid. Mark as noop.
        const noop = !hadExistingRecord && reduced.length === 0;

        return {
            method: "POST",
            path: "/api/system/pipelines/connections/to_stream",
            body: { stream_id: args.streamId, pipeline_ids: reduced },
            existingMatches,
            postApplyEstimate: {
                stream_id: args.streamId,
                pipeline_ids: reduced,
                ...(noop ? { noop: true, reason: "no_existing_connection_record" } : {}),
            },
            _noop: noop,
        };
    },
    apply: (client, req) => {
        if (req._noop) {
            return { stream_id: req.body.stream_id, pipeline_ids: [], noop: true };
        }
        return client.request(req.method, req.path, req.body);
    },
    summarize: (args) =>
        `Disconnect ${args.pipelineIds.length} pipeline(s) from stream ${args.streamId}`,
});
