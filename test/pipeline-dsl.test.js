// Plan 04-01 Task 1 — pipeline-dsl shared infrastructure (D-02/D-03/D-04/D-12/D-13).
//
// Exhaustive coverage of the five modules under src/pipeline-dsl/:
//   A. builtins.js          — frozen 130-entry static catalogue
//   B. escape.js            — RuleLang.g4-correct escapeString + escapeValue
//   C. emit.js              — structured-intent RuleSpec → DSL string emitter
//   D. function-catalogue.js — per-connection live-overlay cache (Pitfall 5)
//   E. validate.js          — client-side lint over the MERGED catalogue
//
// computeRuleCascadeHash (F) lives in test/cascade-hash.test.js per its
// thin-wrapper relationship to Phase 3's computeCascadeHash.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";

import { staticBuiltins } from "../src/pipeline-dsl/builtins.js";
import { escapeString, escapeValue } from "../src/pipeline-dsl/escape.js";
import { emitRule } from "../src/pipeline-dsl/emit.js";
import {
    getMergedCatalogue,
    _clearFunctionCatalogueForTests,
} from "../src/pipeline-dsl/function-catalogue.js";
import { validateRuleSource } from "../src/pipeline-dsl/validate.js";
import {
    _setCaptureRequest,
    _clearCaptureRequest,
} from "../src/graylog/client.js";

const CONN = { baseUrl: "_test", apiToken: "_test", writable: true };

beforeEach(() => {
    _clearFunctionCatalogueForTests();
});

afterEach(() => {
    _clearCaptureRequest();
    _clearFunctionCatalogueForTests();
});

// =====================================================================
// A. builtins.js — frozen 130-entry static catalogue
// =====================================================================

test("staticBuiltins is a frozen Array", () => {
    assert.ok(Array.isArray(staticBuiltins));
    assert.equal(Object.isFrozen(staticBuiltins), true);
});

test("staticBuiltins.length === 130", () => {
    assert.equal(staticBuiltins.length, 130);
});

test("every staticBuiltins entry has the 5-key {name, signature, oneLineDescription, category, sourceRef} shape", () => {
    for (const entry of staticBuiltins) {
        assert.equal(typeof entry.name, "string", `entry.name must be string for ${JSON.stringify(entry)}`);
        assert.equal(typeof entry.signature, "string", `entry.signature must be string for ${entry.name}`);
        assert.equal(typeof entry.oneLineDescription, "string", `entry.oneLineDescription must be string for ${entry.name}`);
        assert.equal(typeof entry.category, "string", `entry.category must be string for ${entry.name}`);
        assert.equal(typeof entry.sourceRef, "string", `entry.sourceRef must be string for ${entry.name}`);
    }
});

test("every staticBuiltins name is unique (no duplicates)", () => {
    const names = new Set(staticBuiltins.map((b) => b.name));
    assert.equal(names.size, staticBuiltins.length);
});

test("staticBuiltins contains every known anchor function from the 16-category inventory", () => {
    const anchors = [
        // root (4)
        "from_input", "grok_exists", "is_null", "is_not_null",
        // conversion (3 anchors)
        "to_long", "to_string", "to_bool",
        // messages (4 anchors)
        "set_field", "drop_message", "route_to_stream", "has_field",
        // strings (4 anchors)
        "uppercase", "lowercase", "regex_replace", "grok",
        // hashing (2 anchors)
        "md5", "sha256",
        // ips (2 anchors)
        "cidr_match", "to_ip",
        // json (2 anchors)
        "parse_json", "flatten_json",
        // lookup (2 anchors)
        "lookup", "lookup_value",
        // dates (2 anchors)
        "now", "parse_date",
        // dates/periods (4 anchors)
        "seconds", "minutes", "hours", "days",
        // encoding (2 anchors)
        "base64_encode", "base64_decode",
        // syslog (2 anchors)
        "syslog_level", "syslog_facility",
        // urls (2 anchors)
        "urlencode", "urldecode",
        // arrays (1 anchor)
        "array_contains",
        // maps (2 anchors)
        "map_get", "map_set",
        // debug (1 anchor)
        "debug",
    ];
    const names = new Set(staticBuiltins.map((b) => b.name));
    for (const anchor of anchors) {
        assert.ok(names.has(anchor), `missing anchor function: ${anchor}`);
    }
    // Sanity check: at least 38 known anchors per plan acceptance criterion.
    assert.ok(anchors.length >= 38, `anchor list shrunk: ${anchors.length}`);
});

