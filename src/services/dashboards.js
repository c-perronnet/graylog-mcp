// Dashboards service — thin HTTP wrappers around /api/views and
// /api/views/search (D-09 / RESEARCH Pattern 4).
//
// THIN by contract: callers (Plan 02 handlers + Plan 05 blueprints) own zod
// validation. Carries TWO assembler helpers (buildSearchDTO + buildViewDTO)
// that are used by BOTH the create_dashboard handler in Plan 02 AND BLUE-01
// / BLUE-03 in Plan 05 — keeping them here ensures byte-stable wire-form
// emission across both call sites.
//
// CRITICAL wire-shape asymmetry (RESEARCH Pitfall 3 — explicit exception):
//   - POST /api/views/search   → body is the BARE SearchDTO (NOT envelope-wrapped)
//   - POST /api/views          → body is { entity: viewDTO, share_request: null }
// This is the documented Graylog 7.2 inconsistency; the service preserves it.

/**
 * POST /api/views/search — create a Search entity. BARE SearchDTO body
 * (NOT CreateEntityRequest envelope — explicit Pitfall 3 exception).
 *
 * @param {{ request: Function }} client
 * @param {object} searchDTO   SearchDTO as built by buildSearchDTO()
 * @returns {Promise<unknown>}
 */
export function createSearch(client, searchDTO) {
    return client.request("POST", "/api/views/search", searchDTO);
}

/**
 * POST /api/views — create a View (Dashboard). CreateEntityRequest envelope
 * required (standard Pitfall 3 pattern; the dashboards exception is only on
 * /api/views/search).
 *
 * @param {{ request: Function }} client
 * @param {object} viewDTO   ViewDTO as built by buildViewDTO()
 * @returns {Promise<unknown>}
 */
export function createDashboard(client, viewDTO) {
    return client.request("POST", "/api/views", {
        entity: viewDTO,
        share_request: null,
    });
}

/**
 * PUT /api/views/search/{searchId} — update the Search entity bound to a
 * dashboard. BARE SearchDTO body (mirrors createSearch).
 *
 * @param {{ request: Function }} client
 * @param {string} searchId
 * @param {object} searchDTO
 * @returns {Promise<unknown>}
 */
export function updateSearch(client, searchId, searchDTO) {
    return client.request("PUT", `/api/views/search/${searchId}`, searchDTO);
}

/**
 * PUT /api/views/{dashboardId} — update a Dashboard. CreateEntityRequest
 * envelope (mirrors createDashboard).
 *
 * @param {{ request: Function }} client
 * @param {string} dashboardId
 * @param {object} viewDTO
 * @returns {Promise<unknown>}
 */
export function updateDashboard(client, dashboardId, viewDTO) {
    return client.request("PUT", `/api/views/${dashboardId}`, {
        entity: viewDTO,
        share_request: null,
    });
}

/**
 * GET /api/views/{dashboardId} — fetch a Dashboard's full ViewDTO.
 * @param {{ request: Function }} client
 * @param {string} dashboardId
 * @returns {Promise<unknown>}
 */
export function getDashboard(client, dashboardId) {
    return client.request("GET", `/api/views/${dashboardId}`, null);
}

/**
 * GET /api/views/search/{searchId} — fetch a Search entity's SearchDTO.
 * @param {{ request: Function }} client
 * @param {string} searchId
 * @returns {Promise<unknown>}
 */
export function getSearch(client, searchId) {
    return client.request("GET", `/api/views/search/${searchId}`, null);
}

/**
 * DELETE /api/views/{dashboardId} — delete a Dashboard.
 * Caller decides whether to also delete the bound Search entity (typically
 * yes for the headline DASH-05 path; the Search becomes orphan otherwise).
 *
 * @param {{ request: Function }} client
 * @param {string} dashboardId
 * @returns {Promise<unknown>}
 */
export function deleteDashboard(client, dashboardId) {
    return client.request("DELETE", `/api/views/${dashboardId}`, null);
}

// =====================================================================
// Assembler builders — RESEARCH §"C7 Mitigation Anatomy" steps 1+2
// =====================================================================

/**
 * Build a SearchDTO for POST /api/views/search.
 *
 * Per RESEARCH §"C7 Mitigation Anatomy" step 1. Aggregates the widget
 * triplets' search_types into a single Query so the dashboard renders all
 * widgets from one shared Search entity (Graylog model — every Dashboard
 * binds to exactly one Search).
 *
 * @param {object} opts
 * @param {string} opts.queryId          stable wrapper-supplied id (e.g. "q-1")
 * @param {Array<{widget: object, position: object, searchType: object}>} opts.widgets
 *   widget triplets emitted by src/widget-templates/ builders
 * @param {object} opts.timerange        e.g. { type: "relative", from: 300 }
 * @param {string} [opts.query]          Lucene query string (dashboard-level filter)
 * @param {string[]} [opts.streamIds]    streams the search restricts to (currently unused
 *                                       by buildSearchDTO — kept in the signature for
 *                                       Plan 02 to wire when DASH-03 lands)
 * @returns {object} SearchDTO
 */
export function buildSearchDTO({ queryId, widgets, timerange, query }) {
    return {
        queries: [{
            id: queryId,
            timerange,
            filter: null,
            filters: [],
            query: { type: "elasticsearch", query_string: query ?? "" },
            search_types: widgets.map((t) => t.searchType).filter((s) => s != null),
        }],
        parameters: [],
        skipNoStreamsCheck: false,
    };
}

/**
 * Build a ViewDTO for POST /api/views.
 *
 * Per RESEARCH §"C7 Mitigation Anatomy" step 2. Emits `titles` and
 * `display_mode_settings` EXPLICITLY (06-U1-SMOKE Q2 default
 * `EMIT_BOTH_EXPLICIT` — Pitfall 6). The `searchId` is either a real
 * Search ID from step 1's response OR the sentinel
 * "__SERVER_ASSIGNED__step1" during a dry-run preview (resolved by
 * `executeChain`'s placeholder substitution at apply time).
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.description]    default ""
 * @param {string} [opts.summary]        default ""
 * @param {string} opts.searchId         real ID OR "__SERVER_ASSIGNED__step1"
 * @param {string} opts.queryId          MUST match the queryId passed to buildSearchDTO
 * @param {Array<{widget: object, position: object, searchType: object|null}>} opts.widgets
 * @returns {object} ViewDTO
 */
export function buildViewDTO({ title, description, summary, searchId, queryId, widgets }) {
    const widgetPositions = Object.fromEntries(
        widgets.map((t) => [t.widget.id, t.position]),
    );
    // Pitfall 5: widgetMapping is Map<String, Set<String>> — widget_id → searchType_id[].
    // For text-widget placeholders (Q3 TEXT_WIDGET_PLACEHOLDER — searchType: null),
    // emit an empty array so the widget renders without a data binding.
    const widgetMapping = Object.fromEntries(
        widgets.map((t) => [t.widget.id, t.searchType ? [t.searchType.id] : []]),
    );
    return {
        type: "DASHBOARD",
        title,
        summary: summary ?? "",
        description: description ?? "",
        search_id: searchId,
        properties: [],
        requires: {},
        state: {
            [queryId]: {
                selected_fields: null,
                static_message_list_id: null,
                titles: { titles: {} },
                widgets: widgets.map((t) => t.widget),
                widget_mapping: widgetMapping,
                positions: widgetPositions,
                formatting: null,
                display_mode_settings: {
                    positions_inferred: false,
                    show_summary: false,
                    show_message_row: false,
                },
            },
        },
        favorite: false,
    };
}
