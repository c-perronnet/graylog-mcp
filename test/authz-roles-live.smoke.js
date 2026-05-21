#!/usr/bin/env node
// Phase 11 Plan 11-03 — LIVE, DRY-RUN-ONLY smoke check for the 7 role
// management tools against the production UNESCO Graylog 7.0.6+ `test`
// instance.
//
// `.smoke.js` discipline: this file is EXCLUDED from `npm test` (the
// suite glob in package.json is `test/**/*.test.js`); the file is
// hand-run by the operator:
//
//     node test/authz-roles-live.smoke.js
//
// SAFETY (08-TEST-STRATEGY §2/§6, 11-RESEARCH Pitfall 6, project memory
// `graylog-test-connection-is-live-unesco`):
//   - The `test` connection is LIVE UNESCO PRODUCTION Graylog — NOT a
//     sandbox (project memory). This probe drives the 5 mutating role
//     handlers (create / update / delete / assign / unassign_role) with
//     `dryRun: true` EXCLUSIVELY. Under `dryRun: true`, the wrapper at
//     handler.js step 6 returns the preview envelope BEFORE step 7 apply
//     runs — the commit endpoints (POST /api/roles, PUT/DELETE
//     /api/roles/{n}, PUT/DELETE /api/roles/{n}/members/{u}) are NEVER
//     issued.
//   - The 2 read tools (list_roles, get_role) are non-mutating; they
//     issue GETs that hit live data without modifying it.
//   - SELF-GUARD: assertSafeRolesPath(method, path) aborts process.exit(2)
//     on any observed POST/PUT/DELETE under /api/roles* — this fires only
//     on a wrapper regression where dryRun:true fails to short-circuit
//     apply. Belt + braces — the dryRun short-circuit is the primary
//     safety; the guard is defense-in-depth.
//   - NEVER contains an apply-mode literal anywhere in this file. The
//     grep gate `grep -cE 'dryRun *: *false'` MUST return 0. Any test
//     that explores apply paths against the live instance is bundled
//     into the Plan 11-03 Task 3 throwaway-role HUMAN-UAT (deferred to
//     v3.1.0 milestone close per CONTEXT D-24).
//
// Pattern source: test/authz-share-entity-live.smoke.js (Plan 10-03 —
// same dryRun + SELF-GUARD + pass-through-interceptor discipline).

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
    makeClient,
    _setCaptureRequest,
    _clearCaptureRequest,
} from "../src/graylog/client.js";
import { getConnections, getActiveConnectionConfig } from "../src/config.js";

// The 7 role handlers — imported from individual file paths under
// src/tools/authz/ (the Plan 11-02 product). This mirrors
// authz-share-entity-live.smoke.js's "import the handler from its
// direct file, not the barrel" convention, so the smoke is unaffected
// by the barrel's register() side-effects (which would trigger
// dispatch wiring during script load).
import { handleListRoles } from "../src/tools/authz/list-roles.js";
import { handleGetRole } from "../src/tools/authz/get-role.js";
import { handleCreateRole } from "../src/tools/authz/create-role.js";
import { handleUpdateRole } from "../src/tools/authz/update-role.js";
import { handleDeleteRole } from "../src/tools/authz/delete-role.js";
import { handleAssignRole } from "../src/tools/authz/assign-role.js";
import { handleUnassignRole } from "../src/tools/authz/unassign-role.js";

// The connection the smoke check targets — the live Graylog 7.0.6+
// `test` instance (UNESCO production). Same name the Phase 8 capture
// probe and the Phase 9/10/11 smoke probes use.
const TARGET_CONNECTION = "test";

// Path prefixes the SELF-GUARD recognizes as role-management surface.
// Any non-GET request whose path starts with one of these is a MUTATION
// endpoint and is FORBIDDEN by this dryRun-only probe.
const ROLES_PREFIX = "/api/roles";
const AUTHZ_ROLES_PREFIX = "/api/authz/roles";
const PERMISSIONS_PREFIX = "/api/system/permissions";

