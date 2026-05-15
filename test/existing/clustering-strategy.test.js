import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import "../snapshot-config.js";
import { register, get, list, _clearForTests } from "../../src/clustering/index.js";
import { drain3Strategy } from "../../src/clustering/strategies/drain3.js";

describe("Registry", () => {
    beforeEach(() => {
        _clearForTests();
    });

    test("registry tests passed", () => {
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
    });
});

describe("Drain3", () => {
    // Restore drain3 so tests that use the registry can find it.
    beforeEach(() => {
        _clearForTests();
        register("drain3", drain3Strategy);
    });

    test("clusters similar messages and serializes roundtrip", () => {
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
    });
});
