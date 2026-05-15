// C1 confirmation-token helpers for delete_index_set (Plan 02-03).
//
// The C1 mitigation centerpiece: when an agent calls delete_index_set with
// deleteIndices: true (the destruction path), the wrapper computes a
// deterministic sha-256 hash of the dry-run state and requires the agent
// to echo it back as args.confirm on apply. If anything changed server-side
// between dry-run and apply (new indices opened, messages ingested), the
// hash mismatches and apply refuses with reason: "confirmation_mismatch"
// (handler.js requireConfirm gate, Plan 02-01).
//
// Two pure helpers ship here:
//
//   1. computeC1Hash({ indexSetId, deleteIndices: true, indexNames, messageCount })
//      Returns the 64-hex sha-256 of canonicalized JSON. deleteIndices MUST
//      be the literal true (D-02 replay protection — a hash issued for any
//      other input value can never validate against a true-mode apply).
//      indexNames is sorted before hashing so the agent does not need to
//      pre-sort.
//
//   2. collectIndexNames(allIndices) — walks Graylog's AllIndices DTO shape
//      (closed.indices Set + reopened.indices Set + all.indices Map) into a
//      single deduped string array. Verified against the Graylog 7.0.6
//      source (AllIndices.java).
//
// Both functions are stateless and have no I/O. The hash is recomputed on
// every dry-run call, so no MCP-side memory is needed — the dry-run → apply
// binding is enforced purely by recomputation, surviving process restarts.

import { createHash } from "node:crypto";

/**
 * Compute the deterministic confirmation hash for delete_index_set.
 *
 * @param {object} inputs
 * @param {string} inputs.indexSetId         target index-set id
 * @param {true}   inputs.deleteIndices      locked literal — MUST be `true`
 * @param {string[]} inputs.indexNames       Elasticsearch index names; sorted internally
 * @param {number} inputs.messageCount       documents across the index set
 * @returns {string} 64-hex sha-256
 * @throws  when deleteIndices !== true (replay protection per D-02)
 */
export function computeC1Hash({ indexSetId, deleteIndices, indexNames, messageCount }) {
    // D-02 locked literal: a hash issued for any deleteIndices value other than
    // the JS literal true can never validate against a true-mode apply call. We
    // refuse here so a caller cannot accidentally produce a hash that the
    // requireConfirm gate would happily accept.
    if (deleteIndices !== true) {
        throw new Error(
            "computeC1Hash called with deleteIndices !== true — refusing (D-02 locked literal replay protection)",
        );
    }
    const canonical = JSON.stringify({
        indexSetId,
        deleteIndices: true,
        indexNames: [...indexNames].sort(),
        messageCount,
    });
    return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Collect every Elasticsearch index name from Graylog's AllIndices DTO.
 * Verified against source-code/.../AllIndices.java — three sub-collections:
 *
 *   - allIndices.closed.indices    Set<String> of index names
 *   - allIndices.reopened.indices  Set<String> of index names
 *   - allIndices.all.indices       Map<String, IndexInfo> keyed by name
 *
 * Sub-collections may overlap during rotation transitions; the Set return
 * type dedupes. Output is unsorted — computeC1Hash sorts before hashing.
 *
 * @param {object} [allIndices]
 * @returns {string[]} deduped index names (unsorted)
 */
export function collectIndexNames(allIndices) {
    const names = new Set();
    for (const name of allIndices?.closed?.indices ?? []) names.add(name);
    for (const name of allIndices?.reopened?.indices ?? []) names.add(name);
    for (const name of Object.keys(allIndices?.all?.indices ?? {})) names.add(name);
    return [...names];
}
