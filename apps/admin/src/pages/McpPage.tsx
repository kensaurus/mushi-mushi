/**
 * FILE: apps/admin/src/pages/McpPage.tsx
 * PURPOSE: MCP setup console — key readiness, copy-paste snippets, and tool catalog
 *          for the active project.
 */

import { useSearchParams } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Section,
  Badge,
  Btn,
  ErrorAlert,
  SegmentedControl,
  FreshnessPill, } from '../components/ui'
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
import { McpStatusBanner } from '../components/mcp/McpStatusBanner'
import { McpConnectGuide } from '../components/mcp/McpConnectGuide'
import { McpSnapshotStrip } from '../components/mcp/McpSnapshotStrip'
import { ContainedBlock } from '../components/report-detail/ReportSurface'
import { EMPTY_MCP_STATS } from '../components/mcp/types'
import type { CatalogTabId, McpProjectsResponse, McpStats, McpTabId } from '../components/mcp/types'
import { PanelSkeleton } from '../components/skeletons/PanelSkeleton'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { McpExamplesPanel } from '../components/mcp/McpExamplesPanel'
import { McpOverviewPanel } from '../components/mcp/McpOverviewPanel'
import { McpCatalogPanel } from '../components/mcp/McpCatalogPanel'
import { McpSetupPanel } from '../components/mcp/McpSetupPanel'
import type { McpQuickstartStepProps } from '../components/mcp/McpQuickstartStep'
import {
  MCP_PAGE_TABS,
  buildCursorJson,
  buildEnvBlock,
  buildHttpCursorJson,
  isCatalogTabId,
  resolveMcpTab,
  validateMcpJsonSyntax,
} from '../lib/mcpPageHelpers'
import { CHIP_TONE } from '../lib/chipTone'

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
  const activeMeta = MCP_PAGE_TABS.find((t) => t.id === activeTab) ?? MCP_PAGE_TABS[0]
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


  const hasReadKey = stats.mcpReadKeyCount > 0
  const hasWriteKey = stats.mcpWriteKeyCount > 0
  const step1Tone: McpQuickstartStepProps['tone'] = hasReadKey ? 'done' : 'next'
  const step2Tone: McpQuickstartStepProps['tone'] = hasReadKey ? (stats.connectedKeyCount > 0 ? 'done' : 'next') : 'idle'
  const step3Tone: McpQuickstartStepProps['tone'] = stats.connectedKeyCount > 0 ? 'done' : hasReadKey ? 'next' : 'idle'

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
                  ? CHIP_TONE.okSubtle
                  : bannerSeverity === 'warn'
                    ? CHIP_TONE.warnSubtle
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
        <McpOverviewPanel
          stats={stats}
          lastFetchedAt={lastFetchedAt}
          isValidating={isValidating}
          hideOverviewChrome={ux.hideOverviewChrome}
          onOpenExamples={() => setTab('examples')}
          onCopySnippet={copySnippet}
        />
      )}

      {activeTab !== 'overview' && (
      <Section title={activeTab === 'setup' ? 'Agent setup' : activeTab === 'catalog' ? 'Tool catalog' : 'Agent examples'}>
        {ux.hideMcpSnapshot && (
        <ContainedBlock tone="muted" className="mb-4">
          <p className="text-2xs leading-relaxed text-fg-muted">{activeMeta.description}</p>
        </ContainedBlock>
        )}

        {activeTab === 'setup' && (
          <McpSetupPanel
            stats={stats}
            activeProjectId={activeProjectId}
            displayName={displayName}
            projectId={projectId}
            projects={projectsQuery.data?.projects}
            hasReadKey={hasReadKey}
            hasWriteKey={hasWriteKey}
            step1Tone={step1Tone}
            step2Tone={step2Tone}
            step3Tone={step3Tone}
            snippetMode={snippetMode}
            onSnippetModeChange={setSnippetMode}
            copied={copied}
            snippet={snippet}
            syntaxCheck={syntaxCheck}
            testingConnection={testingConnection}
            connectionTestResult={connectionTestResult}
            onTestConnection={() => void testMcpConnection()}
            monorepoNote={monorepoNote}
            onMonorepoNoteChange={setMonorepoNote}
            monoWarnings={monoWarnings}
            onMonoWarningsChange={setMonoWarnings}
            detectOpen={detectOpen}
            onDetectOpenChange={setDetectOpen}
            detectText={detectText}
            onDetectTextChange={setDetectText}
            mintingKey={mintingKey}
            revealedMcpKey={revealedMcpKey}
            onMintMcpReadKey={() => void mintMcpReadKey()}
            sdkSnippetLang={sdkSnippetLang}
            onSdkSnippetLangChange={setSdkSnippetLang}
            mcpJsonDraft={mcpJsonDraft}
            onMcpJsonDraftChange={setMcpJsonDraft}
            onCopySnippet={(payload, label) => void copySnippet(payload, label)}
            onLoadGeneratedSnippet={() =>
              setMcpJsonDraft(snippetMode === 'env' ? buildCursorJson(projectId, displayName) : snippet)
            }
          />
        )}

        {activeTab === 'catalog' && (
          <McpCatalogPanel
            catalogTab={catalogTab}
            catalogOptions={catalogOptions}
            onCatalogTab={setCatalogTab}
            toolCount={stats.toolCount}
          />
        )}

        {activeTab === 'examples' && <McpExamplesPanel />}
      </Section>
      )}
    </div>
  )
}
