// PIPE-11 — list_pipeline_functions. Plan 04-04 / ROADMAP SC3.
//
// Thin defineListHandler over Plan 04-01's getMergedCatalogue. The merged
// catalogue is the same data structure validate.js consumes for client-side
// rule lint — this tool surfaces it for agent discovery.
//
// Composition:
//   - getMergedCatalogue (Plan 04-01) seeds with staticBuiltins (133 hand-
//     curated entries from RESEARCH §"Built-in Function Catalogue"), then
//     overlays the live response from GET /api/system/pipelines/rule/functions.
//   - Live wins on name collisions (Graylog is authoritative for runtime
//     function availability); static fills description gaps when live's
//     description is empty.
//   - Live-only function names (introduced by newer Graylog versions) DO
//     surface via this tool — Pitfall 5 fix at the catalogue layer.
//   - Cached per-connection per process lifetime (one GET per connection).
//
// Discretion-04 resolution: signature is rendered from live `params` array
// via liveSignatureString() when source==="live"; static signature string
// is used when source==="static". Future validate.js arg-count check (RESEARCH
// Open Question #2) would consume merged.params.length for live entries.

import { defineListHandler } from "../_shared/list.js";
import { ListPipelineFunctionsSchema } from "./schemas.js";
import { getMergedCatalogue } from "../../pipeline-dsl/function-catalogue.js";

export const handleListPipelineFunctions = defineListHandler({
    name: "list_pipeline_functions",
    schema: ListPipelineFunctionsSchema,
    defaultFields: ["name", "signature", "category", "source", "deprecated"],
    async fetch(client, args) {
        // getMergedCatalogue is per-connection cached — one GET per process
        // per connectionName. The cache lives in function-catalogue.js;
        // _clearFunctionCatalogueForTests resets it for unit tests.
        const merged = await getMergedCatalogue(args._connectionName, args._conn);

        let entries = [...merged.values()];

        if (args.category) {
            entries = entries.filter((e) => e.category === args.category);
        }
        if (args.deprecated_only === true) {
            entries = entries.filter((e) => e.deprecated === true);
        }

        // Sort alphabetically by name for deterministic output (Plan 06
        // snapshot fixtures + agent discovery ergonomics).
        return entries.sort((a, b) => a.name.localeCompare(b.name));
    },
});
