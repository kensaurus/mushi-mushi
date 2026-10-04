/**
 * FILE: apps/admin/src/components/recipe/RecipeSidePanel.tsx
 * PURPOSE: Detail panel for the selected Recipe element (GraphSidePanel
 *          pattern). Tabs:
 *            • What it is — GET /recipe/elements/:element: the typed view for
 *                           schema, CI, deploy and env (RecipeElementViews),
 *                           the rest rendered generically
 *            • Problems   — open problem count + where they are listed
 *            • Change     — gates, env and routes only: edit form → dry-run
 *                           diff → draft PR (RecipeChangeTab)
 *          The Problems tab never says "nothing to fix" for an element that
 *          has not been checked: unknown / not_connected / error say so instead.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, Card, DisclosurePanel, Loading, SegmentedControl, formatRelative } from '../ui'
import { PageLoadError } from '../PageLoadError'
import { usePageData } from '../../lib/usePageData'
import { LINK_ACCENT } from '../../lib/chipTone'
import type { RecipeElementDetail, RecipeElementSummary } from '../../lib/recipeTypes'
import { RecipeStateChip } from './RecipeStateChip'
import { RecipeLinkList } from './RecipeLinks'
import { RecipeDetailValue } from './RecipeDetailValue'
import { describeLastChecked, elementStateMeta } from './recipeState'
import { hasChangeTab, RecipeChangeTab } from './RecipeChangeTab'
import { detailWithoutView, pickElementView, RecipeElementView } from './RecipeElementViews'

type PanelTab = 'what' | 'drift' | 'change'

const BASE_TABS: Array<{ id: PanelTab; label: string }> = [
  { id: 'what', label: 'What it is' },
  { id: 'drift', label: 'Problems' },
]
const CHANGE_TABS: Array<{ id: PanelTab; label: string }> = [...BASE_TABS, { id: 'change', label: 'Change' }]

interface RecipeSidePanelProps {
  projectId: string
  element: RecipeElementSummary | null
  onClose: () => void
}

export function RecipeSidePanel({ projectId, element, onClose }: RecipeSidePanelProps) {
  const [tab, setTab] = useState<PanelTab>('what')

  if (!element) {
    return (
      <Card className="p-3 self-start">
        <p className="text-xs text-fg-muted">
          Pick a card to see what Mushi knows about it, what needs fixing, and how.
        </p>
      </Card>
    )
  }

  const meta = elementStateMeta(element.state, element.lastCheckedAt)
  const checked = describeLastChecked(element.lastCheckedAt, formatRelative, element.state)
  const changeKey = hasChangeTab(element.key) ? element.key : null
  const changeable = changeKey !== null
  // A Change tab picked on gates falls back to "What it is" on an element without one.
  const shown: PanelTab = tab === 'change' && !changeable ? 'what' : tab

  return (
    <Card className="p-3 self-start space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="text-xs text-fg-faint">Part of your app</div>
          <h2 className="text-sm font-medium text-fg wrap-break-word">{element.label}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <RecipeStateChip state={element.state} lastCheckedAt={element.lastCheckedAt} />
            <span className="text-xs text-fg-muted" title={checked.title}>
              {checked.text}
            </span>
          </div>
        </div>
        <Btn size="sm" variant="ghost" onClick={onClose} aria-label="Close element details">
          Close
        </Btn>
      </div>

      <p className="text-xs text-fg-secondary">{element.reason}</p>

      <SegmentedControl<PanelTab>
        value={shown}
        options={changeable ? CHANGE_TABS : BASE_TABS}
        onChange={setTab}
        ariaLabel="Element detail view"
        size="sm"
      />

      {shown === 'what' ? (
        <WhatItIs projectId={projectId} element={element} />
      ) : shown === 'drift' ? (
        <DriftTab element={element} stateLabel={meta.label} />
      ) : (
        changeKey && <RecipeChangeTab key={`${projectId}:${changeKey}`} projectId={projectId} element={changeKey} />
      )}
    </Card>
  )
}

function WhatItIs({ projectId, element }: { projectId: string; element: RecipeElementSummary }) {
  const path = `/v1/admin/projects/${projectId}/recipe/elements/${encodeURIComponent(element.key)}`
  const { data, loading, error, reload } = usePageData<RecipeElementDetail>(path)
  const view = pickElementView(data?.detail)

  return (
    <div className="space-y-3">
      {loading && !data && <Loading text="Loading element detail…" />}
      {error && <PageLoadError error={error} resource="the recipe" endpoint={path} onRetry={reload} />}
      {data && view && (
        <>
          <RecipeElementView view={view} />
          <DisclosurePanel title="More detail">
            <RecipeDetailValue value={detailWithoutView(data.detail)} />
          </DisclosurePanel>
        </>
      )}
      {data && !view && (
        <div className="rounded-sm border border-edge-subtle/60 p-2">
          <RecipeDetailValue value={data.detail} />
        </div>
      )}
      <div className="space-y-1">
        <h3 className="text-xs font-medium text-fg-secondary">Links</h3>
        <RecipeLinkList links={(data?.element ?? element).links} empty="No links for this element yet." />
        {element.key === 'design' && (
          <Link to="/design" className={`text-xs ${LINK_ACCENT}`}>
            Open the design system page
          </Link>
        )}
      </div>
    </div>
  )
}

function DriftTab({ element, stateLabel }: { element: RecipeElementSummary; stateLabel: string }) {
  const state = elementStateMeta(element.state, element.lastCheckedAt).state
  const notJudged = state === 'unknown' || state === 'not_connected' || state === 'error'
  const n = element.findingsCount

  return (
    <div className="space-y-3">
      {notJudged ? (
        <p className="text-xs text-fg-secondary">
          This is <span className="font-medium">{stateLabel.toLowerCase()}</span>, so Mushi cannot say yet whether anything needs fixing.{' '}
          {n > 0 ? `${n.toLocaleString()} problem${n === 1 ? '' : 's'} from an earlier check ${n === 1 ? 'is' : 'are'} still open.` : ''}
        </p>
      ) : (
        <p className="text-sm text-fg">
          <span className="font-semibold tabular-nums">{n.toLocaleString()}</span>{' '}
          problem{n === 1 ? '' : 's'} to fix
          {n === 0 && <span className="text-xs text-fg-muted"> — nothing open from the last check.</span>}
        </p>
      )}
      <div className="space-y-1">
        <h3 className="text-xs font-medium text-fg-secondary">Where to see and fix them</h3>
        <RecipeLinkList links={element.links} empty="No page lists these problems yet." />
        {element.key === 'design' && (
          <Link to="/design" className={`text-xs ${LINK_ACCENT}`}>
            Design system: tokens, contrast and hard-coded styles
          </Link>
        )}
      </div>
    </div>
  )
}
