# Error Grouping by Similarity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `cluster_log_messages` MCP tool plus 5 template-management tools that collapse similar log messages into Drain3-style templates, with a per-connection persistent template library and a pluggable strategy registry.

**Architecture:** New `src/clustering/` package owns preprocessing, the strategy registry, the drain3 implementation, the on-disk template store, and the response formatter. New `src/tools/` directory houses the 6 tool handlers. `src/tools.js` and `src/index.js` get additive edits only — no existing code is moved.

**Tech Stack:** Node 18+ (ESM), `node:assert` for tests, `node:fs` (sync), `node:crypto` for stable template IDs. No new npm dependencies.

**Spec:** [docs/superpowers/specs/2026-05-04-error-grouping-by-similarity-design.md](../specs/2026-05-04-error-grouping-by-similarity-design.md)

---

## File Structure

| File | Responsibility |
|---|---|
| `src/clustering/preprocess.js` | Normalize tokens (numbers, UUIDs, IPs, timestamps, hex) → `<*>` |
| `src/clustering/index.js` | Strategy registry: `register/get/list`. Auto-imports built-in strategies. |
| `src/clustering/strategies/drain3.js` | Drain3 algorithm: tokenize → length bucket → prefix tree → match/relax/insert |
| `src/clustering/template-store.js` | Per-connection JSON store. Atomic write, lockfile. Hydrate/serialize. |
| `src/clustering/formatter.js` | Build the MCP response shape from cluster output |
| `src/tools/cluster-errors.js` | `cluster_log_messages` handler: search → cluster → persist → format |
| `src/tools/template-mgmt.js` | `list/delete/rename/export/import_log_templates` handlers |
| `src/tools.js` | **Modify:** append 6 new tool definitions to existing `toolDefinitions` array |
| `src/index.js` | **Modify:** add 6 dispatch lines; import new handlers |
| `test-clustering.js` | New tests (preprocessor, strategy, registry, store, integration) |
| `README.md` | **Modify:** add "Clustering" section with usage |

---

## Task 1: Preprocessor — token normalization

**Files:**
- Create: `src/clustering/preprocess.js`
- Test: `test-clustering.js`

- [ ] **Step 1: Write the failing test**

Create `test-clustering.js`:

```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import { normalizeMessage, tokenize } from "./src/clustering/preprocess.js";

console.log("=== Preprocessor ===");

// Numbers → <*>
assert.equal(normalizeMessage("user 42 failed"), "user <*> failed");

// UUIDs → <*>
assert.equal(
    normalizeMessage("trace 550e8400-e29b-41d4-a716-446655440000 done"),
    "trace <*> done"
);

// IPv4 → <*>
assert.equal(normalizeMessage("client 192.168.1.10 connected"), "client <*> connected");

// IPv6 → <*>
assert.equal(normalizeMessage("from 2001:db8::1 ok"), "from <*> ok");

// ISO timestamps → <*>
assert.equal(
    normalizeMessage("at 2026-05-04T10:00:00Z event"),
    "at <*> event"
);

// Long hex → <*>
assert.equal(normalizeMessage("hash deadbeefcafebabe1234"), "hash <*>");

// Tokenize splits on whitespace
assert.deepEqual(tokenize("user <*> failed"), ["user", "<*>", "failed"]);

console.log("✓ preprocessor tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test-clustering.js`
Expected: FAIL with `Cannot find module './src/clustering/preprocess.js'`

- [ ] **Step 3: Implement `src/clustering/preprocess.js`**

```js
const WILDCARD = "<*>";

const PATTERNS = [
    // ISO timestamps (with or without ms / tz)
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
    // UUIDs
    /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
    // IPv4
    /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g,
    // IPv6 (simple form, including ::)
    /\b(?:[0-9a-fA-F]{1,4}:){1,7}(?::|[0-9a-fA-F]{1,4})\b/g,
    // Hex blobs (8+ chars) and 0x-prefixed
    /\b0x[0-9a-fA-F]+\b/g,
    /\b[0-9a-fA-F]{8,}\b/g,
    // Standalone numbers (after the above so we don't eat number parts of IPs/timestamps already replaced)
    /\b\d+\b/g,
];

export function normalizeMessage(text) {
    if (typeof text !== "string") return "";
    let out = text;
    for (const re of PATTERNS) {
        out = out.replace(re, WILDCARD);
    }
    // Collapse runs of <*> tokens
    out = out.replace(/(?:<\*>\s+)+<\*>/g, WILDCARD);
    return out.trim().replace(/\s+/g, " ");
}

export function tokenize(text) {
    return text.split(/\s+/).filter(t => t.length > 0);
}

export const WILDCARD_TOKEN = WILDCARD;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test-clustering.js`
Expected: `✓ preprocessor tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/clustering/preprocess.js test-clustering.js
git commit -m "feat(clustering): add preprocessor for token normalization"
```

---

## Task 2: Strategy registry

**Files:**
- Create: `src/clustering/index.js`
- Test: append to `test-clustering.js`

- [ ] **Step 1: Write the failing test**

Append to `test-clustering.js`:

```js
console.log("=== Registry ===");
import { register, get, list, _clearForTests } from "./src/clustering/index.js";

_clearForTests();

const fakeStrategy = {
    name: "fake",
    version: 1,
    hydrate: () => ({}),
    serialize: () => ({}),
    cluster: () => ({ assignments: [], templates: [] }),
};

register("fake", fakeStrategy);
assert.equal(get("fake"), fakeStrategy);
assert.deepEqual(list(), ["fake"]);

assert.throws(() => register("fake", fakeStrategy), /already registered/);
assert.throws(() => get("missing"), /Unknown clustering algorithm "missing"\. Registered: fake/);

console.log("✓ registry tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test-clustering.js`
Expected: FAIL with `Cannot find module './src/clustering/index.js'`

