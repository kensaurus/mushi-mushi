/**
 * FILE: apps/admin/src/components/ProjectFavicon.tsx
 * PURPOSE: Project avatar for the switcher + project list — shows the
 *          monitored app's real favicon when we know its origin, otherwise
 *          a deterministic initials chip so glot.it vs yen-yen are still
 *          distinguishable at a glance.
 */

import { useState } from 'react'
import { IconProjects } from './icons'
import {
  projectInitials,
  projectInitialsChipClass,
  resolveProjectDomain,
  type ProjectFaviconSource,
} from '../lib/resolveProjectDomain'

interface ProjectFaviconProps extends ProjectFaviconSource {
  /** Inner icon size — chip wrapper is size + 8px. Default 16. */
  size?: number
  className?: string
}

export function ProjectFavicon({
  size = 16,
  className = '',
  ...source
}: ProjectFaviconProps) {
  const [failed, setFailed] = useState(false)
  const domain = resolveProjectDomain(source)
  const chipSize = size + 8
  const label = `${source.project_name} icon`

  if (!domain || failed) {
    const initials = projectInitials(source.project_name)
    const theme = projectInitialsChipClass(source.project_id)
    return (
      <span
        aria-hidden="true"
        title={domain ? `${source.project_name} (favicon unavailable)` : source.project_name}
        className={`shrink-0 inline-flex items-center justify-center rounded-md border font-semibold leading-none ${theme} ${className}`}
        style={{ width: chipSize, height: chipSize, fontSize: Math.max(9, size - 7) }}
      >
        {initials}
      </span>
    )
  }

  return (
    <span
      aria-hidden="true"
      className={`shrink-0 inline-flex items-center justify-center rounded-md overflow-hidden border border-edge-subtle/70 bg-white ${className}`}
      style={{ width: chipSize, height: chipSize }}
      title={domain}
    >
      <img
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`}
        width={size}
        height={size}
        alt={label}
        draggable={false}
        onError={() => setFailed(true)}
      />
      <span className="sr-only">{label}</span>
    </span>
  )
}

/** Neutral mushi glyph — used when no project is selected yet. */
export function ProjectFaviconPlaceholder({ size = 16, className = '' }: { size?: number; className?: string }) {
  const chipSize = size + 8
  return (
    <span
      aria-hidden="true"
      className={`shrink-0 inline-flex items-center justify-center rounded-md border border-edge-subtle bg-surface-overlay text-fg-muted ${className}`}
      style={{ width: chipSize, height: chipSize }}
    >
      <IconProjects size={size} />
    </span>
  )
}
