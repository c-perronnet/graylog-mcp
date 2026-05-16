// INPUT-05: update_input — PUT /api/system/inputs/{inputId}.
//
// THE C3 MITIGATION CENTERPIECE. The contract this file owns:
//   1. Partial-update only — schema is { inputId, changes: {...subset...} }.
//      No `full_config` mode; the wrapper rejects anything outside the changes
//      subset at the zod layer.
//   2. D-03 STRICT NO-ECHO — the wire `configuration` object is built ONLY
//      from `args.changes.configuration` entries. We do NOT iterate
//      `current.configuration` to copy unchanged non-encrypted fields. This
//      is the ROADMAP success criterion 2 contract: "preview emits ONLY the
//      changed field." Graylog's PUT deserializer accepts a partial
//      configuration and preserves unspecified fields server-side via
//      EncryptedInputConfigs.merge.
//   3. Encrypted fields the agent did NOT pass are NEVER on the wire —
//      automatic consequence of (2). C3 is impossible to reproduce because
//      nothing from current.configuration flows back to Graylog.
//   4. Encrypted fields the agent DID pass are wrapped as { set_value: <new> }
//      on the wire (encodeEncryptedForWire) and redacted to REDACTION_PLACEHOLDER
//      in the dry-run preview (redactForPreview).
//   5. Top-level envelope fields `type`, `title`, `global` are merged from
//      current state when the agent did not pass them — Graylog's PUT
//      requires `type` + `title` + `global` on every call. `node` is
//      strict no-echo (D-03): emitted ONLY when the agent passes
//      `changes.node` explicitly, never sourced from current state.
//
// Why this matters: the prior plan iteration of 01-02 copied non-encrypted
// current.configuration entries into the wire body to "preserve them". That
// violated D-03 and leaked the masked encrypted GET-response values
// (`<value hidden>`) into the wire body, which Graylog would have re-encrypted
// as the literal placeholder string — credentials silently wiped (the C3
// pitfall). Strict no-echo prevents both the leak and the wipe by never
// touching current.configuration at all.

import { defineMutatingHandler } from "../_shared/handler.js";
import { UpdateInputSchema } from "./schemas.js";
import { getCachedTypeCatalogue, getEncryptedFieldNamesForType } from "./type-catalogue.js";
import { redactForPreview, encodeEncryptedForWire } from "./redact.js";
import { makeClient } from "../../graylog/client.js";
import { toIdBody } from "../../graylog/normalize.js";

export const handleUpdateInput = defineMutatingHandler({
    name: "update_input",
    schema: UpdateInputSchema,
    async build(args) {
        // Connection already resolved by handler.js — threaded via leading-
        // underscore framework-internal keys.
        const connectionName = args._connectionName;
        const conn = args._conn;
        const client = makeClient(conn);

        // 1. Pre-flight: fetch current input state. Required to source the
        //    immutable `type` field (Graylog rejects PUT bodies without it)
        //    and the optional `title` / `global` / `node` fields when the
        //    agent did not pass an override.
        const current = await client.request(
            "GET",
            `/api/system/inputs/${args.inputId}`,
            null,
        );

        // 2. Catalogue lookup. Even with strict no-echo, the catalogue is
        //    still needed: when the agent DOES explicitly pass an encrypted
        //    field in changes.configuration, encodeEncryptedForWire must
        //    wrap it as { set_value } and redactForPreview must hide the
        //    value in the preview. The Set is empty for inputs whose type
        //    has no encrypted fields, which makes both functions a no-op.
        const catalogue = await getCachedTypeCatalogue(connectionName, conn);
        const encryptedFields = getEncryptedFieldNamesForType(catalogue, current.type);

        // 3. agentConfig sentinel:
        //   - null  → agent did NOT touch configuration at all
        //              (changes has no `configuration` key)
        //   - {}    → agent explicitly passed an empty configuration block
        //              (D-03 acceptance: emit `configuration: {}` on the wire)
        //   - {...} → agent passed specific configuration changes
        const agentConfig = args.changes.configuration ?? null;

        // 4. Envelope: type + title + global + node. Type is immutable on
        //    update and always comes from current state. Title/global come
        //    from changes when present, else from current. `node` is strict
        //    no-echo (D-03): emitted ONLY when the agent explicitly passes
        //    `changes.node`, mirroring the `configuration` pattern below.
        //    Never sourced from `current.node` — that would echo
        //    GET-response state back to the wire, the very bug D-03 forbids.
        const wireBody = {
            type: current.type,
            title: args.changes.title ?? current.title,
            global: args.changes.global ?? current.global,
            ...(args.changes.node !== undefined ? { node: args.changes.node } : {}),
            // Configuration block: only included when the agent passed
            // changes.configuration (even as `{}`). When the agent did not
            // touch configuration at all (`null` sentinel), the key is
            // omitted entirely from the wire body — strictest "only the
            // changed field" interpretation.
            ...(agentConfig !== null
                ? { configuration: encodeEncryptedForWire(agentConfig, encryptedFields) }
                : {}),
        };

        // 5. Preview body — same envelope, but encrypted values shown as the
        //    REDACTION_PLACEHOLDER. The agent sees what fields would change
        //    without seeing the new secrets.
        const previewBody = {
            ...wireBody,
            ...(agentConfig !== null
                ? { configuration: redactForPreview(agentConfig, encryptedFields) }
                : {}),
        };

        return {
            method: "PUT",
            path: `/api/system/inputs/${args.inputId}`,
            body: previewBody,
            postApplyEstimate: { id: args.inputId },
            normalize: (raw) => toIdBody(raw, { idFields: ["id"] }),
            // apply() reads _applyBody so the redacted preview body never
            // reaches Graylog.
            _applyBody: wireBody,
        };
    },
    apply: (client, req) => client.request(req.method, req.path, req._applyBody ?? req.body),
    summarize: (args) => `Update input ${args.inputId} (${Object.keys(args.changes).length} change(s))`,
});
