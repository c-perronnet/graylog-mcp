# Pitfalls Research

**Domain:** Entity-sharing / authorization tooling for an MCP server against Graylog 7.0.6
**Researched:** 2026-05-19
**Confidence:** HIGH (source-verified against `EntitySharesResource.java`, `EntitySharesService.java`, `EntityShareRequest.java`, `EntityShareResponse.java`, `Capability.java`, `GRN.java`, `GRNTypes.java`, `GRNRegistry.java`, `AuthzRolesResource.java`, `RolesResource.java` in the local 7.2-SNAPSHOT clone; LOW where noted for 7.0.6-vs-7.2 divergence not verifiable against the live instance)

> This file replaces the v3.0.0 admin-surface pitfalls research. It is scoped to the v3.1.0 AuthZ & Sharing milestone.

## Source-Confirmed API Shape (read this first)

The milestone brief says `PUT /api/authz/shares/{grn}`. **The source disagrees** — verify against the live 7.0.6 instance before building. From `EntitySharesResource.java`:

| Operation | Method + Path | Notes |
|-----------|---------------|-------|
| Prepare/preview a share | `POST /api/authz/shares/entities/{entityGRN}/prepare` | `@NoAuditEvent` — does not mutate |
| Apply a share | `POST /api/authz/shares/entities/{entityGRN}` | NOT `PUT`. Mutates. |
| Read a user's shares | `GET /api/authz/shares/user/{userId}` | Keyed by **user ID**, not username |
| Generic prepare (no entity) | `POST /api/authz/shares/entities/prepare` | dependency-check across multiple GRNs |

Request body for both prepare and apply is `EntityShareRequest`:
```json
{ "selected_grantee_capabilities": { "grn::::user:<userId>": "view" },
  "selected_collections": [ ] }
```

This is the **complete desired grant set**, not a delta. That single fact drives Pitfalls 1, 3, and 7.

## Critical Pitfalls

### Pitfall 1: Grant-set replacement silently revokes every other user's access

**What goes wrong:**
`POST /api/authz/shares/entities/{entityGRN}` treats `selected_grantee_capabilities` as the full desired state. `EntitySharesService.updatePrimaryEntityShares` (lines 312–331) does three things: updates grants whose grantee is in the map, **creates** grants for new grantees, and **deletes every existing grant whose grantee is not a key in the submitted map** (`if (!selectedGranteeCapabilities.containsKey(g.grantee())) grantService.delete(g.id())`). An agent that calls `share_entity` with `{"grn::::user:bob": "view"}` to "add Bob" will, if Alice and a team already had grants, **delete Alice's and the team's access**. The `getSelectedGranteeCapabilities` doc comment confirms it: *"we expect the frontend to always submit the full selection not only added/removed grantees. If the grantee selection is empty, that means all shares should be removed."*

**Why it happens:**
The endpoint name and the `share_entity` verb both imply "add a grant." REST intuition says POST appends. The replacement semantics are invisible unless you read the service code. The MCP tool author writes the obvious thing: take a grantee + capability, build a one-entry map, POST it.

**How to avoid:**
- `share_entity` MUST be a read-modify-write, never a blind write. Mandatory sequence: (1) call `prepare` to get `active_shares`; (2) merge the requested grant into the existing `selected_grantee_capabilities` map; (3) submit the **merged** map. This is the exact GET-merge-POST pattern v3.0.0 already uses for pipeline↔stream connections — reuse that primitive.
- The tool's input surface should be `{ grant: {grantee, capability} }` (a delta the agent expresses), NOT `{ grants: [...] }` (a full set the agent must assemble). The tool assembles the full set internally from the prepared state. Expose a separate `revoke` intent rather than making the agent omit a grantee.
- The dry-run output must explicitly diff: "grants ADDED: …", "grants UNCHANGED: …", "grants that WOULD BE REMOVED: …". If the removed list is non-empty and the caller did not explicitly ask to revoke those, refuse and require an explicit confirmation flag.
- The sha-256 confirmation token must be computed over the **full final grant set**, not just the delta — so an apply that would drop a grant the preview didn't show fails the token check.

**Warning signs:**
- The tool builds a request map containing only the grantee passed in by the agent.
- No `prepare` call precedes the apply.
- Dry-run output shows only what is added, never what is removed.
- Integration test only asserts "Bob can now see the stream," never "Alice still can."

