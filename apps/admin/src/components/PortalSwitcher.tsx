/**
 * FILE: apps/admin/src/components/PortalSwitcher.tsx
 * PURPOSE: Sidebar toggle between admin console and tester portal — same
 *          segmented-control pattern as the Quick / Beginner / Advanced mode row.
 */

import { Link, useLocation } from 'react-router-dom'
import { checkEnv } from '../lib/env'
import { Tooltip } from './ui'

const SEG_BASE =
  'flex w-full min-w-0 items-center justify-center rounded px-2 py-1 text-3xs font-medium motion-safe:transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 truncate'

const SEG_ACTIVE = 'bg-brand/25 font-semibold text-brand shadow-sm ring-1 ring-brand/20'
const SEG_INACTIVE = 'text-fg-muted hover:bg-surface-overlay hover:text-fg-secondary'

function isTesterPath(pathname: string) {
  return pathname === '/tester' || pathname.startsWith('/tester/')
}

/** Sidebar Admin | Tester toggle — lives under the mushimushi wordmark. */
export function PortalToggle({ compact = false }: { compact?: boolean }) {
  const { pathname } = useLocation()
  const onTester = isTesterPath(pathname)
  const env = checkEnv()

  if (env.mode === 'self-hosted') {
    return (
      <p className="mt-1 text-2xs uppercase tracking-wide text-fg-muted">
        {onTester ? 'Tester' : 'Admin'}
      </p>
    )
  }

  const adminLabel = compact ? 'A' : 'Admin'
  const testerLabel = compact ? 'T' : 'Tester'

  return (
    <div
      role="radiogroup"
      aria-label="Portal"
      className="mt-1.5 flex w-full min-w-0 items-stretch gap-0.5 rounded-md border border-edge bg-surface-root/50 p-0.5"
    >
      <Tooltip content="Admin console — triage, fixes, QA" side="bottom" className="flex min-w-0 flex-1">
        <Link
          to="/dashboard"
          role="radio"
          aria-checked={!onTester}
          aria-current={!onTester ? 'page' : undefined}
          className={`${SEG_BASE} ${!onTester ? SEG_ACTIVE : SEG_INACTIVE}`}
        >
          {adminLabel}
        </Link>
      </Tooltip>
      <Tooltip content="Tester portal — earn points testing apps" side="bottom" className="flex min-w-0 flex-1">
        <Link
          to="/tester"
          role="radio"
          aria-checked={onTester}
          aria-current={onTester ? 'page' : undefined}
          className={`${SEG_BASE} ${onTester ? SEG_ACTIVE : SEG_INACTIVE}`}
        >
          {testerLabel}
        </Link>
      </Tooltip>
    </div>
  )
}
