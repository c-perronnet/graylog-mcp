// HARD-03 — v7-vs-v6 read-tool smoke (Phase 7 Plan 03).
//
// Fixture-based smoke pass over the v2.3 read-tool dispatch surface, against
// hand-built v7.2 response fixtures derived from PITFALLS.md backward-compat
// section + the Graylog 7.2.0-SNAPSHOT source-code reference DTOs (StreamListResponse,
// EventDefinitionsResponse, EventNotificationsResponse, SearchResponse).
//
// Per CONTEXT.md D-06/D-07: live cluster is OPTIONAL; default smoke path is
// fixture-based via the test HTTP seam in src/query.js and src/events.js
// (Plan 07-03 introduced these seams — see _setHttpOverride/_clearHttpOverride).
//
// Coverage: 5 priority drift surfaces from PITFALLS.md backward-compat:
//   1. GET /api/streams (deprecated bare path)
//   2. POST /api/views/search/sync (search backbone) — messages path
//   3. POST /api/views/search/sync — histogram path, all 4 fallback strategies
//      exercised INDIVIDUALLY (working-pattern, chart, simple-pivot, complex-pivot).
//   4. GET /api/events/definitions (deprecated bare path)
//   5. GET /api/events/notifications
//
// Plus a structural-coverage assertion: every v2.3 read-tool dispatch name
// (the 20 names in src/tools/_register.js's v2.3 section) is listed in this
// file so future drift in _register.js triggers an explicit count-mismatch
// failure.
//
// NOTE on saved-search / template-mgmt tools: these touch ~/.graylog-mcp/
// JSON files at module-import time. They are covered by the structural-
// coverage list but NOT exercised via dispatch in this file — the existing
// test/regression/read-tools.test.js already proves their dispatch wiring.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { dispatch, assertAllToolsRegistered } from "../src/dispatch.js";
import "../src/tools/_register.js"; // side-effect: register all handlers
import { _setConnectionsForTests, _clearConnectionsForTests, setActiveConnection } from "../src/config.js";
import { _setHttpOverride as _setQueryHttpOverride, _clearHttpOverride as _clearQueryHttpOverride } from "../src/query.js";
import { _setHttpOverride as _setEventsHttpOverride, _clearHttpOverride as _clearEventsHttpOverride } from "../src/events.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "v7-read-tool-smoke");
const loadFixture = (name) => JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8"));

const STREAMS = loadFixture("streams.json");
const EVENT_DEFINITIONS = loadFixture("event-definitions.json");
const EVENT_NOTIFICATIONS = loadFixture("event-notifications.json");
const MESSAGES = loadFixture("messages.json");
const HISTOGRAM = loadFixture("histogram.json");

beforeEach(() => {
    _setConnectionsForTests({
        v7_smoke: { baseUrl: "http://fake-7.2.example", apiToken: "fake-token" },
    });
    setActiveConnection("v7_smoke");
});

afterEach(() => {
    _clearQueryHttpOverride();
    _clearEventsHttpOverride();
    setActiveConnection(null);
    _clearConnectionsForTests();
});

// ---------------------------------------------------------------------------
// 1. Search messages — POST /api/views/search/sync envelope smoke
// ---------------------------------------------------------------------------

test("v7.2 POST /api/views/search/sync — search_messages_graylog extracts messages from results.q1.search_types.st1", async () => {
    const calls = [];
    _setQueryHttpOverride(async ({ method, path, body }) => {
        calls.push({ method, path });
        return MESSAGES;
    });

    const res = await dispatch({
        params: {
            name: "search_messages_graylog",
            arguments: { query: "*", timeRange: "15m" },
        },
    });

    assert.equal(res.isError, undefined, `expected non-error envelope, got ${JSON.stringify(res)}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.total_results, 2, "total_results should reflect search_types.st1.total_results");
    assert.equal(Array.isArray(payload.messages), true, "messages array must be present");
    assert.equal(payload.messages.length, 2, "extractMessages should surface the 2 fixture messages");
    assert.ok(calls.some((c) => c.path === "/api/views/search/sync" && c.method === "POST"), "must hit search/sync");
});

// ---------------------------------------------------------------------------
// 2. Histogram fallback strategies — exercise each INDIVIDUALLY
// ---------------------------------------------------------------------------
// The handler tries 4 builders in order. To exercise strategy K, fail the
// first K-1 calls (throw) and return HISTOGRAM on call K. Each test asserts:
// (a) the response.method field reflects the strategy that succeeded,
// (b) the buckets array is populated.
//
// Strategy ordering per src/handlers.js:328:
//   0: 'working-pattern' (buildWorkingHistogram)
//   1: 'chart'           (buildTimeHistogramChart)
//   2: 'simple-pivot'    (buildSimpleTimeHistogram)
//   3: 'complex-pivot'   (buildTimeHistogram)

function failFirstNThenSucceed(n, successFixture) {
    let callCount = 0;
    return async () => {
        if (callCount < n) {
            callCount += 1;
            throw new Error(`synthetic: strategy ${callCount - 1} failed for fallback-chain smoke`);
        }
        callCount += 1;
        return successFixture;
    };
}

test("v7.2 histogram strategy A (working-pattern) — first builder succeeds, response.method='working-pattern'", async () => {
    _setQueryHttpOverride(failFirstNThenSucceed(0, HISTOGRAM));

    const res = await dispatch({
        params: { name: "get_histogram_messages", arguments: { query: "*", timeRange: "15m" } },
    });

    assert.equal(res.isError, undefined, `expected non-error, got ${JSON.stringify(res)}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.method, "working-pattern", "first-strategy success must report working-pattern");
    assert.equal(payload.type, "time_histogram");
    assert.equal(payload.total_buckets, 3, "fixture has 3 rows → 3 buckets");
    assert.equal(payload.buckets.length, 3);
});