test("every staticBuiltins category is one of the 16 known categories", () => {
    const KNOWN = new Set([
        "root", "arrays", "conversion", "dates", "dates/periods", "debug",
        "encoding", "hashing", "ips", "json", "lookup", "maps", "messages",
        "strings", "syslog", "urls",
    ]);
    for (const entry of staticBuiltins) {
        assert.ok(
            KNOWN.has(entry.category),
            `unknown category ${JSON.stringify(entry.category)} for ${entry.name}`,
        );
    }
});

test("staticBuiltins resists accidental mutation (push throws)", () => {
    assert.throws(() => staticBuiltins.push({ name: "evil" }), TypeError);
});

// =====================================================================
// B. escape.js — escapeString + escapeValue
// =====================================================================

test("escapeString turns embedded double-quote into backslash-quote", () => {
    assert.equal(escapeString('foo"bar'), 'foo\\"bar');
});

test("escapeString doubles a single backslash", () => {
    assert.equal(escapeString("a\\b"), "a\\\\b");
});

test("escapeString turns literal newline into backslash-n", () => {
    assert.equal(escapeString("line1\nline2"), "line1\\nline2");
});

test("escapeString turns literal tab into backslash-t", () => {
    assert.equal(escapeString("tab\there"), "tab\\there");
});

test("escapeString turns literal carriage return into backslash-r", () => {
    assert.equal(escapeString("cr\r"), "cr\\r");
});

test("escapeString returns empty string for empty input", () => {
    assert.equal(escapeString(""), "");
});

test("escapeString passes through plain ASCII", () => {
    assert.equal(escapeString("plain ascii"), "plain ascii");
});

test("escapeString turns control char U+0001 into \\u0001", () => {
    assert.equal(escapeString(""), "\\u0001");
});

test("escapeString throws TypeError on non-string input", () => {
    assert.throws(() => escapeString(123), TypeError);
});

test("escapeValue wraps a string in double-quotes", () => {
    assert.equal(escapeValue("hello"), '"hello"');
});

test("escapeValue wraps + escapes a string containing a double-quote", () => {
    assert.equal(escapeValue('foo"bar'), '"foo\\"bar"');
});

test("escapeValue emits a number as bare digits", () => {
    assert.equal(escapeValue(42), "42");
});

test("escapeValue emits a boolean as bare true/false", () => {
    assert.equal(escapeValue(true), "true");
    assert.equal(escapeValue(false), "false");
});

test("escapeValue emits null as bare null", () => {
    assert.equal(escapeValue(null), "null");
});

test("escapeValue rejects objects (must use structured intent)", () => {
    assert.throws(() => escapeValue({}), TypeError);
});

test("escapeValue rejects arrays (must use structured intent)", () => {
    assert.throws(() => escapeValue([]), TypeError);
});

test("escapeValue rejects undefined", () => {
    assert.throws(() => escapeValue(undefined), TypeError);
});

// =====================================================================
// C. emit.js — emitRule(RuleSpec) → DSL string
// =====================================================================

