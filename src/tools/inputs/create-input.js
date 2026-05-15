// INPUT-04: create_input — POST /api/system/inputs.
//
// Composes through defineMutatingHandler so dryRun, the writable-flag gate,
// idempotency, and the __SERVER_ASSIGNED__ sentinel are uniform with every
// other mutating tool.
//
// Two D-04 / M5 details land here:
//   1. The dry-run preview body MUST show encrypted fields as REDACTION_PLACEHOLDER
//      (D-04). The apply body wraps the same fields as { set_value } for Graylog's
//      EncryptedInputConfigs.merge. The two bodies differ ONLY in the encrypted
//      field encoding — the preview reveals the field is being set without
//      revealing the secret.
//   2. existingMatches is surfaced via findExistingMatches({listPath, matchFn})
//      so the agent sees an exact title+type collision BEFORE applying (M5
//      idempotency mitigation; Phase 0 stub became real in Plan 01).
//
// _applyBody sibling on the RequestDescriptor: handler.js doesn't know that
// preview vs. apply bodies differ. The apply callback below reads _applyBody
// instead of req.body so the redacted preview body never reaches Graylog.

import { defineMutatingHandler } from "../_shared/handler.js";
import { CreateInputSchema } from "./schemas.js";
import { getCachedTypeCatalogue, getEncryptedFieldNamesForType } from "./type-catalogue.js";
import { redactForPreview, encodeEncryptedForWire } from "./redact.js";
import { findExistingMatches } from "../_shared/conflict.js";
import { makeClient } from "../../graylog/client.js";
import { toIdBody } from "../../graylog/normalize.js";

export const handleCreateInput = defineMutatingHandler({
    name: "create_input",
    schema: CreateInputSchema,
    async build(args) {
        // handler.js threads the already-resolved connection through build args
        // under leading-underscore framework-internal keys (matches the
        // _connectionName / _conn pattern in defineListHandler). No need to
        // re-resolve here.
        const connectionName = args._connectionName;
        const conn = args._conn;

        // Live type catalogue — gives us the per-type encrypted-field set
        // (D-02 source of truth) and is cached per-connection so this GET
        // costs one round-trip per connection per process.
        const catalogue = await getCachedTypeCatalogue(connectionName, conn);
        const encryptedFields = getEncryptedFieldNamesForType(catalogue, args.type);

        // M5 / Pitfall: Graylog allows duplicate input titles. Pre-flight a
        // list call so the agent sees the collision in the dry-run before
        // applying. similarity_reason explains why the agent should pause.
        const client = makeClient(conn);
        const existingMatches = await findExistingMatches(client, {
            listPath: "/api/system/inputs",
            matchFn: (item) => item.title === args.title && item.type === args.type,
            similarityReason: "exact title + type match",
        });

        // Wire body — the body Graylog actually receives on apply. Encrypted
        // fields are { set_value: <new> } so EncryptedInputConfigs.merge
        // treats them as fresh values (RESEARCH.md §"Encrypted-Field Merge").
        const wireBody = {
            type: args.type,
            title: args.title,
            global: args.global,
            ...(args.node !== undefined ? { node: args.node } : {}),
            configuration: encodeEncryptedForWire(args.configuration, encryptedFields),
        };

        // Preview body — same shape, but encrypted values are replaced with
        // REDACTION_PLACEHOLDER. D-04 contract: agent sees the field is set
        // without seeing the secret.
        const previewBody = {
            ...wireBody,
            configuration: redactForPreview(args.configuration, encryptedFields),
        };

        return {
            method: "POST",
            path: "/api/system/inputs",
            body: previewBody,
            postApplyEstimate: { id: "__SERVER_ASSIGNED__" },
            existingMatches,
            normalize: (raw) => toIdBody(raw, { idFields: ["id"] }),
            // Sibling consumed by apply() so the redacted preview body never
            // reaches Graylog. handler.js is body-agnostic; this field is
            // internal to create_input.
            _applyBody: wireBody,
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req._applyBody ?? req.body),
    summarize: (args) => `Create ${args.type} input "${args.title}" (global=${args.global})`,
});
