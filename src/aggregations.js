/**
 * Log aggregation utilities for Graylog MCP server
 */
import { searchGraylog } from './query.js';

/**
 * Resolve interval string, auto-selecting based on time range duration if 'auto'
 */
function resolveInterval(timeRange, interval) {
    if (interval !== 'auto') return interval;

    const duration = timeRange.type === 'relative'
        ? timeRange.range
        : (new Date(timeRange.to).getTime() - new Date(timeRange.from).getTime()) / 1000;

    if (duration <= 3600) return '1m';       // <= 1 hour
    if (duration <= 86400) return '5m';      // <= 1 day
    if (duration <= 604800) return '1h';     // <= 1 week
    return '1d';                             // > 1 week
}

/**
 * Create a time histogram aggregation
 * @param {Object} timeRange - Graylog timerange object
 * @param {string} interval - Time interval (e.g., '1m', '5m', '1h')
 * @param {string} queryString - Query filter
 * @returns {Object} Search payload for time histogram
 */
export function buildTimeHistogram(timeRange, interval, queryString) {
    interval = resolveInterval(timeRange, interval);
    const intervalMs = parseIntervalToMs(interval);

    return {
        queries: [{
            id: "q1",
            query: { type: "elasticsearch", query_string: queryString },
            timerange: timeRange,
            search_types: [{
                id: "st1",
                type: "pivot",
                row_groups: [{
                    type: "time",
                    field: "timestamp",
                    interval: {
                        type: "interval",
                        value: intervalMs
                    }
                }],
                series: [{ type: "count", id: "count" }],
                rollup: false,
                sort: [{ type: "pivot", field: "timestamp", direction: "ASC" }],
            }]
        }]
    };
}

/**
 * Convert time interval string to milliseconds
 */
function parseIntervalToMs(interval) {
    const match = interval.match(/^(\d+)([a-zA-Z]+)$/);
    if (!match) return 60000; // Default to 1 minute

    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    const multipliers = {
        's': 1000,           // seconds
        'm': 60 * 1000,      // minutes
        'h': 60 * 60 * 1000, // hours
        'd': 24 * 60 * 60 * 1000 // days
    };

    return value * (multipliers[unit] || 60000); // Default to minutes if unknown
}

/**
 * Simple field-time aggregation using basic pivot
 */
export function buildSimpleFieldTimeAggregation(timeRange, field, interval, queryString, limit) {
    interval = resolveInterval(timeRange, interval);

    return {
        queries: [{
            id: "q1",
            query: { type: "elasticsearch", query_string: queryString },
            timerange: timeRange,
            search_types: [{
                id: "st1",
                type: "pivot",
                row_groups: [
                    {
                        type: "values",
                        field: field,
                        limit: limit,
                    },
                    {
                        type: "time",
                        field: "timestamp",
                        interval: interval
                    }
                ],
                series: [{ type: "count" }],
                rollup: false
            }]
        }]
    };
}

/**
 * Histogram using exact same pattern as working field-time aggregation
 * This mirrors the successful field-time approach but only does time buckets
 */
export function buildWorkingHistogram(timeRange, interval, queryString) {
    interval = resolveInterval(timeRange, interval);

    return {
        queries: [{
            id: "q1",
            query: { type: "elasticsearch", query_string: queryString },
            timerange: timeRange,
            search_types: [{
                id: "st1",
                type: "pivot",
                row_groups: [
                    {
                        type: "time",
                        field: "timestamp",
                        interval: interval  // Same format that works for field-time
                    }
                ],
                series: [{ type: "count" }],  // Same series as field-time
                rollup: false                 // Same rollup setting
            }]
        }]
    };
}

/**
 * Alternative time histogram using chart search type
 */
export function buildTimeHistogramChart(timeRange, interval, queryString) {
    interval = resolveInterval(timeRange, interval);

    return {
        queries: [{
            id: "q1",
            query: { type: "elasticsearch", query_string: queryString },
            timerange: timeRange,
            search_types: [{
                id: "st1",
                type: "chart",
                time_range: timeRange,
                streams: [],
                name: "Timeline",
                series: [{
                    type: "count",
                    id: "count"
                }],
                group_by: [],
                interval: interval
            }]
        }]
    };
}

/**
 * Simple time histogram using basic aggregation approach
 */
export function buildSimpleTimeHistogram(timeRange, interval, queryString) {
    interval = resolveInterval(timeRange, interval);

    return {
        queries: [{
            id: "q1",
            query: { type: "elasticsearch", query_string: queryString },
            timerange: timeRange,
            search_types: [{
                id: "st1",
                type: "pivot",
                row_groups: [{
                    type: "time",
                    field: "timestamp",
                    interval: interval
                }],
                series: [{ type: "count" }],
                rollup: false
            }]
        }]
    };
}

