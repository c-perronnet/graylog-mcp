// Conflict pre-check (FOUND-11 / PITFALLS.md M5).
//
// Phase 1 A2 amendment: replace the Phase 0 stub with a real implementation
// that fires a GET against listPath, filters items via matchFn, and projects
// { id, title, similarity_reason } for each match. Phase 0 callers that pass
// empty opts continue to receive [] (the wrapper still always surfaces
// existingMatches as an array — see handler.js).
//
// Threat-model T-01-01-01: matchFn is internal — supplied by a tool's build(),
// never by agent input. The typeof === "function" gate prevents string-eval
// paths even in the unlikely case a future caller mis-wires the option.

/**
 * @param {{ request: (method: string, path: string, body?: unknown) => Promise<unknown> }} client
 * @param {{
 *   listPath?: string,
 *   matchFn?: (item: unknown) => boolean,
 *   similarityReason?: string | ((item: unknown) => string),
 * }} [opts]
 * @returns {Promise<Array<{ id: string, title?: string, similarity_reason?: string }>>}
 */
export async function findExistingMatches(client, opts = {}) {
    if (!opts.listPath || typeof opts.matchFn !== "function") return [];
    const response = await client.request("GET", opts.listPath, null);
    // Graylog list endpoints sometimes wrap the array in a domain-specific
    // envelope. Phase 5 adds `elements` for the /paginated PageListResponse
    // shape (events/definitions/paginated + events/notifications/paginated).
    // Phase 6 adds `views` for the /api/views PaginatedResponse shape
    // (dashboards/saved-searches) — see 06-RESEARCH.md §Pitfall 1.
    // Position: `elements` BEFORE `views` BEFORE `items` so the modern
    // PageListResponse wins, Phase 6 PaginatedResponse wins over the rare
    // endpoint that uses a generic `items` wrapper, and the fall-through to
    // `items` is preserved as the last resort.
    const items = Array.isArray(response)
        ? response
        : (response?.inputs
            ?? response?.streams
            ?? response?.extractors
            ?? response?.index_sets
            ?? response?.elements
            ?? response?.views
            ?? response?.items
            ?? []);
    return items.filter(opts.matchFn).map((item) => ({
        id: item.id ?? item.input_id ?? item.extractor_id ?? null,
        title: item.title ?? item.name ?? undefined,
        similarity_reason: typeof opts.similarityReason === "function"
            ? opts.similarityReason(item)
            : (opts.similarityReason ?? "exact"),
    }));
}
