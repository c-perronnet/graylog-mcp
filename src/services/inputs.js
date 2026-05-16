// Inputs service — thin HTTP wrappers around /api/system/inputs (D-09 /
// RESEARCH Pattern 4).
//
// THIN by contract: callers (Plan 01 handlers + Plan 05 blueprints) own zod
// validation and per-type configuration shape.

/**
 * POST /api/system/inputs — create a Graylog input.
 *
 * @param {{ request: Function }} client
 * @param {object} args
 * @param {string} args.title
 * @param {string} args.type            e.g. "org.graylog2.inputs.gelf.tcp.GELFTCPInput"
 * @param {object} args.configuration   per-type config blob (caller-validated)
 * @param {boolean} [args.global]       default false
 * @param {string|null} [args.node]     null when global, otherwise node id
 * @returns {Promise<unknown>}
 */
export function createInput(client, args) {
    return client.request("POST", "/api/system/inputs", {
        title: args.title,
        type: args.type,
        configuration: args.configuration,
        global: args.global ?? false,
        node: args.node ?? null,
    });
}

/**
 * DELETE /api/system/inputs/{inputId}
 * @param {{ request: Function }} client
 * @param {{ inputId: string }} args
 * @returns {Promise<unknown>}
 */
export function deleteInput(client, args) {
    return client.request("DELETE", `/api/system/inputs/${args.inputId}`, null);
}
