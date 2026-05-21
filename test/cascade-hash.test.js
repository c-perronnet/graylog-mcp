// Plan 03-01 Task 2 — cascade-hash helper promotion + keyed-buckets signature.
//
// The helpers in src/tools/index-sets/c1-hash.js (Phase 2) are promoted to
// src/tools/_shared/cascade-hash.js so the sha-256 confirmation pattern is
// reusable across destructive-cascade tools:
//   - Phase 2:  delete_index_set      (computeC1Hash, byte-identical)
//   - Phase 3:  delete_stream         (computeCascadeHash, keyed-buckets)
//   - Phase 4:  delete_pipeline_rule  (computeCascadeHash reuse — future)
//
// D-02 (Phase 3) locks the keyed-buckets canonical JSON shape:
//   { streamId, cascades: { rules: [...sorted], pipeline_connections: [...sorted],
//                           event_definitions: [...sorted] } }
//
// Keyed-buckets disambiguates ID-collision across cascade types — a rule ID
// that happens to byte-collide with a pipeline-connection ID produces a
// different hash. The original flat-sort proposal would have collapsed both
// into a single sorted-array and missed type drift.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    computeCascadeHash,
    computeC1Hash,
    collectIndexNames,
    computeRuleCascadeHash,
    computeNotificationCascadeHash,
    computeShareGrantHash,
    // Phase 11 Plan 11-01 — RED scaffold. The export is added by Plan 11-02;
    // this import fails with ERR_MODULE_NOT_FOUND at module-load until then,
    // which is the expected Wave 0 state (mirrors Plan 10-01's handler-import
    // tolerance in test/authz-share-entity.test.js).
    computeRoleCascadeHash,
} from "../src/tools/_shared/cascade-hash.js";

// Phase 2 back-compat: the original c1-hash.js path is preserved as a thin
// re-export so delete-index-set.js + test/index-sets.test.js continue to import
// from there without churn.
import {
    computeC1Hash as computeC1HashLegacy,
    collectIndexNames as collectIndexNamesLegacy,
} from "../src/tools/index-sets/c1-hash.js";

// =====================================================================
// Test 1 — sort-order independence within a bucket
// =====================================================================

test("computeCascadeHash is sort-order independent within ruleIds bucket", () => {
    const h1 = computeCascadeHash({
        streamId: "abc",
        ruleIds: ["r3", "r1", "r2"],
        pipelineConnIds: [],
        eventDefIds: [],
    });
    const h2 = computeCascadeHash({
        streamId: "abc",
        ruleIds: ["r1", "r2", "r3"],
        pipelineConnIds: [],
        eventDefIds: [],
    });
    assert.equal(h1, h2);
});

// =====================================================================
// Test 2 — keyed-buckets disambiguates type-collision
// =====================================================================

test("computeCascadeHash buckets disambiguate type-collisions (rules vs pipelines)", () => {
    // The same ID string "xyz" placed in different buckets MUST produce
    // different hashes. A flat-sorted canonical form would collapse them.
    const hAsRule = computeCascadeHash({
        streamId: "s1",
        ruleIds: ["xyz"],
        pipelineConnIds: [],
        eventDefIds: [],
    });
    const hAsPipeline = computeCascadeHash({
        streamId: "s1",
        ruleIds: [],
        pipelineConnIds: ["xyz"],
        eventDefIds: [],
    });
    assert.notEqual(hAsRule, hAsPipeline);
    // Also: same ID across all three buckets should each be distinct.
    const hAsEventDef = computeCascadeHash({
        streamId: "s1",
        ruleIds: [],
        pipelineConnIds: [],
        eventDefIds: ["xyz"],
    });
    assert.notEqual(hAsRule, hAsEventDef);
    assert.notEqual(hAsPipeline, hAsEventDef);
});

// =====================================================================
// Test 3 — frozen-fixture hash for a populated cascade
// =====================================================================

