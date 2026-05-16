// Regression net for the widget-template interval-shape bug (260516-mcf).
//
// The three time-series widget builders previously emitted a Graylog pivot
// time-bucket `interval` as `{type:"timeunit", value:N, unit:U}`. Graylog 7.x's
// Interval model rejects that shape ("Unable to map property value. Known
// properties include: timeunit, type"), breaking create_app_health_dashboard
// and every time-series widget at the create_search step.
//
// Graylog 7.x Interval has exactly two valid shapes:
//   AUTO:     { type: "auto" }
//   TIMEUNIT: { type: "timeunit", timeunit: "<N><letter>" }  letter in s|m|h|d
//
// The interval object appears TWICE per builder — once in
// searchType.row_groups[].interval and once in
// widget.config.row_pivots[].config.interval — so every assertion below covers
// BOTH sites.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildErrorRateOverTime } from "../../src/widget-templates/error-rate-over-time.js";
import { buildRequestRateOverTime } from "../../src/widget-templates/request-rate-over-time.js";
import { buildStreamActivityOverview } from "../../src/widget-templates/stream-activity-overview.js";

// Assert one interval object is a Graylog-valid Interval: no legacy value/unit
// keys, and a recognized `type` (auto, or timeunit with a non-empty keyword).
function assertValidInterval(interval, label) {
    assert.equal(
        Object.prototype.hasOwnProperty.call(interval, "value"),
        false,
        `${label}: interval must not carry a 'value' key`
    );
    assert.equal(
        Object.prototype.hasOwnProperty.call(interval, "unit"),
        false,
        `${label}: interval must not carry a 'unit' key`
    );
    if (interval.type === "auto") {
        return;
    }
    assert.equal(interval.type, "timeunit", `${label}: type must be 'auto' or 'timeunit'`);
    assert.equal(
        typeof interval.timeunit,
        "string",
        `${label}: timeunit interval must carry a string 'timeunit' keyword`
    );
    assert.ok(interval.timeunit.length > 0, `${label}: timeunit keyword must be non-empty`);
}

// Pull both interval sites out of a builder triplet.
function intervalSites(triplet) {
    return {
        pivot: triplet.searchType.row_groups[0].interval,
        config: triplet.widget.config.row_pivots[0].config.interval,
    };
}

test("error_rate_over_time emits a valid auto interval at both sites", () => {
    const { pivot, config } = intervalSites(buildErrorRateOverTime({}));
    assertValidInterval(pivot, "error_rate searchType pivot");
    assertValidInterval(config, "error_rate widget config");
    assert.equal(pivot.type, "auto");
    assert.equal(config.type, "auto");
});

test("request_rate_over_time emits a valid auto interval at both sites", () => {
    const { pivot, config } = intervalSites(buildRequestRateOverTime({}));
    assertValidInterval(pivot, "request_rate searchType pivot");
    assertValidInterval(config, "request_rate widget config");
    assert.equal(pivot.type, "auto");
    assert.equal(config.type, "auto");
});

test("stream_activity_overview emits a valid timeunit interval at both sites", () => {
    const { pivot, config } = intervalSites(buildStreamActivityOverview({}));
    assertValidInterval(pivot, "stream_activity searchType pivot");
    assertValidInterval(config, "stream_activity widget config");
    assert.equal(pivot.type, "timeunit");
    assert.equal(config.type, "timeunit");
});

test("stream_activity_overview default interval maps to '5m'", () => {
    const { pivot, config } = intervalSites(buildStreamActivityOverview({}));
    assert.equal(pivot.timeunit, "5m");
    assert.equal(config.timeunit, "5m");
});

test("stream_activity_overview maps a non-default unit (hours -> 'h')", () => {
    const { pivot, config } = intervalSites(
        buildStreamActivityOverview({ intervalUnit: "hours", intervalValue: 3 })
    );
    assert.equal(pivot.timeunit, "3h");
    assert.equal(config.timeunit, "3h");
});

test("stream_activity_overview maps seconds and days unit letters", () => {
    assert.equal(
        buildStreamActivityOverview({ intervalUnit: "seconds", intervalValue: 30 })
            .searchType.row_groups[0].interval.timeunit,
        "30s"
    );
    assert.equal(
        buildStreamActivityOverview({ intervalUnit: "days", intervalValue: 1 })
            .searchType.row_groups[0].interval.timeunit,
        "1d"
    );
});

test("stream_activity_overview throws on an unknown intervalUnit", () => {
    assert.throws(
        () => buildStreamActivityOverview({ intervalUnit: "fortnights", intervalValue: 1 }),
        /Unknown interval unit: fortnights/
    );
});
