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
 * Shape-drift defense (F-18): every bucket is type-checked at runtime before
 * iteration. Jackson's Set<String> serialization is what we expect today
 * (JSON array), but a future Graylog DTO change that emits a Set as an object
 * — or an array where we expect an object — must NOT silently feed garbage
 * (e.g., per-character iteration of a string, or Object.keys of a string
 * yielding numeric indices) into the C1 confirmation hash. A bucket whose
 * runtime shape doesn't match its documented contract is treated as empty,
 * which is the same behavior as a missing bucket — the apply-time hash will
 * then differ from any dry-run hash computed against the real shape, and the
 * world-changed-refusal gate trips loudly instead of deleting wrong indices.
 *
 * @param {object} [allIndices]
 * @returns {string[]} deduped index names (unsorted)
 */
export function collectIndexNames(allIndices) {
    const names = new Set();
    // closed.indices — documented Set<String>, expected as JSON array.
    const closed = allIndices?.closed?.indices;
    if (Array.isArray(closed)) {
        for (const name of closed) names.add(name);
    }
    // reopened.indices — documented Set<String>, expected as JSON array.
    const reopened = allIndices?.reopened?.indices;
    if (Array.isArray(reopened)) {
        for (const name of reopened) names.add(name);
    }
    // all.indices — documented Map<String, IndexInfo>, expected as JSON object
    // keyed by index name. Reject arrays and primitives so Object.keys can't
    // produce numeric-index keys ("0", "1", ...) from a misshapen payload.
    const all = allIndices?.all?.indices;
    if (typeof all === "object" && all !== null && !Array.isArray(all)) {
        for (const name of Object.keys(all)) names.add(name);
    }
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

// =====================================================================
// Phase 5 D-09 — computeNotificationCascadeHash (thin semantic wrapper)
// =====================================================================

/**
 * Compute the deterministic confirmation hash for delete_event_notification.
 *
 * Thin semantic wrapper around computeCascadeHash so call-sites read
 * naturally — computeNotificationCascadeHash({ notificationId, eventDefIds })
 * instead of the misleading-named computeCascadeHash({ streamId: notificationId,
 * eventDefIds: [...] }) parameter renaming.
 *
 * Canonical JSON output is BYTE-IDENTICAL to the underlying call
 * (forwards streamId=notificationId, eventDefIds=eventDefIds,
 * ruleIds=[], pipelineConnIds=[]). Phase 3 / Phase 4 hashes are not
 * shared with Phase 5 so the key-name reuse has no replay-attack
 * surface — the streamId slot here carries a notification id, never
 * a stream id or rule id.
 *
 * Threat-model T-05-01-07: byte-identity is pinned by
 * test/cascade-hash.test.js so a future regression in
 * computeCascadeHash breaks Phase 5 hashes too.
 *
 * @param {object} inputs
 * @param {string}   inputs.notificationId  target notification id (non-empty)
 * @param {string[]} inputs.eventDefIds     event-definition ids that reference the notification
 * @returns {string} 64-hex sha-256
 */
export function computeNotificationCascadeHash({ notificationId, eventDefIds }) {
    if (typeof notificationId !== "string" || notificationId.length === 0) {
        throw new Error("computeNotificationCascadeHash: notificationId is required");
    }
    if (!Array.isArray(eventDefIds)) {
        throw new Error("computeNotificationCascadeHash: eventDefIds must be string[]");
    }
    return computeCascadeHash({
        streamId: notificationId,
        ruleIds: [],
        pipelineConnIds: [],
        eventDefIds,
    });
}

// =====================================================================
// Phase 8 — computeShareGrantHash (entity-share confirmation token)
// =====================================================================
//
// KEY DEVIATION — this wrapper does NOT forward into computeCascadeHash.
//
// computeRuleCascadeHash (Phase 4) and computeNotificationCascadeHash
// (Phase 5) both forward into computeCascadeHash's keyed-bucket canonical
// shape ({ streamId, cascades: { rules, pipeline_connections,
// event_definitions } }). That shape exists to disambiguate ID-collision
// ACROSS cascade types on a single destructive delete.
//
// An entity-share grant set is a different beast: a flat list of
// {grantee, capability} pairs against one entity GRN. There are no
// cross-type buckets to disambiguate, and the keyed-bucket shape simply
// does not fit. So computeShareGrantHash builds its OWN canonical JSON and
// calls createHash("sha256") DIRECTLY (reusing the line-25 import) — it is
// a standalone canonical-form hash, NOT a thin forward.
//
// Rationale source: 08-RESEARCH §"Pattern 3" + Open Question Q1,
// ARCHITECTURE.md §"Token shape" — the keyed-bucket shape is
// stream-cascade-specific; a flat sorted [{grantee,capability}] list is
// cleaner as a dedicated wrapper.
//
// Canonical JSON shape (LOCKED — drift = drift-refusal false-fire in the
// Phase 10 share_entity TOCTOU gate):
//   { "entityGrn": "<grn>", "grants": [ {grantee,capability}, ...sorted by grantee ] }
// Byte-identity is pinned in test/cascade-hash.test.js so any change to
// this canonical form (key order, sort key, field selection) fails loudly.

/**
 * Compute the deterministic confirmation token for share_entity (Phase 10).
 *
 * Standalone canonical-form sha-256 hash over the merged grant set — does
 * NOT forward into computeCascadeHash (see the section banner above for the
 * deviation rationale). The grants array is normalized to {grantee,
 * capability} pairs (extra keys dropped) and sorted by grantee ascending so
 * a re-ordered-but-equivalent grant set produces the identical token —
 * preventing a false grants_changed_since_preview refusal in Phase 10.
 *
 * @param {object}   inputs
 * @param {string}   inputs.entityGrn  target entity GRN (non-empty string),
 *                                     e.g. "grn::::stream:000000000001"
 * @param {Array<{grantee:string,capability:string}>} inputs.grants  grant set
 * @returns {string} 64-char lowercase hex sha-256 digest
 * @throws  {Error}  when entityGrn is not a non-empty string
 * @throws  {Error}  when grants is not an array
 */
export function computeShareGrantHash({ entityGrn, grants }) {
    if (typeof entityGrn !== "string" || entityGrn.length === 0) {
        throw new Error("computeShareGrantHash: entityGrn is required");
    }
    if (!Array.isArray(grants)) {
        throw new Error(
            "computeShareGrantHash: grants must be an array of {grantee,capability}",
        );
    }
    // Normalize to exactly {grantee,capability} (drop any extra keys) and
    // sort by grantee so grant-array re-ordering yields the identical hash.
    const sorted = [...grants]
        .map((g) => ({ grantee: g.grantee, capability: g.capability }))
        .sort((a, b) => (a.grantee < b.grantee ? -1 : a.grantee > b.grantee ? 1 : 0));
    const canonical = JSON.stringify({ entityGrn, grants: sorted });
    return createHash("sha256").update(canonical).digest("hex");
}