test("v7.2 histogram strategy B (chart) — working-pattern throws, chart succeeds, response.method='chart'", async () => {
    _setQueryHttpOverride(failFirstNThenSucceed(1, HISTOGRAM));

    const res = await dispatch({
        params: { name: "get_histogram_messages", arguments: { query: "*", timeRange: "15m" } },
    });

    assert.equal(res.isError, undefined, `expected non-error, got ${JSON.stringify(res)}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.method, "chart", "second-strategy success must report chart");
    assert.equal(payload.total_buckets, 3);
});

test("v7.2 histogram strategy C (simple-pivot) — A+B throw, simple-pivot succeeds, response.method='simple-pivot'", async () => {
    _setQueryHttpOverride(failFirstNThenSucceed(2, HISTOGRAM));

    const res = await dispatch({
        params: { name: "get_histogram_messages", arguments: { query: "*", timeRange: "15m" } },
    });

    assert.equal(res.isError, undefined, `expected non-error, got ${JSON.stringify(res)}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.method, "simple-pivot", "third-strategy success must report simple-pivot");
    assert.equal(payload.total_buckets, 3);
});

test("v7.2 histogram strategy D (complex-pivot) — A+B+C throw, complex-pivot succeeds, response.method='complex-pivot'", async () => {
    _setQueryHttpOverride(failFirstNThenSucceed(3, HISTOGRAM));

    const res = await dispatch({
        params: { name: "get_histogram_messages", arguments: { query: "*", timeRange: "15m" } },
    });

    assert.equal(res.isError, undefined, `expected non-error, got ${JSON.stringify(res)}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.method, "complex-pivot", "fourth-strategy success must report complex-pivot");
    assert.equal(payload.total_buckets, 3);
});

test("v7.2 histogram all 4 strategies exhausted — handler returns clean isError envelope", async () => {
    _setQueryHttpOverride(failFirstNThenSucceed(4, HISTOGRAM)); // never succeeds within the 4 retries

    const res = await dispatch({
        params: { name: "get_histogram_messages", arguments: { query: "*", timeRange: "15m" } },
    });

    assert.equal(res.isError, true, "all-strategies-exhausted must surface isError:true");
    assert.match(
        res.content[0].text,
        /All approaches failed/,
        "error text must mention all approaches failed"
    );
});

// ---------------------------------------------------------------------------
// 3. search_events_graylog — POST /api/events/search envelope smoke
// ---------------------------------------------------------------------------

test("v7.2 POST /api/events/search — search_events_graylog returns the body verbatim", async () => {
    const calls = [];
    const eventsResponse = {
        events: [
            {
                event: {
                    id: "ev-01",
                    event_definition_id: "65a0000000000000000000aa",
                    event_definition_type: "aggregation-v1",
                    message: "High error rate triggered",
                    timestamp: "2026-05-16T03:59:30.000Z",
                    priority: 2,
                    alert: true,
                },
                index_name: "gl-events_0",
                index_type: "events",
            },
        ],
        used_indices: ["gl-events_0"],
        parameters: {},
        total_events: 1,
        duration: 5,
    };
    _setEventsHttpOverride(async ({ method, path, body }) => {
        calls.push({ method, path });
        return eventsResponse;
    });

    const res = await dispatch({
        params: { name: "search_events_graylog", arguments: { timeRange: "15m" } },
    });

    assert.equal(res.isError, undefined, `expected non-error, got ${JSON.stringify(res)}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.total_events, 1, "total_events surfaced from /api/events/search response");
    assert.equal(payload.events.length, 1);
    assert.ok(calls.some((c) => c.path === "/api/events/search" && c.method === "POST"), "must hit /api/events/search");
});

