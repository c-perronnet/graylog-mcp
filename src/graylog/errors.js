// Typed error hierarchy for the Graylog HTTP client (FOUND-02).
// Consumers in Plan 04 wrap thrown GraylogError instances into the canonical
// MCP error response shape ({ isError: true, content: [{ type: "text", text }] }).
// Carries .status / .method / .path / .body so wrapGraylogError can render
// context-rich messages without re-parsing the axios response.

export class GraylogError extends Error {
    constructor(message, { status, method, path, body } = {}) {
        super(message);
        this.isGraylogError = true;
        this.status = status;
        this.method = method;
        this.path = path;
        this.body = body;
    }
}

export class GraylogValidationError extends GraylogError { kind = "validation"; }
export class GraylogUnauthorizedError extends GraylogError { kind = "unauthorized"; }
export class GraylogPermissionError extends GraylogError { kind = "permission"; }
export class GraylogNotFoundError extends GraylogError { kind = "not_found"; }
export class GraylogConflictError extends GraylogError { kind = "conflict"; }
export class GraylogUnprocessableError extends GraylogError { kind = "unprocessable"; }

// Status-code classifier: maps a parsed axios response (already in { status, statusText, data }
// shape) plus per-call context to the right typed subclass. Unknown statuses fall through
// to the base GraylogError so callers can still inspect .status / .body.
export function mapGraylogError(res, ctx) {
    const Ctor =
        res.status === 400 ? GraylogValidationError :
        res.status === 401 ? GraylogUnauthorizedError :
        res.status === 403 ? GraylogPermissionError :
        res.status === 404 ? GraylogNotFoundError :
        res.status === 409 ? GraylogConflictError :
        res.status === 422 ? GraylogUnprocessableError :
        GraylogError;
    const msg = res.data?.message ?? res.statusText ?? `HTTP ${res.status}`;
    return new Ctor(msg, { ...ctx, status: res.status, body: res.data });
}
