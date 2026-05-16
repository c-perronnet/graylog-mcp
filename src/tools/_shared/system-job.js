// INDEX-08 — await_system_job: poll GET /api/system/jobs/{jobId} with
// exponential backoff (D-06: 500→1000→2000→4000→5000ms, capped at 5s),
// terminate on job_status complete|paused|error|cancelled OR percent_complete
// === 100 OR 404 (pruned from running map → completed:true synthetic).
//
// Lives in _shared/ (not index-sets/) because Phase 3+ async tools (stream
// delete cascades, pipeline rule apply, event-def schedule) will reuse it.
// Phase 2 is the first consumer.
//
// D-07: routes through defineMutatingHandler so dryRun + writable-flag
// inheritance is uniform. dryRun:true returns the polling plan WITHOUT
// issuing any GETs (the polling itself is the "apply").
//
// UPDATED D-15 (CONTEXT.md 2026-05-15): delete_index_set apply envelope
// deliberately omits job_id (Graylog DELETE returns 204 no body). The agent
// discovers the cleanup job by passing `info_substring: <indexSetId>` —
// this handler then GETs /system/jobs, finds the entry whose info contains
// the substring, and polls that entry's id. Exactly-one-of:
//   - jobId: bare string
//   - jobIdOrEnvelope: bare string OR object with job_id/jobId/id
//   - info_substring: discovery substring matched against SystemJobSummary.info
// is enforced via zod .refine().

import { z } from "zod";
import { defineMutatingHandler } from "./handler.js";
import { mutatingBase } from "./schemas.js";

export const BACKOFF_SCHEDULE = [500, 1000, 2000, 4000, 5000];
export const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 600_000;

// Discretion-04: forgiving input. Accept (a) bare jobId string, (b) envelope
// objects with job_id / jobId / id keys.
const JobIdOrEnvelope = z.union([
    z.string().min(1),
    z.object({ job_id: z.string().min(1) }).passthrough(),
    z.object({ jobId: z.string().min(1) }).passthrough(),
    z.object({ id: z.string().min(1) }).passthrough(),
]);

export const AwaitSystemJobSchema = mutatingBase.extend({
    jobIdOrEnvelope: JobIdOrEnvelope.optional(),
    jobId: z.string().min(1).optional(),
    info_substring: z.string().min(1).optional(),  // UPDATED D-15: discovery path
    timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional(),
    // Reserved — unused by await_system_job; kept for shape parity with
    // confirmation-gated tools so a future blueprint that pipes the same
    // arg map through await_system_job doesn't trip on an unknown key.
    confirm: z.string().optional(),
}).refine(
    // Exactly one of jobId / jobIdOrEnvelope / info_substring must be provided.
    (a) => {
        const provided = [a.jobId, a.jobIdOrEnvelope, a.info_substring].filter(
            (v) => v !== undefined,
        ).length;
        return provided === 1;
    },
    { message: "exactly one of jobId / jobIdOrEnvelope / info_substring is required" },
);

export function extractJobId(args) {
    if (args.jobId) return args.jobId;
    const env = args.jobIdOrEnvelope;
    if (env === undefined) return undefined;
    if (typeof env === "string") return env;
    return env?.job_id ?? env?.jobId ?? env?.id;
}

