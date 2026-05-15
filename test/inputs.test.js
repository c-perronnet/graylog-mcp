import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";
import { handleListInputTypes } from "../src/tools/inputs/list-input-types.js";
import { handleListInputs } from "../src/tools/inputs/list-inputs.js";
import { handleGetInput } from "../src/tools/inputs/get-input.js";
import {
    _setCaptureRequest,
    _clearCaptureRequest,
} from "../src/graylog/client.js";
import { _clearTypeCatalogueForTests } from "../src/tools/inputs/type-catalogue.js";
import {
    _clearConnectionsForTests,
    setActiveConnection,
} from "../src/config.js";

// Plan 01-01: INPUT-01 (list_input_types), INPUT-02 (list_inputs), INPUT-03
// (get_input). Three read-only tools; first two compose through
// defineListHandler, the third is a plain async handler because it returns
// a single DTO rather than a projected list.

const FIXTURE_TYPE_CATALOGUE = {
    "org.graylog2.inputs.gelf.udp.GELFUDPInput": {
        type: "org.graylog2.inputs.gelf.udp.GELFUDPInput",
        name: "GELF UDP",
        description: "GELF over UDP",
        is_exclusive: false,
        requested_configuration: {
            bind_address: { is_encrypted: false },
        },
    },
    "org.graylog2.inputs.syslog.udp.SyslogUDPInput": {
        type: "org.graylog2.inputs.syslog.udp.SyslogUDPInput",
        name: "Syslog UDP",
        description: "Syslog over UDP",
        is_exclusive: false,
        requested_configuration: {},
    },
};

beforeEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
    _clearTypeCatalogueForTests();
});

afterEach(() => {
    _clearCaptureRequest();
    _clearConnectionsForTests();
    setActiveConnection(null);
    _clearTypeCatalogueForTests();
});

// -------- Test 13 — list_input_types returns catalogue --------

test("list_input_types handler returns parsed catalogue under content[0].text", async () => {
    _setCaptureRequest(() => FIXTURE_TYPE_CATALOGUE);
    const res = await handleListInputTypes({
        params: { arguments: { _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "list_input_types");
    // Items projection: each item should reference one of the FQCNs as either
    // its id or a nested `type` field.
    const ids = payload.items.map((it) => it.id);
    assert.ok(
        ids.includes("org.graylog2.inputs.gelf.udp.GELFUDPInput"),
        `expected GELFUDPInput FQCN in items, got ids=${JSON.stringify(ids)}`,
    );
});

// -------- Test 14 — list_inputs default projection [id, title, type, global] --------

test("list_inputs default projection narrows to [id, title, type, global]", async () => {
    // CRITICAL: the _setCaptureRequest seam substitutes for axios's `res.data`
    // (see src/graylog/client.js:45). The handler reads `response.inputs`
    // directly, so the mock MUST be the unwrapped envelope shape.
    _setCaptureRequest(() => ({
        inputs: [
            {
                id: "in1",
                title: "Alpha",
                type: "org.graylog2.inputs.gelf.udp.GELFUDPInput",
                global: true,
                configuration: { port: 12201 },
            },
            {
                id: "in2",
                title: "Beta",
                type: "org.graylog2.inputs.syslog.udp.SyslogUDPInput",
                global: false,
                configuration: { port: 514 },
            },
        ],
    }));
    const res = await handleListInputs({
        params: { arguments: { _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(payload.fields, ["id", "title", "type", "global"]);
    assert.equal(payload.count, 2);
    assert.equal(payload.items.length, 2);
    assert.deepEqual(
        Object.keys(payload.items[0]).sort(),
        ["global", "id", "title", "type"],
    );
    assert.equal(payload.items[0].configuration, undefined);
});

// -------- Test 15 — list_inputs fields:'all' returns full DTO --------

test("list_inputs with fields: 'all' returns full DTO (configuration included)", async () => {
    _setCaptureRequest(() => ({
        inputs: [
            {
                id: "in1",
                title: "Alpha",
                type: "org.graylog2.inputs.gelf.udp.GELFUDPInput",
                global: true,
                configuration: { port: 12201, bind_address: "0.0.0.0" },
            },
        ],
    }));
    const res = await handleListInputs({
        params: { arguments: { _testConnection: "fake", fields: "all" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.fields, "all");
    assert.ok(payload.items[0].configuration);
    assert.equal(payload.items[0].configuration.port, 12201);
});

// -------- Test 16 — get_input returns full InputSummary --------

test("get_input returns full InputSummary DTO", async () => {
    _setCaptureRequest(({ path }) => {
        assert.equal(path, "/api/system/inputs/input123");
        return {
            id: "input123",
            title: "My GELF input",
            type: "org.graylog2.inputs.gelf.udp.GELFUDPInput",
            global: true,
            configuration: {
                bind_address: "0.0.0.0",
                port: 12201,
                tls_key_password: "<value hidden>",
            },
            created_at: "2026-05-15T10:00:00.000Z",
            creator_user_id: "admin",
            static_fields: {},
        };
    });
    const res = await handleGetInput({
        params: { arguments: { _testConnection: "fake", inputId: "input123" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "get_input");
    assert.equal(payload.input.id, "input123");
    assert.ok(payload.input.configuration);
    assert.equal(payload.input.configuration.port, 12201);
    // Verify encrypted field surfaces as the server-supplied placeholder
    // (the MCP never unmasks).
    assert.equal(
        payload.input.configuration.tls_key_password,
        "<value hidden>",
    );
});

// -------- Test 17 — get_input zod rejects missing inputId --------

test("get_input zod rejects missing inputId", async () => {
    const res = await handleGetInput({
        params: { arguments: { _testConnection: "fake" } },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /inputId/);
});

// -------- Test 18 — list_input_types uses the cache --------

test("list_input_types uses the cache — repeated invocations hit it once", async () => {
    let counter = 0;
    _setCaptureRequest(() => {
        counter += 1;
        return FIXTURE_TYPE_CATALOGUE;
    });
    await handleListInputTypes({
        params: { arguments: { _testConnection: "fake" } },
    });
    await handleListInputTypes({
        params: { arguments: { _testConnection: "fake" } },
    });
    assert.equal(counter, 1, "second invocation must reuse the cache");
});
