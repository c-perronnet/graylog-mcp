// Plan 04-06 Task 1 — 14 snapshot fixtures per RESEARCH §"Snapshot Fixture Design".
//
// Each fixture pins one Phase 4 tool's dry-run preview shape OR apply result
// OR refusal envelope. Static args ensure byte-determinism across runs
// (idempotencyKey is the sha-256-truncated hash of canonicalized
// {connectionName, toolName, args}; Date.now()/randomUUID() are NOT invoked
// anywhere in the wrapper or build paths). The snapshot serializer
// (node:test default) normalises indentation + key order — the resulting
// .snapshot file is byte-stable across machines and CI runs.
//
// Coverage matrix (RESEARCH §Snapshot Fixture Design lines 1081-1096):
//
//   F1  list_pipelines              — narrow projection of 2-pipeline cluster
//                                     pins stages_count synthetic field
//   F2  create_pipeline             — structured source with 2 stages; dry-run
//                                     pins parseResult.ok:true + __SERVER_ASSIGNED__
//   F3  update_pipeline             — STRICT_NO_ECHO partial — title-only change
//                                     wire body has ONLY title key
//   F4  delete_pipeline             — dry-run sync envelope; D-15 LEAF DELETE
//                                     NO cascades key, NO confirmationToken
//   F5  create_pipeline_rule (structured) — full DSL surface; dry-run
//                                     parseResult.ok:true; emitted DSL byte-stable
//   F6  create_pipeline_rule (C4 GATE — server-parse fail) — raw DSL whose
//                                     parse seam returns 400 + UndeclaredFunction
//                                     "toUpperCase" with positionInLine on the wire
//                                     pins isError envelope, reason:"rule_parse_failed",
//                                     snake_case position_in_line in the text
//   F7  update_pipeline_rule        — STRICT_NO_ECHO partial — description-only change
//                                     wire body has ONLY description key
//   F8  delete_pipeline_rule (populated cascade) — 2 referencing pipelines
//                                     PINS frozen literal 66267019…3a1 (D-14 sentinel)
//   F9  delete_pipeline_rule (empty cascade) — no referencing pipelines
//                                     PINS frozen literal 9541cfc2…5b1 (D-14 sentinel)
//                                     DIFFERENT hash from F8 — keyed-buckets disambiguation
//   F10 list_pipeline_functions     — live overlay collision (to_long live wins)
//                                     filter to category:"debug" + 1 live entry for
//                                     small deterministic projection
//   F11 simulate_pipeline_rule (Pitfall 1 / M3 GATE — dry-run) — pins body.message
//                                     as a JSON-STRING (typeof string) at the wire
//                                     body level
//   F12 simulate_pipeline_rule (M3 GATE — apply with post-rule field change) —
//                                     pins result.body.message.fields shows the
//                                     post-rule alert:true addition
//   F13 connect_pipelines_to_stream (Pitfall 2 GATE — merge) — currentSet=[a,b],
//                                     args.pipelineIds=[new] → body.pipeline_ids=[a,b,new]
//   F14 disconnect_pipelines_from_stream (Pitfall 2 GATE — subtract) —
//                                     currentSet=[a,b,c], args.pipelineIds=[b]
//                                     → body.pipeline_ids=[a,c]
//
// Determinism contract: two consecutive `npm test` runs must produce
// byte-identical md5sums of test/__snapshots__/pipelines.test.js.snapshot.
// The auth-redaction lint (test/auth-redaction.test.js) scans this file
// dynamically — confirmationToken + idempotencyKey are allowlisted via
// the Plan 02-05 amendment.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "../snapshot-config.js";

