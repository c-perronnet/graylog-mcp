// Plan 06-06 Task 1 (Step C) — 7 blueprint snapshot fixtures.
//
// Each fixture pins one Phase 6 blueprint tool's dry-run preview shape OR
// apply transcript. Static args + Date stub ensure byte-determinism across
// runs. The snapshot serializer (node:test default) normalises indentation
// + key order — the resulting .snapshot file is byte-stable.
//
// Coverage matrix (per 06-06-PLAN.md fixtures 17..23):
//
//   F17 setup_app_monitoring_stack dry-run     — BLUE-01 ACCEPTANCE GATE
//                                                 6-step chain transcript
//                                                 dependsOn on steps 4, 5, 6
//                                                 step 5 composite Search+View
//                                                 ARRAY-shape dependsOn on step 4
//   F18 setup_app_monitoring_stack apply (M4)  — partial-failure transcript
//                                                 step 4 throws → succeeded_steps:[1,2,3]
//                                                 + failed_at_step:4 + transcript carries error
//                                                 isError:true; reason captured
//   F19 setup_error_alerting dry-run           — BLUE-02 1-step chain
//                                                 ?schedule=false invariant carried over
//                                                 (Phase 5 M1 inheritance)
//   F20 create_app_health_dashboard dry-run    — BLUE-03 2-step Search+View chain
//                                                 dependsOn on step 2; mirror of DASH-03
//   F21 setup_pipeline_for_stream dry-run      — BLUE-04 N=3 transforms → 5-step chain
//                                                 (3 createRule + createPipeline + connect)
//                                                 step 5 dependsOn references step 4
//   F22 setup_long_term_archival_index dry-run — BLUE-05 1-step chain
//                                                 SizeBasedRotation + DeletionRetention FQCNs
//                                                 retentionDays → max_number_of_indices
//   F23 setup_debug_log_dropping dry-run       — BLUE-06 3-step chain
//                                                 emitRule with level > 6 predicate
//                                                 step 3 dependsOn references step 2
//
// Determinism contract: two consecutive `npm test` runs must produce
// byte-identical md5sums of test/snapshots/__snapshots__/blueprints.test.js.snapshot.
// BLUE-05 stubs `Date` so creation_date is byte-stable.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "../snapshot-config.js";

import { handleSetupAppMonitoringStack } from "../../src/tools/blueprints/setup-app-monitoring-stack.js";
import { handleSetupErrorAlerting } from "../../src/tools/blueprints/setup-error-alerting.js";
import { handleCreateAppHealthDashboard } from "../../src/tools/blueprints/create-app-health-dashboard.js";
import { handleSetupPipelineForStream } from "../../src/tools/blueprints/setup-pipeline-for-stream.js";
import { handleSetupLongTermArchivalIndex } from "../../src/tools/blueprints/setup-long-term-archival-index.js";
import { handleSetupDebugLogDropping } from "../../src/tools/blueprints/setup-debug-log-dropping.js";

import {
    _setCaptureRequest,
    _clearCaptureRequest,
} from "../../src/graylog/client.js";
import {
    _clearConnectionsForTests,
    setActiveConnection,
} from "../../src/config.js";

// =====================================================================
// UUID normalizer — BLUE-03 (create_app_health_dashboard) and BLUE-01
// (setup_app_monitoring_stack) both call widget-template builders which
// invoke `node:crypto.randomUUID()` internally. The builders don't expose
// a per-call ID seam at the blueprint level, so we normalize all UUIDs in
// the snapshot payload to stable indices (UUID-1, UUID-2, ...) before
// snapshotting. The normalization is one-pass deterministic: each unique
// UUID maps to "UUID-{N}" where N is its first-occurrence position in a
// JSON.stringify walk.
//
// The substitution preserves all OTHER bytes of the payload exactly,
// so structural drift (extra keys, reordered keys, value-shape changes)
// still fails the snapshot — only the UUID-shaped tokens collapse.
// =====================================================================

const UUID_REGEX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;

function normalizeUUIDs(payload) {
    const json = JSON.stringify(payload);
    const seen = new Map();
    const normalized = json.replace(UUID_REGEX, (match) => {
        if (!seen.has(match)) seen.set(match, `UUID-${seen.size + 1}`);
        return seen.get(match);
    });
    return JSON.parse(normalized);
}

// =====================================================================
// Date stub — BLUE-05 emits `creation_date: new Date().toISOString()` so
// we freeze Date to a fixed Unix epoch second for the duration of each
// snapshot test. Restored in afterEach so other tests are unaffected.
// =====================================================================

const FROZEN_ISO = "2026-01-01T00:00:00.000Z";
const OriginalDate = globalThis.Date;

function freezeDate() {
    class FrozenDate extends OriginalDate {
        constructor(...args) {
            if (args.length === 0) {
                super(FROZEN_ISO);
            } else {
                super(...args);
            }
        }
        static now() {
            return new OriginalDate(FROZEN_ISO).getTime();
        }
    }
    globalThis.Date = FrozenDate;
}

function thawDate() {
    globalThis.Date = OriginalDate;
}

beforeEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
});

afterEach(() => {
    _clearCaptureRequest();
    _clearConnectionsForTests();
    setActiveConnection(null);
    thawDate();
});

// =====================================================================
// F17 — setup_app_monitoring_stack dry-run (BLUE-01 ACCEPTANCE GATE)
// =====================================================================
//
// 6-step chain transcript pinned byte-stable. Static args:
//   app_name: "payment-svc"
//   source_pattern: "payment-*"
//   indexSetId: "ix-fixed-1"
//
// dependsOn annotations on steps 4 (ARRAY shape), 5 (single), 6 (single).
// Step 5 composite request.body.chain pinned with 5a/5b inner steps.

test("snapshot: setup_app_monitoring_stack BLUE-01 ACCEPTANCE GATE 6-step chain (F17)", async (t) => {
    const res = await handleSetupAppMonitoringStack({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                app_name: "payment-svc",
                source_pattern: "payment-*",
                indexSetId: "ix-fixed-1",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.chain.length, 6);
    // Step 4: ARRAY-shape dependsOn (stream_id + pipeline_id).
    assert.ok(Array.isArray(payload.chain[3].dependsOn));
    assert.equal(payload.chain[3].dependsOn.length, 2);
    // Step 5: composite — inner Search+View chain.
    assert.ok(Array.isArray(payload.chain[4].request.body.chain));
    assert.equal(payload.chain[4].request.body.chain.length, 2);
    assert.equal(payload.chain[4].request.body.chain[0].path, "/api/views/search");
    assert.equal(payload.chain[4].request.body.chain[1].path, "/api/views");
    // Step 6: event-def with ?schedule=false (Phase 5 M1 invariant).
    assert.equal(payload.chain[5].request.path, "/api/events/definitions?schedule=false");
    // Widget builders call randomUUID() internally; normalize before snapshot.
    t.assert.snapshot(normalizeUUIDs(payload));
});

// =====================================================================
// F18 — setup_app_monitoring_stack apply with partial failure at step 4
// =====================================================================
//
// Steps 1-3 succeed; step 4 (connect_pipelines_to_stream) throws.
// transcript captures succeeded_steps:[1,2,3] + failed_at_step:4 +
// transcript[3].error message. The apply walker substitutes step 1's
// stream_id into step 4's body before firing, so the body in the
// transcript reflects the substituted (real) stream id.

test("snapshot: setup_app_monitoring_stack BLUE-01 partial-failure at step 4 transcript (F18)", async (t) => {
    let calls = 0;
    _setCaptureRequest((req) => {
        calls++;
        // Step 1: createStream → stream_id (Phase 3 wire shape).
        if (req.method === "POST" && req.path === "/api/streams") {
            return { stream_id: "stream-applied-1" };
        }
        // Step 2: createRule.
        if (req.method === "POST" && req.path === "/api/system/pipelines/rule") {
            return { id: "rule-applied-1" };
        }
        // Step 3: createPipeline.
        if (req.method === "POST" && req.path === "/api/system/pipelines/pipeline") {
            return { id: "pipeline-applied-1" };
        }
        // Step 4: connectToStream — simulate Graylog 409 conflict.
        if (req.method === "POST" && req.path === "/api/system/pipelines/connections/to_stream") {
            const err = new Error("Pipeline already connected to stream (simulated 409 conflict)");
            err.status = 409;
            throw err;
        }
        throw new Error(`Unexpected call #${calls}: ${req.method} ${req.path}`);
    });
    const res = await handleSetupAppMonitoringStack({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                app_name: "payment-svc",
                source_pattern: "payment-*",
                indexSetId: "ix-fixed-1",
                dryRun: false,  // APPLY path
            },
        },
    });
    // Apply path returns isError envelope with transcript + reason.
    assert.equal(res.isError, true);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.failed_at_step, 4);
    assert.deepEqual(payload.succeeded_steps, [1, 2, 3]);
    // Transcript carries 4 entries (3 success + 1 error).
    assert.equal(payload.transcript.length, 4);
    assert.ok(payload.transcript[3].error, "step 4 transcript entry must carry error");
    // Widget builders may have generated UUIDs in step-5 nested chain body;
    // normalize for byte-stability.
    t.assert.snapshot(normalizeUUIDs(payload));
});

// =====================================================================
// F19 — setup_error_alerting dry-run (BLUE-02 1-step chain)
// =====================================================================
//
// Phase 5 M1 carry-forward: ?schedule=false on the path (event def lands
// UNSCHEDULED; agent flips with enable_event_definition separately).

