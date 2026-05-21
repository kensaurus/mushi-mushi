/**
 * FILE: apps/admin/src/pages/McpPage.tsx
 * PURPOSE: MCP setup console — key readiness, copy-paste snippets, and tool catalog
 *          for the active project.
 */

import { Link, useSearchParams } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PageHeader,
  PageHelp,
  Section,
  Card,
  Badge,
  Btn,
  ErrorAlert,
  StatCard,
  SegmentedControl,
  CopyButton,
  FreshnessPill,
  RecommendedAction,
  RelativeTime,
} from '../components/ui'
import { IconIntegrations, IconCheck, IconArrowRight } from '../components/icons'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { usePageData } from '../lib/usePageData'
import { useRealtimeReload } from '../lib/realtime'
import { usePublishPageContext } from '../lib/pageContext'
import { useSetupStatus } from '../lib/useSetupStatus'
import { SetupNudge } from '../components/SetupNudge'
import { useToast } from '../lib/toast'
import { usePageCopy } from '../lib/copy'
import { useMcpUx, resolveQuickMcpTab } from '../lib/mcpModeUx'
import { SdkInstallCard } from '../components/SdkInstallCard'
import { ConfigHelp } from '../components/ConfigHelp'
import { detectFromPackageJson } from '../lib/frameworkDetect'
import { McpStatusBanner } from '../components/mcp/McpStatusBanner'
import { EMPTY_MCP_STATS } from '../components/mcp/types'
import type { CatalogTabId, McpProjectsResponse, McpStats, McpTabId } from '../components/mcp/types'
import {
  TOOL_CATALOG,
  RESOURCE_CATALOG,
  PROMPT_CATALOG,
  type ToolSpec,
  type McpScope,
} from '../lib/mcpCatalog'
import { PanelSkeleton } from '../components/skeletons/PanelSkeleton'

const TABS: Array<{ id: McpTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'MCP posture — key scopes, connection status, and recommended next steps for agent access.',
  },
  {
    id: 'setup',
    label: 'Setup',
    description: 'Mint a key, copy the snippet, and confirm your IDE sees all Mushi tools.',
  },
  {
    id: 'catalog',
    label: 'Catalog',
    description: 'Every tool, resource URI, and slash prompt the MCP server advertises.',
  },
  {
    id: 'examples',
    label: 'Examples',
    description: 'Real agent asks you can paste into Cursor or Claude Desktop today.',
  },
]

const CATALOG_TABS: Array<{ id: CatalogTabId; label: string }> = [
  { id: 'tools', label: 'Tools' },
  { id: 'resources', label: 'Resources' },
  { id: 'prompts', label: 'Prompts' },
]

const MUSHI_CLOUD_API = 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api'

interface UseCase {
  title: string
  ask: string
  calls: string[]
}

const USE_CASES: UseCase[] = [
  {
    title: 'Start my day',
    ask: 'What should I focus on right now?',
    calls: ['triage_next_steps', 'project://dashboard', 'get_recent_reports'],
  },
  {
    title: 'Fix a specific bug',
    ask: 'Fix rep_abc123.',
    calls: ['summarize_report_for_fix', 'get_fix_context', 'get_blast_radius', 'submit_fix_result'],
  },
  {
    title: 'Debug a failed fix',
    ask: 'Why did fix_xyz fail?',
    calls: ['get_fix_timeline', 'explain_judge_result'],
  },
  {
    title: 'Spot duplicates fast',
    ask: 'Have we seen a bug like this before in Checkout?',
    calls: ['get_similar_bugs'],
  },
  {
    title: 'Ask production data in English',
    ask: 'Which components had the most critical bugs this week?',
    calls: ['run_nl_query'],
  },
]

function resolveMcpTab(value: string | null): McpTabId {
  if (value === 'setup' || value === 'catalog' || value === 'examples') return value
  return 'overview'
}

function isCatalogTabId(v: string | null): v is CatalogTabId {
  return CATALOG_TABS.some((t) => t.id === v)
}

function scopeBadgeTone(scope: McpScope): string {
  return scope === 'mcp:write'
    ? 'bg-warn-muted text-warn border border-warn/30'
    : 'bg-info-muted text-info border border-info/30'
}

