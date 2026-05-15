// Plan 00-05 Pitfall-1 regression net.
//
// Captures byte-precise snapshots of read-tool responses through the Map
// dispatch (FOUND-01). Task 1 generated the baseline by calling handlers
// directly; Task 2 routes the same fixtures through src/dispatch.js's
// dispatch() to prove the Map produces byte-identical responses. Any
// non-empty snapshot diff between Task 1 and Task 2 is a hard failure
// (Pitfall 1: do NOT regenerate the snapshot).

import { test, beforeEach, afterEach } from "node:test";
import "../snapshot-config.js";
import { dispatch } from "../../src/dispatch.js";
// Side-effect import: populates the dispatch registry. Tests below cannot
// call _clearForTests() at top-level — that would unregister the production
// handlers. dispatch.test.js uses _clearForTests() in its own beforeEach but
// in a separate process under `node --test`, so isolation is automatic.
import "../../src/tools/_register.js";
import { _setConnectionsForTests, _clearConnectionsForTests, setActiveConnection } from "../../src/config.js";

beforeEach(() => {
    _setConnectionsForTests({
        test_a: { baseUrl: "http://test-a.example", apiToken: "token_a" },
        test_b: { baseUrl: "http://test-b.example", apiToken: "token_b" },
    });
    setActiveConnection(null);
});
afterEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
});

test("regression: list_connections returns deterministic listing", async (t) => {
    const res = await dispatch({ params: { name: "list_connections", arguments: {} } });
    t.assert.snapshot({
        isError: res.isError ?? false,
        contentType: res.content[0].type,
        text: res.content[0].text,
    });
});

test("regression: use_connection switches active connection", async (t) => {
    const res = await dispatch({ params: { name: "use_connection", arguments: { name: "test_a" } } });
    t.assert.snapshot({
        isError: res.isError ?? false,
        contentType: res.content[0].type,
        text: res.content[0].text,
    });
});

test("regression: use_connection rejects missing name", async (t) => {
    const res = await dispatch({ params: { name: "use_connection", arguments: {} } });
    t.assert.snapshot({
        isError: res.isError ?? false,
        contentType: res.content[0].type,
        text: res.content[0].text,
    });
});

test("regression: use_connection unknown name → not-found error response", async (t) => {
    const res = await dispatch({ params: { name: "use_connection", arguments: { name: "no_such_connection_xyz" } } });
    t.assert.snapshot({
        isError: res.isError ?? false,
        contentType: res.content[0].type,
        text: res.content[0].text,
    });
});

test("regression: list_saved_searches returns deterministic shape", async (t) => {
    const res = await dispatch({ params: { name: "list_saved_searches", arguments: {} } });
    // Snapshot shape only — items depend on ~/.graylog-mcp/saved-searches.json
    t.assert.snapshot({
        isError: res.isError ?? false,
        contentType: res.content[0].type,
        hasText: typeof res.content[0].text === "string",
    });
});

test("regression: get_saved_search without name → error", async (t) => {
    const res = await dispatch({ params: { name: "get_saved_search", arguments: {} } });
    t.assert.snapshot({
        isError: res.isError ?? false,
        contentType: res.content[0].type,
        text: res.content[0].text,
    });
});

test("regression: list_log_templates via _testConnection seam", async (t) => {
    const res = await dispatch({
        params: { name: "list_log_templates", arguments: { _testConnection: "_regression_fixture", limit: 50 } },
    });
    // Snapshot the response envelope shape — template-store contents on disk
    // for the _regression_fixture connection are inherently non-deterministic
    // (they live under ~/.graylog-mcp/ and persist across runs).
    t.assert.snapshot({
        isError: res.isError ?? false,
        contentType: res.content[0].type,
        hasText: typeof res.content[0].text === "string",
        topLevelKeys: Object.keys(JSON.parse(res.content[0].text)).sort(),
    });
});

test("regression: fetch_graylog_messages without active connection → error envelope", async (t) => {
    // Override the connections registry with an EMPTY map so the error message
    // is deterministic across developer machines (vs. falling back to whatever
    // is in ~/.graylog-mcp/config.json).
    _setConnectionsForTests({});
    setActiveConnection(null);
    const res = await dispatch({
        params: { name: "fetch_graylog_messages", arguments: { query: "*" } },
    });
    t.assert.snapshot({
        isError: res.isError ?? false,
        contentType: res.content[0].type,
        text: res.content[0].text,
    });
});
