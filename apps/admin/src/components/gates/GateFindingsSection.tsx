/**
 * FILE: apps/admin/src/components/gates/GateFindingsSection.tsx
 * PURPOSE: The open findings of the newest run per gate, with file, line,
 *          message and rule, on every plan (ADR 0018). A `spend_cap_unset`
 *          finding gets the one-click "Apply suggested caps" button.
 *
 *          States are explicit: loading, a failed read (with retry), a gate
 *          that never ran ("not checked yet", never a pass), a run that
 *          errored, and nothing open.
 *
 * Data: GET /v1/admin/inventory/:projectId/findings[?gate=]
 */

import { ErrorAlert, Loading } from '../ui'
import { GateFindingCard } from '../inventory/GateFindingCard'
import { ApplySuggestedCapsButton } from './ApplySuggestedCapsButton'
import { usePageData } from '../../lib/usePageData'
import { latestOpenFindings, spendCapSuggestion, type GateFindingsPayload } from '../../lib/gateFindings'
import { gateLabel, type GateId } from '../../lib/gateLabels'

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
  const { data, loading, error, reload } = usePageData<GateFindingsPayload>(path, { deps: [projectId, gate ?? ''] })

  if (error) return <ErrorAlert message={error} endpoint={path} onRetry={reload} />
  if (loading && !data) return <Loading text="Reading the findings…" />
  if (!data) return null

  const finished = data.runs.filter((r) => r.status !== 'running' && r.status !== 'queued')
  if (finished.length === 0) {
    return <p className="text-xs text-fg-muted">{neverRunText} This is not a pass.</p>
  }

  const findings = latestOpenFindings(data)
  const latestByGate = new Map<string, (typeof finished)[number]>()
  for (const r of finished) if (!latestByGate.has(r.gate)) latestByGate.set(r.gate, r)
  const errored = [...latestByGate.values()].filter((r) => r.status === 'error')
  const shown = findings.slice(0, limit)

  return (
    <div className="flex flex-col gap-2">
      {errored.map((r) => (
        <p key={r.id} className="text-xs text-danger" role="status">
          The last {gateLabel(r.gate)} run could not finish, so its result is unknown.
        </p>
      ))}
      {findings.length === 0 && errored.length === 0 && (
        <p className="text-xs text-fg-muted">The newest run of each check found nothing open.</p>
      )}
      {shown.map((f) => {
        const caps = spendCapSuggestion(f)
        return (
          <GateFindingCard
            key={f.id}
            f={f}
            action={caps ? <ApplySuggestedCapsButton projectId={projectId} values={caps} /> : undefined}
          />
        )
      })}
      {findings.length > shown.length && (
        <p className="text-2xs text-fg-faint">
          {findings.length - shown.length} more not shown. MCP <code className="font-mono">list_gate_findings</code> lists all of them.
        </p>
      )}
    </div>
  )
}
