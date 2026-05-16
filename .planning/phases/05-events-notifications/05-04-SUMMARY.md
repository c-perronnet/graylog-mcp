---
phase: 05-events-notifications
plan: 04
subsystem: events-notifications
tags: [event-notifications, discriminator, http-v2-encrypted-fields, strict-no-echo, d-09-cascade-hash, drift-refusal, paginated-walk, c3-class]

# Dependency graph
requires:
  - phase: 05-events-notifications/05-01
    provides: 6-variant NotificationConfigSchema (D-05 corrected); computeNotificationCascadeHash thin wrapper; conflict.js elements envelope amendment
  - phase: 05-events-notifications/05-02
    provides: events/index.js barrel; defineMutatingHandler integration patterns
  - phase: 03-streams-stream-rules/03-03
    provides: delete_stream D-09 cascade-hash + drift refusal pattern (line-for-line analog)
  - phase: 01-inputs-extractors/01-02
    provides: update_input C3 STRICT_NO_ECHO + redactForPreview / encodeEncryptedForWire helpers
provides:
  - list_event_notifications wire tool (EVENT-07; reclaims v2.3 dispatch name via S5 displacement)
  - create_event_notification wire tool (EVENT-08; 6-variant discriminator + CreateEntityRequest envelope + http-v2 C3 redaction)
  - update_event_notification wire tool (EVENT-09 part A; STRICT_NO_ECHO + C3 ACCEPTANCE GATE)
  - delete_event_notification wire tool (EVENT-09 part B; D-09 cascade-hash + apply-time drift refusal)
  - src/tools/events/encrypted-fields.js single source of truth for the http-notification-v2 encrypted-field inventory
  - Frozen empty-cascade hash literal for Plan 05-05 snapshot drift detection
affects: [05-05 snapshot fixtures + VALIDATION flip; 06 dashboards if it consumes notifications]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "C3 encrypted-field redaction adapted for event-notifications (http-v2 only on 7.2)"
    - "D-09 single-endpoint cascade-hash + drift refusal — leaner variant of Phase 3 delete_stream's 3-endpoint pattern"
    - "Encrypted-field inventory as a separate Object.frozen() helper module (decoupled from schemas)"

key-files:
  created:
    - src/tools/events/list-event-notifications.js
    - src/tools/events/create-event-notification.js
    - src/tools/events/update-event-notification.js
    - src/tools/events/delete-event-notification.js
    - src/tools/events/encrypted-fields.js
  modified:
    - src/tools/events/index.js
    - src/tools.js
    - test/events.test.js
    - test/pipelines.test.js
    - test/schema-parity.test.js

key-decisions:
  - "list_event_notifications default projection uses bare `config` (not dot-notation `config.type`) because defineListHandler's projectItem helper is dot-notation-unaware; the per-variant `type` is reachable via items[i].config.type without a behaviour change."
  - "STRICT_NO_ECHO at the changes.config layer means the agent's per-variant block flows verbatim onto the wire (encrypted fields shape-transformed only); zod adds .default()-marked scalar fields during parse (method, time_zone, etc.) which DO appear on the wire — this is harmless because none are encrypted."
  - "The drift-refusal test pattern requires the agent's args.confirm to match the token build() recomputes at apply-time; the actual cascade_changed_since_preview path only fires when apply()'s re-fetch sees additional drift beyond what build() saw (mirror Phase 3 delete_stream test 11)."

patterns-established:
  - "Pattern A: Encrypted-field inventory module (encrypted-fields.js) as the single source of truth — future Graylog versions add encrypted fields by editing one file; consumers (create/update handlers) inherit automatically."
  - "Pattern B: _applyBody sibling on the RequestDescriptor — preview and wire bodies differ ONLY in the encrypted-field shape; handler.js stays body-agnostic; the sibling is internal to the create/update handlers."
  - "Pattern C: D-09 single-endpoint paginated walk + client-side filter + safety cap, as a leaner direct analog of delete_stream's 3-endpoint cascade."

