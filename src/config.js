import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

let connections = {};
const configPath = join(homedir(), ".graylog-mcp", "config.json");
try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    connections = config.connections || {};
} catch {
    // No config file found
}

let activeConnection = null;

export const DEFAULT_FIELDS = [
    "timestamp",
    "gl2_message_id",
    "source",
    "env",
    "level",
    "message",
    "logger_name",
    "thread_name",
    "PODNAME",
];

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
