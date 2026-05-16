import { test } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";

// Pitfall 3: zod ↔ JSON-Schema drift detection scaffold.
//
// Phase 0 ships NO mutating tools — Phase 0 baseline only asserts that the
// shared base schemas (`mutatingBase`, `listBase`) exist and expose the
// documented shape keys. Any later edit to these bases that drops a key is
// caught immediately.
//
// Phase 1 enrichment (Plan 01-05): the `assertSchemaParityForTool` helper is
// uncommented and parameterised for all 12 net-new Phase 1 tools. Drift between
// the zod schema's keys and the src/tools.js JSON-Schema `properties` keys
// fails the test loudly. Fix-direction is always one-way: align src/tools.js
// to match zod (never the reverse — zod is the source of truth for runtime
// validation). See 01-05-PLAN.md Task 2 for the rationale.

// Phase 0 baseline tests (kept):
test("schema-parity baseline: mutatingBase exposes expected shape keys", async () => {
    const { mutatingBase } = await import("../src/tools/_shared/schemas.js");
    const keys = Object.keys(mutatingBase.shape).sort();
    assert.deepEqual(keys, ["connectionName", "dryRun", "idempotencyKey"]);
});

test("schema-parity baseline: listBase exposes expected shape keys", async () => {
    const { listBase } = await import("../src/tools/_shared/schemas.js");
    const keys = Object.keys(listBase.shape).sort();
    assert.deepEqual(keys, ["connectionName", "fields", "limit"]);
});

// ---------------------------------------------------------------------------
// Phase 1 enrichment — 12 tools × parity assertion
//
// Note on superRefine: zod's `.superRefine()` wraps the inner ZodObject in a
// ZodEffects, hiding the `.shape` property. `getShape` handles both shapes so
// CreateInputSchema and CreateExtractorSchema (which use superRefine for
// variant dispatch) are parity-checkable without exporting their inner shapes
// as additional symbols.
// ---------------------------------------------------------------------------

function getShape(zodSchema) {
    // Handle ZodEffects (superRefine wraps the inner object).
    if (zodSchema._def?.schema?.shape) return zodSchema._def.schema.shape;
    return zodSchema.shape;
}

async function assertSchemaParityForTool(toolName, zodSchema) {
    const { toolDefinitions } = await import("../src/tools.js");
    const tool = toolDefinitions.find((t) => t.name === toolName);
    assert.ok(tool, `Tool ${toolName} missing from tools.js`);
    const jsonSchemaKeys = Object.keys(tool.inputSchema.properties).sort();
    const zodKeys = Object.keys(getShape(zodSchema)).sort();
    assert.deepEqual(
        jsonSchemaKeys,
        zodKeys,
        `Schema drift in ${toolName}: JSON-Schema [${jsonSchemaKeys.join(",")}] vs zod [${zodKeys.join(",")}]`,
    );
}

test("schema-parity: list_input_types", async () => {
    const { ListInputTypesSchema } = await import("../src/tools/inputs/schemas.js");
    await assertSchemaParityForTool("list_input_types", ListInputTypesSchema);
});

test("schema-parity: list_inputs", async () => {
    const { ListInputsSchema } = await import("../src/tools/inputs/schemas.js");
    await assertSchemaParityForTool("list_inputs", ListInputsSchema);
});

test("schema-parity: get_input", async () => {
    const { GetInputSchema } = await import("../src/tools/inputs/schemas.js");
    await assertSchemaParityForTool("get_input", GetInputSchema);
});

test("schema-parity: create_input", async () => {
    const { CreateInputSchema } = await import("../src/tools/inputs/schemas.js");
    await assertSchemaParityForTool("create_input", CreateInputSchema);
});

test("schema-parity: update_input", async () => {
    const { UpdateInputSchema } = await import("../src/tools/inputs/schemas.js");
    await assertSchemaParityForTool("update_input", UpdateInputSchema);
});

test("schema-parity: delete_input", async () => {
    const { DeleteInputSchema } = await import("../src/tools/inputs/schemas.js");
    await assertSchemaParityForTool("delete_input", DeleteInputSchema);
});

test("schema-parity: start_input", async () => {
    const { StartInputSchema } = await import("../src/tools/inputs/schemas.js");
    await assertSchemaParityForTool("start_input", StartInputSchema);
});

