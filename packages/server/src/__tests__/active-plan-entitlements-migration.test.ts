/**
 * Guards the active pricing catalog against destructive JSONB replacement.
 *
 * The diagnoses-tier migration replaced the complete feature_flags object and
 * silently removed every previously shipped entitlement. This test reads the
 * repair migration so the database artifact and middleware truth table cannot
 * drift independently again.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    __dirname,
      '../../supabase/migrations/20260806070334_restore_active_plan_entitlements.sql',
  ),
  'utf8',
);

function entitlementBranches(): Map<string, Record<string, unknown>> {
  const branches = new Map<string, Record<string, unknown>>();
  const pattern = /WHEN '([^']+)' THEN '(\{[\s\S]*?\})'::jsonb/g;
  for (const match of migration.matchAll(pattern)) {
    branches.set(match[1], JSON.parse(match[2]) as Record<string, unknown>);
  }
  return branches;
}

describe('active plan entitlement migration', () => {
  it('merges feature maps instead of replacing unrelated or future flags', () => {
    expect(migration).toContain("COALESCE(feature_flags, '{}'::jsonb) ||");
    expect(migration).not.toMatch(/feature_flags\s*=\s*'\{/);
  });

  it('restores BYOK from Indie upward and preserves the current SSO boundary', () => {
    const branches = entitlementBranches();

    expect(branches.get('free_cloud')).toMatchObject({
      byok: false,
      plugins: false,
      audit_log: false,
      intelligence_reports: false,
      sso: false,
    });
    expect(branches.get('indie')).toMatchObject({
      byok: true,
      plugins: true,
      audit_log: true,
      intelligence_reports: false,
      sso: false,
      teams: false,
    });
    expect(branches.get('pro')).toMatchObject({
      byok: true,
      plugins: true,
      audit_log: true,
      intelligence_reports: true,
      sso: false,
      teams: true,
    });
    expect(branches.get('enterprise')).toMatchObject({
      byok: true,
      plugins: true,
      audit_log: true,
      intelligence_reports: true,
      sso: true,
      teams: true,
      self_hosted: true,
      soc2: true,
    });
  });

  it('orders active upgrades as Free Cloud, Indie, Pro, Enterprise', () => {
    expect(migration).toMatch(/WHEN 'free_cloud' THEN 10/);
    expect(migration).toMatch(/WHEN 'indie' THEN 11/);
    expect(migration).toMatch(/WHEN 'pro' THEN 12/);
    expect(migration).toMatch(/WHEN 'enterprise' THEN 13/);
  });
});
