// PIPE-13 — connect_pipelines_to_stream. ATTACH semantics.
//
// POST /api/system/pipelines/connections/to_stream is REPLACE-the-full-set
// (PipelineConnectionsResource.java:81-100 — connectionsService.save(connection)
// is full replacement, NOT merge). To implement "attach pipelines" at the
// agent boundary, the wrapper does GET-merge-POST client-side:
//   1. GET /api/system/pipelines/connections/{streamId} → current set
//      (404 → treat as empty set; the first POST creates the record)
//   2. merged = union(current.pipeline_ids, args.pipelineIds)
//   3. POST /api/system/pipelines/connections/to_stream with merged set
//
// Pitfall 2: forgetting the merge step silently disconnects previously-
// connected pipelines from the stream. The Pitfall 2 acceptance gate test
// (test/pipelines.test.js — "connect_pipelines_to_stream PITFALL 2 ACCEPTANCE
// GATE: current=[a,b], args=[new] → body=[a,b,new] (NOT [new])") proves the
// merge fires by verifying body.pipeline_ids contains BOTH the current and
// args.pipelineIds entries — a naive REPLACE-semantics handler would produce
// body.pipeline_ids === ["new"], silently dropping a and b.
//
// Idempotency: pipelines already in the current set surface in
// existingMatches with similarity_reason: "already_connected" — agent sees
// the no-op attaches without having to diff client-side. RESEARCH line 442.
//
// pipeline_ids are sorted alphabetically on the wire for deterministic
// snapshot fixtures (Graylog's wire type is Set<String> so order is not
// significant server-side; sorting is purely a snapshot-stability concern
// for Plan 04-06's fixtures).
//
// 404 handling: GET /api/system/pipelines/connections/{streamId} returns
// 404 until the first POST creates the connection record
// (PipelineConnectionsResource.java:160-178 calls connectionsService.load
// which throws NotFoundException, Graylog's standard 404 mapper).
// Assumption A7 (RESEARCH line 1384) verified — wrapper treats this as
// `current = { pipeline_ids: [] }` and proceeds.

import { defineMutatingHandler } from "../_shared/handler.js";
import { ConnectPipelinesToStreamSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";

export const handleConnectPipelinesToStream = defineMutatingHandler({
    name: "connect_pipelines_to_stream",
    schema: ConnectPipelinesToStreamSchema,
    async build(args) {
        const client = makeClient(args._conn);
        const getPath = `/api/system/pipelines/connections/${args.streamId}`;

        // Pre-flight GET — fetch current pipeline_ids set. 404 = no record
        // yet (first POST will create it). Any other error propagates via
        // the handler's outer try/catch → wrapGraylogError → MCP envelope;
        // apply() NEVER runs.
        let current;
        try {
            current = await client.request("GET", getPath, null);
        } catch (err) {
            if (err?.isGraylogError && err.status === 404) {
                current = { stream_id: args.streamId, pipeline_ids: [] };
            } else {
                throw err;   // 5xx / 403 / etc.
            }
        }

        // Defensive: Graylog may return pipeline_ids as null (no record yet
        // edge case) or omit the field entirely. Both treated as empty set.
        const currentArray = Array.isArray(current?.pipeline_ids) ? current.pipeline_ids : [];
        const currentSet = new Set(currentArray);

        // Pitfall 2 ACCEPTANCE GATE — the load-bearing lines of this handler.
        // GET-merge-POST preserves previously-connected pipelines. Snapshot
        // the existing-overlap set BEFORE mutating currentSet so
        // existingMatches reflects the pre-merge state (otherwise every
        // arg.pipelineId would look like an existing match after add()).
        const existingMatches = [];
        for (const id of args.pipelineIds) {
            if (currentSet.has(id)) {
                existingMatches.push({ id, similarity_reason: "already_connected" });
            }
            currentSet.add(id);
        }
        const merged = [...currentSet].sort();

        return {
            method: "POST",
            path: "/api/system/pipelines/connections/to_stream",
            body: { stream_id: args.streamId, pipeline_ids: merged },
            existingMatches,
            postApplyEstimate: { stream_id: args.streamId, pipeline_ids: merged },
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        `Connect ${args.pipelineIds.length} pipeline(s) to stream ${args.streamId}`,
});
