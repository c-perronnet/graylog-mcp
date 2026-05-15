// Dry-run preview emitter (FOUND-04 + Pitfall C6).
//
// On dryRun=true, returns an MCP response whose JSON payload includes:
//   - dryRun: true
//   - tool, connection, idempotencyKey (for agent trace + dedupe)
//   - preview: { method, path, body } — the exact HTTP request that would be sent
//   - postApplyEstimate: { id: "__SERVER_ASSIGNED__" } so the agent knows the server
//     fills the id (defaults to this sentinel when build() doesn't override)
//   - existingMatches: [] — populated by FOUND-11 list-pre-check (Phase 1+); always
//     present so the agent can reason about it
//   - applyHint: "Re-call with dryRun: false to apply"
//
// On dryRun=false: delegates to apply(client, req). The handler factory wraps
// the apply call in try/catch and converts thrown GraylogError to the MCP error
// envelope via wrapGraylogError.

export const SERVER_ASSIGNED_SENTINEL = "__SERVER_ASSIGNED__";

/**
 * @param {{ method: string, path: string, body?: unknown, postApplyEstimate?: object, existingMatches?: Array<unknown> }} req
 * @param {{
 *   dryRun: boolean,
 *   name: string,
 *   connectionName: string,
 *   idempotencyKey: string,
 *   summary?: string,
 *   apply?: (client: unknown, req: unknown) => Promise<unknown>,
 *   client?: unknown
 * }} ctx
 */
export function runOrPreview(req, ctx) {
    const { dryRun, name, connectionName, idempotencyKey, summary, apply, client } = ctx;
    if (dryRun) {
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    dryRun: true,
                    tool: name,
                    connection: connectionName,
                    idempotencyKey,
                    summary: summary ?? `${req.method} ${req.path}`,
                    preview: {
                        method: req.method,
                        path: req.path,
                        body: req.body,
                    },
                    postApplyEstimate: req.postApplyEstimate ?? { id: SERVER_ASSIGNED_SENTINEL },
                    existingMatches: req.existingMatches ?? [],
                    applyHint: "Re-call with dryRun: false to apply",
                }),
            }],
        };
    }
    // dryRun=false: delegate. The factory handles try/catch around this call.
    return apply(client, req);
}
