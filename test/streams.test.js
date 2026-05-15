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
    // Plan 03-02 additions — extending the Plan 01 subset.
    StreamRuleSchema,
    STREAM_RULE_TYPE_TO_NUMERIC,
    SimilarityReasonEnum,
    CreateStreamSchema,
    UpdateStreamSchema,
    StartStreamSchema,
    PauseStreamSchema,
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
    // Side-effect import wires every tool — the registry persists across
    // tests in the same node:test process. We do NOT call _clearForTests
    // here because that would unregister every Phase 0-3 handler and the
    // re-import would not re-trigger the side-effects (ES module cache).
    const { dispatch } = await import("../src/dispatch.js");
    await import("../src/tools/_register.js");

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
// Test 11 — module-init assertAllToolsRegistered passes after Plan 03-01
// =====================================================================

test("assertAllToolsRegistered passes after Phase 3 Plan 01 registers list_streams/get_stream/list_stream_rules", async () => {
    const { dispatch, assertAllToolsRegistered } = await import("../src/dispatch.js");
    // Side-effect import: register every production handler. Module cache
    // ensures this only fires once per process even across test files; if
    // earlier tests in this file ran their dispatch dance, those register
    // calls already populated the Map.
    await import("../src/tools/_register.js");
    const { toolDefinitions } = await import("../src/tools.js");
    // assertAllToolsRegistered returns undefined on success and throws on
    // missing handlers (src/dispatch.js:28). Either we reach the next line or
    // the test fails with the thrown error message — which is exactly the
    // contract we want.
    assertAllToolsRegistered(toolDefinitions);
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

// =====================================================================
// Plan 03-02 Task 1 — schema-rejection/acceptance tests (Tests 1-21)
// =====================================================================
//
// These exercise the 4 new mutating schemas + the 8-variant StreamRuleSchema
// discriminated union + the frozen STREAM_RULE_TYPE_TO_NUMERIC map + the
// SimilarityReasonEnum closed-set enum. Schema-layer rejections fire BEFORE
// any handler invocation; handler-layer behavior (preview shape, wire-body
// construction, D-09 pre-flight) is exercised by Tasks 2 + 3 tests below.

// ---------- StreamRuleSchema 8-variant discriminated union ----------

test("stream rule schema: exact variant succeeds with inverted defaulting to false", () => {
    const parsed = StreamRuleSchema.parse({ type: "exact", field: "source", value: "host-1" });
    assert.equal(parsed.type, "exact");
    assert.equal(parsed.field, "source");
    assert.equal(parsed.value, "host-1");
    assert.equal(parsed.inverted, false);
});

test("stream rule schema: regex variant succeeds", () => {
    const parsed = StreamRuleSchema.parse({ type: "regex", field: "msg", value: ".*ERROR.*" });
    assert.equal(parsed.type, "regex");
    assert.equal(parsed.value, ".*ERROR.*");
});

test("stream rule schema: greater variant accepts numeric value", () => {
    const parsed = StreamRuleSchema.parse({ type: "greater", field: "level", value: 4 });
    assert.equal(parsed.type, "greater");
    assert.equal(parsed.value, 4);
});

test("stream rule schema: less variant accepts string-numeric value", () => {
    const parsed = StreamRuleSchema.parse({ type: "less", field: "level", value: "9" });
    assert.equal(parsed.type, "less");
    assert.equal(parsed.value, "9");
});

test("stream rule schema: present variant has no value field requirement", () => {
    const parsed = StreamRuleSchema.parse({ type: "present", field: "trace_id" });
    assert.equal(parsed.type, "present");
    assert.equal(parsed.field, "trace_id");
});

test("stream rule schema: contains variant succeeds", () => {
    const parsed = StreamRuleSchema.parse({ type: "contains", field: "tag", value: "warn" });
    assert.equal(parsed.type, "contains");
    assert.equal(parsed.value, "warn");
});

test("stream rule schema: always_match variant needs no field and no value", () => {
    const parsed = StreamRuleSchema.parse({ type: "always_match" });
    assert.equal(parsed.type, "always_match");
    assert.equal(parsed.field, undefined);
    assert.equal(parsed.value, undefined);
});

test("stream rule schema: match_input variant accepts input id under value, no field", () => {
    const parsed = StreamRuleSchema.parse({ type: "match_input", value: "5f9d3b1c0000000000000001" });
    assert.equal(parsed.type, "match_input");
    assert.equal(parsed.value, "5f9d3b1c0000000000000001");
    assert.equal(parsed.field, undefined);
});

test("stream rule schema: unknown discriminator 'regexp' is rejected (D-11 closed set)", () => {
    assert.throws(() => StreamRuleSchema.parse({ type: "regexp" }), /Invalid discriminator|invalid_union_discriminator|type/i);
});

test("stream rule schema: exact variant without `field` is rejected", () => {
    assert.throws(() => StreamRuleSchema.parse({ type: "exact", value: "x" }), /field|required/i);
});

// ---------- STREAM_RULE_TYPE_TO_NUMERIC frozen alias-to-int map ----------

test("STREAM_RULE_TYPE_TO_NUMERIC is Object.frozen (strict-mode assignment throws)", () => {
    "use strict";
    assert.throws(() => {
        STREAM_RULE_TYPE_TO_NUMERIC.bogus = 99;
    }, TypeError);
});

test("STREAM_RULE_TYPE_TO_NUMERIC has exactly the 8 D-11 entries with correct int values", () => {
    const keys = Object.keys(STREAM_RULE_TYPE_TO_NUMERIC).sort();
    assert.deepEqual(keys, [
        "always_match", "contains", "exact", "greater", "less", "match_input", "present", "regex",
    ]);
    assert.equal(STREAM_RULE_TYPE_TO_NUMERIC.exact, 1);
    assert.equal(STREAM_RULE_TYPE_TO_NUMERIC.regex, 2);
    assert.equal(STREAM_RULE_TYPE_TO_NUMERIC.greater, 3);
    assert.equal(STREAM_RULE_TYPE_TO_NUMERIC.less, 4);
    assert.equal(STREAM_RULE_TYPE_TO_NUMERIC.present, 5);
    assert.equal(STREAM_RULE_TYPE_TO_NUMERIC.contains, 6);
    assert.equal(STREAM_RULE_TYPE_TO_NUMERIC.always_match, 7);
    assert.equal(STREAM_RULE_TYPE_TO_NUMERIC.match_input, 8);
    assert.equal(Object.keys(STREAM_RULE_TYPE_TO_NUMERIC).length, 8);
});

// ---------- CreateStreamSchema ----------

test("CreateStreamSchema accepts minimal valid payload and fills defaults", () => {
    const parsed = CreateStreamSchema.parse({ title: "X", index_set_id: "ix1" });
    assert.equal(parsed.title, "X");
    assert.equal(parsed.index_set_id, "ix1");
    assert.deepEqual(parsed.rules, []);
    assert.equal(parsed.matching_type, "AND");
    assert.equal(parsed.remove_matches_from_default_stream, false);
    // dryRun default from mutatingBase
    assert.equal(parsed.dryRun, true);
});

test("CreateStreamSchema rejects missing index_set_id (D-10)", () => {
    assert.throws(() => CreateStreamSchema.parse({ title: "X" }), /index_set_id/);
});

test("CreateStreamSchema rejects empty string index_set_id (D-10 min(1))", () => {
    assert.throws(() => CreateStreamSchema.parse({ title: "X", index_set_id: "" }), /index_set_id/);
});

test("CreateStreamSchema rejects payload with malformed inline rule type", () => {
    assert.throws(
        () => CreateStreamSchema.parse({
            title: "X",
            index_set_id: "ix1",
            rules: [{ type: "regexp" }],
        }),
        /Invalid discriminator|invalid_union_discriminator|type/i,
    );
});

// ---------- UpdateStreamSchema ----------

test("UpdateStreamSchema accepts streamId + non-empty changes", () => {
    const parsed = UpdateStreamSchema.parse({ streamId: "s1", changes: { title: "new" } });
    assert.equal(parsed.streamId, "s1");
    assert.deepEqual(parsed.changes, { title: "new" });
});

test("UpdateStreamSchema accepts empty changes object (STRICT_NO_ECHO emits minimal body)", () => {
    const parsed = UpdateStreamSchema.parse({ streamId: "s1", changes: {} });
    assert.equal(parsed.streamId, "s1");
    assert.deepEqual(parsed.changes, {});
});

// ---------- StartStreamSchema + PauseStreamSchema ----------

test("StartStreamSchema accepts streamId; rejects missing streamId", () => {
    const parsed = StartStreamSchema.parse({ streamId: "s1" });
    assert.equal(parsed.streamId, "s1");
    assert.throws(() => StartStreamSchema.parse({}), /streamId|required/i);
});

test("PauseStreamSchema accepts streamId; rejects missing streamId", () => {
    const parsed = PauseStreamSchema.parse({ streamId: "s1" });
    assert.equal(parsed.streamId, "s1");
    assert.throws(() => PauseStreamSchema.parse({}), /streamId|required/i);
});

// ---------- SimilarityReasonEnum closed set ----------

test("SimilarityReasonEnum accepts exact|case_insensitive|prefix; rejects anything else", () => {
    assert.equal(SimilarityReasonEnum.parse("exact"), "exact");
    assert.equal(SimilarityReasonEnum.parse("case_insensitive"), "case_insensitive");
    assert.equal(SimilarityReasonEnum.parse("prefix"), "prefix");
    assert.throws(() => SimilarityReasonEnum.parse("fuzzy"), /Invalid enum value|fuzzy/);
    assert.throws(() => SimilarityReasonEnum.parse(""), /Invalid enum value/);
});
