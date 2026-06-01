/**
 * Compact dashboard / get-started strip — nudges users to My feedback.
 */

import { Link } from 'react-router-dom'
import { usePageData } from '../../lib/usePageData'
import { useRealtimeReload } from '../../lib/realtime'
import { Card, Btn, Badge } from '../ui'
import { ContainedBlock, InlineProof } from '../report-detail/ReportSurface'

interface Summary {
  total: number
  active: number
  with_reply: number
  shipped: number
}

export function FeedbackHubStrip({ className = '' }: { className?: string }) {
  const query = usePageData<{ total: number; active: number; with_reply: number; shipped: number }>(
    '/v1/admin/support/tickets/summary',
  )

  useRealtimeReload(['support_tickets'], () => { query.reload() }, { debounceMs: 2000 })

  const s: Summary = query.data ?? { total: 0, active: 0, with_reply: 0, shipped: 0 }
  const hasNews = s.with_reply > 0

  if (!query.loading && s.total === 0) {
    return (
      <Card className={`p-3 border-dashed border-brand/20 bg-brand/5 ${className}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-fg">Help shape Mushi</p>
            <ContainedBlock tone="muted" className="mt-1">
              <p className="text-2xs text-fg-muted">
                Report bugs or request features — we link shipped work to release versions so you can see what landed.
              </p>
            </ContainedBlock>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <Link to="/feedback">
              <Btn size="sm">My feedback</Btn>
            </Link>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card className={`p-3 ${hasNews ? 'border-brand/30 bg-brand/5' : 'border-edge-subtle bg-surface-raised/20'} ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-medium text-fg">My feedback</p>
            {hasNews && (
              <Badge className="bg-brand/15 text-brand border border-brand/30 text-3xs">
                {s.with_reply} {s.with_reply === 1 ? 'reply' : 'replies'} waiting
              </Badge>
            )}
            {s.shipped > 0 && (
              <Badge className="bg-ok-muted text-ok text-3xs font-mono">
                {s.shipped} shipped
              </Badge>
            )}
          </div>
          <InlineProof className="mt-1 tabular-nums">
            {s.total} submission{s.total === 1 ? '' : 's'}
            {s.active > 0 ? ` · ${s.active} active` : ''}
            {s.shipped > 0 ? ` · ${s.shipped} in a release` : ''}
          </InlineProof>
        </div>
        <Link to="/feedback" className="shrink-0">
          <Btn size="sm" variant={hasNews ? 'primary' : 'ghost'}>
            {hasNews ? 'Read replies' : 'View all'}
          </Btn>
        </Link>
      </div>
    </Card>
  )
}
