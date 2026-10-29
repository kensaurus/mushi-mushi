/**
 * FILE: apps/admin/src/lib/visiblePlanLabel.ts
 * PURPOSE: One plan label for the header team pill, the Team page, and the
 *          sidebar plan chip.
 *
 * A complimentary org used to read "COMP" in the header (uppercased), "Pro"
 * on the Team page, and "Admin" in the sidebar. Callers pass the catalog
 * display name when they have it; the plan id is only a fallback.
 */

export interface VisiblePlanInput {
  /** Catalog name (`pricing_plans.display_name`), e.g. "Pro" or "Studio". */
  displayName?: string | null
  /** Plan id, used only when `displayName` is blank. */
  planId?: string | null
  /** `organizations.billing_mode`. Anything other than complimentary is paid. */
  billingMode?: string | null
}

/**
 * Current catalog names (migration 20261028180000) for surfaces that only
 * have a plan id. A non-empty display name always wins, so a database that
 * still says "Pro" stays "Pro" everywhere.
 */
const CATALOG_DISPLAY_NAME: Record<string, string> = {
  free_cloud: 'Free',
  hobby: 'Hobby',
  starter: 'Starter',
  indie: 'Builder',
  pro: 'Studio',
  enterprise: 'Enterprise',
}

export function planDisplayName(displayName?: string | null, planId?: string | null): string {
  const named = displayName?.trim()
  if (named) return named
  const id = planId?.trim().toLowerCase() ?? ''
  if (!id) return 'Free'
  return CATALOG_DISPLAY_NAME[id] ?? id.charAt(0).toUpperCase() + id.slice(1)
}

/** The words on the chip. Complimentary keeps the tier and adds the same suffix everywhere. */
export function visiblePlanLabel(input: VisiblePlanInput): string {
  const name = planDisplayName(input.displayName, input.planId)
  if (input.billingMode === 'complimentary') return `${name} (complimentary)`
  return name
}

/** Hover text shared by the header pill, the Team chip, and the sidebar chip. */
export function visiblePlanTitle(input: VisiblePlanInput): string {
  const label = visiblePlanLabel(input)
  if (input.billingMode === 'complimentary') {
    return `${label} — billed by Mushi at no cost. Features follow this tier.`
  }
  return label
}