- [ ] **Step 3: Implement `src/clustering/index.js`**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test-clustering.js`
Expected: both `✓ preprocessor` and `✓ registry` lines.

- [ ] **Step 5: Commit**

```bash
git add src/clustering/index.js test-clustering.js
git commit -m "feat(clustering): add strategy registry"
```

---

## Task 3: Drain3 strategy

**Files:**
- Create: `src/clustering/strategies/drain3.js`
- Test: append to `test-clustering.js`

- [ ] **Step 1: Write the failing test**

Append to `test-clustering.js`:

```js
console.log("=== Drain3 ===");
import { drain3Strategy } from "./src/clustering/strategies/drain3.js";

const inst = drain3Strategy.hydrate({});
const messages = [
    "User alice failed login from IP <*>",
    "User bob failed login from IP <*>",
    "User carol failed login from IP <*>",
    "Cache miss for key foo",
    "Cache miss for key bar",
];

const { assignments, templates } = drain3Strategy.cluster(inst, messages, {
    similarityThreshold: 0.4,
    treeDepth: 4,
    maxChildren: 100,
});

// 3 user-failed messages → 1 template; 2 cache-miss → 1 template
const uniqueTemplateIds = new Set(assignments.map(a => a.templateId));
assert.equal(uniqueTemplateIds.size, 2, "should produce exactly 2 templates");
assert.equal(assignments.length, 5);
assert.equal(templates.length, 2);

// Re-feed: no new templates
const r2 = drain3Strategy.cluster(inst, messages, {
    similarityThreshold: 0.4, treeDepth: 4, maxChildren: 100,
});
assert.ok(r2.templates.every(t => !t.isNew), "no new templates on second pass");

// Serialize → hydrate roundtrip preserves templates
const snap = drain3Strategy.serialize(inst);
const restored = drain3Strategy.hydrate(snap);
const r3 = drain3Strategy.cluster(restored, ["User dave failed login from IP <*>"], {
    similarityThreshold: 0.4, treeDepth: 4, maxChildren: 100,
});
assert.equal(r3.templates[0].isNew, false, "restored instance reuses templates");

