/**
 * FILE: apps/admin/src/components/gates/GateFindingsSection.tsx
 * PURPOSE: The open findings of the newest run per gate, with file, line,
 *          message and rule, on every plan (ADR 0018). A `spend_cap_unset`
 *          finding gets the one-click "Apply suggested caps" button; every
 *          finding gets "Dismiss" with a required reason.
 *
 *          States are explicit: loading, a failed read (with retry), a gate
 *          that never ran ("not checked yet", never a pass), a run that
 *          errored, and nothing open.
 *
 * Data: GET /v1/admin/inventory/:projectId/findings[?gate=]
 */

import { Link } from 'react-router-dom'
import { Card, Loading, formatRelative } from '../ui'
import { PageLoadError } from '../PageLoadError'
import { GateFindingCard } from '../inventory/GateFindingCard'
import { ApplySuggestedCapsButton } from './ApplySuggestedCapsButton'
import { DismissFindingButton } from './DismissFindingButton'
import { usePageData } from '../../lib/usePageData'
import { LINK_ACCENT } from '../../lib/chipTone'
import {
  FINDINGS_ROUTE_MAX_RUNS,
  findingsReadTruncated,
  groupFindingsByCheck,
  latestOpenFindings,
  latestRunPerGate,
  spendCapSuggestion,
  type CheckGroup,
  type GateFindingsPayload,
} from '../../lib/gateFindings'
import { gateInfo, gateLabel, type GateId } from '../../lib/gateLabels'

interface Props {
  projectId: string
  /** Only this gate; all gates when omitted. */
  gate?: GateId
  /** What "never ran" means for this list, in plain English. */
  neverRunText: string
  /** Show at most this many findings (the rest are counted). */
  limit?: number
}

export function GateFindingsSection({ projectId, gate, neverRunText, limit = 50 }: Props) {
  const path = `/v1/admin/inventory/${encodeURIComponent(projectId)}/findings${gate ? `?gate=${gate}` : ''}`
  const { data, loading, error, errorCode, reload } = usePageData<GateFindingsPayload>(path, { deps: [projectId, gate ?? ''] })

  if (error) return <PageLoadError error={error} code={errorCode} resource="the findings" endpoint={path} onRetry={reload} />
  if (loading && !data) return <Loading text="Reading the findings…" />
  if (!data) return null

  // The route returns the newest 50 runs and 500 findings: past that, a check
  // that last ran earlier is missing, so an all-clear cannot be claimed.
  const truncated = findingsReadTruncated(data)
  const latestByGate = latestRunPerGate(data.runs)
  const truncatedNote = truncated ? (
    <p className="text-xs text-warn" role="status">
      Only the newest {FINDINGS_ROUTE_MAX_RUNS} runs were read; a check that last ran before them is not shown here.
    </p>
  ) : null
  if (latestByGate.size === 0) {
    return truncatedNote ?? <p className="text-xs text-fg-muted">{neverRunText} This is not a pass.</p>
  }

  const findings = latestOpenFindings(data)
  const errored = [...latestByGate.values()].filter((r) => r.status === 'error')
  const groups = groupFindingsByCheck(data)

  return (
    <div className="flex flex-col gap-2">
      {truncatedNote}
      {errored.map((r) => (
        <p key={r.id} className="text-xs text-danger" role="status">
          The last {gateLabel(r.gate)} run could not finish, so its result is unknown.
        </p>
      ))}
      {findings.length === 0 && errored.length === 0 && !truncated && (
        <p className="text-xs text-fg-muted">The newest run of each check found nothing open.</p>
      )}
      {groups.map((g) => (
        <CheckGroupCard key={g.gate} projectId={projectId} group={g} limit={limit} onChanged={reload} />
      ))}
    </div>
  )
}

const STATUS_TEXT: Record<string, { label: string; tone: string }> = {
  fail: { label: 'Failing', tone: 'text-danger' },
  error: { label: 'Could not finish', tone: 'text-danger' },
  warn: { label: 'Needs a look', tone: 'text-warn' },
  pass: { label: 'Passing', tone: 'text-ok' },
}

/**
 * One check: what it looks at, when it last ran and against which commit,
 * whether that result is old, its open findings by rule, and where to work
 * on them. Small groups open by default; large ones show the rule summary.
 */
function CheckGroupCard({ projectId, group: g, limit, onChanged }: { projectId: string; group: CheckGroup; limit: number; onChanged: () => void }) {
  const info = gateInfo(g.gate)
  const status = STATUS_TEXT[g.status] ?? { label: g.status, tone: 'text-fg-muted' }
  const days = g.ranAt ? Math.floor((Date.now() - Date.parse(g.ranAt)) / 86_400_000) : null
  const shown = g.findings.slice(0, limit)
  return (
    <Card className="p-3 space-y-2" data-check={g.gate}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <h3 className="text-sm font-semibold text-fg">{gateLabel(g.gate)}</h3>
          {info && <p className="text-xs text-fg-secondary">{info.checks}</p>}
        </div>
        <span className={`shrink-0 text-xs font-medium ${status.tone}`}>
          {status.label} · {g.open.toLocaleString()} open
        </span>
      </div>
      <p className="text-2xs text-fg-muted">
        Last run {g.ranAt ? <span title={new Date(g.ranAt).toLocaleString()}>{formatRelative(g.ranAt)}</span> : 'at an unknown time'}
        {g.commitSha ? <> on commit <code className="font-mono">{g.commitSha.slice(0, 7)}</code></> : null}
        {g.stale && days != null && (
          <span className="text-warn"> · {days} days old: run it again before acting on it</span>
        )}
      </p>
      {g.rules.length > 0 && (
        <p className="text-2xs text-fg-secondary">
          {g.rules.slice(0, 5).map((r) => `${r.rule} × ${r.count}`).join(' · ')}
          {g.rules.length > 5 ? ` · ${g.rules.length - 5} more rules` : ''}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {info?.page && (
          <Link to={info.page.to} className={`text-xs ${LINK_ACCENT}`}>
            {info.page.label} →
          </Link>
        )}
      </div>
      {g.open > 0 && (
        <details open={g.open <= 3}>
          <summary className="cursor-pointer text-xs text-fg-muted hover:text-fg">
            {g.open <= 3 ? 'Findings' : `Show the ${Math.min(g.open, limit)} findings`}
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {shown.map((f) => {
              const caps = spendCapSuggestion(f)
              return (
                <GateFindingCard
                  key={f.id}
                  f={f}
                  action={
                    <>
                      {caps && <ApplySuggestedCapsButton projectId={projectId} values={caps} />}
                      <DismissFindingButton projectId={projectId} findingId={f.id} onDismissed={onChanged} />
                    </>
                  }
                />
              )
            })}
            {g.findings.length > shown.length && (
              <p className="text-2xs text-fg-faint">
                {g.findings.length - shown.length} more not shown. MCP <code className="font-mono">list_gate_findings</code> lists all of them.
              </p>
            )}
          </div>
        </details>
      )}
    </Card>
  )
}
