/**
 * FILE: apps/admin/src/components/DensitySidebarToggle.tsx
 * PURPOSE: 3-way segmented control in the sidebar footer that flips the
 *          global UI density. Compact = more rows per screen (triage
 *          power users); Comfortable = bigger targets (tablet / touch).
 *
 *          Earlier revision used "Cmp / Std / Cmf" text labels, which
 *          users (rightly) reported as "totally the same" — three
 *          3-letter strings with identical bounding boxes carry no
 *          recognisable shape difference at a glance. Replaced with a
 *          stacked-rows glyph where the line count is the metaphor:
 *          4 dense rows → compact, 3 medium → standard, 2 wide → roomy.
 *          Same metaphor used by every modern admin shell (Linear,
 *          Notion, Grafana). Text labels still survive in `title` +
 *          `aria-label` for screen readers and tooltip discoverability.
 */

import type { ComponentType, SVGProps } from 'react'
import { useDensity, type Density } from '../lib/useDensity'

type IconProps = SVGProps<SVGSVGElement>

/**
 * Shared SVG chrome for the three glyphs. Stroke-based, currentColor,
 * 16×16 viewbox so the icons sit on the same baseline as the rest of
 * the sidebar's icon set (`./icons.tsx`).
 */
function GlyphFrame({ children, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

/** 4 dense horizontal rows — "many rows fit on screen". */
function CompactGlyph(props: IconProps) {
  return (
    <GlyphFrame {...props}>
      <line x1="3.5" y1="4" x2="12.5" y2="4" />
      <line x1="3.5" y1="6.5" x2="12.5" y2="6.5" />
      <line x1="3.5" y1="9" x2="12.5" y2="9" />
      <line x1="3.5" y1="11.5" x2="12.5" y2="11.5" />
    </GlyphFrame>
  )
}

/** 3 evenly-spaced rows — "the default rhythm". */
function StandardGlyph(props: IconProps) {
  return (
    <GlyphFrame {...props}>
      <line x1="3.5" y1="4.5" x2="12.5" y2="4.5" />
      <line x1="3.5" y1="8" x2="12.5" y2="8" />
      <line x1="3.5" y1="11.5" x2="12.5" y2="11.5" />
    </GlyphFrame>
  )
}

/** 2 wide rows — "roomy, tablet-friendly". */
function ComfortableGlyph(props: IconProps) {
  return (
    <GlyphFrame {...props}>
      <line x1="3.5" y1="5.5" x2="12.5" y2="5.5" />
      <line x1="3.5" y1="10.5" x2="12.5" y2="10.5" />
    </GlyphFrame>
  )
}

interface Option {
  value: Density
  label: string
  hint: string
  Icon: ComponentType<IconProps>
}

const OPTIONS: Option[] = [
  { value: 'compact',     label: 'Compact',     hint: 'Compact — fits the most rows on screen',           Icon: CompactGlyph },
  { value: 'default',     label: 'Standard',    hint: 'Standard density — default rhythm',                Icon: StandardGlyph },
  { value: 'comfortable', label: 'Comfortable', hint: 'Comfortable — roomier rows, touch-friendly',       Icon: ComfortableGlyph },
]

export function DensitySidebarToggle() {
  const { density, setDensity } = useDensity()
  return (
    <div
      role="radiogroup"
      aria-label="UI density"
      className="flex items-stretch gap-0.5 rounded-sm border border-edge/60 p-0.5"
    >
      {OPTIONS.map(({ value, label, hint, Icon }) => {
        const active = density === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            onClick={() => setDensity(value)}
            title={hint}
            className={`flex-1 flex items-center justify-center rounded-sm px-1 py-1 motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 ${
              active
                ? 'bg-surface-overlay text-brand'
                : 'text-fg-muted hover:text-fg hover:bg-surface-overlay/60'
            }`}
          >
            <Icon />
          </button>
        )
      })}
    </div>
  )
}
