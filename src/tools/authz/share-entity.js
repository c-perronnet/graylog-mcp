// SHARE-01 / SHARE-03 / SHARE-04 / SHARE-05 / SHARE-06 / SHARE-07 / SHARE-08
// + AUTHZ-01 — share_entity.
//
// COMPOSITION OVER INVENTION. Every primitive this handler reaches for is
// already shipped:
//   - defineMutatingHandler  (Phase 1 — dryRun:true default, writable gate,
//                             idempotency, requireConfirm)
//   - computeShareGrantHash  (Phase 8 — byte-pinned sha-256 over the merged
//                             grant set; tested in cascade-hash.test.js)
//   - resolveEntityGrn       (Phase 8 — SHAREABLE_TYPES guard rejects
//                             grantee-type GRNs before they reach the network)
//   - fetchEntitySharePreview (Phase 9 — POST /entities/{grn}/prepare with
//                             empty body; the read-side of the same endpoint
//                             family that this handler writes)
//   - Capability + ENTITY_TYPES + ShareEntitySchema  (Plan 10-01 — input
//                             contract with mutatingBase + entity-XOR +
//                             grantee-XOR + revoke<->capability refines)
//
// NEW in this file: the merge step (Map<granteeGrn, capability>), the diff,
// the client-side last-own guard, the 400-with-body parser, and the
// composition itself.
//
// CORRECT ENDPOINT: POST /api/authz/shares/entities/{encodeURIComponent(grn)}
// (NO /prepare suffix). The /prepare suffix is the READ probe (Phase 9). The
// commit endpoint is the same path WITHOUT /prepare and accepts a full
// `EntityShareRequest`.
//
// READ-MERGE-WRITE IS MANDATORY (Pitfall 1 / SHARE-05):
// EntitySharesService.updatePrimaryEntityShares is FULL-REPLACE semantics on
// the server side. A naive POST {selected_grantee_capabilities: {newUser:view}}
// silently revokes every other grantee. build() reads current active_shares
// via fetchEntitySharePreview, merges in (or removes for revoke:true) the
// named grantee, and POSTs the FULL merged set. The Pitfall-1 acceptance gate
// test (current=[A,B], add C → body=[A,B,C], NOT [C]) is the load-bearing
// regression guard.
//
// DRIFT REFUSAL via handler.js step 5: build() runs UNCONDITIONALLY on both
// dry-run and apply branches. The apply-time re-prepare fetches fresh
// active_shares; the recomputed token differs from args.confirm if
// active_shares drifted between dry-run and apply → requireConfirm refuses
// with reason: "confirmation_mismatch".
//
// ERROR-CLASS-TO-REASON MAP:
//   thrown in build() via spoofed GraylogError ({ isGraylogError, status: 422,
//     reason }):    not_currently_granted | merge_size_mismatch |
//                   would_leave_entity_ownerless | username_not_found |
//                   ambiguous_grantee_username
//   apply() 400 with body.validation_result.failed === true → structured
//     isError envelope with reason: "share_validation_failed"; the wrapper
//     passes it through verbatim (handler.js line 236).
//   apply() 403 → err.reason = "not_entity_owner"; re-throw so
//     wrapGraylogError surfaces both reason and the ownership hint.
//
// DELIBERATE NON-FEATURES (out of scope for v3.1.0 per 10-RESEARCH):
//   - synced_entities are NOT in the confirmation hash (Pitfall 3).
//   - "everyone" team grant requires no extra-confirmation flag (Open Q5).
//   - idempotencyKey is wrapper-derived; do NOT add a build-time override.

import { defineMutatingHandler } from "../_shared/handler.js";
import { ShareEntitySchema } from "./schemas.js";
import { makeClient } from "../../graylog/client.js";
import { resolveEntityGrn, resolveGranteeGrn } from "./grn-helpers.js";
import { fetchEntitySharePreview } from "./prepare-share.js";
import { computeShareGrantHash } from "../_shared/cascade-hash.js";

