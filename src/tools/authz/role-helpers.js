// src/tools/authz/role-helpers.js
//
// Phase 11 Plan 11-02 — role-management helper module. Centralises the
// client-side built-in refusal logic (ROLE-07 / D-18), the tagError
// helper that all 5 role mutators reuse (factored out of share-entity.js),
// the permission diff + hashing helpers consumed by update_role and
// delete_role + assign/unassign, and the permission-catalogue cache used
// by create_role / update_role for D-01 / D-04 validation.
//
// Pattern source: src/tools/authz/grn-helpers.js (same domain; same
// pure-helper + validator + Set discipline).
//
// Encodes:
//   - D-05  Permission-catalogue cache: module-scope Map, keyed by
//           `${conn.baseUrl}::${conn.apiToken}`, no expiry within session.
//   - D-18  assertRoleIsMutable: case-insensitive comparison against
//           BUILT_IN_ROLES Set; reason tag `builtin_role_immutable`. Applied
//           to update_role + delete_role ONLY (AP4 — assigning to built-ins
//           is legitimate, so assign/unassign do NOT call this helper).
//   - D-19  This helper is FAST-PATH only — does not query the server.
//           Update / delete handlers ALSO do a pre-flight GET and check the
//           server-side `read_only:true` flag (the AUTHORITATIVE refusal).
//   - D-01  validatePermissionsAgainstCatalogue: `{type}:{action}` prefix
//           must be in the catalogue map; scope id (`:{id}`) stripped per D-02.
//   - D-03  Wildcard `*` is always accepted (warning surfaced at handler level).
//   - D-04  permitUnknownPermissions:true opt-out skips catalogue validation
//           at the handler — this helper just answers "valid vs invalid".

import { createHash } from "node:crypto";

import { BUILT_IN_ROLES } from "./schemas.js";

// =====================================================================
// assertRoleIsMutable — D-18 client-side built-in refusal fast-path
// =====================================================================

/**
 * Refuse to mutate a built-in role.
 *
 * Throws a tag-able Error when the role name (case-insensitively) is in
 * BUILT_IN_ROLES. The thrown Error is plain — callers wrap it via
 * `tagError(err, "builtin_role_immutable")` so wrapGraylogError surfaces a
 * structured `reason` envelope.
 *
 * Server-side `read_only:true` from the pre-flight GET is the
 * AUTHORITATIVE refusal (D-19). This helper is the fast-path so the GET
 * round-trip is only paid when the static check passes.
 *
 * @param {string} roleName  role name (non-empty)
 * @returns {void}
 * @throws  {Error}  when roleName is not a non-empty string
 * @throws  {Error}  when roleName is in BUILT_IN_ROLES (case-insensitive)
 */
export function assertRoleIsMutable(roleName) {
    if (typeof roleName !== "string" || roleName.length === 0) {
        throw new Error("assertRoleIsMutable: roleName must be a non-empty string");
    }
    if (BUILT_IN_ROLES.has(roleName.toLowerCase())) {
        throw new Error(
            `role "${roleName}" is a built-in (read-only) role — cannot mutate ` +
            `(use list_roles to see the full set; custom roles are mutable)`,
        );
    }
}

// =====================================================================
// tagError — Phase 10 reason-tagging convention, factored out
// =====================================================================

/**
 * Tag an in-handler error with a structured `reason` so wrapGraylogError
 * surfaces it programmatically. Spoofs the GraylogError shape
 * (isGraylogError + status) so the existing errors.js path attaches
 * `reason: <tag>` to both the rendered text and the envelope's top-level
 * `reason` field.
 *
 * Verbatim from src/tools/authz/share-entity.js:71-78 — factored out so
 * all 5 role mutators reuse without duplicating.
 *
 * @param {Error}  err
 * @param {string} reason   the programmatic reason tag (e.g. "role_not_found")
 * @param {number} [status] HTTP-like status code; default 422 (semantic refusal)
 * @returns {Error} the same err object (mutated, returned for chaining)
 */
export function tagError(err, reason, status = 422) {
    err.isGraylogError = true;
    err.status = status;
    err.method = "";
    err.path = "";
    err.reason = reason;
    return err;
}

// =====================================================================
// computePermissionsDiff — D-15 update_role preview diff
// =====================================================================

/**
 * Compute the {added, removed, unchanged} diff between two permission
 * sets. Used by update_role's dry-run preview to surface the impact of a
 * full-replace operation before token-confirm.
 *
 * Null/undefined inputs are treated as empty arrays (defensive).
 *
 * @param {string[]|null|undefined} currentPerms
 * @param {string[]|null|undefined} targetPerms
 * @returns {{added: string[], removed: string[], unchanged: string[]}}
 *   Each array sorted ascending.
 */
export function computePermissionsDiff(currentPerms, targetPerms) {
    const current = new Set(Array.isArray(currentPerms) ? currentPerms : []);
    const target = new Set(Array.isArray(targetPerms) ? targetPerms : []);
    return {
        added: [...target].filter((p) => !current.has(p)).sort(),
        removed: [...current].filter((p) => !target.has(p)).sort(),
        unchanged: [...target].filter((p) => current.has(p)).sort(),
    };
}

// =====================================================================
// sortedPermissionsHash / sortedRolesHash — D-14 drift-refusal anchors
// =====================================================================

/**
 * Stable sha-256 over a sorted permission array. Used as the
 * `current_permissions_hash` field in update_role's confirmation token so
 * drift between dry-run and apply trips the requireConfirm gate.
 *
 * Null/non-array input hashes the empty array (defensive — never throws).
 *
 * @param {string[]|null|undefined} permissions
 * @returns {string} 64-char lowercase hex sha-256
 */