test("computeCascadeHash returns the pinned hash for the populated frozen fixture", () => {
    // Frozen literal pinned after first implementation; any drift = drift in
    // canonical JSON shape = world-changed-refusal false-fire. Recompute via
    //   node -e 'import("./src/tools/_shared/cascade-hash.js").then(m =>
    //     console.log(m.computeCascadeHash({
    //       streamId:"5f9d3b1c7e8a4d2b1c3e5f9d",
    //       ruleIds:["r-aa","r-bb"],
    //       pipelineConnIds:["p-cc"],
    //       eventDefIds:["e-dd","e-ee"]
    //     })))'
    const hash = computeCascadeHash({
        streamId: "5f9d3b1c7e8a4d2b1c3e5f9d",
        ruleIds: ["r-aa", "r-bb"],
        pipelineConnIds: ["p-cc"],
        eventDefIds: ["e-dd", "e-ee"],
    });
    assert.equal(
        hash,
        "888cfe478f5ef2d421d1cd4e9a00b7e439e07d5d0b03094891542bea8cbaf991",
    );
    // Regex sanity: 64-hex.
    assert.match(hash, /^[0-9a-f]{64}$/);
});

// =====================================================================
// Test 4 — frozen-fixture hash for empty cascade
// =====================================================================

test("computeCascadeHash returns the pinned hash for the empty cascade frozen fixture", () => {
    // Empty-cascade case is distinct from the populated case (Test 3) because
    // the canonical JSON includes empty arrays (NOT omitted keys). The pinned
    // literal is the sha-256 of the canonical JSON with all three buckets as
    // [] — drift here = drift in canonical-form generation for the "no
    // dependents" path (the most common shape on a fresh stream).
    const hash = computeCascadeHash({
        streamId: "5f9d3b1c7e8a4d2b1c3e5f9d",
        ruleIds: [],
        pipelineConnIds: [],
        eventDefIds: [],
    });
    assert.equal(
        hash,
        "541be7deb65006714cbde5270556b20d80e32e64197c4f5bd9493139f2cacbf6",
    );
    assert.match(hash, /^[0-9a-f]{64}$/);

    // Empty vs populated must differ.
    const populated = computeCascadeHash({
        streamId: "5f9d3b1c7e8a4d2b1c3e5f9d",
        ruleIds: ["r-aa", "r-bb"],
        pipelineConnIds: ["p-cc"],
        eventDefIds: ["e-dd", "e-ee"],
    });
    assert.notEqual(hash, populated);
});

// =====================================================================
// Test 5 — streamId is part of the hash input
// =====================================================================

test("computeCascadeHash differs when streamId differs even with identical cascade arrays", () => {
    const cascades = {
        ruleIds: ["r1"],
        pipelineConnIds: ["p1"],
        eventDefIds: ["e1"],
    };
    const h1 = computeCascadeHash({ streamId: "s1", ...cascades });
    const h2 = computeCascadeHash({ streamId: "s2", ...cascades });
    assert.notEqual(h1, h2);
});

// =====================================================================
// Test 6 — Phase 2 computeC1Hash back-compat via the legacy import path
// =====================================================================

test("computeC1Hash imported from src/tools/index-sets/c1-hash.js is the same function as _shared/cascade-hash.js", () => {
    // Same function object (re-export, not a separate copy) — strict equality.
    assert.equal(computeC1HashLegacy, computeC1Hash);
    // Behavioural sanity — the Phase 2 fixture computeC1Hash test in
    // test/index-sets.test.js continues to validate end-to-end via the legacy
    // path. Here we just confirm the same call path through the new shared
    // location produces the same digest.
    const inputs = {
        indexSetId: "iset-1",
        deleteIndices: true,
        indexNames: ["graylog_0", "graylog_1"],
        messageCount: 1234,
    };
    const fromShared = computeC1Hash(inputs);
    const fromLegacy = computeC1HashLegacy(inputs);
    assert.equal(fromShared, fromLegacy);
    assert.match(fromShared, /^[0-9a-f]{64}$/);
});

