// Plan 06-04 — Blueprints A tests (BLUE-04/05/06).
//
// Covers:
//   - BLUE-05 setup_long_term_archival_index: 1-step chain shape,
//     SizeBasedRotation + DeletionRetention FQCN wire, retentionDays →
//     max_number_of_indices mapping, slugified indexPrefix default, zod
//     bounds, apply walks the chain via executeChain.
//   - (Task 2) BLUE-06 setup_debug_log_dropping  — appends below
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

import {
    SetupLongTermArchivalIndexSchema,
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
// Services-layer compose contract (D-09 / Task 1 done-criterion).
// Per-blueprint slice: BLUE-05 file only. Tasks 2-3 will extend this.
// =====================================================================

test("BLUE-05 source file imports ONLY from src/services/* (D-09 contract)", () => {
    const file = "src/tools/blueprints/setup-long-term-archival-index.js";
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
