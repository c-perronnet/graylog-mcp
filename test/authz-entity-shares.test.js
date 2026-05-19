// Phase 9 Plan 09-01 — Wave 0 offline unit tests for the entity-shares READ path.
//
// Covers SHARE-02 (get_entity_shares) + SHARE-09 (list_grantees). Fully offline:
//   - handlers driven via the `_testConnection` magic arg (no connection registry)
//   - the committed live-7.0.6 fixture replayed through the `_setCaptureRequest` seam
//
// Structural invariants under test:
//   - request path is POST .../entities/{encodeURIComponent(grn)}/prepare, body `{}`
//     (the @NoAuditEvent empty-body pure-read contract — NOT the commit endpoint)
//   - get_entity_shares surfaces the FULL nested EntityShareResponse, unflattened
//   - list_grantees projects `available_grantees`
//   - a malformed GRN / bad entityType yields a clean MCP error with NO HTTP call
//   - the entityGrn-XOR-(entityType,entityId) constraint is enforced
//
// Test discipline mirrors test/pipelines.test.js (scaffold + get_pipeline group)
// and test/authz-grn.test.js (offline fixture load).

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
    _setCaptureRequest,
    _clearCaptureRequest,
} from "../src/graylog/client.js";
import {
    _clearConnectionsForTests,
    setActiveConnection,
} from "../src/config.js";
import { GraylogNotFoundError } from "../src/graylog/errors.js";

import { handleGetEntityShares } from "../src/tools/authz/get-entity-shares.js";
import { handleListGrantees } from "../src/tools/authz/list-grantees.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "authz");
const PREPARE_FIXTURE = JSON.parse(
    readFileSync(join(FIXTURE_DIR, "prepare-response-7.0.6.json"), "utf8"),
);

beforeEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
});

afterEach(() => {
    // Mandatory: a leftover capture seam silently disables HTTP in later test files.
    _clearCaptureRequest();
    _clearConnectionsForTests();
    setActiveConnection(null);
});

// =====================================================================
// Test 1 — request-path assertion (get_entity_shares)
// =====================================================================

test("get_entity_shares POSTs to .../entities/{encoded-grn}/prepare with a {} body", async () => {
    let captured = null;
    _setCaptureRequest((req) => {
        captured = req;
        return PREPARE_FIXTURE;
    });
    await handleGetEntityShares({
        params: {
            arguments: {
                _testConnection: "fake",
                entityType: "stream",
                entityId: "6a0899bc670fc246e77ca54e",
            },
        },
    });
    assert.equal(captured.method, "POST");
    assert.match(captured.path, /\/prepare$/);
    // GRN colons must be percent-encoded so JAX-RS does not mis-route.
    assert.match(captured.path, /%3A/);
    const afterEntities = captured.path.split("entities/")[1];
    assert.equal(afterEntities.includes(":"), false, "no raw colon after entities/");
    // Empty-object body — the @NoAuditEvent pure-read contract (NOT null).
    assert.deepEqual(captured.body, {});
});

// =====================================================================
// Test 2 — full-DTO surfacing (get_entity_shares)
// =====================================================================

