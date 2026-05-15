# Phase 4: Pipelines, Pipeline Rules & Connections - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.

**Date:** 2026-05-15
**Phase:** 04-pipelines-pipeline-rules-connections
**Areas discussed:** Pipeline-stream connection scope, Structured intent grammar coverage, Function catalogue source, delete_pipeline_rule cascade, simulate input shape, Pipeline parse pre-flight, DSL escape safety

---

## Pipeline-to-stream connection scope

| Option | Description | Selected |
|--------|-------------|----------|
| Add connect/disconnect as PIPE-13/14 | Closes the gap implied by the roadmap dependency line | ✓ |
| Defer to Phase 4.1 / Phase 5 | Cleaner phase boundary but blocks end-to-end routing | |
| Keep at 12; read-only via stream cascade | No mutation tools; agent can see existing connections via delete_stream cascade preview | |

**Notes:** Phase grows from 12 → 14 requirements. Researcher confirms exact endpoint path against 7.0.6.

---

## Structured intent grammar coverage

| Option | Description | Selected |
|--------|-------------|----------|
| Full DSL coverage | Recursive zod union covering all Graylog rule capabilities | ✓ |
| Common patterns only (~20) | Smaller surface, agents fall back to raw DSL more often | |
| Minimal: has_field + set_field | Tiny convenience wrapper | |

**Notes:** Agents stay in structured intent for any rule. Wrapper emits valid DSL for any structured input the schema accepts.

---

## Function catalogue source

| Option | Description | Selected |
|--------|-------------|----------|
| Static baseline + live overlay | Hand-curated builtins.js + per-connection live fetch; live wins on collision | ✓ |
| Live-only at runtime | Always fetch; loses offline validation | |
| Static-only | Predictable; drifts as Graylog adds functions | |

**Notes:** `src/pipeline-dsl/builtins.js` is the mandatory pre-phase research deliverable; runtime overlay caches per-connection process-lifetime per Phase 2 D-06 pattern.

---

## delete_pipeline_rule cascade behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse Phase 3 cascade-hash + drift refusal | Same machinery as delete_stream | ✓ |
| Refuse entirely when referenced | Safer but more friction | |
| Cascade-warn only; no apply gate | Loses C2-style safety | |

**Notes:** Uses `src/tools/_shared/cascade-hash.js` with `cascades: {pipelines: [...]}` bucket.

---

## simulate_pipeline_rule input shape

| Option | Description | Selected |
|--------|-------------|----------|
| Literal `{message: {...field_map...}}` | Same outer-key as test_stream_match | ✓ |
| Full Graylog Message envelope | More faithful; requires agent know reserved fields | |
| Both: accept either, normalize | Ambiguity in tool description | |

**Notes:** Wrapper translates to Graylog 7.0.6's expected body shape (research verifies). Consistent with test_stream_match for cross-phase ergonomics.

---

## Pipeline parse pre-flight

| Option | Description | Selected |
|--------|-------------|----------|
| POST /system/pipelines/parse pre-flight | Same C4 pattern as rule parse | ✓ |
| Client-side JS parser only | Drift risk vs Graylog | |
| Skip pipeline parse pre-flight | Less safe; loses uniform mitigation | |

**Notes:** Researcher confirms exact endpoint path on 7.0.6. Applies to create_pipeline AND update_pipeline.

---

## DSL escape safety

| Option | Description | Selected |
|--------|-------------|----------|
| Wrapper-side escape helper + parse pre-flight backstop | Defence in depth | ✓ |
| Trust parse pre-flight only | No client-side escape; escape bugs become parse errors | |
| Reject structured intent containing escape-needing chars | Limits structured-intent usability | |

**Notes:** `src/pipeline-dsl/escape.js` pure helper. Tested in isolation; parse pre-flight catches bugs the escape helper misses.

---

## Claude's Discretion

- Module layout under `src/tools/pipelines/` + `src/pipeline-dsl/`.
- Whether the structured-intent emitter lives in shared module or inline.
- Whether `simulate_pipeline_rule` accepts the `structured` shape (recommendation: yes — emit via shared module then forward).
- list_pipeline_functions merged-catalogue representation when live + static disagree on signature.
- Snapshot fixture set design.
- Wave structure (probably 5-6 plans).

## Deferred Ideas

- ~20 common rule pattern template library
- Auto-regeneration of builtins.js from Graylog source
- Pipeline-source structured-intent emitter
- Bulk pipeline-rule operations
- Live-fetched function catalogue auto-refresh
