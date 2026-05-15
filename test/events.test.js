// Plan 05-01 Task 2 — events/schemas.js + v6-to-v7-migration.js coverage.
//
// Covers:
//   - 6-variant NotificationConfigSchema discriminator (D-05 corrected): accepts
//     email/http-v1/http-v2/slack/pagerduty-v2/teams-v2; rejects (D-05 draft)
//     script-notification-v1 and pagerduty-notification-v1 at zod.parse.
//   - migrateV6ToV7AggregationConditions: detects {type:"function",
//     function:<one of 8>, parameter:<string>} nodes; emits a v7 number-ref
//     with the underscored key; surfaces visible warnings; no-op on v7 input.
//   - EventDefinitionDtoSchema key_spec ⊆ field_spec superRefine.
//   - events/index.js loads as a no-op side-effect barrel.

import { test } from "node:test";
import assert from "node:assert/strict";
import "./snapshot-config.js";

import {
    NotificationConfigSchema,
    EventDefinitionDtoSchema,
    ListEventDefinitionsSchema,
    GetEventDefinitionSchema,
    CreateEventDefinitionSchema,
    UpdateEventDefinitionSchema,
    DeleteEventDefinitionSchema,
    EnableEventDefinitionSchema,
    DisableEventDefinitionSchema,
    ListEventNotificationsSchema,
    CreateEventNotificationSchema,
    UpdateEventNotificationSchema,
    DeleteEventNotificationSchema,
} from "../src/tools/events/schemas.js";

import {
    migrateV6ToV7AggregationConditions,
    V6_FUNCTION_NAMES,
} from "../src/tools/events/v6-to-v7-migration.js";

// =====================================================================
// NotificationConfigSchema — 6-variant discriminator
// =====================================================================

test("NotificationConfigSchema accepts a valid slack-notification-v1 config", () => {
    const parsed = NotificationConfigSchema.parse({
        type: "slack-notification-v1",
        webhook_url: "https://hooks.slack.com/services/T00/B00/XXX",
        channel: "#general",
        color: "#ff0500",
        include_title: true,
    });
    assert.equal(parsed.type, "slack-notification-v1");
    assert.equal(parsed.channel, "#general");
});

test("NotificationConfigSchema accepts an email-notification-v1 with subject + email_recipients", () => {
    const parsed = NotificationConfigSchema.parse({
        type: "email-notification-v1",
        subject: "Event fired",
        body_template: "An event happened",
        email_recipients: ["ops@example.org"],
    });
    assert.equal(parsed.type, "email-notification-v1");
});

test("NotificationConfigSchema accepts an http-notification-v1 with url", () => {
    const parsed = NotificationConfigSchema.parse({
        type: "http-notification-v1",
        url: "https://example.org/webhook",
    });
    assert.equal(parsed.url, "https://example.org/webhook");
});

test("NotificationConfigSchema accepts an http-notification-v2 with method + url", () => {
    const parsed = NotificationConfigSchema.parse({
        type: "http-notification-v2",
        url: "https://example.org/webhook",
        method: "POST",
    });
    assert.equal(parsed.method, "POST");
});

test("NotificationConfigSchema accepts a pagerduty-notification-v2 with 32-char routing_key", () => {
    const parsed = NotificationConfigSchema.parse({
        type: "pagerduty-notification-v2",
        routing_key: "a".repeat(32),
        custom_incident: false,
        client_name: "graylog",
        client_url: "https://graylog.example.org",
    });
    assert.equal(parsed.routing_key.length, 32);
});

test("NotificationConfigSchema accepts a teams-notification-v2 with valid JSON adaptive_card", () => {
    const parsed = NotificationConfigSchema.parse({
        type: "teams-notification-v2",
        webhook_url: "https://server.logic.azure.com/workflows/xxx",
        adaptive_card: JSON.stringify({ type: "AdaptiveCard", version: "1.0" }),
    });
    assert.equal(parsed.type, "teams-notification-v2");
});

