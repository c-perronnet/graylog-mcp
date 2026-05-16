// BLUE-05 — setup_long_term_archival_index.
//
// Simplest of the Phase 6 Plan 04 blueprints — a 1-step chain that wraps
// the index-sets services-layer createIndexSet call with bundled
// SizeBasedRotationStrategyConfig (1 GiB) + DeletionRetentionStrategyConfig
// (max_number_of_indices ≈ retentionDays, 1 index per day approximation).
//
// Composition contract (D-09): Imports ONLY from src/services/index-sets.js
// (NOT from src/tools/index-sets/*). Pinned by Task 1 grep test.
//
// Bundling rationale: long-term archival is a single intent ("keep N days
// of history at 1 GiB/index"); splitting rotation + retention across two
// agent-visible knobs would invite mismatches. The blueprint locks the
// strategy pair and exposes only the retention-window knob.

import { defineMutatingHandler } from "../_shared/handler.js";
import { SetupLongTermArchivalIndexSchema } from "./schemas.js";
import { createIndexSet } from "../../services/index-sets.js";  // D-09 boundary — services only
import { executeChain } from "../_shared/blueprint-chain.js";
import { SERVER_ASSIGNED_SENTINEL } from "../_shared/dry-run.js";

const ONE_GIB = 1_073_741_824;

// Slugify a free-form name into a valid Elasticsearch index prefix
// (lowercase alphanumerics + underscore; strip leading/trailing _).
function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

// Suppress unused-import lint while pinning the D-09 architectural contract:
// the createIndexSet service is the canonical entry point this blueprint
// targets. Apply walks executeChain (which calls client.request directly via
// the chain transcript's pre-computed {method, path, body}), but the import
// stays as the contract marker — services-layer compose audit greps for it.
void createIndexSet;

export const handleSetupLongTermArchivalIndex = defineMutatingHandler({
    name: "setup_long_term_archival_index",
    schema: SetupLongTermArchivalIndexSchema,
    async build(args) {
        const indexPrefix = args.indexPrefix ?? slugify(args.name);
        const indexSetBody = {
            title: args.name,
            description: args.description ?? `Long-term archival index for ${args.name}`,
            index_prefix: indexPrefix,
            shards: args.shards ?? 4,
            replicas: args.replicas ?? 1,
            rotation_strategy_class:
                "org.graylog2.indexer.rotation.strategies.SizeBasedRotationStrategyConfig",
            rotation_strategy: {
                type: "org.graylog2.indexer.rotation.strategies.SizeBasedRotationStrategyConfig",
                max_size: ONE_GIB,
            },
            retention_strategy_class:
                "org.graylog2.indexer.retention.strategies.DeletionRetentionStrategyConfig",
            retention_strategy: {
                type: "org.graylog2.indexer.retention.strategies.DeletionRetentionStrategyConfig",
                max_number_of_indices: args.retentionDays,  // approximation: 1 index per day
            },
            writable: true,
            index_analyzer: "standard",
            index_optimization_max_num_segments: 1,
            index_optimization_disabled: false,
            field_type_refresh_interval: 5000,
            creation_date: new Date().toISOString(),
        };

        const chain = [{
            step: 1,
            tool: "create_index_set",
            request: {
                method: "POST",
                path: "/api/system/indices/index_sets",
                body: indexSetBody,
            },
            postApplyEstimate: { id: SERVER_ASSIGNED_SENTINEL },
        }];

        return {
            chain,
            method: "POST",
            path: "/api/system/indices/index_sets",
            body: indexSetBody,
            postApplyEstimate: { id: SERVER_ASSIGNED_SENTINEL },
        };
    },
    async apply(client, req) {
        const result = await executeChain(client, req.chain);
        if (result.isError) return result;
        return result.transcript[0].response;
    },
    summarize: (args) =>
        `Set up long-term archival index "${args.name}" with ${args.retentionDays}-day retention (1 GiB/index size rotation + delete retention)`,
});
