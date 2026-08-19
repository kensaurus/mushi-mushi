/** Platform quickstart cards for the landing "Try it" section. */
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { LANDING_QUICKSTART_PLATFORMS, type LandingPlatformCard } from '@/lib/landing-copy'

interface QuickstartGridProps {
  platforms?: readonly LandingPlatformCard[]
}

/**
 * Real product logo for a quickstart card, falling back to the Mushi mark.
 *
 * Every card used to render the same brand mark, so the React, MCP and mobile
 * tiles were visually identical — the page asserted "we support your stack"
 * while showing no evidence of it. Logos come from the CC0 Simple Icons CDN
 * and are used nominatively to identify each supported platform.
 */
function PlatformIcon({ platform }: { platform: LandingPlatformCard }) {
  const [failed, setFailed] = useState(false)
  const slug = platform.iconSlug

  if (slug && !failed) {
    const color = platform.iconColor ? `/${platform.iconColor}` : ''
    return (
      <img
        src={`https://cdn.simpleicons.org/${slug}${color}`}
        alt=""
        width={20}
        height={20}
        loading="lazy"
        className="docs-quickstart-card__icon-img"
        onError={() => setFailed(true)}
      />
    )
  }

  if (platform.icon.startsWith('/') || platform.icon.startsWith('http')) {
    return (
      <img
        src={platform.icon}
        alt=""
        width={20}
        height={20}
        className="docs-quickstart-card__icon-img"
      />
    )
  }
  return <>{platform.icon}</>
}

export function QuickstartGrid({ platforms = LANDING_QUICKSTART_PLATFORMS }: QuickstartGridProps) {
  return (
    <ul className="docs-quickstart-grid not-prose list-none p-0 m-0" aria-label="Platform quickstarts">
      {platforms.map((p) => (
        <li key={p.title} className="list-none">
          <Link href={p.href} className="docs-quickstart-card" aria-label={`${p.title} quickstart`}>
            <div className="docs-quickstart-card__header">
              <span className="docs-quickstart-card__icon" aria-hidden="true">
                <PlatformIcon platform={p} />
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
          </Link>
        </li>
      ))}
    </ul>
  )
}
