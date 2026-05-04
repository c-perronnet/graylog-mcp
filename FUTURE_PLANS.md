# Future Plans — Graylog MCP

Backlog of features to add. Pick one at a time, design, implement, ship.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done

---

## Quick Wins (small additions, high agent value)

- [ ] **`compare_time_windows`** — Run the same query across two time ranges and return a delta (counts, top sources, error spikes).
  - *Why:* Agents need fast "what changed?" answers when comparing pre/post-deploy or incident vs baseline.

- [ ] **`get_error_rate_spike_context`** — Auto-detect time windows where error level jumped and fetch surrounding messages.
  - *Why:* Removes manual time-range tuning friction; surfaces high-signal events automatically.

- [ ] **`extract_common_patterns`** — Extract top-N message prefixes / regex groups from a result set to collapse repetitive errors.
  - *Why:* Helps agents spot "5 variants of the same error" without reading every line.

- [ ] **`list_log_indices` / `get_index_stats`** — Surface index metadata (size, retention, shard count).
  - *Why:* Visibility into log retention and system health during an investigation.

---

## Medium (new Graylog API surfaces)

- [ ] **`get_stream_stats`** — Ingestion rate, total messages, field cardinality per stream.
  - *Why:* Stream-level health checks inform "is this stream unhealthy?" diagnostics.

- [ ] **`get_pipeline_rules` / `get_extractors`** — Surface message enrichment pipeline state.
  - *Why:* Agents should know which fields are auto-extracted vs raw to judge data quality.

- [ ] **`search_by_trace_id`** — Purpose-built query builder for distributed-trace correlation (follow request_id chains).
  - *Why:* Microservices investigations need cross-service log following templated.

- [ ] **`message_export_to_csv`** — Batch export of search results with field selection.
  - *Why:* Some workflows need a downloadable report; wraps Graylog's export API.

- [ ] **`create_temporary_stream` / `list_filters`** — Dynamically create filtered views or query pre-built filters.
  - *Why:* Investigations sometimes need to sandbox a noisy source; filters wrap common patterns.

---

## Larger (analytical / synthesis capabilities)

- [ ] **`detect_anomalies`** — Baseline vs observed error rates; flag if rate is N-sigma above normal.
  - *Why:* "Is this a real incident?" needs a quantified anomaly signal, not a vibe.

- [ ] **`cross_stream_correlation`** — Find timestamp overlaps between two streams (e.g., auth errors + app timeouts).
  - *Why:* Multi-service root-cause hunting requires correlating independent signals.

- [ ] **`error_grouping_by_similarity`** — Cluster error messages by similarity (e.g., Levenshtein) and return group summaries.
  - *Why:* Thousands of logs collapse to ~10 patterns; helps agents prioritize.

- [ ] **`field_trend_analysis`** — Regression on a numeric field over time (e.g., latency creep).
  - *Why:* Proactive detection of degrading performance before alerts fire.

- [ ] **`automatic_time_range_suggestion`** — Given an event description, suggest the optimal window (e.g., "incident around 3pm" → ±15m).
  - *Why:* Agents waste tokens iterating on time-range parameters.

---

## Agent Ergonomics

- [ ] **Pre-canned query templates** — Top-N error sources, p99 latency by service, auth failure patterns.
- [ ] **Error-context summarizer** — Tool that returns "N errors, top 3 causes, affected services, time span" instead of raw logs.
- [ ] **Batched search + aggregation** — One tool call that finds top error then histograms it, to cut round-trips.
- [ ] **Session token refresh** — Handle Graylog API token expiry during long-running investigations.

---

## Suggested First Batch

1. `compare_time_windows`
2. `get_error_rate_spike_context`
3. `error_grouping_by_similarity`
4. Error-context summarizer
