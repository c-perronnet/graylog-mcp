// Plan 05-01 Task 2 — per-domain zod schemas for the 11 Phase 5 event tools.
//
// Defining schemas BEFORE handlers (Wave-0 contract per 05-CONTEXT.md) lets
// Plans 02/03/04 import the symbols their handlers reference without
// re-litigating the discriminator, the EventDefinitionDto shape, or the
// encrypted-field-aware http-notification-v2 surface.
//
// Schemas covered (snake_case maps to the wire tool names):
//   ListEventDefinitionsSchema    — list_event_definitions  (Plan 05-02)
//   GetEventDefinitionSchema      — get_event_definition    (Plan 05-02)
//   CreateEventDefinitionSchema   — create_event_definition (Plan 05-02; D-01/D-12)
//   UpdateEventDefinitionSchema   — update_event_definition (Plan 05-02; D-02/D-10)
//   DeleteEventDefinitionSchema   — delete_event_definition (Plan 05-03; D-08)
//   EnableEventDefinitionSchema   — enable_event_definition (Plan 05-03; D-07)
//   DisableEventDefinitionSchema  — disable_event_definition(Plan 05-03; D-07)
//   ListEventNotificationsSchema  — list_event_notifications(Plan 05-04)
//   CreateEventNotificationSchema — create_event_notification(Plan 05-04; D-05/D-06)
//   UpdateEventNotificationSchema — update_event_notification(Plan 05-04; D-10)
//   DeleteEventNotificationSchema — delete_event_notification(Plan 05-04; D-09)
//
// Plus three shared building blocks:
//   NotificationConfigSchema      — 6-variant discriminated union (D-05 corrected)
//   EventDefinitionDtoSchema      — common shape used by create + update
//   EventDefinitionDtoChangesSchema — partial-update envelope (READ_ONLY fields stripped)
//
// Source-walk: every shape below is derived directly from
// source-code/graylog2-server/.../events/notifications/types/*.java (core) +
// .../integrations/notifications/types/* (plugin) + .../integrations/pagerduty/*.java
// — see 05-RESEARCH.md §"Per-Type Config Shapes" for the field-by-field map.

import { z } from "zod";
import { listBase, mutatingBase } from "../_shared/schemas.js";

// =====================================================================
// NotificationConfigSchema — 6-variant discriminated union (D-05 corrected)
// =====================================================================
//
// Pitfall 6 of 05-RESEARCH.md: the CONTEXT.md draft listed
// `script-notification-v1` (does not exist on 7.2-source) and
// `pagerduty-notification-v1` (correct wire identifier is `-v2`). The
// researcher-corrected 6-variant set below is locked: agents passing
// any non-enumerated `type` value reject at z.discriminatedUnion("type")
// BEFORE any HTTP call (T-05-01-01 mitigation).

// ---------- email-notification-v1 (EmailEventNotificationConfig.java:46-219)
// NOTE: variant-specific cross-field refinements live in NotificationConfigSchema's
// outer .superRefine() block below. z.discriminatedUnion requires its variants
// to be raw ZodObjects (not ZodEffects), so per-variant .superRefine() at this
// layer is not viable — applying it would break discriminator inference.
const EmailNotificationConfigSchema = z.object({
    type: z.literal("email-notification-v1"),
    sender: z.string().optional(),
    reply_to: z.string().optional(),
    subject: z.string().min(1),  // @NotBlank
    body_template: z.string().optional(),
    html_body_template: z.string().optional(),
    email_recipients: z.array(z.string()).default([]),
    user_recipients: z.array(z.string()).default([]),
    time_zone: z.string().default("UTC"),
    lookup_recipient_emails: z.boolean().default(false),
    recipients_lut_name: z.string().nullable().optional(),
    recipients_lut_key: z.string().nullable().optional(),
    lookup_sender_email: z.boolean().default(false),
    sender_lut_name: z.string().nullable().optional(),
    sender_lut_key: z.string().nullable().optional(),
    lookup_reply_to_email: z.boolean().default(false),
    reply_to_lut_name: z.string().nullable().optional(),
    reply_to_lut_key: z.string().nullable().optional(),
    single_email: z.boolean().default(false),
    cc_users: z.array(z.string()).default([]),
    cc_emails: z.array(z.string()).default([]),
    lookup_cc_emails: z.boolean().default(false),
    cc_emails_lut_name: z.string().nullable().optional(),
    cc_emails_lut_key: z.string().nullable().optional(),
    bcc_users: z.array(z.string()).default([]),
    bcc_emails: z.array(z.string()).default([]),
    lookup_bcc_emails: z.boolean().default(false),
    bcc_emails_lut_name: z.string().nullable().optional(),
    bcc_emails_lut_key: z.string().nullable().optional(),
    include_event_procedure: z.boolean().default(false),
});