function hintBadges(spec: ToolSpec) {
  const chips: Array<{ label: string; tone: string; title: string }> = []
  if (spec.hints.readOnly) {
    chips.push({
      label: 'read-only',
      tone: 'bg-ok-muted text-ok border border-ok/30',
      title: 'Client can auto-approve. No side effects.',
    })
  } else {
    chips.push({
      label: 'writes',
      tone: 'bg-warn-muted text-warn border border-warn/30',
      title: 'Will mutate data. Your client should prompt for confirmation.',
    })
  }
  if (spec.hints.destructive) {
    chips.push({
      label: 'destructive',
      tone: 'bg-danger-muted text-danger border border-danger/30',
      title: 'Can remove data from triage queues. Confirm every call.',
    })
  }
  if (spec.hints.idempotent) {
    chips.push({
      label: 'idempotent',
      tone: 'bg-surface-overlay text-fg-muted border border-edge-subtle',
      title: 'Calling twice with the same args is safe.',
    })
  }
  return chips
}

function buildCursorJson(projectId: string, projectName: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [`mushi-${projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32)}`]: {
          command: 'npx',
          args: ['-y', '@mushi-mushi/mcp'],
          env: {
            MUSHI_API_ENDPOINT: MUSHI_CLOUD_API,
            MUSHI_API_KEY: 'paste-your-mushi-api-key-here',
            MUSHI_PROJECT_ID: projectId,
          },
        },
      },
    },
    null,
    2,
  )
}

function buildEnvBlock(projectId: string): string {
  return [
    '# Mushi MCP — paste into .env.local (gitignored).',
    `MUSHI_API_ENDPOINT=${MUSHI_CLOUD_API}`,
    'MUSHI_API_KEY=paste-your-mushi-api-key-here',
    `MUSHI_PROJECT_ID=${projectId}`,
    '',
  ].join('\n')
}

interface QuickstartStepProps {
  n: number
  title: string
  body: React.ReactNode
  tone: 'idle' | 'done' | 'next'
}

function QuickstartStep({ n, title, body, tone }: QuickstartStepProps) {
  const badgeTone =
    tone === 'done'
      ? 'bg-ok-muted text-ok border-ok/40'
      : tone === 'next'
        ? 'bg-brand text-brand-fg border-brand'
        : 'bg-surface-overlay text-fg-muted border-edge-subtle'
  return (
    <div className="flex gap-3 items-start">
      <span
        className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full border text-xs font-semibold ${badgeTone}`}
        aria-hidden="true"
      >
        {tone === 'done' ? <IconCheck className="h-3.5 w-3.5" /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-fg">{title}</div>
        <div className="text-xs text-fg-muted mt-0.5">{body}</div>
      </div>
    </div>
  )
}

function ToolCard({ tool }: { tool: ToolSpec }) {
  const stripeTone = tool.scope === 'mcp:write' ? 'bg-warn' : 'bg-info'
  return (
    <div className="relative rounded-md border border-edge-subtle bg-surface-raised/30 p-3 pl-4 motion-safe:transition-colors hover:border-edge">
      <span className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-sm ${stripeTone}`} aria-hidden="true" />
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-fg">{tool.title}</div>
          <code className="text-2xs text-fg-muted font-mono wrap-anywhere">{tool.name}</code>
        </div>
        <Badge className={scopeBadgeTone(tool.scope)}>{tool.scope}</Badge>
      </div>
      <div className="text-sm text-fg-secondary leading-snug mb-1">
        <span className="text-accent">“</span>
        {tool.useCase}
        <span className="text-accent">”</span>
      </div>
      <div className="text-xs text-fg-muted mb-2 leading-snug">{tool.description}</div>
      <div className="flex items-center gap-1 flex-wrap">
        {hintBadges(tool).map((chip) => (
          <Badge key={chip.label} className={chip.tone} title={chip.title}>
            {chip.label}
          </Badge>
        ))}
      </div>
    </div>
  )
}

