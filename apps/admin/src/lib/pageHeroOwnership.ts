/**
 * Single source of truth for which routes own their hero chrome.
 *
 * - PAGE_ROUTES_WITH_OWN_HERO: page renders a live <PageHero> — Layout must
 *   NOT inject PAGE_HERO_FALLBACKS for these paths.
 * - PAGE_ROUTES_SKIP_LAYOUT_HERO: worklist / KPI-first pages that should not
 *   show the static layout fallback strip either.
 */
export const PAGE_ROUTES_WITH_OWN_HERO = new Set([
  '/query',
  '/health',
  '/audit',
  '/inbox',
  '/compliance',
  '/graph',
  '/explore',
  '/qa-coverage',
  '/drift',
  '/inventory',
  '/judge',
  '/storage',
  '/onboarding',
  '/feedback',
  '/integrations/config',
  '/anti-gaming',
  '/feature-board',
  '/queue',
  '/projects',
])

/** Loop hubs and dense worklists — no layout Snapshot (page owns loop chrome). */
export const PAGE_ROUTES_SKIP_LAYOUT_HERO = new Set([
  '/dashboard',
  '/inbox',
  '/reports',
  '/fixes',
  '/connect',
  '/setup-copilot',
  '/onboarding',
])

export function hasPageOwnedHero(pathname: string): boolean {
  return PAGE_ROUTES_WITH_OWN_HERO.has(pathname)
}

export function shouldSkipLayoutHero(pathname: string): boolean {
  return hasPageOwnedHero(pathname) || PAGE_ROUTES_SKIP_LAYOUT_HERO.has(pathname)
}
