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
// Plan 02-02 Task 1 — strategies module + CreateIndexSetSchema imports.
import { CreateIndexSetSchema } from "../src/tools/index-sets/schemas.js";
import {
    ROTATION_FQCN,
    RETENTION_FQCN,
    buildRotationBlock,
    buildRetentionBlock,
    aliasToConfigOrError,
} from "../src/tools/index-sets/strategies.js";
// Plan 02-02 Task 2 — create_index_set handler import.
import { handleCreateIndexSet, _setClockForTests } from "../src/tools/index-sets/create-index-set.js";

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

// =====================================================================
// Plan 02-02 Task 1 — strategies.js + 6 strict configs + CreateIndexSetSchema
// =====================================================================

const TIME_BASED_FQCN = "org.graylog2.indexer.rotation.strategies.TimeBasedRotationStrategy";
const TIME_BASED_CONFIG_FQCN = "org.graylog2.indexer.rotation.strategies.TimeBasedRotationStrategyConfig";
const SIZE_BASED_FQCN = "org.graylog2.indexer.rotation.strategies.SizeBasedRotationStrategy";
const SIZE_BASED_CONFIG_FQCN = "org.graylog2.indexer.rotation.strategies.SizeBasedRotationStrategyConfig";
const MESSAGE_COUNT_FQCN = "org.graylog2.indexer.rotation.strategies.MessageCountRotationStrategy";
const MESSAGE_COUNT_CONFIG_FQCN = "org.graylog2.indexer.rotation.strategies.MessageCountRotationStrategyConfig";
const DELETE_FQCN = "org.graylog2.indexer.retention.strategies.DeletionRetentionStrategy";
const DELETE_CONFIG_FQCN = "org.graylog2.indexer.retention.strategies.DeletionRetentionStrategyConfig";
const CLOSE_FQCN = "org.graylog2.indexer.retention.strategies.ClosingRetentionStrategy";
const CLOSE_CONFIG_FQCN = "org.graylog2.indexer.retention.strategies.ClosingRetentionStrategyConfig";

// Helper: build a fully-valid CreateIndexSetSchema payload so individual tests
// only mutate the field under test. Defaults: message-count rotation + delete
// retention (smallest config shapes for easy override).
function validCreatePayload(overrides = {}) {
    return {
        title: "App errors",
        index_prefix: "app_errors",
        rotation_strategy: "message-count",
        rotation_strategy_config: { max_docs_per_index: 1000000 },
        retention_strategy: "delete",
        retention_strategy_config: { max_number_of_indices: 30 },
        ...overrides,
    };
}

// -------- Test 1: CreateIndexSetSchema rejects missing rotation_strategy (D-10) --------

test("create_index_set rejects missing rotation_strategy (D-10)", () => {
    const payload = validCreatePayload();
    delete payload.rotation_strategy;
    const result = CreateIndexSetSchema.safeParse(payload);
    assert.equal(result.success, false);
    // The issue should mention rotation_strategy somewhere.
    const issues = result.error.issues.map((i) => i.path.join(".")).join(",");
    assert.match(issues, /rotation_strategy/);
});

// -------- Test 2: CreateIndexSetSchema rejects missing retention_strategy_config (D-10) --------

test("create_index_set rejects missing retention_strategy_config (D-10)", () => {
    const payload = validCreatePayload();
    delete payload.retention_strategy_config;
    const result = CreateIndexSetSchema.safeParse(payload);
    assert.equal(result.success, false);
    const issues = result.error.issues.map((i) => i.path.join(".")).join(",");
    assert.match(issues, /retention_strategy_config/);
});

// -------- Test 3: aliasToConfigOrError rejects "archive" with structured reason --------

test("create_index_set aliasToConfigOrError rejects archive retention with reason archive_not_supported", () => {
    const result = aliasToConfigOrError("retention", "archive", { max_number_of_indices: 30 });
    assert.equal(result.isError, true);
    assert.equal(result.reason, "archive_not_supported");
    assert.match(result.message, /archive/i);
});

// -------- Test 4: CreateIndexSetSchema rejects unknown rotation alias --------

test("create_index_set rejects unknown rotation_strategy alias (closed z.enum)", () => {
    const payload = validCreatePayload({ rotation_strategy: "bogus-strategy" });
    const result = CreateIndexSetSchema.safeParse(payload);
    assert.equal(result.success, false);
    const issues = result.error.issues.map((i) => i.path.join(".")).join(",");
    assert.match(issues, /rotation_strategy/);
});

// -------- Test 5: time-based config without rotation_period rejected (variant narrow) --------

