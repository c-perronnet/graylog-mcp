// Encrypted-field redaction helpers (D-04 for create_input; D-03 for update_input).
//
// Two pure functions, both safe against undefined configurations:
//   - redactForPreview replaces encrypted values with REDACTION_PLACEHOLDER
//     for the dry-run output. Used by both create_input and update_input.
//   - encodeEncryptedForWire wraps an explicit new value in { set_value: <value> }
//     so Graylog's EncryptedInputConfigs.merge treats it as a fresh encryption
//     target (RESEARCH.md §"Encrypted-Field Merge"). Already-shaped Graylog
//     placeholders ({ keep_value }, { delete_value }, { set_value }) pass
//     through unchanged so the agent can pin Graylog-keep / Graylog-delete
//     semantics explicitly.
//
// Neither function mutates its input — both shallow-copy and return a new
// configuration object. Plan 02 hardens against C3: encrypted fields the agent
// did NOT pass are never on the wire because update_input.build() never copies
// from current state; this module's job is purely the value-shape transform
// for fields the agent DID pass.

export const REDACTION_PLACEHOLDER = "<redacted>";

/**
 * Replace encrypted-field values in a configuration object with the redaction
 * placeholder for dry-run preview emission. Pure: returns a new object.
 *
 * @param {Record<string, unknown> | undefined} configuration
 * @param {Set<string>} encryptedFields  Field names where is_encrypted === true
 *   per the live type catalogue.
 * @returns {Record<string, unknown> | undefined}
 */
export function redactForPreview(configuration, encryptedFields) {
    if (!configuration || typeof configuration !== "object") return configuration;
    const out = { ...configuration };
    for (const field of encryptedFields) {
        if (field in out) out[field] = REDACTION_PLACEHOLDER;
    }
    return out;
}

/**
 * Wrap explicit encrypted-field values in { set_value: <value> } for the wire
 * body. Plain strings → { set_value: string }. Already-shaped Graylog
 * placeholders ({ keep_value: true }, { delete_value: true }, { set_value: x })
 * pass through unchanged. Non-string non-placeholder values (numbers, booleans,
 * arrays, plain objects) for encrypted fields are rejected here with a thrown
 * Error: preview-apply parity is the D-04 invariant, and `redactForPreview`
 * unconditionally replaces ANY value at an encrypted-field key with the
 * redaction placeholder. If we silently let a non-string fall through to the
 * wire, the agent sees `<redacted>` in the dry-run preview but Graylog
 * receives the literal value — a preview/apply mismatch that leaks the
 * secret. Input types covered by a strict per-type zod schema also catch
 * this at validation, but generic `z.record(z.unknown())` types (AWS plugin,
 * CEF, Kafka, Office365, custom plugins) bypass that gate and rely on this
 * throw.
 *
 * @param {Record<string, unknown> | undefined} configuration
 * @param {Set<string>} encryptedFields
 * @returns {Record<string, unknown> | undefined}
 * @throws {Error} if an encrypted field carries a non-string non-placeholder value
 */
export function encodeEncryptedForWire(configuration, encryptedFields) {
    if (!configuration || typeof configuration !== "object") return configuration;
    const out = { ...configuration };
    for (const field of encryptedFields) {
        if (!(field in out)) continue;
        const v = out[field];
        if (v && typeof v === "object"
            && ("keep_value" in v || "delete_value" in v || "set_value" in v)) {
            // Pre-shaped placeholder — pass through.
            continue;
        }
        if (typeof v === "string") {
            out[field] = { set_value: v };
            continue;
        }
        // Refuse non-string non-placeholder values for encrypted fields.
        // Preview-apply parity is the D-04 invariant; when zod can't gate this
        // (generic z.record(z.unknown()) input types), reject here so the
        // agent gets a clear error rather than a silent leak.
        throw new Error(
            `Encrypted field "${field}" must be a string or a Graylog placeholder ({set_value}/{keep_value}/{delete_value}); got ${typeof v}.`
        );
    }
    return out;
}
