// EVENT-04 — update_event_definition. PUT /api/events/definitions/{id}?schedule=false.
//
// D-02 (M1 mirror for update): wire path UNCONDITIONALLY ?schedule=false. The
//   schema does NOT accept a schedule argument — partial updates NEVER
//   silently re-enable scheduling.
//
// D-10 (STRICT_NO_ECHO partial-update — Phase 3/4 precedent — see
//   src/tools/streams/update-stream.js, src/tools/inputs/update-input.js, and
//   src/tools/pipelines/update-pipeline-rule.js for prior landings): the wire
//   body is built ONLY from args.changes.{title, description, priority, alert,
//   config, field_spec, key_spec, notification_settings, notifications, storage,
//   state, remediation_steps, event_procedure, event_summary_template}. NO
//   round-trip from a GET — scheduler READ_ONLY contamination is impossible.
//
// Pitfall 5: scheduler field is @JsonProperty.Access.READ_ONLY; round-tripping
//   a GET response back as PUT body returns 400. STRICT_NO_ECHO prevents this
//   structurally — no GET on this path; we build the body from args alone.
//
// Pitfall 8: id required on PUT URL; the wrapper sets body.id = args.definitionId
//   so the PUT body always agrees with the URL segment (URL/body match check).
//
// C5 (v6→v7 migration on update): if args.changes.config is present, route it
//   through migrateV6ToV7AggregationConditions wrapped in a synthetic DTO so
//   the migrator's path-recognition (definitionDto.config.conditions.expression)
//   works without modification. Migration surfaces in dry-run JSON only when
//   fired (omit-vs-spread pattern — lean preview on cosmetic edits).

import { defineMutatingHandler } from "../_shared/handler.js";
import { UpdateEventDefinitionSchema } from "./schemas.js";
import { migrateV6ToV7AggregationConditions } from "./v6-to-v7-migration.js";
import { toIdBody } from "../../graylog/normalize.js";

export const handleUpdateEventDefinition = defineMutatingHandler({
    name: "update_event_definition",
    schema: UpdateEventDefinitionSchema,
    async build(args) {
        // D-02 STRUCTURAL: wire path UNCONDITIONALLY ?schedule=false. The
        // schema rejects unknown keys via zod's default strip mode, so any
        // agent-injected `schedule` value is dropped before reaching build().
        const path = `/api/events/definitions/${args.definitionId}?schedule=false`;

        // C5: conditional migration — only when changes.config is touched.
        // We wrap the partial config in a synthetic DTO so the migrator's
        // path-recognition (definitionDto.config.conditions.expression) works
        // without modification. When changes.config is absent we skip the
        // migrator entirely (no warnings array, no `migration` key in dry-run).
        let migration = { migrated: false, dto: null, warnings: [] };
        let migratedConfig = args.changes.config;
        if (args.changes.config !== undefined) {
            const syntheticDto = { config: args.changes.config };
            migration = migrateV6ToV7AggregationConditions(syntheticDto);
            migratedConfig = migration.dto.config;
        }

        // D-10 STRICT_NO_ECHO: emit ONLY the fields the agent touched. The
        // conditional-spread pattern preserves agent intent — omit means
        // server-side no-op; explicit null means clear-the-field (where the
        // server-side schema allows nulls; e.g. remediation_steps).
        //
        // Pitfall 8: id is ALWAYS present (matches URL segment) — this is the
        // only field NOT controlled by args.changes; it's framework-internal.
        const wireBody = {
            id: args.definitionId,
            ...(args.changes.title !== undefined ? { title: args.changes.title } : {}),
            ...(args.changes.description !== undefined ? { description: args.changes.description } : {}),
            ...(args.changes.priority !== undefined ? { priority: args.changes.priority } : {}),
            ...(args.changes.alert !== undefined ? { alert: args.changes.alert } : {}),
            ...(migratedConfig !== undefined ? { config: migratedConfig } : {}),
            ...(args.changes.field_spec !== undefined ? { field_spec: args.changes.field_spec } : {}),
            ...(args.changes.key_spec !== undefined ? { key_spec: args.changes.key_spec } : {}),
            ...(args.changes.notification_settings !== undefined
                ? { notification_settings: args.changes.notification_settings }
                : {}),
            ...(args.changes.notifications !== undefined ? { notifications: args.changes.notifications } : {}),
            ...(args.changes.storage !== undefined ? { storage: args.changes.storage } : {}),
            ...(args.changes.remediation_steps !== undefined
                ? { remediation_steps: args.changes.remediation_steps }
                : {}),
            ...(args.changes.event_procedure !== undefined
                ? { event_procedure: args.changes.event_procedure }
                : {}),
            ...(args.changes.event_summary_template !== undefined
                ? { event_summary_template: args.changes.event_summary_template }
                : {}),
        };

        return {
            method: "PUT",
            path,
            body: wireBody,
            // D-03 surface: migration visible in dry-run only when fired.
            // handler.js spreads req.migration conditionally (Plan 05-02 Task 2
            // amendment); omit here when migrated:false to keep the preview JSON
            // lean on cosmetic edits.
            ...(migration.migrated ? { migration } : {}),
            postApplyEstimate: { id: args.definitionId },
            normalize: (raw) => toIdBody(raw, { idFields: ["id"] }),
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req.body),
    summarize: (args) =>
        `Update event definition ${args.definitionId} (${Object.keys(args.changes).length} change(s); schedule:false preserved)`,
});
