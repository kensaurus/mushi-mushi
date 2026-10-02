/**
 * FILE: apps/admin/src/components/recipe/RecipeSidePanel.tsx
 * PURPOSE: Detail panel for the selected Recipe element (GraphSidePanel
 *          pattern). Two tabs:
 *            • What it is — GET /recipe/elements/:element, rendered generically
 *            • Drift      — open findings count + where they are rendered
 *          The Drift tab never says "no drift" for an element that has not
 *          been checked: unknown / not_connected / error say so instead.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, Card, ErrorAlert, Loading, SegmentedControl, formatRelative } from '../ui'
import { usePageData } from '../../lib/usePageData'
import { LINK_ACCENT } from '../../lib/chipTone'
import type { RecipeElementDetail, RecipeElementSummary } from '../../lib/recipeTypes'
import { RecipeStateChip } from './RecipeStateChip'
import { RecipeLinkList } from './RecipeLinks'
import { RecipeDetailValue } from './RecipeDetailValue'
import { describeLastChecked, elementStateMeta } from './recipeState'

type PanelTab = 'what' | 'drift'

const TAB_OPTIONS = [
  { id: 'what', label: 'What it is' },
  { id: 'drift', label: 'Drift' },
] as const

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
          Select a card to see what Mushi knows about it and where it has drifted.
        </p>
      </Card>
    )
  }

  const meta = elementStateMeta(element.state)
  const checked = describeLastChecked(element.lastCheckedAt, formatRelative)

  return (
    <Card className="p-3 self-start space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="text-2xs uppercase tracking-wider text-fg-faint">Recipe element</div>
          <h2 className="text-sm font-medium text-fg wrap-break-word">{element.label}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <RecipeStateChip state={element.state} />
            <span className="text-2xs text-fg-muted" title={checked.title}>
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
        value={tab}
        options={TAB_OPTIONS}
        onChange={setTab}
        ariaLabel="Element detail view"
        size="sm"
      />

      {tab === 'what' ? (
        <WhatItIs projectId={projectId} element={element} />
      ) : (
        <DriftTab element={element} stateLabel={meta.label} />
      )}
    </Card>
  )
}

function WhatItIs({ projectId, element }: { projectId: string; element: RecipeElementSummary }) {
  const path = `/v1/admin/projects/${projectId}/recipe/elements/${encodeURIComponent(element.key)}`
  const { data, loading, error, reload } = usePageData<RecipeElementDetail>(path)

  return (
    <div className="space-y-3">
      {loading && !data && <Loading text="Loading element detail…" />}
      {error && <ErrorAlert message={error} endpoint={path} onRetry={reload} />}
      {data && (
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
  const state = elementStateMeta(element.state).state
  const notJudged = state === 'unknown' || state === 'not_connected' || state === 'error'
  const n = element.findingsCount

  return (
    <div className="space-y-3">
      {notJudged ? (
        <p className="text-xs text-fg-secondary">
          This element is <span className="font-medium">{stateLabel.toLowerCase()}</span>, so drift
          cannot be judged yet. {n > 0 ? `${n.toLocaleString()} older finding${n === 1 ? '' : 's'} are still open.` : ''}
        </p>
      ) : (
        <p className="text-sm text-fg">
          <span className="font-semibold tabular-nums">{n.toLocaleString()}</span>{' '}
          open finding{n === 1 ? '' : 's'}
          {n === 0 && <span className="text-xs text-fg-muted"> — matches what the app declares.</span>}
        </p>
      )}
      <div className="space-y-1">
        <h3 className="text-xs font-medium text-fg-secondary">Where the findings live</h3>
        <RecipeLinkList links={element.links} empty="No findings page is linked for this element." />
        {element.key === 'design' && (
          <Link to="/design" className={`text-xs ${LINK_ACCENT}`}>
            Design system: tokens, contrast and deviance
          </Link>
        )}
      </div>
    </div>
  )
}
