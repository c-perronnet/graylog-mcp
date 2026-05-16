---
phase: 07-final-hardening
reviewed: 2026-05-16T04:51:15Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - scripts/audit-tool-descriptions.js
  - src/tools/meta/list-admin-tools.js
  - src/tools/meta/index.js
  - src/tools/_register.js
  - src/tools.js
  - src/events.js
  - src/query.js
  - package.json
  - test/tool-description-audit.test.js
  - test/list-admin-tools.test.js
  - test/v7-read-tool-smoke.test.js
findings:
  critical: 0
  warning: 0
  info: 4
  total: 4
status: issues_found
---

# Phase 7: Code Review Report

**Reviewed:** 2026-05-16T04:51:15Z
**Depth:** standard
**Files Reviewed:** 9 (3 src + 1 script + 3 tests + 2 manifests)
**Status:** issues_found (info only — no blocking issues)

## Summary

Phase 7 ships five milestone-close hardening items (HARD-01..05). The change set is small, focused, and well-tested: 1073 tests pass, the new audit script flags 0 violations against the trimmed `src/tools.js`, and the v7-vs-v6 fixture smoke exercises every read-tool dispatch surface. Critical safety properties are preserved:

- **No production source mutated** in `src/handlers.js`, `src/index.js`, or any Phase 1-6 tool module — Phase 7 is additive only.
- **HTTP seams** (`_setHttpOverride` in `src/query.js` / `src/events.js`) wrap every axios call site; no production-path leakage.
- **list_admin_tools is pure-static** — `src/tools/meta/list-admin-tools.js` never calls `requireActiveConnection`, and the test pins this contract.
- **Audit invariants** (≤200 chars + multi-sentence-OR-comparative-keyword + non-empty) enforced by both a pure `audit()` function (unit-tested) and a CLI entry point (spawn-tested).
- **Backward compat:** `engines`, lockfile, all v2.3 contracts unchanged.

Four info-level observations follow — all maintenance notes for future milestones, none requiring action this milestone.

## Info

### IN-01: `summarize()` comment mismatches behavior

**File:** `src/tools/meta/list-admin-tools.js:101`
**Issue:** The inline comment reads `// First sentence OR first 120 chars, whichever is shorter.` but the implementation takes the first sentence (if any) and *then* truncates the result at 120 chars. The actual behavior is "first sentence if it exists, otherwise the full description; then truncate to 120 chars with ellipsis." A reader who trusts the comment would expect a 90-char first sentence to be returned untruncated (correct) but would also expect a 200-char description with no sentence terminators to come back at 120 chars (also correct) — the comment's "whichever is shorter" framing implies a `Math.min` that the code does not perform.

**Fix:** Reword the comment to match the implementation:
```js
// Prefer the first sentence; truncate at 120 chars with "..." if longer.
// Multi-sentence descriptions surface only the leading clause; long
// single-sentence descriptions get an ellipsis.
const firstSentence = description.match(/^[^.!?]+[.!?]/);
const summary = (firstSentence ? firstSentence[0] : description).trim();
return summary.length > 120 ? summary.slice(0, 117) + "..." : summary;
```

### IN-02: Hand-maintained `DOMAIN_OVERRIDES` map will drift as new tools land

**File:** `src/tools/meta/list-admin-tools.js:18-62`
**Issue:** Domain classification uses a 26-entry hand-curated override map plus a 17-entry segment fallback table. Phases 8+ adding tools whose names don't fit `<verb>_<domain>_<noun>` (or whose primary domain conflicts with their `<noun>`) must remember to extend this map. The test `list_admin_tools inventory covers every entry in src/tools.js` plus the `uncategorized` zero-bucket invariant catches drift loudly, but the test failure surface ("tool foo mis-classified") puts the burden on the agent that adds the new tool to figure out the override map. Today's 91 tools all classify correctly — this is forward-looking maintenance debt.

**Fix:** Consider either (a) requiring each `register()` call to pass an explicit `domain` argument so classification moves into the same locality as registration, or (b) documenting the override-map maintenance step in the per-domain `index.js` barrel comment (e.g. add to `src/tools/_register.js` import comments: "if your tool name doesn't fit `<verb>_<domain>_<noun>`, add an entry to `src/tools/meta/list-admin-tools.js#DOMAIN_OVERRIDES`"). Lower-effort path: just add the reminder to the comment block at the top of `list-admin-tools.js`.

### IN-03: Audit discrimination check is structural, not semantic

**File:** `scripts/audit-tool-descriptions.js:32-39`
**Issue:** The discrimination rule accepts any description that (a) has ≥2 sentences OR (b) contains a comparative keyword from a 10-phrase whitelist. A description like `"Foo. Bar."` (two trivial sentences with no real discrimination signal) passes. So does `"Use this when you feel like it"` — single sentence, comparative keyword, zero useful contrast. The audit's stated purpose (M7 pitfall mitigation — help the agent pick the right sibling tool) is only partially served. The 200-char budget AND the comparative-keyword vocabulary together steer authors toward useful framings in practice (single-sentence descriptions under 200 chars naturally include a comparator), but the audit itself cannot enforce semantic quality.

**Fix:** No code change recommended. The audit script's header comment is already honest about this (it pins "two sentences OR comparator keyword" as the invariant, not "useful contrast"). Consider adding a one-line note to the audit's stdout success message — e.g. `[audit] OK — 91 tool descriptions pass (structural check only; review descriptions for semantic discrimination during code review)` — so future authors don't mistake a passing audit for a quality guarantee. Optional.

### IN-04: `searchGraylog` override path bypasses the enhanced error logging

**File:** `src/query.js:115-141`
**Issue:** When `_httpOverride` is set, errors thrown from the override callback propagate to the caller unchanged. When it's unset, the real axios path wraps errors with `console.error('Graylog API Error:', {...})` for debugging visibility. This is intentional — tests need raw failure shape to drive the histogram fallback chain (see `failFirstNThenSucceed` in `test/v7-read-tool-smoke.test.js:105`) — but the asymmetry isn't documented at the seam declaration (`src/query.js:1-14`).

**Fix:** Add one line to the seam doc comment so a future reader understands the asymmetry is by design:
```js
// Test-only HTTP seam (Phase 7 Plan 03 HARD-03 smoke). ...
// NOTE: When the override is active, errors thrown by the callback
// bypass searchGraylog's console.error('Graylog API Error', ...) wrap.
// Tests rely on the raw failure shape to drive the histogram fallback chain.
let _httpOverride = null;
```

---

_Reviewed: 2026-05-16T04:51:15Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