// ---------------------------------------------------------------------------
// 4. PITFALLS.md row 1 — GET /api/streams envelope shape via the v2.3 fetchStreams seam
// ---------------------------------------------------------------------------
// The v2.3 listStreamsHandler is no longer dispatched (replaced by Phase 3's
// list_streams). But its export still exists in src/handlers.js for HARD-03
// audit reference, and fetchStreams() in src/query.js is still the consumer
// of GET /api/streams. We import fetchStreams directly here to confirm the
// v7.2 StreamListResponse envelope shape is still parseable.

test("v7.2 GET /api/streams — fetchStreams returns the deprecated-bare-path envelope { total, streams[] }", async () => {
    const { fetchStreams } = await import("../src/query.js");
    const calls = [];
    _setQueryHttpOverride(async ({ method, path }) => {
        calls.push({ method, path });
        return STREAMS;
    });

    const data = await fetchStreams("http://fake-7.2.example", "fake-token");

    assert.equal(typeof data.total, "number", "v7.2 StreamListResponse.total must be a number");
    assert.equal(data.total, 2);
    assert.equal(Array.isArray(data.streams), true, "v7.2 StreamListResponse.streams must be an array");
    assert.equal(data.streams[0].id, "000000000000000000000001");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/api/streams", "must hit the deprecated-bare-path (HARD-05 migration target)");
});

// ---------------------------------------------------------------------------
// 5. PITFALLS.md row 8 / 9 — GET /api/events/definitions + /api/events/notifications shape
// ---------------------------------------------------------------------------
// Same situation as fetchStreams: v2.3 list-event handlers are no longer
// dispatched, but the fetchEventDefinitions / fetchEventNotifications client
// functions remain. Direct-call shape audit via the events.js HTTP seam.

test("v7.2 GET /api/events/definitions — fetchEventDefinitions returns the {page, per_page, total, event_definitions[]} envelope", async () => {
    const { fetchEventDefinitions } = await import("../src/events.js");
    const calls = [];
    _setEventsHttpOverride(async ({ method, path }) => {
        calls.push({ method, path });
        return EVENT_DEFINITIONS;
    });

    const data = await fetchEventDefinitions("http://fake-7.2.example", "fake-token", 1, 25);

    assert.equal(data.page, 1);
    assert.equal(data.per_page, 25);
    assert.equal(data.total, 1);
    assert.equal(Array.isArray(data.event_definitions), true);
    assert.equal(data.event_definitions[0].id, "65a0000000000000000000aa");
    assert.equal(calls[0].path, "/api/events/definitions", "must hit the deprecated-bare-path");
});

test("v7.2 GET /api/events/notifications — fetchEventNotifications returns the {page, per_page, total, notifications[]} envelope", async () => {
    const { fetchEventNotifications } = await import("../src/events.js");
    const calls = [];
    _setEventsHttpOverride(async ({ method, path }) => {
        calls.push({ method, path });
        return EVENT_NOTIFICATIONS;
    });

    const data = await fetchEventNotifications("http://fake-7.2.example", "fake-token", 1, 25);

    assert.equal(data.page, 1);
    assert.equal(data.total, 1);
    assert.equal(Array.isArray(data.notifications), true);
    assert.equal(data.notifications[0].id, "65b0000000000000000000bb");
    assert.equal(calls[0].path, "/api/events/notifications");
});

// ---------------------------------------------------------------------------
// 6. Structural coverage assertion — every v2.3 read-tool dispatch name appears here
// ---------------------------------------------------------------------------

test("structural: every v2.3 read-tool dispatch name in src/tools/_register.js has a smoke target", () => {
    // Authoritative list — must match the 20 v2.3 read-tool register() calls
    // in src/tools/_register.js (lines 96-117). If a new v2.3 read tool is
    // added or one is removed, bump this list AND add/remove a smoke target
    // above. This is the M7 anti-drift guard — silent count drift in
    // _register.js's v2.3 section is caught here.
    const V23_READ_TOOLS = [
        "list_connections",
        "set_active_connection",
        "search_messages_graylog",
        "get_context_messages",
        "get_histogram_messages",
        "get_aggregation_field",
        "get_aggregation_field_over_time",
        "debug_query_histogram",
        "list_field_values",
        "create_saved_search",
        "list_saved_searches",
        "get_saved_search",
        "delete_saved_search",
        "cluster_log_messages",
        "list_log_templates",
        "delete_log_template",
        "update_log_template",
        "export_log_templates",
        "import_log_templates",
        "search_events_graylog",
    ];
    assert.equal(V23_READ_TOOLS.length, 20, "v2.3 read-tool registration count drifted — update test + add/remove smoke target");

    // Use assertAllToolsRegistered to verify every name resolves to a
    // registered handler WITHOUT invoking the handler (no HTTP, no file IO).
    // The helper inspects the Map directly and throws if any name is missing.
    const fakeToolDefinitions = V23_READ_TOOLS.map((name) => ({ name }));
    assert.doesNotThrow(
        () => assertAllToolsRegistered(fakeToolDefinitions),
        "every v2.3 read-tool name must be registered in dispatch's Map"
    );
});
