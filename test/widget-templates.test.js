// Plan 06-03 Task 1 — Widget-template builders + WIDGET_TEMPLATES frozen map.
//
// Pins:
//   - Per-template shapes (8 builders × per-template assertions; RESEARCH §"Template N")
//   - Cross-cutting D-04 contract: every builder returns Object.freeze({widget, position, searchType})
//   - D-05 inherit-from-dashboard timerange default — per-widget timerange ABSENT unless override
//   - Pitfall 7 — streams always emitted as ARRAY, never bare string
//   - Q3 TEXT_WIDGET_PLACEHOLDER — top_error_clusters returns searchType:null + text widget
//   - WIDGET_TEMPLATES frozen map: exactly 8 entries matching TEMPLATE_NAMES; map itself frozen
//
// Mirrors test/widget-position-integrity.test.js (pure-function unit tests; no
// HTTP, no _testConnection, no mocks).

import { test } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";

import {
    TEMPLATE_NAMES,
    WIDGET_TEMPLATES,
} from "../src/widget-templates/index.js";

import { buildErrorRateOverTime } from "../src/widget-templates/error-rate-over-time.js";
import { buildTopSourcesByVolume } from "../src/widget-templates/top-sources-by-volume.js";
import { buildLevelDistribution } from "../src/widget-templates/level-distribution.js";
import { buildTopErrorClusters } from "../src/widget-templates/top-error-clusters.js";
import { buildRequestRateOverTime } from "../src/widget-templates/request-rate-over-time.js";
import { buildFieldValueDistribution } from "../src/widget-templates/field-value-distribution.js";
import { buildRecentEventsTable } from "../src/widget-templates/recent-events-table.js";
import { buildStreamActivityOverview } from "../src/widget-templates/stream-activity-overview.js";

// =====================================================================
// Per-template shape assertions (Tests 1-8)
// =====================================================================

// Test 1 — error_rate_over_time
test("error_rate_over_time emits aggregation widget with level:>=4 query + count series + frozen triplet", () => {
    const result = buildErrorRateOverTime({
        streamIds: ["s1"],
        widgetId: "w-fixed",
        searchTypeId: "st-fixed",
    });
    assert.equal(result.widget.type, "aggregation");
    assert.equal(result.widget.query.query_string, "level:>=4");
    assert.equal(result.widget.id, "w-fixed");
    assert.equal(result.searchType.id, "st-fixed");
    assert.equal(result.searchType.type, "pivot");
    assert.equal(result.searchType.series[0].type, "count");
    // RESEARCH §"Template 1" — time-bucket row_group on timestamp
    assert.equal(result.searchType.row_groups[0].type, "time");
    assert.deepEqual(result.searchType.row_groups[0].fields, ["timestamp"]);
    // Frozen at the top level (D-04)
    assert.equal(Object.isFrozen(result), true);
});

// Test 1a — error_rate_over_time honors options.queryString (BUG #8a)
test("error_rate_over_time keeps base level:>=4 when no queryString supplied", () => {
    const result = buildErrorRateOverTime({});
    assert.equal(result.widget.query.query_string, "level:>=4");
    assert.equal(result.searchType.query.query_string, "level:>=4");
});

test("error_rate_over_time AND-combines base filter with options.queryString (BUG #8a)", () => {
    const result = buildErrorRateOverTime({ queryString: "service:api" });
    assert.equal(result.widget.query.query_string, "(level:>=4) AND (service:api)");
    assert.equal(result.searchType.query.query_string, "(level:>=4) AND (service:api)");
});

test("error_rate_over_time treats empty queryString as absent (no () AND () wrap)", () => {
    const result = buildErrorRateOverTime({ queryString: "" });
    assert.equal(result.widget.query.query_string, "level:>=4");
    assert.equal(result.searchType.query.query_string, "level:>=4");
});

// Test 2 — top_sources_by_volume
test("top_sources_by_volume emits values-bucket pivot on 'source' field + table visualization + sort desc", () => {
    const result = buildTopSourcesByVolume({ limit: 20 });
    assert.equal(result.widget.type, "aggregation");
    assert.equal(result.searchType.type, "pivot");
    // values bucket on `source`
    assert.equal(result.searchType.row_groups[0].type, "values");
    assert.deepEqual(result.searchType.row_groups[0].fields, ["source"]);
    assert.equal(result.searchType.row_groups[0].limit, 20);
    // table visualization
    assert.equal(result.widget.config.visualization, "table");
    // sort by count desc on the SearchType
    assert.ok(Array.isArray(result.searchType.sort));
    assert.equal(result.searchType.sort[0].direction, "Descending");
});

