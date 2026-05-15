// STREAM-09 — update_stream_rule. PUT /api/streams/{streamId}/rules/{ruleId}.
//
// U1 smoke RESULT (.planning/phases/03-streams-stream-rules/03-U1-SMOKE.md):
// UNREACHABLE_STRICT_NO_ECHO — no API token was available to the Plan 03-01
// smoke executor, so the live partial-PUT probe could not be performed.
// Per the 02-U1-SMOKE.md precedent + 03-RESEARCH.md §Pattern 6 safe-default
// recommendation, STRICT_NO_ECHO is LOCKED for this handler.
//
// STRICT_NO_ECHO contract: the wire body emits ONLY the fields present in
// args.changes — with ONE structural exception (Pitfall S8 below). The wrapper
// does NOT echo other current.* fields.
//
// Pitfall S8 (the critical caveat): Graylog's CreateStreamRuleRequest.type()
// is a non-nullable Java `int` — meaning the deserializer requires the `type`
// field on every PUT, even when the agent did not change it. The wrapper
// therefore emits `type: current.type` from the pre-flight GET on the rule
// unconditionally, regardless of whether args.changes touched it. This is the
// ONE field where strict-no-echo "echoes back current" out of structural
// necessity. The schema (UpdateStreamRuleSchema) does NOT allow `type` in
// args.changes — immutability is enforced at the zod layer (via
// UpdateStreamRuleChangesShape not declaring `type` as a key, so zod strips
// it on parse). Defense-in-depth: even if a future schema widening let `type`
// through, the build() below sources it from current.type and ignores the
// agent's value.
//
// D-09 parent-mutable defense-in-depth: GET /api/streams/{streamId} BEFORE
// the GET on the rule itself; refuse with reason `stream_immutable` when
// parent is_editable === false. Saves a rule-GET round-trip on doomed calls
// against built-in / system streams.
//
// If the live instance is later reachable and STRICT_NO_ECHO is empirically
// falsified by HTTP 400 "missing required field" responses, the wrapper can
// widen toward merge-from-current without a back-compat break (the strict-
// no-echo body is a strict subset of the merge body).

import { defineMutatingHandler } from "../_shared/handler.js";
import { UpdateStreamRuleSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { toIdBody } from "../../graylog/normalize.js";
import { GraylogValidationError } from "../../graylog/errors.js";

export const handleUpdateStreamRule = defineMutatingHandler({
    name: "update_stream_rule",
    schema: UpdateStreamRuleSchema,
    async build(args) {
        const client = makeClient(args._conn);
        const parentPath = `/api/streams/${args.streamId}`;
        const rulePath = `${parentPath}/rules/${args.ruleId}`;

        // D-09 parent-mutable pre-flight (FIRST — saves a rule-GET round-trip
        // on doomed calls against built-in streams).
        const parent = await client.request("GET", parentPath, null);
        if (parent.is_editable === false) {
            const err = new GraylogValidationError(
                `Parent stream "${parent.title ?? args.streamId}" (id: ${args.streamId}) ` +
                `is non-editable; refusing rule update. ` +
                `stream_immutable: call list_streams and filter by mutable: true.`,
                { status: 400, method: "PUT", path: rulePath },
            );
            err.reason = "stream_immutable";
            throw err;
        }

        // Pitfall S8: pre-flight the rule itself to source current.type. The
        // StreamRule wire shape exposes `type` as int (1..8 per StreamRuleType.java).
        // We forward verbatim — current.type is the wire numeric, ready to ship.
        const current = await client.request("GET", rulePath, null);

        // STRICT_NO_ECHO wire body (per U1 smoke result):
        //   - type is ALWAYS present, echoed from current.type (Pitfall S8 —
        //     non-nullable Java int).
        //   - field, value, inverted, description are emitted ONLY when
        //     args.changes set them. The conditional-spread pattern preserves
        //     agent intent: passing `description: null` emits `description: null`
        //     (clear intent); omitting `description` emits nothing (no change).
        const wireBody = {
            type: current.type,  // Pitfall S8 — non-nullable; ALWAYS on wire
            ...(args.changes.field !== undefined ? { field: args.changes.field } : {}),
            ...(args.changes.value !== undefined ? { value: String(args.changes.value) } : {}),
            ...(args.changes.inverted !== undefined ? { inverted: args.changes.inverted } : {}),
            ...(args.changes.description !== undefined ? { description: args.changes.description } : {}),
        };

        return {
            method: "PUT",
            path: rulePath,
            body: wireBody,
            postApplyEstimate: { id: args.ruleId },
            normalize: (raw) => toIdBody(raw, { idFields: ["streamrule_id", "id"] }),
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        `Update rule ${args.ruleId} on stream ${args.streamId} (${Object.keys(args.changes).length} change(s))`,
});
