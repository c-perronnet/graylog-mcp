// DASH-07 — remove_widget. Symmetric Search+View atomic two-step PUT chain.
//
// =====================================================================
// Why TWO PUTs are required (symmetric Search+View chain)
// =====================================================================
//
// A dashboard widget is wired across THREE artifacts inside two entities:
//   - widget DTO         → ViewDTO.state.{queryId}.widgets[]
//   - position           → ViewDTO.state.{queryId}.positions[<widget_id>]
//   - widget_mapping     → ViewDTO.state.{queryId}.widget_mapping[<widget_id>]
//                          (this maps widget → which SearchTypes feed it)
//   - search_types       → SearchDTO.queries[<queryId>].search_types[]
//                          (the actual data source; widget_mapping points
//                          to these by id)
//
// Removing a widget cleanly requires stripping ALL FOUR pieces. If only
// the View is updated, the SearchDTO is left with ORPHAN search_types
// (no widget references them) — they continue to fire queries against
// Graylog on every dashboard load, leaking IO and noise. If only the
// Search is updated, the View's widget_mapping points at dangling
// search_type IDs and the widget renders blank.
//
// The wrapper orchestrates BOTH in order:
//   step 1: PUT /api/views/search/{searchId}  (strip widget's search_types)
//   step 2: PUT /api/views/{dashboardId}      (strip widget + position +
//                                              widget_mapping entry)
//
// =====================================================================
// Threat model — T-06-02-06 (accepted: partial-failure not transactional)
// =====================================================================
//
// If step 1 succeeds but step 2 fails, the Search no longer has the
// search_types but the View still references them via widget_mapping →
// widget renders blank until the agent retries. This is the explicit
// Phase 6 Pitfall 9 acceptance: no transactional rollback wrapper-side.
// The transcript surfaces which step failed; agent retries the failing
// step (or calls add_widget_from_template via DASH-06 to restore).
//
// =====================================================================
// D-03 INTEGRITY GATE on prospective post-remove sets
// =====================================================================
//
// validateWidgetPositionIntegrity runs on the PROSPECTIVE post-remove
// sets BEFORE wire emission. If removing the widget would leave the
// dashboard in an invalid state (e.g. the current dashboard already has
// an orphan position from prior corruption), refuse with
// widget_position_integrity_violation and NO PUT fires.
//
// =====================================================================
// widget_not_found refusal
// =====================================================================
//
// If args.widgetId isn't present in the current ViewDTO's state, refuse
// with reason:"widget_not_found" + isClientSide:true. No HTTP beyond the
// GETs has fired at this point. Mirror of stream_immutable / similar
// client-side refusal patterns.

import { defineMutatingHandler } from "../_shared/handler.js";
import { RemoveWidgetSchema } from "./schemas.js";
import { getDashboard, getSearch } from "../../services/dashboards.js";
import { validateWidgetPositionIntegrity } from "../_shared/widget-position-integrity.js";
import { executeChain } from "../_shared/blueprint-chain.js";
import { makeClient } from "../../graylog/client.js";

// Test seam mirroring create-dashboard.js — lets tests inject a stub
// validator that throws to pin the "D-03 refusal happens BEFORE wire
// emission" contract on the post-remove path.
let _validateWidgetPositionIntegrity = validateWidgetPositionIntegrity;

export function _setWidgetPositionValidatorForTests(fn) {
    _validateWidgetPositionIntegrity = fn ?? validateWidgetPositionIntegrity;
}

export function _clearWidgetPositionValidatorForTests() {
    _validateWidgetPositionIntegrity = validateWidgetPositionIntegrity;
}

