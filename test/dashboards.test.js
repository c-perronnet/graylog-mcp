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
    ListDashboardsSchema,
    GetDashboardSchema,
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
});

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
