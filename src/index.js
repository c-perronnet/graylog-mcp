#!/usr/bin/env node


import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";

const server = new Server({
    name: "simple-graylog-mcp",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "fetch_graylog_messages",
                description: "Fetch messages from Graylog",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "The query to search for, with the respective fields and values",
                        },
                        searchTimeRangeInSeconds: {
                            type: "number",
                            description: "The time range to search for, in seconds",
                        },
                        searchCountLimit: {
                            type: "number",
                            description: "The number of messages to fetch",
                        },
                        fields: {
                            type: "string",
                            description: "The fields to fetch",
                        },
                    },
                },
            }
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "fetch_graylog_messages") {
        return fetchGraylogMessages(request);
    }
    
    throw new Error(`Tool not found: ${request.params.name}`);
});

async function fetchGraylogMessages(request) {

    const originalRequest = request;

    const baseUrl = process.env.BASE_URL;
    const apiToken = process.env.API_TOKEN;

    const query = originalRequest.params.arguments?.query;

    // Default to 15 minutes
    const searchTimeRangeInSeconds = originalRequest.params.arguments?.searchTimeRangeInSeconds ?? 900;
    // Default to 50
    const searchCountLimit = originalRequest.params.arguments?.searchCountLimit ?? 50;
    // Default to '*'
    const fields = originalRequest.params.arguments?.fields ?? '*';

    try {
        const response = await axios.get(`${baseUrl}/api/search/universal/relative`, {
            params: {
                query: query,
                range: searchTimeRangeInSeconds,
                limit: searchCountLimit,
                fields: fields
            },
            headers: {
                'Accept': 'application/json',
            },
            auth: {
                username: apiToken,
                password: 'token'
            }
        });
        
        if (process.env.DEBUG === "true") {
            console.log(response.data);
            return;
        }

        return {
            result: response.data,
            content: [{
                type: "text",
                text: JSON.stringify(response.data.messages),
            }],
        };
    } catch (error) {
        console.error('Error fetching messages:', error);
        return {
            result: [],
            content: [{
                type: "text",
                text: `Error fetching messages: ${error.message}`,
            }],
        };
    }
}

const transport = new StdioServerTransport();
await server.connect(transport);