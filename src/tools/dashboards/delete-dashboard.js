// DASH-05 — delete_dashboard. DELETE /api/views/{dashboardId}.
//
// =====================================================================
// Leaf delete (Phase 5 D-08 informational-cascade pattern)
// =====================================================================
//
// A Dashboard is a LEAF resource in the Graylog graph:
//   - Widgets are stored INLINE in the ViewDTO state — they vanish with
//     the view (no orphan widget entities).
//   - The bound Search entity (search_id) becomes ORPHAN on delete
//     (Graylog leaves the Search row in the database with no view binding).
//     This is Graylog's expected behavior — no cascade required wrapper-side.
//
// Therefore NO cascade-hash, NO confirmationToken, NO requireConfirm gate.
// `cascades.widgets.count` is INFORMATIONAL only — surfaces the blast
// radius so the agent sees how many widgets would vanish, but the delete
// itself is unconditional.
//
// Contrast with Plan 02-04 delete_index_set (cascade-hash + drift refusal):
// index sets are load-bearing resources whose deletion severs streams /
// retention policies / open searches. Dashboards have no such downstream.
//
// =====================================================================
// Best-effort GET pre-flight
// =====================================================================
//
// The widget-count cascade is informational. If the GET 404s (dashboard
// doesn't exist), 403s (read denied), or otherwise fails, fall through to
// widgetCount:0. The DELETE itself surfaces the real error on apply via
// wrapGraylogError. Mirrors src/tools/events/delete-event-definition.js
// best-effort cascade enumeration.

import { defineMutatingHandler } from "../_shared/handler.js";
import { DeleteDashboardSchema } from "./schemas.js";
import { getDashboard } from "../../services/dashboards.js";
import { makeClient } from "../../graylog/client.js";

export const handleDeleteDashboard = defineMutatingHandler({
    name: "delete_dashboard",
    schema: DeleteDashboardSchema,
    async build(args) {
        const client = makeClient(args._conn);

        // Best-effort informational cascade pre-flight. Count widgets so the
        // agent sees the blast radius. Failure here MUST NOT prevent the
        // dry-run from rendering; the DELETE surfaces any real error on apply.
        let widgetCount = 0;
        try {
            const current = await getDashboard(client, args.dashboardId);
            const states = Object.values(current?.state ?? {});
            widgetCount = states.reduce(
                (sum, s) => sum + (Array.isArray(s?.widgets) ? s.widgets.length : 0),
                0,
            );
        } catch (_err) {
            // 404 / 403 / any pre-flight failure → fall through to count:0.
            widgetCount = 0;
        }

        return {
            method: "DELETE",
            path: `/api/views/${encodeURIComponent(args.dashboardId)}`,
            body: null,
            // INFORMATIONAL cascade — handler.js spreads this onto dry-run
            // preview JSON. NO confirmationToken, NO drift refusal at apply.
            cascades: { widgets: { count: widgetCount } },
            postApplyEstimate: { id: args.dashboardId, deleted: true },
            normalize: () => ({
                id: args.dashboardId,
                body: { deleted: true, dashboardId: args.dashboardId },
            }),
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        `Delete dashboard ${args.dashboardId} (leaf delete — widgets vanish with view; bound Search becomes orphan per Graylog model)`,
});
