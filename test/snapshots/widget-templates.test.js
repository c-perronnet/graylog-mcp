// Plan 06-06 Task 1 (Step B) — 8 widget-template snapshot fixtures.
//
// Each fixture pins one builder's emitted triplet shape with deterministic
// widgetId + searchTypeId so the snapshot file is byte-stable across runs.
// Coverage matrix (per 06-06-PLAN.md fixtures 10..16 plus top_error_clusters
// for symmetry):
//
//   F10 error_rate_over_time      — bar viz; level:>=4 query; auto interval
//   F11 top_sources_by_volume     — table viz; values bucket on source; limit 15
//   F12 level_distribution        — pie viz; skip_empty_values:false
//   F13 top_error_clusters        — TextWidget placeholder (searchType:null)
//   F14 recent_events_table       — messages widget; MessageListConfigDTO shape
//   F15 request_rate_over_time    — line viz; configurable queryString
//   F16 field_value_distribution  — generic values bucket on agent-supplied field
//   F17 stream_activity_overview  — 2-bucket pivot (time × streams); stacked area
//
// Determinism contract: two consecutive `node --test` runs must produce
// byte-identical md5sums of test/snapshots/__snapshots__/widget-templates.test.js.snapshot.
// IDs are passed in explicitly so randomUUID() is never invoked.

import { test } from "node:test";
import assert from "node:assert/strict";
import "../snapshot-config.js";

import { buildErrorRateOverTime } from "../../src/widget-templates/error-rate-over-time.js";
import { buildTopSourcesByVolume } from "../../src/widget-templates/top-sources-by-volume.js";
import { buildLevelDistribution } from "../../src/widget-templates/level-distribution.js";
import { buildTopErrorClusters } from "../../src/widget-templates/top-error-clusters.js";
import { buildRecentEventsTable } from "../../src/widget-templates/recent-events-table.js";
import { buildRequestRateOverTime } from "../../src/widget-templates/request-rate-over-time.js";
import { buildFieldValueDistribution } from "../../src/widget-templates/field-value-distribution.js";
import { buildStreamActivityOverview } from "../../src/widget-templates/stream-activity-overview.js";

// =====================================================================
// F10 — error_rate_over_time builder snapshot
// =====================================================================

