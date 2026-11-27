/**
 * FILE: apps/admin/src/components/timeline/CompareSlider.tsx
 * PURPOSE: Before/after comparison of one screen (Timeline, ADR 0072). The
 *          older shot sits underneath; the newer one is revealed to the right
 *          of a handle the person drags. The control is a native range input
 *          laid over the images, so pointer, touch, keyboard and screen
 *          readers all work without extra code: arrows move 2 %, Shift+arrow
 *          10 %, Page Up/Down 25 %, Home/End to the edges.
 *
 *          No animation on the handle: it follows the pointer directly, so
 *          prefers-reduced-motion has nothing to turn off here.
 */

import { useId, useState } from 'react'
import { Badge } from '../ui'
import { sliderStep } from '../../lib/timeline'

export interface CompareShot {
  url: string
  label: string
}

export function CompareSlider({ before, after, screen, mobile = false }: { before: CompareShot; after: CompareShot; screen: string; mobile?: boolean }) {
  const [pos, setPos] = useState(50)
  const [focused, setFocused] = useState(false)
  const id = useId()
  return (
    <figure className="flex flex-col gap-1.5">
      <div
        className={`relative w-full select-none overflow-hidden rounded-md border border-edge-subtle bg-surface-raised ${mobile ? 'mx-auto aspect-9/16 max-w-xs' : 'aspect-video'}`}
      >
        <img src={before.url} alt={`${screen}, ${before.label}`} className="absolute inset-0 h-full w-full object-cover object-top" draggable={false} />
        <img
          src={after.url}
          alt={`${screen}, ${after.label}`}
          className="absolute inset-0 h-full w-full object-cover object-top"
          style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
          draggable={false}
        />
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          step={1}
          value={pos}
          onChange={(e) => setPos(Number(e.target.value))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            const next = sliderStep(e.key, e.shiftKey, pos)
            if (next == null) return
            e.preventDefault()
            setPos(next)
          }}
          aria-label={`Compare ${screen}: ${before.label} on the left, ${after.label} on the right`}
          aria-valuetext={`${100 - pos}% shows ${after.label}`}
          className="absolute inset-0 z-10 h-full w-full cursor-ew-resize opacity-0"
        />
        {/* The handle: a line and a grip, drawn where the input's value is. */}
        <div aria-hidden className="pointer-events-none absolute inset-y-0 z-20 w-0" style={{ left: `${pos}%` }}>
          <div className="absolute inset-y-0 -left-px w-0.5 bg-fg shadow-card" />
          <div className={`absolute left-0 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-surface text-xs font-semibold text-fg shadow-card ${focused ? 'ring-2 ring-brand ring-offset-2 ring-offset-surface' : ''}`}>
            ⇆
          </div>
        </div>
        <div className="pointer-events-none absolute left-2 top-2 z-20">
          <Badge tone="neutral">{before.label}</Badge>
        </div>
        <div className="pointer-events-none absolute right-2 top-2 z-20">
          <Badge tone="brand">{after.label}</Badge>
        </div>
      </div>
      <figcaption className="text-2xs text-fg-muted">
        <label htmlFor={id}>Drag the handle, or focus it and use the arrow keys, to compare.</label>
      </figcaption>
    </figure>
  )
}
