import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import "../snapshot-config.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    loadTemplateStore, saveTemplateStore, _withStorePathOverride
} from "../../src/clustering/template-store.js";

describe("Template store", () => {
    let dir;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "tpl-test-"));
        _withStorePathOverride(() => join(dir, "store.json"));
    });

    after(() => {
        // Best-effort cleanup of any lingering temp dirs from the final case
        try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    });

    test("empty load returns versioned empty store", () => {
        const store = loadTemplateStore("conn1");
        assert.equal(store.version, 1);
        assert.deepEqual(store.templates, {});
    });

    test("save + reload roundtrip preserves templates and algorithm_state", () => {
        const store = loadTemplateStore("conn1");
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
    });

    test("corrupt file recovers to empty store", () => {
        writeFileSync(join(dir, "store.json"), "not json", "utf-8");
        const recovered = loadTemplateStore("conn1");
        assert.deepEqual(recovered.templates, {});
    });
});
