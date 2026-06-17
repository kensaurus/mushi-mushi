/**
 * FILE: apps/admin/src/components/SidebarFooterControls.tsx
 * PURPOSE: Sidebar footer — density row + theme/focus row with sliding pill tracks.
 */

import type { ComponentType, SVGProps } from 'react'
import { useDensity, type Density } from '../lib/useDensity'
import { useTheme, type ResolvedTheme } from '../lib/useTheme'
import { MicroSegmentCell, MicroSegmentedTrack } from './sidebar/MicroSegmentedTrack'
import { MICRO_SEG, MICRO_TRACK, microSegActive } from './sidebar/SidebarMicroChrome'

type IconProps = SVGProps<SVGSVGElement>

function Glyph({ children, size = 12, ...rest }: IconProps & { size?: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

function CompactGlyph(p: IconProps) {
  return (
    <Glyph {...p}>
      <line x1="3.5" y1="4" x2="12.5" y2="4" />
      <line x1="3.5" y1="6.5" x2="12.5" y2="6.5" />
      <line x1="3.5" y1="9" x2="12.5" y2="9" />
      <line x1="3.5" y1="11.5" x2="12.5" y2="11.5" />
    </Glyph>
  )
}
function StandardGlyph(p: IconProps) {
  return (
    <Glyph {...p}>
      <line x1="3.5" y1="4.5" x2="12.5" y2="4.5" />
      <line x1="3.5" y1="8" x2="12.5" y2="8" />
      <line x1="3.5" y1="11.5" x2="12.5" y2="11.5" />
    </Glyph>
  )
}
function ComfortableGlyph(p: IconProps) {
  return (
    <Glyph {...p}>
      <line x1="3.5" y1="5.5" x2="12.5" y2="5.5" />
      <line x1="3.5" y1="10.5" x2="12.5" y2="10.5" />
    </Glyph>
  )
}
function MoonGlyph(p: IconProps) {
  return (
    <Glyph {...p}>
      <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" fill="currentColor" stroke="currentColor" />
    </Glyph>
  )
}
function SunGlyph(p: IconProps) {
  return (
    <Glyph {...p}>
      <circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="currentColor" />
      <line x1="8" y1="2" x2="8" y2="3.5" />
      <line x1="8" y1="12.5" x2="8" y2="14" />
      <line x1="2" y1="8" x2="3.5" y2="8" />
      <line x1="12.5" y1="8" x2="14" y2="8" />
    </Glyph>
  )
}
function FocusGlyph(p: IconProps) {
  return (
    <Glyph {...p} strokeWidth={1.6}>
      <path d="M2.5 5V3.5a1 1 0 0 1 1-1H5" />
      <path d="M11 2.5h1.5a1 1 0 0 1 1 1V5" />
      <path d="M13.5 11v1.5a1 1 0 0 1-1 1H11" />
      <path d="M5 13.5H3.5a1 1 0 0 1-1-1V11" />
      <circle cx="8" cy="8" r="1" fill="currentColor" stroke="currentColor" />
    </Glyph>
  )
}

const DENSITY: Array<{ value: Density; label: string; hint: string; Icon: ComponentType<IconProps> }> = [
  { value: 'compact', label: 'Compact', hint: 'Compact density', Icon: CompactGlyph },
  { value: 'default', label: 'Standard', hint: 'Standard density', Icon: StandardGlyph },
  { value: 'comfortable', label: 'Comfortable', hint: 'Comfortable density', Icon: ComfortableGlyph },
]

export function SidebarFooterControls({
  focusMode,
  onToggleFocus,
  showDensity = true,
  showFocus = true,
}: {
  focusMode: boolean
  onToggleFocus: () => void
  /** Hide density row (tester portal footer). */
  showDensity?: boolean
  /** Hide focus toggle (tester portal footer). */
  showFocus?: boolean
}) {
  const { density, setDensity } = useDensity()
  const { resolved, setTheme } = useTheme()

  const focusTitle = focusMode
    ? 'Exit focus mode (Esc or Cmd/Ctrl+.)'
    : 'Focus mode — hide sidebar + chrome (Cmd/Ctrl+.)'

  return (
    <div
      className="w-full min-w-0 space-y-1"
      role="group"
      aria-label="Density, theme, and focus"
    >
      {showDensity ? (
        <MicroSegmentedTrack trackId="sidebar-footer-density" role="radiogroup" aria-label="UI density">
          {DENSITY.map(({ value, label, hint, Icon }) => {
            const active = density === value
            return (
              <MicroSegmentCell key={value} active={active}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={label}
                  title={hint}
                  onClick={() => setDensity(value)}
                  className={`${MICRO_SEG} ${microSegActive(active)} w-full`}
                >
                  <Icon />
                </button>
              </MicroSegmentCell>
            )
          })}
        </MicroSegmentedTrack>
      ) : null}

      <div className="flex min-w-0 items-stretch gap-1">
        <MicroSegmentedTrack
          trackId="sidebar-footer-theme"
          role="radiogroup"
          aria-label="Theme"
          className={showFocus ? 'min-w-0 flex-1' : 'min-w-0 w-full'}
        >
          <ThemeCell resolved={resolved} target="dark" setTheme={setTheme} Icon={MoonGlyph} label="Dark theme" />
          <ThemeCell resolved={resolved} target="light" setTheme={setTheme} Icon={SunGlyph} label="Light theme" />
        </MicroSegmentedTrack>

        {showFocus ? (
          <div className={`${MICRO_TRACK} w-[2.75rem] shrink-0`}>
            <button
              type="button"
              aria-pressed={focusMode}
              aria-label={focusMode ? 'Exit focus mode' : 'Focus mode'}
              title={focusTitle}
              onClick={onToggleFocus}
              className={`${MICRO_SEG} ${microSegActive(focusMode)} h-full w-full`}
            >
              <FocusGlyph />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ThemeCell({
  resolved,
  target,
  setTheme,
  Icon,
  label,
}: {
  resolved: ResolvedTheme
  target: 'dark' | 'light'
  setTheme: (t: 'dark' | 'light') => void
  Icon: ComponentType<IconProps>
  label: string
}) {
  const active = resolved === target
  return (
    <MicroSegmentCell active={active}>
      <button
        type="button"
        role="radio"
        aria-checked={active}
        aria-label={label}
        title={label}
        onClick={() => setTheme(target)}
        className={`${MICRO_SEG} ${microSegActive(active)} w-full`}
      >
        <Icon />
      </button>
    </MicroSegmentCell>
  )
}
