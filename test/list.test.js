import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";
import { z } from "zod";
import { defineListHandler } from "../src/tools/_shared/list.js";
import { listBase } from "../src/tools/_shared/schemas.js";
import { GraylogError } from "../src/graylog/errors.js";
import {
    _clearConnectionsForTests,
    setActiveConnection,
} from "../src/config.js";

// FOUND-12 + Pitfall M6. defineListHandler enforces default fields
// [id, title, description], default limit = 25, MAX_LIMIT = 200, and
// fields: "all" opt-in for unprojected items.

const TestListSchema = listBase;

function fixtureList(items, overrides = {}) {
    return defineListHandler({
        name: "list_streams",
        schema: TestListSchema,
        fetch: overrides.fetch ?? (async (client, args) => items),
    });
}

const SAMPLE = [
    { id: "S1", title: "Stream 1", description: "first", extra: "a" },
    { id: "S2", title: "Stream 2", description: "second", extra: "b" },
];

afterEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
});

// -------- 1. Default limit --------

test("default limit = 25", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
        id: `S${i}`, title: `T${i}`, description: "",
    }));
    const handler = fixtureList(many);
    const res = await handler({
        params: { arguments: { _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.limit, 25);
});

// -------- 2. Clamp at MAX_LIMIT --------

test("limit > 200 clamps to MAX_LIMIT (200)", async () => {
    const handler = fixtureList(SAMPLE);
    const res = await handler({
        params: { arguments: { _testConnection: "fake", limit: 1000 } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.limit, 200);
});

// -------- 3. Default projection --------

test("default fields are [id, title, description] (extras dropped)", async () => {
    const handler = fixtureList(SAMPLE);
    const res = await handler({
        params: { arguments: { _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.items[0].id, "S1");
    assert.equal(payload.items[0].title, "Stream 1");
    assert.equal(payload.items[0].description, "first");
    assert.equal(payload.items[0].extra, undefined, "extra field projected away");
    assert.deepEqual(payload.fields, ["id", "title", "description"]);
});

// -------- 4. fields: "all" --------

test("fields: 'all' returns unprojected items", async () => {
    const handler = fixtureList(SAMPLE);
    const res = await handler({
        params: { arguments: { _testConnection: "fake", fields: "all" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.items[0].extra, "a");
    assert.equal(payload.fields, "all");
});

// -------- 5. Custom fields array --------

test("fields: ['id'] returns only id", async () => {
    const handler = fixtureList(SAMPLE);
    const res = await handler({
        params: { arguments: { _testConnection: "fake", fields: ["id"] } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(Object.keys(payload.items[0]), ["id"]);
    assert.equal(payload.items[0].id, "S1");
});

// -------- 6. Validation failure --------

test("limit: -1 → zod validation failure → isError", async () => {
    const handler = fixtureList(SAMPLE);
    const res = await handler({
        params: { arguments: { _testConnection: "fake", limit: -1 } },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /limit/);
});

// -------- 7. fetch throwing GraylogError → wrapped MCP error --------

test("fetch() throwing GraylogError → MCP error via wrapGraylogError", async () => {
    const handler = fixtureList(SAMPLE, {
        fetch: async () => {
            throw new GraylogError("upstream failure", {
                status: 503,
                method: "GET",
                path: "/api/streams",
                body: { message: "Service Unavailable" },
            });
        },
    });
    const res = await handler({
        params: { arguments: { _testConnection: "fake" } },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /list_streams/);
    assert.match(res.content[0].text, /upstream failure/);
});

// -------- 8. Response envelope shape --------

test("response envelope includes tool, connection, count, limit, fields, items", async () => {
    const handler = fixtureList(SAMPLE);
    const res = await handler({
        params: { arguments: { _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "list_streams");
    assert.equal(payload.connection, "fake");
    assert.equal(payload.count, 2);
    assert.equal(payload.limit, 25);
    assert.ok(Array.isArray(payload.items));
});

// =====================================================================
// FOUND-07: Snapshot fixtures (Plan 00-06)
// =====================================================================

// FOUND-07 fixture 5: defineListHandler — default projection
test("snapshot: defineListHandler default projection [id, title, description]", async (t) => {
    const handler = fixtureList([
        { id: "S1", title: "Stream 1", description: "first", extra: "a" },
        { id: "S2", title: "Stream 2", description: "second", extra: "b" },
    ]);
    const res = await handler({
        params: { arguments: { _testConnection: "fixture_conn" } },
    });
    t.assert.snapshot(JSON.parse(res.content[0].text));
});

// FOUND-07 fixture 6: defineListHandler — fields: "all" returns full items
test("snapshot: defineListHandler fields: 'all' returns unprojected items", async (t) => {
    const handler = fixtureList([
        { id: "S1", title: "Stream 1", description: "first", extra: "a" },
    ]);
    const res = await handler({
        params: { arguments: { _testConnection: "fixture_conn", fields: "all" } },
    });
    t.assert.snapshot(JSON.parse(res.content[0].text));
});

// FOUND-07 fixture 7: defineListHandler — limit clamped to MAX_LIMIT
test("snapshot: defineListHandler limit clamped to MAX_LIMIT", async (t) => {
    const handler = fixtureList([{ id: "S1", title: "T", description: "d" }]);
    const res = await handler({
        params: { arguments: { _testConnection: "fixture_conn", limit: 5000 } },
    });
    t.assert.snapshot(JSON.parse(res.content[0].text));
});
