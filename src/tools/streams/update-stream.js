// STREAM-04 — update_stream. PUT /api/streams/{streamId}.
//
// U1 smoke RESULT (.planning/phases/03-streams-stream-rules/03-U1-SMOKE.md):
// UNREACHABLE_STRICT_NO_ECHO — no API token available to the Plan 03-01
// smoke executor, so the live partial-PUT probe could not be performed.
// Per the 02-U1-SMOKE.md precedent + 03-RESEARCH.md §Pattern 6 safe-default
// recommendation, STRICT_NO_ECHO is locked for this handler.
//
// STRICT_NO_ECHO contract: the wire body emits ONLY the fields present in
// args.changes. The wrapper does NOT echo `current.*` fields. Streams carry
// no encrypted fields (verified against StreamResponse.java — no
// `is_encrypted: true` annotation anywhere) so the C3 zero-out pitfall that
// motivated update_input's strict-no-echo path is structurally unreachable
// here; STRICT_NO_ECHO is chosen instead for consistency with Phase 1's
// update_input pattern (D-12) and for smaller wire bytes on the typical
// "rename a stream" / "flip matching_type" path.
//
// D-09 mutable defense-in-depth: pre-flight GET /api/streams/{streamId}
// reads the canonical wire `is_editable` field (NOT the projected
// `mutable` from list_streams — defense in depth means each layer does
// its own check against the canonical source). If false, throw
// GraylogValidationError with reason `stream_immutable` BEFORE the PUT
// fires — the wrapper surfaces this as a structured MCP error envelope
// without the agent ever roundtripping a doomed call.
//
// If the live instance is later reachable and STRICT_NO_ECHO is empirically
// falsified by HTTP 400 "missing required field" responses, the wrapper can
// widen toward merge-from-current without a back-compat break (the strict-
// no-echo body is a strict subset of the merge body; the dry-run JSON
// gains optional keys but the preview shape — { method, path, body } —
// stays valid).

import { defineMutatingHandler } from "../_shared/handler.js";
import { UpdateStreamSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { GraylogValidationError } from "../../graylog/errors.js";
import { toIdBody } from "../../graylog/normalize.js";

export const handleUpdateStream = defineMutatingHandler({
    name: "update_stream",
    schema: UpdateStreamSchema,
    async build(args) {
        const client = makeClient(args._conn);
        const path = `/api/streams/${args.streamId}`;

        // D-09 mutable defense-in-depth (FIRST). Wire field is is_editable
        // (Pitfall S2). Refusal carries a structured reason the agent's
        // dispatcher can pattern-match without parsing the message.
        const current = await client.request("GET", path, null);
        if (current.is_editable === false) {
            const err = new GraylogValidationError(
                `Stream "${current.title ?? args.streamId}" (id: ${args.streamId}) ` +
                `is non-editable (Graylog built-in or system stream). ` +
                `stream_immutable: call list_streams and filter by mutable: true ` +
                `to find an editable candidate.`,
                { status: 400, method: "PUT", path },
            );
            err.reason = "stream_immutable";
            throw err;
        }

        // STRICT_NO_ECHO wire body: emit ONLY the fields the agent passed in
        // args.changes. No echoed current.* fields. The conditional spread
        // pattern preserves agent intent — `description: null` is emitted as
        // `description: null` (intent to clear), whereas omitting description
        // entirely emits nothing.
        const wireBody = {
            ...(args.changes.title !== undefined ? { title: args.changes.title } : {}),
            ...(args.changes.description !== undefined ? { description: args.changes.description } : {}),
            ...(args.changes.matching_type !== undefined ? { matching_type: args.changes.matching_type } : {}),
            ...(args.changes.remove_matches_from_default_stream !== undefined
                ? { remove_matches_from_default_stream: args.changes.remove_matches_from_default_stream }
                : {}),
            ...(args.changes.index_set_id !== undefined ? { index_set_id: args.changes.index_set_id } : {}),
        };

        return {
            method: "PUT",
            path,
            body: wireBody,
            postApplyEstimate: { id: args.streamId },
            normalize: (raw) => toIdBody(raw, { idFields: ["id"] }),
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) => `Update stream ${args.streamId} (${Object.keys(args.changes).length} change(s))`,
});
