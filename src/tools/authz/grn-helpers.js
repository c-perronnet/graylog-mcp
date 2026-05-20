// GRN helper module — Phase 8 Plan 08-01 (AUTHZ-02 foundation).
//
// GRN wire format (source: org/graylog/grn/GRN.java): a Graylog Resource Name
// is 6 colon-joined tokens —
//
//   grn:<cluster>:<tenant>:<scope>:<type>:<entity>
//
// `GRN.parse()` lowercases the WHOLE string, splits on ":", requires EXACTLY
// 6 tokens, and asserts token[0] === "grn". On a single-cluster self-hosted
// Graylog the cluster / tenant / scope tokens are empty, so the canonical
// form is `grn::::<type>:<entity>` (4 colons after the `grn` prefix).
//
// This module is PURE — no I/O, no Graylog call. It is the one genuinely new
// pure module in Phase 8; it mirrors the JSDoc-per-export + throw-on-malformed
// discipline of src/tools/_shared/cascade-hash.js.
//
// GRN_TYPES is deliberately the RESTRICTED 6-type milestone set, NOT the
// 14-type 7.2 registry — pinning the wider set risks accepting a type the
// live 7.0.6 instance rejects (08-RESEARCH Pitfall 6 / Anti-Pattern).

// The shareable + grantee types v3.1.0 actually uses:
//   stream / dashboard / search  — shareable entity targets
//   user                         — a grantee
//   builtin-team                 — the "everyone" grantee
//   role                         — Phase 11 role management
export const GRN_TYPES = new Set([
    "stream",
    "dashboard",
    "search",
    "user",
    "builtin-team",
    "role",
]);

/**
 * Build a canonical 6-token GRN string.
 *
 * `buildGrn("stream", "000000000001")` -> `"grn::::stream:000000000001"`.
 * Both the type token and the entity id are lowercased so the result
 * round-trips through `parseGrn` (which lowercases the whole string).
 *
 * @param {string} type  GRN entity type — a non-empty string in GRN_TYPES
 * @param {string} id    entity id — a non-empty string
 * @returns {string} the 6-token form `grn::::<type>:<id>`
 * @throws when `type` is not a non-empty string
 * @throws when `type` is not in GRN_TYPES (message lists the valid set)
 * @throws when `id` is not a non-empty string
 */
export function buildGrn(type, id) {
    // Reject a non-string `type` explicitly rather than masking it via
    // String() coercion — a numeric/null `type` would otherwise surface as
    // a confusing "Unknown GRN type" instead of a clear type-error, and the
    // sibling `id` check below already rejects non-strings outright.
    if (typeof type !== "string" || type.length === 0) {
        throw new Error("buildGrn: type must be a non-empty string");
    }
    const t = type.toLowerCase();
    if (!GRN_TYPES.has(t)) {
        throw new Error(
            `Unknown GRN type "${type}". Valid types: ${[...GRN_TYPES].join(", ")}`,
        );
    }
    if (typeof id !== "string" || id.length === 0) {
        throw new Error("buildGrn: id must be a non-empty string");
    }
    // 6-token form: grn : cluster : tenant : scope : type : entity
    return `grn::::${t}:${id.toLowerCase()}`;
}

/**
 * Parse a GRN string into its 5 named tokens (the `grn` prefix is dropped).
 *
 * Enforces the exact wire contract: lowercase, split on ":", require EXACTLY
 * 6 tokens with token[0] === "grn", and the type token in GRN_TYPES. A
 * string with one extra empty token (7 tokens total) or any other shape
 * is rejected.
 *
 * @param {string} grn  a GRN string
 * @returns {{cluster: string, tenant: string, scope: string, type: string, entity: string}}
 * @throws when `grn` is not a string
 * @throws when the string is not exactly 6 colon-tokens with a "grn" prefix
 * @throws when the type token is not in GRN_TYPES
 * @throws when the entity token is empty
 */