**Phase to address:**
Foundation/core-sharing phase — this is the headline structural defense. It cannot be retrofitted; the read-merge-write contract has to be the shape of `share_entity` from its first commit.

---

### Pitfall 2: GRN malformation — wrong type segment, grantee/target confusion, username-vs-userId

**What goes wrong:**
A GRN is `grn:<cluster>:<tenant>:<scope>:<type>:<entity>` — six colon-separated tokens (`GRN.parse`, lines 55–72). Common-but-real malformations:
- **Wrong token count / scheme** — anything but exactly 6 tokens, or first token ≠ `grn`, throws `IllegalArgumentException` → HTTP 400.
- **Wrong type segment** — the registry rejects unknown types: `newGRNBuilder` throws `"type <X> does not exist"` (GRNRegistry line 143). Valid types are a fixed set (`GRNTypes.java`): `stream`, `dashboard`, `search` (saved searches are type `search`, *not* `saved_search`), `event_definition`, `notification` (event notifications are `notification`, *not* `event_notification`), `user`, `role`, `output`, `report`, `builtin-team`, `grant`, `search_filter`, `favorite`, `last_opened`. Guessing a plausible-but-wrong type (`saved-search`, `eventdefinition`, `stream_id`) is a 400.
- **Grantee/target confusion** — the *target* GRN goes in the URL path; the *grantee* GRN is a key inside `selected_grantee_capabilities`. Both are GRNs; swapping them is easy and the server cannot detect the mistake (it will happily try to share a user GRN entity with a stream-GRN grantee).
- **Username-vs-userId-vs-GRN** — a grantee GRN for a user is `grn::::user:<userId>` where `<userId>` is the Mongo ObjectId, **not** the login name. `GET /api/authz/shares/user/{userId}` is also keyed by ID. But `AuthzRolesResource` and the legacy `RolesResource` are keyed by **username** / **rolename**. Three different identifiers for "a user" across three endpoints. Passing a username where a userId GRN is expected produces a grant against a non-existent grantee, or a silent no-op.
- **Team grantee** — sharing with "everyone" is `grn::::builtin-team:everyone` (`GRNRegistry.GLOBAL_USER_GRN`); the type is `builtin-team`, not `team`.

**Why it happens:**
GRN strings look like free text. The agent (and the tool author) will infer type names from entity domain names rather than from the registry. Graylog's own naming is inconsistent (`notification` GRN vs `event_notification` everywhere else; `search` GRN for saved searches). User identity has three representations and no compiler to catch a mismatch.

**How to avoid:**
- Never let the agent hand-author GRN strings. Provide a `buildGRN(type, id)` helper with a `zod` enum of the **exact** valid type set from `GRNTypes.java`. Reject unknown types client-side with a message listing valid types.
- Resolve human-friendly inputs to IDs *inside the tool*: accept a username, look up the userId via the users API, construct `grn::::user:<userId>`. Never trust a caller-supplied user GRN without verifying the user exists.
- Validate the 6-token / `grn`-scheme structure client-side with a regex before any HTTP call — turn a server 400 into a clear client error.
- Make target and grantee structurally distinct in the tool signature: `entity: {type, id}` vs `grantee: {kind: 'user'|'team'|'role', id}`. The tool builds both GRNs; the agent never sees raw GRN strings.
- Cross-check: after building the grantee GRN, confirm its type is `user`/`builtin-team`/`role`; after building the target GRN, confirm its type is a shareable entity type (`stream`/`dashboard`/`search`/...). A grantee-shaped target or vice versa is a hard error.

**Warning signs:**
- GRN strings appear as interpolated template literals anywhere in tool code.
- The type segment is derived from a tool-domain name rather than a constant.
- A test passes a login name as a userId.
- HTTP 400 "is not a valid GRN string" or "type <X> does not exist" reaches the agent.

**Phase to address:**
Foundation phase — the GRN abstraction (`src/tools/authz/grn.js`) is a prerequisite for every authz tool and is explicitly a milestone requirement ("a GRN abstraction generalizes the sharing tool"). Build and unit-test it before any sharing handler.

---

### Pitfall 3: Self-lockout and the ownerless-entity trap

