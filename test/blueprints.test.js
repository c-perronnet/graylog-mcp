// Plan 06-04 — Blueprints A tests (BLUE-04/05/06).
//
// Covers:
//   - BLUE-05 setup_long_term_archival_index: 1-step chain shape,
//     SizeBasedRotation + DeletionRetention FQCN wire, retentionDays →
//     max_number_of_indices mapping, slugified indexPrefix default, zod
//     bounds, apply walks the chain via executeChain.
//   - BLUE-06 setup_debug_log_dropping: 3-step chain shape, syslog level
//     inversion in rule source, pipeline references rule by title, step 3
//     placeholder + dependsOn for pipeline id, apply-time substitution,
//     zod bounds on minLevel.
//   - (Task 3) BLUE-04 setup_pipeline_for_stream — appends below
//
// Test patterns mirror test/dashboards.test.js + test/blueprint-chain.test.js:
//   - _testConnection seam + _setCaptureRequest mocks substitute for axios.
//   - zod rejections tested via direct handler invocation (isError + message).
//   - Multi-route mocks for apply-path tests so each step gets a deterministic
//     response (used to assert substitution).

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./snapshot-config.js";

import { handleSetupLongTermArchivalIndex } from "../src/tools/blueprints/setup-long-term-archival-index.js";
import { handleSetupDebugLogDropping } from "../src/tools/blueprints/setup-debug-log-dropping.js";

import {
    SetupLongTermArchivalIndexSchema,
    SetupDebugLogDroppingSchema,
} from "../src/tools/blueprints/schemas.js";

import {
    _setCaptureRequest,
    _clearCaptureRequest,
} from "../src/graylog/client.js";
import {
    _clearConnectionsForTests,
    setActiveConnection,
} from "../src/config.js";

beforeEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
});

afterEach(() => {
    _clearCaptureRequest();
    _clearConnectionsForTests();
    setActiveConnection(null);
});

// Multi-route capture for handlers whose apply walks an N-step chain.
// Each route matches by method + path-pattern (string or regex) and
// returns a response (object or function-of-request).
function multiCapture(routes) {
    const calls = [];
    const fn = (req) => {
        calls.push(req);
        for (const r of routes) {
            const matches = typeof r.pathPattern === "string"
                ? req.path === r.pathPattern
                : (r.pathPattern instanceof RegExp ? r.pathPattern.test(req.path) : false);
            if (req.method === r.method && matches) {
                return typeof r.response === "function" ? r.response(req) : r.response;
            }
        }
        throw new Error(`No route matched ${req.method} ${req.path}`);
    };
    fn.calls = calls;
    return fn;
}

// =====================================================================
// BLUE-05 — setup_long_term_archival_index
// =====================================================================