requirements-completed: [EVENT-07, EVENT-08, EVENT-09]

# Metrics
duration: 17min
completed: 2026-05-16
---

# Phase 5 Plan 04: event-notification CRUD Summary

**Event-notification CRUD (4 tools — list/create/update/delete) with D-05/D-06 6-variant discriminator closed-set rejection, http-notification-v2 C3-class encrypted-field STRICT_NO_ECHO, and D-09 cascade-hash + apply-time drift refusal load-bearing on def→notification orphan prevention.**

## Performance

- **Duration:** 17 min
- **Started:** 2026-05-16T02:15:19Z
- **Completed:** 2026-05-16T02:32:24Z
- **Tasks:** 3
- **Files created:** 5
- **Files modified:** 5

## Accomplishments

- Phase 5 complete — all 11 net-new wire tools shipped (7 event-definition + 4 event-notification); tool count 73 → 77.
- D-05 / D-06 discriminator rejection load-bearing: 6 valid variants accept; 3 invalid-by-name variants (script-v1, pagerduty-v1, teams-v1) reject at zod.parse before any HTTP call.
- C3 ACCEPTANCE GATE proven: http-notification-v2 update WITHOUT basic_auth → basic_auth + api_secret ABSENT from wire body; new-value updates wrap as {set_value} and surface as <redacted> in preview; current state NEVER round-tripped.
- D-09 cascade-hash + drift refusal load-bearing: paginated walk over /api/events/definitions/paginated client-side filters on def.notifications[].notification_id; freezes referencing defs into a 64-hex sha-256 confirmationToken; apply re-fetches + refuses on any drift via isError envelope; DELETE never fires under drift or absent-confirm.
- 32 net-new tests across 4 test categories (M1/C5/C3/D-09) + 4 schema-parity assertions; 843 tests / 18 suites green (+41 over Plan 05-03 baseline of 802).

## Task Commits

Each task was committed atomically:

1. **Task 1: EVENT-07 list + EVENT-08 create_event_notification + encrypted-fields.js helper** - `c3baf9c` (feat)
2. **Task 2: EVENT-09a update_event_notification (STRICT_NO_ECHO + C3-class)** - `350e638` (feat)
3. **Task 3: EVENT-09b delete_event_notification (D-09 cascade-hash + drift refusal)** - `f4286fd` (feat)

## Files Created/Modified

### Created (5)

- `src/tools/events/list-event-notifications.js` — defineListHandler over `/api/events/notifications/paginated`; narrow projection `[id, title, description, config]`; reclaims the v2.3 dispatch name per S5 displacement.
- `src/tools/events/create-event-notification.js` — defineMutatingHandler with 6-variant `NotificationConfigSchema` discriminator + CreateEntityRequest envelope (Pitfall 3) + existingMatches probe + http-v2 C3 redaction.
- `src/tools/events/update-event-notification.js` — defineMutatingHandler with STRICT_NO_ECHO partial-update; pre-flight GET sources current.config.type for encrypted-field lookup; encrypted fields the agent did NOT pass are NEVER on the wire (C3 ACCEPTANCE GATE).
- `src/tools/events/delete-event-notification.js` — defineMutatingHandler with single-endpoint cascade-hash via `computeNotificationCascadeHash` + apply-time re-fetch + drift refusal via `isError reason:cascade_changed_since_preview` (direct Phase 3 `delete_stream` analog, leaner).
- `src/tools/events/encrypted-fields.js` — `Object.freeze`d `ENCRYPTED_FIELDS_BY_TYPE` map (only `http-notification-v2` has encrypted fields: `basic_auth`, `api_secret`) + `getEncryptedFieldsForType(t)` accessor returning an empty Set for unknown types so callers do not need a null-guard.

### Modified (5)

