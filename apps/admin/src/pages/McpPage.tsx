/**
 * FILE: apps/admin/src/pages/McpPage.tsx
 * PURPOSE: MCP setup console — key readiness, copy-paste snippets, and tool catalog
 *          for the active project.
 */

import { Link, useSearchParams } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Section,
  Card,
  Badge,
  Btn,
  ErrorAlert,
  SegmentedControl,
  CopyButton,
  FreshnessPill,
  RecommendedAction,
  RelativeTime, } from '../components/ui'
import { IconIntegrations, IconCheck, IconArrowRight } from '../components/icons'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { usePageData } from '../lib/usePageData'
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
import { apiFetch } from '../lib/supabase'
import { useRealtimeReload } from '../lib/realtime'
import { usePublishPageContext } from '../lib/pageContext'
import { useSetupStatus } from '../lib/useSetupStatus'
import { SetupNudge } from '../components/SetupNudge'
import { useToast } from '../lib/toast'
import { usePageCopy } from '../lib/copy'
import { useMcpUx, resolveQuickMcpTab } from '../lib/mcpModeUx'
import { ConfigHelp } from '../components/ConfigHelp'
import { detectFromPackageJson } from '../lib/frameworkDetect'
import { McpStatusBanner } from '../components/mcp/McpStatusBanner'
import { McpConnectGuide } from '../components/mcp/McpConnectGuide'
import { McpSnapshotStrip } from '../components/mcp/McpSnapshotStrip'
import { McpEndpointReadout } from '../components/mcp/McpEndpointReadout'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
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
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { RESOLVED_EXTERNAL_API_URL, RESOLVED_MCP_HTTP_URL } from '../lib/env'
import {
  buildHttpConfig,
  buildStdioConfig,
  projectServerName,
} from '../lib/cursorDeeplink'
import { MCP_CLIENTS } from '@mushi-mushi/mcp/clients'
import { ClientConnectButton } from '../components/ClientConnectButton'
import { McpAccountKeyCard } from '../components/McpAccountKeyCard'

const CURSOR_CLIENT = MCP_CLIENTS.find((c) => c.id === 'cursor')!
const VSCODE_CLIENT = MCP_CLIENTS.find((c) => c.id === 'vscode')!

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

