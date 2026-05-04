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
