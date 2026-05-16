// Client-side validator for pipeline-rule DSL source (D-04).
//
// CONSUMES the MERGED Map from function-catalogue.js — NOT the raw
// staticBuiltins array. Pitfall 5 (RESEARCH §"Pitfall 5: Hand-curated
// builtins.js drifts"): a live-only function name introduced by a newer
// Graylog version MUST validate. If we read from staticBuiltins, Graylog
// 7.2.x's new functions would false-fail before the parse pre-flight runs.
//
// Strictness: function-name + paren-balance ONLY. Arg-count validation is
// OUT OF SCOPE for this phase (warning-only per RESEARCH Open Question #2 —
// server parse pre-flight is the authoritative gate; this lint is
// informational and runs BEFORE the network round-trip to give the agent a
// fast-path rejection on obvious typos like `toUpperCase` for `uppercase`).

const RESERVED = new Set(["if", "true", "false", "null"]);

// `\b([a-z_][a-z0-9_]*)\s*\(` — captures a function-call shape. Skips
// reserved keywords + bare identifiers (they don't have a following paren).
// Case-insensitive so camelCase typos like `toUpperCase` are captured for
// flagging.
//
// Pattern is a literal here (not module-scoped state), so callers always get
// a fresh regex with `lastIndex: 0` — safe under any future async or
// concurrent caller.
const FN_PATTERN_SRC = "\\b([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\(";

/**
 * Validate a pipeline-rule DSL source string against the MERGED function
 * catalogue. Returns `{ errors, warnings }` — never throws.
 *
 * @param {string} source              raw rule DSL
 * @param {Map<string, object>} mergedCatalogue   merged-catalogue Map from
 *                                                function-catalogue.js
 * @returns {{ errors: object[], warnings: object[] }}
 */
export function validateRuleSource(source, mergedCatalogue) {
    const errors = [];
    const warnings = [];

    if (typeof source !== "string" || source.length === 0) {
        warnings.push({ type: "empty_source", message: "rule source is empty" });
        return { errors, warnings };
    }

    // String-aware paren balance. Parens inside DSL string literals must NOT
    // count toward balance — `then set_field("y", "hello (world)")` is valid
    // even though the literal contains an unbalanced ")". RuleLang.g4 uses
    // double-quoted strings with `\` as the escape character.
    let parens = 0;
    let firstUnbalancedClose = -1;
    let inString = false;
    let escape = false;
    for (let i = 0; i < source.length; i += 1) {
        const ch = source[i];
        if (inString) {
            if (escape) {
                escape = false;
            } else if (ch === "\\") {
                escape = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === "(") parens += 1;
        else if (ch === ")") {
            parens -= 1;
            if (parens < 0 && firstUnbalancedClose < 0) {
                firstUnbalancedClose = i;
            }
        }
    }
    if (firstUnbalancedClose >= 0) {
        errors.push({
            type: "paren_imbalance",
            message: `unbalanced ) at offset ${firstUnbalancedClose}`,
            offset: firstUnbalancedClose,
        });
    } else if (parens > 0) {
        errors.push({
            type: "paren_imbalance",
            message: `${parens} unmatched (`,
        });
    }

    // Function-name lint. Skip reserved keywords (`if`, `true`, `false`,
    // `null`) — they look like function calls but are grammar productions.
    // The Graylog grammar's own reserved set `rule|when|then|end|let` never
    // appears followed by `(` so they fall through the regex naturally.
    //
    // Fresh local regex per call so stateful `lastIndex` can never leak
    // across async or concurrent calls.
    const fnPattern = new RegExp(FN_PATTERN_SRC, "g");
    let m;
    while ((m = fnPattern.exec(source)) !== null) {
        const name = m[1];
        if (RESERVED.has(name)) continue;
        if (!mergedCatalogue.has(name)) {
            errors.push({
                type: "unknown_function",
                message: `unknown function "${name}" (not in merged catalogue) at offset ${m.index}`,
                name,
                offset: m.index,
            });
        }
    }

    return { errors, warnings };
}
