// Events service — thin HTTP wrappers around /api/events (D-09 / RESEARCH
// Pattern 4).
//
// THIN by contract: callers (Plan 05 handlers + Plan 05 blueprints) own zod
// validation. Phase 5's D-03 M1 default (schedule=false on create unless the
// caller passes schedule:true) is carried forward here so blueprint chains
// can stage event definitions in the "defined but not scheduled" state and
// flip them on with `enableEventDefinition` as a separate step.

/**
 * POST /api/events/definitions?schedule={false|true} — create an event def.
 *
 * Phase 5 D-03 / M1: `?schedule=false` by default — event definitions land
 * UNSCHEDULED (no alert firing) until `enableEventDefinition` runs. Pass
 * `args.schedule === true` to schedule on create.
 *
 * Caller-supplied args.config is the variant config blob (correlation /
 * aggregation / log-clustering) — service is variant-agnostic.
 *
 * @param {{ request: Function }} client
 * @param {object} args
 * @param {string} args.title
 * @param {string} [args.description]
 * @param {number} [args.priority]                  1=LOW 2=NORMAL 3=HIGH
 * @param {boolean} [args.alert]                    default false
 * @param {object} args.config                      variant-discriminated
 * @param {string[]} [args.notifications]           notification IDs
 * @param {Array<object>} [args.fieldSpec]
 * @param {Array<object>} [args.keySpec]
 * @param {object} [args.notificationSettings]
 * @param {boolean} [args.schedule]                  default false (D-03 M1)
 * @returns {Promise<unknown>}
 */
export function createEventDefinition(client, args) {
    const scheduleQ = args.schedule === true ? "true" : "false";
    return client.request(
        "POST",
        `/api/events/definitions?schedule=${scheduleQ}`,
        {
            title: args.title,
            description: args.description ?? "",
            priority: args.priority ?? 2,
            alert: args.alert ?? false,
            config: args.config,
            notifications: args.notifications ?? [],
            field_spec: args.fieldSpec ?? [],
            key_spec: args.keySpec ?? [],
            notification_settings: args.notificationSettings ?? {
                grace_period_ms: 0,
                backlog_size: 0,
            },
        },
    );
}

/**
 * PUT /api/events/definitions/{definitionId}/schedule — flip an event def
 * from unscheduled to scheduled (the dispatch enables alert firing). Phase 5
 * WILDCARD-MediaType pattern — body intentionally `undefined` (no
 * Content-Length: 0 needed; Phase 5 05-U1-SMOKE defaulted to body_undefined).
 *
 * @param {{ request: Function }} client
 * @param {{ definitionId: string }} args
 * @returns {Promise<unknown>}
 */
export function enableEventDefinition(client, args) {
    return client.request(
        "PUT",
        `/api/events/definitions/${args.definitionId}/schedule`,
        undefined,
    );
}
