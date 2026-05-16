// Widget-position integrity validator (D-03 / Phase 6 / Pitfall 4).
//
// The C7 mitigation centerpiece for dashboard creation. Graylog's server-side
// check in ViewsResource.java:371-378 (Validator.validate(ViewDTO)) is SUPERSET
// ONLY: it accepts a payload where widget_positions ⊇ widgets[].id (positions
// may name widget IDs that don't exist in the widget list — the server happily
// renders the orphan positions as empty cells, AND it rejects only when a
// widget has NO position).
//
// The wrapper tightens this to BIDIRECTIONAL strict equality:
//   widgets.map(w => w.id) === Object.keys(widgetPositions)
// (as Sets — order independence).
//
// Why client-side strict equality:
//   1. Pitfall 4: Orphan widgets (widget without position) render as 0×0 and
//      break the dashboard's render pipeline. We refuse before HTTP.
//   2. D-03: Orphan positions (position without widget) silently expand the
//      dashboard's coordinate grid, often misaligning subsequent agent-driven
//      `add_widget_from_template` calls.
//   3. Defense in depth: Even if Graylog 7.2 tightens the server-side check
//      to bidirectional equality, refusing before HTTP saves a round-trip
//      and surfaces a clearer error message.
//
// Throws Error with:
//   - .reason = "widget_position_integrity_violation"
//   - .isClientSide = true (marks the error as wrapper-emitted, not Graylog
//                          API-emitted — handler.js's wrapGraylogError can
//                          treat it as a structured isError envelope per the
//                          Phase 6 D-07 contract)
//
// Threat-model T-06-01-02 (Tampering): the validator is the only path between
// agent widget input and the HTTP wire — there is no bypass.

/**
 * Validate bidirectional strict equality between widget IDs and position keys.
 *
 * @param {Array<{id: string}>} widgets
 * @param {Record<string, {col: unknown, row: unknown, height: unknown, width: unknown}>} widgetPositions
 * @throws {Error & { reason: "widget_position_integrity_violation", isClientSide: true }}
 */
export function validateWidgetPositionIntegrity(widgets, widgetPositions) {
    const widgetIds = new Set((widgets ?? []).map((w) => w.id));
    const positionIds = new Set(Object.keys(widgetPositions ?? {}));
    const widgetsWithoutPositions = [...widgetIds].filter((id) => !positionIds.has(id));
    const positionsWithoutWidgets = [...positionIds].filter((id) => !widgetIds.has(id));
    if (widgetsWithoutPositions.length || positionsWithoutWidgets.length) {
        const err = new Error(
            `Widget/position integrity violation: `
            + `widgets missing positions [${widgetsWithoutPositions.join(", ")}]; `
            + `positions missing widgets [${positionsWithoutWidgets.join(", ")}]`,
        );
        err.reason = "widget_position_integrity_violation";
        err.isClientSide = true;
        throw err;
    }
}
