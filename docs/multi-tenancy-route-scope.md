# Multi-Tenancy Route Scope Matrix

Reference for **which request headers each admin API route honours**. Junior devs should classify new routes here before shipping.

## Scope classes

| Class | Honours `X-Mushi-Org-Id` | Honours `X-Mushi-Project-Id` | Helper |
|-------|--------------------------|------------------------------|--------|
| **global** | No | No | none |
| **org-enumeration** | Yes (fail closed) | **No** | `enumerateAccessibleProjectIds` |
| **project-enumeration** | Optional | **No** | `enumerateAccessibleProjectIds` |
| **project-data** | Optional (intersect) | Yes | `intersectOrgAndProjectScope` / `callerProjectIds` |
| **named-project-resource** | Via resource row | Validate resource `project_id` | `assertTargetProjectAccess` |
| **api-key-bound** | Via bound project | Must match key project | `assertCallerProjectScope` |

## Rules

1. **List/switcher/setup endpoints** must **never** honour `X-Mushi-Project-Id` — use `enumerateAccessibleProjectIds`.
2. **Project data lists** honour both headers and **intersect** them — use `intersectOrgAndProjectScope`.
3. **Named resources** (`GET /…/:id`) validate the row's `project_id`, not only headers.
4. **API keys** are pinned to one project — reject mismatched query/body/header project ids.
5. **Org admin routes** must validate org membership — use `resolveAccessibleOrg`, never raw header trust.

## Route inventory (high traffic)

### org-enumeration / project-enumeration

| Route | Class | Helper |
|-------|-------|--------|
| `GET /v1/admin/projects` | org-enumeration | `enumerateAccessibleProjectIds` |
| `GET /v1/admin/projects/stats` | org-enumeration | `enumerateAccessibleProjectIds` |
| `GET /v1/admin/setup` | org-enumeration | `enumerateAccessibleProjectIds` |
| `GET /v1/admin/mcp/projects` | org-enumeration | `enumerateAccessibleProjectIds` |
| Activation cockpit setup | org-enumeration | `enumerateAccessibleProjectIds` |
| `GET /v1/org` | global | JWT membership query |

### project-data

| Route | Class | Helper |
|-------|-------|--------|
| `GET /v1/admin/reports` | project-data | `intersectOrgAndProjectScope` |
| `GET /v1/admin/dashboard/*` | project-data | `callerProjectIds` / `resolveOwnedProject` |
| `GET /v1/admin/releases` | project-data | `intersectOrgAndProjectScope` |
| `GET /v1/admin/lessons` | project-data | `intersectOrgAndProjectScope` |
| `GET /v1/admin/pdca` | project-data | `intersectOrgAndProjectScope` |
| `GET /v1/admin/skills/pipelines` | project-data | `assertTargetProjectAccess` |

### named-project-resource

| Route | Class | Helper |
|-------|-------|--------|
| `GET /v1/admin/releases/:id` | named-project-resource | `assertTargetProjectAccess(release.project_id)` |
| `PATCH /v1/admin/releases/:id` | named-project-resource | `assertTargetProjectAccess` |
| `GET /v1/admin/lessons/:id` | named-project-resource | `assertTargetProjectAccess` |
| `GET /v1/admin/clusters/:id` | named-project-resource | `assertTargetProjectAccess` |
| `GET /v1/admin/pdca/:id` | named-project-resource | `assertRunAccess` + API key scope |

### org-scoped (membership required)

| Route | Class | Helper |
|-------|-------|--------|
| `GET /v1/admin/rewards/*` | org-scoped | `resolveAccessibleOrg` |
| `PUT /v1/admin/rewards/rules` | org-scoped | `resolveAccessibleOrg` |
| Org members / invites | org-scoped | `loadMembership` |

### api-key-bound

| Route | Class | Helper |
|-------|-------|--------|
| SDK ingest routes | api-key-bound | `c.get('projectId')` |
| MCP read tools | api-key-bound | `assertCallerProjectScope` |
| `GET /v1/sync/lessons` | api-key-bound | bound project only |

## Frontend `apiFetch` scope

| `scope` | Sends org header | Sends project header | Use for |
|---------|------------------|----------------------|---------|
| `'enumeration'` | Yes | **No** | project list, setup, org switcher data |
| `'project'` | Yes | Yes | reports, settings, integrations |
| `'none'` | No | No | public catalog, version endpoints |

## Contract tests

- `packages/server/src/__tests__/project-enumeration-contract.test.ts`
- `packages/server/src/__tests__/project-access-org-scope.test.ts`
- `packages/server/src/__tests__/tenant-route-scope-contract.test.ts`

Tests fail if enumeration routes import `callerProjectIds` or if high-risk routes trust raw org headers.
