// Cross-cutting zod schemas (FOUND-05).
//
// Every mutating-tool schema extends `mutatingBase` so the three universal fields
// (dryRun, connectionName, idempotencyKey) appear in one place — the wrapper layer
// in handler.js never has to special-case them. Per-domain schemas live under
// src/tools/<domain>/schemas.js and import + extend from here.
//
// listBase is the analog for read/list tools that go through defineListHandler.

import { z } from "zod";

export const mutatingBase = z.object({
    dryRun: z.boolean().default(true),
    connectionName: z.string().optional(),
    idempotencyKey: z.string().optional(),
});

export const listBase = z.object({
    connectionName: z.string().optional(),
    limit: z.number().int().positive().optional(),
    fields: z.union([z.literal("all"), z.array(z.string())]).optional(),
});
