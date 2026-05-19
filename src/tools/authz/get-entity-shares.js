// SHARE-02 — get_entity_shares. POST /api/authz/shares/entities/{grn}/prepare.
//
// Returns the full EntityShareResponse DTO — active_shares, available_grantees,
// available_capabilities, synced_entities, validation_result — UNFLATTENED.
//
// Pattern: a plain async handler, NOT either of the shared factory handlers
// (the list-projection one or the mutating one). This is neither a list nor a
// mutation — the response is a single nested DTO the projection machinery
// would mangle, and a `dryRun` flag is meaningless on a @NoAuditEvent probe.
//
// Mirrors src/tools/pipelines/get-pipeline.js line-for-line; diverges only in
// using POST + a {} body (the read-via-/prepare contract) and a GRN-normalization
// step before any HTTP call.
//
// Pitfall: `active_shares` excludes the requesting user's OWN grant (Graylog
// filters it server-side via getForTargetExcludingGrantee). An empty
// active_shares is correct, not a bug — see the tools.js description.

import { GetEntitySharesSchema } from "./schemas.js";
import { resolveConnection } from "../_shared/connection.js";
import { makeClient } from "../../graylog/client.js";
import { buildGrn, parseGrn } from "./grn-helpers.js";
import { fetchEntitySharePreview } from "./prepare-share.js";
import {
    errorResponse,
    formatZodError,
    wrapGraylogError,
} from "../_shared/errors.js";

export async function handleGetEntityShares(request) {
    const rawArgs = request?.params?.arguments ?? {};

    // 1. Validate — the .refine enforces entityGrn XOR (entityType,entityId).
    let args;
    try {
        args = GetEntitySharesSchema.parse(rawArgs);
    } catch (err) {
        return errorResponse(formatZodError(err));
    }

    // 2. Resolve connection — _testConnection seam re-merged from pre-zod args
    //    so production agents can never bypass the connection lookup (the seam
    //    is intentionally absent from the schema; zod `strip` mode drops it).
    const seamArgs = rawArgs._testConnection
        ? { ...args, _testConnection: rawArgs._testConnection }
        : args;
    const { conn, name: connectionName, error } = resolveConnection(seamArgs);
    if (error) return error;

    // 3. Normalize the entity reference to a canonical GRN. This MUST happen
    //    before any HTTP call so a malformed GRN never reaches the network.
    let entityGrn;
    try {
        entityGrn = args.entityGrn
            ? (parseGrn(args.entityGrn), args.entityGrn.toLowerCase())
            : buildGrn(args.entityType, args.entityId);
    } catch (err) {
        return errorResponse(`Invalid entity reference: ${err.message}`);
    }

    // 4. Fire the /prepare probe. Errors map through wrapGraylogError so a 404
    //    or 403 surfaces as a clean MCP error envelope with `get_entity_shares`
    //    embedded in the rendered text for agent-debuggability.
    try {
        const client = makeClient(conn);
        const shares = await fetchEntitySharePreview(client, entityGrn);
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    tool: "get_entity_shares",
                    connection: connectionName,
                    entity_shares: shares, // FULL nested EntityShareResponse, unflattened
                }),
            }],
        };
    } catch (err) {
        return wrapGraylogError(err, "get_entity_shares");
    }
}
