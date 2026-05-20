/**
 * FILE: apps/admin/src/components/intelligence/ModernizationFindings.tsx
 * PURPOSE: Pending Library Modernization findings with dispatch + dismiss.
 */

import { Link } from 'react-router-dom'
import { Card, Btn, Badge, RelativeTime, EmptyState } from '../ui'
import { SEVERITY_TONE, type ModernizationFinding } from './types'

interface Props {
  findings: ModernizationFinding[]
  dispatchingId: string | null
  projectName: string | null
  loading?: boolean
  onDispatch: (id: string) => void
  onDismiss: (id: string) => void
}

export function ModernizationFindings({
  findings,
  dispatchingId,
  projectName,
  loading,
  onDispatch,
  onDismiss,
}: Props) {
  if (loading) return null

  if (findings.length === 0) {
    return (
      <EmptyState
        title="No pending dependency upgrades"
        description={
          projectName
            ? `${projectName} has no open modernization findings. The weekly library-modernizer cron scans manifests and opens findings here.`
            : 'The weekly library-modernizer cron scans dependency manifests and surfaces upgrade recommendations here.'
        }
        hints={[
          'Security and deprecated deps auto-create synthetic reports for dispatch',
          'Minor findings can be dismissed without a fix',
          'Dispatched findings appear on the Fixes page',
        ]}
      />
    )
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-edge-subtle px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-secondary">
          Library modernization
          <Badge className="ml-2 bg-warn-muted text-warn">{findings.length}</Badge>
        </h3>
        <span className="text-2xs text-fg-faint">Weekly cron · Firecrawl-augmented</span>
      </div>
      <ul className="divide-y divide-edge-subtle">
        {findings.map((f) => (
          <li key={f.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Badge className={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
                <span className="font-mono text-xs font-medium text-fg">{f.dep_name}</span>
                {f.current_version && f.suggested_version && (
                  <span className="font-mono text-2xs text-fg-muted">
                    {f.current_version} → {f.suggested_version}
                  </span>
                )}
              </div>
              <p className="text-2xs leading-relaxed text-fg-secondary">{f.summary}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-2xs text-fg-faint">
                <RelativeTime value={f.detected_at} />
                {f.changelog_url && (
                  <>
                    <span aria-hidden>·</span>
                    <a
                      href={f.changelog_url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-fg-secondary"
                    >
                      changelog
                    </a>
                  </>
                )}
                {f.manifest_path && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="font-mono">{f.manifest_path}</span>
                  </>
                )}
                {!f.related_report_id && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="text-warn">No auto-dispatch (minor)</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Btn
                size="sm"
                variant="primary"
                onClick={() => onDispatch(f.id)}
                disabled={!f.related_report_id || dispatchingId === f.id}
                loading={dispatchingId === f.id}
                title={f.related_report_id ? 'Dispatch to fix-worker' : 'Minor finding — dismiss instead'}
              >
                Dispatch fix
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => onDismiss(f.id)}>
                Dismiss
              </Btn>
            </div>
          </li>
        ))}
      </ul>
      <div className="border-t border-edge-subtle bg-surface-raised/30 px-3 py-2 text-2xs text-fg-faint">
        Dispatched fixes track on <Link to="/fixes" className="text-brand hover:underline">Fixes</Link>.
      </div>
    </Card>
  )
}
