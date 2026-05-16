// Extract { id, body } from any Graylog create-response shape (FOUND-08).
// Graylog 7.2 returns 10 distinct shapes — see 00-RESEARCH.md §Pattern 5 and
// 00-03-PLAN.md <interfaces> for the full inventory. Examples:
//   POST /streams              → { stream_id }              hint: ["stream_id"]
//   POST /system/inputs        → { id }                     hint: ["id"]   (default)
//   POST /views                → full ViewDTO with id inside hint: ["id"]
//   POST /streams/{id}/rules   → { streamrule_id }          hint: ["streamrule_id"]
// Per-endpoint hint passes the relevant `idFields` candidate list; default
// falls back to ["id"]. Candidates are tried in order; first non-empty wins.

export function toIdBody(response, hint) {
    if (!response) return { id: null, body: null };
    const candidates = hint?.idFields ?? ["id"];
    for (const field of candidates) {
        if (response[field] !== undefined && response[field] !== null) {
            return { id: response[field], body: response };
        }
    }
    return { id: null, body: response };
}