export function sortedPermissionsHash(permissions) {
    const sorted = [...(Array.isArray(permissions) ? permissions : [])].sort();
    return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

/**
 * Stable sha-256 over a sorted role-name array. Used as the
 * `current_roles_hash` field in assign_role / unassign_role confirmation
 * tokens AND as the `members_hash` field in delete_role's token.
 *
 * Null/non-array input hashes the empty array (defensive).
 *
 * @param {string[]|null|undefined} roles
 * @returns {string} 64-char lowercase hex sha-256
 */
export function sortedRolesHash(roles) {
    const sorted = [...(Array.isArray(roles) ? roles : [])].sort();
    return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

// =====================================================================
// Permission-catalogue cache + validator — D-01 / D-02 / D-03 / D-05
// =====================================================================

// D-05: module-scope per-connection cache. Keyed by `{baseUrl, apiToken}`
// so multi-connection setups don't cross-contaminate; no expiry within
// session (the catalogue rarely changes inside a single MCP session).
// The map IS the cache — tests reset it via _clearCatalogueCacheForTests.
const _CATALOGUE_CACHE = new Map();

/**
 * Fetch (and cache) the Graylog permission catalogue.
 *
 * On first call per `{baseUrl, apiToken}` pair, issues
 * `GET /api/system/permissions` and stores the response. Subsequent calls
 * for the same connection return the cached value (no HTTP).
 *
 * Returns the `response.permissions` map shape (resource → action[]). If
 * the server returns an unexpected shape, defaults to `{}` so downstream
 * `validatePermissionsAgainstCatalogue` produces a clean "everything is
 * unknown" output instead of crashing.
 *
 * Defensive cache-key invariant: if `conn.baseUrl` or `conn.apiToken` is
 * missing/blank (test-seam paths), the catalogue is fetched fresh every
 * call (no cache key derivable). This is correct for the `_testConnection`
 * synthetic conn shape (`baseUrl:"_test", apiToken:"_test"`) which IS a
 * derivable key — production conns always have both.
 *
 * @param {{request: (m:string,p:string,b:unknown)=>Promise<unknown>}} client
 * @param {{baseUrl?: string, apiToken?: string}} conn
 * @returns {Promise<Record<string, string[]>>} the permission catalogue map
 */
export async function fetchPermissionCatalogue(client, conn) {
    const baseUrl = typeof conn?.baseUrl === "string" ? conn.baseUrl : "";
    const apiToken = typeof conn?.apiToken === "string" ? conn.apiToken : "";
    const cacheKey = `${baseUrl}::${apiToken}`;
    if (_CATALOGUE_CACHE.has(cacheKey)) {
        return _CATALOGUE_CACHE.get(cacheKey);
    }
    const response = await client.request("GET", "/api/system/permissions", null);
    const catalogue = (response && typeof response.permissions === "object" && response.permissions !== null)
        ? response.permissions
        : {};
    _CATALOGUE_CACHE.set(cacheKey, catalogue);
    return catalogue;
}

/**
 * Test-only seam: clear the module-scope permission-catalogue cache so
 * each test fixture starts from a known empty state. Mirrors the
 * `_clearForTests()` convention from src/clustering/index.js:27 (per
 * CLAUDE.md test-hook conventions).
 *
 * Production code MUST NOT call this.
 */
export function _clearCatalogueCacheForTests() {
    _CATALOGUE_CACHE.clear();
}

/**
 * Validate a permission-string array against the Graylog catalogue.
 *
 * D-02 parsing rules: a permission is `{resource}:{action}` or
 * `{resource}:{action}:{scope-id}`. The `{resource}:{action}` prefix MUST
 * be in the catalogue; the trailing `:{scope-id}` (if present) is opaque
 * entity data — NOT validated.
 *
 * D-03: the wildcard `*` super-permission is ALWAYS valid. The handler
 * surfaces a wildcard warning in the dry-run preview so the agent and
 * reviewer see the blast radius before token-confirm.
 *
 * @param {Record<string, string[]>} catalogue  fetched permission catalogue
 * @param {string[]} permissions                permission strings to validate
 * @returns {{valid: string[], invalid: string[]}}
 *   Two arrays partitioning the input. Order within each is preserved.
 */
export function validatePermissionsAgainstCatalogue(catalogue, permissions) {
    const valid = [];
    const invalid = [];
    const cat = (catalogue && typeof catalogue === "object" && !Array.isArray(catalogue))
        ? catalogue
        : {};
    const perms = Array.isArray(permissions) ? permissions : [];
    for (const p of perms) {
        if (typeof p !== "string" || p.length === 0) {
            invalid.push(p);
            continue;
        }
        // D-03 wildcard super-permission — always valid.
        if (p === "*") {
            valid.push(p);
            continue;
        }
        // D-02 — split on `:` and take the first two segments as the
        // `{resource}:{action}` prefix. Anything else trailing is opaque
        // scope-id and stripped before lookup.
        const segments = p.split(":");
        if (segments.length < 2) {
            invalid.push(p);
            continue;
        }
        const [resource, action] = segments;
        if (
            typeof resource !== "string"
            || resource.length === 0
            || typeof action !== "string"
            || action.length === 0
        ) {
            invalid.push(p);
            continue;
        }
        const actions = cat[resource];
        if (Array.isArray(actions) && actions.includes(action)) {
            valid.push(p);
        } else {
            invalid.push(p);
        }
    }
    return { valid, invalid };
}
