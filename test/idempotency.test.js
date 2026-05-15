import { test } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";
import {
    deriveIdempotencyKey,
    _canonicalize,
} from "../src/tools/_shared/idempotency.js";

// FOUND-10 — deterministic sha-256-truncated 32-hex idempotency keys; canonical-args
// projection excludes dryRun + idempotencyKey + undefined; sorts object keys recursively;
// preserves array order.

// -------- Key shape --------

test("key is a 32-char lowercase hex string", () => {
    const k = deriveIdempotencyKey({
        connectionName: "prod",
        toolName: "create_stream",
        args: { title: "T" },
    });
    assert.match(k, /^[a-f0-9]{32}$/);
});

// -------- Determinism --------

test("determinism: identical args produce identical keys", () => {
    const a = deriveIdempotencyKey({
        connectionName: "prod",
        toolName: "create_stream",
        args: { title: "T", description: "desc" },
    });
    const b = deriveIdempotencyKey({
        connectionName: "prod",
        toolName: "create_stream",
        args: { title: "T", description: "desc" },
    });
    assert.equal(a, b);
});

// -------- Excluded fields --------

test("dryRun is excluded from canonical args (same key with and without dryRun)", () => {
    const withDry = deriveIdempotencyKey({
        connectionName: "prod",
        toolName: "create_stream",
        args: { title: "T", dryRun: true },
    });
    const withoutDry = deriveIdempotencyKey({
        connectionName: "prod",
        toolName: "create_stream",
        args: { title: "T" },
    });
    assert.equal(withDry, withoutDry);
});

test("idempotencyKey is excluded from canonical args (passing one doesn't change derivation)", () => {
    const withIdem = deriveIdempotencyKey({
        connectionName: "prod",
        toolName: "create_stream",
        args: { title: "T", idempotencyKey: "anything-goes" },
    });
    const withoutIdem = deriveIdempotencyKey({
        connectionName: "prod",
        toolName: "create_stream",
        args: { title: "T" },
    });
    assert.equal(withIdem, withoutIdem);
});

// -------- Key-order independence --------

test("key-order independence: { a, b } vs { b, a } produce the same key", () => {
    const ab = deriveIdempotencyKey({
        connectionName: "prod",
        toolName: "create_stream",
        args: { a: 1, b: 2 },
    });
    const ba = deriveIdempotencyKey({
        connectionName: "prod",
        toolName: "create_stream",
        args: { b: 2, a: 1 },
    });
    assert.equal(ab, ba);
});

// -------- Undefined values excluded --------

test("undefined values excluded from canonical form", () => {
    const withUndef = deriveIdempotencyKey({
        connectionName: "prod",
        toolName: "create_stream",
        args: { a: undefined, b: 1 },
    });
    const withoutUndef = deriveIdempotencyKey({
        connectionName: "prod",
        toolName: "create_stream",
        args: { b: 1 },
    });
    assert.equal(withUndef, withoutUndef);
});

// -------- Sensitivity to toolName + connectionName --------

test("different toolName → different key", () => {
    const k1 = deriveIdempotencyKey({
        connectionName: "prod",
        toolName: "create_stream",
        args: { title: "T" },
    });
    const k2 = deriveIdempotencyKey({
        connectionName: "prod",
        toolName: "delete_stream",
        args: { title: "T" },
    });
    assert.notEqual(k1, k2);
});

test("different connectionName → different key", () => {
    const k1 = deriveIdempotencyKey({
        connectionName: "prod",
        toolName: "create_stream",
        args: { title: "T" },
    });
    const k2 = deriveIdempotencyKey({
        connectionName: "staging",
        toolName: "create_stream",
        args: { title: "T" },
    });
    assert.notEqual(k1, k2);
});

// -------- Nested objects + arrays --------

test("nested objects are sorted recursively", () => {
    const a = deriveIdempotencyKey({
        connectionName: "prod",
        toolName: "create_stream",
        args: { config: { b: 2, a: 1 } },
    });
    const b = deriveIdempotencyKey({
        connectionName: "prod",
        toolName: "create_stream",
        args: { config: { a: 1, b: 2 } },
    });
    assert.equal(a, b);
});

test("arrays preserve order: [1, 2] vs [2, 1] produce different keys", () => {
    const k1 = deriveIdempotencyKey({
        connectionName: "prod",
        toolName: "create_stream",
        args: { rules: [1, 2] },
    });
    const k2 = deriveIdempotencyKey({
        connectionName: "prod",
        toolName: "create_stream",
        args: { rules: [2, 1] },
    });
    assert.notEqual(k1, k2);
});

// -------- _canonicalize direct probes --------

test("_canonicalize: sorts top-level keys", () => {
    assert.deepEqual(_canonicalize({ b: 2, a: 1 }), { a: 1, b: 2 });
});

test("_canonicalize: excludes dryRun and idempotencyKey", () => {
    assert.deepEqual(
        _canonicalize({ dryRun: true, idempotencyKey: "x", b: 2 }),
        { b: 2 }
    );
});

test("_canonicalize: excludes undefined keys", () => {
    assert.deepEqual(_canonicalize({ a: undefined, b: 1 }), { b: 1 });
});

test("_canonicalize: arrays preserve order; inner objects sort", () => {
    assert.deepEqual(
        _canonicalize([3, 1, { z: 1, a: 2 }]),
        [3, 1, { a: 2, z: 1 }]
    );
});

test("_canonicalize: primitives pass through unchanged", () => {
    assert.equal(_canonicalize(42), 42);
    assert.equal(_canonicalize("hello"), "hello");
    assert.equal(_canonicalize(null), null);
    assert.equal(_canonicalize(true), true);
});
