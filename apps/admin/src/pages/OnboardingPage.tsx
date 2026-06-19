/**
 * FILE: apps/admin/src/pages/OnboardingPage.tsx
 * PURPOSE: Wizard-mode setup view. Renders the shared SetupChecklist primitive
 *          and adds the contextual UX needed for the very first project (create
 *          form + API key reveal + test report + SDK snippet).
 *
 *          State source-of-truth is `useSetupStatus()` (DB-backed). The wizard
 *          drives next-step focus off `activeProject.steps`, so progress survives
 *          across browsers/devices and stays in sync with what the rest of the
 *          admin sees.
 */

import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { SnapshotSectionHint,Card, Btn, Input, ErrorAlert, ResultChip, type ResultChipTone, CopyButton, Section, StatCard, SegmentedControl, Badge, HelpBanner } from '../components/ui'
import { OnboardingStatusBanner } from '../components/onboarding/OnboardingStatusBanner'
import { OnboardingStepsGuide } from '../components/onboarding/OnboardingStepsGuide'
import { OnboardingModeIntroCard } from '../components/onboarding/OnboardingModeIntroCard'
import { EMPTY_ONBOARDING_STATS, type OnboardingStats, type OnboardingTabId } from '../components/onboarding/types'
import { usePublishPageContext } from '../lib/pageContext'
import { useRealtimeReload } from '../lib/realtime'
import { PageHero } from '../components/PageHero'
import { ContainedBlock } from '../components/report-detail/ReportSurface'
import { OnboardingSkeleton } from '../components/skeletons/OnboardingSkeleton'
import { ConnectionStatus } from '../components/ConnectionStatus'
import { SetupChecklist } from '../components/SetupChecklist'
import { ProjectNarrativeStrip } from '../components/dashboard/ProjectNarrativeStrip'
import { PdcaFlow } from '../components/pdca-flow/PdcaFlow'
import { SdkInstallCard } from '../components/SdkInstallCard'
import { useSetupStatus } from '../lib/useSetupStatus'
import { isActivationCockpitV2Enabled, useActivationStatus } from '../lib/useActivationStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useToast } from '../lib/toast'
import { useCreateProject } from '../lib/useCreateProject'
import { usePageCopy } from '../lib/copy'
import { useOnboardingUx, resolveQuickOnboardingTab } from '../lib/onboardingModeUx'
import {
  optionalDetail,
  optionalTooltip,
  reportsDetail,
  reportsTooltip,
  requiredDetail,
  requiredTooltip,
  sdkDetail,
  sdkTooltip,
} from '../lib/statTooltips/onboarding'
import { onboardingLinks } from '../lib/statCardLinks'
import { restartFirstRunTour } from '../components/FirstRunTour'
import { ConfigHelp } from '../components/ConfigHelp'
import { OnboardingActivationLanes } from '../components/onboarding/OnboardingActivationLanes'
import { MigrationsInProgressCard } from '../components/migrations/MigrationsInProgressCard'
import { clearStoredInstanceConfig } from '../lib/env'
import { IconChat } from '../components/icons'
import { askMushiPanel } from '../lib/useAskMushiPanel'

interface ApiKey {
  key: string
  prefix: string
}

const ONBOARDING_TABS: Array<{ id: OnboardingTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Setup posture, loop explainer, and what to do next on the active project.',
  },
  {
    id: 'steps',
    label: 'Steps',
    description: 'Checklist with required + optional milestones — synced from live DB state.',
  },
  {
    id: 'verify',
    label: 'Verify',
    description: 'API key mint, connection probe, and admin test-report submission.',
  },
  {
    id: 'sdk',
    label: 'SDK',
    description: 'Install snippet and init copy — bookmark this tab after setup completes.',
  },
]

function isOnboardingTab(value: string | null): value is OnboardingTabId {
  return ONBOARDING_TABS.some((t) => t.id === value)
}

