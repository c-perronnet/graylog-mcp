import { test } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";

// Stub for Pitfall 3 (zod <-> JSON-Schema drift); starts as trivial allowlist. Real assertions land in a later plan.
test("schema-parity: scaffold passes (no assertions yet)", () => {
    assert.equal(1, 1);
});
