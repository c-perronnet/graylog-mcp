import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import "../snapshot-config.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatClusterResponse } from "../../src/clustering/formatter.js";
import {
    loadTemplateStore, saveTemplateStore, _withStorePathOverride
} from "../../src/clustering/template-store.js";
import { _setSearchOverride } from "../../src/clustering/_test_hooks.js";
import { handleClusterLogMessages } from "../../src/tools/cluster-errors.js";
import {
    handleListTemplates, handleDeleteTemplate, handleRenameTemplate,
    handleExportTemplates, handleImportTemplates,
} from "../../src/tools/template-mgmt.js";

describe("Formatter", () => {
    test("formats clusters with labels, sources, samples, and timestamps", () => {
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
    });

    test("minClusterSize collapses singletons into _misc", () => {
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

        const out2 = formatClusterResponse({
            messages, assignments, templates, labels: {},
            minClusterSize: 4, includeSamples: 1, skippedMessages: 0,
        });
        const misc = out2.clusters.find(c => c.template_id === "_misc");
        assert.ok(misc, "expected _misc cluster");
        assert.equal(misc.count, 4);
    });
});

describe("cluster_log_messages handler (mocked)", () => {
    let dir2;

    beforeEach(() => {
        dir2 = mkdtempSync(join(tmpdir(), "cluster-test-"));
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
    });

    after(() => {
        _setSearchOverride(null);
        try { rmSync(dir2, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    });

    test("cluster_log_messages handler returns clustered body", async () => {
        const result = await handleClusterLogMessages({
            params: { arguments: { sampleSize: 100, includeSamples: 2, minClusterSize: 1, _testConnection: "conn-test" } }
        });

        const body = JSON.parse(result.content[0].text);
        assert.equal(body.total_messages_clustered, 4);
        assert.ok(body.clusters.length >= 1);
        assert.ok(body.new_templates_learned >= 1);
    });
});

describe("Template management: list/delete/rename", () => {
    let dir3;

    beforeEach(() => {
        dir3 = mkdtempSync(join(tmpdir(), "tpl-mgmt-"));
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
    });

    after(() => {
        try { rmSync(dir3, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    });

    test("list/rename/delete templates through handlers", async () => {
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
    });
});

describe("Template management: export/import", () => {
    let dir4;

    beforeEach(() => {
        dir4 = mkdtempSync(join(tmpdir(), "tpl-eximport-"));
        _withStorePathOverride((conn) => join(dir4, `${conn}.json`));

        saveTemplateStore("conn-x", {
            version: 1, connection: "conn-x", algorithm: "drain3", algorithm_state: {},
            templates: {
                tpl_x: { id: "tpl_x", template: "x <*>", label: null, tokens: ["x","<*>"], count: 1,
                         first_seen: "2026-05-04T00:00:00Z", last_seen: "2026-05-04T00:00:00Z", sources_seen: [] },
            },
        });
    });

    after(() => {
        try { rmSync(dir4, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    });

    test("export emits current templates", async () => {
        const exported = JSON.parse(
            (await handleExportTemplates({ params: { arguments: { _testConnection: "conn-x" } } })).content[0].text
        );
        assert.equal(Object.keys(exported.templates).length, 1);
    });

    test("import in merge mode adds without removing", async () => {
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
    });

    test("import in replace mode discards prior templates", async () => {
        const importBody = {
            templates: {
                tpl_y: { id: "tpl_y", template: "y <*>", label: "Y", tokens: ["y","<*>"], count: 3,
                         first_seen: "2026-05-04T00:00:00Z", last_seen: "2026-05-04T00:00:00Z", sources_seen: [] },
            },
            mode: "replace",
            _testConnection: "conn-x",
        };
        await handleImportTemplates({ params: { arguments: importBody } });
        const replaced = loadTemplateStore("conn-x");
        assert.equal(Object.keys(replaced.templates).length, 1);
        assert.ok(replaced.templates.tpl_y);
    });
});
