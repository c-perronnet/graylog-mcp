import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";
import { z } from "zod";
import { defineMutatingHandler } from "../src/tools/_shared/handler.js";
import { mutatingBase } from "../src/tools/_shared/schemas.js";
import {
    _setCaptureRequest,
    _clearCaptureRequest,
} from "../src/graylog/client.js";
import { GraylogConflictError } from "../src/graylog/errors.js";
import {
    _setConnectionsForTests,
    _clearConnectionsForTests,
    setActiveConnection,
} from "../src/config.js";

// FOUND-03 / FOUND-04 / FOUND-05 / FOUND-09 / FOUND-10 / FOUND-11.
// defineMutatingHandler composes leaf primitives (errors/schemas/connection/
// idempotency/dry-run) into the single factory every mutating tool will use.

const TestSchema = mutatingBase.extend({
    title: z.string().min(1),
});

function fixtureHandler(overrides = {}) {
    return defineMutatingHandler({
        name: "create_stream",
        schema: TestSchema,
        build: overrides.build ?? ((args) => ({
            method: "POST",
            path: "/api/streams",
            body: { title: args.title },
        })),
        apply: overrides.apply ?? (async (client, req) =>
            client.request(req.method, req.path, req.body)
        ),
        summarize: overrides.summarize,
    });
}

beforeEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
});

afterEach(() => {
    _clearCaptureRequest();
    _clearConnectionsForTests();
    setActiveConnection(null);
});

// -------- 1. Dry-run by default (FOUND-04 + C6) --------

