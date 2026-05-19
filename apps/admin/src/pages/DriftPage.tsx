/**
 * FILE: apps/admin/src/pages/DriftPage.tsx
 * PURPOSE: Contract drift console — view findings, dismiss, create tests,
 *   inspect contract snapshots, diff API vs DB.
 *   Phase 4d of the closed-loop evolution plan.
 *
 *   Tabs:
 *     Findings    — open findings table with dismiss / create-lesson actions
 *     Snapshots   — contract snapshot history + edge count trend
 *     Scanner     — trigger a manual drift scan
 */

import { useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { usePublishPageContext } from '../lib/pageContext'
import { useActiveProjectSignal } from '../lib/activeProject'
import { useToast } from '../lib/toast'
import {
  PageHeader,
  PageHelp,
  Card,
  Section,
  Badge,
  Btn,
  EmptyState,
  ErrorAlert,
  RelativeTime,
  StatCard,
  SegmentedControl,
} from '../components/ui'
import { Drawer } from '../components/Drawer'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { PdcaContextHint } from '../components/PdcaContextHint'

// ─── Types ──────────────────────────────────────────────────────────────────

interface DriftFinding {
  id: string
  project_id: string
  snapshot_id: string | null
  finding_type: string
  severity: 'info' | 'warn' | 'critical'
  surface: string
  path: string | null
  message: string
  expected: unknown
  actual: unknown
  status: 'open' | 'dismissed'
  dismissed_at: string | null
  created_at: string
}

interface ContractSnapshot {
  id: string
  project_id: string
  snapshot_at: string
  edge_count: number
  created_at: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SEVERITY_CLS: Record<DriftFinding['severity'], string> = {
  info:     'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  warn:     'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

const SEVERITY_LABEL: Record<DriftFinding['severity'], string> = {
  info: 'Info', warn: 'Warn', critical: 'Critical',
}

function severityBadge(s: DriftFinding['severity']) {
  return <Badge className={SEVERITY_CLS[s]}>{SEVERITY_LABEL[s]}</Badge>
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function DriftPage() {
  const [searchParams] = useSearchParams()
  const toast = useToast()
  const [tab, setTab] = useState<'findings' | 'snapshots' | 'scanner'>('findings')
  const [selectedFinding, setSelectedFinding] = useState<DriftFinding | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const activeProjectSignal = useActiveProjectSignal()
  const projectId = searchParams.get('project_id') || activeProjectSignal

  usePublishPageContext({
    route: '/drift',
    title: 'Contract Drift',
    summary: 'Frontend/API contract drift detection — spot schema or route divergence before users do.',
    filters: { tab, project_id: projectId ?? undefined },
  })

  const {
    data: findingsData,
    loading: findingsLoading,
    error: findingsError,
    reload: reloadFindings,
  } = usePageData<{ data: DriftFinding[]; total: number }>(
    projectId ? `/v1/admin/drift?project_id=${projectId}&limit=100` : null,
    { deps: [projectId] },
  )

  const {
    data: snapshotsData,
    loading: snapshotsLoading,
    reload: reloadSnapshots,
  } = usePageData<{ data: ContractSnapshot[] }>(
    projectId ? `/v1/admin/drift/snapshots?project_id=${projectId}` : null,
    { deps: [projectId] },
  )

  const findings = findingsData?.data ?? []
  const snapshots = snapshotsData?.data ?? []

  const critical = findings.filter(f => f.severity === 'critical').length
  const warn = findings.filter(f => f.severity === 'warn').length

  const dismiss = useCallback(async (id: string) => {
    const res = await apiFetch(`/v1/admin/drift/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'dismissed' }),
    })
    if (!res.ok) { toast.error(res.error?.message ?? 'Failed'); return }
    reloadFindings()
    toast.success('Finding dismissed')
  }, [reloadFindings, toast])

  const createLesson = useCallback(async (id: string) => {
    const res = await apiFetch(`/v1/admin/drift/${id}/create-lesson`, { method: 'POST' })
    if (res.ok) { toast.success('Candidate lesson created'); reloadFindings() }
    else toast.error(res.error?.message ?? 'Failed to create lesson')
  }, [reloadFindings, toast])

  const tabs = [
    { id: 'findings',  label: `Findings (${findings.length})` },
    { id: 'snapshots', label: 'Snapshots' },
    { id: 'scanner',   label: 'Scanner' },
  ] as const

  return (
    <div className="space-y-4">
      <PageHeader
        title="Drift"
        description="Contract drift detection — compare OpenAPI spec, inventory nodes, and DB schema to find gaps before users do."
        contextChip={<PdcaContextHint stage="check" />}
      >
        <Btn variant="ghost" size="sm" onClick={() => setTab('scanner')}>Run scan</Btn>
      </PageHeader>

      <PageHelp
        title="Contract drift detection"
        whatIsIt="The drift-walker builds a contract snapshot then walks every route with Thompson-sampled priority — routes with more historical findings are checked first."
        useCases={[
          'Find API endpoints present in inventory but missing in OpenAPI spec',
          'Detect DB columns expected by the FE but removed from the schema',
          'Promote high-severity findings to candidate lessons',
        ]}
        howToUse="Select a project, run a scan from the Scanner tab, then triage findings. Dismiss false positives to train the sampler."
      />

      <Section title="Drift summary">
        <div className="mb-4 grid grid-cols-3 gap-3">
          <StatCard label="Open findings" value={findings.length} />
          <StatCard label="Critical" value={critical} />
          <StatCard label="Warn" value={warn} />
        </div>

        <SegmentedControl
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
          options={tabs}
          className="mb-6"
        />

        {tab === 'findings' && (
          <FindingsTab
            findings={findings}
            loading={findingsLoading}
            error={findingsError}
            onDismiss={dismiss}
            onCreateLesson={createLesson}
            onOpen={(f) => { setSelectedFinding(f); setDrawerOpen(true) }}
            projectId={projectId}
          />
        )}

        {tab === 'snapshots' && (
          <SnapshotsTab
            snapshots={snapshots}
            loading={snapshotsLoading}
            projectId={projectId}
          />
        )}

        {tab === 'scanner' && (
          <ScannerTab
            projectId={projectId}
            onDone={() => { reloadFindings(); reloadSnapshots(); setTab('findings') }}
          />
        )}
      </Section>

      {drawerOpen && selectedFinding && (
        <FindingDetailDrawer
          finding={selectedFinding}
          open={drawerOpen}
          onClose={() => { setDrawerOpen(false); setSelectedFinding(null) }}
          onDismiss={dismiss}
          onCreateLesson={createLesson}
        />
      )}
    </div>
  )
}

// ─── Findings tab ────────────────────────────────────────────────────────────

function FindingsTab({
  findings, loading, error, onDismiss, onCreateLesson, onOpen, projectId,
}: {
  findings: DriftFinding[]
  loading: boolean
  error: string | null
  onDismiss: (id: string) => void
  onCreateLesson: (id: string) => void
  onOpen: (f: DriftFinding) => void
  projectId: string
}) {
  if (!projectId) return <EmptyState title="Select a project" description="Pick a project from the switcher to see drift findings." />
  if (loading) return <TableSkeleton rows={5} />
  if (error) return <ErrorAlert message={error} />
  if (!findings.length) return (
    <EmptyState
      title="No open findings"
      description="Run a drift scan or wait for the scheduled walker. A clean bill of health means OpenAPI, inventory, and DB schema are in sync."
    />
  )

  const bySurface = findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.surface] = (acc[f.surface] ?? 0) + 1; return acc
  }, {})

  return (
    <div className="space-y-4">
      {Object.keys(bySurface).length > 1 && (
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {Object.entries(bySurface).map(([s, n]) => (
            <span key={s} className="rounded border px-2 py-0.5 font-mono">
              {s}: {n}
            </span>
          ))}
        </div>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left">Severity</th>
              <th className="px-3 py-2 text-left">Surface</th>
              <th className="px-3 py-2 text-left">Path</th>
              <th className="px-3 py-2 text-left">Message</th>
              <th className="px-3 py-2 text-left">Found</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {findings.map((f) => (
              <tr key={f.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-3 py-2">{severityBadge(f.severity)}</td>
                <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{f.surface}</td>
                <td className="px-3 py-2 max-w-[180px] truncate font-mono text-xs">{f.path ?? '—'}</td>
                <td className="px-3 py-2 max-w-[280px] truncate text-xs">{f.message}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground"><RelativeTime value={f.created_at} /></td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1 justify-end">
                    <Btn size="sm" variant="ghost" onClick={() => onOpen(f)}>View</Btn>
                    {f.severity === 'critical' && (
                      <Btn size="sm" variant="ghost" onClick={() => onCreateLesson(f.id)}>→ Lesson</Btn>
                    )}
                    <Btn size="sm" variant="ghost" onClick={() => onDismiss(f.id)}>Dismiss</Btn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

// ─── Snapshots tab ────────────────────────────────────────────────────────────

function SnapshotsTab({ snapshots, loading, projectId }: { snapshots: ContractSnapshot[]; loading: boolean; projectId: string }) {
  if (!projectId) return <EmptyState title="Select a project" />
  if (loading) return <TableSkeleton rows={5} />
  if (!snapshots.length) return <EmptyState title="No snapshots" description="Trigger a scan to build the first contract snapshot." />

  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
            <th className="px-3 py-2 text-left">Snapshot</th>
            <th className="px-3 py-2 text-right">Edges</th>
            <th className="px-3 py-2 text-left">Taken</th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map((s) => (
            <tr key={s.id} className="border-b last:border-0 hover:bg-muted/20">
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{s.id.slice(0, 8)}…</td>
              <td className="px-3 py-2 text-right tabular-nums">{s.edge_count}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground"><RelativeTime value={s.snapshot_at} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

// ─── Scanner tab ─────────────────────────────────────────────────────────────

function ScannerTab({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ findings_inserted: number; findings_found: number; snapshot_id: string } | null>(null)
  const [maxPaths, setMaxPaths] = useState(200)

  const run = async () => {
    if (!projectId) { toast.error('Select a project first'); return }
    setLoading(true)
    setResult(null)
    try {
      const res = await apiFetch<{ findings_inserted: number; findings_found: number; snapshot_id: string }>(
        '/v1/admin/drift/scan',
        { method: 'POST', body: JSON.stringify({ project_id: projectId, max_paths: maxPaths }) },
      )
      if (!res.ok) throw new Error(res.error?.message ?? 'Scan failed')
      setResult(res.data ?? { findings_inserted: 0, findings_found: 0, snapshot_id: '' })
      toast.success(`Scan complete — ${res.data?.findings_inserted ?? 0} new findings`)
      onDone()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="max-w-lg p-6 space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Manual drift scan</h2>
        <p className="text-sm text-muted-foreground">
          Builds a fresh contract snapshot then walks routes with Thompson-sampled priority.
          Findings are deduplicated against the last 24 h.
        </p>
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Max paths to walk</span>
        <input
          type="number"
          min={10} max={1000}
          value={maxPaths}
          onChange={e => setMaxPaths(parseInt(e.target.value, 10))}
          className="block w-32 rounded-md border border-edge-subtle bg-surface px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50"
        />
      </label>
      <Btn variant="primary" onClick={run} loading={loading} className="w-full sm:w-auto">
        {loading ? 'Scanning…' : 'Run scan'}
      </Btn>
      {result && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-700 dark:bg-emerald-950/30">
          <p className="font-medium text-emerald-800 dark:text-emerald-300">Scan complete</p>
          <p className="text-emerald-700 dark:text-emerald-400">
            {result.findings_found} findings discovered · {result.findings_inserted} new stored
          </p>
          <p className="text-xs text-emerald-600 dark:text-emerald-500 font-mono mt-1">
            snapshot: {result.snapshot_id?.slice(0, 8)}…
          </p>
        </div>
      )}
    </Card>
  )
}

// ─── Finding detail drawer ────────────────────────────────────────────────────

function FindingDetailDrawer({
  finding, open, onClose, onDismiss, onCreateLesson,
}: {
  finding: DriftFinding
  open: boolean
  onClose: () => void
  onDismiss: (id: string) => void
  onCreateLesson: (id: string) => void
}) {
  return (
    <Drawer open={open} onClose={onClose} title={`${finding.finding_type} — ${finding.path ?? 'N/A'}`}>
      <div className="space-y-5 pb-8">
        <div className="flex flex-wrap items-center gap-2">
          {severityBadge(finding.severity)}
          <Badge className="bg-muted text-muted-foreground">{finding.surface}</Badge>
        </div>

        <div className="rounded-md bg-muted/40 px-4 py-3 text-sm">{finding.message}</div>

        {finding.expected != null && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">Expected</p>
            <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">{JSON.stringify(finding.expected, null, 2)}</pre>
          </div>
        )}

        {finding.actual != null && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">Actual</p>
            <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">{JSON.stringify(finding.actual, null, 2)}</pre>
          </div>
        )}

        <div className="rounded-md border bg-muted/20 px-4 py-3 space-y-1 text-xs text-muted-foreground">
          <div className="flex gap-2"><span className="w-28">Type</span><span className="font-mono">{finding.finding_type}</span></div>
          <div className="flex gap-2"><span className="w-28">Path</span><span className="font-mono">{finding.path ?? '—'}</span></div>
          <div className="flex gap-2"><span className="w-28">Surface</span><span>{finding.surface}</span></div>
          <div className="flex gap-2"><span className="w-28">Found</span><RelativeTime value={finding.created_at} /></div>
        </div>

        <div className="flex gap-2 pt-2">
          {finding.severity === 'critical' && (
            <Btn variant="primary" size="sm" onClick={() => { onCreateLesson(finding.id); onClose() }}>
              Promote to lesson
            </Btn>
          )}
          <Btn variant="ghost" size="sm" onClick={() => { onDismiss(finding.id); onClose() }}>
            Dismiss
          </Btn>
        </div>
      </div>
    </Drawer>
  )
}