test("NotificationConfigSchema rejects script-notification-v1 (D-05 correction; type does not exist on 7.2-source)", () => {
    assert.throws(
        () => NotificationConfigSchema.parse({
            type: "script-notification-v1",
            script_path: "/usr/local/bin/notify.sh",
        }),
        (err) => err?.name === "ZodError",
    );
});

test("NotificationConfigSchema rejects pagerduty-notification-v1 (D-05 correction; PagerDuty is -v2)", () => {
    assert.throws(
        () => NotificationConfigSchema.parse({
            type: "pagerduty-notification-v1",
            routing_key: "a".repeat(32),
        }),
        (err) => err?.name === "ZodError",
    );
});

test("NotificationConfigSchema rejects teams-notification-v1 (D-05 picks v2 only)", () => {
    assert.throws(
        () => NotificationConfigSchema.parse({
            type: "teams-notification-v1",
            webhook_url: "https://server.logic.azure.com/workflows/xxx",
        }),
        (err) => err?.name === "ZodError",
    );
});

test("NotificationConfigSchema rejects arbitrary unknown types", () => {
    assert.throws(
        () => NotificationConfigSchema.parse({
            type: "anything-notification-v1",
            url: "https://example.org",
        }),
        (err) => err?.name === "ZodError",
    );
});

// =====================================================================
// Slack + PagerDuty + Teams refinements
// =====================================================================

test("slack-notification-v1 rejects notify_channel AND notify_here both true (XOR refinement)", () => {
    assert.throws(
        () => NotificationConfigSchema.parse({
            type: "slack-notification-v1",
            webhook_url: "https://hooks.slack.com/services/T/B/X",
            channel: "#general",
            color: "#ff0500",
            include_title: true,
            notify_channel: true,
            notify_here: true,
        }),
        (err) => err?.name === "ZodError",
    );
});

test("slack-notification-v1 rejects malformed color hex", () => {
    assert.throws(
        () => NotificationConfigSchema.parse({
            type: "slack-notification-v1",
            webhook_url: "https://hooks.slack.com/services/T/B/X",
            channel: "#general",
            color: "ff0500",  // missing leading #
            include_title: true,
        }),
        (err) => err?.name === "ZodError",
    );
});

test("pagerduty-notification-v2 rejects routing_key that is not exactly 32 chars", () => {
    assert.throws(
        () => NotificationConfigSchema.parse({
            type: "pagerduty-notification-v2",
            routing_key: "tooshort",
            custom_incident: false,
            client_name: "graylog",
            client_url: "https://graylog.example.org",
        }),
        (err) => err?.name === "ZodError",
    );
});

test("teams-notification-v2 rejects adaptive_card that fails JSON.parse", () => {
    assert.throws(
        () => NotificationConfigSchema.parse({
            type: "teams-notification-v2",
            webhook_url: "https://server.logic.azure.com/workflows/xxx",
            adaptive_card: "{not valid json",
        }),
        (err) => err?.name === "ZodError",
    );
});

// =====================================================================
// V6 → V7 aggregation migration
// =====================================================================

test("V6_FUNCTION_NAMES is a Set with exactly the 8 named functions", () => {
    assert.ok(V6_FUNCTION_NAMES instanceof Set);
    assert.equal(V6_FUNCTION_NAMES.size, 8);
    for (const name of ["count", "sum", "avg", "min", "max", "stddev", "percentile", "card"]) {
        assert.ok(V6_FUNCTION_NAMES.has(name), `expected ${name} in V6_FUNCTION_NAMES`);
    }
});

test("migrateV6ToV7AggregationConditions rewrites v6 function node to v7 number-ref + surfaces visible warning", () => {
    const input = {
        config: {
            conditions: {
                expression: { type: "function", function: "count", parameter: "source" },
            },
        },
    };
    const result = migrateV6ToV7AggregationConditions(input);
    assert.equal(result.migrated, true);
    assert.deepEqual(result.dto.config.conditions.expression, {
        type: "number-ref",
        ref: "count_source",
    });
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].migrated_from_v6_shape, true);
    assert.equal(result.warnings[0].emitted, "count_source");
    assert.deepEqual(result.warnings[0].original, {
        type: "function",
        function: "count",
        parameter: "source",
    });
});

