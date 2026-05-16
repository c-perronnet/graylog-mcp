import { test } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";
import { validateWidgetPositionIntegrity } from "../src/tools/_shared/widget-position-integrity.js";

// Plan 06-01 Task 2 — D-03 widget-position integrity validator.
// Bidirectional strict equality between widgets[].id and Object.keys(widgetPositions).
// Tightens Graylog's server-side superset-only check (ViewsResource.java:371-378).

test("valid matched widgets + positions → no throw", () => {
    const widgets = [{ id: "w1" }];
    const widgetPositions = { w1: { col: 1, row: 1, height: 1, width: 1 } };
    const result = validateWidgetPositionIntegrity(widgets, widgetPositions);
    assert.equal(result, undefined);
});

test("widget missing position throws with reason widget_position_integrity_violation", () => {
    const widgets = [{ id: "w1" }, { id: "w2" }];
    const widgetPositions = { w1: { col: 1, row: 1, height: 1, width: 1 } };

    let caught;
    try {
        validateWidgetPositionIntegrity(widgets, widgetPositions);
        assert.fail("expected throw");
    } catch (err) {
        caught = err;
    }
    assert.equal(caught.reason, "widget_position_integrity_violation");
    assert.equal(caught.isClientSide, true);
    assert.match(caught.message, /missing positions \[w2\]/);
});

test("position missing widget throws bidirectional", () => {
    const widgets = [{ id: "w1" }];
    const widgetPositions = {
        w1: { col: 1, row: 1, height: 1, width: 1 },
        w2: { col: 2, row: 2, height: 2, width: 2 },
    };

    let caught;
    try {
        validateWidgetPositionIntegrity(widgets, widgetPositions);
        assert.fail("expected throw");
    } catch (err) {
        caught = err;
    }
    assert.equal(caught.reason, "widget_position_integrity_violation");
    assert.match(caught.message, /missing widgets \[w2\]/);
});

test("empty inputs → no throw", () => {
    const result = validateWidgetPositionIntegrity([], {});
    assert.equal(result, undefined);
});
