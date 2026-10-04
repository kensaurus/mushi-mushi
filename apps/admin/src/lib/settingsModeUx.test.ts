import { describe, expect, it } from 'vitest';
import { shouldResolveQuickSettingsTab } from './settingsModeUx';

describe('shouldResolveQuickSettingsTab', () => {
  it('only auto-selects a posture tab when the URL has no explicit tab', () => {
    expect(shouldResolveQuickSettingsTab(null)).toBe(true);
    expect(shouldResolveQuickSettingsTab('byok')).toBe(false);
    expect(shouldResolveQuickSettingsTab('firecrawl')).toBe(false);
  });
});