test("dry-run by default — emits preview with __SERVER_ASSIGNED__ and existingMatches", async () => {
    let captured = false;
    _setCaptureRequest(() => { captured = true; return {}; });
    const handler = fixtureHandler();
    const res = await handler({
        params: { arguments: { title: "T", _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.postApplyEstimate.id, "__SERVER_ASSIGNED__");
    assert.deepEqual(payload.existingMatches, []);
    assert.equal(payload.connection, "fake");
    assert.equal(payload.tool, "create_stream");
    assert.ok(payload.idempotencyKey, "auto-derived idempotency key");
    assert.match(payload.idempotencyKey, /^[a-f0-9]{32}$/);
    assert.equal(payload.preview.method, "POST");
    assert.equal(payload.preview.path, "/api/streams");
    assert.deepEqual(payload.preview.body, { title: "T" });
    assert.match(payload.applyHint, /dryRun: false/);
    assert.equal(captured, false, "apply MUST NOT be called on dry-run");
});

// -------- 2. Zod validation failure → isError --------

test("invalid args (empty title) → isError with formatZodError", async () => {
    const handler = fixtureHandler();
    const res = await handler({
        params: { arguments: { title: "", _testConnection: "fake" } },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /title/);
});

// -------- 3. Writable=false short-circuits BEFORE build --------

test("writable=false connection → connection_read_only, build never called", async () => {
    let buildCalled = false;
    let applyCalled = false;
    const handler = defineMutatingHandler({
        name: "create_stream",
        schema: TestSchema,
        build: (args) => {
            buildCalled = true;
            return { method: "POST", path: "/p", body: {} };
        },
        apply: async () => {
            applyCalled = true;
            throw new Error("must not be called");
        },
    });

    _setConnectionsForTests({
        readonly: { baseUrl: "_test", apiToken: "_test", writable: false },
    });

    const res = await handler({
        params: { arguments: { title: "T", connectionName: "readonly" } },
    });

    assert.equal(res.isError, true);
    assert.equal(res.reason, "connection_read_only");
    assert.equal(buildCalled, false, "build() must NOT be called when writable=false");
    assert.equal(applyCalled, false, "apply() must NOT be called when writable=false");
    assert.match(res.content[0].text, /read-only/i);
    assert.match(res.content[0].text, /readonly/);
});

// -------- 4. dryRun=false invokes apply via client --------

test("dryRun=false invokes apply via client", async () => {
    let captured = null;
    _setCaptureRequest((args) => {
        captured = args;
        return { stream_id: "S1", title: "T" };
    });
    const handler = fixtureHandler();
    const res = await handler({
        params: {
            arguments: { title: "T", _testConnection: "fake", dryRun: false },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, false);
    assert.equal(payload.applied, true);
    assert.equal(payload.tool, "create_stream");
    assert.equal(payload.connection, "fake");
    assert.ok(payload.idempotencyKey);
    assert.equal(captured.method, "POST");
    assert.equal(captured.path, "/api/streams");
    assert.deepEqual(captured.body, { title: "T" });
});

// -------- 5. Idempotency key determinism --------

test("identical args produce identical idempotency keys (FOUND-10 determinism)", async () => {
    const handler = fixtureHandler();
    const r1 = await handler({
        params: { arguments: { title: "T", _testConnection: "fake" } },
    });
    const r2 = await handler({
        params: { arguments: { title: "T", _testConnection: "fake" } },
    });
    const k1 = JSON.parse(r1.content[0].text).idempotencyKey;
    const k2 = JSON.parse(r2.content[0].text).idempotencyKey;
    assert.equal(k1, k2);
});

// -------- 6. Agent-provided idempotency key preserved --------

test("agent-provided idempotencyKey overrides auto-derivation", async () => {
    const handler = fixtureHandler();
    const res = await handler({
        params: {
            arguments: {
                title: "T",
                _testConnection: "fake",
                idempotencyKey: "agent-key-123",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.idempotencyKey, "agent-key-123");
});

// -------- 7. Apply throwing GraylogConflictError → wrapped MCP error --------

test("apply() throwing GraylogConflictError → MCP error via wrapGraylogError", async () => {
    _setCaptureRequest(() => {
        throw new GraylogConflictError("duplicate title", {
            status: 409,
            method: "POST",
            path: "/api/streams",
            body: { message: "Stream already exists" },
        });
    });
    const handler = fixtureHandler();
    const res = await handler({
        params: {
            arguments: { title: "T", _testConnection: "fake", dryRun: false },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /create_stream/);
    assert.match(res.content[0].text, /duplicate/);
});

// -------- 8. existingMatches surfaces from build() --------

test("build() returning existingMatches surfaces them in dry-run preview", async () => {
    const handler = defineMutatingHandler({
        name: "create_stream",
        schema: TestSchema,
        build: (args) => ({
            method: "POST",
            path: "/api/streams",
            body: { title: args.title },
            existingMatches: [{ id: "S0", title: args.title, similarity_reason: "exact" }],
        }),
        apply: async () => ({}),
    });
    const res = await handler({
        params: { arguments: { title: "T", _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.existingMatches.length, 1);
    assert.equal(payload.existingMatches[0].id, "S0");
    assert.equal(payload.existingMatches[0].similarity_reason, "exact");
});

// -------- 9. Connection resolution error short-circuits before build --------

test("missing connection → resolveConnection error short-circuits", async () => {
    let buildCalled = false;
    const handler = defineMutatingHandler({
        name: "create_stream",
        schema: TestSchema,
        build: () => {
            buildCalled = true;
            return { method: "POST", path: "/p", body: {} };
        },
        apply: async () => ({}),
    });
    _setConnectionsForTests({});
    // No connectionName, no active connection, no _testConnection — should error.
    const res = await handler({
        params: { arguments: { title: "T" } },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /No active connection/i);
    assert.equal(buildCalled, false);
});

// -------- 10. Summarize callback used when provided --------

test("summarize callback surfaces in dry-run preview", async () => {
    const handler = fixtureHandler({
        summarize: (args, req) => `Create stream "${args.title}"`,
    });
    const res = await handler({
        params: { arguments: { title: "Errors", _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.summary, `Create stream "Errors"`);
});