import { handleListPipelines } from "../../src/tools/pipelines/list-pipelines.js";
import { handleCreatePipeline } from "../../src/tools/pipelines/create-pipeline.js";
import { handleUpdatePipeline } from "../../src/tools/pipelines/update-pipeline.js";
import { handleDeletePipeline } from "../../src/tools/pipelines/delete-pipeline.js";
import { handleCreatePipelineRule } from "../../src/tools/pipelines/create-pipeline-rule.js";
import { handleUpdatePipelineRule } from "../../src/tools/pipelines/update-pipeline-rule.js";
import { handleDeletePipelineRule } from "../../src/tools/pipelines/delete-pipeline-rule.js";
import { handleListPipelineFunctions } from "../../src/tools/pipelines/list-pipeline-functions.js";
import { handleSimulatePipelineRule } from "../../src/tools/pipelines/simulate-pipeline-rule.js";
import { handleConnectPipelinesToStream } from "../../src/tools/pipelines/connect-pipelines-to-stream.js";
import { handleDisconnectPipelinesFromStream } from "../../src/tools/pipelines/disconnect-pipelines-from-stream.js";
import { computeRuleCascadeHash } from "../../src/tools/_shared/cascade-hash.js";
import {
    _setCaptureRequest,
    _clearCaptureRequest,
} from "../../src/graylog/client.js";
import {
    _setConnectionsForTests,
    _clearConnectionsForTests,
    setActiveConnection,
} from "../../src/config.js";
import { _clearFunctionCatalogueForTests } from "../../src/pipeline-dsl/function-catalogue.js";
import { GraylogValidationError } from "../../src/graylog/errors.js";

beforeEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
    // Per-test cache reset — keeps each fixture's GET /rule/functions call
    // visible to the captured-request seam (cache lookups never short-circuit
    // the first invocation of a freshly-cleared connection).
    _clearFunctionCatalogueForTests();
});

afterEach(() => {
    _clearCaptureRequest();
    _clearConnectionsForTests();
    setActiveConnection(null);
    _clearFunctionCatalogueForTests();
});

// =====================================================================
// Fixtures — synthetic Graylog responses for byte-stable snapshots
// =====================================================================

// Two-pipeline cluster for list_pipelines fixture (F1).
const FIXTURE_PIPELINE_A = {
    id: "fixture-p1",
    title: "FixturePipelineA",
    description: "Routes app traffic through enrichment stages",
    source: 'pipeline "FixturePipelineA"\nstage 0 match either\n  rule "enrich-app"\nend',
    created_at: "2026-01-01T00:00:00.000Z",
    modified_at: "2026-01-15T00:00:00.000Z",
    stages: [
        { stage: 0, match: "EITHER", rules: ["enrich-app"] },
    ],
};

const FIXTURE_PIPELINE_B = {
    id: "fixture-p2",
    title: "FixturePipelineB",
    description: "System enrichment two-stage",
    source: 'pipeline "FixturePipelineB"\nstage 0 match all\nend\nstage 1 match all\nend',
    created_at: "2026-01-01T00:00:00.000Z",
    modified_at: "2026-01-01T00:00:00.000Z",
    stages: [
        { stage: 0, match: "ALL", rules: [] },
        { stage: 1, match: "PASS", rules: [] },
    ],
};

// MultiCapture helper — mirrors streamsMultiCapture/pipelinesMultiCapture.
function pipelinesMultiCapture(routes) {
    return (req) => {
        for (const r of routes) {
            const matches = typeof r.pathPattern === "string"
                ? req.path === r.pathPattern
                : r.pathPattern.test(req.path);
            if (req.method === r.method && matches) {
                return typeof r.response === "function" ? r.response(req) : r.response;
            }
        }
        throw new Error(`No route matched ${req.method} ${req.path}`);
    };
}

// Reusable "happy path" routes for create_pipeline_rule fixtures.
//   1. GET /api/system/pipelines/rule/functions → empty live (merged = static)
//   2. POST /api/system/pipelines/rule/parse → 200
//   3. GET /api/system/pipelines/rule → []
function createPipelineRuleHappyRoutes() {
    return pipelinesMultiCapture([
        { method: "GET",  pathPattern: "/api/system/pipelines/rule/functions", response: [] },
        { method: "POST", pathPattern: "/api/system/pipelines/rule/parse",     response: { source: "ok" } },
        { method: "GET",  pathPattern: "/api/system/pipelines/rule",           response: [] },
    ]);
}