export function OnboardingPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const activeProjectId = useActiveProjectId()
  const activationEnabled = isActivationCockpitV2Enabled()
  const activation = useActivationStatus(activeProjectId)
  const legacySetup = useSetupStatus(activeProjectId)
  const setup = activationEnabled
    ? {
        data: activation.setup,
        loading: activation.loading,
        error: activation.error,
        reload: activation.reload,
        hasAnyProject: activation.hasAnyProject,
        activeProject: activation.activeProject,
        selectors: activation.selectors,
        isStepIncomplete: activation.isStepIncomplete,
        getStep: activation.getStep,
      }
    : legacySetup
  const copy = usePageCopy('/onboarding')
  const ux = useOnboardingUx()
  const [searchParams, setSearchParams] = useSearchParams()

  const tabParam = searchParams.get('tab')
  const activeTab: OnboardingTabId = isOnboardingTab(tabParam) ? tabParam : 'overview'

  const {
    data: legacyStatsData,
    loading: legacyStatsLoading,
    error: legacyStatsError,
    reload: legacyReloadStats,
    lastFetchedAt: legacyStatsFetchedAt,
    isValidating: legacyStatsValidating,
  } = usePageData<OnboardingStats>(
    activationEnabled ? null : '/v1/admin/onboarding/stats',
  )

  const statsData = activationEnabled ? activation.stats : legacyStatsData
  usePublishPageHeroStats('/onboarding', statsData)
  const statsLoading = activationEnabled ? activation.loading : legacyStatsLoading
  const statsError = activationEnabled ? activation.error : legacyStatsError
  const statsFetchedAt = activationEnabled ? activation.lastFetchedAt : legacyStatsFetchedAt
  const statsValidating = activationEnabled ? activation.isValidating : legacyStatsValidating
  const reloadStats = activationEnabled ? activation.reload : legacyReloadStats
  const stats = statsData ?? EMPTY_ONBOARDING_STATS

  // In Quickstart mode the overview tab is hidden and the segmented control
  // shows "Create / Verify / Install" labels. Previously effectiveTab was hard-
  // locked to resolveQuickOnboardingTab(stats), making the segmented tabs
  // clickable but inert. Now an explicit URL param always wins so the user can
  // navigate freely; we only fall back to the computed default when no valid
  // param is present.
  const effectiveTab: OnboardingTabId = ux.hideOverviewTab
    ? (isOnboardingTab(tabParam) && tabParam !== 'overview' ? tabParam : resolveQuickOnboardingTab(stats))
    : activeTab
  const activeTabMeta = ONBOARDING_TABS.find((t) => t.id === effectiveTab) ?? ONBOARDING_TABS[1]

  const reloadAll = useCallback(() => {
    reloadStats()
    setup.reload()
  }, [reloadStats, setup])

  useRealtimeReload(['projects', 'project_api_keys', 'reports', 'fix_attempts'], reloadAll)

  const setActiveTab = useCallback(
    (id: OnboardingTabId) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'overview') next.delete('tab')
      else next.set('tab', id)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  const [projectName, setProjectName] = useState('')
  const [apiKey, setApiKey] = useState<ApiKey | null>(null)
  const [generatingKey, setGeneratingKey] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'running' | 'pass' | 'fail'>('idle')
  const [testRanAt, setTestRanAt] = useState<string | null>(null)
  // Local "operational" error used by the API key / test-report cards that
  // don't have a hook of their own. Project creation has its own structured
  // error channel via `useCreateProject` below so its surface is
  // intentionally separate (the recovery affordances differ per code).
  const [error, setError] = useState('')

  // Must be called unconditionally on every render — the skeleton/error
  // early-returns below would otherwise produce a different hook count
  // between first (loading) and subsequent (loaded) renders.
  const {
    create: createProjectRaw,
    creating,
    error: createError,
    clearError: clearCreateError,
  } = useCreateProject({
    onCreated: () => {
      setProjectName('')
      setup.reload()
      // In Quickstart linear flow: project created → advance to Verify so the
      // user can immediately mint an API key without an extra click.
      if (ux.hideOverviewTab) setActiveTab('verify')
    },
  })

  const project = setup.activeProject

  // What's the next required step? We use it to highlight the right card.
  const nextRequired = useMemo(
    () => project?.steps.find(s => s.required && !s.complete) ?? null,
    [project],
  )

  // NOTE: We deliberately do NOT auto-redirect when the project is fully set
  // up. An earlier version bounced finished projects to `/`, which made the
  // SDK install snippet (Card 4) unreachable from the sidebar "Setup" link,
  // command palette, or any bookmark — the snippet existed nowhere else in
  // the app, so finished users had no way to look it up again. Instead we
  // render a "Setup complete" hero at the top so the page reads well in
  // both first-run and post-onboarding states.

  async function createProject() {
    setError('')
    // `useCreateProject` already populates `createError` on failure with a
    // structured `{ code, message }` payload, so the page no longer needs
    // a bare boolean "Failed to create project" duplicate — the inline
    // `<ErrorAlert>` below reads that structured channel and renders the
    // actual server message plus context-aware recovery actions.
    await createProjectRaw(projectName)
  }

  // Recovery actions for the project-create error card. Branches on the
  // stable error code from `useCreateProject` so a user who hits e.g.
  // `NO_ORGANIZATION` after signup gets a one-click path into the
  // organization-members screen (which is where the "+ New team" affordance
  // lives) rather than a dead-end danger banner. Keeping the branch table
  // co-located with the consumer keeps each page in control of its own
  // recovery copy without polluting the hook.
  const createErrorActions = (() => {
    if (!createError) return undefined
    switch (createError.code) {
      case 'NO_ORGANIZATION':
        return [
          {
            label: 'Open team settings',
            onClick: () => navigate('/organization/members'),
          },
          { label: 'Dismiss', onClick: clearCreateError },
        ]
      case 'FORBIDDEN':
        return [
          {
            label: 'Switch team',
            onClick: () => navigate('/organization/members'),
          },
          { label: 'Dismiss', onClick: clearCreateError },
        ]
      case 'NETWORK_ERROR':
        return [
          { label: 'Try again', onClick: () => void createProjectRaw(projectName) },
          { label: 'Dismiss', onClick: clearCreateError },
        ]
      default:
        return [{ label: 'Dismiss', onClick: clearCreateError }]
    }
  })()

  // Helper copy keyed by error code. Falls back to the raw server message
  // when we don't have a hand-tuned explanation. The goal is to translate
  // backend-shaped strings into "what does this mean for me, the user".
  const createErrorTitle = (() => {
    if (!createError) return undefined
    switch (createError.code) {
      case 'NO_ORGANIZATION':
        return 'No writable team found'
      case 'FORBIDDEN':
        return 'Not allowed in this team'
      case 'INVALID_NAME':
        return 'Project name required'
      case 'NETWORK_ERROR':
        return 'Couldn\u2019t reach the server'
      default:
        return 'Couldn\u2019t create project'
    }
  })()

  async function generateKey() {
    if (!project) return
    setGeneratingKey(true)
    setError('')
    const res = await apiFetch<ApiKey>(`/v1/admin/projects/${project.project_id}/keys`, { method: 'POST' })
    setGeneratingKey(false)
    if (res.ok && res.data) {
      setApiKey(res.data)
      toast.success('API key generated', 'Copy it now \u2014 it will not be shown again. Then submit a test report below to verify the pipeline.')
      setup.reload()
    } else {
      const msg = res.error?.message ?? 'Failed to generate API key'
      setError(msg)
      toast.error('Could not generate API key', msg)
    }
  }

  async function submitTestReport() {
    if (!project) return
    setTestStatus('running')
    setError('')
    // Use the admin pipeline-test endpoint so we don't need the user to have
    // copied the key yet — we're already JWT-authenticated as the owner.
    const res = await apiFetch(`/v1/admin/projects/${project.project_id}/test-report`, { method: 'POST' })
    setTestRanAt(new Date().toISOString())
    setTestStatus(res.ok ? 'pass' : 'fail')
    if (res.ok) {
      toast.success('Test report sent', 'Look for it on the Reports page in a few seconds.')
      setup.reload()
      reloadStats()
      // In Quickstart linear flow: pipeline verified → advance to Install SDK.
      if (ux.hideOverviewTab) setActiveTab('sdk')
    } else {
      const msg = res.error?.message ?? 'Test report submission failed'
      setError(msg)
      toast.error('Test report failed', msg)
    }
  }

  // Maps the local 4-state lifecycle to the shared ResultChip tone vocabulary.
  // Co-located with the consumer because the mapping is page-specific (idle is
  // suppressed at the call site so the chip never appears before first run).
  function testTone(status: 'idle' | 'running' | 'pass' | 'fail'): ResultChipTone {
    if (status === 'running') return 'running'
    if (status === 'pass') return 'success'
    if (status === 'fail') return 'error'
    return 'idle'
  }

  function copyToClipboard(text: string, setter: (v: boolean) => void) {
    navigator.clipboard.writeText(text).then(() => {
      setter(true)
      setTimeout(() => setter(false), 2000)
    })
  }

  const sdkInstalled = !setup.isStepIncomplete('sdk_installed')
  const hasReports = (project?.report_count ?? 0) > 0
  const hasFix = (project?.fix_count ?? 0) > 0
  const hasMerged = (project?.merged_fix_count ?? 0) > 0
  // Render a "Setup complete" hero (instead of bouncing) when there's nothing
  // left for this project to do. Keeps the page useful as a permanent SDK
  // reference for fully onboarded users.
  const setupComplete = Boolean(project?.done && project.complete >= project.total)

  const setupSeverity: 'ok' | 'warn' | 'neutral' | 'info' =
    stats.setupDone ? 'ok' : stats.sdkHostMismatch ? 'warn' : !stats.hasAnyProject ? 'neutral' : 'info'

  usePublishPageContext({
    route: '/onboarding',
    title: `${activeTabMeta.label} · Setup`,
    summary: activeTabMeta.description,
    filters: { tab: activeTab, project_id: activeProjectId ?? undefined },
    criticalCount: stats.setupDone ? 0 : stats.requiredTotal - stats.requiredComplete,
  })

  const tabOptions = useMemo(() => {
    const visibleTabs = ux.hideOverviewTab
      ? ONBOARDING_TABS.filter((t) => t.id !== 'overview')
      : ONBOARDING_TABS
    return visibleTabs.map((t) => {
      let count: number | undefined
      if (t.id === 'steps') {
        count =
          stats.requiredTotal - stats.requiredComplete > 0
            ? stats.requiredTotal - stats.requiredComplete
            : stats.stepsComplete > 0
              ? stats.stepsComplete
              : undefined
      } else if (t.id === 'verify') {
        count = stats.hasApiKey && stats.reportCount === 0 ? 1 : undefined
      }
      return {
        id: t.id,
        label: copy?.tabLabels?.[t.id] ?? t.label,
        count,
      }
    })
  }, [ux.hideOverviewTab, copy?.tabLabels, stats])

  if (setup.loading || (statsLoading && !statsData)) return <OnboardingSkeleton />
  if (setup.error) {
    const isNetwork =
      setup.error.includes('Failed to fetch') ||
      setup.error.includes('NETWORK_ERROR') ||
      setup.error.includes('NetworkError')
    return (
      <ErrorAlert
        title={isNetwork ? 'Cannot reach the Mushi backend' : undefined}
        message={setup.error}
        onRetry={reloadAll}
        actions={
          isNetwork
            ? [{ label: 'Reset to Mushi Cloud', onClick: () => clearStoredInstanceConfig() }]
            : undefined
        }
      >
        {isNetwork && (
          <p className="text-xs text-danger/80 mt-2">
            A saved self-hosted URL may be wrong. Resetting clears local overrides and reloads
            against Mushi Cloud.
          </p>
        )}
      </ErrorAlert>
    )
  }
  if (statsError) return <ErrorAlert message={`Failed to load setup stats: ${statsError}`} onRetry={reloadAll} />

  return (
    <div className="space-y-4">
      <PageHeaderBar
        title={copy?.title ?? 'Setup'}
        projectScope={stats.projectName ?? undefined}
        withPageHero={!ux.hideOverviewChrome}
        description={copy?.description ?? 'Create a project, mint an ingest key, install the SDK, and watch your first report become a plain-English diagnosis — target: under 2 minutes.'}
        helpTitle={copy?.help?.title ?? 'About this wizard'}
        helpWhatIsIt={copy?.help?.whatIsIt ?? 'A guided flow that creates your first project, generates an API key, verifies the pipeline, and shows the SDK snippet. State syncs across devices.'}
        helpUseCases={copy?.help?.useCases ?? [
          'Create the project that will receive bug reports from your app',
          'Generate and copy the API key that authenticates SDK requests',
          'Confirm the ingest pipeline is reachable before shipping any code',
        ]}
        helpHowToUse={copy?.help?.howToUse ?? 'Complete the required steps in order. The API key is only shown once — copy it before continuing. You can rerun the test report any time from Settings.'}
      >
        <Badge className={stats.setupDone ? 'bg-ok-muted text-ok' : stats.hasAnyProject ? 'bg-warn-muted/50 text-warning-foreground' : 'bg-info-muted/50 text-info-foreground'}>
          {stats.setupDone ? 'READY' : stats.hasAnyProject ? `${stats.requiredComplete}/${stats.requiredTotal}` : 'START'}
        </Badge>
      </PageHeaderBar>

      {/* Mode intro card — renders only on first visit; dismissed via localStorage */}
      <OnboardingModeIntroCard />

      <OnboardingStatusBanner
        stats={stats}
        onTab={setActiveTab}
        onRunTest={project ? () => void submitTestReport() : undefined}
        testing={testStatus === 'running'}
        plainLanguage={ux.plainBanner}
      />

      <OnboardingStepsGuide
        stats={{
          setupDone: stats.setupDone,
          hasAnyProject: stats.hasAnyProject,
          requiredComplete: stats.requiredComplete,
          requiredTotal: stats.requiredTotal,
        }}
      />

      {ux.hideOverviewTab && (
        <div className="flex items-center gap-1.5 text-2xs" aria-label="Setup progress">
          {(['steps', 'verify', 'sdk'] as const).map((id, i) => {
            const STEP_LABELS: Record<string, string> = {
              steps: tabOptions.find((t) => t.id === 'steps')?.label ?? 'Create',
              verify: tabOptions.find((t) => t.id === 'verify')?.label ?? 'Verify',
              sdk: tabOptions.find((t) => t.id === 'sdk')?.label ?? 'Install',
            }
            const stepOrder = ['steps', 'verify', 'sdk']
            const currentIdx = stepOrder.indexOf(effectiveTab)
            const thisIdx = stepOrder.indexOf(id)
            const isDone = thisIdx < currentIdx
            const isActive = id === effectiveTab
            return (
              <span key={id} className="flex items-center gap-1.5">
                {i > 0 && (
                  <span className="text-fg-faint" aria-hidden="true">›</span>
                )}
                <span
                  className={`font-medium transition-colors ${
                    isActive
                      ? 'text-brand'
                      : isDone
                        ? 'text-ok'
                        : 'text-fg-faint'
                  }`}
                >
                  {isDone && <span className="mr-0.5" aria-hidden="true">✓</span>}
                  {i + 1}. {STEP_LABELS[id]}
                </span>
              </span>
            )
          })}
        </div>
      )}

      {!ux.hideOverviewTab || tabOptions.length > 1 ? (
        <SegmentedControl
          value={effectiveTab}
          onChange={setActiveTab}
          options={tabOptions}
          ariaLabel="Setup sections"
          size="sm"
        />
      ) : null}

      <Section
        title={copy?.sections?.snapshot ?? 'Setup snapshot'}
        freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      >
        {!ux.hideOverviewTab ? (
        <SnapshotSectionHint text={activeTabMeta.description} />
        ) : null}
        <div className={`grid grid-cols-2 gap-2 ${ux.hideOptionalStat ? 'sm:grid-cols-3' : 'sm:grid-cols-4'}`}>
          <StatCard
            label={copy?.statLabels?.required ?? 'Required'}
            value={`${stats.requiredComplete}/${stats.requiredTotal}`}
            accent={stats.setupDone ? 'text-ok' : 'text-warn'}
            tooltip={requiredTooltip(stats)}
            detail={requiredDetail(stats)}
            to={onboardingLinks.required}
          />
          <StatCard
            label={copy?.statLabels?.sdk ?? 'SDK'}
            value={stats.sdkInstalled ? 'Live' : stats.hasApiKey ? 'Pending' : '—'}
            accent={stats.sdkInstalled ? 'text-ok' : stats.sdkHostMismatch ? 'text-danger' : 'text-info'}
            tooltip={sdkTooltip(stats)}
            detail={sdkDetail(stats)}
            to={onboardingLinks.sdk}
          />
          <StatCard
            label={copy?.statLabels?.reports ?? 'Reports'}
            value={stats.reportCount}
            accent={stats.reportCount > 0 ? 'text-brand' : undefined}
            tooltip={reportsTooltip(stats)}
            detail={reportsDetail(stats)}
            to={onboardingLinks.reports}
          />
          {!ux.hideOptionalStat ? (
            <StatCard
              label={copy?.statLabels?.optional ?? 'Optional'}
              value={`${stats.optionalComplete}/${stats.optionalTotal}`}
              accent="text-fg-secondary"
              tooltip={optionalTooltip(stats)}
              detail={optionalDetail(stats)}
              to={onboardingLinks.optional}
            />
          ) : null}
        </div>
      </Section>

      {effectiveTab === 'overview' && (
        <>
      {activationEnabled && (
        <OnboardingActivationLanes
          project={project ?? null}
          stats={stats}
          preflight={activation.preflight}
          topPriority={activation.topPriority}
          className="mb-4"
        />
      )}
      {!ux.hideOverviewChrome ? (
      <div className="overflow-hidden rounded-xl border border-edge bg-surface-raised p-5">
        <p className="font-mono text-2xs uppercase tracking-[0.24em] text-brand">Mushi / setup</p>
        <h2 className="mt-2 font-serif text-3xl leading-none tracking-[-0.04em] text-fg">
          User-felt bugs, ready for your first project.
        </h2>
        <p className="mt-3 text-xs leading-6 text-fg-muted">
          Create a project, mint an ingest key, and verify the first report
          against live backend state. This mirrors the cloud landing promise:
          install the SDK once, then let every report enter the repair loop.
        </p>
      </div>
      ) : null}

      {!ux.hideOverviewChrome ? (
      <PageHero
        scope="onboarding"
        title="Get started"
        kicker="Start here"
        decide={{
          label: stats.setupDone ? 'Pipeline wired' : stats.nextStepLabel ?? 'Begin setup',
          metric: `${stats.requiredComplete}/${stats.requiredTotal} required`,
          summary: stats.setupDone
            ? `${stats.projectName ?? 'Project'} ingests reports — optional integrations remain on the Steps tab.`
            : stats.hasAnyProject
              ? `Finish ${stats.nextStepLabel ?? 'the next step'} so Dashboard and Reports stop showing empty shells.`
              : 'Create a project first — everything else (keys, SDK, test report) hangs off that row.',
          severity: setupSeverity,
          anchor: 'onboarding:decide',
          evidence: {
            kind: 'metric-breakdown',
            items: [
              { label: 'Required', value: `${stats.requiredComplete}/${stats.requiredTotal}`, tone: stats.setupDone ? 'ok' : 'warn' },
              { label: 'Reports', value: stats.reportCount, tone: stats.reportCount > 0 ? 'ok' : 'neutral' },
              { label: 'Fixes', value: stats.fixCount, tone: stats.fixCount > 0 ? 'info' : 'neutral' },
              { label: 'SDK', value: stats.sdkInstalled ? '✓' : '—', tone: stats.sdkInstalled ? 'ok' : 'neutral' },
            ],
          },
        }}
        verify={{
          label: stats.reportCount > 0 ? 'Pipeline verified' : 'Awaiting first report',
          detail: stats.reportCount > 0
            ? `${stats.reportCount} report${stats.reportCount === 1 ? '' : 's'} on ${stats.projectName ?? 'project'}`
            : 'Verify tab sends an admin test report without copying the key',
          to: '/reports',
          secondaryTo: '/dashboard',
          secondaryLabel: 'Dashboard',
          anchor: 'onboarding:verify',
        }}
      />
      ) : null}

      {setupComplete && (
        <>
          <Card className="p-4 border-ok/30 bg-ok/5">
            <div className="flex items-start gap-3">
              <div
                aria-hidden="true"
                className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ok/15 text-ok text-xs font-bold"
              >
                ✓
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-fg">
                  Pipeline live &middot; {project?.complete ?? 0} of {project?.total ?? 8} steps
                </h3>
                <p className="text-xs text-fg-muted mt-0.5">
                  Required steps done — reports flow in and the loop runs automatically.
                  {(project?.complete ?? 0) < (project?.total ?? 8) && (
                    <span> Optional integrations (fix agents, routing) are on the Steps tab.</span>
                  )}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Btn size="sm" variant="primary" onClick={() => navigate('/integrations')}>
                    Unlock auto-fix →
                  </Btn>
                  <Btn size="sm" variant="ghost" onClick={() => navigate('/dashboard')}>Open dashboard</Btn>
                </div>
              </div>
            </div>
          </Card>

          {/* Migration Hub progress — only renders when the user has rows;
              the card returns null otherwise so the post-setup hero stays
              focused. Account-scoped here (no project_id) because a user
              browsing the docs without an active project is the common
              path for upgrade rails like @mushi-mushi/* 0.x → 1.0. */}
          <MigrationsInProgressCard />
        </>
      )}

      {project && (
        <ProjectNarrativeStrip
          projectName={project.project_name}
          sdkInstalled={sdkInstalled}
          hasReports={hasReports}
          hasFix={hasFix}
          hasMerged={hasMerged}
        />
      )}

      {/* Explainer diagram: shows first-run users the four stages of the
          loop they're about to enter, with outcome copy instead of empty
          zero-counts. Wrapped in a section so the FirstRunTour's "plan"
          stop can anchor on the Plan node via `data-tour-id="pdca-flow"`. */}
      {!ux.hideOverviewChrome ? (
      <section aria-label="What the loop does" className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-fg">How Mushi closes the loop</h3>
          <span className="text-2xs text-fg-faint hidden sm:block">
            Plan → Do → Check → Act (loops back)
          </span>
        </div>
        <PdcaFlow variant="onboarding" ariaLabel="Plan-Do-Check-Act loop explainer" />
        <section
          aria-label="Meet Ask Mushi"
          className="flex flex-col gap-3 rounded-md border border-brand/25 bg-brand/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 items-start gap-3">
            <span
              aria-hidden
              className="relative mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center text-brand"
            >
              <IconChat className="h-3.5 w-3.5" />
              <span
                aria-hidden
                className="pointer-events-none absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-brand"
              />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-fg">Meet Ask Mushi</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
                Your in-console AI guide — ask how any page works, run{' '}
                <span className="font-mono text-fg-secondary">/explain</span> on the current route,
                or press{' '}
                <kbd className="rounded-sm border border-edge/80 bg-surface-overlay px-1 py-px font-mono text-2xs text-fg-secondary">
                  Cmd/Ctrl+J
                </kbd>
                . Look for the chat icon in the header toolbar after you open the dashboard.
              </p>
            </div>
          </div>
          <Btn
            size="sm"
            variant="primary"
            className="shrink-0 self-start sm:self-center"
            onClick={() => {
              navigate('/dashboard')
              window.setTimeout(() => askMushiPanel.open(), 400)
            }}
          >
            Try Ask Mushi
          </Btn>
        </section>
      </section>
      ) : null}
        </>
      )}

      {effectiveTab === 'steps' && (
        <>
      {project && (
        <SetupChecklist
          project={project}
          mode="wizard"
          adminEndpointHost={setup.data?.admin_endpoint_host ?? null}
        />
      )}

      {!setup.hasAnyProject && (
        <Card className="p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-fg">Create your first project</h3>
            <ContainedBlock tone="muted" className="mt-2">
              <p className="text-xs text-fg-muted">
                A project groups all bug reports from one application. Name it after your app.
              </p>
            </ContainedBlock>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                label="Project name"
                helpId="onboarding.project_name"
                placeholder="e.g. My SaaS App"
                value={projectName}
                onChange={(e) => {
                  setProjectName(e.target.value)
                  if (createError) clearCreateError()
                }}
                onKeyDown={(e) => e.key === 'Enter' && createProject()}
                autoFocus
                aria-invalid={createError ? true : undefined}
                aria-describedby={createError ? 'onboarding-create-error' : undefined}
              />
            </div>
            <Btn
              onClick={createProject}
              loading={creating}
              disabled={creating || !projectName.trim()}
              title={!projectName.trim() ? 'Enter a project name to continue' : undefined}
            >
              Create
            </Btn>
          </div>
          {createError && (
            <div id="onboarding-create-error">
              <ErrorAlert
                title={createErrorTitle}
                message={createError.message}
                code={createError.code}
                actions={createErrorActions}
              />
            </div>
          )}
        </Card>
      )}
        </>
      )}

      {effectiveTab === 'verify' && (
        <>
      {project && <TimeToFirstDiagnosisCard hasApiKey={stats.hasApiKey} />}

      {project && nextRequired?.id === 'api_key_generated' && (
        <Card className="p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-fg">Generate an API key</h3>
            <ContainedBlock tone="warn" className="mt-2">
              <p className="text-xs text-fg-muted">
                Your SDK uses this key to authenticate report submissions. The full key is shown <strong>only once</strong> — copy it before navigating away.
              </p>
            </ContainedBlock>
          </div>
          {!apiKey ? (
            <>
              <div className="inline-flex items-center gap-1">
                <Btn onClick={generateKey} loading={generatingKey} disabled={generatingKey}>
                  Generate API Key
                </Btn>
                <ConfigHelp helpId="onboarding.first_key_label" />
              </div>
              {error && <p className="text-xs text-danger">{error}</p>}
            </>
          ) : (
            <KeyReveal apiKey={apiKey} copied={keyCopied} onCopy={() => copyToClipboard(apiKey.key, setKeyCopied)} />
          )}
        </Card>
      )}

      {project && !setup.isStepIncomplete('api_key_generated') && setup.isStepIncomplete('first_report_received') && (
        <Card className="p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-fg">Test your connection</h3>
            <ContainedBlock tone="muted" className="mt-2">
              <p className="text-xs text-fg-muted">
                Verify that the backend is reachable and the pipeline can accept reports.
              </p>
            </ContainedBlock>
          </div>
          <ConnectionStatus />
          <div className="border-t border-edge-subtle pt-3">
            <ContainedBlock tone="muted" className="mb-2">
              <p className="text-xs text-fg-muted">Submit a test report to verify the full pipeline:</p>
            </ContainedBlock>
            <div className="flex items-center gap-3 flex-wrap">
              <Btn
                onClick={submitTestReport}
                loading={testStatus === 'running'}
                disabled={testStatus === 'running'}
                variant={testStatus === 'pass' ? 'ghost' : 'primary'}
              >
                {testStatus === 'pass' ? 'Send another' : 'Submit test report'}
              </Btn>
              {testStatus !== 'idle' && (
                <ResultChip
                  tone={testTone(testStatus)}
                  at={testStatus === 'pass' || testStatus === 'fail' ? testRanAt : null}
                >
                  {testStatus === 'running' && 'Submitting test report…'}
                  {testStatus === 'pass' && 'Pipeline is working — open /reports to see the row'}
                  {testStatus === 'fail' && (error || 'Submission failed')}
                </ResultChip>
              )}
            </div>
          </div>
        </Card>
      )}

      {project && setup.isStepIncomplete('api_key_generated') && (
        <Card className="p-4 border border-edge-subtle">
          <p className="text-xs text-fg-muted">Generate an API key on the Steps tab first — verification needs an active ingest key.</p>
          <Btn size="sm" variant="ghost" className="mt-2" onClick={() => setActiveTab('steps')}>Go to Steps</Btn>
        </Card>
      )}

      {/* Pipeline already verified — both steps complete but no in-session test ran yet.
          Prevents the tab from looking completely empty for returning users. */}
      {project && !setup.isStepIncomplete('api_key_generated') && !setup.isStepIncomplete('first_report_received') && testStatus !== 'pass' && (
        <Card className="p-5 space-y-4 border border-ok/20 bg-ok/5">
          <div className="flex items-start gap-3">
            <span className="text-ok text-base mt-0.5" aria-hidden="true">✓</span>
            <div>
              <h3 className="text-sm font-semibold text-fg">Pipeline verified</h3>
              <p className="text-xs text-fg-muted mt-0.5">
                Your ingest key is active and at least one report has arrived. The pipeline is working.
              </p>
            </div>
          </div>
          <ConnectionStatus />
          <div className="border-t border-edge-subtle pt-3 flex items-center gap-3 flex-wrap">
            <Btn
              size="sm"
              onClick={submitTestReport}
              loading={testStatus === 'running'}
              disabled={testStatus === 'running'}
            >
              {testStatus === 'running' ? 'Submitting…' : 'Send another test'}
            </Btn>
            {testStatus === 'fail' && (
              <ResultChip tone="error" at={testRanAt}>{error || 'Submission failed'}</ResultChip>
            )}
            <Link to="/reports" className="text-xs text-fg-muted underline hover:no-underline">
              View your reports →
            </Link>
          </div>
        </Card>
      )}

      {/* "Show me one loop running" — demo the full 5-stage evolution loop.
          Available once the pipeline is verified (test report passes). */}
      {project && testStatus === 'pass' && (
        <Card className="p-5 space-y-3 border border-ok/30 bg-ok/4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-fg">See the evolution loop close</span>
              <span className="inline-flex items-center gap-1 text-2xs font-medium text-ok">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ok" />
                pipeline live
              </span>
            </div>
            <p className="text-xs text-fg-muted mt-1">
              Your test report is in the pipeline. Follow it through all 5 stages
              — capture → classify → fix → verify → remember — to see exactly what
              happens to a real user's bug.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/reports?filter=test`}>
              <Btn size="sm" variant="primary">
                Watch the loop →
              </Btn>
            </Link>
            <Link to="/judge" className="text-xs text-fg-muted underline hover:no-underline">
              See judge scores
            </Link>
            <Link to="/lessons" className="text-xs text-fg-muted underline hover:no-underline">
              See lesson library
            </Link>
          </div>
          <div className="grid grid-cols-5 gap-1 pt-1">
            {[
              { stage: 'Capture', desc: 'screenshot + logs', done: true },
              { stage: 'Classify', desc: 'AI triage', done: testStatus === 'pass' },
              { stage: 'Fix', desc: 'draft PR', done: false },
              { stage: 'Verify', desc: 'QA stories', done: false },
              { stage: 'Remember', desc: 'lesson library', done: false },
            ].map(({ stage, desc, done }) => (
              <div
                key={stage}
                className={`px-2 py-1.5 rounded-sm text-center text-2xs space-y-0.5 ${done ? 'bg-ok/10 border border-ok/20' : 'bg-surface-raised border border-edge-subtle'}`}
              >
                <div className={`font-semibold ${done ? 'text-ok' : 'text-fg-muted'}`}>{stage}</div>
                <div className="text-fg-faint">{desc}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
        </>
      )}

      {effectiveTab === 'sdk' && (
        <>
      {project && !setup.isStepIncomplete('api_key_generated') ? (
        <div className="space-y-3">
          <SdkInstallCard projectId={project.project_id} projectSlug={project.project_slug} apiKey={apiKey?.key} showConnectionStatus />
          <div className="flex gap-2">
            <Btn variant="ghost" onClick={() => navigate('/dashboard')}>Go to Dashboard</Btn>
          </div>
        </div>
      ) : (
        <Card className="p-4 border border-info/30 bg-info/5">
          <p className="text-xs text-fg-muted">Mint an API key on Verify before copying the install snippet.</p>
          <Btn size="sm" variant="ghost" className="mt-2" onClick={() => setActiveTab('verify')}>Go to Verify</Btn>
        </Card>
      )}
        </>
      )}

      {!ux.hideFooterLinks ? (
      <p className="text-center flex items-center justify-center gap-3">
        <button
          onClick={() => navigate('/dashboard')}
          className="text-2xs text-fg-faint hover:text-fg-muted transition-colors"
        >
          Skip setup — go to dashboard
        </button>
        <span className="text-2xs text-fg-faint" aria-hidden="true">·</span>
        <button
          onClick={() => {
            restartFirstRunTour()
            navigate('/dashboard')
          }}
          className="text-2xs text-fg-faint hover:text-fg-muted transition-colors"
        >
          Restart tour
        </button>
      </p>
      ) : null}
    </div>
  )
}

/** Format a millisecond interval as a short human string ("1m 48s", "42s"). */
function formatDiagnosisDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000))
  if (totalSec < 60) return `${totalSec}s`
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

interface TimeToFirstDiagnosis {
  keyMintedAt: string | null
  firstDiagnosisAt: string | null
  ms: number | null
}

/**
 * Surfaces the phase-1 north-star: time from minting an ingest key to the
 * first plain-English diagnosis. Target is "under 2 minutes" for a fresh
 * install — the one number to protect before spending on reach.
 */
function TimeToFirstDiagnosisCard({ hasApiKey }: { hasApiKey: boolean }) {
  const { data, loading } = usePageData<TimeToFirstDiagnosis>(
    '/v1/admin/onboarding/time-to-first-diagnosis',
  )
  if (!hasApiKey || loading) return null

  const ms = data?.ms ?? null
  const TARGET_MS = 2 * 60 * 1000

  if (ms != null) {
    const underTarget = ms <= TARGET_MS
    return (
      <Card className={`p-5 ${underTarget ? 'border border-ok/30 bg-ok/5' : 'border border-info/25 bg-info/5'}`}>
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-3xs font-medium uppercase tracking-wider text-fg-faint">Time to first diagnosis</p>
            <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${underTarget ? 'text-ok' : 'text-fg'}`}>
              {formatDiagnosisDuration(ms)}
            </p>
          </div>
          <span className={`text-2xs font-medium ${underTarget ? 'text-ok' : 'text-info'}`}>
            {underTarget ? 'Under the 2-minute target ✓' : 'Target: under 2 minutes'}
          </span>
        </div>
        <p className="mt-2 text-xs text-fg-muted leading-relaxed">
          From minting your ingest key to your first plain-English diagnosis. This is the one number worth
          protecting — the faster a fresh install gets an answer, the more the loop earns its place.
        </p>
      </Card>
    )
  }

  return (
    <Card className="p-5 border border-edge-subtle">
      <p className="text-3xs font-medium uppercase tracking-wider text-fg-faint">Time to first diagnosis</p>
      <p className="mt-0.5 text-sm text-fg-secondary">Waiting on your first classified report.</p>
      <p className="mt-1 text-xs text-fg-muted leading-relaxed">
        Send a test report below (or trigger one from your app). Target: a plain-English diagnosis in under
        2 minutes from key mint.
      </p>
    </Card>
  )
}

function KeyReveal({ apiKey, copied, onCopy }: { apiKey: ApiKey; copied: boolean; onCopy: () => void }) {
  return (
    <div className="space-y-3">
      <div className="bg-surface-raised border border-ok/30 rounded-sm px-3 py-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-2xs text-fg-muted uppercase tracking-wider font-medium">Your API Key</span>
          <CopyButton
            onCopy={onCopy}
            copied={copied}
            label="Copy API key to clipboard"
            copiedLabel="API key copied"
          />
        </div>
        <code className="text-sm font-mono text-ok wrap-anywhere select-all">{apiKey.key}</code>
      </div>
      <HelpBanner tone="warn" className="rounded-sm">
        <p className="text-2xs text-warn">
          Save this key securely. It will not be shown again after you leave this page.
        </p>
      </HelpBanner>
    </div>
  )
}
