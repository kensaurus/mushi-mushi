/**
 * FILE: apps/admin/src/lib/visiblePlanLabel.ts
 * PURPOSE: One plan label for the header team pill, Team page, and sidebar.
 *
 * OVERVIEW:
 * A complimentary org (Mushi staff / sponsored / beta) keeps a paid tier's
 * entitlements without a Stripe subscription. Naming that "Pro" reads as a
 * paid plan; naming it "Admin" reads as the viewer's role next to the team
 * name. Every surface uses this string instead.
 *
 * DEPENDENCIES: none
 *
 * USAGE:
 * `visiblePlanLabel({ name, complimentary })` — header passes `plan_id`,
 * the Team page and sidebar pass the catalog display name. Both resolve
 * to the same words ("Comp · Pro").
 *
 * NOTES:
 * Paid plans are returned unchanged so the header can keep showing the
 * raw plan id ("pro"), which the pill uppercases.
 */

export function visiblePlanLabel(input: {
  name?: string | null
  complimentary?: boolean
}): string {
  const raw = (input.name ?? '').trim()
  if (input.complimentary) {
    const tier = raw ? titleCasePlanId(raw) : ''
    return tier ? `Comp · ${tier}` : 'Comp'
  }
  return raw || 'Hobby'
}

/**
 * Same label when a tier name exists. With no name, complimentary orgs still
 * say "Comp" and everyone else keeps the caller's fallback ("Hobby", "—").
 */
export function visiblePlanLabelOr(
  name: string | null | undefined,
  complimentary: boolean | undefined,
  fallback: string,
): string {
  const named = (name ?? '').trim()
  if (!named) return complimentary ? 'Comp' : fallback
  return visiblePlanLabel({ name: named, complimentary })
}

/** Plan ids ("pro") title-case; catalog names ("Pro", "Hobby (free)") stay. */
function titleCasePlanId(name: string): string {
  if (name !== name.toLowerCase()) return name
  return name.charAt(0).toUpperCase() + name.slice(1)
}
