/**
 * FILE: packages/core/src/error-filters.ts
 * PURPOSE: Sentry-grade drop filters for automatic error capture.
 *
 * OVERVIEW:
 * - ignoreErrors — drop when the error message matches a string or RegExp
 * - denyUrls — drop when the script URL / stack frame matches
 * - allowUrls — when set, drop unless the script URL matches at least one
 *
 * USAGE:
 * - captureException / window.onerror / unhandledrejection only
 * - Never applied to user-submitted widget feedback
 *
 * NOTES:
 * - String matchers are case-sensitive substrings (Sentry JS semantics)
 * - Invalid RegExp sources are treated as non-matches, not throws
 */

export type MushiErrorFilter = string | RegExp;

export function matchesErrorFilter(
  value: string | undefined | null,
  filters: readonly MushiErrorFilter[] | undefined,
): boolean {
  if (!value || !filters || filters.length === 0) return false;
  for (const filter of filters) {
    if (typeof filter === 'string') {
      if (value.includes(filter)) return true;
      continue;
    }
    try {
      if (filter.test(value)) return true;
    } catch {
      // malformed caller regex — skip
    }
  }
  return false;
}

export function shouldDropCapturedError(input: {
  message: string;
  filename?: string | null;
  ignoreErrors?: readonly MushiErrorFilter[];
  denyUrls?: readonly MushiErrorFilter[];
  allowUrls?: readonly MushiErrorFilter[];
}): boolean {
  if (matchesErrorFilter(input.message, input.ignoreErrors)) return true;

  const filename = input.filename?.trim() || '';
  if (filename && matchesErrorFilter(filename, input.denyUrls)) return true;

  if (input.allowUrls && input.allowUrls.length > 0) {
    if (!filename) return true;
    if (!matchesErrorFilter(filename, input.allowUrls)) return true;
  }

  return false;
}
