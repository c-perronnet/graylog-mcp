import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

let connections = {};
let globalDefaultFields = null;
const defaultConfigPath = join(homedir(), ".graylog-mcp", "config.json");
const configPath = process.env.GRAYLOG_CONFIG_PATH || defaultConfigPath;

try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    connections = config.connections || {};
    if (Array.isArray(config.defaultFields) && config.defaultFields.length > 0) {
        globalDefaultFields = config.defaultFields;
    }
} catch {
    // No config file found
}

let activeConnection = null;

// Test-only seam. Lets unit tests inject a connections registry without writing to
// ~/.graylog-mcp/config.json. Used by test/connection.test.js and test/handler.test.js.
// Production code MUST NOT call _setConnectionsForTests — the `_` prefix marks it as
// test-only per project convention.
let _testConnectionsOverride = null;
export function _setConnectionsForTests(map) {
    _testConnectionsOverride = map;
}
export function _clearConnectionsForTests() {
    _testConnectionsOverride = null;
}

export function getDefaultFields() {
    // Priority 1: Connection-specific defaultFields
    const connConfig = getActiveConnectionConfig();
    if (connConfig && Array.isArray(connConfig.defaultFields) && connConfig.defaultFields.length > 0) {
        return connConfig.defaultFields;
    }
    // Priority 2: Global defaultFields from config
    if (globalDefaultFields) {
        return globalDefaultFields;
    }
    // Priority 3: Return all fields
    return "*";
}

export function getConfigPath() {
    return configPath;
}

export function getConnections() {
    if (_testConnectionsOverride) return _testConnectionsOverride;
    return connections;
}

export function getActiveConnection() {
    return activeConnection;
}

export function setActiveConnection(name) {
    activeConnection = name;
}

export function getActiveConnectionConfig() {
    if (!activeConnection) return null;
    const source = _testConnectionsOverride ?? connections;
    return source[activeConnection];
}

// Per D-07: `writable` is an optional connection field. Absent → defaults true
// (backward compat with all existing configs). Set to false to refuse all
// mutating tools on a connection.
// Consumers:
//   - src/tools/_shared/handler.js (wrapper-layer short-circuit, returns isError
//     with reason: "connection_read_only")
//   - src/graylog/client.js (defense-in-depth refusal at the HTTP call site)
// Returns:
//   - true  when connection exists and writable !== false
//   - false when connection exists and writable === false
//   - undefined when no such connection (callers can detect missing-connection)
export function getConnectionWritable(name) {
    const source = _testConnectionsOverride ?? connections;
    const conn = source[name];
    if (!conn) return undefined;
    return conn.writable !== false;
}
