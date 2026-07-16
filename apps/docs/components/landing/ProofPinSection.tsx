'use client'

/**
 * Install proof terminal — once-in-view line stagger (native scroll).
 */
import { LANDING_SIXTY_SECOND, LANDING_SIXTY_SECOND_STEPS } from '@/lib/landing-copy'
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
          {LANDING_SIXTY_SECOND_STEPS.heading}
        </h2>
      </LandingStaggerItem>
      <LandingStaggerItem>
        <p className="landing-section-lead">
          {LANDING_SIXTY_SECOND.intro} {LANDING_SIXTY_SECOND.afterBreak}
        </p>
      </LandingStaggerItem>

      <LandingStaggerItem>
        <ol className="docs-pillars not-prose" aria-label="Get started steps">
          {LANDING_SIXTY_SECOND_STEPS.steps.map((step, i) => (
            <li key={step.title} className="docs-pillar">
              <span className="docs-pillar__step">{`Step ${i + 1}`}</span>
              <span className="docs-pillar__name">{step.title}</span>
              <span className="docs-pillar__role">{step.desc}</span>
              {i < LANDING_SIXTY_SECOND_STEPS.steps.length - 1 ? (
                <span className="docs-pillar__connector" aria-hidden="true" />
              ) : null}
            </li>
          ))}
        </ol>
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
