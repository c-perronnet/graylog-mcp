// DASH-04 — update_dashboard. PUT /api/views/{dashboardId}.
//
// =====================================================================
// STRICT_NO_ECHO partial-update with D-02 searchId-immutability
// =====================================================================
//
// Graylog's PUT /api/views/{id} requires the FULL ViewDTO on the wire —
// the server's Validator.validate(ViewDTO) enforces structural invariants
// (widget→position pairing, widget_mapping references, search_id binding).
// A partial body returns 400.
//
// The wrapper preserves the agent's partial-update mental model AND
// satisfies the server's full-DTO requirement via a GET pre-flight +
// overlay pattern:
//   1. build() does GET /api/views/{id} for the current ViewDTO
//   2. overlays args.changes.{title, description, summary} onto the
//      current DTO
//   3. PUTs the merged DTO
//
// =====================================================================
// D-02 STRUCTURAL: searchId IMMUTABLE post-creation
// =====================================================================
//
// UpdateDashboardSchema.changes is `.strict()` — agent CANNOT smuggle
// `searchId` through update_dashboard. The C7 mitigation depends on
// search-id immutability after the internal Search+View chain runs:
// rebinding a dashboard to a different Search entity would let an
// adversarial agent swap the underlying data. Any future search-id
// rebinding tool MUST be explicit (not smuggled through update).
//
// Other immutable fields (id, search_id, state, type) come from the GET
// response unchanged — STRICT_NO_ECHO ensures the agent only touches
// title/description/summary; the rest passes through verbatim.
//
// =====================================================================
// Pitfall 8 (Phase 5): body.id MUST match URL segment
// =====================================================================
//
// CreateEntityRequest envelope shape ({entity, share_request:null})
// mirrors createDashboard. The merged entity carries id = args.dashboardId
// explicitly (overrides whatever was in the GET response, defensively).
//
// =====================================================================
// Composition changes flow through DASH-06 / DASH-07
// =====================================================================
//
// update_dashboard does NOT round-trip widget content. Adding widgets
// flows through DASH-06 add_widget_from_template (Plan 06-03);
// removing flows through DASH-07 remove_widget (Plan 06-02 Task 4).
// Those tools handle the symmetric Search+View 2-step PUT chain that's
// necessary when widget composition changes — update_dashboard alone
// cannot maintain Search/View consistency for those edits.

import { defineMutatingHandler } from "../_shared/handler.js";
import { UpdateDashboardSchema } from "./schemas.js";
import { getDashboard } from "../../services/dashboards.js";
import { makeClient } from "../../graylog/client.js";
import { toIdBody } from "../../graylog/normalize.js";

export const handleUpdateDashboard = defineMutatingHandler({
    name: "update_dashboard",
    schema: UpdateDashboardSchema,
    async build(args) {
        // Pre-flight GET — server-side Validator.validate(ViewDTO) needs the
        // full DTO on the wire. Errors here (404 / 403 / network) surface via
        // wrapGraylogError before the PUT ever fires.
        const client = makeClient(args._conn);
        const current = await getDashboard(client, args.dashboardId);

        // STRICT_NO_ECHO overlay: ONLY title/description/summary can be
        // touched. searchId is schema-rejected (D-02); id/state/type/search_id
        // pass through from the GET response unchanged.
        //
        // Conditional spread preserves agent intent — omit means leave field
        // alone; explicit value (incl. empty string) means set the field.
        const merged = {
            ...current,
            ...(args.changes.title !== undefined ? { title: args.changes.title } : {}),
            ...(args.changes.description !== undefined ? { description: args.changes.description } : {}),
            ...(args.changes.summary !== undefined ? { summary: args.changes.summary } : {}),
            // Pitfall 8: body.id MUST match URL segment. Defensive override —
            // if the GET response's id field was somehow wrong, we win.
            id: args.dashboardId,
        };

        return {
            method: "PUT",
            path: `/api/views/${args.dashboardId}`,
            body: { entity: merged, share_request: null },
            postApplyEstimate: { id: args.dashboardId },
            normalize: (raw) => toIdBody(raw, { idFields: ["id"] }),
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        `Update dashboard ${args.dashboardId} (${Object.keys(args.changes).join(", ")}; STRICT_NO_ECHO + D-02 searchId-immutable)`,
});
