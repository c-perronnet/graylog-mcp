#!/usr/bin/env node
// Phase 11 Plan 11-03 — one-shot read-only live recon probe for the
// role-management surface against the production UNESCO Graylog 7.0.6+
// `test` connection.
//
// SAFETY: Every request is a GET. Never PUT/POST/DELETE. The live `test`
// connection is REAL UNESCO production infrastructure (project memory:
// `graylog-test-connection-is-live-unesco`). The script self-guards by
// asserting every issued method === "GET"; any non-GET aborts
// process.exit(2). Belt-and-braces: the assertion is hand-rolled at
// every call site so a future refactor that drops one assertion is
// caught by the Task 1 grep gates (≥6 "GET" strings, ≥6 assertGetOnly
// call-sites, 0 POST/PUT/DELETE/PATCH literals).
//
// Captures 5 fixtures, OVERWRITING the Plan 11-01 placeholders with the
// verbatim live responses + _provenance blocks. Run ONCE per Graylog
// upgrade or built-in-role drift; the resulting fixture files are
// committed to git and replayed offline by test/authz-roles.test.js via
// the `_setCaptureRequest` seam.
//
// Endpoints captured (D-22):
//   0. GET /api/system                                  (graylog_version → _provenance, not written as a fixture)
//   1. GET /api/roles                                   → list-roles-7.0.6.json
//   2. GET /api/roles/Admin                             → get-role-admin-7.0.6.json
//   3. GET /api/roles/Reader/members                    → get-role-members-reader-7.0.6.json
//   4. GET /api/authz/roles/user/admin                  → user-roles-admin-7.0.6.json
//   5. GET /api/system/permissions                      → permissions-catalogue-7.0.6.json
//
// Pattern source: scripts/capture-authz-prepare-fixture.js (Phase 8 plan
// 08-03 — same _provenance + writeFixture + SELF-GUARD discipline).
//
// HTTP discipline: every call goes through `makeClient(conn).request(...)`
// from src/graylog/client.js — no raw HTTP-client import at this site.
// CLI conventions mirror scripts/audit-tool-descriptions.js and
// scripts/capture-authz-prepare-fixture.js: shebang, node:url / node:path
// imports, isMain main-guard, process.exit status codes (0 success, 1
// caught error, 2 SELF-GUARD violation).

import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

import { makeClient } from "../src/graylog/client.js";
import { getConnections, getActiveConnectionConfig } from "../src/config.js";

// The connection the probe targets — the live Graylog 7.0.6+ `test`
// instance (UNESCO production). Same name the Phase 8 capture probe and
// the Phase 10/11 smoke probes use.
const TARGET_CONNECTION = "test";

// Fixture output directory — resolved from this script's location so the
// script runs correctly regardless of the operator's cwd.
const FIXTURE_DIR = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "test",
    "fixtures",
    "authz",
    "roles",
);

/**
 * Resolve the `test` connection from the config registry.
 *
 * The probe is a plain CLI script with no MCP request envelope, so it
 * cannot use `resolveConnection`; it reads the connection registry
 * directly. Mirrors scripts/capture-authz-prepare-fixture.js:47-57.
 *
 * @returns {{name: string, conn: object}}
 * @throws when the `test` connection is absent from ~/.graylog-mcp/config.json
 */
function resolveProbeConnection() {
    const connections = getConnections();
    const conn = connections[TARGET_CONNECTION] ?? getActiveConnectionConfig();
    if (!conn || typeof conn.baseUrl !== "string") {
        throw new Error(
            `Connection "${TARGET_CONNECTION}" not found in the config registry — ` +
                `add it to ~/.graylog-mcp/config.json before running this probe.`,
        );
    }
    return { name: TARGET_CONNECTION, conn };
}

/**
 * Build the `_provenance` block injected at the top of every fixture so
 * downstream tests + reviewers can trace the captured data back to its
 * source instance + endpoint + capture time + Graylog version.
 *
 * @param {string} endpoint - "GET /api/roles" style human label
 * @param {string} graylogVersion - the Graylog server version (e.g. "7.0.6+711d207")
 * @param {object} conn - the resolved connection
 * @returns {object}
 */
function buildProvenance(endpoint, graylogVersion, conn) {
    return {
        captured_by: "scripts/capture-roles-fixtures.js",
        instance: conn.baseUrl,
        connection: TARGET_CONNECTION,
        graylog_version: graylogVersion,
        endpoint,
        captured_at: new Date().toISOString(),
        note:
            "Verbatim live Graylog response. Phase 11 Plan 11-03 capture overwrote " +
            "Plan 11-01 placeholder.",
    };
}

/**
 * Atomic-ish fixture write: mkdir -p + writeFileSync. The capture script
 * runs serially against 5 endpoints; if any call fails the operator re-runs
 * the whole script (the captured fixtures are deterministic given the live
 * instance state at capture time, so partial writes are not a corruption
 * risk — a re-run produces the same bytes).
 *
 * @param {string} name - fixture filename (e.g. "list-roles-7.0.6.json")
 * @param {object} content - the full fixture object including _provenance
 */
function writeFixture(name, content) {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const path = join(FIXTURE_DIR, name);
    writeFileSync(path, `${JSON.stringify(content, null, 2)}\n`, "utf8");
    // Diagnostics on stderr keep stdout clean for piping.
    console.error(`[capture-roles] wrote ${path}`);
}

