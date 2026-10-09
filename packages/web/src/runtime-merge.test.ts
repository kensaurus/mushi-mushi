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
