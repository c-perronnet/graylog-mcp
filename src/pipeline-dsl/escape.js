// Pipeline-rule DSL escape helpers (D-12 / D-13). Pure CPU; no I/O.
//
// Defense-in-depth backstop is the server-side parse pre-flight (D-05) —
// every embedded literal in an emitted rule routes through escapeString
// first, AND the wrapper sends the emitted source through
// POST /system/pipelines/rule/parse before any apply.
//
// Character set verified against
// source-code/graylog2-server/.../pipelineprocessor/parser/RuleLang.g4:363-381:
//
//   EscapeSequence
//       :   '\\' [btnfr"'\\]
//       |   OctalEscape
//       |   UnicodeEscape
//       ;
//
// Short-form table covers the named escapes; the fallback emits \uNNNN for
// any other control char (U+0000..U+001F). The output never needs octal
// escapes — only the input parser side does.

const SHORT = {
    0x08: "\\b",
    0x09: "\\t",
    0x0A: "\\n",
    0x0C: "\\f",
    0x0D: "\\r",
    0x22: '\\"',
    0x27: "\\'",
    0x5C: "\\\\",
};

/**
 * Escape a string for embedding inside a DSL double-quoted string literal.
 * Returns the BODY of the literal — caller wraps with quotes (`"..."`).
 *
 * Threat-model T-04-01-03: rejects non-string input with a TypeError whose
 * message contains ONLY the wrong typeof — never the offending value — so
 * PII never leaks via the validation error path.
 *
 * @param {string} s
 * @returns {string}
 */
export function escapeString(s) {
    if (typeof s !== "string") {
        throw new TypeError(`escapeString: expected string, got ${typeof s}`);
    }
    let out = "";
    for (const ch of s) {
        const code = ch.codePointAt(0);
        if (SHORT[code] !== undefined) {
            out += SHORT[code];
            continue;
        }
        if (code < 0x20) {
            out += "\\u" + code.toString(16).padStart(4, "0");
            continue;
        }
        out += ch;
    }
    return out;
}

/**
 * Type-aware DSL literal emission. Wraps strings in double-quotes, emits
 * numbers/booleans bare, emits null as the keyword `null`. Objects, arrays,
 * and undefined are REFUSED — the agent must compose them through structured
 * intent FunctionCall / FieldRef nodes, NOT inline as a JS value.
 *
 * Threat-model T-04-01-05: this is the single chokepoint for ALL literal
 * emission from emit.js — there is no `${value}` template-literal
 * interpolation anywhere else in the DSL emitter.
 *
 * @param {string|number|boolean|null} v
 * @returns {string}
 */
export function escapeValue(v) {
    if (v === null) return "null";
    if (typeof v === "string") return `"${escapeString(v)}"`;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    throw new TypeError(
        `escapeValue: refusing to emit ${typeof v} as a DSL literal — use structured intent FunctionCall / FieldRef instead`,
    );
}
