import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { diagnoseEnvConfig, resolveEnvConfig } from './env-config';

const MUSHI_ENV_KEYS = [
  'VITE_MUSHI_PROJECT_ID',
  'VITE_MUSHI_API_KEY',
  'NEXT_PUBLIC_MUSHI_PROJECT_ID',
  'NEXT_PUBLIC_MUSHI_API_KEY',
  'NUXT_PUBLIC_MUSHI_PROJECT_ID',
  'NUXT_PUBLIC_MUSHI_API_KEY',
  'EXPO_PUBLIC_MUSHI_PROJECT_ID',
  'EXPO_PUBLIC_MUSHI_API_KEY',
  'MUSHI_PROJECT_ID',
  'MUSHI_API_KEY',
  'MUSHI_API_ENDPOINT',
];

describe('diagnoseEnvConfig', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of MUSHI_ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of MUSHI_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('is silent (message null) when config resolves', () => {
    process.env.MUSHI_PROJECT_ID = '00000000-0000-0000-0000-000000000000';
    process.env.MUSHI_API_KEY = 'mushi_test_key';
    const d = diagnoseEnvConfig();
    expect(d.missing).toEqual([]);
    expect(d.message).toBeNull();
  });

  it('reports both missing fields with prefix guidance when nothing is set', () => {
    const d = diagnoseEnvConfig();
    expect(d.missing).toEqual(['projectId', 'apiKey']);
    expect(d.nearMisses).toEqual([]);
    expect(d.message).toContain('Missing projectId and apiKey');
    expect(d.message).toContain('check the prefix');
  });

  it('flags a wrong-prefix variable as a near miss (VITE_ set, runtime reads process.env)', () => {
    // In this Node test runtime there is no import.meta.env, so a VITE_-only
    // variable is exactly the silent-no-op footgun: set, but never resolved.
    process.env.VITE_MUSHI_API_KEY = 'mushi_test_key';
    const d = diagnoseEnvConfig();
    expect(d.missing).toContain('apiKey');
    expect(d.nearMisses).toContainEqual({
      field: 'apiKey',
      key: 'VITE_MUSHI_API_KEY',
      via: 'process.env',
    });
    expect(d.message).toContain('VITE_MUSHI_API_KEY');
  });

  it('flags NUXT_PUBLIC_ near misses per missing field', () => {
    process.env.NUXT_PUBLIC_MUSHI_PROJECT_ID = 'pid';
    process.env.NUXT_PUBLIC_MUSHI_API_KEY = 'key';
    const d = diagnoseEnvConfig();
    const keys = d.nearMisses.map((m) => m.key);
    expect(keys).toContain('NUXT_PUBLIC_MUSHI_PROJECT_ID');
    expect(keys).toContain('NUXT_PUBLIC_MUSHI_API_KEY');
  });

  it('only reports near misses for fields that are actually missing', () => {
    process.env.MUSHI_PROJECT_ID = 'pid';
    process.env.VITE_MUSHI_PROJECT_ID = 'pid-dupe';
    const d = diagnoseEnvConfig();
    expect(d.missing).toEqual(['apiKey']);
    expect(d.nearMisses.every((m) => m.field === 'apiKey')).toBe(true);
  });

  it('resolveEnvConfig still resolves bare MUSHI_* variables (regression guard)', () => {
    process.env.MUSHI_PROJECT_ID = 'pid';
    process.env.MUSHI_API_KEY = 'key';
    const r = resolveEnvConfig();
    expect(r.projectId).toBe('pid');
    expect(r.apiKey).toBe('key');
  });
});