// UPDATED D-15: discover a job by matching `info` substring. Returns either
// { ok: true, jobId } OR { isError: true, reason, message, matches? } so the
// caller can render a clean MCP error envelope. The matches array is included
// on ambiguous_info_substring so the agent can re-call with the full job_id.
export async function resolveJobIdFromInfo(client, info_substring) {
    const list = await client.request("GET", "/api/system/jobs", null);
    const jobs = Array.isArray(list) ? list : (list?.jobs ?? []);
    // F-21 (Phase 2 IN-04): Graylog job-description casing drifts across
    // versions (e.g. "Building index ranges" vs "BUILDING INDEX RANGES"), so
    // normalize both operands to lowercase before substring-matching. A
    // case-sensitive match would silently return job_not_found on a version
    // whose `info` casing differs from what the agent supplied.
    const needle = info_substring.toLowerCase();
    const matches = jobs.filter(
        (j) => typeof j?.info === "string" && j.info.toLowerCase().includes(needle),
    );
    if (matches.length === 0) {
        return {
            isError: true,
            reason: "job_not_found",
            message: `No system job found with info containing "${info_substring}". The job may have completed and been pruned, or the cleanup may not have started yet — retry after a brief delay.`,
        };
    }
    if (matches.length >= 2) {
        return {
            isError: true,
            reason: "ambiguous_info_substring",
            message: `Multiple system jobs match info substring "${info_substring}": ${matches.map((m) => m.id).join(", ")}. Re-call with a specific jobId.`,
            matches: matches.map((m) => ({ id: m.id, info: m.info })),
        };
    }
    return { ok: true, jobId: matches[0].id };
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Test seam: replace sleep with a pass-through for deterministic tests.
// `null` argument resets to real sleep. Production code MUST NOT call this.
let _sleepImpl = realSleep;
export function _setSleepForTests(fn) {
    _sleepImpl = fn ?? realSleep;
}

export const handleAwaitSystemJob = defineMutatingHandler({
    name: "await_system_job",
    schema: AwaitSystemJobSchema,
    async build(args) {
        const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        // info_substring branch: dry-run shows the resolution plan WITHOUT
        // firing the list call. Apply phase performs list + poll.
        if (args.info_substring !== undefined) {
            return {
                method: "GET",
                path: "/api/system/jobs",  // list endpoint (apply will resolve, then poll)
                body: undefined,
                postApplyEstimate: {
                    info_substring: args.info_substring,
                    discovery: "list_then_poll",
                    plan: BACKOFF_SCHEDULE,
                    timeoutMs,
                    note: "Apply (dryRun:false) GETs /system/jobs, matches info_substring, then polls the matching job's id with exponential backoff.",
                },
            };
        }
        // jobId / jobIdOrEnvelope branch: standard direct-poll plan.
        const jobId = extractJobId(args);
        return {
            method: "GET",
            path: `/api/system/jobs/${jobId}`,
            body: undefined,
            postApplyEstimate: {
                jobId,
                plan: BACKOFF_SCHEDULE,
                timeoutMs,
                note: "Apply (dryRun:false) blocks until job completes, errors, is cancelled, or timeout fires.",
            },
        };
    },
    apply: async (client, req) => {
        const { jobId: directJobId, info_substring, timeoutMs } = req.postApplyEstimate;

        // UPDATED D-15 discovery: resolve info_substring to a concrete jobId
        // before polling. Errors surface as MCP error envelopes; the wrapper
        // renders apply()'s isError-tagged return verbatim.
        let jobId = directJobId;
        if (info_substring !== undefined) {
            const resolved = await resolveJobIdFromInfo(client, info_substring);
            if (resolved.isError) {
                return {
                    isError: true,
                    reason: resolved.reason,
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            tool: "await_system_job",
                            reason: resolved.reason,
                            message: resolved.message,
                            ...(resolved.matches ? { matches: resolved.matches } : {}),
                        }),
                    }],
                };
            }
            jobId = resolved.jobId;
        }

        const pollPath = `/api/system/jobs/${jobId}`;
        const deadline = Date.now() + timeoutMs;
        let i = 0;
        while (Date.now() < deadline) {
            const remaining = deadline - Date.now();
            const scheduled = BACKOFF_SCHEDULE[Math.min(i, BACKOFF_SCHEDULE.length - 1)];
            const delay = Math.min(scheduled, remaining);
            if (delay <= 0) break;
            await _sleepImpl(delay);
            i++;
            try {
                const summary = await client.request("GET", pollPath, null);
                if (summary?.job_status === "complete" || summary?.percent_complete === 100) {
                    return { jobId, completed: true, finalStatus: summary };
                }
                if (
                    summary?.job_status === "paused"
                    || summary?.job_status === "error"
                    || summary?.job_status === "cancelled"
                ) {
                    return { jobId, completed: false, finalStatus: summary };
                }
            } catch (err) {
                if (err?.status === 404) {
                    return {
                        jobId,
                        completed: true,
                        finalStatus: { synthetic: true, reason: "job_no_longer_in_running_jobs" },
                    };
                }
                throw err;
            }
        }
        return {
            jobId,
            completed: false,
            timedOut: true,
            message: `await_system_job timed out after ${timeoutMs}ms`,
        };
    },
    summarize: (args) => {
        if (args.info_substring !== undefined) {
            return `Discover + wait for system job (info contains "${args.info_substring}")`;
        }
        return `Wait for system job ${extractJobId(args)}`;
    },
});
