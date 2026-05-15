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
import { handleCreateStream } from "../src/tools/streams/create-stream.js";
import { handleUpdateStream } from "../src/tools/streams/update-stream.js";
import { handleStartStream } from "../src/tools/streams/start-stream.js";
import { handlePauseStream } from "../src/tools/streams/pause-stream.js";
import { handleDeleteStream } from "../src/tools/streams/delete-stream.js";
// Plan 03-04 — stream-rule CRUD + test_stream_match handlers.
import { handleCreateStreamRule } from "../src/tools/streams/create-stream-rule.js";
import { handleDeleteStreamRule } from "../src/tools/streams/delete-stream-rule.js";
import { handleUpdateStreamRule } from "../src/tools/streams/update-stream-rule.js";
import { handleTestStreamMatch } from "../src/tools/streams/test-stream-match.js";
import { computeCascadeHash } from "../src/tools/_shared/cascade-hash.js";
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
    // Plan 03-03 addition.
    DeleteStreamSchema,
    // Plan 03-04 additions — stream-rule schemas + test_stream_match.
    CreateStreamRuleSchema,
    UpdateStreamRuleSchema,
    DeleteStreamRuleSchema,
    TestStreamMatchSchema,
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

// =====================================================================
// Plan 03-02 Task 2 — create_stream + update_stream handler tests
// =====================================================================
//
// Routes a per-test capture function (multiCapture-style) through
// _setCaptureRequest. Build()-level pre-flights (GET /api/streams for
// existingMatches; GET /api/streams/{id} for D-09 mutable) fire as real
// requests against the mocked client.

function streamsMultiCapture(routes) {
    return (req) => {
        for (const r of routes) {
            const matches = typeof r.pathPattern === "string"
                ? req.path === r.pathPattern
                : r.pathPattern.test(req.path);
            if (req.method === r.method && matches) {
                return typeof r.response === "function" ? r.response(req) : r.response;
            }
        }
        throw new Error(`No route matched ${req.method} ${req.path}`);
    };
}

// ---------- create_stream tests ----------

test("create_stream dry-run emits CreateEntityRequest envelope with required fields filled and defaults", async () => {
    _setCaptureRequest(streamsMultiCapture([
        { method: "GET", pathPattern: "/api/streams", response: { total: 0, streams: [] } },
    ]));
    const res = await handleCreateStream({
        params: { arguments: { _testConnection: "fake", title: "X", index_set_id: "ix1" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.tool, "create_stream");
    assert.equal(payload.preview.method, "POST");
    assert.equal(payload.preview.path, "/api/streams");
    // CreateEntityRequest envelope (verified at StreamResource.java:229-230)
    assert.equal(payload.preview.body.share_request, null);
    assert.equal(payload.preview.body.entity.title, "X");
    assert.equal(payload.preview.body.entity.index_set_id, "ix1");
    assert.equal(payload.preview.body.entity.description, null);
    assert.deepEqual(payload.preview.body.entity.rules, []);
    assert.equal(payload.preview.body.entity.matching_type, "AND");
    assert.equal(payload.preview.body.entity.remove_matches_from_default_stream, false);
    assert.equal(payload.preview.body.entity.content_pack, null);
    // D-13: __SERVER_ASSIGNED__ sentinel for postApplyEstimate.id
    assert.equal(payload.postApplyEstimate.id, "__SERVER_ASSIGNED__");
    // existingMatches default to empty array when no GET-list match.
    assert.deepEqual(payload.existingMatches, []);
});

test("create_stream dry-run translates inline regex rule to numeric wire format (S9)", async () => {
    _setCaptureRequest(streamsMultiCapture([
        { method: "GET", pathPattern: "/api/streams", response: { total: 0, streams: [] } },
    ]));
    const res = await handleCreateStream({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "X",
                index_set_id: "ix1",
                rules: [{ type: "regex", field: "msg", value: ".*" }],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.body.entity.rules.length, 1);
    const wireRule = payload.preview.body.entity.rules[0];
    assert.equal(wireRule.type, 2);  // STREAM_RULE_TYPE_TO_NUMERIC.regex = 2
    assert.equal(wireRule.value, ".*");
    assert.equal(wireRule.field, "msg");
    assert.equal(wireRule.inverted, false);
    assert.equal(wireRule.description, null);
});

test("create_stream dry-run emits always_match wire rule with empty value+field (S10)", async () => {
    _setCaptureRequest(streamsMultiCapture([
        { method: "GET", pathPattern: "/api/streams", response: { total: 0, streams: [] } },
    ]));
    const res = await handleCreateStream({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "X",
                index_set_id: "ix1",
                rules: [{ type: "always_match" }],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    const wireRule = payload.preview.body.entity.rules[0];
    assert.equal(wireRule.type, 7);  // STREAM_RULE_TYPE_TO_NUMERIC.always_match = 7
    assert.equal(wireRule.value, "");
    assert.equal(wireRule.field, "");
    assert.equal(wireRule.inverted, false);
    assert.equal(wireRule.description, null);
});

test("create_stream dry-run flags exact-title existingMatch (D-05/D-06 strictest bucket)", async () => {
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams",
            response: { total: 1, streams: [{ id: "s_existing", title: "X" }] },
        },
    ]));
    const res = await handleCreateStream({
        params: { arguments: { _testConnection: "fake", title: "X", index_set_id: "ix1" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.existingMatches.length, 1);
    assert.equal(payload.existingMatches[0].id, "s_existing");
    assert.equal(payload.existingMatches[0].title, "X");
    assert.equal(payload.existingMatches[0].similarity_reason, "exact");
});

test("create_stream dry-run flags case-insensitive existingMatch (D-06 strictest-wins)", async () => {
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams",
            response: { total: 1, streams: [{ id: "s_existing", title: "x" }] },
        },
    ]));
    const res = await handleCreateStream({
        params: { arguments: { _testConnection: "fake", title: "X", index_set_id: "ix1" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.existingMatches.length, 1);
    assert.equal(payload.existingMatches[0].similarity_reason, "case_insensitive");
});

test("create_stream dry-run flags prefix existingMatch (D-06)", async () => {
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams",
            response: { total: 1, streams: [{ id: "s_existing", title: "App" }] },
        },
    ]));
    const res = await handleCreateStream({
        params: { arguments: { _testConnection: "fake", title: "App Errors", index_set_id: "ix1" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.existingMatches.length, 1);
    assert.equal(payload.existingMatches[0].similarity_reason, "prefix");
});

test("create_stream apply path posts CreateEntityRequest envelope and normalizes stream_id", async () => {
    const captured = [];
    _setCaptureRequest(streamsMultiCapture([
        { method: "GET", pathPattern: "/api/streams", response: { total: 0, streams: [] } },
        {
            method: "POST",
            pathPattern: "/api/streams",
            response: (req) => {
                captured.push(req);
                return { stream_id: "s_new_123" };
            },
        },
    ]));
    const res = await handleCreateStream({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "X",
                index_set_id: "ix1",
                dryRun: false,
            },
        },
    });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].body.share_request, null);
    assert.equal(captured[0].body.entity.title, "X");
    assert.equal(captured[0].body.entity.index_set_id, "ix1");
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    assert.equal(payload.result.id, "s_new_123");
});

