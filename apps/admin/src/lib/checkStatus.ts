/**
 * FILE: apps/admin/src/lib/checkStatus.ts
 * PURPOSE: One live status line per /checks card — "what is this check saying
 *          right now", not just what it covers.
 *
 * OVERVIEW:
 * - `resolveCheckStatus(path, navCounts, extras)` turns the nav counts the
 *   page already fetches into a short status line plus a tone.
 * - It reads the sidebar's own badge first (`resolveNavBadge` →
 *   `navBadgeStatus`), so a card can never say something different from the
 *   nav rail. The sidebar hides a zero-count badge; the launcher still wants
 *   to say "all clear", so a hidden health badge falls back to its own label
 *   and the remaining checks resolve an all-clear / not-set-up line from
 *   their nav slice.
 * - A check whose slice was never fetched (or whose data has no honest
 *   summary) returns `null`: the card keeps its description and says nothing
 *   rather than inventing a status.
 *
 * DEPENDENCIES:
 * - `./navBadges` (resolveNavBadge, navBadgeStatus), `./useNavCounts` types.
 *
 * USAGE:
 * - `ChecksPage` calls it once per card. Pure function — no fetching, so it
 *   is unit-testable and adds no requests.
 *
 * NOTES:
 * - `needsSetup` means "this check has no data to show yet", which the card
 *   renders as a set-up nudge. Only set it where the slice proves emptiness
 *   (zero stories / nodes / prompts), never for a missing slice.
 */

import { navBadgeStatus, resolveNavBadge, type NavBadgeExtras } from './navBadges'
import type { HealthTone, NavCounts } from './useNavCounts'

export interface CheckStatus {
  tone: HealthTone
  text: string
  /** The check has nothing yet — the card offers a set-up nudge. */
  needsSetup?: boolean
}

/** All-clear / not-set-up line for checks whose nav badge stays silent. */
function sliceStatus(path: string, navCounts: NavCounts): CheckStatus | null {
  const { slices } = navCounts
  switch (path) {
    case '/qa-coverage': {
      const qa = slices.qaCoverage
      if (!qa) return null
      return qa.totalStories > 0
        ? { tone: 'ok', text: `${qa.totalStories} stories, none failing` }
        : { tone: 'idle', text: 'No browser tests yet', needsSetup: true }
    }
    case '/fullstack-audit':
      return slices.fullstackAudit ? { tone: 'ok', text: 'No audit findings' } : null
    case '/inventory': {
      const inv = slices.inventory
      if (!inv) return null
      return inv.total > 0
        ? { tone: 'ok', text: `${inv.total} nodes, no findings` }
        : { tone: 'idle', text: 'No blueprint yet', needsSetup: true }
    }
    case '/content':
      return slices.contentQuality ? { tone: 'ok', text: 'Nothing needs review' } : null
    case '/lessons': {
      const lessons = slices.lessons
      if (!lessons) return null
      return lessons.activeLessons > 0
        ? { tone: 'ok', text: `${lessons.activeLessons} active lessons` }
        : { tone: 'idle', text: 'No lessons learned yet', needsSetup: true }
    }
    case '/prompt-lab': {
      const prompts = slices.promptLab
      if (!prompts) return null
      return prompts.totalPrompts > 0
        ? { tone: 'ok', text: `${prompts.totalPrompts} prompts, none pending` }
        : { tone: 'idle', text: 'No prompts yet', needsSetup: true }
    }
    default:
      return null
  }
}

/**
 * The live status line for one /checks card, or `null` while the counts are
 * still loading and for a check with no readable status.
 */
export function resolveCheckStatus(
  path: string,
  navCounts: NavCounts,
  extras: NavBadgeExtras,
): CheckStatus | null {
  if (!navCounts.ready) return null

  const spec = resolveNavBadge(path, navCounts, extras)
  const badge = navBadgeStatus(spec)
  if (badge) return { tone: badge.tone, text: badge.label }

  // A health badge the sidebar hides at zero still carries the all-clear
  // sentence ("Judge agrees with classifier", "All integrations healthy").
  if (spec?.kind === 'health') return { tone: spec.tone, text: spec.label }

  return sliceStatus(path, navCounts)
}

export const CHECK_STATUS_TEXT_TONE: Record<HealthTone, string> = {
  idle: 'text-fg-muted',
  ok: 'text-fg-secondary',
  warn: 'text-warn',
  danger: 'text-danger',
}
