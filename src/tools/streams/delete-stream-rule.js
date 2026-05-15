// STREAM-10 — delete_stream_rule. LEAF DELETE per Discretion-04.
//
// Why leaf: a stream rule is a child of a stream, but it has no further
// dependents — deleting a rule does not cascade to any other resource.
// This is structurally different from delete_stream (Plan 03), which
// owns the C2 mitigation centerpiece because deleting a stream silently
// cascades to rules + pipeline connections + event definitions.
//
// Wrapper contract per Discretion-04:
//   - NO cascade enumeration (no GET on dependents).
//   - NO confirmation hash (no computeCascadeHash; no _confirmationToken).
//   - NO requireConfirm gate.
//   - build() returns a descriptor WITHOUT a `cascades` key.
//     handler.js's preview emitter spreads `cascades` only when truthy
//     (Plan 02-01 amendment), so the dry-run JSON omits the field
//     entirely — the structural assertion of leaf-delete.
//
// ONE pre-flight only: D-09 parent-mutable check on the parent stream.
// Built-in / system streams reject rule mutations server-side; this
// wrapper-side gate surfaces a structured `stream_immutable` reason
// BEFORE the DELETE round-trips. Pitfall S12: leaf-delete still owes
// the parent-mutable check.
//
// Wire path: DELETE /api/streams/{streamId}/rules/{ruleId} → 204 No Content.
// Sync (no system-job; no Phase 2 D-15 async envelope).

import { defineMutatingHandler } from "../_shared/handler.js";
import { DeleteStreamRuleSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { GraylogValidationError } from "../../graylog/errors.js";

export const handleDeleteStreamRule = defineMutatingHandler({
    name: "delete_stream_rule",
    schema: DeleteStreamRuleSchema,
    async build(args) {
        const client = makeClient(args._conn);
        const parentPath = `/api/streams/${args.streamId}`;
        const rulePath = `${parentPath}/rules/${args.ruleId}`;

        // D-09 parent-mutable pre-flight (Pitfall S12).
        const parent = await client.request("GET", parentPath, null);
        if (parent.is_editable === false) {
            const err = new GraylogValidationError(
                `Parent stream "${parent.title ?? args.streamId}" (id: ${args.streamId}) ` +
                `is non-editable; refusing rule deletion. ` +
                `stream_immutable: call list_streams and filter by mutable: true.`,
                { status: 400, method: "DELETE", path: rulePath },
            );
            err.reason = "stream_immutable";
            throw err;
        }

        // Leaf delete — NO `cascades` key, NO `_confirmationToken`.
        // handler.js spreads cascades only when truthy and emits
        // confirmationToken only when _confirmationToken is set, so the
        // dry-run JSON omits both. Discretion-04 structural conformance.
        return {
            method: "DELETE",
            path: rulePath,
            body: undefined,
            postApplyEstimate: { id: args.ruleId, deleted: true },
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        `Delete rule ${args.ruleId} from stream ${args.streamId}`,
});
