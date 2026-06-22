import { Badge, Breadcrumbs, RelativeTime } from '../ui'
import { ContainedBlock, MetaChip } from './ReportSurface'
import {
  STATUS,
  SEVERITY,
  CATEGORY_BADGE,
  CATEGORY_LABELS,
  statusLabel,
  severityLabel,
  severityGlowClass,
} from '../../lib/tokens'
import { useReportPresence } from '../../lib/reportPresence'
import type { ReportDetail } from './types'

export function ReportDetailHeader({ report, reporterShort }: { report: ReportDetail; reporterShort: string }) {
  const title = (report.summary ?? report.description ?? 'Untitled report').trim() || 'Untitled report'
  const glow = severityGlowClass(report.severity)
  return (
    <div
      className={`mb-3 rounded-md border border-edge-subtle bg-surface-raised p-3 ${glow} ${glow ? 'motion-safe:transition-all' : ''}`}
    >
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
        <ContainedBlock tone="info" className="mt-2">
          <h2 className="text-lg font-semibold leading-snug text-balance text-fg wrap-break-word max-w-4xl">
            {title}
          </h2>
        </ContainedBlock>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <MetaChip label="Reported">
            <RelativeTime value={report.created_at} />
          </MetaChip>
          <MetaChip
            label="Project"
            to={`/projects?project=${encodeURIComponent(report.project_id)}`}
            title={report.project_id}
          >
            <span className="font-mono">{report.project_id.slice(0, 8)}</span>
          </MetaChip>
          <MetaChip
            label="Reporter"
            to={`/reports?reporter=${encodeURIComponent(report.reporter_token_hash)}`}
          >
            {report.reporter_identity?.display_name ?? report.reporter_display_name ? (
              <span className="max-w-[12rem] truncate">
                {report.reporter_identity?.display_name ?? report.reporter_display_name}
              </span>
            ) : (
              <span className="font-mono">{reporterShort}</span>
            )}
            {(report.reporter_identity?.jwt_verified_at || report.reporter_jwt_verified) && (
              <span
                className="text-3xs text-ok font-semibold uppercase tracking-wide"
                title="Identity verified via signed JWT"
              >
                ✓ verified
              </span>
            )}
            <span className="text-fg-faint">· view all</span>
          </MetaChip>
          {report.session_id && (
            <MetaChip label="Session" title={report.session_id}>
              <span className="font-mono">{report.session_id.slice(0, 8)}</span>
            </MetaChip>
          )}
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
