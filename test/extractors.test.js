// Phase 1 Plan 04 — Extractor CRUD (INPUT-08, INPUT-09, INPUT-10, INPUT-11).
//
// Covers:
//   * list_extractors (INPUT-08) — per-input GET, narrow projection, fields:'all'.
//   * create_extractor (INPUT-09) — one preview-shape test per Graylog 7.0.6
//     primitive (8 types per D-07 reconfirmation: grok, regex, regex_replace,
//     split_and_index, substring, copy_input, json, lookup_table) + M5
//     existingMatches + C6 __SERVER_ASSIGNED__ sentinel + zod rejection of
//     unknown extractor_type (incl. the historical "key_value" name which is
//     NOT a real Graylog primitive — D-07 reconfirmation captured in
//     01-CONTEXT.md) + zod rejection of missing extractor_config for grok +
//     the explicit "key-value flattening via json extractor" test that proves
//     the D-07 mapping note + apply-path test (toIdBody with extractor_id).
//   * update_extractor (INPUT-10) — D-09 partial-update reuse: fetch current,
//     merge changes; extractor_type immutable. Plus zod rejection of empty
//     changes.
//   * delete_extractor (INPUT-11) — D-09 single-target, NO cascade
//     enumeration. Plus apply-path success.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import "./snapshot-config.js";
import { handleListExtractors } from "../src/tools/inputs/list-extractors.js";
import { handleCreateExtractor } from "../src/tools/inputs/create-extractor.js";
import { handleUpdateExtractor } from "../src/tools/inputs/update-extractor.js";
import { handleDeleteExtractor } from "../src/tools/inputs/delete-extractor.js";
import {
    _setCaptureRequest,
    _clearCaptureRequest,
} from "../src/graylog/client.js";
import {
    _setConnectionsForTests,
    _clearConnectionsForTests,
    setActiveConnection,
} from "../src/config.js";

// Local copy of the multiCapture helper (Plan 02 inlined the same shape into
// test/inputs.test.js; Plan 04 keeps a local copy here so the two test files
// stay independent — no shared test-utils module yet).
function multiCapture(routes) {
    return (req) => {
        for (const r of routes) {
            const matches = typeof r.pathPattern === "string"
                ? req.path === r.pathPattern
                : r.pathPattern.test(req.path);
            if (req.method === r.method && matches) {
                return typeof r.response === "function" ? r.response(req) : r.response;
            }
        }
        throw new Error(`No route matched ${req.method} ${req.path}`);
    };
}

// Plan 01-05: load the committed type-catalogue fixture for parity with
// inputs.test.js (extractors don't directly consume it, but keeping the same
// shape across both test files makes it easy to extend later if a future
// extractor test needs the catalogue).
const __dirname = dirname(fileURLToPath(import.meta.url));
const TYPE_CATALOGUE_FIXTURE = JSON.parse(
    readFileSync(join(__dirname, "fixtures/type-catalogue-7.0.6.json"), "utf8"),
);
// Touch the fixture so an unused-symbol lint would catch a future stripping.
void TYPE_CATALOGUE_FIXTURE;

beforeEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
});

afterEach(() => {
    _clearCaptureRequest();
    _clearConnectionsForTests();
    setActiveConnection(null);
});

// =====================================================================
// A. list_extractors (INPUT-08)
// =====================================================================

