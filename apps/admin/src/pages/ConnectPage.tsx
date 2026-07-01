/**
 * FILE: apps/admin/src/pages/ConnectPage.tsx
 * PURPOSE: Unified "Connect & Update" hub — one-stop page for SDK install,
 *          MCP setup, CLI install, and SDK upgrade PRs.
 *
 * Sections:
 *   1. PagePosture — MCP status banner + Connect snapshot strip
 *   2. ConnectStudio — client picker + MCP / CLI / Skills lanes
 *   3. Connect GitHub (prerequisite for upgrade PRs)
 *   4. Install SDK (SdkInstallCard)
 *   5. Native CI secrets (conditional)
 *   6. Update center (Create Upgrade PR)
 */

import { useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import {
  ACTIVE_PROJECT_QUERY_PARAM,
  setActiveProjectIdSnapshot,
} from '../lib/activeProject'
import { usePageData } from '../lib/usePageData'
import { Section, Card, Btn, Tooltip, CopyButton, HelpBanner } from '../components/ui'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { ResponsiveTable } from '../components/ResponsiveTable'
import { usePageCopy } from '../lib/copy'
import { SdkInstallCard } from '../components/SdkInstallCard'
import { SdkNativeConnectivityCard } from '../components/SdkNativeConnectivityCard'
import { CliSetupGuide } from '../components/CliSetupGuide'
import { EMPTY_MCP_STATS, type McpStats } from '../components/mcp/types'
import { ConnectStudio } from '../components/connect/ConnectStudio'
import { ConnectSnapshotStrip } from '../components/connect/ConnectSnapshotStrip'
import { McpStatusBanner } from '../components/mcp/McpStatusBanner'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { useConnectUx } from '../lib/connectModeUx'
import { LINK_BRAND } from '../lib/chipTone'
import { SdkVersionBadge } from '../components/SdkVersionBadge'
import { useSdkUpgrade, type BumpEntry } from '../lib/useSdkUpgrade'
import { useDispatchPreflight, type PreflightState } from '../lib/useDispatchPreflight'
import { usePublishPageContext } from '../lib/pageContext'
import { useSetupStatus } from '../lib/useSetupStatus'
import { nextRequiredSetupStep } from '../lib/setupProgress'
import {
  IconGit,
  IconCheck,
  IconExternalLink,
  IconRefresh,
  IconBolt,
  IconAlertTriangle,
  IconArrowRight,
  IconIntegrations,
} from '../components/icons'
import { CodeInline } from '../components/CodePanel'
import type { SdkStatus } from '../components/SdkVersionBadge'
import { isExpoReporterProject } from '../lib/projectMushiEnv'

interface ProjectRepoLite {
  repo_url: string | null
  github_app_connected?: boolean
}

interface ProjectRow {
  id: string
  name: string
  slug: string
  sdk_package?: string | null
  sdk_version?: string | null
  sdk_latest_version?: string | null
  sdk_status?: SdkStatus | null
  primary_repo?: ProjectRepoLite | null
  api_keys?: Array<{
    is_active: boolean
    last_seen_at?: string | null
  }>
}

function isExpoReporterNeverConnected(project: ProjectRow): boolean {
  if (!isExpoReporterProject(project.slug)) return false
  const active = (project.api_keys ?? []).filter((k) => k.is_active)
  if (active.length === 0) return false
  return active.every((k) => !k.last_seen_at)
}

interface ProjectsPayload {
  projects: ProjectRow[]
}


// ---------------------------------------------------------------------------
// Upgrade status inline indicator
// ---------------------------------------------------------------------------
function UpgradeStatusIndicator({ status, prUrl, error }: {
  status: string
  prUrl?: string
  error?: string
}) {
  if (status === 'idle') return null

  const spinner = (
    <span
      className="inline-block h-3 w-3 shrink-0 rounded-full border-2 border-current/30 border-t-current motion-safe:animate-spin"
      aria-hidden
    />
  )

  if (status === 'queueing' || status === 'queued') {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-full bg-surface-overlay px-2.5 py-0.5 text-xs text-fg-muted border border-edge-subtle"
      >
        {spinner}
        Queuing…
      </span>
    )
  }

  if (status === 'running') {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand border border-brand/25"
      >
        {spinner}
        Opening PR…
      </span>
    )
  }

  if (status === 'completed' && prUrl) {
    return (
      <a
        href={prUrl}
        target="_blank"
        rel="noopener noreferrer"
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-full bg-ok/10 border border-ok/25 px-2.5 py-0.5 text-xs font-medium text-ok hover:bg-ok/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <IconCheck className="h-3.5 w-3.5" aria-hidden />
        PR opened
        <IconExternalLink className="h-3.5 w-3.5 opacity-60" aria-hidden />
      </a>
    )
  }

  if (status === 'completed_no_pr') {
    return (
      <Tooltip content={error ?? 'All @mushi-mushi/* packages are already at the latest version.'} side="top">
        <span
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1 rounded-full bg-ok/10 border border-ok/25 px-2.5 py-0.5 text-xs font-medium text-ok"
        >
          <IconCheck className="h-3.5 w-3.5" aria-hidden />
          All up to date
        </span>
      </Tooltip>
    )
  }

  if (status === 'failed') {
    return (
      <Tooltip content={error ?? 'Unknown error'} side="top">
        <span
          role="status"
          aria-live="assertive"
          className="inline-flex items-center gap-1 rounded-full bg-danger/10 border border-danger/25 px-2.5 py-0.5 text-xs font-medium text-danger-foreground"
        >
          Failed
        </span>
      </Tooltip>
    )
  }

  return null
}

