import {
    readFileSync, writeFileSync, mkdirSync, renameSync, existsSync,
    statSync, unlinkSync, openSync, closeSync
} from "node:fs";
import { dirname, join } from "node:path";
import { getConfigPath } from "../config.js";

const STORE_VERSION = 1;
const LOCK_STALE_MS = 30_000;

let pathOverride = null;
export function _withStorePathOverride(fn) { pathOverride = fn; }

function storePath(connectionName) {
    if (pathOverride) return pathOverride(connectionName);
    return join(dirname(getConfigPath()), "templates", `${connectionName}.json`);
}

function emptyStore(connectionName) {
    return {
        version: STORE_VERSION,
        connection: connectionName,
        algorithm: "drain3",
        algorithm_state: {},
        templates: {},
    };
}

export function loadTemplateStore(connectionName) {
    const file = storePath(connectionName);
    try {
        const raw = readFileSync(file, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed.version !== STORE_VERSION) {
            console.error(`[clustering] store version mismatch for ${connectionName}; starting fresh`);
            return emptyStore(connectionName);
        }
        return parsed;
    } catch (err) {
        if (err.code !== "ENOENT") {
            console.error(`[clustering] failed to read template store for ${connectionName}: ${err.message}`);
        }
        return emptyStore(connectionName);
    }
}

function acquireLock(file) {
    const lock = `${file}.lock`;
    try {
        const fd = openSync(lock, "wx");
        closeSync(fd);
        return lock;
    } catch (err) {
        if (err.code === "EEXIST") {
            try {
                const age = Date.now() - statSync(lock).mtimeMs;
                if (age > LOCK_STALE_MS) {
                    console.error(`[clustering] breaking stale lock (${age}ms old): ${lock}`);
                    unlinkSync(lock);
                    return acquireLock(file);
                }
            } catch (_) { /* race: lock vanished */ }
        }
        throw err;
    }
}

function releaseLock(lockPath) {
    try { unlinkSync(lockPath); } catch (_) { /* ignore */ }
}

export function saveTemplateStore(connectionName, store) {
    const file = storePath(connectionName);
    mkdirSync(dirname(file), { recursive: true });
    const lock = acquireLock(file);
    try {
        const tmp = `${file}.tmp`;
        writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
        renameSync(tmp, file);
    } finally {
        releaseLock(lock);
    }
}

export { storePath as _storePathForTests };
