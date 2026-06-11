/**
 * One-time explainer for the two DAV chrome layers:
 * Workspace pipeline (global) vs This page hero (per-route).
 */

import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Btn } from './ui'
import { useAdminMode } from '../lib/mode'
import { hasPageOwnedHero } from '../lib/pageHeroOwnership'

const DISMISS_KEY = 'mushi:davChromeCoachmark:dismissed:v1'

function isDismissed(): boolean {
  if (typeof window === 'undefined') return true
  return window.localStorage.getItem(DISMISS_KEY) === '1'
}

function dismissCoachmark(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    // private mode — non-fatal
  }
}

export function DavChromeCoachmark() {
  const { isAdvanced } = useAdminMode()
  const { pathname } = useLocation()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(isAdvanced && hasPageOwnedHero(pathname) && !isDismissed())
  }, [isAdvanced, pathname])

  if (!visible) return null

  return (
    <div
      role="note"
      data-testid="dav-chrome-coachmark"
      className="mb-3 flex flex-col gap-2 rounded-md border border-brand/25 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-medium text-fg">Two strips, two jobs</p>
        <p className="text-2xs leading-relaxed text-fg-muted">
          <span className="font-medium text-fg-secondary">Workspace pipeline</span>
          {' '}
          tracks the whole project across Plan → Do → Check → Act.
          {' '}
          <span className="font-medium text-fg-secondary">This page</span>
          {' '}
          shows status, your next step, and evidence for the route you are on.
        </p>
      </div>
      <Btn
        size="sm"
        variant="ghost"
        className="shrink-0 self-end sm:self-start"
        onClick={() => {
          dismissCoachmark()
          setVisible(false)
        }}
      >
        Got it
      </Btn>
    </div>
  )
}
