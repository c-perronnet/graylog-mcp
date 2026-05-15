// INDEX-01 — list_index_sets: narrow projection by default flagging
// default + writable + can_be_default. Composes defineListHandler with a
// defaultFields override (BLOCKER #3 fix from Phase 1).
//
// Rationale for the projection:
//   - default + writable + can_be_default are the "operational state" trio
//     the agent needs before deciding which index set to mutate.
//   - index_prefix is what every operational artifact (rotation files,
//     deletion records) is named after — essential for cross-referencing.
//   - description is included for parity with the framework default + because
//     the Graylog UI populates it on the default index set.
//
// Stats (messageCount, sizeBytes) are NOT in the default projection — they
// would require N stats calls (one per index set), which is too expensive.
// The agent must call get_index_set or wait for delete_index_set's dry-run
// preview to see per-set stats.
//
// The fetch unwraps the { total, index_sets: [...], stats: {} } envelope so
// defineListHandler's projection sees a plain array. The `?stats=false` query
// keeps the list response cheap on Graylog 7.0.6.

import { defineListHandler } from "../_shared/list.js";
import { ListIndexSetsSchema } from "./schemas.js";

const INDEX_SET_DEFAULT_FIELDS = [
    "id",
    "title",
    "description",
    "default",
    "writable",
    "can_be_default",
    "index_prefix",
];

export const handleListIndexSets = defineListHandler({
    name: "list_index_sets",
    schema: ListIndexSetsSchema,
    defaultFields: INDEX_SET_DEFAULT_FIELDS,
    fetch: async (client, args) => {
        const limit = args.limit;
        const path = `/api/system/indices/index_sets?stats=false${limit ? `&limit=${limit}` : ""}`;
        const response = await client.request("GET", path, null);
        return Array.isArray(response) ? response : (response?.index_sets ?? []);
    },
});