test("create_index_set rejects time-based config without rotation_period (superRefine narrow)", () => {
    const payload = validCreatePayload({
        rotation_strategy: "time-based",
        rotation_strategy_config: {}, // missing rotation_period
    });
    const result = CreateIndexSetSchema.safeParse(payload);
    assert.equal(result.success, false);
    const issue = result.error.issues.find((i) => i.path.join(".") === "rotation_strategy_config.rotation_period");
    assert.ok(issue, `expected an issue at rotation_strategy_config.rotation_period; got: ${JSON.stringify(result.error.issues)}`);
});

// -------- Test 6: time-based config with non-ISO-8601 rotation_period rejected --------

test("create_index_set rejects time-based config with rotation_period not ISO-8601", () => {
    const payload = validCreatePayload({
        rotation_strategy: "time-based",
        rotation_strategy_config: { rotation_period: "one day" },
    });
    const result = CreateIndexSetSchema.safeParse(payload);
    assert.equal(result.success, false);
    const issue = result.error.issues.find((i) => i.path.join(".") === "rotation_strategy_config.rotation_period");
    assert.ok(issue, "expected ISO-8601 validation failure on rotation_period");
});

// -------- Test 7: size-based config without max_size rejected --------

test("create_index_set rejects size-based config without max_size", () => {
    const payload = validCreatePayload({
        rotation_strategy: "size-based",
        rotation_strategy_config: {},
    });
    const result = CreateIndexSetSchema.safeParse(payload);
    assert.equal(result.success, false);
    const issue = result.error.issues.find((i) => i.path.join(".") === "rotation_strategy_config.max_size");
    assert.ok(issue, "expected an issue at rotation_strategy_config.max_size");
});

// -------- Test 8: size-based config with max_size:0 rejected (z.int().positive()) --------

test("create_index_set rejects size-based config with max_size:0", () => {
    const payload = validCreatePayload({
        rotation_strategy: "size-based",
        rotation_strategy_config: { max_size: 0 },
    });
    const result = CreateIndexSetSchema.safeParse(payload);
    assert.equal(result.success, false);
    const issue = result.error.issues.find((i) => i.path.join(".") === "rotation_strategy_config.max_size");
    assert.ok(issue, "expected an issue at rotation_strategy_config.max_size");
});

// -------- Test 9: message-count + close with valid configs accepted --------

test("create_index_set accepts message-count rotation + close retention with valid configs", () => {
    const payload = validCreatePayload({
        rotation_strategy: "message-count",
        rotation_strategy_config: { max_docs_per_index: 5000000 },
        retention_strategy: "close",
        retention_strategy_config: { max_number_of_indices: 60 },
    });
    const result = CreateIndexSetSchema.safeParse(payload);
    assert.equal(result.success, true, JSON.stringify(result.error?.issues));
});

// -------- Test 10: buildRotationBlock time-based returns the exact 2-key wire block --------

test("strategies.js buildRotationBlock(time-based, {rotation_period:P1D}) returns the exact 2-key wire block", () => {
    const block = buildRotationBlock("time-based", { rotation_period: "P1D" });
    assert.deepEqual(block, {
        rotation_strategy_class: TIME_BASED_FQCN,
        rotation_strategy: {
            type: TIME_BASED_CONFIG_FQCN,
            rotation_period: "P1D",
        },
    });
});

// -------- Test 11: buildRetentionBlock mirror for delete + close --------

test("strategies.js buildRetentionBlock returns the exact wire block for delete + close", () => {
    const deleteBlock = buildRetentionBlock("delete", { max_number_of_indices: 30 });
    assert.deepEqual(deleteBlock, {
        retention_strategy_class: DELETE_FQCN,
        retention_strategy: {
            type: DELETE_CONFIG_FQCN,
            max_number_of_indices: 30,
        },
    });
    const closeBlock = buildRetentionBlock("close", { max_number_of_indices: 60 });
    assert.deepEqual(closeBlock, {
        retention_strategy_class: CLOSE_FQCN,
        retention_strategy: {
            type: CLOSE_CONFIG_FQCN,
            max_number_of_indices: 60,
        },
    });
});

// -------- Test 12: buildRotationBlock throws for unknown alias --------

test("strategies.js buildRotationBlock throws for unknown alias", () => {
    assert.throws(
        () => buildRotationBlock("nonexistent", {}),
        /nonexistent|unknown|alias/i,
    );
});

// -------- Module sanity: ROTATION_FQCN / RETENTION_FQCN maps shape --------

test("strategies.js ROTATION_FQCN exposes the 3 rotation aliases with cls + configType pairs", () => {
    assert.equal(ROTATION_FQCN["time-based"].cls, TIME_BASED_FQCN);
    assert.equal(ROTATION_FQCN["time-based"].configType, TIME_BASED_CONFIG_FQCN);
    assert.equal(ROTATION_FQCN["size-based"].cls, SIZE_BASED_FQCN);
    assert.equal(ROTATION_FQCN["size-based"].configType, SIZE_BASED_CONFIG_FQCN);
    assert.equal(ROTATION_FQCN["message-count"].cls, MESSAGE_COUNT_FQCN);
    assert.equal(ROTATION_FQCN["message-count"].configType, MESSAGE_COUNT_CONFIG_FQCN);
});

