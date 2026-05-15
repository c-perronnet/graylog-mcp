// Map-backed tool dispatch — replaces the inline `if (name === ...)` chain
// in src/index.js (FOUND-01). Every tool registers its handler at module-init
// via src/tools/_register.js; src/index.js calls assertAllToolsRegistered
// before connecting the stdio transport so a misconfigured deployment fails
// loudly at startup (Discretion-06: hard throw, not log).

const handlers = new Map();

export function register(name, handler) {
    if (handlers.has(name)) {
        throw new Error(`Tool already registered: ${name}`);
    }
    if (typeof handler !== "function") {
        throw new Error(`Tool "${name}" handler is not a function (got ${typeof handler})`);
    }
    handlers.set(name, handler);
}

export async function dispatch(request) {
    const name = request.params?.name;
    const fn = handlers.get(name);
    if (!fn) {
        throw new Error(`Tool not found: ${name}`);
    }
    return fn(request);
}

export function assertAllToolsRegistered(toolDefinitions) {
    const missing = toolDefinitions
        .map((t) => t.name)
        .filter((name) => !handlers.has(name));
    if (missing.length > 0) {
        throw new Error(
            `Dispatch assertion failed — tools in tools.js without registered handlers: ${missing.join(", ")}`
        );
    }
}

// Test-only seam: reset registry between unit tests.
// Production code MUST NOT call this — clears all registered handlers.
export function _clearForTests() {
    handlers.clear();
}