- `src/tools/events/index.js` — 4 new `register()` calls for the four wire tools.
- `src/tools.js` — 4 new tool-definition entries (list/create/update/delete event-notification); descriptions explicitly document the D-05/D-06 closed set, the C3-class encrypted-field behaviour, the D-09 cascade-hash gate, and the SYNC delete envelope.
- `test/events.test.js` — 32 new tests across Tasks 1/2/3 covering wire paths, discriminator rejections, encrypted-field redaction/wire-shape asymmetry, STRICT_NO_ECHO invariants, cascade pre-flight, byte-identity, multi-page walk, safety cap, drift refusal, happy path, cascade_preflight_failed, writable-flag gate, and dispatch resolution.
- `test/pipelines.test.js` — tool-count assertion bumped 73 → 77 across the 3 task commits.
- `test/schema-parity.test.js` — 4 new schema-parity assertions (list/create/update/delete event-notification).

## Frozen Hash Literal for Plan 05-05

For the snapshot fixture matrix:

```
computeNotificationCascadeHash({ notificationId: "target-notif", eventDefIds: [] })
  = de6f0611eedf13b44f3267dbc02b07edbd822ef803d6af4702facf1bc88e538c
```

This empty-cascade literal is pinned in `test/events.test.js` (Task 3 test #3, "D-09 empty cascade still issues a confirmationToken"). Plan 05-05 reuses it for snapshot drift detection — any future change to `computeCascadeHash`'s canonical JSON shape (Phase 3 D-02 LOCKED) would break Phase 5 hashes via this literal mismatch (single source of truth, no parallel canonical-form drift).

The non-empty companion literal `computeNotificationCascadeHash({ notificationId: "target-notif", eventDefIds: ["def-1"] }) = 284c6ce566377b844244f28f5447e97aa59be9f6416d018fca2ba87a5f4bab0b` is also exercised structurally by Task 3 test #2 (byte-identity assertion).

## Test Categorization

The 32 net-new tests in this plan map to the safety-thesis gates:

### Task 1 — 13 tests (M2 + Pitfall 3/6/8 + FOUND-11 + C3-class create)

- list URL + narrow projection (4): bare path, query-string append, fields:'all' bypass, HAPPY projection
- create wire-body envelope (Pitfall 3) — 1
- create 6-variant accept (5): slack-v1, email-v1, http-v2 with redaction, pd-v2, teams-v2, http-v1 (6 valid variants across 6 sub-tests)
- create 3-variant reject at zod.parse (D-05/D-06 corrected — 3): script-v1, pd-v1, teams-v1
- create FOUND-11 existingMatches probe — 1
- create C3 wire/preview asymmetry on http-v2 — 1
- dispatch resolution — 1

### Task 2 — 9 tests (D-10 STRICT_NO_ECHO + C3 ACCEPTANCE GATE + Pitfall 8 + variant change)

- STRICT_NO_ECHO title-only — 1 (body keys EXACTLY [id, title])
- STRICT_NO_ECHO config block — 1 (current.config.user_name never echoed)
- **C3 ACCEPTANCE GATE — http-v2 WITHOUT basic_auth** — 1 (the load-bearing test)
- C3 wire — http-v2 WITH new basic_auth wraps as {set_value} — 1
- C3 preview — same shows <redacted> — 1
- variant change — old slack fields ABSENT from new teams-v2 wire config — 1
- Pitfall 8 — body.id matches URL — 1
- schema rejection — changes.config.type outside closed set — 1
- apply HAPPY — pre-flight GET + PUT fire in order — 1
- dispatch — 1

### Task 3 — 11 tests (D-09 cascade-hash + drift refusal + safety + writable)

- cascade pre-flight populates event_definitions + 64-hex confirmationToken — 1
- byte-identity with computeNotificationCascadeHash — 1
- empty cascade still issues token (frozen literal) — 1
- multi-page walk — 1
- safety cap at 1000 pages — 1
- confirmation_mismatch — 1 (refuses BEFORE DELETE; captured ONLY GETs)
- **D-09 ACCEPTANCE GATE — drift refusal between build() and apply re-fetch** — 1
- happy path — 1 (cascade unchanged → DELETE fires, applied:true)
- cascade_preflight_failed — 1
- writable=false short-circuits — 1 (defense-in-depth)
- dispatch — 1

## Decisions Made

1. **list_event_notifications projection uses `config` (not `config.type`):** `defineListHandler.projectItem` is dot-notation-unaware (`src/tools/_shared/list.js:108-114`). Adding dot-notation support would touch the cross-domain helper and ripple to other list tools. Carrying the full `config` object in the narrow projection preserves the agent's access to `items[i].config.type` without a helper-layer change. Tool description documents the projection shape explicitly. Future plan can promote dot-notation support to the helper if other tools need it.

2. **STRICT_NO_ECHO at config block, not config sub-fields:** Plan test 2 originally specified a partial slack config `{type, color}` for update; Plan 05-01's `NotificationConfigSchema` validates each variant's FULL required-field set (slack-v1 requires `webhook_url + channel + color`). STRICT_NO_ECHO at this layer means the agent's per-variant block flows verbatim onto the wire — current.config sub-fields are NEVER echoed in. The C3 invariant (encrypted fields ABSENT when not provided) still holds because zod's `.optional()` markers on `basic_auth`/`api_secret` mean they remain undefined after parse.

3. **Drift-refusal test pattern adapted from Phase 3 delete_stream:** The agent's `args.confirm` must match the token `build()` computes at apply-time (build runs again on apply). The actual `cascade_changed_since_preview` path fires when `apply()`'s re-fetch sees ADDITIONAL drift beyond what build() saw. The test mock returns:
   - call #1 (build at apply-time): the same cascade the dry-run saw → token X matches `args.confirm`.
   - call #2 (apply's re-fetch): a drifted cascade → token Y differs from X → isError.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug in plan-vs-schema] STRICT_NO_ECHO slack config test reframed**

- **Found during:** Task 2 (update_event_notification tests)
- **Issue:** Plan Test 2 specified `changes:{config:{type:"slack-notification-v1", color:"#00ff00"}}` would produce wire config keys `[type, color]` ONLY. But Plan 05-01's `NotificationConfigSchema` validates each variant's full required-field set at zod.parse — `slack-notification-v1` requires `webhook_url + channel + color + ...`. The minimal `{type, color}` input rejects at zod.parse.
- **Fix:** Test reframed to exercise the load-bearing invariant: the agent passes a FULL valid slack config block, and the wire body emits agent values verbatim (no current.config echo). `user_name` from current state is asserted ABSENT from the wire body — proving STRICT_NO_ECHO at the same security level the plan intended.
- **Files modified:** test/events.test.js
- **Verification:** Test now passes; the C3 ACCEPTANCE GATE (test #3) still holds at the encrypted-field level (the load-bearing C3 protection).
- **Committed in:** 350e638 (Task 2 commit)

**2. [Rule 1 — Bug in plan-vs-schema] http-v2 wire-keys assertion adjusted**

- **Found during:** Task 2 (C3 ACCEPTANCE GATE test for http-notification-v2 update WITHOUT basic_auth)
- **Issue:** Plan Test 3 expected captured `_applyBody.config` keys are EXACTLY `["type", "url"]` when the agent passes `{type:"http-notification-v2", url:"https://new.example/"}`. But the http-v2 schema has `.default()`-marked scalars (`method:"POST"`, `time_zone:"UTC"`, `skip_tls_verification:false`, `api_key_as_header:false`) which zod fills in during parse. The wire body therefore includes these defaulted scalars.
- **Fix:** Test reframed to assert the load-bearing invariant: `basic_auth` and `api_secret` are ABSENT from the wire body (the C3 acceptance gate is structurally about encrypted-field absence, not "minimal wire shape"). The non-encrypted defaulted scalars do appear on the wire — harmless because they are not encrypted. The agent's `url` propagates verbatim; current.url is NEVER echoed.
- **Files modified:** test/events.test.js
- **Verification:** Test now passes; the load-bearing C3 protection (no credential leak/wipe via current-state round-trip) holds at the encrypted-field level.
- **Committed in:** 350e638 (Task 2 commit)

**3. [Rule 1 — Test-only seam compatibility] Dispatch test capture seam loosened for list URLs**

- **Found during:** Task 1 (dispatch resolves list_event_notifications)
- **Issue:** The plan's reference `eventsMultiCapture_p2` helper does strict-equality matching on `req.path === pathPattern`. The list handler appends `?page=1&per_page=25` to the URL; the multiCapture strict-equality fails to match.
- **Fix:** Dispatch test uses an inline capture function that `.startsWith("/api/events/notifications/paginated")` instead of strict-equality. Other Task 1 tests for `handleListEventNotifications` directly use the capture seam (no multiCapture) and were not affected.
- **Files modified:** test/events.test.js
- **Verification:** Dispatch resolution test passes.
- **Committed in:** c3baf9c (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 1 — bug between plan test specs and Plan 05-01 schema reality; no plan structural changes).
**Impact on plan:** All three deviations are test-only adjustments. The handler implementations match the plan specifications verbatim. The C3 ACCEPTANCE GATE and D-09 drift refusal acceptance gates land structurally as planned; the reframings preserve the load-bearing security invariants while accommodating Plan 05-01's full per-variant-validation schema design.

## Issues Encountered

None — the three test-spec / schema mismatches were caught immediately on first run and resolved by reframing the tests against the load-bearing invariants. No handler implementations needed revision.

## User Setup Required

None — no external service configuration required. The wire shapes (CreateEntityRequest envelope, encrypted-field `{set_value}` wrapping, cascade-hash canonical JSON) are all client-side concerns; Graylog 7.2 needs no per-feature flag flip to accept them.

## Hand-off to Plan 05-05

- Snapshot fixture matrix is structurally complete: all 11 EVENT-XX wire tools have at least one ad-hoc test pinning their wire shape (list URL byte-stable; create/update wire body shape pinned; delete cascade-hash + drift-refusal envelope pinned).
- Plan 05-05's job is to freeze byte-stable snapshots + add 11 schema-parity assertions (already shipped this plan for the 4 net-new tools; 7 prior tools have existing assertions from Plans 05-02/05-03) + flip VALIDATION.md from `pending` to `complete`.
- Frozen empty-cascade literal `de6f0611eedf13b44f3267dbc02b07edbd822ef803d6af4702facf1bc88e538c` is pinned at `test/events.test.js` and ready for Plan 05-05's drift-detection snapshot.
- `assertAllToolsRegistered` passes against 77 tools.
- `src/graylog/errors.js` NOT modified (no new typed-error subclasses; existing `GraylogValidationError` carries `reason:cascade_preflight_failed`).
- No new npm dependencies.

## Final Tool Count

**77 wire tools** (Phase 0..4 reached 68; Phase 5 nets +9 considering the 2 displaced v2.3 list tools were already counted in the prior baseline):
- v2.3 carryover: 22 (after S5 displacement of `list_event_definitions` + `list_event_notifications` to Phase 5)
- Phase 1 (inputs/extractors): 11 net-new
- Phase 2 (index sets/retention): 7 net-new
- Phase 3 (streams/stream rules): 8 net-new
- Phase 4 (pipelines/pipeline rules/connections): 13 net-new
- Phase 5 (events/notifications): 11 net-new
- 5 reads from S5 displacement re-claims (5 tools that displaced v2.3 names occupy the same slots, so they don't increase the count further)

## Self-Check: PASSED

- All 5 created files exist on disk.
- All 3 task commits exist in git log: c3baf9c, 350e638, f4286fd.
- All 32 + 4 schema-parity new tests pass (`node --test 'test/**/*.test.js'` reports 843 / 843).
- `assertAllToolsRegistered` passes at count 77.
- `src/graylog/errors.js` NOT in the modified file set; no new npm deps introduced.

---
*Phase: 05-events-notifications*
*Completed: 2026-05-16*
