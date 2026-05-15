import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "./snapshot-config.js";

// Pitfall 6 (research § Security Domain): no auth tokens / Authorization headers
// / 32+ char apiToken-like strings / password literals may appear in any snapshot
// fixture file. This test enumerates `test/__snapshots__/*.snapshot` dynamically
// so Phase 1+ snapshots inherit the same guard automatically.
//
// Idempotency-key false positives: deriveIdempotencyKey produces 32-hex-char keys
// that match /[A-Za-z0-9]{32,}/. We allowlist matches whose preceding context is
// the `idempotencyKey` field (the only legitimate 32+ char alphanumeric run in
// the wrapper's emitted JSON). All other matches are treated as potential leaks.
//
// Placeholder-syntax convention (project-wide): values wrapped in a single pair
// of angle brackets — e.g. `<redacted>`, `<value hidden>`, `<encrypted>`, `<*>`
// — are reserved placeholder syntax by project convention. They never represent
// real secrets (a real secret can't contain `<` or `>` and survive a JSON or
// HTTP round-trip without escaping). The password-literal regex is structured
// to NOT match when the captured value has that shape, so the placeholder is
// recognised at the *regex* level rather than allowlisted as a specific string.

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = join(__dirname, "__snapshots__");

// Password-literal regex. The value is captured in group 1 so a structural
// "is this a `<...>` placeholder?" check can be applied without growing a
// string-level allowlist. The character class `[^"'<>]+` inside the captured
// value rejects values containing angle brackets at the regex level — the
// match simply fails to fire when the value is a placeholder like
// `"password": "<redacted>"`. Real secrets (32+ char tokens, dictionary
// words, anything non-empty without angle brackets) still trip the lint.
const PASSWORD_LITERAL = /password['"]?\s*[:=]\s*['"]([^"'<>]+)['"]/i;

const DENY_PATTERNS = [
    { name: "Authorization header", regex: /Authorization/i },
    { name: "32+ char alphanumeric (apiToken-like)", regex: /[A-Za-z0-9]{32,}/ },
    { name: "password literal with value", regex: PASSWORD_LITERAL },
];

/**
 * Context-aware allowlist (narrow, surface-specific):
 *   1. A 32+ char alphanumeric match is allowed iff the surrounding text
 *      identifies it as an idempotencyKey field value.
 *   2. A 32+ char alphanumeric match is allowed iff the surrounding text
 *      identifies it as a confirmationToken field value (Plan 02-03 / D-01).
 *      The 64-hex confirmationToken is a content-hash of public state
 *      ({ indexSetId, deleteIndices, sorted indexNames, messageCount }) —
 *      NOT a secret. Snapshotting it is intentional drift detection for
 *      C1 canonicalization. The agent ECHOES the token back to apply a
 *      delete_index_set with deleteIndices:true; it is not credential
 *      material and cannot grant any capability that a re-issued dry-run
 *      wouldn't issue again.
 *
 * The password-literal pattern is narrowed at the *regex* level (see
 * PASSWORD_LITERAL above) so placeholder syntax like `<redacted>` never
 * matches in the first place. No string-level allowlist is needed for that
 * surface — and adding one would broaden the safe set globally.
 */
function isAllowedMatch(content, match, regex, matchIndex) {
    if (regex.source === /[A-Za-z0-9]{32,}/.source) {
        const context = content.slice(Math.max(0, matchIndex - 40), matchIndex);
        // Match the JSON-stringified shape: `"idempotencyKey": "<32 hex>"`
        // (with optional whitespace and the colon/equals separator).
        if (/idempotencyKey['"]?\s*[:=]\s*['"]?$/.test(context)) return true;
        // Plan 02-05: 64-hex confirmationToken (D-01) is a sha-256 over public
        // state, not a secret. Mirrors the idempotencyKey context check above.
        if (/confirmationToken['"]?\s*[:=]\s*['"]?$/.test(context)) return true;
    }
    return false;
}

test("no snapshot fixture contains Authorization header, apiToken-like strings, or password literals", () => {
    let entries;
    try {
        entries = readdirSync(SNAPSHOTS_DIR);
    } catch (err) {
        // Directory doesn't exist yet — nothing to scan. The test re-runs on
        // every npm test invocation; once snapshots land, scanning begins.
        return;
    }

    const snapshotFiles = entries.filter((name) => name.endsWith(".snapshot"));
    const violations = [];

    for (const file of snapshotFiles) {
        const fullPath = join(SNAPSHOTS_DIR, file);
        if (!statSync(fullPath).isFile()) continue;
        const content = readFileSync(fullPath, "utf8");
        for (const { name, regex } of DENY_PATTERNS) {
            const flags = regex.flags.includes("g") ? regex.flags : regex.flags + "g";
            const globalRegex = new RegExp(regex.source, flags);
            let m;
            while ((m = globalRegex.exec(content)) !== null) {
                if (!isAllowedMatch(content, m[0], regex, m.index)) {
                    violations.push(`${file}: matches "${name}" → "${m[0].slice(0, 60)}..."`);
                }
            }
        }
    }

    assert.equal(
        violations.length,
        0,
        `Auth-redaction violations:\n${violations.join("\n")}`
    );
});
