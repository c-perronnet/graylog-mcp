// Plan 05-01 Task 2 — v6→v7 aggregation-condition migrator (D-03/D-04 / C5).
//
// What changed in Graylog 7.1 (pr-24703, commit 502cd61f87): the runtime
// emit-key for aggregation_conditions on event-fire changed from
//   series.literal()  →  count(source)
// to
//   function_field    →  count_source
//
// Agents whose mental model still emits the v6 shape inside
// `definition.config.conditions.expression` will save the event definition
// successfully but the alert never fires on 7.0.6+ because the
// `conditions.expression`'s `number-ref` doesn't match the emitted key shape.
// D-03 / D-04 mitigate by detecting the v6 shape on input and migrating to
// v7 with a VISIBLE warning surfaced through the wrapper's dry-run output —
// never silent. See 05-RESEARCH.md §"Pattern 2: v6→v7 Aggregation Migration"
// for the source-walk rationale (Count.java + Sum.java + ... TYPE_NAME).
//
// Threat-model T-05-01-02: V6_FUNCTION_NAMES is a frozen 8-name Set; open
// string-match would mis-migrate `counter` / `summary` / `averaged` agent
// inputs and silently rewrite them to v7 shapes that don't exist server-side.

/**
 * Closed-set 8-name catalogue of v6 aggregation function names. Drawn from
 * source-code/.../pivot/series/{Count,Sum,Average,Min,Max,StdDev,Percentile,
 * Cardinality}.java TYPE_NAME constants. Adding a 9th function name is a
 * deliberate forward-compatibility step that requires updating Plan 05's
 * RESEARCH.md migration table; the closed set IS the threat-model anchor.
 *
 * @type {Readonly<Set<string>>}
 */
export const V6_FUNCTION_NAMES = Object.freeze(new Set([
    "count",
    "sum",
    "avg",
    "min",
    "max",
    "stddev",
    "percentile",
    "card",
]));

/**
 * Detect v6 aggregation-condition function nodes inside a single Expr tree
 * node. Returns true ONLY if every constraint matches:
 *
 *   - node.type === "function"
 *   - node.function is a string in the 8-name closed set
 *   - node.parameter is a string (may be empty; emission rule below)
 *
 * @param {unknown} node
 * @returns {boolean}
 */
function isV6FunctionNode(node) {
    return (
        node !== null
        && typeof node === "object"
        && node.type === "function"
        && typeof node.function === "string"
        && V6_FUNCTION_NAMES.has(node.function)
        && typeof node.parameter === "string"
    );
}

/**
 * Compose the v7 underscored key from a detected v6 node.
 *
 *   {function:"count", parameter:"source"}  →  "count_source"
 *   {function:"count", parameter:""}        →  "count"
 *
 * The empty-parameter case mirrors Count.java's `Count(<no field>)` default.
 *
 * @param {{function: string, parameter: string}} node
 * @returns {string}
 */
function v7KeyFor(node) {
    return node.parameter ? `${node.function}_${node.parameter}` : node.function;
}

/**
 * Recursively visit an Expr tree, rewriting v6 function nodes into v7
 * number-ref nodes and collecting warnings as a side-effect into the
 * supplied accumulator.
 *
 * Recurses into `left`, `right`, and `child` (covering Expr.And, Expr.Or,
 * Expr.Not, Expr.Comparison; the boolean-literal `true`/`false` leaves
 * have neither). A node without any of those slots is returned unchanged.
 *
 * @param {unknown} node
 * @param {Array<{migrated_from_v6_shape: true, original: object, emitted: string}>} warnings
 * @returns {unknown}
 */
function visit(node, warnings) {
    if (isV6FunctionNode(node)) {
        const emitted = v7KeyFor(node);
        warnings.push({
            migrated_from_v6_shape: true,
            original: { ...node },
            emitted,
        });
        return { type: "number-ref", ref: emitted };
    }
    if (node === null || typeof node !== "object") return node;
    if (node.left !== undefined || node.right !== undefined || node.child !== undefined) {
        return {
            ...node,
            ...(node.left !== undefined ? { left: visit(node.left, warnings) } : {}),
            ...(node.right !== undefined ? { right: visit(node.right, warnings) } : {}),
            ...(node.child !== undefined ? { child: visit(node.child, warnings) } : {}),
        };
    }
    return node;
}

/**
 * Detect v6 aggregation-condition shapes inside a definition DTO and rewrite
 * to v7 shapes, surfacing every migration as a structured warning. Pure
 * function — does not mutate the input.
 *
 * Migration is VISIBLE: the warnings array is emitted in the wrapper's
 * dry-run output so the agent sees exactly which nodes were rewritten and
 * what the new keys are. Silent migration would defeat the M1/C5 mitigation
 * trust contract.
 *
 * No-op safety: a v7-shape input (no nodes match the v6 detector) returns
 * `{migrated: false, dto: <input verbatim>, warnings: []}`.
 *
 * @param {object} definitionDto  event-definition DTO; reads
 *   `config.conditions.expression` recursively. All other fields untouched.
 * @returns {{
 *   migrated: boolean,
 *   dto: object,
 *   warnings: Array<{migrated_from_v6_shape: true, original: object, emitted: string}>
 * }}
 */
export function migrateV6ToV7AggregationConditions(definitionDto) {
    const expr = definitionDto?.config?.conditions?.expression;
    if (expr === undefined || expr === null) {
        return { migrated: false, dto: definitionDto, warnings: [] };
    }
    const warnings = [];
    const migratedExpr = visit(expr, warnings);
    const migrated = warnings.length > 0;
    if (!migrated) {
        return { migrated: false, dto: definitionDto, warnings: [] };
    }
    return {
        migrated: true,
        dto: {
            ...definitionDto,
            config: {
                ...definitionDto.config,
                conditions: {
                    ...definitionDto.config.conditions,
                    expression: migratedExpr,
                },
            },
        },
        warnings,
    };
}
