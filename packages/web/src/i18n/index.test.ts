import { describe, it, expect } from 'vitest';
import { getLocale, getAvailableLocales } from './index';

describe('getLocale', () => {
  it('returns English by default', () => {
    const locale = getLocale();
    expect(locale.widget.trigger).toBe('Report Issue');
  });

  it('returns Japanese for "ja"', () => {
    const locale = getLocale('ja');
    expect(locale.widget.trigger).toBe('問題を報告');
  });

  it('returns Thai for "th"', () => {
    const locale = getLocale('th');
    expect(locale.widget.trigger).toBe('รายงานปัญหา');
  });

  it('returns Spanish for "es"', () => {
    const locale = getLocale('es');
    expect(locale.widget.trigger).toBe('Reportar problema');
  });

  it('falls back to English for unknown locale', () => {
    const locale = getLocale('zz');
    expect(locale.widget.trigger).toBe('Report Issue');
  });

  it('handles locale with region code', () => {
    const locale = getLocale('ja-JP');
    expect(locale.widget.trigger).toBe('問題を報告');
  });

  it('has all categories for every locale', () => {
    const locales = getAvailableLocales();
    for (const code of locales) {
      const locale = getLocale(code);
      expect(locale.step1.categories.bug).toBeTruthy();
      expect(locale.step1.categories.slow).toBeTruthy();
      expect(locale.step1.categories.visual).toBeTruthy();
      expect(locale.step1.categories.confusing).toBeTruthy();
      expect(locale.step1.categories.other).toBeTruthy();
    }
  });
});

describe('getAvailableLocales', () => {
  it('returns at least en, ja, th, es', () => {
    const locales = getAvailableLocales();
    expect(locales).toContain('en');
    expect(locales).toContain('ja');
    expect(locales).toContain('th');
    expect(locales).toContain('es');
  });
});
