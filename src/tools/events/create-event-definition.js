// EVENT-03 — create_event_definition. M1 + C5 mitigation centerpiece.
//
// D-01 (M1): wire path is /api/events/definitions?schedule=false UNCONDITIONALLY.
//   The schema does NOT accept a `schedule` argument — agent cannot bypass.
//   Dry-run summary explicitly states wouldStartScheduling: false so the
//   agent sees the inversion in two distinct places (summary + wire path).
//
// D-03/D-04 (C5): args.definition flows through migrateV6ToV7AggregationConditions
//   before being wrapped in CreateEntityRequest. If migration fires, the dry-run
//   output carries migration: { migrated: true, warnings: [...] } verbatim.
//
// Pitfall 3 (RESEARCH): wire body wraps in { entity: <dto>, share_request: null }.
//   Flat body returns 400 "missing entity".
//
// Pitfall 8 (RESEARCH): definition.id is @Nullable on input; the schema marks
//   it optional and the wrapper strips it before POST (server assigns).
//
// Pitfall 2 (RESEARCH / M2): response is 200 + full EventDefinitionDto; normalize
//   reads raw.id (not Location header, not a `{stream_id}` wrapper).
//
// FOUND-11: list-before-create probe via findExistingMatches({listPath: paginated})
//   — exact title match only (no fuzzy buckets; agent gets a single
//   similarity_reason: "exact" entry when a definition with the same title exists).
//   Plan 05-01's `elements` envelope amendment in conflict.js makes this work
//   end-to-end without modification at this site.

import { defineMutatingHandler } from "../_shared/handler.js";
import { CreateEventDefinitionSchema } from "./schemas.js";
import { migrateV6ToV7AggregationConditions } from "./v6-to-v7-migration.js";
import { findExistingMatches } from "../_shared/conflict.js";
import { makeClient } from "../../graylog/client.js";
import { SERVER_ASSIGNED_SENTINEL } from "../_shared/dry-run.js";

export const handleCreateEventDefinition = defineMutatingHandler({
    name: "create_event_definition",
    schema: CreateEventDefinitionSchema,
    async build(args) {
        const client = makeClient(args._conn);

        // D-03/D-04 (C5): v6→v7 migration BEFORE the existingMatches probe so
        // the migrator's normalized DTO flows downstream consistently. The
        // migrator is a pure function — does not mutate args.definition.
        const migration = migrateV6ToV7AggregationConditions(args.definition);

        // FOUND-11: exact-title existingMatches probe. Plan 05-01's envelope
        // amendment makes `response.elements` unwrap correctly in conflict.js
        // (it sits at position 5 of the fallback chain, BEFORE the generic
        // `items` slot). similarityReason is the literal "exact" — Phase 5
        // does not implement the case_insensitive/prefix buckets that
        // create_stream / create_input use; agents get an exact-match flag
        // or nothing.
        const existingMatches = await findExistingMatches(client, {
            listPath: "/api/events/definitions/paginated",
            matchFn: (def) => def.title === args.definition.title,
            similarityReason: "exact",
        });

        // Pitfall 8: strip @Nullable id from the wire body (server assigns).
        // The migrator returns dto with id preserved if the agent passed one;
        // here we explicitly destructure-and-discard before wrapping in the
        // entity envelope. _strippedId is intentionally unused.
        const { id: _strippedId, ...dtoWithoutId } = migration.dto;
        void _strippedId;

        return {
            method: "POST",
            // D-01 STRUCTURAL ENFORCEMENT: ?schedule=false on the wire path
            // UNCONDITIONALLY. The schema does NOT accept a schedule field
            // so there is no agent path that puts schedule=true on the wire.
            path: "/api/events/definitions?schedule=false",
            // Pitfall 3: CreateEntityRequest envelope wrap.
            body: { entity: dtoWithoutId, share_request: null },
            existingMatches,
            // D-03 surface: migration is visible in dry-run output. Omitted
            // when migrated:false so the preview JSON stays lean (C5 NO-OP path).
            ...(migration.migrated ? { migration } : {}),
            // M1 acceptance gate proof #2 (proof #1 is the path above):
            // postApplyEstimate explicitly states wouldStartScheduling:false.
            // state:DISABLED mirrors D-01's "create disabled by default" contract.
            postApplyEstimate: {
                id: SERVER_ASSIGNED_SENTINEL,
                state: "DISABLED",
                wouldStartScheduling: false,
            },
            // M2 / Pitfall 2: 200 + full DTO; normalize extracts id from raw.id.
            normalize: (raw) => ({ id: raw?.id, body: raw }),
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        `Create event definition "${args.definition.title}" with schedule:false (call enable_event_definition to activate)`,
});
