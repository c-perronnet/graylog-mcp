import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";
import { findExistingMatches } from "../src/tools/_shared/conflict.js";
import {
    _setCaptureRequest,
    _clearCaptureRequest,
    makeClient,
} from "../src/graylog/client.js";

// Plan 01-01 A2 amendment: replace the Phase 0 stub with a real implementation
// that fetches listPath, filters by matchFn, and projects { id, title,
// similarity_reason }. Back-compat preserved for empty-opts callers.

afterEach(() => _clearCaptureRequest());

const FAKE_CONN = { baseUrl: "_test", apiToken: "_test", writable: true };

// -------- Test 3 — listPath + matchFn fetches and filters --------

test("findExistingMatches with listPath + matchFn fetches and filters", async () => {
    const items = [
        { id: "A", title: "alpha", port: 12201 },
        { id: "B", title: "beta", port: 12202 },
        { id: "C", title: "gamma", port: 12203 },
    ];
    _setCaptureRequest(() => items);

    const client = makeClient(FAKE_CONN);
    const matches = await findExistingMatches(client, {
        listPath: "/api/test-list",
        matchFn: (it) => it.title === "beta",
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, "B");
    assert.equal(matches[0].title, "beta");
    assert.ok(typeof matches[0].similarity_reason === "string");
});

// -------- Test 4 — empty opts returns [] (back-compat) --------

test("findExistingMatches without listPath returns [] (back-compat)", async () => {
    const client = makeClient(FAKE_CONN);
    const matches = await findExistingMatches(client, {});
    assert.deepEqual(matches, []);
});

// -------- Test 5 — listPath without matchFn returns [] (back-compat) --------

test("findExistingMatches without matchFn returns [] (back-compat)", async () => {
    let fired = false;
    _setCaptureRequest(() => {
        fired = true;
        return [];
    });
    const client = makeClient(FAKE_CONN);
    const matches = await findExistingMatches(client, { listPath: "/api/x" });
    assert.deepEqual(matches, []);
    assert.equal(fired, false, "no GET should fire when matchFn is missing");
});

// -------- Test 6 — GET method and listPath honored exactly --------

test("findExistingMatches passes the GET method exactly + uses the provided listPath", async () => {
    let captured = null;
    _setCaptureRequest((args) => {
        captured = args;
        return [];
    });
    const client = makeClient(FAKE_CONN);
    await findExistingMatches(client, {
        listPath: "/api/system/inputs",
        matchFn: () => false,
    });
    assert.equal(captured.method, "GET");
    assert.equal(captured.path, "/api/system/inputs");
});

// -------- Bonus: envelope shapes are normalized --------

test("findExistingMatches accepts envelope { inputs: [...] } shape (Graylog list endpoints)", async () => {
    _setCaptureRequest(() => ({
        inputs: [
            { id: "in1", title: "matchme" },
            { id: "in2", title: "skipme" },
        ],
    }));
    const client = makeClient(FAKE_CONN);
    const matches = await findExistingMatches(client, {
        listPath: "/api/system/inputs",
        matchFn: (it) => it.title === "matchme",
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, "in1");
});

test("findExistingMatches similarityReason can be a function evaluated per-item", async () => {
    _setCaptureRequest(() => [
        { id: "X", title: "foo", type: "GELF" },
    ]);
    const client = makeClient(FAKE_CONN);
    const matches = await findExistingMatches(client, {
        listPath: "/api/x",
        matchFn: () => true,
        similarityReason: (it) => `title=${it.title}`,
    });
    assert.equal(matches[0].similarity_reason, "title=foo");
});

// =====================================================================
// Plan 02-01 Test 7 — index_sets envelope normalization
// =====================================================================
//
// /api/system/indices/index_sets returns { total, index_sets: [...], stats: {} }.
// create_index_set (Plan 02-02) consumes findExistingMatches to surface
// duplicate-title pre-checks; without the envelope unwrap, every match returns []
// regardless of source data. One additive line in conflict.js's envelope chain.

test("findExistingMatches normalizes index_sets envelope (Plan 02-01)", async () => {
    _setCaptureRequest(() => ({
        total: 2,
        index_sets: [
            { id: "a", title: "X" },
            { id: "b", title: "Y" },
        ],
    }));
    const client = makeClient(FAKE_CONN);
    const matches = await findExistingMatches(client, {
        listPath: "/api/system/indices/index_sets",
        matchFn: (it) => it.title === "X",
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, "a");
    assert.equal(matches[0].title, "X");
    assert.equal(matches[0].similarity_reason, "exact");
});

// =====================================================================
// Plan 02-01 Test 8 — back-compat with inputs envelope (regression guard)
// =====================================================================

test("findExistingMatches back-compat: inputs envelope still works (regression guard)", async () => {
    _setCaptureRequest(() => ({
        inputs: [{ id: "in1", title: "matchme" }, { id: "in2", title: "skip" }],
    }));
    const client = makeClient(FAKE_CONN);
    const matches = await findExistingMatches(client, {
        listPath: "/api/system/inputs",
        matchFn: (it) => it.title === "matchme",
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, "in1");
});