// Tag an in-handler error so wrapGraylogError surfaces a programmatic reason.
// Spoofs the GraylogError shape (isGraylogError + status) so the existing
// errors.js path attaches `reason: <tag>` to both the rendered text and the
// envelope's top-level `reason` field. Same convention as
// delete-index-set.js:134-144 (`stats_unreachable`).
function tagError(err, reason, status = 422) {
    err.isGraylogError = true;
    err.status = status;
    err.method = "";
    err.path = "";
    err.reason = reason;
    return err;
}

// Resolve granteeUsername → user-GRN via available_grantees[].title.
// Throws on zero matches or multiple matches; passes back the resolved id.
function resolveGranteeFromTitle(availableGrantees, username) {
    const grantees = Array.isArray(availableGrantees) ? availableGrantees : [];
    const matches = grantees.filter((g) => g && g.title === username);
    if (matches.length === 0) {
        throw tagError(
            new Error(
                `username "${username}" not found in available_grantees ` +
                `(the entity's resolvable grantees — call list_grantees to see candidates)`,
            ),
            "username_not_found",
        );
    }
    if (matches.length > 1) {
        const candidates = matches.map((m) => m.id).join(", ");
        throw tagError(
            new Error(
                `ambiguous granteeUsername "${username}" — multiple matches in ` +
                `available_grantees. Pass granteeGrn explicitly. Candidates: ${candidates}`,
            ),
            "ambiguous_grantee_username",
        );
    }
    // REVIEW WR-02: type-check the resolved id before returning. A fixture
    // (or a future Graylog DTO drift) producing an available_grantees entry
    // with `id: null` / `id: 42` would otherwise become a non-string Map key
    // downstream, ultimately yielding a malformed
    // selected_grantee_capabilities body. Symmetric to buildCurrentGrantMap's
    // `typeof share.grantee === "string"` guard.
    const resolved = matches[0].id;
    if (typeof resolved !== "string" || resolved.length === 0) {
        throw tagError(
            new Error(
                `username "${username}" resolved to a non-string id ` +
                `(available_grantees entry shape drift? got ${typeof resolved})`,
            ),
            "grantee_resolution_invalid",
        );
    }
    return resolved;
}

// Build a Map<granteeGrn, capability> from the active_shares array. Skips
// entries missing either field (defensive against fixture drift). This is the
// PRE-MERGE baseline; mergeGrants produces a NEW Map without mutating it.
function buildCurrentGrantMap(activeShares) {
    const map = new Map();
    const arr = Array.isArray(activeShares) ? activeShares : [];
    for (const share of arr) {
        if (!share) continue;
        if (typeof share.grantee !== "string" || share.grantee.length === 0) continue;
        if (typeof share.capability !== "string" || share.capability.length === 0) continue;
        map.set(share.grantee, share.capability);
    }
    return map;
}

// Produce a NEW Map<granteeGrn, capability> — current ± named grantee.
// Never mutates `current`. Defensive invariants throw with `reason` tags.
function mergeGrants({ current, granteeGrn, capability, revoke }) {
    if (revoke === true) {
        if (!current.has(granteeGrn)) {
            throw tagError(
                new Error(
                    `cannot revoke: grantee "${granteeGrn}" is not currently in active_shares`,
                ),
                "not_currently_granted",
            );
        }
        const merged = new Map(current);
        merged.delete(granteeGrn);
        // Pitfall 4 — defensive invariant: a revoke must shrink the set by
        // exactly one. Catches a programmer error if the merge logic ever
        // drifts (e.g. an accidental .clear() or wrong-key delete).
        if (merged.size !== current.size - 1) {
            throw tagError(
                new Error(
                    `merge invariant violated: revoke produced size=${merged.size}, ` +
                    `expected ${current.size - 1}`,
                ),
                "merge_size_mismatch",
            );
        }
        return merged;
    }
    // Grant / change — set the key.
    const merged = new Map(current);
    merged.set(granteeGrn, capability);
    return merged;
}

