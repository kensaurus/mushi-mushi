/**
 * FILE: apps/admin/src/components/SidebarBrandToggles.tsx
 * PURPOSE: Minimal toggles — portal row (icons) + mode row (word labels), sliding pill.
 */

import { Link, useLocation } from 'react-router-dom'
import { checkEnv } from '../lib/env'
import type { AdminMode } from '../lib/mode'
import { IconEye, IconShield } from './icons'
import { MicroSegmentCell, MicroSegmentedTrack } from './sidebar/MicroSegmentedTrack'
import { MICRO_SEG, MICRO_SEG_LABEL, microSegActive } from './sidebar/SidebarMicroChrome'
import { Tooltip } from './ui'

const PORTALS = [
  { id: 'admin' as const, to: '/dashboard', label: 'Admin', hint: 'Admin console', Icon: IconShield },
  { id: 'tester' as const, to: '/tester', label: 'Tester', hint: 'Tester portal', Icon: IconEye },
] as const

const MODES: Array<{ id: AdminMode; label: string; hint: string }> = [
  { id: 'quickstart', label: 'Quick', hint: 'Quickstart — fastest path to a draft PR' },
  { id: 'beginner', label: 'Beginner', hint: 'Beginner — guided next steps' },
  { id: 'advanced', label: 'Advanced', hint: 'Advanced — full console' },
]

function isTesterPath(pathname: string) {
  return pathname === '/tester' || pathname.startsWith('/tester/')
}

export function SidebarBrandToggles({
  compact,
  showMode = true,
  mode,
  onSelectMode,
}: {
  compact?: boolean
  /** Hide Quick/Beginner/Advanced row (tester portal). */
  showMode?: boolean
  mode: AdminMode
  onSelectMode: (m: AdminMode) => void
}) {
  const { pathname } = useLocation()
  const onTester = isTesterPath(pathname)
  const env = checkEnv()

  if (env.mode === 'self-hosted') {
    return (
      <p className="mt-1 font-mono text-3xs uppercase tracking-widest text-fg-faint">
        {onTester ? 'Tester' : 'Admin'}
      </p>
    )
  }

  return (
    <div className="mt-1.5 w-full min-w-0 space-y-1" data-tour-id="mode-toggle">
      <MicroSegmentedTrack
        trackId="sidebar-portal"
        role="radiogroup"
        aria-label="Portal"
        data-active-portal={onTester ? 'tester' : 'admin'}
      >
        {PORTALS.map((p) => {
          const active = p.id === 'tester' ? onTester : !onTester
          return (
            <MicroSegmentCell key={p.id} active={active}>
              <Tooltip content={p.hint} side="auto" nowrap={false} className="flex min-w-0 flex-1">
                <Link
                  to={p.to}
                  role="radio"
                  aria-checked={active}
                  aria-current={active ? 'page' : undefined}
                  aria-label={p.label}
                  className={`${MICRO_SEG} ${microSegActive(active)} w-full`}
                >
                  <p.Icon className="h-3 w-3 shrink-0" aria-hidden />
                </Link>
              </Tooltip>
            </MicroSegmentCell>
          )
        })}
      </MicroSegmentedTrack>

      {!compact && showMode ? (
        <MicroSegmentedTrack
          trackId="sidebar-mode"
          role="radiogroup"
          aria-label="Admin mode"
          data-active-mode={mode}
        >
          {MODES.map((m) => {
            const active = mode === m.id
            return (
              <MicroSegmentCell key={m.id} active={active}>
                <Tooltip content={m.hint} side="auto" nowrap={false} className="flex min-w-0 flex-1">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={`${m.label} mode`}
                    onClick={() => onSelectMode(m.id)}
                    className={`${MICRO_SEG} ${microSegActive(active)} w-full`}
                  >
                    <span className={MICRO_SEG_LABEL}>{m.label}</span>
                  </button>
                </Tooltip>
              </MicroSegmentCell>
            )
          })}
        </MicroSegmentedTrack>
      ) : null}
    </div>
  )
}
