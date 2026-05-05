const strategies = new Map();

export function register(name, strategy) {
    if (strategies.has(name)) {
        throw new Error(`Strategy "${name}" already registered`);
    }
    if (!strategy || typeof strategy.cluster !== "function") {
        throw new Error(`Strategy "${name}" must implement cluster()`);
    }
    strategies.set(name, strategy);
}

export function get(name) {
    if (!strategies.has(name)) {
        throw new Error(
            `Unknown clustering algorithm "${name}". Registered: ${list().join(", ") || "none"}`
        );
    }
    return strategies.get(name);
}

export function list() {
    return [...strategies.keys()];
}

// Test-only: reset registry between unit tests
export function _clearForTests() {
    strategies.clear();
}

// Built-in strategies — auto-register on first import of this module.
// To add a new built-in: import its module here so its register() side-effect runs.
import { drain3Strategy } from "./strategies/drain3.js";
if (!strategies.has("drain3")) {
    register("drain3", drain3Strategy);
}
