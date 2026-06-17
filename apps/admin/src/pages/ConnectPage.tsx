/**
 * FILE: apps/admin/src/pages/ConnectPage.tsx
 * PURPOSE: Unified "Connect & Update" hub — one-stop page for SDK install,
 *          MCP setup, CLI install, and SDK upgrade PRs.
 *
 * Sections:
 *   1. Connect GitHub (prerequisite for upgrade PRs)
 *   2. Install SDK (reuses SdkInstallCard)
 *   3. Install MCP (reuses McpInstallButtons)
 *   4. Install CLI (copy `npm i -g @mushi-mushi/cli@latest`)
 *   5. Update center (per-package freshness, "Create Upgrade PR" CTA)
 */

import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
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
import { McpInstallButtons } from '../components/McpInstallButtons'
import { SdkVersionBadge } from '../components/SdkVersionBadge'
import { useSdkUpgrade, type BumpEntry } from '../lib/useSdkUpgrade'
import { useDispatchPreflight, type PreflightState } from '../lib/useDispatchPreflight'
import { usePublishPageContext } from '../lib/pageContext'
import {
  IconGit,
  IconCheck,
  IconExternalLink,
  IconBolt,
  IconTerminal,
  IconAlertTriangle,
  IconArrowRight,
  IconMcp,
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
        className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent border border-accent/25"
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
  const { state, createUpgradePr, reset } = useSdkUpgrade(project.id)

  const isInFlight = ['queueing', 'queued', 'running'].includes(state.status)
  const isDone = ['completed', 'completed_no_pr', 'failed'].includes(state.status)
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
          <Tooltip
            content={
              isInFlight
                ? 'Upgrade in progress…'
                : 'Bumps @mushi-mushi/* in your connected repo and opens a draft PR for review.'
            }
            side="top"
          >
            <Btn
              size="md"
              variant="primary"
              loading={isInFlight}
              disabled={isInFlight}
              onClick={() => {
                if (isDone) reset()
                void createUpgradePr()
              }}
              className="gap-2"
            >
              <IconBolt className="h-4 w-4" aria-hidden />
              Create Upgrade PR
            </Btn>
          </Tooltip>
        ) : (
          <Link to="/integrations/config">
            <Btn size="md" variant="ghost" className="gap-2">
              <IconGit className="h-4 w-4" aria-hidden />
              Connect GitHub
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
          After merging the PR, run your package manager to refresh the lockfile.
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
            <p className="text-xs text-fg-muted truncate font-mono">{repoUrl}</p>
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
              Connect
            </Btn>
          </Link>
        )}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Compact section header helper (description as subtitle under title)
