// Plan 06-02 — Dashboard CRUD tests (DASH-01..05 + DASH-07).
//
// Covers:
//   - DASH-01 list_dashboards: narrow projection, wrapper-side type filter
//     (Q1 default), envelope unwrap on response.views, ?query=type:DASHBOARD
//     wire path
//   - DASH-02 get_dashboard: full ViewDTO passthrough, 404 propagation via
//     wrapGraylogError, zod rejection of missing dashboardId
//   - DASH-03 create_dashboard (C7 ACCEPTANCE GATE): 2-step internal chain
//     {POST /api/views/search, POST /api/views} with dependsOn substitution;
//     D-02 structural reject of agent-supplied searchId; D-03 widget-position
//     integrity validator before HTTP; wrapper-generated UUID widget IDs;
//     FOUND-11 title-collision existingMatches; apply-time placeholder
//     substitution
//   - DASH-04 update_dashboard: STRICT_NO_ECHO partial-update via GET-current
//     pre-flight; D-02 structural reject of searchId in changes; empty
//     changes refusal
//   - DASH-05 delete_dashboard: leaf delete with informational widget cascade,
//     no confirmation token
//   - DASH-07 remove_widget: symmetric Search+View 2-step PUT chain, D-03
//     validator on prospective post-remove sets, widget_not_found refusal
//
// Test patterns mirror test/streams.test.js + test/events.test.js: the
// _testConnection seam + _setCaptureRequest mocks substitute for axios; zod
// rejections are tested via direct handler invocation; the full module-init
// assertion is exercised via the dispatch wiring test.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";

import { handleListDashboards } from "../src/tools/dashboards/list-dashboards.js";
import { handleGetDashboard } from "../src/tools/dashboards/get-dashboard.js";
import {
    handleCreateDashboard,
    _setUUIDGeneratorForTests,
    _clearUUIDGeneratorForTests,
    _setWidgetPositionValidatorForTests,
    _clearWidgetPositionValidatorForTests,
} from "../src/tools/dashboards/create-dashboard.js";
import { handleUpdateDashboard } from "../src/tools/dashboards/update-dashboard.js";
import { handleDeleteDashboard } from "../src/tools/dashboards/delete-dashboard.js";
import {
    handleRemoveWidget,
    _setWidgetPositionValidatorForTests as _setRemoveWidgetValidatorForTests,
    _clearWidgetPositionValidatorForTests as _clearRemoveWidgetValidatorForTests,
} from "../src/tools/dashboards/remove-widget.js";
// Plan 06-03 Task 2 — DASH-06 add_widget_from_template
import {
    handleAddWidgetFromTemplate,
    _setWidgetPositionValidatorForTests as _setAddWidgetValidatorForTests,
    _clearWidgetPositionValidatorForTests as _clearAddWidgetValidatorForTests,
} from "../src/tools/dashboards/add-widget-from-template.js";
import { TEMPLATE_NAMES } from "../src/widget-templates/index.js";

import {
    ListDashboardsSchema,
    GetDashboardSchema,
    CreateDashboardSchema,
    UpdateDashboardSchema,
    DeleteDashboardSchema,
    RemoveWidgetSchema,
    AddWidgetFromTemplateSchema,
} from "../src/tools/dashboards/schemas.js";

import {
    _setCaptureRequest,
    _clearCaptureRequest,
} from "../src/graylog/client.js";
import {
    _clearConnectionsForTests,
    setActiveConnection,
} from "../src/config.js";
import { GraylogNotFoundError } from "../src/graylog/errors.js";

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
    _clearRemoveWidgetValidatorForTests();
    _clearAddWidgetValidatorForTests();
});

// Seeded deterministic UUID generator for byte-stable snapshot fixtures.
// Increments a counter on each call and emits a recognizable UUID-shaped
// string. Tests that care about the EXACT UUID assert against this; tests
// that only care about UUID shape match against the regex.
function makeSeededUUIDGenerator(start = 1) {
    let n = start;
    return () => {
        const hex = (n++).toString(16).padStart(12, "0");
        // Canonical UUID v4 shape: 8-4-4-4-12 (37 chars incl. dashes; 36
        // chars excl.). Matches /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        return `00000000-0000-4000-8000-${hex}`;
    };
}

// Multi-route capture for handlers that fire MORE than one HTTP request
// from build() (e.g. create_dashboard fires GET /api/views for the
// FOUND-11 existingMatches probe, then in apply walks the 2-step chain).
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
// Fixtures — verified shapes per 06-RESEARCH.md §"Endpoint Catalogue"
// =====================================================================

// Minimal ViewDTO shapes for list_dashboards.
const VIEW_DASHBOARD_A = {
    id: "v-1",
    type: "DASHBOARD",
    title: "App Errors",
    summary: "Dashboard summary A",
    description: "Dashboard description A",
};

const VIEW_DASHBOARD_B = {
    id: "v-2",
    type: "DASHBOARD",
    title: "System Events",
    summary: "Dashboard summary B",
    description: "",
};

// Saved-search SHOULD be filtered out by the wrapper-side Q1 type filter.
const VIEW_SAVED_SEARCH = {
    id: "v-3",
    type: "SEARCH",
    title: "Leaked saved search",
    summary: "",
    description: "Should be filtered out by wrapper-side Q1 filter",
};

// Full ViewDTO for get_dashboard (single-DTO read tool — no projection).
const FULL_VIEW = {
    id: "v-1",
    type: "DASHBOARD",
    title: "App Errors",
    summary: "App errors at a glance",
    description: "Production app-tier errors",
    search_id: "S-1",
    properties: [],
    requires: {},
    favorite: false,
    state: {
        "q-1": {
            selected_fields: null,
            static_message_list_id: null,
            titles: { titles: {} },
            widgets: [{ id: "w-1", type: "messages" }],
            widget_mapping: { "w-1": ["st-1"] },
            positions: { "w-1": { col: 1, row: 1, height: 2, width: 4 } },
            formatting: null,
            display_mode_settings: {
                positions_inferred: false,
                show_summary: false,
                show_message_row: false,
            },
        },
    },
};

// =====================================================================
// DASH-01 list_dashboards — schema parity
// =====================================================================

test("ListDashboardsSchema extends listBase (no per-tool args required)", () => {
    const parsed = ListDashboardsSchema.parse({});
    assert.equal(parsed.connectionName, undefined);
    assert.equal(parsed.limit, undefined);
});

// =====================================================================
// Test 1 — list_dashboards narrow projection (default fields)
// =====================================================================

