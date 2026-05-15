#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { toolDefinitions } from "./tools.js";
import { dispatch, assertAllToolsRegistered } from "./dispatch.js";
import "./tools/_register.js";

const server = new Server({
    name: "graylog-mcp-server",
    version: "2.2.0",
}, {
    capabilities: {
        tools: {},
    },
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: toolDefinitions };
});

// Fail-fast at module-init if any tool in tools.js lacks a registered handler
// (Discretion-06). Runs once at startup so deployment-time misconfiguration
// throws before the first tool call is ever served.
assertAllToolsRegistered(toolDefinitions);

server.setRequestHandler(CallToolRequestSchema, dispatch);

const transport = new StdioServerTransport();
await server.connect(transport);
