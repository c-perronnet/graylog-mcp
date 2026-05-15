// Structured-intent → Graylog pipeline-rule DSL emitter (D-10/D-11).
//
// Compiles a RuleSpec JSON tree into a syntactically valid rule source
// string. Every embedded literal routes through escape.js so the DSL output
// is always grammar-safe (Threat T-04-01-05: no inline `${value}` template
// interpolation anywhere in this file).
//
// Coverage (per D-11 full DSL coverage decision):
//   - 7 Condition variants: comparison, and, or, not, function_call,
//     has_field, field_ref + literal
//   - 6 Action variants: set_field, remove_field, rename_field,
//     lookup_value, function_call_statement, let_assignment
//
// Output is byte-stable for byte-stable input (no Date.now, no random) —
// snapshot fixtures in downstream plans depend on this invariant.

import { escapeString } from "./escape.js";

/**
 * Emit a structured RuleSpec as a DSL source string.
 *
 * @param {object} spec
 * @param {string} spec.name        rule name (rendered as `rule "<escaped>"`)
 * @param {object} spec.when        Condition expression
 * @param {object[]} spec.then      Action list
 * @returns {string}
 */
export function emitRule({ name, when, then }) {
    const lines = [
        `rule "${escapeString(name)}"`,
        `when`,
        `    ${emitExpr(when)}`,
        `then`,
        ...then.map((a) => `    ${emitAction(a)}`),
        `end`,
    ];
    return lines.join("\n");
}

function emitExpr(node) {
    switch (node.type) {
        case "literal":
            if (typeof node.value === "string") return `"${escapeString(node.value)}"`;
            if (node.value === null) return "null";
            return String(node.value); // numbers, booleans
        case "field_ref": {
            const sourceName = node.source === "message"
                ? "$message"
                : (typeof node.source === "object" && node.source !== null ? node.source.name : null);
            return sourceName ? `${sourceName}.${node.field}` : node.field;
        }
        case "has_field":
            return `has_field("${escapeString(node.field)}")`;
        case "function_call":
            return `${node.name}(${emitArgs(node.args)})`;
        case "comparison":
            return `${emitExpr(node.left)} ${node.op} ${emitExpr(node.right)}`;
        case "and":
            return `(${emitExpr(node.left)} && ${emitExpr(node.right)})`;
        case "or":
            return `(${emitExpr(node.left)} || ${emitExpr(node.right)})`;
        case "not":
            return `! (${emitExpr(node.expr)})`;
        default:
            throw new Error(`emit.js: unknown condition type: ${node.type}`);
    }
}

function emitArgs(args) {
    if (!args) return "";
    if (Array.isArray(args.positional) && args.positional.length > 0) {
        return args.positional.map(emitExpr).join(", ");
    }
    if (args.named && typeof args.named === "object") {
        return Object.entries(args.named)
            .map(([k, v]) => `${k}: ${emitExpr(v)}`)
            .join(", ");
    }
    return "";
}

function emitAction(action) {
    switch (action.type) {
        case "set_field": {
            // Named-args shape: field first (always a string literal routed
            // through escape via {type:"literal"}), value second, plus the
            // optional knobs in canonical order.
            const named = {
                field: { type: "literal", value: action.field },
                value: action.value,
            };
            if (action.message !== undefined) named.message = action.message;
            if (action.default !== undefined) named.default = action.default;
            if (action.clean_field !== undefined) named.clean_field = { type: "literal", value: action.clean_field };
            if (action.prefix !== undefined) named.prefix = { type: "literal", value: action.prefix };
            if (action.suffix !== undefined) named.suffix = { type: "literal", value: action.suffix };
            return `set_field(${emitArgs({ named })});`;
        }
        case "remove_field":
            return `remove_field("${escapeString(action.field)}");`;
        case "rename_field":
            return `rename_field("${escapeString(action.old_field)}", "${escapeString(action.new_field)}");`;
        case "lookup_value": {
            // Sugar: set_field("target", lookup_value(lookup_table: "<table>", key: <expr>, ...));
            const named = {
                lookup_table: { type: "literal", value: action.lookup_table },
                key: action.key,
            };
            if (action.default !== undefined) named.default = action.default;
            return `set_field("${escapeString(action.target_field)}", lookup_value(${emitArgs({ named })}));`;
        }
        case "function_call_statement":
            return `${action.name}(${emitArgs(action.args)});`;
        case "let_assignment":
            return `let ${action.var_name} = ${emitExpr(action.value)};`;
        default:
            throw new Error(`emit.js: unknown action type: ${action.type}`);
    }
}