test("list_dashboards returns narrow projection [id, title, summary, description] by default", async () => {
    _setCaptureRequest(() => ({
        total: 2,
        views: [VIEW_DASHBOARD_A, VIEW_DASHBOARD_B],
    }));
    const res = await handleListDashboards({
        params: { arguments: { _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "list_dashboards");
    assert.equal(payload.count, 2);
    assert.deepEqual(payload.fields, ["id", "title", "summary", "description"]);
    // Narrow projection — type / search_id / state / etc. MUST be stripped.
    assert.deepEqual(
        Object.keys(payload.items[0]).sort(),
        ["description", "id", "summary", "title"],
    );
    assert.equal(payload.items[0].id, "v-1");
    assert.equal(payload.items[0].title, "App Errors");
    assert.equal(payload.items[0].type, undefined);
});

// =====================================================================
// Test 2 — list_dashboards wrapper-side filter drops saved-searches
//           (Q1 WRAPPER_SIDE_TYPE_FILTER default per 06-U1-SMOKE.md)
// =====================================================================

test("list_dashboards filters wrapper-side on view.type === 'DASHBOARD' (Q1 default)", async () => {
    _setCaptureRequest(() => ({
        total: 3,
        // Mixed response: 2 DASHBOARD + 1 SEARCH. Even if upstream
        // ?query=type:DASHBOARD leaks (SEARCH_FIELD_MAPPING excludes `type`),
        // the wrapper filter MUST drop the saved-search.
        views: [VIEW_DASHBOARD_A, VIEW_SAVED_SEARCH, VIEW_DASHBOARD_B],
    }));
    const res = await handleListDashboards({
        params: { arguments: { _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.count, 2);
    const ids = payload.items.map((it) => it.id).sort();
    assert.deepEqual(ids, ["v-1", "v-2"]);
    // The leaked SEARCH MUST be absent regardless of upstream filter behavior.
    assert.ok(!payload.items.some((it) => it.id === "v-3"));
});

// =====================================================================
// Test 3 — list_dashboards URL carries ?query=type:DASHBOARD
// =====================================================================

test("list_dashboards URL carries ?query=type:DASHBOARD (URL-encoded)", async () => {
    let captured = null;
    _setCaptureRequest((req) => {
        captured = req;
        return { total: 0, views: [] };
    });
    await handleListDashboards({
        params: { arguments: { _testConnection: "fake" } },
    });
    assert.equal(captured.method, "GET");
    // encodeURIComponent("type:DASHBOARD") === "type%3ADASHBOARD"
    assert.match(captured.path, /\/api\/views\?query=type%3ADASHBOARD/);
    assert.match(captured.path, /page=1/);
    assert.match(captured.path, /per_page=25/);
});

// =====================================================================
// Test 4 — list_dashboards fields:"all" returns full ViewDTO
// =====================================================================

test("list_dashboards with fields:'all' returns full ViewDTO (no projection)", async () => {
    _setCaptureRequest(() => ({
        total: 1,
        views: [VIEW_DASHBOARD_A],
    }));
    const res = await handleListDashboards({
        params: { arguments: { _testConnection: "fake", fields: "all" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.fields, "all");
    // Full DTO — type field must survive the projection bypass.
    assert.equal(payload.items[0].type, "DASHBOARD");
});

// =====================================================================
// Test 5 — list_dashboards unwraps response.views envelope
// =====================================================================

test("list_dashboards unwraps response.views envelope (Pitfall 1)", async () => {
    _setCaptureRequest(() => ({
        // Pitfall 1: /api/views returns PaginatedResponse with array under
        // `response.views` (NOT `items` or top-level array). Handler must
        // unwrap correctly or response is empty.
        total: 1,
        views: [VIEW_DASHBOARD_A],
    }));
    const res = await handleListDashboards({
        params: { arguments: { _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.count, 1);
    assert.equal(payload.items[0].id, "v-1");
});

// =====================================================================
// Test 6 — get_dashboard returns full ViewDTO
// =====================================================================

test("get_dashboard returns the full ViewDTO with state.widgets/widget_mapping/positions intact", async () => {
    let captured = null;
    _setCaptureRequest((req) => {
        captured = req;
        return FULL_VIEW;
    });
    const res = await handleGetDashboard({
        params: { arguments: { _testConnection: "fake", dashboardId: "v-1" } },
    });
    assert.equal(captured.method, "GET");
    assert.equal(captured.path, "/api/views/v-1");
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "get_dashboard");
    assert.equal(payload.dashboard.id, "v-1");
    assert.equal(payload.dashboard.type, "DASHBOARD");
    assert.equal(payload.dashboard.search_id, "S-1");
    // State + widget map preserved (load-bearing for remove_widget pre-flight).
    assert.equal(payload.dashboard.state["q-1"].widgets.length, 1);
    assert.deepEqual(payload.dashboard.state["q-1"].widget_mapping, { "w-1": ["st-1"] });
});

// =====================================================================
// Test 7 — get_dashboard propagates 404 via wrapGraylogError
// =====================================================================

test("get_dashboard propagates 404 as MCP error envelope via wrapGraylogError", async () => {
    _setCaptureRequest(() => {
        throw new GraylogNotFoundError("Dashboard not found", {
            status: 404,
            method: "GET",
            path: "/api/views/missing",
            body: null,
        });
    });
    const res = await handleGetDashboard({
        params: { arguments: { _testConnection: "fake", dashboardId: "missing" } },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /404/);
    assert.match(res.content[0].text, /get_dashboard/);
});

// =====================================================================
// Test 8 — get_dashboard rejects missing dashboardId at zod parse
// =====================================================================

test("get_dashboard without dashboardId fails at zod.parse with structured error", async () => {
    const res = await handleGetDashboard({
        params: { arguments: { _testConnection: "fake" } },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /dashboardId/);
});

// =====================================================================
// GetDashboardSchema parity check (defense-in-depth — schema is a contract)
// =====================================================================

test("GetDashboardSchema rejects empty dashboardId", () => {
    assert.throws(
        () => GetDashboardSchema.parse({ dashboardId: "" }),
        (err) => err?.name === "ZodError",
    );
});

// =====================================================================
// DASH-03 create_dashboard — C7 ACCEPTANCE GATE + D-02 + D-03
// =====================================================================
//
// The crown jewel of Phase 6: the internal Search+View 2-step chain that
// forecloses the C7 attack vector. Tests below pin every load-bearing
// guarantee:
//   - chain transcript shape (Tests 1-4)
//   - D-02 structural reject of searchId (Test 5)
//   - D-03 widget-position-integrity refusal BEFORE HTTP (Test 6)
//   - wrapper-generated UUID widget IDs (Test 7)
//   - FOUND-11 title-collision existingMatches (Test 8)
//   - apply-time chain walk + dependsOn substitution (Tests 9-10)

// Fixture widget triplet — minimal valid shape.
const WIDGET_TRIPLET_A = {
    widget: { id: "w-fixed-1", type: "messages" },
    position: { col: 1, row: 1, height: 2, width: 4 },
    searchType: { id: "st-fixed-1", type: "messages" },
};

const WIDGET_TRIPLET_B = {
    widget: { id: "w-fixed-2", type: "aggregation" },
    position: { col: 5, row: 1, height: 2, width: 4 },
    searchType: { id: "st-fixed-2", type: "pivot" },
};

// =====================================================================
// Test 1 — create_dashboard dry-run chain shape (2 steps + dependsOn)
// =====================================================================

test("create_dashboard dry-run emits a 2-step chain with dependsOn on step 2 (C7 acceptance)", async () => {
    _setCaptureRequest(dashboardsMultiCapture([
        { method: "GET", pathPattern: /^\/api\/views\?query=/, response: { total: 0, views: [] } },
    ]));
    const res = await handleCreateDashboard({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "Test Dashboard",
                widgets: [WIDGET_TRIPLET_A],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.tool, "create_dashboard");
    // C7 chain: 2 steps with dependsOn on step 2.
    assert.ok(Array.isArray(payload.chain), "chain MUST be present in dry-run preview");
    assert.equal(payload.chain.length, 2);
    assert.equal(payload.chain[0].step, 1);
    assert.equal(payload.chain[1].step, 2);
    assert.equal(payload.chain[1].dependsOn.from, "step1.response.id");
    assert.equal(payload.chain[1].dependsOn.as, "searchId");
});

// =====================================================================
// Test 2 — chain step 1 = POST /api/views/search with SearchDTO body
// =====================================================================

test("create_dashboard chain step 1 = POST /api/views/search with BARE SearchDTO body (Pitfall 3)", async () => {
    _setCaptureRequest(dashboardsMultiCapture([
        { method: "GET", pathPattern: /^\/api\/views\?query=/, response: { total: 0, views: [] } },
    ]));
    const res = await handleCreateDashboard({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "Test Dashboard",
                widgets: [WIDGET_TRIPLET_A],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    const step1 = payload.chain[0];
    assert.equal(step1.request.method, "POST");
    assert.equal(step1.request.path, "/api/views/search");
    // BARE SearchDTO body — NOT envelope-wrapped (Pitfall 3).
    assert.equal(step1.request.body.entity, undefined);
    assert.ok(Array.isArray(step1.request.body.queries));
    assert.equal(step1.request.body.queries[0].id, "q-1");
    assert.equal(step1.request.body.queries[0].search_types.length, 1);
    assert.equal(step1.request.body.queries[0].search_types[0].id, "st-fixed-1");
});

// =====================================================================
// Test 3 — chain step 2 = POST /api/views with CreateEntityRequest envelope
// =====================================================================

test("create_dashboard chain step 2 = POST /api/views with CreateEntityRequest envelope + __SERVER_ASSIGNED__step1 placeholder", async () => {
    _setCaptureRequest(dashboardsMultiCapture([
        { method: "GET", pathPattern: /^\/api\/views\?query=/, response: { total: 0, views: [] } },
    ]));
    const res = await handleCreateDashboard({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "Test Dashboard",
                widgets: [WIDGET_TRIPLET_A],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    const step2 = payload.chain[1];
    assert.equal(step2.request.method, "POST");
    assert.equal(step2.request.path, "/api/views");
    // CreateEntityRequest envelope (Pitfall 3 standard pattern).
    assert.equal(step2.request.body.share_request, null);
    assert.equal(step2.request.body.entity.type, "DASHBOARD");
    // searchId is the apply-time placeholder; executeChain replaces it
    // with step 1's response.id at apply time.
    assert.equal(step2.request.body.entity.search_id, "__SERVER_ASSIGNED__step1");
});

// =====================================================================
// Test 4 — primary preview mirrors step 2 (agent's mental model)
// =====================================================================

test("create_dashboard primary preview mirrors step 2 (POST /api/views — agent's mental model)", async () => {
    _setCaptureRequest(dashboardsMultiCapture([
        { method: "GET", pathPattern: /^\/api\/views\?query=/, response: { total: 0, views: [] } },
    ]));
    const res = await handleCreateDashboard({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "Test Dashboard",
                widgets: [WIDGET_TRIPLET_A],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.method, "POST");
    assert.equal(payload.preview.path, "/api/views");
    assert.equal(payload.preview.body.entity.type, "DASHBOARD");
});

// =====================================================================
// Test 5 — D-02 STRUCTURAL: schema REJECTS agent-supplied searchId
// =====================================================================

test("create_dashboard schema REJECTS agent-supplied searchId (D-02 structural .strict() reject)", async () => {
    const res = await handleCreateDashboard({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "Test Dashboard",
                searchId: "malicious-search-id",  // <-- D-02 violation
                widgets: [WIDGET_TRIPLET_A],
            },
        },
    });
    assert.equal(res.isError, true);
    // zod .strict() emits "Unrecognized key(s) in object: 'searchId'"
    assert.match(res.content[0].text, /searchId|[Uu]nrecognized/);
});

// Defense-in-depth: the schema itself MUST reject searchId at parse time.
test("CreateDashboardSchema parse-level rejects searchId via .strict() (D-02 contract assertion)", () => {
    assert.throws(
        () => CreateDashboardSchema.parse({
            title: "x",
            searchId: "any-value",
            widgets: [WIDGET_TRIPLET_A],
        }),
        (err) => err?.name === "ZodError"
            && err.issues.some((iss) => /[Uu]nrecognized/.test(iss.message) || iss.path.includes("searchId")),
    );
});

// =====================================================================
// Test 6 — D-03 widget-position integrity violation refused BEFORE HTTP
// =====================================================================

test("create_dashboard D-03 widget-position integrity violation refused BEFORE any HTTP fires", async () => {
    let httpCalls = 0;
    _setCaptureRequest(() => {
        httpCalls++;
        return { total: 0, views: [] };
    });
    // Inject a validator stub that ALWAYS throws to simulate the D-03 refusal
    // path. The structural guarantee (build() synthesizes widgetPositions from
    // widget IDs so the inputs are internally consistent) makes a real
    // mismatch unreachable from the agent surface — this seam is the only
    // way to pin the refusal-before-HTTP contract. Threat-model T-06-02-03.
    _setWidgetPositionValidatorForTests(() => {
        const err = new Error("Widget/position integrity violation: simulated");
        err.reason = "widget_position_integrity_violation";
        err.isClientSide = true;
        throw err;
    });
    const res = await handleCreateDashboard({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "Test Dashboard",
                widgets: [WIDGET_TRIPLET_A],
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /widget_position_integrity_violation|integrity/i);
    // NO HTTP must have fired — the validator is positioned BEFORE the
    // FOUND-11 existingMatches probe in build() (D-03 ACCEPTANCE GATE).
    assert.equal(httpCalls, 0, "D-03 must refuse BEFORE any HTTP fires (existingMatches probe gated behind integrity check)");
});

// Defense-in-depth: pin that the integrity validator IS called (not just
// imported) by giving it a side effect we can detect. Without this check
// a future refactor could accidentally skip the validator and the
// structural guarantee would silently disappear.
test("create_dashboard build() calls the widget-position integrity validator (D-03 path is wired)", async () => {
    let validatorCalled = false;
    _setWidgetPositionValidatorForTests((widgets, positions) => {
        validatorCalled = true;
        assert.ok(Array.isArray(widgets));
        assert.equal(typeof positions, "object");
        // No throw — let the happy path proceed.
    });
    _setCaptureRequest(dashboardsMultiCapture([
        { method: "GET", pathPattern: /^\/api\/views\?query=/, response: { total: 0, views: [] } },
    ]));
    await handleCreateDashboard({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "Test Dashboard",
                widgets: [WIDGET_TRIPLET_A],
            },
        },
    });
    assert.equal(validatorCalled, true, "validateWidgetPositionIntegrity MUST be called from build()");
});

// =====================================================================
// Test 7 — wrapper-generated UUID widget IDs (UUID-per-instance)
// =====================================================================

test("create_dashboard widget.id is wrapper-generated UUID when agent omits it", async () => {
    _setCaptureRequest(dashboardsMultiCapture([
        { method: "GET", pathPattern: /^\/api\/views\?query=/, response: { total: 0, views: [] } },
    ]));
    _setUUIDGeneratorForTests(makeSeededUUIDGenerator(1));
    const res = await handleCreateDashboard({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "Test Dashboard",
                widgets: [{
                    widget: { type: "messages" },  // NO id
                    position: { col: 1, row: 1, height: 2, width: 4 },
                    searchType: { type: "messages" },  // NO id either
                }],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    const widgetId = payload.chain[1].request.body.entity.state["q-1"].widgets[0].id;
    assert.match(
        widgetId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        `widget.id should be UUID-shaped; got ${widgetId}`,
    );
    // Position key matches the wrapper-generated widget id (D-03 integrity
    // self-check).
    const positions = payload.chain[1].request.body.entity.state["q-1"].positions;
    assert.ok(positions[widgetId], "position key MUST match wrapper-generated widget.id");
});

// =====================================================================
// Test 8 — FOUND-11 existingMatches surfaces title-collision
// =====================================================================

test("create_dashboard surfaces title-collision via FOUND-11 existingMatches probe", async () => {
    _setCaptureRequest(dashboardsMultiCapture([
        {
            method: "GET",
            pathPattern: /^\/api\/views\?query=/,
            response: {
                total: 1,
                views: [{ id: "v-existing", title: "My Dashboard", type: "DASHBOARD" }],
            },
        },
    ]));
    const res = await handleCreateDashboard({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "My Dashboard",
                widgets: [WIDGET_TRIPLET_A],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.existingMatches.length, 1);
    assert.equal(payload.existingMatches[0].id, "v-existing");
    assert.equal(payload.existingMatches[0].similarity_reason, "exact");
});

test("create_dashboard existingMatches DROPS saved-search title hits (DASHBOARD-only matchFn)", async () => {
    _setCaptureRequest(dashboardsMultiCapture([
        {
            method: "GET",
            pathPattern: /^\/api\/views\?query=/,
            response: {
                total: 2,
                views: [
                    { id: "v-saved", title: "My Dashboard", type: "SEARCH" },  // saved search — must NOT match
                    { id: "v-dash", title: "My Dashboard", type: "DASHBOARD" },  // dashboard — must match
                ],
            },
        },
    ]));
    const res = await handleCreateDashboard({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "My Dashboard",
                widgets: [WIDGET_TRIPLET_A],
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // Only the DASHBOARD-typed match surfaces; saved-search filtered out.
    assert.equal(payload.existingMatches.length, 1);
    assert.equal(payload.existingMatches[0].id, "v-dash");
});

// =====================================================================
// Test 9 — apply walks chain via executeChain
// =====================================================================

test("create_dashboard apply walks the 2-step chain via executeChain in sequence", async () => {
    const captured = [];
    _setCaptureRequest(dashboardsMultiCapture([
        // build() pre-flight GET for existingMatches
        { method: "GET", pathPattern: /^\/api\/views\?query=/, response: { total: 0, views: [] } },
        // step 1: create Search
        {
            method: "POST",
            pathPattern: "/api/views/search",
            response: (req) => {
                captured.push({ step: 1, method: req.method, path: req.path, body: req.body });
                return { id: "S-real-1", queries: req.body.queries };
            },
        },
        // step 2: create View
        {
            method: "POST",
            pathPattern: "/api/views",
            response: (req) => {
                captured.push({ step: 2, method: req.method, path: req.path, body: req.body });
                return { id: "V-real-1", type: "DASHBOARD", title: req.body.entity.title };
            },
        },
    ]));
    const res = await handleCreateDashboard({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "Real Dashboard",
                widgets: [WIDGET_TRIPLET_A],
                dryRun: false,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    assert.equal(payload.result.id, "V-real-1");
    // Chain walked in order — step 1 first, then step 2.
    assert.equal(captured.length, 2);
    assert.equal(captured[0].step, 1);
    assert.equal(captured[0].path, "/api/views/search");
    assert.equal(captured[1].step, 2);
    assert.equal(captured[1].path, "/api/views");
});

// =====================================================================
// Test 10 — apply substitutes step1.response.id into step2.body.entity.search_id
// =====================================================================

test("create_dashboard apply substitutes step1.response.id into step2 body.entity.search_id (C7 wiring)", async () => {
    let step2Body = null;
    _setCaptureRequest(dashboardsMultiCapture([
        { method: "GET", pathPattern: /^\/api\/views\?query=/, response: { total: 0, views: [] } },
        {
            method: "POST",
            pathPattern: "/api/views/search",
            response: () => ({ id: "S-substituted-id" }),
        },
        {
            method: "POST",
            pathPattern: "/api/views",
            response: (req) => {
                step2Body = req.body;
                return { id: "V-1", type: "DASHBOARD" };
            },
        },
    ]));
    const res = await handleCreateDashboard({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "Real Dashboard",
                widgets: [WIDGET_TRIPLET_A],
                dryRun: false,
            },
        },
    });
    assert.equal(JSON.parse(res.content[0].text).applied, true);
    assert.ok(step2Body, "step 2 must have fired");
    // The placeholder __SERVER_ASSIGNED__step1 must have been substituted
    // with the REAL Search ID from step 1's response.
    assert.equal(step2Body.entity.search_id, "S-substituted-id");
    assert.notEqual(step2Body.entity.search_id, "__SERVER_ASSIGNED__step1");
});

// =====================================================================
// DASH-04 update_dashboard — STRICT_NO_ECHO + D-02 searchId-immutability
// =====================================================================

const CURRENT_VIEW_FOR_UPDATE = {
    id: "v-1",
    type: "DASHBOARD",
    title: "Original Title",
    summary: "Original summary",
    description: "Original description",
    search_id: "S-bound-1",
    properties: [],
    requires: {},
    favorite: false,
    state: {
        "q-1": {
            widgets: [{ id: "w-1", type: "messages" }],
            widget_mapping: { "w-1": ["st-1"] },
            positions: { "w-1": { col: 1, row: 1, height: 2, width: 4 } },
            titles: { titles: {} },
            display_mode_settings: { positions_inferred: false, show_summary: false, show_message_row: false },
        },
    },
};

// Test 11 — STRICT_NO_ECHO overlay via GET pre-flight
test("update_dashboard dry-run overlays changes onto GET-current ViewDTO (STRICT_NO_ECHO partial-update)", async () => {
    _setCaptureRequest(dashboardsMultiCapture([
        { method: "GET", pathPattern: "/api/views/v-1", response: CURRENT_VIEW_FOR_UPDATE },
    ]));
    const res = await handleUpdateDashboard({
        params: {
            arguments: {
                _testConnection: "fake",
                dashboardId: "v-1",
                changes: { title: "New Title" },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.preview.method, "PUT");
    assert.equal(payload.preview.path, "/api/views/v-1");
    // Touched field updated.
    assert.equal(payload.preview.body.entity.title, "New Title");
    // Untouched immutable fields pass through from GET response unchanged.
    assert.equal(payload.preview.body.entity.search_id, "S-bound-1");
    assert.equal(payload.preview.body.entity.type, "DASHBOARD");
    assert.equal(payload.preview.body.entity.summary, "Original summary");
    assert.equal(payload.preview.body.entity.description, "Original description");
    // State passes through unchanged — composition edits flow through DASH-06/07.
    assert.deepEqual(payload.preview.body.entity.state, CURRENT_VIEW_FOR_UPDATE.state);
    // Pitfall 8: body.id MUST match URL segment.
    assert.equal(payload.preview.body.entity.id, "v-1");
    // CreateEntityRequest envelope shape.
    assert.equal(payload.preview.body.share_request, null);
});

// Test 12 — D-02 STRUCTURAL reject of searchId in changes
test("update_dashboard schema REJECTS searchId in changes (D-02 structural .strict() reject)", async () => {
    const res = await handleUpdateDashboard({
        params: {
            arguments: {
                _testConnection: "fake",
                dashboardId: "v-1",
                changes: { searchId: "hijack-me" },
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /searchId|[Uu]nrecognized/);
});

test("UpdateDashboardSchema.changes parse-level rejects searchId via .strict() (D-02 contract assertion)", () => {
    assert.throws(
        () => UpdateDashboardSchema.parse({
            dashboardId: "v-1",
            changes: { searchId: "any" },
        }),
        (err) => err?.name === "ZodError",
    );
});

// Test 13 — empty changes refusal
test("update_dashboard schema REJECTS empty changes object (must contain at least one field)", async () => {
    const res = await handleUpdateDashboard({
        params: {
            arguments: {
                _testConnection: "fake",
                dashboardId: "v-1",
                changes: {},
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /at least one field/i);
});

test("update_dashboard apply path PUTs merged DTO with CreateEntityRequest envelope", async () => {
    const captured = [];
    _setCaptureRequest(dashboardsMultiCapture([
        { method: "GET", pathPattern: "/api/views/v-1", response: CURRENT_VIEW_FOR_UPDATE },
        {
            method: "PUT",
            pathPattern: "/api/views/v-1",
            response: (req) => {
                captured.push(req);
                return { ...CURRENT_VIEW_FOR_UPDATE, title: req.body.entity.title };
            },
        },
    ]));
    const res = await handleUpdateDashboard({
        params: {
            arguments: {
                _testConnection: "fake",
                dashboardId: "v-1",
                changes: { description: "Updated desc" },
                dryRun: false,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].body.entity.description, "Updated desc");
    assert.equal(captured[0].body.entity.search_id, "S-bound-1");  // unchanged
    assert.equal(captured[0].body.share_request, null);
});

// =====================================================================
// DASH-05 delete_dashboard — leaf delete with informational cascade
// =====================================================================

const VIEW_WITH_MULTIPLE_WIDGETS = {
    id: "v-multi",
    type: "DASHBOARD",
    search_id: "S-multi",
    state: {
        "q-1": {
            widgets: [
                { id: "w-1", type: "messages" },
                { id: "w-2", type: "aggregation" },
                { id: "w-3", type: "value" },
            ],
        },
        "q-2": {
            widgets: [
                { id: "w-4", type: "messages" },
            ],
        },
    },
};

test("delete_dashboard dry-run surfaces informational cascades.widgets.count across all states", async () => {
    _setCaptureRequest(dashboardsMultiCapture([
        { method: "GET", pathPattern: "/api/views/v-multi", response: VIEW_WITH_MULTIPLE_WIDGETS },
    ]));
    const res = await handleDeleteDashboard({
        params: { arguments: { _testConnection: "fake", dashboardId: "v-multi" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.preview.method, "DELETE");
    assert.equal(payload.preview.path, "/api/views/v-multi");
    // 3 widgets in q-1 + 1 widget in q-2 = 4 total.
    assert.equal(payload.cascades.widgets.count, 4);
});

test("delete_dashboard has NO confirmationToken in dry-run (leaf delete; no drift refusal)", async () => {
    _setCaptureRequest(dashboardsMultiCapture([
        { method: "GET", pathPattern: "/api/views/v-1", response: CURRENT_VIEW_FOR_UPDATE },
    ]));
    const res = await handleDeleteDashboard({
        params: { arguments: { _testConnection: "fake", dashboardId: "v-1" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.confirmationToken, undefined);
});

test("delete_dashboard apply issues DELETE /api/views/{id} and returns deleted:true body", async () => {
    const captured = [];
    _setCaptureRequest(dashboardsMultiCapture([
        { method: "GET", pathPattern: "/api/views/v-1", response: CURRENT_VIEW_FOR_UPDATE },
        {
            method: "DELETE",
            pathPattern: "/api/views/v-1",
            response: (req) => {
                captured.push(req);
                return null;  // Graylog DELETE returns 204 no-content.
            },
        },
    ]));
    const res = await handleDeleteDashboard({
        params: {
            arguments: {
                _testConnection: "fake",
                dashboardId: "v-1",
                dryRun: false,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    assert.equal(payload.result.id, "v-1");
    assert.equal(payload.result.body.deleted, true);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].method, "DELETE");
});

test("delete_dashboard cascade pre-flight 404 falls through to widgetCount:0 (best-effort)", async () => {
    _setCaptureRequest(dashboardsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/views/missing",
            response: () => {
                throw new GraylogNotFoundError("not found", {
                    status: 404, method: "GET", path: "/api/views/missing", body: null,
                });
            },
        },
    ]));
    const res = await handleDeleteDashboard({
        params: { arguments: { _testConnection: "fake", dashboardId: "missing" } },
    });
    // Dry-run STILL renders even when pre-flight fails — the DELETE itself
    // surfaces the real error on apply via wrapGraylogError.
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.cascades.widgets.count, 0);
});

// =====================================================================
// Schema parity checks
// =====================================================================

test("UpdateDashboardSchema rejects missing dashboardId at parse", () => {
    assert.throws(
        () => UpdateDashboardSchema.parse({ changes: { title: "new" } }),
        (err) => err?.name === "ZodError",
    );
});

test("DeleteDashboardSchema rejects missing dashboardId at parse", () => {
    assert.throws(
        () => DeleteDashboardSchema.parse({}),
        (err) => err?.name === "ZodError",
    );
});

// =====================================================================
// DASH-07 remove_widget — symmetric Search+View 2-step PUT chain
// =====================================================================
//
// remove_widget orchestrates the symmetric two-step PUT chain that
// removes a widget from BOTH the bound Search entity (strip its
// search_types) AND the ViewDTO (strip widget + position +
// widget_mapping entry). D-03 validator runs on the PROSPECTIVE
// post-remove sets before wire emission.

const VIEW_FOR_REMOVE = {
    id: "v-1",
    type: "DASHBOARD",
    title: "Mixed Dashboard",
    search_id: "S-bound",
    properties: [],
    requires: {},
    favorite: false,
    state: {
        "q-1": {
            selected_fields: null,
            static_message_list_id: null,
            titles: { titles: {} },
            widgets: [
                { id: "w-keep", type: "messages" },
                { id: "w-remove", type: "aggregation" },
            ],
            widget_mapping: {
                "w-keep": ["st-keep-1"],
                "w-remove": ["st-remove-1", "st-remove-2"],
            },
            positions: {
                "w-keep": { col: 1, row: 1, height: 2, width: 4 },
                "w-remove": { col: 5, row: 1, height: 2, width: 4 },
            },
            formatting: null,
            display_mode_settings: { positions_inferred: false, show_summary: false, show_message_row: false },
        },
    },
};

const SEARCH_FOR_REMOVE = {
    id: "S-bound",
    queries: [{
        id: "q-1",
        timerange: { type: "relative", from: 300 },
        filter: null,
        filters: [],
        query: { type: "elasticsearch", query_string: "" },
        search_types: [
            { id: "st-keep-1", type: "messages" },
            { id: "st-remove-1", type: "pivot" },
            { id: "st-remove-2", type: "pivot" },
        ],
    }],
    parameters: [],
    skipNoStreamsCheck: false,
};

function removeWidgetCapture(searchOverride, viewOverride) {
    return dashboardsMultiCapture([
        { method: "GET", pathPattern: "/api/views/v-1", response: viewOverride ?? VIEW_FOR_REMOVE },
        { method: "GET", pathPattern: "/api/views/search/S-bound", response: searchOverride ?? SEARCH_FOR_REMOVE },
    ]);
}

// Test 19 — pre-flight GETs on view AND search (call order matters)
test("remove_widget pre-flights GET on view AND search (Search+View symmetric)", async () => {
    const order = [];
    _setCaptureRequest((req) => {
        order.push(`${req.method} ${req.path}`);
        if (req.path === "/api/views/v-1") return VIEW_FOR_REMOVE;
        if (req.path === "/api/views/search/S-bound") return SEARCH_FOR_REMOVE;
        throw new Error(`unexpected route ${req.method} ${req.path}`);
    });
    await handleRemoveWidget({
        params: { arguments: { _testConnection: "fake", dashboardId: "v-1", widgetId: "w-remove" } },
    });
    // Two GETs in order: view first (we don't know searchId until we GET the view),
    // then search.
    assert.equal(order[0], "GET /api/views/v-1");
    assert.equal(order[1], "GET /api/views/search/S-bound");
});

// Test 20 — dry-run emits 2-step chain
test("remove_widget dry-run emits 2-step chain (PUT /api/views/search/{searchId} + PUT /api/views/{id})", async () => {
    _setCaptureRequest(removeWidgetCapture());
    const res = await handleRemoveWidget({
        params: { arguments: { _testConnection: "fake", dashboardId: "v-1", widgetId: "w-remove" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.ok(Array.isArray(payload.chain), "chain must be present in dry-run");
    assert.equal(payload.chain.length, 2);
    assert.equal(payload.chain[0].step, 1);
    assert.equal(payload.chain[0].request.method, "PUT");
    assert.equal(payload.chain[0].request.path, "/api/views/search/S-bound");
    assert.equal(payload.chain[1].step, 2);
    assert.equal(payload.chain[1].request.method, "PUT");
    assert.equal(payload.chain[1].request.path, "/api/views/v-1");
});

// Test 21 — step 1 strips widget's search_types from Search
test("remove_widget step 1 strips widget's search_types (drawn from widget_mapping) from Search.queries[].search_types", async () => {
    _setCaptureRequest(removeWidgetCapture());
    const res = await handleRemoveWidget({
        params: { arguments: { _testConnection: "fake", dashboardId: "v-1", widgetId: "w-remove" } },
    });
    const payload = JSON.parse(res.content[0].text);
    const step1Body = payload.chain[0].request.body;
    // st-remove-1 + st-remove-2 stripped; st-keep-1 preserved.
    const stIds = step1Body.queries[0].search_types.map((st) => st.id);
    assert.deepEqual(stIds, ["st-keep-1"]);
});

// Test 22 — step 2 strips widget + position + widget_mapping entry
test("remove_widget step 2 strips widget + position + widget_mapping entry from ViewDTO state", async () => {
    _setCaptureRequest(removeWidgetCapture());
    const res = await handleRemoveWidget({
        params: { arguments: { _testConnection: "fake", dashboardId: "v-1", widgetId: "w-remove" } },
    });
    const payload = JSON.parse(res.content[0].text);
    const step2Body = payload.chain[1].request.body;
    assert.equal(step2Body.entity.id, "v-1");
    assert.equal(step2Body.share_request, null);
    const state = step2Body.entity.state["q-1"];
    // Widget gone.
    const widgetIds = state.widgets.map((w) => w.id);
    assert.deepEqual(widgetIds, ["w-keep"]);
    // Position entry gone.
    assert.equal(state.positions["w-remove"], undefined);
    assert.ok(state.positions["w-keep"], "w-keep position must remain");
    // widget_mapping entry gone.
    assert.equal(state.widget_mapping["w-remove"], undefined);
    assert.deepEqual(state.widget_mapping["w-keep"], ["st-keep-1"]);
});

// Test 23 — D-03 validator runs on post-remove sets (refusal before HTTP wire emission)
test("remove_widget D-03 validator runs on prospective post-remove sets; refuses BEFORE any PUT fires", async () => {
    let putFired = false;
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/views/v-1") return VIEW_FOR_REMOVE;
        if (req.method === "GET" && req.path === "/api/views/search/S-bound") return SEARCH_FOR_REMOVE;
        if (req.method === "PUT") putFired = true;
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    // Inject a stub that throws — simulates a corruption that would leave
    // an orphan position after removal.
    _setRemoveWidgetValidatorForTests(() => {
        // Match the production validator's message style ("integrity violation"
        // substring is the load-bearing word the test asserts against).
        const err = new Error("Widget/position integrity violation: simulated orphan in post-remove set");
        err.reason = "widget_position_integrity_violation";
        err.isClientSide = true;
        throw err;
    });
    const res = await handleRemoveWidget({
        params: {
            arguments: {
                _testConnection: "fake",
                dashboardId: "v-1",
                widgetId: "w-remove",
                dryRun: false,
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /widget_position_integrity_violation|integrity/i);
    assert.equal(putFired, false, "D-03 refusal must happen BEFORE any PUT");
});

// Test 24 — widget_not_found refusal
test("remove_widget refuses with widget_not_found when widgetId absent from current ViewDTO", async () => {
    let putFired = false;
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/views/v-1") return VIEW_FOR_REMOVE;
        if (req.method === "GET" && req.path === "/api/views/search/S-bound") return SEARCH_FOR_REMOVE;
        if (req.method === "PUT") putFired = true;
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleRemoveWidget({
        params: {
            arguments: {
                _testConnection: "fake",
                dashboardId: "v-1",
                widgetId: "w-nonexistent",
                dryRun: false,
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /widget_not_found/);
    assert.equal(putFired, false, "widget_not_found refusal must happen BEFORE any PUT");
});

// Test 25 — apply walks the chain through executeChain in order
test("remove_widget apply walks the 2-step PUT chain in order via executeChain", async () => {
    const putOrder = [];
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/views/v-1") return VIEW_FOR_REMOVE;
        if (req.method === "GET" && req.path === "/api/views/search/S-bound") return SEARCH_FOR_REMOVE;
        if (req.method === "PUT" && req.path === "/api/views/search/S-bound") {
            putOrder.push("PUT-search");
            return { id: "S-bound", queries: req.body.queries };
        }
        if (req.method === "PUT" && req.path === "/api/views/v-1") {
            putOrder.push("PUT-view");
            return { ...req.body.entity };
        }
        throw new Error(`unexpected ${req.method} ${req.path}`);
    });
    const res = await handleRemoveWidget({
        params: {
            arguments: {
                _testConnection: "fake",
                dashboardId: "v-1",
                widgetId: "w-remove",
                dryRun: false,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    // Search MUST be updated FIRST so the View's widget_mapping never points
    // at an existing search_type that we're about to remove. Order is
    // load-bearing for partial-failure semantics.
    assert.deepEqual(putOrder, ["PUT-search", "PUT-view"]);
});

// Schema parity
test("RemoveWidgetSchema requires both dashboardId AND widgetId", () => {
    assert.throws(
        () => RemoveWidgetSchema.parse({ dashboardId: "v-1" }),
        (err) => err?.name === "ZodError",
    );
    assert.throws(
        () => RemoveWidgetSchema.parse({ widgetId: "w-1" }),
        (err) => err?.name === "ZodError",
    );
});

// =====================================================================
// DASH-06 add_widget_from_template — Plan 06-03 Task 2
// =====================================================================
//
// add_widget_from_template consumes the WIDGET_TEMPLATES registry (Plan 03
// Task 1) to drop a widget triplet onto an existing dashboard. Symmetric to
// remove_widget — orchestrates a Search+View 2-step PUT chain (or 1-step for
// the text-widget placeholder where searchType:null).
//
// Key contracts pinned below:
//   - M7 ACCEPTANCE GATE: z.enum(TEMPLATE_NAMES) rejects invalid names at
//     parse BEFORE any HTTP fires (Test 1).
//   - Pre-flight GETs view + search in load-bearing order (Test 3).
//   - 2-step chain for SearchType-bearing templates (Test 4); 1-step for
//     text-widget placeholder (Test 5).
//   - D-03 validator runs on the prospective post-add sets BEFORE wire
//     emission (Test 8).
//   - widget_mapping[newWidget.id] = [newSearchType.id] (or empty array for
//     text-widget; Test 7).

// Fixture: existing single-widget dashboard for add tests.
const VIEW_FOR_ADD = {
    id: "v-add",
    type: "DASHBOARD",
    title: "Dashboard For Adding",
    search_id: "S-add",
    properties: [],
    requires: {},
    favorite: false,
    state: {
        "q-1": {
            selected_fields: null,
            static_message_list_id: null,
            titles: { titles: {} },
            widgets: [
                { id: "w-existing", type: "messages" },
            ],
            widget_mapping: {
                "w-existing": ["st-existing-1"],
            },
            positions: {
                "w-existing": { col: 1, row: 1, height: 2, width: 4 },
            },
            formatting: null,
            display_mode_settings: {
                positions_inferred: false,
                show_summary: false,
                show_message_row: false,
            },
        },
    },
};

const SEARCH_FOR_ADD = {
    id: "S-add",
    queries: [{
        id: "q-1",
        timerange: { type: "relative", from: 300 },
        filter: null,
        filters: [],
        query: { type: "elasticsearch", query_string: "" },
        search_types: [
            { id: "st-existing-1", type: "messages" },
            { id: "st-extra-pre", type: "pivot" },  // 2 pre-existing — test 6 asserts append → 3
        ],
    }],
    parameters: [],
    skipNoStreamsCheck: false,
};

function addWidgetCapture(viewOverride, searchOverride) {
    return dashboardsMultiCapture([
        { method: "GET", pathPattern: "/api/views/v-add", response: viewOverride ?? VIEW_FOR_ADD },
        { method: "GET", pathPattern: "/api/views/search/S-add", response: searchOverride ?? SEARCH_FOR_ADD },
    ]);
}

// Test 1 — M7 ACCEPTANCE GATE: zod rejects invalid templateName
test("add_widget_from_template ZOD REJECTS invalid templateName at parse (M7 ACCEPTANCE GATE)", async () => {
    let httpFired = false;
    _setCaptureRequest(() => {
        httpFired = true;
        return {};
    });
    const res = await handleAddWidgetFromTemplate({
        params: {
            arguments: {
                _testConnection: "fake",
                dashboardId: "v-add",
                templateName: "bogus_template",
            },
        },
    });
    assert.equal(res.isError, true);
    // Zod's enum error includes "Invalid enum value" or lists allowed values.
    assert.match(res.content[0].text, /templateName|enum|invalid/i);
    assert.equal(httpFired, false, "M7: NO HTTP fires when zod rejects invalid templateName");
});

// Schema parity — defense in depth at the schema layer.
test("AddWidgetFromTemplateSchema parse-level rejects names outside the closed set (M7 contract)", () => {
    assert.throws(
        () => AddWidgetFromTemplateSchema.parse({
            dashboardId: "v-1",
            templateName: "not_a_template",
        }),
        (err) => err?.name === "ZodError",
    );
});

// Test 2 — every name in TEMPLATE_NAMES is accepted at schema parse
test("AddWidgetFromTemplateSchema accepts every name in the closed TEMPLATE_NAMES set", () => {
    for (const name of TEMPLATE_NAMES) {
        const parsed = AddWidgetFromTemplateSchema.parse({
            dashboardId: "v-1",
            templateName: name,
        });
        assert.equal(parsed.templateName, name);
    }
});

// Test 3 — pre-flight GETs view AND search in load-bearing order
test("add_widget_from_template pre-flights GET on view AND search (Search+View symmetric)", async () => {
    const order = [];
    _setCaptureRequest((req) => {
        order.push(`${req.method} ${req.path}`);
        if (req.path === "/api/views/v-add") return VIEW_FOR_ADD;
        if (req.path === "/api/views/search/S-add") return SEARCH_FOR_ADD;
        throw new Error(`unexpected ${req.method} ${req.path}`);
    });
    await handleAddWidgetFromTemplate({
        params: {
            arguments: {
                _testConnection: "fake",
                dashboardId: "v-add",
                templateName: "error_rate_over_time",
            },
        },
    });
    // View first (we don't know searchId until we GET the view), then Search.
    assert.equal(order[0], "GET /api/views/v-add");
    assert.equal(order[1], "GET /api/views/search/S-add");
});

// Test 4 — dry-run for aggregation template emits 2-step chain
test("add_widget_from_template dry-run for aggregation template emits 2-step chain (PUT search + PUT view)", async () => {
    _setCaptureRequest(addWidgetCapture());
    const res = await handleAddWidgetFromTemplate({
        params: {
            arguments: {
                _testConnection: "fake",
                dashboardId: "v-add",
                templateName: "error_rate_over_time",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.ok(Array.isArray(payload.chain), "chain must be present in dry-run");
    assert.equal(payload.chain.length, 2);
    assert.equal(payload.chain[0].request.method, "PUT");
    assert.equal(payload.chain[0].request.path, "/api/views/search/S-add");
    assert.equal(payload.chain[1].request.method, "PUT");
    assert.equal(payload.chain[1].request.path, "/api/views/v-add");
});

// Test 5 — top_error_clusters (text-widget placeholder) emits 1-step chain
test("add_widget_from_template dry-run for top_error_clusters emits 1-step chain (searchType:null skips Search PUT)", async () => {
    _setCaptureRequest(addWidgetCapture());
    const res = await handleAddWidgetFromTemplate({
        params: {
            arguments: {
                _testConnection: "fake",
                dashboardId: "v-add",
                templateName: "top_error_clusters",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.chain.length, 1, "text-widget placeholder MUST skip the Search PUT");
    assert.equal(payload.chain[0].request.method, "PUT");
    assert.equal(payload.chain[0].request.path, "/api/views/v-add");
});

// Test 6 — step 1 appends new searchType to existing Search.queries[0].search_types
test("add_widget_from_template step 1 appends new searchType to existing Search.queries[0].search_types", async () => {
    _setCaptureRequest(addWidgetCapture());
    const res = await handleAddWidgetFromTemplate({
        params: {
            arguments: {
                _testConnection: "fake",
                dashboardId: "v-add",
                templateName: "error_rate_over_time",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    const step1Body = payload.chain[0].request.body;
    // Original Search had 2 search_types — append → 3.
    assert.equal(step1Body.queries[0].search_types.length, 3);
    const stIds = step1Body.queries[0].search_types.map((st) => st.id);
    // Pre-existing preserved at the front.
    assert.equal(stIds[0], "st-existing-1");
    assert.equal(stIds[1], "st-extra-pre");
    // Newly added searchType — UUID-shaped or wrapper-supplied.
    assert.ok(stIds[2], "new searchType id must be present");
});

// Test 7 — step 2 appends new widget + position + widget_mapping entry
test("add_widget_from_template step 2 appends new widget + position + widget_mapping entry", async () => {
    _setCaptureRequest(addWidgetCapture());
    const res = await handleAddWidgetFromTemplate({
        params: {
            arguments: {
                _testConnection: "fake",
                dashboardId: "v-add",
                templateName: "error_rate_over_time",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    const step2Body = payload.chain[1].request.body;
    assert.equal(step2Body.entity.id, "v-add");
    assert.equal(step2Body.share_request, null);
    const state = step2Body.entity.state["q-1"];
    // 1 existing + 1 new = 2 widgets.
    assert.equal(state.widgets.length, 2);
    const newWidget = state.widgets[1];
    // Position keyed by new widget id.
    assert.ok(state.positions[newWidget.id], "position must be keyed by new widget id");
    // widget_mapping[newWidgetId] = [newSearchTypeId]
    assert.ok(Array.isArray(state.widget_mapping[newWidget.id]));
    assert.equal(state.widget_mapping[newWidget.id].length, 1, "aggregation template maps to 1 SearchType");
});

// Test 7b — text-widget placeholder maps to EMPTY widget_mapping entry
test("add_widget_from_template text-widget placeholder maps to empty widget_mapping entry (searchType:null)", async () => {
    _setCaptureRequest(addWidgetCapture());
    const res = await handleAddWidgetFromTemplate({
        params: {
            arguments: {
                _testConnection: "fake",
                dashboardId: "v-add",
                templateName: "top_error_clusters",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // Only step 1 exists for text-widget — but it's the View update.
    const step1Body = payload.chain[0].request.body;
    const state = step1Body.entity.state["q-1"];
    const newWidget = state.widgets[state.widgets.length - 1];
    assert.equal(newWidget.type, "text");
    // widget_mapping entry exists but is an empty array.
    assert.deepEqual(state.widget_mapping[newWidget.id], []);
});

// Test 8 — D-03 validator runs on prospective post-add sets BEFORE wire emission
test("add_widget_from_template D-03 validator runs on prospective post-add sets; refuses BEFORE any PUT", async () => {
    let putFired = false;
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/views/v-add") return VIEW_FOR_ADD;
        if (req.method === "GET" && req.path === "/api/views/search/S-add") return SEARCH_FOR_ADD;
        if (req.method === "PUT") putFired = true;
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    _setAddWidgetValidatorForTests(() => {
        const err = new Error("Widget/position integrity violation: simulated orphan");
        err.reason = "widget_position_integrity_violation";
        err.isClientSide = true;
        throw err;
    });
    const res = await handleAddWidgetFromTemplate({
        params: {
            arguments: {
                _testConnection: "fake",
                dashboardId: "v-add",
                templateName: "error_rate_over_time",
                dryRun: false,
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /widget_position_integrity_violation|integrity/i);
    assert.equal(putFired, false, "D-03 refusal must happen BEFORE any PUT");
});

// Test 9 — apply walks the chain via executeChain in order
test("add_widget_from_template apply walks the 2-step PUT chain in order (Search first, then View)", async () => {
    const putOrder = [];
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/views/v-add") return VIEW_FOR_ADD;
        if (req.method === "GET" && req.path === "/api/views/search/S-add") return SEARCH_FOR_ADD;
        if (req.method === "PUT" && req.path === "/api/views/search/S-add") {
            putOrder.push("PUT-search");
            return { id: "S-add", queries: req.body.queries };
        }
        if (req.method === "PUT" && req.path === "/api/views/v-add") {
            putOrder.push("PUT-view");
            return { ...req.body.entity };
        }
        throw new Error(`unexpected ${req.method} ${req.path}`);
    });
    const res = await handleAddWidgetFromTemplate({
        params: {
            arguments: {
                _testConnection: "fake",
                dashboardId: "v-add",
                templateName: "error_rate_over_time",
                dryRun: false,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    // Search update fires FIRST so the View never references a SearchType
    // that doesn't exist yet (symmetric inverse of remove_widget's ordering).
    assert.deepEqual(putOrder, ["PUT-search", "PUT-view"]);
});

// Test 10 — empty-state dashboard refusal
test("add_widget_from_template refuses with dashboard_empty_state when view.state is empty", async () => {
    let putFired = false;
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/views/v-empty") {
            return { ...VIEW_FOR_ADD, id: "v-empty", state: {} };
        }
        if (req.method === "GET" && req.path === "/api/views/search/S-add") return SEARCH_FOR_ADD;
        if (req.method === "PUT") putFired = true;
        throw new Error(`unexpected ${req.method} ${req.path}`);
    });
    const res = await handleAddWidgetFromTemplate({
        params: {
            arguments: {
                _testConnection: "fake",
                dashboardId: "v-empty",
                templateName: "error_rate_over_time",
                dryRun: false,
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /dashboard_empty_state|no state/i);
    assert.equal(putFired, false);
});

// Test 11 — field_value_distribution builder error surfaces as MCP isError
test("add_widget_from_template surfaces builder error when field_value_distribution called without field", async () => {
    let putFired = false;
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/views/v-add") return VIEW_FOR_ADD;
        if (req.method === "GET" && req.path === "/api/views/search/S-add") return SEARCH_FOR_ADD;
        if (req.method === "PUT") putFired = true;
        throw new Error(`unexpected ${req.method} ${req.path}`);
    });
    const res = await handleAddWidgetFromTemplate({
        params: {
            arguments: {
                _testConnection: "fake",
                dashboardId: "v-add",
                templateName: "field_value_distribution",
                options: {},  // <-- no `field`
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /field option required|field_value_distribution/i);
    assert.equal(putFired, false, "builder-error refusal must happen BEFORE any PUT");
});

// =====================================================================
// Final tool-count + dispatch wiring assertion (Plan 06-03 close)
// =====================================================================
//
// Plan 06-02 left 83 tools (DASH-01..05 + DASH-07). Plan 06-03 adds DASH-06
// add_widget_from_template → 84 final. The pipelines.test.js count assertion
// pins the Plan 06-02 baseline at 83; this test pins the Plan 06-03 delta.

test("assertAllToolsRegistered passes after Plan 06-03 (count = 84; +add_widget_from_template completes DASH-06)", async () => {
    const { dispatch, assertAllToolsRegistered } = await import("../src/dispatch.js");
    await import("../src/tools/_register.js");
    const { toolDefinitions } = await import("../src/tools.js");
    assertAllToolsRegistered(toolDefinitions);
    assert.equal(typeof dispatch, "function");
    assert.equal(toolDefinitions.length, 84, `Expected 84 tools after Plan 06-03 end (DASH-06 add_widget_from_template shipped); got ${toolDefinitions.length}`);
});
