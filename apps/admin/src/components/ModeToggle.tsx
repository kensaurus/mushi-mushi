/**
 * FILE: apps/admin/src/components/ModeToggle.tsx
 * PURPOSE: Lean Quick / Beginner / Advanced switch — star density + type-on-hover labels.
 */

import { useEffect, useRef, useState } from 'react'
import type { AdminMode } from '../lib/mode'
import { FloatingHoverTypeLabel } from './PortalSwitcher'
import { Tooltip } from './ui'

const MODE_OPTIONS: Array<{
  id: AdminMode
  label: string
  stars: 1 | 2 | 3
  hint: string
}> = [
  {
    id: 'quickstart',
    label: 'Quick',
    stars: 1,
    hint: 'Quickstart: 3 pages + one big "Resolve next bug" button.',
  },
  {
    id: 'beginner',
    label: 'Beginner',
    stars: 2,
    hint: 'Beginner: 9 essential pages with guided next-best-action.',
  },
  {
    id: 'advanced',
    label: 'Advanced',
    stars: 3,
    hint: 'Advanced: full 23-page console with dense layouts.',
  },
]

function modeIndex(mode: AdminMode): number {
  if (mode === 'quickstart') return 0
  if (mode === 'beginner') return 1
  return 2
}

function ModeStars({ count, active }: { count: 1 | 2 | 3; active: boolean }) {
  return (
    <span className="inline-flex items-center gap-px leading-none" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={[
            'text-3xs leading-none',
            active ? 'text-brand' : 'text-fg-faint group-hover:text-fg-muted',
          ].join(' ')}
        >
          ★
        </span>
      ))}
    </span>
  )
}

function ModeSegment({
  opt,
  active,
  onSelect,
}: {
  opt: (typeof MODE_OPTIONS)[number]
  active: boolean
  onSelect: (next: AdminMode) => void
}) {
  const anchorRef = useRef<HTMLButtonElement>(null)
  const [hover, setHover] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  return (
    <div className="relative z-[1] min-w-0 flex-1">
      <Tooltip content={opt.hint} side="auto" nowrap={false} className="flex min-w-0 w-full">
        <button
          ref={anchorRef}
          type="button"
          role="radio"
          aria-checked={active}
          aria-label={`${opt.label} mode — ${opt.stars} star complexity`}
          onClick={() => onSelect(opt.id)}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onFocus={() => setHover(true)}
          onBlur={() => setHover(false)}
          className={[
            'mode-toggle__seg group relative flex h-7 w-full min-w-0 items-center justify-center',
            'rounded px-1 py-0',
            'motion-safe:transition-[color] motion-safe:duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50',
            active ? 'text-brand' : 'text-fg-muted hover:text-fg-secondary',
          ].join(' ')}
        >
          <ModeStars count={opt.stars} active={active} />
        </button>
      </Tooltip>
      <FloatingHoverTypeLabel
        anchorRef={anchorRef}
        text={opt.label}
        show={hover}
        reducedMotion={reducedMotion}
      />
    </div>
  )
}

export function ModeToggle({
  mode,
  onSelect,
}: {
  mode: AdminMode
  onSelect: (next: AdminMode) => void
}) {
  const idx = modeIndex(mode)

  return (
    <div
      role="radiogroup"
      aria-label="Admin mode"
      data-tour-id="mode-toggle"
      data-active-mode={mode}
      className="mode-toggle relative mt-1 flex w-full min-w-0 items-stretch overflow-visible rounded-md bg-surface-overlay/50 p-px"
    >
      <span
        aria-hidden
        className={[
          'mode-toggle__thumb pointer-events-none absolute inset-y-px left-px',
          'w-[calc(33.333%-1px)] rounded-[3px]',
          'bg-brand/12 ring-1 ring-brand/20',
          'motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out',
          idx === 0 && 'translate-x-0',
          idx === 1 && 'translate-x-[calc(100%+1px)]',
          idx === 2 && 'translate-x-[calc(200%+2px)]',
        ]
          .filter(Boolean)
          .join(' ')}
      />
      {MODE_OPTIONS.map((opt) => (
        <ModeSegment
          key={opt.id}
          opt={opt}
          active={opt.id === mode}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