test("migrateV6ToV7AggregationConditions is a no-op on a v7-shape input", () => {
    const input = {
        config: {
            conditions: {
                expression: { type: "number-ref", ref: "count_source" },
            },
        },
    };
    const result = migrateV6ToV7AggregationConditions(input);
    assert.equal(result.migrated, false);
    assert.equal(result.warnings.length, 0);
    assert.deepEqual(result.dto, input);
});

test("migrateV6ToV7AggregationConditions recurses into Expr.Comparison left/right operands", () => {
    const input = {
        config: {
            conditions: {
                expression: {
                    type: "comparison",
                    op: ">",
                    left: { type: "function", function: "count", parameter: "source" },
                    right: { type: "number", value: 100 },
                },
            },
        },
    };
    const result = migrateV6ToV7AggregationConditions(input);
    assert.equal(result.migrated, true);
    assert.deepEqual(result.dto.config.conditions.expression.left, {
        type: "number-ref",
        ref: "count_source",
    });
    assert.deepEqual(result.dto.config.conditions.expression.right, {
        type: "number",
        value: 100,
    });
    assert.equal(result.warnings.length, 1);
});

test("migrateV6ToV7AggregationConditions returns no-op when config.conditions.expression is absent", () => {
    const input = { config: { conditions: {} } };
    const result = migrateV6ToV7AggregationConditions(input);
    assert.equal(result.migrated, false);
    assert.deepEqual(result.dto, input);
    assert.equal(result.warnings.length, 0);
});

test("migrateV6ToV7AggregationConditions does NOT migrate function names outside the 8-name closed set", () => {
    const input = {
        config: {
            conditions: {
                expression: { type: "function", function: "counter", parameter: "source" },
            },
        },
    };
    const result = migrateV6ToV7AggregationConditions(input);
    assert.equal(result.migrated, false, "counter is not in V6_FUNCTION_NAMES");
});

test("migrateV6ToV7AggregationConditions emits bare function name when parameter is empty string", () => {
    const input = {
        config: {
            conditions: {
                expression: { type: "function", function: "count", parameter: "" },
            },
        },
    };
    const result = migrateV6ToV7AggregationConditions(input);
    assert.equal(result.migrated, true);
    assert.equal(result.dto.config.conditions.expression.ref, "count");
    assert.equal(result.warnings[0].emitted, "count");
});

// =====================================================================
// EventDefinitionDtoSchema — key_spec ⊆ field_spec superRefine
// =====================================================================

test("EventDefinitionDtoSchema rejects key_spec entry not present in field_spec keys (superRefine)", () => {
    assert.throws(
        () => EventDefinitionDtoSchema.parse({
            title: "x",
            config: {},
            field_spec: {},
            key_spec: ["bogus"],
        }),
        (err) => {
            if (err?.name !== "ZodError") return false;
            // Path includes key_spec
            return err.issues.some((iss) => iss.path?.includes("key_spec"));
        },
    );
});

test("EventDefinitionDtoSchema accepts matching key_spec ⊆ field_spec entries", () => {
    const parsed = EventDefinitionDtoSchema.parse({
        title: "x",
        config: {},
        field_spec: { source: {}, env: {} },
        key_spec: ["source"],
    });
    assert.deepEqual(parsed.key_spec, ["source"]);
});

test("EventDefinitionDtoSchema accepts minimal title + config; applies defaults", () => {
    const parsed = EventDefinitionDtoSchema.parse({
        title: "x",
        config: {},
    });
    assert.equal(parsed.priority, 2);
    assert.equal(parsed.alert, true);
    assert.equal(parsed.state, "DISABLED");
    assert.deepEqual(parsed.field_spec, {});
    assert.deepEqual(parsed.key_spec, []);
    assert.deepEqual(parsed.notification_settings, { grace_period_ms: 0, backlog_size: 0 });
});

// =====================================================================
// All 11 per-tool schemas exist and have the right shape
// =====================================================================

test("ListEventDefinitionsSchema exists and parses minimal args", () => {
    const parsed = ListEventDefinitionsSchema.parse({});
    assert.ok(parsed);
});

