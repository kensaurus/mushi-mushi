import { describe, expect, it } from 'vitest';
import type { MushiConfig, MushiRuntimeSdkConfig } from '@mushi-mushi/core';
import { mergeRuntimeCapture, mergeRuntimeConfig } from './runtime-merge';

const BASE: MushiConfig = {
  projectId: '00000000-0000-0000-0000-000000000001',
  apiKey: 'mushi_test_key_abcdefghijklmnop',
  widget: { trigger: 'banner' },
  capture: { elementSelector: true, screenshot: 'on-report' },
};

describe('mergeRuntimeCapture', () => {
  it('preserves host capture flags when runtime omits keys', () => {
    const merged = mergeRuntimeCapture(
      { elementSelector: true, screenshot: 'on-report' },
      {},
    );
    expect(merged).toEqual({ elementSelector: true, screenshot: 'on-report' });
  });

  it('applies only explicitly sent runtime capture keys', () => {
    const merged = mergeRuntimeCapture(
      { elementSelector: true, screenshot: 'on-report' },
      { elementSelector: false },
    );
    expect(merged.elementSelector).toBe(false);
    expect(merged.screenshot).toBe('on-report');
  });
});

describe('mergeRuntimeConfig — launcher / trigger precedence', () => {
  // Help Her Take Photo's web build (2026-10-09): host trigger 'manual' with its
  // own banner, console launcher 'banner' — the SDK drew a second banner.
  it('keeps a host manual trigger over any console launcher', () => {
    const host: MushiConfig = { ...BASE, widget: { trigger: 'manual' } };
    for (const launcher of ['banner', 'auto', 'edge-tab'] as const) {
      const merged = mergeRuntimeConfig(host, { widget: { launcher } } as MushiRuntimeSdkConfig);
      expect(merged.widget?.trigger, launcher).toBe('manual');
    }
  });

  it('keeps a host attach trigger, as the runtime-config docs promise', () => {
    const host: MushiConfig = { ...BASE, widget: { trigger: 'attach', attachToSelector: '#help' } };
    const merged = mergeRuntimeConfig(host, { widget: { launcher: 'banner' } } as MushiRuntimeSdkConfig);
    expect(merged.widget?.trigger).toBe('attach');
    const nativeNone = mergeRuntimeConfig(host, { native: { triggerMode: 'none' } } as MushiRuntimeSdkConfig);
    expect(nativeNone.widget?.trigger).toBe('attach');
  });

  it('still lets the console hide a host-owned launcher', () => {
    const host: MushiConfig = { ...BASE, widget: { trigger: 'manual' } };
    const merged = mergeRuntimeConfig(host, { widget: { launcher: 'hidden' } } as MushiRuntimeSdkConfig);
    expect(merged.widget?.trigger).toBe('hidden');
  });

  it('judges by the original host trigger on a second merge', () => {
    const host: MushiConfig = { ...BASE, widget: { trigger: 'manual' } };
    const once = mergeRuntimeConfig(host, { widget: { launcher: 'banner' } } as MushiRuntimeSdkConfig, host);
    const twice = mergeRuntimeConfig(once, { widget: { launcher: 'banner' } } as MushiRuntimeSdkConfig, host);
    expect(twice.widget?.trigger).toBe('manual');
  });

  it('keeps host banner when runtime sends unconfigured launcher:auto', () => {
    const runtime: MushiRuntimeSdkConfig = {
      widget: { launcher: 'auto' },
    };
    const merged = mergeRuntimeConfig(BASE, runtime);
    expect(merged.widget?.trigger).toBe('banner');
  });

  it('honours runtime explicit hidden over host visible trigger', () => {
    const runtime: MushiRuntimeSdkConfig = {
      widget: { launcher: 'hidden' },
    };
    const merged = mergeRuntimeConfig(BASE, runtime);
    expect(merged.widget?.trigger).toBe('hidden');
  });

  it('does not clobber host trigger when runtime payload is empty', () => {
    const merged = mergeRuntimeConfig(BASE, {});
    expect(merged.widget?.trigger).toBe('banner');
  });

  it('ignores null widget fields from older edge functions', () => {
    const runtime: MushiRuntimeSdkConfig & { widget: { launcher: string } } = {
      widget: { triggerText: null, launcher: 'auto' },
    };
    const merged = mergeRuntimeConfig(
      { ...BASE, widget: { ...BASE.widget, triggerText: 'Report bug' } },
      runtime,
    );
    expect(merged.widget?.trigger).toBe('banner');
    expect(merged.widget?.triggerText).toBe('Report bug');
  });
});

