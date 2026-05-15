import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";
import {
    handleAwaitSystemJob,
    AwaitSystemJobSchema,
    BACKOFF_SCHEDULE,
    DEFAULT_TIMEOUT_MS,
    extractJobId,
    resolveJobIdFromInfo,
    _setSleepForTests,
} from "../src/tools/_shared/system-job.js";
import {
    _setCaptureRequest,
    _clearCaptureRequest,
    makeClient,
} from "../src/graylog/client.js";
import { GraylogNotFoundError } from "../src/graylog/errors.js";
import {
    _setConnectionsForTests,
    _clearConnectionsForTests,
    setActiveConnection,
} from "../src/config.js";

// Plan 02-01 Task 3 — await_system_job (INDEX-08): cross-domain polling primitive.
// Lives in src/tools/_shared/ because Phase 3+ async tools (stream delete cascade,
// pipeline rule apply, event-def schedule) will reuse it. Phase 2 is the first
// consumer. Composes through defineMutatingHandler so dryRun + writable-flag
// inheritance is uniform (D-07).
//
// Schema accepts EXACTLY ONE of:
//   - jobId: bare string (e.g. agent already has it)
//   - jobIdOrEnvelope: bare string OR object with job_id/jobId/id from an
//     upstream async envelope (Discretion-04: forgiving input)
//   - info_substring: UPDATED D-15 discovery path. delete_index_set's apply
//     envelope deliberately omits job_id (Graylog DELETE returns 204 no body);
//     the agent passes info_substring:<indexSetId> to discover the job by
//     matching its `info` field.

const FAKE_CONN = { baseUrl: "_test", apiToken: "_test", writable: true };

beforeEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
    // Deterministic-time tests: replace the real sleep with a microtask-only
    // pass-through so the polling loop doesn't actually wait. Test 5 (timeout
    // path) reinstates real sleep to exercise the deadline check.
    _setSleepForTests(() => Promise.resolve());
});

afterEach(() => {
    _clearCaptureRequest();
    _clearConnectionsForTests();
    setActiveConnection(null);
    _setSleepForTests(null);
});

// =====================================================================
// Test 1 — dry-run returns polling plan WITHOUT issuing GETs
// =====================================================================

