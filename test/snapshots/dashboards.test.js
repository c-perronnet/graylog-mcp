// Plan 06-06 Task 1 (Step A) — 9 dashboard snapshot fixtures.
//
// Each fixture pins one Phase 6 dashboard tool's dry-run preview shape OR
// apply result OR refusal envelope. Static args + seeded UUID generator
// ensure byte-determinism across runs. The snapshot serializer
// (node:test default) normalises indentation + key order — the resulting
// .snapshot file is byte-stable across machines and CI runs.
//
// Coverage matrix (per 06-06-PLAN.md fixtures 1..9):
//
//   F1  list_dashboards apply               — 1-DASHBOARD narrow projection
//   F2  get_dashboard apply                  — full ViewDTO pass-through (4 widgets)
//   F3  create_dashboard dry-run             — C7 ACCEPTANCE GATE
//                                              2-step Search+View chain
//                                              dependsOn on step 2
//                                              wrapper-generated UUID widget IDs
//                                              POST /api/views/search BARE body
//                                              POST /api/views CreateEntityRequest envelope
//                                              __SERVER_ASSIGNED__step1 placeholder in body.search_id
//   F4  create_dashboard dry-run (D-03)      — widget-position integrity refusal
//                                              isError envelope BEFORE wire emission
//                                              NO chain in payload (rejected pre-build)
//   F5  update_dashboard dry-run             — STRICT_NO_ECHO title-only change
//                                              PUT body preserves immutable search_id + state
//                                              from GET response; only title overlaid
//   F6  delete_dashboard dry-run             — leaf delete informational cascade
//                                              cascades.widgets.count populated from GET
//                                              NO confirmationToken (informational, not gated)
//   F7  add_widget_from_template dry-run     — D-06 ACCEPTANCE GATE
//                                              2-step PUT chain (Search+View)
//                                              error_rate_over_time template applied
//   F8  add_widget_from_template (M7)        — M7 ACCEPTANCE GATE
//                                              zod refusal for invalid templateName
//                                              isError envelope; NO chain emitted
//   F9  remove_widget dry-run                — symmetric 2-step PUT chain
//                                              widget stripped from BOTH Search and View
//
// Determinism contract: two consecutive `npm test` runs must produce
// byte-identical md5sums of test/snapshots/__snapshots__/dashboards.test.js.snapshot.
// The auth-redaction lint (test/auth-redaction.test.js) scans this file
// dynamically.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "../snapshot-config.js";

import { handleListDashboards } from "../../src/tools/dashboards/list-dashboards.js";
import { handleGetDashboard } from "../../src/tools/dashboards/get-dashboard.js";
import {
    handleCreateDashboard,
    _setUUIDGeneratorForTests,
    _clearUUIDGeneratorForTests,
    _setWidgetPositionValidatorForTests,
    _clearWidgetPositionValidatorForTests,
} from "../../src/tools/dashboards/create-dashboard.js";
import { handleUpdateDashboard } from "../../src/tools/dashboards/update-dashboard.js";
import { handleDeleteDashboard } from "../../src/tools/dashboards/delete-dashboard.js";
import { handleRemoveWidget } from "../../src/tools/dashboards/remove-widget.js";
import { handleAddWidgetFromTemplate } from "../../src/tools/dashboards/add-widget-from-template.js";

import {
    _setCaptureRequest,
    _clearCaptureRequest,
} from "../../src/graylog/client.js";
import {
    _clearConnectionsForTests,
    setActiveConnection,
} from "../../src/config.js";

beforeEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
});

afterEach(() => {
    _clearCaptureRequest();
    _clearConnectionsForTests();
    setActiveConnection(null);
    _clearUUIDGeneratorForTests();
    _clearWidgetPositionValidatorForTests();
});

// =====================================================================
// Seeded UUID generator — mirrors test/dashboards.test.js precedent.
// =====================================================================
function makeSeededUUIDGenerator(start = 1) {
    let n = start;
    return () => {
        const hex = (n++).toString(16).padStart(12, "0");
        return `00000000-0000-4000-8000-${hex}`;
    };
}

