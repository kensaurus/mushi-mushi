/**
 * FILE: apps/admin/src/components/integrations/ServiceFavicon.tsx
 * PURPOSE: Renders a service's actual brand favicon using Google's favicon CDN.
 *          Displays in a white rounded chip so dark-background pages show
 *          any brand color (even black/dark logos) against a neutral surface.
 *          Falls back to a geometric SVG icon if the favicon fails to load.
 */

import { useState } from 'react'
import type { ComponentType } from 'react'

interface ServiceFaviconProps {
  /** Service domain for Google favicon API, e.g. "sentry.io" */
  domain: string
  /** Accessible label for the image */
  label: string
  /** SVG fallback icon rendered when favicon fails or network is unavailable */
  FallbackIcon: ComponentType<{ size?: number; className?: string }>
  /** Tailwind text-color class applied to the fallback icon, e.g. "text-[#7B5EA7]" */
  colorClass?: string
  /** Size of the inner icon in pixels. The chip wrapper is iconSize + 8. Default 14. */
  iconSize?: number
}

/**
 * Renders a service's actual brand favicon via Google's favicon CDN at 2× for
 * sharpness on high-DPI displays.
 *
 * Uses a white 22 × 22 rounded chip so dark-themed pages keep all brand colors
 * visible — this mirrors the "app icon in a white badge" pattern used by Slack,
 * Linear, and Notion. The fallback (offline / unknown domain) shows the
 * geometric SVG icon in a subtle surface chip.
 */
export function ServiceFavicon({
  domain,
  label,
  FallbackIcon,
  colorClass = 'text-fg-muted',
  iconSize = 14,
}: ServiceFaviconProps) {
  const [failed, setFailed] = useState(false)
  const chipSize = iconSize + 8   // 14 → 22 px, 16 → 24 px

  if (failed) {
    return (
      <span
        aria-hidden="true"
        className={`shrink-0 inline-flex items-center justify-center rounded-md bg-surface-raised border border-edge-subtle ${colorClass}`}
        style={{ width: chipSize, height: chipSize }}
      >
        <FallbackIcon size={iconSize} />
      </span>
    )
  }

  return (
    <span
      aria-hidden="true"
      className="shrink-0 inline-flex items-center justify-center rounded-md overflow-hidden"
      style={{ width: chipSize, height: chipSize, background: '#fff' }}
    >
      <img
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
        width={iconSize}
        height={iconSize}
        alt={label}
        draggable={false}
        onError={() => setFailed(true)}
      />
    </span>
  )
}
