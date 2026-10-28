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

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { testReportHref, useSendTestReport } from '../lib/useSendTestReport'
import { usePageData } from '../lib/usePageData'
import type { TimeToFirstDiagnosis } from '../lib/setupRail'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { Card, Btn, Input, ErrorAlert, ResultChip, type ResultChipTone, CopyButton, SegmentedControl, HelpBanner, Loading } from '../components/ui'
import { SetupProgressRail } from '../components/onboarding/SetupProgressRail'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { OnboardingSetupReadout } from '../components/onboarding/OnboardingSetupReadout'
import { SetupGapsSection } from '../components/onboarding/SetupGapsSection'
import { EMPTY_ONBOARDING_STATS, type OnboardingStats, type OnboardingTabId } from '../components/onboarding/types'
import { usePublishPageContext } from '../lib/pageContext'
import { useRealtimeReload } from '../lib/realtime'
import { ContainedBlock } from '../components/report-detail/ReportSurface'
import { OnboardingSkeleton } from '../components/skeletons/OnboardingSkeleton'
import { ConnectionStatus } from '../components/ConnectionStatus'
import { SetupChecklist } from '../components/SetupChecklist'
import { PdcaFlow } from '../components/pdca-flow/PdcaFlow'
import { SdkInstallCard } from '../components/SdkInstallCard'
import { useSetupStatus } from '../lib/useSetupStatus'
import { withSetupRequiredCounts } from '../lib/setupProgress'
import { isActivationCockpitV2Enabled, useActivationStatus } from '../lib/useActivationStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useToast } from '../lib/toast'
import { PLAN_APP_LIMIT_TITLE, PLANS_HREF, useCreateProject } from '../lib/useCreateProject'
import { usePageCopy } from '../lib/copy'
import { useOnboardingUx, resolveQuickOnboardingTab } from '../lib/onboardingModeUx'
import { restartFirstRunTour } from '../components/FirstRunTour'
import { ConfigHelp } from '../components/ConfigHelp'
import { FirstDiagnosisScreen } from '../components/onboarding/FirstDiagnosisScreen'
import { MigrationsInProgressCard } from '../components/migrations/MigrationsInProgressCard'
import {
  ProjectCreatedSuccessPanel,
  type CreatedProjectInfo,
} from '../components/ProjectCreatedSuccessPanel'
import { CliSetupGuide } from '../components/CliSetupGuide'
import { isCliSetupMode, shouldFocusCreateForm, shouldShowOnboardingCreateForm } from '../lib/onboardingCliSetup'
import { clearStoredInstanceConfig } from '../lib/env'
import { IconChat, IconBolt } from '../components/icons'
import { askMushiPanel } from '../lib/useAskMushiPanel'
import { PageLoadError } from '../components/PageLoadError'

const SetupCopilotPage = lazy(() => import('./SetupCopilotPage').then((m) => ({ default: m.SetupCopilotPage })))

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
    label: 'More to connect',
    description: 'Optional tools to connect once the app is set up.',
  },
  {
    id: 'verify',
    label: 'Test it',
    description: 'API key mint, connection probe, and admin test-report submission.',
  },
  {
    id: 'sdk',
    label: 'Install',
    description: 'Install snippet and init copy — bookmark this tab after setup completes.',
  },
  {
    id: 'diagnose',
    label: 'Fix a problem',
    description: 'Something not working? Check the SDK heartbeat, version and fix dispatch for one project, with copy-paste commands.',
  },
]

function isOnboardingTab(value: string | null): value is OnboardingTabId {
  return ONBOARDING_TABS.some((t) => t.id === value)
}

/** `?tab=copilot` was the Diagnose tab's id until 2026-10-27; old links still open it. */
function resolveTabParam(value: string | null): string | null {
  return value === 'copilot' ? 'diagnose' : value
}

