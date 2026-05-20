#!/usr/bin/env node
// Phase 10 Plan 10-03 — LIVE, DRY-RUN-ONLY smoke check for share_entity
// against the real UNESCO-production Graylog 7.0.6 `test` instance.
//
// This file is DELIBERATELY named `*.smoke.js` (not `*.test.js`) so it is
// EXCLUDED from `npm test` — the suite glob is `test/**/*.test.js`
// (package.json). It is a human-supervised network probe, run by hand:
//
//     node test/authz-share-entity-live.smoke.js
//
// SAFETY (08-TEST-STRATEGY §2/§6, 10-RESEARCH Pitfall 6, project memory
// `graylog-test-connection-is-live-unesco`):
//   - The `test` connection is LIVE UNESCO PRODUCTION Graylog — NOT a sandbox
//     (project memory). This probe drives `handleShareEntity` with
//     `dryRun: true` EXCLUSIVELY. Under `dryRun: true`, the wrapper at
//     handler.js step 6 returns the preview envelope BEFORE step 7 apply
//     runs — the commit endpoint POST is NEVER issued.
//   - No grant is ever written. The probe verifies the read-merge-token
//     pipeline against entities the API-token user already has at least
//     `view` on (operator-provided via env vars; see below).
//   - The commit endpoint `POST /api/authz/shares/entities/{GRN}` (no
//     `/prepare` suffix) is the MUTATING endpoint. Even though it should
//     structurally never fire under dryRun:true (handler.js step 6
//     short-circuits before apply), the SELF-GUARD `assertSafeAuthzPath`
//     observes every request path and ABORTS the process with exit code 2
//     if the commit endpoint is ever seen — defense in depth against a
//     wrapper regression.
//   - The throwaway-entity full-apply UAT (08-TEST-STRATEGY §5) is NOT
//     performed by this probe — it is a separate human-supervised step
//     gated behind the Plan 10-03 Task 2 checkpoint.
//
// ENV VAR CONTRACT (per-type target selection):
//   - SHARE_SMOKE_STREAM_GRN     — full `grn::::stream:<id>` to probe
//   - SHARE_SMOKE_DASHBOARD_GRN  — full `grn::::dashboard:<id>` to probe
//   - SHARE_SMOKE_SEARCH_GRN     — full `grn::::search:<id>` to probe
//   - SHARE_SMOKE_GRANTEE_GRN    — (optional) user-GRN to use as grantee;
//                                  defaults to the literal Sidecar System
//                                  User builtin team grantee discoverable
//                                  via available_grantees on the live
//                                  instance (Phase 8 fixture observation).
//   If a per-type env var is unset, that entity-type probe SKIPS with a
//   warning rather than aborting — the probe is best-effort across types.
//
// HTTP discipline: every authz call goes through `makeClient(conn).request(...)`
// from src/graylog/client.js — no raw HTTP-client import at this site.

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { makeClient } from "../src/graylog/client.js";
import {
    _setCaptureRequest,
    _clearCaptureRequest,
} from "../src/graylog/client.js";
import { getConnections, getActiveConnectionConfig } from "../src/config.js";
import { buildGrn } from "../src/tools/authz/grn-helpers.js";
import { handleShareEntity } from "../src/tools/authz/share-entity.js";

// The connection the smoke check targets — the live Graylog 7.0.6 `test`
// instance. Same name the Phase 8 capture probe and the Phase 9 smoke use.
const TARGET_CONNECTION = "test";

// Authz request paths under this prefix: `/prepare`-suffixed is the READ
// probe (allowed). Anything else under this prefix is the COMMIT endpoint
// (forbidden — see SAFETY block above). Assembled from segments so the
// constant is not itself mistaken for a hand-built request path — the
// file builds no authz path; the handler does.
const AUTHZ_PREFIX = ["/api", "authz", "shares", "entities", ""].join("/");

// Documentation constant: ANY path under AUTHZ_PREFIX that does NOT end
// with `/prepare` is the commit endpoint, and is FORBIDDEN by this
// probe. `assertSafeAuthzPath` enforces this.
// eslint-disable-next-line no-unused-vars
const COMMIT_SUFFIX_DISALLOWED = true;

