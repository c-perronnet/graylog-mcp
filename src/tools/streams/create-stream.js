// STREAM-03 — create_stream. The M5 mitigation centerpiece for the streams
// domain: 3-bucket existingMatches (D-05/D-06) + D-13 __SERVER_ASSIGNED__ id
// sentinel + CreateEntityRequest envelope wrap.
//
// Wire-shape gotcha (verified at StreamResource.java:229-230): the request
// body MUST wrap the agent's flat input in `{ entity: {...}, share_request:
// null }`. A flat body gets 400 "missing entity". The wrapper translates the
// agent's flat title/description/rules/index_set_id/... into this envelope
// inside build() so the agent never has to know.
//
// Inline rules (when present) translate from the string discriminator API
// (StreamRuleSchema 8-variant union) to Graylog's numeric wire format via
// STREAM_RULE_TYPE_TO_NUMERIC. Per CreateStreamRuleRequest.java (Pitfall S10),
// `value` + `field` are non-nullable Strings on the wire — semantically
// irrelevant fields (e.g. `field` on `always_match`) emit empty string, not
// null.
//
// Response shape (Pitfall S7 / S8 / M2): POST /api/streams returns 201 +
// `{ stream_id: "<uuid>" }` + Location header. toIdBody({ idFields:
// ["stream_id", "id"] }) handles both the canonical stream_id and the rare
// fallback to id, in priority order.

import { defineMutatingHandler } from "../_shared/handler.js";
import { CreateStreamSchema, STREAM_RULE_TYPE_TO_NUMERIC } from "./schemas.js";
import { findExistingMatches } from "../_shared/conflict.js";
import { makeClient } from "../../graylog/client.js";
import { toIdBody } from "../../graylog/normalize.js";

// D-05/D-06 similarity classifier: strictest bucket wins (exact >
// case_insensitive > prefix). Returns null when no bucket matches so
// findExistingMatches's matchFn predicate filters non-matches out.
function classifySimilarity(proposed, existing) {
    if (typeof proposed !== "string" || typeof existing !== "string") return null;
    if (proposed === existing) return "exact";
    if (proposed.toLowerCase() === existing.toLowerCase()) return "case_insensitive";
    const p = proposed.toLowerCase();
    const e = existing.toLowerCase();
    if (p.startsWith(e) || e.startsWith(p)) return "prefix";
    return null;
}

// Pitfall S9 + S10 translation: zod-validated rule (string discriminator)
// → Graylog wire shape (numeric int type + non-null string field/value).
function translateInlineRule(r) {
    return {
        type: STREAM_RULE_TYPE_TO_NUMERIC[r.type],
        value: r.value === undefined || r.value === null ? "" : String(r.value),
        field: r.field ?? "",
        inverted: r.inverted ?? false,
        description: r.description ?? null,
    };
}

export const handleCreateStream = defineMutatingHandler({
    name: "create_stream",
    schema: CreateStreamSchema,
    async build(args) {
        const client = makeClient(args._conn);

        // M5: 3-bucket title-similarity classifier (D-05/D-06). Strictest wins.
        // findExistingMatches drops items where classifySimilarity returns null.
        const existingMatches = await findExistingMatches(client, {
            listPath: "/api/streams",
            matchFn: (s) => classifySimilarity(args.title, s.title) !== null,
            similarityReason: (s) => classifySimilarity(args.title, s.title),
        });

        const wireRules = (args.rules ?? []).map(translateInlineRule);

        return {
            method: "POST",
            path: "/api/streams",
            body: {
                entity: {
                    title: args.title,
                    description: args.description ?? null,
                    rules: wireRules,
                    content_pack: null,
                    matching_type: args.matching_type ?? "AND",
                    remove_matches_from_default_stream:
                        args.remove_matches_from_default_stream ?? false,
                    index_set_id: args.index_set_id,  // REQUIRED per D-10
                },
                share_request: null,
            },
            existingMatches,
            postApplyEstimate: { id: "__SERVER_ASSIGNED__" },
            normalize: (raw) => toIdBody(raw, { idFields: ["stream_id", "id"] }),
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) => `Create stream "${args.title}" (index set ${args.index_set_id})`,
});
