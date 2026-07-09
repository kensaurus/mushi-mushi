/** A 4-up rhythmic strip of named pipeline stages used on the docs */

import { LANDING_PILLARS, type LandingPillar } from '@/lib/landing-copy'

interface PillarsProps {
  items?: readonly LandingPillar[]
}

export function Pillars({ items = LANDING_PILLARS }: PillarsProps) {
  return (
    <ol className="docs-pillars not-prose" aria-label="The Mushi loop">
      {items.map((p, i) => (
        <li key={p.name} className="docs-pillar">
          <span className="docs-pillar__step">{p.step}</span>
          <span className="docs-pillar__name">{p.name}</span>
          <span className="docs-pillar__role">{p.role}</span>
          {i < items.length - 1 ? (
            <span className="docs-pillar__connector" aria-hidden="true" />
          ) : null}
        </li>
      ))}
    </ol>
  )
}
