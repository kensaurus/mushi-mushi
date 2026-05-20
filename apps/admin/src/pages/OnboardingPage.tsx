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
import { useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { Btn, Card, Input, PageHelp, PageHeader, ErrorAlert, ResultChip, type ResultChipTone, CopyButton, Section, StatCard, SegmentedControl, Badge } from '../components/ui'
import { OnboardingStatusBanner } from '../components/onboarding/OnboardingStatusBanner'
import { EMPTY_ONBOARDING_STATS, type OnboardingStats, type OnboardingTabId } from '../components/onboarding/types'
import { usePublishPageContext } from '../lib/pageContext'
import { useRealtimeReload } from '../lib/realtime'
import { PageHero } from '../components/PageHero'
import { OnboardingSkeleton } from '../components/skeletons/OnboardingSkeleton'
import { ConnectionStatus } from '../components/ConnectionStatus'
import { SetupChecklist } from '../components/SetupChecklist'
import { ProjectNarrativeStrip } from '../components/dashboard/ProjectNarrativeStrip'
import { PdcaFlow } from '../components/pdca-flow/PdcaFlow'
import { SdkInstallCard } from '../components/SdkInstallCard'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useToast } from '../lib/toast'
import { useCreateProject } from '../lib/useCreateProject'
import { usePageCopy } from '../lib/copy'
import { restartFirstRunTour } from '../components/FirstRunTour'
import { ConfigHelp } from '../components/ConfigHelp'
import { MigrationsInProgressCard } from '../components/migrations/MigrationsInProgressCard'

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
  const setup = useSetupStatus(activeProjectId)
  const copy = usePageCopy('/onboarding')
  const [searchParams, setSearchParams] = useSearchParams()

  const tabParam = searchParams.get('tab')
  const activeTab: OnboardingTabId = isOnboardingTab(tabParam) ? tabParam : 'overview'
  const activeTabMeta = ONBOARDING_TABS.find((t) => t.id === activeTab) ?? ONBOARDING_TABS[0]

  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<OnboardingStats>('/v1/admin/onboarding/stats')
  const stats = statsData ?? EMPTY_ONBOARDING_STATS

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
      toast.success('API key generated', 'Copy it now \u2014 it will not be shown again.')
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

  const tabOptions = useMemo(
    () => [
      { id: 'overview' as const, label: 'Overview' },
      {
        id: 'steps' as const,
        label: 'Steps',
        count:
          stats.requiredTotal - stats.requiredComplete > 0
            ? stats.requiredTotal - stats.requiredComplete
            : stats.stepsComplete > 0
              ? stats.stepsComplete
              : undefined,
      },
      {
        id: 'verify' as const,
        label: 'Verify',
        count: stats.hasApiKey && stats.reportCount === 0 ? 1 : undefined,
      },
      { id: 'sdk' as const, label: 'SDK' },
    ],
    [stats],
  )

  if (setup.loading || (statsLoading && !statsData)) return <OnboardingSkeleton />
  if (setup.error) return <ErrorAlert message={setup.error} onRetry={reloadAll} />
  if (statsError) return <ErrorAlert message={`Failed to load setup stats: ${statsError}`} onRetry={reloadAll} />

  return (
    <div className="space-y-4">
      <PageHeader
        title={copy?.title ?? 'Setup'}
        projectScope={stats.projectName ?? undefined}
        description={
          copy?.description ??
          'Create a project, mint an ingest key, verify the pipeline, and install the SDK snippet.'
        }
      >
        <Badge className={stats.setupDone ? 'bg-ok-muted text-ok' : stats.hasAnyProject ? 'bg-warn/10 text-warn' : 'bg-info/10 text-info'}>
          {stats.setupDone ? 'READY' : stats.hasAnyProject ? `${stats.requiredComplete}/${stats.requiredTotal}` : 'START'}
        </Badge>
      </PageHeader>

      <OnboardingStatusBanner
        stats={stats}
        onTab={setActiveTab}
        onRunTest={project ? () => void submitTestReport() : undefined}
        testing={testStatus === 'running'}
      />

      <SegmentedControl
        value={activeTab}
        onChange={setActiveTab}
        options={tabOptions}
        ariaLabel="Setup sections"
        size="sm"
      />

      <Section title="Setup snapshot" freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
        <p className="mb-3 text-2xs text-fg-muted">{activeTabMeta.description}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            label="Required"
            value={`${stats.requiredComplete}/${stats.requiredTotal}`}
            accent={stats.setupDone ? 'text-ok' : 'text-warn'}
            hint={stats.nextStepLabel ?? 'All required steps done'}
          />
          <StatCard
            label="SDK"
            value={stats.sdkInstalled ? 'Live' : stats.hasApiKey ? 'Pending' : '—'}
            accent={stats.sdkInstalled ? 'text-ok' : stats.sdkHostMismatch ? 'text-danger' : 'text-info'}
            hint={stats.sdkHostMismatch ? 'Backend mismatch' : stats.sdkInstalled ? 'Heartbeat seen' : 'Install snippet'}
          />
          <StatCard
            label="Reports"
            value={stats.reportCount}
            accent={stats.reportCount > 0 ? 'text-brand' : undefined}
            hint={stats.reportCount > 0 ? 'Pipeline proven' : 'Send test report'}
          />
          <StatCard
            label="Optional"
            value={`${stats.optionalComplete}/${stats.optionalTotal}`}
            accent="text-fg-secondary"
            hint={`${stats.fixCount} fix${stats.fixCount === 1 ? '' : 'es'} dispatched`}
          />
        </div>
      </Section>

      {activeTab === 'overview' && (
        <>
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
                <h3 className="text-sm font-semibold text-fg">Setup complete</h3>
                <p className="text-xs text-fg-muted mt-0.5">
                  Bookmark this page — the SDK install snippet below stays handy when you wire Mushi into a new
                  framework, repo, or environment.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Btn size="sm" variant="ghost" onClick={() => navigate('/dashboard')}>Open dashboard</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => navigate('/projects')}>Manage projects</Btn>
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

      <PageHelp
        title={copy?.help?.title ?? 'About this wizard'}
        whatIsIt={copy?.help?.whatIsIt ?? 'A guided flow that creates your first project, generates an API key, verifies the pipeline, and shows the SDK snippet. State syncs across devices.'}
        useCases={copy?.help?.useCases ?? [
          'Create the project that will receive bug reports from your app',
          'Generate and copy the API key that authenticates SDK requests',
          'Confirm the ingest pipeline is reachable before shipping any code',
        ]}
        howToUse={copy?.help?.howToUse ?? 'Complete the required steps in order. The API key is only shown once \u2014 copy it before continuing. You can rerun the test report any time from Settings.'}
      />

      {/* Explainer diagram: shows first-run users the four stages of the
          loop they're about to enter, with outcome copy instead of empty
          zero-counts. Wrapped in a section so the FirstRunTour's "plan"
          stop can anchor on the Plan node via `data-tour-id="pdca-flow"`. */}
      <section aria-label="What the loop does" className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-fg">How Mushi closes the loop</h3>
          <span className="text-2xs text-fg-faint hidden sm:block">
            Plan → Do → Check → Act (loops back)
          </span>
        </div>
        <PdcaFlow variant="onboarding" ariaLabel="Plan-Do-Check-Act loop explainer" />
      </section>
        </>
      )}

      {activeTab === 'steps' && (
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
            <p className="text-xs text-fg-muted mt-1">
              A project groups all bug reports from one application. Name it after your app.
            </p>
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
            <Btn onClick={createProject} loading={creating} disabled={creating || !projectName.trim()}>
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

      {activeTab === 'verify' && (
        <>
      {project && nextRequired?.id === 'api_key_generated' && (
        <Card className="p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-fg">Generate an API key</h3>
            <p className="text-xs text-fg-muted mt-1">
              Your SDK uses this key to authenticate report submissions. The full key is shown <strong>only once</strong> — copy it before navigating away.
            </p>
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
            <p className="text-xs text-fg-muted mt-1">
              Verify that the backend is reachable and the pipeline can accept reports.
            </p>
          </div>
          <ConnectionStatus />
          <div className="border-t border-edge-subtle pt-3">
            <p className="text-xs text-fg-muted mb-2">Submit a test report to verify the full pipeline:</p>
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
        </>
      )}

      {activeTab === 'sdk' && (
        <>
      {project && !setup.isStepIncomplete('api_key_generated') ? (
        <div className="space-y-3">
          <SdkInstallCard projectId={project.project_id} apiKey={apiKey?.key} />
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
    </div>
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
      <div className="rounded-sm border border-warn/30 bg-warn/5 px-3 py-2">
        <p className="text-2xs text-warn">
          Save this key securely. It will not be shown again after you leave this page.
        </p>
      </div>
    </div>
  )
}
