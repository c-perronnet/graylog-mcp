#!/usr/bin/env node
// Phase 9 Plan 09-02 — LIVE, NON-MUTATING smoke check for the entity-shares
// read path: get_entity_shares + list_grantees against the real
// UNESCO-production Graylog 7.0.6 `test` instance.
//
// This file is DELIBERATELY named `*.smoke.js` (not `*.test.js`) so it is
// EXCLUDED from `npm test` — the suite glob is `test/**/*.test.js`
// (package.json). It is a human-supervised network probe, run by hand:
//
//     node test/authz-entity-shares-live.smoke.js
//
// SAFETY (08-TEST-STRATEGY §2/§6, 09-RESEARCH Pitfall 6):
//   - The `test` connection is LIVE UNESCO PRODUCTION Graylog — NOT a sandbox
//     (project memory). This probe is safe ONLY because every authz request it
//     issues is `POST /api/authz/shares/entities/{GRN}/prepare` with an EMPTY
//     `{}` body. `/prepare` is `@NoAuditEvent` — it computes the share preview
//     and mutates nothing.
//   - The commit endpoint `POST /api/authz/shares/entities/{GRN}` (no
//     `/prepare` suffix) is NEVER referenced. The probe drives only the
//     handlers `handleGetEntityShares` / `handleListGrantees`, which build
//     `/prepare` paths exclusively (Plan 09-01).
//   - The probe sends NO grant-capability body content and never targets a
//     grantee. It is read-only — the `{}` body is empty.
//   - SELF-GUARD: a request-capture seam asserts every authz request path
//     embedded with a GRN ends in `/prepare` and percent-encodes the GRN.
//     A violation aborts the run with a non-zero exit before any live call.
//
// HTTP discipline: discovery calls go through `makeClient(conn).request(...)`
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
import { handleGetEntityShares } from "../src/tools/authz/get-entity-shares.js";
import { handleListGrantees } from "../src/tools/authz/list-grantees.js";

// The connection the smoke check targets — the live Graylog 7.0.6 `test`
// instance. Same name the Phase 8 capture probe uses.
const TARGET_CONNECTION = "test";

// Authz request paths under this prefix MUST end in `/prepare` (read-only).
// Assembled from segments so this guard constant is not itself mistaken for a
// hand-built request path — the file builds no authz path; handlers do.
const AUTHZ_PREFIX = ["/api", "authz", "shares", "entities", ""].join("/");

/**
 * Resolve the `test` connection directly from the config registry.
 *
 * This smoke check has no MCP request envelope for discovery calls, so it
 * reads the registry directly — same approach as
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
 * Self-guard: assert an authz request path is the read-only `/prepare` probe.
 *
 * Aborts the process with exit code 2 if a path under the authz-shares prefix
 * either lacks the `/prepare` suffix (would be the commit endpoint) or carries
 * an unencoded raw colon in the GRN segment (JAX-RS mis-routing risk).
 *
 * @param {string} path - the request path issued by a handler
 */
