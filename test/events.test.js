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
import {
    setActiveConnection as setActiveConnection_p2,
    _setConnectionsForTests as _setConnectionsForTests_p2,
    _clearConnectionsForTests as _clearConnectionsForTests_p2,
} from "../src/config.js";
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

// =====================================================================
// Plan 05-02 Task 2 — create_event_definition (M1 + C5 acceptance gates)
// =====================================================================
//
// Every test below routes through the captured-request seam so build()'s
// findExistingMatches pre-flight (GET /api/events/definitions/paginated)
// receives a controlled response. The M1 + C5 acceptance gates are pinned
// here; Plan 05-05 will freeze the same JSON shapes as byte-stable
// snapshots.

// ---------- M1 ACCEPTANCE GATE — wire-path + summary proofs ----------

test_p2("create_event_definition M1 wire-path proof: ?schedule=false UNCONDITIONALLY", async () => {
    const { handleCreateEventDefinition } = await import("../src/tools/events/create-event-definition.js");
    _setCaptureRequest_p2(eventsMultiCapture_p2([
        { method: "GET", pathPattern: "/api/events/definitions/paginated", response: { elements: [], total: 0 } },
    ]));
    const res = await handleCreateEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definition: { title: "Spike Alert", config: { type: "aggregation-v1" } },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.path, "/api/events/definitions?schedule=false");
    assert.equal(payload.preview.method, "POST");
});

test_p2("create_event_definition M1 summary proof: postApplyEstimate.wouldStartScheduling === false", async () => {
    const { handleCreateEventDefinition } = await import("../src/tools/events/create-event-definition.js");
    _setCaptureRequest_p2(eventsMultiCapture_p2([
        { method: "GET", pathPattern: "/api/events/definitions/paginated", response: { elements: [], total: 0 } },
    ]));
    const res = await handleCreateEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definition: { title: "Spike Alert", config: { type: "aggregation-v1" } },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.postApplyEstimate.wouldStartScheduling, false);
    assert.equal(payload.postApplyEstimate.state, "DISABLED");
    assert.equal(payload.postApplyEstimate.id, "__SERVER_ASSIGNED__");
});

test_p2("create_event_definition M1 STRUCTURAL: agent CANNOT inject schedule:true (zod strip drops it)", async () => {
    const { handleCreateEventDefinition } = await import("../src/tools/events/create-event-definition.js");
    _setCaptureRequest_p2(eventsMultiCapture_p2([
        { method: "GET", pathPattern: "/api/events/definitions/paginated", response: { elements: [], total: 0 } },
    ]));
    const res = await handleCreateEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definition: { title: "Spike Alert", config: { type: "aggregation-v1" } },
                schedule: true,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // Wire path STILL has ?schedule=false (zod strip dropped the unknown key
    // before it could influence the build() callback).
    assert.equal(payload.preview.path, "/api/events/definitions?schedule=false");
});

// ---------- D-04 surface — schema rejects/strips `schedule` key ----------

test_p2("CreateEventDefinitionSchema strips agent-injected `schedule` key (D-04 defense-in-depth)", async () => {
    const { CreateEventDefinitionSchema } = await import("../src/tools/events/schemas.js");
    const args = CreateEventDefinitionSchema.parse({
        definition: { title: "x", config: {} },
        schedule: true,
    });
    assert.equal(args.schedule, undefined);
});

// ---------- C5 ACCEPTANCE GATE — v6→v7 migration visible ----------

test_p2("create_event_definition C5 GATE: v6 aggregation shape surfaces migration:{migrated:true, warnings}", async () => {
    const { handleCreateEventDefinition } = await import("../src/tools/events/create-event-definition.js");
    _setCaptureRequest_p2(eventsMultiCapture_p2([
        { method: "GET", pathPattern: "/api/events/definitions/paginated", response: { elements: [], total: 0 } },
    ]));
    const res = await handleCreateEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definition: {
                    title: "V6 Style",
                    config: {
                        type: "aggregation-v1",
                        conditions: {
                            expression: { type: "function", function: "count", parameter: "source" },
                        },
                    },
                },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.migration.migrated, true);
    assert.equal(payload.migration.warnings[0].migrated_from_v6_shape, true);
    assert.equal(payload.migration.warnings[0].emitted, "count_source");
    assert.deepEqual(
        payload.migration.warnings[0].original,
        { type: "function", function: "count", parameter: "source" },
    );
    // Wire body's entity.config.conditions.expression is the v7 number-ref.
    assert.deepEqual(
        payload.preview.body.entity.config.conditions.expression,
        { type: "number-ref", ref: "count_source" },
    );
});

test_p2("create_event_definition C5 NO-OP: v7 input passes through with NO migration key in dry-run", async () => {
    const { handleCreateEventDefinition } = await import("../src/tools/events/create-event-definition.js");
    _setCaptureRequest_p2(eventsMultiCapture_p2([
        { method: "GET", pathPattern: "/api/events/definitions/paginated", response: { elements: [], total: 0 } },
    ]));
    const res = await handleCreateEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definition: {
                    title: "V7 Style",
                    config: {
                        type: "aggregation-v1",
                        conditions: {
                            expression: { type: "number-ref", ref: "count_source" },
                        },
                    },
                },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // migration key omitted when migrated:false (keeps preview JSON lean).
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "migration"), false);
});

// ---------- Pitfall 3 — body wrap ----------

test_p2("create_event_definition Pitfall 3: body wraps in {entity, share_request: null} (CreateEntityRequest)", async () => {
    const { handleCreateEventDefinition } = await import("../src/tools/events/create-event-definition.js");
    _setCaptureRequest_p2(eventsMultiCapture_p2([
        { method: "GET", pathPattern: "/api/events/definitions/paginated", response: { elements: [], total: 0 } },
    ]));
    const res = await handleCreateEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definition: { title: "Spike Alert", config: {} },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.body.entity.title, "Spike Alert");
    assert.equal(payload.preview.body.share_request, null);
});

// ---------- Pitfall 8 — id stripped ----------

test_p2("create_event_definition Pitfall 8: definition.id stripped before POST (server assigns)", async () => {
    const { handleCreateEventDefinition } = await import("../src/tools/events/create-event-definition.js");
    _setCaptureRequest_p2(eventsMultiCapture_p2([
        { method: "GET", pathPattern: "/api/events/definitions/paginated", response: { elements: [], total: 0 } },
    ]));
    const res = await handleCreateEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definition: { id: "ghost", title: "Test", config: {} },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.body.entity.id, undefined);
});

// ---------- FOUND-11 — existingMatches probe ----------

test_p2("create_event_definition FOUND-11: existingMatches probe surfaces exact-title match via paginated elements", async () => {
    const { handleCreateEventDefinition } = await import("../src/tools/events/create-event-definition.js");
    _setCaptureRequest_p2(eventsMultiCapture_p2([
        {
            method: "GET",
            pathPattern: "/api/events/definitions/paginated",
            response: {
                elements: [
                    { id: "existing-1", title: "Spike Alert", priority: 2 },
                    { id: "other-2", title: "Quota Alert", priority: 3 },
                ],
                total: 2,
            },
        },
    ]));
    const res = await handleCreateEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definition: { title: "Spike Alert", config: {} },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.existingMatches.length, 1);
    assert.equal(payload.existingMatches[0].id, "existing-1");
    assert.equal(payload.existingMatches[0].title, "Spike Alert");
    assert.equal(payload.existingMatches[0].similarity_reason, "exact");
});

