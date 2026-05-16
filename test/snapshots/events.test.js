// Plan 05-05 Task 1 — 12-13 snapshot fixtures per 05-RESEARCH §"Snapshot
// Fixture Design (Discretion-04 — 12 fixtures)".
//
// Each fixture pins one Phase 5 tool's dry-run preview shape OR apply result
// OR refusal envelope. Static args ensure byte-determinism across runs
// (idempotencyKey is the sha-256-truncated hash of canonicalized
// {connectionName, toolName, args}; Date.now()/randomUUID() are NOT invoked
// anywhere in the wrapper or build paths). The snapshot serializer
// (node:test default) normalises indentation + key order — the resulting
// .snapshot file is byte-stable across machines and CI runs.
//
// Coverage matrix (RESEARCH §"Snapshot Fixture Design" rows 1-13):
//
//   F1  list_event_definitions       — narrow projection of 2-def cluster
//   F2  get_event_definition         — full EventDefinitionDto pass-through
//   F3  create_event_definition (v7) — M1 ACCEPTANCE GATE
//                                       wire path ?schedule=false UNCONDITIONAL
//                                       postApplyEstimate.wouldStartScheduling:false
//                                       CreateEntityRequest envelope ({entity, share_request:null})
//                                       Pitfall 8: definition.id stripped
//                                       NO migration key (v7 input)
//   F4  create_event_definition (v6) — C5 ACCEPTANCE GATE
//                                       migrated_from_v6_shape:true + emitted "count_source"
//                                       byte-for-byte original v6 expression preserved
//                                       wire body's config.conditions.expression rewritten to v7
//                                       M1 invariant preserved (?schedule=false STILL on path)
//   F5  update_event_definition       — STRICT_NO_ECHO title-only change
//                                       wire body keys EXACTLY [id, title] (Pitfall 5/8)
//                                       NO migration key (changes.config absent)
//   F6  delete_event_definition       — D-08 INFORMATIONAL cascade
//                                       cascades.notifications populated from pre-flight GET
//                                       NO confirmationToken (informational, not refusal)
//                                       DELETE wire envelope
//   F7  enable_event_definition       — WILDCARD empty-body (per 05-U1-SMOKE.md)
//                                       wire path /schedule; preview.body ABSENT (undefined)
//                                       postApplyEstimate {id, state: ENABLED}
//   F8  disable_event_definition      — symmetric to F7 with /unschedule + state:DISABLED
//   F9  list_event_notifications      — narrow projection [id, title, description, config]
//                                       mixed-type 2-notification cluster
//   F10 create_event_notification (slack) — D-05 discriminator accept
//                                       CreateEntityRequest envelope (Pitfall 3)
//                                       config.type "slack-notification-v1"
//   F11 create_event_notification (script) — D-05/D-06 DISCRIMINATOR REJECT
//                                       isError:true; closed set named in error
//                                       NO HTTP call fires (capture seam poisoned)
//   F12 delete_event_notification     — D-09 ACCEPTANCE GATE
//                                       cascades.event_definitions filtered to refs
//                                       confirmationToken pinned (frozen literal)
//                                       byte-identity vs computeNotificationCascadeHash
//                                       DELETE wire envelope
//   F13 create_event_notification (http-v2 + encrypted) — C3 ACCEPTANCE GATE
//                                       basic_auth + api_secret <redacted> in preview body
//                                       plaintext values "secret123"/"key456" ABSENT
//                                       from snapshot (auth-redaction proof)
//
// Determinism contract: two consecutive `node --test` runs must produce
// byte-identical md5sums of test/snapshots/__snapshots__/events.test.js.snapshot.
// The auth-redaction lint (test/auth-redaction.test.js) scans this file
// dynamically — confirmationToken + idempotencyKey are allowlisted via
// the Plan 02-05 + Plan 03-05 amendments. The placeholder string
// "<redacted>" is recognised at the regex level (PASSWORD_LITERAL excludes
// angle-bracket values).

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import "../snapshot-config.js";

