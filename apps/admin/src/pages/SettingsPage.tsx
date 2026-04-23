/**
 * FILE: apps/admin/src/pages/SettingsPage.tsx
 * PURPOSE: Tabbed shell for project settings. Each tab is a focused panel
 *          (general / BYOK / Firecrawl / health / dev tools), URL-driven via
 *          ?tab=… so deep links and the back-button behave correctly.
 */

import { useLayoutEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader, PageHelp } from '../components/ui'
import { GeneralPanel } from '../components/settings/GeneralPanel'
import { ByokPanel } from '../components/settings/ByokPanel'
import { FirecrawlPanel } from '../components/settings/FirecrawlPanel'
import { HealthPanel } from '../components/settings/HealthPanel'
import { DevToolsPanel } from '../components/settings/DevToolsPanel'
import { usePageCopy } from '../lib/copy'
import { usePublishPageContext } from '../lib/pageContext'

type TabId = 'general' | 'byok' | 'firecrawl' | 'health' | 'dev'

const TABS: Array<{ id: TabId; label: string; description: string }> = [
  { id: 'general', label: 'General', description: 'Notifications, Sentry, LLM model, dedup threshold.' },
  { id: 'byok', label: 'LLM keys (BYOK)', description: 'Anthropic + OpenAI-compatible providers.' },
  { id: 'firecrawl', label: 'Firecrawl', description: 'Optional web research provider.' },
  { id: 'health', label: 'Health & test', description: 'Connection status, SDK reference, pipeline smoke test.' },
  { id: 'dev', label: 'Dev tools', description: 'Debug logging and local-only flags.' },
]

/** Mapping of tab id → concise tab name for the browser tab title. */
const TAB_TITLES: Record<TabId, string> = {
  general: 'General',
  byok: 'BYOK',
  firecrawl: 'Firecrawl',
  health: 'Health & test',
  dev: 'Dev tools',
}

function isTabId(value: string | null): value is TabId {
  return value === 'general' || value === 'byok' || value === 'firecrawl' || value === 'health' || value === 'dev'
}

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const copy = usePageCopy('/settings')
  const param = searchParams.get('tab')
  const active: TabId = isTabId(param) ? param : 'general'
  const activeMeta = TABS.find(t => t.id === active) ?? TABS[0]

  const setActive = (id: TabId) => {
    const next = new URLSearchParams(searchParams)
    if (id === 'general') next.delete('tab')
    else next.set('tab', id)
    // `preventScrollReset` keeps the viewport anchored on the tablist
    // instead of jumping to the top of the document on every tab click.
    // The tab panels are mostly form rows — scrolling is a real friction
    // when a user has scrolled down to inspect one tab then clicks
    // another to compare values.
    setSearchParams(next, { replace: true, preventScrollReset: true })
  }

  // Publish tab-aware page context so the browser tab title reflects
  // the active pane ("BYOK · Settings — Mushi Mushi"). Without this,
  // every settings tab would share a single "Settings" title and stacked
  // tabs become indistinguishable.
  usePublishPageContext({
    route: '/settings',
    title: `${TAB_TITLES[active]} · Settings`,
    summary: TABS.find((t) => t.id === active)?.description,
    filters: { tab: active },
  })

  // Sliding tab indicator. Measure the active tab's box and translate a
  // single underline span into place; the per-tab `border-b-2` was visually
  // jumpy because it instantly re-rendered without motion.
  const tablistRef = useRef<HTMLDivElement | null>(null)
  const tabRefs = useRef<Map<TabId, HTMLButtonElement>>(new Map())
  const [indicator, setIndicator] = useState<{ left: number; width: number }>({ left: 0, width: 0 })

  // Re-measure on tab switch *and* on tablist resize — the container is
  // `flex-wrap`, so a viewport resize can change every tab's offsetLeft and
  // strand the underline mid-row. Using `useLayoutEffect` (not effect) avoids
  // a one-frame flash where the underline points at the old position.
  useLayoutEffect(() => {
    const measure = () => {
      const tab = tabRefs.current.get(active)
      if (!tab) return
      setIndicator({ left: tab.offsetLeft, width: tab.offsetWidth })
    }
    measure()
    const list = tablistRef.current
    if (!list || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(list)
    return () => ro.disconnect()
  }, [active])

  return (
    <div className="space-y-4">
      <PageHeader
        title={copy?.title ?? 'Project Settings'}
        description={copy?.description ?? 'Per-project flags, retention, routing defaults, and feature toggles.'}
      />

      <PageHelp
        title={copy?.help?.title ?? 'About Settings'}
        whatIsIt={copy?.help?.whatIsIt ?? 'Tunable knobs for the bug pipeline: which model classifies reports, how strict the dedup threshold is, where to send notifications, and which Sentry feedback to ingest.'}
        useCases={copy?.help?.useCases ?? [
          'Swap in a fine-tuned model once Fine-Tuning produces one',
          'Tighten the confidence threshold to reduce false positives, or loosen it to catch more',
          'Pipe alerts into Slack and Sentry for unified incident response',
        ]}
        howToUse={copy?.help?.howToUse ?? 'Save persists changes immediately and writes an audit-log entry. Use Health & test below to verify your config before relying on it in production.'}
      />

      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Settings sections"
        className="relative flex flex-wrap gap-1 border-b border-edge-subtle"
      >
        {TABS.map((t) => {
          const selected = t.id === active
          return (
            <button
              key={t.id}
              ref={(el) => {
                if (el) tabRefs.current.set(t.id, el)
                else tabRefs.current.delete(t.id)
              }}
              role="tab"
              aria-selected={selected}
              aria-controls={`settings-panel-${t.id}`}
              id={`settings-tab-${t.id}`}
              onClick={() => setActive(t.id)}
              className={
                'px-3 py-1.5 text-xs font-medium rounded-t-sm motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ' +
                (selected ? 'text-fg' : 'text-fg-muted hover:text-fg')
              }
            >
              {t.label}
            </button>
          )
        })}
        {indicator.width > 0 && (
          <span
            aria-hidden="true"
            className="absolute -bottom-px h-0.5 bg-brand rounded-full motion-safe:transition-[transform,width] motion-safe:duration-200 motion-safe:ease-out"
            style={{
              width: `${indicator.width}px`,
              transform: `translateX(${indicator.left}px)`,
              left: 0,
            }}
          />
        )}
      </div>

      <p className="text-2xs text-fg-muted">{activeMeta.description}</p>

      <div
        role="tabpanel"
        id={`settings-panel-${active}`}
        aria-labelledby={`settings-tab-${active}`}
      >
        {active === 'general' && <GeneralPanel />}
        {active === 'byok' && <ByokPanel />}
        {active === 'firecrawl' && <FirecrawlPanel />}
        {active === 'health' && <HealthPanel />}
        {active === 'dev' && <DevToolsPanel />}
      </div>
    </div>
  )
}