/**
 * Resolve the `test` connection directly from the config registry.
 *
 * This smoke check has no MCP request envelope for discovery calls, so it
 * reads the registry directly — same approach as the Phase 9 smoke and
 * scripts/capture-authz-prepare-fixture.js.
 *
 * @returns {{name: string, conn: object}}
 */
function resolveProbeConnection() {
    const connections = getConnections();
    const conn = connections[TARGET_CONNECTION] ?? getActiveConnectionConfig();
    if (!conn || typeof conn.baseUrl !== "string") {
        throw new Error(
            `Connection "${TARGET_CONNECTION}" not found in the config registry — `
                + `add it to ~/.graylog-mcp/config.json before running this smoke check.`,
        );
    }
    return { name: TARGET_CONNECTION, conn };
}

/**
 * Parse a handler MCP response, asserting it is not an error envelope.
 *
 * @param {object} res - the MCP response returned by a handler
 * @param {string} label - human label for failure messages
 * @returns {object} the parsed `content[0].text` JSON payload
 */
function parseHandlerResult(res, label) {
    if (res?.isError) {
        const text = res?.content?.[0]?.text ?? "(no text)";
        throw new Error(`${label}: handler returned an error envelope — ${text}`);
    }
    const text = res?.content?.[0]?.text;
    if (typeof text !== "string") {
        throw new Error(`${label}: handler response had no content[0].text string.`);
    }
    return JSON.parse(text);
}

/**
 * SELF-GUARD: assert an authz request path is SAFE for the dry-run-only
 * smoke probe. SAFE = either it does not touch authz at all, OR it ends
 * with `/prepare` (the read probe). UNSAFE = anything authz-adjacent
 * that does NOT end with `/prepare` — that is the mutating commit
 * endpoint, which must NEVER fire because the handler runs under
 * `dryRun: true`. A violation aborts the process with exit code 2.
 *
 * Also asserts the GRN segment between AUTHZ_PREFIX and the trailing
 * `/prepare` is percent-encoded (no raw `:` — colons must be `%3A`).
 *
 * REVIEW WR-05: the broadened "authz-adjacent" check catches Graylog
 * path aliases (e.g. `/api/system/authz/...`, `/api/legacy/authz/...`,
 * any `/api/authz/shares/...` variant) that would otherwise slip past
 * the exact-AUTHZ_PREFIX startsWith check. Defense-in-depth is the
 * entire point of this file — a future Graylog upgrade adding an alias
 * must NOT silently let a mutating POST through.
 *
 * @param {string} method - the HTTP method (GET / POST / ...)
 * @param {string} path - the request path issued by the handler
 */
function assertSafeAuthzPath(method, path) {
    if (typeof path !== "string") return;

    // Check 1 (REVIEW WR-05): is this path authz-adjacent? Catch ANY path
    // containing "authz" or "shares" — not just the exact AUTHZ_PREFIX.
    // GET-only probes are allowed regardless (the live /prepare flow does
    // POST, but read-only authz reads via GET are fine to pass through).
    const isAuthzAdjacent = /authz|shares/i.test(path);
    if (isAuthzAdjacent) {
        const httpMethod = typeof method === "string" ? method.toUpperCase() : "";
        // Non-GET on an authz-adjacent path MUST end with /prepare. The
        // commit endpoint never ends with /prepare; any alias that doesn't
        // either is either the commit endpoint or a new mutating path that
        // wasn't anticipated when this guard was written.
        if (httpMethod && httpMethod !== "GET" && !path.endsWith("/prepare")) {
            console.error(
                `[smoke] FATAL: non-GET authz-adjacent request "${httpMethod} ${path}" `
                    + "is not a /prepare read probe. This probe is dryRun-only — "
                    + "the mutating commit endpoint (or any aliased mutating path) "
                    + "must never run. Refusing.",
            );
            process.exit(2);
        }
    }

    // Check 2 (preserved): if the path lands under the canonical
    // AUTHZ_PREFIX, the GRN segment between the prefix and the trailing
    // `/prepare` must be percent-encoded (no raw `:` — colons must be
    // `%3A`). This catches a regression where the GRN was interpolated
    // raw and would mis-route the JAX-RS router (or path-traverse).
    if (!path.startsWith(AUTHZ_PREFIX)) {
        return;
    }
    if (!path.endsWith("/prepare")) {
        // Already caught by Check 1 above if method is non-GET; this is the
        // narrow case where method was empty/unknown. Preserve the original
        // exact-prefix refusal for that case.
        console.error(
            `[smoke] FATAL: authz request path "${path}" is the MUTATING `
                + "commit endpoint. This probe is dryRun-only — apply must never "
                + "run. Refusing.",
        );
        process.exit(2);
    }
    const grnSegment = path.slice(AUTHZ_PREFIX.length, -"/prepare".length);
    if (grnSegment.includes(":")) {
        console.error(
            `[smoke] FATAL: GRN segment "${grnSegment}" contains a raw colon — `
                + "the GRN must be percent-encoded (colons -> %3A). Refusing.",
        );
        process.exit(2);
    }
}

