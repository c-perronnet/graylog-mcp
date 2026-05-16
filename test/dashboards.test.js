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
    ListDashboardsSchema,
    GetDashboardSchema,
    CreateDashboardSchema,
    UpdateDashboardSchema,
    DeleteDashboardSchema,
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
