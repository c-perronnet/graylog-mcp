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
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
    buildGrn,
    parseGrn,
    isGrn,
    GRN_TYPES,
} from "../src/tools/authz/grn-helpers.js";
import { Capability } from "../src/tools/authz/schemas.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "authz");

// =====================================================================
// GRN_TYPES — the restricted milestone set (Phase 10 REVIEW CR-02 added
// "team" to support the live `grn::::team:sidecar-system-user` grantee
// observed on the UNESCO Graylog 7.0.6 instance and named in the Phase
// 10 smoke probe's default grantee).
// =====================================================================

test("GRN_TYPES has exactly the 7 milestone types", () => {
    assert.equal(GRN_TYPES.size, 7);
    for (const t of [
        "stream",
        "dashboard",
        "search",
        "user",
        "team",
        "builtin-team",
        "role",
    ]) {
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
    // Phase 10 REVIEW CR-02 — "team" was promoted into GRN_TYPES, so it is
    // no longer in the unknown-type set. Pick types that remain outside the
    // milestone registry.
    for (const bad of ["saved_search", "event_notification", "view"]) {
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
    // Phase 10 REVIEW CR-02 — "team" was promoted into GRN_TYPES, so pick a
    // type still outside the milestone registry (saved_search is a real
    // Graylog GRN type registered in 7.x but deliberately excluded from
    // GRN_TYPES per the Phase 8 RESEARCH Pitfall 6 reasoning).
    assert.throws(() => parseGrn("grn::::saved_search:abc"), /not in valid set/);
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

// =====================================================================
// Capability enum — exactly view/manage/own (least-privilege default)
// =====================================================================

test("Capability accepts exactly view/manage/own", () => {
    for (const cap of ["view", "manage", "own"]) {
        assert.equal(Capability.parse(cap), cap, `Capability should accept "${cap}"`);
    }
});

test("Capability rejects strings outside view/manage/own", () => {
    for (const bad of ["read", "write", "admin", "edit", "View", "OWN", ""]) {
        assert.throws(
            () => Capability.parse(bad),
            `Capability should reject "${bad}"`,
        );
    }
});

// =====================================================================
// EntityShareResponse fixture shape — the verbatim live 7.0.6 capture
// (test/fixtures/authz/prepare-response-7.0.6.json). Offline: no network
// call. Phase 9/10 parse this DTO; this group pins the verified wire shape.
// =====================================================================

const PREPARE_FIXTURE = JSON.parse(
    readFileSync(join(FIXTURE_DIR, "prepare-response-7.0.6.json"), "utf8"),
);

test("prepare-response-7.0.6 fixture has the required EntityShareResponse top-level keys", () => {
    for (const key of [
        "entity",
        "available_grantees",
        "available_capabilities",
        "active_shares",
        "validation_result",
    ]) {
        assert.ok(key in PREPARE_FIXTURE, `EntityShareResponse must have "${key}"`);
    }
});

test("prepare-response-7.0.6 fixture carries a _provenance block (verbatim live capture)", () => {
    assert.ok("_provenance" in PREPARE_FIXTURE, "fixture must record its provenance");
    const p = PREPARE_FIXTURE._provenance;
    assert.equal(typeof p.instance, "string", "_provenance.instance records the captured instance");
    assert.equal(typeof p.graylog_version, "string", "_provenance.graylog_version records the version");
});

test("prepare-response-7.0.6 fixture carries synced_entities as an array", () => {
    // The committed fixture is the verified verbatim live 7.0.6 capture, which
    // DOES contain synced_entities — pin it unconditionally so a future
    // re-capture or hand-edit that silently drops the key fails loudly (the
    // Pitfall-5 wire-shape drift this test exists to catch). Cross-build note:
    // some 7.0.6 builds may omit synced_entities; if a fixture from such a
    // build is committed, this assertion is the intended place to relax.
    assert.ok(
        "synced_entities" in PREPARE_FIXTURE,
        "the committed 7.0.6 capture includes synced_entities",
    );
    assert.ok(
        Array.isArray(PREPARE_FIXTURE.synced_entities),
        "synced_entities is an array",
    );
});

test("prepare-response-7.0.6 fixture pins the present-but-untested EntityShareResponse keys", () => {
    // sharing_user / selected_grantee_capabilities / missing_permissions_on_dependencies
    // are present in the verified live capture but not covered by the
    // top-level-keys test above — pin them so DTO drift in those fields is
    // also guarded before Phase 9/10 parse them.
    assert.ok(
        "sharing_user" in PREPARE_FIXTURE,
        "the committed 7.0.6 capture includes sharing_user",
    );
    assert.ok(
        "selected_grantee_capabilities" in PREPARE_FIXTURE,
        "the committed 7.0.6 capture includes selected_grantee_capabilities",
    );
    assert.ok(
        "missing_permissions_on_dependencies" in PREPARE_FIXTURE,
        "the committed 7.0.6 capture includes missing_permissions_on_dependencies",
    );
});
