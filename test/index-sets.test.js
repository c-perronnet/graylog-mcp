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
// Plan 02-02 Task 3 — update_index_set handler + schema imports.
import { handleUpdateIndexSet } from "../src/tools/index-sets/update-index-set.js";
import { UpdateIndexSetSchema } from "../src/tools/index-sets/schemas.js";

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

// =====================================================================
// Plan 02-02 Task 3 — update_index_set handler (INDEX-04) per U1 MERGE_FROM_CURRENT
// =====================================================================
//
// U1 decision (02-U1-SMOKE.md): UNREACHABLE_DEFAULT_MERGE → merge-from-current
// path. Pre-flight GET fetches the full IndexSetResponse; build() merges
// args.changes (minus immutable fields) over the top and emits the full
// merged DTO on the wire. D-11 atomic strategy-replace is enforced at the
// schema layer (UpdateIndexSetSchema superRefine); ND2 default-must-be-writable
// pre-flight is enforced in update-index-set.js build() before the PUT fires.

// Full current state for the pre-flight GET — every field the merge needs.
const CURRENT_INDEX_SET = {
    id: "iset-1",
    title: "App errors",
    description: "Stream-routed errors",
    index_prefix: "app_errors",
    shards: 4,
    replicas: 0,
    rotation_strategy_class: "org.graylog2.indexer.rotation.strategies.MessageCountRotationStrategy",
    rotation_strategy: {
        type: "org.graylog2.indexer.rotation.strategies.MessageCountRotationStrategyConfig",
        max_docs_per_index: 1000000,
    },
    retention_strategy_class: "org.graylog2.indexer.retention.strategies.DeletionRetentionStrategy",
    retention_strategy: {
        type: "org.graylog2.indexer.retention.strategies.DeletionRetentionStrategyConfig",
        max_number_of_indices: 30,
    },
    creation_date: "2026-01-01T00:00:00.000Z",
    index_analyzer: "standard",
    index_optimization_max_num_segments: 1,
    index_optimization_disabled: false,
    field_type_refresh_interval: 5000,
    writable: true,
    use_legacy_rotation: true,
    default: false,
    can_be_default: true,
};

// -------- Task 3 Test 1: UpdateIndexSetSchema rejects rotation_strategy without config (D-11) --------

test("update_index_set zod rejects rotation_strategy without rotation_strategy_config (D-11)", () => {
    const result = UpdateIndexSetSchema.safeParse({
        indexSetId: "iset-1",
        changes: { rotation_strategy: "size-based" },
    });
    assert.equal(result.success, false);
    const issue = result.error.issues.find((i) => i.path.join(".") === "changes.rotation_strategy_config");
    assert.ok(issue, `expected path changes.rotation_strategy_config; got ${JSON.stringify(result.error.issues)}`);
    assert.match(issue.message, /rotation_strategy_config is required/);
});

// -------- Task 3 Test 2: UpdateIndexSetSchema rejects rotation_strategy_config without strategy (D-11) --------

test("update_index_set zod rejects rotation_strategy_config without rotation_strategy (D-11)", () => {
    const result = UpdateIndexSetSchema.safeParse({
        indexSetId: "iset-1",
        changes: { rotation_strategy_config: { max_size: 1073741824 } },
    });
    assert.equal(result.success, false);
    const issue = result.error.issues.find((i) => i.path.join(".") === "changes.rotation_strategy");
    assert.ok(issue, `expected path changes.rotation_strategy; got ${JSON.stringify(result.error.issues)}`);
    assert.match(issue.message, /rotation_strategy is required/);
});

// -------- Task 3 Test 3: UpdateIndexSetSchema rejects retention_strategy without config (D-11) --------

test("update_index_set zod rejects retention_strategy without retention_strategy_config (D-11)", () => {
    const result = UpdateIndexSetSchema.safeParse({
        indexSetId: "iset-1",
        changes: { retention_strategy: "close" },
    });
    assert.equal(result.success, false);
    const issue = result.error.issues.find((i) => i.path.join(".") === "changes.retention_strategy_config");
    assert.ok(issue, "expected path changes.retention_strategy_config");
});

// -------- Task 3 Test 4: UpdateIndexSetSchema rejects empty changes object --------

test("update_index_set zod rejects empty changes object", () => {
    const result = UpdateIndexSetSchema.safeParse({
        indexSetId: "iset-1",
        changes: {},
    });
    assert.equal(result.success, false);
    const issues = result.error.issues.map((i) => i.message).join(",");
    assert.match(issues, /changes must be non-empty/);
});

// -------- Task 3 Test 5: title-only change — merge-from-current emits full merged DTO --------

