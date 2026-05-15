// Per-domain zod schemas for the input tools (FOUND-05 + per-domain co-location
// pattern from Phase 0). Plan 01-01 shipped three read-only schemas; Plan 01-02
// adds the three input-CRUD mutating schemas (CreateInputSchema,
// UpdateInputSchema, DeleteInputSchema) with per-input-type config schemas
// (D-01: GELF/Beats/Syslog/Raw strict; generic fallback for the rest).
//
// D-01 + Discretion-02: single CreateInputSchema with superRefine variant
// dispatch on the `type` FQCN — see variantMap below for the 8 strict variants.
// All other input types accept a generic record(unknown).
//
// WARNING #9 fix (per 01-02-PLAN.md): GELF HTTP gets a strict schema in the
// variantMap (NettyBase + TLS extension + HTTP-codec fields).

import { z } from "zod";
import { listBase, mutatingBase } from "../_shared/schemas.js";

// INPUT-01: list_input_types — narrows to listBase. No per-tool args.
export const ListInputTypesSchema = listBase;

// INPUT-02: list_inputs — narrows to listBase. The defaultFields override is
// applied at the defineListHandler call site (list-inputs.js), not at schema
// validation time, so the schema stays minimal.
export const ListInputsSchema = listBase;

// INPUT-03: get_input — single-target read; takes a required inputId. Note
// that this is NOT a list tool and does NOT compose through defineListHandler,
// so it does not extend listBase.
export const GetInputSchema = z.object({
    connectionName: z.string().optional(),
    inputId: z.string().min(1, "inputId is required"),
});

// =====================================================================
// INPUT-04 / INPUT-05 / INPUT-06 — Plan 01-02 mutating schemas
// =====================================================================

// Common Netty-transport fields shared by every UDP/TCP/HTTP variant.
// `port` is required; `bind_address` defaults to "0.0.0.0" so the catalogue's
// own default is mirrored client-side for agent ergonomics.
const NettyBaseConfig = z.object({
    bind_address: z.string().default("0.0.0.0"),
    port: z.number().int().min(1).max(65535),
    recv_buffer_size: z.number().int().positive().optional(),
    number_worker_threads: z.number().int().positive().optional(),
});

// TLS extension applied to TCP/HTTP variants. `tls_key_password` accepts either
// a plain string (the wrapper wraps as { set_value }) or a pre-shaped
// { keep_value: true } / { delete_value: true } placeholder so the agent can
// pin Graylog-keep / Graylog-delete semantics explicitly.
const TlsConfigExt = {
    tls_enable: z.boolean().optional(),
    tls_cert_file: z.string().optional(),
    tls_key_file: z.string().optional(),
    tls_key_password: z.union([
        z.string(),
        z.object({ keep_value: z.literal(true) }),
        z.object({ delete_value: z.literal(true) }),
    ]).optional(),
    tls_client_auth: z.enum(["disabled", "optional", "required"]).optional(),
    tls_client_auth_cert_file: z.string().optional(),
    tcp_keepalive: z.boolean().optional(),
};

// GELF UDP — no TLS extension (UDP doesn't carry TLS); GELF-codec fields.
const GelfUdpConfig = NettyBaseConfig.extend({
    override_source: z.string().optional(),
    decompress_size_limit: z.number().int().positive().optional(),
});

// GELF TCP — UDP base + TLS extension + GELF-over-TCP message-size limit.
const GelfTcpConfig = NettyBaseConfig.extend({
    ...TlsConfigExt,
    max_message_size: z.number().int().positive().optional(),
});

// GELF HTTP — Netty base + TLS + HTTP-codec fields (idle_writer_timeout,
// max_chunk_size, enable_cors, additional_headers). WARNING #9 fix in 01-02:
// without this, GELF HTTP fell through to the generic z.record(z.unknown())
// and lost strict port-required validation.
const GelfHttpConfig = NettyBaseConfig.extend({
    ...TlsConfigExt,
    idle_writer_timeout: z.number().int().positive().optional(),
    max_chunk_size: z.number().int().positive().optional(),
    enable_cors: z.boolean().optional(),
    additional_headers: z.string().optional(),
    decompress_size_limit: z.number().int().positive().optional(),
});

