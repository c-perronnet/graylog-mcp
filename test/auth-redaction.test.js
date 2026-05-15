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

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = join(__dirname, "__snapshots__");

const DENY_PATTERNS = [
    { name: "Authorization header", regex: /Authorization/i },
    { name: "32+ char alphanumeric (apiToken-like)", regex: /[A-Za-z0-9]{32,}/ },
    { name: "password literal with value", regex: /password['"]?\s*[:=]\s*['"][^'"]+['"]/i },
];

/**
 * Context-aware allowlist: a 32+ char alphanumeric match is allowed iff the
 * surrounding text identifies it as an idempotencyKey field value.
 */
function isAllowedMatch(content, match, regex, matchIndex) {
    if (regex.source === /[A-Za-z0-9]{32,}/.source) {
        const context = content.slice(Math.max(0, matchIndex - 40), matchIndex);
        // Match the JSON-stringified shape: `"idempotencyKey": "<32 hex>"`
        // (with optional whitespace and the colon/equals separator).
        if (/idempotencyKey['"]?\s*[:=]\s*['"]?$/.test(context)) return true;
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
