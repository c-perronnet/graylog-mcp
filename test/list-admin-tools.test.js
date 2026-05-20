// HARD-02 — list_admin_tools meta-tool tests.
//
// Phase 7 Plan 02 ships a pure-static meta-tool that returns a domain-grouped
// inventory of every registered tool. This test file pins the contract:
//   1. No-args → all 91 tools grouped by domain (≥ 9 known domains).
//   2. domain filter → only that domain's items.
//   3. unknown domain → warning + empty items + available_domains.
//   4. inventory covers EVERY dispatch-Map entry (zero-uncategorized invariant).
//   5. summary truncation ≤ 120 chars.
//   6. Pure-static: works WITHOUT an active Graylog connection (Pitfall M7).

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";

import { dispatch } from "../src/dispatch.js";
import "../src/tools/_register.js";
import { toolDefinitions } from "../src/tools.js";
import {
    _setConnectionsForTests,
    _clearConnectionsForTests,
    setActiveConnection,
} from "../src/config.js";

const KNOWN_DOMAINS = [
    "authz",
    "blueprints",
    "dashboards",
    "events",
    "index_sets",
    "inputs",
    "meta",
    "pipelines",
    "search",
    "streams",
];

beforeEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
});

afterEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
});

test("list_admin_tools with no args returns all 94 tools grouped by domain", async () => {
    const res = await dispatch({
        params: { name: "list_admin_tools", arguments: {} },
    });
    assert.ok(!res.isError, `expected non-error response, got ${JSON.stringify(res)}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "list_admin_tools");
    assert.equal(payload.count, 94, `expected 94 tools (91 v3.0.0 + get_entity_shares + list_grantees + share_entity), got ${payload.count}`);
    assert.ok(payload.domains, "payload.domains must be present");
    const domainKeys = Object.keys(payload.domains).sort();
    for (const dom of KNOWN_DOMAINS) {
        assert.ok(domainKeys.includes(dom), `expected domain "${dom}" in payload.domains; got [${domainKeys.join(", ")}]`);
    }
    // Hard guard against the "uncategorized" fallthrough: this domain must NOT exist.
    assert.ok(!domainKeys.includes("uncategorized"), `uncategorized fallthrough detected — extend DOMAIN_OVERRIDES/DOMAIN_FROM_SEGMENT for: ${JSON.stringify(payload.domains.uncategorized ?? [])}`);
});

test("list_admin_tools({ domain: 'streams' }) returns only stream-domain tools", async () => {
    const res = await dispatch({
        params: { name: "list_admin_tools", arguments: { domain: "streams" } },
    });
    assert.ok(!res.isError, `expected non-error response, got ${JSON.stringify(res)}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "list_admin_tools");
    assert.equal(payload.domain, "streams");
    assert.ok(Array.isArray(payload.items), "items must be an array");
    // Phase 3 ships 12 stream-domain tools per the plan body:
    // list_streams, get_stream, create_stream, update_stream, delete_stream,
    // start_stream, pause_stream, list_stream_rules, create_stream_rule,
    // update_stream_rule, delete_stream_rule, test_stream_match
    assert.equal(payload.items.length, 12, `expected 12 streams-domain tools, got ${payload.items.length}: ${payload.items.map(i => i.name).join(", ")}`);
    for (const item of payload.items) {
        assert.match(item.name, /stream/i, `tool "${item.name}" classified into "streams" but name has no "stream" substring`);
    }
});

test("list_admin_tools({ domain: 'unknown_domain' }) returns empty items + warning", async () => {
    const res = await dispatch({
        params: { name: "list_admin_tools", arguments: { domain: "unknown_domain" } },
    });
    assert.ok(!res.isError);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.items.length, 0);
    assert.equal(payload.warning, "domain_not_found");
    assert.ok(Array.isArray(payload.available_domains));
    // available_domains must be sorted
    const sorted = [...payload.available_domains].sort();
    assert.deepEqual(payload.available_domains, sorted, "available_domains must be sorted");
    // Must include the known 9 domains.
    for (const dom of KNOWN_DOMAINS) {
        assert.ok(payload.available_domains.includes(dom), `available_domains missing "${dom}"`);
    }
});

test("list_admin_tools inventory covers every entry in src/tools.js (no orphans, no extras)", async () => {
    const res = await dispatch({
        params: { name: "list_admin_tools", arguments: {} },
    });
    const payload = JSON.parse(res.content[0].text);
    const inventoryNames = new Set(payload.items.map((i) => i.name));
    const definedNames = new Set(toolDefinitions.map((t) => t.name));
    // Each direction: every defined tool appears in the inventory, and the
    // inventory does not invent names.
    for (const name of definedNames) {
        assert.ok(inventoryNames.has(name), `tool "${name}" defined in src/tools.js but missing from list_admin_tools inventory`);
    }
    for (const name of inventoryNames) {
        assert.ok(definedNames.has(name), `tool "${name}" appears in list_admin_tools inventory but not in src/tools.js`);
    }
});

test("list_admin_tools each item has { name, domain, summary } with summary ≤120 chars", async () => {
    const res = await dispatch({
        params: { name: "list_admin_tools", arguments: {} },
    });
    const payload = JSON.parse(res.content[0].text);
    for (const item of payload.items) {
        assert.equal(typeof item.name, "string", `item ${JSON.stringify(item)} missing name`);
        assert.equal(typeof item.domain, "string", `item ${item.name} missing domain`);
        assert.equal(typeof item.summary, "string", `item ${item.name} missing summary`);
        assert.ok(item.summary.length > 0, `item ${item.name} has empty summary`);
        assert.ok(item.summary.length <= 120, `item ${item.name} summary too long (${item.summary.length} > 120): "${item.summary}"`);
    }
});

test("list_admin_tools is pure-static — no Graylog connection required", async () => {
    // Explicitly clear the registry to mimic a fresh process with no
    // set_active_connection call.
    _clearConnectionsForTests();
    setActiveConnection(null);
    const res = await dispatch({
        params: { name: "list_admin_tools", arguments: {} },
    });
    assert.ok(!res.isError, `meta-tool must NOT require a connection; got ${JSON.stringify(res)}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.count, 94);
});
