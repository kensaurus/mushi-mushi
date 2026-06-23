/**
 * FILE: GlobalStatusStrip.tsx
 * PURPOSE: Single collapsible global status slot — hosts QuickstartMegaCta
 *          OR PipelineStatusRibbon (never both). Replaces two stacked bands
 *          in Layout for Supabase-style diet chrome.
 */

import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAdminMode } from '../lib/mode'
import { shouldShowPipelineRibbonChrome } from '../lib/chromePosture'
import { QuickstartMegaCta } from './QuickstartMegaCta'
import { PipelineStatusRibbon } from './PipelineStatusRibbon'

const COLLAPSE_KEY = 'mushi:globalStatusStrip:collapsed:v1'

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(COLLAPSE_KEY) === '1'
}

export function GlobalStatusStrip() {
  const { pathname } = useLocation()
  const { isQuickstart, isAdvanced } = useAdminMode()
  const [collapsed, setCollapsed] = useState(readCollapsed)

  useEffect(() => {
    window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  const showQuickstart = isQuickstart
  const showPipeline = shouldShowPipelineRibbonChrome(isAdvanced, pathname)

  if (!showQuickstart && !showPipeline) return null

  return (
    <div className="panel mb-3 overflow-hidden" data-global-status-strip="">
      <div className="flex items-center justify-between gap-2 border-b border-panel-border px-3 py-1.5">
        <span className="text-2xs font-medium uppercase tracking-wider text-fg-faint">
          {showQuickstart ? 'Quickstart' : 'Pipeline'}
        </span>
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
          {showQuickstart ? <QuickstartMegaCta embedded /> : <PipelineStatusRibbon embedded />}
        </div>
      )}
    </div>
  )
}
