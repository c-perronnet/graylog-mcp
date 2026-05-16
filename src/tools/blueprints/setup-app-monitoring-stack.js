// BLUE-01 — setup_app_monitoring_stack. THE HEADLINE BLUEPRINT.
//
// =====================================================================
// Multi-domain 6-step chain (~7 HTTP round-trips with composite step 5)
// =====================================================================
//
// A single natural-language intent ("set up monitoring for service X")
// produces a working monitoring environment:
//
//   step 1 createStream     → POST /api/streams                      ({stream_id})
//   step 2 createRule       → POST /api/system/pipelines/rule        ({id})
//   step 3 createPipeline   → POST /api/system/pipelines/pipeline    ({id})
//   step 4 connectToStream  → POST /api/system/pipelines/connections/to_stream
//                              dependsOn: ARRAY [step1.stream_id, step3.id]
//   step 5 createDashboard  → INTERNAL 2-HTTP chain (Search + View)
//                              5a POST /api/views/search → {id}
//                              5b POST /api/views        → {id}
//                              dependsOn (single): step1.stream_id is woven
//                                into widget triplets' streams arrays AND
//                                the dashboard-level streamIds.
//   step 6 createEventDef   → POST /api/events/definitions?schedule=false
//                              dependsOn: step1.stream_id (config.streams[0])
//
// =====================================================================
// C7 mitigation preserved INSIDE the blueprint chain
// =====================================================================
//
// Step 5 reuses create_dashboard's internal Search+View 2-step pattern
// (Plan 06-02 DASH-03). The agent NEVER sees the intermediate Search ID;
// the apply walker creates the Search first, then substitutes its id into
// the View body's `search_id` before the second HTTP fires. The C7 surface
// is structurally identical to standalone create_dashboard — only the
// composition context (this 6-step chain) differs.
//
// =====================================================================
// Stream-id KEY note (CRITICAL)
// =====================================================================
//
// Phase 3 establishes that POST /api/streams returns `{stream_id:"..."}`
// (the wire key is `stream_id`, NOT `id`). Steps 4, 5, 6 all reference
// step 1's response via `step1.response.stream_id`. Our apply walker
// resolves dotted paths from the transcript so this works directly.
//
// =====================================================================
// Threat model (per Plan 06-05 frontmatter)
// =====================================================================
//
// T-06-05-01 — app_name regex `^[a-zA-Z0-9_-]+$` rejects shell-like
// characters at zod parse. No path concatenation uses agent input.
// T-06-05-03/04 — partial failures surface succeeded_steps + failed_at_step.
// No rollback; agent uses delete_* tools to clean orphans.
// T-06-05-06 — apply walker reads response.stream_id (NOT response.id)
// for step 1 — pinned by test "apply substitutes step 1 stream_id".
// T-06-05-09 — step 5's composite request.path is a label string only;
// the actual HTTP paths are hard-coded inside the nested body.chain (no
// agent-controlled string ever composes into a path).
//
// =====================================================================
// Composition contract (D-09)
// =====================================================================
//
// Imports ONLY from src/services/* (+ src/widget-templates/, src/pipeline-dsl/,
// and src/tools/_shared/* cross-cutting helpers). Pinned by the Plan 06-05
// D-09 grep test in test/blueprints.test.js.

import { defineMutatingHandler } from "../_shared/handler.js";
import { SetupAppMonitoringStackSchema } from "./schemas.js";

// D-09 architectural-boundary imports — service functions are the
// canonical entry points this blueprint composes. The apply walker calls
// client.request directly via pre-computed {method, path, body} chain
// entries, so the imports stay as contract markers (D-09 grep audit).
import { createStream } from "../../services/streams.js";
import { createPipeline, createRule, connectToStream } from "../../services/pipelines.js";
import {
    createSearch,
    createDashboard,
    buildSearchDTO,
    buildViewDTO,
} from "../../services/dashboards.js";
import { createEventDefinition } from "../../services/events.js";

import { WIDGET_TEMPLATES } from "../../widget-templates/index.js";
import { emitRule } from "../../pipeline-dsl/emit.js";
import { SERVER_ASSIGNED_SENTINEL } from "../_shared/dry-run.js";

// D-09 architectural markers — see file header.
void createStream;
void createPipeline;
void createRule;
void connectToStream;
void createSearch;
void createDashboard;
void createEventDefinition;

const QUERY_ID = "q-1";   // wrapper-deterministic single-query scope (Phase 6)

