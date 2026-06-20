/**
 * FILE: apps/admin/src/components/ProjectFavicon.tsx
 * PURPOSE: Project avatar for the switcher + project list — shows the
 *          monitored app's real favicon when we know its origin, otherwise
 *          a deterministic initials chip so glot.it vs yen-yen are still
 *          distinguishable at a glance.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  isLikelyGenericFavicon,
  isUntrustedFaviconUrl,
  projectFaviconUrlCandidates,
  resolveProjectDomain,
  type ProjectFaviconSource,
} from '@mushi-mushi/core'
import { IconProjects } from './icons'
import { projectInitials, projectInitialsChipClass } from '../lib/resolveProjectDomain'

interface ProjectFaviconProps extends ProjectFaviconSource {
  /** Inner icon size — chip wrapper is size + 8px. Default 16. */
  size?: number
  className?: string
}

export function ProjectFavicon({
  size = 16,
  className = '',
  icon_url,
  ...source
}: ProjectFaviconProps) {
  const domain = resolveProjectDomain({ ...source, icon_url })
  const chipSize = size + 8
  const label = `${source.project_name} icon`

  const candidates = projectFaviconUrlCandidates({ ...source, icon_url }, Math.max(32, size * 2))

  const [candidateIndex, setCandidateIndex] = useState(0)
  const [exhausted, setExhausted] = useState(false)

  useEffect(() => {
    setCandidateIndex(0)
    setExhausted(false)
  }, [domain, icon_url, source.project_id, candidates.length])

  const advance = useCallback(() => {
    setCandidateIndex((i) => {
      if (i + 1 < candidates.length) return i + 1
      setExhausted(true)
      return i
    })
  }, [candidates.length])

  const src = candidates[candidateIndex]

  if (!candidates.length || exhausted) {
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
      title={domain ?? source.project_name}
    >
      <img
        key={src}
        src={src}
        width={size}
        height={size}
        alt={label}
        draggable={false}
        referrerPolicy="no-referrer"
        onError={advance}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (isUntrustedFaviconUrl(img.src) || isLikelyGenericFavicon(img)) advance();
        }}
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
