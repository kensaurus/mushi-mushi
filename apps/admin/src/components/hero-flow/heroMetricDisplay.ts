/**
 * Parse hero metric strings into a dominant numeral + secondary chips.
 * Shared across all pages — no per-route copy in the node components.
 */

import { heroMetricChips } from '../../lib/pageHeroSnapshot'

export interface ParsedHeroMetric {
  /** Dominant scan value (e.g. "3"). */
  value?: string
  /** Short unit beside the numeral (e.g. "inactive"). */
  unit?: string
  /** Remaining chips when ≥2 dimensions exist. */
  secondaryChips: string[]
}

/** Pick the chip that best matches the decide label, else the first numeric chip. */
export function parseDecideMetric(label: string, metric?: string): ParsedHeroMetric {
  const chips = heroMetricChips(metric)
  if (chips.length === 0) {
    return { unit: label, secondaryChips: [] }
  }

  const labelLower = label.toLowerCase()
  const words = labelLower.split(/\s+/).filter((w) => w.length > 2)

  let primaryChip =
    chips.find((c) => {
      const cl = c.toLowerCase()
      return words.some((w) => cl.includes(w))
    }) ?? chips[0]

  const numMatch = primaryChip.match(/^([\d.,]+)\s*(.*)$/)
  const value = numMatch?.[1]
  const unit = numMatch?.[2]?.trim() || label
  const secondaryChips = chips.length > 1 ? chips.filter((c) => c !== primaryChip) : []

  return { value, unit, secondaryChips }
}

/** Deep-link patterns per scope slug (matches Layout route fallbacks). */
export function heroChipLinksForScope(scope: string): ReadonlyArray<{ match: RegExp; to: string }> {
  switch (scope) {
    case 'members':
    case 'organization-members':
      return [
        { match: /inactive/i, to: '/organization/members?tab=roster&inactive=1' },
        { match: /pending/i, to: '/organization/members?tab=invites' },
        { match: /member/i, to: '/organization/members?tab=roster' },
      ]
    case 'fixes':
      return [
        { match: /fail/i, to: '/fixes?status=failed' },
        { match: /progress|in flight/i, to: '/fixes?status=in_progress' },
      ]
    case 'reports':
      return [{ match: /backlog|new|open/i, to: '/reports?status=new' }]
    case 'dashboard':
      return [
        { match: /backlog|new/i, to: '/reports?status=new' },
        { match: /fail/i, to: '/fixes?status=failed' },
      ]
    default:
      return []
  }
}

export function chipLinkForText(
  chip: string,
  scope: string,
): string | undefined {
  for (const { match, to } of heroChipLinksForScope(scope)) {
    if (match.test(chip)) return to
  }
  return undefined
}