export function OnboardingPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const sendTestReport = useSendTestReport()
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
        resolved: activation.resolved,
        activeProject: activation.activeProject,
        selectors: activation.selectors,
        isStepIncomplete: activation.isStepIncomplete,
        getStep: activation.getStep,
      }
    : legacySetup
  const copy = usePageCopy('/onboarding')
  const ux = useOnboardingUx()
  const [searchParams, setSearchParams] = useSearchParams()

  const tabParam = resolveTabParam(searchParams.get('tab'))
  const setupCliMode = isCliSetupMode(searchParams)
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
  const statsLoading = activationEnabled ? activation.loading : legacyStatsLoading
  const statsError = activationEnabled ? activation.error : legacyStatsError
  const statsFetchedAt = activationEnabled ? activation.lastFetchedAt : legacyStatsFetchedAt
  const statsValidating = activationEnabled ? activation.isValidating : legacyStatsValidating
  const reloadStats = activationEnabled ? activation.reload : legacyReloadStats
  // Required counts and "ready" follow GET /v1/admin/setup (see withSetupRequiredCounts).
  const stats = withSetupRequiredCounts(statsData ?? EMPTY_ONBOARDING_STATS, legacySetup.activeProject)

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
  const [testReportId, setTestReportId] = useState<string | null>(null)
  // Local "operational" error used by the API key / test-report cards that
  // don't have a hook of their own. Project creation has its own structured
  // error channel via `useCreateProject` below so its surface is
  // intentionally separate (the recovery affordances differ per code).
  const [error, setError] = useState('')
  const [createdProject, setCreatedProject] = useState<CreatedProjectInfo | null>(null)
  const createFormRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!setupCliMode) return
    if (tabParam !== 'steps') setActiveTab('steps')
  }, [setupCliMode, tabParam, setActiveTab])

  useEffect(() => {
    if (!shouldFocusCreateForm(searchParams)) return
    requestAnimationFrame(() => createFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }, [setupCliMode, searchParams, effectiveTab])

  // Must be called unconditionally on every render — the skeleton/error
  // early-returns below would otherwise produce a different hook count
  // between first (loading) and subsequent (loaded) renders.
  const {
    create: createProjectRaw,
    creating,
    error: createError,
    clearError: clearCreateError,
  } = useCreateProject({
    onCreated: (project) => {
      setProjectName('')
      setCreatedProject(project)
      setup.reload()
      if (setupCliMode) {
        setActiveTab('steps')
        return
      }
      if (ux.hideOverviewTab) setActiveTab('verify')
    },
  })

  // The steps come from /v1/admin/setup, like the rail, the sidebar and Home.
  // The activation payload marks the SDK step optional, so this page said
  // "You're set up, 3 of 3" under a rail saying 3 of 4 (first-time user
  // test, 2026-10-28). Step checks read the same source, and the page waits
  // for it, so the old count never flashes while it loads.
  const project = legacySetup.activeProject

  // What's the next required step? We use it to highlight the right card.
  const nextRequired = useMemo(
    () => project?.steps.find(s => s.required && !s.complete) ?? null,
    [project],
  )

  // ── First-run path (docs/plan-gtm.md, Workstream B §2b) ──────────────────
  // Two screens instead of the four-tab checklist while the project has no
  // report yet: S1 names the project (the create endpoint mints the key),
  // S2 sends a test report and renders the diagnosis inline. `?view=all`
  // reaches the full checklist so nothing existing is unreachable. Once S2
  // is on screen we hold it for the session — otherwise the setup refetch
  // that follows the first report would swap the diagnosis out from under
  // the user the moment it landed.
  const viewParam = searchParams.get('view')
  // Decided on a resolved setup answer only: while the fetch is pending or
  // failed the page used to read "no project" and latch the first-run
  // screen for the whole session, so a project with dozens of reports kept
  // showing "Step 2 of 2 · See your first diagnosis" (audit 2026-10-20, B5).
  const firstRunEligible =
    !setupCliMode &&
    setup.resolved &&
    (!setup.hasAnyProject || (project != null && legacySetup.isStepIncomplete('first_report_received')))
  const [firstRunHeld, setFirstRunHeld] = useState(false)
  useEffect(() => {
    if (firstRunEligible && viewParam !== 'all') setFirstRunHeld(true)
  }, [firstRunEligible, viewParam])
  const firstRun = viewParam !== 'all' && (firstRunEligible || firstRunHeld)
  const setView = useCallback(
    (view: 'all' | null) => {
      const next = new URLSearchParams(searchParams)
      if (view) next.set('view', view)
      else next.delete('view')
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
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
      case 'PLAN_APP_LIMIT':
        return [
          { label: 'See plans', onClick: () => navigate(PLANS_HREF) },
          { label: 'Dismiss', onClick: clearCreateError },
        ]
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
      case 'PLAN_APP_LIMIT':
        return PLAN_APP_LIMIT_TITLE
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
      toast.success('API key generated', 'Copy it now \u2014 it will not be shown again. Then submit a test report below to verify everything works.')
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
    // `test_report_sent` is emitted server-side by the test-report route
    // (dedup per report), so the console does not double-count it here.
    const res = await sendTestReport(project.project_id)
    setTestRanAt(new Date().toISOString())
    setTestStatus(res.ok ? 'pass' : 'fail')
    if (res.ok) {
      setTestReportId(res.reportId)
      setup.reload()
      reloadStats()
      // In Quickstart linear flow: pipeline verified → advance to Install SDK.
      if (ux.hideOverviewTab) setActiveTab('sdk')
    } else {
      setError(res.message)
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
    navigator.clipboard.writeText(text).then(
      () => {
        setter(true)
        setTimeout(() => setter(false), 2000)
      },
      // A blocked clipboard used to fail silently (QA bug 260).
      () => toast.error('Clipboard blocked', 'Select the key and copy it by hand. It is shown above until you leave.'),
    )
  }

  // Render a "Setup complete" hero (instead of bouncing) when there's nothing
  // left for this project to do. Keeps the page useful as a permanent SDK
  // reference for fully onboarded users.
  const setupComplete = Boolean(project?.done && project.complete >= project.total)

  usePublishPageContext({
    route: '/onboarding',
    title: `${activeTabMeta.label} · Set up`,
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
      // No count on the extras tab: the rail above is the one place that
      // says how far setup is.
      if (t.id === 'verify') {
        count = stats.hasApiKey && stats.reportCount === 0 ? 1 : undefined
      }
      return {
        id: t.id,
        label: copy?.tabLabels?.[t.id] ?? t.label,
        count,
      }
    })
  }, [ux.hideOverviewTab, copy?.tabLabels, stats])

  if (setup.loading || legacySetup.loading || (statsLoading && !statsData)) return <OnboardingSkeleton />
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
  if (statsError) return <PageLoadError error={statsError} resource="setup stats" onRetry={reloadAll} />

  // Shared by the Steps tab and first-run S1 — one form, two homes.
  const createProjectForm = (
    <Card className="p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-fg">
          {setupCliMode && setup.hasAnyProject
            ? 'Create a new project'
            : setupCliMode
              ? 'Create your project'
              : 'Create your first project'}
        </h3>
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
            // Same guard as the Create button: a second Enter while the
            // first POST is in flight created a duplicate project (QA bug 137).
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !creating && projectName.trim()) void createProject()
            }}
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
  )

  // First-run wizard: S1 (name the project) → S2 (see your first diagnosis).
  // The key is auto-minted by the create endpoint, so there is no key step.
  const firstRunWizard = (
    <div className="space-y-4" data-testid="onboarding-first-run">
      {!project ? (
        <div className="space-y-4">
          <div>
            <p className="text-3xs font-medium uppercase tracking-wider text-fg-faint">Step 1 of 2</p>
            <h2 className="mt-0.5 text-base font-semibold text-fg">Name your project</h2>
            <p className="mt-1 text-xs text-fg-muted">
              That is the only input we need. Your report key is minted for you.
            </p>
          </div>
          {createdProject ? (
            <Card className="p-4 border-ok/30 bg-ok/5">
              <p className="text-sm font-medium text-fg">
                <span className="font-mono">{createdProject.name}</span> is ready
              </p>
              <p className="mt-0.5 text-xs text-fg-muted">Preparing your first diagnosis…</p>
            </Card>
          ) : (
            <div ref={createFormRef}>{createProjectForm}</div>
          )}
        </div>
      ) : (
        <FirstDiagnosisScreen
          projectId={project.project_id}
          projectName={project.project_name}
          projectSlug={project.project_slug}
          apiKey={createdProject?.apiKey ?? apiKey?.key ?? null}
          onDiagnosed={reloadAll}
        />
      )}
      <p className="text-2xs text-fg-faint">
        Prefer the full checklist (keys, integrations, every optional step)?{' '}
        <Btn
          variant="ghost"
          size="sm"
          onClick={() => setView('all')}
          className="inline border-0 bg-transparent shadow-none px-0 py-0 text-2xs text-accent-foreground hover:text-accent underline underline-offset-2"
        >
          Show all steps
        </Btn>
      </p>
    </div>
  )

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-onboarding">
      <PageHeaderBar
        title={copy?.title ?? 'Set up'}
        icon={<IconBolt />}
        projectScope={stats.projectName ?? undefined}
        withPageHero={!ux.hideOverviewChrome}
        description={copy?.description ?? 'Create a project, make a key, install the SDK, and watch your first bug get a plain-English read — target: under 2 minutes.'}
        helpTitle={copy?.help?.title ?? 'About this wizard'}
        helpWhatIsIt={copy?.help?.whatIsIt ?? 'A guided checklist that creates your first project, generates an API key, sends a test report, and shows the SDK snippet. Progress saves across devices.'}
        helpUseCases={copy?.help?.useCases ?? [
          'Create the project that will receive bug reports from your app',
          'Generate and copy the API key that authenticates SDK requests',
          'Confirm reports arrive before shipping any code',
        ]}
        helpHowToUse={copy?.help?.howToUse ?? 'Complete the required steps in order. The API key is only shown once — copy it before continuing. You can rerun the test report any time from Settings.'}
      />

      {firstRun ? firstRunWizard : (
      <>
      {firstRunEligible && (
        <p className="text-2xs text-fg-faint">
          <Btn
            variant="ghost"
            size="sm"
            onClick={() => setView(null)}
            className="inline border-0 bg-transparent shadow-none px-0 py-0 text-2xs text-accent-foreground hover:text-accent underline underline-offset-2"
          >
            ← Back to the quick start
          </Btn>
        </p>
      )}

      {/* The four steps to a wired-up app, with the next one's button (Set up page intent). */}
      <PagePosture
        slots={[
          {
            id: 'setup-rail',
            priority: POSTURE_PRIORITY.status,
            show: stats.hasAnyProject,
            children: (
              <SetupProgressRail
                project={project}
                apiKey={apiKey?.key ?? null}
                onTab={setActiveTab}
                onMintKey={() => void generateKey()}
                minting={generatingKey}
                onSendTest={() => void submitTestReport()}
                testing={testStatus === 'running'}
                compact={effectiveTab !== 'overview'}
              />
            ),
          },
        ]}
      />

      {/* Configuration that is missing or broken, before a button fails (console ops plan P1). */}
      {stats.hasAnyProject ? <SetupGapsSection projectId={activeProjectId ?? stats.projectId ?? null} /> : null}

      {/* CLI-waiting callout when wizard was opened from the terminal */}
      {setupCliMode && !stats.setupDone && (
        <Card  className="flex items-start gap-3 px-4 py-3">
          <span className="mt-0.5 text-brand text-sm" aria-hidden="true">⏳</span>
          <div>
            <p className="text-sm font-medium text-fg">Your terminal is waiting</p>
            <p className="mt-0.5 text-xs text-fg-muted">
              Complete the steps below, then switch back to your terminal — setup
              continues automatically once you approve.
            </p>
          </div>
        </Card>
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

      {effectiveTab === 'overview' && (
        <>
      {!stats.hasAnyProject ? (
        <CliSetupGuide projectId={stats.projectId} className="mb-4" />
      ) : null}

      {/* An "all steps done" card used to sit here, between the rail ("Your
          app is wired up") and the steps strip below: the third progress
          block on the page, under setup gaps saying no fix would start
          (2026-10-28). The rail and the gaps say it once. */}
      {setupComplete && <MigrationsInProgressCard />}

      {/* The "How a bug gets fixed … You are here" stage strip sat here: a
          fourth progress tracker under the rail, setup gaps and the tabs
          (integrator's new-user walk, 2026-10-28). The rail says it once. */}

      {/* Explainer diagram: shows first-run users the four stages of the
          loop they're about to enter, with outcome copy instead of empty
          zero-counts. Wrapped in a section so the FirstRunTour's "plan"
          stop can anchor on the Plan node via `data-tour-id="pdca-flow"`. */}
      {!ux.hideOverviewChrome ? (
      <section aria-label="What the loop does" className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-fg">What happens after a report</h3>
          <span className="text-2xs text-fg-faint hidden sm:block">
            Plan → Do → Check → Act (loops back)
          </span>
        </div>
        <PdcaFlow variant="onboarding" ariaLabel="Plan-Do-Check-Act loop explainer" />

        {/* Setup funnel panel — 7-day operator view of onboarding event counts */}
        {stats.funnelCounts && Object.keys(stats.funnelCounts).length > 0 && (
          <details className="rounded-lg border border-edge-subtle bg-surface-raised">
            <summary className="cursor-pointer list-none px-4 py-3 text-xs font-semibold text-fg-muted hover:text-fg">
              Setup funnel (last 7 days) ▸
            </summary>
            <div className="border-t border-edge-subtle px-4 py-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                {([
                  { key: 'cli_auth_started',        label: 'CLI auth started' },
                  { key: 'cli_auth_approved',        label: 'Browser approved' },
                  { key: 'cli_auth_token_claimed',   label: 'Token claimed' },
                  { key: 'cli_project_created',      label: 'Project created' },
                  { key: 'cli_key_minted',           label: 'Key minted' },
                  { key: 'wizard_env_written',       label: 'Env written' },
                  { key: 'sdk_first_heartbeat',      label: 'SDK heartbeat' },
                  { key: 'mcp_setup_done',           label: 'MCP setup done' },
                  { key: 'mcp_first_tool_call',      label: 'MCP first tool call' },
                  { key: 'cli_auth_denied',          label: 'Auth denied' },
                  { key: 'cli_auth_expired',         label: 'Auth expired' },
                ] as const).map(({ key, label }) => {
                  const count = (stats.funnelCounts as Record<string, number>)[key] ?? 0
                  return (
                    <div key={key} className="flex items-baseline justify-between py-0.5">
                      <span className="text-2xs text-fg-muted">{label}</span>
                      <span className={`font-mono text-xs font-medium ${count > 0 ? 'text-fg' : 'text-fg-faint'}`}>
                        {count}
                      </span>
                    </div>
                  )
                })}
              </div>
              <p className="mt-2 text-2xs text-fg-faint">
                Counts distinct users per event. Key conversion: <strong>Key minted → SDK heartbeat → MCP setup done → MCP first tool call</strong>.
                Powered by <code className="font-mono">setup_funnel_events</code>.
              </p>
            </div>
          </details>
        )}
        <section
          aria-label="Ask Mushi"
          // mushi-mushi-allowlist: hand-rolled surface (cn/template; not Card tile)
          className="flex flex-col gap-3 rounded-md border border-brand/40 bg-surface-raised px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
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
              <h3 className="text-sm font-semibold text-fg">Ask about this page</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
                Press{' '}
                <kbd className="rounded-sm border border-edge/80 bg-surface-overlay px-1 py-px font-mono text-2xs text-fg-secondary">
                  Cmd/Ctrl+J
                </kbd>
                {' '}or run{' '}
                <span className="font-mono text-fg-secondary">/explain</span>
                {' '}from the header chat — Ask Mushi answers from the current route and your project docs.
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
            Open Ask Mushi
          </Btn>
        </section>
      </section>
      ) : null}
        </>
      )}

      {effectiveTab === 'steps' && (
        <>
      {setupCliMode && (
        <HelpBanner tone="info" title="Setting up from the CLI?" data-testid="onboarding-cli-setup-banner">
          <p className="text-xs text-fg-muted">
            {setup.hasAnyProject
              ? 'Create a new project below, then copy the Project ID and CLI commands from the success panel.'
              : 'Name your app below, then copy the Project ID and CLI commands from the success panel.'}{' '}
            Return to your terminal to paste credentials into <span className="font-mono">npx mushi-mushi</span>.
          </p>
        </HelpBanner>
      )}

      {createdProject && (
        <ProjectCreatedSuccessPanel
          project={createdProject}
          fromCliSetup={setupCliMode}
          onDismiss={() => setCreatedProject(null)}
        />
      )}

      {project && (
        <SetupChecklist
          project={project}
          mode="wizard"
          extrasOnly
          adminEndpointHost={setup.data?.admin_endpoint_host ?? null}
        />
      )}

      {shouldShowOnboardingCreateForm(setupCliMode, setup.hasAnyProject, Boolean(createdProject)) && (
        <div id="onboarding-create-form" ref={createFormRef}>
          {createProjectForm}
        </div>
      )}
        </>
      )}

      {effectiveTab === 'verify' && (
        <>
      {project && <TimeToFirstDiagnosisCard hasApiKey={stats.hasApiKey} onOpenSdk={() => setActiveTab('sdk')} />}

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

      {project && !legacySetup.isStepIncomplete('api_key_generated') && legacySetup.isStepIncomplete('first_report_received') && (
        <Card className="p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-fg">Test your connection</h3>
            <ContainedBlock tone="muted" className="mt-2">
              <p className="text-xs text-fg-muted">
                Check that Mushi is reachable, then send a test bug and watch it get a plain-English read.
              </p>
            </ContainedBlock>
          </div>
          <ConnectionStatus />
          <div className="border-t border-edge-subtle pt-3">
            <ContainedBlock tone="muted" className="mb-2">
              <p className="text-xs text-fg-muted">Send a test bug:</p>
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
                  {testStatus === 'pass' && 'Mushi got it. It is on the Bugs page.'}
                  {testStatus === 'fail' && (error || 'Submission failed')}
                </ResultChip>
              )}
            </div>
          </div>
        </Card>
      )}

      {project && legacySetup.isStepIncomplete('api_key_generated') && (
        <Card className="p-4 border border-edge-subtle">
          <p className="text-xs text-fg-muted">Make a key first, with the second step at the top of this page.</p>
        </Card>
      )}

      {/* A test bug already arrived: the card above says so, this one only
          offers another test, so the tab is never empty for a returning user. */}
      {project && !legacySetup.isStepIncomplete('api_key_generated') && !legacySetup.isStepIncomplete('first_report_received') && testStatus !== 'pass' && (
        <Card className="p-5 space-y-4 border border-ok/20 bg-ok/5">
          <h3 className="text-sm font-semibold text-fg">Send another test bug</h3>
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

      {/* Follow the test bug from report to fix once it has gone through.
          Available once the pipeline is verified (test report passes). */}
      {project && testStatus === 'pass' && (
        <Card className="p-5 space-y-3 border border-ok/30 bg-ok/4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-fg">Follow your test bug to a fix</span>
              <span className="inline-flex items-center gap-1 text-2xs font-medium text-ok">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ok" />
                working
              </span>
            </div>
            <p className="text-xs text-fg-muted mt-1">
              Mushi is working on your test bug. Follow it from report to diagnosis
              to fix to see what happens to a real user's bug.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* /reports reads no `filter` param, so ?filter=test showed every
                report (QA bug 263). Open the test report itself. */}
            <Btn
              to={testReportId ? testReportHref(testReportId, project.project_id) : `/reports?project=${project.project_id}`}
              size="sm"
              variant="primary"
            >
              Follow the test bug →
            </Btn>
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
              { stage: 'Classify', desc: 'Plain-English read', done: testStatus === 'pass' },
              { stage: 'Fix', desc: 'draft PR', done: false },
              { stage: 'Verify', desc: 'QA stories', done: false },
              { stage: 'Remember', desc: 'lesson library', done: false },
            ].map(({ stage, desc, done }) => (
              <div
                key={stage}
                className={`px-2 py-1.5 rounded-sm text-center text-2xs space-y-0.5 ${done ? 'bg-ok-muted/50 border border-ok/25' : 'bg-surface-raised border border-edge-subtle'}`}
              >
                <div className={`font-semibold ${done ? 'text-ok-foreground' : 'text-fg-muted'}`}>{stage}</div>
                <div className="text-fg-faint">{desc}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
        </>
      )}

      {effectiveTab === 'diagnose' && (
        <Suspense fallback={<Loading text="Loading…" />}>
          <SetupCopilotPage embedded />
        </Suspense>
      )}

      {effectiveTab === 'sdk' && (
        <>
      {!project ? (
        <Card className="p-4 border border-info/30 bg-info/5">
          <p className="text-xs text-fg-muted">Create a project on the Steps tab first — the install snippet needs a project to bind to.</p>
          <Btn size="sm" variant="ghost" className="mt-2" onClick={() => setActiveTab('steps')}>Go to Steps</Btn>
        </Card>
      ) : (
        <div className="space-y-3">
          {/* Snippet is always reachable: SdkInstallCard renders a `mushi_…`
              placeholder when no real key is passed, so a user can see and copy
              the install code immediately. When the key step is still
              incomplete we offer minting inline here instead of bouncing them
              to the Verify tab (the old ping-pong friction). */}
          {legacySetup.isStepIncomplete('api_key_generated') && (
            <Card className="p-4 border border-info/30 bg-info/5 space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-fg">Mint your API key</h3>
                <p className="mt-1 text-xs text-fg-muted">
                  The snippet below shows a <code className="font-mono">mushi_…</code> placeholder so you can
                  see the install code right now. Generate your real key here to drop straight in — no need to
                  leave this tab. It is shown <strong>once</strong>; copy it before navigating away.
                </p>
              </div>
              {!apiKey ? (
                <>
                  <div className="inline-flex items-center gap-1">
                    <Btn onClick={generateKey} loading={generatingKey} disabled={generatingKey}>
                      Generate API key
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
          <SdkInstallCard projectId={project.project_id} projectSlug={project.project_slug} apiKey={apiKey?.key} showConnectionStatus />
          <div className="flex gap-2">
            <Btn variant="ghost" onClick={() => navigate('/dashboard')}>Go to Dashboard</Btn>
          </div>
        </div>
      )}
        </>
      )}
      </>
      )}

      {/* Where reports go: endpoint and host provenance, at the foot. */}
      {!firstRun ? (
        <OnboardingSetupReadout stats={stats} statsFetchedAt={statsFetchedAt} statsValidating={statsValidating} />
      ) : null}

      {!ux.hideFooterLinks ? (
      <p className="text-center flex items-center justify-center gap-3">
        <Btn
          variant="ghost"
          size="sm"
          onClick={() => navigate('/dashboard')}
          className="border-0 bg-transparent shadow-none hover:bg-transparent px-0 py-0 text-2xs text-fg-faint hover:text-fg-muted"
        >
          Skip setup — go to dashboard
        </Btn>
        <span className="text-2xs text-fg-faint" aria-hidden="true">·</span>
        <Btn
          variant="ghost"
          size="sm"
          onClick={() => {
            restartFirstRunTour()
            navigate('/dashboard')
          }}
          className="border-0 bg-transparent shadow-none hover:bg-transparent px-0 py-0 text-2xs text-fg-faint hover:text-fg-muted"
        >
          Restart tour
        </Btn>
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

/**
 * Surfaces the phase-1 north-star: time from making a key to the
 * first plain-English diagnosis. Target is "under 2 minutes" for a fresh
 * install — the one number to protect before spending on reach.
 */
function TimeToFirstDiagnosisCard({ hasApiKey, onOpenSdk }: { hasApiKey: boolean; onOpenSdk: () => void }) {
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
            <p className="text-3xs font-medium uppercase tracking-wider text-fg-faint">First report in your queue</p>
            <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${underTarget ? 'text-ok' : 'text-fg'}`}>
              {formatDiagnosisDuration(ms)}
            </p>
          </div>
          <span className={`text-2xs font-medium ${underTarget ? 'text-ok' : 'text-info'}`}>
            {underTarget ? 'Under the 2-minute target ✓' : 'Target: under 2 minutes'}
          </span>
        </div>
        <p className="mt-2 text-xs text-fg-muted leading-relaxed">
          From making your key to your first plain-English read of a bug from your app.
        </p>
      </Card>
    )
  }

  // Only test or seed reports so far: the pipeline works, and the clock is
  // still waiting on the app (report 9b7624e6). Sending another test report
  // never clears this card, so it points at the SDK instead.
  if (data?.testDiagnosisAt) {
    return (
      <Card className="p-5 border border-ok/25 bg-ok/5" data-testid="ttfd-test-only">
        <p className="text-3xs font-medium uppercase tracking-wider text-fg-faint">First report from your app</p>
        <p className="mt-0.5 text-sm text-fg-secondary">Your test bug got its plain-English read, so Mushi works for this app.</p>
        <p className="mt-1 text-xs text-fg-muted leading-relaxed">
          The 2-minute clock starts with the first report from your app. Install the SDK, then report a bug from your
          app with its bug button.
        </p>
        <Btn size="sm" variant="ghost" className="mt-2" onClick={onOpenSdk}>
          Install the SDK
        </Btn>
      </Card>
    )
  }

  return (
    <Card className="p-5 border border-edge-subtle">
      <p className="text-3xs font-medium uppercase tracking-wider text-fg-faint">First report from your app</p>
      <p className="mt-0.5 text-sm text-fg-secondary">Waiting on the first report from your app.</p>
      <p className="mt-1 text-xs text-fg-muted leading-relaxed">
        Send a test bug below, then report a bug from your app. Target: a plain-English read in under 2 minutes
        from making the key.
      </p>
    </Card>
  )
}

function KeyReveal({ apiKey, copied, onCopy }: { apiKey: ApiKey; copied: boolean; onCopy: () => void }) {
  return (
    <div className="space-y-3">
      <Card  className="px-3 py-2">
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
      </Card>
      <HelpBanner tone="warn" className="rounded-sm">
        <p className="text-2xs text-warn-foreground">
          Save this key securely. It will not be shown again after you leave this page.
        </p>
      </HelpBanner>
    </div>
  )
}
