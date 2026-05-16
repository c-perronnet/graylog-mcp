import { test } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";

import * as streamsService from "../src/services/streams.js";
import * as pipelinesService from "../src/services/pipelines.js";
import * as inputsService from "../src/services/inputs.js";
import * as indexSetsService from "../src/services/index-sets.js";
import * as eventsService from "../src/services/events.js";
import * as dashboardsService from "../src/services/dashboards.js";

// Plan 06-01 Task 3 — services-layer wire-form assertions.
// Each service is a thin (client, args) → Promise<response> wrapper. These
// tests pin the wire-form (method, path, body) emitted by each service so
// Plans 02-06 callers can trust the contract.

function makeFakeClient(mockResponse = { ok: true }) {
    const calls = [];
    const client = {
        async request(method, path, body) {
            calls.push({ method, path, body });
            return mockResponse;
        },
    };
    return { client, calls };
}

// =====================================================================
// streams service
// =====================================================================

test("streams.createStream emits CreateEntityRequest envelope with matching_type AND default", async () => {
    const { client, calls } = makeFakeClient();
    await streamsService.createStream(client, {
        title: "App Stream",
        description: "test",
        indexSetId: "ix-1",
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].path, "/api/streams");
    assert.equal(calls[0].body.entity.matching_type, "AND");
    assert.equal(calls[0].body.share_request, null);
    assert.equal(calls[0].body.entity.title, "App Stream");
    assert.equal(calls[0].body.entity.index_set_id, "ix-1");
    assert.deepEqual(calls[0].body.entity.rules, []);
    assert.equal(calls[0].body.entity.remove_matches_from_default_stream, false);
});

test("streams.deleteStream issues DELETE on /api/streams/{streamId}", async () => {
    const { client, calls } = makeFakeClient();
    await streamsService.deleteStream(client, { streamId: "S-abc" });
    assert.equal(calls[0].method, "DELETE");
    assert.equal(calls[0].path, "/api/streams/S-abc");
});

// =====================================================================
// pipelines service
// =====================================================================

test("pipelines.createRule POSTs to /api/system/pipelines/rule", async () => {
    const { client, calls } = makeFakeClient();
    await pipelinesService.createRule(client, {
        title: "drop debug",
        source: "rule \"drop debug\"\nwhen true\nthen drop_message();\nend",
    });
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].path, "/api/system/pipelines/rule");
    assert.equal(calls[0].body.title, "drop debug");
    assert.equal(calls[0].body.description, "");
    assert.ok(typeof calls[0].body.source === "string");
});

test("pipelines.connectToStream sends {stream_id, pipeline_ids}", async () => {
    const { client, calls } = makeFakeClient();
    await pipelinesService.connectToStream(client, {
        streamId: "S-1",
        pipelineIds: ["P-1", "P-2"],
    });
    assert.equal(calls[0].path, "/api/system/pipelines/connections/to_stream");
    assert.deepEqual(Object.keys(calls[0].body).sort(), ["pipeline_ids", "stream_id"]);
    assert.equal(calls[0].body.stream_id, "S-1");
    assert.deepEqual(calls[0].body.pipeline_ids, ["P-1", "P-2"]);
});

// =====================================================================
// inputs service
// =====================================================================

test("inputs.createInput POSTs to /api/system/inputs", async () => {
    const { client, calls } = makeFakeClient();
    await inputsService.createInput(client, {
        title: "gelf-tcp",
        type: "org.graylog2.inputs.gelf.tcp.GELFTCPInput",
        configuration: { port: 12201, bind_address: "0.0.0.0" },
        global: true,
    });
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].path, "/api/system/inputs");
    assert.equal(calls[0].body.title, "gelf-tcp");
    assert.equal(calls[0].body.global, true);
    assert.equal(calls[0].body.node, null);
    assert.equal(calls[0].body.configuration.port, 12201);
});

// =====================================================================
// index-sets service
// =====================================================================

test("index-sets.createIndexSet snake-cases rotation_strategy_class", async () => {
    const { client, calls } = makeFakeClient();
    await indexSetsService.createIndexSet(client, {
        title: "App Logs",
        indexPrefix: "app",
        rotationStrategyClass: "org.graylog2.indexer.rotation.strategies.SizeBasedRotationStrategy",
        rotationStrategy: { max_size: 1073741824, type: "size" },
        retentionStrategyClass: "org.graylog2.indexer.retention.strategies.DeletionRetentionStrategy",
        retentionStrategy: { max_number_of_indices: 20, type: "delete" },
    });
    assert.equal(calls[0].path, "/api/system/indices/index_sets");
    assert.ok("rotation_strategy_class" in calls[0].body);
    assert.ok(!("rotationStrategyClass" in calls[0].body));
    assert.ok("retention_strategy" in calls[0].body);
    assert.ok("index_prefix" in calls[0].body);
    assert.equal(calls[0].body.shards, 1);
    assert.equal(calls[0].body.replicas, 0);
    assert.equal(calls[0].body.writable, true);
});

// =====================================================================
// events service
// =====================================================================

