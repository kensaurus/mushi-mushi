/**
 * FILE: apps/admin/src/pages/ConnectPage.tsx
 * PURPOSE: Connect, one step at a time (ADR 0069): 1. the report button,
 *          2. the editor, 3. GitHub. Only the step to do now is open; done
 *          steps are one ✓ line with "Change", later ones one line you can
 *          open. The Update center and SDK health show once the app has
 *          checked in, as one line while all is well.
 *
 *          Links into the page keep working: #connect-sdk, #connect-studio and
 *          #connect-github open their step, and #connect-sdk-health opens the
 *          report button step until there is an SDK to check.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { humanizeApiError } from '../lib/humanizeApiError'
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
import { SdkHealthPanel } from '../components/SdkHealthPanel'
import { SDK_HEALTH_ANCHOR, type SdkHealthPayload } from '../lib/sdkHealth'
import { EMPTY_MCP_STATS, type McpStats } from '../components/mcp/types'
import { ConnectStudio } from '../components/connect/ConnectStudio'
import { connectPills, sdkIsBehind } from '../components/connect/ConnectStatusPills'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { GithubConnectionCard, useGithubConnection } from '../components/connect/GithubConnectionCard'
import { UpdateCenter } from '../components/connect/UpdateCenter'
import { McpStatusBanner } from '../components/mcp/McpStatusBanner'
import { StatusMark, type RunStatus } from '../components/signal/StatusMark'
import { useConnectUx } from '../lib/connectModeUx'
import { LINK_ACCENT } from '../lib/chipTone'
import { useDispatchPreflight } from '../lib/useDispatchPreflight'
import { usePublishPageContext } from '../lib/pageContext'
import { IconAlertTriangle, IconLink } from '../components/icons'
import type { SdkStatus } from '../components/SdkVersionBadge'
import { isSdkKeyScopes, latestHeartbeatAt } from '../lib/heartbeat'
import { mintMcpKeyHref } from '../components/mcp/McpStatusBanner'
import { useScrollToHash } from '../lib/useScrollToHash'
import { Mascot } from '../components/mascot/Mascot'
import { editorConnectGuide } from '../lib/fieldGuide'
import { connectedEditor } from '../lib/connectEditor'

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
    scopes?: string[] | null
  }>
}

/** A React Native / Expo app (by its SDK package, never its name: ADR 0072) whose keys have never checked in. */
export function isExpoReporterNeverConnected(project: Pick<ProjectRow, 'sdk_package' | 'api_keys'>): boolean {
  if (!/react-native/.test(project.sdk_package ?? '')) return false
  const active = (project.api_keys ?? []).filter((k) => k.is_active)
  if (active.length === 0) return false
  return active.every((k) => !k.last_seen_at)
}

interface ProjectsPayload {
  projects: ProjectRow[]
}

type StepKey = 'sdk' | 'editor' | 'github'

/** The three steps, in the order a new app needs them. Each id is the anchor other pages link to. */
const CONNECT_STEPS: ReadonlyArray<{ key: StepKey; id: string; label: string }> = [
  { key: 'sdk', id: 'connect-sdk', label: 'Report button' },
  { key: 'editor', id: 'connect-studio', label: 'Editor' },
  { key: 'github', id: 'connect-github', label: 'GitHub' },
]

/** The step a link opens. SDK health links land on the report button until there is an SDK to check. */
function stepForHash(hash: string, sdkHealthShown: boolean): StepKey | null {
  const id = hash.replace(/^#/, '')
  if (id === 'connect-sdk' || (id === SDK_HEALTH_ANCHOR && !sdkHealthShown)) return 'sdk'
  if (id === 'connect-studio' || id === 'connect-client-picker') return 'editor'
  if (id === 'connect-github') return 'github'
  return null
}

function repoSlug(url: string | null): string | null {
  if (!url) return null
  return url.replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\.git$/, '')
}

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

function isNativeProject(project: ProjectRow | null): boolean {
  const nativePkgs = ['@mushi-mushi/react-native', '@mushi-mushi/capacitor']
  return Boolean(project?.sdk_package && nativePkgs.some((p) => project.sdk_package?.includes(p)))
}