test("create_stream zod-rejects missing index_set_id at the handler boundary", async () => {
    const res = await handleCreateStream({
        params: { arguments: { _testConnection: "fake", title: "X" } },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /index_set_id/);
});

// ---------- update_stream tests (STRICT_NO_ECHO branch per U1 smoke) ----------

test("update_stream D-09 mutable pre-flight refuses with stream_immutable when is_editable:false", async () => {
    const captured = [];
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: (req) => {
                captured.push(req);
                return { id: "s1", title: "Builtin", is_editable: false };
            },
        },
        {
            method: "PUT",
            pathPattern: "/api/streams/s1",
            response: () => {
                throw new Error("PUT must NOT fire when D-09 refuses");
            },
        },
    ]));
    const res = await handleUpdateStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                changes: { title: "new" },
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /stream_immutable|non-editable/i);
    // Verify only the GET ran — no PUT against the immutable stream.
    assert.equal(captured.length, 1);
    assert.equal(captured[0].method, "GET");
});

test("update_stream STRICT_NO_ECHO emits only the changed field on the wire body", async () => {
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({
                id: "s1",
                title: "Old Title",
                description: "old description",
                matching_type: "AND",
                is_editable: true,
                index_set_id: "ix1",
            }),
        },
    ]));
    const res = await handleUpdateStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                changes: { title: "new" },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.preview.method, "PUT");
    assert.equal(payload.preview.path, "/api/streams/s1");
    // STRICT_NO_ECHO: ONLY title is on the wire — no echoed current.* fields.
    assert.deepEqual(Object.keys(payload.preview.body).sort(), ["title"]);
    assert.equal(payload.preview.body.title, "new");
    assert.equal(payload.postApplyEstimate.id, "s1");
});

test("update_stream apply on a mutable stream emits the STRICT_NO_ECHO body", async () => {
    const captured = [];
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({
                id: "s1", title: "Old", is_editable: true, matching_type: "AND",
            }),
        },
        {
            method: "PUT",
            pathPattern: "/api/streams/s1",
            response: (req) => {
                captured.push(req);
                return { id: "s1" };
            },
        },
    ]));
    const res = await handleUpdateStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                changes: { matching_type: "OR" },
                dryRun: false,
            },
        },
    });
    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0].body, { matching_type: "OR" });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    assert.equal(payload.result.id, "s1");
});

test("update_stream refuses on writable:false connection BEFORE pre-flight GET fires", async () => {
    _setConnectionsForTests({
        readonly: { baseUrl: "x", apiToken: "x", writable: false },
    });
    let getFired = false;
    _setCaptureRequest(() => {
        getFired = true;
        return { id: "s1", is_editable: true };
    });
    const res = await handleUpdateStream({
        params: {
            arguments: {
                connectionName: "readonly",
                streamId: "s1",
                changes: { title: "new" },
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "connection_read_only");
    assert.equal(getFired, false, "no GET should fire when writable gate refuses");
});

// =====================================================================
// Plan 03-02 Task 3 — start_stream + pause_stream lifecycle handler tests
// =====================================================================
//
// Both tools compose through defineMutatingHandler per D-12 (lifecycle-as-
// mutation; no special-cased runtime path). Both pre-flight D-09 mutable;
// both POST to /api/streams/{streamId}/resume or /pause respectively with
// body undefined (Graylog returns 204).

// ---------- start_stream ----------

test("start_stream dry-run on mutable stream previews POST /api/streams/{id}/resume with undefined body", async () => {
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", title: "App", is_editable: true, disabled: true }),
        },
    ]));
    const res = await handleStartStream({
        params: { arguments: { _testConnection: "fake", streamId: "s1" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.tool, "start_stream");
    assert.equal(payload.preview.method, "POST");
    assert.equal(payload.preview.path, "/api/streams/s1/resume");
    assert.equal(payload.preview.body, undefined);
    assert.equal(payload.postApplyEstimate.id, "s1");
    assert.equal(payload.postApplyEstimate.disabled, false);
});

test("start_stream D-09 mutable pre-flight refuses with stream_immutable; no POST fires", async () => {
    const captured = [];
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: (req) => {
                captured.push(req);
                return { id: "s1", title: "Builtin", is_editable: false };
            },
        },
        {
            method: "POST",
            pathPattern: "/api/streams/s1/resume",
            response: () => {
                throw new Error("POST must NOT fire when D-09 refuses");
            },
        },
    ]));
    const res = await handleStartStream({
        params: { arguments: { _testConnection: "fake", streamId: "s1" } },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /stream_immutable|non-editable/i);
    assert.equal(captured.length, 1, "only the GET should fire");
});

test("start_stream apply path POSTs /api/streams/{id}/resume with empty body", async () => {
    const captured = [];
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", is_editable: true, disabled: true }),
        },
        {
            method: "POST",
            pathPattern: "/api/streams/s1/resume",
            response: (req) => {
                captured.push(req);
                return null;  // Graylog returns 204
            },
        },
    ]));
    const res = await handleStartStream({
        params: { arguments: { _testConnection: "fake", streamId: "s1", dryRun: false } },
    });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].method, "POST");
    assert.equal(captured[0].path, "/api/streams/s1/resume");
    assert.equal(captured[0].body, undefined);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
});

test("start_stream refuses on writable:false connection BEFORE pre-flight GET", async () => {
    _setConnectionsForTests({
        readonly: { baseUrl: "x", apiToken: "x", writable: false },
    });
    let getFired = false;
    _setCaptureRequest(() => {
        getFired = true;
        return { id: "s1", is_editable: true };
    });
    const res = await handleStartStream({
        params: {
            arguments: { connectionName: "readonly", streamId: "s1" },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "connection_read_only");
    assert.equal(getFired, false);
});

// ---------- pause_stream ----------

test("pause_stream dry-run on mutable stream previews POST /api/streams/{id}/pause with undefined body", async () => {
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", title: "App", is_editable: true, disabled: false }),
        },
    ]));
    const res = await handlePauseStream({
        params: { arguments: { _testConnection: "fake", streamId: "s1" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.tool, "pause_stream");
    assert.equal(payload.preview.method, "POST");
    assert.equal(payload.preview.path, "/api/streams/s1/pause");
    assert.equal(payload.preview.body, undefined);
    assert.equal(payload.postApplyEstimate.id, "s1");
    assert.equal(payload.postApplyEstimate.disabled, true);
});

test("pause_stream D-09 mutable pre-flight refuses with stream_immutable; no POST fires", async () => {
    const captured = [];
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: (req) => {
                captured.push(req);
                return { id: "s1", title: "Builtin", is_editable: false };
            },
        },
        {
            method: "POST",
            pathPattern: "/api/streams/s1/pause",
            response: () => {
                throw new Error("POST must NOT fire when D-09 refuses");
            },
        },
    ]));
    const res = await handlePauseStream({
        params: { arguments: { _testConnection: "fake", streamId: "s1" } },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /stream_immutable|non-editable/i);
    assert.equal(captured.length, 1);
});

