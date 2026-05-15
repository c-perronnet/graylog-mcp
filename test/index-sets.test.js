import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";
import { handleListIndexSets } from "../src/tools/index-sets/list-index-sets.js";
import { handleGetIndexSet } from "../src/tools/index-sets/get-index-set.js";
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

// Plan 02-01 Task 4 — list_index_sets (INDEX-01) + get_index_set (INDEX-02).
// Two read tools that round out the index-sets domain along with the
// await_system_job primitive shipped in Task 3.

beforeEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
});

afterEach(() => {
    _clearCaptureRequest();
    _clearConnectionsForTests();
    setActiveConnection(null);
});

const FULL_INDEX_SET = {
    id: "iset-1",
    title: "Default index set",
    description: "Stores all messages by default",
    default: true,
    writable: true,
    can_be_default: true,
    index_prefix: "graylog",
    shards: 4,
    replicas: 0,
    rotation_strategy_class: "org.graylog2.indexer.rotation.strategies.TimeBasedRotationStrategy",
    rotation_strategy: { type: "...TimeBasedRotationStrategyConfig", rotation_period: "P1D" },
    retention_strategy_class: "org.graylog2.indexer.retention.strategies.DeletionRetentionStrategy",
    retention_strategy: { type: "...DeletionRetentionStrategyConfig", max_number_of_indices: 30 },
    creation_date: "2026-05-15T00:00:00.000Z",
    index_analyzer: "standard",
    index_optimization_max_num_segments: 1,
    index_optimization_disabled: false,
    field_type_refresh_interval: 5000,
    use_legacy_rotation: false,
};

const SECOND_INDEX_SET = {
    id: "iset-2",
    title: "Errors index set",
    description: "Just for errors",
    default: false,
    writable: true,
    can_be_default: true,
    index_prefix: "graylog_errors",
    shards: 2,
    replicas: 0,
    rotation_strategy_class: "...",
    rotation_strategy: {},
    retention_strategy_class: "...",
    retention_strategy: {},
    creation_date: "2026-05-15T01:00:00.000Z",
    index_analyzer: "standard",
    index_optimization_max_num_segments: 1,
    index_optimization_disabled: false,
    field_type_refresh_interval: 5000,
};

// =====================================================================
// Test 1 — list_index_sets default projection
// =====================================================================

test("list_index_sets default projection narrows to [id, title, description, default, writable, can_be_default, index_prefix]", async () => {
    _setCaptureRequest(() => ({
        total: 2,
        index_sets: [FULL_INDEX_SET, SECOND_INDEX_SET],
        stats: {},
    }));
    const res = await handleListIndexSets({
        params: { arguments: { _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "list_index_sets");
    assert.equal(payload.count, 2);
    assert.deepEqual(
        payload.fields,
        ["id", "title", "description", "default", "writable", "can_be_default", "index_prefix"],
    );
    assert.deepEqual(
        Object.keys(payload.items[0]).sort(),
        ["can_be_default", "default", "description", "id", "index_prefix", "title", "writable"],
    );
    // shards / rotation_strategy / replicas etc. must NOT be present in default projection.
    assert.equal(payload.items[0].shards, undefined);
    assert.equal(payload.items[0].rotation_strategy, undefined);
});

// =====================================================================
// Test 2 — list_index_sets unwraps the envelope
// =====================================================================

test("list_index_sets unwraps the { index_sets: [...] } envelope", async () => {
    _setCaptureRequest(() => ({
        total: 1,
        index_sets: [FULL_INDEX_SET],
        stats: {},
    }));
    const res = await handleListIndexSets({
        params: { arguments: { _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.count, 1);
    assert.equal(payload.items[0].id, "iset-1");
});

// =====================================================================
// Test 3 — list_index_sets fields:'all' returns full DTOs
// =====================================================================

test("list_index_sets fields:'all' returns full DTOs", async () => {
    _setCaptureRequest(() => ({
        total: 1,
        index_sets: [FULL_INDEX_SET],
        stats: {},
    }));
    const res = await handleListIndexSets({
        params: { arguments: { _testConnection: "fake", fields: "all" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.fields, "all");
    assert.equal(payload.items[0].shards, 4);
    assert.equal(payload.items[0].rotation_strategy_class, FULL_INDEX_SET.rotation_strategy_class);
    assert.deepEqual(payload.items[0].rotation_strategy, FULL_INDEX_SET.rotation_strategy);
});

// =====================================================================
// Test 4 — list_index_sets limit clamp (MAX_LIMIT = 200)
// =====================================================================

test("list_index_sets limit:250 clamps to 200 (MAX_LIMIT)", async () => {
    _setCaptureRequest(() => ({
        total: 0,
        index_sets: [],
        stats: {},
    }));
    const res = await handleListIndexSets({
        params: { arguments: { _testConnection: "fake", limit: 250 } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.limit, 200);
});

// =====================================================================
// Test 5 — get_index_set returns full DTO via GET /api/system/indices/index_sets/{id}
// =====================================================================

test("get_index_set returns full DTO via GET /api/system/indices/index_sets/{id}", async () => {
    let captured = null;
    _setCaptureRequest((req) => {
        captured = req;
        return FULL_INDEX_SET;
    });
    const res = await handleGetIndexSet({
        params: {
            arguments: { _testConnection: "fake", indexSetId: "iset-1" },
        },
    });
    assert.equal(captured.method, "GET");
    assert.equal(captured.path, "/api/system/indices/index_sets/iset-1");
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "get_index_set");
    assert.equal(payload.result.id, "iset-1");
    assert.equal(payload.result.body.id, "iset-1");
    assert.equal(payload.result.body.shards, 4);
    assert.equal(payload.result.body.can_be_default, true);
});

// =====================================================================
// Test 6 — get_index_set propagates 404 via wrapGraylogError
// =====================================================================

test("get_index_set propagates 404 via wrapGraylogError", async () => {
    _setCaptureRequest(() => {
        // Throw the same shape mapGraylogError produces for a 404.
        throw new GraylogNotFoundError("not found", {
            status: 404,
            method: "GET",
            path: "/api/system/indices/index_sets/missing",
            body: null,
        });
    });
    const res = await handleGetIndexSet({
        params: { arguments: { _testConnection: "fake", indexSetId: "missing" } },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /404/);
    assert.match(res.content[0].text, /get_index_set/);
});

// =====================================================================
// Test 7 — get_index_set zod rejects missing indexSetId
// =====================================================================

test("get_index_set zod rejects missing indexSetId", async () => {
    const res = await handleGetIndexSet({
        params: { arguments: { _testConnection: "fake" } },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /indexSetId/);
});