test("emitRule emits the rule scaffolding for a simple comparison rule", () => {
    const dsl = emitRule({
        name: "lvl4+",
        when: {
            type: "comparison",
            op: ">=",
            left: { type: "field_ref", field: "level", source: "message" },
            right: { type: "literal", value: 4 },
        },
        then: [
            {
                type: "set_field",
                field: "alert",
                value: { type: "literal", value: true },
            },
        ],
    });
    assert.match(dsl, /^rule "lvl4\+"/);
    assert.ok(dsl.includes("when"));
    assert.ok(dsl.includes("$message.level >= 4"));
    assert.ok(dsl.includes("then"));
    assert.ok(dsl.includes("set_field"));
    assert.ok(dsl.endsWith("end"));
});

test("emitRule emits and-condition with parens", () => {
    const dsl = emitRule({
        name: "r",
        when: {
            type: "and",
            left: { type: "has_field", field: "a" },
            right: { type: "has_field", field: "b" },
        },
        then: [],
    });
    assert.ok(dsl.includes('(has_field("a") && has_field("b"))'));
});

test("emitRule emits or-condition with parens", () => {
    const dsl = emitRule({
        name: "r",
        when: {
            type: "or",
            left: { type: "has_field", field: "a" },
            right: { type: "has_field", field: "b" },
        },
        then: [],
    });
    assert.ok(dsl.includes('(has_field("a") || has_field("b"))'));
});

test("emitRule emits not-condition", () => {
    const dsl = emitRule({
        name: "r",
        when: { type: "not", expr: { type: "has_field", field: "a" } },
        then: [],
    });
    assert.ok(dsl.includes('! (has_field("a"))'));
});

test("emitRule emits has_field with escaped string arg", () => {
    const dsl = emitRule({
        name: "r",
        when: { type: "has_field", field: "source" },
        then: [],
    });
    assert.ok(dsl.includes('has_field("source")'));
});

test("emitRule emits field_ref with source:message as $message.foo", () => {
    const dsl = emitRule({
        name: "r",
        when: {
            type: "comparison",
            op: "==",
            left: { type: "field_ref", field: "foo", source: "message" },
            right: { type: "literal", value: 1 },
        },
        then: [],
    });
    assert.ok(dsl.includes("$message.foo == 1"));
});

test("emitRule emits field_ref with no source as bare identifier", () => {
    const dsl = emitRule({
        name: "r",
        when: {
            type: "comparison",
            op: "==",
            left: { type: "field_ref", field: "foo" },
            right: { type: "literal", value: 1 },
        },
        then: [],
    });
    assert.ok(dsl.includes("foo == 1"));
});

test("emitRule emits function_call with positional args", () => {
    const dsl = emitRule({
        name: "r",
        when: {
            type: "function_call",
            name: "to_long",
            args: { positional: [{ type: "field_ref", field: "level" }] },
        },
        then: [],
    });
    assert.ok(dsl.includes("to_long(level)"));
});

test("emitRule emits function_call with named args (prefix per arg)", () => {
    const dsl = emitRule({
        name: "r",
        when: {
            type: "function_call",
            name: "regex",
            args: {
                named: {
                    pattern: { type: "literal", value: "\\d+" },
                    value: { type: "field_ref", field: "msg" },
                },
            },
        },
        then: [],
    });
    assert.ok(dsl.includes('regex(pattern: "\\\\d+", value: msg)'));
});

test("emitRule emits set_field with named field+value args", () => {
    const dsl = emitRule({
        name: "r",
        when: { type: "literal", value: true },
        then: [
            {
                type: "set_field",
                field: "name",
                value: { type: "literal", value: "alice" },
            },
        ],
    });
    assert.ok(dsl.includes('set_field(field: "name", value: "alice");'));
});

test("emitRule emits remove_field with escaped field arg", () => {
    const dsl = emitRule({
        name: "r",
        when: { type: "literal", value: true },
        then: [{ type: "remove_field", field: "foo" }],
    });
    assert.ok(dsl.includes('remove_field("foo");'));
});

