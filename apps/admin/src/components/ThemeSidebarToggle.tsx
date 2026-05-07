/**
 * FILE: apps/admin/src/components/ThemeSidebarToggle.tsx
 * PURPOSE: Dark / light / system theme toggle in the sidebar footer.
 *          Renders the same three-segment control as the density toggle
 *          so the two sit flush and read as a matched pair.
 *
 *          Earlier revision used "Dark / Light / Auto" text labels —
 *          three near-identical 4-letter strings the user reported as
 *          indistinguishable at a glance. Replaced with the universally-
 *          recognised moon / sun / split-disc trio (macOS Sonoma,
 *          Linear, GitHub, Vercel all converged on this triplet for
 *          the same reason). Text labels survive in `title` + `aria-label`
 *          for screen readers and tooltip discoverability.
 */

import type { SVGProps } from 'react'
import { useTheme, type Theme } from '../lib/useTheme'

type IconProps = SVGProps<SVGSVGElement>

/** Shared SVG chrome for the three glyphs. */
function GlyphFrame({ children, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

/**
 * Crescent moon — drawn as a single subtraction path so the unfilled
 * region between the two arcs reads as the moon's lit edge. Filled
 * with currentColor so the active-state colour swap (text-brand)
 * paints the moon directly. Same shape every modern dashboard ships.
 */
function MoonGlyph(props: IconProps) {
  return (
    <GlyphFrame {...props}>
      <path
        d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"
        fill="currentColor"
        stroke="currentColor"
      />
    </GlyphFrame>
  )
}

/**
 * Sun — solid disc + 8 stroked rays. Rays stop short of the disc to
 * keep the icon legible at 14px (overlapping rays would smear). Disc
 * is filled with currentColor for the same active-state colour swap.
 */
function SunGlyph(props: IconProps) {
  return (
    <GlyphFrame {...props}>
      <circle cx="8" cy="8" r="3" fill="currentColor" stroke="currentColor" />
      <line x1="8" y1="1.5" x2="8" y2="3" />
      <line x1="8" y1="13" x2="8" y2="14.5" />
      <line x1="1.5" y1="8" x2="3" y2="8" />
      <line x1="13" y1="8" x2="14.5" y2="8" />
      <line x1="3.4" y1="3.4" x2="4.5" y2="4.5" />
      <line x1="11.5" y1="11.5" x2="12.6" y2="12.6" />
      <line x1="3.4" y1="12.6" x2="4.5" y2="11.5" />
      <line x1="11.5" y1="4.5" x2="12.6" y2="3.4" />
    </GlyphFrame>
  )
}

/**
 * Auto / system — half-filled disc. The right hemisphere is filled,
 * the left is outlined: a visual metaphor for "switches between dark
 * and light". macOS, GitHub, and Linear all converged on this exact
 * shape for the system-follows option.
 */
function AutoGlyph(props: IconProps) {
  return (
    <GlyphFrame {...props}>
      <circle cx="8" cy="8" r="5" stroke="currentColor" />
      <path d="M8 3a5 5 0 0 1 0 10z" fill="currentColor" stroke="currentColor" />
    </GlyphFrame>
  )
}

interface Option {
  value: Theme
  label: string
  hint: string
  Icon: (p: IconProps) => JSX.Element
}

const OPTIONS: Option[] = [
  { value: 'dark',   label: 'Dark theme',   hint: 'Dark theme — designed for low-light triage', Icon: MoonGlyph },
  { value: 'light',  label: 'Light theme',  hint: 'Light theme — high ambient light / printing', Icon: SunGlyph },
  { value: 'system', label: 'System theme', hint: 'Follow OS appearance', Icon: AutoGlyph },
]

export function ThemeSidebarToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex items-stretch gap-0.5 rounded-sm border border-edge/60 p-0.5"
    >
      {OPTIONS.map(({ value, label, hint, Icon }) => {
        const active = theme === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            onClick={() => setTheme(value)}
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
