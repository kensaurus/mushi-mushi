/**
 * FILE: apps/docs/components/QuickstartGrid.tsx
 * PURPOSE: Platform quickstart cards for the landing page "Try it" section.
 */
'use client'

import { LANDING_QUICKSTART_PLATFORMS, type LandingPlatformCard } from '@/lib/landing-copy'

interface QuickstartGridProps {
  platforms?: readonly LandingPlatformCard[]
}

export function QuickstartGrid({ platforms = LANDING_QUICKSTART_PLATFORMS }: QuickstartGridProps) {
  return (
    <ul className="docs-quickstart-grid not-prose list-none p-0 m-0" aria-label="Platform quickstarts">
      {platforms.map((p) => (
        <li key={p.title} className="list-none">
          <a href={p.href} className="docs-quickstart-card" aria-label={`${p.title} quickstart`}>
            <div className="docs-quickstart-card__header">
              <span className="docs-quickstart-card__icon" aria-hidden="true">
                {p.icon}
              </span>
              <span className="docs-quickstart-card__title">{p.title}</span>
              {p.badge ? (
                <span className="docs-quickstart-card__badge">{p.badge}</span>
              ) : null}
            </div>
            <code className="docs-quickstart-card__cmd">{p.cmd}</code>
            <p className="docs-quickstart-card__desc">{p.desc}</p>
            <span className="docs-quickstart-card__cta" aria-hidden="true">
              Quickstart →
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}