// =====================================================================
// Test 7 — collectIndexNames re-exported from the legacy path
// =====================================================================

test("collectIndexNames imported from src/tools/index-sets/c1-hash.js is the same function as _shared/cascade-hash.js", () => {
    assert.equal(collectIndexNamesLegacy, collectIndexNames);
    // Behavioural sanity: dedupe across the three Graylog AllIndices
    // sub-collections still works.
    const allIndices = {
        closed: { indices: ["graylog_0"] },
        reopened: { indices: ["graylog_0", "graylog_1"] }, // overlap by design
        all: { indices: { graylog_0: {}, graylog_2: {} } },
    };
    const names = collectIndexNames(allIndices).sort();
    assert.deepEqual(names, ["graylog_0", "graylog_1", "graylog_2"]);
});

// =====================================================================
// Test 8 — computeCascadeHash rejects malformed inputs
// =====================================================================

test("computeCascadeHash throws on missing or malformed required keys", () => {
    // Missing streamId
    assert.throws(
        () => computeCascadeHash({ ruleIds: [], pipelineConnIds: [], eventDefIds: [] }),
        /streamId/,
    );
    // Empty streamId
    assert.throws(
        () => computeCascadeHash({ streamId: "", ruleIds: [], pipelineConnIds: [], eventDefIds: [] }),
        /streamId/,
    );
    // ruleIds not an array
    assert.throws(
        () => computeCascadeHash({ streamId: "s1", ruleIds: "r1", pipelineConnIds: [], eventDefIds: [] }),
        /ruleIds|pipelineConnIds|eventDefIds/,
    );
    // pipelineConnIds missing
    assert.throws(
        () => computeCascadeHash({ streamId: "s1", ruleIds: [], eventDefIds: [] }),
        /ruleIds|pipelineConnIds|eventDefIds/,
    );
    // eventDefIds missing
    assert.throws(
        () => computeCascadeHash({ streamId: "s1", ruleIds: [], pipelineConnIds: [] }),
        /ruleIds|pipelineConnIds|eventDefIds/,
    );
});

// =====================================================================
// Phase 4 D-14 — computeRuleCascadeHash (thin semantic wrapper)
// =====================================================================
//
// Plan 04-01 Task 1 adds a semantic wrapper around computeCascadeHash so
// delete_pipeline_rule's call-site reads naturally:
//
//   computeRuleCascadeHash({ ruleId, pipelineIds })
//
// instead of mis-titled
//
//   computeCascadeHash({ streamId: ruleId, pipelineConnIds: pipelineIds, ... })
//
// The wrapper forwards into the underlying helper unchanged, so the output
// is BYTE-IDENTICAL to the equivalent computeCascadeHash call. Tests below
// pin that forwarding contract so a future refactor cannot drift the hash.

test("computeRuleCascadeHash returns a 64-hex string", () => {
    const h = computeRuleCascadeHash({ ruleId: "r1", pipelineIds: ["p1", "p2"] });
    assert.match(h, /^[0-9a-f]{64}$/);
});

test("computeRuleCascadeHash is BYTE-IDENTICAL to the equivalent computeCascadeHash call (forwarding semantics)", () => {
    const a = computeRuleCascadeHash({ ruleId: "r1", pipelineIds: ["p1", "p2"] });
    const b = computeCascadeHash({
        streamId: "r1",
        ruleIds: [],
        pipelineConnIds: ["p1", "p2"],
        eventDefIds: [],
    });
    assert.equal(a, b);
});

test("computeRuleCascadeHash sorts pipelineIds canonically (sort-order independent)", () => {
    const h1 = computeRuleCascadeHash({ ruleId: "r1", pipelineIds: ["p2", "p1"] });
    const h2 = computeRuleCascadeHash({ ruleId: "r1", pipelineIds: ["p1", "p2"] });
    assert.equal(h1, h2);
});

test("computeRuleCascadeHash differs when ruleId differs", () => {
    const h1 = computeRuleCascadeHash({ ruleId: "r1", pipelineIds: ["p1"] });
    const h2 = computeRuleCascadeHash({ ruleId: "r2", pipelineIds: ["p1"] });
    assert.notEqual(h1, h2);
});