**What goes wrong:**
Two distinct self-harm modes:
1. **Owner-check gate** — `EntitySharesResource.updateEntityShares` calls `checkOwnership(entity)` (RestResourceWithOwnerCheck), which requires the API token's user to hold `ENTITY_OWN` on the target. If the token user is an admin-by-role but not the entity *owner*, the share call returns **403 ForbiddenException** — even though the same token can edit the stream through other endpoints. Sharing requires `own`, not `manage`.
2. **Ownerless entity** — `validateRequest` (EntitySharesService lines 397–446) refuses a request that would remove the last `OWN` grant: *"Removing the following owners <…> will leave the entity ownerless."* But because of the replacement semantics (Pitfall 1), a naive full-set write that simply forgets to re-include the current owner triggers exactly this. The request fails validation (HTTP 400 with a `validation_result`), which is the *good* outcome — but a tool that ignores `validation_result` and reports success is lying. Worse: if the entity is *already* ownerless, the guard is bypassed (line 415) and any owner-stripping write succeeds silently.
3. **Self-grant removal** — note `getForTargetExcludingGrantee` excludes the sharing user's own grant from the existing set (line 272). So the sharing user's own grant is never touched by the replacement logic — you cannot remove your own access via this endpoint, which is a *safety feature*. But it also means the sharing user's own access is invisible in `active_shares`, so a tool that renders "current grants" from `active_shares` will under-report.

**Why it happens:**
"Admin can do anything" intuition — but Graylog scopes sharing to entity ownership specifically. The ownerless guard interacts invisibly with replacement semantics. `validation_result` is a soft field in a 200-shaped response body on prepare, easy to skip.

**How to avoid:**
- Before applying, the tool must check that the merged grant set still contains at least one `own` grant *if the current set has one*. Surface this in dry-run as a hard pre-flight, not a post-hoc server error.
- Treat `prepare`'s `validation_result.failed === true` as a blocking error: never proceed to apply, surface the `validation_result.errors` text and `context` (the list of removed-owner GRNs) verbatim to the agent.
- On apply, the endpoint returns HTTP 400 with the `EntityShareResponse` in the body when `validationResult().failed()` (resource lines 166–170) — the tool must inspect the body on 400, not just throw on non-2xx.
- Map a 403 from the sharing endpoints to a specific, actionable message: "the connection's API token user is not an *owner* of this entity — sharing requires `own`, distinct from edit/manage." Do not let it surface as a generic permission error.
- When displaying current grants, note that the sharing user's own grant is excluded by design; label `active_shares` as "grants held by other grantees."

**Warning signs:**
- Tool reports apply success without inspecting `validation_result`.
- 403 on a share call is reported as a connection/auth failure rather than an ownership gap.
- Dry-run never mentions ownership.
- No test for "share a stream the token user does not own."

**Phase to address:**
Core-sharing phase. The `validation_result` handling and the ownerless pre-flight are part of the same dry-run pipeline as Pitfall 1's diff.

---

### Pitfall 4: Ignoring prepare-response dependency and validation notices

**What goes wrong:**
`prepare` returns an `EntityShareResponse` (EntityShareResponse.java) with two fields a naive tool drops on the floor:
- `missing_permissions_on_dependencies` — a map of dependency GRN → entity descriptors. Sharing a stream that is backed by an index set, or a dashboard that wraps a saved search, can leave the new grantee able to *see the entity but not its dependency*. Graylog computes this via `EntityDependencyResolver` + `EntityDependencyPermissionChecker`. The share still applies — Graylog does not block it — but the grantee gets a half-working entity (e.g. a dashboard they can open but whose widgets error).
- `synced_entities` — on apply, `resolveImplicitGrants` (EntitySharesService lines 350–369) propagates the grant to *related* entities via `SyncedEntitiesResolver`. The apply mutates **more entities than the one in the URL**. A tool that reports "shared stream X" while Graylog also re-shared three synced views is under-reporting the blast radius.

**Why it happens:**
The happy path (just `selected_grantee_capabilities` round-trips) works in a demo with no dependencies. `missing_permissions_on_dependencies` is empty for trivial entities, so it is easy to never notice the field exists. `synced_entities` only appears in the apply response, after the fact.