test("GetEventDefinitionSchema requires definitionId", () => {
    assert.throws(() => GetEventDefinitionSchema.parse({}), (err) => err?.name === "ZodError");
    const parsed = GetEventDefinitionSchema.parse({ definitionId: "abc" });
    assert.equal(parsed.definitionId, "abc");
});

test("CreateEventDefinitionSchema requires definition and applies mutatingBase defaults", () => {
    const parsed = CreateEventDefinitionSchema.parse({
        definition: { title: "x", config: {} },
    });
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.definition.title, "x");
});

test("UpdateEventDefinitionSchema requires definitionId + changes envelope", () => {
    const parsed = UpdateEventDefinitionSchema.parse({
        definitionId: "abc",
        changes: { title: "new" },
    });
    assert.equal(parsed.definitionId, "abc");
    assert.equal(parsed.changes.title, "new");
});

test("DeleteEventDefinitionSchema requires definitionId; no confirm field needed (D-08 informational)", () => {
    const parsed = DeleteEventDefinitionSchema.parse({ definitionId: "abc" });
    assert.equal(parsed.definitionId, "abc");
});

test("EnableEventDefinitionSchema + DisableEventDefinitionSchema share the same minimal shape", () => {
    const en = EnableEventDefinitionSchema.parse({ definitionId: "abc" });
    const dis = DisableEventDefinitionSchema.parse({ definitionId: "abc" });
    assert.equal(en.definitionId, "abc");
    assert.equal(dis.definitionId, "abc");
});

test("ListEventNotificationsSchema exists and parses minimal args", () => {
    const parsed = ListEventNotificationsSchema.parse({});
    assert.ok(parsed);
});

test("CreateEventNotificationSchema requires title + config (discriminator)", () => {
    const parsed = CreateEventNotificationSchema.parse({
        title: "my-webhook",
        config: { type: "http-notification-v1", url: "https://example.org/x" },
    });
    assert.equal(parsed.title, "my-webhook");
    assert.equal(parsed.config.type, "http-notification-v1");
});

test("UpdateEventNotificationSchema requires notificationId + changes envelope", () => {
    const parsed = UpdateEventNotificationSchema.parse({
        notificationId: "abc",
        changes: { title: "renamed" },
    });
    assert.equal(parsed.notificationId, "abc");
    assert.equal(parsed.changes.title, "renamed");
});

test("DeleteEventNotificationSchema accepts optional confirm 64-hex (D-09 cascade-hash gate)", () => {
    const ok = DeleteEventNotificationSchema.parse({
        notificationId: "abc",
        confirm: "a".repeat(64),
    });
    assert.equal(ok.confirm.length, 64);
    // confirm is optional — dry-run path doesn't need it
    const dryRun = DeleteEventNotificationSchema.parse({ notificationId: "abc" });
    assert.equal(dryRun.confirm, undefined);
    // confirm must be 64-hex if provided
    assert.throws(
        () => DeleteEventNotificationSchema.parse({
            notificationId: "abc",
            confirm: "not-a-hash",
        }),
        (err) => err?.name === "ZodError",
    );
});

// =====================================================================
// events/index.js side-effect barrel (Plan 05-02 — registers EVENT-01..04)
// =====================================================================
//
// Plan 05-01 shipped this as an empty stub. Plan 05-02 populates it with
// list_event_definitions + get_event_definition (Task 1), then
// create_event_definition (Task 2), then update_event_definition (Task 3).
// We assert the barrel loads cleanly here — the full dispatch wiring is
// covered by the dispatch test farther down.
//
// We do NOT call _clearForTests here (would clobber subsequent dispatch
// tests due to ES-module cache preventing re-registration on re-import —
// see test/streams.test.js test 10 for the same pattern).

test("events/index.js loads cleanly as the Phase 5 side-effect barrel", async () => {
    // Side-effect import: registers list_event_definitions + get_event_definition
    // (Plan 05-02 Task 1) into the dispatch Map. Subsequent imports are no-ops
    // (ES module cache).
    await import("../src/tools/events/index.js");
    assert.ok(true, "events/index.js imported without throwing");
});

