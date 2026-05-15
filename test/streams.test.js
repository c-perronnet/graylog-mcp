// Plan 03-01 Task 3 — Phase 3 read tools.
//
// Covers STREAM-01 (list_streams + mutable projection), STREAM-02 (get_stream,
// full DTO with embedded rules), and STREAM-07 (list_stream_rules, narrow
// per-rule projection). Also covers the v2.3 list_streams displacement
// (Pitfall S5) — the new handler claims the dispatch name; the v2.3
// listStreamsHandler in src/handlers.js stays exported but is no longer
// registered.
//
// Test patterns mirror test/inputs.test.js + test/index-sets.test.js: the
// _testConnection seam + _setCaptureRequest mocks substitute for axios; zod
// rejections are tested via direct handler invocation; the full module-init
// assertion is exercised via the assertAllToolsRegistered re-import test.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";

import { handleListStreams } from "../src/tools/streams/list-streams.js";
import { handleGetStream } from "../src/tools/streams/get-stream.js";
import { handleListStreamRules } from "../src/tools/streams/list-stream-rules.js";
import {
    ListStreamsSchema,
    GetStreamSchema,
    ListStreamRulesSchema,
} from "../src/tools/streams/schemas.js";
import {
    _setCaptureRequest,
    _clearCaptureRequest,
} from "../src/graylog/client.js";
import {
    _setConnectionsForTests,
    _clearConnectionsForTests,
    setActiveConnection,
} from "../src/config.js";
import { GraylogNotFoundError } from "../src/graylog/errors.js";

beforeEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
});

afterEach(() => {
    _clearCaptureRequest();
    _clearConnectionsForTests();
    setActiveConnection(null);
});

// =====================================================================
// Fixtures — verified shape per 03-RESEARCH.md §Endpoint Catalogue
// =====================================================================

const FULL_STREAM_A = {
    id: "s1",
    title: "App errors",
    description: "Stream for app-tier errors",
    is_editable: true,
    disabled: false,
    index_set_id: "ix1",
    matching_type: "AND",
    remove_matches_from_default_stream: false,
    rules: [
        { id: "r1", type: 1, value: "ERROR", field: "level", inverted: false, description: "" },
    ],
    creator_user_id: "admin",
    created_at: "2026-01-01T00:00:00.000Z",
    content_pack: null,
    alert_conditions: [],
    alert_receivers: { users: [], emails: [] },
    outputs: [],
};

const FULL_STREAM_B = {
    id: "s2",
    title: "System events",
    description: "",
    is_editable: false,
    disabled: true,
    index_set_id: "ix2",
    matching_type: "OR",
    remove_matches_from_default_stream: false,
    rules: [],
    creator_user_id: "system",
    created_at: "2026-01-01T00:00:00.000Z",
    content_pack: null,
    alert_conditions: [],
    alert_receivers: { users: [], emails: [] },
    outputs: [],
};

// =====================================================================
// Test 1 — ListStreamsSchema extends listBase (no per-tool args)
// =====================================================================

test("ListStreamsSchema extends listBase: accepts connectionName/fields/limit only", () => {
    const parsed = ListStreamsSchema.parse({
        connectionName: "fake",
        fields: ["id", "title"],
        limit: 10,
    });
    assert.equal(parsed.connectionName, "fake");
    assert.deepEqual(parsed.fields, ["id", "title"]);
    assert.equal(parsed.limit, 10);
});

// =====================================================================
// Test 2 — GetStreamSchema requires streamId (rejects empty string)
// =====================================================================

test("GetStreamSchema requires streamId; empty string is rejected", () => {
    assert.throws(() => GetStreamSchema.parse({ streamId: "" }), /streamId/);
    assert.throws(() => GetStreamSchema.parse({}), /streamId|required/i);
    const parsed = GetStreamSchema.parse({ streamId: "s1" });
    assert.equal(parsed.streamId, "s1");
});

// =====================================================================
// Test 3 — ListStreamRulesSchema requires streamId on top of listBase
// =====================================================================

