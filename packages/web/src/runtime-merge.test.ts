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
