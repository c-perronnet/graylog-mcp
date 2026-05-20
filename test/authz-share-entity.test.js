// Phase 10 Plan 10-01 — Wave 0 offline tests for the entity-shares WRITE path.
//
// Covers SHARE-01, SHARE-03, SHARE-04, SHARE-05, SHARE-06, SHARE-07, SHARE-08
// and AUTHZ-01 (drift refusal). Fully offline:
//   - handler driven via the `_testConnection` magic arg (no connection registry)
//   - the committed live-7.0.6 fixture replayed through the `_setCaptureRequest` seam
//
// THIS IS A WAVE 0 / RED-PHASE TEST FILE. The handler under test
// (`../src/tools/authz/share-entity.js`) does NOT yet exist — Plan 10-02 ships
// it. Running `node --test test/authz-share-entity.test.js` will FAIL at module
// load with ERR_MODULE_NOT_FOUND for that path, which is the expected RED state.
// `node --check test/authz-share-entity.test.js` MUST exit 0 (this file is
// well-formed ESM that simply imports a not-yet-existing peer).
//
// Discipline mirrors test/authz-entity-shares.test.js (Phase 9 fixture replay)
// and test/pipelines.test.js:2076-2099 (the connect_pipelines_to_stream
// PITFALL 2 ACCEPTANCE GATE — the structural template for the load-bearing
// PITFALL 1 ACCEPTANCE GATE below).

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
import {
    GraylogValidationError,
    GraylogPermissionError,
} from "../src/graylog/errors.js";
import { computeShareGrantHash } from "../src/tools/_shared/cascade-hash.js";

import { handleShareEntity } from "../src/tools/authz/share-entity.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "authz");
const PREPARE_FIXTURE = JSON.parse(
    readFileSync(join(FIXTURE_DIR, "prepare-response-7.0.6.json"), "utf8"),
);

beforeEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
});

afterEach(() => {
    // Mandatory: a leftover capture seam silently disables HTTP in later test
    // files. Same discipline as test/authz-entity-shares.test.js.
    _clearCaptureRequest();
    _clearConnectionsForTests();
    setActiveConnection(null);
});

// =====================================================================
// Test 1 — MANDATORY PITFALL 1 ACCEPTANCE GATE (the load-bearing test)
// =====================================================================
//
// A naive REPLACE-semantics call would emit
// selected_grantee_capabilities === {"grn::::user:c": "view"} — silently
// revoking userA and userB's access to a production stream. Read-merge-POST
// MUST emit {A:view, B:manage, C:view}. The inverse assertion
// (`notDeepStrictEqual` to `[C]`) is the regression guard.

