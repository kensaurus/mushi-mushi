import { describe, expect, it } from 'vitest';
import { matchesErrorFilter, shouldDropCapturedError } from './error-filters';

describe('matchesErrorFilter', () => {
  it('matches a substring', () => {
    expect(matchesErrorFilter('ResizeObserver loop limit exceeded', ['ResizeObserver'])).toBe(true);
  });

  it('matches a RegExp', () => {
    expect(matchesErrorFilter('Script error.', [/^Script error\.?$/])).toBe(true);
  });

  it('returns false for empty value or filters', () => {
    expect(matchesErrorFilter('', ['x'])).toBe(false);
    expect(matchesErrorFilter('x', [])).toBe(false);
    expect(matchesErrorFilter('x', undefined)).toBe(false);
  });
});

describe('shouldDropCapturedError', () => {
  it('drops ignoreErrors hits', () => {
    expect(
      shouldDropCapturedError({
        message: 'Token refresh failed in another tab',
        ignoreErrors: ['Token refresh failed'],
      }),
    ).toBe(true);
  });

  it('drops denyUrls hits', () => {
    expect(
      shouldDropCapturedError({
        message: 'boom',
        filename: 'chrome-extension://abc/content.js',
        denyUrls: [/chrome-extension:/],
      }),
    ).toBe(true);
  });

  it('drops when allowUrls is set and filename misses', () => {
    expect(
      shouldDropCapturedError({
        message: 'boom',
        filename: 'https://cdn.example/vendor.js',
        allowUrls: [/localhost/, /soloboss/],
      }),
    ).toBe(true);
  });

  it('keeps when allowUrls matches', () => {
    expect(
      shouldDropCapturedError({
        message: 'boom',
        filename: 'https://app.soloboss.cloud/assets/app.js',
        allowUrls: [/soloboss/],
      }),
    ).toBe(false);
  });

  it('does not drop user-looking messages without filters', () => {
    expect(shouldDropCapturedError({ message: 'Checkout button did nothing' })).toBe(false);
  });
});