test("update_index_set title-only change emits the full merged DTO (U1 MERGE_FROM_CURRENT)", async () => {
    _setCaptureRequest(multiCapture([
        { method: "GET", pathPattern: "/api/system/indices/index_sets/iset-1", response: CURRENT_INDEX_SET },
    ]));
    const res = await handleUpdateIndexSet({
        params: {
            arguments: {
                indexSetId: "iset-1",
                changes: { title: "Renamed app errors" },
                _testConnection: "fake",
            },
        },
    });
    assert.notEqual(res.isError, true, `expected success, got: ${res.content?.[0]?.text}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.method, "PUT");
    assert.equal(payload.preview.path, "/api/system/indices/index_sets/iset-1");
    const body = payload.preview.body;
    // Agent's change applied:
    assert.equal(body.title, "Renamed app errors");
    // MERGE_FROM_CURRENT: full DTO shape — strategy blocks preserved from current.
    assert.equal(body.description, CURRENT_INDEX_SET.description);
    assert.equal(body.shards, CURRENT_INDEX_SET.shards);
    assert.equal(body.replicas, CURRENT_INDEX_SET.replicas);
    assert.equal(body.rotation_strategy_class, CURRENT_INDEX_SET.rotation_strategy_class);
    assert.deepEqual(body.rotation_strategy, CURRENT_INDEX_SET.rotation_strategy);
    assert.equal(body.retention_strategy_class, CURRENT_INDEX_SET.retention_strategy_class);
    assert.deepEqual(body.retention_strategy, CURRENT_INDEX_SET.retention_strategy);
    // Immutable fields preserved from current (never sourced from agent changes):
    assert.equal(body.index_prefix, CURRENT_INDEX_SET.index_prefix);
    assert.equal(body.creation_date, CURRENT_INDEX_SET.creation_date);
});

// -------- Task 3 Test 6: strategy-replace (D-11 atomic) emits new FQCNs + config --------

test("update_index_set strategy-replace (D-11 atomic) emits new rotation FQCNs + config", async () => {
    _setCaptureRequest(multiCapture([
        { method: "GET", pathPattern: "/api/system/indices/index_sets/iset-1", response: CURRENT_INDEX_SET },
    ]));
    const res = await handleUpdateIndexSet({
        params: {
            arguments: {
                indexSetId: "iset-1",
                changes: {
                    rotation_strategy: "size-based",
                    rotation_strategy_config: { max_size: 1073741824 },
                },
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
    // Retention block preserved from current.
    assert.equal(body.retention_strategy_class, CURRENT_INDEX_SET.retention_strategy_class);
});

// -------- Task 3 Test 7: ND2 pre-flight blocks writable:false on the default index set --------

test("update_index_set ND2 pre-flight blocks writable:false on the default index set", async () => {
    let putCalls = 0;
    _setCaptureRequest((req) => {
        if (req.method === "PUT") {
            putCalls += 1;
            throw new Error("PUT should not fire when ND2 pre-flight refuses");
        }
        if (req.method === "GET" && req.path === "/api/system/indices/index_sets/iset-default") {
            return { ...CURRENT_INDEX_SET, id: "iset-default", default: true };
        }
        throw new Error(`No route matched ${req.method} ${req.path}`);
    });
    const res = await handleUpdateIndexSet({
        params: {
            arguments: {
                indexSetId: "iset-default",
                changes: { writable: false },
                _testConnection: "fake",
                dryRun: false, // attempting apply
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /default_index_set_must_be_writable|writable/i);
    assert.equal(putCalls, 0, "PUT must NOT fire when ND2 pre-flight refuses");
});

// -------- Task 3 Test 8: immutable fields stripped from agent changes --------

test("update_index_set strips immutable index_prefix + creation_date from agent changes", async () => {
    _setCaptureRequest(multiCapture([
        { method: "GET", pathPattern: "/api/system/indices/index_sets/iset-1", response: CURRENT_INDEX_SET },
    ]));
    const res = await handleUpdateIndexSet({
        params: {
            arguments: {
                indexSetId: "iset-1",
                changes: {
                    title: "Stripped immutable",
                    // These would-be agent overrides MUST be ignored — the schema
                    // doesn't expose them in `changes` (UpdateChangesShape omits
                    // index_prefix + creation_date), so zod strips them by default.
                    // Even if a future regression let them through, the wire-build
                    // re-asserts current.index_prefix + current.creation_date.
                    index_prefix: "attacker_prefix",
                    creation_date: "2000-01-01T00:00:00.000Z",
                },
                _testConnection: "fake",
            },
        },
    });
    assert.notEqual(res.isError, true);
    const body = JSON.parse(res.content[0].text).preview.body;
    assert.equal(body.index_prefix, CURRENT_INDEX_SET.index_prefix, "index_prefix must be the current value, not the agent override");
    assert.equal(body.creation_date, CURRENT_INDEX_SET.creation_date, "creation_date must be the current value, not the agent override");
});

// -------- Task 3 Test 9: apply path returns full DTO + id --------

test("update_index_set apply path returns full DTO + id", async () => {
    const UPDATED = { ...CURRENT_INDEX_SET, title: "Renamed app errors" };
    _setCaptureRequest(multiCapture([
        { method: "GET", pathPattern: "/api/system/indices/index_sets/iset-1", response: CURRENT_INDEX_SET },
        { method: "PUT", pathPattern: "/api/system/indices/index_sets/iset-1", response: UPDATED },
    ]));
    const res = await handleUpdateIndexSet({
        params: {
            arguments: {
                indexSetId: "iset-1",
                changes: { title: "Renamed app errors" },
                dryRun: false,
                _testConnection: "fake",
            },
        },
    });
    assert.notEqual(res.isError, true, `expected success, got: ${res.content?.[0]?.text}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    assert.equal(payload.result.id, "iset-1");
    assert.equal(payload.result.body.title, "Renamed app errors");
});

// =====================================================================
// Plan 02-03 — Task 1: delete_index_set C1 hash + collectIndexNames helpers
// =====================================================================
//
// computeC1Hash + collectIndexNames are the pure plumbing for delete_index_set's
// C1 confirmation token. The hash inputs are the dry-run state — indexSetId
// (target id), deleteIndices: true (locked literal; replay protection per D-02),
// indexNames (sorted), messageCount. collectIndexNames walks the Graylog
// AllIndices shape (closed.indices Set + reopened.indices Set + all.indices Map)
// into a deduped array; the hash function sorts before hashing so input order
// is irrelevant to the agent.
//
// The frozen-fixture hash in Test 1 is the first-run output for a known input
// vector — if the canonicalization shape ever drifts (key order, locked-literal
// swap, sort omission), the test fails loudly.

import {
    computeC1Hash,
    collectIndexNames,
} from "../src/tools/index-sets/c1-hash.js";

// -------- Task 1 Test 1: computeC1Hash 64-hex output + frozen fixture --------

test("computeC1Hash returns deterministic 64-hex sha-256 for the frozen fixture", () => {
    const hash = computeC1Hash({
        indexSetId: "iset-1",
        deleteIndices: true,
        indexNames: ["graylog_0", "graylog_1"],
        messageCount: 100,
    });
    // Format: 64 lowercase hex chars (sha-256).
    assert.equal(hash.length, 64);
    assert.match(hash, /^[a-f0-9]{64}$/);
    // Frozen fixture: this exact value MUST hold across CI runs. Drift means
    // the canonicalization shape changed — a dry-run → apply binding break.
    assert.equal(
        hash,
        "3371c65813c7a3acce20d96371b8df8ba6b1ae5d672309962fbf236b065ba6a0",
        "frozen-fixture hash drift — canonicalization shape changed",
    );
});

// -------- Task 1 Test 2: computeC1Hash determinism (same input → same hash) --------

test("computeC1Hash is deterministic — repeated calls with identical input return identical hash", () => {
    const inputs = {
        indexSetId: "iset-2",
        deleteIndices: true,
        indexNames: ["alpha_0", "alpha_1", "alpha_2"],
        messageCount: 5000,
    };
    const h1 = computeC1Hash(inputs);
    const h2 = computeC1Hash(inputs);
    assert.equal(h1, h2);
});

// -------- Task 1 Test 3: computeC1Hash sorts indexNames before hashing --------

test("computeC1Hash sorts indexNames before hashing — order-independent hash", () => {
    const h1 = computeC1Hash({
        indexSetId: "iset-3",
        deleteIndices: true,
        indexNames: ["a", "b"],
        messageCount: 7,
    });
    const h2 = computeC1Hash({
        indexSetId: "iset-3",
        deleteIndices: true,
        indexNames: ["b", "a"],
        messageCount: 7,
    });
    assert.equal(h1, h2, "input order MUST NOT affect the hash");
});

// -------- Task 1 Test 4: computeC1Hash messageCount sensitivity --------

test("computeC1Hash is sensitive to messageCount — different counts produce different hashes", () => {
    const base = {
        indexSetId: "iset-4",
        deleteIndices: true,
        indexNames: ["x_0"],
    };
    const h0 = computeC1Hash({ ...base, messageCount: 0 });
    const h1 = computeC1Hash({ ...base, messageCount: 1 });
    assert.notEqual(h0, h1, "messageCount drift between dry-run and apply MUST break the hash");
});

// -------- Task 1 Test 5: computeC1Hash refuses deleteIndices !== true (D-02 replay protection) --------

test("computeC1Hash throws when deleteIndices !== true (D-02 locked literal replay protection)", () => {
    // false
    assert.throws(
        () => computeC1Hash({ indexSetId: "iset-5", deleteIndices: false, indexNames: [], messageCount: 0 }),
        /deleteIndices/,
    );
    // undefined
    assert.throws(
        () => computeC1Hash({ indexSetId: "iset-5", indexNames: [], messageCount: 0 }),
        /deleteIndices/,
    );
    // truthy non-literal (the string "true" — Graylog would happily delete but
    // the hash function MUST refuse anything that isn't the JS literal true)
    assert.throws(
        () => computeC1Hash({ indexSetId: "iset-5", deleteIndices: "true", indexNames: [], messageCount: 0 }),
        /deleteIndices/,
    );
});

// -------- Task 1 Test 6: collectIndexNames walks all three sub-collections --------

test("collectIndexNames extracts names from closed + reopened + all (deduped)", () => {
    const allIndices = {
        closed: { indices: ["a", "b"] },
        reopened: { indices: ["c"] },
        all: { indices: { d: {}, e: {} } },
    };
    const names = collectIndexNames(allIndices);
    assert.deepEqual(names.sort(), ["a", "b", "c", "d", "e"]);
});

// -------- Task 1 Test 7: collectIndexNames handles empty/missing sub-collections --------

test("collectIndexNames returns [] for empty/missing AllIndices shape", () => {
    assert.deepEqual(collectIndexNames({}), []);
    assert.deepEqual(collectIndexNames({ closed: {}, reopened: {}, all: {} }), []);
    assert.deepEqual(
        collectIndexNames({ closed: { indices: [] }, reopened: { indices: [] }, all: { indices: {} } }),
        [],
    );
    // Tolerant of null/undefined for the top level too.
    assert.deepEqual(collectIndexNames(undefined), []);
    assert.deepEqual(collectIndexNames(null), []);
});

// -------- Task 1 Test 8: collectIndexNames deduplicates across sub-collections --------

test("collectIndexNames deduplicates a name appearing in multiple sub-collections", () => {
    // A single physical index may briefly straddle two states during a
    // rotation cycle — Graylog returns it in both closed.indices and all.indices.
    // The collector must dedupe.
    const allIndices = {
        closed: { indices: ["a"] },
        reopened: { indices: ["a"] },
        all: { indices: { a: {} } },
    };
    const names = collectIndexNames(allIndices);
    assert.deepEqual(names, ["a"], "duplicates across sub-collections must collapse");
});

// =====================================================================
// Plan 02-03 — Task 2: delete_index_set handler (INDEX-05)
// =====================================================================
//
// The C1 mitigation centerpiece. delete_index_set composes defineMutatingHandler
// with the wrapper hooks shipped in Plan 02-01 (_confirmationToken forwarding +
// requireConfirm apply-time gate). 12 tests covering every branch:
//
//   1-3:  DeleteIndexSetSchema parse contract (default false, optional confirm)
//   4:    deleteIndices:false dry-run — token-free metadata-only delete (D-03)
//   5:    deleteIndices:true dry-run against empty index set (hash + cascades)
//   6:    deleteIndices:true dry-run against populated index set (different hash)
//   7:    D-05 stats_unreachable hard-block on dry-run
//   8:    ND1 default index set refusal
//   9:    apply with mismatched confirm — wrapper requireConfirm gate refuses
//   10:   apply with correct confirm — fires DELETE; envelope omits job_id
//   11:   writable gate fires BEFORE confirmation gate (D-16)
//   12:   ND1 still refuses default even when deleteIndices:false

import { handleDeleteIndexSet } from "../src/tools/index-sets/delete-index-set.js";
import { DeleteIndexSetSchema } from "../src/tools/index-sets/schemas.js";

const NON_DEFAULT_INDEX_SET = {
    id: "iset-1",
    title: "App errors",
    description: "Stream-routed errors",
    default: false,           // ND1 does NOT fire
    writable: true,
    can_be_default: true,
    index_prefix: "app_errors",
};

const DEFAULT_INDEX_SET = {
    id: "iset-default",
    title: "Default index set",
    description: "Catch-all",
    default: true,            // ND1 fires
    writable: true,
    can_be_default: true,
    index_prefix: "graylog",
};

const EMPTY_INDEX_LIST = {
    closed: { indices: [] },
    reopened: { indices: [] },
    all: { indices: {} },
};

const EMPTY_STATS = { documents: 0, indices: 0, size: 0 };

// -------- Task 2 Test 1: DeleteIndexSetSchema parses minimal valid input --------

test("DeleteIndexSetSchema parses { indexSetId, deleteIndices:false } successfully", () => {
    const result = DeleteIndexSetSchema.safeParse({
        indexSetId: "iset-1",
        deleteIndices: false,
    });
    assert.equal(result.success, true);
    assert.equal(result.data.indexSetId, "iset-1");
    assert.equal(result.data.deleteIndices, false);
});

// -------- Task 2 Test 2: deleteIndices defaults to false (D-04 inverted default) --------

test("DeleteIndexSetSchema defaults deleteIndices to false (D-04 inversion of Graylog @DefaultValue(true))", () => {
    const result = DeleteIndexSetSchema.safeParse({ indexSetId: "iset-1" });
    assert.equal(result.success, true);
    assert.equal(result.data.deleteIndices, false, "MCP wrapper MUST invert Graylog's true-default to false");
});

// -------- Task 2 Test 3: schema accepts optional confirm string --------

test("DeleteIndexSetSchema accepts an optional confirm string (D-01 echo-the-token)", () => {
    const result = DeleteIndexSetSchema.safeParse({
        indexSetId: "iset-1",
        deleteIndices: true,
        confirm: "deadbeef".repeat(8), // 64-hex shape
    });
    assert.equal(result.success, true);
    assert.equal(result.data.confirm, "deadbeef".repeat(8));
    // Absent confirm: still parses (the requireConfirm gate at apply time enforces the echo).
    const result2 = DeleteIndexSetSchema.safeParse({ indexSetId: "iset-1", deleteIndices: true });
    assert.equal(result2.success, true);
    assert.equal(result2.data.confirm, undefined);
});

// -------- Task 2 Test 4: deleteIndices:false dry-run — token-free metadata-only path --------

test("delete_index_set deleteIndices:false dry-run emits the metadata-only path with NO confirmation token (D-03)", async () => {
    _setCaptureRequest(multiCapture([
        { method: "GET", pathPattern: "/api/system/indices/index_sets/iset-1", response: NON_DEFAULT_INDEX_SET },
    ]));
    const res = await handleDeleteIndexSet({
        params: {
            arguments: {
                indexSetId: "iset-1",
                deleteIndices: false,
                _testConnection: "fake",
            },
        },
    });
    assert.notEqual(res.isError, true, `expected success, got: ${res.content?.[0]?.text}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.preview.method, "DELETE");
    assert.equal(
        payload.preview.path,
        "/api/system/indices/index_sets/iset-1?delete_indices=false",
        "metadata-only delete: path ends ?delete_indices=false",
    );
    assert.equal(payload.preview.body, undefined);
    // Token-free, cascade-free, async-envelope-free per D-03.
    assert.equal(payload.confirmationToken, undefined, "no token for the safe metadata-only path");
    assert.equal(payload.cascades, undefined, "no cascades for the safe metadata-only path");
    assert.equal(payload.postApplyEstimate.deletedIndices, false);
});

// -------- Task 2 Test 5: deleteIndices:true dry-run against empty index set (hash + cascades) --------

test("delete_index_set deleteIndices:true dry-run against an empty index set emits confirmation token + empty cascades + UPDATED D-15 no-job_id envelope", async () => {
    _setCaptureRequest(multiCapture([
        { method: "GET", pathPattern: "/api/system/indices/index_sets/iset-1", response: NON_DEFAULT_INDEX_SET },
        { method: "GET", pathPattern: "/api/system/indexer/indices/iset-1/list", response: EMPTY_INDEX_LIST },
        { method: "GET", pathPattern: "/api/system/indices/index_sets/iset-1/stats", response: EMPTY_STATS },
    ]));
    const res = await handleDeleteIndexSet({
        params: {
            arguments: {
                indexSetId: "iset-1",
                deleteIndices: true,
                _testConnection: "fake",
            },
        },
    });
    assert.notEqual(res.isError, true, `expected success, got: ${res.content?.[0]?.text}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.method, "DELETE");
    assert.equal(payload.preview.path, "/api/system/indices/index_sets/iset-1?delete_indices=true");
    // confirmationToken is a 64-hex sha-256.
    assert.equal(payload.confirmationToken.length, 64);
    assert.match(payload.confirmationToken, /^[a-f0-9]{64}$/);
    // Expected frozen value for { indexSetId: "iset-1", deleteIndices: true, indexNames: [], messageCount: 0 }.
    assert.equal(
        payload.confirmationToken,
        "ed22c223ab80ce359fbb3d00b3ca46a76f99cbe07a658c1f3a3e644c5c337d1d",
        "empty-index-set hash drift — canonicalization regression",
    );
    // Cascades: empty index list, zero count.
    assert.deepEqual(payload.cascades.indices, []);
    assert.equal(payload.cascades.messageCount, 0);
    assert.equal(payload.cascades.indexCount, 0);
    // UPDATED D-15 envelope shape: async:true, observable_at, indexSetId in message, NO job_id.
    assert.equal(payload.postApplyEstimate.async, true);
    assert.equal(payload.postApplyEstimate.job_id_observable_at, "/system/jobs");
    assert.ok(
        typeof payload.postApplyEstimate.message === "string"
            && payload.postApplyEstimate.message.includes("iset-1"),
        `message must include the indexSetId substring; got ${payload.postApplyEstimate.message}`,
    );
    assert.equal(
        payload.postApplyEstimate.job_id,
        undefined,
        "UPDATED D-15: job_id MUST be absent (Graylog DELETE returns 204 with no body)",
    );
});

// -------- Task 2 Test 6: deleteIndices:true against populated index set — different hash --------

test("delete_index_set deleteIndices:true dry-run against a populated index set surfaces real cascades + a different hash", async () => {
    const POPULATED_INDEX_LIST = {
        closed: { indices: ["graylog_0"] },
        reopened: { indices: ["graylog_1"] },
        all: { indices: { graylog_2: { active: true } } },
    };
    const POPULATED_STATS = { documents: 12345, indices: 3, size: 99999 };
    _setCaptureRequest(multiCapture([
        { method: "GET", pathPattern: "/api/system/indices/index_sets/iset-1", response: NON_DEFAULT_INDEX_SET },
        { method: "GET", pathPattern: "/api/system/indexer/indices/iset-1/list", response: POPULATED_INDEX_LIST },
        { method: "GET", pathPattern: "/api/system/indices/index_sets/iset-1/stats", response: POPULATED_STATS },
    ]));
    const res = await handleDeleteIndexSet({
        params: {
            arguments: {
                indexSetId: "iset-1",
                deleteIndices: true,
                _testConnection: "fake",
            },
        },
    });
    assert.notEqual(res.isError, true);
    const payload = JSON.parse(res.content[0].text);
    // Cascade names sorted, messageCount + indexCount accurate.
    assert.deepEqual(payload.cascades.indices, ["graylog_0", "graylog_1", "graylog_2"]);
    assert.equal(payload.cascades.messageCount, 12345);
    assert.equal(payload.cascades.indexCount, 3);
    // Different fixture from Test 5 → different hash (proves sensitivity to inputs).
    assert.notEqual(
        payload.confirmationToken,
        "ed22c223ab80ce359fbb3d00b3ca46a76f99cbe07a658c1f3a3e644c5c337d1d",
        "populated-index-set hash MUST differ from the empty-index-set hash",
    );
    // Expected frozen value for the populated fixture.
    assert.equal(
        payload.confirmationToken,
        "d5f10faaada8fc8f558b1a53cc8777a83fd73fa9172aa65fb36728ff246583c0",
        "populated-index-set hash drift — canonicalization regression",
    );
});

// -------- Task 2 Test 7: D-05 stats_unreachable hard-blocks dry-run --------

test("delete_index_set deleteIndices:true HARD-BLOCKS dry-run when /stats throws (D-05 stats_unreachable)", async () => {
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/indices/index_sets/iset-1") return NON_DEFAULT_INDEX_SET;
        if (req.method === "GET" && req.path === "/api/system/indexer/indices/iset-1/list") return EMPTY_INDEX_LIST;
        if (req.method === "GET" && req.path === "/api/system/indices/index_sets/iset-1/stats") {
            // Simulate a 500 from Elasticsearch — the failure must HARD-BLOCK
            // dry-run, NOT degrade-and-proceed (Plan-02-03 D-05 is a deliberate
            // safety choice).
            throw new GraylogNotFoundError("Stats unreachable", { status: 500, method: "GET", path: req.path });
        }
        throw new Error(`unexpected req: ${req.method} ${req.path}`);
    });
    const res = await handleDeleteIndexSet({
        params: {
            arguments: {
                indexSetId: "iset-1",
                deleteIndices: true,
                _testConnection: "fake",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /stats_unreachable/);
    // NO confirmation token issued — the agent must not see a token from the
    // wrapper before knowing the destruction blast radius.
    const parsed = (() => { try { return JSON.parse(res.content[0].text); } catch { return null; } })();
    if (parsed && parsed.confirmationToken !== undefined) {
        assert.fail("stats_unreachable response MUST NOT carry a confirmationToken");
    }
});

// -------- Task 2 Test 8: ND1 — default index set refused outright --------

test("delete_index_set deleteIndices:true against the default index set is refused with reason default_index_set_undeletable (ND1)", async () => {
    _setCaptureRequest(multiCapture([
        { method: "GET", pathPattern: "/api/system/indices/index_sets/iset-default", response: DEFAULT_INDEX_SET },
    ]));
    const res = await handleDeleteIndexSet({
        params: {
            arguments: {
                indexSetId: "iset-default",
                deleteIndices: true,
                _testConnection: "fake",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /default_index_set_undeletable/);
});

// -------- Task 2 Test 9: apply with mismatched confirm — requireConfirm gate refuses --------

test("delete_index_set apply with mismatched confirm returns isError reason confirmation_mismatch — DELETE never fires", async () => {
    let deleteCallCount = 0;
    _setCaptureRequest((req) => {
        if (req.method === "DELETE") {
            deleteCallCount += 1;
            return null; // 204 no body
        }
        if (req.method === "GET" && req.path === "/api/system/indices/index_sets/iset-1") return NON_DEFAULT_INDEX_SET;
        if (req.method === "GET" && req.path === "/api/system/indexer/indices/iset-1/list") return EMPTY_INDEX_LIST;
        if (req.method === "GET" && req.path === "/api/system/indices/index_sets/iset-1/stats") return EMPTY_STATS;
        throw new Error(`unexpected req: ${req.method} ${req.path}`);
    });
    const res = await handleDeleteIndexSet({
        params: {
            arguments: {
                indexSetId: "iset-1",
                deleteIndices: true,
                confirm: "this-is-the-wrong-hash",
                dryRun: false,
                _testConnection: "fake",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /confirmation_mismatch/);
    assert.equal(res.reason, "confirmation_mismatch");
    assert.equal(deleteCallCount, 0, "DELETE MUST NOT fire when the confirmation gate refuses");
});

// -------- Task 2 Test 10: apply with correct confirm — fires DELETE; envelope omits job_id --------

test("delete_index_set apply with correct confirm fires DELETE and returns UPDATED D-15 envelope with NO job_id", async () => {
    let deletePath = null;
    _setCaptureRequest((req) => {
        if (req.method === "DELETE" && req.path.startsWith("/api/system/indices/index_sets/iset-1")) {
            deletePath = req.path;
            return null; // Graylog DELETE returns 204 no body.
        }
        if (req.method === "GET" && req.path === "/api/system/indices/index_sets/iset-1") return NON_DEFAULT_INDEX_SET;
        if (req.method === "GET" && req.path === "/api/system/indexer/indices/iset-1/list") return EMPTY_INDEX_LIST;
        if (req.method === "GET" && req.path === "/api/system/indices/index_sets/iset-1/stats") return EMPTY_STATS;
        throw new Error(`unexpected req: ${req.method} ${req.path}`);
    });
    const correctHash = "ed22c223ab80ce359fbb3d00b3ca46a76f99cbe07a658c1f3a3e644c5c337d1d";
    const res = await handleDeleteIndexSet({
        params: {
            arguments: {
                indexSetId: "iset-1",
                deleteIndices: true,
                confirm: correctHash,
                dryRun: false,
                _testConnection: "fake",
            },
        },
    });
    assert.notEqual(res.isError, true, `expected success, got: ${res.content?.[0]?.text}`);
    assert.equal(deletePath, "/api/system/indices/index_sets/iset-1?delete_indices=true");
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    // UPDATED D-15 envelope: async, observable_at, message includes indexSetId, NO job_id.
    const body = payload.result.body;
    assert.equal(body.async, true);
    assert.equal(body.job_id_observable_at, "/system/jobs");
    assert.ok(
        typeof body.message === "string" && body.message.includes("iset-1"),
        `apply message must include indexSetId; got: ${body.message}`,
    );
    assert.equal(body.job_id, undefined, "UPDATED D-15: job_id MUST be absent from apply envelope");
});

// -------- Task 2 Test 11: writable gate fires BEFORE confirmation gate (D-16) --------

test("delete_index_set writable gate fires BEFORE the confirmation gate — read-only connection refuses with NO pre-flight GETs (D-16)", async () => {
    let captureCount = 0;
    _setCaptureRequest((req) => {
        captureCount += 1;
        throw new Error(`captureFn must NOT be called when writable gate fires; got ${req.method} ${req.path}`);
    });
    _setConnectionsForTests({
        readonly: { baseUrl: "x", apiToken: "x", writable: false },
    });
    const res = await handleDeleteIndexSet({
        params: {
            arguments: {
                indexSetId: "iset-1",
                deleteIndices: true,
                confirm: "any-hash",
                connectionName: "readonly",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "connection_read_only");
    assert.equal(captureCount, 0, "writable gate MUST short-circuit before any pre-flight GET fires");
});

// -------- Task 2 Test 12: ND1 still refuses default even with deleteIndices:false --------

test("delete_index_set ND1 refuses the default index set even when deleteIndices:false", async () => {
    // Graylog's BadRequestException("Default index set cannot be deleted!")
    // fires regardless of the delete_indices query param value. The wrapper
    // surfaces this in dry-run BEFORE the metadata-only path commits — the
    // user might assume the metadata-only path is harmless, but the server
    // still 400s, so the wrapper-side ND1 check fires first.
    _setCaptureRequest(multiCapture([
        { method: "GET", pathPattern: "/api/system/indices/index_sets/iset-default", response: DEFAULT_INDEX_SET },
    ]));
    const res = await handleDeleteIndexSet({
        params: {
            arguments: {
                indexSetId: "iset-default",
                deleteIndices: false,
                _testConnection: "fake",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /default_index_set_undeletable/);
});

// =====================================================================
// Plan 02-04 — Task 1: set_default_index_set handler (INDEX-06)
// =====================================================================
//
// UPDATED D-13 + m2: set_default_index_set pre-flights GET on the target
// index set and reads `can_be_default: boolean` — the server's authoritative
// eligibility flag (absorbs the `regular: true` invariant today AND any
// future eligibility rules Graylog adds). When can_be_default === false
// (events-style or system index set), the dry-run returns isError with
// reason `default_eligibility_failed` BEFORE any PUT fires. This surfaces
// the would-be 409 in dry-run, not apply.
//
//   1: SetDefaultIndexSetSchema parses { indexSetId } -> success; required
//   2: regular index set — dry-run preview with method:PUT + correct path
//   3: ineligible (can_be_default:false) — isError reason default_eligibility_failed; PUT NOT fired
//   4: apply path — script GET + PUT; result.id matches indexSetId
//   5: pre-flight GET 404 propagates as MCP error envelope

import { handleSetDefaultIndexSet } from "../src/tools/index-sets/set-default-index-set.js";
import { SetDefaultIndexSetSchema } from "../src/tools/index-sets/schemas.js";

const ELIGIBLE_REGULAR_INDEX_SET = {
    id: "iset-1",
    title: "Default index set candidate",
    description: "Eligible — regular + can_be_default true",
    default: false,
    writable: true,
    can_be_default: true,
    regular: true,
    index_prefix: "graylog",
};

const INELIGIBLE_EVENTS_INDEX_SET = {
    id: "iset-events",
    title: "Events Index",
    description: "Events / system index — NOT eligible as default",
    default: false,
    writable: true,
    can_be_default: false, // UPDATED D-13: this is the gate the wrapper reads
    regular: false,
    index_prefix: "gl-events",
};

// -------- Task 1 Test 1: SetDefaultIndexSetSchema parse contract --------

test("SetDefaultIndexSetSchema parses { indexSetId } and rejects missing indexSetId", () => {
    const ok = SetDefaultIndexSetSchema.safeParse({ indexSetId: "iset-1" });
    assert.equal(ok.success, true);
    assert.equal(ok.data.indexSetId, "iset-1");
    const bad = SetDefaultIndexSetSchema.safeParse({});
    assert.equal(bad.success, false);
});

// -------- Task 1 Test 2: regular index set dry-run preview --------

test("set_default_index_set against a regular index set emits the PUT dry-run preview with isDefault:true estimate", async () => {
    let putCallCount = 0;
    _setCaptureRequest((req) => {
        if (req.method === "PUT") {
            putCallCount += 1;
            throw new Error(`PUT must NOT fire on dry-run; got ${req.path}`);
        }
        if (req.method === "GET" && req.path === "/api/system/indices/index_sets/iset-1") {
            return ELIGIBLE_REGULAR_INDEX_SET;
        }
        throw new Error(`unexpected req: ${req.method} ${req.path}`);
    });
    const res = await handleSetDefaultIndexSet({
        params: {
            arguments: {
                indexSetId: "iset-1",
                _testConnection: "fake",
            },
        },
    });
    assert.notEqual(res.isError, true, `expected success, got: ${res.content?.[0]?.text}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.preview.method, "PUT");
    assert.equal(payload.preview.path, "/api/system/indices/index_sets/iset-1/default");
    assert.equal(payload.preview.body, undefined, "set-default PUT carries no body");
    assert.equal(payload.postApplyEstimate.id, "iset-1");
    assert.equal(payload.postApplyEstimate.isDefault, true);
    assert.equal(putCallCount, 0, "PUT MUST NOT fire on dry-run");
});

// -------- Task 1 Test 3: ineligible (can_be_default:false) refused with reason default_eligibility_failed --------

test("set_default_index_set against an ineligible (can_be_default:false) index set is refused with reason default_eligibility_failed — PUT never fires (UPDATED D-13 + m2)", async () => {
    let putCallCount = 0;
    _setCaptureRequest((req) => {
        if (req.method === "PUT") {
            putCallCount += 1;
            return null;
        }
        if (req.method === "GET" && req.path === "/api/system/indices/index_sets/iset-events") {
            return INELIGIBLE_EVENTS_INDEX_SET;
        }
        throw new Error(`unexpected req: ${req.method} ${req.path}`);
    });
    const res = await handleSetDefaultIndexSet({
        params: {
            arguments: {
                indexSetId: "iset-events",
                _testConnection: "fake",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /default_eligibility_failed/);
    assert.match(res.content[0].text, /can_be_default/);
    assert.match(res.content[0].text, /Events Index/);
    assert.equal(res.reason, "default_eligibility_failed");
    assert.equal(putCallCount, 0, "PUT MUST NOT fire when wrapper-side eligibility check refuses");
});

// -------- Task 1 Test 4: apply path fires PUT + returns IndexSetResponse --------

test("set_default_index_set apply with dryRun:false fires PUT /default and returns the response body", async () => {
    let putPath = null;
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/indices/index_sets/iset-1") {
            return ELIGIBLE_REGULAR_INDEX_SET;
        }
        if (req.method === "PUT" && req.path === "/api/system/indices/index_sets/iset-1/default") {
            putPath = req.path;
            return { ...ELIGIBLE_REGULAR_INDEX_SET, default: true };
        }
        throw new Error(`unexpected req: ${req.method} ${req.path}`);
    });
    const res = await handleSetDefaultIndexSet({
        params: {
            arguments: {
                indexSetId: "iset-1",
                dryRun: false,
                _testConnection: "fake",
            },
        },
    });
    assert.notEqual(res.isError, true, `expected success, got: ${res.content?.[0]?.text}`);
    assert.equal(putPath, "/api/system/indices/index_sets/iset-1/default");
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    assert.equal(payload.result.id, "iset-1");
    assert.equal(payload.result.body.default, true);
    assert.equal(payload.result.body.title, "Default index set candidate");
});

// -------- Task 1 Test 5: pre-flight GET 404 propagates as MCP error --------

test("set_default_index_set propagates 404 from the pre-flight GET as a clean MCP error envelope", async () => {
    _setCaptureRequest((req) => {
        if (req.method === "GET") {
            throw new GraylogNotFoundError("Index set not found", {
                status: 404,
                method: "GET",
                path: req.path,
            });
        }
        throw new Error(`unexpected req: ${req.method} ${req.path}`);
    });
    const res = await handleSetDefaultIndexSet({
        params: {
            arguments: {
                indexSetId: "missing",
                _testConnection: "fake",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /Index set not found|404/i);
});

// =====================================================================
// Plan 02-04 — Task 2: cycle_deflector handler (INDEX-07)
// =====================================================================
//
// UPDATED D-14 (SYNC_OPTION_A per 02-U1-SMOKE.md) + ND3:
//
// cycle_deflector pre-flights GET on the index set and refuses if
// current.writable === false (ND3 — DeflectorResource.checkCycle throws 400
// if !indexSet.getConfig().isWritable()). The cycle itself is SYNCHRONOUS
// in Graylog 7.0.6 — DeflectorResource.cycle calls indexSet.cycle() directly
// on the JVM thread, NOT via systemJobManager.submit. No system_job_id is
// returned.
//
// Side effect: closed-index range rebuild kicks off as a separate system job
// observable via /system/jobs. The apply envelope deliberately surfaces this
// via side_effects.observable_at so the agent can call await_system_job with
// info_substring on the indexSetId if it cares about the secondary work.
//
//   1: CycleDeflectorSchema parses { indexSetId } -> success; required
//   2: writable index set — dry-run preview with method:POST + side_effects + async:false
//   3: non-writable (writable:false) — isError reason non_writable_index_set; POST NOT fired
//   4: apply path — fires POST; returns { rotated:true, message, side_effects }
//   5: pre-flight GET 404 propagates as MCP error envelope

import { handleCycleDeflector } from "../src/tools/index-sets/cycle-deflector.js";
import { CycleDeflectorSchema } from "../src/tools/index-sets/schemas.js";

const WRITABLE_INDEX_SET = {
    id: "iset-app",
    title: "App errors",
    description: "App-errors index set — writable",
    default: false,
    writable: true,
    can_be_default: true,
    index_prefix: "app_errors",
};

const NON_WRITABLE_INDEX_SET = {
    id: "iset-archive",
    title: "Archive Read Only",
    description: "Archived index set — writable:false",
    default: false,
    writable: false, // ND3 fires
    can_be_default: false,
    index_prefix: "archive",
};

// -------- Task 2 Test 1: CycleDeflectorSchema parse contract --------

test("CycleDeflectorSchema parses { indexSetId } and rejects missing indexSetId", () => {
    const ok = CycleDeflectorSchema.safeParse({ indexSetId: "iset-app" });
    assert.equal(ok.success, true);
    assert.equal(ok.data.indexSetId, "iset-app");
    const bad = CycleDeflectorSchema.safeParse({});
    assert.equal(bad.success, false);
});

// -------- Task 2 Test 2: writable index set dry-run preview (UPDATED D-14 sync) --------

test("cycle_deflector against a writable index set emits the POST dry-run preview with UPDATED D-14 sync semantics + side_effects.observable_at", async () => {
    let postCallCount = 0;
    _setCaptureRequest((req) => {
        if (req.method === "POST") {
            postCallCount += 1;
            throw new Error(`POST must NOT fire on dry-run; got ${req.path}`);
        }
        if (req.method === "GET" && req.path === "/api/system/indices/index_sets/iset-app") {
            return WRITABLE_INDEX_SET;
        }
        throw new Error(`unexpected req: ${req.method} ${req.path}`);
    });
    const res = await handleCycleDeflector({
        params: {
            arguments: {
                indexSetId: "iset-app",
                _testConnection: "fake",
            },
        },
    });
    assert.notEqual(res.isError, true, `expected success, got: ${res.content?.[0]?.text}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.preview.method, "POST");
    assert.equal(payload.preview.path, "/api/system/deflector/iset-app/cycle");
    assert.equal(payload.preview.body, undefined, "cycle POST carries no body");
    // postApplyEstimate per UPDATED D-14 — synchronous + side_effects envelope.
    assert.equal(payload.postApplyEstimate.id, "iset-app");
    assert.equal(payload.postApplyEstimate.async, false, "UPDATED D-14: cycle is SYNCHRONOUS — async:false");
    assert.equal(payload.postApplyEstimate.rotated, true);
    assert.ok(
        typeof payload.postApplyEstimate.message === "string" &&
        (payload.postApplyEstimate.message.includes("Cycled index set") ||
         payload.postApplyEstimate.message.includes("closed previous active index")),
        `expected sync-rotation message; got: ${payload.postApplyEstimate.message}`,
    );
    assert.equal(payload.postApplyEstimate.side_effects.observable_at, "/system/jobs");
    assert.ok(
        typeof payload.postApplyEstimate.side_effects.describes === "string" &&
        (payload.postApplyEstimate.side_effects.describes.includes("range rebuild") ||
         payload.postApplyEstimate.side_effects.describes.includes("IndexRangesUpdateJob")),
        `side_effects.describes must name the range rebuild; got: ${payload.postApplyEstimate.side_effects.describes}`,
    );
    assert.equal(postCallCount, 0, "POST MUST NOT fire on dry-run");
});

// -------- Task 2 Test 3: non-writable refused with reason non_writable_index_set (ND3) --------

test("cycle_deflector against a non-writable index set is refused with reason non_writable_index_set — POST never fires (ND3)", async () => {
    let postCallCount = 0;
    _setCaptureRequest((req) => {
        if (req.method === "POST") {
            postCallCount += 1;
            return null;
        }
        if (req.method === "GET" && req.path === "/api/system/indices/index_sets/iset-archive") {
            return NON_WRITABLE_INDEX_SET;
        }
        throw new Error(`unexpected req: ${req.method} ${req.path}`);
    });
    const res = await handleCycleDeflector({
        params: {
            arguments: {
                indexSetId: "iset-archive",
                _testConnection: "fake",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /non_writable_index_set/);
    assert.match(res.content[0].text, /Archive Read Only/);
    assert.equal(res.reason, "non_writable_index_set");
    assert.equal(postCallCount, 0, "POST MUST NOT fire when wrapper-side ND3 check refuses");
});

// -------- Task 2 Test 4: apply path fires POST + returns sync envelope --------

test("cycle_deflector apply with dryRun:false fires POST /cycle and returns the UPDATED D-14 sync envelope { rotated:true, message, side_effects }", async () => {
    let postPath = null;
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/indices/index_sets/iset-app") {
            return WRITABLE_INDEX_SET;
        }
        if (req.method === "POST" && req.path === "/api/system/deflector/iset-app/cycle") {
            postPath = req.path;
            return null; // 204 no body — Graylog DeflectorResource.cycle is void
        }
        throw new Error(`unexpected req: ${req.method} ${req.path}`);
    });
    const res = await handleCycleDeflector({
        params: {
            arguments: {
                indexSetId: "iset-app",
                dryRun: false,
                _testConnection: "fake",
            },
        },
    });
    assert.notEqual(res.isError, true, `expected success, got: ${res.content?.[0]?.text}`);
    assert.equal(postPath, "/api/system/deflector/iset-app/cycle");
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    // UPDATED D-14 apply envelope: rotated:true, message, side_effects (NO async wrapping, NO job_id).
    const body = payload.result.body;
    assert.equal(body.rotated, true);
    assert.ok(
        typeof body.message === "string" && body.message.includes("iset-app"),
        `apply message must include indexSetId; got: ${body.message}`,
    );
    assert.equal(body.side_effects.observable_at, "/system/jobs");
    assert.ok(
        typeof body.side_effects.describes === "string" &&
        body.side_effects.describes.length > 0,
        "apply must carry side_effects.describes",
    );
    // Critical: no D-15-style async wrapping on the apply envelope.
    assert.equal(body.async, undefined, "UPDATED D-14 sync envelope: no async:true wrapping");
    assert.equal(body.job_id, undefined, "no job_id — cycle is synchronous");
});

// -------- Task 2 Test 5: pre-flight GET 404 propagates as MCP error --------

test("cycle_deflector propagates 404 from the pre-flight GET as a clean MCP error envelope", async () => {
    _setCaptureRequest((req) => {
        if (req.method === "GET") {
            throw new GraylogNotFoundError("Index set not found", {
                status: 404,
                method: "GET",
                path: req.path,
            });
        }
        throw new Error(`unexpected req: ${req.method} ${req.path}`);
    });
    const res = await handleCycleDeflector({
        params: {
            arguments: {
                indexSetId: "missing",
                _testConnection: "fake",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /Index set not found|404/i);
});
