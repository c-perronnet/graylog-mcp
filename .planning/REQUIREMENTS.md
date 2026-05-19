# Requirements: Graylog MCP — v3.1.0 AuthZ & Sharing

**Defined:** 2026-05-19
**Core Value:** An AI agent can configure Graylog from intent alone, safely, without touching the web UI.

## v1 Requirements

Requirements for the v3.1.0 milestone. Each maps to a roadmap phase.

### Entity Sharing

- [ ] **SHARE-01**: Agent can grant a user view/manage/own access to a stream via `share_entity`
- [ ] **SHARE-02**: Agent can read an entity's current grants (active shares) via `get_entity_shares`
- [ ] **SHARE-03**: Agent can revoke a user's access to an entity
- [ ] **SHARE-04**: `share_entity` accepts a username and resolves it to the user-GRN the Graylog API requires
- [ ] **SHARE-05**: `share_entity` is read-merge-write — adding a grantee never silently revokes other grantees' existing grants
- [ ] **SHARE-06**: `share_entity` surfaces Graylog's `validation_result` and `missing_permissions_on_dependencies` as structured output, not raw errors
- [ ] **SHARE-07**: Agent can share a dashboard via `share_entity`
- [ ] **SHARE-08**: Agent can share a saved search via `share_entity`
- [ ] **SHARE-09**: Agent can list the grantees available for sharing an entity via `list_grantees`

### Role Management

- [ ] **ROLE-01**: Agent can list all roles and read a role's permissions via `list_roles`
- [ ] **ROLE-02**: Agent can create a custom role with a permission set via `create_role`
- [ ] **ROLE-03**: Agent can update a custom role's permissions and description via `update_role`
- [ ] **ROLE-04**: Agent can delete a custom role via `delete_role`
- [ ] **ROLE-05**: Agent can assign a user to a role via `assign_role`
- [ ] **ROLE-06**: Agent can unassign a user from a role via `unassign_role`
- [ ] **ROLE-07**: Role mutation tools refuse to modify the read-only built-in roles (Admin, Reader) with a clear client-side error

### Safety & Verification

- [ ] **AUTHZ-01**: Every mutating authz tool (`share_entity`, `create_role`, `update_role`, `delete_role`, `assign_role`, `unassign_role`) defaults to `dryRun: true`, returns a sha-256 confirmation token, and refuses apply on drift between preview and apply
- [ ] **AUTHZ-02**: The authz tool surface is verified against the live Graylog 7.0.6 instance before milestone close — correct `POST /api/authz/shares/entities/{entityGRN}` endpoint, GRN URL-encoding, and role endpoints

## v2 Requirements

Deferred to a future release. Tracked but not in the current roadmap.

### Entity Sharing

- **SHARE-V2-01**: Agent can share an entity with a whole team (`grn::::team:<id>`) — Teams are a Graylog Enterprise feature; the OSS 7.0.6 test instance has none, so this cannot be verified live this milestone
- **SHARE-V2-02**: Blueprints set initial grants on entities they create (share-on-create chaining)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| User account CRUD (`create_user` / `delete_user`) | Account lifecycle (passwords, auth backends) is a separate high-risk surface; out of scope per PROJECT.md. Grantee resolution requires the user to pre-exist — a clean `404` otherwise. |
| API-token minting (`POST /api/users/{id}/tokens`) | Minting long-lived secrets from an agent is a security anti-pattern; explicitly out of scope. |
| Direct per-user wildcard-permission editing (`PUT /api/users/{username}/permissions`) | Bypasses both the grant model and roles; produces un-auditable, un-discoverable permission sprawl. Use entity grants or roles instead. |
| Per-grant `DELETE` tool | No such Graylog endpoint exists; the `grant` id is not addressable for deletion. Revoke is done by re-POSTing the grant map without the grantee (SHARE-03). |
| Multi-version GRN / authz handling | PROJECT.md pins Graylog 7.0.6 single-target; the authz surface is identical 7.0.6↔7.2 (verified by git-tag diff). No version branching. |
| Sharing lookup tables / content packs / sidecars | Out of scope per PROJECT.md; widens the GRN-type matrix unnecessarily. GRN-type enum restricted to `stream`, `dashboard`, `search`, `user` this milestone. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SHARE-01 | TBD | Pending |
| SHARE-02 | TBD | Pending |
| SHARE-03 | TBD | Pending |
| SHARE-04 | TBD | Pending |
| SHARE-05 | TBD | Pending |
| SHARE-06 | TBD | Pending |
| SHARE-07 | TBD | Pending |
| SHARE-08 | TBD | Pending |
| SHARE-09 | TBD | Pending |
| ROLE-01 | TBD | Pending |
| ROLE-02 | TBD | Pending |
| ROLE-03 | TBD | Pending |
| ROLE-04 | TBD | Pending |
| ROLE-05 | TBD | Pending |
| ROLE-06 | TBD | Pending |
| ROLE-07 | TBD | Pending |
| AUTHZ-01 | TBD | Pending |
| AUTHZ-02 | TBD | Pending |

**Coverage:**
- v1 requirements: 18 total
- Mapped to phases: 0 (roadmap not yet created)
- Unmapped: 18 ⚠️

---
*Requirements defined: 2026-05-19*
*Last updated: 2026-05-19 after initial definition for milestone v3.1.0*
