// Phase 8 Plan 08-01 — unit tests for the authz GRN helper module.
//
// Covers AUTHZ-02 (GRN format) acceptance criteria:
//   - buildGrn / parseGrn / isGrn round-trip every type in GRN_TYPES
//   - buildGrn lowercases type + entity id (GRN.parse lowercases the whole string)
//   - unknown types are rejected client-side with the valid-type set in the message
//   - parseGrn enforces EXACTLY 6 colon-tokens with a "grn" prefix
//   - isGrn is a non-throwing predicate
//
// Test discipline mirrors test/cascade-hash.test.js — node:test + node:assert/strict,
// one `// ===` banner comment per test group, assert.throws(..., /regex/) for
// malformed input.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    buildGrn,
    parseGrn,
    isGrn,
    GRN_TYPES,
} from "../src/tools/authz/grn-helpers.js";

// =====================================================================
// GRN_TYPES — the restricted 6-type milestone set
// =====================================================================

test("GRN_TYPES has exactly the 6 milestone types", () => {
    assert.equal(GRN_TYPES.size, 6);
    for (const t of ["stream", "dashboard", "search", "user", "builtin-team", "role"]) {
        assert.ok(GRN_TYPES.has(t), `GRN_TYPES should contain "${t}"`);
    }
});

// =====================================================================
// Round-trip — parseGrn(buildGrn(t, id)) recovers type + entity
// =====================================================================

test("buildGrn/parseGrn round-trip for every type in GRN_TYPES", () => {
    for (const t of GRN_TYPES) {
        const grn = buildGrn(t, "000000000001");
        const parsed = parseGrn(grn);
        assert.equal(parsed.type, t, `type must round-trip for "${t}"`);
        assert.equal(parsed.entity, "000000000001", `entity must round-trip for "${t}"`);
        assert.equal(parsed.cluster, "", "cluster token is empty on a single-cluster Graylog");
        assert.equal(parsed.tenant, "", "tenant token is empty on a single-cluster Graylog");
        assert.equal(parsed.scope, "", "scope token is empty on a single-cluster Graylog");
    }
});

test("buildGrn emits the 6-token form grn::::<type>:<id>", () => {
    const grn = buildGrn("stream", "000000000001");
    assert.equal(grn, "grn::::stream:000000000001");
    assert.equal(grn.split(":").length, 6, "canonical GRN has exactly 6 colon-tokens");
});

// =====================================================================
// Lowercasing — buildGrn lowercases type and entity id
// =====================================================================

test("buildGrn lowercases the entity id", () => {
    const parsed = parseGrn(buildGrn("stream", "ABC"));
    assert.equal(parsed.entity, "abc");
    assert.equal(parsed.type, "stream");
});

test("buildGrn lowercases a mixed-case type token", () => {
    const grn = buildGrn("Stream", "abc");
    assert.equal(grn, "grn::::stream:abc");
});

// =====================================================================
// Unknown-type rejection — message lists the valid type set
// =====================================================================

test("buildGrn throws on an unknown type with the valid set listed", () => {
    for (const bad of ["saved_search", "event_notification", "team"]) {
        let caught;
        try {
            buildGrn(bad, "x");
        } catch (e) {
            caught = e;
        }
        assert.ok(caught, `buildGrn("${bad}", ...) must throw`);
        assert.match(caught.message, /Valid types/, "message must mention 'Valid types'");
        for (const t of GRN_TYPES) {
            assert.ok(
                caught.message.includes(t),
                `unknown-type error message must list valid type "${t}"`,
            );
        }
    }
});

test("buildGrn throws when id is empty or not a string", () => {
    assert.throws(() => buildGrn("stream", ""), /id/);
    assert.throws(() => buildGrn("stream", 123), /id/);
});

// =====================================================================
// parseGrn structural validation — exactly 6 tokens, "grn" prefix
// =====================================================================

test("parseGrn rejects a 7-token (5-empty-colon) string", () => {
    assert.throws(() => parseGrn("grn:::::stream:abc"), /valid GRN/);
});

test("parseGrn rejects a non-GRN string and a non-string input", () => {
    assert.throws(() => parseGrn("not-a-grn"), /valid GRN/);
    assert.throws(() => parseGrn(42), /must be a string/);
});

test("parseGrn rejects a 6-token string with an unknown type", () => {
    assert.throws(() => parseGrn("grn::::team:abc"), /not in valid set/);
});

// =====================================================================
// isGrn — non-throwing predicate
// =====================================================================

test("isGrn returns true for a valid GRN and false otherwise (never throws)", () => {
    assert.equal(isGrn("grn::::stream:000000000001"), true);
    assert.equal(isGrn("garbage"), false);
    assert.equal(isGrn(null), false);
    assert.equal(isGrn(undefined), false);
    assert.equal(isGrn(42), false);
    assert.equal(isGrn("grn:::::stream:abc"), false);
});
