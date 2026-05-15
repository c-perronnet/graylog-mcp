// STREAM-07 — list_stream_rules. Narrow projection per rule:
//   [id, type, field, value, inverted]
//
// The wire endpoint is GET /api/streams/{streamId}/rules and returns a
// StreamRuleListResponse envelope { total: int, stream_rules: StreamRule[] }.
// defineListHandler does NOT pre-resolve the connection for path
// construction, so the fetch callback reads args.streamId directly to
// parameterise the URL.
//
// Why a separate read tool when get_stream already returns rules embedded
// (Discretion-02 resolution): list_stream_rules emits a narrower projection
// (5 fields per rule) than get_stream (full DTO with description + stream_id
// per rule plus the parent stream's 15-field envelope). For streams with
// many rules, the narrow projection saves significant tokens in the agent's
// context window. get_stream remains the rich-shape read for cases where
// the agent needs everything in one call.
//
// type is the numeric StreamRuleType (1..8 in Graylog 7.0.6):
//   1=EXACT, 2=REGEX, 3=GREATER, 4=SMALLER, 5=PRESENCE, 6=CONTAINS,
//   7=ALWAYS_MATCH, 8=MATCH_INPUT (D-11 reconfirmed).

import { defineListHandler } from "../_shared/list.js";
import { ListStreamRulesSchema } from "./schemas.js";

const STREAM_RULE_DEFAULT_FIELDS = ["id", "type", "field", "value", "inverted"];

export const handleListStreamRules = defineListHandler({
    name: "list_stream_rules",
    schema: ListStreamRulesSchema,
    defaultFields: STREAM_RULE_DEFAULT_FIELDS,
    fetch: async (client, args) => {
        const response = await client.request(
            "GET",
            `/api/streams/${args.streamId}/rules`,
            null,
        );
        return response?.stream_rules ?? [];
    },
});
