import axios from "axios";

// Test-only HTTP seam (Phase 7 Plan 03 HARD-03 smoke). Mirrors the
// `_setSearchOverride` pattern in src/clustering/_test_hooks.js. When set,
// every fetchStreams() / searchGraylog() call dispatches through the
// override instead of axios. Production code MUST NOT call _setHttpOverride
// — the `_` prefix marks it as test-only per CONVENTIONS.md.
//
// Callback signature: ({ method, path, body }) => Promise<responseData> | responseData
// Throwing from the callback simulates a transport failure (used to exercise
// the histogram fallback chain in test/v7-read-tool-smoke.test.js).
let _httpOverride = null;
export function _setHttpOverride(fn) { _httpOverride = fn; }
export function _clearHttpOverride() { _httpOverride = null; }

export function buildQueryString(query, filters, exactMatch = true) {
    let qs;
    if (!query || query === "*") {
        qs = "*";
    } else if (exactMatch && !query.startsWith('"') && !/[*?:()]/.test(query)) {
        qs = `"${query}"`;
    } else {
        qs = query;
    }
    if (filters && typeof filters === "object") {
        for (const [field, value] of Object.entries(filters)) {
            if (value === undefined || value === null) continue;
            if (typeof value === "number") {
                qs += ` AND ${field}:${value}`;
            } else {
                qs += ` AND ${field}:"${value}"`;
            }
        }
    }
    return qs;
}

export function buildStreamFilter(streamIds) {
    if (!streamIds || streamIds.length === 0) return undefined;
    // Normalize: MCP clients may pass arrays as JSON strings
    let ids = streamIds;
    if (typeof ids === "string") {
        try { ids = JSON.parse(ids); } catch { ids = [ids]; }
    }
    if (!Array.isArray(ids)) ids = [ids];
    if (ids.length === 0) return undefined;
    return {
        type: "or",
        filters: ids.map(id => ({ type: "stream", id }))
    };
}

export function resolveFields(fieldsParam, defaultFields) {
    if (fieldsParam === "*") return null; // null = return all fields
    if (fieldsParam) return fieldsParam.split(",").map(s => s.trim());
    if (defaultFields === "*") return null; // config set to all fields
    return defaultFields;
}

export function extractMessages(responseData, fieldList) {
    const results = responseData?.results?.q1?.search_types?.st1;
    const messages = results?.messages || [];
    const totalResults = results?.total_results || 0;

    const extracted = messages.map(m => {
        const msg = m.message || {};
        if (!fieldList) return msg; // null = all fields
        const picked = {};
        for (const f of fieldList) {
            if (msg[f] !== undefined) picked[f] = msg[f];
        }
        return picked;
    });

    return { totalResults, extracted };
}

export async function fetchMessageById(baseUrl, apiToken, messageId) {
    const payload = {
        queries: [{
            id: "q1",
            query: { type: "elasticsearch", query_string: `gl2_message_id:${messageId}` },
            timerange: { type: "relative", range: 86400 },
            search_types: [{
                id: "st1",
                type: "messages",
                limit: 1,
            }]
        }]
    };

    const data = await searchGraylog(baseUrl, apiToken, payload);
    const messages = data?.results?.q1?.search_types?.st1?.messages || [];
    if (messages.length === 0) return null;
    return messages[0].message;
}

export async function fetchStreams(baseUrl, apiToken) {
    if (_httpOverride) {
        return _httpOverride({ method: "GET", path: "/api/streams", baseUrl, apiToken });
    }
    const response = await axios.get(`${baseUrl}/api/streams`, {
        headers: {
            'Accept': 'application/json',
            'X-Requested-By': 'graylog-mcp',
        },
        auth: {
            username: apiToken,
            password: 'token',
        },
    });
    return response.data;
}

export async function searchGraylog(baseUrl, apiToken, payload) {
    if (_httpOverride) {
        return _httpOverride({ method: "POST", path: "/api/views/search/sync", body: payload, baseUrl, apiToken });
    }
    try {
        const response = await axios.post(`${baseUrl}/api/views/search/sync`, payload, {
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
    } catch (error) {
        // Enhanced error logging for debugging
        console.error('Graylog API Error:', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            request_payload: JSON.stringify(payload, null, 2)
        });
        throw error;
    }
}
