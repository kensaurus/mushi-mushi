/**
 * FILE: apps/admin/src/pages/ConnectPage.tsx
 * PURPOSE: Unified "Connect & Update" hub — one-stop page for SDK install,
 *          MCP setup, CLI install, and SDK upgrade PRs.
 */

import { useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import {
  ACTIVE_PROJECT_QUERY_PARAM,
  setActiveProjectIdSnapshot,
} from '../lib/activeProject'
import { usePageData } from '../lib/usePageData'
import { Section, Card, Btn, HelpBanner } from '../components/ui'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { usePageCopy } from '../lib/copy'
import { SdkInstallCard } from '../components/SdkInstallCard'
import { SdkNativeConnectivityCard } from '../components/SdkNativeConnectivityCard'
import { CliSetupGuide } from '../components/CliSetupGuide'
import { EMPTY_MCP_STATS, type McpStats } from '../components/mcp/types'
import { ConnectStudio } from '../components/connect/ConnectStudio'
import { ConnectSnapshotStrip } from '../components/connect/ConnectSnapshotStrip'
import { SectionAnchorNav } from '../components/connect/SectionAnchorNav'
import { GithubConnectionCard } from '../components/connect/GithubConnectionCard'
import { UpdateCenter } from '../components/connect/UpdateCenter'
import { McpStatusBanner } from '../components/mcp/McpStatusBanner'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { useConnectUx } from '../lib/connectModeUx'
import { LINK_ACCENT } from '../lib/chipTone'
import { useDispatchPreflight } from '../lib/useDispatchPreflight'
import { usePublishPageContext } from '../lib/pageContext'
import { useSetupStatus } from '../lib/useSetupStatus'
import { nextRequiredSetupStep } from '../lib/setupProgress'
import {
  IconAlertTriangle,
  IconArrowRight,
  IconIntegrations,
  IconLink,
} from '../components/icons'
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

const CONNECT_SECTIONS = [
  { id: 'connect-studio', label: 'Studio' },
  { id: 'connect-github', label: 'GitHub' },
  { id: 'connect-sdk', label: 'Bug capture' },
  { id: 'connect-native-ci', label: 'Native CI' },
  { id: 'connect-update', label: 'Update' },
] as const

function SectionDescription({ children, when = true }: { children: React.ReactNode; when?: boolean }) {
  if (!when) return null
  return <p className="mb-3 text-xs text-fg-muted">{children}</p>
}

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

function NativeCiSection({
  project,
  projectPending,
  projectMissing,
  feedError,
  showSectionDescriptions,
}: {
  project: ProjectRow | null
  projectPending: boolean
  projectMissing: boolean
  feedError: string | null
  showSectionDescriptions: boolean
}) {
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
          <SdkNativeConnectivityCard projectId={project.id} projectSlug={project.slug} />
        ) : (
          <ProjectFallbackNote
            card
            pending={projectPending}
            missing={projectMissing}
            hasError={Boolean(feedError)}
          />
        )}
      </Section>
    </div>
  )
}

export function ConnectPage() {
  const copy = usePageCopy('/connect')
  const connectUx = useConnectUx()
  const showSectionDescriptions = connectUx.hideConnectSnapshot
  const hideVersionInUpdate = !connectUx.hideConnectSnapshot
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

  useEffect(() => {
    if (searchParams.get('section') === 'mcp') {
      const project = searchParams.get(ACTIVE_PROJECT_QUERY_PARAM)
      navigate(project ? `/mcp?${ACTIVE_PROJECT_QUERY_PARAM}=${project}` : '/mcp', { replace: true })
    }
  }, [searchParams, navigate])

  useEffect(() => {
    const fromUrl = searchParams.get(ACTIVE_PROJECT_QUERY_PARAM)
    if (fromUrl) setActiveProjectIdSnapshot(fromUrl)
  }, [searchParams])

  const project = activeProjectId
    ? projectsFeed.data?.projects.find((p) => p.id === activeProjectId) ?? null
    : null
  const projectPending =
    Boolean(activeProjectId) && projectsFeed.loading && project == null
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

  const visibleSections = CONNECT_SECTIONS.filter((s) => {
    if (s.id !== 'connect-native-ci') return true
    const nativePkgs = ['@mushi-mushi/react-native', '@mushi-mushi/capacitor']
    return (
      !project ||
      Boolean(project.sdk_package && nativePkgs.some((p) => project.sdk_package?.includes(p)))
    )
  })

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-connect">
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
        icon={<IconLink />}
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

      <SectionAnchorNav sections={visibleSections} ariaLabel="Connect page sections" />

      <div id="connect-studio" className="scroll-mt-chrome">
        <ConnectStudio
          projectId={project?.id ?? activeProjectId}
          projectName={project?.name}
        />
      </div>

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

      {/* mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas) */}
      <div className="space-y-6 xl:grid xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.85fr)] xl:items-start xl:gap-6">
        <div className="space-y-6 min-w-0">
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
                  <Link
                    to={`/setup-copilot?project=${project.id}`}
                    className={`mt-2 inline-block text-xs ${LINK_ACCENT}`}
                  >
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
                <ProjectFallbackNote
                  card
                  pending={projectPending}
                  missing={projectMissing}
                  hasError={Boolean(feedError)}
                />
              )}
            </Section>
          </div>

          <NativeCiSection
            project={project}
            projectPending={projectPending}
            projectMissing={projectMissing}
            feedError={feedError}
            showSectionDescriptions={showSectionDescriptions}
          />
        </div>

        <div className="space-y-6 min-w-0 xl:sticky xl:top-4">
          <div id="connect-update" className="scroll-mt-chrome">
            <Section title="Update center">
              <SectionDescription when={showSectionDescriptions}>
                Keep the Mushi SDK up to date in your connected repository. A one-click PR bumps only
                @mushi-mushi/* version strings — you review and merge.
              </SectionDescription>
              {project ? (
                <UpdateCenter
                  project={project}
                  preflight={preflight}
                  hideVersionBadge={hideVersionInUpdate}
                />
              ) : (
                <ProjectFallbackNote
                  pending={projectPending}
                  missing={projectMissing}
                  hasError={Boolean(feedError)}
                />
              )}
            </Section>
          </div>
        </div>
      </div>
    </div>
  )
}
