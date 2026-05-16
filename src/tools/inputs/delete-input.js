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
        let preflightError = null;
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
        } catch (err) {
            if (err?.status === 404 || err?.status === 403) {
                // Best-effort tolerated cases: GET 404 (no extractors endpoint
                // exposed / input absent) or 403 (token lacks read scope).
                // Treat as empty cascade — the DELETE itself surfaces the
                // real error on apply.
                extractors = [];
            } else {
                // Unexpected pre-flight failure (5xx, TLS, JSON parse,
                // programmer bug, network error). Per CLAUDE.md soft-fallback
                // convention, log to stderr AND surface a structural signal
                // on cascades so the dry-run is honest about the unknown
                // blast radius — the agent must not assume "no extractors"
                // when we never got a clean answer.
                console.error(
                    `[delete_input] extractor pre-flight failed for input ${args.inputId}: ${err?.message ?? err}`
                );
                extractors = [];
                preflightError = err?.message ?? String(err);
            }
        }

        return {
            method: "DELETE",
            path: `/api/system/inputs/${args.inputId}`,
            body: undefined,
            postApplyEstimate: { id: args.inputId },
            cascades: {
                extractors,
                ...(preflightError !== null
                    ? { extractors_preflight_error: preflightError }
                    : {}),
            },
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) => `Delete input ${args.inputId}`,
});
