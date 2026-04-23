import { Link } from 'react-router-dom'
import { Badge, Breadcrumbs, CodeValue, RelativeTime } from '../ui'
import { STATUS, SEVERITY, CATEGORY_BADGE, CATEGORY_LABELS, statusLabel, severityLabel } from '../../lib/tokens'
import { useReportPresence } from '../../lib/reportPresence'
import type { ReportDetail } from './types'

export function ReportDetailHeader({ report, reporterShort }: { report: ReportDetail; reporterShort: string }) {
  const title = (report.summary ?? report.description ?? 'Untitled report').trim() || 'Untitled report'
  return (
    <div className="mb-3">
      <Breadcrumbs
        items={[
          { label: 'Reports', to: '/reports' },
          { label: title, hint: report.id },
        ]}
      />
      <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={STATUS[report.status] ?? 'text-fg-muted border border-edge'}>
            {statusLabel(report.status)}
          </Badge>
          {report.severity && (
            <Badge className={SEVERITY[report.severity] ?? ''}>{severityLabel(report.severity)}</Badge>
          )}
          {report.category && (
            <Badge
              className={CATEGORY_BADGE[report.category] ?? 'bg-surface-overlay text-fg-secondary border border-edge-subtle'}
            >
              {CATEGORY_LABELS[report.category] ?? report.category}
            </Badge>
          )}
        </div>
        <h2 className="mt-1.5 text-lg font-semibold text-fg leading-snug text-balance max-w-4xl wrap-break-word">
          {title}
        </h2>
        <div className="mt-1.5 flex items-center gap-2 text-xs text-fg-muted flex-wrap">
          <span className="text-fg-secondary">
            <RelativeTime value={report.created_at} />
          </span>
          <span aria-hidden="true" className="text-fg-faint">·</span>
          <Link
            to={`/projects?project=${encodeURIComponent(report.project_id)}`}
            className="hover:text-fg-secondary inline-flex items-center gap-1"
          >
            <span className="font-mono text-2xs">{report.project_id.slice(0, 8)}</span>
            <span className="text-fg-faint">project</span>
          </Link>
          <span aria-hidden="true" className="text-fg-faint">·</span>
          <Link
            to={`/reports?reporter=${encodeURIComponent(report.reporter_token_hash)}`}
            className="hover:text-fg-secondary inline-flex items-center gap-1"
          >
            <span className="font-mono text-2xs">Reporter {reporterShort}</span>
            <span className="text-fg-faint underline-offset-2 hover:underline">view all</span>
          </Link>
          <span aria-hidden="true" className="text-fg-faint">·</span>
          <span className="inline-flex min-w-0 max-w-full items-center gap-1" title={report.id}>
            <CodeValue value={report.id} inline tone="id" className="max-w-[min(100%,24rem)]" />
          </span>
        </div>
      </div>
      <PresenceBadges reportId={report.id} projectId={report.project_id} />
      </div>
    </div>
  )
}

function PresenceBadges({ reportId, projectId }: { reportId: string; projectId: string }) {
  const { others } = useReportPresence({ reportId, projectId })
  if (others.length === 0) return null
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span className="text-2xs text-fg-faint">Also viewing:</span>
      <div className="flex -space-x-1">
        {others.slice(0, 5).map((p) => (
          <div
            key={p.id}
            title={`${p.display_name ?? 'Unknown'} (${p.intent})`}
            className="w-6 h-6 rounded-full border border-edge bg-surface-raised text-2xs flex items-center justify-center font-medium overflow-hidden"
          >
            {p.avatar_url ? (
              <img src={p.avatar_url} alt={p.display_name ?? 'avatar'} className="w-full h-full object-cover" />
            ) : (
              (p.display_name ?? '?').slice(0, 2).toUpperCase()
            )}
          </div>
        ))}
        {others.length > 5 && (
          <div className="w-6 h-6 rounded-full border border-edge bg-surface-raised text-2xs flex items-center justify-center text-fg-muted">
            +{others.length - 5}
          </div>
        )}
      </div>
    </div>
  )
}