test("emitRule emits rename_field with two escaped args", () => {
    const dsl = emitRule({
        name: "r",
        when: { type: "literal", value: true },
        then: [{ type: "rename_field", old_field: "old", new_field: "new" }],
    });
    assert.ok(dsl.includes('rename_field("old", "new");'));
});

test("emitRule emits let_assignment", () => {
    const dsl = emitRule({
        name: "r",
        when: { type: "literal", value: true },
        then: [
            {
                type: "let_assignment",
                var_name: "tmp",
                value: {
                    type: "function_call",
                    name: "to_long",
                    args: { positional: [{ type: "field_ref", field: "level" }] },
                },
            },
        ],
    });
    assert.ok(dsl.includes("let tmp = to_long(level);"));
});

test("emitRule emits function_call_statement (bare function call followed by semicolon)", () => {
    const dsl = emitRule({
        name: "r",
        when: { type: "literal", value: true },
        then: [
            {
                type: "function_call_statement",
                name: "drop_message",
                args: {},
            },
        ],
    });
    assert.ok(dsl.includes("drop_message();"));
});

test("emitRule emits lookup_value as set_field(...lookup_value(...))", () => {
    const dsl = emitRule({
        name: "r",
        when: { type: "literal", value: true },
        then: [
            {
                type: "lookup_value",
                target_field: "user",
                lookup_table: "users",
                key: { type: "field_ref", field: "user_id" },
            },
        ],
    });
    assert.ok(dsl.includes('set_field("user", lookup_value('));
    assert.ok(dsl.includes('lookup_table: "users"'));
    assert.ok(dsl.includes("key: user_id"));
});

test("emitRule routes string literals through escapeString — produces escaped substring", () => {
    const dsl = emitRule({
        name: "r",
        when: { type: "literal", value: 'foo"bar' },
        then: [],
    });
    assert.ok(dsl.includes('"foo\\"bar"'));
});

test("emitRule is byte-stable across repeated invocations on identical input", () => {
    const input = {
        name: "stable",
        when: {
            type: "and",
            left: { type: "has_field", field: "src" },
            right: { type: "comparison", op: "==", left: { type: "field_ref", field: "level", source: "message" }, right: { type: "literal", value: 6 } },
        },
        then: [
            { type: "set_field", field: "tag", value: { type: "literal", value: "alert" } },
            { type: "remove_field", field: "tmp" },
        ],
    };
    const a = emitRule(input);
    const b = emitRule(input);
    assert.equal(a, b);
});

test("emitRule throws on unknown condition type with the type name in the message", () => {
    assert.throws(
        () => emitRule({
            name: "r",
            when: { type: "unknown_condition_type", x: 1 },
            then: [],
        }),
        /unknown_condition_type/,
    );
});

test("emitRule throws on unknown action type with the type name in the message", () => {
    assert.throws(
        () => emitRule({
            name: "r",
            when: { type: "literal", value: true },
            then: [{ type: "unknown_action_type", x: 1 }],
        }),
        /unknown_action_type/,
    );
});

// =====================================================================
// D. function-catalogue.js — getMergedCatalogue + _clearFunctionCatalogueForTests
// =====================================================================

test("getMergedCatalogue fires exactly one GET per connectionName (cache hit on second call)", async () => {
    let counter = 0;
    let capturedPath = null;
    _setCaptureRequest(({ path }) => {
        counter += 1;
        capturedPath = path;
        return [];
    });
    await getMergedCatalogue("conn-a", CONN);
    await getMergedCatalogue("conn-a", CONN);
    assert.equal(counter, 1);
    assert.equal(capturedPath, "/api/system/pipelines/rule/functions");
});

test("getMergedCatalogue isolates cache by connectionName (separate conn fires separate GET)", async () => {
    let counter = 0;
    _setCaptureRequest(() => {
        counter += 1;
        return [];
    });
    await getMergedCatalogue("conn-a", CONN);
    await getMergedCatalogue("conn-b", CONN);
    assert.equal(counter, 2);
});

