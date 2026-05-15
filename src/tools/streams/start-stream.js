// STREAM-06a — start_stream. Composes through defineMutatingHandler per D-12
// (lifecycle-as-mutation; uniform dryRun + writable inheritance + idempotency
// from mutatingBase). D-09 mutable pre-flight refuses with reason
// `stream_immutable` BEFORE the POST.
//
// Endpoint: POST /api/streams/{streamId}/resume — body undefined; Graylog
// returns 204 (synchronous on Graylog's side; no system-job spawning).
//
// Eventually-consistent: this sets the DESIRED state. The tool description
// in tools.js documents that disabled may briefly remain true until
// Graylog's stream registry converges — same pattern as Phase 1's
// start_input precedent.

import { defineMutatingHandler } from "../_shared/handler.js";
import { StartStreamSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { GraylogValidationError } from "../../graylog/errors.js";

export const handleStartStream = defineMutatingHandler({
    name: "start_stream",
    schema: StartStreamSchema,
    async build(args) {
        const client = makeClient(args._conn);
        const path = `/api/streams/${args.streamId}`;

        // D-09 mutable defense-in-depth pre-flight. Wire field is_editable
        // (Pitfall S2); refusal carries err.reason = "stream_immutable" so
        // the dispatcher can pattern-match without parsing the message.
        const current = await client.request("GET", path, null);
        if (current.is_editable === false) {
            const err = new GraylogValidationError(
                `Stream "${current.title ?? args.streamId}" (id: ${args.streamId}) ` +
                `is non-editable; refusing start. ` +
                `stream_immutable: call list_streams and filter by mutable: true.`,
                { status: 400, method: "POST", path: `${path}/resume` },
            );
            err.reason = "stream_immutable";
            throw err;
        }

        return {
            method: "POST",
            path: `${path}/resume`,
            body: undefined,
            postApplyEstimate: { id: args.streamId, disabled: false },
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) => `Resume stream ${args.streamId}`,
});
