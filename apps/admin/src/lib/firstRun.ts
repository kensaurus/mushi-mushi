/**
 * FILE: apps/admin/src/lib/firstRun.ts
 * PURPOSE: Where an account with no app should land.
 *
 * A new account used to open on Bugs (the console root and every sign-in
 * `next`), with zero severity cards, filters and three competing "go to
 * setup" links. It goes to setup instead, while setup is the only thing it
 * can do. Someone in another team (an invite) may have apps there, so the
 * rule holds only for an account with at most one team.
 */

/** Pages a new account reaches by default; deep links elsewhere are kept. */
const DEFAULT_LANDINGS = new Set(['/', '/reports', '/dashboard'])

export function isDefaultLanding(pathname: string): boolean {
  return DEFAULT_LANDINGS.has(pathname.replace(/\/+$/, '') || '/')
}

/**
 * True when the console should send this account to setup. Unknown counts
 * (still loading, failed read) never redirect: the page renders as before.
 */
export function shouldOpenSetup(input: {
  pathname: string
  projectCount: number | null
  teamCount: number | null
}): boolean {
  if (input.projectCount === null || input.teamCount === null) return false
  return input.projectCount === 0 && input.teamCount <= 1 && isDefaultLanding(input.pathname)
}

/**
 * The page a sign-up returns to after confirming its email. A generic landing
 * becomes setup; a real destination (an invite, a deep link) is kept.
 */
export function signupLandingPath(next: string): string {
  const pathname = next.split(/[?#]/, 1)[0] ?? next
  return isDefaultLanding(pathname) ? '/onboarding' : next
}
