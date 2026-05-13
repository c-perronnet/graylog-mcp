import { test } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";

// Stub for FOUND-08. Real assertions land in a later plan.
test("normalize: scaffold passes (no assertions yet)", () => {
    assert.equal(1, 1);
});