// Helper — paginated /rule/paginated response shape used by delete_pipeline_rule.
function paginatedRuleResponse({ page, perPage, rules, usedInPipelines, total }) {
    return {
        page,
        per_page: perPage,
        total: total ?? rules.length,
        count: rules.length,
        rules,
        context: { used_in_pipelines: usedInPipelines ?? {} },
    };
}

// F-22 helper — predicate for the existence pre-flight GET inside
// discoverReferencingPipelines. The pre-flight fires `GET
// /api/system/pipelines/rule/{id}` BEFORE the paginated walk so a
// missing rule surfaces as reason:"pipeline_rule_not_found" rather
// than an empty cascade (which is indistinguishable from "rule found
// but unreferenced").
function isRuleExistencePreflight(req, ruleId) {
    return req.method === "GET"
        && req.path === `/api/system/pipelines/rule/${ruleId}`;
}

function ruleExistenceStub(ruleId, title) {
    return { id: ruleId, title: title ?? `R-${ruleId}` };
}

// =====================================================================
// F1 — list_pipelines narrow projection of a 2-pipeline cluster
// =====================================================================
//
// Pins the synthetic stages_count field (length of `stages` array) and
// the default 6-field projection [id, title, description, stages_count,
// created_at, modified_at]. The full `source` DSL text is intentionally
// excluded — agents call get_pipeline when they need the source body.

