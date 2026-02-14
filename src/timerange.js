/**
 * Advanced time range utilities for Graylog MCP server
 */

// Common time unit mappings
const TIME_UNITS = {
    's': 1,
    'sec': 1,
    'second': 1,
    'seconds': 1,
    'm': 60,
    'min': 60,
    'minute': 60,
    'minutes': 60,
    'h': 3600,
    'hr': 3600,
    'hour': 3600,
    'hours': 3600,
    'd': 86400,
    'day': 86400,
    'days': 86400,
    'w': 604800,
    'week': 604800,
    'weeks': 604800,
    'M': 2592000, // 30 days
    'month': 2592000,
    'months': 2592000,
    'y': 31536000, // 365 days
    'year': 31536000,
    'years': 31536000,
};

/**
 * Parse a relative time string like "1h", "30m", "2d" into seconds
 * @param {string} timeStr - Time string like "1h", "30m", "2d"
 * @returns {number} Time in seconds
 */
export function parseRelativeTime(timeStr) {
    if (typeof timeStr === 'number') {
        if (timeStr < 0) {
            throw new Error('Time range cannot be negative');
        }
        if (timeStr > 31536000) { // 1 year in seconds
            throw new Error('Time range cannot exceed 1 year (31536000 seconds)');
        }
        return timeStr;
    }

    if (typeof timeStr !== 'string') {
        throw new Error(`Invalid time format: ${timeStr}. Expected string or number`);
    }

    const match = timeStr.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/);
    if (!match) {
        throw new Error(`Invalid time format: ${timeStr}. Use formats like "1h", "30m", "2d"`);
    }

    const [, value, unit] = match;
    const numericValue = parseFloat(value);

    if (numericValue <= 0) {
        throw new Error('Time value must be greater than 0');
    }

    // Try original unit first (preserves case-sensitive 'M' for months vs 'm' for minutes)
    const seconds = TIME_UNITS[unit] ?? TIME_UNITS[unit.toLowerCase()];

    if (!seconds) {
        throw new Error(`Invalid time unit: ${unit}. Valid units: s, m, h, d, w, M, y`);
    }

    const totalSeconds = Math.floor(numericValue * seconds);

    if (totalSeconds > 31536000) { // 1 year in seconds
        throw new Error('Time range cannot exceed 1 year');
    }

    return totalSeconds;
}

/**
 * Parse an absolute time string into ISO format
 * @param {string|Date} timeStr - ISO string, Date object, or timestamp
 * @returns {string} ISO timestamp string
 */
export function parseAbsoluteTime(timeStr) {
    if (!timeStr) return null;

    let date;
    if (timeStr instanceof Date) {
        date = timeStr;
    } else if (typeof timeStr === 'number') {
        date = new Date(timeStr);
    } else {
        date = new Date(timeStr);
    }

    if (isNaN(date.getTime())) {
        throw new Error(`Invalid absolute time: ${timeStr}`);
    }

    return date.toISOString();
}

/**
 * Build a Graylog timerange object from various input formats
 * @param {Object} options - Time range options
 * @param {string|number} options.range - Relative time (e.g., "1h", 3600)
 * @param {string|Date} options.from - Start time for absolute range
 * @param {string|Date} options.to - End time for absolute range
 * @param {string|number} options.last - Last N time units (e.g., "1h")
 * @returns {Object} Graylog timerange object
 */
export function buildTimeRange(options = {}) {
    const { range, from, to, last } = options;

    // Absolute time range
    if (from || to) {
        const fromTime = from ? parseAbsoluteTime(from) : null;
        const toTime = to ? parseAbsoluteTime(to) : new Date().toISOString();

        if (!fromTime) {
            throw new Error('from time is required for absolute time range');
        }

        // Validate that from is before to
        if (new Date(fromTime).getTime() >= new Date(toTime).getTime()) {
            throw new Error('from time must be before to time');
        }

        // Validate time range is not too long
        const durationMs = new Date(toTime).getTime() - new Date(fromTime).getTime();
        const oneYearMs = 365 * 24 * 60 * 60 * 1000;
        if (durationMs > oneYearMs) {
            throw new Error('Absolute time range cannot exceed 1 year');
        }

        return {
            type: 'absolute',
            from: fromTime,
            to: toTime,
        };
    }

    // Relative time range
    if (range || last) {
        const timeValue = range || last;
        const seconds = parseRelativeTime(timeValue);

        return {
            type: 'relative',
            range: seconds,
        };
    }

    // Default to last 15 minutes
    return {
        type: 'relative',
        range: 900,
    };
}

/**
 * Validate and normalize time range parameters for tool schemas
 * @param {Object} args - Arguments from tool call
 * @returns {Object} Normalized time range parameters
 */
export function normalizeTimeRangeArgs(args) {
    try {
        const timeRange = buildTimeRange({
            range: args.timeRange || args.searchTimeRangeInSeconds || args.timeRangeInSeconds,
            from: args.from || args.startTime,
            to: args.to || args.endTime,
            last: args.last,
        });

        return {
            timeRange,
            // Keep original parameter names for backward compatibility
            searchTimeRangeInSeconds: timeRange.type === 'relative' ? timeRange.range : undefined,
            timeRangeInSeconds: timeRange.type === 'relative' ? timeRange.range : undefined,
        };
    } catch (error) {
        throw new Error(`Invalid time range: ${error.message}`);
    }
}

