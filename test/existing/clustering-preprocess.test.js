import { test, describe } from "node:test";
import assert from "node:assert/strict";
import "../snapshot-config.js";
import { normalizeMessage, tokenize } from "../../src/clustering/preprocess.js";

describe("Preprocessor", () => {
    test("normalizes numbers to <*>", () => {
        assert.equal(normalizeMessage("user 42 failed"), "user <*> failed");
    });

    test("normalizes UUIDs to <*>", () => {
        assert.equal(
            normalizeMessage("trace 550e8400-e29b-41d4-a716-446655440000 done"),
            "trace <*> done"
        );
    });

    test("normalizes IPv4 to <*>", () => {
        assert.equal(normalizeMessage("client 192.168.1.10 connected"), "client <*> connected");
    });

    test("normalizes IPv6 to <*>", () => {
        assert.equal(normalizeMessage("from 2001:db8::1 ok"), "from <*> ok");
    });

    test("normalizes ISO timestamps to <*>", () => {
        assert.equal(
            normalizeMessage("at 2026-05-04T10:00:00Z event"),
            "at <*> event"
        );
    });

    test("normalizes long hex blobs to <*>", () => {
        assert.equal(normalizeMessage("hash deadbeefcafebabe1234"), "hash <*>");
    });

    test("tokenize splits on whitespace", () => {
        assert.deepEqual(tokenize("user <*> failed"), ["user", "<*>", "failed"]);
    });
});
