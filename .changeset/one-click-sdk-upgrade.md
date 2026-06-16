---
"@mushi-mushi/core": patch
---

One-click SDK install & upgrade: "Create Upgrade PR" in the Mushi console.

**Backend**
- New `sdk_upgrade_jobs` table tracking upgrade PR jobs (status, pr_url, plan, timestamps; service-role RLS).
- New `sdk-upgrade-worker` edge function: reads connected repo's package.json(s), bumps `@mushi-mushi/*` to latest npm versions via `_shared/sdk-upgrade-plan.ts`, opens a reviewed draft PR via `_shared/github-pr.ts`.
- New `sdk-versions-cron` edge function (daily pg_cron 02:30 UTC): keeps `sdk_versions` catalog fresh by querying the npm registry for every `@mushi-mushi/*` package.
- New `sdk-upgrade` API route (`POST` enqueue + `GET` poll + `GET /stream` SSE) — registered in `api/index.ts`; gated on GitHub connected, with in-flight deduplication.
- `_shared/github-pr.ts`: extracted generic `createPrFromFiles` + branch/commit helpers from `fix-worker` (fix-worker refactored to import, behavior preserved).
- `release.yml`: publish-time `scripts/sync-sdk-versions.mjs` step upserts published package versions into `sdk_versions` after each Changesets publish.

**Frontend (admin console)**
- New `/connect` page (`ConnectPage`): unified "Connect & Update" hub — GitHub → SDK → MCP → CLI → Update center with one-click "Create Upgrade PR".
- `McpInstallButtons` component extracted from `McpPage` and reused in `ConnectPage`.
- `useSdkUpgrade(projectId)` hook: mirrors `useDispatchFix` with POST + SSE stream + poll fallback.
- `SdkUpgradeCTA`: primary "Create Upgrade PR" button when `projectId` is supplied (GitHub connected); copy-cmd CLI fallback always present.
- `SdkUpgradeBanner`: dashboard nudge when active project SDK is outdated/deprecated, linking to `/connect`.
- Nav entry "Connect & Update" added to the Act section in `Layout.tsx`.
