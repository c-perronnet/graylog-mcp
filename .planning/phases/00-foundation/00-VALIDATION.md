---
phase: 0
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-13
---

# Phase 0 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `00-RESEARCH.md` §"Validation Architecture" (line 1232+).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (built-in to Node 22.3+); `t.assert.snapshot()` is stable |
| **Config file** | None required for `node:test`; entry point is `package.json` `scripts.test` |
| **Quick run command** | `node --test test/<area>.test.js` (single file) |
| **Full suite command** | `npm test` (after D-02 fix → `node --test test/**/*.test.js`) |
| **Estimated runtime** | ~2 min for full suite once Wave 0 + 4 migrated scripts complete (target ≤ 120 s) |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/<specific-area>.test.js` (≤ 30 s feedback)
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd-verify-work`:** Full suite green + regression-snapshot diff empty + `node --version >= 22.3.0` confirmed in CI
- **Max feedback latency:** 30 seconds (per-task), 120 seconds (per-wave)

---

## Per-Task Verification Map

Each FOUND requirement maps to one or more tests. Test files are listed in **Wave 0 Requirements** below. Status begins `⬜ pending` and flips to `✅ green` when the corresponding test passes against the implementation.

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| FOUND-01 | Map dispatch routes every read tool unchanged | unit + regression-snapshot | `node --test test/dispatch.test.js test/regression/read-tools.test.js` | ❌ W0 | ⬜ pending |
| FOUND-01 | `assertAllToolsRegistered()` fails when a tools.js entry has no handler | unit | `node --test test/dispatch.test.js` | ❌ W0 | ⬜ pending |
| FOUND-02 | `makeClient(conn).request` builds auth header + `X-Requested-By` | unit (axios mock) | `node --test test/graylog-client.test.js` | ❌ W0 | ⬜ pending |
| FOUND-02 | 400/403/404/409/422 map to typed errors (`GraylogPermissionError`, etc.) | unit | `node --test test/graylog-client.test.js` | ❌ W0 | ⬜ pending |
| FOUND-03 | `defineMutatingHandler` enforces `dryRun: true` default | unit + snapshot | `node --test test/handler.test.js` | ❌ W0 | ⬜ pending |
| FOUND-03 | Build/apply split — preview ≡ apply payload (modulo `__SERVER_ASSIGNED__` sentinel) | snapshot | `node --test test/handler.test.js` | ❌ W0 | ⬜ pending |
| FOUND-04 | `__SERVER_ASSIGNED__` sentinel present in every dry-run preview | snapshot | `node --test test/handler.test.js` | ❌ W0 | ⬜ pending |
| FOUND-05 | zod schemas reject invalid args; error response uses canonical `{ isError, content }` shape | unit | `node --test test/handler.test.js` | ❌ W0 | ⬜ pending |
| FOUND-06 | `engines.node` is `>= 22.3.0`; `npm test` runs end-to-end without flags | smoke | `npm test && node -e "console.log(process.versions.node)"` | manual (Wave 0 close) | ⬜ pending |
| FOUND-07 | 5–10 snapshot fixtures pass deterministically across two runs | snapshot | `npm test` × 2; diff = empty | ❌ W0 | ⬜ pending |
| FOUND-08 | `normalize.toIdBody` extracts ID from ≥3 distinct create-response shapes (200 DTO, 201 partial, 201 + Location header) | unit | `node --test test/normalize.test.js` | ❌ W0 | ⬜ pending |
| FOUND-09 | `connectionName` per-call arg resolves; absent falls back to singleton | unit | `node --test test/connection.test.js` | ❌ W0 | ⬜ pending |
| FOUND-10 | `deriveIdempotencyKey` is deterministic; canonicalises args; excludes `dryRun`/`idempotencyKey` | unit | `node --test test/idempotency.test.js` | ❌ W0 | ⬜ pending |
| FOUND-11 | `existingMatches` field present in every create-tool dry-run output (empty array when none) | unit | `node --test test/handler.test.js` | ❌ W0 | ⬜ pending |
| FOUND-12 | `defineListHandler` enforces default narrow projection + `limit: 25`; clamps to `MAX_LIMIT` | unit | `node --test test/list.test.js` | ❌ W0 | ⬜ pending |
| FOUND-13 | Renamed tool names match `<verb>_<domain>_<noun>` regex; CHANGELOG documents migration | static lint + manual review | `grep -E '^(list\|get\|create\|update\|delete\|...)_[a-z]+_[a-z]+$' src/tools.js \| wc -l` | manual | ⬜ pending |
| D-07 | `writable: false` short-circuits in BOTH `defineMutatingHandler` AND the HTTP client (defence-in-depth) | unit | `node --test test/connection.test.js test/graylog-client.test.js` | ❌ W0 | ⬜ pending |
| D-05 | All 4 existing test-*.js scripts run via `npm test` and pass | regression | `npm test` | ❌ W0/W1 (migration tasks) | ⬜ pending |
| Aux | No snapshot fixture contains `Authorization` header or 32+ char apiToken pattern | snapshot lint | `grep -L 'Authorization\|[A-Za-z0-9]\{32,\}' test/__snapshots__/*` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Bootstrap test infrastructure before any implementation task touches `src/`.