// Whitelisted safe methods. The 2 read tools + the mutating tools'
// pre-flight GETs all go through this set. Anything else under a
// role-tool path is a mutation and refused.
const SAFE_READ_METHODS = new Set(["GET"]);

/**
 * Resolve the `test` connection directly from the config registry.
 *
 * Mirrors test/authz-share-entity-live.smoke.js:85-95 and
 * scripts/capture-roles-fixtures.js's resolveProbeConnection().
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
 * Mirrors authz-share-entity-live.smoke.js:104-114.
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
 * SELF-GUARD: assert a request path is SAFE for the dry-run-only smoke
 * probe. SAFE = either it does not touch any role-management surface,
 * OR the method is GET (read-only). UNSAFE = a non-GET request under
 * /api/roles* or /api/authz/roles* — that is a MUTATION endpoint
 * (POST /api/roles, PUT /api/roles/{n}, DELETE /api/roles/{n},
 * PUT/DELETE /api/roles/{n}/members/{u}) which must NEVER fire because
 * the mutating handlers run under `dryRun: true` (the wrapper
 * short-circuits apply at handler.js step 6 BEFORE the network call).
 *
 * A violation aborts the process with exit code 2 — defense in depth
 * against a wrapper regression where dryRun:true fails to short-circuit
 * apply.
 *
 * @param {string} method - the HTTP method (GET / POST / ...)
 * @param {string} path - the request path issued by the handler
 */
function assertSafeRolesPath(method, path) {
    if (typeof path !== "string") return;

    // Identify role-management-adjacent paths. We deliberately include
    // /api/system/permissions because create_role + update_role fetch
    // the permission catalogue from there during build() — those GETs
    // are read-only and allowed (the SAFE_READ_METHODS check below
    // permits them). /api/users/me is OUT-OF-SCOPE for this guard
    // because it's a generic identity endpoint, not a role-management
    // mutation surface.
    const isRolesAdjacent =
        path.startsWith(ROLES_PREFIX)
        || path.startsWith(AUTHZ_ROLES_PREFIX)
        || path.startsWith(PERMISSIONS_PREFIX);

    if (!isRolesAdjacent) {
        return; // not a Phase-11 path — allowed.
    }

    const httpMethod = typeof method === "string" ? method.toUpperCase() : "";
    if (SAFE_READ_METHODS.has(httpMethod)) {
        return; // GET on a Phase-11 path is always allowed.
    }

    console.error(
        `[smoke] FATAL: ${httpMethod} to "${path}" is a role-tool MUTATION `
            + "endpoint. This probe is dryRun-only — apply must never run. "
            + "Refusing (process.exit(2)).",
    );
    process.exit(2);
}

/**
 * Drive a handler against the live instance, SELF-GUARDING every
 * role-tool path it issues. The capture seam is used in PASS-THROUGH
 * mode: it observes (method, path), guards it via assertSafeRolesPath,
 * then performs the REAL request so the live response flows back to
 * the handler unchanged.
 *
 * The seam is process-global — once installed, every makeClient().request
 * routes through it. To issue the genuine network call WITHOUT recursing
 * back into the interceptor, the seam is cleared for the duration of
 * the real call and reinstalled immediately after, inside a try/finally.
 *
 * Mirrors authz-share-entity-live.smoke.js:207-241 verbatim, swapping
 * the share-entity guard for assertSafeRolesPath.
 *
 * @param {Function} handler - the role handler (handleListRoles, etc.)
 * @param {object} args - the MCP arguments object
 * @param {object} conn - the resolved connection config
 * @returns {Promise<object>} the handler's MCP response
 */
