// INDEX-07: cycle_deflector — manually rotate the deflector for an index
// set. Closes the current active write index and opens the next one;
// Graylog's deflector alias is re-pointed to the new index so subsequent
// writes land in the rotated index.
//
// UPDATED D-14 (per 02-U1-SMOKE.md SYNC_OPTION_A): the cycle is
// SYNCHRONOUS in Graylog 7.0.6 — DeflectorResource.cycle calls
// indexSet.cycle() directly on the JVM thread, NOT via
// systemJobManager.submit. The POST returns 204 with no body once the
// rotation is complete. No system_job_id is returned for the rotation
// itself.
//
// Side effect: closing the previous active index triggers a separate
// IndexRangesUpdateJob to rebuild the closed index's message ranges so
// time-range searches still hit it. That job IS asynchronous and IS
// observable via /system/jobs. The wrapper's apply envelope surfaces
// the side-effect explicitly so an agent can call await_system_job
// with info_substring on the indexSetId if it cares about waiting for
// the rebuild before searching the just-closed index.
//
// This is NOT the D-15 async envelope. The rotation itself is complete
// when the apply response returns; only the secondary range-rebuild is
// async, and it's surfaced via side_effects.observable_at, not by
// promoting the whole rotation to the async envelope shape.
//
// Pitfall ND3 (RESEARCH.md §Pitfall ND3): DeflectorResource.checkCycle
// throws 400 if !indexSet.getConfig().isWritable(). This wrapper
// pre-flights GET on the target index set and refuses with
// GraylogValidationError + reason `non_writable_index_set` BEFORE the
// POST fires. Two-layer defense (server-side check + wrapper-side check).
//
// Pitfall m3 (RESEARCH.md §Pitfall m3): in-flight writes may briefly
// buffer until the new active index is ready. This is inherent to the
// rotation mechanism; documented in the tool description so the agent
// can reason about the brief gap.

import { defineMutatingHandler } from "../_shared/handler.js";
import { CycleDeflectorSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { GraylogValidationError } from "../../graylog/errors.js";

const RANGE_REBUILD_DESCRIBES =
    "closed-index range rebuild (IndexRangesUpdateJob fires asynchronously; the rotation itself is complete on response)";

export const handleCycleDeflector = defineMutatingHandler({
    name: "cycle_deflector",
    schema: CycleDeflectorSchema,
    async build(args) {
        const conn = args._conn;
        const client = makeClient(conn);
        const indexSetPath = `/api/system/indices/index_sets/${args.indexSetId}`;
        const cyclePath = `/api/system/deflector/${args.indexSetId}/cycle`;

        // Pre-flight GET — ND3 check.
        const current = await client.request("GET", indexSetPath, null);

        if (current.writable === false) {
            const err = new GraylogValidationError(
                `Index set "${current.title}" (${args.indexSetId}) is not writable; cannot cycle. Set writable: true via update_index_set first.`,
                { status: 400, method: "POST", path: cyclePath },
            );
            err.reason = "non_writable_index_set";
            throw err;
        }

        // Writable — emit the POST descriptor. UPDATED D-14: the rotation
        // itself is synchronous; the closed-index range rebuild is the
        // async side effect surfaced via side_effects.observable_at.
        return {
            method: "POST",
            path: cyclePath,
            body: undefined,
            postApplyEstimate: {
                id: args.indexSetId,
                async: false, // UPDATED D-14 — cycle is SYNCHRONOUS
                rotated: true,
                message: `Cycled index set ${args.indexSetId}; closed previous active index`,
                side_effects: {
                    observable_at: "/system/jobs",
                    describes: RANGE_REBUILD_DESCRIBES,
                },
            },
        };
    },
    apply: async (client, req) => {
        // Per UPDATED D-14: POST returns 204 with no body; the rotation
        // is complete on response. Extract the indexSetId from req.path
        // so the apply-time message stays consistent with the dry-run
        // preview and contains the substring the agent can pass to
        // await_system_job(info_substring) for the range-rebuild job.
        await client.request(req.method, req.path, req.body);
        const m = req.path.match(/deflector\/([^/]+)\/cycle/);
        const indexSetId = m ? m[1] : "unknown";
        return {
            rotated: true,
            message: `Cycled index set ${indexSetId}; closed previous active index. Deflector cycle complete on Graylog side.`,
            side_effects: {
                observable_at: "/system/jobs",
                describes: RANGE_REBUILD_DESCRIBES,
            },
        };
    },
    summarize: (args) => `Cycle deflector for index set ${args.indexSetId}`,
});
