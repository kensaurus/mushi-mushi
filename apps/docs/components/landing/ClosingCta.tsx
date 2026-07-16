'use client'

/**
 * Closing CTA — solo primary path + team operators link (no scroll hijack).
 */
import Link from 'next/link'
import { motion, useReducedMotion } from 'motion/react'
import { LANDING_OPERATOR } from '@/lib/landing-copy'
import {
  LandingStagger,
  LandingStaggerItem,
  landingStampVariants,
} from './landing-stagger'

export function ClosingCta() {
  const reduced = useReducedMotion()

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
            <Link className="landing-closing-link" href={LANDING_OPERATOR.soloHref}>
              {LANDING_OPERATOR.soloCta}
            </Link>
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