// Last-own guard (Pitfall 5 / SHARE-05). Refuses BEFORE the commit when the
// current active_shares had at least one `own` and the merged set would have
// zero. If the partial view from /prepare under-reports owners (Graylog's
// getForTargetExcludingGrantee filters the sharing user's own grant), the
// activeShares count is 0 and we trust the server-side guard at apply time
// (Test 10 covers that path via the 400-with-body branch).
function assertOwnPreserved(activeShares, mergedMap) {
    const currentOwners = (Array.isArray(activeShares) ? activeShares : [])
        .filter((s) => s && s.capability === "own")
        .map((s) => s.grantee);
    if (currentOwners.length === 0) return; // partial view — server backstop will catch
    const mergedHasOwn = [...mergedMap.values()].some((c) => c === "own");
    if (!mergedHasOwn) {
        throw tagError(
            new Error(
                `would_leave_entity_ownerless: refusing to apply a grant change ` +
                `that would leave entity with no owner ` +
                `(current owners: ${currentOwners.join(", ")}; merged owners: 0)`,
            ),
            "would_leave_entity_ownerless",
        );
    }
}

// Compute the dry-run diff for the preview envelope: added / changed /
// unchanged / removed. Used to populate existingMatches for handler.js step 6.
function computeDiff(activeShares, mergedMap, _revoke) {
    const currentMap = buildCurrentGrantMap(activeShares);
    const added = [];
    const changed = [];
    const unchanged = [];
    const removed = [];
    for (const [grantee, capability] of mergedMap.entries()) {
        if (!currentMap.has(grantee)) {
            added.push({ grantee, capability });
        } else if (currentMap.get(grantee) !== capability) {
            changed.push({ grantee, capability, from: currentMap.get(grantee), to: capability });
        } else {
            unchanged.push({ grantee, capability });
        }
    }
    for (const [grantee, capability] of currentMap.entries()) {
        if (!mergedMap.has(grantee)) {
            removed.push({ grantee, capability });
        }
    }
    return { added, changed, unchanged, removed };
}

