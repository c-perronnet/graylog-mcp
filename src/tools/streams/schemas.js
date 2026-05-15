// Plan 03-01 SUBSET — schemas for the three Phase 3 read tools (STREAM-01,
// STREAM-02, STREAM-07). Plans 03-02 / 03-03 / 03-04 will extend this file
// with the 9 remaining schemas (CreateStreamSchema, UpdateStreamSchema,
// DeleteStreamSchema, StartStreamSchema, PauseStreamSchema, StreamRuleSchema
// 8-variant discriminated union, CreateStreamRuleSchema, UpdateStreamRuleSchema,
// DeleteStreamRuleSchema, TestStreamMatchSchema) plus the
// STREAM_RULE_TYPE_TO_NUMERIC frozen alias-to-int map.

import { z } from "zod";
import { listBase } from "../_shared/schemas.js";

// STREAM-01 — list_streams. No per-tool args; narrows to listBase
// (connectionName / fields / limit). The agent-facing `mutable` projection
// happens inside list-streams.js's fetch callback — schema is unchanged.
export const ListStreamsSchema = listBase;

// STREAM-02 — get_stream. Single-target read; takes a required streamId.
// Plain ZodObject (NOT extending mutatingBase) because this is a read tool
// and the framework's mutatingBase fields (dryRun, idempotencyKey) would be
// confusing on a GET. Schema-parity test catches drift against tools.js.
export const GetStreamSchema = z.object({
    connectionName: z.string().optional(),
    streamId: z.string().min(1, "streamId is required"),
});

// STREAM-07 — list_stream_rules. Narrows to listBase + required streamId.
// Composes through defineListHandler (per-rule narrow projection in the
// fetch callback); streamId parameterises the path
// /api/streams/{streamId}/rules.
export const ListStreamRulesSchema = listBase.extend({
    streamId: z.string().min(1, "streamId is required"),
});