test_p2("create_event_definition existingMatches: empty array when no exact-title match in paginated elements", async () => {
    const { handleCreateEventDefinition } = await import("../src/tools/events/create-event-definition.js");
    _setCaptureRequest_p2(eventsMultiCapture_p2([
        {
            method: "GET",
            pathPattern: "/api/events/definitions/paginated",
            response: { elements: [{ id: "other", title: "Quota Alert" }], total: 1 },
        },
    ]));
    const res = await handleCreateEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definition: { title: "Spike Alert", config: {} },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(payload.existingMatches, []);
});

// ---------- dispatch + tool count ----------

test_p2("dispatch resolves create_event_definition after Plan 05-02 Task 2 registration", async () => {
    const { dispatch } = await import("../src/dispatch.js");
    await import("../src/tools/_register.js");
    _setCaptureRequest_p2(eventsMultiCapture_p2([
        { method: "GET", pathPattern: "/api/events/definitions/paginated", response: { elements: [], total: 0 } },
    ]));
    const res = await dispatch({
        params: {
            name: "create_event_definition",
            arguments: {
                _testConnection: "fake",
                definition: { title: "DispTest", config: {} },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "create_event_definition");
    assert.equal(payload.dryRun, true);
});

// =====================================================================
// Plan 05-02 Task 3 — update_event_definition (D-02 + STRICT_NO_ECHO + C5)
// =====================================================================
//
// STRICT_NO_ECHO partial-update contract:
//   - wire body emits ONLY fields the agent touched (omit-vs-explicit-null
//     preserved per Phase 1/3/4 precedent).
//   - body.id is always set to args.definitionId (Pitfall 8 — URL/body agreement).
//   - scheduler READ_ONLY contamination is structurally impossible (the
//     wrapper never round-trips a GET response).
// D-02 wire path: /api/events/definitions/{id}?schedule=false UNCONDITIONALLY.

test_p2("update_event_definition D-02 wire-path proof: /api/events/definitions/{id}?schedule=false", async () => {
    const { handleUpdateEventDefinition } = await import("../src/tools/events/update-event-definition.js");
    const res = await handleUpdateEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
                changes: { title: "New" },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.path, "/api/events/definitions/abc?schedule=false");
    assert.equal(payload.preview.method, "PUT");
});

test_p2("update_event_definition STRICT_NO_ECHO: title-only → body keys are EXACTLY [id, title]", async () => {
    const { handleUpdateEventDefinition } = await import("../src/tools/events/update-event-definition.js");
    const res = await handleUpdateEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
                changes: { title: "New" },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(Object.keys(payload.preview.body).sort(), ["id", "title"]);
    assert.equal(payload.preview.body.id, "abc");
    assert.equal(payload.preview.body.title, "New");
});

test_p2("update_event_definition STRICT_NO_ECHO: multi-field changes emit exactly the touched fields + id", async () => {
    const { handleUpdateEventDefinition } = await import("../src/tools/events/update-event-definition.js");
    const res = await handleUpdateEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
                changes: { title: "New", priority: 3 },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(Object.keys(payload.preview.body).sort(), ["id", "priority", "title"]);
    assert.equal(payload.preview.body.priority, 3);
});

test_p2("update_event_definition C5 migration fires when changes.config has a v6 expression", async () => {
    const { handleUpdateEventDefinition } = await import("../src/tools/events/update-event-definition.js");
    const res = await handleUpdateEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
                changes: {
                    config: {
                        type: "aggregation-v1",
                        conditions: {
                            expression: { type: "function", function: "count", parameter: "source" },
                        },
                    },
                },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.migration.migrated, true);
    assert.equal(payload.migration.warnings[0].emitted, "count_source");
    // Wire body's config carries the migrated expression.
    assert.deepEqual(
        payload.preview.body.config.conditions.expression,
        { type: "number-ref", ref: "count_source" },
    );
});

test_p2("update_event_definition C5 migration omitted when changes.config absent", async () => {
    const { handleUpdateEventDefinition } = await import("../src/tools/events/update-event-definition.js");
    const res = await handleUpdateEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
                changes: { title: "New" },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "migration"), false);
});

test_p2("update_event_definition Pitfall 5: scheduler NEVER on the wire (STRICT_NO_ECHO prevents structurally)", async () => {
    const { handleUpdateEventDefinition } = await import("../src/tools/events/update-event-definition.js");
    const res = await handleUpdateEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
                changes: { title: "New" },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // The wire body should not contain a `scheduler` key — STRICT_NO_ECHO
    // means the wrapper never round-trips a GET, so the READ_ONLY field
    // physically cannot reach the wire (Pitfall 5 mitigation).
    assert.equal(Object.prototype.hasOwnProperty.call(payload.preview.body, "scheduler"), false);
    // Defense-in-depth: also check the JSON string for the literal "scheduler"
    // — that would catch any accidental nested echoing too.
    assert.doesNotMatch(res.content[0].text, /"scheduler"/);
});

test_p2("update_event_definition D-02 STRUCTURAL: agent CANNOT inject schedule:true (zod strip drops it)", async () => {
    const { handleUpdateEventDefinition } = await import("../src/tools/events/update-event-definition.js");
    const res = await handleUpdateEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
                changes: { title: "x" },
                schedule: true,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.path, "/api/events/definitions/abc?schedule=false");
});

test_p2("update_event_definition Pitfall 8: body.id matches URL segment", async () => {
    const { handleUpdateEventDefinition } = await import("../src/tools/events/update-event-definition.js");
    const res = await handleUpdateEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
                changes: { title: "New" },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.body.id, "abc");
    assert.match(payload.preview.path, /\/abc\?schedule=false$/);
});

// ---------- dispatch + tool count ----------

test_p2("dispatch resolves update_event_definition after Plan 05-02 Task 3 registration", async () => {
    const { dispatch } = await import("../src/dispatch.js");
    await import("../src/tools/_register.js");
    const res = await dispatch({
        params: {
            name: "update_event_definition",
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
                changes: { title: "DispTest" },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "update_event_definition");
    assert.equal(payload.dryRun, true);
});

// =====================================================================
// Plan 05-03 Task 1 — enable_event_definition + disable_event_definition
// =====================================================================
//
// EVENT-06 (D-07 / Pitfall 4 — WILDCARD empty body). Both verbs:
//   - compose through defineMutatingHandler (lifecycle-as-mutation contract;
//     mirror of Phase 1 INPUT-07 start_input / stop_input D-08 precedent).
//   - emit empty body per 05-U1-SMOKE.md `chosen_default` (UNREACHABLE →
//     body: undefined).
//   - inherit writable-gate + idempotency + dryRun:true default from
//     mutatingBase + defineMutatingHandler.
//
// The wire paths diverge ONLY in the trailing segment:
//   enable  → PUT /api/events/definitions/{id}/schedule
//   disable → PUT /api/events/definitions/{id}/unschedule
//
// postApplyEstimate.state ENABLED / DISABLED makes the eventually-consistent
// state transition visible to the agent in the dry-run preview.

test_p2("enable_event_definition wire path: PUT /api/events/definitions/{id}/schedule", async () => {
    const { handleEnableEventDefinition } = await import("../src/tools/events/enable-event-definition.js");
    const res = await handleEnableEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.method, "PUT");
    assert.equal(payload.preview.path, "/api/events/definitions/abc/schedule");
});

test_p2("disable_event_definition wire path: PUT /api/events/definitions/{id}/unschedule", async () => {
    const { handleDisableEventDefinition } = await import("../src/tools/events/disable-event-definition.js");
    const res = await handleDisableEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.method, "PUT");
    assert.equal(payload.preview.path, "/api/events/definitions/abc/unschedule");
});

