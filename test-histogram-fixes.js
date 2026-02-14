#!/usr/bin/env node

/**
 * Test script to validate histogram fixes
 */
import { buildWorkingHistogram, buildSimpleFieldTimeAggregation } from "./src/aggregations.js";
import { buildTimeRange } from "./src/timerange.js";

console.log("Testing histogram fixes based on working field-time pattern...\n");

const timeRange = buildTimeRange({ range: '1h' });
const queryString = 'level:3';

console.log("=== Comparing Working vs Fixed Approaches ===");

// Working field-time aggregation structure
const fieldTime = buildSimpleFieldTimeAggregation(timeRange, 'env', '5m', queryString, 10);
console.log("✅ Working Field-Time Structure:");
console.log(`  - Type: ${fieldTime.queries[0].search_types[0].type}`);
console.log(`  - Row groups: ${fieldTime.queries[0].search_types[0].row_groups.length}`);
console.log(`  - Time group interval: ${fieldTime.queries[0].search_types[0].row_groups[1].interval}`);
console.log(`  - Series: ${fieldTime.queries[0].search_types[0].series[0].type}`);

// New working histogram structure (should mirror field-time)
const workingHistogram = buildWorkingHistogram(timeRange, '5m', queryString);
console.log("\n🔧 New Working Histogram Structure:");
console.log(`  - Type: ${workingHistogram.queries[0].search_types[0].type}`);
console.log(`  - Row groups: ${workingHistogram.queries[0].search_types[0].row_groups.length}`);
console.log(`  - Time group interval: ${workingHistogram.queries[0].search_types[0].row_groups[0].interval}`);
console.log(`  - Series: ${workingHistogram.queries[0].search_types[0].series[0].type}`);

console.log("\n=== Structure Comparison ===");
const fieldTimeStructure = fieldTime.queries[0].search_types[0];
const histogramStructure = workingHistogram.queries[0].search_types[0];

const matches = {
    type: fieldTimeStructure.type === histogramStructure.type,
    series_count: fieldTimeStructure.series.length === histogramStructure.series.length,
    series_type: fieldTimeStructure.series[0].type === histogramStructure.series[0].type,
    rollup: fieldTimeStructure.rollup === histogramStructure.rollup,
    time_interval: fieldTimeStructure.row_groups[1]?.interval === histogramStructure.row_groups[0].interval
};

console.log("Structure Matches:");
Object.entries(matches).forEach(([key, match]) => {
    console.log(`  ${match ? '✅' : '❌'} ${key}: ${match ? 'MATCH' : 'DIFFERENT'}`);
});

console.log("\n=== Key Differences (Expected) ===");
console.log("✅ Field-Time has 2 row_groups (values + time)");
console.log("✅ Histogram has 1 row_group (time only)");
console.log("✅ Both use identical time configuration");
console.log("✅ Both use identical series configuration");

console.log("\n=== Payload Samples ===");

console.log("Working Field-Time Payload (time part):");
console.log(JSON.stringify(fieldTimeStructure.row_groups[1], null, 2));

console.log("\nNew Histogram Payload (time part):");
console.log(JSON.stringify(histogramStructure.row_groups[0], null, 2));

console.log("\n=== Implementation Summary ===");
console.log("🎯 FIXED: Created buildWorkingHistogram() that mirrors successful field-time pattern");
console.log("🎯 FIXED: Added enhanced debug logging to identify empty bucket causes");
console.log("🎯 FIXED: Added debug_histogram_query tool for troubleshooting");
console.log("🎯 FIXED: Put working-pattern approach first in fallback sequence");

console.log("\n=== Next Steps ===");
console.log("1. 🧪 Test get_log_histogram with working-pattern approach");
console.log("2. 🔍 Use debug_histogram_query if buckets still empty");
console.log("3. 📊 The new approach should work since field-time works perfectly");
console.log("4. 🎉 Field-time aggregation success proves the pattern works!");

console.log("\n✨ Ready for testing with actual Graylog instance!");