test("share_entity PITFALL 1 ACCEPTANCE GATE: current=[A,B], add C → body contains A,B,C (not just C)", async () => {
    const fixture = {
        ...PREPARE_FIXTURE,
        active_shares: [
            { grant: "g1", grantee: "grn::::user:a", capability: "view" },
            { grant: "g2", grantee: "grn::::user:b", capability: "manage" },
        ],
        available_grantees: [
            ...PREPARE_FIXTURE.available_grantees,
            { id: "grn::::user:c", type: "user", title: "userC" },
        ],
    };
    _setCaptureRequest(() => fixture);

    const res = await handleShareEntity({
        params: {
            arguments: {
                _testConnection: "fake",
                entityType: "stream",
                entityId: "s1",
                granteeUsername: "userC",
                capability: "view",
                dryRun: true,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    const grantees = Object.keys(
        payload.preview.body.selected_grantee_capabilities,
    ).sort();
    // PITFALL 1 GATE — body MUST contain A + B + C, not just [C]
    assert.deepEqual(grantees, [
        "grn::::user:a",
        "grn::::user:b",
        "grn::::user:c",
    ]);
    assert.notDeepStrictEqual(grantees, ["grn::::user:c"]);
});

// =====================================================================
// Test 2 — dry-run confirmationToken matches computeShareGrantHash
// =====================================================================
//
// AUTHZ-01 evidence: the dry-run token is the byte-pinned canonical sha-256
// over the MERGED grant set (current + add). Recomputing locally must yield
// the same token Plan 10-02's wrapper emits.

test("share_entity dry-run default returns confirmationToken matching computeShareGrantHash over merged grant set", async () => {
    const fixture = {
        ...PREPARE_FIXTURE,
        active_shares: [
            { grant: "g1", grantee: "grn::::user:a", capability: "view" },
            { grant: "g2", grantee: "grn::::user:b", capability: "manage" },
        ],
        available_grantees: [
            ...PREPARE_FIXTURE.available_grantees,
            { id: "grn::::user:c", type: "user", title: "userC" },
        ],
    };
    _setCaptureRequest(() => fixture);

    const res = await handleShareEntity({
        params: {
            arguments: {
                _testConnection: "fake",
                entityType: "stream",
                entityId: "s1",
                granteeUsername: "userC",
                capability: "view",
                dryRun: true,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.match(payload.confirmationToken, /^[0-9a-f]{64}$/);

    const expected = computeShareGrantHash({
        entityGrn: "grn::::stream:s1",
        grants: [
            { grantee: "grn::::user:a", capability: "view" },
            { grantee: "grn::::user:b", capability: "manage" },
            { grantee: "grn::::user:c", capability: "view" },
        ],
    });
    assert.equal(payload.confirmationToken, expected);
});

// =====================================================================
// Test 3 — confirmation_mismatch when echoed token is wrong (AUTHZ-01)
// =====================================================================

test("share_entity refuses apply with confirmation_mismatch when args.confirm is wrong", async () => {
    _setCaptureRequest(() => ({
        ...PREPARE_FIXTURE,
        active_shares: [
            { grant: "g1", grantee: "grn::::user:a", capability: "view" },
        ],
        available_grantees: [
            ...PREPARE_FIXTURE.available_grantees,
            { id: "grn::::user:c", type: "user", title: "userC" },
        ],
    }));
    const res = await handleShareEntity({
        params: {
            arguments: {
                _testConnection: "fake",
                entityType: "stream",
                entityId: "s1",
                granteeUsername: "userC",
                capability: "view",
                dryRun: false,
                confirm: "deadbeef", // not the real token
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "confirmation_mismatch");
    assert.match(res.content[0].text, /\[share_entity\] confirmation_mismatch/);
});

// =====================================================================
// Test 4 — TOCTOU drift between preview and apply re-issues a new token
// =====================================================================
//
// AUTHZ-01 evidence. The wrapper's build() runs unconditionally before the
// dry-run / apply branch (handler.js step 5 < step 6) — so the apply-time
// /prepare re-fetches active_shares; if userD appeared between the two
// fetches, the recomputed token diverges from token1 and apply refuses.

test("share_entity refuses apply with confirmation_mismatch when active_shares drifted between preview and apply", async () => {
    let preCall = 0;
    const seam = () => {
        preCall += 1;
        if (preCall === 1) {
            // Dry-run /prepare — only A,B exist.
            return {
                ...PREPARE_FIXTURE,
                active_shares: [
                    { grant: "g1", grantee: "grn::::user:a", capability: "view" },
                    { grant: "g2", grantee: "grn::::user:b", capability: "manage" },
                ],
                available_grantees: [
                    ...PREPARE_FIXTURE.available_grantees,
                    { id: "grn::::user:c", type: "user", title: "userC" },
                ],
            };
        }
        // Apply-time re-prepare — userD appeared.
        return {
            ...PREPARE_FIXTURE,
            active_shares: [
                { grant: "g1", grantee: "grn::::user:a", capability: "view" },
                { grant: "g2", grantee: "grn::::user:b", capability: "manage" },
                { grant: "g3", grantee: "grn::::user:d", capability: "view" },
            ],
            available_grantees: [
                ...PREPARE_FIXTURE.available_grantees,
                { id: "grn::::user:c", type: "user", title: "userC" },
            ],
        };
    };

    // 1) dry-run to capture token1 (over [A,B,C])
    _setCaptureRequest(seam);
    const dryRun = await handleShareEntity({
        params: {
            arguments: {
                _testConnection: "fake",
                entityType: "stream",
                entityId: "s1",
                granteeUsername: "userC",
                capability: "view",
                dryRun: true,
            },
        },
    });
    const token1 = JSON.parse(dryRun.content[0].text).confirmationToken;

    // 2) apply with token1 — server has drifted to [A,B,C,D] → token2 != token1
    const applied = await handleShareEntity({
        params: {
            arguments: {
                _testConnection: "fake",
                entityType: "stream",
                entityId: "s1",
                granteeUsername: "userC",
                capability: "view",
                dryRun: false,
                confirm: token1,
            },
        },
    });
    assert.equal(applied.isError, true);
    assert.equal(applied.reason, "confirmation_mismatch");
});

// =====================================================================
// Test 5 — per-entity-type matrix (SHARE-07, SHARE-08, SHARE-01)
// =====================================================================
//
// Capture the apply-path request; assert it is a POST to the entities/{GRN}
// endpoint (no `/prepare` suffix). The matrix proves stream/dashboard/search
// all route through the same shareable-type pipeline.

for (const type of ["stream", "dashboard", "search"]) {
    test(`share_entity encodes a ${type} GRN into the apply path`, async () => {
        const captured = [];
        const tokenFixture = {
            ...PREPARE_FIXTURE,
            active_shares: [],
            available_grantees: [
                { id: "grn::::user:a", type: "user", title: "userA" },
            ],
        };
        _setCaptureRequest((req) => {
            captured.push({ ...req });
            // First call = /prepare (dry-run); subsequent = /prepare again (apply-time
            // re-fetch), then the actual apply POST. Seam returns the same fixture
            // for both /prepare calls; the apply POST has no /prepare suffix and
            // we return an empty 200 body for it.
            if (req.path.endsWith("/prepare")) return tokenFixture;
            return {};
        });

        // 1) dry-run to get the token
        const dry = await handleShareEntity({
            params: {
                arguments: {
                    _testConnection: "fake",
                    entityType: type,
                    entityId: "abc123",
                    granteeUsername: "userA",
                    capability: "view",
                    dryRun: true,
                },
            },
        });
        const token = JSON.parse(dry.content[0].text).confirmationToken;

        // 2) apply — captures the actual write
        await handleShareEntity({
            params: {
                arguments: {
                    _testConnection: "fake",
                    entityType: type,
                    entityId: "abc123",
                    granteeUsername: "userA",
                    capability: "view",
                    dryRun: false,
                    confirm: token,
                },
            },
        });

        const expectedPath =
            "/api/authz/shares/entities/"
            + encodeURIComponent(`grn::::${type}:abc123`);
        const applyCall = captured.find(
            (c) => c.method === "POST" && !c.path.endsWith("/prepare"),
        );
        assert.ok(applyCall, `expected an apply POST to ${expectedPath}`);
        assert.equal(applyCall.path, expectedPath);
    });
}

// =====================================================================
// Test 6 — granteeUsername resolves via available_grantees[].title (SHARE-04)
// =====================================================================

test("share_entity resolves granteeUsername via available_grantees[].title to the user-GRN", async () => {
    _setCaptureRequest(() => ({
        ...PREPARE_FIXTURE,
        active_shares: [],
        available_grantees: [
            { id: "grn::::user:6a02e", type: "user", title: "userA" },
        ],
    }));
    const res = await handleShareEntity({
        params: {
            arguments: {
                _testConnection: "fake",
                entityType: "stream",
                entityId: "s1",
                granteeUsername: "userA",
                capability: "view",
                dryRun: true,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    const keys = Object.keys(payload.preview.body.selected_grantee_capabilities);
    // Must be the resolved user-GRN, NOT the literal "userA".
    assert.deepEqual(keys, ["grn::::user:6a02e"]);
});

// =====================================================================
// Test 7 — ambiguous granteeUsername (title collision) → clear error
// =====================================================================

test("share_entity refuses ambiguous granteeUsername (title collision) with a clear error listing candidates", async () => {
    _setCaptureRequest(() => ({
        ...PREPARE_FIXTURE,
        active_shares: [],
        available_grantees: [
            { id: "grn::::user:111", type: "user", title: "alice" },
            { id: "grn::::user:222", type: "user", title: "alice" },
        ],
    }));
    const res = await handleShareEntity({
        params: {
            arguments: {
                _testConnection: "fake",
                entityType: "stream",
                entityId: "s1",
                granteeUsername: "alice",
                capability: "view",
                dryRun: true,
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /grn::::user:111/);
    assert.match(res.content[0].text, /grn::::user:222/);
});

// =====================================================================
// Test 8 — revoke:true subtracts grantee from active_shares (SHARE-03)
// =====================================================================

test("share_entity revoke:true subtracts the grantee from active_shares and the dry-run body contains the remainder", async () => {
    _setCaptureRequest(() => ({
        ...PREPARE_FIXTURE,
        active_shares: [
            { grant: "g1", grantee: "grn::::user:a", capability: "view" },
            { grant: "g2", grantee: "grn::::user:b", capability: "manage" },
        ],
        available_grantees: [
            { id: "grn::::user:a", type: "user", title: "userA" },
            { id: "grn::::user:b", type: "user", title: "userB" },
        ],
    }));
    const res = await handleShareEntity({
        params: {
            arguments: {
                _testConnection: "fake",
                entityType: "stream",
                entityId: "s1",
                granteeUsername: "userA",
                revoke: true,
                dryRun: true,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    const keys = Object.keys(
        payload.preview.body.selected_grantee_capabilities,
    ).sort();
    assert.deepEqual(keys, ["grn::::user:b"]);
});

// =====================================================================
// Test 9 — last-own guard refuses removing the final `own` grant
// =====================================================================
//
// ROADMAP success criterion 5: revoking the last owner would leave the entity
// ownerless. Backstopped server-side by Graylog's validation_result.failed
// (Test 10 covers that path) but Phase 10 refuses CLIENT-side as a defense-
// in-depth gate so the agent gets a structured `would_leave_entity_ownerless`
// reason without burning a server round-trip.

test("share_entity revoke:true refuses when revoking the last own grant (client-side last-own guard)", async () => {
    _setCaptureRequest(() => ({
        ...PREPARE_FIXTURE,
        active_shares: [
            { grant: "g1", grantee: "grn::::user:a", capability: "own" },
            { grant: "g2", grantee: "grn::::user:b", capability: "view" },
        ],
        available_grantees: [
            { id: "grn::::user:a", type: "user", title: "userA" },
            { id: "grn::::user:b", type: "user", title: "userB" },
        ],
    }));
    const res = await handleShareEntity({
        params: {
            arguments: {
                _testConnection: "fake",
                entityType: "stream",
                entityId: "s1",
                granteeUsername: "userA",
                revoke: true,
                dryRun: true,
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "would_leave_entity_ownerless");
});

// =====================================================================
// Test 10 — HTTP 400 with validation_result.failed surfaces structured error
// =====================================================================
//
// SHARE-06 evidence. The apply-time POST may return 400 with the structured
// EntityShareResponse body. The handler MUST parse and surface
// validation_result + missing_permissions_on_dependencies in the error
// envelope (NOT truncate to a 200-char wrap).

test("share_entity HTTP 400 with body.validation_result.failed surfaces structured share_validation_failed error", async () => {
    let call = 0;
    const fixture = {
        ...PREPARE_FIXTURE,
        active_shares: [
            { grant: "g1", grantee: "grn::::user:a", capability: "own" },
        ],
        available_grantees: [
            { id: "grn::::user:a", type: "user", title: "userA" },
        ],
    };
    _setCaptureRequest((req) => {
        call += 1;
        if (req.path.endsWith("/prepare")) return fixture;
        // The apply POST throws a 400 with a validation_result body.
        const err = new GraylogValidationError("validation failed", {
            status: 400,
            method: "POST",
            path: req.path,
            body: {
                validation_result: {
                    failed: true,
                    errors: {
                        owner: ["Removing owners will leave the entity ownerless"],
                    },
                    error_context: {},
                },
                missing_permissions_on_dependencies: {},
                active_shares: [],
            },
        });
        throw err;
    });

    // 1) dry-run to get the token (over current=[A:own], no change = same token)
    const dry = await handleShareEntity({
        params: {
            arguments: {
                _testConnection: "fake",
                entityType: "stream",
                entityId: "s1",
                granteeUsername: "userA",
                capability: "own",
                dryRun: true,
            },
        },
    });
    const token = JSON.parse(dry.content[0].text).confirmationToken;

    // 2) apply — the 400-with-body must surface as a structured error
    const res = await handleShareEntity({
        params: {
            arguments: {
                _testConnection: "fake",
                entityType: "stream",
                entityId: "s1",
                granteeUsername: "userA",
                capability: "own",
                dryRun: false,
                confirm: token,
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "share_validation_failed");
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(payload.validation_result.errors.owner, [
        "Removing owners will leave the entity ownerless",
    ]);
    assert.ok(call >= 2, "apply path was exercised");
});

// =====================================================================
// Test 11 — HTTP 403 on apply surfaces reason=not_entity_owner
// =====================================================================
//
// Pitfall 6 — only owners may modify shares. A 403 from the apply POST must
// be classified with a `not_entity_owner` reason and hint the agent that
// `own` capability is required.

test("share_entity HTTP 403 on apply surfaces reason=not_entity_owner with ownership hint", async () => {
    const fixture = {
        ...PREPARE_FIXTURE,
        active_shares: [],
        available_grantees: [
            { id: "grn::::user:a", type: "user", title: "userA" },
        ],
    };
    _setCaptureRequest((req) => {
        if (req.path.endsWith("/prepare")) return fixture;
        throw new GraylogPermissionError("not authorized", {
            status: 403,
            method: "POST",
            path: req.path,
            body: { message: "Forbidden" },
        });
    });
    const dry = await handleShareEntity({
        params: {
            arguments: {
                _testConnection: "fake",
                entityType: "stream",
                entityId: "s1",
                granteeUsername: "userA",
                capability: "view",
                dryRun: true,
            },
        },
    });
    const token = JSON.parse(dry.content[0].text).confirmationToken;
    const res = await handleShareEntity({
        params: {
            arguments: {
                _testConnection: "fake",
                entityType: "stream",
                entityId: "s1",
                granteeUsername: "userA",
                capability: "view",
                dryRun: false,
                confirm: token,
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /not_entity_owner/);
    assert.match(res.content[0].text, /own/);
});

// =====================================================================
// Test 12 — zod rejects capability:'read'/'edit'/'admin' synonyms
// =====================================================================
//
// Capability is pinned to view/manage/own. Synonyms must NOT be coerced.

for (const bogus of ["read", "edit", "admin"]) {
    test(`share_entity zod rejects capability:'${bogus}'`, async () => {
        const res = await handleShareEntity({
            params: {
                arguments: {
                    _testConnection: "fake",
                    entityType: "stream",
                    entityId: "s1",
                    granteeUsername: "userA",
                    capability: bogus,
                    dryRun: true,
                },
            },
        });
        assert.equal(res.isError, true);
        assert.match(res.content[0].text, new RegExp(bogus, "i"));
    });
}

// =====================================================================
// Test 13 — zod refuses revoke:true with capability set
// =====================================================================

test("share_entity zod refuses revoke:true with capability set", async () => {
    const res = await handleShareEntity({
        params: {
            arguments: {
                _testConnection: "fake",
                entityType: "stream",
                entityId: "s1",
                granteeUsername: "userA",
                revoke: true,
                capability: "view",
                dryRun: true,
            },
        },
    });
    assert.equal(res.isError, true);
});

// =====================================================================
// Test 14 — zod refuses revoke:false (default) without capability
// =====================================================================

test("share_entity zod refuses revoke:false (default) without capability", async () => {
    const res = await handleShareEntity({
        params: {
            arguments: {
                _testConnection: "fake",
                entityType: "stream",
                entityId: "s1",
                granteeUsername: "userA",
                dryRun: true,
            },
        },
    });
    assert.equal(res.isError, true);
});

// =====================================================================
// Test 15 — entityGrn type 'user' rejected by SHAREABLE_TYPES guard
// =====================================================================

test("share_entity zod refuses entityGrn type 'user' as a share target (SHAREABLE_TYPES guard)", async () => {
    let captured = null;
    _setCaptureRequest((req) => {
        captured = req;
        return PREPARE_FIXTURE;
    });
    const res = await handleShareEntity({
        params: {
            arguments: {
                _testConnection: "fake",
                entityGrn: "grn::::user:abc",
                granteeUsername: "userA",
                capability: "view",
                dryRun: true,
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /not a shareable entity/);
    assert.equal(captured, null, "no HTTP request reached the seam");
});

// =====================================================================
// Test 16 — writable:false connection refuses dryRun:false apply
// =====================================================================
//
// The wrapper's writable gate (handler.js:97-106) short-circuits apply on a
// read-only connection with reason `connection_read_only`. The _testConnection
// magic arg accepts an inline {writable:false} fake.

// =====================================================================
// Test 17 — REVIEW CR-01: mixed-case granteeGrn is lowercased so it
// merges with the server-lowercased active_shares grantee
// =====================================================================
//
// REVIEW.md CR-01: previously the handler trusted args.granteeGrn verbatim
// despite the schemas.js comment promising lowercasing. A mixed-case input
// like "grn::::user:ABC" against active_shares=[{grantee:"grn::::user:abc"}]
// produced a duplicate-cased entry in the merged map and POST body. After
// the fix, the canonical key in the body is the lowercase form ONCE.

test("share_entity REVIEW CR-01: mixed-case granteeGrn is lowercased and merges with active_shares (single key)", async () => {
    _setCaptureRequest(() => ({
        ...PREPARE_FIXTURE,
        active_shares: [
            { grant: "g1", grantee: "grn::::user:abc", capability: "view" },
        ],
        available_grantees: [
            { id: "grn::::user:abc", type: "user", title: "userABC" },
        ],
    }));
    const res = await handleShareEntity({
        params: {
            arguments: {
                _testConnection: "fake",
                entityType: "stream",
                entityId: "s1",
                // MIXED-CASE input — the server-side key is "grn::::user:abc".
                granteeGrn: "grn::::user:ABC",
                capability: "manage", // change from view → manage
                dryRun: true,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    const body = payload.preview.body.selected_grantee_capabilities;
    const keys = Object.keys(body).sort();
    // Exactly ONE entry (not two case-variant entries) and the value reflects
    // the change ("manage"), not the pre-existing capability ("view").
    assert.deepEqual(keys, ["grn::::user:abc"]);
    assert.equal(body["grn::::user:abc"], "manage");
});

// =====================================================================
// Test 18 — REVIEW CR-02: granteeGrn with a non-grantee type
// (stream/dashboard/search) is rejected client-side, no apply POST
// =====================================================================
//
// REVIEW.md CR-02: previously a stream/dashboard/search GRN passed as
// granteeGrn was POSTed verbatim (no GRANTEE_TYPES guard symmetric to
// SHAREABLE_TYPES). After the fix, resolveGranteeGrn rejects it BEFORE
// any apply POST, with reason="invalid_grantee_reference".

test("share_entity REVIEW CR-02: granteeGrn type 'stream' is rejected client-side (no apply POST)", async () => {
    const captured = [];
    _setCaptureRequest((req) => {
        captured.push({ ...req });
        return PREPARE_FIXTURE;
    });
    const res = await handleShareEntity({
        params: {
            arguments: {
                _testConnection: "fake",
                entityType: "stream",
                entityId: "s1",
                // Share-target type masquerading as a grantee.
                granteeGrn: "grn::::stream:foo",
                capability: "view",
                dryRun: true,
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "invalid_grantee_reference");
    assert.match(res.content[0].text, /not a grantee type/);
    // Even if the handler reads /prepare before resolving the grantee, no
    // commit-endpoint (non-/prepare) POST may ever fire.
    const commitCalls = captured.filter(
        (c) => c.method === "POST" && !c.path.endsWith("/prepare"),
    );
    assert.deepEqual(commitCalls, [], "no apply-path POST should fire");
});

test("share_entity refuses dryRun:false on a writable:false connection with reason=connection_read_only", async () => {
    let appliedHit = false;
    _setCaptureRequest((req) => {
        if (req.path.endsWith("/prepare")) return PREPARE_FIXTURE;
        appliedHit = true;
        return {};
    });
    const res = await handleShareEntity({
        params: {
            arguments: {
                _testConnection: { baseUrl: "http://fake", apiToken: "t", writable: false },
                entityType: "stream",
                entityId: "s1",
                granteeUsername: "userA",
                capability: "view",
                dryRun: false,
                confirm: "irrelevant-token",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "connection_read_only");
    assert.equal(appliedHit, false, "apply must NOT fire on a read-only connection");
});
