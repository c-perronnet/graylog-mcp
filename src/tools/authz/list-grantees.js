// SHARE-09 — list_grantees. POST /api/authz/shares/entities/{grn}/prepare.
//
// Same /prepare probe as get_entity_shares, but projects only the
// `available_grantees` table — the {id GRN, type, title} list an agent uses to
// map a username to the user-GRN that share_entity (Phase 10) needs.
//
// Pattern: a plain async handler, NOT either shared factory handler.
// Identical structure to get-entity-shares.js — diverges ONLY at the envelope
// (projects available_grantees) and the wrapGraylogError tool name.

import { ListGranteesSchema } from "./schemas.js";
import { resolveConnection } from "../_shared/connection.js";
import { makeClient } from "../../graylog/client.js";
import { buildGrn, parseGrn } from "./grn-helpers.js";
import { fetchEntitySharePreview } from "./prepare-share.js";
import {
    errorResponse,
    formatZodError,
    wrapGraylogError,
} from "../_shared/errors.js";

export async function handleListGrantees(request) {
    const rawArgs = request?.params?.arguments ?? {};

    // 1. Validate — the .refine enforces entityGrn XOR (entityType,entityId).
    let args;
    try {
        args = ListGranteesSchema.parse(rawArgs);
    } catch (err) {
        return errorResponse(formatZodError(err));
    }

    // 2. Resolve connection — _testConnection seam re-merged from pre-zod args.
    const seamArgs = rawArgs._testConnection
        ? { ...args, _testConnection: rawArgs._testConnection }
        : args;
    const { conn, name: connectionName, error } = resolveConnection(seamArgs);
    if (error) return error;

    // 3. Normalize the entity reference to a canonical GRN BEFORE any HTTP call.
    let entityGrn;
    try {
        entityGrn = args.entityGrn
            ? (parseGrn(args.entityGrn), args.entityGrn.toLowerCase())
            : buildGrn(args.entityType, args.entityId);
    } catch (err) {
        return errorResponse(`Invalid entity reference: ${err.message}`);
    }

    // 4. Fire the /prepare probe and project to available_grantees.
    try {
        const client = makeClient(conn);
        const preview = await fetchEntitySharePreview(client, entityGrn);
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    tool: "list_grantees",
                    connection: connectionName,
                    grantees: preview?.available_grantees ?? [],
                }),
            }],
        };
    } catch (err) {
        return wrapGraylogError(err, "list_grantees");
    }
}