test("pause_stream apply path POSTs /api/streams/{id}/pause with empty body", async () => {
    const captured = [];
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", is_editable: true, disabled: false }),
        },
        {
            method: "POST",
            pathPattern: "/api/streams/s1/pause",
            response: (req) => {
                captured.push(req);
                return null;
            },
        },
    ]));
    const res = await handlePauseStream({
        params: { arguments: { _testConnection: "fake", streamId: "s1", dryRun: false } },
    });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].method, "POST");
    assert.equal(captured[0].path, "/api/streams/s1/pause");
    assert.equal(captured[0].body, undefined);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
});

// =====================================================================
// Plan 03-03 — delete_stream tests (Tests 1-15) — THE C2 mitigation centerpiece
// =====================================================================
//
// Coverage matrix:
//   Tests 1-2:  DeleteStreamSchema parse acceptance/rejection.
//   Test 3:     D-09 stream_immutable refusal BEFORE any cascade GET fires.
//   Test 4:     D-01 happy path — 3-endpoint cascade pre-flight + keyed-buckets hash.
//   Test 5:     D-01 empty cascade — confirmationToken is still emitted.
//   Tests 6-8:  D-04 cascade_preflight_failed (one per endpoint).
//   Test 9:     S6 paginated multi-page event-def fetch + per-page client-side filter.
//   Test 10:    confirmation_mismatch on apply (wrong args.confirm).
//   Test 11:    D-03 cascade_changed_since_preview drift refusal on apply.
//   Test 12:    D-03 happy apply — DELETE fires; sync envelope.
//   Test 13:    S11 sync envelope shape — no async:true / job_id keys.
//   Test 14:    writable:false short-circuits BEFORE any GET fires.
//   Test 15:    schema-parity (in test/schema-parity.test.js — counted here).

// ---------- Test 1 — DeleteStreamSchema accepts streamId; rejects empty/missing ----------

test("DeleteStreamSchema accepts streamId; rejects empty/missing streamId", () => {
    const parsed = DeleteStreamSchema.parse({ streamId: "s1" });
    assert.equal(parsed.streamId, "s1");
    assert.throws(() => DeleteStreamSchema.parse({ streamId: "" }), /streamId/);
    assert.throws(() => DeleteStreamSchema.parse({}), /streamId|required/i);
});

// ---------- Test 2 — DeleteStreamSchema accepts optional confirm ----------

test("DeleteStreamSchema accepts optional confirm (zod string)", () => {
    const parsed = DeleteStreamSchema.parse({ streamId: "s1", confirm: "abc123" });
    assert.equal(parsed.streamId, "s1");
    assert.equal(parsed.confirm, "abc123");
    // confirm is optional — omitting it parses fine.
    const parsedNoConfirm = DeleteStreamSchema.parse({ streamId: "s1" });
    assert.equal(parsedNoConfirm.confirm, undefined);
});

// ---------- Test 3 — D-09 stream_immutable refusal; 0 cascade GETs fire ----------

test("delete_stream D-09 mutable pre-flight refuses with stream_immutable; NO cascade GETs fire", async () => {
    const captured = [];
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: (req) => {
                captured.push(req);
                return { id: "s1", title: "All messages", is_editable: false };
            },
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/rules",
            response: () => {
                throw new Error("cascade GET /rules MUST NOT fire when D-09 refuses");
            },
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/pipelines",
            response: () => {
                throw new Error("cascade GET /pipelines MUST NOT fire when D-09 refuses");
            },
        },
        {
            method: "GET",
            pathPattern: /\/api\/events\/definitions\/paginated/,
            response: () => {
                throw new Error("cascade GET /events/definitions MUST NOT fire when D-09 refuses");
            },
        },
    ]));
    const res = await handleDeleteStream({
        params: { arguments: { _testConnection: "fake", streamId: "s1" } },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /stream_immutable|non-editable/i);
    // Exactly ONE GET fired — the D-09 pre-flight. Cascade GETs are skipped.
    assert.equal(captured.length, 1, "exactly one GET (mutable pre-flight) should fire");
    assert.equal(captured[0].method, "GET");
    assert.equal(captured[0].path, "/api/streams/s1");
});

// ---------- Test 4 — D-01 happy path: 3-endpoint cascade + keyed-buckets hash ----------

