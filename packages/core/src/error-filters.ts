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
 * - URL filters match the throw site: the script filename, else the first
 *   stack frame. With allowUrls set, an error with no known URL is dropped
 *   (that is how cross-origin "Script error." arrives)
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
      // A /g or /y regex carries lastIndex between test() calls, so the same
      // filter would miss every other error. Start each test from 0.
      filter.lastIndex = 0;
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
  /** Used for the URL filters when there is no filename. */
  stack?: string | null;
  ignoreErrors?: readonly MushiErrorFilter[];
  denyUrls?: readonly MushiErrorFilter[];
  allowUrls?: readonly MushiErrorFilter[];
}): boolean {
  if (matchesErrorFilter(input.message, input.ignoreErrors)) return true;

  // No filename: the URL of the stack's first frame, i.e. where it threw.
  const filename = input.filename?.trim() || (input.stack && STACK_FRAME_URL.exec(input.stack)?.[1]) || '';
  if (filename && matchesErrorFilter(filename, input.denyUrls)) return true;

  if (input.allowUrls && input.allowUrls.length > 0) {
    if (!filename) return true;
    if (!matchesErrorFilter(filename, input.allowUrls)) return true;
  }

  return false;
}

// The URL in a frame line, `at fn (https://x/a.js:1:2)` (V8) or
// `fn@https://x/a.js:1:2` (Gecko/WebKit), without the :line:col. Anchored to
// the frame prefix so V8's `TypeError: <message>` header never matches.
const STACK_FRAME_URL = /^\s*(?:at .*?\(?|\S*@)([^\s(]+?:\/\/[^\s()]+?)(?::\d+){1,2}\)?$/m;