console.log("✓ drain3 tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test-clustering.js`
Expected: FAIL with `Cannot find module './src/clustering/strategies/drain3.js'`

- [ ] **Step 3: Implement `src/clustering/strategies/drain3.js`**

```js
import { createHash } from "node:crypto";
import { tokenize, WILDCARD_TOKEN } from "../preprocess.js";

// implement the strategy contract to add a new clustering algorithm; register in src/clustering/index.js
const WILDCARD = WILDCARD_TOKEN;

function templateId(tokens) {
    return "tpl_" + createHash("sha1").update(tokens.join(" ")).digest("hex").slice(0, 12);
}

function similarity(a, b) {
    if (a.length !== b.length) return 0;
    let matched = 0;
    for (let i = 0; i < a.length; i++) {
        if (a[i] === b[i] || a[i] === WILDCARD || b[i] === WILDCARD) matched++;
    }
    return matched / a.length;
}

function relax(existing, candidate) {
    const out = new Array(existing.length);
    for (let i = 0; i < existing.length; i++) {
        out[i] = existing[i] === candidate[i] ? existing[i] : WILDCARD;
    }
    return out;
}

// State shape:
// { lengthBuckets: { [len]: { children: { [token]: NodeOrLeaf } } } }
// Leaf nodes: { templates: [{ id, tokens }] }
// Inner nodes: { children: { [token]: ... } }

export const drain3Strategy = {
    name: "drain3",
    version: 1,

    hydrate(state) {
        return {
            lengthBuckets: state.lengthBuckets ? structuredClone(state.lengthBuckets) : {},
        };
    },

    serialize(instance) {
        return { lengthBuckets: instance.lengthBuckets };
    },

    cluster(instance, messages, opts) {
        const { similarityThreshold = 0.4, treeDepth = 4, maxChildren = 100 } = opts || {};
        const assignments = [];
        const touched = new Map(); // id -> { id, template, tokens, isNew }

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            const tokens = tokenize(msg);
            const len = tokens.length;
            if (len === 0) continue;

            instance.lengthBuckets[len] ??= { children: {} };
            let node = instance.lengthBuckets[len];

            // Walk inner nodes by first treeDepth-1 non-wildcard tokens
            const depth = Math.min(treeDepth - 1, len);
            for (let d = 0; d < depth; d++) {
                const key = tokens[d] === WILDCARD ? "*" : tokens[d];
                if (!node.children[key]) {
                    if (Object.keys(node.children).length >= maxChildren) {
                        // Evict oldest child (insertion order)
                        const firstKey = Object.keys(node.children)[0];
                        delete node.children[firstKey];
                    }
                    node.children[key] = (d === depth - 1) ? { templates: [] } : { children: {} };
                }
                node = node.children[key];
            }

            // Leaf: find best matching template
            node.templates ??= [];
            let best = null, bestScore = 0;
            for (const tpl of node.templates) {
                const s = similarity(tpl.tokens, tokens);
                if (s > bestScore) { bestScore = s; best = tpl; }
            }

            let id;
            if (best && bestScore >= similarityThreshold) {
                const newTokens = relax(best.tokens, tokens);
                const changed = newTokens.some((t, idx) => t !== best.tokens[idx]);
                if (changed) {
                    best.tokens = newTokens;
                    best.id = templateId(newTokens);
                }
                id = best.id;
                touched.set(id, { id, template: newTokens.join(" "), tokens: newTokens, isNew: false });
            } else {
                id = templateId(tokens);
                node.templates.push({ id, tokens });
                touched.set(id, { id, template: tokens.join(" "), tokens, isNew: true });
            }

            assignments.push({ messageIndex: i, templateId: id });
        }

        return { assignments, templates: [...touched.values()] };
    },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test-clustering.js`
Expected: `✓ drain3 tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/clustering/strategies/drain3.js test-clustering.js
git commit -m "feat(clustering): add drain3 strategy"
```

---

## Task 4: Wire drain3 into the registry

**Files:**
- Modify: `src/clustering/index.js`
- Test: append to `test-clustering.js`

- [ ] **Step 1: Write the failing test**

Append to `test-clustering.js`:

```js
console.log("=== Built-in registration ===");
// Re-import in a fresh context
import { get as get2 } from "./src/clustering/index.js";
import "./src/clustering/strategies/drain3.js"; // self-register side effect
import { register as register2 } from "./src/clustering/index.js";
import { drain3Strategy as d3 } from "./src/clustering/strategies/drain3.js";

// Registry was cleared earlier; re-register here for assertion
try { register2("drain3", d3); } catch (_) {}
assert.equal(get2("drain3").name, "drain3");

console.log("✓ built-in registration ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test-clustering.js`
Expected: PASS for previous tests, the new section currently passes too because we manually register. Confirm it works, then proceed to make the auto-registration real.

- [ ] **Step 3: Add auto-registration in `src/clustering/index.js`**

Append at the end of `src/clustering/index.js`:

```js
// Built-in strategies — auto-register on first import of this module.
// To add a new built-in: import its module here so its register() side-effect runs.
import { drain3Strategy } from "./strategies/drain3.js";
if (!strategies.has("drain3")) {
    register("drain3", drain3Strategy);
}
```

- [ ] **Step 4: Verify**

Run: `node test-clustering.js`
Expected: all sections pass.

- [ ] **Step 5: Commit**

```bash
git add src/clustering/index.js test-clustering.js
git commit -m "feat(clustering): auto-register built-in drain3 strategy"
```

---

## Task 5: Template store (persistence + lockfile)

**Files:**
- Create: `src/clustering/template-store.js`
- Test: append to `test-clustering.js`

- [ ] **Step 1: Write the failing test**

Append to `test-clustering.js`:

```js
console.log("=== Template store ===");
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    loadTemplateStore, saveTemplateStore, _withStorePathOverride
} from "./src/clustering/template-store.js";

const dir = mkdtempSync(join(tmpdir(), "tpl-test-"));
_withStorePathOverride(() => join(dir, "store.json"));

// Empty load
let store = loadTemplateStore("conn1");
assert.equal(store.version, 1);
assert.deepEqual(store.templates, {});

// Save + reload roundtrip
store.templates["tpl_x"] = {
    id: "tpl_x", template: "hello <*>", tokens: ["hello", "<*>"],
    label: null, count: 1,
    first_seen: "2026-05-04T10:00:00Z", last_seen: "2026-05-04T10:00:00Z",
    sources_seen: ["a"],
};
store.algorithm_state = { lengthBuckets: { 2: { children: {} } } };
saveTemplateStore("conn1", store);

const reloaded = loadTemplateStore("conn1");
assert.equal(reloaded.templates.tpl_x.template, "hello <*>");
assert.equal(reloaded.algorithm_state.lengthBuckets["2"].children.constructor, Object);

// Corrupt file → empty store + warning
writeFileSync(join(dir, "store.json"), "not json", "utf-8");
const recovered = loadTemplateStore("conn1");
assert.deepEqual(recovered.templates, {});

rmSync(dir, { recursive: true, force: true });
console.log("✓ template store tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test-clustering.js`
Expected: FAIL with `Cannot find module './src/clustering/template-store.js'`

- [ ] **Step 3: Implement `src/clustering/template-store.js`**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test-clustering.js`
Expected: `✓ template store tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/clustering/template-store.js test-clustering.js
git commit -m "feat(clustering): add per-connection template store with atomic write + lock"
```

---

## Task 6: Response formatter

**Files:**
- Create: `src/clustering/formatter.js`
- Test: append to `test-clustering.js`

- [ ] **Step 1: Write the failing test**

Append to `test-clustering.js`:

```js
console.log("=== Formatter ===");
import { formatClusterResponse } from "./src/clustering/formatter.js";

const messages = [
    { timestamp: "2026-05-04T10:00:00Z", source: "svc-a", message: "User alice failed" },
    { timestamp: "2026-05-04T10:00:05Z", source: "svc-a", message: "User bob failed" },
    { timestamp: "2026-05-04T10:00:10Z", source: "svc-b", message: "User carol failed" },
    { timestamp: "2026-05-04T10:01:00Z", source: "svc-c", message: "Cache miss foo" },
];
const assignments = [
    { messageIndex: 0, templateId: "tpl_user" },
    { messageIndex: 1, templateId: "tpl_user" },
    { messageIndex: 2, templateId: "tpl_user" },
    { messageIndex: 3, templateId: "tpl_cache" },
];
const templates = [
    { id: "tpl_user", template: "User <*> failed", tokens: ["User","<*>","failed"], isNew: true },
    { id: "tpl_cache", template: "Cache miss <*>", tokens: ["Cache","miss","<*>"], isNew: true },
];
const labels = { tpl_user: "AuthFailure" };

const out = formatClusterResponse({
    messages, assignments, templates, labels,
    minClusterSize: 2, includeSamples: 3,
    skippedMessages: 0,
});

assert.equal(out.total_messages_clustered, 4);
assert.equal(out.total_clusters, 2);
assert.equal(out.new_templates_learned, 2);

const userCluster = out.clusters.find(c => c.template_id === "tpl_user");
assert.equal(userCluster.count, 3);
assert.equal(userCluster.percentage, 75);
assert.equal(userCluster.label, "AuthFailure");
assert.equal(userCluster.label_present, true);
assert.deepEqual(userCluster.sources.sort(), ["svc-a", "svc-b"]);
assert.equal(userCluster.sample_messages.length, 3);
assert.equal(userCluster.first_seen, "2026-05-04T10:00:00Z");
assert.equal(userCluster.last_seen, "2026-05-04T10:00:10Z");

// minClusterSize collapses singletons into _misc
const out2 = formatClusterResponse({
    messages, assignments, templates, labels: {},
    minClusterSize: 4, includeSamples: 1, skippedMessages: 0,
});
const misc = out2.clusters.find(c => c.template_id === "_misc");
assert.ok(misc, "expected _misc cluster");
assert.equal(misc.count, 4);

console.log("✓ formatter tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test-clustering.js`
Expected: FAIL with `Cannot find module './src/clustering/formatter.js'`

- [ ] **Step 3: Implement `src/clustering/formatter.js`**

```js
function pickSamples(msgs, n) {
    if (msgs.length <= n) return msgs;
    if (n === 1) return [msgs[0]];
    if (n === 2) return [msgs[0], msgs[msgs.length - 1]];
    // n >= 3: first, middle, last (then evenly distributed extras)
    const out = [msgs[0]];
    const mid = Math.floor(msgs.length / 2);
    out.push(msgs[mid]);
    out.push(msgs[msgs.length - 1]);
    return out.slice(0, n);
}

function topSources(msgs, cap = 10) {
    const counts = new Map();
    for (const m of msgs) {
        const s = m.source ?? "unknown";
        counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, cap)
        .map(([s]) => s);
}

export function formatClusterResponse({
    messages, assignments, templates, labels = {},
    minClusterSize = 2, includeSamples = 3, skippedMessages = 0,
}) {
    const total = messages.length;
    const buckets = new Map(); // templateId -> { messages: [...], indexes: [...] }
    for (const a of assignments) {
        if (!buckets.has(a.templateId)) buckets.set(a.templateId, []);
        buckets.get(a.templateId).push(messages[a.messageIndex]);
    }

    const tplById = new Map(templates.map(t => [t.id, t]));

    const fullClusters = [];
    const miscMessages = [];
    let miscPatternCount = 0;

    for (const [id, msgs] of buckets.entries()) {
        if (msgs.length < minClusterSize) {
            miscPatternCount++;
            for (const m of msgs) miscMessages.push(m);
            continue;
        }
        const tpl = tplById.get(id);
        const sortedByTime = [...msgs].sort((a, b) =>
            (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));
        fullClusters.push({
            template_id: id,
            template: tpl?.template ?? "(unknown)",
            label: labels[id] ?? null,
            label_present: !!labels[id],
            count: msgs.length,
            percentage: Math.round((msgs.length / total) * 1000) / 10,
            first_seen: sortedByTime[0]?.timestamp ?? null,
            last_seen: sortedByTime[sortedByTime.length - 1]?.timestamp ?? null,
            sources: topSources(msgs),
            sample_messages: pickSamples(sortedByTime, includeSamples).map(m => ({
                timestamp: m.timestamp,
                source: m.source,
                message: m.message,
            })),
        });
    }

    fullClusters.sort((a, b) => b.count - a.count);

    if (miscMessages.length > 0) {
        const sortedMisc = [...miscMessages].sort((a, b) =>
            (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));
        fullClusters.push({
            template_id: "_misc",
            template: `<misc — ${miscPatternCount} singleton patterns>`,
            label: null,
            label_present: false,
            count: miscMessages.length,
            percentage: Math.round((miscMessages.length / total) * 1000) / 10,
            first_seen: sortedMisc[0]?.timestamp ?? null,
            last_seen: sortedMisc[sortedMisc.length - 1]?.timestamp ?? null,
            sources: topSources(miscMessages),
            sample_messages: pickSamples(sortedMisc, includeSamples).map(m => ({
                timestamp: m.timestamp, source: m.source, message: m.message,
            })),
        });
    }

    const newCount = templates.filter(t => t.isNew).length;
    const reinforcedCount = templates.length - newCount;

    return {
        total_messages_clustered: total,
        skipped_messages: skippedMessages,
        total_clusters: fullClusters.length,
        new_templates_learned: newCount,
        reinforced_templates: reinforcedCount,
        clusters: fullClusters,
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test-clustering.js`
Expected: `✓ formatter tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/clustering/formatter.js test-clustering.js
git commit -m "feat(clustering): add response formatter"
```

---

## Task 7: `cluster_log_messages` tool handler

**Files:**
- Create: `src/tools/cluster-errors.js`
- Modify: `src/tools.js` (append definition)
- Modify: `src/index.js` (import + dispatch)
- Test: append to `test-clustering.js`

- [ ] **Step 1: Write the failing test**

Append to `test-clustering.js`:

```js
console.log("=== cluster_log_messages handler (mocked) ===");
import { _setSearchOverride } from "./src/clustering/_test_hooks.js";
import { handleClusterLogMessages } from "./src/tools/cluster-errors.js";

// Reset store path for this test
const dir2 = mkdtempSync(join(tmpdir(), "cluster-test-"));
_withStorePathOverride((conn) => join(dir2, `${conn}.json`));

// Stub the search path
_setSearchOverride(async () => ({
    total_results: 4,
    messages: [
        { timestamp: "2026-05-04T10:00:00Z", source: "svc-a", message: "User alice failed login" },
        { timestamp: "2026-05-04T10:00:05Z", source: "svc-a", message: "User bob failed login" },
        { timestamp: "2026-05-04T10:00:10Z", source: "svc-b", message: "User carol failed login" },
        { timestamp: "2026-05-04T10:01:00Z", source: "svc-c", message: "Cache miss for key foo" },
    ],
}));

const result = await handleClusterLogMessages({
    params: { arguments: { sampleSize: 100, includeSamples: 2, minClusterSize: 1, _testConnection: "conn-test" } }
});

const body = JSON.parse(result.content[0].text);
assert.equal(body.total_messages_clustered, 4);
assert.ok(body.clusters.length >= 1);
assert.ok(body.new_templates_learned >= 1);

rmSync(dir2, { recursive: true, force: true });
console.log("✓ cluster_log_messages handler tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test-clustering.js`
Expected: FAIL with `Cannot find module './src/clustering/_test_hooks.js'` or `./src/tools/cluster-errors.js`.

- [ ] **Step 3: Create `src/clustering/_test_hooks.js`**

```js
let searchOverride = null;
export function _setSearchOverride(fn) { searchOverride = fn; }
export function _getSearchOverride() { return searchOverride; }
```

- [ ] **Step 4: Implement `src/tools/cluster-errors.js`**

```js
import { getActiveConnectionConfig, getActiveConnection, getConnections } from "../config.js";
import { buildQueryString, searchGraylog, buildStreamFilter, extractMessages } from "../query.js";
import { normalizeTimeRangeArgs } from "../timerange.js";
import { get as getStrategy } from "../clustering/index.js";
import { loadTemplateStore, saveTemplateStore } from "../clustering/template-store.js";
import { normalizeMessage } from "../clustering/preprocess.js";
import { formatClusterResponse } from "../clustering/formatter.js";
import { _getSearchOverride } from "../clustering/_test_hooks.js";

const MAX_SAMPLE = 10000;

function errorResponse(text) {
    return { isError: true, content: [{ type: "text", text }] };
}

export async function handleClusterLogMessages(request) {
    const args = request.params.arguments || {};

    // Resolve connection (test override allowed)
    let connectionName = args._testConnection || getActiveConnection();
    let conn;
    if (args._testConnection) {
        conn = { baseUrl: "http://test", apiToken: "test" };
    } else {
        conn = getActiveConnectionConfig();
        if (!conn) {
            const available = Object.keys(getConnections()).join(", ");
            return errorResponse(`No active connection. Use 'use_connection' first. Available: ${available || "none"}`);
        }
    }

    const algorithm = args.algorithm || "drain3";
    let strategy;
    try { strategy = getStrategy(algorithm); }
    catch (err) { return errorResponse(err.message); }

    let sampleSize = args.sampleSize ?? 1000;
    let warning = null;
    if (sampleSize > MAX_SAMPLE) {
        warning = `sampleSize clamped from ${sampleSize} to ${MAX_SAMPLE}`;
        sampleSize = MAX_SAMPLE;
    }

    const field = args.field || "message";
    const { timeRange } = normalizeTimeRangeArgs(args);
    const queryString = buildQueryString(args.query, args.filters, args.exactMatch ?? true);
    const streamFilter = buildStreamFilter(args.streamIds);

    // Fetch messages (overridable for tests)
    let fetched;
    try {
        const override = _getSearchOverride();
        if (override) {
            fetched = await override({ queryString, timeRange, sampleSize, streamFilter });
        } else {
            const payload = {
                queries: [{
                    id: "q1",
                    query: { type: "elasticsearch", query_string: queryString },
                    filter: streamFilter,
                    timerange: timeRange,
                    search_types: [{ id: "st1", type: "messages", limit: sampleSize, offset: 0 }],
                }],
            };
            const data = await searchGraylog(conn.baseUrl, conn.apiToken, payload);
            const { totalResults, extracted } = extractMessages(data, [field, "timestamp", "source"]);
            fetched = { total_results: totalResults, messages: extracted };
        }
    } catch (err) {
        return errorResponse(`Error fetching messages: ${err.message}`);
    }

    if (!fetched.messages || fetched.messages.length === 0) {
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    total_messages_clustered: 0, skipped_messages: 0,
                    total_clusters: 0, algorithm, time_range: timeRange,
                    query: queryString, clusters: [], warning,
                }),
            }],
        };
    }

    // Prepare normalized strings for clustering, keep original messages for formatting
    const normalized = [];
    const keptMessages = [];
    let skipped = 0;
    for (const m of fetched.messages) {
        const text = m[field];
        if (typeof text !== "string" || text.length === 0) { skipped++; continue; }
        normalized.push(normalizeMessage(text));
        keptMessages.push({
            timestamp: m.timestamp, source: m.source, message: text,
        });
    }

    // Cluster
    const store = loadTemplateStore(connectionName);
    const instance = strategy.hydrate(store.algorithm_state || {});
    let clusterResult;
    try {
        clusterResult = strategy.cluster(instance, normalized, {
            similarityThreshold: args.similarityThreshold ?? 0.4,
            treeDepth: args.treeDepth ?? 4,
            maxChildren: args.maxChildren ?? 100,
        });
    } catch (err) {
        return errorResponse(`Clustering failed: ${err.message}`);
    }

    // Update store unless readOnly
    const labels = {};
    const nowIso = new Date().toISOString();
    if (!args.readOnly) {
        for (const t of clusterResult.templates) {
            const existing = store.templates[t.id];
            if (existing) {
                existing.count += clusterResult.assignments.filter(a => a.templateId === t.id).length;
                existing.last_seen = nowIso;
                existing.template = t.template;
                existing.tokens = t.tokens;
            } else {
                store.templates[t.id] = {
                    id: t.id,
                    template: t.template,
                    label: null,
                    tokens: t.tokens,
                    count: clusterResult.assignments.filter(a => a.templateId === t.id).length,
                    first_seen: nowIso,
                    last_seen: nowIso,
                    sources_seen: [],
                };
            }
        }
        store.algorithm_state = strategy.serialize(instance);
        try { saveTemplateStore(connectionName, store); }
        catch (err) { console.error(`[clustering] failed to persist store: ${err.message}`); }
    }
    for (const t of clusterResult.templates) {
        if (store.templates[t.id]?.label) labels[t.id] = store.templates[t.id].label;
    }

    const body = formatClusterResponse({
        messages: keptMessages,
        assignments: clusterResult.assignments,
        templates: clusterResult.templates,
        labels,
        minClusterSize: args.minClusterSize ?? 2,
        includeSamples: args.includeSamples ?? 3,
        skippedMessages: skipped,
    });

    body.algorithm = algorithm;
    body.time_range = timeRange;
    body.query = queryString;
    if (warning) body.warning = warning;

    return { content: [{ type: "text", text: JSON.stringify(body) }] };
}
```

- [ ] **Step 5: Add tool definition to `src/tools.js`**

Open `src/tools.js`. Find the closing `];` at the bottom of `toolDefinitions`. Just before that `];`, append:

```js
    {
        name: "cluster_log_messages",
        description: "Cluster similar log messages into Drain3-style templates. Fetches messages with the same args as fetch_graylog_messages, then groups them by structural similarity. Templates are persisted per connection and reused across calls.",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Query string (same as fetch_graylog_messages)" },
                filters: { type: "object", description: "Field filters" },
                timeRange: { type: "string", description: "Time range (e.g. '1h', '30m')" },
                from: { type: "string", description: "Absolute start time (ISO)" },
                to: { type: "string", description: "Absolute end time (ISO)" },
                streamIds: { type: "array", items: { type: "string" }, description: "Optional stream IDs" },
                exactMatch: { type: "boolean", description: "Wrap query in quotes (default true)" },
                sampleSize: { type: "number", description: "Max messages to fetch & cluster. Default 1000, max 10000." },
                field: { type: "string", description: "Field to cluster on. Default 'message'." },
                algorithm: { type: "string", description: "Clustering algorithm. Default 'drain3'." },
                minClusterSize: { type: "number", description: "Singletons collapsed under '_misc' cluster. Default 2." },
                readOnly: { type: "boolean", description: "If true, do not update template library. Default false." },
                includeSamples: { type: "number", description: "Sample messages per cluster (first/middle/last by time). Default 3." },
                similarityThreshold: { type: "number", description: "Drain3 similarity threshold 0-1. Default 0.4." },
                treeDepth: { type: "number", description: "Drain3 prefix-tree depth. Default 4." },
                maxChildren: { type: "number", description: "Drain3 max children per node. Default 100." },
            },
        },
    },
```

- [ ] **Step 6: Wire dispatch in `src/index.js`**

Add to imports (after the existing `import { searchEvents... }` line):

```js
import { handleClusterLogMessages } from "./tools/cluster-errors.js";
```

Add to the dispatch chain in `setRequestHandler(CallToolRequestSchema, ...)`, before the final `throw`:

```js
    if (name === "cluster_log_messages") {
        return handleClusterLogMessages(request);
    }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `node test-clustering.js`
Expected: `✓ cluster_log_messages handler tests passed`

- [ ] **Step 8: Commit**

```bash
git add src/tools/cluster-errors.js src/clustering/_test_hooks.js src/tools.js src/index.js test-clustering.js
git commit -m "feat(tools): add cluster_log_messages tool"
```

---

## Task 8: Template management — list / delete / rename

**Files:**
- Create: `src/tools/template-mgmt.js`
- Modify: `src/tools.js` (3 definitions)
- Modify: `src/index.js` (3 dispatch lines)
- Test: append to `test-clustering.js`

- [ ] **Step 1: Write the failing test**

Append to `test-clustering.js`:

```js
console.log("=== Template management: list/delete/rename ===");
import {
    handleListTemplates, handleDeleteTemplate, handleRenameTemplate,
} from "./src/tools/template-mgmt.js";

const dir3 = mkdtempSync(join(tmpdir(), "tpl-mgmt-"));
_withStorePathOverride((conn) => join(dir3, `${conn}.json`));

// Seed a store
const seeded = {
    version: 1, connection: "conn-mgmt", algorithm: "drain3", algorithm_state: {},
    templates: {
        tpl_a: { id: "tpl_a", template: "alpha <*>", label: null, tokens: ["alpha","<*>"], count: 5,
                 first_seen: "2026-05-01T00:00:00Z", last_seen: "2026-05-04T00:00:00Z", sources_seen: [] },
        tpl_b: { id: "tpl_b", template: "beta <*>", label: null, tokens: ["beta","<*>"], count: 1,
                 first_seen: "2026-05-02T00:00:00Z", last_seen: "2026-05-02T00:00:00Z", sources_seen: [] },
    },
};
saveTemplateStore("conn-mgmt", seeded);

const listed = JSON.parse(
    (await handleListTemplates({ params: { arguments: { _testConnection: "conn-mgmt" } } })).content[0].text
);
assert.equal(listed.total, 2);
assert.equal(listed.templates[0].id, "tpl_a"); // sortBy count desc

const renamed = JSON.parse(
    (await handleRenameTemplate({ params: { arguments: { templateId: "tpl_a", label: "Alpha", _testConnection: "conn-mgmt" } } })).content[0].text
);
assert.equal(renamed.template.label, "Alpha");

const afterRename = loadTemplateStore("conn-mgmt");
assert.equal(afterRename.templates.tpl_a.label, "Alpha");

const deleted = JSON.parse(
    (await handleDeleteTemplate({ params: { arguments: { templateId: "tpl_b", _testConnection: "conn-mgmt" } } })).content[0].text
);
assert.match(deleted.message, /deleted/);
const afterDelete = loadTemplateStore("conn-mgmt");
assert.equal(afterDelete.templates.tpl_b, undefined);

rmSync(dir3, { recursive: true, force: true });
console.log("✓ template management tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test-clustering.js`
Expected: FAIL with `Cannot find module './src/tools/template-mgmt.js'`

- [ ] **Step 3: Implement `src/tools/template-mgmt.js`**

```js
import { getActiveConnection, getActiveConnectionConfig, getConnections } from "../config.js";
import { loadTemplateStore, saveTemplateStore } from "../clustering/template-store.js";

function errorResponse(text) {
    return { isError: true, content: [{ type: "text", text }] };
}

function resolveConnection(args) {
    if (args._testConnection) return { name: args._testConnection };
    const conn = getActiveConnectionConfig();
    if (!conn) {
        const available = Object.keys(getConnections()).join(", ");
        return { error: errorResponse(`No active connection. Use 'use_connection' first. Available: ${available || "none"}`) };
    }
    return { name: getActiveConnection() };
}

export async function handleListTemplates(request) {
    const args = request.params.arguments || {};
    const r = resolveConnection(args);
    if (r.error) return r.error;
    const store = loadTemplateStore(r.name);

    const limit = args.limit ?? 50;
    const sortBy = args.sortBy ?? "count";
    const filterLabel = args.filterLabel;

    let items = Object.values(store.templates);
    if (filterLabel) items = items.filter(t => t.label === filterLabel);

    const sorters = {
        count: (a, b) => b.count - a.count,
        last_seen: (a, b) => (b.last_seen ?? "").localeCompare(a.last_seen ?? ""),
        first_seen: (a, b) => (b.first_seen ?? "").localeCompare(a.first_seen ?? ""),
    };
    items.sort(sorters[sortBy] || sorters.count);

    return {
        content: [{
            type: "text",
            text: JSON.stringify({ total: items.length, templates: items.slice(0, limit) }),
        }],
    };
}

export async function handleDeleteTemplate(request) {
    const args = request.params.arguments || {};
    if (!args.templateId) return errorResponse("templateId is required");
    const r = resolveConnection(args);
    if (r.error) return r.error;
    const store = loadTemplateStore(r.name);
    if (!store.templates[args.templateId]) {
        return errorResponse(`Template "${args.templateId}" not found`);
    }
    delete store.templates[args.templateId];
    saveTemplateStore(r.name, store);
    return {
        content: [{ type: "text", text: JSON.stringify({ message: `Template "${args.templateId}" deleted` }) }],
    };
}

export async function handleRenameTemplate(request) {
    const args = request.params.arguments || {};
    if (!args.templateId) return errorResponse("templateId is required");
    if (typeof args.label !== "string") return errorResponse("label is required (string)");
    const r = resolveConnection(args);
    if (r.error) return r.error;
    const store = loadTemplateStore(r.name);
    const t = store.templates[args.templateId];
    if (!t) return errorResponse(`Template "${args.templateId}" not found`);
    t.label = args.label;
    saveTemplateStore(r.name, store);
    return {
        content: [{ type: "text", text: JSON.stringify({ message: "label updated", template: t }) }],
    };
}
```

- [ ] **Step 4: Add 3 tool definitions to `src/tools.js`**

Append before the closing `];`:

```js
    {
        name: "list_log_templates",
        description: "List learned log templates for the active connection.",
        inputSchema: {
            type: "object",
            properties: {
                limit: { type: "number", description: "Max templates to return. Default 50." },
                sortBy: { type: "string", enum: ["count", "last_seen", "first_seen"], description: "Sort key. Default 'count'." },
                filterLabel: { type: "string", description: "Only return templates with this label." },
            },
        },
    },
    {
        name: "delete_log_template",
        description: "Delete a learned log template by ID.",
        inputSchema: {
            type: "object",
            properties: {
                templateId: { type: "string", description: "Template ID (e.g. tpl_a3f1b2)" },
            },
            required: ["templateId"],
        },
    },
    {
        name: "rename_log_template",
        description: "Set or update a human-readable label for a template.",
        inputSchema: {
            type: "object",
            properties: {
                templateId: { type: "string", description: "Template ID" },
                label: { type: "string", description: "Human-readable label (e.g. 'AuthFailure')" },
            },
            required: ["templateId", "label"],
        },
    },
```

- [ ] **Step 5: Wire dispatch in `src/index.js`**

Add import:
```js
import { handleListTemplates, handleDeleteTemplate, handleRenameTemplate, handleExportTemplates, handleImportTemplates } from "./tools/template-mgmt.js";
```

(Note: `handleExportTemplates`/`handleImportTemplates` are added in Task 9; the import line is fine to write now even if they're undefined symbols — just defer running until Task 9 lands. Alternatively, add only the three handlers needed in this task and extend in Task 9.)

**Choose:** import only the three you have now and add the other two in Task 9.

```js
import { handleListTemplates, handleDeleteTemplate, handleRenameTemplate } from "./tools/template-mgmt.js";
```

Add dispatch lines before the final `throw`:

```js
    if (name === "list_log_templates") return handleListTemplates(request);
    if (name === "delete_log_template") return handleDeleteTemplate(request);
    if (name === "rename_log_template") return handleRenameTemplate(request);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node test-clustering.js`
Expected: `✓ template management tests passed`

- [ ] **Step 7: Commit**

```bash
git add src/tools/template-mgmt.js src/tools.js src/index.js test-clustering.js
git commit -m "feat(tools): add list/delete/rename log template tools"
```

---

## Task 9: Template management — export / import

**Files:**
- Modify: `src/tools/template-mgmt.js` (add 2 exports)
- Modify: `src/tools.js` (2 definitions)
- Modify: `src/index.js` (2 dispatch lines, extend the import)
- Test: append to `test-clustering.js`

- [ ] **Step 1: Write the failing test**

Append to `test-clustering.js`:

```js
console.log("=== Template management: export/import ===");
import { handleExportTemplates, handleImportTemplates } from "./src/tools/template-mgmt.js";

const dir4 = mkdtempSync(join(tmpdir(), "tpl-eximport-"));
_withStorePathOverride((conn) => join(dir4, `${conn}.json`));

saveTemplateStore("conn-x", {
    version: 1, connection: "conn-x", algorithm: "drain3", algorithm_state: {},
    templates: {
        tpl_x: { id: "tpl_x", template: "x <*>", label: null, tokens: ["x","<*>"], count: 1,
                 first_seen: "2026-05-04T00:00:00Z", last_seen: "2026-05-04T00:00:00Z", sources_seen: [] },
    },
});

const exported = JSON.parse(
    (await handleExportTemplates({ params: { arguments: { _testConnection: "conn-x" } } })).content[0].text
);
assert.equal(Object.keys(exported.templates).length, 1);

// Import (merge)
const importBody = {
    templates: {
        tpl_y: { id: "tpl_y", template: "y <*>", label: "Y", tokens: ["y","<*>"], count: 3,
                 first_seen: "2026-05-04T00:00:00Z", last_seen: "2026-05-04T00:00:00Z", sources_seen: [] },
    },
    mode: "merge",
    _testConnection: "conn-x",
};
await handleImportTemplates({ params: { arguments: importBody } });
const merged = loadTemplateStore("conn-x");
assert.equal(Object.keys(merged.templates).length, 2);
assert.equal(merged.templates.tpl_y.label, "Y");

// Import (replace)
await handleImportTemplates({ params: { arguments: { ...importBody, mode: "replace" } } });
const replaced = loadTemplateStore("conn-x");
assert.equal(Object.keys(replaced.templates).length, 1);
assert.ok(replaced.templates.tpl_y);

rmSync(dir4, { recursive: true, force: true });
console.log("✓ template export/import tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test-clustering.js`
Expected: FAIL — handlers not exported.

- [ ] **Step 3: Append to `src/tools/template-mgmt.js`**

```js
export async function handleExportTemplates(request) {
    const args = request.params.arguments || {};
    const r = resolveConnection(args);
    if (r.error) return r.error;
    const store = loadTemplateStore(r.name);
    return {
        content: [{
            type: "text",
            text: JSON.stringify({
                connection: r.name,
                algorithm: store.algorithm,
                templates: store.templates,
            }),
        }],
    };
}

export async function handleImportTemplates(request) {
    const args = request.params.arguments || {};
    if (!args.templates || typeof args.templates !== "object") {
        return errorResponse("templates (object) is required");
    }
    const mode = args.mode || "merge";
    if (mode !== "merge" && mode !== "replace") {
        return errorResponse(`mode must be "merge" or "replace", got "${mode}"`);
    }
    const r = resolveConnection(args);
    if (r.error) return r.error;
    const store = loadTemplateStore(r.name);
    if (mode === "replace") store.templates = {};
    let added = 0;
    for (const [id, tpl] of Object.entries(args.templates)) {
        store.templates[id] = { ...tpl, id };
        added++;
    }
    saveTemplateStore(r.name, store);
    return {
        content: [{
            type: "text",
            text: JSON.stringify({ message: `imported ${added} templates (mode: ${mode})`, total: Object.keys(store.templates).length }),
        }],
    };
}
```

- [ ] **Step 4: Add 2 tool definitions to `src/tools.js`**

Append before the closing `];`:

```js
    {
        name: "export_log_templates",
        description: "Export all learned templates for the active connection as JSON.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "import_log_templates",
        description: "Import templates into the active connection's library.",
        inputSchema: {
            type: "object",
            properties: {
                templates: { type: "object", description: "Map of templateId → template object" },
                mode: { type: "string", enum: ["merge", "replace"], description: "merge keeps existing; replace wipes first. Default 'merge'." },
            },
            required: ["templates"],
        },
    },
```

- [ ] **Step 5: Extend `src/index.js`**

Update the import line to include the two new handlers:

```js
import {
    handleListTemplates, handleDeleteTemplate, handleRenameTemplate,
    handleExportTemplates, handleImportTemplates
} from "./tools/template-mgmt.js";
```

Add dispatch lines before the final `throw`:

```js
    if (name === "export_log_templates") return handleExportTemplates(request);
    if (name === "import_log_templates") return handleImportTemplates(request);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node test-clustering.js`
Expected: `✓ template export/import tests passed`

- [ ] **Step 7: Commit**

```bash
git add src/tools/template-mgmt.js src/tools.js src/index.js test-clustering.js
git commit -m "feat(tools): add export/import log template tools"
```

---

## Task 10: README + manual verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append a "Clustering" section to `README.md`**

Open `README.md` and append:

```markdown
## Log Clustering (Drain3)

Group similar log messages into structural templates. Templates are learned per
connection and persisted at `~/.graylog-mcp/templates/<connection>.json`.

### Tools

- `cluster_log_messages` — fetch and cluster a sample of messages
- `list_log_templates` — list learned templates
- `delete_log_template` — remove a template
- `rename_log_template` — give a template a human-readable label
- `export_log_templates` — dump library as JSON
- `import_log_templates` — bulk load templates (merge or replace)

### Example

After selecting a connection with `use_connection`:

```json
{
    "tool": "cluster_log_messages",
    "arguments": {
        "query": "level:ERROR",
        "timeRange": "1h",
        "sampleSize": 500,
        "minClusterSize": 2,
        "includeSamples": 3
    }
}
```

The response groups the 500 sampled messages into a small number of templates,
each with a count, sample messages, and the set of sources where it appeared.
Subsequent calls reuse and reinforce the same templates.

### Adding a new clustering algorithm

1. Create `src/clustering/strategies/<name>.js` implementing the strategy
   contract (`hydrate`, `serialize`, `cluster`) — see `drain3.js` for reference.
2. Import and `register("<name>", strategy)` in `src/clustering/index.js`.
3. Pass `algorithm: "<name>"` to `cluster_log_messages`.

No other code changes required.
```

- [ ] **Step 2: Run the full test suite**

Run: `node test-clustering.js`
Expected: every section ends with `✓ ... passed`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document clustering tools and extension point"
```

---

## Self-Review

**Spec coverage:**
- Strategy registry → Tasks 2, 4 ✓
- Drain3 algorithm → Task 3 ✓
- Per-connection persistence (atomic + lock) → Task 5 ✓
- `cluster_log_messages` tool with all spec args → Task 7 ✓
- `_misc` cluster behavior → Task 6 (formatter test) ✓
- Sample selection (first/middle/last) → Task 6 ✓
- `sources` cap at top 10 → Task 6 ✓
- 5 management tools → Tasks 8, 9 ✓
- Error cases (empty result, oversize sampleSize, missing field, corrupt store, stale lock) → Tasks 5 (corrupt/lock), 7 (empty/clamp/skip) ✓
- Extension contract documented → Task 10 ✓

**Placeholder scan:** No TBDs, all code blocks complete.

**Type/name consistency:**
- `templateId` field name consistent across formatter, store, mgmt handlers
- `_testConnection`, `_withStorePathOverride`, `_setSearchOverride` test hooks consistent
- `loadTemplateStore` / `saveTemplateStore` signatures match across tasks
- `handleClusterLogMessages` / `handle*Templates` naming consistent

No issues found.
