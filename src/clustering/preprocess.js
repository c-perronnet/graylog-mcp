const WILDCARD = "<*>";

const PATTERNS = [
    // ISO timestamps (with or without ms / tz)
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
    // UUIDs
    /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
    // IPv4
    /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g,
    // IPv6 (simple form, including ::)
    /\b(?:[0-9a-fA-F]{1,4}:){1,7}(?::|[0-9a-fA-F]{1,4})\b/g,
    // Hex blobs (8+ chars) and 0x-prefixed
    /\b0x[0-9a-fA-F]+\b/g,
    /\b[0-9a-fA-F]{8,}\b/g,
    // Standalone numbers (after the above so we don't eat number parts of IPs/timestamps already replaced)
    /\b\d+\b/g,
];

export function normalizeMessage(text) {
    if (typeof text !== "string") return "";
    let out = text;
    for (const re of PATTERNS) {
        out = out.replace(re, WILDCARD);
    }
    // Collapse runs of <*> tokens (adjacent or space-separated)
    out = out.replace(/<\*>(\s*<\*>)+/g, WILDCARD);
    return out.trim().replace(/\s+/g, " ");
}

export function tokenize(text) {
    return text.split(/\s+/).filter(t => t.length > 0);
}

export const WILDCARD_TOKEN = WILDCARD;