test("snapshot: list_pipelines narrow projection of 2-pipeline cluster (PIPE-01 + stages_count synthetic field)", async (t) => {
    _setCaptureRequest(() => [FIXTURE_PIPELINE_A, FIXTURE_PIPELINE_B]);
    const res = await handleListPipelines({
        params: { arguments: { _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.count, 2);
    assert.equal(payload.items[0].stages_count, 1);
    assert.equal(payload.items[1].stages_count, 2);
    // Default 6-field projection — source MUST be absent.
    assert.equal(payload.items[0].source, undefined);
    assert.deepEqual(
        Object.keys(payload.items[0]).sort(),
        ["created_at", "description", "id", "modified_at", "stages_count", "title"],
    );
    t.assert.snapshot(payload);
});

// =====================================================================
// F2 — create_pipeline structured source (2 stages) with parse pre-flight
// =====================================================================
//
// Pins D-06 parse pre-flight + D-17 __SERVER_ASSIGNED__ sentinel.
// parseResult.ok:true; postApplyEstimate.id === "__SERVER_ASSIGNED__".

test("snapshot: create_pipeline dry-run with 2-stage source emits parseResult.ok + __SERVER_ASSIGNED__ (PIPE-03 + D-06 + D-17)", async (t) => {
    _setCaptureRequest(pipelinesMultiCapture([
        // D-06 parse pre-flight
        { method: "POST", pathPattern: "/api/system/pipelines/pipeline/parse", response: () => ({ ok: true }) },
        // M5 existingMatches scan — empty cluster
        { method: "GET",  pathPattern: "/api/system/pipelines/pipeline",       response: () => [] },
    ]));
    const res = await handleCreatePipeline({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "FixturePipelineNew",
                description: "Two-stage routing pipeline",
                source: 'pipeline "FixturePipelineNew"\nstage 0 match either\n  rule "stage0-rule"\nend\nstage 1 match all\n  rule "stage1-rule"\nend',
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.parseResult.ok, true);
    assert.equal(payload.postApplyEstimate.id, "__SERVER_ASSIGNED__");
    assert.equal(payload.preview.method, "POST");
    assert.equal(payload.preview.path, "/api/system/pipelines/pipeline");
    t.assert.snapshot(payload);
});

// =====================================================================
// F3 — update_pipeline STRICT_NO_ECHO partial (title only)
// =====================================================================
//
// Pins D-16 STRICT_NO_ECHO contract: wire body emits ONLY the changed
// field (title). description + source NOT echoed. parseResult ABSENT
// from descriptor because source wasn't touched (Plan 04-02 amendment).

test("snapshot: update_pipeline STRICT_NO_ECHO partial — title-only change emits ONLY title in wire body (PIPE-04 + D-16)", async (t) => {
    _setCaptureRequest(pipelinesMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/system/pipelines/pipeline/fixture-p1",
            response: () => FIXTURE_PIPELINE_A,
        },
    ]));
    const res = await handleUpdatePipeline({
        params: {
            arguments: {
                _testConnection: "fake",
                pipelineId: "fixture-p1",
                changes: { title: "FixturePipelineA-renamed" },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.preview.method, "PUT");
    assert.equal(payload.preview.path, "/api/system/pipelines/pipeline/fixture-p1");
    // STRICT_NO_ECHO — wire body has ONLY the changed key.
    assert.deepEqual(Object.keys(payload.preview.body).sort(), ["title"]);
    // parseResult ABSENT — source not touched.
    assert.equal(payload.parseResult, undefined);
    t.assert.snapshot(payload);
});

// =====================================================================
// F4 — delete_pipeline dry-run sync envelope (D-15 LEAF DELETE)
// =====================================================================
//
// Pins the leaf-delete contract: NO cascades key, NO confirmationToken,
// NO _confirmationToken in the rendered preview. The handler.js spread
// pattern omits both keys when build()'s descriptor doesn't set them.

test("snapshot: delete_pipeline dry-run is LEAF — NO cascades, NO confirmationToken (PIPE-05 + D-15)", async (t) => {
    _setCaptureRequest(() => ({}));  // delete_pipeline has no pre-flight GETs
    const res = await handleDeletePipeline({
        params: {
            arguments: {
                _testConnection: "fake",
                pipelineId: "fixture-p1",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.preview.method, "DELETE");
    assert.equal(payload.preview.path, "/api/system/pipelines/pipeline/fixture-p1");
    // D-15 leaf delete — both fields ABSENT from the preview JSON.
    assert.equal(payload.cascades, undefined);
    assert.equal(payload.confirmationToken, undefined);
    t.assert.snapshot(payload);
});

// =====================================================================
// F5 — create_pipeline_rule (structured intent, full DSL surface)
// =====================================================================
//
// Pins the emitted DSL byte-stable. Structured intent exercises:
//   - HasField condition (when has_field("source"))
//   - FunctionCallStatement action (uppercase(...))
//   - field_ref expression ($message.source)
// All four primitives route through escape.js on emission.

const VALID_STRUCTURED_F5 = {
    name: "fixture-uppercase-source",
    when: { type: "has_field", field: "source" },
    then: [
        {
            type: "function_call_statement",
            name: "uppercase",
            args: {
                positional: [
                    { type: "field_ref", field: "source", source: "message" },
                ],
            },
        },
    ],
};

test("snapshot: create_pipeline_rule structured intent emits byte-stable DSL with parseResult.ok (PIPE-08 + D-11)", async (t) => {
    _setCaptureRequest(createPipelineRuleHappyRoutes());
    const res = await handleCreatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                structured: VALID_STRUCTURED_F5,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.parseResult.ok, true);
    assert.equal(payload.postApplyEstimate.id, "__SERVER_ASSIGNED__");
    assert.match(payload.preview.body.source, /rule "fixture-uppercase-source"/);
    assert.match(payload.preview.body.source, /has_field\("source"\)/);
    assert.match(payload.preview.body.source, /uppercase\(/);
    t.assert.snapshot(payload);
});

// =====================================================================
// F6 — create_pipeline_rule C4 ACCEPTANCE GATE (server-parse fail)
// =====================================================================
//
// The captured-request seam injects a synthetic 400 response from
// /api/system/pipelines/rule/parse with body:
//   [{type:"UndeclaredFunction", line:3, positionInLine:5, name:"toUpperCase"}]
//
// The wrapper produces an isError envelope; the fixture pins the
// envelope shape and the snake_case `position_in_line:5` translation
// (Pitfall 6 verification at the snapshot level).
//
// The raw DSL itself uses only valid functions so the CLIENT-SIDE lint
// (validate.js) PASSES — the failure is on the server side, proving
// the parse pre-flight is the authoritative gate (D-05 acceptance gate).

test("snapshot: create_pipeline_rule C4 SERVER-PARSE GATE — isError + reason:rule_parse_failed + snake_case position_in_line (PIPE-08 + D-05 + Pitfall 6)", async (t) => {
    let postRuleFired = false;
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/pipelines/rule/functions") {
            return [];
        }
        if (req.method === "POST" && req.path === "/api/system/pipelines/rule/parse") {
            // Synthetic ParseException — server says "UndeclaredFunction
            // toUpperCase at L3:5". camelCase positionInLine on the wire;
            // wrapper translates to snake_case in the error message.
            throw new GraylogValidationError("Server rule parse failed", {
                status: 400,
                method: "POST",
                path: "/api/system/pipelines/rule/parse",
                body: [
                    {
                        type: "UndeclaredFunction",
                        line: 3,
                        positionInLine: 5,
                        message: "Unknown function: toUpperCase",
                    },
                ],
            });
        }
        if (req.method === "POST" && req.path === "/api/system/pipelines/rule") {
            postRuleFired = true;
            return {};
        }
        return [];
    });
    const res = await handleCreatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                ruleSource: 'rule "fixture-c4-gate"\nwhen has_field("source")\nthen\n    set_field("dummy", "value");\nend',
                dryRun: false,
            },
        },
    });
    // Apply must NOT have fired — C4 acceptance gate proof.
    assert.equal(postRuleFired, false, "POST /rule must NOT fire when server parse pre-flight 400s");
    assert.equal(res.isError, true);
    assert.equal(res.reason, "rule_parse_failed");
    // Pitfall 6 verification at the snapshot level — the wrapper's error
    // message references the snake_case position_in_line via [L3:5].
    assert.match(res.content[0].text, /\[L3:5\]/);
    t.assert.snapshot(res);
});