// Test 3 — level_distribution
test("level_distribution emits values-bucket on 'level' + pie visualization", () => {
    const result = buildLevelDistribution();
    assert.equal(result.searchType.row_groups[0].type, "values");
    assert.deepEqual(result.searchType.row_groups[0].fields, ["level"]);
    assert.equal(result.widget.config.visualization, "pie");
});

// Test 4 — top_error_clusters (Q3 TEXT_WIDGET_PLACEHOLDER)
test("top_error_clusters returns searchType:null + text-widget type (Q3 default TEXT_WIDGET_PLACEHOLDER)", () => {
    const result = buildTopErrorClusters({ clusterCount: 10 });
    // Q3 default: searchType is null — no Graylog SearchType is invented
    assert.equal(result.searchType, null);
    // text-widget discriminator (Graylog's TextWidgetConfigDTO)
    assert.equal(result.widget.type, "text");
    // Frozen triplet still emitted
    assert.equal(Object.isFrozen(result), true);
});

// Test 5 — request_rate_over_time
test("request_rate_over_time emits line visualization + agent-supplied queryString", () => {
    const result = buildRequestRateOverTime({ queryString: "http_status:200" });
    assert.equal(result.widget.query.query_string, "http_status:200");
    assert.equal(result.widget.config.visualization, "line");
    // Same time-bucket shape as Template 1
    assert.equal(result.searchType.row_groups[0].type, "time");
});

// Test 6 — field_value_distribution requires field
test("field_value_distribution throws when options.field absent", () => {
    assert.throws(
        () => buildFieldValueDistribution({}),
        /field option required for field_value_distribution/,
    );
});

// Test 7 — recent_events_table (MessageList)
test("recent_events_table emits widget.type === 'messages' + MessageListConfigDTO fields list", () => {
    const result = buildRecentEventsTable();
    assert.equal(result.widget.type, "messages");
    assert.equal(result.searchType.type, "messages");
    // MessageListConfigDTO carries `fields` (Plan-action Step G)
    assert.deepEqual(
        result.widget.config.fields,
        ["timestamp", "source", "level", "message"],
    );
    // sort by timestamp descending (most-recent first). MT4-BUG5: the WIDGET
    // config.sort uses the SortConfigDTO discriminated shape {type,field,direction}.
    assert.equal(result.widget.config.sort[0].type, "pivot");
    assert.equal(result.widget.config.sort[0].field, "timestamp");
    assert.equal(result.widget.config.sort[0].direction, "Descending");
    // the messages search_type sort stays {field, order}
    assert.equal(result.searchType.sort[0].field, "timestamp");
    assert.equal(result.searchType.sort[0].order, "DESC");
});

// Test 8 — stream_activity_overview
test("stream_activity_overview emits two-bucket pivot (time + streams) + area visualization", () => {
    const result = buildStreamActivityOverview();
    assert.equal(result.searchType.row_groups.length, 2);
    assert.equal(result.searchType.row_groups[0].type, "time");
    assert.equal(result.searchType.row_groups[1].type, "values");
    assert.deepEqual(result.searchType.row_groups[1].fields, ["streams"]);
    assert.equal(result.widget.config.visualization, "area");
});

// =====================================================================
// Cross-cutting contracts (Tests 9-18)
// =====================================================================

// Helpers — call each builder with sensible defaults so cross-cutting tests
// can iterate across all 8 templates uniformly.
function callAllBuilders(extraOpts = {}) {
    return {
        error_rate_over_time: buildErrorRateOverTime({ ...extraOpts }),
        top_sources_by_volume: buildTopSourcesByVolume({ ...extraOpts }),
        level_distribution: buildLevelDistribution({ ...extraOpts }),
        top_error_clusters: buildTopErrorClusters({ ...extraOpts }),
        request_rate_over_time: buildRequestRateOverTime({ ...extraOpts }),
        // field_value_distribution requires `field` — supply a default for
        // the cross-cutting iteration
        field_value_distribution: buildFieldValueDistribution({ field: "http_status", ...extraOpts }),
        recent_events_table: buildRecentEventsTable({ ...extraOpts }),
        stream_activity_overview: buildStreamActivityOverview({ ...extraOpts }),
    };
}

