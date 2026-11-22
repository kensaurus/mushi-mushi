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

import { Suspense, lazy, useCallback, useMemo, useRef, useState } from 'react'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { Btn, Callout, EmptyState, Loading, SegmentedControl } from '../components/ui'
import { PageLoadError } from '../components/PageLoadError'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { usePageData } from '../lib/usePageData'
import { apiFetchMutate } from '../lib/supabase'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import type { RecipeElementKey, RecipeRefreshResult, RecipeResponse } from '../lib/recipeTypes'
import { orderedRecipeElements } from '../components/recipe/recipeState'
import { RecipeElementList } from '../components/recipe/RecipeElementList'
import { RecipeSidePanel } from '../components/recipe/RecipeSidePanel'
import { RecipeHeaderSummary } from '../components/recipe/RecipeHeaderSummary'
import { useFitsRecipeDiagram, usePrefersRecipeList } from '../components/recipe/useMediaQuery'
import { RadarPanel, checkFixPrompt, useRadarRun } from '../components/portfolio/RadarPanel'
import { PageStatus, toMetrics } from '../components/ui/page-status'
import { BarCell } from '../components/signal/BarCell'
import { CopyPromptButton } from '../components/gates/CopyFixPromptButton'
import type { RadarView } from '../lib/radarTypes'
import type { KnownHolesView } from '../components/code-health/KnownHolesCard'
import { fixAllHolesPrompt, holeRowsFromFindings, holeRowsFromGroups, type HoleRow } from '../components/recipe/dependencyHoles'
import { DEPENDENCY_RULE, recipeVerdict } from '../components/recipe/recipeVerdict'
import { elementsBehindWorst } from '../components/recipe/recipeState'

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
        <PageHeaderBar title="App blueprint" />
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            title="No project selected"
            description="Switch to a project using the selector at the top to see its blueprint."
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
  // Risk checks and dependency holes, read here so the lead and the list below share one response.
  const radarPath = `/v1/admin/projects/${projectId}/radar`
  const radar = usePageData<RadarView>(radarPath)
  const vulns = usePageData<KnownHolesView>(`/v1/admin/projects/${projectId}/vulnerabilities`)
  const radarRun = useRadarRun(projectId)
  const prefersList = usePrefersRecipeList()
  // Auto shows the diagram only where every lane fits; an explicit Diagram choice still pans.
  const columnRef = useRef<HTMLDivElement>(null)
  const diagramFits = useFitsRecipeDiagram(columnRef)
  const showList = view === 'list' || (view === 'auto' && (prefersList || !diagramFits))

  const elements = useMemo(() => orderedRecipeElements(data?.elements), [data])
  const selected = selectedKey ? elements.find((e) => e.key === selectedKey) ?? null : null
  const holes = useMemo(() => dependencyRows(vulns.data, radar.data), [vulns.data, radar.data])
  const verdict = useMemo(() => {
    const shipped = holes?.filter((r) => !r.dev) ?? []
    // Under "Dependencies with holes": how many of them are critical or high, as a bar (2026-11-19).
    const serious = shipped.filter((r) => r.severity === 'critical' || r.severity === 'high').length
    return recipeVerdict({
      detectors: radar.data?.detectors ?? null,
      holes: shipped.length,
      behind: data ? elementsBehindWorst(elements).map((e) => ({ key: e.key, label: e.label })) : [],
      holesVisual: shipped.length > 0 ? <BarCell value={serious} max={shipped.length} tone="danger" label={`${serious} of ${shipped.length} critical or high`} /> : undefined,
    })
  }, [radar.data, holes, data, elements])

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
        title="App blueprint"
        helpTitle="What is the app blueprint?"
        helpWhatIsIt="What this app is made of — database, design system, pages, automated checks, CI builds, what is live, environment variables and connected tools — and whether each one works. Mushi Mushi hands this to every diagnosis so a fix respects your own design and database."
        helpHowToUse="Start with the card marked Needs attention or Check failed: its text says what is wrong and what to do. Not checked yet is never a pass. Not set up is optional. To declare design tokens, deploy targets and budgets, add a file named mushi.recipe.json at your repo root."
        helpFlowPath="/recipe"
      >
        <Btn
          size="sm"
          variant="ghost"
          onClick={onRefresh}
          loading={refreshing}
          disabled={refreshing}
          title={refreshing ? 'Checking again…' : 'Read your repo again (recipe file, design tokens, CI builds and environment variables) and rebuild this page'}
        >
          Refresh
        </Btn>
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            show: data != null || radar.data != null,
            children: (
              <PageStatus
                ariaLabel="Blueprint status"
                tone={verdict.tone}
                sentence={verdict.sentence}
                metrics={toMetrics(verdict.metrics)}
                action={
                  <LeadAction
                    next={verdict.next}
                    holes={holes}
                    radar={radar.data}
                    onRun={() => void radarRun.run()}
                    running={radarRun.running}
                    onSelect={(key) => setSelectedKey(key as RecipeElementKey)}
                  />
                }
                data-testid="recipe-status"
              />
            ),
          },
        ]}
      />

      <div className="flex w-full min-w-0 flex-col gap-4">
        {notice && (
          <Callout tone={notice.tone === 'error' ? 'danger' : 'info'}>
            <span role="status">{notice.text}</span>
          </Callout>
        )}
        {error && <PageLoadError error={error} resource="the app recipe" endpoint={path} onRetry={reload} />}
        {loading && !data && <Loading text="Composing the recipe…" />}

        {/* Problems first: Risk checks lead (at 390 px they sat about 3,000 px down, 2026-11-18). */}
        <RadarPanel
          radar={{ data: radar.data, loading: radar.loading, error: radar.error, reload: radar.reload, path: radarPath }}
          holes={holes}
          run={() => void radarRun.run()}
          running={radarRun.running}
          notice={radarRun.notice}
        />

        {data && (
          <>
            {/* The blueprint's own state (recipe file, the worst card, its next step); risk checks are above. */}
            <RecipeHeaderSummary recipe={data} elements={elements} onSelect={(key) => setSelectedKey(key)} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-fg-muted">
                {isValidating ? 'Updating…' : 'Click a card for what is wrong and how to fix it.'}
              </p>
              <SegmentedControl<ViewMode>
                value={view}
                options={VIEW_OPTIONS}
                onChange={setView}
                ariaLabel="Recipe layout"
                size="sm"
              />
            </div>
            {/* The diagram gets the whole width: a 352 px "Pick a card…" column cut its Deploy lane and
                hid Runtime (2026-11-18). A picked card opens its panel beside the list, or over the
                diagram's right edge; nothing is reserved while no card is picked. */}
            <div className={`relative flex flex-col gap-4 ${showList ? 'lg:flex-row lg:items-start' : ''}`}>
              <div ref={columnRef} className="min-w-0 flex-1">
                {showList ? (
                  <RecipeElementList elements={elements} selectedKey={selectedKey} onSelect={onSelect} />
                ) : (
                  <Suspense fallback={<Loading text="Loading diagram…" />}>
                    <RecipeFlow elements={elements} selectedKey={selectedKey} onSelect={onSelect} />
                  </Suspense>
                )}
              </div>
              {selected && (
                <div
                  className={showList ? 'w-full shrink-0 lg:w-88' : 'w-full lg:absolute lg:top-8 lg:right-3 lg:z-10 lg:w-88 lg:shadow-lg'}
                  data-testid="recipe-side-panel-slot"
                >
                  <RecipeSidePanel key={selected.key} projectId={projectId} element={selected} onClose={() => setSelectedKey(null)} />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Dependency holes as table rows: the structured /vulnerabilities groups when that read has
 * them, otherwise the radar's own finding sentences; null while neither has answered.
 */
function dependencyRows(vulns: KnownHolesView | null, radar: RadarView | null): HoleRow[] | null {
  const fromGroups = vulns?.available && vulns.groups.length > 0 ? holeRowsFromGroups(vulns.groups) : []
  if (fromGroups.length > 0) return fromGroups
  const check = radar?.detectors.find((d) => d.ruleId === DEPENDENCY_RULE)
  if (check?.state === 'finding') return holeRowsFromFindings(check.findings).rows
  return vulns || radar ? [] : null
}

/** The lead's one button: whatever fixes the worst thing on the page. */
function LeadAction({
  next,
  holes,
  radar,
  onRun,
  running,
  onSelect,
}: {
  next: ReturnType<typeof recipeVerdict>['next']
  holes: HoleRow[] | null
  radar: RadarView | null
  onRun: () => void
  running: boolean
  onSelect: (key: string) => void
}) {
  if (!next) return null
  if (next.kind === 'fix-holes' && holes && holes.length > 0) {
    return <CopyPromptButton variant="primary" text={fixAllHolesPrompt(holes)} label="Fix all holes: copy prompt" title="One prompt for your editor that makes every upgrade in the table below" testId="recipe-lead-fix-holes" />
  }
  if (next.kind === 'fix-check') {
    const d = radar?.detectors.find((x) => x.ruleId === next.ruleId)
    if (d && d.findings.length > 0) return <CopyPromptButton variant="primary" text={checkFixPrompt(d)} label="Copy fix prompt" testId="recipe-lead-fix-check" />
  }
  if (next.kind === 'element') {
    return (
      <Btn size="sm" variant="primary" onClick={() => onSelect(next.key)}>
        Show how to fix {next.label}
      </Btn>
    )
  }
  return (
    <Btn size="sm" variant="primary" onClick={onRun} loading={running} disabled={running}>
      Run checks
    </Btn>
  )
}