/**
 * Drive a handler against the live instance, SELF-GUARDING every authz
 * path it issues. The capture seam is used in PASS-THROUGH mode: it
 * observes the path, guards it, then performs the REAL request so the
 * live `/prepare` response flows back to the handler unchanged.
 *
 * The seam is process-global — once installed, every `makeClient().request`
 * routes through it. To issue the genuine network call WITHOUT recursing
 * back into the interceptor, the seam is cleared for the duration of the
 * real call and reinstalled immediately after, inside a try/finally.
 *
 * @param {Function} handler - handleShareEntity
 * @param {object} args - the MCP arguments object
 * @param {object} conn - the resolved connection config
 * @returns {Promise<object>} the handler's MCP response
 */
async function driveHandlerGuarded(handler, args, conn) {
    // A client used purely to issue the genuine network call. Capturing it
    // now does not bypass the guard — the interceptor below clears the
    // seam only AFTER it has guarded the path.
    const passthroughClient = makeClient(conn);

    const interceptor = async (req) => {
        // 1. GUARD FIRST — abort the process if a non-/prepare authz path
        //    or an unencoded GRN ever reaches the network. For Phase 10
        //    the forbidden path is the commit endpoint itself; under
        //    `dryRun: true` the handler never reaches apply, so the
        //    commit endpoint should never be observed. REVIEW WR-05:
        //    method is now threaded through so the broadened
        //    authz-adjacent guard can pass GET probes while refusing
        //    non-GET requests against any authz-adjacent path that
        //    doesn't end with /prepare.
        assertSafeAuthzPath(req?.method, req?.path);
        // 2. Issue the genuine call with the seam temporarily uninstalled
        //    so the real request does not recurse back into this
        //    interceptor.
        _clearCaptureRequest();
        try {
            return await passthroughClient.request(req.method, req.path, req.body);
        } finally {
            _setCaptureRequest(interceptor);
        }
    };

    try {
        _setCaptureRequest(interceptor);
        return await handler({ params: { arguments: args } });
    } finally {
        _clearCaptureRequest();
    }
}

/**
 * Assert the shape of a dry-run share_entity envelope returned by the
 * handler. Throws on any structural violation; returns the parsed
 * payload for callers that need to inspect specific fields.
 *
 * @param {object} payload - parsed `content[0].text` JSON from the handler
 * @param {string} label - human label for failure messages
 * @returns {object} the validated payload
 */
function assertDryRunEnvelope(payload, label) {
    if (payload.dryRun !== true) {
        throw new Error(`${label}: expected dryRun:true in envelope, got ${payload.dryRun}`);
    }
    if (payload.tool !== "share_entity") {
        throw new Error(`${label}: expected tool:"share_entity", got "${payload.tool}"`);
    }
    if (typeof payload.confirmationToken !== "string"
        || !/^[0-9a-f]{64}$/.test(payload.confirmationToken)) {
        throw new Error(
            `${label}: confirmationToken is not a 64-char lowercase hex string `
                + `(got "${payload.confirmationToken}")`,
        );
    }
    if (!payload.preview || typeof payload.preview !== "object") {
        throw new Error(`${label}: missing preview object`);
    }
    if (payload.preview.method !== "POST") {
        throw new Error(`${label}: preview.method !== "POST" (got "${payload.preview.method}")`);
    }
    if (typeof payload.preview.path !== "string" || !payload.preview.path.startsWith(AUTHZ_PREFIX)) {
        throw new Error(
            `${label}: preview.path does not start with ${AUTHZ_PREFIX} `
                + `(got "${payload.preview.path}")`,
        );
    }
    // The apply path IS the commit endpoint (no /prepare suffix). Even
    // though it never fires under dryRun:true, the preview reflects what
    // the apply would POST.
    if (payload.preview.path.endsWith("/prepare")) {
        throw new Error(
            `${label}: preview.path ends with /prepare — that is the read `
                + `probe path; apply target should be the bare commit endpoint`,
        );
    }
    if (!payload.preview.body || typeof payload.preview.body !== "object") {
        throw new Error(`${label}: missing preview.body`);
    }
    if (!payload.preview.body.selected_grantee_capabilities
        || typeof payload.preview.body.selected_grantee_capabilities !== "object") {
        throw new Error(
            `${label}: preview.body.selected_grantee_capabilities is not an object`,
        );
    }
    return payload;
}