**How to avoid:**
- The dry-run for `share_entity` must always run `prepare` and surface `missing_permissions_on_dependencies` non-empty as a **warning the agent must see** — ideally with the suggested fix ("grantee also needs `view` on index-set <GRN>; share that too or use the generic multi-entity prepare").
- Use `POST /api/authz/shares/entities/prepare` (the generic form with `prepare_request` = list of dependent GRNs) when the agent's intent spans an entity + its dependencies, so the dependency check runs across the whole set.
- The apply result's `synced_entities` must be echoed in the tool's success output: "also updated shares on: …". Do not hide it.
- Because synced entities are mutated, the confirmation-token / drift logic (Pitfall 7) must account for them: a drift check on only the primary entity misses synced-entity changes.

**Warning signs:**
- The tool's prepare-response parser only reads `selected_grantee_capabilities` / `active_shares`.
- Dry-run output has no "dependencies" section.
- Apply success message names exactly one entity.

**Phase to address:**
Core-sharing phase for the primary-entity dependency warning; a follow-up phase (or the dashboard/saved-search generalization phase) for the multi-entity generic-prepare flow, since dashboards are the entities with the richest dependency graphs.

---

### Pitfall 5: Capability enum mistakes (`view` / `manage` / `own`)

**What goes wrong:**
The `Capability` enum (`Capability.java`) has exactly three values, serialized lowercase: `view`, `manage`, `own`. Mistakes:
- **Wrong casing / wrong tokens** — `View`, `READ`, `read`, `edit`, `admin`, `write` are all invalid. Jackson will reject an unknown enum value → HTTP 400. `read`/`write`/`edit` are intuitive but wrong.
- **Severity confusion** — the priority order is `view`(1) < `manage`(2) < `own`(3). `manage` lets a grantee edit *and re-share* the entity; `own` additionally lets them delete it and remove other owners. An agent asked to "give Bob access to look at the stream" that picks `manage` (or `own`) over-grants — and because `manage` confers re-sharing, Bob can then widen access further. Over-granting is a silent privilege escalation, not an error.
- **`own` and the ownerless guard** — granting `own` is fine; *downgrading* the last `own` to `manage` trips the Pitfall 3 guard.
- **Capabilities are not the same as RBAC roles** — a capability is per-entity (a grant); a role is a global permission bundle. Confusing "give manage capability" with "assign a role" produces the wrong tool call entirely.

**Why it happens:**
"view/manage/own" is a Graylog-specific vocabulary; CRUD/RBAC intuition supplies `read`/`write`/`edit`/`admin`. The agent will reach for the least-surprising word. Severity ordering is undocumented at the API surface — you only see it in the enum's `priority` field.

**How to avoid:**
- `zod` enum pinned to exactly `['view','manage','own']`, lowercase, with a refusal message that lists the three and rejects synonyms explicitly (map common wrong inputs — `read`→`view`, `edit`/`write`→`manage`, `admin`→`own` — to a hint, but still require the caller to confirm rather than silently coercing).
- Default to the **least** privilege: if the intent is ambiguous ("give access"), the tool should choose `view` and say so in the dry-run, never `manage`/`own`.
- The dry-run must spell out what each chosen capability allows in plain language ("`manage` — grantee can edit AND re-share this stream to others").
- Optionally cross-check against the live `available_capabilities` list in the `prepare` response rather than hardcoding — it is authoritative for the running version.
- Keep capability-grant tooling and role-assignment tooling clearly separated in naming so the agent does not conflate them.

**Warning signs:**
- The capability schema is `z.string()` rather than a 3-value enum.
- The tool silently maps `read`→`view` without telling the caller.
- Dry-run shows the capability token but not its meaning.
- Default capability is `manage` or `own`.

**Phase to address:**
Core-sharing phase — part of the `share_entity` input schema. Trivial to get right if done at schema-definition time, expensive to retrofit after the agent has learned the wrong vocabulary.

---

### Pitfall 6: 7.0.6-vs-7.2 divergence in the authz API surface

