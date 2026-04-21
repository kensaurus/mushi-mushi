/**
 * FILE: apps/admin/src/components/intelligence/ModernizationFindings.tsx
 * PURPOSE: Render pending Library Modernization findings with per-row
 *          dispatch + dismiss actions. Mutation lives in the page; this just
 *          surfaces the data.
 */

import { Card, Btn, Badge, RelativeTime } from '../ui'
import { SEVERITY_TONE, type ModernizationFinding } from './types'

interface Props {
  findings: ModernizationFinding[]
  dispatchingId: string | null
  onDispatch: (id: string) => void
  onDismiss: (id: string) => void
}

export function ModernizationFindings({ findings, dispatchingId, onDispatch, onDismiss }: Props) {
  if (findings.length === 0) return null

  return (
    <Card className="p-3">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-2xs uppercase tracking-wider text-fg-muted">
          Library Modernization
          <span className="ml-2 text-fg-faint normal-case tracking-normal">
            {findings.length} pending finding{findings.length === 1 ? '' : 's'}
          </span>
        </h3>
        <span className="text-2xs text-fg-faint">Weekly cron · Firecrawl-augmented</span>
      </div>
      <ul className="space-y-1.5">
        {findings.map((f) => (
          <li
            key={f.id}
            className="flex items-start justify-between gap-3 border-t border-edge-subtle pt-1.5 first:border-0 first:pt-0"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <Badge className={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
                <span className="text-xs font-mono text-fg">{f.dep_name}</span>
                {f.current_version && f.suggested_version && (
                  <span className="text-2xs text-fg-muted font-mono">
                    {f.current_version} → {f.suggested_version}
                  </span>
                )}
              </div>
              <p className="text-2xs text-fg-secondary leading-relaxed">{f.summary}</p>
              <div className="mt-1 flex items-center gap-2 text-2xs text-fg-faint">
                <RelativeTime value={f.detected_at} />
                {f.changelog_url && (
                  <>
                    <span>·</span>
                    <a
                      href={f.changelog_url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-fg-secondary underline"
                    >
                      changelog
                    </a>
                  </>
                )}
                {f.manifest_path && (
                  <>
                    <span>·</span>
                    <span className="font-mono">{f.manifest_path}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Btn
                size="sm"
                onClick={() => onDispatch(f.id)}
                disabled={!f.related_report_id || dispatchingId === f.id}
                loading={dispatchingId === f.id}
                title={f.related_report_id ? 'Dispatch fix-worker' : 'Minor finding — no auto-dispatch'}
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
    </Card>
  )
}
