// Pipelines service — thin HTTP wrappers around the Graylog
// /api/system/pipelines surface (D-09 / RESEARCH Pattern 4).
//
// THIN by contract: callers (Plan 04 handlers + Plan 05 blueprints) own zod
// validation. Services pass pre-validated args directly to the wire.

/**
 * POST /api/system/pipelines/pipeline — create a pipeline definition.
 *
 * @param {{ request: Function }} client
 * @param {object} args
 * @param {string} args.title
 * @param {string} [args.description]   default ""
 * @param {string} args.source           pipeline DSL source
 * @returns {Promise<unknown>}
 */
export function createPipeline(client, args) {
    return client.request("POST", "/api/system/pipelines/pipeline", {
        title: args.title,
        description: args.description ?? "",
        source: args.source,
    });
}

/**
 * POST /api/system/pipelines/rule — create a pipeline rule (DSL source).
 *
 * @param {{ request: Function }} client
 * @param {object} args
 * @param {string} args.title
 * @param {string} [args.description]   default ""
 * @param {string} args.source           rule DSL source (emit via src/pipeline-dsl/emit.js)
 * @returns {Promise<unknown>}
 */
export function createRule(client, args) {
    return client.request("POST", "/api/system/pipelines/rule", {
        title: args.title,
        description: args.description ?? "",
        source: args.source,
    });
}

/**
 * POST /api/system/pipelines/connections/to_stream — connect pipelines TO a
 * stream. Wire body uses `stream_id` + `pipeline_ids` (snake_case at the
 * REST resource).
 *
 * Caller is responsible for sending the FINAL pipeline list (the endpoint
 * REPLACES the connection set; it does NOT merge). For incremental add /
 * remove semantics the caller must pre-fetch the current connections and
 * compute the desired final list. See Phase 4 connection-management handler
 * for the merge pattern.
 *
 * @param {{ request: Function }} client
 * @param {object} args
 * @param {string} args.streamId
 * @param {string[]} args.pipelineIds   final desired set (replaces existing)
 * @returns {Promise<unknown>}
 */
export function connectToStream(client, args) {
    return client.request("POST", "/api/system/pipelines/connections/to_stream", {
        stream_id: args.streamId,
        pipeline_ids: args.pipelineIds,
    });
}

/**
 * POST /api/system/pipelines/connections/to_stream with the merged-then-
 * subtracted pipeline list. Thin wrapper: the service just sends the final
 * list. The caller pre-fetches via the Phase 4 pattern (GET connections,
 * filter out the IDs to disconnect, POST the remainder).
 *
 * @param {{ request: Function }} client
 * @param {object} args
 * @param {string} args.streamId
 * @param {string[]} args.pipelineIds   final desired set after subtraction
 * @returns {Promise<unknown>}
 */
export function disconnectFromStream(client, args) {
    return client.request("POST", "/api/system/pipelines/connections/to_stream", {
        stream_id: args.streamId,
        pipeline_ids: args.pipelineIds,
    });
}
