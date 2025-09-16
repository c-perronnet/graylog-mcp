#!/usr/bin/env node


import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server({
    name: "simple-graylog-mcp-server",
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
                name: "calculate_sum",
                // The description attribute is the text shown in the tool description in Claude or Cursor
                description: "Add two numbers together",
                inputSchema: {
                    type: "object",
                    properties: {
                        a: { type: "number" },
                        b: { type: "number" },
                    },
                    required: ["a", "b"],
                },
            },
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
                    },
                },
            }
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "calculate_sum") {

        // The arguments are properties specified in the inputSchema
        const { a, b } = request.params.arguments;

        return {
            result: a + b,
            content: [{
                type: "text",
                text: `The sum of ${a} and ${b} is ${a + b}`,
            }],
        };
    }
    
    if (request.params.name === "fetch_graylog_messages") {
        const data = 'sample data';
        return {
            result: data,
            content: [{
                type: "text",
                text: `the graylog mock data is ${data}`,
            }],
        };
    }
    
    throw new Error(`Tool not found: ${request.params.name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Simple Graylog MCP Server started successfully!");