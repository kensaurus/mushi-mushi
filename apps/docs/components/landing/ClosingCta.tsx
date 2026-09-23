'use client'

/**
 * Closing CTA — solo primary path + team operators link (no scroll hijack).
 */
import Link from 'next/link'
import { motion } from 'motion/react'
import { LANDING_OPERATOR } from '@/lib/landing-copy'
import {
  LandingStagger,
  LandingStaggerItem,
  landingStampVariants,
} from './landing-stagger'
import { usePrefersReducedMotion } from './use-prefers-reduced-motion'

export function ClosingCta() {
  const reduced = usePrefersReducedMotion()

  return (
    <LandingStagger
      as="section"
      className="landing-closing not-prose"
      rootProps={{ 'aria-labelledby': 'landing-closing-heading' }}
    >
      {reduced ? (
        <span className="landing-closing-stamp" aria-hidden="true">
          虫
        </span>
      ) : (
        <motion.span
          className="landing-closing-stamp"
          aria-hidden="true"
          variants={landingStampVariants}
        >
          虫
        </motion.span>
      )}
      <div className="landing-closing__copy">
        <LandingStaggerItem>
          <h2 id="landing-closing-heading" className="landing-section-title">
            {LANDING_OPERATOR.question}
          </h2>
        </LandingStaggerItem>
        <LandingStaggerItem>
          <p className="landing-closing-cta">
            {/* Console signup is another app — plain <a>, same tab, tracked. */}
            {LANDING_OPERATOR.soloHref.startsWith('http') ? (
              <a
                className="landing-closing-link"
                href={LANDING_OPERATOR.soloHref}
                data-mushi-cta={LANDING_OPERATOR.soloCtaId}
                data-mushi-location="closing"
              >
                {LANDING_OPERATOR.soloCta}
              </a>
            ) : (
              <Link
                className="landing-closing-link"
                href={LANDING_OPERATOR.soloHref}
                data-mushi-cta={LANDING_OPERATOR.soloCtaId}
                data-mushi-location="closing"
              >
                {LANDING_OPERATOR.soloCta}
              </Link>
            )}
          </p>
        </LandingStaggerItem>
        <LandingStaggerItem>
          <p className="landing-section-lead landing-closing-team">
            {LANDING_OPERATOR.teamLead}{' '}
            <a
              href={LANDING_OPERATOR.teamHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              {LANDING_OPERATOR.teamCta}
            </a>
          </p>
        </LandingStaggerItem>
      </div>
    </LandingStagger>
  )
}
