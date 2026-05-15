// FOUND-01 unit tests for src/dispatch.js.
//
// Tests run in a separate node:test process from test/regression/, so the
// production registry populated by importing src/tools/_register.js in the
// regression suite is NOT visible here. We start each test from a clean
// registry via _clearForTests() in beforeEach.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";
import {
    register,
    dispatch,
    assertAllToolsRegistered,
    _clearForTests,
} from "../src/dispatch.js";

beforeEach(() => {
    _clearForTests();
});

test("register + dispatch routes a registered handler", async () => {
    register("ping", async () => ({ content: [{ type: "text", text: "pong" }] }));
    const res = await dispatch({ params: { name: "ping", arguments: {} } });
    assert.equal(res.content[0].text, "pong");
});

test("dispatch returns the handler's exact response object", async () => {
    const fixture = { content: [{ type: "text", text: "fixture" }], isError: false };
    register("fx", () => fixture);
    const res = await dispatch({ params: { name: "fx", arguments: {} } });
    assert.equal(res, fixture);
});

test("dispatch forwards the request argument to the handler", async () => {
    let captured = null;
    register("echo", (req) => {
        captured = req;
        return { content: [{ type: "text", text: "ok" }] };
    });
    const request = { params: { name: "echo", arguments: { a: 1, b: 2 } } };
    await dispatch(request);
    assert.equal(captured, request);
});

test("duplicate register throws with the offending name", () => {
    register("a", async () => ({}));
    assert.throws(
        () => register("a", async () => ({})),
        /Tool already registered: a/
    );
});

test("dispatch unknown tool throws with 'Tool not found' message", async () => {
    await assert.rejects(
        () => dispatch({ params: { name: "ghost", arguments: {} } }),
        /Tool not found: ghost/
    );
});

test("dispatch on empty params throws 'Tool not found: undefined'", async () => {
    await assert.rejects(
        () => dispatch({ params: {} }),
        /Tool not found: undefined/
    );
});

test("register rejects non-function handler", () => {
    assert.throws(
        () => register("bad", "not a function"),
        /not a function/
    );
});

test("register rejects null handler", () => {
    assert.throws(
        () => register("nullish", null),
        /not a function/
    );
});

test("assertAllToolsRegistered passes when every tool has a handler", () => {
    register("a", async () => ({}));
    register("b", async () => ({}));
    // Should not throw
    assertAllToolsRegistered([{ name: "a" }, { name: "b" }]);
});

test("assertAllToolsRegistered throws listing every missing handler", () => {
    register("a", async () => ({}));
    assert.throws(
        () => assertAllToolsRegistered([
            { name: "a" },
            { name: "missing1" },
            { name: "missing2" },
        ]),
        /missing1.*missing2/
    );
});

test("assertAllToolsRegistered with empty toolDefinitions does not throw", () => {
    assertAllToolsRegistered([]);
});

test("_clearForTests empties the registry", async () => {
    register("temp", async () => ({}));
    _clearForTests();
    await assert.rejects(
        () => dispatch({ params: { name: "temp", arguments: {} } }),
        /Tool not found: temp/
    );
});

// =====================================================================
// FOUND-07: Snapshot fixtures (Plan 00-06)
// =====================================================================

// FOUND-07 fixture 9: dispatch — unknown tool error message
test("snapshot: dispatch unknown tool error message", async (t) => {
    let errMsg;
    try {
        await dispatch({ params: { name: "snapshot_ghost", arguments: {} } });
    } catch (err) {
        errMsg = err.message;
    }
    t.assert.snapshot({ errorMessage: errMsg });
});

// FOUND-07 fixture 10: assertAllToolsRegistered — missing-handler error message
test("snapshot: assertAllToolsRegistered missing-handler error message", (t) => {
    register("a", async () => ({}));
    let errMsg;
    try {
        assertAllToolsRegistered([
            { name: "a" },
            { name: "ghost_x" },
            { name: "ghost_y" },
        ]);
    } catch (err) {
        errMsg = err.message;
    }
    t.assert.snapshot({ errorMessage: errMsg });
});
