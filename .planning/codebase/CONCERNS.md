# Concerns

**Analysis Date:** 2026-05-12

Technical debt, fragility, and risk areas — surfaced from code reading, git history, and `FUTURE_PLANS.md`.

## Security

**API tokens stored plaintext.** Connection credentials live in `~/.graylog-mcp/config.json` as cleartext fields:

```json
{ "connections": { "prod": { "baseUrl": "...", "apiToken": "..." } } }
```

`src/config.js:11` reads them via `readFileSync` with no decryption hook, no keyring integration, no env-var override per connection. The whole file's threat model is "filesystem permissions are good enough" — fine for a personal CLI dev tool, risky for shared machines.

**No input validation on tool arguments.** `zod` is a declared dependency (`package.json`) but **not imported anywhere in `src/`**. Validation is ad-hoc (`if (!args.templateId) return errorResponse(...)`). The MCP SDK does enforce the JSON-Schema in `src/tools.js` client-side, but a malformed schema or a misbehaving client can pass unvalidated args straight to the handlers. The unused zod dependency is dead code worth either removing or adopting.

**No query escaping for Graylog query string.** `buildQueryString` in `src/query.js:3-23` wraps values in quotes for `exactMatch` but does not escape internal quotes or Lucene reserved characters (`+ - && || ! ( ) { } [ ] ^ " ~ * ? : \ /`). A filter value containing `"` or `\` will produce a malformed query. No tests cover this path.

**`X-Requested-By` header is hardcoded** (`src/query.js:104`). Not a vulnerability — Graylog uses this for CSRF — but it's noted because changing Graylog server config could break the client silently.

## Reliability / Fragility

**Histogram fallback chain hides API instability.** `src/index.js:430-473` (and again at `~570` for field-time) tries up to **4 different builder strategies** in sequence (`working-pattern`, `chart`, `simple-pivot`, `complex-pivot`), catches each error to `console.error`, and returns the first that succeeds. This makes "the histogram tool works" depend on the union of 4 Graylog payload shapes — when Graylog changes one, the others compensate, masking the regression. Each builder lives in `src/aggregations.js` and is rarely exercised individually. Cleanup risk: deleting "redundant" approaches will break some Graylog versions and not others.

**Similarity threshold is tuned at the call site, not learned.** `src/tools/cluster-errors.js:105` defaults to `0.6`; commit `dc0a731` raised it from `0.4`. The drain3 algorithm has no auto-tuning. The schema lets users pass anything between 0 and 1 with no guidance; bad values silently produce all-singleton or all-merged clusters. There are no regression tests pinning expected cluster counts for representative log mixes.

**File-lock for template store has a 30-second stale-break window.** `src/clustering/template-store.js:9,57` — if a writer process dies after taking the lock but before releasing, no other process can write for 30 s. Recursive `acquireLock` after breaking a stale lock (line 60) means a second contender will busy-recurse briefly. Not a correctness issue but a latency outlier under contention. Tests don't exercise concurrent writers.

**Template store has no migration path.** `STORE_VERSION = 1` is the only version that exists; the loader logs and returns an empty store on mismatch (`src/clustering/template-store.js:35`). When `STORE_VERSION` is bumped, every user silently loses all learned templates on first read. There's no upgrade hook, no backup, no opt-in.

**Connection state is process-global mutable.** `src/config.js:20` `let activeConnection = null;` — there's exactly one active connection per process. Multi-tenant or parallel-tool use (Claude calling two tools against two Graylog clusters simultaneously) is not supported and not asserted; the second call's `use_connection` quietly clobbers the first.

**Config load failures are silent.** `src/config.js:10-18` wraps the entire `readFileSync` + `JSON.parse` in `try { ... } catch {}` with no message. A typo'd config path or malformed JSON produces "no connections found" with no clue why. The `FUTURE_PLANS.md` Quick Wins section doesn't mention this; it's pure latent debt.

**`extractMessages` assumes a fixed Graylog response shape.** `src/query.js:48` hard-codes `responseData?.results?.q1?.search_types?.st1` — keyed by the literal IDs the builders use. If anyone refactors a builder to use different IDs (`q2`, `st2`), the extractor silently returns 0 messages.

## Performance

**Drain3 linear scan within each length bucket.** `src/clustering/strategies/drain3.js:64-69` — best-match search is O(templates_in_bucket) per message. The author's comment (line 27) notes this is intentional for ≤10k messages and "low-hundreds of templates per bucket"; beyond that, performance degrades quadratically with template count. `MAX_SAMPLE = 10_000` (`src/tools/cluster-errors.js:10`) caps input to keep this safe — going past it requires algorithm work, not just raising the constant.

**LRU eviction = drop oldest on overflow.** When a length bucket exceeds `maxChildren` (default 100), `bucket.templates.shift()` evicts the front element (`drain3.js:84`). This is FIFO, not LRU-by-use, despite the comment claiming LRU (line 33). The code does move matched templates to the tail (lines 76-80), which approximates LRU — but the eviction comment is misleading.

**Saved searches and templates are full-file rewrites.** Every label edit or template addition triggers a `writeFileSync` of the entire JSON store. Acceptable at template counts in the hundreds; not designed for tens of thousands.

**Aggregation responses are formatted as a single `JSON.stringify`.** Large field aggregations (thousands of buckets) can produce multi-MB text payloads that the MCP client must parse. No pagination, no streaming.

## Test Gaps (Risk Surface)

See `TESTING.md` for full coverage analysis. Risk-weighted highlights:

- **`npm test` references `test-server.js` which doesn't exist** — any CI that invokes it fails immediately. (`package.json:8`)
- **No test exercises the histogram fallback chain.** Each builder is structurally tested in isolation; the runtime "try each in order" loop is not.
- **No test for `src/tools/template-mgmt.js` handlers.** The store layer is tested; the handlers above it are not.
- **No test for `extractMessages`** — the function that translates every Graylog response to MCP output.
- **No test for query-string escaping** with special characters.
- **No regression test for commit `dc0a731`'s `sources_seen` fix.** The bug ("not populated on first cluster") could regress without detection.
- **`src/events.js` is entirely untested.**

## Known Bugs (from commit history)

Recent fix-commits flag past defects worth keeping on the radar:

- `dc0a731` — `sources_seen` not populated on first cluster (fixed; no regression test)
- `a4a0f29` — `.claude/` and dev scripts were tracked (cleanup)
- The "Add advanced time ranges, log aggregations, and improve error handling" rollup (`3596ae2`) and follow-up "fixes" (`test-aggregation-fixes.js`, `test-histogram-fixes.js` exist as evidence) suggest the aggregation payloads went through multiple churn cycles. The 4-fallback chain in `getLogHistogram` is the surviving scar tissue.

## FUTURE_PLANS.md Items Flagging Risk

From `FUTURE_PLANS.md`, several entries indicate the author already knows about gaps:

- **"Session token refresh — Handle Graylog API token expiry during long-running investigations."** — Tokens currently never refresh; long-running agent sessions will hit auth failures with no recovery path. (Section: Agent Ergonomics)
- **"Pre-canned query templates"** — the lack of templated/escaped query construction is implicitly acknowledged.
- **"`error_grouping_by_similarity`"** — already shipped per recent commits; the FUTURE_PLANS entry was the design seed, but the doc has not been pruned. Stale roadmap items dilute signal.

## Code Hygiene

- **Zero `TODO` / `FIXME` / `HACK` / `XXX` comments in `src/`.** Read as discipline, not completeness — the gaps are real, they're just not annotated.
- **`typescript` and `@types/node` are devDependencies with no `tsconfig.json`.** Dead tooling.
- **`zod` declared but unused.** Dead dependency.
- **`src/index.js` is 903 lines** — well past the threshold where extracting handlers to `src/tools/<feature>.js` (already started for clustering + template-mgmt) is overdue. The dispatch chain of `if (name === "...")` branches is a maintenance hazard; a Map dispatch would be safer and is the natural next refactor.
- **`src/tools.js` (652 lines) and the dispatcher in `index.js` must be kept in lockstep manually.** No compile-time check that every tool name in `toolDefinitions` has a matching dispatch branch.
- **README references some tools (and v2.3 features) but the canonical list lives only in `src/tools.js`.** Drift is likely.