// Test 9 — D-05 inherit-from-dashboard timerange default
test("every builder defaults per-widget timerange to ABSENT (D-05 inherit-from-dashboard)", () => {
    const all = callAllBuilders();
    for (const [name, result] of Object.entries(all)) {
        assert.equal(
            Object.prototype.hasOwnProperty.call(result.widget, "timerange"),
            false,
            `${name}: widget MUST omit timerange by default (D-05 inherit)`,
        );
        if (result.searchType) {
            assert.equal(
                Object.prototype.hasOwnProperty.call(result.searchType, "timerange"),
                false,
                `${name}: searchType MUST omit timerange by default (D-05 inherit)`,
            );
        }
    }
});

// Test 10 — Pitfall 7: streams always emitted as ARRAY
test("every builder emits widget.streams as JSON array even with empty streamIds (Pitfall 7)", () => {
    const all = callAllBuilders({ streamIds: [] });
    for (const [name, result] of Object.entries(all)) {
        assert.equal(
            Array.isArray(result.widget.streams),
            true,
            `${name}: widget.streams MUST be an Array (Pitfall 7), got ${typeof result.widget.streams}`,
        );
    }
});

// Test 11 — D-05 timerange override propagation
test("every builder respects timerangeOverride when supplied (D-05)", () => {
    const all = callAllBuilders({ timerangeOverride: { type: "relative", from: 600 } });
    for (const [name, result] of Object.entries(all)) {
        assert.equal(result.widget.timerange?.from, 600, `${name}: widget.timerange must propagate override`);
        if (result.searchType) {
            assert.equal(
                result.searchType.timerange?.from,
                600,
                `${name}: searchType.timerange must propagate override`,
            );
        }
    }
});

// Test 12 — position override propagates verbatim
test("every builder accepts position override", () => {
    const pos = { col: 99, row: 99, height: 99, width: 99 };
    const all = callAllBuilders({ position: pos });
    for (const [name, result] of Object.entries(all)) {
        assert.deepEqual(result.position, pos, `${name}: position override must propagate`);
    }
});

// Test 13 — widgetId override propagates
test("every builder accepts widgetId override", () => {
    const all = callAllBuilders({ widgetId: "fixed-id" });
    for (const [name, result] of Object.entries(all)) {
        assert.equal(result.widget.id, "fixed-id", `${name}: widgetId override must propagate`);
    }
});

// Test 14 — Object.isFrozen on top-level triplet
test("every builder freezes returned triplet at top level (D-04)", () => {
    const all = callAllBuilders();
    for (const [name, result] of Object.entries(all)) {
        assert.equal(Object.isFrozen(result), true, `${name}: triplet MUST be Object.freeze`);
    }
});

// Test 15 — WIDGET_TEMPLATES has exactly 8 entries matching TEMPLATE_NAMES
test("WIDGET_TEMPLATES has exactly 8 entries matching TEMPLATE_NAMES; each is a function", () => {
    assert.equal(Object.keys(WIDGET_TEMPLATES).length, 8);
    for (const name of TEMPLATE_NAMES) {
        assert.equal(typeof WIDGET_TEMPLATES[name], "function", `${name} MUST be a callable builder`);
    }
});

// Test 16 — WIDGET_TEMPLATES is frozen (T-06-03-08 prototype-pollution mitigation)
test("WIDGET_TEMPLATES map is frozen (T-06-03-08 mitigation)", () => {
    assert.equal(Object.isFrozen(WIDGET_TEMPLATES), true);
});

// Test 17 — clusterCount option propagates into text body
test("top_error_clusters with clusterCount:5 propagates into widget.config.text", () => {
    const result = buildTopErrorClusters({ clusterCount: 5 });
    assert.match(result.widget.config.text, /Top 5/);
});

// Test 18 — field option threads through to values-bucket
test("field_value_distribution with field option emits values-bucket on that field", () => {
    const result = buildFieldValueDistribution({ field: "http_status" });
    assert.deepEqual(result.searchType.row_groups[0].fields, ["http_status"]);
});