// Multi-route capture for handlers that fire multiple HTTP requests.
function dashboardsMultiCapture(routes) {
    return (req) => {
        for (const r of routes) {
            const matches = typeof r.pathPattern === "string"
                ? req.path === r.pathPattern
                : (r.pathPattern instanceof RegExp ? r.pathPattern.test(req.path) : false);
            if (req.method === r.method && matches) {
                return typeof r.response === "function" ? r.response(req) : r.response;
            }
        }
        throw new Error(`No route matched ${req.method} ${req.path}`);
    };
}

// =====================================================================
// Static fixtures
// =====================================================================

const VIEW_DASHBOARD_FIXTURE = {
    id: "v-fixed-1",
    type: "DASHBOARD",
    title: "Dashboard A",
    summary: "Summary A",
    description: "Description A",
};

const FULL_VIEW_FIXTURE = {
    id: "v-fixed-2",
    type: "DASHBOARD",
    title: "Payment Service Health",
    summary: "4 widgets",
    description: "Auto-generated dashboard",
    search_id: "S-fixed-1",
    properties: [],
    requires: {},
    favorite: false,
    state: {
        "q-1": {
            selected_fields: null,
            static_message_list_id: null,
            titles: { titles: {} },
            widgets: [
                { id: "w-A", type: "aggregation" },
                { id: "w-B", type: "aggregation" },
                { id: "w-C", type: "aggregation" },
                { id: "w-D", type: "messages" },
            ],
            widget_mapping: {
                "w-A": ["st-A"],
                "w-B": ["st-B"],
                "w-C": ["st-C"],
                "w-D": ["st-D"],
            },
            positions: {
                "w-A": { col: 1, row: 1, height: 4, width: 6 },
                "w-B": { col: 7, row: 1, height: 4, width: 6 },
                "w-C": { col: 1, row: 5, height: 4, width: 4 },
                "w-D": { col: 1, row: 9, height: 6, width: 12 },
            },
            formatting: null,
        },
    },
};

// Widget triplets used by create_dashboard fixture — 4 widgets (one per
// the BLUE-01 default template set).
const C7_WIDGET_TRIPLETS = [
    {
        widget: { type: "aggregation" },
        position: { col: 1, row: 1, height: 4, width: 6 },
        searchType: { type: "pivot" },
    },
    {
        widget: { type: "aggregation" },
        position: { col: 7, row: 1, height: 4, width: 6 },
        searchType: { type: "pivot" },
    },
    {
        widget: { type: "aggregation" },
        position: { col: 1, row: 5, height: 4, width: 4 },
        searchType: { type: "pivot" },
    },
    {
        widget: { type: "messages" },
        position: { col: 1, row: 9, height: 6, width: 12 },
        searchType: { type: "messages" },
    },
];

// =====================================================================
// F1 — list_dashboards apply (1-DASHBOARD narrow projection)
// =====================================================================

