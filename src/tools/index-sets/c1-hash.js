// Phase 3 Plan 01 Task 2: helpers promoted to src/tools/_shared/cascade-hash.js
// so the sha-256 confirmation pattern is reusable across destructive-cascade
// tools — Phase 3 delete_stream and Phase 4 delete_pipeline_rule both consume
// the new `computeCascadeHash` with the keyed-buckets canonicalization (D-02
// for Phase 3).
//
// This file remains as a back-compat re-export — every Phase 2 importer
// (src/tools/index-sets/delete-index-set.js + test/index-sets.test.js)
// continues to import from here without churn. The function objects are the
// SAME identity (re-export, not a copy) so any future refactor in
// _shared/cascade-hash.js automatically propagates through this path.
//
// See src/tools/_shared/cascade-hash.js for the C1-Hash semantics and D-02
// replay-protection rationale.

export { computeC1Hash, collectIndexNames } from "../_shared/cascade-hash.js";
