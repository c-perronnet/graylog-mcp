#!/usr/bin/env node
// Phase 8 Plan 08-03 — one-shot read-only live `/prepare` recon probe.
//
// Purpose: capture the REAL Graylog 7.0.6 `EntityShareResponse` wire shape as a
// committed fixture so Phases 9/10 parse a verified DTO, not the two-minors-ahead
// 7.2 source clone (08-RESEARCH Pitfall 5).
//
// SAFETY (08-RESEARCH Pitfall 1):
//   - The ONLY endpoint this script touches is
//       POST /api/authz/shares/entities/{URL-encoded-GRN}/prepare
//     with an EMPTY body `{}`. That endpoint is `@NoAuditEvent` — it mutates
//     nothing and is safe against the live UNESCO production `test` instance.
//   - The commit endpoint `POST .../entities/{GRN}` (no `/prepare` suffix) is
//     FORBIDDEN this phase and appears nowhere here. The script asserts its own
//     request path ends in the literal `/prepare` and exits 2 otherwise.
//   - The probe never sends a non-empty `selected_grantee_capabilities` body and
//     never targets `grn::::builtin-team:everyone`.
//
// HTTP discipline (08-RESEARCH §"Don't Hand-Roll"): every call goes through
// `makeClient(conn).request(...)` from src/graylog/client.js — never a raw
// HTTP-client import at this script site.
//
// CLI conventions mirror scripts/audit-tool-descriptions.js: shebang, node:url /
// node:path imports, the `isMain` main-guard, `process.exit` status codes
// (0 success, non-zero failure).

import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

import { buildGrn } from "../src/tools/authz/grn-helpers.js";
import { makeClient } from "../src/graylog/client.js";
import { getConnections, getActiveConnectionConfig } from "../src/config.js";

// The connection the probe targets — the live Graylog 7.0.6 `test` instance.
const TARGET_CONNECTION = "test";

/**
 * Resolve the `test` connection from the config registry.
 *
 * The probe is a plain CLI script with no MCP request envelope, so it cannot
 * use `resolveConnection`; it reads the connection registry directly.
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
 * Run the read-only `/prepare` probe and write the verbatim response to the
 * fixture file with an injected `_provenance` block.
 *
 * @returns {Promise<void>}
 */
async function captureFixture() {
    const { name, conn } = resolveProbeConnection();
    const client = makeClient(conn);

    // Discover an existing stream id on the live instance — never hardcode one
    // (08-RESEARCH A3). Take the first stream returned by GET /api/streams.
    const streamsResponse = await client.request("GET", "/api/streams");
    const streams = Array.isArray(streamsResponse?.streams)
        ? streamsResponse.streams
        : [];
    if (streams.length === 0 || typeof streams[0]?.id !== "string") {
        throw new Error(
            "GET /api/streams returned no stream with an id — cannot seed the /prepare probe.",
        );
    }
    const streamId = streams[0].id;

    // Build the entity GRN via buildGrn (never inline string concatenation).
    const entityGrn = buildGrn("stream", streamId);

    // CRITICAL (08-RESEARCH Pitfall 4): the GRN's literal colons MUST be
    // percent-encoded (colons -> %3A) before path interpolation, or the JAX-RS
    // router mis-splits the path.
    const path = `/api/authz/shares/entities/${encodeURIComponent(entityGrn)}/prepare`;

    // Pitfall 1 guard: assert the request path ends in `/prepare`. The commit
    // endpoint (no `/prepare`) is forbidden this phase.
    if (!path.endsWith("/prepare")) {
        console.error(
            `[capture-authz-prepare] FATAL: request path "${path}" does not end in /prepare — refusing.`,
        );
        process.exit(2);
    }

    console.error(`[capture-authz-prepare] probing ${conn.baseUrl}${path}`);

    // The one live network call: an EMPTY body `{}` makes this a pure read of
    // the current grant state. `/prepare` is `@NoAuditEvent` — mutates nothing.
    const response = await client.request("POST", path, {});

    // Discover the Graylog version for the provenance block (best-effort).
    let graylogVersion = "unknown";
    try {
        const root = await client.request("GET", "/api/system");
        if (typeof root?.version === "string") {
            graylogVersion = root.version;
        }
    } catch {
        // Non-fatal — provenance version stays "unknown" if /api/system fails.
    }

    const fixture = {
        _provenance: {
            captured_by: "scripts/capture-authz-prepare-fixture.js",
            instance: conn.baseUrl,
            connection: name,
            graylog_version: graylogVersion,
            source_entity_grn: entityGrn,
            endpoint: `POST ${path}`,
            request_body: {},
            captured_at: new Date().toISOString(),
            note: "Verbatim live 7.0.6 EntityShareResponse from a @NoAuditEvent /prepare probe.",
        },
        ...response,
    };

    const fixtureDir = join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "test",
        "fixtures",
        "authz",
    );
    mkdirSync(fixtureDir, { recursive: true });
    const fixturePath = join(fixtureDir, "prepare-response-7.0.6.json");
    writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");

    console.error(`[capture-authz-prepare] wrote ${fixturePath}`);
}

// CLI entrypoint — runs when invoked as
// `node scripts/capture-authz-prepare-fixture.js`. Skipped when imported.
const isMain =
    process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
    try {
        await captureFixture();
        console.error("[capture-authz-prepare] OK — fixture captured");
        process.exit(0);
    } catch (err) {
        console.error(`[capture-authz-prepare] FAILED: ${err.message}`);
        process.exit(1);
    }
}
