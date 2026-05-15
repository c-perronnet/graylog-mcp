// PIPE-09 — update_pipeline_rule. PUT /api/system/pipelines/rule/{id}.
//
// U1 smoke RESULT (04-U1-SMOKE.md): UNREACHABLE_STRICT_NO_ECHO — defaults to
// STRICT_NO_ECHO per Phase 3 + Plan 04-02 precedent. Rules' Nullable String
// `simulator_message` particularly benefits from STRICT_NO_ECHO's disambiguation:
//   - omit → server-side no-op
//   - explicit null → clear the field
//   - explicit string → set the field
// A merge-from-current approach would conflate omission and null.
//
// STRICT_NO_ECHO contract: the wire body emits ONLY the fields present in
// args.changes. The conditional-spread pattern preserves agent intent.
//
// D-05 parse pre-flight fires ONLY when args.changes.structured OR
// args.changes.ruleSource is set — description/simulator_message-only updates
// skip the parse round-trip. parseResult is OMITTED from the descriptor when
// source isn't touched (keeps the preview JSON lean).
//
// D-15 generalisation: NO mutable defense-in-depth (rules carry no
// is_editable field on the wire — verified RuleSource.java). The Phase 0
// writable-flag gate (D-07) is the sole safety gate at the connection level.
//
// preflightParseRule is imported from create-pipeline-rule.js — single
// source of truth for the reason name + Pitfall 6 translation. Adding new
// consumers cannot drift on field-name casing.

import { defineMutatingHandler } from "../_shared/handler.js";
import { UpdatePipelineRuleSchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { GraylogValidationError } from "../../graylog/errors.js";
import { preflightParseRule } from "./create-pipeline-rule.js";
import { emitRule } from "../../pipeline-dsl/emit.js";
import { validateRuleSource } from "../../pipeline-dsl/validate.js";
import { getMergedCatalogue } from "../../pipeline-dsl/function-catalogue.js";
import { toIdBody } from "../../graylog/normalize.js";

export const handleUpdatePipelineRule = defineMutatingHandler({
    name: "update_pipeline_rule",
    schema: UpdatePipelineRuleSchema,
    async build(args) {
        const client = makeClient(args._conn);
        const path = `/api/system/pipelines/rule/${args.ruleId}`;   // Pitfall 3 rule variant

        // Pre-flight GET current rule (404 surfaces as MCP error envelope via
        // wrapGraylogError; D-15 generalisation: NO mutable check on the response).
        await client.request("GET", path, null);

        // Resolve effective new source if structured OR ruleSource was touched.
        let newSource;
        if (args.changes.structured) {
            newSource = emitRule(args.changes.structured);
        } else if (args.changes.ruleSource) {
            newSource = args.changes.ruleSource;
        }

        // Client-side lint (D-04) + server parse pre-flight (D-05) — ONLY
        // when source is touched. Cosmetic edits (description /
        // simulator_message) skip both round-trips entirely; the function-
        // catalogue is also NOT fetched in that case (cache miss avoided).
        let parseResult;
        if (newSource !== undefined) {
            const catalogue = await getMergedCatalogue(args._connectionName, args._conn);
            const lintResult = validateRuleSource(newSource, catalogue);
            if (lintResult.errors.length > 0) {
                const err = new GraylogValidationError(
                    `Client-side rule validation failed: ${lintResult.errors.map(
                        (e) => `${e.type}: ${e.message}`,
                    ).join("; ")}`,
                    { status: 400, method: "PUT", path },
                );
                err.reason = "rule_validation_failed";
                err.lintErrors = lintResult.errors;
                throw err;
            }
            // Throws GraylogValidationError(reason:"rule_parse_failed") on 400;
            // handler.js routes through wrapGraylogError and apply NEVER runs.
            parseResult = await preflightParseRule(client, newSource);
        }

        // STRICT_NO_ECHO wire body — emit ONLY the fields the agent touched.
        // simulator_message handling:
        //   - undefined → omit from wire body (server-side no-op)
        //   - null      → wire-emit { simulator_message: null } (explicit clear)
        //   - string    → wire-emit the string
        // The same omit-vs-explicit-null pattern applies to description.
        const wireBody = {
            ...(newSource !== undefined ? { source: newSource } : {}),
            ...(args.changes.description !== undefined ? { description: args.changes.description } : {}),
            ...(args.changes.simulator_message !== undefined
                ? { simulator_message: args.changes.simulator_message }
                : {}),
        };

        return {
            method: "PUT",
            path,
            body: wireBody,
            ...(parseResult ? { parseResult } : {}),    // OMIT key when source wasn't touched
            postApplyEstimate: { id: args.ruleId },
            normalize: (raw) => toIdBody(raw, { idFields: ["id"] }),
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        `Update pipeline rule ${args.ruleId} (${Object.keys(args.changes).length} change(s))`,
});
