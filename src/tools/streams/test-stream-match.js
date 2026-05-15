// STREAM-11 — test_stream_match. D-07: pure server-side wrapper. NO JS
// re-implementation of rule semantics. Graylog is authoritative for regex
// flags, type coercion, the `inverted` flag, and the global stream
// matching_type (AND | OR). We forward the sample message verbatim and
// return Graylog's response unchanged.
//
// D-08: streamId REQUIRED. Pre-create config testing is out of scope — the
// agent's flow is: create_stream(dryRun:true) → review preview → create for
// real → test_stream_match against the real id. The tool description in
// tools.js documents this contract explicitly.
//
// Wire body: { "message": <field-map> } — the LITERAL outer key "message"
// is required per StreamResource.java:561-564 (the resource method signature
// literally consumes Map<String, Map<String, Object>> with the outer key
// checked against the constant "message"). See 03-RESEARCH.md §Pattern 7 for
// the doubled-key explanation (the outer envelope key "message" is distinct
// from the inner Graylog message-field name "message" — the message field
// happens to be one of the canonical Graylog message-field names, but the
// outer key is structural envelope, not a field).
//
// Response shape: { matches: boolean, rules: { <ruleId>: boolean } } —
// forwarded verbatim under result.body (defineMutatingHandler's default
// normalize: toIdBody fallback maps raw → { id: raw?.id, body: raw }).
// No enrichment, no projection, no join with rule names — the agent can
// call list_stream_rules separately for rule-by-name visibility.
//
// Routes through defineMutatingHandler even though this is read-shaped
// (no Graylog state change). Rationale: an agent invoking test_stream_match
// with dryRun:true should see the would-be POST body — the dryRun
// guarantee is a project-wide invariant for ANY POST/PUT/DELETE call. The
// connection's writable gate also applies (read-only connections refuse to
// fire POST testMatch — preserves the cross-cutting "no side effects on
// read-only" stance).

import { defineMutatingHandler } from "../_shared/handler.js";
import { TestStreamMatchSchema } from "./schemas.js";

export const handleTestStreamMatch = defineMutatingHandler({
    name: "test_stream_match",
    schema: TestStreamMatchSchema,
    build(args) {
        return {
            method: "POST",
            path: `/api/streams/${args.streamId}/testMatch`,
            // LITERAL outer key "message" — case-sensitive. The agent's
            // field-map sits one level deeper.
            body: { message: args.message },
            postApplyEstimate: {
                matches: "__SERVER_ASSIGNED__",
                rules: "__SERVER_ASSIGNED__",
            },
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        `Test stream ${args.streamId} match against sample message (${Object.keys(args.message).length} field(s))`,
});