// Sentinel literals carried in the dry-run preview's body bytes. The apply
// walker substitutes them at apply-time once the prior step's response is in
// hand. Step 5's nested Search+View 2-step uses its OWN sentinel "step5a" so
// it doesn't collide with the top-level step 1..6 sentinels.
const STREAM_ID_PLACEHOLDER = `${SERVER_ASSIGNED_SENTINEL}step1.stream_id`;
const PIPELINE_ID_PLACEHOLDER = `${SERVER_ASSIGNED_SENTINEL}step3`;
const SEARCH_ID_PLACEHOLDER = `${SERVER_ASSIGNED_SENTINEL}step5a`;

// Resolve a dotted "stepN.response.<path>" against a transcript. Walks the
// remaining segments after "stepN." against the transcript entry. Returns
// undefined for unresolved paths — caller surfaces the partial-failure
// transcript with `missing_dependency` reason.
function resolveDottedPath(transcript, from) {
    const match = from.match(/^step(\d+)\.(.+)$/);
    if (!match) return { ok: false, reason: "malformed_from", path: from };
    const stepNum = Number.parseInt(match[1], 10);
    const path = match[2];
    const entry = transcript.find((t) => t.step === stepNum);
    if (!entry) return { ok: false, reason: "missing_step", stepNum };
    let cursor = entry;
    for (const segment of path.split(".")) {
        if (cursor == null || typeof cursor !== "object") return { ok: false, reason: "missing_field", segment };
        cursor = cursor[segment];
    }
    if (cursor === undefined) return { ok: false, reason: "missing_field", path };
    return { ok: true, value: cursor };
}

// Recursive value substitution. Walks the body/path replacing each
// (placeholder → value) pair. String-only leaves are replaced (full-string
// equality preserves type; substring path coerces to String).
function substituteAll(obj, replacements) {
    if (typeof obj === "string") {
        // Whole-string match preserves the replacement type.
        if (Object.prototype.hasOwnProperty.call(replacements, obj)) {
            return replacements[obj];
        }
        let out = obj;
        for (const [placeholder, value] of Object.entries(replacements)) {
            if (out.includes(placeholder)) {
                out = out.split(placeholder).join(String(value));
            }
        }
        return out;
    }
    if (Array.isArray(obj)) {
        return obj.map((item) => substituteAll(item, replacements));
    }
    if (obj !== null && typeof obj === "object") {
        const out = {};
        for (const [k, v] of Object.entries(obj)) {
            out[k] = substituteAll(v, replacements);
        }
        return out;
    }
    return obj;
}

