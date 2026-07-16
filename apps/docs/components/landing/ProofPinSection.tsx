'use client'

/**
 * Install proof terminal — once-in-view line stagger (native scroll).
 */
import { LANDING_SIXTY_SECOND } from '@/lib/landing-copy'
import { LandingStagger, LandingStaggerItem } from './landing-stagger'

const LINES = [
  { prompt: '$', cmd: 'npx mushi-mushi' },
  { prompt: '→', cmd: 'detects framework · writes env · prints snippet' },
  { prompt: '$', cmd: 'npx mushi-mushi setup --ide cursor' },
  { prompt: '→', cmd: 'ask Cursor: "what\'s broken in prod?"' },
] as const

export function ProofPinSection() {
  return (
    <LandingStagger
      as="section"
      className="landing-proof not-prose"
      rootProps={{ 'aria-labelledby': 'landing-proof-heading' }}
    >
      <LandingStaggerItem>
        <h2 id="landing-proof-heading" className="landing-section-title">
          60-second proof
        </h2>
      </LandingStaggerItem>
      <LandingStaggerItem>
        <p className="landing-section-lead">
          {LANDING_SIXTY_SECOND.intro} {LANDING_SIXTY_SECOND.afterBreak}
        </p>
      </LandingStaggerItem>

      <div className="landing-proof-terminal">
        {LINES.map((line) => (
          <LandingStaggerItem key={line.cmd} className="landing-proof-line">
            <span className="landing-proof-prompt" aria-hidden="true">
              {line.prompt}
            </span>
            <code>{line.cmd}</code>
          </LandingStaggerItem>
        ))}
      </div>

      <LandingStaggerItem>
        <p className="landing-proof-pricing">
          <strong>{LANDING_SIXTY_SECOND.pricing}</strong>
        </p>
      </LandingStaggerItem>
    </LandingStagger>
  )
}
