// Conflict pre-check (FOUND-11 / PITFALLS.md M5).
//
// Phase 0 ships a stub that returns []. Phase 1+ wires real list-fetch via
// { listPath, matchFn }: fetch the items at listPath, run matchFn over each,
// project { id, title?, similarity_reason? } for matches.
//
// The stub still gets called from defineMutatingHandler's build step in domain
// phases, but at Phase 0 there are no mutating tools yet, so the stub guarantees
// that every dry-run preview's `existingMatches` field is always an array.

/**
 * @param {{ request: (method: string, path: string, body?: unknown) => Promise<unknown> }} client
 * @param {{ listPath?: string, matchFn?: (item: unknown) => boolean }} [opts]
 * @returns {Promise<Array<{ id: string, title?: string, similarity_reason?: string }>>}
 */
export async function findExistingMatches(client, opts = {}) {
    if (!opts.listPath || typeof opts.matchFn !== "function") return [];
    // Phase 1+ implementation will look roughly like:
    //   const items = await client.request("GET", opts.listPath, null);
    //   return items.filter(opts.matchFn).map((it) => ({
    //       id: it.id,
    //       title: it.title,
    //       similarity_reason: opts.reason?.(it),
    //   }));
    return [];
}
