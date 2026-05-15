// Strategy alias → FQCN translation (D-08, Plan 02-02 Task 1).
//
// Graylog 7.0.6's IndexSetCreationRequest / IndexSetUpdateRequest wire shape
// pairs `*_strategy_class: <FQCN>` at the top level with
// `*_strategy: { type: <ConfigFQCN>, ...config }` (Jackson polymorphism:
// `@JsonTypeInfo(use=CLASS, property="type")` on the RotationStrategyConfig
// + RetentionStrategyConfig interfaces — verified against
// source-code/.../plugin/indexer/rotation/RotationStrategyConfig.java and
// .../plugin/indexer/retention/RetentionStrategyConfig.java).
//
// D-08 contract: the agent passes a friendly alias (closed set, validated by
// the closed z.enum in schemas.js); this module translates the alias to the
// two FQCN strings Graylog needs on the wire. Adding a 4th rotation alias is
// a one-line entry in ROTATION_FQCN below + a one-line entry in
// ROTATION_CONFIG_BY_ALIAS in schemas.js. Adding a 3rd retention alias is
// symmetric.
//
// Security note (T-02-02-01 threat-model row): agents can NEVER inject an
// FQCN directly — the closed enum in schemas.js rejects unknown values before
// build() runs, and this module's translators throw on unknown aliases as a
// belt-and-suspenders defense in case a future caller calls
// buildRotationBlock / buildRetentionBlock outside of the wrapper.
//
// `archive` retention is intentionally absent from RETENTION_FQCN — the
// Graylog Enterprise ArchiveRetentionStrategy is not in the OSS source. The
// schema's RetentionAliasEnum includes "archive" so the wire-side translator
// (aliasToConfigOrError) can return a structured `archive_not_supported`
// error rather than the generic `unknown_strategy_alias` reason.

export const ROTATION_FQCN = {
    "time-based": {
        cls: "org.graylog2.indexer.rotation.strategies.TimeBasedRotationStrategy",
        configType: "org.graylog2.indexer.rotation.strategies.TimeBasedRotationStrategyConfig",
    },
    "size-based": {
        cls: "org.graylog2.indexer.rotation.strategies.SizeBasedRotationStrategy",
        configType: "org.graylog2.indexer.rotation.strategies.SizeBasedRotationStrategyConfig",
    },
    "message-count": {
        cls: "org.graylog2.indexer.rotation.strategies.MessageCountRotationStrategy",
        configType: "org.graylog2.indexer.rotation.strategies.MessageCountRotationStrategyConfig",
    },
};

export const RETENTION_FQCN = {
    "delete": {
        cls: "org.graylog2.indexer.retention.strategies.DeletionRetentionStrategy",
        configType: "org.graylog2.indexer.retention.strategies.DeletionRetentionStrategyConfig",
    },
    "close": {
        cls: "org.graylog2.indexer.retention.strategies.ClosingRetentionStrategy",
        configType: "org.graylog2.indexer.retention.strategies.ClosingRetentionStrategyConfig",
    },
    // archive: intentionally absent — handled by aliasToConfigOrError below.
};

/**
 * Translate a rotation alias + agent-supplied config into the Graylog wire
 * block. Throws on unknown alias (defense-in-depth — schema's closed enum
 * gates this in production).
 *
 * @param {"time-based"|"size-based"|"message-count"} alias
 * @param {object} agentConfig validated strategy_config (see ROTATION_CONFIG_BY_ALIAS)
 * @returns {{ rotation_strategy_class: string, rotation_strategy: object }}
 */
export function buildRotationBlock(alias, agentConfig) {
    const map = ROTATION_FQCN[alias];
    if (!map) throw new Error(`Unknown rotation strategy alias: ${alias}`);
    return {
        rotation_strategy_class: map.cls,
        rotation_strategy: { type: map.configType, ...agentConfig },
    };
}

/**
 * Translate a retention alias + agent-supplied config into the Graylog wire
 * block. Throws on unknown alias (defense-in-depth — schema's closed enum
 * gates this in production).
 *
 * @param {"delete"|"close"} alias
 * @param {object} agentConfig validated strategy_config (see RETENTION_CONFIG_BY_ALIAS)
 * @returns {{ retention_strategy_class: string, retention_strategy: object }}
 */
export function buildRetentionBlock(alias, agentConfig) {
    const map = RETENTION_FQCN[alias];
    if (!map) throw new Error(`Unknown retention strategy alias: ${alias}`);
    return {
        retention_strategy_class: map.cls,
        retention_strategy: { type: map.configType, ...agentConfig },
    };
}

/**
 * Safe wrapper used by build() handlers — returns either { ok: true, block }
 * on success OR { isError: true, reason, message } on a structurally-known
 * failure ("archive" retention, unknown alias). Lets handlers route the
 * failure through GraylogValidationError + wrapGraylogError for a uniform
 * MCP error envelope instead of catching a raw throw.
 *
 * @param {"rotation"|"retention"} kind
 * @param {string} alias
 * @param {object} agentConfig
 * @returns {
 *   { ok: true, block: object }
 *   | { isError: true, reason: "archive_not_supported"|"unknown_strategy_alias", message: string }
 * }
 */
export function aliasToConfigOrError(kind, alias, agentConfig) {
    if (kind === "retention" && alias === "archive") {
        return {
            isError: true,
            reason: "archive_not_supported",
            message:
                "retention_strategy 'archive' requires the Graylog Enterprise archive plugin "
                + "and is not supported by this milestone. Use 'delete' or 'close' instead.",
        };
    }
    try {
        const block = kind === "rotation"
            ? buildRotationBlock(alias, agentConfig)
            : buildRetentionBlock(alias, agentConfig);
        return { ok: true, block };
    } catch (err) {
        return {
            isError: true,
            reason: "unknown_strategy_alias",
            message: err?.message ?? `Unknown ${kind} strategy alias: ${alias}`,
        };
    }
}
