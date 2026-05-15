# Phase 3: Streams & Stream Rules - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.

**Date:** 2026-05-15
**Phase:** 03-streams-stream-rules
**Areas discussed:** Cascade-hash mechanic, Similarity heuristic, test_stream_match implementation, Mutable defense-in-depth, index_set_id requirement, Pre-create test contract, Rule discriminated union

---

## Cascade-hash mechanic (C2 mitigation, SC1)

| Option | Description | Selected |
|--------|-------------|----------|
| Hash-based: sha256(sorted cascade IDs) | Reuse Phase 2 _confirmationToken/requireConfirm; refuses on any drift | ✓ |
| Strict: any composition change refuses | Same outcome as hash-based; described in set terms | |
| Additions only: refuse only when NEW dependents appeared | More lenient | |

**Notes:** Reuses Phase 2's C1 confirmation hash infrastructure; no new framework primitive. Sensitive to BOTH additions and removals.

---

## Similarity heuristic for create_stream existingMatches (M5, SC4)

| Option | Description | Selected |
|--------|-------------|----------|
| Three buckets: exact / case_insensitive / prefix | Closed enum reason set; predictable; matches SC4 wording | ✓ |
| Levenshtein distance with threshold | More fuzzy; noisy on long titles | |
| Token-based: Jaccard similarity on whitespace-split tokens | Catches word reordering; noisy on short titles | |

**Notes:** Strictest bucket wins on multi-match. No fuzzy scoring.

---

## test_stream_match implementation (STREAM-11, SC3)

| Option | Description | Selected |
|--------|-------------|----------|
| Server-side via /streams/{id}/testMatch | Authoritative; no JS drift; requires stream to exist | ✓ |
| Wrapper-side JS simulation | Offline; fast; brittle to Graylog version | |
| Hybrid: server-side primary, wrapper sanity check | Surfaces drift; more code | |

**Notes:** Pre-create testing is out of scope per D-08 — agent uses create-then-test flow.

---

## Mutable defense-in-depth

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — pre-flight for all mutating stream tools | Wrapper-side gate before destructive verb | ✓ |
| No — trust Graylog's server-side response | Less defense; errors only after destruction fires | |
| Pre-flight for delete_stream only | Middle ground | |

**Notes:** Stream-rule mutations also pre-flight the parent stream's mutable flag. Same model as Phase 0 D-07 writable.

---

## index_set_id requirement (STREAM-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Required field; no default | Forces explicit storage-routing choice | ✓ |
| Default to cluster's default index set | Easier ergonomics; surprise routing if default changes | |
| Required but accept index_set_title alias | Friendlier for human-readable specs | |

**Notes:** Matches Phase 2 D-10 "explicit > implicit" principle.

---

## Pre-create test contract (STREAM-11)

| Option | Description | Selected |
|--------|-------------|----------|
| Require stream to exist first | One path; tool description spells it out | ✓ |
| Accept inline config; create ephemeral test stream | Self-cleaning but side effects on live cluster | |
| Inline simulation for pre-create; server-side for stored | Two code paths, drift risk | |

**Notes:** Agent flow: create_stream dry-run → create for real → test_stream_match.

---

## Stream rule schema (STREAM-08)

| Option | Description | Selected |
|--------|-------------|----------|
| Discriminated zod union on rule type | Strong type guarantees; matches Phase 1 input-type pattern | ✓ |
| Flat schema with value union and superRefine | Less typed; smaller def | |
| Generic value as string; wrapper coerces | Simplest; loses agent-boundary type info | |

**Notes:** 7 variants. Researcher verifies Graylog 7.0.6's StreamRuleType enum matches.

---

## Claude's Discretion

- Module layout under `src/tools/streams/`; cascade-hash module location (shared or per-domain).
- list_stream_rules vs get_stream embedded rules division.
- Snapshot fixture set design.
- Whether `delete_stream_rule` requires a confirmation hash (recommendation: no — leaf node).

## Deferred Ideas

- Server-side transactional cascade hooks (later phase if Graylog adds them)
- Pre-create test_stream_match (out per D-08)
- Levenshtein/token-based similarity (out per D-05)
- Bulk stream-rule operations (out — agent loops)
