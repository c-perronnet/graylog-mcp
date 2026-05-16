// Blueprint chain-transcript helper (Phase 6 D-07 / D-08, RESEARCH Pattern 3).
//
// Composes a sequence of (already-built) request descriptors into a sequential
// HTTP chain with placeholder substitution between steps. Used by every Phase
// 6 blueprint (BLUE-01..06) to walk a pre-computed chain transcript that the
// dry-run preview surfaced to the agent.
//
// Chain shape (per D-07):
//   [
//     { step: 1, tool: "create_stream", request: { method, path, body } },
//     { step: 2, tool: "create_pipeline", request: {...},
//       dependsOn: { from: "step1.response.id", as: "streamId" } },
//     ...
//   ]
//
// Placeholder substitution (per D-08):
//   When a step has `dependsOn`, every `__SERVER_ASSIGNED__step{N}` literal
//   inside the step's request.body AND request.path is replaced by the
//   resolved value extracted from prior step N's response via the
//   `dependsOn.from` field path (e.g. "step1.response.id" → step 1's
//   response.id). Multiple dependencies are supported via array shape on
//   dependsOn (e.g. BLUE-01 step 4 connects pipeline-to-stream and depends
//   on BOTH step 1 stream + step 3 pipeline).
//
// Partial-failure (per Pitfall 9):
//   If any apply throws, the chain SHORT-CIRCUITS and returns:
//     { isError: true, reason: "blueprint_chain_partial_failure",
//       content: [{ type: "text", text: JSON.stringify({
//         transcript, failed_at_step, succeeded_steps }) }] }
//   No rollback. The agent retains the transcript of every applied step so
//   they can manually clean up. Idempotency-key auto-derivation (FOUND-10)
//   ensures retries converge — the same args + key dedupe at each step's
//   findExistingMatches pre-check.
//
// Unresolved dependency (per D-08):
//   If a step depends on a field path that doesn't exist in the prior
//   response, the chain returns:
//     { isError: true, reason: "blueprint_chain_unresolved_dependency", ... }
//   This usually indicates a build() emitted the wrong dependsOn.from path —
//   structural error, not data-dependent.
//
// Threat-model T-06-01-02 (Tampering): substitutePlaceholders matches ONLY
// the literal sentinel `__SERVER_ASSIGNED__step{N}` form (exact string
// equality at the leaf). No agent-controlled string can collide because the
// sentinel `__SERVER_ASSIGNED__` is never on the wire as agent input — it's
// a wrapper-generated marker (SERVER_ASSIGNED_SENTINEL in dry-run.js).

import { SERVER_ASSIGNED_SENTINEL } from "./dry-run.js";

/**
 * Resolve a dotted field path (e.g. "response.id") against a transcript
 * entry's response. Returns undefined when any segment is missing — the
 * caller distinguishes "missing dependency" from "resolved to undefined".
 *
 * @param {object} entry  transcript entry `{ step, tool, request, response }`
 * @param {string} from   dotted path beginning with "stepN."
 * @returns {unknown}
 */
function resolveFieldPath(entry, from) {
    // from format: "step{N}.<path>"  — strip the leading "stepN." and walk
    // the remaining dotted path against the transcript entry. The first
    // segment of <path> is typically "response", so "step1.response.id"
    // resolves to entry.response.id.
    const dotIndex = from.indexOf(".");
    if (dotIndex < 0) return undefined;
    const path = from.slice(dotIndex + 1);
    let cursor = entry;
    for (const segment of path.split(".")) {
        if (cursor == null || typeof cursor !== "object") return undefined;
        cursor = cursor[segment];
    }
    return cursor;
}

/**
 * Recursive walker that replaces `${SERVER_ASSIGNED_SENTINEL}step{N}` string
 * literals inside obj. Substitution map is built from dependsOn (single object
 * or array of objects) — each dependsOn entry contributes one
 * `__SERVER_ASSIGNED__stepN` → replacement binding.
 *
 * @param {unknown} obj
 * @param {object | object[] | undefined} dependsOn
 * @param {Record<string, unknown>} substitutions  per-step replacement values
 *   keyed by the placeholder literal (e.g. "__SERVER_ASSIGNED__step1": "S-1")
 * @returns {unknown}
 */