test("delete_stream dry-run happy path: cascades populated + confirmationToken via keyed-buckets hash", async () => {
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", title: "App", is_editable: true }),
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/rules",
            response: () => ({
                total: 2,
                stream_rules: [
                    { id: "r1", type: 1, field: "msg", value: "hi" },
                    { id: "r2", type: 6, field: "src", value: "foo" },
                ],
            }),
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/pipelines",
            // Pitfall A3 — BARE ARRAY, no envelope.
            response: () => [{ id: "p1", title: "pipeline-1" }],
        },
        {
            method: "GET",
            pathPattern: /\/api\/events\/definitions\/paginated/,
            response: () => ({
                elements: [
                    { id: "e1", title: "alert-1", config: { streams: ["s1"] } },
                    // e2 should be FILTERED OUT client-side (S6) — doesn't reference s1.
                    { id: "e2", title: "alert-2", config: { streams: ["s99"] } },
                ],
                pagination: { page: 1, per_page: 50, count: 2 },
                total: 2,
            }),
        },
    ]));
    const res = await handleDeleteStream({
        params: { arguments: { _testConnection: "fake", streamId: "s1" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.tool, "delete_stream");
    assert.equal(payload.preview.method, "DELETE");
    assert.equal(payload.preview.path, "/api/streams/s1");
    // cascades — the three buckets, with the e2 entry filtered out per S6.
    assert.equal(payload.cascades.stream_rules.length, 2);
    assert.deepEqual(payload.cascades.stream_rules.map((r) => r.id).sort(), ["r1", "r2"]);
    assert.equal(payload.cascades.pipeline_connections.length, 1);
    assert.equal(payload.cascades.pipeline_connections[0].id, "p1");
    assert.equal(payload.cascades.pipeline_connections[0].title, "pipeline-1");
    assert.equal(payload.cascades.event_definitions.length, 1);
    assert.equal(payload.cascades.event_definitions[0].id, "e1");
    // confirmationToken must equal computeCascadeHash for the exact bucket set.
    const expectedToken = computeCascadeHash({
        streamId: "s1",
        ruleIds: ["r1", "r2"],
        pipelineConnIds: ["p1"],
        eventDefIds: ["e1"],
    });
    assert.equal(payload.confirmationToken, expectedToken);
    // 64-hex sanity check.
    assert.match(payload.confirmationToken, /^[0-9a-f]{64}$/);
});

// ---------- Test 5 — D-01 empty cascades still emits a token ----------

test("delete_stream dry-run with empty cascades emits confirmationToken (empty-buckets hash)", async () => {
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", title: "Empty", is_editable: true }),
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/rules",
            response: () => ({ total: 0, stream_rules: [] }),
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/pipelines",
            response: () => [],
        },
        {
            method: "GET",
            pathPattern: /\/api\/events\/definitions\/paginated/,
            response: () => ({ elements: [], pagination: { page: 1, per_page: 50, count: 0 }, total: 0 }),
        },
    ]));
    const res = await handleDeleteStream({
        params: { arguments: { _testConnection: "fake", streamId: "s1" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(payload.cascades.stream_rules, []);
    assert.deepEqual(payload.cascades.pipeline_connections, []);
    assert.deepEqual(payload.cascades.event_definitions, []);
    const expectedToken = computeCascadeHash({
        streamId: "s1",
        ruleIds: [],
        pipelineConnIds: [],
        eventDefIds: [],
    });
    assert.equal(payload.confirmationToken, expectedToken);
    // The empty-cascade hash is structurally different from the populated case.
    const populatedToken = computeCascadeHash({
        streamId: "s1",
        ruleIds: ["r1"],
        pipelineConnIds: [],
        eventDefIds: [],
    });
    assert.notEqual(payload.confirmationToken, populatedToken);
});

// ---------- Test 6 — D-04 cascade_preflight_failed (rules endpoint) ----------

test("delete_stream cascade_preflight_failed when /rules throws; no token issued", async () => {
    const captured = [];
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", title: "App", is_editable: true }),
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/rules",
            response: (req) => {
                captured.push(req);
                throw new Error("upstream 503");
            },
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/pipelines",
            response: () => {
                throw new Error("pipelines MUST NOT be consulted after rules fail");
            },
        },
        {
            method: "GET",
            pathPattern: /\/api\/events\/definitions\/paginated/,
            response: () => {
                throw new Error("event-defs MUST NOT be consulted after rules fail");
            },
        },
    ]));
    const res = await handleDeleteStream({
        params: { arguments: { _testConnection: "fake", streamId: "s1" } },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "cascade_preflight_failed");
    assert.match(res.content[0].text, /\/api\/streams\/s1\/rules/);
    // No confirmationToken should be in the response text.
    assert.doesNotMatch(res.content[0].text, /confirmationToken/);
    assert.equal(captured.length, 1, "rules endpoint consulted exactly once");
});

// ---------- Test 7 — D-04 cascade_preflight_failed (pipelines endpoint) ----------

test("delete_stream cascade_preflight_failed when /pipelines throws", async () => {
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", title: "App", is_editable: true }),
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/rules",
            response: () => ({ total: 0, stream_rules: [] }),
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/pipelines",
            response: () => {
                throw new Error("upstream 503");
            },
        },
        {
            method: "GET",
            pathPattern: /\/api\/events\/definitions\/paginated/,
            response: () => {
                throw new Error("event-defs MUST NOT be consulted after pipelines fail");
            },
        },
    ]));
    const res = await handleDeleteStream({
        params: { arguments: { _testConnection: "fake", streamId: "s1" } },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "cascade_preflight_failed");
    assert.match(res.content[0].text, /\/api\/streams\/s1\/pipelines/);
});

// ---------- Test 8 — D-04 cascade_preflight_failed (event-defs endpoint) ----------

test("delete_stream cascade_preflight_failed when /events/definitions/paginated throws", async () => {
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", title: "App", is_editable: true }),
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/rules",
            response: () => ({ total: 0, stream_rules: [] }),
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/pipelines",
            response: () => [],
        },
        {
            method: "GET",
            pathPattern: /\/api\/events\/definitions\/paginated/,
            response: () => {
                throw new Error("upstream 503");
            },
        },
    ]));
    const res = await handleDeleteStream({
        params: { arguments: { _testConnection: "fake", streamId: "s1" } },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "cascade_preflight_failed");
    assert.match(res.content[0].text, /\/api\/events\/definitions\/paginated/);
});

// ---------- Test 9 — S6 paginated multi-page event-def fetch ----------

test("delete_stream event-def pagination: full page → next page; partial page → stop", async () => {
    const pageCalls = [];
    // Build 50 entries for page 1 (full page, all filtered out) + 5 entries for
    // page 2 (partial page, one matches s1).
    const page1Entries = Array.from({ length: 50 }, (_, i) => ({
        id: `e_p1_${i}`, title: `def-p1-${i}`, config: { streams: ["s99"] },
    }));
    const page2Entries = [
        { id: "e_p2_0", title: "def-p2-0", config: { streams: ["s1"] } },
        { id: "e_p2_1", title: "def-p2-1", config: { streams: ["s99"] } },
        { id: "e_p2_2", title: "def-p2-2", config: { streams: ["s1", "s99"] } },
        { id: "e_p2_3", title: "def-p2-3", config: { streams: [] } },
        { id: "e_p2_4", title: "def-p2-4", config: { streams: ["s99"] } },
    ];
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", title: "App", is_editable: true }),
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/rules",
            response: () => ({ total: 0, stream_rules: [] }),
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/pipelines",
            response: () => [],
        },
        {
            method: "GET",
            pathPattern: /\/api\/events\/definitions\/paginated/,
            response: (req) => {
                pageCalls.push(req.path);
                if (req.path.includes("page=1")) {
                    return { elements: page1Entries, pagination: {}, total: 55 };
                }
                if (req.path.includes("page=2")) {
                    return { elements: page2Entries, pagination: {}, total: 55 };
                }
                throw new Error(`No more pages should be requested; got ${req.path}`);
            },
        },
    ]));
    const res = await handleDeleteStream({
        params: { arguments: { _testConnection: "fake", streamId: "s1" } },
    });
    const payload = JSON.parse(res.content[0].text);
    // Page 1 (full, 50 entries) + page 2 (partial, 5 entries — early exit). NO page 3.
    assert.equal(pageCalls.length, 2);
    assert.match(pageCalls[0], /page=1/);
    assert.match(pageCalls[1], /page=2/);
    // Filtered match: only page-2 entries 0 and 2 list s1 in config.streams.
    const filteredIds = payload.cascades.event_definitions.map((d) => d.id).sort();
    assert.deepEqual(filteredIds, ["e_p2_0", "e_p2_2"]);
});

// ---------- Test 10 — confirmation_mismatch on apply with wrong confirm ----------

