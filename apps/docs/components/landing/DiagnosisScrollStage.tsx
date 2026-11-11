'use client'

/**
 * "How it works" — four steps, each saying what you do and what Mushi Mushi
 * does (ADR 0056), then a link to the sample diagnosis that shows them on one
 * bug. Once-in-view
 * stagger (native scroll, no pin). The full six-stage loop (<LoopPipeline />)
 * lives on /concepts/closed-loop.
 */
import Link from 'next/link'
import { motion } from 'motion/react'
import { LANDING_HOW_IT_WORKS, LANDING_HOW_STEPS, LANDING_SAMPLE_LINK } from '@/lib/landing-copy'
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

      <div className="landing-diagnosis-track landing-diagnosis-track--four">
        {LANDING_HOW_STEPS.map((step) => (
          <LandingStaggerItem key={step.name} className="landing-diagnosis-card">
            <span className="landing-diagnosis-glyph" aria-hidden="true">
              <PillarGlyph glyph={step.glyph} />
            </span>
            <span className="landing-diagnosis-step">{step.step}</span>
            <h3 className="landing-diagnosis-name">{step.name}</h3>
            <p className="landing-diagnosis-role">
              <strong>{LANDING_HOW_IT_WORKS.youLabel}</strong> {step.you}
            </p>
            <p className="landing-diagnosis-role">
              <strong>{LANDING_HOW_IT_WORKS.mushiLabel}</strong> {step.role}
            </p>
          </LandingStaggerItem>
        ))}
      </div>

      <LandingStaggerItem>
        <p className="landing-section-lead">{LANDING_HOW_IT_WORKS.stayInCharge}</p>
      </LandingStaggerItem>

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