test("computeRuleCascadeHash with empty pipelineIds produces a deterministic distinct hash", () => {
    const empty = computeRuleCascadeHash({ ruleId: "r1", pipelineIds: [] });
    const populated = computeRuleCascadeHash({ ruleId: "r1", pipelineIds: ["p1"] });
    assert.match(empty, /^[0-9a-f]{64}$/);
    assert.notEqual(empty, populated);
    // Determinism: same inputs → same hash.
    const again = computeRuleCascadeHash({ ruleId: "r1", pipelineIds: [] });
    assert.equal(empty, again);
});

test("computeRuleCascadeHash rejects malformed inputs", () => {
    // Missing ruleId
    assert.throws(
        () => computeRuleCascadeHash({ pipelineIds: ["p1"] }),
        /ruleId/,
    );
    // Empty ruleId
    assert.throws(
        () => computeRuleCascadeHash({ ruleId: "", pipelineIds: ["p1"] }),
        /ruleId/,
    );
    // pipelineIds not an array
    assert.throws(
        () => computeRuleCascadeHash({ ruleId: "r1", pipelineIds: "p1" }),
        /pipelineIds/,
    );
});

// =====================================================================
// Phase 5 D-09 — computeNotificationCascadeHash (thin semantic wrapper)
// =====================================================================
//
// Plan 05-01 Task 1 adds a semantic wrapper around computeCascadeHash so
// delete_event_notification's call-site reads naturally:
//
//   computeNotificationCascadeHash({ notificationId, eventDefIds })
//
// instead of mis-titled
//
//   computeCascadeHash({ streamId: notificationId, eventDefIds: [...] })
//
// The wrapper forwards into the underlying helper unchanged, so the output
// is BYTE-IDENTICAL to the equivalent computeCascadeHash call. The frozen
// 64-hex literals below pin the canonical-form output — any future drift
// in computeCascadeHash canonicalization that breaks Phase 5 hashes will
// break these tests loudly (T-05-01-07 threat-model anchor).

test("computeNotificationCascadeHash returns a 64-hex string", () => {
    const h = computeNotificationCascadeHash({
        notificationId: "66e8aaaaaaaaaaaaaaaaaaaa",
        eventDefIds: ["66e8bbbbbbbbbbbbbbbbbbbb"],
    });
    assert.match(h, /^[0-9a-f]{64}$/);
});

test("computeNotificationCascadeHash is BYTE-IDENTICAL to the equivalent computeCascadeHash call (forwarding semantics)", () => {
    const a = computeNotificationCascadeHash({
        notificationId: "66e8aaaaaaaaaaaaaaaaaaaa",
        eventDefIds: ["66e8bbbbbbbbbbbbbbbbbbbb", "66e8cccccccccccccccccccc"],
    });
    const b = computeCascadeHash({
        streamId: "66e8aaaaaaaaaaaaaaaaaaaa",
        ruleIds: [],
        pipelineConnIds: [],
        eventDefIds: ["66e8bbbbbbbbbbbbbbbbbbbb", "66e8cccccccccccccccccccc"],
    });
    assert.equal(a, b);
});

test("computeNotificationCascadeHash returns the pinned hash for the empty-cascade frozen fixture (Plan 05-04 anchor)", () => {
    // Frozen literal pinned after first implementation; Plan 05-04's
    // delete_event_notification snapshot fixture reuses this anchor.
    // Recompute via:
    //   node -e 'import("./src/tools/_shared/cascade-hash.js").then(m =>
    //     console.log(m.computeNotificationCascadeHash({
    //       notificationId:"66e8aaaaaaaaaaaaaaaaaaaa",
    //       eventDefIds:[]
    //     })))'
    const hash = computeNotificationCascadeHash({
        notificationId: "66e8aaaaaaaaaaaaaaaaaaaa",
        eventDefIds: [],
    });
    assert.equal(
        hash,
        "e2ba7147288dc6e9dbc0086881b87975c60b3925d8835bba2ffaf5db439f269c",
    );
    assert.match(hash, /^[0-9a-f]{64}$/);
});

