import axios from "axios";

export async function searchEvents(baseUrl, apiToken, payload) {
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
