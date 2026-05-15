// Idempotency-key derivation (FOUND-10 + PITFALLS.md M4).
//
// Every mutating handler auto-derives a 32-hex-char sha-256-truncated key from
// { connectionName, toolName, canonical(args) } when the caller hasn't supplied one.
// The canonical form sorts object keys recursively, drops `dryRun` and
// `idempotencyKey` from the projection (so previewing vs applying doesn't change
// the key), and drops undefined values. Arrays preserve order — a stream-rule
// list semantically depends on ordering, so canonicalisation must not sort it.
//
// Client-side only: Graylog 7.x does not honour an Idempotency-Key HTTP header
// (verified by source scan in RESEARCH.md). The MCP wrapper exposes the key
// to the agent for retry-window dedupe and embeds it in description tags like
// "[mcp:idem:abc123]" when domain phases opt in.

import { createHash } from "node:crypto";

/**
 * Canonical args projection: recursive sort, drop excluded fields, drop undefined.
 * Exported with a leading underscore per project convention (test-only access).
 * @param {unknown} value
 * @param {{ exclude?: string[] }} [opts]
 * @returns {unknown}
 */
export function _canonicalize(value, { exclude = ["dryRun", "idempotencyKey"] } = {}) {
    if (Array.isArray(value)) {
        return value.map((v) => _canonicalize(v, { exclude }));
    }
    if (value && typeof value === "object") {
        const out = {};
        for (const key of Object.keys(value).sort()) {
            if (exclude.includes(key)) continue;
            if (value[key] === undefined) continue;
            out[key] = _canonicalize(value[key], { exclude });
        }
        return out;
    }
    return value;
}

/**
 * Deterministic 32-hex-char sha-256-truncated idempotency key.
 * @param {{ connectionName: string, toolName: string, args: object }} input
 * @returns {string}
 */
export function deriveIdempotencyKey({ connectionName, toolName, args }) {
    const material = JSON.stringify({
        connectionName,
        toolName,
        args: _canonicalize(args),
    });
    return createHash("sha256").update(material).digest("hex").slice(0, 32);
}
