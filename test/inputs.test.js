import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";
import { handleListInputTypes } from "../src/tools/inputs/list-input-types.js";
import { handleListInputs } from "../src/tools/inputs/list-inputs.js";
import { handleGetInput } from "../src/tools/inputs/get-input.js";
import { handleCreateInput } from "../src/tools/inputs/create-input.js";
import { handleUpdateInput } from "../src/tools/inputs/update-input.js";
import { handleDeleteInput } from "../src/tools/inputs/delete-input.js";
import { handleStartInput } from "../src/tools/inputs/start-input.js";
import { handleStopInput } from "../src/tools/inputs/stop-input.js";
import {
    _setCaptureRequest,
    _clearCaptureRequest,
} from "../src/graylog/client.js";
import { _clearTypeCatalogueForTests } from "../src/tools/inputs/type-catalogue.js";
import {
    _setConnectionsForTests,
    _clearConnectionsForTests,
    setActiveConnection,
} from "../src/config.js";

// Plan 01-02 tests use this single redaction placeholder constant; the
// production code under src/tools/inputs/redact.js exports the same string
// under REDACTION_PLACEHOLDER. Keep the literal in sync with that module.
const REDACTION_PLACEHOLDER = "<redacted>";

// Helper: a per-test capture function that pattern-matches on the request
// and returns the response for whichever route matches. Throws on miss so
// tests fail loudly when an unexpected GET fires.
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

// =====================================================================
// Plan 01-02: create_input + update_input + delete_input
// =====================================================================
//
// 15+ tests covering:
//   - create_input (INPUT-04, D-04 encrypted-field redaction in preview)
//     * 4 GELF variants (UDP/TCP/HTTP strict + HTTP missing-port rejection)
//     * 2 zod rejection tests (missing type, empty title)
//     * 1 M5 existingMatches mitigation
//     * 1 apply path with server-assigned id
//   - update_input (INPUT-05 — C3 mitigation centerpiece + D-03 strict no-echo)
//     * 4 C3/D-03 acceptance gates
//     * 2 encrypted-field explicit set_value envelope (wire + preview)
//     * 2 zod rejection tests (empty changes, missing inputId)
//   - delete_input (INPUT-06 — D-05 cascade enumeration)
//     * 1 cascade enumeration in dry-run
//     * 1 apply path
//     * 1 writable=false short-circuit

const GELF_TCP_CATALOGUE = {
    "org.graylog2.inputs.gelf.tcp.GELFTCPInput": {
        type: "org.graylog2.inputs.gelf.tcp.GELFTCPInput",
        name: "GELF TCP",
        description: "GELF over TCP (with optional TLS)",
        is_exclusive: false,
        requested_configuration: {
            bind_address: { is_encrypted: false },
            port: { is_encrypted: false },
            tls_enable: { is_encrypted: false },
            tls_key_password: { is_encrypted: true },
        },
    },
};

const GELF_UDP_CATALOGUE = {
    "org.graylog2.inputs.gelf.udp.GELFUDPInput": {
        type: "org.graylog2.inputs.gelf.udp.GELFUDPInput",
        name: "GELF UDP",
        description: "GELF over UDP",
        is_exclusive: false,
        requested_configuration: {
            bind_address: { is_encrypted: false },
            port: { is_encrypted: false },
        },
    },
};

const GELF_HTTP_CATALOGUE = {
    "org.graylog2.inputs.gelf.http.GELFHttpInput": {
        type: "org.graylog2.inputs.gelf.http.GELFHttpInput",
        name: "GELF HTTP",
        description: "GELF over HTTP",
        is_exclusive: false,
        requested_configuration: {
            bind_address: { is_encrypted: false },
            port: { is_encrypted: false },
            idle_writer_timeout: { is_encrypted: false },
            max_chunk_size: { is_encrypted: false },
        },
    },
};

// -------- Test 19 (P2): create_input GELF UDP dry-run emits POST body --------