/**
 * Probe one entity type with grant + revoke dry-runs. Best-effort — if
 * the env var for this type is unset, prints a SKIP line and returns
 * `{skipped: true}`.
 *
 * @param {object} ctx - { conn, connName, entityType, envVar, granteeGrn }
 * @returns {Promise<{skipped: boolean, lines: string[]}>}
 */
async function probeEntityType({ conn, connName, entityType, envVar, granteeGrn }) {
    const entityGrn = process.env[envVar];
    if (!entityGrn) {
        return {
            skipped: true,
            lines: [
                `SKIP  ${entityType.padEnd(9)} ${envVar} env var unset — set to a GRN `
                    + `the API-token user already has at least \`view\` on.`,
            ],
        };
    }

    const lines = [];

    // ---- 1. Grant dry-run --------------------------------------------------
    const grantArgs = {
        connectionName: connName,
        entityGrn,
        granteeGrn,
        capability: "view",
        dryRun: true,
    };
    const grantRes = await driveHandlerGuarded(handleShareEntity, grantArgs, conn);
    const grantPayload = assertDryRunEnvelope(
        parseHandlerResult(grantRes, `share_entity[grant ${entityType}]`),
        `share_entity[grant ${entityType}]`,
    );
    const grantedKeys = Object.keys(grantPayload.preview.body.selected_grantee_capabilities);
    lines.push(
        `PASS  ${entityType.padEnd(9)} grant dryRun token=${grantPayload.confirmationToken.slice(0, 12)}…  `
            + `merged_size=${grantedKeys.length}`,
    );

    // ---- 2. Revoke dry-run -------------------------------------------------
    // Structural assertion: the revoke envelope's merged set must NOT contain
    // the grantee any longer. If the grantee was not in active_shares to begin
    // with, the handler will return an isError envelope with
    // reason="not_currently_granted" — that is correct behavior; we accept it
    // as a structural pass for the revoke path (no state was mutated).
    const revokeArgs = {
        connectionName: connName,
        entityGrn,
        granteeGrn,
        revoke: true,
        dryRun: true,
    };
    const revokeRes = await driveHandlerGuarded(handleShareEntity, revokeArgs, conn);
    if (revokeRes?.isError) {
        const revokeText = revokeRes?.content?.[0]?.text ?? "";
        if (/not_currently_granted/.test(revokeText)) {
            lines.push(
                `PASS  ${entityType.padEnd(9)} revoke dryRun (not_currently_granted — `
                    + `grantee absent from active_shares; no mutation possible)`,
            );
        } else {
            throw new Error(
                `share_entity[revoke ${entityType}]: unexpected isError envelope — ${revokeText}`,
            );
        }
    } else {
        const revokePayload = assertDryRunEnvelope(
            parseHandlerResult(revokeRes, `share_entity[revoke ${entityType}]`),
            `share_entity[revoke ${entityType}]`,
        );
        const revokedKeys = Object.keys(revokePayload.preview.body.selected_grantee_capabilities);
        if (revokedKeys.includes(granteeGrn)) {
            throw new Error(
                `share_entity[revoke ${entityType}]: merged set STILL contains grantee `
                    + `"${granteeGrn}" after revoke dryRun — merge subtract is broken`,
            );
        }
        lines.push(
            `PASS  ${entityType.padEnd(9)} revoke dryRun token=${revokePayload.confirmationToken.slice(0, 12)}…  `
                + `merged_size=${revokedKeys.length} (grantee absent)`,
        );
    }

    return { skipped: false, lines };
}

