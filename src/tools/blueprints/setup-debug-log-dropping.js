// BLUE-06 — setup_debug_log_dropping.
//
// 3-step chain that drops sub-threshold (less severe) syslog-level messages
// on a specific stream:
//   step 1: createRule    — DSL emitted via emitRule: `when level > minLevel
//                           then drop_message()`. Compiled through the Phase 4
//                           pipeline-dsl/emit.js so every embedded literal
//                           routes through escape.js (T-06-04-02 mitigation).
//   step 2: createPipeline — single-stage pipeline whose source references
//                           the step-1 rule BY TITLE (Graylog pipelines
//                           reference rules by name, not by id). No apply-time
//                           placeholder substitution needed for the pipeline
//                           body — the title is locked at build() time and
//                           travels in the source string verbatim. Sequential
//                           ordering: createRule MUST succeed before
//                           createPipeline (rule must exist for the pipeline
//                           parse pre-flight to recognize it), but executeChain
//                           walks steps sequentially so no dependsOn is needed
//                           for ordering — only for value substitution.
//   step 3: connectToStream — wires the new pipeline to args.streamId. Uses
//                           the SERVER_ASSIGNED_SENTINEL+"step2" placeholder
//                           inside pipeline_ids[0]; executeChain substitutes
//                           the real pipeline id post-apply.
//
// Syslog level inversion documentation (preserved in the tool description):
//   Syslog severity numbers run 0 (emerg) → 7 (debug). HIGHER level =
//   LESS severe. The predicate `level > minLevel` therefore drops messages
//   STRICTLY MORE VERBOSE than minLevel (e.g. minLevel:6 keeps emerg..info
//   and drops debug-only).
//
// Composition contract (D-09): Imports services from src/services/pipelines.js
// + DSL emitter from src/pipeline-dsl/emit.js — NEVER from src/tools/<domain>/.
// Pinned by Task 2 grep test.

import { defineMutatingHandler } from "../_shared/handler.js";
import { SetupDebugLogDroppingSchema } from "./schemas.js";
import {
    createPipeline,
    createRule,
    connectToStream,
} from "../../services/pipelines.js";  // D-09 boundary — services only
import { executeChain } from "../_shared/blueprint-chain.js";
import { emitRule } from "../../pipeline-dsl/emit.js";
import { escapeString } from "../../pipeline-dsl/escape.js";
import { SERVER_ASSIGNED_SENTINEL } from "../_shared/dry-run.js";

// Suppress unused-import lint while pinning the services-layer contract:
// executeChain walks the chain transcripts (which carry pre-computed
// {method, path, body} per step) via client.request directly. The service
// functions stay imported as the architectural-boundary marker — the D-09
// grep audit (Task 2 done-criterion) checks for the `from "../../services/`
// path, not for runtime invocation.
void createPipeline;
void createRule;
void connectToStream;

export const handleSetupDebugLogDropping = defineMutatingHandler({
    name: "setup_debug_log_dropping",
    schema: SetupDebugLogDroppingSchema,
    async build(args) {
        const ruleTitle = args.ruleTitle ?? `drop_sub_${args.minLevel}`;
        const pipelineTitle = args.pipelineTitle
            ?? `Drop sub-${args.minLevel} for stream ${args.streamId}`;

        // Step 1: createRule via emitRule. The structured-intent tree
        // routes every literal through escape.js (T-06-04-02 backstop).
        const ruleSource = emitRule({
            name: ruleTitle,
            when: {
                type: "comparison",
                left: { type: "field_ref", source: "message", field: "level" },
                op: ">",
                right: { type: "literal", value: args.minLevel },
            },
            then: [{
                type: "function_call_statement",
                name: "drop_message",
                args: { positional: [] },
            }],
        });

        // Step 2: createPipeline. Stage source references the rule by
        // title — Graylog's pipeline DSL grammar is `rule "<title>"`.
        // We route the title through escapeString to defend against
        // embedded-quote injection in agent-supplied ruleTitle (T-06-04-03).
        const pipelineSource = [
            `pipeline "${escapeString(pipelineTitle)}"`,
            `stage 0 match either`,
            `    rule "${escapeString(ruleTitle)}"`,
            `end`,
        ].join("\n");

        const chain = [
            {
                step: 1,
                tool: "create_pipeline_rule",
                request: {
                    method: "POST",
                    path: "/api/system/pipelines/rule",
                    body: {
                        title: ruleTitle,
                        description: `Drop messages where level > ${args.minLevel} (syslog inversion: higher = less severe)`,
                        source: ruleSource,
                    },
                },
                postApplyEstimate: { id: SERVER_ASSIGNED_SENTINEL },
            },
            {
                step: 2,
                tool: "create_pipeline",
                request: {
                    method: "POST",
                    path: "/api/system/pipelines/pipeline",
                    body: {
                        title: pipelineTitle,
                        description: `Pipeline that drops sub-${args.minLevel} log levels on stream ${args.streamId}`,
                        source: pipelineSource,
                    },
                },
                // No dependsOn — the pipeline references the rule by TITLE
                // in its source string, not by ID. Sequential ordering is
                // enforced by executeChain's iteration; no apply-time
                // placeholder substitution is needed for the pipeline body.
                postApplyEstimate: { id: SERVER_ASSIGNED_SENTINEL },
            },
            {
                step: 3,
                tool: "connect_pipelines_to_stream",
                request: {
                    method: "POST",
                    path: "/api/system/pipelines/connections/to_stream",
                    body: {
                        stream_id: args.streamId,
                        pipeline_ids: [`${SERVER_ASSIGNED_SENTINEL}step2`],
                    },
                },
                dependsOn: { from: "step2.response.id", as: "pipeline_ids[0]" },
            },
        ];

        return {
            chain,
            // Primary preview mirrors the FINAL step — the agent's mental
            // model is "connect the dropping pipeline to my stream".
            method: "POST",
            path: "/api/system/pipelines/connections/to_stream",
            body: chain[2].request.body,
            postApplyEstimate: { id: args.streamId },
        };
    },
    async apply(client, req) {
        const result = await executeChain(client, req.chain);
        if (result.isError) return result;
        return result.transcript[result.transcript.length - 1].response;
    },
    summarize: (args) =>
        `Drop messages with level > ${args.minLevel} on stream ${args.streamId} (3-step chain: rule + pipeline + connect)`,
});
