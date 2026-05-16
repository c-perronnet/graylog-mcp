# /api/streams Deprecation — Migration Plan

**Created:** 2026-05-16 (Phase 7 — milestone close)
**Status:** Documented, NOT migrated. Migration is a follow-up milestone (HARD-05).
**Authoritative source:** Graylog 7.2.0-SNAPSHOT — `StreamResource.java:297` (`@Deprecated`).

## Background

Graylog 7.2's `StreamResource.java` marks `GET /api/streams` (the "list all
streams" bare-path endpoint) as `@Deprecated` at line 297 in
`source-code/graylog2-server/graylog2-server/src/main/java/org/graylog2/rest/resources/streams/StreamResource.java`.
The non-deprecated replacement is `GET /api/streams/paginated`. The
deprecated bare endpoint still works in 7.2 (HARD-03 smoke confirmed the
`{ total, streams[] }` envelope is unchanged), but may be removed in a
future major release.

PITFALLS.md backward-compat section (row 1) flagged this endpoint as the
top "v2.3-on-v7.2" drift risk at milestone planning time. The smoke at
`test/v7-read-tool-smoke.test.js` ("v7.2 GET /api/streams — fetchStreams
returns the deprecated-bare-path envelope") proves the milestone end-state
still works against v7.2; this document describes how a future milestone
can close the deprecation debt.

## Affected Code

| Caller | File:Line | Path |
|--------|-----------|------|
| `fetchStreams(baseUrl, apiToken)` | `src/query.js:97` | `GET /api/streams` |

Phase 3's `list_streams` (`src/tools/streams/list.js`) already hits the
non-deprecated `/api/streams/paginated`. The only remaining consumer of the
deprecated bare path is the v2.3 `fetchStreams` function in `src/query.js`,
which is called by:

| Consumer | Use case |
|----------|----------|
| `listStreamsHandler` (`src/handlers.js:234`) | Exported but NO LONGER dispatched (Plan 03-01 displaced it with the Phase 3 `list_streams`). Kept for HARD-03 audit reference only. |

So in practice, `fetchStreams` is a dead-code-path-but-still-exported function
at milestone close. The migration below covers the case where some future
caller wires it back in — but the simpler option is documented under
"Alternative" below.

## v7.2 Response Shape Diff

| Endpoint | Response | Pagination |
|----------|----------|------------|
| `GET /api/streams` (deprecated) | `{ total: number, streams: Stream[] }` | None — returns ALL streams in one shot |
| `GET /api/streams/paginated` | `{ total, page, per_page, count, elements: Stream[], attributes, ... }` | `?page=N&per_page=M` |

Key differences:
- Field renamed: `streams` → `elements`
- Pagination metadata added: `page`, `per_page`, `count` (count = elements.length on this page)
- Default `per_page` is server-side (50 on 7.2); the deprecated endpoint had no cap

Both responses share the same per-stream `Stream` DTO (`id`, `title`,
`description`, `rules`, `index_set_id`, etc.), so per-element extraction
code does not need to change — only the envelope unwrap differs.

## Migration Steps (Future Milestone)

1. **Update `fetchStreams()` in src/query.js** to hit `/api/streams/paginated`
   with a generous `per_page` (200 — matches `MAX_LIMIT` in
   `src/tools/_shared/list.js`) and walk pages until
   `count < per_page` becomes true OR the cumulative elements length
   reaches `total`.
2. **Normalize the envelope** at the boundary: rename `elements` →
   `streams` so downstream callers (any future consumers; the existing
   v2.3 dead-path doesn't matter) continue to receive the
   `{ total, streams[] }` shape. Keeps `fetchStreams`'s public contract
   unchanged.
3. **Add a smoke test** mirroring the HARD-03 fixture-based pattern at
   `test/fixtures/v7-read-tool-smoke/streams-paginated.json` and a
   corresponding test in `test/v7-read-tool-smoke.test.js`.
4. **Audit complete** — only `fetchStreams` uses the deprecated bare path
   as of Phase 7 milestone close. No other code requires migration.

## Alternative: Just Delete `fetchStreams`

`fetchStreams` is exported from `src/query.js` but its sole dispatch-wired
consumer (`listStreamsHandler` in `src/handlers.js`) was displaced by Phase 3.
A future milestone could simply delete `fetchStreams` AND `listStreamsHandler`
without migrating to `/paginated` at all — the Phase 3 `list_streams` tool
already covers the use case. This is the LOWER-effort path:

- ~10 min: delete unused function + handler + export line in `src/handlers.js`
- ~5 min: verify `npm test` still green (the HARD-03 smoke would lose its
  fetchStreams target — remove that specific test or replace with a
  `list_streams` smoke pinning the `/paginated` envelope)
- ~5 min: commit

Total: ~20 min vs ~75 min for the full migration. The full migration only
makes sense if a NEW use case for the bare `fetchStreams` shape emerges.

## Effort Estimate

| Path | Effort |
|------|--------|
| Full migration (paginated + page-walk + smoke) | ~75 min single-plan effort |
| Delete dead code (recommended) | ~20 min single-plan effort |

## Why Not This Milestone

PROJECT.md scope explicitly excludes "backward-compat refactors of existing
v2.3 read tools" — HARD-03's job is to verify-against-v7, NOT refactor. The
deprecation is documented here; the migration is owed to v2.4 or whenever a
future milestone wants to close this debt.

## Sources

- Graylog 7.2.0-SNAPSHOT: `source-code/graylog2-server/graylog2-server/src/main/java/org/graylog2/rest/resources/streams/StreamResource.java:297` (`@Deprecated`)
- PITFALLS.md (project research) — backward-compat section row 1
- HARD-03 smoke fixture: `test/fixtures/v7-read-tool-smoke/streams.json`
- HARD-03 smoke test: `test/v7-read-tool-smoke.test.js` ("v7.2 GET /api/streams")
