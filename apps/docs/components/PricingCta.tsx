import { PRICING_CTA } from '@/lib/public-copy'

interface PricingCtaProps {
  /** Where on /pricing this instance sits — becomes `cta_click.location`. */
  location: 'pricing-top' | 'pricing-bottom'
}

/**
 * Primary "start free" button for /pricing, rendered twice (under the lede
 * and at the foot). Same `cta_id` both times; `location` tells them apart.
 * Plain anchor (not next/link) — the console is a different app.
 */
export function PricingCta({ location }: PricingCtaProps) {
  return (
    <p className="docs-pricing-cta not-prose">
      <a
        className="landing-hero-cta landing-hero-cta--primary"
        href={PRICING_CTA.href}
        data-mushi-cta="pricing-start"
        data-mushi-location={location}
      >
        {PRICING_CTA.label}
      </a>
      <span className="docs-pricing-cta__note">{PRICING_CTA.note}</span>
    </p>
  )
}
