/**
 * Sticky in-page section jumper using SegmentedControl chrome.
 * Scrolls to anchor targets and tracks the active section via IntersectionObserver.
 */

import { useEffect, useState } from 'react'
import { SegmentedControl } from '../ui'
import { BETA_BANNER_OFFSET_VAR } from '../../lib/appChrome'

export interface SectionAnchor {
  id: string
  label: string
}

interface SectionAnchorNavProps {
  sections: readonly SectionAnchor[]
  ariaLabel?: string
  className?: string
}

export function SectionAnchorNav({
  sections,
  ariaLabel = 'Page sections',
  className = '',
}: SectionAnchorNavProps) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? '')

  useEffect(() => {
    if (sections.length === 0) return

    const observers: IntersectionObserver[] = []
    const visible = new Map<string, number>()

    for (const section of sections) {
      const el = document.getElementById(section.id)
      if (!el) continue

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              visible.set(section.id, entry.intersectionRatio)
            } else {
              visible.delete(section.id)
            }
          }
          if (visible.size === 0) return
          let bestId = sections[0]!.id
          let bestRatio = -1
          for (const [id, ratio] of visible) {
            if (ratio > bestRatio) {
              bestRatio = ratio
              bestId = id
            }
          }
          setActiveId(bestId)
        },
        { rootMargin: '-20% 0px -55% 0px', threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
      )
      observer.observe(el)
      observers.push(observer)
    }

    return () => {
      for (const o of observers) o.disconnect()
    }
  }, [sections])

  function scrollTo(id: string) {
    const el = document.getElementById(id)
    if (!el) return
    setActiveId(id)
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (sections.length === 0) return null

  return (
    <nav
      aria-label={ariaLabel}
      className={`sticky z-10 -mx-1 border-b border-edge-subtle bg-surface/95 px-1 py-2 backdrop-blur-sm supports-[backdrop-filter]:bg-surface/80 ${className}`}
      style={{ top: `var(${BETA_BANNER_OFFSET_VAR}, 0px)` }}
    >
      <SegmentedControl
        value={activeId}
        options={sections.map((s) => ({ id: s.id, label: s.label }))}
        onChange={scrollTo}
        ariaLabel={ariaLabel}
        size="sm"
        scrollable
      />
    </nav>
  )
}