test("delete_stream apply with WRONG confirm hits confirmation_mismatch; DELETE never sent", async () => {
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", title: "App", is_editable: true }),
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/rules",
            response: () => ({ total: 1, stream_rules: [{ id: "r1", type: 1, field: "m", value: "v" }] }),
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/pipelines",
            response: () => [],
        },
        {
            method: "GET",
            pathPattern: /\/api\/events\/definitions\/paginated/,
            response: () => ({ elements: [], pagination: {}, total: 0 }),
        },
        {
            method: "DELETE",
            pathPattern: "/api/streams/s1",
            response: () => {
                throw new Error("DELETE MUST NOT fire on confirmation_mismatch");
            },
        },
    ]));
    const res = await handleDeleteStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                dryRun: false,
                confirm: "WRONG_TOKEN_HEX",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "confirmation_mismatch");
});

// ---------- Test 11 — D-03 cascade_changed_since_preview on drift ----------

test("delete_stream apply refuses with cascade_changed_since_preview when cascade drifted", async () => {
    // Dry-run sees [r1, r2]; apply-time re-fetch sees [r1, r2, r3] (one rule added).
    // The recomputed hash differs from the dry-run token, so apply MUST refuse.
    const dryRunToken = computeCascadeHash({
        streamId: "s1",
        ruleIds: ["r1", "r2"],
        pipelineConnIds: [],
        eventDefIds: [],
    });

    // Track call counts so we can return DIFFERENT rule lists on the dry-run
    // (call #1) vs the apply-time re-fetch (call #2). The apply path's
    // re-fetch must see the drifted state.
    let rulesCalls = 0;
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", title: "App", is_editable: true }),
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/rules",
            response: () => {
                rulesCalls += 1;
                if (rulesCalls === 1) {
                    return {
                        total: 2,
                        stream_rules: [
                            { id: "r1", type: 1, field: "m", value: "v" },
                            { id: "r2", type: 1, field: "m", value: "w" },
                        ],
                    };
                }
                // Apply-time re-fetch sees a drifted cascade.
                return {
                    total: 3,
                    stream_rules: [
                        { id: "r1", type: 1, field: "m", value: "v" },
                        { id: "r2", type: 1, field: "m", value: "w" },
                        { id: "r3", type: 1, field: "m", value: "x" },
                    ],
                };
            },
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/pipelines",
            response: () => [],
        },
        {
            method: "GET",
            pathPattern: /\/api\/events\/definitions\/paginated/,
            response: () => ({ elements: [], pagination: {}, total: 0 }),
        },
        {
            method: "DELETE",
            pathPattern: "/api/streams/s1",
            response: () => {
                throw new Error("DELETE MUST NOT fire on cascade_changed_since_preview");
            },
        },
    ]));
    const res = await handleDeleteStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                dryRun: false,
                confirm: dryRunToken,
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "cascade_changed_since_preview");
    assert.match(res.content[0].text, /cascade_changed_since_preview/);
    // Both rules calls fired: one in build() at apply, one structurally — actually
    // ONE call in apply's buildCascade re-fetch (build() also runs once at apply
    // time to compute the original-shape req, so total is 2: build's GET + apply's
    // re-fetch GET).
    assert.equal(rulesCalls, 2, "rules endpoint hit twice: once for build, once for apply re-fetch");
});

// ---------- Test 12 — D-03 happy apply path: DELETE fires when hash matches ----------

test("delete_stream apply with matching confirm fires DELETE and returns sync envelope", async () => {
    const captured = [];
    // Stable cascade across both calls → hash matches.
    const ruleList = { total: 1, stream_rules: [{ id: "r1", type: 1, field: "m", value: "v" }] };
    const expectedToken = computeCascadeHash({
        streamId: "s1",
        ruleIds: ["r1"],
        pipelineConnIds: [],
        eventDefIds: [],
    });
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", title: "App", is_editable: true }),
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/rules",
            response: () => ruleList,
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/pipelines",
            response: () => [],
        },
        {
            method: "GET",
            pathPattern: /\/api\/events\/definitions\/paginated/,
            response: () => ({ elements: [], pagination: {}, total: 0 }),
        },
        {
            method: "DELETE",
            pathPattern: "/api/streams/s1",
            response: (req) => {
                captured.push(req);
                return null;  // Graylog 204
            },
        },
    ]));
    const res = await handleDeleteStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                dryRun: false,
                confirm: expectedToken,
            },
        },
    });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].method, "DELETE");
    assert.equal(captured[0].path, "/api/streams/s1");
    assert.equal(captured[0].body, undefined);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
});

// ---------- Test 13 — Pitfall S11 sync envelope shape ----------

test("delete_stream apply envelope is SYNC {deleted:true, streamId} — no async/job keys", async () => {
    const expectedToken = computeCascadeHash({
        streamId: "s1",
        ruleIds: [],
        pipelineConnIds: [],
        eventDefIds: [],
    });
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", title: "App", is_editable: true }),
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/rules",
            response: () => ({ total: 0, stream_rules: [] }),
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/pipelines",
            response: () => [],
        },
        {
            method: "GET",
            pathPattern: /\/api\/events\/definitions\/paginated/,
            response: () => ({ elements: [], pagination: {}, total: 0 }),
        },
        {
            method: "DELETE",
            pathPattern: "/api/streams/s1",
            response: () => null,
        },
    ]));
    const res = await handleDeleteStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                dryRun: false,
                confirm: expectedToken,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    // result.body is the apply()'s sync envelope.
    assert.equal(payload.result.body.deleted, true);
    assert.equal(payload.result.body.streamId, "s1");
    // NO async / job_id keys anywhere in the payload (Pitfall S11).
    const flat = JSON.stringify(payload);
    assert.doesNotMatch(flat, /"async":\s*true/);
    assert.doesNotMatch(flat, /job_id_observable_at/);
    assert.doesNotMatch(flat, /await_system_job/);
});

// ---------- Test 14 — writable:false short-circuits BEFORE any GET ----------

