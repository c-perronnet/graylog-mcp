import { test, describe } from "node:test";
import assert from "node:assert/strict";
import "../snapshot-config.js";
import {
    buildTimeHistogram,
    buildTimeHistogramChart,
    buildSimpleTimeHistogram,
    buildFieldTimeAggregation,
    buildSimpleFieldTimeAggregation,
} from "../../src/aggregations.js";
import { buildTimeRange } from "../../src/timerange.js";

const timeRange = buildTimeRange({ range: "1h" });
const queryString = "level:3";

describe("Histogram approaches", () => {
    test("buildTimeHistogramChart payload created", () => {
        const histogram = buildTimeHistogramChart(timeRange, "5m", queryString);
        assert.ok(histogram.queries[0].search_types[0].type);
        assert.ok(histogram.queries[0].search_types[0].interval !== undefined);
    });

    test("buildSimpleTimeHistogram (simple pivot) payload created", () => {
        const histogram = buildSimpleTimeHistogram(timeRange, "5m", queryString);
        assert.equal(histogram.queries[0].search_types[0].type, "pivot");
        assert.ok(histogram.queries[0].search_types[0].row_groups.length >= 1);
    });

    test("buildTimeHistogram (complex pivot) payload created", () => {
        const histogram = buildTimeHistogram(timeRange, "5m", queryString);
        assert.equal(histogram.queries[0].search_types[0].type, "pivot");
        assert.ok(histogram.queries[0].search_types[0].row_groups[0].interval.type);
    });
});

describe("Field-time approaches", () => {
    test("buildSimpleFieldTimeAggregation payload created", () => {
        const fieldTime = buildSimpleFieldTimeAggregation(timeRange, "env", "5m", queryString, 10);
        assert.ok(fieldTime.queries[0].search_types[0].row_groups.length >= 2);
        assert.ok(fieldTime.queries[0].search_types[0].row_groups[1].interval !== undefined);
    });

    test("buildFieldTimeAggregation payload created", () => {
        const fieldTime = buildFieldTimeAggregation(timeRange, "env", "5m", queryString, 10);
        assert.ok(fieldTime.queries[0].search_types[0].row_groups.length >= 2);
        assert.ok(fieldTime.queries[0].search_types[0].row_groups[1].interval.type);
    });
});

describe("Payload structure comparison", () => {
    const workingFieldAgg = {
        type: "pivot",
        row_groups: [{ type: "values", field: "source", limit: 10 }],
        series: [{ type: "count", id: "count" }],
        sort: [{ type: "series", field: "count", direction: "DESC" }],
    };

    const fixedHistogram = buildSimpleTimeHistogram(timeRange, "5m", queryString)
        .queries[0].search_types[0];

    test("working field aggregation structure has expected pivot shape", () => {
        assert.equal(workingFieldAgg.row_groups[0].type, "values");
        assert.equal(workingFieldAgg.sort[0].type, "series");
    });

    test("fixed histogram structure mirrors pivot shape", () => {
        assert.equal(fixedHistogram.row_groups[0].type, "time");
        assert.equal(fixedHistogram.series[0].type, "count");
    });
});
