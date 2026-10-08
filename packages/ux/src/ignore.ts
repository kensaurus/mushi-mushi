// SPDX-License-Identifier: MIT
/**
 * Elements that are not the app's UI: dev-server overlays, build stamps, and
 * Mushi's own widget. They are hidden in screenshots and left out of every
 * measurement, so the agent is never sent to "fix" them. On glot.it the
 * agent spent an attempt raising the contrast of a dev-only build stamp
 * (2026-10-06).
 *
 * Add your own with `--ignore <selector>` (repeatable), or mark an element
 * with `data-mushi-ux-ignore`.
 */

const DEFAULT_IGNORE: readonly string[] = [
  // Mark anything yourself
  '[data-mushi-ux-ignore]',
  // Next.js dev overlay and indicators
  'nextjs-portal',
  '[data-nextjs-toast]',
  '[data-nextjs-dev-tools-button]',
  '#__next-build-watcher',
  // Vite / webpack dev overlays
  'vite-error-overlay',
  '#webpack-dev-server-client-overlay',
  // Build / version stamps shown only in dev or QA builds
  '[data-qa-build-stamp]',
  '[data-build-stamp]',
  // Mushi's own widget, rewards badge and consent banner (not the app's code)
  '#mushi-mushi-widget',
  '#mushi-tier-badge',
  '#mushi-consent-banner',
]

/**
 * A selector from the command line or the studio form that cannot break out
 * of the injected stylesheet. The browser still validates it: one it cannot
 * parse is skipped there (see probes.ts), never fatal.
 */
export function isSafeSelector(s: string): boolean {
  return s.length > 0 && s.length <= 200 && !/[{}<>;\\]/.test(s) && !/^[\s,]|,\s*$/.test(s)
}

export function ignoreList(extra: readonly string[] = []): string[] {
  return [...new Set([...DEFAULT_IGNORE, ...extra.map((s) => s.trim()).filter(isSafeSelector)])]
}

/** CSS that hides ignored elements in a screenshot without moving anything else. */
export function ignoreStyle(selectors: readonly string[]): string {
  return selectors.length ? `${selectors.join(',\n')} { visibility: hidden !important; }` : ''
}