test("await_system_job dry-run returns polling plan WITHOUT issuing GETs", async (t) => {
    _setCaptureRequest(() => {
        throw new Error("MUST NOT GET");
    });
    const res = await handleAwaitSystemJob({
        params: {
            arguments: {
                jobId: "job-1",
                dryRun: true,
                _testConnection: "fake",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.tool, "await_system_job");
    assert.equal(payload.postApplyEstimate.jobId, "job-1");
    assert.deepEqual(payload.postApplyEstimate.plan, [500, 1000, 2000, 4000, 5000]);
    assert.equal(payload.postApplyEstimate.timeoutMs, 60000);
    // Snapshot Fixture 9 (Plan 02-05): D-06 + D-07 acceptance gate — pins the
    // exponential-backoff polling plan [500,1000,2000,4000,5000] capped at 5s
    // + 60s default timeout. Drift here means the backoff schedule changed.
    t.assert.snapshot(payload);
});

// =====================================================================
// Test 2 — success path polls until job_status: complete
// =====================================================================

test("await_system_job success path polls until job_status:complete", async () => {
    const responses = [
        { job_status: "running", percent_complete: 25 },
        { job_status: "running", percent_complete: 60 },
        { job_status: "complete", percent_complete: 100 },
    ];
    let calls = 0;
    _setCaptureRequest(({ method, path }) => {
        assert.equal(method, "GET");
        assert.equal(path, "/api/system/jobs/j");
        calls++;
        return responses.shift();
    });
    const res = await handleAwaitSystemJob({
        params: {
            arguments: {
                jobId: "j",
                dryRun: false,
                timeoutMs: 30000,
                _testConnection: "fake",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    assert.equal(payload.result.body.jobId, "j");
    assert.equal(payload.result.body.completed, true);
    assert.equal(payload.result.body.finalStatus.percent_complete, 100);
    assert.equal(calls, 3);
});

// =====================================================================
// Test 3 — 404 on first poll → completed:true synthetic
// =====================================================================

test("await_system_job 404 on first poll → completed:true synthetic", async () => {
    _setCaptureRequest(() => {
        throw new GraylogNotFoundError("job not found", {
            status: 404,
            method: "GET",
            path: "/api/system/jobs/j",
            body: null,
        });
    });
    const res = await handleAwaitSystemJob({
        params: {
            arguments: {
                jobId: "j",
                dryRun: false,
                _testConnection: "fake",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    assert.equal(payload.result.body.completed, true);
    assert.equal(payload.result.body.finalStatus.synthetic, true);
});

// =====================================================================
// Test 4 — 404 after success-then-pruned → completed:true
// =====================================================================

test("await_system_job 404 after running-then-pruned → completed:true", async () => {
    let call = 0;
    _setCaptureRequest(() => {
        call++;
        if (call === 1) return { job_status: "running", percent_complete: 50 };
        throw new GraylogNotFoundError("job pruned", {
            status: 404,
            method: "GET",
            path: "/api/system/jobs/j",
            body: null,
        });
    });
    const res = await handleAwaitSystemJob({
        params: {
            arguments: { jobId: "j", dryRun: false, _testConnection: "fake" },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.result.body.completed, true);
    assert.equal(payload.result.body.finalStatus.synthetic, true);
});

// =====================================================================
// Test 5 — timeout path with real sleep
// =====================================================================

test("await_system_job timeout path exits within reasonable wall-clock window", async () => {
    // Restore real sleep so the deadline check is exercised end-to-end.
    _setSleepForTests(null);
    _setCaptureRequest(() => ({ job_status: "running", percent_complete: 50 }));
    const start = Date.now();
    const res = await handleAwaitSystemJob({
        params: {
            arguments: {
                jobId: "j",
                dryRun: false,
                timeoutMs: 100,
                _testConnection: "fake",
            },
        },
    });
    const elapsed = Date.now() - start;
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.result.body.completed, false);
    assert.equal(payload.result.body.timedOut, true);
    // Loop should exit within timeoutMs + first BACKOFF (500ms) tolerance.
    // Use 700ms cushion for slow runners.
    assert.ok(
        elapsed < 700,
        `expected loop to exit within ~700ms (timeoutMs:100 + tolerance), got ${elapsed}ms`,
    );
});

// =====================================================================
// Test 6 — extractJobId helper handles all forgiving-input shapes
// =====================================================================

test("extractJobId accepts jobId / envelope-with-job_id / envelope-with-jobId / envelope-with-id / bare-string", () => {
    assert.equal(extractJobId({ jobId: "y" }), "y");
    assert.equal(extractJobId({ jobIdOrEnvelope: { job_id: "x" } }), "x");
    assert.equal(extractJobId({ jobIdOrEnvelope: { jobId: "y" } }), "y");
    assert.equal(extractJobId({ jobIdOrEnvelope: { id: "z" } }), "z");
    assert.equal(extractJobId({ jobIdOrEnvelope: "bare-string" }), "bare-string");
});

// =====================================================================
// Test 7 — error status returns completed:false
// =====================================================================

test("await_system_job error status returns completed:false", async () => {
    _setCaptureRequest(() => ({
        job_status: "error",
        percent_complete: 80,
        info: "ran out of disk",
    }));
    const res = await handleAwaitSystemJob({
        params: {
            arguments: { jobId: "j", dryRun: false, _testConnection: "fake" },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.result.body.completed, false);
    assert.equal(payload.result.body.finalStatus.job_status, "error");
});

// =====================================================================
// Test 8 — zod rejects timeoutMs > 600000
// =====================================================================

test("await_system_job zod rejects timeoutMs > 600000", async () => {
    const res = await handleAwaitSystemJob({
        params: {
            arguments: {
                jobId: "j",
                timeoutMs: 700000,
                _testConnection: "fake",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /timeoutMs/);
});

// =====================================================================
// Test 9 — zod rejects neither jobId nor info_substring
// =====================================================================

test("await_system_job zod rejects neither-job_id-nor-info_substring", async () => {
    const res = await handleAwaitSystemJob({
        params: { arguments: { _testConnection: "fake" } },
    });
    assert.equal(res.isError, true);
    assert.match(
        res.content[0].text,
        /exactly one of jobId \/ jobIdOrEnvelope \/ info_substring is required/,
    );
});

// =====================================================================
// Test 10 — zod rejects BOTH job_id AND info_substring
// =====================================================================

test("await_system_job zod rejects BOTH jobId AND info_substring", async () => {
    const res = await handleAwaitSystemJob({
        params: {
            arguments: {
                jobId: "j",
                info_substring: "x",
                _testConnection: "fake",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /exactly one of/);
});

// =====================================================================
// Test 11 — info_substring resolves to a single job and polls it
// =====================================================================

test("await_system_job info_substring resolves to a single job", async () => {
    let listCalls = 0;
    let polledPath = null;
    _setCaptureRequest(({ method, path }) => {
        if (path === "/api/system/jobs") {
            listCalls++;
            return {
                jobs: [
                    { id: "job-A", info: "cleanup for index set iset-1" },
                    { id: "job-B", info: "rebuild ranges for graylog_0" },
                ],
            };
        }
        polledPath = path;
        return { job_status: "complete", percent_complete: 100 };
    });
    const res = await handleAwaitSystemJob({
        params: {
            arguments: {
                info_substring: "iset-1",
                dryRun: false,
                _testConnection: "fake",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(listCalls, 1);
    assert.equal(polledPath, "/api/system/jobs/job-A");
    assert.equal(payload.result.body.jobId, "job-A");
    assert.equal(payload.result.body.completed, true);
});

// =====================================================================
// Test 12 — info_substring with 0 matches → job_not_found
// =====================================================================

test("await_system_job info_substring 0 matches → job_not_found", async () => {
    let pollCalls = 0;
    _setCaptureRequest(({ path }) => {
        if (path === "/api/system/jobs") {
            return {
                jobs: [{ id: "job-X", info: "totally unrelated" }],
            };
        }
        pollCalls++;
        return { job_status: "complete", percent_complete: 100 };
    });
    const res = await handleAwaitSystemJob({
        params: {
            arguments: {
                info_substring: "iset-1",
                dryRun: false,
                _testConnection: "fake",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /job_not_found/);
    assert.equal(pollCalls, 0, "no poll call should fire when discovery fails");
});

// =====================================================================
// Test 13 — info_substring with 2+ matches → ambiguous_info_substring
// =====================================================================

test("await_system_job info_substring 2+ matches → ambiguous_info_substring lists candidate ids", async () => {
    _setCaptureRequest(({ path }) => {
        if (path === "/api/system/jobs") {
            return {
                jobs: [
                    { id: "job-A", info: "cleanup iset-1 partial" },
                    { id: "job-B", info: "iset-1 something else" },
                ],
            };
        }
        throw new Error(`unexpected poll: ${path}`);
    });
    const res = await handleAwaitSystemJob({
        params: {
            arguments: {
                info_substring: "iset-1",
                dryRun: false,
                _testConnection: "fake",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /ambiguous_info_substring/);
    assert.match(res.content[0].text, /job-A/);
    assert.match(res.content[0].text, /job-B/);
});

// =====================================================================
// Test 14 — info_substring dry-run returns resolution plan WITHOUT firing list
// =====================================================================

test("await_system_job info_substring dry-run returns resolution plan WITHOUT firing list", async () => {
    _setCaptureRequest(() => {
        throw new Error("MUST NOT GET");
    });
    const res = await handleAwaitSystemJob({
        params: {
            arguments: {
                info_substring: "iset-1",
                dryRun: true,
                _testConnection: "fake",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.postApplyEstimate.info_substring, "iset-1");
    assert.equal(payload.postApplyEstimate.discovery, "list_then_poll");
    assert.deepEqual(payload.postApplyEstimate.plan, [500, 1000, 2000, 4000, 5000]);
    assert.equal(payload.postApplyEstimate.timeoutMs, 60000);
});

// =====================================================================
// Sanity assertions on module-level exports
// =====================================================================

test("module exports BACKOFF_SCHEDULE === [500,1000,2000,4000,5000]", () => {
    assert.deepEqual(BACKOFF_SCHEDULE, [500, 1000, 2000, 4000, 5000]);
});

test("module exports DEFAULT_TIMEOUT_MS === 60000", () => {
    assert.equal(DEFAULT_TIMEOUT_MS, 60000);
});

test("AwaitSystemJobSchema parse handles `confirm` field for shape parity", () => {
    const parsed = AwaitSystemJobSchema.parse({ jobId: "j", confirm: "irrelevant" });
    assert.equal(parsed.jobId, "j");
});

test("resolveJobIdFromInfo returns ok+jobId on single match", async () => {
    _setCaptureRequest(() => ({
        jobs: [{ id: "job-A", info: "iset-1 cleanup" }],
    }));
    const client = makeClient(FAKE_CONN);
    const out = await resolveJobIdFromInfo(client, "iset-1");
    assert.equal(out.ok, true);
    assert.equal(out.jobId, "job-A");
});
