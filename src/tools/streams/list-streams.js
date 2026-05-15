// STREAM-01 — list_streams. Wire `is_editable` projects to agent-facing
// `mutable` per Pitfall S2 + ROADMAP SC2. Default narrow projection selects 6
// fields the agent typically needs for filter+routing decisions: id, title,
// description, mutable, disabled, index_set_id.
//
// Pitfall S5 displacement: the v2.3 listStreamsHandler in src/handlers.js
// returned only {id, title, description}. This Phase 3 handler is a strict
// superset — agents reading only the old 3 fields continue to work. The v2.3
// registration line in src/tools/_register.js is removed in the same plan.
//
// Wire field rename rationale (Pitfall S2): Graylog's StreamResponse exposes
// the editability flag as `is_editable: boolean`. ROADMAP SC2 documents the
// agent-facing name as `mutable: boolean`. The semantic is identical —
// Graylog computes `is_editable` via scopeService.isMutable(dto) — so the
// rename is purely an ergonomic API choice. is_editable is STRIPPED from the
// projected item to avoid presenting two names for the same field.

import { defineListHandler } from "../_shared/list.js";
import { ListStreamsSchema } from "./schemas.js";

const STREAM_DEFAULT_FIELDS = [
    "id",
    "title",
    "description",
    "mutable",
    "disabled",
    "index_set_id",
];

export const handleListStreams = defineListHandler({
    name: "list_streams",
    schema: ListStreamsSchema,
    defaultFields: STREAM_DEFAULT_FIELDS,
    fetch: async (client) => {
        // GET /api/streams returns StreamListResponse { total, streams: [...] }.
        // The endpoint is @Deprecated in 7.x in favor of /streams/paginated but
        // still functional; Pitfall S3 documents the upgrade path under HARD-05
        // (Phase 7 audit). Phase 3 uses the deprecated endpoint because the
        // response shape `{ total, streams: [...] }` is what findExistingMatches
        // and the projection here expect.
        const response = await client.request("GET", "/api/streams", null);
        const streams = response?.streams ?? [];
        // Project wire `is_editable` -> agent `mutable`. Strip is_editable to
        // avoid two names for the same field in the agent-facing output.
        return streams.map((s) => {
            const { is_editable, ...rest } = s;
            return { ...rest, mutable: is_editable === true };
        });
    },
});
