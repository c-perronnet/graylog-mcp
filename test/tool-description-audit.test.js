// HARD-01 — Pin scripts/audit-tool-descriptions.js invariants.
//
// The audit walks the toolDefinitions array exported from src/tools.js and
// produces a flat array of violations. Each violation has a `rule` field
// ("length" | "discrimination" | "empty") plus rule-specific context.
//
// These tests pin three things:
//   1. The audit() pure function correctly classifies fixtures (good/bad).
//   2. The real production src/tools.js exports a fully-compliant catalogue.
//      (This test fails until Task 2 lands the wholesale fix — by design.)
//   3. The CLI entry point (node scripts/audit-tool-descriptions.js) exits
//      non-zero on violations, supports SRC_TOOLS_PATH env override.
//
// Convention: node:test + node:assert/strict, no Jest, no chai (matches the
// rest of test/).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "./snapshot-config.js";

import { audit } from "../scripts/audit-tool-descriptions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const AUDIT_SCRIPT = resolve(REPO_ROOT, "scripts", "audit-tool-descriptions.js");

const okTool = (overrides = {}) => ({
    name: "good_tool",
    description:
        "List streams. Use this rather than get_stream when you need many in one call.",
    inputSchema: { type: "object", properties: {} },
    ...overrides,
});

test("audit() returns empty array for a compliant fixture", () => {
    const violations = audit([okTool()]);
    assert.deepEqual(violations, []);
});

test("audit() flags over-budget descriptions (>200 chars) with rule='length'", () => {
    // 250 chars exactly — first sentence then comparative second sentence so
    // the only violation is `length`, not `discrimination`.
    const longBody = "x".repeat(180);
    const desc = `List things. ${longBody}. Use this rather than other_tool.`;
    assert.ok(desc.length > 200, "fixture must exceed budget");
    const tool = okTool({ name: "long_tool", description: desc });
    const violations = audit([tool]);
    const lengthViolations = violations.filter((v) => v.rule === "length");
    assert.equal(lengthViolations.length, 1);
    assert.equal(lengthViolations[0].name, "long_tool");
    assert.equal(lengthViolations[0].length, desc.length);
    assert.equal(lengthViolations[0].budget, 200);
});

test("audit() flags single-sentence descriptions with no comparative keyword (rule='discrimination')", () => {
    const tool = okTool({ name: "bland_tool", description: "List streams." });
    const violations = audit([tool]);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].rule, "discrimination");
    assert.equal(violations[0].name, "bland_tool");
});

test("audit() accepts multi-sentence descriptions with comparative keywords", () => {
    const tool = okTool({
        name: "multi_sentence",
        description:
            "Fetch streams. Use this instead of search_messages_graylog when you need stream metadata, not message content.",
    });
    assert.deepEqual(audit([tool]), []);
});

test("audit() accepts single-sentence descriptions containing 'vs.' or 'rather than' or 'instead of' or 'use this when'", () => {
    const phrases = [
        "List streams vs. get_stream when many are needed",
        "List streams rather than get_stream when many are needed",
        "List streams instead of get_stream when many are needed",
        "Fetches streams; use this when many are needed",
    ];
    for (const phrase of phrases) {
        const tool = okTool({ name: "phrase_tool", description: phrase });
        const violations = audit([tool]);
        assert.deepEqual(
            violations,
            [],
            `phrase should pass discrimination check: ${phrase}`,
        );
    }
});

test("audit() flags empty/missing description (rule='empty')", () => {
    const tool = {
        name: "x",
        description: "",
        inputSchema: { type: "object", properties: {} },
    };
    const violations = audit([tool]);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].rule, "empty");
    assert.equal(violations[0].name, "x");
});

test("audit() flags missing description field as empty", () => {
    const tool = { name: "no_desc", inputSchema: { type: "object", properties: {} } };
    const violations = audit([tool]);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].rule, "empty");
});

test("audit() exits 0 against the real src/tools.js (Task 2 GREEN gate)", async () => {
    const mod = await import("../src/tools.js");
    const tools = mod.toolDefinitions ?? mod.default;
    assert.ok(Array.isArray(tools), "src/tools.js must export toolDefinitions array");
    const violations = audit(tools);
    assert.deepEqual(
        violations,
        [],
        `Expected zero violations; got ${violations.length}: ${JSON.stringify(violations.slice(0, 5))}`,
    );
});

test("CLI: node scripts/audit-tool-descriptions.js exits non-zero on tampered fixture", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-tool-desc-"));
    const fixturePath = join(dir, "tools.js");
    const bad = `export const toolDefinitions = [
        { name: "bad_one", description: "List streams.", inputSchema: { type: "object", properties: {} } }
    ];`;
    writeFileSync(fixturePath, bad, "utf8");

    const result = spawnSync(process.execPath, [AUDIT_SCRIPT], {
        env: { ...process.env, SRC_TOOLS_PATH: fixturePath },
        encoding: "utf8",
    });
    assert.equal(result.status, 1, `expected exit 1, got ${result.status} (stderr: ${result.stderr})`);
    assert.match(result.stderr, /violation/i);
});

test("CLI: node scripts/audit-tool-descriptions.js exits 0 against compliant fixture", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-tool-desc-"));
    const fixturePath = join(dir, "tools.js");
    const good = `export const toolDefinitions = [
        { name: "good_one", description: "List streams. Use this rather than get_stream when you need many in one call.", inputSchema: { type: "object", properties: {} } }
    ];`;
    writeFileSync(fixturePath, good, "utf8");

    const result = spawnSync(process.execPath, [AUDIT_SCRIPT], {
        env: { ...process.env, SRC_TOOLS_PATH: fixturePath },
        encoding: "utf8",
    });
    assert.equal(result.status, 0, `expected exit 0, got ${result.status} (stderr: ${result.stderr})`);
});
