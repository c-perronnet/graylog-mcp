// Plan 03-01 SUBSET — schemas for the three Phase 3 read tools (STREAM-01,
// STREAM-02, STREAM-07). Plans 03-02 / 03-03 / 03-04 will extend this file
// with the 9 remaining schemas (CreateStreamSchema, UpdateStreamSchema,
// DeleteStreamSchema, StartStreamSchema, PauseStreamSchema, StreamRuleSchema
// 8-variant discriminated union, CreateStreamRuleSchema, UpdateStreamRuleSchema,
// DeleteStreamRuleSchema, TestStreamMatchSchema) plus the
// STREAM_RULE_TYPE_TO_NUMERIC frozen alias-to-int map.

import { z } from "zod";
import { listBase, mutatingBase } from "../_shared/schemas.js";

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

// =====================================================================
// Plan 03-02 — append: 8-variant StreamRuleSchema (D-11) + frozen numeric
// wire map (Pitfall S9) + 4 mutating schemas (create_stream, update_stream,
// start_stream, pause_stream) + SimilarityReasonEnum closed-set (D-06).
// =====================================================================
//
// D-11 confirmed 2026-05-15 at 8 variants — Graylog 7.0.6's full
// StreamRuleType enum (EXACT=1, REGEX=2, GREATER=3, SMALLER=4, PRESENCE=5,
// CONTAINS=6, ALWAYS_MATCH=7, MATCH_INPUT=8). Field/value required-ness
// derived from CreateStreamRuleRequest.java (Pitfall S10):
//   - `value` / `field` are non-nullable String on the wire — empty strings
//     allowed, null rejected. The schema below declares which fields are
//     agent-required; the wire-build callback (translateInlineRule in
//     create-stream.js) emits "" for fields where the agent didn't supply
//     a value for types where the field is semantically irrelevant.
//   - `inverted` defaults to false.

const RuleExact = z.object({
    type: z.literal("exact"),
    field: z.string().min(1),
    value: z.string(),
    inverted: z.boolean().default(false),
    description: z.string().nullish(),
});
const RuleRegex = z.object({
    type: z.literal("regex"),
    field: z.string().min(1),
    value: z.string(),
    inverted: z.boolean().default(false),
    description: z.string().nullish(),
});
const RuleGreater = z.object({
    type: z.literal("greater"),
    field: z.string().min(1),
    value: z.union([z.number(), z.string()]),  // wire-build coerces via String(value)
    inverted: z.boolean().default(false),
    description: z.string().nullish(),
});
const RuleLess = z.object({
    type: z.literal("less"),
    field: z.string().min(1),
    value: z.union([z.number(), z.string()]),
    inverted: z.boolean().default(false),
    description: z.string().nullish(),
});
const RulePresent = z.object({
    type: z.literal("present"),
    field: z.string().min(1),
    // no value (semantically irrelevant — emitted as "" on wire)
    inverted: z.boolean().default(false),
    description: z.string().nullish(),
});
const RuleContains = z.object({
    type: z.literal("contains"),
    field: z.string().min(1),
    value: z.string(),
    inverted: z.boolean().default(false),
    description: z.string().nullish(),
});
const RuleAlwaysMatch = z.object({
    type: z.literal("always_match"),
    // no field, no value — both emitted as "" on wire
    inverted: z.boolean().default(false),
    description: z.string().nullish(),
});
const RuleMatchInput = z.object({
    type: z.literal("match_input"),
    value: z.string().min(1),  // input id (gl2_source_input comparison)
    // field semantically irrelevant — emitted as "" on wire
    inverted: z.boolean().default(false),
    description: z.string().nullish(),
});

export const StreamRuleSchema = z.discriminatedUnion("type", [
    RuleExact, RuleRegex, RuleGreater, RuleLess,
    RulePresent, RuleContains, RuleAlwaysMatch, RuleMatchInput,
]);

// Pitfall S9: wire format is numeric int, agent API is string discriminator.
// build() callbacks (create_stream when args.rules present; Plan 04's
// create_stream_rule + update_stream_rule) consume this map. Object.frozen
// so accidental mutation at runtime is caught loudly.
export const STREAM_RULE_TYPE_TO_NUMERIC = Object.freeze({
    exact: 1,
    regex: 2,
    greater: 3,
    less: 4,
    present: 5,
    contains: 6,
    always_match: 7,
    match_input: 8,
});

// D-06: similarity buckets for create_stream existingMatches — closed set.
// classifySimilarity() in create-stream.js maps proposed/existing title
// pairs into one of these three values (strictest wins).
export const SimilarityReasonEnum = z.enum(["exact", "case_insensitive", "prefix"]);

// STREAM-03 — create_stream. D-10 enforces index_set_id REQUIRED with no
// defaulting; agent must call list_index_sets first. CreateEntityRequest
// envelope wrapping happens in create-stream.js's build() — schema is the
// agent-facing flat shape.
export const CreateStreamSchema = mutatingBase.extend({
    title: z.string().min(1),
    description: z.string().nullish(),
    rules: z.array(StreamRuleSchema).default([]),
    matching_type: z.enum(["AND", "OR"]).default("AND"),
    remove_matches_from_default_stream: z.boolean().default(false),
    index_set_id: z.string().min(1, "index_set_id is required (D-10) — call list_index_sets first"),
});

// STREAM-04 — update_stream. Partial-update envelope per D-14 + 03-U1-SMOKE.md
// (UNREACHABLE_STRICT_NO_ECHO → STRICT_NO_ECHO chosen for safe-default per
// 02-U1-SMOKE precedent). The `changes` envelope is the agent's surface; the
// wire body in update-stream.js's build() emits ONLY the fields present in
// args.changes.
const UpdateStreamChangesShape = z.object({
    title: z.string().min(1).optional(),
    description: z.string().nullish(),
    matching_type: z.enum(["AND", "OR"]).optional(),
    remove_matches_from_default_stream: z.boolean().optional(),
    index_set_id: z.string().min(1).optional(),
});
export const UpdateStreamSchema = mutatingBase.extend({
    streamId: z.string().min(1),
    changes: UpdateStreamChangesShape,
});

// STREAM-06a — start_stream. mutatingBase.extend({ streamId }) — same minimal
// shape as Phase 1 start_input. D-12: routes through defineMutatingHandler
// for uniform dryRun + writable inheritance + idempotency.
export const StartStreamSchema = mutatingBase.extend({
    streamId: z.string().min(1),
});

// STREAM-06b — pause_stream. Mirror of start_stream.
export const PauseStreamSchema = mutatingBase.extend({
    streamId: z.string().min(1),
});
