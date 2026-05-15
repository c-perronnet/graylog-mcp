// STREAM-06b — pause_stream. Mirror of start_stream.js (D-12 lifecycle-as-
// mutation; uniform dryRun + writable inheritance + idempotency from
// mutatingBase). D-09 mutable pre-flight refuses with reason
// `stream_immutable` BEFORE the POST.
//
// Endpoint: POST /api/streams/{streamId}/pause — body undefined; Graylog
// returns 204 (synchronous on Graylog's side; no system-job spawning).
//
// Eventually-consistent: this sets the DESIRED state. The tool description
// in tools.js documents that disabled may briefly remain false until
// Graylog's stream registry converges.

import { defineMutatingHandler } from "../_shared/handler.js";
import { PauseStreamSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { GraylogValidationError } from "../../graylog/errors.js";

export const handlePauseStream = defineMutatingHandler({
    name: "pause_stream",
    schema: PauseStreamSchema,
    async build(args) {
        const client = makeClient(args._conn);
        const path = `/api/streams/${args.streamId}`;

        // D-09 mutable defense-in-depth pre-flight.
        const current = await client.request("GET", path, null);
        if (current.is_editable === false) {
            const err = new GraylogValidationError(
                `Stream "${current.title ?? args.streamId}" (id: ${args.streamId}) ` +
                `is non-editable; refusing pause. ` +
                `stream_immutable: call list_streams and filter by mutable: true.`,
                { status: 400, method: "POST", path: `${path}/pause` },
            );
            err.reason = "stream_immutable";
            throw err;
        }

        return {
            method: "POST",
            path: `${path}/pause`,
            body: undefined,
            postApplyEstimate: { id: args.streamId, disabled: true },
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) => `Pause stream ${args.streamId}`,
});
