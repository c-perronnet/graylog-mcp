#!/usr/bin/env node
import assert from "node:assert/strict";
import { normalizeMessage, tokenize } from "./src/clustering/preprocess.js";

console.log("=== Preprocessor ===");

// Numbers → <*>
assert.equal(normalizeMessage("user 42 failed"), "user <*> failed");

// UUIDs → <*>
assert.equal(
    normalizeMessage("trace 550e8400-e29b-41d4-a716-446655440000 done"),
    "trace <*> done"
);

// IPv4 → <*>
assert.equal(normalizeMessage("client 192.168.1.10 connected"), "client <*> connected");

// IPv6 → <*>
assert.equal(normalizeMessage("from 2001:db8::1 ok"), "from <*> ok");

// ISO timestamps → <*>
assert.equal(
    normalizeMessage("at 2026-05-04T10:00:00Z event"),
    "at <*> event"
);

// Long hex → <*>
assert.equal(normalizeMessage("hash deadbeefcafebabe1234"), "hash <*>");

// Tokenize splits on whitespace
assert.deepEqual(tokenize("user <*> failed"), ["user", "<*>", "failed"]);

console.log("✓ preprocessor tests passed");

console.log("=== Registry ===");
import { register, get, list, _clearForTests } from "./src/clustering/index.js";

_clearForTests();

const fakeStrategy = {
    name: "fake",
    version: 1,
    hydrate: () => ({}),
    serialize: () => ({}),
    cluster: () => ({ assignments: [], templates: [] }),
};

register("fake", fakeStrategy);
assert.equal(get("fake"), fakeStrategy);
assert.deepEqual(list(), ["fake"]);

assert.throws(() => register("fake", fakeStrategy), /already registered/);
assert.throws(() => get("missing"), /Unknown clustering algorithm "missing"\. Registered: fake/);

console.log("✓ registry tests passed");

console.log("=== Drain3 ===");
import { drain3Strategy } from "./src/clustering/strategies/drain3.js";

const inst = drain3Strategy.hydrate({});
const messages = [
    "User alice failed login from IP <*>",
    "User bob failed login from IP <*>",
    "User carol failed login from IP <*>",
    "Cache miss for key foo",
    "Cache miss for key bar",
];

const { assignments, templates } = drain3Strategy.cluster(inst, messages, {
    similarityThreshold: 0.4,
    maxChildren: 100,
});

// 3 user-failed messages → 1 template; 2 cache-miss → 1 template
const uniqueTemplateIds = new Set(assignments.map(a => a.templateId));
assert.equal(uniqueTemplateIds.size, 2, "should produce exactly 2 templates");
assert.equal(assignments.length, 5);
assert.equal(templates.length, 2);

// Re-feed: no new templates
const r2 = drain3Strategy.cluster(inst, messages, {
    similarityThreshold: 0.4, maxChildren: 100,
});
assert.ok(r2.templates.every(t => !t.isNew), "no new templates on second pass");

// Serialize → hydrate roundtrip preserves templates
const snap = drain3Strategy.serialize(inst);
const restored = drain3Strategy.hydrate(snap);
const r3 = drain3Strategy.cluster(restored, ["User dave failed login from IP <*>"], {
    similarityThreshold: 0.4, maxChildren: 100,
});
assert.equal(r3.templates[0].isNew, false, "restored instance reuses templates");

console.log("✓ drain3 tests passed");