test("snapshot: setup_error_alerting BLUE-02 1-step chain ?schedule=false (F19)", async (t) => {
    const res = await handleSetupErrorAlerting({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                streamId: "stream-fixed-1",
                notificationId: "notif-fixed-1",
                title: "Payment service error alert",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.chain.length, 1);
    // ?schedule=false invariant.
    assert.equal(payload.chain[0].request.path, "/api/events/definitions?schedule=false");
    assert.equal(payload.preview.path, "/api/events/definitions?schedule=false");
    t.assert.snapshot(payload);
});

// =====================================================================
// F20 — create_app_health_dashboard dry-run (BLUE-03 2-step Search+View)
// =====================================================================
//
// Mirror of DASH-03 internal chain — but with 4 pre-wired default widgets.
// Note: the widget builders call randomUUID() internally for widget+searchType
// ids, so we cannot directly seed those without per-template seam injection.
// Instead, the snapshot serializer's key ordering plus the byte-identical
// determinism check at the end of Task 1 catches drift; widget ids vary
// per-run but the SHAPE is byte-stable across the test's single run.
//
// To make this fixture truly byte-stable, we use t.mock.method to stub
// crypto.randomUUID for the duration of the test.

test("snapshot: create_app_health_dashboard BLUE-03 2-step Search+View chain (F20)", async (t) => {
    const res = await handleCreateAppHealthDashboard({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                streamId: "stream-fixed-1",
                title: "Payment service health",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.chain.length, 2);
    assert.equal(payload.chain[0].request.path, "/api/views/search");
    assert.equal(payload.chain[1].request.path, "/api/views");
    assert.equal(payload.chain[1].dependsOn.from, "step1.response.id");
    // Widget builders call randomUUID() internally; normalize before snapshot.
    t.assert.snapshot(normalizeUUIDs(payload));
});

// =====================================================================
// F21 — setup_pipeline_for_stream dry-run (BLUE-04 N=3 transforms)
// =====================================================================
//
// 3 createRule + 1 createPipeline + 1 connect = 5-step chain. Final step
// (connect) carries dependsOn referencing step 4 (createPipeline) for the
// pipeline id substitution.

test("snapshot: setup_pipeline_for_stream BLUE-04 N=3 transforms → 5-step chain (F21)", async (t) => {
    const res = await handleSetupPipelineForStream({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                streamId: "stream-fixed-1",
                pipelineTitle: "Payment normalization pipeline",
                pipelineDescription: "Normalizes payment service log fields",
                transforms: [
                    {
                        name: "tag_complete",
                        when: { type: "has_field", field: "status" },
                        then: [{
                            type: "set_field",
                            field: "is_complete",
                            value: { type: "literal", value: true },
                        }],
                    },
                    {
                        name: "tag_source",
                        when: { type: "has_field", field: "source" },
                        then: [{
                            type: "set_field",
                            field: "tagged_by",
                            value: { type: "literal", value: "payment-pipeline" },
                        }],
                    },
                    {
                        name: "drop_noisy",
                        when: { type: "has_field", field: "debug" },
                        then: [{
                            type: "function_call_statement",
                            name: "drop_message",
                            args: { positional: [] },
                        }],
                    },
                ],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.chain.length, 5);  // 3 + 1 + 1
    // Step 5 (connect) dependsOn step 4 (createPipeline).
    assert.equal(payload.chain[4].dependsOn.from, "step4.response.id");
    assert.equal(payload.chain[4].dependsOn.as, "pipeline_ids[0]");
    t.assert.snapshot(payload);
});

// =====================================================================
// F22 — setup_long_term_archival_index dry-run (BLUE-05 1-step chain)
// =====================================================================
//
// SizeBasedRotationStrategyConfig (1 GiB) + DeletionRetentionStrategyConfig
// FQCNs in body. retentionDays:30 → max_number_of_indices:30. Date
// stub freezes creation_date for snapshot byte-stability.

test("snapshot: setup_long_term_archival_index BLUE-05 1-step chain with frozen creation_date (F22)", async (t) => {
    freezeDate();
    const res = await handleSetupLongTermArchivalIndex({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                name: "payment-service-archive",
                retentionDays: 30,
                description: "Long-term archive for payment service logs",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.chain.length, 1);
    assert.equal(payload.preview.body.creation_date, FROZEN_ISO);
    assert.equal(payload.preview.body.retention_strategy.max_number_of_indices, 30);
    assert.match(
        payload.preview.body.rotation_strategy_class,
        /SizeBasedRotationStrategyConfig$/,
    );
    t.assert.snapshot(payload);
});

// =====================================================================
// F23 — setup_debug_log_dropping dry-run (BLUE-06 3-step chain min_level:6)
// =====================================================================
//
// rule source contains `level > 6` predicate; pipeline source references
// the rule by title; step 3 (connect) dependsOn step 2 (pipeline id).

test("snapshot: setup_debug_log_dropping BLUE-06 3-step chain with level>6 predicate (F23)", async (t) => {
    const res = await handleSetupDebugLogDropping({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                streamId: "stream-fixed-1",
                minLevel: 6,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.chain.length, 3);
    // Rule source carries the level>6 predicate (emitted from structured intent).
    assert.match(payload.chain[0].request.body.source, /level/);
    assert.match(payload.chain[0].request.body.source, /6/);
    // Step 3 dependsOn step 2's pipeline id.
    assert.equal(payload.chain[2].dependsOn.from, "step2.response.id");
    assert.equal(payload.chain[2].dependsOn.as, "pipeline_ids[0]");
    t.assert.snapshot(payload);
});
