/**
 * Landing pricing strip — four plans at a glance, then /pricing for the
 * estimator. Prices and limits come from PRICING_TIERS so this strip, the
 * pricing table and /cloud cannot disagree.
 */
import Link from 'next/link'
import { LANDING_PRICING_STRIP } from '@/lib/landing-copy'
import { PRICING_TIERS, type PricingTierRow } from '@/lib/public-copy'

const tiers = LANDING_PRICING_STRIP.tierIds
  .map((id) => PRICING_TIERS.find((t) => t.id === id))
  .filter((t): t is PricingTierRow => t !== undefined)

export function PricingStrip() {
  return (
    <section className="landing-pricing not-prose" aria-labelledby="landing-pricing-heading">
      <h2 id="landing-pricing-heading" className="landing-section-title">
        {LANDING_PRICING_STRIP.heading}
      </h2>
      <p className="landing-section-lead">{LANDING_PRICING_STRIP.lead}</p>
      <ul className="landing-pricing__tiers">
        {tiers.map((tier) => (
          <li key={tier.id} className="landing-pricing__tier">
            <span className="landing-pricing__name">{tier.name}</span>
            <span className="landing-pricing__price">{tier.monthly}</span>
            <span className="landing-pricing__quota">Diagnoses: {tier.diagnoses}</span>
          </li>
        ))}
      </ul>
      <Link
        className="landing-hero-cta landing-hero-cta--secondary"
        href={LANDING_PRICING_STRIP.href}
        data-mushi-cta={LANDING_PRICING_STRIP.ctaId}
        data-mushi-location="pricing-strip"
      >
        {LANDING_PRICING_STRIP.cta}
      </Link>
    </section>
  )
}
