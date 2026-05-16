// DASH-06 — add_widget_from_template. Symmetric INVERSE of remove_widget:
// drops a widget triplet from the curated WIDGET_TEMPLATES library onto an
// existing dashboard via the Search+View atomic two-step PUT chain.
//
// =====================================================================
// Why TWO PUTs (or ONE for text-widget placeholder)
// =====================================================================
//
// Adding a widget cleanly inverts the symmetry of remove_widget:
//   step 1: PUT /api/views/search/{searchId}  (APPEND new searchType to
//                                              Search.queries[].search_types)
//   step 2: PUT /api/views/{dashboardId}      (APPEND widget + position +
//                                              widget_mapping entry)
//
// Step ordering is load-bearing (inverse of remove_widget): the Search MUST
// be updated FIRST so that when the View update lands and references the
// new SearchType via widget_mapping, the SearchType already exists. Reverse
// order leaves a brief window where the View references a non-existent
// SearchType and the widget renders blank.
//
// For the Q3 TEXT_WIDGET_PLACEHOLDER template (top_error_clusters,
// searchType:null), only step 2 fires — no SearchType to append.
//
// =====================================================================
// M7 ACCEPTANCE GATE (closed-set rejection at zod.parse)
// =====================================================================
//
// AddWidgetFromTemplateSchema uses z.enum(TEMPLATE_NAMES) so invalid
// templateName values reject at zod.parse BEFORE any HTTP fires. This is
// the M7 mitigation: agent cannot enumerate or fuzz template names to
// discover hidden / unintended builders. The closed set + frozen registry
// map (T-06-03-08) form the structural defense.
//
// =====================================================================
// D-03 INTEGRITY GATE on prospective post-add sets
// =====================================================================
//
// validateWidgetPositionIntegrity runs on the PROSPECTIVE post-add sets
// BEFORE wire emission. Tightens Graylog's server-side superset-only check
// to bidirectional strict equality (matches the same gate on create + remove
// paths so the integrity contract is uniform across the dashboard surface).
//
// =====================================================================
// Per-template option validation
// =====================================================================
//
// The schema accepts `options: z.object({}).passthrough().default({})` —
// open shape. Each builder owns its own option contract (e.g.
// buildFieldValueDistribution throws when `field` is absent). Builder errors
// propagate through build() → catch → wrapGraylogError so the agent sees
// the structured `isError` envelope without a stack trace.
//
// =====================================================================
// Threat model — T-06-03-05 (dashboard_empty_state refusal)
// =====================================================================
//
// If the dashboard's `state` map is empty, we refuse with
// dashboard_empty_state + isClientSide:true. No PUT fires. This protects
// against an edge case where a previous tool produced a malformed ViewDTO
// with no state entries — adding a widget into a non-existent state key
// would either fail server-side OR silently lose the widget on read.

import { defineMutatingHandler } from "../_shared/handler.js";
import { AddWidgetFromTemplateSchema } from "./schemas.js";
import { WIDGET_TEMPLATES } from "../../widget-templates/index.js";
import { getDashboard, getSearch } from "../../services/dashboards.js";
import { validateWidgetPositionIntegrity } from "../_shared/widget-position-integrity.js";
import { executeChain } from "../_shared/blueprint-chain.js";
import { makeClient } from "../../graylog/client.js";

// Test seam mirroring create-dashboard.js + remove-widget.js — lets tests
// inject a stub validator that throws so the "D-03 refusal happens BEFORE
// wire emission" contract can be pinned on the post-add path.
let _validateWidgetPositionIntegrity = validateWidgetPositionIntegrity;

export function _setWidgetPositionValidatorForTests(fn) {
    _validateWidgetPositionIntegrity = fn ?? validateWidgetPositionIntegrity;
}

export function _clearWidgetPositionValidatorForTests() {
    _validateWidgetPositionIntegrity = validateWidgetPositionIntegrity;
}