// =====================================================================
// Plan 05-02 Task 1 — list_event_definitions + get_event_definition tests
// =====================================================================
//
// Routes per-test capture functions (multiCapture-style) through
// _setCaptureRequest. Build()-level fetches (GET paginated list for
// list_event_definitions, GET /api/events/definitions/{id} for
// get_event_definition) fire as real requests against the mocked client.

import { test as test_p2, beforeEach as beforeEach_p2, afterEach as afterEach_p2 } from "node:test";
import {
    _setCaptureRequest as _setCaptureRequest_p2,
    _clearCaptureRequest as _clearCaptureRequest_p2,
} from "../src/graylog/client.js";
import { setActiveConnection as setActiveConnection_p2 } from "../src/config.js";
import { GraylogNotFoundError as GraylogNotFoundError_p2 } from "../src/graylog/errors.js";

beforeEach_p2(() => {
    setActiveConnection_p2(null);
});
afterEach_p2(() => {
    _clearCaptureRequest_p2();
    setActiveConnection_p2(null);
});

function eventsMultiCapture_p2(routes) {
    return (req) => {
        for (const r of routes) {
            const matches = typeof r.pathPattern === "string"
                ? req.path === r.pathPattern
                : r.pathPattern.test(req.path);
            if (req.method === r.method && matches) {
                return typeof r.response === "function" ? r.response(req) : r.response;
            }
        }
        throw new Error(`No route matched ${req.method} ${req.path}`);
    };
}

// ---------- list_event_definitions tests ----------

