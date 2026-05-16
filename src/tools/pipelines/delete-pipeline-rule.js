// PIPE-10 — delete_pipeline_rule. Plan 04-04 / D-14 cascade-hash + drift
// refusal centerpiece. Direct analog of Phase 3 delete_stream — same
// machinery (computeRuleCascadeHash + apply-time re-fetch + isError envelope
// on drift) but with ONE cascade endpoint instead of three.
//
// Mitigates: pipelines referencing the rule become broken when the rule
// vanishes (Graylog does NOT cascade-delete; the orphaned `rule "<name>"`
// reference in pipeline source produces a parse error on the pipeline at
// next reload). The wrapper surfaces the referencing pipelines BEFORE the
// destructive verb so the agent can detach + delete + reattach explicitly.
//
// Strategy A (preferred): GET /api/system/pipelines/rule/paginated reads
// the server-computed `used_in_pipelines` join (RuleResource.java:194-225,
// prepareContextForPaginatedResponse). One paginated GET per page; walk
// pages until the target rule appears. The per-PAGE join only contains
// entries for rules ON THAT PAGE — Pitfall 7.
//
// Per-page cap is 50 (Graylog framework default). Safety cap at 200 pages
// (= 10000 rules max) protects against an unterminated pagination loop if
// the API shape drifts (Pitfall 7 / Threat T-04-04-04).
//
// No mutable check (rules have no is_editable field on the wire —
// confirmed against RuleSource.java). D-09 mutable defense does NOT apply.
//
// Execution order (do NOT reorder — each step is a structural enforcement):
//
//   1. build():
//      a. discoverReferencingPipelines:
//         i.  existence pre-flight GET /api/system/pipelines/rule/{id}
//             (F-22: 404 → reason:"pipeline_rule_not_found"; distinguishes
//             "rule missing" from "rule found but unreferenced" — without
//             this, both surface as empty cascade and the agent cannot tell)
//         ii. Strategy A paginated walk for used_in_pipelines join
//      b. compute confirmationToken via computeRuleCascadeHash (Plan 04-01)
//      c. emit dryRun preview with cascades.pipelines + confirmationToken
//
//   2. handler.js requireConfirm gate refuses apply on confirm mismatch
//      (reason:"confirmation_mismatch") BEFORE apply() runs.
//
//   3. apply():
//      a. extract ruleId from req.path (mirror Phase 3 delete_stream.apply)
//      b. discoverReferencingPipelines AGAIN (re-fetch — also re-runs the
//         existence pre-flight, so a rule deleted between dry-run and apply
//         surfaces as pipeline_rule_not_found rather than a generic 404 on
//         the DELETE call)
//      c. recompute hash; refuse with isError reason:"cascade_changed_since_preview"
//         if it drifted (D-14 acceptance gate — DELETE NEVER fires)
//      d. fire DELETE; return sync { deleted: true, ruleId }
//
// Threat-model anchors (see 04-04-PLAN.md <threat_model>):
//   T-04-04-02: cross-rule replay → ruleId in canonical JSON.
//   T-04-04-03: stale-preview elevation → apply-time re-fetch + hash refusal.
//   T-04-04-04: unbounded pagination → safety cap at 200 pages.
//   T-04-04-06: confirm-token forgery → requireConfirm gate at handler.js.

import { defineMutatingHandler } from "../_shared/handler.js";
import { DeletePipelineRuleSchema } from "./schemas.js";
import { computeRuleCascadeHash } from "../_shared/cascade-hash.js";
import { makeClient } from "../../graylog/client.js";
import { GraylogValidationError, GraylogNotFoundError } from "../../graylog/errors.js";

/**
 * Walk the paginated rule list to find the target rule and its referencing
 * pipelines via the server-computed `used_in_pipelines` join.
 *
 * Strategy A: each page returns BOTH the rules AND the join entries for
 * the rules on that page. The target rule must appear in the returned
 * `rules` array for its `used_in_pipelines[id]` entry to be present
 * (Pitfall 7).
 *
 * Existence disambiguation (F-22): the paginated walk alone CANNOT tell
 * "rule not found" from "rule found but unreferenced" — both produce an
 * empty result (the missing rule never appears; the unreferenced rule
 * appears but has no `used_in_pipelines` entry). Without a separate
 * signal, the agent would compute a confirmation token over an empty
 * cascade for a non-existent rule and only discover the 404 at apply
 * time — after the cascade hash gate has already opened. We pre-flight
 * a single `GET /api/system/pipelines/rule/{id}` (cheap, 404-on-missing)
 * BEFORE walking the paginated list so a missing rule surfaces as a
 * structured `pipeline_rule_not_found` reason that the agent can
 * recognize. Any non-404 error during the pre-flight is propagated as
 * `cascade_preflight_failed` (same shape as a paginated-GET failure).
 *
 * @param {object} client
 * @param {string} ruleId
 * @returns {Promise<Array<{id: string, title: string}>>} referencing pipelines
 * @throws GraylogNotFoundError(reason:"pipeline_rule_not_found") if the rule
 *   does not exist on the server (caught & rendered by wrapGraylogError).
 * @throws GraylogValidationError(reason:"cascade_preflight_failed") on
 *   GET failure (existence pre-flight non-404 error OR paginated walk error).
 */
