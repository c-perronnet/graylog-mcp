# Error Grouping by Similarity — Design

**Date:** 2026-05-04
**Feature:** `cluster_log_messages` + template-library management tools
**Source backlog item:** `error_grouping_by_similarity` in `FUTURE_PLANS.md`

## Goal

Collapse thousands of similar log messages into a small set of templates so an LLM agent can investigate by pattern instead of by line. Templates are learned per Graylog connection and persisted across sessions.

## Non-goals

- No multi-algorithm shipping in v1 (only Drain3-style template mining). Architecture leaves room for more.
- No anomaly detection, baseline comparison, or alerting — separate items in `FUTURE_PLANS.md`.
- No UI; MCP tools only.

## Architecture

```
src/clustering/
  index.js              # registry: register(name, strategy), get(name), list()
  preprocess.js         # token normalization (numbers/UUIDs/IPs/timestamps/hex → <*>)
  template-store.js     # per-connection JSON store, atomic write, lockfile
  formatter.js          # cluster output → MCP response shape
  strategies/
    drain3.js           # default strategy (in-house port, ~200 LOC)
src/tools/
  cluster-errors.js     # cluster_log_messages handler
  template-mgmt.js      # list/delete/rename/export/import handlers
src/tools.js            # add new tool definitions to existing array
src/index.js            # add dispatch lines for new tool names
```

Existing flat layout under `src/` is preserved. New `src/clustering/` and `src/tools/` directories are additive — no file moves.

## Strategy contract

Strategies are plain objects (not classes) registered in a `Map`. To add a new algorithm: drop a new file in `src/clustering/strategies/`, register it, done. No other code changes.

```js
// implement this contract to add a new clustering algorithm; register in src/clustering/index.js
export const someStrategy = {
  name: "some-name",
  version: 1,

  // Build/restore strategy state from persisted snapshot (or empty object)
  hydrate(state) { /* returns instance */ },

  // Serialize instance back for persistence
  serialize(instance) { /* returns plain object */ },

  // Cluster a batch; returns assignments + touched templates
  cluster(instance, normalizedMessages, opts) {
    return {
      assignments: [/* { messageIndex, templateId } per input */],
      templates:   [/* { id, template, tokens, isNew } per touched template */]
    };
  }
};
```

Registry API:

```js
import { register, get, list } from "./clustering/index.js";
register("drain3", drain3Strategy);     // self-registered at module load
const strategy = get("drain3");          // throws helpful error on unknown
list();                                  // ["drain3", ...]
```

## Tool API surface

### `cluster_log_messages` (primary)

Args:

| name | type | default | notes |
|---|---|---|---|
| `query` | string | `""` | Same semantics as `fetch_graylog_messages` |
| `filters` | object | `{}` | |
| `timeRange` / `from` / `to` | string | — | |
| `streamIds` | string[] | — | |
| `exactMatch` | boolean | `true` | |
| `sampleSize` | number | `1000` | Max `10000`. Clamped + warned if exceeded. |
| `field` | string | `"message"` | Field to cluster on |
| `algorithm` | string | `"drain3"` | Looked up in registry |
| `minClusterSize` | number | `2` | Clusters smaller than this are merged into a single synthetic `_misc` cluster (template_id `"_misc"`, template `"<misc — N singleton patterns>"`) and appended to the response |
| `readOnly` | boolean | `false` | If true, don't update template library |
| `includeSamples` | number | `3` | Raw message examples returned per cluster. Selection: first, middle, last by timestamp from the cluster (deterministic, gives temporal spread). |
| `similarityThreshold` | number | `0.4` | Drain3-specific tunable |
| `treeDepth` | number | `4` | Drain3-specific tunable |
| `maxChildren` | number | `100` | Drain3-specific tunable, prevents tree explosion |

Return shape:

```json
{
  "total_messages_clustered": 1000,
  "skipped_messages": 0,
  "total_clusters": 17,
  "algorithm": "drain3",
  "time_range": { "type": "relative", "range": 3600 },
  "query": "level:ERROR",
  "new_templates_learned": 3,
  "reinforced_templates": 12,
  "clusters": [
    {
      "template_id": "tpl_a3f1b2",
      "template": "User <*> failed login from IP <*>",
      "label": "AuthFailure",
      "label_present": true,
      "count": 412,
      "percentage": 41.2,
      "first_seen": "2026-05-04T10:02:11Z",
      "last_seen": "2026-05-04T10:59:48Z",
      "sources": ["auth-svc", "edge-proxy"],
      "_sources_note": "Distinct values of the Graylog `source` field across messages assigned to this cluster in the current call. Capped at top 10 by frequency.",
      "sample_messages": [
        { "timestamp": "...", "source": "auth-svc", "message": "User alice failed login from IP 10.0.0.1" }
      ]
    }
  ]
}
```

### Management tools

- `list_log_templates` — `{ limit?: number = 50, sortBy?: "count"|"last_seen"|"first_seen" = "count", filterLabel?: string }` → list with hit counts, first/last seen, label.
- `delete_log_template` — `{ templateId }` → confirmation message.
- `rename_log_template` — `{ templateId, label }` → updates persistent label, returns updated template.
- `export_log_templates` — `{}` → returns full library JSON inline (for backup/sharing).
- `import_log_templates` — `{ templates, mode: "merge"|"replace" }` → bulk load. `merge` keeps existing, adds new; `replace` wipes and loads.

