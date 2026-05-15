// PIPE-06 — list_pipeline_rules. GET /api/system/pipelines/rule (BARE ARRAY).
//
// Narrow projection: [id, title, description, created_at, modified_at]. The
// full `source` DSL text is intentionally excluded from the default fields —
// agents call get_pipeline_rule when they need the rule body. Token-budget-
// friendly for clusters with many rules.
//
// Pitfall 3 (rule variant): the literal `rule` segment is REQUIRED in the
// path. `/api/system/pipelines/rule` returns a BARE ARRAY (verified against
// RuleResource.java:184-192). findExistingMatches' Array.isArray fast path
// handles this without an envelope unwrap.
//
// Mirrors src/tools/pipelines/list-pipelines.js (PIPE-01) — same factory,
// different endpoint + projection.

import { defineListHandler } from "../_shared/list.js";
import { ListPipelineRulesSchema } from "./schemas.js";

export const handleListPipelineRules = defineListHandler({
    name: "list_pipeline_rules",
    schema: ListPipelineRulesSchema,
    defaultFields: ["id", "title", "description", "created_at", "modified_at"],
    async fetch(client, _args) {
        const response = await client.request(
            "GET",
            "/api/system/pipelines/rule",   // Pitfall 3 (rule variant): literal rule segment
            null,
        );
        // BARE ARRAY (RESEARCH §"Key shape callouts" line 763).
        return Array.isArray(response) ? response : [];
    },
});
