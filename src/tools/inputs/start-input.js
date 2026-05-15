// INPUT-07a: start_input — PUT /api/system/inputstates/{inputId}.
//
// D-08: lifecycle composes through defineMutatingHandler like every other
// mutation. No special-cased runtime path — dryRun + writable-gate +
// idempotency inherit from mutatingBase.
//
// The verb is PUT (not POST, not "PATCH with state=RUNNING"). The path
// segment "inputstates" is plural; the {inputId} is the input UUID. Graylog
// returns 200 + InputCreated.create(inputId) → { id }.
//
// Eventually-consistent: this sets the DESIRED state. Actual state may
// briefly remain STARTING. Tool description in tools.js documents this so
// the agent doesn't poll get_input immediately and assume failure.

import { defineMutatingHandler } from "../_shared/handler.js";
import { StartInputSchema } from "./schemas.js";

export const handleStartInput = defineMutatingHandler({
    name: "start_input",
    schema: StartInputSchema,
    build(args) {
        return {
            method: "PUT",
            path: `/api/system/inputstates/${args.inputId}`,
            body: undefined,
            // The agent supplied the inputId, so the postApplyEstimate.id
            // is known up front. Not __SERVER_ASSIGNED__ — this isn't a
            // create-shaped tool.
            postApplyEstimate: { id: args.inputId },
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) => `Start input ${args.inputId}`,
});
