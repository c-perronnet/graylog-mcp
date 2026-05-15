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
 * pass through unchanged. Other types (numbers, booleans) for encrypted fields
 * are not expected and are left as-is; Graylog will reject them with a 400
 * which surfaces via wrapGraylogError.
 *
 * @param {Record<string, unknown> | undefined} configuration
 * @param {Set<string>} encryptedFields
 * @returns {Record<string, unknown> | undefined}
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
        }
        // Other types: leave as-is (Graylog will reject if invalid).
    }
    return out;
}