test_p2("enable_event_definition empty body per 05-U1-SMOKE.md chosen_default (UNREACHABLE → undefined)", async () => {
    const { handleEnableEventDefinition } = await import("../src/tools/events/enable-event-definition.js");
    const res = await handleEnableEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // body_undefined: JSON.stringify drops `body: undefined` so the key is
    // absent from preview. body_empty_string would set preview.body === "".
    // Plan 05-01's 05-U1-SMOKE.md locked UNREACHABLE → body: undefined.
    const previewHasBody = Object.prototype.hasOwnProperty.call(payload.preview, "body");
    const bodyIsEmptyString = payload.preview.body === "";
    assert.ok(
        !previewHasBody || bodyIsEmptyString,
        `enable_event_definition wire body must be undefined (omitted) OR "" per chosen_default; got ${JSON.stringify(payload.preview.body)}`,
    );
});

test_p2("disable_event_definition empty body per 05-U1-SMOKE.md chosen_default", async () => {
    const { handleDisableEventDefinition } = await import("../src/tools/events/disable-event-definition.js");
    const res = await handleDisableEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    const previewHasBody = Object.prototype.hasOwnProperty.call(payload.preview, "body");
    const bodyIsEmptyString = payload.preview.body === "";
    assert.ok(
        !previewHasBody || bodyIsEmptyString,
        `disable_event_definition wire body must be undefined (omitted) OR "" per chosen_default; got ${JSON.stringify(payload.preview.body)}`,
    );
});

test_p2("enable_event_definition postApplyEstimate: {id, state: ENABLED}", async () => {
    const { handleEnableEventDefinition } = await import("../src/tools/events/enable-event-definition.js");
    const res = await handleEnableEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(payload.postApplyEstimate, { id: "abc", state: "ENABLED" });
});

test_p2("disable_event_definition postApplyEstimate: {id, state: DISABLED}", async () => {
    const { handleDisableEventDefinition } = await import("../src/tools/events/disable-event-definition.js");
    const res = await handleDisableEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(payload.postApplyEstimate, { id: "abc", state: "DISABLED" });
});

