/**
 * FILE: apps/admin/src/pages/IteratePage.tsx
 * PURPOSE: PDCA iteration console — queue runs, watch producer/critic progress,
 *          inspect critiques, export results.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useRealtimeReload } from '../lib/realtime'
import { usePublishPageContext } from '../lib/pageContext'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useSetupStatus } from '../lib/useSetupStatus'
import { SetupNudge } from '../components/SetupNudge'
import { useToast } from '../lib/toast'
import {
  PageHeader,
  PageHelp,
  Section,
  Btn,
  ErrorAlert,
  StatCard,
  SegmentedControl,
} from '../components/ui'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { PdcaContextHint } from '../components/PdcaContextHint'
import { PdcaStatusBanner } from '../components/iterate/PdcaStatusBanner'
import { PdcaRunTable } from '../components/iterate/PdcaRunTable'
import { NewRunForm } from '../components/iterate/NewRunForm'
import { PdcaRunDrawer } from '../components/iterate/PdcaRunDrawer'
import type { PdcaRun, PdcaStats } from '../components/iterate/types'

type TabId = 'runs' | 'new'

const TABS: Array<{ id: TabId; label: string; description: string }> = [
  {
    id: 'runs',
    label: 'Runs',
    description: 'All producer/critic loops for the active project — trigger, abort, or open detail.',
  },
  {
    id: 'new',
    label: 'New Run',
    description: 'Queue a target URL with a critic persona and score target.',
  },
]

function isTabId(v: string | null): v is TabId {
  return TABS.some((t) => t.id === v)
}

export function IteratePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const param = searchParams.get('tab')
  const activeTab: TabId = isTabId(param) ? param : 'runs'
  const activeMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]

  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null
  const toast = useToast()

  const [selectedRun, setSelectedRun] = useState<PdcaRun | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const listPath = activeProjectId ? `/v1/admin/pdca?project_id=${activeProjectId}&limit=50` : null
  const statsPath = activeProjectId ? `/v1/admin/pdca/stats?project_id=${activeProjectId}` : null

  const {
    data: runs,
    loading: runsLoading,
    error: runsError,
    reload: reloadRuns,
    lastFetchedAt,
    isValidating,
  } = usePageData<PdcaRun[]>(listPath, { deps: [activeProjectId] })

  const { data: statsData, reload: reloadStats } = usePageData<PdcaStats>(statsPath, {
    deps: [activeProjectId],
  })

  const stats = statsData ?? {
    total: 0,
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    aborted: 0,
    avgFinalScore: null,
    lastRunAt: null,
  }

  const runList = runs ?? []
  const activeRuns = runList.filter((r) => r.status === 'running' || r.status === 'queued')

  const reloadAll = useCallback(() => {
    reloadRuns()
    reloadStats()
  }, [reloadRuns, reloadStats])

  useRealtimeReload(['pdca_runs', 'pdca_iterations'], reloadAll)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (activeRuns.length > 0 && !pollRef.current) {
      pollRef.current = setInterval(reloadAll, 4000)
    } else if (activeRuns.length === 0 && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [activeRuns.length, reloadAll])

  const setTab = useCallback(
    (tab: TabId) => {
      const next = new URLSearchParams(searchParams)
      if (tab === 'runs') next.delete('tab')
      else next.set('tab', tab)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  usePublishPageContext({
    route: '/iterate',
    title: `${activeMeta.label} · Iterate`,
    summary: activeMeta.description,
    filters: { tab: activeTab, project_id: activeProjectId ?? undefined },
    criticalCount: stats.running + stats.queued,
  })

  const tabOptions = useMemo(
    () => [
      { id: 'runs' as const, label: 'Runs', count: runList.length },
      { id: 'new' as const, label: 'New Run' },
    ],
    [runList.length],
  )

  const openDetail = useCallback(async (run: PdcaRun) => {
    const res = await apiFetch<PdcaRun>(`/v1/admin/pdca/${run.id}`)
    if (res.ok && res.data) {
      setSelectedRun(res.data)
      setDrawerOpen(true)
    } else {
      toast.error('Failed to load run', res.error?.message)
    }
  }, [toast])

  const abortRun = useCallback(
    async (runId: string) => {
      const res = await apiFetch(`/v1/admin/pdca/${runId}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error(res.error?.message ?? 'Abort failed')
        return
      }
      reloadAll()
      toast.success('Run aborted')
    },
    [reloadAll, toast],
  )

  const triggerRun = useCallback(
    async (runId: string) => {
      const res = await apiFetch(`/v1/admin/pdca/${runId}/trigger`, { method: 'POST' })
      if (res.ok) {
        toast.success('Runner triggered')
        reloadAll()
      } else {
        toast.error(res.error?.message ?? 'Trigger failed')
      }
    },
    [reloadAll, toast],
  )

  const refreshSelectedRun = useCallback(async () => {
    if (!selectedRun) return
    const res = await apiFetch<PdcaRun>(`/v1/admin/pdca/${selectedRun.id}`)
    if (res.ok && res.data) setSelectedRun(res.data)
  }, [selectedRun])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Iterate"
        description="Autonomous PDCA loops — queue a run, watch producer → critic iterations, export critique when the score target is met."
        contextChip={<PdcaContextHint stage="act" />}
      >
        <Btn variant="primary" size="sm" onClick={() => setTab('new')} disabled={!activeProjectId}>
          + New Run
        </Btn>
      </PageHeader>

      <PageHelp
        title="PDCA autonomous iteration"
        whatIsIt="Each run fetches a target URL, generates improved markup (producer), then critiques it (critic) using a configurable LLM persona. The loop continues until the target score is reached or max iterations."
        useCases={[
          "Improve a dashboard page's visual hierarchy automatically",
          'Run a WCAG accessibility critique cycle',
          'Use a conversion-rate-optimizer persona to suggest CTA copy changes',
        ]}
        howToUse="Queue a run with a target URL, goal, and persona. Click Trigger on queued runs (or wait for cron). Open a run to inspect the score timeline and copy critiques to a PR."
      />

      {!activeProjectId ? (
        <SetupNudge
          requires={['project']}
          emptyTitle="Select a project"
          emptyDescription="PDCA runs are scoped to the active project in the header."
        />
      ) : (
        <PdcaStatusBanner runs={runList} projectName={projectName} />
      )}

      <Section title="PDCA workspace" freshness={{ at: lastFetchedAt, isValidating }}>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total runs" value={stats.total} hint="All runs for this project" />
          <StatCard
            label="Active"
            value={stats.running + stats.queued}
            hint={`${stats.running} running · ${stats.queued} queued`}
          />
          <StatCard label="Succeeded" value={stats.succeeded} hint="Runs that met exit criteria" />
          <StatCard
            label="Avg score"
            value={stats.avgFinalScore != null ? `${Math.round(stats.avgFinalScore * 100)}%` : '—'}
            hint="Mean final score across completed runs"
          />
        </div>

        <SegmentedControl
          value={activeTab}
          onChange={setTab}
          options={tabOptions}
          ariaLabel="Iterate sections"
          className="mb-4"
        />

        <p className="mb-4 text-2xs text-fg-muted">{activeMeta.description}</p>

        {!activeProjectId ? (
          <SetupNudge
            requires={['project']}
            emptyTitle="Select a project"
            emptyDescription="Pick a project in the header to view runs or queue a new PDCA loop."
          />
        ) : activeTab === 'runs' ? (
          <>
            {runsLoading && (
              <TableSkeleton rows={5} showFilters={false} label="Loading PDCA runs" />
            )}
            {runsError && (
              <ErrorAlert message={`Failed to load runs: ${runsError}`} onRetry={reloadRuns} />
            )}
            {!runsLoading && !runsError && (
              <PdcaRunTable
                runs={runList}
                projectName={projectName}
                onOpen={(r) => void openDetail(r)}
                onAbort={(id) => void abortRun(id)}
                onTrigger={(id) => void triggerRun(id)}
              />
            )}
          </>
        ) : (
          <NewRunForm
            projectId={activeProjectId}
            projectName={projectName}
            onCreated={() => {
              setTab('runs')
              reloadAll()
            }}
          />
        )}
      </Section>

      {drawerOpen && selectedRun && (
        <PdcaRunDrawer
          run={selectedRun}
          open={drawerOpen}
          onClose={() => {
            setDrawerOpen(false)
            setSelectedRun(null)
          }}
          onAbort={(id) => void abortRun(id)}
          onTrigger={(id) => void triggerRun(id)}
          onRefresh={() => void refreshSelectedRun()}
        />
      )}
    </div>
  )
}
