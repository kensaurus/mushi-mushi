import Link from 'next/link'
import { PRICING_TIERS, PRICING_TIER_CTAS } from '@/lib/public-copy'

/** "Get started" cell — tracked CTA per tier (`cta_click.cta_id = pricing-tier-<id>`). */
function TierCta({ tierId, location = 'pricing-table' }: { tierId: string; location?: string }) {
  const cta = PRICING_TIER_CTAS[tierId]
  if (!cta) return <>—</>
  const tracking = {
    'data-mushi-cta': `pricing-tier-${tierId}`,
    'data-mushi-location': location,
    // plan_selected for the 60-day price test (lib/site-analytics.ts planSelectionFromCta).
    'data-mushi-plan': tierId,
  } as const
  if (cta.external) {
    return (
      <a className="docs-pricing-tier-cta" href={cta.href} {...tracking}>
        {cta.label}
      </a>
    )
  }
  return (
    <Link className="docs-pricing-tier-cta" href={cta.href} {...tracking}>
      {cta.label}
    </Link>
  )
}

/** The self-serve plans, shown as cards before the full table on /pricing. */
const CARD_TIER_IDS = ['free', 'indie', 'pro'] as const

/** Plan cards for the top of /pricing: how many apps, how many bugs explained, the price. */
export function PricingPlanCards() {
  const tiers = CARD_TIER_IDS.map((id) => PRICING_TIERS.find((t) => t.id === id)).filter(
    (t): t is (typeof PRICING_TIERS)[number] => t !== undefined,
  )
  return (
    <ul className="not-prose m-0 grid list-none gap-3 p-0 sm:grid-cols-3">
      {tiers.map((tier) => (
        <li key={tier.id} className="landing-diagnosis-card">
          <span className="landing-diagnosis-name">{tier.name}</span>
          <span className="text-2xl font-semibold">{tier.monthly}</span>
          <span className="landing-diagnosis-role">{tier.plain}</span>
          <TierCta tierId={tier.id} location="pricing-cards" />
        </li>
      ))}
    </ul>
  )
}

/** Self-serve plans first, then Enterprise, then Self-host. */
const TABLE_ORDER = ['free', 'indie', 'pro', 'enterprise', 'self-host']
const rank = (id: string) => {
  const i = TABLE_ORDER.indexOf(id)
  return i < 0 ? TABLE_ORDER.length : i
}

/** Full plan table for /pricing — sourced from PRICING_TIERS SSOT. */
export function PricingTiersTable() {
  return (
    <table>
      <thead>
        <tr>
          <th>Plan</th>
          <th>Apps</th>
          <th>Monthly</th>
          <th>Annual (2 mo free)</th>
          <th>Diagnoses</th>
          <th>Retention</th>
          <th>Seats</th>
          <th>What you get</th>
          <th>Get started</th>
        </tr>
      </thead>
      <tbody>
        {[...PRICING_TIERS].sort((a, b) => rank(a.id) - rank(b.id)).map((tier) => (
          <tr key={tier.id}>
            <td>
              <strong>{tier.name}</strong>
            </td>
            <td>{tier.apps}</td>
            <td>{tier.monthly}</td>
            <td>{tier.annual ?? '—'}</td>
            <td>{tier.diagnoses}</td>
            <td>{tier.retention ?? '—'}</td>
            <td>{tier.seats ?? '—'}</td>
            <td>{tier.highlights}</td>
            <td>
              <TierCta tierId={tier.id} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Compact plan table for /cloud — same tier facts, fewer columns. */
export function CloudPlansTable() {
  return (
    <table>
      <thead>
        <tr>
          <th>Plan</th>
          <th>Apps</th>
          <th>Cost</th>
          <th>Diagnoses included</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        {PRICING_TIERS.filter((t) => t.id !== 'self-host').map((tier) => (
          <tr key={tier.id}>
            <td>
              <strong>{tier.name}</strong>
            </td>
            <td>{tier.apps}</td>
            <td>{tier.cloudCost ?? tier.monthly}</td>
            <td>{tier.diagnoses}</td>
            <td>{tier.cloudNotes ?? tier.highlights}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