// =====================================================================
// F7 — update_pipeline_rule STRICT_NO_ECHO (description only)
// =====================================================================
//
// Pins D-16 STRICT_NO_ECHO: when args.changes contains only `description`,
// the wire body emits ONLY description. source NOT echoed; parseResult
// ABSENT from descriptor (D-05 skipped on cosmetic edits). The GET /rule/{id}
// pre-flight fires but its response is not echoed into the wire body.

test("snapshot: update_pipeline_rule STRICT_NO_ECHO — description-only change emits ONLY description (PIPE-09 + D-16)", async (t) => {
    _setCaptureRequest(pipelinesMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/system/pipelines/rule/fixture-r1",
            response: () => ({
                id: "fixture-r1",
                title: "fixture-uppercase-source",
                description: "original description",
                source: 'rule "fixture-uppercase-source"\nwhen has_field("source")\nthen\n    set_field("source", uppercase(to_string($message.source)));\nend',
                created_at: "2026-01-01T00:00:00.000Z",
                modified_at: "2026-01-01T00:00:00.000Z",
            }),
        },
    ]));
    const res = await handleUpdatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                ruleId: "fixture-r1",
                changes: { description: "fixture-updated-description" },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.preview.method, "PUT");
    assert.equal(payload.preview.path, "/api/system/pipelines/rule/fixture-r1");
    // STRICT_NO_ECHO — wire body has ONLY description.
    assert.deepEqual(Object.keys(payload.preview.body).sort(), ["description"]);
    // parseResult ABSENT — source not touched.
    assert.equal(payload.parseResult, undefined);
    t.assert.snapshot(payload);
});

// =====================================================================
// F8 — delete_pipeline_rule populated cascade (2 referencing pipelines)
// =====================================================================
//
// Pins the D-14 cascade-hash frozen literal 66267019…3a1 for ruleId="r1"
// + pipelineIds=["p1","p2"]. Drift sentinel — if computeRuleCascadeHash's
// canonical JSON form ever changes (key order, bucket names, sort), this
// snapshot fails loudly. The 64-hex literal is allowlisted in
// auth-redaction.test.js via the confirmationToken context (Plan 02-05).

const PINNED_HASH_TWO_PIPELINES = "66267019f60955ff99686f3dbf343f40580996e22d5ead79045743f1d075e3a1";
const PINNED_HASH_EMPTY_CASCADE = "9541cfc2cf6b92acde474f487f3e824942c1e0df4ae4308a60fa645afe1155b1";

