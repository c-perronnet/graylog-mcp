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