test("schema-parity: stop_input", async () => {
    const { StopInputSchema } = await import("../src/tools/inputs/schemas.js");
    await assertSchemaParityForTool("stop_input", StopInputSchema);
});

test("schema-parity: list_extractors", async () => {
    const { ListExtractorsSchema } = await import("../src/tools/inputs/schemas.js");
    await assertSchemaParityForTool("list_extractors", ListExtractorsSchema);
});

test("schema-parity: create_extractor", async () => {
    const { CreateExtractorSchema } = await import("../src/tools/inputs/schemas.js");
    await assertSchemaParityForTool("create_extractor", CreateExtractorSchema);
});

test("schema-parity: update_extractor", async () => {
    const { UpdateExtractorSchema } = await import("../src/tools/inputs/schemas.js");
    await assertSchemaParityForTool("update_extractor", UpdateExtractorSchema);
});

test("schema-parity: delete_extractor", async () => {
    const { DeleteExtractorSchema } = await import("../src/tools/inputs/schemas.js");
    await assertSchemaParityForTool("delete_extractor", DeleteExtractorSchema);
});

// ---------------------------------------------------------------------------
// Plan 02-01 enrichment — 3 new tools (list/get/await)
//
// list_index_sets + get_index_set use plain ZodObject; await_system_job uses
// mutatingBase.extend(...).refine(...) which wraps the inner object in a
// ZodEffects. getShape handles both shapes.
// ---------------------------------------------------------------------------

test("schema-parity: list_index_sets", async () => {
    const { ListIndexSetsSchema } = await import("../src/tools/index-sets/schemas.js");
    await assertSchemaParityForTool("list_index_sets", ListIndexSetsSchema);
});

test("schema-parity: get_index_set", async () => {
    const { GetIndexSetSchema } = await import("../src/tools/index-sets/schemas.js");
    await assertSchemaParityForTool("get_index_set", GetIndexSetSchema);
});

test("schema-parity: await_system_job", async () => {
    const { AwaitSystemJobSchema } = await import("../src/tools/_shared/system-job.js");
    await assertSchemaParityForTool("await_system_job", AwaitSystemJobSchema);
});

// ---------------------------------------------------------------------------
// Plan 02-02 enrichment — 2 new mutating tools (create + update index_set)
//
// CreateIndexSetSchema uses .superRefine() (per-alias variant narrow), and
// UpdateIndexSetSchema uses .superRefine() at the `changes` level. The
// existing getShape helper handles ZodEffects via _def.schema.shape, so both
// schemas are parity-checkable.
// ---------------------------------------------------------------------------

test("schema-parity: create_index_set", async () => {
    const { CreateIndexSetSchema } = await import("../src/tools/index-sets/schemas.js");
    await assertSchemaParityForTool("create_index_set", CreateIndexSetSchema);
});

test("schema-parity: update_index_set", async () => {
    const { UpdateIndexSetSchema } = await import("../src/tools/index-sets/schemas.js");
    await assertSchemaParityForTool("update_index_set", UpdateIndexSetSchema);
});

// ---------------------------------------------------------------------------
// Plan 02-03 enrichment — delete_index_set (INDEX-05; C1 mitigation centerpiece)
//
// DeleteIndexSetSchema = mutatingBase.extend({ indexSetId, deleteIndices, confirm }).
// No superRefine wrap so .shape is direct; getShape still works.
// ---------------------------------------------------------------------------

test("schema-parity: delete_index_set", async () => {
    const { DeleteIndexSetSchema } = await import("../src/tools/index-sets/schemas.js");
    await assertSchemaParityForTool("delete_index_set", DeleteIndexSetSchema);
});

// ---------------------------------------------------------------------------
// Plan 02-04 enrichment — set_default_index_set (INDEX-06) + cycle_deflector (INDEX-07)
//
// Both schemas are plain mutatingBase.extend({ indexSetId }) — no superRefine
// wrap so .shape is direct.
// ---------------------------------------------------------------------------

test("schema-parity: set_default_index_set", async () => {
    const { SetDefaultIndexSetSchema } = await import("../src/tools/index-sets/schemas.js");
    await assertSchemaParityForTool("set_default_index_set", SetDefaultIndexSetSchema);
});

test("schema-parity: cycle_deflector", async () => {
    const { CycleDeflectorSchema } = await import("../src/tools/index-sets/schemas.js");
    await assertSchemaParityForTool("cycle_deflector", CycleDeflectorSchema);
});

