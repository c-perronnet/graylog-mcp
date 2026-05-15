// STREAM-08 — create_stream_rule. POST /api/streams/{streamId}/rules.
//
// D-09 parent-mutable pre-flight: GET /api/streams/{streamId}; refuse with
// reason `stream_immutable` BEFORE the POST fires when current.is_editable ===
// false. Built-in streams (system events / failures / collector logs) reject
// rule changes at the server level too — this wrapper-side check saves the
// round-trip and surfaces a structured reason the dispatcher can pattern-
// match without parsing the message.
//
// Pitfall S9: agent-facing API uses string discriminators (StreamRuleSchema's
// 8-variant union); wire format is numeric int via STREAM_RULE_TYPE_TO_NUMERIC
// (1=EXACT, 2=REGEX, 3=GREATER, 4=SMALLER, 5=PRESENCE, 6=CONTAINS,
// 7=ALWAYS_MATCH, 8=MATCH_INPUT — verified at StreamRuleType.java).
//
// Pitfall S10: value/field are non-nullable String on the wire (per
// CreateStreamRuleRequest.java). Variants that semantically lack a value
// (always_match, present) emit `value: ""`; variants that lack a field
// (always_match, match_input) emit `field: ""`. The schema-layer rejection
// of missing required fields plus the build-layer defaults make
// "wire body has the wrong shape" structurally unreachable.
//
// Pitfall S7: response is 201 + `{ streamrule_id }` per Graylog 7.0.6's
// StreamRuleResource.java. toIdBody({ idFields: ["streamrule_id", "id"] })
// handles both the canonical streamrule_id and a rare fallback to id.

import { defineMutatingHandler } from "../_shared/handler.js";
import { CreateStreamRuleSchema, STREAM_RULE_TYPE_TO_NUMERIC } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { toIdBody } from "../../graylog/normalize.js";
import { GraylogValidationError } from "../../graylog/errors.js";

export const handleCreateStreamRule = defineMutatingHandler({
    name: "create_stream_rule",
    schema: CreateStreamRuleSchema,
    async build(args) {
        const client = makeClient(args._conn);
        const parentPath = `/api/streams/${args.streamId}`;

        // D-09 parent-mutable pre-flight (FIRST). Wire field is is_editable
        // (Pitfall S2 — list_streams projects it to mutable; canonical wire
        // name used here per defense-in-depth doctrine).
        const parent = await client.request("GET", parentPath, null);
        if (parent.is_editable === false) {
            const err = new GraylogValidationError(
                `Parent stream "${parent.title ?? args.streamId}" (id: ${args.streamId}) ` +
                `is non-editable; refusing rule creation. ` +
                `stream_immutable: call list_streams and filter by mutable: true ` +
                `to find an editable candidate.`,
                { status: 400, method: "POST", path: `${parentPath}/rules` },
            );
            err.reason = "stream_immutable";
            throw err;
        }

        // Pitfall S9 + S10: numeric translation + non-nullable wire defaults.
        // STREAM_RULE_TYPE_TO_NUMERIC is Object.frozen so an off-map
        // discriminator can't sneak through if the schema is later widened.
        const wireType = STREAM_RULE_TYPE_TO_NUMERIC[args.type];
        const wireBody = {
            type: wireType,
            value: args.value === undefined || args.value === null ? "" : String(args.value),
            field: args.field ?? "",
            inverted: args.inverted ?? false,
            description: args.description ?? null,
        };

        return {
            method: "POST",
            path: `${parentPath}/rules`,
            body: wireBody,
            postApplyEstimate: { id: "__SERVER_ASSIGNED__" },
            normalize: (raw) => toIdBody(raw, { idFields: ["streamrule_id", "id"] }),
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        `Create ${args.type} rule on stream ${args.streamId}`,
});
