---
phase: quick-260516-q8r
plan: 01
subsystem: inputs/extractors
tags: [bugfix, extractors, graylog-api]
requires: []
provides: ["update_extractor working PUT body with populated extractor_type"]
affects: ["src/tools/inputs/update-extractor.js"]
tech-stack:
  added: []
  patterns: ["read-vs-write key asymmetry fallback (?? )"]
key-files:
  created: []
  modified:
    - src/tools/inputs/update-extractor.js
    - test/extractors.test.js
decisions:
  - "Source extractor_type via current.extractor_type ?? current.type to handle the read DTO key (`type`) while staying forward-compatible"
  - "extractor_type stays immutable — not added to zod schema or `changes`"
metrics:
  duration: ~4m
  completed: 2026-05-16
  tasks: 2
  files: 2
---

# Phase quick-260516-q8r Plan 01: Fix update_extractor Null extractorType Summary

Fixed Bug #10: `update_extractor` always failed with `400 Null extractorType` because the merge read `current.extractor_type` from the Graylog extractor READ DTO, which names that field `type` — the key dropped out of the serialized PUT body.

## What Was Done

### Task 1: Source extractor_type from the read DTO type field
- Changed the `mergedBody` merge in `src/tools/inputs/update-extractor.js` from `extractor_type: current.extractor_type` to `extractor_type: current.extractor_type ?? current.type`.
- Updated the header comment block and the inline comment to document the read-vs-write key asymmetry: the READ DTO uses `type`, the WRITE body (`CreateExtractorRequest`) expects `extractor_type`.
- Zod schema untouched — `extractor_type` remains immutable and absent from `changes`.
- Commit: `22c5e60`

### Task 2: Add regression test for the read-vs-write key asymmetry
- Added a new test in the "C. update_extractor" section of `test/extractors.test.js` that defines a current-extractor fixture exposing `type: "grok"` (mirroring the real read DTO), invokes `handleUpdateExtractor` with `changes: { title: "new" }`, and asserts the PUT preview body has `extractor_type === "grok"`.
- The existing `CURRENT_EXTRACTOR` fixture (which uses `extractor_type`) was left intact — it still exercises the `??` left-hand fallback.
- Commit: `5becdce`

## Verification
- `grep` confirms the merge sources `extractor_type: current.extractor_type ?? current.type`.
- Full `npm test` suite green: 1099 tests pass, 0 fail.
- Reverting the Task 1 fix causes the new regression test to fail (`not ok 332 ... Bug #10 regression`), confirming it pins the fix.

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED
- FOUND: src/tools/inputs/update-extractor.js
- FOUND: test/extractors.test.js
- FOUND commit: 22c5e60
- FOUND commit: 5becdce