export const handleShareEntity = defineMutatingHandler({
    name: "share_entity",
    schema: ShareEntitySchema,

    async build(args) {
        const client = makeClient(args._conn);

        // 1. Normalize the share-target GRN. SHAREABLE_TYPES guard rejects
        //    grantee-type GRNs (user / builtin-team / role) BEFORE any HTTP
        //    call. parseGrn throws on malformed input. Catch-and-re-tag so
        //    wrapGraylogError emits a structured envelope with the original
        //    "not a shareable entity" message preserved.
        let entityGrn;
        try {
            entityGrn = resolveEntityGrn(args);
        } catch (err) {
            throw tagError(err, "invalid_entity_reference", 422);
        }

        // 2. /prepare probe — one round-trip provides active_shares +
        //    available_grantees + validation_result + dependencies +
        //    synced_entities. Phase 9 helper enforces the encoded path +
        //    /prepare suffix + empty {} body.
        const preview = await fetchEntitySharePreview(client, entityGrn);

        // 3. Resolve grantee. zod already enforced XOR with granteeUsername.
        //    For args.granteeGrn: resolveGranteeGrn parses, type-validates
        //    against GRANTEE_TYPES (rejecting share-target-type GRNs client-
        //    side — CR-02), and lowercases so the merge key matches the
        //    server-lowercased active_shares[].grantee (CR-01). For
        //    granteeUsername: resolveGranteeFromTitle returns
        //    available_grantees[i].id which the server has already lowercased
        //    — no extra normalization needed on that branch.
        let granteeGrn;
        if (args.granteeGrn) {
            try {
                granteeGrn = resolveGranteeGrn(args.granteeGrn);
            } catch (err) {
                throw tagError(err, "invalid_grantee_reference", 422);
            }
        } else {
            granteeGrn = resolveGranteeFromTitle(
                preview.available_grantees ?? [],
                args.granteeUsername,
            );
        }

        // 4. Merge — Map<granteeGrn, capability>. revoke:true subtracts;
        //    grant/change sets. The merged set IS the body of the POST.
        const currentMap = buildCurrentGrantMap(preview.active_shares);
        const mergedMap = mergeGrants({
            current: currentMap,
            granteeGrn,
            capability: args.capability,
            revoke: args.revoke === true,
        });

        // 5. Client-side last-own guard (Pitfall 5). Server-side guard via
        //    validation_result.failed is the backstop (Test 10).
        assertOwnPreserved(preview.active_shares ?? [], mergedMap);

        // 6. Confirmation token over the MERGED set. The canonical input is
        //    {entityGrn, grants: [...sorted]} only — synced_entities are
        //    deliberately excluded (Pitfall 3, out of scope for v3.1.0).
        const grantsArray = [...mergedMap.entries()].map(([grantee, capability]) => ({
            grantee,
            capability,
        }));
        const confirmationToken = computeShareGrantHash({ entityGrn, grants: grantsArray });

        // 7. Diff for the preview envelope. existingMatches surfaces the
        //    unchanged + changed entries with similarity_reason hints so the
        //    agent sees no-op overlap without diffing client-side.
        const diff = computeDiff(preview.active_shares ?? [], mergedMap, args.revoke === true);
        const existingMatches = [
            ...diff.unchanged.map((g) => ({ ...g, similarity_reason: "already_granted" })),
            ...diff.changed.map((g) => ({ ...g, similarity_reason: "capability_changed" })),
        ];

        return {
            method: "POST",
            path: `/api/authz/shares/entities/${encodeURIComponent(entityGrn)}`,
            body: {
                selected_grantee_capabilities: Object.fromEntries(mergedMap),
                selected_collections: [],
            },
            _confirmationToken: confirmationToken,
            existingMatches,
            postApplyEstimate: {
                id: entityGrn,
                async: false,
                synced_entities: preview.synced_entities ?? [],
            },
        };
    },

    apply: async (client, req) => {
        try {
            return await client.request(req.method, req.path, req.body);
        } catch (err) {
            // 400-with-body — surface validation_result + dependencies +
            // active_shares as structured data. The wrapper passes the
            // envelope through verbatim (handler.js line 236).
            if (
                err?.isGraylogError
                && err.status === 400
                && err.body
                && err.body.validation_result
                && err.body.validation_result.failed === true
            ) {
                return {
                    isError: true,
                    reason: "share_validation_failed",
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            tool: "share_entity",
                            status: 400,
                            validation_result: err.body.validation_result,
                            missing_permissions_on_dependencies:
                                err.body.missing_permissions_on_dependencies ?? {},
                            active_shares: err.body.active_shares ?? [],
                        }),
                    }],
                };
            }
            // 403 — only owners may modify shares. Tag with reason and
            // append an ownership hint so the agent sees `own` is required.
            if (err?.isGraylogError && err.status === 403) {
                err.reason = "not_entity_owner";
                const originalMsg = err.message ?? "";
                err.message =
                    `${originalMsg} — sharing requires \`own\` capability on the target entity ` +
                    `(not \`manage\`); confirm the connection's API-token user is an owner via get_entity_shares.`;
                throw err;
            }
            // REVIEW WR-04: untyped exceptions from the apply POST (no
            // `isGraylogError` flag — typically network-layer failures like
            // ECONNRESET / ETIMEDOUT) must be tagged with
            // `reason: "apply_inconclusive"` so the agent can programmatically
            // identify "the apply may or may not have hit the server" and
            // re-read via get_entity_shares BEFORE retrying. Partial-apply on
            // this endpoint changes authz; a blind retry risks compounding
            // the change.
            //
            // GraylogErrors that aren't 400-with-body or 403 fall through to
            // the existing untagged re-throw so wrapGraylogError surfaces
            // their native status/method/path context — only PLAIN errors
            // (no isGraylogError) get the apply_inconclusive tag.
            if (err && !err.isGraylogError) {
                if (typeof err.reason !== "string" || err.reason.length === 0) {
                    err.reason = "apply_inconclusive";
                }
                throw err;
            }
            throw err;
        }
    },

    summarize: (args) =>
        args.revoke
            ? `Revoke ${args.granteeUsername ?? args.granteeGrn} from ${args.entityType ?? args.entityGrn}`
            : `Grant ${args.capability} to ${args.granteeUsername ?? args.granteeGrn} on ${args.entityType ?? args.entityGrn}`,

    // delete-index-set.js:219 verbatim — the wrapper's requireConfirm gate
    // reads _confirmationToken and refuses apply on mismatch.
    requireConfirm: ({ req }) => req._confirmationToken ?? null,
});