// ---------------------------------------------------------------------------
// Plan 03-01 enrichment — 3 new read tools (list_streams, get_stream,
// list_stream_rules). All three schemas use plain ZodObject (no superRefine
// wrap) so .shape is direct; getShape handles them without extra plumbing.
// ---------------------------------------------------------------------------

test("schema-parity: list_streams", async () => {
    const { ListStreamsSchema } = await import("../src/tools/streams/schemas.js");
    await assertSchemaParityForTool("list_streams", ListStreamsSchema);
});

test("schema-parity: get_stream", async () => {
    const { GetStreamSchema } = await import("../src/tools/streams/schemas.js");
    await assertSchemaParityForTool("get_stream", GetStreamSchema);
});

test("schema-parity: list_stream_rules", async () => {
    const { ListStreamRulesSchema } = await import("../src/tools/streams/schemas.js");
    await assertSchemaParityForTool("list_stream_rules", ListStreamRulesSchema);
});

// ---------------------------------------------------------------------------
// Plan 03-02 enrichment — 4 new mutating tools (create_stream, update_stream,
// start_stream, pause_stream). All four schemas are plain mutatingBase.extend()
// without superRefine wrapping so .shape is direct; getShape handles them
// without extra plumbing.
// ---------------------------------------------------------------------------

test("schema-parity: create_stream", async () => {
    const { CreateStreamSchema } = await import("../src/tools/streams/schemas.js");
    await assertSchemaParityForTool("create_stream", CreateStreamSchema);
});

test("schema-parity: update_stream", async () => {
    const { UpdateStreamSchema } = await import("../src/tools/streams/schemas.js");
    await assertSchemaParityForTool("update_stream", UpdateStreamSchema);
});

test("schema-parity: start_stream", async () => {
    const { StartStreamSchema } = await import("../src/tools/streams/schemas.js");
    await assertSchemaParityForTool("start_stream", StartStreamSchema);
});

test("schema-parity: pause_stream", async () => {
    const { PauseStreamSchema } = await import("../src/tools/streams/schemas.js");
    await assertSchemaParityForTool("pause_stream", PauseStreamSchema);
});

// ---------------------------------------------------------------------------
// Plan 03-03 enrichment — delete_stream (STREAM-05; C2 mitigation centerpiece)
//
// DeleteStreamSchema = mutatingBase.extend({ streamId, confirm? }). No
// superRefine wrap so .shape is direct; getShape handles it without extra
// plumbing.
// ---------------------------------------------------------------------------

test("schema-parity: delete_stream", async () => {
    const { DeleteStreamSchema } = await import("../src/tools/streams/schemas.js");
    await assertSchemaParityForTool("delete_stream", DeleteStreamSchema);
});

// ---------------------------------------------------------------------------
// Plan 03-04 enrichment — stream-rule CRUD + test_stream_match (4 tools).
//
// CreateStreamRuleSchema is a `mutatingBase.extend({ streamId }).and(StreamRuleSchema)`
// — z.intersection wraps the parent base shape with the 8-variant discriminated
// union. The intersection's _def.left holds the mutatingBase-extended shape
// (`connectionName, dryRun, idempotencyKey, streamId`) which is the agent-facing
// outer shape for JSON-Schema parity. The discriminated-union variant fields
// (type, field, value, inverted, description) are documented inline in the
// inputSchema description rather than the properties map — same precedent as
// create_input / create_extractor where the discriminator-narrowed fields live
// in the `inputs` array description, not as flat schema properties. The parity
// helper compares against the outer mutatingBase shape.
// ---------------------------------------------------------------------------

test("schema-parity: create_stream_rule", async () => {
    const { CreateStreamRuleSchema } = await import("../src/tools/streams/schemas.js");
    // CreateStreamRuleSchema is z.intersection (a `.and()` result). Pull
    // the outer mutatingBase-extended shape from `_def.left`.
    const outerShape = CreateStreamRuleSchema._def?.left?.shape;
    assert.ok(outerShape, "CreateStreamRuleSchema must expose its outer (mutatingBase) shape via _def.left.shape");
    const { toolDefinitions } = await import("../src/tools.js");
    const tool = toolDefinitions.find((t) => t.name === "create_stream_rule");
    assert.ok(tool, "Tool create_stream_rule missing from tools.js");
    const jsonSchemaKeys = Object.keys(tool.inputSchema.properties).sort();
    const outerKeys = Object.keys(outerShape).sort();
    // JSON-Schema MUST include every outer key (mutatingBase + streamId). The
    // JSON-Schema typically also documents the discriminator fields (type, field,
    // value, inverted, description) for agent ergonomics; allow superset there.
    for (const k of outerKeys) {
        assert.ok(
            jsonSchemaKeys.includes(k),
            `Schema drift in create_stream_rule: JSON-Schema missing key ${k} (zod has: ${outerKeys.join(",")})`,
        );
    }
});