test("get_entity_shares surfaces the full nested EntityShareResponse unflattened", async () => {
    _setCaptureRequest(() => PREPARE_FIXTURE);
    const res = await handleGetEntityShares({
        params: {
            arguments: {
                _testConnection: "fake",
                entityType: "stream",
                entityId: "6a0899bc670fc246e77ca54e",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "get_entity_shares");
    const shares = payload.entity_shares;
    // every nested DTO key present and shape preserved (NOT flattened)
    assert.ok(Array.isArray(shares.available_grantees));
    assert.ok(Array.isArray(shares.active_shares));
    assert.ok(Array.isArray(shares.available_capabilities));
    assert.ok(Array.isArray(shares.synced_entities));
    assert.ok(shares.validation_result && typeof shares.validation_result === "object");
    // nested entries keep their shape
    assert.deepEqual(shares.available_grantees, PREPARE_FIXTURE.available_grantees);
    assert.deepEqual(shares.validation_result, PREPARE_FIXTURE.validation_result);
});

// =====================================================================
// Test 3 — GRN-type parameterization (get_entity_shares)
// =====================================================================

for (const type of ["stream", "dashboard", "search"]) {
    test(`get_entity_shares encodes a ${type} GRN into the request path`, async () => {
        let captured = null;
        _setCaptureRequest((req) => {
            captured = req;
            return PREPARE_FIXTURE;
        });
        await handleGetEntityShares({
            params: {
                arguments: {
                    _testConnection: "fake",
                    entityType: type,
                    entityId: "abc123",
                },
            },
        });
        const expectedGrn = encodeURIComponent(`grn::::${type}:abc123`);
        assert.ok(
            captured.path.includes(expectedGrn),
            `path ${captured.path} should contain ${expectedGrn}`,
        );
    });
}

// =====================================================================
// Test 4 — list_grantees projection
// =====================================================================

test("list_grantees projects available_grantees from the prepare response", async () => {
    _setCaptureRequest(() => PREPARE_FIXTURE);
    const res = await handleListGrantees({
        params: {
            arguments: {
                _testConnection: "fake",
                entityType: "stream",
                entityId: "6a0899bc670fc246e77ca54e",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "list_grantees");
    assert.deepEqual(payload.grantees, PREPARE_FIXTURE.available_grantees);
});

// =====================================================================
// Test 5 — malformed input → clean error, NO HTTP call
// =====================================================================

test("get_entity_shares rejects a malformed GRN with no HTTP request made", async () => {
    let captured = null;
    _setCaptureRequest((req) => {
        captured = req;
        return PREPARE_FIXTURE;
    });
    // 5-token GRN (wrong count) — parseGrn must reject it before any request.
    const res = await handleGetEntityShares({
        params: { arguments: { _testConnection: "fake", entityGrn: "grn:::badtype:x" } },
    });
    assert.equal(res.isError, true);
    assert.equal(captured, null, "no request reached the seam");
});

test("get_entity_shares rejects an invalid entityType with no HTTP request made", async () => {
    let captured = null;
    _setCaptureRequest((req) => {
        captured = req;
        return PREPARE_FIXTURE;
    });
    // `report` is not in the stream/dashboard/search enum — zod rejects pre-request.
    const res = await handleGetEntityShares({
        params: {
            arguments: { _testConnection: "fake", entityType: "report", entityId: "x" },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(captured, null, "no request reached the seam");
});

// =====================================================================
// Test 6 — entityGrn XOR (entityType,entityId)
// =====================================================================

test("get_entity_shares rejects supplying BOTH entityGrn and (entityType,entityId)", async () => {
    const res = await handleGetEntityShares({
        params: {
            arguments: {
                _testConnection: "fake",
                entityGrn: "grn::::stream:abc",
                entityType: "stream",
                entityId: "abc",
            },
        },
    });
    assert.equal(res.isError, true);
});

test("get_entity_shares rejects supplying NEITHER entityGrn nor (entityType,entityId)", async () => {
    const res = await handleGetEntityShares({
        params: { arguments: { _testConnection: "fake" } },
    });
    assert.equal(res.isError, true);
});

// =====================================================================
// Test 7 — error propagation
// =====================================================================

test("get_entity_shares propagates an HTTP error via wrapGraylogError", async () => {
    _setCaptureRequest(() => {
        throw new GraylogNotFoundError("not found", {
            status: 404,
            method: "POST",
            path: "/api/authz/shares/entities/grn%3A%3A%3A%3Astream%3Amissing/prepare",
            body: {},
        });
    });
    const res = await handleGetEntityShares({
        params: {
            arguments: { _testConnection: "fake", entityType: "stream", entityId: "missing" },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /get_entity_shares/);
});
