// Canonical MCP error helpers (FOUND-03 + Phase 0 cross-cutting).
//
// errorResponse: the project's canonical "hard error" envelope. Reused verbatim from
//   src/tools/cluster-errors.js:12-14 so existing handlers and the new wrapper layer
//   agree on shape.
// formatZodError: flattens a ZodError's .issues[] into a single human-readable line.
//   Used by defineMutatingHandler / defineListHandler when schema.parse() throws.
// wrapGraylogError: translates a thrown GraylogError (or plain Error fallback) into
//   the canonical MCP error response. Used by the apply branch of defineMutatingHandler
//   so the caller always sees { isError: true, content: [...] }.

/**
 * Canonical MCP error envelope.
 * @param {string} text - human-readable message
 * @returns {{ isError: true, content: [{ type: "text", text: string }] }}
 */
export function errorResponse(text) {
    return { isError: true, content: [{ type: "text", text }] };
}

/**
 * Flatten a ZodError into a single human-readable string.
 * Walks err.issues[] producing entries like "title: Required" or "config.b: Expected number".
 * @param {{ issues?: Array<{ path: Array<string|number>, message: string }> }} err
 * @returns {string}
 */
export function formatZodError(err) {
    const issues = err?.issues ?? [];
    if (!Array.isArray(issues) || issues.length === 0) {
        return err?.message ?? "validation failed";
    }
    return issues
        .map((iss) => {
            const path = Array.isArray(iss.path) && iss.path.length > 0
                ? iss.path.join(".")
                : "(root)";
            return `${path}: ${iss.message}`;
        })
        .join(", ");
}

/**
 * Wrap a thrown error (typed GraylogError or plain Error) into the canonical MCP error
 * envelope. Preserves status + method + path context plus a truncated body excerpt for
 * debug visibility — without leaking auth or the full response body (200 chars max).
 * @param {Error & { isGraylogError?: boolean, status?: number, method?: string, path?: string, body?: unknown }} err
 * @param {string} toolName
 * @returns {{ isError: true, content: [{ type: "text", text: string }] }}
 */
export function wrapGraylogError(err, toolName) {
    if (err && err.isGraylogError) {
        const bodySnippet = formatBodySnippet(err.body);
        const parts = [
            `[${toolName}]`,
            err.status !== undefined ? String(err.status) : "ERR",
            err.method ? err.method : "",
            err.path ? err.path : "",
        ].filter(Boolean);
        let text = `${parts.join(" ")}: ${err.message}`;
        // Surface a structured `reason` tag when the thrower attached one
        // (e.g. update_index_set's `default_index_set_must_be_writable`,
        // delete_index_set's `default_index_set_undeletable` /
        // `stats_unreachable`). Programmatic identification surface for the
        // agent — additive; no existing thrower depends on its absence.
        if (typeof err.reason === "string" && err.reason.length > 0) {
            text += ` [reason: ${err.reason}]`;
        }
        if (bodySnippet) text += ` — ${bodySnippet}`;
        const out = errorResponse(text);
        if (typeof err.reason === "string" && err.reason.length > 0) {
            out.reason = err.reason;
        }
        return out;
    }
    // Plain Error fallback (network failure, programmer error, etc.)
    const msg = err?.message ?? String(err);
    let text = `[${toolName}] ${msg}`;
    // Plan 06-02: client-side errors (e.g. widget_position_integrity_violation,
    // widget_not_found, dashboard_missing_search_binding from remove_widget;
    // widget_position_integrity_violation from create_dashboard) attach a
    // structured `reason` tag for agent-programmatic identification. Surface
    // it in the envelope text so a regex/contains check on the reason works
    // even when the underlying message doesn't repeat the keyword. Matches
    // the GraylogError path's `[reason: ...]` suffix style for consistency.
    if (typeof err?.reason === "string" && err.reason.length > 0) {
        text += ` [reason: ${err.reason}]`;
    }
    const out = errorResponse(text);
    if (typeof err?.reason === "string" && err.reason.length > 0) {
        out.reason = err.reason;
    }
    return out;
}

// Truncate response body to a short string for the error message. Never returns more
// than 200 chars regardless of input shape.
function formatBodySnippet(body) {
    if (body === undefined || body === null) return "";
    try {
        const s = typeof body === "string" ? body : JSON.stringify(body);
        return s.length > 200 ? s.slice(0, 200) + "…" : s;
    } catch {
        return "";
    }
}