test("snapshot: error_rate_over_time builder emits bar-viz pivot with level:>=4 query (DASH-08 F10)", (t) => {
    const triplet = buildErrorRateOverTime({
        streamIds: ["s-1"],
        widgetId: "w-fixed-error-rate",
        searchTypeId: "st-fixed-error-rate",
    });
    assert.equal(triplet.widget.type, "aggregation");
    assert.equal(triplet.widget.config.visualization, "bar");
    assert.equal(triplet.searchType.query.query_string, "level:>=4");
    // D-05: per-widget timerange ABSENT by default.
    assert.equal(Object.prototype.hasOwnProperty.call(triplet.widget, "timerange"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(triplet.searchType, "timerange"), false);
    t.assert.snapshot(triplet);
});

// =====================================================================
// F11 — top_sources_by_volume builder snapshot
// =====================================================================

test("snapshot: top_sources_by_volume builder emits table-viz values-bucket on source (DASH-08 F11)", (t) => {
    const triplet = buildTopSourcesByVolume({
        streamIds: ["s-1"],
        widgetId: "w-fixed-top-sources",
        searchTypeId: "st-fixed-top-sources",
    });
    assert.equal(triplet.widget.config.visualization, "table");
    assert.equal(triplet.searchType.row_groups[0].fields[0], "source");
    assert.equal(triplet.searchType.row_groups[0].limit, 15);
    t.assert.snapshot(triplet);
});

// =====================================================================
// F12 — level_distribution builder snapshot
// =====================================================================

test("snapshot: level_distribution builder emits pie-viz with skip_empty_values:false (DASH-08 F12)", (t) => {
    const triplet = buildLevelDistribution({
        streamIds: ["s-1"],
        widgetId: "w-fixed-level-dist",
        searchTypeId: "st-fixed-level-dist",
    });
    assert.equal(triplet.widget.config.visualization, "pie");
    // skip_empty_values:false — empty-level messages render as their own slice.
    assert.equal(triplet.searchType.row_groups[0].skip_empty_values, false);
    t.assert.snapshot(triplet);
});

// =====================================================================
// F13 — top_error_clusters builder snapshot (Q3 TEXT_WIDGET_PLACEHOLDER)
// =====================================================================

test("snapshot: top_error_clusters builder emits TextWidget placeholder with searchType:null (DASH-08 F13)", (t) => {
    const triplet = buildTopErrorClusters({
        streamIds: ["s-1"],
        widgetId: "w-fixed-clusters",
    });
    assert.equal(triplet.widget.type, "text");
    // Q3 TEXT_WIDGET_PLACEHOLDER: NO Graylog SearchType (agent populates body).
    assert.equal(triplet.searchType, null);
    assert.match(triplet.widget.config.text, /placeholder/);
    t.assert.snapshot(triplet);
});

// =====================================================================
// F14 — recent_events_table builder snapshot (MessageList shape)
// =====================================================================

test("snapshot: recent_events_table builder emits MessageList shape (DASH-08 F14)", (t) => {
    const triplet = buildRecentEventsTable({
        streamIds: ["s-1"],
        widgetId: "w-fixed-recent",
        searchTypeId: "st-fixed-recent",
    });
    // MessageList shape: NOT aggregation; MessageListConfigDTO instead of
    // row_pivots/column_pivots/series/visualization.
    assert.equal(triplet.widget.type, "messages");
    assert.equal(triplet.searchType.type, "messages");
    assert.deepEqual(triplet.widget.config.fields, ["timestamp", "source", "level", "message"]);
    assert.equal(triplet.widget.config.show_message_row, true);
    t.assert.snapshot(triplet);
});

// =====================================================================
// F15 — request_rate_over_time builder snapshot
// =====================================================================

test("snapshot: request_rate_over_time builder emits line-viz time-bucket (DASH-08 F15)", (t) => {
    const triplet = buildRequestRateOverTime({
        streamIds: ["s-1"],
        widgetId: "w-fixed-request-rate",
        searchTypeId: "st-fixed-request-rate",
        queryString: "http_method:GET",
    });
    assert.equal(triplet.widget.config.visualization, "line");
    assert.equal(triplet.searchType.query.query_string, "http_method:GET");
    assert.match(triplet.widget.description, /http_method:GET/);
    t.assert.snapshot(triplet);
});

// =====================================================================
// F16 — field_value_distribution builder snapshot (agent-supplied field)
// =====================================================================

test("snapshot: field_value_distribution builder emits values-bucket on agent-supplied field (DASH-08 F16)", (t) => {
    const triplet = buildFieldValueDistribution({
        streamIds: ["s-1"],
        widgetId: "w-fixed-fvd",
        searchTypeId: "st-fixed-fvd",
        field: "http_status",
    });
    assert.deepEqual(triplet.searchType.row_groups[0].fields, ["http_status"]);
    assert.deepEqual(triplet.widget.config.row_pivots[0].fields, ["http_status"]);
    assert.match(triplet.widget.description, /http_status/);
    t.assert.snapshot(triplet);
});

// =====================================================================
// F17 — stream_activity_overview builder snapshot (2-bucket pivot)
// =====================================================================

test("snapshot: stream_activity_overview builder emits 2-bucket pivot (time × streams) area-viz (DASH-08 F17)", (t) => {
    const triplet = buildStreamActivityOverview({
        streamIds: ["s-1", "s-2"],
        widgetId: "w-fixed-stream-activity",
        searchTypeId: "st-fixed-stream-activity",
    });
    assert.equal(triplet.widget.config.visualization, "area");
    assert.equal(triplet.searchType.row_groups.length, 2);
    assert.equal(triplet.searchType.row_groups[0].type, "time");
    assert.equal(triplet.searchType.row_groups[1].type, "values");
    assert.deepEqual(triplet.searchType.row_groups[1].fields, ["streams"]);
    t.assert.snapshot(triplet);
});
