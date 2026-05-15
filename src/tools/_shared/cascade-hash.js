// Cascade-hash helpers — promoted from src/tools/index-sets/c1-hash.js
// (Phase 2 Plan 02-03) so the sha-256 confirmation pattern is reusable across
// destructive-cascade tools:
//
//   - Phase 2  delete_index_set       computeC1Hash         (4 inputs)
//   - Phase 3  delete_stream          computeCascadeHash    (keyed-buckets, D-02)
//   - Phase 4  delete_pipeline_rule   computeCascadeHash    (reuse — future)
//
// Two patterns ship side-by-side:
//
//   1. computeC1Hash + collectIndexNames (Phase 2 — unchanged shape; lifted
//      verbatim. The src/tools/index-sets/c1-hash.js file is now a thin
//      re-export from here so existing Phase 2 importers and tests don't churn).
//
//   2. computeCascadeHash (Phase 3 D-02 — keyed-buckets canonicalization). The
//      cascade-hash input is bucketed by cascade type so a rule ID that happens
//      to byte-collide with a pipeline-connection ID still produces distinct
//      hashes (a flat-sort canonical would collapse them — D-02 was tightened
//      during planning to lock the keyed shape).
//
// Both functions are pure (no I/O) and deterministic. The dry-run → apply
// binding is enforced by recomputing the hash on apply and comparing — no
// MCP-side memory or persistence is needed; this survives process restart.

import { createHash } from "node:crypto";

// =====================================================================
// Phase 2 — computeC1Hash + collectIndexNames (verbatim lift)
// =====================================================================

/**
 * Compute the deterministic confirmation hash for delete_index_set.
 *
 * @param {object} inputs
 * @param {string} inputs.indexSetId         target index-set id
 * @param {true}   inputs.deleteIndices      locked literal — MUST be `true`
 * @param {string[]} inputs.indexNames       Elasticsearch index names; sorted internally
 * @param {number} inputs.messageCount       documents across the index set
 * @returns {string} 64-hex sha-256
 * @throws  when deleteIndices !== true (replay protection per Phase 2 D-02)
 */
export function computeC1Hash({ indexSetId, deleteIndices, indexNames, messageCount }) {
    // Phase 2 D-02 locked literal: a hash issued for any deleteIndices value
    // other than the JS literal true can never validate against a true-mode
    // apply call. We refuse here so a caller cannot accidentally produce a
    // hash that the requireConfirm gate would happily accept.
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

// =====================================================================
// Phase 3 D-02 — computeCascadeHash (keyed-buckets canonicalization)
// =====================================================================

/**
 * Compute the deterministic confirmation hash for delete_stream.
 *
 * Canonical JSON shape (D-02 LOCKED — drift = world-changed-refusal false-fire):
 *
 *   {
 *     "streamId": "<id>",
 *     "cascades": {
 *       "rules": [...sortedRuleIds],
 *       "pipeline_connections": [...sortedPipelineConnIds],
 *       "event_definitions": [...sortedEventDefIds]
 *     }
 *   }
 *
 * Object-literal key order in the canonical JSON (matters for sha-256
 * stability): `streamId` first, then `cascades` with keys in textual order
 * `rules`, `pipeline_connections`, `event_definitions`. Each bucket sorts its
 * own IDs before hashing — the agent does not need to pre-sort.
 *
 * Why keyed-buckets: a flat sorted-array canonical would collapse a rule ID
 * that byte-collides with a pipeline-connection ID into a single sorted entry;
 * the wrapper would then accept an apply where the cascade type changed but
 * the IDs happen to match. Keyed-buckets disambiguates per-type so any type
 * drift between dry-run and apply changes the hash.
 *
 * @param {object} inputs
 * @param {string}   inputs.streamId          target stream id (required, non-empty)
 * @param {string[]} inputs.ruleIds           stream-rule ids on the stream
 * @param {string[]} inputs.pipelineConnIds   pipeline ids connected to the stream
 * @param {string[]} inputs.eventDefIds       event-definition ids referencing the stream
 * @returns {string} 64-hex sha-256
 */
export function computeCascadeHash({ streamId, ruleIds, pipelineConnIds, eventDefIds }) {
    if (typeof streamId !== "string" || streamId.length === 0) {
        throw new Error("computeCascadeHash: streamId is required");
    }
    if (
        !Array.isArray(ruleIds)
        || !Array.isArray(pipelineConnIds)
        || !Array.isArray(eventDefIds)
    ) {
        throw new Error(
            "computeCascadeHash: ruleIds, pipelineConnIds, eventDefIds must each be string[]",
        );
    }
    const canonical = JSON.stringify({
        streamId,
        cascades: {
            rules: [...ruleIds].sort(),
            pipeline_connections: [...pipelineConnIds].sort(),
            event_definitions: [...eventDefIds].sort(),
        },
    });
    return createHash("sha256").update(canonical).digest("hex");
}

// =====================================================================
// Phase 4 D-14 — computeRuleCascadeHash (thin semantic wrapper)
// =====================================================================

/**
 * Compute the deterministic confirmation hash for delete_pipeline_rule.
 *
 * Thin semantic wrapper around computeCascadeHash so call-sites read
 * naturally — `computeRuleCascadeHash({ ruleId, pipelineIds })` instead
 * of the misleading-named `computeCascadeHash({ streamId: ruleId,
 * pipelineConnIds: pipelineIds, ... })` parameter renaming.
 *
 * Canonical JSON output is BYTE-IDENTICAL to the underlying call
 * (forwards `streamId=ruleId`, `pipelineConnIds=pipelineIds`, `ruleIds=[]`,
 * `eventDefIds=[]`). Phase 3 hashes are not shared with Phase 4 so the
 * key-name reuse has no replay-attack surface — the streamId slot here
 * carries a pipeline-rule id, never a stream id.
 *
 * Threat-model T-04-01-06: byte-identity is pinned by
 * test/cascade-hash.test.js so a future regression in computeCascadeHash
 * breaks Phase 4 hashes too (single source of truth — no parallel
 * canonical-form drift).
 *
 * @param {object} inputs
 * @param {string}   inputs.ruleId       target pipeline-rule id (non-empty)
 * @param {string[]} inputs.pipelineIds  pipelines that reference the rule
 * @returns {string} 64-hex sha-256
 */
export function computeRuleCascadeHash({ ruleId, pipelineIds }) {
    if (typeof ruleId !== "string" || ruleId.length === 0) {
        throw new Error("computeRuleCascadeHash: ruleId is required");
    }
    if (!Array.isArray(pipelineIds)) {
        throw new Error("computeRuleCascadeHash: pipelineIds must be string[]");
    }
    return computeCascadeHash({
        streamId: ruleId,
        ruleIds: [],
        pipelineConnIds: pipelineIds,
        eventDefIds: [],
    });
}