// ---------------------------------------------------------------------------
// Bump plan table
// ---------------------------------------------------------------------------
function BumpPlanTable({ bumps }: { bumps: BumpEntry[] }) {
  if (bumps.length === 0) return null
  return (
    <ResponsiveTable ariaLabel="SDK upgrade bump plan">
      <table className="w-full text-xs">
        <thead className="bg-surface-hover/50">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-fg-muted">Package</th>
            <th className="px-3 py-2 text-left font-medium text-fg-muted">From</th>
            <th className="px-3 py-2 text-left font-medium text-fg-muted">To</th>
          </tr>
        </thead>
        <tbody>
          {bumps.map((b, i) => (
            <tr key={b.package} className={i % 2 === 0 ? 'bg-surface' : 'bg-surface-hover/30'}>
              <td className="px-3 py-1.5 font-mono">{b.package}</td>
              <td className="px-3 py-1.5 font-mono text-fg-muted">{b.from}</td>
              <td className="px-3 py-1.5 font-mono text-ok">{b.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ResponsiveTable>
  )
}

// ---------------------------------------------------------------------------
// Update center section
// ---------------------------------------------------------------------------
function UpdateCenter({ project, preflight }: { project: ProjectRow; preflight: PreflightState }) {
  const { state, createUpgradePr, refreshUpgradePr, syncStatus } = useSdkUpgrade(project.id)

  const isInFlight = ['queueing', 'queued', 'running'].includes(state.status)
  const hasOpenPr = state.status === 'completed' && Boolean(state.prUrl)
  const isUpToDate = state.status === 'completed_no_pr'
  const isFailed = state.status === 'failed'
  const githubCheck = preflight.checks.find((c) => c.key === 'github')
  const hasRepoRow = Boolean(project.primary_repo?.repo_url) || Boolean(preflight.repoUrl)
  const hasGithubReady = githubCheck?.ready ?? hasRepoRow
  const githubHint = githubCheck && !githubCheck.ready ? githubCheck.hint : null

  const sdkStatus = (project.sdk_status ?? 'unknown') as SdkStatus

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-fg">SDK version</h3>
          <p className="text-xs text-fg-muted mt-0.5">
            Version seen in production reports vs. the latest published release.
          </p>
        </div>
        <SdkVersionBadge
          status={sdkStatus}
          package_={project.sdk_package ?? null}
          observedVersion={project.sdk_version ?? null}
          latestVersion={project.sdk_latest_version ?? null}
        />
      </div>

      {!hasGithubReady && (
        <HelpBanner
          tone="warn"
          title="GitHub not ready for upgrade PRs"
          icon={<IconAlertTriangle className="h-4 w-4 text-warning-foreground" />}
        >
          {githubHint ?? (
            <>
              Connect a GitHub repo in{' '}
              <Link to="/integrations/config" className="underline focus-visible:ring-2 focus-visible:ring-focus">
                Integrations
              </Link>{' '}
              to enable one-click upgrade PRs.
            </>
          )}
          {githubCheck?.fixHref && (
            <Link
              to={githubCheck.fixHref}
              className="mt-1 inline-flex text-xs font-medium text-brand underline focus-visible:ring-2 focus-visible:ring-focus"
            >
              Fix GitHub connection
            </Link>
          )}
        </HelpBanner>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {hasGithubReady ? (
          <>
            {hasOpenPr && state.prUrl ? (
              <>
                <a href={state.prUrl} target="_blank" rel="noopener noreferrer">
                  <Btn size="md" variant="primary" className="gap-2">
                    <IconExternalLink className="h-4 w-4" aria-hidden />
                    View upgrade PR
                  </Btn>
                </a>
                <Tooltip
                  content="Refresh the open PR branch if newer @mushi-mushi/* versions shipped since it was opened."
                  side="top"
                >
                  <Btn
                    size="md"
                    variant="ghost"
                    loading={isInFlight}
                    disabled={isInFlight}
                    onClick={() => void refreshUpgradePr()}
                    className="gap-2"
                  >
                    <IconRefresh className="h-4 w-4" aria-hidden />
                    Refresh PR
                  </Btn>
                </Tooltip>
                {state.jobId && (
                  <Btn
                    size="md"
                    variant="ghost"
                    disabled={isInFlight}
                    onClick={() => void syncStatus(state.jobId!)}
                    className="gap-2"
                  >
                    Sync CI
                  </Btn>
                )}
              </>
            ) : isUpToDate ? (
              <Tooltip content="Re-scan the connected repo for newer catalog versions." side="top">
                <Btn
                  size="md"
                  variant="ghost"
                  loading={isInFlight}
                  disabled={isInFlight}
                  onClick={() => void createUpgradePr()}
                  className="gap-2"
                >
                  <IconRefresh className="h-4 w-4" aria-hidden />
                  Check again
                </Btn>
              </Tooltip>
            ) : (
              <Tooltip
                content={
                  isInFlight
                    ? 'Upgrade in progress…'
                    : isFailed
                      ? 'Retry opening or refreshing the upgrade PR.'
                      : 'Opens one upgrade PR per repo — reuses an existing open PR when present.'
                }
                side="top"
              >
                <Btn
                  size="md"
                  variant="primary"
                  loading={isInFlight}
                  disabled={isInFlight}
                  onClick={() => void (isFailed ? refreshUpgradePr() : createUpgradePr())}
                  className="gap-2"
                >
                  <IconBolt className="h-4 w-4" aria-hidden />
                  {isFailed ? 'Retry upgrade PR' : 'Create Upgrade PR'}
                </Btn>
              </Tooltip>
            )}
          </>
        ) : (
          <Link to="/integrations/config">
            <Btn size="md" variant="ghost" className="gap-2">
              <IconGit className="h-4 w-4" aria-hidden />
              Connect GitHub in Integrations
              <IconArrowRight className="h-4 w-4" aria-hidden />
            </Btn>
          </Link>
        )}

        <Tooltip content="Copy the mushi upgrade CLI command" side="top">
          <CopyButton value="mushi upgrade" label="Copy CLI command" copiedLabel="Copied" size="sm" />
        </Tooltip>

        <UpgradeStatusIndicator
          status={state.status}
          prUrl={state.prUrl}
          error={state.error}
        />
      </div>

      {state.plan && state.plan.length > 0 && (
        <BumpPlanTable bumps={state.plan} />
      )}

      {state.status === 'completed_no_pr' && state.error && (
        <p className="text-xs text-fg-muted">{state.error}</p>
      )}

      {state.status === 'failed' && state.error && (
        <p className="text-xs text-[var(--color-error-foreground)]">{state.error}</p>
      )}

      {state.status === 'completed' && state.prUrl && (
        <p className="text-xs text-fg-muted">
          {state.reused
            ? 'Reused the existing open upgrade PR for this repo — no duplicate branch was created.'
            : 'After merging the PR, run your package manager to refresh the lockfile.'}{' '}
          Capacitor/RN projects also need <CodeInline>npx cap sync</CodeInline>.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// GitHub connection card — preflight-backed for realtime repo metadata
// ---------------------------------------------------------------------------
function GithubConnectionCard({
  preflight,
  fallbackRepoUrl,
}: {
  preflight: PreflightState
  fallbackRepoUrl: string | null
}) {
  const githubCheck = preflight.checks.find((c) => c.key === 'github')
  const repoUrl = preflight.repoUrl ?? fallbackRepoUrl
  const hasGithub = Boolean(repoUrl) && (githubCheck?.ready ?? Boolean(repoUrl))
  const loading = preflight.loading && !repoUrl

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <IconGit className="h-5 w-5 text-fg-muted shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">GitHub repository</p>
          {loading ? (
            <p className="text-xs text-fg-muted" aria-busy="true">Checking connection…</p>
          ) : hasGithub && repoUrl ? (
            <p className="text-xs text-fg-muted font-mono break-all">{repoUrl}</p>
          ) : (
            <p className="text-xs text-fg-muted">
              {githubCheck?.hint ??
                'Required for upgrade PRs and autofix. Managed in Integrations.'}
            </p>
          )}
        </div>
        {loading ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted shrink-0" aria-busy="true">
            <span className="inline-block h-3 w-3 rounded-full border-2 border-current/30 border-t-current motion-safe:animate-spin" aria-hidden />
            Loading
          </span>
        ) : hasGithub ? (
          <span className="inline-flex items-center gap-1 text-xs text-ok shrink-0">
            <IconCheck className="h-3.5 w-3.5" aria-hidden />
            Connected
          </span>
        ) : (
          <Link to={githubCheck?.fixHref ?? '/integrations/config'}>
            <Btn size="sm" variant="ghost" className="gap-1.5 shrink-0">
              <IconIntegrations className="h-3.5 w-3.5" aria-hidden />
              Set up in Integrations
              <IconArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Btn>
          </Link>
        )}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Sticky in-page section nav — deep-links to anchor IDs below.
// ---------------------------------------------------------------------------
const CONNECT_SECTIONS = [
  { id: 'connect-studio', label: 'Studio' },
  { id: 'connect-github', label: 'GitHub' },
  { id: 'connect-sdk', label: 'SDK' },
  { id: 'connect-native-ci', label: 'Native CI' },
  { id: 'connect-update', label: 'Update' },
] as const

function ConnectSectionNav() {
  return (
    <nav
      aria-label="Connect page sections"
      className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-1 border-b border-edge-subtle bg-surface/95 px-1 py-2 backdrop-blur-sm supports-[backdrop-filter]:bg-surface/80"
    >
      {CONNECT_SECTIONS.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className="rounded-sm px-2 py-1 text-2xs font-medium text-fg-muted hover:text-fg hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          {section.label}
        </a>
      ))}
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Compact section header helper (description as subtitle under title)
// ---------------------------------------------------------------------------
function SectionDescription({ children, when = true }: { children: React.ReactNode; when?: boolean }) {
  if (!when) return null
  return <p className="mb-3 text-xs text-fg-muted">{children}</p>
}

// ---------------------------------------------------------------------------
// Project-resolution fallback — shared by every project-scoped section so a
// deep link or a failed `/v1/admin/projects` fetch never dead-ends on a bare
// "Select a project" that gives no hint and no way to recover.
// ---------------------------------------------------------------------------
function resolveProjectFallback(opts: {
  pending: boolean
  missing: boolean
  hasError: boolean
}): { text: string; busy: boolean } {
  if (opts.pending) return { text: 'Loading project…', busy: true }
  if (opts.hasError) return { text: "Couldn't load your projects — use Retry above.", busy: false }
  if (opts.missing) {
    return {
      text: "That project isn't in your account (or hasn't loaded). Pick one from the project switcher above.",
      busy: false,
    }
  }
  return { text: 'Select a project above.', busy: false }
}

function ProjectFallbackNote({
  pending,
  missing,
  hasError,
  card,
}: {
  pending: boolean
  missing: boolean
  hasError: boolean
  /** Wrap in a Card for sections whose project view renders its own card. */
  card?: boolean
}) {
  const { text, busy } = resolveProjectFallback({ pending, missing, hasError })
  const note = (
    <p className={`text-sm text-fg-muted${card ? ' p-4' : ''}`} {...(busy ? { 'aria-busy': true } : {})}>
      {text}
    </p>
  )
  return card ? <Card>{note}</Card> : note
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function ConnectPage() {
  const copy = usePageCopy('/connect')
  const connectUx = useConnectUx()
  const showSectionDescriptions = connectUx.hideConnectSnapshot
  usePublishPageContext({
    route: '/connect',
    title: 'Connect & Update',
  })
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const activeProjectId = useActiveProjectId()
  const projectsFeed = usePageData<ProjectsPayload>('/v1/admin/projects')
  const mcpStatsQuery = usePageData<McpStats>('/v1/admin/mcp/stats')
  const mcpStats = mcpStatsQuery.data ?? EMPTY_MCP_STATS
  const statsFetchedAt = mcpStatsQuery.lastFetchedAt
  const statsValidating = projectsFeed.isValidating || mcpStatsQuery.isValidating
  const preflight = useDispatchPreflight(activeProjectId)

  // Legacy deep link from the brief /mcp → /connect redirect — Agent help
  // belongs on the MCP console, not the Connect hub.
  useEffect(() => {
    if (searchParams.get('section') === 'mcp') {
      const project = searchParams.get(ACTIVE_PROJECT_QUERY_PARAM)
      navigate(project ? `/mcp?${ACTIVE_PROJECT_QUERY_PARAM}=${project}` : '/mcp', { replace: true })
    }
  }, [searchParams, navigate])

  // Deep links like /connect?project=<uuid> should hydrate storage before
  // child hooks (SdkInstallCard, useSdkUpgrade) read the active project.
  useEffect(() => {
    const fromUrl = searchParams.get(ACTIVE_PROJECT_QUERY_PARAM)
    if (fromUrl) setActiveProjectIdSnapshot(fromUrl)
  }, [searchParams])

  const project = activeProjectId
    ? projectsFeed.data?.projects.find((p) => p.id === activeProjectId) ?? null
    : null
  const projectPending =
    Boolean(activeProjectId) && projectsFeed.loading && project == null
  // An active project id is set (deep link or remembered) but it's not in the
  // successfully-loaded list — different account, deleted, or paginated out.
  const projectMissing =
    Boolean(activeProjectId) && !projectsFeed.loading && !projectsFeed.error && project == null
  const feedError = projectsFeed.error

  const fallbackGithubRepoUrl = project?.primary_repo?.repo_url ?? null
  const githubCheck = preflight.checks.find((c) => c.key === 'github')
  const githubRepoUrl = preflight.repoUrl ?? fallbackGithubRepoUrl
  const githubConnected = Boolean(githubRepoUrl) && (githubCheck?.ready ?? Boolean(githubRepoUrl))
  const sdkConnected = Boolean(
    project?.api_keys?.some((k) => k.is_active && k.last_seen_at),
  )
  const setupStatus = useSetupStatus(activeProjectId)
  const nextSetupStep = nextRequiredSetupStep(
    setupStatus.activeProject ?? { steps: [], required_total: 0, required_complete: 0, total: 0, complete: 0, done: false, report_count: 0, fix_count: 0, merged_fix_count: 0, project_id: '', project_name: '', project_slug: '', created_at: '' },
  )
  const requiredSetupDone = setupStatus.selectors.done

  return (
    <div className="space-y-6">
      {!requiredSetupDone && nextSetupStep && (
        <HelpBanner tone="warn" title="Finish setup first">
          <p className="text-xs text-fg-muted">
            Complete <strong>{nextSetupStep.label}</strong> in the setup wizard before
            wiring integrations here.
          </p>
          <Link to={nextSetupStep.cta_to} className="mt-2 inline-block">
            <Btn size="sm" variant="ghost">{nextSetupStep.cta_label} →</Btn>
          </Link>
        </HelpBanner>
      )}

      <PageHeaderBar
        title={copy?.title ?? 'Connect & Update'}
        description={
          copy?.description ??
          'Connect GitHub, install the SDK, add MCP to your editor, set up the CLI, and keep @mushi-mushi/* packages current.'
        }
        helpTitle={copy?.help?.title ?? 'About Connect & Update'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'The install and upgrade cockpit — connect your repo, copy SDK/MCP install commands, and create a PR that bumps @mushi-mushi packages.'
        }
        helpUseCases={
          copy?.help?.useCases ?? [
            'First-time setup: connect GitHub → install SDK → add MCP to Cursor',
            'Upgrade path: "Create Upgrade PR" bumps @mushi-mushi/* to latest npm',
            'Verify indexing: enable codebase index so Explore can map your repo',
          ]
        }
        helpHowToUse={
          copy?.help?.howToUse ??
          'Connect GitHub first. Copy the SDK install snippet into your app, then use MCP deeplinks for Cursor. When versions drift, click Create Upgrade PR and merge after CI passes.'
        }
      />

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            show: mcpStats.topPriority !== 'healthy' && mcpStats.topPriority !== 'no_project',
            children: (
              <McpStatusBanner
                stats={mcpStats}
                onRefresh={() => { void mcpStatsQuery.reload() }}
                refreshing={statsValidating}
                plainBanner
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            show: !connectUx.hideConnectSnapshot,
            children: (
              <ConnectSnapshotStrip
                githubConnected={githubConnected}
                githubRepoUrl={githubRepoUrl}
                sdkConnected={sdkConnected}
                sdkLastSeenAt={
                  project?.api_keys?.find((k) => k.is_active && k.last_seen_at)?.last_seen_at ?? null
                }
                sdkVersion={project?.sdk_version ?? null}
                sdkLatestVersion={project?.sdk_latest_version ?? null}
                sdkStatus={project?.sdk_status ?? null}
                mcpStats={mcpStats}
                statsFetchedAt={statsFetchedAt}
                statsValidating={statsValidating}
                compact={connectUx.compactSnapshot}
                hideLinks={connectUx.hideSnapshotLinks}
              />
            ),
          },
        ]}
      />

      <ConnectSectionNav />

      <div id="connect-studio" className="scroll-mt-chrome">
      <ConnectStudio
        projectId={project?.id ?? activeProjectId}
        projectName={project?.name}
      />

      </div>

      {/* Related links live in ConnectStudio lanes — avoid duplicating MCP/Skills paths. */}

      {/* ── Fallback CLI guide for first-run (no SDK heartbeat yet) ──────── */}
      {!sdkConnected && !feedError ? (
        <CliSetupGuide projectId={project?.id ?? activeProjectId} />
      ) : null}

      {feedError && (
        <HelpBanner
          tone="danger"
          role="alert"
          title="Couldn't load your projects"
          icon={<IconAlertTriangle className="h-4 w-4 text-danger-foreground" />}
        >
          <p className="text-xs">{feedError}</p>
          <Btn size="sm" variant="ghost" className="mt-2" onClick={() => projectsFeed.reload()}>
            Retry
          </Btn>
        </HelpBanner>
      )}

      <div className="xl:grid xl:grid-cols-2 xl:items-start xl:gap-6">
      <div className="space-y-6">
      {/* ---------------------------------------------------------------- */}
      {/* 1. GitHub connect                                                 */}
      {/* ---------------------------------------------------------------- */}
      <div id="connect-github" className="scroll-mt-chrome">
      <Section
        title="GitHub"
        action={
          <Link to="/integrations/config">
            <Btn size="sm" variant="ghost" className="gap-1.5">
              <IconIntegrations className="h-3.5 w-3.5" aria-hidden />
              Manage
              <IconArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Btn>
          </Link>
        }
      >
        <SectionDescription when={showSectionDescriptions}>
          Connect your repository to enable one-click upgrade PRs and autofix.
        </SectionDescription>
        <GithubConnectionCard
          preflight={preflight}
          fallbackRepoUrl={fallbackGithubRepoUrl}
        />
      </Section>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* 2. Install SDK                                                    */}
      {/* ---------------------------------------------------------------- */}
      <div id="connect-sdk" className="scroll-mt-chrome">
      <Section title="Bug capture SDK">
        <SectionDescription when={showSectionDescriptions}>
          Add the Mushi SDK to your app so users can report bugs in one tap.
        </SectionDescription>
        {project && isExpoReporterNeverConnected(project) ? (
          <HelpBanner
            tone="warn"
            title="No SDK heartbeat from store builds yet"
            icon={<IconAlertTriangle className="h-5 w-5 text-warning-foreground" />}
            className="mb-3"
          >
            <p className="text-xs leading-relaxed">
              Keys exist but no app has authenticated. For yen-yen, set{' '}
              <code className="font-mono text-2xs">EXPO_PUBLIC_MUSHI_*</code> in{' '}
              <code className="font-mono text-2xs">apps/mobile/.env.local</code> and as GitHub
              repo vars/secrets, then trigger <strong>release-mobile</strong> — OTA cannot inject
              compile-time env. <code className="font-mono text-2xs">MUSHI_INGEST_KEY</code> is
              Code Health only, not the in-app band.
            </p>
            <Link to={`/setup-copilot?project=${project.id}`} className={`mt-2 inline-block text-xs ${LINK_BRAND}`}>
              Open Setup Copilot → CI &amp; store builds
            </Link>
          </HelpBanner>
        ) : null}
        {project ? (
          <SdkInstallCard
            projectId={project.id}
            projectSlug={project.slug}
            compact
          />
        ) : (
          <ProjectFallbackNote card pending={projectPending} missing={projectMissing} hasError={Boolean(feedError)} />
        )}
      </Section>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* 2b. Native CI secrets diagnostic (only for native SDK projects)  */}
      {/* ---------------------------------------------------------------- */}
      {/* Render only when the project is using a native SDK package.      */}
      {/* Web-only projects (the majority) don't need CI secret wiring.    */}
      {(() => {
        const nativePkgs = ['@mushi-mushi/react-native', '@mushi-mushi/capacitor']
        const isNativeProject = Boolean(
          project?.sdk_package && nativePkgs.some((p) => project.sdk_package?.includes(p)),
        )
        if (!isNativeProject && project) return null
        return (
          <div id="connect-native-ci" className="scroll-mt-chrome">
          <Section title="Native app CI secrets">
            <SectionDescription when={showSectionDescriptions}>
              Detects missing compile-time env vars and can sync them to GitHub Actions.
            </SectionDescription>
            {project ? (
              <SdkNativeConnectivityCard
                projectId={project.id}
                projectSlug={project.slug}
              />
            ) : (
              <ProjectFallbackNote card pending={projectPending} missing={projectMissing} hasError={Boolean(feedError)} />
            )}
          </Section>
          </div>
        )
      })()}

      </div>

      <div className="space-y-6 xl:sticky xl:top-4">
      {/* Sections 3 (MCP) and 4 (CLI) are now covered by ConnectStudio above */}

      {/* ---------------------------------------------------------------- */}
      {/* 5. Update center                                                  */}
      {/* ---------------------------------------------------------------- */}
      <div id="connect-update" className="scroll-mt-chrome">
      <Section title="Update center">
        <SectionDescription when={showSectionDescriptions}>
          Keep the Mushi SDK up to date in your connected repository. A one-click PR bumps only
          @mushi-mushi/* version strings — you review and merge.
        </SectionDescription>
        <Card>
          <div className="p-4">
            {project ? (
              <UpdateCenter project={project} preflight={preflight} />
            ) : (
              <ProjectFallbackNote pending={projectPending} missing={projectMissing} hasError={Boolean(feedError)} />
            )}
          </div>
        </Card>
      </Section>
      </div>
      </div>
      </div>
    </div>
  )
}
