import { test } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";
import { toIdBody } from "../src/graylog/normalize.js";

// FOUND-08: toIdBody normalises ≥3 distinct Graylog create-response shapes
// to a uniform { id, body } envelope. Shape inventory in 00-RESEARCH.md
// §Pattern 5; full table in 00-03-PLAN.md <interfaces>.

test("normalize.toIdBody — Shape 1: POST /streams returns { stream_id } with hint", () => {
    const response = { stream_id: "S1" };
    const result = toIdBody(response, { idFields: ["stream_id"] });
    assert.deepEqual(result, { id: "S1", body: { stream_id: "S1" } });
});

test("normalize.toIdBody — Shape 2: POST /system/inputs returns { id } via default hint", () => {
    const response = { id: "I1", title: "input" };
    const result = toIdBody(response, undefined);
    assert.deepEqual(result, { id: "I1", body: { id: "I1", title: "input" } });
});

test("normalize.toIdBody — Shape 3: POST .../extractors returns { extractor_id } with hint", () => {
    const response = { extractor_id: "E1" };
    const result = toIdBody(response, { idFields: ["extractor_id"] });
    assert.deepEqual(result, { id: "E1", body: { extractor_id: "E1" } });
});

test("normalize.toIdBody — Shape 4: full DTO (POST /views) with id inside body", () => {
    const response = { id: "V1", title: "view", widgets: [{ type: "msg" }] };
    const result = toIdBody(response, { idFields: ["id"] });
    assert.deepEqual(result, {
        id: "V1",
        body: { id: "V1", title: "view", widgets: [{ type: "msg" }] },
    });
});

test("normalize.toIdBody — null response returns { id: null, body: null }", () => {
    const result = toIdBody(null, { idFields: ["id"] });
    assert.deepEqual(result, { id: null, body: null });
});

test("normalize.toIdBody — undefined response returns { id: null, body: null }", () => {
    const result = toIdBody(undefined, { idFields: ["id"] });
    assert.deepEqual(result, { id: null, body: null });
});

test("normalize.toIdBody — miss (no matching id field) returns id: null with full body", () => {
    const response = { foo: "bar" };
    const result = toIdBody(response, { idFields: ["id"] });
    assert.deepEqual(result, { id: null, body: { foo: "bar" } });
});

test("normalize.toIdBody — tries candidates in order; first match wins", () => {
    // Stream-rule create returns { streamrule_id } — `id` is absent.
    const response = { streamrule_id: "R1", stream_id: "S1" };
    const result = toIdBody(response, { idFields: ["streamrule_id", "id"] });
    assert.equal(result.id, "R1");
    assert.deepEqual(result.body, response);
});

// =====================================================================
// FOUND-07: Snapshot fixtures (Plan 00-06)
// =====================================================================

// FOUND-07 fixture 8: toIdBody across 3 Graylog create-response shape variants
test("snapshot: toIdBody across 3 Graylog create-response shapes", (t) => {
    const stream_response = toIdBody({ stream_id: "S1" }, { idFields: ["stream_id"] });
    const input_response = toIdBody({ id: "I1", title: "input1" }, undefined);
    const extractor_response = toIdBody({ extractor_id: "E1" }, { idFields: ["extractor_id"] });
    t.assert.snapshot({
        stream_response,
        input_response,
        extractor_response,
    });
});
