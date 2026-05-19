// Phase 9 Plan 09-01 — shared private fetch helper for the entity-shares
// READ path (SHARE-02 / SHARE-09).
//
// Both get_entity_shares and list_grantees make the IDENTICAL Graylog call:
// a /prepare probe against the entity-share endpoint. Factoring that single
// call here removes the divergence risk of two hand-copied path strings.
//
// The load-bearing logic — GRN `encodeURIComponent` + the `/prepare` suffix —
// is verified verbatim against live 7.0.6 in scripts/capture-authz-prepare-fixture.js.
//
// This helper does NOT resolve a connection and does NOT shape an MCP
// envelope: it takes an already-built `client` and an already-validated GRN.
// Connection resolution and envelope shaping stay in each handler.

/**
 * POST the entity-share /prepare probe and return the EntityShareResponse DTO.
 *
 * Builds `/api/authz/shares/entities/${encodeURIComponent(grn)}/prepare`. A GRN
 * contains literal `:` characters; interpolated raw they would mis-route the
 * JAX-RS router (or path-traverse), so the GRN is always percent-encoded.
 *
 * The body is an empty object `{}`, NOT `null`: a `{}` body makes the client
 * set `Content-Type: application/json` — the correct shape for the
 * @NoAuditEvent pure-read /prepare endpoint. A `null` body would send no
 * Content-Type at all.
 *
 * `/prepare` is the DRY-RUN (read) endpoint. The commit endpoint
 * `POST .../entities/{grn}` (no /prepare suffix) is Phase 10 and MUST NOT be
 * reachable from this helper — the `endsWith` self-guard makes a regression
 * fail loudly rather than silently mutate.
 *
 * @param {object} client    a built Graylog client (makeClient(conn))
 * @param {string} entityGrn an already-validated canonical GRN string
 * @returns {Promise<object>} the EntityShareResponse DTO
 */
export async function fetchEntitySharePreview(client, entityGrn) {
    const path = `/api/authz/shares/entities/${encodeURIComponent(entityGrn)}/prepare`;
    // Self-guard mirroring capture-authz-prepare-fixture.js — a /prepare-less
    // path would be the mutating commit endpoint, which Phase 9 never calls.
    if (!path.endsWith("/prepare")) {
        throw new Error(`entity-share read path must end with /prepare, got: ${path}`);
    }
    // `{}` body — the @NoAuditEvent empty-body pure-read contract (NOT null).
    return client.request("POST", path, {});
}
