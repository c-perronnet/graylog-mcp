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
 *   cascades?: object,
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
    const { name, schema, build, apply, summarize, requireConfirm } = spec;

    return async function handler(request) {
        const rawArgs = request?.params?.arguments ?? {};

        // 1. Validate input (FOUND-05). Strip framework-internal seam args
        //    BEFORE schema.parse so .strict() schemas (Plan 06-02 D-02
        //    enforcement on CreateDashboardSchema/UpdateDashboardSchema) don't
        //    reject the test seam at parse time. The seam is re-merged onto
        //    `args` below for resolveConnection. Without this strip, .strict()
        //    schemas would reject `_testConnection` as Unrecognized key —
        //    breaking every test that uses the project-standard seam.
        const { _testConnection, ...rawArgsForParse } = rawArgs;
        let args;
        try {
            args = schema.parse(rawArgsForParse);
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
        //
        // Thread `_connectionName` + `_conn` through build args so handlers that
        // need a Graylog client inside build (e.g. create_input → findExistingMatches +
        // type catalogue; update_input → current-state GET + catalogue; delete_input
        // → extractor pre-flight) can use the already-resolved connection without a
        // duplicate resolveConnection call. Leading-underscore keys flag them as
        // framework-internal — same convention as `_testConnection` / `_connectionName`
        // in defineListHandler (Plan 01 SUMMARY §"_connectionName + _conn pass-through").
        let req;
        try {
            req = await build({ ...args, _connectionName: connectionName, _conn: conn });
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
                            // Plan 11-02: opt-in `preview.cascades` for handlers
                            // that ALSO want cascade previews co-located with
                            // the HTTP call shape (the "this is what's about
                            // to happen" view). Phase 11 role-management tests
                            // (D-15 diff, D-16 users_dissociated, D-10 assign
                            // current_roles + roles_after_apply, D-03 warnings)
                            // assert `payload.preview.cascades.X` because
                            // cascade previews are a load-bearing dry-run
                            // safety feature. Opt-in via `req.previewCascades`
                            // so Phases 1-10 tools (which pin the canonical
                            // `preview: {method, path, body}` shape via
                            // snapshot tests) are unaffected; the top-level
                            // `cascades` spread below still fires for them.
                            ...(req.previewCascades ? { cascades: req.previewCascades } : {}),
                        },
                        // FOUND-04 / Pitfall C6: tell the agent which fields the server fills.
                        postApplyEstimate: req.postApplyEstimate
                            ?? { id: SERVER_ASSIGNED_SENTINEL },
                        // FOUND-11: populated by build() when it does a list-pre-check
                        // via findExistingMatches (Phase 1+); always an array.
                        existingMatches: req.existingMatches ?? [],
                        // Plan 02-01 / D-01 (Phase 2): build() may populate
                        // _confirmationToken when a destructive operation needs
                        // an apply-time confirmation hash (e.g. delete_index_set
                        // with deleteIndices:true). Opt-in only — absent when
                        // build() didn't set it.
                        ...(req._confirmationToken ? { confirmationToken: req._confirmationToken } : {}),
                        // Plan 01-02 / D-05: build() may populate cascades to surface
                        // server-side side-effects (e.g. delete_input cascade-deletes
                        // extractors). Opt-in only — absent when build() didn't set it.
                        ...(req.cascades ? { cascades: req.cascades } : {}),
                        // Plan 04-02 / D-06: build() may populate parseResult to
                        // surface the server-authoritative parse pre-flight outcome
                        // for create_pipeline / update_pipeline (and Plan 04-03's
                        // create_pipeline_rule / update_pipeline_rule). Opt-in only —
                        // absent when build() didn't set it (e.g. update_pipeline
                        // with title-only changes that skip the parse round-trip).
                        ...(req.parseResult ? { parseResult: req.parseResult } : {}),
                        // Plan 05-02 / D-03 (C5 mitigation): build() may populate
                        // migration to surface the v6→v7 aggregation-condition
                        // rewrite emitted by migrateV6ToV7AggregationConditions.
                        // Opt-in only — absent when migration.migrated is false
                        // (build() omits the key entirely so the preview JSON stays
                        // lean on the v7 happy path). Consumed by create_event_definition
                        // + update_event_definition.
                        ...(req.migration ? { migration: req.migration } : {}),
                        // Plan 06-02 / D-01 (C7 mitigation — RESEARCH §"Pattern 3:
                        // Blueprint Chain-Transcript"): build() may populate a
                        // `chain` transcript of [{step, tool, request, dependsOn?,
                        // postApplyEstimate?}] entries. The agent sees the FULL
                        // multi-step plan up-front in the dry-run preview without
                        // ever having to compose intermediate IDs. Apply-time, the
                        // chain is walked by executeChain (src/tools/_shared/blueprint-chain.js).
                        // Opt-in only — absent when build() didn't set it (e.g.
                        // single-step mutating tools). Consumed by create_dashboard,
                        // remove_widget (Plan 06-02), and every BLUE-XX blueprint
                        // (Plans 06-04 / 06-05).
                        ...(req.chain ? { chain: req.chain } : {}),
                        applyHint: "Re-call with dryRun: false to apply",
                    }),
                }],
            };
        }

        // 6b. Plan 02-01 (Option A): wrapper-level confirmation gate.
        //     When a destructive tool (e.g. delete_index_set with
        //     deleteIndices:true) declares a requireConfirm callback that
        //     returns a non-null token, the wrapper checks args.confirm ===
        //     token BEFORE apply(). Mismatched OR missing confirm → structured
        //     error; apply() never runs.
        //     Per D-16: this gate fires AFTER the writable gate (step 3) so a
        //     read-only connection refuses the call before any confirmation
        //     check — defense in depth.
        //     Per D-03: if requireConfirm returns null/undefined the gate is a
        //     no-op (e.g. delete_index_set with deleteIndices:false issues no
        //     token and the requireConfirm callback returns null).
        if (typeof requireConfirm === "function") {
            const expectedToken = requireConfirm({ args, req });
            if (expectedToken !== null && expectedToken !== undefined) {
                if (args.confirm !== expectedToken) {
                    return {
                        isError: true,
                        reason: "confirmation_mismatch",
                        content: [{
                            type: "text",
                            text: `[${name}] confirmation_mismatch: agent must echo the dry-run confirmationToken in args.confirm to apply this destructive operation.`,
                        }],
                    };
                }
            }
        }

        // 7. Apply
        try {
            const client = makeClient(conn);
            const raw = await apply(client, req);
            // Plan 02-01: apply() may surface a structured MCP error envelope
            // verbatim — used by await_system_job's info_substring path to
            // return job_not_found / ambiguous_info_substring reasons without
            // having to throw a typed GraylogError. The wrapper passes the
            // envelope through unchanged. Detect by isError flag presence.
            if (raw && raw.isError === true) {
                return raw;
            }
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
