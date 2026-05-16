// Quick task 260516-mt4 — regression tests pinning the 5 corrected
// dashboard/widget payload shapes (MT4-BUG3..7).
//
// Each test re-introducing a fixed bug must fail a discrete assertion here.
// Plain node:test assertions — NO t.assert.snapshot (snapshot regeneration
// is handled by widget-templates/dashboards/blueprints .test.js separately).
//
// Bug map:
//   BUG3 — pivot/series sort entries keyed `field`, never `id`.
//   BUG4 — buildSearchDTO emits snake_case skip_no_streams_check.
//   BUG5 — recent-events widget config.sort uses {type,direction}; the
//          messages search_type sort stays {field,order}.
//   BUG6 — every emitted position.col is an integer.
//   BUG7 — buildViewDTO view-state carries no display_mode_settings block.

import { test } from "node:test";
import assert from "node:assert/strict";

import { WIDGET_TEMPLATES } from "../../src/widget-templates/index.js";
import { buildSearchDTO, buildViewDTO } from "../../src/services/dashboards.js";
import { buildRecentEventsTable } from "../../src/widget-templates/recent-events-table.js";

// Minimal options per builder — covers each builder's required option.
// field_value_distribution throws without a string `field`; all others
// accept an empty options object.
const BUILDER_OPTIONS = {
    field_value_distribution: { field: "http_status" },
};

function buildAll() {
    return Object.entries(WIDGET_TEMPLATES).map(([name, builder]) => [
        name,
        builder(BUILDER_OPTIONS[name] ?? {}),
    ]);
}

// =====================================================================
// (a) BUG3 — no sort entry anywhere carries `id`; every sort entry has `field`
// =====================================================================

test("MT4-BUG3: no searchType.sort / widget.config.sort entry uses `id`; all use `field`", () => {
    for (const [name, triplet] of buildAll()) {
        const sorts = [];
        if (triplet.searchType && Array.isArray(triplet.searchType.sort)) {
            sorts.push(...triplet.searchType.sort);
        }
        if (
            triplet.widget &&
            triplet.widget.config &&
            Array.isArray(triplet.widget.config.sort)
        ) {
            sorts.push(...triplet.widget.config.sort);
        }
        for (const entry of sorts) {
            assert.equal(
                Object.prototype.hasOwnProperty.call(entry, "id"),
                false,
                `${name}: sort entry must not carry an \`id\` key`,
            );
            assert.equal(
                Object.prototype.hasOwnProperty.call(entry, "field"),
                true,
                `${name}: sort entry must carry a \`field\` key`,
            );
        }
    }
});

// =====================================================================
// (b) BUG4 — buildSearchDTO emits skip_no_streams_check (snake_case)
// =====================================================================

test("MT4-BUG4: buildSearchDTO emits skip_no_streams_check, not skipNoStreamsCheck", () => {
    const dto = buildSearchDTO({ queryId: "q", widgets: [], timerange: {} });
    assert.equal(
        Object.prototype.hasOwnProperty.call(dto, "skip_no_streams_check"),
        true,
        "SearchDTO must own-property skip_no_streams_check",
    );
    assert.equal(
        Object.prototype.hasOwnProperty.call(dto, "skipNoStreamsCheck"),
        false,
        "SearchDTO must NOT carry camelCase skipNoStreamsCheck",
    );
});

// =====================================================================
// (c) BUG5 — recent-events widget config.sort discriminated; search_type
//            sort stays {field, order}
// =====================================================================

test("MT4-BUG5: recent_events widget config.sort has type+direction; search_type sort stays {field,order}", () => {
    const triplet = buildRecentEventsTable({});
    const widgetSort = triplet.widget.config.sort[0];
    assert.equal(
        Object.prototype.hasOwnProperty.call(widgetSort, "type"),
        true,
        "widget config.sort entry must carry `type`",
    );
    assert.equal(
        Object.prototype.hasOwnProperty.call(widgetSort, "direction"),
        true,
        "widget config.sort entry must carry `direction`",
    );

    const searchTypeSort = triplet.searchType.sort[0];
    assert.equal(
        Object.prototype.hasOwnProperty.call(searchTypeSort, "field"),
        true,
        "search_type sort entry must carry `field`",
    );
    assert.equal(
        Object.prototype.hasOwnProperty.call(searchTypeSort, "order"),
        true,
        "search_type sort entry must carry `order`",
    );
    assert.equal(
        Object.prototype.hasOwnProperty.call(searchTypeSort, "type"),
        false,
        "messages search_type sort must NOT carry a `type` discriminator",
    );
});

// =====================================================================
// (d) BUG6 — every emitted position.col is an integer
// =====================================================================

test("MT4-BUG6: every builder emits an integer position.col", () => {
    for (const [name, triplet] of buildAll()) {
        assert.equal(
            Number.isInteger(triplet.position.col),
            true,
            `${name}: position.col must be an integer (no {type:'infinity'} object)`,
        );
    }
});

// =====================================================================
// (e) BUG7 — buildViewDTO view-state has no display_mode_settings block
// =====================================================================

test("MT4-BUG7: buildViewDTO state[queryId] has no display_mode_settings", () => {
    const dto = buildViewDTO({
        title: "t",
        searchId: "x",
        queryId: "q",
        widgets: [],
    });
    assert.equal(
        Object.prototype.hasOwnProperty.call(dto.state.q, "display_mode_settings"),
        false,
        "view-state must NOT carry a display_mode_settings block",
    );
});
