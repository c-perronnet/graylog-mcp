// INPUT-06: delete_input — DELETE /api/system/inputs/{inputId}.
//
// D-05 cascade enumeration: Graylog auto-removes extractors when an input is
// deleted (Mongo-level cascade in inputService.destroy). The DELETE response
// itself is 204 No Content with no body, so the cascade is invisible to the
// agent after the fact. This handler pre-flights GET /api/system/inputs/{id}/extractors
// at build time so the dry-run preview can surface `cascades.extractors[]`
// with id + title + extractor_type for each affected extractor — the agent
// sees the blast radius BEFORE applying.
//
// The pre-flight is best-effort: if it 404s (input doesn't exist) or 403s
// (permission denied), proceed with an empty cascade list — the DELETE itself
// will surface the real error via wrapGraylogError.

import { defineMutatingHandler } from "../_shared/handler.js";
import { DeleteInputSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";

export const handleDeleteInput = defineMutatingHandler({
    name: "delete_input",
    schema: DeleteInputSchema,
    async build(args) {
        // Connection already resolved by handler.js — threaded via leading-
        // underscore framework-internal keys.
        const conn = args._conn;
        const client = makeClient(conn);

        // Pre-flight extractor enumeration. Best-effort — failure here MUST
        // NOT prevent the dry-run from rendering; the DELETE itself surfaces
        // any real error on apply.
        let extractors = [];
        try {
            const extractorList = await client.request(
                "GET",
                `/api/system/inputs/${args.inputId}/extractors`,
                null,
            );
            extractors = Array.isArray(extractorList?.extractors)
                ? extractorList.extractors.map((e) => ({
                    id: e.id,
                    title: e.title,
                    extractor_type: e.extractor_type,
                }))
                : [];
        } catch (_err) {
            extractors = [];
        }

        return {
            method: "DELETE",
            path: `/api/system/inputs/${args.inputId}`,
            body: undefined,
            postApplyEstimate: { id: args.inputId },
            cascades: { extractors },
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) => `Delete input ${args.inputId}`,
});
