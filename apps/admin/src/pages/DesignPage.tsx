/**
 * DesignPage — the design plane of the App Recipe (Plan 019 §1.2, Phase 1b).
 *
 * Shows the project's DTCG design tokens visually (colour, contrast, type,
 * spacing, radius, motion), the component inventory and token issues; scores
 * how far the code deviates from the system; and turns token or rule edits
 * into a reviewed draft PR (preview diff first, then confirm).
 *
 * Data: GET  /v1/admin/projects/:id/design[?direction=] → DesignPlaneResponse
 *       POST /v1/admin/projects/:id/design/changes       → DesignChangeResult
 *       POST /v1/admin/projects/:id/design/deviance/run  → DesignDevianceRunResult (202, scan runs in the background)
 *       GET  /v1/admin/projects/:id/design/deviance      → polled every 5 s while a scan is running
 *       GET|PUT /v1/admin/projects/:id/design/settings   → DesignActionsCard (CI gate + design auto-fix, off by default)
 *
 * The edit queue and both preview states live at the top of the page: a set
 * switch re-fetches (and briefly clears) the data, and must not drop edits.
 *
 * Views (?view=directions): "Tokens" (the active set, deviance, rules) and
 * "Directions" (every art direction side by side, DirectionsBoard).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { Btn, Callout, EmptyState, ErrorAlert, Loading, Section, SegmentedControl } from '../components/ui'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { usePageData } from '../lib/usePageData'
import { apiFetchMutate } from '../lib/supabase'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import type {
  DesignDevianceRunResult,
  DesignPlaneResponse,
  DesignRuleId,
  DesignTokenSet,
  TokenEdit,
} from '../lib/recipeTypes'
import { DesignStateBanner } from '../components/design/DesignStateBanner'
import { DesignTokenSections } from '../components/design/DesignTokenSections'
import { ContrastTiles } from '../components/design/ContrastTiles'
import { DeviancePanel, type DevianceRunNotice } from '../components/design/DeviancePanel'
import { DesignRulesConfig } from '../components/design/DesignRulesConfig'
import { DesignActionsCard } from '../components/design/DesignActionsCard'
import { TokenEditQueue } from '../components/design/TokenEditQueue'
import { changeLocksInputs, useDesignChange } from '../components/design/useDesignChange'
import { editKey, type RuleChange } from '../components/design/designTokens'
import { RecipeIssueList } from '../components/recipe/RecipeIssueList'
import { ComponentInventory } from '../components/design/ComponentInventory'
import { DirectionsBoard } from '../components/design/DirectionsBoard'
import { CssScopeColumns } from '../components/design/CssScopeColumns'
import { describeDevianceSettle, useDeviancePoll, type DevianceSettle } from '../components/design/useDeviancePoll'

type DesignView = 'tokens' | 'directions'

const VIEW_OPTIONS = [
  { id: 'tokens', label: 'Tokens' },
  { id: 'directions', label: 'Directions' },
] as const

function orderSets(sets: DesignTokenSet[]): DesignTokenSet[] {
  const rank = (k: DesignTokenSet['kind']) => (k === 'direction' ? 0 : k === 'default' ? 1 : 2)
  return [...sets].sort((a, b) => rank(a.kind) - rank(b.kind) || a.name.localeCompare(b.name))
}

export function DesignPage() {
  const projectId = useActiveProjectId()

  if (!projectId) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeaderBar title="Design system" />
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            title="No project selected"
            description="Switch to a project using the selector at the top to see its design system."
          />
        </div>
      </div>
    )
  }

  // Keyed by project: queued edits, the chosen set and any held preview can
  // never carry over to another project's repo.
  return <ProjectDesign key={projectId} projectId={projectId} />
}

function ProjectDesign({ projectId }: { projectId: string }) {
  const [params, setParams] = useSearchParams()
  const view: DesignView = params.get('view') === 'directions' ? 'directions' : 'tokens'
  const setView = useCallback(
    (next: DesignView) =>
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev)
          if (next === 'directions') out.set('view', 'directions')
          else out.delete('view')
          return out
        },
        { replace: true },
      ),
    [setParams],
  )
  const [direction, setDirection] = useState<string | null>(null)
  const path = `/v1/admin/projects/${projectId}/design${direction ? `?direction=${encodeURIComponent(direction)}` : ''}`
  const { data, loading, error, reload } = usePageData<DesignPlaneResponse>(path)

  // Keep the set picker on screen while a set switch re-fetches.
  const [stickySets, setStickySets] = useState<{ sets: DesignTokenSet[]; activeSet: string | null; shownSet: string | null } | null>(null)
  useEffect(() => {
    if (data) setStickySets({ sets: data.sets, activeSet: data.activeSet, shownSet: data.shownSet })
  }, [data])

  // ── Token edit queue (survives set switches) ──────────────────────────────
  const [edits, setEdits] = useState<TokenEdit[]>([])
  const tokenChange = useDesignChange(projectId)
  const rulesChange = useDesignChange(projectId)
  const { reset: resetTokenChange, preview: previewTokenChange } = tokenChange
  const { preview: previewRulesChange } = rulesChange
  const queuedMap = useMemo(() => new Map(edits.map((e) => [editKey(e), e])), [edits])

  const queueEdit = useCallback(
    (edit: TokenEdit) => {
      setEdits((cur) => [...cur.filter((e) => editKey(e) !== editKey(edit)), edit])
      resetTokenChange()
    },
    [resetTokenChange],
  )
  const removeEdit = useCallback(
    (edit: TokenEdit) => {
      setEdits((cur) => cur.filter((e) => editKey(e) !== editKey(edit)))
      resetTokenChange()
    },
    [resetTokenChange],
  )
  const clearEdits = useCallback(() => {
    setEdits([])
    resetTokenChange()
  }, [resetTokenChange])
  const previewTokens = useCallback(() => {
    if (edits.length === 0) return
    void previewTokenChange({ kind: 'tokens', edits })
  }, [edits, previewTokenChange])
  const discardTokenPreview = useCallback(() => {
    // A PR was opened for exactly these edits: the queue is done.
    if (tokenChange.state.phase === 'submitted' && tokenChange.state.result?.pr) setEdits([])
    resetTokenChange()
  }, [tokenChange.state, resetTokenChange])

  const previewRules = useCallback(
    (rules: Partial<Record<DesignRuleId, RuleChange>>) => {
      if (Object.keys(rules).length === 0) return
      void previewRulesChange({ kind: 'rules', rules })
    },
    [previewRulesChange],
  )

  // ── Deviance run ──────────────────────────────────────────────────────────
  // POST answers 202 with a `running` run; useDeviancePoll follows it to the end.
  const [starting, setStarting] = useState(false)
  const [runNotice, setRunNotice] = useState<DevianceRunNotice>(null)
  const onScanSettled = useCallback(
    (outcome: DevianceSettle) => {
      setRunNotice(describeDevianceSettle(outcome))
      reload()
    },
    [reload],
  )
  const { running: backgroundRun, follow: followScan } = useDeviancePoll({ projectId, onSettled: onScanSettled })
  const running = starting || backgroundRun !== null
  const runDeviance = useCallback(async () => {
    if (running) return
    setStarting(true)
    setRunNotice(null)
    try {
      const res = await apiFetchMutate<DesignDevianceRunResult>(
        `/v1/admin/projects/${projectId}/design/deviance/run`,
        { method: 'POST', body: '{}' },
      )
      if (!res.ok || !res.data) {
        const rateLimited = res.error?.code === 'RATE_LIMITED'
        setRunNotice({
          tone: rateLimited ? 'warn' : 'danger',
          text: rateLimited
            ? res.error?.message || 'Too many deviance checks — wait a moment and try again.'
            : res.error?.message || 'The deviance check failed.',
        })
        return
      }
      const { refresh, run } = res.data
      if (!run) {
        setRunNotice({ tone: 'danger', text: `The scan did not run: ${refresh.reason || 'no reason given.'}` })
      } else if (run.status === 'running') {
        // 202: the scan continues in the background; the poll reports how it ends.
        followScan(run)
        if (!refresh.ok) setRunNotice({ tone: 'warn', text: `Scanning, but the token refresh failed: ${refresh.reason}` })
      } else {
        // An older server that still scans inline.
        setRunNotice(describeDevianceSettle({ kind: 'finished', run }))
      }
    } finally {
      setStarting(false)
      reload()
    }
  }, [projectId, running, reload, followScan])

  const sets = orderSets(data?.sets ?? stickySets?.sets ?? [])
  const activeSet = data?.activeSet ?? stickySets?.activeSet ?? null
  const shownSet = direction ?? data?.shownSet ?? stickySets?.shownSet ?? null

  return (
    <div className={PAGE_CONTENT_STACK}>
      <PageHeaderBar
        title="Design system"
        helpTitle="What is the design system page?"
        helpWhatIsIt="Your app's design tokens, read from the files mushi.recipe.json points at, shown as swatches, contrast pairs, type, spacing, radius and motion — plus a deviance score for code that uses values outside the system. Diagnoses use these tokens so a fix stays on-system."
        helpHowToUse="Pick a set, check the contrast pairs, then run a deviance check. To change a token or a rule, queue the edit, preview the diff, and confirm: Mushi opens a draft PR and never writes to your repo directly."
        helpFlowPath="/design"
      >
        {/* One control, one tab stop (QA 293); named as the sidebar names the page. */}
        <Btn to="/recipe" size="sm" variant="ghost">
          App blueprint
        </Btn>
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            show: data != null,
            children: data ? <DesignStateBanner design={data} /> : null,
          },
        ]}
      />

      <div className="flex w-full min-w-0 flex-col gap-4">
        <SegmentedControl<DesignView> value={view} options={VIEW_OPTIONS} onChange={setView} ariaLabel="Design view" />

        {view === 'directions' && <DirectionsBoard projectId={projectId} />}

        {view === 'tokens' && sets.length > 0 && (
          <div className="flex flex-col gap-1">
            <SegmentedControl<string>
              value={shownSet ?? ''}
              options={sets.map((s) => ({
                id: s.name,
                label: s.name === activeSet ? `${s.name} (active)` : s.name,
                count: s.tokenCount,
              }))}
              onChange={(name) => setDirection(name)}
              ariaLabel="Token set"
              scrollable
            />
            {activeSet && (
              <p className="text-2xs text-fg-muted">
                Active (from mushi.recipe.json): <span className="font-mono">{activeSet}</span>
              </p>
            )}
          </div>
        )}

        {view === 'tokens' && error && <ErrorAlert message={error} endpoint={path} onRetry={reload} />}
        {view === 'tokens' && loading && !data && <Loading text="Loading design tokens…" />}

        {view === 'tokens' && data && !data.editable.enabled && (
          <Callout tone="neutral" label="Editing is off">
            <p className="text-xs text-fg-secondary">{data.editable.reason ?? 'Token edits are not available for this project.'}</p>
          </Callout>
        )}

        {view === 'tokens' && (
          <TokenEditQueue
            edits={edits}
            change={tokenChange.state}
            onRemove={removeEdit}
            onClear={clearEdits}
            onPreview={previewTokens}
            onConfirm={() => void tokenChange.confirm()}
            onDiscard={discardTokenPreview}
          />
        )}

        {view === 'tokens' && data && (
          <>
            <DesignTokenSections
              tokens={data.tokens}
              editable={data.editable}
              set={data.shownSet}
              queued={queuedMap}
              onQueue={queueEdit}
              locked={changeLocksInputs(tokenChange.state)}
            />

            <Section title="Contrast" action={<span className="text-2xs text-fg-faint">WCAG ratio per declared pair</span>}>
              <ContrastTiles pairs={data.contrast} />
            </Section>

            {/* An older api without scoped CSS sends no cssScopes. */}
            <CssScopeColumns scopes={data.cssScopes ?? []} />

            <Section title="Components" action={<span className="text-2xs text-fg-faint">{data.components.length} listed</span>}>
              <ComponentInventory components={data.components} />
            </Section>

            <Section title="Token issues" action={<span className="text-2xs text-fg-faint">{data.issues.length} found</span>}>
              <RecipeIssueList issues={data.issues} empty="No token issues in this set." />
            </Section>

            <DeviancePanel
              deviance={data.deviance}
              running={running}
              runningSince={backgroundRun?.startedAt ?? null}
              notice={runNotice}
              onRun={() => void runDeviance()}
            />

            <DesignActionsCard projectId={projectId} score={data.deviance.latest?.score ?? null} />

            <DesignRulesConfig
              rules={data.rules}
              editable={data.editable}
              change={rulesChange.state}
              onPreview={previewRules}
              onConfirm={() => void rulesChange.confirm()}
              onDiscard={rulesChange.reset}
            />
          </>
        )}
      </div>
    </div>
  )
}