test("delete_stream refuses on writable:false connection BEFORE any GET fires", async () => {
    _setConnectionsForTests({
        readonly: { baseUrl: "x", apiToken: "x", writable: false },
    });
    let anyCall = false;
    _setCaptureRequest(() => {
        anyCall = true;
        return {};
    });
    const res = await handleDeleteStream({
        params: {
            arguments: { connectionName: "readonly", streamId: "s1" },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "connection_read_only");
    assert.equal(anyCall, false, "no GET should fire when writable gate refuses");
});

// =====================================================================
// Plan 03-04 Task 1 — create_stream_rule + delete_stream_rule (+ schemas)
// =====================================================================
//
// Coverage matrix (Tests 1-16 per 03-04-PLAN Task 1 <behavior>):
//   Tests 1-5:   CreateStreamRuleSchema parse acceptance/rejection (8 variants).
//   Test 6:      DeleteStreamRuleSchema parse acceptance/rejection.
//   Test 7:      create_stream_rule D-09 parent-mutable refusal — 0 POSTs.
//   Test 8:      create_stream_rule wire emission for `exact` (S9 numeric, S10 defaults).
//   Test 9:      create_stream_rule wire emission for `always_match` (S10 empty-string).
//   Test 10:     create_stream_rule wire emission for `match_input` (D-11 8th variant).
//   Test 11:     create_stream_rule apply normalizes streamrule_id.
//   Test 12:     delete_stream_rule D-09 parent-mutable refusal — 0 DELETEs.
//   Test 13:     delete_stream_rule Discretion-04 — preview JSON omits `cascades`.
//   Test 14:     delete_stream_rule no confirmation gate — no confirmationToken.
//   Test 15:     delete_stream_rule apply path fires DELETE.
//   Test 16:     schema-parity assertions land in test/schema-parity.test.js.

// ---------- Test 1 — CreateStreamRuleSchema accepts `exact` ----------

test("CreateStreamRuleSchema accepts exact variant with field+value+streamId", () => {
    const parsed = CreateStreamRuleSchema.parse({
        streamId: "s1",
        type: "exact",
        field: "source",
        value: "host-1",
    });
    assert.equal(parsed.streamId, "s1");
    assert.equal(parsed.type, "exact");
    assert.equal(parsed.field, "source");
    assert.equal(parsed.value, "host-1");
});

// ---------- Test 2 — CreateStreamRuleSchema accepts `always_match` (no field/value) ----------

test("CreateStreamRuleSchema accepts always_match variant (no field, no value)", () => {
    const parsed = CreateStreamRuleSchema.parse({
        streamId: "s1",
        type: "always_match",
    });
    assert.equal(parsed.streamId, "s1");
    assert.equal(parsed.type, "always_match");
    assert.equal(parsed.field, undefined);
    assert.equal(parsed.value, undefined);
});

// ---------- Test 3 — CreateStreamRuleSchema accepts `match_input` (8th variant) ----------

test("CreateStreamRuleSchema accepts match_input variant (no field; value is input id)", () => {
    const parsed = CreateStreamRuleSchema.parse({
        streamId: "s1",
        type: "match_input",
        value: "input-uuid",
    });
    assert.equal(parsed.type, "match_input");
    assert.equal(parsed.value, "input-uuid");
    assert.equal(parsed.field, undefined);
});

// ---------- Test 4 — CreateStreamRuleSchema rejects unknown discriminator (closed-set) ----------

test("CreateStreamRuleSchema rejects unknown discriminator `regexp` (D-11 closed set)", () => {
    assert.throws(
        () =>
            CreateStreamRuleSchema.parse({
                streamId: "s1",
                type: "regexp",  // misspelled — must be `regex`
                field: "msg",
                value: ".*",
            }),
        /regexp|type|invalid|discriminator|enum/i,
    );
});

// ---------- Test 5 — CreateStreamRuleSchema requires streamId ----------

test("CreateStreamRuleSchema rejects when streamId is missing", () => {
    assert.throws(
        () =>
            CreateStreamRuleSchema.parse({
                type: "exact",
                field: "x",
                value: "y",
            }),
        /streamId|required/i,
    );
});

// ---------- Test 6 — DeleteStreamRuleSchema requires both streamId and ruleId ----------

test("DeleteStreamRuleSchema requires both streamId and ruleId", () => {
    const parsed = DeleteStreamRuleSchema.parse({ streamId: "s1", ruleId: "r1" });
    assert.equal(parsed.streamId, "s1");
    assert.equal(parsed.ruleId, "r1");
    assert.throws(() => DeleteStreamRuleSchema.parse({ streamId: "s1" }), /ruleId|required/i);
    assert.throws(() => DeleteStreamRuleSchema.parse({ ruleId: "r1" }), /streamId|required/i);
});

// ---------- Test 7 — create_stream_rule D-09 parent-mutable refusal ----------

test("create_stream_rule D-09 parent-mutable pre-flight refuses with stream_immutable; NO POST fires", async () => {
    const captured = [];
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: (req) => {
                captured.push(req);
                return { id: "s1", title: "All messages", is_editable: false };
            },
        },
        {
            method: "POST",
            pathPattern: "/api/streams/s1/rules",
            response: () => {
                throw new Error("POST /rules MUST NOT fire when D-09 refuses");
            },
        },
    ]));
    const res = await handleCreateStreamRule({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                type: "exact",
                field: "source",
                value: "host-1",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "stream_immutable");
    assert.match(res.content[0].text, /stream_immutable|non-editable/i);
    assert.equal(captured.length, 1, "exactly one GET (parent-mutable pre-flight) should fire");
});

// ---------- Test 8 — create_stream_rule wire emission for `exact` (S9 numeric + S10 defaults) ----------

test("create_stream_rule dry-run emits exact variant wire body with numeric type=1 and S10 defaults", async () => {
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", title: "App", is_editable: true }),
        },
    ]));
    const res = await handleCreateStreamRule({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                type: "exact",
                field: "source",
                value: "host-1",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.tool, "create_stream_rule");
    assert.equal(payload.preview.method, "POST");
    assert.equal(payload.preview.path, "/api/streams/s1/rules");
    // S9 numeric translation: exact -> 1
    assert.equal(payload.preview.body.type, 1);
    assert.equal(payload.preview.body.value, "host-1");
    assert.equal(payload.preview.body.field, "source");
    // S10 defaults: inverted -> false, description -> null
    assert.equal(payload.preview.body.inverted, false);
    assert.equal(payload.preview.body.description, null);
    // D-13 __SERVER_ASSIGNED__ sentinel for the new rule id.
    assert.equal(payload.postApplyEstimate.id, "__SERVER_ASSIGNED__");
});

// ---------- Test 9 — create_stream_rule wire emission for `always_match` (S10 empty defaults) ----------

test("create_stream_rule dry-run emits always_match wire body with empty value+field (S10)", async () => {
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", title: "App", is_editable: true }),
        },
    ]));
    const res = await handleCreateStreamRule({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                type: "always_match",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // S9 numeric: always_match -> 7
    assert.equal(payload.preview.body.type, 7);
    // S10: irrelevant fields default to "" (non-nullable wire shape).
    assert.equal(payload.preview.body.value, "");
    assert.equal(payload.preview.body.field, "");
    assert.equal(payload.preview.body.inverted, false);
    assert.equal(payload.preview.body.description, null);
});

// ---------- Test 10 — create_stream_rule wire emission for `match_input` (8th variant) ----------

test("create_stream_rule dry-run emits match_input wire body with empty field; value=input id (D-11)", async () => {
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", title: "App", is_editable: true }),
        },
    ]));
    const res = await handleCreateStreamRule({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                type: "match_input",
                value: "input-uuid",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // S9 numeric: match_input -> 8
    assert.equal(payload.preview.body.type, 8);
    assert.equal(payload.preview.body.value, "input-uuid");
    assert.equal(payload.preview.body.field, "");  // S10 empty default
    assert.equal(payload.preview.body.inverted, false);
    assert.equal(payload.preview.body.description, null);
});

