// Per-connection pipeline-rule function catalogue cache (D-03).
//
// One GET per connection for the server process lifetime. Cleared on process
// restart only. Merges Graylog's live `GET /api/system/pipelines/rule/functions`
// response over the hand-curated static baseline from builtins.js — live wins
// on collision (Graylog is authoritative for runtime function availability),
// static fills description/category gaps where the live response carries
// signature-only metadata.
//
// Consumers:
//   - list_pipeline_functions (Plan 04 / PIPE-11) — surfaces the merged map
//   - validate.js — Pitfall 5: lint consumes the MERGED map so live-only
//     function names introduced by a newer Graylog version DO NOT false-fail
//     before the parse pre-flight runs.
//
// Cache shape: Map<connectionName, { fetchedAt, merged }>. Threat-model
// T-04-01-01: keyed by connectionName so connection A's catalogue cannot leak
// across to connection B (mirrors src/tools/inputs/type-catalogue.js).

import { makeClient } from "../graylog/client.js";
import { staticBuiltins } from "./builtins.js";

const _cache = new Map(); // Map<connectionName, { fetchedAt, merged }>

/**
 * Render a live FunctionDescriptor's params array as a TS-ish signature
 * string for human-readable catalogue display.
 *
 * Live shape per `FunctionDescriptor.java`:
 *   { name, pure, return_type, params: [{ name, type, optional, ... }],
 *     description, deprecated, ... }
 *
 * @param {object} live
 * @returns {string}
 */
function liveSignatureString(live) {
    if (!Array.isArray(live.params)) return live.signature ?? `${live.name}(...)`;
    const args = live.params
        .map((p) => `${p.name}${p.optional ? "?" : ""}: ${p.type ?? "any"}`)
        .join(", ");
    const ret = live.return_type ?? live.returnType ?? "any";
    return `${live.name}(${args}): ${ret}`;
}

/**
 * Fetch + cache + merge the function catalogue for a connection.
 *
 * @param {string} connectionName
 * @param {{ baseUrl: string, apiToken: string, writable?: boolean }} conn
 * @returns {Promise<Map<string, object>>} merged Map<name, entry>
 */
export async function getMergedCatalogue(connectionName, conn) {
    if (_cache.has(connectionName)) return _cache.get(connectionName).merged;
    const client = makeClient(conn);
    const liveArr = await client.request(
        "GET",
        "/api/system/pipelines/rule/functions",
        null,
    );
    const merged = new Map();
    // 1. Seed with static baseline (descriptions are the value-add).
    for (const f of staticBuiltins) {
        merged.set(f.name, { ...f, source: "static" });
    }
    // 2. Overlay live; live wins on collisions but preserves the static
    //    description/category when the live entry lacks them.
    for (const live of (Array.isArray(liveArr) ? liveArr : [])) {
        const stat = merged.get(live.name);
        const liveDesc = (typeof live.description === "string" && live.description.length > 0)
            ? live.description
            : (stat?.oneLineDescription ?? "");
        merged.set(live.name, {
            name: live.name,
            signature: liveSignatureString(live),
            oneLineDescription: liveDesc,
            category: stat?.category ?? "unknown",
            source: "live",
            deprecated: live.deprecated === true,
            returnType: live.return_type ?? live.returnType ?? null,
            sourceRef: stat?.sourceRef ?? null,
        });
    }
    _cache.set(connectionName, { fetchedAt: Date.now(), merged });
    return merged;
}

/**
 * Test-only seam: reset the cache so tests can re-verify the fetch-once
 * contract under isolated conditions. NEVER call from production code.
 */
export function _clearFunctionCatalogueForTests() {
    _cache.clear();
}