export function parseGrn(grn) {
    if (typeof grn !== "string") {
        throw new Error("parseGrn: input must be a string");
    }
    const lowered = grn.toLowerCase(); // GRN.parse lowercases the whole string
    const tokens = lowered.split(":");
    if (tokens.length !== 6 || tokens[0] !== "grn") {
        throw new Error(
            `"${grn}" is not a valid GRN string (expected 6 colon-tokens with "grn" prefix)`,
        );
    }
    const [, cluster, tenant, scope, type, entity] = tokens;
    if (!GRN_TYPES.has(type)) {
        throw new Error(
            `GRN type "${type}" not in valid set: ${[...GRN_TYPES].join(", ")}`,
        );
    }
    // Symmetry with buildGrn (which rejects an empty `id`): an entity-less
    // GRN like `grn::::stream:` is not a real Graylog resource and would
    // never round-trip from buildGrn — reject it so isGrn() does not mask
    // a malformed agent input.
    if (entity.length === 0) {
        throw new Error(`"${grn}" is not a valid GRN string (empty entity token)`);
    }
    return { cluster, tenant, scope, type, entity };
}

/**
 * Non-throwing predicate — is `value` a valid GRN string?
 *
 * @param {unknown} value  any value
 * @returns {boolean} true iff `parseGrn(value)` would succeed
 */
export function isGrn(value) {
    try {
        parseGrn(value);
        return true;
    } catch {
        return false;
    }
}

// The shareable subset of GRN_TYPES — the only types valid as a share TARGET.
// Grantee types (user, builtin-team, role) are never a share target, so a GRN
// of those types must be rejected on the `entityGrn` input path just as the
// `entityType` zod enum (schemas.js ENTITY_TYPES) already rejects them. This
// removes the asymmetry where `entityGrn` accepted the full 6-type GRN_TYPES
// set while `entityType` only accepted the 3-type shareable subset.
export const SHAREABLE_TYPES = new Set(["stream", "dashboard", "search"]);

/**
 * Normalize a validated entity-shares tool input into a canonical share-target
 * GRN. Used by both get_entity_shares and list_grantees so the share-target
 * type constraint and the GRN normalization live in exactly one place.
 *
 * Accepts the zod-validated args object — exactly one of:
 *   - `entityGrn`: a full GRN string, OR
 *   - `entityType` + `entityId`: the pieces buildGrn assembles.
 *
 * For the `entityGrn` path: parses the GRN, captures the parsed `type` token,
 * and asserts the type is a shareable entity — grantee-type GRNs
 * (user / builtin-team / role) are rejected client-side so they never reach
 * the network as a share target. For the `entityType`/`entityId` path the zod
 * enum (schemas.js ENTITY_TYPES) already pins the type to the shareable set;
 * buildGrn assembles the canonical GRN.
 *
 * @param {{entityGrn?: string, entityType?: string, entityId?: string}} args
 * @returns {string} the canonical lowercase share-target GRN
 * @throws when the GRN is malformed
 * @throws when the `entityGrn` type is not a shareable entity type
 */
export function resolveEntityGrn(args) {
    if (args.entityGrn) {
        // Capture parseGrn's result (it returns the parsed tokens) — the old
        // comma-operator pattern called it purely for its throw side-effect
        // and discarded the parsed type, then re-did toLowerCase that parseGrn
        // had already performed internally. Capturing the type makes the
        // shareable-type guard below possible.
        const { type } = parseGrn(args.entityGrn); // throws on malformed GRN
        if (!SHAREABLE_TYPES.has(type)) {
            throw new Error(
                `entityGrn type "${type}" is not a shareable entity ` +
                `(expected stream, dashboard, or search)`,
            );
        }
        // parseGrn lowercases internally for validation; the canonical GRN we
        // send must also be lowercase to round-trip the wire contract.
        return args.entityGrn.toLowerCase();
    }
    return buildGrn(args.entityType, args.entityId);
}
