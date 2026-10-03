/**
 * RecipePage — the App Recipe (Plan 019 §3, ADR 0016).
 *
 * One page per project showing what the app is made of — schema, design
 * system, routes, gates, CI/CD, deploy, env and integrations — with each
 * element's state. The recipe is diagnosis context: it is what lets a fix
 * respect the app's own tokens and schema.
 *
 * Data: GET /v1/admin/projects/:id/recipe → RecipeResponse
 *       POST /v1/admin/projects/:id/recipe/refresh → RecipeRefreshResult
 *
 * Layout: fixed-layout React Flow canvas (Sources · Build · Deploy · Runtime)
 * with an ordered-list fallback below 768 px, under prefers-reduced-motion,
 * and on request. Selecting a card opens the side panel.
 */

import { Suspense, lazy, useCallback, useMemo, useState } from 'react'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { Btn, Callout, EmptyState, ErrorAlert, Loading, SegmentedControl } from '../components/ui'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { usePageData } from '../lib/usePageData'
import { apiFetchMutate } from '../lib/supabase'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import type { RecipeElementKey, RecipeRefreshResult, RecipeResponse } from '../lib/recipeTypes'
import { orderedRecipeElements } from '../components/recipe/recipeState'
import { RecipeElementList } from '../components/recipe/RecipeElementList'
import { RecipeSidePanel } from '../components/recipe/RecipeSidePanel'
import { RecipeHeaderSummary } from '../components/recipe/RecipeHeaderSummary'
import { usePrefersRecipeList } from '../components/recipe/useMediaQuery'
import { RadarPanel } from '../components/portfolio/RadarPanel'
import { StorePanel } from '../components/portfolio/StorePanel'
import { StoreReviewsPanel } from '../components/portfolio/StoreReviewsPanel'

const RecipeFlow = lazy(() =>
  import('../components/recipe/RecipeFlow').then((m) => ({ default: m.RecipeFlow })),
)

type ViewMode = 'auto' | 'diagram' | 'list'

const VIEW_OPTIONS = [
  { id: 'auto', label: 'Auto' },
  { id: 'diagram', label: 'Diagram' },
  { id: 'list', label: 'List' },
] as const

type RefreshNotice = { tone: 'ok' | 'error'; text: string } | null

export function RecipePage() {
  const projectId = useActiveProjectId()

  if (!projectId) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeaderBar title="Recipe" />
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            title="No project selected"
            description="Switch to a project using the selector at the top to see its recipe."
          />
        </div>
      </div>
    )
  }

  // Keyed by project: switching projects resets the selection and any notice.
  return <ProjectRecipe key={projectId} projectId={projectId} />
}

function ProjectRecipe({ projectId }: { projectId: string }) {
  const path = `/v1/admin/projects/${projectId}/recipe`
  const { data, loading, error, reload, isValidating } = usePageData<RecipeResponse>(path)

  const [selectedKey, setSelectedKey] = useState<RecipeElementKey | null>(null)
  const [view, setView] = useState<ViewMode>('auto')
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState<RefreshNotice>(null)
  const prefersList = usePrefersRecipeList()
  const showList = view === 'list' || (view === 'auto' && prefersList)

  const elements = useMemo(() => orderedRecipeElements(data?.elements), [data])
  const selected = selectedKey ? elements.find((e) => e.key === selectedKey) ?? null : null

  const onSelect = useCallback((key: RecipeElementKey) => {
    setSelectedKey((cur) => (cur === key ? null : key))
  }, [])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    setNotice(null)
    try {
      const res = await apiFetchMutate<RecipeRefreshResult>(
        `/v1/admin/projects/${projectId}/recipe/refresh`,
        { method: 'POST', body: '{}' },
      )
      if (!res.ok || !res.data) {
        setNotice({ tone: 'error', text: res.error?.message ?? 'Refresh failed.' })
      } else if (!res.data.ok) {
        // A 200 envelope can still carry a failed refresh — show why.
        setNotice({ tone: 'error', text: res.data.reason || 'Refresh did not complete.' })
      } else {
        setNotice({ tone: 'ok', text: res.data.reason || 'Recipe refreshed.' })
      }
    } finally {
      setRefreshing(false)
      reload()
    }
  }, [projectId, reload])

  return (
    <div className={PAGE_CONTENT_STACK}>
      <PageHeaderBar
        title="Recipe"
        helpTitle="What is the recipe?"
        helpWhatIsIt="What this app is made of — schema, design system, routes, gates, CI/CD, deploy, env names and integrations — and whether each one still matches what the app declares. Mushi hands this to the diagnosis so a fix respects your own tokens and schema."
        helpHowToUse="Read the worst card first. Unknown means Mushi has not checked it recently; it is never a pass. Click a card for what Mushi knows and where its findings live. Add a mushi.recipe.json at your repo root to declare tokens, targets and budgets."
        helpFlowPath="/recipe"
      >
        <Btn
          size="sm"
          variant="ghost"
          onClick={onRefresh}
          loading={refreshing}
          disabled={refreshing}
          title={refreshing ? 'Refreshing the recipe…' : 'Re-read mushi.recipe.json and the token files, then recompose the recipe'}
        >
          Refresh
        </Btn>
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            show: data != null,
            children: data ? <RecipeHeaderSummary recipe={data} elements={elements} /> : null,
          },
        ]}
      />

      <div className="flex w-full min-w-0 flex-col gap-4">
        {notice && (
          <Callout tone={notice.tone === 'error' ? 'danger' : 'info'}>
            <span role="status">{notice.text}</span>
          </Callout>
        )}
        {error && <ErrorAlert message={error} endpoint={path} onRetry={reload} />}
        {loading && !data && <Loading text="Composing the recipe…" />}

        {data && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-fg-muted">
                {isValidating ? 'Updating…' : 'Click a card to open its details.'}
              </p>
              <SegmentedControl<ViewMode>
                value={view}
                options={VIEW_OPTIONS}
                onChange={setView}
                ariaLabel="Recipe layout"
                size="sm"
              />
            </div>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="min-w-0 flex-1">
                {showList ? (
                  <RecipeElementList elements={elements} selectedKey={selectedKey} onSelect={onSelect} />
                ) : (
                  <Suspense fallback={<Loading text="Loading diagram…" />}>
                    <RecipeFlow elements={elements} selectedKey={selectedKey} onSelect={onSelect} />
                  </Suspense>
                )}
              </div>
              <div className="w-full shrink-0 lg:w-88">
                <RecipeSidePanel
                  key={selected?.key ?? 'none'}
                  projectId={projectId}
                  element={selected}
                  onClose={() => setSelectedKey(null)}
                />
              </div>
            </div>
          </>
        )}
        <RadarPanel projectId={projectId} />
        <StorePanel projectId={projectId} />
        <StoreReviewsPanel projectId={projectId} />
      </div>
    </div>
  )
}