export function substitutePlaceholders(obj, dependsOn, substitutions) {
    if (typeof obj === "string") {
        // Exact-match fast path: when the entire string equals a placeholder,
        // return the raw replacement value (preserves type — e.g. a numeric
        // replacement stays numeric, not coerced to a string).
        if (substitutions[obj] !== undefined) return substitutions[obj];
        // Substring path: paths like
        //   "/api/streams/__SERVER_ASSIGNED__step1/connect"
        // need in-place substitution. Replace each known placeholder literal;
        // unknown placeholders are left untouched (handled by the
        // unresolved-dependency branch in executeChain when missing).
        let out = obj;
        for (const [placeholder, replacement] of Object.entries(substitutions)) {
            if (out.includes(placeholder)) {
                out = out.split(placeholder).join(String(replacement));
            }
        }
        return out;
    }
    if (Array.isArray(obj)) {
        return obj.map((item) => substitutePlaceholders(item, dependsOn, substitutions));
    }
    if (obj !== null && typeof obj === "object") {
        const out = {};
        for (const [k, v] of Object.entries(obj)) {
            out[k] = substitutePlaceholders(v, dependsOn, substitutions);
        }
        return out;
    }
    return obj;
}

/**
 * Execute a chain transcript against the live client. Returns either:
 *   - `{ applied: true, transcript: [...] }` on success
 *   - `{ isError: true, reason, content: [{type, text}] }` on partial failure
 *     or unresolved dependency
 *
 * @param {{ request: (method: string, path: string, body?: unknown) => Promise<unknown> }} client
 * @param {Array<{
 *   step: number,
 *   tool: string,
 *   request: { method: string, path: string, body?: unknown },
 *   dependsOn?: { from: string, as: string } | Array<{ from: string, as: string }>,
 *   postApplyEstimate?: object,
 * }>} chain
 * @returns {Promise<
 *   { applied: true, transcript: Array<object> }
 *   | { isError: true, reason: string, content: Array<{ type: string, text: string }> }
 * >}
 */
export async function executeChain(client, chain) {
    const transcript = [];

    for (const step of chain) {
        // Build the per-step substitutions map by resolving each dependsOn
        // entry's `from` field path against the transcript.
        const substitutions = {};
        const deps = step.dependsOn
            ? (Array.isArray(step.dependsOn) ? step.dependsOn : [step.dependsOn])
            : [];

        for (const dep of deps) {
            // dep.from begins with "step{N}." — parse N to locate the prior
            // entry by step number (not array index — explicit step numbers
            // tolerate non-contiguous chains).
            const stepMatch = /^step(\d+)\./.exec(dep.from);
            if (!stepMatch) {
                transcript.push({ step: step.step, tool: step.tool, request: step.request, error: `malformed dependsOn.from: ${dep.from}` });
                return {
                    isError: true,
                    reason: "blueprint_chain_unresolved_dependency",
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            transcript,
                            missing_dependency: dep,
                            error: `dependsOn.from must begin with "stepN."; got "${dep.from}"`,
                        }),
                    }],
                };
            }
            const priorStepNum = Number.parseInt(stepMatch[1], 10);
            const priorEntry = transcript.find((t) => t.step === priorStepNum);
            const value = priorEntry ? resolveFieldPath(priorEntry, dep.from) : undefined;
            if (value === undefined) {
                transcript.push({
                    step: step.step,
                    tool: step.tool,
                    request: step.request,
                    error: `unresolved dependency: ${dep.from}`,
                });
                return {
                    isError: true,
                    reason: "blueprint_chain_unresolved_dependency",
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            transcript,
                            missing_dependency: dep,
                        }),
                    }],
                };
            }
            substitutions[`${SERVER_ASSIGNED_SENTINEL}step${priorStepNum}`] = value;
        }

        const substitutedBody = substitutePlaceholders(step.request.body, step.dependsOn, substitutions);
        const substitutedPath = typeof step.request.path === "string"
            ? substitutePlaceholders(step.request.path, step.dependsOn, substitutions)
            : step.request.path;

        const concreteRequest = {
            method: step.request.method,
            path: substitutedPath,
            body: substitutedBody,
        };

        try {
            const response = await client.request(
                concreteRequest.method,
                concreteRequest.path,
                concreteRequest.body,
            );
            transcript.push({
                step: step.step,
                tool: step.tool,
                request: concreteRequest,
                response,
            });
        } catch (err) {
            const failedEntry = {
                step: step.step,
                tool: step.tool,
                request: concreteRequest,
                error: err?.message ?? String(err),
            };
            transcript.push(failedEntry);
            return {
                isError: true,
                reason: "blueprint_chain_partial_failure",
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        transcript,
                        failed_at_step: step.step,
                        succeeded_steps: transcript
                            .filter((t) => !t.error)
                            .map((t) => t.step),
                    }),
                }],
            };
        }
    }

    return { applied: true, transcript };
}
