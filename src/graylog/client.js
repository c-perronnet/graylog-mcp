// Single Graylog HTTP-client layer (FOUND-02).
// Every mutating tool in this milestone — and read tools as they migrate —
// issues its outbound axios call through `makeClient(conn).request`. Auth,
// headers, error classification, timeout, and the D-07 writable-flag defense
// live here, NOT at each tool site.
//
// Test seam: `_setCaptureRequest(fn)` lets unit tests intercept the request
// before it reaches axios. Production code must NEVER call _setCaptureRequest.
// The `_` prefix marks it as test-only per project convention (CONVENTIONS.md).

import axios from "axios";
import { buildAuth } from "./auth.js";
import { mapGraylogError, GraylogError } from "./errors.js";

let _captureRequestFn = null;

// Test-only: install an interceptor that replaces the axios call.
// Invoked from test files (test/graylog-client.test.js).
// NEVER call from src/ — leaving it set in production silently disables HTTP.
export function _setCaptureRequest(fn) {
    _captureRequestFn = fn;
}

// Test-only: reset the seam to its production state (null).
export function _clearCaptureRequest() {
    _captureRequestFn = null;
}

export function makeClient(conn) {
    return {
        async request(method, path, body) {
            // D-07 / Pitfall 4 defense-in-depth: client-layer refusal mirrors
            // the wrapper-layer check that lives in Plan 04. Even if a future
            // service-layer call bypasses defineMutatingHandler, a connection
            // marked writable: false cannot issue any non-GET request.
            if (conn.writable === false && method.toUpperCase() !== "GET") {
                throw new GraylogError(
                    `Connection is read-only (writable: false). Refusing ${method} ${path}.`,
                    { status: 0, method, path, body: null }
                );
            }

            // Test seam — when set, bypass axios entirely.
            if (_captureRequestFn) {
                return _captureRequestFn({ method, path, body, conn });
            }

            try {
                // Bodyless requests (null/undefined body, e.g. GET/DELETE) must
                // NOT carry `data` or a Content-Type header — otherwise axios's
                // transformRequest runs JSON.stringify(null) and sends a literal
                // `null` body, which Graylog 7.x rejects with 400 Bad Request.
                const hasBody = body !== null && body !== undefined;
                const headers = {
                    "Accept": "application/json",
                    "X-Requested-By": "graylog-mcp",
                };
                if (hasBody) {
                    headers["Content-Type"] = "application/json";
                }
                const axiosConfig = {
                    method,
                    url: `${conn.baseUrl}${path}`,
                    headers,
                    auth: buildAuth(conn.apiToken),
                    validateStatus: () => true, // we map status codes ourselves
                    timeout: 60_000,
                };
                if (hasBody) {
                    axiosConfig.data = body;
                }
                const res = await axios(axiosConfig);
                if (res.status >= 400) {
                    throw mapGraylogError(res, { method, path });
                }
                return res.data;
            } catch (err) {
                if (err && err.isGraylogError) throw err;
                // Network-level failure (axios threw before producing a response,
                // e.g. ECONNREFUSED, ETIMEDOUT). Preserve method/path context for
                // logging in Plan 04's wrapGraylogError.
                throw new Error(`Graylog ${method} ${path} failed: ${err.message}`);
            }
        },
    };
}
