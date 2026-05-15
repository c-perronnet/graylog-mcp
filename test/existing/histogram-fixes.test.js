import { test, describe } from "node:test";
import assert from "node:assert/strict";
import "../snapshot-config.js";
import {
    buildWorkingHistogram,
    buildSimpleFieldTimeAggregation,
} from "../../src/aggregations.js";
import { buildTimeRange } from "../../src/timerange.js";

const timeRange = buildTimeRange({ range: "1h" });
const queryString = "level:3";

const fieldTime = buildSimpleFieldTimeAggregation(timeRange, "env", "5m", queryString, 10);
const workingHistogram = buildWorkingHistogram(timeRange, "5m", queryString);

const fieldTimeStructure = fieldTime.queries[0].search_types[0];
const histogramStructure = workingHistogram.queries[0].search_types[0];

describe("Working field-time structure (baseline)", () => {
    test("type is pivot", () => {
        assert.equal(fieldTimeStructure.type, "pivot");
    });

    test("has two row_groups (values + time)", () => {
        assert.equal(fieldTimeStructure.row_groups.length, 2);
    });

    test("time row_group has an interval", () => {
        assert.ok(fieldTimeStructure.row_groups[1].interval !== undefined);
    });

    test("series is count", () => {
        assert.equal(fieldTimeStructure.series[0].type, "count");
    });
});

describe("buildWorkingHistogram structure", () => {
    test("type is pivot", () => {
        assert.equal(histogramStructure.type, "pivot");
    });

    test("has one row_group (time only)", () => {
        assert.equal(histogramStructure.row_groups.length, 1);
    });

    test("time row_group has an interval", () => {
        assert.ok(histogramStructure.row_groups[0].interval !== undefined);
    });

    test("series is count", () => {
        assert.equal(histogramStructure.series[0].type, "count");
    });
});

describe("Working histogram mirrors field-time pattern", () => {
    test("type matches", () => {
        assert.equal(fieldTimeStructure.type, histogramStructure.type);
    });

    test("series count matches", () => {
        assert.equal(fieldTimeStructure.series.length, histogramStructure.series.length);
    });

    test("series type matches", () => {
        assert.equal(fieldTimeStructure.series[0].type, histogramStructure.series[0].type);
    });

    test("rollup matches", () => {
        assert.equal(fieldTimeStructure.rollup, histogramStructure.rollup);
    });

    test("time interval shape matches", () => {
        assert.deepEqual(
            fieldTimeStructure.row_groups[1].interval,
            histogramStructure.row_groups[0].interval
        );
    });
});