test("ListStreamRulesSchema extends listBase + requires streamId", () => {
    assert.throws(() => ListStreamRulesSchema.parse({}), /streamId|required/i);
    const parsed = ListStreamRulesSchema.parse({
        streamId: "s1",
        limit: 25,
        fields: "all",
    });
    assert.equal(parsed.streamId, "s1");
    assert.equal(parsed.limit, 25);
    assert.equal(parsed.fields, "all");
});

// =====================================================================
// Test 4 — list_streams default projection includes mutable, drops is_editable
// =====================================================================

test("list_streams default projection includes mutable (from is_editable); is_editable stripped", async () => {
    _setCaptureRequest(() => ({
        total: 2,
        streams: [FULL_STREAM_A, FULL_STREAM_B],
    }));
    const res = await handleListStreams({
        params: { arguments: { _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "list_streams");
    assert.equal(payload.count, 2);
    assert.deepEqual(
        payload.fields,
        ["id", "title", "description", "mutable", "disabled", "index_set_id"],
    );
    // First item must have `mutable: true` (from is_editable: true) and NOT
    // the raw `is_editable` field — the projection is a rename, not a copy.
    assert.equal(payload.items[0].mutable, true);
    assert.equal(payload.items[0].is_editable, undefined);
    assert.equal(payload.items[1].mutable, false);
    assert.equal(payload.items[1].is_editable, undefined);
});

// =====================================================================
// Test 5 — list_streams custom fields projection
// =====================================================================

test("list_streams with custom fields:['id','title','mutable'] projects exactly those keys", async () => {
    _setCaptureRequest(() => ({
        total: 1,
        streams: [FULL_STREAM_A],
    }));
    const res = await handleListStreams({
        params: {
            arguments: {
                _testConnection: "fake",
                fields: ["id", "title", "mutable"],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(Object.keys(payload.items[0]).sort(), ["id", "mutable", "title"]);
    assert.equal(payload.items[0].mutable, true);
    assert.equal(payload.items[0].description, undefined);
});

// =====================================================================
// Test 6 — get_stream returns the full DTO (rules embedded, is_editable kept)
// =====================================================================

test("get_stream returns the full StreamResponse DTO with rules embedded and is_editable preserved", async () => {
    let captured = null;
    _setCaptureRequest((req) => {
        captured = req;
        return FULL_STREAM_A;
    });
    const res = await handleGetStream({
        params: { arguments: { _testConnection: "fake", streamId: "s1" } },
    });
    assert.equal(captured.method, "GET");
    assert.equal(captured.path, "/api/streams/s1");
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "get_stream");
    assert.equal(payload.stream.id, "s1");
    // Full DTO — every field preserved, including the wire is_editable name
    // (D-09 + Pitfall S2: list_streams projects to mutable, get_stream does NOT).
    assert.equal(payload.stream.is_editable, true);
    assert.equal(payload.stream.matching_type, "AND");
    assert.equal(payload.stream.rules.length, 1);
    assert.equal(payload.stream.rules[0].id, "r1");
});

// =====================================================================
// Test 7 — list_stream_rules unwraps stream_rules envelope + narrow projection
// =====================================================================

test("list_stream_rules unwraps stream_rules envelope; default projection [id, type, field, value, inverted]", async () => {
    let captured = null;
    _setCaptureRequest((req) => {
        captured = req;
        return {
            total: 2,
            stream_rules: [
                { id: "r1", type: 1, value: "hello", field: "message", inverted: false, description: "match hello", stream_id: "s1" },
                { id: "r2", type: 6, value: "world", field: "message", inverted: false, description: "contains world", stream_id: "s1" },
            ],
        };
    });
    const res = await handleListStreamRules({
        params: { arguments: { _testConnection: "fake", streamId: "s1" } },
    });
    assert.equal(captured.method, "GET");
    assert.equal(captured.path, "/api/streams/s1/rules");
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "list_stream_rules");
    assert.equal(payload.count, 2);
    assert.deepEqual(
        payload.fields,
        ["id", "type", "field", "value", "inverted"],
    );
    assert.deepEqual(
        Object.keys(payload.items[0]).sort(),
        ["field", "id", "inverted", "type", "value"],
    );
    // description + stream_id MUST be stripped under the narrow projection
    assert.equal(payload.items[0].description, undefined);
    assert.equal(payload.items[0].stream_id, undefined);
});

// =====================================================================
// Test 8 — list_stream_rules missing streamId → zod-level error envelope
// =====================================================================

test("list_stream_rules without streamId fails at zod.parse with structured error", async () => {
    const res = await handleListStreamRules({
        params: { arguments: { _testConnection: "fake" } },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /streamId/);
});

// =====================================================================
// Test 9 — get_stream propagates 404 via wrapGraylogError
// =====================================================================

test("get_stream propagates 404 via wrapGraylogError", async () => {
    _setCaptureRequest(() => {
        throw new GraylogNotFoundError("not found", {
            status: 404,
            method: "GET",
            path: "/api/streams/missing",
            body: null,
        });
    });
    const res = await handleGetStream({
        params: { arguments: { _testConnection: "fake", streamId: "missing" } },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /404/);
    assert.match(res.content[0].text, /get_stream/);
});

// =====================================================================
// Test 10 — after _register.js displacement, dispatch maps list_streams to
// the new Phase 3 handler (NOT the v2.3 listStreamsHandler)
// =====================================================================

test("dispatch resolves list_streams to the new Phase 3 handler (v2.3 displaced)", async () => {
    const { dispatch, _clearForTests } = await import("../src/dispatch.js");
    _clearForTests();
    // Re-import _register.js via dynamic import + cache-bust so its side
    // effects fire fresh against the cleared dispatch Map.
    await import(`../src/tools/_register.js?cacheBust=${Math.random()}`);

    // The new Phase 3 handler talks to /api/streams via makeClient. Stub the
    // request so we can confirm WHICH handler runs by inspecting the response
    // shape — Phase 3 list_streams emits a `tool: "list_streams"` payload via
    // defineListHandler; the v2.3 handler emits a `{ total, streams: [...] }`
    // payload with no `tool` key.
    _setConnectionsForTests({
        fake: { baseUrl: "http://fake.example", apiToken: "tok" },
    });
    setActiveConnection("fake");
    _setCaptureRequest(() => ({ total: 0, streams: [] }));

    const res = await dispatch({ params: { name: "list_streams", arguments: {} } });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "list_streams", "expected Phase 3 handler shape (defineListHandler emits `tool` key)");
    assert.ok(Array.isArray(payload.items), "expected Phase 3 handler shape (items array)");
});

// =====================================================================
// Test 11 — module-init assertAllToolsRegistered returns OK after Plan 03-01
// =====================================================================

test("assertAllToolsRegistered returns OK after Phase 3 Plan 01 registers list_streams/get_stream/list_stream_rules", async () => {
    const { dispatch, _clearForTests, assertAllToolsRegistered } = await import("../src/dispatch.js");
    _clearForTests();
    await import(`../src/tools/_register.js?cacheBust=${Math.random()}`);
    const { toolDefinitions } = await import("../src/tools.js");
    const result = assertAllToolsRegistered(toolDefinitions);
    assert.equal(result, "OK", `assertAllToolsRegistered failed: ${result}`);
    // dispatch is imported just to anchor the dispatch module so it's already
    // initialised in this test context.
    assert.equal(typeof dispatch, "function");
});

// =====================================================================
// Test 12 — list_streams emits a strict-superset of the v2.3 [id,title,description]
//            shape (back-compat for agents reading only the old 3 fields)
// =====================================================================

test("list_streams strict-superset back-compat: items contain id, title, description (plus mutable/disabled/index_set_id)", async () => {
    _setCaptureRequest(() => ({
        total: 1,
        streams: [FULL_STREAM_A],
    }));
    const res = await handleListStreams({
        params: { arguments: { _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    // Strict superset of v2.3 — id, title, description are all there.
    assert.equal(payload.items[0].id, "s1");
    assert.equal(payload.items[0].title, "App errors");
    assert.equal(payload.items[0].description, "Stream for app-tier errors");
    // Plus the new Phase 3 fields.
    assert.equal(payload.items[0].mutable, true);
    assert.equal(payload.items[0].disabled, false);
    assert.equal(payload.items[0].index_set_id, "ix1");
});
