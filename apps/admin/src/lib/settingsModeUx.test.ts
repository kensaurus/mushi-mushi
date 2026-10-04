import { describe, expect, it } from 'vitest';
import { resolveQuickSettingsTab, shouldResolveQuickSettingsTab } from './settingsModeUx';
import { EMPTY_SETTINGS_STATS, type SettingsStats } from '../components/settings/types';
import type { KeySummary } from '../components/settings/keyStatus';

describe('shouldResolveQuickSettingsTab', () => {
  it('only auto-selects a posture tab when the URL has no explicit tab', () => {
    expect(shouldResolveQuickSettingsTab(null)).toBe(true);
    expect(shouldResolveQuickSettingsTab('byok')).toBe(false);
    expect(shouldResolveQuickSettingsTab('firecrawl')).toBe(false);
  });
});

// Quick mode always opened General: it read stats.topPriority, which the
// server never sends (suspected-bugs entry 112). It now follows the banner.
describe('resolveQuickSettingsTab', () => {
  const ready: SettingsStats = {
    ...EMPTY_SETTINGS_STATS,
    projectId: 'p',
    sdkConfigEnabled: true,
    slackConfigured: true,
    byokAnthropicConfigured: true,
  };
  const summary = (over: Partial<KeySummary>): KeySummary =>
    ({ working: 1, attention: 0, expiring: 0, checking: 0, off: 0, total: 1, ...over });

  it('opens Your AI keys when a key is failing (from the saved-keys list)', () => {
    expect(resolveQuickSettingsTab(ready, summary({ attention: 1 }), true, true)).toBe('byok');
  });

  it('falls back to the server counts when the key list is unavailable', () => {
    expect(resolveQuickSettingsTab({ ...ready, byokKeysFailing: 1 }, null, true, true)).toBe('byok');
    expect(resolveQuickSettingsTab({ ...ready, byokKeysUntested: 2 }, null, true, true)).toBe('byok');
  });

  it('opens Health when the bug widget is off', () => {
    expect(resolveQuickSettingsTab({ ...ready, sdkConfigEnabled: false }, summary({}), true, true)).toBe('health');
  });

  it('opens Health when everything is ready', () => {
    expect(resolveQuickSettingsTab(ready, summary({}), true, true)).toBe('health');
  });

  it('opens General for the optional alerts step', () => {
    expect(resolveQuickSettingsTab({ ...ready, slackConfigured: false }, summary({}), true, true)).toBe('general');
  });

  it('skips the optional own-key step on a plan without own keys', () => {
    expect(resolveQuickSettingsTab(ready, null, false, true)).toBe('byok');
    expect(resolveQuickSettingsTab(ready, null, false, false)).toBe('health');
  });
});