import { handleListEventDefinitions } from "../../src/tools/events/list-event-definitions.js";
import { handleGetEventDefinition } from "../../src/tools/events/get-event-definition.js";
import { handleCreateEventDefinition } from "../../src/tools/events/create-event-definition.js";
import { handleUpdateEventDefinition } from "../../src/tools/events/update-event-definition.js";
import { handleDeleteEventDefinition } from "../../src/tools/events/delete-event-definition.js";
import { handleEnableEventDefinition } from "../../src/tools/events/enable-event-definition.js";
import { handleDisableEventDefinition } from "../../src/tools/events/disable-event-definition.js";
import { handleListEventNotifications } from "../../src/tools/events/list-event-notifications.js";
import { handleCreateEventNotification } from "../../src/tools/events/create-event-notification.js";
import { handleDeleteEventNotification } from "../../src/tools/events/delete-event-notification.js";

import { computeNotificationCascadeHash } from "../../src/tools/_shared/cascade-hash.js";
import {
    _setCaptureRequest,
    _clearCaptureRequest,
} from "../../src/graylog/client.js";
import {
    _setConnectionsForTests,
    _clearConnectionsForTests,
    setActiveConnection,
} from "../../src/config.js";

beforeEach(() => {
    _clearConnectionsForTests();
    setActiveConnection(null);
});

afterEach(() => {
    _clearCaptureRequest();
    _clearConnectionsForTests();
    setActiveConnection(null);
});

// =====================================================================
// MultiCapture helper — mirror pipelines.test.js + events.test.js patterns
// =====================================================================

