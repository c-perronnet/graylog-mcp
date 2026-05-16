// DASH-02 — get_dashboard. Returns the FULL ViewDTO via GET /api/views/{id}.
//
// Surfaces the complete dashboard structure including:
//   - state.{queryId}.widgets — the widget array (one entry per widget cell)
//   - state.{queryId}.positions — widget_id → {col, row, height, width} map
//   - state.{queryId}.widget_mapping — widget_id → searchType_id[] map
//     (CRITICAL for remove_widget: this map identifies which searchTypes
//     in the bound Search entity belong to each widget)
//   - search_id — the bound Search entity's id (used by remove_widget +
//     add_widget_from_template to wire the symmetric Search+View PUT chain)
//   - type:"DASHBOARD" — the discriminator; list_dashboards uses this to
//     filter out saved-searches (Q1 default)
//
// Pattern: plain async handler (NOT defineListHandler) — single-DTO read
// tool. Mirrors src/tools/events/get-event-definition.js +
// src/tools/streams/get-stream.js. The framework's narrow-projection
// machinery is bypassed entirely; the full DTO is the agent-facing surface.
//
// 404 surfaces via wrapGraylogError so the error envelope embeds the tool
// name for agent-debuggability and the upstream Graylog status code is
// preserved on `err.status`.

import { GetDashboardSchema } from "./schemas.js";
import { resolveConnection } from "../_shared/connection.js";
import { makeClient } from "../../graylog/client.js";
import {
    errorResponse,
    formatZodError,
    wrapGraylogError,
} from "../_shared/errors.js";

export async function handleGetDashboard(request) {
    const rawArgs = request?.params?.arguments ?? {};

    // 1. Validate (FOUND-05). dashboardId is required (z.string().min(1)).
    let args;
    try {
        args = GetDashboardSchema.parse(rawArgs);
    } catch (err) {
        return errorResponse(formatZodError(err));
    }

    // 2. Resolve connection — _testConnection seam re-merged from pre-zod
    //    args (handler.js convention; threat-model T-00-04-05 — seam absent
    //    from GetDashboardSchema, so zod's default strip drops it from
    //    production-agent payloads).
    const seamArgs = rawArgs._testConnection
        ? { ...args, _testConnection: rawArgs._testConnection }
        : args;
    const { conn, name: connectionName, error } = resolveConnection(seamArgs);
    if (error) return error;

    // 3. Fire the GET. Wire path: /api/views/{id} — see 06-RESEARCH.md
    //    §"Endpoint Catalogue" + 06-01 SUMMARY §services-layer.
    try {
        const client = makeClient(conn);
        const dashboard = await client.request(
            "GET",
            `/api/views/${encodeURIComponent(args.dashboardId)}`,
            null,
        );
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    tool: "get_dashboard",
                    connection: connectionName,
                    dashboard,
                }),
            }],
        };
    } catch (err) {
        return wrapGraylogError(err, "get_dashboard");
    }
}
