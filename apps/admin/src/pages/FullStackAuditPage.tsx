/**
 * FullStackAuditPage — One-click PM Full-Stack Audit.
 *
 * The body is the open findings of every check (GateFindingsSection, the
 * newest run per gate, GET /v1/admin/inventory/:id/findings, ADR 0018): the
 * same rule the sidebar and readout counts use (GET /v1/admin/fullstack-audit/stats).
 *
 * "Run audit" (POST /v1/admin/projects/:id/audit) reads the linked Supabase
 * backend (advisors, RLS, recent API errors), restarts stale checks, and then
 * refreshes that one findings list. Its own card keeps only what the list
 * cannot show: the verdict, the backend problems, which checks were restarted,
 * and every read that failed (`read_errors`), so a partial read reads
 * "Incomplete", never "All clear".
 */

import { useCallback, useState } from 'react'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { Card, Badge, Btn, Callout, Section, ErrorAlert } from '../components/ui'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { apiFetch, invalidateApiCache } from '../lib/supabase'
import { describeApiError } from '../lib/humanizeApiError'
import { usePageData } from '../lib/usePageData'
import { FullStackAuditReadout } from '../components/fullstack-audit/FullStackAuditReadout'
import {
  EMPTY_FULLSTACK_AUDIT_STATS,
  type FullstackAuditStats,
} from '../components/fullstack-audit/FullstackAuditStatsTypes'
import { CHIP_TONE } from '../lib/chipTone'
import { gateLabel } from '../lib/gateLabels'
import { GateFindingsSection } from '../components/gates/GateFindingsSection'

// ─── Local type definitions (mirrors fullstack-audit.ts response shapes) ─────

interface AuditFinding {
  severity: 'error' | 'warn' | 'info'
  category: string
  title: string
  detail: string
  fix_available?: boolean
}

interface AuditResult {
  audit_at: string
  /** null when the project settings could not be read. */
  backend_linked: boolean | null
  recent_backend_errors: number
  /** Reads that failed; the verdict is then `unknown` unless an error was found. */
  read_errors: string[]
  summary: {
    overall: 'pass' | 'warn' | 'fail' | 'unknown'
  }
  findings: AuditFinding[]
  /** Stale checks this audit restarted; absent on an older server. */
  gate_refresh?: { triggered: string[]; skipped: Array<{ gate: string; reason: string }> }
}

/** Audit findings the per-check list does not hold: the linked backend's own reads. */
const BACKEND_CATEGORIES = new Set(['advisor', 'rls_gap', 'backend_error'])

function SeverityBadge({ severity }: { severity: AuditFinding['severity'] }) {
  if (severity === 'error') return <Badge tone="dangerSubtle">Error</Badge>
  if (severity === 'warn') return <Badge tone="warnSubtle">Warn</Badge>
  return <Badge className="bg-surface-overlay text-fg-secondary">Info</Badge>
}

/** Verdict, when, backend link, backend problems and restarted checks, in one card. */
function AuditResultCard({ result }: { result: AuditResult }) {
  const { overall } = result.summary
  const tone =
    overall === 'fail'
      ? CHIP_TONE.dangerSubtle
      : overall === 'warn' || overall === 'unknown'
        ? CHIP_TONE.warnSubtle
        : CHIP_TONE.okSubtle
  const label =
    overall === 'fail'
      ? 'Issues found'
      : overall === 'warn'
        ? 'Warnings'
        : overall === 'unknown'
          ? 'Incomplete: some checks could not be read'
          : 'All clear'
  const backend = result.findings.filter((f) => BACKEND_CATEGORIES.has(f.category))
  const restarted = result.gate_refresh?.triggered ?? []

  return (
    <div className="space-y-2">
      <div className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-4 py-3 ${tone}`}>
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-fg-faint">
          Audited {new Date(result.audit_at).toLocaleString()} ·{' '}
          {result.backend_linked === null
            ? 'Backend link unknown'
            : result.backend_linked
              ? 'Backend linked'
              : 'Backend not linked'}
        </p>
      </div>

      {result.read_errors.length > 0 && (
        <Callout tone="warn" label="Some checks could not be read">
          <ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs text-fg-secondary" role="status">
            {result.read_errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Callout>
      )}

      {backend.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-fg-secondary">Backend ({backend.length})</p>
          {backend.map((f, i) => (
            // mushi-mushi-allowlist: hand-rolled surface (cn/template; not Card tile)
            <div key={i} className="flex items-start gap-2.5 rounded-md border border-edge-subtle bg-surface-raised px-3 py-2">
              <SeverityBadge severity={f.severity} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{f.title}</p>
                <p className="mt-0.5 text-xs text-fg-secondary">{f.detail}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {restarted.length > 0 && (
        <p className="text-xs text-fg-muted" role="status">
          Restarted {restarted.map(gateLabel).join(', ')}: their new results land in the list below when they finish.
        </p>
      )}
    </div>
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
    reload: reloadStats,
  } = usePageData<FullstackAuditStats>(statsPath, { deps: [projectId] })
  const auditStats = auditStatsData ?? EMPTY_FULLSTACK_AUDIT_STATS
  const [result, setResult] = useState<AuditResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [findingsKey, setFindingsKey] = useState(0)

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
        // The findings list and the counts are re-read, never duplicated here.
        invalidateApiCache(`/v1/admin/inventory/${projectId}/findings`)
        invalidateApiCache('/v1/admin/fullstack-audit/stats')
        setFindingsKey((k) => k + 1)
        reloadStats()
      } else {
        setError(describeApiError(res.error, 'The audit failed').hint)
      }
    } catch {
      setError('The audit could not run. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [projectId, reloadStats])

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-full-stack-audit">
      <PageHeaderBar
        title="Full-stack audit"

        helpTitle="Full-stack audit"
        helpWhatIsIt="Every check Mushi runs on this app (API contract, unused endpoints, schema drift, design tokens, setup and hole checks) with its open findings, plus a one-click read of your linked Supabase backend."
        helpUseCases={[
          'Spot broken API contracts before users hit them',
          'Identify backend endpoints never called by the frontend (orphan features)',
          'Detect schema changes that break active API dependencies',
          'See RLS gaps and DB advisor warnings in one view',
        ]}
        helpHowToUse="Set the Supabase project ref in Settings → General, then add a scoped, read-only Supabase access token under Settings → AI keys → Supabase. Then click Run audit."
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

      {!projectId && (
        <Card>
          <p className="text-sm text-fg-secondary">Select a project to run an audit.</p>
        </Card>
      )}

      {error && <ErrorAlert title="The audit failed" message={error} onRetry={projectId ? () => void runAudit() : undefined} />}

      {result && <AuditResultCard result={result} />}

      {projectId && (
        <Section title="Open findings by check">
          <p className="mb-2 text-xs text-fg-muted">
            The newest run of every check, with the file, line and rule behind each count.
          </p>
          <GateFindingsSection
            projectId={projectId}
            neverRunText="No check has run for this project yet."
            refreshKey={findingsKey}
          />
        </Section>
      )}

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
    </div>
  )
}