test_p2("list_event_definitions HAPPY — projects 6 default keys per element from paginated envelope", async () => {
    const { handleListEventDefinitions } = await import("../src/tools/events/list-event-definitions.js");
    _setCaptureRequest_p2(() => ({
        elements: [
            { id: "1", title: "Spike Alert", description: "spike", priority: 2, state: "ENABLED", alert: true, scheduler: { is_scheduled: true } },
            { id: "2", title: "Quota Alert", description: "quota", priority: 3, state: "DISABLED", alert: false, scheduler: { is_scheduled: false } },
        ],
        total: 2,
    }));
    const res = await handleListEventDefinitions({
        params: { arguments: { _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "list_event_definitions");
    assert.equal(payload.count, 2);
    assert.deepEqual(payload.fields, ["id", "title", "description", "priority", "state", "alert"]);
    // Each item is the narrow projection — no `scheduler` field.
    assert.deepEqual(
        Object.keys(payload.items[0]).sort(),
        ["alert", "description", "id", "priority", "state", "title"],
    );
    assert.equal(payload.items[0].scheduler, undefined);
});

test_p2("list_event_definitions URL — bare paginated path with default page/per_page (no extra query params)", async () => {
    const { handleListEventDefinitions } = await import("../src/tools/events/list-event-definitions.js");
    let captured = null;
    _setCaptureRequest_p2((req) => {
        captured = req;
        return { elements: [], total: 0 };
    });
    await handleListEventDefinitions({
        params: { arguments: { _testConnection: "fake" } },
    });
    assert.equal(captured.method, "GET");
    assert.equal(captured.path, "/api/events/definitions/paginated?page=1&per_page=25");
});

test_p2("list_event_definitions URL — appends query/sort/order params when set", async () => {
    const { handleListEventDefinitions } = await import("../src/tools/events/list-event-definitions.js");
    let captured = null;
    _setCaptureRequest_p2((req) => {
        captured = req;
        return { elements: [], total: 0 };
    });
    await handleListEventDefinitions({
        params: {
            arguments: {
                _testConnection: "fake",
                query: "title:Alert",
                sort: "priority",
                order: "desc",
            },
        },
    });
    assert.equal(captured.path,
        "/api/events/definitions/paginated?page=1&per_page=25&query=title%3AAlert&sort=priority&order=desc");
});

test_p2("list_event_definitions fields:'all' bypasses the narrow projection", async () => {
    const { handleListEventDefinitions } = await import("../src/tools/events/list-event-definitions.js");
    _setCaptureRequest_p2(() => ({
        elements: [{ id: "1", title: "X", description: "y", priority: 2, state: "ENABLED", alert: true, scheduler: { is_scheduled: false } }],
        total: 1,
    }));
    const res = await handleListEventDefinitions({
        params: { arguments: { _testConnection: "fake", fields: "all" } },
    });
    const payload = JSON.parse(res.content[0].text);
    // fields:"all" → full item shape including scheduler
    assert.equal(payload.items[0].scheduler.is_scheduled, false);
});

// ---------- get_event_definition tests ----------

test_p2("get_event_definition HAPPY — emits {tool, connection, definition} envelope verbatim", async () => {
    const { handleGetEventDefinition } = await import("../src/tools/events/get-event-definition.js");
    const FULL_DTO = {
        id: "abc",
        title: "Spike Alert",
        description: "spike alert def",
        priority: 2,
        alert: true,
        config: { type: "aggregation-v1" },
        field_spec: {},
        key_spec: [],
        notification_settings: { grace_period_ms: 0, backlog_size: 0 },
        notifications: [{ notification_id: "n1" }],
        storage: [],
        state: "ENABLED",
        // Pitfall 5: scheduler is READ_ONLY — agent reads it via get_event_definition,
        // never echoes it back on update.
        scheduler: { is_scheduled: true, next_time: "2026-01-01T00:00:00Z" },
    };
    _setCaptureRequest_p2(() => FULL_DTO);
    const res = await handleGetEventDefinition({
        params: { arguments: { _testConnection: "fake", definitionId: "abc" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "get_event_definition");
    assert.deepEqual(payload.definition, FULL_DTO);
    assert.equal(payload.definition.scheduler.is_scheduled, true);
    assert.equal(payload.definition.notifications[0].notification_id, "n1");
});

test_p2("get_event_definition URL — /api/events/definitions/{id}", async () => {
    const { handleGetEventDefinition } = await import("../src/tools/events/get-event-definition.js");
    let captured = null;
    _setCaptureRequest_p2((req) => {
        captured = req;
        return { id: "abc", title: "x", config: {} };
    });
    await handleGetEventDefinition({
        params: { arguments: { _testConnection: "fake", definitionId: "abc" } },
    });
    assert.equal(captured.method, "GET");
    assert.equal(captured.path, "/api/events/definitions/abc");
});

test_p2("get_event_definition 404 → wrapGraylogError envelope (isError:true; tool name embedded)", async () => {
    const { handleGetEventDefinition } = await import("../src/tools/events/get-event-definition.js");
    _setCaptureRequest_p2(() => {
        throw new GraylogNotFoundError_p2("not found", {
            status: 404,
            method: "GET",
            path: "/api/events/definitions/missing",
            body: null,
        });
    });
    const res = await handleGetEventDefinition({
        params: { arguments: { _testConnection: "fake", definitionId: "missing" } },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /404/);
    assert.match(res.content[0].text, /get_event_definition/);
});

test_p2("get_event_definition rejects empty definitionId via schema", async () => {
    const { handleGetEventDefinition } = await import("../src/tools/events/get-event-definition.js");
    const res = await handleGetEventDefinition({
        params: { arguments: { _testConnection: "fake", definitionId: "" } },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /definitionId/);
});

// ---------- dispatch + tool-count ----------

test_p2("dispatch resolves list_event_definitions + get_event_definition after Plan 05-02 Task 1 registration", async () => {
    // Do NOT call _clearForTests here — we want the production registry as
    // populated by the side-effect imports. The ES-module cache means a
    // re-import would not re-fire registration calls; mirror the streams test
    // 10 pattern (test/streams.test.js:310).
    const { dispatch } = await import("../src/dispatch.js");
    await import("../src/tools/_register.js");
    _setCaptureRequest_p2(() => ({ elements: [], total: 0 }));
    const res = await dispatch({
        params: {
            name: "list_event_definitions",
            arguments: { _testConnection: "fake" },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "list_event_definitions");
    assert.equal(Array.isArray(payload.items), true);
});
