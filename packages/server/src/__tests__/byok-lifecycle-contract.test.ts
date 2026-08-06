/**
 * Contract guard for the validated BYOK lifecycle across API, runtime resolver,
 * and admin console. Provider classification itself is tested in the Deno
 * byok-validation suite; this file prevents the three surfaces drifting apart.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(
  resolve(__dirname, '../../supabase/functions/api/routes/settings-research.ts'),
  'utf8',
);
const resolver = readFileSync(
  resolve(__dirname, '../../supabase/functions/_shared/byok.ts'),
  'utf8',
);
const failover = readFileSync(
  resolve(__dirname, '../../supabase/functions/_shared/llm-failover.ts'),
  'utf8',
);
const firecrawl = readFileSync(
  resolve(__dirname, '../../supabase/functions/_shared/firecrawl.ts'),
  'utf8',
);
const lastUsedMigration = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20260806052917_add_byok_key_last_used_at.sql'),
  'utf8',
);
const panel = readFileSync(
  resolve(__dirname, '../../../../apps/admin/src/components/settings/ByokPanel.tsx'),
  'utf8',
);
const poolModel = readFileSync(
  resolve(__dirname, '../../../../apps/admin/src/components/settings/byokPool.ts'),
  'utf8',
);
const firecrawlPanel = readFileSync(
  resolve(__dirname, '../../../../apps/admin/src/components/settings/FirecrawlPanel.tsx'),
  'utf8',
);
const browserbasePanel = readFileSync(
  resolve(__dirname, '../../../../apps/admin/src/components/settings/BrowserbasePanel.tsx'),
  'utf8',
);
const hostedManifest = readFileSync(
  resolve(__dirname, '../../supabase/functions/_shared/mcp-hosted-tool-manifest.json'),
  'utf8',
);
const cliKeys = readFileSync(
  resolve(__dirname, '../../../../packages/cli/src/commands/keys.ts'),
  'utf8',
);

describe('validated BYOK lifecycle contract', () => {
  it('quarantines new keys and persists the provider probe before returning', () => {
    expect(route).toContain('createByokKeySchema.safeParse');
    expect(route).toContain("status: 'pending_validation'");
    expect(route).toContain('const probe = await probeByokKey(');
    expect(route).toMatch(
      /test_status:\s*probe\.status[\s\S]{0,180}last_tested_at:\s*now[\s\S]{0,180}last_error:/,
    );
  });

  it('requires a successful per-key test before manual activation', () => {
    expect(route).toMatch(/app\.post\(\s*'\/v1\/admin\/byok\/keys\/:keyId\/test'/);
    expect(route).toContain("if (current.test_status !== 'ok')");
    expect(route).toContain("code: 'KEY_NOT_VALIDATED'");
  });

  it('resolves only verified pooled and legacy keys', () => {
    expect(resolver).toContain(".in('test_status', ['ok', 'error_quota'])");
    expect(resolver).toContain("if (ref && testStatus === 'ok')");
    expect(resolver).toContain('validateOpenAiBaseUrl(row.base_url');
    expect(resolver).toMatch(
      /function reactivateKey[\s\S]+status:\s*'active',[\s\S]+test_status:\s*'ok',[\s\S]+last_error:\s*null/,
    );
  });

  it('keeps pooled keys authoritative for research readiness and API-key lifecycle clients', () => {
    expect(route).toContain(".eq('provider_slug', 'firecrawl')");
    expect(route).toContain('poolRows.find((row) => isRunnableByokPoolState(row))');
    expect(route).toContain('firecrawlKeyHint: firecrawlKeyHint || null');
    expect(route).toMatch(
      /app\.patch\(\s*'\/v1\/admin\/byok\/keys\/:keyId',\s*adminOrApiKey\(\{ scope: 'mcp:write' \}\)/,
    );
    expect(route).toMatch(
      /app\.delete\(\s*'\/v1\/admin\/byok\/keys\/:keyId',\s*adminOrApiKey\(\{ scope: 'mcp:write' \}\)/,
    );
    expect(route).toMatch(
      /app\.get\(\s*'\/v1\/admin\/byok\/health',\s*adminOrApiKey\(\{ scope: 'mcp:read' \}\)/,
    );
  });

  it('exposes validation and retest states in the admin console', () => {
    expect(poolModel).toContain("'pending_validation'");
    expect(panel).toContain('Save &amp; validate');
    expect(panel).toContain("/test`, { method: 'POST' }");
    expect(panel).toContain("k.test_status === 'ok'");
    expect(panel).toContain('Test first');
  });

  it('keeps dedicated Firecrawl and Browserbase panels on the pooled lifecycle with legacy fallback', () => {
    for (const source of [firecrawlPanel, browserbasePanel]) {
      expect(source).toContain("'/v1/admin/byok/keys'");
      expect(source).toContain('/v1/admin/byok/keys/${poolKey.id}/test');
      expect(source).toContain('/v1/admin/byok/keys/${poolKey.id}');
      expect(source).toContain('legacy BYOK');
    }
    expect(panel).toContain("'firecrawl', 'browserbase'");
  });

  it('surfaces legacy credential metadata wherever pooled keys are listed', () => {
    expect(route).toContain('legacyKeys');
    expect(route).toContain('id: `legacy:${provider}`');
    expect(panel).toContain('legacy credential');
    expect(panel).toContain('isLegacyKey');
    expect(cliKeys).toContain('res.data.legacyKeys ?? []');
    expect(cliKeys).toContain('manage in the console');
  });

  it('revalidates OpenAI destinations on retest and keeps hosted tools unique', () => {
    expect(route).toMatch(
      /app\.post\(\s*'\/v1\/admin\/byok\/keys\/:keyId\/test'[\s\S]+validateOpenAiBaseUrl\([\s\S]+INVALID_BASE_URL/,
    );
    for (const tool of ['list_byok_keys', 'add_byok_key', 'test_byok_key', 'remove_byok_key']) {
      expect(hostedManifest.match(new RegExp(`"${tool}"\\s*:`, 'g'))).toHaveLength(1);
    }
  });

  it('does not expose raw Vault diagnostics when secure storage fails', () => {
    expect(route).toContain("message: 'The credential could not be stored securely.'");
    expect(route).toContain('code: vaultErr.code');
    expect(route).not.toMatch(
      /code:\s*'VAULT_WRITE_FAILED'[\s\S]{0,120}message:\s*vaultErr\.message/,
    );
  });

  it('tracks use only after a successful provider call', () => {
    expect(lastUsedMigration).toContain('add column if not exists last_used_at timestamptz');
    expect(resolver).toContain('.update({ last_used_at: usedAt })');
    expect(resolver).not.toContain('void recordUsage(');
    const singleResolver = resolver.slice(
      resolver.indexOf('export async function resolveLlmKey('),
      resolver.indexOf('export async function resolveLlmKeys('),
    );
    expect(singleResolver).not.toContain('markKeyUsed(');
    expect(failover).toContain('markKeyUsed(db, projectId, provider, candidate.keyId)');
    expect(firecrawl).toContain("markKeyUsed(db, projectId, 'firecrawl', resolved.keyId)");
  });
});