**What goes wrong:**
The local source clone is **7.2.0-SNAPSHOT**; the ship + test target is **7.0.6**. Everything in this document is read from 7.2 source. Known and suspected divergence points:
- The brief's `PUT /api/authz/shares/{grn}` may be a real 7.0.x path that was restructured to `POST /api/authz/shares/entities/{entityGRN}` later — or the brief may simply be inaccurate. **Unverified against 7.0.6.** This must be confirmed against the live instance's actual Swagger/`api-browser` before any handler is written.
- `EntityShareResponse` fields may differ: `synced_entities` and the `SyncedEntitiesResolver` machinery look comparatively recent; a 7.0.6 response may omit `synced_entities` entirely. A tool that assumes the field exists will throw on undefined access.
- The GRN type set may be smaller in 7.0.6 (`report`, `search_filter`, `last_opened`, `favorite` are plausible later additions). Pinning the `zod` enum to the 7.2 list could *accept* a type the live server rejects.
- `available_capabilities` is computed server-side — trust the live `prepare` response over any hardcoded 7.2 assumption.
- Role endpoints: two coexisting surfaces (`/authz/roles` and legacy `/roles`) — their relative completeness in 7.0.6 is unverified.

**Why it happens:**
Reading source is faster than hitting the live instance, and the source is two minors ahead. v3.0.0's own deferred list already records one such drift ("IndexRangesUpdateJob" conceptual vs the real 7.0.6 class name).

**How to avoid:**
- **Per the project's own Key Decision: live 7.0.6 behaviour wins on every divergence.** Before writing any authz handler, capture the live instance's API browser / Swagger for `/authz/shares` and `/authz/roles`, and a real `prepare` response from a throwaway entity, as fixtures.
- Treat every `EntityShareResponse` field as optional in the parser (`zod` `.optional()` / `.passthrough()`), defensively defaulting `synced_entities`/`missing_permissions_on_dependencies` to empty.
- Source the GRN type enum and capability enum from a live probe where feasible, or at minimum gate them behind a "verified against 7.0.6" checklist item.
- Do not branch on version — single target — but DO write a smoke test that asserts the live 7.0.6 endpoint paths and response shape, so a wrong assumption fails fast and loudly.

**Warning signs:**
- Handler code cites a 7.2-source line as authority for a path or field with no live confirmation.
- The parser requires `synced_entities`.
- No captured 7.0.6 `prepare`/apply fixture exists.

**Phase to address:**
Foundation phase — a live-API reconnaissance task must precede handler implementation. Make "7.0.6 endpoint shape captured as fixture" an explicit Phase 0 acceptance criterion.

---

### Pitfall 7: Drift between prepare/preview and apply (TOCTOU)

**What goes wrong:**
Between the `prepare`/dry-run and the `apply`, another admin (or the web UI, or a synced-entity update) changes the entity's grants. Because apply is full-set replacement (Pitfall 1), the agent's merged set was computed from a *stale* `active_shares`. Concretely: dry-run reads grants {Alice:own, Carol:view}, agent merges in {Bob:view} → submits {Alice:own, Carol:view, Bob:view}. Meanwhile another admin adds {Dave:manage}. The apply submits the 3-entry set, which **deletes Dave's brand-new grant** — a silent revocation of a change made seconds ago. This is exactly the TOCTOU class v3.0.0's cascade-hash primitive (`src/tools/_shared/cascade-hash.js`) was built to defend against.

**Why it happens:**
The replacement semantics turn any stale read into a destructive write. The shares endpoint has no optimistic-concurrency token (no ETag/version). A dry-run that produced a confirmation token over only the *delta* (not the full resulting set, and not the precondition state) cannot detect that the precondition changed.

**How to avoid:**
- Reuse the cascade-hash pattern: at dry-run, hash the *current full grant set* of the target entity (and of any `synced_entities`). The confirmation token covers that hash.
- At apply time, re-`prepare`, recompute the hash, and **refuse with a `grants_changed_since_preview` error** if it differs — exactly the `cascade_changed_since_preview` refusal v3.0.0 uses for stream deletes.
- On refusal, return the new `active_shares` so the agent can re-run the dry-run against fresh state.
- Because synced-entity grants change out of band, include them in the hash, or accept that synced entities are best-effort and surface that caveat.
- Keep the prepare→apply window short; do not let a dry-run token be reusable indefinitely.

**Warning signs:**
- The confirmation token is computed over the request delta, not the resulting full set + precondition.
- Apply does not re-read state before writing.
- No `grants_changed_since_preview` style refusal path exists.
- Tests never simulate concurrent modification.

**Phase to address:**
Core-sharing phase — drift refusal is part of the same apply pipeline as Pitfall 1's merge and must ship with it. Directly reuse `src/tools/_shared/cascade-hash.js`.

---