test("snapshot: list_dashboards narrow projection (DASH-01 F1)", async (t) => {
    _setCaptureRequest(() => ({
        total: 1,
        views: [VIEW_DASHBOARD_FIXTURE],
    }));
    const res = await handleListDashboards({
        params: { arguments: { _testConnection: "fixture_conn" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "list_dashboards");
    assert.equal(payload.count, 1);
    assert.deepEqual(
        Object.keys(payload.items[0]).sort(),
        ["description", "id", "summary", "title"],
    );
    t.assert.snapshot(payload);
});

// =====================================================================
// F2 — get_dashboard apply (full ViewDTO pass-through)
// =====================================================================

test("snapshot: get_dashboard full ViewDTO pass-through with 4 widgets (DASH-02 F2)", async (t) => {
    _setCaptureRequest(() => FULL_VIEW_FIXTURE);
    const res = await handleGetDashboard({
        params: {
            arguments: { _testConnection: "fixture_conn", dashboardId: "v-fixed-2" },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "get_dashboard");
    assert.equal(payload.dashboard.id, "v-fixed-2");
    assert.equal(payload.dashboard.state["q-1"].widgets.length, 4);
    t.assert.snapshot(payload);
});

// =====================================================================
// F3 — create_dashboard dry-run (C7 ACCEPTANCE GATE)
// =====================================================================
//
// Pins the 2-step internal Search+View chain shape + dependsOn on step 2
// + wrapper-generated UUID widget IDs + BARE SearchDTO body on step 1 +
// CreateEntityRequest envelope on step 2 + __SERVER_ASSIGNED__step1
// placeholder in body.entity.search_id. The chain transcript IS the
// C7 mitigation contract.

test("snapshot: create_dashboard dry-run C7 ACCEPTANCE GATE 2-step Search+View chain (DASH-03 F3)", async (t) => {
    _setCaptureRequest(dashboardsMultiCapture([
        {
            method: "GET",
            pathPattern: /^\/api\/views\?query=/,
            response: { total: 0, views: [] },
        },
    ]));
    // Seeded UUID generator — IDs 1..8 cover 4 widgets × 2 (widget + searchType).
    _setUUIDGeneratorForTests(makeSeededUUIDGenerator(1));
    const res = await handleCreateDashboard({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                title: "Payment Service Health",
                description: "Auto-generated dashboard",
                summary: "4 widgets",
                widgets: C7_WIDGET_TRIPLETS,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // C7 chain shape.
    assert.equal(payload.dryRun, true);
    assert.equal(payload.chain.length, 2);
    assert.equal(payload.chain[0].request.path, "/api/views/search");
    assert.equal(payload.chain[1].request.path, "/api/views");
    assert.equal(payload.chain[1].dependsOn.from, "step1.response.id");
    assert.equal(payload.chain[1].dependsOn.as, "searchId");
    // Step 1 BARE SearchDTO; step 2 CreateEntityRequest envelope.
    assert.equal(payload.chain[0].request.body.entity, undefined);
    assert.equal(payload.chain[1].request.body.share_request, null);
    assert.equal(payload.chain[1].request.body.entity.search_id, "__SERVER_ASSIGNED__step1");
    t.assert.snapshot(payload);
});

// =====================================================================
// F4 — create_dashboard D-03 widget-position integrity violation refusal
// =====================================================================
//
// D-03 ACCEPTANCE GATE: the validator throws BEFORE any HTTP fires.
// The isError envelope MUST NOT carry a `chain` or `preview.path` —
// build() never returned a descriptor.

test("snapshot: create_dashboard D-03 widget-position integrity refusal BEFORE wire (DASH-03 F4)", async (t) => {
    let httpCalls = 0;
    _setCaptureRequest(() => {
        httpCalls++;
        return { total: 0, views: [] };
    });
    // Inject a validator stub that simulates the D-03 refusal path.
    _setWidgetPositionValidatorForTests(() => {
        const err = new Error("Widget/position integrity violation: simulated for snapshot fixture");
        err.reason = "widget_position_integrity_violation";
        err.isClientSide = true;
        throw err;
    });
    _setUUIDGeneratorForTests(makeSeededUUIDGenerator(100));
    const res = await handleCreateDashboard({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                title: "Payment Service Health",
                widgets: C7_WIDGET_TRIPLETS,
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /integrity/i);
    // D-03: NO HTTP fired — validator runs BEFORE existingMatches probe.
    assert.equal(httpCalls, 0);
    t.assert.snapshot(res);
});

// =====================================================================
// F5 — update_dashboard dry-run (STRICT_NO_ECHO title-only)
// =====================================================================
//
// Pins the GET pre-flight overlay: PUT body carries the immutable
// search_id + state from the GET response, with ONLY title overlaid.
// D-02 enforces searchId immutability via UpdateDashboardSchema.changes
// being .strict() (verified separately in dashboards.test.js).

test("snapshot: update_dashboard STRICT_NO_ECHO title-only overlay (DASH-04 F5)", async (t) => {
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/views/v-fixed-2") {
            return FULL_VIEW_FIXTURE;
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleUpdateDashboard({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                dashboardId: "v-fixed-2",
                changes: { title: "Payment Service Health (renamed)" },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.method, "PUT");
    assert.equal(payload.preview.path, "/api/views/v-fixed-2");
    // STRICT_NO_ECHO: search_id and state survived from GET response.
    assert.equal(payload.preview.body.entity.search_id, "S-fixed-1");
    assert.equal(payload.preview.body.entity.state["q-1"].widgets.length, 4);
    // Title overlaid; description/summary untouched (from GET fixture).
    assert.equal(payload.preview.body.entity.title, "Payment Service Health (renamed)");
    t.assert.snapshot(payload);
});

// =====================================================================
// F6 — delete_dashboard dry-run (leaf — informational cascade)
// =====================================================================
//
// Pins the informational cascade: cascades.widgets.count populated from
// GET pre-flight. NO confirmationToken (leaf delete; widgets vanish with
// view; bound Search becomes orphan per Graylog model).

test("snapshot: delete_dashboard informational cascade.widgets.count from GET (DASH-05 F6)", async (t) => {
    _setCaptureRequest(dashboardsMultiCapture([
        { method: "GET", pathPattern: "/api/views/v-fixed-2", response: FULL_VIEW_FIXTURE },
    ]));
    const res = await handleDeleteDashboard({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                dashboardId: "v-fixed-2",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.method, "DELETE");
    assert.equal(payload.preview.path, "/api/views/v-fixed-2");
    // Informational cascade — 4 widgets from FULL_VIEW_FIXTURE.
    assert.deepEqual(payload.cascades, { widgets: { count: 4 } });
    // Leaf delete — NO confirmationToken.
    assert.equal(payload.confirmationToken, undefined);
    t.assert.snapshot(payload);
});

// =====================================================================
// F7 — add_widget_from_template dry-run (D-06 ACCEPTANCE GATE)
// =====================================================================
//
// Pins the 2-step PUT chain (Search+View symmetric to remove_widget).
// error_rate_over_time template — agent passes streamIds=["s-1"].
// Wrapper-generated widget id + searchType id via seeded UUID generator.

test("snapshot: add_widget_from_template error_rate_over_time 2-step PUT chain (DASH-06 F7)", async (t) => {
    const view = {
        ...FULL_VIEW_FIXTURE,
        state: {
            "q-1": {
                ...FULL_VIEW_FIXTURE.state["q-1"],
                // Start with a single existing widget so the post-add view
                // has 2 widgets (deterministic snapshot shape).
                widgets: [{ id: "w-existing", type: "aggregation" }],
                widget_mapping: { "w-existing": ["st-existing"] },
                positions: { "w-existing": { col: 1, row: 1, height: 2, width: 4 } },
            },
        },
    };
    const search = {
        id: "S-fixed-1",
        queries: [{
            id: "q-1",
            timerange: { type: "relative", from: 300 },
            filter: null,
            filters: [],
            query: { type: "elasticsearch", query_string: "" },
            search_types: [{ id: "st-existing", type: "pivot" }],
        }],
        parameters: [],
        skip_no_streams_check: false,
    };
    _setCaptureRequest(dashboardsMultiCapture([
        { method: "GET", pathPattern: "/api/views/v-fixed-2", response: view },
        { method: "GET", pathPattern: "/api/views/search/S-fixed-1", response: search },
    ]));
    const res = await handleAddWidgetFromTemplate({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                dashboardId: "v-fixed-2",
                templateName: "error_rate_over_time",
                options: {
                    streamIds: ["s-1"],
                    widgetId: "w-new-fixed",
                    searchTypeId: "st-new-fixed",
                },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.chain.length, 2);
    // Step 1: PUT /api/views/search/S-fixed-1 with appended searchType.
    assert.equal(payload.chain[0].request.method, "PUT");
    assert.equal(payload.chain[0].request.path, "/api/views/search/S-fixed-1");
    // Step 2: PUT /api/views/v-fixed-2 with new widget + position + mapping.
    assert.equal(payload.chain[1].request.method, "PUT");
    assert.equal(payload.chain[1].request.path, "/api/views/v-fixed-2");
    assert.equal(
        payload.chain[1].request.body.entity.state["q-1"].widgets.length,
        2,
    );
    t.assert.snapshot(payload);
});

// =====================================================================
// F8 — add_widget_from_template M7 ACCEPTANCE GATE (closed-set rejection)
// =====================================================================
//
// templateName "bogus" rejects at zod.parse (z.enum(TEMPLATE_NAMES)).
// NO HTTP fires; no chain emitted; structural isError envelope.

test("snapshot: add_widget_from_template M7 ACCEPTANCE GATE — closed-set zod refusal (DASH-06 F8)", async (t) => {
    let httpFired = false;
    _setCaptureRequest(() => {
        httpFired = true;
        throw new Error("HTTP fired despite invalid template name");
    });
    const res = await handleAddWidgetFromTemplate({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                dashboardId: "v-fixed-2",
                templateName: "bogus",
                options: { streamIds: ["s-1"] },
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(httpFired, false, "M7: zod MUST reject before any HTTP");
    assert.match(res.content[0].text, /templateName|bogus|invalid_enum/i);
    t.assert.snapshot(res);
});

// =====================================================================
// F9 — remove_widget dry-run (symmetric 2-step PUT chain)
// =====================================================================
//
// Removing widget "w-A" — chain strips:
//   - search_types entry whose id is "st-A" (from widget_mapping[w-A])
//   - widget "w-A" from state["q-1"].widgets
//   - position "w-A" from state["q-1"].positions
//   - widget_mapping["w-A"] entry

test("snapshot: remove_widget symmetric 2-step PUT chain strips widget from Search+View (DASH-07 F9)", async (t) => {
    const search = {
        id: "S-fixed-1",
        queries: [{
            id: "q-1",
            timerange: { type: "relative", from: 300 },
            filter: null,
            filters: [],
            query: { type: "elasticsearch", query_string: "" },
            search_types: [
                { id: "st-A", type: "pivot" },
                { id: "st-B", type: "pivot" },
                { id: "st-C", type: "pivot" },
                { id: "st-D", type: "messages" },
            ],
        }],
        parameters: [],
        skip_no_streams_check: false,
    };
    _setCaptureRequest(dashboardsMultiCapture([
        { method: "GET", pathPattern: "/api/views/v-fixed-2", response: FULL_VIEW_FIXTURE },
        { method: "GET", pathPattern: "/api/views/search/S-fixed-1", response: search },
    ]));
    const res = await handleRemoveWidget({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                dashboardId: "v-fixed-2",
                widgetId: "w-A",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.chain.length, 2);
    // Step 1: PUT /api/views/search/S-fixed-1 with st-A stripped from search_types.
    assert.equal(payload.chain[0].request.path, "/api/views/search/S-fixed-1");
    assert.equal(
        payload.chain[0].request.body.queries[0].search_types.length,
        3,  // 4 original - 1 removed
    );
    // Step 2: PUT /api/views/v-fixed-2 with w-A stripped from widgets/positions/widget_mapping.
    assert.equal(payload.chain[1].request.path, "/api/views/v-fixed-2");
    const newState = payload.chain[1].request.body.entity.state["q-1"];
    assert.equal(newState.widgets.length, 3);
    assert.equal(newState.positions["w-A"], undefined);
    assert.equal(newState.widget_mapping["w-A"], undefined);
    t.assert.snapshot(payload);
});