// Beats2 — Netty base + TLS + Beats-specific no_beats_prefix toggle.
const Beats2Config = NettyBaseConfig.extend({
    ...TlsConfigExt,
    no_beats_prefix: z.boolean().optional(),
});

// Syslog UDP — Netty base + Syslog parsing toggles (no TLS on UDP).
const SyslogUdpConfig = NettyBaseConfig.extend({
    allow_override_date: z.boolean().optional(),
    store_full_message: z.boolean().optional(),
    expand_structured_data: z.boolean().optional(),
    force_rdns: z.boolean().optional(),
});

// Syslog TCP — Syslog UDP + TLS extension.
const SyslogTcpConfig = SyslogUdpConfig.extend(TlsConfigExt);

// Raw UDP / Raw TCP — Netty base; Raw TCP adds TLS.
const RawUdpConfig = NettyBaseConfig;
const RawTcpConfig = NettyBaseConfig.extend(TlsConfigExt);

// Variant map keyed by FQCN — drives the superRefine dispatch below. Adding
// a new strict variant is a one-line registration here.
const variantMap = {
    "org.graylog2.inputs.gelf.udp.GELFUDPInput": GelfUdpConfig,
    "org.graylog2.inputs.gelf.tcp.GELFTCPInput": GelfTcpConfig,
    "org.graylog2.inputs.gelf.http.GELFHttpInput": GelfHttpConfig,
    "org.graylog.plugins.beats.Beats2Input": Beats2Config,
    "org.graylog2.inputs.syslog.udp.SyslogUDPInput": SyslogUdpConfig,
    "org.graylog2.inputs.syslog.tcp.SyslogTCPInput": SyslogTcpConfig,
    "org.graylog2.inputs.raw.udp.RawUDPInput": RawUdpConfig,
    "org.graylog2.inputs.raw.tcp.RawTCPInput": RawTcpConfig,
};

// INPUT-04: create_input.
//
// Top-level structure mirrors Graylog's InputCreateRequest:
//   { type, title, global, node?, configuration }
//
// The base shape accepts a generic configuration record; the superRefine
// dispatches to the strict per-FQCN variant when one is registered, so
// unknown / less-common input types still flow through without per-type
// schema work (D-01). Errors from the variant validation are re-pathed
// under "configuration.*" so the agent sees a single error tree.
export const CreateInputSchema = mutatingBase.extend({
    type: z.string().min(1, "type is required"),
    title: z.string().min(1, "title is required"),
    global: z.boolean().default(false),
    node: z.string().optional(),
    configuration: z.record(z.unknown()),
}).superRefine((args, ctx) => {
    const strictSchema = variantMap[args.type];
    if (!strictSchema) return; // Generic — already validated as z.record(z.unknown())
    const result = strictSchema.safeParse(args.configuration);
    if (!result.success) {
        for (const issue of result.error.issues) {
            ctx.addIssue({ ...issue, path: ["configuration", ...issue.path] });
        }
    }
});

// INPUT-05: update_input.
//
// Partial-update only — D-03 strict no-echo. `changes` must be non-empty at
// the changes LEVEL (one of title/global/node/configuration must be set),
// NOT at the configuration LEVEL — `{ configuration: {} }` is a valid
// non-empty changes (one key) and produces an empty wire configuration
// (zero echoed fields).
export const UpdateInputSchema = mutatingBase.extend({
    inputId: z.string().min(1, "inputId is required"),
    changes: z.object({
        title: z.string().optional(),
        global: z.boolean().optional(),
        node: z.string().optional(),
        configuration: z.record(z.unknown()).optional(),
    }).refine((c) => Object.keys(c).length > 0, {
        message: "changes must be non-empty",
    }),
});

// INPUT-06: delete_input.
export const DeleteInputSchema = mutatingBase.extend({
    inputId: z.string().min(1, "inputId is required"),
});