test("schema-parity: delete_stream_rule", async () => {
    const { DeleteStreamRuleSchema } = await import("../src/tools/streams/schemas.js");
    await assertSchemaParityForTool("delete_stream_rule", DeleteStreamRuleSchema);
});

test("schema-parity: update_stream_rule", async () => {
    const { UpdateStreamRuleSchema } = await import("../src/tools/streams/schemas.js");
    await assertSchemaParityForTool("update_stream_rule", UpdateStreamRuleSchema);
});

test("schema-parity: test_stream_match", async () => {
    const { TestStreamMatchSchema } = await import("../src/tools/streams/schemas.js");
    await assertSchemaParityForTool("test_stream_match", TestStreamMatchSchema);
});

// ---------------------------------------------------------------------------
// Plan 04-02 enrichment — 5 new pipeline CRUD tools (PIPE-01..PIPE-05). All five
// schemas are plain mutatingBase.extend()/listBase/z.object without superRefine
// wrapping, so .shape is direct; getShape handles them without extra plumbing.
// ---------------------------------------------------------------------------

test("schema-parity: list_pipelines", async () => {
    const { ListPipelinesSchema } = await import("../src/tools/pipelines/schemas.js");
    await assertSchemaParityForTool("list_pipelines", ListPipelinesSchema);
});

test("schema-parity: get_pipeline", async () => {
    const { GetPipelineSchema } = await import("../src/tools/pipelines/schemas.js");
    await assertSchemaParityForTool("get_pipeline", GetPipelineSchema);
});

test("schema-parity: create_pipeline", async () => {
    const { CreatePipelineSchema } = await import("../src/tools/pipelines/schemas.js");
    await assertSchemaParityForTool("create_pipeline", CreatePipelineSchema);
});

test("schema-parity: update_pipeline", async () => {
    const { UpdatePipelineSchema } = await import("../src/tools/pipelines/schemas.js");
    await assertSchemaParityForTool("update_pipeline", UpdatePipelineSchema);
});

test("schema-parity: delete_pipeline", async () => {
    const { DeletePipelineSchema } = await import("../src/tools/pipelines/schemas.js");
    await assertSchemaParityForTool("delete_pipeline", DeletePipelineSchema);
});

// ---------------------------------------------------------------------------
// Plan 04-03 enrichment — 4 new pipeline-rule CRUD tools (PIPE-06..PIPE-09).
//
// CreatePipelineRuleSchema + UpdatePipelineRuleSchema use .refine() (D-10
// mutual exclusion); zod wraps them in ZodEffects. getShape() handles that
// via the `_def?.schema?.shape` branch.
// ---------------------------------------------------------------------------

test("schema-parity: list_pipeline_rules", async () => {
    const { ListPipelineRulesSchema } = await import("../src/tools/pipelines/schemas.js");
    await assertSchemaParityForTool("list_pipeline_rules", ListPipelineRulesSchema);
});

test("schema-parity: get_pipeline_rule", async () => {
    const { GetPipelineRuleSchema } = await import("../src/tools/pipelines/schemas.js");
    await assertSchemaParityForTool("get_pipeline_rule", GetPipelineRuleSchema);
});

test("schema-parity: create_pipeline_rule", async () => {
    const { CreatePipelineRuleSchema } = await import("../src/tools/pipelines/schemas.js");
    await assertSchemaParityForTool("create_pipeline_rule", CreatePipelineRuleSchema);
});

test("schema-parity: update_pipeline_rule", async () => {
    const { UpdatePipelineRuleSchema } = await import("../src/tools/pipelines/schemas.js");
    await assertSchemaParityForTool("update_pipeline_rule", UpdatePipelineRuleSchema);
});

// ---------------------------------------------------------------------------
// Plan 04-05 enrichment — 2 new pipeline-stream connection tools (PIPE-13/14).
//
// Both schemas use plain mutatingBase.extend() with .min(1) constraints on
// streamId + pipelineIds; no .refine() or .superRefine() wrapping. getShape()
// reads .shape directly.
// ---------------------------------------------------------------------------

