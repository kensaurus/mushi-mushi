/**
 * FullStackAuditPage — One-click PM Full-Stack Audit.
 *
 * Gives a product manager a health scorecard for their project:
 *   • Backend link status (Supabase PAT + ref configured)
 *   • DB advisor findings (security/performance)
 *   • Tables without RLS
 *   • Recent backend error log count
 *   • Gate run results (Gates 3–8: API contract, spec drift, orphan endpoints,
 *     unknown calls, schema drift, status claim)
 *
 * One "Run audit" button fans out to POST /v1/admin/projects/:id/audit
 * which returns a pre-computed scorecard within ~10 s.
 */

import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { ResponsiveTable } from '../components/ResponsiveTable'
import {
  Card,
  Badge,
  Btn,
  Section,
  ErrorAlert,
} from '../components/ui'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { FullStackAuditReadout } from '../components/fullstack-audit/FullStackAuditReadout'
import {
  EMPTY_FULLSTACK_AUDIT_STATS,
  type FullstackAuditStats,
} from '../components/fullstack-audit/FullstackAuditStatsTypes'

// ─── Local type definitions (mirrors fullstack-audit.ts response shapes) ─────

interface AuditFinding {
  severity: 'error' | 'warn' | 'info'
  category: string
  title: string
  detail: string
  fix_available?: boolean
}

interface AuditGateRun {
  gate: string
  run_id?: string
  status: string
  findings_count: number
}

interface AuditResult {
  audit_at: string
  backend_linked: boolean
  schema_snapshot_taken: boolean
  recent_backend_errors: number
  summary: {
    overall: 'pass' | 'warn' | 'fail'
    error_count: number
    warn_count: number
    info_count: number
  }
  findings: AuditFinding[]
  gate_runs: AuditGateRun[]
}

// ─── Finding severity badge ───────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: AuditFinding['severity'] }) {
  if (severity === 'error')
    return <Badge className="bg-danger-subtle text-danger">Error</Badge>
  if (severity === 'warn')
    return <Badge className="bg-warn-muted/50 text-warning-foreground">Warn</Badge>
  return <Badge className="bg-surface-overlay text-fg-secondary">Info</Badge>
}

// ─── Gate status badge ────────────────────────────────────────────────────────

function GateStatusBadge({ status }: { status: string }) {
  if (status === 'pass') return <Badge className="bg-ok-muted text-ok">Pass</Badge>
  if (status === 'fail') return <Badge className="bg-danger-subtle text-danger">Fail</Badge>
  if (status === 'warn') return <Badge className="bg-warn-muted/50 text-warning-foreground">Warn</Badge>
  return <Badge className="bg-surface-overlay text-fg-secondary">{status}</Badge>
}

// ─── Overall scorecard header ─────────────────────────────────────────────────