test("getMergedCatalogue returns a Map (not the raw response)", async () => {
    _setCaptureRequest(() => []);
    const merged = await getMergedCatalogue("conn-a", CONN);
    assert.ok(merged instanceof Map);
});

test("getMergedCatalogue with empty live response contains every static entry (130)", async () => {
    _setCaptureRequest(() => []);
    const merged = await getMergedCatalogue("conn-a", CONN);
    assert.equal(merged.size, staticBuiltins.length);
    for (const entry of staticBuiltins) {
        assert.ok(merged.has(entry.name), `missing ${entry.name}`);
    }
});

test("getMergedCatalogue live entry wins on name collision (source: 'live')", async () => {
    _setCaptureRequest(() => [
        {
            name: "to_long",
            params: [{ name: "value", type: "any", optional: false }],
            return_type: "long",
            description: "live desc",
            deprecated: false,
        },
    ]);
    const merged = await getMergedCatalogue("conn-a", CONN);
    const entry = merged.get("to_long");
    assert.equal(entry.source, "live");
    assert.equal(entry.oneLineDescription, "live desc");
});

test("getMergedCatalogue preserves static category when live entry lacks category override", async () => {
    _setCaptureRequest(() => [
        {
            name: "to_long",
            params: [{ name: "value", type: "any", optional: false }],
            return_type: "long",
            description: "live desc",
        },
    ]);
    const merged = await getMergedCatalogue("conn-a", CONN);
    // to_long is in the conversion category per static baseline.
    assert.equal(merged.get("to_long").category, "conversion");
});

test("getMergedCatalogue accepts live-only function names (Pitfall 5 fix; category: 'unknown')", async () => {
    _setCaptureRequest(() => [
        {
            name: "__phase4_test_function__",
            params: [],
            return_type: "string",
            description: "synthetic test function",
        },
    ]);
    const merged = await getMergedCatalogue("conn-a", CONN);
    const live = merged.get("__phase4_test_function__");
    assert.ok(live, "live-only function must be in merged map");
    assert.equal(live.source, "live");
    assert.equal(live.category, "unknown");
});

test("getMergedCatalogue retains static-only entries when live response omits them", async () => {
    _setCaptureRequest(() => []);
    const merged = await getMergedCatalogue("conn-a", CONN);
    // to_long is in static baseline; not in live (empty array).
    assert.equal(merged.get("to_long").source, "static");
});

test("_clearFunctionCatalogueForTests empties the cache (next call refetches)", async () => {
    let counter = 0;
    _setCaptureRequest(() => {
        counter += 1;
        return [];
    });
    await getMergedCatalogue("conn-a", CONN);
    _clearFunctionCatalogueForTests();
    await getMergedCatalogue("conn-a", CONN);
    assert.equal(counter, 2);
});

test("getMergedCatalogue falls back to static description when live's description is null", async () => {
    _setCaptureRequest(() => [
        {
            name: "to_long",
            params: [{ name: "value", type: "any", optional: false }],
            return_type: "long",
            description: null,
        },
    ]);
    const merged = await getMergedCatalogue("conn-a", CONN);
    const entry = merged.get("to_long");
    // The static oneLineDescription must survive.
    const stat = staticBuiltins.find((b) => b.name === "to_long");
    assert.equal(entry.oneLineDescription, stat.oneLineDescription);
});

test("getMergedCatalogue preserves live deprecated: true flag", async () => {
    _setCaptureRequest(() => [
        {
            name: "to_long",
            params: [],
            return_type: "long",
            description: "x",
            deprecated: true,
        },
    ]);
    const merged = await getMergedCatalogue("conn-a", CONN);
    assert.equal(merged.get("to_long").deprecated, true);
});

// =====================================================================
// E. validate.js — validateRuleSource(source, mergedCatalogue) → {errors, warnings}
// =====================================================================

