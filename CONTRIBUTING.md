<!-- generated-by: gsd-doc-writer -->
# Contributing to Graylog MCP

Thanks for your interest in improving the Graylog MCP server. This project gives an AI agent end-to-end control of a Graylog 7.2.0-SNAPSHOT deployment, so contributions are held to a high safety and consistency bar. The guidelines below explain how to file issues, propose changes, and submit pull requests that the maintainers can merge quickly.

## Code of Conduct

There is no separate `CODE_OF_CONDUCT.md` yet. Until one is added, please follow standard open-source etiquette: be respectful, keep technical disagreements technical, and assume good faith from other contributors. Maintainers may close or lock discussions that become unproductive.

## Where to File Issues

- Bug reports and feature requests: <https://github.com/c-perronnet/graylog-mcp/issues>
- Include: Graylog server version (`7.2.0-SNAPSHOT` is the supported target), Node.js version (`>= 22.3.0`), the tool name involved, the arguments passed (redact secrets), the actual output, and what you expected.
- For mutating tools, please include whether `dryRun` was `true` or `false` and the confirmation token returned by the preview.

### Security Issues

**Do not report vulnerabilities via public GitHub Issues.** This project authenticates against live Graylog deployments and writes configuration that affects production observability pipelines. If you find a security-sensitive bug (e.g., a mutating tool that bypasses `dryRun`, an authz check that fails open, a credential leak in logs, a path-traversal in the template store), report it privately to the maintainers via direct GitHub contact instead.

## Development Setup

Prerequisites and first-run instructions:

- See [`README.md`](README.md) for installation, environment, and a working `~/.graylog-mcp/config.json`.
- See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the layered design (transport → dispatch → per-domain tools → `_shared` helpers → Graylog client).
- See [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) for connection registry, env vars, and persistent state locations.

Quick local loop:

```bash
git clone git@github.com:c-perronnet/graylog-mcp.git
cd graylog-mcp
npm install
npm test
```

There is no build step — this is a native ES Modules project (`"type": "module"` in `package.json`). Run the server directly with `npm start` or use `npm run dev` for `node --watch`.

## Branch and PR Flow

1. Fork the repository on GitHub.
2. Create a feature branch from `main` in your fork. Use a short, descriptive name (e.g., `feat/dashboards-clone`, `fix/pipeline-dryrun-token`).
3. Make changes in small, reviewable commits.
4. Open a pull request against `c-perronnet/graylog-mcp:main`.
5. Address review feedback by pushing additional commits to the same branch (do not force-push during review unless asked).

### Planning Workflow (Claude Code Users)

If you use Claude Code, this project enforces the GSD workflow described in [`CLAUDE.md`](CLAUDE.md) under "GSD Workflow Enforcement". Start work through `/gsd-quick` (small fixes, docs), `/gsd-debug` (investigation), or `/gsd-execute-phase` (planned phase work) so planning artifacts in `.planning/` stay in sync.

If you do not use Claude Code, follow a plain **discuss-design-then-PR** flow for non-trivial changes: open an issue describing the proposed change before opening a large PR, especially if it adds new tools, changes tool contracts, or introduces new dependencies.

## Coding Conventions

[`CLAUDE.md`](CLAUDE.md) is the source of truth for naming and code organization. Highlights:

| What | Convention | Examples |
|---|---|---|
| Multi-word files | kebab-case | `cluster-errors.js`, `template-store.js` |
| Functions | camelCase | `buildQueryString`, `normalizeMessage` |
| Tool handlers | `handle*` prefix | `handleClusterLogMessages`, `handleShareEntity` |
| Builders | `build*` prefix | `buildTimeHistogram`, `buildStreamFilter` |
| Module constants | SCREAMING_SNAKE_CASE | `STORE_VERSION`, `LOCK_STALE_MS` |
| Test-only / private | leading `_` | `_clearForTests`, `_testConnection`, `_storePathForTests` |
| MCP tool names | snake_case | `fetch_graylog_messages`, `cluster_log_messages`, `share_entity` |

Additional conventions:

- **Code organization.** New admin tools go into `src/tools/<domain>/` (per-domain modules), following the existing patterns in `src/tools/authz/`, `src/tools/dashboards/`, `src/tools/pipelines/`, etc. Do not inline new handlers in `src/index.js`.
- **`_testConnection` seam.** Magic argument name accepted by tool handlers so tests can inject a fake connection without touching the active-connection registry. See `src/tools/cluster-errors.js` and `src/tools/template-mgmt.js` for the canonical pattern.
- **Validation.** Use `zod` schemas for new tool input validation. The project already depends on `zod`; do not introduce a different validation library.
- **Imports layout.** Standard library first, then third-party, then local imports — match the style of the file you are editing.

## Quality Bar Before Submitting

A PR is ready for review when **all** of the following hold:

- [ ] `npm test` is green. The suite currently has ~1196 tests across 49 test files; if you add a new tool or behavior, you must add tests.
- [ ] `npm run audit:tool-descriptions` passes. Tool descriptions must be ≤ 200 characters and either span two sentences or contain a comparative keyword ("vs.", "rather than", "instead of", "use this when", etc.). See `scripts/audit-tool-descriptions.js` for the exact rules.
- [ ] If you add a new tool, you bump the tool-count assertions in the **same PR**:
  - `test/list-admin-tools.test.js` (overall count + per-domain counts)
  - `test/pipelines.test.js` (if a pipelines-domain tool)
  - `test/dashboards.test.js` (if a dashboards-domain tool)
- [ ] If your tool **mutates** Graylog state, it composes `defineMutatingHandler` from `src/tools/_shared/handler.js` so it gets these properties for free:
  - `dryRun: true` default — applying without explicit `dryRun: false` is a bug.
  - SHA-256 confirmation token returned from the preview, required to apply.
  - Drift refusal — apply call refuses if the upstream entity changed since the preview.
  See `docs/ARCHITECTURE.md` and the existing mutating tools in `src/tools/authz/share-entity.js` and `src/tools/pipelines/` for the canonical composition.
- [ ] **No new runtime dependencies** unless you have strong justification. Current runtime deps are intentionally minimal: `@modelcontextprotocol/sdk`, `axios`, `zod`. Adding to that list requires explicit maintainer sign-off — see the "no new deps" constraint in [`CLAUDE.md`](CLAUDE.md).
- [ ] No regressions in existing v2.3 tool contracts. The connection-config schema is additive only.
- [ ] No web UI surface, no rendered HTML, no browser code. Output is JSON-stringified text in MCP responses.

## Code Review Philosophy

**Composition over invention.** Before submitting a new tool, read the closest existing analog and follow its shape:

- Adding a sharing-style tool? Read `src/tools/authz/share-entity.js` first.
- Adding a list-style tool? Read `src/tools/authz/list-roles.js` first.
- Adding a mutating tool? Read any existing tool that uses `defineMutatingHandler` (e.g., `src/tools/authz/share-entity.js`, `src/tools/pipelines/*.js`).
- Adding a CRUD set for a new domain? Read `src/tools/authz/` end-to-end — it is the most mature per-domain module.

When the existing pattern does not fit your case, say so explicitly in the PR description and propose the new pattern, rather than inventing one silently.

## Project Decisions and Roadmap

Project decisions, the current milestone scope, and out-of-scope items are tracked in `.planning/PROJECT.md`. Large changes should align with the current milestone. If your proposal does not fit the active milestone, expect maintainers to redirect it to `.planning/FUTURE_PLANS.md` or a future milestone rather than merge it ad-hoc.

## License

This project is licensed under the [MIT License](LICENSE). By submitting a pull request, you agree to license your contribution under the MIT License.