export const handleRemoveWidget = defineMutatingHandler({
    name: "remove_widget",
    schema: RemoveWidgetSchema,
    async build(args) {
        const client = makeClient(args._conn);

        // 1. Pre-flight: GET current ViewDTO.
        const view = await getDashboard(client, args.dashboardId);
        const searchId = view?.search_id;
        if (!searchId) {
            const err = new Error(
                `Dashboard ${args.dashboardId} has no search_id binding — cannot orchestrate Search+View chain`,
            );
            err.reason = "dashboard_missing_search_binding";
            err.isClientSide = true;
            throw err;
        }

        // 2. Locate the state entry containing the widget.
        const stateEntry = Object.entries(view.state ?? {}).find(
            ([_, state]) => (state?.widgets ?? []).some((w) => w?.id === args.widgetId),
        );
        if (!stateEntry) {
            const err = new Error(
                `Widget ${args.widgetId} not found in dashboard ${args.dashboardId}`,
            );
            err.reason = "widget_not_found";
            err.isClientSide = true;
            throw err;
        }
        const [stateKey, state] = stateEntry;
        // SearchType IDs to strip from the Search entity — drawn from the
        // widget_mapping for this specific widget.
        const removedSearchTypeIds = state?.widget_mapping?.[args.widgetId] ?? [];

        // 3. Pre-flight: GET current SearchDTO.
        const search = await getSearch(client, searchId);

        // 4. Compute the prospective post-remove state.
        const newWidgets = (state.widgets ?? []).filter((w) => w?.id !== args.widgetId);
        const newPositions = { ...(state.positions ?? {}) };
        delete newPositions[args.widgetId];
        const newWidgetMapping = { ...(state.widget_mapping ?? {}) };
        delete newWidgetMapping[args.widgetId];

        // 5. D-03 INTEGRITY GATE: validate the prospective post-remove sets
        //    BEFORE wire emission. Refuses orphan-position corruption that
        //    might have leaked from prior buggy edits.
        _validateWidgetPositionIntegrity(newWidgets, newPositions);

        // 6. Compute the prospective post-remove SearchDTO. Find the query
        //    whose id matches the stateKey (Phase 6 single-query model has
        //    stateKey === queryId === "q-1", but be defensive for multi-query
        //    futures).
        const queries = Array.isArray(search?.queries) ? search.queries : [];
        const queryIndex = queries.findIndex((q) => q?.id === stateKey);
        const newQueries = queries.map((q, i) => {
            if (i !== queryIndex) return q;
            const currentSearchTypes = Array.isArray(q?.search_types) ? q.search_types : [];
            return {
                ...q,
                search_types: currentSearchTypes.filter(
                    (st) => !removedSearchTypeIds.includes(st?.id),
                ),
            };
        });
        const newSearch = { ...search, queries: newQueries };

        // 7. Compute the prospective post-remove ViewDTO. Pitfall 8: body.id
        //    matches URL segment defensively.
        const newView = {
            ...view,
            id: args.dashboardId,
            state: {
                ...view.state,
                [stateKey]: {
                    ...state,
                    widgets: newWidgets,
                    positions: newPositions,
                    widget_mapping: newWidgetMapping,
                },
            },
        };

        // 8. Chain transcript: 2 sequential PUTs. No dependsOn — both step
        //    bodies are fully composed at build() time; executeChain just
        //    walks them in order.
        const chain = [
            {
                step: 1,
                tool: "update_search",
                request: {
                    method: "PUT",
                    path: `/api/views/search/${searchId}`,
                    body: newSearch,
                },
            },
            {
                step: 2,
                tool: "update_view",
                request: {
                    method: "PUT",
                    path: `/api/views/${args.dashboardId}`,
                    body: { entity: newView, share_request: null },
                },
            },
        ];

        // 9. Primary preview mirrors step 2 (the agent's mental model is
        //    "removing a widget from a dashboard").
        return {
            chain,
            method: "PUT",
            path: `/api/views/${args.dashboardId}`,
            body: { entity: newView, share_request: null },
            postApplyEstimate: { id: args.dashboardId },
        };
    },
    async apply(client, req) {
        const result = await executeChain(client, req.chain);
        if (result.isError) return result;
        // Final response is step 2's response = the updated ViewDTO.
        return result.transcript[result.transcript.length - 1].response;
    },
    summarize: (args) =>
        `Remove widget ${args.widgetId} from dashboard ${args.dashboardId} (symmetric Search+View atomic two-step PUT chain)`,
});
