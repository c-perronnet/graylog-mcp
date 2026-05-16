import { test } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";
import { executeChain, substitutePlaceholders } from "../src/tools/_shared/blueprint-chain.js";
import { SERVER_ASSIGNED_SENTINEL } from "../src/tools/_shared/dry-run.js";

// Plan 06-01 Task 2 — blueprint-chain helper (executeChain + substitutePlaceholders).
// Sequential walk with placeholder substitution + partial-failure transcript.

function makeFakeClient(mockResponses) {
    const calls = [];
    const queue = [...mockResponses];
    const client = {
        async request(method, path, body) {
            calls.push({ method, path, body });
            const next = queue.shift();
            if (next instanceof Error) throw next;
            return next;
        },
    };
    return { client, calls };
}

test("executeChain happy path with no deps → returns {applied:true, transcript}", async () => {
    const { client, calls } = makeFakeClient([{ id: "id-1" }, { id: "id-2" }]);
    const chain = [
        { step: 1, tool: "create_stream", request: { method: "POST", path: "/api/streams", body: { title: "S1" } } },
        { step: 2, tool: "create_pipeline", request: { method: "POST", path: "/api/system/pipelines/pipeline", body: { title: "P1", source: "" } } },
    ];
    const result = await executeChain(client, chain);

    assert.equal(result.applied, true);
    assert.equal(result.transcript.length, 2);
    assert.equal(result.transcript[0].step, 1);
    assert.equal(result.transcript[0].tool, "create_stream");
    assert.deepEqual(result.transcript[0].response, { id: "id-1" });
    assert.equal(result.transcript[1].step, 2);
    assert.deepEqual(result.transcript[1].response, { id: "id-2" });
    assert.equal(calls.length, 2);
});

test("executeChain substitutes __SERVER_ASSIGNED__step1 in step 2 body", async () => {
    const { client, calls } = makeFakeClient([{ id: "S-1" }, { id: "P-2" }]);
    const chain = [
        { step: 1, tool: "create_stream", request: { method: "POST", path: "/api/streams", body: { title: "S1" } } },
        {
            step: 2,
            tool: "create_pipeline_connection",
            dependsOn: { from: "step1.response.id", as: "streamId" },
            request: {
                method: "POST",
                path: "/api/test",
                body: { streamId: `${SERVER_ASSIGNED_SENTINEL}step1` },
            },
        },
    ];
    const result = await executeChain(client, chain);

    assert.equal(result.applied, true);
    // Step 2's actual body sent to client MUST be substituted
    assert.deepEqual(calls[1].body, { streamId: "S-1" });
});

test("executeChain substitutes placeholders in path", async () => {
    const { client, calls } = makeFakeClient([{ id: "S-1" }, { ok: true }]);
    const chain = [
        { step: 1, tool: "create_stream", request: { method: "POST", path: "/api/streams", body: { title: "S1" } } },
        {
            step: 2,
            tool: "connect_pipeline",
            dependsOn: { from: "step1.response.id", as: "streamId" },
            request: {
                method: "POST",
                path: `/api/streams/${SERVER_ASSIGNED_SENTINEL}step1/connect`,
                body: {},
            },
        },
    ];
    const result = await executeChain(client, chain);

    assert.equal(result.applied, true);
    assert.equal(calls[1].path, "/api/streams/S-1/connect");
});

test("executeChain handles array-shape dependsOn (step depends on TWO prior steps)", async () => {
    const { client, calls } = makeFakeClient([
        { id: "X1" },
        { id: "X2" },
        { ok: true },
    ]);
    const chain = [
        { step: 1, tool: "create_stream", request: { method: "POST", path: "/api/streams", body: {} } },
        { step: 2, tool: "create_pipeline", request: { method: "POST", path: "/api/system/pipelines/pipeline", body: {} } },
        {
            step: 3,
            tool: "connect_pipeline_to_stream",
            dependsOn: [
                { from: "step1.response.id", as: "a" },
                { from: "step2.response.id", as: "b" },
            ],
            request: {
                method: "POST",
                path: "/api/system/pipelines/connections/to_stream",
                body: {
                    stream_id: `${SERVER_ASSIGNED_SENTINEL}step1`,
                    pipeline_ids: [`${SERVER_ASSIGNED_SENTINEL}step2`],
                },
            },
        },
    ];
    const result = await executeChain(client, chain);

    assert.equal(result.applied, true);
    assert.deepEqual(calls[2].body, {
        stream_id: "X1",
        pipeline_ids: ["X2"],
    });
});

