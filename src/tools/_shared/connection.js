// Connection resolver (FOUND-09 + D-07 wrapper-side + D-08 singleton fallback).
//
// Three-mode lookup:
//   1. args._testConnection: project-standard magic arg (see cluster-errors.js + template-mgmt.js).
//      Returns a synthetic { conn, name } that lets tests run without the config module's
//      ~/.graylog-mcp/config.json. Production tool schemas (Phase 1+) MUST NOT declare
//      _testConnection in their zod shape — zod's default `strip` mode then drops it,
//      making the seam unreachable from production agents.
//   2. args.connectionName: per-call override (FOUND-09). Looks up connections[args.connectionName].
//      Missing → returns { error: errorResponse(...) } listing available names.
//   3. fallback: singleton via getActiveConnection() + getActiveConnectionConfig() (D-08).
//      No active connection → { error: errorResponse(...) }.
//
// All paths return the SAME shape so callers (defineMutatingHandler, defineListHandler) can
// destructure { conn, name, error } once.

import {
    getActiveConnection,
    getActiveConnectionConfig,
    getConnections,
} from "../../config.js";
import { errorResponse } from "./errors.js";

/**
 * @param {object} args
 * @returns {{ conn?: object, name?: string, error?: { isError: true, content: Array<unknown> } }}
 */
export function resolveConnection(args) {
    // Test seam — project convention (cluster-errors.js:22-24, template-mgmt.js:9).
    // Returns a synthetic conn with writable: true so tests that don't specifically
    // target the writable gate aren't blocked by it.
    if (args._testConnection) {
        return {
            name: args._testConnection,
            conn: { baseUrl: "_test", apiToken: "_test", writable: true },
        };
    }

    // Per-call connectionName (FOUND-09).
    if (args.connectionName) {
        const connections = getConnections();
        const conn = connections[args.connectionName];
        if (!conn) {
            const available = Object.keys(connections).join(", ");
            return {
                error: errorResponse(
                    `Connection "${args.connectionName}" not found. Available: ${available || "none"}.`
                ),
            };
        }
        return { name: args.connectionName, conn };
    }

    // Singleton fallback (D-08). Wording is tool-name-agnostic so it's stable
    // across Plan 05's use_connection → set_active_connection rename.
    const conn = getActiveConnectionConfig();
    if (!conn) {
        const available = Object.keys(getConnections()).join(", ");
        return {
            error: errorResponse(
                `No active connection. Use the active-connection setter first (or pass connectionName per call). Available: ${available || "none"}.`
            ),
        };
    }
    return { name: getActiveConnection(), conn };
}
