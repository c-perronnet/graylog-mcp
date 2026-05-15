import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";
import { resolveConnection } from "../src/tools/_shared/connection.js";
import {
    getConnectionWritable,
    _setConnectionsForTests,
    _clearConnectionsForTests,
    setActiveConnection,
} from "../src/config.js";

// FOUND-09 + D-07 (wrapper-side) — resolveConnection + getConnectionWritable.
//
// Test seam usage:
//   - args._testConnection: project-standard magic arg (cluster-errors.js / template-mgmt.js
//     pattern) — returns a synthetic { conn, name } without touching the config module.
//   - _setConnectionsForTests / _clearConnectionsForTests: additive seam this plan adds to
//     src/config.js so we can drive the connection registry in unit tests without a real
//     ~/.graylog-mcp/config.json. Cleared in afterEach to prevent cross-test bleed.

beforeEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
});

afterEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
});

// -------- _testConnection seam --------

test("_testConnection seam returns synthetic conn (project convention)", () => {
    const r = resolveConnection({ _testConnection: "fake" });
    assert.equal(r.name, "fake");
    assert.ok(r.conn, "conn must be present");
    assert.equal(r.conn.baseUrl, "_test");
    assert.equal(r.conn.apiToken, "_test");
    // The synthetic conn must NOT carry writable: false — that would defeat
    // the seam in tests that aren't specifically exercising the writable gate.
    assert.notEqual(r.conn.writable, false);
});

// -------- Per-call connectionName (FOUND-09) --------

test("connectionName resolves to the named connection in the registry", () => {
    _setConnectionsForTests({
        prod: { baseUrl: "https://prod.graylog", apiToken: "p1" },
        staging: { baseUrl: "https://stg.graylog", apiToken: "s1" },
    });
    const r = resolveConnection({ connectionName: "prod" });
    assert.equal(r.name, "prod");
    assert.equal(r.conn.baseUrl, "https://prod.graylog");
    assert.equal(r.conn.apiToken, "p1");
    assert.equal(r.error, undefined);
});

test("connectionName: missing connection returns { error } with available list", () => {
    _setConnectionsForTests({
        prod: { baseUrl: "https://prod.graylog", apiToken: "p1" },
    });
    const r = resolveConnection({ connectionName: "ghost" });
    assert.ok(r.error, "error must be present");
    assert.equal(r.error.isError, true);
    assert.match(r.error.content[0].text, /ghost/);
    assert.match(r.error.content[0].text, /prod/);
});

test("connectionName: empty registry yields 'none' in error", () => {
    _setConnectionsForTests({});
    const r = resolveConnection({ connectionName: "ghost" });
    assert.ok(r.error);
    assert.match(r.error.content[0].text, /none/);
});

// -------- Singleton fallback (D-08) --------

test("no connectionName + active singleton returns the active connection", () => {
    _setConnectionsForTests({
        prod: { baseUrl: "https://prod.graylog", apiToken: "p1" },
    });
    setActiveConnection("prod");
    const r = resolveConnection({});
    assert.equal(r.name, "prod");
    assert.equal(r.conn.baseUrl, "https://prod.graylog");
});

test("no connectionName + no active connection returns { error }", () => {
    _setConnectionsForTests({
        prod: { baseUrl: "https://prod.graylog", apiToken: "p1" },
    });
    // setActiveConnection(null) handled in beforeEach
    const r = resolveConnection({});
    assert.ok(r.error);
    assert.match(r.error.content[0].text, /No active connection/i);
    assert.match(r.error.content[0].text, /prod/, "error should list available connections");
});

// -------- getConnectionWritable --------

test("getConnectionWritable: returns true when 'writable' field is absent", () => {
    _setConnectionsForTests({
        prod: { baseUrl: "u", apiToken: "t" }, // writable undefined
    });
    assert.equal(getConnectionWritable("prod"), true);
});

test("getConnectionWritable: returns false when explicitly writable: false", () => {
    _setConnectionsForTests({
        readonly_prod: { baseUrl: "u", apiToken: "t", writable: false },
    });
    assert.equal(getConnectionWritable("readonly_prod"), false);
});

test("getConnectionWritable: returns true when writable: true is explicit", () => {
    _setConnectionsForTests({
        prod: { baseUrl: "u", apiToken: "t", writable: true },
    });
    assert.equal(getConnectionWritable("prod"), true);
});

test("getConnectionWritable: returns undefined for missing connection", () => {
    _setConnectionsForTests({
        prod: { baseUrl: "u", apiToken: "t" },
    });
    assert.equal(getConnectionWritable("ghost"), undefined);
});
