'use client'

/**
 * "How it works" — the landing's one job in three cards (ADR 0052), then a
 * link to the sample diagnosis that shows all three on one bug. Once-in-view
 * stagger (native scroll, no pin). The full six-stage loop (<LoopPipeline />)
 * lives on /concepts/closed-loop.
 */
import Link from 'next/link'
import { motion } from 'motion/react'
import { LANDING_HOW_IT_WORKS, LANDING_PILLARS, LANDING_SAMPLE_LINK } from '@/lib/landing-copy'
import { LandingStagger, LandingStaggerItem } from './landing-stagger'
import { PillarGlyph } from '../PillarGlyph'
import { usePrefersReducedMotion } from './use-prefers-reduced-motion'

export function DiagnosisScrollStage() {
  const reduced = usePrefersReducedMotion()

  return (
    <LandingStagger
      as="section"
      className="landing-diagnosis not-prose"
      rootProps={{ 'aria-labelledby': 'landing-diagnosis-heading' }}
    >
      <LandingStaggerItem>
        <h2 id="landing-diagnosis-heading" className="landing-section-title">
          {LANDING_HOW_IT_WORKS.heading}
        </h2>
      </LandingStaggerItem>

      {reduced ? (
        <div className="landing-diagnosis-progress" aria-hidden="true" />
      ) : (
        <LandingStaggerItem>
          <motion.div
            className="landing-diagnosis-progress"
            aria-hidden="true"
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true, margin: '0px 0px -8% 0px' }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformOrigin: 'left center' }}
          />
        </LandingStaggerItem>
      )}

      <div className="landing-diagnosis-track">
        {LANDING_PILLARS.map((pillar) => (
          <LandingStaggerItem key={pillar.name} className="landing-diagnosis-card">
            <span className="landing-diagnosis-glyph" aria-hidden="true">
              <PillarGlyph glyph={pillar.glyph} />
            </span>
            <span className="landing-diagnosis-step">{pillar.step}</span>
            <h3 className="landing-diagnosis-name">{pillar.name}</h3>
            <p className="landing-diagnosis-role">{pillar.role}</p>
          </LandingStaggerItem>
        ))}
      </div>

      <LandingStaggerItem>
        <p className="landing-section-lead landing-diagnosis-sample">
          {LANDING_HOW_IT_WORKS.sampleLead}{' '}
          <Link href={LANDING_SAMPLE_LINK.href} data-mushi-cta="landing-how-sample" data-mushi-location="how-it-works">
            {LANDING_SAMPLE_LINK.label} →
          </Link>
        </p>
      </LandingStaggerItem>
    </LandingStagger>
  )
}