test("computeNotificationCascadeHash returns the pinned hash for the 2-cascade frozen fixture (Plan 05-04 anchor)", () => {
    const hash = computeNotificationCascadeHash({
        notificationId: "66e8aaaaaaaaaaaaaaaaaaaa",
        eventDefIds: ["66e8bbbbbbbbbbbbbbbbbbbb", "66e8cccccccccccccccccccc"],
    });
    assert.equal(
        hash,
        "d986f30b3afe6d6ab54b8fdb667716837dbfcac395720390639d7198287b02dd",
    );
    assert.match(hash, /^[0-9a-f]{64}$/);
    // Empty vs populated must differ.
    const empty = computeNotificationCascadeHash({
        notificationId: "66e8aaaaaaaaaaaaaaaaaaaa",
        eventDefIds: [],
    });
    assert.notEqual(hash, empty);
});

test("computeNotificationCascadeHash sorts eventDefIds canonically (sort-order independent)", () => {
    // Reverse-sorted input MUST hash identically to sorted input — proves
    // the sort happens inside computeCascadeHash, not at the call site.
    const h1 = computeNotificationCascadeHash({
        notificationId: "66e8aaaaaaaaaaaaaaaaaaaa",
        eventDefIds: ["66e8cccccccccccccccccccc", "66e8bbbbbbbbbbbbbbbbbbbb"],
    });
    const h2 = computeNotificationCascadeHash({
        notificationId: "66e8aaaaaaaaaaaaaaaaaaaa",
        eventDefIds: ["66e8bbbbbbbbbbbbbbbbbbbb", "66e8cccccccccccccccccccc"],
    });
    assert.equal(h1, h2);
});

test("computeNotificationCascadeHash differs when notificationId differs", () => {
    const h1 = computeNotificationCascadeHash({
        notificationId: "66e8aaaaaaaaaaaaaaaaaaaa",
        eventDefIds: ["66e8bbbbbbbbbbbbbbbbbbbb"],
    });
    const h2 = computeNotificationCascadeHash({
        notificationId: "66e8aaaaaaaaaaaaaaaaaaab",
        eventDefIds: ["66e8bbbbbbbbbbbbbbbbbbbb"],
    });
    assert.notEqual(h1, h2);
});

test("computeNotificationCascadeHash rejects malformed inputs", () => {
    // Missing notificationId
    assert.throws(
        () => computeNotificationCascadeHash({ eventDefIds: [] }),
        /notificationId/,
    );
    // Empty notificationId
    assert.throws(
        () => computeNotificationCascadeHash({ notificationId: "", eventDefIds: [] }),
        /notificationId/,
    );
    // eventDefIds not an array
    assert.throws(
        () => computeNotificationCascadeHash({
            notificationId: "66e8aaaaaaaaaaaaaaaaaaaa",
            eventDefIds: "not-an-array",
        }),
        /eventDefIds/,
    );
});

// =====================================================================
// Phase 8 — computeShareGrantHash (entity-share confirmation token)
// =====================================================================
//
// Plan 08-02 Task 1 adds a STANDALONE canonical-form sha-256 hash for the
// Phase 10 share_entity confirmation token. UNLIKE computeRuleCascadeHash /
// computeNotificationCascadeHash, computeShareGrantHash does NOT forward
// into computeCascadeHash — it builds its own canonical JSON over the flat
// grant set { entityGrn, grants: [...sorted by grantee] }.
//
// The frozen 64-hex literal below pins that canonical form: any drift in
// key order, sort key, or field selection breaks the byte-identity test
// loudly, so Phase 10's drift-refusal token cannot be silently weakened
// (threat T-08-04). The order-independence test pins T-08-05.

// =====================================================================
// computeShareGrantHash — frozen-fixture byte-identity
// =====================================================================

