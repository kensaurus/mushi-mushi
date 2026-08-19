/** Platform quickstart cards for the landing "Try it" section. */
'use client'

import Link from 'next/link'
import { LANDING_QUICKSTART_PLATFORMS, MUSHI_DOCS_BASE, type LandingPlatformCard } from '@/lib/landing-copy'

interface QuickstartGridProps {
  platforms?: readonly LandingPlatformCard[]
}

/**
 * Real product logo for a quickstart card, falling back to the Mushi mark.
 *
 * Every card used to render the same brand mark, so the React, MCP and mobile
 * tiles were visually identical — the page asserted "we support your stack"
 * while showing no evidence of it.
 *
 * Served from `public/brand/platforms/`, never a CDN. The docs CSP is
 * `img-src 'self' data: blob: https://*.supabase.co`, so a third-party image
 * host is blocked outright — and because the failure mode is a silent
 * per-image fallback, it would have quietly restored the identical-tiles
 * state it was meant to fix. Rendered as a CSS mask so the single-path CC0
 * mark takes its brand colour without shipping a second coloured copy.
 */
function PlatformIcon({ platform }: { platform: LandingPlatformCard }) {
  const { iconSlug, iconColor, icon } = platform

  if (iconSlug) {
    const url = `${MUSHI_DOCS_BASE}/brand/platforms/${iconSlug}.svg`
    return (
      <span
        className="docs-quickstart-card__icon-img"
        style={{
          display: 'inline-block',
          width: 20,
          height: 20,
          backgroundColor: iconColor ?? 'currentColor',
          WebkitMaskImage: `url(${url})`,
          maskImage: `url(${url})`,
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
        }}
      />
    )
  }

  if (icon.startsWith('/') || icon.startsWith('http')) {
    return (
      <img src={icon} alt="" width={20} height={20} className="docs-quickstart-card__icon-img" />
    )
  }
  return <>{icon}</>
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
