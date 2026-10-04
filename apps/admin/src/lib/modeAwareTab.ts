/**
 * FILE: apps/admin/src/lib/modeAwareTab.ts
 * PURPOSE: Which tab a mode-aware page shows.
 *
 * Quickstart mode lands the user on the tab that matches the page's posture.
 * Releases and Lessons did that in an effect that rewrote `?tab=` on every
 * render, so `+ Draft`, banner links and deep links (`?tab=query`) flipped
 * the URL and were immediately reverted. An explicit tab in the URL now
 * always wins; the posture tab only fills in when the URL names none.
 */
export function resolveModeAwareTab<T extends string>(input: {
  /** The valid tab named in the URL, or null when absent/invalid. */
  explicit: T | null
  isQuickstart: boolean
  /** Posture tab for quickstart; null while stats are still loading. */
  quickTab: T | null
  fallback: T
}): T {
  if (input.explicit) return input.explicit
  if (input.isQuickstart && input.quickTab) return input.quickTab
  return input.fallback
}