test("computeShareGrantHash returns the pinned hash for the frozen fixture", () => {
    // Frozen literal pinned after Task 1 landed; drift = canonical-form
    // drift = drift-refusal false-fire in Phase 10's share_entity.
    // Recompute via:
    //   node -e 'import("./src/tools/_shared/cascade-hash.js").then(m =>
    //     console.log(m.computeShareGrantHash({
    //       entityGrn:"grn::::stream:000000000001",
    //       grants:[{grantee:"grn::::user:b",capability:"view"},
    //               {grantee:"grn::::user:a",capability:"own"}]
    //     })))'
    const hash = computeShareGrantHash({
        entityGrn: "grn::::stream:000000000001",
        grants: [
            { grantee: "grn::::user:b", capability: "view" },
            { grantee: "grn::::user:a", capability: "own" },
        ],
    });
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(
        hash,
        "3a410b0a3f88d967b1586a6193248baa6652a2ab5beef16f6b785e125872ca41",
    );
});

// =====================================================================
// computeShareGrantHash — grant-order independence
// =====================================================================

test("computeShareGrantHash is grant-order independent", () => {
    // Re-ordering the grants array MUST hash identically — proves the
    // sort-by-grantee happens inside the helper, not at the call site.
    const a = computeShareGrantHash({
        entityGrn: "grn::::stream:s1",
        grants: [
            { grantee: "g2", capability: "view" },
            { grantee: "g1", capability: "own" },
        ],
    });
    const b = computeShareGrantHash({
        entityGrn: "grn::::stream:s1",
        grants: [
            { grantee: "g1", capability: "own" },
            { grantee: "g2", capability: "view" },
        ],
    });
    assert.equal(a, b);
});

// =====================================================================
// computeShareGrantHash — entityGrn participates in the hash
// =====================================================================

test("computeShareGrantHash differs when entityGrn differs (identical grants)", () => {
    const grants = [
        { grantee: "grn::::user:a", capability: "view" },
    ];
    const h1 = computeShareGrantHash({ entityGrn: "grn::::stream:s1", grants });
    const h2 = computeShareGrantHash({ entityGrn: "grn::::stream:s2", grants });
    assert.notEqual(h1, h2);
});

// =====================================================================
// computeShareGrantHash — malformed-input rejection
// =====================================================================

test("computeShareGrantHash rejects malformed inputs", () => {
    // Missing / empty entityGrn
    assert.throws(
        () => computeShareGrantHash({ entityGrn: "", grants: [] }),
        /entityGrn/,
    );
    assert.throws(
        () => computeShareGrantHash({ grants: [] }),
        /entityGrn/,
    );
    // grants not an array
    assert.throws(
        () => computeShareGrantHash({ entityGrn: "grn::::stream:s1", grants: "nope" }),
        /grants/,
    );
});

// =====================================================================
// Phase 11 Plan 11-01 — computeRoleCascadeHash byte-identity pins
// =====================================================================
//
// Plan 11-02 ships the function (forwarding or standalone — see
// 11-PATTERNS.md §"Factory Contracts" §"computeCascadeHash" for the
// decision point). The byte-pin tests below PIN the canonical output
// shape so Plan 11-02's implementation choice produces deterministic
// digests across the four mutator families.
//
// The frozen-fixture hashes start as PLACEHOLDERs (all-zeros with a
// distinct trailing nibble per test). Plan 11-02 replaces them with the
// real computed values after shipping the function — same RED → fix-pin
// → GREEN cycle computeNotificationCascadeHash and computeShareGrantHash
// used. To derive a real hash one-time (after Plan 11-02 ships the
// function):
//   node --input-type=module -e "import {computeRoleCascadeHash} from \
//     './src/tools/_shared/cascade-hash.js'; \
//     console.log(computeRoleCascadeHash({tool:'create_role',name:'myCustomRole', \
//       permissions:['dashboards:read','streams:read'],description:'my desc'}))"
//
// CRITICAL: `tool` is the bucket discriminator — cross-tool replay
// protection (D-13). A create_role X token cannot validate an
// update_role X apply because the canonical input differs. Test 5e
// pins this invariant across all four mutator families pairwise.