/**
 * Create a field value aggregation
 * @param {Object} timeRange - Graylog timerange object
 * @param {string} field - Field to aggregate on
 * @param {string} queryString - Query filter
 * @param {number} limit - Maximum number of values
 * @param {Array} metrics - Metrics to calculate (count, sum, avg, min, max)
 * @param {string} valueField - Field to calculate metrics on (for sum/avg/min/max)
 * @returns {Object} Search payload for field aggregation
 */
export function buildFieldAggregation(timeRange, field, queryString, limit, metrics, valueField) {
    const series = [];

    metrics.forEach(metric => {
        if (metric === 'count') {
            series.push({ type: "count", id: "count" });
        } else if (['sum', 'avg', 'min', 'max'].includes(metric) && valueField) {
            series.push({
                type: metric,
                id: metric,
                field: valueField
            });
        }
    });

    return {
        queries: [{
            id: "q1",
            query: { type: "elasticsearch", query_string: queryString },
            timerange: timeRange,
            search_types: [{
                id: "st1",
                type: "pivot",
                row_groups: [{
                    type: "values",
                    field: field,
                    limit: limit,
                }],
                series: series,
                rollup: false,
                sort: [{ type: "series", field: "count", direction: "DESC" }],
            }]
        }]
    };
}

/**
 * Create a two-dimensional aggregation (field + time)
 * @param {Object} timeRange - Graylog timerange object
 * @param {string} field - Field to group by
 * @param {string} interval - Time interval
 * @param {string} queryString - Query filter
 * @param {number} limit - Maximum number of field values
 * @returns {Object} Search payload for 2D aggregation
 */
export function buildFieldTimeAggregation(timeRange, field, interval, queryString, limit) {
    interval = resolveInterval(timeRange, interval);
    const intervalMs = parseIntervalToMs(interval);

    return {
        queries: [{
            id: "q1",
            query: { type: "elasticsearch", query_string: queryString },
            timerange: timeRange,
            search_types: [{
                id: "st1",
                type: "pivot",
                row_groups: [
                    {
                        type: "values",
                        field: field,
                        limit: limit,
                    },
                    {
                        type: "time",
                        field: "timestamp",
                        interval: {
                            type: "interval",
                            value: intervalMs
                        }
                    }
                ],
                series: [{ type: "count", id: "count" }],
                rollup: false,
                sort: [{ type: "series", field: "count", direction: "DESC" }],
            }]
        }]
    };
}

/**
 * Execute and format aggregation results
 * @param {string} baseUrl - Graylog base URL
 * @param {string} apiToken - API token
 * @param {Object} payload - Search payload
 * @param {string} aggregationType - Type of aggregation for formatting
 * @returns {Object} Formatted results
 */
export async function executeAggregation(baseUrl, apiToken, payload, aggregationType) {
    try {
        const data = await searchGraylog(baseUrl, apiToken, payload);
        const rows = data?.results?.q1?.search_types?.st1?.rows || [];

        switch (aggregationType) {
            case 'histogram':
                return formatHistogramResults(rows);
            case 'field':
                return formatFieldAggregationResults(rows);
            case 'field-time':
                return formatFieldTimeResults(rows);
            default:
                return { rows };
        }
    } catch (error) {
        throw new Error(`Aggregation failed: ${error.message}`);
    }
}

/**
 * Format histogram results
 */
function formatHistogramResults(rows) {
    const buckets = rows.map(row => ({
        timestamp: row.key?.[0],
        count: row.values?.[0]?.value ?? 0,
    }));

    return {
        type: 'time_histogram',
        total_buckets: buckets.length,
        buckets,
    };
}

/**
 * Format field aggregation results
 */
function formatFieldAggregationResults(rows) {
    const buckets = rows.map(row => {
        const result = {
            key: row.key?.[0],
        };

        // Add all metric values
        row.values?.forEach((value, index) => {
            const metric = value.key || ['count', 'sum', 'avg', 'min', 'max'][index];
            result[metric] = value.value;
        });

        return result;
    });

    return {
        type: 'field_aggregation',
        total_buckets: buckets.length,
        buckets,
    };
}

/**
 * Format field-time aggregation results
 */
function formatFieldTimeResults(rows) {
    const buckets = rows.map(row => ({
        field_value: row.key?.[0],
        timestamp: row.key?.[1],
        count: row.values?.[0]?.value ?? 0,
    }));

    // Group by field value for easier consumption
    const grouped = {};
    buckets.forEach(bucket => {
        const fieldValue = bucket.field_value;
        if (!grouped[fieldValue]) {
            grouped[fieldValue] = [];
        }
        grouped[fieldValue].push({
            timestamp: bucket.timestamp,
            count: bucket.count,
        });
    });

    return {
        type: 'field_time_aggregation',
        total_buckets: buckets.length,
        series: grouped,
    };
}