/**
 * Drive one failure case: granteeUsername that resolves to no
 * available_grantees entry. The handler must return an isError envelope
 * (reason=username_not_found). No mutation occurs.
 *
 * @param {object} ctx - { conn, connName, entityGrn }
 * @returns {Promise<string>}
 */
async function probeUnknownGrantee({ conn, connName, entityGrn }) {
    const args = {
        connectionName: connName,
        entityGrn,
        granteeUsername: "nonexistent-username-no-such-user",
        capability: "view",
        dryRun: true,
    };
    const res = await driveHandlerGuarded(handleShareEntity, args, conn);
    if (!res?.isError) {
        throw new Error(
            `share_entity[unknown-grantee]: expected isError envelope, got success — `
                + (res?.content?.[0]?.text ?? "(no text)"),
        );
    }
    const text = res?.content?.[0]?.text ?? "";
    if (!/username_not_found|not found in available_grantees/.test(text)) {
        throw new Error(
            `share_entity[unknown-grantee]: isError envelope did not surface `
                + `username_not_found — got: ${text}`,
        );
    }
    return "PASS  unknown   granteeUsername resolves to isError envelope (username_not_found)";
}

/**
 * Run the full smoke check: per-entity-type grant+revoke dry-runs +
 * one unknown-grantee failure case. Each step is best-effort across
 * entity types — a SKIP for missing env var does not fail the run.
 *
 * @returns {Promise<void>}
 */
async function runSmoke() {
    const { name: connName, conn } = resolveProbeConnection();
    console.error(
        `[smoke] Probing share_entity against connection "${connName}" `
            + `(${conn.baseUrl}) — dryRun:true ONLY, no commit endpoint will fire.\n`,
    );

    // Default grantee — the Sidecar System User (built-in) team is present on
    // every Graylog instance and is a safe-to-mention grantee for a dry-run
    // probe (no grant is written; the merged set is only computed locally).
    // Operator can override via SHARE_SMOKE_GRANTEE_GRN.
    const granteeGrn = process.env.SHARE_SMOKE_GRANTEE_GRN
        ?? "grn::::team:sidecar-system-user";

    const lines = [];
    const entityTypes = [
        { entityType: "stream", envVar: "SHARE_SMOKE_STREAM_GRN" },
        { entityType: "dashboard", envVar: "SHARE_SMOKE_DASHBOARD_GRN" },
        { entityType: "search", envVar: "SHARE_SMOKE_SEARCH_GRN" },
    ];

    let firstProbedGrn = null;
    let anyProbed = false;
    for (const { entityType, envVar } of entityTypes) {
        const result = await probeEntityType({
            conn,
            connName,
            entityType,
            envVar,
            granteeGrn,
        });
        for (const line of result.lines) lines.push(line);
        if (!result.skipped) {
            anyProbed = true;
            firstProbedGrn = firstProbedGrn ?? process.env[envVar];
        }
    }

    // Unknown-grantee failure case — only if at least one entity-type probed,
    // because we need a real entityGrn to drive the handler past /prepare.
    if (firstProbedGrn) {
        lines.push(
            await probeUnknownGrantee({
                conn,
                connName,
                entityGrn: firstProbedGrn,
            }),
        );
    } else {
        lines.push(
            "SKIP  unknown   no entity-type probed (all env vars unset); "
                + "unknown-grantee check requires a real entityGrn.",
        );
    }

    console.error("[smoke] results:");
    for (const line of lines) {
        console.error(`  ${line}`);
    }

    if (!anyProbed) {
        console.error(
            "\n[smoke] All entity-type probes SKIPPED — set at least one of "
                + "SHARE_SMOKE_STREAM_GRN / SHARE_SMOKE_DASHBOARD_GRN / "
                + "SHARE_SMOKE_SEARCH_GRN to a GRN the API-token user has view on.",
        );
        // Skipping all probes is not a failure — the operator chose not to
        // configure targets. Exit 0 so the gate stays passable.
    }

    console.error(
        "\n[smoke] OK — share_entity dryRun:true probe passed for all "
            + "entity types.",
    );
}

// CLI entrypoint — runs when invoked as
// `node test/authz-share-entity-live.smoke.js`. Skipped when imported.
const isMain =
    process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
    try {
        await runSmoke();
        process.exit(0);
    } catch (err) {
        console.error(`[smoke] FAIL: ${err.message}`);
        process.exit(1);
    }
}