function OverallScorecard({ result }: { result: AuditResult }) {
  const { overall, error_count, warn_count, info_count } = result.summary
  const overallCls =
    overall === 'fail'
      ? 'border-danger/40 bg-danger-subtle'
      : overall === 'warn'
        ? 'border-warn/40 bg-warn/10'
        : 'border-ok/40 bg-ok-muted'
  const overallLabel =
    overall === 'fail' ? 'Issues found' : overall === 'warn' ? 'Warnings' : 'All clear'
  const overallTextCls =
    overall === 'fail' ? 'text-danger' : overall === 'warn' ? 'text-warn' : 'text-ok'

  return (
    <div className={`rounded-md border px-4 py-3 ${overallCls}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className={`text-sm font-semibold ${overallTextCls}`}>{overallLabel}</p>
          <p className="mt-0.5 text-xs text-fg-secondary">
            {error_count} error{error_count !== 1 ? 's' : ''} ·{' '}
            {warn_count} warning{warn_count !== 1 ? 's' : ''} ·{' '}
            {info_count} info
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-fg-faint">
            Audited {new Date(result.audit_at).toLocaleString()}
          </p>
          <p className="text-xs text-fg-faint">
            {result.backend_linked ? '✓ Backend linked' : '⚠ Backend not linked'}
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Findings list ────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  schema_drift: 'Schema Drift',
  api_contract: 'API Contract',
  rls_gap: 'RLS Gap',
  orphan_endpoint: 'Orphan Endpoint',
  unknown_call: 'Unknown Call',
  backend_error: 'Backend Errors',
  spec_drift: 'Spec Drift',
  advisor: 'DB Advisor',
}

function FindingsList({ findings }: { findings: AuditFinding[] }) {
  if (findings.length === 0) {
    return (
      <div className="rounded-md border border-edge-subtle px-4 py-3 text-sm text-fg-secondary">
        No findings. Your project looks healthy.
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      {findings.map((f, i) => (
        <div
          key={i}
          className="flex items-start gap-2.5 rounded-md border border-edge-subtle bg-surface-raised px-3 py-2.5"
        >
          <SeverityBadge severity={f.severity} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium text-fg">{f.title}</p>
              <span className="rounded-sm bg-surface-overlay/60 px-1.5 py-0.5 text-3xs text-fg-faint">
                {CATEGORY_LABELS[f.category] ?? f.category}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-fg-secondary">{f.detail}</p>
          </div>
          {f.fix_available && (
            <Badge className="shrink-0 bg-brand/10 text-brand">Fix available</Badge>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Gate run summary table ───────────────────────────────────────────────────

const GATE_LABELS: Record<string, string> = {
  api_contract: 'API Contract (G3)',
  spec_drift: 'Spec Drift (G6)',
  orphan_endpoint: 'Orphan Endpoints (G7)',
  unknown_call: 'Unknown Calls (G8)',
  schema_drift: 'Schema Drift',
  dead_handler: 'Dead Handler (G1)',
  mock_leak: 'Mock Leak (G2)',
  status_claim: 'Status Claim (G5)',
}

function GateRunsTable({ runs }: { runs: AuditGateRun[] }) {
  if (runs.length === 0) {
    return (
      <p className="text-xs text-fg-faint">
        No gate runs in the past 7 days. Push to GitHub to trigger the mushi-mushi-gates Action.
      </p>
    )
  }
  return (
    <ResponsiveTable ariaLabel="Recent gate runs">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-edge-subtle bg-surface-overlay/30">
            <th className="px-3 py-2 text-left font-medium text-fg-secondary">Gate</th>
            <th className="px-3 py-2 text-left font-medium text-fg-secondary">Status</th>
            <th className="px-3 py-2 text-right font-medium text-fg-secondary">Findings</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.run_id ?? run.gate} className="border-b border-edge-subtle/30 last:border-0">
              <td className="px-3 py-2 font-medium text-fg">
                {GATE_LABELS[run.gate] ?? run.gate}
              </td>
              <td className="px-3 py-2">
                <GateStatusBadge status={run.status} />
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-fg-secondary">
                {run.findings_count > 0 ? (
                  <span className="font-semibold text-danger">{run.findings_count}</span>
                ) : (
                  run.findings_count
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ResponsiveTable>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function FullStackAuditPage() {
  const projectId = useActiveProjectId()
  const statsPath = projectId ? `/v1/admin/fullstack-audit/stats?project_id=${projectId}` : null
  const {
    data: auditStatsData,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<FullstackAuditStats>(statsPath, { deps: [projectId] })
  const auditStats = auditStatsData ?? EMPTY_FULLSTACK_AUDIT_STATS
  const [result, setResult] = useState<AuditResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runAudit = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<AuditResult>(`/v1/admin/projects/${projectId}/audit`, {
        method: 'POST',
        body: '{}',
      })
      if (res.ok && res.data) {
        setResult(res.data)
      } else {
        setError(res.error?.message ?? 'Audit failed. Please try again.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  return (
    <div className="space-y-5 pb-16">
      <PageHeaderBar
        title="Full-Stack Audit"
        description="One-click health scorecard for your project: backend schema, API contracts, gate results, and security gaps."
        helpTitle="Full-Stack Audit"
        helpWhatIsIt="A one-click health scorecard that fans out to your linked Supabase backend, runs Gates 3–8, and returns PM-readable findings."
        helpUseCases={[
          'Spot broken API contracts before users hit them',
          'Identify backend endpoints never called by the frontend (orphan features)',
          'Detect schema changes that break active API dependencies',
          'See RLS gaps and DB advisor warnings in one view',
        ]}
        helpHowToUse="Set supabase_project_ref in Project Settings and add your Supabase PAT under Settings → API Keys (slug: supabase). Then click Run audit."
      >
        <Btn
          variant="primary"
          size="md"
          onClick={runAudit}
          disabled={loading || !projectId}
          loading={loading}
        >
          {loading ? 'Running audit…' : 'Run audit'}
        </Btn>
      </PageHeaderBar>

      {projectId ? (
        <PagePosture
          slots={[
            {
              priority: POSTURE_PRIORITY.guide,
              children: (
                <FullStackAuditReadout
                  stats={auditStats}
                  fetchedAt={statsFetchedAt}
                  isValidating={statsValidating}
                />
              ),
            },
          ]}
        />
      ) : null}

      {!projectId && (
        <Card>
          <p className="text-sm text-fg-secondary">Select a project to run an audit.</p>
        </Card>
      )}

      {error && <ErrorAlert message={error} />}

      {!result && !loading && !error && projectId && (
        <Card>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="text-4xl">🔍</div>
            <p className="text-sm font-medium text-fg">No audit data yet</p>
            <p className="max-w-sm text-xs text-fg-secondary">
              Click "Run audit" to generate a full-stack health scorecard for this project. The
              audit typically completes in 5–10 seconds.
            </p>
          </div>
        </Card>
      )}

      {result && (
        <div className="space-y-4">
          <OverallScorecard result={result} />

          <Card className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <p className="text-xs text-fg-secondary">
              Bundle sizes and god-file LOC budgets are tracked on{' '}
              <Link to="/code-health" className="text-accent hover:underline">
                Code Health
              </Link>
              .
            </p>
          </Card>

          <Section title="Findings">
            <FindingsList findings={result.findings} />
          </Section>

          <Section title="Gate Results (last 7 days)">
            <GateRunsTable runs={result.gate_runs} />
          </Section>

          {result.backend_linked && (
            <Card>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex-shrink-0 text-ok text-sm">✓</div>
                <div>
                  <p className="text-sm font-medium text-fg">Backend linked</p>
                  <p className="text-xs text-fg-secondary">
                    {result.schema_snapshot_taken
                      ? 'Schema snapshot captured. The drift scanner will compare future snapshots to detect unexpected changes.'
                      : 'Schema snapshot not yet available.'}
                    {result.recent_backend_errors > 0 && (
                      <span className="ml-2 font-semibold text-warn">
                        {result.recent_backend_errors} recent backend error
                        {result.recent_backend_errors !== 1 ? 's' : ''} detected.
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