test("events.createEventDefinition appends ?schedule=false by default (Phase 5 M1 carry-forward)", async () => {
    const { client, calls } = makeFakeClient();
    await eventsService.createEventDefinition(client, {
        title: "App Error Spike",
        config: { type: "aggregation-v1" },
    });
    assert.equal(calls[0].method, "POST");
    assert.ok(calls[0].path.endsWith("?schedule=false"), `path=${calls[0].path}`);
});

test("events.createEventDefinition with schedule:true appends ?schedule=true", async () => {
    const { client, calls } = makeFakeClient();
    await eventsService.createEventDefinition(client, {
        title: "App Error Spike",
        config: { type: "aggregation-v1" },
        schedule: true,
    });
    assert.ok(calls[0].path.endsWith("?schedule=true"), `path=${calls[0].path}`);
});

// =====================================================================
// dashboards service
// =====================================================================

test("dashboards.createSearch sends BARE SearchDTO (no CreateEntityRequest envelope)", async () => {
    // RESEARCH Pitfall 3 explicit exception: /views/search does NOT use
    // CreateEntityRequest envelope; the body is the bare SearchDTO at the top
    // level. This regression-guards future churn that "harmonizes" the wrap.
    const { client, calls } = makeFakeClient();
    const searchDTO = {
        queries: [{ id: "q-1", timerange: { type: "relative", from: 300 }, filter: null, filters: [], query: { type: "elasticsearch", query_string: "" }, search_types: [] }],
        parameters: [],
        skipNoStreamsCheck: false,
    };
    await dashboardsService.createSearch(client, searchDTO);
    assert.equal(calls[0].path, "/api/views/search");
    // queries MUST be top-level (NOT nested under .entity)
    assert.ok(Array.isArray(calls[0].body.queries), "body.queries must be at top level");
    assert.equal(calls[0].body.entity, undefined, "body.entity MUST NOT exist on /views/search");
    assert.equal(calls[0].body.share_request, undefined, "body.share_request MUST NOT exist on /views/search");
});

test("dashboards.createDashboard wraps ViewDTO in CreateEntityRequest envelope", async () => {
    const { client, calls } = makeFakeClient();
    const viewDTO = { type: "DASHBOARD", title: "test", search_id: "srch-1", state: {} };
    await dashboardsService.createDashboard(client, viewDTO);
    assert.equal(calls[0].path, "/api/views");
    assert.ok(calls[0].body.entity, "body.entity must exist");
    assert.equal(calls[0].body.entity.type, "DASHBOARD");
    assert.equal(calls[0].body.share_request, null);
});

test("dashboards.buildSearchDTO assembles QueryDTO with widget searchTypes", () => {
    const widgets = [
        { widget: { id: "w1" }, position: {}, searchType: { id: "st-1", type: "pivot" } },
        { widget: { id: "w2" }, position: {}, searchType: { id: "st-2", type: "pivot" } },
    ];
    const dto = dashboardsService.buildSearchDTO({
        queryId: "q-1",
        widgets,
        timerange: { type: "relative", from: 300 },
        query: "level:>=4",
    });
    assert.equal(dto.queries.length, 1);
    assert.equal(dto.queries[0].id, "q-1");
    assert.equal(dto.queries[0].search_types.length, 2);
    assert.equal(dto.queries[0].query.query_string, "level:>=4");
});

test("dashboards.buildViewDTO emits titles + displayModeSettings explicitly (Q2 default)", () => {
    const widgets = [
        { widget: { id: "w1" }, position: { col: 1, row: 1, height: 2, width: 6 }, searchType: { id: "st-1" } },
    ];
    const dto = dashboardsService.buildViewDTO({
        title: "App Health",
        searchId: "srch-1",
        queryId: "q-1",
        widgets,
    });
    assert.equal(dto.type, "DASHBOARD");
    assert.equal(dto.search_id, "srch-1");
    // 06-U1-SMOKE Q2 default — Pitfall 6
    assert.deepEqual(dto.state["q-1"].titles, { titles: {} });
    assert.deepEqual(dto.state["q-1"].display_mode_settings, {
        positions_inferred: false,
        show_summary: false,
        show_message_row: false,
    });
    // widget_mapping shape per Pitfall 5
    assert.deepEqual(dto.state["q-1"].widget_mapping, { w1: ["st-1"] });
    // positions keyed by widget.id
    assert.deepEqual(dto.state["q-1"].positions.w1, { col: 1, row: 1, height: 2, width: 6 });
});

// Bonus: verify text-widget placeholder (Q3) emits empty widget_mapping
test("dashboards.buildViewDTO emits empty widget_mapping for text-widget placeholder (Q3 searchType: null)", () => {
    const widgets = [
        { widget: { id: "txt1" }, position: { col: 1, row: 1, height: 2, width: 12 }, searchType: null },
    ];
    const dto = dashboardsService.buildViewDTO({
        title: "Mixed",
        searchId: "srch-1",
        queryId: "q-1",
        widgets,
    });
    assert.deepEqual(dto.state["q-1"].widget_mapping, { txt1: [] });
});
