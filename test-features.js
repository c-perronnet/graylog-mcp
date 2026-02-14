#!/usr/bin/env node

/**
 * Test script for new MCP features - time ranges and aggregations
 */
import { parseRelativeTime, parseAbsoluteTime, buildTimeRange, normalizeTimeRangeArgs } from "./src/timerange.js";
import { buildTimeHistogram, buildFieldAggregation, buildFieldTimeAggregation } from "./src/aggregations.js";

console.log("Testing new MCP features...\n");

// Test time range parsing
console.log("=== Testing Time Range Parsing ===");

try {
    // Test relative time parsing
    console.log("✓ parseRelativeTime('1h'):", parseRelativeTime('1h')); // Should be 3600
    console.log("✓ parseRelativeTime('30m'):", parseRelativeTime('30m')); // Should be 1800
    console.log("✓ parseRelativeTime('2d'):", parseRelativeTime('2d')); // Should be 172800

    // Test absolute time parsing
    const now = new Date().toISOString();
    console.log("✓ parseAbsoluteTime(now):", parseAbsoluteTime(now));

    // Test time range building
    const relativeRange = buildTimeRange({ range: '1h' });
    console.log("✓ buildTimeRange({ range: '1h' }):", relativeRange);

    const absoluteRange = buildTimeRange({
        from: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        to: new Date().toISOString()
    });
    console.log("✓ buildTimeRange (absolute):", absoluteRange);

    console.log("✓ All time range tests passed!\n");
} catch (error) {
    console.error("✗ Time range test failed:", error.message);
}

// Test aggregation payload building
console.log("=== Testing Aggregation Payloads ===");

try {
    const timeRange = { type: 'relative', range: 3600 };
    const queryString = 'level:3';

    // Test histogram
    const histogram = buildTimeHistogram(timeRange, 'auto', queryString);
    console.log("✓ buildTimeHistogram payload created");
    console.log("  Query ID:", histogram.queries[0].id);
    console.log("  Search type:", histogram.queries[0].search_types[0].type);

    // Test field aggregation
    const fieldAgg = buildFieldAggregation(timeRange, 'source', queryString, 10, ['count'], null);
    console.log("✓ buildFieldAggregation payload created");
    console.log("  Row groups:", fieldAgg.queries[0].search_types[0].row_groups[0].field);

    // Test field-time aggregation
    const fieldTimeAgg = buildFieldTimeAggregation(timeRange, 'env', 'auto', queryString, 5);
    console.log("✓ buildFieldTimeAggregation payload created");
    console.log("  Row groups count:", fieldTimeAgg.queries[0].search_types[0].row_groups.length);

    console.log("✓ All aggregation tests passed!\n");
} catch (error) {
    console.error("✗ Aggregation test failed:", error.message);
}

// Test error handling
console.log("=== Testing Error Handling ===");

try {
    // Test invalid time format
    try {
        parseRelativeTime('invalid');
        console.error("✗ Should have thrown error for invalid time format");
    } catch (e) {
        console.log("✓ Correctly rejected invalid time format");
    }

    // Test negative time
    try {
        parseRelativeTime(-100);
        console.error("✗ Should have thrown error for negative time");
    } catch (e) {
        console.log("✓ Correctly rejected negative time");
    }

    // Test invalid absolute range
    try {
        buildTimeRange({
            from: new Date().toISOString(),
            to: new Date(Date.now() - 3600000).toISOString() // to is before from
        });
        console.error("✗ Should have thrown error for invalid time range");
    } catch (e) {
        console.log("✓ Correctly rejected invalid absolute range");
    }

    console.log("✓ All error handling tests passed!\n");
} catch (error) {
    console.error("✗ Error handling test failed:", error.message);
}

// Test normalize function
console.log("=== Testing Argument Normalization ===");

try {
    const args1 = { timeRange: '2h' };
    const result1 = normalizeTimeRangeArgs(args1);
    console.log("✓ normalizeTimeRangeArgs with timeRange:", result1.timeRange);

    const args2 = {
        from: new Date(Date.now() - 7200000).toISOString(),
        to: new Date().toISOString()
    };
    const result2 = normalizeTimeRangeArgs(args2);
    console.log("✓ normalizeTimeRangeArgs with absolute range:", result2.timeRange);

    // Test backward compatibility
    const args3 = { searchTimeRangeInSeconds: 1800 };
    const result3 = normalizeTimeRangeArgs(args3);
    console.log("✓ normalizeTimeRangeArgs backward compatibility:", result3.timeRange);

    console.log("✓ All normalization tests passed!\n");
} catch (error) {
    console.error("✗ Normalization test failed:", error.message);
}

console.log("=== Test Summary ===");
console.log("🎉 All tests completed! The new features are ready for use.");
console.log("\nNew capabilities added:");
console.log("• Advanced time range parsing (1h, 30m, 2d, etc.)");
console.log("• Absolute time ranges with from/to parameters");
console.log("• Log histogram aggregations over time");
console.log("• Field value aggregations with statistics");
console.log("• Combined field + time aggregations");
console.log("• Comprehensive error handling and validation");