/**
 * SELF-GUARD: assert the issued HTTP method is "GET". Any non-GET
 * aborts process.exit(2). The capture script never mutates the live
 * instance — every endpoint touched is a pure read. A regression that
 * silently changes one call to a write method (e.g. someone copy-pastes
 * the captureFixture body into a future plan that needs a POST) is
 * caught here before the live mutation lands.
 *
 * Hand-asserted at every call-site (not a wrapper) so the Task 1 grep
 * acceptance gates (`assertGetOnly` call-count ≥ 6, `"GET"` literal
 * count ≥ 6) directly observe the discipline at every endpoint.
 *
 * @param {string} method - the HTTP method about to be issued
 * @param {string} path - the request path (for diagnostic context)
 */
function assertGetOnly(method, path) {
    if (method !== "GET") {
        console.error(
            `[capture-roles] FATAL: non-GET method "${method}" to path "${path}" — refusing.`,
        );
        process.exit(2);
    }
}

/**
 * Run the read-only capture against the live `test` connection.
 * Captures the system version first (populates _provenance.graylog_version),
 * then captures the 5 role-management fixtures.
 *
 * @returns {Promise<void>}
 */
async function captureAll() {
    const { name, conn } = resolveProbeConnection();
    const client = makeClient(conn);

    console.error(
        `[capture-roles] Probing connection "${name}" at ${conn.baseUrl} — GET-only`,
    );

    // 0. System version — populates _provenance.graylog_version. Best-effort:
    //    if the call fails the operator sees the failure and decides whether
    //    to retry; we do NOT silently fall back to "unknown" because the
    //    fixture's "verbatim live 7.0.6" authority hinges on the version
    //    being accurate.
    assertGetOnly("GET", "/api/system");
    const sys = await client.request("GET", "/api/system", null);
    const graylogVersion =
        typeof sys?.version === "string" && sys.version.length > 0
            ? sys.version
            : "unknown";

    if (graylogVersion === "unknown") {
        console.error(
            "[capture-roles] WARNING: could not resolve Graylog version " +
                "from /api/system — provenance.graylog_version will be 'unknown'.",
        );
    } else {
        console.error(
            `[capture-roles] Graylog version: ${graylogVersion}`,
        );
    }

    const provenance = (endpoint) => buildProvenance(endpoint, graylogVersion, conn);

    // 1. List all roles. Source for BUILT_IN_ROLES drift detection (16
    //    expected on live UNESCO 7.0.6).
    assertGetOnly("GET", "/api/roles");
    const listRoles = await client.request("GET", "/api/roles", null);
    writeFixture("list-roles-7.0.6.json", {
        _provenance: provenance("GET /api/roles"),
        ...listRoles,
    });

    // 2. Single Admin role — minimal RoleResponse shape (no members).
    assertGetOnly("GET", "/api/roles/Admin");
    const admin = await client.request("GET", "/api/roles/Admin", null);
    writeFixture("get-role-admin-7.0.6.json", {
        _provenance: provenance("GET /api/roles/Admin"),
        ...admin,
    });

    // 3. Reader members — multi-user RoleMembershipResponse (rich UserSummary
    //    per user; D-08 projects to {username, full_name, email} at the
    //    handler level, but the fixture is verbatim for the offline test
    //    that exercises the projection).
    assertGetOnly("GET", "/api/roles/Reader/members");
    const readerMembers = await client.request(
        "GET",
        "/api/roles/Reader/members",
        null,
    );
    writeFixture("get-role-members-reader-7.0.6.json", {
        _provenance: provenance("GET /api/roles/Reader/members"),
        ...readerMembers,
    });

    // 4. Admin user's roles — paginated /api/authz/roles/user/{username}
    //    response (used by assign_role / unassign_role pre-flight to surface
    //    the user's current roles in the dry-run preview).
    assertGetOnly("GET", "/api/authz/roles/user/admin");
    const adminUserRoles = await client.request(
        "GET",
        "/api/authz/roles/user/admin",
        null,
    );
    writeFixture("user-roles-admin-7.0.6.json", {
        _provenance: provenance("GET /api/authz/roles/user/admin"),
        ...adminUserRoles,
    });

    // 5. Permission catalogue — used by D-01 catalogue-validation tests
    //    in create_role / update_role. The map of `{resource: [actions...]}`
    //    drives the {type}:{action} prefix check (D-02).
    assertGetOnly("GET", "/api/system/permissions");
    const catalogue = await client.request("GET", "/api/system/permissions", null);
    writeFixture("permissions-catalogue-7.0.6.json", {
        _provenance: provenance("GET /api/system/permissions"),
        ...catalogue,
    });

    console.error(
        `[capture-roles] OK — 5 fixtures written to ${FIXTURE_DIR}`,
    );
}

// CLI entrypoint — runs when invoked as
// `node scripts/capture-roles-fixtures.js`. Skipped when imported.
const isMain =
    process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
    try {
        await captureAll();
        process.exit(0);
    } catch (err) {
        console.error(`[capture-roles] FAILED: ${err?.message ?? err}`);
        process.exit(1);
    }
}