export const handleAddWidgetFromTemplate = defineMutatingHandler({
    name: "add_widget_from_template",
    schema: AddWidgetFromTemplateSchema,
    async build(args) {
        const client = makeClient(args._conn);

        // 1. Pre-flight: GET current ViewDTO. We need view.search_id (binding)
        //    AND view.state to find which state-key to mutate.
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

        // 2. Resolve target state-key. Phase 6 single-query dashboards have
        //    exactly one state entry (typically "q-1"). Multi-state dashboards
        //    are deferred — see 06-CONTEXT.md "Deferred" — so we target the
        //    FIRST state key defensively.
        const stateKey = Object.keys(view.state ?? {})[0];
        if (!stateKey) {
            const err = new Error(
                `Dashboard ${args.dashboardId} has no state entries — cannot add widget`,
            );
            err.reason = "dashboard_empty_state";
            err.isClientSide = true;
            throw err;
        }
        const state = view.state[stateKey];

        // 3. Pre-flight: GET current SearchDTO so we can append (rather than
        //    overwrite) the new searchType into queries[].search_types.
        const search = await getSearch(client, searchId);

        // 4. Build the new widget triplet from the WIDGET_TEMPLATES registry.
        //    The frozen-map lookup (T-06-03-08) + z.enum schema (M7) make
        //    this lookup safe — the builder reference is wrapper-controlled.
        //    Per-template option validation lives in the builder; errors
        //    propagate (e.g. field_value_distribution throws when field
        //    missing → wrapGraylogError converts to isError envelope).
        const builder = WIDGET_TEMPLATES[args.templateName];
        const triplet = builder(args.options);

        // 5. Compute prospective post-add sets.
        const currentWidgets = state.widgets ?? [];
        const currentPositions = state.positions ?? {};
        const currentWidgetMapping = state.widget_mapping ?? {};

        // 5a. BUG #8b — auto-placement. When the caller did NOT supply
        //     options.position, the builder defaults position to col:1,row:1,
        //     which overlaps every existing widget. Compute the next free row
        //     as max(row + height) across all existing positions (defaulting
        //     to 1 on an empty dashboard) and anchor the new widget at col 1,
        //     preserving the builder's height/width. triplet is Object.freeze'd,
        //     so we never mutate triplet.position — placedPosition is used
        //     downstream instead. When options.position IS supplied the builder
        //     already honored it, so placedPosition === triplet.position.
        let placedPosition = triplet.position;
        if (!args.options?.position) {
            const nextRow = Object.values(currentPositions).reduce((max, pos) => {
                const row = Number(pos?.row) || 0;
                const height = Number(pos?.height) || 0;
                return Math.max(max, row + height);
            }, 1);
            placedPosition = { ...triplet.position, col: 1, row: nextRow };
        }

        const newWidgets = [...currentWidgets, triplet.widget];
        const newPositions = {
            ...currentPositions,
            [triplet.widget.id]: placedPosition,
        };
        const newWidgetMapping = {
            ...currentWidgetMapping,
            // For text-widget templates (searchType:null), emit an empty
            // searchType list — the widget structurally exists but has no
            // Graylog data source (Q3 TEXT_WIDGET_PLACEHOLDER).
            [triplet.widget.id]: triplet.searchType ? [triplet.searchType.id] : [],
        };

        // 6. D-03 INTEGRITY GATE — validate the prospective post-add sets
        //    BEFORE wire emission. Throws with reason
        //    widget_position_integrity_violation + isClientSide:true; the
        //    wrapper's wrapGraylogError surfaces it as an isError envelope.
        _validateWidgetPositionIntegrity(newWidgets, newPositions);

        // 7. Compose the prospective post-add ViewDTO. Pitfall 8: body.id
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

        // 8. Build the chain. For SearchType-bearing templates: 2 steps.
        //    For text-widget placeholder (searchType:null): 1 step (View only).
        const chain = [];

        if (triplet.searchType) {
            // Step 1: PUT /api/views/search/{searchId} — append the new
            //         searchType to queries[stateKey].search_types.
            const queries = Array.isArray(search?.queries) ? search.queries : [];
            const queryIndex = queries.findIndex((q) => q?.id === stateKey);
            // search_query_not_found refusal: the dashboard's state-key
            // didn't match any query.id on the bound SearchDTO. Without this
            // gate, findIndex returning -1 silently drops the searchType
            // append (the .map below would never hit `i !== queryIndex`),
            // producing a wire body identical to the pre-fetch search and
            // a widget that renders blank because widget_mapping points at
            // a SearchType that was never written.
            if (queryIndex === -1) {
                const err = new Error(
                    `Search ${searchId} has no query with id "${stateKey}" — cannot append widget's searchType`,
                );
                err.reason = "search_query_not_found";
                err.isClientSide = true;
                throw err;
            }
            const newQueries = queries.map((q, i) => {
                if (i !== queryIndex) return q;
                const currentSearchTypes = Array.isArray(q?.search_types) ? q.search_types : [];
                return {
                    ...q,
                    search_types: [...currentSearchTypes, triplet.searchType],
                };
            });
            const newSearch = { ...search, queries: newQueries };
            chain.push({
                step: chain.length + 1,
                tool: "update_search",
                request: {
                    method: "PUT",
                    path: `/api/views/search/${encodeURIComponent(searchId)}`,
                    body: newSearch,
                },
            });
        }

        // Step N: PUT /api/views/{dashboardId} (always present).
        chain.push({
            step: chain.length + 1,
            tool: "update_view",
            request: {
                method: "PUT",
                path: `/api/views/${encodeURIComponent(args.dashboardId)}`,
                body: { entity: newView, share_request: null },
            },
        });

        // 9. Primary preview mirrors the LAST chain step (the agent's mental
        //    model is "adding a widget to a dashboard" — the View update IS
        //    the visible side effect).
        return {
            chain,
            method: "PUT",
            path: `/api/views/${encodeURIComponent(args.dashboardId)}`,
            body: { entity: newView, share_request: null },
            postApplyEstimate: {
                id: args.dashboardId,
                widgetId: triplet.widget.id,
            },
        };
    },
    async apply(client, req) {
        const result = await executeChain(client, req.chain);
        if (result.isError) return result;
        // Final response is the last step's response = the updated ViewDTO.
        return result.transcript[result.transcript.length - 1].response;
    },
    summarize: (args) =>
        `Add widget from template "${args.templateName}" to dashboard ${args.dashboardId}`
        + ` (symmetric Search+View atomic chain)`,
});
