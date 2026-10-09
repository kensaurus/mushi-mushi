/**
 * FILE: GlobalStatusStrip.tsx
 * PURPOSE: Collapsible global status slot for Advanced mode: hosts the
 *          workspace PipelineStatusRibbon on hub routes. Quick and Beginner
 *          get the <NextStep> banner instead (lib/chromePosture.ts); the
 *          Quickstart mega CTA that used to live here was folded into it
 *          (Plan 021 Phase 3: one "what next" voice).
 */

import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAdminMode } from '../lib/mode'
import { shouldShowPipelineRibbonChrome } from '../lib/chromePosture'
import { PipelineStatusRibbon } from './PipelineStatusRibbon'

const COLLAPSE_KEY = 'mushi:globalStatusStrip:collapsed:v1'

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(COLLAPSE_KEY) === '1'
}

export function GlobalStatusStrip() {
  const { pathname } = useLocation()
  const { isAdvanced } = useAdminMode()
  const [collapsed, setCollapsed] = useState(readCollapsed)

  useEffect(() => {
    window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  if (!shouldShowPipelineRibbonChrome(isAdvanced, pathname)) return null

  return (
    <div className="panel mb-3 overflow-hidden" data-global-status-strip="">
      <div className="flex items-center justify-between gap-2 border-b border-panel-border px-3 py-1.5">
        <span className="text-2xs font-medium uppercase tracking-wider text-fg-faint">Pipeline</span>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="text-2xs text-fg-muted hover:text-fg px-1.5 py-0.5 rounded-sm hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          aria-expanded={!collapsed}
        >
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </div>
      {!collapsed && (
        <div className="px-1 py-1">
          <PipelineStatusRibbon embedded />
        </div>
      )}
    </div>
  )
}
