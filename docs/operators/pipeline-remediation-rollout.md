# Pipeline remediation rollout checklist

Ordered deploy for the Jun 2026 multi-project pipeline fix. **Backward compatible** — no global key rotation.

## 1. API edge function

```bash
cd packages/server
npx supabase functions deploy api --no-verify-jwt --project-ref dxptnwrhwsqckaftyymj
```

Changes: report detail auth via `canAccessReportProject`, org-scoped `callerProjectIds`, MCP account-overview.

Verify:

```bash
cd packages/server && deno test supabase/functions/api/__tests__/api-key-scope.test.ts
node scripts/verify-pipeline-reports.mjs
```

## 2. Admin console

Deploy admin app (path-filtered CI or manual). Changes: `getActiveProjectIdForApi`, scoped report links, ReportDetailPage project sync.

## 3. npm packages

Publish patch releases:

- `@mushi-mushi/mcp` — `project_id` on `get_report_detail`, `get_fix_context`, `get_fix_timeline`, `triage_issue`
- `@mushi-mushi/react-native` — await reporter token before submit, inbox status labels, optional poll

## 4. Operator config (kensaurus only)

1. Mint `{slug}-mcp-dev` keys per project (Console → API Keys).
2. Copy `.cursor/mcp.json.example` → `.cursor/mcp.json` in each workspace.
3. Run `scripts/sync-host-identity-secret.mjs --project <uuid> --rotate` and set host edge secrets.

## 5. Host repos

- **yen-yen**: banner 44px tap target, `/feedback` pull-to-refresh includes Mushi reports, identity refresh on resume.
- **glot.it / TWM / HHTP**: confirm ingest keys + identity edge fn secrets aligned.

Bump `@mushi-mushi/react-native` / `@mushi-mushi/web` in host `package.json` after npm publish when native keys unchanged.

## 6. E2E verification

```bash
cd examples/e2e-dogfood
npx playwright test pipeline-closed-loop.spec.ts
```

Manual yen-yen scorecard A–L when emulator stable.