### Pitfall 8: Testing entity-sharing against a LIVE production Graylog

**What goes wrong:**
The `test` connection is real production UNESCO infrastructure (per project memory: *"the test connection is live production Graylog, not a sandbox"*). Sharing tools mutate **who can read production logs**. A careless integration test can:
- Grant a real user (or `builtin-team:everyone`) `view`/`manage`/`own` on a real production stream — actual exposure of production log data.
- Trip Pitfall 1 and **revoke** a real production user's legitimate access mid-test.
- Leave orphan grants behind if a test fails between create and cleanup.
- Send real audit events / notifications to real admins.

**Why it happens:**
v3.0.0 already deferred 8 live-mutation tests to manual UAT for exactly this reason. Sharing is higher-blast-radius than any v3.0.0 domain because the failure mode is *data exposure*, not config breakage. The temptation is to "just test against the real streams" because they are there.

**How to avoid:**
- **Default every test to `dryRun: true`.** The vast majority of sharing logic — GRN construction, capability validation, merge logic, diff rendering, `validation_result` parsing, drift detection — is exercised entirely by `prepare` (`@NoAuditEvent`, non-mutating) plus unit tests over captured fixtures. No real grant needs to be written to test the read-merge-write contract.
- For the unavoidable apply-path tests: create a **throwaway entity** (a disposable stream the test itself creates and deletes) and share it only with a **dedicated non-human test user / test team** created for this purpose — never a real user, never `everyone`, never a real production stream.
- Wrap every live mutation test in setup/teardown that asserts cleanup; on any failure, the teardown must still revoke. Prefer the existing `_testConnection` magic-arg pattern and fixture-replay so most tests never touch the network.
- Capture real `prepare` responses once, as fixtures, and run the bulk of the suite offline against them.
- Follow v3.0.0 precedent: classify real apply-against-production as **HUMAN-UAT**, gated behind explicit consent, not part of `npm test`.
- Never use `builtin-team:everyone` as a grantee in any automated test under any circumstance.

**Warning signs:**
- An integration test references a real production stream ID.
- A test grants to a real username or to `everyone`.
- `dryRun: false` appears in a test that is not explicitly a gated UAT.
- No teardown, or teardown that is skipped on failure.