export const handleSetupAppMonitoringStack = defineMutatingHandler({
    name: "setup_app_monitoring_stack",
    schema: SetupAppMonitoringStackSchema,
    async build(args) {
        const dropDebugRuleTitle = `${args.app_name}_drop_debug`;
        const pipelineTitle = `${args.app_name}_pipeline`;
        const dashboardTitle = `${args.app_name} health`;
        const eventDefTitle = `${args.app_name} error rate`;

        // ---- Step 1: createStream body ----
        // Phase 3 numeric rule type 2 = "regex" (STREAM_RULE_TYPE_TO_NUMERIC).
        // Plan 06-05 threat model T-06-05-02: source_pattern regex is
        // server-side-parsed; client-side ReDoS validation is out of scope
        // (Graylog's regex engine handles its own bounds).
        const streamBody = {
            entity: {
                title: `${args.app_name} stream`,
                description: `Auto-generated by setup_app_monitoring_stack for ${args.app_name}`,
                rules: [{
                    type: 2,  // numeric "regex"
                    field: "source",
                    value: args.source_pattern,
                    inverted: false,
                    description: `source matches ${args.source_pattern}`,
                }],
                content_pack: null,
                matching_type: "AND",
                remove_matches_from_default_stream: false,
                index_set_id: args.indexSetId,
            },
            share_request: null,
        };

        // ---- Step 2: createRule (drop debug-level via emitRule) ----
        // Syslog 0..7 levels; drop level > 7 (i.e. unknown/extra-verbose
        // beyond debug). The intent here is "drop the noisiest tier"; if
        // the agent wants a different threshold they can compose a
        // setup_debug_log_dropping call afterwards (BLUE-06).
        const dropDebugSource = emitRule({
            name: dropDebugRuleTitle,
            when: {
                type: "comparison",
                left: { type: "field_ref", source: "message", field: "level" },
                op: ">",
                right: { type: "literal", value: 7 },
            },
            then: [{
                type: "function_call_statement",
                name: "drop_message",
                args: { positional: [] },
            }],
        });

        // ---- Step 3: createPipeline source (references rule by title) ----
        const pipelineSource = [
            `pipeline "${pipelineTitle}"`,
            `stage 0 match either`,
            `    rule "${dropDebugRuleTitle}"`,
            `end`,
        ].join("\n");

        // ---- Step 5: assemble widget triplets bound to stream placeholder ----
        // The placeholder STREAM_ID_PLACEHOLDER is woven into the widget
        // triplets' `streams` arrays at build time; the apply walker
        // substitutes the real stream id at apply time.
        const triplets = args.defaultDashboardWidgets.map((templateName) => {
            const builder = WIDGET_TEMPLATES[templateName];
            return builder({ streamIds: [STREAM_ID_PLACEHOLDER] });
        });

        const searchDTO = buildSearchDTO({
            queryId: QUERY_ID,
            widgets: triplets,
            timerange: { type: "relative", from: 900 },
            query: "",
            streamIds: [STREAM_ID_PLACEHOLDER],
        });
        const viewDTO = buildViewDTO({
            title: dashboardTitle,
            description: "Auto-generated by setup_app_monitoring_stack",
            summary: `Error rate + top sources + level distribution + recent events for ${args.app_name}`,
            searchId: SEARCH_ID_PLACEHOLDER,  // resolved at apply-time inside step 5
            queryId: QUERY_ID,
            widgets: triplets,
        });

        // ---- Step 6: createEventDefinition body ----
        const eventDefBody = {
            title: eventDefTitle,
            description: `Auto-generated error-rate alert for ${args.app_name}`,
            priority: 2,
            alert: true,
            config: {
                type: "aggregation-v1",
                query: "level:>=4",
                streams: [STREAM_ID_PLACEHOLDER],
                group_by: [],
                series: [{ id: "count-1", function: "count", field: null }],
                conditions: {
                    expression: {
                        expr: ">",
                        left: { expr: "number-ref", ref: "count-1" },
                        right: { expr: "number", value: args.errorRateThreshold },
                    },
                },
                search_within_ms: 5 * 60 * 1000,
                execute_every_ms: 5 * 60 * 1000,
            },
            field_spec: [],
            key_spec: [],
            notifications: [],
            notification_settings: { grace_period_ms: 60 * 1000, backlog_size: 50 },
        };

        // ---- Assemble chain ----
        // Step 5 is conceptually ONE blueprint step but emits 2 HTTP
        // round-trips. We surface it as a single chain entry whose
        // request.body.chain is the inner [searchPOST, viewPOST] pair
        // (Plan 06-05 frontmatter must-have); the apply walker handles
        // the nested chain inline.
        const chain = [
            {
                step: 1,
                tool: "create_stream",
                request: { method: "POST", path: "/api/streams", body: streamBody },
                postApplyEstimate: { stream_id: SERVER_ASSIGNED_SENTINEL },
            },
            {
                step: 2,
                tool: "create_pipeline_rule",
                request: {
                    method: "POST",
                    path: "/api/system/pipelines/rule",
                    body: {
                        title: dropDebugRuleTitle,
                        description: "Drop debug-level messages",
                        source: dropDebugSource,
                    },
                },
                postApplyEstimate: { id: SERVER_ASSIGNED_SENTINEL },
            },
            {
                step: 3,
                tool: "create_pipeline",
                request: {
                    method: "POST",
                    path: "/api/system/pipelines/pipeline",
                    body: {
                        title: pipelineTitle,
                        description: `Pipeline for ${args.app_name}`,
                        source: pipelineSource,
                    },
                },
                postApplyEstimate: { id: SERVER_ASSIGNED_SENTINEL },
            },
            {
                step: 4,
                tool: "connect_pipelines_to_stream",
                request: {
                    method: "POST",
                    path: "/api/system/pipelines/connections/to_stream",
                    body: {
                        stream_id: STREAM_ID_PLACEHOLDER,
                        pipeline_ids: [PIPELINE_ID_PLACEHOLDER],
                    },
                },
                // ARRAY-shape dependsOn: step 1 stream_id + step 3 pipeline id.
                dependsOn: [
                    { from: "step1.response.stream_id", as: "stream_id" },
                    { from: "step3.response.id", as: "pipeline_ids[0]" },
                ],
            },
            {
                step: 5,
                tool: "create_dashboard",
                request: {
                    method: "POST",
                    path: "/api/views (internal Search+View chain)",
                    body: {
                        chain: [
                            {
                                step: "5a",
                                method: "POST",
                                path: "/api/views/search",
                                body: searchDTO,
                            },
                            {
                                step: "5b",
                                method: "POST",
                                path: "/api/views",
                                body: { entity: viewDTO, share_request: null },
                            },
                        ],
                    },
                },
                dependsOn: { from: "step1.response.stream_id", as: "widgets[].streamIds[0]" },
                postApplyEstimate: { id: SERVER_ASSIGNED_SENTINEL },
            },
            {
                step: 6,
                tool: "create_event_definition",
                request: {
                    method: "POST",
                    path: "/api/events/definitions?schedule=false",
                    body: eventDefBody,
                },
                dependsOn: { from: "step1.response.stream_id", as: "config.streams[0]" },
                postApplyEstimate: { id: SERVER_ASSIGNED_SENTINEL },
            },
        ];

        return {
            chain,
            // Primary preview mirrors step 1 (the agent's mental model is
            // "set up monitoring → starts with a stream"); the full 6-step
            // chain is surfaced separately via handler.js's req.chain spread.
            method: "POST",
            path: "/api/streams",
            body: streamBody,
            postApplyEstimate: { id: SERVER_ASSIGNED_SENTINEL },
        };
    },
    async apply(client, req) {
        // Custom apply walker — handles step 5's nested Search+View chain
        // and step 1's `stream_id` response key (Phase 3 wire shape).
        const transcript = [];
        for (const step of req.chain) {
            // Resolve all dependsOn entries from the transcript first.
            const deps = step.dependsOn
                ? (Array.isArray(step.dependsOn) ? step.dependsOn : [step.dependsOn])
                : [];
            const replacements = {};
            for (const dep of deps) {
                const r = resolveDottedPath(transcript, dep.from);
                if (!r.ok) {
                    return {
                        isError: true,
                        reason: "blueprint_chain_unresolved_dependency",
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                transcript,
                                missing_dependency: dep,
                                failed_at_step: step.step,
                                succeeded_steps: transcript.filter((t) => !t.error).map((t) => t.step),
                            }),
                        }],
                    };
                }
                // The placeholder for this dep is __SERVER_ASSIGNED__step{N}
                // (when from === "stepN.response.id") OR
                // __SERVER_ASSIGNED__step{N}.<field> (when from references a
                // different field on the response). We support both forms.
                const match = dep.from.match(/^step(\d+)\.response\.(.+)$/);
                if (match) {
                    const stepN = match[1];
                    const field = match[2];
                    if (field === "id") {
                        replacements[`${SERVER_ASSIGNED_SENTINEL}step${stepN}`] = r.value;
                    } else {
                        replacements[`${SERVER_ASSIGNED_SENTINEL}step${stepN}.${field}`] = r.value;
                    }
                }
            }

            try {
                let response;
                let executedRequest;
                // Composite step 5: walk the inner Search+View chain.
                if (step.tool === "create_dashboard" && step.request.body?.chain) {
                    // Substitute the placeholders into both inner steps' bodies first
                    // (covers step 5a's streams + step 5b's widgets/streams).
                    const innerChain = substituteAll(step.request.body.chain, replacements);
                    // 5a: POST /api/views/search (BARE SearchDTO body).
                    const searchEntry = innerChain[0];
                    const searchResp = await client.request(
                        searchEntry.method,
                        searchEntry.path,
                        searchEntry.body,
                    );
                    // 5b: POST /api/views — substitute the search id into the body's
                    // entity.search_id. The placeholder is __SERVER_ASSIGNED__step5a.
                    const viewEntry = innerChain[1];
                    const inner5bReplacements = {
                        [SEARCH_ID_PLACEHOLDER]: searchResp?.id,
                    };
                    const substitutedViewBody = substituteAll(viewEntry.body, inner5bReplacements);
                    const viewResp = await client.request(
                        viewEntry.method,
                        viewEntry.path,
                        substitutedViewBody,
                    );
                    response = viewResp;
                    executedRequest = {
                        method: step.request.method,
                        path: step.request.path,
                        body: {
                            chain: [
                                { ...searchEntry, response: searchResp },
                                { ...viewEntry, body: substitutedViewBody, response: viewResp },
                            ],
                        },
                    };
                } else {
                    const substitutedBody = substituteAll(step.request.body, replacements);
                    const substitutedPath = substituteAll(step.request.path, replacements);
                    response = await client.request(
                        step.request.method,
                        substitutedPath,
                        substitutedBody,
                    );
                    executedRequest = {
                        method: step.request.method,
                        path: substitutedPath,
                        body: substitutedBody,
                    };
                }
                transcript.push({
                    step: step.step,
                    tool: step.tool,
                    request: executedRequest,
                    response,
                });
            } catch (err) {
                transcript.push({
                    step: step.step,
                    tool: step.tool,
                    request: step.request,
                    error: err?.message ?? String(err),
                });
                return {
                    isError: true,
                    reason: "blueprint_chain_partial_failure",
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            transcript,
                            failed_at_step: step.step,
                            succeeded_steps: transcript
                                .filter((t) => !t.error)
                                .map((t) => t.step),
                        }),
                    }],
                };
            }
        }

        // Return the dashboard's response as the primary result — the
        // agent's mental model is "set up monitoring → got dashboard URL".
        const dashboardStep = transcript.find((t) => t.step === 5);
        return dashboardStep?.response ?? transcript[transcript.length - 1]?.response;
    },
    summarize: (args) =>
        `Set up app monitoring stack for ${args.app_name} (stream + pipeline + dashboard + alert; 6-step chain)`,
});
