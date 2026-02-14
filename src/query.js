import axios from "axios";

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

export function buildStreamFilter(streamId) {
    if (!streamId) return undefined;
    return {
        type: "or",
        filters: [{ type: "stream", id: streamId }]
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
