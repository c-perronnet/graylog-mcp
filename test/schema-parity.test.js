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
