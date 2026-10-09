import { describe, expect, it } from 'vitest';
import { matchesErrorFilter, shouldDropCapturedError } from './error-filters';

describe('matchesErrorFilter', () => {
  it('matches a substring', () => {
    expect(matchesErrorFilter('ResizeObserver loop limit exceeded', ['ResizeObserver'])).toBe(true);
  });

  it('matches a RegExp', () => {
    expect(matchesErrorFilter('Script error.', [/^Script error\.?$/])).toBe(true);
  });

  it('matches a global or sticky RegExp on every call, not every other call', () => {
    for (const filter of [/ResizeObserver/g, /ResizeObserver/y]) {
      expect(matchesErrorFilter('ResizeObserver loop limit exceeded', [filter])).toBe(true);
      expect(matchesErrorFilter('ResizeObserver loop limit exceeded', [filter])).toBe(true);
    }
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

  const V8_STACK = [
    'Error: boom',
    '    at chargeCard (https://app.soloboss.cloud/assets/app.js:12:34)',
    '    at https://cdn.example/vendor.js:1:2',
  ].join('\n');
  const GECKO_STACK = 'chargeCard@chrome-extension://abc/content.js:3:9\n@https://app.soloboss.cloud/assets/app.js:1:1';

  it('reads the throw-site URL from the stack when there is no filename', () => {
    expect(shouldDropCapturedError({ message: 'boom', stack: V8_STACK, allowUrls: [/soloboss/] })).toBe(false);
    expect(shouldDropCapturedError({ message: 'boom', stack: V8_STACK, allowUrls: [/localhost/] })).toBe(true);
    expect(shouldDropCapturedError({ message: 'boom', stack: GECKO_STACK, denyUrls: [/chrome-extension:/] })).toBe(true);
  });

  it('prefers an explicit filename over the stack', () => {
    expect(
      shouldDropCapturedError({
        message: 'boom',
        filename: 'https://cdn.example/vendor.js',
        stack: V8_STACK,
        allowUrls: [/soloboss/],
      }),
    ).toBe(true);
  });

  it('ignores a URL in the V8 message header', () => {
    const stack = 'Error: fetch failed for http://localhost:3000\n    at load (https://cdn.example/vendor.js:4:2)';
    expect(shouldDropCapturedError({ message: 'fetch failed', stack, allowUrls: [/localhost/] })).toBe(true);
  });

  it('with no known URL, allowUrls drops and denyUrls keeps', () => {
    expect(shouldDropCapturedError({ message: 'Script error.', allowUrls: [/soloboss/] })).toBe(true);
    expect(shouldDropCapturedError({ message: 'boom', stack: 'Error: boom', denyUrls: [/vendor/] })).toBe(false);
  });

  it('does not drop user-looking messages without filters', () => {
    expect(shouldDropCapturedError({ message: 'Checkout button did nothing' })).toBe(false);
  });
});