test("list_extractors fires GET /api/system/inputs/{inputId}/extractors and projects narrow default", async () => {
    _setCaptureRequest(multiCapture([
        {
            method: "GET",
            pathPattern: "/api/system/inputs/in1/extractors",
            response: {
                extractors: [
                    {
                        id: "ex1",
                        title: "Extract IP",
                        description: "",
                        extractor_type: "grok",
                        source_field: "message",
                        extra: "drop",
                    },
                    {
                        id: "ex2",
                        title: "Extract user",
                        description: "",
                        extractor_type: "regex",
                        source_field: "message",
                        extra: "drop",
                    },
                ],
            },
        },
    ]));
    const res = await handleListExtractors({
        params: { arguments: { inputId: "in1", _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.count, 2);
    assert.equal(payload.items.length, 2);
    // Default narrow projection [id, title, description] — `extractor_type`
    // and `source_field` and `extra` must be dropped.
    const keys = Object.keys(payload.items[0]).sort();
    assert.deepEqual(keys, ["description", "id", "title"]);
});

test("list_extractors with fields: 'all' returns full DTO", async () => {
    _setCaptureRequest(multiCapture([
        {
            method: "GET",
            pathPattern: "/api/system/inputs/in1/extractors",
            response: {
                extractors: [
                    {
                        id: "ex1",
                        title: "Extract IP",
                        description: "",
                        extractor_type: "grok",
                        source_field: "message",
                    },
                ],
            },
        },
    ]));
    const res = await handleListExtractors({
        params: {
            arguments: { inputId: "in1", fields: "all", _testConnection: "fake" },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.items[0].extractor_type, "grok");
    assert.equal(payload.items[0].source_field, "message");
});

// =====================================================================
// B. create_extractor (INPUT-09) — one preview-shape test per Graylog 7.0.6
//    primitive (8 types per D-07). Tests are unrolled (not in a `for` loop)
//    so each landing as a discrete top-level `test(...)` declaration —
//    discoverable by name, lexically greppable, isolated failures.
// =====================================================================

// Shared driver: a single helper that exercises one extractor_type / config
// pair and asserts the preview shape contract. Unrolled callers below each
// declare a top-level test so failures point at the type, not at iteration N.
// Plan 01-05: returns the parsed payload so the grok caller can take a
// byte-identical snapshot (fixture 5 — D-07 reconfirmation byte-identical
// proof for the most common extractor primitive).
async function assertCreateExtractorPreviewShape(type, config) {
    _setCaptureRequest(multiCapture([
        { method: "GET", pathPattern: /\/extractors$/, response: { extractors: [] } },
    ]));
    const res = await handleCreateExtractor({
        params: {
            arguments: {
                inputId: "in1",
                title: `Extract ${type}`,
                source_field: "message",
                target_field: "field1",
                extractor_type: type,
                extractor_config: config,
                cursor_strategy: "copy",
                condition_type: "none",
                order: 0,
                _testConnection: "fake",
            },
        },
    });
    assert.notEqual(res.isError, true, `expected success, got error: ${res.content?.[0]?.text}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.method, "POST");
    assert.equal(payload.preview.path, "/api/system/inputs/in1/extractors");
    assert.equal(payload.preview.body.extractor_type, type);
    assert.deepEqual(payload.preview.body.extractor_config, config);
    assert.equal(payload.postApplyEstimate.id, "__SERVER_ASSIGNED__");
    return payload;
}

test("create_extractor grok — preview shape", async (t) => {
    const payload = await assertCreateExtractorPreviewShape("grok", { grok_pattern: "%{IP:ip}" });
    // Snapshot 5 (Plan 01-05): D-07 reconfirmation acceptance — the grok
    // primitive is the most common; this byte-identical fixture proves the
    // create_extractor wire shape against extractor_id-not-id response quirk
    // is locked. The other 7 primitives are pinned by per-type tests above.
    t.assert.snapshot(payload);
});

test("create_extractor regex — preview shape", async () => {
    await assertCreateExtractorPreviewShape("regex", { regex_value: "(\\d+)" });
});

test("create_extractor regex_replace — preview shape", async () => {
    await assertCreateExtractorPreviewShape("regex_replace", { regex: "(\\d+)", replacement: "x" });
});

test("create_extractor split_and_index — preview shape", async () => {
    await assertCreateExtractorPreviewShape("split_and_index", { split_by: " ", index: 0 });
});

test("create_extractor substring — preview shape", async () => {
    await assertCreateExtractorPreviewShape("substring", { begin_index: 0, end_index: 4 });
});

test("create_extractor copy_input — preview shape", async () => {
    await assertCreateExtractorPreviewShape("copy_input", {});
});

test("create_extractor json — preview shape", async () => {
    await assertCreateExtractorPreviewShape("json", {});
});

test("create_extractor lookup_table — preview shape", async () => {
    await assertCreateExtractorPreviewShape("lookup_table", { lookup_table_name: "my_lookup" });
});

test("create_extractor populates existingMatches when title+extractor_type already exists (M5 per-input scoped)", async () => {
    _setCaptureRequest(multiCapture([
        {
            method: "GET",
            pathPattern: "/api/system/inputs/in1/extractors",
            response: {
                extractors: [
                    {
                        id: "existing1",
                        title: "Dup",
                        extractor_type: "grok",
                    },
                ],
            },
        },
    ]));
    const res = await handleCreateExtractor({
        params: {
            arguments: {
                inputId: "in1",
                title: "Dup",
                source_field: "message",
                target_field: "x",
                extractor_type: "grok",
                extractor_config: { grok_pattern: "%{IP:ip}" },
                _testConnection: "fake",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.existingMatches.length, 1);
    assert.equal(payload.existingMatches[0].id, "existing1");
    assert.equal(payload.existingMatches[0].title, "Dup");
    assert.ok(
        typeof payload.existingMatches[0].similarity_reason === "string"
            && payload.existingMatches[0].similarity_reason.length > 0,
        "similarity_reason must be a non-empty string",
    );
});

test("create_extractor zod rejects unknown extractor_type — 'key_value' (D-07 reconfirmation: NOT a real Graylog primitive)", async () => {
    const res = await handleCreateExtractor({
        params: {
            arguments: {
                inputId: "in1",
                title: "X",
                source_field: "message",
                target_field: "x",
                extractor_type: "key_value",
                extractor_config: { kv_separator: "=" },
                _testConnection: "fake",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /extractor_type/);
});

test("create_extractor zod rejects unknown extractor_type — 'bogus_type'", async () => {
    const res = await handleCreateExtractor({
        params: {
            arguments: {
                inputId: "in1",
                title: "X",
                source_field: "message",
                target_field: "x",
                extractor_type: "bogus_type",
                extractor_config: {},
                _testConnection: "fake",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /extractor_type/);
});

test("create_extractor zod rejects missing extractor_config for grok (grok_pattern required)", async () => {
    const res = await handleCreateExtractor({
        params: {
            arguments: {
                inputId: "in1",
                title: "X",
                source_field: "message",
                target_field: "x",
                extractor_type: "grok",
                extractor_config: {},
                _testConnection: "fake",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /grok_pattern/);
});

test("create_extractor json with kv_separator (the 'key-value flattening' path is the json extractor — D-07 mapping)", async () => {
    _setCaptureRequest(multiCapture([
        { method: "GET", pathPattern: /\/extractors$/, response: { extractors: [] } },
    ]));
    const res = await handleCreateExtractor({
        params: {
            arguments: {
                inputId: "in1",
                title: "kv flatten",
                source_field: "message",
                target_field: "kv",
                extractor_type: "json",
                extractor_config: {
                    kv_separator: "=",
                    key_separator: ",",
                    flatten: true,
                },
                _testConnection: "fake",
            },
        },
    });
    assert.notEqual(res.isError, true, `expected success, got error: ${res.content?.[0]?.text}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.body.extractor_type, "json");
    assert.equal(payload.preview.body.extractor_config.kv_separator, "=");
    assert.equal(payload.preview.body.extractor_config.key_separator, ",");
    assert.equal(payload.preview.body.extractor_config.flatten, true);
});

test("create_extractor apply path returns server-assigned id from extractor_id response field (toIdBody)", async () => {
    _setCaptureRequest(multiCapture([
        { method: "GET", pathPattern: /\/extractors$/, response: { extractors: [] } },
        { method: "POST", pathPattern: "/api/system/inputs/in1/extractors", response: { extractor_id: "newex1" } },
    ]));
    const res = await handleCreateExtractor({
        params: {
            arguments: {
                inputId: "in1",
                title: "New",
                source_field: "message",
                target_field: "x",
                extractor_type: "grok",
                extractor_config: { grok_pattern: "%{IP:ip}" },
                dryRun: false,
                _testConnection: "fake",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    assert.equal(payload.result.id, "newex1");
});

// =====================================================================
// C. update_extractor (INPUT-10) — D-09 partial-update reuse
// =====================================================================

const CURRENT_EXTRACTOR = {
    id: "ex1",
    title: "old",
    extractor_type: "grok",
    extractor_config: { grok_pattern: "%{IP:ip}" },
    source_field: "message",
    target_field: "ip",
    cursor_strategy: "copy",
    condition_type: "none",
    condition_value: "",
    order: 0,
};

test("update_extractor partial-update fetches current and merges (extractor_type preserved)", async () => {
    _setCaptureRequest(multiCapture([
        {
            method: "GET",
            pathPattern: "/api/system/inputs/in1/extractors/ex1",
            response: CURRENT_EXTRACTOR,
        },
    ]));
    const res = await handleUpdateExtractor({
        params: {
            arguments: {
                inputId: "in1",
                extractorId: "ex1",
                changes: { title: "new" },
                _testConnection: "fake",
            },
        },
    });
    assert.notEqual(res.isError, true, `expected success, got error: ${res.content?.[0]?.text}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.method, "PUT");
    assert.equal(payload.preview.path, "/api/system/inputs/in1/extractors/ex1");
    assert.equal(payload.preview.body.title, "new", "title applied from changes");
    assert.equal(payload.preview.body.extractor_type, "grok", "extractor_type immutable, preserved from current");
    assert.equal(payload.preview.body.source_field, "message", "source_field preserved from current");
    assert.equal(payload.postApplyEstimate.id, "ex1");
});

test("update_extractor sources extractor_type from read DTO `type` field (Bug #10 regression)", async () => {
    // Real Graylog extractor READ DTO names the type field `type`, NOT
    // `extractor_type`. If the merge reads only current.extractor_type, the key
    // drops out of the PUT body and Graylog returns 400 Null extractorType.
    const READ_DTO_EXTRACTOR = {
        id: "ex1",
        title: "old",
        type: "grok",
        extractor_config: { grok_pattern: "%{IP:ip}" },
        source_field: "message",
        target_field: "ip",
        cursor_strategy: "copy",
        condition_type: "none",
        condition_value: "",
        order: 0,
    };
    _setCaptureRequest(multiCapture([
        {
            method: "GET",
            pathPattern: "/api/system/inputs/in1/extractors/ex1",
            response: READ_DTO_EXTRACTOR,
        },
    ]));
    const res = await handleUpdateExtractor({
        params: {
            arguments: {
                inputId: "in1",
                extractorId: "ex1",
                changes: { title: "new" },
                _testConnection: "fake",
            },
        },
    });
    assert.notEqual(res.isError, true, `expected success, got error: ${res.content?.[0]?.text}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.method, "PUT");
    assert.equal(
        payload.preview.body.extractor_type,
        "grok",
        "extractor_type must be sourced from read DTO `type` field (Bug #10)",
    );
});

test("update_extractor zod rejects empty changes", async () => {
    const res = await handleUpdateExtractor({
        params: {
            arguments: {
                inputId: "in1",
                extractorId: "ex1",
                changes: {},
                _testConnection: "fake",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /non-empty/);
});

// =====================================================================
// D. delete_extractor (INPUT-11) — D-09 single-target, NO cascade
// =====================================================================

test("delete_extractor issues DELETE single-target with NO cascade enumeration (D-09)", async () => {
    const res = await handleDeleteExtractor({
        params: {
            arguments: { inputId: "in1", extractorId: "ex1", _testConnection: "fake" },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.method, "DELETE");
    assert.equal(payload.preview.path, "/api/system/inputs/in1/extractors/ex1");
    assert.ok(
        payload.preview.body === undefined || payload.preview.body === null,
        `DELETE body must be undefined or null; got ${JSON.stringify(payload.preview.body)}`,
    );
    // D-09: delete_extractor is single-target, NO cascade enumeration. The
    // cascades key must NOT be present in the dry-run preview.
    assert.equal(payload.cascades, undefined, "delete_extractor MUST NOT surface a cascades block (D-09)");
});

test("delete_extractor apply path issues DELETE", async () => {
    let deleteCalled = false;
    _setCaptureRequest((req) => {
        if (req.method === "DELETE" && req.path === "/api/system/inputs/in1/extractors/ex1") {
            deleteCalled = true;
            return null;
        }
        throw new Error(`Unexpected request: ${req.method} ${req.path}`);
    });
    const res = await handleDeleteExtractor({
        params: {
            arguments: {
                inputId: "in1",
                extractorId: "ex1",
                dryRun: false,
                _testConnection: "fake",
            },
        },
    });
    assert.equal(deleteCalled, true);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
});