export function McpPage() {
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null
  const copy = usePageCopy('/mcp')
  const ux = useMcpUx()
  const toast = useToast()

  const [searchParams, setSearchParams] = useSearchParams()
  const param = searchParams.get('tab')
  const activeTab: McpTabId = resolveMcpTab(param)
  const activeMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]
  const catalogParam = searchParams.get('catalog')
  const catalogTab: CatalogTabId = isCatalogTabId(catalogParam) ? catalogParam : 'tools'

  const [snippetMode, setSnippetMode] = useState<'cursor' | 'env'>('cursor')
  const [copied, setCopied] = useState(false)
  const [monorepoNote, setMonorepoNote] = useState<string | null>(null)
  const [monoWarnings, setMonoWarnings] = useState<string[]>([])
  const [detectOpen, setDetectOpen] = useState(false)
  const [detectText, setDetectText] = useState('')
  const detectTaRef = useRef<HTMLTextAreaElement>(null)

  const projectsPath = activeProjectId ? '/v1/admin/projects' : null
  const statsPath = activeProjectId ? '/v1/admin/mcp/stats' : null

  const projectsQuery = usePageData<McpProjectsResponse>(projectsPath, { deps: [activeProjectId] })
  const statsQuery = usePageData<McpStats>(statsPath, { deps: [activeProjectId] })

  const activeProject = useMemo(() => {
    if (!activeProjectId) return null
    return projectsQuery.data?.projects.find((p) => p.id === activeProjectId) ?? null
  }, [projectsQuery.data, activeProjectId])

  const stats = { ...EMPTY_MCP_STATS, ...statsQuery.data }

  const loading = projectsQuery.loading || statsQuery.loading
  const error = projectsQuery.error ?? statsQuery.error
  const lastFetchedAt = statsQuery.lastFetchedAt
  const isValidating = projectsQuery.isValidating || statsQuery.isValidating

  const reloadAll = useCallback(() => {
    projectsQuery.reload()
    statsQuery.reload()
  }, [projectsQuery, statsQuery])

  useRealtimeReload(['project_api_keys'], reloadAll)

  const setTab = useCallback(
    (tab: McpTabId) => {
      const next = new URLSearchParams(searchParams)
      if (tab === 'overview') next.delete('tab')
      else next.set('tab', tab)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  useEffect(() => {
    if (!ux.isQuickstart || !activeProjectId || loading) return
    const quickTab = resolveQuickMcpTab(stats)
    if (activeTab !== quickTab) setTab(quickTab)
  }, [ux.isQuickstart, activeProjectId, loading, stats, activeTab, setTab])

  const setCatalogTab = useCallback(
    (tab: CatalogTabId) => {
      const next = new URLSearchParams(searchParams)
      next.set('tab', 'catalog')
      if (tab === 'tools') next.delete('catalog')
      else next.set('catalog', tab)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  async function copySnippet(payload: string, label: string) {
    try {
      await navigator.clipboard.writeText(payload)
      setCopied(true)
      toast.success(`${label} copied.`)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Clipboard blocked — select the text and copy manually.')
    }
  }

  const projectId = activeProject?.id ?? activeProjectId ?? '<your-project-id>'
  const displayName = activeProject?.name ?? projectName ?? 'project'
  const snippet = snippetMode === 'cursor' ? buildCursorJson(projectId, displayName) : buildEnvBlock(projectId)

  const readTools = TOOL_CATALOG.filter((t) => t.scope === 'mcp:read')
  const writeTools = TOOL_CATALOG.filter((t) => t.scope === 'mcp:write')

  const hasReadKey = stats.mcpReadKeyCount > 0
  const hasWriteKey = stats.mcpWriteKeyCount > 0
  const step1Tone: QuickstartStepProps['tone'] = hasReadKey ? 'done' : 'next'
  const step2Tone: QuickstartStepProps['tone'] = hasReadKey ? (stats.connectedKeyCount > 0 ? 'done' : 'next') : 'idle'
  const step3Tone: QuickstartStepProps['tone'] = stats.connectedKeyCount > 0 ? 'done' : hasReadKey ? 'next' : 'idle'

  usePublishPageContext({
    route: '/mcp',
    title: `${activeMeta.label} · MCP`,
    summary: activeMeta.description,
    filters: { tab: activeTab, catalog: catalogTab, project_id: activeProjectId ?? undefined },
    criticalCount: stats.neverConnectedCount + (stats.endpointMismatch ? 1 : 0),
  })

  const tabOptions = useMemo(
    () => [
      { id: 'overview' as const, label: copy?.tabLabels?.overview ?? 'Overview' },
      { id: 'setup' as const, label: copy?.tabLabels?.setup ?? 'Setup' },
      { id: 'catalog' as const, label: copy?.tabLabels?.catalog ?? 'Catalog', count: stats.toolCount },
      { id: 'examples' as const, label: copy?.tabLabels?.examples ?? 'Examples' },
    ],
    [copy?.tabLabels, stats.toolCount],
  )

  const catalogOptions = useMemo(
    () => [
      { id: 'tools' as const, label: 'Tools', count: stats.toolCount },
      { id: 'resources' as const, label: 'Resources', count: stats.resourceCount },
      { id: 'prompts' as const, label: 'Prompts', count: stats.promptCount },
    ],
    [stats.toolCount, stats.resourceCount, stats.promptCount],
  )

  if (!activeProjectId) {
    return (
      <div className="space-y-4" data-testid="mushi-page-mcp">
        <PageHelp
          title={copy?.help?.title ?? 'About MCP'}
          whatIsIt={
            copy?.help?.whatIsIt ??
            'MCP lets your coding assistant call Mushi tools during a chat — read reports, dispatch fixes, and query production data without copy-pasting IDs.'
          }
          useCases={
            copy?.help?.useCases ?? [
              'Ask Cursor "what should I fix next?" and get an answer from your real bugs',
              'Have the agent draft a fix for a specific report in one command',
              'Query your bug data in plain English from inside your editor',
            ]
          }
          howToUse={
            copy?.help?.howToUse ??
            '1. On /projects, pick MCP read-only or read + write scope. 2. Copy the snippet on Setup. 3. Restart your IDE. 4. Ask "list mushi tools".'
          }
        />
        <PageHeader
          title={copy?.title ?? 'MCP'}
          description={
            copy?.description ??
            'Connect Cursor, Claude Desktop, or any MCP-aware agent to this project\'s live triage queue.'
          }
        />
        <SetupNudge
          requires={['project']}
          emptyTitle="Select a project"
          emptyDescription="MCP keys and snippets are scoped to the active project in the header."
        />
      </div>
    )
  }

  if (loading) return <PanelSkeleton rows={5} label="Loading MCP setup" />
  if (error) {
    return (
      <ErrorAlert message={`Failed to load MCP setup: ${error}`} onRetry={reloadAll} />
    )
  }

  const bannerSeverity: 'ok' | 'warn' | 'danger' | 'brand' | 'info' | 'neutral' =
    stats.topPriority === 'endpoint_mismatch' || stats.topPriority === 'never_connected'
      ? 'warn'
      : stats.topPriority === 'healthy'
        ? 'ok'
        : stats.topPriority === 'report_only_keys' || stats.topPriority === 'no_mcp_key'
          ? 'brand'
          : 'neutral'

  const headerBadge =
    stats.topPriority === 'healthy'
      ? 'CONNECTED'
      : stats.topPriority === 'endpoint_mismatch'
        ? 'MISMATCH'
        : stats.topPriority === 'never_connected'
          ? 'NO HANDSHAKE'
          : stats.topPriority === 'report_only_keys'
            ? 'SDK ONLY'
            : stats.topPriority === 'no_mcp_key'
              ? 'NO MCP KEY'
              : 'SETUP'

  return (
    <div className="space-y-4" data-testid="mushi-page-mcp">
      <PageHelp
        title={copy?.help?.title ?? 'About MCP'}
        whatIsIt={
          copy?.help?.whatIsIt ??
          'MCP lets your coding assistant call Mushi tools during a chat — read reports, dispatch fixes, and query production data without copy-pasting IDs.'
        }
        useCases={
          copy?.help?.useCases ?? [
            'Ask Cursor "what should I fix next?" and get an answer from your real bugs',
            'Have the agent draft a fix for a specific report in one command',
            'Query your bug data in plain English from inside your editor',
          ]
        }
        howToUse={
          copy?.help?.howToUse ??
          '1. On /projects, pick MCP read-only or read + write scope. 2. Copy the snippet on Setup. 3. Restart your IDE. 4. Ask "list mushi tools".'
        }
      />

      <PageHeader
        title={copy?.title ?? 'MCP'}
        description={
          copy?.description ??
          'Banner + MCP SNAPSHOT — Overview for posture, Setup for snippet, Catalog for tools.'
        }
        projectScope={displayName}
      >
        {!ux.hideOverviewChrome && (
          <>
            <Badge
              className={
                bannerSeverity === 'ok'
                  ? 'bg-ok-muted text-ok'
                  : bannerSeverity === 'warn'
                    ? 'bg-warn/10 text-warn'
                    : bannerSeverity === 'brand'
                      ? 'bg-brand/15 text-brand'
                      : 'bg-surface-overlay text-fg-muted'
              }
            >
              {headerBadge}
            </Badge>
            <FreshnessPill at={lastFetchedAt} isValidating={isValidating} />
            <Btn size="sm" variant="ghost" onClick={reloadAll} loading={isValidating}>
              Refresh
            </Btn>
            <Link to="/projects">
              <Btn variant="ghost" size="sm" data-testid="mcp-mint-key-link">
                Generate an API key
              </Btn>
            </Link>
          </>
        )}
      </PageHeader>

      <McpStatusBanner
        stats={stats}
        onTab={setTab}
        onRefresh={reloadAll}
        refreshing={isValidating}
        plainBanner={ux.plainBanner}
      />

      {!ux.hideTabs && (
      <SegmentedControl
        value={activeTab}
        onChange={setTab}
        options={tabOptions}
        ariaLabel="MCP sections"
        size="sm"
      />
      )}

      {!ux.hideMcpSnapshot && (
      <Section title={copy?.sections?.snapshot ?? 'MCP SNAPSHOT'} freshness={{ at: lastFetchedAt, isValidating }}>
        <p className="mb-3 text-2xs text-fg-muted">{activeMeta.description}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label={copy?.statLabels?.activeKeys ?? 'Active keys'} value={stats.activeKeyCount} accent={stats.activeKeyCount > 0 ? 'text-brand' : undefined} hint="All scopes on this project" />
          <StatCard
            label={copy?.statLabels?.mcpRead ?? 'mcp:read'}
            value={stats.mcpReadKeyCount}
            accent={stats.mcpReadKeyCount > 0 ? 'text-ok' : 'text-warn'}
            hint={stats.mcpWriteKeyCount > 0 ? `${stats.mcpWriteKeyCount} write` : 'Mint on /projects'}
          />
          <StatCard
            label={copy?.statLabels?.connected ?? 'Connected'}
            value={stats.connectedKeyCount}
            accent={stats.connectedKeyCount > 0 ? 'text-ok' : stats.mcpReadKeyCount > 0 ? 'text-warn' : undefined}
            hint={stats.neverConnectedCount > 0 ? `${stats.neverConnectedCount} never used` : 'Keys with heartbeat'}
          />
          <StatCard
            label={copy?.statLabels?.sdkOnly ?? 'SDK-only keys'}
            value={stats.reportOnlyKeyCount}
            accent={stats.reportOnlyKeyCount > 0 && stats.mcpReadKeyCount === 0 ? 'text-warn' : undefined}
            hint="report:write without MCP scope"
          />
          <StatCard label={copy?.statLabels?.tools ?? 'Tools'} value={stats.toolCount} accent="text-info" hint={`${stats.resourceCount} resources · ${stats.promptCount} prompts`} />
          <StatCard
            label={copy?.statLabels?.endpoint ?? 'Endpoint'}
            value={stats.endpointMismatch ? 'Mismatch' : stats.lastSeenAt ? 'OK' : '—'}
            accent={stats.endpointMismatch ? 'text-danger' : stats.lastSeenAt ? 'text-ok' : undefined}
            hint={stats.expectedEndpointHost ?? 'Cloud API host'}
          />
        </div>
      </Section>
      )}

      {!ux.hideOverviewChrome && stats.topPriority !== 'healthy' && stats.topPriorityTo && activeTab === 'overview' ? (
        <Card
          className={`p-4 ${
            stats.topPriority === 'endpoint_mismatch' || stats.topPriority === 'never_connected'
              ? 'border-warn/30 bg-warn/5'
              : 'border-brand/30 bg-brand/5'
          }`}
        >
          <p className="text-xs font-medium text-fg-primary">{stats.topPriorityLabel}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">Take action →</Btn>
            </Link>
          </div>
        </Card>
      ) : null}

      {activeTab === 'overview' && (
        <div className="space-y-4">
          {!ux.hideOverviewChrome && (
          <>
          {stats.topPriority === 'healthy' && (
            <RecommendedAction
              tone="success"
              title="Agent access live"
              description={stats.topPriorityLabel ?? `${stats.connectedKeyCount} MCP key(s) connected with heartbeat.`}
              cta={{ label: 'Browse catalog', to: '/mcp?tab=catalog' }}
            />
          )}
          {stats.topPriority === 'report_only_keys' && (
            <RecommendedAction
              tone="info"
              title="SDK keys exist — add MCP scope"
              description={stats.topPriorityLabel ?? 'report:write keys capture bugs but cannot expose tools to agents.'}
              cta={{ label: 'Mint MCP key', to: '/projects' }}
            />
          )}
          {stats.topPriority === 'no_mcp_key' && (
            <RecommendedAction
              tone="info"
              title="Generate your first MCP key"
              description={stats.topPriorityLabel ?? 'Pick mcp:read to browse or mcp:write to dispatch fixes from agents.'}
              cta={{ label: 'Go to /projects', to: '/projects' }}
            />
          )}
          {stats.topPriority === 'never_connected' && (
            <RecommendedAction
              tone="info"
              title="Complete the IDE handshake"
              description={stats.topPriorityLabel ?? 'Paste .cursor/mcp.json, restart, then run "list mushi tools".'}
              cta={{ label: 'Open Setup', to: '/mcp?tab=setup' }}
            />
          )}
          {stats.topPriority === 'endpoint_mismatch' && (
            <RecommendedAction
              tone="urgent"
              title="Fix MUSHI_API_ENDPOINT in snippet"
              description={stats.topPriorityLabel ?? 'Agent is hitting a different backend than this console expects.'}
              cta={{ label: 'Copy correct snippet', to: '/mcp?tab=setup' }}
            />
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="p-3 border-edge">
              <p className="text-3xs font-medium uppercase tracking-wide text-fg-faint">Read scope</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-fg-primary">{stats.mcpReadKeyCount}</p>
              <p className="text-2xs text-fg-muted">Required to list tools + read triage</p>
            </Card>
            <Card className="p-3 border-edge">
              <p className="text-3xs font-medium uppercase tracking-wide text-fg-faint">Write scope</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-warn">{stats.mcpWriteKeyCount}</p>
              <p className="text-2xs text-fg-muted">Optional — dispatch fixes from agents</p>
            </Card>
            <Card className="p-3 border-edge">
              <p className="text-3xs font-medium uppercase tracking-wide text-fg-faint">Last heartbeat</p>
              <p className="mt-1 text-sm font-semibold text-fg-primary">
                {stats.lastSeenAt ? <RelativeTime value={stats.lastSeenAt} /> : 'Never'}
              </p>
              <p className="text-2xs text-fg-muted font-mono truncate" title={stats.lastSeenEndpointHost ?? undefined}>
                {stats.lastSeenEndpointHost ?? 'No MCP traffic yet'}
              </p>
            </Card>
          </div>
          </>
          )}
        </div>
      )}

      {activeTab !== 'overview' && (
      <Section title={activeTab === 'setup' ? 'Agent setup' : activeTab === 'catalog' ? 'Tool catalog' : 'Agent examples'}>
        <p className="mb-4 text-2xs text-fg-muted">{activeMeta.description}</p>

        {activeTab === 'setup' && (
          <div className="space-y-4" data-dav-anchor="mcp:decide">
            <Card className="p-5 space-y-4" data-testid="mcp-quickstart">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-fg-muted [&>svg]:h-4 [&>svg]:w-4"><IconIntegrations /></span>
                  <h3 className="text-sm font-semibold text-fg">Get an agent talking in 60 seconds</h3>
                </div>
                <div className="flex items-center gap-1.5" data-testid="mcp-status-strip">
                  <Badge
                    className={
                      hasReadKey
                        ? 'bg-ok-muted text-ok border border-ok/30'
                        : 'bg-surface-overlay text-fg-muted border border-edge-subtle'
                    }
                    data-testid="mcp-read-status"
                  >
                    {hasReadKey ? 'mcp:read ✓' : 'mcp:read —'}
                  </Badge>
                  <Badge
                    className={
                      hasWriteKey
                        ? 'bg-ok-muted text-ok border border-ok/30'
                        : 'bg-surface-overlay text-fg-muted border border-edge-subtle'
                    }
                    data-testid="mcp-write-status"
                  >
                    {hasWriteKey ? 'mcp:write ✓' : 'mcp:write —'}
                  </Badge>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <QuickstartStep
                  n={1}
                  tone={step1Tone}
                  title="Generate an API key"
                  body={
                    hasReadKey ? (
                      <span>
                        <span className="text-ok">{stats.mcpReadKeyCount} MCP key{stats.mcpReadKeyCount === 1 ? '' : 's'}</span>{' '}
                        on <span className="font-mono text-fg-secondary">{displayName}</span>.
                      </span>
                    ) : (
                      <span>
                        Pick <span className="text-fg">MCP read</span> to browse or{' '}
                        <span className="text-fg">MCP read + write</span> to dispatch fixes.
                      </span>
                    )
                  }
                />
                <QuickstartStep
                  n={2}
                  tone={step2Tone}
                  title="Paste the snippet"
                  body={
                    <>
                      Drop the <span className="font-mono text-fg-secondary">.cursor/mcp.json</span> block into your IDE, then restart.
                    </>
                  }
                />
                <QuickstartStep
                  n={3}
                  tone={step3Tone}
                  title="Ask the agent"
                  body={
                    <>
                      Type <span className="font-mono text-fg-secondary">"list mushi tools"</span> — expect {stats.toolCount} tools.
                    </>
                  }
                />
              </div>

              {!hasReadKey && (
                <div className="pt-1">
                  <Link to="/projects">
                    <Btn size="sm" data-testid="mcp-status-mint">
                      Generate a key on /projects
                      <IconArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Btn>
                  </Link>
                </div>
              )}
            </Card>

            <Card className="p-5 space-y-4" data-testid="mcp-install">
              <div>
                <h3 className="text-sm font-semibold text-fg">Configuration values</h3>
                <p className="text-xs text-fg-muted mt-1">
                  Three env vars wire the MCP binary to <span className="font-mono text-fg-secondary">{displayName}</span>.
                </p>
              </div>

              <div className="rounded-md border border-edge-subtle bg-surface-raised/40">
                <button
                  type="button"
                  onClick={() => {
                    setDetectOpen((v) => !v)
                    if (!detectOpen) setTimeout(() => detectTaRef.current?.focus(), 50)
                  }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-surface-overlay rounded-md transition-colors"
                  aria-expanded={detectOpen}
                >
                  <span className="font-medium text-fg">Detect monorepo / workspace (optional)</span>
                  <span className="text-fg-faint text-2xs" aria-hidden>{detectOpen ? '▲ hide' : '▼ paste package.json'}</span>
                </button>
                {detectOpen && (
                  <div className="px-3 pb-3 pt-1 space-y-2">
                    <p className="text-2xs text-fg-muted leading-snug">
                      Paste your <code className="font-mono">package.json</code> for monorepo install guidance.
                    </p>
                    <textarea
                      ref={detectTaRef}
                      value={detectText}
                      onChange={(e) => setDetectText(e.target.value)}
                      placeholder={'{\n  "workspaces": ["apps/*", "packages/*"],\n  ...\n}'}
                      className="w-full h-28 font-mono text-2xs bg-surface-raised border border-edge-subtle rounded-sm px-2 py-1.5 text-fg-secondary focus:outline-none focus:ring-1 focus:ring-brand resize-y placeholder:text-fg-faint"
                      spellCheck={false}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={!detectText.trim()}
                        onClick={() => {
                          const result = detectFromPackageJson(detectText)
                          const globalNote = result.monorepo
                            ? `Detected ${result.monorepo} monorepo.\n\n@mushi-mushi/mcp is a global CLI — install once:\n\n  npm install -g @mushi-mushi/mcp\n\nOr run on demand:\n\n  npx -y @mushi-mushi/mcp@latest`
                            : null
                          setMonorepoNote(globalNote)
                          setMonoWarnings(result.warnings)
                          setDetectOpen(false)
                        }}
                        className="px-3 py-1 rounded-sm text-xs font-medium bg-brand text-brand-fg hover:bg-brand-hover disabled:opacity-40 transition-colors"
                      >
                        Detect
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDetectText('')
                          setDetectOpen(false)
                          setMonorepoNote(null)
                          setMonoWarnings([])
                        }}
                        className="px-2 py-1 rounded-sm text-xs text-fg-muted hover:text-fg transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {!detectOpen && (monorepoNote || monoWarnings.length > 0) && (
                  <div className="px-3 pb-3 space-y-1.5">
                    {monorepoNote && (
                      <div className="rounded-sm border border-info/30 bg-info-muted/10 px-2 py-1.5">
                        <p className="text-2xs text-info font-semibold mb-0.5">Monorepo install guidance</p>
                        <pre className="text-2xs text-fg-secondary whitespace-pre-wrap font-mono leading-snug">{monorepoNote}</pre>
                      </div>
                    )}
                    {monoWarnings.map((w, i) => (
                      <p key={i} className="text-2xs text-warn flex gap-1">
                        <span aria-hidden>⚠</span>
                        <span>{w}</span>
                      </p>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setMonorepoNote(null)
                        setMonoWarnings([])
                      }}
                      className="text-3xs text-fg-faint hover:text-fg-muted"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1 border-b border-edge-subtle pb-2">
                <ConfigHelp helpId="mcp.snippet_mode" />
                {(['cursor', 'env'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setSnippetMode(m)}
                    data-testid={`mcp-snippet-mode-${m}`}
                    className={`px-2.5 py-1 rounded-sm text-xs transition-colors ${
                      snippetMode === m
                        ? 'bg-brand text-brand-fg font-medium'
                        : 'text-fg-muted hover:text-fg hover:bg-surface-overlay'
                    }`}
                  >
                    {m === 'cursor' ? '.cursor/mcp.json' : '.env.local'}
                  </button>
                ))}
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <span className="text-2xs text-fg-muted uppercase tracking-wider font-medium">
                    {snippetMode === 'cursor' ? 'Drop into your IDE settings' : 'Drop into your repo root'}
                  </span>
                  <CopyButton
                    onCopy={() =>
                      copySnippet(
                        snippet,
                        snippetMode === 'cursor' ? '.cursor/mcp.json block' : '.env.local block',
                      )
                    }
                    copied={copied}
                    label={snippetMode === 'cursor' ? 'Copy .cursor/mcp.json block' : 'Copy .env.local block'}
                    copiedLabel="Snippet copied"
                    data-testid="mcp-snippet-copy"
                  />
                </div>
                <pre
                  className="bg-surface-raised border border-edge-subtle rounded-sm px-3 py-2 mt-1 text-2xs font-mono text-fg-secondary overflow-auto whitespace-pre-wrap wrap-anywhere max-h-64 select-all"
                  data-testid="mcp-snippet"
                >
                  {snippet}
                </pre>
              </div>
            </Card>

            {activeProjectId && (
              <Card className="p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-fg">Or wire end users to this project</h3>
                  <p className="text-xs text-fg-muted mt-1">
                    MCP connects coding agents. The bug-capture SDK connects real users in your app.
                  </p>
                </div>
                <SdkInstallCard projectId={activeProjectId} compact />
              </Card>
            )}
          </div>
        )}

        {activeTab === 'catalog' && (
          <div className="space-y-4" data-dav-anchor="mcp:verify">
            <SegmentedControl
              value={catalogTab}
              onChange={setCatalogTab}
              options={catalogOptions}
              ariaLabel="MCP catalog sections"
            />

            {catalogTab === 'tools' && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-2xs text-fg-muted uppercase tracking-wider font-medium mb-2">
                    Read — always safe to loop on ({readTools.length})
                  </h4>
                  <div className="grid gap-2 md:grid-cols-2" data-testid="mcp-tool-catalog-read">
                    {readTools.map((tool) => (
                      <ToolCard key={tool.name} tool={tool} />
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-2xs text-fg-muted uppercase tracking-wider font-medium mb-2">
                    Write — mutate project state ({writeTools.length})
                  </h4>
                  <div className="grid gap-2 md:grid-cols-2" data-testid="mcp-tool-catalog-write">
                    {writeTools.map((tool) => (
                      <ToolCard key={tool.name} tool={tool} />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {catalogTab === 'resources' && (
              <div className="space-y-2" data-testid="mcp-resource-catalog">
                {RESOURCE_CATALOG.map((r) => (
                  <div
                    key={r.name}
                    className="rounded-md border border-edge-subtle bg-surface-raised/30 p-3 motion-safe:transition-colors hover:border-edge"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <code className="text-xs font-mono text-fg wrap-anywhere">{r.uri}</code>
                      <Badge className={scopeBadgeTone(r.scope)}>{r.scope}</Badge>
                    </div>
                    <div className="text-xs text-fg-muted leading-snug">{r.description}</div>
                  </div>
                ))}
              </div>
            )}

            {catalogTab === 'prompts' && (
              <div className="space-y-2" data-testid="mcp-prompt-catalog">
                {PROMPT_CATALOG.map((p) => (
                  <div
                    key={p.name}
                    className="rounded-md border border-edge-subtle bg-surface-raised/30 p-3 motion-safe:transition-colors hover:border-edge"
                  >
                    <div className="text-sm font-semibold text-fg">{p.title}</div>
                    <code className="text-2xs text-fg-muted font-mono block mt-0.5 mb-1">/{p.name}</code>
                    <div className="text-xs text-fg-muted leading-snug">{p.description}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'examples' && (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="mcp-use-cases">
            {USE_CASES.map((uc) => (
              <div
                key={uc.title}
                className="rounded-md border border-edge-subtle bg-surface-raised/30 p-3 space-y-2 motion-safe:transition-colors hover:border-edge"
              >
                <div className="text-xs font-semibold text-fg">{uc.title}</div>
                <div className="text-sm text-fg-secondary leading-snug">
                  <span className="text-accent">“</span>
                  {uc.ask}
                  <span className="text-accent">”</span>
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {uc.calls.map((c) => (
                    <code
                      key={c}
                      className="font-mono text-2xs text-fg-muted bg-surface-overlay border border-edge-subtle rounded-sm px-1.5 py-0.5"
                    >
                      {c}
                    </code>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
      )}
    </div>
  )
}
