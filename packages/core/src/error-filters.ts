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

  const filename = input.filename?.trim() || stackThrowSiteUrl(input.stack) || '';
  if (filename && matchesErrorFilter(filename, input.denyUrls)) return true;

  if (input.allowUrls && input.allowUrls.length > 0) {
    if (!filename) return true;
    if (!matchesErrorFilter(filename, input.allowUrls)) return true;
  }

  return false;
}

// The URL in `at fn (https://x/a.js:1:2)` (V8) or `fn@https://x/a.js:1:2`
// (Gecko/WebKit), without the trailing :line:col.
const STACK_FRAME_URL = /((?:blob:)?[a-z][a-z0-9+.-]*:\/\/[^\s()]+?)(?::\d+){1,2}\)?$/i;
const STACK_HEADER = /^[\w$.]*:\s/;

/** URL of the frame that threw (the first stack frame with a URL), or undefined. */
function stackThrowSiteUrl(stack: string | undefined | null): string | undefined {
  if (!stack) return undefined;
  for (const raw of stack.split('\n')) {
    const line = raw.trim();
    // Frames only: skip V8's `TypeError: <message>` header, which may itself
    // end in a URL (or contain an `@`).
    if (STACK_HEADER.test(line)) continue;
    if (!line.startsWith('at ') && !line.includes('@')) continue;
    const match = STACK_FRAME_URL.exec(line);
    if (match) return match[1];
  }
  return undefined;
}
