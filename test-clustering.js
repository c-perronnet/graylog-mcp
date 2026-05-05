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

// Restore drain3 so subsequent tests that use the registry can find it
_clearForTests();
import { drain3Strategy } from "./src/clustering/strategies/drain3.js";
register("drain3", drain3Strategy);

console.log("✓ registry tests passed");

console.log("=== Drain3 ===");

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
    maxChildren: 100,
});

// 3 user-failed messages → 1 template; 2 cache-miss → 1 template
const uniqueTemplateIds = new Set(assignments.map(a => a.templateId));
assert.equal(uniqueTemplateIds.size, 2, "should produce exactly 2 templates");
assert.equal(assignments.length, 5);
assert.equal(templates.length, 2);

// Re-feed: no new templates
const r2 = drain3Strategy.cluster(inst, messages, {
    similarityThreshold: 0.4, maxChildren: 100,
});
assert.ok(r2.templates.every(t => !t.isNew), "no new templates on second pass");

// Serialize → hydrate roundtrip preserves templates
const snap = drain3Strategy.serialize(inst);
const restored = drain3Strategy.hydrate(snap);
const r3 = drain3Strategy.cluster(restored, ["User dave failed login from IP <*>"], {
    similarityThreshold: 0.4, maxChildren: 100,
});
assert.equal(r3.templates[0].isNew, false, "restored instance reuses templates");

console.log("✓ drain3 tests passed");

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

import { formatClusterResponse } from "./src/clustering/formatter.js";

console.log("=== Formatter ===");
{
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
}

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
