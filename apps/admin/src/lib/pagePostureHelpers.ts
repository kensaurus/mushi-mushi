/**
 * FILE: pagePostureHelpers.ts
 * PURPOSE: Shared chrome-budget helpers for PagePosture slots across admin pages.
 */

/** Hide economy/guide panels when the status banner already surfaces the same priority. */
export function shouldHideGuideWhenBannerActive(
  bannerVisible: boolean,
  healthyPriorities: readonly string[],
  topPriority: string,
): boolean {
  if (!bannerVisible) return false
  return !healthyPriorities.includes(topPriority)
}

export const COMMON_HEALTHY_PRIORITIES = ['healthy', 'clear', 'nominal'] as const
