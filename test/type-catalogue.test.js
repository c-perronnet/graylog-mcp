import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";
import {
    getCachedTypeCatalogue,
    getEncryptedFieldNamesForType,
    _clearTypeCatalogueForTests,
} from "../src/tools/inputs/type-catalogue.js";
import {
    _setCaptureRequest,
    _clearCaptureRequest,
} from "../src/graylog/client.js";

// Plan 01-01 D-06: per-connection input-type catalogue cache. One fetch per
// connection for the server process lifetime. Three consumers (list_input_types,
// create_input validation, update_input is_encrypted detection).

const CONN = { baseUrl: "_test", apiToken: "_test", writable: true };

const FIXTURE_CATALOGUE = {
    "org.graylog2.inputs.gelf.udp.GELFUDPInput": {
        type: "org.graylog2.inputs.gelf.udp.GELFUDPInput",
        name: "GELF UDP",
        description: "GELF over UDP",
        is_exclusive: false,
        requested_configuration: {
            bind_address: {
                field_type: "text",
                name: "bind_address",
                default_value: "0.0.0.0",
                is_optional: false,
                is_encrypted: false,
            },
            tls_key_password: {
                field_type: "text",
                name: "tls_key_password",
                default_value: "",
                is_optional: true,
                is_encrypted: true,
            },
        },
    },
};

beforeEach(() => {
    _clearTypeCatalogueForTests();
});

afterEach(() => {
    _clearCaptureRequest();
    _clearTypeCatalogueForTests();
});

// -------- Test 7 — first call fires one GET --------

test("first call to getCachedTypeCatalogue fires one GET to /api/system/inputs/types/all", async () => {
    let counter = 0;
    let capturedPath = null;
    _setCaptureRequest(({ path }) => {
        counter += 1;
        capturedPath = path;
        return FIXTURE_CATALOGUE;
    });
    await getCachedTypeCatalogue("conn-a", CONN);
    assert.equal(counter, 1);
    assert.equal(capturedPath, "/api/system/inputs/types/all");
});

// -------- Test 8 — second call does NOT re-fetch --------

test("second call to getCachedTypeCatalogue does NOT re-fetch", async () => {
    let counter = 0;
    _setCaptureRequest(() => {
        counter += 1;
        return FIXTURE_CATALOGUE;
    });
    await getCachedTypeCatalogue("conn-a", CONN);
    await getCachedTypeCatalogue("conn-a", CONN);
    assert.equal(counter, 1);
});

// -------- Test 9 — _clearTypeCatalogueForTests forces refetch --------

test("_clearTypeCatalogueForTests() forces refetch", async () => {
    let counter = 0;
    _setCaptureRequest(() => {
        counter += 1;
        return FIXTURE_CATALOGUE;
    });
    await getCachedTypeCatalogue("conn-a", CONN);
    _clearTypeCatalogueForTests();
    await getCachedTypeCatalogue("conn-a", CONN);
    assert.equal(counter, 2);
});

// -------- Test 10 — getEncryptedFieldNamesForType filters by is_encrypted --------

test("getEncryptedFieldNamesForType returns Set of fields with is_encrypted: true", () => {
    const fakeCatalogue = {
        "org.graylog2.inputs.gelf.tcp.GELFTCPInput": {
            requested_configuration: {
                bind_address: { is_encrypted: false },
                tls_key_password: { is_encrypted: true },
            },
        },
    };
    const encryptedFields = getEncryptedFieldNamesForType(
        fakeCatalogue,
        "org.graylog2.inputs.gelf.tcp.GELFTCPInput",
    );
    assert.equal(encryptedFields instanceof Set, true);
    assert.equal(encryptedFields.size, 1);
    assert.equal(encryptedFields.has("tls_key_password"), true);
    assert.equal(encryptedFields.has("bind_address"), false);
});

// -------- Test 11 — unknown type returns empty Set --------

test("getEncryptedFieldNamesForType returns empty Set for unknown type", () => {
    const result = getEncryptedFieldNamesForType({}, "org.example.Unknown");
    assert.equal(result instanceof Set, true);
    assert.equal(result.size, 0);
});

// -------- Test 12 — cache is keyed by connectionName --------

test("cache is keyed by connectionName — distinct connections trigger distinct fetches", async () => {
    let counter = 0;
    _setCaptureRequest(() => {
        counter += 1;
        return FIXTURE_CATALOGUE;
    });
    await getCachedTypeCatalogue("conn-a", CONN);
    await getCachedTypeCatalogue("conn-b", CONN);
    assert.equal(counter, 2);
});

// -------- Bonus: catalogue value returned to caller --------

test("getCachedTypeCatalogue returns the catalogue object verbatim", async () => {
    _setCaptureRequest(() => FIXTURE_CATALOGUE);
    const cat = await getCachedTypeCatalogue("conn-a", CONN);
    assert.equal(
        cat["org.graylog2.inputs.gelf.udp.GELFUDPInput"]?.name,
        "GELF UDP",
    );
});
