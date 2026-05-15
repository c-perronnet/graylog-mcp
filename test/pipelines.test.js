// Plan 04-02 — Phase 4 pipeline CRUD (PIPE-01..PIPE-05).
//
// Covers list_pipelines / get_pipeline / create_pipeline / update_pipeline /
// delete_pipeline. Critical structural invariants under test:
//   - Pitfall 3: every pipeline URL uses the literal `/api/system/pipelines/pipeline/{id}`
//     segment (bare `/api/system/pipelines/{id}` returns 404).
//   - D-06 server-authoritative parse pre-flight: POST /api/system/pipelines/pipeline/parse
//     fires BEFORE the destructive create/update verb. On 400 + Set<ParseError>, the
//     wrapper THROWS GraylogValidationError(reason:"pipeline_parse_failed") and apply
//     NEVER runs (C4 acceptance gate).
//   - Pitfall 6: ParseError carries `positionInLine` (camelCase) on the wire; the
//     wrapper reads it that way but EMITS `position_in_line` (snake_case) per the
//     project convention.
//   - D-16 STRICT_NO_ECHO partial-update: update_pipeline emits only the fields
//     present in args.changes. Parse pre-flight fires ONLY when args.changes.source
//     is set.
//   - D-15 LEAF DELETE: delete_pipeline ships NO cascades key, NO _confirmationToken,
//     and a sync envelope. Pipelines have no `is_editable` field — D-15 documented
//     as "no mutable check on pipelines".
//   - D-17 __SERVER_ASSIGNED__ sentinel surfaces in create_pipeline.postApplyEstimate.id.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";

import { handleListPipelines } from "../src/tools/pipelines/list-pipelines.js";
import { handleGetPipeline } from "../src/tools/pipelines/get-pipeline.js";
import { handleCreatePipeline } from "../src/tools/pipelines/create-pipeline.js";
import { handleUpdatePipeline } from "../src/tools/pipelines/update-pipeline.js";
import { handleDeletePipeline } from "../src/tools/pipelines/delete-pipeline.js";
import {
    ListPipelinesSchema,
    GetPipelineSchema,
    CreatePipelineSchema,
    UpdatePipelineSchema,
    DeletePipelineSchema,
} from "../src/tools/pipelines/schemas.js";
import {
    _setCaptureRequest,
    _clearCaptureRequest,
} from "../src/graylog/client.js";
import {
    _setConnectionsForTests,
    _clearConnectionsForTests,
    setActiveConnection,
} from "../src/config.js";
import {
    GraylogNotFoundError,
    GraylogValidationError,
} from "../src/graylog/errors.js";

beforeEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
    // Plan 04-03 — the per-connection function catalogue is process-lifetime
    // cached (D-03); reset between tests so each create_pipeline_rule /
    // update_pipeline_rule case sees a clean fetch under the captured-request
    // seam. Safe no-op when the catalogue hasn't been populated yet.
    _clearFunctionCatalogueForTests();
});

afterEach(() => {
    _clearCaptureRequest();
    _clearConnectionsForTests();
    setActiveConnection(null);
    _clearFunctionCatalogueForTests();
});

// =====================================================================
// Fixtures — PipelineSource DTO (verified shape per 04-RESEARCH.md
// §"Endpoint Catalogue" + <interfaces> in 04-02-PLAN.md)
// =====================================================================

const FULL_PIPELINE_A = {
    id: "p1",
    title: "App routing",
    description: "Routes app traffic through enrichment stages",
    source: 'pipeline "App routing"\nstage 0 match either\n  rule "enrich-app"\nend',
    created_at: "2026-01-01T00:00:00.000Z",
    modified_at: "2026-01-15T00:00:00.000Z",
    stages: [
        { stage: 0, match: "EITHER", rules: ["enrich-app"] },
    ],
};

const FULL_PIPELINE_B = {
    id: "p2",
    title: "System enrichment",
    description: "",
    source: 'pipeline "System enrichment"\nstage 0 match all\nend',
    created_at: "2026-01-01T00:00:00.000Z",
    modified_at: "2026-01-01T00:00:00.000Z",
    stages: [
        { stage: 0, match: "ALL", rules: [] },
        { stage: 1, match: "PASS", rules: [] },
    ],
};