// ---------- http-notification-v1 (HTTPEventNotificationConfig.java)
// Genuinely minimal — only `url`. Use v2 for headers/auth.
const HttpV1NotificationConfigSchema = z.object({
    type: z.literal("http-notification-v1"),
    url: z.string().url(),
});

// ---------- http-notification-v2 (HTTPEventNotificationConfigV2.java:47-110)
// `basic_auth` + `api_secret` are EncryptedValue on the wire — declared as
// optional strings at the schema level; STRICT_NO_ECHO handling on update
// lives at the WIRE layer in Plan 05-04's update handler (C3-class pattern).
const HttpV2NotificationConfigSchema = z.object({
    type: z.literal("http-notification-v2"),
    url: z.string().url(),
    method: z.enum(["POST", "PUT", "GET"]).default("POST"),
    time_zone: z.string().default("UTC"),
    content_type: z.enum(["JSON", "FORM_DATA", "PLAIN_TEXT"]).nullable().optional(),
    headers: z.string().nullable().optional(),
    body_template: z.string().nullable().optional(),
    skip_tls_verification: z.boolean().default(false),
    basic_auth: z.string().nullable().optional(),       // EncryptedValue — STRICT_NO_ECHO at wire
    api_key_as_header: z.boolean().default(false),
    api_key: z.string().nullable().optional(),
    api_secret: z.string().nullable().optional(),       // EncryptedValue — STRICT_NO_ECHO at wire
});

// ---------- slack-notification-v1 (SlackEventNotificationConfig.java:46-178)
// Cross-field refinements (notify_channel XOR notify_here; include_title=false
// requires custom_message) live in NotificationConfigSchema's outer
// .superRefine() — see EmailNotificationConfigSchema note.
const SlackNotificationConfigSchema = z.object({
    type: z.literal("slack-notification-v1"),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "color must be a hex literal like #ff0500"),
    webhook_url: z.string().url(),
    channel: z.string().min(1),
    custom_message: z.string().optional(),
    user_name: z.string().nullable().optional(),
    notify_channel: z.boolean().default(false),
    notify_here: z.boolean().default(false),
    link_names: z.boolean().default(false),
    icon_url: z.string().nullable().optional(),
    icon_emoji: z.string().nullable().optional(),
    backlog_size: z.number().int().nonnegative().default(0),
    time_zone: z.string().default("UTC"),
    include_title: z.boolean().default(true),
    include_event_procedure: z.boolean().default(false),
});

// ---------- pagerduty-notification-v2 (PagerDutyNotificationConfig.java:49-120)
const PagerDutyV2NotificationConfigSchema = z.object({
    type: z.literal("pagerduty-notification-v2"),
    routing_key: z.string().length(32, "pagerduty routing_key must be exactly 32 chars"),
    custom_incident: z.boolean().default(false),
    key_prefix: z.string().default(""),
    client_name: z.string().min(1),
    client_url: z.string().url().refine(
        (u) => u.startsWith("http://") || u.startsWith("https://"),
        { message: "pagerduty client_url must be http(s)://" },
    ),
    pager_duty_title: z.string().nullable().optional(),
    incident_key: z.string().nullable().optional(),
});

// ---------- teams-notification-v2 (TeamsEventNotificationConfigV2.java:42-110)
// `time_zone` is @Deprecated on the wire and excluded here; agents in 7.2+
// should use adaptive_card formatting instead.
const TeamsV2NotificationConfigSchema = z.object({
    type: z.literal("teams-notification-v2"),
    webhook_url: z.string().url(),
    adaptive_card: z.string().refine((s) => {
        try {
            JSON.parse(s);
            return true;
        } catch {
            return false;
        }
    }, { message: "teams-notification-v2: adaptive_card must be a JSON-parseable string" }),
    backlog_size: z.number().int().nonnegative().default(0),
});

// Closed-set discriminator. Any `type` value outside these 6 literals rejects
// at z.parse with a clear "Invalid discriminator value" error BEFORE any HTTP.
// Threat-model T-05-01-01.
//
// Cross-field refinements are applied at this OUTER level via .superRefine()
// because zod v3's z.discriminatedUnion requires each variant to be a raw
// ZodObject (not wrapped in ZodEffects). Variant-specific checks dispatch on
// `value.type` inside the refinement body.
const NotificationConfigDiscriminator = z.discriminatedUnion("type", [
    EmailNotificationConfigSchema,
    HttpV1NotificationConfigSchema,
    HttpV2NotificationConfigSchema,
    SlackNotificationConfigSchema,
    PagerDutyV2NotificationConfigSchema,
    TeamsV2NotificationConfigSchema,
]);