test("strategies.js RETENTION_FQCN exposes the 2 retention aliases (delete + close)", () => {
    assert.equal(RETENTION_FQCN["delete"].cls, DELETE_FQCN);
    assert.equal(RETENTION_FQCN["delete"].configType, DELETE_CONFIG_FQCN);
    assert.equal(RETENTION_FQCN["close"].cls, CLOSE_FQCN);
    assert.equal(RETENTION_FQCN["close"].configType, CLOSE_CONFIG_FQCN);
    // archive intentionally absent — aliasToConfigOrError handles rejection.
    assert.equal(RETENTION_FQCN["archive"], undefined);
});

// =====================================================================
// Plan 02-02 Task 2 — create_index_set handler (INDEX-03)
// =====================================================================

// Local multi-route capture: pattern-matches method + path, returns the
// response, throws on miss. Same shape as inputs.test.js's multiCapture.
function multiCapture(routes) {
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

const FIXED_CREATION_DATE = "2026-05-15T12:00:00.000Z";

beforeEach(() => {
    // Deterministic creation_date for the create_index_set tests.
    _setClockForTests(() => FIXED_CREATION_DATE);
});

afterEach(() => {
    _setClockForTests(null);
});

// -------- Task 2 Test 1: time-based+delete dry-run emits the exact wire shape --------

test("create_index_set time-based+delete dry-run emits the exact wire shape (D-08 + D-17)", async () => {
    _setCaptureRequest(multiCapture([
        { method: "GET", pathPattern: "/api/system/indices/index_sets", response: { total: 0, index_sets: [], stats: {} } },
    ]));
    const res = await handleCreateIndexSet({
        params: {
            arguments: {
                title: "App errors",
                index_prefix: "app_errors",
                rotation_strategy: "time-based",
                rotation_strategy_config: { rotation_period: "P1D" },
                retention_strategy: "delete",
                retention_strategy_config: { max_number_of_indices: 30 },
                _testConnection: "fake",
            },
        },
    });
    assert.notEqual(res.isError, true, `expected success, got: ${res.content?.[0]?.text}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.preview.method, "POST");
    assert.equal(payload.preview.path, "/api/system/indices/index_sets");
    const body = payload.preview.body;
    assert.equal(body.title, "App errors");
    assert.equal(body.index_prefix, "app_errors");
    assert.equal(
        body.rotation_strategy_class,
        "org.graylog2.indexer.rotation.strategies.TimeBasedRotationStrategy",
    );
    assert.equal(
        body.rotation_strategy.type,
        "org.graylog2.indexer.rotation.strategies.TimeBasedRotationStrategyConfig",
    );
    assert.equal(body.rotation_strategy.rotation_period, "P1D");
    assert.equal(
        body.retention_strategy_class,
        "org.graylog2.indexer.retention.strategies.DeletionRetentionStrategy",
    );
    assert.equal(
        body.retention_strategy.type,
        "org.graylog2.indexer.retention.strategies.DeletionRetentionStrategyConfig",
    );
    assert.equal(body.retention_strategy.max_number_of_indices, 30);
    assert.equal(body.creation_date, FIXED_CREATION_DATE);
    assert.equal(payload.postApplyEstimate.id, "__SERVER_ASSIGNED__");
});

// -------- Task 2 Test 2: size-based+close dry-run mirror (different FQCNs) --------

test("create_index_set size-based+close dry-run emits the correct FQCNs", async () => {
    _setCaptureRequest(multiCapture([
        { method: "GET", pathPattern: "/api/system/indices/index_sets", response: { total: 0, index_sets: [], stats: {} } },
    ]));
    const res = await handleCreateIndexSet({
        params: {
            arguments: {
                title: "Bulk archive",
                index_prefix: "bulk_archive",
                rotation_strategy: "size-based",
                rotation_strategy_config: { max_size: 1073741824 },
                retention_strategy: "close",
                retention_strategy_config: { max_number_of_indices: 90 },
                _testConnection: "fake",
            },
        },
    });
    assert.notEqual(res.isError, true);
    const body = JSON.parse(res.content[0].text).preview.body;
    assert.equal(
        body.rotation_strategy_class,
        "org.graylog2.indexer.rotation.strategies.SizeBasedRotationStrategy",
    );
    assert.equal(
        body.rotation_strategy.type,
        "org.graylog2.indexer.rotation.strategies.SizeBasedRotationStrategyConfig",
    );
    assert.equal(body.rotation_strategy.max_size, 1073741824);
    assert.equal(
        body.retention_strategy_class,
        "org.graylog2.indexer.retention.strategies.ClosingRetentionStrategy",
    );
    assert.equal(
        body.retention_strategy.type,
        "org.graylog2.indexer.retention.strategies.ClosingRetentionStrategyConfig",
    );
});

// -------- Task 2 Test 3: archive retention rejected with structured reason --------

test("create_index_set archive retention rejected with reason archive_not_supported (in build, not apply)", async () => {
    _setCaptureRequest(multiCapture([
        { method: "GET", pathPattern: "/api/system/indices/index_sets", response: { total: 0, index_sets: [], stats: {} } },
    ]));
    const res = await handleCreateIndexSet({
        params: {
            arguments: {
                title: "Archive me",
                index_prefix: "archive_me",
                rotation_strategy: "time-based",
                rotation_strategy_config: { rotation_period: "P1D" },
                retention_strategy: "archive",
                retention_strategy_config: { max_number_of_indices: 365 },
                _testConnection: "fake",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /archive/i);
    // The build() rejection routes through GraylogValidationError → wrapGraylogError,
    // so the rendered text reflects the structured error.
});

// -------- Task 2 Test 4: existingMatches populated when a same-title set exists (M5) --------

test("create_index_set surfaces existingMatches when a same-title index set exists (M5)", async () => {
    _setCaptureRequest(multiCapture([
        {
            method: "GET",
            pathPattern: "/api/system/indices/index_sets",
            response: {
                total: 1,
                index_sets: [
                    { id: "abc", title: "App errors", index_prefix: "app_errors" },
                ],
                stats: {},
            },
        },
    ]));
    const res = await handleCreateIndexSet({
        params: {
            arguments: {
                title: "App errors",
                index_prefix: "app_errors_2",
                rotation_strategy: "message-count",
                rotation_strategy_config: { max_docs_per_index: 1000000 },
                retention_strategy: "delete",
                retention_strategy_config: { max_number_of_indices: 30 },
                _testConnection: "fake",
            },
        },
    });
    assert.notEqual(res.isError, true);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.existingMatches.length, 1);
    assert.equal(payload.existingMatches[0].id, "abc");
    assert.equal(payload.existingMatches[0].title, "App errors");
});

// -------- Task 2 Test 5: apply path returns server-assigned id --------

test("create_index_set apply path returns server-assigned id", async () => {
    const FULL_RESPONSE = {
        id: "iset-new",
        title: "App errors",
        index_prefix: "app_errors",
        default: false,
        writable: true,
        can_be_default: true,
        creation_date: FIXED_CREATION_DATE,
    };
    _setCaptureRequest(multiCapture([
        { method: "GET", pathPattern: "/api/system/indices/index_sets", response: { total: 0, index_sets: [], stats: {} } },
        { method: "POST", pathPattern: "/api/system/indices/index_sets", response: FULL_RESPONSE },
    ]));
    const res = await handleCreateIndexSet({
        params: {
            arguments: {
                title: "App errors",
                index_prefix: "app_errors",
                rotation_strategy: "message-count",
                rotation_strategy_config: { max_docs_per_index: 1000000 },
                retention_strategy: "delete",
                retention_strategy_config: { max_number_of_indices: 30 },
                dryRun: false,
                _testConnection: "fake",
            },
        },
    });
    assert.notEqual(res.isError, true, `expected success, got: ${res.content?.[0]?.text}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, false);
    assert.equal(payload.applied, true);
    assert.equal(payload.result.id, "iset-new");
    assert.deepEqual(payload.result.body, FULL_RESPONSE);
});

// -------- Task 2 Test 6: defaults fill correctly when omitted --------

test("create_index_set defaults fill correctly when shards/replicas/index_analyzer omitted", async () => {
    _setCaptureRequest(multiCapture([
        { method: "GET", pathPattern: "/api/system/indices/index_sets", response: { total: 0, index_sets: [], stats: {} } },
    ]));
    const res = await handleCreateIndexSet({
        params: {
            arguments: {
                title: "Defaults test",
                index_prefix: "defaults_test",
                rotation_strategy: "message-count",
                rotation_strategy_config: { max_docs_per_index: 1000000 },
                retention_strategy: "delete",
                retention_strategy_config: { max_number_of_indices: 30 },
                _testConnection: "fake",
            },
        },
    });
    assert.notEqual(res.isError, true);
    const body = JSON.parse(res.content[0].text).preview.body;
    assert.equal(body.shards, 4);
    assert.equal(body.replicas, 0);
    assert.equal(body.index_analyzer, "standard");
    assert.equal(body.index_optimization_max_num_segments, 1);
    assert.equal(body.index_optimization_disabled, false);
    assert.equal(body.field_type_refresh_interval, 5000);
    assert.equal(body.writable, true);
    assert.equal(body.use_legacy_rotation, true);
    assert.equal(body.description, "");
});