test("executeChain returns partial-failure envelope on step throw", async () => {
    const { client } = makeFakeClient([
        { id: "id-1" },
        new Error("Graylog POST /api/system/pipelines/pipeline failed: 500"),
        { id: "id-3" },
    ]);
    const chain = [
        { step: 1, tool: "create_stream", request: { method: "POST", path: "/api/streams", body: {} } },
        { step: 2, tool: "create_pipeline", request: { method: "POST", path: "/api/system/pipelines/pipeline", body: {} } },
        { step: 3, tool: "create_widget", request: { method: "POST", path: "/api/views", body: {} } },
    ];
    const result = await executeChain(client, chain);

    assert.equal(result.isError, true);
    assert.equal(result.reason, "blueprint_chain_partial_failure");
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.failed_at_step, 2);
    assert.deepEqual(payload.succeeded_steps, [1]);
    // Transcript should include step 1's success entry and step 2's error entry,
    // but NOT step 3 (chain short-circuited).
    assert.equal(payload.transcript.length, 2);
    assert.equal(payload.transcript[0].step, 1);
    assert.equal(payload.transcript[1].step, 2);
    assert.ok(payload.transcript[1].error);
});

test("executeChain returns unresolved-dependency envelope when prior step's response.id missing", async () => {
    const { client } = makeFakeClient([
        { notAnId: "x" },  // step 1 response lacks response.id
        { id: "P-2" },
    ]);
    const chain = [
        { step: 1, tool: "create_stream", request: { method: "POST", path: "/api/streams", body: {} } },
        {
            step: 2,
            tool: "create_pipeline",
            dependsOn: { from: "step1.response.id", as: "streamId" },
            request: {
                method: "POST",
                path: "/api/test",
                body: { streamId: `${SERVER_ASSIGNED_SENTINEL}step1` },
            },
        },
    ];
    const result = await executeChain(client, chain);

    assert.equal(result.isError, true);
    assert.equal(result.reason, "blueprint_chain_unresolved_dependency");
    const payload = JSON.parse(result.content[0].text);
    assert.deepEqual(payload.missing_dependency, { from: "step1.response.id", as: "streamId" });
});

// Bonus: substitutePlaceholders walker — pure-function sanity
test("substitutePlaceholders is a no-op on primitive non-string values", () => {
    const subs = { [`${SERVER_ASSIGNED_SENTINEL}step1`]: "X" };
    assert.equal(substitutePlaceholders(42, undefined, subs), 42);
    assert.equal(substitutePlaceholders(null, undefined, subs), null);
    assert.equal(substitutePlaceholders(true, undefined, subs), true);
    assert.equal(substitutePlaceholders(undefined, undefined, subs), undefined);
});

test("substitutePlaceholders recurses into nested objects and arrays", () => {
    const subs = { [`${SERVER_ASSIGNED_SENTINEL}step1`]: "real-id" };
    const obj = {
        outer: {
            inner: `${SERVER_ASSIGNED_SENTINEL}step1`,
            list: [
                "plain",
                `${SERVER_ASSIGNED_SENTINEL}step1`,
                { nested: `${SERVER_ASSIGNED_SENTINEL}step1` },
            ],
        },
    };
    const out = substitutePlaceholders(obj, undefined, subs);
    assert.equal(out.outer.inner, "real-id");
    assert.equal(out.outer.list[0], "plain");
    assert.equal(out.outer.list[1], "real-id");
    assert.equal(out.outer.list[2].nested, "real-id");
});
