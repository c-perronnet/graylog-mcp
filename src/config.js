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
    return connections[activeConnection];
}
