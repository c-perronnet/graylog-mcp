// PIPE-01 — list_pipelines. GET /api/system/pipelines/pipeline (BARE ARRAY).
//
// Pitfall 3: the literal `pipeline` segment is REQUIRED in the path.
// Pitfall A3 (Phase 3): bare arrays vs envelopes — pipelines return bare,
// so no envelope unwrap path needed (Array.isArray fast path).
//
// Narrow projection: [id, title, description, stages_count, created_at, modified_at].
// The synthetic `stages_count` is the length of the wire `stages` array —
// agents see "how many stages" without the byte cost of the full source.
// fields:"all" returns the full DTO including the raw source DSL string;
// the synthetic stages_count is preserved on the item even under fields:"all".

import { defineListHandler } from "../_shared/list.js";
import { ListPipelinesSchema } from "./schemas.js";

export const handleListPipelines = defineListHandler({
    name: "list_pipelines",
    schema: ListPipelinesSchema,
    defaultFields: ["id", "title", "description", "stages_count", "created_at", "modified_at"],
    async fetch(client, _args) {
        const response = await client.request(
            "GET",
            "/api/system/pipelines/pipeline",   // Pitfall 3: literal pipeline segment
            null,
        );
        // BARE ARRAY (Pitfall A3 / RESEARCH §"Key shape callouts" line 763).
        const items = Array.isArray(response) ? response : [];
        // Synthetic projection: stages_count from stages array length. We project
        // BEFORE the list framework's field-pick so the synthetic field is
        // available to both the default-projection path and fields:["stages_count"]
        // custom selection.
        return items.map((p) => ({
            ...p,
            stages_count: Array.isArray(p?.stages) ? p.stages.length : 0,
        }));
    },
});
