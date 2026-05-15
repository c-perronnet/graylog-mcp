import { test, describe } from "node:test";
import assert from "node:assert/strict";
import "../snapshot-config.js";
import {
    parseRelativeTime,
    parseAbsoluteTime,
    buildTimeRange,
    normalizeTimeRangeArgs,
} from "../../src/timerange.js";
import {
    buildTimeHistogram,
    buildFieldAggregation,
    buildFieldTimeAggregation,
} from "../../src/aggregations.js";

describe("Time range parsing", () => {
    test("parseRelativeTime('1h') returns 3600", () => {
        assert.equal(parseRelativeTime("1h"), 3600);
    });

    test("parseRelativeTime('30m') returns 1800", () => {
        assert.equal(parseRelativeTime("30m"), 1800);
    });

    test("parseRelativeTime('2d') returns 172800", () => {
        assert.equal(parseRelativeTime("2d"), 172800);
    });

    test("parseAbsoluteTime accepts an ISO string", () => {
        const now = new Date().toISOString();
        // Just ensure it returns a defined value without throwing.
        const result = parseAbsoluteTime(now);
        assert.ok(result !== undefined && result !== null);
    });

    test("buildTimeRange with { range: '1h' } returns a relative range", () => {
        const relativeRange = buildTimeRange({ range: "1h" });
        assert.ok(relativeRange);
        assert.equal(relativeRange.type, "relative");
    });

    test("buildTimeRange with from/to returns an absolute range", () => {
        const absoluteRange = buildTimeRange({
            from: new Date(Date.now() - 3600000).toISOString(),
            to: new Date().toISOString(),
        });
        assert.ok(absoluteRange);
        assert.equal(absoluteRange.type, "absolute");
    });
});

describe("Aggregation payloads", () => {
    const timeRange = { type: "relative", range: 3600 };
    const queryString = "level:3";

    test("buildTimeHistogram payload created", () => {
        const histogram = buildTimeHistogram(timeRange, "auto", queryString);
        assert.ok(histogram.queries[0].id);
        assert.equal(histogram.queries[0].search_types[0].type, "pivot");
    });

    test("buildFieldAggregation payload created", () => {
        const fieldAgg = buildFieldAggregation(timeRange, "source", queryString, 10, ["count"], null);
        assert.equal(fieldAgg.queries[0].search_types[0].row_groups[0].field, "source");
    });

    test("buildFieldTimeAggregation payload created", () => {
        const fieldTimeAgg = buildFieldTimeAggregation(timeRange, "env", "auto", queryString, 5);
        assert.ok(fieldTimeAgg.queries[0].search_types[0].row_groups.length >= 1);
    });
});

describe("Error handling", () => {
    test("rejects invalid time format", () => {
        assert.throws(() => parseRelativeTime("invalid"));
    });

    test("rejects negative time", () => {
        assert.throws(() => parseRelativeTime(-100));
    });

    test("rejects absolute range where to is before from", () => {
        assert.throws(() =>
            buildTimeRange({
                from: new Date().toISOString(),
                to: new Date(Date.now() - 3600000).toISOString(),
            })
        );
    });
});

describe("Argument normalization", () => {
    test("normalizeTimeRangeArgs accepts timeRange", () => {
        const result = normalizeTimeRangeArgs({ timeRange: "2h" });
        assert.ok(result.timeRange);
    });

    test("normalizeTimeRangeArgs accepts absolute from/to", () => {
        const result = normalizeTimeRangeArgs({
            from: new Date(Date.now() - 7200000).toISOString(),
            to: new Date().toISOString(),
        });
        assert.ok(result.timeRange);
    });

    test("normalizeTimeRangeArgs supports DEPRECATED searchTimeRangeInSeconds (backward compatibility)", () => {
        const result = normalizeTimeRangeArgs({ searchTimeRangeInSeconds: 1800 });
        assert.ok(result.timeRange);
    });
});