test("computeRoleCascadeHash returns the pinned hash for the create_role frozen fixture", () => {
    const h = computeRoleCascadeHash({
        tool: "create_role",
        name: "myCustomRole",
        permissions: ["dashboards:read", "streams:read"],
        description: "my desc",
    });
    // PLACEHOLDER — Plan 11-02 replaces with the real digest after
    // implementing computeRoleCascadeHash.
    assert.equal(
        h,
        "0000000000000000000000000000000000000000000000000000000000000000",
    );
});

test("computeRoleCascadeHash returns the pinned hash for the update_role frozen fixture (includes current_permissions_hash)", () => {
    const h = computeRoleCascadeHash({
        tool: "update_role",
        name: "myCustomRole",
        permissions: ["streams:read"],
        description: "x",
        current_permissions_hash: "abcd1234",
    });
    // PLACEHOLDER — Plan 11-02 replaces with the real digest.
    assert.equal(
        h,
        "0000000000000000000000000000000000000000000000000000000000000001",
    );
});

test("computeRoleCascadeHash returns the pinned hash for the delete_role frozen fixture (includes members_hash)", () => {
    const h = computeRoleCascadeHash({
        tool: "delete_role",
        name: "myCustomRole",
        members_hash: "feed5678",
    });
    // PLACEHOLDER — Plan 11-02 replaces with the real digest.
    assert.equal(
        h,
        "0000000000000000000000000000000000000000000000000000000000000002",
    );
});

test("computeRoleCascadeHash returns the pinned hash for the assign_role frozen fixture (includes current_roles_hash; cross-replay-safe across roleName + username)", () => {
    const h = computeRoleCascadeHash({
        tool: "assign_role",
        roleName: "Reader",
        username: "alice",
        current_roles_hash: "hash1",
    });
    // PLACEHOLDER — Plan 11-02 replaces with the real digest.
    assert.equal(
        h,
        "0000000000000000000000000000000000000000000000000000000000000003",
    );
});

test("computeRoleCascadeHash distinguishes tools (create_role X token ≠ update_role X token; assign_role token ≠ unassign_role token — D-13 cross-tool replay protection)", () => {
    const create = computeRoleCascadeHash({
        tool: "create_role",
        name: "X",
        permissions: [],
        description: "",
    });
    const update = computeRoleCascadeHash({
        tool: "update_role",
        name: "X",
        permissions: [],
        description: "",
        current_permissions_hash: "none",
    });
    const assign = computeRoleCascadeHash({
        tool: "assign_role",
        roleName: "X",
        username: "u",
        current_roles_hash: "none",
    });
    const unassign = computeRoleCascadeHash({
        tool: "unassign_role",
        roleName: "X",
        username: "u",
        current_roles_hash: "none",
    });
    assert.notEqual(create, update, "create_role token must not validate update_role apply");
    assert.notEqual(assign, unassign, "assign_role token must not validate unassign_role apply");
    assert.notEqual(create, assign, "create_role token must not validate assign_role apply");
});

test("computeRoleCascadeHash is permission-order-independent (sort canonically inside)", () => {
    const h1 = computeRoleCascadeHash({
        tool: "create_role",
        name: "X",
        permissions: ["a:b", "c:d"],
        description: "",
    });
    const h2 = computeRoleCascadeHash({
        tool: "create_role",
        name: "X",
        permissions: ["c:d", "a:b"],
        description: "",
    });
    assert.equal(h1, h2);
});

test("computeRoleCascadeHash rejects malformed inputs", () => {
    assert.throws(() => computeRoleCascadeHash(null), /tool/i);
    assert.throws(() => computeRoleCascadeHash({}), /tool/i);
    assert.throws(() => computeRoleCascadeHash({ tool: "" }), /tool/i);
});
