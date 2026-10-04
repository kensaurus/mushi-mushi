/**
 * FILE: apps/admin/src/components/integrations/ServiceFavicon.tsx
 * PURPOSE: A service's logo chip on integration cards.
 *
 *          It used to load Google's favicon CDN, but that endpoint redirects
 *          to gstatic.com, which the admin CSP blocks, so production only
 *          ever showed the fallback glyph (and each load told Google which
 *          integrations the operator uses). It now draws the vendored mark
 *          from BrandIcon, matched by the service name first (so "Claude
 *          Code" gets the Claude mark, not its parent company's) and then the
 *          domain. Services with no vendored mark keep their geometric glyph.
 */

import type { ComponentType } from 'react'
import { BrandIcon, resolveBrand } from '../ui/BrandIcon'

interface ServiceFaviconProps {
  /** Service domain, e.g. "sentry.io" */
  domain: string
  /** Service name, e.g. "Sentry" */
  label: string
  /** Glyph for services without a vendored brand mark */
  FallbackIcon: ComponentType<{ size?: number; className?: string }>
  /** Tailwind text-color class applied to the fallback icon, e.g. "text-accent" */
  colorClass?: string
  /** Size of the inner icon in pixels. The chip wrapper is iconSize + 8. Default 14. */
  iconSize?: number
}

export function ServiceFavicon({
  domain,
  label,
  FallbackIcon,
  colorClass = 'text-fg-muted',
  iconSize = 14,
}: ServiceFaviconProps) {
  const chipSize = iconSize + 8 // 14 → 22 px, 16 → 24 px
  const brand = resolveBrand(label) ?? resolveBrand(domain)

  return (
    <span
      aria-hidden="true"
      className={`shrink-0 inline-flex items-center justify-center rounded-md bg-surface-raised border border-edge-subtle ${brand ? 'text-fg' : colorClass}`}
      style={{ width: chipSize, height: chipSize }}
    >
      {brand ? <BrandIcon brand={brand} size={iconSize} decorative /> : <FallbackIcon size={iconSize} />}
    </span>
  )
}
