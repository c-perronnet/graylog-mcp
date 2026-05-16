// BLUE-03 — create_app_health_dashboard.
//
// A thin convenience wrapper over create_dashboard's internal Search+View
// 2-step chain (Plan 06-02 DASH-03 / C7 mitigation). Pre-wires 4 default
// widgets to the agent-supplied stream:
//   - error_rate_over_time
//   - top_sources_by_volume
//   - level_distribution
//   - recent_events_table
//
// Agents who want different widgets should use `create_dashboard` directly
// with explicit widget triplets. BLUE-03 trades flexibility for ergonomics
// at the single intent "give me a health dashboard for this stream".
//
// Chain shape (2 steps via executeChain):
//   step 1: POST /api/views/search   (BARE SearchDTO body — Pitfall 3 exception)
//   step 2: POST /api/views          (CreateEntityRequest envelope)
//     dependsOn: {from: "step1.response.id", as: "searchId"}
//
// Apply walks executeChain — the search id from step 1's response substitutes
// into step 2's view body via the __SERVER_ASSIGNED__step1 placeholder.
//
// Composition contract (D-09): Imports ONLY from src/services/dashboards.js
// + src/widget-templates/. Pinned by the Plan 06-05 D-09 grep test.

import { defineMutatingHandler } from "../_shared/handler.js";
import { CreateAppHealthDashboardSchema } from "./schemas.js";
import {
    createSearch,
    createDashboard,
    buildSearchDTO,
    buildViewDTO,
} from "../../services/dashboards.js";
import { WIDGET_TEMPLATES } from "../../widget-templates/index.js";
import { executeChain } from "../_shared/blueprint-chain.js";
import { SERVER_ASSIGNED_SENTINEL } from "../_shared/dry-run.js";

// D-09 architectural-boundary markers — see file header.
void createSearch;
void createDashboard;

const QUERY_ID = "q-1";   // wrapper-deterministic single-query scope (Phase 6)

export const handleCreateAppHealthDashboard = defineMutatingHandler({
    name: "create_app_health_dashboard",
    schema: CreateAppHealthDashboardSchema,
    async build(args) {
        const title = args.title ?? `Health dashboard (stream ${args.streamId})`;
        const triplets = args.defaultWidgets.map((templateName) => {
            const builder = WIDGET_TEMPLATES[templateName];
            return builder({ streamIds: [args.streamId] });
        });

        const searchDTO = buildSearchDTO({
            queryId: QUERY_ID,
            widgets: triplets,
            timerange: { type: "relative", from: 900 },
            query: "",
            streamIds: [args.streamId],
        });
        const viewDTO = buildViewDTO({
            title,
            description: `Auto-generated health dashboard for stream ${args.streamId}`,
            summary: `${triplets.length} pre-wired widgets`,
            searchId: `${SERVER_ASSIGNED_SENTINEL}step1`,  // resolved at apply-time
            queryId: QUERY_ID,
            widgets: triplets,
        });

        const chain = [
            {
                step: 1,
                tool: "create_search",
                request: { method: "POST", path: "/api/views/search", body: searchDTO },
                postApplyEstimate: { id: SERVER_ASSIGNED_SENTINEL },
            },
            {
                step: 2,
                tool: "create_view",
                request: {
                    method: "POST",
                    path: "/api/views",
                    body: { entity: viewDTO, share_request: null },
                },
                dependsOn: { from: "step1.response.id", as: "searchId" },
                postApplyEstimate: { id: SERVER_ASSIGNED_SENTINEL },
            },
        ];

        return {
            chain,
            // Primary preview mirrors step 2 (the agent's mental model is
            // "creating a dashboard"); handler.js spreads req.chain so the
            // agent sees the full 2-step plan up front.
            method: "POST",
            path: "/api/views",
            body: { entity: viewDTO, share_request: null },
            postApplyEstimate: { id: SERVER_ASSIGNED_SENTINEL },
        };
    },
    async apply(client, req) {
        const result = await executeChain(client, req.chain);
        if (result.isError) return result;
        // Final response is step 2's response (the ViewDTO with id).
        return result.transcript[result.transcript.length - 1].response;
    },
    summarize: (args) =>
        `Create health dashboard for stream ${args.streamId} (${args.defaultWidgets?.length ?? 4} default widgets via internal Search+View chain)`,
});
