// defineMutatingHandler — the cross-cutting factory every mutating Graylog tool
// composes through. Owns the canonical dryRun=true default (FOUND-04), zod
// validation (FOUND-05), connection resolution (FOUND-09 + D-08), D-07 wrapper-
// layer writable-flag short-circuit, idempotency-key auto-derivation (FOUND-10),
// build/apply split with __SERVER_ASSIGNED__ sentinel (Pitfall C6), and
// typed-error wrapping via wrapGraylogError.
//
// Order of operations (do NOT reorder — each step is a structural enforcement):
//   1. zod.parse(args)                — fails → formatZodError → isError
//   2. resolveConnection(args)        — fails → return error envelope
//   3. conn.writable === false        — return isError + reason:connection_read_only
//                                       BEFORE build/apply (D-07; build never sees this)
//   4. deriveIdempotencyKey or use    — agent-provided idempotencyKey wins
//      args.idempotencyKey
//   5. build(args)                     — pure: { method, path, body, [postApplyEstimate],
//                                       [existingMatches], [normalize] }
//   6. if dryRun: emit preview         — postApplyEstimate.id defaults to
//                                       __SERVER_ASSIGNED__; existingMatches defaults []
//   7. else: apply(client, req)        — caught: GraylogError → wrapGraylogError
//                                                 plain Error → wrapGraylogError fallback
//   8. normalize(raw) → { id, body }   — FOUND-08; falls back to { id: raw?.id, body: raw }
//
// Defense-in-depth note: src/graylog/client.js ALSO refuses non-GET against
// conn.writable === false (Plan 03 / Pitfall 4). The wrapper-side check here
// is the agent-friendly path (no axios touched, clear MCP error envelope);
// the client-side check is the safety net for any path that bypasses the
// wrapper (e.g. a future service layer).

import { resolveConnection } from "./connection.js";
import { SERVER_ASSIGNED_SENTINEL } from "./dry-run.js";
import { deriveIdempotencyKey } from "./idempotency.js";
import {
    errorResponse,
    wrapGraylogError,
    formatZodError,
} from "./errors.js";
import { makeClient } from "../../graylog/client.js";

/**
 * @typedef {{ method: string, path: string, body?: unknown,
 *   postApplyEstimate?: object,
 *   existingMatches?: Array<unknown>,
 *   normalize?: (raw: unknown) => { id: unknown, body: unknown } }} RequestDescriptor
 */

/**
 * @param {object} spec
 * @param {string} spec.name              snake_case tool name (used in hash + error context)
 * @param {import("zod").ZodObject} spec.schema  Zod schema extending mutatingBase
 * @param {(args: object) => RequestDescriptor | Promise<RequestDescriptor>} spec.build
 *   Pure: args → request descriptor. May be async (A4) so update_input can pre-flight
 *   a GET on the current input and the cached type catalogue inside build().
 * @param {(client: object, req: RequestDescriptor) => Promise<unknown>} spec.apply
 * @param {(args: object, req: RequestDescriptor) => string} [spec.summarize]
 * @returns {(request: { params?: { arguments?: object } }) => Promise<object>}
 */
export function defineMutatingHandler(spec) {
    const { name, schema, build, apply, summarize } = spec;

    return async function handler(request) {
        const rawArgs = request?.params?.arguments ?? {};

        // 1. Validate input (FOUND-05)
        let args;
        try {
            args = schema.parse(rawArgs);
        } catch (err) {
            return errorResponse(formatZodError(err));
        }

        // 2. Resolve connection (FOUND-09 + D-08).
        //    The _testConnection seam is a project-standard magic arg (see
        //    cluster-errors.js + template-mgmt.js). It is intentionally absent
        //    from mutatingBase / per-domain schemas so zod's default `strip`
        //    mode drops it from production-agent payloads (threat-model
        //    T-00-04-05 — agent cannot bypass connection lookup at runtime).
        //    Inside the wrapper we still need the seam to work for unit tests,
        //    so we read it from the raw pre-zod args and re-merge it onto the
        //    parsed args before resolveConnection consumes them.
        const seamArgs = rawArgs._testConnection
            ? { ...args, _testConnection: rawArgs._testConnection }
            : args;
        const { conn, name: connectionName, error } = resolveConnection(seamArgs);
        if (error) return error;

        // 3. Writable gate (D-07): short-circuit BEFORE building request.
        //    build() is pure, but we still don't want to spend cycles or surface
        //    a preview to the agent for a connection it can never apply against.
        if (conn.writable === false) {
            return {
                isError: true,
                reason: "connection_read_only",
                content: [{
                    type: "text",
                    text: `Connection "${connectionName}" is marked read-only (writable: false). Refusing ${name}.`,
                }],
            };
        }

        // 4. Idempotency key — auto-derive if absent (FOUND-10). Agent override wins
        //    so the agent can pin a key for retry-window dedupe across blueprint steps.
        const idempotencyKey = args.idempotencyKey
            ?? deriveIdempotencyKey({ connectionName, toolName: name, args });

        // 5. Build request descriptor (pure — guarantees preview ≡ apply payload).
        // build() may be async (A4) — update_input needs pre-flight GET inside build
        // (current input fetch + cached type catalogue lookup for is_encrypted
        // detection). Awaiting a synchronous return is a no-op, so existing callers
        // see no behavioural change.
        let req;
        try {
            req = await build(args);
        } catch (err) {
            return wrapGraylogError(err, name);
        }

        // 6. Dry-run-or-apply branch (FOUND-03 + FOUND-04)
        const dryRun = args.dryRun ?? true; // default-true enforced ONCE, here
        if (dryRun) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        dryRun: true,
                        tool: name,
                        connection: connectionName,
                        idempotencyKey,
                        summary: summarize?.(args, req) ?? `${req.method} ${req.path}`,
                        preview: {
                            method: req.method,
                            path: req.path,
                            body: req.body,
                        },
                        // FOUND-04 / Pitfall C6: tell the agent which fields the server fills.
                        postApplyEstimate: req.postApplyEstimate
                            ?? { id: SERVER_ASSIGNED_SENTINEL },
                        // FOUND-11: populated by build() when it does a list-pre-check
                        // via findExistingMatches (Phase 1+); always an array.
                        existingMatches: req.existingMatches ?? [],
                        applyHint: "Re-call with dryRun: false to apply",
                    }),
                }],
            };
        }

        // 7. Apply
        try {
            const client = makeClient(conn);
            const raw = await apply(client, req);
            // FOUND-08: normalize to { id, body } regardless of Graylog's response shape.
            const { id, body } = req.normalize?.(raw) ?? { id: raw?.id, body: raw };
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        dryRun: false,
                        applied: true,
                        tool: name,
                        connection: connectionName,
                        idempotencyKey,
                        result: { id, body },
                    }),
                }],
            };
        } catch (err) {
            return wrapGraylogError(err, name);
        }
    };
}