describe('mergeRuntimeConfig — brandFooter (MIT config beats remote)', () => {
  it('applies the runtime value when the host never set brandFooter', () => {
    const merged = mergeRuntimeConfig(BASE, { widget: { brandFooter: true } });
    expect(merged.widget?.brandFooter).toBe(true);
  });

  it('keeps an explicit host false when the runtime sends true', () => {
    const host: MushiConfig = { ...BASE, widget: { ...BASE.widget, brandFooter: false } };
    const merged = mergeRuntimeConfig(host, { widget: { brandFooter: true } });
    expect(merged.widget?.brandFooter).toBe(false);
  });

  it('keeps an explicit host true when the runtime sends false', () => {
    const host: MushiConfig = { ...BASE, widget: { ...BASE.widget, brandFooter: true } };
    const merged = mergeRuntimeConfig(host, { widget: { brandFooter: false } });
    expect(merged.widget?.brandFooter).toBe(true);
  });

  it('lets a fresh runtime payload replace a cached runtime value when the host never set it', () => {
    // First merge: cached payload turns the mark on. Second merge: the fresh
    // payload turns it off. Passing the original host config as the third
    // argument keeps the cached value from masquerading as a host decision.
    const afterCache = mergeRuntimeConfig(BASE, { widget: { brandFooter: true } }, BASE);
    expect(afterCache.widget?.brandFooter).toBe(true);
    const afterFetch = mergeRuntimeConfig(afterCache, { widget: { brandFooter: false } }, BASE);
    expect(afterFetch.widget?.brandFooter).toBe(false);
  });

  it('keeps host values for the other widget keys too (ADR 0068)', () => {
    const host: MushiConfig = { ...BASE, widget: { ...BASE.widget, brandFooter: false, triggerText: 'Host' } };
    const merged = mergeRuntimeConfig(host, { widget: { brandFooter: true, triggerText: 'Remote' } });
    expect(merged.widget?.brandFooter).toBe(false);
    expect(merged.widget?.triggerText).toBe('Host');
  });
});

// ADR 0068 (owner decision, 2026-11-22): one rule for every appearance key.
// Code wins; the console fills what code left unset; then the default.
describe('mergeRuntimeConfig — explicit code wins for every appearance key', () => {
  const NO_WIDGET: MushiConfig = { projectId: BASE.projectId, apiKey: BASE.apiKey };
  const CASES: ReadonlyArray<{ key: string; host: unknown; runtime: unknown }> = [
    { key: 'position', host: 'top-left', runtime: 'bottom-left' },
    { key: 'theme', host: 'light', runtime: 'dark' },
    { key: 'triggerText', host: 'Feedback', runtime: 'Report a bug' },
    { key: 'accent', host: '#e03c2c', runtime: '#3b5bdb' },
    { key: 'screenshotSensitiveHint', host: false, runtime: 'Hide card numbers' },
    { key: 'attachToSelector', host: '#help', runtime: '#report' },
  ];

  for (const { key, host, runtime } of CASES) {
    it(`${key}: host set + console set → host`, () => {
      const hostCfg = { ...NO_WIDGET, widget: { [key]: host } } as MushiConfig;
      const merged = mergeRuntimeConfig(hostCfg, { widget: { [key]: runtime } } as MushiRuntimeSdkConfig, hostCfg);
      expect((merged.widget as Record<string, unknown>)[key]).toEqual(host);
    });

    it(`${key}: host unset + console set → console`, () => {
      const merged = mergeRuntimeConfig(NO_WIDGET, { widget: { [key]: runtime } } as MushiRuntimeSdkConfig, NO_WIDGET);
      expect((merged.widget as Record<string, unknown>)[key]).toEqual(runtime);
    });

    it(`${key}: neither → the SDK default (unset)`, () => {
      const merged = mergeRuntimeConfig(NO_WIDGET, { widget: {} }, NO_WIDGET);
      expect((merged.widget as Record<string, unknown>)[key]).toBeUndefined();
    });
  }

  it('a cached console value never counts as a host value on the next merge', () => {
    const cached = mergeRuntimeConfig(NO_WIDGET, { widget: { theme: 'dark', accent: '#3b5bdb' } }, NO_WIDGET);
    const fresh = mergeRuntimeConfig(cached, { widget: { theme: 'light', accent: '#0ca678' } }, NO_WIDGET);
    expect(fresh.widget?.theme).toBe('light');
    expect(fresh.widget?.accent).toBe('#0ca678');
  });

  it('accentText follows the accent that wins', () => {
    const hostAccent = { ...NO_WIDGET, widget: { accent: '#e03c2c' } } as MushiConfig;
    const kept = mergeRuntimeConfig(hostAccent, { widget: { accent: '#fde047', accentText: '#000000' } }, hostAccent);
    expect(kept.widget?.accent).toBe('#e03c2c');
    expect(kept.widget?.accentText).toBeUndefined();

    const hostInkOnly = { ...NO_WIDGET, widget: { accentText: '#ffffff' } } as MushiConfig;
    const paired = mergeRuntimeConfig(hostInkOnly, { widget: { accent: '#fde047', accentText: '#000000' } }, hostInkOnly);
    expect(paired.widget?.accent).toBe('#fde047');
    expect(paired.widget?.accentText).toBe('#000000');
  });

  it('banner fields: each host bannerConfig field wins, the console fills the rest', () => {
    const host = { ...NO_WIDGET, widget: { trigger: 'banner', bannerConfig: { variant: 'subtle' } } } as MushiConfig;
    const merged = mergeRuntimeConfig(
      host,
      { widget: { bannerVariant: 'neon', bannerPosition: 'bottom', bannerMessage: 'Beta' } } as MushiRuntimeSdkConfig,
      host,
    );
    expect(merged.widget?.bannerConfig).toMatchObject({ variant: 'subtle', position: 'bottom', message: 'Beta' });

    const unset = mergeRuntimeConfig(NO_WIDGET, { widget: { bannerVariant: 'neon' } } as MushiRuntimeSdkConfig, NO_WIDGET);
    expect(unset.widget?.bannerConfig?.variant).toBe('neon');
    expect(mergeRuntimeConfig(NO_WIDGET, { widget: {} }, NO_WIDGET).widget?.bannerConfig).toBeUndefined();
  });
});
