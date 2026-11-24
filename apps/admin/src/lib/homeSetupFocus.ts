/**
 * FILE: apps/admin/src/lib/homeSetupFocus.ts
 * PURPOSE: While setup's report-button step is open, the setup checklist owns
 *          that action. A brand-new app's Home (fresh-account walk,
 *          2026-11-24) showed the checklist's "Show me how" and then
 *          "Set up the SDK" in Needs you, "Add the report button" on two
 *          health lights, and "Connect GitHub" twice, under a checklist that
 *          already said what to do next.
 */
import type { HomeSection, NeedsYouItem } from './projectHome'

/** A link to the report-button install: Connect's SDK sections or Set up's SDK tab. */
export function isSdkSetupHref(to: string | null | undefined): boolean {
  return typeof to === 'string' && /#connect-sdk|[?&]tab=sdk(?:&|#|$)/.test(to)
}

/** Needs you without the "your app is not sending" row the open setup step already says. */
export function needsYouWithoutSetupStep(section: HomeSection<NeedsYouItem[]>): HomeSection<NeedsYouItem[]> {
  if (!section.data) return section
  return { ...section, data: section.data.filter((i) => i.id !== 'sdk_silent' && !isSdkSetupHref(i.action?.to)) }
}