// ---------------------------------------------------------------------------
function SectionDescription({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-xs text-fg-muted">{children}</p>
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function ConnectPage() {
  const copy = usePageCopy('/connect')
  usePublishPageContext({
    route: '/connect',
    title: 'Connect & Update',
  })
  const [searchParams] = useSearchParams()
  const activeProjectId = useActiveProjectId()
  const projectsFeed = usePageData<ProjectsPayload>('/v1/admin/projects')
  const preflight = useDispatchPreflight(activeProjectId)

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

  const fallbackGithubRepoUrl = project?.primary_repo?.repo_url ?? null

  const CLI_INSTALL = 'npm install -g @mushi-mushi/cli@latest'
  const CLI_INIT = 'mushi init'

  return (
    <div className="space-y-6">
      <PageHeaderBar
        title={copy?.title ?? 'Connect & Update'}
        description={
          copy?.description ??
          'Install the SDK, connect your IDE agent, set up the CLI, and keep everything up to date — all in one place.'
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

      <div className="xl:grid xl:grid-cols-2 xl:items-start xl:gap-6">
      <div className="space-y-6">
      {/* ---------------------------------------------------------------- */}
      {/* 1. GitHub connect                                                 */}
      {/* ---------------------------------------------------------------- */}
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
        <SectionDescription>
          Connect your repository to enable one-click upgrade PRs and autofix.
        </SectionDescription>
        <GithubConnectionCard
          preflight={preflight}
          fallbackRepoUrl={fallbackGithubRepoUrl}
        />
      </Section>

      {/* ---------------------------------------------------------------- */}
      {/* 2. Install SDK                                                    */}
      {/* ---------------------------------------------------------------- */}
      <Section title="Bug capture SDK">
        <SectionDescription>
          Add the Mushi SDK to your app so users can report bugs in one tap.
        </SectionDescription>
        {project && isExpoReporterNeverConnected(project) ? (
          <HelpBanner
            tone="warn"
            title="No SDK heartbeat from store builds yet"
            icon={<IconAlertTriangle className="h-5 w-5 text-warn" />}
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
            <Link to={`/setup-copilot?project=${project.id}`} className="mt-2 inline-block text-xs text-accent underline">
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
        ) : projectPending ? (
          <Card>
            <p className="p-4 text-sm text-fg-muted" aria-busy="true">
              Loading project…
            </p>
          </Card>
        ) : (
          <Card>
            <p className="p-4 text-sm text-fg-muted">Select a project to see install snippets.</p>
          </Card>
        )}
      </Section>

      {/* ---------------------------------------------------------------- */}
      {/* 2b. Native CI secrets diagnostic                                   */}
      {/* ---------------------------------------------------------------- */}
      <Section title="Native app CI secrets">
        <SectionDescription>
          For Capacitor, Expo, and React Native builds, Mushi env vars must be baked in at
          compile time — they cannot be injected at runtime. This panel detects missing CI secrets
          and can write them to GitHub Actions automatically.
        </SectionDescription>
        {project ? (
          <SdkNativeConnectivityCard
            projectId={project.id}
            projectSlug={project.slug}
          />
        ) : projectPending ? (
          <Card>
            <p className="p-4 text-sm text-fg-muted" aria-busy="true">Loading project…</p>
          </Card>
        ) : (
          <Card>
            <p className="p-4 text-sm text-fg-muted">Select a project above.</p>
          </Card>
        )}
      </Section>

      </div>

      <div className="space-y-6 xl:sticky xl:top-4">
      {/* ---------------------------------------------------------------- */}
      {/* 3. Install MCP                                                    */}
      {/* ---------------------------------------------------------------- */}
      <Section title="AI agent (MCP)">
        <SectionDescription>
          Connect Cursor or VS Code to your Mushi project so your AI agent can read reports,
          dispatch fixes, and check health — no copy-paste needed.
        </SectionDescription>
        <Card>
          <div className="space-y-4 p-4">
            <div className="flex items-start gap-3">
              <IconMcp className="h-5 w-5 text-fg-muted mt-0.5 shrink-0" aria-hidden />
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium text-fg">One-click IDE setup</p>
                <p className="text-xs text-fg-muted">
                  Mints a fresh API key and opens your IDE's extension install dialog. The MCP
                  server is configured automatically — no JSON editing required.
                </p>
              </div>
            </div>
            {project ? (
              <McpInstallButtons projectId={project.id} projectName={project.name} />
            ) : projectPending ? (
              <p className="text-sm text-fg-muted" aria-busy="true">Loading project…</p>
            ) : (
              <p className="text-sm text-fg-muted">Select a project above.</p>
            )}
            <p className="text-xs text-fg-muted">
              Prefer a manual snippet?{' '}
              <Link to="/mcp?tab=setup" className="underline focus-visible:ring-2 focus-visible:ring-focus">
                Open MCP setup
              </Link>
            </p>
          </div>
        </Card>
      </Section>

      {/* ---------------------------------------------------------------- */}
      {/* 4. Install CLI                                                    */}
      {/* ---------------------------------------------------------------- */}
      <Section title="CLI">
        <SectionDescription>
          The Mushi CLI gives you doctor checks, QA story runs, skill pipelines, and local
          upgrade commands from the terminal.
        </SectionDescription>
        <Card>
          <div className="space-y-4 p-4">
            <div className="flex items-start gap-3">
              <IconTerminal className="h-5 w-5 text-fg-muted mt-0.5 shrink-0" aria-hidden />
              <div className="min-w-0 space-y-3">
                <div>
                  <p className="text-xs text-fg-muted mb-1">Install globally:</p>
                  <div className="flex items-center gap-2">
                    <CodeInline className="text-xs flex-1 min-w-0 truncate">{CLI_INSTALL}</CodeInline>
                    <CopyButton value={CLI_INSTALL} label="Copy install command" copiedLabel="Copied" size="sm" />
                  </div>
                </div>
                <div>
                  <p className="text-xs text-fg-muted mb-1">Connect to your project:</p>
                  <div className="flex items-center gap-2">
                    <CodeInline className="text-xs flex-1 min-w-0 truncate">{CLI_INIT}</CodeInline>
                    <CopyButton value={CLI_INIT} label="Copy init command" copiedLabel="Copied" size="sm" />
                  </div>
                </div>
                <p className="text-xs text-fg-muted">
                  Also available:{' '}
                  <CodeInline>mushi doctor --server</CodeInline>
                  {' · '}
                  <CodeInline>mushi qa stories</CodeInline>
                  {' · '}
                  <CodeInline>mushi upgrade</CodeInline>
                </p>
              </div>
            </div>
          </div>
        </Card>
      </Section>

      {/* ---------------------------------------------------------------- */}
      {/* 5. Update center                                                  */}
      {/* ---------------------------------------------------------------- */}
      <Section title="Update center">
        <SectionDescription>
          Keep the Mushi SDK up to date in your connected repository. A one-click PR bumps only
          @mushi-mushi/* version strings — you review and merge.
        </SectionDescription>
        <Card>
          <div className="p-4">
            {project ? (
              <UpdateCenter project={project} preflight={preflight} />
            ) : projectPending ? (
              <p className="text-sm text-fg-muted" aria-busy="true">Loading project…</p>
            ) : (
              <p className="text-sm text-fg-muted">Select a project above.</p>
            )}
          </div>
        </Card>
      </Section>
      </div>
      </div>
    </div>
  )
}
