// Regression net for the client.js bodyless-request 400 bug (260516-ivt).
//
// makeClient().request() previously passed `data: body` and a hard-coded
// `Content-Type: application/json` to axios unconditionally. For a bodyless
// GET (`body = null`), axios's transformRequest serialized JSON.stringify(null)
// into a literal `null` request body — Graylog 7.x rejects a GET carrying a
// body with 400 Bad Request, breaking every read/list/get admin tool.
//
// These tests exercise the REAL axios path against a local HTTP server. The
// `_setCaptureRequest` seam cannot catch this class of bug because it bypasses
// axios (and therefore transformRequest) entirely.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { makeClient } from "../../src/graylog/client.js";

let server;
let port;
let captured;

before(async () => {
    server = http.createServer((req, res) => {
        let bodyChunks = "";
        req.on("data", (chunk) => {
            bodyChunks += chunk;
        });
        req.on("end", () => {
            captured = {
                method: req.method,
                contentType: req.headers["content-type"],
                accept: req.headers["accept"],
                xRequestedBy: req.headers["x-requested-by"],
                body: bodyChunks,
            };
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end("{}");
        });
    });
    await new Promise((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
    });
    port = server.address().port;
});

after(async () => {
    await new Promise((resolve) => server.close(resolve));
});

function makeConn() {
    return { baseUrl: `http://127.0.0.1:${port}`, apiToken: "T1" };
}

test("bodyless GET sends no request body and no Content-Type header", async () => {
    captured = null;
    await makeClient(makeConn()).request("GET", "/api/streams");
    assert.equal(captured.method, "GET");
    assert.equal(captured.body, "", "bodyless GET must send an empty request body");
    assert.equal(
        captured.contentType,
        undefined,
        "bodyless GET must not send a Content-Type header"
    );
});

test("bodyless GET still sends Accept and X-Requested-By headers", async () => {
    captured = null;
    await makeClient(makeConn()).request("GET", "/api/streams");
    assert.equal(captured.accept, "application/json");
    assert.equal(captured.xRequestedBy, "graylog-mcp");
});

test("POST with a real object body sends Content-Type and a JSON-serialized body", async () => {
    captured = null;
    await makeClient(makeConn()).request("POST", "/api/streams", { title: "T" });
    assert.equal(captured.method, "POST");
    assert.equal(captured.contentType, "application/json");
    assert.deepEqual(JSON.parse(captured.body), { title: "T" });
    assert.equal(captured.accept, "application/json");
    assert.equal(captured.xRequestedBy, "graylog-mcp");
});

test("bodyless DELETE sends no request body and no Content-Type header", async () => {
    captured = null;
    await makeClient(makeConn()).request("DELETE", "/api/streams/abc", null);
    assert.equal(captured.method, "DELETE");
    assert.equal(captured.body, "", "bodyless DELETE must send an empty request body");
    assert.equal(
        captured.contentType,
        undefined,
        "bodyless DELETE must not send a Content-Type header"
    );
});