async function driveHandlerGuarded(handler, args, conn) {
    const passthroughClient = makeClient(conn);

    const interceptor = async (req) => {
        // 1. GUARD FIRST — abort if any role-tool MUTATION path reaches
        //    the network under dryRun:true. The dryRun short-circuit
        //    inside the wrapper is the primary protection; this guard
        //    is defense-in-depth.
        assertSafeRolesPath(req?.method, req?.path);
        // 2. Issue the genuine call with the seam uninstalled so the
        //    real request does not recurse back into this interceptor.
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
 * Run the full dryRun-only smoke probe against the live `test`
 * connection. Exercises all 7 role tools end-to-end; each step
 * asserts a contract pinned in Plan 11-01 / 11-02 (dryRun envelope
 * shape, body=={} for assign, builtin refusal for update Admin,
 * last-admin guard etc.) and exits 1 on any unexpected outcome.
 *
 * @returns {Promise<void>}
 */
async function runSmoke() {
    const { name: connName, conn } = resolveProbeConnection();
    console.error(
        `[smoke] Probing 7 role tools against connection "${connName}" `
            + `(${conn.baseUrl}) — dryRun: true for mutators, GET-only for reads.\n`,
    );

    // ===================================================================
    // Read probes (live GETs; no mutation possible by construction)
    // ===================================================================

    // 1. list_roles — full role list. Live UNESCO 7.0.6 has ≥ 16 built-ins.
    const listRes = await driveHandlerGuarded(
        handleListRoles,
        { connectionName: connName },
        conn,
    );
    const listPayload = parseHandlerResult(listRes, "list_roles");
    if (!Array.isArray(listPayload.roles) || listPayload.roles.length < 1) {
        console.error(
            `[smoke] list_roles returned no roles — investigate (payload: `
                + `${JSON.stringify(listPayload).slice(0, 200)})`,
        );
        process.exit(1);
    }
    console.error(`[smoke] PASS list_roles — ${listPayload.roles.length} roles`);

    // 2. get_role on Admin (always exists as a built-in; D-08 projects
    //    members to {username, full_name, email} only).
    const getRes = await driveHandlerGuarded(
        handleGetRole,
        { connectionName: connName, roleName: "Admin" },
        conn,
    );
    const getPayload = parseHandlerResult(getRes, "get_role Admin");
    if (getPayload.role?.name !== "Admin") {
        console.error(
            `[smoke] get_role Admin returned wrong role (got name="${getPayload.role?.name}")`,
        );
        process.exit(1);
    }
    console.error(
        `[smoke] PASS get_role Admin — ${(getPayload.members ?? []).length} members`,
    );

    // ===================================================================
    // Mutating-tool probes (dryRun: true ONLY — apply never runs)
    // ===================================================================

    // 3. create_role dryRun — propose creating a hypothetical role.
    //    Uses a unique throwaway name that is NEVER applied; the
    //    handler stops at the preview envelope. The permission
    //    "streams:read" is in every Graylog catalogue (verified by
    //    Plan 11-01's permissions-catalogue fixture).
    const createName = `_smoke_probe_role_${Date.now()}`;
    const createRes = await driveHandlerGuarded(
        handleCreateRole,
        {
            connectionName: connName,
            name: createName,
            description: "Phase 11 smoke probe — should never be created (dryRun: true).",
            permissions: ["streams:read"],
            dryRun: true,
        },
        conn,
    );
    const createPayload = parseHandlerResult(createRes, "create_role dryRun");
    if (createPayload.dryRun !== true) {
        console.error(`[smoke] create_role: expected dryRun:true, got ${createPayload.dryRun}`);
        process.exit(1);
    }
    if (typeof createPayload.confirmationToken !== "string"
        || !/^[0-9a-f]{64}$/.test(createPayload.confirmationToken)) {
        console.error(
            `[smoke] create_role: confirmationToken missing or not 64-hex `
                + `(got "${createPayload.confirmationToken}")`,
        );
        process.exit(1);
    }
    if (createPayload.preview?.method !== "POST"
        || createPayload.preview?.path !== "/api/roles") {
        console.error(
            `[smoke] create_role preview wrong: expected POST /api/roles, got `
                + `${createPayload.preview?.method} ${createPayload.preview?.path}`,
        );
        process.exit(1);
    }
    console.error(
        `[smoke] PASS create_role "${createName}" dryRun — token=`
            + `${createPayload.confirmationToken.slice(0, 12)}…`,
    );

    // 4. update_role on Admin — MUST refuse client-side with
    //    builtin_role_immutable BEFORE any HTTP write. Admin is in the
    //    static BUILT_IN_ROLES Set so assertRoleIsMutable fires at
    //    build() step 1.
    const updateRefusedRes = await driveHandlerGuarded(
        handleUpdateRole,
        {
            connectionName: connName,
            roleName: "Admin",
            permissions: ["streams:read"],
            dryRun: true,
        },
        conn,
    );
    if (updateRefusedRes?.isError !== true
        || updateRefusedRes.reason !== "builtin_role_immutable") {
        console.error(
            `[smoke] update_role Admin: expected isError + reason=builtin_role_immutable, `
                + `got isError=${updateRefusedRes?.isError} reason=${updateRefusedRes?.reason} `
                + `body=${JSON.stringify(updateRefusedRes).slice(0, 200)}`,
        );
        process.exit(1);
    }
    console.error(
        "[smoke] PASS update_role Admin client-side refused with builtin_role_immutable",
    );

    // 5. delete_role on a likely-nonexistent custom role. Two acceptable
    //    outcomes:
    //      (a) role_not_found  — the role doesn't exist (most likely)
    //      (b) well-formed dryRun preview if a same-named role somehow
    //          exists (operator picked a colliding name)
    //    The handler's assertRoleIsMutable fires first for built-ins,
    //    so the `_smoke_probe_nonexistent_*` name (custom) sails past
    //    that check and lands on the pre-flight GET → 404 → tagError.
    const nonexistentName = `_smoke_probe_nonexistent_${Date.now()}`;
    const deleteRes = await driveHandlerGuarded(
        handleDeleteRole,
        {
            connectionName: connName,
            roleName: nonexistentName,
            dryRun: true,
        },
        conn,
    );
    if (deleteRes?.isError === true && deleteRes.reason === "role_not_found") {
        console.error(
            `[smoke] PASS delete_role "${nonexistentName}" — role_not_found (expected)`,
        );
    } else if (!deleteRes?.isError) {
        const deletePayload = JSON.parse(deleteRes.content[0].text);
        if (deletePayload.dryRun !== true) {
            console.error(
                `[smoke] delete_role: expected dryRun:true on the unexpected-hit path, `
                    + `got ${deletePayload.dryRun}`,
            );
            process.exit(1);
        }
        console.error(
            `[smoke] PASS delete_role dryRun (role unexpectedly existed) — `
                + `cascades.count=${deletePayload.preview?.cascades?.count ?? 0}`,
        );
    } else {
        console.error(
            `[smoke] delete_role unexpected error: `
                + `${JSON.stringify(deleteRes).slice(0, 200)}`,
        );
        process.exit(1);
    }

    // 6. assign_role dryRun — propose assigning the connection's
    //    API-token user to Reader (likely idempotent — most token
    //    users have Reader). The body=={} (literal empty object) is
    //    the load-bearing safety contract (Pitfall 3 / AP1).
    //    Discover the token user via /api/users/me; fall back to "admin"
    //    if /me is unavailable.
    let probeUsername;
    try {
        const me = await makeClient(conn).request("GET", "/api/users/me", null);
        probeUsername = typeof me?.username === "string" && me.username.length > 0
            ? me.username
            : "admin";
    } catch {
        probeUsername = "admin";
    }
    const assignRes = await driveHandlerGuarded(
        handleAssignRole,
        {
            connectionName: connName,
            roleName: "Reader",
            username: probeUsername,
            dryRun: true,
        },
        conn,
    );
    const assignPayload = parseHandlerResult(assignRes, `assign_role Reader/${probeUsername}`);
    if (assignPayload.dryRun !== true) {
        console.error(`[smoke] assign_role: expected dryRun:true, got ${assignPayload.dryRun}`);
        process.exit(1);
    }
    // body=={} MANDATORY (Pitfall 3 / AP1) — assign uses literal "{}"
    // because Graylog's PUT-with-no-body requirement otherwise 415s.
    const assignBodySerialized = JSON.stringify(assignPayload.preview?.body);
    if (assignBodySerialized !== "{}") {
        console.error(
            `[smoke] assign_role: preview.body MUST be {} (Pitfall 3 / AP1) — `
                + `got: ${assignBodySerialized}`,
        );
        process.exit(1);
    }
    if (assignPayload.preview?.method !== "PUT"
        || !assignPayload.preview?.path?.startsWith("/api/roles/Reader/members/")) {
        console.error(
            `[smoke] assign_role: expected PUT /api/roles/Reader/members/{u}, got `
                + `${assignPayload.preview?.method} ${assignPayload.preview?.path}`,
        );
        process.exit(1);
    }
    console.error(
        `[smoke] PASS assign_role Reader/${probeUsername} dryRun — body=={} preserved`,
    );

    // 7. unassign_role dryRun — propose unassigning the same user from
    //    Reader. Two acceptable outcomes:
    //      (a) not_currently_assigned — the user is not a Reader member
    //      (b) well-formed dryRun preview with current_roles surfaced
    //    Either is a structural pass (no mutation occurred).
    const unassignRes = await driveHandlerGuarded(
        handleUnassignRole,
        {
            connectionName: connName,
            roleName: "Reader",
            username: probeUsername,
            dryRun: true,
        },
        conn,
    );
    if (unassignRes?.isError === true && unassignRes.reason === "not_currently_assigned") {
        console.error(
            `[smoke] PASS unassign_role Reader/${probeUsername} — `
                + "not_currently_assigned (user not a Reader)",
        );
    } else if (!unassignRes?.isError) {
        const unassignPayload = JSON.parse(unassignRes.content[0].text);
        if (unassignPayload.dryRun !== true) {
            console.error(
                `[smoke] unassign_role: expected dryRun:true, got ${unassignPayload.dryRun}`,
            );
            process.exit(1);
        }
        console.error(
            `[smoke] PASS unassign_role Reader/${probeUsername} dryRun — `
                + `current_roles=${(unassignPayload.preview?.cascades?.current_roles ?? []).length}`,
        );
    } else {
        console.error(
            `[smoke] unassign_role unexpected error: `
                + `${JSON.stringify(unassignRes).slice(0, 200)}`,
        );
        process.exit(1);
    }

    // ===================================================================
    // Negative sanity — delete_role Admin must refuse client-side BEFORE
    // any HTTP call. We install a counting seam and assert 0 calls fire.
    // ===================================================================
    let preCallCount = 0;
    _setCaptureRequest((/* req */) => {
        preCallCount += 1;
        throw new Error(
            "delete_role Admin attempted an HTTP call — assertRoleIsMutable should have refused.",
        );
    });
    let adminDelRes;
    try {
        adminDelRes = await handleDeleteRole({
            params: {
                arguments: {
                    connectionName: connName,
                    roleName: "Admin",
                    dryRun: true,
                },
            },
        });
    } finally {
        _clearCaptureRequest();
    }
    if (adminDelRes?.isError !== true || adminDelRes.reason !== "builtin_role_immutable") {
        console.error(
            `[smoke] delete_role Admin: expected isError + reason=builtin_role_immutable, `
                + `got isError=${adminDelRes?.isError} reason=${adminDelRes?.reason} `
                + `body=${JSON.stringify(adminDelRes).slice(0, 200)}`,
        );
        process.exit(1);
    }
    if (preCallCount !== 0) {
        console.error(
            `[smoke] delete_role Admin made ${preCallCount} HTTP call(s) — `
                + "should be 0 (client-side refusal must fire BEFORE any GET).",
        );
        process.exit(1);
    }
    console.error(
        "[smoke] PASS delete_role Admin client-side refused with builtin_role_immutable "
            + "(0 HTTP calls observed)",
    );

    console.error(
        "\n[smoke] === ALL 7 ROLE TOOLS PASSED dryRun:true LIVE PROBE ===",
    );
}

// CLI entrypoint — runs when invoked as
// `node test/authz-roles-live.smoke.js`. Skipped when imported.
const isMain =
    process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
    try {
        await runSmoke();
        process.exit(0);
    } catch (err) {
        console.error(`[smoke] FAIL: ${err?.message ?? err}`);
        process.exit(1);
    }
}
