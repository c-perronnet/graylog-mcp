// Per-connection input-type catalogue cache (D-06).
//
// One fetch per connection for the server process lifetime; cleared on
// process restart only. Three consumers:
//   1. list_input_types (INPUT-01) — surfaces the FQCN → InputTypeInfo map
//      to the agent so it knows what's available before create_input.
//   2. create_input validation (Plan 02) — checks the agent-supplied type
//      against the catalogue.
//   3. update_input is_encrypted detection (Plan 02 — C3 mitigation centerpiece)
//      — projects per-type encrypted-field names so partial-update never echoes
//      a placeholder back to Graylog.
//
// Cache shape: Map<connectionName, { fetchedAt, catalogue }>. Keyed by
// connectionName so connection A's catalogue can never be returned for
// connection B (threat-model T-01-01-03).
//
// Test seam: _clearTypeCatalogueForTests() resets the cache. Underscore
// prefix per project convention (cluster/index.js:27).

import { makeClient } from "../../graylog/client.js";

const _cache = new Map(); // Map<connectionName, { fetchedAt, catalogue }>

/**
 * @param {string} connectionName
 * @param {{ baseUrl: string, apiToken: string, writable?: boolean }} conn
 * @returns {Promise<Record<string, object>>} Map<FQCN, InputTypeInfo>
 */
export async function getCachedTypeCatalogue(connectionName, conn) {
    if (_cache.has(connectionName)) return _cache.get(connectionName).catalogue;
    const client = makeClient(conn);
    const catalogue = await client.request(
        "GET",
        "/api/system/inputs/types/all",
        null,
    );
    _cache.set(connectionName, { fetchedAt: Date.now(), catalogue });
    return catalogue;
}

/**
 * Test-only seam: reset the cache so tests can re-verify the fetch-once
 * contract under isolated conditions. NEVER call from production code.
 */
export function _clearTypeCatalogueForTests() {
    _cache.clear();
}

/**
 * Given a catalogue and an input type FQCN, return the set of field names
 * marked is_encrypted: true in the type's requested_configuration. Used by
 * Plan 02's update_input.build() to enforce C3 (encrypted-field zero-out
 * prevention) — fields in this Set are NEVER echoed in the emitted PUT body
 * unless the agent explicitly supplied a new non-placeholder value.
 *
 * @param {Record<string, object>} catalogue
 * @param {string} inputType  FQCN, e.g. "org.graylog2.inputs.gelf.tcp.GELFTCPInput"
 * @returns {Set<string>}
 */
export function getEncryptedFieldNamesForType(catalogue, inputType) {
    const typeInfo = catalogue?.[inputType];
    if (!typeInfo?.requested_configuration) return new Set();
    return new Set(
        Object.entries(typeInfo.requested_configuration)
            .filter(([, field]) => field?.is_encrypted === true)
            .map(([name]) => name),
    );
}
