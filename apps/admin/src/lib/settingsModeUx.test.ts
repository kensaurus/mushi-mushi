import { describe, expect, it } from 'vitest';
import { shouldHideSettingsSnapshot, shouldResolveQuickSettingsTab } from './settingsModeUx';

describe('shouldHideSettingsSnapshot', () => {
  it('hides for quickstart always', () => {
    expect(
      shouldHideSettingsSnapshot(
        { hideSettingsSnapshot: true, isBeginner: false },
        { topPriority: 'healthy' },
      ),
    ).toBe(true);
  });

  it('hides for beginner when banner is not healthy', () => {
    expect(
      shouldHideSettingsSnapshot(
        { hideSettingsSnapshot: false, isBeginner: true },
        { topPriority: 'no_anthropic' },
      ),
    ).toBe(true);
  });

  it('shows snapshot for beginner when healthy', () => {
    expect(
      shouldHideSettingsSnapshot(
        { hideSettingsSnapshot: false, isBeginner: true },
        { topPriority: 'healthy' },
      ),
    ).toBe(false);
  });
});

describe('shouldResolveQuickSettingsTab', () => {
  it('only auto-selects a posture tab when the URL has no explicit tab', () => {
    expect(shouldResolveQuickSettingsTab(null)).toBe(true);
    expect(shouldResolveQuickSettingsTab('byok')).toBe(false);
    expect(shouldResolveQuickSettingsTab('firecrawl')).toBe(false);
  });
});
