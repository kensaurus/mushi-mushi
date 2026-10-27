/**
 * FILE: packages/server/src/__tests__/integration-settings-org-defaults.test.ts
 * PURPOSE: The org-default read in resolveEffectivePlatformSettings must
 *          select only columns organization_integration_settings has. It
 *          selected `slack_bot_token_ref` (never a column there) from June to
 *          2026-10-26, so PostgREST refused the whole read and no project
 *          ever inherited an org default (GitHub token, Cursor key, Linear);
 *          the only trace was a recurring warn.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { resolveEffectivePlatformSettings } from '../../supabase/functions/_shared/integration-settings.ts';

/** organization_integration_settings columns on production (information_schema, 2026-10-26). */
const ORG_COLUMNS = new Set([
  'organization_id', 'sentry_org_slug', 'sentry_project_slug', 'sentry_auth_token_ref', 'sentry_dsn',
  'sentry_webhook_secret', 'langfuse_host', 'langfuse_public_key_ref', 'langfuse_secret_key_ref',
  'github_repo_url', 'github_default_branch', 'github_installation_token_ref', 'github_webhook_secret',
  'github_deploy_key', 'cursor_api_key_ref', 'cursor_default_model', 'cursor_auto_create_pr',
  'cursor_max_iterations', 'claude_api_key_ref', 'claude_default_model', 'claude_workflow_event',
  'claude_default_branch', 'updated_at', 'linear_api_key_ref', 'linear_access_token_ref',
  'linear_refresh_token_ref', 'linear_workspace_name', 'linear_team_id',
]);

/** Answers like PostgREST: a select naming a missing column is an error, not a partial row. */
function fakeDb() {
  const rows: Record<string, Record<string, unknown>> = {
    project_settings: { cursor_api_key_ref: null },
    projects: { organization_id: 'org1' },
    organization_integration_settings: { cursor_api_key_ref: 'vault://org-cursor', github_installation_token_ref: 'vault://org-gh' },
  };
  return {
    from(table: string) {
      let cols: string[] = [];
      const b = {
        select(s: string) {
          cols = s.split(',').map((c) => c.trim());
          return b;
        },
        eq() {
          return b;
        },
        maybeSingle() {
          const missing = table === 'organization_integration_settings' ? cols.filter((c) => !ORG_COLUMNS.has(c)) : [];
          if (missing.length) {
            return Promise.resolve({ data: null, error: { message: `column organization_integration_settings.${missing[0]} does not exist` } });
          }
          return Promise.resolve({ data: rows[table] ?? null, error: null });
        },
      };
      return b;
    },
  };
}

describe('org integration defaults', () => {
  beforeAll(() => {
    (globalThis as { Deno?: unknown }).Deno ??= { env: { get: () => undefined } };
  });

  it('a project with no key of its own inherits the org default', async () => {
    const r = await resolveEffectivePlatformSettings(fakeDb() as never, 'p1');
    expect(r.organizationId).toBe('org1');
    expect(r.sourceByField.cursor_api_key_ref).toBe('org');
    expect((r.settings as unknown as Record<string, unknown>).github_installation_token_ref).toBe('vault://org-gh');
  });
});