**Phase to address:**
Every phase — but the testing strategy (fixture capture, throwaway-entity harness, dedicated test user/team) must be established in the Foundation phase before the first apply handler exists, and re-asserted as a gate in the final hardening phase.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `share_entity` takes a full grant array instead of read-merge-write | Simpler tool, one HTTP call | Every caller must remember to include all existing grants or silently revoke them (Pitfall 1) | Never — the merge is the whole point of the tool |
| Hardcode GRN type / capability enums from 7.2 source | No live probe needed | Accepts types/values the live 7.0.6 server rejects, or rejects valid ones (Pitfall 6) | Only with a "verified against 7.0.6" checklist item closed |
| Confirmation token over the request delta only | Less to hash | Misses out-of-band grant changes; TOCTOU revocation (Pitfall 7) | Never |
| Skip `validation_result` / `missing_permissions_on_dependencies` parsing | Smaller response model | Reports false success; leaves grantees with half-working entities (Pitfalls 3, 4) | Never |
| Accept username as grantee and interpolate into a user GRN | No user-lookup call | Grants against non-existent grantees; silent no-ops (Pitfall 2) | Never — always resolve to userId first |
| Test apply paths against real production streams | Real coverage fast | Production log exposure / real revocations (Pitfall 8) | Never — throwaway entity + test user only, gated UAT |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `POST /authz/shares/entities/{grn}` | Treating it as additive (REST POST intuition) | It is full-set replacement; read-merge-write always (Pitfall 1) |
| `share_entity` path/method | Using brief's `PUT /api/authz/shares/{grn}` | Source shows `POST /api/authz/shares/entities/{entityGRN}`; verify live 7.0.6 first (Pitfall 6) |
| Grantee identity | Using login name in a `user:` GRN | `grn::::user:<userId>` uses the Mongo ObjectId; resolve username→id first (Pitfall 2) |
| Saved-search GRN type | `saved_search` / `saved-search` | The type is `search` (Pitfall 2) |
| Event-notification GRN type | `event_notification` | The GRN type is `notification` (Pitfall 2) |
| "Everyone" grantee | `team:everyone` / `everyone` | `grn::::builtin-team:everyone` (Pitfall 2) |
| Role assignment | Expecting `/authz/roles` to create roles | `/authz/roles` only **lists/assigns** (`PUT {roleId}/assignees` adds usernames, additive); role *creation* is the legacy `POST /roles` keyed by **rolename** (Pitfall 5 / scope note) |
| Apply response on validation failure | Throwing on HTTP 400 | 400 carries the full `EntityShareResponse` with `validation_result`; parse the body (Pitfall 3) |
| Sharing permission | Assuming admin role suffices | `checkOwnership` requires `ENTITY_OWN` on the target → 403 otherwise (Pitfall 3) |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Blind full-set write drops other users' grants | Silent revocation of legitimate access to production logs | Read-merge-write + removed-grants diff in dry-run (Pitfall 1) |
| Over-granting `manage`/`own` when `view` was intended | `manage` confers re-sharing → privilege escalation chain | Default to `view`; spell out capability meaning in dry-run (Pitfall 5) |
| Granting to `builtin-team:everyone` | Exposes a production stream to every Graylog user | Treat `everyone` as a grantee requiring an explicit, separate confirmation; never in tests (Pitfalls 2, 8) |
| Ignoring `missing_permissions_on_dependencies` | Grantee sees an entity but not its index set / backing search → confusing partial access, or info leak via error messages | Surface dependency gaps as blocking warnings (Pitfall 4) |
| Reusing a stale dry-run token after concurrent change | TOCTOU revocation of another admin's just-made grant | Re-prepare + hash compare + `grants_changed_since_preview` refusal (Pitfall 7) |
| Testing apply paths on real production entities | Real data exposure / real revocation incidents | Throwaway entity + dedicated test user, dryRun-default, gated UAT (Pitfall 8) |
| Logging full GRNs / grant maps at info level | Audit-trail leakage of who-can-see-what | Keep grant detail to dry-run output; minimal `console.error` for failures only |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Tool reports "shared with Bob" but silently revoked Alice | Operator trusts a false success; access loss discovered later | Dry-run + success output both diff added/removed grants explicitly (Pitfall 1) |
| `view`/`manage`/`own` shown as opaque tokens | Operator/agent cannot judge whether the grant is too broad | Render plain-language meaning of each capability in dry-run (Pitfall 5) |
| Dependency warnings buried or omitted | Grantee gets a half-working dashboard; operator blamed | Surface `missing_permissions_on_dependencies` as a prominent warning with a fix suggestion (Pitfall 4) |
| `synced_entities` not mentioned | Operator unaware that 3 other entities were re-shared | Echo every synced entity in the success message (Pitfall 4) |

## "Looks Done But Isn't" Checklist

