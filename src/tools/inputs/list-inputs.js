// INPUT-02: list_inputs — list configured inputs on the connected cluster.
//
// Default projection narrows to [id, title, type, global] via the per-tool
// `defaultFields` override (BLOCKER #3 fix in defineListHandler). Rationale:
//   - description is rarely set on inputs in practice — the framework default
//     [id, title, description] would yield mostly empty `description` entries.
//   - type is the most useful filterable field for the agent (e.g. "show me
//     the GELF inputs").
//   - global tells the agent whether this input runs on every node or one.
// Pass fields:'all' for the full InputSummary DTO (configuration map included,
// encrypted fields still server-masked).

import { defineListHandler } from "../_shared/list.js";
import { ListInputsSchema } from "./schemas.js";

// Per-tool default projection — replaces the framework DEFAULT_FIELDS only for
// this tool. The framework default is preserved for every other list tool that
// does not pass defaultFields.
const INPUT_DEFAULT_FIELDS = ["id", "title", "type", "global"];

export const handleListInputs = defineListHandler({
    name: "list_inputs",
    schema: ListInputsSchema,
    defaultFields: INPUT_DEFAULT_FIELDS,
    fetch: async (client) => {
        // GET /api/system/inputs → InputsList { inputs: Set<InputSummary> }.
        // The Graylog server already applies maskPasswordsInConfiguration before
        // serialization, so encrypted fields arrive as "<value hidden>" /
        // "<password set>" placeholders — the MCP NEVER unmasks them.
        const response = await client.request("GET", "/api/system/inputs", null);
        return Array.isArray(response?.inputs) ? response.inputs : [];
    },
});
