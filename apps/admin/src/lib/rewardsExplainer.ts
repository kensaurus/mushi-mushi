/**
 * Plain-language rewards economy guide.
 */

export interface RewardsEconomyConceptDefinition {
  id: string
  label: string
  plain: string
}

export const REWARDS_ECONOMY_CONCEPTS: RewardsEconomyConceptDefinition[] = [
  {
    id: 'rules',
    label: 'Activity rules',
    plain: 'Points per SDK event (report submitted, screen view, session time) with daily caps to prevent farming.',
  },
  {
    id: 'tiers',
    label: 'Tier ladder',
    plain: 'Contributor ranks (Explorer → Legend) with perks — Pro access, payouts, or host webhook grants.',
  },
  {
    id: 'webhooks',
    label: 'Reward webhooks',
    plain: 'HMAC-signed POST to your backend when points or tier change — wire Stripe roles or in-app credits.',
  },
  {
    id: 'presets',
    label: 'Recommended defaults',
    plain: 'One-click install of report.submitted / report.triaged rules and a four-tier ladder — safe to re-run.',
  },
]

export const REWARDS_EXPLAINER_SUMMARY =
  'Rewards turns SDK activity into points and tiers so reporters come back. Rules award points, tiers unlock perks, and webhooks let your app grant roles or credits automatically.'

export function isRewardsGuideExpanded(topPriority: string | undefined): boolean {
  return (
    topPriority === 'no_org' ||
    topPriority === 'project_disabled' ||
    topPriority === 'no_rules' ||
    topPriority === 'no_contributors' ||
    topPriority === 'webhooks_failing'
  )
}

export function rewardsEconomyConcept(id: string): RewardsEconomyConceptDefinition | undefined {
  return REWARDS_ECONOMY_CONCEPTS.find((c) => c.id === id)
}
