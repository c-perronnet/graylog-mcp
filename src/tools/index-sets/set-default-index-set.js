// INDEX-06: set_default_index_set — designate an index set as the Graylog
// default (the destination for messages on any stream without an explicit
// index-set assignment).
//
// UPDATED D-13 + Pitfall m2: Graylog's server-side check refuses the PUT
// with a 409 if the target index set is not eligible to be a default (e.g.
// it's the events index, a system index, or otherwise restricted). The
// authoritative server-side eligibility answer is exposed on the
// IndexSetResponse DTO as `can_be_default: boolean` — a derived field that
// absorbs the regular: true invariant today AND any future eligibility
// rules Graylog adds without a wrapper-side update.
//
// This wrapper PRE-FLIGHTS the GET on the target index set and reads
// current.can_be_default. When false, build() throws GraylogValidationError
// with reason `default_eligibility_failed` so the would-be 409 surfaces in
// dry-run, NOT apply. The agent sees the structural problem before issuing
// the destructive call.
//
// Apply envelope: PUT /api/system/indices/index_sets/{id}/default returns
// the full IndexSetResponse DTO with `default: true`. The wrapper's normalize
// step maps that to { id: indexSetId, body: <response> }.
//
// Defense in depth: even if a future regression bypassed the wrapper-side
// can_be_default check, the Graylog server-side eligibility check still
// throws 409 on apply. Two-layer defense.

import { defineMutatingHandler } from "../_shared/handler.js";
import { SetDefaultIndexSetSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { GraylogValidationError } from "../../graylog/errors.js";

export const handleSetDefaultIndexSet = defineMutatingHandler({
    name: "set_default_index_set",
    schema: SetDefaultIndexSetSchema,
    async build(args) {
        const conn = args._conn;
        const client = makeClient(conn);
        const indexSetPath = `/api/system/indices/index_sets/${args.indexSetId}`;
        const defaultPath = `${indexSetPath}/default`;

        // Pre-flight GET — read the server's authoritative eligibility flag.
        const current = await client.request("GET", indexSetPath, null);

        // UPDATED D-13: read can_be_default (NOT the underlying `regular`
        // boolean). The server-side derived flag is the durable gate.
        if (current.can_be_default === false) {
            const err = new GraylogValidationError(
                `Index set "${current.title}" (${args.indexSetId}) is not eligible as the default index set (can_be_default: false). The server's derived eligibility flag covers events-style and system index sets and any future eligibility rules Graylog adds.`,
                { status: 409, method: "PUT", path: defaultPath },
            );
            err.reason = "default_eligibility_failed";
            throw err;
        }

        // Eligible — emit the PUT descriptor. The /default endpoint takes
        // no body; the index-set id is in the path.
        return {
            method: "PUT",
            path: defaultPath,
            body: undefined,
            postApplyEstimate: {
                id: args.indexSetId,
                isDefault: true,
            },
        };
    },
    apply: async (client, req) => {
        return client.request(req.method, req.path, req.body);
    },
    summarize: (args) => `Set default index set to ${args.indexSetId}`,
});
