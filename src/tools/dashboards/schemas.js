// Plan 06-02 — per-domain zod schemas for the 6 Phase 6 dashboard CRUD tools.
//
// Source-walk: every shape below derives from Graylog 7.2 source
// (graylog2-server/.../views/ViewDTO.java, ViewStateDTO.java, WidgetDTO.java,
// WidgetPositionDTO.java + Position sealed-interface, SearchDTO.java) and
// from 06-RESEARCH.md §"Endpoint Catalogue" / §"Pitfalls".
//
// Schemas covered (snake_case maps to the wire tool names):
//   ListDashboardsSchema     — list_dashboards   (DASH-01; Q1 wrapper-side type filter)
//   GetDashboardSchema       — get_dashboard     (DASH-02; full ViewDTO)
//   CreateDashboardSchema    — create_dashboard  (DASH-03; C7 ACCEPTANCE GATE)
//   UpdateDashboardSchema    — update_dashboard  (DASH-04; D-02 + STRICT_NO_ECHO)
//   DeleteDashboardSchema    — delete_dashboard  (DASH-05; leaf)
//   RemoveWidgetSchema       — remove_widget     (DASH-07; symmetric 2-step PUT chain)
//
// =====================================================================
// D-02 STRUCTURAL ENFORCEMENT — NO `searchId` ANYWHERE
// =====================================================================
//
// CreateDashboardSchema is `.strict()` — agent-supplied `searchId` (or any
// other unknown top-level key) fails zod.parse with `Unrecognized key`. This
// is the C7 mitigation's structural backstop: even if a future tool author
// forgets the design intent and tries to "let the agent pass searchId for
// power users", the schema refuses at the boundary.
//
// UpdateDashboardSchema.changes is `.strict()` — the same rule applies to
// the partial-update path. The agent CANNOT rebind a dashboard to a
// different Search entity via update_dashboard.changes — searchId is
// IMMUTABLE post-creation by design (D-02 + the internal Search+View chain
// guarantees a 1:1 binding for every Dashboard the wrapper creates).
//
// Search-ID rebinding, if ever needed in a future plan, requires its own
// dedicated tool with explicit intent — NOT a smuggled-through-update path.

import { z } from "zod";
import { mutatingBase, listBase } from "../_shared/schemas.js";

// =====================================================================
// Widget triplet — agent-facing input shape
// =====================================================================
//
// The actual WidgetDTO emitted on the wire is built by the widget-templates
// library (Plan 06-03) OR — for arbitrary widgets fed to create_dashboard
// directly in Plan 06-02 — the agent supplies the triplet shape that
// buildSearchDTO/buildViewDTO consume.
//
// Shape rationale:
//   - widget.id, searchType.id: OPTIONAL — wrapper supplies via randomUUID()
//     when absent. The C7 mitigation requires wrapper-controlled IDs so the
//     internal Search+View chain can wire the references consistently.
//   - position.col: union(integer, {type:"infinity"}) per 06-U1-SMOKE Q4
//     decision TAGGED_UNION_INFINITY (full-width sealed-class Jackson form).
//     Plan 06-03's 8-template default set uses IntegerPosition exclusively;
//     the infinity branch is future-proofing.
//   - searchType.nullable: text-widget placeholders (Plan 03 top_error_clusters
//     per 06-U1-SMOKE Q3 TEXT_WIDGET_PLACEHOLDER) carry searchType:null and
//     contribute no entry to SearchDTO.queries[0].search_types.
//   - widget.passthrough(): open shape; full per-type widget validation
//     deferred to Plan 06-03 widget-template builders.
const WidgetTripletSchema = z.object({
    widget: z.object({
        id: z.string().optional(),  // wrapper supplies via randomUUID() if absent
        type: z.string(),
    }).passthrough(),
    position: z.object({
        col: z.union([z.number().int(), z.object({ type: z.literal("infinity") }).passthrough()]),
        row: z.number().int(),
        height: z.number().int().positive(),
        width: z.number().int().positive(),
    }).passthrough(),
    searchType: z.object({
        id: z.string().optional(),  // wrapper supplies via randomUUID() if absent
        type: z.string(),
    }).passthrough().nullable(),  // null for text-widget placeholders (Q3)
});

// =====================================================================
// DASH-01 — list_dashboards
// =====================================================================
//
// listBase carries connectionName + limit + fields. No additional
// per-tool args — `?query=type:DASHBOARD` is wrapper-fixed (NOT
// agent-controllable). Defensive Q1 wrapper-side filter on view.type
// applies regardless of upstream filter behavior.
export const ListDashboardsSchema = listBase.extend({});

