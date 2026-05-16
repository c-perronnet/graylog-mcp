// Index-sets service — thin HTTP wrappers around
// /api/system/indices/index_sets (D-09 / RESEARCH Pattern 4).
//
// THIN by contract: callers (Plan 02 handlers + Plan 05 blueprints) own zod
// validation. The service snake-cases the camelCase API surface to Graylog's
// snake_case wire form (rotation_strategy_class, retention_strategy, etc.) so
// blueprints can compose at the camelCase JS-idiomatic layer.

/**
 * POST /api/system/indices/index_sets — create an index set.
 *
 * Snake-cases the camelCase input args to the Graylog wire form. Required
 * args: title, indexPrefix, rotationStrategyClass, rotationStrategy,
 * retentionStrategyClass, retentionStrategy. All others optional with
 * Graylog defaults (caller may pass per-deployment overrides).
 *
 * @param {{ request: Function }} client
 * @param {object} args
 * @param {string} args.title
 * @param {string} [args.description]                          default ""
 * @param {string} args.indexPrefix
 * @param {string} [args.indexAnalyzer]                        default "standard"
 * @param {number} [args.shards]                               default 1
 * @param {number} [args.replicas]                             default 0
 * @param {string} args.rotationStrategyClass
 * @param {object} args.rotationStrategy
 * @param {string} args.retentionStrategyClass
 * @param {object} args.retentionStrategy
 * @param {string} [args.creationDate]                         ISO-8601; default now()
 * @param {number} [args.indexOptimizationMaxNumSegments]      default 1
 * @param {boolean} [args.indexOptimizationDisabled]           default false
 * @param {string} [args.fieldTypeRefreshInterval]             default "PT5S"
 * @param {boolean} [args.writable]                            default true
 * @returns {Promise<unknown>}
 */
export function createIndexSet(client, args) {
    return client.request("POST", "/api/system/indices/index_sets", {
        title: args.title,
        description: args.description ?? "",
        index_prefix: args.indexPrefix,
        index_analyzer: args.indexAnalyzer ?? "standard",
        shards: args.shards ?? 1,
        replicas: args.replicas ?? 0,
        rotation_strategy_class: args.rotationStrategyClass,
        rotation_strategy: args.rotationStrategy,
        retention_strategy_class: args.retentionStrategyClass,
        retention_strategy: args.retentionStrategy,
        creation_date: args.creationDate ?? new Date().toISOString(),
        index_optimization_max_num_segments: args.indexOptimizationMaxNumSegments ?? 1,
        index_optimization_disabled: args.indexOptimizationDisabled ?? false,
        field_type_refresh_interval: args.fieldTypeRefreshInterval ?? "PT5S",
        writable: args.writable ?? true,
    });
}
