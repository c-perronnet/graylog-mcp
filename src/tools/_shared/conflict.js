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
    // envelope (`inputs`, `streams`, `extractors`, `items`). Normalize both
    // shapes here so callers can supply the simplest possible matchFn.
    const items = Array.isArray(response)
        ? response
        : (response?.inputs
            ?? response?.streams
            ?? response?.extractors
            ?? response?.index_sets
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
