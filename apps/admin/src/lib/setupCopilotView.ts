/**
 * FILE: apps/admin/src/lib/setupCopilotView.ts
 * PURPOSE: Pure helpers for Setup copilot (the "Fix a problem" tab of Set up).
 */

/**
 * /setup-copilot opens Set up on its Overview tab, which leads with the setup
 * state. It used to force `tab=diagnose`, so an app with all 6 checks passing
 * opened on "Fix a problem · Reports not arriving?" (round-2 review
 * 2026-11-18). A link that names a tab (`?tab=diagnose`) still gets that tab.
 */
export function setupCopilotRedirectTarget(search: string): string {
  const qs = new URLSearchParams(search).toString()
  return qs ? `/onboarding?${qs}` : '/onboarding'
}

interface KeyHeartbeat {
  is_active: boolean
  last_seen_at?: string | null
}

/** The SDK has checked in on at least one active key. */
export function sdkHeardFrom(keys: readonly KeyHeartbeat[] | null | undefined): boolean {
  return Boolean(keys?.some((k) => k.is_active && k.last_seen_at))
}
