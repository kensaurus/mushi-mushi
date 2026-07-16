'use client'

/**
 * Diagnosis loop cards — once-in-view stagger (native scroll, no pin).
 */
import { motion, useReducedMotion } from 'motion/react'
import { LANDING_PILLARS } from '@/lib/landing-copy'
import { LandingStagger, LandingStaggerItem } from './landing-stagger'

export function DiagnosisScrollStage() {
  const reduced = useReducedMotion()

  return (
    <LandingStagger
      as="section"
      className="landing-diagnosis not-prose"
      rootProps={{ 'aria-labelledby': 'landing-diagnosis-heading' }}
    >
      <LandingStaggerItem>
        <h2 id="landing-diagnosis-heading" className="landing-section-title">
          What happens after a user reports something
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
            <span className="landing-diagnosis-step">{pillar.step}</span>
            <h3 className="landing-diagnosis-name">{pillar.name}</h3>
            <p className="landing-diagnosis-role">{pillar.role}</p>
          </LandingStaggerItem>
        ))}
      </div>
    </LandingStagger>
  )
}