test("snapshot: delete_pipeline_rule populated cascade (r1 + [p1,p2]) pins frozen hash 66267019…3a1 (PIPE-10 + D-14)", async (t) => {
    _setCaptureRequest((req) => {
        if (isRuleExistencePreflight(req, "r1")) return ruleExistenceStub("r1", "FixtureRule");
        if (req.method === "GET" && req.path.startsWith("/api/system/pipelines/rule/paginated")) {
            return paginatedRuleResponse({
                page: 1,
                perPage: 50,
                rules: [{ id: "r1", title: "FixtureRule" }],
                usedInPipelines: {
                    r1: [
                        { id: "p1", title: "FixturePipelineP1" },
                        { id: "p2", title: "FixturePipelineP2" },
                    ],
                },
            });
        }
        throw new Error(`unexpected ${req.method} ${req.path}`);
    });
    const res = await handleDeletePipelineRule({
        params: { arguments: { _testConnection: "fake", ruleId: "r1" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.cascades.pipelines.length, 2);
    // PINNED LITERAL — Plan 04-04 SUMMARY drift sentinel.
    assert.equal(payload.confirmationToken, PINNED_HASH_TWO_PIPELINES);
    assert.equal(
        payload.confirmationToken,
        computeRuleCascadeHash({ ruleId: "r1", pipelineIds: ["p1", "p2"] }),
        "F8 hash drift — pinned literal must equal computeRuleCascadeHash output",
    );
    assert.match(payload.confirmationToken, /^[0-9a-f]{64}$/);
    t.assert.snapshot(payload);
});

// =====================================================================
// F9 — delete_pipeline_rule empty cascade (D-14 keyed-buckets disambiguation)
// =====================================================================
//
// Pins the D-14 cascade-hash frozen literal 9541cfc2…5b1 for ruleId="r1"
// + pipelineIds=[]. CRITICAL — this hash MUST differ from F8's hash
// (keyed-buckets canonicalization treats {pipelines: []} as a distinct
// input shape from {pipelines: [{id,title},...]}). If a future change
// to computeRuleCascadeHash flattens the two shapes, BOTH F8 and F9
// snapshots fail simultaneously.

test("snapshot: delete_pipeline_rule empty cascade (r1 + []) pins frozen hash 9541cfc2…5b1 — DIFFERS from F8 (PIPE-10 + D-14 disambiguation)", async (t) => {
    _setCaptureRequest((req) => {
        if (isRuleExistencePreflight(req, "r1")) return ruleExistenceStub("r1", "FixtureRule");
        if (req.method === "GET" && req.path.startsWith("/api/system/pipelines/rule/paginated")) {
            return paginatedRuleResponse({
                page: 1,
                perPage: 50,
                rules: [{ id: "r1", title: "FixtureRule" }],
                usedInPipelines: { r1: [] },
            });
        }
        throw new Error(`unexpected ${req.method} ${req.path}`);
    });
    const res = await handleDeletePipelineRule({
        params: { arguments: { _testConnection: "fake", ruleId: "r1" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(payload.cascades.pipelines, []);
    // PINNED LITERAL — empty-cascade variant.
    assert.equal(payload.confirmationToken, PINNED_HASH_EMPTY_CASCADE);
    assert.equal(
        payload.confirmationToken,
        computeRuleCascadeHash({ ruleId: "r1", pipelineIds: [] }),
        "F9 hash drift — pinned literal must equal computeRuleCascadeHash output",
    );
    // D-14 disambiguation: F8 hash and F9 hash MUST differ.
    assert.notEqual(
        payload.confirmationToken,
        PINNED_HASH_TWO_PIPELINES,
        "Empty-cascade hash MUST differ from populated-cascade hash (keyed-buckets contract)",
    );
    t.assert.snapshot(payload);
});

// =====================================================================
// F10 — list_pipeline_functions overlay collision (live wins)
// =====================================================================
//
// Filter to category:"debug" (2 static entries: debug, metric_counter_inc)
// PLUS one live overlay that wins on the "debug" name collision (live
// description overrides static). Pins the merged catalogue projection
// with source:"live" for the collided entry; source:"static" for the
// non-collided entry.

test("snapshot: list_pipeline_functions overlay collision — debug category; live wins on `debug` (PIPE-11 + D-03 + Pitfall 5)", async (t) => {
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/pipelines/rule/functions") {
            // Live overlay: one function `debug` that collides with the
            // static baseline + a description that wins on collision.
            return [
                {
                    name: "debug",
                    return_type: "Void",
                    params: [{ name: "value", type: "Object", optional: false }],
                    description: "LIVE DESC: Logs the value at DEBUG level (Phase 4 fixture)",
                    deprecated: false,
                },
            ];
        }
        throw new Error(`unexpected ${req.method} ${req.path}`);
    });
    const res = await handleListPipelineFunctions({
        params: {
            arguments: {
                _testConnection: "fake",
                category: "debug",
                limit: 200,
                fields: "all",   // expand projection so we can pin oneLineDescription
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // Two debug entries: `debug` (live-overlaid) + `metric_counter_inc` (static).
    assert.equal(payload.count, 2);
    const debugEntry = payload.items.find((e) => e.name === "debug");
    assert.ok(debugEntry, "debug entry must exist");
    assert.equal(debugEntry.source, "live", "live wins on name collision");
    assert.match(debugEntry.oneLineDescription, /LIVE DESC/);
    const metricCounterEntry = payload.items.find((e) => e.name === "metric_counter_inc");
    assert.ok(metricCounterEntry, "metric_counter_inc entry must exist (static-only)");
    assert.equal(metricCounterEntry.source, "static");
    t.assert.snapshot(payload);
});

// =====================================================================
// F11 — simulate_pipeline_rule Pitfall 1 (dry-run; body.message JSON-STRING)
// =====================================================================
//
// CRITICAL — Pitfall 1 fixture. The wrapper accepts the friendly form
// `{message: {...field_map...}}` and JSON.stringifies it before emitting
// the wire body. The snapshot pins typeof body.message === "string" via
// the rendered preview JSON — a real Graylog endpoint expects a JSON-string
// (SimulateRuleRequest.message() is typed `String` on the wire).

test("snapshot: simulate_pipeline_rule M3 GATE — dry-run body.message is JSON-STRING (PIPE-12 + Pitfall 1)", async (t) => {
    _setCaptureRequest(pipelinesMultiCapture([
        { method: "POST", pathPattern: "/api/system/pipelines/rule/parse", response: { source: "ok" } },
    ]));
    const res = await handleSimulatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                ruleSource: 'rule "fixture-simulate-noop"\nwhen has_field("source")\nthen\n    set_field("alert", true);\nend',
                message: { source: "host", level: 6 },
                // dryRun default true — pin the preview shape.
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.preview.method, "POST");
    assert.equal(payload.preview.path, "/api/system/pipelines/rule/simulate");
    // Pitfall 1 — body.message is a JSON-STRING in the dry-run preview.
    assert.equal(typeof payload.preview.body.message, "string");
    // Round-trip recovers the agent's original object.
    assert.deepEqual(JSON.parse(payload.preview.body.message), { source: "host", level: 6 });
    // rule_source is the structural envelope around the DSL.
    assert.equal(typeof payload.preview.body.rule_source.source, "string");
    t.assert.snapshot(payload);
});

// =====================================================================
// F12 — simulate_pipeline_rule M3 GATE (apply; post-rule field change)
// =====================================================================
//
// Pins the value proposition: simulate returns the post-rule message
// with the new field set. The synthetic /simulate response shows
// {alert: true} added to the message fields — the rule's set_field
// action surfaces in result.body.message.fields.

const ALERT_ON_LEVEL_STRUCTURED = {
    name: "fixture-alert-on-level",
    when: {
        type: "comparison",
        op: ">=",
        left: { type: "field_ref", field: "level", source: "message" },
        right: { type: "literal", value: 4 },
    },
    then: [
        {
            type: "set_field",
            field: "alert",
            value: { type: "literal", value: true },
        },
    ],
};

test("snapshot: simulate_pipeline_rule M3 GATE — apply surfaces post-rule field change in result.body (PIPE-12 + M3 acceptance)", async (t) => {
    _setCaptureRequest((req) => {
        if (req.method === "POST" && req.path === "/api/system/pipelines/rule/parse") {
            return { source: "ok" };
        }
        if (req.method === "POST" && req.path === "/api/system/pipelines/rule/simulate") {
            // Synthetic post-rule Message DTO — the rule's set_field action
            // added `alert: true` to a message that originally had only
            // `{level: 5, source: "host"}`.
            return {
                message: {
                    fields: { level: 5, source: "host", alert: true },
                    timestamp: "2026-05-15T12:00:00.000Z",
                },
                simulator_state: { rule_fired: true },
            };
        }
        throw new Error(`unexpected ${req.method} ${req.path}`);
    });
    const res = await handleSimulatePipelineRule({
        params: {
            arguments: {
                _testConnection: "fake",
                structured: ALERT_ON_LEVEL_STRUCTURED,
                message: { level: 5, source: "host" },
                dryRun: false,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    // M3 acceptance gate: post-rule message shows the rule's effect.
    assert.equal(payload.result.body.message.fields.alert, true);
    assert.equal(payload.result.body.message.fields.level, 5);
    t.assert.snapshot(payload);
});

// =====================================================================
// F13 — connect_pipelines_to_stream Pitfall 2 GATE (merge preserves existing)
// =====================================================================
//
// currentSet={a,b} + args.pipelineIds=[new] → body.pipeline_ids=[a,b,new]
// (sorted). A naive REPLACE-semantics handler would emit just ["new"],
// silently disconnecting a and b. The merge is the load-bearing line.

test("snapshot: connect_pipelines_to_stream Pitfall 2 GATE — current=[a,b] + args=[new] → body=[a,b,new] (PIPE-13 + Pitfall 2)", async (t) => {
    _setCaptureRequest(pipelinesMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/system/pipelines/connections/fixture-s1",
            response: () => ({
                id: "conn1",
                stream_id: "fixture-s1",
                pipeline_ids: ["a", "b"],
            }),
        },
    ]));
    const res = await handleConnectPipelinesToStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "fixture-s1",
                pipelineIds: ["new"],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // Pitfall 2 GATE — merge preserves a + b.
    assert.deepEqual(payload.preview.body.pipeline_ids, ["a", "b", "new"]);
    assert.notDeepStrictEqual(payload.preview.body.pipeline_ids, ["new"]);
    assert.deepEqual(payload.existingMatches, []);
    t.assert.snapshot(payload);
});

// =====================================================================
// F14 — disconnect_pipelines_from_stream Pitfall 2 GATE (subtract preserves remaining)
// =====================================================================
//
// currentSet={a,b,c} + args.pipelineIds=[b] → body.pipeline_ids=[a,c]
// (sorted). A naive replace handler would emit [b] (disconnecting
// everything except b) or [] (disconnecting all). The subtract path
// preserves a + c.

test("snapshot: disconnect_pipelines_from_stream Pitfall 2 GATE — current=[a,b,c] + args=[b] → body=[a,c] (PIPE-14 + Pitfall 2 mirror)", async (t) => {
    _setCaptureRequest(pipelinesMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/system/pipelines/connections/fixture-s1",
            response: () => ({
                id: "conn1",
                stream_id: "fixture-s1",
                pipeline_ids: ["a", "b", "c"],
            }),
        },
    ]));
    const res = await handleDisconnectPipelinesFromStream({
        params: {
            arguments: {
                _testConnection: "fake",
                streamId: "fixture-s1",
                pipelineIds: ["b"],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // Pitfall 2 mirror — subtract preserves a + c.
    assert.deepEqual(payload.preview.body.pipeline_ids, ["a", "c"]);
    assert.deepEqual(payload.existingMatches, []);
    t.assert.snapshot(payload);
});
