// INPUT-07b: stop_input — DELETE /api/system/inputstates/{inputId}.
//
// The verb mapping is counterintuitive: intuition says "stop is a PUT with
// state=STOPPED". Graylog 7.x reality is that START is PUT and STOP is
// DELETE on the same `/api/system/inputstates/{id}` path. The verb itself
// carries the lifecycle direction. See RESEARCH.md §"Pitfall: Lifecycle
// stop_input Maps to a DELETE Verb" — the tool description in tools.js
// documents this so the agent never has to know the underlying REST quirk.
//
// D-08: same defineMutatingHandler composition as start_input — dryRun +
// writable-gate + idempotency inherit uniformly.
//
// Eventually-consistent: this sets DESIRED state to STOPPED; actual state
// may briefly remain STOPPING. Tool description in tools.js documents this.

import { defineMutatingHandler } from "../_shared/handler.js";
import { StopInputSchema } from "./schemas.js";

export const handleStopInput = defineMutatingHandler({
    name: "stop_input",
    schema: StopInputSchema,
    build(args) {
        return {
            method: "DELETE",
            path: `/api/system/inputstates/${args.inputId}`,
            body: undefined,
            postApplyEstimate: { id: args.inputId },
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) => `Stop input ${args.inputId}`,
});
