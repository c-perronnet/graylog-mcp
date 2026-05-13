import { test } from "node:test";
import assert from "node:assert/strict";
import "../snapshot-config.js";

// Stub for Pitfall 1 — pre/post dispatch regression net.
// Real fixtures land in Plan 05 (dispatch refactor).
test("regression/read-tools: scaffold passes (no assertions yet)", () => {
    assert.equal(1, 1);
});
