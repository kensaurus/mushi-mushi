/**
 * FILE: apps/admin/src/components/health/HealthSectionsBar.tsx
 * PURPOSE: ONE row of sections for /health (2026-11-18). The page stacked two bars: the hub's
 *          views (Mushi Mushi's AI & jobs, Code size, Schema changes, Unusual spikes) and, under
 *          the title, the first view's own tabs (Overview, AI calls, Scheduled jobs, Recent
 *          traces). The inner tabs vanished on the other views, so "AI calls" from Unusual spikes
 *          left the page on Unusual spikes. Now every section is one tab in one bar and each
 *          renders its own view: `?tab=` picks a section of Mushi Mushi's AI & jobs, `?view=` one
 *          of the other views (the hub's ids, so `/anomalies` → `/health?view=spikes` still lands).
 */

import { useSearchParams } from 'react-router-dom'
import { SegmentedControl } from '../ui'
import { useEdgeFade } from '../../lib/useEdgeFade'
import { HEALTH_HUB } from '../../lib/pageHubs'
import type { HealthTabId } from './HealthStatsTypes'

export type HealthView = 'integrations' | 'code' | 'schema' | 'spikes'
export type HealthSection = HealthTabId | Exclude<HealthView, 'integrations'>

const TAB_IDS: readonly HealthTabId[] = ['overview', 'llm', 'cron', 'activity']
const VIEW_IDS = HEALTH_HUB.views.map((v) => v.id) as HealthView[]

/** Default names for the AI & jobs sections; the page copy (lib/copy.ts tabLabels) may rename them. */
const TAB_LABELS: Record<HealthTabId, string> = {
  overview: 'Overview',
  llm: 'AI calls',
  cron: 'Scheduled jobs',
  activity: 'Recent traces',
}

/** @internal Exported for tests. Which view a URL opens: an unknown `?view=` is the first one. */
export function resolveHealthView(params: URLSearchParams): HealthView {
  const v = params.get('view')
  return VIEW_IDS.includes(v as HealthView) ? (v as HealthView) : 'integrations'
}

/** @internal Exported for tests. The section a URL opens: the view, or the AI & jobs tab inside it. */
export function resolveHealthSection(params: URLSearchParams): HealthSection {
  const view = resolveHealthView(params)
  if (view !== 'integrations') return view
  const t = params.get('tab')
  return TAB_IDS.includes(t as HealthTabId) ? (t as HealthTabId) : 'overview'
}

/**
 * @internal Exported for tests. The URL for a section, other params kept: a view drops `tab`, an
 * AI & jobs section drops `view`, so the two never disagree about what is open.
 */
export function healthSectionParams(prev: URLSearchParams, section: HealthSection): URLSearchParams {
  const next = new URLSearchParams(prev)
  if ((TAB_IDS as readonly string[]).includes(section)) {
    next.delete('view')
    if (section === 'overview') next.delete('tab')
    else next.set('tab', section)
  } else {
    next.delete('tab')
    next.set('view', section)
  }
  return next
}

/** @internal Exported for tests. Every section in bar order: the AI & jobs sections, then the other views. */
export function healthSectionOptions(
  tabLabels?: Partial<Record<string, string>>,
  counts?: Partial<Record<HealthSection, number>>,
): Array<{ id: HealthSection; label: string; count?: number }> {
  const tabs = TAB_IDS.map((id) => ({ id: id as HealthSection, label: tabLabels?.[id] ?? TAB_LABELS[id], count: counts?.[id] }))
  const views = HEALTH_HUB.views
    .filter((v) => v.id !== 'integrations')
    .map((v) => ({ id: v.id as HealthSection, label: v.label, count: counts?.[v.id as HealthSection] }))
  return [...tabs, ...views]
}

export function HealthSectionsBar({
  tabLabels,
  counts,
}: {
  tabLabels?: Partial<Record<string, string>>
  counts?: Partial<Record<HealthSection, number>>
}) {
  const [params, setParams] = useSearchParams()
  const value = resolveHealthSection(params)
  const options = healthSectionOptions(tabLabels, counts)
  // Phone: the bar scrolls with a fade at the edge, never a raw scrollbar.
  const fade = useEdgeFade<HTMLDivElement>(options.length)
  return (
    <div ref={fade.ref} className={`max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${fade.className}`} data-testid="health-sections">
      <SegmentedControl<HealthSection>
        size="sm"
        scrollable
        ariaLabel={HEALTH_HUB.title}
        value={value}
        options={options}
        onChange={(id) => setParams((prev) => healthSectionParams(prev, id), { replace: true })}
      />
    </div>
  )
}