// =====================================================================
// INPUT-07 — Plan 01-03 lifecycle schemas
// =====================================================================
//
// start_input  → PUT    /api/system/inputstates/{inputId}
// stop_input   → DELETE /api/system/inputstates/{inputId}
//
// D-08: lifecycle is a uniform mutation — no special-cased runtime path.
// Both schemas accept ONLY { inputId } on top of mutatingBase (no body, no
// state arg). The verb asymmetry (PUT vs DELETE) is documented in tools.js.

export const StartInputSchema = mutatingBase.extend({
    inputId: z.string().min(1, "inputId is required"),
});

export const StopInputSchema = mutatingBase.extend({
    inputId: z.string().min(1, "inputId is required"),
});

// =====================================================================
// INPUT-08 / INPUT-09 / INPUT-10 / INPUT-11 — Plan 01-04 extractor schemas
// =====================================================================
//
// D-07 reconfirmation: strict zod schemas for all 8 Graylog 7.0.6 primitive
// extractor types — grok, regex, regex_replace, split_and_index, substring,
// copy_input, json, lookup_table. The original 01-CONTEXT.md draft listed
// "key-value" as a separate primitive; the live Graylog 7.0.6 Extractor.Type
// enum has no such entry — agents wanting key-value flattening configure the
// `json` extractor with kv_separator + key_separator + flatten:true (see the
// note above ExtractorConfigJson below; also documented in the
// create_extractor tool description in src/tools.js).
//
// Per-type extractor_config shapes verified against:
//   source-code/.../inputs/extractors/{Grok,Regex,RegexReplace,
//   SplitAndIndex,Substring,CopyInput,Json,LookupTable}Extractor.java
// See 01-RESEARCH.md §"Extractor JSON Shapes" Example 5 lines 548-559.

const ExtractorConfigGrok = z.object({
    grok_pattern: z.string().min(1, "grok_pattern is required"),
    named_captures_only: z.boolean().optional(),
});

const ExtractorConfigRegex = z.object({
    regex_value: z.string().min(1, "regex_value is required"),
});

const ExtractorConfigRegexReplace = z.object({
    regex: z.string().min(1, "regex is required"),
    replacement: z.string(),
    replace_all: z.boolean().optional(),
});

const ExtractorConfigSplitAndIndex = z.object({
    split_by: z.string().min(1, "split_by is required"),
    index: z.number().int(),
});

const ExtractorConfigSubstring = z.object({
    begin_index: z.number().int().min(0),
    end_index: z.number().int().min(0),
});

// copy_input takes no per-type config; the empty object is the canonical shape.
const ExtractorConfigCopyInput = z.object({}).strict();

// NOTE (D-07 reconfirmation): the "key-value" name from the original
// CONTEXT.md draft is NOT a separate Graylog primitive. Agents wanting
// key-value flattening configure THIS `json` extractor with kv_separator
// + key_separator + flatten:true. See 01-04-PLAN.md BLOCKER #4 narrative
// and 01-RESEARCH.md §"Extractor JSON Shapes" Example 5 line 558.
const ExtractorConfigJson = z.object({
    list_separator: z.string().optional(),
    key_separator: z.string().optional(),
    kv_separator: z.string().optional(),
    key_prefix: z.string().optional(),
    key_whitespace_replacement: z.string().optional(),
    replace_key_whitespace: z.boolean().optional(),
    flatten: z.boolean().optional(),
});

const ExtractorConfigLookupTable = z.object({
    lookup_table_name: z.string().min(1, "lookup_table_name is required"),
});

// Map keyed by extractor_type — drives the superRefine dispatch on
// CreateExtractorSchema. Adding a new strict variant (if Graylog adds a 9th
// primitive in a future version) is a one-line registration here.
const EXTRACTOR_TYPE_TO_CONFIG = {
    grok: ExtractorConfigGrok,
    regex: ExtractorConfigRegex,
    regex_replace: ExtractorConfigRegexReplace,
    split_and_index: ExtractorConfigSplitAndIndex,
    substring: ExtractorConfigSubstring,
    copy_input: ExtractorConfigCopyInput,
    json: ExtractorConfigJson,
    lookup_table: ExtractorConfigLookupTable,
};

