// Encrypted-field inventory per notification type, sourced from the Java
// config classes' @JsonProperty + Graylog EncryptedValue annotations
// (RESEARCH.md §"Per-Type Field Counts and Encrypted-Field Inventory" line 734).
//
// Only http-notification-v2 has encrypted fields on Graylog 7.0.6 / 7.2:
//   - basic_auth  → EncryptedValue (HTTP Basic auth password)
//   - api_secret  → EncryptedValue (API secret for query/header injection)
//
// All other 5 variants (email-v1, http-v1, slack-v1, pagerduty-v2, teams-v2)
// have NO encrypted fields → ENCRYPTED_FIELDS_BY_TYPE returns an empty Set
// which makes the C3-mitigation code paths (redactForPreview /
// encodeEncryptedForWire from src/tools/inputs/redact.js) effective no-ops.
//
// Threat-model T-05-04-04: this inventory is the single source of truth.
// A future Graylog version adding encrypted fields to other variants requires
// updating ONLY this file; update_event_notification's STRICT_NO_ECHO logic
// is variant-agnostic.

export const ENCRYPTED_FIELDS_BY_TYPE = Object.freeze({
    "email-notification-v1": new Set(),
    "http-notification-v1": new Set(),
    "http-notification-v2": new Set(["basic_auth", "api_secret"]),
    "slack-notification-v1": new Set(),
    "pagerduty-notification-v2": new Set(),
    "teams-notification-v2": new Set(),
});

/**
 * Get the encrypted-field Set for a given notification type. Returns an
 * empty Set (not undefined) for unknown types so callers can do
 * `getEncryptedFieldsForType(t).has(fieldName)` without a null-guard.
 *
 * @param {string | undefined} notificationType
 * @returns {Set<string>}
 */
export function getEncryptedFieldsForType(notificationType) {
    return ENCRYPTED_FIELDS_BY_TYPE[notificationType] ?? new Set();
}