// ---------- Test 11 — create_stream_rule apply normalizes streamrule_id ----------

test("create_stream_rule apply path posts wire body and normalizes streamrule_id", async () => {
    const captured = [];
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", title: "App", is_editable: true }),
        },
        {
            method: "POST",
            pathPattern: "/api/streams/s1/rules",
            response: (req) => {
                captured.push(req);
                return { streamrule_id: "r-NEW" };
            },
        },
    ]));
    const res = await handleCreateStreamRule({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                type: "exact",
                field: "source",
                value: "host-1",
                dryRun: false,
            },
        },
    });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].method, "POST");
    assert.equal(captured[0].path, "/api/streams/s1/rules");
    assert.equal(captured[0].body.type, 1);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    // Pitfall S7 / toIdBody idFields:["streamrule_id","id"]
    assert.equal(payload.result.id, "r-NEW");
});

// ---------- Test 12 — delete_stream_rule D-09 parent-mutable refusal ----------

test("delete_stream_rule D-09 parent-mutable pre-flight refuses; NO DELETE fires", async () => {
    const captured = [];
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: (req) => {
                captured.push(req);
                return { id: "s1", title: "All messages", is_editable: false };
            },
        },
        {
            method: "DELETE",
            pathPattern: "/api/streams/s1/rules/r1",
            response: () => {
                throw new Error("DELETE MUST NOT fire when D-09 refuses");
            },
        },
    ]));
    const res = await handleDeleteStreamRule({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                ruleId: "r1",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "stream_immutable");
    assert.match(res.content[0].text, /stream_immutable|non-editable/i);
    assert.equal(captured.length, 1, "exactly one GET (parent-mutable pre-flight) should fire");
});

// ---------- Test 13 — delete_stream_rule Discretion-04 — NO cascades key ----------

test("delete_stream_rule dry-run preview omits `cascades` (Discretion-04 leaf delete)", async () => {
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", title: "App", is_editable: true }),
        },
    ]));
    const res = await handleDeleteStreamRule({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                ruleId: "r1",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.preview.method, "DELETE");
    assert.equal(payload.preview.path, "/api/streams/s1/rules/r1");
    // Discretion-04 — leaf delete; no cascades enumeration.
    // handler.js emits `cascades` only when build()'s descriptor sets it.
    // Verify absence at the parsed-JSON level AND at the raw-text level (so
    // a future regression that accidentally emits `cascades: undefined` still
    // fails — JSON.stringify omits undefined values, so payload.cascades
    // would still be undefined but the raw text would not contain the key).
    assert.equal(
        Object.prototype.hasOwnProperty.call(payload, "cascades"),
        false,
        "preview JSON must omit `cascades` for leaf-delete (Discretion-04)",
    );
    assert.doesNotMatch(res.content[0].text, /"cascades"/);
});

// ---------- Test 14 — delete_stream_rule no confirmation gate ----------

test("delete_stream_rule dry-run preview omits confirmationToken (no requireConfirm gate)", async () => {
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", title: "App", is_editable: true }),
        },
    ]));
    const res = await handleDeleteStreamRule({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                ruleId: "r1",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(
        Object.prototype.hasOwnProperty.call(payload, "confirmationToken"),
        false,
        "leaf-delete must not emit confirmationToken (Discretion-04)",
    );
    assert.doesNotMatch(res.content[0].text, /confirmationToken/);
});

// ---------- Test 15 — delete_stream_rule apply happy path ----------

test("delete_stream_rule apply path fires DELETE /api/streams/{id}/rules/{ruleId}", async () => {
    const captured = [];
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", title: "App", is_editable: true }),
        },
        {
            method: "DELETE",
            pathPattern: "/api/streams/s1/rules/r1",
            response: (req) => {
                captured.push(req);
                return null;  // 204 No Content
            },
        },
    ]));
    const res = await handleDeleteStreamRule({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                ruleId: "r1",
                dryRun: false,
            },
        },
    });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].method, "DELETE");
    assert.equal(captured[0].path, "/api/streams/s1/rules/r1");
    assert.equal(captured[0].body, undefined);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
});

// =====================================================================
// Plan 03-04 Task 2 — update_stream_rule + test_stream_match
// =====================================================================
//
// U1 smoke RESULT: UNREACHABLE_STRICT_NO_ECHO (per 03-U1-SMOKE.md) →
// STRICT_NO_ECHO branch is locked. Tests 1-7 cover update_stream_rule's
// STRICT_NO_ECHO behavior + Pitfall S8 type-from-current echo +
// D-09 parent-mutable pre-flight. Tests 8-11 cover test_stream_match's
// D-07 server-side wrapper contract + literal outer key `{ message: ... }`.

// ---------- Test 16 — UpdateStreamRuleSchema accepts non-type changes ----------

test("UpdateStreamRuleSchema accepts changes:{ value }", () => {
    const parsed = UpdateStreamRuleSchema.parse({
        streamId: "s1",
        ruleId: "r1",
        changes: { value: "new" },
    });
    assert.equal(parsed.streamId, "s1");
    assert.equal(parsed.ruleId, "r1");
    assert.equal(parsed.changes.value, "new");
});

// ---------- Test 17 — UpdateStreamRuleSchema rejects `type` in changes (Pitfall S8 immutability) ----------

test("UpdateStreamRuleSchema rejects `type` in changes (Pitfall S8 immutability)", () => {
    // The default zod ZodObject strips unknown keys rather than throwing.
    // UpdateStreamRuleChangesShape does NOT declare `type` — so .parse() must
    // either strip it (preserving Pitfall S8 immutability at the wire layer)
    // OR reject it (stricter contract). We assert the agent-visible outcome:
    // parsed.changes.type must NOT exist after parsing — regardless of zod
    // mode (strip vs. strict).
    const parsed = UpdateStreamRuleSchema.parse({
        streamId: "s1",
        ruleId: "r1",
        changes: { type: "regex", value: "x" },
    });
    assert.equal(
        Object.prototype.hasOwnProperty.call(parsed.changes, "type"),
        false,
        "Pitfall S8: parsed.changes must not expose type — it is server-immutable",
    );
    // value still flows through.
    assert.equal(parsed.changes.value, "x");
});

// ---------- Test 18 — update_stream_rule D-09 parent-mutable refusal ----------

test("update_stream_rule D-09 parent-mutable pre-flight refuses; NO PUT and NO rule GET fire", async () => {
    const captured = [];
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: (req) => {
                captured.push(req);
                return { id: "s1", title: "All messages", is_editable: false };
            },
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/rules/r1",
            response: () => {
                throw new Error("rule GET MUST NOT fire when parent is immutable");
            },
        },
        {
            method: "PUT",
            pathPattern: "/api/streams/s1/rules/r1",
            response: () => {
                throw new Error("PUT MUST NOT fire when parent is immutable");
            },
        },
    ]));
    const res = await handleUpdateStreamRule({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                ruleId: "r1",
                changes: { value: "new" },
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "stream_immutable");
    assert.match(res.content[0].text, /stream_immutable|non-editable/i);
    assert.equal(captured.length, 1, "only the parent-mutable GET should fire");
    assert.equal(captured[0].path, "/api/streams/s1");
});

