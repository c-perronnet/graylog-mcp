# 08 — AuthZ Live-Production Test Strategy

Authoritative test contract for the entity-sharing (authz) surface. Phases 9, 10, and 11
link this document. It exists so that no apply-path handler is written before the rules
for testing against live production are fixed.

## 1. dryRun is the default for every authz tool

Every mutating authz tool MUST default to `dryRun: true` (project safety constraint —
`CLAUDE.md`). A grant is applied only when the caller passes an explicit `dryRun: false`.
Applying without an explicit `dryRun: false` is a bug. Every authz test that does not set
`dryRun: false` exercises the preview path only and mutates nothing.

## 2. The only Phase 8 live call: empty-body `POST .../prepare`

The single live network call made in Phase 8 is the recon probe
`scripts/capture-authz-prepare-fixture.js`:

```
POST /api/authz/shares/entities/{URL-encoded-GRN}/prepare
body: {}
```

`/prepare` is `@NoAuditEvent` on the Graylog side — it computes the share preview and
mutates nothing. An empty `{}` body is a pure read of the current grants. This is safe to
run against the live UNESCO production `test` instance (which is NOT a sandbox — see
project memory). The probe asserts its own request path ends in `/prepare` and exits
non-zero otherwise.

The commit endpoint `POST /api/authz/shares/entities/{GRN}` (no `/prepare`) is **forbidden
in Phase 8** and appears nowhere in this phase. It is first used in Phase 10.

## 3. Corrected endpoint — verified live, brief recorded WRONG

The verified entity-sharing surface, confirmed against the live 7.0.6 `test` instance
(HTTP 200 capture, `2026-05-19`):

| Operation | Verified endpoint |
|-----------|-------------------|
| Preview a share (`@NoAuditEvent`, read) | `POST /api/authz/shares/entities/{entityGRN}/prepare` |
| Commit a share (Phase 10 only) | `POST /api/authz/shares/entities/{entityGRN}` |

The milestone brief's `PUT /api/authz/shares/{grn}` is **WRONG** — recorded here so Phase 9/10
do not regress to it. The resource is `.../entities/{GRN}`, the verb is `POST`, and the
preview is the same path plus a `/prepare` suffix.

## 4. GRN URL-path encoding is mandatory

A GRN (`grn::::stream:6a08...`) contains literal colons. When interpolated into a request
path it MUST be `encodeURIComponent`-encoded (colons → `%3A`); an unencoded colon
mis-routes the Graylog JAX-RS router (Pitfall 4). Every authz request path that embeds a
GRN encodes it. Example verified live:

```
POST /api/authz/shares/entities/grn%3A%3A%3A%3Astream%3A6a0899bc670fc246e77ca54e/prepare
```

## 5. Apply-path tests in Phase 10+ — throwaway disposable entity only

Any unavoidable apply-path test (one that passes `dryRun: false`) MUST:

- create a **throwaway disposable entity** the test itself creates and deletes
  (e.g. a temp stream), never a real production stream;
- share it ONLY with a **dedicated non-human test user/role** created for the test;
- **NEVER** share with a real user, **NEVER** with `grn::::builtin-team:everyone`,
  **NEVER** target a real production stream/dashboard/search.

This is Pitfall 8 — testing entity-sharing against live production must not touch a real
grantee or a real entity.

## 6. Real apply-against-production is HUMAN-UAT only

Applying a real grant against the live production instance is a gated, human-driven UAT
step. It is **NOT** part of `npm test`. `npm test` stays fully offline for authz —
fixture-shape tests load the committed `prepare-response-7.0.6.json` and make no network
call.

## 7. `synced_entities` is PRESENT in 7.0.6 — Phase 9 open question resolved

The captured live 7.0.6 `EntityShareResponse` (`test/fixtures/authz/prepare-response-7.0.6.json`)
**contains `synced_entities`** (an empty array on the probed stream). Phase 9's open
question — whether 7.0.6 omits the 7.2-source field — is resolved: **present, not absent.**

Top-level keys observed in the live 7.0.6 response:

```
_provenance, entity, sharing_user, available_grantees, available_capabilities,
active_shares, selected_grantee_capabilities, missing_permissions_on_dependencies,
synced_entities, validation_result
```

`available_capabilities` ids = `view`, `manage`, `own` — matching the `Capability` enum
from Plan 08-01.

Despite `synced_entities` being present here, Phase 9 MUST still model fields that may vary
across builds with zod `.optional()` and treat any absent field defensively — the offline
fixture-shape test (`test/authz-grn.test.js`) deliberately asserts `synced_entities` as
optional so a future 7.x build that drops it does not break the suite.