async function discoverReferencingPipelines(client, ruleId) {
    // 1. Existence pre-flight (F-22) — distinguish "rule not found" from
    //    "rule found but unreferenced". 404 → tag with reason and throw;
    //    other errors → cascade_preflight_failed (consistent with the
    //    paginated walk's failure mode below).
    try {
        await client.request(
            "GET",
            `/api/system/pipelines/rule/${ruleId}`,   // Pitfall 3 (rule variant)
            null,
        );
    } catch (err) {
        if (err?.isGraylogError && err.status === 404) {
            const nf = new GraylogNotFoundError(
                `Pipeline rule not found: ${ruleId}`,
                { status: 404, method: "GET", path: `/api/system/pipelines/rule/${ruleId}` },
            );
            nf.reason = "pipeline_rule_not_found";
            throw nf;
        }
        // Non-404 (5xx, 403, network) — preserve the cascade pre-flight
        // failure shape so the agent sees one stable reason for "the
        // pre-flight could not establish cascade state".
        const e = new GraylogValidationError(
            `Cascade pre-flight failed: GET /api/system/pipelines/rule/${ruleId} — ${err.message}`,
            { status: err?.status ?? 503, method: "GET", path: `/api/system/pipelines/rule/${ruleId}` },
        );
        e.reason = "cascade_preflight_failed";
        throw e;
    }

    // 2. Paginated walk for the `used_in_pipelines` join. At this point we
    //    KNOW the rule exists, so any empty result genuinely means "rule
    //    found but unreferenced".
    const perPage = 50;
    const maxPages = 200; // Pitfall 7 safety cap (10000 rules max)
    for (let page = 1; page <= maxPages; page++) {
        let rsp;
        try {
            rsp = await client.request(
                "GET",
                `/api/system/pipelines/rule/paginated?page=${page}&per_page=${perPage}`,
                null,
            );
        } catch (err) {
            const e = new GraylogValidationError(
                `Cascade pre-flight failed: GET /api/system/pipelines/rule/paginated — ${err.message}`,
                { status: 503, method: "GET", path: "/api/system/pipelines/rule/paginated" },
            );
            e.reason = "cascade_preflight_failed";
            throw e;
        }
        const rules = Array.isArray(rsp?.rules) ? rsp.rules : [];
        const target = rules.find((r) => r.id === ruleId);
        if (target) {
            // RESEARCH line 1276-1278: server may put the join under
            // `context.used_in_pipelines` OR at the top level `used_in_pipelines`.
            // We try both; the absence of either is treated as "no referencing
            // pipelines" (not a failure).
            const refs = rsp?.context?.used_in_pipelines?.[ruleId]
                ?? rsp?.used_in_pipelines?.[ruleId]
                ?? [];
            return refs.map((p) => ({ id: p.id, title: p.title }));
        }
        // Early-exit on partial page (= last page; rule not in cluster).
        if (rules.length < perPage) break;
    }
    // Rule existence was confirmed by the pre-flight, but it did not
    // appear in the paginated walk (eviction between calls, or pagination
    // shape drift). Return [] — apply-time re-fetch + drift refusal still
    // protects against acting on a stale cascade.
    return [];
}

export const handleDeletePipelineRule = defineMutatingHandler({
    name: "delete_pipeline_rule",
    schema: DeletePipelineRuleSchema,
    async build(args) {
        const client = makeClient(args._conn);
        const path = `/api/system/pipelines/rule/${args.ruleId}`;

        // 1. Strategy A cascade pre-flight.
        const pipelines = await discoverReferencingPipelines(client, args.ruleId);

        // 2. Freeze cascade into confirmation hash (Plan 04-01 thin wrapper).
        const confirmationToken = computeRuleCascadeHash({
            ruleId: args.ruleId,
            pipelineIds: pipelines.map((p) => p.id),
        });

        return {
            method: "DELETE",
            path,
            body: undefined,
            cascades: { pipelines },
            postApplyEstimate: { id: args.ruleId, deleted: true },
            _confirmationToken: confirmationToken,
        };
    },
    async apply(client, req) {
        // D-14 apply-time drift refusal: re-fetch + recompute + compare.
        // Mirror of Phase 3 delete_stream.apply — ruleId extracted from
        // req.path so apply() is fully driven by the build()-emitted
        // descriptor (no closure capture of build()'s args).
        const m = req.path.match(/rule\/([^/?]+)/);
        const ruleId = m ? m[1] : "unknown";

        // Re-fetch may throw GraylogValidationError(cascade_preflight_failed);
        // the wrapper's outer try/catch routes that through wrapGraylogError
        // verbatim — apply-time cascade pre-flight failure surfaces the same
        // structured error envelope as a dry-run failure.
        const pipelines = await discoverReferencingPipelines(client, ruleId);

        const currentHash = computeRuleCascadeHash({
            ruleId,
            pipelineIds: pipelines.map((p) => p.id),
        });

        if (currentHash !== req._confirmationToken) {
            // handler.js passes this isError envelope through verbatim
            // (handler.js:200-204 — Plan 02-01 amendment).
            return {
                isError: true,
                reason: "cascade_changed_since_preview",
                content: [{
                    type: "text",
                    text: `[delete_pipeline_rule] cascade_changed_since_preview: referencing pipelines drifted between dry-run and apply. Re-run dry-run to see the new cascade and obtain a fresh confirmationToken.`,
                }],
            };
        }

        await client.request("DELETE", req.path, null);
        // Sync envelope per project precedent (Phase 3 delete_stream / Phase 4
        // delete_pipeline). No async:true, no job_id, no await_system_job.
        return { deleted: true, ruleId };
    },
    summarize: (args) => `Delete pipeline rule ${args.ruleId}`,
    requireConfirm: ({ req }) => req._confirmationToken ?? null,
});