// =====================================================================
// DASH-02 — get_dashboard
// =====================================================================
//
// Read tool — NOT extending mutatingBase (no dryRun / idempotencyKey).
export const GetDashboardSchema = z.object({
    connectionName: z.string().optional(),
    dashboardId: z.string().min(1, "dashboardId required"),
});

// =====================================================================
// DASH-03 — create_dashboard (C7 ACCEPTANCE GATE)
// =====================================================================
//
// D-02 STRUCTURAL: `.strict()` mode rejects ANY unknown top-level key
// (including `searchId`) at zod.parse. Without `.strict()`, zod's default
// `strip` mode would silently drop unknown keys — the agent would never
// see an error, and the structural intent (C7 mitigation) would be
// invisible. `.strict()` makes the contract assertion testable AND visible.
//
// timerange / query / streamIds carry the dashboard-level search context
// (single shared Search entity per dashboard per Graylog model). The
// wrapper composes the SearchDTO + ViewDTO in build() and emits a 2-step
// chain transcript [{POST /api/views/search}, {POST /api/views}] with
// dependsOn:{from:"step1.response.id", as:"searchId"} so the agent's
// dry-run preview surfaces the full plan without ever seeing the Search ID.
export const CreateDashboardSchema = mutatingBase.extend({
    title: z.string().min(1),
    description: z.string().optional(),
    summary: z.string().optional(),
    // D-02: NO `searchId` field. `.strict()` below makes this a hard reject,
    // not a silent strip. ANY agent-supplied unknown key fails parse.
    timerange: z.object({
        type: z.enum(["relative", "absolute", "keyword"]),
    }).passthrough().default({ type: "relative", from: 300 }),
    query: z.string().default(""),
    streamIds: z.array(z.string()).default([]),
    widgets: z.array(WidgetTripletSchema).min(1, "at least one widget required"),
}).strict();  // D-02 LOAD-BEARING: unknown keys (incl. searchId) cause zod ERROR.

// =====================================================================
// DASH-04 — update_dashboard (D-02 STRICT_NO_ECHO partial-update)
// =====================================================================
//
// changes is `.strict()` — D-02 enforcement on the partial-update path.
// The agent CANNOT smuggle searchId through update_dashboard.changes:
// searchId is IMMUTABLE post-creation by design.
//
// Title/description/summary are the only top-level metadata fields that
// flow through update_dashboard. Composition changes (adding/removing
// widgets) flow through DASH-06 add_widget_from_template (Plan 06-03) and
// DASH-07 remove_widget — those tools handle the symmetric Search+View
// 2-step PUT chain. update_dashboard does NOT round-trip widget content;
// the build() pre-flight GET + STRICT_NO_ECHO overlay touches only the
// declared changes fields.
export const UpdateDashboardSchema = mutatingBase.extend({
    dashboardId: z.string().min(1, "dashboardId required"),
    changes: z.object({
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        summary: z.string().optional(),
        // D-02: NO `searchId`. `.strict()` rejects it (and any other unknown
        // key) at zod.parse.
    }).strict().refine(
        (c) => Object.keys(c).length > 0,
        "changes must contain at least one field",
    ),
});

// =====================================================================
// DASH-05 — delete_dashboard (leaf)
// =====================================================================
//
// Phase 5 D-08 informational-cascade pattern: NO cascade-hash, NO
// confirmation token, NO requireConfirm gate. cascades.widgets.count
// surfaces informationally so the agent knows the blast radius before
// applying.
//
// Why a leaf delete: a Dashboard's bound Search entity becomes orphan on
// delete (Graylog leaves the Search row in the database); widgets are
// stored INLINE in the ViewDTO so they vanish with the view. Nothing
// downstream is severed at delete-time.
export const DeleteDashboardSchema = mutatingBase.extend({
    dashboardId: z.string().min(1, "dashboardId required"),
});

// =====================================================================
// DASH-07 — remove_widget (symmetric 2-step PUT chain)
// =====================================================================
//
// Removes a widget from a dashboard by orchestrating a 2-step PUT chain:
//   step 1: PUT /api/views/search/{searchId}  (strip the widget's
//           search_types from Search.queries[0].search_types)
//   step 2: PUT /api/views/{dashboardId}      (strip widget + position +
//           widget_mapping entry from the ViewDTO state)
//
// D-03 widget-position-integrity validator runs on the PROSPECTIVE
// post-remove sets BEFORE wire emission. If removing the widget would
// leave the View in an invalid (orphan-position) state, the wrapper
// refuses with `widget_position_integrity_violation` and NO PUT fires.
//
// widgetId not present in current ViewDTO → `widget_not_found` refusal
// (build-time pre-flight check; no HTTP rounds-trip beyond the GETs).
export const RemoveWidgetSchema = mutatingBase.extend({
    dashboardId: z.string().min(1, "dashboardId required"),
    widgetId: z.string().min(1, "widgetId required"),
});
