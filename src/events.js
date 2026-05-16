import axios from "axios";

// Test-only HTTP seam (Phase 7 Plan 03 HARD-03 smoke). Mirrors the
// `_setHttpOverride` pattern in src/query.js. When set, every searchEvents()
// / fetchEventDefinitions() / fetchEventNotifications() call dispatches
// through the override instead of axios. Production code MUST NOT call
// _setHttpOverride — the `_` prefix marks it as test-only per CONVENTIONS.md.
//
// Callback signature: ({ method, path, body }) => Promise<responseData> | responseData
let _httpOverride = null;
export function _setHttpOverride(fn) { _httpOverride = fn; }
export function _clearHttpOverride() { _httpOverride = null; }

export async function searchEvents(baseUrl, apiToken, payload) {
    if (_httpOverride) {
        return _httpOverride({ method: "POST", path: "/api/events/search", body: payload, baseUrl, apiToken });
    }
    const response = await axios.post(`${baseUrl}/api/events/search`, payload, {
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Requested-By': 'graylog-mcp',
        },
        auth: {
            username: apiToken,
            password: 'token',
        },
    });
    return response.data;
}

export async function fetchEventDefinitions(baseUrl, apiToken, page, perPage, query) {
    const params = {};
    if (page) params.page = page;
    if (perPage) params.per_page = perPage;
    if (query) params.query = query;

    if (_httpOverride) {
        return _httpOverride({ method: "GET", path: "/api/events/definitions", params, baseUrl, apiToken });
    }
    const response = await axios.get(`${baseUrl}/api/events/definitions`, {
        headers: {
            'Accept': 'application/json',
            'X-Requested-By': 'graylog-mcp',
        },
        auth: {
            username: apiToken,
            password: 'token',
        },
        params,
    });
    return response.data;
}

export async function fetchEventNotifications(baseUrl, apiToken, page, perPage) {
    const params = {};
    if (page) params.page = page;
    if (perPage) params.per_page = perPage;

    if (_httpOverride) {
        return _httpOverride({ method: "GET", path: "/api/events/notifications", params, baseUrl, apiToken });
    }
    const response = await axios.get(`${baseUrl}/api/events/notifications`, {
        headers: {
            'Accept': 'application/json',
            'X-Requested-By': 'graylog-mcp',
        },
        auth: {
            username: apiToken,
            password: 'token',
        },
        params,
    });
    return response.data;
}