// ---------- Test 19 — update_stream_rule Pitfall S8 type-echo from current ----------

test("update_stream_rule wire body emits type from current.type unconditionally (Pitfall S8)", async () => {
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", title: "App", is_editable: true }),
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/rules/r1",
            response: () => ({
                id: "r1",
                type: 2,  // REGEX wire-int
                field: "msg",
                value: "old",
                inverted: false,
                description: null,
            }),
        },
    ]));
    const res = await handleUpdateStreamRule({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                ruleId: "r1",
                changes: { value: "new" },  // type NOT in changes (immutable per S8)
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.method, "PUT");
    assert.equal(payload.preview.path, "/api/streams/s1/rules/r1");
    // Pitfall S8: type MUST be on the wire — echoed from current.type (=2).
    assert.equal(payload.preview.body.type, 2);
    // STRICT_NO_ECHO: value is on the wire because args.changes set it.
    assert.equal(payload.preview.body.value, "new");
});

// ---------- Test 20 — update_stream_rule STRICT_NO_ECHO: only changed fields + type ----------

test("update_stream_rule STRICT_NO_ECHO emits ONLY changed fields + type echo", async () => {
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", title: "App", is_editable: true }),
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/rules/r1",
            response: () => ({
                id: "r1",
                type: 1,  // EXACT wire-int
                field: "src",
                value: "host-1",
                inverted: false,
                description: null,
            }),
        },
    ]));
    const res = await handleUpdateStreamRule({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                ruleId: "r1",
                changes: { value: "host-2" },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // STRICT_NO_ECHO: exactly two keys on the wire — type (echo from current,
    // Pitfall S8) + value (the only changed field). field, inverted,
    // description are ABSENT.
    const keys = Object.keys(payload.preview.body).sort();
    assert.deepEqual(keys, ["type", "value"]);
    assert.equal(payload.preview.body.type, 1);
    assert.equal(payload.preview.body.value, "host-2");
});

// ---------- Test 21 — update_stream_rule apply path PUTs the strict-no-echo body ----------

test("update_stream_rule apply path PUTs strict-no-echo body with type-from-current", async () => {
    const captured = [];
    _setCaptureRequest(streamsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/streams/s1",
            response: () => ({ id: "s1", title: "App", is_editable: true }),
        },
        {
            method: "GET",
            pathPattern: "/api/streams/s1/rules/r1",
            response: () => ({
                id: "r1",
                type: 6,  // CONTAINS
                field: "msg",
                value: "old",
            }),
        },
        {
            method: "PUT",
            pathPattern: "/api/streams/s1/rules/r1",
            response: (req) => {
                captured.push(req);
                return { streamrule_id: "r1" };
            },
        },
    ]));
    const res = await handleUpdateStreamRule({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                ruleId: "r1",
                changes: { field: "newfield" },
                dryRun: false,
            },
        },
    });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].method, "PUT");
    assert.equal(captured[0].path, "/api/streams/s1/rules/r1");
    // Pitfall S8 type echo (CONTAINS = 6) + STRICT_NO_ECHO field change.
    assert.deepEqual(Object.keys(captured[0].body).sort(), ["field", "type"]);
    assert.equal(captured[0].body.type, 6);
    assert.equal(captured[0].body.field, "newfield");
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    assert.equal(payload.result.id, "r1");
});

// ---------- Test 22 — update_stream_rule writable:false short-circuits BEFORE any GET ----------

test("update_stream_rule refuses on writable:false connection BEFORE any GET fires", async () => {
    _setConnectionsForTests({
        readonly: { baseUrl: "x", apiToken: "x", writable: false },
    });
    let getFired = false;
    _setCaptureRequest(() => {
        getFired = true;
        return { id: "s1", is_editable: true };
    });
    const res = await handleUpdateStreamRule({
        params: {
            arguments: {
                connectionName: "readonly",
                streamId: "s1",
                ruleId: "r1",
                changes: { value: "new" },
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "connection_read_only");
    assert.equal(getFired, false);
});

// ---------- Test 23 — test_stream_match happy path: literal outer key `message` ----------

test("test_stream_match happy path: dry-run preview emits body with literal outer key `message`", async () => {
    _setCaptureRequest(() => ({}));  // no upstream GETs needed for D-07 wrapper
    const res = await handleTestStreamMatch({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                message: { source: "host1", level: 6 },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.tool, "test_stream_match");
    assert.equal(payload.preview.method, "POST");
    assert.equal(payload.preview.path, "/api/streams/s1/testMatch");
    // Literal outer key "message" — case-sensitive. StreamResource.java:561-564
    // consumes Map<String, Map<String, Object>> with the outer key checked
    // against the constant "message" — NOT the agent's field-map content.
    assert.deepEqual(Object.keys(payload.preview.body), ["message"]);
    assert.deepEqual(payload.preview.body.message, { source: "host1", level: 6 });
});

// ---------- Test 24 — test_stream_match REQUIRES streamId per D-08 ----------

test("TestStreamMatchSchema rejects missing streamId (D-08 streamId required)", () => {
    assert.throws(
        () => TestStreamMatchSchema.parse({ message: { source: "host1" } }),
        /streamId|required/i,
    );
});

// ---------- Test 25 — test_stream_match apply path forwards response verbatim ----------

test("test_stream_match apply path POSTs to testMatch and forwards response verbatim", async () => {
    const captured = [];
    _setCaptureRequest((req) => {
        captured.push(req);
        return { matches: true, rules: { r1: true, r2: false } };
    });
    const res = await handleTestStreamMatch({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                message: { source: "host1", level: 6 },
                dryRun: false,
            },
        },
    });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].method, "POST");
    assert.equal(captured[0].path, "/api/streams/s1/testMatch");
    assert.deepEqual(Object.keys(captured[0].body), ["message"]);
    assert.deepEqual(captured[0].body.message, { source: "host1", level: 6 });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    // Response forwarded verbatim — no enrichment, no projection. The standard
    // toIdBody fallback maps raw → { id: raw?.id, body: raw } so the full
    // upstream payload sits under result.body.
    assert.equal(payload.result.body.matches, true);
    assert.deepEqual(payload.result.body.rules, { r1: true, r2: false });
});

// ---------- Test 26 — test_stream_match summarize line mentions stream id + field count ----------

test("test_stream_match summarize line includes stream id and sample-message field count", async () => {
    _setCaptureRequest(() => ({}));
    const res = await handleTestStreamMatch({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                message: { source: "host1", level: 6 },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.match(payload.summary, /s1/);
    assert.match(payload.summary, /2\s*field/);
});

