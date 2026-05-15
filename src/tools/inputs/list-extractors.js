// INPUT-08: list_extractors — GET /api/system/inputs/{inputId}/extractors.
//
// Per-input scope. Composes through defineListHandler so the framework's
// projection + limit clamping + fields:'all' opt-out apply uniformly. The
// default narrow projection is the framework default [id, title, description]
// (no per-tool override is needed — extractors carry titles + descriptions in
// practice).
//
// Note: GET on a non-existent input ID returns a 404 from Graylog; the
// framework's wrapGraylogError surfaces this as an MCP error envelope.

import { defineListHandler } from "../_shared/list.js";
import { ListExtractorsSchema } from "./schemas.js";

export const handleListExtractors = defineListHandler({
    name: "list_extractors",
    schema: ListExtractorsSchema,
    fetch: async (client, args) => {
        // Graylog returns { extractors: ExtractorSummary[] } — see
        // 01-RESEARCH.md Endpoint Catalogue row 9. The envelope shape is
        // stable across the 7.x series (per RESEARCH.md §Notes on
        // response shape inconsistencies).
        const response = await client.request(
            "GET",
            `/api/system/inputs/${args.inputId}/extractors`,
            null,
        );
        return Array.isArray(response?.extractors) ? response.extractors : [];
    },
});
