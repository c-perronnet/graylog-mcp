// BLUE-02 — setup_error_alerting.
//
// 1-step chain wrapping events.createEventDefinition with an agent-supplied
// notification reference. The agent supplies notificationId from a prior
// `list_event_notifications` call; Graylog's server-side foreign-key check
// surfaces a 4xx if the notification doesn't exist (T-06-05-07 accepted —
// no pre-flight GET, cost-aware).
//
// Defaults:
//   - title = "Error alert for stream {streamId}"
//   - errorRateThreshold = 50 events / 5 min
//   - searchWithinMinutes = 5
//
// Wire body wires aggregation-v1 with query "level:>=4" and a count-based
// threshold expression. Schedule=false query parameter (Phase 5 M1
// carry-forward — event def lands UNSCHEDULED; flip with
// `enable_event_definition` separately).
//
// Composition contract (D-09): Imports ONLY from src/services/events.js
// (+ _shared/). Pinned by the Plan 06-05 D-09 grep test.

import { defineMutatingHandler } from "../_shared/handler.js";
import { SetupErrorAlertingSchema } from "./schemas.js";
import { createEventDefinition } from "../../services/events.js";
import { executeChain } from "../_shared/blueprint-chain.js";
import { SERVER_ASSIGNED_SENTINEL } from "../_shared/dry-run.js";

// D-09 architectural-boundary marker (see file header).
void createEventDefinition;

export const handleSetupErrorAlerting = defineMutatingHandler({
    name: "setup_error_alerting",
    schema: SetupErrorAlertingSchema,
    async build(args) {
        const title = args.title ?? `Error alert for stream ${args.streamId}`;
        const searchWithinMs = args.searchWithinMinutes * 60 * 1000;
        const eventDefBody = {
            title,
            description: `Auto-generated error-rate alert (>= ${args.errorRateThreshold} errors / ${args.searchWithinMinutes} min)`,
            priority: 2,
            alert: true,
            config: {
                type: "aggregation-v1",
                query: "level:>=4",
                streams: [args.streamId],
                group_by: [],
                series: [{ id: "count-1", function: "count", field: null }],
                conditions: {
                    expression: {
                        expr: ">",
                        left: { expr: "number-ref", ref: "count-1" },
                        right: { expr: "number", value: args.errorRateThreshold },
                    },
                },
                search_within_ms: searchWithinMs,
                execute_every_ms: searchWithinMs,
            },
            field_spec: [],
            key_spec: [],
            notifications: [{
                notification_id: args.notificationId,
                notification_parameters: null,
            }],
            notification_settings: { grace_period_ms: 60 * 1000, backlog_size: 50 },
        };

        const chain = [{
            step: 1,
            tool: "create_event_definition",
            request: {
                method: "POST",
                path: "/api/events/definitions?schedule=false",
                body: eventDefBody,
            },
            postApplyEstimate: { id: SERVER_ASSIGNED_SENTINEL },
        }];

        return {
            chain,
            method: "POST",
            path: "/api/events/definitions?schedule=false",
            body: eventDefBody,
            postApplyEstimate: { id: SERVER_ASSIGNED_SENTINEL },
        };
    },
    async apply(client, req) {
        const result = await executeChain(client, req.chain);
        if (result.isError) return result;
        return result.transcript[0].response;
    },
    summarize: (args) =>
        `Set up error alerting on stream ${args.streamId} via notification ${args.notificationId}`,
});