test_p2("enable_event_definition writable=false short-circuits BEFORE build()", async () => {
    _setConnectionsForTests_p2({
        readonly: { baseUrl: "x", apiToken: "x", writable: false },
    });
    const { handleEnableEventDefinition } = await import("../src/tools/events/enable-event-definition.js");
    const res = await handleEnableEventDefinition({
        params: {
            arguments: {
                connectionName: "readonly",
                definitionId: "abc",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "connection_read_only");
    _clearConnectionsForTests_p2();
});

test_p2("disable_event_definition writable=false short-circuits BEFORE build()", async () => {
    _setConnectionsForTests_p2({
        readonly: { baseUrl: "x", apiToken: "x", writable: false },
    });
    const { handleDisableEventDefinition } = await import("../src/tools/events/disable-event-definition.js");
    const res = await handleDisableEventDefinition({
        params: {
            arguments: {
                connectionName: "readonly",
                definitionId: "abc",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "connection_read_only");
    _clearConnectionsForTests_p2();
});

test_p2("enable_event_definition inherits idempotencyKey auto-derive (32-hex)", async () => {
    const { handleEnableEventDefinition } = await import("../src/tools/events/enable-event-definition.js");
    const res = await handleEnableEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.match(payload.idempotencyKey, /^[0-9a-f]{32}$/);
});

test_p2("enable_event_definition inherits dryRun:true default (no args.dryRun)", async () => {
    const { handleEnableEventDefinition } = await import("../src/tools/events/enable-event-definition.js");
    const res = await handleEnableEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
});

// ---------- dispatch + tool-count ----------

test_p2("dispatch resolves enable_event_definition + disable_event_definition after Plan 05-03 Task 1 registration", async () => {
    const { dispatch } = await import("../src/dispatch.js");
    await import("../src/tools/_register.js");
    const resEnable = await dispatch({
        params: {
            name: "enable_event_definition",
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
            },
        },
    });
    const payloadEnable = JSON.parse(resEnable.content[0].text);
    assert.equal(payloadEnable.tool, "enable_event_definition");
    assert.equal(payloadEnable.dryRun, true);

    const resDisable = await dispatch({
        params: {
            name: "disable_event_definition",
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
            },
        },
    });
    const payloadDisable = JSON.parse(resDisable.content[0].text);
    assert.equal(payloadDisable.tool, "disable_event_definition");
    assert.equal(payloadDisable.dryRun, true);
});

// =====================================================================
// Plan 05-03 Task 2 — delete_event_definition (D-08 informational cascade)
// =====================================================================
//
// EVENT-05 (D-08 informational cascade — mirror Phase 1 delete_input):
//   - DELETE /api/events/definitions/{id}.
//   - Pre-flights GET /api/events/definitions/{id} to read the current
//     `notifications[]` array; populates `cascades.notifications` in the
//     dry-run preview JSON.
//   - INFORMATIONAL ONLY — NO confirmationToken issued. Notifications survive
//     the delete (they are independent resources owned by EVENT-07..EVENT-09);
//     only the def→notification wiring vanishes.
//   - Pre-flight is best-effort: 404 / 403 falls through to an empty cascades
//     array; the DELETE itself surfaces the real error via wrapGraylogError.
//
// CONTRAST with Plan 05-04's delete_event_notification (D-09):
//   - Notifications are LOAD-BEARING (delete is destructive across the
//     def→notification linkage AND across all event-procedure references).
//   - That handler ISSUES a 64-hex cascade-hash + REFUSES drift at apply
//     time. D-08 here does NOT — the wiring loss is observable but not
//     destructive.

test_p2("delete_event_definition wire path: DELETE /api/events/definitions/{id}", async () => {
    const { handleDeleteEventDefinition } = await import("../src/tools/events/delete-event-definition.js");
    _setCaptureRequest_p2(eventsMultiCapture_p2([
        { method: "GET", pathPattern: "/api/events/definitions/abc", response: { id: "abc", notifications: [] } },
    ]));
    const res = await handleDeleteEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.method, "DELETE");
    assert.equal(payload.preview.path, "/api/events/definitions/abc");
});

test_p2("delete_event_definition D-08 informational cascade populated from pre-flight notifications[]", async () => {
    const { handleDeleteEventDefinition } = await import("../src/tools/events/delete-event-definition.js");
    _setCaptureRequest_p2(eventsMultiCapture_p2([
        {
            method: "GET",
            pathPattern: "/api/events/definitions/abc",
            response: {
                id: "abc",
                title: "Spike Alert",
                notifications: [
                    { notification_id: "notif-1", notification_parameters: null },
                    { notification_id: "notif-2", notification_parameters: { threshold: 10 } },
                ],
            },
        },
    ]));
    const res = await handleDeleteEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(payload.cascades.notifications, [
        { notification_id: "notif-1", notification_parameters: null },
        { notification_id: "notif-2", notification_parameters: { threshold: 10 } },
    ]);
});

test_p2("delete_event_definition D-08 issues NO confirmationToken (informational, not refusal gate)", async () => {
    const { handleDeleteEventDefinition } = await import("../src/tools/events/delete-event-definition.js");
    _setCaptureRequest_p2(eventsMultiCapture_p2([
        {
            method: "GET",
            pathPattern: "/api/events/definitions/abc",
            response: {
                id: "abc",
                notifications: [
                    { notification_id: "notif-1", notification_parameters: null },
                    { notification_id: "notif-2", notification_parameters: { threshold: 10 } },
                ],
            },
        },
    ]));
    const res = await handleDeleteEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // INFORMATIONAL cascade — confirmationToken key MUST be absent.
    // Contrast with delete_event_notification (Plan 05-04) which DOES issue
    // a 64-hex cascade-hash.
    assert.equal("confirmationToken" in payload, false);
});

test_p2("delete_event_definition D-08 best-effort: 404 pre-flight → empty cascades.notifications", async () => {
    const { handleDeleteEventDefinition } = await import("../src/tools/events/delete-event-definition.js");
    _setCaptureRequest_p2(() => {
        throw new GraylogNotFoundError_p2("not found", {
            status: 404,
            method: "GET",
            path: "/api/events/definitions/missing",
            body: null,
        });
    });
    const res = await handleDeleteEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "missing",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // Best-effort: pre-flight 404 falls through to empty array, NOT missing.
    // The DELETE itself will surface the real 404 on apply via wrapGraylogError.
    assert.deepEqual(payload.cascades.notifications, []);
});

test_p2("delete_event_definition D-08 best-effort: 403 pre-flight → empty cascades.notifications", async () => {
    const { GraylogPermissionError } = await import("../src/graylog/errors.js");
    const { handleDeleteEventDefinition } = await import("../src/tools/events/delete-event-definition.js");
    _setCaptureRequest_p2(() => {
        throw new GraylogPermissionError("forbidden", {
            status: 403,
            method: "GET",
            path: "/api/events/definitions/locked",
            body: null,
        });
    });
    const res = await handleDeleteEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "locked",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(payload.cascades.notifications, []);
});

test_p2("delete_event_definition: NO cascade-hash code path (static-grep proof)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const __dir = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
        join(__dir, "..", "src", "tools", "events", "delete-event-definition.js"),
        "utf8",
    );
    // D-08 informational — none of these symbols may appear in the handler.
    assert.equal(src.includes("_confirmationToken"), false, "delete_event_definition must NOT set _confirmationToken");
    assert.equal(src.includes("computeCascadeHash"), false, "delete_event_definition must NOT import computeCascadeHash");
    assert.equal(src.includes("computeNotificationCascadeHash"), false, "delete_event_definition must NOT import computeNotificationCascadeHash");
});

test_p2("delete_event_definition postApplyEstimate: {id, deleted: true}", async () => {
    const { handleDeleteEventDefinition } = await import("../src/tools/events/delete-event-definition.js");
    _setCaptureRequest_p2(eventsMultiCapture_p2([
        { method: "GET", pathPattern: "/api/events/definitions/abc", response: { id: "abc", notifications: [] } },
    ]));
    const res = await handleDeleteEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.deepEqual(payload.postApplyEstimate, { id: "abc", deleted: true });
});

test_p2("delete_event_definition writable=false short-circuits BEFORE pre-flight GET", async () => {
    _setConnectionsForTests_p2({
        readonly: { baseUrl: "x", apiToken: "x", writable: false },
    });
    // Capture seam must NOT be hit — writable gate short-circuits in handler.js
    // step 3, BEFORE build() runs. Set a poisoned route to verify.
    _setCaptureRequest_p2(() => {
        throw new Error("Pre-flight GET fired despite writable=false; gate is broken");
    });
    const { handleDeleteEventDefinition } = await import("../src/tools/events/delete-event-definition.js");
    const res = await handleDeleteEventDefinition({
        params: {
            arguments: {
                connectionName: "readonly",
                definitionId: "abc",
            },
        },
    });
    assert.equal(res.isError, true);
    assert.equal(res.reason, "connection_read_only");
    _clearConnectionsForTests_p2();
});

test_p2("delete_event_definition apply: pre-flight GET + DELETE fire in order; applied:true", async () => {
    const { handleDeleteEventDefinition } = await import("../src/tools/events/delete-event-definition.js");
    const captured = [];
    _setCaptureRequest_p2((req) => {
        captured.push({ method: req.method, path: req.path });
        if (req.method === "GET" && req.path === "/api/events/definitions/abc") {
            return { id: "abc", notifications: [{ notification_id: "n1" }] };
        }
        if (req.method === "DELETE" && req.path === "/api/events/definitions/abc") {
            return { id: "abc", deleted: true };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleDeleteEventDefinition({
        params: {
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
                dryRun: false,
            },
        },
    });
    // Both pre-flight GET (from build) and DELETE (from apply) must fire.
    assert.deepEqual(captured, [
        { method: "GET", path: "/api/events/definitions/abc" },
        { method: "DELETE", path: "/api/events/definitions/abc" },
    ]);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
});

// ---------- dispatch + tool count ----------

test_p2("dispatch resolves delete_event_definition after Plan 05-03 Task 2 registration", async () => {
    const { dispatch } = await import("../src/dispatch.js");
    await import("../src/tools/_register.js");
    _setCaptureRequest_p2(eventsMultiCapture_p2([
        { method: "GET", pathPattern: "/api/events/definitions/abc", response: { id: "abc", notifications: [] } },
    ]));
    const res = await dispatch({
        params: {
            name: "delete_event_definition",
            arguments: {
                _testConnection: "fake",
                definitionId: "abc",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "delete_event_definition");
    assert.equal(payload.dryRun, true);
});

// =====================================================================
// Plan 05-04 Task 1 — list_event_notifications + create_event_notification
// =====================================================================
//
// EVENT-07 (list_event_notifications):
//   - GET /api/events/notifications/paginated → unwrap response.elements.
//   - Narrow projection [id, title, description, config] (defineListHandler
//     projectItem helper is dot-notation-unaware; config carried verbatim).
//   - URL byte-stable: page=1 + per_page=<limit>; query/sort/order appended
//     only when set.
//
// EVENT-08 (create_event_notification):
//   - D-05 / D-06 closed-set discriminator: 6 valid types + zod.parse-time
//     rejection of script-notification-v1 / pagerduty-notification-v1 /
//     teams-notification-v1 (Pitfall 6 corrected).
//   - Pitfall 3 CreateEntityRequest envelope.
//   - FOUND-11 existingMatches probe via /api/events/notifications/paginated.
//   - C3 (T-05-04-03) for http-notification-v2: encrypted basic_auth +
//     api_secret wrapped as {set_value} on the wire body; <redacted> in
//     the dry-run preview body. _applyBody sibling pattern keeps the
//     redacted preview away from Graylog.

// ---------- list_event_notifications tests ----------

test_p2("list_event_notifications HAPPY — narrow projection [id, title, description, config] from paginated elements", async () => {
    const { handleListEventNotifications } = await import(
        "../src/tools/events/list-event-notifications.js"
    );
    _setCaptureRequest_p2(() => ({
        elements: [
            {
                id: "n1",
                title: "Email Alerts",
                description: "ops email",
                config: { type: "email-notification-v1", subject: "Spike" },
                notification_settings: { grace_period_ms: 0 },
            },
            {
                id: "n2",
                title: "Slack Alerts",
                description: "ops slack",
                config: { type: "slack-notification-v1", channel: "#general" },
                notification_settings: { grace_period_ms: 0 },
            },
        ],
        total: 2,
    }));
    const res = await handleListEventNotifications({
        params: { arguments: { _testConnection: "fake" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "list_event_notifications");
    assert.equal(payload.count, 2);
    assert.deepEqual(payload.fields, ["id", "title", "description", "config"]);
    // Narrow projection drops notification_settings; config travels verbatim.
    assert.deepEqual(
        Object.keys(payload.items[0]).sort(),
        ["config", "description", "id", "title"],
    );
    assert.equal(payload.items[0].config.type, "email-notification-v1");
    assert.equal(payload.items[0].notification_settings, undefined);
});

test_p2("list_event_notifications URL — bare paginated path with default page/per_page (no extra query params)", async () => {
    const { handleListEventNotifications } = await import(
        "../src/tools/events/list-event-notifications.js"
    );
    let captured = null;
    _setCaptureRequest_p2((req) => {
        captured = req;
        return { elements: [], total: 0 };
    });
    await handleListEventNotifications({
        params: { arguments: { _testConnection: "fake" } },
    });
    assert.equal(captured.method, "GET");
    assert.equal(captured.path, "/api/events/notifications/paginated?page=1&per_page=25");
});

test_p2("list_event_notifications URL — appends query/sort/order when set", async () => {
    const { handleListEventNotifications } = await import(
        "../src/tools/events/list-event-notifications.js"
    );
    let captured = null;
    _setCaptureRequest_p2((req) => {
        captured = req;
        return { elements: [], total: 0 };
    });
    await handleListEventNotifications({
        params: {
            arguments: {
                _testConnection: "fake",
                query: "title:Email",
                sort: "type",
                order: "desc",
            },
        },
    });
    assert.equal(
        captured.path,
        "/api/events/notifications/paginated?page=1&per_page=25&query=title%3AEmail&sort=type&order=desc",
    );
});

test_p2("list_event_notifications fields:'all' bypasses the narrow projection", async () => {
    const { handleListEventNotifications } = await import(
        "../src/tools/events/list-event-notifications.js"
    );
    _setCaptureRequest_p2(() => ({
        elements: [{
            id: "n1",
            title: "X",
            description: "y",
            config: { type: "email-notification-v1" },
            notification_settings: { grace_period_ms: 0, backlog_size: 0 },
        }],
        total: 1,
    }));
    const res = await handleListEventNotifications({
        params: { arguments: { _testConnection: "fake", fields: "all" } },
    });
    const payload = JSON.parse(res.content[0].text);
    // fields:"all" → full item shape including notification_settings.
    assert.equal(payload.items[0].notification_settings.grace_period_ms, 0);
});

// ---------- create_event_notification tests ----------

test_p2("create_event_notification slack-notification-v1 accepted; body wraps in CreateEntityRequest envelope", async () => {
    const { handleCreateEventNotification } = await import(
        "../src/tools/events/create-event-notification.js"
    );
    _setCaptureRequest_p2(eventsMultiCapture_p2([
        { method: "GET", pathPattern: "/api/events/notifications/paginated", response: { elements: [], total: 0 } },
    ]));
    const res = await handleCreateEventNotification({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "Slack alerts",
                config: {
                    type: "slack-notification-v1",
                    webhook_url: "https://hooks.slack.com/services/X/Y/Z",
                    channel: "#general",
                    color: "#ff0500",
                    include_title: true,
                },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.preview.method, "POST");
    assert.equal(payload.preview.path, "/api/events/notifications");
    // Pitfall 3: CreateEntityRequest envelope.
    assert.equal(payload.preview.body.entity.title, "Slack alerts");
    assert.equal(payload.preview.body.entity.config.type, "slack-notification-v1");
    assert.equal(payload.preview.body.share_request, null);
});

test_p2("create_event_notification email-notification-v1 accepted (CreateEntityRequest envelope)", async () => {
    const { handleCreateEventNotification } = await import(
        "../src/tools/events/create-event-notification.js"
    );
    _setCaptureRequest_p2(eventsMultiCapture_p2([
        { method: "GET", pathPattern: "/api/events/notifications/paginated", response: { elements: [], total: 0 } },
    ]));
    const res = await handleCreateEventNotification({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "Email alerts",
                config: {
                    type: "email-notification-v1",
                    subject: "Spike",
                    email_recipients: ["ops@example.com"],
                    body_template: "Alert",
                },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.body.entity.title, "Email alerts");
    assert.equal(payload.preview.body.entity.config.type, "email-notification-v1");
    assert.deepEqual(payload.preview.body.entity.config.email_recipients, ["ops@example.com"]);
});

test_p2("create_event_notification http-notification-v2 accepted; encrypted basic_auth + api_secret <redacted> in preview", async () => {
    const { handleCreateEventNotification } = await import(
        "../src/tools/events/create-event-notification.js"
    );
    _setCaptureRequest_p2(eventsMultiCapture_p2([
        { method: "GET", pathPattern: "/api/events/notifications/paginated", response: { elements: [], total: 0 } },
    ]));
    const res = await handleCreateEventNotification({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "HTTP v2",
                config: {
                    type: "http-notification-v2",
                    url: "https://hook.example/",
                    method: "POST",
                    basic_auth: "secret123",
                    api_secret: "key456",
                },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // C3 / T-05-04-03: dry-run preview hides the encrypted values.
    assert.equal(payload.preview.body.entity.config.basic_auth, "<redacted>");
    assert.equal(payload.preview.body.entity.config.api_secret, "<redacted>");
    assert.equal(payload.preview.body.entity.config.url, "https://hook.example/");
});

test_p2("create_event_notification pagerduty-notification-v2 accepted (32-char routing_key)", async () => {
    const { handleCreateEventNotification } = await import(
        "../src/tools/events/create-event-notification.js"
    );
    _setCaptureRequest_p2(eventsMultiCapture_p2([
        { method: "GET", pathPattern: "/api/events/notifications/paginated", response: { elements: [], total: 0 } },
    ]));
    const res = await handleCreateEventNotification({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "PD",
                config: {
                    type: "pagerduty-notification-v2",
                    routing_key: "a".repeat(32),
                    custom_incident: false,
                    client_name: "Graylog",
                    client_url: "https://graylog.example/",
                },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.body.entity.config.type, "pagerduty-notification-v2");
    assert.equal(payload.preview.body.entity.config.routing_key.length, 32);
});

test_p2("create_event_notification teams-notification-v2 accepted (valid JSON adaptive_card)", async () => {
    const { handleCreateEventNotification } = await import(
        "../src/tools/events/create-event-notification.js"
    );
    _setCaptureRequest_p2(eventsMultiCapture_p2([
        { method: "GET", pathPattern: "/api/events/notifications/paginated", response: { elements: [], total: 0 } },
    ]));
    const res = await handleCreateEventNotification({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "Teams",
                config: {
                    type: "teams-notification-v2",
                    webhook_url: "https://outlook.office.com/webhook/X",
                    adaptive_card: "{}",
                },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.body.entity.config.type, "teams-notification-v2");
    assert.equal(payload.preview.body.entity.config.adaptive_card, "{}");
});

test_p2("create_event_notification http-notification-v1 accepted (single-field variant)", async () => {
    const { handleCreateEventNotification } = await import(
        "../src/tools/events/create-event-notification.js"
    );
    _setCaptureRequest_p2(eventsMultiCapture_p2([
        { method: "GET", pathPattern: "/api/events/notifications/paginated", response: { elements: [], total: 0 } },
    ]));
    const res = await handleCreateEventNotification({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "Webhook",
                config: {
                    type: "http-notification-v1",
                    url: "https://hook.example/",
                },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.body.entity.config.type, "http-notification-v1");
    assert.equal(payload.preview.body.entity.config.url, "https://hook.example/");
});

test_p2("create_event_notification REJECTS script-notification-v1 at zod.parse (D-05 corrected; type does not exist)", async () => {
    const { handleCreateEventNotification } = await import(
        "../src/tools/events/create-event-notification.js"
    );
    // Poison the capture seam — any HTTP call means the schema let through.
    _setCaptureRequest_p2(() => {
        throw new Error("HTTP call fired despite invalid discriminator value");
    });
    const res = await handleCreateEventNotification({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "Script",
                config: { type: "script-notification-v1", command: "echo" },
            },
        },
    });
    assert.equal(res.isError, true);
    // zod's discriminated-union error names the closed set.
    assert.match(res.content[0].text, /script-notification-v1|Invalid discriminator/);
});

test_p2("create_event_notification REJECTS pagerduty-notification-v1 at zod.parse (D-05 corrected; correct is -v2)", async () => {
    const { handleCreateEventNotification } = await import(
        "../src/tools/events/create-event-notification.js"
    );
    _setCaptureRequest_p2(() => {
        throw new Error("HTTP call fired despite invalid discriminator value");
    });
    const res = await handleCreateEventNotification({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "PD v1",
                config: { type: "pagerduty-notification-v1", routing_key: "x" },
            },
        },
    });
    assert.equal(res.isError, true);
});

test_p2("create_event_notification REJECTS teams-notification-v1 at zod.parse (D-05; deprecated, only -v2 supported)", async () => {
    const { handleCreateEventNotification } = await import(
        "../src/tools/events/create-event-notification.js"
    );
    _setCaptureRequest_p2(() => {
        throw new Error("HTTP call fired despite invalid discriminator value");
    });
    const res = await handleCreateEventNotification({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "Teams v1",
                config: { type: "teams-notification-v1", webhook_url: "x" },
            },
        },
    });
    assert.equal(res.isError, true);
});

test_p2("create_event_notification FOUND-11 existingMatches probe fires against /api/events/notifications/paginated", async () => {
    const { handleCreateEventNotification } = await import(
        "../src/tools/events/create-event-notification.js"
    );
    _setCaptureRequest_p2(eventsMultiCapture_p2([
        {
            method: "GET",
            pathPattern: "/api/events/notifications/paginated",
            response: {
                elements: [
                    { id: "existing-1", title: "Slack alerts", config: { type: "slack-notification-v1" } },
                    { id: "other-2", title: "Email alerts", config: { type: "email-notification-v1" } },
                ],
                total: 2,
            },
        },
    ]));
    const res = await handleCreateEventNotification({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "Slack alerts",
                config: {
                    type: "slack-notification-v1",
                    webhook_url: "https://hooks.slack.com/services/X/Y/Z",
                    channel: "#general",
                    color: "#ff0500",
                    include_title: true,
                },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.existingMatches.length, 1);
    assert.equal(payload.existingMatches[0].id, "existing-1");
    assert.equal(payload.existingMatches[0].title, "Slack alerts");
    assert.equal(payload.existingMatches[0].similarity_reason, "exact");
});

test_p2("create_event_notification C3 wire/preview asymmetry — http-v2 apply body wraps via {set_value}; preview shows <redacted>", async () => {
    const { handleCreateEventNotification } = await import(
        "../src/tools/events/create-event-notification.js"
    );
    // Capture the apply POST so we can inspect the wire body separately from
    // the dry-run preview body.
    const captured = [];
    _setCaptureRequest_p2((req) => {
        captured.push({ method: req.method, path: req.path, body: req.body });
        if (req.method === "GET" && req.path.startsWith("/api/events/notifications/paginated")) {
            return { elements: [], total: 0 };
        }
        if (req.method === "POST" && req.path === "/api/events/notifications") {
            return { id: "new-notif", title: req.body?.entity?.title ?? "?" };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleCreateEventNotification({
        params: {
            arguments: {
                _testConnection: "fake",
                title: "HTTP v2 wire",
                dryRun: false,
                config: {
                    type: "http-notification-v2",
                    url: "https://hook.example/",
                    method: "POST",
                    basic_auth: "secret123",
                    api_secret: "key456",
                },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    // Wire body sent to Graylog: encrypted fields wrap as {set_value}.
    const postCall = captured.find((c) => c.method === "POST");
    assert.ok(postCall, "POST /api/events/notifications must fire on apply");
    assert.deepEqual(postCall.body.entity.config.basic_auth, { set_value: "secret123" });
    assert.deepEqual(postCall.body.entity.config.api_secret, { set_value: "key456" });
    // Non-encrypted url passes through verbatim.
    assert.equal(postCall.body.entity.config.url, "https://hook.example/");
});

// ---------- dispatch + tool-count ----------

test_p2("dispatch resolves list_event_notifications + create_event_notification after Plan 05-04 Task 1 registration", async () => {
    const { dispatch } = await import("../src/dispatch.js");
    await import("../src/tools/_register.js");
    // Route both the list handler's paginated GET (with ?page=1&per_page=25
    // query string) and the create handler's bare-path probe with one
    // permissive seam — multiCapture's strict-equality path matcher doesn't
    // accept the list handler's query-string-suffixed URL.
    _setCaptureRequest_p2((req) => {
        if (req.method === "GET" && req.path.startsWith("/api/events/notifications/paginated")) {
            return { elements: [], total: 0 };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const resList = await dispatch({
        params: {
            name: "list_event_notifications",
            arguments: { _testConnection: "fake" },
        },
    });
    const payloadList = JSON.parse(resList.content[0].text);
    assert.equal(payloadList.tool, "list_event_notifications");

    const resCreate = await dispatch({
        params: {
            name: "create_event_notification",
            arguments: {
                _testConnection: "fake",
                title: "DispTest",
                config: {
                    type: "http-notification-v1",
                    url: "https://hook.example/",
                },
            },
        },
    });
    const payloadCreate = JSON.parse(resCreate.content[0].text);
    assert.equal(payloadCreate.tool, "create_event_notification");
    assert.equal(payloadCreate.dryRun, true);
});

// =====================================================================
// Plan 05-04 Task 2 — update_event_notification (STRICT_NO_ECHO + C3)
// =====================================================================
//
// EVENT-09 part A — D-10 STRICT_NO_ECHO partial-update:
//   - wire body emits ONLY fields the agent touched.
//   - body.id always matches the URL segment (Pitfall 8).
//   - http-notification-v2 encrypted basic_auth + api_secret are NEVER on
//     the wire when the agent did not pass them (C3 / T-05-04-02 ACCEPTANCE GATE).
//   - encrypted fields the agent DID pass wrap as {set_value:<new>} on the wire
//     and surface as <redacted> in the dry-run preview (T-05-04-03).
//   - variant change replaces the variant entirely; old fields ABSENT.
//   - schema rejects invalid discriminator values in changes.config (closed-set).

test_p2("update_event_notification STRICT_NO_ECHO: title-only → wire body keys are EXACTLY [id, title]", async () => {
    const { handleUpdateEventNotification } = await import(
        "../src/tools/events/update-event-notification.js"
    );
    const captured = [];
    _setCaptureRequest_p2((req) => {
        captured.push({ method: req.method, path: req.path, body: req.body });
        if (req.method === "GET" && req.path === "/api/events/notifications/abc") {
            return {
                id: "abc",
                title: "Old",
                description: "x",
                config: {
                    type: "slack-notification-v1",
                    channel: "#a",
                    webhook_url: "https://hook.example/",
                    color: "#ff0500",
                    include_title: true,
                },
            };
        }
        if (req.method === "PUT" && req.path === "/api/events/notifications/abc") {
            return { id: "abc", title: req.body?.title ?? "?" };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleUpdateEventNotification({
        params: {
            arguments: {
                _testConnection: "fake",
                dryRun: false,
                notificationId: "abc",
                changes: { title: "New" },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
    const putCall = captured.find((c) => c.method === "PUT");
    assert.ok(putCall, "PUT must fire on apply");
    assert.deepEqual(Object.keys(putCall.body).sort(), ["id", "title"]);
    assert.equal(putCall.body.id, "abc");
    assert.equal(putCall.body.title, "New");
});

test_p2("update_event_notification STRICT_NO_ECHO: changes.config forwards the agent's per-variant block verbatim (no current.config echo)", async () => {
    // [Rule 1 - Bug] Plan test 2 specified a partial slack config ({type, color}),
    // but Plan 05-01's NotificationConfigSchema validates each variant's FULL
    // required-field set at zod.parse (slack-v1 requires webhook_url + channel
    // per Java SlackEventNotificationConfig.java:46-178). STRICT_NO_ECHO at this
    // layer means: the agent's config block (whatever they passed) flows onto
    // the wire verbatim — fields from current.config are NEVER echoed. The
    // C3 ACCEPTANCE GATE (next test) exercises the C3-specific case where
    // omitting an OPTIONAL encrypted field keeps it off the wire.
    const { handleUpdateEventNotification } = await import(
        "../src/tools/events/update-event-notification.js"
    );
    const captured = [];
    _setCaptureRequest_p2((req) => {
        captured.push({ method: req.method, path: req.path, body: req.body });
        if (req.method === "GET" && req.path === "/api/events/notifications/abc") {
            return {
                id: "abc",
                title: "Old",
                description: "x",
                // Current state has DIFFERENT field values (channel #old, color #ff0500).
                // The wire body MUST reflect only the agent's input — never current.
                config: {
                    type: "slack-notification-v1",
                    channel: "#old",
                    webhook_url: "https://old.example/",
                    color: "#ff0500",
                    include_title: true,
                    user_name: "graylog-bot",
                },
            };
        }
        if (req.method === "PUT" && req.path === "/api/events/notifications/abc") {
            return { id: "abc" };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleUpdateEventNotification({
        params: {
            arguments: {
                _testConnection: "fake",
                dryRun: false,
                notificationId: "abc",
                changes: {
                    config: {
                        type: "slack-notification-v1",
                        webhook_url: "https://new.example/",
                        channel: "#new",
                        color: "#00ff00",
                        include_title: true,
                    },
                },
            },
        },
    });
    assert.equal(JSON.parse(res.content[0].text).applied, true);
    const putCall = captured.find((c) => c.method === "PUT");
    // Wire config carries the agent's exact values, not current.* echoes.
    assert.equal(putCall.body.config.webhook_url, "https://new.example/");
    assert.equal(putCall.body.config.channel, "#new");
    assert.equal(putCall.body.config.color, "#00ff00");
    // user_name from current.config MUST NOT be echoed onto the wire.
    assert.equal("user_name" in putCall.body.config, false);
});

test_p2("update_event_notification C3 ACCEPTANCE GATE — http-v2 update WITHOUT basic_auth: basic_auth + api_secret ABSENT from wire", async () => {
    // THE LOAD-BEARING C3 ACCEPTANCE GATE. The previous-iteration bug copied
    // the masked `<value hidden>` placeholder from current state into the wire
    // body, causing Graylog to re-encrypt the literal placeholder string and
    // WIPE the secret. STRICT_NO_ECHO prevents this by NEVER touching
    // current.config — only agent-supplied keys flow onto the wire.
    //
    // The agent here passes the http-v2 minimal block {type, url}. zod's
    // .default()-marked fields (method, time_zone, skip_tls_verification,
    // api_key_as_header) inflate during parse — those flow onto the wire as
    // zod-defaulted scalars. CRITICALLY: basic_auth + api_secret are .optional()
    // (not defaulted), so they remain undefined after parse → ABSENT from wire.
    const { handleUpdateEventNotification } = await import(
        "../src/tools/events/update-event-notification.js"
    );
    const captured = [];
    _setCaptureRequest_p2((req) => {
        captured.push({ method: req.method, path: req.path, body: req.body });
        if (req.method === "GET" && req.path === "/api/events/notifications/abc") {
            return {
                id: "abc",
                config: {
                    type: "http-notification-v2",
                    url: "https://old.example/",
                    method: "POST",
                    basic_auth: "<value hidden>",
                    api_secret: "<value hidden>",
                },
            };
        }
        if (req.method === "PUT" && req.path === "/api/events/notifications/abc") {
            return { id: "abc" };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    await handleUpdateEventNotification({
        params: {
            arguments: {
                _testConnection: "fake",
                dryRun: false,
                notificationId: "abc",
                changes: {
                    config: { type: "http-notification-v2", url: "https://new.example/" },
                },
            },
        },
    });
    const putCall = captured.find((c) => c.method === "PUT");
    // The acceptance gate: encrypted fields the agent did NOT pass are ABSENT,
    // regardless of which non-encrypted zod-defaulted scalars came along.
    assert.equal("basic_auth" in putCall.body.config, false, "basic_auth must NOT be on the wire (C3 GATE)");
    assert.equal("api_secret" in putCall.body.config, false, "api_secret must NOT be on the wire (C3 GATE)");
    // The agent's url propagates verbatim; current.url is NEVER echoed.
    assert.equal(putCall.body.config.url, "https://new.example/");
});

test_p2("update_event_notification C3 wire: http-v2 update WITH new basic_auth wraps as {set_value} on the wire", async () => {
    const { handleUpdateEventNotification } = await import(
        "../src/tools/events/update-event-notification.js"
    );
    const captured = [];
    _setCaptureRequest_p2((req) => {
        captured.push({ method: req.method, path: req.path, body: req.body });
        if (req.method === "GET" && req.path === "/api/events/notifications/abc") {
            return {
                id: "abc",
                config: { type: "http-notification-v2", url: "https://old.example/" },
            };
        }
        if (req.method === "PUT" && req.path === "/api/events/notifications/abc") {
            return { id: "abc" };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    await handleUpdateEventNotification({
        params: {
            arguments: {
                _testConnection: "fake",
                dryRun: false,
                notificationId: "abc",
                // url is required on http-v2; agent passes the existing-or-new url
                // alongside the new basic_auth. STRICT_NO_ECHO still applies for the
                // optional/encrypted fields not in the input (api_secret).
                changes: {
                    config: {
                        type: "http-notification-v2",
                        url: "https://hook.example/",
                        basic_auth: "newSecret",
                    },
                },
            },
        },
    });
    const putCall = captured.find((c) => c.method === "PUT");
    assert.ok(putCall, "PUT must fire on apply");
    // EncryptedValue deserialization on the wire: {set_value: <new>}.
    assert.deepEqual(putCall.body.config.basic_auth, { set_value: "newSecret" });
    // api_secret was NOT in the agent input → MUST NOT be on the wire.
    assert.equal("api_secret" in putCall.body.config, false);
});

test_p2("update_event_notification C3 preview: http-v2 update WITH new basic_auth shows <redacted> in preview", async () => {
    const { handleUpdateEventNotification } = await import(
        "../src/tools/events/update-event-notification.js"
    );
    _setCaptureRequest_p2((req) => {
        if (req.method === "GET" && req.path === "/api/events/notifications/abc") {
            return {
                id: "abc",
                config: { type: "http-notification-v2", url: "https://old.example/" },
            };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleUpdateEventNotification({
        params: {
            arguments: {
                _testConnection: "fake",
                notificationId: "abc",
                changes: {
                    config: {
                        type: "http-notification-v2",
                        url: "https://hook.example/",
                        basic_auth: "newSecret",
                    },
                },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.preview.body.config.basic_auth, "<redacted>");
    // api_secret was NOT touched by the agent, so it MUST NOT appear on the
    // preview body either — STRICT_NO_ECHO covers preview symmetrically.
    assert.equal("api_secret" in payload.preview.body.config, false);
});

test_p2("update_event_notification variant change: old variant fields ABSENT; new type's encrypted-field inventory drives redaction", async () => {
    const { handleUpdateEventNotification } = await import(
        "../src/tools/events/update-event-notification.js"
    );
    const captured = [];
    _setCaptureRequest_p2((req) => {
        captured.push({ method: req.method, path: req.path, body: req.body });
        if (req.method === "GET" && req.path === "/api/events/notifications/abc") {
            return {
                id: "abc",
                config: {
                    type: "slack-notification-v1",
                    webhook_url: "https://hook.example/",
                    channel: "#a",
                    color: "#ff0500",
                    include_title: true,
                },
            };
        }
        if (req.method === "PUT" && req.path === "/api/events/notifications/abc") {
            return { id: "abc" };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    await handleUpdateEventNotification({
        params: {
            arguments: {
                _testConnection: "fake",
                dryRun: false,
                notificationId: "abc",
                changes: {
                    config: {
                        type: "teams-notification-v2",
                        webhook_url: "https://outlook.office.com/webhook/X",
                        adaptive_card: "{}",
                    },
                },
            },
        },
    });
    const putCall = captured.find((c) => c.method === "PUT");
    assert.equal(putCall.body.config.type, "teams-notification-v2");
    // Old slack-only fields (channel, color, include_title) must NOT bleed into
    // the new variant's wire config. STRICT_NO_ECHO carries the variant change.
    assert.equal("channel" in putCall.body.config, false);
    assert.equal("color" in putCall.body.config, false);
    assert.equal("include_title" in putCall.body.config, false);
});

test_p2("update_event_notification Pitfall 8 — body.id matches URL segment", async () => {
    const { handleUpdateEventNotification } = await import(
        "../src/tools/events/update-event-notification.js"
    );
    _setCaptureRequest_p2(() => ({
        id: "abc",
        config: { type: "slack-notification-v1", webhook_url: "x", channel: "x", color: "#ff0500", include_title: true },
    }));
    const res = await handleUpdateEventNotification({
        params: {
            arguments: {
                _testConnection: "fake",
                notificationId: "abc",
                changes: { title: "x" },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.body.id, "abc");
});

test_p2("update_event_notification schema rejection: changes.config.type outside closed set rejects at zod.parse", async () => {
    const { handleUpdateEventNotification } = await import(
        "../src/tools/events/update-event-notification.js"
    );
    // Poisoned seam: a successful zod.parse would fire the pre-flight GET.
    _setCaptureRequest_p2(() => {
        throw new Error("HTTP call fired despite invalid discriminator");
    });
    const res = await handleUpdateEventNotification({
        params: {
            arguments: {
                _testConnection: "fake",
                notificationId: "abc",
                changes: { config: { type: "script-notification-v1" } },
            },
        },
    });
    assert.equal(res.isError, true);
});

test_p2("update_event_notification apply HAPPY: pre-flight GET + PUT fire in order; applied:true", async () => {
    const { handleUpdateEventNotification } = await import(
        "../src/tools/events/update-event-notification.js"
    );
    const captured = [];
    _setCaptureRequest_p2((req) => {
        captured.push({ method: req.method, path: req.path });
        if (req.method === "GET" && req.path === "/api/events/notifications/abc") {
            return { id: "abc", config: { type: "http-notification-v1", url: "https://old.example/" } };
        }
        if (req.method === "PUT" && req.path === "/api/events/notifications/abc") {
            return { id: "abc", config: { type: "http-notification-v1", url: "https://new.example/" } };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleUpdateEventNotification({
        params: {
            arguments: {
                _testConnection: "fake",
                dryRun: false,
                notificationId: "abc",
                changes: { config: { type: "http-notification-v1", url: "https://new.example/" } },
            },
        },
    });
    assert.deepEqual(captured, [
        { method: "GET", path: "/api/events/notifications/abc" },
        { method: "PUT", path: "/api/events/notifications/abc" },
    ]);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.applied, true);
});

// ---------- dispatch + tool-count ----------

test_p2("dispatch resolves update_event_notification after Plan 05-04 Task 2 registration", async () => {
    const { dispatch } = await import("../src/dispatch.js");
    await import("../src/tools/_register.js");
    _setCaptureRequest_p2((req) => {
        if (req.method === "GET" && req.path === "/api/events/notifications/abc") {
            return {
                id: "abc",
                config: { type: "slack-notification-v1", webhook_url: "x", channel: "x", color: "#ff0500", include_title: true },
            };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await dispatch({
        params: {
            name: "update_event_notification",
            arguments: {
                _testConnection: "fake",
                notificationId: "abc",
                changes: { title: "DispTest" },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "update_event_notification");
    assert.equal(payload.dryRun, true);
});