function assertReadOnlyAuthzPath(path) {
    if (typeof path !== "string" || !path.startsWith(AUTHZ_PREFIX)) {
        return; // not an authz-shares path — nothing to guard
    }
    if (!path.endsWith("/prepare")) {
        console.error(
            `[smoke] FATAL: authz request path "${path}" does not end in /prepare — `
                + "this would be the MUTATING commit endpoint. Refusing.",
        );
        process.exit(2);
    }
    // The GRN segment lives between the prefix and the trailing `/prepare`.
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
 * Drive a handler against the live instance, self-guarding every authz path it
 * issues. The capture seam is used in PASS-THROUGH mode: it observes the path,
 * guards it, then performs the REAL request so the live `/prepare` response
 * flows back to the handler unchanged.
 *
 * The seam is process-global — once installed, every `makeClient().request`
 * routes through it. To issue the genuine network call WITHOUT recursing back
 * into the interceptor, the seam is cleared for the duration of the real call
 * and reinstalled immediately after, inside a try/finally.
 *
 * @param {Function} handler - handleGetEntityShares | handleListGrantees
 * @param {object} args - the MCP arguments object
 * @param {object} conn - the resolved connection config
 * @returns {Promise<object>} the handler's MCP response
 */
async function driveHandlerGuarded(handler, args, conn) {
    // A client used purely to issue the genuine network call. Capturing it now
    // does not bypass the guard — the interceptor below clears the seam only
    // AFTER it has guarded the path.
    const passthroughClient = makeClient(conn);

    const interceptor = async (req) => {
        // 1. GUARD FIRST — abort the process if a non-/prepare authz path or an
        //    unencoded GRN ever reaches the network.
        assertReadOnlyAuthzPath(req?.path);
        // 2. Issue the genuine call with the seam temporarily uninstalled so
        //    the real request does not recurse back into this interceptor.
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
 * Probe one entity type: drive both handlers and assert well-formed results.
 *
 * @param {object} ctx - { conn, entityType, entityId, label }
 * @returns {Promise<string>} a "PASS ..." summary line
 */
async function probeEntity({ conn, entityType, entityId, label }) {
    const grn = buildGrn(entityType, entityId);
    const args = { connectionName: TARGET_CONNECTION, entityType, entityId };

    // --- get_entity_shares -------------------------------------------------
    const sharesRes = await driveHandlerGuarded(handleGetEntityShares, args, conn);
    const sharesPayload = parseHandlerResult(sharesRes, `get_entity_shares(${label})`);
    if (sharesPayload.tool !== "get_entity_shares") {
        throw new Error(`get_entity_shares(${label}): unexpected tool field "${sharesPayload.tool}".`);
    }
    const es = sharesPayload.entity_shares;
    if (!es || typeof es !== "object") {
        throw new Error(`get_entity_shares(${label}): missing entity_shares object.`);
    }
    for (const key of [
        "available_grantees",
        "available_capabilities",
        "active_shares",
        "validation_result",
    ]) {
        if (!(key in es)) {
            throw new Error(
                `get_entity_shares(${label}): EntityShareResponse missing "${key}".`,
            );
        }
    }
    if (!Array.isArray(es.available_grantees)) {
        throw new Error(`get_entity_shares(${label}): available_grantees is not an array.`);
    }
    if (!Array.isArray(es.active_shares)) {
        throw new Error(`get_entity_shares(${label}): active_shares is not an array.`);
    }

    // --- list_grantees -----------------------------------------------------
    const granteesRes = await driveHandlerGuarded(handleListGrantees, args, conn);
    const granteesPayload = parseHandlerResult(granteesRes, `list_grantees(${label})`);
    if (granteesPayload.tool !== "list_grantees") {
        throw new Error(`list_grantees(${label}): unexpected tool field "${granteesPayload.tool}".`);
    }
    if (!Array.isArray(granteesPayload.grantees)) {
        throw new Error(`list_grantees(${label}): grantees is not an array.`);
    }
    for (const g of granteesPayload.grantees) {
        for (const key of ["id", "type", "title"]) {
            if (!(key in g)) {
                throw new Error(
                    `list_grantees(${label}): a grantee entry is missing "${key}".`,
                );
            }
        }
    }

    return (
        `PASS  ${label.padEnd(8)} grn=${grn}  `
        + `available_grantees=${es.available_grantees.length} `
        + `active_shares=${es.active_shares.length} `
        + `list_grantees=${granteesPayload.grantees.length}`
    );
}

/**
 * Discover the first stream id on the live instance.
 *
 * @param {object} conn - the resolved connection config
 * @returns {Promise<string>} a real stream id
 */
async function discoverStreamId(conn) {
    const client = makeClient(conn);
    const res = await client.request("GET", "/api/streams");
    const streams = Array.isArray(res?.streams) ? res.streams : [];
    const first = streams.find((s) => typeof s?.id === "string");
    if (!first) {
        throw new Error("GET /api/streams returned no stream with an id.");
    }
    return first.id;
}

/**
 * Discover one dashboard id and one saved-search id via the views API.
 *
 * Dashboards and saved searches share `GET /api/views`; entries are
 * distinguished by the `type` field (`DASHBOARD` vs `SEARCH`). Either may be
 * absent on the live instance — the caller treats `null` as a SKIP.
 *
 * @param {object} conn - the resolved connection config
 * @returns {Promise<{dashboardId: string|null, searchId: string|null}>}
 */
async function discoverViewIds(conn) {
    const client = makeClient(conn);
    let views = [];
    try {
        const res = await client.request("GET", "/api/views");
        views = Array.isArray(res?.views) ? res.views : [];
    } catch (err) {
        console.error(`[smoke] GET /api/views failed (${err.message}) — dashboard/search probes will SKIP.`);
        return { dashboardId: null, searchId: null };
    }
    const byType = (t) =>
        views.find((v) => String(v?.type).toUpperCase() === t && typeof v?.id === "string")
            ?.id ?? null;
    return { dashboardId: byType("DASHBOARD"), searchId: byType("SEARCH") };
}

/**
 * Run the full smoke check: stream probe (required) + dashboard/search probes
 * (best-effort, SKIP if not discoverable).
 *
 * @returns {Promise<void>}
 */
async function runSmoke() {
    const { conn } = resolveProbeConnection();
    console.error(`[smoke] target: ${TARGET_CONNECTION} (${conn.baseUrl})`);
    console.error("[smoke] read-only — every authz call is POST .../prepare with a {} body.\n");

    const lines = [];

    // 1. Stream probe — REQUIRED. A failure here fails the smoke check.
    const streamId = await discoverStreamId(conn);
    lines.push(
        await probeEntity({ conn, entityType: "stream", entityId: streamId, label: "stream" }),
    );

    // 2. Dashboard + saved-search probes — best-effort GRN-type coverage.
    const { dashboardId, searchId } = await discoverViewIds(conn);

    if (dashboardId) {
        lines.push(
            await probeEntity({
                conn,
                entityType: "dashboard",
                entityId: dashboardId,
                label: "dashboard",
            }),
        );
    } else {
        lines.push("SKIP  dashboard no DASHBOARD view discoverable on the live instance");
    }

    if (searchId) {
        lines.push(
            await probeEntity({
                conn,
                entityType: "search",
                entityId: searchId,
                label: "search",
            }),
        );
    } else {
        lines.push("SKIP  search   no SEARCH view discoverable on the live instance");
    }

    console.error("[smoke] results:");
    for (const line of lines) {
        console.error(`  ${line}`);
    }
    console.error("\n[smoke] OK — entity-shares read path verified live, zero mutations.");
}

// CLI entrypoint — runs when invoked as
// `node test/authz-entity-shares-live.smoke.js`. Skipped when imported.
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