**Test scaffolding (new files, all empty stubs that import the not-yet-existing modules):**

- [ ] `test/__snapshots__/.gitkeep` — snapshot fixtures directory
- [ ] `test/snapshot-config.js` — `setResolveSnapshotPath` configuration so snapshot paths are stable across OS
- [ ] `test/dispatch.test.js` — stubs for FOUND-01
- [ ] `test/handler.test.js` — stubs for FOUND-03, FOUND-04, FOUND-05, FOUND-09, FOUND-10, FOUND-11
- [ ] `test/list.test.js` — stubs for FOUND-12
- [ ] `test/graylog-client.test.js` — stubs for FOUND-02
- [ ] `test/normalize.test.js` — stubs for FOUND-08
- [ ] `test/idempotency.test.js` — stubs for FOUND-10 deeper coverage
- [ ] `test/connection.test.js` — stubs for FOUND-09 + D-07
- [ ] `test/regression/read-tools.test.js` — pre/post FOUND-01 regression net (Pitfall 1)
- [ ] `test/schema-parity.test.js` — Pitfall 3 drift detection (starts empty; Phase 1+ enriches)
- [ ] `test/auth-redaction.test.js` — asserts no snapshot contains auth/token strings

**Existing-script migration targets (each replaces a `test-*.js` script at repo root per D-05):**

- [ ] `test/existing/clustering-preprocess.test.js` — from `test-clustering.js` (preprocessor section)
- [ ] `test/existing/clustering-strategy.test.js` — from `test-clustering.js` (Drain3 + registry)
- [ ] `test/existing/template-store.test.js` — from `test-clustering.js` (template-store + lock)
- [ ] `test/existing/template-mgmt.test.js` — from `test-clustering.js` (handler integration)
- [ ] `test/existing/features.test.js` — from `test-features.js`
- [ ] `test/existing/aggregation-fixes.test.js` — from `test-aggregation-fixes.js`
- [ ] `test/existing/histogram-fixes.test.js` — from `test-histogram-fixes.js`

**Package.json updates (D-01, D-02, plus dev-dep alignment):**

- [ ] `engines.node` bumped from `>=18.0.0` to `>= 22.3.0`
- [ ] `scripts.test` changed from `node test-server.js` to `node --test test/**/*.test.js`
- [ ] `@types/node` devDep bumped to `^22.x` for consistency
- [ ] Original 4 `test-*.js` scripts at repo root deleted after migration

Framework install: **not needed** — `node:test` is built into Node 22. `c8` for coverage is deferred to Phase 7.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live MCP-client smoke test against the renamed tool catalogue | FOUND-13 + D-03 | The MCP transport is stdio, the tools are routed by name from a client. A live smoke confirms an MCP client can list tools, see the renamed surface, and call a representative read tool (e.g. `search_messages_graylog`) end-to-end. | Start the server with `node src/index.js`, connect from an MCP client (Claude Code or `mcp-cli`), call `list_tools`, verify catalogue uses the new naming, then call one renamed read tool against a live Graylog 7.2. |
| Pre-vs-post dispatch refactor read-tool regression | FOUND-01 (acceptance) | The regression-snapshot test catches payload-shape diffs but a live call confirms the dispatch refactor didn't change network behavior at the wire level. | Before the FOUND-01 refactor commit: capture the response body of one fetch_graylog_messages call to a known fixture-driven query. After the refactor: replay the same query, diff bodies; must match. |
| `engines.node >= 22.3.0` enforced by `npm` | FOUND-06 | Engine warnings are advisory unless `engine-strict=true` is set in `.npmrc`. Manual confirmation that running `npm install` on Node 20 emits the engine warning (or errs if strict mode is on). | Locally: `nvm use 20`; `rm -rf node_modules`; `npm install` → expect engine warning. Switch back: `nvm use 22.3.0`. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (test files + package.json updates above)
- [ ] No watch-mode flags in `npm test`
- [ ] Feedback latency < 30s per-task, < 120s per-wave
- [ ] `nyquist_compliant: true` set in frontmatter after planner aligns task IDs

**Approval:** pending