function NativeCiSection({
  project,
  showSectionDescriptions,
}: {
  project: ProjectRow | null
  showSectionDescriptions: boolean
}) {
  if (!project || !isNativeProject(project)) return null

  return (
    <div id="connect-native-ci" className="scroll-mt-chrome">
      <Section title="Native app CI secrets">
        <SectionDescription when={showSectionDescriptions}>
          Detects missing compile-time env vars and can sync them to GitHub Actions.
        </SectionDescription>
        <SdkNativeConnectivityCard projectId={project.id} projectSlug={project.slug} />
      </Section>
    </div>
  )
}

export function ConnectPage() {
  const copy = usePageCopy('/connect')
  const connectUx = useConnectUx()
  const showSectionDescriptions = connectUx.hideConnectSnapshot
  usePublishPageContext({
    route: '/connect',
    title: 'Connect',
  })
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const activeProjectId = useActiveProjectId()
  const projectsFeed = usePageData<ProjectsPayload>('/v1/admin/projects')
  const mcpStatsQuery = usePageData<McpStats>('/v1/admin/mcp/stats')
  const mcpStats = mcpStatsQuery.data ?? EMPTY_MCP_STATS
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
  // Plain English, never "Request failed (NETWORK_ERROR)" (QA bug 262).
  const feedErrorText = useMemo(() => {
    const h = humanizeApiError(feedError)
    return h ? `${h.title} ${h.hint}` : null
  }, [feedError])

  const fallbackGithubRepoUrl = project?.primary_repo?.repo_url ?? null
  const github = useGithubConnection(activeProjectId, preflight, fallbackGithubRepoUrl)
  // SDK keys only: an MCP or CLI key's heartbeat is not the app checking in.
  const sdkLastSeenAt = latestHeartbeatAt(project?.api_keys?.filter((k) => isSdkKeyScopes(k.scopes)))
  const stepsLoading = (projectsFeed.loading && !project) || mcpStatsQuery.loading
  const editor = mcpStatsQuery.data ? connectedEditor(mcpStats) : null
  // An app that only has SDK keys is set up correctly; MCP is an optional extra for the editor.
  const mcpOptional = mcpStats.topPriority === 'report_only_keys' || mcpStats.topPriority === 'no_mcp_key'
  const pills = connectPills({
    sdkLastSeenAt,
    sdkVersion: project?.sdk_version ?? null,
    sdkLatestVersion: project?.sdk_latest_version ?? null,
    sdkStatus: project?.sdk_status ?? null,
    mcpStats,
  })
  const pillValue = (id: 'heartbeat' | 'editor') => pills.find((p) => p.id === id)?.value ?? ''

  // The Update center and SDK health need an SDK to look at: until the app checks in, the report
  // button step is the whole story (fresh-account walk, 2026-11-24: 44 tabs on a brand-new app).
  const sdkCheckedIn = Boolean(project) && Boolean(sdkLastSeenAt)
  const done: Record<StepKey, boolean> = {
    sdk: Boolean(sdkLastSeenAt),
    editor: Boolean(editor),
    github: github.hasGithub,
  }
  const firstOpen = CONNECT_STEPS.find((s) => !done[s.key])?.key ?? null
  const hashStep = stepForHash(location.hash, sdkCheckedIn)
  // A click opens or closes a step until the next navigation; a link's #hash wins over the
  // default, which is the first step not done yet (none once all three are).
  const [choice, setChoice] = useState<{ nav: string; step: StepKey | null } | null>(null)
  const chosen = choice && choice.nav === location.key ? choice.step : undefined
  const expanded = chosen !== undefined ? chosen : hashStep ?? (stepsLoading ? null : firstOpen)

  // A fresh load of /connect#connect-sdk-health ran the layout's hash scroll
  // before the sections above had their height, and stayed at the top.
  useScrollToHash(!projectsFeed.loading && !mcpStatsQuery.loading)

  const fallback = (
    <ProjectFallbackNote pending={projectPending} missing={projectMissing} hasError={Boolean(feedError)} />
  )

  const summary: Record<StepKey, string> = {
    sdk: done.sdk ? `App checked in ${pillValue('heartbeat')}` : 'Lets users report bugs in one tap',
    editor: stepsLoading
      ? 'Checking…'
      : done.editor
        ? pillValue('editor')
        : 'Lets your editor read each bug',
    github: github.loading
      ? 'Checking…'
      : done.github
        ? repoSlug(github.repoUrl) ?? 'Connected'
        : 'Lets fixes open pull requests',
  }

  const body: Record<StepKey, ReactNode> = {
    sdk: (
      <>
        <SectionDescription when={showSectionDescriptions}>
          Add the Mushi Mushi SDK to your app so users can report bugs in one tap.
        </SectionDescription>
        {project && isExpoReporterNeverConnected(project) ? (
          <HelpBanner
            tone="warn"
            title="Your store builds have not checked in yet"
            icon={<IconAlertTriangle className="h-5 w-5 text-warn-foreground" />}
            className="mb-3"
          >
            <p className="text-xs leading-relaxed">
              Keys exist but no store build has checked in. Set{' '}
              <code className="font-mono text-2xs">EXPO_PUBLIC_MUSHI_*</code> in your app&apos;s
              env file and as GitHub repo variables or secrets, then run a store build: an OTA
              update cannot add build-time env.
            </p>
            <Link
              to={`/onboarding?tab=diagnose&project=${project.id}`}
              className={`mt-2 inline-block text-xs ${LINK_ACCENT}`}
            >
              Open Setup Copilot → CI &amp; store builds
            </Link>
          </HelpBanner>
        ) : null}
        {project ? (
          // Embedded: the step is the one frame; the SDK card and the key box
          // inside it drew two more (fresh-eyes 2026-11-18).
          <SdkInstallCard projectId={project.id} projectSlug={project.slug} compact embedded />
        ) : (
          fallback
        )}
      </>
    ),
    editor: (
      <>
        <ConnectStudio
          projectId={project?.id ?? activeProjectId}
          projectName={project?.name}
          connectedEditor={editor}
        />
        {/* One line: Kenji above already says why (round-3 review, 2026-11-19). */}
        {mcpOptional && project ? (
          <p className="mt-2 text-xs text-fg-muted" data-testid="connect-mcp-optional">
            <Link
              to={mintMcpKeyHref(project.id)}
              className={LINK_ACCENT}
              title="Optional. An MCP key with mcp:read lets your editor's coding agent read this app's reports. Your SDK key only sends bug reports, which is all the app needs."
            >
              Add an MCP key
            </Link>{' '}
            (optional) so your editor can read these reports.
          </p>
        ) : null}
      </>
    ),
    github: (
      <>
        <SectionDescription when={showSectionDescriptions}>
          Connect your repository to enable one-click upgrade PRs and autofix.
        </SectionDescription>
        <GithubConnectionCard projectId={activeProjectId} preflight={preflight} fallbackRepoUrl={fallbackGithubRepoUrl} />
      </>
    ),
  }

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-connect">
      <PageHeaderBar
        title={copy?.title ?? 'Connect'}
        icon={<IconLink />}
        description={
          copy?.description ??
          'Connect your app, one step at a time.'
        }
        helpTitle={copy?.help?.title ?? 'About Connect'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'Where your app connects to Mushi Mushi: the report button in your app, your editor, and your GitHub repo. Once the app checks in, it also keeps the SDK current.'
        }
        helpUseCases={
          copy?.help?.useCases ?? [
            'First-time setup: add the report button, then connect Cursor or Claude Code, then GitHub',
            'Upgrade path: "Create Upgrade PR" bumps @mushi-mushi/* to latest npm',
            'Check why bug reports stopped arriving: SDK health lists each problem with a fix',
          ]
        }
        helpHowToUse={
          copy?.help?.howToUse ??
          'Do the open step; the next one opens when it is done. Press Change on a done step to redo it.'
        }
      />

      <PagePosture
        slots={[
          {
            id: 'connect-mcp-problem',
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            show: mcpStats.topPriority === 'endpoint_mismatch' || mcpStats.topPriority === 'never_connected',
            children: <McpStatusBanner stats={mcpStats} plainBanner />,
          },
        ]}
      />

      {/* The field guide's next step, once the MCP state is known. */}
      {mcpStatsQuery.data && !mcpStatsQuery.loading ? (
        <Mascot {...editorConnectGuide(mcpStats.topPriority, { appCheckedIn: Boolean(sdkLastSeenAt) })} size="sm" data-testid="connect-editor-guide" />
      ) : null}

      {feedError && (
        <HelpBanner
          tone="danger"
          role="alert"
          title="Couldn't load your apps"
          icon={<IconAlertTriangle className="h-4 w-4 text-danger-foreground" />}
        >
          <p className="text-xs">{feedErrorText}</p>
          <Btn size="sm" variant="ghost" className="mt-2" onClick={() => projectsFeed.reload()}>
            Retry
          </Btn>
        </HelpBanner>
      )}

      <ol className="divide-y divide-edge-subtle rounded-md border border-edge-subtle bg-surface" aria-label="Connect your app" data-testid="connect-steps">
        {CONNECT_STEPS.map((step, i) => {
          const open = expanded === step.key
          const isDone = done[step.key]
          const isNext = !isDone && firstOpen === step.key
          const mark: RunStatus = isDone ? 'passed' : isNext ? 'waiting' : 'idle'
          return (
            <li key={step.key} id={step.id} className="scroll-mt-chrome" data-step={step.key} data-done={isDone || undefined}>
              {/* SDK health links land here until there is an SDK to check. */}
              {step.key === 'sdk' && !sdkCheckedIn ? <span id={SDK_HEALTH_ANCHOR} className="block" aria-hidden="true" /> : null}
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`${step.id}-body`}
                onClick={() => setChoice({ nav: location.key, step: open ? null : step.key })}
                className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
              >
                <StatusMark status={mark} />
                <span className="shrink-0 text-xs font-semibold text-fg">{`${i + 1}. ${step.label}`}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{summary[step.key]}</span>
                <span className="shrink-0 text-2xs font-semibold text-brand">
                  {open ? 'Hide' : isDone ? 'Change' : isNext ? 'Start' : 'Open'}
                </span>
              </button>
              {open ? (
                <div id={`${step.id}-body`} className="border-t border-edge-subtle px-3 py-3">
                  {body[step.key]}
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>

      {project && sdkCheckedIn ? (
        <SdkUpkeep project={project} preflight={preflight} showSectionDescriptions={showSectionDescriptions} />
      ) : null}

      <NativeCiSection project={project} showSectionDescriptions={showSectionDescriptions} />
    </div>
  )
}

/**
 * The Update center and SDK health, once the app has checked in. When the SDK
 * is current and nothing is wrong this is one line, with the detail a click
 * away (ADR 0069); otherwise both sections show, side by side on a wide screen.
 */
function SdkUpkeep({
  project,
  preflight,
  showSectionDescriptions,
}: {
  project: ProjectRow
  preflight: ReturnType<typeof useDispatchPreflight>
  showSectionDescriptions: boolean
}) {
  const [details, setDetails] = useState(false)
  const health = usePageData<SdkHealthPayload>(`/v1/admin/projects/${project.id}/sdk-health`)
  const behind = sdkIsBehind({
    sdkVersion: project.sdk_version ?? null,
    sdkLatestVersion: project.sdk_latest_version ?? null,
    sdkStatus: project.sdk_status ?? null,
  })
  const healthy =
    Boolean(project.sdk_version) &&
    !behind &&
    Boolean(health.data) &&
    (health.data?.problems.length ?? 0) === 0 &&
    (health.data?.notes.length ?? 0) === 0

  if (healthy && !details) {
    return (
      <div
        id={SDK_HEALTH_ANCHOR}
        className="scroll-mt-chrome flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-edge-subtle px-3 py-2"
        data-testid="connect-sdk-ok"
      >
        <StatusMark status="passed" />
        <span className="min-w-0 flex-1 text-xs text-fg-secondary">
          <span className="font-semibold text-fg">SDK {project.sdk_version}</span> is up to date. Nothing is stopping bug reports.
        </span>
        <button
          type="button"
          aria-expanded={false}
          onClick={() => setDetails(true)}
          className="text-2xs font-semibold text-brand hover:underline"
        >
          Details
        </button>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
      <div id="connect-update" className="scroll-mt-chrome min-w-0">
        <Section title="Update center">
          <SectionDescription when={showSectionDescriptions}>
            Keep the Mushi Mushi SDK up to date in your connected repository. A one-click PR bumps only
            @mushi-mushi/* version strings — you review and merge.
          </SectionDescription>
          <UpdateCenter project={project} preflight={preflight} />
        </Section>
      </div>
      <div id={SDK_HEALTH_ANCHOR} className="scroll-mt-chrome min-w-0">
        <Section title="SDK health">
          <SectionDescription when={showSectionDescriptions}>
            Problems that stop bug reports from arriving, each with a fix.
          </SectionDescription>
          <SdkHealthPanel projectId={project.id} nativeApp={isNativeProject(project)} bare />
        </Section>
      </div>
    </div>
  )
}