test("validateRuleSource: rule with all known function names has no errors", async () => {
    _setCaptureRequest(() => []);
    const cat = await getMergedCatalogue("conn-a", CONN);
    const src = `rule "r"
when has_field("src")
then
    set_field("up", uppercase(to_string($message.payload)));
end`;
    const { errors } = validateRuleSource(src, cat);
    assert.equal(errors.length, 0, `unexpected errors: ${JSON.stringify(errors)}`);
});

test("validateRuleSource: camelCase 'toUpperCase' is flagged as unknown_function", async () => {
    _setCaptureRequest(() => []);
    const cat = await getMergedCatalogue("conn-a", CONN);
    const src = `rule "r"
when has_field("src")
then
    set_field("up", toUpperCase($message.payload));
end`;
    const { errors } = validateRuleSource(src, cat);
    assert.ok(errors.length >= 1);
    const unknown = errors.find((e) => e.type === "unknown_function" && /toUpperCase/.test(e.message));
    assert.ok(unknown, `expected unknown_function for toUpperCase, got ${JSON.stringify(errors)}`);
});

test("validateRuleSource: snake_case 'to_upper' is flagged (typo for uppercase)", async () => {
    _setCaptureRequest(() => []);
    const cat = await getMergedCatalogue("conn-a", CONN);
    const src = `rule "r"
when has_field("src")
then
    set_field("up", to_upper($message.payload));
end`;
    const { errors } = validateRuleSource(src, cat);
    assert.ok(errors.length >= 1);
    const unknown = errors.find((e) => e.type === "unknown_function");
    assert.ok(unknown);
});

test("validateRuleSource: live-only function name from merged map is accepted (Pitfall 5)", async () => {
    _setCaptureRequest(() => [
        {
            name: "__phase4_test_function__",
            params: [],
            return_type: "string",
            description: "synthetic",
        },
    ]);
    const cat = await getMergedCatalogue("conn-a", CONN);
    const src = `rule "r"
when true
then
    set_field("x", __phase4_test_function__());
end`;
    const { errors } = validateRuleSource(src, cat);
    // No unknown_function error for the live-only name.
    const unknown = errors.find(
        (e) => e.type === "unknown_function" && /__phase4_test_function__/.test(e.message),
    );
    assert.equal(unknown, undefined);
});

test("validateRuleSource: accepts a custom Map containing names not in staticBuiltins (consumes merged, NOT raw static)", () => {
    // Build a synthetic Map that contains ONLY a custom name (no overlap with staticBuiltins).
    const customMap = new Map();
    customMap.set("custom_only_fn", {
        name: "custom_only_fn",
        signature: "custom_only_fn(): any",
        oneLineDescription: "synthetic",
        category: "unknown",
        source: "live",
    });
    const src = `rule "r"
when true
then
    set_field("x", custom_only_fn());
end`;
    const { errors } = validateRuleSource(src, customMap);
    const unknown = errors.find(
        (e) => e.type === "unknown_function" && /custom_only_fn/.test(e.message),
    );
    assert.equal(unknown, undefined, `custom_only_fn must be accepted from merged map: ${JSON.stringify(errors)}`);
});

test("validateRuleSource: paren-imbalance is flagged", async () => {
    _setCaptureRequest(() => []);
    const cat = await getMergedCatalogue("conn-a", CONN);
    const src = `rule "r"
when has_field("src")
then
    set_field("x"
end`;
    const { errors } = validateRuleSource(src, cat);
    const paren = errors.find((e) => e.type === "paren_imbalance");
    assert.ok(paren, `expected paren_imbalance, got ${JSON.stringify(errors)}`);
});

test("validateRuleSource: empty source string warns + returns no errors", () => {
    const cat = new Map();
    const { errors, warnings } = validateRuleSource("", cat);
    assert.equal(errors.length, 0);
    assert.ok(warnings.length >= 1);
    assert.ok(warnings.some((w) => w.type === "empty_source"));
});