test("create_input GELF UDP dry-run emits expected POST body", async () => {
    _setCaptureRequest(multiCapture([
        { method: "GET", pathPattern: "/api/system/inputs/types/all", response: GELF_UDP_CATALOGUE },
        { method: "GET", pathPattern: "/api/system/inputs", response: { inputs: [] } },
    ]));
    const res = await handleCreateInput({
        params: {
            arguments: {
                type: "org.graylog2.inputs.gelf.udp.GELFUDPInput",
                title: "test-gelf",
                global: true,
                configuration: { bind_address: "0.0.0.0", port: 12201 },
                _testConnection: "fake",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.preview.method, "POST");
    assert.equal(payload.preview.path, "/api/system/inputs");
    assert.equal(payload.preview.body.type, "org.graylog2.inputs.gelf.udp.GELFUDPInput");
    assert.equal(payload.preview.body.title, "test-gelf");
    assert.equal(payload.preview.body.global, true);
    assert.equal(payload.preview.body.configuration.port, 12201);
    assert.equal(payload.postApplyEstimate.id, "__SERVER_ASSIGNED__");
});

// -------- Test 20 (P2): create_input GELF TCP redacts tls_key_password (D-04) --------

test("create_input GELF TCP dry-run redacts tls_key_password in preview (D-04)", async () => {
    _setCaptureRequest(multiCapture([
        { method: "GET", pathPattern: "/api/system/inputs/types/all", response: GELF_TCP_CATALOGUE },
        { method: "GET", pathPattern: "/api/system/inputs", response: { inputs: [] } },
    ]));
    const res = await handleCreateInput({
        params: {
            arguments: {
                type: "org.graylog2.inputs.gelf.tcp.GELFTCPInput",
                title: "test-gelf-tcp",
                global: false,
                configuration: {
                    bind_address: "0.0.0.0",
                    port: 12201,
                    tls_enable: true,
                    tls_key_password: "supersecret",
                },
                _testConnection: "fake",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(
        payload.preview.body.configuration.tls_key_password,
        REDACTION_PLACEHOLDER,
        "encrypted field MUST be redacted in dry-run preview",
    );
    const allText = JSON.stringify(payload);
    assert.ok(
        !allText.includes("supersecret"),
        `literal secret leaked into payload: ${allText}`,
    );
});

// -------- Test 21 (P2): create_input GELF HTTP strict schema accepts (WARNING #9 fix) --------

test("create_input GELF HTTP zod accepts strict schema (WARNING #9 fix)", async () => {
    _setCaptureRequest(multiCapture([
        { method: "GET", pathPattern: "/api/system/inputs/types/all", response: GELF_HTTP_CATALOGUE },
        { method: "GET", pathPattern: "/api/system/inputs", response: { inputs: [] } },
    ]));
    const res = await handleCreateInput({
        params: {
            arguments: {
                type: "org.graylog2.inputs.gelf.http.GELFHttpInput",
                title: "test-gelf-http",
                global: false,
                configuration: {
                    bind_address: "0.0.0.0",
                    port: 12202,
                    idle_writer_timeout: 60,
                    max_chunk_size: 65536,
                },
                _testConnection: "fake",
            },
        },
    });
    assert.notEqual(res.isError, true, `expected success, got error: ${res.content?.[0]?.text}`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.body.type, "org.graylog2.inputs.gelf.http.GELFHttpInput");
    assert.equal(payload.preview.body.configuration.port, 12202);
});

// -------- Test 22 (P2): create_input GELF HTTP zod rejects missing port (WARNING #9 fix) --------

test("create_input GELF HTTP zod rejects missing port", async () => {
    const res = await handleCreateInput({
        params: {
            arguments: {
                type: "org.graylog2.inputs.gelf.http.GELFHttpInput",
                title: "test-gelf-http",
                global: false,
                configuration: {
                    bind_address: "0.0.0.0",
                    // port omitted — strict schema requires it
                    idle_writer_timeout: 60,
                },
                _testConnection: "fake",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /port/);
});

// -------- Test 23 (P2): create_input zod rejects missing type --------

test("create_input zod rejects missing required type", async () => {
    const res = await handleCreateInput({
        params: {
            arguments: {
                title: "test",
                global: true,
                configuration: {},
                _testConnection: "fake",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /type/i);
});

// -------- Test 24 (P2): create_input zod rejects empty title --------

test("create_input zod rejects empty title", async () => {
    const res = await handleCreateInput({
        params: {
            arguments: {
                type: "org.graylog2.inputs.gelf.udp.GELFUDPInput",
                title: "",
                global: true,
                configuration: { bind_address: "0.0.0.0", port: 12201 },
                _testConnection: "fake",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /title/i);
});

// -------- Test 25 (P2): create_input M5 mitigation — existingMatches populated --------

test("create_input populates existingMatches when title+type already exists (M5)", async () => {
    _setCaptureRequest(multiCapture([
        { method: "GET", pathPattern: "/api/system/inputs/types/all", response: GELF_UDP_CATALOGUE },
        {
            method: "GET",
            pathPattern: "/api/system/inputs",
            response: {
                inputs: [
                    {
                        id: "existing1",
                        title: "test-gelf",
                        type: "org.graylog2.inputs.gelf.udp.GELFUDPInput",
                        global: true,
                    },
                ],
            },
        },
    ]));
    const res = await handleCreateInput({
        params: {
            arguments: {
                type: "org.graylog2.inputs.gelf.udp.GELFUDPInput",
                title: "test-gelf",
                global: true,
                configuration: { bind_address: "0.0.0.0", port: 12201 },
                _testConnection: "fake",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.existingMatches.length, 1);
    assert.equal(payload.existingMatches[0].id, "existing1");
    assert.equal(payload.existingMatches[0].title, "test-gelf");
    assert.ok(
        typeof payload.existingMatches[0].similarity_reason === "string"
            && payload.existingMatches[0].similarity_reason.length > 0,
        "similarity_reason must be a non-empty string",
    );
});

// -------- Test 26 (P2): create_input apply path returns server-assigned id --------

test("create_input apply path returns server-assigned id", async () => {
    _setCaptureRequest(multiCapture([
        { method: "GET", pathPattern: "/api/system/inputs/types/all", response: GELF_UDP_CATALOGUE },
        { method: "GET", pathPattern: "/api/system/inputs", response: { inputs: [] } },
        { method: "POST", pathPattern: "/api/system/inputs", response: { id: "new123" } },
    ]));
    const res = await handleCreateInput({
        params: {
            arguments: {
                type: "org.graylog2.inputs.gelf.udp.GELFUDPInput",
                title: "test-gelf",
                global: true,
                configuration: { bind_address: "0.0.0.0", port: 12201 },
                dryRun: false,
                _testConnection: "fake",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    assert.equal(payload.result.id, "new123");
});

// -------- Test 27 (P2): update_input C3 ACCEPTANCE GATE — no-op preview emits ONLY changed field --------

test("update_input partial dry-run with no-op changes emits ONLY changed field (C3 ACCEPTANCE GATE)", async () => {
    _setCaptureRequest(multiCapture([
        {
            method: "GET",
            pathPattern: "/api/system/inputs/in1",
            response: {
                id: "in1",
                title: "t1",
                type: "org.graylog2.inputs.gelf.tcp.GELFTCPInput",
                global: true,
                configuration: {
                    bind_address: "0.0.0.0",
                    port: 12201,
                    tls_enable: true,
                    tls_key_password: "<value hidden>",
                },
            },
        },
        { method: "GET", pathPattern: "/api/system/inputs/types/all", response: GELF_TCP_CATALOGUE },
    ]));
    const res = await handleUpdateInput({
        params: {
            arguments: {
                inputId: "in1",
                changes: { configuration: { port: 12202 } },
                _testConnection: "fake",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.body.configuration.port, 12202);
    assert.equal(payload.preview.body.configuration.tls_key_password, undefined,
        "encrypted field MUST NEVER appear unless explicitly set");
    assert.equal(payload.preview.body.configuration.bind_address, undefined,
        "D-03 strict no-echo: unchanged non-encrypted field MUST NOT be echoed");
    assert.equal(payload.preview.body.configuration.tls_enable, undefined,
        "D-03 strict no-echo: unchanged boolean MUST NOT be echoed");
    const bodyText = JSON.stringify(payload.preview.body);
    assert.ok(!bodyText.includes("<value hidden>"),
        `GET-response mask leaked: ${bodyText}`);
    assert.equal(Object.keys(payload.preview.body.configuration).length, 1,
        "configuration block must contain ONLY the agent-requested port key");
});

// -------- Test 28 (P2): update_input D-03 — changes={configuration:{}} emits empty configuration --------

test("update_input D-03 acceptance: changes={configuration:{}} emits empty configuration (ROADMAP success criterion 2)", async () => {
    _setCaptureRequest(multiCapture([
        {
            method: "GET",
            pathPattern: "/api/system/inputs/in1",
            response: {
                id: "in1",
                title: "t1",
                type: "org.graylog2.inputs.gelf.tcp.GELFTCPInput",
                global: true,
                configuration: {
                    bind_address: "0.0.0.0",
                    port: 12201,
                    tls_enable: true,
                    tls_key_password: "<value hidden>",
                },
            },
        },
        { method: "GET", pathPattern: "/api/system/inputs/types/all", response: GELF_TCP_CATALOGUE },
    ]));
    const res = await handleUpdateInput({
        params: {
            arguments: {
                inputId: "in1",
                changes: { configuration: {} },
                _testConnection: "fake",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // D-03 acceptance: configuration is either {} or omitted entirely; both satisfy
    // "only the changed fields" since the agent requested zero changes.
    const cfg = payload.preview.body.configuration;
    assert.ok(cfg === undefined || (typeof cfg === "object" && Object.keys(cfg).length === 0),
        `configuration must be empty object or absent; got ${JSON.stringify(cfg)}`);
    // The encrypted field MUST NOT be echoed even on a zero-config-change update.
    if (cfg) {
        assert.equal(cfg.tls_key_password, undefined,
            "encrypted field MUST NEVER appear on no-op");
    }
    const bodyText = JSON.stringify(payload.preview.body);
    assert.ok(!bodyText.includes("tls_key_password"),
        `encrypted field name appeared in body: ${bodyText}`);
});

// -------- Test 29 (P2): update_input title-only change emits no configuration block --------

test("update_input no-changes-to-configuration (only title change) emits no configuration block", async () => {
    _setCaptureRequest(multiCapture([
        {
            method: "GET",
            pathPattern: "/api/system/inputs/in1",
            response: {
                id: "in1",
                title: "t1",
                type: "org.graylog2.inputs.gelf.tcp.GELFTCPInput",
                global: true,
                configuration: {
                    bind_address: "0.0.0.0",
                    port: 12201,
                    tls_enable: true,
                    tls_key_password: "<value hidden>",
                },
            },
        },
        { method: "GET", pathPattern: "/api/system/inputs/types/all", response: GELF_TCP_CATALOGUE },
    ]));
    const res = await handleUpdateInput({
        params: {
            arguments: {
                inputId: "in1",
                changes: { title: "renamed" },
                _testConnection: "fake",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.body.title, "renamed");
    const cfg = payload.preview.body.configuration;
    assert.ok(cfg === undefined || (typeof cfg === "object" && Object.keys(cfg).length === 0),
        `configuration must be empty object or absent when agent only renamed; got ${JSON.stringify(cfg)}`);
    const bodyText = JSON.stringify(payload.preview.body);
    assert.ok(!bodyText.includes("tls_key_password"),
        `encrypted field name appeared in body: ${bodyText}`);
});

// -------- Test 30 (P2): update_input explicit encrypted-field change → { set_value } envelope on wire --------

test("update_input explicit encrypted-field change emits { set_value } envelope on wire (apply path)", async () => {
    let capturedPut = null;
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/inputs/in1") {
            return {
                id: "in1",
                title: "t1",
                type: "org.graylog2.inputs.gelf.tcp.GELFTCPInput",
                global: true,
                configuration: {
                    bind_address: "0.0.0.0",
                    port: 12201,
                    tls_enable: true,
                    tls_key_password: "<value hidden>",
                },
            };
        }
        if (req.method === "GET" && req.path === "/api/system/inputs/types/all") {
            return GELF_TCP_CATALOGUE;
        }
        if (req.method === "PUT" && req.path === "/api/system/inputs/in1") {
            capturedPut = req;
            return { id: "in1" };
        }
        throw new Error(`Unexpected request: ${req.method} ${req.path}`);
    });
    const res = await handleUpdateInput({
        params: {
            arguments: {
                inputId: "in1",
                changes: { configuration: { tls_key_password: "newPasswordValue" } },
                dryRun: false,
                _testConnection: "fake",
            },
        },
    });
    assert.ok(capturedPut, "PUT must have been called");
    assert.deepEqual(
        capturedPut.body.configuration.tls_key_password,
        { set_value: "newPasswordValue" },
        "wire body MUST wrap explicit encrypted value as { set_value }",
    );
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
});

// -------- Test 31 (P2): update_input explicit encrypted-field change shows redacted in preview --------

test("update_input explicit encrypted-field change shows redacted placeholder in dry-run preview", async () => {
    _setCaptureRequest(multiCapture([
        {
            method: "GET",
            pathPattern: "/api/system/inputs/in1",
            response: {
                id: "in1",
                title: "t1",
                type: "org.graylog2.inputs.gelf.tcp.GELFTCPInput",
                global: true,
                configuration: {
                    bind_address: "0.0.0.0",
                    port: 12201,
                    tls_enable: true,
                    tls_key_password: "<value hidden>",
                },
            },
        },
        { method: "GET", pathPattern: "/api/system/inputs/types/all", response: GELF_TCP_CATALOGUE },
    ]));
    const res = await handleUpdateInput({
        params: {
            arguments: {
                inputId: "in1",
                changes: { configuration: { tls_key_password: "newPasswordValue" } },
                _testConnection: "fake",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(
        payload.preview.body.configuration.tls_key_password,
        REDACTION_PLACEHOLDER,
        "explicit encrypted value MUST be redacted in dry-run preview",
    );
    const allText = JSON.stringify(payload);
    assert.ok(!allText.includes("newPasswordValue"),
        `literal new password leaked: ${allText}`);
});

// -------- Test 32 (P2): update_input zod rejects empty changes --------

test("update_input zod rejects empty changes", async () => {
    const res = await handleUpdateInput({
        params: {
            arguments: {
                inputId: "in1",
                changes: {},
                _testConnection: "fake",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /changes|non-empty/i);
});

// -------- Test 33 (P2): update_input zod rejects missing inputId --------

test("update_input zod rejects missing inputId", async () => {
    const res = await handleUpdateInput({
        params: {
            arguments: {
                changes: { title: "t" },
                _testConnection: "fake",
            },
        },
    });
    assert.equal(res.isError, true);
});

// -------- Test 34 (P2): delete_input dry-run enumerates affected extractors (D-05) --------

test("delete_input dry-run enumerates affected extractors in cascades.extractors[] (D-05)", async () => {
    _setCaptureRequest(multiCapture([
        {
            method: "GET",
            pathPattern: "/api/system/inputs/in1/extractors",
            response: {
                extractors: [
                    { id: "ex1", title: "Extract ip", extractor_type: "grok" },
                    { id: "ex2", title: "Extract user", extractor_type: "regex" },
                ],
            },
        },
    ]));
    const res = await handleDeleteInput({
        params: {
            arguments: { inputId: "in1", _testConnection: "fake" },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.method, "DELETE");
    assert.equal(payload.preview.path, "/api/system/inputs/in1");
    assert.ok(payload.preview.body === undefined || payload.preview.body === null,
        `DELETE body must be undefined or null; got ${JSON.stringify(payload.preview.body)}`);
    assert.ok(payload.cascades, "cascades block must be present");
    assert.equal(payload.cascades.extractors.length, 2);
    assert.equal(payload.cascades.extractors[0].id, "ex1");
    assert.equal(payload.cascades.extractors[0].title, "Extract ip");
    assert.equal(payload.cascades.extractors[0].extractor_type, "grok");
    assert.equal(payload.cascades.extractors[1].id, "ex2");
});

// -------- Test 35 (P2): delete_input apply path issues DELETE --------

test("delete_input apply path issues DELETE", async () => {
    let deleteCalled = false;
    _setCaptureRequest((req) => {
        if (req.method === "GET" && req.path === "/api/system/inputs/in1/extractors") {
            return { extractors: [] };
        }
        if (req.method === "DELETE" && req.path === "/api/system/inputs/in1") {
            deleteCalled = true;
            return null;
        }
        throw new Error(`Unexpected request: ${req.method} ${req.path}`);
    });
    const res = await handleDeleteInput({
        params: {
            arguments: { inputId: "in1", dryRun: false, _testConnection: "fake" },
        },
    });
    assert.equal(deleteCalled, true);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
});

// -------- Test 36 (P2): delete_input writable=false short-circuits --------

test("delete_input writable=false short-circuits", async () => {
    _setConnectionsForTests({
        readonly: { baseUrl: "x", apiToken: "x", writable: false },
    });
    const res = await handleDeleteInput({
        params: {
            arguments: { inputId: "in1", connectionName: "readonly" },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "connection_read_only");
});

// =====================================================================
// Plan 01-03 — INPUT-07: start_input + stop_input lifecycle tools
// =====================================================================
//
// The unusual verb mapping is the load-bearing contract here:
//   start_input  → PUT    /api/system/inputstates/{inputId}
//   stop_input   → DELETE /api/system/inputstates/{inputId}
// (RESEARCH.md Endpoint Catalogue rows 7-8; §Pitfall Lifecycle.)
//
// Both compose through defineMutatingHandler so dryRun + writable-gate +
// idempotency are inherited from the Phase 0 contract — no special-cased
// runtime path (D-08).

// -------- Test 37 (P3): start_input dry-run shows PUT verb --------

test("start_input dry-run preview shows PUT /api/system/inputstates/{id}", async () => {
    const res = await handleStartInput({
        params: { arguments: { inputId: "in1", _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.method, "PUT");
    assert.equal(payload.preview.path, "/api/system/inputstates/in1");
    assert.ok(payload.preview.body === undefined || payload.preview.body === null,
        `start_input body must be undefined or null; got ${JSON.stringify(payload.preview.body)}`);
    assert.equal(payload.postApplyEstimate.id, "in1");
});

// -------- Test 38 (P3): start_input apply path captures PUT verb --------

test("start_input apply path captures the correct verb + path", async () => {
    let captured = null;
    _setCaptureRequest((req) => {
        captured = req;
        return { id: "in1" };
    });
    const res = await handleStartInput({
        params: {
            arguments: { inputId: "in1", dryRun: false, _testConnection: "fake" },
        },
    });
    assert.equal(captured.method, "PUT");
    assert.equal(captured.path, "/api/system/inputstates/in1");
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
});

// -------- Test 39 (P3): stop_input dry-run shows DELETE verb --------

test("stop_input dry-run preview shows DELETE /api/system/inputstates/{id}", async () => {
    const res = await handleStopInput({
        params: { arguments: { inputId: "in1", _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.method, "DELETE");
    assert.equal(payload.preview.path, "/api/system/inputstates/in1");
    assert.ok(payload.preview.body === undefined || payload.preview.body === null,
        `stop_input body must be undefined or null; got ${JSON.stringify(payload.preview.body)}`);
    assert.equal(payload.postApplyEstimate.id, "in1");
});

// -------- Test 40 (P3): stop_input apply path captures DELETE verb --------

test("stop_input apply path captures DELETE verb", async () => {
    let captured = null;
    _setCaptureRequest((req) => {
        captured = req;
        return { id: "in1" };
    });
    const res = await handleStopInput({
        params: {
            arguments: { inputId: "in1", dryRun: false, _testConnection: "fake" },
        },
    });
    assert.equal(captured.method, "DELETE");
    assert.equal(captured.path, "/api/system/inputstates/in1");
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
});

// -------- Test 41 (P3): start/stop both honor writable=false gate --------

test("start_input honors writable=false gate", async () => {
    _setConnectionsForTests({
        readonly: { baseUrl: "x", apiToken: "x", writable: false },
    });
    const res = await handleStartInput({
        params: { arguments: { inputId: "in1", connectionName: "readonly" } },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "connection_read_only");
});

test("stop_input honors writable=false gate", async () => {
    _setConnectionsForTests({
        readonly: { baseUrl: "x", apiToken: "x", writable: false },
    });
    const res = await handleStopInput({
        params: { arguments: { inputId: "in1", connectionName: "readonly" } },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "connection_read_only");
});

// -------- Test 42 (P3): zod rejects missing inputId --------

test("start_input zod rejects missing inputId", async () => {
    const res = await handleStartInput({
        params: { arguments: { _testConnection: "fake" } },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /inputId/);
});

test("stop_input zod rejects missing inputId", async () => {
    const res = await handleStopInput({
        params: { arguments: { _testConnection: "fake" } },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /inputId/);
});