function eventsMultiCapture(routes) {
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

// =====================================================================
// Static fixtures — synthetic Graylog responses for byte-stable snapshots
// =====================================================================

const FIXTURE_DEF_LIST = {
    elements: [
        {
            id: "def-1",
            title: "Spike",
            description: "alpha",
            priority: 2,
            state: "ENABLED",
            alert: true,
        },
        {
            id: "def-2",
            title: "Quota",
            description: "beta",
            priority: 3,
            state: "DISABLED",
            alert: false,
        },
    ],
    total: 2,
};

const FIXTURE_DEFINITION_DTO = {
    id: "66e8a4bce8f3a4001b88c123",
    title: "Spike Alert",
    description: "spike alert def",
    priority: 2,
    alert: true,
    config: {
        type: "aggregation-v1",
        query: "level:>=4",
        streams: ["66e8stream"],
        group_by: ["source"],
        series: [{ type: "count", id: "count_source", field: "source" }],
        conditions: {
            expression: {
                expr: ">",
                left: { expr: "number-ref", ref: "count_source" },
                right: { expr: "number", value: 100 },
            },
        },
        search_within_ms: 60000,
        execute_every_ms: 60000,
        use_cron_scheduling: false,
        event_limit: 100,
    },
    field_spec: {},
    key_spec: [],
    notification_settings: { grace_period_ms: 0, backlog_size: 0 },
    notifications: [{ notification_id: "n1" }],
    storage: [{ type: "persist-to-streams-v1", streams: ["000000000000000000000002"] }],
    state: "ENABLED",
    scheduler: { is_scheduled: true, next_time: "2026-01-01T00:00:00Z" },
};

const FIXTURE_DEF_V7 = {
    title: "App Error Spike",
    priority: 2,
    alert: true,
    config: {
        type: "aggregation-v1",
        query: "level:>=4",
        streams: ["66e8stream"],
        group_by: ["source"],
        series: [{ type: "count", id: "count_source", field: "source" }],
        conditions: {
            expression: {
                expr: ">",
                left: { expr: "number-ref", ref: "count_source" },
                right: { expr: "number", value: 100 },
            },
        },
        search_within_ms: 60000,
        execute_every_ms: 60000,
        use_cron_scheduling: false,
        event_limit: 100,
    },
    field_spec: {},
    key_spec: [],
    notification_settings: { grace_period_ms: 0, backlog_size: 0 },
    notifications: [],
    storage: [{ type: "persist-to-streams-v1", streams: ["000000000000000000000002"] }],
    state: "DISABLED",
};

// Same definition body as FIXTURE_DEF_V7 EXCEPT config.conditions.expression
// uses the V6 {type:"function", function:"count", parameter:"source"} shape.
const FIXTURE_DEF_V6 = {
    ...FIXTURE_DEF_V7,
    title: "V6 Style Spike",
    config: {
        ...FIXTURE_DEF_V7.config,
        conditions: {
            expression: {
                type: "function",
                function: "count",
                parameter: "source",
            },
        },
    },
};

const FIXTURE_NOTIFICATIONS_LIST = {
    elements: [
        {
            id: "notif-1",
            title: "Slack Ops",
            description: "ops slack channel",
            config: {
                type: "slack-notification-v1",
                webhook_url: "https://hooks.slack.com/services/A/B/C",
                channel: "#ops",
                color: "#ff0500",
                include_title: true,
            },
        },
        {
            id: "notif-2",
            title: "Email Ops",
            description: "ops mailing list",
            config: {
                type: "email-notification-v1",
                subject: "Alert",
                body_template: "An event happened",
                email_recipients: ["ops@example.org"],
            },
        },
    ],
    total: 2,
};

// =====================================================================
// Frozen cascade-hash literals (Plan 05-05 drift sentinels).
//
// Both literals are computed offline via computeNotificationCascadeHash
// and re-asserted via byte-identity check in the relevant fixtures. Any
// future change to the canonical JSON shape produced by computeCascadeHash
// (Phase 3 D-02 LOCKED) will break BOTH the snapshot byte-stability AND
// the byte-identity assertion simultaneously — two-witness drift detection.
// =====================================================================

const EXPECTED_TOKEN_TARGET_2DEFS =
    "9b8092ee7a5aec3b921bec4094d8a786fe6a3226140b0cd28bdf1a182662ba35";

// =====================================================================
// F1 — list_event_definitions narrow projection of 2-def cluster
// =====================================================================

test("snapshot: list_event_definitions narrow projection of 2-def cluster (EVENT-01)", async (t) => {
    _setCaptureRequest(() => FIXTURE_DEF_LIST);
    const res = await handleListEventDefinitions({
        params: { arguments: { _testConnection: "fixture_conn" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.count, 2);
    assert.deepEqual(
        Object.keys(payload.items[0]).sort(),
        ["alert", "description", "id", "priority", "state", "title"],
    );
    assert.equal(payload.items[0].scheduler, undefined);
    t.assert.snapshot(payload);
});

// =====================================================================
// F2 — get_event_definition full EventDefinitionDto pass-through
// =====================================================================

test("snapshot: get_event_definition full EventDefinitionDto pass-through (EVENT-02)", async (t) => {
    _setCaptureRequest(() => FIXTURE_DEFINITION_DTO);
    const res = await handleGetEventDefinition({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                definitionId: "66e8a4bce8f3a4001b88c123",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.tool, "get_event_definition");
    assert.equal(payload.definition.id, "66e8a4bce8f3a4001b88c123");
    // Pitfall 5: scheduler surfaces through get (read-only inspection surface).
    assert.equal(payload.definition.scheduler.is_scheduled, true);
    t.assert.snapshot(payload);
});

// =====================================================================
// F3 — create_event_definition (v7 input) — M1 ACCEPTANCE GATE
// =====================================================================
//
// Pins the M1 wire-path proof (?schedule=false UNCONDITIONAL) + the M1
// summary proof (wouldStartScheduling:false + state:DISABLED on apply).
// Also pins the CreateEntityRequest envelope (Pitfall 3) and the Pitfall 8
// id-strip. NO `migration` key because the v7 input requires no rewrite.

test("snapshot: create_event_definition (v7 input) — M1 ACCEPTANCE GATE: ?schedule=false + wouldStartScheduling:false (EVENT-03 + D-01)", async (t) => {
    _setCaptureRequest(eventsMultiCapture([
        {
            method: "GET",
            pathPattern: /^\/api\/events\/definitions\/paginated/,
            response: { elements: [], total: 0 },
        },
    ]));
    const res = await handleCreateEventDefinition({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                definition: FIXTURE_DEF_V7,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // M1 wire-path proof.
    assert.equal(payload.preview.path, "/api/events/definitions?schedule=false");
    assert.equal(payload.preview.method, "POST");
    // M1 summary proof.
    assert.equal(payload.postApplyEstimate.wouldStartScheduling, false);
    assert.equal(payload.postApplyEstimate.state, "DISABLED");
    assert.equal(payload.postApplyEstimate.id, "__SERVER_ASSIGNED__");
    // Pitfall 3: CreateEntityRequest envelope.
    assert.equal(payload.preview.body.entity.title, "App Error Spike");
    assert.equal(payload.preview.body.share_request, null);
    // Pitfall 8: definition.id stripped before POST (server assigns).
    assert.equal(payload.preview.body.entity.id, undefined);
    // NO migration key in v7 input.
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "migration"), false);
    t.assert.snapshot(payload);
});

// =====================================================================
// F4 — create_event_definition (v6 input) — C5 ACCEPTANCE GATE
// =====================================================================
//
// Pins the migration block: migrated_from_v6_shape:true + emitted
// "count_source" + the v6 original expression byte-for-byte + the v7-rewritten
// wire body's config.conditions.expression. M1 invariant (?schedule=false)
// preserved under migration.

test("snapshot: create_event_definition (v6 input) — C5 ACCEPTANCE GATE: migrated_from_v6_shape + v7 rewrite on wire (EVENT-03 + C5)", async (t) => {
    _setCaptureRequest(eventsMultiCapture([
        {
            method: "GET",
            pathPattern: /^\/api\/events\/definitions\/paginated/,
            response: { elements: [], total: 0 },
        },
    ]));
    const res = await handleCreateEventDefinition({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                definition: FIXTURE_DEF_V6,
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // C5 migration block surfaces.
    assert.equal(payload.migration.migrated, true);
    assert.equal(payload.migration.warnings[0].migrated_from_v6_shape, true);
    assert.equal(payload.migration.warnings[0].emitted, "count_source");
    assert.deepEqual(
        payload.migration.warnings[0].original,
        { type: "function", function: "count", parameter: "source" },
    );
    // Wire body's config.conditions.expression rewritten to v7 number-ref.
    assert.deepEqual(
        payload.preview.body.entity.config.conditions.expression,
        { type: "number-ref", ref: "count_source" },
    );
    // M1 invariant still holds.
    assert.equal(payload.preview.path, "/api/events/definitions?schedule=false");
    t.assert.snapshot(payload);
});

// =====================================================================
// F5 — update_event_definition STRICT_NO_ECHO title-only
// =====================================================================
//
// Pins D-10 STRICT_NO_ECHO: wire body keys EXACTLY [id, title]. The Pitfall
// 5 scheduler READ_ONLY contract is enforced structurally (changes is the
// agent-typed partial; current state is NEVER round-tripped). NO migration
// key because changes.config absent.

test("snapshot: update_event_definition STRICT_NO_ECHO — title-only emits exactly [id, title] (EVENT-04 + D-02 + D-10)", async (t) => {
    _setCaptureRequest(eventsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/events/definitions/66e8a4bce8f3a4001b88c123",
            response: FIXTURE_DEFINITION_DTO,
        },
    ]));
    const res = await handleUpdateEventDefinition({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                definitionId: "66e8a4bce8f3a4001b88c123",
                changes: { title: "Renamed Spike" },
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // D-02 wire path with ?schedule=false (M1 invariant on update path).
    assert.equal(payload.preview.path, "/api/events/definitions/66e8a4bce8f3a4001b88c123?schedule=false");
    assert.equal(payload.preview.method, "PUT");
    // STRICT_NO_ECHO: body keys EXACTLY [id, title].
    assert.deepEqual(Object.keys(payload.preview.body).sort(), ["id", "title"]);
    assert.equal(payload.preview.body.id, "66e8a4bce8f3a4001b88c123");
    // Pitfall 5: scheduler ABSENT from wire body (current state NOT round-tripped).
    assert.equal(payload.preview.body.scheduler, undefined);
    // NO migration key — changes.config not touched.
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "migration"), false);
    t.assert.snapshot(payload);
});

// =====================================================================
// F6 — delete_event_definition D-08 INFORMATIONAL cascade
// =====================================================================
//
// Pins the D-08 informational cascade: pre-flight GET surfaces
// notifications[]; cascades.notifications populated with 2 entries.
// NO confirmationToken because notifications survive (informational,
// not a refusal gate). DELETE wire envelope.

test("snapshot: delete_event_definition D-08 INFORMATIONAL cascade (2 referenced notifications) — NO confirmationToken (EVENT-05 + D-08)", async (t) => {
    _setCaptureRequest(eventsMultiCapture([
        {
            method: "GET",
            pathPattern: "/api/events/definitions/abc",
            response: {
                id: "abc",
                title: "Spike Alert",
                config: { type: "aggregation-v1" },
                notifications: [
                    { notification_id: "notif-A", notification_parameters: null },
                    { notification_id: "notif-B", notification_parameters: { threshold: 10 } },
                ],
            },
        },
    ]));
    const res = await handleDeleteEventDefinition({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                definitionId: "abc",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // D-08 informational cascade populated from pre-flight GET.
    assert.deepEqual(payload.cascades.notifications, [
        { notification_id: "notif-A", notification_parameters: null },
        { notification_id: "notif-B", notification_parameters: { threshold: 10 } },
    ]);
    // D-08 is INFORMATIONAL — no confirmation token issued.
    assert.equal(payload.confirmationToken, undefined);
    // DELETE wire envelope.
    assert.equal(payload.preview.method, "DELETE");
    assert.equal(payload.preview.path, "/api/events/definitions/abc");
    t.assert.snapshot(payload);
});

// =====================================================================
// F7 — enable_event_definition empty-body wire shape
// =====================================================================
//
// Pins the WILDCARD empty-body contract per 05-U1-SMOKE.md chosen_default
// (UNREACHABLE → body: undefined → preview.body key absent). PUT
// /schedule wire path. postApplyEstimate {id, state: ENABLED}.

test("snapshot: enable_event_definition empty-body WILDCARD (EVENT-06 + D-07 + Pitfall 4)", async (t) => {
    _setCaptureRequest(() => {
        throw new Error("apply path must not fire in dry-run");
    });
    const res = await handleEnableEventDefinition({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                definitionId: "abc",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.method, "PUT");
    assert.equal(payload.preview.path, "/api/events/definitions/abc/schedule");
    // 05-U1-SMOKE.md chosen_default: UNREACHABLE → body undefined → key absent
    // from preview JSON. If a future deployment flips this to "", the snapshot
    // re-bakes once and continues — wire-additive, no back-compat break.
    assert.equal("body" in payload.preview, false);
    assert.equal(payload.postApplyEstimate.id, "abc");
    assert.equal(payload.postApplyEstimate.state, "ENABLED");
    t.assert.snapshot(payload);
});

// =====================================================================
// F8 — disable_event_definition empty-body wire shape (symmetric to F7)
// =====================================================================

test("snapshot: disable_event_definition empty-body WILDCARD (EVENT-06 + D-07 mirror)", async (t) => {
    _setCaptureRequest(() => {
        throw new Error("apply path must not fire in dry-run");
    });
    const res = await handleDisableEventDefinition({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                definitionId: "abc",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.preview.method, "PUT");
    assert.equal(payload.preview.path, "/api/events/definitions/abc/unschedule");
    assert.equal("body" in payload.preview, false);
    assert.equal(payload.postApplyEstimate.id, "abc");
    assert.equal(payload.postApplyEstimate.state, "DISABLED");
    t.assert.snapshot(payload);
});

// =====================================================================
// F9 — list_event_notifications narrow projection of 2-notification cluster
// =====================================================================

test("snapshot: list_event_notifications narrow projection (mixed-type 2-notif cluster) (EVENT-07)", async (t) => {
    _setCaptureRequest(() => FIXTURE_NOTIFICATIONS_LIST);
    const res = await handleListEventNotifications({
        params: { arguments: { _testConnection: "fixture_conn" } },
    });
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.count, 2);
    // Default projection [id, title, description, config] — config is a full
    // object (defineListHandler is dot-notation-unaware; agents read
    // items[i].config.type directly).
    assert.deepEqual(
        Object.keys(payload.items[0]).sort(),
        ["config", "description", "id", "title"],
    );
    assert.equal(payload.items[0].config.type, "slack-notification-v1");
    assert.equal(payload.items[1].config.type, "email-notification-v1");
    t.assert.snapshot(payload);
});

// =====================================================================
// F10 — create_event_notification (slack) discriminator accept
// =====================================================================

test("snapshot: create_event_notification slack — D-05 discriminator + CreateEntityRequest envelope (EVENT-08 + D-05)", async (t) => {
    _setCaptureRequest(eventsMultiCapture([
        {
            method: "GET",
            pathPattern: /^\/api\/events\/notifications\/paginated/,
            response: { elements: [], total: 0 },
        },
    ]));
    const res = await handleCreateEventNotification({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
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
    // D-05 discriminator accept.
    assert.equal(payload.preview.body.entity.config.type, "slack-notification-v1");
    assert.equal(
        payload.preview.body.entity.config.webhook_url,
        "https://hooks.slack.com/services/X/Y/Z",
    );
    // Pitfall 3: CreateEntityRequest envelope.
    assert.equal(payload.preview.body.share_request, null);
    assert.equal(payload.postApplyEstimate.id, "__SERVER_ASSIGNED__");
    t.assert.snapshot(payload);
});

// =====================================================================
// F11 — create_event_notification (script-v1) DISCRIMINATOR REJECT
// =====================================================================
//
// Pins the D-05/D-06 closed-set rejection: type "script-notification-v1"
// fails at z.discriminatedUnion.parse BEFORE any HTTP call. isError envelope
// names the closed set or surfaces "discriminator" in the message. The
// capture seam is POISONED — any HTTP attempt throws.

test("snapshot: create_event_notification REJECTS script-notification-v1 at zod.parse — closed-set discriminator (EVENT-08 + D-05 corrected)", async (t) => {
    let httpFired = false;
    _setCaptureRequest(() => {
        httpFired = true;
        throw new Error("HTTP call fired despite invalid discriminator");
    });
    const res = await handleCreateEventNotification({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                title: "Bad",
                config: { type: "script-notification-v1", command: "x" },
            },
        },
    });
    assert.equal(httpFired, false, "zod must reject BEFORE any HTTP");
    assert.equal(res.isError, true);
    // The error message references the discriminator OR the closed-set members.
    assert.match(
        res.content[0].text,
        /discriminator|email-notification-v1|slack-notification-v1/,
    );
    t.assert.snapshot(res);
});

// =====================================================================
// F12 — delete_event_notification — D-09 ACCEPTANCE GATE
// =====================================================================
//
// Pins:
//   - cascades.event_definitions filtered to 2 referencing defs (def-3
//     filtered out because its notification_id is different).
//   - confirmationToken pinned to the frozen literal
//     EXPECTED_TOKEN_TARGET_2DEFS — drift sentinel; any future change to
//     computeCascadeHash's canonical JSON shape breaks BOTH the snapshot
//     and the byte-identity assertion.
//   - DELETE wire envelope.
//
// The pagination walk mocks page=1 with 3 defs (2 referencing + 1 not) and
// page=2 with 0 elements to early-exit. The handler's safety-cap and
// per-page filter logic land structurally; the snapshot pins the projected
// cascade shape.

test("snapshot: delete_event_notification — D-09 ACCEPTANCE GATE: cascade + frozen confirmationToken (EVENT-09b + D-09)", async (t) => {
    _setCaptureRequest((req) => {
        if (
            req.method === "GET"
            && /^\/api\/events\/definitions\/paginated\?page=1&/.test(req.path)
        ) {
            return {
                elements: [
                    {
                        id: "def-1",
                        title: "Spike",
                        notifications: [{ notification_id: "target" }],
                    },
                    {
                        id: "def-2",
                        title: "Quota",
                        notifications: [{ notification_id: "target" }],
                    },
                    {
                        id: "def-3",
                        title: "Other",
                        notifications: [{ notification_id: "different" }],
                    },
                ],
                total: 3,
            };
        }
        // Any other GET (page=2 etc.) → empty page → early-exit.
        if (req.method === "GET") {
            return { elements: [], total: 3 };
        }
        throw new Error(`Unexpected ${req.method} ${req.path}`);
    });
    const res = await handleDeleteEventNotification({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
                notificationId: "target",
            },
        },
    });
    const payload = JSON.parse(res.content[0].text);
    // D-09 cascade: 2 referencing defs, def-3 filtered.
    assert.deepEqual(payload.cascades.event_definitions, [
        { id: "def-1", title: "Spike" },
        { id: "def-2", title: "Quota" },
    ]);
    // Frozen confirmationToken — drift sentinel.
    assert.equal(payload.confirmationToken, EXPECTED_TOKEN_TARGET_2DEFS);
    // Byte-identity vs computeNotificationCascadeHash (two-witness model).
    assert.equal(
        payload.confirmationToken,
        computeNotificationCascadeHash({
            notificationId: "target",
            eventDefIds: ["def-1", "def-2"],
        }),
        "F12 hash drift — pinned literal must equal computeNotificationCascadeHash output",
    );
    assert.match(payload.confirmationToken, /^[0-9a-f]{64}$/);
    // DELETE wire envelope.
    assert.equal(payload.preview.method, "DELETE");
    assert.equal(payload.preview.path, "/api/events/notifications/target");
    t.assert.snapshot(payload);
});

// =====================================================================
// F13 — create_event_notification http-v2 — C3 ACCEPTANCE GATE
// =====================================================================
//
// Pins the encrypted-field redaction contract:
//   - preview body shows basic_auth + api_secret as "<redacted>".
//   - Plaintext values "secret123" and "key456" are ABSENT from the
//     serialized snapshot (auth-redaction lint catches any future leak).
//
// The wire body (the _applyBody sibling) is NOT exposed in the dry-run
// preview JSON — only the redacted preview body is snapshotted, by design.

test("snapshot: create_event_notification http-v2 — C3 ACCEPTANCE GATE: basic_auth + api_secret <redacted> in preview (EVENT-08 + C3)", async (t) => {
    _setCaptureRequest(eventsMultiCapture([
        {
            method: "GET",
            pathPattern: /^\/api\/events\/notifications\/paginated/,
            response: { elements: [], total: 0 },
        },
    ]));
    const res = await handleCreateEventNotification({
        params: {
            arguments: {
                _testConnection: "fixture_conn",
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
    // C3 redaction in preview body.
    assert.equal(payload.preview.body.entity.config.basic_auth, "<redacted>");
    assert.equal(payload.preview.body.entity.config.api_secret, "<redacted>");
    // Non-encrypted fields propagate verbatim.
    assert.equal(payload.preview.body.entity.config.url, "https://hook.example/");
    // Plaintext values MUST NOT appear anywhere in the serialized response.
    const serialized = JSON.stringify(payload);
    assert.equal(
        serialized.includes("secret123"),
        false,
        "plaintext basic_auth value leaked into preview JSON",
    );
    assert.equal(
        serialized.includes("key456"),
        false,
        "plaintext api_secret value leaked into preview JSON",
    );
    t.assert.snapshot(payload);
});
