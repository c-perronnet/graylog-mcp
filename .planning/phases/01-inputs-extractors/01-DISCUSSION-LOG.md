# Phase 1: Inputs & Extractors - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-15
**Phase:** 01-inputs-extractors
**Areas discussed:** Input schemas, Encrypted fields, delete_input behavior, Input lifecycle, Extractor schemas, Catalogue caching, Create-time secrets

---

## Input type schemas

| Option | Description | Selected |
|--------|-------------|----------|
| Typed 4 + generic rest | Strict zod for GELF/Beats/Syslog/Raw; generic validated config for other types | ✓ |
| Dynamic from catalogue | Derive validation at runtime from type catalogue `attributes`, no hand-written schemas | |
| Typed 4 only | Ship only the 4 common types, reject all others | |

**User's choice:** Typed 4 + generic rest
**Notes:** Keeps the common path strongly typed while leaving less-common inputs (AWS, CEF) reachable.

---

## Encrypted fields

| Option | Description | Selected |
|--------|-------------|----------|
| Read is_encrypted from catalogue | Fetch type attribute metadata, treat `is_encrypted` attributes as protected | ✓ |
| Hardcoded per-type allowlist | Static map of encrypted fields per type in source | |
| Both: catalogue + static fallback | Prefer live catalogue, fall back to hardcoded list | |

**User's choice:** Read is_encrypted from catalogue
**Notes:** Always accurate to the connected Graylog version; catalogue is cached so no per-update request cost.

---

## delete_input behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Delete input, warn in dry-run | Graylog auto-removes extractors; dry-run enumerates affected extractors | ✓ |
| Refuse if extractors exist | Block delete until extractors deleted explicitly first | |
| Explicit cascade flag | Refuse by default; allow only with `cascade: true` | |

**User's choice:** Delete input, warn in dry-run
**Notes:** Matches ROADMAP success criterion 4 — dry-run shows blast radius before applying.

---

## Input lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| Create stopped, dryRun on start/stop | Input created stopped; start/stop go through defineMutatingHandler | ✓ |
| Create stopped, no dryRun on start/stop | Input created stopped; start/stop skip dryRun preview | |
| Create auto-started | create_input starts the input immediately on apply | |

**User's choice:** Create stopped, dryRun on start/stop
**Notes:** Uniform mutation model — every state change goes through the same safety gate.

---

## Extractor schemas

| Option | Description | Selected |
|--------|-------------|----------|
| All 6 typed | Strict zod for all 6 named extractor types | ✓ |
| Typed common + generic | Type grok/regex/JSON; generic config for the rest | |
| Mirror input strategy | Reuse the input typed-plus-generic pattern | |

**User's choice:** All 6 typed
**Notes:** The requirement enumerates a closed set, so full typing is achievable with no escape hatch.

---

## Catalogue caching

| Option | Description | Selected |
|--------|-------------|----------|
| Cache per connection, process-lifetime | Fetch once per connection, hold for process lifetime | ✓ |
| No cache — fetch every call | Always fetch fresh from the API | |
| Cache with TTL | Per-connection cache with a short TTL | |

**User's choice:** Cache per connection, process-lifetime
**Notes:** Input types effectively never change at runtime; invalidation on process restart only.

---

## Create-time secrets

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — accept on create, redact in preview | create_input accepts encrypted fields; dry-run shows them redacted | ✓ |
| Yes — accept, but show field name only | Accept; dry-run lists field present, no placeholder | |
| No — create plain, set secrets via update | Reject encrypted fields on create; require a follow-up update_input | |

**User's choice:** Yes — accept on create, redact in preview
**Notes:** Secured inputs (TLS, AWS) creatable in one call; secret never appears in MCP output.

---

## Claude's Discretion

- Module layout under `src/tools/inputs/`; extractor sub-module organization.
- Whether GELF/Syslog transport variants are distinct schemas or a transport discriminant.
- Exact redaction placeholder string for encrypted fields in previews.
- Location and test seam of the per-connection catalogue cache.
- How `delete_input` fetches its extractor enumeration for the dry-run warning.

## Deferred Ideas

None — discussion stayed within phase scope.