test("setup_long_term_archival_index dry-run emits 1-step chain (BLUE-05)", async () => {
    const res = await handleSetupLongTermArchivalIndex({
        params: {
            arguments: {
                _testConnection: "fake",
                name: "payment-service-archive",
                retentionDays: 30,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "setup_long_term_archival_index");
    assert.equal(payload.dryRun, true);
    assert.ok(Array.isArray(payload.chain), "chain must be an array");
    assert.equal(payload.chain.length, 1);
    assert.equal(payload.chain[0].step, 1);
    assert.equal(payload.chain[0].tool, "create_index_set");
    assert.equal(payload.chain[0].request.method, "POST");
    assert.equal(payload.chain[0].request.path, "/api/system/indices/index_sets");
});

test("setup_long_term_archival_index body wires SizeBasedRotationStrategyConfig + DeletionRetentionStrategyConfig FQCNs", async () => {
    const res = await handleSetupLongTermArchivalIndex({
        params: {
            arguments: {
                _testConnection: "fake",
                name: "appstore-archive",
                retentionDays: 365,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    const body = payload.chain[0].request.body;
    assert.equal(
        body.rotation_strategy_class,
        "org.graylog2.indexer.rotation.strategies.SizeBasedRotationStrategyConfig",
    );
    assert.equal(
        body.rotation_strategy.type,
        "org.graylog2.indexer.rotation.strategies.SizeBasedRotationStrategyConfig",
    );
    assert.equal(body.rotation_strategy.max_size, 1_073_741_824);  // 1 GiB
    assert.equal(
        body.retention_strategy_class,
        "org.graylog2.indexer.retention.strategies.DeletionRetentionStrategyConfig",
    );
    assert.equal(
        body.retention_strategy.type,
        "org.graylog2.indexer.retention.strategies.DeletionRetentionStrategyConfig",
    );
});

test("setup_long_term_archival_index DeletionRetention.max_number_of_indices === retentionDays", async () => {
    const res = await handleSetupLongTermArchivalIndex({
        params: {
            arguments: {
                _testConnection: "fake",
                name: "metrics-archive",
                retentionDays: 30,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.chain[0].request.body.retention_strategy.max_number_of_indices, 30);
});

test("setup_long_term_archival_index slugifies name into index_prefix when indexPrefix not supplied", async () => {
    const res = await handleSetupLongTermArchivalIndex({
        params: {
            arguments: {
                _testConnection: "fake",
                name: "Payment Service Archive",
                retentionDays: 7,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.chain[0].request.body.index_prefix, "payment_service_archive");
});

test("setup_long_term_archival_index zod rejects retentionDays:0 and retentionDays:36501", async () => {
    const zero = await handleSetupLongTermArchivalIndex({
        params: { arguments: { _testConnection: "fake", name: "x", retentionDays: 0 } },
    });
    assert.equal(zero.isError, true);
    assert.match(zero.content[0].text, /retentionDays/i);

    const tooBig = await handleSetupLongTermArchivalIndex({
        params: { arguments: { _testConnection: "fake", name: "x", retentionDays: 36501 } },
    });
    assert.equal(tooBig.isError, true);
    assert.match(tooBig.content[0].text, /retentionDays/i);
});

test("setup_long_term_archival_index apply walks chain via executeChain and returns final response", async () => {
    const route = multiCapture([
        {
            method: "POST",
            pathPattern: "/api/system/indices/index_sets",
            response: { id: "ix-1", title: "metrics-archive" },
        },
    ]);
    _setCaptureRequest(route);

    const res = await handleSetupLongTermArchivalIndex({
        params: {
            arguments: {
                _testConnection: "fake",
                name: "metrics-archive",
                retentionDays: 7,
                dryRun: false,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, false);
    assert.equal(payload.applied, true);
    assert.equal(payload.result.id, "ix-1");
    // Exactly one HTTP call (the 1-step chain).
    assert.equal(route.calls.length, 1);
});

// =====================================================================
// BLUE-06 — setup_debug_log_dropping
// =====================================================================

test("setup_debug_log_dropping dry-run emits 3-step chain (BLUE-06)", async () => {
    const res = await handleSetupDebugLogDropping({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "stream-1",
                minLevel: 6,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "setup_debug_log_dropping");
    assert.ok(Array.isArray(payload.chain));
    assert.equal(payload.chain.length, 3);
    assert.equal(payload.chain[0].tool, "create_pipeline_rule");
    assert.equal(payload.chain[1].tool, "create_pipeline");
    assert.equal(payload.chain[2].tool, "connect_pipelines_to_stream");
});

test("setup_debug_log_dropping step 1 rule source uses level > minLevel (syslog inversion)", async () => {
    const res = await handleSetupDebugLogDropping({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "stream-1",
                minLevel: 6,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    const ruleSource = payload.chain[0].request.body.source;
    assert.match(ruleSource, /level > 6/);          // syslog-inversion predicate
    assert.match(ruleSource, /drop_message\(\)/);   // the then-action
});

test("setup_debug_log_dropping step 2 pipeline source references rule by title", async () => {
    const res = await handleSetupDebugLogDropping({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "stream-1",
                minLevel: 6,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    const pipelineSource = payload.chain[1].request.body.source;
    assert.match(pipelineSource, /rule "drop_sub_6"/);
});

test("setup_debug_log_dropping step 3 connects pipeline to stream with placeholder for pipelineId", async () => {
    const res = await handleSetupDebugLogDropping({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "stream-XYZ",
                minLevel: 4,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    const step3 = payload.chain[2];
    assert.equal(step3.request.body.stream_id, "stream-XYZ");
    assert.equal(step3.request.body.pipeline_ids[0], "__SERVER_ASSIGNED__step2");
    assert.equal(step3.dependsOn.from, "step2.response.id");
    assert.equal(step3.dependsOn.as, "pipeline_ids[0]");
});

test("setup_debug_log_dropping apply substitutes step 2 pipeline id into step 3 body", async () => {
    const route = multiCapture([
        {
            method: "POST",
            pathPattern: "/api/system/pipelines/rule",
            response: { id: "r-1", title: "drop_sub_6" },
        },
        {
            method: "POST",
            pathPattern: "/api/system/pipelines/pipeline",
            response: { id: "p-1", title: "Drop sub-6 for stream stream-1" },
        },
        {
            method: "POST",
            pathPattern: "/api/system/pipelines/connections/to_stream",
            response: { stream_id: "stream-1", pipeline_ids: ["p-1"] },
        },
    ]);
    _setCaptureRequest(route);

    const res = await handleSetupDebugLogDropping({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "stream-1",
                minLevel: 6,
                dryRun: false,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    // 3 HTTP calls fired; step 3 body must contain the real pipeline id, not the placeholder.
    assert.equal(route.calls.length, 3);
    const step3Call = route.calls[2];
    assert.equal(step3Call.method, "POST");
    assert.equal(step3Call.path, "/api/system/pipelines/connections/to_stream");
    assert.deepEqual(step3Call.body, {
        stream_id: "stream-1",
        pipeline_ids: ["p-1"],
    });
});

test("setup_debug_log_dropping zod rejects minLevel:8 and minLevel:-1", async () => {
    const high = await handleSetupDebugLogDropping({
        params: { arguments: { _testConnection: "fake", streamId: "s-1", minLevel: 8 } },
    });
    assert.equal(high.isError, true);
    assert.match(high.content[0].text, /minLevel/i);

    const neg = await handleSetupDebugLogDropping({
        params: { arguments: { _testConnection: "fake", streamId: "s-1", minLevel: -1 } },
    });
    assert.equal(neg.isError, true);
    assert.match(neg.content[0].text, /minLevel/i);
});

// =====================================================================
// Services-layer compose contract (D-09).
// Covers BLUE-05 + BLUE-06 after Task 2. Task 3 will extend with BLUE-04.
// =====================================================================

test("BLUE-05/06 source files import ONLY from src/services/* (D-09 contract)", () => {
    const files = [
        "src/tools/blueprints/setup-long-term-archival-index.js",
        "src/tools/blueprints/setup-debug-log-dropping.js",
    ];
    for (const file of files) {
        const src = readFileSync(file, "utf8");
        const tools = /from\s+['"]([^'"]*\/tools\/[^'"]+)['"]/g;
        let match;
        const offenders = [];
        while ((match = tools.exec(src)) !== null) {
            const importPath = match[1];
            // Allowed: imports from ../_shared/* (cross-cutting helpers).
            if (!importPath.includes("_shared")) {
                offenders.push(importPath);
            }
        }
        assert.deepEqual(
            offenders,
            [],
            `${file} must not import from src/tools/<domain>/; offenders: ${offenders.join(", ")}`,
        );
    }
});

// =====================================================================
// Schema parity sanity (defense-in-depth — exported schema is a contract)
// =====================================================================

test("SetupLongTermArchivalIndexSchema rejects missing name", () => {
    assert.throws(
        () => SetupLongTermArchivalIndexSchema.parse({ retentionDays: 30 }),
        (err) => err?.name === "ZodError",
    );
});

test("SetupDebugLogDroppingSchema rejects non-integer minLevel", () => {
    assert.throws(
        () => SetupDebugLogDroppingSchema.parse({ streamId: "s-1", minLevel: 3.5 }),
        (err) => err?.name === "ZodError",
    );
});
