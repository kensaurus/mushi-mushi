import { describe, expect, it } from 'vitest';
import type { MushiConfig } from '@mushi-mushi/core';
import { resolveReportAppVersion } from './mushi';

describe('resolveReportAppVersion', () => {
  const base: MushiConfig = {
    projectId: '00000000-0000-0000-0000-000000000001',
    apiKey: 'mushi_test_key_abcdefghijklmnopqrst',
  };

  it('prefers explicit config.appVersion', () => {
    expect(
      resolveReportAppVersion(
        { ...base, appVersion: 'solo-boss-cloud-frontend@1.12.8+abc1234' },
        { buildId: 'from-meta' },
      ),
    ).toBe('solo-boss-cloud-frontend@1.12.8+abc1234');
  });

  it('falls back to integrations.vercel.analyticsId', () => {
    expect(
      resolveReportAppVersion(
        { ...base, integrations: { vercel: { analyticsId: 'vercel-analytics-id' } } },
        { buildId: 'from-meta' },
      ),
    ).toBe('vercel-analytics-id');
  });

  it('falls back to environment.buildId from mushi:build meta', () => {
    expect(resolveReportAppVersion(base, { buildId: 'abc123def' })).toBe('abc123def');
  });

  it('returns undefined when no source is configured', () => {
    expect(resolveReportAppVersion(base, {})).toBeUndefined();
  });
});