export const NotificationConfigSchema = NotificationConfigDiscriminator.superRefine((v, ctx) => {
    // -------- email-notification-v1 cross-field refinements --------
    if (v.type === "email-notification-v1") {
        const hasEmailRecips = (v.email_recipients?.length ?? 0) > 0;
        const hasUserRecips = (v.user_recipients?.length ?? 0) > 0;
        if (!hasEmailRecips && !hasUserRecips && v.lookup_recipient_emails !== true) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "email-notification-v1 requires at least one of: email_recipients, user_recipients, or lookup_recipient_emails=true",
                path: ["email_recipients"],
            });
        }
        const hasBody = (v.body_template?.length ?? 0) > 0;
        const hasHtml = (v.html_body_template?.length ?? 0) > 0;
        if (!hasBody && !hasHtml) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "email-notification-v1 requires one of: body_template or html_body_template",
                path: ["body_template"],
            });
        }
    }
    // -------- slack-notification-v1 cross-field refinements --------
    if (v.type === "slack-notification-v1") {
        if (v.notify_channel === true && v.notify_here === true) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "slack-notification-v1: notify_channel and notify_here are mutually exclusive",
                path: ["notify_channel"],
            });
        }
        if (v.include_title === false && (v.custom_message?.length ?? 0) === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "slack-notification-v1: when include_title=false, custom_message must be non-empty",
                path: ["custom_message"],
            });
        }
    }
});

// =====================================================================
// EventDefinitionDtoSchema — common shape for create + update bodies
// =====================================================================
//
// Source: EventDefinitionDto.java:65-170. Pitfall 5: `scheduler` is
// @JsonProperty.Access.READ_ONLY and is excluded from this schema — the
// agent cannot echo it back on POST/PUT (would fire 400 server-side).
// Pitfall 8: `id` is @Nullable on input (server-assigned on POST; required
// on PUT — wrapper populates from URL path, never round-trips).

export const EventDefinitionDtoSchema = z.object({
    id: z.string().optional(),
    title: z.string().min(1),
    description: z.string().optional(),
    priority: z.number().int().min(1).max(3).default(2),
    alert: z.boolean().default(true),
    // EventProcessorConfig is a discriminated-union on the wire (e.g.
    // aggregation-v1, system-notification-v1, ...). Phase 5 keeps this as
    // a permissive record — the agent passes it verbatim, the wrapper's
    // v6→v7 migrator narrows `config.conditions.expression` if present,
    // and the server validates the full shape. Forward-compat: new
    // EventProcessorConfig variants land server-side without a wrapper
    // schema change.
    config: z.record(z.unknown()),
    field_spec: z.record(z.unknown()).default({}),
    key_spec: z.array(z.string()).default([]),
    notification_settings: z.object({
        grace_period_ms: z.number().int().nonnegative().default(0),
        backlog_size: z.number().int().nonnegative().default(0),
    }).default({ grace_period_ms: 0, backlog_size: 0 }),
    notifications: z.array(z.object({
        notification_id: z.string(),
        notification_parameters: z.record(z.unknown()).nullable().optional(),
    })).default([]),
    storage: z.array(z.object({
        type: z.string(),
        streams: z.array(z.string()).optional(),
    })).default([]),
    state: z.enum(["ENABLED", "DISABLED"]).default("DISABLED"),
    remediation_steps: z.string().nullable().optional(),
    event_procedure: z.string().nullable().optional(),
    event_summary_template: z.string().nullable().optional(),
}).superRefine((dto, ctx) => {
    // Open Question 3 of 05-RESEARCH.md: key_spec must reference only keys
    // present in field_spec. Server-side this is enforced; client-side gives
    // the agent a clear pre-flight error rather than a generic 400.
    const fieldKeys = Object.keys(dto.field_spec ?? {});
    for (const key of dto.key_spec ?? []) {
        if (!fieldKeys.includes(key)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["key_spec"],
                message: `key_spec entry "${key}" not present in field_spec keys`,
            });
        }
    }
});

// Partial-update envelope for update_event_definition (D-10 STRICT_NO_ECHO).
// We allow the same fields as the create DTO MINUS `id` (URL path overrides)
// and `scheduler` (READ_ONLY — never sent). zod's `.partial()` makes every
// field optional so the agent only sends what they want to touch.
//
// The superRefine on EventDefinitionDtoSchema wraps the inner object in a
// ZodEffects, so we expose a plain partial of the inner object here.
const EventDefinitionDtoInnerShape = z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    priority: z.number().int().min(1).max(3).optional(),
    alert: z.boolean().optional(),
    config: z.record(z.unknown()).optional(),
    field_spec: z.record(z.unknown()).optional(),
    key_spec: z.array(z.string()).optional(),
    notification_settings: z.object({
        grace_period_ms: z.number().int().nonnegative().default(0),
        backlog_size: z.number().int().nonnegative().default(0),
    }).optional(),
    notifications: z.array(z.object({
        notification_id: z.string(),
        notification_parameters: z.record(z.unknown()).nullable().optional(),
    })).optional(),
    storage: z.array(z.object({
        type: z.string(),
        streams: z.array(z.string()).optional(),
    })).optional(),
    remediation_steps: z.string().nullable().optional(),
    event_procedure: z.string().nullable().optional(),
    event_summary_template: z.string().nullable().optional(),
});
export const EventDefinitionDtoChangesSchema = EventDefinitionDtoInnerShape;