All five honor the active connection (per-connection scoping).

## Persistence

**Location:** `~/.graylog-mcp/templates/<connection-name>.json` (auto-created on first write).

**File shape:**

```json
{
  "version": 1,
  "connection": "prod-graylog",
  "algorithm": "drain3",
  "algorithm_state": { /* opaque, strategy-owned snapshot */ },
  "templates": {
    "tpl_a3f1b2": {
      "id": "tpl_a3f1b2",
      "template": "User <*> failed login from IP <*>",
      "label": "AuthFailure",
      "tokens": ["User", "<*>", "failed", "login", "from", "IP", "<*>"],
      "count": 1247,
      "first_seen": "2026-04-12T08:14:22Z",
      "last_seen": "2026-05-04T11:02:18Z",
      "sources_seen": ["auth-svc", "edge-proxy"]
    }
  }
}
```

**Invariants:**

- `template_id` is a stable hash of the canonical template string. Same template across calls reuses the same ID.
- `algorithm_state` is opaque to the tool layer. Only the strategy reads/writes it via `serialize()` / `hydrate()`.
- Atomic writes: write to `<file>.tmp` → `rename` over the original.
- Concurrency: per-connection lockfile (`<file>.lock`). Stale lock (>30s mtime) is broken with a stderr warning.

## Drain3 algorithm (in-house port)

No actively-maintained, permissively-licensed `drain3` package on npm. Port the core algorithm in ~200 LOC. References: original Drain paper (He et al., 2017) + IBM `drain3` Python reference impl.

Steps:

1. **Preprocess:** Tokenize after normalizing `\d+` (numbers), UUIDs, IPv4/v6 addresses, ISO timestamps, hex strings (`0x[a-f0-9]+`, long hex blobs) → `<*>`. Configurable regex set.
2. **Length bucketing:** Group by token count (depth-1 of the parse tree).
3. **Prefix tree walk:** Within a bucket, descend a depth-N prefix tree (default depth 4) keyed on the first N non-wildcard tokens.
4. **Leaf matching:** Compare candidate to each template at the leaf, computing token-position similarity (matches / total). Best match above `similarityThreshold` wins.
5. **On match:** Increment counter; relax positions where tokens differ to `<*>`. Update `last_seen`.
6. **On no match:** Create a new template, insert into the leaf (capped at `maxChildren` — beyond cap, evict LRU child).

## Error handling

| Scenario | Behavior |
|---|---|
| Empty Graylog result set | Return `{ total_messages_clustered: 0, clusters: [] }`. Not an error. |
| `sampleSize` exceeds max (10000) | Clamp to max, include `warning` field in response. |
| `field` missing on a message | Skip that message, increment `skipped_messages`. |
| Corrupt template file | Log to stderr, treat as empty library, write fresh on next save. |
| Stale lockfile (>30s) | Break it, log warning to stderr, proceed. |
| Strategy throws mid-batch | Return partial clusters with `partial: true` + error message; do not persist. |
| Unknown `algorithm` name | Return `isError: true` with list of registered algorithms. |
| No active connection | Existing `requireActiveConnection()` helper returns standard error. |

## Testing

New file `test-clustering.js` (matches existing `test-*.js` convention).

**Unit tests:**

1. Preprocessor normalizes numbers, UUIDs, IPv4, IPv6, ISO timestamps, hex blobs to `<*>`.
2. Drain3 strategy clusters a fixture (50 known messages) into expected templates with expected counts.
3. Drain3 reinforce: re-feeding same messages doesn't create new templates, increments counts.
4. Registry: rejects duplicate names; returns helpful error on unknown name.
5. Template store: atomic write survives a simulated mid-write crash (write `.tmp`, kill, recover).
6. Template store: hydrate-after-corrupt-file returns empty library + logs warning.
7. Template store: lockfile contention (two concurrent writes serialize correctly; stale lock is broken).

**Integration test:**

8. End-to-end `cluster_log_messages` against a mocked Graylog HTTP response (reuse mocking pattern from existing `test-features.js`).

**Manual verification:**

9. Add a section to `README.md` showing how to run against a real Graylog instance for real-time agent testing.

## Extension contract (for future strategies)

To add a new clustering algorithm (e.g., token-shingle Jaccard):

1. Create `src/clustering/strategies/jaccard.js` implementing the strategy contract above.
2. Register at module load: `register("jaccard", jaccardStrategy)`.
3. Import the new strategy file in `src/clustering/index.js` so it loads.
4. Done. No changes to tool handlers, persistence, or registration code.

## Out of scope (future work)

- Additional algorithms (token-shingle, normalized-prefix hash, Levenshtein) — slot into the strategy registry when needed.
- TTL-based template decay — currently templates accumulate; pruning is deferred until library size becomes a problem.
- Cross-connection template sharing — per-connection scoping for now per design choice.
- UI for browsing templates — out of scope for an MCP server.

## Open questions

None at design time.