- [ ] **`share_entity`:** Often missing the read-merge step — verify a test proves a *pre-existing* grant survives an add.
- [ ] **`share_entity`:** Often missing the removed-grants diff — verify dry-run output lists "grants that would be removed."
- [ ] **GRN abstraction:** Often missing rejection of unknown types — verify `saved_search`, `event_notification`, `team` are rejected client-side with a helpful message.
- [ ] **GRN abstraction:** Often missing username→userId resolution — verify a username input does not silently become a bad GRN.
- [ ] **Capability schema:** Often a bare string — verify it is a 3-value enum and `read`/`edit`/`admin` are rejected.
- [ ] **Apply path:** Often only handles 2xx — verify HTTP 400 with a `validation_result` body is parsed, not thrown away.
- [ ] **Ownerless guard:** Often untested — verify a request that drops the last `own` is refused with the server's message surfaced.
- [ ] **Dependency notices:** Often dropped — verify `missing_permissions_on_dependencies` non-empty produces a visible warning.
- [ ] **Synced entities:** Often unreported — verify apply success names every entity in `synced_entities`, not just the URL target.
- [ ] **Drift refusal:** Often missing — verify a `grants_changed_since_preview` path exists and a concurrent-modification test exercises it.
- [ ] **403 handling:** Often generic — verify a non-owner share attempt yields an ownership-specific message.
- [ ] **Live-version shape:** Often assumed from 7.2 source — verify a captured 7.0.6 `prepare`/apply fixture exists and a smoke test asserts the path.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Pitfall 1 — revoked others' grants | MEDIUM | Re-`prepare` to read survivors; reconstruct lost grants from audit log (`EntitySharesUpdateEvent` records deletes) or admin memory; re-apply the corrected full set. Audit log is the canonical recovery source. |
| Pitfall 2 — malformed GRN | LOW | Server 400 means nothing was written; fix the GRN and retry. A *valid-but-wrong* GRN that wrote a grant requires a corrective full-set apply. |
| Pitfall 3 — self-lockout (lost own) | HIGH | If the entity is now ownerless, only a server-admin can re-grant ownership (the validation guard normally prevents this; an already-ownerless entity bypasses it). Escalate to a Graylog superadmin. |
| Pitfall 4 — missed dependency | LOW | Run the generic multi-entity prepare, then share the missing dependency GRN with the same grantee. |
| Pitfall 7 — TOCTOU revocation | MEDIUM | Same as Pitfall 1 — reconstruct the clobbered grant from the audit log and re-apply. |
| Pitfall 8 — production exposure | HIGH | Immediately re-`prepare` and apply a corrected set removing the unintended grantee; review the audit log for the exposure window; report per the org's data-handling policy. |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1 — grant-set replacement | Core-sharing (the headline structural defense) | Test: adding a grant preserves all pre-existing grants; dry-run lists removed grants |
| 2 — GRN malformation | Foundation (GRN abstraction) | Unit tests: unknown types rejected; username resolved to userId; 6-token structure enforced |
| 3 — self-lockout / ownerless | Core-sharing | Test: dropping last `own` is refused; 403 on non-owned entity yields ownership-specific error |
| 4 — dependency notices | Core-sharing (primary) + generalization phase (multi-entity) | Test: `missing_permissions_on_dependencies` surfaced; `synced_entities` echoed in success |
| 5 — capability enum | Core-sharing (input schema) | Test: only `view`/`manage`/`own` accepted; default is `view`; meanings shown in dry-run |
| 6 — 7.0.6-vs-7.2 divergence | Foundation (live-API recon task) | Captured 7.0.6 fixture exists; smoke test asserts live endpoint path + response shape |
| 7 — prepare/apply drift | Core-sharing (apply pipeline) | Test: simulated concurrent change triggers `grants_changed_since_preview` refusal |
| 8 — live-production testing | Foundation (harness) + final hardening (re-assert gate) | No test references a real stream/user; apply tests use throwaway entity + test user; `dryRun:false` only in gated UAT |

## Sources

- `source-code/graylog2-server/.../security/rest/EntitySharesResource.java` (7.2.0-SNAPSHOT) — endpoint paths, methods, `checkOwnership`, 400-on-validation-failure — HIGH
- `source-code/graylog2-server/.../security/shares/EntitySharesService.java` — full-set replacement semantics (lines 312–331), ownerless validation (397–446), synced-entity propagation (350–369), `getForTargetExcludingGrantee` self-grant exclusion — HIGH
- `source-code/graylog2-server/.../security/shares/EntityShareRequest.java` / `EntityShareResponse.java` — request/response shape, `missing_permissions_on_dependencies`, `synced_entities`, `validation_result` — HIGH
- `source-code/graylog2-server/.../security/Capability.java` — exact enum `view`/`manage`/`own` + priority ordering — HIGH
- `source-code/graylog2-server/.../grn/GRN.java`, `GRNTypes.java`, `GRNRegistry.java` — GRN structure, valid type set, parse-failure behavior — HIGH
- `source-code/graylog2-server/.../security/authzroles/AuthzRolesResource.java` and `.../rest/resources/roles/RolesResource.java` — two coexisting role surfaces; `/authz/roles` assigns by username, legacy `/roles` creates by rolename — HIGH
- `.planning/PROJECT.md`, `.planning/MILESTONES.md` — v3.0.0 mitigation library (C1–C7, cascade-hash primitive, dry-run + confirmation-token discipline), live-7.0.6 test constraint — HIGH
- Project memory: `test` connection is live production UNESCO Graylog — HIGH
- **Divergence caveat:** all source above is 7.2.0-SNAPSHOT, two minors ahead of the 7.0.6 ship target; every path/field claim is LOW confidence until verified against the live instance — see Pitfall 6.

---
*Pitfalls research for: entity-sharing / authz tooling — Graylog MCP v3.1.0*
*Researched: 2026-05-19*