test("schema-parity: connect_pipelines_to_stream", async () => {
    const { ConnectPipelinesToStreamSchema } = await import("../src/tools/pipelines/schemas.js");
    await assertSchemaParityForTool("connect_pipelines_to_stream", ConnectPipelinesToStreamSchema);
});

test("schema-parity: disconnect_pipelines_from_stream", async () => {
    const { DisconnectPipelinesFromStreamSchema } = await import("../src/tools/pipelines/schemas.js");
    await assertSchemaParityForTool("disconnect_pipelines_from_stream", DisconnectPipelinesFromStreamSchema);
});

// ---------------------------------------------------------------------------
// Plan 04-04 enrichment — 3 new pipeline tools (PIPE-10 delete_pipeline_rule,
// PIPE-11 list_pipeline_functions, PIPE-12 simulate_pipeline_rule).
//
// DeletePipelineRuleSchema is plain mutatingBase.extend({ ruleId, confirm? });
// no .refine wrap. SimulatePipelineRuleSchema uses .refine for D-10-style
// XOR mutual exclusion (structured XOR ruleSource); getShape handles
// ZodEffects via _def.schema.shape. ListPipelineFunctionsSchema extends
// listBase plain (no refine wrap).
// ---------------------------------------------------------------------------

test("schema-parity: delete_pipeline_rule", async () => {
    const { DeletePipelineRuleSchema } = await import("../src/tools/pipelines/schemas.js");
    await assertSchemaParityForTool("delete_pipeline_rule", DeletePipelineRuleSchema);
});

test("schema-parity: simulate_pipeline_rule", async () => {
    const { SimulatePipelineRuleSchema } = await import("../src/tools/pipelines/schemas.js");
    await assertSchemaParityForTool("simulate_pipeline_rule", SimulatePipelineRuleSchema);
});

test("schema-parity: list_pipeline_functions", async () => {
    const { ListPipelineFunctionsSchema } = await import("../src/tools/pipelines/schemas.js");
    await assertSchemaParityForTool("list_pipeline_functions", ListPipelineFunctionsSchema);
});

// ---------------------------------------------------------------------------
// Plan 05-02 — Phase 5 event-definition CRUD (4 net-new tools).
// list_event_definitions extends listBase (3 keys) with {query, sort, order}
// → 6 keys total; get/create/update extend mutatingBase (3 keys) with their
// per-tool args. All four schemas are plain extend() without superRefine
// wrapping, so getShape returns .shape directly.
// ---------------------------------------------------------------------------

test("schema-parity: list_event_definitions", async () => {
    const { ListEventDefinitionsSchema } = await import("../src/tools/events/schemas.js");
    await assertSchemaParityForTool("list_event_definitions", ListEventDefinitionsSchema);
});

test("schema-parity: get_event_definition", async () => {
    const { GetEventDefinitionSchema } = await import("../src/tools/events/schemas.js");
    await assertSchemaParityForTool("get_event_definition", GetEventDefinitionSchema);
});

test("schema-parity: create_event_definition", async () => {
    const { CreateEventDefinitionSchema } = await import("../src/tools/events/schemas.js");
    await assertSchemaParityForTool("create_event_definition", CreateEventDefinitionSchema);
});

test("schema-parity: update_event_definition", async () => {
    const { UpdateEventDefinitionSchema } = await import("../src/tools/events/schemas.js");
    await assertSchemaParityForTool("update_event_definition", UpdateEventDefinitionSchema);
});

// ---------------------------------------------------------------------------
// Plan 05-03 — enable/disable/delete_event_definition (3 net-new tools).
// All three extend mutatingBase (3 keys) with {definitionId} → 4 keys total.
// Plain .extend() without superRefine wrapping, so getShape returns .shape.
// ---------------------------------------------------------------------------

test("schema-parity: enable_event_definition", async () => {
    const { EnableEventDefinitionSchema } = await import("../src/tools/events/schemas.js");
    await assertSchemaParityForTool("enable_event_definition", EnableEventDefinitionSchema);
});

test("schema-parity: disable_event_definition", async () => {
    const { DisableEventDefinitionSchema } = await import("../src/tools/events/schemas.js");
    await assertSchemaParityForTool("disable_event_definition", DisableEventDefinitionSchema);
});