// MultiCapture helper — mirrors streamsMultiCapture in test/streams.test.js.
function pipelinesMultiCapture(routes) {
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

// =====================================================================
// Schema-layer tests (Task 1 + 2 schemas)
// =====================================================================

test("ListPipelinesSchema extends listBase: accepts connectionName/fields/limit only", () => {
    const parsed = ListPipelinesSchema.parse({
        connectionName: "fake",
        fields: ["id", "title"],
        limit: 10,
    });
    assert.equal(parsed.connectionName, "fake");
    assert.deepEqual(parsed.fields, ["id", "title"]);
    assert.equal(parsed.limit, 10);
});

test("GetPipelineSchema requires pipelineId; empty string rejected", () => {
    assert.throws(() => GetPipelineSchema.parse({ pipelineId: "" }), /pipelineId/);
    assert.throws(() => GetPipelineSchema.parse({}), /pipelineId|required/i);
    const parsed = GetPipelineSchema.parse({ pipelineId: "p1" });
    assert.equal(parsed.pipelineId, "p1");
});

test("DeletePipelineSchema requires pipelineId; empty string rejected", () => {
    assert.throws(() => DeletePipelineSchema.parse({ pipelineId: "" }), /pipelineId/);
    assert.throws(() => DeletePipelineSchema.parse({}), /pipelineId|required/i);
    const parsed = DeletePipelineSchema.parse({ pipelineId: "p1" });
    assert.equal(parsed.pipelineId, "p1");
    assert.equal(parsed.dryRun, true);  // mutatingBase default
});

test("CreatePipelineSchema accepts {title, source} and fills defaults", () => {
    const parsed = CreatePipelineSchema.parse({
        title: "Hello",
        source: 'pipeline "Hello" stage 0 match all end',
    });
    assert.equal(parsed.title, "Hello");
    assert.equal(parsed.source, 'pipeline "Hello" stage 0 match all end');
    assert.equal(parsed.dryRun, true);
});

test("CreatePipelineSchema rejects missing source", () => {
    assert.throws(() => CreatePipelineSchema.parse({ title: "Hello" }), /source/);
});

test("CreatePipelineSchema rejects missing title", () => {
    assert.throws(() => CreatePipelineSchema.parse({ source: 'pipeline "x" stage 0 match all end' }), /title/);
});

test("UpdatePipelineSchema accepts pipelineId + non-empty changes (title)", () => {
    const parsed = UpdatePipelineSchema.parse({
        pipelineId: "p1",
        changes: { title: "new" },
    });
    assert.equal(parsed.pipelineId, "p1");
    assert.deepEqual(parsed.changes, { title: "new" });
});

test("UpdatePipelineSchema accepts empty changes object (STRICT_NO_ECHO minimal body)", () => {
    const parsed = UpdatePipelineSchema.parse({
        pipelineId: "p1",
        changes: {},
    });
    assert.deepEqual(parsed.changes, {});
});

test("UpdatePipelineSchema accepts changes.source", () => {
    const parsed = UpdatePipelineSchema.parse({
        pipelineId: "p1",
        changes: { source: 'pipeline "p" stage 0 match all end' },
    });
    assert.equal(parsed.changes.source, 'pipeline "p" stage 0 match all end');
});

// =====================================================================
// Task 1 — list_pipelines tests
// =====================================================================

test("list_pipelines GET URL is exactly /api/system/pipelines/pipeline (Pitfall 3 literal segment)", async () => {
    let captured = null;
    _setCaptureRequest((req) => {
        captured = req;
        return [FULL_PIPELINE_A, FULL_PIPELINE_B];
    });
    await handleListPipelines({
        params: { arguments: { _testConnection: "fake" } },
    });
    assert.equal(captured.method, "GET");
    assert.equal(captured.path, "/api/system/pipelines/pipeline");
});

test("list_pipelines bare array unwraps and projects stages_count synthetic field", async () => {
    _setCaptureRequest(() => [FULL_PIPELINE_A, FULL_PIPELINE_B]);
    const res = await handleListPipelines({
        params: { arguments: { _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "list_pipelines");
    assert.equal(payload.count, 2);
    assert.deepEqual(
        payload.fields,
        ["id", "title", "description", "stages_count", "created_at", "modified_at"],
    );
    // Pipeline A has 1 stage; Pipeline B has 2.
    assert.equal(payload.items[0].stages_count, 1);
    assert.equal(payload.items[1].stages_count, 2);
});

test("list_pipelines with fields:'all' returns full DTO including source", async () => {
    _setCaptureRequest(() => [FULL_PIPELINE_A]);
    const res = await handleListPipelines({
        params: { arguments: { _testConnection: "fake", fields: "all" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.count, 1);
    assert.equal(payload.items[0].source.length > 0, true);
    assert.equal(payload.items[0].id, "p1");
    // synthetic stages_count is still projected onto the item
    assert.equal(payload.items[0].stages_count, 1);
});

test("list_pipelines item lacking stages array projects stages_count: 0", async () => {
    _setCaptureRequest(() => [{ id: "p3", title: "no stages", description: "", created_at: "x", modified_at: "y" }]);
    const res = await handleListPipelines({
        params: { arguments: { _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.items[0].stages_count, 0);
});

// =====================================================================
// Task 1 — get_pipeline tests
// =====================================================================

test("get_pipeline GET URL is /api/system/pipelines/pipeline/{id} (Pitfall 3)", async () => {
    let captured = null;
    _setCaptureRequest((req) => {
        captured = req;
        return FULL_PIPELINE_A;
    });
    await handleGetPipeline({
        params: { arguments: { _testConnection: "fake", pipelineId: "p1" } },
    });
    assert.equal(captured.method, "GET");
    assert.equal(captured.path, "/api/system/pipelines/pipeline/p1");
});

test("get_pipeline returns the full PipelineSource DTO (no projection)", async () => {
    _setCaptureRequest(() => FULL_PIPELINE_A);
    const res = await handleGetPipeline({
        params: { arguments: { _testConnection: "fake", pipelineId: "p1" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "get_pipeline");
    assert.equal(payload.pipeline.id, "p1");
    assert.equal(payload.pipeline.title, "App routing");
    assert.equal(payload.pipeline.source.length > 0, true);
    assert.equal(payload.pipeline.stages.length, 1);
    assert.equal(payload.pipeline.created_at, "2026-01-01T00:00:00.000Z");
    assert.equal(payload.pipeline.modified_at, "2026-01-15T00:00:00.000Z");
});

test("get_pipeline propagates 404 via wrapGraylogError", async () => {
    _setCaptureRequest(() => {
        throw new GraylogNotFoundError("not found", {
            status: 404,
            method: "GET",
            path: "/api/system/pipelines/pipeline/missing",
            body: null,
        });
    });
    const res = await handleGetPipeline({
        params: { arguments: { _testConnection: "fake", pipelineId: "missing" } },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /404/);
    assert.match(res.content[0].text, /get_pipeline/);
});

// =====================================================================
// Task 1 — delete_pipeline tests (LEAF DELETE per D-15)
// =====================================================================

test("delete_pipeline build() descriptor has NO `cascades` key (leaf delete)", async () => {
    _setCaptureRequest(() => ({}));
    const res = await handleDeletePipeline({
        params: { arguments: { _testConnection: "fake", pipelineId: "p1" } },
    });
    const payload = JSON.parse(res.content[0].text);
    // dry-run preview shape must NOT contain a `cascades` field
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "cascades"), false);
    assert.doesNotMatch(res.content[0].text, /"cascades"/);
});

test("delete_pipeline build() descriptor has NO `_confirmationToken` (no cascade gate)", async () => {
    _setCaptureRequest(() => ({}));
    const res = await handleDeletePipeline({
        params: { arguments: { _testConnection: "fake", pipelineId: "p1" } },
    });
    assert.doesNotMatch(res.content[0].text, /"confirmationToken"/);
});

test("delete_pipeline writable:false short-circuits BEFORE the DELETE fires", async () => {
    const captured = [];
    _setCaptureRequest((req) => {
        captured.push(req);
        return {};
    });
    _setConnectionsForTests({
        readonly: { baseUrl: "http://fake.example", apiToken: "tok", writable: false },
    });
    const res = await handleDeletePipeline({
        params: {
            arguments: {
                connectionName: "readonly",
                pipelineId: "p1",
                dryRun: false,
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "connection_read_only");
    // ZERO requests fired (D-07): the writable gate is in handler.js BEFORE
    // build() so the DELETE never reaches the captured request seam.
    assert.equal(captured.length, 0);
});

test("delete_pipeline DELETE URL is /api/system/pipelines/pipeline/{id} on apply (Pitfall 3)", async () => {
    const captured = [];
    _setCaptureRequest((req) => {
        captured.push(req);
        return {};
    });
    await handleDeletePipeline({
        params: {
            arguments: {
                _testConnection: "fake",
                pipelineId: "p1",
                dryRun: false,
            },
        },
    });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].method, "DELETE");
    assert.equal(captured[0].path, "/api/system/pipelines/pipeline/p1");
});

test("delete_pipeline apply envelope is SYNC (no async:true)", async () => {
    _setCaptureRequest(() => ({}));
    const res = await handleDeletePipeline({
        params: {
            arguments: {
                _testConnection: "fake",
                pipelineId: "p1",
                dryRun: false,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    assert.doesNotMatch(JSON.stringify(payload), /"async":\s*true/);
});

// =====================================================================
// Task 1 — dispatch wiring + tool count tests
// =====================================================================

test("dispatch resolves list_pipelines/get_pipeline/delete_pipeline via the new barrel", async () => {
    const { dispatch } = await import("../src/dispatch.js");
    await import("../src/tools/_register.js");

    _setConnectionsForTests({
        fake: { baseUrl: "http://fake.example", apiToken: "tok" },
    });
    setActiveConnection("fake");
    _setCaptureRequest(() => []);

    const res = await dispatch({ params: { name: "list_pipelines", arguments: {} } });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "list_pipelines");
    assert.ok(Array.isArray(payload.items));
});

test("assertAllToolsRegistered passes after Plan 04-03 Task 2 registers PIPE-06..PIPE-09 (count = 63)", async () => {
    const { dispatch, assertAllToolsRegistered } = await import("../src/dispatch.js");
    await import("../src/tools/_register.js");
    const { toolDefinitions } = await import("../src/tools.js");
    assertAllToolsRegistered(toolDefinitions);
    assert.equal(typeof dispatch, "function");
    // Plan 04-02 left 59 (PIPE-01..PIPE-05); Plan 04-03 Task 2 finishes the
    // pipeline-rule CRUD quartet → 63. If the count drifts, this test fails
    // loudly and we know to update the plan.
    assert.equal(toolDefinitions.length, 63, `Expected 63 tools after Plan 04-03; got ${toolDefinitions.length}`);
});

// =====================================================================
// Task 2 — create_pipeline tests (D-06 parse pre-flight + C4 gate)
// =====================================================================

test("create_pipeline dry-run with valid source: parseResult.ok:true; __SERVER_ASSIGNED__ sentinel", async () => {
    _setCaptureRequest(pipelinesMultiCapture([
        {
            method: "POST",
            pathPattern: "/api/system/pipelines/pipeline/parse",
            response: () => ({ ...FULL_PIPELINE_A, id: undefined }),
        },
        {
            method: "GET",
            pathPattern: "/api/system/pipelines/pipeline",
            response: [],  // no existing pipelines
        },
    ]));
    const res = await handleCreatePipeline({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "App routing",
                source: 'pipeline "App routing" stage 0 match all end',
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.tool, "create_pipeline");
    assert.equal(payload.preview.method, "POST");
    assert.equal(payload.preview.path, "/api/system/pipelines/pipeline");  // Pitfall 3
    assert.equal(payload.preview.body.title, "App routing");
    assert.equal(payload.preview.body.source.includes("App routing"), true);
    assert.equal(payload.postApplyEstimate.id, "__SERVER_ASSIGNED__");
});

test("create_pipeline parse pre-flight URL is /api/system/pipelines/pipeline/parse (Pitfall 3)", async () => {
    const seenPaths = [];
    _setCaptureRequest((req) => {
        seenPaths.push({ method: req.method, path: req.path });
        if (req.method === "POST" && req.path === "/api/system/pipelines/pipeline/parse") {
            return { ...FULL_PIPELINE_A, id: undefined };
        }
        if (req.method === "GET" && req.path === "/api/system/pipelines/pipeline") {
            return [];
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    await handleCreatePipeline({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "X",
                source: 'pipeline "X" stage 0 match all end',
            },
        },
    });
    // parse pre-flight fired with literal pipeline/parse path
    assert.ok(
        seenPaths.some((p) => p.method === "POST" && p.path === "/api/system/pipelines/pipeline/parse"),
        `Expected POST /api/system/pipelines/pipeline/parse; saw ${JSON.stringify(seenPaths)}`,
    );
});

test("create_pipeline C4 ACCEPTANCE GATE: synthetic 400 from parse → reason:pipeline_parse_failed; apply NEVER fires", async () => {
    let postBodyFired = false;
    _setCaptureRequest((req) => {
        if (req.method === "POST" && req.path === "/api/system/pipelines/pipeline/parse") {
            // Synthetic ParseException — 400 + Set<ParseError> body.
            throw new GraylogValidationError("parse failed", {
                status: 400,
                method: "POST",
                path: "/api/system/pipelines/pipeline/parse",
                body: [{ type: "SyntaxError", line: 2, positionInLine: 5, message: "missing end" }],
            });
        }
        if (req.method === "POST" && req.path === "/api/system/pipelines/pipeline") {
            postBodyFired = true;
            return { ...FULL_PIPELINE_A };
        }
        return [];
    });
    const res = await handleCreatePipeline({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "broken",
                source: 'pipeline "broken" stage 0 match all rule "missing-end"',
                dryRun: false,  // attempt apply — should never reach POST /pipeline because parse fails
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "pipeline_parse_failed");
    assert.equal(postBodyFired, false, "POST /pipeline must NOT fire when parse pre-flight 400s");
    // The wrapper's emitted message must surface the L:position context.
    assert.match(res.content[0].text, /pipeline_parse_failed/);
});

test("create_pipeline Pitfall 6: wire positionInLine (camelCase) emits as position_in_line (snake_case)", async () => {
    _setCaptureRequest((req) => {
        if (req.method === "POST" && req.path === "/api/system/pipelines/pipeline/parse") {
            throw new GraylogValidationError("parse failed", {
                status: 400,
                method: "POST",
                path: "/api/system/pipelines/pipeline/parse",
                body: [{ type: "SyntaxError", line: 2, positionInLine: 5, message: "boom" }],
            });
        }
        return [];
    });
    const res = await handleCreatePipeline({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "broken",
                source: "broken",
            },
        },
    });
    // The wrapper's emitted envelope text MUST contain the snake_case projection
    // even though the wire body uses camelCase. The message itself encodes
    // [L<line>:<position_in_line>] type — matching the snake-cased emit.
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /L2:5/);
    assert.match(res.content[0].text, /SyntaxError/);
});

test("create_pipeline M5: existingMatches populated for exact title collision", async () => {
    _setCaptureRequest(pipelinesMultiCapture([
        {
            method: "POST",
            pathPattern: "/api/system/pipelines/pipeline/parse",
            response: () => ({}),
        },
        {
            method: "GET",
            pathPattern: "/api/system/pipelines/pipeline",
            response: [{ id: "p_existing", title: "App routing", description: "" }],
        },
    ]));
    const res = await handleCreatePipeline({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "App routing",
                source: 'pipeline "App routing" stage 0 match all end',
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.existingMatches.length, 1);
    assert.equal(payload.existingMatches[0].id, "p_existing");
    assert.equal(payload.existingMatches[0].title, "App routing");
    assert.equal(payload.existingMatches[0].similarity_reason, "exact");
});

test("create_pipeline writable:false short-circuits BEFORE parse pre-flight fires", async () => {
    const captured = [];
    _setCaptureRequest((req) => {
        captured.push(req);
        return [];
    });
    _setConnectionsForTests({
        readonly: { baseUrl: "http://fake.example", apiToken: "tok", writable: false },
    });
    const res = await handleCreatePipeline({
        params: {
            arguments: {
                connectionName: "readonly",
                title: "X",
                source: 'pipeline "X" stage 0 match all end',
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "connection_read_only");
    assert.equal(captured.length, 0);
});

test("create_pipeline apply on dryRun:false fires POST /pipeline with {title, description, source} once", async () => {
    const captured = [];
    _setCaptureRequest((req) => {
        captured.push(req);
        if (req.method === "POST" && req.path === "/api/system/pipelines/pipeline/parse") {
            return { ...FULL_PIPELINE_A, id: undefined };
        }
        if (req.method === "GET" && req.path === "/api/system/pipelines/pipeline") {
            return [];
        }
        if (req.method === "POST" && req.path === "/api/system/pipelines/pipeline") {
            return { ...FULL_PIPELINE_A, id: "p_new" };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleCreatePipeline({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "App routing",
                description: "Routes app traffic",
                source: 'pipeline "App routing" stage 0 match all end',
                dryRun: false,
            },
        },
    });
    // Exactly one POST /pipeline body (in addition to the parse + list calls)
    const posts = captured.filter((r) => r.method === "POST" && r.path === "/api/system/pipelines/pipeline");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.title, "App routing");
    assert.equal(posts[0].body.description, "Routes app traffic");
    assert.equal(posts[0].body.source.includes("App routing"), true);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    assert.equal(payload.result.id, "p_new");
});

test("create_pipeline idempotency-key is present in dry-run JSON and deterministic", async () => {
    _setCaptureRequest(pipelinesMultiCapture([
        { method: "POST", pathPattern: "/api/system/pipelines/pipeline/parse", response: {} },
        { method: "GET", pathPattern: "/api/system/pipelines/pipeline", response: [] },
    ]));
    const args = {
        _testConnection: "fake",
        title: "X",
        source: 'pipeline "X" stage 0 match all end',
    };
    const res1 = await handleCreatePipeline({ params: { arguments: args } });
    const res2 = await handleCreatePipeline({ params: { arguments: args } });
    const payload1 = JSON.parse(res1.content[0].text);
    const payload2 = JSON.parse(res2.content[0].text);
    assert.equal(typeof payload1.idempotencyKey, "string");
    assert.equal(payload1.idempotencyKey.length > 0, true);
    assert.equal(payload1.idempotencyKey, payload2.idempotencyKey);
});

// =====================================================================
// Task 2 — update_pipeline tests (D-16 STRICT_NO_ECHO + conditional parse pre-flight)
// =====================================================================

test("update_pipeline title-only update: NO parse round-trip fires; no parseResult key in JSON", async () => {
    const captured = [];
    _setCaptureRequest((req) => {
        captured.push(req);
        if (req.method === "GET" && req.path === "/api/system/pipelines/pipeline/p1") {
            return FULL_PIPELINE_A;
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleUpdatePipeline({
        params: {
            arguments: {
                _testConnection: "fake",
                pipelineId: "p1",
                changes: { title: "new title" },
            },
        },
    });
    // No POST /pipeline/parse call captured.
    const parseCalls = captured.filter(
        (r) => r.method === "POST" && r.path === "/api/system/pipelines/pipeline/parse",
    );
    assert.equal(parseCalls.length, 0, "parse pre-flight must NOT fire when source is not touched");
    // The dry-run JSON does NOT contain a parseResult key.
    assert.doesNotMatch(res.content[0].text, /"parseResult"/);
});

test("update_pipeline source-only update: parse round-trip fires; parseResult.ok:true", async () => {
    const captured = [];
    _setCaptureRequest((req) => {
        captured.push(req);
        if (req.method === "GET" && req.path === "/api/system/pipelines/pipeline/p1") {
            return FULL_PIPELINE_A;
        }
        if (req.method === "POST" && req.path === "/api/system/pipelines/pipeline/parse") {
            return { ...FULL_PIPELINE_A, id: undefined };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const newSource = 'pipeline "App routing" stage 0 match all end';
    const res = await handleUpdatePipeline({
        params: {
            arguments: {
                _testConnection: "fake",
                pipelineId: "p1",
                changes: { source: newSource },
            },
        },
    });
    // Parse pre-flight DID fire.
    const parseCalls = captured.filter(
        (r) => r.method === "POST" && r.path === "/api/system/pipelines/pipeline/parse",
    );
    assert.equal(parseCalls.length, 1);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.parseResult.ok, true);
    // Wire body has ONLY source (STRICT_NO_ECHO).
    assert.deepEqual(Object.keys(payload.preview.body), ["source"]);
    assert.equal(payload.preview.body.source, newSource);
});

test("update_pipeline source-with-error: C4 GATE — reason:pipeline_parse_failed; apply refused", async () => {
    let putFired = false;
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/pipelines/pipeline/p1") {
            return FULL_PIPELINE_A;
        }
        if (req.method === "POST" && req.path === "/api/system/pipelines/pipeline/parse") {
            throw new GraylogValidationError("parse failed", {
                status: 400,
                method: "POST",
                path: "/api/system/pipelines/pipeline/parse",
                body: [{ type: "SyntaxError", line: 1, positionInLine: 7, message: "broken" }],
            });
        }
        if (req.method === "PUT") {
            putFired = true;
            return FULL_PIPELINE_A;
        }
        return [];
    });
    const res = await handleUpdatePipeline({
        params: {
            arguments: {
                _testConnection: "fake",
                pipelineId: "p1",
                changes: { source: "broken" },
                dryRun: false,
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "pipeline_parse_failed");
    assert.equal(putFired, false, "PUT must NOT fire when parse pre-flight 400s");
});

test("update_pipeline STRICT_NO_ECHO with title+source: wire body has EXACTLY {title, source}; no echoed current fields", async () => {
    _setCaptureRequest(pipelinesMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/system/pipelines/pipeline/p1",
            response: FULL_PIPELINE_A,
        },
        {
            method: "POST",
            pathPattern: "/api/system/pipelines/pipeline/parse",
            response: { ...FULL_PIPELINE_A, id: undefined },
        },
    ]));
    const res = await handleUpdatePipeline({
        params: {
            arguments: {
                _testConnection: "fake",
                pipelineId: "p1",
                changes: { title: "T", source: "S" },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // wire body has EXACTLY two keys — no echoed description, no echoed current.title.
    assert.deepEqual(Object.keys(payload.preview.body).sort(), ["source", "title"]);
    assert.equal(payload.preview.body.title, "T");
    assert.equal(payload.preview.body.source, "S");
});

test("update_pipeline PUT URL is /api/system/pipelines/pipeline/{id} on apply (Pitfall 3)", async () => {
    const captured = [];
    _setCaptureRequest((req) => {
        captured.push(req);
        if (req.method === "GET" && req.path === "/api/system/pipelines/pipeline/p1") {
            return FULL_PIPELINE_A;
        }
        if (req.method === "POST" && req.path === "/api/system/pipelines/pipeline/parse") {
            return {};
        }
        if (req.method === "PUT") {
            return { ...FULL_PIPELINE_A, title: "new" };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    await handleUpdatePipeline({
        params: {
            arguments: {
                _testConnection: "fake",
                pipelineId: "p1",
                changes: { source: 'pipeline "X" stage 0 match all end' },
                dryRun: false,
            },
        },
    });
    const puts = captured.filter((r) => r.method === "PUT");
    assert.equal(puts.length, 1);
    assert.equal(puts[0].path, "/api/system/pipelines/pipeline/p1");
});

test("update_pipeline 404 on pre-flight GET surfaces clean MCP error envelope", async () => {
    _setCaptureRequest((req) => {
        if (req.method === "GET") {
            throw new GraylogNotFoundError("not found", {
                status: 404,
                method: "GET",
                path: "/api/system/pipelines/pipeline/missing",
                body: null,
            });
        }
        throw new Error("Unexpected " + req.method);
    });
    const res = await handleUpdatePipeline({
        params: {
            arguments: {
                _testConnection: "fake",
                pipelineId: "missing",
                changes: { title: "x" },
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /404/);
    assert.match(res.content[0].text, /update_pipeline|missing/i);
});

test("update_pipeline description:null emits {description:null} (explicit clear-intent)", async () => {
    _setCaptureRequest(pipelinesMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/system/pipelines/pipeline/p1",
            response: FULL_PIPELINE_A,
        },
    ]));
    const res = await handleUpdatePipeline({
        params: {
            arguments: {
                _testConnection: "fake",
                pipelineId: "p1",
                changes: { description: null },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(Object.keys(payload.preview.body), ["description"]);
    assert.equal(payload.preview.body.description, null);
});

test("update_pipeline has NO is_editable / mutable check (D-15 — pipelines have no mutable flag)", async () => {
    // Confirm that even a synthetic `is_editable: false` on the GET response
    // does NOT short-circuit the PUT — D-15: pipelines have no mutable concept
    // on the wire, so the wrapper must not invent one.
    let putFired = false;
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/pipelines/pipeline/p1") {
            // Synthetic: include is_editable:false. The wrapper must IGNORE it.
            return { ...FULL_PIPELINE_A, is_editable: false };
        }
        if (req.method === "POST" && req.path === "/api/system/pipelines/pipeline/parse") {
            return {};
        }
        if (req.method === "PUT") {
            putFired = true;
            return { ...FULL_PIPELINE_A, title: "new" };
        }
        throw new Error("Unexpected " + req.method);
    });
    const res = await handleUpdatePipeline({
        params: {
            arguments: {
                _testConnection: "fake",
                pipelineId: "p1",
                changes: { source: 'pipeline "x" stage 0 match all end' },
                dryRun: false,
            },
        },
    });
    assert.equal(res.isError, undefined);
    assert.equal(putFired, true, "PUT must fire — pipelines have no mutable check (D-15)");
});

// =====================================================================
// Plan 04-03 — pipeline-rule CRUD (PIPE-06..PIPE-09).
//
// Critical structural invariants under test (mirrors Plan 04-02 contract,
// adapted for the rule surface):
//   - Pitfall 3 (rule variant): every rule URL uses the literal
//     `/api/system/pipelines/rule/{id}` segment.
//   - D-05 server-authoritative rule-parse pre-flight: POST
//     /api/system/pipelines/rule/parse fires BEFORE create/update. On
//     400 + Set<ParseError>, wrapper throws GraylogValidationError with
//     reason:"rule_parse_failed"; apply NEVER fires (C4 acceptance gate).
//   - D-10 mutual exclusion: CreatePipelineRuleSchema.refine refuses
//     when BOTH structured AND ruleSource are set, OR when neither is.
//   - D-04 client-side lint via validateRuleSource(source, mergedCatalogue):
//     catches obvious typos (toUpperCase) BEFORE network round-trip.
//   - Pitfall 5: validate consumes the MERGED catalogue so live-only
//     function names are accepted.
//   - Pitfall 6: ParseError.positionInLine (camelCase) on wire →
//     position_in_line (snake_case) in emitted envelope.
//   - D-11 full DSL coverage via recursive ConditionSchema / ActionSchema
//     (z.lazy for recursion).
//   - D-16 STRICT_NO_ECHO partial-update for update_pipeline_rule (per
//     04-U1-SMOKE.md UNREACHABLE_STRICT_NO_ECHO). Parse pre-flight fires
//     ONLY when changes.structured OR changes.ruleSource is touched.
//   - simulator_message Nullable String: agent can pass null to clear;
//     undefined → omit; string → set. STRICT_NO_ECHO preserves.
//   - D-17 __SERVER_ASSIGNED__ sentinel on create.
//   - D-15 no mutable check (rules have no is_editable).
// =====================================================================

import { handleListPipelineRules } from "../src/tools/pipelines/list-pipeline-rules.js";
import { handleGetPipelineRule } from "../src/tools/pipelines/get-pipeline-rule.js";
import { handleCreatePipelineRule } from "../src/tools/pipelines/create-pipeline-rule.js";
import { handleUpdatePipelineRule } from "../src/tools/pipelines/update-pipeline-rule.js";
import {
    ListPipelineRulesSchema,
    GetPipelineRuleSchema,
    CreatePipelineRuleSchema,
    UpdatePipelineRuleSchema,
    RuleSpecSchema,
    ConditionSchema,
    ActionSchema,
    // Plan 04-05 — PIPE-13 + PIPE-14 schemas (connect/disconnect pipelines to streams).
    ConnectPipelinesToStreamSchema,
    DisconnectPipelinesFromStreamSchema,
} from "../src/tools/pipelines/schemas.js";
import { _clearFunctionCatalogueForTests } from "../src/pipeline-dsl/function-catalogue.js";
// Plan 04-05 — PIPE-13 + PIPE-14 handlers (connect/disconnect pipelines to streams).
import { handleConnectPipelinesToStream } from "../src/tools/pipelines/connect-pipelines-to-stream.js";
import { handleDisconnectPipelinesFromStream } from "../src/tools/pipelines/disconnect-pipelines-from-stream.js";

// =====================================================================
// Fixtures — RuleSource DTO and structured-intent helpers
// =====================================================================

const FULL_RULE_A = {
    id: "r1",
    title: "uppercase-source",
    description: "Uppercases the source field",
    source: 'rule "uppercase-source"\nwhen has_field("source")\nthen\n    set_field("source", uppercase(to_string($message.source)));\nend',
    created_at: "2026-01-01T00:00:00.000Z",
    modified_at: "2026-01-15T00:00:00.000Z",
    rule_builder: null,
    simulator_message: null,
};

const FULL_RULE_B = {
    id: "r2",
    title: "tag-error",
    description: "",
    source: 'rule "tag-error"\nwhen has_field("level")\nthen\n    set_field("severity", "error");\nend',
    created_at: "2026-01-01T00:00:00.000Z",
    modified_at: "2026-01-01T00:00:00.000Z",
    rule_builder: null,
    simulator_message: "level=ERROR",
};

// Minimal valid structured intent — has_field check + uppercase action.
// All function names (has_field, uppercase, to_string) are static-baseline
// entries verified to be in builtins.js.
const VALID_STRUCTURED = {
    name: "uppercase-source",
    when: { type: "has_field", field: "source" },
    then: [
        {
            type: "function_call_statement",
            name: "uppercase",
            args: {
                positional: [
                    { type: "field_ref", field: "source", source: "message" },
                ],
            },
        },
    ],
};

// Same shape but uses a camelCase function name (toUpperCase) that should
// fail the client-side lint BEFORE the server parse pre-flight ever fires
// (C4 acceptance gate — client lint path).
const INVALID_STRUCTURED_TOUPPERCASE = {
    name: "broken-rule",
    when: { type: "has_field", field: "source" },
    then: [
        {
            type: "function_call_statement",
            name: "toUpperCase",   // CamelCase typo — not in catalogue
            args: {
                positional: [
                    { type: "field_ref", field: "source", source: "message" },
                ],
            },
        },
    ],
};

// Minimal LIVE function-catalogue response. The static baseline contains
// has_field, uppercase, to_string, etc. — this live payload is empty so
// the merged map equals staticBuiltins. Used as the default route for
// GET /api/system/pipelines/rule/functions.
const EMPTY_LIVE_FUNCTIONS = [];

// =====================================================================
// Schema-layer tests — D-10 mutual exclusion + D-11 recursion
// =====================================================================

test("ListPipelineRulesSchema extends listBase: accepts connectionName/fields/limit", () => {
    const parsed = ListPipelineRulesSchema.parse({
        connectionName: "fake",
        fields: ["id", "title"],
        limit: 10,
    });
    assert.equal(parsed.connectionName, "fake");
    assert.deepEqual(parsed.fields, ["id", "title"]);
    assert.equal(parsed.limit, 10);
});

test("GetPipelineRuleSchema requires ruleId; empty string rejected", () => {
    assert.throws(() => GetPipelineRuleSchema.parse({ ruleId: "" }), /ruleId/);
    assert.throws(() => GetPipelineRuleSchema.parse({}), /ruleId|required/i);
    const parsed = GetPipelineRuleSchema.parse({ ruleId: "r1" });
    assert.equal(parsed.ruleId, "r1");
});

test("RuleSpecSchema requires name + when + then[]; rejects empty `then` array", () => {
    assert.throws(
        () => RuleSpecSchema.parse({ name: "x", when: { type: "has_field", field: "f" }, then: [] }),
        /then/,
    );
    assert.throws(
        () => RuleSpecSchema.parse({ when: { type: "has_field", field: "f" }, then: [{ type: "function_call_statement", name: "uppercase", args: {} }] }),
        /name|required/i,
    );
    const parsed = RuleSpecSchema.parse(VALID_STRUCTURED);
    assert.equal(parsed.name, "uppercase-source");
});

test("ConditionSchema accepts deeply nested AND/OR/NOT tree (D-11 recursion via z.lazy, 4 levels)", () => {
    // Build a 4-level deep tree:
    //   AND(OR(NOT(comparison), has_field), AND(field_ref, function_call))
    const fourLevels = {
        type: "and",
        left: {
            type: "or",
            left: {
                type: "not",
                expr: {
                    type: "comparison",
                    op: "==",
                    left: { type: "field_ref", field: "level", source: "message" },
                    right: { type: "literal", value: 6 },
                },
            },
            right: { type: "has_field", field: "source" },
        },
        right: {
            type: "and",
            left: { type: "field_ref", field: "x" },
            right: {
                type: "function_call",
                name: "has_field",
                args: { positional: [{ type: "literal", value: "x" }] },
            },
        },
    };
    const parsed = ConditionSchema.parse(fourLevels);
    assert.equal(parsed.type, "and");
    assert.equal(parsed.left.left.type, "not");
    assert.equal(parsed.left.left.expr.type, "comparison");
});

test("ActionSchema accepts ALL 6 action variant types (D-11 coverage)", () => {
    const examples = [
        { type: "set_field", field: "x", value: { type: "literal", value: 1 } },
        { type: "remove_field", field: "x" },
        { type: "rename_field", old_field: "old", new_field: "new" },
        { type: "lookup_value", target_field: "out", lookup_table: "tab", key: { type: "literal", value: "k" } },
        { type: "function_call_statement", name: "uppercase", args: { positional: [{ type: "field_ref", field: "x" }] } },
        { type: "let_assignment", var_name: "tmp", value: { type: "literal", value: 1 } },
    ];
    for (const ex of examples) {
        const parsed = ActionSchema.parse(ex);
        assert.equal(parsed.type, ex.type);
    }
});

test("CreatePipelineRuleSchema D-10 mutual exclusion: REJECTS when BOTH structured AND ruleSource set", () => {
    assert.throws(
        () => CreatePipelineRuleSchema.parse({
            structured: VALID_STRUCTURED,
            ruleSource: 'rule "x" when has_field("y") then end',
        }),
        /EXACTLY ONE|mutual|structured|ruleSource/i,
    );
});

test("CreatePipelineRuleSchema D-10 mutual exclusion: REJECTS when NEITHER structured NOR ruleSource set", () => {
    assert.throws(
        () => CreatePipelineRuleSchema.parse({
            description: "no source given",
        }),
        /EXACTLY ONE|mutual|structured|ruleSource/i,
    );
});

test("CreatePipelineRuleSchema accepts structured-only", () => {
    const parsed = CreatePipelineRuleSchema.parse({ structured: VALID_STRUCTURED });
    assert.equal(parsed.structured.name, "uppercase-source");
    assert.equal(parsed.ruleSource, undefined);
});

test("CreatePipelineRuleSchema accepts ruleSource-only", () => {
    const parsed = CreatePipelineRuleSchema.parse({
        ruleSource: 'rule "raw" when has_field("x") then end',
    });
    assert.equal(parsed.ruleSource.startsWith("rule"), true);
    assert.equal(parsed.structured, undefined);
});

test("UpdatePipelineRuleSchema changes envelope: REJECTS when both changes.structured AND changes.ruleSource set", () => {
    assert.throws(
        () => UpdatePipelineRuleSchema.parse({
            ruleId: "r1",
            changes: {
                structured: VALID_STRUCTURED,
                ruleSource: 'rule "x" when has_field("y") then end',
            },
        }),
        /ruleSource|structured|both/i,
    );
});

test("UpdatePipelineRuleSchema changes envelope: accepts empty changes (STRICT_NO_ECHO minimal body)", () => {
    const parsed = UpdatePipelineRuleSchema.parse({ ruleId: "r1", changes: {} });
    assert.deepEqual(parsed.changes, {});
});

test("UpdatePipelineRuleSchema preserves simulator_message:null for explicit clear-intent", () => {
    const parsed = UpdatePipelineRuleSchema.parse({
        ruleId: "r1",
        changes: { simulator_message: null },
    });
    assert.equal(parsed.changes.simulator_message, null);
    assert.equal("simulator_message" in parsed.changes, true);
});

// =====================================================================
// list_pipeline_rules (PIPE-06) tests
// =====================================================================

test("list_pipeline_rules GET URL is exactly /api/system/pipelines/rule (Pitfall 3 rule variant)", async () => {
    let captured = null;
    _setCaptureRequest((req) => {
        captured = req;
        return [FULL_RULE_A, FULL_RULE_B];
    });
    await handleListPipelineRules({
        params: { arguments: { _testConnection: "fake" } },
    });
    assert.equal(captured.method, "GET");
    assert.equal(captured.path, "/api/system/pipelines/rule");
});

test("list_pipeline_rules narrow projection: [id, title, description, created_at, modified_at]", async () => {
    _setCaptureRequest(() => [FULL_RULE_A, FULL_RULE_B]);
    const res = await handleListPipelineRules({
        params: { arguments: { _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "list_pipeline_rules");
    assert.equal(payload.count, 2);
    assert.deepEqual(payload.fields, ["id", "title", "description", "created_at", "modified_at"]);
    // Source text should NOT appear in the narrow projection.
    assert.equal(payload.items[0].source, undefined);
});

test("list_pipeline_rules fields:'all' returns full DTO including source text", async () => {
    _setCaptureRequest(() => [FULL_RULE_A]);
    const res = await handleListPipelineRules({
        params: { arguments: { _testConnection: "fake", fields: "all" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.count, 1);
    assert.equal(payload.items[0].source.length > 0, true);
    assert.equal(payload.items[0].id, "r1");
});

// =====================================================================
// get_pipeline_rule (PIPE-07) tests
// =====================================================================

test("get_pipeline_rule GET URL is /api/system/pipelines/rule/{ruleId} (Pitfall 3 rule variant)", async () => {
    let captured = null;
    _setCaptureRequest((req) => {
        captured = req;
        return FULL_RULE_A;
    });
    await handleGetPipelineRule({
        params: { arguments: { _testConnection: "fake", ruleId: "r1" } },
    });
    assert.equal(captured.method, "GET");
    assert.equal(captured.path, "/api/system/pipelines/rule/r1");
});

test("get_pipeline_rule returns the full RuleSource DTO (no projection)", async () => {
    _setCaptureRequest(() => FULL_RULE_A);
    const res = await handleGetPipelineRule({
        params: { arguments: { _testConnection: "fake", ruleId: "r1" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "get_pipeline_rule");
    assert.equal(payload.rule.id, "r1");
    assert.equal(payload.rule.title, "uppercase-source");
    assert.equal(payload.rule.source.length > 0, true);
    assert.equal(payload.rule.created_at, "2026-01-01T00:00:00.000Z");
    assert.equal("rule_builder" in payload.rule, true);
    assert.equal("simulator_message" in payload.rule, true);
});

test("get_pipeline_rule propagates 404 via wrapGraylogError", async () => {
    _setCaptureRequest(() => {
        throw new GraylogNotFoundError("not found", {
            status: 404,
            method: "GET",
            path: "/api/system/pipelines/rule/missing",
            body: null,
        });
    });
    const res = await handleGetPipelineRule({
        params: { arguments: { _testConnection: "fake", ruleId: "missing" } },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /404/);
    assert.match(res.content[0].text, /get_pipeline_rule/);
});

// =====================================================================
// Task 1 — Barrel + tool registration after PIPE-06..PIPE-07 land
// =====================================================================

test("dispatch resolves list_pipeline_rules/get_pipeline_rule via the pipelines barrel", async () => {
    const { dispatch } = await import("../src/dispatch.js");
    await import("../src/tools/_register.js");

    _setConnectionsForTests({
        fake: { baseUrl: "http://fake.example", apiToken: "tok" },
    });
    setActiveConnection("fake");
    _setCaptureRequest(() => []);

    const res = await dispatch({ params: { name: "list_pipeline_rules", arguments: {} } });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "list_pipeline_rules");
    assert.ok(Array.isArray(payload.items));
});

// =====================================================================
// Task 2 — create_pipeline_rule (PIPE-08) — D-05 parse pre-flight +
// D-04 client-side lint + D-10 mutual exclusion + D-17 sentinel.
// C4 ACCEPTANCE GATE is proven across 3 distinct fail paths plus the
// happy structured + happy raw paths.
// =====================================================================

// Reusable multi-route for the standard happy-path create call:
//   1. GET /api/system/pipelines/rule/functions → live function catalogue
//      (empty array — merged map equals staticBuiltins)
//   2. POST /api/system/pipelines/rule/parse → 200 (parse ok)
//   3. GET /api/system/pipelines/rule → [] (no existing rules to collide)
//   4. POST /api/system/pipelines/rule → returns created RuleSource
function createPipelineRuleHappyRoutes(extraOverrides = {}) {
    return pipelinesMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/system/pipelines/rule/functions",
            response: extraOverrides.functions ?? EMPTY_LIVE_FUNCTIONS,
        },
        {
            method: "POST",
            pathPattern: "/api/system/pipelines/rule/parse",
            response: extraOverrides.parse ?? (() => ({ source: "ok" })),
        },
        {
            method: "GET",
            pathPattern: "/api/system/pipelines/rule",
            response: extraOverrides.list ?? [],
        },
        {
            method: "POST",
            pathPattern: "/api/system/pipelines/rule",
            response: extraOverrides.create ?? (() => ({ ...FULL_RULE_A, id: "r_new" })),
        },
    ]);
}

test("create_pipeline_rule HAPPY structured: parseResult.ok:true; emit produces DSL with expected fragments; __SERVER_ASSIGNED__ sentinel", async () => {
    _setCaptureRequest(createPipelineRuleHappyRoutes());
    const res = await handleCreatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                structured: VALID_STRUCTURED,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.tool, "create_pipeline_rule");
    assert.equal(payload.preview.method, "POST");
    assert.equal(payload.preview.path, "/api/system/pipelines/rule");  // Pitfall 3 rule variant
    // Emitted DSL contains expected fragments: rule "uppercase-source",
    // has_field("source"), uppercase(...).
    const emitted = payload.preview.body.source;
    assert.match(emitted, /rule "uppercase-source"/);
    assert.match(emitted, /has_field\("source"\)/);
    assert.match(emitted, /uppercase\(/);
    assert.match(emitted, /\$message\.source/);
    // D-17 server-assigned sentinel.
    assert.equal(payload.postApplyEstimate.id, "__SERVER_ASSIGNED__");
    // parseResult surfaces on dry-run.
    assert.equal(payload.parseResult.ok, true);
});

test("create_pipeline_rule HAPPY raw DSL: source forwards VERBATIM (no emit transformation)", async () => {
    const rawSource = 'rule "raw-rule"\nwhen has_field("x")\nthen\n    set_field("y", "z");\nend';
    _setCaptureRequest(createPipelineRuleHappyRoutes());
    const res = await handleCreatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                ruleSource: rawSource,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.body.source, rawSource);
    assert.equal(payload.parseResult.ok, true);
});

test("create_pipeline_rule C4 CLIENT-SIDE LINT FAIL (toUpperCase): reason rule_validation_failed; parse pre-flight NEVER fires", async () => {
    const seenPaths = [];
    _setCaptureRequest((req) => {
        seenPaths.push({ method: req.method, path: req.path });
        if (req.method === "GET" && req.path === "/api/system/pipelines/rule/functions") {
            return EMPTY_LIVE_FUNCTIONS;
        }
        if (req.method === "POST" && req.path === "/api/system/pipelines/rule/parse") {
            return { source: "should not be reached" };
        }
        return [];
    });
    const res = await handleCreatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                structured: INVALID_STRUCTURED_TOUPPERCASE,
                dryRun: false,
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "rule_validation_failed");
    // The agent-visible envelope must surface the offending camelCase function name.
    assert.match(res.content[0].text, /toUpperCase/);
    // Parse pre-flight MUST NOT have been called.
    const parseCalls = seenPaths.filter(
        (p) => p.method === "POST" && p.path === "/api/system/pipelines/rule/parse",
    );
    assert.equal(parseCalls.length, 0, "parse pre-flight must NOT fire when client-side lint catches the error first");
});

test("create_pipeline_rule C4 SERVER-PARSE FAIL (structured): reason rule_parse_failed; apply NEVER fires", async () => {
    let postBodyFired = false;
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/pipelines/rule/functions") {
            return EMPTY_LIVE_FUNCTIONS;
        }
        if (req.method === "POST" && req.path === "/api/system/pipelines/rule/parse") {
            // Synthetic ParseException — 400 + Set<ParseError> body. The
            // structured intent passes the client-side lint (uppercase IS in
            // the catalogue) but Graylog's server-side grammar fails because
            // (e.g.) the action arg shape was wrong.
            throw new GraylogValidationError("parse failed", {
                status: 400,
                method: "POST",
                path: "/api/system/pipelines/rule/parse",
                body: [{ type: "SyntaxError", line: 3, positionInLine: 7, message: "unexpected token" }],
            });
        }
        if (req.method === "POST" && req.path === "/api/system/pipelines/rule") {
            postBodyFired = true;
            return { ...FULL_RULE_A };
        }
        return [];
    });
    const res = await handleCreatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                structured: VALID_STRUCTURED,
                dryRun: false,
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "rule_parse_failed");
    assert.equal(postBodyFired, false, "POST /rule must NOT fire when server parse pre-flight 400s");
});

test("create_pipeline_rule C4 SERVER-PARSE FAIL (raw DSL): reason rule_parse_failed; apply NEVER fires", async () => {
    let postBodyFired = false;
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/pipelines/rule/functions") {
            return EMPTY_LIVE_FUNCTIONS;
        }
        if (req.method === "POST" && req.path === "/api/system/pipelines/rule/parse") {
            throw new GraylogValidationError("parse failed", {
                status: 400,
                method: "POST",
                path: "/api/system/pipelines/rule/parse",
                body: [{ type: "SyntaxError", line: 1, positionInLine: 5, message: "missing end" }],
            });
        }
        if (req.method === "POST" && req.path === "/api/system/pipelines/rule") {
            postBodyFired = true;
            return { ...FULL_RULE_A };
        }
        return [];
    });
    const res = await handleCreatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                ruleSource: 'rule "broken" when has_field("x") then',  // truncated
                dryRun: false,
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "rule_parse_failed");
    assert.equal(postBodyFired, false);
});

test("create_pipeline_rule Pitfall 6: wire positionInLine (camelCase) emits as position_in_line (snake_case)", async () => {
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/pipelines/rule/functions") {
            return EMPTY_LIVE_FUNCTIONS;
        }
        if (req.method === "POST" && req.path === "/api/system/pipelines/rule/parse") {
            throw new GraylogValidationError("parse failed", {
                status: 400,
                method: "POST",
                path: "/api/system/pipelines/rule/parse",
                body: [{ type: "SyntaxError", line: 3, positionInLine: 7, message: "boom" }],
            });
        }
        return [];
    });
    const res = await handleCreatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                ruleSource: 'rule "x" when has_field("y") then end',
            },
        },
    });
    assert.equal(res.isError, true);
    // The wrapper's emitted text must surface the snake_case projection of
    // positionInLine. The L:position rendering encodes it directly.
    assert.match(res.content[0].text, /L3:7/);
    assert.match(res.content[0].text, /SyntaxError/);
});

test("create_pipeline_rule Pitfall 5: live-only function name in merged catalogue is ACCEPTED by client-side lint", async () => {
    // Synthetic live function NOT present in static builtins. Wrapper should
    // accept it through the merged map (live-wins-on-collision semantics —
    // here live-only entry is the only path).
    const LIVE_ONLY_FUNCTIONS = [
        {
            name: "__phase4_test_function__",
            pure: true,
            return_type: "boolean",
            params: [{ name: "v", type: "any", optional: false }],
            description: "synthetic live-only function",
        },
    ];
    _setCaptureRequest(createPipelineRuleHappyRoutes({ functions: LIVE_ONLY_FUNCTIONS }));
    const res = await handleCreatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                structured: {
                    name: "live-only-test",
                    when: { type: "has_field", field: "source" },
                    then: [
                        {
                            type: "function_call_statement",
                            name: "__phase4_test_function__",
                            args: { positional: [{ type: "literal", value: "x" }] },
                        },
                    ],
                },
            },
        },
    });
    assert.equal(res.isError, undefined, `expected success but got isError=${res.isError}: ${res.content?.[0]?.text}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.parseResult.ok, true);
    assert.match(payload.preview.body.source, /__phase4_test_function__/);
});

test("create_pipeline_rule path: POST URL is /api/system/pipelines/rule; parse path is /api/system/pipelines/rule/parse (literal `rule` segment)", async () => {
    const seenPaths = [];
    _setCaptureRequest((req) => {
        seenPaths.push({ method: req.method, path: req.path });
        if (req.method === "GET" && req.path === "/api/system/pipelines/rule/functions") return EMPTY_LIVE_FUNCTIONS;
        if (req.method === "POST" && req.path === "/api/system/pipelines/rule/parse") return {};
        if (req.method === "GET" && req.path === "/api/system/pipelines/rule") return [];
        if (req.method === "POST" && req.path === "/api/system/pipelines/rule") return { ...FULL_RULE_A, id: "r_new" };
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    await handleCreatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                structured: VALID_STRUCTURED,
                dryRun: false,
            },
        },
    });
    assert.ok(
        seenPaths.some((p) => p.method === "POST" && p.path === "/api/system/pipelines/rule/parse"),
        `Expected POST /api/system/pipelines/rule/parse; saw ${JSON.stringify(seenPaths)}`,
    );
    assert.ok(
        seenPaths.some((p) => p.method === "POST" && p.path === "/api/system/pipelines/rule"),
        `Expected POST /api/system/pipelines/rule; saw ${JSON.stringify(seenPaths)}`,
    );
});

test("create_pipeline_rule M5: existingMatches populated when structured.name collides with an existing rule's title", async () => {
    _setCaptureRequest(createPipelineRuleHappyRoutes({
        list: [{ id: "r_existing", title: "uppercase-source", description: "" }],
    }));
    const res = await handleCreatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                structured: VALID_STRUCTURED,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.existingMatches.length, 1);
    assert.equal(payload.existingMatches[0].id, "r_existing");
    assert.equal(payload.existingMatches[0].title, "uppercase-source");
});

test("create_pipeline_rule M5: existingMatches populated when raw DSL title (regex-extracted) collides", async () => {
    _setCaptureRequest(createPipelineRuleHappyRoutes({
        list: [{ id: "r_existing", title: "tag-error", description: "" }],
    }));
    const res = await handleCreatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                ruleSource: 'rule "tag-error"\nwhen has_field("x") then end',
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.existingMatches.length, 1);
    assert.equal(payload.existingMatches[0].title, "tag-error");
});

test("create_pipeline_rule M5: existingMatches EMPTY when raw DSL has no extractable title regex", async () => {
    _setCaptureRequest(createPipelineRuleHappyRoutes({
        list: [{ id: "r_existing", title: "any-rule", description: "" }],
    }));
    const res = await handleCreatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                // No `rule "..."` prefix — best-effort regex fails.
                ruleSource: 'when has_field("x") then end',
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.existingMatches.length, 0);
});

test("create_pipeline_rule idempotency-key is present in dry-run JSON and deterministic", async () => {
    _setCaptureRequest(createPipelineRuleHappyRoutes());
    const args = {
        _testConnection: "fake",
        structured: VALID_STRUCTURED,
    };
    const res1 = await handleCreatePipelineRule({ params: { arguments: args } });
    _clearFunctionCatalogueForTests();
    _setCaptureRequest(createPipelineRuleHappyRoutes());
    const res2 = await handleCreatePipelineRule({ params: { arguments: args } });
    const payload1 = JSON.parse(res1.content[0].text);
    const payload2 = JSON.parse(res2.content[0].text);
    assert.equal(typeof payload1.idempotencyKey, "string");
    assert.equal(payload1.idempotencyKey.length > 0, true);
    assert.equal(payload1.idempotencyKey, payload2.idempotencyKey);
});

test("create_pipeline_rule writable:false short-circuits BEFORE any network call", async () => {
    const captured = [];
    _setCaptureRequest((req) => {
        captured.push(req);
        return [];
    });
    _setConnectionsForTests({
        readonly: { baseUrl: "http://fake.example", apiToken: "tok", writable: false },
    });
    const res = await handleCreatePipelineRule({
        params: {
            arguments: {
                connectionName: "readonly",
                structured: VALID_STRUCTURED,
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "connection_read_only");
    assert.equal(captured.length, 0);
});

test("create_pipeline_rule apply on dryRun:false fires POST /rule with {source, ...} after successful parse + lint", async () => {
    const captured = [];
    _setCaptureRequest((req) => {
        captured.push(req);
        if (req.method === "GET" && req.path === "/api/system/pipelines/rule/functions") return EMPTY_LIVE_FUNCTIONS;
        if (req.method === "POST" && req.path === "/api/system/pipelines/rule/parse") return {};
        if (req.method === "GET" && req.path === "/api/system/pipelines/rule") return [];
        if (req.method === "POST" && req.path === "/api/system/pipelines/rule") return { ...FULL_RULE_A, id: "r_new" };
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleCreatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                structured: VALID_STRUCTURED,
                description: "Uppercases source field",
                dryRun: false,
            },
        },
    });
    const posts = captured.filter((r) => r.method === "POST" && r.path === "/api/system/pipelines/rule");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.source.includes("uppercase-source"), true);
    assert.equal(posts[0].body.description, "Uppercases source field");
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    assert.equal(payload.result.id, "r_new");
});

// =====================================================================
// Task 2 — update_pipeline_rule (PIPE-09) — STRICT_NO_ECHO partial-update +
// conditional parse pre-flight + simulator_message clear-intent + D-15.
// =====================================================================

test("update_pipeline_rule description-only change: NO parse round-trip fires; no parseResult key in JSON", async () => {
    const captured = [];
    _setCaptureRequest((req) => {
        captured.push(req);
        if (req.method === "GET" && req.path === "/api/system/pipelines/rule/r1") {
            return FULL_RULE_A;
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleUpdatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                ruleId: "r1",
                changes: { description: "new desc" },
            },
        },
    });
    const parseCalls = captured.filter(
        (r) => r.method === "POST" && r.path === "/api/system/pipelines/rule/parse",
    );
    assert.equal(parseCalls.length, 0, "parse pre-flight must NOT fire when source/structured is not touched");
    const functionCalls = captured.filter(
        (r) => r.method === "GET" && r.path === "/api/system/pipelines/rule/functions",
    );
    assert.equal(functionCalls.length, 0, "function-catalogue fetch must NOT fire when source/structured is not touched");
    assert.doesNotMatch(res.content[0].text, /"parseResult"/);
});

test("update_pipeline_rule structured-source change: emit + parse + STRICT body", async () => {
    const captured = [];
    _setCaptureRequest((req) => {
        captured.push(req);
        if (req.method === "GET" && req.path === "/api/system/pipelines/rule/r1") {
            return FULL_RULE_A;
        }
        if (req.method === "GET" && req.path === "/api/system/pipelines/rule/functions") {
            return EMPTY_LIVE_FUNCTIONS;
        }
        if (req.method === "POST" && req.path === "/api/system/pipelines/rule/parse") {
            return { source: "ok" };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleUpdatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                ruleId: "r1",
                changes: { structured: VALID_STRUCTURED },
            },
        },
    });
    const parseCalls = captured.filter(
        (r) => r.method === "POST" && r.path === "/api/system/pipelines/rule/parse",
    );
    assert.equal(parseCalls.length, 1);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.parseResult.ok, true);
    // STRICT_NO_ECHO — wire body has ONLY `source` (the field touched).
    assert.deepEqual(Object.keys(payload.preview.body), ["source"]);
    assert.match(payload.preview.body.source, /rule "uppercase-source"/);
});

test("update_pipeline_rule raw ruleSource change: parse + STRICT body (no emit)", async () => {
    const captured = [];
    const newSource = 'rule "raw-update" when has_field("x") then end';
    _setCaptureRequest((req) => {
        captured.push(req);
        if (req.method === "GET" && req.path === "/api/system/pipelines/rule/r1") return FULL_RULE_A;
        if (req.method === "GET" && req.path === "/api/system/pipelines/rule/functions") return EMPTY_LIVE_FUNCTIONS;
        if (req.method === "POST" && req.path === "/api/system/pipelines/rule/parse") return {};
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleUpdatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                ruleId: "r1",
                changes: { ruleSource: newSource },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(Object.keys(payload.preview.body), ["source"]);
    assert.equal(payload.preview.body.source, newSource);
    assert.equal(payload.parseResult.ok, true);
});

test("update_pipeline_rule C4 GATE: parse failure on update path → reason rule_parse_failed; PUT refused", async () => {
    let putFired = false;
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/pipelines/rule/r1") return FULL_RULE_A;
        if (req.method === "GET" && req.path === "/api/system/pipelines/rule/functions") return EMPTY_LIVE_FUNCTIONS;
        if (req.method === "POST" && req.path === "/api/system/pipelines/rule/parse") {
            throw new GraylogValidationError("parse failed", {
                status: 400,
                method: "POST",
                path: "/api/system/pipelines/rule/parse",
                body: [{ type: "SyntaxError", line: 1, positionInLine: 5, message: "broken" }],
            });
        }
        if (req.method === "PUT") {
            putFired = true;
            return FULL_RULE_A;
        }
        return [];
    });
    const res = await handleUpdatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                ruleId: "r1",
                changes: { ruleSource: 'rule "broken"' },
                dryRun: false,
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "rule_parse_failed");
    assert.equal(putFired, false, "PUT must NOT fire when parse pre-flight 400s");
});

test("update_pipeline_rule simulator_message:null explicit clear → wire body emits simulator_message:null", async () => {
    _setCaptureRequest(pipelinesMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/system/pipelines/rule/r1",
            response: FULL_RULE_A,
        },
    ]));
    const res = await handleUpdatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                ruleId: "r1",
                changes: { simulator_message: null },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(Object.keys(payload.preview.body), ["simulator_message"]);
    assert.equal(payload.preview.body.simulator_message, null);
});

test("update_pipeline_rule simulator_message omitted → wire body omits the key entirely", async () => {
    _setCaptureRequest(pipelinesMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/system/pipelines/rule/r1",
            response: FULL_RULE_A,
        },
    ]));
    const res = await handleUpdatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                ruleId: "r1",
                changes: { description: "new desc" },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal("simulator_message" in payload.preview.body, false);
    assert.deepEqual(Object.keys(payload.preview.body), ["description"]);
});

test("update_pipeline_rule simulator_message: 'new value' → wire body emits the string", async () => {
    _setCaptureRequest(pipelinesMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/system/pipelines/rule/r1",
            response: FULL_RULE_A,
        },
    ]));
    const res = await handleUpdatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                ruleId: "r1",
                changes: { simulator_message: "new sample" },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.body.simulator_message, "new sample");
});

test("update_pipeline_rule PUT URL is /api/system/pipelines/rule/{id} on apply (Pitfall 3 rule variant)", async () => {
    const captured = [];
    _setCaptureRequest((req) => {
        captured.push(req);
        if (req.method === "GET" && req.path === "/api/system/pipelines/rule/r1") return FULL_RULE_A;
        if (req.method === "GET" && req.path === "/api/system/pipelines/rule/functions") return EMPTY_LIVE_FUNCTIONS;
        if (req.method === "POST" && req.path === "/api/system/pipelines/rule/parse") return {};
        if (req.method === "PUT") return { ...FULL_RULE_A, title: "renamed" };
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    await handleUpdatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                ruleId: "r1",
                changes: { ruleSource: 'rule "X" when has_field("x") then end' },
                dryRun: false,
            },
        },
    });
    const puts = captured.filter((r) => r.method === "PUT");
    assert.equal(puts.length, 1);
    assert.equal(puts[0].path, "/api/system/pipelines/rule/r1");
});

test("update_pipeline_rule 404 on pre-flight GET surfaces clean MCP error envelope", async () => {
    _setCaptureRequest((req) => {
        if (req.method === "GET") {
            throw new GraylogNotFoundError("not found", {
                status: 404,
                method: "GET",
                path: "/api/system/pipelines/rule/missing",
                body: null,
            });
        }
        throw new Error("Unexpected " + req.method);
    });
    const res = await handleUpdatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                ruleId: "missing",
                changes: { description: "x" },
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /404/);
    assert.match(res.content[0].text, /update_pipeline_rule|missing/i);
});

test("update_pipeline_rule has NO is_editable / mutable check (D-15 generalisation — rules have no mutable flag)", async () => {
    // Confirm that even a synthetic `is_editable: false` on the GET response
    // does NOT short-circuit the PUT. Rules carry no is_editable in
    // RuleSource.java; the wrapper must not invent one.
    let putFired = false;
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/pipelines/rule/r1") {
            return { ...FULL_RULE_A, is_editable: false };
        }
        if (req.method === "GET" && req.path === "/api/system/pipelines/rule/functions") {
            return EMPTY_LIVE_FUNCTIONS;
        }
        if (req.method === "POST" && req.path === "/api/system/pipelines/rule/parse") return {};
        if (req.method === "PUT") {
            putFired = true;
            return FULL_RULE_A;
        }
        throw new Error("Unexpected " + req.method);
    });
    const res = await handleUpdatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                ruleId: "r1",
                changes: { ruleSource: 'rule "x" when has_field("y") then end' },
                dryRun: false,
            },
        },
    });
    assert.equal(res.isError, undefined);
    assert.equal(putFired, true, "PUT must fire — rules have no mutable check");
});

test("update_pipeline_rule description:null clear-intent preserved (3-state semantics)", async () => {
    _setCaptureRequest(pipelinesMultiCapture([
        { method: "GET", pathPattern: "/api/system/pipelines/rule/r1", response: FULL_RULE_A },
    ]));
    const res = await handleUpdatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                ruleId: "r1",
                changes: { description: null },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(Object.keys(payload.preview.body), ["description"]);
    assert.equal(payload.preview.body.description, null);
});

// =====================================================================
// Plan 04-05 — Task 1 schema-layer tests for connect/disconnect.
// =====================================================================

test("ConnectPipelinesToStreamSchema requires streamId and non-empty pipelineIds", () => {
    // Missing streamId
    assert.throws(
        () => ConnectPipelinesToStreamSchema.parse({ pipelineIds: ["p1"] }),
        /streamId|required/i,
    );
    // Missing pipelineIds
    assert.throws(
        () => ConnectPipelinesToStreamSchema.parse({ streamId: "s1" }),
        /pipelineIds|required/i,
    );
    // Empty pipelineIds array
    assert.throws(
        () => ConnectPipelinesToStreamSchema.parse({ streamId: "s1", pipelineIds: [] }),
        /pipelineIds|min|at least/i,
    );
    // Empty string in array
    assert.throws(
        () => ConnectPipelinesToStreamSchema.parse({ streamId: "s1", pipelineIds: [""] }),
        /pipelineIds/i,
    );
    // Empty streamId
    assert.throws(
        () => ConnectPipelinesToStreamSchema.parse({ streamId: "", pipelineIds: ["p1"] }),
        /streamId/i,
    );
    // Valid input
    const parsed = ConnectPipelinesToStreamSchema.parse({
        streamId: "s1",
        pipelineIds: ["p1", "p2"],
    });
    assert.equal(parsed.streamId, "s1");
    assert.deepEqual(parsed.pipelineIds, ["p1", "p2"]);
    assert.equal(parsed.dryRun, true);  // mutatingBase default
});

test("DisconnectPipelinesFromStreamSchema requires streamId and non-empty pipelineIds", () => {
    assert.throws(
        () => DisconnectPipelinesFromStreamSchema.parse({ pipelineIds: ["p1"] }),
        /streamId|required/i,
    );
    assert.throws(
        () => DisconnectPipelinesFromStreamSchema.parse({ streamId: "s1" }),
        /pipelineIds|required/i,
    );
    assert.throws(
        () => DisconnectPipelinesFromStreamSchema.parse({ streamId: "s1", pipelineIds: [] }),
        /pipelineIds|min|at least/i,
    );
    const parsed = DisconnectPipelinesFromStreamSchema.parse({
        streamId: "s1",
        pipelineIds: ["p1"],
    });
    assert.equal(parsed.streamId, "s1");
    assert.deepEqual(parsed.pipelineIds, ["p1"]);
});

// =====================================================================
// Plan 04-05 — connect_pipelines_to_stream (PIPE-13) — GET-merge-PUT.
//
// CRITICAL: POST /api/system/pipelines/connections/to_stream has REPLACE
// semantics — the wrapper does GET-merge-PUT client-side to preserve
// previously-connected pipelines. Pitfall 2 acceptance gate proves this.
// =====================================================================

test("connect_pipelines_to_stream HAPPY (union): merged set = current ∪ args; sorted", async () => {
    const captured = [];
    _setCaptureRequest((req) => {
        captured.push(req);
        if (req.method === "GET" && req.path === "/api/system/pipelines/connections/s1") {
            return { id: "conn1", stream_id: "s1", pipeline_ids: ["a", "b"] };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleConnectPipelinesToStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                pipelineIds: ["c", "d"],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.method, "POST");
    assert.equal(payload.preview.path, "/api/system/pipelines/connections/to_stream");
    assert.equal(payload.preview.body.stream_id, "s1");
    assert.deepEqual(payload.preview.body.pipeline_ids, ["a", "b", "c", "d"]);
    assert.deepEqual(payload.existingMatches, []);
    assert.deepEqual(payload.postApplyEstimate.pipeline_ids, ["a", "b", "c", "d"]);
});

test("connect_pipelines_to_stream PITFALL 2 ACCEPTANCE GATE: current=[a,b], args=[new] → body=[a,b,new] (NOT [new])", async () => {
    // The load-bearing test of this plan. A naive REPLACE-semantics call would
    // produce body.pipeline_ids === ["new"] (silently disconnecting a and b).
    // GET-merge-PUT MUST produce ["a", "b", "new"] (sorted).
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/pipelines/connections/s1") {
            return { id: "conn1", stream_id: "s1", pipeline_ids: ["a", "b"] };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleConnectPipelinesToStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                pipelineIds: ["new"],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // Pitfall 2 GATE — body MUST contain a + b + new (sorted), not just [new]
    assert.deepEqual(payload.preview.body.pipeline_ids, ["a", "b", "new"]);
    assert.notDeepStrictEqual(payload.preview.body.pipeline_ids, ["new"]);
});

test("connect_pipelines_to_stream 404 on GET treated as empty set; current treated as empty", async () => {
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/pipelines/connections/s_new") {
            throw new GraylogNotFoundError("no connection record yet", {
                status: 404,
                method: "GET",
                path: "/api/system/pipelines/connections/s_new",
                body: null,
            });
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleConnectPipelinesToStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s_new",
                pipelineIds: ["x"],
            },
        },
    });
    assert.equal(res.isError, undefined);
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(payload.preview.body.pipeline_ids, ["x"]);
    assert.deepEqual(payload.postApplyEstimate.pipeline_ids, ["x"]);
});

test("connect_pipelines_to_stream idempotency (attach already-connected): existingMatches surfaces already_connected", async () => {
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/pipelines/connections/s1") {
            return { id: "conn1", stream_id: "s1", pipeline_ids: ["a", "b"] };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleConnectPipelinesToStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                pipelineIds: ["a"],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // Merged set is unchanged (a already in current set)
    assert.deepEqual(payload.preview.body.pipeline_ids, ["a", "b"]);
    assert.equal(payload.existingMatches.length, 1);
    assert.equal(payload.existingMatches[0].id, "a");
    assert.equal(payload.existingMatches[0].similarity_reason, "already_connected");
});

test("connect_pipelines_to_stream partial idempotency (attach mix of new+existing)", async () => {
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/pipelines/connections/s1") {
            return { id: "conn1", stream_id: "s1", pipeline_ids: ["a", "b"] };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleConnectPipelinesToStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                pipelineIds: ["a", "c"],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(payload.preview.body.pipeline_ids, ["a", "b", "c"]);
    assert.equal(payload.existingMatches.length, 1);
    assert.equal(payload.existingMatches[0].id, "a");
    assert.equal(payload.existingMatches[0].similarity_reason, "already_connected");
});

test("connect_pipelines_to_stream deterministic sort: unsorted inputs → alphabetically sorted body", async () => {
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/pipelines/connections/s1") {
            return { id: "conn1", stream_id: "s1", pipeline_ids: ["z", "a"] };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleConnectPipelinesToStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                pipelineIds: ["m", "b"],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(payload.preview.body.pipeline_ids, ["a", "b", "m", "z"]);
});

test("connect_pipelines_to_stream 5xx on GET propagates as MCP error; POST NEVER fires", async () => {
    const captured = [];
    _setCaptureRequest((req) => {
        captured.push(req);
        if (req.method === "GET" && req.path === "/api/system/pipelines/connections/s1") {
            throw new GraylogValidationError("internal error", {
                status: 500,
                method: "GET",
                path: "/api/system/pipelines/connections/s1",
                body: null,
            });
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleConnectPipelinesToStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                pipelineIds: ["new"],
                dryRun: false,
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /500/);
    const posts = captured.filter((r) => r.method === "POST");
    assert.equal(posts.length, 0, "POST must NEVER fire when GET pre-flight errors");
});

test("connect_pipelines_to_stream writable:false short-circuits BEFORE the GET fires (D-07)", async () => {
    _setConnectionsForTests({
        ro: { baseUrl: "http://r", apiToken: "t", writable: false },
    });
    const captured = [];
    _setCaptureRequest((req) => {
        captured.push(req);
        return {};
    });
    const res = await handleConnectPipelinesToStream({
        params: {
            arguments: {
                connectionName: "ro",
                streamId: "s1",
                pipelineIds: ["x"],
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "connection_read_only");
    assert.equal(captured.length, 0, "GET pre-flight must NOT fire on read-only connections");
});

test("connect_pipelines_to_stream paths: GET URL has streamId; POST URL is /to_stream literal", async () => {
    let getCaptured = null;
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/pipelines/connections/sX") {
            getCaptured = req;
            return { id: "c", stream_id: "sX", pipeline_ids: [] };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleConnectPipelinesToStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "sX",
                pipelineIds: ["one"],
            },
        },
    });
    assert.equal(getCaptured.path, "/api/system/pipelines/connections/sX");
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.path, "/api/system/pipelines/connections/to_stream");
});

test("connect_pipelines_to_stream apply on dryRun:false POSTs merged set to /to_stream", async () => {
    const captured = [];
    _setCaptureRequest((req) => {
        captured.push(req);
        if (req.method === "GET" && req.path === "/api/system/pipelines/connections/s1") {
            return { id: "conn1", stream_id: "s1", pipeline_ids: ["a", "b"] };
        }
        if (req.method === "POST" && req.path === "/api/system/pipelines/connections/to_stream") {
            return { id: "conn1", stream_id: "s1", pipeline_ids: ["a", "b", "new"] };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleConnectPipelinesToStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                pipelineIds: ["new"],
                dryRun: false,
            },
        },
    });
    const posts = captured.filter((r) => r.method === "POST");
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0].body.pipeline_ids, ["a", "b", "new"]);
    assert.equal(posts[0].body.stream_id, "s1");
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
});

// =====================================================================
// Plan 04-05 — disconnect_pipelines_from_stream (PIPE-14) — GET-subtract-PUT.
// Same wire endpoint as PIPE-13 (POST /to_stream — REPLACE semantics);
// wrapper subtracts client-side.
// =====================================================================

test("disconnect_pipelines_from_stream HAPPY (subtract): reduced set = current \\ args", async () => {
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/pipelines/connections/s1") {
            return { id: "conn1", stream_id: "s1", pipeline_ids: ["a", "b", "c"] };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleDisconnectPipelinesFromStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                pipelineIds: ["b"],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.method, "POST");
    assert.equal(payload.preview.path, "/api/system/pipelines/connections/to_stream");
    assert.equal(payload.preview.body.stream_id, "s1");
    assert.deepEqual(payload.preview.body.pipeline_ids, ["a", "c"]);
    assert.deepEqual(payload.existingMatches, []);
    assert.deepEqual(payload.postApplyEstimate.pipeline_ids, ["a", "c"]);
});

test("disconnect_pipelines_from_stream PITFALL 2 mirror: multi-detach preserves remaining; current=[a,b,c], args=[b,c] → body=[a]", async () => {
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/pipelines/connections/s1") {
            return { id: "conn1", stream_id: "s1", pipeline_ids: ["a", "b", "c"] };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleDisconnectPipelinesFromStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                pipelineIds: ["b", "c"],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // Pitfall 2 mirror — `a` is PRESERVED. A naive REPLACE with body.pipeline_ids=[]
    // would silently disconnect `a` too.
    assert.deepEqual(payload.preview.body.pipeline_ids, ["a"]);
});

test("disconnect_pipelines_from_stream detach-all: current=[a,b], args=[a,b] → body=[]", async () => {
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/pipelines/connections/s1") {
            return { id: "conn1", stream_id: "s1", pipeline_ids: ["a", "b"] };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleDisconnectPipelinesFromStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                pipelineIds: ["a", "b"],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(payload.preview.body.pipeline_ids, []);
});

test("disconnect_pipelines_from_stream no-op detach (already-not-connected): existingMatches surfaces not_currently_connected", async () => {
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/pipelines/connections/s1") {
            return { id: "conn1", stream_id: "s1", pipeline_ids: ["a", "b"] };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleDisconnectPipelinesFromStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                pipelineIds: ["x"],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // Reduced set unchanged
    assert.deepEqual(payload.preview.body.pipeline_ids, ["a", "b"]);
    assert.equal(payload.existingMatches.length, 1);
    assert.equal(payload.existingMatches[0].id, "x");
    assert.equal(payload.existingMatches[0].similarity_reason, "not_currently_connected");
});

test("disconnect_pipelines_from_stream 404 on GET → currentSet empty; existingMatches lists all args as not_currently_connected; POST fires with empty set", async () => {
    const captured = [];
    _setCaptureRequest((req) => {
        captured.push(req);
        if (req.method === "GET" && req.path === "/api/system/pipelines/connections/s_new") {
            throw new GraylogNotFoundError("no record yet", {
                status: 404,
                method: "GET",
                path: "/api/system/pipelines/connections/s_new",
                body: null,
            });
        }
        if (req.method === "POST" && req.path === "/api/system/pipelines/connections/to_stream") {
            return { id: "conn_new", stream_id: "s_new", pipeline_ids: [] };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleDisconnectPipelinesFromStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s_new",
                pipelineIds: ["y", "z"],
                dryRun: false,
            },
        },
    });
    assert.equal(res.isError, undefined);
    const posts = captured.filter((r) => r.method === "POST");
    assert.equal(posts.length, 1, "POST still fires on 404 path (consistency)");
    assert.deepEqual(posts[0].body.pipeline_ids, []);
});

test("disconnect_pipelines_from_stream 404 case dry-run: existingMatches lists all args as not_currently_connected", async () => {
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/pipelines/connections/s_new") {
            throw new GraylogNotFoundError("no record yet", {
                status: 404,
                method: "GET",
                path: "/api/system/pipelines/connections/s_new",
                body: null,
            });
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleDisconnectPipelinesFromStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s_new",
                pipelineIds: ["y", "z"],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(payload.preview.body.pipeline_ids, []);
    assert.equal(payload.existingMatches.length, 2);
    const reasons = payload.existingMatches.map((m) => m.similarity_reason);
    assert.deepEqual(reasons, ["not_currently_connected", "not_currently_connected"]);
});

test("disconnect_pipelines_from_stream deterministic sort: removes one entry; result sorted", async () => {
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/pipelines/connections/s1") {
            return { id: "conn1", stream_id: "s1", pipeline_ids: ["z", "a", "m"] };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleDisconnectPipelinesFromStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                pipelineIds: ["m"],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(payload.preview.body.pipeline_ids, ["a", "z"]);
});

test("disconnect_pipelines_from_stream 5xx on GET propagates; POST NEVER fires", async () => {
    const captured = [];
    _setCaptureRequest((req) => {
        captured.push(req);
        if (req.method === "GET" && req.path === "/api/system/pipelines/connections/s1") {
            throw new GraylogValidationError("internal", {
                status: 500,
                method: "GET",
                path: "/api/system/pipelines/connections/s1",
                body: null,
            });
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleDisconnectPipelinesFromStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                pipelineIds: ["a"],
                dryRun: false,
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /500/);
    const posts = captured.filter((r) => r.method === "POST");
    assert.equal(posts.length, 0);
});

test("disconnect_pipelines_from_stream writable:false short-circuits BEFORE the GET fires", async () => {
    _setConnectionsForTests({
        ro: { baseUrl: "http://r", apiToken: "t", writable: false },
    });
    const captured = [];
    _setCaptureRequest((req) => {
        captured.push(req);
        return {};
    });
    const res = await handleDisconnectPipelinesFromStream({
        params: {
            arguments: {
                connectionName: "ro",
                streamId: "s1",
                pipelineIds: ["a"],
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "connection_read_only");
    assert.equal(captured.length, 0);
});

test("disconnect_pipelines_from_stream apply on dryRun:false POSTs reduced set to /to_stream", async () => {
    const captured = [];
    _setCaptureRequest((req) => {
        captured.push(req);
        if (req.method === "GET" && req.path === "/api/system/pipelines/connections/s1") {
            return { id: "conn1", stream_id: "s1", pipeline_ids: ["a", "b", "c"] };
        }
        if (req.method === "POST" && req.path === "/api/system/pipelines/connections/to_stream") {
            return { id: "conn1", stream_id: "s1", pipeline_ids: ["a", "c"] };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleDisconnectPipelinesFromStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "s1",
                pipelineIds: ["b"],
                dryRun: false,
            },
        },
    });
    const posts = captured.filter((r) => r.method === "POST");
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0].body.pipeline_ids, ["a", "c"]);
    assert.equal(posts[0].body.stream_id, "s1");
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
});
