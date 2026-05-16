// Stream service — thin HTTP wrappers around the Graylog /api/streams surface
// (D-09 / Phase 6 RESEARCH Pattern 4: Services-Layer Composition).
//
// THIN by contract: every function takes `(client, args)` where `client` is
// the object returned by `makeClient(conn)` in src/graylog/client.js. No MCP
// coupling — no defineMutatingHandler, no dryRun branching, no zod parsing.
// Callers (Plans 02-05 handlers + Plan 05 blueprints) own zod validation;
// services trust pre-validated args by contract (T-06-01-01 mitigation).
//
// Defense-in-depth: the underlying `client.request` refuses non-GET on
// connections where `conn.writable === false`; services inherit the gate
// transparently (T-06-01-06 mitigation).
//
// Anti-Patterns to Avoid (RESEARCH §"Anti-Patterns to Avoid"):
//   - Services do NOT translate numeric/string stream-rule types. The caller
//     pre-translates via `STREAM_RULE_TYPE_TO_NUMERIC` in
//     src/tools/streams/schemas.js. Services are intentionally THIN.
//   - Services do NOT wrap responses; caller normalizes via `toIdBody` if it
//     needs an id-projection.

/**
 * POST /api/streams — CreateEntityRequest envelope.
 * Wire-shape per Pitfall S7 / RESEARCH Pattern 4. Response is
 * { stream_id: "<uuid>" }; caller normalizes with toIdBody({idFields: ["stream_id","id"]}).
 *
 * @param {{ request: Function }} client
 * @param {object} args
 * @param {string} args.title                                required
 * @param {string} [args.description]                        nullable on wire
 * @param {string} args.indexSetId                           required
 * @param {"AND"|"OR"} [args.matchingType]                   default "AND"
 * @param {Array<object>} [args.rules]                       pre-translated wire-shape rules
 * @param {boolean} [args.removeMatchesFromDefaultStream]    default false
 * @returns {Promise<unknown>}
 */
export function createStream(client, args) {
    return client.request("POST", "/api/streams", {
        entity: {
            title: args.title,
            description: args.description ?? null,
            rules: args.rules ?? [],
            content_pack: null,
            matching_type: args.matchingType ?? "AND",
            remove_matches_from_default_stream:
                args.removeMatchesFromDefaultStream ?? false,
            index_set_id: args.indexSetId,
        },
        share_request: null,
    });
}

/**
 * POST /api/streams/{streamId}/rules — adds one rule to an existing stream.
 * Caller pre-translates `type` to the numeric Graylog wire form.
 *
 * @param {{ request: Function }} client
 * @param {object} args
 * @param {string} args.streamId
 * @param {number} args.type           numeric rule-type (see STREAM_RULE_TYPE_TO_NUMERIC)
 * @param {string} args.field
 * @param {string} args.value
 * @param {boolean} [args.inverted]    default false
 * @param {string|null} [args.description]
 * @returns {Promise<unknown>}
 */
export function addRule(client, args) {
    return client.request("POST", `/api/streams/${args.streamId}/rules`, {
        type: args.type,
        field: args.field,
        value: args.value,
        inverted: args.inverted ?? false,
        description: args.description ?? null,
    });
}

/**
 * DELETE /api/streams/{streamId}
 * @param {{ request: Function }} client
 * @param {{ streamId: string }} args
 * @returns {Promise<unknown>}
 */
export function deleteStream(client, args) {
    return client.request("DELETE", `/api/streams/${args.streamId}`, null);
}

/**
 * POST /api/streams/{streamId}/resume — start (un-pause) the stream.
 * @param {{ request: Function }} client
 * @param {{ streamId: string }} args
 * @returns {Promise<unknown>}
 */
export function startStream(client, args) {
    return client.request("POST", `/api/streams/${args.streamId}/resume`, null);
}

/**
 * POST /api/streams/{streamId}/pause — pause the stream.
 * @param {{ request: Function }} client
 * @param {{ streamId: string }} args
 * @returns {Promise<unknown>}
 */
export function pauseStream(client, args) {
    return client.request("POST", `/api/streams/${args.streamId}/pause`, null);
}