// =====================================================================
// EVENT-01 — list_event_definitions
// =====================================================================
export const ListEventDefinitionsSchema = listBase.extend({
    query: z.string().optional(),
    sort: z.enum(["title", "priority", "updated_at"]).default("title").optional(),
    order: z.enum(["asc", "desc"]).default("asc").optional(),
});

// =====================================================================
// EVENT-02 — get_event_definition
// =====================================================================
// Read tool — NOT extending mutatingBase (no dryRun / idempotencyKey).
export const GetEventDefinitionSchema = z.object({
    connectionName: z.string().optional(),
    definitionId: z.string().min(1, "definitionId is required"),
});

// =====================================================================
// EVENT-03 — create_event_definition (D-01 / D-12)
// =====================================================================
// NO `schedule` field — D-01 structurally enforced: the wire path always
// emits ?schedule=false, agent cannot flip it. The CreateEntityRequest
// wrapping ({entity, share_request: null}) happens in the build() callback
// in Plan 05-02's create handler — schema is the agent-facing flat shape.
export const CreateEventDefinitionSchema = mutatingBase.extend({
    definition: EventDefinitionDtoSchema,
});

// =====================================================================
// EVENT-04 — update_event_definition (D-02 / D-10)
// =====================================================================
// STRICT_NO_ECHO partial-update: agent passes only fields they want to
// change. id comes from URL path; the build() callback fetches current
// DTO and overlays changes (Pitfall 5: scheduler never round-tripped).
export const UpdateEventDefinitionSchema = mutatingBase.extend({
    definitionId: z.string().min(1, "definitionId is required"),
    changes: EventDefinitionDtoChangesSchema,
});

// =====================================================================
// EVENT-05 — delete_event_definition (D-08 informational)
// =====================================================================
// NO `confirm` field — D-08 is informational cascade; no token issued.
// Notifications survive the delete (just lose the link), so there's no
// cascade-hash drift refusal — only a dry-run preview.
export const DeleteEventDefinitionSchema = mutatingBase.extend({
    definitionId: z.string().min(1, "definitionId is required"),
});

// =====================================================================
// EVENT-06 — enable_event_definition / disable_event_definition (D-07)
// =====================================================================
export const EnableEventDefinitionSchema = mutatingBase.extend({
    definitionId: z.string().min(1, "definitionId is required"),
});
export const DisableEventDefinitionSchema = mutatingBase.extend({
    definitionId: z.string().min(1, "definitionId is required"),
});

// =====================================================================
// EVENT-07 — list_event_notifications
// =====================================================================
export const ListEventNotificationsSchema = listBase.extend({
    query: z.string().optional(),
    sort: z.enum(["title", "type"]).default("title").optional(),
    order: z.enum(["asc", "desc"]).default("asc").optional(),
});

// =====================================================================
// EVENT-08 — create_event_notification (D-05 / D-06)
// =====================================================================
// Agent provides discriminator-validated `config`; build() wraps it in
// CreateEntityRequest envelope ({entity, share_request: null}).
export const CreateEventNotificationSchema = mutatingBase.extend({
    title: z.string().min(1),
    description: z.string().optional(),
    config: NotificationConfigSchema,
});

// =====================================================================
// EVENT-09a — update_event_notification (D-10)
// =====================================================================
// STRICT_NO_ECHO partial-update. `config` is the same discriminator —
// when present, the agent passes a full v6-validated config block.
export const UpdateEventNotificationSchema = mutatingBase.extend({
    notificationId: z.string().min(1, "notificationId is required"),
    changes: z.object({
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        config: NotificationConfigSchema.optional(),
    }),
});

// =====================================================================
// EVENT-09b — delete_event_notification (D-09 cascade-hash)
// =====================================================================
// `confirm` is OPTIONAL at parse time; the requireConfirm gate in
// handler.js enforces it at apply time based on whether build()
// populated _confirmationToken — which build() ALWAYS does for
// delete_event_notification (cascade preview is mandatory).
export const DeleteEventNotificationSchema = mutatingBase.extend({
    notificationId: z.string().min(1, "notificationId is required"),
    confirm: z.string().regex(/^[0-9a-f]{64}$/, "confirm must be a 64-hex sha-256").optional(),
});
