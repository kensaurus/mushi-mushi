// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expandPreset, validateConfig } from './presets';
import type { MushiConfig } from './types';

const base = (overrides: Partial<MushiConfig> = {}): MushiConfig => ({
  projectId: 'p_test',
  apiKey: 'k_test',
  ...overrides,
});

describe('expandPreset', () => {
  it('minimal expands to widget + console-only capture, no proactive', () => {
    const out = expandPreset(base({ preset: 'minimal' }));
    expect(out.widget).toEqual({ trigger: 'auto' });
    expect(out.capture).toEqual({
      console: true,
      network: false,
      performance: false,
      screenshot: 'on-report',
      replay: 'off',
      elementSelector: false,
    });
    expect(out.proactive).toMatchObject({
      rageClick: false,
      longTask: false,
      apiCascade: false,
      errorBoundary: false,
    });
  });

  it('full turns on all capture (incl. replay) and every proactive trigger', () => {
    const out = expandPreset(base({ preset: 'full' }));
    expect(out.capture).toEqual({
      console: true,
      network: true,
      performance: true,
      screenshot: 'auto',
      replay: 'lite',
      elementSelector: true,
    });
    expect(out.proactive).toMatchObject({
      rageClick: true,
      longTask: true,
      apiCascade: true,
      errorBoundary: true,
    });
  });

  it('standard is a no-op — returns the config untouched', () => {
    const input = base({ preset: 'standard', capture: { console: true } });
    const out = expandPreset(input);
    expect(out).toBe(input);
  });

  it('no preset returns the config untouched', () => {
    const input = base({ capture: { network: true } });
    expect(expandPreset(input)).toBe(input);
  });

  it('an unknown preset value returns the config untouched (defensive, no throw)', () => {
    // Simulate a plain-JS caller passing a typo not in the TS union.
    const input = base({ preset: 'miniml' as MushiConfig['preset'] });
    expect(expandPreset(input)).toBe(input);
  });

  it('explicit config wins over preset defaults', () => {
    const out = expandPreset(
      base({
        preset: 'minimal',
        capture: { network: true, screenshot: 'auto' },
        widget: { trigger: 'manual' },
      }),
    );
    // User overrides applied…
    expect(out.capture?.network).toBe(true);
    expect(out.capture?.screenshot).toBe('auto');
    expect(out.widget?.trigger).toBe('manual');
    // …while un-overridden preset defaults remain.
    expect(out.capture?.console).toBe(true);
    expect(out.capture?.performance).toBe(false);
  });

  it('user cooldown overrides merge over preset cooldown', () => {
    const out = expandPreset(
      base({
        preset: 'internal-debug',
        proactive: { cooldown: { maxProactivePerSession: 3 } },
      }),
    );
    expect(out.proactive?.cooldown?.maxProactivePerSession).toBe(3); // user wins
    expect(out.proactive?.cooldown?.suppressAfterDismissals).toBe(99); // preset default kept
  });

  it('preserves the existing 4 presets (production-calm)', () => {
    const out = expandPreset(base({ preset: 'production-calm' }));
    expect(out.widget).toEqual({ trigger: 'auto', outdatedBanner: 'console-only' });
    expect(out.capture?.performance).toBe(false);
    expect(out.capture?.network).toBe(true);
  });
});

describe('validateConfig', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.MUSHI_SILENT;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('warns on an unknown top-level key', () => {
    validateConfig(base({ widgets: {} } as unknown as MushiConfig));
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('widgets');
  });

  it('warns on an invalid preset value', () => {
    validateConfig(base({ preset: 'loud' as MushiConfig['preset'] }));
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('loud');
  });

  it('stays silent on a fully-populated valid config', () => {
    validateConfig(
      base({
        apiEndpoint: 'https://example.com',
        timeout: 5000,
        maxRetries: 3,
        circuitBreaker: { enabled: true },
        preset: 'full',
        runtimeConfig: true,
        sentry: {},
        widget: {},
        capture: {},
        privacy: {},
        proactive: {},
        preFilter: {},
        integrations: {},
        offline: {},
        rewards: {},
        assistant: {},
        debug: true,
        enabled: true,
        appVersion: '1.0.0',
        beforeSendFeedback: (r) => r,
        onCrashedLastRun: () => {},
      }),
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('never throws', () => {
    expect(() => validateConfig(null as unknown as MushiConfig)).not.toThrow();
    expect(() => validateConfig(undefined as unknown as MushiConfig)).not.toThrow();
  });

  it('MUSHI_SILENT=1 suppresses warnings', () => {
    process.env.MUSHI_SILENT = '1';
    validateConfig(base({ bogusKey: 1 } as unknown as MushiConfig));
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