const MUSHI_MCP_API = RESOLVED_EXTERNAL_API_URL

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
  {
    title: 'Triage across all my apps',
    ask: 'What are my most urgent bugs across all my projects?',
    calls: ['get_account_overview', 'get_recent_reports (project_id=X)', 'get_recent_reports (project_id=Y)'],
  },
  {
    title: 'New project check-in',
    ask: 'Is the SDK sending data? Any critical issues?',
    calls: ['list_projects', 'get_project_context', 'ingest_setup_check'],
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
      title: 'Can remove data from report queues. Confirm every call.',
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

function buildSdkInstallSnippet(pkgManager: 'npm' | 'yarn' | 'pnpm'): string {
  const cmds: Record<'npm' | 'yarn' | 'pnpm', string> = {
    npm: 'npm install @mushi-mushi/web',
    yarn: 'yarn add @mushi-mushi/web',
    pnpm: 'pnpm add @mushi-mushi/web',
  }
  return cmds[pkgManager]
}

function buildSdkInitSnippet(projectId: string): string {
  return `import Mushi from '@mushi-mushi/web';

// Call once at app startup (e.g. in _app.tsx / main.tsx).
// Use a report:write key — NOT your MCP key.
Mushi.init({
  apiKey: 'mushi_<your-report-write-key>',
  projectId: '${projectId}',
});

// Identify users so reports are tied to real people:
Mushi.identify({ id: user.id, email: user.email });`
}

function buildCursorJson(projectId: string, projectName: string): string {
  const serverName = projectServerName(projectId, projectName)
  return JSON.stringify(
    {
      mcpServers: {
        [serverName]: buildStdioConfig(projectId, 'paste-your-mushi-api-key-here', MUSHI_MCP_API),
      },
    },
    null,
    2,
  )
}

function buildHttpCursorJson(projectId: string, projectName: string): string {
  const serverName = projectServerName(projectId, projectName)
  return JSON.stringify(
    {
      mcpServers: {
        [serverName]: buildHttpConfig(projectId, 'paste-your-mushi-api-key-here', RESOLVED_MCP_HTTP_URL),
      },
    },
    null,
    2,
  )
}

function buildEnvBlock(projectId: string): string {
  return [
    '# Mushi MCP — paste into .env.local (gitignored).',
    `MUSHI_API_ENDPOINT=${MUSHI_MCP_API}`,
    'MUSHI_API_KEY=paste-your-mushi-api-key-here',
    `MUSHI_PROJECT_ID=${projectId}`,
    '# Optional: lean tool set (default in admin snippets). Omit or set to "all" for full catalog.',
    'MUSHI_FEATURES=triage,fixes,inventory,setup,docs',
    '',
  ].join('\n')
}

interface McpJsonCheck {
  ok: boolean
  title: string
  details: string[]
}

function validateMcpJsonSyntax(raw: string): McpJsonCheck {
  if (!raw.trim()) {
    return {
      ok: false,
      title: 'Paste an mcp.json block to check it.',
      details: ['Tip: click "Load generated snippet" below to start from the active project config.'],
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return {
      ok: false,
      title: 'Invalid JSON syntax.',
      details: [err instanceof Error ? err.message : 'The config is not valid JSON.'],
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, title: 'Root must be an object.', details: ['Expected { "mcpServers": { ... } }.'] }
  }

  const root = parsed as { mcpServers?: unknown }
  if (!root.mcpServers || typeof root.mcpServers !== 'object' || Array.isArray(root.mcpServers)) {
    return {
      ok: false,
      title: 'Missing mcpServers object.',
      details: ['Cursor expects { "mcpServers": { "mushi-...": { ... } } }.'],
    }
  }

  const entries = Object.entries(root.mcpServers as Record<string, unknown>)
  const mushiEntries = entries.filter(([name, value]) => {
    if (!value || typeof value !== 'object') return false
    const server = value as { command?: unknown; args?: unknown; url?: unknown; env?: unknown }
    const args = Array.isArray(server.args) ? server.args.join(' ') : ''
    const env = server.env && typeof server.env === 'object' ? server.env as Record<string, unknown> : {}
    return name.includes('mushi') ||
      String(server.command ?? '').includes('mushi') ||
      args.includes('mushi') ||
      Boolean(env.MUSHI_API_KEY || env.MUSHI_API_ENDPOINT)
  })

  if (mushiEntries.length === 0) {
    return {
      ok: false,
      title: 'No Mushi server entry found.',
      details: ['Add a server named like "mushi-my-app" or paste the generated snippet.'],
    }
  }

  const details: string[] = []
  let ok = true

  for (const [name, value] of mushiEntries) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      ok = false
      details.push(`${name}: server config must be an object.`)
      continue
    }

    const server = value as {
      type?: unknown
      command?: unknown
      args?: unknown
      env?: unknown
      url?: unknown
      headers?: unknown
    }
    const isHttp = server.type === 'http' || typeof server.url === 'string'

    if (isHttp) {
      if (typeof server.url !== 'string' || !server.url.startsWith('http')) {
        ok = false
        details.push(`${name}: hosted HTTP config needs a valid url.`)
      }
      const headers = server.headers && typeof server.headers === 'object'
        ? server.headers as Record<string, unknown>
        : {}
      if (!headers.Authorization && !headers['X-Mushi-Api-Key']) {
        ok = false
        details.push(`${name}: hosted HTTP config needs Authorization or X-Mushi-Api-Key headers.`)
      }
      continue
    }

    if (typeof server.command !== 'string') {
      ok = false
      details.push(`${name}: stdio config needs a command, usually "npx" or "node".`)
    }
    if (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== 'string')) {
      ok = false
      details.push(`${name}: stdio config needs args as a string array.`)
    }

    const env = server.env && typeof server.env === 'object'
      ? server.env as Record<string, unknown>
      : null
    if (!env) {
      ok = false
      details.push(`${name}: stdio config needs an env object with MUSHI_* values.`)
      continue
    }
    if (typeof env.MUSHI_API_ENDPOINT !== 'string' || !env.MUSHI_API_ENDPOINT.includes('/functions/v1/api')) {
      ok = false
      details.push(`${name}: MUSHI_API_ENDPOINT should end with /functions/v1/api.`)
    }
    if (typeof env.MUSHI_API_KEY !== 'string' || !env.MUSHI_API_KEY.startsWith('mushi_')) {
      ok = false
      details.push(`${name}: MUSHI_API_KEY should start with mushi_.`)
    }
    if (!env.MUSHI_PROJECT_ID) {
      details.push(`${name}: no MUSHI_PROJECT_ID means account mode; use an org-scoped key or pass project_id in tool calls.`)
    }
    if (Array.isArray(server.args) && server.args.includes('@mushi-mushi/mcp@latest')) {
      details.push(`${name}: uses npm @latest. If Cursor still shows a transport error before the next publish, use Hosted HTTP or restart Cursor after upgrading.`)
    }
  }

  return {
    ok,
    title: ok ? 'Syntax looks valid.' : 'Config needs changes.',
    details: details.length > 0 ? details : ['Restart Cursor MCP after saving the file, then run diagnose_connection.'],
  }
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
    <div className="relative rounded-md border border-edge-subtle bg-surface-raised p-3 pl-4 motion-safe:transition-colors hover:border-edge">
      <span className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-sm ${stripeTone}`} aria-hidden="true" />
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-fg">{tool.title}</div>
          <SignalChip tone="neutral" className="font-mono wrap-anywhere max-w-full">
            {tool.name}
          </SignalChip>
        </div>
        <Badge className={scopeBadgeTone(tool.scope)}>{tool.scope}</Badge>
      </div>
      <div className="text-sm text-fg-secondary leading-snug mb-1">
        <span className="text-accent">“</span>
        {tool.useCase}
        <span className="text-accent">”</span>
      </div>
      <ContainedBlock tone="muted" className="mb-2">
        <p className="text-xs leading-snug text-fg-muted">{tool.description}</p>
      </ContainedBlock>
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

  const [snippetMode, setSnippetMode] = useState<'cursor' | 'env' | 'http'>('cursor')
  const [copied, setCopied] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionTestResult, setConnectionTestResult] = useState<{ ok: boolean; message: string; testedAt: number } | null>(null)
  const [monorepoNote, setMonorepoNote] = useState<string | null>(null)
  const [monoWarnings, setMonoWarnings] = useState<string[]>([])
  const [detectOpen, setDetectOpen] = useState(false)
  const [detectText, setDetectText] = useState('')
  const [mintingKey, setMintingKey] = useState(false)
  const [revealedMcpKey, setRevealedMcpKey] = useState<string | null>(null)
  const [sdkSnippetLang, setSdkSnippetLang] = useState<'npm' | 'yarn' | 'pnpm'>('npm')
  const [mcpJsonDraft, setMcpJsonDraft] = useState('')
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
  usePublishPageHeroStats('/mcp', statsQuery.data)

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

  async function mintMcpKey(scopes: string[], targetProjectId?: string): Promise<string | null> {
    const pid = targetProjectId ?? activeProjectId
    if (!pid) return null
    const res = await apiFetch<{ key: string; prefix: string }>(
      `/v1/admin/projects/${pid}/keys`,
      {
        method: 'POST',
        body: JSON.stringify({ scopes }),
        idempotencyKey: crypto.randomUUID(),
      },
    )
    if (!res.ok || !res.data?.key) {
      toast.error('Could not mint MCP key', res.error?.message ?? 'Unknown error')
      return null
    }
    if (!targetProjectId || targetProjectId === activeProjectId) reloadAll()
    return res.data.key
  }

  async function mintMcpReadKey() {
    if (!activeProjectId) return
    setMintingKey(true)
    try {
      const key = await mintMcpKey(['mcp:read'])
      if (!key) return
      setRevealedMcpKey(key)
      try {
        await navigator.clipboard.writeText(key)
        toast.success('mcp:read key copied', 'Paste into your MCP snippet — it will not be shown again.')
      } catch {
        toast.success('mcp:read key minted', 'Copy it now — it will not be shown again.')
      }
    } finally {
      setMintingKey(false)
    }
  }

  async function mintMcpWriteKey() {
    if (!activeProjectId) return
    setMintingKey(true)
    try {
      const key = await mintMcpKey(['mcp:write'])
      if (!key) return
      setRevealedMcpKey(key)
      try {
        await navigator.clipboard.writeText(key)
        toast.success('mcp:write key copied', 'Paste into your MCP snippet — it will not be shown again.')
      } catch {
        toast.success('mcp:write key minted', 'Copy it now — it will not be shown again.')
      }
    } finally {
      setMintingKey(false)
    }
  }

  const projectId = activeProject?.id ?? activeProjectId ?? '<your-project-id>'
  const displayName = activeProject?.name ?? projectName ?? 'project'
  const snippet =
    snippetMode === 'cursor'
      ? buildCursorJson(projectId, displayName)
      : snippetMode === 'http'
        ? buildHttpCursorJson(projectId, displayName)
        : buildEnvBlock(projectId)
  const syntaxCheck = useMemo(
    () => validateMcpJsonSyntax(mcpJsonDraft || (snippetMode === 'env' ? '' : snippet)),
    [mcpJsonDraft, snippet, snippetMode],
  )

  async function testMcpConnection() {
    if (!activeProjectId) return
    setTestingConnection(true)
    setConnectionTestResult(null)
    try {
      const res = await apiFetch<{ tool_count: number; expected: number; healthy: boolean }>(
        '/v1/admin/mcp/test-connection',
      )
      if (!res.ok || !res.data) {
        const raw = res.error?.message ?? ''
        const friendly = raw.includes('NO_PROJECT')
          ? 'Select a project first.'
          : raw.includes('MCP_PROBE_FAILED')
            ? 'Hosted MCP did not respond — the function may be deploying. Wait 30 s and try again.'
            : raw || 'Connection probe failed — check your API key is active.'
        setConnectionTestResult({ ok: false, message: friendly, testedAt: Date.now() })
        return
      }
      const { tool_count: count, expected, healthy } = res.data
      setConnectionTestResult({
        ok: healthy,
        message: healthy
          ? `Connected — ${count} tools ready.`
          : `Partial — only ${count} of ${expected} tools visible. The deploy may be stale; redeploy the MCP function and test again.`,
        testedAt: Date.now(),
      })
    } catch (err) {
      setConnectionTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Could not reach the MCP server — check your network.',
        testedAt: Date.now(),
      })
    } finally {
      setTestingConnection(false)
    }
  }

  const readTools = TOOL_CATALOG.filter((t) => t.scope === 'mcp:read')
  const writeTools = TOOL_CATALOG.filter((t) => t.scope === 'mcp:write')

  // Use-case groups for the Catalog display — derived from USE_CASES.calls
  const USE_CASE_GROUPS: Array<{ label: string; tools: string[]; description: string }> = [
    {
      label: 'Start my day / triage',
      tools: ['triage_next_steps', 'get_recent_reports', 'get_account_overview', 'project://dashboard'],
      description: 'Survey the queue, understand what needs attention, check project health.',
    },
    {
      label: 'Fix a bug end-to-end',
      tools: ['summarize_report_for_fix', 'get_fix_context', 'get_blast_radius', 'submit_fix_result', 'get_fix_timeline', 'explain_judge_result'],
      description: 'Get full context on a report, dispatch a fix, track CI, and merge.',
    },
    {
      label: 'Query production data',
      tools: ['run_nl_query', 'get_similar_bugs', 'list_projects', 'get_project_context', 'ingest_setup_check'],
      description: 'Query report data from your editor.',
    },
  ]

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
        <PageHeaderBar
          title={copy?.title ?? 'MCP'}
          description={
            copy?.description ??
            'Connect Cursor, Claude Desktop, or any MCP-aware agent to this project\'s live bug queue.'
          }
          helpTitle={copy?.help?.title ?? 'About MCP'}
          helpWhatIsIt={
            copy?.help?.whatIsIt ??
            'MCP lets your coding assistant call Mushi tools during a chat — read reports, dispatch fixes, and query production data without copy-pasting IDs.'
          }
          helpUseCases={
            copy?.help?.useCases ?? [
              'Ask Cursor "what should I fix next?" and get an answer from your real bugs',
              'Have the agent draft a fix for a specific report in one command',
              'Query report data from inside your editor',
            ]
          }
          helpHowToUse={
            copy?.help?.howToUse ??
            '1. On /projects, pick MCP read-only or read + write scope. 2. Copy the snippet on Setup. 3. Restart your IDE. 4. Ask "list mushi tools".'
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
      <PageHeaderBar
        title={copy?.title ?? 'MCP'}
        projectScope={displayName}
        description={copy?.description ?? 'Banner + MCP SNAPSHOT — Overview for posture, Setup for snippet, Catalog for tools.'}
        helpTitle={copy?.help?.title ?? 'About MCP'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'MCP lets your coding assistant call Mushi tools during a chat — read reports, dispatch fixes, and query production data without copy-pasting IDs.'
        }
        helpUseCases={
          copy?.help?.useCases ?? [
            'Ask Cursor "what should I fix next?" and get an answer from your real bugs',
            'Have the agent draft a fix for a specific report in one command',
            'Query report data from inside your editor',
          ]
        }
        helpHowToUse={
          copy?.help?.howToUse ??
          '1. On /projects, pick MCP read-only or read + write scope. 2. Copy the snippet on Setup. 3. Restart your IDE. 4. Ask "list mushi tools".'
        }
      >
        {!ux.hideOverviewChrome && (
          <>
            <Badge
              className={
                bannerSeverity === 'ok'
                  ? 'bg-ok-muted text-ok'
                  : bannerSeverity === 'warn'
                    ? 'bg-warn-muted/50 text-warning-foreground'
                    : bannerSeverity === 'brand'
                      ? 'border border-edge-subtle bg-surface-raised text-fg-secondary'
                      : 'bg-surface-overlay text-fg-muted'
              }
            >
              {headerBadge}
            </Badge>
            <FreshnessPill at={lastFetchedAt} isValidating={isValidating} />
          </>
        )}
        <Btn size="sm" variant="ghost" onClick={reloadAll} loading={isValidating}>
          Refresh
        </Btn>
        <Btn
          size="sm"
          variant="ghost"
          data-testid="mcp-mint-key-link"
          loading={mintingKey}
          disabled={!activeProjectId}
          onClick={() => void mintMcpReadKey()}
        >
          Mint mcp:read key
        </Btn>
        <Btn
          size="sm"
          variant="ghost"
          data-testid="mcp-mint-write-key-link"
          loading={mintingKey}
          disabled={!activeProjectId}
          onClick={() => void mintMcpWriteKey()}
        >
          Mint mcp:write key
        </Btn>
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            children: (
              <McpStatusBanner
                stats={stats}
                onTab={setTab}
                onRefresh={reloadAll}
                refreshing={isValidating}
                plainBanner={ux.plainBanner}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            show: !ux.hideMcpSnapshot,
            children: (
              <McpSnapshotStrip
                stats={stats}
                statsFetchedAt={lastFetchedAt}
                statsValidating={isValidating}
                sectionTitle={copy?.sections?.snapshot ?? 'MCP SNAPSHOT'}
                hint={activeMeta.description}
                statLabels={copy?.statLabels}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.guide,
            show: stats.topPriority === 'healthy',
            children: <McpConnectGuide topPriority={stats.topPriority} toolCount={stats.toolCount} />,
          },
        ]}
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

      {activeTab === 'overview' && (
        <div className="space-y-4">
          <McpEndpointReadout stats={stats} fetchedAt={lastFetchedAt} validating={isValidating} />
          {/* Capability framing strip — leads with what the user can DO, not connection metrics */}
          <div className="rounded-md border border-edge-subtle bg-surface-raised px-4 py-3">
            <p className="text-xs font-semibold text-fg mb-2">What you can do with MCP connected</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {USE_CASES.slice(0, 4).map((uc) => (
                <div key={uc.title} className="rounded-md border border-edge-subtle bg-surface-raised px-3 py-2">
                  <p className="text-2xs font-semibold text-fg">{uc.title}</p>
                  <p className="mt-0.5 text-2xs italic text-fg-secondary line-clamp-2">
                    &ldquo;{uc.ask}&rdquo;
                  </p>
                  <p className="mt-1 text-2xs text-fg-faint line-clamp-1">
                    {uc.calls.slice(0, 2).join(', ')}
                    {uc.calls.length > 2 ? ` +${uc.calls.length - 2} more` : ''}
                  </p>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setTab('examples')}
              className="mt-2 text-2xs text-brand hover:underline"
            >
              See all {USE_CASES.length} examples →
            </button>
          </div>

          {/* RecommendedAction is shown for all modes — every user benefits from a
              clear next step rather than staring at blank space below the KPI snapshot. */}
          {stats.topPriority === 'healthy' && (
            <RecommendedAction
              tone="success"
              title="Agent access live"
              description={stats.topPriorityLabel ?? `${stats.connectedKeyCount} MCP key(s) connected with heartbeat.`}
              cta={{ label: 'Browse catalog', to: '/mcp?tab=catalog' }}
            />
          )}
          {!ux.hideOverviewChrome && (
          <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="space-y-2 border-edge p-3 sm:col-span-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-3xs font-medium uppercase tracking-wide text-fg-faint">Connection cockpit</p>
                <SignalChip tone={stats.connectedKeyCount > 0 ? 'ok' : stats.mcpReadKeyCount > 0 ? 'warn' : 'neutral'}>
                  {stats.connectedKeyCount > 0 ? 'Handshake OK' : stats.mcpReadKeyCount > 0 ? 'Awaiting IDE' : 'No MCP key'}
                </SignalChip>
              </div>
              <div className="grid gap-2 sm:grid-cols-3 text-xs">
                <div>
                  <p className="text-fg-faint text-3xs uppercase tracking-wide">Expected endpoint</p>
                  <p className="font-mono text-fg-secondary truncate" title={stats.expectedEndpointHost ?? MUSHI_MCP_API}>
                    {stats.expectedEndpointHost ?? new URL(MUSHI_MCP_API).host}
                  </p>
                </div>
                <div>
                  <p className="text-fg-faint text-3xs uppercase tracking-wide">Last agent host</p>
                  <p className="font-mono text-fg-secondary truncate" title={stats.lastSeenEndpointHost ?? undefined}>
                    {stats.lastSeenEndpointHost ?? '—'}
                  </p>
                </div>
                <div>
                  <p className="text-fg-faint text-3xs uppercase tracking-wide">Try in Cursor</p>
                  <ActionPillRow>
                    <ActionPill
                      tone="brand"
                      onClick={() => void copySnippet('List all Mushi MCP tools for this project.', 'Try command')}
                    >
                      Copy: list tools
                    </ActionPill>
                    <ActionPill
                      tone="neutral"
                      onClick={() => void copySnippet('get_recent_reports limit=5', 'Try command')}
                    >
                      Copy: recent reports
                    </ActionPill>
                  </ActionPillRow>
                </div>
              </div>
            </Card>
            <Card className="space-y-2 border-edge p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-3xs font-medium uppercase tracking-wide text-fg-faint">Read scope</p>
                <SignalChip tone={stats.mcpReadKeyCount > 0 ? 'ok' : 'warn'}>
                  {stats.mcpReadKeyCount > 0 ? 'Ready' : 'Missing'}
                </SignalChip>
              </div>
              <p className="text-lg font-semibold tabular-nums text-fg-primary">{stats.mcpReadKeyCount}</p>
              <InlineProof>Required to list tools + read triage</InlineProof>
            </Card>
            <Card className="space-y-2 border-edge p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-3xs font-medium uppercase tracking-wide text-fg-faint">Write scope</p>
                <SignalChip tone={stats.mcpWriteKeyCount > 0 ? 'ok' : 'neutral'}>
                  {stats.mcpWriteKeyCount > 0 ? 'Enabled' : 'Optional'}
                </SignalChip>
              </div>
              <p className="text-lg font-semibold tabular-nums text-warn">{stats.mcpWriteKeyCount}</p>
              <InlineProof>Optional — dispatch fixes from agents</InlineProof>
            </Card>
            <Card className="space-y-2 border-edge p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-3xs font-medium uppercase tracking-wide text-fg-faint">Last heartbeat</p>
                <SignalChip tone={stats.lastSeenAt ? 'brand' : 'neutral'}>
                  {stats.lastSeenAt ? 'Live' : 'Silent'}
                </SignalChip>
              </div>
              <p className="text-sm font-semibold text-fg-primary">
                {stats.lastSeenAt ? <RelativeTime value={stats.lastSeenAt} /> : 'Never'}
              </p>
              <InlineProof className="truncate font-mono">
                <span title={stats.lastSeenEndpointHost ?? undefined}>
                  {stats.lastSeenEndpointHost ?? 'No MCP traffic yet'}
                </span>
              </InlineProof>
            </Card>
          </div>
          </>
          )}
        </div>
      )}

      {activeTab !== 'overview' && (
      <Section title={activeTab === 'setup' ? 'Agent setup' : activeTab === 'catalog' ? 'Tool catalog' : 'Agent examples'}>
        {ux.hideMcpSnapshot && (
        <ContainedBlock tone="muted" className="mb-4">
          <p className="text-2xs leading-relaxed text-fg-muted">{activeMeta.description}</p>
        </ContainedBlock>
        )}

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

              <div className="pt-1 space-y-3">
                {!hasReadKey && (
                  <div className="space-y-2">
                    <Btn size="sm" data-testid="mcp-status-mint" loading={mintingKey} onClick={() => void mintMcpReadKey()}>
                      Mint mcp:read key here
                      <IconArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Btn>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {activeProjectId ? (
                    <>
                      <ClientConnectButton
                        client={CURSOR_CLIENT}
                        projectId={activeProjectId}
                        projectName={displayName}
                        endpoint={RESOLVED_EXTERNAL_API_URL}
                        mcpHttpUrl={RESOLVED_MCP_HTTP_URL}
                        variant="primary"
                        size="sm"
                      />
                      <ClientConnectButton
                        client={CURSOR_CLIENT}
                        projectId={activeProjectId}
                        projectName={displayName}
                        endpoint={RESOLVED_EXTERNAL_API_URL}
                        mcpHttpUrl={RESOLVED_MCP_HTTP_URL}
                        scopes={['mcp:write']}
                        variant="ghost"
                        size="sm"
                      />
                      <ClientConnectButton
                        client={VSCODE_CLIENT}
                        projectId={activeProjectId}
                        projectName={displayName}
                        endpoint={RESOLVED_EXTERNAL_API_URL}
                        mcpHttpUrl={RESOLVED_MCP_HTTP_URL}
                        variant="ghost"
                        size="sm"
                      />
                    </>
                  ) : (
                    <Btn size="sm" variant="primary" disabled>
                      Add to Cursor
                    </Btn>
                  )}
                </div>
                <ContainedBlock tone="muted">
                  <p className="text-2xs text-fg-muted">
                    <strong>"Add to Cursor"</strong> mints a fresh key and opens your IDE's install dialog — no copy-paste needed.
                    The key is embedded in the deeplink and will not be shown again unless you save it.
                  </p>
                </ContainedBlock>
                {revealedMcpKey ? (
                  <ContainedBlock tone="muted">
                    <p className="text-2xs text-fg-muted">
                      Key minted — paste into your snippet if the deeplink did not open your IDE. Not shown again after you leave.
                    </p>
                  </ContainedBlock>
                ) : null}
              </div>
            </Card>

            <Card className="p-5 space-y-4" data-testid="mcp-install">
              <div>
                <h3 className="text-sm font-semibold text-fg">Configuration values</h3>
                <ContainedBlock tone="muted" className="mt-2">
                  <p className="text-xs text-fg-muted">
                    Three env vars wire the MCP binary to <span className="font-mono text-fg-secondary">{displayName}</span>.
                  </p>
                </ContainedBlock>
              </div>

              <div className="rounded-md border border-edge-subtle bg-surface-raised">
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
                  <SignalChip tone="neutral" className="text-2xs" aria-hidden>
                    {detectOpen ? '▲ hide' : '▼ paste package.json'}
                  </SignalChip>
                </button>
                {detectOpen && (
                  <div className="px-3 pb-3 pt-1 space-y-2">
                    <ContainedBlock tone="muted">
                      <InlineProof className="border-0 bg-transparent px-0 py-0 text-2xs leading-snug">
                        Paste your <SignalChip tone="neutral" className="font-mono">package.json</SignalChip> for monorepo install guidance.
                      </InlineProof>
                    </ContainedBlock>
                    <textarea
                      ref={detectTaRef}
                      value={detectText}
                      onChange={(e) => setDetectText(e.target.value)}
                      placeholder={'{\n  "workspaces": ["apps/*", "packages/*"],\n  ...\n}'}
                      className="w-full h-28 font-mono text-2xs bg-surface-raised border border-edge-subtle rounded-sm px-2 py-1.5 text-fg-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand resize-y placeholder:text-fg-faint"
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
                    <ActionPill
                      onClick={() => {
                        setMonorepoNote(null)
                        setMonoWarnings([])
                      }}
                    >
                      Dismiss
                    </ActionPill>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 border-b border-edge-subtle pb-2 flex-wrap">
                <ConfigHelp helpId="mcp.snippet_mode" />
                <SegmentedControl
                  value={snippetMode}
                  onChange={setSnippetMode}
                  options={[
                    { id: 'cursor' as const, label: 'Stdio (.cursor/mcp.json)' },
                    { id: 'http' as const, label: 'Hosted HTTP' },
                    { id: 'env' as const, label: '.env.local' },
                  ]}
                  ariaLabel="Snippet format"
                  size="sm"
                  scrollable
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Btn
                    size="sm"
                    variant="ghost"
                    loading={testingConnection}
                    onClick={() => void testMcpConnection()}
                    data-testid="mcp-test-connection"
                  >
                    {connectionTestResult ? 'Re-test' : 'Test connection'}
                  </Btn>
                  <Link
                    to="/docs-bridge?topic=cli-setup"
                    className="text-xs text-brand hover:underline"
                  >
                    CLI: mushi setup --ide cursor
                  </Link>
                </div>
                {connectionTestResult && (
                  <div
                    data-testid="mcp-connection-result"
                    className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs ${
                      connectionTestResult.ok
                        ? 'border-ok/30 bg-ok/8 text-ok'
                        : 'border-danger/30 bg-danger/8 text-danger-foreground'
                    }`}
                  >
                    <span className="shrink-0 text-sm leading-none mt-0.5" aria-hidden>
                      {connectionTestResult.ok ? '✓' : '✕'}
                    </span>
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium">{connectionTestResult.message}</p>
                      {!connectionTestResult.ok && (
                        <p className="text-fg-muted">
                          Run <code className="font-mono bg-surface px-1 rounded">mushi doctor --server</code> for a full diagnostic, or check the Supabase Edge Function logs.
                        </p>
                      )}
                      <p className="text-fg-muted">
                        Tested at {new Date(connectionTestResult.testedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <SignalChip tone="neutral" className="uppercase tracking-wider font-medium">
                    {snippetMode === 'cursor'
                      ? 'Stdio — drop into IDE settings (recommended — shows Mushi icon in Cursor)'
                      : snippetMode === 'http'
                        ? 'Hosted HTTP — no subprocess (URL host may show Supabase icon in Cursor; use stdio for branding)'
                        : 'Drop into your repo root'}
                  </SignalChip>
                  <CopyButton
                    onCopy={() =>
                      copySnippet(
                        snippet,
                        snippetMode === 'cursor'
                          ? '.cursor/mcp.json block'
                          : snippetMode === 'http'
                            ? 'Hosted HTTP MCP block'
                            : '.env.local block',
                      )
                    }
                    copied={copied}
                    label={
                      snippetMode === 'cursor'
                        ? 'Copy .cursor/mcp.json block'
                        : snippetMode === 'http'
                          ? 'Copy hosted HTTP block'
                          : 'Copy .env.local block'
                    }
                    copiedLabel="Snippet copied"
                    data-testid="mcp-snippet-copy"
                  />
                </div>
                <pre
                  className="mushi-code-block mushi-code-body border border-code-surface-border rounded-sm px-3 py-2 mt-1 text-2xs font-mono overflow-auto whitespace-pre-wrap wrap-anywhere max-h-64 select-all"
                  data-testid="mcp-snippet"
                >
                  {snippet}
                </pre>
              </div>

              <div className="rounded-md border border-edge-subtle bg-surface-raised p-3 space-y-2" data-testid="mcp-json-helper">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <h3 className="text-sm font-semibold text-fg">mcp.json syntax helper</h3>
                    <p className="text-xs text-fg-muted">
                      Paste the block Cursor is using. We check JSON shape, stdio/HTTP fields, and Mushi env names.
                    </p>
                  </div>
                  <Btn
                    size="sm"
                    variant="ghost"
                    onClick={() => setMcpJsonDraft(snippetMode === 'env' ? buildCursorJson(projectId, displayName) : snippet)}
                    data-testid="mcp-json-helper-load"
                  >
                    Load generated snippet
                  </Btn>
                </div>
                <textarea
                  className="w-full min-h-32 rounded-sm border border-edge-subtle bg-surface px-3 py-2 font-mono text-2xs text-fg-secondary outline-none focus-visible:border-brand"
                  value={mcpJsonDraft}
                  onChange={(event) => setMcpJsonDraft(event.target.value)}
                  placeholder="Paste your ~/.cursor/mcp.json block here..."
                  spellCheck={false}
                  data-testid="mcp-json-helper-input"
                />
                <ContainedBlock tone={syntaxCheck.ok ? 'ok' : 'warn'}>
                  <p className="text-xs font-semibold text-fg">{syntaxCheck.title}</p>
                  <ul className="mt-1 list-disc pl-4 space-y-0.5 text-2xs text-fg-muted">
                    {syntaxCheck.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                </ContainedBlock>
              </div>
            </Card>

            {/* Multi-project connections */}
            {projectsQuery.data && projectsQuery.data.projects.length > 0 && (
              <Card className="p-5 space-y-4" data-testid="mcp-multi-project">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-fg">Connect all your projects</h3>
                    <Badge className="bg-info-muted text-info border border-info/30 text-2xs">
                      {projectsQuery.data.projects.length} project{projectsQuery.data.projects.length === 1 ? '' : 's'}
                    </Badge>
                  </div>
                  <ContainedBlock tone="muted" className="mt-2">
                    <p className="text-xs text-fg-muted leading-relaxed">
                      Each Mushi project uses its own API key and gets a uniquely-named MCP server entry
                      (<span className="font-mono text-fg-secondary">mushi-{'{'}name{'}'}-{'{'}id{'}'}</span>).
                      Click <strong>Add to Cursor</strong> for each project below — all of them will appear
                      simultaneously in your IDE so you can triage bugs across all your apps in one session.
                    </p>
                  </ContainedBlock>
                </div>
                <div className="space-y-2">
                  {projectsQuery.data.projects.map((p) => {
                    const serverSlug = projectServerName(p.id, p.name)
                    const isActive = p.id === activeProjectId
                    return (
                      <div
                        key={p.id}
                        className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 ${
                          isActive ? 'border-brand/40 bg-surface-raised' : 'border-edge-subtle bg-surface-raised/20'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-fg truncate">{p.name}</span>
                            {isActive && (
                              <Badge className="bg-brand/15 text-brand border border-brand/20 text-2xs">active</Badge>
                            )}
                          </div>
                          <p className="text-2xs text-fg-faint font-mono truncate mt-0.5">{serverSlug}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <ClientConnectButton
                            client={CURSOR_CLIENT}
                            projectId={p.id}
                            projectName={p.name}
                            endpoint={RESOLVED_EXTERNAL_API_URL}
                            mcpHttpUrl={RESOLVED_MCP_HTTP_URL}
                            scopes={['mcp:write']}
                            variant={isActive ? 'primary' : 'ghost'}
                            size="sm"
                          />
                          <ClientConnectButton
                            client={VSCODE_CLIENT}
                            projectId={p.id}
                            projectName={p.name}
                            endpoint={RESOLVED_EXTERNAL_API_URL}
                            mcpHttpUrl={RESOLVED_MCP_HTTP_URL}
                            scopes={['mcp:write']}
                            variant="ghost"
                            size="sm"
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
                <ContainedBlock tone="muted">
                  <p className="text-2xs text-fg-muted">
                    Once connected, call <span className="font-mono text-fg-secondary">get_account_overview</span> on
                    any server to see all your projects and their health. Ask the agent:
                    <em className="not-italic text-fg-secondary"> "What are my most urgent bugs across all projects?"</em>
                  </p>
                </ContainedBlock>
              </Card>
            )}

            {/* Account-level key — one key for all projects (org-scoped) */}
            <Card className="p-5 space-y-4" data-testid="mcp-account-key">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold text-fg">Account key (all projects, one server)</h3>
                  <Badge className="bg-info-muted text-info border border-info/30 text-2xs">org-scoped</Badge>
                </div>
                <ContainedBlock tone="muted" className="mt-2">
                  <p className="text-xs text-fg-muted leading-relaxed">
                    Alternative to per-project keys — one org-scoped key with no{' '}
                    <span className="font-mono text-fg-secondary">MUSHI_PROJECT_ID</span> covers all your projects.
                    The agent calls <span className="font-mono text-fg-secondary">get_account_overview</span> to
                    discover accessible projects and auto-selects when you only have one.
                    Use this when you want a single MCP server entry across your entire account.
                  </p>
                </ContainedBlock>
              </div>
              <McpAccountKeyCard compact />
            </Card>

            {/* SDK install for end users */}
            {activeProjectId && (
              <Card className="p-5 space-y-4" data-testid="mcp-sdk-install">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-fg">Wire your app (SDK)</h3>
                    <Badge className="bg-surface-overlay text-fg-muted border border-edge-subtle text-2xs">
                      end users → Mushi
                    </Badge>
                  </div>
                  <ContainedBlock tone="muted" className="mt-2">
                    <p className="text-xs text-fg-muted leading-relaxed">
                      The MCP connects <em>your coding agent</em> to Mushi. The SDK connects
                      <em> real users in your app</em> so their bug reports flow into your reports inbox.
                      Use a <strong>report:write</strong> key for the SDK — never your MCP key.
                    </p>
                  </ContainedBlock>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center gap-1 mb-1.5">
                      <SegmentedControl
                        value={sdkSnippetLang}
                        onChange={setSdkSnippetLang}
                        options={[
                          { id: 'npm' as const, label: 'npm' },
                          { id: 'yarn' as const, label: 'yarn' },
                          { id: 'pnpm' as const, label: 'pnpm' },
                        ]}
                        ariaLabel="Package manager"
                        size="sm"
                      />
                    </div>
                    <pre className="mushi-code-block mushi-code-body border border-code-surface-border rounded-sm px-3 py-2 text-2xs font-mono overflow-auto select-all">
                      {buildSdkInstallSnippet(sdkSnippetLang)}
                    </pre>
                  </div>
                  <div>
                    <p className="text-2xs text-fg-faint uppercase tracking-wide font-medium mb-1">Init snippet</p>
                    <pre className="mushi-code-block mushi-code-body border border-code-surface-border rounded-sm px-3 py-2 text-2xs font-mono overflow-auto whitespace-pre-wrap select-all max-h-52">
                      {buildSdkInitSnippet(projectId)}
                    </pre>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Btn
                    size="sm"
                    variant="ghost"
                    onClick={() => void copySnippet(buildSdkInstallSnippet(sdkSnippetLang), 'Install command')}
                  >
                    Copy install command
                  </Btn>
                  <Link to={`/onboarding?tab=sdk&project=${activeProjectId}`}>
                    <Btn variant="ghost" size="sm">Open SDK wizard →</Btn>
                  </Link>
                </div>
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
              <div className="space-y-6">
                {/* Use-case groups — the "what can I do?" view */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-fg">By use-case</p>
                    <span className="text-2xs text-fg-faint">(quick orientation)</span>
                  </div>
                  {USE_CASE_GROUPS.map((group) => {
                    const groupTools = TOOL_CATALOG.filter((t) => group.tools.includes(t.name))
                    if (groupTools.length === 0) return null
                    return (
                      <div key={group.label} className="rounded-md border border-edge-subtle bg-surface-raised p-3">
                        <p className="text-xs font-semibold text-fg mb-0.5">{group.label}</p>
                        <p className="text-2xs text-fg-muted mb-2">{group.description}</p>
                        <div className="flex flex-wrap gap-1">
                          {groupTools.map((t) => (
                            <span key={t.name} className="font-mono text-2xs rounded-sm border border-edge-subtle bg-surface-overlay px-1.5 py-0.5 text-fg-secondary" title={t.useCase}>
                              {t.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div>
                  <SignalChip tone="info" className="mb-2 uppercase tracking-wider font-medium">
                    Read — always safe to loop on ({readTools.length})
                  </SignalChip>
                  <div className="grid gap-2 md:grid-cols-2" data-testid="mcp-tool-catalog-read">
                    {readTools.map((tool) => (
                      <ToolCard key={tool.name} tool={tool} />
                    ))}
                  </div>
                </div>
                <div>
                  <SignalChip tone="warn" className="mb-2 uppercase tracking-wider font-medium">
                    Write — mutate project state ({writeTools.length})
                  </SignalChip>
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
                    className="rounded-md border border-edge-subtle bg-surface-raised p-3 motion-safe:transition-colors hover:border-edge"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                      <SignalChip tone="neutral" className="font-mono text-xs wrap-anywhere max-w-full">
                        {r.uri}
                      </SignalChip>
                      <Badge className={scopeBadgeTone(r.scope)}>{r.scope}</Badge>
                    </div>
                    <ContainedBlock tone="muted" className="text-xs leading-snug">
                      {r.description}
                    </ContainedBlock>
                  </div>
                ))}
              </div>
            )}

            {catalogTab === 'prompts' && (
              <div className="space-y-2" data-testid="mcp-prompt-catalog">
                {PROMPT_CATALOG.map((p) => (
                  <div
                    key={p.name}
                    className="rounded-md border border-edge-subtle bg-surface-raised p-3 motion-safe:transition-colors hover:border-edge"
                  >
                    <div className="text-sm font-semibold text-fg">{p.title}</div>
                    <SignalChip tone="neutral" className="font-mono text-2xs mt-0.5 mb-1">
                      /{p.name}
                    </SignalChip>
                    <ContainedBlock tone="muted" className="text-xs leading-snug">
                      {p.description}
                    </ContainedBlock>
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
                className="rounded-md border border-edge-subtle bg-surface-raised p-3 space-y-2 motion-safe:transition-colors hover:border-edge"
              >
                <div className="text-xs font-semibold text-fg">{uc.title}</div>
                <div className="text-sm text-fg-secondary leading-snug">
                  <span className="text-accent">“</span>
                  {uc.ask}
                  <span className="text-accent">”</span>
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {uc.calls.map((c) => (
                    <SignalChip key={c} tone="neutral" className="font-mono text-2xs">
                      {c}
                    </SignalChip>
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