// Closed enum — zod's z.enum rejects "key_value", "bogus_type", and any other
// non-Graylog primitive at parse time before the wrapper even touches build().
const ExtractorTypeEnum = z.enum([
    "grok",
    "regex",
    "regex_replace",
    "split_and_index",
    "substring",
    "copy_input",
    "json",
    "lookup_table",
]);

// INPUT-08: list_extractors — per-input GET. inputId is required (path
// segment); the schema also extends listBase via field-merging so the
// standard `connectionName / limit / fields` projection knobs are honored.
export const ListExtractorsSchema = listBase.extend({
    inputId: z.string().min(1, "inputId is required"),
});

// INPUT-09: create_extractor. Top-level structure mirrors Graylog's
// CreateExtractorRequest envelope (RESEARCH.md §Example 5 lines 532-545):
//   { title, cursor_strategy, source_field, target_field,
//     extractor_type, extractor_config, converters?, condition_type,
//     condition_value, order }
//
// The base shape accepts a generic extractor_config record; the superRefine
// dispatches to the strict per-type variant. Errors from the variant
// validation are re-pathed under "extractor_config.*" so the agent sees a
// single error tree (same pattern as CreateInputSchema's superRefine for
// per-FQCN configuration variants — Plan 02 §"variant-map dispatch").
export const CreateExtractorSchema = mutatingBase.extend({
    inputId: z.string().min(1, "inputId is required"),
    title: z.string().min(1, "title is required"),
    source_field: z.string().min(1, "source_field is required"),
    target_field: z.string().min(1, "target_field is required"),
    extractor_type: ExtractorTypeEnum,
    extractor_config: z.record(z.unknown()),
    cursor_strategy: z.enum(["copy", "cut"]).default("copy"),
    converters: z.array(z.object({
        type: z.string(),
        config: z.record(z.unknown()).optional(),
    })).optional(),
    condition_type: z.enum(["none", "string", "regex"]).default("none"),
    condition_value: z.string().default(""),
    order: z.number().int().min(0).default(0),
}).superRefine((args, ctx) => {
    const strict = EXTRACTOR_TYPE_TO_CONFIG[args.extractor_type];
    if (!strict) return; // Defensive — ExtractorTypeEnum should already gate.
    const result = strict.safeParse(args.extractor_config);
    if (!result.success) {
        for (const issue of result.error.issues) {
            ctx.addIssue({ ...issue, path: ["extractor_config", ...issue.path] });
        }
    }
});

// INPUT-10: update_extractor. D-09 partial-update — same shape as
// UpdateInputSchema (BFL { inputId, extractorId, changes: {...} }).
// extractor_type is immutable on update (Graylog rejects type changes); the
// agent must delete + recreate to switch types. extractor_config IS in the
// changes set because mutating the config in-place is a common operation
// (e.g. tweaking a grok pattern).
export const UpdateExtractorSchema = mutatingBase.extend({
    inputId: z.string().min(1, "inputId is required"),
    extractorId: z.string().min(1, "extractorId is required"),
    changes: z.object({
        title: z.string().optional(),
        source_field: z.string().optional(),
        target_field: z.string().optional(),
        extractor_config: z.record(z.unknown()).optional(),
        cursor_strategy: z.enum(["copy", "cut"]).optional(),
        converters: z.array(z.object({
            type: z.string(),
            config: z.record(z.unknown()).optional(),
        })).optional(),
        condition_type: z.enum(["none", "string", "regex"]).optional(),
        condition_value: z.string().optional(),
        order: z.number().int().min(0).optional(),
    }).refine((c) => Object.keys(c).length > 0, {
        message: "changes must be non-empty",
    }),
});

// INPUT-11: delete_extractor. D-09 single-target — no cascade enumeration
// (extractors carry no child resources). Compared to delete_input (which
// pre-flights extractor enumeration), this is structurally simpler.
export const DeleteExtractorSchema = mutatingBase.extend({
    inputId: z.string().min(1, "inputId is required"),
    extractorId: z.string().min(1, "extractorId is required"),
});
