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
});

afterEach(() => {
    _clearCaptureRequest();
    _clearConnectionsForTests();
    setActiveConnection(null);
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

test("assertAllToolsRegistered passes after Plan 04-02 registers 5 new pipeline tools (count = 59)", async () => {
    const { dispatch, assertAllToolsRegistered } = await import("../src/dispatch.js");
    await import("../src/tools/_register.js");
    const { toolDefinitions } = await import("../src/tools.js");
    assertAllToolsRegistered(toolDefinitions);
    assert.equal(typeof dispatch, "function");
    // Plan 04-01 left the tool count at 54 (no tools registered); Plan 04-02
    // adds 5 (PIPE-01..PIPE-05) → 59 total. If the count drifts, this test
    // fails loudly and we know to update the plan.
    assert.equal(toolDefinitions.length, 59, `Expected 59 tools after Plan 04-02; got ${toolDefinitions.length}`);
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
