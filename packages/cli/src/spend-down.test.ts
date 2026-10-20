import { describe, expect, it } from 'vitest';
import { spendDownBody, spendDownStatusLine } from './spend-down.js';

describe('spendDownBody', () => {
  it('maps flags to the PATCH body', () => {
    expect(
      spendDownBody({ on: true, expires: '2026-10-31', model: 'grok-4.7?reasoning_effort=xhigh', perDay: '20', windowDays: '7' }),
    ).toEqual({ enabled: true, creditsExpireAt: '2026-10-31', model: 'grok-4.7?reasoning_effort=xhigh', dailyLimit: 20, windowDays: 7 });
    expect(spendDownBody({ off: true })).toEqual({ enabled: false });
    expect(spendDownBody({ model: '' })).toEqual({ model: null });
  });

  it('returns null without flags, and refuses bad ones', () => {
    expect(spendDownBody({})).toBeNull();
    expect(() => spendDownBody({ on: true, off: true })).toThrow('--on or --off');
    expect(() => spendDownBody({ perDay: '0' })).toThrow('--per-day');
    expect(() => spendDownBody({ windowDays: '2.5' })).toThrow('--window-days');
  });
});

describe('spendDownStatusLine', () => {
  it('prints the state, today, expiry, model and apps', () => {
    expect(
      spendDownStatusLine({
        id: 'k1',
        label: 'ayako',
        keyHint: '…a1b2',
        scope: 'organization',
        enabled: true,
        creditsExpireAt: '2026-10-31T23:59:59Z',
        model: null,
        dailyLimit: 10,
        state: 'active',
        startsAt: '2026-10-17T23:59:59Z',
        dispatchedToday: 3,
        projects: [{ id: 'p', name: 'tsumagoi' }],
      }),
    ).toBe('ayako …a1b2 [organization] active · 3/10 today · credits expire 2026-10-31 · model app default · pays for tsumagoi — k1');
  });
});
