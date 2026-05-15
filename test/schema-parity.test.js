import { test } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";

// Pitfall 3: zod ↔ JSON-Schema drift detection scaffold.
//
// Phase 0 ships NO mutating tools — there are no per-domain zod schemas yet to
// parity-check against `src/tools.js` JSON-Schema entries. This file establishes
// the empty-allowlist baseline. Phase 1+ enriches as each mutating tool lands
// (see commented enrichment template at the file end).
//
// What we DO assert today: that the shared base schemas (`mutatingBase`,
// `listBase`) exist and expose the documented shape keys. Any later edit to
// these bases that drops a key is caught immediately.

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
// Phase 1+ enrichment template (uncomment and parameterise when the first
// mutating tool ships):
//
// async function assertSchemaParityForTool(toolName, zodSchema) {
//     const { toolDefinitions } = await import("../src/tools.js");
//     const tool = toolDefinitions.find((t) => t.name === toolName);
//     assert.ok(tool, `Tool ${toolName} missing from tools.js`);
//     const jsonSchemaKeys = Object.keys(tool.inputSchema.properties).sort();
//     const zodKeys = Object.keys(zodSchema.shape).sort();
//     assert.deepEqual(
//         jsonSchemaKeys,
//         zodKeys,
//         `Schema drift in ${toolName}: JSON-Schema [${jsonSchemaKeys}] vs zod [${zodKeys}]`
//     );
// }
// ---------------------------------------------------------------------------
