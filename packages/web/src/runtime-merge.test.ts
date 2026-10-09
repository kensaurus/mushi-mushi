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
    const runtime = {
      widget: { triggerText: null, launcher: 'auto' },
    } as MushiRuntimeSdkConfig;
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

  it('still lets other runtime widget keys override the host', () => {
    const host: MushiConfig = { ...BASE, widget: { ...BASE.widget, brandFooter: false, triggerText: 'Host' } };
    const merged = mergeRuntimeConfig(host, { widget: { brandFooter: true, triggerText: 'Remote' } });
    expect(merged.widget?.brandFooter).toBe(false);
    expect(merged.widget?.triggerText).toBe('Remote');
  });
});
