# Multi-project pipeline inventory (operator-only)

Snapshot for the kensaurus linked-host pipeline remediation (Jun 2026). **No secrets** — record key *labels* and scopes in the Mushi admin console, not raw values.

## Projects

| Project | UUID | Host repo | Ingest env var |
|---------|------|-----------|----------------|
| yen-yen | `6e7e0c3a-a777-4f1e-a699-6515993cf3bd` | kensaurus/yen-yen | `EXPO_PUBLIC_MUSHI_API_KEY` |
| glot.it | `542b34e0-019e-41fe-b900-7b637717bb86` | kensaurus/glot.it | `NEXT_PUBLIC_MUSHI_API_KEY` |
| the-wanting-mind | `2ac49170-e89a-4d82-a982-bcbda1d3244d` | kensaurus/the-wanting-mind | `VITE_MUSHI_API_KEY` |
| help-her-take-photo | `e4523271-f609-465f-8b27-00199b39f050` | kensaurus/help-her-take-photo | `EXPO_PUBLIC_MUSHI_API_KEY` |

API base: `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api`

## Per-project key matrix (mint in Console → Projects → API Keys)

| Label pattern | Scopes | Used by |
|---------------|--------|---------|
| `{slug}-sdk-ingest` | `report:write` | Mobile/PWA bundle env (never MCP) |
| `{slug}-mcp-dev` | `mcp:read`, `mcp:write` | Cursor MCP / CLI dispatch |
| `{slug}-ci-smoke` (optional) | `report:write` | `scripts/verify-pipeline-reports.mjs` |

**Do not rotate** production ingest keys unless broken — mint additive keys alongside existing ones.

## Identity secret (signed reporter)

| Host | Edge function | Mushi Vault |
|------|---------------|-------------|
| yen-yen | `mushi-identity-token` | Projects → Signed identity |
| glot.it | `glot-mushi-identity-token` | same |
| TWM / HHTP | verify in repo | same |

Align with `scripts/sync-host-identity-secret.mjs` — host `MUSHI_IDENTITY_SECRET` must match Mushi Vault.

yen-yen: prefer edge secret `MUSHI_IDENTITY_SECRET` over `private.mushi_identity_config` (env wins).

## Audit reports (yen-yen, Jun 2026)

| Report ID | Category | Notes |
|-----------|----------|-------|
| `789e91e9-41df-4970-b49e-b43dbb45729f` | bug | dev-android Metro cwd — fixed PR #79 |
| `2dc4863b-966e-4404-a41a-a4ad960abe55` | slow | cold-start ANR |
| `1296925e-bf2d-4f1e-bc71-80330cc4c1be` | visual | banner CTA tap target |

## diagnose_setup (all four projects)

All four projects report **ready** for ingest + dispatch when probed with service credentials (Jun 2026 audit).

## Known gaps (pre-remediation)

- Global `.cursor/mcp.json` pointed at wrong `MUSHI_PROJECT_ID` (mushi-mushi default, not yen-yen).
- Ingest keys lacked `mcp:write` → dispatch returned `INSUFFICIENT_SCOPE`.
- Console report detail 404 when header project ≠ report project (fixed in API 1A + admin scoping).
- Org-scoped MCP keys returned empty project lists (fixed in 1B).
- Identity secret divergence between host edge fn and Mushi Vault.

## Verification commands

```bash
# Ingest smoke (all four projects)
node scripts/verify-pipeline-reports.mjs

# API scope unit tests
cd packages/server && deno test supabase/functions/api/__tests__/api-key-scope.test.ts

# Admin report detail navigation (Playwright, local admin)
cd examples/e2e-dogfood && npx playwright test pipeline-closed-loop.spec.ts
```

## Rollout order

1. Deploy `api` edge function (detail auth + org-scoped keys).
2. Deploy admin console (project URL scoping).
3. Publish `@mushi-mushi/mcp` + `@mushi-mushi/react-native` patches.
4. Mint per-project keys; update per-repo `.cursor/mcp.json`.
5. Sync identity secrets to host Supabase edge functions.
6. Bump host SDK versions where native keys must be rebaked.
