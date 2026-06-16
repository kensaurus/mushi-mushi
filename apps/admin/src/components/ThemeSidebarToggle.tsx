/**
 * FILE: apps/admin/src/components/ThemeSidebarToggle.tsx
 * PURPOSE: Three-button strip in the sidebar footer combining theme
 *          (dark / light) with the focus-mode toggle. Earlier revisions
 *          kept theme as a pure 3-way radio (dark / light / auto) and
 *          rendered Focus mode as its own full-width row beneath. That
 *          burned a whole row on a binary toggle while the "Auto"
 *          option was rarely picked — most users want explicit control.
 *
 *          2026-05-07 reshape: drop Auto, demote theme to a binary
 *          radio (moon / sun), and reclaim the third slot for the
 *          Focus mode toggle. The user's `system` theme preference
 *          (if previously stored) still resolves correctly via
 *          `useTheme().resolved` — we just don't expose it as an
 *          explicit option anymore. To pick system theme again, the
 *          user toggles their OS appearance and matches it manually
 *          here, or clears localStorage.
 *
 *          The mixed semantics (radio + toggle) are handled cleanly:
 *          the two theme buttons live inside their own
 *          `role="radiogroup"`; the focus toggle is a sibling
 *          `aria-pressed` button outside the group, so screen readers
 *          announce them with the correct affordance.
 */

import type { SVGProps } from 'react'
import { useTheme, type ResolvedTheme } from '../lib/useTheme'

type IconProps = SVGProps<SVGSVGElement>

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
 * Focus mode = "hide chrome, see only content". The four corner
 * brackets pointing inward to a center square is the universal
 * fullscreen / focus glyph (image apps, video players, design tools).
 */
function FocusGlyph(props: IconProps) {
  return (
    <GlyphFrame {...props} strokeWidth={1.6}>
      <path d="M2.5 5V3.5a1 1 0 0 1 1-1H5" />
      <path d="M11 2.5h1.5a1 1 0 0 1 1 1V5" />
      <path d="M13.5 11v1.5a1 1 0 0 1-1 1H11" />
      <path d="M5 13.5H3.5a1 1 0 0 1-1-1V11" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="currentColor" />
    </GlyphFrame>
  )
}

interface Props {
  focusMode: boolean
  onToggleFocus: () => void
  /** Hide focus-mode button (tester portal uses a slimmer footer). */
  showFocus?: boolean
}

export function ThemeSidebarToggle({ focusMode, onToggleFocus, showFocus = true }: Props) {
  const { resolved, setTheme } = useTheme()
  return (
    <div
      role="group"
      aria-label="Theme and focus controls"
      className="flex items-stretch gap-0.5 rounded-sm border border-edge/60 p-0.5"
    >
      <ThemeRadioGroup resolved={resolved} setTheme={setTheme} />
      {showFocus && (
      <button
        type="button"
        onClick={onToggleFocus}
        aria-pressed={focusMode}
        aria-label={focusMode ? 'Exit focus mode' : 'Focus mode'}
        title={focusMode ? 'Exit focus mode (Esc or Cmd/Ctrl+.)' : 'Focus mode — hide sidebar + chrome (Cmd/Ctrl+.)'}
        className={`flex-1 flex items-center justify-center rounded-sm px-1 py-1 motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 ${
          focusMode
            ? 'bg-surface-overlay text-brand'
            : 'text-fg-muted hover:text-fg hover:bg-surface-overlay/60'
        }`}
      >
        <FocusGlyph />
      </button>
      )}
    </div>
  )
}

function ThemeRadioGroup({
  resolved,
  setTheme,
}: {
  resolved: ResolvedTheme
  setTheme: (t: 'dark' | 'light') => void
}) {
  return (
    <div role="radiogroup" aria-label="Theme" className="contents">
      <button
        type="button"
        role="radio"
        aria-checked={resolved === 'dark'}
        aria-label="Dark theme"
        onClick={() => setTheme('dark')}
        title="Dark theme — designed for low-light triage"
        className={`flex-1 flex items-center justify-center rounded-sm px-1 py-1 motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 ${
          resolved === 'dark'
            ? 'bg-surface-overlay text-brand'
            : 'text-fg-muted hover:text-fg hover:bg-surface-overlay/60'
        }`}
      >
        <MoonGlyph />
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={resolved === 'light'}
        aria-label="Light theme"
        onClick={() => setTheme('light')}
        title="Light theme — high ambient light / printing"
        className={`flex-1 flex items-center justify-center rounded-sm px-1 py-1 motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 ${
          resolved === 'light'
            ? 'bg-surface-overlay text-brand'
            : 'text-fg-muted hover:text-fg hover:bg-surface-overlay/60'
        }`}
      >
        <SunGlyph />
      </button>
    </div>
  )
}
